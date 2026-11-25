import { Router, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import User, { USERNAME_RE, usesEmailLogin, type IUser, type UserRole } from '../models/User';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import AuthCode from '../models/AuthCode';
import { CodeError, cancelCodes, checkCode, issueCode, maskEmail, resendCode, useCode } from '../services/authCodes';
import { passwordProblem } from '../services/passwords';
import Student from '../models/Student';
import University from '../models/University';
import { authenticate, can, may, AuthRequest } from '../middleware/auth';
import { invalidateUser, loadPrincipal } from '../services/access';
import {
  credentialConflict,
  findAccountByCredential,
  findAccountDocById,
} from '../services/accounts';
import { logActivity } from '../utils/activityLog';
import { clientError } from '../utils/mongoErrors';
import { serverError } from '../utils/httpError';
import { loginLimiter, signupLimiter, lookupLimiter } from '../middleware/rateLimit';

const router = Router();

/** `remember` = 7 days (JWT_EXPIRES_IN), otherwise 12 hours: the client's session lengths. */
const signToken = (user: { _id: unknown; role: string; name: string }, remember = true) =>
  jwt.sign(
    { id: user._id, role: user.role, name: user.name },
    env.jwtSecret,
    { expiresIn: (remember ? env.jwtExpiresIn : '12h') as SignOptions['expiresIn'] },
  );

const studentIdOf = (doc: unknown) => {
  const id = (doc as { studentId?: unknown }).studentId;
  return id ? String(id) : null;
};

type AccountDoc = IUser | IPortalAccount;
type App = 'crm' | 'portal' | 'partner';
const appOf = (v: unknown): App | null => (v === 'crm' || v === 'portal' || v === 'partner' ? v : null);

const GENERIC = 'Invalid username or password';
const LOCK_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const LOCKED = `Your account is locked because of too many wrong attempts. Please try again after ${LOCK_MINUTES} minutes.`;

/** Each app signs in only its own kind of account, with the same answer either way so nothing leaks. */
function belongsTo(app: App | null, found: NonNullable<Awaited<ReturnType<typeof findAccountByCredential>>>, byEmail: boolean) {
  const role = found.doc.role as string;
  if (app === 'crm') return found.kind === 'staff' && (!byEmail || usesEmailLogin(role as UserRole));
  if (app === 'portal') return found.kind === 'portal' && role === 'student';
  if (app === 'partner') return found.kind === 'portal' && role === 'university';
  return true; // older clients that do not say which app they are
}

async function signedIn(req: AuthRequest, res: Response, user: AccountDoc, remember: boolean) {
  const token = signToken(user, remember);
  logActivity(req, {
    action: 'login', entity: 'Auth', entityId: user._id,
    actorId: user._id.toString(), actorName: user.name, actorRole: user.role,
    label: `Signed in as ${user.username ?? user.email}`,
  });
  const principal = await loadPrincipal(user._id.toString());
  res.json({
    token,
    user,
    studentId: studentIdOf(user),
    access: principal && {
      presetKey: principal.presetKey,
      presetName: principal.presetName,
      fullAccess: principal.fullAccess,
      permissions: principal.permissions,
    },
  });
}

const codeFailed = (res: Response, err: unknown) => {
  if (err instanceof CodeError) { res.status(err.status).json({ message: err.message }); return true; }
  return false;
};

// POST /api/auth/login: staff (crm), students (portal) and universities (partner)
router.post('/login', loginLimiter, [
  body('identifier').optional().notEmpty().trim(),
  body('password').notEmpty(),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ message: 'Please enter your username and password' }); return; }

  const { identifier, username, email, password } = req.body;
  const credential = String(identifier || username || email || '').trim();
  if (!credential) { res.status(400).json({ message: 'Please enter your username and password' }); return; }
  if (credential.length > 120 || String(password).length > 200) { res.status(401).json({ message: GENERIC }); return; }
  const app = appOf(req.body.app);
  const remember = req.body.remember !== false;

  try {
    const found = await findAccountByCredential(credential);
    const fail = (message = GENERIC, status = 401) => {
      logActivity(req, { action: 'login_failed', entity: 'Auth', actorName: credential, label: `Failed sign-in for ${credential}` });
      res.status(status).json({ message });
    };
    if (req.body.hp) return fail(); // honeypot: a hidden field only bots fill in
    if (!found || !belongsTo(app, found, credential.includes('@'))) return fail();
    const user = found.doc;

    if (user.lockedUntil && user.lockedUntil > new Date()) return fail(LOCKED, 423);
    if (!(await user.comparePassword(String(password)))) {
      user.failedLogins = (user.failedLogins || 0) + 1;
      if (user.failedLogins >= LOCK_ATTEMPTS) {
        user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
        user.failedLogins = 0;
        await user.save();
        return fail(LOCKED, 423);
      }
      await user.save();
      return fail();
    }
    if (user.isActive === false) return fail('Your account is inactive. Please contact your Admin.', 403);

    user.failedLogins = 0;
    user.lockedUntil = undefined;
    await user.save();

    // First login with an unconfirmed email (students, email-login staff): confirm it once with a 6-digit code (client rule)
    const confirmsEmail = found.kind === 'portal' ? user.role === 'student' : usesEmailLogin(user.role as UserRole);
    if (confirmsEmail && user.email && !user.emailVerifiedAt) {
      const otpId = await issueCode({ accountId: user._id, email: user.email, purpose: 'login', app: app ?? 'crm', remember });
      res.json({ otpRequired: true, otpId, masked: maskEmail(user.email) });
      return;
    }
    await signedIn(req, res, user, remember);
  } catch (err) {
    if (!codeFailed(res, err)) serverError(res, err);
  }
});

