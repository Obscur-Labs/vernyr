import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import ExcelJS from 'exceljs';
import { authenticate, type AuthRequest } from '../middleware/auth';
import User from '../models/User';
import Student from '../models/Student';
import Lead from '../models/Lead';
import Task from '../models/Task';
import University from '../models/University';
import Course from '../models/Course';
import { Country, Intake, MasterItem } from '../models/Master';
import { Application, ChecklistItem, VisaCase } from '../models/Work';
import { AuditLog, audit, allSettings, setSetting, DEFAULT_SETTINGS } from '../models/Audit';
import { nextStaffCode } from '../models/Timeline';
import { USERNAME_RE } from '../models/accountFields';
import { HttpError, bad, fieldErr, forbidden, handle, isAdmin, oid, clean, num, isEmail, normPhone, istDate, istDayStart, addDays, timeline, userNames, nameIn, fullName, maskPassport, fmtDateTime } from '../services/crm';
import { passportOf, overallStage } from '../services/students';
import { notify } from '../services/tasks';
import { stageList } from '../services/masters';
import { passwordProblem } from '../services/passwords';
import { invalidateUser } from '../services/access';
import { credentialConflict } from '../services/accounts';
import { mailReady, sendMail } from '../services/mailer';
import { env } from '../config/env';

/** The client's minimum Admin (Section 14) + Export (15.3) (legacy/server/routes/admin.js). Manager: reports and exports only. */
const router = Router();
router.use(authenticate);
router.use((req: AuthRequest, _res, next) => (isAdmin(req) || (req.user!.role === 'manager' && /^\/(reports|export\/)/.test(req.path)) ? next() : next(new HttpError(403, 'You do not have access to this record'))));

const ROLES = [{ code: 'admin', name: 'Admin' }, { code: 'counsellor', name: 'Counsellor' }, { code: 'manager', name: 'Manager' }];
const json = (o: unknown) => JSON.parse(JSON.stringify(o)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const withId = (o: Record<string, unknown>) => ({ ...o, id: String(o._id), _id: undefined, __v: undefined, created_at: o.createdAt, updated_at: o.updatedAt });

// ---------- users (staff log in with a username + password set by the Admin) ----------
router.get('/users', handle(async (_req, res) => {
  const users = await User.find().sort({ name: 1 }).lean();
  const names = await userNames();
  res.json(await Promise.all(users.map(async (u) => ({
    id: String(u._id), name: u.name, username: u.username ?? null, staff_code: u.staff_code ?? null, is_super_admin: false, email: u.email ?? '', mobile: u.phone ?? null,
    designation: u.designation ?? null, status: u.isActive === false ? 'inactive' : 'active', last_login_at: u.lastSeenAt ?? null, reports_to: u.reports_to ? String(u.reports_to) : null,
    reports_to_name: nameIn(names, u.reports_to), locked_until: u.lockedUntil ?? null, created_at: u.createdAt, role: u.role, role_name: ROLES.find((r) => r.code === u.role)?.name ?? u.role,
    students: await Student.countDocuments({ is_deleted: false, primary_counsellor_id: u._id }),
    leads: await Lead.countDocuments({ is_deleted: false, assigned_user_id: u._id, status: { $ne: 'Converted' } }),
    open_tasks: await Task.countDocuments({ is_deleted: false, assigned_to: u._id, status: { $in: ['Open', 'In progress'] } }),
    locked: !!(u.lockedUntil && u.lockedUntil > new Date()),
  }))));
}));
router.get('/roles', (_req, res) => res.json(ROLES.map((r) => ({ id: r.code, ...r }))));

async function userValidate(b: Record<string, any>, id?: unknown) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {};
  if (!clean(b.name)) errors.name = 'Full name is required';
  const un = String(b.username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(un)) errors.username = '3 to 32 characters: small letters, numbers, dot, dash or underscore';
  const em = String(b.email || '').trim().toLowerCase();
  if (em && !isEmail(em)) errors.email = 'Enter a valid email or leave it empty';
  if (!b.mobile || (normPhone(b.mobile) || '').length < 10) errors.mobile = 'Mobile is required';
  if (!ROLES.some((r) => r.code === b.role)) errors.role = 'Role is required';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const conflict = await credentialConflict({ username: un, email: em || undefined }, id ? String(id) : undefined);
  if (conflict) throw bad(conflict, { errors: { [/email/i.test(conflict) ? 'email' : 'username']: conflict } });
}

