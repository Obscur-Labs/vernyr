import { Router, type Response } from 'express';
import { Types } from 'mongoose';
import Student from '../models/Student';
import Course from '../models/Course';
import { getSetting } from '../models/Audit';
import { Application } from '../models/Work';
import { Intake } from '../models/Master';
import { Campus, CommissionInvoice, CourseChangeRequest, OfferLetter, UniDocRequest, UniMessage, UniNotice, UniNotification, UniProfileRequest, UniversityApplication } from '../models/Partner';
import type { UniRequest } from '../middleware/university';
import { HttpError, handle, istDate, oid } from '../services/crm';
import * as P from '../services/partner';
import { meOut } from './uniAuth';

/** The client's university portal API, part 1 (legacy/server/university/routes.js): me, notifications, dashboard. The university always comes from the token. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const router = Router();
const h = (fn: (req: UniRequest, res: Response) => Promise<void>) => handle(fn as never);
export const role = (req: UniRequest, ...roles: string[]) => { if (!roles.includes(String(req.su.uniRole))) throw new HttpError(403, 'Your role does not allow this action.'); };

// ---------- scope: own university + own campuses (2.7, 14.2) ----------
export const scope = (req: UniRequest): Any => ({ university_id: req.su.universityId, is_deleted: false, ...(req.campuses.length ? { campus_id: { $in: req.campuses.map((c) => new Types.ObjectId(c)) } } : {}) });
export async function loadUA(req: UniRequest, id: unknown) {
  const ua = oid(id) ? await UniversityApplication.findOne({ _id: oid(id), is_deleted: false }) : null;
  if (!ua || String(ua.university_id) !== String(req.su.universityId) || (req.campuses.length && !req.campuses.includes(String(ua.campus_id)))) throw P.NotFound();
  return ua;
}
/** retention (14.7): access to the record after a final decision */
export async function accessEnded(ua: Any, u: Any) {
  const months = Number(u.doc_access_months || (await getSetting('uni_access_months')) || 0);
  if (!months) return false;
  const span = months * 30.44 * 864e5;
  if (['Rejected', 'Withdrawn'].includes(ua.status)) return Date.now() - new Date(ua.status_changed_at).getTime() > span;
  if (ua.status === 'Enrolled') { const base = u.doc_access_rule === 'intake' ? ua.programme_start || ua.enrol_date : ua.enrol_date; return !!base && Date.now() - new Date(base).getTime() > span; }
  return false;
}
export const unreadFor = (uaId: unknown) => UniMessage.countDocuments({ uapp_id: uaId, sender_type: 'staff', seen_by_uni_at: null, deleted_at: null });
export const openReq = (uaId: unknown) => UniDocRequest.findOne({ uapp_id: uaId, status: { $in: ['Open', 'Partly fulfilled'] } }).sort({ createdAt: -1 }).lean();
/** intake and course names in one read */
export async function names() {
  const [ints, crs] = await Promise.all([Intake.find().select('name').lean(), Course.find().select('name').lean()]);
  const m = new Map<string, string>([...ints.map((x: Any) => [String(x._id), x.name] as [string, string]), ...crs.map((x: Any) => [String(x._id), x.name] as [string, string])]);
  return (id: unknown) => (id ? m.get(String(id)) ?? '' : '');
}

// ---------- me / notifications / notices ----------
router.get('/me', h(async (req, res) => {
  const today = istDate();
  const notices = (await UniNotice.find({ $and: [{ $or: [{ university_id: null }, { university_id: req.su.universityId }] }, { $or: [{ active_until: null }, { active_until: { $gte: today } }] }] }).sort({ createdAt: -1 }).limit(3).lean())
    .map((n: Any) => ({ id: String(n._id), title: n.title, body: n.body, created_at: n.createdAt }));
  const idle = Number(await getSetting('uni_idle_min')) || 30;
  res.json({ ...(await meOut(req.su)), preview: req.preview, notices, unread: await UniNotification.countDocuments({ account_id: req.su._id, is_read: false }),
    unread_messages: await UniMessage.countDocuments({ university_id: req.su.universityId, sender_type: 'staff', seen_by_uni_at: null, deleted_at: null }),
    idle_left_sec: Math.max(0, Math.round((idle * 60_000 - (Date.now() - new Date(req.su.lastSeenAt ?? Date.now()).getTime())) / 1000)) });
}));
router.post('/ping', h(async (_req, res) => { res.json({ ok: true }); }));
router.get('/notifications', h(async (req, res) => {
  const rows = await UniNotification.find({ account_id: req.su._id }).sort({ createdAt: -1 }).limit(60).lean();
  res.json({ rows: rows.map((n: Any) => ({ id: String(n._id), title: n.title, link: n.link ?? null, is_read: n.is_read, created_at: n.createdAt })), unread: await UniNotification.countDocuments({ account_id: req.su._id, is_read: false }) });
}));
router.post('/notifications/read', h(async (req, res) => {
  if (req.body?.all) await UniNotification.updateMany({ account_id: req.su._id }, { is_read: true });
  else await UniNotification.updateMany({ account_id: req.su._id, _id: { $in: (req.body?.ids ?? []).map(oid).filter(Boolean) } }, { is_read: true });
  res.json({ ok: true });
}));

