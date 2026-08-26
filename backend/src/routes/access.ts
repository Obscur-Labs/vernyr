import { Router, Response } from 'express';
import Preset, { PRESET_KEY_RE } from '../models/Preset';
import User from '../models/User';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { MODULES, sanitizePermissions, type PermissionMap } from '../config/modules';
import { isBuiltIn, builtIn } from '../config/presets';
import {
  listPresets,
  getPreset,
  effectivePermissions,
  allows,
  countUsersOnPreset,
  invalidateAll,
} from '../services/access';
import { logActivity } from '../utils/activityLog';
import { clientError } from '../utils/mongoErrors';

const router = Router();

/** GET /api/access/me — what the caller may do. */
router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  const p = req.principal!;
  res.json({
    presetKey: p.presetKey,
    presetName: p.presetName,
    fullAccess: p.fullAccess,
    hasOverrides: p.hasOverrides,
    permissions: p.permissions,
  });
});

// GET /api/access/modules — the registry the matrix is drawn from
router.get('/modules', authenticate, can('access', 'read'), (_req: AuthRequest, res: Response) => {
  res.json(MODULES);
});

// GET /api/access/presets
router.get('/presets', authenticate, can('access', 'read'), async (_req: AuthRequest, res: Response) => {
  try {
    const presets = await listPresets();
    const counts = await Promise.all(presets.map((p) => countUsersOnPreset(p.key)));
    res.json(presets.map((p, i) => ({ ...p, memberCount: counts[i] })));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** Refuses a change that would cost the caller their own ability to make the next one. */
async function wouldLockOutCaller(req: AuthRequest): Promise<boolean> {
  const user = await User.findById(req.principal!.id).select('role presetKey permissions').lean();
  if (!user) return true;

  const key = user.presetKey || user.role;
  const preset = (await getPreset(key)) ?? (await getPreset(user.role));
  if (!preset) return true;

  const next = effectivePermissions(preset, sanitizePermissions(user.permissions));
  return !allows(next, 'access', 'update');
}

// POST /api/access/presets — create a custom preset
router.post('/presets', authenticate, can('access', 'create'), async (req: AuthRequest, res: Response) => {
  const { key, name, description, permissions, scope, fullAccess } = req.body ?? {};

  const slug = String(key ?? '').trim().toLowerCase();
  if (!PRESET_KEY_RE.test(slug)) {
    res.status(400).json({ message: 'Key must be 2–32 characters: lowercase letters, numbers, underscore or hyphen' });
    return;
  }
  if (!String(name ?? '').trim()) {
    res.status(400).json({ message: 'Give the preset a name' });
    return;
  }
  if (isBuiltIn(slug) || (await Preset.exists({ key: slug }))) {
    res.status(409).json({ message: `A preset with the key “${slug}” already exists` });
    return;
  }

  try {
    const preset = await Preset.create({
      key: slug,
      name: String(name).trim(),
      description: String(description ?? '').trim() || undefined,
      // Reserved for the built-in Admin seat.
      fullAccess: false,
      permissions: sanitizePermissions(permissions),
      scope: scope === 'portal' ? 'portal' : 'staff',
    });
    void fullAccess;
    invalidateAll();

    logActivity(req, {
      action: 'create', entity: 'Preset', entityId: preset._id,
      label: `Created the ${preset.name} preset`,
    });
    res.status(201).json(preset);
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** PUT /api/access/presets/:key — editing a built-in writes a shadowing row. */
router.put('/presets/:key', authenticate, can('access', 'update'), async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.key).trim().toLowerCase();
  const base = builtIn(slug);
  const existing = await Preset.findOne({ key: slug });

  if (!base && !existing) {
    res.status(404).json({ message: 'No such preset' });
    return;
  }

  const { name, description, permissions, scope } = req.body ?? {};
  const nextPermissions: PermissionMap = sanitizePermissions(permissions);

  try {
    // `fullAccess` is not editable from the matrix.
    const doc = existing ?? new Preset({ key: slug, fullAccess: !!base?.fullAccess });
    doc.name = String(name ?? base?.name ?? doc.name).trim();
    doc.description = String(description ?? base?.description ?? doc.description ?? '').trim() || undefined;
    doc.permissions = nextPermissions;
    doc.scope = scope === 'portal' ? 'portal' : scope === 'staff' ? 'staff' : (base?.scope ?? doc.scope ?? 'staff');
    await doc.save();
    invalidateAll();

    if (await wouldLockOutCaller(req)) {
      // Put it back exactly as it was rather than leaving the caller stranded.
      if (existing) { await Preset.updateOne({ key: slug }, { $set: { permissions: existing.permissions } }); }
      else { await Preset.deleteOne({ key: slug }); }
      invalidateAll();
      res.status(400).json({ message: 'That change would remove your own access to this screen' });
      return;
    }

    logActivity(req, {
      action: 'update', entity: 'Preset', entityId: doc._id,
      label: `Updated the ${doc.name} preset`,
      changes: Object.keys(nextPermissions),
    });
    res.json({ ...doc.toObject(), isSystem: isBuiltIn(slug) });
  } catch (err) {
    const known = clientError(err);
    if (known) { res.status(known.status).json({ message: known.message }); return; }
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** DELETE /api/access/presets/:key — built-in reverts to default, custom is removed. */
router.delete('/presets/:key', authenticate, can('access', 'delete'), async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.key).trim().toLowerCase();
  const row = await Preset.findOne({ key: slug });

  if (!row) {
    res.status(404).json({ message: isBuiltIn(slug) ? 'That preset is already at its default' : 'No such preset' });
    return;
  }

  if (!isBuiltIn(slug)) {
    const inUse = await countUsersOnPreset(slug);
    if (inUse > 0) {
      res.status(409).json({
        message: `${inUse} ${inUse === 1 ? 'account is' : 'accounts are'} using this preset. Move them first.`,
      });
      return;
    }
  }

  try {
    await row.deleteOne();
    invalidateAll();

    if (await wouldLockOutCaller(req)) {
      await Preset.create(row.toObject());
      invalidateAll();
      res.status(400).json({ message: 'That change would remove your own access to this screen' });
      return;
    }

    logActivity(req, {
      action: 'delete', entity: 'Preset', entityId: row._id,
      label: isBuiltIn(slug) ? `Reset the ${row.name} preset to its default` : `Deleted the ${row.name} preset`,
    });
    res.json({ message: isBuiltIn(slug) ? 'Reset to the built-in default' : 'Preset deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
