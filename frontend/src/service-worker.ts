/// <reference lib="webworker" />
/**
 * Service worker de Puerto Delta (fuente tipada).
 * Se compila a /sw.js en `vite build` (ver serviceWorkerPlugin en vite.config.ts).
 *
 * Estrategia:
 * - install: precache del app shell con nombre de caché versionado.
 * - /assets/* (con hash): cache-first.
 * - /api/* y cualquier ruta con /exports/: network-only, NUNCA se cachea
 *   (datos sensibles, sesión, CSRF y validaciones requieren servidor).
 * - Navegación: network-first con respaldo al index.html cacheado.
 * - Sin Background Sync: las operaciones autenticadas esperan conexión explícita.
 */

const sw = self as unknown as ServiceWorkerGlobalScope

const VERSION = '__SW_VERSION__'
const CACHE = `puerto-delta-shell-${VERSION}`
const PRECACHE: string[] = "__PRECACHE_MANIFEST__" as unknown as string[]

function isNeverCache(url: URL): boolean {
  return url.pathname.startsWith('/api/') || url.pathname.includes('/exports/')
}

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(Array.isArray(PRECACHE) ? PRECACHE : ['/', '/index.html']))
      .then(() => sw.skipWaiting()),
  )
})

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('puerto-delta-shell-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('fetch', (event: FetchEvent) => {
  const req = event.request
  const url = new URL(req.url)

  // Solo mismo origen y GET; el resto pasa directo a la red.
  if (url.origin !== sw.location.origin || req.method !== 'GET') return

  // API y exportes: network-only. No se responde desde caché bajo ninguna condición.
  if (isNeverCache(url)) {
    event.respondWith(fetch(req))
    return
  }

  // Navegación: network-first, respaldo al shell cacheado.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE)
        return (
          (await cache.match('/index.html')) ||
          (await cache.match('/')) ||
          new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        )
      }),
    )
    return
  }

  // Recursos con hash: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // Resto del shell (manifest, iconos): caché con respaldo a red.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)))
})
