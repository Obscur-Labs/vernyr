import crypto from 'crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import Student, { type IStudent } from '../models/Student';
import Lead, { type ILead } from '../models/Lead';
import PortalAccount from '../models/PortalAccount';
import Task from '../models/Task';
import Course from '../models/Course';
import University from '../models/University';
import { MasterItem } from '../models/Master';
import { Application, Shortlist, StudentDocument, VisaCase } from '../models/Work';
import { ApplicationRequest, ChatMessage, ProfileChangeRequest, SavedCourse, FeeInstruction, OfferCondition, PaymentSubmission, AccountDeletionRequest, ConsentRecord, ProfileDraft,
  REQUEST_OPEN, type IApplicationRequest, type IProfileChangeRequest } from '../models/Portal';
import { audit, getSetting, setSetting } from '../models/Audit';
import { can } from '../config/clientPerms';
import { signedFileUrl, type MediaResourceType } from '../config/cloudinary';
import { bad, fieldErr, forbidden, notFound, handle, need, isAdmin, seesAll, oid, clean, num, istDate, timeline, userNames, nameIn, fullName, encrypt, hmac } from '../services/crm';
import { loadStudent, studentScope, academicSummary } from '../services/students';
import { closeSystemTask, notifyAdmins } from '../services/tasks';
import { docFor, saveAs, fileUrl } from '../services/files';
import { fire, trigger, studentNotify, ul } from '../services/email';
import { suOfStudent, suOfLead, portalInfo, issueInvite, notifyStudent } from '../services/portal';
import * as CHAT from '../services/portalChat';
import { loadLead, leadScope } from './leads';
import { createApplication, shortlistWarnings, workNames, loadChild, recordPayment } from './work';
import { onProofRecorded, onProofRejected } from './invoices';

/** The counsellor side of the student portal (legacy/server/routes/portal_staff.js, Portal doc C1 to C11). */
const router = Router();
router.use(authenticate);

const out = (o: { _id: unknown; createdAt?: Date; updatedAt?: Date }) => ({ ...o, id: String(o._id), _id: undefined, __v: undefined, created_at: o.createdAt, updated_at: o.updatedAt });
const docLink = async (docId: unknown) => {
  if (!docId) return null;
  const d = await StudentDocument.findById(docId).lean();
  const v = d?.versions.find((x) => String(x._id) === String(d.current_version_id));
  return fileUrl(v);
};
const adminOnly = (req: AuthRequest) => { if (!isAdmin(req)) throw forbidden(); };

// ---------- C1: portal status and invite ----------
router.get('/students/:id/portal', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  res.json(portalInfo(await suOfStudent(s._id)));
}));
router.post('/students/:id/portal-invite', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  if (!can(req.user!.role, 'profile', 'edit')) throw forbidden();
  const r = await issueInvite(s._id as Types.ObjectId, req.user!.id);
  await audit(req, 'Create', 'PortalInvite', s._id, s.student_code);
  res.json({ ok: true, link: process.env.MAIL_PROVIDER === 'smtp' ? undefined : r.link });
}));
router.get('/leads/:id/portal', handle(async (req, res) => {
  const l = await loadLead(req, req.params.id);
  const su = await suOfLead(l._id);
  if (!su) { res.json({ status: 'No portal account' }); return; }
  const N = await workNames();
  const requests = await ApplicationRequest.find({ student_user_id: su._id, is_deleted: false }).sort({ createdAt: -1 }).lean();
  const saved = await SavedCourse.find({ student_user_id: su._id, removed_at: null }).lean();
  const courses = await Course.find({ _id: { $in: saved.map((x) => x.course_id) } }).select('name universityName').lean();
  res.json({ ...portalInfo(su), requests: await Promise.all(requests.map((q) => reqOut(q as never, N))),
    saved: courses.map((c) => ({ id: String(c._id), name: c.name, uni: c.universityName })) });
}));

