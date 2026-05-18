import React, { useState, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import ErrorBoundary from '@/components/ErrorBoundary'
import { initSentryRenderer, captureSentryException } from '@terminal-x/services/sentry-renderer.js'
import '@/index.css'
import xMark from '@/assets/x-mark.webp'

// ── Sentry (no-op when VITE_SENTRY_DSN unset) — fire BEFORE any other work so
// the SDK can capture chunk-load errors during the initial navigation. ──────
const __release = (typeof __APP_VERSION__ !== 'undefined' ? `terminal-x-web@${__APP_VERSION__}` : undefined)
initSentryRenderer({ release: __release })

// Landing page eager-loaded (it's the entry route — must render fast for LCP)
import LandingPage from '@/landing/LandingPage'

// Everything else lazy
const SignupPage  = React.lazy(() => import('@/landing/SignupPage'))
const AdminApp    = React.lazy(() => import('@/admin/AdminApp'))
const CertPortal  = React.lazy(() => import('@/portal/CertPortal'))
const BlogIndex   = React.lazy(() => import('@/landing/components/BlogIndex'))
const BlogPost    = React.lazy(() => import('@/landing/components/BlogPost'))
const TiendaEmpenosList   = React.lazy(() => import('@/landing/TiendaEmpenos').then(m => ({ default: m.TiendaEmpenosList })))
const TiendaEmpenosDetail = React.lazy(() => import('@/landing/TiendaEmpenos').then(m => ({ default: m.TiendaEmpenosDetail })))
const Agendar             = React.lazy(() => import('@/landing/Agendar'))
const IndustryPage        = React.lazy(() => import('@/landing/IndustryPage'))
const SeoLandingPage      = React.lazy(() => import('@/landing/SeoLandingPage'))
const WorkOrderApprove    = React.lazy(() => import('@/landing/WorkOrderApprove'))
const Demo                = React.lazy(() => import('@/landing/demos/Demo'))
const AceptarContador     = React.lazy(() => import('@/landing/AceptarContador'))

// Blog lang resolver — same precedence as the landing-page hook
// (`tx_landing_lang` localStorage > navigator.language > 'es') but without
// importing the hook so /blog routes don't pay for the whole landing bundle.
function resolveBlogLang() {
  try {
    const stored = localStorage.getItem('tx_landing_lang')
    if (stored === 'en' || stored === 'es') return stored
  } catch {}
  try {
    return typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'es'
  } catch { return 'es' }
}

function BlogIndexRoute({ lang }) {
  return <BlogIndex lang={lang || resolveBlogLang()} />
}
function BlogPostRoute({ lang }) {
  return <BlogPost lang={lang || resolveBlogLang()} />
}

// Lazy load Supabase — fetched only when a route that needs it (POS / Admin /
// Signup) is actually visited. Previously this fired at module-eval, which put
// the supabase + data + services chunks on the landing-page critical path
// (~200 KiB / 1.5s on mobile slow-4G).
let _supabase = null
let _supabaseReadyPromise = null
function getSupabaseReady() {
  if (_supabaseReadyPromise) return _supabaseReadyPromise
  _supabaseReadyPromise = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
    ? import('@supabase/supabase-js').then(({ createClient }) => {
        _supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
        if (typeof window !== 'undefined') {
          window.__txSupabase = _supabase
          window.__txResetSupabase = () => { _supabase = null; _supabaseReadyPromise = null }
        }
        import('@terminal-x/data/web').then(({ bootLicenseJwt }) => {
          bootLicenseJwt(_supabase, import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY).catch(() => {})
        }).catch(() => {})
        return _supabase
      })
    : Promise.resolve(null)
  return _supabaseReadyPromise
}

export { _supabase as supabase }

// Lazy load POS dependencies — only fetched when /pos/* is visited
const POSRoute = React.lazy(() =>
  Promise.all([
    import('@/App'),
    import('@/i18n'),
    import('@/context/AuthContext'),
    import('@/context/LicenseContext'),
    import('@/context/DataContext'),
    import('@/hooks/usePlan.jsx'),
    import('@/hooks/useBusinessType.jsx'),
    import('@/context/KioskContext'),
    import('@terminal-x/data/web'),
    import('@terminal-x/services/offline-queue'),
    getSupabaseReady(),
  ]).then(([App, i18n, Auth, License, Data, Plan, BizType, Kiosk, WebData, Offline]) => ({
    default: function POSShell() {
      return (
        <SupabaseAuthGate
          supabase={_supabase}
          createWebAPI={WebData.createWebAPI}
          createWebPrinterAPI={WebData.createWebPrinterAPI}
          startOfflineSync={Offline.startOfflineSync}
        >
          <i18n.LangProvider>
            <Auth.AuthProvider>
              <License.LicenseProvider>
                <Plan.PlanProvider>
                  <BizType.BusinessTypeProvider>
                    <Kiosk.KioskProvider>
                      <App.default />
                    </Kiosk.KioskProvider>
                  </BizType.BusinessTypeProvider>
                </Plan.PlanProvider>
              </License.LicenseProvider>
            </Auth.AuthProvider>
          </i18n.LangProvider>
        </SupabaseAuthGate>
      )
    }
  }))
)

// Speed insights — defer to after load
window.addEventListener('load', () => {
  import('@vercel/speed-insights').then(m => m.injectSpeedInsights()).catch(() => {})
})

// ---------------------------------------------------------------------------
// Chunk load error handler — triggered when a new deploy invalidates the
// current session's hashed asset URLs. Forces a hard reload so the user
// fetches the fresh index.html with the new chunk references.
// ---------------------------------------------------------------------------
let _reloading = false
function handleChunkLoadError(err) {
  const msg = String(err?.message || err || '')
  const isChunkError =
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Loading chunk') ||
    /ChunkLoadError/i.test(msg)
  if (isChunkError && !_reloading) {
    _reloading = true
    // Report BEFORE reload so the admin panel sees how often / which chunks fail.
    // Even if the reload "fixes" it, we still want the breadcrumb. Severity is
    // 'warning' since silent recovery is the expected path.
    try {
      const chunkUrl = (msg.match(/https?:\/\/[^\s'")]+\.js/) || [])[0] || null
      reportClientError(err || msg, {
        severity: 'warning',
        category: 'chunk_load',
        extra: { chunk_url: chunkUrl, will_reload: true },
        force: true, // bypass dedup — every chunk failure is signal
      })
    } catch {}
    try {
      const last = Number(sessionStorage.getItem('tx_chunk_reload') || 0)
      if (Date.now() - last > 30000) {
        sessionStorage.setItem('tx_chunk_reload', String(Date.now()))
        window.location.reload()
      }
    } catch { window.location.reload() }
  }
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  handleChunkLoadError(event.payload || event)
})
window.addEventListener('error', (event) => {
  if (event?.filename?.includes('/assets/')) handleChunkLoadError(event.message)
  try {
    if (!isChunkMsg(event?.error || event?.message)) {
      captureSentryException(event?.error || new Error(String(event?.message || 'web error')))
      reportClientError(event?.error || event?.message)
    }
  } catch {}
})
window.addEventListener('unhandledrejection', (event) => {
  handleChunkLoadError(event.reason)
  try {
    if (!isChunkMsg(event?.reason)) {
      captureSentryException(event?.reason instanceof Error ? event.reason : new Error(String(event?.reason)))
      reportClientError(event?.reason)
    }
  } catch {}
})

function isChunkMsg(x) {
  const m = String((x && x.message) || x || '')
  return /chunk|dynamically imported module|Importing a module script failed/i.test(m)
}

// ---------------------------------------------------------------------------
// Per-client error reporter — POSTs to /api/panel?action=report_error so the
// admin panel can show errors per-business without users having to send
// screenshots. Anonymous, fire-and-forget; runs in parallel with Sentry.
// Throttled to avoid flooding from error storms.
//
// 2026-05-03 amplification (peppy-greeting-popcorn plan):
//   - signature is reportClientError(err, optsOrSeverity)
//   - opts: { severity, category, extra, force }  (force bypasses dedup)
//   - metadata now includes platform, business_type, plan, last_routes ring,
//     and any caller-supplied `extra` fields. All optional.
//   - last_routes ring is filled by the route history hooks below.
// ---------------------------------------------------------------------------
const _errReportRecent = new Set()
const _routeHistory = []

// 2026-05-18 — Persistence layer for failed error reports. Up until now any
// fetch failure (network blip, 500, keepalive payload limit) silently dropped
// the report — burned by Ranoza's "could not find empleado_supabase_id" error
// that never reached client_errors. Two layers now:
//   1. Queue failed POSTs to localStorage (capped at 50 entries, FIFO).
//   2. Drain the queue at the START of every new report attempt.
// Quota errors on the localStorage write are caught — we'd rather lose a
// pending replay than crash the reporter.
const _ERR_QUEUE_KEY = 'tx_err_replay_queue'
const _ERR_QUEUE_MAX = 50
function _readQueue() {
  try { return JSON.parse(localStorage.getItem(_ERR_QUEUE_KEY) || '[]') } catch { return [] }
}
function _writeQueue(q) {
  try { localStorage.setItem(_ERR_QUEUE_KEY, JSON.stringify(q.slice(-_ERR_QUEUE_MAX))) } catch {}
}
function _enqueueReport(body) {
  const q = _readQueue()
  q.push({ body, queued_at: Date.now() })
  _writeQueue(q)
}
async function _drainQueue() {
  const q = _readQueue()
  if (!q.length) return
  // Drain in order. If any send fails, stop and leave the rest queued.
  const remaining = []
  let i = 0
  for (; i < q.length; i++) {
    try {
      const r = await fetch('/api/panel?action=report_error', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(q[i].body),
      })
      if (!r.ok) { remaining.push(...q.slice(i)); break }
    } catch {
      remaining.push(...q.slice(i)); break
    }
  }
  _writeQueue(remaining)
}

function pushRoute(p) {
  if (!p) return
  if (_routeHistory[_routeHistory.length - 1] === p) return
  _routeHistory.push(p)
  if (_routeHistory.length > 5) _routeHistory.shift()
}
// Seed initial route + monkey-patch pushState/replaceState so SPA navs land here.
try {
  pushRoute(window.location.pathname)
  ;['pushState', 'replaceState'].forEach((m) => {
    const orig = history[m]
    history[m] = function (...args) {
      const r = orig.apply(this, args)
      try { pushRoute(window.location.pathname) } catch {}
      return r
    }
  })
  window.addEventListener('popstate', () => pushRoute(window.location.pathname))
} catch {}

function reportClientError(err, optsOrSeverity = 'error') {
  try {
    const opts = (typeof optsOrSeverity === 'string')
      ? { severity: optsOrSeverity }
      : (optsOrSeverity || {})
    const severity = opts.severity || 'error'
    const category = opts.category || null
    const extra    = opts.extra || null
    const force    = !!opts.force

    const message = String((err && err.message) || err || 'unknown error')
    if (!force && isChunkMsg(message)) return // chunk reloads handled separately
    const sig = message.slice(0, 200)
    if (!force) {
      if (_errReportRecent.has(sig)) return
      _errReportRecent.add(sig)
      setTimeout(() => _errReportRecent.delete(sig), 60000)
    }

    const get = (k) => { try { return localStorage.getItem(k) || null } catch { return null } }
    // 2026-05-18 — prefer per-tab window.__txBusinessId (set by AuthContext from
    // the JWT app_metadata claim) over localStorage 'tx_business_id'. localStorage
    // is shared across tabs/domains; with two Terminal X sessions open it gets
    // overwritten by the most-recent login and stamps errors with the WRONG
    // business. The window var is tab-scoped memory and always reflects this
    // tab's actual session. JWT claim is canonical per Hard Rule #20.
    const businessId = (typeof window !== 'undefined' && window.__txBusinessId) || get('tx_business_id')
    const userId = get('tx_user_id')
    const userRole = get('tx_user_role')
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
    const businessType = (typeof window !== 'undefined' && window.__txBusinessType) || null
    const plan = (typeof window !== 'undefined' && window.__txPlan) || null

    const body = {
      business_id: businessId,
      user_id: userId,
      user_role: userRole,
      message,
      stack: (err && err.stack) || null,
      route: typeof window !== 'undefined' ? window.location.pathname + window.location.search : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      app_version: appVersion,
      severity,
      metadata: {
        platform: 'web',
        ...(category ? { category } : {}),
        ...(businessType ? { business_type: businessType } : {}),
        ...(plan ? { plan } : {}),
        ...(_routeHistory.length ? { last_routes: _routeHistory.slice() } : {}),
        ...(extra || {}),
      },
    }

    // Drain any previously-queued reports first (fire-and-forget).
    _drainQueue()

    // POST this report — on ANY failure (network, 5xx, keepalive limit, CORS),
    // persist to localStorage so the next reporter call replays it. Was the
    // root cause of "we keep wiring __txReportError but errors never land":
    // fetch().catch(() => {}) ate every transient failure.
    fetch('/api/panel?action=report_error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(body),
    }).then((r) => {
      if (!r.ok) _enqueueReport(body)
    }).catch(() => {
      _enqueueReport(body)
    })
  } catch {}
}

if (typeof window !== 'undefined') {
  window.__txReportError = reportClientError
}

// 2026-05-03 (peppy-greeting-popcorn Phase 3) — console.error proxy.
// Capture every console.error into the same pipeline as severity='info' so
// React key warnings, prop-type errors, deprecation notices, etc surface in
// /admin Errores. Filters known noise (HMR overlay, Sentry self-reports,
// sourcemap warnings) and never recurses (re-entry guard).
let _consoleProxyActive = false
;(() => {
  if (typeof console === 'undefined' || console.__txWrapped) return
  const orig = console.error.bind(console)
  console.__txWrapped = true
  console.error = function (...args) {
    orig(...args)
    if (_consoleProxyActive) return
    try {
      _consoleProxyActive = true
      const msg = args.map(a => {
        if (a == null) return String(a)
        if (typeof a === 'string') return a
        if (a instanceof Error) return a.message
        try { return JSON.stringify(a).slice(0, 400) } catch { return String(a) }
      }).join(' ').slice(0, 1000)
      // Noise filter: skip well-known internal/dev-only warnings
      if (/HMR|\[vite\]|sourcemap|Sentry Logger|deprecated.*will be removed in a future version|Warning:.*key.*prop/i.test(msg)) return
      if (msg.startsWith('[renderer]')) return // our own log
      if (msg.includes('[ErrorBoundary]')) return // boundary already reports
      const firstErr = args.find(a => a instanceof Error)
      reportClientError(firstErr || msg, { severity: 'info', category: 'console_error' })
    } catch {} finally { _consoleProxyActive = false }
  }
})()

// ---------------------------------------------------------------------------
// Service Worker
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// ---------------------------------------------------------------------------
// FIX-H4 — Offline e-CF queue auto-drain (Facturación tier).
// Lazy-import keeps the IndexedDB adapter out of the marketing bundle; it
// only loads after first user interaction with /pos or /invoicing.
// The submitFn replays the original POST against the current session token,
// honoring DGII's IndicadorEnvioDiferido=1 promotion (queue helper handles).
// ---------------------------------------------------------------------------
function bootEcfQueueAutoDrain() {
  if (typeof window === 'undefined') return
  const path = window.location.pathname || ''
  if (!/^\/(pos|invoicing|credit-notes|dgii)/.test(path)) return
  Promise.all([
    import('@terminal-x/services/offline-ecf-queue'),
    import('@terminal-x/services/supabase'),
  ]).then(([queueMod, supaMod]) => {
    queueMod.autoDrain(async (payload) => {
      try {
        const client = supaMod.getSupabaseClient?.()
        if (!client) return { ok: false, error: 'no-supabase' }
        const sess = (await client.auth.getSession())?.data?.session
        if (!sess?.access_token) return { ok: false, error: 'no-session' }
        const r = await fetch('/api/ecf-sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sess.access_token}` },
          body: JSON.stringify(payload),
        })
        const j = await r.json().catch(() => ({}))
        if (!j.ok) return { ok: false, error: j.error || `HTTP ${r.status}` }
        return { ok: true, data: j.data }
      } catch (err) {
        return { ok: false, error: err?.message || 'network' }
      }
    })
  }).catch(() => {})
}
window.addEventListener('load', bootEcfQueueAutoDrain)

