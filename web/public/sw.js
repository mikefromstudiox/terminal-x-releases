// Bump CACHE_NAME on every deploy that changes chunk references or SW strategy.
// A new CACHE_NAME forces the SW to purge old caches on activate.
//
// SECURITY (v4): the previous SUPABASE_CACHE that cached /rest/v1/* GETs across
// users was a cross-tenant exposure vector — a stale response cached during
// User A's session could be served to User B after sign-out + sign-in in the
// same browser. Every Supabase REST request now goes network-only; no cross-
// user response can survive in this Service Worker. Static assets (HTML, JS,
// fonts, images) are still cached per their pre-existing strategy.
const CACHE_NAME = 'terminal-x-v4'

const PRECACHE_URLS = [
  '/',
  '/index.html',
]

// ---------------------------------------------------------------------------
// Install — cache shell
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

// ---------------------------------------------------------------------------
// Activate — purge ALL old caches (including legacy SUPABASE_CACHE), claim clients
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

// ---------------------------------------------------------------------------
// Fetch strategy
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Supabase — NEVER cache. Per-user RLS-scoped responses cannot be safely
  // shared across sessions in the same browser. Pass through to network.
  if (url.hostname.includes('supabase')) {
    return // default network fetch, no SW interference
  }

  // Skip non-GET requests from here on
  if (request.method !== 'GET') return

  // HTML — network-first, fallback to cached /index.html (SPA)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Hashed build assets — network-first. Vite hashes filenames per build, so
  // the HTTP cache + hash is enough. Using network-first here means a new
  // deploy NEVER serves a stale asset, and if the network is down we still
  // fall back to whatever was cached.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => caches.match(request))
    )
    return
  }

  // Static files (images, fonts) — cache-first
  if (
    url.pathname.endsWith('.png')   ||
    url.pathname.endsWith('.jpg')   ||
    url.pathname.endsWith('.webp')  ||
    url.pathname.endsWith('.svg')   ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
      })
    )
    return
  }
})
