import type { Request } from 'express';
import { Types } from 'mongoose';
import Student, { type IStudent } from '../models/Student';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import Lead from '../models/Lead';
import User from '../models/User';
import { ProfileDraft, ProfileChangeRequest } from '../models/Portal';
import { StudentDocument } from '../models/Work';
import { MasterItem } from '../models/Master';
import { bad, clean, num, istDate, encrypt, hmac, validPassport, fullName, timeline, addDays } from './crm';
import { passportOf } from './students';
import { notifyAdmins, createTask } from './tasks';
import { type Ctx, loadCtx, displayName, studentTimeline, portalAudit, notifyStaff, completion } from './portalCtx';

/** The student profile (legacy/server/portal/profile.js): six sections, validation, locks after submit, change requests, drafts for leads. */

export const SECTIONS = ['personal', 'passport', 'academic', 'work', 'english', 'preferences'] as const;
type Section = typeof SECTIONS[number];
export const BUDGETS: Record<string, number | null> = { 'Up to EUR 5,000': 4000, 'EUR 5,000 to 10,000': 7500, 'EUR 10,000 to 15,000': 12500, 'Above EUR 15,000': 18000, 'Not sure': null };
const PERSONAL_KEYS = ['first_name', 'middle_name', 'last_name', 'no_surname', 'gender', 'dob', 'whatsapp', 'nationality', 'address1', 'address2', 'city', 'state', 'pin',
  'marital_status', 'spouse_travel', 'emergency_name', 'emergency_phone', 'parent_name', 'parent_phone', 'parent_consent'] as const;
export const LOCKED: Record<string, string[]> = {
  personal: ['first_name', 'middle_name', 'last_name', 'no_surname', 'gender', 'dob', 'nationality', 'marital_status', 'spouse_travel'],
  passport: ['has_passport', 'passport', 'passport_issue', 'passport_expiry', 'passport_place'],
  preferences: ['country_ids', 'level', 'intake_id', 'budget_range_label'],
};
export const LABELS: Record<string, string> = { first_name: 'First name', middle_name: 'Middle name', last_name: 'Last name', no_surname: 'No surname', gender: 'Gender', dob: 'Date of birth',
  nationality: 'Nationality', marital_status: 'Marital status', spouse_travel: 'Spouse will travel', passport: 'Passport number', passport_issue: 'Passport issue date', passport_expiry: 'Passport expiry date',
  passport_place: 'Passport place of issue', has_passport: 'Has passport', country_ids: 'Preferred countries', level: 'Preferred level', intake_id: 'Preferred intake', budget_range_label: 'Tuition budget',
  email: 'Email address', score: 'Percentage / CGPA', pass_year: 'Year of passing', board_university: 'Board / university', course_name: 'Course name', backlogs_total: 'Backlogs (total)',
  backlogs_active: 'Active backlogs', institution: 'School / college', score_type: 'Score unit', stream: 'Stream' };
// the last (highest) education decides which qualifications the student fills: 12th asks 10th and 12th
export const LAST_EDU = ['10th', '12th', 'Diploma', 'Bachelor', 'Master', 'PhD'];
export const EDU_RANK: Record<string, number> = { '10th': 1, '12th': 2, Diploma: 2, Bachelor: 3, Master: 4, PhD: 5 };
// aptitude / admission tests: [total min, max, step, parts [[key, label, min, max, step]]]
export const APT: Record<string, [number, number, number, [string, string, number, number, number][]]> = {
  SAT: [400, 1600, 10, [['rw', 'Reading and Writing', 200, 800, 10], ['math', 'Math', 200, 800, 10]]],
  ACT: [1, 36, 1, []],
  'GRE General': [260, 340, 1, [['verbal', 'Verbal', 130, 170, 1], ['quant', 'Quantitative', 130, 170, 1], ['awa', 'Analytical Writing', 0, 6, 0.5]]],
  'GMAT Focus Edition': [205, 805, 1, [['quant', 'Quantitative', 60, 90, 1], ['verbal', 'Verbal', 60, 90, 1], ['di', 'Data Insights', 60, 90, 1]]],
  'GMAT (classic)': [200, 800, 10, []],
  'IMAT (Italy, Medicine)': [-24, 90, 0.1, []],
  'TOLC (Italy, CISIA)': [-50, 100, 0.01, []],
  'CENT-S (Italy, CISIA)': [-50, 100, 0.01, []],
  'TIL / ARCHED (Italy, Architecture)': [-50, 100, 0.01, []],
  'Other test': [-1000, 100000, 0.01, []],
};
export const APT_TYPES = [...Object.keys(APT), 'Not taken yet'];
const ENGLISH_TYPES = ['IELTS Academic', 'IELTS General', 'TOEFL iBT', 'PTE Academic', 'Duolingo', 'Not taken yet', 'MOI (waiver)'];
const RANGE: Record<string, [number, number, number, number, number]> = { 'IELTS Academic': [0, 9, 0.5, 0, 9], 'IELTS General': [0, 9, 0.5, 0, 9], 'TOEFL iBT': [0, 120, 1, 0, 30],
  'PTE Academic': [10, 90, 1, 10, 90], Duolingo: [10, 160, 1, 10, 160] };

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

