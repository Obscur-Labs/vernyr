import { Router, type Response } from 'express';
import { Types } from 'mongoose';
import archiver from 'archiver';
import QRCode from 'qrcode';
import type { PortalRequest } from '../middleware/portal';
import type { AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import Student from '../models/Student';
import Lead from '../models/Lead';
import User from '../models/User';
import Task from '../models/Task';
import Notification from '../models/Notification';
import PortalAccount from '../models/PortalAccount';
import { Country, MasterItem } from '../models/Master';
import { nextCode } from '../models/Timeline';
import { getSetting } from '../models/Audit';
import { Application, VisaCase, StudentDocument, FeeSummary, Payment, StageHistory } from '../models/Work';
import { ApplicationRequest, PaymentSubmission, FeeInstruction, ChatMessage, NotificationPreference, AccountDeletionRequest, DataExportRequest, Referral, ConsentRecord } from '../models/Portal';
import { ConsentDocument, PrivacyRequest } from '../models/Privacy';
import { HttpError, bad, fieldErr, notFound, handle, oid, clean, num, istDate, fmtDateTime, normPhone, isEmail, fullName } from '../services/crm';
import { fmtDate } from '../services/invoicePdf';
import { stageList } from '../services/masters';
import { createTask, notify, notifyAdmins } from '../services/tasks';
import { trigger, sendSecurity, studentNotify } from '../services/email';
import { env } from '../config/env';
import { fileUrl } from '../services/files';
import { issueCode, checkCode, CodeError } from '../services/authCodes';
import { passwordProblem } from '../services/passwords';
import { displayName, studentCode, studentTimeline, portalAudit, notifyStaff, counsellorCard, type Ctx } from '../services/portalCtx';
import * as P from '../services/profile';
import * as CONSENT from '../services/consent';
import * as CHAT from '../services/portalChat';
import { academicSummary } from '../services/students';
import { referralStatus } from '../services/rewards';
import { sharedWith, replyDays, grievanceDue } from '../services/dpdp';
import { pick } from '../services/assign';
import { leadDuplicates } from './leads';
import { workNames, checklistFor, INST_DOCS, INST_NAMES } from './work';
import { own, needStudent, writable, hit, typeInfo, docReason, studentUpload, appOut, guardianOf, maskEmail, NO_UPLOAD } from './portal';

/** Student portal, part 2 (legacy/server/portal/routes.js): payments, visa, tasks, chat, notifications, settings, account, privacy, referrals, calendar. */
const router = Router();
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const h = (fn: (req: PortalRequest, res: Response) => Promise<unknown>) => handle(async (req, res) => {
  try { await fn(req as PortalRequest, res); } catch (e) { if (e instanceof CodeError) throw new HttpError(e.status, e.message); throw e; }
});
const conv = (c: Ctx): CHAT.Conv => (c.student ? { student_id: c.student._id as Types.ObjectId } : { lead_id: c.lead!._id as Types.ObjectId });
const curVer = (d: Any) => d?.versions?.find((x: Any) => String(x._id) === String(d.current_version_id));
const admin1 = async () => (await User.findOne({ role: 'admin', isActive: true }).select('_id').lean())?._id;
const DOC_LABEL: Record<string, string> = { Pending: 'Missing: please upload', Uploaded: 'Uploaded: being checked by La Europa', Verified: 'Verified', Rejected: 'Action needed: please re-upload' };
async function docOut(d: Any) {
  const v = curVer(d);
  const ti = await typeInfo(d.document_type_id);
  return { id: String(d._id), type_id: String(d.document_type_id), name: d.title || ti.name, help: ti.help, status: d.status, status_label: DOC_LABEL[d.status] ?? d.status, reason: docReason(d),
    version_no: v?.version_no ?? null, uploaded_at: v?.uploaded_at ?? null, uploaded_by: v ? (v.uploaded_by_type === 'student' ? 'You' : 'La Europa') : null, file_name: v?.stored_name ?? null,
    mime: v?.mime_type ?? null, view_url: fileUrl(v), download_url: fileUrl(v), can_remove: !!(v && v.uploaded_by_type === 'student' && d.status === 'Uploaded' && !d.staff_opened_at),
    shared: !!d.shared_with_student, is_new: !!(d.shared_with_student && !d.student_seen_at), expiry_date: d.expiry_date ?? null, allowed: ['pdf', 'jpg', 'jpeg', 'png'], student_can_upload: ti.student_can_upload };
}

// ---------- documents ----------
router.get('/documents', h(async (req, res) => {
  const c = req.c;
  if (!c.student) { res.json({ locked: true }); return; }
  const s = c.student;
  const N = await workNames();
  const visa = async (id: unknown) => (await typeInfo(id)).visa;
  const list = [];
  for (const i of await checklistFor(s, N)) if (!(await visa(i.document_type_id))) list.push(i);
  const inList = new Set(list.map((i) => i.doc && String(i.doc._id)).filter(Boolean));
  const types = new Set(list.map((i) => i.document_type_id));
  const checklist = await Promise.all(list.map(async (i) => ({ type_id: i.document_type_id, name: i.name, required: i.required, help: (await typeInfo(i.document_type_id)).help, allowed: ['pdf', 'jpg', 'jpeg', 'png'],
    doc: i.doc && i.doc.current_version_id && !i.doc.student_removed_at ? await docOut(i.doc.toObject()) : null, status: i.doc?.status ?? 'Pending', status_label: DOC_LABEL[i.doc?.status ?? 'Pending'], reason: docReason(i.doc) })));
  const all0 = await StudentDocument.find({ student_id: s._id, is_deleted: false }).sort({ updatedAt: -1 }).lean();
  const inst = (d: Any) => INST_NAMES.has(N.name(d.document_type_id));
  const shared = await Promise.all(all0.filter((d) => d.shared_with_student && d.current_version_id && !inst(d)).map(docOut));
  const instDocs = all0.filter((d) => d.shared_with_student && d.current_version_id && inst(d));
  const institution = await Promise.all(INST_DOCS.map(async ([key, name]) => ({ key, name, items: await Promise.all(instDocs.filter((d) => N.name(d.document_type_id) === name).map(async (d) => {
    const a = d.application_id ? await Application.findById(d.application_id).select('application_code university_id').lean() : null;
    return { ...(await docOut(d)), university: a ? N.name(a.university_id) : null, application_code: a?.application_code ?? null };
  })) })));
  const others = [];
  for (const d of all0) if (!inList.has(String(d._id)) && !types.has(String(d.document_type_id)) && !d.shared_with_student && !inst(d) && d.current_version_id && !(await visa(d.document_type_id))
    && d.versions.some((v) => v.uploaded_by_type === 'student' && !v.removed_at)) others.push(await docOut(d));
  const req0 = list.filter((i) => i.required === 'Yes');
  const upTypes = [];
  for (const t of await MasterItem.find({ type: 'document_type', active: true }).sort({ sort: 1 }).lean()) { const ti = await typeInfo(t._id); if (!NO_UPLOAD.includes(t.name) && !ti.visa && ti.student_can_upload) upTypes.push({ id: String(t._id), name: t.name }); }
  res.json({ checklist, shared, institution, others, progress: { verified: req0.filter((i) => i.doc?.status === 'Verified').length, total: req0.length }, upload_types: upTypes,
    zip: (await getSetting('zip_download')) !== '0', max_mb: Number(await getSetting('max_file_mb')) || 10 });
}));
router.post('/documents/upload', upload.array('files', 20), h(async (req, res) => {
  writable(req.c);
  const s = needStudent(req.c);
  const t = await MasterItem.findOne({ _id: oid(req.body?.document_type_id), type: 'document_type', active: true }).lean();
  if (!t || NO_UPLOAD.includes(t.name)) throw fieldErr('document_type_id', 'Choose a document type');
  res.json({ ...(await studentUpload(req, s, { typeId: t._id, title: req.body?.title, note: req.body?.note })), message: 'Uploaded. La Europa will check it soon.' });
}));
const loadDoc = async (c: Ctx, id: string) => own(await StudentDocument.findOne({ _id: oid(id), student_id: needStudent(c)._id, is_deleted: false }));
const seeVersion = async (d: Any, v: Any) => !v.removed_at && (v.uploaded_by_type === 'student' || d.shared_with_student || d.status === 'Verified' || (await workNames()).name(d.document_type_id) !== 'Fee receipt');
router.get('/documents/:id/versions', h(async (req, res) => {
  const d = await loadDoc(req.c, req.params.id);
  const out = [];
  for (const v of [...d.versions].sort((a, b) => b.version_no - a.version_no)) if (await seeVersion(d, v)) out.push({ id: String(v._id), version_no: v.version_no, uploaded_at: v.uploaded_at,
    uploaded_by: v.uploaded_by_type === 'student' ? 'You' : 'La Europa', status: v.version_status || (String(v._id) === String(d.current_version_id) ? d.status : 'Replaced'),
    reason: v.version_status === 'Rejected' ? v.version_reason ?? null : null, file_name: v.stored_name ?? null, view_url: fileUrl(v), download_url: fileUrl(v), current: String(v._id) === String(d.current_version_id) });
  res.json(out);
}));
router.post('/documents/:id/seen', h(async (req, res) => { const d = await loadDoc(req.c, req.params.id); if (!req.preview && !d.student_seen_at) { d.student_seen_at = new Date(); await d.save(); } res.json({ ok: true }); }));
router.delete('/documents/:id/latest', h(async (req, res) => {
  writable(req.c);
  const d = await loadDoc(req.c, req.params.id);
  const v = d.versions.find((x) => String(x._id) === String(d.current_version_id));
  if (!v || v.uploaded_by_type !== 'student' || d.status !== 'Uploaded' || d.staff_opened_at) throw bad('This file is already being checked by La Europa and cannot be removed.');
  v.removed_at = new Date();
  const prev = [...d.versions].filter((x) => String(x._id) !== String(v._id) && !x.removed_at).sort((a, b) => b.version_no - a.version_no)[0];
  d.current_version_id = prev?._id;
  d.status = prev ? (['Verified', 'Rejected'].includes(prev.version_status ?? '') ? prev.version_status! : 'Uploaded') : 'Pending';
  d.student_removed_at = prev ? undefined : new Date();
  await d.save();
  await studentTimeline(d.student_id, null, 'document', `Student removed their unreviewed upload of ${d.title || (await typeInfo(d.document_type_id)).name} (v${v.version_no})`);
  await portalAudit(req, 'Delete', 'DocumentVersion', v._id, v.stored_name ?? '');
  res.json({ ok: true });
}));
router.get('/documents-zip', h(async (req, res) => {
  const s = needStudent(req.c);
  if ((await getSetting('zip_download')) === '0') throw bad('Not available');
  const files = [];
  for (const d of await StudentDocument.find({ student_id: s._id, is_deleted: false, current_version_id: { $ne: null } }).lean()) {
    const v = curVer(d);
    if (v && (await seeVersion(d, v))) { const url = fileUrl(v); if (url) files.push({ url, name: v.stored_name || `${d._id}.pdf` }); }
  }
  if (!files.length) throw bad('No documents yet');
  await portalAudit(req, 'Download', 'Student', s._id, `Own documents ZIP (${files.length})`);
  const name = `${fullName(s)} documents.zip`.replace(/[\\/:*?"<>|]/g, '');
  res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  const z = new (archiver as unknown as { ZipArchive: new (o: object) => archiver.Archiver }).ZipArchive({ zlib: { level: 6 } });
  z.pipe(res);
  for (const f of files) { const r = await fetch(f.url); if (r.ok) z.append(Buffer.from(await r.arrayBuffer()), { name: f.name }); }
  await z.finalize();
}));

// ---------- payments ----------
router.get('/payments', h(async (req, res) => {
  const c = req.c;
  if (!c.student) { res.json({ locked: true }); return; }
  const s = c.student;
  const N = await workNames();
  const stages = await stageList('app_stage');
  const pays = await Payment.find({ student_id: s._id, is_deleted: false, is_refund: { $ne: true } }).sort({ payment_date: -1 }).lean();
  const shared = async (id: unknown) => { const d = id ? await StudentDocument.findById(id).lean() : null; return d?.shared_with_student && d.current_version_id ? fileUrl(curVer(d)) : null; };
  const payOut = async (p: Any) => ({ date: p.payment_date, amount: p.amount, currency: p.currency, mode: p.mode, reference_no: p.reference_no, payment_for: p.payment_for, receipt_url: await shared(p.receipt_document_id) });
  const apps = await Application.find({ student_id: s._id, is_deleted: false }).lean();
  const tuition = [];
  for (const a of apps) {
    const sm = await FeeSummary.findOne({ student_id: s._id, application_id: a._id, fee_kind: 'tuition', is_deleted: false }).lean();
    const ps = pays.filter((p) => String(p.application_id) === String(a._id) && ['Tuition fee / deposit', 'Application fee'].includes(p.payment_for));
    const cur = sm?.currency || 'EUR';
    const paid = ps.filter((p) => p.currency === cur && p.payment_for === 'Tuition fee / deposit').reduce((n, p) => n + p.amount, 0);
    const pending = sm ? Math.max(0, (sm.total_amount || 0) - (sm.scholarship || 0) - paid) : null;
    const instr = await FeeInstruction.findOne({ application_id: a._id, is_published: true, is_deleted: false }).sort({ published_at: -1 }).lean();
    tuition.push({ application_id: String(a._id), university: N.name(a.university_id), course: a.course_name_text || N.name(a.course_id), intake: N.name(a.intake_id), stage_name: stages.find((x) => x.code === a.stage)?.name ?? a.stage,
      total: sm?.total_amount ?? null, scholarship: sm?.scholarship ?? null, deposit_required: sm?.deposit_required ?? null, deposit_deadline: sm?.deposit_deadline ?? null, currency: cur, paid, pending,
      overdue: !!(sm && (pending ?? 0) > 0 && sm.deposit_deadline && sm.deposit_deadline < istDate()), history: await Promise.all(ps.map(payOut)),
      instructions: instr ? { amount: instr.amount, currency: instr.currency, due_date: instr.due_date, pay_to: instr.pay_to, instructions_html: String(instr.instructions_html ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '') } : null });
  }
  const svc = await FeeSummary.findOne({ student_id: s._id, fee_kind: 'service', is_deleted: false }).lean();
  const svcPays = pays.filter((p) => p.payment_for === 'La Europa service fee');
  const svcPaid = svcPays.filter((p) => p.currency === 'INR').reduce((n, p) => n + p.amount, 0);
  const net = svc ? (svc.total_amount || 0) - (svc.discount_approved ? svc.discount || 0 : 0) : 0; // the agreed amount; the discount itself is never shown
  const sharedOf = async (typeName: string) => {
    const t = await MasterItem.findOne({ type: 'document_type', name: typeName }).select('_id').lean();
    if (!t) return [];
    return (await StudentDocument.find({ student_id: s._id, document_type_id: t._id, shared_with_student: true, is_deleted: false, current_version_id: { $ne: null } }).lean())
      .map((d) => ({ id: String(d._id), name: d.title || typeName, date: d.updatedAt ?? d.createdAt, url: fileUrl(curVer(d)) }));
  };
  const LBL: Record<string, string> = { Submitted: 'Payment proof submitted: waiting for confirmation', Recorded: 'Recorded', Rejected: 'Not accepted' };
  res.json({ tuition,
    service: svc ? { package: N.name(svc.package_id), total: net, paid: svcPaid, pending: Math.max(0, net - svcPaid), next_due: svc.next_instalment_due ?? null, history: await Promise.all(svcPays.map(payOut)) } : null,
    invoices: await sharedOf('La Europa invoice'), receipts: await sharedOf('Fee receipt'),
    submissions: await Promise.all((await PaymentSubmission.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: -1 }).lean()).map(async (x) => ({ id: String(x._id), payment_for: x.payment_for,
      university: x.application_id ? N.name(apps.find((a) => String(a._id) === String(x.application_id))?.university_id) : '', amount: x.amount, currency: x.currency, payment_date: x.payment_date,
      reference_no: x.reference_no, status: x.status, status_label: LBL[x.status] ?? x.status, reject_reason: x.reject_reason ?? null }))),
    applications: apps.map((a) => ({ id: String(a._id), label: `${N.name(a.university_id)} (${a.application_code})` })),
    modes: (await MasterItem.find({ type: 'payment_mode', active: true }).sort({ sort: 1 }).select('name').lean()).map((x) => x.name) });
}));
router.post('/payment-submissions', upload.single('receipt'), h(async (req, res) => {
  writable(req.c);
  const s = needStudent(req.c);
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!['Tuition fee / deposit', 'Application fee', 'La Europa service fee', 'Other'].includes(b.payment_for)) errors.payment_for = 'Required';
  if (['Tuition fee / deposit', 'Application fee'].includes(b.payment_for) && !b.application_id) errors.application_id = 'Choose the application';
  if (b.application_id && !(await Application.exists({ _id: oid(b.application_id), student_id: s._id }))) throw notFound('Not found');
  const amt = num(b.amount);
  if (!amt || amt <= 0) errors.amount = 'Amount must be more than 0';
  if (!['INR', 'EUR', 'CNY', 'USD'].includes(b.currency)) errors.currency = 'Required';
  if (!b.payment_date) errors.payment_date = 'Required'; else if (b.payment_date > istDate()) errors.payment_date = 'Cannot be in the future';
  if (!b.mode) errors.mode = 'Required';
  if (!req.file) errors.receipt = 'Receipt / proof is required';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  if (b.reference_no && !b.confirm_duplicate && await PaymentSubmission.exists({ student_id: s._id, reference_no: clean(b.reference_no, 100), is_deleted: false, status: { $ne: 'Rejected' } }))
    throw bad('A payment proof with this reference number was already submitted. Submit again anyway?', { needs_confirm: true });
  const hasType = await MasterItem.exists({ type: 'document_type', name: 'Payment receipt' });
  const up = await studentUpload(req, s, { typeName: hasType ? 'Payment receipt' : 'Others', title: hasType ? undefined : 'Payment receipt', application_id: b.application_id, allowVerified: true });
  const x = await PaymentSubmission.create({ student_id: s._id, application_id: oid(b.application_id) ?? undefined, payment_for: b.payment_for, amount: amt, currency: b.currency, payment_date: b.payment_date,
    mode: b.mode, reference_no: clean(b.reference_no, 100), utr: clean(b.utr, 40), document_id: oid(up.document_id), note: clean(b.note, 500), status: 'Submitted' });
  const money = `${b.currency} ${Number(amt).toLocaleString('en-IN')}`;
  await studentTimeline(s._id, null, 'payment', `Student submitted a payment proof: ${b.payment_for} ${money} on ${fmtDate(b.payment_date)}`);
  await notifyStaff(req.c, 'payment_proof', `Payment proof uploaded by ${displayName(req.c)}: ${money}`, `/students/${s._id}/fees`);
  await portalAudit(req, 'Create', 'PaymentSubmission', x._id, `${b.payment_for} ${amt} ${b.currency}`);
  res.json({ id: String(x._id), message: 'Payment proof submitted: waiting for confirmation' });
}));

