import type { AuthRequest } from '../middleware/auth';
import User from '../models/User';
import { Setting, getSetting, setSetting } from '../models/Audit';
import { HttpError } from './crm';

/** The Admin console's permission rules and settings registry (legacy/server/admin5/perm.js, registry.js). */

// ---------- console modules and the default role matrix (Admin doc 2.3) ----------
export const AD_MODULES: [string, string][] = [['roles', 'Roles and role builder'], ['users', 'Users, branches, teams'], ['assignment', 'Assignment rules, bulk transfer'], ['duplicates', 'Duplicate merge centre'],
  ['universities', 'Universities, university agreements'], ['catalogue', 'Course catalogue, import, approvals'], ['reconciliation', 'Reconciliation'], ['fees', 'Service fees, discounts, refunds'],
  ['templates', 'Email templates, triggers, senders'], ['channels', 'SMS / WhatsApp settings'], ['checklists', 'Checklists, Drive rule, masters'], ['reports', 'Reports and dashboards'],
  ['audit', 'Audit log'], ['privacy', 'Privacy requests'], ['security', 'Security settings, backups'], ['settings', 'System settings'], ['company', 'Company legal details and bank'],
  ['announcements', 'Announcements, support tickets']];
export const ACTIONS = ['view', 'add', 'edit', 'delete', 'export', 'approve'];
const L: Record<string, string[]> = { F: ['view', 'add', 'edit', 'delete', 'export'], FA: ['view', 'add', 'edit', 'delete', 'export', 'approve'], E: ['view', 'add', 'edit'], EA: ['view', 'add', 'edit', 'approve'], V: ['view'], '-': [] };
export const DEFAULTS: Record<string, Record<string, string>> = {
  admin: { roles: 'V', users: 'E', assignment: 'F', duplicates: 'F', universities: 'F', catalogue: 'FA', reconciliation: '-', fees: 'EA', templates: 'E', channels: 'V', checklists: 'F',
    reports: 'F', audit: 'V', privacy: 'E', security: '-', settings: 'E', company: 'V', announcements: 'F' },
  manager: { universities: 'V', catalogue: 'V', reports: 'V', audit: 'V', duplicates: 'V', announcements: 'V' },
  counsellor: { universities: 'V', catalogue: 'V', fees: 'E', duplicates: 'V', announcements: 'V' },
};
const FIN = new Set(['reconciliation']);

/** Role builder overrides: { role: { module: [actions] } }, kept in one setting and cached. */
let overrides: Record<string, Record<string, string[]>> | null = null;
export async function loadRoleOverrides() {
  try { overrides = JSON.parse(String((await getSetting('console_role_perms')) ?? '{}')); } catch { overrides = {}; }
  return overrides!;
}
export async function saveRoleOverrides(o: Record<string, Record<string, string[]>>, userId: string) {
  await setSetting('console_role_perms', JSON.stringify(o), userId);
  overrides = o;
}
export const consoleActions = (role: string, m: string) => overrides?.[role]?.[m] ?? L[DEFAULTS[role]?.[m] ?? '-'];

// ---------- Super Admin: at least one; the first active Admin becomes it ----------
let superChecked = 0;
async function ensureSuper() {
  if (Date.now() - superChecked < 60_000) return;
  superChecked = Date.now();
  if (await User.exists({ is_super_admin: true, isActive: true })) return;
  const first = await User.findOne({ role: 'admin', isActive: true }).sort({ createdAt: 1 });
  if (first) { first.set({ is_super_admin: true, signing_authority: true, finance: true }); await first.save(); }
}
export async function isSuper(req: AuthRequest) {
  await ensureSuper();
  return !!(await User.findById(req.user!.id).select('is_super_admin').lean())?.is_super_admin;
}
export async function can(req: AuthRequest, m: string, action = 'view') {
  if (await isSuper(req)) return true;
  if (FIN.has(m) && req.user!.role === 'admin' && !(await User.findById(req.user!.id).select('finance').lean())?.finance) return false;
  if (!overrides) await loadRoleOverrides();
  return consoleActions(req.user!.role, m).includes(action);
}
export async function need(req: AuthRequest, m: string, action = 'view') { if (!(await can(req, m, action))) throw new HttpError(403, 'Your role does not allow this'); }
export async function needSuper(req: AuthRequest) { if (!(await isSuper(req))) throw new HttpError(403, 'Only a Super Admin can do this'); }

// ---------- settings registry (Admin doc section 16): every setting with default, range, source and group ----------
type Reg = { key: string; label: string; group: string; def: string; source: string; type: 'bool' | 'number' | 'text' | 'select'; min?: number; max?: number; opts?: [string, string][]; fixed?: boolean; pattern?: RegExp; step?: number };
export const GROUPS = [['general', 'General and company'], ['sessions', 'Sessions and login'], ['student', 'Student portal'], ['university', 'University portal'],
  ['notifications', 'Notifications and email'], ['files', 'Files, storage and catalogue'], ['finance', 'Finance placeholders'], ['privacy', 'Retention and privacy'], ['security', 'Security (Super Admin)']];
