'use strict';
// University-facing and staff emails (University doc 12). Same EmailLog / queue / retry as student emails (server/email.js).
// Hard rules: CC laeuropaapplication@gmail.com always (constant in email.js), fixed thread subjects, only whitelisted placeholders, never student contact data.
const { all, get, run, insert, uuid, now, getSetting, addColumns } = require('../db');
const U = require('../util');
const email = require('../email');

addColumns('email_templates', ['audience TEXT']);

const T = {
  // university
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
  // staff
  E44: ['Staff', 'University requested more documents', 'Documents requested by {university_name}',
    '<p>{university_name} has requested more documents for {student_name} ({student_id}), application {application_code}:</p>{documents_list}<p>Message from the university: {university_message}</p><p>Needed by: {due_date}</p><p>Please share them from the University tab of the application, or request them from the student.</p>'],
  E45: ['Staff', 'University decision received', '{university_name}: {decision} for {student_name}',
    '<p>{university_name} has recorded "<b>{decision}</b>" for {student_name} ({student_id}), {course} ({intake}).</p><p>Student notification mode: {notify_mode}. {review_line}</p>'],
  E46: ['Staff', 'University announcement posted', 'Announcement from {university_name}: {announcement_title}',
    '<p>{university_name} has posted an announcement: <b>{announcement_title}</b></p><p>Type: {announcement_type}</p><p>{announcement_excerpt}</p><p>Open University announcements to publish it to counsellors or create a catalogue change.</p>'],
  E47: ['Staff', 'Partner agreement ending', 'Partner agreement ending on {agreement_end_date}',
    '<p>The partner agreement {agreement_code} with {university_name} ends on {agreement_end_date} ({days_left} days left). Please plan the renewal.</p>'],
  E48: ['Staff', 'Urgent catalogue change waiting for approval', 'University change waiting for approval: {university_name}',
    '<p>{university_name} has submitted a change that needs approval: {change_summary}.</p><p>Urgent: {urgent_reason}</p><p>Open University approvals to review.</p>']
};
const CODES = Object.keys(T);
const WL = { University: new Set(['university_name', 'university_user_name', 'portal_link', 'invite_link', 'unread_count', 'pending_summary', 'application_code', 'student_name', 'course', 'level',
  'campus', 'intake', 'submitted_date', 'documents_list', 'decision', 'withdraw_reason_for_university', 'letter_type', 'la_europa_contact_name', 'la_europa_contact_email', 'la_europa_contact_phone',
  'change_summary', 'change_status', 'reject_reason_block', 'announcement_title', 'announcement_type', 'announcement_excerpt', 'urgent_reason', 'agreement_code', 'agreement_end_date', 'days_left', 'update_title']) };
WL.Finance = new Set([...WL.University, 'invoice_number', 'invoice_date', 'invoice_total', 'currency', 'due_date', 'amount', 'payment_date', 'balance']);
WL.Staff = new Set([...WL.University, 'student_id', 'university_message', 'notify_mode', 'review_line', 'due_date']);
const FIN = new Set(['E35', 'E36', 'E37']);
const wlFor = (code) => FIN.has(code) ? WL.Finance : T[code] && T[code][0] === 'Staff' ? WL.Staff : WL.University;
const HTML = new Set(['documents_list', 'pending_summary', 'reject_reason_block', 'campus']);
function invalidPlaceholders(code, text) { const wl = wlFor(code); return [...new Set([...String(text || '').matchAll(/\{([a-z0-9_]+)\}/gi)].map(m => m[1]).filter(p => !wl.has(p)))]; }
function render(code, text, ctx) {
  const wl = wlFor(code);
  return String(text || '').replace(/\{([a-z0-9_]+)\}/gi, (m, k) => { if (!wl.has(k)) return ''; const v = ctx[k]; if (v === undefined || v === null) return ''; return HTML.has(k) ? String(v) : email.esc(v); });
}
function seed() {
  for (const [code, [aud, name, title, body]] of Object.entries(T)) {
    const t = email.getTemplate(code);
    if (!t) insert('email_templates', { trigger_code: code, channel: 'email', name, update_title: title, body_html: body, body_text: email.htmlToText(body), is_active: 1, version: 1, audience: aud });
    else if (!t.audience) run('UPDATE email_templates SET audience = ? WHERE id = ?', aud, t.id);
  }
}
const portalLink = () => (process.env.PARTNER_URL || getSetting('partner_portal_url') || ((process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 3000)) + '/university')).replace(/\/$/, '');

