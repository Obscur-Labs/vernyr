/**
 * The client's permissions matrix (legacy/server/rbac.js, Section 1.7). F = full, E = view+add+edit, V = view, - = none.
 * Non-admin access is always limited to assigned records. One counsellor per student; the Manager oversees everyone.
 */
type Level = 'F' | 'E' | 'V' | '-';
export type ClientRole = 'admin' | 'counsellor' | 'manager';

export const MATRIX: Record<string, Record<ClientRole, Level>> = {
  dashboard: { admin: 'F', counsellor: 'V', manager: 'V' },
  leads: { admin: 'F', counsellor: 'E', manager: 'F' },
  convert: { admin: 'F', counsellor: 'E', manager: 'E' },
  profile: { admin: 'F', counsellor: 'E', manager: 'E' },
  shortlist: { admin: 'F', counsellor: 'E', manager: 'E' },
  applications: { admin: 'F', counsellor: 'E', manager: 'E' },
  documents: { admin: 'F', counsellor: 'E', manager: 'E' },
  fees: { admin: 'F', counsellor: 'E', manager: 'E' },
  visa: { admin: 'F', counsellor: 'E', manager: 'E' },
  tasks: { admin: 'F', counsellor: 'E', manager: 'F' },
  comments: { admin: 'F', counsellor: 'E', manager: 'E' },
  emails: { admin: 'V', counsellor: 'V', manager: 'V' },
  assign: { admin: 'F', counsellor: '-', manager: 'F' },
  users: { admin: 'F', counsellor: '-', manager: '-' },
  masters: { admin: 'F', counsellor: 'V', manager: 'V' },
  templates: { admin: 'F', counsellor: '-', manager: '-' },
  audit: { admin: 'V', counsellor: '-', manager: 'V' },
  export: { admin: 'F', counsellor: '-', manager: 'F' },
};
const ACTIONS: Record<Level, string[]> = { F: ['view', 'add', 'edit', 'delete'], E: ['view', 'add', 'edit'], V: ['view'], '-': [] };

export const clientRole = (role: string): ClientRole => (role === 'admin' || role === 'manager' ? role : 'counsellor');

/** Only staff hold anything in this matrix: a portal login (student, university) holds nothing, whatever the route. */
const isStaff = (role: string) => role === 'admin' || role === 'manager' || role === 'counsellor';
export const can = (role: string, module: string, action = 'view') =>
  isStaff(role) && ACTIONS[MATRIX[module]?.[clientRole(role)] ?? '-'].includes(action);

/** `perms` as the client's front end reads it: { module: ['view', 'add', ...] }. */
export const permsFor = (role: string) =>
  Object.fromEntries(Object.keys(MATRIX).map((m) => [m, isStaff(role) ? ACTIONS[MATRIX[m][clientRole(role)]] : []]));

export const ROLE_NAMES: Record<ClientRole, string> = { admin: 'Admin', counsellor: 'Counsellor', manager: 'Manager' };
