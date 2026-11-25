import { Router } from 'express';
import mongoose from 'mongoose';
import { authenticate, type AuthRequest } from '../middleware/auth';
import Student, { Comment, STUDENT_STATUSES, type IStudent } from '../models/Student';
import Lead from '../models/Lead';
import User from '../models/User';
import { Country, Intake, MasterItem } from '../models/Master';
import { Timeline } from '../models/Timeline';
import { can } from '../config/clientPerms';
import {
  HttpError, bad, fieldErr, handle, need, isAdmin, seesAll, oid, sid, clean, num, normPhone, isEmail, escRx,
  istDate, istDayStart, addDays, timeline, userNames, nameIn, encrypt, hmac, maskPassport, validPassport, fullName,
} from '../services/crm';
import { loadStudent, studentScope, passportOf, overallStage, academicSummary, header, mmyyyy } from '../services/students';

/** The client's Student profile (legacy/server/routes/students.js, Section 5): profile tabs, transfer, timeline, comments. */
const router = Router();
router.use(authenticate);

const col = (n: string) => mongoose.connection.collection(n);
const lean = <T>(o: T) => JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
const withId = (o: Record<string, unknown>) => ({ ...o, id: String(o._id), _id: undefined, __v: undefined, created_at: o.createdAt, updated_at: o.updatedAt });

// ---------- list ----------
const SORTS: Record<string, string> = { student_code: 'student_code', name: 'first_name', status: 'status', updated_at: 'updatedAt', created_at: 'createdAt',
  counsellor: 'primary_counsellor_id', email: 'email', city: 'city' };

router.get('/', handle(async (req, res) => {
  const q = req.query as Record<string, string>;
  const and: Record<string, unknown>[] = [{ is_deleted: false }, studentScope(req)];
  and.push(q.status ? { status: { $in: q.status.split(',') } } : { status: { $ne: 'Archived' } });
  if (oid(q.counsellor) && isAdmin(req)) and.push({ primary_counsellor_id: oid(q.counsellor) });
  if (oid(q.source)) and.push({ source_id: oid(q.source) });
  if (oid(q.intake)) and.push({ 'prefs.intake_id': oid(q.intake) });
  if (oid(q.country)) and.push({ 'prefs.country_ids': oid(q.country) });
  if (q.created_from) and.push({ createdAt: { $gte: istDayStart(q.created_from) } });
  if (q.created_to) and.push({ createdAt: { $lt: istDayStart(addDays(q.created_to, 1)) } });
  if (q.updated_from) and.push({ updatedAt: { $gte: istDayStart(q.updated_from) } });
  if (q.stage) {
    const ids = await col('applications').distinct('student_id', { is_deleted: { $ne: true }, stage: q.stage });
    and.push({ _id: { $in: ids } });
  }
  if (q.q) {
    const rx = new RegExp(escRx(q.q), 'i'); const ph = normPhone(q.q);
    and.push({ $or: [{ first_name: rx }, { middle_name: rx }, { last_name: rx }, { email: rx }, { student_code: rx }, ...(ph ? [{ phone_normalised: new RegExp(ph) }] : [])] });
  }
  const filter = { $and: and };
  const size = [25, 50, 100].includes(Number(q.size)) ? Number(q.size) : 25;
  const page = Math.max(1, Number(q.page) || 1);
  const [total, rows, names, intakes, countries, sources] = await Promise.all([
    Student.countDocuments(filter),
    Student.find(filter).sort({ [SORTS[q.sort] || 'updatedAt']: q.dir === 'asc' ? 1 : -1 }).skip((page - 1) * size).limit(size),
    userNames(), Intake.find().select('name').lean(), Country.find().select('name').lean(), MasterItem.find({ type: 'lead_source' }).select('name').lean(),
  ]);
  const by = (arr: { _id: unknown; name: string }[], id: unknown) => arr.find((x) => String(x._id) === String(id))?.name ?? '';
  res.json({
    total, page, size,
    rows: await Promise.all(rows.map(async (s) => ({
      id: String(s._id), student_code: s.student_code, name: fullName(s), phone: `${s.country_code || ''} ${s.phone || ''}`.trim(), whatsapp: !!s.whatsapp, email: s.email,
      passport: maskPassport(passportOf(s)), stage: await overallStage(s._id as mongoose.Types.ObjectId), status: s.status, counsellor: nameIn(names, s.primary_counsellor_id),
      primary_counsellor_id: sid(s.primary_counsellor_id), city: s.city, intake: by(intakes, s.prefs?.intake_id),
      countries: (s.prefs?.country_ids ?? []).map((c) => by(countries, c)).filter(Boolean).join(', '),
      updated_at: s.updatedAt, created_at: s.createdAt, source: by(sources, s.source_id),
    }))),
  });
}));

// ---------- full profile ----------
const HIDE_FOR_APP_TEAM = ['sponsor_income', 'loan_amount', 'funds_available', 'loan_bank', 'funds_currency'];
function perms(req: AuthRequest) {
  const r = req.user!.role;
  return { profile_edit: can(r, 'profile', 'edit'), shortlist_edit: can(r, 'shortlist', 'edit'), applications_edit: can(r, 'applications', 'edit'),
    applications_delete: can(r, 'applications', 'delete'), documents_edit: can(r, 'documents', 'edit'), documents_delete: can(r, 'documents', 'delete'),
    fees_view: can(r, 'fees', 'view'), fees_edit: can(r, 'fees', 'edit'), fees_service_view: true, visa_edit: can(r, 'visa', 'edit'),
    comments_edit: can(r, 'comments', 'edit'), tasks_edit: can(r, 'tasks', 'edit'), admin: r === 'admin', family_income: true };
}

