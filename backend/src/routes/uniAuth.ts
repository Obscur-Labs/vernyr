import { Router, type Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import University from '../models/University';
import { getSetting } from '../models/Audit';
import { UniCode, UniConsent, UniLoginAttempt } from '../models/Partner';
import type { AuthRequest } from '../middleware/auth';
import { loginLimiter, signupLimiter } from '../middleware/rateLimit';
import { ipAllowed, uniToken } from '../middleware/university';
import { HttpError, bad, clean, handle, istDate } from '../services/crm';
import { issueCode, checkCode, maskEmail, CodeError } from '../services/authCodes';
import { passwordProblem } from '../services/passwords';
import { sendSecurity } from '../services/email';
import { notify, notifyAdmins } from '../services/tasks';
import * as CONSENT from '../services/consent';
import * as P from '../services/partner';
import { trigger, portalLink } from '../services/uemail';

/** The client's partner portal sign-in (legacy/server/university/auth.js): password, a first-login email code, invite activation, forgot / reset, staff preview. */

/* eslint-disable @typescript-eslint/no-explicit-any */
const router = Router();
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const GENERIC = 'Invalid email or password';
const LOCKED = 'Too many attempts. Your account is locked for 30 minutes. You can reset your password.';
const EXPIRED = 'This link has expired. Please ask La Europa to resend it.';
const codeErr = (fn: (req: AuthRequest, res: Response) => Promise<void>) => async (req: AuthRequest, res: Response) => {
  try { await fn(req, res); } catch (e) { if (e instanceof CodeError) throw new HttpError(e.status, e.message, { errors: { code: e.message } }); throw e; }
};
const failuresSince = (ident: string, min: number) => UniLoginAttempt.countDocuments({ ident, success: false, createdAt: { $gt: new Date(Date.now() - min * 60_000) } });
const ipFailures = (ip?: string) => UniLoginAttempt.countDocuments({ ip, success: false, createdAt: { $gt: new Date(Date.now() - 15 * 60_000) } });

export const pwRule = (pw: string, who: (string | undefined)[] = []) => { const p = passwordProblem(String(pw ?? ''), 'partner', who); if (p) throw bad(p, { errors: { password: p } }); };
export async function notReused(su: IPortalAccount, pw: string) {
  const hist = [...(su.pwHistory ?? []), su.password].filter(Boolean).slice(-5);
  for (const h of hist) if (await bcrypt.compare(String(pw), h)) throw bad('New password cannot be the same as any of your last 5 passwords', { errors: { password: 'Used recently' } });
}
/** a new password: kept off the last five, and every token issued before it stops working */
export async function setPassword(su: IPortalAccount, pw: string) {
  if (su.password) su.pwHistory = [...(su.pwHistory ?? []), su.password].slice(-5);
  su.password = pw; su.passwordChangedAt = new Date();
  await su.save();
}
export const sendCode = async (su: IPortalAccount, purpose: 'login' | 'invite' | 'reset', subject: string) => {
  const otp = await issueCode({ accountId: su._id as never, email: String(su.email), purpose, app: 'partner',
    mail: { subject, text: (c) => `Your La Europa partner portal code is ${c}.\n\nIt is valid for 10 minutes. Do not share this code with anyone.` } });
  return { code_id: otp, masked: maskEmail(String(su.email)) };
};
const ua = (req: AuthRequest) => String(req.headers['user-agent'] || '').slice(0, 300);

export async function meOut(su: IPortalAccount) {
  const u: any = await University.findById(su.universityId).lean();
  return { id: String(su._id), name: su.name, email: su.email, role: su.uniRole, role_label: P.ROLE_LABEL[su.uniRole ?? 'officer'], finance: !!(su.finance || su.uniRole === 'admin'),
    designation: su.designation ?? null, phone: su.phone ?? null, twofa_method: null, alerts: su.alerts ?? null, campuses: (su.campuses ?? []).map(String), main_contact: !!su.isMainContact,
    university: { id: String(u._id), name: u.display_name || u.name, short_name: u.short_name ?? null, logo: `/api/logos/${u._id}${u.logo_updated_at ? `?v=${+new Date(u.logo_updated_at)}` : ''}`, country: null,
      status: u.portal_status, officers_propose: !!u.officers_propose, viewer_docs: !!u.viewer_docs, zip: !!u.zip_download, viewer_exports: !!u.viewer_exports, show_expected: !!u.show_expected_commission },
    idle_min: Number(await getSetting('uni_idle_min')) || 30 };
}
async function finishLogin(req: AuthRequest, res: Response, su: IPortalAccount, how: string) {
  const firstDevice = !!su.lastLoginAt && su.flags?.last_ua !== ua(req);
  su.failedLogins = 0; su.lockedUntil = undefined; su.lastLoginAt = new Date(); su.flags = { ...(su.flags ?? {}), last_ua: ua(req) };
  await su.save();
  // new device alert (SE6)
  if (firstDevice) await sendSecurity({ to: String(su.email), subject: 'New login to your La Europa partner portal account', text: `There was a new login to your La Europa partner portal account on ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })} IST from ${ua(req).slice(0, 80)}.\nIf this was not you, reset your password now and tell La Europa.` }).catch(() => {});
  (req as any).auditAccountId = su._id;
  await P.uaudit(req as never, 'Login', 'UniversityUser', su._id, how, null, null, su.universityId);
  res.json({ token: uniToken(su), user: await meOut(su) });
}

router.get('/legal/:type', handle(async (req, res) => { const t = ['uni_terms', 'uni_dpa'].includes(req.params.type) ? req.params.type : 'uni_terms'; res.json((await CONSENT.publicDoc(t)) || {}); }));

router.post('/login', loginLimiter, handle(async (req, res) => {
  const em = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(req.body?.password || '');
  if (password.length > 200) throw new HttpError(401, GENERIC);
  if ((await ipFailures(req.ip)) >= 30) throw new HttpError(429, 'Too many failed logins from this network. Please try again later.');
  const su = await PortalAccount.findOne({ role: 'university', email: em });
  const key = su ? String(su._id) : em;
  const fail = async () => {
    await UniLoginAttempt.create({ ident: key, success: false, ip: req.ip });
    (req as any).auditAccountId = su?._id;
    await P.uaudit(req as never, 'Failed login', 'UniversityUser', su?._id, em.replace(/^(.{2}).*(@.*)$/, '$1***$2'), null, null, su?.universityId);
    throw new HttpError(401, GENERIC);
  };
  // an unknown email is "locked" the same way, so a 423 never tells whether an account exists
  if ((su?.lockedUntil && su.lockedUntil > new Date()) || (!su && (await failuresSince(key, 15)) >= 5)) throw new HttpError(423, LOCKED);
  const ok = su ? await su.comparePassword(password) : await bcrypt.compare(password, '$2a$12$abcdefghijklmnopqrstuuJ8sCn4C1k7fUo7lHQyR9oQkPqq7k9Ge');
  if (!ok || !su) {
    const n = (await failuresSince(key, 15)) + 1;
    if (su && n >= 5) {
      su.lockedUntil = new Date(Date.now() + 30 * 60_000); await su.save();
      await UniLoginAttempt.create({ ident: key, success: false, ip: req.ip });
      (req as any).auditAccountId = su._id;
      await P.uaudit(req as never, 'Lockout', 'UniversityUser', su._id, su.email, null, null, su.universityId);
      await P.notifyUni(su.universityId, { roles: ['admin'] }, `Account locked after 5 wrong passwords: ${su.name}`, '/users');
      const u = await University.findById(su.universityId).lean();
      await notifyAdmins('university', `University user locked out: ${su.name} (${P.uniName(u)})`, '/admin/university');
      await sendSecurity({ to: String(su.email), subject: 'Your La Europa partner portal account was locked', text: `There were 5 wrong passwords on your La Europa partner portal account, so it is locked for 30 minutes.\nIf this was not you, reset your password and tell La Europa.` }).catch(() => {});
      throw new HttpError(423, LOCKED);
    }
    await fail();
  }
  const u = await University.findById(su!.universityId);
  if (su!.status === 'Invited') throw bad('Please finish setting up your account from the invite link in your email.');
  if (su!.status !== 'Active' || !su!.isActive) await fail();
  if (!u || ['Suspended', 'Closed', 'Draft'].includes(String(u.portal_status))) throw new HttpError(403, 'Your access is paused. Please contact La Europa.');
  if (!ipAllowed(u, req.ip)) throw new HttpError(403, 'Access from this network is not allowed for your institution.');
  await UniLoginAttempt.create({ ident: key, success: true, ip: req.ip });
  // no 2FA (La Europa decision, Nov 2026): only a first login without a verified email gets a one-time email code
  if (!su!.emailVerifiedAt) {
    (req as any).auditAccountId = su!._id;
    await P.uaudit(req as never, 'Login', 'UniversityUser', su!._id, 'Password OK, first-login email code sent', null, null, su!.universityId);
    res.json({ need_2fa: true, method: 'email', first_login: true, ...(await sendCode(su!, 'login', 'Your La Europa partner portal verification code')) });
    return;
  }
  await finishLogin(req, res, su!, 'Login with password');
}));
router.post('/2fa/verify', loginLimiter, handle(codeErr(async (req, res) => {
  const o = await checkCode(req.body?.code_id, String(req.body?.code || '').replace(/\s/g, ''), 'login');
  const su = await PortalAccount.findOne({ _id: o.accountId, role: 'university' });
  if (!su) throw bad('Please log in again.');
  su.emailVerifiedAt ??= new Date();
  await finishLogin(req, res, su, 'First login, email verified');
})));

// ---------- invite activation (2.5, 2.6) ----------
const byInvite = (token: string) => PortalAccount.findOne({ role: 'university', inviteTokenHash: sha(String(token)), inviteExpiresAt: { $gt: new Date() } });
router.get('/invite/:token', handle(async (req, res) => {
  const su = await byInvite(req.params.token);
  if (!su) { res.json({ valid: false, message: EXPIRED }); return; }
  const u = await University.findById(su.universityId).lean();
  res.json({ valid: true, email: su.email, name: su.name, designation: su.designation ?? null, phone: su.phone ?? null, university: P.uniName(u), password_set: su.status === 'Active',
    terms: await CONSENT.publicDoc('uni_terms'), dpa: await CONSENT.publicDoc('uni_dpa') });
}));
router.post('/invite/:token/request-new', loginLimiter, handle(async (req, res) => {
  const su = await PortalAccount.findOne({ role: 'university', inviteTokenHash: sha(String(req.params.token)) }).lean();
  if (su) { const u = await University.findById(su.universityId).lean(); if (u?.partner_manager_id) await notify(u.partner_manager_id, 'university', `${su.name} (${P.uniName(u)}) asked for a new partner portal invite link`, '/admin/university'); }
  res.json({ message: 'La Europa has been told and will send you a new link.' });
}));
router.post('/invite/:token/start', loginLimiter, handle(codeErr(async (req, res) => {
  const su = await byInvite(req.params.token); if (!su) throw bad(EXPIRED);
  res.json(await sendCode(su, 'invite', 'Your La Europa partner portal code'));
})));
router.post('/invite/:token/accept', loginLimiter, handle(codeErr(async (req, res) => {
  const su = await byInvite(req.params.token); if (!su) throw bad(EXPIRED);
  const b = req.body ?? {}; const errors: Record<string, string> = {};
  if (!clean(b.name)) errors.name = 'Full name is required';
  const pw = passwordProblem(String(b.password ?? ''), 'partner', [su.email, b.name]); if (pw) errors.password = pw;
  if (b.password !== b.confirm) errors.confirm = 'Passwords do not match';
  if (!b.accept_terms) errors.accept_terms = 'Please accept the Portal Terms of Use and Data Processing terms';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const o = await checkCode(b.code_id, b.code, 'invite');
  if (String(o.accountId) !== String(su._id)) throw bad('Please start again.');
  su.name = clean(b.name, 100) || su.name; su.designation = clean(b.designation, 100) || su.designation; su.phone = clean(b.phone, 30) || su.phone;
  for (const t of ['uni_terms', 'uni_dpa']) { const d: any = await CONSENT.current(t); await UniConsent.create({ account_id: su._id, university_id: su.universityId, doc_type: t, version: d?.version, doc_hash: d?.body_hash, ip: req.ip, user_agent: ua(req) }); }
  // the invite email code is the first-login verification: the account is active now
  su.status = 'Active'; su.isActive = true; su.emailVerifiedAt ??= new Date(); su.inviteTokenHash = undefined; su.inviteExpiresAt = undefined;
  await setPassword(su, String(b.password));
  const u = await University.findById(su.universityId);
  if (u && u.portal_status === 'Invited') { u.portal_status = 'Active'; await u.save(); }
  await notifyAdmins('university', `${su.name} (${P.uniName(u)}) activated the partner portal account`, '/admin/university');
  (req as any).auditAccountId = su._id;
  await P.uaudit(req as never, 'Invite accepted', 'UniversityUser', su._id, su.email, null, null, su.universityId);
  await finishLogin(req, res, su, 'Invite accepted, email verified');
})));

// ---------- forgot / reset (2.10): a 6-digit code by email, the same answer whether or not the email exists ----------
router.post('/forgot', signupLimiter, handle(codeErr(async (req, res) => {
  const msg = 'If this email is registered, we have emailed a 6-digit code. It is valid for 10 minutes.';
  const su = await PortalAccount.findOne({ role: 'university', email: String(req.body?.email || '').trim().toLowerCase(), status: 'Active' });
  if (!su) { res.json({ message: msg, code_id: crypto.randomBytes(12).toString('hex') }); return; }
  const s = await sendCode(su, 'reset', 'Your La Europa partner portal password reset code');
  res.json({ message: msg, code_id: s.code_id });
})));
router.post('/reset', loginLimiter, handle(codeErr(async (req, res) => {
  const b = req.body ?? {};
  pwRule(b.password);
  if (b.password !== b.confirm) throw bad('Passwords do not match', { errors: { confirm: 'Does not match' } });
  // the emailed code FIRST, then the "not reused" rule (no password guessing through reset)
  const o = await checkCode(b.code_id, String(b.code || '').replace(/\s/g, ''), 'reset');
  const su = await PortalAccount.findOne({ _id: o.accountId, role: 'university' });
  if (!su) throw bad('This code has expired. Please request a new one.');
  pwRule(b.password, [su.email, su.name]);
  await notReused(su, b.password);
  su.emailVerifiedAt ??= new Date(); su.lockedUntil = undefined; su.failedLogins = 0;
  await setPassword(su, String(b.password));
  await sendSecurity({ to: String(su.email), subject: 'Your La Europa partner portal password was changed', text: `Your partner portal password was changed.\nIf this was not you, contact La Europa immediately.` }).catch(() => {});
  (req as any).auditAccountId = su._id;
  await P.uaudit(req as never, 'Password reset', 'UniversityUser', su._id, null, null, null, su.universityId);
  res.json({ message: 'Your password has been changed. Please log in.' });
})));

// "View as university" (read only, logged): a one-time code from La Europa Admin, exchanged for a 2-hour read-only token
router.post('/preview', loginLimiter, handle(async (req, res) => {
  const o: any = await UniCode.findOneAndUpdate({ code_hash: sha(String(req.body?.token || '')), purpose: 'preview', used: false, expires_at: { $gt: new Date() } }, { used: true });
  if (!o) throw bad('This preview link has expired.');
  const { uniPreviewToken } = await import('../middleware/university');
  const su = await PortalAccount.findById(o.account_id);
  if (!su) throw bad('This preview link has expired.');
  res.json({ token: uniPreviewToken(su._id, String(o.payload?.by)), user: await meOut(su), preview: true });
}));
router.post('/logout', handle(async (_req, res) => { res.json({ ok: true }); }));

// ---------- invites issued by La Europa Admin or University Admin ----------
export async function issueInvite(suId: unknown) {
  const su = await PortalAccount.findById(suId);
  if (!su) throw bad('User not found');
  const today = istDate();
  if (su.inviteDay === today && (su.inviteSentCount ?? 0) >= 5) throw bad('Maximum 5 invites per day for this user');
  const token = crypto.randomBytes(32).toString('base64url');
  const days = Math.max(1, Math.min(30, Number((await getSetting('uni_invite_days')) || 7)));
  su.inviteTokenHash = sha(token); su.inviteExpiresAt = new Date(Date.now() + days * 864e5); su.inviteSentCount = su.inviteDay === today ? (su.inviteSentCount ?? 0) + 1 : 1; su.inviteDay = today;
  await su.save();
  const link = `${await portalLink()}/invite/${token}`;
  await trigger('E38', { to: [su.email], university_id: su.universityId, ctx: { invite_link: link, university_user_name: su.name }, user_name: su.name, link: '/' });
  return { link };
}

export default router;
