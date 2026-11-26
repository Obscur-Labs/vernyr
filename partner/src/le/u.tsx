'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { create } from 'zustand';
import { GET, POST } from './api';
import { TOKEN_KEY } from '@/lib/api';

/** The client's partner portal state and helpers (legacy/public/university/js/u.js). */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = Record<string, any>;
export interface UMe {
  id: string; name: string; email: string; role: 'admin' | 'officer' | 'viewer'; role_label: string; finance: boolean; designation?: string | null; phone?: string | null;
  alerts?: string[] | null; campuses: string[]; main_contact: boolean; preview?: boolean; notices?: Any[]; unread?: number; unread_messages?: number; idle_left_sec?: number; idle_min?: number;
  university: { id: string; name: string; short_name?: string | null; logo: string; status: string; officers_propose: boolean; viewer_docs: boolean; zip: boolean; viewer_exports: boolean; show_expected: boolean };
}
interface State { me: UMe | null; loaded: boolean; load: () => Promise<UMe | null> }
export const useMe = create<State>((set) => ({
  me: null, loaded: false,
  load: async () => {
    try { const me = await GET<UMe>('/me'); set({ me, loaded: true }); return me; } catch { set({ me: null, loaded: true }); return null; }
  },
}));
export const us = () => useMe.getState().me;
export const refreshMe = () => useMe.getState().load();
export const signIn = (token: string) => { localStorage.setItem(TOKEN_KEY, token); useMe.setState({ me: null, loaded: false }); };
export async function logout() {
  try { await POST('/auth/logout'); } catch { /* signing out anyway */ }
  localStorage.removeItem(TOKEN_KEY); useMe.setState({ me: null, loaded: true });
  window.location.href = '/login';
}
export const isAdmin = () => us()?.role === 'admin';
export const canAct = () => !!us() && us()!.role !== 'viewer' && !us()!.preview;
export const isFinance = () => !!us()?.finance;
const SC: Record<string, string> = { New: 'blue', Acknowledged: 'purple', 'Documents requested': 'orange', 'Under assessment': 'purple', 'Interview scheduled': 'purple', Waitlisted: 'grey', 'Conditional offer': 'orange',
  'Unconditional offer': 'green', Rejected: 'red', 'Offer accepted': 'green', 'Deposit received': 'green', Enrolled: 'green', Withdrawn: 'grey' };
export const UStatus = ({ s }: { s: string }) => <span className={`badge ${SC[s] || 'grey'}`}>{s}</span>;
export const PAGE_SIZES = [25, 50, 100];

/** the page's query string, and navigation with a new one (the client's hash router, on Next routes) */
export function useQ(): Record<string, string> {
  const sp = useSearchParams();
  return Object.fromEntries(sp.entries());
}
export function useGo() {
  const router = useRouter();
  return (href: string) => router.push(href);
}
/** load data for a screen; `reload()` fetches again (after an action) */
export function useLoad<T = Any>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; setError(null);
    fn().then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError({ status: e?.status ?? 0, message: e?.message ?? 'Something went wrong' }); });
    return () => { live = false; };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: () => setN((x) => x + 1), setData };
}
export function Page({ state, children }: { state: { data: unknown; error: { status: number; message: string } | null }; children: () => React.ReactNode }) {
  if (state.error) {
    if (state.error.status === 401) return null;
    return <div className="card"><div className="bd"><h2>{state.error.status === 404 ? 'Not found' : state.error.status === 403 ? 'Not allowed' : 'Something went wrong'}</h2>
      <p className="muted">{state.error.status === 404 ? 'This page does not exist or is not available.' : state.error.message}</p><a className="btn" href="/dashboard">Back to dashboard</a></div></div>;
  }
  if (!state.data) return <div className="empty">Loading...</div>;
  return <>{children()}</>;
}
