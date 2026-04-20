// Renderer-side Sentry initializer.
// - No-op when VITE_SENTRY_DSN is unset (import of @sentry/electron|react is
//   skipped entirely so the bundle can tree-shake the unused module).
// - Safe to call multiple times (guarded).
// - Works in three environments:
//     * Desktop renderer (Electron)  → @sentry/electron/renderer
//     * Web browser                  → @sentry/react
//     * SSR / tests (no window)      → no-op

import { scrubEvent, scrubValue, scrubString } from './sentry-scrub.mjs'

let _sentry = null      // loaded SDK (namespace)
let _initialized = false

function pickEnvironment() {
  try {
    if (import.meta.env?.MODE === 'development' || import.meta.env?.DEV) return 'development'
  } catch {}
  return 'production'
}

function isElectronRenderer() {
  return typeof window !== 'undefined' && !!window.electronAPI
}

/**
 * Initialize Sentry in the renderer / web build.
 * Returns the SDK namespace if active, or null if disabled / unavailable.
 * @param {{ release?: string }} opts
 */
export async function initSentryRenderer(opts = {}) {
  if (_initialized) return _sentry
  _initialized = true

  // Vite exposes import.meta.env.* at build time. If DSN is unset we skip the
  // dynamic import so the chunk isn't fetched in production.
  let dsn = ''
  try { dsn = import.meta.env?.VITE_SENTRY_DSN || '' } catch {}
  if (!dsn) return null
  if (typeof window === 'undefined') return null

  try {
    if (isElectronRenderer()) {
      const mod = await import('@sentry/electron/renderer')
      mod.init({
        // dsn is injected by the main-process Sentry when using @sentry/electron,
        // but we pass it here too to support dev (renderer-only) init paths.
        dsn,
        release: opts.release,
        environment: pickEnvironment(),
        tracesSampleRate: 0.1,
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (b) => {
          if (!b) return b
          if (b.data) b.data = scrubValue(b.data)
          if (b.message) b.message = scrubString(b.message)
          return b
        },
      })
      _sentry = mod
    } else {
      const mod = await import('@sentry/react')
      mod.init({
        dsn,
        release: opts.release,
        environment: pickEnvironment(),
        integrations: [mod.browserTracingIntegration()],
        tracesSampleRate: 0.1,
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (b) => {
          if (!b) return b
          if (b.data) b.data = scrubValue(b.data)
          if (b.message) b.message = scrubString(b.message)
          return b
        },
      })
      _sentry = mod
    }
  } catch (err) {
    // Never let Sentry init break the app
    try { console.warn('[sentry] init failed:', err?.message || err) } catch {}
    _sentry = null
  }
  return _sentry
}

/** @returns The loaded Sentry SDK namespace or null if disabled. */
export function getSentry() { return _sentry }

/** Report a user + business context. Safe when Sentry disabled. */
export function setSentryContext({ user, business } = {}) {
  const s = _sentry
  if (!s) return
  try {
    if (user === null) s.setUser?.(null)
    else if (user) s.setUser?.({ id: String(user.id ?? ''), role: user.role || undefined })
    if (business) {
      s.setContext?.('business', {
        id: business.id ?? null,
        type: business.type ?? null,
        vertical: business.vertical ?? null,
      })
      if (business.id) s.setTag?.('business_id', String(business.id))
      if (business.type) s.setTag?.('business_type', String(business.type))
    }
  } catch {}
}

/** Forward a captured exception. No-op when disabled. */
export function captureSentryException(err, extra) {
  const s = _sentry
  if (!s) return
  try { s.captureException?.(err, extra ? { extra } : undefined) } catch {}
}
