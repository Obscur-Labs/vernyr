import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import archiver from 'archiver';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import Student, { type IStudent } from '../models/Student';
import { Country, Intake, MasterItem } from '../models/Master';
import University from '../models/University';
import Course from '../models/Course';
import { nextCode } from '../models/Timeline';
import {
  Shortlist, SL_STATUS, Application, StageHistory, ChecklistItem, StudentDocument, FeeSummary, Payment, VisaCase,
  type IShortlist, type IApplication, type IStudentDocument, type IVisaCase,
} from '../models/Work';
import { LEVELS } from '../models/Lead';
import { can } from '../config/clientPerms';
import {
  HttpError, bad, fieldErr, forbidden, handle, need, isAdmin, oid, sid, clean, num, istDate, timeline, userNames, nameIn, fullName, encrypt, decrypt, fmtDateTime,
} from '../services/crm';
import { loadStudent, studentScope, passportOf } from '../services/students';
import { systemTask, closeSystemTask, notify, notifyAdmins } from '../services/tasks';
import { stageList } from '../services/masters';
import { checkFile, mergeToPdf, docFor, addVersion, saveAs, deleteUnverifiedFiles, fileUrl, ALLOWED } from '../services/files';
import { fire, ul, esc } from '../services/email';

/** The client's Shortlist (6), Applications (7), Documents (8), Fees (9), Visa (10) (legacy/server/routes/work.js). */
const router = Router();
router.use(authenticate);

const isFalse = (v: unknown) => v === false || v === 'false' || v === '0';
const isTrue = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
const body = (req: AuthRequest) => { const b = { ...req.body }; for (const k of Object.keys(b)) if (b[k] === 'null' || b[k] === 'undefined') b[k] = null; return b; };
const json = (o: unknown) => JSON.parse(JSON.stringify(o)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const idOf = (o: Record<string, unknown>) => ({ ...o, id: String(o._id), _id: undefined, __v: undefined, created_at: o.createdAt, updated_at: o.updatedAt });
const CLOSED = ['rejected', 'withdrawn', 'offer_declined'];
const OFFER_STAGES = ['offer_accepted', 'tuition_paid', 'enrolment_confirmed'];

/** id -> name across masters, countries, intakes, universities, courses (legacy masterName). */
async function names() {
  const [m, c, i, u, k, users] = await Promise.all([MasterItem.find().select('name data').lean(), Country.find().select('name').lean(), Intake.find().select('name').lean(),
    University.find().select('name').lean(), Course.find().select('name').lean(), userNames()]);
  const all = new Map<string, string>();
  for (const arr of [m, c, i, u, k]) for (const x of arr) all.set(String(x._id), x.name);
  const name = (id: unknown) => (id ? all.get(String(id)) ?? '' : '');
  return { name, user: (id: unknown) => nameIn(users, id), masters: m };
}
type Names = Awaited<ReturnType<typeof names>>;

async function stageName(type: 'app_stage' | 'visa_stage', code?: string) { return (await stageList(type)).find((x) => x.code === code)?.name ?? code ?? ''; }
async function stageOrder(type: 'app_stage' | 'visa_stage', code?: string) { return (await stageList(type)).find((x) => x.code === code)?.sort ?? 0; }
async function triggerFor(type: 'app_stage' | 'visa_stage', code: string) { return String(((await stageList(type)).find((x) => x.code === code) as Record<string, unknown> | undefined)?.trigger ?? (type === 'app_stage' ? 'E05' : 'E14')); }

/** loadChild(): the row and its student, after the student access check. */
async function loadChild<T extends { student_id: Types.ObjectId; is_deleted: boolean }>(req: AuthRequest, model: mongoose.Model<T>, id: string, what: string) {
  const row = oid(id) && (await model.findOne({ _id: oid(id), is_deleted: false } as never));
  if (!row) throw new HttpError(404, `${what} not found`);
  const student = await loadStudent(req, String((row as unknown as T).student_id));
  return { row, student };
}

// =====================================================================================
// SHORTLIST
// =====================================================================================
const STOP = new Set(['of', 'in', 'and', 'the', 'for', 'with', 'master', 'masters', 'bachelor', 'bachelors', 'science', 'arts', 'msc', 'bsc', 'ma', 'ba', 'degree', 'program', 'programme', 'course', 'hons', 'honours', 'b', 'm', 'tech', 'btech', 'mtech', 'be', 'me']);
const words = (s?: string) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
const ABBR: Record<string, string> = { cs: 'computer', cse: 'computer', it: 'information', ece: 'electronics', ee: 'electrical', mech: 'mechanical', bba: 'business', mba: 'business', bcom: 'commerce', mcom: 'commerce', com: 'commerce' };
const expand = (ws: string[]) => [...new Set(ws.flatMap((w) => [w, ABBR[w]].filter(Boolean) as string[]))];
function ieltsEquivalent(t: { test_type: string; overall?: number }) {
  if (t.overall === null || t.overall === undefined) return null;
  const o = Number(t.overall);
  if (t.test_type.startsWith('IELTS')) return o;
  const map = (table: number[][]) => { for (const [min, ielts] of table) if (o >= min) return ielts; return 4; };
  if (t.test_type === 'TOEFL iBT') return map([[115, 9], [110, 8.5], [102, 8], [94, 7.5], [79, 6.5], [60, 6], [46, 5.5], [35, 5]]);
  if (t.test_type === 'PTE Academic') return map([[86, 9], [83, 8.5], [79, 8], [73, 7.5], [65, 7], [58, 6.5], [50, 6], [43, 5.5], [36, 5]]);
  if (t.test_type === 'Duolingo') return map([[155, 8.5], [145, 8], [135, 7.5], [125, 7], [115, 6.5], [105, 6], [95, 5.5], [85, 5]]);
  return null;
}
async function shortlistWarnings(s: IStudent, row: Record<string, any>, N: Names) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const w: { code: string; level: string; text: string }[] = [];
  const lvlMap: Record<string, string[]> = { Bachelor: ['Bachelor'], Master: ['Master'], MBA: ['Master'], PhD: ['PhD'], Diploma: ['Diploma', 'Other'] };
  const cw = expand(words(row.course_name_text || N.name(row.course_id)));
  for (const a of s.academics.filter((x) => !x.currently_studying)) {
    if (!(lvlMap[row.level] || []).includes(a.level)) continue;
    const aw = expand(words(a.course_name));
    const mbaAgain = row.level === 'MBA' && /\bmba\b|business administration/i.test(a.course_name || '');
    const overlap = cw.filter((x) => aw.includes(x));
    if (mbaAgain || (overlap.length && overlap.length >= Math.min(cw.length, aw.length, 2)) || (overlap.length && cw.length <= 2)) {
      w.push({ code: 'R1', level: 'red', text: `Student has already completed a similar qualification (${a.level}: ${a.course_name}). Please confirm.` }); break;
    }
  }
  const c = oid(row.country_id) ? await Country.findById(oid(row.country_id)).lean() : null;
  if (c && s.marital_status === 'Married' && s.spouse_travel && c.dependant_visa !== 'Yes') {
    w.push({ code: 'R2', level: 'orange', text: `Spouse may not be able to join on a dependant visa in ${c.name}. Please check before suggesting.${c.dependant_notes ? ' Note: ' + c.dependant_notes : ''}` });
  }
  if (row.deadline && row.deadline < istDate()) w.push({ code: 'R3', level: 'grey', text: 'Deadline passed' });
  if (row.tuition_fee && s.prefs?.budget_tuition_eur && (row.currency || 'EUR') === 'EUR' && Number(row.tuition_fee) > Number(s.prefs.budget_tuition_eur)) w.push({ code: 'R4', level: 'orange', text: 'Above budget' });
  const course = oid(row.course_id) ? await Course.findById(oid(row.course_id)).lean() : null;
  const minIelts = course?.min_english;
  if (minIelts) {
    const best = s.tests.map(ieltsEquivalent).filter((x): x is number => x !== null).sort((a, b) => b - a)[0];
    if (best !== undefined && best < minIelts) w.push({ code: 'R5', level: 'orange', text: `English score below requirement (needs IELTS ${minIelts} or equivalent)` });
  }
  return w;
}
async function slOut(x: IShortlist, s: IStudent, N: Names) {
  return { ...idOf(json(x.toObject())), country: N.name(x.country_id), university: N.name(x.university_id), course: x.course_name_text || N.name(x.course_id), intake: N.name(x.intake_id),
    warnings: await shortlistWarnings(s, json(x.toObject()), N), university_pending: false };
}
router.get('/students/:id/shortlist', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const N = await names();
  const rows = await Shortlist.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: 1 });
  res.json(await Promise.all(rows.map((x) => slOut(x, s, N))));
}));
router.post('/students/:id/shortlist/check', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  res.json(await shortlistWarnings(s, req.body ?? {}, await names()));
}));
async function slValidate(req: AuthRequest, s: IStudent, b: Record<string, any>, N: Names, existingId?: unknown) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {};
  if (!b.country_id) errors.country_id = 'Country is required';
  if (!b.university_id && !clean(b.new_university)) errors.university_id = 'University is required';
  if (!b.course_id && !clean(b.course_name_text)) errors.course_id = 'Course name is required';
  if (!LEVELS.includes(b.level)) errors.level = 'Level is required';
  if (!b.intake_id) errors.intake_id = 'Intake is required';
  if (b.status && !SL_STATUS.includes(b.status)) errors.status = 'Invalid status';
  if (b.course_link && !/^https?:\/\//i.test(b.course_link)) errors.course_link = 'Link must start with http:// or https://';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  // a new university is usable at once and goes to Admin for approval
  if (!b.university_id && clean(b.new_university)) {
    const country = await Country.findById(oid(b.country_id)).lean();
    const name = clean(b.new_university, 150)!;
    const u = await University.create({ name, country: country?.name ?? 'Unknown', slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), source: `added by ${req.user!.name}` });
    b.university_id = String(u._id);
    await notifyAdmins('approval', `New university added by ${req.user!.name} for approval: ${name}`, '/admin/masters/universities');
  }
  const cname = (b.course_id ? N.name(b.course_id) : b.course_name_text || '').toLowerCase();
  const dups = await Shortlist.find({ student_id: s._id, is_deleted: false, university_id: oid(b.university_id), intake_id: oid(b.intake_id), _id: { $ne: existingId ?? null } }).lean();
  if (dups.some((d) => (d.course_name_text || N.name(d.course_id)).toLowerCase() === cname)) throw bad('This university + course + intake is already in the shortlist (R6)');
  const w = await shortlistWarnings(s, b, N);
  if (w.some((x) => x.code === 'R1') && !b.checked_similar) throw bad('Student has already completed a similar qualification. Tick "I have checked" to save.', { errors: { checked_similar: 'Please confirm' }, warnings: w });
  return w;
}
const slFields = (b: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  country_id: oid(b.country_id), university_id: oid(b.university_id), course_id: oid(b.course_id), course_name_text: b.course_id ? undefined : clean(b.course_name_text, 150),
  level: b.level, intake_id: oid(b.intake_id), tuition_fee: num(b.tuition_fee), currency: b.currency || 'EUR', application_fee: num(b.application_fee), app_fee_currency: b.app_fee_currency || b.currency || 'EUR',
  deadline: b.deadline || undefined, course_link: clean(b.course_link, 500), duration: clean(b.duration, 50), language: b.language || undefined, priority: b.priority || undefined,
  status: b.status || 'Suggested', remarks: clean(b.remarks, 1000), checked_similar: !!b.checked_similar, remark_for_student: clean(b.remark_for_student, 500), show_priority_to_student: !!b.show_priority_to_student,
});
router.post('/students/:id/shortlist', handle(async (req, res) => {
  need(req, 'shortlist', 'add');
  const s = await loadStudent(req, req.params.id);
  const b = body(req); const N = await names();
  const w = await slValidate(req, s, b, N);
  const x = await Shortlist.create({ student_id: s._id, ...slFields(b), warning_flags: w.map((y) => y.code), created_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'profile', description: `Shortlist option added: ${N.name(b.university_id)} - ${b.course_name_text || N.name(b.course_id)} (${N.name(b.intake_id)})${w.length ? ` [warnings: ${w.map((y) => y.code).join(', ')}]` : ''}`, user_id: req.user!.id });
  res.json({ id: String(x._id), warnings: w });
}));
router.put('/shortlist/:sid', handle(async (req, res) => {
  need(req, 'shortlist', 'edit');
  const { row, student: s } = await loadChild(req, Shortlist, req.params.sid, 'Shortlist option');
  const b = { ...json(row.toObject()), ...body(req) }; const N = await names();
  const w = await slValidate(req, s, b, N, row._id);
  row.set({ ...slFields(b), warning_flags: w.map((y) => y.code), updated_by: req.user!.id }); await row.save();
  await timeline({ student_id: s._id, type: 'profile', description: `Shortlist option edited: ${N.name(b.university_id)} - ${b.course_name_text || N.name(b.course_id)}`, user_id: req.user!.id });
  res.json({ ok: true, warnings: w });
}));
router.delete('/shortlist/:sid', handle(async (req, res) => {
  need(req, 'shortlist', 'edit');
  const { row, student: s } = await loadChild(req, Shortlist, req.params.sid, 'Shortlist option');
  const N = await names();
  row.set({ is_deleted: true, delete_reason: clean(req.body?.reason) || 'Removed', updated_by: req.user!.id }); await row.save();
  await timeline({ student_id: s._id, type: 'profile', description: `Shortlist option removed: ${N.name(row.university_id)} - ${row.course_name_text || N.name(row.course_id)}`, user_id: req.user!.id });
  res.json({ ok: true });
}));
router.post('/students/:id/shortlist/share', handle(async (req, res) => {
  need(req, 'shortlist', 'edit');
  const s = await loadStudent(req, req.params.id);
  const ids = ((req.body?.ids ?? []) as string[]).map(oid).filter(Boolean);
  const rows = await Shortlist.find({ _id: { $in: ids }, student_id: s._id, is_deleted: false });
  if (!rows.length) throw bad('Select at least one option to share');
  const N = await names();
  // only student-safe columns: no remarks, budget notes or warnings
  const table = `<table style="border-collapse:collapse;width:100%;font-size:13px" cellpadding="6"><tr style="background:#5B56E9;color:#fff"><th align="left">Country</th><th align="left">University</th><th align="left">Course</th><th align="left">Intake</th><th align="left">Tuition fee</th><th align="left">Deadline</th></tr>${
    rows.map((x, i) => `<tr style="background:${i % 2 ? '#f8fafc' : '#fff'}"><td>${esc(N.name(x.country_id))}</td><td>${esc(N.name(x.university_id))}</td><td>${esc(x.course_name_text || N.name(x.course_id))}</td><td>${esc(N.name(x.intake_id))}</td><td>${esc(x.tuition_fee ? `${x.tuition_fee} ${x.currency}` : '-')}</td><td>${esc(x.deadline || '-')}</td></tr>`).join('')}</table>`;
  for (const x of rows) if (x.status === 'Suggested') { x.set({ status: 'Shared with student', shared_at: new Date() }); await x.save(); }
  await timeline({ student_id: s._id, type: 'profile', description: `${rows.length} shortlist option(s) shared with student`, user_id: req.user!.id });
  res.json({ ok: true, email: await fire(req, 'E04', { student_id: s._id }, { shortlist_table: table }, 'Course shortlist shared (E04)') });
}));

