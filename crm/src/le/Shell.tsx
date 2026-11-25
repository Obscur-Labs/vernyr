'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';
import { useAuthStore } from '@/stores/authStore';
import { Icon } from './Icon';
import { M, useMeta } from './meta';
import { UiHost } from './ui';
import { initials } from './format';

/** The client's CRM shell (legacy/public/js/main.js renderShell): white glass top bar, ink sidebar, grouped menu. */

type NavItem = { key: string; href: string; label: string; icon: string; show: () => boolean };
// Only screens already ported to the client's design are listed; the rest join as they land (PORTING.md).
const NAV: NavItem[] = [
  { key: 'leads', href: '/leads', label: 'Leads', icon: 'leads', show: () => M.can('leads') },
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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('crm_token')) { router.replace('/login'); return; }
    if (!meta) load().catch(() => setFailed(true));
  }, [meta, load, router]);
  useEffect(() => { setNavOpen(false); setMenuOpen(false); }, [path]);
  useEffect(() => {
    const onScroll = () => document.querySelector('.le-ui')?.classList.toggle('scrolled', window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const logout = () => { clearAuth(); clear(); router.push('/login'); };

  if (!me || !meta) {
    return <div className="le-ui"><div className="boot">{failed ? 'Could not load the CRM. Please refresh the page.' : 'Loading La Europa CRM...'}</div></div>;
  }
  const active = NAV.find((n) => path === n.href || path.startsWith(n.href + '/'))?.key;

  return (
    <div className="le-ui in-app">
      <div className={`shell${navOpen ? ' nav-open' : ''}`}>
        <header className="topbar">
          <button className="icon-btn burger" aria-label="Menu" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" /></button>
          <Link className="logo" href="/leads">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark" src="/brand/vernyr-icon.svg" alt="" width={34} height={34} />
            <span className="txt">La Europa <b>CRM</b></span>
          </Link>
          <div className="top-actions">
            {M.can('leads', 'add') ? <Link className="btn accent" href="/leads?new=1"><Icon name="plus" /><span>Add Lead</span></Link> : null}
            <div className="usermenu">
              <button onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>
                <span className="avatar">{initials(me.name)}</span><span className="uname">{me.name}</span>
              </button>
              {menuOpen ? (
                <div className="menu pop" onMouseLeave={() => setMenuOpen(false)}>
                  <div style={{ padding: '8px 10px' }} className="small"><b>{me.name}</b><br /><span className="muted">{me.username ?? me.email ?? ''}</span></div>
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
          <div className="sep" />
          <div className="small muted" style={{ padding: '4px 12px' }}>{me.role_name}<br />Times shown in IST</div>
        </nav>
        <main className="main">{children}</main>
      </div>
      <UiHost />
    </div>
  );
}