// ---------- C2: Student Requests (S35) ----------
type N = Awaited<ReturnType<typeof workNames>>;
async function reqOut(q: IApplicationRequest, N: N) {
  const s = q.student_id ? await Student.findById(q.student_id).select('first_name middle_name last_name student_code primary_counsellor_id').lean() : null;
  const l = !s && q.lead_id ? await Lead.findById(q.lead_id).select('first_name last_name lead_code assigned_user_id').lean() : null;
  const days = q.deadline ? Math.round((+new Date(q.deadline) - +new Date(istDate())) / 864e5) : null;
  return {
    id: String(q._id), code: q.request_code, status: q.status, student_id: s ? String(s._id) : null, lead_id: l ? String(l._id) : null,
    student_name: s ? fullName(s) : l ? [l.first_name, l.last_name].filter(Boolean).join(' ') : '', student_code: s?.student_code ?? l?.lead_code ?? '',
    course_id: q.course_id, course: q.course_name || N.name(q.course_id), university: N.name(q.university_id), university_id: q.university_id, country: N.name(q.country_id), country_id: q.country_id,
    level: q.level, intake: N.name(q.intake_id), intake_id: q.intake_id, deadline: q.deadline, days_left: days, eligibility: q.eligibility_snapshot, missing: q.missing_documents ?? [],
    message: q.message_to_counsellor, requested_at: q.createdAt, reviewed_by: N.user(q.reviewed_by), reviewed_at: q.reviewed_at,
    decline_reason: [q.decline_reason_code, q.decline_reason_text].filter(Boolean).join(': '), internal_note: q.internal_note, application_id: q.application_id, source_screen: q.source_screen,
    counsellor: N.user(s ? s.primary_counsellor_id : l?.assigned_user_id), is_lead: !s,
  };
}
/** Requests of students and (unconverted) leads this user may see. */
async function reqScope(req: AuthRequest): Promise<Record<string, unknown>> {
  if (seesAll(req)) return {};
  const [students, leads] = await Promise.all([Student.distinct('_id', { is_deleted: false, ...studentScope(req) }), Lead.distinct('_id', { is_deleted: false, ...leadScope(req) })]);
  return { $or: [{ student_id: { $in: students } }, { student_id: null, lead_id: { $in: leads } }] };
}
const STATUS_ORDER: Record<string, number> = { 'Requested by student': 0, 'Info needed': 1, 'In review': 2 };
router.get('/portal-requests', handle(async (req, res) => {
  const q = req.query as Record<string, string>;
  const f: Record<string, unknown> = { is_deleted: false, ...(await reqScope(req)) };
  if (q.status) f.status = { $in: q.status.split(',') };
  if (oid(q.country)) f.country_id = oid(q.country);
  if (oid(q.intake)) f.intake_id = oid(q.intake);
  if (oid(q.student)) f.student_id = oid(q.student);
  if (oid(q.counsellor) && isAdmin(req)) {
    const [st, ld] = await Promise.all([Student.distinct('_id', { primary_counsellor_id: oid(q.counsellor) }), Lead.distinct('_id', { assigned_user_id: oid(q.counsellor) })]);
    f.$and = [{ $or: [{ student_id: { $in: st } }, { lead_id: { $in: ld } }] }];
  }
  const rows = (await ApplicationRequest.find(f).sort({ createdAt: -1 }).limit(500).lean()).sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));
  const N = await workNames();
  res.json({ rows: await Promise.all(rows.map((r) => reqOut(r as never, N))), total: rows.length });
}));
async function loadReq(req: AuthRequest, id: string) {
  const q = await ApplicationRequest.findOne({ _id: oid(id), is_deleted: false });
  if (!q) throw notFound('Request');
  if (q.student_id) await loadStudent(req, String(q.student_id)); else await loadLead(req, String(q.lead_id));
  return q;
}
router.get('/portal-requests/:id', handle(async (req, res) => {
  const q = await loadReq(req, req.params.id);
  if (q.status === 'Requested by student') { q.set({ status: 'In review', reviewed_by: req.user!.id, reviewed_at: new Date() }); await q.save(); }
  const N = await workNames();
  const o: Record<string, unknown> = await reqOut(q, N);
  if (q.student_id) {
    const s = (await Student.findById(q.student_id))!;
    o.summary = (await academicSummary(s)).line;
    const c = q.course_id ? await Course.findById(q.course_id).lean() : null;
    o.warnings = await shortlistWarnings(s, { country_id: q.country_id, university_id: q.university_id, course_id: q.course_id, level: q.level, intake_id: q.intake_id,
      tuition_fee: c?.tuition?.amount, currency: c?.tuition?.currency, deadline: q.deadline }, N);
  }
  res.json(o);
}));
router.post('/portal-requests/:id/review', handle(async (req, res) => {
  const q = await loadReq(req, req.params.id);
  if (!['Requested by student', 'Info needed'].includes(q.status)) throw bad('Only new or info-needed requests can be moved to In review');
  q.set({ status: 'In review', reviewed_by: req.user!.id, reviewed_at: new Date() }); await q.save();
  res.json({ ok: true });
}));
router.post('/portal-requests/:id/accept', handle(async (req, res) => {
  need(req, 'applications', 'add');
  const q = await loadReq(req, req.params.id);
  if (!REQUEST_OPEN.includes(q.status)) throw bad('This request is already closed');
  if (!q.student_id) throw bad('Register the student first (convert the lead), then accept the request.');
  const s = await loadStudent(req, String(q.student_id));
  const c = q.course_id ? await Course.findById(q.course_id).lean() : null;
  const b = { country_id: q.country_id, university_id: q.university_id, course_id: q.course_id, level: q.level, intake_id: q.intake_id, deadline: q.deadline,
    ...(req.body ?? {}), source_channel: 'student_portal', application_request_id: q._id };
  const sl = await Shortlist.findOne({ student_id: s._id, course_id: q.course_id, intake_id: q.intake_id ?? null, is_deleted: false });
  const appId = await createApplication(req, s, b, sl?._id);
  if (sl) await Shortlist.updateOne({ _id: sl._id }, { status: 'Converted to application', application_id: appId, updated_by: req.user!.id });
  else await Shortlist.create({ student_id: s._id, country_id: q.country_id, university_id: q.university_id, course_id: q.course_id, level: q.level, intake_id: q.intake_id,
    tuition_fee: c?.tuition?.amount, currency: c?.tuition?.currency, deadline: q.deadline, status: 'Converted to application', application_id: appId,
    student_response: 'Accepted', student_response_at: q.createdAt, created_by: req.user!.id });
  const before = q.status;
  q.set({ status: 'Accepted', application_id: appId, reviewed_by: req.user!.id, reviewed_at: new Date() }); await q.save();
  await closeSystemTask(`request:${q._id}`);
  await timeline({ student_id: s._id, type: 'stage', description: `Apply Now request ${q.request_code} accepted: application created`, user_id: req.user!.id });
  await audit(req, 'Update', 'ApplicationRequest', q._id, q.request_code, { status: before }, { status: 'Accepted', application_id: appId });
  res.json({ ok: true, application_id: appId });
}));
const DECLINE = ['Not eligible for this course', 'Deadline too close', 'Better options suggested', 'Duplicate', 'Other'];
router.post('/portal-requests/:id/decline', handle(async (req, res) => {
  const q = await loadReq(req, req.params.id);
  if (!REQUEST_OPEN.includes(q.status)) throw bad('This request is already closed');
  const b = req.body ?? {};
  if (!DECLINE.includes(b.reason)) throw fieldErr('reason', 'Choose a reason for the student');
  if (b.reason === 'Other' && !clean(b.text)) throw fieldErr('text', 'Please write the reason');
  const before = q.status;
  q.set({ status: 'Declined', decline_reason_code: b.reason, decline_reason_text: clean(b.text, 300), internal_note: clean(b.internal_note, 1000), reviewed_by: req.user!.id, reviewed_at: new Date() });
  await q.save();
  await closeSystemTask(`request:${q._id}`);
  const reason = b.reason === 'Other' ? clean(b.text, 300) : [b.reason, clean(b.text, 300)].filter(Boolean).join(': ');
  const N = await workNames();
  await fire(req, 'E24', q.student_id ? { student_id: q.student_id } : { lead_id: q.lead_id },
    { course: q.course_name || N.name(q.course_id), university: N.name(q.university_id), intake: N.name(q.intake_id), decline_reason: reason }, `Apply Now request ${q.request_code} declined (E24)`);
  if (q.student_id) await timeline({ student_id: q.student_id, type: 'stage', description: `Apply Now request ${q.request_code} declined: ${reason}`, user_id: req.user!.id });
  await audit(req, 'Update', 'ApplicationRequest', q._id, q.request_code, { status: before }, { status: 'Declined', reason });
  res.json({ ok: true });
}));
router.post('/portal-requests/:id/ask', handle(async (req, res) => {
  const q = await loadReq(req, req.params.id);
  if (!clean(req.body?.message)) throw fieldErr('message', 'Write your question for the student');
  q.set({ status: 'Info needed', reviewed_by: req.user!.id, reviewed_at: q.reviewed_at ?? new Date() }); await q.save();
  await CHAT.send(q.student_id ? { student_id: q.student_id } : { lead_id: q.lead_id! }, { type: 'staff', userId: req.user!.id }, { body: req.body.message, context_type: 'request', context_id: String(q._id) });
  if (q.student_user_id) await studentNotify(q.student_user_id, `${req.user!.name}: ${String(req.body.message).slice(0, 60)}`, '/chat');
  res.json({ ok: true });
}));

