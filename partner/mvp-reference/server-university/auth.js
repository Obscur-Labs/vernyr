'use strict';
// University portal login (University doc Section 2): no public sign-up, invite + email code, mandatory 2FA (TOTP or email code),
// lockout, password history, idle / absolute session limits, trusted devices. Own table, own cookie, own API namespace.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const QR = require('qrcode');
const { all, get, run, insert, update, uuid, now, getSetting, encrypt, decrypt } = require('../db');
const U = require('../util');
const { bad, ah, HttpError, clean, isEmail } = U;
const email = require('../email');
const C = require('./common');
const CONSENT = require('../portal/consent');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const code6 = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
const TD_COOKIE = 'le_utd';
const GENERIC = 'Invalid email or password';

// ---------- rate limits ----------
const buckets = new Map();
function hit(key, max, ms) { const t = Date.now(); const b = buckets.get(key) || { n: 0, reset: t + ms }; if (t > b.reset) { b.n = 0; b.reset = t + ms; } b.n++; buckets.set(key, b); if (b.n > max) throw new HttpError(429, 'Too many requests. Please try again in a few minutes.'); }
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 60000).unref();

// ---------- password rules (2.6, 2.10) ----------
const G = require('../guard');
function pwRule(pw, who = []) {
  if (!pw || pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) throw bad('Password must be at least 10 characters with at least 1 letter, 1 number and 1 symbol', { errors: { password: 'Min 10 characters, 1 letter, 1 number, 1 symbol' } });
  G.strong(pw, who); // max 72 bytes (bcrypt), not a common password, not the name / email
}
// async bcrypt: checking 5 old passwords does not block the server
async function notReused(uu, pw) {
  const hist = C.parseJ(uu.pw_history_json, []).concat(uu.password_hash ? [uu.password_hash] : []);
  for (const h of hist.slice(-5)) if (await bcrypt.compare(String(pw), h)) throw bad('New password cannot be the same as any of your last 5 passwords', { errors: { password: 'Used recently' } });
}
async function setPassword(uu, pw) {
  const hist = C.parseJ(uu.pw_history_json, []); if (uu.password_hash) hist.push(uu.password_hash);
  run('UPDATE uni_users SET password_hash = ?, pw_history_json = ?, updated_at = ? WHERE id = ?', await G.hash(pw), JSON.stringify(hist.slice(-5)), now(), uu.id);
}

// ---------- TOTP (RFC 6238, 30 s, 6 digits) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(s) { let bits = 0, val = 0; const out = []; for (const ch of String(s).replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32dec(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
function totpOk(secret, code) { const c = Math.floor(Date.now() / 30000); return [-1, 0, 1].some(d => crypto.timingSafeEqual(Buffer.from(hotp(secret, c + d)), Buffer.from(String(code || '').padStart(6, 'x').slice(0, 6)))); }

// ---------- one-time codes (SE4 / SE5 / SE6) ----------
async function sendCode(uu, purpose, subjectLine) {
  hit('ucode:' + uu.id, 6, 3600e3);
  const c = code6(); const id = uuid();
  insert('uni_codes', { id, uni_user_id: uu.id, purpose, code_hash: sha(id + c), attempts: 0, expires_at: new Date(Date.now() + 10 * 60000).toISOString(), last_sent_at: now(), created_at: now() });
  await email.sendSecurity({ to: uu.email, subject: subjectLine || 'Your La Europa partner portal code', text: `Your La Europa partner portal code is ${c}.\n\nIt is valid for 10 minutes. Do not share this code with anyone.`, masked: 'Your La Europa partner portal code is ******.' });
  return { code_id: id, masked: maskEmail(uu.email) };
}
function checkCode(codeId, code, uuId, purposes) {
  const o = get('SELECT * FROM uni_codes WHERE id = ? AND used = 0', codeId);
  if (!o || o.uni_user_id !== uuId || !purposes.includes(o.purpose) || new Date(o.expires_at) < new Date()) throw bad('This code has expired. Please request a new one.');
  if (o.attempts >= 5) throw bad('Too many wrong codes. Please request a new one.');
  const given = Buffer.from(sha(o.id + String(code || '').trim())), want = Buffer.from(String(o.code_hash));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) { run('UPDATE uni_codes SET attempts = attempts + 1 WHERE id = ?', o.id); throw bad(`Wrong code. ${4 - o.attempts} attempt(s) left.`, { errors: { code: 'Wrong code' } }); }
  if (!run('UPDATE uni_codes SET used = 1 WHERE id = ? AND used = 0', o.id).changes) throw bad('This code has expired. Please request a new one.');
  return o;
}
const maskEmail = (e) => String(e || '').replace(/^(.{2}).*(@.*)$/, '$1****$2');

