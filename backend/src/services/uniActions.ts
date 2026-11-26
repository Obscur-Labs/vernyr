import { Types } from 'mongoose';
import Student from '../models/Student';
import User from '../models/User';
import University from '../models/University';
import { getSetting } from '../models/Audit';
import { nextCode } from '../models/Timeline';
import { Application, FeeSummary, StageHistory, StudentDocument } from '../models/Work';
import { OfferCondition } from '../models/Portal';
import { Commission, CommissionRule, OfferLetter, UniAction, UniversityApplication } from '../models/Partner';
import { HttpError, addDays, bad, clean, fieldErr, fullName, istDate, timeline } from './crm';
import { notify, systemTask } from './tasks';
import { trigger as studentEmail } from './email';
import { staffEmail } from './uemail';
import * as P from './partner';

/** University decisions into the La Europa CRM (legacy/server/university/actions.js). Review mode: the counsellor applies them; automatic mode: applied at once. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
export const DECISION_LABEL: Record<string, string> = { acknowledge: 'Acknowledged', interview: 'Interview scheduled', interview_result: 'Interview result recorded', conditional_offer: 'Conditional offer',
  unconditional_offer: 'Unconditional offer', conditions_met: 'Conditions met (unconditional offer)', reject: 'Rejected', waitlist: 'Waitlisted', deposit: 'Deposit received',
  enrolled: 'Enrolled', correction: 'Decision corrected', offer_letter: 'Offer letter uploaded', cas: 'Acceptance letter for visa uploaded', under_assessment: 'Under assessment', doc_request: 'Documents requested' };
/** actions that change the CRM stage (and email the student) when applied */
export const STAGE_ACTIONS = new Set(['acknowledge', 'interview', 'conditional_offer', 'unconditional_offer', 'conditions_met', 'reject', 'waitlist', 'deposit', 'enrolled', 'correction']);
const admins = async () => (await User.find({ role: 'admin', isActive: true }).select('_id').lean()).map((u: Any) => String(u._id));
async function ctxOf(ua: Any) {
  const a = (await Application.findById(ua.application_id).lean()) as Any;
  const s = (await Student.findById(a.student_id).lean()) as Any;
  const u = (await University.findById(ua.university_id).lean()) as Any;
  return { a, s, u };
}
export type Actor = { su?: { _id: unknown; name: string } | null; staff?: { id: string; name: string } | null };

/** record a university action; actor is the university user, or La Europa staff acting on the university's behalf */
export async function record(ua: Any, type: string, data: Any, actor: Actor, toStatus?: string | null, opts: { forceReview?: boolean } = {}) {
  const { a, s, u } = await ctxOf(ua);
  const forced = !!opts.forceReview || type === 'correction' || (type === 'reject' && (await getSetting('uni_always_review_rejections')) !== '0');
  const mode = forced ? 'review' : u.notify_mode === 'automatic' ? 'automatic' : 'review';
  const processing = STAGE_ACTIONS.has(type) ? (mode === 'automatic' ? 'Applied' : 'Pending review') : 'Info';
  const decided = toStatus && ['Conditional offer', 'Unconditional offer', 'Rejected'].includes(toStatus);
  const set: Any = { $inc: { version: 1 } };
  if (toStatus) { set.status = toStatus; set.status_changed_at = new Date(); set.flag_waitlisted = toStatus === 'Waitlisted' ? true : decided ? false : !!ua.flag_waitlisted; if (decided && !ua.first_decision_at) set.first_decision_at = new Date(); }
  await UniversityApplication.updateOne({ _id: ua._id }, set);
  const act = await UniAction.create({ uapp_id: ua._id, university_id: ua.university_id, application_id: a._id, type, data: data || {}, from_status: ua.status, to_status: toStatus || undefined,
    by_account_id: actor.su?._id, by_staff_id: actor.staff?.id, processing, forced_review: forced });
  const who = actor.su ? `${P.uniName(u)}: ${actor.su.name}` : `La Europa on behalf of ${P.uniName(u)}`;
  await timeline({ student_id: s._id, type: 'stage', description: `University portal: ${DECISION_LABEL[type] || type} on ${a.application_code} (${who})${processing === 'Pending review' ? ' - waiting for counsellor review' : ''}`, user_id: actor.staff?.id });
  // La Europa staff notifications (12.10)
  const hs = (await P.handlers(a)).map(String);
  if (STAGE_ACTIONS.has(type)) {
    const msg = `${P.uniName(u)}: ${DECISION_LABEL[type]} for ${fullName(s)} (${a.application_code})${processing === 'Pending review' ? ' - please review' : ''}`;
    for (const x of hs) await notify(x, 'university', msg, processing === 'Pending review' ? '/university-updates' : `/students/${s._id}/applications`);
    const ad = type === 'correction' ? await admins() : [];
    for (const x of ad) if (!hs.includes(x)) await notify(x, 'university', `Decision corrected by ${P.uniName(u)} on ${a.application_code}`, '/university-updates');
    const N = await (await import('../routes/uni')).names();
    await staffEmail('E45', [...hs, ...ad], { university_id: u._id, ctx: { decision: DECISION_LABEL[type], student_name: fullName(s), student_id: s.student_code, course: a.course_name_text || N(a.course_id), intake: N(a.intake_id),
      notify_mode: mode === 'automatic' ? 'Automatic' : 'Counsellor reviews first',
      review_line: mode === 'automatic' ? 'The stage has been updated and the student email has been queued.' : 'Please review and apply it in University updates. The student has not been told yet.' }, link: '' });
  } else if (['offer_letter', 'cas', 'interview_result'].includes(type)) {
    const extra = type === 'cas' && s.visa_user_id ? [String(s.visa_user_id)] : [];
    for (const x of [...hs, ...extra]) await notify(x, 'university', `${P.uniName(u)} uploaded ${DECISION_LABEL[type].toLowerCase()} for ${fullName(s)} (${a.application_code})`, `/students/${s._id}/applications`);
  }
  if (processing === 'Applied') await apply(String(act._id), null, { notify: true, auto: true });
  return { id: String(act._id), processing };
}