// ---------- portal account flags and lead drafts ----------
export const flags = (su: IPortalAccount) => (su.flags ?? {}) as Any;
export async function setFlags(su: IPortalAccount, f: Any) {
  su.flags = { ...flags(su), ...f };
  su.markModified('flags');
  if (!su.isNew) await PortalAccount.updateOne({ _id: su._id }, { flags: su.flags });
  // a student file without a portal login keeps these answers itself
  else if (su.studentId) await Student.updateOne({ _id: su.studentId }, { 'info_extra.profile_flags': su.flags });
}
export async function draft(su: IPortalAccount, section: string) { return ((await ProfileDraft.findOne({ student_user_id: su._id, section }).lean())?.data ?? null) as Any | null; }
export const saveDraft = (su: IPortalAccount, section: string, data: Any) => ProfileDraft.updateOne({ student_user_id: su._id, section }, { data }, { upsert: true });

// ---------- read ----------
export function lastEducation(d: Any | null, f: Any = {}) {
  if (d && LAST_EDU.includes(d.last_education)) return d.last_education as string;
  if (LAST_EDU.includes(f.last_education)) return f.last_education as string;
  const recs: Any[] = d?.records ?? [];
  const hasL = (l: string) => recs.some((r) => r.level === l);
  if (hasL('PhD')) return 'PhD'; if (hasL('Master')) return 'Master'; if (hasL('Bachelor')) return 'Bachelor';
  if (d?.has_bachelor === false) { const r12 = recs.find((r) => r.level === '12th' || r.level === 'Diploma'); if (r12) return r12.level as string; }
  return null;
}
const rowsOf = <T extends { _id?: Types.ObjectId }>(rows: T[]) => rows.map((r) => { const o = { ...(r as Any).toObject?.() ?? r }; o.id = String(o._id); delete o._id; return o as Any; });
async function readSection0(c: Ctx, section: Section): Promise<Any> {
  const { su, student: st, lead } = c;
  const f = flags(su);
  if (!st) { // a lead account: its draft, prefilled from the lead
    const d = await draft(su, section);
    if (d) return d;
    if (section === 'personal') return { first_name: lead?.first_name, last_name: lead?.last_name, nationality: 'Indian', whatsapp: lead?.is_whatsapp ? lead.phone : null, city: lead?.city, state: lead?.state };
    if (section === 'passport') return {};
    if (section === 'academic') return { records: [], has_bachelor: null, has_master: null };
    if (section === 'work') return { has_work: null, rows: [] };
    if (section === 'english') return { tests: [] };
    const l = lead as Any | null;
    return { country_ids: (l?.interested_countries ?? []).map(String), course: l?.course_interest, level: l?.level, intake_id: l?.intake_id ? String(l.intake_id) : null, languages: [] };
  }
  if (section === 'personal') {
    const o: Any = {};
    for (const k of PERSONAL_KEYS) o[k] = (st as Any)[k];
    o.spouse_travel = st.marital_status === 'Married' ? !!st.spouse_travel : null;
    o.no_surname = !!st.no_surname; o.parent_name = f.parent_name ?? null; o.parent_phone = f.parent_phone ?? null; o.parent_consent = !!st.family?.parent_consent;
    return o;
  }
  if (section === 'passport') return { has_passport: f.has_passport === false ? false : st.passport_enc ? true : f.has_passport ?? null, passport: passportOf(st), passport_issue: st.passport_issue,
    passport_expiry: st.passport_expiry, passport_place: st.passport_place };
  if (section === 'academic') {
    const records = rowsOf([...st.academics].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.pass_year ?? 0) - (b.pass_year ?? 0)));
    return { records, has_bachelor: records.some((r) => r.level === 'Bachelor') ? true : f.has_bachelor ?? null, has_master: records.some((r) => r.level === 'Master') ? true : f.has_master ?? null };
  }
  if (section === 'work') { const rows = rowsOf([...st.work].sort((a, b) => String(a.from_month).localeCompare(String(b.from_month)))); return { has_work: rows.length ? true : f.has_work ?? null, rows }; }
  if (section === 'english') return { tests: rowsOf(st.tests), aptitude: rowsOf(st.aptitude ?? []).map((r) => ({ ...r, ...(r.parts ?? {}), parts: undefined })) };
  const p = st.prefs ?? ({} as IStudent['prefs']);
  return { country_ids: (p.country_ids ?? []).map(String), course: p.course, level: p.level, intake_id: p.intake_id ? String(p.intake_id) : null, languages: p.languages ?? [], budget_range_label: p.budget_range_label ?? null };
}
export async function readSection(c: Ctx, section: Section) {
  const out = await readSection0(c, section);
  if (section === 'academic') out.last_education = lastEducation(out, flags(c.su));
  if (section === 'english' && !out.aptitude) out.aptitude = [];
  return out;
}
export async function readAll(c: Ctx) {
  const out: Any = {};
  for (const s of SECTIONS) out[s] = await readSection(c, s);
  return out as { personal: Any; passport: Any; academic: { records: Any[]; last_education?: string | null; has_bachelor?: boolean | null; has_master?: boolean | null }; work: { has_work?: boolean | null; rows: Any[] };
    english: { tests: Any[]; aptitude: Any[] }; preferences: Any };
}
/** What the student may see: the budget is hidden after submit (3.7). */
export async function studentView(c: Ctx) { const a = await readAll(c); if (c.su.profileSubmittedAt) delete a.preferences.budget_range_label; return a; }