router.post('/users', handle(async (req, res) => {
  const b = req.body ?? {};
  await userValidate(b);
  const problem = passwordProblem(String(b.password || ''), 'staff', [b.username, b.email, b.name]);
  if (problem) throw bad('Please fix the highlighted fields', { errors: { password: problem } });
  const staff_code = await nextStaffCode(b.role === 'counsellor');
  const u = await User.create({ name: clean(b.name, 100), username: String(b.username).trim().toLowerCase(), email: clean(b.email, 150)?.toLowerCase(), phone: clean(b.mobile, 20),
    role: b.role, designation: clean(b.designation, 100), reports_to: oid(b.reports_to) ?? undefined, password: String(b.password), staff_code, emailVerifiedAt: new Date() });
  await audit(req, 'Create', 'User', u._id, `${u.username} (${staff_code})`, null, { name: u.name, role: b.role, staff_code });
  res.json({ id: String(u._id), username: u.username, staff_code });
}));
router.put('/users/:id', handle(async (req, res) => {
  const u = oid(req.params.id) && (await User.findById(oid(req.params.id)));
  if (!u) throw new HttpError(404, 'User not found');
  const b = { name: u.name, username: u.username, email: u.email, mobile: u.phone, role: u.role, designation: u.designation, reports_to: u.reports_to ? String(u.reports_to) : '', ...req.body };
  await userValidate(b, u._id);
  if (String(u._id) === req.user!.id && b.role !== 'admin') throw bad('You cannot remove your own Admin role');
  const before = { name: u.name, email: u.email, role: u.role };
  const roleChanged = u.role !== b.role;
  u.set({ name: clean(b.name, 100), username: String(b.username).trim().toLowerCase(), email: clean(b.email, 150)?.toLowerCase(), phone: clean(b.mobile, 20), role: b.role,
    designation: clean(b.designation, 100), reports_to: oid(b.reports_to) ?? undefined, ...(roleChanged ? { passwordChangedAt: new Date() } : {}) });
  await u.save();
  invalidateUser(String(u._id));
  await audit(req, 'Update', 'User', u._id, u.username, before, { name: u.name, email: u.email, role: u.role });
  res.json({ ok: true });
}));
async function workload(id: Types.ObjectId) {
  return {
    primary: await Student.countDocuments({ is_deleted: false, primary_counsellor_id: id }), application: 0, visa: 0,
    leads: await Lead.countDocuments({ is_deleted: false, assigned_user_id: id, status: { $ne: 'Converted' } }),
    tasks: await Task.countDocuments({ is_deleted: false, assigned_to: id, status: { $in: ['Open', 'In progress'] } }),
  };
}
router.get('/users/:id/workload', handle(async (req, res) => { res.json(await workload(oid(req.params.id)!)); }));
// deactivation forces the transfer of students, leads and open tasks (14.1)
router.post('/users/:id/deactivate', handle(async (req, res) => {
  const u = oid(req.params.id) && (await User.findById(oid(req.params.id)));
  if (!u) throw new HttpError(404, 'User not found');
  if (String(u._id) === req.user!.id) throw bad('You cannot deactivate yourself');
  const b = req.body ?? {};
  const need = await workload(u._id as Types.ObjectId);
  if (u.role === 'admin' && !(await User.exists({ role: 'admin', isActive: true, _id: { $ne: u._id } }))) throw bad('This is the last active Admin. Make another user an Admin first.');
  const errors: Record<string, string> = {};
  for (const [k, label] of [['primary', 'student(s) as counsellor'], ['leads', 'lead(s)'], ['tasks', 'open task(s)']] as const) {
    if (need[k] && (!oid(b[`to_${k}`]) || b[`to_${k}`] === String(u._id))) errors[`to_${k}`] = `Select who takes over ${need[k]} ${label}`;
  }
  if (Object.keys(errors).length) throw bad('Transfer all students, leads and open tasks before deactivating', { errors, need });
  const reason = clean(b.reason, 300) || `User ${u.name} deactivated`;
  const names = await userNames();
  if (need.primary) {
    const to = oid(b.to_primary)!;
    for (const s of await Student.find({ is_deleted: false, primary_counsellor_id: u._id })) {
      await Student.updateOne({ _id: s._id }, { primary_counsellor_id: to, $push: { assignment_history: { role_type: 'primary', from_user_id: u._id, to_user_id: to, reason, changed_by: req.user!.id } } });
      await Application.updateMany({ student_id: s._id, is_deleted: false }, { handled_by: to });
      await timeline({ student_id: s._id, type: 'profile', description: `Counsellor changed from ${u.name} to ${nameIn(names, to)} (${reason})`, user_id: req.user!.id });
    }
    await notify(to, 'assigned', `${need.primary} student(s) transferred to you from ${u.name}`, '/students');
  }
  if (need.leads) {
    const to = oid(b.to_leads)!;
    for (const l of await Lead.find({ is_deleted: false, assigned_user_id: u._id, status: { $ne: 'Converted' } }).select('_id')) {
      await Lead.updateOne({ _id: l._id }, { assigned_user_id: to });
      await timeline({ lead_id: l._id, type: 'lead', description: `Lead transferred to ${nameIn(names, to)} (${reason})`, user_id: req.user!.id });
    }
    await notify(to, 'assigned', `${need.leads} lead(s) transferred to you from ${u.name}`, '/leads');
  }
  if (need.tasks) {
    await Task.updateMany({ is_deleted: false, assigned_to: u._id, status: { $in: ['Open', 'In progress'] } }, { assigned_to: oid(b.to_tasks) });
    await notify(oid(b.to_tasks), 'task_assigned', `${need.tasks} open task(s) transferred to you from ${u.name}`, '/tasks');
  }
  u.set({ isActive: false, passwordChangedAt: new Date() }); await u.save();
  invalidateUser(String(u._id));
  await audit(req, 'Update', 'User', u._id, u.username, { status: 'active' }, { status: 'inactive', transfers: need });
  res.json({ ok: true, transferred: need });
}));
router.post('/users/:id/activate', handle(async (req, res) => {
  await User.updateOne({ _id: oid(req.params.id) }, { isActive: true, $unset: { lockedUntil: 1 } });
  invalidateUser(req.params.id);
  await audit(req, 'Update', 'User', req.params.id, 'Activated', { status: 'inactive' }, { status: 'active' });
  res.json({ ok: true });
}));
// the Admin sets the new password (staff need no email); the user is signed out everywhere
router.post('/users/:id/reset-password', handle(async (req, res) => {
  const u = oid(req.params.id) && (await User.findById(oid(req.params.id)).select('+password'));
  if (!u) throw new HttpError(404, 'User not found');
  const pw = String(req.body?.password || '');
  const problem = passwordProblem(pw, 'staff', [u.username, u.email, u.name]);
  if (problem) throw bad(problem, { errors: { password: problem } });
  u.set({ password: pw, passwordChangedAt: new Date(), failedLogins: 0 }); u.lockedUntil = undefined; await u.save();
  invalidateUser(String(u._id));
  await audit(req, 'Update', 'User', u._id, u.username, null, { password_set_by_admin: true });
  res.json({ ok: true });
}));
router.post('/users/:id/force-logout', handle(async (req, res) => {
  await User.updateOne({ _id: oid(req.params.id) }, { passwordChangedAt: new Date() });
  invalidateUser(req.params.id);
  await audit(req, 'Update', 'User', req.params.id, 'Force logout');
  res.json({ ok: true });
}));
router.post('/users/:id/unlock', handle(async (req, res) => {
  await User.updateOne({ _id: oid(req.params.id) }, { failedLogins: 0, $unset: { lockedUntil: 1 } });
  await audit(req, 'Update', 'User', req.params.id, 'Unlocked');
  res.json({ ok: true });
}));

