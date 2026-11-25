import crypto from 'crypto';
import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { authenticate, type AuthRequest } from '../middleware/auth';
import User from '../models/User';
import Student from '../models/Student';
import Lead from '../models/Lead';
import Task from '../models/Task';
import { Country, MasterItem } from '../models/Master';
import { Application, StudentDocument, Payment } from '../models/Work';
import { EmailLog } from '../models/Email';
import PortalAccount from '../models/PortalAccount';
import { audit } from '../models/Audit';
import { Branch, Team, AssignmentRule, AssignmentHistory, UnassignedQueue, DuplicateCase } from '../models/Console';
import { MATRIX, permsFor, ROLE_NAMES } from '../config/clientPerms';
import { bad, fieldErr, forbidden, notFound, handle, oid, clean, timeline, userNames, nameIn, fullName } from '../services/crm';
import { notify } from '../services/tasks';
import { invalidateUser } from '../services/access';
import { AD_MODULES, ACTIONS, DEFAULTS, isSuper, can, need, needSuper, consoleActions, loadRoleOverrides, saveRoleOverrides } from '../services/console';
import { APPLIES, pick, record, unavailable, activeCount, onLeave, teamMembers } from '../services/assign';
import { transfer } from './students';

/** Admin console people (legacy/server/admin5/people.js): roles, users, branches, teams, assignment rules, bulk transfer, duplicate merge centre. */
const router = Router();
router.use(authenticate);
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROLES = ['admin', 'manager', 'counsellor'] as const;

router.get('/console/me', handle(async (req, res) => {
  const me = await User.findById(req.user!.id).select('is_super_admin finance signing_authority discount_approver').lean();
  const modules: Record<string, string[]> = {};
  for (const [m] of AD_MODULES) { const acts = []; for (const a of ACTIONS) if (await can(req, m, a)) acts.push(a); modules[m] = acts; }
  res.json({ super_admin: await isSuper(req), modules, flags: { is_super_admin: !!me?.is_super_admin, finance: !!me?.finance, signing_authority: !!me?.signing_authority, discount_approver: !!me?.discount_approver }, stepup_until: null });
}));

// ---------- roles: the three fixed roles; the console grid of each is editable by a Super Admin ----------
async function roleOut(code: typeof ROLES[number]) {
  await loadRoleOverrides();
  const crm = permsFor(code);
  const consoleGrid = Object.fromEntries(AD_MODULES.map(([m]) => ['ad_' + m, consoleActions(code, m)]));
  return { id: code, code, name: ROLE_NAMES[code], description: { admin: 'Office manager: day-to-day control of the CRM', manager: 'Oversees all counsellors and students: sees every lead, student, application and visa, reports, and can reassign students. No admin settings.',
    counsellor: 'Handles the student from the first contact to enrolment: counselling, applications, offers and visa (assigned students)' }[code], is_system: true,
    data_scope: code === 'counsellor' ? 'own' : 'all', status: 'Active', sensitive: {}, limits: {}, based_on: null, users: await User.countDocuments({ role: code }), perms: { ...crm, ...consoleGrid } };
}
router.get('/console/roles', handle(async (req, res) => {
  await need(req, 'roles');
  res.json({ rows: await Promise.all(ROLES.map(roleOut)), ad_modules: AD_MODULES, crm_modules: Object.keys(MATRIX).map((m) => [m, m]), actions: ACTIONS, can_edit: await isSuper(req),
    note: 'The CRM permissions of each role are fixed (the client permission matrix); the Admin console grid can be changed here. Custom roles are not used.' });
}));
router.post('/console/roles', handle(async () => { throw bad('Custom roles are not used: give a person Admin, Manager or Counsellor, and change what the role may do in the console grid.'); }));
router.put('/console/roles/:id', handle(async (req, res) => {
  await needSuper(req);
  const code = req.params.id as typeof ROLES[number];
  if (!ROLES.includes(code)) throw notFound('Role');
  const old = await roleOut(code);
  const o = await loadRoleOverrides();
  const perms = (req.body?.perms ?? {}) as Record<string, string[]>;
  o[code] = Object.fromEntries(AD_MODULES.map(([m]) => [m, (perms['ad_' + m] ?? consoleActions(code, m)).filter((a) => ACTIONS.includes(a))]));
  await saveRoleOverrides(o, req.user!.id);
  await audit(req, 'Role change', 'Role', code, ROLE_NAMES[code], old.perms, (await roleOut(code)).perms);
  res.json({ ok: true });
}));
router.post('/console/roles/:id/reset', handle(async (req, res) => {
  await needSuper(req);
  const o = await loadRoleOverrides();
  delete o[req.params.id];
  await saveRoleOverrides(o, req.user!.id);
  await audit(req, 'Role change', 'Role', req.params.id, 'Console grid reset to the default');
  res.json({ ok: true, defaults: DEFAULTS[req.params.id] ?? {} });
}));
router.post('/console/roles/:id/preview', handle(async (req, res) => {
  await need(req, 'roles');
  const code = req.params.id as typeof ROLES[number];
  if (!ROLES.includes(code)) throw notFound('Role');
  const r = await roleOut(code);
  res.json({ name: r.name, data_scope: r.data_scope, console: AD_MODULES.filter(([m]) => consoleActions(code, m).includes('view')).map(([, l]) => l),
    crm: Object.entries(permsFor(code)).filter(([, a]) => a.includes('view')).map(([m]) => m), sample: r.data_scope === 'all' ? 'All students and leads' : 'Only records assigned to the user' });
}));

