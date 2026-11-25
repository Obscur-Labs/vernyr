import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import User from '../models/User';
import PortalAccount from '../models/PortalAccount';
import Notification from '../models/Notification';
import { Application } from '../models/Work';
import { Country, Intake } from '../models/Master';
import { EmailTemplate, EmailLog } from '../models/Email';
import { AuditLog, audit, getSetting, setSetting } from '../models/Audit';
import { Announcement, AnnouncementRead, Branch, Team, type IAnnouncement } from '../models/Console';
import { bad, fieldErr, notFound, handle, oid, clean, isEmail, encrypt, escRx, userNames, nameIn } from '../services/crm';
import { notifyAdmins } from '../services/tasks';
import { HARD_CC, getTemplate, seedTemplates, resend, quickEmail, studentNotify, esc } from '../services/email';
import { isSuper, can, need, needSuper, regVal } from '../services/console';

/** Admin console communication (legacy/server/admin5/comms.js): template catalogue, senders, email monitor, SMS / WhatsApp, staff notification types, announcements. */
const router = Router();
router.use(authenticate);
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------- template catalogue (the editor stays in Admin > Email templates) ----------
const groupOf = (t: { audience?: string; trigger_code: string }) => {
  const n = Number(String(t.trigger_code).slice(1));
  if (t.audience === 'Staff') return 'Staff'; if (t.audience === 'University') return 'University'; if (t.audience === 'Student') return 'Student';
  if (n >= 31 && n <= 41) return 'University'; if (n >= 44 && n <= 48) return 'Staff'; return 'Student';
};
const SECURITY = [['SE1', 'Student login / sign-up code'], ['SE2', 'Student password reset link'], ['SE3', 'Student new device alert'], ['SE9', 'Staff login code / Super Admin security code']];
router.get('/console/templates', handle(async (req, res) => {
  await need(req, 'templates');
  await seedTemplates();
  const names = await userNames();
  const rows = (await EmailTemplate.find().sort({ trigger_code: 1 }).lean()).map((t) => ({ code: t.trigger_code, name: t.name, group: groupOf(t), on: t.is_active, locked: !!t.is_locked,
    always_to_student: !!t.always_to_student, version: t.version, edited_by: nameIn(names, t.updated_by), edited_at: t.updatedAt, title: t.update_title, language: t.language || 'en' }));
  const sending = String((await getSetting('sending_address')) ?? '');
  res.json({ rows, security: SECURITY.map(([code, name]) => ({ code, name, group: 'Security', on: true, locked: true, note: 'Sent only to the user, never with CC (decision AD-D1)' })), cc: HARD_CC,
    senders: { student: sending, university: (await getSetting('uni_sending_address')) || sending, staff: sending, security: (await getSetting('uni_noreply_address')) || 'no-reply@vernyr.com' },
    can_edit: await can(req, 'templates', 'edit') });
}));
router.put('/console/templates/:code', handle(async (req, res) => {
  await need(req, 'templates', 'edit');
  const t = await getTemplate(req.params.code);
  if (!t) throw notFound('Template');
  const before = { is_active: t.is_active, always_to_student: t.always_to_student };
  if (req.body?.on !== undefined) { if (t.is_locked && !req.body.on) throw bad('This email cannot be switched off'); t.is_active = !!req.body.on; }
  if (req.body?.always_to_student !== undefined) t.always_to_student = !!req.body.always_to_student;
  t.set({ updated_by: req.user!.id }); await t.save();
  await audit(req, 'Template edit', 'EmailTemplate', t._id, t.trigger_code, before, { is_active: t.is_active, always_to_student: t.always_to_student });
  res.json({ ok: true });
}));
router.put('/console/senders', handle(async (req, res) => {
  await need(req, 'templates', 'edit');
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  for (const k of ['sending_address', 'uni_sending_address', 'uni_noreply_address']) if (b[k] && !isEmail(b[k])) errors[k] = 'Enter a valid email';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  for (const k of ['sending_address', 'uni_sending_address', 'uni_noreply_address', 'uni_display_name', 'display_name_format']) if (b[k] !== undefined) await setSetting(k, String(b[k] || ''), req.user!.id);
  await audit(req, 'Setting change', 'Senders', 'email', 'Sender addresses changed', null, b);
  res.json({ ok: true });
}));

