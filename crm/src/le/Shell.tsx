'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';
import { useAuthStore } from '@/stores/authStore';
import { Icon } from './Icon';
import { M, useMeta, type Me } from './meta';
import { UiHost } from './ui';
import './install';
import { initials } from './format';
import { Bell, GlobalSearch } from './TopBar';

/** The client's CRM shell (legacy/public/js/main.js renderShell): white glass top bar, ink sidebar, grouped menu. */

type NavItem = { key: string; href: string; label: string; icon: string; show: () => boolean };
// Only screens already ported to the client's design are listed; the rest join as they land (PORTING.md).
const NAV: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard', icon: 'dash', show: () => true },
  { key: 'leads', href: '/leads', label: 'Leads', icon: 'leads', show: () => M.can('leads') },
  { key: 'tasks', href: '/tasks', label: 'Tasks', icon: 'tasks', show: () => true },
  { key: 'students', href: '/students', label: 'Students', icon: 'students', show: () => true },
  { key: 'applications', href: '/applications', label: 'Applications & Visa', icon: 'apps', show: () => M.can('applications') },
  { key: 'documents', href: '/documents', label: 'Documents to verify', icon: 'docs', show: () => M.can('documents') },
  { key: 'requests', href: '/requests', label: 'Student Requests', icon: 'apps', show: () => M.can('applications') },
  { key: 'chat', href: '/chat', label: 'Student chat', icon: 'mail', show: () => true },
  { key: 'appointments', href: '/appointments', label: 'Appointments', icon: 'calendar', show: () => true },
  { key: 'walkin', href: '/walkin-qr', label: 'Walk-in QR', icon: 'plus', show: () => true },
  { key: 'counsellors', href: '/counsellors', label: 'Counsellors', icon: 'leads', show: () => M.admin() || M.manager() },
  { key: 'promotions', href: '/promotions', label: 'Promotions & wallet', icon: 'gift', show: () => M.admin() },
  { key: 'courses', href: '/courses', label: 'Course search', icon: 'search', show: () => true },
  { key: 'catalogue', href: '/catalogue', label: 'Add / upload courses', icon: 'reports', show: () => M.admin() },
  { key: 'console', href: '/console', label: 'Admin console', icon: 'admin', show: () => { const me = useMeta.getState().me as (Me & { signing_authority?: boolean }) | null; return (me?.console ?? []).length > 0 || M.admin() || !!me?.signing_authority; } },
  { key: 'reports', href: '/admin/reports', label: 'Reports', icon: 'reports', show: () => M.admin() || M.manager() },
  { key: 'admin', href: '/admin/users', label: 'Admin Settings', icon: 'admin', show: () => M.admin() },
];
// the counsellor's day first: my work, then students, then universities
const GROUPS: [string, string[]][] = [
  ['My work', ['dashboard', 'tasks', 'appointments', 'chat', 'requests', 'documents', 'walkin']],
  ['Students', ['leads', 'students', 'counsellors', 'applications', 'courses', 'promotions']],
  ['Universities', ['uniupdates', 'unimsgs', 'catalogue']],
  ['More', ['console']],
];

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { me, meta, load, clear } = useMeta();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem('crm_token')) { router.replace('/login'); return; }
    // the free API host sleeps when idle: the first call after a while can take up to a minute, so retry twice
    if (!meta) {
      setFailed('');
      load().catch((e) => {
        if (attempt < 2) setTimeout(() => setAttempt((n) => n + 1), 4000);
        else setFailed((e as Error).message || 'Network error');
      });
    }
  }, [meta, load, router, attempt]);
  useEffect(() => { setNavOpen(false); setMenuOpen(false); }, [path]);
  useEffect(() => {
    const onScroll = () => document.querySelector('.le-ui')?.classList.toggle('scrolled', window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const logout = () => { clearAuth(); clear(); router.push('/login'); };

  if (!me || !meta) {
    return (
      <div className="le-ui"><div className="boot">
        {failed ? (
          <div style={{ textAlign: 'center' }}>
            <p>Could not load the CRM: {failed}</p>
            <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>{' '}
            <button className="btn" onClick={logout}>Log in again</button>
          </div>
        ) : 'Loading La Europa CRM...'}
      </div></div>
    );
  }
  const active = path.startsWith('/admin/reports') ? 'reports' : path.startsWith('/admin/catalogue') || path === '/catalogue' ? 'catalogue' : path.startsWith('/admin') ? 'admin' : NAV.find((n) => path === n.href || path.startsWith(n.href + '/'))?.key;

  return (
    <div className="le-ui in-app">
      <div className={`shell${navOpen ? ' nav-open' : ''}`}>
        <header className="topbar">
          <button className="icon-btn burger" aria-label="Menu" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" /></button>
          <Link className="logo" href="/dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark" src="/brand/vernyr-icon.svg" alt="" width={34} height={34} />
            <span className="txt">La Europa <b>CRM</b></span>
          </Link>
          <GlobalSearch />
          <div className="top-actions">
            {M.can('leads', 'add') ? <Link className="btn accent" href="/leads?new=1"><Icon name="plus" /><span>Add Lead</span></Link> : null}
            <Bell />
            <div className="usermenu">
              <button onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>
                <span className="avatar">{(me as { photo_url?: string }).photo_url ? <img src={(me as { photo_url?: string }).photo_url} alt="" /> : initials(me.name)}</span><span className="uname">{me.name}</span>
              </button>
              {menuOpen ? (
                <div className="menu pop" onMouseLeave={() => setMenuOpen(false)}>
                  <div style={{ padding: '8px 10px' }} className="small"><b>{me.name}</b><br /><span className="muted">{me.username ?? me.email ?? ''}</span></div>
                  <Link href="/profile">My Profile</Link>
                  <Link href="/profile?pw=1">Change password</Link>
                  <Link href="/notifications">All notifications</Link>
                  <Link href="/install" className="install-link">Install app</Link>
                  <button onClick={logout}>Logout</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <nav className="side">
          {GROUPS.map(([g, keys]) => {
            const items = keys.map((k) => NAV.find((n) => n.key === k)).filter((n): n is NavItem => !!n && n.show());
            return items.length ? (
              <div key={g}>
                <div className="side-group">{g}</div>
                {items.map((n) => <Link key={n.key} href={n.href} className={active === n.key ? 'on' : ''}><Icon name={n.icon} /><span>{n.label}</span></Link>)}
              </div>
            ) : null;
          })}
          {M.admin() || M.manager() ? <><div className="sep" />{NAV.filter((n) => ['reports', 'admin'].includes(n.key) && n.show()).map((n) => <Link key={n.key} href={n.href} className={active === n.key ? 'on' : ''}><Icon name={n.icon} /><span>{n.label}</span></Link>)}</> : null}
          <div className="sep" />
          <div className="small muted" style={{ padding: '4px 12px' }}>{me.role_name}<br />Times shown in IST</div>
        </nav>
        <main className="main">{children}</main>
      </div>
      <UiHost />
    </div>
  );
}
