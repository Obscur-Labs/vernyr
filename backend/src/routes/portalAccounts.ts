import { Router, Response } from 'express';
import mongoose from 'mongoose';
import PortalAccount, { PORTAL_ROLES, type PortalRole } from '../models/PortalAccount';
import Student from '../models/Student';
import { USERNAME_RE } from '../models/accountFields';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { sanitizePermissions } from '../config/modules';
import { DEFAULT_PRESET_FOR_ROLE, isLocked } from '../config/presets';
import { listPresets, invalidateUser } from '../services/access';
import { credentialConflict } from '../services/accounts';
import { logActivity } from '../utils/activityLog';
import { clientError } from '../utils/mongoErrors';
import { serverError } from '../utils/httpError';
import { scalar } from '../utils/query';

const router = Router();

/** Attaches the preset each account resolves to, including the role fallback. */
async function withPresets(rows: Record<string, unknown>[]) {
  const byKey = new Map((await listPresets()).map((p) => [p.key, p]));
  return rows.map((r) => {
    const key = (r.presetKey as string) || DEFAULT_PRESET_FOR_ROLE[r.role as string] || '';
    const preset = byKey.get(key);
    return {
      ...r,
      presetKey: preset?.key ?? key,
      presetName: preset?.name ?? '—',
      presetInherited: !r.presetKey,
      hasOverrides: Object.keys(sanitizePermissions(r.permissions)).length > 0,
    };
  });
}

// GET /api/portal-accounts?role=student&q=…
router.get('/', authenticate, can('portal_accounts', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    const role = scalar(req.query.role) ?? '';
    if (PORTAL_ROLES.includes(role as PortalRole)) filter.role = role;
    if (scalar(req.query.active) !== 'all') filter.isActive = true;

    const q = (scalar(req.query.q) ?? '').trim();
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { username: rx }, { email: rx }, { universityName: rx }];
    }

    const rows = await PortalAccount.find(filter)
      .select('-password')
      .populate('studentId', 'personal stage')
      .sort('name')
      .lean();

    res.json(await withPresets(rows as Record<string, unknown>[]));
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/portal-accounts — issue a login
router.post('/', authenticate, can('portal_accounts', 'create'), async (req: AuthRequest, res: Response) => {
  const { name, username, email, password, role, studentId, universityName, presetKey, permissions } = req.body ?? {};

  if (!PORTAL_ROLES.includes(role)) {
    res.status(400).json({ message: 'Pick student or university' }); return;
  }
  if (!USERNAME_RE.test(String(username ?? '').trim().toLowerCase())) {
    res.status(400).json({ message: 'Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen' });
    return;
  }
  if (String(password ?? '').length < 6) {
    res.status(400).json({ message: 'Password must be at least 6 characters' }); return;
  }
  if (role === 'student' && !studentId) {
    res.status(400).json({ message: 'Pick the student record this login belongs to' }); return;
  }

  try {
    const conflict = await credentialConflict({ username, email });
    if (conflict) { res.status(409).json({ message: conflict }); return; }

    if (role === 'student' && !mongoose.isValidObjectId(String(studentId))) {
      res.status(400).json({ message: 'Pick the student record this login belongs to' }); return;
    }
    if (role === 'student' && (await PortalAccount.exists({ studentId }))) {
      res.status(409).json({ message: 'That student already has a portal login' }); return;
    }

    // A locked seat is pinned to its role: whatever preset or overrides the
    // caller sent are ignored, so issuing a login can never widen the seat.
    const pinned = isLocked(role);
    const account = await PortalAccount.create({
      name, username, email, password, role,
      studentId: role === 'student' ? studentId : undefined,
      universityName: role === 'university' ? universityName : undefined,
      presetKey: pinned ? role : (presetKey || role),
      ...(!pinned && permissions ? { permissions: sanitizePermissions(permissions) } : {}),
    });

    // Keep the student record pointing back at its login.
    if (role === 'student') {
      await Student.findByIdAndUpdate(studentId, { userId: account._id });
    }

    logActivity(req, {
      action: 'create', entity: 'PortalAccount', entityId: account._id,
      label: `Issued a ${role} login for ${account.name}`,
    });
    res.status(201).json(account);
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    serverError(res, err);
  }
});

