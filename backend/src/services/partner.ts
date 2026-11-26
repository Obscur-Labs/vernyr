import type { Request } from 'express';
import { Types } from 'mongoose';
import University, { type IUniversity } from '../models/University';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import Student from '../models/Student';
import User from '../models/User';
import { AuditLog, getSetting } from '../models/Audit';
import { Application, FeeSummary, VisaCase } from '../models/Work';
import { OfferCondition } from '../models/Portal';
import { Campus, OfferLetter, PartnerAgreement, UniNotification } from '../models/Partner';
import { Intake } from '../models/Master';
import Course from '../models/Course';
import { HttpError, fullName, istDate } from './crm';
import { academicSummary, passportOf, workExperienceTotal } from './students';

/** Shared helpers for the university partner portal (legacy/server/university/common.js). */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = Record<string, any>;
export const ROLE_LABEL: Record<string, string> = { admin: 'University Admin', officer: 'Admissions Officer', viewer: 'University Viewer' };
export const NotFound = () => new HttpError(404, 'Not found');
export const gs = async (k: string, d: string) => { const v = await getSetting(k); return v === undefined || v === null || v === '' ? d : v; };

// ---------- statuses (6.2) ----------
export const STATUSES = ['New', 'Acknowledged', 'Documents requested', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer',
  'Rejected', 'Offer accepted', 'Deposit received', 'Enrolled', 'Withdrawn'];
export const STAGE_OF: Record<string, string> = { New: 'applied', Acknowledged: 'under_review', 'Documents requested': 'under_review', 'Under assessment': 'under_review', 'Interview scheduled': 'interview',
  Waitlisted: 'under_review', 'Conditional offer': 'conditional_offer', 'Unconditional offer': 'unconditional_offer', Rejected: 'rejected', 'Offer accepted': 'offer_accepted',
  'Deposit received': 'tuition_paid', Enrolled: 'enrolment_confirmed', Withdrawn: 'withdrawn' };
export const ALLOWED: Record<string, string[]> = {
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
  Rejected: [], Enrolled: [], Withdrawn: [],
};
export const CLOSED = ['Rejected', 'Enrolled', 'Withdrawn'];
export const canMove = (from: string, to: string) => (ALLOWED[from] || []).includes(to);

// ---------- fee word filter (4.6 V1) ----------
export const FEE_WORDS = /(non[\s.-]*eu|eu[\s.-]*\/[\s.-]*eea|\beea\b|international|foreign|overseas)/i;
export function feeWordCheck(fields: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v && FEE_WORDS.test(String(v))) errors[k] = 'Please enter only the amount. Words like non-EU, international or foreign are not allowed in fee fields.';
  return errors;
}
export const feeWordNear = (text?: string | null) => /(non[\s.-]*eu|international|foreign|overseas)\s*(tuition|fee|fees)|(tuition|fee|fees)\s*(for)?\s*(non[\s.-]*eu|international|foreign|overseas)/i.test(String(text || ''));

// ---------- audit (14.5) ----------
export type UniReq = Request & { su?: IPortalAccount; uni?: IUniversity; user?: { id: string; role: string; name: string }; preview?: boolean; previewBy?: string; campuses?: string[]; auditAccountId?: unknown };
export async function uaudit(req: UniReq | null, action: string, entityType?: string | null, entityId?: unknown, label?: string | null, oldV?: unknown, newV?: unknown, universityId?: unknown) {
  try {
    const uniActor = !!(req?.su || req?.auditAccountId);
    await AuditLog.create({ user_id: req?.su?._id ?? req?.auditAccountId ?? req?.user?.id, action, entity_type: entityType ?? undefined, entity_id: entityId ? String(entityId) : undefined,
      entity_label: label ?? undefined, old_value: oldV, new_value: newV, ip: req?.ip, user_agent: req?.headers ? String(req.headers['user-agent'] ?? '').slice(0, 300) : undefined,
      actor_type: uniActor ? 'university' : 'staff', university_id: universityId ?? req?.su?.universityId ?? undefined });
  } catch { /* an audit failure never breaks the request */ }
}

