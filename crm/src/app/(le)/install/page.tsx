'use client';

import { useEffect, useState } from 'react';
import { canPrompt, isAndroid, isInstalled, isIOS, onInstallChange, promptInstall } from '@/le/install';
import { toast } from '@/le/ui';

// The client's Install the app (legacy/public/js/main.js installPage, install.js)
export default function Page() {
  const [, tick] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); return onInstallChange(() => tick((n) => n + 1)); }, []);
  if (!ready) return null;
  const app = 'La Europa CRM';
  const can = canPrompt();
  const steps = isIOS() ? ['Open this page in Safari.', 'Tap the Share button (square with an arrow).', 'Tap "Add to Home Screen", then "Add".']
    : isAndroid() ? ['Tap "Install app" below, or open the Chrome menu (⋮).', 'Choose "Install app" or "Add to Home screen".', 'Open it from your home screen.']
      : ['Use Google Chrome or Microsoft Edge.', 'Click "Install app" below, or the install icon at the right end of the address bar.', 'The app opens in its own window and gets an icon on your desktop / Start menu.'];
  const install = async () => { const r = await promptInstall(); if (r === 'accepted') toast('Installed. Open it from your desktop or Start menu.', 'ok'); tick((n) => n + 1); };
  return (
    <>
      <div className="page-head"><div><h1>Install the app</h1><div className="sub">La Europa CRM on your computer or phone</div></div></div>
      <div className="card" style={{ maxWidth: 720 }}><div className="bd">
        {isInstalled() ? <div className="ok-box">The app is installed on this device. Open it from your desktop, Start menu or home screen.</div> : <>
          <p>Install <b>{app}</b> as an app on this computer or phone. You keep the same login and data; updates arrive by themselves.</p>
          <ol className="install-steps">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <button className="btn primary" disabled={!can} onClick={install}>Install app</button>
          {can ? null : <p className="small muted" style={{ marginTop: 8 }}>{isIOS() ? 'On iPhone / iPad use Safari: Share > Add to Home Screen.' : 'If the button stays grey, use the install icon in the address bar or the browser menu (Install / Add to Home screen).'}</p>}
        </>}
      </div></div>
    </>
  );
}
