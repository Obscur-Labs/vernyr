import { Router, type Response } from 'express';
import { Types } from 'mongoose';
import ExcelJS from 'exceljs';
import Student from '../models/Student';
import Course from '../models/Course';
import PortalAccount from '../models/PortalAccount';
import { getSetting } from '../models/Audit';
import { Application, StudentDocument, VisaCase } from '../models/Work';
import { MasterItem } from '../models/Master';
import { OfferLetter, UniAction, UniDocRequest, UniDocShare, UniMessage, UniversityApplication } from '../models/Partner';
import type { UniRequest } from '../middleware/university';
import { upload } from '../middleware/upload';
import { uploadBuffer } from '../config/cloudinary';
import { HttpError, bad, clean, fieldErr, fullName, handle, istDate, num } from '../services/crm';
import { fmtDate } from '../services/invoicePdf';
import { addVersion, checkFile, docFor, ALLOWED } from '../services/files';
import { notify, notifyAdmins } from '../services/tasks';
import { ul } from '../services/email';
import { staffEmail } from '../services/uemail';
import * as P from '../services/partner';
import * as A from '../services/uniActions';
import { accessEnded, filtered, loadUA, names, openReq, role, scope, unreadFor } from './uni';

/** The client's university portal API, part 2 (legacy/server/university/routes.js): applications inbox, detail and the decision actions. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const router = Router();
const h = (fn: (req: UniRequest, res: Response) => Promise<void>) => handle(fn as never);
const actor = (req: UniRequest): A.Actor => ({ su: { _id: req.su._id, name: req.su.name } });
const futureDate = (d?: string) => !!d && d >= istDate();
const REJECT_REASONS = ['Academic requirement not met', 'English requirement not met', 'Incomplete documents', 'Course full', 'Deadline passed', 'Profile not suitable for the course', 'Conditions not met', 'Other'];
function workingDaysSince(d: Date | string) { let t = new Date(d); let n = 0; const end = new Date(); while (t < end) { t = new Date(t.getTime() + 864e5); if (t <= end && ![0, 6].includes(t.getDay())) n++; } return n; }

/** a message from the university in an application thread (or the General thread), with La Europa told */
export async function postMessage(req: UniRequest, ua: Any | null, body: string, contextType?: string | null, contextId?: string | null, files: Express.Multer.File[] = []) {
  const attachments = [];
  for (const f of files) { const asset = await uploadBuffer(f, `university/${req.su.universityId}/messages`); attachments.push({ file: { url: asset.url, public_id: asset.publicId, resource_type: asset.resourceType }, original_name: f.originalname, mime_type: f.mimetype, size_bytes: f.size }); }
  const m = await UniMessage.create({ uapp_id: ua?._id, university_id: req.su.universityId, sender_type: 'university', sender_account_id: req.su._id, body, context_type: contextType || undefined, context_id: contextId || undefined, sent_at: new Date(), attachments });
  if (ua) { const a = (await Application.findById(ua.application_id).lean()) as Any; for (const x of await P.handlers(a)) await notify(x, 'university', `${P.uniName(req.uni)}: new message on ${a.application_code}`, `/students/${a.student_id}/applications`); }
  else { if (req.uni.partner_manager_id) await notify(req.uni.partner_manager_id, 'university', `${P.uniName(req.uni)}: new message in the General thread`, '/university-messages'); await notifyAdmins('university', `${P.uniName(req.uni)}: new message in the General thread`, '/university-messages'); }
  return String(m._id);
}
/** a university-uploaded file saved as a student document (status Uploaded, uploaded by the university) */
export async function saveUniDoc(req: UniRequest, ua: Any, file: Express.Multer.File, typeName: string, extra: { title?: string | null; note?: string } = {}) {
  const a = (await Application.findById(ua.application_id).lean()) as Any;
  const { ext } = checkFile(file, ['Other university document', 'University receipt'].includes(typeName) ? ALLOWED : ['pdf'], Math.min(25, Number((await getSetting('uni_max_file_mb')) || 10)));
  const t = await MasterItem.findOneAndUpdate({ type: 'document_type', name: typeName }, { $setOnInsert: { type: 'document_type', name: typeName, sort: 960 } }, { upsert: true, new: true });
  const doc = await docFor(a.student_id, t._id as Types.ObjectId, { title: extra.title ?? undefined, application_id: a._id });
  if (!doc.application_id) doc.application_id = a._id;
  const v = await addVersion(doc, file, ext, String(req.su._id), 'university', extra.note);
  for (const x of await P.handlers(a)) await notify(x, 'university', `${P.uniName(req.uni)} uploaded ${typeName}${extra.title ? ' (' + extra.title + ')' : ''} for ${a.application_code}`, `/students/${a.student_id}/applications`);
  return { doc, v };
}
const pdfOnly = (f?: Express.Multer.File) => { if (f && !/\.pdf$/i.test(f.originalname)) throw bad('Please upload a PDF file'); };
function moneyChecks(errors: Record<string, string>, b: Any, fields: [string, string, boolean][]) { for (const [k, label, req0] of fields) { const v = num(b[k]); if (req0 && (v == null || v < 0)) errors[k] = `${label} is required`; else if (v != null && v < 0) errors[k] = 'Must be 0 or more'; } }