router.get('/:id', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const pp = passportOf(s);
  const o = lean(s.toObject());
  const [lead, source, subAgent, names] = await Promise.all([
    s.lead_id ? Lead.findById(s.lead_id).select('lead_code').lean() : null,
    s.source_id ? MasterItem.findById(s.source_id).select('name').lean() : null,
    s.sub_agent_id ? MasterItem.findById(s.sub_agent_id).select('name').lean() : null,
    userNames(),
  ]);
  const student = { ...withId(o), academics: undefined, work: undefined, tests: undefined, prefs: undefined, family: undefined, assignment_history: undefined,
    passport_enc: undefined, passport_hash: undefined, passport_masked: maskPassport(pp), has_passport: !!pp, lead_code: lead?.lead_code ?? null,
    source: source?.name ?? '', sub_agent: subAgent && (seesAll(req) || String(s.primary_counsellor_id) === req.user!.id) ? subAgent.name : '' };
  const sorted = [...s.academics].sort((a, b) => a.sort - b.sort || (a.pass_year ?? 0) - (b.pass_year ?? 0));
  const count = (c: string, f: Record<string, unknown>) => col(c).countDocuments({ student_id: s._id, is_deleted: { $ne: true }, ...f });
  const [shortlist, applications, documents, tasks, emailsFailed, comments] = await Promise.all([
    count('shortlists', {}), count('applications', {}), count('documents', { status: 'Uploaded' }), count('tasks', { status: { $in: ['Open', 'In progress'] } }),
    col('emaillogs').countDocuments({ student_id: s._id, status: { $in: ['Failed', 'Bounced'] } }), Comment.countDocuments({ student_id: s._id, is_deleted: false }),
  ]);
  const family = lean(s.family ?? {});
  if (!can(req.user!.role, 'fees', 'view')) for (const k of HIDE_FOR_APP_TEAM) delete family[k];
  res.json({
    student, header: await header(s),
    academics: sorted.map((a) => withId(lean(a))), work: [...s.work].sort((a, b) => a.from_month.localeCompare(b.from_month)).map((w) => withId(lean(w))),
    tests: s.tests.map((t) => withId(lean(t))), aptitude: [],
    prefs: { ...lean(s.prefs ?? {}), country_ids: (s.prefs?.country_ids ?? []).map(String), languages: s.prefs?.languages ?? [] },
    family, summary: await academicSummary(s),
    assignment_history: [...s.assignment_history].reverse().map((h) => ({ ...withId(lean(h)), from: nameIn(names, h.from_user_id), to: nameIn(names, h.to_user_id), by: nameIn(names, h.changed_by) })),
    perms: perms(req),
    counts: { shortlist, applications, documents, tasks, emails_failed: emailsFailed, comments },
  });
}));

router.get('/:id/passport', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  await timeline({ student_id: s._id, type: 'profile', description: `${req.user!.name} viewed the passport number`, user_id: req.user!.id });
  res.json({ passport: passportOf(s) });
}));

// ---------- change log helpers ----------
type Change = { field: string; label: string; old: unknown; new: unknown };
function diff(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>) {
  const out: Change[] = [];
  for (const [k, label] of Object.entries(labels)) {
    const a = before[k] ?? null, b = after[k] ?? null;
    if (String(a ?? '') !== String(b ?? '')) out.push({ field: k, label, old: a, new: b });
  }
  return out;
}
async function logChanges(req: AuthRequest, s: IStudent, tab: string, changes: Change[]) {
  for (const c of changes) {
    const [o, n] = c.field === 'passport' ? [maskPassport(c.old as string), maskPassport(c.new as string)] : [c.old, c.new];
    await timeline({ student_id: s._id, type: 'profile', description: `${tab}: ${c.label} changed from "${o ?? '-'}" to "${n ?? '-'}"`, user_id: req.user!.id });
  }
  // E22 "your profile was updated" email to the student arrives with the email engine (PORTING.md)
}

// ---------- Tab 1: personal ----------
const PERSONAL: Record<string, string> = { first_name: 'First name', middle_name: 'Middle name', last_name: 'Last name', gender: 'Gender', dob: 'Date of birth', country_code: 'Country code',
  phone: 'Phone', whatsapp: 'WhatsApp number', email: 'Email', nationality: 'Nationality', passport: 'Passport number', passport_issue: 'Passport issue date',
  passport_expiry: 'Passport expiry date', passport_place: 'Passport place of issue', address1: 'Address line 1', address2: 'Address line 2', city: 'City', state: 'State',
  pin: 'PIN code', marital_status: 'Marital status', spouse_travel: 'Spouse will travel', children: 'Number of children', emergency_name: 'Emergency contact name',
  emergency_phone: 'Emergency contact phone', status: 'Status', no_surname: 'No surname', source_id: 'Source', parent_cc_email: 'Parent CC email' };

