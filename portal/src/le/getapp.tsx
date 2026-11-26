'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { canPrompt, isInstalled, onInstallChange, promptInstall } from './install';
import { toast } from './ui';
import { t } from './p';

/** The client's "Get the Vernyr app" (legacy/public/portal/js/getapp.js): the portal installed from the browser; no app store. */

const ua = () => navigator.userAgent || '';
const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(ua());
const inApp = () => /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|; wv\)/i.test(ua());
const iosNotSafari = () => isIOS() && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua());
const SHARE = <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>;
const PLUS = <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>;
const DOTS = <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>;

export function GetApp() {
  const [, tick] = useState(0), [ready, setReady] = useState(false);
  useEffect(() => { document.title = t('Get the Vernyr app'); setReady(true); return onInstallChange(() => tick((n) => n + 1)); }, []);
  if (!ready) return null;
  const installed = isInstalled(), ios = isIOS(), android = isAndroid();
  const steps: [React.ReactNode, string, string][] = ios
    ? [[SHARE, t('Tap the Share button'), t('At the bottom of Safari (on iPad: at the top).')], [PLUS, t('Tap "Add to Home Screen"'), t('Scroll down the list if you do not see it.')], ['✓', t('Tap "Add"'), t('Vernyr appears on your home screen.')]]
    : android ? [['⬇', t('Tap "Install app" below'), t('Then tap "Install" in the pop-up.')], [DOTS, t('No button?'), t('Open the Chrome menu (⋮) and choose "Install app" or "Add to Home screen".')], ['✓', t('Open Vernyr'), t('From your home screen, like any app.')]]
      : [['⬇', t('Click "Install app" below'), t('Works in Google Chrome and Microsoft Edge.')], ['⊕', t('Or use the address bar'), t('Click the install icon at the right end of the address bar.')], ['✓', t('Open Vernyr'), t('From your desktop or Start menu, in its own window.')]];
  const warn = inApp() ? t('You opened this inside another app (Instagram, WhatsApp...). Tap the menu and choose "Open in Chrome" or "Open in Safari", then install.')
    : iosNotSafari() ? t('On iPhone, apps can be added only from Safari. Copy this link and open it in Safari.') : '';
  const install = async () => {
    if (!canPrompt()) { toast(android ? t('Open the Chrome menu (⋮) and choose "Install app".') : t('Use the install icon in the address bar.')); return; }
    if ((await promptInstall()) === 'accepted') toast(t('Installed. Open Vernyr from your home screen.'), 'ok');
    tick((n) => n + 1);
  };
  return (
    <div className="getapp">
      <div className="ga-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ga-icon" src="/icon-512.png" alt="" width={104} height={104} />
        <h1>Vernyr</h1><p className="ga-sub">{t('Your study abroad file, in your pocket')}</p>
        <div className="ga-meta"><span>{t('Free')}</span><span>{t('No app store needed')}</span><span>{t('Under 1 MB')}</span></div>
        {installed ? <><div className="ok-box">{t('The app is already installed on this device.')}</div><Link className="btn primary block" href="/login">{t('Open the app')}</Link></>
          : <>{warn ? <div className="ga-warn">{warn}</div> : null}{ios ? null : <button className="btn primary block ga-btn" onClick={install}>{t('Install app')}</button>}</>}
      </div>
      {installed ? null : <div className="ga-card"><h2>{ios ? t('Add to your iPhone in 3 taps') : t('Install in 3 steps')}</h2>
        <ol className="ga-steps">{steps.map(([ic, h, s], i) => <li key={i}><span className="ga-ic">{ic}</span><div><b>{h}</b><small>{s}</small></div></li>)}</ol>
        {ios ? <div className="ga-arrow" aria-hidden="true">{SHARE}<span>{t('The Share button is down here')}</span></div> : null}</div>}
      <div className="ga-card"><h2>{t('What you can do in the app')}</h2>
        <ul className="ga-feat"><li>💬 <span>{t('Chat with your counsellor')}</span></li><li>📄 <span>{t('Upload and track documents')}</span></li><li>🎓 <span>{t('Follow every application')}</span></li>
          <li>🧾 <span>{t('Invoices, payments and receipts')}</span></li><li>🛂 <span>{t('Visa checklist and appointments')}</span></li><li>🔔 <span>{t('Notifications for every update')}</span></li></ul></div>
      <p className="ga-foot"><Link href="/login">{t('Continue in the browser')}</Link> · {t('Same login, same data. Updates arrive by themselves.')}</p>
    </div>
  );
}

/** small banner on phones that are not using the app yet (once a week at most) */
export function AppNudge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isInstalled() || inApp() || (!isIOS() && !isAndroid())) return;
    let last = 0; try { last = Number(localStorage.getItem('lep:appNudge') || 0); } catch { /* storage blocked */ }
    if (Date.now() - last < 7 * 864e5) return;
    const tm = setTimeout(() => { try { localStorage.setItem('lep:appNudge', String(Date.now())); } catch { /* storage blocked */ } setShow(true); }, 3500);
    return () => clearTimeout(tm);
  }, []);
  if (!show) return null;
  return (
    <div className="app-nudge">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-maskable-192.png" alt="" width={40} height={40} /><div className="grow"><b>Vernyr app</b><small>{isIOS() ? t('Add to Home Screen from Safari') : t('Install, free, no app store')}</small></div>
      <Link className="btn primary sm" href="/get-app" onClick={() => setShow(false)}>{t('Get')}</Link><button className="x" aria-label={t('Close')} onClick={() => setShow(false)}>✕</button>
    </div>
  );
}