// ---------------------------------------------------------------------------
// Suspense fallback
// ---------------------------------------------------------------------------
function PageLoader() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-white/10" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#b3001e] animate-spin" />
      </div>
      <div className="text-white/70 text-sm tracking-wider uppercase font-semibold">Terminal X</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SupabaseAuthGate — blocks POS rendering until user is authenticated
// ---------------------------------------------------------------------------
function SupabaseAuthGate({ children, supabase, createWebAPI, createWebPrinterAPI, startOfflineSync }) {
  // MUST be declared before any early return — the `if (!supabase)` branch
  // below references DataProvider and previously this const lived after
  // those returns, producing a TDZ "Cannot access E before initialization"
  // crash that white-screened every user without a supabase client on first
  // render. (Discovered 2026-05-17 after the middleware fix exposed the
  // bundle-level bug that CSP-blocked scripts had been hiding.)
  const DataProvider = React.lazy(() => import('@/context/DataContext').then(m => ({ default: m.DataProvider })))
  const [session, setSession]       = useState(null)
  const [businessId, setBusinessId] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Cross-firm impersonation: when the contadora has an active "Ver como
  // cliente" session, swap the business_id passed to createWebAPI so every
  // web.js read is scoped to the impersonated tenant. Server-side
  // (panel.js?action=firm_impersonate_check) verified she has an
  // access_granted accounting_clients row before sessionStorage was set —
  // RLS via has_accountant_access(target) accepts the SELECTs that follow.
  const impersonatingBid = useMemo(() => {
    try { return sessionStorage.getItem('tx_impersonating_biz_id') || null }
    catch { return null }
  }, [])
  const effectiveBid = impersonatingBid || businessId
  const api = useMemo(() => effectiveBid ? createWebAPI(supabase, effectiveBid) : null, [effectiveBid])
  const printerApi = useMemo(() => createWebPrinterAPI(), [])

  useEffect(() => {
    // Suspend offline-sync entirely while impersonating a client tenant.
    // The contadora's view is read-only by design; running the firm's sync
    // loop against a swapped business_id would cause cross-tenant writes.
    if (impersonatingBid) return
    if (supabase && businessId) {
      return startOfflineSync(supabase, businessId)
    }
  }, [businessId, impersonatingBid])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }

    // Consume any in-flight logout flag — the moment the gate (re)mounts and
    // discovers no session, the post-logout cleanup is finished and downstream
    // contexts are free to behave normally again on the next sign-in.
    function clearLogoutFlag() {
      try { sessionStorage.removeItem('tx_logging_out') } catch {}
    }

    // Safety hatch: if Supabase auth network calls hang (DNS/network/CSP
    // blocking us silently), force-exit loading after 8s so the user gets
    // the login form instead of a forever spinner. Also fires
    // window.__txReportError so we can SEE the hang in /admin Errores —
    // previously every getSession() hang was invisible. (2026-05-17.)
    const safetyTimeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          try { window.__txReportError?.(new Error('auth getSession hung > 8s — forcing loading=false'), { severity: 'error', category: 'auth.web.getSession.hang', extra: { route: typeof location !== 'undefined' ? location.pathname : null } }) } catch {}
          return false
        }
        return prev
      })
    }, 8000)

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      clearTimeout(safetyTimeout)
      setSession(s)
      if (s) fetchBusinessId(s.user.id)
      else { clearLogoutFlag(); setLoading(false) }
    }).catch(err => {
      // No .catch previously — a rejected getSession() left loading=true
      // forever. Now we report and unblock the UI.
      clearTimeout(safetyTimeout)
      try { window.__txReportError?.(err, { severity: 'error', category: 'auth.web.getSession.reject' }) } catch {}
      setError('Error al cargar la sesion. Intenta de nuevo o cierra sesion.')
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s) fetchBusinessId(s.user.id)
      else { clearLogoutFlag(); setBusinessId(null); setLoading(false) }
    })

    return () => { clearTimeout(safetyTimeout); subscription.unsubscribe() }
  }, [])

  async function fetchBusinessId(userId) {
    try {
      // CANONICAL source = JWT app_metadata.business_id. The legacy staff
      // lookup .limit(1) picks at random when a user has multiple staff rows
      // (e.g. accountant who is owner in their firm AND role=accountant in
      // client tenants via the email-invite accept flow).
      const { data: { session: s } } = await supabase.auth.getSession()
      const jwtBid = s?.user?.app_metadata?.business_id || null

      let data = jwtBid ? { business_id: jwtBid } : null
      let err = null

      if (!data) {
        ;({ data, error: err } = await supabase
          .from('staff')
          .select('business_id')
          .eq('auth_user_id', userId)
          .limit(1)
          .maybeSingle())
      }

      if (!data) {
        const { data: biz, error: bizErr } = await supabase
          .from('businesses')
          .select('id')
          .eq('owner_id', userId)
          .limit(1)
          .maybeSingle()
        if (bizErr) throw bizErr
        if (biz) data = { business_id: biz.id }
        else if (err) throw err
      }

      if (!data) throw new Error('No business found')
      setBusinessId(data.business_id)

      // Auto-fetch license key for web users so they don't need to enter it manually
      if (!localStorage.getItem('tx_license_key')) {
        try {
          const { data: lic } = await supabase
            .from('licenses')
            .select('license_key')
            .eq('business_id', data.business_id)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle()
          if (lic?.license_key) {
            localStorage.setItem('tx_license_key', lic.license_key)
          }
        } catch {}
      }
    } catch (e) {
      setError('No se encontro negocio asociado a esta cuenta.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const { withRetry, isSupabaseRetryable } = await import('@terminal-x/services/retry.js')
      const { humanizeNetworkError } = await import('@terminal-x/services/networkError.js')
      const { error: err } = await withRetry(
        () => supabase.auth.signInWithPassword({ email, password }),
        { label: 'auth.web.signIn', isRetryable: isSupabaseRetryable },
      )
      if (err) {
        setError(humanizeNetworkError(err, { context: 'auth.web.signIn' }))
      }
    } catch (err) {
      const { humanizeNetworkError } = await import('@terminal-x/services/networkError.js')
      setError(humanizeNetworkError(err, { context: 'auth.web.signIn' }))
    } finally { setSubmitting(false) }
  }

  if (!supabase) {
    return (
      <DataProvider api={createWebAPI()} printerApi={printerApi}>
        {children}
      </DataProvider>
    )
  }

  if (loading) return <PageLoader />

  if (!session) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-black rounded-2xl p-8 w-full max-w-sm space-y-5 shadow-2xl">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <span className="text-3xl font-black text-white tracking-[3px]">TERMINAL</span>
              <img src={xMark} alt="X" width="112" height="112" className="h-28 w-28 object-contain mt-1" />
            </div>
            <p className="text-slate-400 text-sm mt-3">Iniciar sesion</p>
          </div>
          {error && <div className="bg-red-500/20 text-red-300 text-sm p-3 rounded-lg">{error}</div>}
          <div>
            <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Email</label>
            <input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="username"
              className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
          </div>
          <div>
            <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Contrasena</label>
            <input type="password" placeholder="Tu contrasena" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
          </div>
          <button type="submit" disabled={submitting}
            className="w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-50 transition-colors">
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
          <a href="/" className="block text-center text-slate-500 hover:text-[#b3001e] text-sm transition-colors">
            Ver mas sobre Terminal X
          </a>
          <a href="/signup" className="block text-center text-[#b3001e] hover:text-[#cc1a33] text-sm transition-colors">
            Crear cuenta nueva
          </a>
        </form>
      </div>
    )
  }

  if (!businessId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="bg-black rounded-2xl p-8 w-full max-w-sm text-center space-y-4 shadow-2xl">
          <h1 className="text-xl font-bold text-white">Sin negocio asignado</h1>
          <p className="text-slate-400 text-sm">{error || 'Contacte al administrador para vincular su cuenta a un negocio.'}</p>
          <button onClick={() => supabase.auth.signOut()}
            className="px-6 py-2 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-sm font-bold transition-colors">
            Cerrar sesion
          </button>
        </div>
      </div>
    )
  }

  // (DataProvider const moved to top of function — see TDZ note there.)

  // Tenant-isolation: keying the entire DataProvider subtree on
  // `effectiveBid:user.id` forces a full unmount + remount whenever the
  // active business OR auth user changes. Every descendant useState resets,
  // every useEffect re-fires against the new api closure. This is the
  // primary defense against the 2026-04-29 cross-tenant exposure incident
  // where stale React state from a previous user's session leaked into the
  // next user's session in the same tab. Defense-in-depth on the hook deps
  // arrays (useDB.js) covers in-tab impersonation switches, but THIS key is
  // what guarantees no React component can ever render the previous
  // tenant's data after a tenant change.
  const treeKey = `${effectiveBid || 'no-biz'}:${session?.user?.id || 'no-user'}`

  return (
    <React.Suspense fallback={<PageLoader />}>
      <DataProvider key={treeKey} api={api} printerApi={printerApi}>
        {children}
      </DataProvider>
    </React.Suspense>
  )
}