router.put('/:id/personal', handle(async (req, res) => {
  need(req, 'profile', 'edit');
  const s = await loadStudent(req, req.params.id);
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  const reqd = (k: string, l: string) => { if (b[k] === undefined || b[k] === null || String(b[k]).trim() === '') errors[k] = `${l} is required`; };
  reqd('first_name', 'First name'); reqd('gender', 'Gender'); reqd('dob', 'Date of birth'); reqd('phone', 'Phone'); reqd('email', 'Email');
  reqd('nationality', 'Nationality'); reqd('marital_status', 'Marital status'); reqd('status', 'Status');
  if (!b.no_surname) reqd('last_name', 'Last name');
  if (b.first_name && String(b.first_name).length > 50) errors.first_name = 'Max 50 characters';
  if (b.dob) { const age = Math.floor((Date.now() - +new Date(b.dob)) / (365.25 * 864e5)); if (isNaN(age) || age < 15 || age > 60) errors.dob = 'Age must be between 15 and 60'; }
  if (b.email && !isEmail(b.email)) errors.email = 'Enter a valid email';
  if (b.phone && (b.country_code || '+91') === '+91' && (normPhone(b.phone) || '').length !== 10) errors.phone = 'Enter a 10 digit mobile number';
  const pp: string | null = b.passport !== undefined ? (b.passport ? String(b.passport).toUpperCase().replace(/\s/g, '') : null) : passportOf(s);
  if (pp && !validPassport(pp, b.nationality)) errors.passport = b.nationality === 'Indian' || !b.nationality ? 'Indian passport format: 1 letter + 7 digits (e.g. A1234567)' : '6 to 12 letters / numbers';
  if (pp && !b.passport_expiry) errors.passport_expiry = 'Expiry date is required with passport number';
  if (b.passport_expiry && b.passport_issue && b.passport_expiry <= b.passport_issue) errors.passport_expiry = 'Expiry must be after issue date';
  if (pp) {
    const ex = await Student.findOne({ passport_hash: hmac(pp), _id: { $ne: s._id }, is_deleted: false }).select('student_code').lean();
    if (ex) errors.passport = `This passport number already belongs to student ${isAdmin(req) ? ex.student_code : 'another student'}`;
  }
  if (b.pin && !/^\d{6}$/.test(b.pin)) errors.pin = 'PIN code must be 6 digits';
  if (b.children !== undefined && b.children !== null && b.children !== '' && (Number(b.children) < 0 || Number(b.children) > 10)) errors.children = '0 to 10';
  if (!STUDENT_STATUSES.includes(b.status)) errors.status = 'Invalid status';
  if (b.status === 'Dropped' && s.status !== 'Dropped' && !clean(b.status_reason)) errors.status_reason = 'Reason is required for Dropped';
  if (b.marital_status === 'Married' && (b.spouse_travel === undefined || b.spouse_travel === null || b.spouse_travel === '')) errors.spouse_travel = 'Please choose Yes or No';
  if (b.parent_cc_email && !isEmail(b.parent_cc_email)) errors.parent_cc_email = 'Enter a valid email';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });

  const em = String(b.email).trim().toLowerCase();
  const phoneChanged = normPhone(b.phone) !== s.phone_normalised, emailChanged = em !== (s.email || '').toLowerCase();
  if (phoneChanged || emailChanged) {
    const dup = await Student.findOne({ _id: { $ne: s._id }, is_deleted: false, $or: [...(phoneChanged ? [{ phone_normalised: normPhone(b.phone) }] : []), ...(emailChanged ? [{ email: em }] : [])] }).lean()
      ?? await Lead.findOne({ _id: { $ne: s.lead_id }, is_deleted: false, status: { $ne: 'Converted' }, $or: [...(phoneChanged ? [{ phone_normalised: normPhone(b.phone) }] : []), ...(emailChanged ? [{ email: em }] : [])] }).lean();
    if (dup && !(isAdmin(req) && b.save_anyway)) throw new HttpError(409, 'A record with this phone/email already exists.', { duplicate: { id: String(dup._id) } });
  }
  const f: Record<string, unknown> = {
    first_name: clean(b.first_name, 50), middle_name: clean(b.middle_name, 50), last_name: b.no_surname ? undefined : clean(b.last_name, 50), no_surname: !!b.no_surname,
    gender: b.gender, dob: b.dob, country_code: b.country_code || '+91', phone: String(b.phone).replace(/[^\d+]/g, ''), phone_normalised: normPhone(b.phone),
    whatsapp: clean(b.whatsapp, 20), email: em, nationality: b.nationality, passport_issue: b.passport_issue || undefined, passport_expiry: b.passport_expiry || undefined,
    passport_place: clean(b.passport_place, 80), address1: clean(b.address1, 200), address2: clean(b.address2, 200), city: clean(b.city, 80), state: clean(b.state, 80),
    pin: clean(b.pin, 6), marital_status: b.marital_status,
    spouse_travel: b.marital_status === 'Married' ? [true, 'Yes', 1, '1'].includes(b.spouse_travel) : false,
    children: num(b.children) ?? 0, emergency_name: clean(b.emergency_name, 100), emergency_phone: clean(b.emergency_phone, 20), status: b.status,
    status_reason: b.status !== s.status ? clean(b.status_reason, 300) : s.status_reason, parent_cc_email: clean(b.parent_cc_email, 150), updated_by: req.user!.id,
  };
  if (isAdmin(req) && b.source_id !== undefined) f.source_id = oid(b.source_id);
  const before = { ...lean(s.toObject()), passport: passportOf(s) };
  const changes = diff(before, { ...before, ...f, passport: pp }, PERSONAL);
  f.passport_enc = pp ? (pp === before.passport ? s.passport_enc : encrypt(pp)) : undefined;
  f.passport_hash = pp ? hmac(pp) : undefined;
  f.passport_last4 = pp ? pp.slice(-4) : undefined;
  if (emailChanged) Object.assign(f, { email_thread_root_id: undefined, email_thread_subject: undefined, email_refs: [], email_status: 'OK' }); // a new address starts a new email thread (13.4)
  await Student.updateOne({ _id: s._id }, f);
  if (emailChanged) await timeline({ student_id: s._id, type: 'email', description: `Email changed from ${s.email} to ${em}: a new email thread will start`, user_id: req.user!.id });
  await logChanges(req, s, 'Personal', changes);
  res.json({ ok: true, changes: changes.length });
}));