/** apply an action to the CRM; staff = null in automatic mode */
export async function apply(actionId: string, staff: { id: string; name: string } | null, opts: { notify?: boolean; message?: string; auto?: boolean; include_reason?: boolean } = {}) {
  const act = (await UniAction.findById(actionId).lean()) as Any;
  if (!act) throw new HttpError(404, 'Not found');
  if (!opts.auto && !['Pending review', 'Held'].includes(act.processing)) throw bad('This update was already processed');
  const ua = (await UniversityApplication.findById(act.uapp_id).lean()) as Any;
  const { a, s, u } = await ctxOf(ua);
  const d: Any = act.data || {};
  const target = P.STAGE_OF[act.to_status] || null;
  const f: Any = {};
  if (target && target !== a.stage) { f.stage = target; f.stage_changed_at = new Date(); }
  if (act.type === 'interview') { f.interview_at = d.at; f.interview_link = d.link || d.mode; }
  if (['conditional_offer', 'unconditional_offer', 'conditions_met'].includes(act.type)) {
    f.offer_type = act.to_status === 'Conditional offer' ? 'conditional_offer' : 'unconditional_offer';
    if (d.conditions?.length) f.offer_conditions = d.conditions.map((c: Any) => `- ${c.text}${c.due ? ' (by ' + c.due + ')' : ''}`).join('\n');
    if (d.acceptance_deadline) f.offer_deadline = d.acceptance_deadline;
    if (d.deposit) { f.deposit_required = d.deposit; f.deposit_currency = d.deposit_currency || d.currency; }
  }
  if (act.type === 'acknowledge' && d.reference) f.university_app_id = d.reference;
  const notifyStudent = opts.notify !== false;
  if (Object.keys(f).length) await Application.updateOne({ _id: a._id }, f);
  if (f.stage) await StageHistory.create({ application_id: a._id, from_stage: a.stage, to_stage: f.stage, reason: `University portal: ${DECISION_LABEL[act.type]}${d.reason ? ' - ' + d.reason : ''}`, notified: notifyStudent, show_reason_to_student: false, changed_by: staff?.id });
  // offer: conditions and the university fee summary (CD 9.2)
  if (['conditional_offer', 'unconditional_offer'].includes(act.type)) {
    if (act.type === 'conditional_offer') for (const c of d.conditions || []) await OfferCondition.create({ application_id: a._id, student_id: s._id, text: `${c.text}${c.type ? ' [' + c.type + ']' : ''}${c.due ? ' (due ' + c.due + ')' : ''}`, status: 'Open', created_by_type: 'university' });
    if (d.tuition) await FeeSummary.updateOne({ student_id: s._id, fee_kind: 'tuition', application_id: a._id, is_deleted: false },
      { total_amount: d.tuition, currency: d.currency, scholarship: d.scholarship || null, deposit_required: d.deposit || null, deposit_deadline: d.deposit_deadline || null }, { upsert: true });
  }
  if (act.type === 'conditions_met') await OfferCondition.updateMany({ application_id: a._id, status: 'Open', is_deleted: false }, { status: 'Met' });
  await UniAction.updateOne({ _id: act._id }, { processing: notifyStudent ? 'Applied' : 'Applied without notifying', processed_by: staff?.id, processed_at: new Date() });
  // the offer letter reaches the student when "Share offer letters automatically" is on (SD 8.4)
  if (['conditional_offer', 'unconditional_offer', 'conditions_met'].includes(act.type) && (await getSetting('share_offer_auto')) === '1')
    for (const ol of await OfferLetter.find({ uapp_id: ua._id, document_id: { $ne: null } }).lean()) await StudentDocument.updateOne({ _id: ol.document_id, shared_with_student: { $ne: true } }, { shared_with_student: true, shared_at: new Date() });
  const W = await import('../routes/work');
  const N = await W.names();
  const by = staff?.id ?? String(s.primary_counsellor_id ?? '');
  if (act.type === 'interview' && d.at && s.primary_counsellor_id) await systemTask(`interview:${a._id}`, { title: `Prepare student for interview: ${fullName(s)} with ${P.uniName(u)}`, type: 'Application submission', student_id: s._id, application_id: a._id,
    assigned_to: s.primary_counsellor_id, due_at: new Date(d.at), priority: 'High', reminder: '1 day before' } as never, by);
  if (d.acceptance_deadline) await W.offerDeadlineTask(s as never, (await Application.findById(a._id))! as never, N, by).catch(() => {});
  // student email (E05 - E08, E43)
  const na = (await Application.findById(a._id).lean()) as Any;
  let code: string | null = null;
  if (act.type === 'waitlist') code = 'E43';
  else if (act.type === 'acknowledge') code = (await getSetting('uni_ack_email')) === '0' ? null : 'E05';
  else if (f.stage) code = await W.triggerFor('app_stage', f.stage);
  else if (act.type === 'interview') code = 'E06';
  const what = `University decision ${DECISION_LABEL[act.type]} on ${a.application_code}`;
  let q: unknown = null;
  if (code) {
    if (notifyStudent) {
      const extra: Record<string, string> = act.type === 'interview' && d.rescheduled ? { stage_message: 'Updated: the interview has been rescheduled.' } : {};
      if (act.type === 'reject' && d.share_reason && opts.include_reason) extra.include_reason_if_ticked = `Reason shared by the university: ${d.reason}`;
      q = await studentEmail(code, { student_id: s._id, ctx: await W.appCtx(na, s as never, N, extra), userId: staff?.id, message: opts.message });
    } else if (staff) await timeline({ student_id: s._id, type: 'email', description: `Saved without notifying: ${what}`, user_id: staff.id });
  }
  await timeline({ student_id: s._id, type: 'stage', description: `${what} applied${staff ? ' by ' + staff.name : ' automatically'}${notifyStudent ? '' : ' (student not notified)'}`, user_id: staff?.id });
  return { email: q };
}
export async function hold(actionId: string, staff: { id: string }, note: unknown) {
  if (!clean(note)) throw fieldErr('note', 'A note is required to hold');
  await UniAction.updateOne({ _id: actionId, processing: { $in: ['Pending review', 'Held'] } }, { processing: 'Held', held_note: clean(note, 500), processed_by: staff.id, processed_at: new Date() });
}

