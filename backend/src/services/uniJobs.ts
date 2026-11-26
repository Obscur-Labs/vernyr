import Course from '../models/Course';
import PortalAccount from '../models/PortalAccount';
import University from '../models/University';
import { AuditLog, getSetting } from '../models/Audit';
import { ReminderSent } from '../models/Console';
import { Application } from '../models/Work';
import { Commission, CommissionInvoice, CourseChangeRequest, PartnerAgreement, Scholarship, UniAction, UniCode, UniContact, UniDocRequest, UniDocShare, UniMessage, UniNotification, UniversityApplication } from '../models/Partner';
import { addDays, istDate } from './crm';
import { fmtDate } from './invoicePdf';
import { ul } from './email';
import { notify, notifyAdmins } from './tasks';
import { staffEmail, trigger } from './uemail';
import { adminIds, syncScholarshipBadges } from './uniApprovals';
import * as P from './partner';

/** The client's partner portal background jobs (legacy/server/university/jobs.js). ReminderSent dedupes them across restarts. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const once = async (key: string) => { try { await ReminderSent.create({ key }); return true; } catch { return false; } };
const istHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
const list = async (k: string, d: string) => String((await getSetting(k)) || d).split(',').map((x) => Number(x.trim())).filter((x) => !isNaN(x));
function workingDaysSince(at: Date | string) { let d = new Date(at); let n = 0; const end = new Date(); while (d < end) { d = new Date(d.getTime() + 864e5); if (d <= end && ![0, 6].includes(d.getDay())) n++; } return n; }
const emails = (rows: Any[]) => rows.map((x) => x.email).filter(Boolean);

/** every minute: unread La Europa messages -> E33 after 15 minutes (one per thread per 2 hours); review reminders */
export async function uniFrequent() {
  const cutoff = new Date(Date.now() - 15 * 60000);
  const threads = await UniMessage.aggregate([{ $match: { sender_type: 'staff', seen_by_uni_at: null, deleted_at: null, uapp_id: { $ne: null }, sent_at: { $lte: cutoff } } }, { $group: { _id: '$uapp_id', n: { $sum: 1 } } }]);
  for (const t of threads) {
    const ua = (await UniversityApplication.findById(t._id).lean()) as Any; if (!ua || ua.status === 'Withdrawn') continue;
    if (ua.last_e33_at && Date.now() - new Date(ua.last_e33_at).getTime() < 2 * 3600e3) continue;
    const v = await P.appView(ua);
    await trigger('E33', { to: emails(await P.usersOf(ua.university_id, { roles: ['admin', 'officer'], alert: 'messages', campusId: ua.campus_id })), university_id: ua.university_id, uapp_id: ua._id, link: `/applications/${ua._id}?tab=messages`,
      ctx: { unread_count: t.n, application_code: v.application_code, student_name: v.student_name, course: v.course, intake: v.intake } });
    await UniversityApplication.updateOne({ _id: ua._id }, { last_e33_at: new Date() });
  }
  // review mode reminders (6.6): the handler after N working days, Admin after M
  const n1 = Number((await getSetting('uni_review_reminder_days')) || 1), n2 = Number((await getSetting('uni_review_admin_days')) || 2);
  for (const x of (await UniAction.find({ processing: 'Pending review' }).lean()) as Any[]) {
    const wd = workingDaysSince(x.createdAt);
    if (wd < n1) continue;
    const a = (await Application.findById(x.application_id).lean()) as Any; if (!a) continue;
    if (await once(`urev1:${x._id}`)) for (const h of await P.handlers(a)) await notify(h, 'university', `Reminder: university update waiting for your review (${a.application_code})`, '/university-updates');
    if (wd >= n2 && (await once(`urev2:${x._id}`))) await notifyAdmins('university', `University update waiting more than ${n2} working days: ${a.application_code}`, '/university-updates');
  }
}

