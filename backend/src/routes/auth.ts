import { Router, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { body, validationResult } from 'express-validator';
import User from '../models/User';
import Student from '../models/Student';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email, isActive: true }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'] }
    );
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

// POST /api/auth/register (super_admin seeding only)
router.post('/register', [
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('role').optional(),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

  const { name, email, password, role } = req.body;
  try {
    const exists = await User.findOne({ email });
    if (exists) { res.status(400).json({ message: 'Email already in use' }); return; }
    const user = await User.create({ name, email, password, role: role || 'support' });
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
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').notEmpty().trim().withMessage('Phone number is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
], async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  const { name, email, phone, password } = req.body;
  try {
    const exists = await User.findOne({ email });
    if (exists) {
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
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