export async function locks(c: Ctx) {
  const out: { submitted: boolean; fields: Record<string, boolean>; sections?: Record<string, boolean>; pending: unknown[] } = { submitted: !!c.su.profileSubmittedAt, fields: {}, pending: [] };
  const passportType = c.student ? await MasterItem.findOne({ type: 'document_type', name: 'Passport' }).select('_id').lean() : null;
  const verifiedPassport = c.student && passportType && (await StudentDocument.exists({ student_id: c.student._id, document_type_id: passportType._id, status: 'Verified', is_deleted: false }));
  if (c.student && (c.su.profileSubmittedAt || verifiedPassport)) for (const k of LOCKED.passport) out.fields['passport.' + k] = true;
  if (c.student && c.su.profileSubmittedAt) {
    for (const k of LOCKED.personal) out.fields['personal.' + k] = true;
    for (const k of LOCKED.preferences) out.fields['preferences.' + k] = true;
    out.sections = { academic: true, work: true, english: true };
  }
  if (c.student) out.pending = (await ProfileChangeRequest.find({ student_id: c.student._id, status: 'Pending', is_deleted: false }).lean())
    .map((x) => ({ id: String(x._id), field_key: x.field_key, field_label: x.field_label, new_value: x.new_value, status: x.status, created_at: x.createdAt }));
  return out;
}

