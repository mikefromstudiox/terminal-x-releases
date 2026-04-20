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
import KioskLock from './components/KioskLock'
import ErrorBoundary from './components/ErrorBoundary'
import PlanGate from './components/PlanGate'

// Eager — auth/gate screens only (shown on startup)
import LicenseGate from './screens/LicenseGate'
import FirstTimeSetup from './screens/FirstTimeSetup'
import Login from './screens/Login'
import FirstPullSpinner from './components/FirstPullSpinner'

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
const Returns             = lazy(() => import('./screens/Returns'))
const RemoteDashboard     = lazy(() => import('./screens/RemoteDashboard'))
// LicenseAdmin removed — dead code (API key auth never matched Supabase JWT backend)
const Sistema             = lazy(() => import('./screens/Sistema'))
const Inventory           = lazy(() => import('./screens/Inventory'))
const InventoryCount      = lazy(() => import('./screens/inventory/InventoryCount'))
const Reportes            = lazy(() => import('./screens/Reportes'))
const Empleados           = lazy(() => import('./screens/reports/nomina'))
const Mesas               = lazy(() => import('./screens/restaurant/Mesas'))
const MenuBuilder         = lazy(() => import('./screens/restaurant/MenuBuilder'))
const HybridCatalogo      = lazy(() => import('./screens/hybrid/Catalogo'))
const KDS                 = lazy(() => import('./screens/restaurant/KDS'))
const WorkOrders          = lazy(() => import('./screens/mechanic/WorkOrders'))
const Vehicles            = lazy(() => import('./screens/mechanic/Vehicles'))
const ServiceBays         = lazy(() => import('./screens/mechanic/ServiceBays'))
const Appointments        = lazy(() => import('./screens/salon/Appointments'))
const StylistSchedules    = lazy(() => import('./screens/salon/StylistSchedules'))
const VehicleInventory    = lazy(() => import('./screens/dealership/VehicleInventory'))
const SalesPipeline       = lazy(() => import('./screens/dealership/SalesPipeline'))
const TestDrives          = lazy(() => import('./screens/dealership/TestDrives'))
const DealBuilder         = lazy(() => import('./screens/dealership/DealBuilder'))
const Loans               = lazy(() => import('./screens/lending/Loans'))
const PawnItems           = lazy(() => import('./screens/lending/PawnItems'))
const Collections         = lazy(() => import('./screens/lending/Collections'))
const Memberships         = lazy(() => import('./screens/carwash/Memberships'))
const ServiceHub          = lazy(() => import('./screens/service/ServiceHub'))
const InvoiceDashboard    = lazy(() => import('./screens/invoicing/InvoiceDashboard'))
const InvoiceCreate       = lazy(() => import('./screens/invoicing/InvoiceCreate'))
const InvoiceList         = lazy(() => import('./screens/invoicing/InvoiceList'))

// Routes accessible only to non-cashier roles
const RESTRICTED = ['/credits','/reports','/cash-recon','/dgii','/petty-cash','/credit-notes','/admin','/remote','/license-admin','/sistema','/inventory','/conteo-fisico','/config']

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
        <img src={logoImg} alt="Terminal X" className="w-60 h-60 object-contain mx-auto mb-6" />
        <div className="w-8 h-8 mx-auto border-2 border-zinc-800 border-t-[#b3001e] rounded-full animate-spin" />
      </div>
    </div>
  )
}