// ---------- C3: chat (S36) ----------
const openPath = (attId: string) => `/chat/attachments/${attId}/open`;
async function convFor(req: AuthRequest, kind: string, id: string): Promise<{ conv: CHAT.Conv; s?: IStudent; l?: ILead }> {
  if (kind === 'students') { const s = await loadStudent(req, id); return { conv: { student_id: s._id as Types.ObjectId }, s }; }
  if (kind !== 'leads') throw notFound();
  const l = await loadLead(req, id); return { conv: { lead_id: l._id as Types.ObjectId }, l };
}
async function canReply(req: AuthRequest, s?: IStudent) {
  if (isAdmin(req) || !s || String(s.primary_counsellor_id) === req.user!.id) return true;
  return (await getSetting('team_can_reply')) === '1';
}
router.get('/chat/inbox', handle(async (req, res) => {
  const [studs, leads] = await Promise.all([
    Student.find({ is_deleted: false, ...studentScope(req), _id: { $in: await CHAT_IDS('student_id') } }).select('first_name middle_name last_name student_code').lean(),
    Lead.find({ is_deleted: false, status: { $ne: 'Converted' }, ...leadScope(req), _id: { $in: await CHAT_IDS('lead_id', { student_id: null }) } }).select('first_name last_name lead_code').lean(),
  ]);
  const target = Number((await getSetting('first_response_hours')) || 24);
  const item = async (conv: CHAT.Conv, name: string, code: string, href: string) => {
    const w = 'student_id' in conv ? { student_id: conv.student_id } : { lead_id: conv.lead_id, student_id: null };
    const last = await ChatMessage.findOne(w).sort({ sent_at: -1 }).lean();
    let waiting: number | null = null;
    if (last?.sender_type === 'student') {
      const lastStaff = await ChatMessage.findOne({ ...w, sender_type: 'staff' }).sort({ sent_at: -1 }).select('sent_at').lean();
      const first = await ChatMessage.findOne({ ...w, sender_type: 'student', ...(lastStaff ? { sent_at: { $gt: lastStaff.sent_at } } : {}) }).sort({ sent_at: 1 }).select('sent_at').lean();
      if (first) waiting = Math.floor((Date.now() - +first.sent_at) / 3600e3);
    }
    return { name, code, href, unread: await CHAT.unread(conv, 'staff'), last: last ? (last.deleted_at ? 'message deleted' : last.body || 'Attachment').slice(0, 80) : '',
      last_at: last?.sent_at ?? null, last_from: last?.sender_type ?? null, waiting_hours: waiting, overdue: waiting !== null && waiting >= target };
  };
  const rows = (await Promise.all([
    ...studs.map((s) => item({ student_id: s._id as Types.ObjectId }, fullName(s), s.student_code, `/students/${s._id}/chat`)),
    ...leads.map((l) => item({ lead_id: l._id as Types.ObjectId }, [l.first_name, l.last_name].filter(Boolean).join(' '), l.lead_code, `/leads/${l._id}?chat=1`)),
  ])).sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || String(b.last_at ?? '').localeCompare(String(a.last_at ?? '')));
  res.json({ rows, unread_total: rows.reduce((n, x) => n + x.unread, 0) });
}));
async function CHAT_IDS(key: 'student_id' | 'lead_id', extra: Record<string, unknown> = {}) {
  return ChatMessage.distinct(key, { [key]: { $ne: null }, ...extra });
}
router.get('/:kind(students|leads)/:id/chat', handle(async (req, res) => {
  const { conv, s, l } = await convFor(req, req.params.kind, req.params.id);
  if (isAdmin(req) && s && String(s.primary_counsellor_id) !== req.user!.id) await audit(req, 'View sensitive', 'Chat', req.params.id, 'Admin read student chat');
  const rows = await CHAT.list(conv, { type: 'staff', userId: req.user!.id }, { before: req.query.before as string, openPath });
  const reply = await canReply(req, s);
  if (reply && req.query.peek !== '1') await CHAT.markRead(conv, 'staff');
  const su = s ? await suOfStudent(s._id) : await suOfLead(l!._id);
  let quick: string[] = [];
  try { quick = JSON.parse(String((await getSetting('quick_replies:' + req.user!.id)) ?? '[]')); } catch { /* none saved */ }
  res.json({ rows: rows.map((m) => ({ ...m, can_edit: m.can_edit && m.sender_id === req.user!.id })), can_reply: reply, portal: portalInfo(su), quick_replies: quick });
}));
router.post('/:kind(students|leads)/:id/chat', upload.array('files', 5), handle(async (req, res) => {
  const { conv, s, l } = await convFor(req, req.params.kind, req.params.id);
  if (!(await canReply(req, s))) throw forbidden();
  const b = req.body ?? {};
  const id = await CHAT.send(conv, { type: 'staff', userId: req.user!.id }, { body: b.body, context_type: b.context_type, context_id: b.context_id, attachments: (req.files as Express.Multer.File[]) ?? [] });
  const su = s ? await suOfStudent(s._id) : await suOfLead(l!._id);
  if (su) await studentNotify(su._id, `${req.user!.name}: ${String(b.body || 'Attachment').slice(0, 60)}`, '/chat');
  // answering a question on a shortlist option clears its "Question asked" badge
  if (s) await Shortlist.updateMany({ student_id: s._id, student_response: 'Question asked' }, { $unset: { student_response: 1 } });
  res.json({ id });
}));
async function staffMsg(req: AuthRequest) {
  const m = await ChatMessage.findById(oid(req.params.mid));
  if (!m) throw notFound('Message');
  if (m.student_id) await loadStudent(req, String(m.student_id)); else await loadLead(req, String(m.lead_id));
  return m;
}
router.patch('/chat/messages/:mid', handle(async (req, res) => { await staffMsg(req); await CHAT.edit(oid(req.params.mid), { type: 'staff', userId: req.user!.id }, req.body?.body); res.json({ ok: true }); }));
router.delete('/chat/messages/:mid', handle(async (req, res) => {
  const m = await staffMsg(req);
  if (isAdmin(req) && String(m.sender_user_id) !== req.user!.id) {
    m.original_body ??= m.body; m.deleted_at = new Date(); await m.save();
    await audit(req, 'Delete', 'ChatMessage', m._id, 'Admin deleted chat message');
  } else await CHAT.edit(m._id, { type: 'staff', userId: req.user!.id }, null, true);
  res.json({ ok: true });
}));
router.post('/chat/messages/:mid/report', handle(async (req, res) => {
  const m = await staffMsg(req);
  m.reported_at = new Date(); await m.save();
  await notifyAdmins('chat_report', `${req.user!.name} reported a chat message`, m.student_id ? `/students/${m.student_id}/chat` : `/leads/${m.lead_id}`);
  res.json({ ok: true });
}));
async function staffAttachment(req: AuthRequest) {
  const hit = await CHAT.attachment(oid(req.params.aid));
  if (!hit) throw notFound('File');
  if (hit.m.student_id) await loadStudent(req, String(hit.m.student_id)); else await loadLead(req, String(hit.m.lead_id));
  return hit;
}
router.get('/chat/attachments/:aid/open', handle(async (req, res) => {
  const { a } = await staffAttachment(req);
  res.json({ url: signedFileUrl(a.file_key, a.public_id, a.resource_type as MediaResourceType) });
}));
router.post('/chat/attachments/:aid/save', handle(async (req, res) => {
  const { m, a } = await staffAttachment(req);
  if (!m.student_id) throw notFound('File');
  need(req, 'documents', 'add');
  const s = await loadStudent(req, String(m.student_id));
  const t = await MasterItem.findOne({ _id: oid(req.body?.document_type_id), type: 'document_type' }).lean();
  if (!t) throw fieldErr('document_type_id', 'Choose a document type');
  const doc = await docFor(s._id as Types.ObjectId, t._id as Types.ObjectId, { title: t.name === 'Others' ? clean(req.body?.title, 150) || a.original_name : undefined }, req.user!.id);
  // same stored file: the chat upload becomes the next version, waiting for verification like any student upload
  const vid = new Types.ObjectId();
  const v = (doc.versions.reduce((n, x) => Math.max(n, x.version_no), 0) || 0) + 1;
  doc.versions.push({ _id: vid, version_no: v, url: a.file_key, public_id: a.public_id, resource_type: a.resource_type, stored_name: a.original_name ?? 'file', original_name: a.original_name ?? 'file',
    mime_type: a.mime_type, size_bytes: a.size_bytes, uploaded_by: new Types.ObjectId(req.user!.id), uploaded_by_type: 'student', uploaded_at: new Date(), version_status: 'Uploaded' } as never);
  doc.set({ current_version_id: vid, status: 'Uploaded', updated_by: req.user!.id });
  await doc.save();
  a.saved_document_id = doc._id as Types.ObjectId; await m.save();
  await timeline({ student_id: s._id, type: 'document', description: `Chat file saved to documents: ${a.original_name}`, user_id: req.user!.id });
  res.json({ ok: true });
}));
router.put('/chat/quick-replies', handle(async (req, res) => {
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((x: unknown) => clean(x, 300)).filter(Boolean).slice(0, 20);
  await setSetting('quick_replies:' + req.user!.id, JSON.stringify(items), req.user!.id);
  res.json({ ok: true });
}));

