import type { Request } from 'express';
import Student from '../models/Student';
import { LEVELS } from '../models/Lead';
import { Country, Intake } from '../models/Master';
import { bad, clean, timeline } from './crm';
import { type Ctx } from './portalCtx';
import { LAST_EDU, EDU_RANK, APT, APT_TYPES, BUDGETS, readAll, readSection, validate, writeStudent, saveSection, locks, submitProblems, draft, saveDraft } from './profile';

/** ONE student information form (legacy/server/infoform.js): the same sections and rules in the portal ("My information") and the CRM ("Student information").
 *  The definition is served by the server and drawn by one front-end component. */

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// fields of study for the scroll list in the Study plan (saved as "A, B, C" in preferences.course)
const FIELDS = ['Business & Management', 'MBA', 'Finance & Accounting', 'Banking & Insurance', 'Marketing', 'Human Resources', 'International Business', 'Economics', 'Supply Chain & Logistics',
  'Project Management', 'Data Science & Analytics', 'Business Analytics', 'Computer Science', 'Information Technology', 'Artificial Intelligence & Machine Learning', 'Cyber Security',
  'Software Engineering', 'Cloud Computing', 'Mechanical Engineering', 'Civil Engineering', 'Electrical & Electronics Engineering', 'Computer Engineering', 'Chemical Engineering',
  'Aerospace Engineering', 'Automotive Engineering', 'Robotics & Automation', 'Industrial Engineering', 'Energy & Renewable Engineering', 'Architecture', 'Interior Design',
  'Design (Graphic / Product / UX)', 'Fashion Design', 'Media / Film / Communication', 'Journalism', 'Hospitality & Hotel Management', 'Tourism & Event Management', 'Culinary Arts',
  'Medicine (MBBS / MD)', 'Dentistry', 'Nursing', 'Pharmacy', 'Public Health', 'Physiotherapy', 'Biotechnology', 'Life Sciences & Biology', 'Chemistry', 'Physics', 'Mathematics & Statistics',
  'Environmental Science', 'Agriculture & Food Science', 'Psychology', 'Law', 'International Relations & Political Science', 'Arts & Humanities', 'Languages & Linguistics',
  'Education & Teaching', 'Social Work', 'Sports Management & Science', 'Aviation & Pilot Training', 'Music & Performing Arts'];
const EDU_LABEL: Record<string, string> = { '10th': '10th (Secondary)', '12th': '12th (Higher Secondary)', Diploma: 'Diploma (after 10th)', Bachelor: 'Bachelor degree', Master: "Master's degree", PhD: 'PhD' };
const APT_TAKEN = Object.keys(APT);

