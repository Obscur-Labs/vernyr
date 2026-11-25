import User from '../models/User';
import Student from '../models/Student';
import Lead from '../models/Lead';
import Task from '../models/Task';
import University from '../models/University';
import Course from '../models/Course';
import PortalAccount from '../models/PortalAccount';
import Notification from '../models/Notification';
import { Application, FeeSummary, Payment, Shortlist, VisaCase } from '../models/Work';
import { ApplicationRequest, ChatMessage, DataExportRequest, PaymentSubmission } from '../models/Portal';
import { PrivacyRequest } from '../models/Privacy';
import { EmailLog } from '../models/Email';
import { ReminderSent } from '../models/Console';
import { getSetting } from '../models/Audit';
import { istDate, istDayStart, addDays, fmtTime, fmtDateTime, fullName } from './crm';
import { fmtDate } from './invoicePdf';
import { notify, notifyAdmins } from './tasks';
import { trigger, studentNotify } from './email';
import { suOfStudent } from './portal';
import { expire as expirePromotions, creditReferrals } from './rewards';
import { regVal } from './console';
import { emailAlert, announcementJob } from '../routes/consoleComms';
import { scheduledReportsJob, qualityScan } from '../routes/consoleInsights';
import { scanDuplicates } from '../routes/consolePeople';
import { approvalItems } from '../routes/console';
import type { AuthRequest } from '../middleware/auth';

/** Background jobs (legacy/server/jobs.js + admin5/jobs.js): reminders every minute, digests at 9 AM IST, nightly scans at 2 AM IST, hourly cleanup. */

/** true the first time a key is seen; the reminder is then never sent again. */
async function once(key: string) {
  try { await ReminderSent.create({ key }); return true; } catch { return false; }
}
const istHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
const weekday = (ymd: string) => new Date(ymd + 'T00:00:00Z').getUTCDay();
const uniNames = async (ids: unknown[]) => new Map((await University.find({ _id: { $in: ids } }).select('name').lean()).map((u) => [String(u._id), u.name]));
const OPEN = { $in: ['Open', 'In progress'] };
const REM_OFFSET: Record<string, number> = { 'At due time': 0, '15 min': 15, '1 hour': 60, '1 day before': 1440 };

export async function reminders() {
  const t = Date.now();
  // lead follow-ups: 30 minutes before and at the time
  for (const l of await Lead.find({ is_deleted: false, status: { $nin: ['Converted', 'Not interested'] }, next_followup_at: { $lte: new Date(t + 30 * 60e3), $gte: new Date(t - 6 * 3600e3) } }).lean()) {
    const at = +l.next_followup_at!;
    const name = [l.first_name, l.last_name].filter(Boolean).join(' ');
    const k = `${l._id}:${l.next_followup_at!.toISOString()}`;
    if (at - t <= 30 * 60e3 && at > t && (await once(`fu30:${k}`))) await notify(l.assigned_user_id, 'followup_due', `Follow-up in 30 minutes: ${name} (${fmtTime(l.next_followup_at!)})`, `/leads/${l._id}`);
    if (at <= t && (await once(`fu0:${k}`))) await notify(l.assigned_user_id, 'followup_due', `Follow-up due now: ${name} (${l.country_code ?? ''} ${l.phone})`.replace('( ', '('), `/leads/${l._id}`);
  }
  // staff tasks: reminder time, due time, overdue
  for (const k of await Task.find({ is_deleted: false, status: OPEN, due_at: { $lte: new Date(t + 1441 * 60e3) }, type: { $ne: 'Student action' } }).lean()) {
    const due = +k.due_at;
    const off = REM_OFFSET[k.reminder ?? ''];
    const link = k.student_id ? `/students/${k.student_id}/tasks` : k.lead_id ? `/leads/${k.lead_id}` : '/tasks';
    const key = `task:${k._id}:${k.due_at.toISOString()}`;
    if (off > 0 && due - t <= off * 60e3 && due > t && (await once(`${key}:rem`))) await notify(k.assigned_to, 'task_due', `Reminder: ${k.title} is due ${fmtDateTime(k.due_at)}`, link);
    if (due <= t && due > t - 3600e3 && (await once(`${key}:due`))) await notify(k.assigned_to, 'task_due', `Task due now: ${k.title}`, link);
    if (due <= t - 60e3 && (await once(`${key}:overdue`))) {
      await notify(k.assigned_to, 'task_overdue', `Task overdue: ${k.title}`, link);
      const creator = k.assigned_by ?? k.created_by;
      if (creator && String(creator) !== String(k.assigned_to) && !k.is_system) {
        const who = (await User.findById(k.assigned_to).select('name').lean())?.name ?? '';
        await notify(creator, 'task_overdue', `Task you assigned is overdue: ${k.title} (${who})`, link);
      }
    }
  }
}