// ---------- dashboard (5) ----------
const CARD: [string, string, string[]][] = [['new', 'New applications received', ['New']], ['review', 'Under review', ['Acknowledged', 'Documents requested', 'Under assessment', 'Waitlisted']], ['interview', 'Interview', ['Interview scheduled']],
  ['conditional', 'Conditional offers', ['Conditional offer']], ['unconditional', 'Unconditional offers', ['Unconditional offer']], ['rejected', 'Rejected', ['Rejected']], ['accepted', 'Offers accepted', ['Offer accepted']],
  ['deposit', 'Deposits / tuition paid', ['Deposit received']], ['enrolled', 'Enrolled', ['Enrolled']], ['withdrawn', 'Withdrawn', ['Withdrawn']]];
/** the university's applications joined with their La Europa application, filtered like the client's dashboard */
export async function filtered(req: UniRequest, q: Any): Promise<Any[]> {
  const f = scope(req);
  if (q.campus && oid(q.campus)) f.campus_id = oid(q.campus);
  if (q.from || q.to) f.submitted_at = { ...(q.from ? { $gte: new Date(String(q.from)) } : {}), ...(q.to ? { $lte: new Date(String(q.to) + 'T23:59:59') } : {}) };
  const uas = await UniversityApplication.find(f).lean();
  const apps = new Map((await Application.find({ _id: { $in: uas.map((x: Any) => x.application_id) } }).select('intake_id course_id course_name_text level student_id interview_at').lean()).map((a: Any) => [String(a._id), a]));
  return uas.map((ua: Any) => ({ ...ua, ...(() => { const a: Any = apps.get(String(ua.application_id)) ?? {}; return { intake_id: a.intake_id, course_id: a.course_id, course_name_text: a.course_name_text, level: a.level, student_id: a.student_id, interview_at: a.interview_at }; })() }))
    .filter((x: Any) => (!q.intake || String(x.intake_id) === String(q.intake)) && (!q.course || String(x.course_id) === String(q.course)) && (!q.level || x.level === q.level));
}
function workingDaysSince(d: Date | string) { let t = new Date(d); let n = 0; const end = new Date(); while (t < end) { t = new Date(t.getTime() + 864e5); if (t <= end && ![0, 6].includes(t.getDay())) n++; } return n; }
async function pendingActions(req: UniRequest) {
  const rows = await filtered(req, {});
  const ids = rows.map((x: Any) => x._id);
  const acting = req.su.uniRole !== 'viewer';
  const out: Any[] = [];
  const nAck = Number((await getSetting('uni_ack_days')) || 3);
  const newOnes = rows.filter((x: Any) => x.status === 'New');
  const late = newOnes.filter((x: Any) => workingDaysSince(x.submitted_at || x.createdAt) > nAck);
  if (acting && newOnes.length) out.push({ key: 'new', label: `${newOnes.length} new application(s) not acknowledged${late.length ? ` (${late.length} for more than ${nAck} working days)` : ''}`, red: late.length > 0, link: '/applications?status=New' });
  const reqs = await UniDocRequest.countDocuments({ uapp_id: { $in: ids }, status: { $in: ['Open', 'Partly fulfilled'] } });
  if (reqs) out.push({ key: 'docreq', label: `${reqs} document request(s) waiting for La Europa`, link: '/applications?docreq=1' });
  const answered = await UniDocRequest.countDocuments({ uapp_id: { $in: ids }, status: 'Fulfilled', opened_by_uni_at: null });
  if (acting && answered) out.push({ key: 'docsent', label: `La Europa sent documents for ${answered} application(s): please review`, link: '/applications?answered=1' });
  const wk = new Date(Date.now() + 7 * 864e5);
  const iv = rows.filter((x: Any) => x.status === 'Interview scheduled' && x.interview_at && new Date(x.interview_at) >= new Date() && new Date(x.interview_at) <= wk);
  if (acting && iv.length) out.push({ key: 'interviews', label: `${iv.length} interview(s) this week`, link: '/applications?status=Interview%20scheduled' });
  const accepted = rows.filter((x: Any) => x.status === 'Offer accepted');
  if (acting && accepted.length) out.push({ key: 'accepted', label: `${accepted.length} offer acceptance(s) confirmed: deposit not yet marked`, link: '/applications?status=Offer%20accepted' });
  const dep = rows.filter((x: Any) => x.status === 'Deposit received' && x.programme_start && x.programme_start < istDate());
  if (acting && dep.length) out.push({ key: 'enrol', label: `${dep.length} deposit(s) received and programme started: enrolment not marked`, red: true, link: '/applications?status=Deposit%20received' });
  const follow = await OfferLetter.countDocuments({ uapp_id: { $in: ids }, document_id: null });
  if (acting && follow) out.push({ key: 'letters', label: `${follow} offer letter(s) still to upload`, red: true, link: '/applications' });
  const threads = await UniMessage.distinct('uapp_id', { university_id: req.su.universityId, sender_type: 'staff', seen_by_uni_at: null, deleted_at: null });
  if (threads.length) out.push({ key: 'msgs', label: `Unread messages from La Europa in ${threads.length} thread(s)`, link: '/messages' });
  if (acting) {
    const pc = (await CourseChangeRequest.countDocuments({ university_id: req.su.universityId, status: 'Pending approval', is_deleted: false })) + (await UniProfileRequest.countDocuments({ university_id: req.su.universityId, status: 'Pending' }));
    if (pc) out.push({ key: 'changes', label: `${pc} change(s) waiting for La Europa approval`, link: '/courses?pending=1' });
  }
  if (req.su.finance || req.su.uniRole === 'admin') {
    const inv = await CommissionInvoice.countDocuments({ university_id: req.su.universityId, status: { $in: ['Invoiced', 'Partially paid', 'Overdue'] }, kind: 'invoice' });
    if (inv) out.push({ key: 'inv', label: `${inv} invoice(s) due / overdue`, link: '/finance' });
  }
  return out;
}
router.get('/dashboard', h(async (req, res) => {
  const rows = await filtered(req, req.query);
  const N = await names();
  const week = new Date(Date.now() - 7 * 864e5);
  const changed = (x: Any) => new Date(x.status_changed_at || x.submitted_at || x.createdAt);
  const cards = CARD.map(([key, label, st]) => ({ key, label, statuses: st, count: rows.filter((x: Any) => st.includes(x.status)).length, week: rows.filter((x: Any) => st.includes(x.status) && changed(x) >= week).length }));
  const intakes: Record<string, Record<string, number>> = {};
  for (const x of rows) { const n = N(x.intake_id) || '-'; intakes[n] ??= {}; intakes[n][x.status] = (intakes[n][x.status] || 0) + 1; }
  const stu = new Map((await Student.find({ _id: { $in: rows.map((x: Any) => x.student_id) } }).select('state').lean()).map((s: Any) => [String(s._id), s.state]));
  const states: Record<string, number> = {}; for (const x of rows) { const k = stu.get(String(x.student_id)) || 'Not given'; states[k] = (states[k] || 0) + 1; }
  const small = (await getSetting('uni_small_numbers')) !== '0';
  const courses: Record<string, number> = {}; for (const x of rows) { const n = x.course_name_text || N(x.course_id); courses[n] = (courses[n] || 0) + 1; }
  const funnelSets: [string, string[]][] = [['Received', P.STATUSES], ['Reviewed', P.STATUSES.filter((s) => s !== 'New')], ['Offer', ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled']],
    ['Offer accepted', ['Offer accepted', 'Deposit received', 'Enrolled']], ['Deposit', ['Deposit received', 'Enrolled']], ['Enrolled', ['Enrolled']]];
  const funnel = funnelSets.map(([label, sts]) => ({ label, count: rows.filter((x: Any) => sts.includes(x.status) && x.status !== 'Withdrawn').length }));
  const decided = rows.filter((x: Any) => x.first_decision_at && x.submitted_at);
  const decisionDays = decided.length ? Math.round(decided.reduce((n: number, x: Any) => n + (new Date(x.first_decision_at).getTime() - new Date(x.submitted_at).getTime()) / 864e5, 0) / decided.length * 10) / 10 : null;
  const allIds = await UniversityApplication.find({ university_id: req.su.universityId }).select('application_id').lean();
  const intakeIds = await Application.distinct('intake_id', { _id: { $in: allIds.map((x: Any) => x.application_id) } });
  res.json({ cards, intakes,
    states: Object.entries(states).map(([state, v]) => ({ state, count: small && v < 5 ? 'fewer than 5' : v })).sort((a, b) => (typeof b.count === 'number' ? b.count : 0) - (typeof a.count === 'number' ? a.count : 0)),
    top_courses: Object.entries(courses).map(([course, count]) => ({ course, count })).sort((a, b) => b.count - a.count).slice(0, 10), funnel, decision_days: decisionDays, pending: await pendingActions(req),
    filters: { intakes: intakeIds.filter(Boolean).map((id) => ({ id: String(id), name: N(id) })),
      courses: (await Course.find({ university_id: req.su.universityId, is_deleted: false }).select('name level').sort({ name: 1 }).lean()).map((c: Any) => ({ id: String(c._id), name: c.name, level: c.level })),
      campuses: (await Campus.find({ university_id: req.su.universityId, is_deleted: false }).select('name').lean()).map((c: Any) => ({ id: String(c._id), name: c.name })) } });
}));

export default router;
