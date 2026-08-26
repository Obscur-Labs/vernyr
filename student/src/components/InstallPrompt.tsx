'use client';

import { useEffect, useState } from 'react';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED = 'vernyr_portal_install_dismissed';

/**
 * Registers the service worker, and offers the install banner where the browser
 * supports one. iOS fires no such event, so Safari gets the Share-sheet steps.
 */
export function InstallPrompt({ appName }: { appName: string }) {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED) === '1') return;

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream;
    if (isIos && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua)) setIosHint(true);

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED, '1');
    setDeferred(null);
    setIosHint(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  };

  if (!deferred && !iosHint) return null;

  return (
    <div className="animate-slide-in-right fixed bottom-4 left-4 right-4 z-[70] mx-auto max-w-sm rounded-2xl border border-line bg-surface p-4 shadow-2xl sm:left-auto">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
            <path d="M10 2a1 1 0 011 1v7.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L9 10.586V3a1 1 0 011-1z" />
            <path d="M3 14a1 1 0 011 1v1h12v-1a1 1 0 112 0v1a2 2 0 01-2 2H4a2 2 0 01-2-2v-1a1 1 0 011-1z" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-t1">Install {appName}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-t2">
            {iosHint
              ? 'Tap Share, then “Add to Home Screen”.'
              : 'Keep it on your home screen and open it like an app.'}
          </p>

          <div className="mt-3 flex gap-2">
            {deferred && (
              <button onClick={install} className="rounded-full bg-accent px-3.5 py-2 text-[13px] font-semibold text-white">
                Install
              </button>
            )}
            <button onClick={dismiss} className="rounded-full bg-muted px-3.5 py-2 text-[13px] font-semibold text-t2">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
