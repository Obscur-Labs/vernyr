'use client';

/** "Install app" (legacy/public/js/install.js). Imported by the Shell so the browser's install event is caught on first load. */

type Deferred = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };
let deferred: Deferred | null = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as Deferred; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach((f) => f()); });
}
export const onInstallChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const canPrompt = () => !!deferred;
export const isInstalled = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
export async function promptInstall() { if (!deferred) return null; deferred.prompt(); const r = await deferred.userChoice; deferred = null; return r.outcome; }
export const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
