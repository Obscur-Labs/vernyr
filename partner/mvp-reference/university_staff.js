'use strict';
const VAULT = require('../vault'); // files are stored AES-256-GCM encrypted
// La Europa side of the university portal (University doc 13: C12 - C30, screens S42 - S53).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const { all, get, run, insert, update, uuid, now, nextCode, getSetting, setSetting, tx, DATA_DIR } = require('../db');
const U = require('../util');
const { bad, ah, forbidden, clean, num, audit, timeline, notify, masterName, fullName, fmtDate, fmtDateTime, isEmail, fieldErr, userName } = U;
const { isAdmin, loadChild, loadStudent, need } = require('../rbac');
const email = require('../email');
const files = require('../files');
const C = require('../university/common');
const A = require('../university/actions');
const UE = require('../university/uemail');
const UA = require('../university/auth');
const AP = require('../university/approvals');
const CONSENT = require('../portal/consent');
const CAT = require('../portal/catalogue');

const r = express.Router();
const adminOnly = (req) => { if (!isAdmin(req.user)) throw forbidden(); };
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';

// =====================================================================================
// S42 University accounts (Admin)
// =====================================================================================
function accountOut(u, full) {
  const ag = C.activeAgreement(u.id);
  const anyAg = get(`SELECT status, end_date FROM partner_agreements WHERE university_id = ? AND is_deleted = 0 ORDER BY start_date DESC LIMIT 1`, u.id);
  const base = { id: u.id, name: u.name, display_name: u.display_name || u.name, account_code: u.account_code, country: masterName(u.country_id), city: u.city, logo: CAT.logoUrl(u),
    portal_status: u.portal_status || 'None', agreement_status: ag ? ag.status : anyAg ? anyAg.status : 'None', partner_manager: userName(u.partner_manager_id), partner_manager_id: u.partner_manager_id,
    users: get(`SELECT COUNT(*) c FROM uni_users WHERE university_id = ? AND status IN ('Active','Invited') AND is_deleted = 0`, u.id).c,
    applications: get('SELECT COUNT(*) c FROM university_applications WHERE university_id = ? AND is_deleted = 0', u.id).c };
  if (!full) return base;
  return { ...base, settings: { notify_mode: u.notify_mode || 'review', share_contact: !!u.share_contact, share_passport: !!u.share_passport, share_visa: !!u.share_visa, viewer_docs: !!u.viewer_docs,
    officers_propose: u.officers_propose !== 0, max_users: u.max_users || 10, doc_access_rule: u.doc_access_rule || 'enrolment', doc_access_months: u.doc_access_months, watermark: u.watermark !== 0, zip_download: u.zip_download !== 0,
    enrol_from_accepted: !!u.enrol_from_accepted, ip_allowlist: u.ip_allowlist, show_expected_commission: !!u.show_expected_commission, viewer_exports: u.viewer_exports !== 0, legal_name: u.legal_name, billing_address: u.billing_address, vat_id: u.vat_id, timezone: u.timezone },
    internal_note: u.uni_internal_note, suspend_reason: u.suspend_reason,
    users_list: all('SELECT * FROM uni_users WHERE university_id = ? AND is_deleted = 0 ORDER BY role, name', u.id).map(x => ({ id: x.id, name: x.name, email: x.email, role: x.role, role_label: C.ROLE_LABEL[x.role], finance: !!(x.finance || x.role === 'admin'),
      status: x.status, last_login_at: x.last_login_at, twofa: !!x.twofa_ready, main: !!x.is_main_contact, locked: x.locked_until && new Date(x.locked_until) > new Date() })),
    agreements: all('SELECT id, agreement_code, title, start_date, end_date, status, signed_on FROM partner_agreements WHERE university_id = ? AND is_deleted = 0 ORDER BY start_date DESC', u.id),
    consents: all('SELECT c.doc_type, c.version, c.created_at, uu.name FROM uni_consents c JOIN uni_users uu ON uu.id = c.uni_user_id WHERE c.university_id = ? ORDER BY c.created_at DESC LIMIT 50', u.id),
    activity: all(`SELECT action, entity_type, entity_label, ip, created_at, actor_type, user_id FROM audit_log WHERE university_id = ? ORDER BY id DESC LIMIT 100`, u.id).map(x => ({ ...x, who: x.actor_type === 'university' ? (get('SELECT name FROM uni_users WHERE id = ?', x.user_id) || {}).name : userName(x.user_id) })),
    no_agreement: !C.activeAgreement(u.id) };
}
r.get('/admin/uni-accounts', ah(async (req, res) => {
  adminOnly(req);
  const rows = all('SELECT * FROM universities WHERE is_deleted = 0 ORDER BY (portal_status IS NULL), name').map(u => accountOut(u));
  res.json({ rows, staff: all(`SELECT u.id, u.name FROM users u JOIN roles r0 ON r0.id = u.role_id WHERE u.status = 'active' AND u.is_deleted = 0 AND r0.code IN ('admin','counsellor') ORDER BY u.name`) });
}));
r.get('/admin/uni-accounts/:id', ah(async (req, res) => { adminOnly(req); const u = C.uni(req.params.id); if (!u) throw U.notFound(); res.json(accountOut(u, true)); }));
const freeMail = (em) => /@(gmail|yahoo|hotmail|outlook|live|icloud|aol|rediffmail|proton(mail)?)\./i.test(em || '');
r.post('/admin/uni-accounts', ah(async (req, res) => {
  adminOnly(req);
  const b = req.body; const u = C.uni(b.university_id); if (!u) throw fieldErr('university_id', 'Choose the university');
  const creating = !u.portal_status || u.portal_status === 'None';
  const e = {};
  if (!clean(b.display_name)) e.display_name = 'Portal display name is required';
  if (creating) { if (!clean(b.contact_name)) e.contact_name = 'Main contact name is required'; if (!isEmail(b.contact_email)) e.contact_email = 'Valid email is required';
    else if (get('SELECT 1 x FROM uni_users WHERE lower(email) = lower(?)', b.contact_email)) e.contact_email = 'This email already has a university account'; else if (get('SELECT 1 x FROM users WHERE lower(email) = lower(?)', b.contact_email)) e.contact_email = 'This is a La Europa staff email'; }
  if (!b.partner_manager_id) e.partner_manager_id = 'Choose the La Europa partner manager';
  if (!(num(b.max_users) >= 1 && num(b.max_users) <= 100)) e.max_users = '1 to 100';
  if (bool(b.share_contact) && !u.share_contact && !clean(b.share_contact_reason)) e.share_contact_reason = 'Reason is required to share student contact details';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const f = { display_name: clean(b.display_name, 150), partner_manager_id: b.partner_manager_id, notify_mode: b.notify_mode === 'automatic' ? 'automatic' : 'review', share_contact: bool(b.share_contact) ? 1 : 0,
    share_passport: bool(b.share_passport) ? 1 : 0, share_visa: bool(b.share_visa) ? 1 : 0, viewer_docs: bool(b.viewer_docs) ? 1 : 0, officers_propose: b.officers_propose === undefined ? 1 : bool(b.officers_propose) ? 1 : 0,
    max_users: num(b.max_users), doc_access_rule: ['enrolment', 'intake'].includes(b.doc_access_rule) ? b.doc_access_rule : 'enrolment', doc_access_months: num(b.doc_access_months), uni_internal_note: clean(b.internal_note, 3000),
    watermark: b.watermark === undefined ? 1 : bool(b.watermark) ? 1 : 0, zip_download: b.zip_download === undefined ? 1 : bool(b.zip_download) ? 1 : 0, enrol_from_accepted: bool(b.enrol_from_accepted) ? 1 : 0,
    ip_allowlist: clean(b.ip_allowlist, 500), show_expected_commission: bool(b.show_expected_commission) ? 1 : 0, viewer_exports: b.viewer_exports === undefined ? 1 : bool(b.viewer_exports) ? 1 : 0,
    legal_name: clean(b.legal_name, 200), billing_address: clean(b.billing_address, 500), vat_id: clean(b.vat_id, 60), timezone: clean(b.timezone, 60) };
  const changed = Object.keys(f).filter(k => String(u[k] ?? '') !== String(f[k] ?? ''));
  tx(() => {
    if (creating) { const n = get(`SELECT COUNT(*) c FROM universities WHERE account_code IS NOT NULL`).c + 1; f.account_code = `LE-U-${String(n).padStart(5, '0')}`; f.portal_status = 'Draft'; }
    update('universities', u.id, f, req.user.id);
    if (creating) insert('uni_users', { id: uuid(), university_id: u.id, name: clean(b.contact_name, 100), email: String(b.contact_email).trim().toLowerCase(), phone: clean(b.contact_phone, 30), designation: clean(b.contact_designation, 100),
      role: 'admin', finance: 1, status: 'Invited', is_main_contact: 1, alerts_json: JSON.stringify(['applications', 'messages', 'deadlines', 'finance']) }, req.user.id);
  });
  if (changed.some(k => ['share_contact', 'share_passport', 'share_visa', 'notify_mode', 'viewer_docs'].includes(k))) C.uaudit(req, 'Update', 'UniversitySettings', u.id, `Settings changed: ${changed.join(', ')}${b.share_contact_reason ? ' (reason: ' + clean(b.share_contact_reason, 300) + ')' : ''}`, null, null, u.id);
  else C.uaudit(req, creating ? 'Create' : 'Update', 'UniversityAccount', u.id, f.display_name, null, null, u.id);
  let invite = null;
  if (b.action === 'invite') invite = await inviteMain(req, u.id, b.override_reason);
  res.json({ ok: true, warning: creating && freeMail(b.contact_email) ? 'This looks like a free mail address. An official university domain is recommended.' : null, invite });
}));
async function inviteMain(req, uniId, override) {
  const u = C.uni(uniId);
  if (!C.activeAgreement(uniId)) { if (!clean(override)) throw bad('There is no Active partner agreement. Record the agreement first, or give an override reason (for example "agreement under signature").', { needs_override: true });
    run('UPDATE universities SET override_reason = ? WHERE id = ?', clean(override, 300), uniId); C.uaudit(req, 'Override', 'UniversityAccount', uniId, `Invite without active agreement: ${override}`, null, null, uniId); }
  const main = get(`SELECT * FROM uni_users WHERE university_id = ? AND is_main_contact = 1 AND is_deleted = 0`, uniId);
  if (!main) throw bad('No main contact found');
  if (main.status !== 'Invited') throw bad('The main contact has already activated the account');
  const out = await UA.issueInvite(main.id);
  if (['Draft', null, undefined].includes(u.portal_status)) run(`UPDATE universities SET portal_status = 'Invited' WHERE id = ?`, uniId);
  C.uaudit(req, 'Invite', 'UniversityUser', main.id, main.email, null, null, uniId);
  return { sent_to: main.email, link: process.env.MAIL_PROVIDER === 'smtp' ? undefined : out.link };
}
r.post('/admin/uni-accounts/:id/:action(invite|suspend|reactivate|close|preview)', ah(async (req, res) => {
  adminOnly(req); const u = C.uni(req.params.id); if (!u || !u.portal_status) throw U.notFound();
  const a = req.params.action;
  if (a === 'invite') return res.json(await inviteMain(req, u.id, req.body.override_reason));
  if (a === 'suspend') { if (!clean(req.body.reason)) throw fieldErr('reason', 'Reason is required'); run(`UPDATE universities SET portal_status = 'Suspended', suspend_reason = ? WHERE id = ?`, clean(req.body.reason, 300), u.id);
    run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id IN (SELECT id FROM uni_users WHERE university_id = ?)', u.id); }
  if (a === 'reactivate') run(`UPDATE universities SET portal_status = CASE WHEN EXISTS (SELECT 1 FROM uni_users WHERE university_id = ? AND status = 'Active') THEN 'Active' ELSE 'Invited' END, suspend_reason = NULL WHERE id = ?`, u.id, u.id);
  if (a === 'close') { if (String(req.body.confirm_name || '').trim().toLowerCase() !== String(u.display_name || u.name).trim().toLowerCase()) throw fieldErr('confirm_name', 'Type the university name exactly to confirm');
    run(`UPDATE universities SET portal_status = 'Closed' WHERE id = ?`, u.id); run(`UPDATE uni_users SET status = 'Inactive' WHERE university_id = ?`, u.id); run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id IN (SELECT id FROM uni_users WHERE university_id = ?)', u.id); }
  if (a === 'preview') { // View as university: read only, logged
    const uu = get(`SELECT * FROM uni_users WHERE university_id = ? AND status = 'Active' AND is_deleted = 0 ORDER BY (role = 'admin') DESC LIMIT 1`, u.id);
    if (!uu) throw bad('No active university user yet');
    const token = crypto.randomBytes(32).toString('base64url');
    insert('uni_codes', { id: uuid(), uni_user_id: uu.id, purpose: 'preview', code_hash: UA.sha(token), expires_at: new Date(Date.now() + 120e3).toISOString(), payload_json: JSON.stringify({ by: req.user.id }), created_at: now() });
    C.uaudit(req, 'View as university', 'UniversityAccount', u.id, C.uniName(u), null, null, u.id);
    return res.json({ url: `/api/university/auth/preview?token=${token}` });
  }
  C.uaudit(req, 'Update', 'UniversityAccount', u.id, `${a}${req.body.reason ? ': ' + clean(req.body.reason, 300) : ''}`, null, null, u.id);
  res.json({ ok: true });
}));
// users tab on S42
r.post('/admin/uni-accounts/:id/users', ah(async (req, res) => {
  adminOnly(req); const u = C.uni(req.params.id); if (!u) throw U.notFound();
  const b = req.body;
  if (!clean(b.name)) throw fieldErr('name', 'Name is required'); if (!isEmail(b.email)) throw fieldErr('email', 'Valid email is required');
  if (get('SELECT 1 x FROM uni_users WHERE lower(email) = lower(?)', b.email) || get('SELECT 1 x FROM users WHERE lower(email) = lower(?)', b.email)) throw fieldErr('email', 'This email is already used');
  if (!['admin', 'officer', 'viewer'].includes(b.role)) throw fieldErr('role', 'Choose a role');
  const n = get(`SELECT COUNT(*) c FROM uni_users WHERE university_id = ? AND status IN ('Invited','Active') AND is_deleted = 0`, u.id).c; if (n >= (u.max_users || 10)) throw bad('The user limit of this university is reached.');
  const id = insert('uni_users', { id: uuid(), university_id: u.id, name: clean(b.name, 100), email: String(b.email).trim().toLowerCase(), role: b.role, finance: b.role === 'admin' || bool(b.finance) ? 1 : 0, status: 'Invited' }, req.user.id);
  if (u.portal_status === 'Active' || u.portal_status === 'Invited') await UA.issueInvite(id);
  C.uaudit(req, 'Create', 'UniversityUser', id, b.email, null, null, u.id); res.json({ ok: true });
}));
r.post('/admin/uni-users/:uid/:action(deactivate|activate|reset2fa|logout|resend|role)', ah(async (req, res) => {
  adminOnly(req); const x = get('SELECT * FROM uni_users WHERE id = ? AND is_deleted = 0', req.params.uid); if (!x) throw U.notFound();
  const a = req.params.action;
  if (a === 'deactivate') { if (x.role === 'admin' && !get(`SELECT 1 y FROM uni_users WHERE university_id = ? AND role = 'admin' AND status = 'Active' AND id != ? AND is_deleted = 0`, x.university_id, x.id) && C.uni(x.university_id).portal_status === 'Active') throw bad('The last active University Admin cannot be deactivated.');
    run(`UPDATE uni_users SET status = 'Inactive' WHERE id = ?`, x.id); run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ?', x.id); }
  if (a === 'activate') run(`UPDATE uni_users SET status = CASE WHEN password_hash IS NULL THEN 'Invited' ELSE 'Active' END, locked_until = NULL WHERE id = ?`, x.id);
  if (a === 'reset2fa') { run('UPDATE uni_users SET twofa_ready = 0, totp_secret_enc = NULL, backup_codes_json = NULL WHERE id = ?', x.id); run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ?', x.id); run('DELETE FROM uni_trusted_devices WHERE uni_user_id = ?', x.id); }
  if (a === 'logout') run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ?', x.id);
  if (a === 'resend') { if (x.status !== 'Invited') throw bad('This user already activated the account'); await UA.issueInvite(x.id); }
  if (a === 'role') { if (!['admin', 'officer', 'viewer'].includes(req.body.role)) throw fieldErr('role', 'Choose a role'); run('UPDATE uni_users SET role = ?, finance = ? WHERE id = ?', req.body.role, req.body.role === 'admin' || bool(req.body.finance) ? 1 : 0, x.id); }
  C.uaudit(req, 'Update', 'UniversityUser', x.id, `${a}: ${x.email}`, null, null, x.university_id); res.json({ ok: true });
}));

// =====================================================================================
// S43 Partner agreements
// =====================================================================================
function agreementStatus(a) {
  if (a.status === 'Terminated' || a.status === 'Draft') return a.status;
  const today = U.istDate(); const warn = Number(getSetting('uni_agreement_warn_days') || 60);
  if (a.start_date > today) return 'Draft';
  if (a.end_date && a.end_date < today) return 'Expired';
  if (a.end_date && U.addDays(today, warn) >= a.end_date) return 'Expiring soon';
  return 'Active';
}
r.get('/admin/agreements', ah(async (req, res) => {
  adminOnly(req);
  const rows = all(`SELECT * FROM partner_agreements WHERE is_deleted = 0 ${req.query.university ? 'AND university_id = ?' : ''} ORDER BY start_date DESC`, ...(req.query.university ? [req.query.university] : []))
    .map(a => ({ ...a, university: C.uniName(C.uni(a.university_id)), territory: C.parseJ(a.territory_json, []), versions: C.parseJ(a.file_versions_json, []).length, file_key: undefined, file_versions_json: undefined, has_pdf: !!a.file_key }));
  res.json({ rows, currencies: all(`SELECT name FROM master_items WHERE type = 'currency' AND is_deleted = 0 ORDER BY sort`).map(x => x.name), countries: all('SELECT id, name FROM countries WHERE is_deleted = 0 ORDER BY name') });
}));
r.post('/admin/agreements', files.upload.single('file'), ah(async (req, res) => {
  try {
    adminOnly(req);
    const b = req.body; const cur = b.id ? get('SELECT * FROM partner_agreements WHERE id = ? AND is_deleted = 0', b.id) : null; if (b.id && !cur) throw U.notFound();
    const e = {};
    if (!cur && !C.uni(b.university_id)) e.university_id = 'Choose the university';
    if (!clean(b.title)) e.title = 'Agreement title is required'; if (!b.start_date) e.start_date = 'Start date is required';
    if (b.end_date && b.start_date && b.end_date < b.start_date) e.end_date = 'End date must be after the start date';
    if (!clean(b.signed_by_le)) e.signed_by_le = 'Required'; if (!clean(b.signed_by_uni)) e.signed_by_uni = 'Required';
    if (!b.signed_on || b.signed_on > U.istDate()) e.signed_on = 'Signed on is required and cannot be in the future';
    if (b.notice_days && !(num(b.notice_days) >= 0 && num(b.notice_days) <= 365)) e.notice_days = '0 to 365';
    if (!cur && !req.file) e.file = 'Agreement PDF is required';
    if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
    const uniId = cur ? cur.university_id : b.university_id;
    // only one Active agreement for the same period
    const overl = get(`SELECT agreement_code FROM partner_agreements WHERE university_id = ? AND is_deleted = 0 AND status NOT IN ('Terminated','Expired','Draft') AND id != ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`,
      uniId, cur ? cur.id : '-', b.end_date || '9999-12-31', b.start_date);
    if (overl && !bool(b.draft)) throw bad(`Another active agreement (${overl.agreement_code}) covers the same period. Terminate it or change the dates.`);
    let fileKey = cur && cur.file_key; const versions = C.parseJ(cur && cur.file_versions_json, []);
    if (req.file) { const { ext } = files.checkFile(req.file, ['pdf'], 25); const key = `agreement_${uuid()}.${ext}`; VAULT.moveIn(req.file.path, files.filePath(key)); if (fileKey) versions.push({ key: fileKey, replaced_at: now(), by: req.user.id }); fileKey = key; }
    const f = { title: clean(b.title, 200), start_date: b.start_date, end_date: b.end_date || null, auto_renew: bool(b.auto_renew) ? 1 : 0, notice_days: num(b.notice_days), signed_by_le: clean(b.signed_by_le, 150), signed_by_uni: clean(b.signed_by_uni, 150),
      signed_on: b.signed_on, territory_json: JSON.stringify(C.parseJ(b.territory, Array.isArray(b.territory) ? b.territory : [])), scope_text: clean(b.scope_text, 1000), commission_terms: clean(b.commission_terms, 3000),
      payment_terms_days: num(b.payment_terms_days), invoice_currency: b.invoice_currency || null, file_key: fileKey, file_versions_json: JSON.stringify(versions), show_to_uni: b.show_to_uni === undefined ? 1 : bool(b.show_to_uni) ? 1 : 0, internal_note: clean(b.internal_note, 3000) };
    let id;
    if (cur) { update('partner_agreements', cur.id, f, req.user.id); id = cur.id; }
    else { const yr = new Date().getFullYear(); const n = get(`SELECT COUNT(*) c FROM partner_agreements WHERE agreement_code LIKE ?`, `LE-PA-${yr}-%`).c + 1; id = insert('partner_agreements', { university_id: uniId, agreement_code: `LE-PA-${yr}-${String(n).padStart(3, '0')}`, ...f, status: 'Draft' }, req.user.id); }
    const a = get('SELECT * FROM partner_agreements WHERE id = ?', id);
    if (!bool(b.draft) || cur) run('UPDATE partner_agreements SET status = ? WHERE id = ?', bool(b.draft) && !cur ? 'Draft' : agreementStatus({ ...a, status: a.status === 'Draft' && !bool(b.draft) ? 'Active' : a.status }), id);
    C.uaudit(req, cur ? 'Update' : 'Create', 'PartnerAgreement', id, f.title, null, null, uniId);
    res.json({ ok: true, id });
  } catch (e) { files.cleanup(req.file); throw e; }
}));
r.post('/admin/agreements/:id/terminate', ah(async (req, res) => {
  adminOnly(req); const a = get('SELECT * FROM partner_agreements WHERE id = ?', req.params.id); if (!a) throw U.notFound();
  if (!clean(req.body.reason)) throw fieldErr('reason', 'Reason is required');
  run(`UPDATE partner_agreements SET status = 'Terminated', terminate_reason = ?, updated_at = ? WHERE id = ?`, clean(req.body.reason, 500), now(), a.id);
  C.uaudit(req, 'Update', 'PartnerAgreement', a.id, `Terminated: ${req.body.reason}`, null, null, a.university_id); res.json({ ok: true });
}));
r.get('/admin/agreements/:id/pdf', ah(async (req, res) => {
  adminOnly(req); const a = get('SELECT * FROM partner_agreements WHERE id = ?', req.params.id); if (!a) throw U.notFound();
  const key = req.query.v ? (C.parseJ(a.file_versions_json, [])[Number(req.query.v)] || {}).key : a.file_key; if (!key) throw U.notFound();
  audit(req, 'View sensitive', 'PartnerAgreement', a.id, a.agreement_code);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${a.agreement_code}.pdf"`); res.setHeader('Cache-Control', 'private, no-store'); VAULT.pipe(files.filePath(key), res);
}));

// =====================================================================================
// C12 Submit to university portal (S44) + C13 University tab (S47) + C14 buttons
// =====================================================================================
const NEVER_SHARE = ['La Europa invoice', 'Payment receipt', 'Fee receipt', 'Bank statement', 'Blocked account', 'Health insurance', 'Accommodation proof', 'Visa decision', 'Sponsor income proof', 'Consent form', 'ITR'];
function shareable(d) {
  const t = get('SELECT name, data_json FROM master_items WHERE id = ?', d.document_type_id) || {};
  const dj = C.parseJ(t.data_json, {});
  if (dj.never_share_uni) return false;
  if (NEVER_SHARE.some(n => (t.name || '').toLowerCase().startsWith(n.toLowerCase()))) return false;
  if (dj.visa && !/visa decision/i.test(t.name || '')) return false;
  return d.status === 'Verified' && !!d.current_version_id;
}
function consentFor(studentId, universityId, applicationId) {
  const rec = get(`SELECT * FROM consent_records WHERE consent_type = 'share_with_university' AND university_id = ? AND (application_id = ? OR application_id IS NULL) AND student_user_id IN (SELECT id FROM student_users WHERE student_id = ?) ORDER BY created_at DESC LIMIT 1`, universityId, applicationId, studentId)
    || get(`SELECT * FROM consent_records WHERE consent_type = 'share_with_university' AND university_id = ? AND (application_id = ? OR application_id IS NULL) AND lead_id = ? ORDER BY created_at DESC LIMIT 1`, universityId, applicationId, 'student:' + studentId);
  const reqd = get(`SELECT * FROM share_consent_requests WHERE student_id = ? AND university_id = ? ORDER BY requested_at DESC LIMIT 1`, studentId, universityId);
  // the all-in-one consent signed on the first login covers sharing with universities (Part C), unless withdrawn for this university
  // the signed Student Declaration & Consent (box B, data sharing) or the earlier all-in-one consent covers sharing with universities, unless withdrawn
  const master = get(`SELECT * FROM consent_records WHERE consent_type IN ('master', 'share_data') AND student_user_id IN (SELECT id FROM student_users WHERE student_id = ? OR lead_id = (SELECT lead_id FROM students WHERE id = ?)) ORDER BY created_at DESC LIMIT 1`, studentId, studentId);
  if (master && master.value === 'yes' && !(rec && rec.value !== 'yes' && rec.created_at > master.created_at)) return { status: 'Given', at: master.created_at, method: master.consent_type === 'share_data' ? 'Student Declaration & Consent, box B (signed with email OTP)' : 'All-in-one consent (first login)', id: master.id };
  if (rec) return { status: rec.value === 'yes' ? 'Given' : 'Withdrawn', at: rec.created_at, method: rec.method, id: rec.id };
  if (reqd) return { status: reqd.status === 'Declined' ? 'Declined' : 'Requested', at: reqd.requested_at };
  return { status: 'Not requested' };
}
function uniTab(req, a, s) {
  const u = a.university_id ? C.uni(a.university_id) : null;
  const ua = get('SELECT * FROM university_applications WHERE application_id = ? AND is_deleted = 0', a.id);
  const portal = !!(u && u.portal_status === 'Active'); const agreement = u ? C.activeAgreement(u.id) : null;
  const consent = u ? consentFor(s.id, u.id, a.id) : { status: 'Not requested' };
  const docs = all(`SELECT d.*, m.name tname FROM documents d JOIN master_items m ON m.id = d.document_type_id WHERE d.student_id = ? AND d.is_deleted = 0`, s.id).filter(shareable);
  const country = a.country_id; const checklist = new Set(require('./work').checklistFor(s, country).map(i => i.document_type_id));
  const out = { university: u ? { id: u.id, name: C.uniName(u), portal_status: u.portal_status || 'None', notify_mode: u.notify_mode, share_contact: !!u.share_contact, partner_manager: userName(u.partner_manager_id) } : null,
    can_submit: !ua && portal && !!agreement && consent.status === 'Given' && !['rejected', 'withdrawn', 'offer_declined'].includes(a.stage), portal, agreement: !!agreement, consent, transfers_blocked: !!(get('SELECT transfers_allowed FROM countries WHERE id = ?', country) || { transfers_allowed: 1 }).transfers_allowed === false,
    shareable: docs.map(d => ({ document_id: d.id, version_id: d.current_version_id, name: d.title || d.tname, in_checklist: checklist.has(d.document_type_id) })) };
  if (!ua) return out;
  const shares = all('SELECT * FROM uni_doc_shares WHERE uapp_id = ? ORDER BY shared_at DESC', ua.id).map(x => { const d = get('SELECT document_type_id, title, current_version_id FROM documents WHERE id = ?', x.document_id); const v = get('SELECT version_no FROM document_versions WHERE id = ?', x.version_id);
    return { id: x.id, document_id: x.document_id, name: d.title || masterName(d.document_type_id), version_no: v ? v.version_no : null, status: x.status, shared_at: x.shared_at, viewed_at: x.viewed_at, downloaded_at: x.downloaded_at, revoked_at: x.revoked_at,
      newer: d.current_version_id && d.current_version_id !== x.version_id && !['Revoked', 'Expired'].includes(x.status) && !get(`SELECT 1 y FROM uni_doc_shares WHERE uapp_id = ? AND version_id = ? AND status NOT IN ('Revoked','Expired')`, ua.id, d.current_version_id) }; });
  const log = all('SELECT l.*, uu.name FROM doc_access_log l LEFT JOIN uni_users uu ON uu.id = l.uni_user_id WHERE l.uapp_id = ? ORDER BY l.at DESC', ua.id);
  const uploads = all(`SELECT d.id document_id, d.title, d.document_type_id, d.status, v.id version_id, v.version_no, v.uploaded_at, v.uploaded_by, v.note_for_counsellor FROM documents d JOIN document_versions v ON v.document_id = d.id
    WHERE d.application_id = ? AND v.uploaded_by_type = 'university' AND v.removed_at IS NULL ORDER BY v.uploaded_at DESC`, a.id).map(x => ({ ...x, name: x.title || masterName(x.document_type_id), by: (get('SELECT name FROM uni_users WHERE id = ?', x.uploaded_by) || {}).name,
      url: `/api/files/${x.version_id}?` + new URL('http://x' + files.sign(x.version_id, req.user.id, 'inline')).searchParams.toString() }));
  return { ...out, can_submit: false, ua: { id: ua.id, status: ua.status, submitted_at: ua.submitted_at, university_ref: ua.university_ref, flags: { docs_requested: !!ua.flag_docs_requested, waitlisted: !!ua.flag_waitlisted }, withdrawn_at: ua.withdrawn_at },
    actions: all('SELECT * FROM uni_actions WHERE uapp_id = ? ORDER BY created_at DESC', ua.id).map(x => ({ id: x.id, type: x.type, label: A.DECISION_LABEL[x.type], data: C.parseJ(x.data_json, {}), processing: x.processing, held_note: x.held_note, created_at: x.created_at,
      by: x.by_uni_user_id ? (get('SELECT name FROM uni_users WHERE id = ?', x.by_uni_user_id) || {}).name : userName(x.by_staff_id), processed_by: userName(x.processed_by), processed_at: x.processed_at })),
    shares, uploads, requests: all('SELECT * FROM uni_doc_requests WHERE uapp_id = ? ORDER BY created_at DESC', ua.id).map(q => ({ ...q, items: all('SELECT * FROM uni_doc_request_items WHERE request_id = ?', q.id).map(i => ({ ...i, name: i.title || masterName(i.document_type_id) })) })),
    downloads: { count: log.filter(l => l.action !== 'preview').length, views: log.filter(l => l.action === 'preview').length, last: log[0] ? `${log[0].name || 'University user'} on ${fmtDateTime(log[0].at)}` : null },
    unread: get(`SELECT COUNT(*) c FROM uni_messages WHERE uapp_id = ? AND sender_type = 'university' AND seen_by_le_at IS NULL AND deleted_at IS NULL`, ua.id).c };
}
r.get('/applications/:aid/university', ah(async (req, res) => {
  const { row: a, student: s } = loadChild(req.user, 'applications', req.params.aid);
  res.json(uniTab(req, a, s));
}));
// preview: what the university will see (1.10)
r.get('/applications/:aid/university/preview', ah(async (req, res) => {
  const { row: a, student: s } = loadChild(req.user, 'applications', req.params.aid);
  const fake = { id: 'preview', application_id: a.id, university_id: a.university_id, status: 'New', submitted_at: now(), status_changed_at: now(), version: 1 };
  if (!C.uni(a.university_id)) throw bad('Choose the university of this application first');
  const v = C.appView(fake, { detail: true }); delete v.timeline;
  res.json(v);
}));
r.post('/applications/:aid/university/submit', ah(async (req, res) => {
  need(req.user, 'applications', 'edit');
  const { row: a, student: s } = loadChild(req.user, 'applications', req.params.aid);
  const u = C.uni(a.university_id);
  if (!u || u.portal_status !== 'Active') throw bad('This university does not have an active partner portal account.');
  if (get('SELECT 1 x FROM university_applications WHERE application_id = ? AND is_deleted = 0', a.id)) throw bad('This application was already submitted to the university portal. For a new attempt create a new application.');
  if (!C.activeAgreement(u.id)) { if (!isAdmin(req.user) || !clean(req.body.override_reason)) throw bad('This university has no active partner agreement. Please contact Admin.', { needs_override: isAdmin(req.user) }); audit(req, 'Override', 'Application', a.id, `Submitted without active agreement: ${req.body.override_reason}`); }
  if ((get('SELECT transfers_allowed FROM countries WHERE id = ?', a.country_id) || { transfers_allowed: 1 }).transfers_allowed === 0) throw bad('Data transfers to this country are blocked by Admin (DPDP Act setting).');
  const consent = consentFor(s.id, u.id, a.id);
  if (consent.status !== 'Given') throw bad('The student has not given consent to share the application with this university. Request consent first.', { code: 'consent' });
  if (!U.passportOf(s)) throw bad('Passport number is empty (CD 7.6). Please complete the student profile first.');
  const ids = (req.body.version_ids || []).slice(0, 100);
  const vers = ids.map(id => get(`SELECT v.*, d.student_id, d.status dstatus, d.document_type_id, d.id did FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ?`, id)).filter(Boolean);
  for (const v of vers) if (v.student_id !== s.id || !shareable({ status: v.dstatus, current_version_id: v.id, document_type_id: v.document_type_id })) throw bad('Only verified documents of this student can be shared.');
  const id = uuid(); const t = now();
  const prevStage = a.stage;
  const campus = a.course_id ? (get('SELECT campus_id FROM courses WHERE id = ?', a.course_id) || {}).campus_id : null;
  tx(() => {
    insert('university_applications', { id, application_id: a.id, university_id: u.id, campus_id: campus, status: 'New', status_changed_at: t, submitted_at: t, submitted_by: req.user.id, cover_note: clean(req.body.cover_note, 1000), consent_id: consent.id,
      shared_fields_json: JSON.stringify({ contact: !!u.share_contact, passport_full: !!u.share_passport, visa: !!u.share_visa }), version: 1 }, req.user.id);
    for (const v of vers) insert('uni_doc_shares', { id: uuid(), uapp_id: id, university_id: u.id, document_id: v.did, version_id: v.id, shared_by: req.user.id, shared_at: t, status: 'Shared' });
    if (!['applied', 'under_review', 'interview', 'conditional_offer', 'unconditional_offer', 'offer_accepted', 'tuition_paid', 'enrolment_confirmed'].includes(a.stage)) {
      update('applications', a.id, { stage: 'applied', stage_changed_at: t, applied_date: U.istDate(), channel: a.channel || 'La Europa partner portal' }, req.user.id);
      insert('application_stage_history', { id: uuid(), application_id: a.id, from_stage: prevStage, to_stage: 'applied', reason: 'Submitted to the university partner portal', notified: req.body.notify === false ? 0 : 1, changed_by: req.user.id, changed_at: t, source: 'university_portal' });
    }
  });
  timeline({ student_id: s.id, type: 'stage', description: `Application ${a.application_code} submitted to the ${C.uniName(u)} partner portal (${vers.length} document(s) shared)`, link: `app:${a.id}`, user_id: req.user.id });
  audit(req, 'Submit to university portal', 'Application', a.id, a.application_code, null, { documents: vers.length });
  const na = get('SELECT * FROM applications WHERE id = ?', a.id);
  const W = require('./work');
  if (prevStage !== na.stage) require('../services').fire(req, 'E05', { student_id: s.id }, W.appCtx(na, s), `Application ${a.application_code} applied via university portal (E05)`);
  // university: in-app + E31
  const ua = get('SELECT * FROM university_applications WHERE id = ?', id); const view = C.appView(ua);
  C.notifyUni(u.id, { roles: ['admin', 'officer'], campusId: campus }, `New application: ${view.student_name}, ${view.course} (${view.intake})`, `#/applications/${id}`);
  UE.trigger('E31', { to: C.usersOf(u.id, { roles: ['admin', 'officer'], alert: 'applications', campusId: campus }).map(x => x.email), university_id: u.id, uapp_id: id, link: `/#/applications/${id}`,
    ctx: { application_code: a.application_code, student_name: view.student_name, course: view.course, level: a.level, campus: view.campus ? `, ${email.esc(view.campus)}` : '', intake: view.intake, submitted_date: fmtDate(t) } });
  res.json({ ok: true, id });
}));
const loadUAstaff = (req, aid) => { const { row: a, student: s } = loadChild(req.user, 'applications', aid); const ua = get('SELECT * FROM university_applications WHERE application_id = ? AND is_deleted = 0', a.id); if (!ua) throw bad('Not submitted to the university portal'); return { a, s, ua, u: C.uni(ua.university_id) }; };
r.post('/applications/:aid/university/share', ah(async (req, res) => {
  need(req.user, 'documents', 'edit'); const { a, s, ua, u } = loadUAstaff(req, req.params.aid);
  if (ua.status === 'Withdrawn') throw bad('Withdrawn application');
  let n = 0;
  for (const vid of (req.body.version_ids || []).slice(0, 50)) {
    const v = get(`SELECT v.*, d.student_id, d.status dstatus, d.document_type_id, d.id did FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ?`, vid);
    if (!v || v.student_id !== s.id || !shareable({ status: v.dstatus, current_version_id: v.id, document_type_id: v.document_type_id })) throw bad('Only verified documents of this student can be shared.');
    if (get(`SELECT 1 x FROM uni_doc_shares WHERE uapp_id = ? AND version_id = ? AND status NOT IN ('Revoked','Expired')`, ua.id, v.id)) continue;
    insert('uni_doc_shares', { id: uuid(), uapp_id: ua.id, university_id: ua.university_id, document_id: v.did, version_id: v.id, shared_by: req.user.id, shared_at: now(), status: 'Shared' }); n++;
  }
  if (n) C.notifyUni(ua.university_id, { roles: ['admin', 'officer'], campusId: ua.campus_id }, `La Europa shared ${n} document(s) for ${a.application_code}`, `#/applications/${ua.id}`);
  audit(req, 'Share with university', 'Application', a.id, `${n} document(s)`); res.json({ ok: true, shared: n });
}));
r.post('/university-shares/:sid/revoke', ah(async (req, res) => {
  const x = get('SELECT * FROM uni_doc_shares WHERE id = ?', req.params.sid); if (!x) throw U.notFound();
  const ua = get('SELECT * FROM university_applications WHERE id = ?', x.uapp_id); loadChild(req.user, 'applications', ua.application_id); need(req.user, 'documents', 'edit');
  if (!clean(req.body.reason)) throw fieldErr('reason', 'Reason is required');
  run(`UPDATE uni_doc_shares SET status = 'Revoked', revoked_reason = ?, revoked_at = ? WHERE id = ?`, clean(req.body.reason, 300), now(), x.id);
  audit(req, 'Revoke university share', 'Document', x.document_id, req.body.reason); res.json({ ok: true });
}));
// answer a university document request (C13): share against each item or reply "Not available", then send (E32)
r.post('/applications/:aid/university/requests/:rid/answer', ah(async (req, res) => {
  need(req.user, 'documents', 'edit'); const { a, s, ua, u } = loadUAstaff(req, req.params.aid);
  const q = get(`SELECT * FROM uni_doc_requests WHERE id = ? AND uapp_id = ? AND status IN ('Open','Partly fulfilled')`, req.params.rid, ua.id); if (!q) throw bad('This request is already closed');
  const sent = [];
  for (const it of req.body.items || []) {
    const item = get(`SELECT * FROM uni_doc_request_items WHERE id = ? AND request_id = ? AND status = 'Open'`, it.item_id, q.id); if (!item) continue;
    if (it.not_available) { if (!clean(it.reply)) throw bad('Write a message for items that are not available'); run(`UPDATE uni_doc_request_items SET status = 'Not available', reply = ? WHERE id = ?`, clean(it.reply, 500), item.id); sent.push(`${item.title || masterName(item.document_type_id)}: not available (${clean(it.reply, 200)})`); continue; }
    if (!it.version_id) continue;
    const v = get(`SELECT v.*, d.student_id, d.status dstatus, d.document_type_id, d.id did FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ?`, it.version_id);
    if (!v || v.student_id !== s.id || !shareable({ status: v.dstatus, current_version_id: v.id, document_type_id: v.document_type_id })) throw bad('Only verified documents of this student can be shared.');
    let sh = get(`SELECT id FROM uni_doc_shares WHERE uapp_id = ? AND version_id = ? AND status NOT IN ('Revoked','Expired')`, ua.id, v.id);
    const sid = sh ? sh.id : insert('uni_doc_shares', { id: uuid(), uapp_id: ua.id, university_id: ua.university_id, document_id: v.did, version_id: v.id, shared_by: req.user.id, shared_at: now(), status: 'Shared' });
    run(`UPDATE uni_doc_request_items SET status = 'Fulfilled', share_id = ?, reply = ? WHERE id = ?`, sid, clean(it.reply, 300), item.id);
    sent.push(item.title || masterName(item.document_type_id));
  }
  if (!sent.length) throw bad('Share a document or reply "Not available" for at least one item');
  const open = get(`SELECT COUNT(*) c FROM uni_doc_request_items WHERE request_id = ? AND status = 'Open'`, q.id).c;
  run(`UPDATE uni_doc_requests SET status = ?, answered_at = ?, opened_by_uni_at = NULL WHERE id = ?`, open ? 'Partly fulfilled' : 'Fulfilled', now(), q.id);
  if (!open) require('../university/routes').closeRequestFlags(ua);
  const view = C.appView(ua);
  C.notifyUni(ua.university_id, { roles: ['admin', 'officer'], campusId: ua.campus_id }, `La Europa shared ${sent.length} document(s) for ${a.application_code}`, `#/applications/${ua.id}`);
  UE.trigger('E32', { to: C.usersOf(ua.university_id, { roles: ['admin', 'officer'], alert: 'applications', campusId: ua.campus_id }).map(x => x.email), university_id: ua.university_id, uapp_id: ua.id, link: `/#/applications/${ua.id}`,
    ctx: { application_code: a.application_code, student_name: view.student_name, course: view.course, intake: view.intake, documents_list: email.ul(sent) } });
  timeline({ student_id: s.id, type: 'document', description: `Documents sent to ${C.uniName(u)} for request (${sent.join(', ')})`, user_id: req.user.id });
  audit(req, 'Answer university request', 'UniDocRequest', q.id, sent.join(', ')); res.json({ ok: true, status: open ? 'Partly fulfilled' : 'Fulfilled' });
}));
// C14: confirm acceptance / withdraw / offer declined
r.post('/applications/:aid/university/confirm-acceptance', ah(async (req, res) => {
  need(req.user, 'applications', 'edit'); const { a, s, ua, u } = loadUAstaff(req, req.params.aid);
  if (!['Conditional offer', 'Unconditional offer'].includes(ua.status)) throw bad('The university has not issued an offer yet');
  const t = now();
  tx(() => {
    run(`UPDATE university_applications SET status = 'Offer accepted', status_changed_at = ?, version = version + 1 WHERE id = ?`, t, ua.id);
    insert('uni_actions', { id: uuid(), uapp_id: ua.id, university_id: ua.university_id, application_id: a.id, type: 'offer_accepted', data_json: '{}', from_status: ua.status, to_status: 'Offer accepted', by_staff_id: req.user.id, processing: 'Applied', processed_by: req.user.id, processed_at: t, created_at: t });
    if (a.stage !== 'offer_accepted') { update('applications', a.id, { stage: 'offer_accepted', stage_changed_at: t }, req.user.id);
      insert('application_stage_history', { id: uuid(), application_id: a.id, from_stage: a.stage, to_stage: 'offer_accepted', reason: 'Acceptance confirmed to the university', notified: req.body.notify === false ? 0 : 1, changed_by: req.user.id, changed_at: t, source: 'university_portal' }); }
  });
  require('../services').closeSystemTask(`offer-deadline:${a.id}`);
  const W = require('./work'); require('../services').fire(req, 'E05', { student_id: s.id }, W.appCtx(get('SELECT * FROM applications WHERE id = ?', a.id), s), `Offer acceptance confirmed to ${C.uniName(u)} (E05)`);
  const view = C.appView(ua);
  C.notifyUni(ua.university_id, { roles: ['admin', 'officer'], campusId: ua.campus_id }, `Offer accepted: ${view.student_name}`, `#/applications/${ua.id}`);
  UE.trigger('E34', { to: C.usersOf(ua.university_id, { roles: ['admin', 'officer'], alert: 'applications', campusId: ua.campus_id }).map(x => x.email), university_id: ua.university_id, uapp_id: ua.id, link: `/#/applications/${ua.id}`, ctx: { student_name: view.student_name, course: view.course, intake: view.intake, application_code: a.application_code } });
  timeline({ student_id: s.id, type: 'stage', description: `Offer acceptance confirmed to ${C.uniName(u)} (${a.application_code})`, user_id: req.user.id });
  audit(req, 'Confirm acceptance', 'Application', a.id, a.application_code); res.json({ ok: true });
}));
r.post('/applications/:aid/university/withdraw', ah(async (req, res) => {
  need(req.user, 'applications', 'edit'); const { a, s, ua, u } = loadUAstaff(req, req.params.aid);
  if (['Withdrawn', 'Enrolled'].includes(ua.status)) throw bad('This application cannot be withdrawn');
  const declined = bool(req.body.declined);
  const reasonUni = declined ? 'Offer declined by the student' : clean(req.body.reason_university, 500); const reasonInt = clean(req.body.reason_internal, 1000);
  if (!reasonUni) throw fieldErr('reason_university', 'Reason for the university is required'); if (!reasonInt && !declined) throw fieldErr('reason_internal', 'Internal reason is required');
  const t = now();
  tx(() => {
    run(`UPDATE university_applications SET status = 'Withdrawn', status_changed_at = ?, withdrawn_at = ?, withdraw_reason_uni = ?, version = version + 1 WHERE id = ?`, t, t, reasonUni, ua.id);
    insert('uni_actions', { id: uuid(), uapp_id: ua.id, university_id: ua.university_id, application_id: a.id, type: 'withdrawn', data_json: JSON.stringify({ reason: reasonUni }), from_status: ua.status, to_status: 'Withdrawn', by_staff_id: req.user.id, processing: 'Applied', processed_by: req.user.id, processed_at: t, created_at: t });
    update('applications', a.id, { stage: 'withdrawn', stage_changed_at: t }, req.user.id);
    insert('application_stage_history', { id: uuid(), application_id: a.id, from_stage: a.stage, to_stage: 'withdrawn', reason: reasonInt || reasonUni, notified: req.body.notify === false ? 0 : 1, changed_by: req.user.id, changed_at: t, source: 'university_portal' });
    run(`UPDATE uni_doc_requests SET status = 'Cancelled', cancel_reason = 'Application withdrawn' WHERE uapp_id = ? AND status IN ('Open','Partly fulfilled')`, ua.id);
  });
  const W = require('./work'); require('../services').fire(req, 'E05', { student_id: s.id }, W.appCtx(get('SELECT * FROM applications WHERE id = ?', a.id), s), `Application withdrawn from ${C.uniName(u)} (E05)`);
  const view = C.appView(ua);
  C.notifyUni(ua.university_id, { roles: ['admin', 'officer'], campusId: ua.campus_id }, `Withdrawn by La Europa: ${a.application_code}`, `#/applications/${ua.id}`);
  UE.trigger('E40', { to: C.usersOf(ua.university_id, { roles: ['admin', 'officer'], alert: 'applications', campusId: ua.campus_id }).map(x => x.email), university_id: ua.university_id, uapp_id: ua.id, link: `/#/applications/${ua.id}`,
    ctx: { application_code: a.application_code, student_name: view.student_name, course: view.course, intake: view.intake, withdraw_reason_for_university: reasonUni } });
  timeline({ student_id: s.id, type: 'stage', description: `${a.application_code} withdrawn from ${C.uniName(u)}: ${reasonInt || reasonUni}`, user_id: req.user.id });
  audit(req, 'Withdraw from university', 'Application', a.id, reasonInt || reasonUni); res.json({ ok: true });
}));

// =====================================================================================
// C16 University updates queue (S45)
// =====================================================================================
function queueScope(req) { if (isAdmin(req.user)) return ['1=1', []]; return [`(s.primary_counsellor_id = ? OR s.application_user_id = ? OR a.handled_by = ?)`, [req.user.id, req.user.id, req.user.id]]; }
r.get('/university-updates', ah(async (req, res) => {
  const [w, p] = queueScope(req);
  const st = req.query.status === 'held' ? ['Held'] : req.query.status === 'done' ? ['Applied', 'Applied without notifying'] : ['Pending review', 'Held'];
  const extra = req.query.counsellor && isAdmin(req.user) ? ' AND s.primary_counsellor_id = ?' : '';
  const rows = all(`SELECT x.*, a.application_code, a.student_id, a.course_id, a.course_name_text, a.intake_id FROM uni_actions x JOIN applications a ON a.id = x.application_id JOIN students s ON s.id = a.student_id
    WHERE ${w} AND x.processing IN (${st.map(() => '?').join(',')})${extra} ORDER BY x.created_at ${req.query.status === 'done' ? 'DESC' : 'ASC'} LIMIT 300`, ...p, ...st, ...(extra ? [req.query.counsellor] : []))
    .map(x => ({ id: x.id, type: x.type, label: A.DECISION_LABEL[x.type], processing: x.processing, held_note: x.held_note, created_at: x.created_at, waiting_hours: Math.round((Date.now() - new Date(x.created_at)) / 36e5),
      university: C.uniName(C.uni(x.university_id)), student: fullName(get('SELECT first_name, middle_name, last_name FROM students WHERE id = ?', x.student_id)), student_id: x.student_id, application_code: x.application_code, application_id: x.application_id,
      course: x.course_name_text || masterName(x.course_id), intake: masterName(x.intake_id), forced: !!x.forced_review }));
  res.json({ rows });
}));
r.get('/university-updates/:id', ah(async (req, res) => {
  const x = get('SELECT * FROM uni_actions WHERE id = ?', req.params.id); if (!x) throw U.notFound();
  const { row: a, student: s } = loadChild(req.user, 'applications', x.application_id);
  const d = C.parseJ(x.data_json, {});
  const target = C.STAGE_OF[x.to_status];
  const W = require('./work');
  let code = x.type === 'waitlist' ? 'E43' : x.type === 'acknowledge' ? (getSetting('uni_ack_email') === '0' ? null : 'E05') : target && target !== a.stage ? W.triggerFor(target) : x.type === 'interview' ? 'E06' : null;
  let pv = null;
  if (code) { const virt = { ...a, stage: target || a.stage, interview_at: d.at || a.interview_at, interview_link: d.link || a.interview_link, offer_conditions: d.conditions ? d.conditions.map(c => '- ' + c.text).join('\n') : a.offer_conditions, offer_deadline: d.acceptance_deadline || a.offer_deadline };
    try { pv = { ...email.previewFor(code, { student_id: s.id, ctx: W.appCtx(virt, s, x.type === 'reject' && d.share_reason ? { include_reason_if_ticked: `Reason shared by the university: ${d.reason}` } : {}) }), code }; } catch { pv = null; } }
  const letters = all('SELECT * FROM offer_letters WHERE uapp_id = ? AND document_id IS NOT NULL ORDER BY created_at DESC LIMIT 3', x.uapp_id).map(l => ({ type: l.type, issue_date: l.issue_date,
    url: `/api/files/${l.version_id}?` + new URL('http://x' + files.sign(l.version_id, req.user.id, 'inline')).searchParams.toString() }));
  const submissions = all(`SELECT * FROM payment_submissions WHERE application_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 3`, a.id);
  res.json({ id: x.id, type: x.type, label: A.DECISION_LABEL[x.type], processing: x.processing, data: d, from_status: x.from_status, to_status: x.to_status, created_at: x.created_at, student: fullName(s), student_id: s.id,
    application_code: a.application_code, current_stage: a.stage, target_stage: target, email: pv, letters, student_payment_proofs: submissions, university: C.uniName(C.uni(x.university_id)), held_note: x.held_note });
}));
r.post('/university-updates/:id/:action(apply|hold)', ah(async (req, res) => {
  need(req.user, 'applications', 'edit');
  const x = get('SELECT * FROM uni_actions WHERE id = ?', req.params.id); if (!x) throw U.notFound();
  const { row: a, student: s } = loadChild(req.user, 'applications', x.application_id);
  if (req.params.action === 'hold') { A.hold(x.id, req.user, req.body.note); audit(req, 'Hold university update', 'Application', a.id, `${A.DECISION_LABEL[x.type]}: ${req.body.note}`); return res.json({ ok: true }); }
  const notifyS = !(req.body.notify === false || req.body.notify === 'false');
  if (!notifyS && !bool(req.body.confirm_silent)) throw bad('Please confirm that the student will not be notified.', { needs_confirm: true });
  const out = A.apply(x.id, req.user, { notify: notifyS, message: clean(req.body.message, 500), include_reason: bool(req.body.include_reason) });
  if (!notifyS) audit(req, 'Save without notifying', 'Student', s.id, `University decision ${A.DECISION_LABEL[x.type]} applied without notifying`);
  audit(req, 'Apply university update', 'Application', a.id, `${A.DECISION_LABEL[x.type]}${notifyS ? '' : ' (without notifying)'}`);
  res.json({ ok: true, email: out.email });
}));
r.get('/university-counts', ah(async (req, res) => {
  const [w, p] = queueScope(req);
  const pending = get(`SELECT COUNT(*) c FROM uni_actions x JOIN applications a ON a.id = x.application_id JOIN students s ON s.id = a.student_id WHERE ${w} AND x.processing = 'Pending review'`, ...p).c;
  const requests = get(`SELECT COUNT(*) c FROM uni_doc_requests q JOIN university_applications ua ON ua.id = q.uapp_id JOIN applications a ON a.id = ua.application_id JOIN students s ON s.id = a.student_id WHERE ${w} AND q.status IN ('Open','Partly fulfilled')`, ...p).c;
  const messages = get(`SELECT COUNT(*) c FROM uni_messages m JOIN university_applications ua ON ua.id = m.uapp_id JOIN applications a ON a.id = ua.application_id JOIN students s ON s.id = a.student_id WHERE ${w} AND m.sender_type = 'university' AND m.seen_by_le_at IS NULL AND m.deleted_at IS NULL`, ...p).c
    + (isAdmin(req.user) ? get(`SELECT COUNT(*) c FROM uni_messages WHERE uapp_id IS NULL AND sender_type = 'university' AND seen_by_le_at IS NULL AND deleted_at IS NULL`).c : 0);
  const approvals = isAdmin(req.user) ? get(`SELECT COUNT(*) c FROM course_change_requests WHERE status = 'Pending approval' AND is_deleted = 0`).c + get(`SELECT COUNT(*) c FROM uni_profile_requests WHERE status = 'Pending'`).c : 0;
  res.json({ pending, requests, messages, approvals, total: pending + requests + messages });
}));
r.get('/university-news', ah(async (req, res) => res.json(all(`SELECT a.*, u.name uni FROM uni_announcements a JOIN universities u ON u.id = a.university_id WHERE a.published_at IS NOT NULL AND (a.valid_until IS NULL OR a.valid_until >= ?) ORDER BY a.important DESC, a.published_at DESC LIMIT 10`, U.istDate())
  .map(a => ({ id: a.id, university: a.uni, type: a.type, title: a.title, body: a.body, important: !!a.important, published_at: a.published_at })))));

// =====================================================================================
// C15 University messages (S48)
// =====================================================================================
function staffMsgOut(m, userId) {
  const att = all('SELECT id, original_name, mime_type, size_bytes, saved_document_id FROM uni_message_attachments WHERE message_id = ?', m.id);
  return { id: m.id, mine: m.sender_type === 'staff' && m.sender_user_id === userId, side: m.sender_type === 'staff' ? 'La Europa' : 'University', sender: m.sender_type === 'staff' ? userName(m.sender_user_id) : (get('SELECT name FROM uni_users WHERE id = ?', m.sender_uni_user_id) || {}).name,
    body: m.deleted_at ? null : m.body, deleted: !!m.deleted_at, edited: !!m.edited_at, sent_at: m.sent_at, seen: m.sender_type === 'staff' ? m.seen_by_uni_at : m.seen_by_le_at, attachments: m.deleted_at ? [] : att, context: m.context_type ? { type: m.context_type, id: m.context_id } : null,
    can_edit: m.sender_type === 'staff' && m.sender_user_id === userId && !m.deleted_at && Date.now() - new Date(m.sent_at) < 15 * 60000 };
}
r.get('/university-messages', ah(async (req, res) => {
  const [w, p] = queueScope(req);
  const rows = all(`SELECT ua.* FROM university_applications ua JOIN applications a ON a.id = ua.application_id JOIN students s ON s.id = a.student_id WHERE ${w} AND EXISTS (SELECT 1 FROM uni_messages m WHERE m.uapp_id = ua.id)`, ...p).map(ua => {
    const last = get('SELECT * FROM uni_messages WHERE uapp_id = ? AND deleted_at IS NULL ORDER BY sent_at DESC LIMIT 1', ua.id); const v = C.appView(ua);
    return { key: ua.id, application_id: ua.application_id, university: C.uniName(C.uni(ua.university_id)), title: `${v.application_code}: ${v.student_name}`, sub: `${v.course} (${v.intake})`, last_at: last && last.sent_at, last_text: last ? String(last.body || 'Attachment').slice(0, 90) : '',
      unread: get(`SELECT COUNT(*) c FROM uni_messages WHERE uapp_id = ? AND sender_type = 'university' AND seen_by_le_at IS NULL AND deleted_at IS NULL`, ua.id).c };
  });
  if (isAdmin(req.user)) for (const u of all(`SELECT DISTINCT university_id FROM uni_messages WHERE uapp_id IS NULL`)) { const last = get('SELECT * FROM uni_messages WHERE uapp_id IS NULL AND university_id = ? ORDER BY sent_at DESC LIMIT 1', u.university_id);
    rows.push({ key: 'general:' + u.university_id, university: C.uniName(C.uni(u.university_id)), title: `${C.uniName(C.uni(u.university_id))}: General`, sub: 'Partner topics', last_at: last && last.sent_at, last_text: last ? String(last.body || '').slice(0, 90) : '',
      unread: get(`SELECT COUNT(*) c FROM uni_messages WHERE uapp_id IS NULL AND university_id = ? AND sender_type = 'university' AND seen_by_le_at IS NULL`, u.university_id).c }); }
  res.json({ rows: rows.sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || ''))), universities: isAdmin(req.user) ? all(`SELECT id, COALESCE(display_name, name) name FROM universities WHERE portal_status = 'Active'`) : [] });
}));
function threadKey(req, key) {
  if (String(key).startsWith('general:')) { if (!isAdmin(req.user) && !get('SELECT 1 x FROM universities WHERE id = ? AND partner_manager_id = ?', key.slice(8), req.user.id)) throw forbidden(); return { general: true, university_id: key.slice(8) }; }
  const ua = get('SELECT * FROM university_applications WHERE id = ?', key) || get('SELECT * FROM university_applications WHERE application_id = ?', key); if (!ua) throw U.notFound();
  loadChild(req.user, 'applications', ua.application_id); return { ua, university_id: ua.university_id };
}
r.get('/university-messages/:key', ah(async (req, res) => {
  const t = threadKey(req, req.params.key);
  const where = t.ua ? ['uapp_id = ?', t.ua.id] : ['uapp_id IS NULL AND university_id = ?', t.university_id];
  const rows = all(`SELECT * FROM uni_messages WHERE ${where[0]} ORDER BY sent_at`, where[1]);
  run(`UPDATE uni_messages SET seen_by_le_at = ? WHERE ${where[0]} AND sender_type = 'university' AND seen_by_le_at IS NULL`, now(), where[1]);
  const u = C.uni(t.university_id);
  res.json({ rows: rows.map(m => staffMsgOut(m, req.user.id)), share_contact: !!u.share_contact, university: C.uniName(u), closed: !!(t.ua && t.ua.status === 'Withdrawn') });
}));
const CONTACT_RE = /(\+?\d[\d\s-]{8,}\d)|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
r.post('/university-messages/:key', files.upload.array('files', 5), ah(async (req, res) => {
  try {
    const t = threadKey(req, req.params.key);
    const u = C.uni(t.university_id);
    const body = String(req.body.body || '').replace(/<[^>]*>/g, '').trim().slice(0, 5000);
    const list = req.files || [];
    if (!body && !list.length) throw bad('Write a message or attach a file');
    require('../university/routes').checkAttachments(list);
    const looksContact = CONTACT_RE.test(body) && !/@laeuropa/i.test(body.match(CONTACT_RE)[0] || '');
    if (looksContact && !u.share_contact && !bool(req.body.confirm_contact)) { list.forEach(files.cleanup); throw bad('This message seems to contain contact details. Student contact details are not shared with this university. Send anyway?', { needs_confirm: 'contact' }); }
    const id = uuid();
    insert('uni_messages', { id, uapp_id: t.ua ? t.ua.id : null, university_id: t.university_id, sender_type: 'staff', sender_user_id: req.user.id, body: body || null, sent_at: now(), contact_warning: looksContact ? 1 : 0 });
    for (const f of list) { const ext = path.extname(f.originalname).slice(1).toLowerCase(); const key = `umsg_${uuid()}.${ext}`; VAULT.moveIn(f.path, files.filePath(key)); insert('uni_message_attachments', { id: uuid(), message_id: id, file_key: key, original_name: f.originalname, mime_type: f.mimetype, size_bytes: f.size }); }
    C.notifyUni(t.university_id, t.ua ? { campusId: t.ua.campus_id } : {}, `La Europa: new message${t.ua ? ' on ' + C.appView(t.ua).application_code : ''}`, t.ua ? `#/applications/${t.ua.id}?tab=messages` : '#/messages');
    audit(req, 'Create', 'UniversityMessage', id, `${C.uniName(u)}${looksContact ? ' (contact warning confirmed)' : ''}`);
    res.json({ id });
  } catch (e) { (req.files || []).forEach(files.cleanup); throw e; }
}));
r.put('/university-messages/m/:mid', ah(async (req, res) => {
  const m = get('SELECT * FROM uni_messages WHERE id = ?', req.params.mid); if (!m) throw U.notFound();
  const own = m.sender_type === 'staff' && m.sender_user_id === req.user.id;
  if (!(own && Date.now() - new Date(m.sent_at) < 15 * 60000) && !isAdmin(req.user)) throw bad('Messages can be edited or deleted only within 15 minutes.');
  if (req.body.delete) run('UPDATE uni_messages SET deleted_at = ?, original_body = COALESCE(original_body, body) WHERE id = ?', now(), m.id);
  else { if (!own) throw forbidden(); run('UPDATE uni_messages SET original_body = COALESCE(original_body, body), body = ?, edited_at = ? WHERE id = ?', String(req.body.body || '').trim().slice(0, 5000), now(), m.id); }
  audit(req, req.body.delete ? 'Delete' : 'Update', 'UniversityMessage', m.id); res.json({ ok: true });
}));
r.get('/university-messages/attachment/:aid', ah(async (req, res) => {
  const at = get('SELECT a.*, m.uapp_id, m.university_id FROM uni_message_attachments a JOIN uni_messages m ON m.id = a.message_id WHERE a.id = ?', req.params.aid); if (!at) throw U.notFound();
  threadKey(req, at.uapp_id || 'general:' + at.university_id);
  res.setHeader('Content-Type', at.mime_type || 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename="${String(at.original_name).replace(/"/g, '')}"`); VAULT.pipe(files.filePath(at.file_key), res);
}));
r.post('/university-messages/attachment/:aid/save', ah(async (req, res) => { // "Save to student documents"
  const at = get('SELECT a.*, m.uapp_id FROM uni_message_attachments a JOIN uni_messages m ON m.id = a.message_id WHERE a.id = ?', req.params.aid); if (!at || !at.uapp_id) throw U.notFound();
  const ua = get('SELECT * FROM university_applications WHERE id = ?', at.uapp_id); const { row: a } = loadChild(req.user, 'applications', ua.application_id); need(req.user, 'documents', 'add');
  const ext = path.extname(at.original_name).slice(1).toLowerCase(); if (!files.TYPES[ext]) throw bad('Only PDF, JPG and PNG files can be saved to student documents');
  const t = get(`SELECT * FROM master_items WHERE id = ? AND type = 'document_type'`, req.body.document_type_id) || get(`SELECT * FROM master_items WHERE type = 'document_type' AND name = 'Other university document'`) || get(`SELECT * FROM master_items WHERE type = 'document_type' AND name = 'Others'`);
  const doc = files.docFor(a.student_id, t.id, { title: t.name === 'Others' ? at.original_name : null, application_id: a.id }, req.user.id);
  files.addVersion(doc, VAULT.read(files.filePath(at.file_key)), at.original_name, at.mime_type, ext, req.user.id); // decrypted in memory, stored encrypted again
  run('UPDATE uni_message_attachments SET saved_document_id = ? WHERE id = ?', doc.id, at.id); res.json({ ok: true });
}));