// ---------- sessions ----------
const idleMin = () => Math.min(120, Math.max(15, Number(getSetting('uni_idle_min') || 30)));
function createSession(req, res, uu, { twofa = false, previewBy = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url'); const t = now();
  const id = uuid();
  insert('uni_sessions', { id, uni_user_id: uu.id, token_hash: sha(token), twofa_done: twofa ? 1 : 0, preview_by: previewBy, created_at: t, last_seen_at: t,
    expires_at: new Date(Date.now() + (previewBy ? 2 : 12) * 3600e3).toISOString(), ip: req.ip, user_agent: String(req.headers['user-agent'] || '').slice(0, 300) });
  res.cookie(C.COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.COOKIE_SECURE === '1', path: '/' });
  return id;
}
function sessionOf(req) {
  const token = req.cookies && req.cookies[C.COOKIE];
  if (!token) return null;
  return get('SELECT * FROM uni_sessions WHERE token_hash = ? AND revoked = 0', sha(token));
}
function ipAllowed(u, ip) {
  const list = String(u.ip_allowlist || '').split(/[\s,]+/).filter(Boolean);
  return !list.length || list.some(x => String(ip || '').replace('::ffff:', '') === x);
}
// Middleware for /api/university/* (everything except /auth)
function authenticate(req, res, next) {
  const s = sessionOf(req);
  if (!s) return next(new HttpError(401, 'Please log in'));
  if (new Date(s.expires_at) < new Date() || Date.now() - new Date(s.last_seen_at) > idleMin() * 60000) { run('UPDATE uni_sessions SET revoked = 1 WHERE id = ?', s.id); return next(new HttpError(401, 'Your session has expired. Please log in again.')); }
  if (!s.twofa_done) return next(new HttpError(401, 'Please complete two-factor authentication'));
  const uu = get('SELECT * FROM uni_users WHERE id = ? AND is_deleted = 0', s.uni_user_id);
  if (!uu || (uu.status !== 'Active' && !s.preview_by)) return next(new HttpError(401, 'Please log in'));
  const u = C.uni(uu.university_id);
  if (!s.preview_by) {
    if (!u || u.portal_status !== 'Active') { run('UPDATE uni_sessions SET revoked = 1 WHERE id = ?', s.id); return next(new HttpError(401, 'Your access is paused. Please contact La Europa.')); }
    if (getSetting('uni_portal_enabled') === '0') return next(new HttpError(503, 'The partner portal is temporarily unavailable.'));
    if (!ipAllowed(u, req.ip)) return next(new HttpError(403, 'Access from this network is not allowed for your institution.'));
  }
  if (req.headers['x-activity'] !== 'passive') run('UPDATE uni_sessions SET last_seen_at = ? WHERE id = ?', now(), s.id);
  req.uu = uu; req.uni = u; req.usession = s; req.preview = !!s.preview_by;
  req.campuses = C.parseJ(uu.campuses_json, []);
  if (req.preview && !['GET', 'HEAD'].includes(req.method) && !req.path.startsWith('/auth/logout')) return next(new HttpError(403, 'View as university: read only'));
  next();
}
function meOut(uu) {
  const u = C.uni(uu.university_id);
  return { id: uu.id, name: uu.name, email: uu.email, role: uu.role, role_label: C.ROLE_LABEL[uu.role], finance: !!(uu.finance || uu.role === 'admin'), designation: uu.designation, phone: uu.phone,
    twofa_method: uu.twofa_method, alerts: C.parseJ(uu.alerts_json, null), campuses: C.parseJ(uu.campuses_json, []), main_contact: !!uu.is_main_contact,
    university: { id: u.id, name: u.display_name || u.name, short_name: u.short_name, logo: require('../portal/catalogue').logoUrl(u), country: U.masterName(u.country_id), status: u.portal_status,
      officers_propose: !!u.officers_propose, viewer_docs: !!u.viewer_docs, zip: !!u.zip_download, viewer_exports: !!u.viewer_exports, show_expected: !!u.show_expected_commission },
    idle_min: idleMin() };
}