// POST /api/auth/otp { otpId, code }: second step of a first login
router.post('/otp', loginLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const row = await checkCode(req.body.otpId, req.body.code, 'login');
    const found = await findAccountDocById(row.accountId.toString());
    if (!found || found.doc.isActive === false) { res.status(400).json({ message: 'Please log in again.' }); return; }
    found.doc.emailVerifiedAt = found.doc.emailVerifiedAt ?? new Date();
    await found.doc.save();
    invalidateUser(found.doc._id.toString());
    await signedIn(req, res, found.doc, row.remember);
  } catch (err) {
    if (!codeFailed(res, err)) serverError(res, err);
  }
});

// POST /api/auth/otp/resend { otpId, app }
router.post('/otp/resend', loginLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const row = await AuthCode.findById(String(req.body.otpId ?? '')).lean().catch(() => null);
    const found = row && (await findAccountDocById(row.accountId.toString()));
    if (!found || !found.doc.email) { res.status(400).json({ message: 'Please start again.' }); return; }
    await resendCode(req.body.otpId, found.doc.email, appOf(req.body.app) ?? 'crm');
    res.json({ ok: true });
  } catch (err) {
    if (!codeFailed(res, err)) serverError(res, err);
  }
});

// POST /api/auth/forgot { identifier, app }: a 6-digit code by email. Same answer whether or not the account exists.
router.post('/forgot', signupLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  const message = 'If this account is registered, we have emailed a 6-digit code. It is valid for 10 minutes.';
  const credential = String(req.body.identifier ?? req.body.email ?? '').trim();
  const app = appOf(req.body.app) ?? 'crm';
  try {
    const found = credential && credential.length <= 120 ? await findAccountByCredential(credential) : null;
    // the code goes to the email on file; staff without one ask their Admin to set a new password
    const ok = found && belongsTo(app, found, credential.includes('@')) && found.doc.email;
    const otpId = ok
      ? await issueCode({ accountId: found.doc._id, email: found.doc.email!, purpose: 'reset', app })
      : new mongoose.Types.ObjectId().toString();
    res.json({ otpId, message });
  } catch (err) {
    if (err instanceof CodeError && err.status === 429) { res.status(429).json({ message: err.message }); return; }
    if (err instanceof CodeError) { res.json({ otpId: new mongoose.Types.ObjectId().toString(), message }); return; }
    serverError(res, err);
  }
});