/** daily at 9:00 IST */
export async function uniDaily() {
  const today = istDate();
  if (istHour() < 9 || !(await once(`unidaily:${today}`))) return;
  const admins = await adminIds();
  // agreements: status, and E47 reminders before the end
  const warn = Number((await getSetting('uni_agreement_warn_days')) || 60);
  for (const a of (await PartnerAgreement.find({ is_deleted: false, status: { $nin: ['Terminated', 'Draft'] } }).lean()) as Any[]) {
    const st = a.end_date && a.end_date < today ? 'Expired' : a.start_date > today ? 'Active' : a.end_date && addDays(today, warn) >= a.end_date ? 'Expiring soon' : 'Active';
    if (st !== a.status) await PartnerAgreement.updateOne({ _id: a._id }, { status: st });
    if (!a.end_date) continue;
    for (const d of await list('uni_agreement_reminders', '60,30,7')) {
      if (addDays(today, d) !== a.end_date || !(await once(`e47:${a._id}:${d}`))) continue;
      const u = (await University.findById(a.university_id).lean()) as Any; if (!u) continue;
      const ctx = { agreement_code: a.agreement_code, agreement_end_date: fmtDate(a.end_date), days_left: d };
      await staffEmail('E47', admins, { university_id: u._id, ctx });
      await trigger('E47', { to: emails(await P.usersOf(u._id, { roles: ['admin'] })), university_id: u._id, ctx, link: '/finance' });
      await notifyAdmins('university', `Partner agreement ${a.agreement_code} (${P.uniName(u)}) ends in ${d} days`, '/admin/agreements');
      await P.notifyUni(u._id, { roles: ['admin'] }, `Partner agreement ends on ${fmtDate(a.end_date)}`, '/finance');
    }
  }
  // commissions: Expected -> Due on the due date
  await Commission.updateMany({ status: 'Expected', due_date: { $ne: null, $lte: today } }, { status: 'Due' });
  // invoices: overdue, and E36 reminders (before, on the day, every N days while overdue)
  const [before, on, every] = await list('uni_invoice_reminders', '7,0,7');
  for (const i of (await CommissionInvoice.find({ kind: 'invoice', status: { $in: ['Invoiced', 'Partially paid', 'Overdue'] }, is_deleted: false }).lean()) as Any[]) {
    if (i.due_date && i.due_date < today && i.status !== 'Overdue') { await CommissionInvoice.updateOne({ _id: i._id }, { status: 'Overdue' }); await Commission.updateMany({ invoice_id: i._id, status: 'Invoiced' }, { status: 'Overdue' }); }
    if (i.reminders_paused || i.query_open || !i.due_date) continue;
    const late = Math.floor((new Date(today).getTime() - new Date(i.due_date).getTime()) / 864e5);
    const send = addDays(today, before) === i.due_date || (on === 0 && i.due_date === today) || (i.due_date < today && !!every && late % every === 0);
    if (!send || !(await once(`e36:${i._id}:${today}`))) continue;
    const to = [...emails((await UniContact.find({ university_id: i.university_id, department: 'Finance / Accounts', is_deleted: false }).select('email').lean()) as Any[]), ...emails(await P.usersOf(i.university_id, { finance: true, alert: 'finance' }))];
    await trigger('E36', { to, university_id: i.university_id, invoice_id: i._id, link: '/finance', ctx: { invoice_number: i.invoice_no, invoice_total: i.total, currency: i.currency, due_date: fmtDate(i.due_date), balance: Math.round(((i.total || 0) - (i.paid || 0)) * 100) / 100 } });
    await CommissionInvoice.updateOne({ _id: i._id }, { last_reminder_at: new Date() });
  }
  // intakes past their deadline close on their own (no approval needed), for courses the university manages
  for (const c of (await Course.find({ campus_id: { $ne: null }, intakes: { $elemMatch: { deadline: { $lt: today }, status: { $nin: ['Closed'] } } } }).select('intakes')) ) {
    for (const i of c.intakes) if (i.deadline && i.deadline < today && (i.status || 'Open') === 'Open') { i.status = 'Closed'; i.closed_reason = i.closed_reason || 'Deadline passed'; }
    await c.save();
  }
  // scholarships expire after the deadline or valid-until date
  await Scholarship.updateMany({ status: 'Live', $or: [{ deadline: { $ne: null, $lt: today } }, { valid_until: { $ne: null, $lt: today } }] }, { status: 'Expired' });
  for (const u of await Scholarship.distinct('university_id')) await syncScholarshipBadges(u).catch((e) => console.error('[scholarships]', e.message));
  // E41 digest per university, only when something is pending
  const wk = new Date(Date.now() + 7 * 864e5);
  for (const u of (await University.find({ portal_status: 'Active' }).select('_id').lean()) as Any[]) {
    const uas = (await UniversityApplication.find({ university_id: u._id, is_deleted: false }).select('status application_id').lean()) as Any[];
    const newN = uas.filter((x) => x.status === 'New').length;
    const ivIds = uas.filter((x) => x.status === 'Interview scheduled').map((x) => x.application_id);
    const iv = ivIds.length ? await Application.countDocuments({ _id: { $in: ivIds }, interview_at: { $lte: wk } }) : 0;
    const docs = await UniDocRequest.countDocuments({ university_id: u._id, status: 'Fulfilled', opened_by_uni_at: null });
    if (!newN && !iv && !docs) continue;
    const items = [newN && `${newN} new application(s) not yet acknowledged`, iv && `${iv} interview(s) this week`, docs && `${docs} set(s) of documents received from La Europa`].filter(Boolean) as string[];
    await trigger('E41', { to: emails(await P.usersOf(u._id, { roles: ['admin', 'officer'], alert: 'applications' })), university_id: u._id, ctx: { pending_summary: ul(items) }, link: '/dashboard' });
  }
  // staff: university messages waiting more than 1 working day
  const waiting = (await UniMessage.aggregate([{ $match: { sender_type: 'university', seen_by_le_at: null, deleted_at: null, uapp_id: { $ne: null } } }, { $group: { _id: '$uapp_id', at: { $min: '$sent_at' } } }])).filter((x) => workingDaysSince(x.at) >= 1);
  const byUser = new Map<string, number>();
  for (const x of waiting) {
    const ua = (await UniversityApplication.findById(x._id).select('application_id').lean()) as Any; const a = ua ? ((await Application.findById(ua.application_id).lean()) as Any) : null; if (!a) continue;
    for (const h of await P.handlers(a)) byUser.set(String(h), (byUser.get(String(h)) || 0) + 1);
  }
  for (const [h, n] of byUser) await notify(h, 'university', `${n} university message thread(s) waiting more than 1 working day`, '/university-messages');
  // urgent catalogue changes are emailed at once; the rest in a daily digest (E48)
  const pend = (await CourseChangeRequest.find({ status: 'Pending approval', urgent: { $ne: true }, createdAt: { $gt: new Date(Date.now() - 864e5) } }).select('university_id').lean()) as Any[];
  if (pend.length) await staffEmail('E48', admins, { ctx: { change_summary: `${pend.length} change(s) from ${new Set(pend.map((x) => String(x.university_id))).size} university(ies) submitted in the last 24 hours`, urgent_reason: 'No (daily digest)' } });
}

