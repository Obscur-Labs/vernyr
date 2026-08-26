import { MODULES, type PermissionMap } from './modules';

/** The built-in presets, defined in code rather than seeded into Mongo. */

export interface PresetDef {
  key: string;
  name: string;
  description: string;
  /** Grants everything, including modules added to the registry later. */
  fullAccess: boolean;
  permissions: PermissionMap;
  /** Built-ins can be edited but never deleted — a user may still point at one. */
  isSystem: boolean;
  /** Presets for the student portal and partner logins. */
  scope: 'staff' | 'portal';
}

const none = {};
const read = { read: true };
const crud = { create: true, read: true, update: true, delete: true };

export const BUILT_IN_PRESETS: PresetDef[] = [
  {
    key: 'admin',
    name: 'Admin',
    description:
      'Everything, including roles and access itself — and any module added later. The one exception is replying in chat: the admin reads every conversation for oversight without becoming a participant in it.',
    fullAccess: true,
    // Laid over the full grant. Turn these on in the matrix and the admin joins
    // the conversation like anyone else; that is now a decision, not a rule.
    permissions: { chat: { create: false, update: false, delete: false } },
    isSystem: true,
    scope: 'staff',
  },
  {
    key: 'counsellor',
    name: 'Counsellor',
    description: 'Case-working staff: the whole student journey, no money and no accounts.',
    fullAccess: false,
    permissions: {
      dashboard: read,
      leads: crud,
      students: crud,
      applications: crud,
      documents: crud,
      visa: crud,
      chat: crud,
      notifications: { create: true, read: true, update: true, delete: true },
      // Counsellors issue portal logins for their own students.
      portal_accounts: { create: true, read: true, update: true },
      finance: none,
      reports: none,
      members: none,
      access: none,
    },
    isSystem: true,
    scope: 'staff',
  },
  {
    key: 'university',
    name: 'University partner',
    description: 'Sees the applications sent to them and can move those along. Nothing else.',
    fullAccess: false,
    permissions: {
      dashboard: read,
      leads: read,
      students: read,
      applications: { read: true, update: true },
      notifications: { read: true, update: true, delete: true },
    },
    isSystem: true,
    scope: 'portal',
  },
  {
    key: 'student',
    name: 'Student',
    description:
      'The portal seat. Module access is only half the gate — every student route also scopes rows to their own record.',
    fullAccess: false,
    permissions: {
      // `update` is what the portal's profile screen needs. The route scopes it
      // to the caller's own record — a module grant never widens that.
      students: { read: true, update: true },
      applications: read,
      documents: { create: true, read: true },
      visa: read,
      finance: read,
      chat: { create: true, read: true, update: true, delete: true },
      notifications: { read: true, update: true, delete: true },
    },
    isSystem: true,
    scope: 'portal',
  },
];

const BUILT_IN_BY_KEY = new Map(BUILT_IN_PRESETS.map((p) => [p.key, p]));
export const isBuiltIn = (key: string) => BUILT_IN_BY_KEY.has(key);
export const builtIn = (key: string) => BUILT_IN_BY_KEY.get(key);

/** Fallback seat for accounts with no `presetKey`. */
export const DEFAULT_PRESET_FOR_ROLE: Record<string, string> = {
  admin: 'admin',
  counsellor: 'counsellor',
  university: 'university',
  student: 'student',
};

/** A blank matrix, for the "start from nothing" case in the preset editor. */
export function emptyPermissions(): PermissionMap {
  return Object.fromEntries(MODULES.map((m) => [m.key, {}]));
}
