'use strict';
// University portal background jobs (University doc 2.3, 4.5, 6.6, 8.4, 9.3, 10.3, 10.6, 12.4 E41, 14.7).
const { all, get, run, insert, uuid, now, getSetting } = require('../db');
const U = require('../util');
const { notify, istParts, istDate, addDays, fmtDate, masterName, admins } = U;
const C = require('./common');
const UE = require('./uemail');

function once(key) { if (get('SELECT 1 x FROM reminders_sent WHERE key = ?', key)) return false; run('INSERT INTO reminders_sent (key, created_at) VALUES (?, ?)', key, now()); return true; }
const list = (s, d) => String(getSetting(s) || d).split(',').map(x => Number(x.trim())).filter(x => !isNaN(x));
function workingDaysSince(iso) { let d = new Date(iso); let n = 0; const end = new Date(); while (d < end) { d = new Date(d.getTime() + 864e5); if (d <= end && ![0, 6].includes(d.getDay())) n++; } return n; }

// every minute: unread La Europa messages -> E33 after 15 minutes (max one per thread per 2 hours); review reminders
function frequent() {
  const cutoff = new Date(Date.now() - 15 * 60000).toISOString();
  for (const t of all(`SELECT m.uapp_id, MIN(m.sent_at) first_at, COUNT(*) n FROM uni_messages m WHERE m.sender_type = 'staff' AND m.seen_by_uni_at IS NULL AND m.deleted_at IS NULL AND m.uapp_id IS NOT NULL AND m.sent_at <= ? GROUP BY m.uapp_id`, cutoff)) {
    const ua = get('SELECT * FROM university_applications WHERE id = ?', t.uapp_id); if (!ua || ua.status === 'Withdrawn') continue;
    if (ua.last_e33_at && Date.now() - new Date(ua.last_e33_at) < 2 * 3600e3) continue;
    const v = C.appView(ua);
    UE.trigger('E33', { to: C.usersOf(ua.university_id, { roles: ['admin', 'officer'], alert: 'messages', campusId: ua.campus_id }).map(x => x.email), university_id: ua.university_id, uapp_id: ua.id, link: `/#/applications/${ua.id}?tab=messages`,
      ctx: { unread_count: t.n, application_code: v.application_code, student_name: v.student_name, course: v.course, intake: v.intake } });
    run('UPDATE university_applications SET last_e33_at = ? WHERE id = ?', now(), ua.id);
  }
  // review mode reminders (6.6): handler after N working days, Admin after M working days
  const n1 = Number(getSetting('uni_review_reminder_days') || 1), n2 = Number(getSetting('uni_review_admin_days') || 2);
  for (const x of all(`SELECT x.*, a.application_code FROM uni_actions x JOIN applications a ON a.id = x.application_id WHERE x.processing = 'Pending review'`)) {
    const wd = workingDaysSince(x.created_at);
    if (wd >= n1 && once(`urev1:${x.id}`)) for (const h of C.handlers(get('SELECT * FROM applications WHERE id = ?', x.application_id))) notify(h, 'university', `Reminder: university update waiting for your review (${x.application_code})`, '#/university-updates');
    if (wd >= n2 && once(`urev2:${x.id}`)) for (const a of admins()) notify(a, 'university', `University update waiting more than ${n2} working days: ${x.application_code}`, '#/university-updates');
  }
}