// POST /api/auth/reset { otpId, code, password }
router.post('/reset', loginLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  const password = String(req.body.password ?? '');
  try {
    // the emailed code is checked first, so the password rules cannot be used to probe accounts
    const row = await checkCode(req.body.otpId, req.body.code, 'reset', true);
    const found = await findAccountDocById(row.accountId.toString());
    if (!found) { res.status(400).json({ message: 'The code has expired. Please request a new one.' }); return; }
    const user = found.doc;
    const rule = passwordProblem(password, found.kind, [user.username, user.email, user.name]);
    if (rule) { res.status(400).json({ message: rule }); return; }
    if (await user.comparePassword(password)) {
      res.status(400).json({ message: 'New password cannot be the same as your current password' }); return;
    }
    if (!(await useCode(row))) { res.status(400).json({ message: 'The code has expired. Please request a new one.' }); return; }

    user.password = password;
    user.emailVerifiedAt = user.emailVerifiedAt ?? new Date(); // the code reached this email
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    user.passwordChangedAt = new Date(); // signs out every other session
    await user.save();
    await cancelCodes(user._id, 'reset');
    invalidateUser(user._id.toString());
    logActivity(req, { action: 'password_reset', entity: 'User', entityId: user._id, actorId: user._id.toString(), actorName: user.name, label: 'Reset their password with an email code' });
    res.json({ message: 'Your password has been changed. Please log in.' });
  } catch (err) {
    if (!codeFailed(res, err)) serverError(res, err);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const found = await findAccountDocById(req.user!.id);
    if (!found) { res.status(404).json({ message: 'User not found' }); return; }

    const p = req.principal!;
    // `toObject()` skips the toJSON transform that strips the hash, and the
    // document was loaded with `+password`. Serialise through toJSON instead.
    res.json({
      ...(found.doc.toJSON() as Record<string, unknown>),
      studentId: studentIdOf(found.doc),
      access: {
        presetKey: p.presetKey,
        presetName: p.presetName,
        fullAccess: p.fullAccess,
        permissions: p.permissions,
      },
    });
  } catch (err) {
    serverError(res, err);
  }
});

/** POST /api/auth/register — create a staff account for someone else. */
router.post('/register', authenticate, can('members', 'create'), [
  body('name').notEmpty().trim(),
  body('username').optional().trim().toLowerCase().matches(USERNAME_RE),
  body('email').optional().isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('role').optional().isIn(['admin', 'counsellor']).withMessage('A member is an admin or a counsellor'),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

  const { name, username, email, password, role } = req.body;
  if (role === 'admin' && !may(req, 'access', 'update')) {
    res.status(403).json({ message: 'Granting the admin seat needs Roles & access' }); return;
  }
  try {
    const conflict = await credentialConflict({ username, email });
    if (conflict) { res.status(409).json({ message: conflict }); return; }

    const user = await User.create({ name, username, email, password, role: role || 'counsellor' });
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    serverError(res, err);
  }
});

/** The client's default study countries, used until the catalogue has universities. */
const DEFAULT_COUNTRIES = ['France', 'Italy', 'Spain', 'Netherlands', 'Finland', 'Sweden', 'Ireland', 'Germany', 'China'];
/** Intakes: Jan, Feb and Sep for this year and the next three (client rule), from the current month on. */
function intakeOptions() {
  const now = new Date(); const out: string[] = [];
  for (let y = now.getFullYear(); y <= now.getFullYear() + 3; y++) {
    for (const [m, label] of [[1, 'Jan'], [2, 'Feb'], [9, 'Sep']] as const) {
      if (y > now.getFullYear() || m >= now.getMonth() + 1) out.push(`${label} ${y}`);
    }
  }
  return out;
}

// GET /api/auth/config: what the student sign-up form offers
router.get('/config', lookupLimiter, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const fromCatalogue = (await University.distinct('country')).filter(Boolean).sort();
    res.json({ signup: true, countries: fromCatalogue.length ? fromCatalogue : DEFAULT_COUNTRIES, intakes: intakeOptions() });
  } catch (err) {
    serverError(res, err);
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 100) => String(v ?? '').trim().slice(0, max);