// ---------- visa ----------
const VISA_TEXT: Record<string, (v: Any) => string> = { docs_preparation: () => 'Please arrange the documents in your visa checklist.', cover_letter: () => 'Your cover letter draft is ready. Please check it in Shared with me and send feedback.',
  appointment_booked: () => 'Your appointment is booked.', biometrics: () => 'Biometrics completed.', submitted: (v) => `Your visa application was submitted on ${fmtDate(v.submission_date)}. We will inform you when there is a decision.`,
  approved: () => 'Congratulations! Your visa is approved.', rejected: () => 'Your visa was not approved this time. Your counsellor will call you to explain the next steps.', reapply: () => 'We are preparing your new visa application.' };
router.get('/visa', h(async (req, res) => {
  const c = req.c;
  if (!c.student) { res.json({ locked: true }); return; }
  const s = c.student;
  const N = await workNames();
  const stages = (await stageList('visa_stage')).map((x) => ({ ...x, code: String(x.code), sort: Number(x.sort) || 0 }));
  const types = await MasterItem.find({ type: 'document_type', active: true, 'data.visa': true }).sort({ sort: 1 }).lean();
  const aps = await MasterItem.findOne({ type: 'document_type', name: 'APS certificate' }).lean();
  const cases = [];
  for (const v of await VisaCase.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: -1 }).lean()) {
    const reached: Record<string, Date> = {};
    for (const x of await StageHistory.find({ visa_case_id: v._id, attempt_no: v.attempt_no }).sort({ changed_at: 1 }).lean()) reached[x.to_stage] = x.changed_at;
    const cur = stages.find((x) => x.code === v.stage) ?? { sort: 0 };
    const isDE = N.name(v.country_id) === 'Germany';
    const timeline = stages.filter((x) => x.code !== 'reapply' || v.attempt_no > 1).filter((x) => !(['approved', 'rejected'].includes(x.code) && x.code !== v.stage && ['approved', 'rejected'].includes(v.stage)))
      .map((x) => ({ code: x.code, name: x.name, date: reached[x.code] ?? null, current: x.code === v.stage, done: x.sort < cur.sort && !!reached[x.code], text: x.code === v.stage && VISA_TEXT[x.code] ? VISA_TEXT[x.code](v) : null }));
    const list = [...types.filter((t) => !t.name.startsWith('Visa: Decision') && !t.name.startsWith('Visa: Cover letter')), ...(isDE && aps ? [aps] : [])];
    const checklist = [];
    for (const t of list) {
      const d = await StudentDocument.findOne({ student_id: s._id, document_type_id: t._id, is_deleted: false }).sort({ updatedAt: -1 }).lean();
      checklist.push({ type_id: String(t._id), name: t.name.replace(/^Visa: /, ''), status: d?.status ?? 'Pending', status_label: DOC_LABEL[d?.status ?? 'Pending'], doc: d?.current_version_id ? await docOut(d) : null, reason: docReason(d) });
    }
    cases.push({ id: String(v._id), application_id: v.application_id ?? null, code: v.visa_code, country: N.name(v.country_id), visa_type: v.visa_type ?? null, stage: v.stage, stage_name: stages.find((x) => x.code === v.stage)?.name ?? v.stage,
      attempt_no: v.attempt_no, previous_attempts: (v.attempts ?? []).map((a: Any) => ({ attempt_no: a.attempt_no, decision: a.decision, decision_date: a.decision_date })), timeline,
      appointment: v.appointment_at ? { at: v.appointment_at, centre: v.centre ?? null, reference: v.vfs_reference ?? null, map: v.centre ? `https://www.google.com/maps/search/${encodeURIComponent(v.centre)}` : null,
        carry: `${(await getSetting('visa_carry_' + v.country_id)) || ''} Original passport and all documents in the checklist. Reach at least 30 minutes early.`.trim(), ics: `/api/portal/calendar/visa/${v._id}.ics` } : null,
      funds: { type: v.funds_type ?? null, blocked_status: v.funds_type === 'Blocked account' ? v.blocked_account_status : null, provider: v.funds_type === 'Blocked account' ? v.blocked_provider : null },
      insurance_status: v.insurance_status ?? null, accommodation_status: v.accommodation_status ?? null,
      aps: isDE ? { status: v.aps_status ?? null, reference: v.aps_reference ?? null, date: v.aps_date ?? null, link: (await getSetting('aps_link')) || null } : null,
      decision: v.decision ? { decision: v.decision, date: v.decision_date, valid_from: v.valid_from, valid_to: v.valid_to, reason: v.decision === 'Rejected' && v.show_rejection_reason_to_student ? v.rejection_reason : null } : null,
      travel_date: v.stage === 'approved' ? v.travel_date ?? null : null, checklist, ready: checklist.filter((x) => ['Verified', 'Uploaded'].includes(x.status)).length });
  }
  const predeparture = cases.some((v) => v.stage === 'approved')
    ? (await Task.find({ student_id: s._id, type: 'Student action', is_deleted: false, visa_case_id: { $ne: null } }).sort({ due_at: 1 }).lean()).map((t) => ({ id: String(t._id), title: t.title, due_at: t.due_at, status: t.status })) : [];
  res.json({ cases, predeparture, has_offer: !!(await Application.exists({ student_id: s._id, is_deleted: false, stage: { $in: ['offer_accepted', 'tuition_paid', 'enrolment_confirmed'] } })) });
}));
const ownVisa = async (c: Ctx, id: string) => own(await VisaCase.findOne({ _id: oid(id), student_id: needStudent(c)._id, is_deleted: false }));
router.post('/visa/:id/upload', upload.array('files', 20), h(async (req, res) => {
  writable(req.c);
  const s = needStudent(req.c);
  const v = await ownVisa(req.c, req.params.id);
  const t = own(await MasterItem.findOne({ _id: oid(req.body?.document_type_id), type: 'document_type' }).lean());
  if (!(await typeInfo(t._id)).visa && t.name !== 'APS certificate') throw bad('Invalid document type');
  const r0 = await studentUpload(req, s, { typeId: t._id, visa_case_id: v._id, note: req.body?.note });
  await notifyStaff(req.c, 'doc_uploaded', `Visa document uploaded by ${displayName(req.c)}: ${t.name}`, `/students/${s._id}/visa`);
  res.json({ ...r0, message: 'Uploaded. La Europa will check it soon.' });
}));
router.post('/visa/:id/decision', upload.array('files', 5), h(async (req, res) => {
  writable(req.c);
  const s = needStudent(req.c);
  const v = await ownVisa(req.c, req.params.id);
  const b = req.body ?? {};
  if (!['Approved', 'Rejected'].includes(b.decision)) throw fieldErr('decision', 'Choose Approved or Rejected');
  if (!b.decision_date || b.decision_date > istDate()) throw fieldErr('decision_date', 'Enter the decision date (not in the future)');
  const r0 = await studentUpload(req, s, { typeName: 'Visa: Decision (visa copy / refusal letter)', visa_case_id: v._id, note: `Student reports: ${b.decision} on ${b.decision_date}` });
  const name = displayName(req.c);
  await notifyStaff(req.c, 'visa_decision', `HIGH PRIORITY: ${name} uploaded the visa decision (${b.decision}, ${fmtDate(b.decision_date)})`, `/students/${s._id}/visa`);
  const to = req.c.counsellorId ?? (await admin1());
  if (to) await createTask({ title: `Verify visa decision uploaded by ${name} (${b.decision})`, type: 'Visa appointment', student_id: s._id, visa_case_id: v._id, assigned_to: to,
    due_at: new Date(Date.now() + 4 * 3600e3), priority: 'High', is_system: true } as never, String(to));
  res.json({ ...r0, message: 'Thank you. Your counsellor will check it and update your visa status.' });
}));

