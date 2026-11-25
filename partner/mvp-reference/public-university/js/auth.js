// UP01 / UP02: login (password; email code on the first login only), invite activation, forgot password by email code
import { us, uget, upost, esc, $, $$, toast, modal } from './u.js';

const art = `<div class="art"><div class="logo"><img class="mark-full" src="/brand/vernyr-logo-white.svg" alt="Vernyr" width="97" height="72"><span class="logo-sep"></span>La Europa <b>Partner Portal</b></div>
  <div><h1>Applications from La Europa, <b>in one place</b>.</h1><p>Review applications La Europa submitted to you, request documents, issue decisions and offer letters, keep your courses up to date and manage invoices.</p>
  <div class="flow"><span>Received</span><span>Review</span><span>Interview</span><span>Offer</span><span>Accepted</span><span>Deposit</span><span>Enrolled</span></div></div>
  <div class="small" style="opacity:.7">Euroverse Service LLP, trading as La Europa Education</div></div>`;
const shell = (inner) => { $('#app').innerHTML = `<div class="auth uni-auth">${art}<div class="box">${inner}</div></div>`; };
const err = (f, m) => { const b = $('.err-box', f); b.textContent = m || ''; b.classList.toggle('hide', !m); };
const pw = (id, label, auto) => `<div class="f"><label for="${id}">${label}</label><div class="pw"><input id="${id}" type="password" autocomplete="${auto}"><button type="button" data-eye="${id}">Show</button></div></div>`;
const bindEye = (root) => $$('[data-eye]', root).forEach(b => b.onclick = () => { const i = $('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Show' : 'Hide'; });
let pending = {}; // state between login and the first-login code screen
function enter(user) {
  us.me = null; toast(`Welcome, ${user.name}`, 'ok');
  const a = sessionStorage.getItem('leu:after'); sessionStorage.removeItem('leu:after');
  $('#app').innerHTML = ''; location.hash = a && !/login|twofa|setup|invite|reset/.test(a) ? a : '#/dashboard';
}

export function login() {
  shell(`<form id="lf" novalidate><h2>Partner login</h2><p class="muted" style="margin:0 0 16px">For university staff invited by La Europa Education.</p><div class="err-box hide" style="margin-bottom:12px"></div>
    <div class="f"><label for="em">Work email</label><input id="em" type="email" autocomplete="username"></div>${pw('pw1', 'Password', 'current-password')}
    <div class="row between" style="margin:6px 0 16px"><span></span><a href="#/forgot">Forgot password?</a></div>
    <button class="btn primary block" type="submit">Login</button>
    <p class="small muted" style="margin-top:14px">On your first login we email you a one-time code to confirm your email. After that you log in with your password.</p></form>`);
  const f = $('#lf'); bindEye(f); $('#em').focus();
  f.onsubmit = async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      const r = await upost('/auth/login', { email: $('#em').value.trim(), password: $('#pw1').value });
      if (r.user) return enter(r.user);
      pending = r; location.hash = '#/twofa';
    } catch (er) { err(f, er.message); } finally { btn.disabled = false; }
  };
}
// first login only: confirm the email with the emailed code
export function twofa() {
  if (!pending.code_id) { location.hash = '#/login'; return; }
  shell(`<form id="tf" novalidate><h2>Verify your email</h2><p class="muted" style="margin:0 0 16px">This is your first login, so we emailed a 6-digit code to <b>${esc(pending.masked || 'your email')}</b> (valid for 10 minutes). You need it only once; after this you log in with your password.</p>
    <div class="err-box hide" style="margin-bottom:12px"></div>
    <div class="f"><label for="code">Email code</label><input id="code" class="otp-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
    <button class="btn primary block" type="submit">Verify</button>
    <div class="row between small" style="margin-top:14px"><a href="#" data-resend>Send a new code</a><a href="#/login">Back</a></div></form>`);
  const f = $('#tf'); $('#code').focus();
  $('[data-resend]', f).onclick = async (e) => { e.preventDefault(); try { const r = await upost('/auth/2fa/email/send'); pending.code_id = r.code_id; toast('A new code has been sent', 'ok'); } catch (er) { err(f, er.message); } };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await upost('/auth/2fa/verify', { code: $('#code').value, code_id: pending.code_id }); pending = {}; enter(r.user); }
    catch (er) { err(f, er.status === 401 ? 'Your login expired. Please log in again.' : er.message); if (er.status === 401) setTimeout(() => { location.hash = '#/login'; }, 1200); }
  };
}
// old 2FA set up page: no longer used (no 2FA); kept so old links land on the login page
export function setup() { location.hash = '#/login'; }
export function showBackup(codes, next) {
  const m = modal({ title: 'Your backup codes', dismiss: false, body: `<p>Keep these 10 codes somewhere safe (for example a password manager). Each code can be used once if you lose your phone. They are shown <b>only now</b>.</p>
    <div class="backup-codes">${codes.map(c => `<code>${esc(c)}</code>`).join('')}</div>`, foot: '<button class="btn" data-copy>Copy</button><button class="btn primary" data-ok>I have saved them</button>' });
  $('[data-x]', m.el) && $('[data-x]', m.el).remove();
  $('[data-copy]', m.el).onclick = () => { navigator.clipboard && navigator.clipboard.writeText(codes.join('\n')); toast('Copied', 'ok'); };
  $('[data-ok]', m.el).onclick = () => { m.close(); next && next(); };
}
export async function invite(token) {
  const d = await uget('/auth/invite/' + encodeURIComponent(token));
  if (!d.valid) { shell(`<div><h2>Link expired</h2><p>${esc(d.message)}</p><button class="btn primary" data-new>Request new link</button></div>`); $('[data-new]').onclick = async () => { const r = await upost(`/auth/invite/${encodeURIComponent(token)}/request-new`); toast(r.message, 'ok'); }; return; }
  shell(`<form id="if" novalidate><h2>Welcome to the La Europa partner portal</h2><p class="muted" style="margin:0 0 14px"><b>${esc(d.university)}</b> · ${esc(d.email)}</p><div class="err-box hide" style="margin-bottom:12px"></div>
    <p class="small">For your security we will email a code to <b>${esc(d.email)}</b> in a separate security email.</p><button class="btn primary block" type="button" data-send>Email my code</button>
    <div data-s2 class="hide" style="margin-top:14px">
      <div class="f"><label>Verification code</label><input id="ic" class="otp-input" inputmode="numeric" maxlength="6"></div>
      <div class="f"><label>Full name</label><input id="nm" value="${esc(d.name || '')}" maxlength="100"></div>
      <div class="f"><label>Designation</label><input id="ds" value="${esc(d.designation || '')}" maxlength="100"></div>
      <div class="f"><label>Phone (with country code)</label><input id="ph" value="${esc(d.phone || '')}" maxlength="30"></div>
      ${pw('p1', 'Password (min 10 characters, a letter, a number and a symbol)', 'new-password')}${pw('p2', 'Confirm password', 'new-password')}
      <label class="consent" data-k="accept_terms"><input type="checkbox" id="acc"> <span>I accept the <a href="#" data-doc="terms">Portal Terms of Use</a> and the <a href="#" data-doc="dpa">Data Processing terms</a>.</span></label>
      <button class="btn primary block" type="submit" style="margin-top:10px">Activate my account</button></div></form>`);
  const f = $('#if'); bindEye(f); let codeId = null;
  $$('[data-doc]', f).forEach(a => a.onclick = (e) => { e.preventDefault(); const doc = a.dataset.doc === 'terms' ? d.terms : d.dpa; modal({ title: `${doc.title} (v${doc.version})`, size: 'lg', body: `<div style="white-space:pre-wrap;font-size:13.5px">${esc(doc.text)}</div>` }); });
  $('[data-send]', f).onclick = async () => { try { const r = await upost(`/auth/invite/${encodeURIComponent(token)}/start`); codeId = r.code_id; toast(`Code sent to ${r.masked}`, 'ok'); $('[data-s2]', f).classList.remove('hide'); $('[data-send]', f).textContent = 'Email the code again'; } catch (er) { err(f, er.message); } };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await upost(`/auth/invite/${encodeURIComponent(token)}/accept`, { code_id: codeId, code: $('#ic').value, name: $('#nm').value, designation: $('#ds').value, phone: $('#ph').value, password: $('#p1').value, confirm: $('#p2').value, accept_terms: $('#acc').checked });
      enter(r.user); }
    catch (er) { err(f, er.message); }
  };
}
// Forgot password: step 1 email -> 6-digit code by email; step 2 code + new password
export function forgot() {
  shell(`<form id="ff" novalidate><h2>Forgot password</h2><p class="muted" style="margin:0 0 16px">Enter your work email. We will email you a 6-digit code (valid 10 minutes).</p><div class="err-box hide" style="margin-bottom:12px"></div><div class="ok-box hide" style="margin-bottom:12px"></div>
    <div class="f"><label>Work email</label><input id="fe" type="email" autocomplete="username"></div><button class="btn primary block" type="submit" data-send>Email me a code</button>
    <div data-s2 class="hide" style="margin-top:16px"><div class="f"><label for="rc">6-digit code</label><input id="rc" class="otp-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
      <p class="small muted" style="margin:0 0 8px">New password: minimum 10 characters, with a letter, a number and a symbol. Your last 5 passwords cannot be reused.</p>
      ${pw('r1', 'New password', 'new-password')}${pw('r2', 'Confirm new password', 'new-password')}<button class="btn primary block" type="button" data-save>Save new password</button></div>
    <p style="margin-top:14px"><a href="#/login">Back to login</a></p></form>`);
  const f = $('#ff'); bindEye(f); let codeId = null;
  f.onsubmit = async (e) => { e.preventDefault(); try { const r = await upost('/auth/forgot', { email: $('#fe').value.trim() }); codeId = r.code_id; const ok = $('.ok-box', f); ok.textContent = r.message; ok.classList.remove('hide'); err(f, '');
    $('[data-s2]', f).classList.remove('hide'); const b = $('[data-send]', f); b.textContent = 'Email the code again'; b.classList.remove('primary'); $('#rc').focus(); } catch (er) { err(f, er.message); } };
  $('[data-save]', f).onclick = async () => { try { const r = await upost('/auth/reset', { code_id: codeId, code: $('#rc').value, password: $('#r1').value, confirm: $('#r2').value }); toast(r.message, 'ok'); location.hash = '#/login'; } catch (er) { err(f, er.message); } };
}
export function reset(token) {
  shell(`<form id="rf" novalidate><h2>Set a new password</h2><p class="muted" style="margin:0 0 16px">Minimum 10 characters, with a letter, a number and a symbol. Your last 5 passwords cannot be reused.</p><div class="err-box hide" style="margin-bottom:12px"></div>
    ${pw('r1', 'New password', 'new-password')}${pw('r2', 'Confirm new password', 'new-password')}<button class="btn primary block" type="submit">Save password</button></form>`);
  const f = $('#rf'); bindEye(f);
  f.onsubmit = async (e) => { e.preventDefault(); try { const r = await upost('/auth/reset', { token, password: $('#r1').value, confirm: $('#r2').value }); toast(r.message, 'ok'); location.hash = '#/login'; } catch (er) { err(f, er.message); } };
}
