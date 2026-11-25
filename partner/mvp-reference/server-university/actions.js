'use strict';
// University actions -> La Europa CRM (University doc 6.5, 6.6). Every action creates a uni_actions row.
// Review mode: CRM stage / student email change only when the counsellor applies it (S45). Automatic mode: applied at once.
const { all, get, run, insert, update, uuid, now, getSetting, tx } = require('../db');
const U = require('../util');
const { masterName, fullName, fmtDate, fmtDateTime, timeline, notify } = U;
const S = require('../services');
const email = require('../email');
const files = require('../files');
const C = require('./common');
const UE = require('./uemail');

const DECISION_LABEL = { acknowledge: 'Acknowledged', interview: 'Interview scheduled', interview_result: 'Interview result recorded', conditional_offer: 'Conditional offer',
  unconditional_offer: 'Unconditional offer', conditions_met: 'Conditions met (unconditional offer)', reject: 'Rejected', waitlist: 'Waitlisted', deposit: 'Deposit received',
  enrolled: 'Enrolled', correction: 'Decision corrected', offer_letter: 'Offer letter uploaded', cas: 'Acceptance letter for visa uploaded', under_assessment: 'Under assessment',
  doc_request: 'Documents requested' };
// actions that change the CRM stage (and email the student) when applied
const STAGE_ACTIONS = new Set(['acknowledge', 'interview', 'conditional_offer', 'unconditional_offer', 'conditions_met', 'reject', 'waitlist', 'deposit', 'enrolled', 'correction']);

function ctxOf(ua) { const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id); const s = get('SELECT * FROM students WHERE id = ?', a.student_id); return { a, s, u: C.uni(ua.university_id) }; }

// Record a university action. actor: { uu } (university user) or { staff } (La Europa on behalf)
function record(ua, type, data, actor, toStatus, opts = {}) {
  const { a, s, u } = ctxOf(ua);
  const forced = opts.forceReview || type === 'correction' || (type === 'reject' && getSetting('uni_always_review_rejections') !== '0');
  const mode = forced ? 'review' : (u.notify_mode === 'automatic' ? 'automatic' : 'review');
  const id = uuid();
  const processing = STAGE_ACTIONS.has(type) ? (mode === 'automatic' ? 'Applied' : 'Pending review') : 'Info';
  tx(() => {
    if (toStatus) run(`UPDATE university_applications SET status = ?, status_changed_at = ?, version = version + 1, updated_at = ?, flag_waitlisted = ?, first_decision_at = COALESCE(first_decision_at, ?) WHERE id = ?`,
      toStatus, now(), now(), toStatus === 'Waitlisted' ? 1 : (['Conditional offer', 'Unconditional offer', 'Rejected'].includes(toStatus) ? 0 : ua.flag_waitlisted), ['Conditional offer', 'Unconditional offer', 'Rejected'].includes(toStatus) ? now() : null, ua.id);
    else run('UPDATE university_applications SET version = version + 1, updated_at = ? WHERE id = ?', now(), ua.id);
    insert('uni_actions', { id, uapp_id: ua.id, university_id: ua.university_id, application_id: a.id, type, data_json: JSON.stringify(data || {}), from_status: ua.status, to_status: toStatus || null,
      by_uni_user_id: actor.uu ? actor.uu.id : null, by_staff_id: actor.staff ? actor.staff.id : null, processing, forced_review: forced ? 1 : 0, created_at: now() });
  });
  const who = actor.uu ? `${C.uniName(u)}: ${actor.uu.name}` : `La Europa on behalf of ${C.uniName(u)}`;
  timeline({ student_id: s.id, type: 'stage', description: `University portal: ${DECISION_LABEL[type] || type} on ${a.application_code} (${who})${processing === 'Pending review' ? ' - waiting for counsellor review' : ''}`, link: `app:${a.id}`, user_id: actor.staff ? actor.staff.id : null });
  // La Europa staff notifications (12.10)
  const hs = C.handlers(a);
  if (STAGE_ACTIONS.has(type)) {
    const msg = `${C.uniName(u)}: ${DECISION_LABEL[type]} for ${fullName(s)} (${a.application_code})${processing === 'Pending review' ? ' - please review' : ''}`;
    for (const h of hs) notify(h, 'university', msg, processing === 'Pending review' ? '#/university-updates' : `#/students/${s.id}/applications`);
    if (type === 'correction') for (const ad of U.admins()) if (!hs.includes(ad)) notify(ad, 'university', `Decision corrected by ${C.uniName(u)} on ${a.application_code}`, '#/university-updates');
    UE.staffEmail('E45', hs.concat(type === 'correction' ? U.admins() : []), { university_id: u.id, uapp_id: null, ctx: { decision: DECISION_LABEL[type], student_name: fullName(s), student_id: s.student_code,
      course: a.course_name_text || masterName(a.course_id), intake: masterName(a.intake_id), notify_mode: mode === 'automatic' ? 'Automatic' : 'Counsellor reviews first',
      review_line: mode === 'automatic' ? 'The stage has been updated and the student email has been queued.' : 'Please review and apply it in University updates. The student has not been told yet.' }, link: '' });
  } else if (['offer_letter', 'cas', 'interview_result'].includes(type)) {
    const extra = type === 'cas' && s.visa_user_id ? [s.visa_user_id] : [];
    for (const h of hs.concat(extra)) notify(h, 'university', `${C.uniName(u)} uploaded ${DECISION_LABEL[type].toLowerCase()} for ${fullName(s)} (${a.application_code})`, `#/students/${s.id}/applications`);
  }
  if (processing === 'Applied') apply(id, null, { notify: true, auto: true });
  return { id, processing };
}

