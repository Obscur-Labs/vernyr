import http from '@/lib/api';

/** The client's portal API (legacy/public/portal/js/p.js papi): every call under /api/portal, a 428 opens the consent gate. */
export class ApiError extends Error {
  constructor(public status: number, public data: Record<string, unknown> & { errors?: Record<string, string>; code?: string }) {
    super(String(data?.error ?? data?.message ?? 'Request failed'));
  }
}
let onConsent: (() => void) | null = null;
export const setConsentHandler = (fn: () => void) => { onConsent = fn; };
const P = (u: string) => (/^\/(auth|legal)\b/.test(u) ? u : '/portal' + u);
const fail = (err: unknown) => {
  const r = (err as { response?: { status: number; data: Record<string, unknown> } }).response;
  const e = new ApiError(r?.status ?? 0, (r?.data && typeof r.data === 'object' ? r.data : null) ?? { error: 'Network error. Please check your connection.' });
  if (e.status === 428 && e.data.code !== 'bot_check' && onConsent) onConsent();
  return e;
};

async function call<T>(method: 'get' | 'post' | 'put' | 'delete' | 'patch', url: string, body?: unknown, passive = false): Promise<T> {
  const headers = passive ? { 'X-Activity': 'passive' } : undefined;
  try {
    const res = method === 'get' || method === 'delete'
      ? await http[method](P(url), { ...(body ? { data: body } : {}), headers })
      : await http[method](P(url), body ?? {}, { headers });
    return res.data as T;
  } catch (err) { throw fail(err); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const GET = <T = any>(url: string, o?: { passive?: boolean }) => call<T>('get', url, undefined, !!o?.passive);
export const POST = <T = any>(url: string, body?: unknown) => call<T>('post', url, body);
export const PUT = <T = any>(url: string, body?: unknown) => call<T>('put', url, body);
export const PATCH = <T = any>(url: string, body?: unknown) => call<T>('patch', url, body);
export const DEL = <T = any>(url: string, body?: unknown) => call<T>('delete', url, body);

/** Downloads a file the API serves (PDF, ZIP) with the auth header, under the server's error message on failure. */
export async function download(url: string, filename: string, open = false) {
  try {
    const res = await http.get(P(url), { responseType: 'blob' });
    const href = URL.createObjectURL(res.data as Blob);
    if (open) { window.open(href, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(href), 60_000); return; }
    const a = document.createElement('a');
    a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch (err) {
    const blob = (err as { response?: { status: number; data?: Blob } }).response?.data;
    let msg = 'Could not download';
    try { msg = JSON.parse(await (blob as Blob).text()).error ?? msg; } catch { /* not JSON */ }
    throw new ApiError((err as { response?: { status: number } }).response?.status ?? 0, { error: msg });
  }
}

/** A file the API serves, as a Blob (to put it in an <img>). */
export async function blob(url: string) {
  try { return (await http.get(P(url), { responseType: 'blob' })).data as Blob; } catch { throw new ApiError(0, { error: 'Could not load the file' }); }
}

/** POST / PUT a FormData body (uploads), with the same errors as the JSON helpers. */
export async function SEND<T = any>(method: 'post' | 'put' | 'patch', url: string, fd: FormData): Promise<T> {
  try { return (await http[method](P(url), fd)).data as T; } catch (err) { throw fail(err); }
}
