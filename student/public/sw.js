// Minimal service worker for the student portal. Its job is to make the app
// installable and to keep the shell reachable offline — not to cache API
// responses, which must stay live.
//
// Bump VERSION on any change here: the activate handler deletes every cache
// that is not the current one, which is what makes a deploy take effect. The
// previous version pinned one cache name forever, so `activate` never cleaned
// anything and `caches.match(request) || fetch(request)` served build output
// from the first visit for the life of the browser profile.
const VERSION = 'v2';
const CACHE = `vernyr-portal-${VERSION}`;

// Only URLs that actually exist. `addAll` is atomic: one 404 rejected the whole
// precache, which is why this never populated.
const SHELL = ['/'];

/** Content-addressed output — safe to serve from cache, never stale for a hash. */
const isImmutable = (url) => url.pathname.startsWith('/_next/static/');

/** Everything else worth keeping offline: icons, brand art, the manifest. */
const isAsset = (url) =>
  /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname) ||
  url.pathname === '/manifest.webmanifest';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve a stale answer for data.
  if (url.pathname.startsWith('/api/')) return;

  // A navigation always goes to the network first; the cached shell is the
  // offline fallback, not the answer.
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }

  // Hashed build output: cache-first is correct, because a given URL can only
  // ever have one body.
  if (isImmutable(url)) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => put(request, res))),
    );
    return;
  }

  // Assets: serve the cached copy but refresh it in the background, so a
  // replaced logo is picked up on the next load rather than never.
  if (isAsset(url)) {
    e.respondWith(
      caches.match(request).then((hit) => {
        const fresh = fetch(request).then((res) => put(request, res)).catch(() => hit);
        return hit || fresh;
      }),
    );
    return;
  }

  // Anything else — including dev server output, which reuses filenames across
  // rebuilds — is left to the network entirely.
});

function put(request, res) {
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
  }
  return res;
}