// ---------- routes ----------
const r = express.Router();
r.get('/legal/:type', (req, res) => { const t = ['uni_terms', 'uni_dpa'].includes(req.params.type) ? req.params.type : 'uni_terms'; res.json(CONSENT.publicDoc(t) || {}); });

r.post('/login', ah(async (req, res) => {
  hit('ulogin-ip:' + req.ip, 20, 15 * 60000);
  const em = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(req.body.password || '');
  if (password.length > 200) throw new HttpError(401, GENERIC);
  G.ipCheck('uni_login_attempts', req.ip, req); // password spraying: too many failures from this IP (any accounts)
  const uu = get('SELECT * FROM uni_users WHERE lower(email) = ? AND is_deleted = 0', em);
  const key = uu ? uu.id : em;
  const fail = () => { run('INSERT INTO uni_login_attempts (ident, success, ip, created_at) VALUES (?,?,?,?)', key, 0, req.ip, now());
    req.auditUniUserId = uu ? uu.id : null; C.uaudit(req, 'Failed login', 'UniversityUser', uu ? uu.id : null, em.replace(/^(.{2}).*(@.*)$/, '$1***$2'), null, null, uu ? uu.university_id : null); throw new HttpError(401, GENERIC); };
  const LOCKED = 'Too many attempts. Your account is locked for 30 minutes. You can reset your password.';
  // an unknown email is "locked" the same way, so a 423 never tells whether an account exists
  if ((uu && uu.locked_until && new Date(uu.locked_until) > new Date()) || (!uu && G.failures('uni_login_attempts', 'ident', key, 15) >= 5)) throw new HttpError(423, LOCKED);
  const end = G.begin('uni:' + key); // race condition: one password check at a time per account
  try {
    if (!(await require('../auth').same(password, uu && uu.password_hash))) { // async; unknown accounts cost the same time
      const n = G.failures('uni_login_attempts', 'ident', key, 15) + 1;
      if (uu && n >= 5) {
        run('UPDATE uni_users SET locked_until = ? WHERE id = ?', new Date(Date.now() + 30 * 60000).toISOString(), uu.id);
        run('INSERT INTO uni_login_attempts (ident, success, ip, created_at) VALUES (?,?,?,?)', uu.id, 0, req.ip, now());
        req.auditUniUserId = uu.id; C.uaudit(req, 'Lockout', 'UniversityUser', uu.id, uu.email, null, null, uu.university_id);
        C.notifyUni(uu.university_id, { roles: ['admin'] }, `Account locked after 5 wrong passwords: ${uu.name}`, '#/users');
        for (const a of U.admins()) U.notify(a, 'university', `University user locked out: ${uu.name} (${C.uniName(C.uni(uu.university_id))})`, '#/admin/university');
        email.sendSecurity({ to: uu.email, subject: 'Your La Europa partner portal account was locked', text: `There were 5 wrong passwords on your La Europa partner portal account at ${U.fmtDateTime(new Date())} IST, so it is locked for 30 minutes.\nIf this was not you, reset your password and tell La Europa.` });
        await G.slowDown(n);
        throw new HttpError(423, LOCKED);
      }
      await G.slowDown(n); // brute force: every wrong password waits longer
      fail();
    }
  } finally { end(); }
  await G.rehash('uni_users', uu.id, password, uu.password_hash);
  const u = C.uni(uu.university_id);
  if (uu.status === 'Invited') throw bad('Please finish setting up your account from the invite link in your email.');
  if (uu.status !== 'Active') fail();
  if (!u || ['Suspended', 'Closed', 'Draft'].includes(u.portal_status)) throw new HttpError(403, 'Your access is paused. Please contact La Europa.');
  if (!ipAllowed(u, req.ip)) throw new HttpError(403, 'Access from this network is not allowed for your institution.');
  run('INSERT INTO uni_login_attempts (ident, success, ip, created_at) VALUES (?,?,?,?)', uu.id, 1, req.ip, now());
  // No 2FA (La Europa decision, Nov 2026). Only a first login without a verified email gets a one-time email code.
  if (!uu.email_verified_at) {
    createSession(req, res, uu, { twofa: false });
    req.auditUniUserId = uu.id; C.uaudit(req, 'Login', 'UniversityUser', uu.id, 'Password OK, first-login email code sent', null, null, uu.university_id);
    return res.json({ need_2fa: true, method: 'email', first_login: true, ...(await sendCode(uu, '2fa', 'Your La Europa partner portal verification code')) });
  }
  finishLogin(req, res, uu, createSession(req, res, uu, { twofa: true }), 'Login with password');
}));
function finishLogin(req, res, uu, sid, how) {
  run('UPDATE uni_users SET twofa_failed = 0, last_login_at = ?, locked_until = NULL WHERE id = ?', now(), uu.id);
  // new device alert (SE6)
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  if (all('SELECT 1 x FROM uni_sessions WHERE uni_user_id = ? AND user_agent = ? AND twofa_done = 1 AND id != ?', uu.id, ua, sid).length === 0 && get('SELECT COUNT(*) c FROM uni_sessions WHERE uni_user_id = ? AND twofa_done = 1', uu.id).c > 1)
    email.sendSecurity({ to: uu.email, subject: 'New login to your La Europa partner portal account', text: `There was a new login to your La Europa partner portal account on ${U.fmtDateTime(new Date())} IST from ${ua.slice(0, 80)}.\nIf this was not you, reset your password now and tell La Europa.` });
  req.auditUniUserId = uu.id; C.uaudit(req, 'Login', 'UniversityUser', uu.id, how, null, null, uu.university_id);
  res.json({ user: meOut(get('SELECT * FROM uni_users WHERE id = ?', uu.id)) });
}