// ---------- C4: profile change requests (S37) ----------
const fmtVal = (v: unknown) => (v === null || v === undefined ? '-' : typeof v === 'object' ? Object.values(v as object).filter((x) => x !== null && x !== '').join(', ') : String(v));
router.get('/students/:id/change-requests', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const applied = await Application.countDocuments({ student_id: s._id, is_deleted: false, stage: { $nin: ['documents_pending', 'ready_to_apply', 'rejected', 'withdrawn', 'offer_declined'] } });
  const names = await userNames();
  const rows = (await ProfileChangeRequest.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: -1 }).lean()).sort((a, b) => Number(a.status !== 'Pending') - Number(b.status !== 'Pending'));
  res.json({ applied_count: applied, rows: await Promise.all(rows.map(async (x) => ({ ...out(x), reviewed_by_name: nameIn(names, x.reviewed_by),
    overdue: x.status === 'Pending' && Date.now() - +x.createdAt > 3 * 864e5, file_url: await docLink(x.document_id) }))) });
}));
async function loadCr(req: AuthRequest) {
  const cr = await ProfileChangeRequest.findOne({ _id: oid(req.params.cid), is_deleted: false });
  if (!cr) throw notFound('Request');
  const s = await loadStudent(req, String(cr.student_id));
  need(req, 'profile', 'edit');
  if (cr.status !== 'Pending') throw bad('This request is already closed');
  return { cr, s };
}
const PERSONAL = ['first_name', 'middle_name', 'last_name', 'no_surname', 'gender', 'dob', 'nationality', 'whatsapp', 'address1', 'address2', 'city', 'state', 'pin',
  'marital_status', 'spouse_travel', 'children', 'emergency_name', 'emergency_phone', 'passport_issue', 'passport_expiry', 'passport_place'];
