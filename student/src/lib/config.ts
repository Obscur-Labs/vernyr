// Branches are written out because Next inlines process.env.NEXT_PUBLIC_* literally.
const trimSlash = (url: string) => url.replace(/\/+$/, '');

export const mode = process.env.NEXT_PUBLIC_MODE === 'live' ? 'live' : 'local';

export const apiOrigin = trimSlash(
  (mode === 'live'
    ? process.env.NEXT_PUBLIC_LIVE_API_ORIGIN
    : process.env.NEXT_PUBLIC_LOCAL_API_ORIGIN) ?? 'http://localhost:5000',
);

export const apiUrl = `${apiOrigin}/api`;