// ---------- email log and delivery monitor ----------
router.get('/console/email-log', handle(async (req, res) => {
  await need(req, 'templates');
  const q = req.query as Record<string, string>;
  const f: Any = {};
  if (q.recipient_type) f.recipient_type = q.recipient_type === 'student' ? { $in: ['student', null] } : q.recipient_type;
  if (q.status) f.status = q.status;
  if (q.code) f.trigger_code = q.code;
  if (q.q) { const rx = new RegExp(escRx(q.q), 'i'); f.$or = [{ to_addr: rx }, { subject: rx }]; }
  const stat = async (since: Date) => Object.fromEntries((await EmailLog.aggregate([{ $match: { queued_at: { $gt: since } } }, { $group: { _id: '$status', c: { $sum: 1 } } }])).map((x) => [x._id, x.c]));
  const d1 = new Date(Date.now() - 864e5), d7 = new Date(Date.now() - 7 * 864e5);
  const page = Math.max(1, Number(q.page) || 1);
  const rows = await EmailLog.find(f).sort({ queued_at: -1 }).skip((page - 1) * 50).limit(50).select('trigger_code recipient_type to_addr cc_addr status attempts error subject update_title queued_at sent_at student_id').lean();
  res.json({ total: await EmailLog.countDocuments(f), page, rows: rows.map((x) => ({ ...x, id: String(x._id), _id: undefined, recipient_type: x.recipient_type ?? 'student' })),
    stats: { day: await stat(d1), week: await stat(d7) },
    bounces: (await EmailLog.find({ status: 'Bounced', queued_at: { $gt: d7 } }).sort({ queued_at: -1 }).limit(50).select('to_addr student_id lead_id error queued_at').lean()).map((x) => ({ ...x, id: String(x._id), _id: undefined })), cc: HARD_CC });
}));
router.post('/console/email-log/:id/resend', handle(async (req, res) => {
  await need(req, 'templates', 'edit');
  const log = await EmailLog.findById(oid(req.params.id)).lean();
  if (!log) throw notFound();
  if (!['Failed', 'Bounced', 'Cancelled'].includes(log.status)) throw bad('Only failed, bounced or cancelled emails can be resent');
  let id: string;
  if (!log.parts?.length && log.body_html) {
    const { _id, ...rest } = log;
    id = String((await EmailLog.create({ ...rest, status: 'Queued', attempts: 0, error: undefined, sent_at: undefined, message_id: undefined, queued_at: new Date(), scheduled_at: new Date(), next_attempt_at: new Date(),
      triggered_by: req.user!.id, cc_addr: HARD_CC, resend_of: _id }))._id);
  } else id = await resend(log._id, req.user!.id);
  await audit(req, 'Resend', 'EmailLog', log._id, log.to_addr);
  res.json({ id });
}));
/** Job: more failures than the setting in the last hour tells the Admins, at most once an hour. */
let lastAlert = '';
export async function emailAlert() {
  const since = new Date(Date.now() - 3600e3);
  const [n, f] = await Promise.all([EmailLog.countDocuments({ queued_at: { $gt: since } }), EmailLog.countDocuments({ queued_at: { $gt: since }, status: { $in: ['Failed', 'Bounced'] } })]);
  const pct = n ? f / n * 100 : 0;
  const hour = new Date().toISOString().slice(0, 13);
  if (n >= 5 && pct > (Number(await regVal('email_failure_alert_percent')) || 5) && lastAlert !== hour) {
    lastAlert = hour;
    await notifyAdmins('email_failed', `Email failure rate ${Math.round(pct)}% in the last hour (${f} of ${n})`, '/console/email-log');
  }
}

