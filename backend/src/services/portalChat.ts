import { Types } from 'mongoose';
import { ChatMessage, ApplicationRequest, type IChatMessage } from '../models/Portal';
import { Shortlist, Application, StudentDocument } from '../models/Work';
import Task from '../models/Task';
import User from '../models/User';
import Course from '../models/Course';
import University from '../models/University';
import { uploadBuffer } from '../config/cloudinary';
import { bad, notFound } from './crm';
import { checkFile, ALLOWED } from './files';

/** Student-portal chat (legacy/server/portal/chat.js): one thread per student, or per lead before registration. Separate from internal comments. */

export type Conv = { student_id: Types.ObjectId } | { lead_id: Types.ObjectId };
export type Viewer = { type: 'student'; suId: string } | { type: 'staff'; userId: string };
const CONTEXT = ['course', 'shortlist', 'application', 'request', 'document', 'task'];
const where = (c: Conv) => ('student_id' in c ? { student_id: c.student_id } : { lead_id: c.lead_id, student_id: null });
const fromOther = (viewer: 'student' | 'staff') => (viewer === 'student' ? { sender_type: { $in: ['staff', 'system'] } } : { sender_type: 'student' });
const EDIT_MS = 15 * 60_000;

async function contextCard(type?: string, id?: string) {
  if (!type || !id || !CONTEXT.includes(type) || !Types.ObjectId.isValid(id)) return null;
  const uni = async (u: unknown) => (u ? (await University.findById(u).select('name').lean())?.name ?? '' : '');
  const course = async (c: unknown) => (c ? (await Course.findById(c).select('name').lean())?.name ?? '' : '');
  if (type === 'course') { const c = await Course.findById(id).lean(); return c && { type, id, title: c.name, sub: await uni(c.university), link: `/courses/${id}` }; }
  if (type === 'shortlist') { const s = await Shortlist.findById(id).lean(); return s && { type, id, title: s.course_name_text || (await course(s.course_id)), sub: await uni(s.university_id), link: '/shortlist' }; }
  if (type === 'application') { const a = await Application.findById(id).lean(); return a && { type, id, title: `${a.application_code}: ${a.course_name_text || (await course(a.course_id))}`, sub: await uni(a.university_id), link: `/applications/${id}` }; }
  if (type === 'request') { const r = await ApplicationRequest.findById(id).lean(); return r && { type, id, title: `${r.request_code}: ${r.course_name || (await course(r.course_id))}`, sub: await uni(r.university_id), link: '/applications' }; }
  if (type === 'document') { const d = await StudentDocument.findById(id).lean(); return d && { type, id, title: d.title || 'Document', sub: 'Document', link: '/documents' }; }
  const t = await Task.findById(id).lean(); return t && { type, id, title: t.title, sub: 'Task', link: '/tasks' };
}

export async function out(m: IChatMessage, viewer: Viewer, openPath: (attId: string) => string) {
  const mine = viewer.type === m.sender_type;
  const u = m.sender_type === 'staff' && m.sender_user_id ? await User.findById(m.sender_user_id).select('name role').lean() : null;
  return {
    id: String(m._id), sender_type: m.sender_type, mine, sender_id: m.sender_user_id ? String(m.sender_user_id) : null,
    sender_name: m.sender_type === 'student' ? 'Student' : m.sender_type === 'system' ? 'La Europa' : u?.name ?? 'La Europa', sender_role: u?.role ?? null,
    body: m.deleted_at ? null : m.body ?? null, deleted: !!m.deleted_at, edited: !!m.edited_at, sent_at: m.sent_at, delivered_at: m.delivered_at ?? null, read_at: m.read_at ?? null,
    context: await contextCard(m.context_type, m.context_id),
    attachments: m.deleted_at ? [] : m.attachments.map((a) => ({ id: String(a._id), name: a.original_name, mime: a.mime_type, size: a.size_bytes, url: openPath(String(a._id)), saved: !!a.saved_document_id })),
    can_edit: mine && !m.deleted_at && m.sender_type !== 'system' && Date.now() - +m.sent_at < EDIT_MS,
  };
}