// Pending session (password OK, first-login email code not entered yet)
function pending(req) { const s = sessionOf(req); if (!s) throw new HttpError(401, 'Please log in again'); const uu = get('SELECT * FROM uni_users WHERE id = ?', s.uni_user_id); return { s, uu }; }
r.post('/2fa/email/send', ah(async (req, res) => { const { uu } = pending(req); res.json(await sendCode(uu, '2fa', 'Your La Europa partner portal verification code')); }));
r.post('/2fa/verify', ah(async (req, res) => {
  const { s, uu } = pending(req);
  checkCode(req.body.code_id, String(req.body.code || '').replace(/\s/g, ''), uu.id, ['2fa']);
  run('UPDATE uni_users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', now(), uu.id);
  run('UPDATE uni_sessions SET twofa_done = 1, last_seen_at = ? WHERE id = ?', now(), s.id);
  finishLogin(req, res, uu, s.id, 'First login, email verified');
}));

// ---------- invite activation (2.5, 2.6) ----------
function byInvite(token) { const uu = get('SELECT * FROM uni_users WHERE invite_token_hash = ? AND is_deleted = 0', sha(token)); return uu && uu.invite_expires_at && new Date(uu.invite_expires_at) > new Date() ? uu : null; }
r.get('/invite/:token', ah(async (req, res) => {
  const uu = byInvite(req.params.token);
  if (!uu) return res.json({ valid: false, message: 'This link has expired. Please ask La Europa to resend it.' });
  const u = C.uni(uu.university_id);
  res.json({ valid: true, email: uu.email, name: uu.name, designation: uu.designation, phone: uu.phone, university: C.uniName(u), password_set: !!uu.password_hash,
    terms: CONSENT.publicDoc('uni_terms'), dpa: CONSENT.publicDoc('uni_dpa') });
}));
r.post('/invite/:token/request-new', ah(async (req, res) => {
  const uu = get('SELECT * FROM uni_users WHERE invite_token_hash = ?', sha(req.params.token));
  if (uu) { const u = C.uni(uu.university_id); if (u.partner_manager_id) U.notify(u.partner_manager_id, 'university', `${uu.name} (${C.uniName(u)}) asked for a new partner portal invite link`, '#/admin/university'); }
  res.json({ message: 'La Europa has been told and will send you a new link.' });
}));
r.post('/invite/:token/start', ah(async (req, res) => { const uu = byInvite(req.params.token); if (!uu) throw bad('This link has expired. Please ask La Europa to resend it.'); res.json(await sendCode(uu, 'invite', 'Your La Europa partner portal code')); }));
r.post('/invite/:token/accept', ah(async (req, res) => {
  const uu = byInvite(req.params.token); if (!uu) throw bad('This link has expired. Please ask La Europa to resend it.');
  const b = req.body; const errors = {};
  if (!clean(b.name)) errors.name = 'Full name is required';
  try { pwRule(b.password); } catch (e) { errors.password = e.extra.errors.password; }
  if (b.password !== b.confirm) errors.confirm = 'Passwords do not match';
  if (!b.accept_terms) errors.accept_terms = 'Please accept the Portal Terms of Use and Data Processing terms';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  checkCode(b.code_id, b.code, uu.id, ['invite']);
  try { pwRule(b.password, [uu.email, b.name]); } catch (e) { throw bad('Please fix the highlighted fields', { errors: e.extra.errors }); }
  await setPassword(uu, b.password);
  update('uni_users', uu.id, { name: clean(b.name, 100), designation: clean(b.designation, 100), phone: clean(b.phone, 30) });
  for (const t of ['uni_terms', 'uni_dpa']) { const d = CONSENT.current(t); insert('uni_consents', { id: uuid(), uni_user_id: uu.id, university_id: uu.university_id, doc_type: t, version: d ? d.version : null, doc_hash: d ? d.body_hash : null, ip: req.ip, user_agent: String(req.headers['user-agent'] || '').slice(0, 300), created_at: now() }); }
  // the invite email code is the first-login verification: the account is active now, no 2FA set up step
  run(`UPDATE uni_users SET status = 'Active', email_verified_at = COALESCE(email_verified_at, ?), invite_token_hash = NULL, invite_expires_at = NULL WHERE id = ?`, now(), uu.id);
  const u = C.uni(uu.university_id);
  if (u.portal_status === 'Invited') run(`UPDATE universities SET portal_status = 'Active' WHERE id = ?`, u.id);
  for (const a of U.admins()) U.notify(a, 'university', `${uu.name} (${C.uniName(u)}) activated the partner portal account`, '#/admin/university');
  const nu = get('SELECT * FROM uni_users WHERE id = ?', uu.id);
  req.auditUniUserId = uu.id; C.uaudit(req, 'Invite accepted', 'UniversityUser', uu.id, uu.email, null, null, uu.university_id);
  finishLogin(req, res, nu, createSession(req, res, nu, { twofa: true }), 'Invite accepted, email verified');
}));

