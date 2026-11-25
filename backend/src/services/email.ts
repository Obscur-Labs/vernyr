import crypto from 'crypto';
import { Types } from 'mongoose';
import type { AuthRequest } from '../middleware/auth';
import { EmailTemplate, EmailLog, type EmailPart, type IEmailLog } from '../models/Email';
import Student, { type IStudent } from '../models/Student';
import Lead, { type ILead } from '../models/Lead';
import User from '../models/User';
import PortalAccount from '../models/PortalAccount';
import Notification from '../models/Notification';
import { StudentDocument } from '../models/Work';
import { MasterItem } from '../models/Master';
import { audit, getSetting } from '../models/Audit';
import { send, HardBounce } from './mailer';
import { page, esc } from './emailTheme';
import { timeline, fullName } from './crm';
import { notify, notifyAdmins } from './tasks';
import { env } from '../config/env';

/** The client's email engine (legacy/server/email.js): trigger emails E01 to E49, one thread per student, hard CC, queue with retries. */

export const HARD_CC = 'laeuropaapplication@gmail.com';
export { esc };

export const TEMPLATES: Record<string, [string, string, string]> = {
  E01: ['New lead added with email', 'Thank you for contacting La Europa Education',
    '<p>Thank you for your interest in studying abroad with La Europa Education. We have received your inquiry for {interested_country}. Your counsellor {counsellor_name} will contact you soon to understand your profile and plans.</p>'],
  E02: ['Lead converted to student (registration)', 'Welcome to La Europa Education',
    '<p>Welcome to La Europa Education! You are now registered with us. Your student ID is <b>{student_id}</b> and your counsellor is {counsellor_name}.</p><p>All updates about your profile, course options, applications, documents, fees and visa will come to you in this same email thread, so please keep it safe.</p><p>Next step: {next_step}</p>'],
  E03: ['Follow-up call / meeting scheduled', 'Your next discussion with La Europa',
    '<p>We have scheduled our next discussion with you on {followup_date} at {followup_time}. {counsellor_name} will call you on {student_phone}. If this time does not suit you, please reply to this email.</p>'],
  E21: ['Lead status changed (Contacted, Interested, Not interested)', 'Update on your inquiry',
    '<p>Thank you for speaking with us. The status of your inquiry is now: <b>{lead_status_label}</b>.</p><p>{status_message}</p>'],
  E22: ['Student profile details updated', 'Your profile has been updated',
    '<p>We have updated the following details in your profile:</p>{changed_fields_list}<p>Please check them. If anything is not correct, reply to this email and we will fix it.</p>'],
  E04: ['Course shortlist shared', 'Your shortlisted course options',
    '<p>Based on your profile, here are the course options we suggest for you:</p>{shortlist_table}<p>Please go through them and tell us which ones you like. We will then start your applications.</p>'],
  E05: ['Application stage changed', 'Application update: {university}',
    '<p>Here is an update on your application:</p><p>University: <b>{university}</b><br>Course: {course}<br>Intake: {intake}<br>New status: <b>{stage}</b></p><p>{stage_message}</p>'],
  E06: ['Application moved to Interview', 'Interview scheduled: {university}',
    '<p>Good news! {university} has invited you for an interview / test for {course}.</p><p>Date and time: <b>{interview_datetime}</b><br>Mode / link: {interview_link}</p><p>Your counsellor will help you prepare. Please confirm by replying to this email.</p>'],
  E07: ['Offer letter uploaded / offer', 'Congratulations! Offer from {university}',
    '<p>Congratulations, {student_first_name}! You have received a <b>{offer_type}</b> from {university} for {course} ({intake}).</p>{offer_conditions_block}<p>Next step: {next_step}. Please do not make any payment to the university before talking to your counsellor.</p>'],
  E08: ['Application Rejected', 'Application update: {university}',
    '<p>We are sorry to inform you that {university} has not accepted your application for {course} ({intake}). This happens sometimes and it is not the end of the road. Your counsellor will discuss other options with you.</p><p>{include_reason_if_ticked}</p>'],
  E09: ['Document rejected', 'Action needed: please re-send {document_name}',
    '<p>We checked your document "<b>{document_name}</b>" and it needs to be sent again.</p><p>Reason: {rejection_reason}</p><p>Please send a clear, complete copy by replying to this email or sharing it with your counsellor.</p>'],
  E10: ['Document verified', 'Document verified: {document_name}',
    '<p>Your document(s) have been checked and verified:</p>{verified_documents_list}<p>Documents still pending:</p>{pending_documents_list}'],
  E11: ['Documents requested by counsellor', 'Documents needed for your application',
    '<p>To move forward with your application, please send us the following documents:</p>{requested_documents_list}<p>Tips: Please send clear PDF scans. All semester marksheets should be merged into one PDF.</p><p>Please send them by {due_date}.</p>'],
  E12: ['Tuition fee / deposit payment recorded', 'Payment recorded: {university}',
    '<p>We have recorded your payment for {university}:</p><p>Amount: <b>{amount} {currency}</b><br>Date: {payment_date}<br>Pending amount (as per our records): {pending_amount} {currency}</p><p>Please keep your payment receipt safe.</p>'],
  E13: ['La Europa service fee payment recorded', 'Payment received: thank you',
    '<p>Thank you! We have received your payment of <b>{amount} {currency}</b> on {payment_date} towards La Europa Education services. Pending amount: {pending_amount} {currency}.</p>'],
  E14: ['Visa stage changed', 'Visa update: {visa_stage}',
    '<p>Here is an update on your visa process for {country}:</p><p>New status: <b>{visa_stage}</b></p><p>{visa_stage_message}</p>'],
  E15: ['Visa appointment booked', 'Your visa appointment is booked',
    '<p>Your visa appointment is booked.</p><p>Date and time: <b>{appointment_datetime}</b><br>Centre: {appointment_centre}<br>Reference number: {vfs_reference}</p><p>Please carry your original passport and all documents in the checklist. Reach the centre at least 30 minutes early.</p>'],
  E16: ['Visa approved', 'Congratulations! Your visa is approved',
    '<p>Congratulations, {student_first_name}! Your student visa for {country} has been approved. Your counsellor will now help you with pre-departure steps like travel, accommodation and insurance.</p>'],
  E17: ['Visa rejected', 'Visa update and next steps',
    '<p>We are sorry to inform you that your visa application for {country} was not approved this time. Please do not worry. Your counsellor {counsellor_name} will call you to explain the next steps and the option to re-apply.</p><p>{include_reason_if_ticked}</p>'],
  E18: ['New student action task', 'Action needed: {task_title}',
    '<p>There is a new action for you:</p><p><b>{task_title}</b></p><p>{task_description}</p><p>Please complete it by {due_date}.</p>'],
  E19: ['Student action task marked done', 'Thank you: {task_title} completed',
    '<p>Thank you for completing "{task_title}". We will now move to the next step.</p>'],
  E20: ['Counsellor changed (student transferred)', 'Your new La Europa counsellor',
    '<p>From today, {new_counsellor_name} will be your counsellor at La Europa Education. You can reach them at {counsellor_phone} or by replying to this email. All your previous details stay safe with us.</p>'],
  E23: ['Student sent an Apply Now request', 'We have received your application request',
    '<p>We have received your request for <b>{course}</b> at <b>{university}</b> ({intake}). Your counsellor {counsellor_name} will review it and apply on your behalf. You do not need to contact the university.</p><p>Request number: <b>{request_id}</b>.</p>'],
  E24: ['Apply Now request declined by counsellor', 'Update on your application request',
    '<p>Your request for {course} at {university} ({intake}) has not been taken forward.</p><p>Reason: {decline_reason}</p><p>Your counsellor will discuss other options with you.</p>'],
  E25: ['Profile change request rejected', 'Your profile change request',
    '<p>We could not make the change you requested to <b>{field_label}</b>.</p><p>Reason: {reject_reason}</p><p>Please message your counsellor if you have questions.</p>'],
  E26: ['Student portal invite', 'Your La Europa student portal is ready',
    '<p>You can now see your applications, documents and updates online. Click the button to set up your account:</p><p><a href="{portal_invite_link}" style="background:#5B56E9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Set up my account</a></p><p>For your safety, we will send a code to your email (in a separate security email) when you open the link. The link is valid for 7 days.</p>'],
  E27: ['Student accepted an offer in the portal', 'We have received your offer acceptance',
    '<p>We have received your wish to accept the offer from <b>{university}</b> for {course} ({intake}). Your counsellor will confirm the acceptance with the university and tell you the next step.</p><p>Please do not make any payment to the university before talking to your counsellor.</p>'],
  E28: ['Fee deposit instructions published', 'Fee payment instructions: {university}',
    '<p>Your counsellor has shared the fee payment instructions for {university}.</p><p>Amount: <b>{amount} {currency}</b><br>Pay by: <b>{due_date}</b></p><p>Please log in to the portal to see the full instructions, and check with your counsellor before paying.</p>'],
  E29: ['Payment reminder (deposit or service fee due)', 'Payment reminder: {payment_item}',
    '<p>This is a reminder that <b>{amount} {currency}</b> for {payment_item} is due on <b>{due_date}</b>.</p><p>If you have already paid, please upload the receipt in the portal.</p>'],
  E30: ['Unread chat message from counsellor', 'New message from {counsellor_name}',
    '<p>You have {unread_count} new message(s) from {counsellor_name} in your La Europa student portal. Log in to read and reply.</p>'],
  E42: ['University acceptance letter for visa shared', 'Your acceptance letter from {university} is ready',
    '<p>Good news! {university} has issued your {letter_type} for {course} ({intake}). You can download it from the "Shared with me" section of your student portal. Your counsellor will use it for your visa file and guide you on the next steps.</p>'],
  E43: ['Application waitlisted by the university', 'Application update: {university}',
    '<p>Here is an update on your application to {university} for {course} ({intake}). The university has placed your application on its waiting list. This means a decision will come later. Your counsellor will keep you updated and discuss other options with you.</p>'],
  E49: ['Consent needed to share the application with a university', 'Your permission to share your application with {university}',
    '<p>La Europa would like to send your application for {course} at {university} ({country}). To do this we need your permission to share your profile details and documents with the university.</p><p>Please log in to your student portal and confirm, or reply to your counsellor. The university will receive only what is needed for admission, and never your phone number or personal email unless needed and agreed.</p>'],
};
const DEFAULT_OFF = new Set(['E19']);
/** Where each trigger points in the student portal (in-app notification). */
export const PORTAL_LINK: Record<string, string | null> = {
  E01: '/home', E02: '/home', E03: '/home', E21: '/home', E22: '/profile', E04: '/shortlist', E05: '/applications', E06: '/applications', E07: '/applications', E08: '/applications',
  E09: '/documents?tab=action', E10: '/documents', E11: '/documents?tab=action', E12: '/payments', E13: '/payments', E14: '/visa', E15: '/visa', E16: '/visa', E17: '/visa',
  E18: '/tasks', E19: '/tasks', E20: '/home', E23: '/applications', E24: '/applications', E25: '/profile', E26: null, E27: '/applications', E28: '/payments', E29: '/payments',
  E30: '/chat', E42: '/documents?tab=shared', E43: '/applications', E49: '/applications?consent=1',
};