router.post('/:id/status', handle(async (req, res) => {
  need(req, 'profile', 'edit');
  const s = await loadStudent(req, req.params.id);
  const st = req.body?.status;
  if (!STUDENT_STATUSES.includes(st)) throw bad('Invalid status');
  if (['On hold', 'Dropped'].includes(st) && !clean(req.body.reason)) throw fieldErr('reason', 'Reason is required');
  await Student.updateOne({ _id: s._id }, { status: st, status_reason: clean(req.body.reason, 300), updated_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'stage', description: `Student status: ${s.status} to ${st}${req.body.reason ? ` (${req.body.reason})` : ''}`, user_id: req.user!.id });
  res.json({ ok: true });
}));

// ---------- Tab 2: academic ----------
const LEVEL_LABEL: Record<string, string> = { '10th': '10th', '12th': '12th', Diploma: 'Diploma', Bachelor: 'Bachelor', Master: 'Master', PhD: 'PhD', Other: 'Other qualification' };
function flatAcademic(rows: Record<string, any>[], work: Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const o: Record<string, unknown> = {}; const cnt: Record<string, number> = {};
  for (const a of rows) {
    cnt[a.level] = (cnt[a.level] || 0) + 1;
    const L = LEVEL_LABEL[a.level] + (cnt[a.level] > 1 ? ` #${cnt[a.level]}` : '');
    o[`${L} percentage / CGPA`] = a.score !== null && a.score !== undefined ? `${a.score} ${a.score_type || '%'}` : null;
    o[`${L} year of passing`] = a.pass_year; o[`${L} board / university`] = a.board_university; o[`${L} school / institution`] = a.institution;
    o[`${L} course`] = a.course_name; o[`${L} stream`] = a.stream; o[`${L} backlogs`] = a.backlogs_total; o[`${L} active backlogs`] = a.backlogs_active;
    o[`${L} English marks`] = a.english_marks; o[`${L} start year`] = a.start_year; o[`${L} duration`] = a.duration; o[`${L} currently studying`] = a.currently_studying ? 'Yes' : null;
  }
  work.forEach((w, i) => { o[`Work experience ${i + 1}`] = `${w.company}, ${w.designation}, ${mmyyyy(w.from_month)} to ${w.till_date ? 'till date' : mmyyyy(w.to_month)}`; });
  return o;
}
const validScore = (v: unknown, type?: string) => {
  if (v === null || v === undefined || v === '') return false;
  const n = Number(v);
  if (type === 'CGPA4') return n >= 0 && n <= 4;
  if (type === 'CGPA10' || type === 'CGPA') return n >= 0 && n <= 10;
  return n >= 0 && n <= 100;
};

