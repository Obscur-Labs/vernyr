'use strict';
const VAULT = require('../vault'); // files are stored AES-256-GCM encrypted
// University portal API part 1 (/api/university/*): dashboard, applications inbox, detail, actions, documents, messages.
// The university is always resolved from the session (req.uu.university_id). Other universities' records return 404 (1.8).
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const express = require('express');
const { all, get, run, insert, update, uuid, now, getSetting, tx, DATA_DIR } = require('../db');
const U = require('../util');
const { bad, ah, clean, num, masterName, fullName, fmtDate, fmtDateTime, notify } = U;
const files = require('../files');
const C = require('./common');
const A = require('./actions');
const UE = require('./uemail');
const UA = require('./auth');

const r = express.Router();
const role = (req, ...roles) => { if (!roles.includes(req.uu.role)) throw new U.HttpError(403, 'Your role does not allow this action.'); };
const actor = (req) => ({ uu: req.uu });
const sameUni = (req, row) => { if (!row || row.university_id !== req.uu.university_id) throw C.NotFound(); return row; };

// ---------- scope: own university + own campuses (2.7, 14.2) ----------
function scopeSql(req, alias = 'ua') {
  const w = [`${alias}.university_id = ?`, `${alias}.is_deleted = 0`]; const p = [req.uu.university_id];
  if (req.campuses.length) { w.push(`${alias}.campus_id IN (${req.campuses.map(() => '?').join(',')})`); p.push(...req.campuses); }
  return [w.join(' AND '), p];
}
function loadUA(req, id) {
  const ua = get('SELECT * FROM university_applications WHERE id = ? AND is_deleted = 0', id);
  if (!ua || ua.university_id !== req.uu.university_id || (req.campuses.length && !req.campuses.includes(ua.campus_id))) throw C.NotFound();
  return ua;
}
// retention (14.7): access to the record after a final decision
function accessEnded(ua) {
  const u = C.uni(ua.university_id);
  const months = Number(u.doc_access_months || getSetting('uni_access_months') || 0);
  if (!months) return false;
  if (['Rejected', 'Withdrawn'].includes(ua.status)) return Date.now() - new Date(ua.status_changed_at) > months * 30.44 * 864e5;
  if (ua.status === 'Enrolled') { const base = u.doc_access_rule === 'intake' ? (ua.programme_start || ua.enrol_date) : ua.enrol_date; return base && Date.now() - new Date(base) > months * 30.44 * 864e5; }
  return false;
}
const unreadFor = (ua) => get(`SELECT COUNT(*) c FROM uni_messages WHERE uapp_id = ? AND sender_type = 'staff' AND seen_by_uni_at IS NULL AND deleted_at IS NULL`, ua.id).c;
const openReq = (ua) => get(`SELECT * FROM uni_doc_requests WHERE uapp_id = ? AND status IN ('Open','Partly fulfilled') ORDER BY created_at DESC LIMIT 1`, ua.id);

// ---------- me / notifications / notices ----------
r.get('/me', ah(async (req, res) => {
  const notices = all(`SELECT id, title, body, created_at FROM uni_notices WHERE (university_id IS NULL OR university_id = ?) AND (active_until IS NULL OR active_until >= ?) ORDER BY created_at DESC LIMIT 3`, req.uu.university_id, U.istDate());
  res.json({ ...UA.meOut(req.uu), preview: req.preview, notices, unread: get('SELECT COUNT(*) c FROM uni_notifications WHERE uni_user_id = ? AND is_read = 0', req.uu.id).c,
    unread_messages: get(`SELECT COUNT(*) c FROM uni_messages m WHERE m.university_id = ? AND m.sender_type = 'staff' AND m.seen_by_uni_at IS NULL AND m.deleted_at IS NULL`, req.uu.university_id).c,
    idle_left_sec: Math.max(0, Math.round((Number(getSetting('uni_idle_min') || 30) * 60000 - (Date.now() - new Date(req.usession.last_seen_at))) / 1000)) });
}));
r.post('/ping', (req, res) => res.json({ ok: true }));
r.get('/notifications', ah(async (req, res) => res.json({ rows: all('SELECT * FROM uni_notifications WHERE uni_user_id = ? ORDER BY created_at DESC LIMIT 60', req.uu.id), unread: get('SELECT COUNT(*) c FROM uni_notifications WHERE uni_user_id = ? AND is_read = 0', req.uu.id).c })));
r.post('/notifications/read', ah(async (req, res) => { if (req.body.all) run('UPDATE uni_notifications SET is_read = 1 WHERE uni_user_id = ?', req.uu.id); else for (const id of req.body.ids || []) run('UPDATE uni_notifications SET is_read = 1 WHERE id = ? AND uni_user_id = ?', id, req.uu.id); res.json({ ok: true }); }));

// ---------- dashboard (5) ----------
const CARD = [['new', 'New applications received', ['New']], ['review', 'Under review', ['Acknowledged', 'Documents requested', 'Under assessment', 'Waitlisted']], ['interview', 'Interview', ['Interview scheduled']],
  ['conditional', 'Conditional offers', ['Conditional offer']], ['unconditional', 'Unconditional offers', ['Unconditional offer']], ['rejected', 'Rejected', ['Rejected']], ['accepted', 'Offers accepted', ['Offer accepted']],
  ['deposit', 'Deposits / tuition paid', ['Deposit received']], ['enrolled', 'Enrolled', ['Enrolled']], ['withdrawn', 'Withdrawn', ['Withdrawn']]];