// store: where the field lives. personal / passport / academic / work / english / preferences = the student file (same as the portal wizard); extra = Student.info_extra
export const FORM: Any[] = [
  { key: 'personal', title: 'Personal details', store: 'personal', fields: [
    { k: 'first_name', label: 'First name (as in passport)', req: true }, { k: 'middle_name', label: 'Middle name' }, { k: 'last_name', label: 'Last name (as in passport)', req: true, unless: 'no_surname' },
    { k: 'no_surname', label: 'I have no surname', type: 'check' }, { k: 'gender', label: 'Gender', type: 'select', opts: ['Male', 'Female', 'Other'], req: true }, { k: 'dob', label: 'Date of birth', type: 'date', req: true },
    { k: 'nationality', label: 'Nationality', req: true }, { k: 'marital_status', label: 'Marital status', type: 'select', opts: ['Single', 'Married', 'Divorced', 'Widowed'], req: true },
    { k: 'spouse_travel', label: 'Will your spouse travel with you?', type: 'yesno', show: { marital_status: 'Married' } }] },
  { key: 'passport', title: 'Passport', store: 'passport', fields: [
    { k: 'has_passport', label: 'Do you have a passport?', type: 'yesno', req: true }, { k: 'passport', label: 'Passport number', req: true, show: { has_passport: true } },
    { k: 'passport_issue', label: 'Issue date', type: 'date', req: true, show: { has_passport: true } }, { k: 'passport_expiry', label: 'Expiry date', type: 'date', req: true, show: { has_passport: true } },
    { k: 'passport_place', label: 'Place of issue', show: { has_passport: true } }] },
  { key: 'contact', title: 'Contact and address', store: 'personal', fields: [
    { k: 'whatsapp', label: 'WhatsApp number' }, { k: 'address1', label: 'Address line 1', req: true }, { k: 'address2', label: 'Address line 2' },
    { k: 'city', label: 'City', req: true }, { k: 'state', label: 'State', req: true }, { k: 'pin', label: 'PIN code' }] },
  { key: 'family', title: 'Family and emergency contact', store: 'mixed', fields: [
    { k: 'parent_name', label: 'Father / guardian name', store: 'personal', req: true }, { k: 'parent_phone', label: 'Father / guardian phone', store: 'personal' },
    { k: 'mother_name', label: 'Mother name', store: 'extra' }, { k: 'mother_phone', label: 'Mother phone', store: 'extra' },
    { k: 'parent_consent', label: 'I am under 18 and my parent / guardian has agreed', type: 'check', store: 'personal' },
    { k: 'emergency_name', label: 'Emergency contact name', store: 'personal', req: true }, { k: 'emergency_relation', label: 'Relation', store: 'extra' },
    { k: 'emergency_phone', label: 'Emergency contact phone', store: 'personal', req: true }] },
  { key: 'academic', title: 'Education', store: 'academic', list: 'records', listLabel: 'Qualification', minRows: 1, auto: 'education',
    head: [{ k: 'last_education', label: 'Your last (highest) education', type: 'select', opts: LAST_EDU.map((l) => [l, EDU_LABEL[l]]), req: true,
      help: 'Only the levels up to this one are asked below. For example 12th asks only 10th and 12th.' }], fields: [
    { k: 'level', label: 'Level', type: 'select', opts: ['10th', '12th', 'Diploma', 'Bachelor', 'Master', 'PhD', 'Other'], req: true },
    { k: 'board_university', label: 'Board / university', reqIf: { level: ['12th', 'Diploma'] } }, { k: 'institution', label: 'School / college' },
    { k: 'course_name', label: 'Course / stream', reqIf: { level: ['Bachelor', 'Master', 'PhD', 'Other'] } }, { k: 'score', label: 'Score', type: 'number', req: true },
    { k: 'score_type', label: 'Score unit', type: 'select', opts: [['%', 'Percentage'], ['CGPA10', 'CGPA out of 10'], ['CGPA4', 'CGPA out of 4']], req: true },
    { k: 'pass_year', label: 'Year of passing', type: 'number', req: true }, { k: 'backlogs_total', label: 'Backlogs (total, 0 if none)', type: 'number', reqIf: { level: ['Bachelor', 'Master', 'PhD', 'Other'] } },
    { k: 'backlogs_active', label: 'Active backlogs', type: 'number' }] },
  { key: 'english', title: 'English test', store: 'english', list: 'tests', listLabel: 'Test', minRows: 0, fields: [
    { k: 'test_type', label: 'Test', type: 'select', opts: ['IELTS Academic', 'IELTS General', 'TOEFL iBT', 'PTE Academic', 'Duolingo', 'Not taken yet', 'MOI (waiver)'], req: true },
    { k: 'overall', label: 'Overall', type: 'number' }, { k: 'listening', label: 'Listening', type: 'number' }, { k: 'reading', label: 'Reading', type: 'number' }, { k: 'writing', label: 'Writing', type: 'number' },
    { k: 'speaking', label: 'Speaking', type: 'number' }, { k: 'test_date', label: 'Test date', type: 'date' }, { k: 'planned_date', label: 'Planned test date (if not taken yet)', type: 'date' },
    { k: 'reference_no', label: 'TRF / reference number' }] },
  { key: 'aptitude', title: 'Aptitude / admission test (optional)', store: 'english', list: 'aptitude', listLabel: 'Aptitude test', minRows: 0,
    intro: 'SAT, ACT, GRE, GMAT, and for Italy IMAT (Medicine), TOLC / CENT-S (CISIA) or TIL / ARCHED (Architecture). Add it if you have taken one or plan to.', fields: [
    { k: 'test_type', label: 'Test', type: 'select', opts: APT_TYPES, req: true },
    { k: 'other_name', label: 'Test name (or which test you plan)', req: true, show: { test_type: ['Other test', 'Not taken yet'] } },
    { k: 'total', label: 'Total score', type: 'number', req: true, show: { test_type: APT_TAKEN },
      hintBy: { k: 'test_type', map: Object.fromEntries(Object.entries(APT).filter(([, a]) => a[0] > -1000).map(([n, a]) => [n, `${a[0]} to ${a[1]}`])) } },
    { k: 'rw', label: 'Reading and Writing (200 to 800)', type: 'number', show: { test_type: ['SAT'] } }, { k: 'math', label: 'Math (200 to 800)', type: 'number', show: { test_type: ['SAT'] } },
    { k: 'verbal', label: 'Verbal', type: 'number', show: { test_type: ['GRE General', 'GMAT Focus Edition'] }, hintBy: { k: 'test_type', map: { 'GRE General': '130 to 170', 'GMAT Focus Edition': '60 to 90' } } },
    { k: 'quant', label: 'Quantitative', type: 'number', show: { test_type: ['GRE General', 'GMAT Focus Edition'] }, hintBy: { k: 'test_type', map: { 'GRE General': '130 to 170', 'GMAT Focus Edition': '60 to 90' } } },
    { k: 'awa', label: 'Analytical Writing (0 to 6)', type: 'number', show: { test_type: ['GRE General'] } }, { k: 'di', label: 'Data Insights (60 to 90)', type: 'number', show: { test_type: ['GMAT Focus Edition'] } },
    { k: 'test_date', label: 'Test date', type: 'date', show: { test_type: APT_TAKEN } }, { k: 'planned_date', label: 'Planned test date', type: 'date', req: true, show: { test_type: ['Not taken yet'] } },
    { k: 'reference_no', label: 'Registration / reference number', show: { test_type: APT_TAKEN } }] },
  { key: 'work', title: 'Work experience', store: 'work', list: 'rows', listLabel: 'Job', minRows: 0, toggle: { k: 'has_work', label: 'Do you have work experience?' }, fields: [
    { k: 'company', label: 'Company', req: true }, { k: 'designation', label: 'Designation', req: true }, { k: 'from_month', label: 'From', type: 'month', req: true }, { k: 'to_month', label: 'To', type: 'month' },
    { k: 'till_date', label: 'I still work here', type: 'check' }] },
  { key: 'preferences', title: 'Study plan', store: 'preferences', fields: [
    { k: 'country_ids', label: 'Preferred countries (scroll and tick up to 3, in order of preference)', type: 'countries', req: true },
    { k: 'course', label: 'Preferred field of study (scroll and tick up to 3)', type: 'picklist', opts: FIELDS, max: 3, other: 'Other field (if not in the list)', req: true },
    { k: 'level', label: 'Preferred level', type: 'select', opts: LEVELS, req: true }, { k: 'intake_id', label: 'Preferred intake', type: 'intake', req: true },
    { k: 'budget_range_label', label: 'Tuition budget per year', type: 'select', opts: Object.keys(BUDGETS), private: true }] },
  { key: 'background', title: 'Background (needed for offers and the visa)', store: 'extra', fields: [
    { k: 'visa_refused', label: 'Have you ever been refused a visa for any country?', type: 'yesno', req: true },
    { k: 'refusal_details', label: 'Refusal details (country, year, reason)', type: 'textarea', show: { visa_refused: 'yes' }, req: true },
    { k: 'travelled_abroad', label: 'Have you travelled abroad before?', type: 'yesno' }, { k: 'travel_history', label: 'Countries visited (country, year, purpose)', type: 'textarea', show: { travelled_abroad: 'yes' } },
    { k: 'study_gap', label: 'Gap in studies or work (explain any gap of more than 6 months)', type: 'textarea' },
    { k: 'funding_source', label: 'Who will pay your fees and living costs?', type: 'select', opts: ['Self', 'Parents', 'Other sponsor', 'Education loan', 'Scholarship'], req: true },
    { k: 'sponsor_name', label: 'Sponsor name and relation', show: { funding_source: ['Parents', 'Other sponsor'] } },
    { k: 'criminal_record', label: 'Have you ever been convicted of a criminal offence?', type: 'yesno', req: true },
    { k: 'health_condition', label: 'Any medical condition the university should know about?', type: 'yesno' },
    { k: 'health_details', label: 'Medical details', type: 'textarea', show: { health_condition: 'yes' } }] },
];
export const PRIVATE_FROM_UNI = ['budget_range_label', 'whatsapp', 'address1', 'address2', 'pin', 'parent_phone', 'mother_phone', 'emergency_phone', 'funding_source', 'sponsor_name'];
const EXTRA_KEYS = FORM.flatMap((s) => s.fields.filter((f: Any) => (f.store || s.store) === 'extra').map((f: Any) => f.k as string));

