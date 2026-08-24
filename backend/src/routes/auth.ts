import { Router, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { body, validationResult } from 'express-validator';
import User, { USERNAME_RE } from '../models/User';
import Student from '../models/Student';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logActivity } from '../utils/activityLog';

const router = Router();

/**
 * Staff and students sign in with a username; admins sign in with an email
 * address. One field carries both — an `@` decides which column to look up.
 */
function credentialQuery(identifier: string) {
  const value = identifier.trim().toLowerCase();
  return value.includes('@') ? { email: value } : { username: value };
}

// POST /api/auth/login
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
    const user = await User.findOne({ ...credentialQuery(credential), isActive: true }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      logActivity(req, {
        action: 'login_failed', entity: 'Auth', actorName: String(credential),
        label: `Failed sign-in for ${credential}`,
      });
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'] }
    );
    logActivity(req, {
      action: 'login', entity: 'Auth', entityId: user._id,
      actorId: user._id.toString(), actorName: user.name, actorRole: user.role,
      label: `Signed in as ${user.username ?? user.email}`,
    });
    res.json({ token, user, studentId: user.studentId?.toString() ?? null });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// POST /api/auth/register (admin seeding only)
router.post('/register', [
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
    if (username && await User.findOne({ username })) {
      res.status(400).json({ message: 'Username already taken' }); return;
    }
    if (email && await User.findOne({ email })) {
      res.status(400).json({ message: 'Email already in use' }); return;
    }
    const user = await User.create({ name, username, email, password, role: role || 'counsellor' });
    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      env.jwtSecret,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// POST /api/auth/register-student (Student self-registration)
router.post('/register-student', [
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('username').trim().toLowerCase().matches(USERNAME_RE)
    .withMessage('Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen'),
  body('phone').notEmpty().trim().withMessage('Phone number is required'),
  body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail().withMessage('Enter a valid email address'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  const { name, username, email, phone, password } = req.body;
  try {
    if (await User.findOne({ username })) {
      res.status(400).json({ message: 'That username is already taken' });
      return;
    }
    if (email && await User.findOne({ email })) {
      res.status(400).json({ message: 'An account with this email already exists' });
      return;
    }

    // 1. Create student record
    const student = await Student.create({
      personal: {
        name,
        email,
        phone,
      },
      stage: 'inquiry',
    });

    // 2. Create user record
    const user = await User.create({
      name,
      username,
      email,
      password,
      role: 'student',
      studentId: student._id,
      isActive: true,
    });

    // 3. Link user ID back to student
    student.userId = user._id;
    await student.save();

    // 4. Generate JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'] }
    );

    logActivity(req, {
      action: 'register', entity: 'Student', entityId: student._id,
      actorId: user._id.toString(), actorName: user.name, actorRole: user.role,
      label: `Self-registered as ${user.username}`,
    });

    // 5. Respond
    res.status(201).json({
      token,
      user,
      studentId: student._id.toString(),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error during registration', error: err });
  }
});

// GET /api/auth/username-available?username=…
router.get('/username-available', async (req: AuthRequest, res: Response): Promise<void> => {
  const username = String(req.query.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) { res.json({ available: false, reason: 'invalid' }); return; }
  try {
    const taken = await User.exists({ username });
    res.json({ available: !taken });
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
    const user = await User.findById(req.user!.id).select('+password');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    const valid = await user.comparePassword(currentPassword);
    if (!valid) { res.status(401).json({ message: 'Current password is incorrect' }); return; }
    user.password = newPassword;
    await user.save();
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