// ---------- tasks ----------
router.get('/tasks', h(async (req, res) => {
  const c = req.c;
  if (!c.student) { res.json({ rows: [] }); return; }
  const N = await workNames();
  const open = (t: Any) => ['Open', 'In progress'].includes(t.status) && t.completed_by_type !== 'student';
  const rows = (await Task.find({ student_id: c.student._id, type: 'Student action', is_deleted: false }).sort({ due_at: 1 }).lean()).sort((a, b) => Number(!open(a)) - Number(!open(b)));
  res.json({ rows: await Promise.all(rows.map(async (t) => ({ id: String(t._id), title: t.title, description: t.description ?? null, due_at: t.due_at, priority: t.priority, created_by: N.user(t.assigned_by ?? t.created_by),
    linked: t.application_id ? { type: 'application', id: String(t.application_id), label: (await Application.findById(t.application_id).select('application_code').lean())?.application_code }
      : t.visa_case_id ? { type: 'visa', label: 'Visa' } : t.linked_document_type_id ? { type: 'document', label: N.name(t.linked_document_type_id) } : null,
    status: t.status === 'Done' ? (t.completed_by_type === 'student' ? 'Done (by you)' : 'Done (by La Europa)') : t.status === 'Cancelled' ? 'Cancelled' : t.completed_by_type === 'student' ? 'Done by you: waiting for confirmation' : 'To do',
    open: open(t), overdue_days: open(t) && t.due_at < new Date() ? Math.max(1, Math.floor((Date.now() - +t.due_at) / 864e5)) : 0,
    reopen_reason: t.status !== 'Done' ? t.reopen_reason ?? null : null, student_comment: t.student_comment ?? null }))) });
}));
router.post('/tasks/:id/done', upload.array('files', 5), h(async (req, res) => {
  writable(req.c);
  const s = needStudent(req.c);
  const t = own(await Task.findOne({ _id: oid(req.params.id), student_id: s._id, type: 'Student action', is_deleted: false }));
  if (!['Open', 'In progress'].includes(t.status) || t.completed_by_type === 'student') throw bad('This task is already done.');
  const comment = clean(req.body?.comment, 500);
  if (String(req.body?.comment ?? '').length > 500) throw bad('Comment: max 500 characters');
  if ((req.files as Express.Multer.File[] | undefined)?.length) await studentUpload(req, s, t.linked_document_type_id
    ? { typeId: t.linked_document_type_id, application_id: t.application_id, visa_case_id: t.visa_case_id, note: comment }
    : { typeName: 'Others', title: t.title, application_id: t.application_id, visa_case_id: t.visa_case_id, note: comment });
  const confirm = (await getSetting('student_task_confirm')) === '1';
  t.set(confirm ? { status: 'In progress', completed_by_type: 'student', student_comment: comment }
    : { status: 'Done', completed_at: new Date(), completed_by: undefined, completed_by_type: 'student', student_comment: comment, reopen_reason: undefined });
  await t.save();
  await studentTimeline(s._id, null, 'task', `Student completed: ${t.title}${comment ? ' (' + comment.slice(0, 120) + ')' : ''}`);
  for (const uid of new Set([t.assigned_to, t.assigned_by, t.created_by].filter(Boolean).map(String))) await notify(uid, 'task_done', `Student completed: ${t.title} (${displayName(req.c)})`, `/students/${s._id}/tasks`);
  if (!confirm) await trigger('E19', { student_id: s._id, ctx: { task_title: t.title }, noInApp: true });
  await portalAudit(req, 'Update', 'Task', t._id, 'Marked done by student');
  res.json({ ok: true });
}));

