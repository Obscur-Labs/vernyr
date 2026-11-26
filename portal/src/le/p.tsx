'use client';

import { create } from 'zustand';
import { GET } from './api';
import { useAuthStore } from '@/stores/authStore';
import { apiOrigin } from '@/lib/config';

/** Student portal core (legacy/public/portal/js/p.js): the signed-in student, text, eligibility and deadline helpers. */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = Record<string, any>;
export interface PMe {
  id: string; name: string; first_name: string; code: string; account_type: 'student' | 'lead'; email: string | null; email_verified: boolean; phone: string | null; mobile_verified: boolean; status: string;
  read_only: boolean; profile_submitted: boolean; has_photo: boolean; language: string; referral_code: string | null; needs_consent: boolean; missing_consents: string[]; is_minor: boolean;
  settings: { referral: boolean; zip: boolean; idle_min: number }; preview?: boolean; completion?: number; unread_notifications?: number; unread_chat?: number; pending_deletion?: boolean;
}
interface State { me: PMe | null; load: () => Promise<PMe>; clear: () => void }
export const usePMe = create<State>((set) => ({
  me: null,
  load: async () => { const me = await GET<PMe>('/me'); set({ me }); return me; },
  clear: () => set({ me: null }),
}));
export const refreshMe = () => usePMe.getState().load();
export function logout() {
  usePMe.getState().clear();
  useAuthStore.getState().clearAuth();
  try { sessionStorage.removeItem('lep:skipwiz'); } catch { /* storage blocked */ }
  window.location.href = '/login';
}

/** every visible text goes through t(); English text is the key (no other language is published yet) */
export function t(text: string, vars?: Record<string, string | number>) {
  let s = text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  return s;
}

export const ELIG: Record<string, string> = { yes: 'Eligible', maybe: 'Maybe', no: 'Not eligible', unknown: 'Ask your counsellor', incomplete: 'Complete your profile to see eligibility' };
export const EligBadge = ({ e }: { e?: Any | null }) => (e ? <span className={`elig ${e.overall}`}>{t(ELIG[e.overall] || e.label)}</span> : null);
export const daysLeftTxt = (d?: number | null) => (d === null || d === undefined ? '' : d < 0 ? t('Deadline passed') : t('{n} days left', { n: d }));
export const dlClass = (d?: number | null) => (d === null || d === undefined ? '' : d < 0 ? 'muted' : d <= 7 ? 'days-red' : d <= 15 ? 'days-orange' : '');
const PST: Record<string, string> = { Pending: 'grey', Uploaded: 'blue', Verified: 'green', Rejected: 'red' };
export const PStatus = ({ s }: { s: string }) => <span className={`badge ${PST[s] || ''}`}>{t(s)}</span>;
export const LockedCard = ({ text }: { text?: string }) => <div className="p-card"><div className="lock-card"><div className="ic">🔒</div>{t(text || 'Available after your registration with La Europa')}</div></div>;
export const idemKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
export const local = (h?: string | null) => String(h ?? '').replace(/^#/, '') || '/notifications';

/** a link the server hands out: API files need the auth header (opened as a blob), signed file links open as they are */
export async function openLink(url?: string | null, name = 'file') {
  if (!url) return;
  if (url.startsWith('/api/portal')) { const { download } = await import('./api'); const { showError } = await import('./ui'); await download(url.replace(/^\/api\/portal/, ''), name, true).catch(showError); return; }
  window.open(url, '_blank', 'noopener');
}
/** a server path such as /api/logos/:id, made absolute against the API (the portal is served from another origin) */
export const apiSrc = (u?: string | null) => (u && u.startsWith('/api/') ? apiOrigin + u : u || '');
