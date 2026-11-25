import { Types } from 'mongoose';
import University, { type IUniversity, type UniDefaults } from '../models/University';
import Course, { CourseChange, type ICourse, type CourseIntake } from '../models/Course';
import { Country, Intake, MasterItem } from '../models/Master';
import { Shortlist } from '../models/Work';
import { SavedCourse } from '../models/Portal';
import { getSetting } from '../models/Audit';
import { bad, clean, num, istDate } from './crm';
import { type Ctx } from './portalCtx';
import { readAll } from './profile';

/** The course catalogue (legacy/server/portal/catalogue.js, routes/uni_catalogue.js, ids.js): University ID DE-001, Course ID DE-001-0001,
 *  university settings every course follows, student-safe course objects, search and the eligibility hint. */

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const TESTS = ['IELTS', 'TOEFL', 'PTE', 'Duolingo'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEVEL_PREV: Record<string, string | null> = { Bachelor: '12th', Diploma: '12th', Foundation: '12th', 'Language course': null, Master: 'Bachelor', MBA: 'Bachelor', PhD: 'Master' };
const STOP = new Set(['of', 'in', 'and', 'the', 'for', 'with', 'master', 'masters', 'bachelor', 'bachelors', 'science', 'arts', 'msc', 'bsc', 'ma', 'ba', 'degree', 'program', 'programme', 'course',
  'hons', 'b', 'm', 'tech', 'btech', 'mtech', 'be', 'me', 'international']);
const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
const pad = (n: number, w: number) => String(n).padStart(w, '0');

// ---------- IDs ----------
export async function nextUniCode(countryId: unknown) {
  const cc = (await Country.findById(countryId).select('code').lean())?.code || 'XX';
  const n = (await University.find({ uni_code: new RegExp(`^${cc}-`) }).select('uni_code').lean()).reduce((m, x) => Math.max(m, Number(x.uni_code!.split('-')[1]) || 0), 0);
  return `${cc}-${pad(n + 1, 3)}`;
}
export async function nextCourseUid(uni: Pick<IUniversity, '_id' | 'uni_code'>) {
  const n = (await Course.find({ university_id: uni._id, course_uid: { $ne: null } }).select('course_uid').lean()).reduce((m, x) => Math.max(m, Number(String(x.course_uid).slice(-4)) || 0), 0);
  return `${uni.uni_code}-${pad(n + 1, 4)}`;
}

// ---------- university settings ----------
export const defaultsOf = (u: Pick<IUniversity, 'course_defaults'>): UniDefaults => {
  const d = (u.course_defaults ?? {}) as Partial<UniDefaults>;
  return { intakes: d.intakes ?? [], english: d.english ?? [], application_fee: d.application_fee ?? null, application_fee_currency: d.application_fee_currency || 'EUR',
    currency: d.currency ?? null, language: d.language ?? null, academic: d.academic ?? {} };
};
export const normDate = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(+d) ? 'INVALID' : d.toISOString().slice(0, 10);
};
export async function cleanDefaults(b: Any): Promise<UniDefaults> {
  const errors: Record<string, string> = {};
  const intakes = [];
  for (const [n, i] of ((Array.isArray(b.intakes) ? b.intakes : []) as Any[]).filter((i) => i?.intake_id).entries()) {
    if (!Types.ObjectId.isValid(String(i.intake_id)) || !(await Intake.exists({ _id: i.intake_id }))) errors['intake_' + n] = 'Unknown intake';
    const od = normDate(i.open_date), dl = normDate(i.deadline);
    if (od === 'INVALID' || dl === 'INVALID') errors['intake_' + n] = 'Dates must be YYYY-MM-DD';
    if (od && dl && od !== 'INVALID' && dl !== 'INVALID' && od > dl) errors['intake_' + n] = 'Application opens after the deadline';
    intakes.push({ intake_id: String(i.intake_id), open_date: od === 'INVALID' ? null : od, deadline: dl === 'INVALID' ? null : dl, deadline_note: clean(i.deadline_note, 200) ?? null });
  }
  const english = ((Array.isArray(b.english) ? b.english : []) as Any[]).filter((e) => e && (e.test_type || e.moi_accepted)).map((e) => ({
    test_type: TESTS.includes(e.test_type) ? e.test_type : 'IELTS', min_overall: num(e.min_overall) ?? null, min_band: num(e.min_band) ?? null, moi_accepted: !!e.moi_accepted,
    min_12th_english_percent: num(e.min_12th_english_percent) ?? null }));
  const a = (b.academic ?? {}) as Any;
  const academic = { required_level: ['12th', 'Bachelor', 'Master'].includes(a.required_level) ? a.required_level : null, min_percent: num(a.min_percent) ?? null, max_backlogs: num(a.max_backlogs) ?? null,
    min_work_months: num(a.min_work_months) ?? null, entrance_test: a.entrance_test || null };
  if (Object.keys(errors).length) throw bad('Please fix the university settings', { errors });
  return { intakes, english, application_fee: num(b.application_fee) ?? null, application_fee_currency: clean(b.application_fee_currency, 3) || 'EUR', currency: clean(b.currency, 3) || null,
    language: clean(b.language, 30) || null, academic };
}
async function intakeRows(list: UniDefaults['intakes']): Promise<CourseIntake[]> {
  const its = await Intake.find({ _id: { $in: list.map((i) => i.intake_id) } }).lean();
  return list.map((i) => { const it = its.find((x) => String(x._id) === i.intake_id); return { intake_id: new Types.ObjectId(i.intake_id), month: it?.month ?? null, year: it?.year ?? null, open_date: i.open_date, deadline: i.deadline, deadline_note: i.deadline_note }; });
}
/** Apply the university settings to every course that follows them (or to one course). */
export async function applyDefaults(uniId: unknown, onlyCourseId?: unknown) {
  const u = await University.findById(uniId).lean();
  if (!u) return 0;
  const d = defaultsOf(u);
  const hasAcademic = Object.values(d.academic).some((v) => v !== null && v !== undefined && v !== '');
  const intakes = d.intakes.length ? await intakeRows(d.intakes) : [];
  let n = 0;
  for (const c of await Course.find({ university_id: u._id, is_deleted: false, ...(onlyCourseId ? { _id: onlyCourseId } : {}) })) {
    let changed = false;
    if (!c.own_intakes && intakes.length) { c.set('intakes', intakes); changed = true; }
    if (!c.own_english && d.english.length) { c.set('english', d.english); c.min_english = d.english.find((e) => e.test_type === 'IELTS' && e.min_overall)?.min_overall ?? null; changed = true; }
    if (!c.own_app_fee && d.application_fee !== null && d.application_fee !== undefined) { c.application_fee = d.application_fee; c.application_fee_currency = d.application_fee_currency; changed = true; }
    if (!c.own_academic && hasAcademic) { c.set('academic', { ...(c.academic ?? {}), ...d.academic, accepted_fields: c.academic?.accepted_fields ?? [] }); changed = true; }
    if (changed) { await c.save(); n++; }
  }
  return n;
}