// ---------- forgot / reset (2.10) ----------
// Forgot password: a 6-digit code by email (no link). Same answer whether or not the email exists.
r.post('/forgot', ah(async (req, res) => {
  const msg = 'If this email is registered, we have emailed a 6-digit code. It is valid for 10 minutes.';
  hit('ureset-ident:' + sha(String(req.body.email || '').trim().toLowerCase()), 5, 3600e3); // same limit for unknown emails (no account enumeration)
  require('../botcheck').gateRate(req, 'uforgot');
  const uu = get(`SELECT * FROM uni_users WHERE lower(email) = lower(?) AND is_deleted = 0 AND status = 'Active'`, String(req.body.email || '').trim());
  if (!uu) return res.json({ message: msg, code_id: uuid() });
  run("UPDATE uni_codes SET used = 1 WHERE uni_user_id = ? AND purpose = 'reset' AND used = 0", uu.id); // a new code cancels older reset codes / links
  const s = await sendCode(uu, 'reset', 'Your La Europa partner portal password reset code');
  res.json({ message: msg, code_id: s.code_id });
}));
r.post('/reset', ah(async (req, res) => {
  let o;
  if (req.body.code_id) {
    o = get('SELECT * FROM uni_codes WHERE id = ? AND used = 0', req.body.code_id);
    if (!o) throw bad('This code has expired. Please request a new one.');
    pwRule(req.body.password);
    if (req.body.password !== req.body.confirm) throw bad('Passwords do not match', { errors: { confirm: 'Does not match' } });
    // audit H2: the emailed code FIRST, then the "not reused" rule (no password guessing through reset)
    checkCode(req.body.code_id, String(req.body.code || '').replace(/\s/g, ''), o.uni_user_id, ['reset']);
  } else {
    o = get(`SELECT * FROM uni_codes WHERE code_hash = ? AND purpose = 'reset' AND used = 0`, sha(String(req.body.token || '')));
    if (!o || new Date(o.expires_at) < new Date()) throw bad('This link has expired. Please request a new one.');
    pwRule(req.body.password);
    if (req.body.password !== req.body.confirm) throw bad('Passwords do not match', { errors: { confirm: 'Does not match' } });
  }
  const uu = get('SELECT * FROM uni_users WHERE id = ?', o.uni_user_id);
  if (req.body.code_id) run('UPDATE uni_users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', now(), uu.id);
  pwRule(req.body.password, [uu.email, uu.name]);
  await notReused(uu, req.body.password);
  // race condition: a reset link is used up atomically (an emailed code was already used up by checkCode)
  if (!req.body.code_id && !run('UPDATE uni_codes SET used = 1 WHERE id = ? AND used = 0', o.id).changes) throw bad('This link has expired. Please request a new one.');
  await setPassword(uu, req.body.password);
  run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ?', uu.id);
  run("UPDATE uni_codes SET used = 1 WHERE uni_user_id = ? AND purpose = 'reset' AND used = 0", uu.id); // no other reset code / link stays usable
  run('UPDATE uni_users SET locked_until = NULL WHERE id = ?', uu.id);
  email.sendSecurity({ to: uu.email, subject: 'Your La Europa partner portal password was changed', text: `Your partner portal password was changed on ${U.fmtDateTime(new Date())} IST.\nIf this was not you, contact La Europa immediately.` });
  req.auditUniUserId = uu.id; C.uaudit(req, 'Password reset', 'UniversityUser', uu.id, null, null, null, uu.university_id);
  res.json({ message: 'Your password has been changed. Please log in.' });
}));

