import Task, { type ITask } from '../models/Task';
import Notification from '../models/Notification';
import User from '../models/User';
import { getIo } from '../socket/emitter';
import { timeline } from './crm';
import { getSetting } from '../models/Audit';
import { sendMail } from './mailer';
import { env } from '../config/env';

/** The client's createTask / systemTask / notify (legacy/server/services.js, util.js). */

const MANDATORY = new Set(['email_failed', 'security', 'lockout', 'approval']);
/** In-app notification to one staff user (legacy util.notify). Links are CRM paths, e.g. /students/<id>.
 *  Types an Admin switched off are skipped (mandatory ones always go); the person's chosen types also arrive by email. */
export async function notify(userId: unknown, type: string, title: string, link?: string | null) {
  if (!userId) return;
  try {
    if (!MANDATORY.has(type)) { try { if ((JSON.parse(String((await getSetting('staff_notify_off')) ?? '[]')) as string[]).includes(type)) return; } catch { /* ignore */ } }
    const n = await Notification.create({ userId, type, title, body: '', link: link ?? undefined });
    getIo()?.to(`user:${userId}`).emit('notification', n.toObject());
    const u = await User.findById(userId).select('email isActive notify_email').lean();
    const prefs = u?.notify_email ?? { task_assigned: true, email_failed: true };
    if (u?.isActive && u.email && prefs[type]) await sendMail({ to: u.email, subject: 'La Europa CRM: ' + title, text: title + (link ? `\n\nOpen: ${env.crmUrl}${link}` : '') }).catch(() => {});
  } catch { /* a notification never breaks the request */ }
}
export async function notifyAdmins(type: string, title: string, link?: string | null) {
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
  await Promise.all(admins.map((a) => notify(a._id, type, title, link)));
}

type NewTask = Partial<Omit<ITask, keyof Document>> & { title: string; type: string; assigned_to: unknown; due_at: Date | string; no_email?: boolean };

export async function createTask(t: NewTask, byUserId: string, byName?: string) {
  if (t.system_key) {
    const ex = await Task.findOne({ system_key: t.system_key, is_deleted: false, status: { $in: ['Open', 'In progress'] } });
    if (ex) { ex.set({ due_at: t.due_at, title: t.title, assigned_to: t.assigned_to }); await ex.save(); return String(ex._id); }
  }
  const { no_email: _skip, ...fields } = t;
  const task = await Task.create({ priority: 'Medium', status: 'Open', reminder: 'None', repeat_rule: 'None', ...fields, assigned_by: t.assigned_by ?? byUserId, created_by: byUserId });
  if (t.assigned_to && String(t.assigned_to) !== byUserId) {
    await notify(t.assigned_to, 'task_assigned', `${t.is_system ? 'System task' : `${byName ?? 'Someone'} assigned you a task`}: ${t.title}`, '/tasks');
  }
  if (t.student_id) {
    const to = await User.findById(t.assigned_to).select('name').lean();
    await timeline({ student_id: t.student_id, type: 'task', description: `Task created: ${t.title} (assigned to ${to?.name ?? '-'})`, user_id: byUserId });
  }
  // E18 "action needed" email for Student action tasks arrives with the email engine (PORTING.md)
  return String(task._id);
}
export const systemTask = (key: string, fields: NewTask, byUserId: string) => createTask({ ...fields, is_system: true, system_key: key }, byUserId);
export const closeSystemTask = (key: string) => Task.updateMany({ system_key: key, status: { $in: ['Open', 'In progress'] } }, { status: 'Cancelled' });