// ---------- masters (never hard-deleted: Inactive instead, 14.3) ----------
const GENERIC = ['lead_source', 'sub_agent', 'document_type', 'not_interested_reason', 'doc_rejection_reason', 'service_package', 'payment_mode', 'currency', 'board',
  'test_type', 'app_channel', 'visa_type', 'indian_state', 'app_stage', 'visa_stage', 'language', 'field_of_study'];
router.get('/masters/:type', handle(async (req, res) => {
  const t = req.params.type;
  if (t === 'countries') { res.json((await Country.find().sort({ sort: 1, name: 1 }).lean()).map((c) => withId(json(c)))); return; }
  if (t === 'intakes') { res.json((await Intake.find().sort({ year: 1, month: 1 }).lean()).map((c) => withId(json(c)))); return; }
  if (t === 'universities') {
    const countries = await Country.find().lean();
    res.json((await University.find().sort({ name: 1 }).lean()).map((u) => ({ ...withId(json(u)), country_id: countries.find((c) => c.name === u.country)?._id ?? null, active: u.isActive !== false, approved: true })));
    return;
  }
  if (t === 'courses') {
    res.json((await Course.find().sort({ name: 1 }).lean()).map((c) => ({ ...withId(json(c)), university: c.universityName, university_id: String(c.university), active: c.isActive !== false, approved: true,
      tuition_fee: c.tuition?.amount ?? null, currency: c.tuition?.currency ?? null, course_link: c.link ?? null })));
    return;
  }
  if (t === 'checklists') {
    const [items, countries, types] = await Promise.all([ChecklistItem.find({ is_deleted: false }).sort({ country_id: 1, sort: 1 }).lean(), Country.find().lean(), MasterItem.find({ type: 'document_type' }).lean()]);
    res.json(items.map((c) => ({ ...withId(json(c)), country: c.country_id ? countries.find((x) => String(x._id) === String(c.country_id))?.name : 'All countries',
      document_type: types.find((x) => String(x._id) === String(c.document_type_id))?.name })));
    return;
  }
  if (!GENERIC.includes(t)) throw bad('Unknown master');
  const rows = await MasterItem.find({ type: t }).sort({ sort: 1, name: 1 }).lean();
  res.json(await Promise.all(rows.map(async (m) => ({ ...withId(json(m)), ...(m.data ?? {}), data: undefined,
    in_use: t === 'app_stage' ? await Application.countDocuments({ stage: m.code, is_deleted: false }) : t === 'visa_stage' ? await VisaCase.countDocuments({ stage: m.code, is_deleted: false }) : undefined }))));
}));
async function masterSave(req: AuthRequest, t: string, id: string | null, b: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const active = b.active === undefined ? true : !!b.active && b.active !== '0';
  if (t === 'countries') {
    if (!clean(b.name)) throw fieldErr('name', 'Name is required');
    const f = { name: clean(b.name, 80), code: clean(b.code, 3), active, dependant_visa: ['Yes', 'No', 'Depends'].includes(b.dependant_visa) ? b.dependant_visa : 'No',
      dependant_notes: clean(b.dependant_notes, 500), currency: b.currency || 'EUR', aps_required: !!b.aps_required, channels: b.channels || [], sort: num(b.sort) || 0 };
    return id ? (await Country.updateOne({ _id: oid(id) }, f), id) : String((await Country.create(f))._id);
  }
  if (t === 'universities') {
    if (!clean(b.name) || !oid(b.country_id)) throw bad('Name and country are required');
    const country = await Country.findById(oid(b.country_id)).lean();
    const name = clean(b.name, 150)!;
    const f = { name, country: country?.name, city: clean(b.city, 80), website: clean(b.website, 300), type: ['public', 'private'].includes(b.type) ? b.type : 'unknown', isActive: active,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') };
    return id ? (await University.updateOne({ _id: oid(id) }, f), id) : String((await University.create(f))._id);
  }
  if (t === 'courses') {
    if (!clean(b.name) || !oid(b.university_id)) throw bad('Course name and university are required');
    if (b.course_link && !/^https?:\/\//.test(b.course_link)) throw fieldErr('course_link', 'Must start with http:// or https://');
    const u = await University.findById(oid(b.university_id)).lean();
    if (!u) throw fieldErr('university_id', 'University not found');
    const f = { name: clean(b.name, 150), university: u._id, universityName: u.name, country: u.country, level: b.level || 'other', discipline: clean(b.field, 100),
      duration: { text: clean(b.duration, 50) }, tuition: { amount: num(b.tuition_fee), currency: b.currency || 'EUR' }, applicationFee: { amount: num(b.application_fee), currency: b.currency || 'EUR' },
      link: clean(b.course_link, 500), intakes: b.intakes || [], isActive: active };
    return id ? (await Course.updateOne({ _id: oid(id) }, f), id) : String((await Course.create(f))._id);
  }
  if (t === 'intakes') {
    if (!clean(b.name) || !num(b.month) || !num(b.year)) throw bad('Name, month and year are required');
    const f = { name: clean(b.name, 30), month: num(b.month), year: num(b.year), active };
    return id ? (await Intake.updateOne({ _id: oid(id) }, f), id) : String((await Intake.create(f))._id);
  }
  if (t === 'checklists') {
    if (!oid(b.document_type_id)) throw fieldErr('document_type_id', 'Document type is required');
    const f = { country_id: oid(b.country_id) ?? undefined, level: b.level || undefined, document_type_id: oid(b.document_type_id), required: b.required || 'Yes', sort: num(b.sort) || 0, active,
      visible_student: b.visible_student !== false, note: clean(b.note, 300), applies_existing: b.applies_existing !== false };
    return id ? (await ChecklistItem.updateOne({ _id: oid(id) }, f), id) : String((await ChecklistItem.create({ ...f, created_by: req.user!.id }))._id);
  }
  if (!GENERIC.includes(t)) throw bad('Unknown master');
  if (!clean(b.name)) throw fieldErr('name', 'Name is required');
  const { name, code, sort, ...rest } = b;
  for (const k of ['id', '_id', '__v', 'active', 'type', 'in_use', 'created_at', 'updated_at', 'createdAt', 'updatedAt', 'data']) delete rest[k];
  if (['app_stage', 'visa_stage'].includes(t)) {
    // stages are renamed, reordered or recoloured, never added (their codes drive the flow)
    if (!id) throw bad('New stages cannot be added; rename, reorder or recolour the existing ones');
    const ex = await MasterItem.findById(oid(id)).lean();
    await MasterItem.updateOne({ _id: oid(id) }, { name: clean(name, 60), sort: num(sort) ?? ex?.sort, active: true, data: { ...(ex?.data ?? {}), color: rest.color || (ex?.data as Record<string, unknown> | undefined)?.color } });
    return id;
  }
  const f = { type: t, name: clean(name, 150), code: clean(code, 40), sort: num(sort) || 0, active, data: rest };
  return id ? (await MasterItem.updateOne({ _id: oid(id) }, f), id) : String((await MasterItem.create(f))._id);
}
router.post('/masters/:type', handle(async (req, res) => {
  const id = await masterSave(req, req.params.type, null, req.body ?? {});
  await audit(req, 'Create', `Master:${req.params.type}`, id, req.body?.name || req.body?.document_type_id, null, req.body);
  res.json({ id });
}));
router.put('/masters/:type/:id', handle(async (req, res) => {
  if (!oid(req.params.id)) throw new HttpError(404, 'Not found');
  await masterSave(req, req.params.type, req.params.id, req.body ?? {});
  await audit(req, 'Update', `Master:${req.params.type}`, req.params.id, req.body?.name ?? '', null, req.body);
  res.json({ ok: true });
}));

// ---------- settings ----------
const HARD_CC = 'laeuropaapplication@gmail.com';
router.post('/mail/verify', handle(async (req, res) => {
  if (!mailReady()) { res.json({ ok: false, message: `Email is in ${env.mail.provider} mode: set MAIL_PROVIDER=smtp and SMTP_* on the server to send real email.` }); return; }
  let out = { ok: true, message: `Connected to ${env.mail.host}` };
  if (req.body?.send_to_me) {
    const me = await User.findById(req.user!.id).lean();
    if (!me?.email) out = { ok: false, message: 'Your account has no email address to send the test to.' };
    else try { await sendMail({ to: me.email, subject: 'La Europa CRM: SMTP test', text: 'If you can read this, the CRM can send email through your SMTP server.' }); out.message += `; test sent to ${me.email}`; }
    catch (e) { out = { ok: false, message: `Connected, but sending failed: ${(e as Error).message}` }; }
  }
  await audit(req, 'Setting change', 'Setting', 'smtp', 'SMTP connection test', null, { ok: out.ok });
  res.json(out);
}));
router.get('/settings', handle(async (_req, res) => {
  res.json({ ...(await allSettings()), hard_cc: HARD_CC, mail_provider: env.mail.provider, mail_redirect: env.mail.redirectTo ?? null, drive_connected: false });
}));
const SETTING_RULES: Record<string, (v: unknown) => true | string> = {
  session_timeout_min: (v) => (Number(v) >= 15 && Number(v) <= 120) || 'Between 15 and 120 minutes',
  portal_idle_min: (v) => (Number(v) >= 15 && Number(v) <= 240) || 'Between 15 and 240 minutes',
  aps_link: (v) => !v || /^https:\/\//.test(String(v)) || 'Must start with https://',
  batching_window_min: (v) => (Number(v) >= 0 && Number(v) <= 10) || 'Between 0 and 10 minutes',
  max_file_mb: (v) => (Number(v) >= 1 && Number(v) <= 25) || 'Between 1 and 25 MB',
  auto_assign_rule: (v) => ['none', 'round_robin', 'by_country'].includes(String(v)) || 'Invalid',
  folder_trigger: (v) => ['enrolment_confirmed', 'offer_accepted'].includes(String(v)) || 'Invalid',
  sending_address: (v) => isEmail(v) || 'Valid email required',
  discount_limit_inr: (v) => Number(v) >= 0 || 'Must be 0 or more',
};
for (const k of ['otp_enabled', 'otp_admin_only', 'drive_sync_enabled', 'parent_cc_enabled', 'attach_offer_letter', 'show_passport_last4']) SETTING_RULES[k] = (v) => ['0', '1'].includes(String(v)) || 'On / Off';
router.put('/settings', handle(async (req, res) => {
  const errors: Record<string, string> = {};
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (!allowed.has(k) || (/cc/i.test(k) && k !== 'parent_cc_enabled')) continue; // the student CC is not a setting
    const ok = SETTING_RULES[k]?.(v) ?? true;
    if (ok !== true) errors[k] = ok;
  }
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const old = await allSettings();
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (!allowed.has(k)) continue;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (String(old[k]) !== val) { await setSetting(k, val, req.user!.id); await audit(req, 'Setting change', 'Setting', k, k, { [k]: old[k] }, { [k]: v }); }
  }
  res.json({ ok: true });
}));