// ---------- commission record on enrolment (10.3) ----------
export async function matchRule(ua: Any, a: Any) {
  const today = ua.enrol_date || istDate();
  const rules = (await CommissionRule.find({ university_id: ua.university_id, status: 'Active', is_deleted: false }).lean()) as Any[];
  const fit = rules.filter((r) => (!r.valid_from || r.valid_from <= today) && (!r.valid_to || r.valid_to >= today))
    .filter((r) => !r.intakes?.length || r.intakes.includes(String(a.intake_id)))
    .filter((r) => { const sc = (r.scope_ids ?? []).map(String); if (r.scope === 'courses') return sc.includes(String(a.course_id)); if (r.scope === 'campuses') return sc.includes(String(ua.campus_id)); if (r.scope === 'levels') return sc.includes(a.level); return true; });
  const rank: Record<string, number> = { courses: 4, campuses: 3, levels: 2, all: 1 };
  return fit.sort((x, y) => (rank[y.scope] || 0) - (rank[x.scope] || 0))[0] || null;
}
export function calcAmount(rule: Any, gross: number, scholarship?: number) {
  if (!rule) return null;
  let amt = rule.basis === 'fixed' ? Number(rule.fixed_amount) : ((rule.basis === 'net' ? Math.max(0, gross - (scholarship || 0)) : gross) * Number(rule.rate)) / 100;
  if (rule.min_amount && amt < rule.min_amount) amt = rule.min_amount;
  if (rule.max_amount && amt > rule.max_amount) amt = rule.max_amount;
  return Math.round(amt * 100) / 100;
}
export async function upsertCommission(uaId: unknown, event?: string) {
  const ua = (await UniversityApplication.findById(uaId).lean()) as Any;
  const a = (await Application.findById(ua.application_id).lean()) as Any;
  const rule = await matchRule(ua, a);
  if (rule && event === 'deposit' && rule.due_event !== 'deposit') return null; // a deposit creates a commission only if the rule says so
  const ex = (await Commission.findOne({ uapp_id: ua._id, is_deleted: false, status: { $ne: 'Cancelled' } }).lean()) as Any;
  if (ex && ['Invoiced', 'Paid', 'Overdue'].includes(ex.status)) {
    for (const x of await admins()) await notify(x, 'commission', `Commission ${ex.commission_code} is already invoiced but the university changed the enrolment data: cancel with a credit note and re-invoice`, '/admin/commission');
    return String(ex._id);
  }
  const gross = Number(ua.final_tuition || 0);
  const amount = calcAmount(rule, gross, ua.scholarship_amount);
  let status = 'Needs rule', due: string | null = null;
  if (rule) {
    if (rule.due_event === 'days') { due = addDays(ua.enrol_date || istDate(), Number(rule.due_days || 0)); status = due <= istDate() ? 'Due' : 'Expected'; }
    else if (rule.due_event === 'deposit') { status = 'Due'; due = istDate(); }
    else { status = ua.status === 'Enrolled' ? 'Due' : 'Expected'; due = ua.status === 'Enrolled' ? ua.enrol_date || istDate() : null; }
  }
  const f = { university_id: ua.university_id, uapp_id: ua._id, application_id: a._id, rule_id: rule?._id, basis_amount: rule && rule.basis === 'net' ? Math.max(0, gross - (ua.scholarship_amount || 0)) : gross,
    basis_currency: ua.final_currency, rate: rule && rule.basis !== 'fixed' ? rule.rate : null, fixed_amount: rule && rule.basis === 'fixed' ? rule.fixed_amount : null, amount,
    currency: rule && rule.basis === 'fixed' ? rule.fixed_currency || ua.final_currency : ua.final_currency, status, due_date: due };
  let id: string;
  if (ex) { await Commission.updateOne({ _id: ex._id }, { ...f, recalculated: true }); id = String(ex._id); }
  else id = String((await Commission.create({ commission_code: await nextCode('COM'), ...f }))._id);
  if (!rule) { const u = await University.findById(ua.university_id).lean(); for (const x of await admins()) await notify(x, 'commission', `Commission needs a rule: ${P.uniName(u)}, ${a.application_code}`, '/admin/commission'); }
  await applySlabs(ua.university_id, a.intake_id);
  return id;
}
/** volume bonus slabs (10.2): one adjustment line per intake when a slab is reached */
async function applySlabs(universityId: unknown, intakeId: unknown) {
  for (const r of (await CommissionRule.find({ university_id: universityId, status: 'Active', is_deleted: false, 'slabs.0': { $exists: true } }).lean()) as Any[]) {
    const appIds = await Application.distinct('_id', { intake_id: intakeId });
    const n = await Commission.countDocuments({ university_id: universityId, rule_id: r._id, application_id: { $in: appIds }, status: { $ne: 'Cancelled' }, internal_note: { $not: /^Volume bonus/ } });
    for (const sl of r.slabs as Any[]) {
      if (n < Number(sl.from)) continue;
      const key = `Volume bonus ${r._id}:${intakeId}:${sl.from}`;
      if (await Commission.exists({ university_id: universityId, internal_note: new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })) continue;
      const u = await University.findById(universityId).lean();
      await Commission.create({ commission_code: await nextCode('COM'), university_id: universityId, uapp_id: new Types.ObjectId(), rule_id: r._id, amount: sl.extra_fixed ? Number(sl.extra_fixed) : null, currency: sl.currency || r.fixed_currency || 'EUR',
        status: sl.extra_fixed ? 'Due' : 'Needs rule', due_date: istDate(), internal_note: `${key}: ${n} enrolments reached slab from ${sl.from}${sl.extra_percent ? ` (+${sl.extra_percent}% to be calculated by Admin)` : ''}` });
      for (const x of await admins()) await notify(x, 'commission', `Volume bonus slab reached for ${P.uniName(u)} (${n} enrolments)`, '/admin/commission');
    }
  }
}
