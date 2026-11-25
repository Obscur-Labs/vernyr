import type { Request } from 'express';
import type { Types } from 'mongoose';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import Student, { type IStudent } from '../models/Student';
import Lead, { type ILead } from '../models/Lead';
import User from '../models/User';
import { AuditLog, getSetting } from '../models/Audit';
import { Timeline } from '../models/Timeline';
import { Shortlist, Application, VisaCase, StudentDocument } from '../models/Work';
import { MasterItem } from '../models/Master';
import University from '../models/University';
import { fullName, istDate } from './crm';
import { notify, notifyAdmins } from './tasks';

/** Shared helpers for the student portal and the CRM screens that show portal data (legacy/server/portal/common.js). */

export interface Ctx { su: IPortalAccount; student: IStudent | null; lead: ILead | null; counsellorId: Types.ObjectId | null; readOnly: boolean }
export async function loadCtx(su: IPortalAccount): Promise<Ctx> {
  const student = su.studentId ? await Student.findOne({ _id: su.studentId, is_deleted: false }) : null;
  const lead = !student && su.leadId ? await Lead.findOne({ _id: su.leadId, is_deleted: false }) : su.leadId ? await Lead.findById(su.leadId) : null;
  return { su, student, lead, counsellorId: (student?.primary_counsellor_id ?? lead?.assigned_user_id ?? null) as Types.ObjectId | null,
    readOnly: su.status === 'Read only' || !!(student && ['Dropped', 'Archived'].includes(student.status)) };
}
/** The context of a student file when no portal account exists yet (CRM editing). */
export async function ctxForStudent(student: IStudent): Promise<Ctx> {
  const su = (await PortalAccount.findOne({ studentId: student._id, role: 'student' }).sort({ createdAt: 1 }))
    ?? new PortalAccount({ role: 'student', name: fullName(student), studentId: student._id, password: 'not-a-login', status: 'None',
      flags: (student.info_extra as { profile_flags?: Record<string, unknown> } | undefined)?.profile_flags ?? {} });
  return { su, student, lead: null, counsellorId: (student.primary_counsellor_id ?? null) as Types.ObjectId | null, readOnly: false };
}
export const displayName = (c: Pick<Ctx, 'student' | 'lead'>) => c.student ? fullName(c.student) : c.lead ? [c.lead.first_name, c.lead.last_name].filter(Boolean).join(' ') : 'Student';
export const studentCode = (c: Pick<Ctx, 'student' | 'lead'>) => c.student?.student_code ?? c.lead?.lead_code ?? '';

/** A timeline line written by the student (no staff user). */
export const studentTimeline = (student_id: unknown, lead_id: unknown, type: string, description: string) =>
  Timeline.create({ student_id: student_id ?? undefined, lead_id: student_id ? undefined : lead_id ?? undefined, type, description, data: { actor_type: 'student' } });
export async function portalAudit(req: Request & { su?: { _id: unknown } }, action: string, entityType: string, entityId: unknown, label: string, oldV?: unknown, newV?: unknown) {
  await AuditLog.create({ user_id: req.su?._id, action, entity_type: entityType, entity_id: entityId ? String(entityId) : undefined, entity_label: label, old_value: oldV, new_value: newV,
    ip: req.ip, user_agent: String(req.headers?.['user-agent'] ?? '').slice(0, 300), actor_type: 'student' }).catch(() => {});
}
/** Tell the staff who handle this student; nobody assigned = the admins. */
export async function notifyStaff(c: Ctx, type: string, title: string, link?: string) {
  const href = link ?? (c.student ? `/students/${c.student._id}` : c.lead ? `/leads/${c.lead._id}` : null);
  if (c.counsellorId) await notify(c.counsellorId, type, title, href);
  else await notifyAdmins(type, title, href);
}

// ---------- profile completion (3.9) ----------
export async function completion(c: Ctx) {
  const { readAll } = await import('./profile');
  let w: Record<string, number> = {};
  try { w = JSON.parse(String((await getSetting('completion_weights')) ?? '{}')); } catch { /* defaults */ }
  const p = await readAll(c);
  const parts: { key: string; ok: boolean; weight: number; label: string; link: string }[] = [];
  const add = (key: string, ok: unknown, label: string, link: string, wt = w[key] || 0) => parts.push({ key, ok: !!ok, weight: wt, label, link });
  const pe = p.personal;
  add('personal', pe.first_name && (pe.last_name || pe.no_surname) && pe.gender && pe.dob && pe.nationality && pe.marital_status, 'Complete your personal details', '/wizard/1');
  parts.push({ key: 'email_verified', ok: !!c.su.emailVerifiedAt, weight: w.verified || 10, label: 'Verify your email', link: '/settings' });
  const pp = p.passport;
  add('passport', pp.has_passport === false || (pp.passport && pp.passport_issue && pp.passport_expiry), 'Add your passport details', '/wizard/2');
  const passportType = await MasterItem.findOne({ type: 'document_type', name: 'Passport' }).select('_id').lean();
  const passportDoc = c.student && passportType ? await StudentDocument.exists({ student_id: c.student._id, document_type_id: passportType._id, is_deleted: false, status: { $in: ['Uploaded', 'Verified'] } }) : null;
  add('passport_upload', passportDoc, 'Upload your passport copy', '/documents');
  const ac = p.academic;
  const t10 = ac.records.find((r) => r.level === '10th' && r.score != null && r.pass_year);
  const t12 = ac.records.find((r) => (r.level === '12th' || r.level === 'Diploma') && r.score != null && r.pass_year && r.board_university);
  add('school', t10 && (t12 || ac.last_education === '10th'), ac.last_education === '10th' ? 'Add your 10th details' : 'Add your 10th and 12th details', '/wizard/3');
  const bach = ac.records.find((r) => r.level === 'Bachelor');
  add('degree', ac.has_bachelor === false || (bach && bach.course_name && bach.score != null && bach.pass_year && bach.backlogs_total != null), 'Add your Bachelor details', '/wizard/3');
  add('work', p.work.has_work === false || p.work.rows.length > 0, 'Add your work experience', '/wizard/4');
  add('english', p.english.tests.some((t) => t.overall != null || (t.test_type === 'Not taken yet' && t.planned_date) || t.test_type === 'MOI (waiver)'), 'Add your English test score', '/wizard/5');
  const pr = p.preferences;
  add('preferences', pr.country_ids?.[0] && pr.course && pr.level && pr.intake_id, 'Add your study preferences', '/wizard/6');
  add('photo', c.su.avatar, 'Add a profile photo', '/profile');
  add('submitted', c.su.profileSubmittedAt, 'Submit your profile', '/wizard/7');
  const total = parts.reduce((n, x) => n + x.weight, 0) || 100;
  const pct = Math.round(parts.filter((x) => x.ok).reduce((n, x) => n + x.weight, 0) / total * 100);
  const next = parts.find((x) => !x.ok);
  if (!c.su.isNew) await PortalAccount.updateOne({ _id: c.su._id }, { completionPercent: pct });
  if (c.student) await Student.updateOne({ _id: c.student._id }, { completion_percent: pct });
  return { percent: pct, next: next ? { label: `${next.label} (+${Math.round(next.weight / total * 100)}%)`, link: next.link } : null, parts };
}