// 13.6.3 whitelist: anything else is stripped when rendering and refused when saving a template
export const WHITELIST = new Set(['student_name', 'student_first_name', 'student_id', 'student_phone', 'student_email',
  'counsellor_name', 'counsellor_designation', 'counsellor_phone', 'counsellor_email', 'counsellor_id', 'new_counsellor_name',
  'interested_country', 'lead_status_label', 'status_message', 'followup_date', 'followup_time',
  'university', 'course', 'intake', 'country', 'stage', 'stage_message', 'applied_date', 'interview_datetime', 'interview_link', 'offer_type',
  'offer_conditions_block', 'document_name', 'rejection_reason', 'verified_documents_list', 'pending_documents_list', 'requested_documents_list',
  'amount', 'currency', 'payment_date', 'pending_amount', 'visa_stage', 'visa_stage_message', 'appointment_datetime', 'appointment_centre',
  'vfs_reference', 'submission_date', 'visa_documents_list', 'task_title', 'task_description', 'due_date', 'next_step', 'update_title',
  'changed_fields_list', 'shortlist_table', 'optional_counsellor_message', 'include_reason_if_ticked', 'passport_last4',
  'request_id', 'decline_reason', 'field_label', 'reject_reason', 'portal_invite_link', 'payment_item', 'unread_count', 'portal_link', 'letter_type', 'verified_documents_items']);
