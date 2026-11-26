import { Router, type Response } from 'express';
import crypto from 'crypto';
import { Types } from 'mongoose';
import Student from '../models/Student';
import User from '../models/User';
import Course from '../models/Course';
import PortalAccount from '../models/PortalAccount';
import University from '../models/University';
import { AuditLog, audit, getSetting } from '../models/Audit';
import { Application, StageHistory, StudentDocument } from '../models/Work';
import { Country, MasterItem } from '../models/Master';
import { ConsentRecord, PaymentSubmission } from '../models/Portal';
import { OfferLetter, PartnerAgreement, ShareConsentRequest, UniAction, UniCode, UniConsent, DocAccessLog as UniDocAccess, UniDocRequest, UniDocShare, UniMessage, UniversityApplication } from '../models/Partner';
import { authenticate, staffOnly, type AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { signedFileUrl, uploadBuffer } from '../config/cloudinary';
import { HttpError, bad, clean, fieldErr, fmtDateTime, fullName, handle, isAdmin, isEmail, istDate, need, num, oid, seesAll, timeline, addDays } from '../services/crm';
import { fmtDate } from '../services/invoicePdf';
import { addVersion, checkFile, docFor, fileUrl, saveAs, ALLOWED } from '../services/files';
import { esc, fire, previewFor, ul } from '../services/email';
import { closeSystemTask, notify, notifyAdmins } from '../services/tasks';
import { passportOf } from '../services/students';
import { suOfStudent } from '../services/portal';
import { credentialConflict } from '../services/accounts';
import { invalidateUser } from '../services/access';
import * as CONSENT from '../services/consent';
import { logoOf } from '../services/catalogue';
import { trigger } from '../services/uemail';
import * as A from '../services/uniActions';
import * as P from '../services/partner';
import { appCtx, triggerFor, names as workNames, checklistFor, loadChild } from './work';
import { issueInvite } from './uniAuth';
const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
import { closeRequestFlags, checkAttachments } from './uniDocs';
import { createUniUser } from './uniAdmin';

/** The client's La Europa side of the partner portal (legacy/server/routes/university_staff.js), part 1: accounts, agreements, the application's University tab, the updates queue, messages, sharing consent. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const router = Router();
router.use(['/admin/uni-accounts', '/admin/uni-users', '/admin/agreements', '/applications/:aid/university', '/university-shares', '/university-updates', '/university-counts', '/university-news', '/university-messages', '/students/:id/uni-consents'], authenticate, staffOnly);
const h = (fn: (req: AuthRequest, res: Response) => Promise<void>) => handle(fn);
const adminOnly = (req: AuthRequest) => { if (!isAdmin(req)) throw new HttpError(403, 'Only Admin can do this'); };
const bool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
const staffName = async (id: unknown) => (id ? ((await User.findById(id).select('name').lean()) as Any)?.name ?? null : null);
const emails = (rows: Any[]) => rows.map((x) => x.email).filter(Boolean);
const uniOf = (id: unknown) => (oid(id) ? University.findOne({ _id: oid(id), is_deleted: false }) : Promise.resolve(null));

// =====================================================================================
// S42 University accounts (Admin)
// =====================================================================================
async function accountOut(u: Any, full = false) {
  const ag = await P.activeAgreement(u._id);
  const anyAg = (await PartnerAgreement.findOne({ university_id: u._id, is_deleted: false }).sort({ start_date: -1 }).select('status').lean()) as Any;
  const country = u.country_id ? ((await Country.findById(u.country_id).select('name').lean()) as Any)?.name : null;
  const base = { id: String(u._id), name: u.name, display_name: u.display_name || u.name, account_code: u.account_code ?? null, country, city: u.city, logo: logoOf(u),
    portal_status: u.portal_status || 'None', agreement_status: ag ? ag.status : anyAg ? anyAg.status : 'None', partner_manager: await staffName(u.partner_manager_id), partner_manager_id: u.partner_manager_id ? String(u.partner_manager_id) : null,
    users: await PortalAccount.countDocuments({ role: 'university', universityId: u._id, status: { $in: ['Active', 'Invited'] } }),
    applications: await UniversityApplication.countDocuments({ university_id: u._id, is_deleted: false }) };
  if (!full) return base;
  const users = (await PortalAccount.find({ role: 'university', universityId: u._id }).sort({ uniRole: 1, name: 1 }).lean()) as Any[];
  const names = new Map(users.map((x) => [String(x._id), x.name]));
  const acts = (await AuditLog.find({ university_id: u._id }).sort({ createdAt: -1 }).limit(100).lean()) as Any[];
  const staff = new Map(((await User.find({ _id: { $in: acts.filter((x) => x.actor_type !== 'university').map((x) => x.user_id).filter(Boolean) } }).select('name').lean()) as Any[]).map((x) => [String(x._id), x.name]));
  return { ...base, settings: { notify_mode: u.notify_mode || 'review', share_contact: !!u.share_contact, share_passport: !!u.share_passport, share_visa: !!u.share_visa, viewer_docs: !!u.viewer_docs,
    officers_propose: u.officers_propose !== false, max_users: u.max_users || 10, doc_access_rule: u.doc_access_rule || 'enrolment', doc_access_months: u.doc_access_months ?? null, watermark: u.watermark !== false, zip_download: u.zip_download !== false,
    enrol_from_accepted: !!u.enrol_from_accepted, ip_allowlist: u.ip_allowlist ?? null, show_expected_commission: !!u.show_expected_commission, viewer_exports: u.viewer_exports !== false, legal_name: u.legal_name ?? null,
    billing_address: u.billing_address ?? null, vat_id: u.vat_id ?? null, timezone: u.timezone ?? null },
    internal_note: u.uni_internal_note ?? null, suspend_reason: u.suspend_reason ?? null,
    users_list: users.map((x) => ({ id: String(x._id), name: x.name, email: x.email, role: x.uniRole, role_label: P.ROLE_LABEL[x.uniRole], finance: !!(x.finance || x.uniRole === 'admin'), status: x.status,
      last_login_at: x.lastLoginAt ?? null, twofa: false, main: !!x.isMainContact, locked: !!(x.lockedUntil && new Date(x.lockedUntil) > new Date()) })),
    agreements: ((await PartnerAgreement.find({ university_id: u._id, is_deleted: false }).sort({ start_date: -1 }).select('agreement_code title start_date end_date status signed_on').lean()) as Any[]).map((a) => ({ ...a, id: String(a._id) })),
    consents: ((await UniConsent.find({ university_id: u._id }).sort({ createdAt: -1 }).limit(50).lean()) as Any[]).map((c) => ({ doc_type: c.doc_type, version: c.version, created_at: c.createdAt, name: names.get(String(c.account_id)) ?? null })),
    activity: acts.map((x) => ({ action: x.action, entity_type: x.entity_type, entity_label: x.entity_label, ip: x.ip, created_at: x.createdAt, actor_type: x.actor_type, who: (x.actor_type === 'university' ? names : staff).get(String(x.user_id)) ?? null })),
    no_agreement: !ag };
}
router.get('/admin/uni-accounts', h(async (req, res) => {
  adminOnly(req);
  const unis = (await University.find({ is_deleted: false }).lean()) as Any[];
  unis.sort((a, b) => Number(!a.portal_status) - Number(!b.portal_status) || a.name.localeCompare(b.name));
  const rows = []; for (const u of unis) rows.push(await accountOut(u));
  res.json({ rows, staff: ((await User.find({ isActive: true, role: { $in: ['admin', 'counsellor', 'manager'] } }).sort({ name: 1 }).select('name').lean()) as Any[]).map((x) => ({ id: String(x._id), name: x.name })) });
}));
router.get('/admin/uni-accounts/:id', h(async (req, res) => { adminOnly(req); const u = await uniOf(req.params.id); if (!u) throw P.NotFound(); res.json(await accountOut(u.toObject(), true)); }));
const freeMail = (em: unknown) => /@(gmail|yahoo|hotmail|outlook|live|icloud|aol|rediffmail|proton(mail)?)\./i.test(String(em || ''));
router.post('/admin/uni-accounts', h(async (req, res) => {
  adminOnly(req);
  const b = req.body ?? {}; const u = await uniOf(b.university_id); if (!u) throw fieldErr('university_id', 'Choose the university');
  const creating = !u.portal_status || u.portal_status === 'None';
  const e: Record<string, string> = {};
  if (!clean(b.display_name)) e.display_name = 'Portal display name is required';
  if (creating) {
    if (!clean(b.contact_name)) e.contact_name = 'Main contact name is required';
    if (!isEmail(b.contact_email)) e.contact_email = 'Valid email is required';
    else if (await credentialConflict({ email: String(b.contact_email), username: String(b.contact_email) })) e.contact_email = 'This email already has an account';
  }
  if (!b.partner_manager_id || !oid(b.partner_manager_id)) e.partner_manager_id = 'Choose the La Europa partner manager';
  const mx = num(b.max_users); if (!(mx != null && mx >= 1 && mx <= 100)) e.max_users = '1 to 100';
  if (bool(b.share_contact) && !u.share_contact && !clean(b.share_contact_reason)) e.share_contact_reason = 'Reason is required to share student contact details';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const dflt = (v: unknown, d: boolean) => (v === undefined ? d : bool(v));
  const f: Any = { display_name: clean(b.display_name, 150), partner_manager_id: b.partner_manager_id, notify_mode: b.notify_mode === 'automatic' ? 'automatic' : 'review', share_contact: bool(b.share_contact),
    share_passport: bool(b.share_passport), share_visa: bool(b.share_visa), viewer_docs: bool(b.viewer_docs), officers_propose: dflt(b.officers_propose, true), max_users: mx,
    doc_access_rule: ['enrolment', 'intake'].includes(b.doc_access_rule) ? b.doc_access_rule : 'enrolment', doc_access_months: num(b.doc_access_months), uni_internal_note: clean(b.internal_note, 3000),
    watermark: dflt(b.watermark, true), zip_download: dflt(b.zip_download, true), enrol_from_accepted: bool(b.enrol_from_accepted), ip_allowlist: clean(b.ip_allowlist, 500), show_expected_commission: bool(b.show_expected_commission),
    viewer_exports: dflt(b.viewer_exports, true), legal_name: clean(b.legal_name, 200), billing_address: clean(b.billing_address, 500), vat_id: clean(b.vat_id, 60), timezone: clean(b.timezone, 60) };
  const old = u.toObject() as Any;
  const changed = Object.keys(f).filter((k) => String(old[k] ?? '') !== String(f[k] ?? ''));
  if (creating) { f.account_code = `LE-U-${String((await University.countDocuments({ account_code: { $ne: null } })) + 1).padStart(5, '0')}`; f.portal_status = 'Draft'; }
  u.set(f); await u.save();
  if (creating) {
    const su = await createUniUser(u._id, { name: b.contact_name, email: b.contact_email, role: 'admin', phone: b.contact_phone }, { by: req.user!.id, type: 'staff' }).catch(async (err) => { await University.updateOne({ _id: u._id }, { $unset: { portal_status: 1, account_code: 1 } }); throw err; });
    su.set({ designation: clean(b.contact_designation, 100) ?? undefined, isMainContact: true, finance: true, alerts: ['applications', 'messages', 'deadlines', 'finance'] }); await su.save();
  }
  if (changed.some((k) => ['share_contact', 'share_passport', 'share_visa', 'notify_mode', 'viewer_docs'].includes(k))) await P.uaudit(req as never, 'Update', 'UniversitySettings', u._id, `Settings changed: ${changed.join(', ')}${b.share_contact_reason ? ' (reason: ' + clean(b.share_contact_reason, 300) + ')' : ''}`, null, null, u._id);
  else await P.uaudit(req as never, creating ? 'Create' : 'Update', 'UniversityAccount', u._id, f.display_name, null, null, u._id);
  const invite = b.action === 'invite' ? await inviteMain(req, u._id, b.override_reason) : null;
  res.json({ ok: true, warning: creating && freeMail(b.contact_email) ? 'This looks like a free mail address. An official university domain is recommended.' : null, invite });
}));
async function inviteMain(req: AuthRequest, uniId: unknown, override: unknown) {
  const u = (await University.findById(uniId))!;
  if (!(await P.activeAgreement(uniId))) {
    if (!clean(override)) throw bad('There is no Active partner agreement. Record the agreement first, or give an override reason (for example "agreement under signature").', { needs_override: true });
    u.override_reason = clean(override, 300) ?? undefined; await u.save();
    await P.uaudit(req as never, 'Override', 'UniversityAccount', uniId, `Invite without active agreement: ${override}`, null, null, uniId);
  }
  const main = await PortalAccount.findOne({ role: 'university', universityId: uniId, isMainContact: true });
  if (!main) throw bad('No main contact found');
  if (main.status !== 'Invited') throw bad('The main contact has already activated the account');
  await issueInvite(main._id);
  if (!u.portal_status || u.portal_status === 'Draft') { u.portal_status = 'Invited'; await u.save(); }
  await P.uaudit(req as never, 'Invite', 'UniversityUser', main._id, main.email, null, null, uniId);
  return { sent_to: main.email };
}
const endSessions = async (filter: Any) => { const ids = await PortalAccount.distinct('_id', filter); await PortalAccount.updateMany(filter, { sessionsEndedAt: new Date() }); ids.forEach((id) => invalidateUser(String(id))); };
router.post('/admin/uni-accounts/:id/:action', h(async (req, res) => {
  adminOnly(req); const u = await uniOf(req.params.id); if (!u || !u.portal_status) throw P.NotFound();
  const a = req.params.action; const b = req.body ?? {};
  if (a === 'users') {
    if ((await PortalAccount.countDocuments({ role: 'university', universityId: u._id, status: { $in: ['Invited', 'Active'] } })) >= (u.max_users || 10)) throw bad('The user limit of this university is reached.');
    const su = await createUniUser(u._id, { ...b, alerts: undefined }, { by: req.user!.id, type: 'staff' });
    await P.uaudit(req as never, 'Create', 'UniversityUser', su._id, su.email, null, null, u._id); res.json({ ok: true }); return;
  }
  if (!['invite', 'suspend', 'reactivate', 'close', 'preview'].includes(a)) throw P.NotFound();
  if (a === 'invite') { res.json(await inviteMain(req, u._id, b.override_reason)); return; }
  if (a === 'suspend') { if (!clean(b.reason)) throw fieldErr('reason', 'Reason is required'); u.set({ portal_status: 'Suspended', suspend_reason: clean(b.reason, 300) }); await u.save(); await endSessions({ role: 'university', universityId: u._id }); }
  if (a === 'reactivate') { u.set({ portal_status: (await PortalAccount.exists({ role: 'university', universityId: u._id, status: 'Active' })) ? 'Active' : 'Invited', suspend_reason: undefined }); await u.save(); }
  if (a === 'close') {
    if (String(b.confirm_name || '').trim().toLowerCase() !== String(u.display_name || u.name).trim().toLowerCase()) throw fieldErr('confirm_name', 'Type the university name exactly to confirm');
    u.portal_status = 'Closed'; await u.save(); await PortalAccount.updateMany({ role: 'university', universityId: u._id }, { status: 'Inactive' }); await endSessions({ role: 'university', universityId: u._id });
  }
  if (a === 'preview') { // View as university: read only, logged; the partner portal exchanges the one-time token
    const uu = await PortalAccount.findOne({ role: 'university', universityId: u._id, status: 'Active' }).sort({ uniRole: 1 });
    if (!uu) throw bad('No active university user yet');
    const token = crypto.randomBytes(32).toString('base64url');
    await UniCode.create({ account_id: uu._id, purpose: 'preview', code_hash: sha(token), expires_at: new Date(Date.now() + 120e3), payload: { by: req.user!.id } });
    await P.uaudit(req as never, 'View as university', 'UniversityAccount', u._id, P.uniName(u), null, null, u._id);
    const { portalLink } = await import('../services/uemail');
    res.json({ url: `${await portalLink()}/preview?token=${token}` }); return;
  }
  await P.uaudit(req as never, 'Update', 'UniversityAccount', u._id, `${a}${b.reason ? ': ' + clean(b.reason, 300) : ''}`, null, null, u._id);
  res.json({ ok: true });
}));
router.post('/admin/uni-users/:uid/:action', h(async (req, res) => {
  adminOnly(req);
  const x = oid(req.params.uid) ? await PortalAccount.findOne({ _id: oid(req.params.uid), role: 'university' }) : null; if (!x) throw P.NotFound();
  const a = req.params.action; if (!['deactivate', 'activate', 'logout', 'resend', 'role'].includes(a)) throw P.NotFound();
  if (a === 'deactivate') {
    const u = await University.findById(x.universityId).select('portal_status').lean();
    if (x.uniRole === 'admin' && u?.portal_status === 'Active' && !(await PortalAccount.exists({ role: 'university', universityId: x.universityId, uniRole: 'admin', status: 'Active', _id: { $ne: x._id } }))) throw bad('The last active University Admin cannot be deactivated.');
    x.set({ status: 'Inactive', sessionsEndedAt: new Date() }); await x.save(); invalidateUser(String(x._id));
  }
  if (a === 'activate') { x.set({ status: x.lastLoginAt || x.pwHistory?.length ? 'Active' : 'Invited', lockedUntil: undefined, failedLogins: 0 }); await x.save(); }
  if (a === 'logout') { x.sessionsEndedAt = new Date(); await x.save(); invalidateUser(String(x._id)); }
  if (a === 'resend') { if (x.status !== 'Invited') throw bad('This user already activated the account'); await issueInvite(x._id); }
  if (a === 'role') { if (!['admin', 'officer', 'viewer'].includes(req.body?.role)) throw fieldErr('role', 'Choose a role'); x.set({ uniRole: req.body.role, finance: req.body.role === 'admin' || bool(req.body.finance) }); await x.save(); }
  await P.uaudit(req as never, 'Update', 'UniversityUser', x._id, `${a}: ${x.email}`, null, null, x.universityId); res.json({ ok: true });
}));

// =====================================================================================
// S43 Partner agreements
// =====================================================================================
async function agreementStatus(a: Any) {
  if (a.status === 'Terminated' || a.status === 'Draft') return a.status;
  const today = istDate(); const warn = Number((await getSetting('uni_agreement_warn_days')) || 60);
  if (a.start_date > today) return 'Draft';
  if (a.end_date && a.end_date < today) return 'Expired';
  if (a.end_date && addDays(today, warn) >= a.end_date) return 'Expiring soon';
  return 'Active';
}
router.get('/admin/agreements', h(async (req, res) => {
  adminOnly(req);
  const f: Any = { is_deleted: false }; if (req.query.university && oid(req.query.university)) f.university_id = oid(req.query.university);
  const unis = new Map(((await University.find().select('name display_name').lean()) as Any[]).map((u) => [String(u._id), P.uniName(u)]));
  const rows = ((await PartnerAgreement.find(f).sort({ start_date: -1 }).lean()) as Any[]).map((a) => ({ ...a, id: String(a._id), university: unis.get(String(a.university_id)), versions: (a.file_versions ?? []).length, file: undefined, file_versions: undefined, has_pdf: !!a.file?.url }));
  const currencies = ((await MasterItem.find({ type: 'currency', is_deleted: { $ne: true } }).sort({ sort: 1 }).select('name').lean()) as Any[]).map((x) => x.name);
  res.json({ rows, currencies, countries: ((await Country.find().sort({ name: 1 }).select('name').lean()) as Any[]).map((c) => ({ id: String(c._id), name: c.name })) });
}));
router.post('/admin/agreements', upload.single('file'), h(async (req, res) => {
  adminOnly(req);
  const b = req.body ?? {};
  const cur = b.id && oid(b.id) ? await PartnerAgreement.findOne({ _id: oid(b.id), is_deleted: false }) : null; if (b.id && !cur) throw P.NotFound();
  const e: Record<string, string> = {};
  if (!cur && !(await uniOf(b.university_id))) e.university_id = 'Choose the university';
  if (!clean(b.title)) e.title = 'Agreement title is required'; if (!b.start_date) e.start_date = 'Start date is required';
  if (b.end_date && b.start_date && b.end_date < b.start_date) e.end_date = 'End date must be after the start date';
  if (!clean(b.signed_by_le)) e.signed_by_le = 'Required'; if (!clean(b.signed_by_uni)) e.signed_by_uni = 'Required';
  if (!b.signed_on || b.signed_on > istDate()) e.signed_on = 'Signed on is required and cannot be in the future';
  const nd = num(b.notice_days); if (b.notice_days && !(nd != null && nd >= 0 && nd <= 365)) e.notice_days = '0 to 365';
  if (!cur && !req.file) e.file = 'Agreement PDF is required';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const uniId = cur ? cur.university_id : oid(b.university_id);
  // only one Active agreement for the same period
  const overl = (await PartnerAgreement.findOne({ university_id: uniId, is_deleted: false, status: { $nin: ['Terminated', 'Expired', 'Draft'] }, ...(cur ? { _id: { $ne: cur._id } } : {}),
    start_date: { $lte: b.end_date || '9999-12-31' }, $or: [{ end_date: null }, { end_date: { $gte: b.start_date } }] }).select('agreement_code').lean()) as Any;
  if (overl && !bool(b.draft)) throw bad(`Another active agreement (${overl.agreement_code}) covers the same period. Terminate it or change the dates.`);
  let file = cur?.file; const versions = [...(cur?.file_versions ?? [])];
  if (req.file) {
    checkFile(req.file, ['pdf'], 25);
    const asset = await uploadBuffer(req.file, `university/${uniId}/agreements`);
    if (file?.url) versions.push({ ...file, replaced_at: new Date(), by: req.user!.id });
    file = { url: asset.url, public_id: asset.publicId, resource_type: asset.resourceType };
  }
  let territory: unknown = b.territory; if (typeof territory === 'string') { try { territory = JSON.parse(territory); } catch { territory = [territory]; } }
  const f: Any = { title: clean(b.title, 200), start_date: b.start_date, end_date: b.end_date || null, auto_renew: bool(b.auto_renew), notice_days: nd, signed_by_le: clean(b.signed_by_le, 150), signed_by_uni: clean(b.signed_by_uni, 150),
    signed_on: b.signed_on, territory: Array.isArray(territory) ? territory.map(String) : [], scope_text: clean(b.scope_text, 1000), commission_terms: clean(b.commission_terms, 3000), payment_terms_days: num(b.payment_terms_days),
    invoice_currency: b.invoice_currency || null, file, file_versions: versions, show_to_uni: b.show_to_uni === undefined ? true : bool(b.show_to_uni), internal_note: clean(b.internal_note, 3000), updated_by: req.user!.id };
  let a = cur;
  if (a) a.set(f);
  else { const yr = new Date().getFullYear(); const n = (await PartnerAgreement.countDocuments({ agreement_code: new RegExp(`^LE-PA-${yr}-`) })) + 1; a = new PartnerAgreement({ university_id: uniId, agreement_code: `LE-PA-${yr}-${String(n).padStart(3, '0')}`, ...f, status: 'Draft', created_by: req.user!.id }); }
  if (!bool(b.draft) || cur) a.status = bool(b.draft) && !cur ? 'Draft' : await agreementStatus({ ...a.toObject(), status: a.status === 'Draft' && !bool(b.draft) ? 'Active' : a.status });
  await a.save();
  await P.uaudit(req as never, cur ? 'Update' : 'Create', 'PartnerAgreement', a._id, f.title, null, null, uniId);
  res.json({ ok: true, id: String(a._id) });
}));
router.post('/admin/agreements/:id/terminate', h(async (req, res) => {
  adminOnly(req); const a = oid(req.params.id) ? await PartnerAgreement.findById(oid(req.params.id)) : null; if (!a) throw P.NotFound();
  if (!clean(req.body?.reason)) throw fieldErr('reason', 'Reason is required');
  a.set({ status: 'Terminated', terminate_reason: clean(req.body.reason, 500) }); await a.save();
  await P.uaudit(req as never, 'Update', 'PartnerAgreement', a._id, `Terminated: ${req.body.reason}`, null, null, a.university_id); res.json({ ok: true });
}));
router.get('/admin/agreements/:id/pdf', h(async (req, res) => {
  adminOnly(req); const a = oid(req.params.id) ? ((await PartnerAgreement.findById(oid(req.params.id)).lean()) as Any) : null; if (!a) throw P.NotFound();
  const f = req.query.v !== undefined ? (a.file_versions ?? [])[Number(req.query.v)] : a.file; if (!f?.url) throw P.NotFound();
  await audit(req, 'View sensitive', 'PartnerAgreement', a._id, a.agreement_code);
  res.json({ url: signedFileUrl(f.url, f.public_id, f.resource_type || 'raw'), name: `${a.agreement_code}.pdf` });
}));

// =====================================================================================
// C12 Submit to the university portal (S44), C13 the University tab (S47), C14 buttons
// =====================================================================================
const NEVER_SHARE = ['La Europa invoice', 'Payment receipt', 'Fee receipt', 'Bank statement', 'Blocked account', 'Health insurance', 'Accommodation proof', 'Visa decision', 'Sponsor income proof', 'Consent form', 'ITR'];
type TypeInfo = Map<string, { name: string; data: Any }>;
const typeInfo = async (): Promise<TypeInfo> => new Map(((await MasterItem.find({ type: 'document_type' }).select('name data').lean()) as Any[]).map((t) => [String(t._id), { name: t.name, data: t.data ?? {} }]));
function shareable(d: Any, types: TypeInfo) {
  const t = types.get(String(d.document_type_id)) ?? { name: '', data: {} };
  if (t.data.never_share_uni) return false;
  if (NEVER_SHARE.some((n) => t.name.toLowerCase().startsWith(n.toLowerCase()))) return false;
  if (t.data.visa && !/visa decision/i.test(t.name)) return false;
  return d.status === 'Verified' && !!d.current_version_id;
}
const suIdsOf = async (s: Any) => PortalAccount.distinct('_id', { role: 'student', $or: [{ studentId: s._id }, ...(s.lead_id ? [{ leadId: s.lead_id }] : [])] });
export async function consentFor(s: Any, universityId: unknown, applicationId: unknown) {
  const sus = await suIdsOf(s);
  const scope = { university_id: universityId, $or: [{ application_id: applicationId }, { application_id: null }] };
  const rec = (await ConsentRecord.findOne({ consent_type: 'share_with_university', ...scope, $and: [{ $or: [{ student_user_id: { $in: sus } }, { 'extra.student_id': String(s._id) }] }] }).sort({ createdAt: -1 }).lean()) as Any;
  const reqd = (await ShareConsentRequest.findOne({ student_id: s._id, university_id: universityId }).sort({ requested_at: -1 }).lean()) as Any;
  // the signed Student Declaration & Consent (box B, data sharing) covers sharing with universities, unless withdrawn for this one
  const master = (await ConsentRecord.findOne({ consent_type: { $in: ['master', 'share_data'] }, student_user_id: { $in: sus } }).sort({ createdAt: -1 }).lean()) as Any;
  if (master?.value === 'yes' && !(rec && rec.value !== 'yes' && rec.createdAt > master.createdAt)) return { status: 'Given', at: master.createdAt, method: master.consent_type === 'share_data' ? 'Student Declaration & Consent, box B (signed with email OTP)' : 'All-in-one consent (first login)', id: String(master._id) };
  if (rec) return { status: rec.value === 'yes' ? 'Given' : 'Withdrawn', at: rec.createdAt, method: rec.method, id: String(rec._id) };
  if (reqd) return { status: reqd.status === 'Declined' ? 'Declined' : 'Requested', at: reqd.requested_at };
  return { status: 'Not requested' } as Any;
}
const transfersBlocked = async (countryId: unknown) => (countryId ? ((await Country.findById(countryId).lean()) as Any)?.transfers_allowed === false : false);
const verOf = (d: Any, vid: unknown) => (d?.versions ?? []).find((v: Any) => String(v._id) === String(vid));
async function uniTab(req: AuthRequest, a: Any, s: any) {
  const u = a.university_id ? ((await University.findById(a.university_id).lean()) as Any) : null;
  const ua = (await UniversityApplication.findOne({ application_id: a._id, is_deleted: false }).lean()) as Any;
  const portal = u?.portal_status === 'Active'; const agreement = u ? await P.activeAgreement(u._id) : null;
  const consent = u ? await consentFor(s, u._id, a._id) : { status: 'Not requested' };
  const types = await typeInfo();
  const docs = ((await StudentDocument.find({ student_id: s._id, is_deleted: false }).lean()) as Any[]).filter((d) => shareable(d, types));
  const checklist = new Set((await checklistFor(s, await workNames(), a.country_id)).map((i: Any) => String(i.document_type_id)));
  const out: Any = { university: u ? { id: String(u._id), name: P.uniName(u), portal_status: u.portal_status || 'None', notify_mode: u.notify_mode, share_contact: !!u.share_contact, partner_manager: await staffName(u.partner_manager_id) } : null,
    can_submit: !ua && portal && !!agreement && consent.status === 'Given' && !['rejected', 'withdrawn', 'offer_declined'].includes(a.stage), portal, agreement: !!agreement, consent, transfers_blocked: await transfersBlocked(a.country_id),
    shareable: docs.map((d) => ({ document_id: String(d._id), version_id: String(d.current_version_id), name: d.title || types.get(String(d.document_type_id))?.name, in_checklist: checklist.has(String(d.document_type_id)) })) };
  if (!ua) return out;
  const shares = [];
  for (const x of (await UniDocShare.find({ uapp_id: ua._id }).sort({ shared_at: -1 }).lean()) as Any[]) {
    const d = (await StudentDocument.findById(x.document_id).lean()) as Any; const v = verOf(d, x.version_id);
    const newer = !!d?.current_version_id && String(d.current_version_id) !== String(x.version_id) && !['Revoked', 'Expired'].includes(x.status) && !(await UniDocShare.exists({ uapp_id: ua._id, version_id: d.current_version_id, status: { $nin: ['Revoked', 'Expired'] } }));
    shares.push({ id: String(x._id), document_id: String(x.document_id), name: d?.title || types.get(String(d?.document_type_id))?.name, version_no: v?.version_no ?? null, status: x.status, shared_at: x.shared_at, viewed_at: x.viewed_at, downloaded_at: x.downloaded_at, revoked_at: x.revoked_at, newer });
  }
  const log = (await UniDocAccess.find({ uapp_id: ua._id }).sort({ createdAt: -1 }).lean()) as Any[];
  const uploads: Any[] = [];
  for (const d of (await StudentDocument.find({ application_id: a._id, 'versions.uploaded_by_type': 'university' }).lean()) as Any[])
    for (const v of (d.versions ?? []).filter((x: Any) => x.uploaded_by_type === 'university' && !x.removed_at))
      uploads.push({ document_id: String(d._id), title: d.title, document_type_id: String(d.document_type_id), status: d.status, version_id: String(v._id), version_no: v.version_no, uploaded_at: v.uploaded_at, note_for_counsellor: v.note_for_counsellor,
        name: d.title || types.get(String(d.document_type_id))?.name, by: ((await PortalAccount.findById(v.uploaded_by).select('name').lean()) as Any)?.name ?? null, url: fileUrl(v) });
  uploads.sort((x, y) => new Date(y.uploaded_at).getTime() - new Date(x.uploaded_at).getTime());
  const actions = [];
  for (const x of (await UniAction.find({ uapp_id: ua._id }).sort({ createdAt: -1 }).lean()) as Any[])
    actions.push({ id: String(x._id), type: x.type, label: A.DECISION_LABEL[x.type], data: x.data ?? {}, processing: x.processing, held_note: x.held_note, created_at: x.createdAt,
      by: x.by_account_id ? ((await PortalAccount.findById(x.by_account_id).select('name').lean()) as Any)?.name : await staffName(x.by_staff_id), processed_by: await staffName(x.processed_by), processed_at: x.processed_at });
  const lastBy = log[0] ? ((await PortalAccount.findById(log[0].account_id).select('name').lean()) as Any)?.name : null;
  return { ...out, can_submit: false, ua: { id: String(ua._id), status: ua.status, submitted_at: ua.submitted_at, university_ref: ua.university_ref, flags: { docs_requested: !!ua.flag_docs_requested, waitlisted: !!ua.flag_waitlisted }, withdrawn_at: ua.withdrawn_at },
    actions, shares, uploads,
    requests: ((await UniDocRequest.find({ uapp_id: ua._id }).sort({ createdAt: -1 }).lean()) as Any[]).map((q) => ({ ...q, id: String(q._id), items: (q.items ?? []).map((i: Any) => ({ ...i, id: String(i._id), name: i.title || types.get(String(i.document_type_id))?.name })) })),
    downloads: { count: log.filter((l) => l.action !== 'preview').length, views: log.filter((l) => l.action === 'preview').length, last: log[0] ? `${lastBy || 'University user'} on ${fmtDateTime(log[0].createdAt)}` : null },
    unread: await UniMessage.countDocuments({ uapp_id: ua._id, sender_type: 'university', seen_by_le_at: null, deleted_at: null }) };
}
const appOf = async (req: AuthRequest, aid: string) => { const { row, student } = await loadChild(req, Application as never, aid, 'Application'); return { a: (row as Any).toObject ? (row as Any).toObject() : row, s: student as any }; };
router.get('/applications/:aid/university', h(async (req, res) => { const { a, s } = await appOf(req, req.params.aid); res.json(await uniTab(req, a, s)); }));
/** what the university will see (1.10) */
router.get('/applications/:aid/university/preview', h(async (req, res) => {
  const { a } = await appOf(req, req.params.aid);
  if (!a.university_id || !(await University.exists({ _id: a.university_id }))) throw bad('Choose the university of this application first');
  const fake = { _id: new Types.ObjectId(), application_id: a._id, university_id: a.university_id, status: 'New', submitted_at: new Date(), status_changed_at: new Date(), version: 1 };
  const v: Any = await P.appView(fake, { detail: true }); delete v.timeline;
  res.json(v);
}));
const sharedVersions = async (s: Any, ids: unknown[]) => {
  const types = await typeInfo(); const out: Any[] = [];
  for (const id of ids) {
    const d = oid(id) ? ((await StudentDocument.findOne({ 'versions._id': oid(id), is_deleted: false }).lean()) as Any) : null; if (!d) continue;
    if (String(d.student_id) !== String(s._id) || !shareable({ ...d, current_version_id: id }, types) || String(d.current_version_id) !== String(id)) throw bad('Only verified documents of this student can be shared.');
    out.push({ did: d._id, vid: oid(id), name: d.title || types.get(String(d.document_type_id))?.name });
  }
  return out;
};
router.post('/applications/:aid/university/submit', h(async (req, res) => {
  need(req, 'applications', 'edit');
  const { a, s } = await appOf(req, req.params.aid);
  const b = req.body ?? {};
  const u = a.university_id ? await University.findById(a.university_id) : null;
  if (!u || u.portal_status !== 'Active') throw bad('This university does not have an active partner portal account.');
  if (await UniversityApplication.exists({ application_id: a._id, is_deleted: false })) throw bad('This application was already submitted to the university portal. For a new attempt create a new application.');
  if (!(await P.activeAgreement(u._id))) {
    if (!isAdmin(req) || !clean(b.override_reason)) throw bad('This university has no active partner agreement. Please contact Admin.', { needs_override: isAdmin(req) });
    await audit(req, 'Override', 'Application', a._id, `Submitted without active agreement: ${b.override_reason}`);
  }
  if (await transfersBlocked(a.country_id)) throw bad('Data transfers to this country are blocked by Admin (DPDP Act setting).');
  const consent = await consentFor(s, u._id, a._id);
  if (consent.status !== 'Given') throw bad('The student has not given consent to share the application with this university. Request consent first.', { code: 'consent' });
  if (!passportOf(s)) throw bad('Passport number is empty (CD 7.6). Please complete the student profile first.');
  const vers = await sharedVersions(s, (Array.isArray(b.version_ids) ? b.version_ids : []).slice(0, 100));
  const t = new Date(); const prevStage = a.stage;
  const campus = a.course_id ? ((await Course.findById(a.course_id).select('campus_id').lean()) as Any)?.campus_id : null;
  const ua = await UniversityApplication.create({ application_id: a._id, university_id: u._id, campus_id: campus ?? undefined, status: 'New', status_changed_at: t, submitted_at: t, submitted_by: req.user!.id, cover_note: clean(b.cover_note, 1000),
    consent_id: oid(consent.id) ?? undefined, shared_fields: [u.share_contact && 'contact', u.share_passport && 'passport_full', u.share_visa && 'visa'].filter(Boolean), version: 1, created_by: req.user!.id });
  if (vers.length) await UniDocShare.insertMany(vers.map((v) => ({ uapp_id: ua._id, university_id: u._id, document_id: v.did, version_id: v.vid, shared_by: req.user!.id, shared_at: t, status: 'Shared' })));
  if (!['applied', 'under_review', 'interview', 'conditional_offer', 'unconditional_offer', 'offer_accepted', 'tuition_paid', 'enrolment_confirmed'].includes(a.stage)) {
    await Application.updateOne({ _id: a._id }, { stage: 'applied', stage_changed_at: t, applied_date: istDate(), channel: a.channel || 'La Europa partner portal', updated_by: req.user!.id });
    await StageHistory.create({ application_id: a._id, from_stage: prevStage, to_stage: 'applied', reason: 'Submitted to the university partner portal', notified: b.notify !== false, changed_by: req.user!.id, changed_at: t });
  }
  await timeline({ student_id: s._id, type: 'stage', description: `Application ${a.application_code} submitted to the ${P.uniName(u)} partner portal (${vers.length} document(s) shared)`, user_id: req.user!.id });
  await audit(req, 'Submit to university portal', 'Application', a._id, a.application_code, null, { documents: vers.length });
  const na = (await Application.findById(a._id).lean()) as Any;
  if (prevStage !== na.stage) await fire(req, 'E05', { student_id: s._id }, await appCtx(na, s, await workNames()), `Application ${a.application_code} applied via university portal (E05)`);
  const view = await P.appView(ua.toObject());
  await P.notifyUni(u._id, { roles: ['admin', 'officer'], campusId: campus }, `New application: ${view.student_name}, ${view.course} (${view.intake})`, `/applications/${ua._id}`);
  await trigger('E31', { to: emails(await P.usersOf(u._id, { roles: ['admin', 'officer'], alert: 'applications', campusId: campus })), university_id: u._id, uapp_id: ua._id, link: `/applications/${ua._id}`,
    ctx: { application_code: a.application_code, student_name: view.student_name, course: view.course, level: a.level, campus: view.campus ? `, ${esc(view.campus)}` : '', intake: view.intake, submitted_date: fmtDate(istDate()) } });
  res.json({ ok: true, id: String(ua._id) });
}));
async function loadUAstaff(req: AuthRequest, aid: string) {
  const { a, s } = await appOf(req, aid);
  const ua = (await UniversityApplication.findOne({ application_id: a._id, is_deleted: false }).lean()) as Any; if (!ua) throw bad('Not submitted to the university portal');
  return { a, s, ua, u: (await University.findById(ua.university_id).lean()) as Any };
}
const tellUni = (ua: Any, title: string) => P.notifyUni(ua.university_id, { roles: ['admin', 'officer'], campusId: ua.campus_id }, title, `/applications/${ua._id}`);
const uniEmails = async (ua: Any) => emails(await P.usersOf(ua.university_id, { roles: ['admin', 'officer'], alert: 'applications', campusId: ua.campus_id }));
router.post('/applications/:aid/university/share', h(async (req, res) => {
  need(req, 'documents', 'edit'); const { a, s, ua } = await loadUAstaff(req, req.params.aid);
  if (ua.status === 'Withdrawn') throw bad('Withdrawn application');
  let n = 0;
  for (const v of await sharedVersions(s, (Array.isArray(req.body?.version_ids) ? req.body.version_ids : []).slice(0, 50))) {
    if (await UniDocShare.exists({ uapp_id: ua._id, version_id: v.vid, status: { $nin: ['Revoked', 'Expired'] } })) continue;
    await UniDocShare.create({ uapp_id: ua._id, university_id: ua.university_id, document_id: v.did, version_id: v.vid, shared_by: req.user!.id, shared_at: new Date(), status: 'Shared' }); n++;
  }
  if (n) await tellUni(ua, `La Europa shared ${n} document(s) for ${a.application_code}`);
  await audit(req, 'Share with university', 'Application', a._id, `${n} document(s)`); res.json({ ok: true, shared: n });
}));
router.post('/university-shares/:sid/revoke', h(async (req, res) => {
  const x = oid(req.params.sid) ? await UniDocShare.findById(oid(req.params.sid)) : null; if (!x) throw P.NotFound();
  const ua = (await UniversityApplication.findById(x.uapp_id).lean()) as Any; await appOf(req, String(ua.application_id)); need(req, 'documents', 'edit');
  if (!clean(req.body?.reason)) throw fieldErr('reason', 'Reason is required');
  x.set({ status: 'Revoked', revoked_reason: clean(req.body.reason, 300), revoked_at: new Date() }); await x.save();
  await audit(req, 'Revoke university share', 'Document', x.document_id, req.body.reason); res.json({ ok: true });
}));
/** answer a university document request (C13): share against each item or reply "Not available", then send (E32) */
router.post('/applications/:aid/university/requests/:rid/answer', h(async (req, res) => {
  need(req, 'documents', 'edit'); const { a, s, ua, u } = await loadUAstaff(req, req.params.aid);
  const q = oid(req.params.rid) ? await UniDocRequest.findOne({ _id: oid(req.params.rid), uapp_id: ua._id, status: { $in: ['Open', 'Partly fulfilled'] } }) : null; if (!q) throw bad('This request is already closed');
  const types = await typeInfo(); const sent: string[] = [];
  for (const it of Array.isArray(req.body?.items) ? req.body.items : []) {
    const item = q.items.find((x: Any) => String(x._id) === String(it.item_id) && x.status === 'Open'); if (!item) continue;
    const label = item.title || types.get(String(item.document_type_id))?.name || 'Document';
    if (it.not_available) { if (!clean(it.reply)) throw bad('Write a message for items that are not available'); item.status = 'Not available'; item.reply = clean(it.reply, 500); sent.push(`${label}: not available (${clean(it.reply, 200)})`); continue; }
    if (!it.version_id) continue;
    const [v] = await sharedVersions(s, [it.version_id]); if (!v) continue;
    const sh = (await UniDocShare.findOne({ uapp_id: ua._id, version_id: v.vid, status: { $nin: ['Revoked', 'Expired'] } }).select('_id').lean()) as Any;
    const sid = sh?._id ?? (await UniDocShare.create({ uapp_id: ua._id, university_id: ua.university_id, document_id: v.did, version_id: v.vid, shared_by: req.user!.id, shared_at: new Date(), status: 'Shared' }))._id;
    item.status = 'Fulfilled'; item.share_id = sid; item.reply = clean(it.reply, 300);
    sent.push(label);
  }
  if (!sent.length) throw bad('Share a document or reply "Not available" for at least one item');
  const open = q.items.filter((i: Any) => i.status === 'Open').length;
  q.set({ status: open ? 'Partly fulfilled' : 'Fulfilled', answered_at: new Date(), opened_by_uni_at: null }); await q.save();
  if (!open) await closeRequestFlags(ua);
  const view = await P.appView(ua);
  await tellUni(ua, `La Europa shared ${sent.length} document(s) for ${a.application_code}`);
  await trigger('E32', { to: await uniEmails(ua), university_id: ua.university_id, uapp_id: ua._id, link: `/applications/${ua._id}`, ctx: { application_code: a.application_code, student_name: view.student_name, course: view.course, intake: view.intake, documents_list: ul(sent) } });
  await timeline({ student_id: s._id, type: 'document', description: `Documents sent to ${P.uniName(u)} for request (${sent.join(', ')})`, user_id: req.user!.id });
  await audit(req, 'Answer university request', 'UniDocRequest', q._id, sent.join(', ')); res.json({ ok: true, status: open ? 'Partly fulfilled' : 'Fulfilled' });
}));
const staffAction = (ua: Any, a: Any, type: string, to: string, by: string, data: Any = {}) => UniAction.create({ uapp_id: ua._id, university_id: ua.university_id, application_id: a._id, type, data, from_status: ua.status, to_status: to, by_staff_id: by, processing: 'Applied', processed_by: by, processed_at: new Date() });
/** C14: confirm acceptance, withdraw, offer declined */
router.post('/applications/:aid/university/confirm-acceptance', h(async (req, res) => {
  need(req, 'applications', 'edit'); const { a, s, ua, u } = await loadUAstaff(req, req.params.aid);
  if (!['Conditional offer', 'Unconditional offer'].includes(ua.status)) throw bad('The university has not issued an offer yet');
  const t = new Date();
  await UniversityApplication.updateOne({ _id: ua._id }, { status: 'Offer accepted', status_changed_at: t, $inc: { version: 1 } });
  await staffAction(ua, a, 'offer_accepted', 'Offer accepted', req.user!.id);
  if (a.stage !== 'offer_accepted') {
    await Application.updateOne({ _id: a._id }, { stage: 'offer_accepted', stage_changed_at: t, updated_by: req.user!.id });
    await StageHistory.create({ application_id: a._id, from_stage: a.stage, to_stage: 'offer_accepted', reason: 'Acceptance confirmed to the university', notified: req.body?.notify !== false, changed_by: req.user!.id, changed_at: t });
  }
  await closeSystemTask(`offer-deadline:${a._id}`);
  await fire(req, 'E05', { student_id: s._id }, await appCtx((await Application.findById(a._id).lean()) as Any, s, await workNames()), `Offer acceptance confirmed to ${P.uniName(u)} (E05)`);
  const view = await P.appView(ua);
  await tellUni(ua, `Offer accepted: ${view.student_name}`);
  await trigger('E34', { to: await uniEmails(ua), university_id: ua.university_id, uapp_id: ua._id, link: `/applications/${ua._id}`, ctx: { student_name: view.student_name, course: view.course, intake: view.intake, application_code: a.application_code } });
  await timeline({ student_id: s._id, type: 'stage', description: `Offer acceptance confirmed to ${P.uniName(u)} (${a.application_code})`, user_id: req.user!.id });
  await audit(req, 'Confirm acceptance', 'Application', a._id, a.application_code); res.json({ ok: true });
}));
router.post('/applications/:aid/university/withdraw', h(async (req, res) => {
  need(req, 'applications', 'edit'); const { a, s, ua, u } = await loadUAstaff(req, req.params.aid);
  if (['Withdrawn', 'Enrolled'].includes(ua.status)) throw bad('This application cannot be withdrawn');
  const b = req.body ?? {}; const declined = bool(b.declined);
  const reasonUni = declined ? 'Offer declined by the student' : clean(b.reason_university, 500); const reasonInt = clean(b.reason_internal, 1000);
  if (!reasonUni) throw fieldErr('reason_university', 'Reason for the university is required'); if (!reasonInt && !declined) throw fieldErr('reason_internal', 'Internal reason is required');
  const t = new Date();
  await UniversityApplication.updateOne({ _id: ua._id }, { status: 'Withdrawn', status_changed_at: t, withdrawn_at: t, withdraw_reason_uni: reasonUni, $inc: { version: 1 } });
  await staffAction(ua, a, 'withdrawn', 'Withdrawn', req.user!.id, { reason: reasonUni });
  await Application.updateOne({ _id: a._id }, { stage: 'withdrawn', stage_changed_at: t, updated_by: req.user!.id });
  await StageHistory.create({ application_id: a._id, from_stage: a.stage, to_stage: 'withdrawn', reason: reasonInt || reasonUni, notified: b.notify !== false, changed_by: req.user!.id, changed_at: t });
  await UniDocRequest.updateMany({ uapp_id: ua._id, status: { $in: ['Open', 'Partly fulfilled'] } }, { status: 'Cancelled', cancel_reason: 'Application withdrawn' });
  await fire(req, 'E05', { student_id: s._id }, await appCtx((await Application.findById(a._id).lean()) as Any, s, await workNames()), `Application withdrawn from ${P.uniName(u)} (E05)`);
  const view = await P.appView(ua);
  await tellUni(ua, `Withdrawn by La Europa: ${a.application_code}`);
  await trigger('E40', { to: await uniEmails(ua), university_id: ua.university_id, uapp_id: ua._id, link: `/applications/${ua._id}`, ctx: { application_code: a.application_code, student_name: view.student_name, course: view.course, intake: view.intake, withdraw_reason_for_university: reasonUni } });
  await timeline({ student_id: s._id, type: 'stage', description: `${a.application_code} withdrawn from ${P.uniName(u)}: ${reasonInt || reasonUni}`, user_id: req.user!.id });
  await audit(req, 'Withdraw from university', 'Application', a._id, reasonInt || reasonUni); res.json({ ok: true });
}));

// =====================================================================================
// C16 University updates queue (S45)
// =====================================================================================
/** the applications this staff member handles (all for admin and manager): one counsellor per student, plus applications they handle */
async function myApps(req: AuthRequest): Promise<Types.ObjectId[] | null> {
  if (seesAll(req)) return null;
  const studs = await Student.distinct('_id', { primary_counsellor_id: req.user!.id, is_deleted: { $ne: true } });
  return Application.distinct('_id', { $or: [{ student_id: { $in: studs } }, { handled_by: req.user!.id }], is_deleted: false });
}
const inApps = (ids: Types.ObjectId[] | null, field = 'application_id') => (ids ? { [field]: { $in: ids } } : {});
router.get('/university-updates', h(async (req, res) => {
  const ids = await myApps(req);
  const st = req.query.status === 'held' ? ['Held'] : req.query.status === 'done' ? ['Applied', 'Applied without notifying'] : ['Pending review', 'Held'];
  let appFilter = ids;
  if (req.query.counsellor && seesAll(req) && oid(req.query.counsellor)) { const studs = await Student.distinct('_id', { primary_counsellor_id: oid(req.query.counsellor) }); appFilter = await Application.distinct('_id', { student_id: { $in: studs } }); }
  const xs = (await UniAction.find({ processing: { $in: st }, ...inApps(appFilter) }).sort({ createdAt: req.query.status === 'done' ? -1 : 1 }).limit(300).lean()) as Any[];
  const apps = new Map(((await Application.find({ _id: { $in: xs.map((x) => x.application_id) } }).select('application_code student_id course_id course_name_text intake_id').lean()) as Any[]).map((a) => [String(a._id), a]));
  const N = await workNames();
  const studs = new Map(((await Student.find({ _id: { $in: [...apps.values()].map((a) => a.student_id) } }).select('first_name middle_name last_name').lean()) as Any[]).map((s) => [String(s._id), s]));
  const unis = new Map(((await University.find({ _id: { $in: xs.map((x) => x.university_id) } }).select('name display_name').lean()) as Any[]).map((u) => [String(u._id), P.uniName(u)]));
  res.json({ rows: xs.map((x) => { const a = apps.get(String(x.application_id)) ?? {}; return { id: String(x._id), type: x.type, label: A.DECISION_LABEL[x.type], processing: x.processing, held_note: x.held_note, created_at: x.createdAt,
    waiting_hours: Math.round((Date.now() - new Date(x.createdAt).getTime()) / 36e5), university: unis.get(String(x.university_id)), student: fullName(studs.get(String(a.student_id)) ?? {}), student_id: a.student_id ? String(a.student_id) : null,
    application_code: a.application_code, application_id: String(x.application_id), course: a.course_name_text || N.name(a.course_id), intake: N.name(a.intake_id), forced: !!x.forced_review }; }) });
}));
const actionOf = async (req: AuthRequest, id: string) => {
  const x = oid(id) ? ((await UniAction.findById(oid(id)).lean()) as Any) : null; if (!x) throw P.NotFound();
  const { a, s } = await appOf(req, String(x.application_id));
  return { x, a, s };
};
router.get('/university-updates/:id', h(async (req, res) => {
  const { x, a, s } = await actionOf(req, req.params.id);
  const d = x.data ?? {};
  const target = P.STAGE_OF[x.to_status];
  const code = x.type === 'waitlist' ? 'E43' : x.type === 'acknowledge' ? ((await getSetting('uni_ack_email')) === '0' ? null : 'E05') : target && target !== a.stage ? await triggerFor('app_stage', target) : x.type === 'interview' ? 'E06' : null;
  let pv: any = null;
  if (code) {
    const virt = { ...a, stage: target || a.stage, interview_at: d.at || a.interview_at, interview_link: d.link || a.interview_link, offer_conditions: d.conditions ? d.conditions.map((c: Any) => '- ' + c.text).join('\n') : a.offer_conditions, offer_deadline: d.acceptance_deadline || a.offer_deadline };
    try { pv = { ...(await previewFor(code, { student_id: s._id, ctx: await appCtx(virt, s, await workNames(), x.type === 'reject' && d.share_reason ? { include_reason_if_ticked: `Reason shared by the university: ${d.reason}` } : {}) })), code }; } catch { pv = null; }
  }
  const letters = [];
  for (const l of (await OfferLetter.find({ uapp_id: x.uapp_id, document_id: { $ne: null } }).sort({ createdAt: -1 }).limit(3).lean()) as Any[]) {
    const doc = (await StudentDocument.findById(l.document_id).lean()) as Any;
    letters.push({ type: l.type, issue_date: l.issue_date, url: fileUrl(verOf(doc, l.version_id)) });
  }
  const u = (await University.findById(x.university_id).select('name display_name').lean()) as Any;
  res.json({ id: String(x._id), type: x.type, label: A.DECISION_LABEL[x.type], processing: x.processing, data: d, from_status: x.from_status, to_status: x.to_status, created_at: x.createdAt, student: fullName(s), student_id: String(s._id),
    application_code: a.application_code, current_stage: a.stage, target_stage: target ?? null, email: pv, letters, student_payment_proofs: await PaymentSubmission.find({ application_id: a._id, is_deleted: { $ne: true } }).sort({ createdAt: -1 }).limit(3).lean(),
    university: P.uniName(u), held_note: x.held_note ?? null });
}));
router.post('/university-updates/:id/:action', h(async (req, res) => {
  const act = req.params.action; if (!['apply', 'hold'].includes(act)) throw P.NotFound();
  need(req, 'applications', 'edit');
  const { x, a, s } = await actionOf(req, req.params.id);
  const b = req.body ?? {};
  if (act === 'hold') { await A.hold(String(x._id), { id: req.user!.id }, b.note); await audit(req, 'Hold university update', 'Application', a._id, `${A.DECISION_LABEL[x.type]}: ${b.note}`); res.json({ ok: true }); return; }
  const notifyS = !(b.notify === false || b.notify === 'false');
  if (!notifyS && !bool(b.confirm_silent)) throw bad('Please confirm that the student will not be notified.', { needs_confirm: true });
  const out = (await A.apply(String(x._id), { id: req.user!.id, name: req.user!.name }, { notify: notifyS, message: clean(b.message, 500) ?? undefined, include_reason: bool(b.include_reason) })) as Any;
  if (!notifyS) await audit(req, 'Save without notifying', 'Student', s._id, `University decision ${A.DECISION_LABEL[x.type]} applied without notifying`);
  await audit(req, 'Apply university update', 'Application', a._id, `${A.DECISION_LABEL[x.type]}${notifyS ? '' : ' (without notifying)'}`);
  res.json({ ok: true, email: out?.email ?? null });
}));
router.get('/university-counts', h(async (req, res) => {
  const ids = await myApps(req);
  const pending = await UniAction.countDocuments({ processing: 'Pending review', ...inApps(ids) });
  const uas = ids ? await UniversityApplication.distinct('_id', { application_id: { $in: ids } }) : null;
  const requests = await UniDocRequest.countDocuments({ status: { $in: ['Open', 'Partly fulfilled'] }, ...inApps(uas, 'uapp_id') });
  const messages = await UniMessage.countDocuments({ sender_type: 'university', seen_by_le_at: null, deleted_at: null, uapp_id: uas ? { $in: uas } : { $ne: null } })
    + (isAdmin(req) ? await UniMessage.countDocuments({ uapp_id: null, sender_type: 'university', seen_by_le_at: null, deleted_at: null }) : 0);
  const { CourseChangeRequest, UniProfileRequest } = await import('../models/Partner');
  const approvals = isAdmin(req) ? (await CourseChangeRequest.countDocuments({ status: 'Pending approval', is_deleted: false })) + (await UniProfileRequest.countDocuments({ status: 'Pending' })) : 0;
  res.json({ pending, requests, messages, approvals, total: pending + requests + messages });
}));
router.get('/university-news', h(async (_req, res) => {
  const { UniAnnouncement } = await import('../models/Partner');
  const today = istDate();
  const rows = (await UniAnnouncement.find({ published_at: { $ne: null }, $or: [{ valid_until: null }, { valid_until: { $gte: today } }] }).sort({ important: -1, published_at: -1 }).limit(10).lean()) as Any[];
  const unis = new Map(((await University.find({ _id: { $in: rows.map((r) => r.university_id) } }).select('name').lean()) as Any[]).map((u) => [String(u._id), u.name]));
  res.json(rows.map((a) => ({ id: String(a._id), university: unis.get(String(a.university_id)), type: a.type, title: a.title, body: a.body, important: !!a.important, published_at: a.published_at })));
}));

// =====================================================================================
// C15 University messages (S48)
// =====================================================================================
async function staffMsgOut(m: Any, userId: string) {
  const sender = m.sender_type === 'staff' ? await staffName(m.sender_user_id) : ((await PortalAccount.findById(m.sender_account_id).select('name').lean()) as Any)?.name;
  return { id: String(m._id), mine: m.sender_type === 'staff' && String(m.sender_user_id) === userId, side: m.sender_type === 'staff' ? 'La Europa' : 'University', sender: sender ?? null, body: m.deleted_at ? null : m.body ?? null,
    deleted: !!m.deleted_at, edited: !!m.edited_at, sent_at: m.sent_at, seen: m.sender_type === 'staff' ? m.seen_by_uni_at ?? null : m.seen_by_le_at ?? null,
    attachments: m.deleted_at ? [] : (m.attachments ?? []).map((x: Any) => ({ id: String(x._id), original_name: x.original_name, mime_type: x.mime_type, size_bytes: x.size_bytes, saved_document_id: x.saved_document_id ? String(x.saved_document_id) : null })),
    context: m.context_type ? { type: m.context_type, id: m.context_id } : null, can_edit: m.sender_type === 'staff' && String(m.sender_user_id) === userId && !m.deleted_at && Date.now() - new Date(m.sent_at).getTime() < 15 * 60000 };
}
const last = (f: Any) => UniMessage.findOne({ ...f, deleted_at: null }).sort({ sent_at: -1 }).lean() as Promise<Any>;
router.get('/university-messages', h(async (req, res) => {
  const ids = await myApps(req);
  const uas = (await UniversityApplication.find({ ...inApps(ids), _id: { $in: await UniMessage.distinct('uapp_id', { uapp_id: { $ne: null } }) } }).lean()) as Any[];
  const rows: Any[] = [];
  for (const ua of uas) {
    const l = await last({ uapp_id: ua._id }); const v = await P.appView(ua); const u = (await University.findById(ua.university_id).select('name display_name').lean()) as Any;
    rows.push({ key: String(ua._id), application_id: String(ua.application_id), university: P.uniName(u), title: `${v.application_code}: ${v.student_name}`, sub: `${v.course} (${v.intake})`, last_at: l?.sent_at ?? null,
      last_text: l ? String(l.body || 'Attachment').slice(0, 90) : '', unread: await UniMessage.countDocuments({ uapp_id: ua._id, sender_type: 'university', seen_by_le_at: null, deleted_at: null }) });
  }
  const managed = isAdmin(req) ? null : await University.distinct('_id', { partner_manager_id: req.user!.id });
  for (const uid of await UniMessage.distinct('university_id', { uapp_id: null, ...(managed ? { university_id: { $in: managed } } : {}) })) {
    const u = (await University.findById(uid).select('name display_name').lean()) as Any; const l = await last({ uapp_id: null, university_id: uid });
    rows.push({ key: 'general:' + uid, university: P.uniName(u), title: `${P.uniName(u)}: General`, sub: 'Partner topics', last_at: l?.sent_at ?? null, last_text: l ? String(l.body || '').slice(0, 90) : '',
      unread: await UniMessage.countDocuments({ uapp_id: null, university_id: uid, sender_type: 'university', seen_by_le_at: null }) });
  }
  rows.sort((a, b) => new Date(b.last_at || 0).getTime() - new Date(a.last_at || 0).getTime());
  res.json({ rows, universities: isAdmin(req) ? ((await University.find({ portal_status: 'Active' }).select('name display_name').lean()) as Any[]).map((u) => ({ id: String(u._id), name: P.uniName(u) })) : [] });
}));
async function threadKey(req: AuthRequest, key: string): Promise<{ ua?: Any; university_id: unknown }> {
  if (String(key).startsWith('general:')) {
    const uid = oid(key.slice(8)); if (!uid) throw P.NotFound();
    if (!isAdmin(req) && !(await University.exists({ _id: uid, partner_manager_id: req.user!.id }))) throw new HttpError(403, 'Not allowed');
    return { university_id: uid };
  }
  const ua = oid(key) ? ((await UniversityApplication.findOne({ $or: [{ _id: oid(key) }, { application_id: oid(key) }] }).lean()) as Any) : null; if (!ua) throw P.NotFound();
  await appOf(req, String(ua.application_id));
  return { ua, university_id: ua.university_id };
}
const threadFilter = (t: { ua?: Any; university_id: unknown }): Any => (t.ua ? { uapp_id: t.ua._id } : { uapp_id: null, university_id: t.university_id });
router.get('/university-messages/attachment/:aid', h(async (req, res) => {
  const m = oid(req.params.aid) ? ((await UniMessage.findOne({ 'attachments._id': oid(req.params.aid) }).lean()) as Any) : null; if (!m) throw P.NotFound();
  await threadKey(req, m.uapp_id ? String(m.uapp_id) : 'general:' + m.university_id);
  const at = m.attachments.find((x: Any) => String(x._id) === req.params.aid);
  res.json({ url: signedFileUrl(at.file?.url, at.file?.public_id, at.file?.resource_type), name: at.original_name });
}));
router.get('/university-messages/:key', h(async (req, res) => {
  const t = await threadKey(req, req.params.key);
  const rows = (await UniMessage.find(threadFilter(t)).sort({ sent_at: 1 }).lean()) as Any[];
  await UniMessage.updateMany({ ...threadFilter(t), sender_type: 'university', seen_by_le_at: null }, { seen_by_le_at: new Date() });
  const u = (await University.findById(t.university_id).lean()) as Any;
  const out = []; for (const m of rows) out.push(await staffMsgOut(m, req.user!.id));
  res.json({ rows: out, share_contact: !!u?.share_contact, university: P.uniName(u), closed: t.ua?.status === 'Withdrawn' });
}));
const CONTACT_RE = /(\+?\d[\d\s-]{8,}\d)|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
router.post('/university-messages/:key', upload.array('files', 5), h(async (req, res) => {
  const t = await threadKey(req, req.params.key);
  const u = (await University.findById(t.university_id).lean()) as Any;
  const body = String(req.body?.body || '').replace(/<[^>]*>/g, '').trim().slice(0, 5000);
  const list = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!body && !list.length) throw bad('Write a message or attach a file');
  checkAttachments(list);
  const hit = body.match(CONTACT_RE); const looksContact = !!hit && !/@laeuropa/i.test(hit[0]);
  if (looksContact && !u.share_contact && !bool(req.body.confirm_contact)) throw bad('This message seems to contain contact details. Student contact details are not shared with this university. Send anyway?', { needs_confirm: 'contact' });
  const attachments = [];
  for (const f of list) { const asset = await uploadBuffer(f, `university/${t.university_id}/messages`); attachments.push({ file: { url: asset.url, public_id: asset.publicId, resource_type: asset.resourceType }, original_name: f.originalname, mime_type: f.mimetype, size_bytes: f.size }); }
  const m = await UniMessage.create({ uapp_id: t.ua?._id, university_id: t.university_id, sender_type: 'staff', sender_user_id: req.user!.id, body: body || undefined, sent_at: new Date(), contact_warning: looksContact, attachments });
  const code = t.ua ? (await P.appView(t.ua)).application_code : null;
  await P.notifyUni(t.university_id, t.ua ? { campusId: t.ua.campus_id } : {}, `La Europa: new message${code ? ' on ' + code : ''}`, t.ua ? `/applications/${t.ua._id}?tab=messages` : '/messages');
  await audit(req, 'Create', 'UniversityMessage', m._id, `${P.uniName(u)}${looksContact ? ' (contact warning confirmed)' : ''}`);
  res.json({ id: String(m._id) });
}));
router.put('/university-messages/m/:mid', h(async (req, res) => {
  const m = oid(req.params.mid) ? await UniMessage.findById(oid(req.params.mid)) : null; if (!m) throw P.NotFound();
  await threadKey(req, m.uapp_id ? String(m.uapp_id) : 'general:' + m.university_id);
  const own = m.sender_type === 'staff' && String(m.sender_user_id) === req.user!.id;
  if (!(own && Date.now() - new Date(m.sent_at).getTime() < 15 * 60000) && !isAdmin(req)) throw bad('Messages can be edited or deleted only within 15 minutes.');
  if (req.body?.delete) m.set({ deleted_at: new Date(), original_body: m.original_body ?? m.body });
  else { if (!own) throw new HttpError(403, 'Not allowed'); m.set({ original_body: m.original_body ?? m.body, body: String(req.body?.body || '').trim().slice(0, 5000), edited_at: new Date() }); }
  await m.save();
  await audit(req, req.body?.delete ? 'Delete' : 'Update', 'UniversityMessage', m._id); res.json({ ok: true });
}));
/** "Save to student documents" */
router.post('/university-messages/attachment/:aid/save', h(async (req, res) => {
  const m = oid(req.params.aid) ? await UniMessage.findOne({ 'attachments._id': oid(req.params.aid) }) : null; if (!m?.uapp_id) throw P.NotFound();
  const ua = (await UniversityApplication.findById(m.uapp_id).lean()) as Any; const { a } = await appOf(req, String(ua.application_id)); need(req, 'documents', 'add');
  const at = m.attachments.find((x: Any) => String(x._id) === req.params.aid);
  const ext = String(at.original_name.split('.').pop()).toLowerCase(); if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) throw bad('Only PDF, JPG and PNG files can be saved to student documents');
  const t = (oid(req.body?.document_type_id) ? await MasterItem.findOne({ _id: oid(req.body.document_type_id), type: 'document_type' }) : null) || (await MasterItem.findOne({ type: 'document_type', name: 'Other university document' })) || (await MasterItem.findOne({ type: 'document_type', name: 'Others' }));
  if (!t) throw bad('No document type to save into');
  const r = await fetch(signedFileUrl(at.file?.url, at.file?.public_id, at.file?.resource_type) || ''); if (!r.ok) throw new HttpError(502, 'The file could not be read from storage.');
  const buffer = Buffer.from(await r.arrayBuffer());
  const doc = await docFor(a.student_id, t._id as Types.ObjectId, { title: t.name === 'Others' ? at.original_name : undefined, application_id: a._id }, req.user!.id);
  await addVersion(doc, { buffer, originalname: at.original_name, mimetype: at.mime_type, size: buffer.length }, ext === 'jpeg' ? 'jpg' : ext, req.user!.id);
  at.saved_document_id = doc._id; await m.save(); res.json({ ok: true });
}));

