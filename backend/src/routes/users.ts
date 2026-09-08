import { Router, Response } from 'express';
import User, { STAFF_ROLES, USERNAME_RE, type StaffRole } from '../models/User';
import { authenticate, can, may, AuthRequest } from '../middleware/auth';
import { sanitizePermissions } from '../config/modules';
import { DEFAULT_PRESET_FOR_ROLE } from '../config/presets';
import { listPresets, invalidateUser, invalidateAll } from '../services/access';
import { logActivity } from '../utils/activityLog';
import { clientError } from '../utils/mongoErrors';
import PortalAccount from '../models/PortalAccount';
import { credentialConflict } from '../services/accounts';
import { serverError } from '../utils/httpError';

const router = Router();

/** Members are seats in the office. */
const STAFF_QUERY = { role: { $ne: 'student' } } as const;

/** Attaches the preset each account resolves to, including the role fallback. */
async function withPresets(users: Record<string, unknown>[]) {
  const presets = await listPresets();
  const byKey = new Map(presets.map((p) => [p.key, p]));

  return users.map((u) => {
    const key = (u.presetKey as string) || DEFAULT_PRESET_FOR_ROLE[u.role as string] || '';
    const preset = byKey.get(key);
    return {
      ...u,
      presetKey: preset?.key ?? key,
      presetName: preset?.name ?? '—',
      // True when the account has never been saved since the access system
      // arrived, so the UI can say the seat is inherited rather than chosen.
      presetInherited: !u.presetKey,
      hasOverrides: Object.keys(sanitizePermissions(u.permissions)).length > 0,
    };
  });
}

// GET /api/users — staff and partner accounts
router.get('/', authenticate, can('members', 'read'), async (_req: AuthRequest, res: Response) => {
  try {
    const users = await User.find({ ...STAFF_QUERY, isActive: true })
      .select('-password')
      .sort('name')
      .lean();
    res.json(await withPresets(users as Record<string, unknown>[]));
  } catch (err) {
    serverError(res, err);
  }
});

/** GET /api/users/counsellors — the assignment picker. */
router.get('/counsellors', authenticate, can('students', 'read'), async (_req, res: Response) => {
  try {
    const counsellors = await User.find({ role: 'counsellor', isActive: true })
      .select('name username email role avatar');
    res.json(counsellors);
  } catch (err) {
    serverError(res, err);
  }
});

/** Fields that decide what an account can reach — never settable by its holder. */
const PRIVILEGED_FIELDS = ['role', 'isActive', 'presetKey', 'permissions'] as const;

/**
 * `members.update` let its holder mint an admin, including out of their own
 * account. A seat is only handed out by someone who already holds the access
 * module — the same gate that guards the preset matrix itself.
 */
async function guardSeatEscalation(
  req: AuthRequest,
  res: Response,
  role?: string,
  presetKey?: unknown,
): Promise<boolean> {
  const wantsAdmin = role === 'admin' || String(presetKey ?? '') === 'admin';
  if (!wantsAdmin || may(req, 'access', 'update')) return true;
  res.status(403).json({ message: 'Granting the admin seat needs Roles & access' });
  return false;
}

// POST /api/users — create a member
router.post('/', authenticate, can('members', 'create'), async (req: AuthRequest, res: Response) => {
  const { name, username, email, password, phone, avatar, role, presetKey, permissions } = req.body ?? {};

  // Spreading the body put `role`, `isActive` and any future privileged field
  // under the caller's control. Members are staff seats, and only the two.
  if (role !== undefined && !STAFF_ROLES.includes(role as StaffRole)) {
    res.status(400).json({ message: 'A member is an admin or a counsellor' }); return;
  }
  if (String(password ?? '').length < 6) {
    res.status(400).json({ message: 'Password must be at least 6 characters' }); return;
  }
  if (!(await guardSeatEscalation(req, res, role as string | undefined, presetKey))) return;

  try {
    // Usernames and emails are unique across both collections; a Mongo index
    // only covers its own, so this path has to ask.
    const conflict = await credentialConflict({ username, email });
    if (conflict) { res.status(409).json({ message: conflict }); return; }

    const user = await User.create({
      name, username, email, password, phone, avatar,
      role: role || 'counsellor',
      presetKey,
      ...(permissions ? { permissions: sanitizePermissions(permissions) } : {}),
    });
    logActivity(req, {
      action: 'create', entity: 'User', entityId: user._id,
      label: `Created ${user.username ?? user.email} (${user.presetKey ?? user.role})`,
    });
    res.status(201).json(user);
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    serverError(res, err);
  }
});

