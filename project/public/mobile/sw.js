// ConstructPM Mobile service worker.
// Strategy:
//   - App shell precached on install so launches work offline.
//   - /api/* requests always go to network (writes must hit the server,
//     reads need to be fresh). On failure we surface the network error.
//   - Other /mobile/* requests use stale-while-revalidate so an updated
//     bundle is picked up on the next launch.
// Push notifications are deferred to v2 — no push event handler here.

// Bump on any shell change so installed PWAs evict stale styles.css /
// app.js / scan.js on next launch. v2: corner-bracket scanner target +
// auto-torch (PR #30) — users on v1 were seeing the old plain reticle
// and no flashlight because the SW kept serving cached shell forever.
const CACHE = 'cpm-mobile-v2';
const APP_SHELL = [
  '/mobile/',
  '/mobile/index.html',
  '/mobile/styles.css',
  '/mobile/app.js',
  '/mobile/lib/api.js',
  '/mobile/lib/auth.js',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return; // POST/PATCH/DELETE pass through

  // API: network-only, no cache.
  if (url.pathname.startsWith('/api/')) return;

  // Mobile shell + assets: stale-while-revalidate.
  if (url.pathname.startsWith('/mobile/') || url.pathname === '/manifest.webmanifest') {
    e.respondWith(swr(e.request));
  }
});

async function swr(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const fetched = fetch(req).then(res => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetched;
}
