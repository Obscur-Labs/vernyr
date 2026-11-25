import http from '@/lib/api';

/** The client's API helpers (GET / POST / PUT / DEL) on our axios instance: same calls, same errors. */
export class ApiError extends Error {
  constructor(public status: number, public data: Record<string, unknown> & { errors?: Record<string, string> }) {
    super(String(data?.error ?? data?.message ?? 'Request failed'));
  }
}

async function call<T>(method: 'get' | 'post' | 'put' | 'delete', url: string, body?: unknown): Promise<T> {
  try {
    const res = method === 'get' || method === 'delete'
      ? await http[method](url, body ? { data: body } : undefined)
      : await http[method](url, body ?? {});
    return res.data as T;
  } catch (err) {
    const r = (err as { response?: { status: number; data: Record<string, unknown> } }).response;
    throw new ApiError(r?.status ?? 0, r?.data ?? { error: 'Network error. Please check your connection.' });
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const GET = <T = any>(url: string) => call<T>('get', url);
export const POST = <T = any>(url: string, body?: unknown) => call<T>('post', url, body);
export const PUT = <T = any>(url: string, body?: unknown) => call<T>('put', url, body);
export const DEL = <T = any>(url: string, body?: unknown) => call<T>('delete', url, body);

/** Downloads a file the API serves (PDF, Excel, ZIP) with the auth header, under the server's error message on failure. */
export async function download(url: string, filename: string, open = false) {
  try {
    const res = await http.get(url, { responseType: 'blob' });
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

/** POST / PUT a FormData body (uploads), with the same errors as the JSON helpers. */
export async function SEND<T = any>(method: 'post' | 'put' | 'patch', url: string, fd: FormData): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try { return (await http[method](url, fd)).data as T; } catch (err) {
    const r = (err as { response?: { status: number; data: Record<string, unknown> } }).response;
    throw new ApiError(r?.status ?? 0, r?.data ?? { error: 'Network error. Please check your connection.' });
  }
}