// =====================================================================================
// C18 University sharing consent (student profile) + student portal popup SP26
// =====================================================================================
r.get('/students/:id/uni-consents', ah(async (req, res) => {
  const s = loadStudent(req.user, req.params.id);
  const unis = all(`SELECT DISTINCT a.university_id, a.id application_id, a.application_code FROM applications a JOIN universities u ON u.id = a.university_id WHERE a.student_id = ? AND a.is_deleted = 0 AND u.portal_status = 'Active'`, s.id);
  res.json(unis.map(x => ({ university_id: x.university_id, university: C.uniName(C.uni(x.university_id)), application_id: x.application_id, application_code: x.application_code, ...consentFor(s.id, x.university_id, x.application_id) })));
}));
r.post('/students/:id/uni-consents/request', ah(async (req, res) => {
  const s = loadStudent(req.user, req.params.id); need(req.user, 'applications', 'edit');
  const a = get('SELECT * FROM applications WHERE id = ? AND student_id = ? AND is_deleted = 0', req.body.application_id, s.id); if (!a) throw U.notFound();
  const u = C.uni(a.university_id);
  insert('share_consent_requests', { id: uuid(), student_id: s.id, university_id: u.id, application_id: a.id, status: 'Requested', requested_by: req.user.id, requested_at: now() });
  const su = email.studentUserFor(s, null);
  const country = masterName(u.country_id);
  require('../services').fire(req, 'E49', { student_id: s.id }, { university: C.uniName(u), course: a.course_name_text || masterName(a.course_id), country }, `Sharing consent requested for ${C.uniName(u)} (E49)`, { inAppTitle: `Please confirm: share your application with ${C.uniName(u)}` });
  timeline({ student_id: s.id, type: 'profile', description: `University sharing consent requested for ${C.uniName(u)}`, user_id: req.user.id });
  res.json({ ok: true, portal: !!su });
}));
r.post('/students/:id/uni-consents/offline', files.upload.single('file'), ah(async (req, res) => {
  try {
    const s = loadStudent(req.user, req.params.id); need(req.user, 'documents', 'add');
    const a = get('SELECT * FROM applications WHERE id = ? AND student_id = ? AND is_deleted = 0', req.body.application_id, s.id); if (!a) throw U.notFound();
    if (!req.file) throw fieldErr('file', 'Upload the signed consent form'); if (!clean(req.body.reason)) throw fieldErr('reason', 'Reason is required (why the consent was taken offline)');
    const d = files.saveAs(s.id, 'Consent form', req.file, req.user.id, { application_id: a.id, autoVerify: true, title: 'Consent form' });
    const su = email.studentUserFor(s, null);
    const doc = CONSENT.current('share_consent');
    insert('consent_records', { id: uuid(), student_user_id: su ? su.id : null, lead_id: su ? null : 'student:' + s.id, consent_type: 'share_with_university', university_id: a.university_id, application_id: a.id, value: 'yes', method: 'offline_signed_form',
      document_version: doc && doc.version, document_id: doc && doc.id, document_hash: doc && doc.body_hash, extra_json: JSON.stringify({ document_id: d.document_id, recorded_by: req.user.id, reason: clean(req.body.reason, 300) }), ip: req.ip, created_at: now() });
    run(`UPDATE share_consent_requests SET status = 'Given', answered_at = ?, method = 'offline', document_id = ? WHERE student_id = ? AND university_id = ? AND status = 'Requested'`, now(), d.document_id, s.id, a.university_id);
    timeline({ student_id: s.id, type: 'profile', description: `Offline sharing consent recorded for ${C.uniName(C.uni(a.university_id))} (${clean(req.body.reason, 200)})`, user_id: req.user.id });
    audit(req, 'Create', 'ConsentRecord', s.id, `Offline sharing consent ${a.application_code}`); res.json({ ok: true });
  } catch (e) { files.cleanup(req.file); throw e; }
}));

