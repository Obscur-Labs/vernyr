import axios from 'axios';
import { apiUrl } from './config';

export const TOKEN_KEY = 'partner_token';
const api = axios.create({ baseURL: apiUrl, headers: { 'Content-Type': 'application/json' } });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // a wrong password or code is a 401 too: the sign-in screens show it instead of reloading
    const signIn = /^\/university\/auth\//.test(String(err.config?.url ?? ''));
    if (err.response?.status === 401 && typeof window !== 'undefined' && !signIn) {
      localStorage.removeItem(TOKEN_KEY);
      if (!/^\/(login|invite|forgot|reset|preview)/.test(window.location.pathname)) {
        sessionStorage.setItem('leu:after', window.location.pathname + window.location.search);
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

// Two components asking for the same URL at once share one request; the entry is dropped the moment it settles.
const inflight = new Map<string, ReturnType<typeof api.get>>();
const get = api.get.bind(api);
api.get = ((url: string, config?: Parameters<typeof get>[1]) => {
  if (config?.signal || config?.responseType) return get(url, config);
  const key = `${url}?${JSON.stringify(config?.params ?? null)}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const req = get(url, config).finally(() => inflight.delete(key));
  inflight.set(key, req);
  return req;
}) as typeof api.get;

export default api;
