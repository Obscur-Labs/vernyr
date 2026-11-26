import { Router, type Response } from 'express';
import Student from '../models/Student';
import Course from '../models/Course';
import PortalAccount from '../models/PortalAccount';
import University from '../models/University';
import { Application, StudentDocument, VisaCase } from '../models/Work';
import { Intake, MasterItem } from '../models/Master';
import { OfferLetter, UniStudentItem, UniversityApplication } from '../models/Partner';
import type { UniRequest } from '../middleware/university';
import type { PortalRequest } from '../middleware/portal';
import { authenticate, staffOnly, type AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { HttpError, bad, clean, fieldErr, fullName, handle, oid, timeline } from '../services/crm';
import { addVersion, checkFile, docFor, fileUrl } from '../services/files';
import { notify } from '../services/tasks';
import { sendSecurity, studentNotify } from '../services/email';
import { env } from '../config/env';
import * as CONSENT from '../services/consent';
import * as P from '../services/partner';
import { loadUA } from './uni';

/** The client's university to student, directly (legacy/server/university/direct.js): offer letters, documents, agreements and messages sent to the student, always with a copy for La Europa. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
export const KIND: Record<string, string> = { offer_letter: 'Offer letter', loa: 'Final Letter of Acceptance', invoice: 'Tuition fee invoice', receipt: 'Fee payment receipt', agreement: 'Agreement', document: 'Document', message: 'Message' };
const uniLabel = (u?: Any | null) => (u && (u.display_name || u.name)) || 'Your university';
async function ctxOf(ua: Any) {
  const a = (await Application.findById(ua.application_id).lean()) as Any;
  const s = a ? ((await Student.findById(a.student_id).lean()) as Any) : null;
  return { a, s };
}
const suOf = (s: Any) => PortalAccount.findOne({ role: 'student', $or: [{ studentId: s._id }, ...(s.lead_id ? [{ leadId: s.lead_id }] : [])], status: { $ne: 'Deactivated' } }).sort({ createdAt: 1 }).select('_id').lean();

/** tell the student (portal and email) and give La Europa a copy */
export async function fanOut(ua: Any, item: Any, uni: Any) {
  const { a, s } = await ctxOf(ua); if (!s) return;
  const what = item.kind === 'message' ? 'sent you a message' : `sent you ${item.kind === 'invoice' ? 'a tuition fee invoice' : item.kind === 'receipt' ? 'a fee payment receipt' : item.kind === 'loa' ? 'your final Letter of Acceptance (for the visa)' : item.kind === 'agreement' ? 'an agreement' + (item.needs_acceptance ? ' to accept' : '') : item.kind === 'offer_letter' ? 'your offer letter' : 'a document'}`;
  const su = await suOf(s);
  if (su) await studentNotify(su._id, `${uniLabel(uni)} ${what}`, '/university');
  const course = (a.course_id && ((await Course.findById(a.course_id).select('name').lean()) as Any)?.name) || a.course_name_text || 'your course';
  if (s.email) await sendSecurity({ to: s.email, subject: `${uniLabel(uni)} ${what}`, text: `Hello ${s.first_name},\n\n${uniLabel(uni)} ${what} about your application (${course}).\nOpen your La Europa student portal to see it: ${env.portalUrl}/university\n\nLa Europa Education`, student_id: s._id }).catch(() => {});
  for (const x of await P.handlers(a)) await notify(x, 'university', `${uniLabel(uni)} ${what.replace('you', s.first_name)} (${a.application_code}): copy for La Europa`, `/students/${s._id}/applications`);
  await timeline({ student_id: s._id, type: 'university', description: `${uniLabel(uni)} ${what.replace('you', 'the student')}${item.title ? ': ' + item.title : ''} (direct to the student, copy for La Europa)` });
}
export async function addItem(req: { su?: Any } | null, ua: Any, o: Any) {
  const { a, s } = await ctxOf(ua);
  return UniStudentItem.create({ uapp_id: ua._id, application_id: a._id, student_id: s!._id, university_id: ua.university_id, kind: o.kind, title: o.title || undefined, body: o.body || undefined,
    document_id: o.document_id || undefined, version_id: o.version_id || undefined, amount: o.amount ?? undefined, currency: o.currency || undefined, due_date: o.due_date || undefined, ref_no: o.ref_no || undefined,
    needs_acceptance: !!o.needs_acceptance, status: 'Sent', sender_type: o.sender_type || 'university', sender_account_id: req?.su?._id });
}
/** a file from the university, stored as a verified student document (authentic by source) */
export async function saveDoc(req: UniRequest, ua: Any, file: Express.Multer.File, typeName: string, title?: string | null) {
  const { a } = await ctxOf(ua);
  const { ext } = checkFile(file, ['pdf', 'jpg', 'jpeg', 'png'], 25);
  const t = await MasterItem.findOneAndUpdate({ type: 'document_type', name: typeName }, { $setOnInsert: { type: 'document_type', name: typeName, sort: 960 } }, { upsert: true, new: true });
  const doc = await docFor(a._id ? a.student_id : undefined, t._id as never, { title: title ?? undefined, application_id: a._id });
  if (!doc.application_id) doc.application_id = a._id;
  const v = await addVersion(doc, file, ext, String(req.su._id), 'university');
  const ver = doc.versions.find((x) => String(x._id) === v.id); if (ver) ver.version_status = 'Verified';
  doc.status = 'Verified'; doc.verified_at = new Date(); await doc.save();
  return { doc, v };
}
/** after any offer letter (generated or uploaded) the student gets it directly */
export async function pushOffer(req: UniRequest, ua: Any, letterId: unknown) {
  const ol = letterId ? ((await OfferLetter.findById(letterId).lean()) as Any) : null;
  if (!ol?.document_id || (await UniStudentItem.exists({ kind: 'offer_letter', version_id: ol.version_id }))) return;
  const item = await addItem(req, ua, { kind: 'offer_letter', title: `${ol.type} offer letter`, document_id: ol.document_id, version_id: ol.version_id });
  await fanOut(ua, item, req.uni);
}
async function versionUrl(documentId: unknown, versionId: unknown) {
  const d = (await StudentDocument.findById(documentId).lean()) as Any;
  const v = d?.versions?.find((x: Any) => String(x._id) === String(versionId));
  return v ? fileUrl(v) : null;
}
const itemOut = async (x: Any) => ({ id: String(x._id), kind: x.kind, kind_label: KIND[x.kind], title: x.title ?? null, body: x.body ?? null, amount: x.amount ?? null, currency: x.currency ?? null, due_date: x.due_date ?? null,
  ref_no: x.ref_no ?? null, needs_acceptance: !!x.needs_acceptance, status: x.status, viewed_at: x.viewed_at ?? null, accepted_at: x.accepted_at ?? null, accepted_name: x.accepted_name ?? null,
  sender: x.sender_type === 'student' ? 'Student' : ((await PortalAccount.findById(x.sender_account_id).select('name').lean()) as Any)?.name || 'University', mine: x.sender_type === 'university', has_file: !!x.version_id, created_at: x.createdAt });

// ---------- university side (/api/university) ----------
export const uni = Router();
const h = (fn: (req: UniRequest, res: Response) => Promise<void>) => handle(fn as never);
const role = (req: UniRequest, ...r: string[]) => { if (!r.includes(String(req.su.uniRole)) || req.preview) throw new HttpError(403, 'Your role does not allow this action.'); };
uni.get('/applications/:id/student', h(async (req, res) => {
  const ua = await loadUA(req, req.params.id);
  await UniStudentItem.updateMany({ uapp_id: ua._id, sender_type: 'student', viewed_at: null }, { viewed_at: new Date() });
  const rows = [];
  for (const x of await UniStudentItem.find({ uapp_id: ua._id }).sort({ createdAt: -1 }).lean()) rows.push(await itemOut(x));
  res.json({ rows, can_send: ['admin', 'officer'].includes(String(req.su.uniRole)) && !req.preview, status: ua.status, invoice_ok: ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(ua.status) });
}));
uni.get('/applications/:id/student/:itemId/file', h(async (req, res) => {
  const ua = await loadUA(req, req.params.id);
  const x = oid(req.params.itemId) ? ((await UniStudentItem.findOne({ _id: oid(req.params.itemId), uapp_id: ua._id }).lean()) as Any) : null;
  const url = x?.version_id ? await versionUrl(x.document_id, x.version_id) : null;
  if (!url) throw P.NotFound();
  res.json({ url });
}));
uni.post('/applications/:id/student/message', h(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = await loadUA(req, req.params.id);
  const body = clean(req.body?.body, 3000); if (!body) throw fieldErr('body', 'Write a message');
  const item = await addItem(req, ua, { kind: 'message', body });
  await fanOut(ua, item, req.uni); await P.uaudit(req, 'Message', 'UniversityStudent', ua._id, 'Message to the student');
  res.json({ ok: true });
}));
/** an agreement or any document to the student, from an uploaded file; an agreement can ask the student to accept it */
uni.post('/applications/:id/student/document', upload.single('file'), h(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = await loadUA(req, req.params.id); const b = req.body ?? {};
  const kind = b.kind === 'agreement' ? 'agreement' : 'document';
  const title = clean(b.title, 150); if (!title) throw fieldErr('title', 'Title is required');
  let f = req.file;
  if (!f) {
    if (!clean(b.text)) throw fieldErr('text', 'Write the text or upload a file');
    const L = await import('../services/uniLetters');
    f = await L.textDocument(req, ua, { kind, title, text: clean(b.text, 20000)!, format: Number(b.format) || undefined, needs_acceptance: b.needs_acceptance === true || b.needs_acceptance === 'true' });
  }
  const { doc, v } = await saveDoc(req, ua, f, kind === 'agreement' ? 'University agreement' : 'Other university document', title);
  const item = await addItem(req, ua, { kind, title, body: clean(b.message, 2000), document_id: doc._id, version_id: v.id, needs_acceptance: kind === 'agreement' && (b.needs_acceptance === true || b.needs_acceptance === 'true') });
  await fanOut(ua, item, req.uni); await P.uaudit(req, 'Create', 'UniversityStudentDocument', ua._id, `${KIND[kind]}: ${title}`);
  res.json({ ok: true, id: String(item._id) });
}));
/** every application of this university by status, with what was sent to each student */
uni.get('/pipeline', h(async (req, res) => {
  const f: Any = { university_id: req.su.universityId, is_deleted: false }; if (req.campuses.length) f.campus_id = { $in: req.campuses };
  const rows = [];
  for (const ua of (await UniversityApplication.find(f).sort({ updatedAt: -1 }).limit(1000).lean()) as Any[]) {
    const v = await P.appView(ua);
    const last = (await UniStudentItem.findOne({ uapp_id: ua._id }).sort({ createdAt: -1 }).lean()) as Any;
    const inv = (await UniStudentItem.findOne({ uapp_id: ua._id, kind: 'invoice' }).sort({ createdAt: -1 }).lean()) as Any;
    const agr = (await UniStudentItem.findOne({ uapp_id: ua._id, kind: 'agreement', needs_acceptance: true }).sort({ createdAt: -1 }).lean()) as Any;
    rows.push({ id: String(ua._id), code: v.application_code, student: v.student_name, course: v.course, intake: v.intake, status: ua.status, updated_at: ua.updatedAt,
      last_sent: last ? { kind: KIND[last.kind], at: last.createdAt } : null, invoice: inv ? { amount: inv.amount, currency: inv.currency, due_date: inv.due_date } : null,
      agreement: agr ? (agr.accepted_at ? 'Accepted' : 'Waiting') : null, unread_student: await UniStudentItem.countDocuments({ uapp_id: ua._id, sender_type: 'student', viewed_at: null }) });
  }
  res.json({ statuses: P.STATUSES, rows });
}));

