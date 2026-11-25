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