// =====================================================================================
// S46 University approvals (Admin)
// =====================================================================================
r.get('/admin/uni-approvals', ah(async (req, res) => {
  adminOnly(req);
  const wd = (iso) => { let d = new Date(iso); let n = 0; const end = new Date(); while (d < end) { d = new Date(d.getTime() + 864e5); if (d <= end && ![0, 6].includes(d.getDay())) n++; } return n; };
  const cr = all(`SELECT * FROM course_change_requests WHERE status = 'Pending approval' AND is_deleted = 0 ORDER BY urgent DESC, created_at`).map(x => ({ id: x.id, entity: x.entity, change_type: x.change_type, university: C.uniName(C.uni(x.university_id)), university_id: x.university_id,
    payload: C.parseJ(x.payload_json, {}), old: C.parseJ(x.old_json, null), urgent: !!x.urgent, urgent_reason: x.urgent_reason, warnings: C.parseJ(x.warnings_json, []), batch_id: x.batch_id, created_at: x.created_at, late: wd(x.created_at) > 3,
    by: (get('SELECT name FROM uni_users WHERE id = ?', x.requested_by) || {}).name, fee_flag: C.feeWordNear(C.parseJ(x.payload_json, {}).description) }));
  const pr = all(`SELECT * FROM uni_profile_requests WHERE status = 'Pending' ORDER BY created_at`).map(x => ({ id: x.id, entity: 'profile', change_type: 'Profile', university: C.uniName(C.uni(x.university_id)), university_id: x.university_id, payload: C.parseJ(x.payload_json, {}),
    old: C.parseJ(x.old_json, null), created_at: x.created_at, late: wd(x.created_at) > 3, by: (get('SELECT name FROM uni_users WHERE id = ?', x.requested_by) || {}).name,
    logo_new: C.parseJ(x.payload_json, {}).logo_key ? `/api/admin/uni-approvals/file/${x.id}/logo` : null, logo_old: CAT.logoUrl(C.uni(x.university_id)) }));
  const batches = all(`SELECT b.*, (SELECT COUNT(*) FROM course_change_requests c WHERE c.batch_id = b.id AND c.status = 'Pending approval') pending FROM uni_import_batches b ORDER BY b.created_at DESC LIMIT 50`).filter(b => b.pending)
    .map(b => ({ ...b, university: C.uniName(C.uni(b.university_id)), counts: C.parseJ(b.counts_json, {}) }));
  const history = all(`SELECT id, entity, change_type, status, review_note, reviewed_at, university_id, auto_approved, payload_json FROM course_change_requests WHERE status NOT IN ('Pending approval','Draft') ORDER BY COALESCE(reviewed_at, updated_at) DESC LIMIT 50`)
    .map(x => ({ ...x, name: C.parseJ(x.payload_json, {}).name, university: C.uniName(C.uni(x.university_id)), payload_json: undefined }));
  res.json({ courses: cr.filter(x => x.entity === 'course'), campuses: cr.filter(x => x.entity === 'campus'), scholarships: cr.filter(x => x.entity === 'scholarship'), profiles: pr, batches, history });
}));
r.get('/admin/uni-approvals/file/:id/:kind(logo|cover)', ah(async (req, res) => {
  adminOnly(req); const x = get('SELECT * FROM uni_profile_requests WHERE id = ?', req.params.id); if (!x) throw U.notFound();
  const key = C.parseJ(x.payload_json, {})[req.params.kind + '_key']; if (!key) throw U.notFound();
  res.setHeader('Content-Type', /png$/.test(key) ? 'image/png' : 'image/jpeg'); res.setHeader('Cache-Control', 'private, no-store'); VAULT.pipe(files.filePath(key), res);
}));
r.post('/admin/uni-approvals/:kind(course|profile)/:id/:action(approve|reject)', ah(async (req, res) => {
  adminOnly(req);
  const { kind, id, action } = req.params;
  if (kind === 'profile') { if (action === 'approve') AP.approveProfile(id, req.user, req.body.fields, req.body.edits, clean(req.body.note, 500)); else AP.rejectProfile(id, req.user, req.body.reason); }
  else {
    if (action === 'approve') {
      const x = get('SELECT * FROM course_change_requests WHERE id = ?', id);
      if (x && x.entity === 'course' && req.body.edits) { const p = { ...C.parseJ(x.payload_json, {}), ...req.body.edits }; const errs = C.feeWordCheck({ fee_note: p.fee_note }); if (Object.keys(errs).length) throw bad('Please fix the highlighted fields', { errors: errs }); }
      AP.approveCourse(id, req.user, req.body.edits, { note: clean(req.body.note, 500) });
    } else AP.rejectRequest(id, req.user, req.body.reason);
  }
  audit(req, action === 'approve' ? 'Approve' : 'Reject', kind === 'profile' ? 'UniversityProfileChangeRequest' : 'CourseChangeRequest', id, req.body.reason || req.body.note || '');
  res.json({ ok: true });
}));
r.post('/admin/uni-approvals/batch/:bid/approve', ah(async (req, res) => {
  adminOnly(req); let n = 0; const errs = [];
  for (const x of all(`SELECT id FROM course_change_requests WHERE batch_id = ? AND status = 'Pending approval'`, req.params.bid)) { try { AP.approveCourse(x.id, req.user, null, {}); n++; } catch (e) { errs.push(e.message); } }
  run(`UPDATE uni_import_batches SET status = 'Approved' WHERE id = ?`, req.params.bid);
  audit(req, 'Approve', 'CourseImportBatch', req.params.bid, `${n} approved`); res.json({ ok: true, approved: n, errors: errs });
}));
// Admin edits a course directly on behalf of the university (4.8): live at once, logged, University Admin notified
r.post('/admin/uni-courses/:id/direct', ah(async (req, res) => {
  adminOnly(req); const c = get('SELECT * FROM courses WHERE id = ?', req.params.id); if (!c) throw U.notFound();
  const R2 = require('../university/routes2'); const v = R2.validateCourse(c.university_id, req.body, c.id);
  if (Object.keys(v.errors).length) throw bad('Please fix the highlighted fields', { errors: v.errors });
  const p = R2.payloadOf(req.body, v);
  const id = insert('course_change_requests', { university_id: c.university_id, course_id: c.id, entity: 'course', change_type: 'Edit course (by La Europa)', payload_json: JSON.stringify(p), old_json: JSON.stringify(R2.courseOut(c)), status: 'Pending approval', requested_by: null }, req.user.id);
  AP.approveCourse(id, req.user, null, { note: 'Edited by La Europa' });
  run(`UPDATE courses SET change_source = 'la_europa' WHERE id = ?`, c.id);
  C.notifyUni(c.university_id, { roles: ['admin'] }, `La Europa edited the course ${p.name}`, '#/courses');
  audit(req, 'Update', 'Course', c.id, `Edited on behalf of the university: ${p.name}`); res.json({ ok: true });
}));