// =====================================================================================
// C18 University sharing consent (student profile) and the student portal popup SP26
// =====================================================================================
const portalApps = async (studentId: unknown) => {
  const active = await University.distinct('_id', { portal_status: 'Active' });
  return (await Application.find({ student_id: studentId, is_deleted: false, university_id: { $in: active } }).lean()) as Any[];
};
router.get('/students/:id/uni-consents', h(async (req, res) => {
  const { loadStudent } = await import('../services/students');
  const s = (await loadStudent(req, req.params.id)) as any;
  const out = [];
  for (const a of await portalApps(s._id)) { const u = (await University.findById(a.university_id).select('name display_name').lean()) as Any;
    out.push({ university_id: String(a.university_id), university: P.uniName(u), application_id: String(a._id), application_code: a.application_code, ...(await consentFor(s, a.university_id, a._id)) }); }
  res.json(out);
}));
router.post('/students/:id/uni-consents/request', h(async (req, res) => {
  const { loadStudent } = await import('../services/students');
  const s = (await loadStudent(req, req.params.id)) as any; need(req, 'applications', 'edit');
  const a = oid(req.body?.application_id) ? ((await Application.findOne({ _id: oid(req.body.application_id), student_id: s._id, is_deleted: false }).lean()) as Any) : null; if (!a) throw P.NotFound();
  const u = (await University.findById(a.university_id).lean()) as Any; if (!u) throw bad('This application has no university');
  await ShareConsentRequest.create({ student_id: s._id, university_id: u._id, application_id: a._id, status: 'Requested', requested_by: req.user!.id, requested_at: new Date() });
  const su = await suOfStudent(s._id);
  const country = u.country_id ? ((await Country.findById(u.country_id).select('name').lean()) as Any)?.name : '';
  const N = await workNames();
  await fire(req, 'E49', { student_id: s._id }, { university: P.uniName(u), course: a.course_name_text || N.name(a.course_id), country }, `Sharing consent requested for ${P.uniName(u)} (E49)`, { inAppTitle: `Please confirm: share your application with ${P.uniName(u)}` });
  await timeline({ student_id: s._id, type: 'profile', description: `University sharing consent requested for ${P.uniName(u)}`, user_id: req.user!.id });
  res.json({ ok: true, portal: !!su });
}));
router.post('/students/:id/uni-consents/offline', upload.single('file'), h(async (req, res) => {
  const { loadStudent } = await import('../services/students');
  const s = (await loadStudent(req, req.params.id)) as any; need(req, 'documents', 'add');
  const a = oid(req.body?.application_id) ? ((await Application.findOne({ _id: oid(req.body.application_id), student_id: s._id, is_deleted: false }).lean()) as Any) : null; if (!a) throw P.NotFound();
  if (!req.file) throw fieldErr('file', 'Upload the signed consent form'); if (!clean(req.body.reason)) throw fieldErr('reason', 'Reason is required (why the consent was taken offline)');
  checkFile(req.file, ALLOWED, 25);
  const d = await saveAs(s._id, 'Consent form', req.file, req.user!.id, { application_id: a._id, title: 'Consent form' });
  const su = await suOfStudent(s._id);
  await CONSENT.record(req, { suId: su?._id, type: 'share_with_university', value: true, method: 'offline_signed_form', universityId: a.university_id, applicationId: a._id,
    extra: { student_id: String(s._id), document_id: d.document_id, recorded_by: req.user!.id, reason: clean(req.body.reason, 300) } });
  await ShareConsentRequest.updateMany({ student_id: s._id, university_id: a.university_id, status: 'Requested' }, { status: 'Given', answered_at: new Date(), method: 'offline', document_id: d.document_id });
  const u = (await University.findById(a.university_id).select('name display_name').lean()) as Any;
  await timeline({ student_id: s._id, type: 'profile', description: `Offline sharing consent recorded for ${P.uniName(u)} (${clean(req.body.reason, 200)})`, user_id: req.user!.id });
  await audit(req, 'Create', 'ConsentRecord', s._id, `Offline sharing consent ${a.application_code}`); res.json({ ok: true });
}));

export default router;