// Apply an action to the CRM. staffUser = null for automatic mode. opts: { notify, message, req }
function apply(actionId, staffUser, opts = {}) {
  const act = get('SELECT * FROM uni_actions WHERE id = ?', actionId);
  if (!act) throw U.notFound();
  if (!opts.auto && !['Pending review', 'Held'].includes(act.processing)) throw U.bad('This update was already processed');
  const ua = get('SELECT * FROM university_applications WHERE id = ?', act.uapp_id);
  const { a, s, u } = ctxOf(ua);
  const d = C.parseJ(act.data_json, {});
  const target = C.STAGE_OF[act.to_status] || null;
  const f = {};
  if (target && target !== a.stage) { f.stage = target; f.stage_changed_at = now(); }
  if (act.type === 'interview') { f.interview_at = d.at; f.interview_link = d.link || d.mode; }
  if (['conditional_offer', 'unconditional_offer', 'conditions_met'].includes(act.type)) {
    f.offer_type = act.to_status === 'Conditional offer' ? 'conditional_offer' : 'unconditional_offer';
    if (d.conditions && d.conditions.length) f.offer_conditions = d.conditions.map(c => `- ${c.text}${c.due ? ' (by ' + fmtDate(c.due) + ')' : ''}`).join('\n');
    if (d.acceptance_deadline) f.offer_deadline = d.acceptance_deadline;
    if (d.deposit) { f.deposit_required = d.deposit; f.deposit_currency = d.deposit_currency || d.currency; }
  }
  if (act.type === 'acknowledge' && d.reference) f.university_app_id = d.reference;
  const notifyStudent = opts.notify !== false;
  tx(() => {
    if (Object.keys(f).length) update('applications', a.id, f, staffUser ? staffUser.id : null);
    if (f.stage) insert('application_stage_history', { id: uuid(), application_id: a.id, from_stage: a.stage, to_stage: f.stage, reason: `University portal: ${DECISION_LABEL[act.type]}${d.reason ? ' - ' + d.reason : ''}`,
      notified: notifyStudent ? 1 : 0, show_reason_to_student: 0, changed_by: staffUser ? staffUser.id : null, changed_at: now(), source: 'university', uni_action_id: act.id });
    // offer: conditions + university fee summary (CD 9.2)
    if (['conditional_offer', 'unconditional_offer'].includes(act.type)) {
      if (act.type === 'conditional_offer') for (const c of d.conditions || []) insert('offer_conditions', { application_id: a.id, text: `${c.text}${c.type ? ' [' + c.type + ']' : ''}${c.due ? ' (due ' + fmtDate(c.due) + ')' : ''}`, status: 'Open', created_by_type: 'university' }, null);
      if (d.tuition) {
        const ex = get(`SELECT id FROM fee_summaries WHERE student_id = ? AND fee_kind = 'tuition' AND application_id = ? AND is_deleted = 0`, s.id, a.id);
        const fs0 = { total_amount: d.tuition, currency: d.currency, scholarship: d.scholarship || null, deposit_required: d.deposit || null, deposit_deadline: d.deposit_deadline || null };
        if (ex) update('fee_summaries', ex.id, fs0, null); else insert('fee_summaries', { student_id: s.id, application_id: a.id, fee_kind: 'tuition', ...fs0 }, null);
      }
    }
    if (act.type === 'conditions_met') run(`UPDATE offer_conditions SET status = 'Met', updated_at = ? WHERE application_id = ? AND status = 'Open' AND is_deleted = 0`, now(), a.id);
    run('UPDATE uni_actions SET processing = ?, processed_by = ?, processed_at = ? WHERE id = ?', notifyStudent ? 'Applied' : 'Applied without notifying', staffUser ? staffUser.id : null, now(), act.id);
  });
  // offer letter to the student follows SD 8.4 "Share offer letters automatically"
  if (['conditional_offer', 'unconditional_offer', 'conditions_met'].includes(act.type) && getSetting('share_offer_auto') === '1')
    for (const ol of all('SELECT document_id FROM offer_letters WHERE uapp_id = ?', ua.id)) if (ol.document_id) run('UPDATE documents SET shared_with_student = 1, shared_at = COALESCE(shared_at, ?) WHERE id = ?', now(), ol.document_id);
  if (act.to_status === 'Enrolled') { try { files.buildFolder(s.id, a.country_id); } catch { /* folders best effort */ } }
  if (act.type === 'interview' && d.at) S.systemTask(`interview:${a.id}`, { title: `Prepare student for interview: ${fullName(s)} with ${C.uniName(u)}`, type: 'Application submission', student_id: s.id, application_id: a.id,
    assigned_to: s.primary_counsellor_id, due_at: d.at, priority: 'High', reminder: '1 day before' }, staffUser ? staffUser.id : null);
  if (d.acceptance_deadline) { try { require('../routes/work').offerDeadlineTask(s, get('SELECT * FROM applications WHERE id = ?', a.id)); } catch { /* */ } }
  // student email (E05 - E08, E43)
  const na = get('SELECT * FROM applications WHERE id = ?', a.id);
  const W = require('../routes/work');
  let code = null;
  if (act.type === 'waitlist') code = 'E43';
  else if (act.type === 'acknowledge') code = getSetting('uni_ack_email') === '0' ? null : 'E05';
  else if (f.stage) code = W.triggerFor(f.stage);
  else if (act.type === 'interview') code = 'E06';
  const what = `University decision ${DECISION_LABEL[act.type]} on ${a.application_code}`;
  let q = null;
  if (code) {
    if (notifyStudent) {
      const extra = act.type === 'interview' && d.rescheduled ? { stage_message: 'Updated: the interview has been rescheduled.' } : {};
      if (act.type === 'reject' && d.share_reason && opts.include_reason) extra.include_reason_if_ticked = `Reason shared by the university: ${d.reason}`;
      q = email.trigger(code, { student_id: s.id, ctx: W.appCtx(na, s, extra), userId: staffUser ? staffUser.id : null, message: opts.message });
    } else if (staffUser) { timeline({ student_id: s.id, type: 'email', description: `Saved without notifying: ${what}`, user_id: staffUser.id }); }
  }
  timeline({ student_id: s.id, type: 'stage', description: `${what} applied${staffUser ? ' by ' + staffUser.name : ' automatically'}${notifyStudent ? '' : ' (student not notified)'}`, link: `app:${a.id}`, user_id: staffUser ? staffUser.id : null });
  return { email: q };
}
function hold(actionId, staffUser, note) {
  if (!U.clean(note)) throw U.fieldErr('note', 'A note is required to hold');
  run(`UPDATE uni_actions SET processing = 'Held', held_note = ?, processed_by = ?, processed_at = ? WHERE id = ? AND processing IN ('Pending review','Held')`, U.clean(note, 500), staffUser.id, now(), actionId);
}

