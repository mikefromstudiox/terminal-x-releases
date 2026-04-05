import React, { useState, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import App from '@/App'
import ErrorBoundary from '@/components/ErrorBoundary'
import { LangProvider } from '@/i18n'
import { AuthProvider } from '@/context/AuthContext'
import { LicenseProvider } from '@/context/LicenseContext'
import { DataProvider } from '@/context/DataContext'
import { PlanProvider } from '@/hooks/usePlan.jsx'
import { createWebAPI, createWebPrinterAPI } from '@terminal-x/data/web'
import { startOfflineSync } from '@terminal-x/services/offline-queue'
import { injectSpeedInsights } from '@vercel/speed-insights'
import '@/index.css'
import xMark from '@/assets/x-mark.png'

// Lazy load landing and admin (code-split)
const LandingPage = React.lazy(() => import('@/landing/LandingPage'))
const SignupPage  = React.lazy(() => import('@/landing/SignupPage'))
const AdminApp    = React.lazy(() => import('@/admin/AdminApp'))

injectSpeedInsights()

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabase = (supabaseUrl && supabaseAnon)
  ? createClient(supabaseUrl, supabaseAnon)
  : null

// Expose for admin/signup pages
export { supabase }

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
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-white text-lg">Cargando...</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SupabaseAuthGate — blocks POS rendering until user is authenticated
// ---------------------------------------------------------------------------
function SupabaseAuthGate({ children }) {
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

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s) fetchBusinessId(s.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s) fetchBusinessId(s.user.id)
      else { setBusinessId(null); setLoading(false) }
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
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) throw err
    } catch (err) {
      setError(typeof err === 'string' ? err : err?.message || 'Error al iniciar sesion')
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
              <img src={xMark} alt="X" className="h-28 w-28 object-contain mt-1" />
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

  return (
    <DataProvider api={api} printerApi={printerApi}>
      {children}
    </DataProvider>
  )
}

// ---------------------------------------------------------------------------
// Mount — Top-level router: landing (public), /pos (auth), /admin (admin auth)
// ---------------------------------------------------------------------------
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <React.Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public landing pages */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/pricing" element={<LandingPage section="pricing" />} />
            <Route path="/signup" element={<SignupPage supabase={supabase} />} />

            {/* POS app (auth required) */}
            <Route path="/pos/*" element={
              <SupabaseAuthGate>
                <LangProvider>
                  <AuthProvider>
                    <LicenseProvider>
                      <PlanProvider>
                        <App />
                      </PlanProvider>
                    </LicenseProvider>
                  </AuthProvider>
                </LangProvider>
              </SupabaseAuthGate>
            } />

            {/* Admin panel */}
            <Route path="/admin/*" element={<LangProvider><AdminApp supabase={supabase} /></LangProvider>} />

            {/* Legacy redirect: old root POS users go to /pos */}
            <Route path="/queue" element={<Navigate to="/pos/queue" replace />} />
            <Route path="/clients" element={<Navigate to="/pos/clients" replace />} />
            <Route path="/credits" element={<Navigate to="/pos/credits" replace />} />
            <Route path="/settings" element={<Navigate to="/pos/admin" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </React.Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
