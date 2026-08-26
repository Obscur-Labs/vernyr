import { Router, Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import mongoose from 'mongoose';
import User, { UserRole, usesEmailLogin, USERNAME_RE } from '../models/User';
import ActivityLog from '../models/ActivityLog';
import { logDevActivity, diffFields } from '../utils/activityLog';
import { isCloudinaryConfigured } from '../config/cloudinary';
import PortalAccount from '../models/PortalAccount';
import { MODULES } from '../config/modules';
import { listPresets, countUsersOnPreset, effectivePermissions } from '../services/access';

/**
 * Unauthenticated developer console API.
 *
 * This router bypasses every auth check in the app, so it is gated three ways
 * and any one of them failing keeps it off:
 *
 *   1. NODE_ENV must not be 'production'
 *   2. ENABLE_DEV_ROUTES must be exactly 'true'
 *   3. every request must originate from loopback (127.0.0.1 / ::1)
 *
 * (1) and (2) decide whether it is mounted at all — see index.ts. (3) runs per
 * request so a tunnel or LAN peer still cannot reach it on a dev machine.
 *
 * Never remove a gate, and never mount this behind a public origin.
 */

export function isDevToolsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_ROUTES === 'true';
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  // Re-checked per request: the mount-time gate alone would survive an env
  // change mid-process, and it says nothing about who is connecting.
  if (!isDevToolsEnabled()) { res.status(404).json({ message: 'Not found' }); return; }

  const ip = req.socket.remoteAddress ?? '';
  if (!LOOPBACK.has(ip)) {
    res.status(403).json({ message: 'Dev routes are reachable from localhost only' });
    return;
  }
  next();
}

const router = Router();
router.use(localhostOnly);

// ── Roles ────────────────────────────────────────────────────────────────────

export const ROLES: UserRole[] = ['admin', 'counsellor', 'student', 'university'];

/**
 * Row-level scoping — the half of access that permissions cannot express.
 *
 * `can(module, action)` answers *whether*; these rules answer *whose*. They are
 * still hand-maintained because they live inside handlers, so when you change
 * one, change it here too. The module matrix below is no longer hand-written:
 * it is generated from the live registry and the presets in force.
 */
interface ScopingRule {
  area: string;
  surface: string;
  rule: string;
  source: string;
}

const SCOPING_RULES: ScopingRule[] = [
  { area: 'Students', surface: 'GET /api/students',
    rule: 'Students see only themselves, counsellors see their own assignments, university partners see their own applicants',
    source: 'routes/students.ts — role branch in the list filter' },
  { area: 'Students', surface: 'GET/PUT/PATCH /api/students/:id',
    rule: 'A student may only reach the record their account is linked to',
    source: 'routes/students.ts — denyOtherStudentsRecord()' },
  { area: 'Students', surface: 'PUT/PATCH /api/students/:id',
    rule: 'A student may only set personal, education, scores, passport and preferences — never stage or assignedCounsellor',
    source: 'routes/students.ts — STUDENT_SELF_FIELDS' },
  { area: 'Students', surface: 'write ops /api/students',
    rule: 'University accounts are read-only regardless of preset',
    source: 'routes/students.ts — role check' },
  { area: 'Leads', surface: 'GET /api/leads',
    rule: 'Counsellors only see leads assigned to them',
    source: 'routes/leads.ts' },
  { area: 'Documents', surface: 'POST /api/documents/requests, GET /download-all/:studentId',
    rule: 'Staff surfaces — not reachable by students or university partners',
    source: 'routes/documents.ts — isStaff()' },
  { area: 'Chat', surface: 'GET /api/messages/conversations',
    rule: 'An observer (chat Read without Send) sees every conversation; everyone else sees their own',
    source: 'routes/messages.ts — isChatObserver()' },
  { area: 'Chat', surface: 'GET /api/messages/:conversationId',
    rule: 'Caller must be a participant, or an observer',
    source: 'routes/messages.ts — canRead()' },
  { area: 'Members', surface: 'PUT /api/users/:id',
    rule: 'Yourself, or anyone if you hold members.update; role, isActive, presetKey and permissions are never self-settable',
    source: 'routes/users.ts — PRIVILEGED_FIELDS' },
  { area: 'Auth', surface: 'every authenticated route',
    rule: 'A deactivated account is refused on the next request, not when its token expires',
    source: 'middleware/auth.ts — authenticate()' },
];

/**
 * GET /api/dev/rbac — the live access picture.
 *
 * `modules` and `presets` are read straight from the registry and the presets
 * in force, so this cannot drift. `scoping` is the hand-maintained remainder.
 */
