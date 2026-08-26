import mongoose from 'mongoose';
import User from '../models/User';
import PortalAccount from '../models/PortalAccount';

/** The seam between the two account collections. */

export type AccountKind = 'staff' | 'portal';

export interface AccountRef {
  kind: AccountKind;
  id: string;
  name: string;
  role: string;
  username?: string;
  email?: string;
  avatar?: string;
  isActive: boolean;
  studentId?: string;
  universityName?: string;
  presetKey?: string;
  permissions?: unknown;
}

const SUMMARY_FIELDS = 'name role username email avatar isActive studentId universityName presetKey permissions';

const toRef = (doc: Record<string, unknown>, kind: AccountKind): AccountRef => ({
  kind,
  id: String(doc._id),
  name: doc.name as string,
  role: doc.role as string,
  username: doc.username as string | undefined,
  email: doc.email as string | undefined,
  avatar: doc.avatar as string | undefined,
  isActive: doc.isActive !== false,
  studentId: doc.studentId ? String(doc.studentId) : undefined,
  universityName: doc.universityName as string | undefined,
  presetKey: doc.presetKey as string | undefined,
  permissions: doc.permissions,
});

/* ── Lookup ────────────────────────────────────────────────────────────── */

export async function findAccountById(id: string): Promise<AccountRef | null> {
  if (!mongoose.isValidObjectId(id)) return null;

  const staff = await User.findById(id).select(SUMMARY_FIELDS).lean();
  if (staff) return toRef(staff as Record<string, unknown>, 'staff');

  const portal = await PortalAccount.findById(id).select(SUMMARY_FIELDS).lean();
  if (portal) return toRef(portal as Record<string, unknown>, 'portal');

  return null;
}

/** Sign-in lookup. */
export async function findAccountByCredential(identifier: string) {
  const value = identifier.trim().toLowerCase();
  const query = { ...(value.includes('@') ? { email: value } : { username: value }), isActive: true };

  const staff = await User.findOne(query).select('+password');
  if (staff) return { kind: 'staff' as const, doc: staff };

  const portal = await PortalAccount.findOne(query).select('+password');
  if (portal) return { kind: 'portal' as const, doc: portal };

  return null;
}

/** The document itself, for the paths that need to save it (password changes). */
export async function findAccountDocById(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  const staff = await User.findById(id).select('+password');
  if (staff) return { kind: 'staff' as const, doc: staff };
  const portal = await PortalAccount.findById(id).select('+password');
  if (portal) return { kind: 'portal' as const, doc: portal };
  return null;
}

/* ── Uniqueness ────────────────────────────────────────────────────────── */

/** Credentials must be unique across BOTH collections; a unique index is per-collection. */
export async function credentialConflict(
  { username, email }: { username?: string; email?: string },
  excludeId?: string,
): Promise<string | null> {
  const notSelf = excludeId && mongoose.isValidObjectId(excludeId)
    ? { _id: { $ne: new mongoose.Types.ObjectId(excludeId) } }
    : {};

  const uname = username?.trim().toLowerCase();
  if (uname) {
    const taken =
      (await User.exists({ username: uname, ...notSelf })) ??
      (await PortalAccount.exists({ username: uname, ...notSelf }));
    if (taken) return 'That username is already taken';
  }

  const mail = email?.trim().toLowerCase();
  if (mail) {
    const taken =
      (await User.exists({ email: mail, ...notSelf })) ??
      (await PortalAccount.exists({ email: mail, ...notSelf }));
    if (taken) return 'An account with this email already exists';
  }

  return null;
}

/* ── Cross-collection populate ─────────────────────────────────────────── */

/** Reads a dotted path off a plain object. */
function readPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key]),
    obj,
  );
}

function writePath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce<unknown>(
    (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key]),
    obj,
  );
  if (parent && typeof parent === 'object') (parent as Record<string, unknown>)[last] = value;
}

/** `.populate()` for a reference that could live in either collection. */
export async function attachAccounts<T extends Record<string, unknown>>(
  docs: T[],
  paths: string[],
): Promise<T[]> {
  const ids = new Set<string>();

  for (const doc of docs) {
    for (const path of paths) {
      const value = readPath(doc, path);
      if (Array.isArray(value)) value.forEach((v) => v && ids.add(String(v)));
      else if (value) ids.add(String(value));
    }
  }
  if (ids.size === 0) return docs;

  const list = [...ids].filter((id) => mongoose.isValidObjectId(id));
  const [staff, portal] = await Promise.all([
    User.find({ _id: { $in: list } }).select(SUMMARY_FIELDS).lean(),
    PortalAccount.find({ _id: { $in: list } }).select(SUMMARY_FIELDS).lean(),
  ]);

  const byId = new Map<string, AccountRef>();
  for (const d of staff) byId.set(String(d._id), toRef(d as Record<string, unknown>, 'staff'));
  for (const d of portal) byId.set(String(d._id), toRef(d as Record<string, unknown>, 'portal'));

  /** Shape it like a populated document so call sites read `_id` and `name`. */
  const shape = (id: unknown) => {
    const ref = byId.get(String(id));
    // An id with no account behind it is left as it was. A deleted sender must
    // not take the message it sent off the screen.
    return ref ? { _id: ref.id, name: ref.name, role: ref.role, avatar: ref.avatar, email: ref.email } : id;
  };

  for (const doc of docs) {
    for (const path of paths) {
      const value = readPath(doc, path);
      if (Array.isArray(value)) writePath(doc, path, value.map(shape));
      else if (value) writePath(doc, path, shape(value));
    }
  }
  return docs;
}

/** Updates whichever collection holds the account. */
export async function touchLastSeen(id: string, lastSeenAt: Date) {
  const res = await User.updateOne({ _id: id }, { lastSeenAt });
  if (res.matchedCount === 0) await PortalAccount.updateOne({ _id: id }, { lastSeenAt });
}

/** Scoping fields off a portal account. Staff resolve to an empty result. */
export async function portalScope(id: string): Promise<{ studentId?: string; universityName?: string }> {
  if (!mongoose.isValidObjectId(id)) return {};
  const acc = await PortalAccount.findById(id).select('studentId universityName').lean();
  return {
    studentId: acc?.studentId ? String(acc.studentId) : undefined,
    universityName: acc?.universityName ?? undefined,
  };
}

/** The portal login bound to a student record, if one was ever issued. */
export async function portalAccountForStudent(studentId: string) {
  return PortalAccount.findOne({ studentId }).select('_id name username').lean();
}

/** Last-seen from whichever collection holds the account. */
export async function lastSeenOf(id: string): Promise<Date | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const staff = await User.findById(id).select('lastSeenAt').lean();
  if (staff) return staff.lastSeenAt ?? null;
  const portal = await PortalAccount.findById(id).select('lastSeenAt').lean();
  return portal?.lastSeenAt ?? null;
}