// POST /api/auth/signup: the student creates an account, then confirms the email with a 6-digit code (POST /auth/otp)
router.post('/signup', signupLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body ?? {};
  if (b.hp) { res.status(400).json({ message: 'Please check the form.' }); return; }
  const first = str(b.first_name, 50), last = str(b.last_name, 50);
  const email = str(b.email, 120).toLowerCase();
  const cc = /^\+\d{1,4}$/.test(str(b.country_code, 5)) ? str(b.country_code, 5) : '+91';
  const phoneDigits = str(b.phone, 20).replace(/\D/g, '');
  const password = String(b.password ?? '');
  const age = ['adult', 'minor', 'child'].includes(b.age_group) ? b.age_group : 'adult';

  const errors: Record<string, string> = {};
  if (!first) errors.first_name = 'Enter your first name';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email';
  if (phoneDigits.length < 6 || phoneDigits.length > 15) errors.phone = 'Enter a valid mobile number';
  const pwProblem = passwordProblem(password, 'portal', [first, last, email]);
  if (pwProblem) errors.password = pwProblem;
  if (age === 'minor') {
    if (!str(b.guardian_name)) errors.guardian_name = 'Enter the parent / guardian name';
    if (!EMAIL_RE.test(str(b.guardian_email, 120))) errors.guardian_email = 'Enter the parent / guardian email';
    if (!b.guardian_consent) errors.guardian_consent = 'Your parent / guardian must agree';
  }
  if (!b.consent_terms) errors.consent_terms = 'Required';
  if (!b.consent_comm) errors.consent_comm = 'Required';
  if (age === 'child') { res.status(400).json({ message: 'Students under 13 cannot create an account. Please ask your parent to contact La Europa.' }); return; }
  if (Object.keys(errors).length) { res.status(400).json({ message: 'Please check the highlighted fields.', errors }); return; }

  try {
    const conflict = await credentialConflict({ email });
    if (conflict) { res.status(409).json({ message: 'An account with this email already exists. Please log in or use Forgot password.', errors: { email: 'Already registered' } }); return; }
    const phone = `${cc}${phoneDigits}`;
    if (await PortalAccount.exists({ phone })) { res.status(409).json({ message: 'This mobile number is already registered. Please log in.', errors: { phone: 'Already registered' } }); return; }

    const name = [first, last].filter(Boolean).join(' ');
    const student = await Student.create({
      personal: { name, email, phone },
      stage: 'inquiry',
      preferences: { countries: b.country ? [str(b.country, 60)] : [], intake: str(b.intake, 20) || undefined },
      signup: {
        source: b.walkin ? 'walkin' : 'portal',
        isWhatsapp: !!b.is_whatsapp,
        ageGroup: age,
        guardian: age === 'minor' ? { name: str(b.guardian_name), relation: str(b.guardian_relation, 30), email: str(b.guardian_email, 120).toLowerCase(), consent: true } : undefined,
        consents: { terms: true, comm: true, marketing: !!b.consent_marketing, at: new Date(), ip: req.ip },
        referralCode: str(b.referral_code, 12) || undefined,
        promoCode: str(b.promo_code, 20) || undefined,
      },
    });
    const user = await PortalAccount.create({ name, email, phone, password, role: 'student', studentId: student._id, presetKey: 'student', isActive: true });
    student.userId = user._id;
    await student.save();
    logActivity(req, {
      action: 'register', entity: 'Student', entityId: student._id,
      actorId: user._id.toString(), actorName: user.name, actorRole: user.role,
      label: `Signed up on the portal as ${email}`,
    });
    const otpId = await issueCode({ accountId: user._id, email, purpose: 'login', app: 'portal', remember: true });
    res.status(201).json({ otpId, masked: maskEmail(email) });
  } catch (err) {
    if (codeFailed(res, err)) return;
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    serverError(res, err, 'Server error during sign-up');
  }
});

// GET /api/auth/username-available?username=…
router.get('/username-available', lookupLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  const username = String(req.query.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) { res.json({ available: false, reason: 'invalid' }); return; }
  try {
    res.json({ available: !(await credentialConflict({ username })) });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, loginLimiter, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

  const { currentPassword, newPassword } = req.body;
  try {
    const found = await findAccountDocById(req.user!.id);
    if (!found) { res.status(404).json({ message: 'User not found' }); return; }

    const { doc: user } = found;
    if (!(await user.comparePassword(currentPassword))) {
      res.status(401).json({ message: 'Current password is incorrect' }); return;
    }
    user.password = newPassword;
    await user.save();
    invalidateUser(user._id.toString());

    logActivity(req, {
      action: 'password_reset', entity: 'User', entityId: user._id,
      label: 'Changed their own password',
    });
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