function filtered(req, q) {
  const [w, p] = scopeSql(req); const where = [w]; const params = [...p];
  if (q.intake) { where.push('a.intake_id = ?'); params.push(q.intake); }
  if (q.course) { where.push('a.course_id = ?'); params.push(q.course); }
  if (q.level) { where.push('a.level = ?'); params.push(q.level); }
  if (q.campus) { where.push('ua.campus_id = ?'); params.push(q.campus); }
  if (q.from) { where.push('ua.submitted_at >= ?'); params.push(q.from); }
  if (q.to) { where.push('ua.submitted_at <= ?'); params.push(q.to + 'T23:59:59'); }
  return all(`SELECT ua.*, a.intake_id, a.course_id, a.course_name_text, a.level, a.student_id FROM university_applications ua JOIN applications a ON a.id = ua.application_id WHERE ${where.join(' AND ')}`, ...params);
}
r.get('/dashboard', ah(async (req, res) => {
  const rows = filtered(req, req.query);
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const cards = CARD.map(([k, label, st]) => ({ key: k, label, statuses: st, count: rows.filter(x => st.includes(x.status)).length, week: rows.filter(x => st.includes(x.status) && (x.status_changed_at || x.submitted_at) >= week).length }));
  const intakes = {}; for (const x of rows) { const n = masterName(x.intake_id) || '-'; intakes[n] = intakes[n] || {}; intakes[n][x.status] = (intakes[n][x.status] || 0) + 1; }
  const states = {}; for (const x of rows) { const s = get('SELECT state FROM students WHERE id = ?', x.student_id); const k = s && s.state ? s.state : 'Not given'; states[k] = (states[k] || 0) + 1; }
  const small = getSetting('uni_small_numbers') !== '0';
  const courses = {}; for (const x of rows) { const n = x.course_name_text || masterName(x.course_id); courses[n] = (courses[n] || 0) + 1; }
  const reached = (sts) => rows.filter(x => sts.includes(x.status) || (x.first_decision_at && sts.includes('decided'))).length;
  const funnelSets = [['Received', STATUSES_ALL], ['Reviewed', C.STATUSES.filter(s => s !== 'New')], ['Offer', ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled']],
    ['Offer accepted', ['Offer accepted', 'Deposit received', 'Enrolled']], ['Deposit', ['Deposit received', 'Enrolled']], ['Enrolled', ['Enrolled']]];
  const funnel = funnelSets.map(([l, sts]) => ({ label: l, count: rows.filter(x => sts.includes(x.status) && x.status !== 'Withdrawn').length }));
  const decided = rows.filter(x => x.first_decision_at);
  const decisionDays = decided.length ? Math.round(decided.reduce((n, x) => n + (new Date(x.first_decision_at) - new Date(x.submitted_at)) / 864e5, 0) / decided.length * 10) / 10 : null;
  res.json({ cards, intakes, states: Object.entries(states).map(([k, v]) => ({ state: k, count: small && v < 5 ? 'fewer than 5' : v })).sort((a, b) => (typeof b.count === 'number' ? b.count : 0) - (typeof a.count === 'number' ? a.count : 0)),
    top_courses: Object.entries(courses).map(([k, v]) => ({ course: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 10), funnel, decision_days: decisionDays, pending: pendingActions(req),
    filters: { intakes: all(`SELECT DISTINCT a.intake_id id FROM university_applications ua JOIN applications a ON a.id = ua.application_id WHERE ua.university_id = ?`, req.uu.university_id).map(x => ({ id: x.id, name: masterName(x.id) })),
      courses: all(`SELECT id, name, level FROM courses WHERE university_id = ? AND is_deleted = 0 ORDER BY name`, req.uu.university_id), campuses: all(`SELECT id, name FROM campuses WHERE university_id = ? AND is_deleted = 0`, req.uu.university_id) } });
}));
const STATUSES_ALL = C.STATUSES;
function workingDaysSince(iso) { let d = new Date(iso); let n = 0; const end = new Date(); while (d < end) { d = new Date(d.getTime() + 864e5); if (d <= end && ![0, 6].includes(d.getDay())) n++; } return n; }
function pendingActions(req) {
  const [w, p] = scopeSql(req);
  const rows = all(`SELECT * FROM university_applications ua WHERE ${w}`, ...p);
  const acting = req.uu.role !== 'viewer';
  const out = [];
  const nAck = Number(getSetting('uni_ack_days') || 3);
  const late = rows.filter(x => x.status === 'New' && workingDaysSince(x.submitted_at) > nAck);
  const newOnes = rows.filter(x => x.status === 'New');
  if (acting && newOnes.length) out.push({ key: 'new', label: `${newOnes.length} new application(s) not acknowledged${late.length ? ` (${late.length} for more than ${nAck} working days)` : ''}`, red: late.length > 0, link: '#/applications?status=New' });
  const reqs = all(`SELECT q.*, ua.id uid FROM uni_doc_requests q JOIN university_applications ua ON ua.id = q.uapp_id WHERE ${w} AND q.status IN ('Open','Partly fulfilled')`, ...p);
  if (reqs.length) out.push({ key: 'docreq', label: `${reqs.length} document request(s) waiting for La Europa`, link: '#/applications?docreq=1' });
  const answered = all(`SELECT q.* FROM uni_doc_requests q JOIN university_applications ua ON ua.id = q.uapp_id WHERE ${w} AND q.status = 'Fulfilled' AND q.opened_by_uni_at IS NULL`, ...p);
  if (acting && answered.length) out.push({ key: 'docsent', label: `La Europa sent documents for ${answered.length} application(s): please review`, link: '#/applications?answered=1' });
  const wk = new Date(Date.now() + 7 * 864e5).toISOString();
  const iv = rows.filter(x => x.status === 'Interview scheduled' && (() => { const a = get('SELECT interview_at FROM applications WHERE id = ?', x.application_id); return a.interview_at && a.interview_at >= now() && a.interview_at <= wk; })());
  if (acting && iv.length) out.push({ key: 'interviews', label: `${iv.length} interview(s) this week`, link: '#/applications?status=Interview%20scheduled' });
  const accepted = rows.filter(x => x.status === 'Offer accepted');
  if (acting && accepted.length) out.push({ key: 'accepted', label: `${accepted.length} offer acceptance(s) confirmed: deposit not yet marked`, link: '#/applications?status=Offer%20accepted' });
  const dep = rows.filter(x => x.status === 'Deposit received' && x.programme_start && x.programme_start < U.istDate());
  if (acting && dep.length) out.push({ key: 'enrol', label: `${dep.length} deposit(s) received and programme started: enrolment not marked`, red: true, link: '#/applications?status=Deposit%20received' });
  const follow = all(`SELECT ol.* FROM offer_letters ol JOIN university_applications ua ON ua.id = ol.uapp_id WHERE ${w} AND ol.document_id IS NULL`, ...p);
  if (acting && follow.length) out.push({ key: 'letters', label: `${follow.length} offer letter(s) still to upload`, red: true, link: '#/applications' });
  const unread = get(`SELECT COUNT(DISTINCT COALESCE(uapp_id,'g')) c FROM uni_messages WHERE university_id = ? AND sender_type = 'staff' AND seen_by_uni_at IS NULL AND deleted_at IS NULL`, req.uu.university_id).c;
  if (unread) out.push({ key: 'msgs', label: `Unread messages from La Europa in ${unread} thread(s)`, link: '#/messages' });
  if (acting) { const pc = get(`SELECT COUNT(*) c FROM course_change_requests WHERE university_id = ? AND status = 'Pending approval' AND is_deleted = 0`, req.uu.university_id).c + get(`SELECT COUNT(*) c FROM uni_profile_requests WHERE university_id = ? AND status = 'Pending'`, req.uu.university_id).c;
    if (pc) out.push({ key: 'changes', label: `${pc} change(s) waiting for La Europa approval`, link: '#/courses?pending=1' }); }
  if (req.uu.finance || req.uu.role === 'admin') { const inv = get(`SELECT COUNT(*) c FROM commission_invoices WHERE university_id = ? AND status IN ('Invoiced','Partially paid','Overdue') AND kind = 'invoice'`, req.uu.university_id).c; if (inv) out.push({ key: 'inv', label: `${inv} invoice(s) due / overdue`, link: '#/finance' }); }
  return out;
}

// ---------- applications inbox (6.3) ----------
r.get('/applications', ah(async (req, res) => {
  const q = req.query;
  let rows = filtered(req, q);
  if (q.status) { const st = String(q.status).split(','); rows = rows.filter(x => st.includes(x.status)); }
  if (q.q) { const t = String(q.q).toLowerCase(); rows = rows.filter(x => { const a = get('SELECT application_code FROM applications WHERE id = ?', x.application_id); const s = get('SELECT first_name, middle_name, last_name FROM students WHERE id = ?', x.student_id);
    return a.application_code.toLowerCase().includes(t) || fullName(s).toLowerCase().includes(t) || String(x.university_ref || '').toLowerCase().includes(t); }); }
  let out = rows.map(x => ({ ...C.appView(x), unread: unreadFor(x), open_request: !!openReq(x), answered: !!get(`SELECT 1 x FROM uni_doc_requests WHERE uapp_id = ? AND status = 'Fulfilled' AND opened_by_uni_at IS NULL`, x.id),
    late: x.status === 'New' && workingDaysSince(x.submitted_at) > Number(getSetting('uni_ack_days') || 3) }));
  if (q.docreq === '1') out = out.filter(x => x.open_request);
  if (q.answered === '1') out = out.filter(x => x.answered);
  if (q.unread === '1') out = out.filter(x => x.unread);
  if (q.pending_days) out = out.filter(x => !['Rejected', 'Enrolled', 'Withdrawn', 'Offer accepted', 'Deposit received'].includes(x.status) && x.days_in_status > Number(q.pending_days));
  const sorts = { submitted: (a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)), days: (a, b) => b.days_in_status - a.days_in_status, intake: (a, b) => String(a.intake).localeCompare(String(b.intake)), student: (a, b) => a.student_name.localeCompare(b.student_name) };
  out.sort(sorts[q.sort] || sorts.submitted); if (q.dir === 'asc') out.reverse();
  const size = [25, 50, 100].includes(Number(q.size)) ? Number(q.size) : 25; const page = Math.max(1, Number(q.page) || 1);
  res.json({ total: out.length, page, size, rows: out.slice((page - 1) * size, page * size), statuses: C.STATUSES });
}));
r.post('/applications/bulk-acknowledge', ah(async (req, res) => {
  role(req, 'admin', 'officer');
  let n = 0;
  for (const id of (req.body.ids || []).slice(0, 200)) { const ua = loadUA(req, id); if (ua.status !== 'New') continue; A.record(ua, 'acknowledge', {}, actor(req), 'Acknowledged'); n++; }
  C.uaudit(req, 'Update', 'UniversityApplication', null, `Bulk acknowledge (${n})`);
  res.json({ ok: true, count: n });
}));
r.get('/applications/export.xlsx', ah(async (req, res) => {
  if (req.uu.role === 'viewer' && !req.uni.viewer_exports) throw new U.HttpError(403, 'Exports are not available for your role.');
  const ExcelJS = require('exceljs');
  let rows = filtered(req, req.query); if (req.query.ids) { const ids = String(req.query.ids).split(','); rows = rows.filter(x => ids.includes(x.id)); }
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Applications');
  ws.columns = [['Application ID', 'application_code', 18], ['Student name', 'student_name', 26], ['Course', 'course', 34], ['Level', 'level', 10], ['Campus', 'campus', 14], ['Intake', 'intake', 12],
    ['Submitted on', 'submitted', 14], ['Status', 'status', 18], ['Days in status', 'days_in_status', 8], ['University reference', 'university_ref', 16], ['State', 'state', 14]].map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  for (const x of rows) { const v = C.appView(x); ws.addRow({ ...v, submitted: fmtDate(v.submitted_at) }); }
  C.uaudit(req, 'Export', 'UniversityApplication', null, `Applications export (${rows.length} rows)`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="applications.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

// ---------- application detail (6.4) ----------
function timelineOf(ua) {
  const ev = [{ at: ua.submitted_at, text: 'Submitted by La Europa' }];
  for (const x of all('SELECT * FROM uni_actions WHERE uapp_id = ? ORDER BY created_at', ua.id)) {
    const who = x.by_uni_user_id ? (get('SELECT name FROM uni_users WHERE id = ?', x.by_uni_user_id) || {}).name : 'La Europa';
    ev.push({ at: x.created_at, text: `${A.DECISION_LABEL[x.type] || x.type}${x.to_status && x.to_status !== x.from_status ? ` (status: ${x.to_status})` : ''}`, by: who, received: ['Applied', 'Applied without notifying', 'Info'].includes(x.processing) || !!x.processed_at });
  }
  for (const s of all('SELECT * FROM uni_doc_shares WHERE uapp_id = ? ORDER BY shared_at', ua.id)) {
    const d = get('SELECT document_type_id, title FROM documents WHERE id = ?', s.document_id);
    ev.push({ at: s.shared_at, text: `Document shared by La Europa: ${d.title || masterName(d.document_type_id)}` });
    if (s.revoked_at) ev.push({ at: s.revoked_at, text: `Document removed by La Europa: ${d.title || masterName(d.document_type_id)}` });
  }
  for (const q of all('SELECT * FROM uni_doc_requests WHERE uapp_id = ?', ua.id)) { ev.push({ at: q.created_at, text: 'Documents requested from La Europa' }); if (q.answered_at) ev.push({ at: q.answered_at, text: `La Europa answered the document request (${q.status})` }); }
  const m = get(`SELECT COUNT(*) c FROM uni_messages WHERE uapp_id = ? AND deleted_at IS NULL`, ua.id).c; if (m) ev.push({ at: now(), text: `${m} message(s) in the thread`, info: true });
  if (ua.withdrawn_at) ev.push({ at: ua.withdrawn_at, text: 'Withdrawn by La Europa' });
  return ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
r.get('/applications/:id', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id);
  C.uaudit(req, 'View', 'UniversityApplication', ua.id, C.appView(ua).application_code);
  if (accessEnded(ua)) { const b = C.appView(ua); return res.json({ id: b.id, application_code: b.application_code, course: b.course, intake: b.intake, status: b.status, access_ended: true }); }
  const v = C.appView(ua, { detail: true });
  const q = openReq(ua);
  if (q && q.status === 'Fulfilled' && !q.opened_by_uni_at) run('UPDATE uni_doc_requests SET opened_by_uni_at = ? WHERE id = ?', now(), q.id);
  run(`UPDATE uni_doc_requests SET opened_by_uni_at = COALESCE(opened_by_uni_at, ?) WHERE uapp_id = ? AND status = 'Fulfilled'`, now(), ua.id);
  res.json({ ...v, timeline: timelineOf(ua), allowed: allowedActions(req, ua), requests: requestsOf(ua), unread: unreadFor(ua),
    contact_note: req.uni.share_contact ? null : 'Student contact details are managed by La Europa. Please message La Europa for anything you need from the student.',
    received: all('SELECT id, type, processing, created_at FROM uni_actions WHERE uapp_id = ? ORDER BY created_at DESC LIMIT 20', ua.id).map(x => ({ ...x, label: A.DECISION_LABEL[x.type], received: x.processing !== 'Pending review' && x.processing !== 'Held' ? true : false, processing: undefined })),
    reject_reasons: REJECT_REASONS, courses: all(`SELECT id, name, level FROM courses WHERE university_id = ? AND is_deleted = 0 AND COALESCE(uni_status,'Active') = 'Active'`, req.uu.university_id) });
}));
function requestsOf(ua) {
  return all('SELECT * FROM uni_doc_requests WHERE uapp_id = ? ORDER BY created_at DESC', ua.id).map(q => ({ id: q.id, message: q.message, needed_by: q.needed_by, status: q.status, created_at: q.created_at, answered_at: q.answered_at,
    items: all('SELECT id, document_type_id, title, note, status, reply FROM uni_doc_request_items WHERE request_id = ?', q.id).map(i => ({ ...i, name: i.title || masterName(i.document_type_id) })) }));
}
const REJECT_REASONS = ['Academic requirement not met', 'English requirement not met', 'Incomplete documents', 'Course full', 'Deadline passed', 'Profile not suitable for the course', 'Conditions not met', 'Other'];
function allowedActions(req, ua) {
  if (req.uu.role === 'viewer' || req.preview || ua.status === 'Withdrawn') return [];
  const s = ua.status; const out = [];
  const can = (to) => C.canMove(s, to);
  if (s === 'New') out.push('acknowledge');
  if (!['Offer accepted', 'Deposit received', 'Enrolled', 'Rejected', 'Withdrawn'].includes(s)) out.push('doc_request');
  if (['New', 'Acknowledged', 'Documents requested', 'Under assessment', 'Interview scheduled'].includes(s)) out.push('interview');
  if (s === 'Interview scheduled') out.push('interview_result');
  if (can('Under assessment') && s !== 'Under assessment') out.push('under_assessment');
  if (can('Conditional offer')) out.push('conditional_offer');
  if (can('Unconditional offer') && s !== 'Conditional offer') out.push('unconditional_offer');
  if (s === 'Conditional offer') out.push('conditions_met');
  if (can('Rejected')) out.push('reject');
  if (['New', 'Acknowledged', 'Documents requested', 'Under assessment', 'Interview scheduled'].includes(s)) out.push('waitlist');
  if (['Conditional offer', 'Unconditional offer'].includes(s)) out.push('offer_letter');
  if (s === 'Offer accepted') out.push('deposit');
  if (s === 'Deposit received' || (s === 'Offer accepted' && req.uni.enrol_from_accepted)) out.push('enrolled');
  if (['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(s)) out.push('cas');
  if (req.uu.role === 'admin') out.push('correction');
  out.push('upload', 'reference');
  return out;
}
r.put('/applications/:id/reference', ah(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = loadUA(req, req.params.id);
  const ref = clean(req.body.university_ref, 50);
  update('university_applications', ua.id, { university_ref: ref, updated_by_type: 'university' });
  run('UPDATE applications SET university_app_id = ? WHERE id = ?', ref, ua.application_id);
  C.uaudit(req, 'Update', 'UniversityApplication', ua.id, `University reference ${ref || '(cleared)'}`); res.json({ ok: true });
}));

// ---------- actions (6.5) ----------
const pdfOnly = (f) => { if (f && !/\.pdf$/i.test(f.originalname)) { files.cleanup(f); throw bad('Please upload a PDF file'); } };
const futureDate = (d) => d && d >= U.istDate();
function moneyChecks(errors, b, fields) { for (const [k, label, req0] of fields) { const v = num(b[k]); if (req0 && (v === null || v < 0)) errors[k] = `${label} is required`; else if (v !== null && v < 0) errors[k] = 'Must be 0 or more'; } }
// Save a university-uploaded file as a student document (status Uploaded, uploaded_by_type university)
function saveUniDoc(req, ua, file, typeName, extra = {}) {
  const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id);
  const { ext, mime } = files.checkFile(file, typeName === 'Other university document' || typeName === 'University receipt' ? files.ALLOWED : ['pdf'], Math.min(25, Number(getSetting('uni_max_file_mb') || 10)));
  const tid = files.typeId(typeName) || files.typeId('Others');
  const doc = files.docFor(a.student_id, tid, { title: extra.title || (files.typeId(typeName) ? null : typeName), application_id: a.id }, null);
  if (!doc.application_id) run('UPDATE documents SET application_id = ? WHERE id = ?', a.id, doc.id);
  const v = files.addVersion(doc, file.path, file.originalname, mime, ext, req.uu.id, 'university', { note: extra.note });
  const s = get('SELECT primary_counsellor_id, application_user_id FROM students WHERE id = ?', a.student_id);
  for (const h of C.handlers(a)) notify(h, 'university', `${C.uniName(req.uni)} uploaded ${typeName}${extra.title ? ' (' + extra.title + ')' : ''} for ${a.application_code}`, `#/students/${a.student_id}/applications`);
  return { doc, v };
}
const ACT = {
  acknowledge: { roles: ['admin', 'officer'], to: () => 'Acknowledged', check: (ua) => ua.status === 'New', run(req, ua, b) {
    if (b.expected_decision && !futureDate(b.expected_decision)) throw U.fieldErr('expected_decision', 'Expected decision date must be in the future');
    const ref = clean(b.reference, 50);
    update('university_applications', ua.id, { university_ref: ref || ua.university_ref, expected_decision: b.expected_decision || null });
    if (ref) run('UPDATE applications SET university_app_id = ? WHERE id = ?', ref, ua.application_id);
    if (clean(b.note)) postMessage(req, ua, clean(b.note, 1000), 'action');
    return { reference: ref, expected_decision: b.expected_decision || null };
  } },
  under_assessment: { roles: ['admin', 'officer'], to: () => 'Under assessment', run: () => ({}) },
  doc_request: { roles: ['admin', 'officer'], to: (ua) => 'Documents requested', check: (ua) => !['Offer accepted', 'Deposit received', 'Enrolled', 'Rejected', 'Withdrawn'].includes(ua.status), run(req, ua, b) {
    const items = (Array.isArray(b.items) ? b.items : []).filter(i => i && (i.document_type_id || clean(i.title)));
    if (!items.length) throw U.fieldErr('items', 'Add at least one document');
    if (!clean(b.message)) throw U.fieldErr('message', 'Message to La Europa is required');
    if (b.needed_by && !futureDate(b.needed_by)) throw U.fieldErr('needed_by', 'Must be a future date');
    const id = uuid();
    insert('uni_doc_requests', { id, uapp_id: ua.id, university_id: ua.university_id, message: clean(b.message, 2000), needed_by: b.needed_by || null, pause: b.pause === false ? 0 : 1, status: 'Open', prev_status: ua.status, created_by: req.uu.id, created_at: now() });
    for (const i of items) insert('uni_doc_request_items', { id: uuid(), request_id: id, document_type_id: i.document_type_id || null, title: clean(i.title, 150), note: clean(i.note, 300), status: 'Open' });
    run('UPDATE university_applications SET flag_docs_requested = 1 WHERE id = ?', ua.id);
    const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id); const s = get('SELECT * FROM students WHERE id = ?', a.student_id);
    run(`UPDATE applications SET uni_flag = 'Documents requested by university' WHERE id = ?`, a.id);
    const list = items.map(i => `${i.title || masterName(i.document_type_id)}${i.note ? ' (' + i.note + ')' : ''}`);
    const hs = C.handlers(a);
    for (const h of hs) notify(h, 'university', `${C.uniName(req.uni)} requested documents for ${fullName(s)} (${a.application_code})`, `#/students/${s.id}/applications`);
    UE.staffEmail('E44', hs, { university_id: ua.university_id, ctx: { student_name: fullName(s), student_id: s.student_code, application_code: a.application_code, documents_list: require('../email').ul(list),
      university_message: clean(b.message, 2000), due_date: b.needed_by ? fmtDate(b.needed_by) : 'not given' } });
    return { request_id: id, items: list };
  } },
  interview: { roles: ['admin', 'officer'], to: () => 'Interview scheduled', run(req, ua, b) {
    const errors = {};
    if (!b.at || new Date(b.at) < new Date()) errors.at = 'Interview date and time must be in the future';
    if (!['Online video', 'Phone', 'In person', 'Written / online test'].includes(b.mode)) errors.mode = 'Choose the mode';
    if (['Online video', 'In person'].includes(b.mode) && !clean(b.link)) errors.link = 'Link or address is required';
    if (b.mode === 'Online video' && b.link && !/^https:\/\//i.test(b.link)) errors.link = 'Links must start with https://';
    if (b.duration && (num(b.duration) < 10 || num(b.duration) > 240)) errors.duration = '10 to 240 minutes';
    if (ua.status === 'Interview scheduled' && !clean(b.reason)) errors.reason = 'Reason for rescheduling is required';
    if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
    if (clean(b.note)) postMessage(req, ua, clean(b.note, 1000), 'action');
    return { at: new Date(b.at).toISOString(), mode: b.mode, link: clean(b.link, 300), duration: num(b.duration), instructions: clean(b.instructions, 1000), timezone: clean(b.timezone, 60), rescheduled: ua.status === 'Interview scheduled', reason: clean(b.reason, 300) };
  } },
  interview_result: { roles: ['admin', 'officer'], to: () => null, check: (ua) => ua.status === 'Interview scheduled', run(req, ua, b, file) {
    if (!['Passed', 'Not passed', 'Pending', 'No show'].includes(b.result)) throw U.fieldErr('result', 'Choose the result');
    let doc = null; if (file) { pdfOnly(file); doc = saveUniDoc(req, ua, file, 'Interview result', { note: clean(b.feedback, 500) }).doc.id; }
    return { result: b.result, feedback: clean(b.feedback, 1000), document_id: doc };
  } },
  conditional_offer: { roles: ['admin', 'officer'], to: () => 'Conditional offer', run: (req, ua, b, file) => offer(req, ua, b, file, true) },
  unconditional_offer: { roles: ['admin', 'officer'], to: () => 'Unconditional offer', run: (req, ua, b, file) => offer(req, ua, b, file, false) },
  conditions_met: { roles: ['admin', 'officer'], to: () => 'Unconditional offer', check: (ua) => ua.status === 'Conditional offer', run(req, ua, b, file) {
    const conds = Array.isArray(b.conditions) ? b.conditions : [];
    let letter = null; if (file) { pdfOnly(file); letter = offerLetter(req, ua, file, 'Unconditional', b.issue_date); }
    return { conditions: conds.map(c => ({ id: c.id, result: c.result === 'Waived' ? 'Waived' : 'Met' })), letter };
  } },
  reject: { roles: ['admin', 'officer'], to: () => 'Rejected', run(req, ua, b) {
    if (!REJECT_REASONS.includes(b.reason)) throw U.fieldErr('reason', 'Choose a reason');
    if (b.reason === 'Other' && !clean(b.details)) throw U.fieldErr('details', 'Details are required for Other');
    if (ua.status === 'Conditional offer' && b.reason !== 'Conditions not met' && !clean(b.details)) throw U.fieldErr('details', 'Please explain why the conditional offer is withdrawn');
    run('UPDATE university_applications SET reject_reason = ? WHERE id = ?', b.reason, ua.id);
    return { reason: b.reason, details: clean(b.details, 1000), share_reason: b.share_reason === true || b.share_reason === 'true', suggest_course_id: b.suggest_course_id || null,
      suggest_course: b.suggest_course_id ? (get('SELECT name FROM courses WHERE id = ? AND university_id = ?', b.suggest_course_id, ua.university_id) || {}).name : null };
  } },
  waitlist: { roles: ['admin', 'officer'], to: () => 'Waitlisted', run(req, ua, b) {
    if (!clean(b.note)) throw U.fieldErr('note', 'Reason / note to La Europa is required');
    if (b.expected_decision && !futureDate(b.expected_decision)) throw U.fieldErr('expected_decision', 'Must be a future date');
    update('university_applications', ua.id, { expected_decision: b.expected_decision || null });
    return { note: clean(b.note, 1000), expected_decision: b.expected_decision || null, position: num(b.position) };
  } },
  offer_letter: { roles: ['admin', 'officer'], to: () => null, check: (ua) => ['Conditional offer', 'Unconditional offer'].includes(ua.status), run(req, ua, b, file) {
    if (!file) throw U.fieldErr('file', 'Choose the offer letter (PDF)'); pdfOnly(file);
    if (!['Conditional', 'Unconditional', 'Revised'].includes(b.letter_type)) throw U.fieldErr('letter_type', 'Choose the letter type');
    const pending0 = get('SELECT id FROM offer_letters WHERE uapp_id = ? AND document_id IS NULL ORDER BY created_at DESC LIMIT 1', ua.id);
    const letter = offerLetter(req, ua, file, b.letter_type, b.issue_date, pending0 && pending0.id);
    return { letter, letter_type: b.letter_type, note: clean(b.note, 500) };
  } },
  deposit: { roles: ['admin', 'officer'], to: () => 'Deposit received', check: (ua) => ua.status === 'Offer accepted', run(req, ua, b, file) {
    const errors = {}; moneyChecks(errors, b, [['amount', 'Amount received', true], ['balance', 'Remaining balance', false]]);
    if (num(b.amount) !== null && num(b.amount) <= 0) errors.amount = 'Must be more than 0';
    if (!b.date || b.date > U.istDate()) errors.date = 'Date received is required and cannot be in the future';
    if (!b.currency) errors.currency = 'Currency is required';
    if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
    let doc = null; if (file) doc = saveUniDoc(req, ua, file, 'University receipt').doc.id;
    update('university_applications', ua.id, { deposit_amount: num(b.amount), deposit_currency: b.currency, deposit_date: b.date });
    const out = { amount: num(b.amount), currency: b.currency, date: b.date, reference: clean(b.reference, 100), balance: num(b.balance), document_id: doc };
    setImmediate(() => { try { A.upsertCommission(ua.id, 'deposit'); } catch (e) { console.error('[commission]', e.message); } });
    return out;
  } },
  enrolled: { roles: ['admin', 'officer'], to: () => 'Enrolled', check: (ua, req) => ua.status === 'Deposit received' || (ua.status === 'Offer accepted' && req.uni.enrol_from_accepted), run(req, ua, b, file) {
    const errors = {};
    if (!b.enrol_date || b.enrol_date > U.istDate()) errors.enrol_date = 'Enrolment date is required and cannot be in the future';
    if (!b.programme_start) errors.programme_start = 'Programme start date is required';
    moneyChecks(errors, b, [['final_tuition', 'Final first-year tuition fee', true], ['scholarship', 'Scholarship', false]]);
    if (!b.currency) errors.currency = 'Currency is required';
    if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
    let doc = null; if (file) { pdfOnly(file); doc = saveUniDoc(req, ua, file, 'Enrolment confirmation').doc.id; }
    update('university_applications', ua.id, { enrol_date: b.enrol_date, programme_start: b.programme_start, student_uni_id: clean(b.student_uni_id, 50), final_tuition: num(b.final_tuition), final_currency: b.currency, scholarship_amount: num(b.scholarship) });
    return { enrol_date: b.enrol_date, programme_start: b.programme_start, student_uni_id: clean(b.student_uni_id, 50), final_tuition: num(b.final_tuition), currency: b.currency, scholarship: num(b.scholarship), document_id: doc };
  } },
  cas: { roles: ['admin', 'officer'], to: () => null, check: (ua) => ['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(ua.status), run(req, ua, b, file) {
    const types = C.parseJ(getSetting('uni_letter_types'), null) || ['Acceptance / admission letter for visa', 'CAS', 'Pre-enrolment or visa support letter', 'JW201 / JW202 (China)', 'Other'];
    if (!types.includes(b.letter_type)) throw U.fieldErr('letter_type', 'Choose the letter type');
    if (!file) throw U.fieldErr('file', 'Choose the file (PDF)'); pdfOnly(file);
    const { doc } = saveUniDoc(req, ua, file, 'Acceptance letter for visa', { title: null, note: [b.letter_type, b.reference, b.valid_until ? 'valid until ' + b.valid_until : ''].filter(Boolean).join(', ') });
    const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id); const vc = get(`SELECT id FROM visa_cases WHERE student_id = ? AND is_open = 1 AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1`, a.student_id);
    if (vc) run('UPDATE documents SET visa_case_id = COALESCE(visa_case_id, ?) WHERE id = ?', vc.id, doc.id);
    return { letter_type: b.letter_type, reference: clean(b.reference, 100), issue_date: b.issue_date || null, valid_until: b.valid_until || null, document_id: doc.id };
  } },
  correction: { roles: ['admin'], to: (ua, b) => b.status, check: () => true, run(req, ua, b) {
    if (!C.STATUSES.includes(b.status) || ['New', 'Withdrawn', 'Offer accepted'].includes(b.status)) throw U.fieldErr('status', 'Choose the correct status');
    if (!clean(b.reason)) throw U.fieldErr('reason', 'Reason is required');
    return { status: b.status, reason: clean(b.reason, 1000), previous: ua.status };
  } }
};
function offerLetter(req, ua, file, type, issueDate, pendingId) {
  const { doc, v } = saveUniDoc(req, ua, file, 'Offer letter');
  run(`UPDATE documents SET status = 'Verified', verified_at = ? WHERE id = ?`, now(), doc.id); // offer letters from the university are authentic by source
  run(`UPDATE document_versions SET version_status = 'Verified' WHERE id = ?`, v.id);
  if (pendingId) { run('UPDATE offer_letters SET document_id = ?, version_id = ?, issue_date = ?, type = ? WHERE id = ?', doc.id, v.id, issueDate || U.istDate(), type, pendingId); return pendingId; }
  return insert('offer_letters', { id: uuid(), uapp_id: ua.id, application_id: ua.application_id, type, document_id: doc.id, version_id: v.id, issue_date: issueDate || U.istDate(), created_at: now() });
}
function offer(req, ua, b, file, conditional) {
  const errors = {};
  const follow = b.letter_to_follow === true || b.letter_to_follow === 'true';
  if (!file && !follow) errors.file = 'Upload the offer letter (PDF) or tick "Offer letter to follow"';
  if (follow && !b.letter_date) errors.letter_date = 'When will the letter follow?';
  const conds = conditional ? (Array.isArray(b.conditions) ? b.conditions : C.parseJ(b.conditions, [])).filter(c => c && clean(c.text)) : [];
  if (conditional && !conds.length) errors.conditions = 'Add at least one condition';
  moneyChecks(errors, b, [['tuition', 'Tuition fee for first year', true], ['scholarship', 'Scholarship', false], ['deposit', 'Deposit', false]]);
  if (!b.currency) errors.currency = 'Currency is required';
  if (b.acceptance_deadline && !futureDate(b.acceptance_deadline)) errors.acceptance_deadline = 'Must be a future date';
  Object.assign(errors, C.feeWordCheck({ scholarship_text: b.scholarship_text, note: b.note }));
  if (Object.keys(errors).length) { files.cleanup(file); throw bad('Please fix the highlighted fields', { errors }); }
  let letter = null;
  if (file) { pdfOnly(file); letter = offerLetter(req, ua, file, conditional ? 'Conditional' : 'Unconditional', b.issue_date); }
  else letter = insert('offer_letters', { id: uuid(), uapp_id: ua.id, application_id: ua.application_id, type: conditional ? 'Conditional' : 'Unconditional', issue_date: b.letter_date, created_at: now() });
  if (clean(b.note)) postMessage(req, ua, clean(b.note, 1000), 'action');
  return { conditions: conds.map(c => ({ text: clean(c.text, 500), type: c.type || 'Other', due: c.due || null })), acceptance_deadline: b.acceptance_deadline || null, tuition: num(b.tuition), currency: b.currency,
    scholarship: num(b.scholarship), scholarship_text: clean(b.scholarship_text, 200), deposit: num(b.deposit), deposit_currency: b.currency, deposit_deadline: b.deposit_deadline || null,
    programme_start: b.programme_start || null, letter_to_follow: follow, letter };
}
r.post('/applications/:id/actions/:type', files.upload.single('file'), ah(async (req, res) => {
  const def = ACT[req.params.type];
  if (!def) { files.cleanup(req.file); throw C.NotFound(); }
  let ua;
  try {
    ua = loadUA(req, req.params.id);
    if (!def.roles.includes(req.uu.role)) throw new U.HttpError(403, 'Your role does not allow this action.');
    if (ua.status === 'Withdrawn') throw bad(`Withdrawn by La Europa on ${fmtDate(ua.withdrawn_at)}. This application is read-only.`);
    if (accessEnded(ua)) throw bad('Access period ended for this application.');
    // optimistic locking (6.7)
    if (req.body.version !== undefined && Number(req.body.version) !== Number(ua.version)) {
      const last = get('SELECT by_uni_user_id, by_staff_id FROM uni_actions WHERE uapp_id = ? ORDER BY created_at DESC LIMIT 1', ua.id);
      const who = last ? (last.by_uni_user_id ? (get('SELECT name FROM uni_users WHERE id = ?', last.by_uni_user_id) || {}).name : 'La Europa') : 'someone';
      throw new U.HttpError(409, `This application was updated by ${who} a moment ago. Please refresh.`);
    }
    const b = { ...req.body }; for (const k of ['items', 'conditions']) if (typeof b[k] === 'string') b[k] = C.parseJ(b[k], []);
    const to = def.to(ua, b);
    if (def.check ? !def.check(ua, req) : (to && !C.canMove(ua.status, to))) throw bad('This action is not allowed in the current status.');
    // Nov 2026: "Generate the offer letter" builds the PDF from the form instead of an upload
    const D = require('./direct');
    if (!req.file && (b.generate === true || b.generate === 'true') && ['conditional_offer', 'unconditional_offer', 'offer_letter', 'conditions_met'].includes(req.params.type)) {
      if (['conditional_offer', 'unconditional_offer'].includes(req.params.type) && num(b.tuition) === null) throw U.fieldErr('tuition', 'Tuition fee for first year is required');
      req.file = await D.offerPdfFile(req, ua, b, req.params.type === 'conditions_met' ? 'unconditional_offer' : req.params.type === 'offer_letter' ? (b.letter_type === 'Conditional' ? 'conditional_offer' : 'unconditional_offer') : req.params.type);
      b.letter_to_follow = false;
    }
    const data = await def.run(req, ua, b, req.file);
    if (data && data.letter) D.pushOffer(req, ua, data.letter); // the student gets the offer letter directly (copy for La Europa)
    if (req.params.type === 'correction' && data.status === 'Enrolled') update('university_applications', ua.id, {});
    const rec = A.record(get('SELECT * FROM university_applications WHERE id = ?', ua.id), req.params.type, data, actor(req), to);
    if (req.params.type === 'enrolled' || (req.params.type === 'correction' && ['Enrolled', 'Deposit received'].includes(data.status)) || (req.params.type === 'correction' && data.previous === 'Enrolled'))
      setImmediate(() => { try { A.upsertCommission(ua.id, 'enrolled'); } catch (e) { console.error('[commission]', e.message); } });
    C.uaudit(req, 'Action', 'UniversityApplication', ua.id, `${A.DECISION_LABEL[req.params.type]} (${ua.status} -> ${to || ua.status})`, { status: ua.status }, { status: to || ua.status, data });
    res.json({ ok: true, action_id: rec.id, status: (get('SELECT status FROM university_applications WHERE id = ?', ua.id) || {}).status });
  } catch (e) { files.cleanup(req.file); throw e; }
}));
r.post('/applications/:id/requests/:rid/cancel', ah(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = loadUA(req, req.params.id);
  const q = get(`SELECT * FROM uni_doc_requests WHERE id = ? AND uapp_id = ? AND status IN ('Open','Partly fulfilled')`, req.params.rid, ua.id); if (!q) throw C.NotFound();
  if (!clean(req.body.reason)) throw U.fieldErr('reason', 'Reason is required');
  run(`UPDATE uni_doc_requests SET status = 'Cancelled', cancel_reason = ? WHERE id = ?`, clean(req.body.reason, 300), q.id);
  closeRequestFlags(ua);
  C.uaudit(req, 'Update', 'UniDocRequest', q.id, 'Cancelled'); res.json({ ok: true });
}));
function closeRequestFlags(ua) {
  if (get(`SELECT 1 x FROM uni_doc_requests WHERE uapp_id = ? AND status IN ('Open','Partly fulfilled')`, ua.id)) return;
  run('UPDATE university_applications SET flag_docs_requested = 0 WHERE id = ?', ua.id);
  run(`UPDATE applications SET uni_flag = NULL WHERE id = ? AND uni_flag = 'Documents requested by university'`, ua.application_id);
  const cur = get('SELECT status FROM university_applications WHERE id = ?', ua.id).status;
  if (cur === 'Documents requested') { const prev = (get('SELECT prev_status FROM uni_doc_requests WHERE uapp_id = ? ORDER BY created_at DESC LIMIT 1', ua.id) || {}).prev_status;
    run('UPDATE university_applications SET status = ?, status_changed_at = ?, version = version + 1 WHERE id = ?', ['Acknowledged', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer'].includes(prev) ? prev : 'Acknowledged', now(), ua.id); }
}

// ---------- documents (7) ----------
function docsOf(req, ua) {
  const shares = all(`SELECT * FROM uni_doc_shares WHERE uapp_id = ? ORDER BY shared_at DESC`, ua.id);
  const byDoc = {};
  for (const s of shares) {
    const d = get('SELECT * FROM documents WHERE id = ?', s.document_id); const v = get('SELECT * FROM document_versions WHERE id = ?', s.version_id);
    if (!d || !v) continue;
    const k = d.id; byDoc[k] = byDoc[k] || { document_id: d.id, name: d.title || masterName(d.document_type_id), source: 'La Europa', versions: [] };
    byDoc[k].versions.push({ share_id: s.id, version_no: v.version_no, status: s.status === 'Revoked' ? `Removed by La Europa on ${fmtDate(s.revoked_at)}` : s.status === 'Expired' ? 'Access period ended' : 'Shared by La Europa',
      active: !['Revoked', 'Expired'].includes(s.status), shared_at: s.shared_at, updated: byDoc[k].versions.length > 0 });
  }
  const own = all(`SELECT d.*, v.id vid, v.version_no, v.uploaded_at, v.uploaded_by, v.version_status, v.removed_at FROM documents d JOIN document_versions v ON v.document_id = d.id
    WHERE d.application_id = ? AND v.uploaded_by_type = 'university' AND d.is_deleted = 0 ORDER BY v.uploaded_at DESC`, ua.application_id);
  const ownDocs = {};
  for (const o of own) {
    const k = o.id; ownDocs[k] = ownDocs[k] || { document_id: o.id, name: o.title || masterName(o.document_type_id), source: 'University', versions: [] };
    const label = o.removed_at ? 'Removed' : o.version_status === 'Rejected' || (o.status === 'Rejected' && o.current_version_id === o.vid) ? `Returned by La Europa: ${[o.rejection_reason, o.rejection_text].filter(Boolean).join(': ')}. Please upload a corrected version.`
      : (o.status === 'Verified' && o.current_version_id === o.vid) || o.version_status === 'Verified' ? 'Accepted by La Europa' : 'Sent to La Europa (being checked)';
    ownDocs[k].versions.push({ version_id: o.vid, version_no: o.version_no, status: label, uploaded_at: o.uploaded_at, by: (get('SELECT name FROM uni_users WHERE id = ?', o.uploaded_by) || {}).name || 'University',
      can_remove: !o.removed_at && !o.staff_opened_at && o.status === 'Uploaded' && o.current_version_id === o.vid && o.uploaded_by === req.uu.id, active: !o.removed_at });
  }
  return { shared: Object.values(byDoc), uploads: Object.values(ownDocs) };
}
const canSeeDocs = (req) => req.uu.role !== 'viewer' || !!req.uni.viewer_docs;
r.get('/applications/:id/documents', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id);
  if (!canSeeDocs(req)) return res.json({ hidden: true, shared: [], uploads: [] });
  if (accessEnded(ua)) return res.json({ access_ended: true, shared: [], uploads: [] });
  res.json({ ...docsOf(req, ua), zip: !!req.uni.zip_download, upload_types: ['University invoice (tuition)', 'Other university document'] });
}));
// signed file link (5 minutes, bound to the user)
r.post('/applications/:id/documents/link', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id); if (!canSeeDocs(req)) throw C.NotFound();
  const disp = req.body.download ? 'attachment' : 'inline';
  if (req.body.share_id) { const s = get(`SELECT * FROM uni_doc_shares WHERE id = ? AND uapp_id = ? AND status NOT IN ('Revoked','Expired')`, req.body.share_id, ua.id); if (!s) throw C.NotFound();
    return res.json({ url: `/api/university/file/s/${s.id}?` + new URL('http://x' + files.sign('us:' + s.id, req.uu.id, disp)).searchParams.toString() }); }
  const v = get(`SELECT v.* FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND d.application_id = ? AND v.uploaded_by_type = 'university'`, req.body.version_id, ua.application_id);
  if (!v) throw C.NotFound();
  res.json({ url: `/api/university/file/v/${v.id}?` + new URL('http://x' + files.sign('uv:' + v.id, req.uu.id, disp)).searchParams.toString() });
}));
// download alert (7.6): more than N documents per hour
function downloadGuard(req) {
  UA.hit('udl:' + req.uu.id, 100, 3600e3);
  const n = get('SELECT COUNT(*) c FROM doc_access_log WHERE uni_user_id = ? AND at > ?', req.uu.id, new Date(Date.now() - 3600e3).toISOString()).c;
  const limit = Number(getSetting('uni_download_alert') || 50);
  if (n === limit) for (const ad of U.admins()) notify(ad, 'university', `Unusual download activity: ${req.uu.name} (${C.uniName(req.uni)}) downloaded ${n} documents in 1 hour`, '#/admin/university');
}
function logAccess(req, ua, share, versionId, action) {
  insert('doc_access_log', { id: uuid(), uni_user_id: req.uu.id, university_id: req.uu.university_id, uapp_id: ua.id, document_id: share ? share.document_id : null, version_id: versionId, action, ip: req.ip, user_agent: String(req.headers['user-agent'] || '').slice(0, 300), at: now() });
  C.uaudit(req, action === 'preview' ? 'View' : 'Download', 'Document', share ? share.document_id : versionId, action);
}
// watermark (7.6): stamped on the server, cached for at most 10 minutes
const wmCache = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of wmCache) if (t - v.at > 600e3) wmCache.delete(k); }, 60000).unref();
async function stamped(req, ua, version, a) {
  const key = `${version.id}:${req.uu.id}`;
  const c = wmCache.get(key); if (c) return c.buf;
  const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
  const buf = VAULT.read(files.filePath(version.file_key));
  let doc;
  if (/pdf/.test(version.mime_type || '') || /\.pdf$/i.test(version.file_key)) {
    try { doc = await PDFDocument.load(buf, { ignoreEncryption: true }); doc.getPages(); }
    catch { // never send an unstamped original: give a stamped notice page instead
      doc = await PDFDocument.create(); const f0 = await doc.embedFont(StandardFonts.Helvetica); const p0 = doc.addPage([595.28, 841.89]);
      p0.drawText('This file could not be watermarked automatically.', { x: 50, y: 760, size: 14, font: f0 });
      p0.drawText('Please message La Europa in the portal to receive it.', { x: 50, y: 738, size: 11, font: f0 });
    }
  }
  else { doc = await PDFDocument.create(); const img = /png/.test(version.mime_type) ? await doc.embedPng(buf) : await doc.embedJpg(buf); const A4 = [595.28, 841.89]; const sc = Math.min((A4[0] - 40) / img.width, (A4[1] - 60) / img.height, 1); const p = doc.addPage(A4); p.drawImage(img, { x: (A4[0] - img.width * sc) / 2, y: (A4[1] - img.height * sc) / 2 + 10, width: img.width * sc, height: img.height * sc }); }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const line = `Shared by La Europa Education with ${C.shortName(req.uni)} for application ${a.application_code} | ${req.uu.email} | ${fmtDateTime(new Date())} IST | Confidential`;
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    p.drawText(`La Europa Education - ${C.shortName(req.uni)} - Confidential`, { x: width * 0.12, y: height * 0.3, size: Math.max(14, width / 26), font, color: rgb(0.6, 0.6, 0.6), opacity: 0.18, rotate: degrees(35) });
    const sz = Math.max(5, Math.min(7, width / 95));
    p.drawRectangle({ x: 0, y: 0, width, height: sz + 8, color: rgb(1, 1, 1), opacity: 0.85 });
    p.drawText(line.slice(0, Math.floor(width / (sz * 0.5))), { x: 6, y: 4, size: sz, font, color: rgb(0.25, 0.25, 0.25) });
  }
  const out = Buffer.from(await doc.save());
  wmCache.set(key, { buf: out, at: Date.now() });
  return out;
}
r.get('/file/s/:sid', ah(async (req, res) => {
  const { exp, d, sig } = req.query;
  if (!files.verifySig('us:' + req.params.sid, req.uu.id, exp, d, sig)) throw new U.HttpError(403, 'This link has expired. Please open the file again.');
  const s = get(`SELECT * FROM uni_doc_shares WHERE id = ? AND status NOT IN ('Revoked','Expired')`, req.params.sid); if (!s) throw C.NotFound();
  const ua = loadUA(req, s.uapp_id); if (!canSeeDocs(req) || accessEnded(ua)) throw C.NotFound();
  const v = get('SELECT * FROM document_versions WHERE id = ?', s.version_id); const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id);
  const dt = get('SELECT d.title, m.name FROM documents d JOIN master_items m ON m.id = d.document_type_id WHERE d.id = ?', s.document_id);
  downloadGuard(req);
  const action = d === 'attachment' ? 'download' : 'preview';
  logAccess(req, ua, s, v.id, action);
  run(`UPDATE uni_doc_shares SET status = CASE WHEN ? = 'download' THEN 'Downloaded' WHEN status = 'Shared' THEN 'Viewed' ELSE status END, viewed_at = COALESCE(viewed_at, ?), downloaded_at = CASE WHEN ? = 'download' THEN ? ELSE downloaded_at END WHERE id = ?`, action, now(), action, now(), s.id);
  const buf = req.uni.watermark ? await stamped(req, ua, v, a) : VAULT.read(files.filePath(v.file_key));
  const name = `${a.application_code}_${String((dt.title || dt.name)).replace(/[^A-Za-z0-9]+/g, '_')}_v${v.version_no}.${req.uni.watermark ? 'pdf' : path.extname(v.file_key).slice(1)}`;
  res.setHeader('Content-Type', req.uni.watermark ? 'application/pdf' : v.mime_type); res.setHeader('Content-Disposition', `${d === 'attachment' ? 'attachment' : 'inline'}; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, no-store'); res.end(buf);
}));
r.get('/file/v/:vid', ah(async (req, res) => {
  const { exp, d, sig } = req.query;
  if (!files.verifySig('uv:' + req.params.vid, req.uu.id, exp, d, sig)) throw new U.HttpError(403, 'This link has expired. Please open the file again.');
  const v = get(`SELECT v.*, d.application_id FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND v.uploaded_by_type = 'university'`, req.params.vid); if (!v) throw C.NotFound();
  const ua = get('SELECT * FROM university_applications WHERE application_id = ?', v.application_id); if (!ua) throw C.NotFound(); loadUA(req, ua.id);
  res.setHeader('Content-Type', v.mime_type); res.setHeader('Content-Disposition', `${d === 'attachment' ? 'attachment' : 'inline'}; filename="${String(v.stored_name).replace(/"/g, '')}"`); res.setHeader('Cache-Control', 'private, no-store');
  VAULT.pipe(files.filePath(v.file_key), res);
}));
r.post('/applications/:id/documents/zip', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id); if (!canSeeDocs(req) || !req.uni.zip_download || accessEnded(ua)) throw C.NotFound();
  const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id); const st = get('SELECT * FROM students WHERE id = ?', a.student_id);
  const shares = all(`SELECT * FROM uni_doc_shares WHERE uapp_id = ? AND status NOT IN ('Revoked','Expired')`, ua.id);
  if (!shares.length) throw bad('No shared documents yet');
  downloadGuard(req);
  const dir = path.join(DATA_DIR, 'exports', 'uni', ua.university_id); fs.mkdirSync(dir, { recursive: true });
  const key = `${uuid()}.zip`; const out = fs.createWriteStream(path.join(dir, key)); const z = new archiver.ZipArchive({ zlib: { level: 6 } }); z.pipe(out);
  for (const s of shares) { const v = get('SELECT * FROM document_versions WHERE id = ?', s.version_id); const dt = get('SELECT d.title, m.name FROM documents d JOIN master_items m ON m.id = d.document_type_id WHERE d.id = ?', s.document_id);
    const buf = req.uni.watermark ? await stamped(req, ua, v, a) : VAULT.read(files.filePath(v.file_key));
    z.append(buf, { name: `${a.application_code}_${String(dt.title || dt.name).replace(/[^A-Za-z0-9]+/g, '_')}_v${v.version_no}.${req.uni.watermark ? 'pdf' : path.extname(v.file_key).slice(1)}` }); logAccess(req, ua, s, v.id, 'zip'); }
  await z.finalize(); await new Promise(r0 => out.on('close', r0));
  VAULT.encryptInPlace(path.join(dir, key)); // the zip waits encrypted until it is downloaded
  const tok = files.sign('uz:' + key, req.uu.id, 'attachment');
  setTimeout(() => { try { fs.unlinkSync(path.join(dir, key)); } catch { /* */ } }, 3600e3).unref();
  res.json({ url: `/api/university/zip/${key}?` + new URL('http://x' + tok).searchParams.toString() + `&n=${encodeURIComponent(`${a.application_code} ${fullName(st)}`)}` });
}));
r.get('/zip/:key', ah(async (req, res) => {
  const { exp, d, sig } = req.query;
  if (!/^[0-9a-f-]+\.zip$/.test(req.params.key) || !files.verifySig('uz:' + req.params.key, req.uu.id, Number(exp) + 0, d, sig)) throw new U.HttpError(403, 'This link has expired.');
  const p = path.join(DATA_DIR, 'exports', 'uni', req.uu.university_id, req.params.key); if (!fs.existsSync(p)) throw C.NotFound();
  res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="${String(req.query.n || 'documents').replace(/[^A-Za-z0-9 -]/g, '')}.zip"`);
  VAULT.pipe(p, res);
}));
r.post('/applications/:id/documents/upload', files.upload.single('file'), ah(async (req, res) => {
  try {
    role(req, 'admin', 'officer'); const ua = loadUA(req, req.params.id);
    if (ua.status === 'Withdrawn') throw bad('This application was withdrawn by La Europa.');
    const type = ['University invoice (tuition)', 'Other university document'].includes(req.body.document_type) ? req.body.document_type : null;
    if (!type) throw U.fieldErr('document_type', 'Choose the document type');
    if (type === 'Other university document' && !clean(req.body.title)) throw U.fieldErr('title', 'Title is required');
    if (!req.file) throw U.fieldErr('file', 'Choose a file');
    if (type === 'University invoice (tuition)') pdfOnly(req.file);
    const { doc } = saveUniDoc(req, ua, req.file, type, { title: type === 'Other university document' ? clean(req.body.title, 150) : null, note: clean(req.body.note, 500) });
    C.uaudit(req, 'Upload', 'Document', doc.id, type); res.json({ ok: true });
  } catch (e) { files.cleanup(req.file); throw e; }
}));
r.delete('/applications/:id/documents/version/:vid', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id);
  const v = get(`SELECT v.*, d.status dstatus, d.staff_opened_at, d.current_version_id, d.id did FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND d.application_id = ? AND v.uploaded_by_type = 'university' AND v.uploaded_by = ?`, req.params.vid, ua.application_id, req.uu.id);
  if (!v) throw C.NotFound();
  if (v.removed_at || v.staff_opened_at || v.dstatus !== 'Uploaded' || v.current_version_id !== v.id) throw bad('This file is already being checked by La Europa and cannot be removed.');
  run('UPDATE document_versions SET removed_at = ? WHERE id = ?', now(), v.id);
  const prev = get('SELECT id FROM document_versions WHERE document_id = ? AND id != ? AND removed_at IS NULL ORDER BY version_no DESC LIMIT 1', v.did, v.id);
  run(`UPDATE documents SET current_version_id = ?, status = CASE WHEN ? IS NULL THEN 'Pending' ELSE status END WHERE id = ?`, prev ? prev.id : null, prev ? prev.id : null, v.did);
  C.uaudit(req, 'Delete', 'DocumentVersion', v.id, 'University removed own upload'); res.json({ ok: true });
}));

// ---------- messages (8) ----------
function msgOut(m, viewerUniId) {
  const att = all('SELECT id, original_name, mime_type, size_bytes FROM uni_message_attachments WHERE message_id = ?', m.id);
  const sender = m.sender_type === 'university' ? (get('SELECT name FROM uni_users WHERE id = ?', m.sender_uni_user_id) || {}).name : (get('SELECT name FROM users WHERE id = ?', m.sender_user_id) || {}).name;
  return { id: m.id, mine: m.sender_type === 'university', side: m.sender_type === 'university' ? 'University' : 'La Europa Education', sender, body: m.deleted_at ? null : m.body, deleted: !!m.deleted_at, edited: !!m.edited_at,
    sent_at: m.sent_at, seen: m.sender_type === 'university' ? m.seen_by_le_at : m.seen_by_uni_at, context: m.context_type ? { type: m.context_type, id: m.context_id } : null, attachments: m.deleted_at ? [] : att,
    can_edit: m.sender_type === 'university' && m.sender_uni_user_id === viewerUniId && !m.deleted_at && Date.now() - new Date(m.sent_at) < 15 * 60000 };
}
function postMessage(req, ua, body, contextType, contextId, attachments = []) {
  const id = uuid();
  insert('uni_messages', { id, uapp_id: ua ? ua.id : null, university_id: req.uu.university_id, sender_type: 'university', sender_uni_user_id: req.uu.id, body, context_type: contextType || null, context_id: contextId || null, sent_at: now() });
  for (const f of attachments) { const ext = path.extname(f.originalname).slice(1).toLowerCase(); const key = `umsg_${uuid()}.${ext}`; VAULT.moveIn(f.path, files.filePath(key));
    insert('uni_message_attachments', { id: uuid(), message_id: id, file_key: key, original_name: f.originalname, mime_type: f.mimetype, size_bytes: f.size }); }
  // La Europa side notifications (8.4)
  if (ua) { const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id); for (const h of C.handlers(a)) notify(h, 'university', `${C.uniName(req.uni)}: new message on ${a.application_code}`, `#/students/${a.student_id}/applications`); }
  else { const ids = [req.uni.partner_manager_id, ...U.admins()]; for (const h of new Set(ids.filter(Boolean))) notify(h, 'university', `${C.uniName(req.uni)}: new message in the General thread`, '#/university-messages'); }
  return id;
}
const MSG_TYPES = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xlsx', 'csv'];
function checkAttachments(list) {
  if (list.length > 5) throw bad('Maximum 5 attachments');
  const sigs = { doc: (b) => b.slice(0, 4).toString('hex') === 'd0cf11e0', docx: (b) => b[0] === 0x50 && b[1] === 0x4b, xlsx: (b) => b[0] === 0x50 && b[1] === 0x4b, csv: (b) => !b.includes(0) };
  for (const f of list) {
    const ext = path.extname(f.originalname).slice(1).toLowerCase();
    if (!MSG_TYPES.includes(ext)) throw bad(`"${f.originalname}": allowed files are PDF, JPG, PNG, DOC, DOCX, XLSX, CSV`);
    if (f.size > 10 * 1024 * 1024) throw bad(`"${f.originalname}" is larger than 10 MB`);
    if (files.TYPES[ext]) files.checkFile({ ...f }, [ext], 10);
    else { const head = Buffer.alloc(8); const fd = fs.openSync(f.path, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd); if (!sigs[ext](head)) throw bad(`"${f.originalname}" is not a real ${ext.toUpperCase()} file`); }
  }
}
r.get('/messages', ah(async (req, res) => { // inbox (UP11)
  const [w, p] = scopeSql(req);
  const threads = all(`SELECT ua.* FROM university_applications ua WHERE ${w} AND EXISTS (SELECT 1 FROM uni_messages m WHERE m.uapp_id = ua.id)`, ...p).map(ua => {
    const last = get('SELECT * FROM uni_messages WHERE uapp_id = ? AND deleted_at IS NULL ORDER BY sent_at DESC LIMIT 1', ua.id);
    const v = C.appView(ua);
    return { uapp_id: ua.id, application_code: v.application_code, student_name: v.student_name, course: v.course, intake: v.intake, unread: unreadFor(ua), last_at: last ? last.sent_at : null, last_text: last ? String(last.body || 'Attachment').slice(0, 90) : '', waiting: last && last.sender_type === 'university' };
  });
  const g = get(`SELECT * FROM uni_messages WHERE university_id = ? AND uapp_id IS NULL AND deleted_at IS NULL ORDER BY sent_at DESC LIMIT 1`, req.uu.university_id);
  threads.unshift({ uapp_id: 'general', application_code: 'General', student_name: 'Partner topics with La Europa', unread: get(`SELECT COUNT(*) c FROM uni_messages WHERE university_id = ? AND uapp_id IS NULL AND sender_type = 'staff' AND seen_by_uni_at IS NULL`, req.uu.university_id).c,
    last_at: g ? g.sent_at : null, last_text: g ? String(g.body || 'Attachment').slice(0, 90) : '', waiting: g && g.sender_type === 'university' });
  let rows = threads; if (req.query.unread === '1') rows = rows.filter(t => t.unread); if (req.query.waiting === '1') rows = rows.filter(t => t.waiting);
  res.json({ rows: rows.sort((a, b) => (a.uapp_id === 'general' ? -1 : 0) || String(b.last_at || '').localeCompare(String(a.last_at || ''))) });
}));
function threadOf(req, id) { if (id === 'general') return null; return loadUA(req, id); }
r.get('/messages/:id', ah(async (req, res) => {
  const ua = threadOf(req, req.params.id);
  if (ua && accessEnded(ua)) return res.json({ rows: [], access_ended: true });
  const where = ua ? ['uapp_id = ?', ua.id] : ['uapp_id IS NULL AND university_id = ?', req.uu.university_id];
  const rows = all(`SELECT * FROM uni_messages WHERE ${where[0]} ORDER BY sent_at`, where[1]);
  if (!req.preview) run(`UPDATE uni_messages SET seen_by_uni_at = ? WHERE ${where[0]} AND sender_type = 'staff' AND seen_by_uni_at IS NULL`, now(), where[1]);
  res.json({ rows: rows.map(m => msgOut(m, req.uu.id)), can_post: req.uu.role !== 'viewer' && !req.preview && !(ua && ua.status === 'Withdrawn') });
}));
r.post('/messages/:id', files.upload.array('files', 5), ah(async (req, res) => {
  try {
    role(req, 'admin', 'officer'); UA.hit('umsg:' + req.uu.id, 30, 60000);
    const ua = threadOf(req, req.params.id);
    if (ua && (ua.status === 'Withdrawn' || accessEnded(ua))) throw bad('This thread is closed.');
    const body = String(req.body.body || '').replace(/<[^>]*>/g, '').trim().slice(0, 5000);
    const list = req.files || [];
    if (!body && !list.length) throw bad('Write a message or attach a file');
    checkAttachments(list);
    const id = postMessage(req, ua, body || null, req.body.context_type, req.body.context_id, list);
    C.uaudit(req, 'Create', 'UniversityMessage', id, ua ? 'Application thread' : 'General thread');
    res.json({ id });
  } catch (e) { (req.files || []).forEach(files.cleanup); throw e; }
}));
r.put('/messages/m/:mid', ah(async (req, res) => {
  const m = get('SELECT * FROM uni_messages WHERE id = ? AND university_id = ? AND sender_type = ? AND sender_uni_user_id = ?', req.params.mid, req.uu.university_id, 'university', req.uu.id);
  if (!m) throw C.NotFound();
  if (Date.now() - new Date(m.sent_at) > 15 * 60000) throw bad('Messages can be edited or deleted only within 15 minutes.');
  if (req.body.delete) run('UPDATE uni_messages SET deleted_at = ?, original_body = COALESCE(original_body, body) WHERE id = ?', now(), m.id);
  else { const b = String(req.body.body || '').replace(/<[^>]*>/g, '').trim().slice(0, 5000); if (!b) throw bad('Message cannot be empty'); run('UPDATE uni_messages SET original_body = COALESCE(original_body, body), body = ?, edited_at = ? WHERE id = ?', b, now(), m.id); }
  C.uaudit(req, req.body.delete ? 'Delete' : 'Update', 'UniversityMessage', m.id); res.json({ ok: true });
}));
r.get('/messages/attachment/:aid', ah(async (req, res) => {
  const at = get('SELECT a.*, m.university_id, m.uapp_id FROM uni_message_attachments a JOIN uni_messages m ON m.id = a.message_id WHERE a.id = ?', req.params.aid);
  if (!at || at.university_id !== req.uu.university_id) throw C.NotFound(); if (at.uapp_id) loadUA(req, at.uapp_id);
  res.setHeader('Content-Type', at.mime_type || 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename="${String(at.original_name).replace(/"/g, '')}"`); res.setHeader('Cache-Control', 'private, no-store');
  VAULT.pipe(files.filePath(at.file_key), res);
}));

// global search inside own applications only (5.1)
r.get('/search', ah(async (req, res) => {
  const t = String(req.query.q || '').trim().toLowerCase(); if (t.length < 2) return res.json([]);
  const [w, p] = scopeSql(req);
  res.json(all(`SELECT ua.* FROM university_applications ua WHERE ${w}`, ...p).map(x => C.appView(x)).filter(v => v.application_code.toLowerCase().includes(t) || v.student_name.toLowerCase().includes(t) || String(v.university_ref || '').toLowerCase().includes(t)).slice(0, 10));
}));

module.exports = r;
module.exports.loadUA = loadUA;
module.exports.accessEnded = accessEnded;
module.exports.closeRequestFlags = closeRequestFlags;
module.exports.msgOut = msgOut;
module.exports.MSG_TYPES = MSG_TYPES;
module.exports.checkAttachments = checkAttachments;
module.exports.REJECT_REASONS = REJECT_REASONS;