// ---------- applications inbox (6.3) ----------
router.get('/applications', h(async (req, res) => {
  const q = req.query as Any;
  let rows = await filtered(req, q);
  if (q.status) { const st = String(q.status).split(','); rows = rows.filter((x) => st.includes(x.status)); }
  const ackDays = Number((await getSetting('uni_ack_days')) || 3);
  let out: Any[] = [];
  for (const x of rows) {
    out.push({ ...(await P.appView(x)), unread: await unreadFor(x._id), open_request: !!(await openReq(x._id)), answered: !!(await UniDocRequest.exists({ uapp_id: x._id, status: 'Fulfilled', opened_by_uni_at: null })),
      late: x.status === 'New' && workingDaysSince(x.submitted_at || x.createdAt) > ackDays });
  }
  if (q.q) { const t = String(q.q).toLowerCase(); out = out.filter((x) => String(x.application_code).toLowerCase().includes(t) || String(x.student_name).toLowerCase().includes(t) || String(x.university_ref || '').toLowerCase().includes(t)); }
  if (q.docreq === '1') out = out.filter((x) => x.open_request);
  if (q.answered === '1') out = out.filter((x) => x.answered);
  if (q.unread === '1') out = out.filter((x) => x.unread);
  if (q.pending_days) out = out.filter((x) => !['Rejected', 'Enrolled', 'Withdrawn', 'Offer accepted', 'Deposit received'].includes(x.status) && x.days_in_status > Number(q.pending_days));
  const sorts: Record<string, (a: Any, b: Any) => number> = { submitted: (a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)), days: (a, b) => b.days_in_status - a.days_in_status,
    intake: (a, b) => String(a.intake).localeCompare(String(b.intake)), student: (a, b) => String(a.student_name).localeCompare(String(b.student_name)) };
  out.sort(sorts[q.sort] || sorts.submitted); if (q.dir === 'asc') out.reverse();
  const size = [25, 50, 100].includes(Number(q.size)) ? Number(q.size) : 25; const page = Math.max(1, Number(q.page) || 1);
  res.json({ total: out.length, page, size, rows: out.slice((page - 1) * size, page * size), statuses: P.STATUSES });
}));
router.post('/applications/bulk-acknowledge', h(async (req, res) => {
  role(req, 'admin', 'officer');
  let n = 0;
  for (const id of (req.body?.ids || []).slice(0, 200)) { const ua = await loadUA(req, id); if (ua.status !== 'New') continue; await A.record(ua.toObject(), 'acknowledge', {}, actor(req), 'Acknowledged'); n++; }
  await P.uaudit(req, 'Update', 'UniversityApplication', null, `Bulk acknowledge (${n})`);
  res.json({ ok: true, count: n });
}));
router.get('/applications/export.xlsx', h(async (req, res) => {
  if (req.su.uniRole === 'viewer' && !req.uni.viewer_exports) throw new HttpError(403, 'Exports are not available for your role.');
  let rows = await filtered(req, req.query);
  if (req.query.ids) { const ids = String(req.query.ids).split(','); rows = rows.filter((x) => ids.includes(String(x._id))); }
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Applications');
  ws.columns = ([['Application ID', 'application_code', 18], ['Student name', 'student_name', 26], ['Course', 'course', 34], ['Level', 'level', 10], ['Campus', 'campus', 14], ['Intake', 'intake', 12],
    ['Submitted on', 'submitted', 14], ['Status', 'status', 18], ['Days in status', 'days_in_status', 8], ['University reference', 'university_ref', 16], ['State', 'state', 14]] as [string, string, number][]).map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  for (const x of rows) { const v = await P.appView(x); ws.addRow({ ...v, submitted: v.submitted_at ? fmtDate(v.submitted_at) : '' }); }
  await P.uaudit(req, 'Export', 'UniversityApplication', null, `Applications export (${rows.length} rows)`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="applications.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

// ---------- application detail (6.4) ----------
async function timelineOf(ua: Any) {
  const N = await names();
  const ev: Any[] = [{ at: ua.submitted_at, text: 'Submitted by La Europa' }];
  for (const x of (await UniAction.find({ uapp_id: ua._id }).sort({ createdAt: 1 }).lean()) as Any[]) {
    const who = x.by_account_id ? (await PortalAccount.findById(x.by_account_id).select('name').lean())?.name : 'La Europa';
    ev.push({ at: x.createdAt, text: `${A.DECISION_LABEL[x.type] || x.type}${x.to_status && x.to_status !== x.from_status ? ` (status: ${x.to_status})` : ''}`, by: who, received: ['Applied', 'Applied without notifying', 'Info'].includes(x.processing) || !!x.processed_at });
  }
  const types = new Map((await MasterItem.find({ type: 'document_type' }).select('name').lean()).map((t: Any) => [String(t._id), t.name]));
  for (const s of (await UniDocShare.find({ uapp_id: ua._id }).sort({ shared_at: 1 }).lean()) as Any[]) {
    const d = (await StudentDocument.findById(s.document_id).select('document_type_id title').lean()) as Any;
    const name = d?.title || types.get(String(d?.document_type_id)) || 'Document';
    ev.push({ at: s.shared_at, text: `Document shared by La Europa: ${name}` });
    if (s.revoked_at) ev.push({ at: s.revoked_at, text: `Document removed by La Europa: ${name}` });
  }
  for (const q of (await UniDocRequest.find({ uapp_id: ua._id }).lean()) as Any[]) { ev.push({ at: q.createdAt, text: 'Documents requested from La Europa' }); if (q.answered_at) ev.push({ at: q.answered_at, text: `La Europa answered the document request (${q.status})` }); }
  const m = await UniMessage.countDocuments({ uapp_id: ua._id, deleted_at: null }); if (m) ev.push({ at: new Date(), text: `${m} message(s) in the thread`, info: true });
  if (ua.withdrawn_at) ev.push({ at: ua.withdrawn_at, text: 'Withdrawn by La Europa' });
  void N;
  return ev.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
async function requestsOf(uaId: unknown) {
  const types = new Map((await MasterItem.find({ type: 'document_type' }).select('name').lean()).map((t: Any) => [String(t._id), t.name]));
  return ((await UniDocRequest.find({ uapp_id: uaId }).sort({ createdAt: -1 }).lean()) as Any[]).map((q) => ({ id: String(q._id), message: q.message, needed_by: q.needed_by, status: q.status, created_at: q.createdAt, answered_at: q.answered_at,
    items: (q.items ?? []).map((i: Any) => ({ id: String(i._id), document_type_id: i.document_type_id ? String(i.document_type_id) : null, title: i.title, note: i.note, status: i.status, reply: i.reply, name: i.title || types.get(String(i.document_type_id)) || 'Document' })) }));
}
function allowedActions(req: UniRequest, ua: Any) {
  if (req.su.uniRole === 'viewer' || req.preview || ua.status === 'Withdrawn') return [];
  const s = ua.status; const out: string[] = []; const can = (to: string) => P.canMove(s, to);
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
  if (req.su.uniRole === 'admin') out.push('correction');
  out.push('upload', 'reference');
  return out;
}
router.get('/applications/:id', h(async (req, res) => {
  const ua = (await loadUA(req, req.params.id)).toObject() as Any;
  const base = await P.appView(ua);
  await P.uaudit(req, 'View', 'UniversityApplication', ua._id, base.application_code);
  if (await accessEnded(ua, req.uni)) { res.json({ id: base.id, application_code: base.application_code, course: base.course, intake: base.intake, status: base.status, access_ended: true }); return; }
  const v = await P.appView(ua, { detail: true });
  await UniDocRequest.updateMany({ uapp_id: ua._id, status: 'Fulfilled', opened_by_uni_at: null }, { opened_by_uni_at: new Date() });
  res.json({ ...v, timeline: await timelineOf(ua), allowed: allowedActions(req, ua), requests: await requestsOf(ua._id), unread: await unreadFor(ua._id),
    contact_note: req.uni.share_contact ? null : 'Student contact details are managed by La Europa. Please message La Europa for anything you need from the student.',
    received: ((await UniAction.find({ uapp_id: ua._id }).sort({ createdAt: -1 }).limit(20).lean()) as Any[]).map((x) => ({ id: String(x._id), type: x.type, created_at: x.createdAt, label: A.DECISION_LABEL[x.type], received: !['Pending review', 'Held'].includes(x.processing) })),
    reject_reasons: REJECT_REASONS,
    courses: ((await Course.find({ university_id: req.su.universityId, is_deleted: false, uni_status: { $ne: 'Inactive' } }).select('name level').lean()) as Any[]).map((c) => ({ id: String(c._id), name: c.name, level: c.level })) });
}));
router.put('/applications/:id/reference', h(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = await loadUA(req, req.params.id);
  const ref = clean(req.body?.university_ref, 50);
  ua.university_ref = ref || undefined; ua.updated_by_type = 'university'; await ua.save();
  await Application.updateOne({ _id: ua.application_id }, { university_app_id: ref || undefined });
  await P.uaudit(req, 'Update', 'UniversityApplication', ua._id, `University reference ${ref || '(cleared)'}`); res.json({ ok: true });
}));

// ---------- actions (6.5) ----------
type Def = { roles: string[]; to: (ua: Any, b: Any) => string | null; check?: (ua: Any, req: UniRequest) => boolean; run: (req: UniRequest, ua: Any, b: Any, file?: Express.Multer.File) => Promise<Any> };
async function offerLetter(req: UniRequest, ua: Any, file: Express.Multer.File, type: string, issueDate?: string, pendingId?: unknown) {
  const { doc, v } = await saveUniDoc(req, ua, file, 'Offer letter');
  // offer letters from the university are authentic by source
  const ver = doc.versions.find((x) => String(x._id) === v.id); if (ver) ver.version_status = 'Verified';
  doc.status = 'Verified'; doc.verified_at = new Date(); await doc.save();
  if (pendingId) { await OfferLetter.updateOne({ _id: pendingId }, { document_id: doc._id, version_id: v.id, issue_date: issueDate || istDate(), type }); return String(pendingId); }
  return String((await OfferLetter.create({ uapp_id: ua._id, application_id: ua.application_id, type, document_id: doc._id, version_id: v.id, issue_date: issueDate || istDate() }))._id);
}
async function offer(req: UniRequest, ua: Any, b: Any, file: Express.Multer.File | undefined, conditional: boolean) {
  const errors: Record<string, string> = {};
  const follow = b.letter_to_follow === true || b.letter_to_follow === 'true';
  if (!file && !follow) errors.file = 'Upload the offer letter (PDF) or tick "Offer letter to follow"';
  if (follow && !b.letter_date) errors.letter_date = 'When will the letter follow?';
  const conds = conditional ? (Array.isArray(b.conditions) ? b.conditions : []).filter((c: Any) => c && clean(c.text)) : [];
  if (conditional && !conds.length) errors.conditions = 'Add at least one condition';
  moneyChecks(errors, b, [['tuition', 'Tuition fee for first year', true], ['scholarship', 'Scholarship', false], ['deposit', 'Deposit', false]]);
  if (!b.currency) errors.currency = 'Currency is required';
  if (b.acceptance_deadline && !futureDate(b.acceptance_deadline)) errors.acceptance_deadline = 'Must be a future date';
  Object.assign(errors, P.feeWordCheck({ scholarship_text: b.scholarship_text, note: b.note }));
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  let letter: string;
  if (file) { pdfOnly(file); letter = await offerLetter(req, ua, file, conditional ? 'Conditional' : 'Unconditional', b.issue_date); }
  else letter = String((await OfferLetter.create({ uapp_id: ua._id, application_id: ua.application_id, type: conditional ? 'Conditional' : 'Unconditional', issue_date: b.letter_date }))._id);
  if (clean(b.note)) await postMessage(req, ua, clean(b.note, 1000)!, 'action');
  return { conditions: conds.map((c: Any) => ({ text: clean(c.text, 500), type: c.type || 'Other', due: c.due || null })), acceptance_deadline: b.acceptance_deadline || null, tuition: num(b.tuition), currency: b.currency,
    scholarship: num(b.scholarship), scholarship_text: clean(b.scholarship_text, 200), deposit: num(b.deposit), deposit_currency: b.currency, deposit_deadline: b.deposit_deadline || null,
    programme_start: b.programme_start || null, letter_to_follow: follow, letter };
}
const ACT: Record<string, Def> = {
  acknowledge: { roles: ['admin', 'officer'], to: () => 'Acknowledged', check: (ua) => ua.status === 'New', async run(req, ua, b) {
    if (b.expected_decision && !futureDate(b.expected_decision)) throw fieldErr('expected_decision', 'Expected decision date must be in the future');
    const ref = clean(b.reference, 50);
    await UniversityApplication.updateOne({ _id: ua._id }, { university_ref: ref || ua.university_ref, expected_decision: b.expected_decision || null });
    if (ref) await Application.updateOne({ _id: ua.application_id }, { university_app_id: ref });
    if (clean(b.note)) await postMessage(req, ua, clean(b.note, 1000)!, 'action');
    return { reference: ref, expected_decision: b.expected_decision || null };
  } },
  under_assessment: { roles: ['admin', 'officer'], to: () => 'Under assessment', run: async () => ({}) },
  doc_request: { roles: ['admin', 'officer'], to: () => 'Documents requested', check: (ua) => !['Offer accepted', 'Deposit received', 'Enrolled', 'Rejected', 'Withdrawn'].includes(ua.status), async run(req, ua, b) {
    const items = (Array.isArray(b.items) ? b.items : []).filter((i: Any) => i && (i.document_type_id || clean(i.title)));
    if (!items.length) throw fieldErr('items', 'Add at least one document');
    if (!clean(b.message)) throw fieldErr('message', 'Message to La Europa is required');
    if (b.needed_by && !futureDate(b.needed_by)) throw fieldErr('needed_by', 'Must be a future date');
    const types = new Map((await MasterItem.find({ type: 'document_type' }).select('name').lean()).map((t: Any) => [String(t._id), t.name]));
    const q = await UniDocRequest.create({ uapp_id: ua._id, university_id: ua.university_id, message: clean(b.message, 2000), needed_by: b.needed_by || undefined, pause: b.pause !== false, status: 'Open', prev_status: ua.status, created_by: req.su._id,
      items: items.map((i: Any) => ({ document_type_id: i.document_type_id || undefined, title: clean(i.title, 150), note: clean(i.note, 300), status: 'Open' })) });
    await UniversityApplication.updateOne({ _id: ua._id }, { flag_docs_requested: true });
    const a = (await Application.findById(ua.application_id).lean()) as Any; const s = (await Student.findById(a.student_id).lean()) as Any;
    await Application.updateOne({ _id: a._id }, { uni_flag: 'Documents requested by university' });
    const list = items.map((i: Any) => `${i.title || types.get(String(i.document_type_id)) || 'Document'}${i.note ? ' (' + i.note + ')' : ''}`);
    const hs = await P.handlers(a);
    for (const x of hs) await notify(x, 'university', `${P.uniName(req.uni)} requested documents for ${fullName(s)} (${a.application_code})`, `/students/${s._id}/applications`);
    await staffEmail('E44', hs, { university_id: ua.university_id, ctx: { student_name: fullName(s), student_id: s.student_code, application_code: a.application_code, documents_list: ul(list),
      university_message: clean(b.message, 2000), due_date: b.needed_by ? fmtDate(b.needed_by) : 'not given' } });
    return { request_id: String(q._id), items: list };
  } },
  interview: { roles: ['admin', 'officer'], to: () => 'Interview scheduled', async run(req, ua, b) {
    const errors: Record<string, string> = {};
    if (!b.at || new Date(b.at) < new Date()) errors.at = 'Interview date and time must be in the future';
    if (!['Online video', 'Phone', 'In person', 'Written / online test'].includes(b.mode)) errors.mode = 'Choose the mode';
    if (['Online video', 'In person'].includes(b.mode) && !clean(b.link)) errors.link = 'Link or address is required';
    if (b.mode === 'Online video' && b.link && !/^https:\/\//i.test(b.link)) errors.link = 'Links must start with https://';
    if (b.duration && ((num(b.duration) ?? 0) < 10 || (num(b.duration) ?? 0) > 240)) errors.duration = '10 to 240 minutes';
    if (ua.status === 'Interview scheduled' && !clean(b.reason)) errors.reason = 'Reason for rescheduling is required';
    if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
    if (clean(b.note)) await postMessage(req, ua, clean(b.note, 1000)!, 'action');
    return { at: new Date(b.at).toISOString(), mode: b.mode, link: clean(b.link, 300), duration: num(b.duration), instructions: clean(b.instructions, 1000), timezone: clean(b.timezone, 60), rescheduled: ua.status === 'Interview scheduled', reason: clean(b.reason, 300) };
  } },
  interview_result: { roles: ['admin', 'officer'], to: () => null, check: (ua) => ua.status === 'Interview scheduled', async run(req, ua, b, file) {
    if (!['Passed', 'Not passed', 'Pending', 'No show'].includes(b.result)) throw fieldErr('result', 'Choose the result');
    let doc: string | null = null; if (file) { pdfOnly(file); doc = String((await saveUniDoc(req, ua, file, 'Interview result', { note: clean(b.feedback, 500) })).doc._id); }
    return { result: b.result, feedback: clean(b.feedback, 1000), document_id: doc };
  } },
  conditional_offer: { roles: ['admin', 'officer'], to: () => 'Conditional offer', run: (req, ua, b, file) => offer(req, ua, b, file, true) },
  unconditional_offer: { roles: ['admin', 'officer'], to: () => 'Unconditional offer', run: (req, ua, b, file) => offer(req, ua, b, file, false) },
  conditions_met: { roles: ['admin', 'officer'], to: () => 'Unconditional offer', check: (ua) => ua.status === 'Conditional offer', async run(req, ua, b, file) {
    const conds = Array.isArray(b.conditions) ? b.conditions : [];
    let letter: string | null = null; if (file) { pdfOnly(file); letter = await offerLetter(req, ua, file, 'Unconditional', b.issue_date); }
    return { conditions: conds.map((c: Any) => ({ id: c.id, result: c.result === 'Waived' ? 'Waived' : 'Met' })), letter };
  } },
  reject: { roles: ['admin', 'officer'], to: () => 'Rejected', async run(req, ua, b) {
    if (!REJECT_REASONS.includes(b.reason)) throw fieldErr('reason', 'Choose a reason');
    if (b.reason === 'Other' && !clean(b.details)) throw fieldErr('details', 'Details are required for Other');
    if (ua.status === 'Conditional offer' && b.reason !== 'Conditions not met' && !clean(b.details)) throw fieldErr('details', 'Please explain why the conditional offer is withdrawn');
    await UniversityApplication.updateOne({ _id: ua._id }, { reject_reason: b.reason });
    const sc = b.suggest_course_id ? ((await Course.findOne({ _id: b.suggest_course_id, university_id: ua.university_id }).select('name').lean()) as Any) : null;
    return { reason: b.reason, details: clean(b.details, 1000), share_reason: b.share_reason === true || b.share_reason === 'true', suggest_course_id: sc ? String(sc._id) : null, suggest_course: sc?.name ?? null };
  } },
  waitlist: { roles: ['admin', 'officer'], to: () => 'Waitlisted', async run(_req, ua, b) {
    if (!clean(b.note)) throw fieldErr('note', 'Reason / note to La Europa is required');
    if (b.expected_decision && !futureDate(b.expected_decision)) throw fieldErr('expected_decision', 'Must be a future date');
    await UniversityApplication.updateOne({ _id: ua._id }, { expected_decision: b.expected_decision || null });
    return { note: clean(b.note, 1000), expected_decision: b.expected_decision || null, position: num(b.position) };
  } },
  offer_letter: { roles: ['admin', 'officer'], to: () => null, check: (ua) => ['Conditional offer', 'Unconditional offer'].includes(ua.status), async run(req, ua, b, file) {
    if (!file) throw fieldErr('file', 'Choose the offer letter (PDF)'); pdfOnly(file);
    if (!['Conditional', 'Unconditional', 'Revised'].includes(b.letter_type)) throw fieldErr('letter_type', 'Choose the letter type');
    const pending0 = await OfferLetter.findOne({ uapp_id: ua._id, document_id: null }).sort({ createdAt: -1 }).lean();
    return { letter: await offerLetter(req, ua, file, b.letter_type, b.issue_date, pending0?._id), letter_type: b.letter_type, note: clean(b.note, 500) };
  } },
  deposit: { roles: ['admin', 'officer'], to: () => 'Deposit received', check: (ua) => ua.status === 'Offer accepted', async run(req, ua, b, file) {
    const errors: Record<string, string> = {}; moneyChecks(errors, b, [['amount', 'Amount received', true], ['balance', 'Remaining balance', false]]);
    if (num(b.amount) !== null && (num(b.amount) ?? 0) <= 0) errors.amount = 'Must be more than 0';
    if (!b.date || b.date > istDate()) errors.date = 'Date received is required and cannot be in the future';
    if (!b.currency) errors.currency = 'Currency is required';
    if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
    const doc = file ? String((await saveUniDoc(req, ua, file, 'University receipt')).doc._id) : null;
    await UniversityApplication.updateOne({ _id: ua._id }, { deposit_amount: num(b.amount), deposit_currency: b.currency, deposit_date: b.date });
    setImmediate(() => { A.upsertCommission(ua._id, 'deposit').catch((e) => console.error('[commission]', e.message)); });
    return { amount: num(b.amount), currency: b.currency, date: b.date, reference: clean(b.reference, 100), balance: num(b.balance), document_id: doc };
  } },
  enrolled: { roles: ['admin', 'officer'], to: () => 'Enrolled', check: (ua, req) => ua.status === 'Deposit received' || (ua.status === 'Offer accepted' && !!req.uni.enrol_from_accepted), async run(req, ua, b, file) {
    const errors: Record<string, string> = {};
    if (!b.enrol_date || b.enrol_date > istDate()) errors.enrol_date = 'Enrolment date is required and cannot be in the future';
    if (!b.programme_start) errors.programme_start = 'Programme start date is required';
    moneyChecks(errors, b, [['final_tuition', 'Final first-year tuition fee', true], ['scholarship', 'Scholarship', false]]);
    if (!b.currency) errors.currency = 'Currency is required';
    if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
    let doc: string | null = null; if (file) { pdfOnly(file); doc = String((await saveUniDoc(req, ua, file, 'Enrolment confirmation')).doc._id); }
    await UniversityApplication.updateOne({ _id: ua._id }, { enrol_date: b.enrol_date, programme_start: b.programme_start, student_uni_id: clean(b.student_uni_id, 50), final_tuition: num(b.final_tuition), final_currency: b.currency, scholarship_amount: num(b.scholarship) });
    return { enrol_date: b.enrol_date, programme_start: b.programme_start, student_uni_id: clean(b.student_uni_id, 50), final_tuition: num(b.final_tuition), currency: b.currency, scholarship: num(b.scholarship), document_id: doc };
  } },
  cas: { roles: ['admin', 'officer'], to: () => null, check: (ua) => ['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(ua.status), async run(req, ua, b, file) {
    let types = ['Acceptance / admission letter for visa', 'CAS', 'Pre-enrolment or visa support letter', 'JW201 / JW202 (China)', 'Other'];
    try { const t = JSON.parse(String((await getSetting('uni_letter_types')) || 'null')); if (Array.isArray(t)) types = t; } catch { /* default list */ }
    if (!types.includes(b.letter_type)) throw fieldErr('letter_type', 'Choose the letter type');
    if (!file) throw fieldErr('file', 'Choose the file (PDF)'); pdfOnly(file);
    const { doc } = await saveUniDoc(req, ua, file, 'Acceptance letter for visa', { title: null, note: [b.letter_type, b.reference, b.valid_until ? 'valid until ' + b.valid_until : ''].filter(Boolean).join(', ') });
    const a = (await Application.findById(ua.application_id).lean()) as Any;
    const vc = await VisaCase.findOne({ student_id: a.student_id, is_open: true, is_deleted: false }).sort({ createdAt: -1 }).select('_id').lean();
    if (vc && !doc.visa_case_id) { doc.visa_case_id = vc._id as Types.ObjectId; await doc.save(); }
    return { letter_type: b.letter_type, reference: clean(b.reference, 100), issue_date: b.issue_date || null, valid_until: b.valid_until || null, document_id: String(doc._id) };
  } },
  correction: { roles: ['admin'], to: (_ua, b) => b.status, check: () => true, async run(_req, ua, b) {
    if (!P.STATUSES.includes(b.status) || ['New', 'Withdrawn', 'Offer accepted'].includes(b.status)) throw fieldErr('status', 'Choose the correct status');
    if (!clean(b.reason)) throw fieldErr('reason', 'Reason is required');
    return { status: b.status, reason: clean(b.reason, 1000), previous: ua.status };
  } },
};
router.post('/applications/:id/actions/:type', upload.single('file'), h(async (req, res) => {
  const def = ACT[req.params.type];
  if (!def) throw P.NotFound();
  const ua = (await loadUA(req, req.params.id)).toObject() as Any;
  if (!def.roles.includes(String(req.su.uniRole))) throw new HttpError(403, 'Your role does not allow this action.');
  if (ua.status === 'Withdrawn') throw bad(`Withdrawn by La Europa on ${fmtDate(ua.withdrawn_at)}. This application is read-only.`);
  if (await accessEnded(ua, req.uni)) throw bad('Access period ended for this application.');
  // optimistic locking (6.7)
  if (req.body?.version !== undefined && Number(req.body.version) !== Number(ua.version)) {
    const last = (await UniAction.findOne({ uapp_id: ua._id }).sort({ createdAt: -1 }).lean()) as Any;
    const who = last ? (last.by_account_id ? (await PortalAccount.findById(last.by_account_id).select('name').lean())?.name : 'La Europa') : 'someone';
    throw new HttpError(409, `This application was updated by ${who} a moment ago. Please refresh.`);
  }
  const b: Any = { ...req.body };
  for (const k of ['items', 'conditions']) if (typeof b[k] === 'string') { try { b[k] = JSON.parse(b[k]); } catch { b[k] = []; } }
  const to = def.to(ua, b);
  if (def.check ? !def.check(ua, req) : to && !P.canMove(ua.status, to)) throw bad('This action is not allowed in the current status.');
  let file = req.file;
  const type = req.params.type;
  if (!file && (b.generate === true || b.generate === 'true') && ['conditional_offer', 'unconditional_offer', 'offer_letter', 'conditions_met'].includes(type)) {
    if (['conditional_offer', 'unconditional_offer'].includes(type) && num(b.tuition) === null) throw fieldErr('tuition', 'Tuition fee for first year is required');
    const L = await import('../services/uniLetters');
    file = await L.offerPdfFile(req, ua, b, type === 'conditions_met' ? 'unconditional_offer' : type === 'offer_letter' ? (b.letter_type === 'Conditional' ? 'conditional_offer' : 'unconditional_offer') : type);
    b.letter_to_follow = false;
  }
  const data = await def.run(req, ua, b, file);
  if (data?.letter) await (await import('./uniDirect')).pushOffer(req, ua, data.letter).catch(() => {});
  const fresh = (await UniversityApplication.findById(ua._id).lean()) as Any;
  const rec = await A.record(fresh, req.params.type, data, actor(req), to);
  if (req.params.type === 'enrolled' || (req.params.type === 'correction' && (['Enrolled', 'Deposit received'].includes(data.status) || data.previous === 'Enrolled')))
    setImmediate(() => { A.upsertCommission(ua._id, 'enrolled').catch((e) => console.error('[commission]', e.message)); });
  await P.uaudit(req, 'Action', 'UniversityApplication', ua._id, `${A.DECISION_LABEL[req.params.type]} (${ua.status} -> ${to || ua.status})`, { status: ua.status }, { status: to || ua.status, data });
  res.json({ ok: true, action_id: rec.id, status: ((await UniversityApplication.findById(ua._id).select('status').lean()) as Any)?.status });
}));

export default router;
void scope;
