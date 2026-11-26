'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';
import { TOKEN_KEY } from '@/lib/api';
import { GET, POST, apiSrc } from './api';
import { Icon } from './Icon';
import { UiHost, toast } from './ui';
import { ago, initials } from './format';
import { isAdmin, isFinance, logout, useMe, type Any } from './u';

/** The client's partner portal shell (legacy/public/university/js/main.js): top bar with the university, search, messages, bell; sidebar; idle logout. */
type Nav = [key: string, href: string, label: string, icon: string, show: () => boolean];
const NAV: Nav[] = [
  ['dashboard', '/dashboard', 'Dashboard', 'dash', () => true], ['applications', '/applications', 'Applications', 'apps', () => true], ['pipeline', '/pipeline', 'Student pipeline', 'students', () => true],
  ['messages', '/messages', 'Messages', 'mail', () => true], ['courses', '/courses', 'Courses', 'docs', () => true], ['intakes', '/intakes', 'Intakes & scholarships', 'tasks', () => true],
  ['announcements', '/announcements', 'Announcements', 'bell', () => true], ['profile', '/profile', 'Profile', 'students', () => true], ['reports', '/reports', 'Reports', 'reports', () => true],
  ['letters', '/letters', 'Letters & bank details', 'docs', () => true], ['finance', '/finance', 'Commission & invoices', 'leads', isFinance], ['users', '/users', 'Users', 'admin', isAdmin],
];
const Count = ({ n }: { n?: number }) => (n ? <span className="badge-count">{n > 99 ? '99+' : n}</span> : null);

function Search() {
  const router = useRouter();
  const [q, setQ] = useState(''); const [rows, setRows] = useState<Any[] | null>(null);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(t.current);
    if (q.trim().length < 2) { setRows(null); return; }
    t.current = setTimeout(() => { GET(`/search?q=${encodeURIComponent(q.trim())}`).then(setRows).catch(() => setRows([])); }, 250);
  }, [q]);
  useEffect(() => { const off = () => setRows(null); document.addEventListener('click', off); return () => document.removeEventListener('click', off); }, []);
  return (
    <div className="gsearch" onClick={(e) => e.stopPropagation()}>
      <Icon name="search" />
      <input type="search" placeholder="Search application ID, student name, your reference" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows ? (
        <div className="results">
          {rows.length ? rows.map((r) => (
            <a key={r.id} href={`/applications/${r.id}`} onClick={(e) => { e.preventDefault(); setRows(null); setQ(''); router.push(`/applications/${r.id}`); }}>
              <b>{r.application_code}</b> {r.student_name}<div className="small muted">{r.course} · {r.intake} · {r.status}</div>
            </a>
          )) : <div className="empty small">No match in your applications</div>}
        </div>
      ) : null}
    </div>
  );
}

