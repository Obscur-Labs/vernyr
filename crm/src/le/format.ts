import { apiOrigin } from '@/lib/config';
// The client's formatting helpers (legacy/public/js/core.js). Every time is shown in IST.
const TZ = 'Asia/Kolkata';

export const fmtDate = (d?: string | Date | null) => {
  if (!d) return '';
  const iso = String(d).length === 10;
  const x = new Date(iso ? `${d}T00:00:00Z` : d);
  if (isNaN(+x)) return String(d);
  return x.toLocaleDateString('en-GB', { timeZone: iso ? 'UTC' : TZ, day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDT = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '';
export const fmtTime = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }) : '';
export const money = (n: unknown, c?: string) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = Number(n);
  if (c === 'INR') return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (c === 'EUR') return '€' + v.toLocaleString('en-IE', { maximumFractionDigits: 2 });
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + (c || '');
};
export const ago = (d: string | Date) => {
  const s = (Date.now() - +new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' d ago';
  return fmtDate(d);
};
export const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
/** value for <input type=datetime-local> in IST */
export const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
};
export const fromLocalInput = (v?: string | null) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
export const initials = (n?: string) => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export const qs = (obj: Record<string, unknown> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem('le:' + k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem('le:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
/** a server path such as /api/logos/:id, made absolute against the API (the CRM is served from another origin) */
export const apiSrc = (u?: string | null) => (u && u.startsWith('/api/') ? apiOrigin + u : u || '');