// ---------- queue a university / staff email ----------
// opts: { to: [emails], university_id, uapp_id, invoice_id, ctx, user_name, link, by }
function trigger(code, opts) {
  const tpl = email.getTemplate(code);
  if (!tpl) return { queued: false };
  if (!tpl.is_active && !opts.force) return { queued: false, reason: 'trigger off' };
  const to = [...new Set((opts.to || []).filter(Boolean).map(x => String(x).toLowerCase()))];
  if (!to.length) return { queued: false, reason: 'no recipient' };
  const u = opts.university_id ? get('SELECT * FROM universities WHERE id = ?', opts.university_id) : null;
  const ctx = { university_name: u ? (u.display_name || u.name) : '', portal_link: portalLink() + (opts.link || '/'), ...(opts.ctx || {}) };
  if (opts.uapp_id && !ctx.la_europa_contact_name) {
    const ua = get('SELECT * FROM university_applications WHERE id = ?', opts.uapp_id); const a = ua && get('SELECT * FROM applications WHERE id = ?', ua.application_id);
    const s = a && get('SELECT primary_counsellor_id, application_user_id FROM students WHERE id = ?', a.student_id);
    const c = s && get('SELECT name, email, mobile FROM users WHERE id = ?', a.handled_by || s.primary_counsellor_id);
    if (c) Object.assign(ctx, { la_europa_contact_name: c.name, la_europa_contact_email: c.email, la_europa_contact_phone: c.mobile || '' });
  }
  if (!ctx.la_europa_contact_name && u && u.partner_manager_id) { const c = get('SELECT name, email, mobile FROM users WHERE id = ?', u.partner_manager_id); if (c) Object.assign(ctx, { la_europa_contact_name: c.name, la_europa_contact_email: c.email, la_europa_contact_phone: c.mobile || '' }); }
  const title = render(code, tpl.update_title, ctx);
  const body = render(code, tpl.body_html, { ...ctx, update_title: title });
  const staff = T[code][0] === 'Staff';
  let subject, kind;
  if (staff) { kind = 'staff'; subject = `[University portal] ${title}${ctx.student_name ? ` | ${ctx.student_name}${ctx.student_id ? ' (' + ctx.student_id + ')' : ''}` : ''}`; }
  else if (FIN.has(code) && opts.invoice_id) { kind = 'invoice'; const inv = get('SELECT invoice_no FROM commission_invoices WHERE id = ?', opts.invoice_id); subject = `La Europa Education | Invoice ${inv.invoice_no} | ${ctx.university_name}`; }
  else if (opts.uapp_id && ['E31', 'E32', 'E33', 'E34', 'E40'].includes(code)) { kind = 'application'; subject = `La Europa Education | ${ctx.application_code} | ${ctx.student_name} | ${ctx.course} (${ctx.intake})`; }
  else { kind = 'partner'; subject = `La Europa Education | Partner updates | ${ctx.university_name}`; }
  const footer = getSetting('uni_email_footer') || 'This email is about applications submitted by La Europa Education. Please do not forward it outside your admissions team. Replies to this address are not read; please use the partner portal.';
  const html = require('../emailtheme').page({ title, tag: staff ? null : 'Partner portal', preheader: title,
    greeting: `Dear ${email.esc(opts.user_name || (staff ? 'team' : 'colleague'))},`, body,
    cta: { url: ctx.portal_link, label: `Open in the ${staff ? 'CRM' : 'partner portal'}` },
    signature: staff ? '' : `<p style="margin:0">Kind regards,<br><b>La Europa Education Partner Team</b><br><span style="color:#5B6478">Euroverse Service LLP, trading as La Europa Education</span>${ctx.la_europa_contact_name ? `<br><span style="color:#5B6478">Your La Europa contact: ${email.esc(ctx.la_europa_contact_name)} | ${email.esc(ctx.la_europa_contact_email)}${ctx.la_europa_contact_phone ? ' | ' + email.esc(ctx.la_europa_contact_phone) : ''}</span>` : ''}</p>`,
    footer: staff ? '' : `${email.esc(footer)}<br>Please reply in the La Europa partner portal: ${email.esc(portalLink())}`, footerHtml: true });
  const id = uuid();
  insert('email_logs', { id, trigger_code: code, channel: 'email', recipient_type: staff ? 'staff' : 'university', university_id: opts.university_id || null, uapp_id: opts.uapp_id || null,
    invoice_id: opts.invoice_id || null, thread_kind: kind, parts_json: '[]', to_addr: to.join(', '), cc_addr: email.HARD_CC, triggered_by: opts.by || null, status: 'Queued', attempts: 0,
    subject, body_html: html, body_text: email.htmlToText(html), update_title: title, queued_at: now(), scheduled_at: now(), next_attempt_at: now() });
  return { queued: true, id };
}

