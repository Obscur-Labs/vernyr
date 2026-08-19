import { Router, Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import { isCloudinaryConfigured } from '../config/cloudinary';

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

export const ROLES: UserRole[] = [
  'super_admin', 'admin', 'counsellor_manager', 'counsellor', 'finance', 'accountant',
  'visa_team', 'doc_verification', 'university_team', 'support', 'student', 'university',
];

/**
 * A hand-maintained mirror of the access rules enforced across the API. Most of
 * them are inline `req.user.role` checks rather than `authorize()` calls, so
 * there is no way to derive this at runtime — when you change a guard in a
 * route, update the matching entry here.
 */
interface RbacRule {
  area: string;
  surface: string;
  rule: string;
  allow?: string[];
  deny?: string[];
  source: string;
}

const RBAC_MATRIX: RbacRule[] = [
  { area: 'Users', surface: 'GET /api/users', rule: 'List staff accounts',
    allow: ['super_admin', 'admin', 'counsellor_manager'], source: 'routes/users.ts — authorize()' },
  { area: 'Users', surface: 'POST /api/users', rule: 'Create a user',
    allow: ['super_admin', 'admin'], source: 'routes/users.ts — authorize()' },
  { area: 'Users', surface: 'POST /api/users/student-account', rule: 'Create a portal login for a student',
    allow: ['super_admin', 'admin', 'counsellor_manager'], source: 'routes/users.ts — authorize()' },
  { area: 'Users', surface: 'PUT /api/users/:id', rule: 'Update a user — any authenticated caller',
    source: 'routes/users.ts' },

  { area: 'Students', surface: 'GET /api/students', rule: 'Scoped per role: students see themselves, counsellors see their assignments, university sees its own applicants',
    source: 'routes/students.ts:90-98' },
  { area: 'Students', surface: 'POST/PUT/DELETE /api/students', rule: 'University accounts are read-only',
    deny: ['university'], source: 'routes/students.ts:121,150,169,192,265' },
  { area: 'Students', surface: 'PUT /api/students/:id/counsellor', rule: 'Assign a counsellor',
    allow: ['super_admin', 'admin', 'counsellor_manager'], source: 'routes/students.ts:215' },

  { area: 'Leads', surface: 'GET /api/leads', rule: 'Counsellors only see leads assigned to them',
    source: 'routes/leads.ts:15' },

  { area: 'Applications', surface: 'write ops /api/applications', rule: 'University accounts are read-only',
    deny: ['university'], source: 'routes/applications.ts:22-105' },

  { area: 'Documents', surface: 'write ops /api/documents', rule: 'University accounts are read-only',
    deny: ['university'], source: 'routes/documents.ts — READ_ONLY_ROLES' },
  { area: 'Documents', surface: 'POST /api/documents/requests', rule: 'Request documents from a student — staff only',
    deny: ['university', 'student'], source: 'routes/documents.ts — isStaff()' },
  { area: 'Documents', surface: 'GET /api/documents/download-all/:studentId', rule: 'Bulk ZIP export — staff only',
    deny: ['university', 'student'], source: 'routes/documents.ts — isStaff()' },

  { area: 'Chat', surface: 'all /api/messages', rule: 'Admin accounts have no chat access; chat is between case staff and the student',
    deny: ['admin', 'super_admin'], source: 'routes/messages.ts — NO_CHAT_ROLES' },
  { area: 'Chat', surface: 'POST /api/messages/send-file, GET /api/messages/:conversationId', rule: 'Caller must be a participant of the conversation',
    source: 'routes/messages.ts — isParticipant()' },

  { area: 'CRM nav', surface: '/leads', rule: 'Hidden from visa_team and doc_verification',
    deny: ['visa_team', 'doc_verification', 'student'], source: 'crm AppShell.tsx — NAV_ITEMS' },
  { area: 'CRM nav', surface: '/applications', rule: 'Visible to counselling + university side',
    allow: ['super_admin', 'admin', 'counsellor_manager', 'counsellor', 'university_team', 'university'], source: 'crm AppShell.tsx' },
  { area: 'CRM nav', surface: '/visa', rule: 'Visa tracker',
    allow: ['super_admin', 'admin', 'counsellor_manager', 'counsellor', 'visa_team'], source: 'crm AppShell.tsx' },
  { area: 'CRM nav', surface: '/documents', rule: 'Document review',
    allow: ['super_admin', 'admin', 'counsellor_manager', 'counsellor', 'doc_verification'], source: 'crm AppShell.tsx' },
  { area: 'CRM nav', surface: '/finance', rule: 'Payments and invoices',
    allow: ['super_admin', 'admin', 'finance', 'accountant'], source: 'crm AppShell.tsx' },
  { area: 'CRM nav', surface: '/reports', rule: 'Reporting',
    allow: ['super_admin', 'admin', 'counsellor_manager'], source: 'crm AppShell.tsx' },
  { area: 'CRM nav', surface: '/settings', rule: 'User administration',
    allow: ['super_admin', 'admin'], source: 'crm AppShell.tsx' },
  { area: 'CRM nav', surface: '/chat', rule: 'Case staff only',
    deny: ['super_admin', 'admin'], source: 'crm AppShell.tsx' },
];

/** GET /api/dev/rbac — roles, live headcount per role, and the access matrix */
router.get('/rbac', async (_req, res: Response) => {
  try {
    const counts = await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]);
    const byRole = new Map<string, number>(counts.map(c => [c._id as string, c.n as number]));
    res.json({
      roles: ROLES.map(role => ({ role, users: byRole.get(role) ?? 0 })),
      matrix: RBAC_MATRIX,
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
        { name:  { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }

    const users = await User.find(filter).select('-password').sort('role name');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** POST /api/dev/users — create a user with any role */
router.post('/users', async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, role } = req.body as Record<string, string>;
  if (!name || !email || !password) {
    res.status(400).json({ message: 'name, email and password are required' }); return;
  }
  if (role && !ROLES.includes(role as UserRole)) {
    res.status(400).json({ message: `Unknown role '${role}'` }); return;
  }
  try {
    if (await User.findOne({ email: email.toLowerCase() })) {
      res.status(409).json({ message: 'Email already in use' }); return;
    }
    // create() (not insertOne) so the password-hashing pre-save hook runs
    const user = await User.create(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** PUT /api/dev/users/:id — update any field except the password */
router.put('/users/:id', async (req: Request, res: Response): Promise<void> => {
  const { password, _id, ...updates } = req.body as Record<string, unknown>;
  void password; void _id;   // password has its own endpoint; _id is immutable

  if (updates.role && !ROLES.includes(updates.role as UserRole)) {
    res.status(400).json({ message: `Unknown role '${updates.role}'` }); return;
  }
  try {
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .select('-password');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** PATCH /api/dev/users/:id/password — set a new password */
router.patch('/users/:id/password', async (req: Request, res: Response): Promise<void> => {
  const { password } = req.body as { password?: string };
  if (!password || password.length < 6) {
    res.status(400).json({ message: 'password must be at least 6 characters' }); return;
  }
  try {
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    // save() so the pre-save hook hashes it — findByIdAndUpdate would store plaintext
    user.password = password;
    await user.save();
    res.json({ ok: true, email: user.email });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** DELETE /api/dev/users/:id */
router.delete('/users/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findByIdAndDelete(req.params.id).select('-password');
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
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
    const user = await User.findById(req.params.id);
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'] },
    );
    res.json({ token, user, studentId: user.studentId?.toString() ?? null });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