/** Write an approved change into the student file (legacy portal/profile.js applyChangeRequest). */
async function applyChangeRequest(cr: IProfileChangeRequest, s: IStudent, staffId: string) {
  const val = cr.new_value as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [sec, a, b] = cr.field_key.split('.');
  if (sec === 'contact') {
    const old = s.email;
    s.set({ email: String(val).toLowerCase(), email_thread_root_id: undefined, email_thread_subject: undefined, email_refs: [], email_status: 'OK' });
    await PortalAccount.updateOne({ studentId: s._id }, { email: String(val).toLowerCase(), emailVerifiedAt: new Date(), $unset: { pendingEmail: 1 } });
    await timeline({ student_id: s._id, type: 'email', description: `Email changed from ${old} to ${val} (requested by student): a new email thread will start`, user_id: staffId });
  } else if (sec === 'personal' && PERSONAL.includes(a)) s.set(a, val);
  else if (sec === 'passport') {
    if (a === 'passport') { const p = val ? String(val).toUpperCase() : null; s.set({ passport_enc: p ? encrypt(p) : undefined, passport_hash: p ? hmac(p) : undefined, passport_last4: p ? p.slice(-4) : undefined }); }
    else if (a === 'has_passport') await PortalAccount.updateOne({ studentId: s._id }, { 'flags.has_passport': !!val });
    else if (PERSONAL.includes(a)) s.set(a, val);
  } else if (sec === 'preferences') {
    if (a === 'country_ids') s.set('prefs.country_ids', (Array.isArray(val) ? val : []).map(oid).filter(Boolean));
    else if (a === 'intake_id') s.set('prefs.intake_id', oid(val));
    else if (['course', 'level', 'budget_tuition_eur', 'budget_total_eur', 'aps_needed'].includes(a)) s.set(`prefs.${a}`, val);
  } else if (sec === 'academic') {
    if (a === 'new') s.academics.push({ level: val.level, course_name: clean(val.course_name, 150), board_university: clean(val.board_university, 150), institution: clean(val.institution, 150),
      score: num(val.score), score_type: val.score_type || '%', start_year: num(val.start_year), pass_year: num(val.pass_year), backlogs_total: num(val.backlogs_total), backlogs_active: num(val.backlogs_active), sort: 60 });
    else { const r = s.academics.find((x) => String(x._id) === a); if (r && b) (r as unknown as Record<string, unknown>)[b] = val; }
  } else if (sec === 'work') {
    const f = { company: clean(val.company, 150) ?? '', designation: clean(val.designation, 100) ?? '', from_month: val.from_month, to_month: val.till_date ? undefined : val.to_month, till_date: !!val.till_date };
    if (a === 'new') s.work.push(f); else { const r = s.work.find((x) => String(x._id) === a); if (r) Object.assign(r, f); }
  } else if (sec === 'english') {
    const f = { test_type: val.test_type, overall: num(val.overall), listening: num(val.listening), reading: num(val.reading), writing: num(val.writing), speaking: num(val.speaking), test_date: val.test_date || undefined, reference_no: clean(val.reference_no, 50) };
    if (a === 'new') s.tests.push(f); else { const r = s.tests.find((x) => String(x._id) === a); if (r) Object.assign(r, f); }
  } else throw bad('This change cannot be applied automatically. Please edit the profile directly.');
  s.set({ updated_by: staffId });
  await s.save();
}
router.post('/change-requests/:cid/approve', handle(async (req, res) => {
  const { cr, s } = await loadCr(req);
  await applyChangeRequest(cr, s, req.user!.id);
  cr.set({ status: 'Approved', reviewed_by: req.user!.id, reviewed_at: new Date() }); await cr.save();
  await timeline({ student_id: s._id, type: 'profile', description: `${cr.field_label} changed from "${fmtVal(cr.old_value)}" to "${fmtVal(cr.new_value)}" (requested by student, approved by ${req.user!.name})`, user_id: req.user!.id });
  await audit(req, 'Update', 'Student', s._id, `${s.student_code} change request approved: ${cr.field_label}`, { [cr.field_key]: cr.old_value }, { [cr.field_key]: cr.new_value });
  await fire(req, 'E22', { student_id: s._id }, { changed_fields_list: ul([cr.field_label ?? cr.field_key]) }, `Change request approved: ${cr.field_label} (E22)`, { inAppTitle: `Your change to ${cr.field_label} was approved` });
  res.json({ ok: true });
}));
router.post('/change-requests/:cid/reject', handle(async (req, res) => {
  const { cr, s } = await loadCr(req);
  const reason = clean(req.body?.reason, 500);
  if (!reason) throw fieldErr('reason', 'Reason is required (shown to the student)');
  cr.set({ status: 'Rejected', reviewed_by: req.user!.id, reviewed_at: new Date(), reject_reason: reason }); await cr.save();
  if (cr.field_key === 'contact.email') await PortalAccount.updateOne({ studentId: s._id }, { $unset: { pendingEmail: 1 } });
  await timeline({ student_id: s._id, type: 'profile', description: `Change request rejected: ${cr.field_label} (${reason})`, user_id: req.user!.id });
  await fire(req, 'E25', { student_id: s._id }, { field_label: cr.field_label, reject_reason: reason }, 'Change request rejected (E25)', { inAppTitle: `Your change to ${cr.field_label} was not approved` });
  res.json({ ok: true });
}));

// ---------- C6: courses the student saved ----------
router.get('/students/:id/saved-courses', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const su = await suOfStudent(s._id);
  if (!su) { res.json([]); return; }
  const saved = await SavedCourse.find({ student_user_id: su._id, removed_at: null }).sort({ saved_at: -1 }).lean();
  const courses = await Course.find({ _id: { $in: saved.map((x) => x.course_id) } }).lean();
  const inShort = new Set((await Shortlist.distinct('course_id', { student_id: s._id, is_deleted: false })).map(String));
  res.json(saved.map((x) => { const c = courses.find((k) => String(k._id) === String(x.course_id)); return c && {
    course_id: String(c._id), name: c.name, level: c.level, university: c.universityName, country: c.country, tuition_fee: c.tuition?.amount ?? null, currency: c.tuition?.currency ?? null,
    saved_at: x.saved_at, in_shortlist: inShort.has(String(c._id)) }; }).filter(Boolean));
}));
router.post('/students/:id/saved-courses/:cid/add', handle(async (req, res) => {
  need(req, 'shortlist', 'add');
  const s = await loadStudent(req, req.params.id);
  const c = await Course.findById(oid(req.params.cid)).lean();
  if (!c) throw notFound('Course');
  const intake = oid(req.body?.intake_id) ?? s.prefs?.intake_id;
  if (!intake) throw fieldErr('intake_id', 'Choose the intake');
  const sl = await Shortlist.create({ student_id: s._id, university_id: c.university, course_id: c._id, level: c.level || 'Master', intake_id: intake, tuition_fee: c.tuition?.amount,
    currency: c.tuition?.currency, status: 'Student agreed', student_response: 'Accepted', student_response_at: new Date(), shared_at: new Date(), created_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'profile', description: `Saved course added to shortlist: ${c.universityName} ${c.name}`, user_id: req.user!.id });
  res.json({ id: String(sl._id) });
}));

