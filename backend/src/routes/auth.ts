import { Router, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { body, validationResult } from 'express-validator';
import User, { USERNAME_RE } from '../models/User';
import PortalAccount from '../models/PortalAccount';
import Student from '../models/Student';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { invalidateUser, loadPrincipal } from '../services/access';
import {
  credentialConflict,
  findAccountByCredential,
  findAccountDocById,
} from '../services/accounts';
import { logActivity } from '../utils/activityLog';
import { clientError } from '../utils/mongoErrors';

const router = Router();

const signToken = (user: { _id: unknown; role: string; name: string }) =>
  jwt.sign(
    { id: user._id, role: user.role, name: user.name },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'] },
  );

const studentIdOf = (doc: unknown) => {
  const id = (doc as { studentId?: unknown }).studentId;
  return id ? String(id) : null;
};

// POST /api/auth/login — one form for staff and portal accounts alike
router.post('/login', [
  body('identifier').optional().notEmpty().trim(),
  body('password').notEmpty(),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

  const { identifier, username, email, password } = req.body;
  const credential = identifier || username || email;
  if (!credential) { res.status(400).json({ message: 'Username or email is required' }); return; }

  try {
    const found = await findAccountByCredential(String(credential));
    if (!found || !(await found.doc.comparePassword(password))) {
      logActivity(req, {
        action: 'login_failed', entity: 'Auth', actorName: String(credential),
        label: `Failed sign-in for ${credential}`,
      });
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const { doc: user } = found;
    const token = signToken(user);
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
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const found = await findAccountDocById(req.user!.id);
    if (!found) { res.status(404).json({ message: 'User not found' }); return; }

    const p = req.principal!;
    res.json({
      ...found.doc.toObject(),
      studentId: studentIdOf(found.doc),
      access: {
        presetKey: p.presetKey,
        presetName: p.presetName,
        fullAccess: p.fullAccess,
        permissions: p.permissions,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** POST /api/auth/register — create a staff account for someone else. */
router.post('/register', authenticate, can('members', 'create'), [
  body('name').notEmpty().trim(),
  body('username').optional().trim().toLowerCase().matches(USERNAME_RE),
  body('email').optional().isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('role').optional(),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

  const { name, username, email, password, role } = req.body;
  try {
    const conflict = await credentialConflict({ username, email });
    if (conflict) { res.status(409).json({ message: conflict }); return; }

    const user = await User.create({ name, username, email, password, role: role || 'counsellor' });
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// POST /api/auth/register-student — self-registration on the portal
router.post('/register-student', [
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('username').trim().toLowerCase().matches(USERNAME_RE)
    .withMessage('Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen'),
  body('phone').notEmpty().trim().withMessage('Phone number is required'),
  body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail().withMessage('Enter a valid email address'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

  const { name, username, email, phone, password } = req.body;
  try {
    const conflict = await credentialConflict({ username, email });
    if (conflict) { res.status(409).json({ message: conflict }); return; }

    const student = await Student.create({
      personal: { name, email, phone },
      stage: 'inquiry',
    });

    const user = await PortalAccount.create({
      name, username, email, password,
      role: 'student',
      studentId: student._id,
      presetKey: 'student',
      isActive: true,
    });

    student.userId = user._id;
    await student.save();

    logActivity(req, {
      action: 'register', entity: 'Student', entityId: student._id,
      actorId: user._id.toString(), actorName: user.name, actorRole: user.role,
      label: `Self-registered as ${user.username}`,
    });

    res.status(201).json({ token: signToken(user), user, studentId: student._id.toString() });
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    res.status(500).json({ message: 'Server error during registration', error: err });
  }
});

// GET /api/auth/username-available?username=…
router.get('/username-available', async (req: AuthRequest, res: Response): Promise<void> => {
  const username = String(req.query.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) { res.json({ available: false, reason: 'invalid' }); return; }
  try {
    res.json({ available: !(await credentialConflict({ username })) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, [
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
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