// =====================================================================================
// APPLICATIONS
// =====================================================================================
async function offerLetter(appId: unknown) {
  const types = await MasterItem.find({ type: 'document_type', name: { $in: ['Offer letter', 'Conditional offer letter', 'Unconditional offer letter'] } }).select('_id').lean();
  const d = await StudentDocument.findOne({ application_id: appId, document_type_id: { $in: types.map((t) => t._id) }, is_deleted: false, current_version_id: { $ne: null } }).lean();
  return d ? { id: String(d._id), current_version_id: String(d.current_version_id) } : null;
}
async function appOut(a: IApplication, N: Names) {
  const s = await Student.findById(a.student_id).select('first_name middle_name last_name student_code primary_counsellor_id').lean();
  return { ...idOf(json(a.toObject())), portal_secret_enc: undefined, has_portal_secret: !!a.portal_secret_enc, country: N.name(a.country_id), university: N.name(a.university_id),
    course: a.course_name_text || N.name(a.course_id), intake: N.name(a.intake_id), stage_name: await stageName('app_stage', a.stage),
    days_in_stage: Math.floor((Date.now() - +(a.stage_changed_at || a.createdAt)) / 864e5),
    student_name: s ? fullName(s) : '', student_code: s?.student_code, counsellor: N.user(s?.primary_counsellor_id), handled_by_name: N.user(a.handled_by), offer_letter: await offerLetter(a._id) };
}
router.get('/applications', handle(async (req, res) => {
  need(req, 'applications', 'view');
  const q = req.query as Record<string, string>;
  const sf: Record<string, unknown> = { is_deleted: false, ...studentScope(req) };
  if (oid(q.counsellor) && isAdmin(req)) sf.primary_counsellor_id = oid(q.counsellor);
  if (q.q) { const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); sf.$or = [{ first_name: rx }, { last_name: rx }]; }
  const studentIds = await Student.distinct('_id', sf);
  const and: Record<string, unknown>[] = [{ is_deleted: false }, { student_id: { $in: studentIds } }];
  if (q.q) { const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); and[1] = { $or: [{ student_id: { $in: studentIds } }, { application_code: rx }, { university_app_id: rx }] };
    and.push({ student_id: { $in: await Student.distinct('_id', { is_deleted: false, ...studentScope(req) }) } }); }
  if (q.stage) and.push({ stage: { $in: q.stage.split(',') } });
  if (q.visa_stage) and.push({ _id: { $in: await VisaCase.distinct('application_id', { is_deleted: false, stage: { $in: q.visa_stage.split(',') } }) } });
  for (const [k, c] of [['country', 'country_id'], ['university', 'university_id'], ['intake', 'intake_id'], ['student', 'student_id']]) if (oid(q[k])) and.push({ [c]: oid(q[k]) });
  const SORTS: Record<string, string> = { stage: 'stage', applied_date: 'applied_date', created_at: 'createdAt', days: 'stage_changed_at' };
  const size = q.view === 'kanban' ? 500 : [25, 50, 100].includes(Number(q.size)) ? Number(q.size) : 25;
  const page = Math.max(1, Number(q.page) || 1);
  const filter = { $and: and };
  const [total, rows, N, stages] = await Promise.all([
    Application.countDocuments(filter), Application.find(filter).sort({ [SORTS[q.sort] || 'updatedAt']: q.dir === 'asc' ? 1 : -1 }).skip((page - 1) * size).limit(size), names(), stageList('app_stage'),
  ]);
  res.json({ total, page, size, rows: await Promise.all(rows.map((a) => appOut(a, N))), stages });
}));
router.get('/students/:id/applications', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const N = await names();
  const apps = await Application.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: -1 });
  res.json(await Promise.all(apps.map(async (a) => {
    const v = await VisaCase.findOne({ application_id: a._id, is_deleted: false }).sort({ createdAt: -1 }).lean();
    return { ...(await appOut(a, N)), visa: v ? { id: String(v._id), visa_code: v.visa_code, stage: v.stage, attempt_no: v.attempt_no, appointment_at: v.appointment_at, centre: v.centre, stage_name: await stageName('visa_stage', v.stage) } : null,
      visa_ready: OFFER_STAGES.includes(a.stage) };
  })));
}));
router.get('/applications/:aid', handle(async (req, res) => {
  const { row } = await loadChild(req, Application, req.params.aid, 'Application');
  const N = await names();
  const history = await StageHistory.find({ application_id: row._id }).sort({ changed_at: -1 }).lean();
  res.json({ ...(await appOut(row, N)), history: await Promise.all(history.map(async (h) => ({ ...idOf(json(h)), from_name: await stageName('app_stage', h.from_stage), to_name: await stageName('app_stage', h.to_stage), by: N.user(h.changed_by) }))) });
}));