// ---------- chat ----------
const openPath = (attId: string) => `/api/portal/chatfile/${attId}`;
router.get('/chatfile/:aid', h(async (req, res) => {
  const a = await CHAT.attachment(req.params.aid) as Any;
  const cv = conv(req.c) as Any;
  if (!a || !((cv.student_id && String(a.student_id) === String(cv.student_id)) || (cv.lead_id && String(a.lead_id) === String(cv.lead_id)))) throw notFound('Not found');
  res.json({ url: a.url });
}));
router.get('/chat/messages', h(async (req, res) => {
  if (!req.c.student && !req.c.lead) { res.json({ rows: [] }); return; }
  const cv = conv(req.c);
  const rows = await CHAT.list(cv, { type: 'student', suId: String(req.su._id) }, { before: req.query.before as string | undefined, openPath });
  if (!req.preview) await CHAT.markRead(cv, 'student');
  res.json({ rows, ...(await counsellorCard(req.c)), office_hours_text: await getSetting('office_hours_text') });
}));
router.post('/chat/messages', upload.array('files', 5), h(async (req, res) => {
  writable(req.c);
  hit('chat:' + req.su._id, 30, 60e3);
  const cv = conv(req.c);
  const b = req.body ?? {};
  const ctxType = b.context_type, ctxId = oid(b.context_id);
  const s = req.c.student;
  if (ctxType) {
    const ok: Record<string, () => Promise<unknown>> = {
      course: async () => (await import('../models/Course')).default.exists({ _id: ctxId, status: 'Published' }),
      shortlist: async () => s && (await import('../models/Work')).Shortlist.exists({ _id: ctxId, student_id: s._id }),
      application: async () => s && Application.exists({ _id: ctxId, student_id: s._id }), request: async () => ApplicationRequest.exists({ _id: ctxId, student_user_id: req.su._id }),
      document: async () => s && StudentDocument.exists({ _id: ctxId, student_id: s._id }), task: async () => s && Task.exists({ _id: ctxId, student_id: s._id, type: 'Student action' }) };
    if (!ok[ctxType] || !(await ok[ctxType]())) throw notFound('Not found');
  }
  const id = await CHAT.send(cv, { type: 'student', userId: String(req.su._id) }, { body: b.body, context_type: ctxType, context_id: ctxId ? String(ctxId) : undefined, attachments: (req.files as Express.Multer.File[]) ?? [] });
  if (ctxType === 'shortlist') await (await import('../models/Work')).Shortlist.updateOne({ _id: ctxId, student_response: null }, { student_response: 'Question asked', student_response_at: new Date() });
  await notifyStaff(req.c, 'chat', `${displayName(req.c)}: ${String(b.body || 'Attachment').slice(0, 60)}`, s ? `/students/${s._id}/chat` : `/leads/${req.c.lead!._id}`);
  await portalAudit(req, 'Create', 'ChatMessage', id, 'Message sent');
  res.json({ id });
}));
async function ownMsg(req: PortalRequest, id: string) {
  const m = await ChatMessage.findById(oid(id)).lean();
  const cv = conv(req.c) as Any;
  if (!m || !((cv.student_id && String(m.student_id) === String(cv.student_id)) || (cv.lead_id && String(m.lead_id) === String(cv.lead_id)))) throw notFound('Not found');
}
router.patch('/chat/messages/:id', h(async (req, res) => { writable(req.c); await ownMsg(req, req.params.id); await CHAT.edit(req.params.id, { type: 'student', userId: String(req.su._id) }, req.body?.body); await portalAudit(req, 'Update', 'ChatMessage', req.params.id, 'Edited'); res.json({ ok: true }); }));
router.delete('/chat/messages/:id', h(async (req, res) => { await ownMsg(req, req.params.id); await CHAT.edit(req.params.id, { type: 'student', userId: String(req.su._id) }, null, true); await portalAudit(req, 'Delete', 'ChatMessage', req.params.id, 'Deleted'); res.json({ ok: true }); }));
router.post('/chat/read', h(async (req, res) => { if (!req.preview && (req.c.student || req.c.lead)) await CHAT.markRead(conv(req.c), 'student'); res.json({ ok: true }); }));