// ---------- SMS / WhatsApp: keys encrypted; no provider connected in this build ----------
router.get('/console/channels', handle(async (req, res) => {
  await need(req, 'channels');
  const g = async (k: string) => String((await getSetting(k)) ?? '');
  let tpl = {};
  try { tpl = JSON.parse((await g('wa_templates_json')) || '{}'); } catch { /* none */ }
  res.json({ sms: { enabled: (await g('sms_enabled')) === '1', provider: await g('sms_provider'), sender_id: await g('sms_sender_id'), dlt_entity: await g('sms_dlt_entity'), dlt_template: await g('sms_dlt_template'),
      daily_limit: (await g('sms_daily_limit')) || '500', key_on_file: !!(await g('sms_api_key_enc')) },
    whatsapp: { enabled: (await g('wa_enabled')) === '1', provider: await g('wa_provider'), phone: await g('wa_phone'), templates: tpl, optin: (await g('wa_optin')) || 'Student ticks "WhatsApp updates" in the portal', key_on_file: !!(await g('wa_api_key_enc')) },
    can_edit: await isSuper(req), tests: (await AuditLog.find({ action: 'Channel test' }).sort({ _id: -1 }).limit(10).lean()).map((x) => ({ ...x, id: String(x._id), created_at: x.createdAt })) });
}));
router.put('/console/channels', handle(async (req, res) => {
  await needSuper(req);
  const s = req.body?.sms ?? {}, w = req.body?.whatsapp ?? {};
  if (s.sender_id && !/^[A-Z]{6}$/.test(s.sender_id)) throw fieldErr('sms_sender_id', 'DLT sender ID is 6 capital letters');
  const set = async (k: string, v: unknown) => { if (v !== undefined) await setSetting(k, String(v ?? ''), req.user!.id); };
  await set('sms_enabled', s.enabled ? '1' : '0'); await set('sms_provider', s.provider); await set('sms_sender_id', s.sender_id); await set('sms_dlt_entity', s.dlt_entity);
  await set('sms_dlt_template', s.dlt_template); await set('sms_daily_limit', s.daily_limit);
  if (s.api_key) await setSetting('sms_api_key_enc', encrypt(String(s.api_key)), req.user!.id);
  await set('wa_enabled', w.enabled ? '1' : '0'); await set('wa_provider', w.provider); await set('wa_phone', w.phone); await set('wa_optin', w.optin);
  if (w.templates) await setSetting('wa_templates_json', JSON.stringify(w.templates), req.user!.id);
  if (w.api_key) await setSetting('wa_api_key_enc', encrypt(String(w.api_key)), req.user!.id);
  await audit(req, 'Setting change', 'Channels', 'sms/whatsapp', 'SMS / WhatsApp settings changed (keys not logged)');
  res.json({ ok: true });
}));
router.post('/console/channels/test', handle(async (req, res) => {
  await needSuper(req);
  const ch = req.body?.channel === 'whatsapp' ? 'whatsapp' : 'sms';
  const enabled = (await getSetting(ch === 'sms' ? 'sms_enabled' : 'wa_enabled')) === '1', key = await getSetting(ch === 'sms' ? 'sms_api_key_enc' : 'wa_api_key_enc');
  const result = !enabled ? 'Channel is off' : !key ? 'No API key saved' : 'Settings complete. No provider is connected in this build: the message was not sent (sandbox).';
  await audit(req, 'Channel test', 'Channels', ch, result);
  res.json({ ok: true, result });
}));

// ---------- staff in-app notification types ----------
const NOTIFY_TYPES: [string, string, boolean][] = [['assigned', 'New lead / student assigned', false], ['task_assigned', 'Task assigned', false], ['document', 'Document uploaded', false],
  ['portal', 'Student portal activity', false], ['duplicate', 'Possible duplicates', false], ['approval', 'Approvals needed', true], ['email_failed', 'Failed emails', true],
  ['security', 'Security alerts', true], ['lockout', 'Account lockouts', true]];
