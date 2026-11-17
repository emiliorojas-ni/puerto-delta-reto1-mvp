/**
 * Service Worker · Puerto Delta (public/sw.js)
 * Fuente tipada de referencia: src/service-worker.ts
 *
 * Reglas de caché:
 * - Precache del app shell (/, /index.html, /manifest.webmanifest, iconos) en install con nombre versionado.
 * - /assets/*: cache-first (y se guarda al primer hit).
 * - /api/* y /exports/*: network-only (NUNCA se cachean respuestas sensibles ni exportaciones).
 * - Navegación (mode === 'navigate'): network-first con respaldo a /index.html en caché.
 * - Sin Background Sync: toda validación requiere conexión activa con el servidor.
 */
const VERSION = 'v1-20261117';
const CACHE = `puerto-delta-shell-${VERSION}`;
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

function isNeverCache(url) {
  return url.pathname.startsWith('/api/') || url.pathname.includes('/exports/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('puerto-delta-shell-') && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin || req.method !== 'GET') return;

  if (isNeverCache(url)) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE);
        return (
          (await cache.match('/index.html')) ||
          (await cache.match('/')) ||
          new Response('Sin conexión', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      })
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