// ---------- validation ----------
const yr = () => new Date().getFullYear();
const validScore = (v: unknown, t?: string) => { const n = Number(v); if (!has(v) || isNaN(n)) return false; return t === 'CGPA4' ? n >= 0 && n <= 4 : t === 'CGPA10' || t === 'CGPA' ? n >= 0 && n <= 10 : n >= 0 && n <= 100; };
const inR = (v: unknown, a: number, b: number, st: number) => { const n = Number(v); return !isNaN(n) && n >= a && n <= b && Math.abs(n / st - Math.round(n / st)) < 1e-9; };
export async function validate(section: string, d: Any, strict: boolean, c?: Ctx | null) {
  const e: Record<string, string> = {};
  const today = istDate();
  if (section === 'personal') {
    if (strict) {
      for (const [k, l] of [['first_name', 'First name'], ['gender', 'Gender'], ['dob', 'Date of birth'], ['nationality', 'Nationality'], ['marital_status', 'Marital status']]) if (!has(d[k])) e[k] = `${l} is required`;
      if (!d.no_surname && !has(d.last_name)) e.last_name = 'Last name is required (or tick "I have no surname")';
    }
    if (has(d.first_name) && (!/^[A-Za-z .]+$/.test(d.first_name) || d.first_name.length > 50)) e.first_name = 'Letters, spaces and dot only (max 50)';
    if (has(d.dob)) {
      const age = Math.floor((Date.now() - +new Date(d.dob)) / (365.25 * 864e5));
      if (isNaN(age) || age < 15 || age > 60) e.dob = 'Age must be between 15 and 60';
      else if (age < 18 && strict) {
        if (!d.parent_consent) e.parent_consent = 'Please confirm your parent / guardian has agreed';
        if (!has(d.parent_name)) e.parent_name = 'Parent / guardian name is required';
        if (!has(d.parent_phone)) e.parent_phone = 'Parent / guardian phone is required';
      }
    }
    if (has(d.pin) && !/^\d{6}$/.test(d.pin)) e.pin = 'PIN code must be 6 digits';
    if (strict && d.marital_status === 'Married' && (d.spouse_travel === null || d.spouse_travel === undefined)) e.spouse_travel = 'Please choose Yes or No';
  }
  if (section === 'passport') {
    if (strict && (d.has_passport === null || d.has_passport === undefined)) e.has_passport = 'Please choose Yes or No';
    if (d.has_passport) {
      const pp = d.passport ? String(d.passport).toUpperCase().replace(/\s/g, '') : '';
      const nat = (c && (await readSection(c, 'personal')).nationality) || 'Indian';
      if (strict && !pp) e.passport = 'Passport number is required';
      if (pp && !validPassport(pp, nat)) e.passport = nat === 'Indian' ? 'Indian passport format: 1 letter + 7 digits (e.g. A1234567)' : '6 to 12 letters / numbers';
      if (strict && !has(d.passport_issue)) e.passport_issue = 'Issue date is required';
      if (strict && !has(d.passport_expiry)) e.passport_expiry = 'Expiry date is required';
      if (has(d.passport_issue) && d.passport_issue > today) e.passport_issue = 'Issue date cannot be in the future';
      if (has(d.passport_issue) && has(d.passport_expiry) && d.passport_expiry <= d.passport_issue) e.passport_expiry = 'Expiry must be after issue date';
    }
  }
  if (section === 'academic') {
    const recs: Any[] = d.records ?? [];
    const t10 = recs.find((r) => r.level === '10th'), t12 = recs.find((r) => r.level === '12th' || r.level === 'Diploma');
    const last = lastEducation(d), rank = EDU_RANK[last ?? ''] || 0;
    if (has(d.last_education) && !LAST_EDU.includes(d.last_education)) e.last_education = 'Invalid choice';
    if (strict && !last) e.last_education = 'Please select your last (highest) education';
    if (strict && !t10) e['10th.score'] = '10th details are required';
    if (strict && rank >= 2 && !t12) e['12th.score'] = '12th or Diploma details are required';
    if (strict && rank >= 3 && !recs.some((r) => r.level === 'Bachelor')) e.last_education = 'Bachelor details are required';
    if (strict && rank >= 4 && !recs.some((r) => r.level === 'Master')) e.last_education = "Master's details are required";
    recs.forEach((a, i) => {
      const k = (f: string) => `${i}.${f}`;
      if ((strict && !has(a.score_type)) || (has(a.score_type) && !['%', 'CGPA10', 'CGPA4', 'CGPA'].includes(a.score_type))) e[k('score_type')] = 'Select the score unit';
      if ((strict || has(a.score)) && !validScore(a.score, a.score_type)) e[k('score')] = a.score_type === 'CGPA4' ? 'CGPA must be 0 to 4' : String(a.score_type ?? '').startsWith('CGPA') ? 'CGPA must be 0 to 10' : 'Percentage must be 0 to 100';
      if ((strict || has(a.pass_year)) && (!a.pass_year || a.pass_year < 1980 || a.pass_year > yr() + (a.currently_studying ? 6 : 0))) e[k('pass_year')] = `Year between 1980 and ${a.currently_studying ? yr() + 6 : yr()}`;
      if (strict && (a.level === '12th' || a.level === 'Diploma') && !has(a.board_university)) e[k('board_university')] = 'Board is required';
      if ((a.level === '12th' || a.level === 'Diploma') && t10 && a.pass_year && t10.pass_year && Number(a.pass_year) <= Number(t10.pass_year)) e[k('pass_year')] = 'Must be after 10th year';
      if (['Bachelor', 'Master', 'PhD', 'Other'].includes(a.level)) {
        if (strict && !has(a.course_name)) e[k('course_name')] = 'Course name is required';
        if (strict && !has(a.backlogs_total)) e[k('backlogs_total')] = 'Backlogs (total) is required (0 if none)';
        else if (has(a.backlogs_total) && (a.backlogs_total < 0 || a.backlogs_total > 50)) e[k('backlogs_total')] = '0 to 50';
        if (has(a.backlogs_active) && Number(a.backlogs_active) > Number(a.backlogs_total || 0)) e[k('backlogs_active')] = 'Cannot be more than total';
        if (a.level === 'Bachelor' && t12 && a.pass_year && t12.pass_year && Number(a.pass_year) <= Number(t12.pass_year)) e[k('pass_year')] = 'Must be after 12th year';
      }
      if (has(a.english_marks) && (a.english_marks < 0 || a.english_marks > 100)) e[k('english_marks')] = '0 to 100';
    });
  }
  if (section === 'work') {
    if (strict && (d.has_work === null || d.has_work === undefined)) e.has_work = 'Please answer this question';
    const thisMonth = today.slice(0, 7);
    ((d.has_work ? d.rows : []) ?? []).forEach((w: Any, i: number) => {
      const k = (f: string) => `w${i}.${f}`;
      if (!has(w.company)) e[k('company')] = 'Company is required';
      if (!has(w.designation)) e[k('designation')] = 'Designation is required';
      if (!/^\d{4}-\d{2}$/.test(w.from_month ?? '')) e[k('from_month')] = 'From (MM/YYYY) is required';
      if (!w.till_date && !/^\d{4}-\d{2}$/.test(w.to_month ?? '')) e[k('to_month')] = 'To is required unless "Till date"';
      if (!w.till_date && w.to_month && w.from_month && w.to_month < w.from_month) e[k('to_month')] = 'Must be after From';
      if (!w.till_date && w.to_month && w.to_month > thisMonth) e[k('to_month')] = 'Cannot be in the future';
    });
  }
  if (section === 'english') {
    (d.tests ?? []).forEach((t: Any, i: number) => {
      const k = (f: string) => `t${i}.${f}`;
      if (!ENGLISH_TYPES.includes(t.test_type)) { e[k('test_type')] = 'Select a test'; return; }
      const R = RANGE[t.test_type];
      if (R) {
        if (!inR(t.overall, R[0], R[1], R[2])) e[k('overall')] = `Overall must be ${R[0]} to ${R[1]}${R[2] < 1 ? ' (step 0.5)' : ''}`;
        for (const sb of ['listening', 'reading', 'writing', 'speaking']) {
          const hv = has(t[sb]);
          if (t.test_type !== 'Duolingo' && !hv) e[k(sb)] = 'Required'; else if (hv && !inR(t[sb], R[3], R[4], R[2])) e[k(sb)] = `${R[3]} to ${R[4]}`;
        }
      }
      if (t.test_type === 'Not taken yet' && !has(t.planned_date)) e[k('planned_date')] = 'Planned test date is required';
      else if (t.test_type === 'Not taken yet' && t.planned_date <= today && !t.id) e[k('planned_date')] = 'Must be a future date';
    });
    // aptitude / admission tests: optional, but complete when added
    (d.aptitude ?? []).forEach((t: Any, i: number) => {
      const k = (f: string) => `a${i}.${f}`;
      if (!APT_TYPES.includes(t.test_type)) { e[k('test_type')] = 'Select a test'; return; }
      if (t.test_type === 'Not taken yet') {
        if (!has(t.other_name)) e[k('other_name')] = 'Which test? (e.g. GRE, SAT, IMAT)';
        if (!has(t.planned_date)) e[k('planned_date')] = 'Planned test date is required';
        else if (t.planned_date <= today && !t.id) e[k('planned_date')] = 'Must be a future date';
        return;
      }
      if (t.test_type === 'Other test' && !has(t.other_name)) e[k('other_name')] = 'Test name is required';
      const [mn, mx, st0, parts] = APT[t.test_type];
      if (!has(t.total)) e[k('total')] = 'Score is required';
      else if (!inR(t.total, mn, mx, st0) && t.test_type !== 'Other test') e[k('total')] = `${mn} to ${mx}`;
      for (const [pk, , a0, b0, s0] of parts) if (has(t[pk]) && !inR(t[pk], a0, b0, s0)) e[k(pk)] = `${a0} to ${b0}`;
      if (has(t.test_date) && t.test_date > today) e[k('test_date')] = 'Cannot be in the future';
    });
  }
  if (section === 'preferences') {
    if (strict) {
      if (!d.country_ids?.[0]) e.country_ids = 'Preferred country 1 is required';
      if (!has(d.course)) e.course = 'Preferred course / field is required';
      if (!has(d.level)) e.level = 'Preferred level is required';
      if (!has(d.intake_id)) e.intake_id = 'Preferred intake is required';
    }
    if (d.budget_range_label && !(d.budget_range_label in BUDGETS)) e.budget_range_label = 'Invalid choice';
  }
  return e;
}