/** 9 AM IST: each person's follow-ups and overdue tasks, deadlines, visa appointments tomorrow, email health; Monday: passports. */
export async function daily() {
  const today = istDate();
  if (istHour() < 9 || !(await once(`daily:${today}`))) return;
  const t0 = istDayStart(today), t1 = istDayStart(addDays(today, 1));
  const live = { status: { $nin: ['Converted', 'Not interested'] }, is_deleted: false };
  for (const u of await User.find({ isActive: true }).select('_id').lean()) {
    const fuToday = await Lead.countDocuments({ ...live, assigned_user_id: u._id, next_followup_at: { $gte: t0, $lt: t1 } });
    const fuOver = await Lead.countDocuments({ ...live, assigned_user_id: u._id, next_followup_at: { $lt: t0 } });
    if (fuToday || fuOver) await notify(u._id, 'followup_summary', `You have ${fuToday} follow-up(s) today and ${fuOver} overdue.`, '/leads?followup=today');
    const tOver = await Task.countDocuments({ is_deleted: false, assigned_to: u._id, status: OPEN, due_at: { $lt: new Date() } });
    if (tOver) await notify(u._id, 'task_overdue', `You have ${tOver} overdue task(s).`, '/tasks?tab=overdue');
  }
  const owners = async (ids: unknown[]) => new Map((await Student.find({ _id: { $in: ids }, is_deleted: false }).select('first_name middle_name last_name primary_counsellor_id').lean()).map((s) => [String(s._id), s]));
  const in7 = { $gte: today, $lte: addDays(today, 7) }, in3 = { $gte: today, $lte: addDays(today, 3) };
  const apps = await Application.find({ is_deleted: false, $or: [{ stage: { $in: ['documents_pending', 'ready_to_apply'] }, deadline: in7 }, { stage: { $in: ['conditional_offer', 'unconditional_offer'] }, offer_deadline: in3 }] }).lean();
  const shorts = await Shortlist.find({ is_deleted: false, application_id: null, status: { $in: ['Suggested', 'Shared with student', 'Student agreed'] }, deadline: in7 }).lean();
  const fees = await FeeSummary.find({ is_deleted: false, deposit_deadline: in3 }).lean();
  const S = await owners([...apps, ...shorts, ...fees].map((x) => x.student_id));
  const U = await uniNames([...apps, ...shorts].map((x) => x.university_id));
  for (const a of apps) {
    const s = S.get(String(a.student_id)); if (!s) continue;
    const offer = ['conditional_offer', 'unconditional_offer'].includes(a.stage);
    await notify(s.primary_counsellor_id, 'deadline', offer ? `Offer acceptance deadline ${fmtDate(a.offer_deadline)}: ${fullName(s)} - ${U.get(String(a.university_id)) ?? ''}`
      : `Application deadline ${fmtDate(a.deadline)} (not applied yet): ${fullName(s)} - ${U.get(String(a.university_id)) ?? ''}`, `/students/${a.student_id}/applications`);
  }
  for (const x of shorts) { const s = S.get(String(x.student_id)); if (s) await notify(s.primary_counsellor_id, 'deadline', `Shortlist deadline ${fmtDate(x.deadline)}: ${fullName(s)} - ${U.get(String(x.university_id)) ?? ''}`, `/students/${x.student_id}/shortlist`); }
  for (const f of fees) { const s = S.get(String(f.student_id)); if (s) await notify(s.primary_counsellor_id, 'deadline', `Deposit deadline ${fmtDate(f.deposit_deadline)}: ${fullName(s)}`, `/students/${f.student_id}/fees`); }
  const visas = await VisaCase.find({ is_deleted: false, stage: 'appointment_booked', appointment_at: { $gte: t1, $lt: istDayStart(addDays(today, 2)) } }).lean();
  const VS = await owners(visas.map((v) => v.student_id));
  for (const v of visas) { const s = VS.get(String(v.student_id)); if (s) await notify(s.primary_counsellor_id, 'visa_appt', `Visa appointment tomorrow: ${fullName(s)} at ${v.centre ?? ''} (${fmtTime(v.appointment_at!)})`, `/students/${v.student_id}/visa`); }
  const st = Object.fromEntries((await EmailLog.aggregate([{ $match: { queued_at: { $gte: new Date(Date.now() - 864e5) } } }, { $group: { _id: '$status', c: { $sum: 1 } } }])).map((x) => [x._id, x.c]));
  await notifyAdmins('email_summary', `Emails in the last 24 hours: ${(st.Sent ?? 0) + (st.Delivered ?? 0) + (st.Opened ?? 0)} sent, ${st.Failed ?? 0} failed, ${st.Bounced ?? 0} bounced.`, '/admin/reports');
  if (weekday(today) === 1) {
    for (const s of await Student.find({ is_deleted: false, status: { $in: ['Active', 'On hold'] }, passport_expiry: { $nin: [null, ''], $lte: addDays(today, 183) } }).lean()) {
      await notify(s.primary_counsellor_id, 'passport', `Passport ${s.passport_expiry! < today ? 'expired' : 'expiring'} on ${fmtDate(s.passport_expiry)}: ${fullName(s)}`, `/students/${s._id}`);
    }
  }
}