// ---------------------------------------------------------------------------
// Lazy admin wrapper — loads supabase before rendering
// ---------------------------------------------------------------------------
const AdminRoute = React.lazy(() =>
  Promise.all([
    import('@/i18n'),
    import('@/admin/AdminApp'),
    getSupabaseReady(),
  ]).then(([i18n, AdminApp]) => ({
    default: function AdminShell() {
      return <i18n.LangProvider><AdminApp.default supabase={_supabase} /></i18n.LangProvider>
    }
  }))
)

// ---------------------------------------------------------------------------
// Lazy signup wrapper
// ---------------------------------------------------------------------------
const SignupRoute = React.lazy(() =>
  Promise.all([
    import('@/landing/SignupPage'),
    getSupabaseReady(),
  ]).then(([SignupPage]) => ({
    default: function SignupShell({ lang }) {
      return <SignupPage.default supabase={_supabase} forceLang={lang} />
    }
  }))
)

// Pre-boots Supabase before rendering the accept page so the session check
// inside <AceptarContador> resolves on first render.
function AceptarContadorRoute() {
  const [ready, setReady] = useState(false)
  useEffect(() => { getSupabaseReady().then(() => setReady(true)) }, [])
  if (!ready) return <PageLoader />
  return <AceptarContador supabase={_supabase} />
}

