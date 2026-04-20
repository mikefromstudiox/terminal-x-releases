// Bump this on every deploy that changes chunk references or SW strategy.
// A new CACHE_NAME forces the SW to purge old caches on activate.
const CACHE_NAME       = 'terminal-x-v3'
const SUPABASE_CACHE   = 'terminal-x-supabase-v3'

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
// Activate — purge old caches, claim clients
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== SUPABASE_CACHE)
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

  // Supabase — network-first for GET /rest/v1/*, never cache auth or writes.
  // Safe to cache: read-only REST responses (inventory list, settings, etc.)
  // so the UI can render stale data when offline. Writes bubble through to
  // the offline-queue module in packages/services/offline-queue.js which
  // retries on reconnect.
  if (url.hostname.includes('supabase')) {
    // NEVER cache auth / functions / realtime
    if (url.pathname.includes('/auth/')       ||
        url.pathname.includes('/functions/')  ||
        url.pathname.includes('/realtime/')   ||
        url.pathname.includes('/storage/')) {
      return // default network fetch, no SW interference
    }
    if (request.method !== 'GET') return // only cache reads
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone()
            caches.open(SUPABASE_CACHE).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => caches.match(request).then(r => r || new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-From-Cache': 'miss' },
        })))
    )
    return
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