/** Student portal, every minute: E30 unread chat email, student task and visa reminders. */
export async function portalJobs() {
  const t = Date.now();
  const groups = await ChatMessage.aggregate([{ $match: { sender_type: 'staff', read_at: null, deleted_at: null, sent_at: { $lt: new Date(t - 15 * 60e3) } } }, { $group: { _id: { s: '$student_id', l: '$lead_id' }, n: { $sum: 1 } } }]);
  for (const g of groups) {
    const who = String(g._id.s ?? g._id.l);
    const su = g._id.s ? await suOfStudent(g._id.s) : await PortalAccount.findOne({ leadId: g._id.l, studentId: null, status: 'Active' });
    if (!su) continue;
    // at most one per 4 hours per student, never with the message text
    if (await ReminderSent.exists({ key: { $regex: `^e30:${who}:` }, createdAt: { $gt: new Date(t - 4 * 3600e3) } })) continue;
    if (await once(`e30:${who}:${Math.floor(t / (4 * 3600e3))}`)) await trigger('E30', { student_id: g._id.s ?? undefined, lead_id: g._id.s ? undefined : g._id.l, ctx: { unread_count: g.n }, noInApp: true });
  }
  const today = istDate();
  for (const k of await Task.find({ type: 'Student action', student_id: { $ne: null }, status: OPEN, completed_by_type: null, is_deleted: false }).lean()) {
    const su = await suOfStudent(k.student_id); if (!su) continue;
    const due = +k.due_at;
    const key = `${k._id}:${k.due_at.toISOString()}`;
    if (due - t <= 864e5 && due > t && (await once(`stask1d:${key}`))) {
      await studentNotify(su._id, `Reminder: ${k.title} is due ${fmtDateTime(k.due_at)}`, '/tasks');
      if (k.priority === 'High') await trigger('E18', { student_id: k.student_id, ctx: { task_title: `Reminder: ${k.title}`, task_description: k.description ?? '', due_date: fmtDateTime(k.due_at) }, noInApp: true });
    }
    if (due <= t && due > t - 3600e3 && (await once(`stask0:${key}`))) await studentNotify(su._id, `Task due now: ${k.title}`, '/tasks');
    if (due < t && (t - due) / 864e5 <= 7 && istHour() >= 10 && (await once(`stask-over:${k._id}:${today}`))) await studentNotify(su._id, `Overdue: ${k.title}`, '/tasks');
  }
  for (const v of await VisaCase.find({ stage: 'appointment_booked', is_deleted: false, appointment_at: { $gt: new Date(t), $lt: new Date(t + 2 * 864e5 + 60e3) } }).lean()) {
    const su = await suOfStudent(v.student_id); if (!su) continue;
    const d = Math.ceil((+v.appointment_at! - t) / 864e5);
    if (await once(`svisa${d}:${v._id}:${v.appointment_at!.toISOString()}`)) await studentNotify(su._id, `Reminder: visa appointment in ${d} day${d > 1 ? 's' : ''} (${fmtDateTime(v.appointment_at!)}, ${v.centre ?? ''})`, '/visa');
  }
}