router.put('/:id/academic', handle(async (req, res) => {
  need(req, 'profile', 'edit');
  const s = await loadStudent(req, req.params.id);
  const recs: Record<string, any>[] = Array.isArray(req.body?.records) ? req.body.records : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const work: Record<string, any>[] = Array.isArray(req.body?.work) ? req.body.work : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {};
  const yr = new Date().getFullYear();
  const t10 = recs.find((a) => a.level === '10th');
  const t12 = recs.find((a) => a.level === '12th' || a.level === 'Diploma');
  if (!t10) errors['10th.score'] = '10th details are required';
  recs.forEach((a, i) => {
    const k = (f: string) => `${i}.${f}`;
    if (!LEVEL_LABEL[a.level]) errors[k('level')] = 'Invalid level';
    const needsScore = ['10th', '12th', 'Diploma'].includes(a.level) || a.course_name || a.score;
    if (needsScore && !validScore(a.score, a.score_type)) errors[k('score')] = a.score_type === 'CGPA4' ? 'CGPA must be 0 to 4' : a.score_type?.startsWith('CGPA') ? 'CGPA must be 0 to 10' : 'Percentage must be 0 to 100';
    if (needsScore && (!a.pass_year || a.pass_year < 1980 || a.pass_year > yr + (a.currently_studying ? 6 : 0))) errors[k('pass_year')] = a.currently_studying ? 'Enter expected year' : `Year between 1980 and ${yr}`;
    if ((a.level === '12th' || a.level === 'Diploma') && !a.board_university) errors[k('board_university')] = 'Board is required';
    if ((a.level === '12th' || a.level === 'Diploma') && t10 && a.pass_year && Number(a.pass_year) <= Number(t10.pass_year)) errors[k('pass_year')] = 'Must be after 10th year';
    if (['Bachelor', 'Master', 'PhD', 'Other'].includes(a.level)) {
      if (!a.course_name) errors[k('course_name')] = 'Course name is required';
      if (a.backlogs_total === undefined || a.backlogs_total === null || a.backlogs_total === '') errors[k('backlogs_total')] = 'Backlogs (total) is required (0 if none)';
      else if (a.backlogs_total < 0 || a.backlogs_total > 50) errors[k('backlogs_total')] = '0 to 50';
      if (a.backlogs_active && Number(a.backlogs_active) > Number(a.backlogs_total || 0)) errors[k('backlogs_active')] = 'Cannot be more than total';
      if (a.level === 'Bachelor' && t12 && a.pass_year && Number(a.pass_year) <= Number(t12.pass_year)) errors[k('pass_year')] = 'Must be after 12th year';
    }
    if (a.english_marks && (a.english_marks < 0 || a.english_marks > 100)) errors[k('english_marks')] = '0 to 100';
  });
  if (!t12) errors['12th.score'] = '12th or Diploma details are required';
  work.forEach((w, i) => {
    const k = (f: string) => `w${i}.${f}`;
    if (!clean(w.company)) errors[k('company')] = 'Company is required';
    if (!clean(w.designation)) errors[k('designation')] = 'Designation is required';
    if (!/^\d{4}-\d{2}$/.test(w.from_month || '')) errors[k('from_month')] = 'From (MM/YYYY) is required';
    if (!w.till_date && !/^\d{4}-\d{2}$/.test(w.to_month || '')) errors[k('to_month')] = 'To is required unless Till date';
    if (!w.till_date && w.to_month && w.from_month && w.to_month < w.from_month) errors[k('to_month')] = 'Must be after From';
  });
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const order: Record<string, number> = { '10th': 1, '12th': 2, Diploma: 2, Bachelor: 3, Master: 4, PhD: 5, Other: 6 };
  const newRecs = recs.map((a, i) => ({ level: a.level, qualification_type: a.level === 'Diploma' ? 'Diploma' : a.level === '12th' ? '12th' : a.qualification_type || undefined,
    course_name: clean(a.course_name, 150), board_university: clean(a.board_university, 150), institution: clean(a.institution, 150), score: num(a.score),
    score_type: a.score_type || '%', start_year: num(a.start_year), pass_year: num(a.pass_year), currently_studying: !!a.currently_studying, duration: num(a.duration),
    backlogs_total: num(a.backlogs_total), backlogs_active: num(a.backlogs_active), stream: a.stream || undefined, english_marks: num(a.english_marks), sort: (order[a.level] || 9) * 10 + i }));
  const newWork = work.map((w) => ({ company: clean(w.company, 150)!, designation: clean(w.designation, 100)!, from_month: w.from_month, to_month: w.till_date ? undefined : w.to_month, till_date: !!w.till_date }))
    .sort((a, b) => a.from_month.localeCompare(b.from_month));
  const before = flatAcademic([...s.academics].sort((a, b) => a.sort - b.sort).map(lean), s.work.map(lean));
  const after = flatAcademic([...newRecs].sort((a, b) => a.sort - b.sort), newWork);
  s.set({ academics: newRecs, work: newWork, updated_by: req.user!.id });
  await s.save();
  const labels = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].map((k) => [k, k]));
  await logChanges(req, s, 'Academic', diff(before, after, labels));
  res.json({ ok: true, summary: await academicSummary(s) });
}));

// ---------- Tab 3: English test + preferences ----------
const TEST_RANGES: Record<string, [number, number, number]> = { 'IELTS Academic': [0, 9, 0.5], 'IELTS General': [0, 9, 0.5], 'TOEFL iBT': [0, 120, 1], 'PTE Academic': [10, 90, 1], Duolingo: [10, 160, 1] };
const SUB_RANGES: Record<string, [number, number, number]> = { 'IELTS Academic': [0, 9, 0.5], 'IELTS General': [0, 9, 0.5], 'TOEFL iBT': [0, 30, 1], 'PTE Academic': [10, 90, 1], Duolingo: [10, 160, 1] };
const inRange = (v: unknown, [a, b, step]: [number, number, number]) => { const n = Number(v); return !isNaN(n) && n >= a && n <= b && Math.abs(n / step - Math.round(n / step)) < 1e-9; };
const TEST_TYPES = ['IELTS Academic', 'IELTS General', 'TOEFL iBT', 'PTE Academic', 'Duolingo', 'Not taken yet', 'MOI (waiver)'];