// ---------- save a course (CRM course form and the Excel upload) ----------
const COURSE_FIELDS = ['university_id', 'name', 'level', 'field_of_study_id', 'city', 'duration_months', 'language', 'tuition_fee', 'currency', 'tuition_fee_non_eu', 'fee_note', 'application_fee',
  'application_fee_currency', 'course_link', 'description', 'scholarship', 'scholarship_text', 'status', 'last_verified_on', 'internal_note', 'external_id'];
const NUMS = ['duration_months', 'tuition_fee', 'tuition_fee_non_eu', 'application_fee'];
export async function saveCourse(id: unknown, b: Any, userId: string, batchId?: Types.ObjectId) {
  const errors: Record<string, string> = {};
  if (!b.university_id) errors.university_id = 'University is required';
  if (!clean(b.name)) errors.name = 'Course name is required'; else if (String(b.name).length > 200) errors.name = 'Max 200 characters';
  if (!b.level) errors.level = 'Level is required';
  if (!b.field_of_study_id) errors.field_of_study_id = 'Field of study is required';
  if (!num(b.duration_months)) errors.duration_months = 'Duration (months) is required';
  if (!b.language) errors.language = 'Language is required';
  if (num(b.tuition_fee) === undefined) errors.tuition_fee = 'Tuition fee is required (0 allowed)';
  if (!b.course_link || !/^https:\/\//i.test(b.course_link)) errors.course_link = 'Official link is required (https:// only)';
  if (!b.last_verified_on) errors.last_verified_on = 'Last verified date is required';
  if (b.description && String(b.description).length > 1500) errors.description = 'Max 1500 characters';
  if (b.status && !['Draft', 'Published', 'Hidden', 'Archived'].includes(b.status)) errors.status = 'Invalid status';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const uni = await University.findOne({ _id: b.university_id, is_deleted: false }).lean();
  if (!uni) throw bad('Please fix the highlighted fields', { errors: { university_id: 'University not found' } });
  const f: Any = {};
  for (const k of COURSE_FIELDS) if (k in b) f[k] = NUMS.includes(k) ? num(b[k]) ?? null : k === 'scholarship' ? !!b[k] : clean(b[k], k === 'description' ? 1500 : 2000);
  f.duration = f.duration_months ? (f.duration_months % 12 === 0 ? `${f.duration_months / 12} year${f.duration_months > 12 ? 's' : ''}` : `${f.duration_months} months`) : null;
  f.approved = true; f.active = f.status !== 'Archived';
  if (f.field_of_study_id) f.field = (await MasterItem.findById(f.field_of_study_id).select('name').lean())?.name;
  let c = id ? await Course.findById(id) : null;
  if (c) {
    const old = c.toObject() as Any;
    const changes = Object.keys(f).filter((k) => k !== 'duration' && String(old[k] ?? '') !== String(f[k] ?? ''))
      .map((k) => ({ course_id: c!._id, batch_id: batchId, field: k, old_value: old[k] == null ? null : String(old[k]), new_value: f[k] == null ? null : String(f[k]), changed_by: userId }));
    if (changes.length) await CourseChange.insertMany(changes);
    c.set({ ...f, updated_by: userId });
  } else c = new Course({ ...f, status: f.status || 'Draft', course_uid: await nextCourseUid(uni), created_by: userId });
  if (Array.isArray(b.intakes)) c.set('intakes', (b.intakes as Any[]).filter((i) => i.intake_id || i.month).map((i) => ({ intake_id: i.intake_id || null, month: num(i.month) ?? null, year: num(i.year) ?? null,
    every_year: !!i.every_year, open_date: i.open_date || null, deadline: i.deadline || null, deadline_note: clean(i.deadline_note, 200) ?? null })));
  if (Array.isArray(b.english)) {
    const en = (b.english as Any[]).filter((e) => e.test_type || e.moi_accepted || e.min_12th_english_percent).map((e) => ({ test_type: e.test_type || 'IELTS', min_overall: num(e.min_overall) ?? null,
      min_band: num(e.min_band) ?? null, moi_accepted: !!e.moi_accepted, min_12th_english_percent: num(e.min_12th_english_percent) ?? null }));
    c.set('english', en);
    c.min_english = en.find((e) => e.test_type === 'IELTS' && e.min_overall)?.min_overall ?? null;
  }
  if (b.academic) {
    const a = b.academic as Any;
    c.set('academic', { required_level: a.required_level || null, min_percent: num(a.min_percent) ?? null, max_backlogs: num(a.max_backlogs) ?? null, accepted_fields: a.accepted_fields ?? [],
      min_work_months: num(a.min_work_months) ?? null, entrance_test: a.entrance_test || null, note: clean(a.note, 500) ?? null });
  }
  await c.save();
  return c._id as Types.ObjectId;
}
/** The course form: follow the university settings again, or keep the course's own values. */
export async function setFollow(courseId: unknown, b: Any) {
  const c = await Course.findById(courseId);
  if (!c) return;
  for (const k of ['intakes', 'english', 'app_fee', 'academic']) if (b['follow_' + k] !== undefined) c.set('own_' + k, !(b['follow_' + k] === true || b['follow_' + k] === 'true' || b['follow_' + k] === 1));
  await c.save();
  await applyDefaults(c.university_id, c._id);
}
/** A course is published only when the student page has what it needs. */
export function missingForPublish(c: ICourse) {
  const m: string[] = [];
  if (!c.name) m.push('name'); if (!c.level) m.push('level'); if (!c.field_of_study_id) m.push('field of study'); if (!c.duration_months) m.push('duration');
  if (c.tuition_fee === null || c.tuition_fee === undefined) m.push('tuition fee');
  if (!/^https:\/\//i.test(c.course_link ?? '')) m.push('official link');
  if (/non-eu|international|foreign/i.test(c.fee_note ?? '')) m.push('fee note has a forbidden word (non-EU / international / foreign)');
  return m;
}
export async function setStatus(ids: unknown[], status: string, userId: string) {
  const out = { changed: 0, skipped: [] as { id: string; course_id?: string; name: string; missing: string }[] };
  for (const id of ids) {
    const c = Types.ObjectId.isValid(String(id)) ? await Course.findOne({ _id: id, is_deleted: false }) : null;
    if (!c || c.status === status) continue;
    if (status === 'Published') { const m = missingForPublish(c); if (m.length) { out.skipped.push({ id: String(c._id), course_id: c.course_uid, name: c.name, missing: m.join(', ') }); continue; } }
    c.set({ status, updated_by: userId }); await c.save(); out.changed++;
  }
  return out;
}

// ---------- the student-facing side: currency, English equivalence, intakes ----------
async function rates(): Promise<Record<string, number>> {
  try { return JSON.parse(String((await getSetting('currency_rates')) ?? '')); } catch { return { EUR: 1, CNY: 0.13, USD: 0.92, INR: 0.011, SEK: 0.087, GBP: 1.17, CHF: 1.05 }; }
}
const toEur = (r: Record<string, number>, amt?: number | null, cur?: string) => (amt === null || amt === undefined ? null : Number(amt) * (r[cur || 'EUR'] ?? 1));
/** English tests as IELTS (Admin can override with setting english_equivalence). */
export function ieltsOf(test: string | null | undefined, overall: unknown) {
  if (overall === null || overall === undefined || overall === '') return null;
  const o = Number(overall);
  if (!test || test.startsWith('IELTS')) return o;
  const map = (tbl: [number, number][]) => { for (const [min, i] of tbl) if (o >= min) return i; return 4; };
  if (test.startsWith('TOEFL')) return map([[115, 9], [110, 8.5], [102, 8], [94, 7.5], [79, 6.5], [60, 6], [46, 5.5], [35, 5]]);
  if (test.startsWith('PTE')) return map([[86, 9], [83, 8.5], [79, 8], [73, 7.5], [65, 7], [58, 6.5], [50, 6], [43, 5.5], [36, 5]]);
  if (test.startsWith('Duolingo')) return map([[155, 8.5], [145, 8], [135, 7.5], [125, 7], [115, 6.5], [105, 6], [95, 5.5], [85, 5]]);
  return null;
}
async function pct(score: unknown, type?: string) {
  if (score === null || score === undefined) return null;
  if (type === 'CGPA4') return Number(score) * 25;
  if (type === 'CGPA10' || type === 'CGPA') return Number(score) * Number((await getSetting('cgpa_factor')) || 9.5);
  return Number(score);
}
const durationLabel = (c: ICourse) => {
  const m = c.duration_months;
  if (m) { const y = m / 12; return y >= 1 && Number.isInteger(y) ? `${y} year${y > 1 ? 's' : ''}` : m > 12 ? `${(m / 12).toFixed(1)} years` : `${m} months`; }
  return c.duration || '';
};
export async function intakesOf(c: ICourse) {
  const today = istDate();
  const its = await Intake.find({ _id: { $in: (c.intakes ?? []).map((i) => i.intake_id).filter(Boolean) } }).lean();
  return (c.intakes ?? []).map((i) => {
    const im = its.find((x) => String(x._id) === String(i.intake_id));
    const month = im?.month ?? i.month, year = im?.year ?? i.year;
    const days = i.deadline ? Math.round((+new Date(i.deadline) - +new Date(today)) / 864e5) : null;
    return { id: String(i._id), intake_id: i.intake_id ? String(i.intake_id) : null, label: im ? im.name : `${MONTHS[(month || 1) - 1]} ${i.every_year ? '(every year)' : year || ''}`.trim(), month, year,
      open_date: i.open_date, deadline: i.deadline, deadline_note: i.deadline_note, days_left: days, open: !i.deadline || i.deadline >= today };
  }).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
}

// ---------- eligibility hint (5.7): a guide, the university decides ----------
export async function studentFacts(c: Ctx) {
  const p = await readAll(c);
  return { records: p.academic.records ?? [], tests: p.english.tests ?? [], work: p.work, prefs: p.preferences };
}
const workMonths = (rows: Any[]) => rows.reduce((n, w) => {
  if (!/^\d{4}-\d{2}$/.test(w.from_month ?? '')) return n;
  const to = w.till_date ? istDate().slice(0, 7) : w.to_month;
  if (!/^\d{4}-\d{2}$/.test(to ?? '')) return n;
  const [fy, fm] = w.from_month.split('-').map(Number), [ty, tm] = to.split('-').map(Number);
  return n + Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}, 0);
export async function eligibility(c: Ctx, course: ICourse, facts?: Awaited<ReturnType<typeof studentFacts>>) {
  const f = facts ?? (await studentFacts(c));
  const ac = course.academic, en = course.english ?? [];
  const checks: { name: string; result: string; reason: string }[] = [];
  const add = (name: string, result: string, reason: string) => checks.push({ name, result, reason });
  const recs = f.records as Any[];
  const intakes = await intakesOf(course);
  const nextOpen = intakes.find((i) => i.open);
  const intakeYear = nextOpen?.year ?? new Date().getFullYear() + 1;
  const passed = intakes.length > 0 && !nextOpen;
  if (!ac && !en.length) return { overall: 'unknown', label: 'Requirements not available. Ask your counsellor.', checks: [], deadline_passed: passed };
  if (!recs.length && !f.tests.length) return { overall: 'incomplete', label: 'Complete your profile to see eligibility', checks: [], deadline_passed: passed };
  let missing = false;
  const reqLevel = ac?.required_level || LEVEL_PREV[course.level ?? ''] || null;
  let base: Any | undefined;
  if (reqLevel) {
    const lv = reqLevel === '12th' ? ['12th', 'Diploma'] : [reqLevel];
    base = recs.find((r) => lv.includes(r.level));
    if (!base) { if (!recs.length) { missing = true; add('Previous qualification', 'maybe', 'Add your academic details to check this.'); } else add('Previous qualification', 'no', `This course needs ${reqLevel === '12th' ? '12th / Diploma' : 'a ' + reqLevel + ' degree'}.`); }
    else if (base.currently_studying) add('Previous qualification', base.pass_year && base.pass_year <= intakeYear ? 'maybe' : 'no', base.pass_year && base.pass_year <= intakeYear ? `You are currently studying your ${base.level}; it must be finished before the course starts.` : `Your ${base.level} finishes after the course starts.`);
    else add('Previous qualification', 'yes', `You have the required ${base.level}.`);
  }
  if (ac?.min_percent) {
    const s = base ? await pct(base.score, base.score_type) : null;
    if (s === null) { missing = true; add('Academic score', 'maybe', 'Add your score to check this.'); }
    else if (s >= ac.min_percent) add('Academic score', 'yes', `Your score (about ${Math.round(s)}%) meets the minimum ${ac.min_percent}%.`);
    else if (s >= ac.min_percent - 5) add('Academic score', 'maybe', `Your score (about ${Math.round(s)}%) is just below the minimum ${ac.min_percent}%.`);
    else add('Academic score', 'no', `Your score (about ${Math.round(s)}%) is below the minimum ${ac.min_percent}%.`);
  }
  if (ac && ac.max_backlogs !== null && ac.max_backlogs !== undefined) {
    const deg = recs.filter((r) => ['Bachelor', 'Master', 'PhD', 'Other'].includes(r.level));
    if (!deg.length) add('Backlogs', reqLevel === '12th' ? 'yes' : 'maybe', reqLevel === '12th' ? 'No backlog limit applies.' : 'Add your degree details to check this.');
    else { const t = deg.reduce((n, r) => n + (Number(r.backlogs_total) || 0), 0); add('Backlogs', t <= ac.max_backlogs ? 'yes' : t <= ac.max_backlogs + 2 ? 'maybe' : 'no', `You have ${t} backlog(s); the maximum is ${ac.max_backlogs}.`); }
  }
  if (ac?.min_work_months) {
    const months = workMonths(f.work?.rows ?? []);
    add('Work experience', months >= ac.min_work_months ? 'yes' : months >= ac.min_work_months - 6 ? 'maybe' : 'no', `This course asks for ${ac.min_work_months} months of work experience; you have about ${months}.`);
  }
  if (en.length) {
    const tests = f.tests as Any[];
    const moi = tests.some((t) => t.test_type === 'MOI (waiver)');
    const planned = tests.find((t) => t.test_type === 'Not taken yet' && t.planned_date);
    const taken = tests.filter((t) => t.overall !== null && t.overall !== undefined && t.overall !== '');
    const t12 = recs.find((r) => r.level === '12th');
    let res: [string, string] | null = null;
    for (const req of en) {
      if (req.moi_accepted && moi) { res = ['yes', 'MOI (medium of instruction) is accepted.']; break; }
      if (req.min_12th_english_percent && t12 && t12.english_marks >= req.min_12th_english_percent) { res = ['yes', `Your 12th English marks (${t12.english_marks}) meet the waiver of ${req.min_12th_english_percent}%.`]; break; }
      if (req.min_overall) {
        const need = ieltsOf(req.test_type || 'IELTS', req.min_overall)!;
        const best = taken.map((t) => ({ t, i: ieltsOf(t.test_type, t.overall) })).filter((x) => x.i !== null).sort((a, b) => b.i! - a.i!)[0];
        if (best) {
          const bands = ['listening', 'reading', 'writing', 'speaking'].map((k) => Number(best.t[k])).filter((n) => !isNaN(n));
          const minBand = String(best.t.test_type).startsWith('IELTS') && bands.length ? Math.min(...bands) : null;
          const bandOk = !req.min_band || minBand === null || minBand >= req.min_band;
          if (best.i! >= need && bandOk) { res = ['yes', `Your ${best.t.test_type} ${best.t.overall} meets the requirement.`]; break; }
          if ((best.i! >= need - 0.5 && bandOk) || (best.i! >= need && !bandOk && minBand! >= req.min_band! - 0.5)) res ??= ['maybe', `Your ${best.t.test_type} ${best.t.overall} is close to the requirement (${req.test_type || 'IELTS'} ${req.min_overall}${req.min_band ? ', no band below ' + req.min_band : ''}).`];
          else res ??= ['no', `Your ${best.t.test_type} ${best.t.overall} is below the required ${req.test_type || 'IELTS'} ${req.min_overall}.`];
        }
      }
    }
    if (!res) { if (planned) res = ['maybe', `You plan to take your test on ${planned.planned_date}.`]; else if (!tests.length) { missing = true; res = ['maybe', 'Add your English test to check this.']; } else res = ['no', 'Your English test does not meet the requirement.']; }
    if (res[0] === 'no' && planned) res = ['maybe', `Your test is below the requirement, but you plan to take a new test on ${planned.planned_date}.`];
    add('English', res[0], res[1]);
  }
  // the same qualification already done
  const lvMap: Record<string, string[]> = { Bachelor: ['Bachelor'], Master: ['Master'], MBA: ['Master'], PhD: ['PhD'] };
  const cw = words(course.name);
  const done = recs.filter((r) => !r.currently_studying && (lvMap[course.level ?? ''] ?? []).includes(r.level));
  if (done.some((r) => { const aw = words(r.course_name); const ov = cw.filter((w) => aw.includes(w)); return (course.level === 'MBA' && /\bmba\b|business administration/i.test(r.course_name ?? '')) || (ov.length && ov.length >= Math.min(cw.length, aw.length, 2)); }))
    add('Same qualification', 'no', 'You already have a similar qualification. Please discuss with your counsellor.');
  const overall = checks.some((x) => x.result === 'no') ? 'no' : checks.some((x) => x.result === 'maybe') || missing ? 'maybe' : 'yes';
  return { overall, label: ({ yes: 'Eligible', maybe: 'Maybe', no: 'Not eligible' } as Record<string, string>)[overall], checks, deadline_passed: passed,
    guide: 'This is only a guide based on the details in your profile. The university makes the final decision, and your counsellor will confirm your eligibility.' };
}

// ---------- student-safe course object (never the internal note or partner data) ----------
/** The logo path on the API (the uploaded logo, or a coloured placeholder with the initials). The frontends prefix the API origin. */
export const logoOf = (u?: { _id?: unknown; logo_updated_at?: Date } | null) => (u?._id ? `/api/logos/${u._id}${u.logo_updated_at ? `?v=${+new Date(u.logo_updated_at)}` : ''}` : null);
export async function courseOut(row: ICourse, c: Ctx | null, opts: { detail?: boolean; facts?: Awaited<ReturnType<typeof studentFacts>> } = {}) {
  const uni = await University.findById(row.university_id).select('name city website country_id logo_updated_at').lean();
  const country = uni?.country_id ? await Country.findById(uni.country_id).select('name code aps_required').lean() : null;
  const intakes = await intakesOf(row);
  const nextOpen = intakes.find((i) => i.open);
  const e0 = (row.english ?? []).slice().sort((a, b) => Number(a.min_overall == null) - Number(b.min_overall == null))[0];
  const f1 = (n: number) => (Number.isInteger(Number(n)) ? Number(n).toFixed(1) : String(n));
  const out: Any = {
    id: String(row._id), code: row.course_uid || row.course_code, name: row.name, level: row.level, field: row.field, city: row.city || uni?.city,
    university: { id: uni ? String(uni._id) : null, name: uni?.name, website: uni?.website, logo: logoOf(uni) }, country: { id: country ? String(country._id) : null, name: country?.name, code: country?.code },
    duration: durationLabel(row), language: row.language, intakes, next_intake: nextOpen ?? null, deadline_passed: intakes.length > 0 && !nextOpen, tuition_fee: row.tuition_fee, currency: row.currency || 'EUR',
    tuition_fee_non_eu: row.tuition_fee_non_eu, fee_note: row.fee_note, application_fee: row.application_fee, application_fee_currency: row.application_fee_currency || row.currency || 'EUR',
    aps_required: !!country?.aps_required, official_link: row.course_link, last_verified_on: row.last_verified_on,
    req: { min_percent: row.academic?.min_percent || null, required_level: row.academic?.required_level ?? null,
      english: e0 ? (e0.min_overall ? `${e0.test_type || 'IELTS'} ${e0.min_overall}${e0.min_band ? ` (no band below ${f1(e0.min_band)})` : ''}` : e0.moi_accepted ? 'MOI accepted' : null) : null },
  };
  if (row.scholarship) out.scholarship = row.scholarship_text || 'Scholarship available';
  if (opts.detail) {
    const a = row.academic;
    out.description = row.description;
    out.english = (row.english ?? []).map((e) => [e.min_overall ? `${e.test_type || 'IELTS'} ${e.min_overall} overall${e.min_band ? `, no band below ${e.min_band}` : ''}` : null,
      e.moi_accepted ? 'MOI accepted: Yes' : null, e.min_12th_english_percent ? `12th English waiver: minimum ${e.min_12th_english_percent}%` : null].filter(Boolean).join(' · '));
    out.academic = a ? [a.required_level ? `${a.required_level === '12th' ? '12th / Diploma' : a.required_level + ' degree'}${a.accepted_fields?.length ? ' in ' + a.accepted_fields.join(', ') : ''}` : null,
      a.min_percent ? `minimum ${a.min_percent}%` : null, a.max_backlogs !== null && a.max_backlogs !== undefined ? `maximum ${a.max_backlogs} backlogs` : null].filter(Boolean).join(', ') : null;
    out.other = [a?.min_work_months ? `Work experience: ${a.min_work_months} months` : null, a?.entrance_test && a.entrance_test !== 'none' ? `Entrance test: ${a.entrance_test}` : null, a?.note || null].filter(Boolean);
  }
  if (c) {
    out.saved = !c.su.isNew && !!(await SavedCourse.exists({ student_user_id: c.su._id, course_id: row._id, removed_at: null }));
    out.suggested = !!(c.student && (await Shortlist.exists({ student_id: c.student._id, course_id: row._id, is_deleted: false, status: { $ne: 'Suggested' } })));
    out.eligibility = await eligibility(c, row, opts.facts);
  }
  return out;
}

const lev = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
async function published() {
  const unis = await University.find({ is_deleted: false, active: true }).select('name city country_id').lean();
  const rows = await Course.find({ is_deleted: false, status: 'Published', university_id: { $in: unis.map((u) => u._id) } });
  return { rows, uni: new Map(unis.map((u) => [String(u._id), u])) };
}
/** Search with the portal's filters; with a student context every row carries the eligibility hint. */
export async function search(c: Ctx | null, q: Any) {
  const multi = (v: unknown) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map(String).filter(Boolean);
  const all0 = await published();
  let rows = all0.rows;
  const uni = all0.uni;
  const r = await rates();
  const facts = c ? await studentFacts(c) : undefined;
  const U = (x: ICourse) => uni.get(String(x.university_id))!;
  if (q.q && String(q.q).trim()) {
    const qs = String(q.q).toLowerCase().trim();
    const tokens = [...new Set(words(q.q).concat(qs.split(/\s+/).filter((w) => w.length > 2)))];
    const fuzzy = (hay: string, t: string) => hay.includes(t) || (t.length > 4 && hay.split(/\s+/).some((w) => w.length >= t.length - 1 && lev(w.slice(0, t.length + 1), t) <= 1));
    rows = rows.filter((x) => { const hay = `${x.name} ${U(x).name} ${U(x).city ?? ''} ${x.city ?? ''} ${x.field ?? ''}`.toLowerCase(); return hay.includes(qs) || tokens.every((t) => fuzzy(hay, t)); });
  }
  const countries = multi(q.country); if (countries.length) rows = rows.filter((x) => countries.includes(String(U(x).country_id)));
  const levels = multi(q.level); if (levels.length) rows = rows.filter((x) => levels.includes(x.level ?? '') || (levels.includes('Other') && !['Bachelor', 'Master'].includes(x.level ?? '')));
  const fields = multi(q.field); if (fields.length) rows = rows.filter((x) => fields.includes(String(x.field_of_study_id)));
  const cities = multi(q.city); if (cities.length) rows = rows.filter((x) => cities.includes(x.city || U(x).city || ''));
  const langs = multi(q.language); if (langs.length) rows = rows.filter((x) => langs.includes(x.language ?? ''));
  if (q.free_app === '1') rows = rows.filter((x) => !x.application_fee);
  if (q.fee_min || q.fee_max) rows = rows.filter((x) => { const e = toEur(r, x.tuition_fee, x.currency); return e !== null && (!q.fee_min || e >= Number(q.fee_min)) && (!q.fee_max || e <= Number(q.fee_max)); });
  const durs = multi(q.duration);
  if (durs.length) rows = rows.filter((x) => { const m = x.duration_months || 0; return durs.some((d) => (d === '1' && m <= 12) || (d === '2' && m > 12 && m <= 24) || (d === '3' && m > 24 && m <= 36) || (d === '4' && m > 36)); });
  if (q.english_test && q.english_score) {
    const mine = ieltsOf(q.english_test === 'MOI' ? null : q.english_test, q.english_score);
    rows = rows.filter((x) => !x.english?.length || x.english.some((e) => (q.english_test === 'MOI' && e.moi_accepted) || (e.min_overall && mine !== null && mine >= ieltsOf(e.test_type || 'IELTS', e.min_overall)!)));
  }
  let out = await Promise.all(rows.map((x) => courseOut(x, c, { facts })));
  const months = multi(q.intake_month).map(Number);
  if (months.length) out = out.filter((x) => x.intakes.some((i: Any) => months.includes(i.month) && (!q.intake_year || i.year === Number(q.intake_year) || !i.year)));
  if (q.hide_passed !== '0') out = out.filter((x) => !x.deadline_passed);
  if (c && q.eligible === '1') out = out.filter((x) => ['yes', 'maybe'].includes(x.eligibility.overall));
  const byId = new Map(rows.map((x) => [String(x._id), x]));
  const sort = q.sort || 'relevance';
  if (sort === 'deadline') out.sort((a, b) => (a.next_intake?.deadline || '9999').localeCompare(b.next_intake?.deadline || '9999'));
  if (sort === 'fee_asc') out.sort((a, b) => (toEur(r, a.tuition_fee, a.currency) ?? 1e9) - (toEur(r, b.tuition_fee, b.currency) ?? 1e9));
  if (sort === 'fee_desc') out.sort((a, b) => (toEur(r, b.tuition_fee, b.currency) ?? -1) - (toEur(r, a.tuition_fee, a.currency) ?? -1));
  if (sort === 'duration') out.sort((a, b) => (byId.get(a.id)?.duration_months || 99) - (byId.get(b.id)?.duration_months || 99));
  if (sort === 'recent') out.sort((a, b) => +byId.get(b.id)!.createdAt - +byId.get(a.id)!.createdAt);
  if (sort === 'relevance') {
    const rank: Record<string, number> = { yes: 0, maybe: 1, incomplete: 2, unknown: 2, no: 3 };
    out.sort((a, b) => Number(!!b.suggested) - Number(!!a.suggested) || (c ? rank[a.eligibility.overall] - rank[b.eligibility.overall] : 0) || a.name.localeCompare(b.name));
  }
  const page = Math.max(1, Number(q.page) || 1);
  return { total: out.length, rows: out.slice(0, page * 20), page, has_more: out.length > page * 20 };
}
export async function filterOptions() {
  const { rows, uni } = await published();
  const r = await rates();
  const cset = new Set(rows.map((x) => String(uni.get(String(x.university_id))?.country_id)));
  const cities = new Map<string, { city: string; country: string }>();
  for (const x of rows) { const u = uni.get(String(x.university_id)); const city = x.city || u?.city; if (city) cities.set(`${city}|${u?.country_id}`, { city, country: String(u?.country_id) }); }
  return {
    countries: (await Country.find().sort({ sort: 1, name: 1 }).select('name').lean()).filter((x) => cset.has(String(x._id))).map((x) => ({ id: String(x._id), name: x.name })),
    fields: (await MasterItem.find({ type: 'field_of_study', active: true }).sort({ sort: 1, name: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
    cities: [...cities.values()], languages: [...new Set(rows.map((x) => x.language).filter(Boolean))],
    fee_max: Math.ceil(Math.max(0, ...rows.map((x) => toEur(r, x.tuition_fee, x.currency) || 0)) / 1000) * 1000,
  };
}