/** Student portal, 9 AM IST: privacy deadlines, E29 payment reminders, expired Apply Now requests, unanswered chats, stale catalogue. */
export async function portalDaily() {
  const today = istDate();
  if (istHour() < 9 || !(await once(`pdaily:${today}`))) return;
  for (const x of await PrivacyRequest.find({ status: { $in: ['Open', 'In progress'] }, due_at: { $lt: new Date(Date.now() + 5 * 864e5) } }).lean()) {
    await notifyAdmins('privacy', `Privacy request ${x.request_code} ${x.due_at && x.due_at < new Date() ? 'is OVERDUE' : 'is due ' + (x.due_at ? fmtDate(istDate(x.due_at)) : '')}`, '/admin/privacy/requests');
  }
  const days = String((await getSetting('payment_reminder_days')) || '7,3,1').split(',').map(Number).filter((n) => n > 0);
  const rem = async (studentId: unknown, item: string, amount: number, currency: string, due: string, key: string) => {
    if (amount <= 0 || (await PaymentSubmission.exists({ student_id: studentId, status: 'Submitted', createdAt: { $gt: new Date(Date.now() - 5 * 864e5) } })) || !(await once(key))) return;
    await trigger('E29', { student_id: studentId, ctx: { payment_item: item, amount: Number(amount).toLocaleString('en-IN'), currency, due_date: fmtDate(due) } });
  };
  const paid = async (m: Record<string, unknown>) => (await Payment.aggregate([{ $match: { ...m, is_deleted: false, is_refund: { $ne: true } } }, { $group: { _id: null, s: { $sum: '$amount' } } }]))[0]?.s ?? 0;
  for (const dd of days) {
    const target = addDays(today, dd);
    for (const f of await FeeSummary.find({ is_deleted: false, fee_kind: 'tuition', deposit_deadline: target }).lean()) {
      const app = f.application_id ? await Application.findById(f.application_id).select('university_id').lean() : null;
      const uni = app ? (await uniNames([app.university_id])).get(String(app.university_id)) ?? '' : '';
      const p = await paid({ student_id: f.student_id, application_id: f.application_id ?? null, payment_for: 'Tuition fee / deposit', currency: f.currency });
      await rem(f.student_id, `Deposit: ${uni}`, (f.deposit_required || f.total_amount || 0) - p, f.currency || 'EUR', f.deposit_deadline!, `e29:${f._id}:${dd}`);
    }
    for (const f of await FeeSummary.find({ is_deleted: false, fee_kind: 'service', next_instalment_due: target }).lean()) {
      const p = await paid({ student_id: f.student_id, payment_for: 'La Europa service fee', currency: 'INR' });
      await rem(f.student_id, 'La Europa service fee instalment', (f.total_amount || 0) - (f.discount_approved ? f.discount || 0 : 0) - p, 'INR', f.next_instalment_due!, `e29s:${f._id}:${f.next_instalment_due}:${dd}`);
    }
  }
  for (const q of await ApplicationRequest.find({ status: { $in: ['Requested by student', 'In review'] }, deadline: { $nin: [null, ''], $lt: today }, is_deleted: false })) {
    q.status = 'Expired'; await q.save();
    if (q.student_user_id) await studentNotify(q.student_user_id, `Request ${q.request_code}: deadline passed. Your counsellor will advise.`, '/applications');
  }
  const per = new Map<string, number>();
  for (const w of await ChatMessage.aggregate([{ $match: { sender_type: 'student', read_at: null, deleted_at: null } }, { $group: { _id: { s: '$student_id', l: '$lead_id' } } }])) {
    const owner = w._id.s ? (await Student.findById(w._id.s).select('primary_counsellor_id').lean())?.primary_counsellor_id : (await Lead.findById(w._id.l).select('assigned_user_id').lean())?.assigned_user_id;
    if (owner) per.set(String(owner), (per.get(String(owner)) ?? 0) + 1);
  }
  for (const [uid, n] of per) await notify(uid, 'chat', `You have ${n} student chat(s) waiting for a reply.`, '/chat');
  if (weekday(today) === 1) {
    const n = await Course.countDocuments({ is_deleted: false, status: 'Published', $or: [{ last_verified_on: null }, { last_verified_on: { $lt: addDays(today, -183) } }] });
    if (n) await notifyAdmins('catalogue', `${n} published course(s) were last checked more than 6 months ago`, '/admin/catalogue');
  }
}