export default function App() {
  const api = useAPI()
  const { user, webChecked }               = useAuth()
  const { result, checking, isReadOnly, firstPullDone } = useLicense()

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
  if (!setupChecked || !webChecked || (!isWeb && checking && !result)) return <Spinner />

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

  // F16 — block the Login screen until the initial pull resolves so PIN
  // entry doesn't happen against an empty SQLite (which silently rejects
  // every PIN). Desktop-only: web uses Supabase auth directly. We check
  // `!setupChecked || users.length === 0` implicitly via the fact that a
  // returning user has empresa + users already, so the pull is background
  // and firstPullDone flips synchronously. For the fresh-install / wiped
  // case, runCheck() awaits the pull so firstPullDone stays false until
  // resolution. Dev mode + web always skip this gate.
  if (!user && !isWeb && result?.valid && !firstPullDone && !import.meta.env.DEV) {
    // Only block when the local DB is actually empty of users — otherwise
    // the returning-user path would stall every app launch for 15-60s.
    // We can't call an async IPC synchronously here, so we use a heuristic:
    // if the license just activated (no tx_last_valid timestamp set prior
    // to this render cycle), block; otherwise, don't.
    let priorValidMs = 0
    try { priorValidMs = Number(localStorage.getItem('tx_last_valid') || '0') } catch {}
    const justActivated = priorValidMs === 0 || (Date.now() - priorValidMs) > (72 * 60 * 60 * 1000)
    if (justActivated) return <FirstPullSpinner />
  }

  // No authenticated user — show PIN login (web and desktop)
  if (!user) return <Login />

  // Fullscreen KDS — render without Layout chrome (sidebar/header). Mirrors
  // how <Login /> is returned outside Layout above. Plan-gated identically.
  if (window.location.pathname === '/kds') {
    return (
      <Suspense fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-black">
          <div className="w-8 h-8 border-2 border-white/10 border-t-[#b3001e] rounded-full animate-spin" />
        </div>
      }>
        <Routes>
          <Route path="/kds" element={<PlanGate feature="restaurant_mode"><KDS /></PlanGate>} />
        </Routes>
      </Suspense>
    )
  }

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
        <Route path="/conteo-fisico"         element={<ProtectedRoute element={<PlanGate feature="inventory"><InventoryCount /></PlanGate>} />} />
        <Route path="/mesas"                 element={<PlanGate feature="restaurant_mode"><Mesas /></PlanGate>} />
        <Route path="/menu-builder"          element={<ProtectedRoute element={<PlanGate feature="restaurant_mode"><MenuBuilder /></PlanGate>} />} />
        <Route path="/catalogo"              element={<ProtectedRoute element={<HybridCatalogo />} />} />
        <Route path="/cash-recon"            element={<ProtectedRoute element={<PlanGate feature="cash_recon"><CashReconciliation /></PlanGate>} />} />
        <Route path="/empleados"             element={<ProtectedRoute element={<Empleados />} />} />
        <Route path="/dgii"                  element={<ProtectedRoute element={<PlanGate feature="dgii"><DGII /></PlanGate>} />} />
        <Route path="/petty-cash"            element={<ProtectedRoute element={<PlanGate feature="petty_cash"><PettyCash /></PlanGate>} />} />
        <Route path="/credit-notes"          element={<ProtectedRoute element={<PlanGate feature="credit_notes"><CreditNotes /></PlanGate>} />} />
        <Route path="/returns"               element={<ProtectedRoute element={<PlanGate feature="credit_notes"><Returns /></PlanGate>} />} />
        <Route path="/config/:section"         element={<ProtectedRoute element={<Config />} />} />
        <Route path="/config"                element={<ProtectedRoute element={<Config />} />} />
        <Route path="/admin"                 element={<ProtectedRoute element={<Admin />} />} />
        <Route path="/remote"                element={<ProtectedRoute element={<PlanGate feature="remote_dashboard"><RemoteDashboard /></PlanGate>} />} />
        {/* LicenseAdmin route removed — dead code */}
        <Route path="/sistema"               element={<ProtectedRoute element={<Sistema />} />} />
        <Route path="/work-orders" element={<ProtectedRoute element={<PlanGate feature="work_orders"><WorkOrders /></PlanGate>} />} />
        <Route path="/vehicles" element={<ProtectedRoute element={<PlanGate feature="vehicles"><Vehicles /></PlanGate>} />} />
        <Route path="/service-bays" element={<ProtectedRoute element={<PlanGate feature="service_bays"><ServiceBays /></PlanGate>} />} />
        <Route path="/appointments" element={<ProtectedRoute element={<PlanGate feature="appointments"><Appointments /></PlanGate>} />} />
        <Route path="/stylist-schedules" element={<ProtectedRoute element={<PlanGate feature="appointments"><StylistSchedules /></PlanGate>} />} />
        <Route path="/loans" element={<ProtectedRoute element={<PlanGate feature="loans"><Loans /></PlanGate>} />} />
        <Route path="/pawn-items" element={<ProtectedRoute element={<PlanGate feature="pawn_items"><PawnItems /></PlanGate>} />} />
        <Route path="/collections" element={<ProtectedRoute element={<PlanGate feature="loans"><Collections /></PlanGate>} />} />
        <Route path="/memberships" element={<ProtectedRoute element={<Memberships />} />} />
        <Route path="/servicios" element={<ProtectedRoute element={<ServiceHub />} />} />
        <Route path="/vehicle-inventory" element={<ProtectedRoute element={<VehicleInventory />} />} />
        <Route path="/sales-pipeline"    element={<ProtectedRoute element={<SalesPipeline />} />} />
        <Route path="/test-drives"       element={<ProtectedRoute element={<TestDrives />} />} />
        <Route path="/deal-builder"      element={<ProtectedRoute element={<DealBuilder />} />} />
        <Route path="/invoicing" element={<ProtectedRoute element={<PlanGate feature="invoicing"><InvoiceDashboard /></PlanGate>} />} />
        <Route path="/invoicing/create" element={<ProtectedRoute element={<PlanGate feature="invoicing"><InvoiceCreate /></PlanGate>} />} />
        <Route path="/invoicing/history" element={<ProtectedRoute element={<PlanGate feature="invoicing"><InvoiceList /></PlanGate>} />} />
        {/* Legacy routes — redirect to canonical destinations */}
        <Route path="/workers"               element={<Navigate to="/reports/workers" replace />} />
        <Route path="/services"              element={<Navigate to="/admin" replace />} />
        <Route path="/settings"              element={<Navigate to="/admin" replace />} />
        <Route path="*"                      element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </Layout>
    <KioskLock />
    </>
  )
}
