import { Router, type Response } from 'express';
import { Types } from 'mongoose';
import { portalAuth, type PortalRequest } from '../middleware/portal';
import type { AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import Student from '../models/Student';
import User from '../models/User';
import Course, { type ICourse } from '../models/Course';
import University from '../models/University';
import Task from '../models/Task';
import Notification from '../models/Notification';
import PortalAccount from '../models/PortalAccount';
import { Country, MasterItem } from '../models/Master';
import { nextCode } from '../models/Timeline';
import { getSetting } from '../models/Audit';
import { Application, Shortlist, StageHistory, VisaCase, StudentDocument, FeeSummary, Payment, type IApplication } from '../models/Work';
import { ApplicationRequest, REQUEST_OPEN, SavedCourse, ProfileChangeRequest, OfferCondition, FeeInstruction, AccountDeletionRequest, type IApplicationRequest } from '../models/Portal';
import { HttpError, bad, fieldErr, notFound, handle, oid, clean, istDate, addDays, fmtDateTime, maskPassport, fullName } from '../services/crm';
import { stageList as rawStages } from '../services/masters';
import { fmtDate } from '../services/invoicePdf';
const stageList = async (t: 'app_stage' | 'visa_stage') => (await rawStages(t)).map((x) => ({ ...x, code: String(x.code), sort: Number(x.sort) || 0 }));
import { createTask, closeSystemTask } from '../services/tasks';
import { trigger } from '../services/email';
import { uploadBuffer } from '../config/cloudinary';
import { checkFile, docFor, addVersion, mergeToPdf, fileUrl, ALLOWED } from '../services/files';
import { displayName, studentCode, studentTimeline, portalAudit, notifyStaff, completion, journey, counsellorCard, type Ctx } from '../services/portalCtx';
import * as P from '../services/profile';
import * as CAT from '../services/catalogue';
import * as CONSENT from '../services/consent';
import { academicSummary } from '../services/students';
import * as SIGN from '../services/signing';
import { sendSecurity } from '../services/email';
import { claim as claimPromo, checkCode, suggestedCode } from '../services/rewards';
import { unread as chatUnread } from '../services/portalChat';
import { CodeError } from '../services/authCodes';
import { workNames, checklistFor, systemStage, INST_DOCS, INST_NAMES, CLOSED, type Names } from './work';

/** The student portal API (legacy/server/portal/routes.js). Records of other students answer 404; responses are whitelisted "student view" objects. */
const router = Router();
router.use(portalAuth);
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type PH = (req: PortalRequest, res: Response) => Promise<unknown>;
const h = (fn: PH) => handle(async (req, res) => { try { await fn(req as PortalRequest, res); } catch (e) { if (e instanceof CodeError) throw new HttpError(e.status, e.message); throw e; } });
const own = <T>(row: T): NonNullable<T> => { if (!row) throw notFound('Not found'); return row as NonNullable<T>; };
const needStudent = (c: Ctx) => { if (!c.student) throw bad('Available after your registration with La Europa.', { locked: true }); return c.student; };
const writable = (c: Ctx) => { if (c.readOnly) throw bad('Your file is currently inactive. Contact your counsellor to restart.'); };
const leadIds = (c: Ctx) => [c.lead?._id, c.student?.lead_id].filter(Boolean);
const hits = new Map<string, number[]>();
/** The client's A.hit(): at most `max` calls per window for one key. */
function hit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Too many requests. Please wait a little and try again.');
  list.push(t); hits.set(key, list);
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 864e5)) hits.delete(k); }, 3600e3).unref();
const docStatus = async (s: { _id: unknown } | null, rx: RegExp) => {
  if (!s) return null;
  const types = await MasterItem.find({ type: 'document_type', name: rx }).select('_id').lean();
  return (await StudentDocument.findOne({ student_id: s._id, document_type_id: { $in: types.map((t) => t._id) }, is_deleted: false }).select('status').lean())?.status ?? null;
};

// ---------- me / ping ----------
async function meOut(r: PortalRequest) {
  const { su, c } = r;
  return { id: String(su._id), name: displayName(c), first_name: c.student?.first_name ?? c.lead?.first_name ?? '', code: studentCode(c), account_type: c.student ? 'student' : 'lead',
    email: su.email ?? null, email_verified: !!su.emailVerifiedAt, phone: su.phone ? `${su.countryCode ?? ''} ${su.phone}`.trim() : null, mobile_verified: !!su.mobileVerifiedAt, status: su.status,
    read_only: c.readOnly, profile_submitted: !!su.profileSubmittedAt, has_photo: !!su.avatar, language: su.language ?? 'en', referral_code: su.referralCode ?? null,
    needs_consent: (await CONSENT.missing(su._id)).length > 0, missing_consents: await CONSENT.missing(su._id), is_minor: !!guardianOf(c),
    settings: { referral: (await getSetting('referral_enabled')) !== '0', zip: (await getSetting('zip_download')) !== '0', idle_min: Number(await getSetting('portal_idle_min')) || 60 } };
}
const guardianOf = (c: Ctx) => ((c.su.flags as Any)?.guardian ?? (c.lead as Any)?.signup?.guardian ?? null) as { name?: string; relation?: string; email?: string } | null;
router.get('/me', h(async (req, res) => {
  const c = req.c;
  res.json({ ...(await meOut(req)), preview: req.preview, completion: await completion(c),
    unread_notifications: await Notification.countDocuments({ userId: req.su._id, read: false }),
    unread_chat: c.student ? await chatUnread({ student_id: c.student._id as Types.ObjectId }, 'student') : c.lead ? await chatUnread({ lead_id: c.lead._id as Types.ObjectId }, 'student') : 0,
    pending_deletion: !!(await AccountDeletionRequest.exists({ student_user_id: req.su._id, status: 'Requested' })) });
}));
router.post('/ping', h(async (_req, res) => { res.json({ ok: true, idle_min: Number(await getSetting('portal_idle_min')) || 60 }); }));