// ---------- users (the console side of Admin > Users); a normal Admin does not see a Super Admin ----------
router.get('/console/users', handle(async (req, res) => {
  await need(req, 'users');
  const sup = await isSuper(req);
  const [users, branches, teams] = await Promise.all([User.find(sup ? {} : { is_super_admin: { $ne: true } }).sort({ name: 1 }).lean(), Branch.find({ is_deleted: false }).sort({ name: 1 }).lean(), Team.find({ is_deleted: false }).sort({ name: 1 }).lean()]);
  res.json({
    rows: await Promise.all(users.map(async (u) => ({ id: String(u._id), name: u.name, email: u.email ?? null, mobile: u.phone ?? null, role_id: u.role, role_name: ROLE_NAMES[u.role as typeof ROLES[number]] ?? u.role, role_code: u.role,
      status: u.isActive ? 'active' : 'inactive', designation: u.designation ?? null, reports_to: u.reports_to ?? null, branch_id: u.branch_id ?? null, branch: branches.find((b) => String(b._id) === String(u.branch_id))?.name ?? null,
      team_id: u.team_id ?? null, team: teams.find((t) => String(t._id) === String(u.team_id))?.name ?? null, countries: u.countries ?? [], languages: u.languages ?? [], capacity: u.capacity ?? 0,
      active_load: await activeCount(u._id), leave: u.leave ?? [], on_leave: onLeave(u), super_admin: !!u.is_super_admin, signing_authority: !!u.signing_authority, finance: !!u.finance,
      discount_approver: !!u.discount_approver, last_login_at: u.lastSeenAt ?? null }))),
    roles: ROLES.map((r) => ({ id: r, name: ROLE_NAMES[r], code: r })), branches: branches.map((b) => ({ id: String(b._id), name: b.name })),
    teams: teams.map((t) => ({ id: String(t._id), name: t.name, branch_id: t.branch_id ?? null })),
    countries: (await Country.find().sort({ sort: 1, name: 1 }).select('name').lean()).map((c) => ({ id: String(c._id), name: c.name })), super: sup,
  });
}));
async function loadUser(req: AuthRequest) {
  const u = await User.findById(oid(req.params.id));
  if (!u || (u.is_super_admin && !(await isSuper(req)))) throw notFound('User');
  return u;
}
router.put('/console/users/:id/profile', handle(async (req, res) => {
  await need(req, 'users', 'edit');
  const u = await loadUser(req);
  const sup = await isSuper(req);
  const b = req.body ?? {};
  const before = u.toObject();
  if (b.role_id !== undefined) {
    if (!ROLES.includes(b.role_id)) throw fieldErr('role_id', 'Choose a role');
    if (String(u._id) === req.user!.id && b.role_id !== 'admin' && !sup) throw bad('You cannot remove your own Admin role');
    if (u.is_super_admin && b.role_id !== 'admin') throw bad('A Super Admin must keep the Admin role. Remove Super Admin first.');
    u.role = b.role_id;
  }
  if (b.branch_id !== undefined) u.branch_id = oid(b.branch_id) ?? undefined;
  if (b.team_id !== undefined) u.team_id = oid(b.team_id) ?? undefined;
  if (b.countries !== undefined) u.countries = (b.countries ?? []).map(String);
  if (b.languages !== undefined) u.languages = (b.languages ?? []).map((x: unknown) => clean(x, 30)).filter(Boolean);
  if (b.capacity !== undefined) u.capacity = Math.max(0, Math.min(5000, Number(b.capacity) || 0));
  if (b.leave !== undefined) {
    const lv = ((b.leave ?? []) as Any[]).filter((x) => x?.from && x?.to);
    if (lv.some((x) => x.to < x.from)) throw fieldErr('leave', 'Leave end date is before the start date');
    u.leave = lv.map((x) => ({ from: x.from, to: x.to, note: clean(x.note, 100) }));
  }
  for (const k of ['finance', 'discount_approver'] as const) if (b[k] !== undefined) u[k] = !!b[k];
  if (b.signing_authority !== undefined) { if (!sup) throw forbidden(); u.signing_authority = !!b.signing_authority; }
  await u.save();
  if (b.team_id !== undefined) {
    await Team.updateMany({ members: u._id }, { $pull: { members: u._id } });
    if (u.team_id) await Team.updateOne({ _id: u.team_id }, { $addToSet: { members: u._id } });
  }
  // a role change takes effect now: the next request reloads the account
  if (b.role_id !== undefined && before.role !== u.role) { u.passwordChangedAt = new Date(); await u.save(); }
  invalidateUser(String(u._id));
  await audit(req, 'Update', 'User', u._id, u.username ?? u.email ?? u.name, { role: before.role, capacity: before.capacity }, b);
  res.json({ ok: true });
}));
router.post('/console/users/:id/super', handle(async (req, res) => {
  await needSuper(req);
  const u = await loadUser(req);
  const on = !!req.body?.on;
  if (on && u.role !== 'admin') throw bad('Give the user the Admin role first');
  if (on && !u.isActive) throw bad('The user is inactive');
  if (!on && (await User.countDocuments({ is_super_admin: true, isActive: true, _id: { $ne: u._id } })) < 1) throw bad('At least one active Super Admin must always exist');
  u.is_super_admin = on; await u.save();
  invalidateUser(String(u._id));
  await audit(req, 'Role change', 'User', u._id, `${u.username ?? u.name}: Super Admin ${on ? 'on' : 'off'}`);
  res.json({ ok: true });
}));