function appValidate(b: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {};
  for (const [k, l] of [['country_id', 'Country'], ['university_id', 'University'], ['level', 'Level'], ['intake_id', 'Intake']]) if (!b[k]) errors[k] = `${l} is required`;
  if (!b.course_id && !clean(b.course_name_text)) errors.course_id = 'Course is required';
  if (isTrue(b.app_fee_paid) && !b.app_fee_paid_date) errors.app_fee_paid_date = 'Paid date is required';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
}
function appFields(b: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const f: Record<string, unknown> = { country_id: oid(b.country_id), university_id: oid(b.university_id), course_id: oid(b.course_id), course_name_text: b.course_id ? undefined : clean(b.course_name_text, 150),
    level: b.level, intake_id: oid(b.intake_id), deadline: b.deadline || undefined, university_app_id: clean(b.university_app_id, 100), portal_ref: clean(b.portal_ref, 300), channel: b.channel || undefined,
    app_fee: num(b.app_fee), app_fee_currency: b.app_fee_currency || 'EUR', app_fee_paid: isTrue(b.app_fee_paid), app_fee_paid_date: b.app_fee_paid_date || undefined, app_fee_paid_by: b.app_fee_paid_by || undefined,
    interview_link: clean(b.interview_link, 300), offer_deadline: b.offer_deadline || undefined, deposit_required: num(b.deposit_required), deposit_currency: b.deposit_currency || 'EUR',
    remarks_internal: clean(b.remarks_internal, 3000), handled_by: oid(b.handled_by) ?? undefined };
  if (b.portal_secret) f.portal_secret_enc = encrypt(String(b.portal_secret));
  if (b.show_university_ref_to_student !== undefined) f.show_university_ref_to_student = isTrue(b.show_university_ref_to_student);
  return f;
}
async function offerDeadlineTask(s: IStudent, a: IApplication, N: Names, byUserId: string) {
  if (!a.offer_deadline || !s.primary_counsellor_id) return;
  const due = new Date(`${a.offer_deadline}T10:00:00+05:30`); due.setDate(due.getDate() - 3);
  await systemTask(`offer-deadline:${a._id}`, { title: `Offer acceptance deadline in 3 days: ${N.name(a.university_id)} (${fullName(s)})`, type: 'Application submission',
    student_id: s._id, application_id: a._id, assigned_to: s.primary_counsellor_id, due_at: due, priority: 'High', reminder: 'At due time' } as never, byUserId);
}
const STAGE_MSG: Record<string, (c: Record<string, string>) => string> = {
  documents_pending: (c) => `We need a few documents to apply:${c.pending_documents_list || ''}`,
  ready_to_apply: () => 'All your documents are ready. We will submit your application shortly.',
  applied: (c) => `Your application has been submitted on ${c.applied_date || ''}. Universities usually take a few weeks to respond.`,
  under_review: () => 'The university is now reviewing your application. We will inform you as soon as we hear back.',
  offer_accepted: () => 'Your acceptance has been recorded. Next step is the tuition fee / deposit.',
  tuition_paid: () => 'Your tuition fee / deposit payment to the university has been recorded. We are waiting for the final enrolment confirmation.',
  enrolment_confirmed: () => 'Your admission is confirmed. We will now focus on your visa.',
  withdrawn: () => 'This application has been withdrawn as discussed with you.',
};
async function appCtx(a: IApplication | Record<string, any>, s: IStudent, N: Names, extra: Record<string, string> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const pending = await StudentDocument.find({ student_id: s._id, is_deleted: false, status: { $in: ['Pending', 'Rejected'] } }).lean();
  const c: Record<string, string> = { university: N.name(a.university_id), course: a.course_name_text || N.name(a.course_id), intake: N.name(a.intake_id), country: N.name(a.country_id),
    stage: await stageName('app_stage', a.stage), applied_date: a.applied_date || '', interview_datetime: a.interview_at ? fmtDateTime(a.interview_at) : '',
    interview_link: a.interview_link || 'Your counsellor will share the details', pending_documents_list: ul(pending.map((d) => d.title || N.name(d.document_type_id))), ...extra };
  if (['conditional_offer', 'unconditional_offer'].includes(a.stage)) {
    c.offer_type = a.stage === 'conditional_offer' ? 'conditional offer' : 'unconditional offer';
    c.offer_conditions_block = a.stage === 'conditional_offer' && a.offer_conditions ? `<p><b>Conditions:</b><br>${esc(a.offer_conditions).replace(/\n/g, '<br>')}</p>` : '';
    c.next_step = a.offer_deadline ? `accept the offer before ${a.offer_deadline}` : 'your counsellor will discuss accepting the offer with you';
  }
  c.stage_message = (STAGE_MSG[a.stage] ?? (() => ''))(c);
  return c;
}
async function createApplication(req: AuthRequest, s: IStudent, b: Record<string, any>, shortlistId?: unknown) { // eslint-disable-line @typescript-eslint/no-explicit-any
  appValidate(b);
  const N = await names();
  const f = appFields(b);
  const a = await Application.create({ application_code: await nextCode('A'), student_id: s._id, shortlist_id: oid(shortlistId) ?? undefined, ...f, stage: 'documents_pending', stage_changed_at: new Date(),
    handled_by: f.handled_by ?? s.primary_counsellor_id, source_channel: b.source_channel || 'counsellor', created_by: req.user!.id });
  await StageHistory.create({ application_id: a._id, to_stage: 'documents_pending', reason: 'Application created', notified: !isFalse(b.notify), changed_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'stage', description: `Application ${a.application_code} created: ${N.name(a.university_id)} - ${a.course_name_text || N.name(a.course_id)} (${N.name(a.intake_id)}), stage Documents pending`, user_id: req.user!.id });
  await ensureChecklist(s, req.user!.id);
  await offerDeadlineTask(s, a, N, req.user!.id);
  await fire(req, 'E05', { student_id: s._id }, await appCtx(a, s, N), `Application ${a.application_code} created (E05)`);
  return String(a._id);
}
router.post('/students/:id/applications', handle(async (req, res) => {
  need(req, 'applications', 'add');
  const s = await loadStudent(req, req.params.id);
  res.json({ id: await createApplication(req, s, body(req)) });
}));
router.post('/shortlist/:sid/create-application', handle(async (req, res) => {
  need(req, 'applications', 'add');
  const { row, student: s } = await loadChild(req, Shortlist, req.params.sid, 'Shortlist option');
  if (row.application_id) throw bad('An application was already created from this option');
  if (row.deadline && row.deadline < istDate() && !req.body?.confirm_deadline) throw bad('The deadline has passed (R3). Confirm to create the application anyway.', { needs_confirm: 'deadline' });
  const id = await createApplication(req, s, { ...json(row.toObject()), app_fee: row.application_fee, app_fee_currency: row.app_fee_currency, notify: req.body?.notify }, row._id);
  row.set({ status: 'Converted to application', application_id: oid(id) }); await row.save();
  res.json({ id });
}));
router.put('/applications/:aid', handle(async (req, res) => {
  need(req, 'applications', 'edit');
  const { row, student: s } = await loadChild(req, Application, req.params.aid, 'Application');
  const before = json(row.toObject());
  const b = { ...before, ...body(req) };
  appValidate(b);
  const f = appFields(b);
  if (req.body?.interview_at) f.interview_at = new Date(req.body.interview_at);
  if (req.body?.offer_conditions !== undefined) f.offer_conditions = clean(req.body.offer_conditions, 3000);
  if (req.body?.applied_date) {
    if (req.body.applied_date > istDate()) throw fieldErr('applied_date', 'Applied date cannot be in the future');
    f.applied_date = req.body.applied_date;
  }
  row.set({ ...f, updated_by: req.user!.id }); await row.save();
  const changed = Object.keys(f).filter((k) => k !== 'portal_secret_enc' && JSON.stringify(f[k] ?? '') !== JSON.stringify(before[k] ?? ''));
  if (changed.length) await timeline({ student_id: s._id, type: 'profile', description: `Application ${row.application_code} updated: ${changed.map((k) => k.replace(/_id$|_/g, ' ').trim()).join(', ')}`, user_id: req.user!.id });
  if (f.offer_deadline && f.offer_deadline !== before.offer_deadline) await offerDeadlineTask(s, row, await names(), req.user!.id);
  res.json({ ok: true });
}));
router.post('/applications/:aid/reveal-secret', handle(async (req, res) => {
  need(req, 'applications', 'edit');
  const { row, student: s } = await loadChild(req, Application, req.params.aid, 'Application');
  await timeline({ student_id: s._id, type: 'profile', description: `${req.user!.name} viewed the portal password of ${row.application_code}`, user_id: req.user!.id });
  res.json({ secret: decrypt(row.portal_secret_enc) });
}));
router.delete('/applications/:aid', handle(async (req, res) => {
  need(req, 'applications', 'delete');
  const { row, student: s } = await loadChild(req, Application, req.params.aid, 'Application');
  if (!clean(req.body?.reason)) throw fieldErr('reason', 'Reason is required');
  row.set({ is_deleted: true, delete_reason: clean(req.body.reason), updated_by: req.user!.id }); await row.save();
  await timeline({ student_id: s._id, type: 'stage', description: `Application ${row.application_code} deleted by Admin (${req.body.reason})`, user_id: req.user!.id });
  res.json({ ok: true });
}));

async function stageChecks(s: IStudent, a: IApplication, b: Record<string, any>, N: Names) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const target = b.stage;
  const stages = await stageList('app_stage');
  if (!stages.find((x) => x.code === target)) throw bad('Invalid stage');
  const problems: string[] = []; const errors: Record<string, string> = {};
  const cur = await stageOrder('app_stage', a.stage), nxt = await stageOrder('app_stage', target);
  const closingFrom = CLOSED.includes(a.stage);
  const backward = !CLOSED.includes(target) && nxt < cur;
  if ((backward || closingFrom || CLOSED.includes(target)) && !clean(b.reason)) errors.reason = closingFrom ? 'Re-opening a closed application needs a reason' : backward ? 'Moving back needs a reason' : 'Reason is required';
  const appliedOrder = await stageOrder('app_stage', 'applied');
  if (!CLOSED.includes(target) && nxt >= appliedOrder && (cur < appliedOrder || closingFrom)) {
    if (!passportOf(s)) problems.push('Passport number is empty');
    const notVerified = (await checklistFor(s, N, a.country_id)).filter((i) => i.required === 'Yes' && (!i.doc || i.doc.status !== 'Verified')).map((i) => i.name);
    if (notVerified.length) problems.push(`Required documents not verified: ${notVerified.join(', ')}`);
    const ad = b.applied_date || a.applied_date;
    if (!ad) errors.applied_date = 'Applied date is required';
    else {
      if (ad > istDate()) errors.applied_date = 'Applied date cannot be in the future';
      const min = new Date(a.createdAt); min.setDate(min.getDate() - 30);
      if (ad < min.toISOString().slice(0, 10)) errors.applied_date = 'Applied date cannot be more than 30 days before the application was created';
    }
  }
  if (target === 'interview' && !b.interview_at && !a.interview_at) errors.interview_at = 'Interview date and time is required';
  if (['conditional_offer', 'unconditional_offer'].includes(target)) {
    if (!(await offerLetter(a._id)) && !b.has_file) problems.push('No offer letter uploaded');
    if (target === 'conditional_offer' && !clean(b.offer_conditions) && !a.offer_conditions) errors.offer_conditions = 'Offer conditions are required';
  }
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const warnings: string[] = [];
  if (OFFER_STAGES.includes(target)) {
    const other = await Application.findOne({ student_id: s._id, intake_id: a.intake_id, _id: { $ne: a._id }, is_deleted: false, stage: { $in: OFFER_STAGES } }).lean();
    if (other) warnings.push(`Another application (${other.application_code}) for the same intake is already in Offer accepted or later.`);
  }
  return { problems, warnings, backward };
}
router.post('/applications/:aid/stage-preview', handle(async (req, res) => {
  need(req, 'applications', 'edit');
  const { row: a, student: s } = await loadChild(req, Application, req.params.aid, 'Application');
  const b = body(req); const N = await names();
  let checks: Record<string, unknown> = { problems: [], warnings: [] };
  try { checks = await stageChecks(s, a, { ...b, has_file: isTrue(b.has_file) }, N); }
  catch (e) { if (!(e instanceof HttpError && e.extra.errors)) throw e; checks.errors = e.extra.errors; }
  // the email preview comes with the email engine (PORTING.md)
  res.json({ ...checks, email: { code: await triggerFor('app_stage', b.stage), subject: null, html: null } });
}));

/** Move an application forward by the system (never backward, never out of a closed stage). */
async function systemStage(req: AuthRequest, s: IStudent, a: IApplication, target: string, reason: string, opts: { close?: boolean; notify?: boolean } = {}) {
  if (!target || a.stage === target) return false;
  if (!opts.close && (CLOSED.includes(a.stage) || (await stageOrder('app_stage', target)) <= (await stageOrder('app_stage', a.stage)))) return false;
  const from = a.stage;
  a.set({ stage: target, stage_changed_at: new Date(), ...(target === 'applied' && !a.applied_date ? { applied_date: istDate() } : {}), ...(['conditional_offer', 'unconditional_offer'].includes(target) ? { offer_type: target } : {}) });
  await a.save();
  await StageHistory.create({ application_id: a._id, from_stage: from, to_stage: target, reason, notified: opts.notify !== false, changed_by: req.user?.id });
  const N = await names();
  await timeline({ student_id: s._id, type: 'stage', description: `Application ${a.application_code} (${N.name(a.university_id)}) moved from ${await stageName('app_stage', from)} to ${await stageName('app_stage', target)}: ${reason}`, user_id: req.user?.id });
  if (opts.notify !== false) await fire(req, await triggerFor('app_stage', target), { student_id: s._id }, await appCtx(a, s, N), `${a.application_code}: ${await stageName('app_stage', target)}`);
  return true;
}
/** Tuition paid for one university: every other open application is closed (offers: declined by student, others: withdrawn). */
async function closeOtherApplications(req: AuthRequest, s: IStudent, kept: IApplication, N: Names) {
  const closed: string[] = [];
  for (const o of await Application.find({ student_id: s._id, _id: { $ne: kept._id }, is_deleted: false, stage: { $nin: CLOSED } })) {
    const target = ['conditional_offer', 'unconditional_offer', 'offer_accepted'].includes(o.stage) ? 'offer_declined' : 'withdrawn';
    if (await systemStage(req, s, o, target, `Closed automatically: the student paid the tuition fee for ${N.name(kept.university_id)} (${kept.application_code})`, { close: true, notify: false })) closed.push(`${o.application_code} ${N.name(o.university_id)}`);
  }
  if (closed.length) await timeline({ student_id: s._id, type: 'stage', description: `Tuition fee paid for ${N.name(kept.university_id)}: other applications closed automatically (${closed.join(', ')})`, user_id: req.user?.id });
  return closed;
}

