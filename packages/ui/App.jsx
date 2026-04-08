import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import logoImg from './assets/logo.webp'
import { useState, useEffect, lazy, Suspense } from 'react'
import { useAPI } from './context/DataContext'
import { setStoredSetting, getStoredSetting } from '@terminal-x/services/supabase'

// Pre-load Supabase credentials so Remote Dashboard works without manual config
if (import.meta.env.DEV) {
  const devUrl = import.meta.env.VITE_DEV_SUPABASE_URL
  const devKey = import.meta.env.VITE_DEV_SUPABASE_KEY
  if (devUrl && !getStoredSetting('supabase_url')) {
    setStoredSetting('supabase_url', devUrl)
    setStoredSetting('business_id', '') // force re-register when credentials are new
  }
  if (devKey && !getStoredSetting('supabase_anon_key')) setStoredSetting('supabase_anon_key', devKey)
}
// Production Electron: auto-populate from .env via IPC if not already set
if (window.electronAPI?.env?.get && !getStoredSetting('supabase_url')) {
  Promise.all([
    window.electronAPI.env.get('supabaseUrl'),
    window.electronAPI.env.get('supabaseAnon'),
  ]).then(([url, key]) => {
    if (url && !getStoredSetting('supabase_url'))      setStoredSetting('supabase_url', url)
    if (key && !getStoredSetting('supabase_anon_key')) setStoredSetting('supabase_anon_key', key)
  }).catch(() => {})
}
import { useAuth } from './context/AuthContext'
import { useLicense } from './context/LicenseContext'
import Layout from './components/Layout'
import UpdateBanner from './components/UpdateBanner'
import ErrorBoundary from './components/ErrorBoundary'
import PlanGate from './components/PlanGate'

// Eager — auth/gate screens only (shown on startup)
import LicenseGate from './screens/LicenseGate'
import FirstTimeSetup from './screens/FirstTimeSetup'
import Login from './screens/Login'

// Lazy — all feature screens (loaded on navigation)
const POS                 = lazy(() => import('./screens/POS'))
const Queue               = lazy(() => import('./screens/Queue'))
const Clients             = lazy(() => import('./screens/Clients'))
const Credits             = lazy(() => import('./screens/Credits'))
const DGII                = lazy(() => import('./screens/DGII'))
const Admin               = lazy(() => import('./screens/Admin'))
const Config              = lazy(() => import('./screens/Config'))
const CashReconciliation  = lazy(() => import('./screens/CashReconciliation'))
const PettyCash           = lazy(() => import('./screens/PettyCash'))
const CreditNotes         = lazy(() => import('./screens/CreditNotes'))
const RemoteDashboard     = lazy(() => import('./screens/RemoteDashboard'))
const LicenseAdmin        = lazy(() => import('./screens/LicenseAdmin'))
const Sistema             = lazy(() => import('./screens/Sistema'))
const Inventory           = lazy(() => import('./screens/Inventory'))
const Reportes            = lazy(() => import('./screens/Reportes'))

// Routes accessible only to non-cashier roles
const RESTRICTED = ['/credits','/reports','/cash-recon','/dgii','/petty-cash','/credit-notes','/admin','/remote','/license-admin','/sistema','/inventory','/config']

function ProtectedRoute({ element }) {
  const { user } = useAuth()
  const location = useLocation()
  const restricted = RESTRICTED.some(p => location.pathname.startsWith(p))
  if (restricted && user?.role === 'cashier') return <Navigate to="/pos" replace />
  return element
}

// ── Startup spinner ───────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <div className="text-center">
        <div className="w-12 h-12 bg-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <img src={logoImg} alt="TX" className="w-8 h-8 object-contain" />
        </div>
        <p className="text-zinc-500 text-sm">Cargando...</p>
      </div>
    </div>
  )
}

