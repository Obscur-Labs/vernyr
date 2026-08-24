import { Router, Response } from 'express';
import User, { USERNAME_RE } from '../models/User';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { logActivity } from '../utils/activityLog';

const router = Router();

// GET /api/users — list all (admin+)
router.get('/', authenticate, authorize('admin'), async (_req, res: Response) => {
  try {
    const users = await User.find({ isActive: true }).select('-password').sort('name');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// GET /api/users/counsellors — list counsellors only
router.get('/counsellors', authenticate, async (_req, res: Response) => {
  try {
    const counsellors = await User.find({ role: 'counsellor', isActive: true }).select('name username email role avatar');
    res.json(counsellors);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// POST /api/users — create user (admin+)
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.create(req.body);
    logActivity(req, {
      action: 'create', entity: 'User', entityId: user._id,
      label: `Created ${user.username ?? user.email} (${user.role})`,
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// POST /api/users/student-account — create a portal account for a student (admin+)
router.post('/student-account', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  const { studentId, name, username, email, password } = req.body;
  if (!studentId || !username || !password) {
    res.status(400).json({ message: 'studentId, username, and password are required' });
    return;
  }
  if (!USERNAME_RE.test(String(username).trim().toLowerCase())) {
    res.status(400).json({ message: 'Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen' });
    return;
  }
  try {
    if (await User.findOne({ username: String(username).trim().toLowerCase() })) {
      res.status(400).json({ message: 'That username is already taken' }); return;
    }
    if (email && await User.findOne({ email })) {
      res.status(400).json({ message: 'An account with this email already exists' }); return;
    }
    const user = await User.create({ name, username, email, password, role: 'student', studentId });
    logActivity(req, {
      action: 'create', entity: 'User', entityId: user._id,
      label: `Issued a portal login for ${user.name} (${user.username})`,
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// PUT /api/users/:id — update user
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { password, ...updateData } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    logActivity(req, {
      action: 'update', entity: 'User', entityId: user._id,
      label: `Updated ${user.username ?? user.email}`,
      changes: Object.keys(updateData),
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
