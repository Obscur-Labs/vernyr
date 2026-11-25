import { Router } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { env } from '../config/env';
import { loginLimiter } from '../middleware/rateLimit';
import PortalAccount from '../models/PortalAccount';
import Student from '../models/Student';
import { bad, fieldErr, handle, HttpError } from '../services/crm';
import { sha } from '../services/portal';
import { issueCode, checkCode, CodeError } from '../services/authCodes';
import { passwordProblem } from '../services/passwords';
import { record } from '../services/consent';
import { loadCtx, displayName, notifyStaff, studentTimeline, portalAudit } from '../services/portalCtx';

/** Accepting a student portal invite (legacy/server/portal/auth.js /invite/*): public, before the portal guard. */
const router = Router();
const EXPIRED = 'This link has expired. Please ask your counsellor to resend it, or use Forgot password.';
const mask = (e: string) => { const [u, d] = e.split('@'); return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`; };
const byToken = (token: string) => PortalAccount.findOne({ inviteTokenHash: sha(String(token)), role: 'student' });
const live = async (token: string) => { const su = await byToken(token); return su && su.inviteExpiresAt && su.inviteExpiresAt > new Date() ? su : null; };
const codeErr = (fn: Parameters<typeof handle>[0]): Parameters<typeof handle>[0] => async (req, res) => {
  try { await fn(req, res); } catch (e) { if (e instanceof CodeError) throw new HttpError(e.status, e.message); throw e; }
};

router.get('/invite/:token', handle(async (req, res) => {
  const su = await live(req.params.token);
  if (!su) { res.json({ valid: false, message: EXPIRED }); return; }
  const s = su.studentId ? await Student.findById(su.studentId).select('first_name').lean() : null;
  res.json({ valid: true, first_name: s?.first_name ?? '', channel: 'email', masked: su.email ? mask(su.email) : '' });
}));
router.post('/invite/:token/request-new', loginLimiter, handle(async (req, res) => {
  const su = await byToken(req.params.token);
  if (su) { const c = await loadCtx(su); await notifyStaff(c, 'portal', `${displayName(c)} asked for a new student portal invite link`); }
  res.json({ message: 'Your counsellor has been told. They will send you a new link.' });
}));
router.post('/invite/:token/start', loginLimiter, handle(codeErr(async (req, res) => {
  const su = await live(req.params.token);
  if (!su?.email) throw bad(EXPIRED);
  res.json({ otp_id: await issueCode({ accountId: su._id as Types.ObjectId, email: su.email, purpose: 'invite', app: 'portal' }), masked: mask(su.email) });
})));
router.post('/invite/:token/accept', loginLimiter, handle(codeErr(async (req, res) => {
  const su = await live(req.params.token);
  if (!su) throw bad(EXPIRED);
  const b = req.body ?? {};
  if (!(b.accept_terms === true || b.consent_terms === true) || !b.consent_comm) throw fieldErr('consent_terms', 'Please accept the Terms of Use, Privacy Policy and communication consent');
  const problem = passwordProblem(String(b.password ?? ''), 'portal', [su.email, su.name]);
  if (problem) throw fieldErr('password', problem);
  const o = await checkCode(b.otp_id, b.code, 'invite');
  if (String(o.accountId) !== String(su._id)) throw bad('Please start again.');
  su.set({ password: String(b.password), status: 'Active', isActive: true, emailVerifiedAt: su.emailVerifiedAt ?? new Date(), inviteTokenHash: undefined, inviteExpiresAt: undefined });
  await su.save();
  if (su.studentId) await Student.updateOne({ _id: su.studentId }, { portal_status: 'Active' });
  for (const [type, value] of [['terms', true], ['privacy', true], ['communication', true], ['marketing', !!b.consent_marketing]] as const)
    await record(req, { suId: su._id, leadId: su.leadId, type, value, method: 'invite_checkbox' });
  const c = await loadCtx(su);
  await notifyStaff(c, 'portal', `${displayName(c)} activated the student portal account`);
  if (su.studentId) await studentTimeline(su.studentId, null, 'profile', 'Student activated the portal account (invite)');
  await portalAudit(Object.assign(req, { su }), 'Create', 'StudentUser', su._id, 'Invite activated');
  const token = jwt.sign({ id: String(su._id), role: su.role, name: su.name }, env.jwtSecret, { expiresIn: '12h' as SignOptions['expiresIn'] });
  res.json({ token, user: su, studentId: su.studentId ? String(su.studentId) : null });
})));

export default router;