// ---------- C7: share a document with the student ----------
router.post('/documents/:did/share', handle(async (req, res) => {
  need(req, 'documents', 'edit');
  const { row: d, student: s } = await loadChild(req, StudentDocument, req.params.did, 'Document');
  const shared = !!req.body?.shared;
  d.set({ shared_with_student: shared, shared_at: shared ? new Date() : undefined, shared_by: shared ? req.user!.id : undefined, student_seen_at: undefined, updated_by: req.user!.id });
  await d.save();
  const name = d.title || (await MasterItem.findById(d.document_type_id).select('name').lean())?.name || 'Document';
  if (shared) await notifyStudent(s._id, `New document shared: ${name}`, '/documents?tab=shared');
  await timeline({ student_id: s._id, type: 'document', description: `${name} ${shared ? 'shared with' : 'hidden from'} the student portal`, user_id: req.user!.id });
  await audit(req, 'Update', 'Document', d._id, `${s.student_code} ${name} share=${shared}`);
  res.json({ ok: true });
}));

// ---------- C8: fee deposit instructions and offer conditions ----------
router.get('/applications/:aid/portal', handle(async (req, res) => {
  const { row: a } = await loadChild(req, Application, req.params.aid, 'Application');
  const names = await userNames();
  const [ins, conds] = await Promise.all([FeeInstruction.find({ application_id: a._id, is_deleted: false }).sort({ createdAt: -1 }).lean(), OfferCondition.find({ application_id: a._id, is_deleted: false }).sort({ createdAt: 1 }).lean()]);
  res.json({
    instructions: await Promise.all(ins.map(async (i) => ({ ...out(i), published_by_name: nameIn(names, i.published_by), file_url: await docLink(i.document_id) }))),
    conditions: await Promise.all(conds.map(async (c) => ({ ...out(c), proof_url: await docLink(c.proof_document_id) }))),
    offer_response: a.student_offer_response ?? null, offer_response_at: a.student_offer_response_at ?? null, show_university_ref_to_student: !!a.show_university_ref_to_student,
  });
}));
router.post('/applications/:aid/fee-instructions', upload.single('file'), handle(async (req, res) => {
  need(req, 'applications', 'edit');
  const { row: a, student: s } = await loadChild(req, Application, req.params.aid, 'Application');
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!num(b.amount) || num(b.amount)! <= 0) errors.amount = 'Amount is required';
  if (!b.currency) errors.currency = 'Currency is required';
  if (!b.due_date) errors.due_date = 'Pay by date is required';
  if (!clean(b.pay_to)) errors.pay_to = 'Pay to is required';
  if (!clean(b.instructions_html)) errors.instructions_html = 'Instructions are required';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const uni = (await University.findById(a.university_id).select('name').lean())?.name ?? '';
  const docId = req.file ? (await saveAs(s._id as Types.ObjectId, 'Others', req.file, req.user!.id, { title: `Fee instructions: ${uni}`, application_id: a._id as Types.ObjectId, share: true })).document_id : null;
  const f = { amount: num(b.amount), currency: b.currency, due_date: b.due_date, pay_to: clean(b.pay_to, 300),
    instructions_html: String(b.instructions_html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/javascript:/gi, '').slice(0, 10000) };
  let id = b.id as string | undefined;
  if (id) {
    const ex = await FeeInstruction.findOne({ _id: oid(id), application_id: a._id });
    if (!ex) throw notFound();
    ex.set({ ...f, ...(docId ? { document_id: docId } : {}), updated_by: req.user!.id }); await ex.save();
  } else id = String((await FeeInstruction.create({ application_id: a._id, ...f, document_id: docId ?? undefined, is_published: false, created_by: req.user!.id }))._id);
  await timeline({ student_id: s._id, type: 'payment', description: `Fee deposit instructions saved for ${a.application_code}`, user_id: req.user!.id });
  res.json({ id });
}));
router.post('/fee-instructions/:id/publish', handle(async (req, res) => {
  const i = await FeeInstruction.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!i) throw notFound();
  const { row: a, student: s } = await loadChild(req, Application, String(i.application_id), 'Application');
  need(req, 'applications', 'edit');
  const pub = req.body?.published !== false;
  i.set({ is_published: pub, published_at: pub ? new Date() : undefined, published_by: pub ? req.user!.id : undefined, updated_by: req.user!.id }); await i.save();
  if (pub) {
    const uni = (await University.findById(a.university_id).select('name').lean())?.name ?? '';
    await fire(req, 'E28', { student_id: s._id }, { university: uni, amount: Number(i.amount).toLocaleString('en-IN'), currency: i.currency, due_date: i.due_date }, 'Fee instructions published (E28)');
  }
  await timeline({ student_id: s._id, type: 'payment', description: `Fee deposit instructions ${pub ? 'published to' : 'hidden from'} the student (${a.application_code})`, user_id: req.user!.id });
  res.json({ ok: true });
}));
router.post('/applications/:aid/conditions', handle(async (req, res) => {
  need(req, 'applications', 'edit');
  const { row: a, student: s } = await loadChild(req, Application, req.params.aid, 'Application');
  const items = ((Array.isArray(req.body?.items) ? req.body.items : [req.body?.text]) as unknown[]).map((t) => clean(t, 500)).filter(Boolean) as string[];
  if (!items.length) throw fieldErr('text', 'Write the condition');
  await OfferCondition.insertMany(items.map((text) => ({ application_id: a._id, text, status: 'Open', created_by: req.user!.id })));
  const uni = (await University.findById(a.university_id).select('name').lean())?.name ?? '';
  await notifyStudent(s._id, `Offer conditions added: ${uni}`, `/applications/${a._id}`);
  res.json({ ok: true });
}));
router.put('/offer-conditions/:id', handle(async (req, res) => {
  const c = await OfferCondition.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!c) throw notFound();
  const { student: s, row: a } = await loadChild(req, Application, String(c.application_id), 'Application');
  need(req, 'applications', 'edit');
  const b = req.body ?? {};
  if (b.delete) { c.set({ is_deleted: true, updated_by: req.user!.id }); await c.save(); res.json({ ok: true }); return; }
  const before = c.status;
  if (['Open', 'Met', 'Waived'].includes(b.status)) c.status = b.status;
  if (b.text) c.text = clean(b.text, 500)!;
  c.set({ updated_by: req.user!.id }); await c.save();
  if (c.status !== before) await notifyStudent(s._id, `Offer condition ${c.status === 'Met' ? 'met' : c.status === 'Waived' ? 'waived' : 'reopened'}: ${c.text.slice(0, 60)}`, `/applications/${a._id}`);
  res.json({ ok: true });
}));

