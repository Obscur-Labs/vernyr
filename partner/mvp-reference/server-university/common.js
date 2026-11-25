'use strict';
// Shared helpers for the university portal (University doc 1.8 - 1.10, 6.2, 14).
const { all, get, run, insert, uuid, now, getSetting, decrypt } = require('../db');
const U = require('../util');
const S = require('../services');

const COOKIE = 'le_usid';
const ROLE_LABEL = { admin: 'University Admin', officer: 'Admissions Officer', viewer: 'University Viewer' };
const NotFound = () => new U.HttpError(404, 'Not found');
const gs = (k, d) => { const v = getSetting(k); return v === undefined || v === null || v === '' ? d : v; };

// ---------- statuses (6.2) ----------
const STATUSES = ['New', 'Acknowledged', 'Documents requested', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer',
  'Rejected', 'Offer accepted', 'Deposit received', 'Enrolled', 'Withdrawn'];
const STAGE_OF = { New: 'applied', Acknowledged: 'under_review', 'Documents requested': 'under_review', 'Under assessment': 'under_review', 'Interview scheduled': 'interview',
  Waitlisted: 'under_review', 'Conditional offer': 'conditional_offer', 'Unconditional offer': 'unconditional_offer', Rejected: 'rejected', 'Offer accepted': 'offer_accepted',
  'Deposit received': 'tuition_paid', Enrolled: 'enrolment_confirmed', Withdrawn: 'withdrawn' };