// ---------- university users and notifications ----------
export async function usersOf(universityId: unknown, o: { roles?: string[]; alert?: string; finance?: boolean; campusId?: unknown } = {}) {
  const rows = (await PortalAccount.find({ role: 'university', universityId, status: 'Active', isActive: true }).lean()) as Any;
  return rows.filter((u: Any) => {
    if (o.roles && !o.roles.includes(u.uniRole ?? '')) return false;
    if (o.finance && !(u.finance || u.uniRole === 'admin')) return false;
    const camps = (u.campuses ?? []).map(String);
    if (o.campusId && camps.length && !camps.includes(String(o.campusId))) return false;
    if (o.alert) { const on = u.alerts ? u.alerts.includes(o.alert) : true; if (!on && !(u.isMainContact && ['applications', 'finance'].includes(o.alert))) return false; }
    return true;
  });
}
export async function unotify(ids: unknown[], title: string, link?: string | null) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  if (uniq.length) await UniNotification.insertMany(uniq.map((id) => ({ account_id: id, title: String(title).slice(0, 300), link: link || undefined })));
}
export async function notifyUni(universityId: unknown, filter: Parameters<typeof usersOf>[1], title: string, link?: string | null) {
  await unotify((await usersOf(universityId, filter)).map((u: Any) => u._id), title, link);
}

// ---------- per-university settings ----------
export const uni = (id: unknown) => University.findById(id);
export const uniName = (u?: Pick<IUniversity, 'display_name' | 'name'> | null) => (u && (u.display_name || u.name)) || '';
export const shortName = (u?: Pick<IUniversity, 'short_name' | 'display_name' | 'name'> | null) => (u && (u.short_name || u.display_name || u.name)) || '';
export async function activeAgreement(universityId: unknown) {
  const today = istDate();
  return PartnerAgreement.findOne({ university_id: universityId, is_deleted: false, status: { $in: ['Active', 'Expiring soon'] }, start_date: { $lte: today }, $or: [{ end_date: null }, { end_date: { $exists: false } }, { end_date: { $gte: today } }] }).sort({ start_date: -1 }).lean();
}