// daily at 9:00 IST
function daily() {
  const today = istDate();
  if (Number(istParts().hour) < 9 || !once(`unidaily:${today}`)) return;
  // agreements: statuses + E47 reminders
  const warn = Number(getSetting('uni_agreement_warn_days') || 60);
  for (const a of all(`SELECT * FROM partner_agreements WHERE is_deleted = 0 AND status NOT IN ('Terminated','Draft')`)) {
    const st = a.end_date && a.end_date < today ? 'Expired' : a.start_date > today ? 'Active' : a.end_date && addDays(today, warn) >= a.end_date ? 'Expiring soon' : 'Active';
    if (st !== a.status) run('UPDATE partner_agreements SET status = ? WHERE id = ?', st, a.id);
    if (a.end_date) for (const d of list('uni_agreement_reminders', '60,30,7')) {
      if (addDays(today, d) === a.end_date && once(`e47:${a.id}:${d}`)) {
        const u = C.uni(a.university_id);
        const ctx = { agreement_code: a.agreement_code, agreement_end_date: fmtDate(a.end_date), days_left: d };
        UE.staffEmail('E47', admins(), { university_id: u.id, ctx });
        UE.trigger('E47', { to: C.usersOf(u.id, { roles: ['admin'] }).map(x => x.email), university_id: u.id, ctx, link: '/#/finance' });
        for (const ad of admins()) notify(ad, 'university', `Partner agreement ${a.agreement_code} (${C.uniName(u)}) ends in ${d} days`, '#/admin/agreements');
        C.notifyUni(u.id, { roles: ['admin'] }, `Partner agreement ends on ${fmtDate(a.end_date)}`, '#/finance');
      }
    }
  }
  // commissions: Expected -> Due on the due date
  run(`UPDATE commissions SET status = 'Due' WHERE status = 'Expected' AND due_date IS NOT NULL AND due_date <= ?`, today);
  // invoices: overdue + E36 reminders (before, on, every N days while overdue)
  const [before, on, every] = list('uni_invoice_reminders', '7,0,7');
  for (const i of all(`SELECT * FROM commission_invoices WHERE kind = 'invoice' AND status IN ('Invoiced','Partially paid','Overdue') AND is_deleted = 0`)) {
    if (i.due_date && i.due_date < today && i.status !== 'Overdue') { run(`UPDATE commission_invoices SET status = 'Overdue' WHERE id = ?`, i.id); run(`UPDATE commissions SET status = 'Overdue' WHERE invoice_id = ? AND status = 'Invoiced'`, i.id); }
    if (i.reminders_paused || i.query_open) continue;
    const send = addDays(today, before) === i.due_date || (on === 0 && i.due_date === today) || (i.due_date < today && every && Math.floor((new Date(today) - new Date(i.due_date)) / 864e5) % every === 0);
    if (send && once(`e36:${i.id}:${today}`)) {
      const to = [...all(`SELECT email FROM uni_contacts WHERE university_id = ? AND department = 'Finance / Accounts' AND is_deleted = 0`, i.university_id).map(x => x.email), ...C.usersOf(i.university_id, { finance: true, alert: 'finance' }).map(x => x.email)];
      UE.trigger('E36', { to, university_id: i.university_id, invoice_id: i.id, link: '/#/finance', ctx: { invoice_number: i.invoice_no, invoice_total: i.total, currency: i.currency, due_date: fmtDate(i.due_date), balance: Math.round((i.total - i.paid) * 100) / 100 } });
      run('UPDATE commission_invoices SET last_reminder_at = ? WHERE id = ?', now(), i.id);
    }
  }
  // intakes past their deadline are Closed automatically (no approval needed)
  run(`UPDATE course_intakes SET status = 'Closed', closed_reason = COALESCE(closed_reason, 'Deadline passed') WHERE deadline < ? AND COALESCE(status,'Open') = 'Open' AND course_id IN (SELECT id FROM courses WHERE campus_id IS NOT NULL)`, today);
  // scholarships expire after the deadline / valid until
  run(`UPDATE scholarships SET status = 'Expired' WHERE status = 'Live' AND ((deadline IS NOT NULL AND deadline < ?) OR (valid_until IS NOT NULL AND valid_until < ?))`, today, today);
  try { for (const u of all(`SELECT DISTINCT university_id FROM scholarships`)) require('./approvals').syncScholarshipBadges(u.university_id); } catch (e) { console.error('[scholarships]', e.message); }
  // E41 digest per university (only if something is pending)
  for (const u of all(`SELECT * FROM universities WHERE portal_status = 'Active'`)) {
    const ua = all('SELECT * FROM university_applications WHERE university_id = ? AND is_deleted = 0', u.id);
    const newN = ua.filter(x => x.status === 'New').length;
    const wk = new Date(Date.now() + 7 * 864e5).toISOString();
    const iv = ua.filter(x => x.status === 'Interview scheduled' && (get('SELECT interview_at FROM applications WHERE id = ?', x.application_id) || {}).interview_at <= wk).length;
    const docs = get(`SELECT COUNT(*) c FROM uni_doc_requests WHERE university_id = ? AND status = 'Fulfilled' AND opened_by_uni_at IS NULL`, u.id).c;
    if (!newN && !iv && !docs) continue;
    const items = [newN && `${newN} new application(s) not yet acknowledged`, iv && `${iv} interview(s) this week`, docs && `${docs} set(s) of documents received from La Europa`].filter(Boolean);
    UE.trigger('E41', { to: C.usersOf(u.id, { roles: ['admin', 'officer'], alert: 'applications' }).map(x => x.email), university_id: u.id, ctx: { pending_summary: require('../email').ul(items) }, link: '/#/dashboard' });
  }
  // staff: university messages waiting more than 1 working day
  const waiting = all(`SELECT m.uapp_id, MIN(m.sent_at) at FROM uni_messages m WHERE m.sender_type = 'university' AND m.seen_by_le_at IS NULL AND m.deleted_at IS NULL AND m.uapp_id IS NOT NULL GROUP BY m.uapp_id`).filter(x => workingDaysSince(x.at) >= 1);
  const byUser = {};
  for (const x of waiting) { const ua = get('SELECT application_id FROM university_applications WHERE id = ?', x.uapp_id); for (const h of C.handlers(get('SELECT * FROM applications WHERE id = ?', ua.application_id))) byUser[h] = (byUser[h] || 0) + 1; }
  for (const [h, n] of Object.entries(byUser)) notify(h, 'university', `${n} university message thread(s) waiting more than 1 working day`, '#/university-messages');
  // urgent catalogue changes are emailed at once; the rest in a daily digest (E48)
  const pend = all(`SELECT * FROM course_change_requests WHERE status = 'Pending approval' AND urgent = 0 AND created_at > ?`, new Date(Date.now() - 864e5).toISOString());
  if (pend.length) UE.staffEmail('E48', admins(), { ctx: { change_summary: `${pend.length} change(s) from ${new Set(pend.map(x => x.university_id)).size} university(ies) submitted in the last 24 hours`, urgent_reason: 'No (daily digest)' } });
}

