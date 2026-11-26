'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';
import { GET, POST, setConsentHandler } from './api';
import { Icon } from './Icon';
import { UiHost, toast } from './ui';
import { ago, initials } from './format';
import { Gate } from './Gate';
import { local, logout, t, usePMe, type Any } from './p';
import './install';

/** The client's student portal shell (legacy/public/portal/js/main.js shell, bell, userMenu, timers, consent gate). */

const NAV: [string, string, string, string][] = [['home', '/dashboard', 'Home', 'home'], ['info', '/my-information', 'My information', 'user'], ['courses', '/courses', 'Courses', 'courses'], ['shortlist', '/shortlist', 'Shortlist', 'shortlist'],
  ['apps', '/applications', 'Applications', 'apps'], ['uni', '/university', 'From your university', 'docs'], ['docs', '/documents', 'Documents', 'docs'], ['payments', '/payments', 'Payments', 'pay'], ['tasks', '/tasks', 'Tasks', 'tasks'],
  ['meet', '/appointments', 'Meet my counsellor', 'calendar'], ['offers', '/offers', 'Offers', 'gift'], ['wallet', '/wallet', 'My wallet', 'pay'], ['chat', '/chat', 'Chat', 'chat']];
const BOTTOM: [string, string, string, string][] = [['home', '/dashboard', 'Home', 'home'], ['courses', '/courses', 'Courses', 'courses'], ['apps', '/applications', 'Applications', 'apps'], ['docs', '/documents', 'Documents', 'docs'], ['chat', '/chat', 'Chat', 'chat'], ['more', '/more', 'More', 'more']];
// which menu entry a page belongs to (the client's third column of ROUTES)
const SECTION: [RegExp, string][] = [[/^\/(dashboard)?$/, 'home'], [/^\/(wizard|my-information)/, 'info'], [/^\/(courses|compare|apply|shortlist)/, 'courses'], [/^\/applications/, 'apps'], [/^\/documents/, 'docs'],
  [/^\/chat/, 'chat'], [/^\/appointments/, 'meet'], [/^\/offers/, 'offers'], [/^\/wallet/, 'wallet'], [/^\/university/, 'uni']];
const count = (n?: number) => (n ? (n > 99 ? '99+' : String(n)) : '');