// ---------- audit log ----------
router.get('/audit', handle(async (req, res) => {
  const q = req.query as Record<string, string>;
  const f: Record<string, unknown> = {};
  if (oid(q.user)) f.user_id = oid(q.user);
  if (q.action) f.action = q.action;
  if (q.entity) f.entity_type = new RegExp(`^${q.entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: istDayStart(q.from) } : {}), ...(q.to ? { $lt: istDayStart(addDays(q.to, 1)) } : {}) };
  if (q.q) { const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ entity_label: rx }, { entity_id: rx }]; }
  const size = [25, 50, 100].includes(Number(q.size)) ? Number(q.size) : 50;
  const page = Math.max(1, Number(q.page) || 1);
  const [total, rows, names, actions] = await Promise.all([AuditLog.countDocuments(f), AuditLog.find(f).sort({ createdAt: -1 }).skip((page - 1) * size).limit(size).lean(), userNames(), AuditLog.distinct('action')]);
  res.json({ total, page, size, rows: rows.map((a) => ({ ...withId(json(a)), user_name: nameIn(names, a.user_id), old_value_json: a.old_value ?? null, new_value_json: a.new_value ?? null })), actions: actions.sort() });
}));

// ---------- reports ----------
router.get('/reports', handle(async (_req, res) => {
  const names = await userNames();
  const since = new Date(Date.now() - 864e5);
  const [withoutNotify, emails, byCounsellor, byStage, bySource, stages, sources] = await Promise.all([
    AuditLog.aggregate([{ $match: { action: 'Save without notifying' } }, { $group: { _id: '$user_id', c: { $sum: 1 } } }, { $sort: { c: -1 } }]),
    mongoose.connection.collection('emaillogs').aggregate([{ $match: { queued_at: { $gte: since } } }, { $group: { _id: '$status', c: { $sum: 1 } } }]).toArray(),
    Student.aggregate([{ $match: { is_deleted: false, status: { $ne: 'Archived' } } }, { $group: { _id: '$primary_counsellor_id', c: { $sum: 1 } } }]),
    Application.aggregate([{ $match: { is_deleted: false } }, { $group: { _id: '$stage', c: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { is_deleted: false } }, { $group: { _id: '$source_id', c: { $sum: 1 } } }]),
    stageList('app_stage'), MasterItem.find({ type: 'lead_source' }).lean(),
  ]);
  res.json({
    without_notify: withoutNotify.map((x) => ({ user: nameIn(names, x._id), count: x.c })),
    emails_24h: emails.map((x) => ({ status: x._id, c: x.c })),
    by_counsellor: byCounsellor.map((x) => ({ user: nameIn(names, x._id), students: x.c })),
    by_stage: byStage.map((x) => ({ stage: stages.find((s) => s.code === x._id)?.name ?? x._id, count: x.c })),
    leads_by_source: bySource.map((x) => ({ source: sources.find((s) => String(s._id) === String(x._id))?.name ?? '', count: x.c })),
  });
}));

// ---------- export to Excel (Admin / Manager, logged) ----------
router.get('/export/:entity', handle(async (req, res) => {
  const ent = req.params.entity;
  const sensitive = req.query.include_sensitive === '1' && isAdmin(req);
  const names = await userNames();
  const [countries, intakes, sources, unis, stages] = await Promise.all([Country.find().lean(), Intake.find().lean(), MasterItem.find({ type: 'lead_source' }).lean(), University.find().select('name').lean(), stageList('app_stage')]);
  const by = (arr: { _id: unknown; name: string }[], id: unknown) => arr.find((x) => String(x._id) === String(id))?.name ?? '';
  let rows: Record<string, unknown>[] = []; let cols: [string, string][] = [];
  if (ent === 'leads') {
    rows = (await Lead.find({ is_deleted: false, merged_into: null }).sort({ createdAt: -1 }).lean()).map((l) => ({ lead_code: l.lead_code, name: [l.first_name, l.last_name].filter(Boolean).join(' '),
      phone: `${l.country_code} ${l.phone}`, email: l.email, city: l.city, source: by(sources, l.source_id), countries: (l.interested_countries ?? []).map((c) => by(countries, c)).join(', '),
      intake: by(intakes, l.intake_id), status: l.status, next_followup_at: l.next_followup_at, counsellor: nameIn(names, l.assigned_user_id), created_at: l.createdAt }));
    cols = [['lead_code', 'Lead ID'], ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['city', 'City'], ['source', 'Source'], ['countries', 'Interested country'], ['intake', 'Intake'],
      ['status', 'Status'], ['next_followup_at', 'Next follow-up'], ['counsellor', 'Assigned counsellor'], ['created_at', 'Created on']];
  } else if (ent === 'students') {
    rows = await Promise.all((await Student.find({ is_deleted: false, status: { $ne: 'Archived' } }).sort({ updatedAt: -1 })).map(async (s) => ({ student_code: s.student_code, name: fullName(s),
      phone: `${s.country_code} ${s.phone ?? ''}`, email: s.email, passport: sensitive ? passportOf(s) ?? '' : maskPassport(passportOf(s)), stage: await overallStage(s._id as Types.ObjectId),
      status: s.status, countries: (s.prefs?.country_ids ?? []).map((c) => by(countries, c)).join(', '), intake: by(intakes, s.prefs?.intake_id), counsellor: nameIn(names, s.primary_counsellor_id),
      source: by(sources, s.source_id), updated_at: s.updatedAt })));
    cols = [['student_code', 'Student ID'], ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['passport', 'Passport'], ['stage', 'Stage'], ['status', 'Status'], ['countries', 'Countries'],
      ['intake', 'Intake'], ['counsellor', 'Counsellor'], ['source', 'Source'], ['updated_at', 'Last updated']];
  } else if (ent === 'applications') {
    const students = new Map((await Student.find().select('first_name middle_name last_name student_code primary_counsellor_id').lean()).map((s) => [String(s._id), s]));
    rows = (await Application.find({ is_deleted: false }).sort({ updatedAt: -1 }).lean()).map((a) => { const s = students.get(String(a.student_id));
      return { application_code: a.application_code, student_name: s ? fullName(s) : '', student_code: s?.student_code, country: by(countries, a.country_id), university: by(unis, a.university_id),
        course: a.course_name_text, intake: by(intakes, a.intake_id), stage_name: stages.find((x) => x.code === a.stage)?.name ?? a.stage, applied_date: a.applied_date,
        days_in_stage: Math.floor((Date.now() - +new Date(a.stage_changed_at)) / 864e5), counsellor: nameIn(names, s?.primary_counsellor_id) }; });
    cols = [['application_code', 'Application ID'], ['student_name', 'Student'], ['student_code', 'Student ID'], ['country', 'Country'], ['university', 'University'], ['course', 'Course'], ['intake', 'Intake'],
      ['stage_name', 'Stage'], ['applied_date', 'Applied date'], ['days_in_stage', 'Days in current stage'], ['counsellor', 'Counsellor']];
  } else throw bad('Unknown export');
  const pick = String(req.query.columns || '').split(',').filter(Boolean);
  if (pick.length) cols = cols.filter((c) => pick.includes(c[0]));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(ent);
  ws.columns = cols.map(([key, header]) => ({ key, header, width: Math.max(12, header.length + 4) }));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) ws.addRow(Object.fromEntries(cols.map(([k]) => [k, /_at$/.test(k) && row[k] ? fmtDateTime(row[k] as Date) : row[k]])));
  await audit(req, 'Export', ent, null, `${ent} export (${rows.length} rows${sensitive ? ', sensitive data included' : ''})`, null, { rows: rows.length, sensitive });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="la-europa-${ent}-${istDate()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

export default router;