// PUT /api/portal-accounts/:id
router.put('/:id', authenticate, can('portal_accounts', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const { password, ...update } = req.body ?? {};
    void password;   // password has its own endpoint

    // The seat a locked role sits in is not editable, on this route either.
    const current = await PortalAccount.findById(req.params.id).select('role').lean();
    if (current && isLocked(current.role as string)) {
      delete update.presetKey;
      delete update.permissions;
      delete update.role;
    }
    // Which student a login is bound to is the row-level half of the student
    // gate — repointing it hands one person another person's whole record.
    delete update.studentId;
    // A portal account never becomes staff, whatever the body says.
    if (update.role !== undefined && !PORTAL_ROLES.includes(update.role as PortalRole)) {
      res.status(400).json({ message: 'A portal login is a student or a university' }); return;
    }

    if ('permissions' in update) update.permissions = sanitizePermissions(update.permissions);

    const conflict = await credentialConflict(
      { username: update.username, email: update.email },
      req.params.id,
    );
    if (conflict) { res.status(409).json({ message: conflict }); return; }

    const unset: Record<string, ''> = {};
    for (const field of ['username', 'email'] as const) {
      if (field in update && !String(update[field] ?? '').trim()) {
        delete update[field];
        unset[field] = '';
      }
    }
    if (update.permissions && Object.keys(update.permissions).length === 0) {
      delete update.permissions;
      unset.permissions = '';
    }

    const account = await PortalAccount.findByIdAndUpdate(
      req.params.id,
      Object.keys(unset).length ? { $set: update, $unset: unset } : update,
      { new: true, runValidators: true },
    ).select('-password');
    if (!account) { res.status(404).json({ message: 'No such account' }); return; }

    invalidateUser(req.params.id);
    logActivity(req, {
      action: 'update', entity: 'PortalAccount', entityId: account._id,
      label: `Updated the portal login for ${account.name}`,
      changes: [...Object.keys(update), ...Object.keys(unset)],
    });
    res.json((await withPresets([account.toObject() as unknown as Record<string, unknown>]))[0]);
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    serverError(res, err);
  }
});

// PATCH /api/portal-accounts/:id/password
router.patch('/:id/password', authenticate, can('portal_accounts', 'update'), async (req: AuthRequest, res: Response) => {
  const password = String(req.body?.password ?? '');
  if (password.length < 6) { res.status(400).json({ message: 'Password must be at least 6 characters' }); return; }
  try {
    const account = await PortalAccount.findById(req.params.id);
    if (!account) { res.status(404).json({ message: 'No such account' }); return; }
    account.password = password;   // hashing lives in the save hook
    await account.save();
    invalidateUser(req.params.id);

    logActivity(req, {
      action: 'password_reset', entity: 'PortalAccount', entityId: account._id,
      label: `Reset the portal password for ${account.name}`,
    });
    res.json({ message: `Password reset for ${account.name}` });
  } catch (err) {
    serverError(res, err);
  }
});

// DELETE /api/portal-accounts/:id — deactivate; the record stays referenced
router.delete('/:id', authenticate, can('portal_accounts', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const account = await PortalAccount.findByIdAndUpdate(
      req.params.id, { isActive: false }, { new: true },
    ).select('-password');
    if (!account) { res.status(404).json({ message: 'No such account' }); return; }

    invalidateUser(req.params.id);
    logActivity(req, {
      action: 'delete', entity: 'PortalAccount', entityId: account._id,
      label: `Deactivated the portal login for ${account.name}`,
    });
    res.json({ message: `${account.name} can no longer sign in` });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