function Bell({ close, refresh }: { close: () => void; refresh: () => void }) {
  const [rows, setRows] = useState<Any[] | null>(null);
  useEffect(() => { GET('/notifications').then((d) => setRows(d.rows)).catch(() => setRows([])); }, []);
  return (
    <div className="notif-panel" onClick={(e) => e.stopPropagation()}>
      <div className="nh"><b className="grow">{t('Notifications')}</b><button className="btn xs" onClick={async () => { await POST('/notifications/read', { all: true }).catch(() => {}); refresh(); close(); }}>{t('Mark all read')}</button>
        <Link className="btn xs" href="/notifications" onClick={close}>{t('View all')}</Link></div>
      <div className="list">{!rows ? <div className="empty">{t('Loading...')}</div> : rows.length ? rows.map((n) => (
        <Link key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} href={local(n.link)} onClick={() => { POST('/notifications/read', { ids: [n.id] }).then(refresh).catch(() => {}); close(); }}>{n.title}<div className="when">{ago(n.created_at)}</div></Link>
      )) : <div className="empty">{t('No notifications yet')}</div>}</div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { me, load } = usePMe();
  const [gate, setGate] = useState(false);
  const [pop, setPop] = useState<'' | 'bell' | 'user'>('');
  const [badges, setBadges] = useState({ unread: 0, chat: 0 });
  const [photo, setPhoto] = useState<string | null>(null);
  const [idle, setIdle] = useState<number | null>(null);
  const [installAsk, setInstallAsk] = useState(false);
  const idleRef = useRef<number | null>(null), lastPing = useRef(Date.now());

  useEffect(() => {
    if (!localStorage.getItem('student_token')) { router.replace('/login'); return; }
    setConsentHandler(() => setGate(true));
    load().catch(() => {});
  }, [load, router]);
  useEffect(() => { if (me?.has_photo) GET('/me/photo').then((r) => setPhoto(r.url)).catch(() => setPhoto(null)); else setPhoto(null); }, [me?.has_photo]);
  // first login: the wizard until the profile is submitted (Portal doc 2.7)
  useEffect(() => {
    if (!me || me.profile_submitted || me.preview || me.read_only || (path !== '/' && path !== '/dashboard')) return;
    try { if (sessionStorage.getItem('lep:skipwiz')) return; sessionStorage.setItem('lep:skipwiz', '1'); } catch { /* storage blocked */ }
    router.replace('/my-information');
  }, [me, path, router]);

  const updateBadges = useCallback(async () => {
    try { const d = await GET('/notifications', { passive: true }); idleRef.current = d.idle_left_sec ?? idleRef.current; setBadges({ unread: d.unread, chat: d.unread_chat }); } catch { /* handled */ }
  }, []);
  useEffect(() => { if (me) updateBadges(); }, [me, path, updateBadges]);
  // badges every 30 s; the idle clock (logout warning 2 minutes before)
  useEffect(() => {
    if (!me) return;
    if (idleRef.current === null) idleRef.current = (me.settings?.idle_min || 60) * 60;
    const poll = setInterval(updateBadges, 30000);
    const tick = setInterval(() => {
      if (idleRef.current === null || me.preview) return;
      idleRef.current -= 5;
      if (idleRef.current <= 0) { toast(t('You were logged out because of inactivity.'), 'err'); logout(); return; }
      setIdle(idleRef.current <= 120 ? idleRef.current : null);
    }, 5000);
    const act = () => {
      if (idleRef.current !== null && idleRef.current <= 120) return;
      if (Date.now() - lastPing.current < 4 * 60000) return;
      lastPing.current = Date.now(); POST('/ping').then((r) => { idleRef.current = r.idle_min * 60; }).catch(() => {});
    };
    const evs = ['click', 'keydown', 'touchstart'];
    evs.forEach((ev) => document.addEventListener(ev, act, { passive: true }));
    return () => { clearInterval(poll); clearInterval(tick); evs.forEach((ev) => document.removeEventListener(ev, act)); };
  }, [me, updateBadges]);
  // install prompt after the second login, never on the first visit
  useEffect(() => {
    if (!me) return;
    let n = 1; try { n = Number(localStorage.getItem('lep:logins') || 0) + 1; localStorage.setItem('lep:logins', String(n)); } catch { /* storage blocked */ }
    const tm = setTimeout(async () => {
      const { canPrompt } = await import('./install');
      let asked = true; try { asked = !!localStorage.getItem('lep:installAsked'); } catch { /* storage blocked */ }
      if (!canPrompt() || n < 2 || asked) return;
      try { localStorage.setItem('lep:installAsked', '1'); } catch { /* storage blocked */ }
      setInstallAsk(true);
    }, 4000);
    return () => clearTimeout(tm);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const off = () => setPop(''); document.addEventListener('click', off); return () => document.removeEventListener('click', off); }, []);
  useEffect(() => { setPop(''); window.scrollTo(0, 0); }, [path]);

  if (!me) return <div className="le-ui portal"><div className="boot">{t('Loading...')}</div><UiHost /></div>;
  const needGate = (gate || me.needs_consent) && !me.preview;
  const sec = SECTION.find(([re]) => re.test(path))?.[1] ?? 'more';
  const on = (k: string, h: string) => (k === sec || path === h ? 'on' : '');
  const stay = async () => { try { const r = await POST('/ping'); idleRef.current = r.idle_min * 60; setIdle(null); } catch { /* handled */ } };
  return (
    <div className="le-ui portal">
      {me.preview ? <div className="preview-bar">{t('Staff preview: you are viewing the portal as this student (read only). Every preview is logged.')}</div> : null}
      {needGate ? <Gate onDone={() => setGate(false)} /> : (
        <div className="p-shell">
          <header className="p-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Link className="logo" href="/dashboard"><img className="mark" src="/brand/vernyr-icon.svg" alt="" width={34} height={34} /><span className="txt">Vernyr <b>Student</b></span></Link><span className="grow" />
            <Link className="icon-btn" href="/chat" aria-label={t('Chat')} style={{ position: 'relative' }}><Icon name="chat" /><span className={`badge-count${badges.chat ? '' : ' hide'}`}>{count(badges.chat)}</span></Link>
            <div className="usermenu"><button className="icon-btn" aria-label={t('Notifications')} onClick={(e) => { e.stopPropagation(); setPop(pop === 'bell' ? '' : 'bell'); }}><Icon name="bell" /><span className={`badge-count${badges.unread ? '' : ' hide'}`}>{count(badges.unread)}</span></button>
              {pop === 'bell' ? <Bell close={() => setPop('')} refresh={updateBadges} /> : null}</div>
            <div className="usermenu"><button aria-label={t('Profile menu')} onClick={(e) => { e.stopPropagation(); setPop(pop === 'user' ? '' : 'user'); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="avatar">{photo ? <img src={photo} alt="" /> : initials(me.name)}</span></button>
              {pop === 'user' ? <div className="menu pop" onClick={(e) => e.stopPropagation()}>
                <div style={{ padding: '8px 10px' }} className="small"><b>{me.name}</b><br /><span className="muted">{me.code}</span></div>
                <Link href="/profile">{t('My Profile')}</Link><Link href="/settings">{t('Settings')}</Link><Link href="/notifications">{t('Notifications')}</Link><button onClick={logout}>{t('Logout')}</button>
              </div> : null}</div>
          </header>
          <nav className="p-side">
            {NAV.map(([k, h, l, ic]) => <Link key={k} href={h} className={on(k, h)}><Icon name={ic} /><span>{t(l)}</span>{k === 'chat' ? <span className={`n${badges.chat ? '' : ' hide'}`}>{count(badges.chat)}</span> : null}</Link>)}
            <div className="sep" style={{ height: 1, background: 'var(--line)', margin: '10px 4px' }} />
            <Link href="/profile" className={path === '/profile' ? 'on' : ''}><Icon name="user" /><span>{t('My Profile')}</span></Link>
            <Link href="/settings" className={path === '/settings' ? 'on' : ''}><Icon name="gear" /><span>{t('Settings')}</span></Link>
            <Link href="/privacy" className={path === '/privacy' ? 'on' : ''}><Icon name="user" /><span>{t('Privacy & my data')}</span></Link>
            {me.settings.referral ? <Link href="/referral" className={path === '/referral' ? 'on' : ''}><Icon name="gift" /><span>{t('Refer a friend')}</span></Link> : null}
          </nav>
          <main className="p-main">{children}</main>
          <nav className="p-bottom">{BOTTOM.map(([k, h, l, ic]) => <Link key={k} href={h} className={on(k, h)}><Icon name={ic} /><span>{t(l)}</span>{k === 'chat' ? <span className={`dotn${badges.chat ? '' : ' hide'}`} /> : null}</Link>)}</nav>
        </div>
      )}
      {idle !== null && !needGate ? <div className="idle-banner"><span>{t('You will be logged out soon because of inactivity.')}</span><button className="btn accent sm" onClick={stay}>{t('Stay logged in')}</button></div> : null}
      {installAsk ? <div className="idle-banner"><span>{t('Add La Europa to your home screen for quick access.')}</span>
        <button className="btn accent sm" onClick={async () => { const { promptInstall } = await import('./install'); promptInstall(); setInstallAsk(false); }}>{t('Install')}</button>
        <button className="btn sm ghost" style={{ color: 'var(--white)' }} aria-label="Close" onClick={() => setInstallAsk(false)}>✕</button></div> : null}
      <UiHost />
    </div>
  );
}