// POST /api/users/student-account — issue a portal login for a student
router.post('/student-account', authenticate, can('portal_accounts', 'create'), async (req: AuthRequest, res: Response) => {
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
    const conflict = await credentialConflict({ username, email });
    if (conflict) { res.status(409).json({ message: conflict }); return; }

    const user = await PortalAccount.create({
      name, username, email, password, role: 'student', studentId, presetKey: 'student',
    });
    logActivity(req, {
      action: 'create', entity: 'User', entityId: user._id,
      label: `Issued a portal login for ${user.name} (${user.username})`,
    });
    res.status(201).json(user);
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    serverError(res, err);
  }
});

// PUT /api/users/:id — update yourself, or anyone if you may manage members
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const manages = may(req, 'members', 'update');
  const isSelf = req.user!.id === req.params.id;

  if (!manages && !isSelf) {
    res.status(403).json({ message: 'You can only update your own account' });
    return;
  }

  try {
    const { password, ...updateData } = req.body;
    void password;   // password has its own endpoint — /api/auth/change-password

    // Dropped rather than rejected: the profile form posts the whole record
    // back, so a self-update legitimately carries the caller's current seat.
    if (!manages) for (const field of PRIVILEGED_FIELDS) delete updateData[field];

    if (updateData.role !== undefined && !STAFF_ROLES.includes(updateData.role as StaffRole)) {
      res.status(400).json({ message: 'A member is an admin or a counsellor' }); return;
    }
    if (!(await guardSeatEscalation(req, res, updateData.role as string | undefined, updateData.presetKey))) return;

    // Credentials are unique across both collections. Without this a staff
    // member could take a student's username onto their own account, and the
    // student's login would then resolve to someone else's record.
    const conflict = await credentialConflict(
      { username: updateData.username, email: updateData.email },
      req.params.id,
    );
    if (conflict) { res.status(409).json({ message: conflict }); return; }

    if ('permissions' in updateData) {
      updateData.permissions = sanitizePermissions(updateData.permissions);
    }

    // Clearing a credential has to remove the field, not store ''.
    const unset: Record<string, ''> = {};
    for (const field of ['username', 'email'] as const) {
      if (field in updateData && !String(updateData[field] ?? '').trim()) {
        delete updateData[field];
        unset[field] = '';
      }
    }
    // An empty override map is "no overrides", which is an absent field.
    if (updateData.permissions && Object.keys(updateData.permissions).length === 0) {
      delete updateData.permissions;
      unset.permissions = '';
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      Object.keys(unset).length ? { $set: updateData, $unset: unset } : updateData,
      { new: true, runValidators: true },
    ).select('-password');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    invalidateUser(req.params.id);

    logActivity(req, {
      action: 'update', entity: 'User', entityId: user._id,
      label: `Updated ${user.username ?? user.email}`,
      changes: [...Object.keys(updateData), ...Object.keys(unset)],
    });
    res.json((await withPresets([user.toObject() as unknown as Record<string, unknown>]))[0]);
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    serverError(res, err);
  }
});

/** DELETE /api/users/:id — deactivate. */
router.delete('/:id', authenticate, can('members', 'delete'), async (req: AuthRequest, res: Response) => {
  if (req.user!.id === req.params.id) {
    res.status(400).json({ message: 'You cannot deactivate your own account' });
    return;
  }
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true }).select('-password');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    invalidateUser(req.params.id);
    invalidateAll();

    logActivity(req, {
      action: 'delete', entity: 'User', entityId: user._id,
      label: `Deactivated ${user.username ?? user.email}`,
    });
    res.json({ message: `${user.name} deactivated` });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
