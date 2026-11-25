import mongoose, { Types } from 'mongoose';
import Student, { type IStudent, type Academic, type Work } from '../models/Student';
import { Country, Intake } from '../models/Master';
import { stageList } from './masters';
import type { AuthRequest } from '../middleware/auth';
import { HttpError, fullName, oid, seesAll, decrypt, userNames, nameIn } from './crm';

/** Student helpers of the client's server (legacy/server/services.js, rbac.js loadStudent / studentScope). */

/** Admin / Manager see every student; a counsellor only the students assigned to them (one counsellor per student). */
export function studentScope(req: AuthRequest): Record<string, unknown> {
  if (seesAll(req)) return {};
  return { primary_counsellor_id: new mongoose.Types.ObjectId(req.user!.id) };
}
export const canSeeStudent = (req: AuthRequest, s: Pick<IStudent, 'primary_counsellor_id'>) =>
  seesAll(req) || String(s.primary_counsellor_id ?? '') === req.user!.id;

export async function loadStudent(req: AuthRequest, id: string) {
  const _id = oid(id);
  const s = _id && (await Student.findOne({ _id, is_deleted: false }));
  if (!s) throw new HttpError(404, 'Student not found');
  if (!canSeeStudent(req, s)) throw new HttpError(403, 'You do not have access to this record');
  return s;
}

export const passportOf = (s: Pick<IStudent, 'passport_enc'>) => decrypt(s.passport_enc);

const col = (name: string) => mongoose.connection.collection(name);
/** The student's furthest stage across applications and visa (legacy services.overallStage). */
export async function overallStage(studentId: Types.ObjectId) {
  const visa = await col('visacases').find({ student_id: studentId, is_deleted: { $ne: true } }).sort({ attempt_no: -1, createdAt: -1 }).limit(1).next();
  if (visa) { const v = (await stageList('visa_stage')).find((x) => x.code === visa.stage); return 'Visa: ' + (v?.name ?? visa.stage); }
  const st = await stageList('app_stage');
  const apps = await col('applications').find({ student_id: studentId, is_deleted: { $ne: true } }).project({ stage: 1 }).toArray();
  if (!apps.length) return 'Registered';
  const live = apps.filter((a) => !['rejected', 'withdrawn', 'offer_declined'].includes(a.stage));
  const name = (code: string) => st.find((x) => x.code === code)?.name ?? code;
  if (!live.length) return name(apps[0].stage);
  const best = live.map((a) => st.find((s) => s.code === a.stage)).filter(Boolean).sort((a, b) => b!.sort - a!.sort)[0];
  return best ? ({ conditional_offer: 'Offer', unconditional_offer: 'Offer' } as Record<string, string>)[best.code!] ?? best.name : 'Registered';
}