// ---------- C9: payment proofs from the student ----------
router.get('/students/:id/payment-submissions', handle(async (req, res) => {
  need(req, 'fees', 'view');
  const s = await loadStudent(req, req.params.id);
  const names = await userNames();
  const rows = await PaymentSubmission.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: -1 }).lean();
  const apps = await Application.find({ _id: { $in: rows.map((x) => x.application_id).filter(Boolean) } }).select('application_code').lean();
  res.json(await Promise.all(rows.map(async (x) => ({ ...out(x), reviewed_by_name: nameIn(names, x.reviewed_by),
    application_code: apps.find((a) => String(a._id) === String(x.application_id))?.application_code ?? null, receipt_url: await docLink(x.document_id) }))));
}));
async function loadSub(req: AuthRequest) {
  const x = await PaymentSubmission.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!x) throw notFound();
  const s = await loadStudent(req, String(x.student_id));
  need(req, 'fees', 'add');
  if (x.status !== 'Submitted') throw bad('Already processed');
  return { x, s };
}
router.post('/payment-submissions/:id/record', handle(async (req, res) => {
  const { x, s } = await loadSub(req);
  const body = req.body ?? {};
  const edits = Object.fromEntries(Object.entries(body).filter(([k, v]) => ['amount', 'currency', 'payment_date', 'mode', 'reference_no', 'payment_for', 'application_id'].includes(k) && v !== ''));
  const b = { payment_for: x.payment_for, application_id: x.application_id ? String(x.application_id) : undefined, amount: x.amount, currency: x.currency, payment_date: x.payment_date, mode: x.mode,
    reference_no: x.reference_no, paid_by: body.paid_by || 'Student', remarks: clean(body.remarks, 500), payment_submission_id: String(x._id), ...edits };
  if (x.document_id) await StudentDocument.updateOne({ _id: x.document_id }, { status: 'Verified', verified_by: req.user!.id, verified_at: new Date(), shared_with_student: true });
  const r = await recordPayment(req, s, b, x.document_id, !!x.document_id);
  x.set({ status: 'Recorded', payment_id: r.id, reviewed_by: req.user!.id, reviewed_at: new Date() }); await x.save();
  // a proof against a GST invoice: the invoice is paid and its receipt is made at once
  const receipt_no = await onProofRecorded(x, r.id, req.user!.id);
  res.json({ ...r, receipt_no });
}));
router.post('/payment-submissions/:id/reject', handle(async (req, res) => {
  const { x, s } = await loadSub(req);
  const reason = clean(req.body?.reason, 300);
  if (!reason) throw fieldErr('reason', 'Reason is required (shown to the student)');
  x.set({ status: 'Rejected', reject_reason: reason, reviewed_by: req.user!.id, reviewed_at: new Date() }); await x.save();
  await onProofRejected(x);
  await notifyStudent(s._id, `Payment proof not accepted: ${reason}`, '/payments');
  await timeline({ student_id: s._id, type: 'payment', description: `Payment proof rejected: ${reason}`, user_id: req.user!.id });
  res.json({ ok: true });
}));

// ---------- tasks the student marked done: re-open or confirm ----------
async function studentTask(req: AuthRequest) {
  const t = await Task.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!t?.student_id) throw notFound('Task');
  await loadStudent(req, String(t.student_id));
  return t;
}
router.post('/tasks/:id/reopen-student', handle(async (req, res) => {
  const t = await studentTask(req);
  const reason = clean(req.body?.reason, 300);
  if (!reason) throw fieldErr('reason', 'Reason is required');
  t.set({ status: 'Open', completed_at: undefined, completed_by: undefined, completed_by_type: undefined, reopen_reason: reason, reopened_at: new Date(), updated_by: req.user!.id });
  await t.save();
  await notifyStudent(t.student_id, `Task re-opened: ${t.title} (${reason})`, '/tasks');
  await timeline({ student_id: t.student_id, type: 'task', description: `Task re-opened for the student: ${t.title} (${reason})`, user_id: req.user!.id });
  res.json({ ok: true });
}));
router.post('/tasks/:id/confirm-student', handle(async (req, res) => {
  const t = await studentTask(req);
  t.set({ status: 'Done', completed_at: new Date(), completed_by: req.user!.id, updated_by: req.user!.id }); await t.save();
  await trigger('E19', { student_id: t.student_id, userId: req.user!.id, ctx: { task_title: t.title } });
  res.json({ ok: true });
}));

