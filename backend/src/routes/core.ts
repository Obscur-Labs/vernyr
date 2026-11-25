import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { authenticate, type AuthRequest } from '../middleware/auth';
import Student from '../models/Student';
import Lead from '../models/Lead';
import Task, { TASK_TYPES, TASK_PRIORITIES, TASK_STATUSES, type ITask } from '../models/Task';
import Notification from '../models/Notification';
import User from '../models/User';
import { Intake, MasterItem, Country } from '../models/Master';
import University from '../models/University';
import Course from '../models/Course';
import { Timeline } from '../models/Timeline';
import { can } from '../config/clientPerms';
import {
  HttpError, bad, fieldErr, forbidden, handle, need, isAdmin, oid, sid, clean, normPhone, isEmail, escRx,
  istDate, istDayStart, addDays, timeline, userNames, nameIn, hmac, fullName,
} from '../services/crm';
import { studentScope, canSeeStudent, loadStudent, overallStage } from '../services/students';
import { createTask, notify } from '../services/tasks';
import { stageList } from '../services/masters';
import { passwordProblem } from '../services/passwords';
import { invalidateUser } from '../services/access';
import { upload } from '../middleware/upload';
import { uploadBuffer } from '../config/cloudinary';
import { checkFile } from '../services/files';

/** The client's core API (legacy/server/routes/core.js): dashboard, tasks, notifications, global search, my profile. */
const router = Router();
router.use(authenticate);

const col = (n: string) => mongoose.connection.collection(n);
const leadScope = (req: AuthRequest): Record<string, unknown> =>
  ['admin', 'manager'].includes(req.user!.role) ? {} : { $or: [{ assigned_user_id: new Types.ObjectId(req.user!.id) }, { created_by: new Types.ObjectId(req.user!.id) }] };

async function nameMaps() {
  const [names, masters, countries, intakes, unis, courses] = await Promise.all([
    userNames(), MasterItem.find().select('name').lean(), Country.find().select('name').lean(), Intake.find().select('name').lean(),
    University.find().select('name').lean(), Course.find().select('name').lean(),
  ]);
  const all = new Map<string, string>();
  for (const arr of [masters, countries, intakes, unis, courses]) for (const x of arr) all.set(String(x._id), x.name);
  return { names, master: (id: unknown) => (id ? all.get(String(id)) ?? '' : '') };
}

// ---------- my profile ----------
router.put('/me', handle(async (req, res) => {
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!clean(b.name)) errors.name = 'Name is required';
  if (b.email && !isEmail(b.email)) errors.email = 'Enter a valid email';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  // the email is changed by an Admin only
  const set: Record<string, unknown> = { name: clean(b.name, 100), phone: clean(b.mobile, 20), designation: clean(b.designation, 80) };
  // simple formatting only: <b>, <i>, <br>
  if (b.signature_html !== undefined) set.signature_html = String(b.signature_html ?? '').slice(0, 2000).replace(/<(?!\/?(b|i|br)\s*\/?>)[^>]*>/gi, '');
  if (b.notify_email && typeof b.notify_email === 'object') set.notify_email = Object.fromEntries(Object.entries(b.notify_email).filter(([k]) => /^[a-z_]{2,30}$/.test(k)).map(([k, v]) => [k, !!v]));
  await User.updateOne({ _id: req.user!.id }, set);
  invalidateUser(req.user!.id);
  res.json({ ok: true });
}));
router.post('/me/photo', upload.single('photo'), handle(async (req, res) => {
  if (!req.file) throw bad('Choose a photo');
  checkFile(req.file, ['jpg', 'jpeg', 'png'], 2);
  const up = await uploadBuffer(req.file, `staff/${req.user!.id}/photo`);
  await User.updateOne({ _id: req.user!.id }, { avatar: up.url });
  invalidateUser(req.user!.id);
  res.json({ ok: true, url: up.url });
}));
router.post('/me/password', handle(async (req, res) => {
  const u = await User.findById(req.user!.id).select('+password');
  if (!u || !(await u.comparePassword(String(req.body?.current ?? '')))) throw fieldErr('current', 'Current password is incorrect');
  const pw = String(req.body?.password ?? '');
  const problem = passwordProblem(pw, 'staff', [u.username, u.email, u.name]);
  if (problem) throw fieldErr('password', problem);
  if (await u.comparePassword(pw)) throw fieldErr('password', 'New password cannot be the same as your current password');
  u.password = pw; await u.save();
  res.json({ ok: true, message: 'Password changed' });
}));
// the client keeps the session alive on activity; with JWT the token lifetime decides, so this only answers the idle window
router.post('/ping', (_req, res) => res.json({ ok: true, idle_min: 30 }));