// ---------- student side (/api/portal) ----------
export const portal = Router();
const ph = (fn: (req: PortalRequest, res: Response) => Promise<void>) => handle(fn as never);
portal.get('/university-items', ph(async (req, res) => {
  const s = req.c?.student as Any; if (!s) { res.json({ groups: [] }); return; }
  const groups = [];
  for (const uaId of await UniStudentItem.distinct('uapp_id', { student_id: s._id })) {
    const ua = (await UniversityApplication.findById(uaId).lean()) as Any; const a = ua ? ((await Application.findById(ua.application_id).lean()) as Any) : null;
    if (!ua || !a) continue;
    const u = await University.findById(ua.university_id).lean();
    const items = [];
    for (const i of await UniStudentItem.find({ uapp_id: ua._id }).sort({ createdAt: -1 }).lean()) items.push({ ...(await itemOut(i)), sender: i.sender_type === 'student' ? 'You' : uniLabel(u), mine: i.sender_type === 'student', file_url: i.version_id ? await versionUrl(i.document_id, i.version_id) : null });
    if (!req.preview) {
      await UniStudentItem.updateMany({ uapp_id: ua._id, sender_type: 'university', viewed_at: null }, { viewed_at: new Date() });
      await UniStudentItem.updateMany({ uapp_id: ua._id, sender_type: 'university', status: 'Sent', kind: { $ne: 'message' } }, { status: 'Viewed' });
    }
    const course = (a.course_id && ((await Course.findById(a.course_id).select('name').lean()) as Any)?.name) || a.course_name_text;
    groups.push({ uapp_id: String(ua._id), university: uniLabel(u), course, intake: a.intake_id ? ((await Intake.findById(a.intake_id).select('name').lean()) as Any)?.name : null, status: ua.status, items });
  }
  res.json({ groups });
}));
portal.post('/university-items/:id/accept', ph(async (req, res) => {
  const s = req.c?.student as Any;
  const x = s && oid(req.params.id) ? await UniStudentItem.findOne({ _id: oid(req.params.id), student_id: s._id, kind: 'agreement', needs_acceptance: true }) : null;
  if (!x) throw new HttpError(404, 'Not found');
  if (x.accepted_at) throw bad('You already accepted this agreement');
  const name = clean(req.body?.signature_name, 100); if (!name || name.length < 3) throw fieldErr('signature_name', 'Type your full name as your signature');
  if (!req.body?.confirm) throw fieldErr('confirm', 'Please tick that you have read and accept the agreement');
  x.set({ status: 'Accepted', accepted_at: new Date(), accepted_name: name, accepted_ip: req.ip, accepted_ua: String(req.headers['user-agent'] || '').slice(0, 300) }); await x.save();
  await CONSENT.record(req, { suId: req.su._id, type: 'university_agreement', value: true, method: 'portal_typed_signature', extra: { signature_name: name, item_id: String(x._id), title: x.title }, universityId: x.university_id, applicationId: x.application_id });
  const a = (await Application.findById(x.application_id).lean()) as Any;
  await P.notifyUni(x.university_id, { roles: ['admin', 'officer'] }, `${fullName(s)} accepted the agreement "${x.title}"`, `/applications/${x.uapp_id}`);
  for (const id of await P.handlers(a)) await notify(id, 'university', `${fullName(s)} accepted the university agreement "${x.title}" (${a.application_code})`, `/students/${s._id}/applications`);
  await timeline({ student_id: s._id, type: 'university', description: `Student accepted the university agreement "${x.title}" (typed name "${name}", IP ${req.ip})` });
  res.json({ ok: true });
}));
portal.post('/university-items/reply/:uappId', ph(async (req, res) => {
  const s = req.c?.student as Any; if (!s) throw new HttpError(404, 'Not found');
  const ua = oid(req.params.uappId) ? ((await UniversityApplication.findOne({ _id: oid(req.params.uappId), is_deleted: false }).lean()) as Any) : null;
  const a = ua ? ((await Application.findOne({ _id: ua.application_id, student_id: s._id }).lean()) as Any) : null;
  if (!ua || !a || !(await UniStudentItem.exists({ uapp_id: ua._id }))) throw new HttpError(404, 'Not found');
  const body = clean(req.body?.body, 3000); if (!body) throw fieldErr('body', 'Write a message');
  await addItem(null, ua, { kind: 'message', body, sender_type: 'student' });
  const u = await University.findById(ua.university_id).lean();
  await P.notifyUni(ua.university_id, { roles: ['admin', 'officer'] }, `New message from ${fullName(s)} (${a.application_code})`, `/applications/${ua._id}`);
  for (const id of await P.handlers(a)) await notify(id, 'university', `${fullName(s)} replied to ${uniLabel(u)} (${a.application_code}): copy for La Europa`, `/students/${s._id}/applications`);
  res.json({ ok: true });
}));

// ---------- La Europa's copy (/api, staff) ----------
export const staff = Router();
staff.get('/applications/:aid/university-student', authenticate, staffOnly, handle(async (req: AuthRequest, res) => {
  const { loadChild } = await import('./work');
  const { row: a } = await loadChild(req, Application as never, req.params.aid, 'Application');
  const rows = [];
  for (const x of await UniStudentItem.find({ application_id: (a as Any)._id }).sort({ createdAt: -1 }).lean()) rows.push({ ...(await itemOut(x)), file_url: x.version_id ? await versionUrl(x.document_id, x.version_id) : null });
  res.json({ rows });
}));
void VisaCase;