router.post('/applications/:aid/stage', upload.single('file'), handle(async (req, res) => {
  need(req, 'applications', 'edit');
  const { row: a, student: s } = await loadChild(req, Application, req.params.aid, 'Application');
  const b = body(req); const N = await names();
  b.has_file = !!req.file;
  const checks = await stageChecks(s, a, b, N);
  if (checks.problems.length && !clean(b.override_reason)) throw bad(`${checks.problems.join('. ')}. Give an override reason to continue.`, { needs_override: checks.problems });
  if (checks.warnings.length && !isTrue(b.confirm_warning)) throw bad(checks.warnings.join(' '), { needs_confirm: checks.warnings });
  const from = a.stage;
  const f: Record<string, unknown> = { stage: b.stage, stage_changed_at: new Date(), updated_by: req.user!.id };
  if (b.applied_date) f.applied_date = b.applied_date;
  if (b.interview_at) f.interview_at = new Date(b.interview_at);
  if (b.interview_link) f.interview_link = clean(b.interview_link, 300);
  if (b.offer_conditions) f.offer_conditions = clean(b.offer_conditions, 3000);
  if (b.offer_deadline) f.offer_deadline = b.offer_deadline;
  if (['conditional_offer', 'unconditional_offer'].includes(b.stage)) f.offer_type = b.stage;
  const offerDoc = req.file ? await saveAs(s._id as Types.ObjectId, 'Offer letter', req.file, req.user!.id, { application_id: a._id as Types.ObjectId }) : null;
  a.set(f); await a.save();
  await StageHistory.create({ application_id: a._id, from_stage: from, to_stage: b.stage, reason: clean(b.reason, 1000), notified: !isFalse(b.notify),
    show_reason_to_student: isTrue(b.include_reason), override_reason: checks.problems.length ? clean(b.override_reason, 500) : undefined, changed_by: req.user!.id });
  const desc = `Application ${a.application_code} (${N.name(a.university_id)}) moved from ${await stageName('app_stage', from)} to ${await stageName('app_stage', b.stage)} by ${req.user!.name}${b.reason ? ` - ${b.reason}` : ''}`;
  await timeline({ student_id: s._id, type: 'stage', description: desc, user_id: req.user!.id });
  if (checks.problems.length) await notifyAdmins('override', `${req.user!.name} overrode stage rules on ${a.application_code} (${fullName(s)}): ${checks.problems.join('; ')}. Reason: ${b.override_reason}`, `/students/${s._id}/applications`);
  if (offerDoc) await timeline({ student_id: s._id, type: 'document', description: `Offer letter uploaded for ${a.application_code}`, user_id: req.user!.id });
  if (b.stage === 'interview' && a.interview_at && s.primary_counsellor_id) await systemTask(`interview:${a._id}`, { title: `Interview: ${fullName(s)} with ${N.name(a.university_id)}`, type: 'Application submission',
    student_id: s._id, application_id: a._id, assigned_to: s.primary_counsellor_id, due_at: a.interview_at, priority: 'High', reminder: '1 day before' } as never, req.user!.id);
  if (b.offer_deadline) await offerDeadlineTask(s, a, N, req.user!.id);
  if (OFFER_STAGES.includes(b.stage)) await closeSystemTask(`offer-deadline:${a._id}`);
  if (b.stage === 'tuition_paid') await closeOtherApplications(req, s, a, N);
  const extra: Record<string, string> = b.stage === 'rejected' && isTrue(b.include_reason) && b.reason ? { include_reason_if_ticked: `Reason shared by the university: ${b.reason}` } : {};
  const email = isFalse(b.notify) ? null : await fire(req, await triggerFor('app_stage', b.stage), { student_id: s._id }, await appCtx(a, s, N, extra), `${desc}`);
  const suggest = b.stage === 'enrolment_confirmed' && s.status !== 'Enrolled' && !!(await VisaCase.exists({ student_id: s._id, stage: 'approved', is_deleted: false }));
  res.json({ ok: true, email, suggest_enrolled: suggest });
}));
router.post('/applications/:aid/offer', upload.single('file'), handle(async (req, res) => {
  need(req, 'applications', 'edit');
  const { row: a, student: s } = await loadChild(req, Application, req.params.aid, 'Application');
  if (!req.file) throw bad('Choose the offer letter file (PDF)');
  if (!/\.pdf$/i.test(req.file.originalname)) throw bad('Offer letter must be a PDF');
  const N = await names();
  await saveAs(s._id as Types.ObjectId, 'Offer letter', req.file, req.user!.id, { application_id: a._id as Types.ObjectId });
  await timeline({ student_id: s._id, type: 'document', description: `Offer letter uploaded for ${a.application_code} (${N.name(a.university_id)})`, user_id: req.user!.id });
  const email = ['conditional_offer', 'unconditional_offer'].includes(a.stage) ? await fire(req, 'E07', { student_id: s._id }, await appCtx(a, s, N), 'Offer letter uploaded (E07)') : null;
  res.json({ ok: true, email });
}));

// =====================================================================================
// DOCUMENTS
// =====================================================================================
type CheckItem = { document_type_id: string; name: string; required: string; rule: string; sort: number; visible_student: boolean; note: string | null; stage: string; doc: IStudentDocument | null };
async function checklistFor(s: IStudent, N: Names, onlyCountry?: unknown): Promise<CheckItem[]> {
  const apps = await Application.find({ student_id: s._id, is_deleted: false, stage: { $nin: CLOSED } }).select('country_id level').lean();
  const countries = onlyCountry ? [String(onlyCountry)] : [...new Set([s.prefs?.country_ids?.[0], ...apps.map((x) => x.country_id)].filter(Boolean).map(String))];
  const levels = [...new Set([s.prefs?.level, ...apps.map((x) => x.level)].filter(Boolean) as string[])];
  const items = await ChecklistItem.find({ is_deleted: false, active: true, $and: [
    { $or: [{ country_id: null }, { country_id: { $in: countries.map(oid) } }] },
    { $or: [{ level: null }, { level: { $in: levels } }] },
    { $or: [{ applies_existing: true }, { createdAt: { $lte: s.createdAt } }] },
  ] }).sort({ sort: 1 }).lean();
  const acad = s.academics.map((x) => x.level);
  const hasWork = s.work.length > 0;
  const hasTest = s.tests.some((t) => !['Not taken yet', 'MOI (waiver)'].includes(t.test_type));
  const resolve = (r: string) => (r === 'If Bachelor' ? (acad.includes('Bachelor') ? 'Yes' : 'No') : r === 'If Master' ? (acad.includes('Master') ? 'Yes' : 'No')
    : r === 'If work exp' ? (hasWork ? 'Yes' : 'No') : r === 'If taken' ? (hasTest ? 'Yes' : 'No') : r);
  const activeTypes = new Set(N.masters.filter((m) => (m as { active?: boolean }).active !== false).map((m) => String(m._id)));
  const seen = new Map<string, CheckItem>();
  for (const i of items) {
    const key = String(i.document_type_id);
    if (!activeTypes.has(key)) continue;
    const reqd = resolve(i.required);
    const prev = seen.get(key);
    if (!prev || (prev.required !== 'Yes' && reqd === 'Yes')) seen.set(key, { document_type_id: key, name: N.name(i.document_type_id), required: reqd, rule: i.required, sort: i.sort,
      visible_student: i.visible_student !== false, note: i.note ?? null, stage: i.stage || 'Application', doc: null });
  }
  const list = [...seen.values()].filter((i) => i.required !== 'No').sort((a, b) => a.sort - b.sort);
  for (const i of list) i.doc = await StudentDocument.findOne({ student_id: s._id, document_type_id: oid(i.document_type_id), is_deleted: false }).sort({ current_version_id: -1, updatedAt: -1 });
  return list;
}
async function ensureChecklist(s: IStudent, userId: string) {
  const N = await names();
  for (const item of await checklistFor(s, N)) if (item.required === 'Yes' && !item.doc) await docFor(s._id as Types.ObjectId, oid(item.document_type_id)!, {}, userId);
}
function docOut(d: IStudentDocument, N: Names) {
  const v = d.versions.find((x) => String(x._id) === String(d.current_version_id));
  return { ...idOf(json(d.toObject())), versions: d.versions.length, type_name: N.name(d.document_type_id), name: d.title || N.name(d.document_type_id),
    version_no: v?.version_no ?? null, stored_name: v?.stored_name ?? null, original_name: v?.original_name ?? null, mime_type: v?.mime_type ?? null, size_bytes: v?.size_bytes ?? null,
    uploaded_at: v?.uploaded_at ?? null, uploaded_by_name: v ? (v.uploaded_by_type === 'student' ? 'Student (portal)' : N.user(v.uploaded_by)) : null, by_student: v?.uploaded_by_type === 'student',
    student_note: v?.note_for_counsellor ?? null, verified_by_name: N.user(d.verified_by), view_url: fileUrl(v) };
}
const INST_DOCS: [string, string, string | null][] = [
  ['submission_proof', 'Application submission proof', 'applied'], ['conditional_offer', 'Conditional offer letter', 'conditional_offer'],
  ['unconditional_offer', 'Unconditional offer letter', 'unconditional_offer'], ['student_agreement', 'Student agreement', null],
  ['deposit_invoice', 'Tuition fee deposit invoice from university', null], ['tuition_invoice', 'Tuition fee invoice from institution', null],
  ['loa', 'Letter of admission', null], ['other', 'Other document from institution', null]];
const INST_NAMES = new Set(INST_DOCS.map((x) => x[1]));