// ---------- write ----------
const sameVal = (a: unknown, b: unknown) => {
  if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) return true;
  if ((a && typeof a === 'object') || (b && typeof b === 'object')) return false;
  return String(a ?? '') === String(b ?? '');
};
/** The student saves a section on the portal: locked fields after submit need a change request; leads save a draft. */
export async function saveSection(req: Request, c: Ctx, section: string, data: Any, strict: boolean) {
  if (!(SECTIONS as readonly string[]).includes(section)) throw bad('Unknown section');
  if (c.readOnly) throw bad('Your file is currently inactive. Contact your counsellor to restart.');
  const d = { ...data };
  if (section === 'passport' && d.passport) d.passport = String(d.passport).toUpperCase().replace(/\s/g, '');
  const errors = await validate(section, d, strict, c);
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const lk = await locks(c);
  const cur = await readSection(c, section as Section);
  if (c.student) {
    if (lk.sections?.[section]) throw bad('This part of your profile is locked after submit. Use "Request change" to ask your counsellor.');
    for (const [key, isLocked] of Object.entries(lk.fields)) {
      const [sec, f] = key.split('.');
      if (sec === section && isLocked && f in d && !sameVal(d[f], cur[f])) throw bad(`${LABELS[f] || f} is locked. Use "Request change" to ask your counsellor.`, { errors: { [f]: 'Locked: request a change' } });
    }
    await writeStudent(req, c, section as Section, d, cur);
  } else await saveDraft(c.su, section, { ...cur, ...d });
  const fresh = await PortalAccount.findById(c.su._id);
  return completion(fresh ? await loadCtx(fresh) : c);
}