// ---------- journey progress (4.3) ----------
export async function journey(c: Ctx) {
  const steps = ['Inquiry', 'Profile', 'Shortlist', 'Applied', 'Offer', 'Fee Paid', 'Visa', 'Enrolled'];
  let cur = 0, visaWarn = false;
  let text = c.su.profileSubmittedAt ? 'Your counsellor is reviewing your profile.' : 'Complete your profile so your counsellor can assess it.';
  const s = c.student;
  const uni = async (id: unknown) => (id ? (await University.findById(id).select('name').lean())?.name ?? 'the university' : 'the university');
  let approved = false;
  if (s) {
    if (c.su.profileSubmittedAt) { cur = 1; text = 'Your counsellor will share course options with you.'; }
    if (await Shortlist.exists({ student_id: s._id, is_deleted: false, status: { $in: ['Shared with student', 'Student agreed', 'Converted to application'] } })) { cur = Math.max(cur, 2); text = 'Check your shortlist and tell us which courses you like.'; }
    const apps = await Application.find({ student_id: s._id, is_deleted: false }).select('stage university_id').lean();
    const live = apps.filter((a) => !['rejected', 'withdrawn', 'offer_declined'].includes(a.stage));
    const has = (st: string[]) => live.find((a) => st.includes(a.stage));
    if (apps.length && !live.length) { cur = Math.max(cur, 2); text = 'Your counsellor will discuss other options with you.'; }
    if (has(['documents_pending', 'ready_to_apply'])) text = 'Next step: upload your remaining documents.';
    const ap = has(['applied', 'under_review', 'interview']);
    if (ap) { cur = Math.max(cur, 3); text = `Your application to ${await uni(ap.university_id)} is under review.`; }
    const of = has(['conditional_offer', 'unconditional_offer', 'offer_accepted']);
    if (of) { cur = Math.max(cur, 4); text = `You have an offer from ${await uni(of.university_id)}.`; }
    if (has(['tuition_paid'])) { cur = Math.max(cur, 5); text = 'Your fee payment is recorded.'; }
    const visa = await VisaCase.findOne({ student_id: s._id, is_deleted: false }).sort({ attempt_no: -1, createdAt: -1 }).select('stage').lean();
    approved = !!(await VisaCase.exists({ student_id: s._id, stage: 'approved', is_deleted: false }));
    if (visa) { cur = Math.max(cur, 6); text = visa.stage === 'approved' ? 'Your visa is approved.' : 'Your visa process is in progress.'; if (visa.stage === 'rejected') { visaWarn = true; text = 'Visa update: please check the Visa page.'; } }
    if ((has(['enrolment_confirmed']) && visa?.stage === 'approved') || s.status === 'Enrolled') { cur = 7; text = 'You are enrolled. Congratulations!'; }
    else if (has(['enrolment_confirmed']) && !visa) { cur = Math.max(cur, 5); text = 'Your admission is confirmed. We will now focus on your visa.'; }
  }
  return { steps, current: cur, text, visa_warning: visaWarn, visa_approved: approved };
}

/** The counsellor card (4.2): the Counsellor ID, never the counsellor's personal email. */
export async function counsellorCard(c: Ctx) {
  const u = c.counsellorId ? await User.findById(c.counsellorId).select('name designation phone staff_code avatar').lean() : null;
  const card = u ? { id: String(u._id), name: u.name, designation: u.designation ?? null, phone: u.phone ?? null, counsellor_id: u.staff_code ?? null, has_photo: !!u.avatar,
    whatsapp: u.phone ? `https://wa.me/${String(u.phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${u.name.split(' ')[0]}, this is ${displayName(c)} (${studentCode(c)})`)}` : null } : null;
  return { counsellor: card, team: [], office_hours: (await getSetting('office_hours_text')) ?? null, online: await isOfficeHours() };
}
export async function isOfficeHours(d = new Date()) {
  const hm = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  const dow = new Date(istDate(d) + 'T00:00:00Z').getUTCDay();
  const days = String((await getSetting('office_days')) ?? '1,2,3,4,5,6').split(',').map(Number);
  return days.includes(dow) && hm >= String((await getSetting('office_start')) ?? '10:00') && hm < String((await getSetting('office_end')) ?? '19:00');
}