// 2:00 AM IST: retention (14.7)
function retention() {
  const today = istDate();
  if (Number(istParts().hour) < 2 || !once(`uniret:${today}`)) return;
  let expired = 0;
  for (const ua of all(`SELECT * FROM university_applications WHERE status IN ('Rejected','Withdrawn','Enrolled') AND is_deleted = 0`)) {
    const u = C.uni(ua.university_id); const months = Number(u.doc_access_months || getSetting('uni_access_months') || 0); if (!months) continue;
    const base = ua.status === 'Enrolled' ? (u.doc_access_rule === 'intake' ? (ua.programme_start || ua.enrol_date) : ua.enrol_date) : ua.status_changed_at;
    if (!base || Date.now() - new Date(base) < months * 30.44 * 864e5) continue;
    const r = run(`UPDATE uni_doc_shares SET status = 'Expired', access_expires_at = ? WHERE uapp_id = ? AND status NOT IN ('Revoked','Expired')`, now(), ua.id);
    expired += r && r.changes ? r.changes : 0;
  }
  // closed university accounts: users deactivated
  run(`UPDATE uni_users SET status = 'Inactive' WHERE university_id IN (SELECT id FROM universities WHERE portal_status = 'Closed') AND status != 'Inactive'`);
  // expired ZIP downloads, old in-app notifications (180 days)
  run('DELETE FROM uni_notifications WHERE created_at < ?', new Date(Date.now() - 180 * 864e5).toISOString());
  run('DELETE FROM uni_codes WHERE expires_at < ? AND purpose != ?', new Date(Date.now() - 7 * 864e5).toISOString(), 'reset');
  run(`INSERT INTO audit_log (user_id, action, entity_type, entity_label, created_at, actor_type) VALUES (NULL, 'Retention', 'UniversityPortal', ?, ?, 'system')`, `Daily retention: ${expired} document share(s) expired`, now());
}

module.exports = { frequent, daily, retention };