// "View as university" (read only, logged): one-time token from La Europa Admin
r.get('/preview', ah(async (req, res) => {
  const o = get(`SELECT * FROM uni_codes WHERE code_hash = ? AND purpose = 'preview' AND used = 0`, sha(String(req.query.token || '')));
  if (!o || new Date(o.expires_at) < new Date()) return res.status(400).send('This preview link has expired.');
  run('UPDATE uni_codes SET used = 1 WHERE id = ?', o.id);
  const p = C.parseJ(o.payload_json, {});
  createSession(req, res, get('SELECT * FROM uni_users WHERE id = ?', o.uni_user_id), { twofa: true, previewBy: p.by });
  res.redirect('/university/#/dashboard');
}));
r.post('/logout', (req, res) => {
  const s = sessionOf(req);
  if (s) { run('UPDATE uni_sessions SET revoked = 1 WHERE id = ?', s.id); if (!s.preview_by) { req.auditUniUserId = s.uni_user_id; const uu = get('SELECT university_id FROM uni_users WHERE id = ?', s.uni_user_id); C.uaudit(req, 'Logout', 'UniversityUser', s.uni_user_id, null, null, null, uu && uu.university_id); } }
  res.clearCookie(C.COOKIE, { path: '/' }); res.json({ ok: true });
});

// ---------- invites issued by La Europa Admin or University Admin ----------
async function issueInvite(uuId, byLabel) {
  const uu = get('SELECT * FROM uni_users WHERE id = ?', uuId);
  const today = U.istDate();
  if (uu.invite_day === today && uu.invite_count >= 5) throw bad('Maximum 5 invites per day for this user');
  const token = crypto.randomBytes(32).toString('base64url');
  const days = Math.max(1, Math.min(30, Number(getSetting('uni_invite_days') || 7)));
  run('UPDATE uni_users SET invite_token_hash = ?, invite_expires_at = ?, invite_day = ?, invite_count = ? WHERE id = ?', sha(token), new Date(Date.now() + days * 864e5).toISOString(), today,
    uu.invite_day === today ? (uu.invite_count || 0) + 1 : 1, uu.id);
  const link = `${require('./uemail').portalLink()}/#/invite/${token}`;
  require('./uemail').trigger('E38', { to: [uu.email], university_id: uu.university_id, ctx: { invite_link: link, university_user_name: uu.name }, user_name: uu.name, link: '/' });
  return { link };
}

module.exports = { router: r, authenticate, meOut, pwRule, notReused, setPassword, issueInvite, sendCode, hit, sha, totpOk, hotp, b32enc, createSession };
