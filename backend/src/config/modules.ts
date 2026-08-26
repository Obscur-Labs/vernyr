/** The module registry — the vocabulary the whole access system speaks. */

export const ACTIONS = ['create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

/** `{ students: { read: true, update: true } }` — an absent verb means "no". */
export type PermissionMap = Record<string, Partial<Record<Action, boolean>>>;

export interface ModuleDef {
  key: string;
  label: string;
  /** Groups the matrix in the UI so a long list stays scannable. */
  group: 'Pipeline' | 'Casework' | 'Money' | 'Communication' | 'Administration';
  description: string;
  /** Some modules are read-only surfaces; offering them a Delete switch lies. */
  actions: Action[];
  /** Verbs whose plain-English name would mislead in this module. */
  actionLabels?: Partial<Record<Action, string>>;
}

const CRUD: Action[] = ['create', 'read', 'update', 'delete'];

export const MODULES: ModuleDef[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    group: 'Pipeline',
    description: 'The landing page and its headline counts.',
    actions: ['read'],
  },
  {
    key: 'leads',
    label: 'Leads',
    group: 'Pipeline',
    description: 'Enquiries before they become students, and the conversion board.',
    actions: CRUD,
  },
  {
    key: 'students',
    label: 'Students',
    group: 'Casework',
    description: 'Student records, stages and counsellor assignment.',
    actions: CRUD,
  },
  {
    key: 'applications',
    label: 'Applications',
    group: 'Casework',
    description: 'University applications and their offer status.',
    actions: CRUD,
  },
  {
    key: 'documents',
    label: 'Documents',
    group: 'Casework',
    description: 'Uploads, document requests and verification decisions.',
    actions: CRUD,
    actionLabels: { create: 'Upload', update: 'Verify / edit' },
  },
  {
    key: 'visa',
    label: 'Visa tracker',
    group: 'Casework',
    description: 'Filing, biometrics, interview and decision records.',
    actions: CRUD,
  },
  {
    key: 'finance',
    label: 'Finance',
    group: 'Money',
    description: 'Payments, invoices and fee records.',
    actions: CRUD,
  },
  {
    key: 'chat',
    label: 'Chat',
    group: 'Communication',
    description:
      'Conversations with students. Read without Create is the observer seat: every thread is visible, none can be replied to.',
    actions: CRUD,
    actionLabels: { create: 'Send', update: 'Edit own', delete: 'Delete own' },
  },
  {
    key: 'notifications',
    label: 'Notifications',
    group: 'Communication',
    description: 'The notification feed. Create means raising one for someone else.',
    actions: CRUD,
  },
  {
    key: 'reports',
    label: 'Reports',
    group: 'Administration',
    description: 'Aggregate analytics across the whole pipeline.',
    actions: ['read'],
  },
  {
    key: 'members',
    label: 'Members',
    group: 'Administration',
    description: 'Staff and partner accounts — who exists and who can sign in.',
    actions: CRUD,
    actionLabels: { delete: 'Deactivate' },
  },
  {
    key: 'portal_accounts',
    label: 'Portal accounts',
    group: 'Administration',
    description: 'Logins for students and university partners — the people outside the office.',
    actions: CRUD,
    actionLabels: { create: 'Issue', delete: 'Deactivate' },
  },
  {
    key: 'access',
    label: 'Roles & access',
    group: 'Administration',
    description:
      'The presets on this screen. Granting Update here lets someone change what everyone else can do, including themselves.',
    actions: CRUD,
  },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));
export const getModule = (key: string) => BY_KEY.get(key);

/** Strips unknown modules and verbs a module does not offer. */
export function sanitizePermissions(input: unknown): PermissionMap {
  const out: PermissionMap = {};
  if (!input || typeof input !== 'object') return out;

  for (const [moduleKey, verbs] of Object.entries(input as Record<string, unknown>)) {
    const mod = BY_KEY.get(moduleKey);
    if (!mod || !verbs || typeof verbs !== 'object') continue;

    const kept: Partial<Record<Action, boolean>> = {};
    for (const action of mod.actions) {
      const value = (verbs as Record<string, unknown>)[action];
      if (typeof value === 'boolean') kept[action] = value;
    }
    if (Object.keys(kept).length) out[moduleKey] = kept;
  }
  return out;
}

/** Every verb of every module, granted. The shape `fullAccess` expands to. */
export function allPermissions(): PermissionMap {
  const out: PermissionMap = {};
  for (const mod of MODULES) {
    out[mod.key] = Object.fromEntries(mod.actions.map((a) => [a, true]));
  }
  return out;
}