router.get('/students/:id/documents', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const N = await names();
  const list = await checklistFor(s, N);
  const inList = new Set(list.map((i) => i.doc && String(i.doc._id)).filter(Boolean));
  const listed = new Set(list.map((i) => i.document_type_id));
  const others = (await StudentDocument.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: 1 }))
    .filter((d) => !inList.has(String(d._id)) && !(listed.has(String(d.document_type_id)) && !d.current_version_id) && !INST_NAMES.has(N.name(d.document_type_id)));
  const required = list.filter((i) => i.required === 'Yes');
  res.json({ checklist: list.map((i) => ({ ...i, doc: i.doc ? docOut(i.doc, N) : null })), others: others.map((d) => docOut(d, N)),
    progress: { verified: required.filter((i) => i.doc?.status === 'Verified').length, total: required.length }, folder: null, drive_sync_status: null });
}));
router.get('/documents', handle(async (req, res) => {
  need(req, 'documents', 'view');
  const sf: Record<string, unknown> = { is_deleted: false, ...studentScope(req) };
  if (oid(req.query.counsellor) && isAdmin(req)) sf.primary_counsellor_id = oid(req.query.counsellor);
  const students = await Student.find(sf).select('first_name middle_name last_name student_code primary_counsellor_id').lean();
  const byId = new Map(students.map((x) => [String(x._id), x]));
  const rows = await StudentDocument.find({ is_deleted: false, student_id: { $in: students.map((x) => x._id) }, status: String(req.query.status || 'Uploaded') }).sort({ updatedAt: -1 }).limit(500);
  const N = await names();
  res.json({ rows: rows.map((d) => { const s = byId.get(String(d.student_id))!; return { ...docOut(d, N), student_name: fullName(s), student_code: s.student_code, counsellor: N.user(s.primary_counsellor_id) }; }), total: rows.length });
}));
async function notifyTeamUpload(req: AuthRequest, s: IStudent, label: string) {
  if (s.primary_counsellor_id && String(s.primary_counsellor_id) !== req.user!.id) await notify(s.primary_counsellor_id, 'doc_uploaded', `${req.user!.name} uploaded ${label} for ${fullName(s)}`, `/students/${s._id}/documents`);
}
router.post('/students/:id/documents/upload', upload.array('files', 20), handle(async (req, res) => {
  need(req, 'documents', 'add');
  const s = await loadStudent(req, req.params.id);
  const b = body(req);
  const fl = (req.files as Express.Multer.File[]) ?? [];
  if (!oid(b.document_type_id)) throw fieldErr('document_type_id', 'Document type is required');
  const t = await MasterItem.findOne({ _id: oid(b.document_type_id), type: 'document_type' }).lean();
  if (!t) throw fieldErr('document_type_id', 'Invalid document type');
  if (t.name === 'Others' && !clean(b.title)) throw fieldErr('title', 'Title is required for Others');
  if (!fl.length) throw fieldErr('files', 'Choose a file');
  const td = (t.data ?? {}) as { allowed?: string[]; max_mb?: number };
  const maxMb = Math.min(25, Number(td.max_mb || 10));
  const checked = fl.map((f) => ({ f, ...checkFile(f, td.allowed ?? ALLOWED, b.merge === '1' ? 25 : maxMb) }));
  const doc = await docFor(s._id as Types.ObjectId, t._id as Types.ObjectId, { title: clean(b.title, 150), application_id: oid(b.application_id), visa_case_id: oid(b.visa_case_id) }, req.user!.id);
  let v;
  if (checked.length > 1 || b.merge === '1') {
    const merged = await mergeToPdf(checked.map((c) => c.f));
    if (merged.length > maxMb * 1024 * 1024) throw bad(`The merged PDF is larger than ${maxMb} MB`);
    v = await addVersion(doc, { buffer: merged, originalname: `merged_${checked.length}_files.pdf`, mimetype: 'application/pdf', size: merged.length }, 'pdf', req.user!.id);
  } else v = await addVersion(doc, checked[0].f, checked[0].ext, req.user!.id);
  if (b.expiry_date) doc.expiry_date = b.expiry_date;
  if (b.remark_internal !== undefined) doc.remark_internal = clean(b.remark_internal, 500);
  if (oid(b.application_id)) doc.application_id = oid(b.application_id)!;
  if (oid(b.visa_case_id)) doc.visa_case_id = oid(b.visa_case_id)!;
  await doc.save();
  await timeline({ student_id: s._id, type: 'document', description: `${doc.title || t.name} uploaded (v${v.version_no}${checked.length > 1 ? `, ${checked.length} files merged` : ''}) as ${v.stored_name}`, user_id: req.user!.id });
  await notifyTeamUpload(req, s, doc.title || t.name);
  res.json({ document_id: String(doc._id), version: v });
}));
router.put('/documents/:did', handle(async (req, res) => {
  need(req, 'documents', 'edit');
  const { row: d } = await loadChild(req, StudentDocument, req.params.did, 'Document');
  const N = await names();
  d.set({ expiry_date: req.body?.expiry_date || undefined, remark_internal: clean(req.body?.remark_internal, 500), updated_by: req.user!.id });
  if (req.body?.title !== undefined && N.name(d.document_type_id) === 'Others') d.title = clean(req.body.title, 150);
  if (req.body?.application_id !== undefined) d.application_id = oid(req.body.application_id) ?? undefined;
  await d.save();
  res.json({ ok: true });
}));
router.post('/documents/:did/verify', handle(async (req, res) => {
  need(req, 'documents', 'edit');
  const { row: d, student: s } = await loadChild(req, StudentDocument, req.params.did, 'Document');
  if (!d.current_version_id) throw bad('Nothing uploaded yet');
  const N = await names();
  const cv = d.versions.find((x) => String(x._id) === String(d.current_version_id));
  if (cv) { cv.version_status = 'Verified'; cv.version_reason = undefined; }
  d.set({ status: 'Verified', verified_by: req.user!.id, verified_at: new Date(), rejection_reason: undefined, rejection_text: undefined }); await d.save();
  const name = d.title || N.name(d.document_type_id);
  await timeline({ student_id: s._id, type: 'document', description: `${name} verified by ${req.user!.name}`, user_id: req.user!.id });
  res.json({ ok: true, email: await fire(req, 'E10', { student_id: s._id }, { document_name: name }, `${name} verified (E10)`) });
}));
router.post('/documents/:did/reject', handle(async (req, res) => {
  need(req, 'documents', 'edit');
  const { row: d, student: s } = await loadChild(req, StudentDocument, req.params.did, 'Document');
  const reason = req.body?.reason;
  if (!reason) throw fieldErr('reason', 'Rejection reason is required');
  if (reason === 'Other' && !clean(req.body.text)) throw fieldErr('text', 'Please describe the reason');
  const reasonText = reason === 'Other' ? clean(req.body.text, 300)! : [reason, clean(req.body.text, 300)].filter(Boolean).join(': ');
  const cv = d.versions.find((x) => String(x._id) === String(d.current_version_id));
  if (cv) { cv.version_status = 'Rejected'; cv.version_reason = reasonText; }
  const rejects = ((d as unknown as { reject_count?: number }).reject_count ?? 0) + 1;
  d.set({ status: 'Rejected', rejection_reason: reason, rejection_text: clean(req.body.text, 300), verified_by: req.user!.id, verified_at: new Date(), reject_count: rejects });
  // a rejected file is not kept: deleted from storage at once (an earlier verified version stays current)
  const purge = await deleteUnverifiedFiles(d);
  if (purge.restored_verified) { d.status = 'Verified'; await d.save(); }
  const N = await names();
  const name = d.title || N.name(d.document_type_id);
  if (rejects >= 3) await notify(req.user!.id, 'suggestion', `Call the student about ${name} (rejected 3 times): ${fullName(s)}`, `/students/${s._id}/documents`);
  await timeline({ student_id: s._id, type: 'document', description: `${name} rejected by ${req.user!.name}: ${reasonText}. The rejected file was deleted${purge.restored_verified ? '; the earlier verified file stays' : ''}.`, user_id: req.user!.id });
  res.json({ ok: true, email: await fire(req, 'E09', { student_id: s._id }, { document_name: name, rejection_reason: reasonText }, `${name} rejected (E09)`) });
}));
router.post('/students/:id/documents/request', handle(async (req, res) => {
  need(req, 'documents', 'add');
  const s = await loadStudent(req, req.params.id);
  const items = ((req.body?.items ?? []) as Record<string, unknown>[]).filter((i) => oid(i.document_type_id));
  if (!items.length) throw bad('Select at least one document');
  const names_: string[] = [];
  for (const i of items) {
    const t = await MasterItem.findOne({ _id: oid(i.document_type_id), type: 'document_type' }).lean();
    if (!t) continue;
    if (t.name === 'Others' && !clean(i.title)) throw bad('Title is required for Others');
    const d = await docFor(s._id as Types.ObjectId, t._id as Types.ObjectId, { title: clean(i.title, 150) }, req.user!.id);
    if (d.status === 'Verified' && !i.again) { names_.push(d.title || t.name); continue; }
    if (d.status !== 'Uploaded') { d.set({ status: d.current_version_id ? d.status : 'Pending', requested_due: req.body.due_date || undefined }); await d.save(); }
    names_.push(d.title || t.name);
  }
  await timeline({ student_id: s._id, type: 'document', description: `Documents requested from student: ${names_.join(', ')}`, user_id: req.user!.id });
  res.json({ ok: true, email: await fire(req, 'E11', { student_id: s._id }, { requested_documents_list: ul(names_), due_date: req.body.due_date || 'as soon as possible' }, 'Documents requested (E11)') });
}));
router.get('/documents/:did/versions', handle(async (req, res) => {
  const { row: d } = await loadChild(req, StudentDocument, req.params.did, 'Document');
  const N = await names();
  res.json([...d.versions].sort((a, b) => b.version_no - a.version_no).map((v) => ({ ...json(v), id: String(v._id), _id: undefined, url: undefined, public_id: undefined,
    uploaded_by_name: v.uploaded_by_type === 'student' ? 'Student (portal)' : N.user(v.uploaded_by), current: String(v._id) === String(d.current_version_id), view_url: fileUrl(v), download_url: fileUrl(v) })));
}));
router.get('/documents/:did/download', handle(async (req, res) => {
  const { row: d } = await loadChild(req, StudentDocument, req.params.did, 'Document');
  const v = d.versions.find((x) => String(x._id) === String(req.query.version || d.current_version_id));
  if (!v?.url) throw new HttpError(404, 'File not found');
  res.json({ url: fileUrl(v) });
}));
router.delete('/documents/:did', handle(async (req, res) => {
  need(req, 'documents', 'delete');
  const { row: d, student: s } = await loadChild(req, StudentDocument, req.params.did, 'Document');
  if (!clean(req.body?.reason)) throw fieldErr('reason', 'Reason is required');
  const N = await names();
  d.set({ is_deleted: true, delete_reason: clean(req.body.reason), updated_by: req.user!.id }); await d.save();
  await timeline({ student_id: s._id, type: 'document', description: `${d.title || N.name(d.document_type_id)} deleted by Admin (${req.body.reason})`, user_id: req.user!.id });
  res.json({ ok: true });
}));
router.get('/students/:id/documents/zip', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const docs = await StudentDocument.find({ student_id: s._id, is_deleted: false, status: 'Verified', current_version_id: { $ne: null } });
  if (!docs.length) throw bad('No verified documents to download');
  const name = `${fullName(s)} (${passportOf(s) || 'Passport pending'}).zip`.replace(/[\\/:*?"<>|]/g, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  const z = new (archiver as unknown as { ZipArchive: new (o: object) => archiver.Archiver }).ZipArchive({ zlib: { level: 6 } });
  z.pipe(res);
  for (const d of docs) {
    const v = d.versions.find((x) => String(x._id) === String(d.current_version_id));
    const url = fileUrl(v);
    if (!url || !v) continue;
    const r = await fetch(url);
    if (r.ok) z.append(Buffer.from(await r.arrayBuffer()), { name: v.stored_name || `${d._id}.pdf` });
  }
  await z.finalize();
}));

