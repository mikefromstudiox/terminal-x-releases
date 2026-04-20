// Electron main-process Sentry bootstrap. CommonJS, zero-cost when DSN unset.
// Call initSentryMain({ release }) AS EARLY AS POSSIBLE — before other
// requires that might throw. Always returns (never rejects). If DSN is
// missing it short-circuits without loading @sentry/electron.

const { scrubEvent, scrubValue, scrubString } = require('../packages/services/sentry-scrub.cjs')

let _Sentry = null
let _initialized = false

function initSentryMain(opts) {
  if (_initialized) return _Sentry
  _initialized = true

  const dsn = (process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN || '').trim()
  if (!dsn) return null

  let Sentry = null
  try { Sentry = require('@sentry/electron/main') }
  catch (_) {
    try { Sentry = require('@sentry/electron') } // fallback for older bundles
    catch (err) {
      try { console.warn('[sentry] @sentry/electron not available:', err && err.message) } catch {}
      return null
    }
  }

  try {
    Sentry.init({
      dsn,
      release: (opts && opts.release) || undefined,
      environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
      tracesSampleRate: 0.1,
      // Strip PII before any event leaves the process
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (b) => {
        if (!b) return b
        if (b.data)    b.data    = scrubValue(b.data)
        if (b.message) b.message = scrubString(b.message)
        return b
      },
    })
    _Sentry = Sentry
  } catch (err) {
    try { console.warn('[sentry] init failed:', err && err.message) } catch {}
    _Sentry = null
  }
  return _Sentry
}

function getSentryMain() { return _Sentry }

function captureSentryException(err, extra) {
  if (!_Sentry) return
  try { _Sentry.captureException(err, extra ? { extra } : undefined) } catch {}
}

module.exports = { initSentryMain, getSentryMain, captureSentryException }
