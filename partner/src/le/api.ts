import http from '@/lib/api';
import { apiSrc } from './format';
export { apiSrc };

/** The client's partner portal API (legacy/public/university/js/u.js uapi): every call under /api/university. */
export class ApiError extends Error {
  constructor(public status: number, public data: Record<string, unknown> & { errors?: Record<string, string>; code?: string }) {
    super(String(data?.error ?? data?.message ?? 'Request failed'));
  }
}
const U = (u: string) => '/university' + u;
const fail = (err: unknown) => {
  const r = (err as { response?: { status: number; data: Record<string, unknown> } }).response;
  return new ApiError(r?.status ?? 0, (r?.data && typeof r.data === 'object' ? r.data : null) ?? { error: 'Network error. Please check your connection.' });
};
async function call<T>(method: 'get' | 'post' | 'put' | 'delete', url: string, body?: unknown, passive = false): Promise<T> {
  const headers = passive ? { 'X-Activity': 'passive' } : undefined;
  try {
    const res = method === 'get' || method === 'delete'
      ? await http[method](U(url), { ...(body ? { data: body } : {}), headers })
      : await http[method](U(url), body ?? {}, { headers });
    return res.data as T;
  } catch (err) { throw fail(err); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const GET = <T = any>(url: string, o?: { passive?: boolean }) => call<T>('get', url, undefined, !!o?.passive);
export const POST = <T = any>(url: string, body?: unknown) => call<T>('post', url, body);
export const PUT = <T = any>(url: string, body?: unknown) => call<T>('put', url, body);
export const DEL = <T = any>(url: string, body?: unknown) => call<T>('delete', url, body);

/** POST / PUT a FormData body (uploads), with the same errors as the JSON helpers. */
export async function SEND<T = any>(method: 'post' | 'put', url: string, fd: FormData): Promise<T> {
  try { return (await http[method](U(url), fd)).data as T; } catch (err) { throw fail(err); }
}

/** Downloads a file the API serves (Excel, PDF) with the auth header; a body makes it a POST. */
export async function download(url: string, filename: string, body?: unknown, open = false) {
  try {
    const res = body ? await http.post(U(url), body, { responseType: 'blob' }) : await http.get(U(url), { responseType: 'blob' });
    const href = URL.createObjectURL(res.data as Blob);
    if (open) { window.open(href, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(href), 60_000); return; }
    const a = document.createElement('a');
    a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch (err) {
    const blob = (err as { response?: { status: number; data?: Blob } }).response?.data;
    let msg = 'Download failed';
    try { msg = JSON.parse(await (blob as Blob).text()).error ?? msg; } catch { /* not JSON */ }
    throw new ApiError((err as { response?: { status: number } }).response?.status ?? 0, { error: msg });
  }
}
/** open a link the API handed out: a signed /api/university/file/... path or a signed storage URL */
export const openUrl = (u?: string | null) => { if (u) window.open(apiSrc(u), '_blank', 'noopener'); };
/** a route that answers { url }: fetch it, then open the link */
export async function openFrom(url: string, body?: unknown) {
  const w = window.open('', '_blank');
  try { const r = body === undefined ? await GET<{ url: string }>(url) : await POST<{ url: string }>(url, body); if (w) w.location.href = apiSrc(r.url); else openUrl(r.url); }
  catch (e) { w?.close(); throw e; }
}