// Thread headers for university emails (12.3). Called by the worker in email.js.
function threadInfo(log) {
  const domain = getSetting('sending_domain') || 'laeuropa.example';
  const holder = log.thread_kind === 'application' && log.uapp_id ? ['university_applications', log.uapp_id, 'email_thread_root_id', 'email_refs_json']
    : log.thread_kind === 'invoice' && log.invoice_id ? ['commission_invoices', log.invoice_id, 'email_thread_root_id', 'email_refs_json']
      : log.thread_kind === 'partner' && log.university_id ? ['universities', log.university_id, 'partner_thread_root_id', 'partner_refs_json'] : null;
  if (!holder) return { messageId: `<uni.${Date.now()}.${uuid().slice(0, 8)}@${domain}>`, done: () => {} };
  const row = get(`SELECT ${holder[2]} root, ${holder[3]} refs FROM ${holder[0]} WHERE id = ?`, holder[1]) || {};
  const refs = U.parse(row.refs, []);
  const messageId = `<${log.thread_kind}.${holder[1].slice(0, 8)}.${Date.now()}.${uuid().slice(0, 6)}@${domain}>`;
  return { messageId, inReplyTo: row.root || undefined, references: row.root ? [row.root, ...refs.filter(r => r !== row.root)].slice(-10).join(' ') : undefined,
    done: () => { if (!row.root) run(`UPDATE ${holder[0]} SET ${holder[2]} = ? WHERE id = ?`, messageId, holder[1]); else run(`UPDATE ${holder[0]} SET ${holder[3]} = ? WHERE id = ?`, JSON.stringify([...refs, messageId].slice(-10)), holder[1]); } };
}
function fromAddr(log) {
  if (log.recipient_type === 'staff') return `"La Europa CRM" <${getSetting('sending_address')}>`;
  if (log.recipient_type === 'external') return `"La Europa Education" <${getSetting('sending_address')}>`;
  if (log.recipient_type === 'agent') return `"${(getSetting('agent_display_name') || 'La Europa Partner Team').replace(/"/g, '')}" <${getSetting('agent_sending_address') || getSetting('uni_sending_address') || getSetting('sending_address')}>`;
  const name = (getSetting('uni_display_name') || 'La Europa Education Partner Team').replace(/"/g, '');
  return `"${name}" <${getSetting('uni_sending_address') || getSetting('sending_address')}>`;
}
const noReply = () => getSetting('uni_noreply_address') || ('no-reply@' + (getSetting('sending_domain') || 'laeuropa.example'));

// Staff email helper: in-app notification already created by caller; email goes to the users' addresses
function staffEmail(code, userIds, opts) {
  const to = userIds.map(id => (get(`SELECT email FROM users WHERE id = ? AND status = 'active'`, id) || {}).email).filter(Boolean);
  return trigger(code, { ...opts, to });
}

module.exports = { T, CODES, WL, wlFor, invalidPlaceholders, render, seed, trigger, threadInfo, fromAddr, noReply, portalLink, staffEmail, FIN };
