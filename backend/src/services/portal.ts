import crypto from 'crypto';
import type { Types } from 'mongoose';
import type { AuthRequest } from '../middleware/auth';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import Student from '../models/Student';
import { ApplicationRequest, ChatMessage, SavedCourse, REQUEST_OPEN } from '../models/Portal';
import Task from '../models/Task';
import { bad, istDate, timeline } from './crm';
import { trigger, studentNotify } from './email';
import { getSetting } from '../models/Audit';
import { env } from '../config/env';

/** The student's portal login (the client's student_users), shared by the CRM side and the portal. */

export const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const live = { role: 'student', status: { $ne: 'Deactivated' } };
export const suOfStudent = (studentId: unknown) => PortalAccount.findOne({ ...live, studentId });
export const suOfLead = (leadId: unknown) => PortalAccount.findOne({ ...live, leadId });
export async function notifyStudent(studentId: unknown, title: string, link?: string) {
  const su = await suOfStudent(studentId);
  if (su) await studentNotify(su._id, title, link);
}

export function portalInfo(su?: IPortalAccount | null) {
  if (!su) return { status: 'Not invited' };
  const status = su.status === 'Active' ? 'Active' : su.status === 'Pending verification' ? 'Invited' : su.status;
  return { id: String(su._id), status, last_login: su.lastSeenAt ?? null, completion: su.completionPercent ?? 0, profile_submitted_at: su.profileSubmittedAt ?? null,
    signup_method: su.signupMethod ?? null, invite_expires_at: su.inviteExpiresAt ?? null, email_verified: !!su.emailVerifiedAt, mobile_verified: !!su.mobileVerifiedAt };
}

/** E26: a 7-day invite link; at most 5 a day per student. */
export async function issueInvite(studentId: Types.ObjectId, byUserId: string) {
  const s = await Student.findOne({ _id: studentId, is_deleted: false });
  if (!s?.email) throw bad('The student needs a valid email before an invite can be sent');
  let su = await suOfStudent(s._id);
  if (su && su.status === 'Active') throw bad('This student already has an active portal account');
  const today = istDate();
  if (su && su.inviteDay === today && (su.inviteSentCount ?? 0) >= 5) throw bad('Maximum 5 invites per day for this student');
  const token = crypto.randomBytes(32).toString('base64url');
  const fields = { inviteTokenHash: sha(token), inviteExpiresAt: new Date(Date.now() + 7 * 864e5), inviteDay: today, inviteSentCount: su && su.inviteDay === today ? (su.inviteSentCount ?? 0) + 1 : 1 };
  if (su) { su.set(fields); await su.save(); }
  else {
    su = await PortalAccount.create({ role: 'student', name: [s.first_name, s.last_name].filter(Boolean).join(' '), email: s.email, studentId: s._id, leadId: s.lead_id,
      countryCode: s.country_code, phone: s.phone, phoneNormalised: s.phone_normalised, signupMethod: 'invite', status: 'Pending verification',
      password: crypto.randomBytes(24).toString('base64url'), referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(), ...fields });
  }
  await Student.updateOne({ _id: s._id }, { portal_status: 'Invited' });
  const link = `${env.portalUrl}/invite/${token}`;
  await trigger('E26', { student_id: s._id, userId: byUserId, ctx: { portal_invite_link: link }, noInApp: true, immediate: true });
  await timeline({ student_id: s._id, type: 'email', description: 'Student portal invite sent (E26)', user_id: byUserId });
  return { link };
}
export async function autoInvite(req: AuthRequest, studentId: Types.ObjectId) {
  if ((await getSetting('auto_invite')) !== '1') return;
  const su = await suOfStudent(studentId);
  if (su?.status === 'Active') return;
  await issueInvite(studentId, req.user!.id).catch(() => { /* no email yet: the counsellor can invite later */ });
}

/** Convert to Student: the lead's portal login, saved courses, requests and chat move to the new student file. */
export async function linkOnConvert(req: AuthRequest, leadId: Types.ObjectId, studentId: Types.ObjectId) {
  const su = await suOfLead(leadId);
  if (!su) return;
  su.studentId = studentId; await su.save();
  await Student.updateOne({ _id: studentId, email: { $in: [null, ''] } }, { email: su.email });
  await Student.updateOne({ _id: studentId }, { portal_status: 'Active' });
  await SavedCourse.updateMany({ student_user_id: su._id }, { student_id: studentId });
  await ApplicationRequest.updateMany({ student_user_id: su._id }, { student_id: studentId });
  await ChatMessage.updateMany({ lead_id: leadId, student_id: null }, { student_id: studentId });
  for (const q of await ApplicationRequest.find({ student_user_id: su._id, status: { $in: REQUEST_OPEN } }).select('_id').lean()) {
    const t = await Task.findOne({ system_key: `request:${q._id}` });
    if (t) { t.set({ student_id: studentId, title: t.title.replace('Register student first: ', 'Review ') }); await t.save(); }
  }
  const s = await Student.findById(studentId).select('student_code').lean();
  await studentNotify(su._id, `You are now registered with La Europa. Your student ID is ${s?.student_code}.`, '/home');
  await timeline({ student_id: studentId, type: 'profile', description: 'Portal account linked to the new student file (saved courses, requests and chat moved)', user_id: req.user!.id });
}