// =====================================================================================
// S49 University announcements + partner notices (Admin)
// =====================================================================================
r.get('/admin/uni-announcements', ah(async (req, res) => {
  adminOnly(req);
  const rows = all('SELECT * FROM uni_announcements ORDER BY created_at DESC LIMIT 200').map(a => ({ ...a, university: C.uniName(C.uni(a.university_id)), related: C.parseJ(a.related_json, []).map(id => (get('SELECT name FROM courses WHERE id = ?', id) || {}).name).filter(Boolean),
    attachments: C.parseJ(a.attachments_json, []).map(x => ({ id: x.id, name: x.name })), by: (get('SELECT name FROM uni_users WHERE id = ?', a.created_by) || {}).name }));
  for (const x of rows.filter(y => y.status === 'Posted')) run(`UPDATE uni_announcements SET status = 'Seen by La Europa' WHERE id = ? AND status = 'Posted'`, x.id);
  res.json({ rows, notices: all('SELECT * FROM uni_notices ORDER BY created_at DESC LIMIT 50').map(n => ({ ...n, university: n.university_id ? C.uniName(C.uni(n.university_id)) : 'All universities' })),
    universities: all(`SELECT id, COALESCE(display_name, name) name FROM universities WHERE portal_status IN ('Active','Invited')`) });
}));
r.post('/admin/uni-announcements/:id/:action(publish|handled|reply)', ah(async (req, res) => {
  adminOnly(req); const a = get('SELECT * FROM uni_announcements WHERE id = ?', req.params.id); if (!a) throw U.notFound();
  const act = req.params.action;
  if (act === 'publish') {
    const scope = req.body.scope === 'active' ? 'active' : 'all';
    const counsellors = scope === 'all' ? all(`SELECT u.id FROM users u JOIN roles r0 ON r0.id = u.role_id WHERE r0.code IN ('counsellor','application') AND u.status = 'active' AND u.is_deleted = 0`).map(x => x.id)
      : all(`SELECT DISTINCT s.primary_counsellor_id id FROM applications ap JOIN students s ON s.id = ap.student_id WHERE ap.university_id = ? AND ap.is_deleted = 0 AND ap.stage NOT IN ('rejected','withdrawn','offer_declined','enrolment_confirmed')`, a.university_id).map(x => x.id).filter(Boolean);
    for (const c of counsellors) notify(c, 'university_news', `${a.important ? 'IMPORTANT: ' : ''}${C.uniName(C.uni(a.university_id))}: ${a.title}`, '#/dashboard');
    run(`UPDATE uni_announcements SET published_at = ?, published_by = ?, published_scope = ? WHERE id = ?`, now(), req.user.id, scope, a.id);
  }
  if (act === 'handled') run(`UPDATE uni_announcements SET status = 'Handled', handled_by = ?, handled_at = ? WHERE id = ?`, req.user.id, now(), a.id);
  if (act === 'reply') { const body = clean(req.body.body, 5000); if (!body) throw fieldErr('body', 'Write the reply');
    insert('uni_messages', { id: uuid(), uapp_id: null, university_id: a.university_id, sender_type: 'staff', sender_user_id: req.user.id, body: `Re: ${a.title}\n${body}`, sent_at: now() });
    C.notifyUni(a.university_id, {}, 'La Europa replied to your announcement', '#/messages'); }
  audit(req, 'Update', 'UniversityAnnouncement', a.id, act); res.json({ ok: true });
}));
r.get('/admin/uni-announcements/:id/attachment/:aid', ah(async (req, res) => {
  const a = get('SELECT * FROM uni_announcements WHERE id = ?', req.params.id); if (!a) throw U.notFound();
  const pub = !!a.published_at; if (!isAdmin(req.user) && !pub) throw forbidden();
  const x = C.parseJ(a.attachments_json, []).find(y => y.id === req.params.aid); if (!x) throw U.notFound();
  res.setHeader('Content-Type', x.mime || 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename="${String(x.name).replace(/"/g, '')}"`); VAULT.pipe(files.filePath(x.key), res);
}));
r.post('/admin/uni-notices', ah(async (req, res) => {
  adminOnly(req); if (!clean(req.body.title)) throw fieldErr('title', 'Title is required');
  if (req.body.delete) { run('DELETE FROM uni_notices WHERE id = ?', req.body.delete); return res.json({ ok: true }); }
  const id = insert('uni_notices', { id: uuid(), university_id: req.body.university_id || null, title: clean(req.body.title, 150), body: clean(req.body.body, 2000), active_until: req.body.active_until || null, created_by: req.user.id, created_at: now() });
  const ids = req.body.university_id ? [req.body.university_id] : all(`SELECT id FROM universities WHERE portal_status = 'Active'`).map(x => x.id);
  for (const u of ids) C.notifyUni(u, {}, `Notice from La Europa: ${clean(req.body.title, 150)}`, '#/announcements');
  audit(req, 'Create', 'PartnerNotice', id, req.body.title); res.json({ ok: true });
}));

