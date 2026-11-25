// La Europa partner portal (University doc 16): router, shell, notifications, idle timeout.
import { us, uget, upost, esc, $, $$, toast, icon, initials, ago, debounce, isAdmin, isFinance } from './u.js';
import * as Auth from './auth.js';
import * as Apps from './apps.js';
import * as Cat from './catalog.js';
import * as More from './more.js';

const PUBLIC = [[/^login$/, () => Auth.login()], [/^twofa$/, () => Auth.twofa()], [/^setup$/, () => Auth.setup()], [/^invite\/(.+)$/, (m) => Auth.invite(m[1])], [/^forgot$/, () => Auth.forgot()], [/^reset\/(.+)$/, (m) => Auth.reset(m[1])]];
const ROUTES = [
  [/^$|^dashboard$/, (m, q) => Apps.dashboard(q), 'dashboard'], [/^applications$/, (m, q) => Apps.inbox(q), 'applications'], [/^applications\/([0-9a-f-]{36})$/, (m, q) => Apps.detail(m[1], q), 'applications'],
  [/^letters$/, () => import('./letters.js').then(L => L.page()), 'letters'], [/^pipeline$/, (m, q) => import('./direct.js').then(D => D.pipeline(q)), 'pipeline'], [/^messages$/, (m, q) => Apps.messages(q), 'messages'], [/^courses$/, (m, q) => Cat.courses(q), 'courses'], [/^courses\/new$/, () => Cat.courseForm(null), 'courses'], [/^courses\/([0-9a-f-]{36})$/, (m) => Cat.courseForm(m[1]), 'courses'],
  [/^bulk$/, () => Cat.bulk(), 'courses'], [/^intakes$/, (m, q) => Cat.intakes(q), 'intakes'], [/^announcements$/, () => Cat.announcements(), 'announcements'], [/^profile$/, () => Cat.profile(), 'profile'],
  [/^reports$/, (m, q) => More.reports(q), 'reports'], [/^finance$/, () => More.finance(), 'finance'], [/^users$/, () => More.users(), 'users'], [/^account$/, () => More.account(), ''], [/^notifications$/, () => More.notifications(), '']
];
const parse = () => { const h = location.hash.replace(/^#\/?/, ''); const [p, q] = h.split('?'); return { path: p.replace(/\/$/, ''), q: Object.fromEntries(new URLSearchParams(q || '')) }; };

async function boot() {
  try { us.me = await uget('/me'); } catch { us.me = null; }
  window.addEventListener('hashchange', route);
  window.addEventListener('leu:reload', route);
  route();
}
export async function refreshMe() { us.me = await uget('/me'); badges(); return us.me; }
export function go(h) { if (location.hash === h) route(); else location.hash = h; }

async function route() {
  const { path, q } = parse();
  const pub = PUBLIC.find(([re]) => re.test(path));
  if (pub) { stopTimers(); document.body.classList.remove('in-app'); return pub[1](path.match(pub[0]), q); }
  if (!us.me) { try { us.me = await uget('/me'); } catch { return; } }
  const r0 = ROUTES.find(([re]) => re.test(path)) || ROUTES[0];
  if (!$('.shell')) shell();
  $$('.side a').forEach(a => a.classList.toggle('on', a.dataset.nav === r0[2]));
  $('.shell').classList.remove('nav-open');
  $$('.menu.pop, .notif-panel, .gsearch .results').forEach(x => x.classList ? (x.classList.contains('results') ? x.classList.add('hide') : x.remove()) : null);
  const main = $('.main'); main.innerHTML = '<div class="empty">Loading...</div>'; window.scrollTo(0, 0);
  try { await r0[1](path.match(r0[0]), q); }
  catch (e) {
    if (e.status === 401) return;
    main.innerHTML = `<div class="card"><div class="bd"><h2>${e.status === 404 ? 'Not found' : e.status === 403 ? 'Not allowed' : 'Something went wrong'}</h2><p class="muted">${esc(e.status === 404 ? 'This page does not exist or is not available.' : e.message)}</p><a class="btn" href="#/dashboard">Back to dashboard</a></div></div>`;
  }
  badges();
}

function shell() {
  const me = us.me; const u = me.university;
  const nav = [['dashboard', '#/dashboard', 'Dashboard', 'dash', true], ['applications', '#/applications', 'Applications', 'apps', true], ['pipeline', '#/pipeline', 'Student pipeline', 'students', true], ['messages', '#/messages', 'Messages', 'mail', true],
    ['courses', '#/courses', 'Courses', 'docs', true], ['intakes', '#/intakes', 'Intakes & scholarships', 'tasks', true], ['announcements', '#/announcements', 'Announcements', 'bell', true],
    ['profile', '#/profile', 'Profile', 'students', true], ['reports', '#/reports', 'Reports', 'reports', true], ['letters', '#/letters', 'Letters & bank details', 'docs', true], ['finance', '#/finance', 'Commission & invoices', 'leads', isFinance()], ['users', '#/users', 'Users', 'admin', isAdmin()]];
  document.body.classList.add('in-app');
  $('#app').innerHTML = `${me.preview ? '<div class="preview-bar">La Europa view as university: read only. Every preview is logged.</div>' : ''}
    ${(me.notices || []).map(n => `<div class="notice-bar"><b>Notice from La Europa:</b> ${esc(n.title)}${n.body ? ' - ' + esc(n.body) : ''}</div>`).join('')}
    <div class="shell"><header class="topbar">
      <button class="icon-btn burger" data-burger aria-label="Menu">${icon('menu')}</button>
      <a class="logo uni-logo-top" href="#/dashboard"><img src="${esc(u.logo || '')}" alt=""><span class="txt">${esc(u.name)}<small>Powered by La Europa Education</small></span></a>
      <div class="gsearch">${icon('search')}<input id="gs" type="search" placeholder="Search application ID, student name, your reference" autocomplete="off"><div class="results hide"></div></div>
      <div class="top-actions">
        <a class="icon-btn" href="#/messages" aria-label="Messages" style="position:relative">${icon('mail')}<span class="badge-count hide" data-msgs></span></a>
        <div class="usermenu"><button class="icon-btn" data-bell aria-label="Notifications">${icon('bell')}<span class="badge-count hide" data-unread></span></button></div>
        <div class="usermenu"><button data-user><span class="avatar">${esc(initials(me.name))}</span><span class="uname">${esc(me.name)}</span></button></div>
      </div></header>
      <nav class="side">${nav.filter(n => n[4]).map(n => `<a href="${n[1]}" data-nav="${n[0]}">${icon(n[3])}<span>${n[2]}</span></a>`).join('')}
        <div class="sep"></div><div class="small muted" style="padding:4px 12px">${esc(me.role_label)}${me.finance && me.role !== 'admin' ? ' + Finance' : ''}<br>La Europa Partner Portal</div></nav>
      <main class="main"></main></div>`;
  $('[data-burger]').onclick = () => $('.shell').classList.toggle('nav-open');
  $('[data-user]').onclick = (e) => { e.stopPropagation(); userMenu(e.currentTarget.parentElement); };
  $('[data-bell]').onclick = (e) => { e.stopPropagation(); bell(e.currentTarget.parentElement); };
  const gs = $('#gs'); const box = $('.gsearch .results');
  gs.oninput = debounce(async () => { const v = gs.value.trim(); if (v.length < 2) { box.classList.add('hide'); return; }
    const rows = await uget('/search?q=' + encodeURIComponent(v)); box.innerHTML = rows.length ? rows.map(r => `<a href="#/applications/${r.id}"><b>${esc(r.application_code)}</b> ${esc(r.student_name)}<div class="small muted">${esc(r.course)} · ${esc(r.intake)} · ${esc(r.status)}</div></a>`).join('') : '<div class="empty small">No match in your applications</div>';
    box.classList.remove('hide'); }, 250);
  startTimers();
}
document.addEventListener('click', (e) => { if (!e.target.closest('.menu.pop, .notif-panel, .gsearch')) { $$('.menu.pop, .notif-panel').forEach(x => x.remove()); const r = $('.gsearch .results'); r && r.classList.add('hide'); } });
function userMenu(host) {
  if ($('.menu.pop', host)) return $$('.menu.pop').forEach(x => x.remove());
  const m = document.createElement('div'); m.className = 'menu pop';
  m.innerHTML = `<div style="padding:8px 10px" class="small"><b>${esc(us.me.name)}</b><br><span class="muted">${esc(us.me.email)}</span></div><a href="#/account">My account</a><a href="#/notifications">Notifications</a><button data-lo>Logout</button>`;
  host.appendChild(m); $('[data-lo]', m).onclick = logout;
}
export async function logout() { try { await upost('/auth/logout'); } catch { /* */ } us.me = null; stopTimers(); location.hash = '#/login'; }
function bell(host) {
  if ($('.notif-panel', host)) return $$('.notif-panel').forEach(x => x.remove());
  const p = document.createElement('div'); p.className = 'notif-panel';
  p.innerHTML = '<div class="nh"><b class="grow">Notifications</b><button class="btn xs" data-ra>Mark all read</button><a class="btn xs" href="#/notifications">View all</a></div><div class="list"><div class="empty">Loading...</div></div>';
  host.appendChild(p);
  uget('/notifications').then(d => { $('.list', p).innerHTML = d.rows.length ? d.rows.slice(0, 20).map(n => `<a class="notif ${n.is_read ? '' : 'unread'}" href="${esc(n.link || '#/notifications')}" data-id="${n.id}">${esc(n.title)}<div class="when">${esc(ago(n.created_at))}</div></a>`).join('') : '<div class="empty">No notifications</div>';
    $$('.notif', p).forEach(a => a.onclick = () => upost('/notifications/read', { ids: [a.dataset.id] }).then(badges)); });
  $('[data-ra]', p).onclick = async () => { await upost('/notifications/read', { all: true }); badges(); p.remove(); };
}
// ---------- badges + idle timeout (2.11) ----------
let pollT = null, tickT = null, idleLeft = null, lastPing = Date.now();
async function badges() {
  try { const d = await uget('/me', { passive: true }); idleLeft = d.idle_left_sec;
    const set = (sel, n) => $$(sel).forEach(b => { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hide', !n); }); set('[data-unread]', d.unread); set('[data-msgs]', d.unread_messages); } catch { /* */ }
}
function startTimers() {
  stopTimers(); pollT = setInterval(badges, 30000);
  tickT = setInterval(() => {
    if (idleLeft === null || (us.me && us.me.preview)) return; idleLeft -= 5;
    const b = $('.idle-banner');
    if (idleLeft <= 0) { stopTimers(); us.me = null; toast('You were logged out because of inactivity.', 'err'); location.hash = '#/login'; return; }
    if (idleLeft <= 120 && !b) { const x = document.createElement('div'); x.className = 'idle-banner'; x.innerHTML = '<span>You will be logged out soon because of inactivity.</span><button class="btn accent sm">Stay logged in</button>';
      document.body.appendChild(x); $('button', x).onclick = async () => { await upost('/ping'); await badges(); x.remove(); }; }
    else if (b && idleLeft > 120) b.remove();
  }, 5000);
}
function stopTimers() { clearInterval(pollT); clearInterval(tickT); const b = $('.idle-banner'); b && b.remove(); }
['click', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (!us.me || $('.idle-banner') || Date.now() - lastPing < 4 * 60000) return; lastPing = Date.now(); upost('/ping').then(badges).catch(() => {}); }, { passive: true }));
export { route };
boot();