// institution documents: uploaded once by the counsellor, linked to one application, may move its stage
router.get('/students/:id/institution-documents', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const N = await names();
  const apps = await Application.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: 1 }).lean();
  const rows = (await StudentDocument.find({ student_id: s._id, is_deleted: false, current_version_id: { $ne: null } }).sort({ updatedAt: -1 })).filter((d) => INST_NAMES.has(N.name(d.document_type_id)));
  res.json({
    categories: await Promise.all(INST_DOCS.map(async ([key, name, stage]) => ({ key, name, moves_to: stage ? await stageName('app_stage', stage) : null }))),
    rows: rows.map((d) => { const a = apps.find((x) => String(x._id) === String(d.application_id)); const v = d.versions.find((x) => String(x._id) === String(d.current_version_id));
      return { id: String(d._id), category: INST_DOCS.find((x) => x[1] === N.name(d.document_type_id))?.[0], name: N.name(d.document_type_id), title: d.title, application_id: sid(d.application_id),
        application_code: a?.application_code ?? null, university: a ? N.name(a.university_id) : null, shared_with_student: !!d.shared_with_student, uploaded_at: v?.uploaded_at ?? d.updatedAt,
        uploaded_by: N.user(v?.uploaded_by) || 'La Europa', version_no: v?.version_no, versions: d.versions.length, view_url: fileUrl(v) }; }),
    applications: await Promise.all(apps.filter((a) => !CLOSED.includes(a.stage)).map(async (a) => ({ id: String(a._id), label: `${a.application_code} · ${N.name(a.university_id)} · ${await stageName('app_stage', a.stage)}` }))),
  });
}));
router.post('/students/:id/institution-documents', upload.single('file'), handle(async (req, res) => {
  need(req, 'documents', 'edit');
  const s = await loadStudent(req, req.params.id);
  const cat = INST_DOCS.find((x) => x[0] === req.body?.category);
  const errors: Record<string, string> = {};
  if (!cat) errors.category = 'Choose the category';
  const a = oid(req.body?.application_id) ? await Application.findOne({ _id: oid(req.body.application_id), student_id: s._id, is_deleted: false }) : null;
  if (!a) errors.application_id = 'Choose the university / application';
  if (!req.file) errors.file = 'Choose the file';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const share = !isFalse(req.body.share);
  const N = await names();
  const d = await saveAs(s._id as Types.ObjectId, cat![1], req.file!, req.user!.id, { application_id: a!._id as Types.ObjectId, share, title: clean(req.body.title, 150) ?? null });
  await timeline({ student_id: s._id, type: 'document', description: `${cat![1]} uploaded for ${a!.application_code} (${N.name(a!.university_id)})${share ? ', shared with the student' : ''}`, user_id: req.user!.id });
  const moved = cat![2] ? await systemStage(req, s, a!, cat![2], `${cat![1]} uploaded`, { notify: !isFalse(req.body.notify) }) : false;
  res.json({ ok: true, document_id: d.document_id, stage_moved_to: moved ? await stageName('app_stage', cat![2]!) : null });
}));

// =====================================================================================
// FEES
// =====================================================================================
const PAY_FOR = ['Tuition fee / deposit', 'Application fee', 'La Europa service fee', 'Other'];
const CURRENCIES = ['INR', 'EUR', 'CNY', 'USD'];
async function feeData(s: IStudent, req: AuthRequest) {
  const N = await names();
  const [sums, pays, apps] = await Promise.all([
    FeeSummary.find({ student_id: s._id, is_deleted: false }).lean(),
    Payment.find({ student_id: s._id, is_deleted: false }).sort({ payment_date: -1, createdAt: -1 }).lean(),
    Application.find({ student_id: s._id, is_deleted: false }).lean(),
  ]);
  const tuition = await Promise.all(apps.map(async (a) => {
    const sm = sums.find((x) => x.fee_kind === 'tuition' && String(x.application_id) === String(a._id)) ?? null;
    const ps = pays.filter((p) => String(p.application_id) === String(a._id) && p.payment_for === 'Tuition fee / deposit');
    const cur = sm?.currency || 'EUR';
    const paid = ps.filter((p) => p.currency === cur).reduce((n, p) => n + p.amount, 0);
    const other: Record<string, number> = {}; ps.filter((p) => p.currency !== cur).forEach((p) => { other[p.currency] = (other[p.currency] || 0) + p.amount; });
    const total = sm ? (sm.total_amount || 0) - (sm.scholarship || 0) : null;
    const pending = sm && total !== null ? Math.max(0, total - paid) : null;
    return { application_id: String(a._id), application_code: a.application_code, university: N.name(a.university_id), course: a.course_name_text || N.name(a.course_id), stage: await stageName('app_stage', a.stage),
      summary: sm ? idOf(json(sm)) : null, currency: cur, paid, paid_other: other, pending, overdue: !!(sm && pending && sm.deposit_deadline && sm.deposit_deadline < istDate()) };
  }));
  const sm = sums.find((x) => x.fee_kind === 'service') ?? null;
  const spaid = pays.filter((p) => p.payment_for === 'La Europa service fee' && p.currency === 'INR').reduce((n, p) => n + p.amount, 0);
  const stotal = sm ? (sm.total_amount || 0) - (sm.discount_approved ? sm.discount || 0 : 0) : null;
  const service = { summary: sm ? { ...idOf(json(sm)), package_name: N.name(sm.package_id) } : null, paid: spaid, pending: sm && stotal !== null ? Math.max(0, stotal - spaid) : null, net_total: stotal };
  const byCurrency: Record<string, number> = {};
  for (const p of pays) { const k = `${p.payment_for}|${p.currency}`; byCurrency[k] = (byCurrency[k] || 0) + p.amount; }
  const receipt = async (id: unknown) => { if (!id) return null; const d = await StudentDocument.findById(id); return d ? fileUrl(d.versions.find((v) => String(v._id) === String(d.current_version_id))) : null; };
  return { tuition, service,
    payments: await Promise.all(pays.map(async (p) => ({ ...idOf(json(p)), application_code: apps.find((a) => String(a._id) === String(p.application_id))?.application_code ?? null,
      created_by_name: N.user(p.created_by), editable: isAdmin(req) || (String(p.created_by) === req.user!.id && Date.now() - +p.createdAt < 48 * 3600e3 && can(req.user!.role, 'fees', 'edit')),
      receipt_url: await receipt(p.receipt_document_id) }))),
    totals: Object.entries(byCurrency).map(([k, v]) => { const [f, c] = k.split('|'); return { payment_for: f, currency: c, amount: v }; }), tuition_only: false };
}
router.get('/students/:id/fees', handle(async (req, res) => {
  need(req, 'fees', 'view');
  const s = await loadStudent(req, req.params.id);
  res.json(await feeData(s, req));
}));
router.post('/students/:id/fee-summary', handle(async (req, res) => {
  need(req, 'fees', 'edit');
  const s = await loadStudent(req, req.params.id);
  const b = req.body ?? {};
  const kind = b.fee_kind === 'service' ? 'service' : 'tuition';
  if (kind === 'tuition' && !oid(b.application_id)) throw fieldErr('application_id', 'Application is required');
  if (kind === 'tuition' && !(await Application.exists({ _id: oid(b.application_id), student_id: s._id }))) throw forbidden();
  if (num(b.total_amount) === undefined || num(b.total_amount)! < 0) throw fieldErr('total_amount', kind === 'tuition' ? 'Total tuition fee is required' : 'Total service fee agreed is required');
  const appId = kind === 'tuition' ? oid(b.application_id) : null;
  const ex = await FeeSummary.findOne({ student_id: s._id, fee_kind: kind, application_id: appId, is_deleted: false });
  const f: Record<string, unknown> = { student_id: s._id, application_id: appId ?? undefined, fee_kind: kind, total_amount: num(b.total_amount),
    currency: kind === 'service' ? 'INR' : CURRENCIES.includes(b.currency) ? b.currency : 'EUR', deposit_required: num(b.deposit_required), deposit_deadline: b.deposit_deadline || undefined,
    scholarship: num(b.scholarship), package_id: oid(b.package_id) ?? undefined, next_instalment_due: b.next_instalment_due || undefined, updated_by: req.user!.id };
  if (kind === 'service') {
    f.discount = num(b.discount);
    const changed = !ex || (ex.discount || 0) !== (f.discount || 0);
    if (changed && f.discount) {
      if (!clean(b.discount_reason) && !isAdmin(req)) throw fieldErr('discount_reason', 'Reason for the discount is required (internal)');
      // the role's discount approval limit (admin console) arrives with the console; until then Admin approves any discount set by others
      f.discount_approved = isAdmin(req);
    } else if (changed) f.discount_approved = true;
  }
  if (ex) { ex.set(f); await ex.save(); } else await FeeSummary.create({ ...f, created_by: req.user!.id });
  const N = await names();
  if (kind === 'service' && f.discount_approved === false) await notifyAdmins('approval', `Discount approval needed: ₹${f.discount} for ${fullName(s)} (${s.student_code}) by ${req.user!.name}`, '/console/approvals');
  if (f.deposit_deadline && s.primary_counsellor_id) {
    const due = new Date(`${f.deposit_deadline}T10:00:00+05:30`); due.setDate(due.getDate() - 5);
    const a = await Application.findById(appId).lean();
    await systemTask(`deposit:${appId}`, { title: `Deposit deadline in 5 days: ${N.name(a?.university_id)} (${fullName(s)})`, type: 'Other', student_id: s._id, application_id: appId, assigned_to: s.primary_counsellor_id, due_at: due, priority: 'High' } as never, req.user!.id);
  }
  if (f.next_instalment_due && s.primary_counsellor_id) await systemTask(`instalment:${s._id}`, { title: `Service fee instalment due: ${fullName(s)}`, type: 'Other', student_id: s._id, assigned_to: s.primary_counsellor_id, due_at: new Date(`${f.next_instalment_due}T10:00:00+05:30`), priority: 'Medium' } as never, req.user!.id);
  await timeline({ student_id: s._id, type: 'payment', description: `${kind === 'tuition' ? 'Tuition fee summary' : 'Service fee'} updated: total ${f.total_amount} ${f.currency}`, user_id: req.user!.id });
  res.json({ ok: true, discount_pending: f.discount_approved === false });
}));
router.post('/fee-summaries/:fid/approve-discount', handle(async (req, res) => {
  if (!isAdmin(req)) throw forbidden();
  const row = oid(req.params.fid) && (await FeeSummary.findById(oid(req.params.fid)));
  if (!row) throw new HttpError(404, 'Not found');
  const s = await loadStudent(req, String(row.student_id));
  const approve = req.body?.approve !== false;
  row.set({ discount_approved: approve, discount: approve ? row.discount : 0, updated_by: req.user!.id }); await row.save();
  await timeline({ student_id: s._id, type: 'payment', description: `Service fee discount ${approve ? 'approved' : 'rejected'} by ${req.user!.name}`, user_id: req.user!.id });
  res.json({ ok: true });
}));
function payValidate(b: Record<string, any>, receiptPresent: boolean, existing?: { receipt_document_id?: unknown }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {};
  if (!PAY_FOR.includes(b.payment_for)) errors.payment_for = 'Payment for is required';
  if (['Tuition fee / deposit', 'Application fee'].includes(b.payment_for) && !b.application_id) errors.application_id = 'Application is required';
  const amt = num(b.amount);
  if (amt === undefined || amt <= 0 || Math.round(amt * 100) !== amt * 100) errors.amount = 'Amount must be more than 0 (max 2 decimals)';
  if (!CURRENCIES.includes(b.currency)) errors.currency = 'Currency is required';
  if (!b.payment_date) errors.payment_date = 'Payment date is required'; else if (b.payment_date > istDate()) errors.payment_date = 'Payment date cannot be in the future';
  if (!b.mode) errors.mode = 'Payment mode is required';
  if (b.payment_for === 'Tuition fee / deposit' && !receiptPresent && !existing?.receipt_document_id) errors.receipt = 'Receipt is required for tuition fee';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
}
/** Record a payment (staff form, or a student's payment proof) and send E12 / E13. */
async function recordPayment(req: AuthRequest, s: IStudent, b: Record<string, any>, receipt?: unknown, receiptPresent = false) { // eslint-disable-line @typescript-eslint/no-explicit-any
  payValidate(b, receiptPresent || !!receipt);
  if (oid(b.application_id) && !(await Application.exists({ _id: oid(b.application_id), student_id: s._id }))) throw forbidden();
  const p = await Payment.create({ payment_submission_id: oid(b.payment_submission_id) ?? undefined, student_id: s._id, application_id: oid(b.application_id) ?? undefined, payment_for: b.payment_for, amount: num(b.amount), currency: b.currency, payment_date: b.payment_date,
    mode: b.mode, paid_by: b.paid_by || undefined, reference_no: clean(b.reference_no, 100), receipt_document_id: oid(receipt) ?? undefined, instalment_no: num(b.instalment_no), remarks: clean(b.remarks, 500), created_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'payment', description: `Payment recorded: ${b.payment_for} ${b.amount} ${b.currency} on ${b.payment_date} (${b.mode})`, user_id: req.user!.id });
  const fd = await feeData(s, req);
  let email = null;
  if (b.payment_for === 'Tuition fee / deposit') {
    const t = fd.tuition.find((x) => x.application_id === b.application_id);
    email = await fire(req, 'E12', { student_id: s._id }, { university: t?.university ?? '', amount: Number(b.amount).toLocaleString('en-IN'), currency: b.currency, payment_date: b.payment_date,
      pending_amount: t && t.pending !== null && t.currency === b.currency ? t.pending.toLocaleString('en-IN') : 'to be confirmed' }, 'Tuition payment recorded (E12)');
  } else if (b.payment_for === 'La Europa service fee') {
    email = await fire(req, 'E13', { student_id: s._id }, { amount: Number(b.amount).toLocaleString('en-IN'), currency: b.currency, payment_date: b.payment_date,
      pending_amount: fd.service.pending !== null ? fd.service.pending.toLocaleString('en-IN') : '0' }, 'Service fee payment recorded (E13)');
  }
  return { id: String(p._id), email };
}
router.post('/students/:id/payments', upload.single('receipt'), handle(async (req, res) => {
  need(req, 'fees', 'add');
  const s = await loadStudent(req, req.params.id);
  const b = body(req);
  payValidate(b, !!req.file);
  const receipt = req.file ? (await saveAs(s._id as Types.ObjectId, 'Fee receipt', req.file, req.user!.id, { application_id: oid(b.application_id) ?? undefined })).document_id : undefined;
  res.json(await recordPayment(req, s, b, receipt, !!req.file));
}));
router.put('/payments/:pid', upload.single('receipt'), handle(async (req, res) => {
  const { row: p, student: s } = await loadChild(req, Payment, req.params.pid, 'Payment');
  if (!isAdmin(req) && !(String(p.created_by) === req.user!.id && Date.now() - +p.createdAt < 48 * 3600e3 && can(req.user!.role, 'fees', 'edit'))) throw bad('Payments can be edited only within 48 hours by the person who recorded them. After that only Admin can edit.');
  const b = { ...json(p.toObject()), ...body(req) };
  payValidate(b, !!req.file, p);
  p.set({ application_id: oid(b.application_id) ?? undefined, payment_for: b.payment_for, amount: num(b.amount), currency: b.currency, payment_date: b.payment_date, mode: b.mode,
    paid_by: b.paid_by || undefined, reference_no: clean(b.reference_no, 100), instalment_no: num(b.instalment_no), remarks: clean(b.remarks, 500), updated_by: req.user!.id });
  if (req.file) p.receipt_document_id = oid((await saveAs(s._id as Types.ObjectId, 'Fee receipt', req.file, req.user!.id, { application_id: p.application_id })).document_id)!;
  await p.save();
  await timeline({ student_id: s._id, type: 'payment', description: `Payment edited: ${p.payment_for} ${p.amount} ${p.currency}`, user_id: req.user!.id });
  res.json({ ok: true });
}));
router.delete('/payments/:pid', handle(async (req, res) => {
  need(req, 'fees', 'delete');
  const { row: p, student: s } = await loadChild(req, Payment, req.params.pid, 'Payment');
  if (!clean(req.body?.reason)) throw fieldErr('reason', 'Reason is required');
  p.set({ is_deleted: true, delete_reason: clean(req.body.reason), updated_by: req.user!.id }); await p.save();
  await timeline({ student_id: s._id, type: 'payment', description: `Payment deleted by Admin: ${p.payment_for} ${p.amount} ${p.currency} (${req.body.reason})`, user_id: req.user!.id });
  res.json({ ok: true });
}));

