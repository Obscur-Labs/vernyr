import { create } from 'zustand';
import { GET } from './api';

/** `state.me` / `state.meta` and the `M` helpers of the client's CRM (legacy/public/js/core.js). */

export interface Me { id: string; name: string; username: string | null; email: string | null; role: 'admin' | 'counsellor' | 'manager'; role_name: string; has_photo: boolean; console: string[] }
export interface Opt { id: string; name: string; active?: boolean; [k: string]: unknown }
export interface Stage { code: string; name: string; color?: string; sort: number }
export interface Meta {
  masters: Record<string, Opt[]>; countries: Opt[]; intakes: Opt[]; universities: Opt[]; courses: Opt[];
  users: (Opt & { status: string; role: string; email: string | null })[];
  app_stages: Stage[]; visa_stages: Stage[]; perms: Record<string, string[]>;
  settings: { session_timeout_min: number; max_file_mb: number; hard_cc: string };
}

interface State { me: Me | null; meta: Meta | null; load: () => Promise<void>; clear: () => void }
export const useMeta = create<State>((set) => ({
  me: null, meta: null,
  load: async () => { const meta = await GET<Meta & { user: Me }>('/meta'); set({ me: meta.user, meta }); },
  clear: () => set({ me: null, meta: null }),
}));

const S = () => useMeta.getState();
const meta = () => S().meta!;
export const M = {
  list: (type: string, all = false) => (meta().masters[type] || []).filter((x) => all || x.active),
  name: (id?: string | null) => {
    if (!id) return '';
    const m = meta();
    for (const arr of [m.countries, m.intakes, m.universities, m.courses, ...Object.values(m.masters)]) { const x = arr.find((i) => i.id === id); if (x) return x.name; }
    return '';
  },
  countries: (all = false) => meta().countries.filter((c) => all || c.active),
  intakes: (all = false) => meta().intakes.filter((c) => all || c.active),
  users: (role?: string | string[]) => meta().users.filter((u) => u.status === 'active' && (!role || (Array.isArray(role) ? role.includes(u.role) : u.role === role))),
  user: (id?: string | null) => meta().users.find((u) => u.id === id),
  stage: (code: string) => meta().app_stages.find((s) => s.code === code) || { code, name: code, color: 'var(--muted)', sort: 0 },
  vstage: (code: string) => meta().visa_stages.find((s) => s.code === code) || { code, name: code, color: 'var(--muted)', sort: 0 },
  can: (module: string, action = 'view') => (meta().perms[module] || []).includes(action),
  admin: () => S().me?.role === 'admin',
  manager: () => S().me?.role === 'manager',
};