export async function list(conv: Conv, viewer: Viewer, o: { before?: string; openPath: (attId: string) => string }) {
  const before = o.before && !isNaN(Date.parse(o.before)) ? { sent_at: { $lt: new Date(o.before) } } : {};
  const rows = (await ChatMessage.find({ ...where(conv), ...before }).sort({ sent_at: -1 }).limit(60)).reverse();
  await ChatMessage.updateMany({ ...where(conv), ...fromOther(viewer.type), delivered_at: null }, { delivered_at: new Date() });
  return Promise.all(rows.map((m) => out(m, viewer, o.openPath)));
}

const plain = (v: unknown) => String(v ?? '').replace(/<[^>]*>/g, '').slice(0, 2000).trim();
export async function send(conv: Conv, sender: { type: 'staff' | 'student'; userId?: string }, b: { body?: unknown; context_type?: string; context_id?: string; attachments?: Express.Multer.File[] }) {
  const text = plain(b.body);
  const files = b.attachments ?? [];
  if (!text && !files.length) throw bad('Write a message or attach a file');
  if (files.length > 5) throw bad('Maximum 5 attachments per message');
  // check every file first so a bad one never leaves a half-sent message
  const checked = files.map((f) => ({ f, ...checkFile(f, ALLOWED, 10) }));
  const key = 'student_id' in conv ? String(conv.student_id) : `lead-${conv.lead_id}`;
  const attachments = [];
  for (const { f, mime } of checked) {
    const asset = await uploadBuffer(f, `chat/portal-${key}/files`);
    attachments.push({ file_key: asset.url, public_id: asset.publicId, resource_type: asset.resourceType, original_name: f.originalname, mime_type: mime, size_bytes: f.size });
  }
  const ctx = b.context_type && CONTEXT.includes(b.context_type) ? { context_type: b.context_type, context_id: b.context_id } : {};
  const m = await ChatMessage.create({ ...('student_id' in conv ? { student_id: conv.student_id } : { lead_id: conv.lead_id }), sender_type: sender.type, sender_user_id: sender.userId,
    body: text || undefined, ...ctx, channel: 'portal', sent_at: new Date(), attachments });
  return String(m._id);
}
export const systemLine = (conv: Conv, text: string) =>
  ChatMessage.create({ ...('student_id' in conv ? { student_id: conv.student_id } : { lead_id: conv.lead_id }), sender_type: 'system', body: text, channel: 'portal', sent_at: new Date() });
export const markRead = (conv: Conv, viewer: 'student' | 'staff') =>
  ChatMessage.updateMany({ ...where(conv), ...fromOther(viewer), read_at: null }, [{ $set: { read_at: '$$NOW', delivered_at: { $ifNull: ['$delivered_at', '$$NOW'] } } }]);
export const unread = (conv: Conv, viewer: 'student' | 'staff') => ChatMessage.countDocuments({ ...where(conv), ...fromOther(viewer), read_at: null, deleted_at: null });

export async function edit(id: unknown, sender: { type: 'staff' | 'student'; userId: string }, body: unknown, del = false) {
  const m = await ChatMessage.findById(id);
  if (!m || m.sender_type !== sender.type || String(m.sender_user_id) !== sender.userId) throw notFound('Message');
  if (Date.now() - +m.sent_at > EDIT_MS) throw bad('Messages can be edited or deleted only within 15 minutes');
  m.original_body ??= m.body;
  if (del) m.deleted_at = new Date();
  else { const t = plain(body); if (!t) throw bad('Message cannot be empty'); m.set({ body: t, edited_at: new Date() }); }
  await m.save();
  return m;
}
export async function attachment(attId: unknown) {
  const m = await ChatMessage.findOne({ 'attachments._id': attId });
  const a = m?.attachments.find((x) => String(x._id) === String(attId));
  return m && a ? { m, a } : null;
}
