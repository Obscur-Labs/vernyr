import { Router, Response } from 'express';
import User, { USERNAME_RE } from '../models/User';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { logActivity } from '../utils/activityLog';
import { clientError } from '../utils/mongoErrors';

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
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
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
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** Fields only an admin may set — a user must not be able to promote themselves. */
const ADMIN_ONLY_FIELDS = ['role', 'isActive'] as const;

// PUT /api/users/:id — update yourself, or anyone if you are an admin
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'admin';
  const isSelf = req.user!.id === req.params.id;

  if (!isAdmin && !isSelf) {
    res.status(403).json({ message: 'You can only update your own account' });
    return;
  }

  try {
    const { password, ...updateData } = req.body;
    void password;   // password has its own endpoint — /api/auth/change-password

    // Dropped rather than rejected: the profile form posts the whole record
    // back, so a self-update legitimately carries the caller's current role.
    if (!isAdmin) for (const field of ADMIN_ONLY_FIELDS) delete updateData[field];

    // Clearing a credential has to remove the field, not store ''. The unique
    // index treats an empty string as a real value, so one blank would block
    // every later account that leaves the same field empty.
    const unset: Record<string, ''> = {};
    for (const field of ['username', 'email'] as const) {
      if (field in updateData && !String(updateData[field] ?? '').trim()) {
        delete updateData[field];
        unset[field] = '';
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      Object.keys(unset).length ? { $set: updateData, $unset: unset } : updateData,
      { new: true, runValidators: true },
    ).select('-password');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    logActivity(req, {
      action: 'update', entity: 'User', entityId: user._id,
      label: `Updated ${user.username ?? user.email}`,
      changes: [...Object.keys(updateData), ...Object.keys(unset)],
    });
    res.json(user);
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