const offTypes = async () => { try { return JSON.parse(String((await getSetting('staff_notify_off')) ?? '[]')) as string[]; } catch { return []; } };
router.get('/console/notification-types', handle(async (req, res) => {
  await need(req, 'settings');
  const off = await offTypes();
  res.json({ rows: NOTIFY_TYPES.map(([key, label, mandatory]) => ({ key, label, mandatory, on: mandatory || !off.includes(key) })) });
}));
router.put('/console/notification-types', handle(async (req, res) => {
  await need(req, 'settings', 'edit');
  const off = ((req.body?.off ?? []) as string[]).filter((k) => NOTIFY_TYPES.some((t) => t[0] === k && !t[2]));
  await setSetting('staff_notify_off', JSON.stringify(off), req.user!.id);
  await audit(req, 'Setting change', 'Setting', 'staff_notify_off', 'Staff notification types', null, off);
  res.json({ ok: true });
}));

// ---------- announcements (staff and students; universities come with the partner portal) ----------
function readAnn(b: Any) {
  const errors: Record<string, string> = {};
  if (!clean(b.title)) errors.title = 'Title is required';
  if (!clean(b.body)) errors.body = 'Message is required';
  const aud = (b.audience ?? {}) as Any;
  const ch = ((b.channels ?? []) as string[]).filter((x) => ['banner', 'dashboard', 'email'].includes(x));
  if (!['staff', 'students'].some((k) => aud[k]?.on)) errors.audience = 'Choose at least one audience';
  if (!ch.length) errors.channels = 'Choose at least one channel';
  if (b.expire_at && b.publish_at && b.expire_at < b.publish_at) errors.expire_at = 'Expiry is before publishing';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  return { title: clean(b.title, 150)!, body: clean(b.body, 5000)!, audience: aud, channels: ch, publish_at: b.publish_at ? new Date(b.publish_at) : new Date(), expire_at: b.expire_at ? new Date(b.expire_at) : undefined,
    priority: b.priority === 'Important' ? 'Important' : 'Normal' };
}
async function recipients(aud: Any) {
  const out: { staff: { _id: unknown; email?: string }[]; students: { _id: unknown; email?: string }[] } = { staff: [], students: [] };
  if (aud.staff?.on) {
    const f: Any = { isActive: true };
    if (oid(aud.staff.branch)) f.branch_id = oid(aud.staff.branch);
    if (oid(aud.staff.team)) f._id = { $in: (await Team.findById(oid(aud.staff.team)).lean())?.members ?? [] };
    out.staff = await User.find(f).select('email').lean();
  }
  if (aud.students?.on) {
    const f: Any = { role: 'student', status: { $in: ['Active', 'Read only'] } };
    const af: Any = { is_deleted: false };
    if (oid(aud.students.country)) af.country_id = oid(aud.students.country);
    if (oid(aud.students.intake)) af.intake_id = oid(aud.students.intake);
    if (af.country_id || af.intake_id) f.studentId = { $in: await Application.distinct('student_id', af) };
    out.students = await PortalAccount.find(f).select('email').lean();
  }
  return out;
}
export async function publishAnnouncement(a: IAnnouncement) {
  const rc = await recipients(a.audience);
  const counts: Record<string, number> = {};
  const title = `${a.priority === 'Important' ? 'Important: ' : ''}${a.title}`;
  const html = `<p>${esc(a.body).replace(/\n/g, '<br>')}</p>`;
  const byId = a.created_by ? String(a.created_by) : undefined;
  if (rc.staff.length) {
    await Notification.insertMany(rc.staff.map((u) => ({ userId: u._id, type: 'announcement', title: 'Announcement: ' + a.title, body: '', link: '/announcements/' + a._id })));
    if (a.channels.includes('email')) await quickEmail({ to: rc.staff.map((u) => u.email), subject: `[La Europa CRM] ${title}`, title, html, kind: 'staff', by: byId });
    counts.staff = rc.staff.length;
  }
  if (rc.students.length) {
    for (const s of rc.students) await studentNotify(s._id, a.title, '/home');
    if (a.channels.includes('email')) for (const s of rc.students) await quickEmail({ to: [s.email], subject: `La Europa Education | ${title}`, title, html, kind: 'external', by: byId });
    counts.students = rc.students.length;
  }
  await Announcement.updateOne({ _id: a._id }, { status: 'Published', published_at: new Date(), sent_counts: counts });
  return counts;
}
/** Job: publish scheduled announcements, expire old ones. */
export async function announcementJob() {
  for (const a of await Announcement.find({ status: 'Scheduled', is_deleted: false, publish_at: { $lte: new Date() } })) { try { await publishAnnouncement(a); } catch (e) { console.warn('[announcement]', (e as Error).message); } }
  await Announcement.updateMany({ status: 'Published', expire_at: { $ne: null, $lt: new Date() } }, { status: 'Expired' });
}
router.get('/console/announcements', handle(async (req, res) => {
  await need(req, 'announcements');
  const names = await userNames();
  const rows = await Announcement.find({ is_deleted: false }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({
    rows: await Promise.all(rows.map(async (a) => ({ ...a, id: String(a._id), _id: undefined, created_at: a.createdAt, counts: a.sent_counts ?? {}, reads: await AnnouncementRead.countDocuments({ announcement_id: a._id }), by: nameIn(names, a.created_by) }))),
    branches: (await Branch.find({ is_deleted: false }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
    teams: (await Team.find({ is_deleted: false }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
    countries: (await Country.find().sort({ sort: 1, name: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
    intakes: (await Intake.find({ active: true }).sort({ year: 1, month: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
    universities: [], can_edit: await can(req, 'announcements', 'edit'),
  });
}));
router.post('/console/announcements', handle(async (req, res) => {
  await need(req, 'announcements', 'edit');
  const v = readAnn(req.body ?? {});
  const a = await Announcement.create({ ...v, status: 'Scheduled', created_by: req.user!.id });
  const counts = v.publish_at <= new Date() ? await publishAnnouncement(a) : null;
  await audit(req, 'Create', 'Announcement', a._id, v.title, null, { audience: v.audience, channels: v.channels });
  res.json({ id: String(a._id), counts });
}));
router.post('/console/announcements/:id/withdraw', handle(async (req, res) => {
  await need(req, 'announcements', 'edit');
  await Announcement.updateOne({ _id: oid(req.params.id) }, { status: 'Withdrawn' });
  await audit(req, 'Update', 'Announcement', req.params.id, 'Withdrawn');
  res.json({ ok: true });
}));
// every staff member: the active banners and dashboard cards for them
router.get('/announcements/active', handle(async (req, res) => {
  const me = await User.findById(req.user!.id).select('branch_id').lean();
  const teams = (await Team.find({ members: req.user!.id }).select('_id').lean()).map((x) => String(x._id));
  const rows = (await Announcement.find({ status: 'Published', is_deleted: false, $or: [{ expire_at: null }, { expire_at: { $gt: new Date() } }] }).sort({ published_at: -1 }).limit(20).lean())
    .filter((a) => { const s = (a.audience as Any)?.staff; if (!s?.on) return false; if (s.branch && s.branch !== String(me?.branch_id)) return false; if (s.team && !teams.includes(s.team)) return false; return true; })
    .sort((a, b) => Number(b.priority === 'Important') - Number(a.priority === 'Important'));
  const read = new Set((await AnnouncementRead.find({ reader_type: 'staff', reader_id: req.user!.id, announcement_id: { $in: rows.map((a) => a._id) } }).lean()).map((x) => String(x.announcement_id)));
  res.json({ rows: rows.map((a) => ({ id: String(a._id), title: a.title, body: a.body, priority: a.priority, channels: a.channels, read: read.has(String(a._id)) })) });
}));
router.post('/announcements/:id/read', handle(async (req, res) => {
  await AnnouncementRead.updateOne({ announcement_id: oid(req.params.id), reader_type: 'staff', reader_id: req.user!.id }, { $setOnInsert: { at: new Date() } }, { upsert: true });
  res.json({ ok: true });
}));

export default router;