// ---------- notifications ----------
router.get('/notifications', h(async (req, res) => {
  const rows = await Notification.find({ userId: req.su._id, createdAt: { $gt: new Date(Date.now() - 180 * 864e5) } }).sort({ createdAt: -1 }).limit(req.query.all ? 300 : 20).lean();
  res.json({ rows: rows.map((n) => ({ id: String(n._id), title: n.title, link: n.link ?? null, is_read: n.read, created_at: n.createdAt })), unread: await Notification.countDocuments({ userId: req.su._id, read: false }),
    unread_chat: req.c.student || req.c.lead ? await CHAT.unread(conv(req.c), 'student') : 0 });
}));
router.post('/notifications/read', h(async (req, res) => {
  if (!req.preview) {
    if (req.body?.all) await Notification.updateMany({ userId: req.su._id }, { read: true });
    else await Notification.updateMany({ userId: req.su._id, _id: { $in: ((req.body?.ids ?? []) as unknown[]).map(oid).filter(Boolean) } }, { read: true });
  }
  res.json({ ok: true });
}));
const PREF_GROUPS: [string, string, boolean][] = [['applications', 'Application stages, offers and requests', false], ['documents', 'Documents requested / rejected', false], ['doc_verified', 'Document verified', true],
  ['payments', 'Payments and reminders', false], ['visa', 'Visa updates', false], ['tasks', 'Tasks', false], ['profile', 'Profile updates and change requests', true], ['chat', 'Unread chat message summary', true],
  ['account', 'Welcome, portal invite, counsellor changed', false], ['security', 'Security emails (codes, password)', false]];
const lastConsent = async (suId: unknown, type: string) => (await ConsentRecord.findOne({ student_user_id: suId, consent_type: type }).sort({ createdAt: -1 }).lean())?.value === 'yes';
router.get('/notification-preferences', h(async (req, res) => {
  const prefs = Object.fromEntries((await NotificationPreference.find({ student_user_id: req.su._id, channel: 'email' }).lean()).map((p) => [p.group_key, p.enabled]));
  res.json({ groups: PREF_GROUPS.map(([k, l, opt]) => ({ key: k, label: l, optional: opt, email: opt ? prefs[k] !== false : true })), marketing: await lastConsent(req.su._id, 'marketing') });
}));
router.put('/notification-preferences', h(async (req, res) => {
  const b = req.body ?? {};
  for (const [k, , opt] of PREF_GROUPS) if (opt && b.email && k in b.email) await NotificationPreference.updateOne({ student_user_id: req.su._id, group_key: k, channel: 'email' }, { enabled: !!b.email[k] }, { upsert: true });
  if (b.marketing !== undefined) await CONSENT.record(req, { suId: req.su._id, type: 'marketing', value: !!b.marketing, method: 'checkbox' });
  await portalAudit(req, 'Update', 'NotificationPreference', req.su._id, 'Preferences changed', null, b);
  res.json({ ok: true });
}));