export default function App() {
  const api = useAPI()
  const { user }                          = useAuth()
  const { result, checking, isReadOnly } = useLicense()

  // ── First-run detection ─────────────────────────────────────────────────────
  const [setupChecked, setSetupChecked] = useState(false)
  const [isFirstRun,   setIsFirstRun]   = useState(false)

  useEffect(() => {
    async function checkFirstRun() {
      try {
        const empresa = await api?.admin?.getEmpresa?.()
        if (!empresa) { setIsFirstRun(true); return }
        // Also check if any users exist — if setup completed but user creation failed, re-run setup
        const users = await api?.admin?.getUsuarios?.()
        if (!users || users.length === 0) { setIsFirstRun(true); return }
        setIsFirstRun(false)
      } catch {
        // On desktop: if DB fails, still show setup (will surface the real error there)
        // On web: skip setup (Supabase auth handles identity)
        setIsFirstRun(!!window.electronAPI)
      } finally {
        setSetupChecked(true)
      }
    }
    checkFirstRun()
  }, [])


  // ── Startup gate: wait for both setup check and license check ──────────────
  const isWeb = !window.electronAPI
  if (!setupChecked || (!isWeb && checking && !result)) return <Spinner />

  // ── First-run wizard ────────────────────────────────────────────────────────
  if (isFirstRun && !import.meta.env.DEV && !isWeb) {
    return <FirstTimeSetup onComplete={() => setIsFirstRun(false)} />  // setIsFirstRun(false) = setAppState('login')
  }

  // Skip license gate in dev mode and on web (web uses Supabase auth, not license keys)
  if (!import.meta.env.DEV && !isWeb) {
    // License missing or invalid (not just expired) → show gate
    const blockingStatuses = ['no_key', 'not_found', 'invalid_format', 'hardware_mismatch', 'rnc_mismatch', 'inactive', 'suspended', 'pending']
    if (!result || blockingStatuses.includes(result.status)) {
      return <LicenseGate />
    }

    // Expired beyond grace period → show gate in expired mode (read-only bypass available)
    if (result.status === 'expired') {
      const readOnlyChosen = sessionStorage.getItem('tx_read_only_chosen')
      if (!readOnlyChosen) {
        return <LicenseGate />
      }
    }
  }

  // On web, Supabase auth already handled login — skip PIN screen
  if (!user && !isWeb) return <Login />

  return (
    <>
    <UpdateBanner />
    <Layout>
      <ErrorBoundary>
      <Suspense fallback={
        <div className="flex items-center justify-center h-full">
          <div className="w-8 h-8 border-2 border-white/10 border-t-[#b3001e] rounded-full animate-spin" />
        </div>
      }>
      <Routes>
        <Route path="/"                      element={<POS />} />
        <Route path="/pos"                   element={<POS />} />
        <Route path="/queue"                 element={<Queue />} />
        <Route path="/clients"               element={<Clients />} />
        <Route path="/credits"               element={<ProtectedRoute element={<PlanGate feature="credits"><Credits /></PlanGate>} />} />
        <Route path="/reports"              element={<ProtectedRoute element={<PlanGate feature="reports"><Reportes /></PlanGate>} />} />
        <Route path="/reports/daily"         element={<Navigate to="/reports" replace />} />
        <Route path="/reports/monthly"       element={<Navigate to="/reports" replace />} />
        <Route path="/reports/workers"       element={<Navigate to="/reports" replace />} />
        <Route path="/reports/salesperson"   element={<Navigate to="/reports" replace />} />
        <Route path="/inventory"             element={<ProtectedRoute element={<PlanGate feature="inventory"><Inventory /></PlanGate>} />} />
        <Route path="/cash-recon"            element={<ProtectedRoute element={<PlanGate feature="cash_recon"><CashReconciliation /></PlanGate>} />} />
        <Route path="/dgii"                  element={<ProtectedRoute element={<PlanGate feature="dgii"><DGII /></PlanGate>} />} />
        <Route path="/petty-cash"            element={<ProtectedRoute element={<PlanGate feature="petty_cash"><PettyCash /></PlanGate>} />} />
        <Route path="/credit-notes"          element={<ProtectedRoute element={<PlanGate feature="credit_notes"><CreditNotes /></PlanGate>} />} />
        <Route path="/config/:section"         element={<ProtectedRoute element={<Config />} />} />
        <Route path="/config"                element={<ProtectedRoute element={<Config />} />} />
        <Route path="/admin"                 element={<ProtectedRoute element={<Admin />} />} />
        <Route path="/remote"                element={<ProtectedRoute element={<PlanGate feature="remote_dashboard"><RemoteDashboard /></PlanGate>} />} />
        <Route path="/license-admin"         element={<ProtectedRoute element={<LicenseAdmin />} />} />
        <Route path="/sistema"               element={<ProtectedRoute element={<Sistema />} />} />
        {/* Legacy routes — redirect to canonical destinations */}
        <Route path="/workers"               element={<Navigate to="/reports/workers" replace />} />
        <Route path="/services"              element={<Navigate to="/admin" replace />} />
        <Route path="/settings"              element={<Navigate to="/admin" replace />} />
        <Route path="*"                      element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </Layout>
    </>
  )
}