const ALLOWED = {
  New: ['Acknowledged', 'Documents requested', 'Interview scheduled', 'Conditional offer', 'Unconditional offer', 'Rejected', 'Waitlisted'],
  Acknowledged: ['Documents requested', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer', 'Rejected'],
  'Under assessment': ['Documents requested', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer', 'Rejected'],
  'Documents requested': ['Documents requested', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer', 'Rejected'],
  'Interview scheduled': ['Under assessment', 'Conditional offer', 'Unconditional offer', 'Rejected', 'Waitlisted', 'Interview scheduled', 'Documents requested'],
  Waitlisted: ['Conditional offer', 'Unconditional offer', 'Rejected', 'Documents requested'],
  'Conditional offer': ['Unconditional offer', 'Rejected', 'Documents requested'],
  'Unconditional offer': ['Documents requested'],
  'Offer accepted': ['Deposit received'],
  'Deposit received': ['Enrolled'],
  Rejected: [], Enrolled: [], Withdrawn: []
};
const CLOSED = ['Rejected', 'Enrolled', 'Withdrawn'];
const canMove = (from, to) => (ALLOWED[from] || []).includes(to);

// ---------- fee word filter (4.6 V1) ----------
const FEE_WORDS = /(non[\s.\-]*eu|eu[\s.\-]*\/[\s.\-]*eea|\beea\b|international|foreign|overseas)/i;
function feeWordCheck(fields) { // { label: value }
  const errors = {};
  for (const [k, v] of Object.entries(fields)) if (v && FEE_WORDS.test(String(v))) errors[k] = 'Please enter only the amount. Words like non-EU, international or foreign are not allowed in fee fields.';
  return errors;
}
const feeWordNear = (text) => /(non[\s.\-]*eu|international|foreign|overseas)\s*(tuition|fee|fees)|(tuition|fee|fees)\s*(for)?\s*(non[\s.\-]*eu|international|foreign|overseas)/i.test(String(text || ''));

// ---------- audit (14.5) ----------
function uaudit(req, action, entityType, entityId, label, oldV, newV, universityId) {
  run(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, entity_label, old_value_json, new_value_json, ip, user_agent, created_at, actor_type, university_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, req && req.uu ? req.uu.id : (req && req.auditUniUserId) || (req && req.user ? req.user.id : null), action, entityType || null, entityId || null, label || null,
  oldV ? JSON.stringify(oldV) : null, newV ? JSON.stringify(newV) : null, req ? req.ip || null : null, req && req.headers ? String(req.headers['user-agent'] || '').slice(0, 300) : null, now(),
  req && (req.uu || req.auditUniUserId) ? 'university' : 'staff', universityId || (req && req.uu ? req.uu.university_id : null));
}

// ---------- university users / notifications ----------
const parseJ = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
function usersOf(universityId, { roles, alert, finance, campusId } = {}) {
  return all(`SELECT * FROM uni_users WHERE university_id = ? AND status = 'Active' AND is_deleted = 0`, universityId).filter(u => {
    if (roles && !roles.includes(u.role)) return false;
    if (finance && !(u.finance || u.role === 'admin')) return false;
    const camps = parseJ(u.campuses_json, []);
    if (campusId && camps.length && !camps.includes(campusId)) return false;
    if (alert) { const a = parseJ(u.alerts_json, null); const on = a ? a.includes(alert) : true; if (!on && !(u.is_main_contact && ['applications', 'finance'].includes(alert))) return false; }
    return true;
  });
}
function unotify(uniUserIds, title, link) {
  for (const id of new Set(uniUserIds.filter(Boolean))) insert('uni_notifications', { id: uuid(), uni_user_id: id, title: String(title).slice(0, 300), link: link || null, created_at: now() });
}
function notifyUni(universityId, filter, title, link) { unotify(usersOf(universityId, filter).map(u => u.id), title, link); }

// ---------- per-university settings ----------
function uni(universityId) { return get('SELECT * FROM universities WHERE id = ?', universityId); }
function uniName(u) { return (u && (u.display_name || u.name)) || ''; }
function shortName(u) { return (u && (u.short_name || u.display_name || u.name)) || ''; }
function activeAgreement(universityId) {
  const today = U.istDate();
  return get(`SELECT * FROM partner_agreements WHERE university_id = ? AND is_deleted = 0 AND status IN ('Active','Expiring soon') AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1`, universityId, today, today);
}

// ---------- the student's application as the university may see it (1.10, whitelisted) ----------
const STATE_OF = (s) => s.state || null;
function laEuropaContact(app, student) {
  const ids = [student.primary_counsellor_id, app.handled_by || student.application_user_id].filter(Boolean);
  return [...new Set(ids)].map(id => get('SELECT name, email, mobile FROM users WHERE id = ?', id)).filter(Boolean).map(u => ({ name: u.name, email: u.email, phone: u.mobile || null }));
}
function maskPass(p) { return p ? String(p).slice(0, 3) + 'X'.repeat(Math.max(0, String(p).length - 4)) + String(p).slice(-1) : null; }
function appView(ua, opts = {}) {
  const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id);
  const s = get('SELECT * FROM students WHERE id = ?', a.student_id);
  const u = uni(ua.university_id);
  const campus = ua.campus_id ? get('SELECT name, city FROM campuses WHERE id = ?', ua.campus_id) : null;
  const daysIn = Math.max(0, Math.floor((Date.now() - new Date(ua.status_changed_at || ua.submitted_at)) / 864e5));
  const base = { id: ua.id, application_code: a.application_code, student_name: U.fullName(s), course: a.course_name_text || U.masterName(a.course_id), course_id: a.course_id, level: a.level,
    campus: campus ? campus.name : null, intake: U.masterName(a.intake_id), intake_id: a.intake_id, submitted_at: ua.submitted_at, status: ua.status, days_in_status: daysIn,
    university_ref: ua.university_ref, flags: { docs_requested: !!ua.flag_docs_requested, waitlisted: !!ua.flag_waitlisted }, version: ua.version, withdrawn_at: ua.withdrawn_at,
    state: STATE_OF(s), country: s.country_of_residence || 'India' };
  if (!opts.detail) return base;
  // detail: identity, academic, English, work (only fields from 1.10)
  const pass = U.passportOf(s);
  const acad = all(`SELECT * FROM academic_records WHERE student_id = ? AND is_deleted = 0 ORDER BY CASE level WHEN '10th' THEN 1 WHEN '12th' THEN 2 WHEN 'Diploma' THEN 3 WHEN 'Bachelor' THEN 4 WHEN 'Master' THEN 5 ELSE 6 END`, s.id);
  const factor = Number(getSetting('cgpa_factor') || 9.5);
  const pctOf = (r) => r.score === null || r.score === undefined ? null : r.score_type === 'CGPA4' ? Number(r.score) * 25 : /CGPA/.test(r.score_type || '') ? Math.round(Number(r.score) * factor * 10) / 10 : Number(r.score);
  const tests = all('SELECT * FROM english_tests WHERE student_id = ? AND is_deleted = 0', s.id);
  const work = all('SELECT * FROM work_experience WHERE student_id = ? AND is_deleted = 0 ORDER BY from_month', s.id);
  // mini assessment line without budget and without the student's other preferred countries / courses (1.9 #2, #6)
  const summary = S.academicSummary(s.id).line.split(' | ').filter(p => !/^(Country|Course):/.test(p)).join(' | ');
  const out = { ...base,
    identity: { first_name: s.first_name, middle_name: s.middle_name, last_name: s.last_name, gender: s.gender, dob: s.dob, nationality: s.nationality,
      passport: pass ? (u.share_passport ? pass : maskPass(pass)) : null, passport_masked: !u.share_passport, passport_expiry: s.passport_expiry, city: s.city, state: STATE_OF(s), country: base.country },
    summary_line: summary, cover_note: ua.cover_note, expected_decision: ua.expected_decision,
    academic: acad.map(r => ({ level: r.level, course: r.course_name, board: r.board_university || r.institution, score: r.score, scale: r.score_type || '%', percent: pctOf(r), year: r.pass_year,
      backlogs_total: r.backlogs_total, backlogs_active: r.backlogs_active })),
    english: tests.map(t => ({ test: t.test_type, overall: t.overall, listening: t.listening, reading: t.reading, writing: t.writing, speaking: t.speaking, date: t.test_date, trf: t.reference_no })).filter(t => t.test !== 'Not taken yet'),
    work: work.map(w => ({ company: w.company, designation: w.designation, from: w.from_month, to: w.till_date ? null : w.to_month, till_date: !!w.till_date })),
    work_total: work.length ? S.workExperienceTotal(work).label : null,
    la_europa_contacts: laEuropaContact(a, s), partner_manager: u.partner_manager_id ? (get('SELECT name, email, mobile phone FROM users WHERE id = ?', u.partner_manager_id) || null) : null,
    offer: offerOut(ua), interview: a.interview_at ? { at: a.interview_at, link: a.interview_link } : null,
    contact: u.share_contact ? { phone: `${s.country_code || ''} ${s.phone || ''}`.trim(), email: s.email } : null,
    visa_outcome: u.share_visa ? visaOutcome(s.id) : undefined };
  return out;
}
function visaOutcome(studentId) {
  const v = get(`SELECT stage, decision_date, updated_at FROM visa_cases WHERE student_id = ? AND is_deleted = 0 AND stage IN ('approved','rejected') ORDER BY updated_at DESC LIMIT 1`, studentId);
  return v ? { outcome: v.stage === 'approved' ? 'Visa approved' : 'Visa refused', date: v.decision_date || v.updated_at } : null;
}
function offerOut(ua) {
  const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id);
  if (!['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(ua.status) && !a.offer_type) return null;
  const conds = all('SELECT id, text, status FROM offer_conditions WHERE application_id = ? AND is_deleted = 0', a.id);
  const letters = all('SELECT id, type, issue_date, created_at FROM offer_letters WHERE uapp_id = ? ORDER BY created_at DESC', ua.id);
  const fee = get(`SELECT total_amount, currency, scholarship, deposit_required, deposit_deadline FROM fee_summaries WHERE application_id = ? AND fee_kind = 'tuition' AND is_deleted = 0`, a.id);
  return { type: a.offer_type, deadline: a.offer_deadline, conditions: conds, letters, fee: fee || null };
}

// helper: La Europa staff who handle an application
function handlers(app) { const s = get('SELECT primary_counsellor_id, application_user_id FROM students WHERE id = ?', app.student_id); return [...new Set([s.primary_counsellor_id, app.handled_by || s.application_user_id].filter(Boolean))]; }

module.exports = { COOKIE, ROLE_LABEL, NotFound, gs, STATUSES, STAGE_OF, ALLOWED, CLOSED, canMove, FEE_WORDS, feeWordCheck, feeWordNear, uaudit, usersOf, unotify, notifyUni,
  uni, uniName, shortName, activeAgreement, appView, offerOut, handlers, parseJ, maskPass, visaOutcome, decrypt };