router.get('/rbac', async (_req, res: Response) => {
  try {
    const counts = [
      ...(await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }])),
      ...(await PortalAccount.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }])),
    ];
    const byRole = new Map<string, number>(counts.map(c => [c._id as string, c.n as number]));
    const presets = await listPresets();

    res.json({
      roles: ROLES.map(role => ({ role, users: byRole.get(role) ?? 0 })),
      modules: MODULES,
      presets: await Promise.all(presets.map(async (p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        isSystem: p.isSystem,
        scope: p.scope,
        fullAccess: p.fullAccess,
        members: await countUsersOnPreset(p.key),
        permissions: effectivePermissions(p),
      }))),
      scoping: SCOPING_RULES,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// ── Overview ─────────────────────────────────────────────────────────────────

/** GET /api/dev/overview — environment + database snapshot */
router.get('/overview', async (_req, res: Response) => {
  try {
    const conn = mongoose.connection;
    const collections = conn.db ? await conn.db.listCollections().toArray() : [];

    const counts: Record<string, number> = {};
    if (conn.db) {
      await Promise.all(collections.map(async c => {
        counts[c.name] = await conn.db!.collection(c.name).countDocuments();
      }));
    }

    res.json({
      env: {
        nodeEnv:       process.env.NODE_ENV ?? 'development',
        port:          process.env.PORT ?? '5000',
        jwtExpiresIn:  process.env.JWT_EXPIRES_IN ?? '7d',
        jwtSecretSet:  !!process.env.JWT_SECRET,
        crmUrl:        process.env.CLIENT_CRM_URL ?? '',
        studentUrl:    process.env.CLIENT_STUDENT_URL ?? '',
      },
      storage: {
        provider:   'cloudinary',
        configured: isCloudinaryConfigured(),
        folder:     process.env.CLOUDINARY_FOLDER ?? 'la-europa-docs',
      },
      database: {
        name:      conn.name ?? null,
        readyState: conn.readyState,          // 1 = connected
        collections: Object.entries(counts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// ── Collection browser (read-only) ───────────────────────────────────────────

/** GET /api/dev/collections/:name?limit= — newest documents in any collection */
router.get('/collections/:name', async (req: Request, res: Response): Promise<void> => {
  const conn = mongoose.connection;
  if (!conn.db) { res.status(503).json({ message: 'Database not connected' }); return; }

  try {
    const known = (await conn.db.listCollections().toArray()).map(c => c.name);
    if (!known.includes(req.params.name)) { res.status(404).json({ message: 'Unknown collection' }); return; }

    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const docs = await conn.db.collection(req.params.name)
      .find({}, { projection: { password: 0 } })   // never leak hashes
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();

    res.json({ collection: req.params.name, limit, docs });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// ── User / RBAC CRUD ─────────────────────────────────────────────────────────

/** GET /api/dev/users?role=&q=&includeInactive=true */
router.get('/users', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.includeInactive !== 'true') filter.isActive = true;

    const q = (req.query.q as string | undefined)?.trim();
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name:     { $regex: escaped, $options: 'i' } },
        { username: { $regex: escaped, $options: 'i' } },
        { email:    { $regex: escaped, $options: 'i' } },
      ];
    }

    const [staff, portal] = await Promise.all([
      User.find(filter).select('-password').lean(),
      PortalAccount.find(filter).select('-password').lean(),
    ]);
    const users = [...staff, ...portal].sort((a, b) =>
      a.role === b.role ? a.name.localeCompare(b.name) : a.role.localeCompare(b.role));
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** POST /api/dev/users — create a user with any role */
router.post('/users', async (req: Request, res: Response): Promise<void> => {
  const { name, username, email, password, role } = req.body as Record<string, string>;
  if (!name || !password) {
    res.status(400).json({ message: 'name and password are required' }); return;
  }
  if (role && !ROLES.includes(role as UserRole)) {
    res.status(400).json({ message: `Unknown role '${role}'` }); return;
  }
  // Admins are keyed by email, every other role by username.
  const wantsEmail = usesEmailLogin((role || 'counsellor') as UserRole);
  if (wantsEmail && !email) {
    res.status(400).json({ message: 'Admin accounts require an email address' }); return;
  }
  if (!wantsEmail && !username) {
    res.status(400).json({ message: 'This role requires a username' }); return;
  }
  try {
    if (username && await User.findOne({ username: username.toLowerCase() })) {
      res.status(409).json({ message: 'Username already taken' }); return;
    }
    if (email && await User.findOne({ email: email.toLowerCase() })) {
      res.status(409).json({ message: 'Email already in use' }); return;
    }
    // create() (not insertOne) so the password-hashing pre-save hook runs
    const user = await User.create(req.body);
    logDevActivity(req, {
      action: 'create', entity: 'User', entityId: user._id,
      label: `Created ${user.username ?? user.email} (${user.role})`,
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** Editable through the console — everything except the password and _id. */
const EDITABLE = ['name', 'username', 'email', 'role', 'presetKey', 'phone', 'universityName', 'isActive'] as const;

/** PUT /api/dev/users/:id — update any field except the password, on any user */
router.put('/users/:id', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  if (body.role && !ROLES.includes(body.role as UserRole)) {
    res.status(400).json({ message: `Unknown role '${body.role}'` }); return;
  }
  try {
    // Loaded and saved rather than findByIdAndUpdate: the credential rule lives
    // in a pre('validate') hook, which update queries skip entirely.
    const user = (await User.findById(req.params.id)) ?? (await PortalAccount.findById(req.params.id));
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    const before = user.toObject() as unknown as Record<string, unknown>;

    for (const field of EDITABLE) {
      if (!(field in body)) continue;
      const value = body[field];
      // Clearing a credential must store undefined, not '' — the sparse unique
      // index treats every empty string as the same value.
      if ((field === 'username' || field === 'email') && !value) {
        user.set(field, undefined);
      } else if (field === 'username' && typeof value === 'string') {
        user.username = value.trim().toLowerCase();
      } else {
        user.set(field, value);
      }
    }

    if (user.username && !USERNAME_RE.test(user.username)) {
      res.status(400).json({ message: 'Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen' });
      return;
    }

    const clash = await User.findOne({
      _id: { $ne: user._id },
      $or: [
        ...(user.username ? [{ username: user.username }] : []),
        ...(user.email ? [{ email: user.email }] : []),
      ],
    });
    if (clash) {
      res.status(409).json({ message: clash.username === user.username ? 'Username already taken' : 'Email already in use' });
      return;
    }

    await user.save();
    const changes = diffFields(before, user.toObject() as unknown as Record<string, unknown>, [...EDITABLE]);
    if (changes.length) {
      logDevActivity(req, {
        action: 'update', entity: 'User', entityId: user._id,
        label: `Updated ${user.username ?? user.email}`, changes,
      });
    }
    res.json(await User.findById(user._id).select('-password'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    res.status(400).json({ message });
  }
});

/** PATCH /api/dev/users/:id/password — set a new password */
router.patch('/users/:id/password', async (req: Request, res: Response): Promise<void> => {
  const { password } = req.body as { password?: string };
  if (!password || password.length < 6) {
    res.status(400).json({ message: 'password must be at least 6 characters' }); return;
  }
  try {
    const user = (await User.findById(req.params.id)) ?? (await PortalAccount.findById(req.params.id));
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    // save() so the pre-save hook hashes it — findByIdAndUpdate would store plaintext
    user.password = password;
    await user.save();
    logDevActivity(req, {
      action: 'password_reset', entity: 'User', entityId: user._id,
      label: `Reset the password for ${user.username ?? user.email}`,
    });
    res.json({ ok: true, login: user.username ?? user.email });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** DELETE /api/dev/users/:id */
router.delete('/users/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (await User.findByIdAndDelete(req.params.id).select('-password'))
      ?? (await PortalAccount.findByIdAndDelete(req.params.id).select('-password'));
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    logDevActivity(req, {
      action: 'delete', entity: 'User', entityId: user._id,
      label: `Deleted ${user.username ?? user.email} (${user.role})`,
    });
    res.json({ ok: true, deleted: user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/**
 * POST /api/dev/users/:id/impersonate — mint a normal login token for any user
 * so a role can be exercised without knowing its password.
 */
router.post('/users/:id/impersonate', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (await User.findById(req.params.id)) ?? (await PortalAccount.findById(req.params.id));
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'] },
    );
    logDevActivity(req, {
      action: 'impersonate', entity: 'User', entityId: user._id,
      label: `Signed in as ${user.username ?? user.email} (${user.role})`,
    });
    res.json({ token, user, studentId: 'studentId' in user ? String(user.studentId ?? '') || null : null });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// ── Activity log ─────────────────────────────────────────────────────────────

/** GET /api/dev/activity?limit=&action=&source=&q= — newest first */
router.get('/activity', async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.source) filter.source = req.query.source;

    const q = (req.query.q as string | undefined)?.trim();
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { label:     { $regex: escaped, $options: 'i' } },
        { actorName: { $regex: escaped, $options: 'i' } },
        { entity:    { $regex: escaped, $options: 'i' } },
      ];
    }

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const [entries, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      ActivityLog.countDocuments(filter),
    ]);
    res.json({ entries, total, limit });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** DELETE /api/dev/activity — clear the trail */
router.delete('/activity', async (req: Request, res: Response): Promise<void> => {
  try {
    const { deletedCount } = await ActivityLog.deleteMany({});
    logDevActivity(req, {
      action: 'purge', entity: 'ActivityLog',
      label: `Cleared ${deletedCount} activity ${deletedCount === 1 ? 'entry' : 'entries'}`,
    });
    res.json({ ok: true, deleted: deletedCount });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