// ---------- dashboard ----------
router.get('/dashboard', handle(async (req, res) => {
  need(req, 'dashboard', 'view');
  const q = req.query as Record<string, string>;
  const sf: Record<string, unknown> = { is_deleted: false, status: { $ne: 'Archived' }, ...studentScope(req) };
  const lf: Record<string, unknown> = { is_deleted: false, merged_into: null, ...leadScope(req) };
  if (oid(q.counsellor) && isAdmin(req)) { sf.primary_counsellor_id = oid(q.counsellor); lf.assigned_user_id = oid(q.counsellor); }
  if (oid(q.intake)) { sf['prefs.intake_id'] = oid(q.intake); lf.intake_id = oid(q.intake); }
  if (oid(q.country)) { sf['prefs.country_ids'] = oid(q.country); lf.interested_countries = oid(q.country); }
  const studentIds = await Student.distinct('_id', sf);
  const inStudents = { student_id: { $in: studentIds }, is_deleted: { $ne: true } };
  const week = new Date(Date.now() - 7 * 864e5);
  const today = istDate();
  const t0 = istDayStart(today), t1 = istDayStart(addDays(today, 1));
  const appCount = async (stages: string[], sinceWeek = false, distinct = false) => {
    const f = { ...inStudents, stage: { $in: stages }, ...(sinceWeek ? { stage_changed_at: { $gte: week } } : {}) };
    return distinct ? (await col('applications').distinct('student_id', f)).length : col('applications').countDocuments(f);
  };
  const visaCount = (stages: string[], sinceWeek = false) => col('visacases').countDocuments({ ...inStudents, stage: { $in: stages }, ...(sinceWeek ? { updatedAt: { $gte: week } } : {}) });
  const APPLY = ['documents_pending', 'ready_to_apply', 'applied', 'under_review', 'interview'];
  const OFFER = ['conditional_offer', 'unconditional_offer', 'offer_accepted'];
  const PAID = ['tuition_paid', 'enrolment_confirmed'];
  const INQ = ['New', 'Contacted', 'Follow-up', 'Interested'];
  const VA = ['appointment_booked', 'biometrics', 'submitted'];
  const open = { status: { $nin: ['Converted', 'Not interested'] } };
  const cards = [
    { key: 'students', label: 'Total Students', value: studentIds.length, week: await Student.countDocuments({ ...sf, createdAt: { $gte: week } }), link: '/students' },
    { key: 'inquiry', label: 'Inquiry', value: await Lead.countDocuments({ ...lf, status: { $in: INQ } }), week: await Lead.countDocuments({ ...lf, createdAt: { $gte: week } }), link: `/leads?status=${INQ.join(',')}` },
    ...(can(req.user!.role, 'leads', 'view') ? [{ key: 'followups', label: 'Follow-ups Today', value: await Lead.countDocuments({ ...lf, ...open, next_followup_at: { $gte: t0, $lt: t1 } }),
      sub: `${await Lead.countDocuments({ ...lf, ...open, next_followup_at: { $lt: new Date() } })} overdue`, link: '/leads?followup=today' }] : []),
    { key: 'apply', label: 'University Application Stage', value: await appCount(APPLY, false, true), week: await appCount(APPLY, true, true), link: `/applications?stage=${APPLY.join(',')}` },
    { key: 'offer', label: 'Offer Letter', value: await appCount(OFFER), week: await appCount(OFFER, true), link: `/applications?stage=${OFFER.join(',')}` },
    { key: 'paid', label: 'Tuition Fees Paid', value: await appCount(PAID), week: await appCount(PAID, true), link: `/applications?stage=${PAID.join(',')}` },
    { key: 'visa_applied', label: 'Visa: Applied', value: await visaCount(VA), week: await visaCount(VA, true), link: `/applications?visa_stage=${VA.join(',')}` },
    { key: 'visa_approved', label: 'Visa: Approved', value: await visaCount(['approved']), week: await visaCount(['approved'], true), link: '/applications?visa_stage=approved', tone: 'green' },
    { key: 'visa_rejected', label: 'Visa: Rejected', value: await visaCount(['rejected', 'reapply']), week: await visaCount(['rejected', 'reapply'], true), link: '/applications?visa_stage=rejected,reapply', tone: 'red' },
    { key: 'docs', label: 'Documents to Verify', value: await col('documents').countDocuments({ ...inStudents, status: 'Uploaded' }),
      week: await col('documents').countDocuments({ ...inStudents, status: 'Uploaded', updatedAt: { $gte: week } }), link: '/documents' },
    // C5: student portal requests arrive with the portal staff module (PORTING.md)
    { key: 'student_requests', label: 'Student Requests', value: 0, sub: '0 apply · 0 changes · 0 offers', link: '/requests', tone: '' },
  ];

  const who = isAdmin(req) && oid(q.counsellor) ? oid(q.counsellor)! : new Types.ObjectId(req.user!.id);
  const openT = { is_deleted: false, status: { $in: ['Open', 'In progress'] }, assigned_to: who };
  const { names, master } = await nameMaps();
  const people = await taskPeople();
  const tRow = (t: ITask) => ({ ...taskJson(t), student_name: people.student(t.student_id), lead_name: !t.student_id ? people.lead(t.lead_id) : null });
  const todo = {
    today: (await Task.find({ ...openT, due_at: { $gte: new Date(), $lt: t1 } }).sort({ due_at: 1 })).map(tRow),
    overdue: (await Task.find({ ...openT, due_at: { $lt: new Date() } }).sort({ due_at: 1 })).map(tRow),
    upcoming: (await Task.find({ ...openT, due_at: { $gte: t1, $lt: istDayStart(addDays(today, 8)) } }).sort({ due_at: 1 }).limit(50)).map(tRow),
  };
  const recent = (await Timeline.find({ student_id: { $in: studentIds } }).sort({ createdAt: -1 }).limit(20).lean())
    .map((t) => ({ ...t, id: String(t._id), _id: undefined, created_at: t.createdAt, user_name: nameIn(names, t.user_id), student_name: people.student(t.student_id) }));
  const d30 = addDays(today, 30);
  const deadline = (x: Record<string, unknown>) => (x.deadline ? istDate(new Date(x.deadline as string)) : '');
  const deadlines = [
    ...(await col('applications').find({ ...inStudents, stage: { $in: ['documents_pending', 'ready_to_apply'] }, deadline: { $gte: istDayStart(today), $lte: istDayStart(d30) } }).toArray()).map((x) => ({ ...x, src: 'application' })),
    ...(await col('shortlists').find({ ...inStudents, application_id: null, status: { $ne: 'Rejected by student' }, deadline: { $gte: istDayStart(today), $lte: istDayStart(d30) } }).toArray()).map((x) => ({ ...x, src: 'shortlist' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ].map((x: Record<string, any>) => ({ src: x.src, student_id: sid(x.student_id), student: people.student(x.student_id), university: master(x.university_id),
    course: x.course_name_text || master(x.course_id), intake: master(x.intake_id), deadline: deadline(x), days_left: Math.round((+new Date(deadline(x)) - +new Date(today)) / 864e5) }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const visaAppts = (await col('visacases').find({ ...inStudents, stage: 'appointment_booked', appointment_at: { $gte: new Date(), $lt: istDayStart(addDays(today, 15)) } }).sort({ appointment_at: 1 }).toArray())
    .map((v) => ({ id: String(v._id), student_id: sid(v.student_id), student: people.student(v.student_id), country: master(v.country_id), appointment_at: v.appointment_at, centre: v.centre }));
  const intakes = await Intake.find().lean();
  const nowKey = new Date().getFullYear() * 12 + new Date().getMonth() + 1;
  const byIntake = await Student.aggregate([{ $match: { ...sf, 'prefs.intake_id': { $ne: null } } }, { $group: { _id: '$prefs.intake_id', c: { $sum: 1 } } }]);
  const intakeSummary = byIntake.map((g) => ({ ...intakes.find((i) => String(i._id) === String(g._id)), c: g.c })).filter((i) => i.name && (i.year ?? 0) * 12 + (i.month ?? 0) >= nowKey)
    .sort((a, b) => a.year! * 12 + a.month! - (b.year! * 12 + b.month!)).map((i) => ({ name: i.name, year: i.year, month: i.month, c: i.c }));
  res.json({ cards, todo, recent, deadlines, visa_appointments: visaAppts, intake_summary: intakeSummary });
}));

// ---------- tasks ----------
const taskJson = (t: ITask) => {
  const o = t.toObject ? t.toObject() : t;
  return { ...JSON.parse(JSON.stringify(o)), id: String(t._id), _id: undefined, created_at: t.createdAt, updated_at: t.updatedAt };
};
async function taskPeople() {
  const [students, leads, names] = await Promise.all([
    Student.find().select('first_name middle_name last_name student_code').lean(), Lead.find().select('first_name last_name lead_code').lean(), userNames(),
  ]);
  const s = new Map(students.map((x) => [String(x._id), x])); const l = new Map(leads.map((x) => [String(x._id), x]));
  return {
    names,
    student: (id: unknown) => { const x = id ? s.get(String(id)) : null; return x ? fullName(x) : null; },
    studentCode: (id: unknown) => (id ? s.get(String(id))?.student_code ?? null : null),
    lead: (id: unknown) => { const x = id ? l.get(String(id)) : null; return x ? [x.first_name, x.last_name].filter(Boolean).join(' ') : null; },
    leadCode: (id: unknown) => (id ? l.get(String(id))?.lead_code ?? null : null),
  };
}
async function taskOut(t: ITask, req: AuthRequest, P: Awaited<ReturnType<typeof taskPeople>>) {
  const overdueDays = !['Done', 'Cancelled'].includes(t.status) && t.due_at < new Date() ? Math.max(0, Math.floor((Date.now() - +t.due_at) / 864e5)) : null;
  const meId = req.user!.id;
  const [app, visa] = await Promise.all([
    t.application_id ? col('applications').findOne({ _id: t.application_id }, { projection: { application_code: 1 } }) : null,
    t.visa_case_id ? col('visacases').findOne({ _id: t.visa_case_id }, { projection: { visa_code: 1 } }) : null,
  ]);
  return { ...taskJson(t), student_name: P.student(t.student_id), student_code: P.studentCode(t.student_id), lead_name: P.lead(t.lead_id), lead_code: P.leadCode(t.lead_id),
    assigned_to_name: nameIn(P.names, t.assigned_to), assigned_by_name: nameIn(P.names, t.assigned_by), created_by_name: nameIn(P.names, t.created_by),
    overdue: overdueDays !== null, overdue_days: overdueDays,
    can_edit: isAdmin(req) || [t.created_by, t.assigned_to, t.assigned_by].some((x) => String(x ?? '') === meId),
    application_code: app?.application_code ?? null, visa_code: visa?.visa_code ?? null };
}
async function loadTask(req: AuthRequest, id: string) {
  const t = oid(id) && (await Task.findOne({ _id: oid(id), is_deleted: false }));
  if (!t) throw new HttpError(404, 'Task not found');
  if (isAdmin(req) || [t.assigned_to, t.created_by, t.assigned_by].some((x) => String(x ?? '') === req.user!.id)) return t;
  if (t.student_id) { const s = await Student.findById(t.student_id); if (s && canSeeStudent(req, s)) return t; }
  throw forbidden();
}

router.get('/tasks', handle(async (req, res) => {
  need(req, 'tasks', 'view');
  const q = req.query as Record<string, string>;
  const today = istDate();
  const t0 = istDayStart(today), t1 = istDayStart(addDays(today, 1));
  const f: Record<string, unknown> = { is_deleted: false };
  const meId = new Types.ObjectId(req.user!.id);
  if (q.student) { await loadStudent(req, q.student); f.student_id = oid(q.student); }
  else if (q.tab === 'assigned_by_me') { f.assigned_by = meId; f.assigned_to = { $ne: meId }; }
  else if (isAdmin(req) && oid(q.user)) f.assigned_to = oid(q.user);
  else if (!(isAdmin(req) && q.all === '1')) f.assigned_to = meId;
  const openS = { $in: ['Open', 'In progress'] };
  if (q.tab === 'today') Object.assign(f, { status: openS, due_at: { $gte: t0, $lt: t1 } });
  if (q.tab === 'overdue') Object.assign(f, { status: openS, due_at: { $lt: new Date() } });
  if (q.tab === 'upcoming') Object.assign(f, { status: openS, due_at: { $gte: t1 } });
  if (q.tab === 'completed') f.status = { $in: ['Done', 'Cancelled'] };
  if (q.priority) f.priority = q.priority;
  if (q.type) f.type = q.type;
  if (q.from || q.to) f.due_at = { ...(f.due_at as object ?? {}), ...(q.from ? { $gte: istDayStart(q.from) } : {}), ...(q.to ? { $lt: istDayStart(addDays(q.to, 1)) } : {}) };
  const rows = await Task.find(f).sort(q.tab === 'completed' ? { completed_at: -1, updatedAt: -1 } : { due_at: 1 }).limit(500);
  const P = await taskPeople();
  const out = await Promise.all(rows.map((t) => taskOut(t, req, P)));
  res.json({ rows: out, total: out.length });
}));

async function taskValidate(req: AuthRequest, b: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {};
  if (!clean(b.title)) errors.title = 'Title is required'; else if (String(b.title).length > 150) errors.title = 'Max 150 characters';
  if (!TASK_TYPES.includes(b.type)) errors.type = 'Task type is required';
  if (!b.assigned_to) errors.assigned_to = 'Assigned to is required';
  if (!b.due_at) errors.due_at = 'Due date and time is required';
  if (b.priority && !TASK_PRIORITIES.includes(b.priority)) errors.priority = 'Invalid';
  if (b.type === 'Student action' && !b.student_id) errors.student_id = 'A student action task must be linked to a student';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  if (b.student_id) await loadStudent(req, String(b.student_id));
  if (!(await User.exists({ _id: oid(String(b.assigned_to)), isActive: true }))) throw fieldErr('assigned_to', 'Select an active user');
}
const taskFields = (b: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  title: clean(b.title, 150)!, description: clean(b.description, 3000), type: b.type, student_id: oid(b.student_id) ?? undefined, lead_id: oid(b.lead_id) ?? undefined,
  application_id: oid(b.application_id) ?? undefined, visa_case_id: oid(b.visa_case_id) ?? undefined, assigned_to: oid(String(b.assigned_to))!, due_at: new Date(b.due_at),
  priority: b.priority || 'Medium', reminder: b.reminder || 'None', repeat_rule: b.repeat_rule || 'None',
});

router.post('/tasks', handle(async (req, res) => {
  need(req, 'tasks', 'add');
  const b = req.body ?? {};
  await taskValidate(req, b);
  const id = await createTask({ ...taskFields(b), no_email: b.notify === false }, req.user!.id, req.user!.name);
  if (b.type === 'Student action' && b.notify === false && b.student_id) {
    await timeline({ student_id: oid(b.student_id), type: 'email', description: `Saved without notifying: Student action task "${b.title}" (E18)`, user_id: req.user!.id });
  }
  res.json({ id });
}));

async function afterDone(req: AuthRequest, t: ITask) {
  if (t.student_id) await timeline({ student_id: t.student_id, type: 'task', description: `Task done: ${t.title} (by ${req.user!.name})`, user_id: req.user!.id });
  // E19 "action completed" email arrives with the email engine (PORTING.md)
  if (t.repeat_rule && t.repeat_rule !== 'None') {
    const d = new Date(t.due_at);
    if (t.repeat_rule === 'Daily') d.setDate(d.getDate() + 1);
    if (t.repeat_rule === 'Weekly') d.setDate(d.getDate() + 7);
    if (t.repeat_rule === 'Monthly') d.setMonth(d.getMonth() + 1);
    await createTask({ title: t.title, description: t.description, type: t.type, student_id: t.student_id, lead_id: t.lead_id, application_id: t.application_id, visa_case_id: t.visa_case_id,
      assigned_to: t.assigned_to, due_at: d, priority: t.priority, reminder: t.reminder, repeat_rule: t.repeat_rule, no_email: true }, req.user!.id, req.user!.name);
  }
}

router.put('/tasks/:id', handle(async (req, res) => {
  const t = await loadTask(req, req.params.id);
  if (!isAdmin(req) && ![t.created_by, t.assigned_to, t.assigned_by].some((x) => String(x ?? '') === req.user!.id)) throw forbidden();
  const b = { ...taskJson(t), ...req.body };
  await taskValidate(req, b);
  if (b.status && !TASK_STATUSES.includes(b.status)) throw fieldErr('status', 'Invalid status');
  const f: Record<string, unknown> = { ...taskFields(b), status: b.status, updated_by: req.user!.id };
  const done = f.status === 'Done' && t.status !== 'Done';
  if (done) Object.assign(f, { completed_at: new Date(), completed_by: req.user!.id });
  if (+new Date(f.due_at as Date) !== +t.due_at) f.reminders_sent = [];
  const reassigned = String(f.assigned_to) !== String(t.assigned_to);
  t.set(f); await t.save();
  if (reassigned) await notify(f.assigned_to, 'task_assigned', `${req.user!.name} assigned you a task: ${f.title}`, '/tasks');
  if (done) await afterDone(req, t);
  res.json({ ok: true });
}));
router.post('/tasks/:id/done', handle(async (req, res) => {
  const t = await loadTask(req, req.params.id);
  if (!isAdmin(req) && String(t.assigned_to) !== req.user!.id && String(t.created_by ?? '') !== req.user!.id) throw forbidden();
  if (t.status === 'Done') { res.json({ ok: true }); return; }
  t.set({ status: 'Done', completed_at: new Date(), completed_by: req.user!.id }); await t.save();
  await afterDone(req, t);
  res.json({ ok: true });
}));
router.post('/tasks/:id/reopen', handle(async (req, res) => {
  const t = await loadTask(req, req.params.id);
  t.set({ status: 'Open', completed_at: undefined, completed_by: undefined }); await t.save();
  res.json({ ok: true });
}));
router.post('/tasks/:id/snooze', handle(async (req, res) => {
  const t = await loadTask(req, req.params.id);
  const due = +t.due_at;
  let d: Date | null = null;
  if (req.body?.by === '1h') d = new Date(Math.max(Date.now(), due) + 3600e3);
  else if (req.body?.by === '1d') d = new Date(due + 864e5 < Date.now() ? Date.now() + 864e5 : due + 864e5);
  else if (req.body?.until) d = new Date(req.body.until);
  if (!d || isNaN(+d)) throw bad('Choose how long to snooze');
  t.set({ due_at: d, reminders_sent: [] }); await t.save();
  res.json({ ok: true });
}));

// ---------- notifications ----------
router.get('/notifications', handle(async (req, res) => {
  const rows = await Notification.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(req.query.all ? 500 : 20).lean();
  const unread = await Notification.countDocuments({ userId: req.user!.id, read: false });
  res.json({
    rows: rows.map((n) => ({ id: String(n._id), user_id: String(n.userId), type: n.type, title: n.title, link: n.link ?? null, is_read: n.read, created_at: n.createdAt })),
    unread, idle_left_sec: 30 * 60,
  });
}));
router.post('/notifications/read', handle(async (req, res) => {
  if (req.body?.all) await Notification.updateMany({ userId: req.user!.id }, { read: true });
  else await Notification.updateMany({ userId: req.user!.id, _id: { $in: (req.body?.ids ?? []).map(oid).filter(Boolean) } }, { read: true });
  res.json({ ok: true });
}));

// ---------- global search ----------
router.get('/search', handle(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const lim = req.query.all ? 100 : 10;
  if (q.length < 3) { res.json({ students: [], leads: [], applications: [] }); return; }
  const rx = new RegExp(escRx(q), 'i'); const ph = normPhone(q); const up = q.toUpperCase().replace(/\s/g, '');
  const passportHash = /^[A-Z0-9]{6,12}$/.test(up) ? hmac(up) : null;
  const names = await userNames();
  // passport: an exact full number for everyone, the last 4 characters only for Admin (privacy)
  const students = await Student.find({ is_deleted: false, ...studentScope(req), $or: [
    { first_name: rx }, { middle_name: rx }, { last_name: rx }, { email: rx }, { student_code: new RegExp(escRx(up), 'i') },
    ...(ph && ph.length >= 3 ? [{ phone_normalised: new RegExp(ph) }, { whatsapp: new RegExp(ph) }] : []),
    ...(passportHash ? [{ passport_hash: passportHash }] : []), ...(isAdmin(req) && up.length >= 3 ? [{ passport_last4: up.slice(-4) }] : []),
  ] }).sort({ first_name: 1 }).limit(lim);
  const leads = can(req.user!.role, 'leads', 'view') ? await Lead.find({ is_deleted: false, merged_into: null, status: { $ne: 'Converted' }, ...leadScope(req), $or: [
    { first_name: rx }, { last_name: rx }, { email: rx }, { lead_code: new RegExp(escRx(up), 'i') }, ...(ph && ph.length >= 3 ? [{ phone_normalised: new RegExp(ph) }] : []),
  ] }).sort({ createdAt: -1 }).limit(lim).lean() : [];
  const sIds = await Student.distinct('_id', { is_deleted: false, ...studentScope(req) });
  const apps = await col('applications').find({ is_deleted: { $ne: true }, student_id: { $in: sIds }, $or: [{ application_code: new RegExp(escRx(up), 'i') }, { university_app_id: rx }] }).limit(lim).toArray();
  const { master } = await nameMaps();
  const P = await taskPeople();
  const stages = await stageList('app_stage');
  res.json({
    students: await Promise.all(students.map(async (s) => ({ id: String(s._id), code: s.student_code, name: fullName(s), phone: s.phone, email: s.email, stage: await overallStage(s._id as Types.ObjectId), counsellor: nameIn(names, s.primary_counsellor_id) }))),
    leads: leads.map((l) => ({ id: String(l._id), code: l.lead_code, name: [l.first_name, l.last_name].filter(Boolean).join(' '), phone: l.phone, email: l.email, status: l.status, counsellor: nameIn(names, l.assigned_user_id) })),
    applications: apps.map((a) => ({ id: String(a._id), student_id: sid(a.student_id), code: a.application_code, university: master(a.university_id),
      stage: stages.find((x) => x.code === a.stage)?.name ?? a.stage, student: P.student(a.student_id), university_app_id: a.university_app_id })),
  });
}));

export default router;