router.put('/:id/english', handle(async (req, res) => {
  need(req, 'profile', 'edit');
  const s = await loadStudent(req, req.params.id);
  const tests: Record<string, any>[] = Array.isArray(req.body?.tests) ? req.body.tests : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const pr = req.body?.prefs || {};
  const errors: Record<string, string> = {};
  tests.forEach((t, i) => {
    const k = (f: string) => `t${i}.${f}`;
    if (!TEST_TYPES.includes(t.test_type)) { errors[k('test_type')] = 'Select a test'; return; }
    const R = TEST_RANGES[t.test_type];
    if (R) {
      if (!inRange(t.overall, R)) errors[k('overall')] = `Overall must be ${R[0]} to ${R[1]}${R[2] < 1 ? ' (step 0.5)' : ''}`;
      for (const sub of ['listening', 'reading', 'writing', 'speaking']) {
        const SR = SUB_RANGES[t.test_type];
        const has = t[sub] !== undefined && t[sub] !== null && t[sub] !== '';
        if (t.test_type !== 'Duolingo' && !has) errors[k(sub)] = 'Required';
        else if (has && !inRange(t[sub], SR)) errors[k(sub)] = `${SR[0]} to ${SR[1]}`;
      }
    }
    if (t.test_type === 'Not taken yet') {
      if (!t.planned_date) errors[k('planned_date')] = 'Planned test date is required';
      else if (t.planned_date <= istDate()) errors[k('planned_date')] = 'Must be a future date';
    }
  });
  if (!pr.country_ids || !pr.country_ids[0]) errors['prefs.country_ids'] = 'Preferred country 1 is required';
  if (!clean(pr.course)) errors['prefs.course'] = 'Preferred course / field is required';
  if (!pr.level) errors['prefs.level'] = 'Preferred level is required';
  if (!pr.intake_id) errors['prefs.intake_id'] = 'Preferred intake is required';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const germany = await Country.findOne({ name: 'Germany' }).select('_id').lean();
  const countryIds = (pr.country_ids as string[]).filter(Boolean).slice(0, 3).map(oid).filter(Boolean) as mongoose.Types.ObjectId[];
  const [countries, intakes] = await Promise.all([Country.find().select('name').lean(), Intake.find().select('name').lean()]);
  const cn = (ids: unknown[]) => ids.map((id) => countries.find((c) => String(c._id) === String(id))?.name).filter(Boolean).join(', ');
  const iname = (id: unknown) => intakes.find((x) => String(x._id) === String(id))?.name ?? null;
  const newPrefs = { country_ids: countryIds, course: clean(pr.course, 150), level: pr.level, intake_id: oid(pr.intake_id), budget_tuition_eur: num(pr.budget_tuition_eur),
    budget_total_eur: num(pr.budget_total_eur), languages: Array.isArray(pr.languages) ? pr.languages : [],
    aps_needed: germany && countryIds.some((c) => String(c) === String(germany._id)) ? !!pr.aps_needed : null };
  const flatT = (ts: Record<string, any>[]) => Object.fromEntries(ts.flatMap((t) => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    [`${t.test_type} score`, t.overall !== null && t.overall !== undefined && t.overall !== '' ? `${Number(t.overall)}${t.listening !== null && t.listening !== undefined && t.listening !== '' ? ` (L${Number(t.listening)} R${Number(t.reading)} W${Number(t.writing)} S${Number(t.speaking)})` : ''}` : (t.planned_date ? `planned ${t.planned_date}` : null)],
    [`${t.test_type} test date`, t.test_date || null], [`${t.test_type} TRF / reference`, t.reference_no || null]]));
  const flatP = (p: Record<string, any>) => ({ 'Preferred countries': cn(p.country_ids ?? []), 'Preferred course / field': p.course, 'Preferred level': p.level, 'Preferred intake': iname(p.intake_id), // eslint-disable-line @typescript-eslint/no-explicit-any
    'Other languages': (p.languages ?? []).map((l: { name: string; level?: string }) => `${l.name} ${l.level || ''}`.trim()).join(', ') || null,
    'APS needed': p.aps_needed === null || p.aps_needed === undefined ? null : p.aps_needed ? 'Yes' : 'No', 'Tuition budget (internal)': p.budget_tuition_eur, 'Total budget (internal)': p.budget_total_eur });
  const before = { ...flatT(s.tests.map(lean)), ...flatP(lean(s.prefs ?? {})) }, after = { ...flatT(tests), ...flatP(newPrefs) };
  s.set({
    tests: tests.map((t) => ({ test_type: t.test_type, overall: num(t.overall), listening: num(t.listening), reading: num(t.reading), writing: num(t.writing), speaking: num(t.speaking),
      test_date: t.test_date || undefined, planned_date: t.test_type === 'Not taken yet' ? t.planned_date : undefined, reference_no: clean(t.reference_no, 50) })),
    prefs: newPrefs, updated_by: req.user!.id,
  });
  await s.save();
  // the optional "planned test" reminder task arrives with Tasks (PORTING.md)
  const labels = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].map((k) => [k, k]));
  await logChanges(req, s, 'English test and preferences', diff(before, after, labels));
  res.json({ ok: true });
}));