const HTML_SAFE = new Set(['changed_fields_list', 'shortlist_table', 'verified_documents_list', 'pending_documents_list', 'requested_documents_list',
  'visa_documents_list', 'offer_conditions_block', 'optional_counsellor_message']);
// field names that can never reach a template, whatever the caller passes
const BLOCKED_KEYS = /sub_agent|source|referred|note|comment|remark|budget|income|funds|discount|marital|portal|password|secret|passport_enc|passport_no/i;

export const ul = (items: string[]) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p>None</p>');
const placeholdersIn = (text: string) => [...String(text || '').matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1]);
export const invalidPlaceholders = (text: string) => [...new Set(placeholdersIn(text).filter((p) => !WHITELIST.has(p)))];
function safeCtx(ctx: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx || {})) if (WHITELIST.has(k) && !(BLOCKED_KEYS.test(k) && k !== 'passport_last4' && k !== 'portal_invite_link' && k !== 'portal_link')) out[k] = v;
  return out;
}
export function render(text: string, ctx: Record<string, unknown>) {
  return String(text || '').replace(/\{([a-z0-9_]+)\}/gi, (_m, k) => {
    if (!WHITELIST.has(k)) return '';
    const v = ctx[k];
    if (v === undefined || v === null) return '';
    return HTML_SAFE.has(k) ? String(v) : esc(v);
  });
}
export const htmlToText = (h: string) => String(h).replace(/<li>/g, '\n - ').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|h\d|tr|div)>/g, '\n')
  .replace(/<\/t[dh]>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

let seeded: Promise<void> | null = null;
export function seedTemplates() {
  seeded ??= (async () => {
    for (const [code, [name, title, body]] of Object.entries(TEMPLATES)) {
      await EmailTemplate.updateOne({ trigger_code: code, channel: 'email' },
        { $setOnInsert: { trigger_code: code, channel: 'email', name, update_title: title, body_html: body, body_text: htmlToText(body), is_active: !DEFAULT_OFF.has(code), version: 1, audience: 'Student' } }, { upsert: true });
    }
  })().catch((e) => { seeded = null; throw e; });
  return seeded;
}
export async function getTemplate(code: string) { await seedTemplates(); return EmailTemplate.findOne({ trigger_code: code, channel: 'email' }); }

// ---------- base context ----------
async function counsellorCtx(userId: unknown) {
  const u = userId ? await User.findById(userId).lean() : null;
  return { counsellor_name: u?.name ?? 'La Europa Education', counsellor_designation: u?.designation ?? '', counsellor_id: u?.staff_code ?? '', counsellor_phone: u?.phone ?? '', counsellor_email: u?.email ?? '' };
}
async function pendingDocs(studentId: unknown) {
  const docs = await StudentDocument.find({ student_id: studentId, is_deleted: false, status: { $in: ['Pending', 'Rejected'] } }).lean();
  const types = await MasterItem.find({ _id: { $in: docs.map((d) => d.document_type_id) } }).select('name').lean();
  return docs.map((d) => d.title || types.find((t) => String(t._id) === String(d.document_type_id))?.name || 'Document');
}
async function baseCtx(t: { student?: IStudent | null; lead?: ILead | null }) {
  if (t.student) {
    const s = t.student;
    return { student_name: fullName(s), student_first_name: s.first_name, student_id: s.student_code, student_phone: `${s.country_code || ''} ${s.phone || ''}`.trim(),
      student_email: s.email, ...(await counsellorCtx(s.primary_counsellor_id)), portal_link: `${env.portalUrl}/`,
      passport_last4: (await getSetting('show_passport_last4')) === '1' && s.passport_last4 ? s.passport_last4 : '', pending_documents_list: ul(await pendingDocs(s._id)) };
  }
  const l = t.lead!;
  return { student_name: [l.first_name, l.last_name].filter(Boolean).join(' '), student_first_name: l.first_name, student_id: l.lead_code,
    student_phone: `${l.country_code || ''} ${l.phone || ''}`.trim(), student_email: l.email, ...(await counsellorCtx(l.assigned_user_id)) };
}

/** The student's portal login, for in-app notifications. */
export async function studentUserFor(student?: IStudent | null) {
  return student ? PortalAccount.findOne({ studentId: student._id, role: 'student', isActive: true }).lean() : null;
}
export async function studentNotify(accountId: unknown, title: string, link?: string | null) {
  if (!accountId) return;
  await Notification.create({ userId: accountId, type: 'student', title: String(title).slice(0, 300), body: '', link: link ?? undefined }).catch(() => {});
}

// ---------- trigger ----------
type TriggerOpts = { student_id?: unknown; lead_id?: unknown; ctx?: Record<string, unknown>; userId?: string; notify?: boolean; message?: string; force?: boolean;
  immediate?: boolean; noBatch?: boolean; noInApp?: boolean; inAppTitle?: string; resendOf?: unknown };
export async function trigger(code: string, opts: TriggerOpts) {
  const tpl = await getTemplate(code);
  if (!tpl) return { queued: false, reason: 'no template' };
  if (opts.notify === false) return { queued: false, reason: 'without notifying' };
  const student = opts.student_id ? await Student.findById(opts.student_id) : null;
  const lead = !student && opts.lead_id ? await Lead.findById(opts.lead_id) : null;
  if (!student && !lead) return { queued: false, reason: 'no recipient' };
  const ctx = safeCtx(opts.ctx || {});
  const su = await studentUserFor(student);
  // student-facing event: in-app notification in the portal, even when the email trigger is Off
  if (su && PORTAL_LINK[code] && !opts.noInApp) await studentNotify(su._id, opts.inAppTitle || render(tpl.update_title, { ...(await baseCtx({ student, lead })), ...ctx }), PORTAL_LINK[code]);
  if (!tpl.is_active && !opts.force) return { queued: false, reason: 'trigger off' };
  const to = student ? student.email : lead!.email;
  if (!to) return { queued: false, reason: 'no email' };
  if (student?.emails_paused) {
    await timeline({ student_id: student._id, type: 'email', description: `Email not sent (student emails paused): ${render(tpl.update_title, ctx)}`, user_id: opts.userId });
    return { queued: false, reason: 'paused' };
  }
  if (student?.email_status === 'Bounced') {
    await timeline({ student_id: student._id, type: 'email', description: `Email not sent (address bounced, please correct): ${tpl.update_title}`, user_id: opts.userId });
    return { queued: false, reason: 'bounced' };
  }
  const part: EmailPart = { code, ctx, message: opts.message ? String(opts.message).slice(0, 500) : null, at: new Date() };
  const windowMin = Math.max(0, Math.min(10, Number((await getSetting('batching_window_min')) || 2)));
  const key = student ? { student_id: student._id } : { lead_id: lead!._id };
  // batching: join an email for this person that has not gone out yet
  const open = !opts.noBatch && windowMin > 0 ? await EmailLog.findOne({ ...key, status: 'Queued', resend_of: null, scheduled_at: { $gt: new Date() } }).sort({ queued_at: 1 }) : null;
  if (open) {
    const parts = [...open.parts];
    const same = parts.find((p) => p.code === code && code === 'E10');
    if (same) same.ctx.verified_documents_items = [...((same.ctx.verified_documents_items as string[]) || []), ...((part.ctx.verified_documents_items as string[]) || [])];
    else parts.push(part);
    open.set({ parts, trigger_code: parts.length > 1 ? 'MULTI' : code }); open.markModified('parts'); await open.save();
    await refreshPreview(open);
    return { queued: true, id: String(open._id), batched: true };
  }
  const sched = opts.immediate ? new Date() : new Date(Date.now() + windowMin * 60_000);
  const log = await EmailLog.create({ ...key, trigger_code: code, channel: 'email', parts: [part], to_addr: to, cc_addr: HARD_CC, triggered_by: opts.userId,
    status: 'Queued', attempts: 0, queued_at: new Date(), scheduled_at: sched, next_attempt_at: sched, resend_of: opts.resendOf ?? undefined });
  await refreshPreview(log);
  return { queued: true, id: String(log._id) };
}

/** Fire a trigger respecting the user's "Save without notifying" choice (legacy services.fire). */
export async function fire(req: AuthRequest, code: string, target: { student_id?: unknown; lead_id?: unknown }, ctx: Record<string, unknown>, what: string, opts: { inAppTitle?: string } = {}) {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (b.notify === false || b.notify === 'false' || b.notify === '0') {
    await timeline({ ...target, type: 'email', description: `Saved without notifying: ${what}`, user_id: req.user!.id });
    await audit(req, 'Save without notifying', target.student_id ? 'Student' : 'Lead', target.student_id ?? target.lead_id, what);
    return null;
  }
  const r = await trigger(code, { ...target, ...opts, ctx, userId: req.user!.id, message: typeof b.message === 'string' ? b.message : undefined });
  return r.queued ? { id: r.id!, status: 'Queued' } : null;
}

// ---------- build: subject, one design, thread subject ----------
export async function build(log: Pick<IEmailLog, 'student_id' | 'lead_id' | 'parts'>) {
  const student = log.student_id ? await Student.findById(log.student_id) : null;
  const lead = !student && log.lead_id ? await Lead.findById(log.lead_id) : null;
  const base = await baseCtx({ student, lead });
  const rendered = await Promise.all((log.parts ?? []).map(async (p) => {
    const tpl = (await getTemplate(p.code)) ?? { update_title: '', body_html: '' };
    const ctx: Record<string, unknown> = { ...base, ...p.ctx };
    if (p.ctx.verified_documents_items) ctx.verified_documents_list = ul(p.ctx.verified_documents_items as string[]);
    ctx.optional_counsellor_message = p.message ? `<p style="background:#F5F6FB;border:1px solid #E6E8F0;padding:12px 14px;border-radius:14px"><b>Message from ${esc(base.counsellor_name)}:</b> ${esc(p.message)}</p>` : '';
    const title = render(tpl.update_title, ctx);
    return { code: p.code, title, body: render(tpl.body_html, { ...ctx, update_title: title }) + ctx.optional_counsellor_message };
  }));
  const updateTitle = rendered.length === 1 ? rendered[0].title : `${rendered[0]?.title ?? ''} (+${rendered.length - 1} more update${rendered.length > 2 ? 's' : ''})`;
  const bodyInner = rendered.length === 1 ? rendered[0].body
    : rendered.map((r, i) => `<h3 style="margin:20px 0 6px;font-size:16px;color:#5B56E9">${i + 1}. ${esc(r.title)}</h3>${r.body}`).join('<hr style="border:none;border-top:1px solid #E6E8F0">');
  const person = (student ?? lead)!;
  const subject = person.email_thread_subject || `La Europa Education | ${base.student_name} (${base.student_id}) | Your Study Abroad Updates`;
  const footer = render(String((await getSetting('email_footer')) ?? ''), base);
  const su = await studentUserFor(student);
  const firstLink = PORTAL_LINK[log.parts?.[0]?.code ?? ''];
  const viewUrl = su && firstLink && !log.parts.some((p) => p.code === 'E26') ? `${env.portalUrl}${firstLink}` : null;
  const html = page({ title: updateTitle, preheader: updateTitle, greeting: `Dear ${esc(base.student_first_name)},`, body: bodyInner,
    cta: viewUrl ? { url: viewUrl, label: 'View in your student portal' } : null,
    signature: `<p style="margin:0 0 10px">If you have any questions, simply reply to this email${base.counsellor_phone ? ` or call me on ${esc(base.counsellor_phone)}` : ''}.</p>
<p style="margin:0">Warm regards,<br><b>${esc(base.counsellor_name)}</b>${base.counsellor_designation ? `<br><span style="color:#5B6478">${esc(base.counsellor_designation)}</span>` : ''}<br>La Europa Education${base.counsellor_id ? `<br><span style="color:#5B6478">Counsellor ID: ${esc(base.counsellor_id)}</span>` : ''}${base.counsellor_phone ? `<br><span style="color:#5B6478">Phone: ${esc(base.counsellor_phone)}</span>` : ''}</p>`,
    footer });
  const text = htmlToText(html.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<div style="display:none[\s\S]*?<\/div>/, ''));
  return { subject, html, text, updateTitle, base, student, lead };
}
async function refreshPreview(log: IEmailLog) {
  try { const b = await build(log); await EmailLog.updateOne({ _id: log._id }, { subject: b.subject, body_html: b.html, body_text: b.text, update_title: b.updateTitle }); }
  catch { /* the preview is best-effort */ }
}
/** Preview without queuing (stage-change popups). */
export async function previewFor(code: string, opts: { student_id?: unknown; lead_id?: unknown; ctx?: Record<string, unknown>; message?: string }) {
  const tpl = await getTemplate(code);
  const b = await build({ student_id: opts.student_id as Types.ObjectId, lead_id: opts.lead_id as Types.ObjectId, parts: [{ code, ctx: safeCtx(opts.ctx || {}), message: opts.message ?? null, at: new Date() }] });
  const s = b.student ?? b.lead;
  return { active: !!tpl?.is_active, subject: b.subject, html: b.html, to: s?.email ?? null, cc: HARD_CC, update_title: b.updateTitle };
}

// ---------- worker: 1, 5 and 30 minutes between tries, then Failed ----------
const RETRY_MIN = [1, 5, 30];
let running = false;
export async function processQueue() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const due = await EmailLog.find({ status: { $in: ['Queued', 'Retrying'] }, $or: [{ next_attempt_at: { $lte: now } }, { next_attempt_at: null, scheduled_at: { $lte: now } }] }).sort({ queued_at: 1 }).limit(25);
    // one broken email never stops the others
    for (const log of due) {
      try { await sendOne(log); }
      catch (e) { await EmailLog.updateOne({ _id: log._id }, { status: 'Failed', $inc: { attempts: 1 }, error: String((e as Error).message).slice(0, 300) }); }
    }
  } finally { running = false; }
}
async function sendOne(log: IEmailLog) {
  // pre-rendered (announcements, staff notices): sent as it is, with the hard CC
  if (!log.parts?.length && log.body_html) return sendPrebuilt(log);
  const b = await build(log);
  const person = (b.student ?? b.lead)!;
  const domain = String(env.mail.from.match(/@([^>\s]+)/)?.[1] ?? 'vernyr.com');
  const code = b.student ? b.student.student_code : b.lead!.lead_code;
  const root = person.email_thread_root_id;
  const refs: string[] = person.email_refs ?? [];
  const messageId = root ? `<${code}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@${domain}>` : `<${code}.root@${domain}>`;
  const inReplyTo = root || undefined;
  const references = root ? [root, ...refs.filter((r) => r !== root)].slice(-10).join(' ') : undefined;
  const counsellorId = b.student ? b.student.primary_counsellor_id : b.lead!.assigned_user_id;
  const c = await counsellorCtx(counsellorId);
  const fromName = render(String((await getSetting('display_name_format')) ?? '{counsellor_name} | La Europa Education'), c).replace(/"/g, '');
  const fromAddr = env.mail.from.match(/<([^>]+)>/)?.[1] ?? env.mail.from;
  const from = `"${fromName}" <${fromAddr}>`;
  const cc = [HARD_CC];
  if (b.student && (await getSetting('parent_cc_enabled')) === '1' && b.student.parent_cc_email) cc.push(b.student.parent_cc_email);
  const attempts = (log.attempts || 0) + 1;
  try {
    const r = await send({ from, to: person.email!, cc, replyTo: c.counsellor_email || undefined, subject: b.subject, html: b.html, text: b.text, messageId, inReplyTo, references });
    await EmailLog.updateOne({ _id: log._id }, { status: r.status, attempts, sent_at: new Date(), message_id: messageId, in_reply_to: inReplyTo, references_hdr: references,
      subject: b.subject, body_html: b.html, body_text: b.text, update_title: b.updateTitle, from_addr: from, reply_to: c.counsellor_email || undefined, to_addr: person.email, cc_addr: cc.join(', '), $unset: { error: 1 } });
    const model = b.student ? Student : Lead;
    if (!root) await (model as typeof Student).updateOne({ _id: person._id }, { email_thread_root_id: messageId, email_thread_subject: b.subject });
    else await (model as typeof Student).updateOne({ _id: person._id }, { email_refs: [...refs, messageId].slice(-10) });
    await timeline({ student_id: b.student?._id, lead_id: b.lead?._id, type: 'email', description: `Email sent: ${b.updateTitle} to ${person.email}, CC ${HARD_CC}, status ${r.status}`, user_id: log.triggered_by ? String(log.triggered_by) : undefined });
  } catch (e) {
    const hard = e instanceof HardBounce;
    if (hard || attempts >= 4) {
      const status = hard ? 'Bounced' : 'Failed';
      await EmailLog.updateOne({ _id: log._id }, { status, attempts, error: String((e as Error).message).slice(0, 500), subject: b.subject, body_html: b.html, body_text: b.text, update_title: b.updateTitle });
      if (hard && b.student) await Student.updateOne({ _id: b.student._id }, { email_status: 'Bounced' });
      const link = b.student ? `/students/${b.student._id}/emails` : `/leads/${b.lead!._id}`;
      const title = `Email to ${b.base.student_name} ${hard ? 'bounced' : 'failed'}: ${String((e as Error).message).slice(0, 120)}`;
      if (counsellorId) await notify(counsellorId, 'email_failed', title, link);
      await notifyAdmins('email_failed', title, link);
      await timeline({ student_id: b.student?._id, lead_id: b.lead?._id, type: 'email', description: `Email ${status.toLowerCase()}: ${b.updateTitle} to ${person.email} (${String((e as Error).message).slice(0, 120)})`, user_id: log.triggered_by ? String(log.triggered_by) : undefined });
    } else {
      await EmailLog.updateOne({ _id: log._id }, { status: 'Retrying', attempts, error: String((e as Error).message).slice(0, 500), next_attempt_at: new Date(Date.now() + RETRY_MIN[attempts - 1] * 60_000) });
    }
  }
}
async function sendPrebuilt(log: IEmailLog) {
  const attempts = (log.attempts || 0) + 1;
  try {
    const r = await send({ to: String(log.to_addr), cc: [HARD_CC], subject: String(log.subject), html: log.body_html, text: log.body_text || htmlToText(log.body_html ?? '') });
    await EmailLog.updateOne({ _id: log._id }, { status: r.status, attempts, sent_at: new Date(), cc_addr: HARD_CC, $unset: { error: 1 } });
  } catch (e) {
    const done = e instanceof HardBounce || attempts >= 4;
    await EmailLog.updateOne({ _id: log._id }, done ? { status: e instanceof HardBounce ? 'Bounced' : 'Failed', attempts, error: String((e as Error).message).slice(0, 500) }
      : { status: 'Retrying', attempts, error: String((e as Error).message).slice(0, 500), next_attempt_at: new Date(Date.now() + RETRY_MIN[attempts - 1] * 60_000) });
  }
}
/** A branded email through the normal queue (announcements): always with the hard CC. */
export async function quickEmail(o: { to: (string | undefined | null)[]; subject: string; title: string; html: string; kind?: string; by?: string }) {
  const list = [...new Set(o.to.filter(Boolean).map((x) => String(x).toLowerCase()))];
  if (!list.length) return null;
  const body = page({ title: o.title, preheader: o.title, body: o.html, signature: '<p style="margin:0">Kind regards,<br><b>La Europa Education</b><br><span style="color:#5B6478">Euroverse Service LLP, trading as La Europa Education</span></p>' });
  const log = await EmailLog.create({ trigger_code: 'ANN', channel: 'email', recipient_type: o.kind ?? 'staff', parts: [], to_addr: list.join(', '), cc_addr: HARD_CC, triggered_by: o.by, status: 'Queued', attempts: 0,
    subject: o.subject, body_html: body, body_text: htmlToText(body), update_title: o.title, queued_at: new Date(), scheduled_at: new Date(), next_attempt_at: new Date() });
  return String(log._id);
}
export function startEmailWorker() {
  setInterval(() => { processQueue().catch((e) => console.error('[email queue]', e)); }, 10_000).unref();
}

export async function resend(logId: unknown, userId: string) {
  const log = await EmailLog.findById(logId);
  if (!log) throw new Error('Email not found');
  const copy = await EmailLog.create({ student_id: log.student_id, lead_id: log.lead_id, trigger_code: log.trigger_code, channel: log.channel, parts: log.parts, to_addr: log.to_addr,
    cc_addr: HARD_CC, triggered_by: userId, status: 'Queued', attempts: 0, queued_at: new Date(), scheduled_at: new Date(), next_attempt_at: new Date(), resend_of: log._id });
  await refreshPreview(copy);
  return String(copy._id);
}

export async function sendTest(code: string, admin: { id: string; name: string; email?: string }, draft?: { update_title: string; body_html: string } | null) {
  const tpl = draft ?? (await getTemplate(code));
  if (!tpl || !admin.email) throw new Error('Your account needs an email address to receive the test');
  const sample: Record<string, unknown> = { student_name: 'Riya Shah', student_first_name: 'Riya', student_id: 'LE-S-2026-00012', student_phone: '+91 98765 43210', student_email: admin.email,
    ...(await counsellorCtx(admin.id)), new_counsellor_name: admin.name, interested_country: 'Germany', lead_status_label: 'Interested',
    status_message: 'We will now help you with registration and the next steps.', followup_date: '20 Nov 2026', followup_time: '11:00 AM',
    university: 'TU Munich', course: 'MSc Data Science', intake: 'Sep 2027', country: 'Germany', stage: 'Applied', stage_message: 'Your application has been submitted.',
    applied_date: '14 Nov 2026', interview_datetime: '25 Nov 2026, 3:00 PM', interview_link: 'Zoom', offer_type: 'Conditional offer',
    offer_conditions_block: '<p>Conditions: Final semester marksheet</p>', document_name: 'Passport', rejection_reason: 'Unclear / blurred',
    verified_documents_list: ul(['Passport', 'CV']), pending_documents_list: ul(['SOP']), requested_documents_list: ul(['10th marksheet & certificate']),
    amount: '5,000', currency: 'EUR', payment_date: '14 Nov 2026', pending_amount: '0', visa_stage: 'Submitted', visa_stage_message: '',
    appointment_datetime: '01 Dec 2026, 10:00 AM', appointment_centre: 'VFS Mumbai', vfs_reference: 'VFS123', submission_date: '14 Nov 2026',
    visa_documents_list: ul(['Blocked account confirmation']), task_title: 'Send SOP draft', task_description: 'Please send your SOP draft.', due_date: '20 Nov 2026',
    next_step: 'Your counsellor will call you.', changed_fields_list: ul(['12th percentage']),
    shortlist_table: '<table border="1" cellpadding="6"><tr><td>Germany</td><td>TU Munich</td><td>MSc Data Science</td></tr></table>', include_reason_if_ticked: '' };
  const title = render(tpl.update_title, sample);
  const html = page({ title, tag: 'TEST', greeting: 'Dear Riya,', body: render(tpl.body_html, sample), signature: `<p style="margin:0">Warm regards,<br><b>${esc(String(sample.counsellor_name))}</b></p>` });
  const r = await send({ to: admin.email, cc: [HARD_CC], subject: `[TEST ${code}] La Europa Education | Riya Shah (LE-S-2026-00012) | Your Study Abroad Updates`, html, text: htmlToText(html) });
  return { ...r, cc: HARD_CC };
}

/** Provider delivery webhooks (Delivered / Opened / Bounced). */
export async function webhook(messageId: string, status: string) {
  if (!['Delivered', 'Opened', 'Bounced', 'Failed'].includes(status)) return false;
  const log = await EmailLog.findOne({ message_id: messageId });
  if (!log) return false;
  log.status = status; if (status === 'Delivered' && !log.delivered_at) log.delivered_at = new Date(); await log.save();
  if (status === 'Bounced' && log.student_id) await Student.updateOne({ _id: log.student_id }, { email_status: 'Bounced' });
  return true;
}

/** Security emails (codes, password changed): to the person only, no CC, own subject, not in the thread; the code is masked in the log. */
export async function sendSecurity(o: { to: string; subject: string; text: string; masked?: string; student_id?: unknown; lead_id?: unknown; attachments?: { filename: string; content: Buffer | string; contentType?: string }[] }) {
  const log = await EmailLog.create({ student_id: o.student_id, lead_id: o.lead_id, trigger_code: 'SEC', email_type: 'security', update_title: o.subject, to_addr: o.to, cc_addr: '',
    subject: o.subject, body_text: o.masked || o.text, status: 'Sending', queued_at: new Date(), parts: [] });
  try { const r = await send({ to: o.to, subject: o.subject, text: o.text, attachments: o.attachments }); await EmailLog.updateOne({ _id: log._id }, { status: r.status, sent_at: new Date(), attempts: 1 }); }
  catch (e) { await EmailLog.updateOne({ _id: log._id }, { status: 'Failed', error: String((e as Error).message).slice(0, 300), attempts: 1 }); }
}