// =====================================================================================
// S50 - S52 Commission (Admin only, never counsellors)
// =====================================================================================
r.get('/admin/commission/rules', ah(async (req, res) => {
  adminOnly(req);
  res.json({ rows: all('SELECT * FROM commission_rules WHERE is_deleted = 0 ORDER BY university_id, name').map(x => ({ ...x, university: C.uniName(C.uni(x.university_id)), scope_ids: C.parseJ(x.scope_json, []), intakes: C.parseJ(x.intakes_json, []), slabs: C.parseJ(x.slabs_json, []) })),
    universities: all(`SELECT id, COALESCE(display_name, name) name FROM universities WHERE portal_status IS NOT NULL OR id IN (SELECT university_id FROM partner_agreements)`),
    agreements: all('SELECT id, university_id, agreement_code, title FROM partner_agreements WHERE is_deleted = 0'), currencies: all(`SELECT name FROM master_items WHERE type = 'currency' AND is_deleted = 0 ORDER BY sort`).map(x => x.name) });
}));
r.post('/admin/commission/rules', ah(async (req, res) => {
  adminOnly(req);
  const b = req.body; const cur = b.id ? get('SELECT * FROM commission_rules WHERE id = ?', b.id) : null; const e = {};
  if (!C.uni(b.university_id)) e.university_id = 'Choose the university';
  if (!b.agreement_id || !get('SELECT 1 x FROM partner_agreements WHERE id = ? AND university_id = ?', b.agreement_id, b.university_id)) e.agreement_id = 'Choose the partner agreement';
  if (!clean(b.name)) e.name = 'Rule name is required';
  if (!['all', 'levels', 'courses', 'campuses'].includes(b.scope)) e.scope = 'Choose the scope';
  if (!['gross', 'net', 'fixed'].includes(b.basis)) e.basis = 'Choose the basis';
  if (b.basis !== 'fixed' && !(num(b.rate) >= 0.01 && num(b.rate) <= 100)) e.rate = 'Rate must be 0.01 to 100';
  if (b.basis === 'fixed' && !(num(b.fixed_amount) > 0 && b.fixed_currency)) e.fixed_amount = 'Amount and currency are required';
  if (!['enrolled', 'deposit', 'days'].includes(b.due_event)) e.due_event = 'Choose when it becomes due';
  if (b.due_event === 'days' && !(num(b.due_days) >= 0 && num(b.due_days) <= 365)) e.due_days = '0 to 365';
  if (!b.valid_from) e.valid_from = 'Valid from is required';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const scopeIds = b.scope === 'all' ? [] : (b.scope_ids || []);
  // two rules with the same scope and overlapping dates are blocked
  const clash = all(`SELECT * FROM commission_rules WHERE university_id = ? AND scope = ? AND status = 'Active' AND is_deleted = 0 AND id != ?`, b.university_id, b.scope, cur ? cur.id : '-')
    .find(x => JSON.stringify(C.parseJ(x.scope_json, []).sort()) === JSON.stringify([...scopeIds].sort()) && (x.valid_from || '0000') <= (b.valid_to || '9999') && (b.valid_from || '0000') <= (x.valid_to || '9999'));
  if (clash && b.status !== 'Inactive') throw bad(`Rule "${clash.name}" has the same scope and overlapping dates.`);
  const f = { university_id: b.university_id, agreement_id: b.agreement_id, name: clean(b.name, 100), scope: b.scope, scope_json: JSON.stringify(scopeIds), intakes_json: JSON.stringify(b.intakes || []), valid_from: b.valid_from, valid_to: b.valid_to || null,
    basis: b.basis, rate: b.basis === 'fixed' ? null : num(b.rate), fixed_amount: b.basis === 'fixed' ? num(b.fixed_amount) : null, fixed_currency: b.basis === 'fixed' ? b.fixed_currency : null, due_event: b.due_event, due_days: num(b.due_days),
    slabs_json: JSON.stringify((b.slabs || []).filter(s0 => num(s0.from) > 0)), min_amount: num(b.min_amount), max_amount: num(b.max_amount), cap_currency: b.cap_currency || null, show_to_uni: b.show_to_uni === undefined ? 1 : bool(b.show_to_uni) ? 1 : 0,
    status: b.status === 'Inactive' ? 'Inactive' : 'Active', internal_note: clean(b.internal_note, 2000) };
  let id;
  if (cur) { update('commission_rules', cur.id, f, req.user.id); id = cur.id; } else { const n = get('SELECT COUNT(*) c FROM commission_rules').c + 1; id = insert('commission_rules', { rule_code: `LE-CR-${String(n).padStart(4, '0')}`, ...f }, req.user.id); }
  audit(req, cur ? 'Update' : 'Create', 'CommissionRule', id, f.name, cur, f); res.json({ ok: true, id });
}));
function commissionOut(c) {
  const a = c.application_id ? get('SELECT * FROM applications WHERE id = ?', c.application_id) : null; const s = a ? get('SELECT first_name, middle_name, last_name FROM students WHERE id = ?', a.student_id) : null;
  const ua = c.uapp_id && !String(c.uapp_id).startsWith('slab:') ? get('SELECT enrol_date, student_uni_id FROM university_applications WHERE id = ?', c.uapp_id) : null;
  return { ...c, university: C.uniName(C.uni(c.university_id)), student: s ? fullName(s) : 'Volume bonus', application_code: a ? a.application_code : '-', course: a ? (a.course_name_text || masterName(a.course_id)) : '', intake: a ? masterName(a.intake_id) : '',
    enrol_date: ua ? ua.enrol_date : null, student_uni_id: ua ? ua.student_uni_id : null, rule: c.rule_id ? (get('SELECT name FROM commission_rules WHERE id = ?', c.rule_id) || {}).name : null,
    invoice_no: c.invoice_id ? (get('SELECT invoice_no FROM commission_invoices WHERE id = ?', c.invoice_id) || {}).invoice_no : null };
}
r.get('/admin/commission', ah(async (req, res) => {
  adminOnly(req); const q = req.query; const w = ['is_deleted = 0']; const p = [];
  if (q.university) { w.push('university_id = ?'); p.push(q.university); } if (q.status) { w.push('status = ?'); p.push(q.status); }
  const rows = all(`SELECT * FROM commissions WHERE ${w.join(' AND ')} ORDER BY created_at DESC LIMIT 1000`, ...p).map(commissionOut);
  const invoices = all(`SELECT * FROM commission_invoices WHERE is_deleted = 0 ${q.university ? 'AND university_id = ?' : ''} ORDER BY created_at DESC LIMIT 300`, ...(q.university ? [q.university] : []))
    .map(i => ({ ...i, university: C.uniName(C.uni(i.university_id)), balance: Math.round(((i.total || 0) - (i.paid || 0)) * 100) / 100, lines: get('SELECT COUNT(*) c FROM commissions WHERE invoice_id = ?', i.id).c,
      payments: all('SELECT * FROM commission_payments WHERE invoice_id = ? ORDER BY created_at DESC', i.id).map(x => ({ ...x, proof_url: x.proof_key ? `/api/admin/commission/payments/${x.id}/proof` : null })),
      queries: all(`SELECT * FROM invoice_queries WHERE invoice_id = ? ORDER BY created_at DESC`, i.id).map(qq => ({ ...qq, messages: all('SELECT * FROM invoice_query_messages WHERE query_id = ? ORDER BY sent_at', qq.id) })) }));
  res.json({ rows, invoices, rules: all(`SELECT id, name, university_id FROM commission_rules WHERE is_deleted = 0`), universities: all(`SELECT id, COALESCE(display_name, name) name FROM universities WHERE portal_status IS NOT NULL`) });
}));
r.put('/admin/commission/:id', ah(async (req, res) => {
  adminOnly(req); const c = get('SELECT * FROM commissions WHERE id = ?', req.params.id); if (!c) throw U.notFound();
  if (['Invoiced', 'Paid', 'Overdue'].includes(c.status) && !req.body.cancel) throw bad('This line is invoiced. Cancel the invoice with a credit note first.');
  const b = req.body; const f = {};
  if (b.cancel) { if (!clean(b.reason)) throw fieldErr('reason', 'Reason is required'); if (c.invoice_id) throw bad('Cancel the invoice with a credit note first.'); f.status = 'Cancelled'; f.cancel_reason = clean(b.reason, 300); }
  else {
    if ((b.rule_id && b.rule_id !== c.rule_id) || (b.basis_amount !== undefined && num(b.basis_amount) !== c.basis_amount)) { if (!clean(b.reason)) throw fieldErr('reason', 'Reason is required for a manual change'); }
    if (b.rule_id) f.rule_id = b.rule_id; if (b.basis_amount !== undefined) f.basis_amount = num(b.basis_amount);
    const rule = get('SELECT * FROM commission_rules WHERE id = ?', f.rule_id || c.rule_id);
    if (rule) { f.rate = rule.basis === 'fixed' ? null : rule.rate; f.fixed_amount = rule.basis === 'fixed' ? rule.fixed_amount : null; f.amount = A.calcAmount(rule, f.basis_amount ?? c.basis_amount, 0); if (c.status === 'Needs rule') f.status = 'Due'; f.due_date = c.due_date || U.istDate(); }
    if (b.amount !== undefined && num(b.amount) !== null) f.amount = num(b.amount);
    if (b.fx_rate !== undefined) { f.fx_rate = num(b.fx_rate); f.fx_date = b.fx_date || null; f.invoice_currency = b.invoice_currency || null; f.invoice_amount = f.fx_rate ? Math.round((f.amount ?? c.amount) * f.fx_rate * 100) / 100 : null; }
    if (b.internal_note !== undefined) f.internal_note = clean(b.internal_note, 2000);
  }
  update('commissions', c.id, f, req.user.id); audit(req, 'Update', 'Commission', c.id, c.commission_code, c, { ...f, reason: b.reason }); res.json({ ok: true });
}));
function nextInvoiceNo(kind) {
  const t = new Date(); const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; const fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  const prefix = kind === 'credit_note' ? (getSetting('credit_note_prefix') || 'LE-CN') : (getSetting('invoice_prefix') || 'LE-INV');
  const key = `${prefix}-${fy}`;
  run(`INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1`, key);
  return `${prefix}-${fy}-${String(get('SELECT value FROM counters WHERE key = ?', key).value).padStart(4, '0')}`;
}
function invoiceLines(inv) {
  return all('SELECT * FROM commissions WHERE invoice_id = ?', inv.credit_for || inv.id).map(c => { const o = commissionOut(c); return { student: o.student, application: o.application_code, uni_id: o.student_uni_id || '', course: `${o.course} (${o.intake})`, enrolled: o.enrol_date ? fmtDate(o.enrol_date) : '',
    basis: o.basis_amount !== null && o.basis_amount !== undefined ? `${o.basis_amount} ${o.basis_currency || ''}` : '', rate: o.rate ? o.rate + '%' : o.fixed_amount ? 'Fixed' : '', amount: `${o.invoice_amount ?? o.amount} ${o.invoice_currency || o.currency}` }; });
}
async function renderInvoice(inv) {
  const ag = inv.agreement_id ? get('SELECT agreement_code, title FROM partner_agreements WHERE id = ?', inv.agreement_id) : null;
  const buf = await require('../university/pdf').invoicePdf(inv, invoiceLines(inv), { agreement: ag ? `${ag.agreement_code} ${ag.title}` : '-', creditFor: inv.credit_for ? (get('SELECT invoice_no FROM commission_invoices WHERE id = ?', inv.credit_for) || {}).invoice_no : '' });
  return buf;
}
r.post('/admin/commission/invoices', ah(async (req, res) => {
  adminOnly(req);
  const ids = req.body.commission_ids || []; if (!ids.length) throw bad('Select the commission lines');
  const lines = ids.map(id => get(`SELECT * FROM commissions WHERE id = ? AND status = 'Due' AND invoice_id IS NULL AND is_deleted = 0`, id));
  if (lines.some(x => !x)) throw bad('Only lines with status Due (not yet invoiced) can be invoiced');
  if (new Set(lines.map(x => x.university_id)).size > 1) throw bad('All selected lines must belong to the same university');
  const cur = new Set(lines.map(x => x.invoice_currency || x.currency)); if (cur.size > 1) throw bad('All selected lines must have the same invoice currency (enter an exchange rate on the lines first)');
  const u = C.uni(lines[0].university_id); const ag = C.activeAgreement(u.id) || get('SELECT * FROM partner_agreements WHERE university_id = ? AND is_deleted = 0 ORDER BY start_date DESC LIMIT 1', u.id);
  const subtotal = Math.round(lines.reduce((n, x) => n + Number(x.invoice_amount ?? x.amount ?? 0), 0) * 100) / 100;
  const taxes = (req.body.taxes || []).map(t0 => ({ name: clean(t0.name, 60), percent: num(t0.percent), fixed: num(t0.fixed), not_applicable: bool(t0.not_applicable), note: clean(t0.note, 200) })).filter(t0 => t0.name)
    .map(t0 => ({ ...t0, amount: t0.not_applicable ? 0 : t0.percent ? Math.round(subtotal * t0.percent) / 100 : (t0.fixed || 0) }));
  const total = Math.round((subtotal + taxes.reduce((n, t0) => n + t0.amount, 0)) * 100) / 100;
  const finance = get(`SELECT * FROM uni_contacts WHERE university_id = ? AND department = 'Finance / Accounts' AND is_deleted = 0 ORDER BY is_primary DESC LIMIT 1`, u.id);
  const date = req.body.invoice_date || U.istDate();
  const id = insert('commission_invoices', { id: uuid(), invoice_no: `DRAFT-${Date.now()}`, kind: 'invoice', university_id: u.id, agreement_id: ag ? ag.id : null, invoice_date: date, due_date: req.body.due_date || U.addDays(date, Number((ag && ag.payment_terms_days) || 30)),
    currency: [...cur][0], subtotal, tax_json: JSON.stringify(taxes), total, bill_to_json: JSON.stringify({ name: req.body.bill_name || u.legal_name || u.display_name || u.name, address: req.body.bill_address || u.billing_address || '', vat_id: req.body.vat_id || u.vat_id || '', contact: finance ? `${finance.name}, ${finance.email}` : '' }),
    notes: clean(req.body.notes, 1000), status: 'Draft' }, req.user.id);
  for (const x of lines) run('UPDATE commissions SET invoice_id = ? WHERE id = ?', id, x.id);
  audit(req, 'Create', 'CommissionInvoice', id, `Draft for ${C.uniName(u)} (${lines.length} lines)`); res.json({ ok: true, id });
}));
r.get('/admin/commission/invoices/:id/pdf', ah(async (req, res) => {
  adminOnly(req); const i = get('SELECT * FROM commission_invoices WHERE id = ?', req.params.id); if (!i) throw U.notFound();
  const buf = i.pdf_key && i.status !== 'Draft' ? VAULT.read(files.filePath(i.pdf_key)) : await renderInvoice(i);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${i.invoice_no}.pdf"`); res.end(buf);
}));
r.post('/admin/commission/invoices/:id/:action(issue|discard|cancel|pause|resume)', ah(async (req, res) => {
  adminOnly(req); const i = get('SELECT * FROM commission_invoices WHERE id = ?', req.params.id); if (!i) throw U.notFound();
  const act = req.params.action;
  if (act === 'discard') { if (i.status !== 'Draft') throw bad('Only drafts can be discarded'); run('UPDATE commissions SET invoice_id = NULL WHERE invoice_id = ?', i.id); run('UPDATE commission_invoices SET is_deleted = 1 WHERE id = ?', i.id); }
  if (act === 'issue') {
    if (i.status !== 'Draft') throw bad('Already issued');
    const no = nextInvoiceNo('invoice');
    run(`UPDATE commission_invoices SET invoice_no = ?, status = 'Invoiced', issued_at = ?, issued_by = ? WHERE id = ?`, no, now(), req.user.id, i.id);
    const inv = get('SELECT * FROM commission_invoices WHERE id = ?', i.id);
    const key = `invoice_${uuid()}.pdf`; VAULT.write(files.filePath(key), await renderInvoice(inv)); run('UPDATE commission_invoices SET pdf_key = ? WHERE id = ?', key, i.id);
    run(`UPDATE commissions SET status = 'Invoiced' WHERE invoice_id = ?`, i.id);
    finEmail('E35', inv, { invoice_number: no, invoice_date: fmtDate(inv.invoice_date), invoice_total: inv.total, currency: inv.currency, due_date: fmtDate(inv.due_date) });
    C.notifyUni(inv.university_id, { finance: true }, `Invoice ${no} issued`, '#/finance');
  }
  if (act === 'cancel') { // credit note (10.5)
    if (!['Invoiced', 'Partially paid', 'Overdue', 'Paid'].includes(i.status)) throw bad('Only issued invoices can be cancelled');
    if (!clean(req.body.reason)) throw fieldErr('reason', 'Reason is required');
    const no = nextInvoiceNo('credit_note');
    const cid = insert('commission_invoices', { id: uuid(), invoice_no: no, kind: 'credit_note', credit_for: i.id, university_id: i.university_id, agreement_id: i.agreement_id, invoice_date: U.istDate(), currency: i.currency, subtotal: i.subtotal, tax_json: i.tax_json, total: i.total,
      bill_to_json: i.bill_to_json, notes: `Credit note for invoice ${i.invoice_no}. Reason: ${clean(req.body.reason, 500)}`, status: 'Invoiced', issued_at: now(), issued_by: req.user.id }, req.user.id);
    const cn = get('SELECT * FROM commission_invoices WHERE id = ?', cid); const key = `invoice_${uuid()}.pdf`; VAULT.write(files.filePath(key), await renderInvoice(cn)); run('UPDATE commission_invoices SET pdf_key = ? WHERE id = ?', key, cid);
    run(`UPDATE commission_invoices SET status = 'Cancelled', cancel_reason = ? WHERE id = ?`, clean(req.body.reason, 500), i.id);
    run(`UPDATE commissions SET status = 'Due', invoice_id = NULL WHERE invoice_id = ?`, i.id);
    finEmail('E35', cn, { invoice_number: no, invoice_date: fmtDate(cn.invoice_date), invoice_total: cn.total, currency: cn.currency, due_date: '-' });
  }
  if (act === 'pause' || act === 'resume') run('UPDATE commission_invoices SET reminders_paused = ? WHERE id = ?', act === 'pause' ? 1 : 0, i.id);
  audit(req, 'Update', 'CommissionInvoice', i.id, `${act} ${i.invoice_no}`); res.json({ ok: true });
}));
function finEmail(code, inv, ctx) {
  const contacts = all(`SELECT email FROM uni_contacts WHERE university_id = ? AND department = 'Finance / Accounts' AND is_deleted = 0`, inv.university_id).map(x => x.email);
  const users = C.usersOf(inv.university_id, { finance: true, alert: 'finance' }).map(x => x.email);
  UE.trigger(code, { to: [...contacts, ...users], university_id: inv.university_id, invoice_id: inv.id, ctx, link: '/#/finance' });
}
r.post('/admin/commission/payments/:id/:action(confirm|reject)', ah(async (req, res) => {
  adminOnly(req); const p = get(`SELECT * FROM commission_payments WHERE id = ? AND status = 'Submitted'`, req.params.id); if (!p) throw bad('This payment was already reviewed');
  const i = get('SELECT * FROM commission_invoices WHERE id = ?', p.invoice_id);
  if (req.params.action === 'reject') { if (!clean(req.body.reason)) throw fieldErr('reason', 'Reason is required (shown to the university)');
    run(`UPDATE commission_payments SET status = 'Rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`, clean(req.body.reason, 300), req.user.id, now(), p.id);
    C.notifyUni(i.university_id, { finance: true }, `Payment proof for ${i.invoice_no} was not accepted: ${clean(req.body.reason, 200)}`, '#/finance'); }
  else confirmPayment(req, i, p, num(req.body.amount) ?? p.amount, clean(req.body.note, 300));
  audit(req, req.params.action === 'confirm' ? 'Confirm' : 'Reject', 'CommissionPayment', p.id, i.invoice_no); res.json({ ok: true });
}));
function confirmPayment(req, i, p, amount, note) {
  if (p) run(`UPDATE commission_payments SET status = 'Confirmed', confirmed_amount = ?, note = COALESCE(?, note), reviewed_by = ?, reviewed_at = ? WHERE id = ?`, amount, note, req.user.id, now(), p.id);
  const paid = Math.round(((i.paid || 0) + amount) * 100) / 100;
  const status = paid + 0.009 >= i.total ? 'Paid' : 'Partially paid';
  run('UPDATE commission_invoices SET paid = ?, status = ? WHERE id = ?', paid, status, i.id);
  if (status === 'Paid') {
    run(`UPDATE commissions SET status = 'Paid' WHERE invoice_id = ?`, i.id);
  }
  finEmail('E37', i, { amount, currency: i.currency, payment_date: fmtDate(p ? p.payment_date : U.istDate()), invoice_number: i.invoice_no, balance: Math.round((i.total - paid) * 100) / 100 });
  C.notifyUni(i.university_id, { finance: true }, `Payment confirmed for invoice ${i.invoice_no}`, '#/finance');
}
r.post('/admin/commission/invoices/:id/record-payment', ah(async (req, res) => { // from the bank statement, without a university proof
  adminOnly(req); const i = get(`SELECT * FROM commission_invoices WHERE id = ? AND status IN ('Invoiced','Partially paid','Overdue') AND kind = 'invoice'`, req.params.id); if (!i) throw U.notFound();
  const amt = num(req.body.amount); if (!(amt > 0)) throw fieldErr('amount', 'Amount must be more than 0'); if (!req.body.payment_date) throw fieldErr('payment_date', 'Date is required');
  const pid = insert('commission_payments', { id: uuid(), invoice_id: i.id, university_id: i.university_id, amount: amt, currency: i.currency, payment_date: req.body.payment_date, reference: clean(req.body.reference, 100), note: clean(req.body.note, 300), status: 'Submitted', source: 'la_europa', submitted_by: req.user.id, created_at: now() });
  confirmPayment(req, i, get('SELECT * FROM commission_payments WHERE id = ?', pid), amt, null);
  audit(req, 'Create', 'CommissionPayment', pid, `Recorded from bank: ${i.invoice_no}`); res.json({ ok: true });
}));
r.get('/admin/commission/payments/:id/proof', ah(async (req, res) => {
  adminOnly(req); const p = get('SELECT * FROM commission_payments WHERE id = ?', req.params.id); if (!p || !p.proof_key) throw U.notFound();
  res.setHeader('Content-Type', /pdf$/.test(p.proof_key) ? 'application/pdf' : /png$/.test(p.proof_key) ? 'image/png' : 'image/jpeg'); res.setHeader('Cache-Control', 'private, no-store'); VAULT.pipe(files.filePath(p.proof_key), res);
}));
r.post('/admin/commission/queries/:qid/:action(reply|close)', ah(async (req, res) => {
  adminOnly(req); const q = get('SELECT * FROM invoice_queries WHERE id = ?', req.params.qid); if (!q) throw U.notFound();
  if (req.params.action === 'reply') { const body = clean(req.body.body, 2000); if (!body) throw fieldErr('body', 'Write the reply'); insert('invoice_query_messages', { id: uuid(), query_id: q.id, sender_type: 'staff', sender_id: req.user.id, body, sent_at: now() }); }
  else { run(`UPDATE invoice_queries SET status = 'Closed', closed_at = ?, closed_by = ? WHERE id = ?`, now(), req.user.id, q.id);
    if (!get(`SELECT 1 x FROM invoice_queries WHERE invoice_id = ? AND status = 'Open'`, q.invoice_id)) run('UPDATE commission_invoices SET query_open = 0 WHERE id = ?', q.invoice_id); }
  C.notifyUni(q.university_id, { finance: true }, `La Europa ${req.params.action === 'reply' ? 'replied to' : 'closed'} your invoice query`, '#/finance');
  res.json({ ok: true });
}));
// S52 reports (per currency, no conversion)
r.get('/admin/commission/reports/:type', ah(async (req, res) => {
  adminOnly(req);
  const q = req.query; const w = ['c.is_deleted = 0']; const p = [];
  if (q.university) { w.push('c.university_id = ?'); p.push(q.university); } if (q.from) { w.push('c.created_at >= ?'); p.push(q.from); } if (q.to) { w.push('c.created_at <= ?'); p.push(q.to + 'T23:59:59'); }
  const lines = all(`SELECT c.*, a.intake_id, ap.country_id FROM commissions c LEFT JOIN applications a ON a.id = c.application_id LEFT JOIN applications ap ON ap.id = c.application_id WHERE ${w.join(' AND ')}`, ...p).filter(x => (!q.intake || x.intake_id === q.intake) && (!q.country || x.country_id === q.country) && (!q.currency || (x.invoice_currency || x.currency) === q.currency));
  const sum = (list) => Math.round(list.reduce((n, x) => n + Number(x.amount || 0), 0) * 100) / 100;
  const ST = ['Expected', 'Due', 'Invoiced', 'Paid', 'Overdue'];
  let data;
  const groupBy = (keyFn) => { const g = {}; for (const x of lines) { const k = `${keyFn(x)}|${x.currency || '-'}`; (g[k] = g[k] || []).push(x); } return g; };
  if (q.type === undefined && req.params.type === 'by_university' || req.params.type === 'by_university') data = { columns: ['University', 'Currency', ...ST], rows: Object.entries(groupBy(x => C.uniName(C.uni(x.university_id)))).map(([k, list]) => [...k.split('|'), ...ST.map(s => sum(list.filter(x => x.status === s)))]) };
  else if (req.params.type === 'by_intake') data = { columns: ['Intake', 'Currency', ...ST], rows: Object.entries(groupBy(x => masterName(x.intake_id) || '-')).map(([k, list]) => [...k.split('|'), ...ST.map(s => sum(list.filter(x => x.status === s)))]) };
  else if (req.params.type === 'ageing') { const inv = all(`SELECT * FROM commission_invoices WHERE status = 'Overdue' AND is_deleted = 0 ${q.university ? 'AND university_id = ?' : ''}`, ...(q.university ? [q.university] : []));
    const bucket = (d) => { const n = Math.floor((Date.now() - new Date(d)) / 864e5); return n <= 30 ? '1 to 30' : n <= 60 ? '31 to 60' : n <= 90 ? '61 to 90' : 'more than 90'; };
    data = { columns: ['Invoice', 'University', 'Due date', 'Days overdue', 'Bucket', 'Balance', 'Currency'], rows: inv.map(i => [i.invoice_no, C.uniName(C.uni(i.university_id)), fmtDate(i.due_date), Math.floor((Date.now() - new Date(i.due_date)) / 864e5), bucket(i.due_date), Math.round((i.total - i.paid) * 100) / 100, i.currency]) }; }
  else if (req.params.type === 'forecast') { const g = {}; for (const x of lines.filter(y => ['Expected', 'Due'].includes(y.status))) { const k = `${(x.due_date || 'not set').slice(0, 7)}|${x.currency}`; g[k] = (g[k] || 0) + Number(x.amount || 0); }
    data = { columns: ['Month', 'Currency', 'Expected / due amount'], rows: Object.entries(g).sort().map(([k, v]) => [...k.split('|'), Math.round(v * 100) / 100]) }; }
  else if (req.params.type === 'collections') { const ps = all(`SELECT * FROM commission_payments WHERE status = 'Confirmed'`); const g = {}; for (const x of ps) { const k = `${String(x.payment_date).slice(0, 7)}|${x.currency}`; g[k] = (g[k] || 0) + Number(x.confirmed_amount ?? x.amount); }
    data = { columns: ['Month', 'Currency', 'Confirmed payments'], rows: Object.entries(g).sort().map(([k, v]) => [...k.split('|'), Math.round(v * 100) / 100]) }; }
  else if (req.params.type === 'attention') data = { columns: ['Type', 'Reference', 'University', 'Detail'], rows: [
    ...lines.filter(x => x.status === 'Needs rule').map(x => ['Needs rule', x.commission_code, C.uniName(C.uni(x.university_id)), x.internal_note || '']),
    ...all(`SELECT q.*, i.invoice_no FROM invoice_queries q JOIN commission_invoices i ON i.id = q.invoice_id WHERE q.status = 'Open'`).map(x => ['Query open', x.invoice_no, C.uniName(C.uni(x.university_id)), '']),
    ...all(`SELECT * FROM commission_invoices WHERE status = 'Cancelled' ORDER BY updated_at DESC LIMIT 50`).map(x => ['Invoice cancelled', x.invoice_no, C.uniName(C.uni(x.university_id)), x.cancel_reason || '']),
    ...lines.filter(x => x.recalculated).map(x => ['Recalculated', x.commission_code, C.uniName(C.uni(x.university_id)), ''])] };
  else if (req.params.type === 'universities') data = { columns: ['University', 'Portal', 'Applications', 'New not acknowledged', 'Offers', 'Enrolled', 'Avg days to decision'], rows: all(`SELECT * FROM universities WHERE portal_status IS NOT NULL`).map(u => {
    const ua = all('SELECT * FROM university_applications WHERE university_id = ? AND is_deleted = 0', u.id); const dec = ua.filter(x => x.first_decision_at);
    return [C.uniName(u), u.portal_status, ua.length, ua.filter(x => x.status === 'New').length, ua.filter(x => ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(x.status)).length, ua.filter(x => x.status === 'Enrolled').length,
      dec.length ? Math.round(dec.reduce((n, x) => n + (new Date(x.first_decision_at) - new Date(x.submitted_at)) / 864e5, 0) / dec.length * 10) / 10 : '-']; }) };
  else throw U.notFound();
  if (!q.format) return res.json(data);
  audit(req, 'Export', 'CommissionReport', null, `${req.params.type} ${q.format}`);
  if (q.format === 'xlsx') { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Report'); ws.addRow(data.columns).font = { bold: true }; data.rows.forEach(x => ws.addRow(x)); ws.columns.forEach(c => { c.width = 20; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.xlsx"`); await wb.xlsx.write(res); return res.end(); }
  const buf = await require('../university/pdf').tablePdf({ title: `La Europa: ${req.params.type.replace(/_/g, ' ')}`, sub: `Generated on ${fmtDateTime(new Date())} IST. Totals per currency, no conversion.`, columns: data.columns, rows: data.rows });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.pdf"`); res.end(buf);
}));

// =====================================================================================
// S53 University portal settings (global)
// =====================================================================================
const UNI_SETTINGS = { uni_portal_enabled: '1', uni_idle_min: '30', uni_remember_device: '1', uni_invite_days: '7', uni_review_reminder_days: '1', uni_review_admin_days: '2', uni_always_review_rejections: '1', uni_ack_email: '1',
  uni_auto_approve_minor: '0', uni_small_numbers: '1', uni_download_alert: '50', uni_access_months: '12', uni_ack_days: '3', uni_agreement_warn_days: '60', uni_agreement_reminders: '60,30,7', uni_invoice_reminders: '7,0,7',
  uni_bulk_max_rows: '1000', uni_max_file_mb: '10', uni_sending_address: '', uni_display_name: 'La Europa Education Partner Team', uni_noreply_address: '', partner_portal_url: '', uni_email_footer: '',
  uni_officers_edit_contacts: '0', invoice_prefix: 'LE-INV', credit_note_prefix: 'LE-CN', invoice_tax_ids: '', invoice_bank_details: '', show_uni_social: '0' };
r.get('/admin/uni-settings', ah(async (req, res) => { adminOnly(req); res.json({ values: Object.fromEntries(Object.entries(UNI_SETTINGS).map(([k, d]) => [k, getSetting(k) ?? d])), countries: all('SELECT id, name, transfers_allowed FROM countries WHERE is_deleted = 0 ORDER BY name') }); }));
r.put('/admin/uni-settings', ah(async (req, res) => {
  adminOnly(req); const b = req.body || {}; const e = {};
  if (b.uni_idle_min !== undefined && !(Number(b.uni_idle_min) >= 15 && Number(b.uni_idle_min) <= 120)) e.uni_idle_min = '15 to 120 minutes';
  if (b.uni_sending_address && !isEmail(b.uni_sending_address)) e.uni_sending_address = 'Valid email address';
  if (b.partner_portal_url && !/^https?:\/\//.test(b.partner_portal_url)) e.partner_portal_url = 'Full URL (https://...)';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  for (const k of Object.keys(UNI_SETTINGS)) if (k in b) setSetting(k, b[k] === true ? '1' : b[k] === false ? '0' : String(b[k] ?? ''), req.user.id);
  for (const c of b.countries || []) run('UPDATE countries SET transfers_allowed = ? WHERE id = ?', c.transfers_allowed ? 1 : 0, c.id);
  audit(req, 'Update', 'Settings', null, 'University portal settings'); res.json({ ok: true });
}));
// document type flags (C19)
r.put('/admin/doc-types/:id/uni-flags', ah(async (req, res) => {
  adminOnly(req); const t = get(`SELECT * FROM master_items WHERE id = ? AND type = 'document_type'`, req.params.id); if (!t) throw U.notFound();
  const d = C.parseJ(t.data_json, {}); d.never_share_uni = bool(req.body.never_share_uni); d.uni_can_upload = bool(req.body.uni_can_upload);
  run('UPDATE master_items SET data_json = ? WHERE id = ?', JSON.stringify(d), t.id); audit(req, 'Update', 'DocumentType', t.id, t.name); res.json({ ok: true });
}));

module.exports = r;
module.exports.consentFor = consentFor;
module.exports.UNI_SETTINGS = UNI_SETTINGS;