// ---------- Tab 4: family / sponsor (internal only: never emailed) ----------
const FAMILY: Record<string, string> = { father_name: 'Father name', father_occupation: 'Father occupation', father_phone: 'Father phone', mother_name: 'Mother name', mother_occupation: 'Mother occupation',
  mother_phone: 'Mother phone', spouse_name: 'Spouse name', spouse_occupation: 'Spouse occupation', sponsor_type: 'Sponsor type', sponsor_name: 'Sponsor name',
  sponsor_relation: 'Sponsor relation', sponsor_income: 'Sponsor annual income', loan: 'Education loan', loan_bank: 'Loan bank', loan_amount: 'Loan amount',
  funds_available: 'Funds available', funds_currency: 'Funds currency' };
const MONEY = ['sponsor_income', 'loan_amount', 'funds_available'];
router.put('/:id/family', handle(async (req, res) => {
  need(req, 'profile', 'edit');
  const s = await loadStudent(req, req.params.id);
  const b = req.body ?? {};
  if (s.marital_status === 'Married' && !clean(b.spouse_name)) throw fieldErr('spouse_name', 'Spouse name is required for married students');
  const f: Record<string, unknown> = {};
  for (const k of Object.keys(FAMILY)) f[k] = MONEY.includes(k) ? num(b[k]) : k === 'loan' ? !!b.loan : clean(b[k], 150);
  const changes = diff(lean(s.family ?? {}), f, FAMILY).map((c) => (MONEY.includes(c.field) ? { ...c, old: c.old === null ? null : 'hidden', new: c.new === null ? null : 'hidden' } : c));
  await Student.updateOne({ _id: s._id }, { family: f, updated_by: req.user!.id });
  await logChanges(req, s, 'Family / Sponsor', changes);
  res.json({ ok: true });
}));

// ---------- transfer (Admin / Manager) ----------
async function transfer(req: AuthRequest, s: IStudent, toUser: string, reason?: string, moveTasks = true) {
  const to = oid(toUser);
  if (!to) throw bad('Select the new counsellor');
  const from = s.primary_counsellor_id;
  if (String(from ?? '') === String(to)) return false;
  if (!(await User.exists({ _id: to, isActive: true }))) throw bad('Select an active user');
  const names = await userNames();
  await Student.updateOne({ _id: s._id }, {
    primary_counsellor_id: to, updated_by: req.user!.id,
    $push: { assignment_history: { role_type: 'primary', from_user_id: from, to_user_id: to, reason: clean(reason, 300), changed_by: req.user!.id } },
  });
  await col('applications').updateMany({ student_id: s._id, is_deleted: { $ne: true } }, { $set: { handled_by: to } });
  if (moveTasks && from) await col('tasks').updateMany({ student_id: s._id, assigned_to: from, status: { $in: ['Open', 'In progress'] }, is_deleted: { $ne: true } }, { $set: { assigned_to: to } });
  if (s.lead_id) await Lead.updateOne({ _id: s.lead_id }, { assigned_user_id: to });
  await timeline({ student_id: s._id, type: 'profile', description: `Counsellor changed from ${nameIn(names, from) || '-'} to ${nameIn(names, to) || '-'}${reason ? ` (${reason})` : ''}`, user_id: req.user!.id });
  // notifications to both counsellors, the portal chat line and the E20 email arrive with Notifications / email / portal (PORTING.md)
  return true;
}
router.post('/:id/transfer', handle(async (req, res) => {
  need(req, 'assign', 'edit');
  const s = await loadStudent(req, req.params.id);
  if (!req.body?.to_user_id) throw fieldErr('to_user_id', 'Select the new counsellor');
  if (!clean(req.body.reason)) throw fieldErr('reason', 'Reason is required');
  await transfer(req, s, req.body.to_user_id, req.body.reason, req.body.transfer_tasks !== false);
  res.json({ ok: true });
}));
router.post('/bulk-transfer', handle(async (req, res) => {
  need(req, 'assign', 'edit');
  const { ids = [], to_user_id, reason, transfer_tasks = true } = req.body ?? {};
  if (!to_user_id) throw fieldErr('to_user_id', 'Select the new user');
  if (!clean(reason)) throw fieldErr('reason', 'Reason is required');
  let n = 0;
  for (const id of ids as string[]) { const s = oid(id) && (await Student.findOne({ _id: oid(id), is_deleted: false })); if (s && (await transfer(req, s, to_user_id, reason, transfer_tasks))) n++; }
  res.json({ transferred: n });
}));
router.post('/:id/pause-emails', handle(async (req, res) => {
  need(req, 'assign', 'edit');
  const s = await loadStudent(req, req.params.id);
  const paused = !!req.body?.paused;
  if (!clean(req.body?.reason)) throw fieldErr('reason', 'Reason is required');
  await Student.updateOne({ _id: s._id }, { emails_paused: paused, emails_paused_reason: clean(req.body.reason, 300), updated_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'email', description: `Student emails ${paused ? 'paused' : 'resumed'} (${req.body.reason})`, user_id: req.user!.id });
  res.json({ ok: true });
}));