// ---------- consent gate (the signed Student Declaration & Consent comes with the signing module) ----------
const views = new Map<string, number>(); // `${suId}:${docId}` -> when the document was first sent (server-side reading time)
setInterval(() => { const t = Date.now(); for (const [k, v] of views) if (t - v > 6 * 3600e3) views.delete(k); }, 3600e3).unref();
export const readingViews = views;
const MIN_READ_SEC: Record<string, number> = { master: 20, advisory: 15, terms: 5, privacy: 5, student_consent: 30 };
router.get('/consent/status', h(async (req, res) => {
  const miss = await CONSENT.missing(req.su._id);
  const docs: Any = {};
  for (const t of miss) {
    const d = await CONSENT.publicDoc(t);
    if (!d) continue;
    docs[t] = d;
    const k = `${req.su._id}:${d.id}`;
    if (!views.has(k) && !req.preview) views.set(k, Date.now());
  }
  const g = guardianOf(req.c);
  res.json({ missing: miss, docs, first_time: !(await CONSENT.hasSigned(req.su._id)), is_minor: !!g, guardian: g?.name ?? null,
    guardian_info: g ? { name: g.name ?? '', relation: g.relation ?? '', email: g.email ?? '' } : null, email_masked: req.su.email ? maskEmail(req.su.email) : null, min_read_sec: MIN_READ_SEC });
}));
const maskEmail = (e: string) => { const [u, d] = e.split('@'); return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`; };
router.post('/consent/accept', h(async (req, res) => {
  const b = req.body ?? {};
  const type = String(b.type ?? '');
  if (!CONSENT.REQUIRED.includes(type)) throw bad('Unknown document');
  if (type === 'student_consent') throw bad('This document is signed with your typed name and the code sent to your email.', { code: 'needs_signature' });
  const d = await CONSENT.current(type);
  if (!d || b.document_id !== String(d._id)) throw bad('A newer version of this document was published. Please read it again.', { code: 'stale' });
  if (!b.scrolled_to_end) throw bad('Please scroll to the end of the document before accepting.');
  if (!b.confirm) throw bad('Please tick that you have read and understood the document.');
  const started = views.get(`${req.su._id}:${d._id}`);
  const serverSec = started ? Math.round((Date.now() - started) / 1000) : 0;
  if (serverSec < (MIN_READ_SEC[type] || 5)) throw bad('Please take a moment to read the document before accepting.');
  await CONSENT.record(req, { suId: req.su._id, leadId: req.su.leadId, type, value: true, method: 'document_screen', scrolled: true, timeSpent: b.time_spent_sec,
    extra: { server_reading_sec: serverSec, scroll_percent: Math.min(100, Math.max(0, Number(b.scroll_percent) || 100)) } });
  views.delete(`${req.su._id}:${d._id}`);
  await portalAudit(req, 'Create', 'ConsentRecord', req.su._id, `Accepted ${CONSENT.TYPES[type]} v${d.version}`);
  res.json({ ok: true, missing: await CONSENT.missing(req.su._id) });
}));
router.post('/consent/decline', h(async (req, res) => {
  const type = String(req.body?.type ?? '');
  if (!CONSENT.REQUIRED.includes(type)) throw bad('Unknown document');
  await CONSENT.record(req, { suId: req.su._id, leadId: req.su.leadId, type, value: false, method: 'declined_on_screen', extra: { reason: clean(req.body?.reason, 500) } });
  await notifyStaff(req.c, 'portal', `${displayName(req.c)} declined the ${CONSENT.TYPES[type]}: please contact the student`);
  await portalAudit(req, 'Create', 'ConsentRecord', req.su._id, `Declined ${CONSENT.TYPES[type]}`);
  res.json({ ok: true, message: 'Your counsellor has been told and will contact you. You can read and accept the document any time to use the portal.' });
}));

// ---------- the signed Student Declaration & Consent: typed name + email code, one locked PDF ----------
router.post('/consent/sign/code', h(async (req, res) => {
  if (req.preview) throw bad('Staff preview cannot sign for the student.');
  hit('otp-ip:' + req.ip, 20, 864e5);
  const whoFor = req.body?.who === 'guardian' ? 'guardian' : 'student';
  const o = await SIGN.sendCode(req.su, whoFor, guardianOf(req.c), req.body?.guardian_email);
  await portalAudit(req, 'Create', 'SigningCode', req.su._id, `Signing code sent by email to the ${whoFor}`);
  res.json(o);
}));
router.post('/consent/sign', h(async (req, res) => {
  if (req.preview) throw bad('Staff preview cannot sign for the student.');
  hit('sign:' + req.su._id, 10, 3600e3);
  const pack = await CONSENT.signPack();
  const started = pack ? views.get(`${req.su._id}:${pack.consent._id}`) : undefined;
  const serverSec = started ? Math.round((Date.now() - started) / 1000) : 0;
  const out = await SIGN.sign(req, req.su, !!guardianOf(req.c), req.body ?? {}, serverSec);
  const rec = out.record;
  const ver = (out.record.data as Any) ?? {};
  const extra = { signed_document: rec.doc_code, signature_name: rec.typed_name, content_hash: rec.content_hash, server_reading_sec: serverSec };
  const base = { suId: req.su._id, leadId: req.su.leadId };
  await CONSENT.record(req, { ...base, type: 'student_consent', value: true, method: 'signed_email_otp', scrolled: true, timeSpent: req.body?.time_spent_sec, extra });
  await CONSENT.record(req, { ...base, type: 'constitution', value: true, method: 'signed_with_student_consent', scrolled: !!req.body?.constitution_opened, extra });
  // signing gives the Declaration's own consents (11.1 to 11.3); news (D) and publicity (E) are separate optional choices
  for (const [t, sec] of [['data_processing', '11.1'], ['share_data', '11.2'], ['transfer_abroad', '11.3']]) await CONSENT.record(req, { ...base, type: t, value: true, method: 'signed_email_otp', extra: { section: sec, signed_document: rec.doc_code } });
  for (const [k, t] of [['D', 'marketing'], ['E', 'success_stories']]) await CONSENT.record(req, { ...base, type: t, value: !!out.consents[k], method: 'portal_optional_choice', extra: { choice: k, signed_document: rec.doc_code } });
  if (pack) views.delete(`${req.su._id}:${pack.consent._id}`);
  await portalAudit(req, 'Create', 'SignedDocument', rec._id, `Signed ${CONSENT.TYPES.student_consent} v${ver.consent_version} + Constitution v${ver.constitution_version} (${rec.doc_code})`);
  const line = `Student signed the Student Declaration & Consent v${ver.consent_version} (Constitution v${ver.constitution_version}) with email OTP: ${rec.doc_code}, signed PDF locked`;
  if (req.c.student) await studentTimeline(req.c.student._id, null, 'profile', line); else if (req.c.lead) await studentTimeline(null, req.c.lead._id, 'lead', line);
  // a copy by email to the student, and to the guardian for a student under 18
  const att = [{ filename: `La-Europa-Signed-Consent-${rec.doc_code}.pdf`, content: out.pdf, contentType: 'application/pdf' }];
  const body = `Thank you. You signed the La Europa Student Declaration & Consent (version ${ver.consent_version}) under the Student Constitution (version ${ver.constitution_version}) on ${fmtDateTime(rec.signed_at)} IST.\n\nDocument ID: ${rec.doc_code}\nThe signed and locked PDF is attached. You can download it again at any time in the student portal (Account).`;
  if (req.su.email) await sendSecurity({ to: req.su.email, subject: `Your signed La Europa Student Declaration & Consent (${rec.doc_code})`, text: body, student_id: req.su.studentId, lead_id: req.su.leadId, attachments: att }).catch(() => {});
  const g = ver.guardian as { email?: string; name?: string } | null;
  if (g?.email) await sendSecurity({ to: g.email, subject: `Signed La Europa Student Declaration & Consent (${rec.doc_code})`, text: body.replace('Thank you. You signed', `Thank you. You and ${rec.typed_name} signed`), student_id: req.su.studentId, lead_id: req.su.leadId, attachments: att }).catch(() => {});
  res.json({ ok: true, doc_code: rec.doc_code, signed_at: rec.signed_at, pdf_sha256: rec.pdf_sha256, pages: ver.pdf_pages, missing: await CONSENT.missing(req.su._id) });
}));
router.get('/consent/certificate.pdf', h(async (req, res) => {
  const sd = await (await import('../models/Privacy')).SignedDocument.findOne({ student_user_id: req.su._id }).sort({ signed_at: -1 });
  if (!sd) throw new HttpError(404, 'You have not signed the Student Declaration & Consent yet');
  const pdf = await SIGN.readLocked(sd);
  await portalAudit(req, 'Download', 'SignedDocument', sd._id, sd.doc_code);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `attachment; filename="La-Europa-Signed-Consent-${sd.doc_code}.pdf"`);
  res.send(pdf);
}));

// ---------- photo, language ----------
router.put('/me/language', h(async (req, res) => { await PortalAccount.updateOne({ _id: req.su._id }, { language: 'en' }); res.json({ ok: true }); }));
router.post('/me/photo', upload.single('photo'), h(async (req, res) => {
  writable(req.c);
  if (!req.file) throw bad('Choose a photo');
  const { ext } = checkFile(req.file, ['jpg', 'jpeg', 'png'], 2);
  void ext;
  const up = await uploadBuffer(req.file, `portal/${req.su._id}/photo`);
  await PortalAccount.updateOne({ _id: req.su._id }, { avatar: up.url });
  await portalAudit(req, 'Update', 'StudentUser', req.su._id, 'Profile photo');
  res.json({ ok: true });
}));
router.get('/me/photo', h(async (req, res) => { if (!req.su.avatar) { res.status(404).end(); return; } res.json({ url: req.su.avatar }); }));
router.get('/counsellor-photo', h(async (req, res) => {
  const u = req.c.counsellorId ? await User.findById(req.c.counsellorId).select('avatar').lean() : null;
  if (!u?.avatar) { res.status(404).end(); return; }
  res.json({ url: u.avatar });
}));

// ---------- profile wizard ----------
async function summaryLine(c: Ctx) {
  if (c.student) { const s = await academicSummary(c.student); return { line: s.line, experience: s.experience.label }; }
  const p = await P.readAll(c);
  const sc = (a: Any) => (a ? (a.score_type === '%' || !a.score_type ? `${a.score}%` : `${a.score} CGPA`) : '-');
  const rec = (l: string[]) => p.academic.records.find((a: Any) => l.includes(a.level));
  const t10 = rec(['10th']), t12 = rec(['12th', 'Diploma']), ba = rec(['Bachelor']), ma = rec(['Master']);
  const t = p.english.tests.find((x: Any) => x.overall !== null && x.overall !== undefined);
  const mm = (ym?: string) => (ym ? ym.split('-').reverse().join('/') : '');
  const country = p.preferences.country_ids?.[0] ? (await Country.findById(p.preferences.country_ids[0]).select('name').lean())?.name : null;
  return { line: [`10th: ${t10 ? `${sc(t10)} (${t10.pass_year || '-'})` : '-'}`, `12th: ${t12 ? `${sc(t12)}${t12.board_university ? ', ' + t12.board_university : ''} (${t12.pass_year || '-'})` : '-'}`,
    `Bachelor: ${ba ? `${ba.course_name || ''}, ${sc(ba)} (${ba.pass_year || '-'})` : '-'}`, `Backlogs: ${ba ? ba.backlogs_total ?? '-' : '-'}`, `Master: ${ma ? `${ma.course_name || ''}, ${sc(ma)}` : '-'}`,
    `Work exp: ${p.work.rows?.length ? p.work.rows.map((w: Any) => `${mm(w.from_month)} to ${w.till_date ? 'till date' : mm(w.to_month)}`).join(', ') : '-'}`,
    `${t ? t.test_type.replace(' Academic', '') : 'English'}: ${t ? `${t.overall}${t.listening !== null && t.listening !== undefined ? ` (L${t.listening} R${t.reading} W${t.writing} S${t.speaking})` : ''}` : '-'}`,
    `Country: ${country || '-'}`, `Course: ${p.preferences.course || '-'}`].join(' | '), experience: null };
}
router.get('/profile', h(async (req, res) => {
  const c = req.c;
  const v = await P.studentView(c) as Any;
  if (c.student && v.passport) v.passport.passport_masked = maskPassport(v.passport.passport);
  const exp = v.passport?.passport_expiry && new Date(v.passport.passport_expiry) < new Date(Date.now() + 548 * 864e5);
  res.json({ data: v, locks: await P.locks(c), completion: await completion(c), summary: await summaryLine(c),
    account: { email: req.su.email ?? null, email_verified: !!req.su.emailVerifiedAt, phone: req.su.phone ? `${req.su.countryCode ?? ''} ${req.su.phone}`.trim() : null, mobile_verified: !!req.su.mobileVerifiedAt },
    warnings: exp ? ['Your passport expires soon. Many embassies need at least 12 months validity after your course starts.'] : [], budgets: Object.keys(P.BUDGETS),
    passport_doc: await docStatus(c.student, /^Passport$/), english_doc: await docStatus(c.student, /^English test score/) });
}));
router.put('/profile/:section', h(async (req, res) => res.json({ ok: true, completion: await P.saveSection(req, req.c, req.params.section, req.body?.data ?? {}, !!req.body?.strict) })));
router.post('/profile/submit', h(async (req, res) => res.json(await P.submit(req, req.c))));
router.get('/profile/change-requests', h(async (req, res) => {
  if (!req.c.student) { res.json([]); return; }
  res.json((await ProfileChangeRequest.find({ student_id: req.c.student._id, is_deleted: false }).sort({ createdAt: -1 }).lean()).map((x) => ({ id: String(x._id), field_key: x.field_key, field_label: x.field_label,
    old_value: x.old_value ?? null, new_value: x.new_value ?? null, reason: x.reason, status: x.status, reject_reason: x.reject_reason, created_at: x.createdAt, reviewed_at: x.reviewed_at })));
}));
router.post('/profile/change-requests', upload.single('file'), h(async (req, res) => {
  writable(req.c);
  const s = needStudent(req.c);
  const b = req.body ?? {};
  let value: unknown = b.new_value;
  try { value = JSON.parse(b.new_value); } catch { /* plain string */ }
  let docId: Types.ObjectId | undefined;
  if (req.file) {
    const tname = String(b.field_key).startsWith('english.') ? 'English test score (IELTS / TOEFL / PTE / Duolingo)' : 'Others';
    const t = await MasterItem.findOne({ type: 'document_type', name: tname }).lean();
    if (t) {
      const { ext } = checkFile(req.file, ['pdf', 'jpg', 'jpeg', 'png'], 10);
      const doc = await docFor(s._id as Types.ObjectId, t._id as Types.ObjectId, { title: tname === 'Others' ? `Change request: ${P.LABELS[String(b.field_key).split('.').pop()!] ?? b.field_key}` : undefined });
      await addVersion(doc, req.file, ext, String(req.su._id), 'student');
      docId = doc._id as Types.ObjectId;
    }
  }
  const id = await P.createChangeRequest(req, req.c, { field_key: b.field_key, new_value: value, reason: b.reason, document_id: docId });
  if (docId) await StudentDocument.updateOne({ _id: docId }, { linked_change_request_id: id });
  res.json({ id, message: 'Change requested: waiting for counsellor approval.' });
}));
router.post('/profile/change-requests/:id/cancel', h(async (req, res) => {
  const cr = own(req.c.student && await ProfileChangeRequest.findOne({ _id: oid(req.params.id), student_id: req.c.student._id, status: 'Pending' }));
  cr.status = 'Cancelled by student'; await cr.save();
  await portalAudit(req, 'Update', 'ProfileChangeRequest', cr._id, 'Cancelled by student');
  res.json({ ok: true });
}));

// ---------- applications: one flow (application stages, visa stages, enrolment) ----------
const STAGE_TEXT: Record<string, (a: IApplication) => string> = {
  documents_pending: () => 'We need a few documents to apply.', ready_to_apply: () => 'All your documents are ready. La Europa is preparing your application.',
  applied: (a) => `La Europa submitted your application on ${fmtDate(a.applied_date)}. Universities usually take a few weeks to respond.`, under_review: () => 'The university is reviewing your application.',
  interview: (a) => `Interview / test on ${a.interview_at ? fmtDateTime(a.interview_at) : '-'}. Mode / link: ${a.interview_link || 'your counsellor will share it'}.`,
  conditional_offer: () => 'Congratulations! You have a conditional offer.', unconditional_offer: () => 'Congratulations! You have an unconditional offer.',
  rejected: () => 'The university has not accepted this application. Your counsellor will discuss other options with you.', offer_accepted: () => 'Your acceptance has been recorded. Next step is the tuition fee / deposit.',
  tuition_paid: () => 'Your payment has been recorded.', enrolment_confirmed: () => 'Your enrolment is confirmed by the university.', withdrawn: () => 'This application has been withdrawn.', offer_declined: () => 'You declined this offer.',
};
const VISA_TEXT: Record<string, (v: Any) => string> = {
  appointment_booked: (v) => `Visa appointment on ${v.appointment_at ? fmtDateTime(v.appointment_at) : '-'}${v.centre ? ` at ${v.centre}` : ''}.`,
  submitted: () => 'Your visa application is submitted. The embassy will decide.', approved: () => 'Your visa is approved. Congratulations!',
  rejected: (v) => `The visa was refused.${v.show_rejection_reason_to_student && v.rejection_reason ? ` Reason: ${v.rejection_reason}.` : ''} Your counsellor will advise the next step.`,
};
const OFFER_STAGES = ['conditional_offer', 'unconditional_offer'];
const docReason = (d?: { status?: string; rejection_reason?: string; rejection_text?: string } | null) => (d?.status === 'Rejected' ? [d.rejection_reason, d.rejection_text].filter(Boolean).join(': ') : null);
const checkOut = (i: Any) => ({ type_id: i.document_type_id, name: i.name, required: i.required, status: i.doc ? i.doc.status : 'Pending', reason: docReason(i.doc) });
async function appOut(a: IApplication, c: Ctx, N: Names, detail = false) {
  const stages = await stageList('app_stage');
  const st = stages.find((s) => s.code === a.stage) ?? { name: a.stage, color: '#64748b' };
  const o: Any = { id: String(a._id), code: a.application_code, university: N.name(a.university_id), course: a.course_name_text || N.name(a.course_id), country: N.name(a.country_id),
    country_code: a.country_id ? (await Country.findById(a.country_id).select('code').lean())?.code ?? null : null, level: a.level, intake: N.name(a.intake_id), stage: a.stage, stage_name: st.name,
    stage_color: (st as Any).color, applied_date: a.applied_date ?? null, deadline: a.deadline ?? null, updated_at: a.updatedAt ?? a.createdAt, offer_response: a.student_offer_response ?? null,
    offer_response_at: a.student_offer_response_at ?? null, next_step: STAGE_TEXT[a.stage] ? STAGE_TEXT[a.stage](a).split('.')[0] + '.' : '' };
  if (a.show_university_ref_to_student) o.university_app_id = a.university_app_id;
  if (detail) Object.assign(o, await appDetail(a, c, N, stages));
  return o;
}
async function appDetail(a: IApplication, c: Ctx, N: Names, stages: Any[]) {
  const hist = await StageHistory.find({ application_id: a._id }).sort({ changed_at: 1 }).lean();
  const reached: Record<string, Any> = {};
  for (const x of hist) reached[x.to_stage] = x;
  const closed = CLOSED.includes(a.stage);
  const cur = stages.find((s) => s.code === a.stage) ?? { sort: 0, name: a.stage };
  const timeline: Any[] = stages.filter((s) => !CLOSED.includes(s.code)).map((s) => ({ code: s.code, name: s.name, done: closed ? !!reached[s.code] : s.sort < cur.sort && (!!reached[s.code] || s.code !== 'interview'),
    current: s.code === a.stage, date: reached[s.code]?.changed_at ?? null, text: s.code === a.stage && STAGE_TEXT[s.code] ? STAGE_TEXT[s.code](a) : null, reason: reached[s.code]?.show_reason_to_student ? reached[s.code].reason : null }));
  if (closed) { const x = reached[a.stage]; timeline.push({ code: a.stage, name: cur.name, current: true, done: false, date: x?.changed_at ?? null, text: STAGE_TEXT[a.stage](a), reason: x?.show_reason_to_student ? x.reason : null }); }
  else {
    const ei = timeline.findIndex((x) => x.code === 'enrolment_confirmed');
    const enr = ei >= 0 ? timeline.splice(ei, 1)[0] : null;
    const v = await VisaCase.findOne({ application_id: a._id, is_deleted: false }).sort({ createdAt: -1 }).lean();
    if (v) for (const x of timeline) { x.current = false; x.text = null; x.done = !!reached[x.code] || x.code !== 'interview'; }
    const vstages = await stageList('visa_stage');
    const vh: Record<string, Date> = {};
    if (v) for (const x of await StageHistory.find({ visa_case_id: v._id, attempt_no: v.attempt_no }).sort({ changed_at: 1 }).lean()) vh[x.to_stage] = x.changed_at;
    const vcur = v ? vstages.find((x) => x.code === v.stage) ?? { sort: 0 } : null;
    for (const s of vstages) {
      if (s.code === 'reapply' && !(v && v.attempt_no > 1)) continue;
      if (['approved', 'rejected'].includes(s.code) && (v ? ['approved', 'rejected'].includes(v.stage) && s.code !== v.stage : s.code === 'rejected')) continue;
      const isCur = !!v && s.code === v.stage;
      timeline.push({ code: 'visa_' + s.code, name: s.name, done: !!v && s.sort < vcur!.sort && !!vh[s.code], current: isCur, date: vh[s.code] ?? null, text: isCur && VISA_TEXT[s.code] ? VISA_TEXT[s.code](v) : null, reason: null });
    }
    if (enr) { const ok = v?.stage === 'approved'; enr.done = a.stage === 'enrolment_confirmed' && ok; enr.current = a.stage === 'enrolment_confirmed' && !enr.done && (!v || ok); if (!enr.current) enr.text = null; timeline.push(enr); }
  }
  const types = new Map((await MasterItem.find({ type: 'document_type' }).select('name').lean()).map((t) => [String(t._id), t.name]));
  const shared = await StudentDocument.find({ application_id: a._id, is_deleted: false, shared_with_student: true, current_version_id: { $ne: null } }).sort({ updatedAt: -1 }).lean();
  const cv = (d: Any) => d.versions.find((x: Any) => String(x._id) === String(d.current_version_id));
  const offerDoc = shared.find((d) => ['Offer letter', 'Conditional offer letter', 'Unconditional offer letter'].includes(types.get(String(d.document_type_id)) ?? ''));
  const sameIntake = await Application.findOne({ student_id: a.student_id, intake_id: a.intake_id ?? null, _id: { $ne: a._id }, is_deleted: false,
    $or: [{ stage: { $in: ['offer_accepted', 'tuition_paid', 'enrolment_confirmed'] } }, { student_offer_response: 'Accepted' }] }).select('university_id').lean();
  const instr = await FeeInstruction.findOne({ application_id: a._id, is_published: true, is_deleted: false }).sort({ published_at: -1 }).lean();
  const instrDoc = instr?.document_id ? await StudentDocument.findById(instr.document_id).lean() : null;
  const uni = N.name(a.university_id);
  return { timeline, interview_at: a.interview_at ?? null, interview_link: a.interview_link ?? null, offer_type: a.offer_type ?? null,
    offer_conditions: [...OFFER_STAGES, 'offer_accepted'].includes(a.stage) ? a.offer_conditions ?? null : null, offer_deadline: a.offer_deadline ?? null,
    deposit_required: a.deposit_required ?? null, deposit_currency: a.deposit_currency ?? null, app_fee: a.app_fee ?? null, app_fee_currency: a.app_fee_currency ?? null, app_fee_paid: !!a.app_fee_paid,
    offer_letter: offerDoc ? { id: String(offerDoc._id), view_url: fileUrl(cv(offerDoc)), download_url: fileUrl(cv(offerDoc)) } : null,
    conditions: (await OfferCondition.find({ application_id: a._id, is_deleted: false }).sort({ createdAt: 1 }).lean()).map((x) => ({ id: String(x._id), text: x.text, status: x.status, proof_document_id: x.proof_document_id ?? null })),
    can_accept: OFFER_STAGES.includes(a.stage) && !sameIntake && a.student_offer_response !== 'Accepted', accepted_elsewhere: sameIntake ? N.name(sameIntake.university_id) : null,
    can_undo_accept: a.student_offer_response === 'Accepted' && OFFER_STAGES.includes(a.stage),
    fee_instructions: instr ? { amount: instr.amount, currency: instr.currency, due_date: instr.due_date, pay_to: instr.pay_to, instructions_html: sanitize(instr.instructions_html),
      file_url: instrDoc?.current_version_id ? fileUrl(cv(instrDoc)) : null } : null,
    university_documents: shared.filter((d) => INST_NAMES.has(types.get(String(d.document_type_id)) ?? '')).map((d) => ({ id: String(d._id), name: types.get(String(d.document_type_id)), view_url: fileUrl(cv(d)), download_url: fileUrl(cv(d)), date: d.updatedAt })),
    can_decline: [...OFFER_STAGES, 'offer_accepted'].includes(a.stage),
    documents: c.student ? (await checklistFor(c.student, N, a.country_id)).map(checkOut) : [],
    updates: (await Notification.find({ userId: c.su._id, link: /^\/applications/, title: new RegExp(uni.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || '^$') }).sort({ createdAt: -1 }).limit(10).lean()).map((n) => ({ title: n.title, created_at: n.createdAt })) };
}
const sanitize = (x?: string) => String(x ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/javascript:/gi, '');

// ---------- dashboard: one aggregated call ----------
router.get('/dashboard', h(async (req, res) => {
  const { c, su } = req;
  const s = c.student;
  const N = await workNames();
  const today = istDate(), d30 = addDays(today, 30);
  const out: Any = { name: displayName(c), first_name: s?.first_name ?? c.lead?.first_name ?? '', account_type: s ? 'student' : 'lead', code: studentCode(c), read_only: c.readOnly,
    completion: await completion(c), journey: await journey(c), ...(await counsellorCard(c)), profile_submitted: !!su.profileSubmittedAt, email_verified: !!su.emailVerifiedAt };
  out.requests_open = await ApplicationRequest.countDocuments({ student_user_id: su._id, status: { $in: REQUEST_OPEN }, is_deleted: false });
  out.saved_count = await SavedCourse.countDocuments({ student_user_id: su._id, removed_at: null });
  out.updates = (await Notification.find({ userId: su._id }).sort({ createdAt: -1 }).limit(10).lean()).map((n) => ({ id: String(n._id), title: n.title, link: n.link ?? null, is_read: n.read, created_at: n.createdAt }));
  const dl: Any[] = [];
  if (s) {
    const apps = await Application.find({ student_id: s._id, is_deleted: false }).sort({ updatedAt: -1 });
    out.applications = await Promise.all(apps.slice(0, 3).map((a) => appOut(a, c, N)));
    out.applications_total = apps.length;
    const list = (await checklistFor(s, N)).filter((i) => i.required === 'Yes');
    const pend = list.filter((i) => !i.doc || ['Pending', 'Rejected'].includes(i.doc.status)).sort((a, b) => Number(b.doc?.status === 'Rejected') - Number(a.doc?.status === 'Rejected'));
    out.documents = { verified: list.filter((i) => i.doc?.status === 'Verified').length, total: list.length, pending: pend.slice(0, 5).map(checkOut), pending_count: pend.length };
    out.tasks = (await Task.find({ student_id: s._id, type: 'Student action', status: { $in: ['Open', 'In progress'] }, completed_by_type: null, is_deleted: false }).sort({ due_at: 1 }).limit(6).lean())
      .map((t) => ({ id: String(t._id), title: t.title, due_at: t.due_at, priority: t.priority, overdue_days: t.due_at < new Date() ? Math.max(1, Math.floor((Date.now() - +t.due_at) / 864e5)) : 0, due_today: istDate(t.due_at) === today }));
    for (const x of await Shortlist.find({ student_id: s._id, is_deleted: false, status: 'Student agreed', application_id: null, deadline: { $gte: today, $lte: d30 } }).lean()) dl.push({ date: x.deadline, title: `Application deadline: ${N.name(x.university_id)}`, link: '/shortlist' });
    for (const a of apps) {
      if (a.deadline && ['documents_pending', 'ready_to_apply'].includes(a.stage) && a.deadline >= today && a.deadline <= d30) dl.push({ date: a.deadline, title: `Application deadline: ${N.name(a.university_id)}`, link: `/applications/${a._id}` });
      if (a.offer_deadline && a.offer_deadline >= today && a.offer_deadline <= d30 && OFFER_STAGES.includes(a.stage)) dl.push({ date: a.offer_deadline, title: `Offer acceptance deadline: ${N.name(a.university_id)}`, link: `/applications/${a._id}` });
      if (a.interview_at && a.interview_at >= new Date() && istDate(a.interview_at) <= d30) dl.push({ date: a.interview_at.toISOString(), title: `Interview: ${N.name(a.university_id)}`, link: `/applications/${a._id}`, ics: `/api/portal/calendar/interview/${a._id}.ics` });
    }
    for (const f of await FeeSummary.find({ student_id: s._id, is_deleted: false, deposit_deadline: { $gte: today, $lte: d30 } }).lean()) dl.push({ date: f.deposit_deadline, title: 'Deposit deadline', link: '/payments' });
    for (const v of await VisaCase.find({ student_id: s._id, is_deleted: false }).lean()) {
      if (v.appointment_at && v.appointment_at >= new Date() && istDate(v.appointment_at) <= d30) dl.push({ date: v.appointment_at.toISOString(), title: `Visa appointment: ${v.centre ?? ''}`, link: '/visa', ics: `/api/portal/calendar/visa/${v._id}.ics` });
      if (v.aps_date && v.aps_date >= today && v.aps_date <= d30) dl.push({ date: v.aps_date, title: 'APS date', link: '/visa' });
    }
    for (const t of out.tasks) if (istDate(t.due_at) <= d30) dl.push({ date: t.due_at.toISOString(), title: `Task due: ${t.title}`, link: '/tasks' });
    const overdue = [];
    for (const f of await FeeSummary.find({ student_id: s._id, is_deleted: false, deposit_deadline: { $lt: today } }).lean()) {
      const [p] = await Payment.aggregate([{ $match: { student_id: s._id, application_id: f.application_id ?? null, payment_for: 'Tuition fee / deposit', is_deleted: false, currency: f.currency } }, { $group: { _id: null, s: { $sum: '$amount' } } }]);
      if ((f.total_amount || 0) - (f.scholarship || 0) - (p?.s ?? 0) > 0) overdue.push(f.application_id ? N.name((await Application.findById(f.application_id).select('university_id').lean())?.university_id) || 'Deposit' : 'Deposit');
    }
    if (overdue.length) out.payment_overdue = overdue.join(', ');
  } else out.locked = true;
  for (const q of await ApplicationRequest.find({ student_user_id: su._id, status: { $in: REQUEST_OPEN }, deadline: { $gte: today, $lte: d30 } }).lean()) dl.push({ date: q.deadline, title: `Deadline: ${N.name(q.university_id)} (request)`, link: '/applications' });
  out.deadlines = dl.map((x): Any => ({ ...x, days_left: Math.round((+new Date(istDate(new Date(x.date))) - +new Date(today)) / 864e5) })).sort((a: Any, b: Any) => String(a.date).localeCompare(String(b.date))).slice(0, 12);
  res.json(out);
}));
router.post('/callback', h(async (req, res) => {
  const c = req.c;
  writable(c);
  hit('callback:' + req.su._id, 3, 864e5);
  const assignee = c.counsellorId ?? (await User.findOne({ role: 'admin', isActive: true }).select('_id').lean())?._id;
  if (assignee) await createTask({ title: `Call back requested: ${displayName(c)}`, type: 'Follow-up call', lead_id: c.lead?._id, student_id: c.student?._id, assigned_to: assignee, due_at: new Date(Date.now() + 3600e3), priority: 'High', is_system: true } as never, String(assignee));
  await notifyStaff(c, 'portal', `${displayName(c)} requested a call back on the portal`);
  res.json({ message: 'Thank you. We will call you back soon.' });
}));

// ---------- courses ----------
router.get('/courses/filters', h(async (req, res) => {
  const p = await P.readAll(req.c);
  const tests = p.english.tests.filter((t: Any) => t.overall !== null && t.overall !== undefined);
  res.json({ ...(await CAT.filterOptions()), defaults: { country: p.preferences.country_ids?.[0] ? String(p.preferences.country_ids[0]) : '', level: ['Bachelor', 'Master'].includes(p.preferences.level) ? p.preferences.level : p.preferences.level ? 'Other' : '' },
    my_test: tests[0] ? { test: tests[0].test_type.split(' ')[0], score: tests[0].overall } : null });
}));
// after the profile is submitted the student sees only the courses they are eligible for, unless Admin set "eligible first"
router.get('/courses', h(async (req, res) => {
  hit('search:' + req.su._id, 60, 60e3);
  const done = !!req.su.profileSubmittedAt;
  const strict = done && (await getSetting('course_view_after_profile')) !== 'all';
  const q: Any = { ...req.query };
  const mode = strict || (done && q.eligible === '1') ? 'eligible' : 'all';
  if (mode === 'eligible') q.eligible = '1';
  const out = await CAT.search(req.c, q);
  let hidden = 0;
  if (done && mode === 'eligible') hidden = (await CAT.search(req.c, { ...q, eligible: '', page: 1000 })).rows.filter((x: Any) => x.eligibility?.overall === 'no').length;
  res.json({ ...out, mode, strict, profile_done: done, hidden_not_eligible: hidden, completion: done ? null : (await completion(req.c)).percent });
}));
const published = (id: unknown) => Course.findOne({ _id: oid(id), is_deleted: false, status: 'Published' });
router.get('/courses/:id', h(async (req, res) => res.json({ ...(await CAT.courseOut(own(await published(req.params.id)), req.c, { detail: true })), scholarships: [] })));
router.post('/saved-courses/:courseId', h(async (req, res) => {
  writable(req.c);
  const course = own(await published(req.params.courseId));
  if (await SavedCourse.exists({ student_user_id: req.su._id, course_id: course._id, removed_at: null })) { res.json({ ok: true }); return; }
  if ((await SavedCourse.countDocuments({ student_user_id: req.su._id, removed_at: null })) >= 50) throw bad('You can save up to 50 courses. Remove one first.');
  await SavedCourse.create({ student_user_id: req.su._id, student_id: req.su.studentId, course_id: course._id });
  await portalAudit(req, 'Create', 'SavedCourse', course._id, 'Saved course');
  res.json({ ok: true, message: 'Saved to your shortlist' });
}));
router.delete('/saved-courses/:courseId', h(async (req, res) => {
  await SavedCourse.updateMany({ student_user_id: req.su._id, course_id: oid(req.params.courseId), removed_at: null }, { removed_at: new Date() });
  res.json({ ok: true });
}));

// ---------- shortlist ----------
const SL_LABEL: Record<string, string> = { 'Shared with student': 'New suggestion: please respond', 'Student agreed': 'You accepted', 'Rejected by student': 'You rejected', 'Converted to application': 'Application started' };
router.get('/shortlist', h(async (req, res) => {
  const c = req.c;
  const N = await workNames();
  const facts = await CAT.studentFacts(c);
  const savedIds = new Set((await SavedCourse.find({ student_user_id: req.su._id, removed_at: null }).select('course_id').lean()).map((x) => String(x.course_id)));
  const suggested = [];
  if (c.student) for (const x of await Shortlist.find({ student_id: c.student._id, is_deleted: false, status: { $ne: 'Suggested' } }).sort({ shared_at: -1, createdAt: -1 }).lean()) {
    const course = x.course_id ? await Course.findById(x.course_id) : null;
    const uni = x.university_id ? await University.findById(x.university_id).lean() : null;
    const live = course?.status === 'Published' && !course.is_deleted;
    suggested.push({ id: String(x._id), course_id: x.course_id ?? null, country: N.name(x.country_id), university: N.name(x.university_id), course: x.course_name_text || N.name(x.course_id), level: x.level,
      intake: N.name(x.intake_id), tuition_fee: x.tuition_fee, currency: x.currency, application_fee: x.application_fee, app_fee_currency: x.app_fee_currency, deadline: x.deadline ?? null,
      deadline_passed: !!(x.deadline && x.deadline < istDate()), duration: x.duration, language: x.language, course_link: x.course_link, priority: x.show_priority_to_student ? x.priority : null,
      remark_for_student: x.remark_for_student ?? null, status: x.status, status_label: SL_LABEL[x.status] ?? x.status, student_response: x.student_response ?? null, student_response_reason: x.student_response_reason ?? null,
      application_id: x.application_id ?? null, is_new: x.status === 'Shared with student' && !x.student_response,
      can_undo: x.status === 'Rejected by student' && !!x.student_response_at && Date.now() - +x.student_response_at < 7 * 864e5, saved: !!(x.course_id && savedIds.has(String(x.course_id))),
      eligibility: live ? await CAT.eligibility(c, course!, facts) : null, catalogue: live, logo: uni ? CAT.logoOf(uni) : null, city: uni?.city ?? null,
      req: course ? (await CAT.courseOut(course, null)).req ?? null : null, intake_deadline_days: x.deadline ? Math.round((+new Date(x.deadline) - +new Date(istDate())) / 864e5) : null });
  }
  const sug = new Set(suggested.map((x) => String(x.course_id)).filter(Boolean));
  const saved = [];
  for (const sc of await SavedCourse.find({ student_user_id: req.su._id, removed_at: null }).sort({ saved_at: -1 }).lean()) {
    if (sug.has(String(sc.course_id))) continue;
    const course = await published(sc.course_id);
    if (course) saved.push(await CAT.courseOut(course, c, { facts }));
  }
  res.json({ suggested, saved });
}));
async function loadSl(c: Ctx, id: string) { const s = needStudent(c); return own(await Shortlist.findOne({ _id: oid(id), student_id: s._id, is_deleted: false, status: { $ne: 'Suggested' } })); }
const slLabel = async (x: { university_id?: unknown; course_name_text?: string; course_id?: unknown }) => { const N = await workNames(); return `${N.name(x.university_id)} ${x.course_name_text || N.name(x.course_id)}`; };
router.post('/shortlist/:id/accept', h(async (req, res) => {
  writable(req.c);
  const x = await loadSl(req.c, req.params.id);
  if (x.deadline && x.deadline < istDate()) throw bad('Deadline passed. Ask your counsellor about the next intake.');
  if (!['Shared with student', 'Rejected by student'].includes(x.status)) throw bad('This option cannot be accepted now.');
  x.set({ status: 'Student agreed', student_response: 'Accepted', student_response_reason: undefined, student_response_at: new Date() }); await x.save();
  const label = await slLabel(x);
  await studentTimeline(req.c.student!._id, null, 'profile', `Student accepted shortlist option: ${label}`);
  await notifyStaff(req.c, 'portal', `${displayName(req.c)} accepted ${label}`, `/students/${req.c.student!._id}/shortlist`);
  await portalAudit(req, 'Update', 'Shortlist', x._id, 'Accepted');
  res.json({ message: 'Great! Your counsellor will start this application.' });
}));
const SL_REASONS = ['Not interested in this course', 'Too expensive', 'Do not like the city / country', 'Already applied elsewhere', 'Other'];
router.post('/shortlist/:id/reject', h(async (req, res) => {
  writable(req.c);
  const x = await loadSl(req.c, req.params.id);
  const b = req.body ?? {};
  if (!SL_REASONS.includes(b.reason)) throw fieldErr('reason', 'Choose a reason');
  if (b.reason === 'Other' && !clean(b.text)) throw fieldErr('text', 'Please write the reason');
  if (!['Shared with student', 'Student agreed'].includes(x.status)) throw bad('This option cannot be rejected now.');
  const reason = b.reason === 'Other' ? clean(b.text, 300)! : b.reason;
  x.set({ status: 'Rejected by student', student_response: 'Rejected', student_response_reason: reason, student_response_at: new Date() }); await x.save();
  const label = await slLabel(x);
  await studentTimeline(req.c.student!._id, null, 'profile', `Student rejected shortlist option: ${label} (${reason})`);
  await notifyStaff(req.c, 'portal', `${displayName(req.c)} rejected ${label}: ${reason}`, `/students/${req.c.student!._id}/shortlist`);
  await portalAudit(req, 'Update', 'Shortlist', x._id, 'Rejected: ' + reason);
  res.json({ ok: true });
}));
router.post('/shortlist/:id/undo', h(async (req, res) => {
  writable(req.c);
  const x = await loadSl(req.c, req.params.id);
  if (x.status !== 'Rejected by student' || !x.student_response_at || Date.now() - +x.student_response_at > 7 * 864e5) throw bad('Undo is possible within 7 days of rejecting.');
  x.set({ status: 'Shared with student', student_response: undefined, student_response_reason: undefined, student_response_at: undefined }); await x.save();
  await notifyStaff(req.c, 'portal', `${displayName(req.c)} undid the rejection of ${(await workNames()).name(x.university_id)}`, `/students/${req.c.student!._id}/shortlist`);
  res.json({ ok: true });
}));

// ---------- Apply Now ----------
type OpenIntake = { id: string; intake_id?: string | null; deadline?: string | null; label: string; open?: boolean };
async function applyChecks(c: Ctx, course: ICourse, intake: OpenIntake | null) {
  const { su, student: s } = c;
  if (c.readOnly) throw bad('Your file is currently inactive. Contact your counsellor to restart.', { code: 'A10' });
  if (!su.emailVerifiedAt) throw bad('Please verify your email before sending a request.', { code: 'A5' });
  if (!su.profileSubmittedAt) throw bad('Please complete and submit your profile first.', { code: 'A6', link: '/wizard/1' });
  const open = await ApplicationRequest.countDocuments({ student_user_id: su._id, status: { $in: REQUEST_OPEN }, is_deleted: false });
  if (open >= (Number(await getSetting('req_open_limit')) || 5)) throw bad(`You already have ${open} requests being reviewed. Please wait for your counsellor or cancel one.`, { code: 'A1' });
  if (!intake) return;
  if (intake.deadline && intake.deadline < istDate()) throw bad('The deadline for this intake has passed. Please choose another intake.', { code: 'A7' });
  const per = await ApplicationRequest.countDocuments({ student_user_id: su._id, intake_id: intake.intake_id ? oid(intake.intake_id) : null, is_deleted: false, status: { $ne: 'Cancelled by student' } });
  if (per >= (Number(await getSetting('req_intake_limit')) || 10)) throw bad('You have reached the request limit for this intake.', { code: 'A1' });
  if (await ApplicationRequest.exists({ student_user_id: su._id, course_id: course._id, 'eligibility_snapshot.course_intake_id': intake.id, status: { $in: REQUEST_OPEN }, is_deleted: false })) throw bad(`You have already requested this course for ${intake.label}.`, { code: 'A2' });
  if (s && intake.intake_id && await Application.exists({ student_id: s._id, course_id: course._id, intake_id: oid(intake.intake_id), is_deleted: false, stage: { $nin: CLOSED } })) throw bad(`You have already requested this course for ${intake.label}.`, { code: 'A2' });
}
router.get('/apply/:courseId', h(async (req, res) => {
  const c = req.c;
  const course = own(await published(req.params.courseId));
  await applyChecks(c, course, null);
  const co = await CAT.courseOut(course, c, { detail: true }) as Any;
  const openIntakes = (co.intakes as OpenIntake[]).filter((i) => i.open);
  if (!openIntakes.length) throw bad('There is no open intake for this course. Ask your counsellor.', { code: 'A7' });
  const pref = String((await P.readAll(c)).preferences.intake_id ?? '');
  const N = await workNames();
  const docs = c.student ? (await checklistFor(c.student, N, co.country?.id)).map(checkOut) : [];
  const accepted = !!c.student && !!(await Application.exists({ student_id: c.student._id, intake_id: { $in: openIntakes.map((i) => oid(i.intake_id)).filter(Boolean) }, is_deleted: false, stage: { $in: ['offer_accepted', 'tuition_paid', 'enrolment_confirmed'] } }));
  res.json({ course: co, intakes: openIntakes, preselect: (openIntakes.find((i) => String(i.intake_id) === pref) ?? openIntakes[0]).id, documents: docs, lead_account: !c.student,
    offer_already_accepted: accepted, suggested_promo: await suggestedCode(leadIds(c)) });
}));
router.post('/application-requests', h(async (req, res) => {
  const c = req.c;
  const b = req.body ?? {};
  hit('apply:' + req.su._id, 20, 60e3);
  if (b.idempotency_key) { const ex = await ApplicationRequest.findOne({ idempotency_key: String(b.idempotency_key).slice(0, 80) }).lean(); if (ex && String(ex.student_user_id) === String(req.su._id)) { res.json({ id: String(ex._id), request_code: ex.request_code, duplicate: true }); return; } }
  if (!b.understood) throw fieldErr('understood', 'Please tick the confirmation box');
  if (!b.apply_consent) throw fieldErr('apply_consent', 'Please give your consent for this application');
  const course = own(await published(b.course_id));
  const intakes = await CAT.intakesOf(course) as OpenIntake[];
  const ci = own(intakes.find((i) => i.id === String(b.course_intake_id)));
  await applyChecks(c, course, ci);
  const uni = own(await University.findById(course.university_id).lean());
  const promoCode = clean(b.promo_code, 20);
  if (promoCode) {
    await checkCode(promoCode, { suId: String(req.su._id), leadIds: leadIds(c), university_id: course.university_id, country_id: uni.country_id });
    if (!b.promo_terms) throw fieldErr('promo_terms', 'Please accept the terms and conditions of the offer');
  }
  const elig = await CAT.eligibility(c, course) as Any;
  const N = await workNames();
  const missingDocs = c.student ? (await checklistFor(c.student, N, uni.country_id)).filter((i) => i.required === 'Yes' && (!i.doc || ['Pending', 'Rejected'].includes(i.doc.status))).map((i) => i.name) : [];
  const code = await nextCode('R');
  let q: IApplicationRequest;
  try {
    q = await ApplicationRequest.create({ request_code: code, student_user_id: req.su._id, lead_id: c.lead?._id, student_id: c.student?._id, course_id: course._id, course_name: course.name,
      intake_id: ci.intake_id ? oid(ci.intake_id) : undefined, university_id: course.university_id, country_id: uni.country_id, level: course.level, deadline: ci.deadline ?? undefined,
      source_screen: clean(b.source_screen, 40) || 'Course detail', message_to_counsellor: clean(b.message, 500), missing_documents: missingDocs,
      eligibility_snapshot: { label: elig.label ?? elig.overall, course_intake_id: ci.id }, status: 'Requested by student', idempotency_key: b.idempotency_key ? String(b.idempotency_key).slice(0, 80) : undefined });
  } catch (e) { if ((e as { code?: number }).code === 11000) throw bad(`You have already requested this course for ${ci.label}.`, { code: 'A2' }); throw e; }
  // a short consent for every application: what, where, when
  await CONSENT.record(req, { suId: req.su._id, leadId: req.su.leadId, type: 'application_consent', value: true, method: 'apply_now_tick', universityId: course.university_id,
    extra: { request_code: code, university: uni.name, course: course.name, intake: ci.label, text: `I agree that La Europa applies on my behalf to ${uni.name} (${course.name}, ${ci.label}) and shares my application and documents with this university, as set out in my Student Declaration & Consent.` } });
  const promo = promoCode ? await claimPromo(req, promoCode, q, req.su, leadIds(c)) : null;
  const name = displayName(c);
  const assignee = c.counsellorId ?? (await User.findOne({ role: 'admin', isActive: true }).select('_id').lean())?._id;
  if (assignee) await createTask({ title: `${c.student ? 'Review Apply Now request' : 'Register student first: Apply Now request'}: ${uni.name} ${course.name}`, type: 'Application submission',
    student_id: c.student?._id, lead_id: c.student ? undefined : c.lead?._id, assigned_to: assignee, due_at: new Date(Date.now() + (Number(await getSetting('request_review_days')) || 2) * 864e5),
    priority: 'High', is_system: true, system_key: `request:${q._id}` } as never, String(assignee));
  await notifyStaff(c, 'request', `${name} sent an Apply Now request: ${uni.name}, ${course.name} (${ci.label})${promo ? `, promotion code ${promo.code}` : ''}`, '/requests');
  await studentTimeline(c.student?._id ?? null, c.student ? null : c.lead?._id, c.student ? 'stage' : 'lead', `Apply Now request ${code}: ${uni.name}, ${course.name} (${ci.label})`);
  await trigger('E23', { student_id: c.student?._id, lead_id: c.student ? undefined : c.lead?._id, ctx: { course: course.name, university: uni.name, intake: ci.label, request_id: code } });
  await portalAudit(req, 'Create', 'ApplicationRequest', q._id, code);
  const cname = c.counsellorId ? (await User.findById(c.counsellorId).select('name').lean())?.name : 'your counsellor';
  res.json({ id: String(q._id), request_code: code, promo_code: promo?.code ?? null,
    message: `Thank you! Your request for ${course.name} at ${uni.name} (${ci.label}) has been sent to La Europa. Your counsellor ${cname} will review it and apply on your behalf. You will be updated here and by email.${promo ? ` Promotion code ${promo.code} is saved with it: "${promo.title}".` : ''}` });
}));
const REQ_LABEL: Record<string, string> = { 'Requested by student': 'Sent to La Europa', 'In review': 'La Europa is reviewing', 'Info needed': 'Your counsellor needs more information', Accepted: 'Accepted: application started',
  Declined: 'Not taken forward', 'Cancelled by student': 'Cancelled', Expired: 'Deadline passed: counsellor will advise' };
const reqOut = (q: IApplicationRequest, N: Names) => ({ id: String(q._id), code: q.request_code, course_id: q.course_id ?? null, course: q.course_name || N.name(q.course_id), university: N.name(q.university_id),
  country: N.name(q.country_id), level: q.level, intake: N.name(q.intake_id), deadline: q.deadline ?? null, status: q.status, status_label: REQ_LABEL[q.status] ?? q.status, requested_at: q.createdAt,
  can_cancel: q.status === 'Requested by student', decline_reason: q.status === 'Declined' ? [q.decline_reason_code, q.decline_reason_text].filter(Boolean).join(': ') : null,
  application_id: q.application_id ?? null, message: q.message_to_counsellor ?? null });
router.get('/application-requests', h(async (req, res) => {
  const N = await workNames();
  res.json((await ApplicationRequest.find({ student_user_id: req.su._id, is_deleted: false }).sort({ createdAt: -1 })).map((q) => reqOut(q, N)));
}));
router.post('/application-requests/:id/cancel', h(async (req, res) => {
  const q = own(await ApplicationRequest.findOne({ _id: oid(req.params.id), student_user_id: req.su._id, is_deleted: false }));
  if (q.status !== 'Requested by student') throw bad('Please message your counsellor to cancel.');
  q.set({ status: 'Cancelled by student', cancelled_at: new Date(), cancel_reason: clean(req.body?.reason, 300) }); await q.save();
  await closeSystemTask(`request:${q._id}`);
  await notifyStaff(req.c, 'request', `${displayName(req.c)} cancelled Apply Now request ${q.request_code}`, '/requests');
  await portalAudit(req, 'Update', 'ApplicationRequest', q._id, 'Cancelled by student');
  res.json({ ok: true });
}));

// ---------- applications ----------
router.get('/applications', h(async (req, res) => {
  const c = req.c;
  const N = await workNames();
  const apps = c.student ? await Promise.all((await Application.find({ student_id: c.student._id, is_deleted: false }).sort({ updatedAt: -1 })).map((a) => appOut(a, c, N))) : [];
  const requests = (await ApplicationRequest.find({ student_user_id: req.su._id, is_deleted: false, status: { $ne: 'Accepted' } }).sort({ createdAt: -1 })).map((q) => reqOut(q, N));
  res.json({ applications: apps, requests, locked: !c.student });
}));
async function loadApp(c: Ctx, id: string) { const s = needStudent(c); return own(await Application.findOne({ _id: oid(id), student_id: s._id, is_deleted: false })); }
router.get('/applications/:id', h(async (req, res) => res.json(await appOut(await loadApp(req.c, req.params.id), req.c, await workNames(), true))));
router.post('/applications/:id/accept-offer', h(async (req, res) => {
  writable(req.c);
  const a = await loadApp(req.c, req.params.id);
  const N = await workNames();
  const d = await appDetail(a, req.c, N, await stageList('app_stage'));
  if (!d.can_accept) throw bad(d.accepted_elsewhere ? `You have already accepted an offer from ${d.accepted_elsewhere}. Message your counsellor if you want to change.` : 'This offer cannot be accepted now.');
  if (!req.body?.confirm) throw fieldErr('confirm', 'Please tick the confirmation box');
  a.set({ student_offer_response: 'Accepted', student_offer_response_at: new Date(), student_offer_response_ip: req.ip }); await a.save();
  const uni = N.name(a.university_id), name = displayName(req.c);
  const assignee = req.c.counsellorId ?? (await User.findOne({ role: 'admin', isActive: true }).select('_id').lean())?._id;
  if (assignee) await createTask({ title: `Process offer acceptance: ${name}, ${uni}`, type: 'Application submission', student_id: a.student_id, application_id: a._id, assigned_to: assignee,
    due_at: new Date(Date.now() + 864e5), priority: 'High', is_system: true, system_key: `offer-accept:${a._id}` } as never, String(assignee));
  await notifyStaff(req.c, 'portal', `${name} accepted the offer from ${uni} (${a.application_code})`, `/students/${a.student_id}/applications`);
  await studentTimeline(a.student_id, null, 'stage', `Student accepted the offer from ${uni} in the portal (${a.application_code})`);
  await trigger('E27', { student_id: a.student_id, ctx: { university: uni, course: a.course_name_text || N.name(a.course_id), intake: N.name(a.intake_id) } });
  await portalAudit(req, 'Update', 'Application', a._id, 'Offer accepted by student');
  res.json({ ok: true });
}));
router.post('/applications/:id/decline-offer', h(async (req, res) => {
  writable(req.c);
  const s = needStudent(req.c);
  const a = await loadApp(req.c, req.params.id);
  if (![...OFFER_STAGES, 'offer_accepted'].includes(a.stage)) throw bad('Only an offer can be declined.');
  if (!req.body?.confirm) throw bad('Please confirm that you want to decline this offer.');
  const why = clean(req.body?.reason, 300);
  await systemStage(req as unknown as AuthRequest, s, a, 'offer_declined', `Declined by the student in the portal${why ? ': ' + why : ''}`, { close: true, notify: false });
  await notifyStaff(req.c, 'portal', `${displayName(req.c)} declined the offer from ${(await workNames()).name(a.university_id)} (${a.application_code})`);
  await portalAudit(req, 'Update', 'Application', a._id, 'Offer declined by the student');
  res.json({ ok: true });
}));
router.post('/applications/:id/undo-accept', h(async (req, res) => {
  writable(req.c);
  const a = await loadApp(req.c, req.params.id);
  if (a.student_offer_response !== 'Accepted' || !OFFER_STAGES.includes(a.stage)) throw bad('Your acceptance is already being processed. Please message your counsellor.');
  a.set({ student_offer_response: 'Undone', student_offer_response_at: new Date() }); await a.save();
  await closeSystemTask(`offer-accept:${a._id}`);
  await notifyStaff(req.c, 'portal', `${displayName(req.c)} undid the offer acceptance for ${(await workNames()).name(a.university_id)}`, `/students/${a.student_id}/applications`);
  await studentTimeline(a.student_id, null, 'stage', `Student undid the offer acceptance (${a.application_code})`);
  await portalAudit(req, 'Update', 'Application', a._id, 'Offer acceptance undone');
  res.json({ ok: true });
}));

// ---------- student uploads (documents, tasks, offer conditions, visa) ----------
const NO_UPLOAD = ['Offer letter', 'Fee receipt', 'La Europa invoice', 'Payment receipt'];
async function typeInfo(id: unknown) {
  const t = await MasterItem.findById(id).lean();
  const d = (t?.data ?? {}) as Any;
  return { name: t?.name ?? '', help: d.help_text_for_student || d.description || '', visa: !!d.visa, student_can_upload: d.student_can_upload !== false };
}
export async function studentUpload(req: PortalRequest, s: { _id: unknown }, o: { typeId?: unknown; typeName?: string; title?: string; application_id?: unknown; visa_case_id?: unknown; note?: string; allowVerified?: boolean }) {
  const fl = (req.files as Express.Multer.File[] | undefined) ?? (req.file ? [req.file] : []);
  if (!fl.length) throw fieldErr('files', 'Choose a file');
  if (fl.length > 20) throw bad('Maximum 20 files per upload');
  hit('upload:' + req.su._id, 50, 3600e3);
  const tid = oid(o.typeId) ?? (await MasterItem.findOne({ type: 'document_type', name: o.typeName ?? 'Others' }).select('_id').lean())?._id ?? (await MasterItem.findOne({ type: 'document_type', name: 'Others' }).select('_id').lean())?._id;
  if (!tid) throw bad('Document type missing');
  const ti = await typeInfo(tid);
  if (ti.name === 'Others' && !clean(o.title)) throw fieldErr('title', 'Please give a title');
  if (fl.some((f) => /\.heic$/i.test(f.originalname))) throw bad('iPhone HEIC photos cannot be read yet. Please change the camera format to "Most Compatible" or upload JPG / PDF.');
  const maxMb = Math.min(25, Number(await getSetting('max_file_mb')) || 10);
  const checked = fl.map((f) => ({ f, ...checkFile(f, ALLOWED, fl.length > 1 ? 25 : maxMb) }));
  const doc = await docFor(s._id as Types.ObjectId, tid as Types.ObjectId, { title: ti.name === 'Others' ? clean(o.title, 150) : undefined, application_id: oid(o.application_id), visa_case_id: oid(o.visa_case_id) });
  if (doc.status === 'Verified' && !o.allowVerified) throw bad('This document is already verified. Your counsellor will ask if a new copy is needed.');
  const note = clean(o.note, 300);
  let v;
  if (checked.length > 1) {
    const merged = await mergeToPdf(checked.map((x) => x.f));
    if (merged.length > 25 * 1024 * 1024) throw bad('The merged PDF is larger than 25 MB');
    v = await addVersion(doc, { buffer: merged, originalname: `merged_${checked.length}_files.pdf`, mimetype: 'application/pdf', size: merged.length }, 'pdf', String(req.su._id), 'student', note);
  } else v = await addVersion(doc, checked[0].f, checked[0].ext, String(req.su._id), 'student', note);
  if (note) await StudentDocument.updateOne({ _id: doc._id }, { student_note: note });
  const label = doc.title || ti.name;
  await studentTimeline(s._id, null, 'document', `Student uploaded ${label} (v${(v as Any).version_no}${checked.length > 1 ? `, ${checked.length} files merged` : ''}) as ${(v as Any).stored_name}`);
  await notifyStaff(req.c, 'doc_uploaded', `Student uploaded a document: ${label} (${displayName(req.c)})`, `/students/${s._id}/documents`);
  await portalAudit(req, 'Create', 'Document', doc._id, (v as Any).stored_name);
  return { document_id: String(doc._id), version: v };
}
router.post('/offer-conditions/:id/proof', upload.array('files', 20), h(async (req, res) => {
  writable(req.c);
  const s = needStudent(req.c);
  const cond = own(await OfferCondition.findOne({ _id: oid(req.params.id), is_deleted: false }));
  own(await Application.exists({ _id: cond.application_id, student_id: s._id }));
  const v = await studentUpload(req, s, { typeName: 'Others', title: `Offer condition: ${cond.text.slice(0, 60)}`, application_id: cond.application_id });
  cond.proof_document_id = oid(v.document_id)!; await cond.save();
  res.json({ ok: true });
}));

export { router as portalRouter, own, needStudent, writable, hit, typeInfo, NO_UPLOAD, docReason, appOut, leadIds, guardianOf, maskEmail, fullName, Student };
export default router;