// 2026-05-03 (peppy-greeting-popcorn) — route-mismatch sentinel for the
// outer BrowserRouter. Replaces the silent `<Navigate to="/">` catch-all so we
// see in /admin Errores when a sidebar tab points to a path the routing layer
// can't reach (the same class of bug as today's /reservas, /salon-dashboard,
// /catalogo gaps before they got their redirects).
function RouteNotFound() {
  const location = useLocation()
  useEffect(() => {
    try {
      const fn = (typeof window !== 'undefined') && window.__txReportError
      if (fn) fn(`route_not_found: ${location.pathname}${location.search || ''}`, {
        severity: 'warning',
        category: 'routing',
        force: true,
      })
    } catch {}
  }, [location.pathname])
  return <Navigate to="/" replace />
}

function ContabilidadRedirect() {
  const { tab } = useParams()
  const target = tab ? `/pos/contabilidad/${tab}` : '/pos/contabilidad'
  return <Navigate to={target} replace />
}

function ConfigRedirect() {
  const { section } = useParams()
  return <Navigate to={`/pos/config/${section}`} replace />
}

// SPA canonical updater — keeps <link rel="canonical"> and og:url in sync with
// the current route. Without this every route inherits index.html's hardcoded
// canonical=https://terminalxpos.com/, which Google flags as
// "alternate page with proper canonical tag" for /signup, /blog/*, /pricing, etc.
// Skips app/private routes (/pos, /admin, /invoicing, /cert, /wo, /tienda-empenos, /agendar)
// since those are noindex by intent.
function RouteCanonical() {
  const { pathname } = useLocation()
  React.useEffect(() => {
    const PRIVATE = /^\/(pos|admin|invoicing|cert|wo|tienda-empenos|agendar|queue|clients|credits|reports|inventory|conteo-fisico|dgii|cash-recon|petty-cash|credit-notes|returns|empleados|config|remote|sistema|license-admin|settings|memberships|resumen|work-orders|vehicles|service-bays|appointments|stylist-schedules|loans|pawn-items|lending|mesas|menu|menu-builder|kds|vehicle-inventory|sales-pipeline|test-drives|deal-builder|probar|demo)(\/|$)/
    const isPrivate = PRIVATE.test(pathname)
    // Canonical = pathname only (drop query: lang/utm/etc are parameter
    // variants of the same canonical page).
    const url = `https://terminalxpos.com${pathname}`
    let link = document.querySelector('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.setAttribute('rel', 'canonical')
      document.head.appendChild(link)
    }
    link.setAttribute('href', isPrivate ? 'https://terminalxpos.com/' : url)
    let og = document.querySelector('meta[property="og:url"]')
    if (!og) {
      og = document.createElement('meta')
      og.setAttribute('property', 'og:url')
      document.head.appendChild(og)
    }
    og.setAttribute('content', isPrivate ? 'https://terminalxpos.com/' : url)
    let robots = document.querySelector('meta[name="robots"]')
    if (!robots) {
      robots = document.createElement('meta')
      robots.setAttribute('name', 'robots')
      document.head.appendChild(robots)
    }
    robots.setAttribute('content', isPrivate ? 'noindex, nofollow' : 'index, follow, max-image-preview:large')
  }, [pathname])
  return null
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <RouteCanonical />
        <React.Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public landing pages — no Supabase needed */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/pricing" element={<LandingPage section="pricing" />} />

            {/* English mirror — same components, lang="en" forced. The /en/
                path prefix is Google's preferred bilingual URL pattern (over
                ?lang=en). Hreflang in middleware pairs each ES↔EN URL. */}
            <Route path="/en" element={<LandingPage forceLang="en" />} />
            <Route path="/en/pricing" element={<LandingPage section="pricing" forceLang="en" />} />
            <Route path="/en/signup" element={<SignupRoute lang="en" />} />
            <Route path="/en/blog" element={<BlogIndexRoute lang="en" />} />
            <Route path="/en/blog/:slug" element={<BlogPostRoute lang="en" />} />
            <Route path="/en/industries" element={<Navigate to="/en/#vertical-features" replace />} />
            <Route path="/en/industries/:slug" element={<IndustryPage forceLang="en" />} />

            {/* Signup — lazy loads Supabase */}
            <Route path="/signup" element={<SignupRoute />} />

            {/* Blog — public, no Supabase needed */}
            <Route path="/blog" element={<BlogIndexRoute />} />
            <Route path="/blog/:slug" element={<BlogPostRoute />} />

            {/* Demo routes removed — every "demo" CTA across the site goes to WhatsApp. */}
            <Route path="/demo/:vertical" element={<Navigate to="/" replace />} />
            <Route path="/demo" element={<Navigate to="/" replace />} />

            {/* Public Tienda de Empeños — read-only, no auth, anon Supabase. */}
            <Route path="/tienda-empenos/:businessId" element={<TiendaEmpenosList />} />
            <Route path="/tienda-empenos/:businessId/:slug" element={<TiendaEmpenosDetail />} />

            {/* Public salon booking — no auth, hCaptcha-protected. */}
            <Route path="/agendar/:slug" element={<Agendar />} />

            {/* v2.16.0 — Public Taller Mecánico cotización approval. Token-gated,
                no auth, rate-limited 30/min/IP via web/api/panel.js?action=wo-approve-*. */}
            <Route path="/wo/approve/:workOrderId" element={
              <React.Suspense fallback={<PageLoader />}>
                <WorkOrderApprove />
              </React.Suspense>
            } />
            <Route path="/wo/approve" element={
              <React.Suspense fallback={<PageLoader />}>
                <WorkOrderApprove />
              </React.Suspense>
            } />

            <Route path="/industrias" element={<Navigate to="/#vertical-features" replace />} />
            <Route path="/industrias/:slug" element={<IndustryPage />} />

            {/* SEO Phase-1 commercial landing pages (2026-05-18) — target top
                GSC impression-only queries: "pos", "software pos",
                "facturador gratuito", "alternativa al facturador gratuito".
                Content in packages/ui/landing/data/seoLandingPages.js. */}
            <Route path="/sistema-pos"                          element={<SeoLandingPage pageKey="sistema-pos" />} />
            <Route path="/software-pos"                         element={<SeoLandingPage pageKey="software-pos" />} />
            <Route path="/alternativa-facturador-gratuito-dgii" element={<SeoLandingPage pageKey="alternativa-facturador-gratuito-dgii" />} />
            <Route path="/facturador-electronico-dgii"          element={<SeoLandingPage pageKey="facturador-electronico-dgii" />} />

            {/* /probar/:vertical — interactive marketing demos. Pure React +
                seed data, no Supabase. Single dispatcher (Demo.jsx) loads
                the correct vertical config dynamically. Gated by signup. */}
            <Route path="/probar" element={<Navigate to="/#vertical-features" replace />} />
            <Route path="/probar/:vertical" element={<Demo />} />

            {/* e-CF Certification Portal — public, token-based */}
            <Route path="/cert/:token" element={
              <React.Suspense fallback={<PageLoader />}>
                <CertPortal />
              </React.Suspense>
            } />

            {/* Contabilidad email-invite magic-link landing. Reads ?token=X,
                resolves firm via public ctb_invite_lookup, requires Supabase
                auth to consume via ctb_accept_invite_token. */}
            <Route path="/aceptar-contador" element={
              <React.Suspense fallback={<PageLoader />}>
                <AceptarContadorRoute />
              </React.Suspense>
            } />

            {/* Invoicing app — uses same POS shell. Redirect to /pos/invoicing/*
                so the inner App.jsx Routes (which look for absolute /invoicing/...)
                actually match on the remaining path after /pos/*. */}
            <Route path="/invoicing" element={<Navigate to="/pos/invoicing" replace />} />
            <Route path="/invoicing/create" element={<Navigate to="/pos/invoicing/create" replace />} />
            <Route path="/invoicing/history" element={<Navigate to="/pos/invoicing/history" replace />} />

            {/* POS app — lazy loads everything */}
            <Route path="/pos/*" element={<POSRoute />} />

            {/* Admin panel — lazy loads Supabase */}
            <Route path="/admin/*" element={<AdminRoute />} />

            {/* Redirect bare POS routes to /pos/* */}
            <Route path="/queue" element={<Navigate to="/pos/queue" replace />} />
            <Route path="/clients" element={<Navigate to="/pos/clients" replace />} />
            <Route path="/credits" element={<Navigate to="/pos/credits" replace />} />
            <Route path="/reports" element={<Navigate to="/pos/reports" replace />} />
            <Route path="/inventory" element={<Navigate to="/pos/inventory" replace />} />
            <Route path="/conteo-fisico" element={<Navigate to="/pos/conteo-fisico" replace />} />
            <Route path="/dgii" element={<Navigate to="/pos/dgii" replace />} />
            <Route path="/cash-recon" element={<Navigate to="/pos/cash-recon" replace />} />
            <Route path="/petty-cash" element={<Navigate to="/pos/petty-cash" replace />} />
            <Route path="/credit-notes" element={<Navigate to="/pos/credit-notes" replace />} />
            <Route path="/returns" element={<Navigate to="/pos/returns" replace />} />
            <Route path="/empleados" element={<Navigate to="/pos/empleados" replace />} />
            <Route path="/contabilidad" element={<Navigate to="/pos/contabilidad" replace />} />
            <Route path="/contabilidad/:tab" element={<ContabilidadRedirect />} />
            <Route path="/config/:section" element={<ConfigRedirect />} />
            <Route path="/config" element={<Navigate to="/pos/config" replace />} />
            <Route path="/remote" element={<Navigate to="/pos/remote" replace />} />
            <Route path="/sistema" element={<Navigate to="/pos/sistema" replace />} />
            <Route path="/license-admin" element={<Navigate to="/pos/license-admin" replace />} />
            <Route path="/settings" element={<Navigate to="/pos/admin" replace />} />
            {/* v2.1+ vertical screens — same redirect pattern as the rest. */}
            <Route path="/memberships" element={<Navigate to="/pos/memberships" replace />} />
            <Route path="/resumen" element={<Navigate to="/pos/resumen" replace />} />
            <Route path="/work-orders" element={<Navigate to="/pos/work-orders" replace />} />
            <Route path="/vehicles" element={<Navigate to="/pos/vehicles" replace />} />
            <Route path="/service-bays" element={<Navigate to="/pos/service-bays" replace />} />
            <Route path="/appointments" element={<Navigate to="/pos/appointments" replace />} />
            <Route path="/stylist-schedules" element={<Navigate to="/pos/stylist-schedules" replace />} />
            <Route path="/loans" element={<Navigate to="/pos/loans" replace />} />
            <Route path="/pawn-items" element={<Navigate to="/pos/pawn-items" replace />} />
            <Route path="/lending/resumen" element={<Navigate to="/pos/lending/resumen" replace />} />
            <Route path="/lending/reporte-sb" element={<Navigate to="/pos/lending/reporte-sb" replace />} />
            <Route path="/mesas" element={<Navigate to="/pos/mesas" replace />} />
            <Route path="/menu" element={<Navigate to="/pos/menu" replace />} />
            <Route path="/menu-builder" element={<Navigate to="/pos/menu-builder" replace />} />
            <Route path="/kds" element={<Navigate to="/pos/kds" replace />} />
            {/* v2.16.3 — Restaurante: Reservas + Salón Comedor were missing
                redirects, sending restaurant clients to LandingPage on click. */}
            <Route path="/reservas" element={<Navigate to="/pos/reservas" replace />} />
            <Route path="/salon-dashboard" element={<Navigate to="/pos/salon-dashboard" replace />} />
            <Route path="/catalogo" element={<Navigate to="/pos/catalogo" replace />} />
            <Route path="/vehicle-inventory" element={<Navigate to="/pos/vehicle-inventory" replace />} />
            <Route path="/sales-pipeline" element={<Navigate to="/pos/sales-pipeline" replace />} />
            <Route path="/test-drives" element={<Navigate to="/pos/test-drives" replace />} />
            <Route path="/deal-builder" element={<Navigate to="/pos/deal-builder" replace />} />
            {/* 2026-05-03 (vertical wiring audit) — fill the same routing gap
                we hit for restaurant, this time for mecanica/salon/prestamos/
                carniceria/dealership. Each Sidebar entry must have a redirect
                here or its tab silently bounces to LandingPage via the catch-all. */}
            <Route path="/matriculas" element={<Navigate to="/pos/matriculas" replace />} />
            <Route path="/cotizaciones" element={<Navigate to="/pos/cotizaciones" replace />} />
            <Route path="/suministros" element={<Navigate to="/pos/suministros" replace />} />
            <Route path="/aseguradoras" element={<Navigate to="/pos/aseguradoras" replace />} />
            <Route path="/mecanica/resumen" element={<Navigate to="/pos/mecanica/resumen" replace />} />
            <Route path="/mecanica/productividad" element={<Navigate to="/pos/mecanica/productividad" replace />} />
            <Route path="/whatsapp-log" element={<Navigate to="/pos/whatsapp-log" replace />} />
            <Route path="/collections" element={<Navigate to="/pos/collections" replace />} />
            <Route path="/carniceria/cortes" element={<Navigate to="/pos/carniceria/cortes" replace />} />
            <Route path="/carniceria/frescura" element={<Navigate to="/pos/carniceria/frescura" replace />} />
            <Route path="/carniceria/mayoreo" element={<Navigate to="/pos/carniceria/mayoreo" replace />} />
            <Route path="/carniceria/resumen" element={<Navigate to="/pos/carniceria/resumen" replace />} />
            <Route path="/concesionario" element={<Navigate to="/pos/concesionario" replace />} />
            <Route path="/reservations" element={<Navigate to="/pos/reservations" replace />} />
            <Route path="/warranties" element={<Navigate to="/pos/warranties" replace />} />
            <Route path="/preapprovals" element={<Navigate to="/pos/preapprovals" replace />} />
            {/* v2.17 — Food Truck vertical */}
            <Route path="/ubicaciones" element={<Navigate to="/pos/ubicaciones" replace />} />
            <Route path="/mermas" element={<Navigate to="/pos/mermas" replace />} />
            <Route path="/pendientes" element={<Navigate to="/pos/pendientes" replace />} />
            <Route path="/pickup-display" element={<Navigate to="/pos/pickup-display" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<RouteNotFound />} />
          </Routes>
        </React.Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
