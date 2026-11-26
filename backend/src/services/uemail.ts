import crypto from 'crypto';
import { EmailTemplate, EmailLog, type IEmailLog } from '../models/Email';
import University from '../models/University';
import User from '../models/User';
import Student from '../models/Student';
import { getSetting } from '../models/Audit';
import { Application } from '../models/Work';
import { CommissionInvoice, UniversityApplication } from '../models/Partner';
import { page, esc } from './emailTheme';
import { HARD_CC, htmlToText } from './email';
import { env } from '../config/env';

/** The client's university and partner-staff emails (legacy/server/university/uemail.js): E31 to E48, threaded per application, invoice or partner. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
export const T: Record<string, [string, string, string, string]> = {
  E31: ['University', 'Application submitted to the university portal', 'New application from La Europa Education: {course} ({intake})',
    '<p>La Europa Education has submitted a new application to {university_name}.</p><p>Application: <b>{application_code}</b><br>Student: {student_name}<br>Course: {course} ({level}){campus}<br>Intake: {intake}<br>Submitted on: {submitted_date}</p><p>The student\'s academic summary and the documents shared by La Europa are available in the partner portal.</p>'],
  E32: ['University', 'La Europa sent requested documents', 'Documents received from La Europa: {application_code}',
    '<p>La Europa has shared the documents you requested for application {application_code} ({student_name}, {course}):</p>{documents_list}<p>Please review them in the partner portal.</p>'],
  E33: ['University', 'Unread La Europa message (15 minutes)', 'New message from La Europa Education',
    '<p>You have {unread_count} new message(s) from La Europa Education about application {application_code}. Please log in to the partner portal to read and reply.</p>'],
  E34: ['University', 'Offer acceptance confirmed by La Europa', 'Offer accepted: {student_name}, {course}',
    '<p>The student {student_name} has accepted your offer for {course} ({intake}). La Europa Education confirms the acceptance on the student\'s behalf.</p><p>Next step: please share the deposit / tuition payment details in the portal if not already shared, and mark the deposit when received.</p>'],
  E35: ['University', 'Commission invoice / credit note issued', 'Invoice {invoice_number} from La Europa Education',
    '<p>Please find invoice {invoice_number} dated {invoice_date} from Euroverse Service LLP, trading as La Europa Education.</p><p>Total: <b>{invoice_total} {currency}</b><br>Due date: {due_date}</p><p>The invoice PDF and line details are available in the partner portal (Commission and Invoices). When you pay, please upload the payment proof in the portal.</p>'],
  E36: ['University', 'Invoice payment reminder', 'Payment reminder: invoice {invoice_number}',
    '<p>This is a reminder that invoice {invoice_number} for {invoice_total} {currency} is due on {due_date}. Balance: {balance} {currency}.</p><p>If you have already paid, please upload the payment proof in the partner portal. If you have a question, please raise a query on the invoice.</p>'],
  E37: ['University', 'Commission payment confirmed', 'Payment received: invoice {invoice_number}',
    '<p>Thank you. We have received {amount} {currency} on {payment_date} for invoice {invoice_number}. Balance: {balance} {currency}.</p>'],
  E38: ['University', 'Portal invite to a university user', 'Your La Europa partner portal account',
    '<p>La Europa Education has created a partner portal account for you at {university_name}.</p><p><a href="{invite_link}" style="background:#5B56E9;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;display:inline-block">Set up my account</a></p><p>For your security, we will send a verification code to your email when you open the link. The link is valid for 7 days.</p>'],
  E39: ['University', 'Change request approved / rejected', 'Update on your change request: {change_summary}',
    '<p>Your change request "{change_summary}" has been <b>{change_status}</b> by La Europa Education.</p>{reject_reason_block}<p>Approved changes are now visible to students in La Europa\'s course search.</p>'],
  E40: ['University', 'Application withdrawn by La Europa', 'Application withdrawn: {application_code}',
    '<p>La Europa Education has withdrawn application {application_code} ({student_name}, {course}, {intake}).</p><p>Reason: {withdraw_reason_for_university}</p><p>No further action is needed on this application.</p>'],
  E41: ['University', 'Daily pending actions digest', 'Your pending La Europa applications',
    '<p>Here is a summary of La Europa applications waiting for your action:</p>{pending_summary}'],
  E44: ['Staff', 'University requested more documents', 'Documents requested by {university_name}',
    '<p>{university_name} has requested more documents for {student_name} ({student_id}), application {application_code}:</p>{documents_list}<p>Message from the university: {university_message}</p><p>Needed by: {due_date}</p><p>Please share them from the University tab of the application, or request them from the student.</p>'],
  E45: ['Staff', 'University decision received', '{university_name}: {decision} for {student_name}',
    '<p>{university_name} has recorded "<b>{decision}</b>" for {student_name} ({student_id}), {course} ({intake}).</p><p>Student notification mode: {notify_mode}. {review_line}</p>'],
  E46: ['Staff', 'University announcement posted', 'Announcement from {university_name}: {announcement_title}',
    '<p>{university_name} has posted an announcement: <b>{announcement_title}</b></p><p>Type: {announcement_type}</p><p>{announcement_excerpt}</p><p>Open University announcements to publish it to counsellors or create a catalogue change.</p>'],
  E47: ['Staff', 'Partner agreement ending', 'Partner agreement ending on {agreement_end_date}',
    '<p>The partner agreement {agreement_code} with {university_name} ends on {agreement_end_date} ({days_left} days left). Please plan the renewal.</p>'],
  E48: ['Staff', 'Urgent catalogue change waiting for approval', 'University change waiting for approval: {university_name}',
    '<p>{university_name} has submitted a change that needs approval: {change_summary}.</p><p>Urgent: {urgent_reason}</p><p>Open University approvals to review.</p>'],
};
export const CODES = Object.keys(T);
const UNI_WL = ['university_name', 'university_user_name', 'portal_link', 'invite_link', 'unread_count', 'pending_summary', 'application_code', 'student_name', 'course', 'level',
  'campus', 'intake', 'submitted_date', 'documents_list', 'decision', 'withdraw_reason_for_university', 'letter_type', 'la_europa_contact_name', 'la_europa_contact_email', 'la_europa_contact_phone',
  'change_summary', 'change_status', 'reject_reason_block', 'announcement_title', 'announcement_type', 'announcement_excerpt', 'urgent_reason', 'agreement_code', 'agreement_end_date', 'days_left', 'update_title'];
export const WL = { University: new Set(UNI_WL), Finance: new Set([...UNI_WL, 'invoice_number', 'invoice_date', 'invoice_total', 'currency', 'due_date', 'amount', 'payment_date', 'balance']),
  Staff: new Set([...UNI_WL, 'student_id', 'university_message', 'notify_mode', 'review_line', 'due_date']) };
export const FIN = new Set(['E35', 'E36', 'E37']);
export const wlFor = (code: string) => (FIN.has(code) ? WL.Finance : T[code]?.[0] === 'Staff' ? WL.Staff : WL.University);
const HTML = new Set(['documents_list', 'pending_summary', 'reject_reason_block', 'campus']);
export const invalidPlaceholders = (code: string, text: string) => { const wl = wlFor(code); return [...new Set([...String(text || '').matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1]).filter((p) => !wl.has(p)))]; };
export function render(code: string, text: string, ctx: Any) {
  const wl = wlFor(code);
  return String(text || '').replace(/\{([a-z0-9_]+)\}/gi, (_m, k) => { if (!wl.has(k)) return ''; const v = ctx[k]; if (v === undefined || v === null) return ''; return HTML.has(k) ? String(v) : esc(v); });
}
let seeded: Promise<void> | null = null;
export function seed() {
  seeded ??= (async () => {
    for (const [code, [aud, name, title, body]] of Object.entries(T)) {
      await EmailTemplate.updateOne({ trigger_code: code, channel: 'email' }, { $setOnInsert: { trigger_code: code, channel: 'email', name, update_title: title, body_html: body, body_text: htmlToText(body), is_active: true, version: 1, audience: aud } }, { upsert: true });
    }
  })().catch((e) => { seeded = null; throw e; });
  return seeded;
}
export const portalLink = async () => String((await getSetting('partner_portal_url')) || env.partnerUrl).replace(/\/$/, '');
const contactOf = async (id: unknown) => (id ? ((await User.findById(id).select('name email mobile').lean()) as Any) : null);

type TriggerOpts = { to: (string | null | undefined)[]; university_id?: unknown; uapp_id?: unknown; invoice_id?: unknown; ctx?: Any; user_name?: string; link?: string; by?: unknown; force?: boolean };
/** queue a university / partner-staff email; the worker sends it threaded with the university's sender address */
export async function trigger(code: string, opts: TriggerOpts) {
  await seed();
  const tpl = await EmailTemplate.findOne({ trigger_code: code, channel: 'email' }).lean();
  if (!tpl) return { queued: false };
  if (!tpl.is_active && !opts.force) return { queued: false, reason: 'trigger off' };
  const to = [...new Set((opts.to || []).filter(Boolean).map((x) => String(x).toLowerCase()))];
  if (!to.length) return { queued: false, reason: 'no recipient' };
  const u = opts.university_id ? ((await University.findById(opts.university_id).lean()) as Any) : null;
  const ctx: Any = { university_name: u ? u.display_name || u.name : '', portal_link: (await portalLink()) + (opts.link || '/'), ...(opts.ctx || {}) };
  if (opts.uapp_id && !ctx.la_europa_contact_name) {
    const ua = (await UniversityApplication.findById(opts.uapp_id).lean()) as Any;
    const a = ua ? ((await Application.findById(ua.application_id).lean()) as Any) : null;
    const s = a ? ((await Student.findById(a.student_id).select('primary_counsellor_id').lean()) as Any) : null;
    const c = await contactOf(a?.handled_by || s?.primary_counsellor_id);
    if (c) Object.assign(ctx, { la_europa_contact_name: c.name, la_europa_contact_email: c.email, la_europa_contact_phone: c.mobile || '' });
  }
  if (!ctx.la_europa_contact_name && u?.partner_manager_id) { const c = await contactOf(u.partner_manager_id); if (c) Object.assign(ctx, { la_europa_contact_name: c.name, la_europa_contact_email: c.email, la_europa_contact_phone: c.mobile || '' }); }
  const title = render(code, tpl.update_title, ctx);
  const body = render(code, tpl.body_html, { ...ctx, update_title: title });
  const staff = T[code]?.[0] === 'Staff';
  let subject: string, kind: string;
  if (staff) { kind = 'staff'; subject = `[University portal] ${title}${ctx.student_name ? ` | ${ctx.student_name}${ctx.student_id ? ' (' + ctx.student_id + ')' : ''}` : ''}`; }
  else if (FIN.has(code) && opts.invoice_id) { kind = 'invoice'; const inv = (await CommissionInvoice.findById(opts.invoice_id).select('invoice_no').lean()) as Any; subject = `La Europa Education | Invoice ${inv?.invoice_no ?? ''} | ${ctx.university_name}`; }
  else if (opts.uapp_id && ['E31', 'E32', 'E33', 'E34', 'E40'].includes(code)) { kind = 'application'; subject = `La Europa Education | ${ctx.application_code} | ${ctx.student_name} | ${ctx.course} (${ctx.intake})`; }
  else { kind = 'partner'; subject = `La Europa Education | Partner updates | ${ctx.university_name}`; }
  const footer = (await getSetting('uni_email_footer')) || 'This email is about applications submitted by La Europa Education. Please do not forward it outside your admissions team. Replies to this address are not read; please use the partner portal.';
  const contact = ctx.la_europa_contact_name ? `<br><span style="color:#5B6478">Your La Europa contact: ${esc(ctx.la_europa_contact_name)} | ${esc(ctx.la_europa_contact_email)}${ctx.la_europa_contact_phone ? ' | ' + esc(ctx.la_europa_contact_phone) : ''}</span>` : '';
  const html = page({ title, tag: staff ? undefined : 'Partner portal', preheader: title, greeting: `Dear ${esc(opts.user_name || (staff ? 'team' : 'colleague'))},`, body,
    cta: { url: ctx.portal_link, label: `Open in the ${staff ? 'CRM' : 'partner portal'}` },
    signature: staff ? '' : `<p style="margin:0">Kind regards,<br><b>La Europa Education Partner Team</b><br><span style="color:#5B6478">Euroverse Service LLP, trading as La Europa Education</span>${contact}</p>`,
    footer: staff ? '' : `${esc(footer)}<br>Please reply in the La Europa partner portal: ${esc(await portalLink())}` });
  const log = await EmailLog.create({ trigger_code: code, channel: 'email', recipient_type: staff ? 'staff' : 'university', university_id: opts.university_id || undefined, uapp_id: opts.uapp_id || undefined,
    invoice_id: opts.invoice_id || undefined, thread_kind: kind, parts: [], to_addr: to.join(', '), cc_addr: HARD_CC, triggered_by: opts.by || undefined, status: 'Queued', attempts: 0,
    subject, body_html: html, body_text: htmlToText(html), update_title: title, queued_at: new Date(), scheduled_at: new Date(), next_attempt_at: new Date() });
  return { queued: true, id: String(log._id) };
}
/** staff partner emails go to the users' own addresses (their in-app notice was created by the caller) */
export async function staffEmail(code: string, userIds: unknown[], opts: Omit<TriggerOpts, 'to'>) {
  const to = (await User.find({ _id: { $in: userIds.filter(Boolean) }, isActive: true }).select('email').lean()).map((u: Any) => u.email);
  return trigger(code, { ...opts, to });
}