/** 2:00 AM IST: retention (14.7) */
export async function uniRetention() {
  const today = istDate();
  if (istHour() < 2 || !(await once(`uniret:${today}`))) return;
  let expired = 0;
  const defMonths = Number((await getSetting('uni_access_months')) || 0);
  const unis = new Map<string, Any>();
  for (const ua of (await UniversityApplication.find({ status: { $in: ['Rejected', 'Withdrawn', 'Enrolled'] }, is_deleted: false }).lean()) as Any[]) {
    const k = String(ua.university_id);
    if (!unis.has(k)) unis.set(k, (await University.findById(ua.university_id).select('doc_access_months doc_access_rule').lean()) ?? {});
    const u = unis.get(k)!; const months = Number(u.doc_access_months || defMonths); if (!months) continue;
    const base = ua.status === 'Enrolled' ? (u.doc_access_rule === 'intake' ? ua.programme_start || ua.enrol_date : ua.enrol_date) : ua.status_changed_at;
    if (!base || Date.now() - new Date(base).getTime() < months * 30.44 * 864e5) continue;
    const r = await UniDocShare.updateMany({ uapp_id: ua._id, status: { $nin: ['Revoked', 'Expired'] } }, { status: 'Expired', access_expires_at: new Date() });
    expired += r.modifiedCount;
  }
  // closed university accounts: their users are deactivated
  const closed = await University.distinct('_id', { portal_status: 'Closed' });
  if (closed.length) await PortalAccount.updateMany({ role: 'university', universityId: { $in: closed }, status: { $ne: 'Inactive' } }, { status: 'Inactive' });
  await UniNotification.deleteMany({ createdAt: { $lt: new Date(Date.now() - 180 * 864e5) } });
  await UniCode.deleteMany({ expires_at: { $lt: new Date(Date.now() - 7 * 864e5) }, purpose: { $ne: 'reset' } });
  await AuditLog.create({ action: 'Retention', entity_type: 'UniversityPortal', entity_label: `Daily retention: ${expired} document share(s) expired`, actor_type: 'system' });
}