function Bell({ unread, onChange }: { unread?: number; onChange: () => void }) {
  const [open, setOpen] = useState(false); const [rows, setRows] = useState<Any[] | null>(null);
  useEffect(() => { if (open) GET('/notifications').then((d) => setRows(d.rows)).catch(() => setRows([])); }, [open]);
  useEffect(() => { const off = () => setOpen(false); document.addEventListener('click', off); return () => document.removeEventListener('click', off); }, []);
  return (
    <div className="usermenu" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" aria-label="Notifications" onClick={() => setOpen(!open)} style={{ position: 'relative' }}><Icon name="bell" /><Count n={unread} /></button>
      {open ? (
        <div className="notif-panel">
          <div className="nh"><b className="grow">Notifications</b>
            <button className="btn xs" onClick={async () => { await POST('/notifications/read', { all: true }); onChange(); setOpen(false); }}>Mark all read</button>
            <Link className="btn xs" href="/notifications" onClick={() => setOpen(false)}>View all</Link></div>
          <div className="list">
            {!rows ? <div className="empty">Loading...</div> : rows.length ? rows.slice(0, 20).map((n) => (
              <Link key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} href={n.link || '/notifications'} onClick={() => { setOpen(false); POST('/notifications/read', { ids: [n.id] }).then(onChange).catch(() => {}); }}>
                {n.title}<div className="when">{ago(n.created_at)}</div>
              </Link>
            )) : <div className="empty">No notifications</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { me, loaded, load } = useMe();
  const [navOpen, setNavOpen] = useState(false); const [menu, setMenu] = useState(false);
  const [counts, setCounts] = useState<{ unread?: number; unread_messages?: number }>({});
  const [idle, setIdle] = useState<number | null>(null);
  const lastPing = useRef(0);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) { sessionStorage.setItem('leu:after', path); router.replace('/login'); return; }
    if (!me) load();
  }, [me, load, router, path]);
  useEffect(() => { setNavOpen(false); setMenu(false); window.scrollTo(0, 0); }, [path]);
  // badges and the idle timeout (2.11)
  const badges = useCallback(async () => {
    try { const d = await GET('/me', { passive: true }); setCounts({ unread: d.unread, unread_messages: d.unread_messages }); setIdle(d.idle_left_sec ?? null); } catch { /* next poll */ }
  }, []);
  useEffect(() => {
    if (!me) return;
    setCounts({ unread: me.unread, unread_messages: me.unread_messages }); setIdle(me.idle_left_sec ?? null);
    const poll = setInterval(badges, 30000);
    const tick = setInterval(() => setIdle((s) => (s === null || me.preview ? s : s - 5)), 5000);
    const active = () => { if (Date.now() - lastPing.current < 4 * 60000) return; lastPing.current = Date.now(); POST('/ping').then(badges).catch(() => {}); };
    document.addEventListener('click', active, { passive: true }); document.addEventListener('keydown', active, { passive: true });
    return () => { clearInterval(poll); clearInterval(tick); document.removeEventListener('click', active); document.removeEventListener('keydown', active); };
  }, [me, badges]);
  useEffect(() => { if (idle !== null && idle <= 0 && !me?.preview) { toast('You were logged out because of inactivity.', 'err'); logout(); } }, [idle, me]);
  useEffect(() => { const off = () => setMenu(false); document.addEventListener('click', off); return () => document.removeEventListener('click', off); }, []);

  if (!me) return <div className="le-ui uni"><div className="boot">{loaded ? <div style={{ textAlign: 'center' }}><p>Could not load the partner portal.</p><button className="btn primary" onClick={() => load()}>Try again</button>{' '}<button className="btn" onClick={logout}>Log in again</button></div> : 'Loading...'}</div></div>;
  const u = me.university;
  const active = NAV.find(([, href]) => path === href || path.startsWith(href + '/'))?.[0] ?? (path === '/bulk' ? 'courses' : '');
  return (
    <div className="le-ui uni in-app">
      {me.preview ? <div className="preview-bar">La Europa view as university: read only. Every preview is logged.</div> : null}
      {(me.notices ?? []).map((n: Any) => <div key={n.id ?? n.title} className="notice-bar"><b>Notice from La Europa:</b> {n.title}{n.body ? ' - ' + n.body : ''}</div>)}
      <div className={`shell${navOpen ? ' nav-open' : ''}`}>
        <header className="topbar">
          <button className="icon-btn burger" aria-label="Menu" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" /></button>
          <Link className="logo uni-logo-top" href="/dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={apiSrc(u.logo)} alt="" />
            <span className="txt">{u.name}<small>Powered by La Europa Education</small></span>
          </Link>
          <Search />
          <div className="top-actions">
            <Link className="icon-btn" href="/messages" aria-label="Messages" style={{ position: 'relative' }}><Icon name="mail" /><Count n={counts.unread_messages} /></Link>
            <Bell unread={counts.unread} onChange={badges} />
            <div className="usermenu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setMenu(!menu)}><span className="avatar">{initials(me.name)}</span><span className="uname">{me.name}</span></button>
              {menu ? (
                <div className="menu pop">
                  <div style={{ padding: '8px 10px' }} className="small"><b>{me.name}</b><br /><span className="muted">{me.email}</span></div>
                  <Link href="/account">My account</Link><Link href="/notifications">Notifications</Link><button onClick={logout}>Logout</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <nav className="side">
          {NAV.filter((n) => n[4]()).map(([key, href, label, icon]) => <Link key={key} href={href} className={active === key ? 'on' : ''}><Icon name={icon} /><span>{label}</span></Link>)}
          <div className="sep" />
          <div className="small muted" style={{ padding: '4px 12px' }}>{me.role_label}{me.finance && me.role !== 'admin' ? ' + Finance' : ''}<br />La Europa Partner Portal</div>
        </nav>
        <main className="main"><Suspense fallback={<div className="empty">Loading...</div>}>{children}</Suspense></main>
      </div>
      {idle !== null && idle <= 120 && idle > 0 && !me.preview ? (
        <div className="idle-banner"><span>You will be logged out soon because of inactivity.</span>
          <button className="btn accent sm" onClick={async () => { await POST('/ping'); await badges(); }}>Stay logged in</button></div>
      ) : null}
      <UiHost />
    </div>
  );
}