/** Write one section into the student file. by = a staff name when the CRM or an agent writes (direct, same validation). */
export async function writeStudent(req: Request, c: Ctx, section: Section, d: Any, cur: Any, opts: { by?: string; userId?: string } = {}) {
  const st = c.student!;
  const su = c.su;
  const byType = opts.by ? 'staff' : 'student';
  const changed = Object.keys(d).filter((k) => !sameVal(d[k], cur[k]));
  if (!changed.length) return;
  if (section === 'personal') {
    for (const k of ['first_name', 'middle_name', 'last_name', 'gender', 'dob', 'whatsapp', 'nationality', 'address1', 'address2', 'city', 'state', 'pin', 'marital_status', 'emergency_name', 'emergency_phone'])
      if (k in d) { const v = clean(d[k], 200); if (k !== 'first_name' || v) st.set(k, v); }
    if ('no_surname' in d) { st.no_surname = !!d.no_surname; if (d.no_surname) st.last_name = undefined; }
    if ('spouse_travel' in d) st.spouse_travel = !!d.spouse_travel;
    if ('parent_name' in d || 'parent_phone' in d) await setFlags(su, { parent_name: clean(d.parent_name, 100), parent_phone: clean(d.parent_phone, 20) });
    if (d.parent_consent !== undefined || d.parent_name) {
      st.set('family.parent_consent', !!d.parent_consent);
      if (d.parent_name) { st.set('family.father_name', clean(d.parent_name, 100)); st.set('family.father_phone', clean(d.parent_phone, 20)); }
    }
  }
  if (section === 'passport') {
    await setFlags(su, { has_passport: d.has_passport });
    const pp = d.has_passport ? d.passport || null : null;
    if (pp) {
      const ex = await Student.findOne({ passport_hash: hmac(pp), _id: { $ne: st._id }, is_deleted: false }).select('student_code').lean();
      if (ex) {
        await notifyAdmins('duplicate', `Passport number entered for ${fullName(st)} (${st.student_code}) is already registered on ${ex.student_code}`, `/students/${st._id}`);
        throw bad(byType === 'student' ? 'This passport number is already registered. Please contact your counsellor.' : `This passport number is already registered on ${ex.student_code}.`, { errors: { passport: 'Already registered' } });
      }
    }
    st.set({ passport_enc: pp ? encrypt(pp) : undefined, passport_hash: pp ? hmac(pp) : undefined, passport_last4: pp ? pp.slice(-4) : undefined,
      passport_issue: d.has_passport ? d.passport_issue || undefined : undefined, passport_expiry: d.has_passport ? d.passport_expiry || undefined : undefined,
      passport_place: d.has_passport ? clean(d.passport_place, 80) : undefined });
  }
  if (section === 'academic') {
    await setFlags(su, { has_bachelor: d.has_bachelor, has_master: d.has_master, ...('last_education' in d ? { last_education: LAST_EDU.includes(d.last_education) ? d.last_education : null } : {}) });
    const order: Record<string, number> = { '10th': 1, '12th': 2, Diploma: 2, Bachelor: 3, Master: 4, PhD: 5, Other: 6 };
    st.set('academics', ((d.records ?? []) as Any[]).filter((a) => d.has_bachelor !== false || !['Bachelor', 'Master'].includes(a.level)).filter((a) => d.has_master !== false || a.level !== 'Master')
      .map((a, i) => ({ level: a.level, qualification_type: a.level === 'Diploma' ? 'Diploma' : a.level === '12th' ? '12th' : undefined, course_name: clean(a.course_name, 150),
        board_university: clean(a.board_university, 150), institution: clean(a.institution, 150), score: num(a.score), score_type: ['%', 'CGPA10', 'CGPA4', 'CGPA'].includes(a.score_type) ? a.score_type : undefined,
        start_year: num(a.start_year), pass_year: num(a.pass_year), currently_studying: !!a.currently_studying, duration: num(a.duration), backlogs_total: num(a.backlogs_total),
        backlogs_active: num(a.backlogs_active), stream: a.stream || undefined, english_marks: num(a.english_marks), sort: (order[a.level] || 9) * 10 + i })));
  }
  if (section === 'work') {
    await setFlags(su, { has_work: d.has_work });
    st.set('work', d.has_work ? ((d.rows ?? []) as Any[]).map((w) => ({ company: clean(w.company, 150), designation: clean(w.designation, 100), from_month: w.from_month,
      to_month: w.till_date ? undefined : w.to_month, till_date: !!w.till_date })) : []);
  }
  if (section === 'english' && 'tests' in d) // the aptitude list can be saved on its own
    st.set('tests', ((d.tests ?? []) as Any[]).map((t) => ({ test_type: t.test_type, overall: num(t.overall), listening: num(t.listening), reading: num(t.reading), writing: num(t.writing),
      speaking: num(t.speaking), test_date: t.test_date || undefined, planned_date: t.test_type === 'Not taken yet' ? t.planned_date : undefined, reference_no: clean(t.reference_no, 50) })));
  if (section === 'english' && 'aptitude' in d)
    st.set('aptitude', ((d.aptitude ?? []) as Any[]).slice(0, 10).map((t) => {
      const parts: Record<string, number> = {};
      for (const [pk] of (APT[t.test_type] ?? [0, 0, 0, []])[3]) { const v = num(t[pk]); if (v !== undefined) parts[pk] = v; }
      return { test_type: t.test_type, other_name: clean(t.other_name, 80), total: t.test_type === 'Not taken yet' ? null : num(t.total), parts,
        test_date: t.test_type === 'Not taken yet' ? null : t.test_date || null, planned_date: t.test_type === 'Not taken yet' ? t.planned_date : null, reference_no: clean(t.reference_no, 50) };
    }));
  if (section === 'preferences') {
    if ('country_ids' in d) st.set('prefs.country_ids', ((d.country_ids ?? []) as unknown[]).filter((x) => x && Types.ObjectId.isValid(String(x))).slice(0, 3));
    if ('course' in d) st.set('prefs.course', clean(d.course, 150));
    if ('level' in d) st.set('prefs.level', d.level || undefined);
    if ('intake_id' in d) st.set('prefs.intake_id', d.intake_id && Types.ObjectId.isValid(String(d.intake_id)) ? d.intake_id : undefined);
    if ('languages' in d) st.set('prefs.languages', ((d.languages ?? []) as Any[]).filter((l) => l?.name).slice(0, 8));
    if ('budget_range_label' in d) { st.set('prefs.budget_range_label', d.budget_range_label || undefined); st.set('prefs.budget_tuition_eur', d.budget_range_label ? BUDGETS[d.budget_range_label] : null); }
  }
  if (opts.userId) st.set('updated_by', opts.userId);
  await st.save();
  const what = `${section} (${changed.map((k) => LABELS[k] || k.replace(/_/g, ' ')).join(', ')})`;
  if (opts.by) { await timeline({ student_id: st._id, type: 'profile', description: `Student information changed by ${opts.by}: ${what}`, user_id: opts.userId }); return; }
  await studentTimeline(st._id, null, 'profile', `Changed by student on portal: ${what}`);
  await portalAudit(req, 'Update', 'Student', st._id, `${st.student_code} ${section} (portal)`, null, { fields: changed });
}