// ---------- the student's application as the university may see it (1.10, whitelisted) ----------
export const maskPass = (p?: string | null) => (p ? String(p).slice(0, 3) + 'X'.repeat(Math.max(0, String(p).length - 4)) + String(p).slice(-1) : null);
const nameOf = async (model: 'intake' | 'course', id: unknown) => (id ? (model === 'intake' ? (await Intake.findById(id).select('name').lean())?.name : (await Course.findById(id).select('name').lean())?.name) ?? '' : '');
async function laEuropaContacts(app: Any, s: Any) {
  const ids = [...new Set([s.primary_counsellor_id, app.handled_by].filter(Boolean).map(String))];
  return (await User.find({ _id: { $in: ids } }).select('name email mobile').lean()).map((u: Any) => ({ name: u.name, email: u.email, phone: u.mobile || null }));
}
export async function visaOutcome(studentId: unknown) {
  const v = (await VisaCase.findOne({ student_id: studentId, is_deleted: false, stage: { $in: ['approved', 'rejected'] } }).sort({ updatedAt: -1 }).lean()) as Any;
  return v ? { outcome: v.stage === 'approved' ? 'Visa approved' : 'Visa refused', date: v.decision_date || v.updatedAt } : null;
}
export async function offerOut(ua: Any) {
  const a = (await Application.findById(ua.application_id).lean()) as Any;
  if (!a || (!['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(ua.status) && !a.offer_type)) return null;
  const conds = (await OfferCondition.find({ application_id: a._id, is_deleted: false }).lean()).map((c: Any) => ({ id: String(c._id), text: c.text, status: c.status }));
  const letters = (await OfferLetter.find({ uapp_id: ua._id }).sort({ createdAt: -1 }).lean()).map((l: Any) => ({ id: String(l._id), type: l.type, issue_date: l.issue_date, created_at: l.createdAt }));
  const fee = (await FeeSummary.findOne({ application_id: a._id, fee_kind: 'tuition', is_deleted: false }).select('total_amount currency scholarship deposit_required deposit_deadline').lean()) as Any;
  return { type: a.offer_type ?? null, deadline: a.offer_deadline ?? null, conditions: conds, letters, fee: fee ? { total_amount: fee.total_amount, currency: fee.currency, scholarship: fee.scholarship, deposit_required: fee.deposit_required, deposit_deadline: fee.deposit_deadline } : null };
}
export async function appView(ua: Any, opts: { detail?: boolean } = {}) {
  const a = (await Application.findById(ua.application_id).lean()) as Any;
  const s = (await Student.findById(a.student_id).lean()) as Any;
  const u = (await University.findById(ua.university_id).lean()) as Any;
  const campus = (ua.campus_id ? (await Campus.findById(ua.campus_id).select('name city').lean()) : null) as Any;
  const daysIn = Math.max(0, Math.floor((Date.now() - new Date(ua.status_changed_at || ua.submitted_at || ua.createdAt).getTime()) / 864e5));
  const base = { id: String(ua._id), application_code: a.application_code, student_name: fullName(s), course: a.course_name_text || (await nameOf('course', a.course_id)), course_id: a.course_id ? String(a.course_id) : null,
    level: a.level, campus: campus?.name ?? null, intake: await nameOf('intake', a.intake_id), intake_id: a.intake_id ? String(a.intake_id) : null, submitted_at: ua.submitted_at, status: ua.status, days_in_status: daysIn,
    university_ref: ua.university_ref ?? null, flags: { docs_requested: !!ua.flag_docs_requested, waitlisted: !!ua.flag_waitlisted }, version: ua.version, withdrawn_at: ua.withdrawn_at ?? null,
    state: s.state ?? null, country: s.country_of_residence || 'India' };
  if (!opts.detail) return base;
  const pass = passportOf(s);
  const factor = Number((await getSetting('cgpa_factor')) || 9.5);
  const ORDER: Record<string, number> = { '10th': 1, '12th': 2, Diploma: 3, Bachelor: 4, Master: 5 };
  const pctOf = (r: Any) => (r.score === null || r.score === undefined ? null : r.score_type === 'CGPA4' ? Number(r.score) * 25 : /CGPA/.test(r.score_type || '') ? Math.round(Number(r.score) * factor * 10) / 10 : Number(r.score));
  // the assessment line without budget and without the student's other preferred countries / courses (1.9 #2, #6)
  const summary = (await academicSummary(s as never)).line.split(' | ').filter((p: string) => !/^(Country|Course):/.test(p)).join(' | ');
  const pm = (u.partner_manager_id ? (await User.findById(u.partner_manager_id).select('name email mobile').lean()) : null) as Any;
  return { ...base,
    identity: { first_name: s.first_name, middle_name: s.middle_name, last_name: s.last_name, gender: s.gender, dob: s.dob, nationality: s.nationality,
      passport: pass ? (u.share_passport ? pass : maskPass(pass)) : null, passport_masked: !u.share_passport, passport_expiry: s.passport_expiry, city: s.city, state: s.state ?? null, country: base.country },
    summary_line: summary, cover_note: ua.cover_note ?? null, expected_decision: ua.expected_decision ?? null,
    academic: [...(s.academics ?? [])].sort((x: Any, y: Any) => (ORDER[x.level] ?? 6) - (ORDER[y.level] ?? 6)).map((r: Any) => ({ level: r.level, course: r.course_name, board: r.board_university || r.institution,
      score: r.score, scale: r.score_type || '%', percent: pctOf(r), year: r.pass_year, backlogs_total: r.backlogs_total, backlogs_active: r.backlogs_active })),
    english: (s.tests ?? []).filter((t: Any) => t.test_type !== 'Not taken yet').map((t: Any) => ({ test: t.test_type, overall: t.overall, listening: t.listening, reading: t.reading, writing: t.writing, speaking: t.speaking, date: t.test_date, trf: t.reference_no })),
    work: (s.work ?? []).map((w: Any) => ({ company: w.company, designation: w.designation, from: w.from_month, to: w.till_date ? null : w.to_month, till_date: !!w.till_date })),
    work_total: (s.work ?? []).length ? workExperienceTotal(s.work).label : null,
    la_europa_contacts: await laEuropaContacts(a, s), partner_manager: pm ? { name: pm.name, email: pm.email, phone: pm.mobile ?? null } : null,
    offer: await offerOut(ua), interview: a.interview_at ? { at: a.interview_at, link: a.interview_link } : null,
    contact: u.share_contact ? { phone: `${s.country_code || ''} ${s.phone || ''}`.trim(), email: s.email } : null,
    visa_outcome: u.share_visa ? await visaOutcome(s._id) : undefined };
}
/** La Europa staff who handle an application */
export async function handlers(app: Any) {
  const s = (await Student.findById(app.student_id).select('primary_counsellor_id').lean()) as Any;
  return [...new Set([s?.primary_counsellor_id, app.handled_by].filter(Boolean).map(String))].map((x) => new Types.ObjectId(x));
}
