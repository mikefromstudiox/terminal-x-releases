import React, { useState, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import ErrorBoundary from '@/components/ErrorBoundary'
import '@/index.css'
import xMark from '@/assets/x-mark.webp'

// Landing page eager-loaded (it's the entry route — must render fast for LCP)
import LandingPage from '@/landing/LandingPage'

// Everything else lazy
const SignupPage  = React.lazy(() => import('@/landing/SignupPage'))
const AdminApp    = React.lazy(() => import('@/admin/AdminApp'))
const CertPortal  = React.lazy(() => import('@/portal/CertPortal'))

// Lazy load Supabase — only resolves when needed (saves 172KB on landing page)
let _supabase = null
const supabaseReady = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  ? import('@supabase/supabase-js').then(({ createClient }) => {
      _supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
      // Expose the SAME client instance globally so AuthContext.logout() can
      // call supabase.auth.signOut() on the exact session that SupabaseAuthGate
      // is tracking. Without this, logout was signing out a different client
      // instance and the gate never flipped back to the sign-in screen.
      if (typeof window !== 'undefined') window.__txSupabase = _supabase
      return _supabase
    })
  : Promise.resolve(null)

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
    import('@terminal-x/data/web'),
    import('@terminal-x/services/offline-queue'),
    supabaseReady,
  ]).then(([App, i18n, Auth, License, Data, Plan, BizType, WebData, Offline]) => ({
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
                    <App.default />
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
    // One-shot guard in sessionStorage so we don't loop forever if something
    // else is genuinely broken
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
})
window.addEventListener('unhandledrejection', (event) => {
  handleChunkLoadError(event.reason)
})

// ---------------------------------------------------------------------------
// Service Worker
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

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
  const [session, setSession]       = useState(null)
  const [businessId, setBusinessId] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [submitting, setSubmitting] = useState(false)

  const api = useMemo(() => businessId ? createWebAPI(supabase, businessId) : null, [businessId])
  const printerApi = useMemo(() => createWebPrinterAPI(), [])

  useEffect(() => {
    if (supabase && businessId) {
      return startOfflineSync(supabase, businessId)
    }
  }, [businessId])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }

    // Consume any in-flight logout flag — the moment the gate (re)mounts and
    // discovers no session, the post-logout cleanup is finished and downstream
    // contexts are free to behave normally again on the next sign-in.
    function clearLogoutFlag() {
      try { sessionStorage.removeItem('tx_logging_out') } catch {}
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s) fetchBusinessId(s.user.id)
      else { clearLogoutFlag(); setLoading(false) }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s) fetchBusinessId(s.user.id)
      else { clearLogoutFlag(); setBusinessId(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchBusinessId(userId) {
    try {
      let { data, error: err } = await supabase
        .from('staff')
        .select('business_id')
        .eq('auth_user_id', userId)
        .limit(1)
        .maybeSingle()

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
              className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
          </div>
          <div>
            <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Contrasena</label>
            <input type="password" placeholder="Tu contrasena" value={password} onChange={e => setPassword(e.target.value)}
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

  // Need to import DataProvider from the lazy-loaded module
  const DataProvider = React.lazy(() => import('@/context/DataContext').then(m => ({ default: m.DataProvider })))

  return (
    <React.Suspense fallback={<PageLoader />}>
      <DataProvider api={api} printerApi={printerApi}>
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
    supabaseReady,
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
    supabaseReady,
  ]).then(([SignupPage]) => ({
    default: function SignupShell() {
      return <SignupPage.default supabase={_supabase} />
    }
  }))
)

function ConfigRedirect() {
  const { section } = useParams()
  return <Navigate to={`/pos/config/${section}`} replace />
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <React.Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public landing pages — no Supabase needed */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/pricing" element={<LandingPage section="pricing" />} />

            {/* Signup — lazy loads Supabase */}
            <Route path="/signup" element={<SignupRoute />} />

            {/* e-CF Certification Portal — public, token-based */}
            <Route path="/cert/:token" element={
              <React.Suspense fallback={<PageLoader />}>
                <CertPortal />
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
            <Route path="/dgii" element={<Navigate to="/pos/dgii" replace />} />
            <Route path="/cash-recon" element={<Navigate to="/pos/cash-recon" replace />} />
            <Route path="/petty-cash" element={<Navigate to="/pos/petty-cash" replace />} />
            <Route path="/credit-notes" element={<Navigate to="/pos/credit-notes" replace />} />
            <Route path="/empleados" element={<Navigate to="/pos/empleados" replace />} />
            <Route path="/config/:section" element={<ConfigRedirect />} />
            <Route path="/config" element={<Navigate to="/pos/config" replace />} />
            <Route path="/remote" element={<Navigate to="/pos/remote" replace />} />
            <Route path="/sistema" element={<Navigate to="/pos/sistema" replace />} />
            <Route path="/license-admin" element={<Navigate to="/pos/license-admin" replace />} />
            <Route path="/settings" element={<Navigate to="/pos/admin" replace />} />
            {/* v2.1+ vertical screens — same redirect pattern as the rest. */}
            <Route path="/memberships" element={<Navigate to="/pos/memberships" replace />} />
            <Route path="/work-orders" element={<Navigate to="/pos/work-orders" replace />} />
            <Route path="/vehicles" element={<Navigate to="/pos/vehicles" replace />} />
            <Route path="/service-bays" element={<Navigate to="/pos/service-bays" replace />} />
            <Route path="/appointments" element={<Navigate to="/pos/appointments" replace />} />
            <Route path="/stylist-schedules" element={<Navigate to="/pos/stylist-schedules" replace />} />
            <Route path="/loans" element={<Navigate to="/pos/loans" replace />} />
            <Route path="/pawn-items" element={<Navigate to="/pos/pawn-items" replace />} />
            <Route path="/mesas" element={<Navigate to="/pos/mesas" replace />} />
            <Route path="/menu" element={<Navigate to="/pos/menu" replace />} />
            <Route path="/menu-builder" element={<Navigate to="/pos/menu-builder" replace />} />
            <Route path="/kds" element={<Navigate to="/pos/kds" replace />} />
            <Route path="/vehicle-inventory" element={<Navigate to="/pos/vehicle-inventory" replace />} />
            <Route path="/sales-pipeline" element={<Navigate to="/pos/sales-pipeline" replace />} />
            <Route path="/test-drives" element={<Navigate to="/pos/test-drives" replace />} />
            <Route path="/deal-builder" element={<Navigate to="/pos/deal-builder" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </React.Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