// ---------- timeline ----------
const TL_TYPES: Record<string, string[]> = { stages: ['stage'], documents: ['document'], emails: ['email'], payments: ['payment'], tasks: ['task'], notes: ['note', 'comment'] };
router.get('/:id/timeline', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const t = TL_TYPES[String(req.query.type)];
  const names = await userNames();
  const rows = await Timeline.find({ student_id: s._id, ...(t ? { type: { $in: t } } : {}) }).sort({ createdAt: -1 }).limit(500).lean();
  const lead = s.lead_id && (!t || t.some((x) => ['stage', 'note', 'email'].includes(x)))
    ? (await Timeline.find({ lead_id: s.lead_id, ...(t ? { type: { $in: t } } : {}) }).sort({ createdAt: -1 }).limit(200).lean()).map((x) => ({ ...x, from_lead: true })) : [];
  res.json([...rows, ...lead].sort((a, b) => +b.createdAt - +a.createdAt)
    .map((x) => ({ ...x, id: String(x._id), _id: undefined, created_at: x.createdAt, user_name: nameIn(names, x.user_id) })));
}));

// ---------- email log: filled by the email engine (PORTING.md) ----------
router.get('/:id/emails', handle(async (req, res) => {
  need(req, 'emails', 'view');
  const s = await loadStudent(req, req.params.id);
  const rows = await col('emaillogs').find({ $or: [{ student_id: s._id }, ...(s.lead_id ? [{ lead_id: s.lead_id }] : [])] }).sort({ queued_at: -1 }).toArray();
  res.json({ rows: rows.map((e) => ({ ...e, id: String(e._id), _id: undefined })), thread_root: s.email_thread_root_id ?? null, email_status: s.email_status, paused: s.emails_paused });
}));

// ---------- comments & pinned notes (internal: never trigger an email) ----------
router.get('/:id/comments', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const names = await userNames();
  const rows = await Comment.find({ student_id: s._id }).sort({ is_pinned: -1, createdAt: 1 }).lean();
  const fresh = (d: Date) => Date.now() - +new Date(d) < 15 * 60_000;
  res.json({
    pinned_notes: s.pinned_notes || '',
    comments: rows.map((c) => ({
      id: String(c._id), body: c.is_deleted ? null : c.body, deleted: c.is_deleted, is_pinned: c.is_pinned, created_at: c.createdAt, edited_at: c.edited_at ?? null,
      user_id: String(c.created_by), user_name: nameIn(names, c.created_by), attachments: c.is_deleted ? [] : c.attachments,
      can_edit: !c.is_deleted && String(c.created_by) === req.user!.id && fresh(c.createdAt),
      can_delete: !c.is_deleted && (isAdmin(req) || (String(c.created_by) === req.user!.id && fresh(c.createdAt))),
    })),
  });
}));
router.put('/:id/pinned-notes', handle(async (req, res) => {
  need(req, 'comments', 'edit');
  const s = await loadStudent(req, req.params.id);
  await Student.updateOne({ _id: s._id }, { pinned_notes: clean(req.body?.pinned_notes, 10000), updated_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'note', description: 'Internal pinned notes updated', user_id: req.user!.id });
  res.json({ ok: true });
}));
router.post('/:id/comments', handle(async (req, res) => {
  need(req, 'comments', 'add');
  const s = await loadStudent(req, req.params.id);
  const body = clean(req.body?.body, 5000);
  if (!body) throw fieldErr('body', 'Write a comment');
  const handles = [...body.matchAll(/@([a-z0-9._-]{3,32})/gi)].map((m) => m[1].toLowerCase());
  const mentions = handles.length ? (await User.find({ username: { $in: handles } }).select('_id').lean()).map((u) => u._id) : [];
  const c = await Comment.create({ student_id: s._id, body, mentions, created_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'comment', description: `Comment by ${req.user!.name}`, user_id: req.user!.id });
  // mention notifications and file attachments arrive with Notifications / Documents (PORTING.md)
  res.json({ id: String(c._id) });
}));
router.put('/:id/comments/:cid', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const c = oid(req.params.cid) && (await Comment.findOne({ _id: oid(req.params.cid), student_id: s._id, is_deleted: false }));
  if (!c) throw new HttpError(404, 'Comment not found');
  if (String(c.created_by) !== req.user!.id || Date.now() - +c.createdAt > 15 * 60_000) throw bad('Comments can be edited only within 15 minutes');
  const body = clean(req.body?.body, 5000);
  if (!body) throw fieldErr('body', 'Write a comment');
  c.body = body; c.edited_at = new Date(); await c.save();
  res.json({ ok: true });
}));
router.delete('/:id/comments/:cid', handle(async (req, res) => {
  const s = await loadStudent(req, req.params.id);
  const c = oid(req.params.cid) && (await Comment.findOne({ _id: oid(req.params.cid), student_id: s._id, is_deleted: false }));
  if (!c) throw new HttpError(404, 'Comment not found');
  if (!isAdmin(req) && (String(c.created_by) !== req.user!.id || Date.now() - +c.createdAt > 15 * 60_000)) throw bad('Comments can be deleted only within 15 minutes');
  c.is_deleted = true; await c.save();
  res.json({ ok: true });
}));
router.post('/:id/comments/:cid/pin', handle(async (req, res) => {
  need(req, 'comments', 'edit');
  const s = await loadStudent(req, req.params.id);
  const c = oid(req.params.cid) && (await Comment.findOne({ _id: oid(req.params.cid), student_id: s._id, is_deleted: false }));
  if (!c) throw new HttpError(404, 'Comment not found');
  c.is_pinned = !c.is_pinned; await c.save();
  res.json({ ok: true, is_pinned: c.is_pinned });
}));

export default router;
