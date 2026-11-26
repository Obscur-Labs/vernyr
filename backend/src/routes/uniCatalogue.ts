import { Router, type Response } from 'express';
import dns from 'dns';
import net from 'net';
import ExcelJS from 'exceljs';
import Course from '../models/Course';
import PortalAccount from '../models/PortalAccount';
import { getSetting } from '../models/Audit';
import { Application } from '../models/Work';
import { Intake, MasterItem } from '../models/Master';
import { Campus, CourseChangeRequest, Scholarship, UniContact, UniImportBatch, UniProfileRequest } from '../models/Partner';
import type { UniRequest } from '../middleware/university';
import { upload } from '../middleware/upload';
import { uploadBuffer } from '../config/cloudinary';
import { HttpError, bad, clean, fieldErr, handle, isEmail, istDate, num, oid } from '../services/crm';
import { fmtDate } from '../services/invoicePdf';
import { checkFile } from '../services/files';
import { notify, notifyAdmins } from '../services/tasks';
import { staffEmail } from '../services/uemail';
import { logoOf } from '../services/catalogue';
import { adminIds, approveCourse } from '../services/uniApprovals';
import * as P from '../services/partner';
import { role } from './uni';

/** The client's university portal API, part 4 (legacy/server/university/routes2.js): profile, campuses, contacts, courses with approval, bulk upload, intakes, scholarships. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const router = Router();
const h = (fn: (req: UniRequest, res: Response) => Promise<void>) => handle(fn as never);
const forbid = () => new HttpError(403, 'Your role does not allow course changes.');
export const canProposeCourses = (req: UniRequest) => req.su.uniRole === 'admin' || (req.su.uniRole === 'officer' && !!req.uni.officers_propose);
export const LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];
const LANGS = ['English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Chinese', 'Other'];
const TESTS: Record<string, [number, number, number]> = { 'IELTS Academic': [0, 9, 0.5], 'TOEFL iBT': [0, 120, 1], 'PTE Academic': [10, 90, 1], Duolingo: [10, 160, 5], Other: [0, 1000, 0.01] };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toAdmins = (title: string) => notifyAdmins('university', title, '/admin/uni-approvals');

/** true only for an https URL whose host resolves to public addresses (no localhost, private LAN, link-local or cloud metadata) */
async function publicHttps(u: unknown) {
  let url: URL; try { url = new URL(String(u || '')); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addrs: { address: string }[];
  try { addrs = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true }); } catch { return false; }
  const priv = (a: string) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) || /^(::1?$|f[cd]|fe80:|::ffff:(127|10|192\.168|169\.254)\.)/i.test(a);
  return addrs.length > 0 && !addrs.some((x) => priv(x.address));
}