// ---------- branches and teams ----------
router.get('/console/branches', handle(async (req, res) => {
  await need(req, 'users');
  const names = await userNames();
  const [branches, teams, users] = await Promise.all([Branch.find({ is_deleted: false }).sort({ name: 1 }).lean(), Team.find({ is_deleted: false }).sort({ name: 1 }).lean(), User.find({ isActive: true }).sort({ name: 1 }).select('name').lean()]);
  res.json({
    branches: await Promise.all(branches.map(async (b) => ({ ...b, id: String(b._id), _id: undefined, manager: nameIn(names, b.manager_id), users: await User.countDocuments({ branch_id: b._id, isActive: true }) }))),
    teams: teams.map((t) => ({ ...t, id: String(t._id), _id: undefined, lead: nameIn(names, t.lead_id), branch: branches.find((b) => String(b._id) === String(t.branch_id))?.name ?? null,
      members: t.members.map((m) => ({ id: String(m), name: nameIn(names, m) })) })),
    users: users.map((u) => ({ id: String(u._id), name: u.name })),
  });
}));
router.post('/console/branches', handle(async (req, res) => {
  await need(req, 'users', 'edit');
  const b = req.body ?? {};
  const name = clean(b.name, 80);
  if (!name) throw fieldErr('name', 'Branch name is required');
  if (await Branch.exists({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), _id: { $ne: oid(b.id) }, is_deleted: false })) throw fieldErr('name', 'This branch already exists');
  const f = { name, address: clean(b.address, 300), phone: clean(b.phone, 30), email: clean(b.email, 120), manager_id: oid(b.manager_id) ?? undefined, office_hours: clean(b.office_hours, 200), status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
  if (oid(b.id)) { await Branch.updateOne({ _id: oid(b.id) }, f); await audit(req, 'Update', 'Branch', b.id, name); res.json({ id: b.id }); return; }
  const x = await Branch.create({ ...f, created_by: req.user!.id });
  await audit(req, 'Create', 'Branch', x._id, name);
  res.json({ id: String(x._id) });
}));
router.post('/console/teams', handle(async (req, res) => {
  await need(req, 'users', 'edit');
  const b = req.body ?? {};
  const name = clean(b.name, 80);
  if (!name) throw fieldErr('name', 'Team name is required');
  const f: Any = { name, branch_id: oid(b.branch_id) ?? undefined, lead_id: oid(b.lead_id) ?? undefined, countries: (b.countries ?? []).map(String), status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
  if (Array.isArray(b.members)) f.members = b.members.map(oid).filter(Boolean);
  const t = oid(b.id) ? await Team.findByIdAndUpdate(oid(b.id), f, { new: true }) : await Team.create({ ...f, created_by: req.user!.id });
  if (!t) throw notFound('Team');
  if (Array.isArray(b.members)) await User.updateMany({ _id: { $in: f.members } }, { team_id: t._id });
  await audit(req, oid(b.id) ? 'Update' : 'Create', 'Team', t._id, name);
  res.json({ id: String(t._id) });
}));

// ---------- assignment rules and the Unassigned queue ----------
function readRule(b: Any) {
  const errors: Record<string, string> = {};
  if (!clean(b.name)) errors.name = 'Rule name is required';
  if (!(Number(b.priority) >= 1)) errors.priority = 'Priority must be 1 or more';
  if (!['user', 'team_rr', 'team_least', 'branch_queue'].includes(b.assign_to_type)) errors.assign_to_type = 'Choose who gets the record';
  if (!oid(b.assign_to_id)) errors.assign_to_id = 'Choose the user / team / branch';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const c = (b.conditions ?? {}) as Any;
  const arr = (v: unknown) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  return { name: clean(b.name, 80)!, priority: Number(b.priority), applies_to: arr(b.applies_to).filter((x) => APPLIES[x]),
    conditions: { sources: arr(c.sources), countries: arr(c.countries), levels: arr(c.levels), branches: arr(c.branches), cities: arr(c.cities), states: arr(c.states), languages: arr(c.languages) },
    assign_to_type: b.assign_to_type, assign_to_id: oid(b.assign_to_id), status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
}
router.get('/console/assignment', handle(async (req, res) => {
  await need(req, 'assignment');
  const names = await userNames();
  const [rules, queue, hist, branches, teams] = await Promise.all([AssignmentRule.find({ is_deleted: false }).sort({ priority: 1, createdAt: 1 }).lean(), UnassignedQueue.find({ status: 'Open' }).sort({ createdAt: 1 }).lean(),
    AssignmentHistory.find().sort({ at: -1 }).limit(50).lean(), Branch.find().select('name').lean(), Team.find().select('name').lean()]);
  const leads = await Lead.find({ _id: { $in: queue.filter((q) => q.record_type === 'lead').map((q) => q.record_id) } }).select('lead_code first_name last_name city').lean();
  res.json({
    rules: rules.map((x) => ({ ...x, id: String(x._id), _id: undefined, target: x.assign_to_type === 'user' ? nameIn(names, x.assign_to_id) : x.assign_to_type === 'branch_queue'
      ? branches.find((b) => String(b._id) === String(x.assign_to_id))?.name : teams.find((t) => String(t._id) === String(x.assign_to_id))?.name })),
    queue: queue.map((q) => { const l = leads.find((y) => String(y._id) === String(q.record_id)); return { ...q, id: String(q._id), _id: undefined, label: l ? `${l.lead_code} ${l.first_name} ${l.last_name ?? ''}`.trim() : String(q.record_id), city: l?.city ?? null }; }),
    applies: APPLIES, sources: (await MasterItem.find({ type: 'lead_source' }).sort({ name: 1 }).select('name').lean()).map((s) => ({ id: String(s._id), name: s.name })), agencies: [],
    history: hist.map((h) => ({ ...h, id: String(h._id), from: nameIn(names, h.from_user), to: nameIn(names, h.to_user), by: nameIn(names, h.by_user), rule: h.by_rule_id ? rules.find((r) => String(r._id) === String(h.by_rule_id))?.name ?? null : null })),
  });
}));
router.post('/console/assignment/rules', handle(async (req, res) => {
  await need(req, 'assignment', 'edit');
  const v = readRule(req.body ?? {});
  const r = oid(req.body?.id) ? await AssignmentRule.findByIdAndUpdate(oid(req.body.id), v, { new: true }) : await AssignmentRule.create({ ...v, created_by: req.user!.id });
  if (!r) throw notFound('Rule');
  await audit(req, oid(req.body?.id) ? 'Update' : 'Create', 'AssignmentRule', r._id, v.name, null, v);
  res.json({ id: String(r._id) });
}));
router.post('/console/assignment/test', handle(async (req, res) => {
  await need(req, 'assignment');
  const b = req.body ?? {};
  res.json(await pick(b.applies_to || 'lead', { countries: b.countries ?? [], source_id: b.source_id, level: b.level, branch_id: b.branch_id, city: b.city, state: b.state, languages: b.languages ?? [] }, true));
}));
router.post('/console/assignment/queue/:id', handle(async (req, res) => {
  await need(req, 'assignment', 'edit');
  const q = await UnassignedQueue.findOne({ _id: oid(req.params.id), status: 'Open' });
  if (!q) throw bad('Already handled');
  const to = await User.findOne({ _id: oid(req.body?.user_id), isActive: true }).lean();
  if (!to) throw fieldErr('user_id', 'Choose an active user');
  if (q.record_type === 'lead') { await Lead.updateOne({ _id: q.record_id }, { assigned_user_id: to._id }); await notify(to._id, 'assigned', 'A lead was assigned to you from the Unassigned queue', `/leads/${q.record_id}`); }
  await record(q.record_type, q.record_id, null, to._id, req.user!.id, null, 'Unassigned queue');
  q.set({ status: 'Done', done_at: new Date(), done_by: req.user!.id }); await q.save();
  await audit(req, 'Transfer', 'Lead', q.record_id, 'Assigned from the Unassigned queue', null, { to: to.name });
  res.json({ ok: true });
}));

// ---------- bulk transfer ----------
async function transferSet(b: Any) {
  if (!b.from_user && !b.branch_id && !b.team_id && !b.country_id && !b.stage) throw bad('Choose at least one filter (user, branch, team, country or stage)');
  let owners: Types.ObjectId[] | null = null;
  const narrow = (ids: Types.ObjectId[]) => { owners = owners ? owners.filter((x) => ids.some((y) => String(y) === String(x))) : ids; };
  if (oid(b.from_user)) narrow([oid(b.from_user)!]);
  if (oid(b.branch_id)) narrow(await User.distinct('_id', { branch_id: oid(b.branch_id) }));
  if (oid(b.team_id)) narrow((await Team.findById(oid(b.team_id)).lean())?.members ?? []);
  const sf: Any = { is_deleted: false, status: { $ne: 'Archived' }, ...(owners ? { primary_counsellor_id: { $in: owners } } : {}) };
  const lf: Any = { is_deleted: false, status: { $ne: 'Converted' }, merged_into: null, ...(owners ? { assigned_user_id: { $in: owners } } : {}) };
  if (oid(b.country_id)) { sf._id = { $in: await Application.distinct('student_id', { country_id: oid(b.country_id), is_deleted: false }) }; lf.interested_countries = oid(b.country_id); }
  if (b.stage) { sf._id = { $in: await Application.distinct('student_id', { stage: b.stage, is_deleted: false, ...(sf._id ? { student_id: sf._id } : {}) }) }; lf._id = null; }
  return { students: await Student.find(sf), leads: b.include_leads === false ? [] : await Lead.find(lf) };
}
router.post('/console/transfer/preview', handle(async (req, res) => {
  await need(req, 'assignment');
  const s = await transferSet(req.body ?? {});
  const tasks = oid(req.body?.from_user) ? await Task.countDocuments({ is_deleted: false, assigned_to: oid(req.body.from_user), status: { $in: ['Open', 'In progress'] } }) : 0;
  res.json({ students: s.students.length, leads: s.leads.length, tasks, partner: { universities: 0, agencies: 0 }, sample: s.students.slice(0, 10).map((x) => `${x.student_code} ${fullName(x)}`) });
}));
router.post('/console/transfer', handle(async (req, res) => {
  await need(req, 'assignment', 'edit');
  const b = req.body ?? {};
  const reason = clean(b.reason, 300);
  if (!reason) throw fieldErr('reason', 'Reason is required');
  let targets: { _id: unknown; name: string }[] = [];
  if (b.to_type === 'team') {
    for (const u of await teamMembers(oid(b.to_id))) if (!(await unavailable(u)) && String(u._id) !== String(b.from_user)) targets.push(u);
  } else { const u = await User.findOne({ _id: oid(b.to_id), isActive: true }).lean(); if (!u) throw fieldErr('to_id', 'Choose an active user'); targets = [u]; }
  if (!targets.length) throw bad('Nobody in the team is available');
  const set = await transferSet(b);
  const names = await userNames();
  let i = 0;
  const next = () => targets[(i++) % targets.length];
  const summary: string[][] = [];
  for (const s of set.students) {
    const to = next();
    if (String(to._id) === String(s.primary_counsellor_id)) continue;
    const from = nameIn(names, s.primary_counsellor_id);
    if (await transfer(req, s, String(to._id), reason, b.move_tasks !== false)) summary.push(['Student', s.student_code, fullName(s), from, to.name]);
  }
  for (const l of set.leads) {
    const to = next();
    if (String(to._id) === String(l.assigned_user_id)) continue;
    const from = l.assigned_user_id;
    await Lead.updateOne({ _id: l._id }, { assigned_user_id: to._id });
    if (b.move_tasks !== false) await Task.updateMany({ lead_id: l._id, status: { $in: ['Open', 'In progress'] } }, { assigned_to: to._id });
    await timeline({ lead_id: l._id, type: 'lead', description: `Lead transferred to ${to.name} (${reason})`, user_id: req.user!.id });
    await record('lead', l._id, from, to._id, req.user!.id, null, reason);
    summary.push(['Lead', l.lead_code, [l.first_name, l.last_name].filter(Boolean).join(' '), nameIn(names, from), to.name]);
  }
  if (oid(b.from_user) && b.move_tasks !== false) await Task.updateMany({ is_deleted: false, assigned_to: oid(b.from_user), status: { $in: ['Open', 'In progress'] } }, { assigned_to: targets[0]._id });
  for (const t of targets) await notify(t._id, 'assigned', `Records transferred to you (${reason})`, '/students');
  await audit(req, 'Transfer', 'BulkTransfer', b.from_user || null, `Bulk transfer: ${summary.length} record(s) (${reason})`, null, { filters: b, count: summary.length });
  res.json({ ok: true, count: summary.length, summary });
}));

// ---------- duplicate and merge centre ----------
const caseKey = (kind: string, ids: string[]) => crypto.createHash('sha256').update(kind + ':' + [...ids].sort().join(',')).digest('hex');
async function addCase(match_type: string, record_kind: string, ids: string[], source: string) {
  const uniq = [...new Set(ids)];
  if (uniq.length < 2) return 0;
  const key_hash = caseKey(record_kind, uniq);
  if (await DuplicateCase.exists({ key_hash })) return 0;
  await DuplicateCase.create({ match_type, record_kind, record_ids: uniq, key_hash, source, status: 'Open' });
  return 1;
}
export async function scanDuplicates() {
  let n = 0;
  const groups = async (model: unknown, base: Any, by: unknown) => (await (model as mongoose.Model<Any>).aggregate([{ $match: base }, { $group: { _id: by, ids: { $push: { $toString: '$_id' } }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])).map((g) => g.ids as string[]);
  const sBase = { is_deleted: false, merged_into: null };
  for (const ids of await groups(Student, { ...sBase, passport_hash: { $nin: [null, ''] } }, '$passport_hash')) n += await addCase('Passport', 'student', ids, 'Scan');
  for (const ids of await groups(Student, { ...sBase, email: { $nin: [null, ''] } }, { $toLower: '$email' })) n += await addCase('Email', 'student', ids, 'Scan');
  for (const ids of await groups(Student, { ...sBase, phone_normalised: { $nin: [null, ''] } }, '$phone_normalised')) n += await addCase('Mobile', 'student', ids, 'Scan');
  for (const ids of await groups(Student, { ...sBase, dob: { $nin: [null, ''] } }, { f: { $toLower: '$first_name' }, l: { $toLower: { $ifNull: ['$last_name', ''] } }, d: '$dob' })) n += await addCase('Name + DOB', 'student', ids, 'Scan');
  const lBase = { is_deleted: false, merged_into: null, status: { $ne: 'Converted' } };
  for (const ids of await groups(Lead, { ...lBase, email: { $nin: [null, ''] } }, { $toLower: '$email' })) n += await addCase('Email', 'lead', ids, 'Scan');
  for (const ids of await groups(Lead, { ...lBase, phone_normalised: { $nin: [null, ''] } }, '$phone_normalised')) n += await addCase('Mobile', 'lead', ids, 'Scan');
  return n;
}
const STU_FIELDS = ['first_name', 'middle_name', 'last_name', 'gender', 'dob', 'phone', 'phone_normalised', 'email', 'nationality', 'passport_enc', 'passport_hash', 'passport_last4', 'passport_expiry', 'address1', 'city', 'state', 'pin'];
const LEAD_FIELDS = ['first_name', 'last_name', 'phone', 'phone_normalised', 'email', 'city', 'state', 'course_interest', 'level', 'intake_id'];
async function recView(kind: string, id: unknown, names: Map<string, string>) {
  if (kind === 'student') {
    const s = await Student.findById(id).lean() as Any;
    if (!s) return null;
    return { id: String(s._id), code: s.student_code, name: fullName(s), status: s.status, merged_into: s.merged_into ?? null, counsellor: nameIn(names, s.primary_counsellor_id), created_at: s.createdAt,
      fields: Object.fromEntries(STU_FIELDS.filter((k) => !/enc|hash/.test(k)).map((k) => [k, k === 'passport_last4' ? (s[k] ? '****' + s[k] : null) : s[k] ?? null])),
      counts: { applications: await Application.countDocuments({ student_id: s._id, is_deleted: false }), documents: await StudentDocument.countDocuments({ student_id: s._id, is_deleted: false }),
        payments: await Payment.countDocuments({ student_id: s._id, is_deleted: false }), emails: await EmailLog.countDocuments({ student_id: s._id }) } };
  }
  const l = await Lead.findById(id).lean() as Any;
  if (!l) return null;
  return { id: String(l._id), code: l.lead_code, name: [l.first_name, l.last_name].filter(Boolean).join(' '), status: l.status, merged_into: l.merged_into ?? null, counsellor: nameIn(names, l.assigned_user_id), created_at: l.createdAt,
    fields: Object.fromEntries(LEAD_FIELDS.map((k) => [k, l[k] ?? null])), counts: { emails: await EmailLog.countDocuments({ lead_id: l._id }) } };
}
router.get('/console/duplicates', handle(async (req, res) => {
  await need(req, 'duplicates');
  if (req.query.scan === '1') await scanDuplicates();
  const st = String(req.query.status || 'Open');
  const names = await userNames();
  const rows = [];
  for (const c of await DuplicateCase.find({ status: st }).sort({ createdAt: -1 }).limit(300).lean()) {
    const records = (await Promise.all(c.record_ids.map((id) => recView(c.record_kind, id, names)))).filter(Boolean) as Any[];
    if (st !== 'Open' || records.filter((x) => !x.merged_into).length > 1) rows.push({ ...c, id: String(c._id), _id: undefined, records });
  }
  res.json({ rows, can_merge: await can(req, 'duplicates', 'edit') });
}));
router.post('/console/duplicates/:id/not-duplicate', handle(async (req, res) => {
  await need(req, 'duplicates', 'edit');
  await DuplicateCase.updateOne({ _id: oid(req.params.id) }, { status: 'Not duplicate', decided_by: req.user!.id, decided_at: new Date(), note: clean(req.body?.note, 300) });
  await audit(req, 'Update', 'DuplicateCase', req.params.id, 'Marked not duplicate');
  res.json({ ok: true });
}));
// collections that point at a student / lead; append-only logs stay on the old record (reached through "Merged into")
const SKIP = new Set(['students', 'leads', 'timelines', 'auditlogs', 'consentrecords', 'duplicatecases', 'signeddocuments']);
router.post('/console/duplicates/:id/merge', handle(async (req, res) => {
  await need(req, 'duplicates', 'edit');
  const c = await DuplicateCase.findOne({ _id: oid(req.params.id), status: 'Open' });
  if (!c) throw bad('This case is closed');
  const ids = c.record_ids.map(String);
  const keep = String(req.body?.survivor_id ?? '');
  const others = ids.filter((x) => x !== keep);
  if (!ids.includes(keep) || !others.length) throw bad('Choose the surviving record');
  if (!req.body?.confirm) throw bad('Please confirm: a merge cannot be undone');
  const kind = c.record_kind;
  const M = (kind === 'student' ? Student : Lead) as unknown as mongoose.Model<Any>;
  const col = kind === 'student' ? 'student_id' : 'lead_id';
  const fields = kind === 'student' ? STU_FIELDS : LEAD_FIELDS;
  const moved: Record<string, number> = {};
  const surv = await M.findById(keep).lean();
  if (!surv) throw notFound();
  const collections = (await mongoose.connection.db!.listCollections().toArray()).map((x) => x.name).filter((n) => !SKIP.has(n));
  for (const otherId of others) {
    const o = await M.findById(otherId).lean();
    if (!o || o.merged_into) continue;
    // field by field: "take" = take the value from the merged record; empty values are filled
    const take: Any = {};
    for (const [k, v] of Object.entries((req.body?.take ?? {}) as Record<string, string>)) if (v === otherId && fields.includes(k)) {
      take[k] = o[k];
      if (k === 'passport_last4') { take.passport_enc = o.passport_enc; take.passport_hash = o.passport_hash; }
    }
    for (const k of fields) if ((surv[k] === null || surv[k] === undefined || surv[k] === '') && o[k] && take[k] === undefined) take[k] = o[k];
    if (Object.keys(take).length) await M.updateOne({ _id: keep }, take);
    if (kind === 'student' && !surv.email_thread_root_id && o.email_thread_root_id) await Student.updateOne({ _id: keep }, { email_thread_root_id: o.email_thread_root_id, email_thread_subject: o.email_thread_subject, email_refs: o.email_refs ?? [] });
    for (const name of collections) {
      const r = await mongoose.connection.db!.collection(name).updateMany({ [col]: new Types.ObjectId(otherId) }, { $set: { [col]: new Types.ObjectId(keep) } });
      if (r.modifiedCount) moved[name] = (moved[name] ?? 0) + r.modifiedCount;
    }
    if (kind === 'student') {
      const r = await PortalAccount.updateMany({ studentId: otherId }, { studentId: keep });
      if (r.modifiedCount) moved.portalaccounts = r.modifiedCount;
      await Student.updateOne({ _id: otherId }, { merged_into: keep, status: 'Archived', status_reason: `Merged into ${surv.student_code}` });
      await timeline({ student_id: keep, type: 'profile', description: `Record ${o.student_code} merged into this file by ${req.user!.name}`, user_id: req.user!.id });
      await timeline({ student_id: otherId, type: 'profile', description: `Merged into ${surv.student_code}. This record is read-only.`, user_id: req.user!.id });
    } else {
      await Lead.updateOne({ _id: otherId }, { merged_into: keep });
      await timeline({ lead_id: keep, type: 'lead', description: `Lead ${o.lead_code} merged into this lead by ${req.user!.name}`, user_id: req.user!.id });
    }
  }
  c.set({ status: 'Merged', survivor_id: keep, decided_by: req.user!.id, decided_at: new Date(), note: clean(req.body?.note, 300) }); await c.save();
  await audit(req, 'Merge', kind === 'student' ? 'Student' : 'Lead', keep, `Merged ${others.length} record(s) into ${keep}`, { merged: others }, { moved });
  res.json({ ok: true, moved });
}));
// a counsellor can suggest a possible duplicate
router.post('/console/duplicates/flag', handle(async (req, res) => {
  await need(req, 'duplicates');
  const ids = ((req.body?.ids ?? []) as unknown[]).map(oid).filter(Boolean).map(String).slice(0, 5);
  if (ids.length < 2) throw bad('Choose at least two records');
  const names = await userNames();
  await addCase('Flagged by staff', req.body?.kind === 'lead' ? 'lead' : 'student', ids, nameIn(names, req.user!.id));
  res.json({ ok: true });
}));

export default router;