/** thread headers and sender for a university / partner email (12.3); called by the email worker */
export async function threadInfo(log: IEmailLog) {
  const domain = String((await getSetting('sending_domain')) || env.mail.from.match(/@([^>\s]+)/)?.[1] || 'vernyr.com');
  const holder = log.thread_kind === 'application' && log.uapp_id ? { model: UniversityApplication, id: log.uapp_id, root: 'email_thread_root_id', refs: 'email_refs' }
    : log.thread_kind === 'invoice' && log.invoice_id ? { model: CommissionInvoice, id: log.invoice_id, root: 'email_thread_root_id', refs: 'email_refs' }
      : log.thread_kind === 'partner' && log.university_id ? { model: University, id: log.university_id, root: 'partner_thread_root_id', refs: 'partner_refs' } : null;
  const tag = crypto.randomBytes(4).toString('hex');
  if (!holder) return { messageId: `<uni.${Date.now()}.${tag}@${domain}>`, done: async () => {} };
  const row = ((await (holder.model as any).findById(holder.id).select(`${holder.root} ${holder.refs}`).lean()) ?? {}) as Any;
  const refs: string[] = row[holder.refs] ?? [];
  const messageId = `<${log.thread_kind}.${String(holder.id).slice(-8)}.${Date.now()}.${tag}@${domain}>`;
  return { messageId, inReplyTo: row[holder.root] || undefined, references: row[holder.root] ? [row[holder.root], ...refs.filter((r) => r !== row[holder.root])].slice(-10).join(' ') : undefined,
    done: async () => { await (holder.model as any).updateOne({ _id: holder.id }, row[holder.root] ? { [holder.refs]: [...refs, messageId].slice(-10) } : { [holder.root]: messageId }); } };
}
export async function fromAddr(log: IEmailLog) {
  const base = (await getSetting('sending_address')) || env.mail.from.match(/<([^>]+)>/)?.[1] || env.mail.from;
  if (log.recipient_type === 'staff') return `"La Europa CRM" <${base}>`;
  const name = String((await getSetting('uni_display_name')) || 'La Europa Education Partner Team').replace(/"/g, '');
  return `"${name}" <${(await getSetting('uni_sending_address')) || base}>`;
}