export const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '' && !(Array.isArray(v) && !v.length);
export const shown = (f: Any, d: Any) => !f.show || Object.entries(f.show).every(([k, v]) => (Array.isArray(v) ? v.includes(d[k]) : v === true ? d[k] === 'yes' || d[k] === true : d[k] === v));
const probSection = (p: { section: string; key: string }) => (p.section === 'personal' && /^parent_/.test(p.key) ? 'family' : p.section);
const yn = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : v ?? null);

async function extraOf(c: Ctx) { return (c.student ? (c.student.info_extra as Any | undefined) : await draft(c.su, 'extra')) ?? {}; }
export async function read(c: Ctx) {
  const w = await readAll(c);
  const ex = await extraOf(c);
  const p = w.personal ?? {};
  return {
    personal: { ...p, spouse_travel: yn(p.spouse_travel) }, passport: { ...w.passport, has_passport: yn(w.passport.has_passport) },
    contact: { whatsapp: p.whatsapp, address1: p.address1, address2: p.address2, city: p.city, state: p.state, pin: p.pin },
    family: { parent_name: p.parent_name, parent_phone: p.parent_phone, parent_consent: !!p.parent_consent, emergency_name: p.emergency_name, emergency_phone: p.emergency_phone,
      mother_name: ex.mother_name, mother_phone: ex.mother_phone, emergency_relation: ex.emergency_relation },
    academic: { last_education: w.academic.last_education ?? null, records: w.academic.records ?? [] }, english: { tests: w.english.tests ?? [] }, aptitude: { aptitude: w.english.aptitude ?? [] },
    work: { has_work: yn(w.work.has_work), rows: w.work.rows ?? [] }, preferences: w.preferences ?? {},
    background: Object.fromEntries(FORM.find((s) => s.key === 'background')!.fields.map((f: Any) => [f.k, ex[f.k] ?? null])),
  } as Any;
}
export function completion(data: Any, problems: { section: string }[] = []) {
  const out: Record<string, boolean> = {};
  let done = 0;
  for (const s of FORM) {
    const d = data[s.key] ?? {};
    let ok: boolean;
    if (s.list) {
      const rows: Any[] = d[s.list] ?? [];
      ok = s.toggle ? d[s.toggle.k] === 'no' || (d[s.toggle.k] === 'yes' && rows.length > 0) : rows.length >= (s.minRows || 0);
      if (s.key === 'academic') {
        const rank = EDU_RANK[d.last_education] || 0;
        const lv = (l: string) => rows.some((r) => r.level === l);
        ok = rank > 0 && rows.length > 0 && rows.every((r) => has(r.level) && has(r.score) && has(r.score_type) && has(r.pass_year)) && lv('10th')
          && (rank < 2 || lv('12th') || lv('Diploma')) && (rank < 3 || lv('Bachelor')) && (rank < 4 || lv('Master')) && (rank < 5 || lv('PhD'));
      }
      if (s.key === 'english') ok = rows.length > 0;
      if (s.key === 'aptitude') ok = rows.every((r) => has(r.test_type) && (r.test_type === 'Not taken yet' ? has(r.planned_date) && has(r.other_name) : has(r.total)));
    } else ok = s.fields.filter((f: Any) => f.req && shown(f, d) && !(f.unless && d[f.unless])).every((f: Any) => has(d[f.k]));
    // never "Complete" while the submit would still refuse it
    if (problems.some((p) => p.section === s.key)) ok = false;
    out[s.key] = ok;
    if (ok) done++;
  }
  return { sections: out, percent: Math.round(done / FORM.length * 100) };
}