const score = (r: Academic) => (r.score === null || r.score === undefined ? '-' : !r.score_type || r.score_type === '%' ? `${r.score}%` : `${r.score} CGPA`);
export const mmyyyy = (ym?: string) => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${m}/${y}`; };

function workExperienceTotal(rows: Work[]) {
  const toM = (ym: string) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
  const t = new Date(); const nowM = t.getFullYear() * 12 + t.getMonth();
  const iv = rows.filter((r) => r.from_month).map((r) => [toM(r.from_month), r.till_date ? nowM : r.to_month ? toM(r.to_month) : toM(r.from_month)]).sort((a, b) => a[0] - b[0]);
  let total = 0; let cur: number[] | null = null;
  for (const [a, b] of iv) {
    if (!cur) { cur = [a, b]; continue; }
    if (a <= cur[1]) cur[1] = Math.max(cur[1], b); else { total += cur[1] - cur[0] + 1; cur = [a, b]; }
  }
  if (cur) total += cur[1] - cur[0] + 1;
  const y = Math.floor(total / 12), m = total % 12;
  return { months: total, label: total ? `${y ? `${y} year${y > 1 ? 's' : ''}` : ''}${y && m ? ' ' : ''}${m ? `${m} month${m > 1 ? 's' : ''}` : ''}` : '-' };
}
function gapYears(ac: Academic[], wx: Work[]) {
  const lastStudy = ac.filter((a) => a.pass_year && !a.currently_studying).map((a) => a.pass_year!).sort().pop();
  if (!lastStudy || ac.some((a) => a.currently_studying)) return null;
  const end = new Date(Date.UTC(lastStudy, 5, 30));
  const firstWork = wx.filter((w) => w.from_month).map((w) => w.from_month).sort()[0];
  const until = firstWork ? new Date(firstWork + '-01') : new Date();
  const months = Math.round((+until - +end) / (30.44 * 864e5));
  return months > 6 ? `${Math.floor(months / 12)} year(s) ${months % 12} month(s) gap after ${lastStudy}${firstWork ? ' before first job' : ' till today'}` : null;
}

/** One-line academic summary shown on the profile (legacy services.academicSummary). */
export async function academicSummary(s: IStudent) {
  const ac = [...s.academics].sort((a, b) => a.sort - b.sort || (a.pass_year ?? 0) - (b.pass_year ?? 0));
  const wx = [...s.work].sort((a, b) => a.from_month.localeCompare(b.from_month));
  const tests = s.tests.filter((t) => t.test_type !== 'Not taken yet').sort((a, b) => String(b.test_date ?? '').localeCompare(String(a.test_date ?? '')));
  const tenth = ac.find((a) => a.level === '10th'), twelfth = ac.find((a) => a.level === '12th' || a.level === 'Diploma');
  const bach = ac.find((a) => a.level === 'Bachelor'), master = ac.find((a) => a.level === 'Master');
  const parts: string[] = [];
  parts.push(`10th: ${tenth ? `${score(tenth)} (${tenth.pass_year || '-'})` : '-'}`);
  parts.push(`${twelfth?.level === 'Diploma' ? 'Diploma' : '12th'}: ${twelfth ? `${score(twelfth)}${twelfth.board_university ? ', ' + twelfth.board_university : ''} (${twelfth.pass_year || '-'})` : '-'}`);
  parts.push(`Bachelor: ${bach ? `${bach.course_name || ''}, ${score(bach)} (${bach.currently_studying ? 'expected ' : ''}${bach.pass_year || '-'})` : '-'}`);
  const backlogs = ac.filter((a) => ['Bachelor', 'Master', 'Other', 'PhD'].includes(a.level)).reduce((n, a) => n + (a.backlogs_total || 0), 0);
  parts.push(`Backlogs: ${bach || master ? backlogs : '-'}`);
  parts.push(`Master: ${master ? `${master.course_name || ''}, ${score(master)} (${master.pass_year || '-'})` : '-'}`);
  parts.push(`Work exp: ${wx.length ? wx.map((w) => `${mmyyyy(w.from_month)} to ${w.till_date ? 'till date' : mmyyyy(w.to_month)}`).join(', ') : '-'}`);
  const t = tests[0];
  const b = (x: unknown) => (x === null || x === undefined ? '' : x);
  parts.push(`${t ? t.test_type.replace(' Academic', '').replace(' General', ' GT').replace(' iBT', '') : 'English'}: ${t ? `${b(t.overall)}${t.listening !== null && t.listening !== undefined ? ` (L${b(t.listening)} R${b(t.reading)} W${b(t.writing)} S${b(t.speaking)})` : ''}` : '-'}`);
  const country = s.prefs?.country_ids?.[0] ? (await Country.findById(s.prefs.country_ids[0]).select('name').lean())?.name : null;
  parts.push(`Country: ${country || '-'}`);
  parts.push(`Course: ${s.prefs?.course || '-'}`);
  return { line: parts.join(' | '), budget: s.prefs?.budget_tuition_eur ? `Budget: €${s.prefs.budget_tuition_eur.toLocaleString('en-IE')}` : null, experience: workExperienceTotal(wx), gaps: gapYears(ac, wx) };
}

/** Profile warnings (legacy services.warnings). */
export async function warnings(s: IStudent) {
  const w: { level: string; text: string; icon?: string }[] = [];
  if (s.marital_status === 'Married') w.push({ level: 'orange', text: s.spouse_travel ? 'Married: spouse will travel, dependant visa check' : 'Married: dependant visa check' });
  const intake = s.prefs?.intake_id ? await Intake.findById(s.prefs.intake_id).lean() : null;
  const start = intake?.year ? new Date(Date.UTC(intake.year, (intake.month || 9) - 1, 1)) : null;
  if (s.passport_expiry) {
    const exp = new Date(s.passport_expiry);
    const m18 = new Date(); m18.setMonth(m18.getMonth() + 18);
    const lim = start ? new Date(start) : null; lim?.setMonth(lim.getMonth() + 12);
    if (exp < new Date()) w.push({ level: 'red', text: 'Passport has expired' });
    else if (lim && exp < lim) w.push({ level: 'red', text: 'Passport expires within 12 months of intake start' });
    else if (exp < m18) w.push({ level: 'orange', text: 'Passport expires in < 18 months' });
  }
  if (s.email_status === 'Bounced') w.push({ level: 'red', text: 'Email bounced: please correct the email address' });
  if (s.emails_paused) w.push({ level: 'grey', text: 'Student emails paused' });
  const failed = await col('emaillogs').countDocuments({ student_id: s._id, status: { $in: ['Failed', 'Bounced'] } });
  if (failed) w.push({ level: 'red', text: `${failed} email(s) failed`, icon: 'mail' });
  if (start) for (const t of s.tests) if (t.test_date) { const l = new Date(t.test_date); l.setFullYear(l.getFullYear() + 2); if (l < start) w.push({ level: 'orange', text: `${t.test_type} result older than 2 years at intake` }); }
  return w;
}

export async function header(s: IStudent) {
  const [names, countries, intake] = await Promise.all([
    userNames(),
    Country.find({ _id: { $in: s.prefs?.country_ids ?? [] } }).select('name code').lean(),
    s.prefs?.intake_id ? Intake.findById(s.prefs.intake_id).select('name').lean() : null,
  ]);
  const counsellor = nameIn(names, s.primary_counsellor_id);
  return {
    stage: await overallStage(s._id as Types.ObjectId), counsellor, application_user: counsellor, visa_user: counsellor,
    countries: (s.prefs?.country_ids ?? []).map((id) => countries.find((c) => String(c._id) === String(id))).filter(Boolean).map((c) => ({ id: String(c!._id), name: c!.name, code: c!.code })),
    intake: intake?.name ?? null, warnings: await warnings(s),
  };
}

export { fullName };