// =====================================================================================
// VISA
// =====================================================================================
async function visaOut(v: IVisaCase, N: Names, withHistory = true) {
  const s = await Student.findById(v.student_id).select('first_name middle_name last_name student_code primary_counsellor_id').lean();
  const a = v.application_id ? await Application.findById(v.application_id).select('application_code university_id').lean() : null;
  const docUrl = async (typeName: string) => { const t = await MasterItem.findOne({ type: 'document_type', name: typeName }).select('_id').lean(); if (!t) return null;
    const d = await StudentDocument.findOne({ visa_case_id: v._id, document_type_id: t._id, is_deleted: false }); return d ? fileUrl(d.versions.find((x) => String(x._id) === String(d.current_version_id))) : null; };
  return { ...idOf(json(v.toObject())), country: N.name(v.country_id), stage_name: await stageName('visa_stage', v.stage), application_code: a?.application_code ?? null,
    university: a ? N.name(a.university_id) : '', student_name: s ? fullName(s) : '', student_code: s?.student_code, counsellor: N.user(s?.primary_counsellor_id), is_germany: N.name(v.country_id) === 'Germany',
    files: { insurance: await docUrl(VISA_FILE_KIND.insurance[1]), accommodation: await docUrl(VISA_FILE_KIND.accommodation[1]), aps: await docUrl(VISA_FILE_KIND.aps[1]),
      cover_letter: await docUrl(VISA_FILE_KIND.cover_letter[1]), decision: await docUrl(VISA_FILE_KIND.decision[1]) },
    ...(withHistory ? { history: await Promise.all((await StageHistory.find({ visa_case_id: v._id }).sort({ changed_at: -1 }).lean()).map(async (h) => ({ ...idOf(json(h)),
      from_name: await stageName('visa_stage', h.from_stage), to_name: await stageName('visa_stage', h.to_stage), by: N.user(h.changed_by) }))) } : {}) };
}
const VISA_FILE_KIND: Record<string, [string, string]> = { insurance: ['insurance_status', 'Visa: Health / travel insurance'], accommodation: ['accommodation_status', 'Visa: Accommodation proof'],
  aps: ['aps_status', 'APS certificate'], cover_letter: ['', 'Visa: Cover letter'], decision: ['', 'Visa: Decision (visa copy / refusal letter)'] };

router.get('/visa', handle(async (req, res) => {
  need(req, 'visa', 'view');
  const sf: Record<string, unknown> = { is_deleted: false, ...studentScope(req) };
  if (oid(req.query.counsellor) && isAdmin(req)) sf.primary_counsellor_id = oid(req.query.counsellor);
  const f: Record<string, unknown> = { is_deleted: false, student_id: { $in: await Student.distinct('_id', sf) } };
  if (req.query.stage) f.stage = { $in: String(req.query.stage).split(',') };
  if (oid(req.query.country)) f.country_id = oid(req.query.country);
  const rows = await VisaCase.find(f).sort({ updatedAt: -1 }).limit(500);
  const N = await names();
  res.json({ rows: await Promise.all(rows.map((v) => visaOut(v, N, false))), total: rows.length });
}));
router.get('/students/:id/visa', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const N = await names();
  const cases = await VisaCase.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: -1 });
  const eligible = await Application.find({ student_id: s._id, is_deleted: false, stage: { $in: OFFER_STAGES } }).lean();
  res.json({ cases: await Promise.all(cases.map((v) => visaOut(v, N))),
    eligible: eligible.map((a) => ({ id: String(a._id), label: `${a.application_code} - ${N.name(a.university_id)} (${N.name(a.country_id)})`, country_id: sid(a.country_id), country: N.name(a.country_id) })) });
}));
async function visaDocsList(countryId: unknown) {
  const items = await ChecklistItem.find({ is_deleted: false, active: true, country_id: countryId }).sort({ sort: 1 }).lean();
  const types = await MasterItem.find({ _id: { $in: items.map((i) => i.document_type_id) }, 'data.visa': true }).select('name').lean();
  return types.length ? types.map((t) => t.name) : ['Passport (full copy)', 'Offer letter / admission letter', 'Proof of funds (bank statement / blocked account / loan sanction)', 'Health / travel insurance', 'Accommodation proof', 'Visa application form and photos'];
}
async function visaCtx(v: IVisaCase | Record<string, any>, N: Names, extra: Record<string, string> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c: Record<string, string> = { country: N.name(v.country_id), visa_stage: await stageName('visa_stage', v.stage), appointment_datetime: v.appointment_at ? fmtDateTime(v.appointment_at) : '',
    appointment_centre: v.centre || '', vfs_reference: v.vfs_reference || '-', submission_date: v.submission_date || '', visa_documents_list: ul(await visaDocsList(v.country_id)), ...extra };
  c.visa_stage_message = v.stage === 'docs_preparation' ? `Please arrange these documents for your visa:${c.visa_documents_list}` : '';
  return c;
}
router.post('/students/:id/visa', handle(async (req, res) => {
  need(req, 'visa', 'add');
  const s = await loadStudent(req, req.params.id);
  const b = req.body ?? {};
  const a = oid(b.application_id) ? await Application.findOne({ _id: oid(b.application_id), student_id: s._id, is_deleted: false }) : null;
  if (!a) throw fieldErr('application_id', 'Linked application is required');
  if (!OFFER_STAGES.includes(a.stage)) throw fieldErr('application_id', 'The application must be in Offer accepted or later');
  if (!b.visa_type) throw fieldErr('visa_type', 'Visa type is required');
  if (await VisaCase.exists({ student_id: s._id, country_id: a.country_id, is_open: true, is_deleted: false })) throw bad('There is already an open visa case for this student and country');
  const N = await names();
  const isDE = N.name(a.country_id) === 'Germany';
  const v = await VisaCase.create({ visa_code: await nextCode('V'), student_id: s._id, application_id: a._id, country_id: a.country_id, visa_type: b.visa_type, stage: 'docs_preparation', attempt_no: 1, is_open: true,
    aps_status: isDE ? 'Not applied' : undefined, insurance_status: 'Not started', accommodation_status: 'Not arranged', created_by: req.user!.id });
  await StageHistory.create({ visa_case_id: v._id, attempt_no: 1, to_stage: 'docs_preparation', reason: 'Visa case opened', notified: !isFalse(b.notify), changed_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'stage', description: `Visa case ${v.visa_code} opened for ${N.name(a.country_id)} (${b.visa_type})`, user_id: req.user!.id });
  await fire(req, 'E14', { student_id: s._id }, await visaCtx(v, N), 'Visa case opened (E14)');
  res.json({ id: String(v._id) });
}));
const VISA_FIELDS = ['visa_type', 'centre', 'vfs_reference', 'funds_type', 'blocked_provider', 'blocked_account_status', 'funds_amount', 'funds_currency', 'insurance_status', 'accommodation_status',
  'aps_status', 'aps_reference', 'aps_date', 'valid_from', 'valid_to', 'travel_date', 'remarks'];