// Commission record on enrolment (10.3)
function matchRule(ua, a) {
  const today = ua.enrol_date || U.istDate();
  const rules = all(`SELECT * FROM commission_rules WHERE university_id = ? AND status = 'Active' AND is_deleted = 0 AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)`, ua.university_id, today, today)
    .filter(r => { const ints = C.parseJ(r.intakes_json, []); return !ints.length || ints.includes(a.intake_id); })
    .filter(r => { const sc = C.parseJ(r.scope_json, []); if (r.scope === 'courses') return sc.includes(a.course_id); if (r.scope === 'campuses') return sc.includes(ua.campus_id); if (r.scope === 'levels') return sc.includes(a.level); return true; });
  const rank = { courses: 4, campuses: 3, levels: 2, all: 1 };
  return rules.sort((x, y) => (rank[y.scope] || 0) - (rank[x.scope] || 0))[0] || null;
}
function calcAmount(rule, basisGross, scholarship) {
  if (!rule) return null;
  let amt = rule.basis === 'fixed' ? Number(rule.fixed_amount) : (rule.basis === 'net' ? Math.max(0, basisGross - (scholarship || 0)) : basisGross) * Number(rule.rate) / 100;
  if (rule.min_amount && amt < rule.min_amount) amt = rule.min_amount;
  if (rule.max_amount && amt > rule.max_amount) amt = rule.max_amount;
  return Math.round(amt * 100) / 100;
}
function nextCommissionCode() { return require('../db').nextCode('COM'); }
function upsertCommission(uaId, event) {
  const ua = get('SELECT * FROM university_applications WHERE id = ?', uaId);
  const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id);
  const rule = matchRule(ua, a);
  if (rule && event === 'deposit' && rule.due_event !== 'deposit') return null; // deposit only creates a commission if the rule says so
  const ex = get(`SELECT * FROM commissions WHERE uapp_id = ? AND is_deleted = 0 AND status NOT IN ('Cancelled')`, ua.id);
  if (ex && ['Invoiced', 'Paid', 'Overdue'].includes(ex.status)) {
    for (const ad of U.admins()) notify(ad, 'commission', `Commission ${ex.commission_code} is already invoiced but the university changed the enrolment data: cancel with a credit note and re-invoice`, '#/admin/commission');
    return ex.id;
  }
  const gross = Number(ua.final_tuition || 0);
  const amount = calcAmount(rule, gross, ua.scholarship_amount);
  let status = 'Needs rule', due = null;
  if (rule) {
    if (rule.due_event === 'days') { due = U.addDays(ua.enrol_date || U.istDate(), Number(rule.due_days || 0)); status = due <= U.istDate() ? 'Due' : 'Expected'; }
    else if (rule.due_event === 'deposit') { status = 'Due'; due = U.istDate(); }
    else { status = ua.status === 'Enrolled' ? 'Due' : 'Expected'; due = ua.status === 'Enrolled' ? (ua.enrol_date || U.istDate()) : null; }
  }
  const f = { university_id: ua.university_id, uapp_id: ua.id, application_id: a.id, rule_id: rule ? rule.id : null, basis_amount: rule && rule.basis === 'net' ? Math.max(0, gross - (ua.scholarship_amount || 0)) : gross,
    basis_currency: ua.final_currency, rate: rule && rule.basis !== 'fixed' ? rule.rate : null, fixed_amount: rule && rule.basis === 'fixed' ? rule.fixed_amount : null, amount,
    currency: rule && rule.basis === 'fixed' ? (rule.fixed_currency || ua.final_currency) : ua.final_currency, status, due_date: due };
  let id;
  if (ex) { update('commissions', ex.id, { ...f, recalculated: 1 }, null); id = ex.id; }
  else id = insert('commissions', { commission_code: nextCommissionCode(), ...f }, null);
  if (!rule) for (const ad of U.admins()) notify(ad, 'commission', `Commission needs a rule: ${C.uniName(C.uni(ua.university_id))}, ${a.application_code}`, '#/admin/commission');
  applySlabs(ua.university_id, a.intake_id);
  return id;
}
// Volume bonus slabs (10.2): one adjustment line per intake when the slab is reached
function applySlabs(universityId, intakeId) {
  for (const r of all(`SELECT * FROM commission_rules WHERE university_id = ? AND status = 'Active' AND is_deleted = 0 AND slabs_json IS NOT NULL`, universityId)) {
    const slabs = C.parseJ(r.slabs_json, []); if (!slabs.length) continue;
    const n = get(`SELECT COUNT(*) c FROM commissions c JOIN applications a ON a.id = c.application_id WHERE c.university_id = ? AND c.rule_id = ? AND a.intake_id = ? AND c.status NOT IN ('Cancelled') AND c.uapp_id NOT LIKE 'slab:%'`, universityId, r.id, intakeId).c;
    for (const sl of slabs) {
      if (n < Number(sl.from)) continue;
      const key = `slab:${r.id}:${intakeId}:${sl.from}`;
      if (get('SELECT 1 x FROM commissions WHERE uapp_id = ?', key)) continue;
      insert('commissions', { commission_code: nextCommissionCode(), university_id: universityId, uapp_id: key, rule_id: r.id, amount: sl.extra_fixed ? Number(sl.extra_fixed) : null, currency: sl.currency || r.fixed_currency || 'EUR',
        status: sl.extra_fixed ? 'Due' : 'Needs rule', due_date: U.istDate(), internal_note: `Volume bonus: ${n} enrolments reached slab from ${sl.from}${sl.extra_percent ? ` (+${sl.extra_percent}% to be calculated by Admin)` : ''}` }, null);
      for (const ad of U.admins()) notify(ad, 'commission', `Volume bonus slab reached for ${C.uniName(C.uni(universityId))} (${n} enrolments, intake ${masterName(intakeId)})`, '#/admin/commission');
    }
  }
}

module.exports = { DECISION_LABEL, STAGE_ACTIONS, record, apply, hold, upsertCommission, matchRule, calcAmount };