// ---------- submit (3.8) ----------
const SUBMIT_SECTIONS: [Section, number, string][] = [['personal', 1, 'Personal details'], ['academic', 3, 'Education'], ['preferences', 6, 'Study plan']];
/** What still blocks the submit, in the student's words: section title + field + problem. */
export async function submitProblems(c: Ctx, p?: Awaited<ReturnType<typeof readAll>>) {
  const all = p ?? (await readAll(c));
  const out: { section: string; step: number; title: string; key: string; text: string }[] = [];
  for (const [section, step, title] of SUBMIT_SECTIONS) {
    for (const [key, msg] of Object.entries(await validate(section, all[section], true, c))) {
      const m = /^(\d+)\.([a-z_]+)$/.exec(key);
      let text = msg;
      if (section === 'academic' && m) { const r = all.academic.records[Number(m[1])] ?? {}; text = `${r.level === '12th' || r.level === 'Diploma' ? '12th / Diploma' : r.level || `Qualification ${Number(m[1]) + 1}`}: ${msg}`; }
      out.push({ section, step, title, key, text });
    }
  }
  return out;
}
export async function submit(req: Request, c: Ctx) {
  if (c.readOnly) throw bad('Your file is currently inactive.');
  if (!req.body?.declaration) throw bad('Please tick the declaration', { errors: { declaration: 'Required' } });
  if (!c.su.emailVerifiedAt) throw bad('Please verify your email first.', { code: 'email_unverified' });
  const problems = await submitProblems(c);
  if (problems.length) throw bad(`Please complete these before sending: ${problems.map((x) => `${x.title}: ${x.text}`).join('; ')}`, { steps: [...new Set(problems.map((x) => x.step))], problems });
  if (c.su.profileSubmittedAt) return { already: true };
  const t = new Date();
  await PortalAccount.updateOne({ _id: c.su._id }, { profileSubmittedAt: t });
  const name = displayName(c);
  const dueDay = addDays(istDate(), new Date(Date.now() + 864e5).getDay() === 0 ? 2 : 1);
  const due = new Date(`${dueDay}T18:00:00+05:30`);
  if (c.student) {
    await Student.updateOne({ _id: c.student._id }, { profile_submitted_at: t });
    await studentTimeline(c.student._id, null, 'profile', 'Student submitted the portal profile wizard');
    if (c.counsellorId) await createTask({ title: `Review portal profile of ${name}`, type: 'Internal task', student_id: c.student._id, assigned_to: c.counsellorId, due_at: due, priority: 'Medium',
      is_system: true, system_key: `profile-review:${c.su._id}` }, String(c.counsellorId));
  } else if (c.lead) {
    if (['New', 'Contacted'].includes(c.lead.status)) {
      await Lead.updateOne({ _id: c.lead._id }, { status: 'Interested' });
      await studentTimeline(null, c.lead._id, 'stage', `Status: ${c.lead.status} to Interested (portal profile submitted)`);
    }
    await studentTimeline(null, c.lead._id, 'lead', 'Student submitted the portal profile wizard');
    if (c.counsellorId) await createTask({ title: `Review portal profile and convert ${name} to student`, type: 'Internal task', lead_id: c.lead._id, assigned_to: c.counsellorId, due_at: due,
      priority: 'High', is_system: true, system_key: `profile-review:${c.su._id}` }, String(c.counsellorId));
  }
  await notifyStaff(c, 'portal', `${name} submitted the portal profile`);
  await portalAudit(req, 'Update', 'StudentUser', c.su._id, 'Wizard submitted');
  const cname = c.counsellorId ? (await User.findById(c.counsellorId).select('name').lean())?.name : 'your counsellor';
  return { message: `Thank you! Your profile has been sent to your counsellor ${cname}. They will review it and contact you soon.` };
}

/** Conversion: the lead's drafts are written into the new student file (invalid draft data is left for the counsellor). */
export async function copyDraftsToStudent(su: IPortalAccount, studentId: Types.ObjectId) {
  const s = await Student.findById(studentId);
  if (!s) return;
  const c: Ctx = { su, student: s, lead: null, counsellorId: (s.primary_counsellor_id ?? null) as Types.ObjectId | null, readOnly: false };
  const fakeReq = { ip: undefined, headers: {}, su } as unknown as Request;
  for (const section of SECTIONS) {
    const d = await draft(su, section);
    if (!d) continue;
    try { await writeStudent(fakeReq, c, section, d, await readSection(c, section)); } catch { /* the counsellor fills what was invalid */ }
    await ProfileDraft.updateOne({ student_user_id: su._id, section }, { copied_to_student_at: new Date() });
  }
  if (su.profileSubmittedAt) await Student.updateOne({ _id: studentId }, { profile_submitted_at: su.profileSubmittedAt });
  const ex = await draft(su, 'extra');
  if (ex) await Student.updateOne({ _id: studentId }, { info_extra: ex });
}