router.put('/visa/:vid', handle(async (req, res) => {
  need(req, 'visa', 'edit');
  const { row: v, student: s } = await loadChild(req, VisaCase, req.params.vid, 'Visa case');
  const N = await names();
  const f: Record<string, unknown> = {};
  for (const k of VISA_FIELDS) if (req.body?.[k] !== undefined) f[k] = k === 'funds_amount' ? num(req.body[k]) : clean(req.body[k], 1000);
  if (f.valid_from && f.valid_to && String(f.valid_to) < String(f.valid_from)) throw fieldErr('valid_to', 'Must be after valid from');
  if (N.name(v.country_id) !== 'Germany') { delete f.aps_status; delete f.aps_reference; delete f.aps_date; }
  const before = json(v.toObject());
  v.set({ ...f, updated_by: req.user!.id }); await v.save();
  const changed = Object.keys(f).filter((k) => String(f[k] ?? '') !== String(before[k] ?? ''));
  if (changed.length) await timeline({ student_id: s._id, type: 'profile', description: `Visa case ${v.visa_code} updated: ${changed.map((k) => k.replace(/_/g, ' ')).join(', ')}`, user_id: req.user!.id });
  if (f.travel_date && f.travel_date !== before.travel_date && s.primary_counsellor_id) await systemTask(`travel:${v._id}`, { title: `Pre-departure checklist: ${fullName(s)} travels ${f.travel_date}`, type: 'Other',
    student_id: s._id, visa_case_id: v._id, assigned_to: s.primary_counsellor_id, due_at: new Date(+new Date(`${f.travel_date}T10:00:00+05:30`) - 7 * 864e5), priority: 'Medium' } as never, req.user!.id);
  res.json({ ok: true });
}));
router.post('/visa/:vid/upload', upload.single('file'), handle(async (req, res) => {
  need(req, 'visa', 'edit');
  const { row: v, student: s } = await loadChild(req, VisaCase, req.params.vid, 'Visa case');
  const kind = VISA_FILE_KIND[req.body?.kind];
  if (!kind) throw bad('Invalid file kind');
  if (!req.file) throw bad('Choose a file');
  const N = await names();
  if (req.body.kind === 'aps' && N.name(v.country_id) !== 'Germany') throw bad('APS is only for Germany');
  await saveAs(s._id as Types.ObjectId, kind[1], req.file, req.user!.id, { visa_case_id: v._id as Types.ObjectId });
  if (req.body.kind === 'insurance') v.insurance_status = 'Purchased';
  if (req.body.kind === 'aps') v.aps_status = 'Certificate received';
  await v.save();
  await timeline({ student_id: s._id, type: 'document', description: `${kind[1]} uploaded for visa case ${v.visa_code}`, user_id: req.user!.id });
  await notifyTeamUpload(req, s, kind[1]);
  res.json({ ok: true });
}));
async function visaChecks(v: IVisaCase, b: Record<string, any>, hasFile: boolean) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {}; const problems: string[] = [];
  const target = b.stage;
  if (!(await stageList('visa_stage')).find((x) => x.code === target)) throw bad('Invalid stage');
  if ((await stageOrder('visa_stage', target)) < (await stageOrder('visa_stage', v.stage)) && target !== 'reapply' && !clean(b.reason)) errors.reason = 'Moving back needs a reason';
  if (target === 'appointment_booked') {
    const at = b.appointment_at || v.appointment_at;
    if (!at) errors.appointment_at = 'Appointment date and time is required';
    else if (b.appointment_at && new Date(b.appointment_at) <= new Date()) errors.appointment_at = 'Appointment must be in the future';
    if (!clean(b.centre) && !v.centre) errors.centre = 'Appointment centre is required';
  }
  if (['approved', 'rejected'].includes(target)) {
    if (!b.decision_date && !v.decision_date) problems.push('Decision date is missing');
    const decisionType = await MasterItem.findOne({ type: 'document_type', name: VISA_FILE_KIND.decision[1] }).select('_id').lean();
    const hasDecision = decisionType && (await StudentDocument.exists({ visa_case_id: v._id, document_type_id: decisionType._id, is_deleted: false, current_version_id: { $ne: null } }));
    if (!hasFile && !hasDecision) problems.push('Decision file (visa copy / refusal letter) is not uploaded');
    if (b.decision_date && b.decision_date > istDate()) errors.decision_date = 'Decision date cannot be in the future';
  }
  if (target === 'approved' && b.valid_from && b.valid_to && b.valid_to < b.valid_from) errors.valid_to = 'Must be after valid from';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  return problems;
}
router.post('/visa/:vid/stage-preview', handle(async (req, res) => {
  const { row: v } = await loadChild(req, VisaCase, req.params.vid, 'Visa case');
  const b = body(req);
  let problems: string[] = []; let errors: unknown = null;
  try { problems = await visaChecks(v, b, isTrue(b.has_file)); } catch (e) { if (!(e instanceof HttpError && e.extra.errors)) throw e; errors = e.extra.errors; }
  res.json({ problems, errors, email: { code: await triggerFor('visa_stage', b.stage), subject: null, html: null } });
}));
router.post('/visa/:vid/stage', upload.single('file'), handle(async (req, res) => {
  need(req, 'visa', 'edit');
  const { row: v, student: s } = await loadChild(req, VisaCase, req.params.vid, 'Visa case');
  const b = body(req);
  const problems = await visaChecks(v, b, !!req.file);
  if (problems.length && !clean(b.override_reason)) throw bad(`${problems.join('. ')}. Give an override reason to continue.`, { needs_override: problems });
  const N = await names();
  const from = v.stage;
  const f: Record<string, unknown> = { stage: b.stage, updated_by: req.user!.id };
  if (b.appointment_at) f.appointment_at = new Date(b.appointment_at);
  for (const k of ['centre', 'vfs_reference', 'submission_date', 'decision_date', 'valid_from', 'valid_to', 'rejection_reason']) if (b[k]) f[k] = clean(b[k], 500);
  if (['approved', 'rejected'].includes(b.stage)) { f.decision = b.stage === 'approved' ? 'Approved' : 'Rejected'; f.is_open = b.stage !== 'approved'; }
  if (req.file) await saveAs(s._id as Types.ObjectId, VISA_FILE_KIND.decision[1], req.file, req.user!.id, { visa_case_id: v._id as Types.ObjectId });
  v.set(f); await v.save();
  await StageHistory.create({ visa_case_id: v._id, attempt_no: v.attempt_no, from_stage: from, to_stage: b.stage, notified: !isFalse(b.notify), changed_by: req.user!.id,
    reason: [clean(b.reason, 500), problems.length ? `Override: ${b.override_reason}` : null].filter(Boolean).join(' | ') || undefined });
  const desc = `Visa ${v.visa_code} (${N.name(v.country_id)}) moved from ${await stageName('visa_stage', from)} to ${await stageName('visa_stage', b.stage)} by ${req.user!.name}${b.reason ? ` - ${b.reason}` : ''}`;
  await timeline({ student_id: s._id, type: 'stage', description: desc, user_id: req.user!.id });
  if (problems.length) await notifyAdmins('override', `${req.user!.name} overrode visa rules on ${v.visa_code} (${fullName(s)}): ${problems.join('; ')}. Reason: ${b.override_reason}`, `/students/${s._id}/visa`);
  if (b.stage === 'appointment_booked' && v.appointment_at && s.primary_counsellor_id) {
    await systemTask(`visa-appt:${v._id}`, { title: `Visa appointment: ${fullName(s)} at ${v.centre}`, type: 'Visa appointment', student_id: s._id, visa_case_id: v._id, assigned_to: s.primary_counsellor_id, due_at: v.appointment_at, priority: 'High', reminder: '1 hour' } as never, req.user!.id);
    for (const d of [2, 1]) { const due = new Date(+v.appointment_at - d * 864e5); if (due > new Date()) await systemTask(`visa-appt-${d}d:${v._id}`, { title: `Reminder: visa appointment in ${d} day${d > 1 ? 's' : ''} - ${fullName(s)}`, type: 'Visa appointment', student_id: s._id, visa_case_id: v._id, assigned_to: s.primary_counsellor_id, due_at: due, priority: 'Medium' } as never, req.user!.id); }
  }
  const extra: Record<string, string> = b.stage === 'rejected' && isTrue(b.include_reason) && b.rejection_reason ? { include_reason_if_ticked: `Reason given: ${b.rejection_reason}` } : {};
  const email = isFalse(b.notify) ? null : await fire(req, await triggerFor('visa_stage', b.stage), { student_id: s._id }, await visaCtx(v, N, extra), desc);
  const suggest = b.stage === 'approved' && s.status !== 'Enrolled' && !!(await Application.exists({ student_id: s._id, stage: 'enrolment_confirmed', is_deleted: false }));
  res.json({ ok: true, email, suggest_enrolled: suggest });
}));
router.post('/visa/:vid/reapply', handle(async (req, res) => {
  need(req, 'visa', 'edit');
  const { row: v, student: s } = await loadChild(req, VisaCase, req.params.vid, 'Visa case');
  if (v.stage !== 'rejected') throw bad('Re-apply is available after a rejection');
  const attempts = [...(v.attempts ?? []), { attempt_no: v.attempt_no, stage: v.stage, appointment_at: v.appointment_at, centre: v.centre, vfs_reference: v.vfs_reference, submission_date: v.submission_date,
    decision: v.decision, decision_date: v.decision_date, rejection_reason: v.rejection_reason, closed_at: new Date() }];
  v.set({ attempt_no: v.attempt_no + 1, stage: 'docs_preparation', is_open: true, appointment_at: undefined, submission_date: undefined, decision: undefined, decision_date: undefined,
    rejection_reason: undefined, vfs_reference: undefined, attempts, updated_by: req.user!.id });
  await v.save();
  await StageHistory.create({ visa_case_id: v._id, attempt_no: v.attempt_no, from_stage: 'rejected', to_stage: 'docs_preparation', reason: clean(req.body?.reason, 500) || `Attempt ${v.attempt_no}`, notified: !isFalse(req.body?.notify), changed_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'stage', description: `Visa ${v.visa_code}: re-apply, attempt ${v.attempt_no} started`, user_id: req.user!.id });
  await fire(req, 'E14', { student_id: s._id }, await visaCtx(v, await names()), 'Visa re-apply (E14)');
  res.json({ ok: true });
}));

export { recordPayment, createApplication, shortlistWarnings, names as workNames, loadChild };
export default router;
