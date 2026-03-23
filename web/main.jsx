import React, { useState, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import App from '@/App'
import ErrorBoundary from '@/components/ErrorBoundary'
import { LangProvider } from '@/i18n'
import { AuthProvider } from '@/context/AuthContext'
import { LicenseProvider } from '@/context/LicenseContext'
import { DataProvider } from '@/context/DataContext'
import { createWebAPI, createWebPrinterAPI } from '@/data/web'
import { startOfflineSync } from '@/services/offline-queue'
import { injectSpeedInsights } from '@vercel/speed-insights'
import '@/index.css'

injectSpeedInsights()

// ---------------------------------------------------------------------------
// Supabase client (reads env vars injected by Vite)
// ---------------------------------------------------------------------------
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabase = (supabaseUrl && supabaseAnon)
  ? createClient(supabaseUrl, supabaseAnon)
  : null

// ---------------------------------------------------------------------------
// Service Worker registration
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// ---------------------------------------------------------------------------
// SupabaseAuthGate — blocks rendering until user is authenticated
// ---------------------------------------------------------------------------
function SupabaseAuthGate({ children }) {
  const [session, setSession]       = useState(null)
  const [businessId, setBusinessId] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Hooks must be called unconditionally (Rules of Hooks)
  const api = useMemo(() => businessId ? createWebAPI(supabase, businessId) : null, [businessId])
  const printerApi = useMemo(() => createWebPrinterAPI(), [])

  // Offline sync — must be before any conditional returns
  useEffect(() => {
    if (supabase && businessId) {
      return startOfflineSync(supabase, businessId)
    }
  }, [businessId])

  // Listen for auth state changes
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
      // Try staff table first (employee linked to Supabase Auth)
      let { data, error: err } = await supabase
        .from('staff')
        .select('business_id')
        .eq('auth_user_id', userId)
        .limit(1)
        .maybeSingle()

      // If not staff, check if they're a business owner
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

      if (err) throw err
      setBusinessId(data.business_id)
    } catch (e) {
      setError('No se encontro negocio asociado a esta cuenta.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) throw err
    } catch (err) {
      setError(typeof err === 'string' ? err : err?.message || 'Error al iniciar sesion')
    } finally {
      setSubmitting(false)
    }
  }

  // No Supabase configured — render app with stub API
  if (!supabase) {
    return (
      <DataProvider api={createWebAPI()} printerApi={printerApi}>
        {children}
      </DataProvider>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-lg">Cargando...</div>
      </div>
    )
  }

  // Not authenticated — show login form
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-slate-800 rounded-xl p-8 w-full max-w-sm space-y-4">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-2xl font-black text-white tracking-[3px]">TERMINAL</span>
            <img src="/icons/icon-192.png" alt="X" className="h-8 w-8 object-contain" />
          </div>
          <p className="text-slate-400 text-center text-sm">Iniciar sesion</p>
          {error && <div className="bg-red-500/20 text-red-300 text-sm p-3 rounded-lg">{error}</div>}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-slate-700 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-sky-500"
            required
          />
          <input
            type="password"
            placeholder="Contrasena"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-slate-700 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-sky-500"
            required
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
          <a
            href="/landing.html"
            className="block mt-4 text-center text-sky-400 hover:text-sky-300 text-sm transition-colors"
          >
            Ver mas sobre Terminal X
          </a>
        </form>
      </div>
    )
  }

  // Authenticated but no businessId
  if (!businessId) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-xl p-8 w-full max-w-sm text-center space-y-4">
          <h1 className="text-xl font-bold text-white">Sin negocio asignado</h1>
          <p className="text-slate-400 text-sm">{error || 'Contacte al administrador para vincular su cuenta a un negocio.'}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="px-6 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm transition-colors"
          >
            Cerrar sesion
          </button>
        </div>
      </div>
    )
  }

  // Authenticated + businessId resolved — provide data layer
  return (
    <DataProvider api={api} printerApi={printerApi}>
      {children}
    </DataProvider>
  )
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SupabaseAuthGate>
        <BrowserRouter>
          <LangProvider>
            <AuthProvider>
              <LicenseProvider>
                <App />
              </LicenseProvider>
            </AuthProvider>
          </LangProvider>
        </BrowserRouter>
      </SupabaseAuthGate>
    </ErrorBoundary>
  </React.StrictMode>
)