// ---------- C11 Admin: student accounts and deletion requests (S40) ----------
async function whoIs(su: { studentId?: unknown; leadId?: unknown; name?: string }) {
  const s = su.studentId ? await Student.findById(su.studentId).select('first_name middle_name last_name student_code').lean() : null;
  const l = !s && su.leadId ? await Lead.findById(su.leadId).select('first_name last_name lead_code').lean() : null;
  return { name: s ? fullName(s) : l ? [l.first_name, l.last_name].filter(Boolean).join(' ') : su.name ?? '', code: s?.student_code ?? l?.lead_code ?? '' };
}
router.get('/admin/student-accounts', handle(async (req, res) => {
  adminOnly(req);
  const rows = await PortalAccount.find({ role: 'student' }).sort({ lastSeenAt: -1, createdAt: -1 }).limit(500).lean();
  res.json(await Promise.all(rows.map(async (su) => ({ id: String(su._id), ...(await whoIs(su)), email: su.email, status: su.status, last_login_at: su.lastSeenAt ?? null,
    completion: su.completionPercent ?? 0, signup_method: su.signupMethod ?? null, student_id: su.studentId ?? null, lead_id: su.leadId ?? null,
    consents: (await ConsentRecord.find({ student_user_id: su._id }).sort({ createdAt: -1 }).lean()).map((c) => ({ consent_type: c.consent_type, document_version: c.document_version, value: c.value, created_at: c.createdAt })) }))));
}));
router.post('/admin/student-accounts/:id/:action(lock|unlock|force-logout)', handle(async (req, res) => {
  adminOnly(req);
  const su = await PortalAccount.findOne({ _id: oid(req.params.id), role: 'student' });
  if (!su) throw notFound();
  const action = req.params.action;
  if (action === 'lock') {
    const reason = clean(req.body?.reason, 200);
    if (!reason) throw fieldErr('reason', 'Reason is required');
    su.set({ status: 'Locked', lockReason: reason, isActive: false, passwordChangedAt: new Date() });
    if (su.studentId) await Student.updateOne({ _id: su.studentId }, { portal_status: 'Locked' });
  }
  if (action === 'unlock') {
    su.set({ status: 'Active', lockReason: undefined, lockedUntil: undefined, isActive: true, failedLogins: 0 });
    if (su.studentId) await Student.updateOne({ _id: su.studentId }, { portal_status: 'Active' });
  }
  // a session issued before passwordChangedAt is refused by authenticate
  if (action === 'force-logout') su.passwordChangedAt = new Date();
  await su.save();
  await audit(req, 'Update', 'StudentUser', su._id, `Portal account ${action}`);
  res.json({ ok: true });
}));
router.get('/admin/deletion-requests', handle(async (req, res) => {
  adminOnly(req);
  const names = await userNames();
  const rows = (await AccountDeletionRequest.find().sort({ createdAt: -1 }).lean()).sort((a, b) => Number(a.status !== 'Requested') - Number(b.status !== 'Requested'));
  res.json(await Promise.all(rows.map(async (x) => {
    const su = await PortalAccount.findById(x.student_user_id).lean();
    return { ...out(x), ...(su ? await whoIs(su) : { name: '', code: '' }), student_id: su?.studentId ?? null, lead_id: su?.leadId ?? null, reviewed_by_name: nameIn(names, x.reviewed_by),
      active_visa: su?.studentId ? !!(await VisaCase.exists({ student_id: su.studentId, is_open: true, is_deleted: false })) : false };
  })));
}));
router.post('/admin/deletion-requests/:id/:action(approve|reject)', handle(async (req, res) => {
  adminOnly(req);
  const x = await AccountDeletionRequest.findOne({ _id: oid(req.params.id), status: 'Requested' });
  if (!x) throw bad('Request not found or already closed');
  const su = await PortalAccount.findById(x.student_user_id);
  if (!su) throw notFound('Account');
  const reason = clean(req.body?.reason, 500);
  if (req.params.action === 'reject') {
    if (!reason) throw fieldErr('reason', 'Reason is required');
    x.set({ status: 'Rejected', reviewed_by: req.user!.id, reviewed_at: new Date(), admin_reason: reason }); await x.save();
    if (su.status === 'Deletion requested') { su.status = 'Active'; await su.save(); }
    await studentNotify(su._id, `Your account deletion request was not approved: ${reason}`, '/settings');
  } else {
    // the portal login and its data go; CRM records follow La Europa's retention policy (audit, email log and payments stay)
    x.set({ status: 'Approved', reviewed_by: req.user!.id, reviewed_at: new Date(), admin_reason: reason, completed_at: new Date() }); await x.save();
    await PortalAccount.updateOne({ _id: su._id }, { status: 'Deactivated', isActive: false, passwordChangedAt: new Date(), password: crypto.randomBytes(24).toString('base64url'),
      $unset: { email: 1, phone: 1, phoneNormalised: 1, avatar: 1, inviteTokenHash: 1, flags: 1, pendingEmail: 1, pendingPhone: 1, username: 1 } });
    await ProfileDraft.deleteMany({ student_user_id: su._id });
    await SavedCourse.updateMany({ student_user_id: su._id, removed_at: null }, { removed_at: new Date() });
    if (su.studentId) {
      await Student.updateOne({ _id: su.studentId }, { portal_status: 'Not invited' });
      await timeline({ student_id: su.studentId, type: 'profile', description: 'Student portal account closed after a deletion request (approved by Admin)', user_id: req.user!.id });
    }
  }
  await audit(req, 'Update', 'AccountDeletionRequest', x._id, `Deletion request ${req.params.action}d`);
  res.json({ ok: true });
}));

// ---------- dashboard card C5 ----------
export async function requestCounts(req: AuthRequest) {
  const ss = seesAll(req) ? {} : { student_id: { $in: await Student.distinct('_id', { is_deleted: false, ...studentScope(req) }) } };
  const [requests, change_requests, change_requests_overdue, offer_acceptances] = await Promise.all([
    ApplicationRequest.countDocuments({ is_deleted: false, status: 'Requested by student', ...(await reqScope(req)) }),
    ProfileChangeRequest.countDocuments({ status: 'Pending', is_deleted: false, ...ss }),
    ProfileChangeRequest.countDocuments({ status: 'Pending', is_deleted: false, createdAt: { $lt: new Date(Date.now() - 3 * 864e5) }, ...ss }),
    Application.countDocuments({ is_deleted: false, student_offer_response: 'Accepted', stage: { $in: ['conditional_offer', 'unconditional_offer'] }, ...ss }),
  ]);
  return { requests, change_requests, change_requests_overdue, offer_acceptances, total: requests + change_requests + offer_acceptances, ss };
}
router.get('/portal-counts', handle(async (req, res) => {
  const { ss, ...counts } = await requestCounts(req);
  const payment_proofs = await PaymentSubmission.countDocuments({ status: 'Submitted', is_deleted: false, ...ss });
  res.json({ ...counts, payment_proofs });
}));

export default router;