// ---------- settings ----------
router.put('/settings/password', h(async (req, res) => {
  const su = await PortalAccount.findById(req.su._id).select('+password');
  if (!su) throw notFound();
  hit('pwchange:' + su._id, 5, 15 * 60e3);
  const b = req.body ?? {};
  if (!(await su.comparePassword(String(b.current ?? '')))) throw fieldErr('current', 'Current password is wrong');
  const problem = passwordProblem(String(b.password ?? ''), 'portal', [su.email, su.name, su.username]);
  if (problem) throw fieldErr('password', problem);
  if (b.password !== b.confirm) throw fieldErr('confirm', 'Passwords do not match');
  if (await su.comparePassword(String(b.password))) throw fieldErr('password', 'New password cannot be the same as your last password');
  su.password = String(b.password);
  su.passwordChangedAt = new Date(Date.now() - 2000); // other devices sign in again; this one gets a fresh token from the client
  await su.save();
  if (su.email) await sendSecurity({ to: su.email, subject: 'Your La Europa password was changed', text: `Your La Europa student portal password was changed on ${fmtDateTime(new Date())} IST.\nIf this was not you, contact your counsellor immediately.`, student_id: su.studentId, lead_id: su.leadId }).catch(() => {});
  await portalAudit(req, 'Update', 'StudentUser', su._id, 'Password changed');
  res.json({ ok: true, relogin: true });
}));
router.post('/me/verify/:what/send', h(async (req, res) => {
  if (req.params.what !== 'email') throw bad('Only email addresses are verified with a code.');
  hit('otp-ip:' + req.ip, 20, 864e5);
  if (!req.su.email) throw bad('Add your email first');
  res.json({ otp_id: await issueCode({ accountId: req.su._id as Types.ObjectId, email: req.su.email, purpose: 'verify_email', app: 'portal' }), masked: maskEmail(req.su.email) });
}));
router.post('/me/verify', h(async (req, res) => {
  const o = await checkCode(req.body?.otp_id, req.body?.code, 'verify_email');
  if (String(o.accountId) !== String(req.su._id)) throw notFound('Not found');
  await PortalAccount.updateOne({ _id: req.su._id }, { emailVerifiedAt: new Date() });
  await portalAudit(req, 'Update', 'StudentUser', req.su._id, 'Email verified');
  res.json({ ok: true });
}));
router.post('/settings/contact/start', h(async (req, res) => {
  writable(req.c);
  const b = req.body ?? {};
  const live = { _id: { $ne: req.su._id }, status: { $ne: 'Deactivated' } };
  if (b.type !== 'mobile') {
    const em = String(b.value ?? '').trim().toLowerCase();
    if (!isEmail(em)) throw fieldErr('value', 'Enter a valid email');
    if (await PortalAccount.exists({ ...live, email: em })) throw fieldErr('value', 'This email is already used by another account');
    res.json({ otp_id: await issueCode({ accountId: req.su._id as Types.ObjectId, email: em, purpose: 'contact_change', app: 'portal', payload: { type: 'email', value: em } }), masked: maskEmail(em) });
    return;
  }
  // a mobile change is confirmed by a code sent to the current email (no SMS)
  const cc = b.country_code || '+91', ph = normPhone(b.value);
  if (cc === '+91' && (ph ?? '').length !== 10) throw fieldErr('value', 'Enter a 10 digit mobile number');
  if (await PortalAccount.exists({ ...live, phoneNormalised: ph })) throw fieldErr('value', 'This number is already used by another account');
  if (!req.su.email) throw bad('Add your email first');
  res.json({ otp_id: await issueCode({ accountId: req.su._id as Types.ObjectId, email: req.su.email, purpose: 'contact_change', app: 'portal', payload: { type: 'mobile', value: ph, country_code: cc } }), masked: maskEmail(req.su.email) });
}));
router.post('/settings/contact/confirm', h(async (req, res) => {
  const o = await checkCode(req.body?.otp_id, req.body?.code, 'contact_change');
  if (String(o.accountId) !== String(req.su._id)) throw notFound('Not found');
  const c = req.c;
  const p = (o.payload ?? {}) as { type: string; value: string; country_code?: string };
  if (p.type === 'mobile') {
    await PortalAccount.updateOne({ _id: req.su._id }, { phone: p.value, phoneNormalised: p.value, countryCode: p.country_code });
    if (c.student) { await Student.updateOne({ _id: c.student._id }, { phone: p.value, phone_normalised: p.value, country_code: p.country_code }); await studentTimeline(c.student._id, null, 'profile', 'Changed by student: mobile number'); }
    else if (c.lead) await Lead.updateOne({ _id: c.lead._id }, { phone: p.value, phone_normalised: p.value, country_code: p.country_code });
    await portalAudit(req, 'Update', 'StudentUser', req.su._id, 'Mobile changed');
    res.json({ message: 'Your mobile number has been updated.' }); return;
  }
  if (c.student) { // the email is the thread address: the counsellor approves the change
    await PortalAccount.updateOne({ _id: req.su._id }, { pendingEmail: p.value });
    await P.createChangeRequest(req, c, { field_key: 'contact.email', new_value: p.value, reason: clean(req.body?.reason, 500) || 'Student changed email in Settings (verified by code)' });
    res.json({ message: 'Your new email is verified. It will be used after your counsellor approves the change.' }); return;
  }
  await PortalAccount.updateOne({ _id: req.su._id }, { email: p.value, emailVerifiedAt: new Date() });
  if (c.lead) await Lead.updateOne({ _id: c.lead._id }, { email: p.value, $unset: { email_thread_root_id: 1, email_thread_subject: 1, email_thread_refs: 1 } });
  await portalAudit(req, 'Update', 'StudentUser', req.su._id, 'Email changed');
  res.json({ message: 'Your email has been updated.' });
}));
router.put('/settings/details', h(async (req, res) => { // editable after submit: whatsapp, address, emergency contact
  writable(req.c);
  const allowed = ['whatsapp', 'address1', 'address2', 'city', 'state', 'pin', 'emergency_name', 'emergency_phone'];
  res.json({ ok: true, completion: await P.saveSection(req, req.c, 'personal', Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k))), false) });
}));
const CONSENT_TITLES: Record<string, string> = { communication: 'Service communication', marketing: 'Newsletters and offers', referral_contact: 'Friend referral', guardian: 'Parent / guardian consent', age_declaration: 'Age declaration',
  nomination: 'Nominee', sale_share_opt_out: 'Do not sell or share my data', limit_sensitive: 'Limit use of sensitive data', data_processing: 'Use of my personal data (Declaration 11.1)',
  share_data: 'Sharing with universities and for the visa (Declaration 11.2)', transfer_abroad: 'Transfer of my data outside India (Declaration 11.3)', success_stories: 'Success stories / publicity',
  application_consent: 'Application consent', promotion_terms: 'Promotion terms', share_with_university: 'Sharing with a university' };
router.get('/settings/consents', h(async (req, res) => res.json((await ConsentRecord.find({ student_user_id: req.su._id }).sort({ createdAt: -1 }).lean()).map((x) => ({ consent_type: x.consent_type,
  document_version: x.document_version ?? null, document_id: x.document_id ?? null, value: x.value, method: x.method ?? null, scrolled_to_end: x.scrolled_to_end ?? null, time_spent_sec: x.time_spent_sec ?? null,
  created_at: x.createdAt, title: CONSENT.TYPES[x.consent_type] ?? CONSENT_TITLES[x.consent_type] ?? x.consent_type })))));
router.get('/settings/consents/document/:id', h(async (req, res) => {
  const ok = await ConsentRecord.exists({ student_user_id: req.su._id, document_id: oid(req.params.id) });
  const d = ok ? await ConsentDocument.findById(oid(req.params.id)).lean() : null;
  if (!d) throw notFound('Not found');
  res.json({ title: d.title, version: d.version, published_at: d.published_at, hash: d.body_hash, text: await CONSENT.fill(d.body) });
}));
router.get('/settings/sessions', h(async (_req, res) => res.json([])));
router.post('/settings/sessions/logout-others', h(async (req, res) => {
  await PortalAccount.updateOne({ _id: req.su._id }, { passwordChangedAt: new Date(Date.now() - 2000) });
  await portalAudit(req, 'Logout', 'StudentUser', req.su._id, 'Logged out other devices');
  res.json({ ok: true, relogin: true });
}));

// ---------- account: deletion and my data ----------
async function reauth(req: PortalRequest) {
  hit('reauth:' + req.su._id, 5, 15 * 60e3);
  const su = await PortalAccount.findById(req.su._id).select('+password');
  if (!su || !(await su.comparePassword(String(req.body?.password ?? '')))) throw fieldErr('password', 'Please enter your password to confirm');
}
router.post('/account/delete-request', h(async (req, res) => {
  await reauth(req);
  if (await AccountDeletionRequest.exists({ student_user_id: req.su._id, status: 'Requested' })) throw bad('You already have a pending request.');
  const x = await AccountDeletionRequest.create({ student_user_id: req.su._id, reason: clean(req.body?.reason, 500), status: 'Requested' });
  const name = displayName(req.c);
  await notifyAdmins('deletion', `Account deletion request from ${name} (${studentCode(req.c)})`, '/admin/portal');
  if (req.c.counsellorId) await notify(req.c.counsellorId, 'deletion', `${name} asked to delete the portal account`, req.c.student ? `/students/${req.c.student._id}` : null);
  await portalAudit(req, 'Create', 'AccountDeletionRequest', x._id, 'Delete account requested');
  res.json({ ok: true });
}));
router.post('/account/delete-request/cancel', h(async (req, res) => {
  await AccountDeletionRequest.updateMany({ student_user_id: req.su._id, status: 'Requested' }, { status: 'Cancelled' });
  await portalAudit(req, 'Update', 'AccountDeletionRequest', req.su._id, 'Cancelled');
  res.json({ ok: true });
}));
router.get('/account/data-exports', h(async (req, res) => res.json((await DataExportRequest.find({ student_user_id: req.su._id }).sort({ createdAt: -1 }).limit(5).lean()).map((x) => ({ id: String(x._id),
  status: x.status === 'Ready' && x.expires_at && x.expires_at < new Date() ? 'Expired' : x.status, created_at: x.createdAt, ready_at: x.ready_at ?? null, expires_at: x.expires_at ?? null, downloaded_at: x.downloaded_at ?? null })))));