// ---------- profile (3) ----------
const PROFILE_FIELDS = ['name', 'short_name', 'city', 'uni_type', 'website', 'intl_page', 'about', 'founded_year', 'students_count', 'languages', 'rankings', 'accreditations', 'social'];
async function liveProfile(u: Any) {
  const country = u.country_id ? ((await (await import('../models/Master')).Country.findById(u.country_id).select('name').lean()) as Any)?.name : null;
  return { name: u.name, short_name: u.short_name, city: u.city, uni_type: u.uni_type || u.type, website: u.website, intl_page: u.intl_page, about: u.about, founded_year: u.founded_year, students_count: u.students_count,
    languages: u.languages ?? [], rankings: u.rankings ?? [], accreditations: u.accreditations ?? [], social: u.social ?? [], logo: logoOf(u), country };
}
function profileErrors(p: Any) {
  const e: Record<string, string> = {};
  if (!clean(p.name)) e.name = 'University name is required'; else if (p.name.length > 200) e.name = 'Max 200 characters';
  if (p.short_name && p.short_name.length > 30) e.short_name = 'Max 30 characters';
  if (!clean(p.city)) e.city = 'Main city is required';
  if (!['Public', 'Private'].includes(p.uni_type)) e.uni_type = 'Choose Public or Private';
  if (!/^https:\/\//i.test(p.website || '')) e.website = 'Website must start with https://';
  if (p.intl_page && !/^https:\/\//i.test(p.intl_page)) e.intl_page = 'Link must start with https://';
  const about = String(p.about || '').replace(/<[^>]*>/g, '');
  if (about.length < 100 || about.length > 3000) e.about = 'About must be 100 to 3000 characters';
  if (p.founded_year && !(Number(p.founded_year) >= 1000 && Number(p.founded_year) <= new Date().getFullYear())) e.founded_year = 'Enter a valid year';
  for (const x of p.rankings || []) if (x?.link && !/^https:\/\//i.test(x.link)) e.rankings = 'Ranking links must start with https://';
  return e;
}
const safeAbout = (s: unknown) => String(s || '').replace(/<(?!\/?(b|strong|i|em|ul|ol|li|br|p|a)(\s|>|\/))[^>]*>/gi, '').replace(/\son\w+="[^"]*"/gi, '')
  .replace(/<a\s+[^>]*href="(?!https:\/\/)[^"]*"[^>]*>/gi, '<a>').replace(/<a\s+href="(https:\/\/[^"]+)"[^>]*>/gi, '<a href="$1" target="_blank" rel="noopener">');
const officersEditContacts = async () => (await getSetting('uni_officers_edit_contacts')) === '1';
router.get('/profile', h(async (req, res) => {
  const u = req.uni;
  const pend = (await UniProfileRequest.findOne({ university_id: u._id, status: 'Pending' }).sort({ createdAt: -1 }).lean()) as Any;
  const last = (await UniProfileRequest.findOne({ university_id: u._id, status: { $in: ['Approved', 'Approved with edits', 'Rejected'] } }).sort({ reviewed_at: -1 }).select('status review_note reviewed_at').lean()) as Any;
  res.json({ live: await liveProfile(u.toObject()), pending: pend ? { id: String(pend._id), payload: { ...pend.payload, logo: undefined, cover: undefined }, created_at: pend.createdAt } : null, last_decision: last || null,
    campuses: await Campus.find({ university_id: u._id, is_deleted: false }).sort({ is_main: -1, name: 1 }).lean(),
    contacts: await UniContact.find({ university_id: u._id, is_deleted: false }).sort({ department: 1, is_primary: -1 }).lean(),
    can_edit: req.su.uniRole === 'admin' && !req.preview, can_edit_contacts: req.su.uniRole === 'admin' || (req.su.uniRole === 'officer' && (await officersEditContacts())) });
}));
router.post('/profile/request', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), h(async (req, res) => {
  role(req, 'admin');
  let p: Any = {}; try { p = JSON.parse(String(req.body?.payload || '{}')); } catch { p = {}; }
  for (const k of ['rankings', 'accreditations', 'social', 'languages']) if (!Array.isArray(p[k])) p[k] = [];
  const errors = profileErrors(p); if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  p.about = safeAbout(p.about);
  const keep: Any = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, p[k] ?? null]));
  const fl = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  for (const [k, list] of Object.entries(fl)) {
    const f = list[0]; const { ext } = checkFile(f, ['png', 'jpg', 'jpeg'], k === 'logo' ? 2 : 3);
    const asset = await uploadBuffer({ ...f, originalname: `${k}-${Date.now()}.${ext}` } as Express.Multer.File, `university/${req.su.universityId}/profile`);
    keep[k] = { url: asset.url, public_id: asset.publicId };
  }
  const pend = await UniProfileRequest.findOne({ university_id: req.su.universityId, status: 'Pending' });
  if (pend) { pend.set({ payload: { ...pend.payload, ...keep, logo: keep.logo || pend.payload?.logo, cover: keep.cover || pend.payload?.cover }, requested_by: req.su._id }); await pend.save(); }
  else await UniProfileRequest.create({ university_id: req.su.universityId, payload: keep, old: await liveProfile(req.uni.toObject()), status: 'Pending', requested_by: req.su._id, created_by_type: 'university' });
  await toAdmins(`${P.uniName(req.uni)} submitted profile changes for approval`);
  await P.uaudit(req, 'Create', 'UniversityProfileChangeRequest', req.su.universityId, 'Profile change submitted');
  res.json({ ok: true, message: 'Changes sent to La Europa for approval. Students keep seeing the current profile until then.' });
}));
router.post('/profile/request/withdraw', h(async (req, res) => {
  role(req, 'admin'); await UniProfileRequest.updateMany({ university_id: req.su.universityId, status: 'Pending' }, { status: 'Withdrawn' });
  await P.uaudit(req, 'Update', 'UniversityProfileChangeRequest', null, 'Withdrawn'); res.json({ ok: true });
}));
/** campuses go through approval like the profile (3.5) */
router.post('/campuses', h(async (req, res) => {
  role(req, 'admin');
  const b = req.body ?? {}; const e: Record<string, string> = {};
  if (!clean(b.name)) e.name = 'Campus name is required'; if (!clean(b.city)) e.city = 'City is required';
  if (b.map_link && !/^https:\/\//i.test(b.map_link)) e.map_link = 'Link must start with https://';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const payload = { name: clean(b.name, 150), city: clean(b.city, 100), address: clean(b.address, 300), map_link: clean(b.map_link, 300), is_main: !!b.is_main, status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
  const cur = b.id && oid(b.id) ? ((await Campus.findOne({ _id: oid(b.id), university_id: req.su.universityId }).lean()) as Any) : null; if (b.id && !cur) throw P.NotFound();
  // a campus request carries the campus id in course_id, as in the client
  await CourseChangeRequest.create({ university_id: req.su.universityId, entity: 'campus', course_id: cur?._id, change_type: cur ? 'Edit campus' : 'New campus', payload, old: cur, status: 'Pending approval', requested_by: req.su._id, created_by_type: 'university' });
  await toAdmins(`${P.uniName(req.uni)} submitted a campus change`);
  await P.uaudit(req, 'Create', 'CampusChangeRequest', cur?._id, payload.name); res.json({ ok: true, message: 'Sent to La Europa for approval.' });
}));
/** contacts go live at once, La Europa is told (3.4) */
const DEPTS = ['Admissions', 'International Office', 'Finance / Accounts', 'Scholarships', 'Accommodation', 'Visa / Immigration support', 'Marketing', 'Other'];
router.post('/contacts', h(async (req, res) => {
  if (!(req.su.uniRole === 'admin' || (req.su.uniRole === 'officer' && (await officersEditContacts())))) throw new HttpError(403, 'Your role does not allow this action.');
  const b = req.body ?? {}; const e: Record<string, string> = {};
  if (!DEPTS.includes(b.department)) e.department = 'Choose a department'; if (!clean(b.name)) e.name = 'Name is required'; if (!isEmail(b.email)) e.email = 'Valid email is required';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const own = b.account_id && oid(b.account_id) && (await PortalAccount.exists({ _id: oid(b.account_id), universityId: req.su.universityId }));
  const f = { department: b.department, name: clean(b.name, 100), designation: clean(b.designation, 100), email: String(b.email).trim().toLowerCase(), phone: clean(b.phone, 30), is_primary: !!b.is_primary,
    account_id: own ? b.account_id : undefined, updated_by_type: 'university' };
  let id = b.id as unknown;
  if (id) { const c = oid(id) ? await UniContact.findOne({ _id: oid(id), university_id: req.su.universityId }) : null; if (!c) throw P.NotFound(); if (b.delete) c.set({ is_deleted: true, deleted_at: new Date() }); else c.set(f); await c.save(); }
  else id = (await UniContact.create({ university_id: req.su.universityId, ...f, created_by_type: 'university' }))._id;
  if (f.is_primary && !b.delete) await UniContact.updateMany({ university_id: req.su.universityId, department: f.department, _id: { $ne: id } }, { is_primary: false });
  for (const x of new Set([req.uni.partner_manager_id, ...(await adminIds())].filter(Boolean).map(String))) await notify(x, 'university', `${P.uniName(req.uni)} updated a ${f.department} contact`, '/admin/university');
  await P.uaudit(req, b.delete ? 'Delete' : b.id ? 'Update' : 'Create', 'UniversityContact', id, f.name ?? undefined); res.json({ ok: true });
}));

// ---------- courses (4) ----------
const openReqFilter = { entity: 'course', status: { $in: ['Draft', 'Pending approval'] }, is_deleted: false };
export async function courseOut(c: Any) {
  const pend = (await CourseChangeRequest.findOne({ course_id: c._id, ...openReqFilter }).sort({ createdAt: -1 }).select('change_type createdAt status').lean()) as Any;
  const lastOk = (await CourseChangeRequest.findOne({ course_id: c._id, status: { $in: ['Approved', 'Approved with edits'] } }).sort({ reviewed_at: -1 }).select('reviewed_at').lean()) as Any;
  const inames = new Map((await Intake.find({ _id: { $in: (c.intakes ?? []).map((i: Any) => i.intake_id).filter(Boolean) } }).select('name').lean()).map((x: Any) => [String(x._id), x.name]));
  const intakes = [...(c.intakes ?? [])].sort((a: Any, b: Any) => String(a.deadline || '').localeCompare(String(b.deadline || ''))).map((i: Any) => ({ id: String(i._id), label: inames.get(String(i.intake_id)) || `${MON[(i.month || 1) - 1]} ${i.every_year ? '(every year)' : i.year || ''}`,
    intake_id: i.intake_id ? String(i.intake_id) : null, month: i.month, year: i.year, every_year: !!i.every_year, open_date: i.open_date, deadline: i.deadline, deadline_note: i.deadline_note, status: i.status || 'Open', closed_reason: i.closed_reason,
    open: (i.status || 'Open') === 'Open' && (!i.deadline || i.deadline >= istDate()) }));
  const campus = c.campus_id ? ((await Campus.findById(c.campus_id).select('name').lean()) as Any)?.name : null;
  return { id: String(c._id), code: c.course_uid, name: c.name, level: c.level, field: c.field, field_of_study_id: c.field_of_study_id ? String(c.field_of_study_id) : null, campus_id: c.campus_id ? String(c.campus_id) : null, campus,
    intakes, tuition_fee: c.tuition_fee, currency: c.currency, fee_note: c.fee_note, application_fee: c.application_fee, application_fee_currency: c.application_fee_currency, course_link: c.course_link,
    duration_months: c.duration_months, language: c.language, university_course_code: c.university_course_code, description: c.description, uni_status: c.uni_status || 'Active', seats_for_le: c.seats_for_le, note_for_le: c.note_for_le,
    catalogue_status: pend ? 'Pending approval' : ({ Published: 'Live', Hidden: 'Closed', Archived: 'Archived' } as Record<string, string>)[c.status] || 'Draft', pending: pend ? { id: String(pend._id), change_type: pend.change_type, created_at: pend.createdAt, status: pend.status } : null,
    last_approved_on: lastOk?.reviewed_at ?? null, english: (c.english ?? []).map((e: Any) => ({ test_type: e.test_type, min_overall: e.min_overall, min_band: e.min_band, moi_accepted: !!e.moi_accepted, min_12th_english_percent: e.min_12th_english_percent })),
    academic: c.academic ? { required_level: c.academic.required_level, min_percent: c.academic.min_percent, min_work_months: c.academic.min_work_months, entrance_test: c.academic.entrance_test, note: c.academic.note } : null,
    scholarship: !!c.scholarship, changed_by: c.change_source || null };
}
const fields = async () => (await MasterItem.find({ type: 'field_of_study', active: { $ne: false }, is_deleted: { $ne: true } }).sort({ sort: 1, name: 1 }).select('name').lean()) as Any[];
router.get('/courses', h(async (req, res) => {
  const q = req.query as Any; const f: Any = { university_id: req.su.universityId, is_deleted: false };
  if (q.level) f.level = String(q.level); if (q.campus && oid(q.campus)) f.campus_id = oid(q.campus); if (q.field && oid(q.field)) f.field_of_study_id = oid(q.field);
  if (q.q) { const t = String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); f.$or = [{ name: new RegExp(t, 'i') }, { course_uid: new RegExp(t, 'i') }, { university_course_code: new RegExp(t, 'i') }]; }
  if (q.uni_status) f.uni_status = q.uni_status === 'Active' ? { $ne: 'Closed' } : String(q.uni_status);
  let rows: Any[] = [];
  for (const c of await Course.find(f).sort({ name: 1 }).lean()) rows.push(await courseOut(c));
  if (q.catalogue_status) rows = rows.filter((x) => x.catalogue_status === q.catalogue_status);
  if (q.pending === '1') rows = rows.filter((x) => x.pending);
  const names = new Map((await Course.find({ university_id: req.su.universityId }).select('name').lean()).map((c: Any) => [String(c._id), c.name]));
  const reqs = ((await CourseChangeRequest.find({ university_id: req.su.universityId, is_deleted: false }).sort({ createdAt: -1 }).limit(100).lean()) as Any[])
    .map((x) => ({ id: String(x._id), course_id: x.course_id ? String(x.course_id) : null, entity: x.entity, change_type: x.change_type, status: x.status, review_note: x.review_note, created_at: x.createdAt, reviewed_at: x.reviewed_at, urgent: !!x.urgent,
      course: x.entity === 'course' && x.course_id ? names.get(String(x.course_id)) ?? null : null }));
  const pendNew = ((await CourseChangeRequest.find({ university_id: req.su.universityId, course_id: null, ...openReqFilter }).lean()) as Any[]).map((x) => ({ id: String(x._id), name: x.payload?.name, status: x.status, created_at: x.createdAt }));
  const currencies = ((await MasterItem.find({ type: 'currency', is_deleted: { $ne: true } }).sort({ sort: 1 }).select('name').lean()) as Any[]).map((x) => x.name);
  res.json({ rows, requests: reqs, new_pending: pendNew, can_propose: canProposeCourses(req) && !req.preview,
    options: { levels: LEVELS, languages: LANGS, tests: Object.keys(TESTS), fields: (await fields()).map((x) => ({ id: String(x._id), name: x.name })),
      campuses: ((await Campus.find({ university_id: req.su.universityId, is_deleted: false }).select('name city status').lean()) as Any[]).map((c) => ({ id: String(c._id), name: c.name, city: c.city, status: c.status })),
      currencies: currencies.length ? currencies : ['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN', 'CZK', 'HUF'],
      intakes: ((await Intake.find({ active: { $ne: false } }).sort({ year: 1, month: 1 }).lean()) as Any[]).map((i) => ({ id: String(i._id), name: i.name, month: i.month, year: i.year })) } });
}));
router.get('/courses/requests/:id', h(async (req, res) => {
  const x = oid(req.params.id) ? ((await CourseChangeRequest.findOne({ _id: oid(req.params.id), university_id: req.su.universityId }).lean()) as Any) : null; if (!x) throw P.NotFound();
  res.json({ ...x, id: String(x._id), payload: x.payload, old: x.old ?? null, final: x.final ?? null });
}));
router.get('/courses/:id', h(async (req, res) => {
  const c = oid(req.params.id) ? await Course.findOne({ _id: oid(req.params.id), is_deleted: false }).lean() : null;
  if (!c || String(c.university_id) !== String(req.su.universityId)) throw P.NotFound();
  res.json(await courseOut(c));
}));
/** validation V1 to V8 */
export async function validateCourse(uniId: unknown, b: Any, courseId?: unknown) {
  const e: Record<string, string> = {}; const warn: string[] = [];
  if (!clean(b.name)) e.name = 'Course name is required'; else if (String(b.name).length > 200) e.name = 'Max 200 characters';
  if (!LEVELS.includes(b.level)) e.level = 'Choose the level';
  if (b.name && b.level) {
    const ex = (await Course.findOne({ university_id: uniId, level: b.level, is_deleted: false, name: new RegExp(`^\\s*${String(b.name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), ...(courseId ? { _id: { $ne: courseId } } : {}) }).select('course_uid').lean()) as Any;
    if (ex) e.name = `This course already exists: ${ex.course_uid || ex._id}`;
  }
  if (!/^https:\/\//i.test(b.course_link || '')) e.course_link = 'Please enter a full secure link starting with https://';
  const tf = num(b.tuition_fee); if (tf == null || tf < 0) e.tuition_fee = 'Tuition fee (per year) is required, 0 or more';
  if (!b.currency) e.currency = 'Currency is required';
  const af = num(b.application_fee); if (af == null || af < 0) e.application_fee = 'Application fee is required (0 = free)';
  if (b.fee_note && String(b.fee_note).length > 200) e.fee_note = 'Max 200 characters';
  Object.assign(e, P.feeWordCheck({ fee_note: b.fee_note, tuition_fee: b.tuition_fee_label }));
  if (!['12th', 'Diploma', 'Bachelor', 'Master'].includes(b.required_level)) e.required_level = 'Choose the previous level';
  if (!/^\d+(\.\d+)?$/.test(String(b.min_percent ?? '').trim()) || Number(b.min_percent) < 0 || Number(b.min_percent) > 100) e.min_percent = 'Please enter a percentage between 0 and 100.';
  const eng = (Array.isArray(b.english) ? b.english : []).filter((x: Any) => x && x.test_type);
  const moi = b.moi_accepted === true || b.moi_accepted === 'Yes' || b.moi_accepted === 'true';
  if (!eng.length && !moi) e.english = 'Add at least one English test or tick MOI accepted';
  for (const x of eng) {
    const rg = TESTS[x.test_type]; if (!rg) { e.english = `Unknown test ${x.test_type}`; continue; }
    const mo = num(x.min_overall); if (mo == null || mo < rg[0] || mo > rg[1]) e.english = `${x.test_type} score must be between ${rg[0]} and ${rg[1]}`;
    const mb = num(x.min_band); if (x.min_band !== null && x.min_band !== undefined && x.min_band !== '' && (mb == null || mb < rg[0] || mb > rg[1])) e.english = `${x.test_type} band must be between ${rg[0]} and ${rg[1]}`;
  }
  if (!b.field_of_study_id || !oid(b.field_of_study_id) || !(await MasterItem.exists({ _id: oid(b.field_of_study_id), type: 'field_of_study' }))) e.field_of_study_id = 'Choose the field of study';
  if (!b.campus_id || !oid(b.campus_id) || !(await Campus.exists({ _id: oid(b.campus_id), university_id: uniId, status: 'Active', is_deleted: false }))) e.campus_id = 'Choose an active campus';
  const dm = num(b.duration_months); if (!(dm != null && dm >= 1 && dm <= 96)) e.duration_months = 'Duration must be 1 to 96 months';
  if (!LANGS.includes(b.language)) e.language = 'Choose the language';
  const ints = (Array.isArray(b.intakes) ? b.intakes : []).filter((i: Any) => i && (i.month || i.intake_id));
  if (!ints.length) e.intakes = 'Add at least one intake';
  for (const i of ints) {
    if (!i.deadline) e.intakes = 'Every intake needs an application deadline'; else if (i.open_date && i.open_date > i.deadline) e.intakes = 'Deadline must be after the open date';
    if (i.status === 'Closed' && !i.closed_reason) e.intakes = 'Give the closed reason for closed intakes';
  }
  if (b.description && String(b.description).length > 1500) e.description = 'Max 1500 characters';
  if (b.description && P.feeWordNear(b.description)) warn.push('Fee wording: please show the amount only.');
  if (!['Active', 'Closed'].includes(b.uni_status || 'Active')) e.uni_status = 'Choose Active or Closed';
  return { errors: e, warnings: warn, english: eng as Any[], moi, intakes: ints as Any[] };
}
type V = Awaited<ReturnType<typeof validateCourse>>;
export function payloadOf(b: Any, v: Pick<V, 'english' | 'moi' | 'intakes'>) {
  return { name: clean(b.name, 200), level: b.level, field_of_study_id: b.field_of_study_id, campus_id: b.campus_id, duration_months: num(b.duration_months), language: b.language, course_link: clean(b.course_link, 500),
    tuition_fee: num(b.tuition_fee), currency: b.currency, fee_note: clean(b.fee_note, 200), application_fee: num(b.application_fee), application_fee_currency: b.application_fee_currency || b.currency,
    required_level: b.required_level, min_percent: Number(b.min_percent), academic_note: clean(b.academic_note, 300), moi_accepted: v.moi, min_12th_english_percent: num(b.min_12th_english_percent),
    english: v.english.map((x) => ({ test_type: x.test_type, min_overall: num(x.min_overall), min_band: x.min_band === '' ? null : num(x.min_band) })),
    intakes: v.intakes.map((i) => ({ id: i.id || null, intake_id: i.intake_id || null, month: num(i.month), year: num(i.year), every_year: !!i.every_year, open_date: i.open_date || null, deadline: i.deadline, deadline_note: clean(i.deadline_note, 200),
      status: i.status === 'Closed' ? 'Closed' : 'Open', closed_reason: i.status === 'Closed' ? clean(i.closed_reason, 60) : null })),
    university_course_code: clean(b.university_course_code, 50), description: clean(b.description, 1500), entrance_test: b.entrance_test || null, min_work_months: num(b.min_work_months),
    seats_for_le: num(b.seats_for_le), uni_status: b.uni_status === 'Closed' ? 'Closed' : 'Active', note_for_le: clean(b.note_for_le, 1000) };
}
type Payload = ReturnType<typeof payloadOf>;
/** urgent = close course, close intake, deadline moved earlier (4.5) */
function urgency(c: Any | null, p: Payload) {
  if (!c) return null;
  if (p.uni_status === 'Closed' && (c.uni_status || 'Active') !== 'Closed') return 'Course closed';
  for (const i of p.intakes) {
    const o = (c.intakes ?? []).find((x: Any) => (i.id && String(x._id) === String(i.id)) || (x.intake_id && String(x.intake_id) === String(i.intake_id)) || (x.month === i.month && x.year === i.year)); if (!o) continue;
    if (i.status === 'Closed' && (o.status || 'Open') !== 'Closed') return 'Intake closed';
    if (o.deadline && i.deadline && i.deadline < o.deadline) return `Deadline moved earlier (${fmtDate(o.deadline)} to ${fmtDate(i.deadline)})`;
  }
  return null;
}
const NOT_MINOR = ['english', 'intakes', 'required_level', 'min_percent', 'academic_note', 'moi_accepted', 'min_12th_english_percent', 'entrance_test', 'min_work_months'];
async function submitCourseChange(req: UniRequest, c: Any | null, p: Payload, warnings: string[], batchId?: unknown, draft = false) {
  const type = !c ? 'New course' : p.uni_status === 'Closed' && (c.uni_status || 'Active') !== 'Closed' ? 'Close course' : p.uni_status === 'Active' && c.uni_status === 'Closed' ? 'Re-open course' : 'Edit course';
  const urgent = urgency(c, p);
  // auto-approve minor changes (4.8): only description, fee note or course link changed
  let minor = false;
  if (c && !draft && (await getSetting('uni_auto_approve_minor')) === '1') {
    const cur = (await courseOut(c)) as Any;
    minor = Object.keys(p).filter((k) => !NOT_MINOR.includes(k)).every((k) => ['description', 'fee_note', 'course_link'].includes(k) || JSON.stringify(cur[k] ?? null) === JSON.stringify((p as Any)[k] ?? null));
  }
  const pend = c ? await CourseChangeRequest.findOne({ course_id: c._id, ...openReqFilter }) : null;
  const status = draft ? 'Draft' : 'Pending approval';
  let id: unknown;
  if (pend) { pend.set({ payload: p, change_type: type, urgent: !!urgent, urgent_reason: urgent ?? undefined, warnings, status, requested_by: req.su._id, batch_id: batchId || pend.batch_id }); await pend.save(); id = pend._id; }
  else id = (await CourseChangeRequest.create({ university_id: req.su.universityId, course_id: c?._id, entity: 'course', change_type: type, payload: p, old: c ? await courseOut(c) : undefined, status, urgent: !!urgent, urgent_reason: urgent ?? undefined,
    batch_id: batchId || undefined, requested_by: req.su._id, warnings, created_by_type: 'university' }))._id;
  if (minor) { await approveCourse(id, null, null, { auto: true }); return { id: String(id), auto: true }; }
  if (!draft) {
    if (urgent) {
      await notifyAdmins('university', `URGENT: ${P.uniName(req.uni)} - ${urgent}: ${p.name}`, '/admin/uni-approvals');
      await staffEmail('E48', await adminIds(), { university_id: req.su.universityId, ctx: { change_summary: `${type}: ${p.name}`, urgent_reason: urgent } });
    } else if (!batchId) await toAdmins(`${P.uniName(req.uni)} submitted a course change: ${p.name}`);
  }
  return { id: String(id), urgent };
}
router.post('/courses', h(async (req, res) => {
  if (!canProposeCourses(req)) throw forbid();
  const b = req.body ?? {};
  const c = b.id && oid(b.id) ? ((await Course.findOne({ _id: oid(b.id), is_deleted: false }).lean()) as Any) : null;
  if (b.id && (!c || String(c.university_id) !== String(req.su.universityId))) throw P.NotFound();
  const v = await validateCourse(req.su.universityId, b, c?._id);
  if (Object.keys(v.errors).length) throw bad('Please fix the highlighted fields', { errors: v.errors, warnings: v.warnings });
  const p = payloadOf(b, v);
  const out = await submitCourseChange(req, c, p, v.warnings, null, b.draft === true);
  // link check (warning only); only public https addresses, no redirects
  let linkWarning: string | null = null;
  try {
    if (!(await publicHttps(p.course_link))) throw new Error('not public');
    const r = await fetch(p.course_link!, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(4000) }); if (r.status >= 400) linkWarning = 'We could not open this link. Please check.';
  } catch { linkWarning = 'We could not open this link. Please check.'; }
  await P.uaudit(req, 'Create', 'CourseChangeRequest', out.id, `${c ? 'Edit' : 'New'} course ${p.name}${b.draft ? ' (draft)' : ''}`);
  res.json({ ok: true, ...out, warnings: v.warnings.concat(linkWarning ? [linkWarning] : []), message: 'auto' in out ? 'Minor change published (auto-approved).' : b.draft ? 'Saved as draft.' : 'Sent to La Europa for approval. Students keep seeing the current version until then.' });
}));
router.post('/courses/requests/:id/withdraw', h(async (req, res) => {
  const x = oid(req.params.id) ? await CourseChangeRequest.findOne({ _id: oid(req.params.id), university_id: req.su.universityId, status: { $in: ['Draft', 'Pending approval'] } }) : null; if (!x) throw P.NotFound();
  if (!canProposeCourses(req)) throw new HttpError(403, 'Your role does not allow this action.');
  x.status = 'Withdrawn'; await x.save(); await P.uaudit(req, 'Update', 'CourseChangeRequest', x._id, 'Withdrawn'); res.json({ ok: true });
}));
/** V8: archive only without active La Europa applications; otherwise close */
router.post('/courses/:id/delete', h(async (req, res) => {
  role(req, 'admin');
  const c = oid(req.params.id) ? ((await Course.findOne({ _id: oid(req.params.id), is_deleted: false }).lean()) as Any) : null;
  if (!c || String(c.university_id) !== String(req.su.universityId)) throw P.NotFound();
  if (await Application.exists({ course_id: c._id, is_deleted: false, stage: { $nin: ['rejected', 'withdrawn', 'offer_declined', 'enrolment_confirmed'] } })) throw bad('This course has active applications. You can close it instead.');
  await CourseChangeRequest.create({ university_id: req.su.universityId, course_id: c._id, entity: 'course', change_type: 'Archive request', payload: { archive: true, name: c.name }, status: 'Pending approval', requested_by: req.su._id, created_by_type: 'university' });
  await toAdmins(`${P.uniName(req.uni)} asked to archive the course ${c.name}`); res.json({ ok: true, message: 'Archive request sent to La Europa.' });
}));
/** bulk deadline or close intake for many courses (9.2) */
router.post('/intakes/bulk', h(async (req, res) => {
  if (!canProposeCourses(req)) throw forbid();
  const b = req.body ?? {}; const act = b.action;
  if (!['deadline', 'close'].includes(act)) throw bad('Choose an action');
  if (act === 'deadline' && !b.deadline) throw fieldErr('deadline', 'Choose the new deadline');
  if (act === 'close' && !b.closed_reason) throw fieldErr('closed_reason', 'Choose the closed reason');
  const batch = await UniImportBatch.create({ university_id: req.su.universityId, file_name: `Bulk ${act === 'close' ? 'close intake' : 'set deadline'}`, status: 'Submitted', created_by: req.su._id });
  let n = 0;
  for (const id of (Array.isArray(b.course_ids) ? b.course_ids : []).slice(0, 300)) {
    const c = oid(id) ? ((await Course.findOne({ _id: oid(id), university_id: req.su.universityId, is_deleted: false }).lean()) as Any) : null; if (!c) continue;
    const cur = (await courseOut(c)) as Any;
    const hit = (i: Any) => !b.intake_key || `${i.month}-${i.year}` === b.intake_key || i.intake_id === b.intake_key;
    const intakes = cur.intakes.map((i: Any) => (hit(i) ? { ...i, ...(act === 'deadline' ? { deadline: b.deadline } : { status: 'Closed', closed_reason: b.closed_reason }) } : i));
    const p = payloadOf({ ...cur, required_level: cur.academic?.required_level, min_percent: cur.academic?.min_percent ?? 0, academic_note: cur.academic?.note, english: cur.english, intakes },
      { moi: cur.english.some((x: Any) => x.moi_accepted), english: cur.english.filter((x: Any) => x.test_type), intakes });
    await submitCourseChange(req, c, p, [], batch._id); n++;
  }
  batch.counts = { Update: n }; await batch.save();
  await toAdmins(`${P.uniName(req.uni)} submitted ${n} intake change(s) in one batch`);
  await P.uaudit(req, 'Create', 'CourseChangeBatch', batch._id, `Bulk ${act} (${n})`); res.json({ ok: true, count: n });
}));

// ---------- bulk upload (4.7) ----------
const COURSE_COLS = ['university_course_code', 'course_name', 'level', 'field_of_study', 'campus', 'course_link', 'tuition_fee_per_year', 'tuition_currency', 'fee_note', 'application_fee', 'application_fee_currency',
  'previous_level_required', 'academic_min_percentage', 'moi_accepted', 'duration_months', 'language_of_instruction', 'university_status', 'description'];
export async function templateWorkbook(uniId: unknown, withData: boolean) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'La Europa Partner Portal';
  const head = (ws: ExcelJS.Worksheet) => { const r = ws.getRow(1); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1E3A' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const wc = wb.addWorksheet('Courses'); wc.columns = COURSE_COLS.map((k) => ({ header: k, key: k, width: Math.max(14, k.length + 2) })); head(wc);
  const wi = wb.addWorksheet('Intakes'); wi.columns = ['course_key', 'intake_month', 'intake_year', 'open_date', 'deadline', 'status'].map((k) => ({ header: k, key: k, width: 16 })); head(wi);
  const we = wb.addWorksheet('English'); we.columns = ['course_key', 'test_type', 'min_overall', 'min_band'].map((k) => ({ header: k, key: k, width: 16 })); head(we);
  const camps = ((await Campus.find({ university_id: uniId, is_deleted: false, status: 'Active' }).select('name').lean()) as Any[]).map((x) => x.name);
  if (withData) {
    for (const row of await Course.find({ university_id: uniId, is_deleted: false }).sort({ name: 1 }).lean()) {
      const c = (await courseOut(row)) as Any; const key = c.university_course_code || c.name;
      wc.addRow({ university_course_code: c.university_course_code, course_name: c.name, level: c.level, field_of_study: c.field, campus: c.campus, course_link: c.course_link, tuition_fee_per_year: c.tuition_fee, tuition_currency: c.currency,
        fee_note: c.fee_note, application_fee: c.application_fee, application_fee_currency: c.application_fee_currency, previous_level_required: c.academic?.required_level, academic_min_percentage: c.academic?.min_percent,
        moi_accepted: c.english.some((x: Any) => x.moi_accepted) ? 'Yes' : 'No', duration_months: c.duration_months, language_of_instruction: c.language, university_status: c.uni_status, description: c.description });
      for (const i of c.intakes) wi.addRow({ course_key: key, intake_month: i.month, intake_year: i.year, open_date: i.open_date ? fmtDate(i.open_date) : '', deadline: i.deadline ? fmtDate(i.deadline) : '', status: i.status });
      for (const e of c.english.filter((x: Any) => x.test_type)) we.addRow({ course_key: key, test_type: e.test_type, min_overall: e.min_overall, min_band: e.min_band });
    }
  }
  const hp = wb.addWorksheet('Help'); hp.columns = [{ width: 30 }, { width: 100 }];
  [['Sheet Courses', 'One row per course. Matching key for updates: university_course_code if filled, otherwise course_name + level.'], ['Sheet Intakes', 'course_key = university_course_code (or course_name). Dates DD/MM/YYYY. status Open / Closed.'],
    ['Sheet English', 'course_key, test_type, min_overall, min_band. Not needed if moi_accepted = Yes and no test is required.'], ['level', LEVELS.join(', ')], ['field_of_study', (await fields()).map((x) => x.name).join(', ')],
    ['campus', camps.join(', ') || 'Add campuses in Profile first'], ['previous_level_required', '12th, Diploma, Bachelor, Master'], ['academic_min_percentage', 'Number 0 to 100 (percentage only, no CGPA)'], ['moi_accepted', 'Yes / No'],
    ['language_of_instruction', LANGS.join(', ')], ['university_status', 'Active, Closed'], ['test_type', Object.keys(TESTS).join(', ')], ['Fees', 'Amount only. Words like non-EU, international or foreign are not allowed.'],
    ['Limits', `Max ${(await getSetting('uni_bulk_max_rows')) || 1000} course rows, 5 MB per file.`]].forEach((x) => hp.addRow(x));
  hp.getColumn(1).font = { bold: true };
  return wb;
}
const xlsx = (res: Response, name: string) => { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`); };
router.get('/courses-template.xlsx', h(async (req, res) => {
  const wb = await templateWorkbook(req.su.universityId, req.query.data === '1');
  xlsx(res, req.query.data === '1' ? 'my-courses' : 'course-upload-template'); await wb.xlsx.write(res); res.end();
}));
const dmy = (v: unknown) => { if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0, 10); const s = String(v).trim(); let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; m = s.match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : 'INVALID'; };
async function readBulk(file: Express.Multer.File) {
  const ext = String(file.originalname.split('.').pop()).toLowerCase();
  if (ext === 'csv') { // CSV = the Courses sheet only
    const lines = file.buffer.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const split = (l: string) => { const out: string[] = []; let cell = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cell); cell = ''; } else cell += ch; } out.push(cell); return out; };
    const head = split(lines[0] || '').map((x) => x.trim());
    return { courses: lines.slice(1).map((l, i) => ({ ...Object.fromEntries(split(l).map((v, k) => [head[k], v])), __row: i + 2 })) as Any[], intakes: [] as Any[], english: [] as Any[] };
  }
  if (ext !== 'xlsx') throw bad('Upload an .xlsx or .csv file');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(file.buffer as never);
  const sheet = (n: string) => { const ws = wb.getWorksheet(n); if (!ws) return [] as Any[]; const rows: Any[] = []; let head: string[] | null = null;
    ws.eachRow({ includeEmpty: false }, (row, i) => { const vals: unknown[] = []; for (let c = 1; c <= ws.columnCount; c++) { let v: any = row.getCell(c).value; if (v && typeof v === 'object' && !(v instanceof Date)) v = v.text || v.result || v.hyperlink || ''; vals.push(v ?? ''); }
      if (!head) head = vals.map((x) => String(x).trim()); else rows.push({ ...Object.fromEntries(head.map((k, j) => [k, vals[j]])), __row: i }); }); return rows; };
  return { courses: sheet('Courses'), intakes: sheet('Intakes'), english: sheet('English') };
}
async function classifyBulk(uniId: unknown, data: Awaited<ReturnType<typeof readBulk>>) {
  const out: Any[] = [];
  const camps = (await Campus.find({ university_id: uniId, is_deleted: false }).lean()) as Any[];
  const flds = await fields();
  const max = Number((await getSetting('uni_bulk_max_rows')) || 1000);
  if (data.courses.length > max) throw bad(`Maximum ${max} course rows per file`);
  const seen = new Set<string>();
  for (const row of data.courses) {
    const g = (k: string) => String(row[k] ?? '').trim(); const rowNo = row.__row || '?';
    if (!g('course_name') && !g('university_course_code')) continue;
    const key = g('university_course_code') || g('course_name');
    const field = flds.find((x) => x.name.toLowerCase() === g('field_of_study').toLowerCase());
    const camp = camps.find((c) => c.name.toLowerCase() === g('campus').toLowerCase());
    const closed = (s: unknown) => /^closed$/i.test(String(s).trim());
    const intakes = data.intakes.filter((i) => String(i.course_key).trim() === key).map((i) => ({ month: num(i.intake_month), year: num(i.intake_year), open_date: dmy(i.open_date), deadline: dmy(i.deadline), status: closed(i.status) ? 'Closed' : 'Open', closed_reason: closed(i.status) ? 'Other' : null }));
    const english = data.english.filter((x) => String(x.course_key).trim() === key).map((x) => ({ test_type: String(x.test_type).trim(), min_overall: x.min_overall, min_band: x.min_band === '' ? null : x.min_band }));
    const b: Any = { name: g('course_name'), level: LEVELS.find((l) => l.toLowerCase() === g('level').toLowerCase()) || g('level'), field_of_study_id: field ? String(field._id) : null, campus_id: camp ? String(camp._id) : null,
      course_link: g('course_link'), tuition_fee: g('tuition_fee_per_year'), currency: g('tuition_currency').toUpperCase(), fee_note: g('fee_note'), application_fee: g('application_fee'), application_fee_currency: g('application_fee_currency').toUpperCase(),
      required_level: g('previous_level_required'), min_percent: g('academic_min_percentage'), moi_accepted: /^yes$/i.test(g('moi_accepted')), duration_months: g('duration_months'),
      language: LANGS.find((l) => l.toLowerCase() === g('language_of_instruction').toLowerCase()) || g('language_of_instruction'), uni_status: closed(g('university_status')) ? 'Closed' : 'Active', description: g('description'),
      university_course_code: g('university_course_code'), english, intakes };
    const existing = (b.university_course_code ? await Course.findOne({ university_id: uniId, university_course_code: b.university_course_code, is_deleted: false }).lean()
      : await Course.findOne({ university_id: uniId, level: b.level, is_deleted: false, name: new RegExp(`^\\s*${b.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') }).lean()) as Any;
    const v = await validateCourse(uniId, b, existing?._id);
    if (!field) v.errors.field_of_study_id = `Field of study "${g('field_of_study')}" not found`;
    if (!camp) v.errors.campus_id = `Campus "${g('campus')}" not found`;
    if (intakes.some((i) => i.deadline === 'INVALID' || i.open_date === 'INVALID')) v.errors.intakes = 'Dates must be DD/MM/YYYY';
    const dupKey = `${b.name}|${b.level}`.toLowerCase(); if (seen.has(dupKey)) v.errors.name = 'Duplicate row in this file'; seen.add(dupKey);
    const errs = Object.entries(v.errors);
    if (errs.length) { out.push({ row: rowNo, course: b.name, status: 'Error', reason: errs.map(([k, m]) => `${k}: ${m}`).join('; '), cell: `Courses!row ${rowNo}` }); continue; }
    const p = payloadOf(b, v);
    let status = existing ? 'Update' : 'New';
    if (existing) {
      const cur = (await courseOut(existing)) as Any;
      const same = ['name', 'level', 'tuition_fee', 'currency', 'application_fee', 'course_link', 'duration_months', 'language', 'description', 'fee_note', 'uni_status'].every((k) => String(cur[k] ?? '') === String((p as Any)[k] ?? ''))
        && String(cur.academic?.min_percent ?? '') === String(p.min_percent) && JSON.stringify(cur.intakes.map((i: Any) => [i.month, i.year, i.deadline, i.status])) === JSON.stringify(p.intakes.map((i) => [i.month, i.year, i.deadline, i.status]));
      if (same) status = 'No change';
    }
    out.push({ row: rowNo, course: b.name, status, warnings: v.warnings, payload: p, course_id: existing ? String(existing._id) : null });
  }
  return out;
}
const bulkRuns = new Map<string, number[]>();
router.post('/courses/bulk/:mode', upload.single('file'), h(async (req, res) => {
  const mode = req.params.mode; if (!['preview', 'submit'].includes(mode)) throw P.NotFound();
  if (!canProposeCourses(req)) throw forbid();
  if (!req.file) throw bad('Choose the file'); if (req.file.size > 5 * 1024 * 1024) throw bad('The file is larger than 5 MB');
  if (mode === 'submit') { const k = String(req.su.universityId); const t = Date.now(); const l = (bulkRuns.get(k) ?? []).filter((x) => t - x < 3600e3); if (l.length >= 5) throw new HttpError(429, 'Too many uploads. Please try again later.'); l.push(t); bulkRuns.set(k, l); }
  const rows = await classifyBulk(req.su.universityId, await readBulk(req.file));
  const counts = rows.reduce((m: Record<string, number>, x) => { m[x.status] = (m[x.status] || 0) + 1; return m; }, {});
  let batchId: string | null = null;
  if (mode === 'submit') {
    const batch = await UniImportBatch.create({ university_id: req.su.universityId, file_name: req.file.originalname, counts, errors: rows.filter((x) => x.status === 'Error'), status: 'Submitted', created_by: req.su._id });
    batchId = String(batch._id);
    for (const x of rows.filter((y) => ['New', 'Update'].includes(y.status))) await submitCourseChange(req, x.course_id ? ((await Course.findById(x.course_id).lean()) as Any) : null, x.payload, x.warnings || [], batch._id);
    await toAdmins(`${P.uniName(req.uni)} submitted a bulk course upload (${(counts.New || 0) + (counts.Update || 0)} changes)`);
    await P.uaudit(req, 'Create', 'CourseImportBatch', batch._id, `${req.file.originalname} ${JSON.stringify(counts)}`);
  }
  res.json({ counts, rows: rows.map(({ payload: _p, ...x }) => x), batch_id: batchId });
}));
router.post('/courses/bulk-errors.xlsx', h(async (req, res) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Errors');
  ws.columns = [{ header: 'Row', key: 'row', width: 8 }, { header: 'Course', key: 'course', width: 36 }, { header: 'Cell', key: 'cell', width: 16 }, { header: 'Reason', key: 'reason', width: 90 }];
  for (const e of (Array.isArray(req.body?.rows) ? req.body.rows : []).filter((x: Any) => x?.status === 'Error').slice(0, 2000)) ws.addRow({ row: e.row, course: String(e.course ?? ''), cell: String(e.cell ?? ''), reason: String(e.reason ?? '') });
  xlsx(res, 'upload-errors'); await wb.xlsx.write(res); res.end();
}));

// ---------- intakes calendar and scholarships (9) ----------
router.get('/intakes', h(async (req, res) => {
  const pending = new Set((await CourseChangeRequest.distinct('course_id', { university_id: req.su.universityId, status: 'Pending approval' })).map(String));
  const inames = new Map((await Intake.find().select('name').lean()).map((x: Any) => [String(x._id), x.name]));
  const rows: Any[] = [];
  for (const c of (await Course.find({ university_id: req.su.universityId, is_deleted: false }).select('name level intakes').lean()) as Any[])
    for (const i of c.intakes ?? []) rows.push({ course_id: String(c._id), course: c.name, level: c.level, intake: i.intake_id ? inames.get(String(i.intake_id)) : `${i.month}/${i.year || 'every year'}`, intake_key: i.intake_id ? String(i.intake_id) : `${i.month}-${i.year}`,
      open_date: i.open_date, deadline: i.deadline, status: (i.status || 'Open') === 'Closed' || (i.deadline && i.deadline < istDate()) ? 'Closed' : 'Open', pending: pending.has(String(c._id)) });
  rows.sort((a, b) => String(a.deadline || '').localeCompare(String(b.deadline || '')));
  res.json({ rows, can_propose: canProposeCourses(req) && !req.preview });
}));
const SCH_BENEFIT = ['Fixed amount', 'Percentage of tuition', 'Full tuition waiver', 'Variable / case by case'];
const SCH_HOW = ['Automatic with admission', 'Separate scholarship form (La Europa submits)', 'Essay / interview', 'Other'];
router.get('/scholarships', h(async (req, res) => {
  const live = await Scholarship.find({ university_id: req.su.universityId, is_deleted: false }).sort({ createdAt: -1 }).lean();
  const reqs = ((await CourseChangeRequest.find({ university_id: req.su.universityId, entity: 'scholarship', is_deleted: false }).sort({ createdAt: -1 }).limit(50).lean()) as Any[])
    .map((x) => ({ id: String(x._id), scholarship_id: x.scholarship_id ? String(x.scholarship_id) : null, change_type: x.change_type, status: x.status, review_note: x.review_note, created_at: x.createdAt, name: x.payload?.name }));
  res.json({ rows: live, requests: reqs, benefit_types: SCH_BENEFIT, how_apply: SCH_HOW, can_propose: canProposeCourses(req) && !req.preview,
    courses: ((await Course.find({ university_id: req.su.universityId, is_deleted: false }).sort({ name: 1 }).select('name level').lean()) as Any[]).map((c) => ({ id: String(c._id), name: c.name, level: c.level })) });
}));
router.post('/scholarships', h(async (req, res) => {
  if (!canProposeCourses(req)) throw new HttpError(403, 'Your role does not allow this action.');
  const b = req.body ?? {}; const e: Record<string, string> = {};
  const cur = b.id && oid(b.id) ? ((await Scholarship.findOne({ _id: oid(b.id), university_id: req.su.universityId }).lean()) as Any) : null; if (b.id && !cur) throw P.NotFound();
  if (!clean(b.name)) e.name = 'Scholarship name is required'; if (!clean(b.description)) e.description = 'Description is required';
  if (!SCH_BENEFIT.includes(b.benefit_type)) e.benefit_type = 'Choose the benefit type';
  if (b.benefit_type === 'Fixed amount' && !((num(b.amount) ?? 0) > 0 && b.currency)) e.amount = 'Amount and currency are required';
  const pc = num(b.percent); if (b.benefit_type === 'Percentage of tuition' && !(pc != null && pc >= 1 && pc <= 100)) e.percent = '1 to 100';
  const mp = num(b.min_percent); if (b.min_percent !== undefined && b.min_percent !== '' && b.min_percent !== null && !(mp != null && mp >= 0 && mp <= 100)) e.min_percent = 'Please enter a percentage between 0 and 100.';
  if (!SCH_HOW.includes(b.how_apply)) e.how_apply = 'Choose how the student applies';
  if (b.link && !/^https:\/\//i.test(b.link)) e.link = 'Link must start with https://';
  Object.assign(e, P.feeWordCheck({ description: b.description, other_criteria: b.other_criteria }));
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const own = new Set(((await Course.find({ university_id: req.su.universityId }).select('_id').lean()) as Any[]).map((c) => String(c._id)));
  const appliesTo = { scope: ['all', 'levels', 'courses'].includes(b.scope) ? b.scope : 'all', levels: (Array.isArray(b.levels) ? b.levels : []).filter((l: string) => LEVELS.includes(l)),
    courses: (Array.isArray(b.courses) ? b.courses : []).filter((id: string) => own.has(String(id))), intakes: Array.isArray(b.intakes) ? b.intakes : [] };
  const payload = { name: clean(b.name, 150), description: clean(b.description, 2000), benefit_type: b.benefit_type, amount: num(b.amount), currency: b.currency || null, percent: num(b.percent), min_percent: num(b.min_percent),
    other_criteria: clean(b.other_criteria, 1000), applies: appliesTo, deadline: b.deadline || null, how_apply: b.how_apply, link: clean(b.link, 300), valid_until: b.valid_until || null };
  const x = await CourseChangeRequest.create({ university_id: req.su.universityId, entity: 'scholarship', scholarship_id: cur?._id, change_type: cur ? 'Edit scholarship' : 'New scholarship', payload, old: cur, status: 'Pending approval', requested_by: req.su._id, created_by_type: 'university' });
  await toAdmins(`${P.uniName(req.uni)} submitted a scholarship: ${payload.name}`);
  await P.uaudit(req, 'Create', 'ScholarshipChangeRequest', x._id, payload.name ?? undefined); res.json({ ok: true, message: 'Sent to La Europa for approval.' });
}));

export default router;