// ---------- change requests (3.10) ----------
const ROW = /^[0-9a-f]{24}$/;
const rowsFor = (st: IStudent, sec: string) => (sec === 'academic' ? st.academics : sec === 'work' ? st.work : st.tests) as unknown as { _id: Types.ObjectId; toObject(): Any }[];
async function currentValue(c: Ctx, key: string) {
  const [sec, a, b] = key.split('.');
  if (sec === 'contact') return c.student!.email;
  if (['academic', 'work', 'english'].includes(sec) && a !== 'new') {
    const r = rowsFor(c.student!, sec).find((x) => String(x._id) === a);
    if (!r) throw bad('Invalid field');
    return sec === 'academic' ? r.toObject()[b] : r.toObject();
  }
  if (a === 'new') return null;
  return (await readSection(c, sec as Section))[a];
}
function labelFor(c: Ctx, key: string) {
  const [sec, a, b] = key.split('.');
  if (sec === 'contact') return 'Email address';
  if (a === 'new') return ({ academic: 'New qualification', work: 'New work experience', english: 'New English test' } as Record<string, string>)[sec];
  if (sec === 'academic') { const r = c.student?.academics.find((x) => String(x._id) === a); return `${r?.level ?? ''} ${LABELS[b] || b}`.trim(); }
  if (sec === 'work') return 'Work experience row';
  if (sec === 'english') return 'English test';
  return LABELS[a] || a;
}
export async function createChangeRequest(req: Request, c: Ctx, b: { field_key?: string; new_value?: unknown; reason?: string; document_id?: unknown }) {
  if (!c.student) throw bad('Change requests are available after your registration with La Europa.');
  const key = String(b.field_key ?? '');
  if (!/^(personal|passport|preferences)\.[a-z_]+$|^(academic|work|english)\.(new|[0-9a-f]{24})(\.[a-z_]+)?$|^contact\.email$/.test(key)) throw bad('Invalid field');
  const reason = clean(b.reason, 500);
  if (!reason) throw bad('Reason is required', { errors: { reason: 'Required' } });
  if (String(b.reason).length > 500) throw bad('Reason: max 500 characters', { errors: { reason: 'Max 500 characters' } });
  const [sec, a, f] = key.split('.');
  if (LOCKED[sec] && !LOCKED[sec].includes(a)) throw bad('This field can be edited directly, no request needed.');
  if (sec === 'academic' && a !== 'new' && !['score', 'score_type', 'pass_year', 'board_university', 'institution', 'course_name', 'backlogs_total', 'backlogs_active', 'stream', 'start_year'].includes(f)) throw bad('Invalid field');
  // a row id must be one of THIS student's own rows
  if (['academic', 'work', 'english'].includes(sec) && a !== 'new' && (!ROW.test(a) || !rowsFor(c.student, sec).some((x) => String(x._id) === a))) throw bad('Invalid field');
  const nv = b.new_value as Any;
  if (['personal', 'passport', 'preferences'].includes(sec)) {
    const errs = await validate(sec, { ...(await readSection(c, sec as Section)), [a]: nv }, false, c);
    if (errs[a]) throw bad(errs[a], { errors: { new_value: errs[a] } });
  }
  if (sec === 'academic' && a !== 'new') {
    const r = c.student.academics.find((x) => String(x._id) === a) as unknown as { toObject(): Any };
    const m = Object.entries(await validate('academic', { records: [{ ...r.toObject(), [f]: nv }] }, false, c)).find(([k]) => k.endsWith('.' + f));
    if (m) throw bad(m[1], { errors: { new_value: m[1] } });
  }
  if (sec === 'work' || sec === 'english') {
    const errs = await validate(sec, sec === 'work' ? { has_work: true, rows: [nv] } : { tests: [nv] }, true, c);
    if (Object.keys(errs).length) throw bad(Object.values(errs)[0], { errors: { new_value: Object.values(errs)[0] } });
  }
  if (sec === 'english' && a === 'new' && !b.document_id) throw bad('Please attach the score card for a new English test', { errors: { file: 'Score card is required' } });
  if (sec === 'academic' && a === 'new') { const errs = await validate('academic', { records: [nv] }, false, c); if (Object.keys(errs).length) throw bad(Object.values(errs)[0]); }
  if (await ProfileChangeRequest.exists({ student_id: c.student._id, field_key: key, status: 'Pending', is_deleted: false })) throw bad('There is already a pending request for this field.');
  const label = labelFor(c, key);
  const cr = await ProfileChangeRequest.create({ student_id: c.student._id, student_user_id: c.su._id, entity: sec, entity_id: a !== 'new' && ROW.test(a) ? a : undefined, field_key: key,
    field_label: label, old_value: (await currentValue(c, key)) ?? null, new_value: nv ?? null, reason, document_id: b.document_id ?? undefined, status: 'Pending', created_by: c.su._id, created_by_type: 'student' });
  await notifyStaff(c, 'portal', `${displayName(c)} requested a profile change: ${label}`, `/students/${c.student._id}/changes`);
  await studentTimeline(c.student._id, null, 'profile', `Student requested a change: ${label}`);
  await portalAudit(req, 'Create', 'ProfileChangeRequest', cr._id, label);
  return String(cr._id);
}