// the export is built when it is downloaded (nothing waits on disk); the request makes it available for 24 hours
router.post('/account/data-export', h(async (req, res) => {
  const last = await DataExportRequest.findOne({ student_user_id: req.su._id }).sort({ createdAt: -1 }).lean();
  if (last && Date.now() - +last.createdAt < 7 * 864e5) throw bad('You can request your data once every 7 days.');
  const x = await DataExportRequest.create({ student_user_id: req.su._id, status: 'Ready', ready_at: new Date(), expires_at: new Date(Date.now() + 864e5) });
  await studentNotify(req.su._id, 'Your data download is ready (valid for 24 hours)', '/settings');
  await portalAudit(req, 'Create', 'DataExportRequest', x._id, 'Data download requested');
  res.json({ id: String(x._id), message: 'Your data is ready. You can download it for 24 hours.' });
}));
router.post('/account/data-export/:id/download', h(async (req, res) => {
  await reauth(req);
  const x = own(await DataExportRequest.findOne({ _id: oid(req.params.id), student_user_id: req.su._id }));
  if (x.status !== 'Ready' || !x.expires_at || x.expires_at < new Date()) throw bad('This download has expired. Please request a new one.');
  x.downloaded_at = new Date(); await x.save();
  await portalAudit(req, 'Download', 'DataExportRequest', x._id, 'Data downloaded');
  const c = req.c;
  const N = await workNames();
  const data: Any = { exported_at: new Date(), account: { name: displayName(c), code: studentCode(c), email: req.su.email ?? null, phone: req.su.phone ?? null }, profile: await P.studentView(c) };
  const files: { name: string; url: string }[] = [];
  if (c.student) {
    const s = c.student;
    data.applications = await Promise.all((await Application.find({ student_id: s._id, is_deleted: false })).map(async (a) => ({ ...(await appOut(a, c, N)), history: (await StageHistory.find({ application_id: a._id }).lean()).map((x0) => ({ stage: x0.to_stage, date: x0.changed_at })) })));
    data.payments = (await Payment.find({ student_id: s._id, is_deleted: false }).lean()).map((p) => ({ payment_for: p.payment_for, amount: p.amount, currency: p.currency, payment_date: p.payment_date, mode: p.mode, reference_no: p.reference_no }));
    data.tasks = (await Task.find({ student_id: s._id, type: 'Student action', is_deleted: false }).lean()).map((t) => ({ title: t.title, description: t.description, due_at: t.due_at, status: t.status }));
    for (const d of await StudentDocument.find({ student_id: s._id, is_deleted: false, current_version_id: { $ne: null } }).lean()) {
      const v = curVer(d); const url = fileUrl(v);
      if (url && !v.removed_at && (d.shared_with_student || !['Fee receipt'].includes(N.name(d.document_type_id)))) files.push({ name: 'documents/' + (v.stored_name || `${d._id}.pdf`), url });
    }
  }
  data.chat = (await ChatMessage.find({ $or: [{ student_id: req.su.studentId ?? null }, { lead_id: req.su.leadId ?? null }], deleted_at: null }).sort({ sent_at: 1 }).lean()).map((m) => ({ sender_type: m.sender_type, body: m.body, sent_at: m.sent_at }));
  data.consents = (await ConsentRecord.find({ student_user_id: req.su._id }).lean()).map((r) => ({ consent_type: r.consent_type, document_version: r.document_version, value: r.value, created_at: r.createdAt }));
  data.requests = (await ApplicationRequest.find({ student_user_id: req.su._id }).lean()).map((q) => ({ code: q.request_code, course: q.course_name, status: q.status, requested_at: q.createdAt }));
  res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="la-europa-my-data.zip"');
  const z = new (archiver as unknown as { ZipArchive: new (o: object) => archiver.Archiver }).ZipArchive({ zlib: { level: 6 } });
  z.pipe(res);
  z.append(JSON.stringify(data, null, 2), { name: 'my-data.json' });
  const sum = c.student ? (await academicSummary(c.student)).line : '';
  z.append(`La Europa Education: my data\nName: ${data.account.name}\nID: ${data.account.code}\nExported: ${fmtDateTime(new Date())} IST\n\n${sum}\n`, { name: 'README.txt' });
  for (const f of files) { const r = await fetch(f.url); if (r.ok) z.append(Buffer.from(await r.arrayBuffer()), { name: f.name }); }
  await z.finalize();
}));

// ---------- privacy and my data (DPDP Act 2023 and the other regimes the client lists) ----------
const privOut = (x: Any) => ({ id: String(x._id), code: x.request_code, type: x.type, label: CONSENT.REQ_LABEL[x.type] ?? x.type, details: x.details ?? null, status: x.status, due_at: x.due_at ?? null,
  response: x.response ?? null, created_at: x.createdAt, handled_at: x.handled_at ?? null });
router.get('/privacy', h(async (req, res) => {
  const su = req.su;
  const docs = [];
  for (const t of ['student_consent', 'constitution', 'web_privacy', 'web_refund', 'web_cookies']) { const d = await CONSENT.current(t); if (d) docs.push({ type: t, title: d.title, version: d.version }); }
  res.json({ requests: (await PrivacyRequest.find({ student_user_id: su._id }).sort({ createdAt: -1 }).lean()).map(privOut), types: CONSENT.REQ_LABEL,
    nomination: ((su.flags as Any)?.nomination as Any) ?? null,
    contacts: { privacy_email: (await getSetting('privacy_email')) || null, grievance_officer: (await getSetting('grievance_officer_name')) || null, grievance_email: (await getSetting('grievance_officer_email')) || null,
      grievance_phone: (await getSetting('grievance_officer_phone')) || null, dpo: (await getSetting('dpo_contact')) || null },
    marketing: await lastConsent(su._id, 'marketing'), shared_with: await sharedWith(su.studentId), reply_days: await replyDays(), restricted: !!(su.flags as Any)?.processing_restricted_at, documents: docs });
}));
router.post('/privacy/requests', h(async (req, res) => {
  const b = req.body ?? {};
  const type = String(b.type ?? '');
  if (!CONSENT.REQ_LABEL[type]) throw fieldErr('type', 'Choose what you want to do');
  const details = clean(b.details, 2000);
  if (['correction', 'objection', 'restriction', 'grievance', 'other'].includes(type) && !details) throw fieldErr('details', 'Please tell us a little more');
  if (await PrivacyRequest.exists({ student_user_id: req.su._id, type, status: { $in: ['Open', 'In progress'] } })) throw bad('You already have an open request of this type. We will reply soon.');
  hit('privreq:' + req.su._id, 10, 864e5);
  const due = type === 'grievance' ? await grievanceDue() : new Date(Date.now() + (CONSENT.DUE_DAYS[type] || 30) * 864e5);
  const code = `LE-P-${new Date().getFullYear()}-${String((await PrivacyRequest.countDocuments()) + 1).padStart(5, '0')}`;
  let status = 'Open', response: string | undefined;
  const done = async (t: string, value: boolean, text: string) => { status = 'Completed'; response = text; await CONSENT.record(req, { suId: req.su._id, type: t, value, method: 'privacy_center' }); };
  // what the student gets straight away
  if (type === 'opt_out_sale') await done('sale_share_opt_out', true, 'La Europa does not sell your personal information and does not share it for cross-context behavioural advertising. Your opt-out is recorded and will apply if this ever changes.');
  if (type === 'limit_sensitive') await done('limit_sensitive', true, 'Your sensitive personal information (passport number, finances) is used only to provide the service you asked for. Your request to limit its use to that purpose is recorded.');
  if (type === 'withdraw_consent' && b.consent_type === 'marketing') await done('marketing', false, 'You will no longer receive newsletters or event invitations.');
  if (type === 'objection' && b.consent_type === 'marketing') await done('marketing', false, 'Direct marketing stopped.');
  const x = await PrivacyRequest.create({ request_code: code, student_user_id: req.su._id, student_id: req.su.studentId, lead_id: req.su.leadId, type,
    details: [b.consent_type ? `Consent: ${b.consent_type}` : null, details].filter(Boolean).join('\n') || undefined, jurisdiction: clean(b.jurisdiction, 40), status, due_at: due, response,
    handled_at: status === 'Completed' ? new Date() : undefined });
  if (status === 'Open') {
    const name = displayName(req.c);
    await notifyAdmins('privacy', `Privacy request ${code} (${CONSENT.REQ_LABEL[type]}) from ${name}: reply by ${fmtDate(istDate(due))}`, '/admin/privacy');
    if (req.c.counsellorId) await notify(req.c.counsellorId, 'privacy', `${name} sent a privacy request (${CONSENT.REQ_LABEL[type]})`, '/admin/privacy');
  }
  if (req.su.email) await sendSecurity({ to: req.su.email, subject: `We received your privacy request ${code}`, student_id: req.su.studentId, lead_id: req.su.leadId,
    text: `We received your request: ${CONSENT.REQ_LABEL[type]}.\nReference: ${code}\n${status === 'Completed' ? 'Status: completed. ' + response : `We will reply by ${fmtDate(istDate(due))} at the latest.`}\n\nYou can follow it in the student portal (Privacy & my data).` }).catch(() => {});
  await portalAudit(req, 'Create', 'PrivacyRequest', x._id, `${code} ${type}`);
  res.json({ ok: true, request: privOut(x.toObject()), message: status === 'Completed' ? response : `Request ${code} sent. We will reply by ${fmtDate(istDate(due))}.` });
}));
router.post('/privacy/requests/:id/cancel', h(async (req, res) => {
  const x = own(await PrivacyRequest.findOne({ _id: oid(req.params.id), student_user_id: req.su._id }));
  if (x.status !== 'Open') throw bad('This request is already being handled.');
  x.status = 'Withdrawn'; await x.save();
  await portalAudit(req, 'Update', 'PrivacyRequest', x._id, 'Withdrawn by student');
  res.json({ ok: true });
}));
// DPDP Act s.14: a nominee who may exercise the rights in case of death or incapacity
router.put('/privacy/nomination', h(async (req, res) => {
  const b = req.body ?? {};
  const flags = { ...((req.su.flags ?? {}) as Any) };
  if (b.revoke) { delete flags.nomination; await PortalAccount.updateOne({ _id: req.su._id }, { flags }); await portalAudit(req, 'Update', 'Nomination', req.su._id, 'Revoked'); res.json({ ok: true }); return; }
  const errors: Record<string, string> = {};
  if (!clean(b.nominee_name)) errors.nominee_name = 'Name is required';
  if (!isEmail(String(b.nominee_email ?? '').trim())) errors.nominee_email = 'Enter a valid email';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  flags.nomination = { nominee_name: clean(b.nominee_name, 100), relation: clean(b.relation, 40), nominee_email: String(b.nominee_email).trim().toLowerCase(), nominee_phone: clean(b.nominee_phone, 20), created_at: new Date() };
  await PortalAccount.updateOne({ _id: req.su._id }, { flags });
  await CONSENT.record(req, { suId: req.su._id, type: 'nomination', value: true, method: 'privacy_center', extra: { nominee: flags.nomination.nominee_name } });
  await portalAudit(req, 'Create', 'Nomination', req.su._id, 'Nominee saved');
  res.json({ ok: true });
}));
// sharing an application with a partner university: the university portal is on hold, so there is nothing to consent to yet
router.get('/share-consents', h(async (_req, res) => res.json({ rows: [], text: null, fields: [] })));

