// University partner portal core: own API client (/api/university), reuses the CRM UI helpers.
export * from '/js/core.js';
import { toast, esc } from '/js/core.js';

export const us = { me: null };
export class UniError extends Error { constructor(status, data) { super(data && data.error || 'Request failed'); this.status = status; this.data = data || {}; } }
export async function uapi(method, url, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'LaEuropaCRM' } };
  if (opts.passive) init.headers['X-Activity'] = 'passive';
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch('/api/university' + url, init);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  if (res.status === 401 && !url.startsWith('/auth')) {
    const was = !!us.me; us.me = null;
    if (!/^#\/(login|invite|forgot|reset|twofa|setup)/.test(location.hash)) { if (was) toast(data && data.error || 'Please log in', 'err'); sessionStorage.setItem('leu:after', location.hash); location.hash = '#/login'; }
    throw new UniError(401, data);
  }
  // invisible bot check: solve the puzzle and send the same request again (once)
  if (res.status === 428 && data && data.code === 'bot_check' && !opts.botTried && !(body instanceof FormData)) {
    const pow = await (await import('../../js/botcheck.js')).withNote(data.challenge);
    return uapi(method, url, { ...(body || {}), pow }, { ...opts, botTried: true });
  }
  if (!res.ok) throw new UniError(res.status, data);
  return data;
}
export const uget = (u, o) => uapi('GET', u, undefined, o);
export const upost = (u, b) => uapi('POST', u, b ?? {});
export const uput = (u, b) => uapi('PUT', u, b ?? {});
export const udel = (u, b) => uapi('DELETE', u, b ?? {});
// download a file produced by a POST (export with body) or GET with auth cookie
export async function download(url, name, body) {
  const r = await fetch('/api/university' + url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'X-Requested-With': 'LaEuropaCRM', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { let m = 'Download failed'; try { m = (await r.json()).error; } catch { /* */ } return toast(m, 'err'); }
  const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export const isAdmin = () => us.me && us.me.role === 'admin';
export const canAct = () => us.me && us.me.role !== 'viewer' && !us.me.preview;
export const isFinance = () => us.me && us.me.finance;
const SC = { New: 'blue', Acknowledged: 'purple', 'Documents requested': 'orange', 'Under assessment': 'purple', 'Interview scheduled': 'purple', Waitlisted: 'grey', 'Conditional offer': 'orange', 'Unconditional offer': 'green',
  Rejected: 'red', 'Offer accepted': 'green', 'Deposit received': 'green', Enrolled: 'green', Withdrawn: 'grey' };
export const ustatus = (s) => `<span class="badge ${SC[s] || 'grey'}">${esc(s)}</span>`;
export const PAGE_SIZES = [25, 50, 100];