/** Save one section. by.type = student (portal rules: locks and change requests) or staff (direct, same validation). */
export async function save(c: Ctx, key: string, body: Any, by: { type: 'student' | 'staff'; name: string; userId?: string; req: Request }) {
  const s = FORM.find((x) => x.key === key);
  if (!s) throw bad('Unknown section');
  const d = body ?? {};
  const ynB = (v: unknown) => (v === 'yes' ? true : v === 'no' ? false : v === true || v === false ? v : null);
  const wiz: Record<string, Any> = {}, extra: Any = {};
  if (s.list) {
    const rows = ((Array.isArray(d[s.list]) ? d[s.list] : []) as Any[]).slice(0, 15)
      .map((r) => Object.fromEntries(s.fields.map((f: Any) => [f.k, f.type === 'check' ? !!r[f.k] : r[f.k] === '' ? null : r[f.k]]).concat(r.id ? [['id', r.id]] : [])));
    if (s.key === 'academic') {
      const last = LAST_EDU.includes(d.last_education) ? d.last_education : null;
      const rank = EDU_RANK[last ?? ''] || 0;
      // only the levels up to the last education are kept; "Other" rows stay
      const keep = rows.filter((r) => !last || r.level === 'Other' || !r.level || (EDU_RANK[r.level] || 0) <= rank);
      wiz.academic = { last_education: last, records: keep, has_bachelor: last ? rank >= 3 : rows.some((r) => r.level === 'Bachelor') || null, has_master: last ? rank >= 4 : rows.some((r) => r.level === 'Master') || null };
    }
    if (s.key === 'english') wiz.english = { tests: rows };
    if (s.key === 'aptitude') wiz.english = { aptitude: rows };
    if (s.key === 'work') wiz.work = { has_work: ynB(d.has_work), rows: ynB(d.has_work) ? rows : [] };
  } else {
    for (const f of s.fields) {
      if (!(f.k in d)) continue;
      const st = f.store || s.store;
      const v = f.type === 'yesno' ? (st === 'extra' ? d[f.k] : ynB(d[f.k])) : f.type === 'check' ? !!d[f.k] : d[f.k];
      if (st === 'extra') extra[f.k] = v; else (wiz[st] ??= {})[f.k] = v;
    }
  }
  for (const [sec, data] of Object.entries(wiz)) {
    if (by.type === 'student') { await saveSection(by.req, c, sec, data, false); continue; }
    if (sec === 'passport' && data.passport) data.passport = String(data.passport).toUpperCase().replace(/\s/g, '');
    const errors = await validate(sec, data, false, c);
    if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
    await writeStudent(by.req, c, sec as never, data, await readSection(c, sec as never), { by: by.name, userId: by.userId });
    c.student = await Student.findById(c.student!._id);
  }
  if (Object.keys(extra).length) {
    if (extra.visa_refused === 'yes' && 'refusal_details' in extra && !has(extra.refusal_details)) throw bad('Please fix the highlighted fields', { errors: { refusal_details: 'Please give the refusal details' } });
    const cur = await extraOf(c);
    const next = { ...cur };
    for (const k of EXTRA_KEYS) if (k in extra) next[k] = typeof extra[k] === 'string' ? clean(extra[k], 2000) : extra[k];
    if (c.student) {
      await Student.updateOne({ _id: c.student._id }, { info_extra: next });
      if (by.type !== 'student') await timeline({ student_id: c.student._id, type: 'profile', description: `Student information changed by ${by.name}: ${s.title}`, user_id: by.userId });
    } else await saveDraft(c.su, 'extra', next);
  }
  return out(c, by.type);
}