const B = (key: string, label: string, group: string, def: unknown, source: string, x: Partial<Reg> = {}): Reg => ({ key, label, group, def: String(def), source, type: 'bool', ...x });
const N = (key: string, label: string, group: string, def: unknown, min: number, max: number, source: string, x: Partial<Reg> = {}): Reg => ({ key, label, group, def: String(def), min, max, source, type: 'number', ...x });
const T = (key: string, label: string, group: string, def: unknown, source: string, x: Partial<Reg> = {}): Reg => ({ key, label, group, def: String(def), source, type: 'text', ...x });
const S = (key: string, label: string, group: string, def: unknown, opts: [string, string][], source: string): Reg => ({ key, label, group, def: String(def), opts, source, type: 'select' });
export const LIST: Reg[] = [
  T('company_legal_name', 'Company legal name (fixed)', 'general', 'Euroverse Service LLP', 'All docs', { fixed: true }), T('company_trading_name', 'Trading name (fixed)', 'general', 'La Europa Education', 'All docs', { fixed: true }),
  T('company_llpin', 'LLPIN', 'general', 'ACY-5677', 'All docs'), T('company_address', 'Registered address', 'general', '', 'CD 14.6'), T('company_gstin', 'GSTIN', 'general', '', 'UD 10.5'),
  T('company_pan', 'PAN', 'general', '', 'UD 10.5'), T('company_signatory', 'Authorised signatory', 'general', 'Ankit Vasani', 'AD-D8'), T('company_signatory_designation', 'Signatory designation', 'general', 'CEO', 'AD-D8'),
  T('invoice_prefix_university', 'University invoice prefix', 'general', 'LE-INV', 'UD 10.5'), T('invoice_prefix_credit', 'Credit note prefix', 'general', 'LE-CN', 'UD 10.5'), T('receipt_prefix', 'Service fee receipt prefix', 'general', 'LE-RCPT', 'CD 9'),
  T('time_zone', 'Time zone (fixed)', 'general', 'Asia/Kolkata (IST); stored in UTC', 'All', { fixed: true }), T('financial_year', 'Financial year (fixed)', 'general', 'April to March', 'SAD 11.4', { fixed: true }),
  T('date_format', 'Date format (fixed)', 'general', 'DD/MM/YYYY', 'All', { fixed: true }),
  N('session_timeout_min', 'Counsellor side idle timeout (minutes)', 'sessions', 30, 15, 120, 'CD 2'), N('portal_idle_min', 'Student portal idle timeout (minutes)', 'sessions', 60, 15, 240, 'SD 2.10'),
  B('portal_enabled', 'Student portal on', 'student', 1, 'SD 18.6'), B('portal_signup', 'Self sign-up', 'student', 1, 'SD 2'), B('auto_invite', 'Auto-invite on convert', 'student', 1, 'SD 2.5'),
  N('portal_invite_days', 'Invite link validity (days)', 'student', 7, 1, 30, 'SD 2.5'), N('req_open_limit', 'Max open Apply Now requests per student', 'student', 5, 1, 20, 'SD 7.5'),
  N('req_intake_limit', 'Max requests per intake', 'student', 10, 1, 50, 'SD 7.5'), N('request_review_days', 'Apply Now review task due (working days)', 'student', 2, 1, 10, 'SD 7.6'),
  B('show_team_to_student', 'Show team to student', 'student', 0, 'SD 4.2'), B('share_offer_auto', 'Share offer letters automatically', 'student', 0, 'SD 8.4'), B('referral_enabled', 'Referral', 'student', 0, 'SD 16'),
  T('office_hours_text', 'Office hours text', 'student', 'Monday to Saturday, 10:00 AM to 6:00 PM IST', 'SD 13.5'), N('cgpa_factor', 'CGPA to % conversion factor', 'student', 9.5, 1, 20, 'SD 5.7', { step: 0.1 }),
  T('payment_reminder_days', 'Payment reminder days before due', 'student', '7,3,1', 'SD 10.5', { pattern: /^\d+(,\d+)*$/ }),
  N('batching_window_min', 'Email batching window (minutes)', 'notifications', 2, 0, 10, 'CD 13.2'), B('parent_cc_enabled', 'Parent email in CC per student', 'notifications', 0, 'CD 13.5'),
  B('attach_offer_letter', 'Attach offer letter to E07', 'notifications', 0, 'CD 13.5'), B('show_passport_last4', 'Show last 4 passport characters in templates', 'notifications', 0, 'CD 13.6.3'),
  N('unread_email_minutes', 'Unread message emails after (minutes)', 'notifications', 15, 5, 240, 'SD 14.3'), T('digest_time', 'Daily digests time (IST)', 'notifications', '09:00', 'UD 12.4', { pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }),
  N('email_failure_alert_percent', 'Alert when email failures in 1 hour above (%)', 'notifications', 5, 1, 100, 'Admin 10.6'), N('approvals_sla_days', 'Approvals SLA (working days)', 'notifications', 2, 1, 10, 'Admin 6.6'),
  N('max_file_mb', 'Max file size (MB)', 'files', 10, 1, 25, 'CD 8'), N('course_verify_months', 'Course "last verified" reminder (months)', 'files', 6, 1, 24, 'SD 5.2'),
  B('publish_imported', 'Publish imported courses directly', 'files', 0, 'Admin 6.3'), N('import_max_rows', 'Course import max rows per file', 'files', 1000, 10, 5000, 'Admin 6.3'),
  S('rounding', 'Rounding', 'finance', 'rupee', [['rupee', 'Nearest rupee'], ['paise', '2 decimals']], 'Admin 8.6'),
  N('discount_limit_inr', 'Default discount limit for counsellors (INR)', 'finance', 10000, 0, 1000000, 'CD 9.4'), N('payment_edit_hours', 'Payment edit window (hours)', 'finance', 48, 1, 720, 'CD 9.4'),
  N('audit_years', 'Keep audit log (years, minimum 3)', 'privacy', 3, 3, 20, 'CD 14.5'), N('retention_notifications_days', 'In-app notifications (days)', 'privacy', 180, 30, 3650, 'Admin 14.4'),
  N('retention_deleted_days', 'Deleted student accounts kept (days)', 'privacy', 30, 0, 3650, 'SD 15.5'), N('privacy_sla_days', 'Privacy request SLA (days)', 'privacy', 30, 1, 90, 'Admin 14.2'),
  T('login_rule', 'Login rule, all portals (fixed): no 2FA; email code only on the first login; forgot password by email code', 'security', 'On', 'La Europa Nov 2026', { fixed: true }),
  N('lockout_attempts', 'Lockout after wrong attempts', 'security', 5, 3, 10, 'CD 2'), N('lockout_minutes', 'Lockout minutes', 'security', 15, 5, 60, 'CD 2'),
  B('new_device_alert', 'New device login alert', 'security', 1, 'SD 2'),
];
export const BY = Object.fromEntries(LIST.map((s) => [s.key, s]));
export const FIXED: [string, string][] = [
  ['Every email to a student, university user or staff is sent with CC laeuropaapplication@gmail.com. Only security emails (codes, reset links) go without CC (AD-D1).', 'CD 13.1, SD 14.2, UD 12.2'],
  ["All emails about one student stay in that student's single thread (fixed subject and threading headers).", 'CD 13.4'],
  ['A student\'s "Apply Now" goes to La Europa\'s backend, never to a university.', 'SD 7'],
  ['Fee cells never contain the words non-EU, foreign or international. Course links point to the university\'s own programme page.', 'SD 5, UD 4'],
  ['No upstream partner, aggregator or application channel name is shown to students or universities.', 'UD 1.9'],
  ['Marital status and budget are never shared with universities.', 'UD 1.9'],
  ['Universities never contact students and students never contact universities through the system.', 'UD 1.1'],
  ['The audit log is append-only; nobody, including Super Admin, can edit or delete it.', 'CD 14.5'],
  ['Agreements and invoices are issued in the name of Euroverse Service LLP, trading as La Europa Education.', 'UD 2.1'],
];
export async function regVal(k: string) {
  const v = await getSetting(k);
  return v === undefined || v === null || v === '' ? BY[k]?.def ?? v : String(v);
}
export function regCheck(s: Reg, v: unknown) {
  if (s.fixed) return 'This is a fixed rule';
  if (s.type === 'number') { const n = Number(v); if (v === '' || isNaN(n)) return 'Enter a number'; if (n < s.min! || n > s.max!) return `Between ${s.min} and ${s.max}`; }
  if (s.type === 'bool' && !['0', '1', 0, 1, true, false].includes(v as never)) return 'On or Off';
  if (s.type === 'select' && !s.opts!.some((o) => o[0] === String(v))) return 'Choose a value from the list';
  if (s.type === 'text' && s.pattern && v && !s.pattern.test(String(v))) return 'Invalid format';
  return null;
}
export const regSet = (k: string, v: unknown, by: string) => setSetting(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v), by);
export const lastChange = (k: string) => Setting.findOne({ key: k }).select('updated_by updatedAt').lean();