// ---------- referrals ----------
router.get('/referrals', h(async (req, res) => {
  if ((await getSetting('referral_enabled')) === '0') { res.json({ enabled: false }); return; }
  const code = req.su.referralCode;
  const link = `${env.portalUrl}/signup?ref=${code}`;
  const rows = [];
  for (const x of await Referral.find({ referrer_student_user_id: req.su._id, is_deleted: false }).sort({ createdAt: -1 }).lean()) {
    const s = await referralStatus(x as never);
    rows.push({ name: x.friend_name, created_at: x.createdAt, status: s === 'Already known' ? 'Received' : s, promo_code: x.promo_code ?? null, reward_given: !!x.reward_given_at });
  }
  res.json({ enabled: true, code, link, qr: await QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: '#0B1020', light: '#FFFFFF' } }), rows });
}));
router.post('/referrals', h(async (req, res) => {
  if ((await getSetting('referral_enabled')) === '0') throw bad('Referrals are not available.');
  writable(req.c);
  hit('referral:' + req.su._id, 10, 864e5);
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!clean(b.first_name) || !/^[A-Za-z .]+$/.test(b.first_name) || b.first_name.length > 50) errors.first_name = "Friend's first name is required (letters only)";
  const cc = b.country_code || '+91', ph = normPhone(b.phone);
  if (!ph || (cc === '+91' && ph.length !== 10)) errors.phone = 'Enter a 10 digit mobile number';
  if (b.email && !isEmail(b.email)) errors.email = 'Enter a valid email';
  if (!b.consent) errors.consent = 'Please confirm your friend agrees to be contacted';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const c = req.c;
  const me = `${displayName(c)} (${studentCode(c)})`;
  const consentId = await CONSENT.record(req, { suId: req.su._id, type: 'referral_contact', value: true, method: 'checkbox' });
  const em = b.email ? String(b.email).trim().toLowerCase() : undefined;
  let leadId: Types.ObjectId | undefined; let status = 'Received';
  if ((await leadDuplicates(ph, em)).length) status = 'Already known';
  else {
    const src = await MasterItem.findOne({ type: 'lead_source', name: 'Referral' }).select('_id').lean();
    const eng = await pick('lead', { source_id: src ? String(src._id) : undefined });
    const assigned = eng.user_id ?? c.counsellorId ?? undefined;
    const l = await Lead.create({ lead_code: await nextCode('L'), first_name: clean(b.first_name, 50), last_name: clean(b.last_name, 50), country_code: cc, phone: ph, phone_normalised: ph, is_whatsapp: true,
      email: em, source_id: src?._id, referred_by: me, course_interest: clean(b.interest, 150), status: 'New', assigned_user_id: assigned });
    leadId = l._id as Types.ObjectId;
    await studentTimeline(null, leadId, 'lead', `Lead created from a portal referral by ${me}`);
    if (l.assigned_user_id) await notify(l.assigned_user_id, 'assigned', `New referral lead: ${l.first_name} (referred by ${me})`, `/leads/${leadId}`);
    else await notifyAdmins('assigned', `New referral lead needs a counsellor: ${l.first_name} (referred by ${me})`, `/leads/${leadId}`);
    if (em) await trigger('E01', { lead_id: leadId, ctx: { interested_country: clean(b.interest, 100) || 'studying abroad' } });
  }
  await Referral.create({ referrer_student_user_id: req.su._id, referrer_student_id: c.student?._id, friend_name: `${clean(b.first_name, 50)} ${clean(b.last_name, 50) ?? ''}`.trim(), friend_phone: ph,
    friend_email: em, interest: clean(b.interest, 150), lead_id: leadId, status, consent_record_id: consentId });
  await portalAudit(req, 'Create', 'Referral', leadId ?? null, 'Referral submitted');
  res.json({ message: `Thank you for referring ${clean(b.first_name, 50)}! Our team will contact them soon.` });
}));

// ---------- calendar (.ics) ----------
router.get('/calendar/:kind/:file', h(async (req, res) => {
  const s = needStudent(req.c);
  const id = oid(req.params.file.replace(/\.ics$/, ''));
  const N = await workNames();
  let start: Date | undefined, title = '', loc = '';
  if (req.params.kind === 'interview') { const a = own(await Application.findOne({ _id: id, student_id: s._id }).lean()); start = a.interview_at; title = `Interview: ${N.name(a.university_id)}`; loc = a.interview_link ?? ''; }
  else { const v = own(await VisaCase.findOne({ _id: id, student_id: s._id }).lean()); start = v.appointment_at; title = `Visa appointment (${N.name(v.country_id)})`; loc = v.centre ?? ''; }
  if (!start) throw notFound('Not found');
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="la-europa.ics"');
  res.send(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Europa Education//Portal//EN', 'BEGIN:VEVENT', `UID:${id}@laeuropa`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`,
    `DTEND:${f(new Date(+start + 3600e3))}`, `SUMMARY:${title.replace(/[,;]/g, ' ')}`, `LOCATION:${loc.replace(/[,;]/g, ' ')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
}));

void Country; void fullName; void guardianOf; void (null as unknown as AuthRequest);
export default router;