export async function out(c: Ctx, viewer: 'student' | 'staff' | 'university') {
  if (c.student) c.student = await Student.findById(c.student._id);
  const data = await read(c);
  if (viewer === 'student' && c.su.profileSubmittedAt) delete data.preferences.budget_range_label;
  let problems: { section: string; key: string }[] = [];
  if (viewer !== 'university') { try { problems = (await submitProblems(c)).map((p) => ({ ...p, section: probSection(p) })); } catch { /* no problems listed */ } }
  const lk = viewer === 'student' ? await locks(c) : null;
  if (lk?.sections?.english) lk.sections.aptitude = true;
  return {
    form: FORM.map((s) => ({ ...s, fields: s.fields.filter((f: Any) => viewer !== 'university' || !PRIVATE_FROM_UNI.includes(f.k)) })), data, completion: completion(data, problems), problems,
    lists: { countries: (await Country.find({ active: true }).sort({ sort: 1, name: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
      intakes: (await Intake.find({ active: true }).sort({ year: 1, month: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })) },
    locked: lk, submitted: !!c.su.profileSubmittedAt || !!c.student?.profile_submitted_at,
    email: c.student ? c.student.email : c.su.email, phone: c.student ? `${c.student.country_code || ''} ${c.student.phone || ''}`.trim() : null,
  };
}