/** Admin console: 2 AM IST duplicate and catalogue scans plus notification retention; 9 AM IST scheduled reports and the approvals SLA summary. */
export async function consoleDaily() {
  const t = istDate(), h = istHour();
  if (h >= 2 && (await once('p5-nightly:' + t))) {
    await scanDuplicates().catch((e) => console.warn('[dup scan]', e.message));
    await qualityScan().catch((e) => console.warn('[quality]', e.message));
    const keep = Number(await regVal('retention_notifications_days')) || 180;
    await Notification.deleteMany({ read: true, createdAt: { $lt: new Date(Date.now() - keep * 864e5) } });
    await expirePromotions();
    await creditReferrals().catch((e) => console.warn('[referrals]', e.message));
  }
  if (h >= 9 && (await once('p5-morning:' + t))) {
    await scheduledReportsJob();
    const admin = await User.findOne({ role: 'admin', isActive: true }).sort({ is_super_admin: -1 }).lean();
    if (admin) {
      const late = (await approvalItems({ user: { id: String(admin._id), role: 'admin', name: admin.name } } as unknown as AuthRequest)).filter((x) => x.late);
      if (late.length) await notifyAdmins('approval', `${late.length} approval(s) waiting beyond the SLA`, '/console/approvals');
    }
  }
}

/** Hourly: old notifications, unverified self sign-ups after 7 days, expired data exports. */
export async function cleanup() {
  await Notification.deleteMany({ createdAt: { $lt: new Date(Date.now() - 90 * 864e5) } });
  await PortalAccount.updateMany({ status: 'Pending verification', signupMethod: { $ne: 'invite' }, createdAt: { $lt: new Date(Date.now() - 7 * 864e5) } }, { status: 'Deactivated' });
  await DataExportRequest.updateMany({ status: 'Ready', expires_at: { $lt: new Date() } }, { status: 'Expired' });
}

export function startJobs() {
  const safe = (name: string, fn: () => Promise<unknown>) => () => { fn().catch((e) => console.error(`[job ${name}]`, e.message)); };
  const every = (ms: number, name: string, fn: () => Promise<unknown>, first?: number) => {
    setInterval(safe(name, fn), ms).unref();
    if (first !== undefined) setTimeout(safe(name, fn), first).unref();
  };
  every(60e3, 'reminders', reminders, 5000);
  every(5 * 60e3, 'daily', daily, 8000);
  every(60e3, 'portal', portalJobs);
  every(5 * 60e3, 'portal daily', portalDaily);
  every(60e3, 'announcements', async () => { await announcementJob(); await emailAlert(); });
  every(5 * 60e3, 'console daily', consoleDaily);
  every(3600e3, 'cleanup', cleanup);
}
