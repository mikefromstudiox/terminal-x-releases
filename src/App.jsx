import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import logoImg from './assets/logo.png'
import { useState, useEffect } from 'react'
import { useAPI } from './context/DataContext'
import { setStoredSetting, getStoredSetting } from './services/supabase'
import { startSyncScheduler, stopSyncScheduler } from './services/sync'

// In dev mode, pre-load Supabase credentials from .env so Remote Dashboard works immediately
if (import.meta.env.DEV) {
  const devUrl = import.meta.env.VITE_DEV_SUPABASE_URL
  const devKey = import.meta.env.VITE_DEV_SUPABASE_KEY
  if (devUrl && !getStoredSetting('supabase_url')) {
    setStoredSetting('supabase_url', devUrl)
    setStoredSetting('business_id', '') // force re-register when credentials are new
  }
  if (devKey && !getStoredSetting('supabase_anon_key')) setStoredSetting('supabase_anon_key', devKey)
}
import { useAuth } from './context/AuthContext'
import { useLicense } from './context/LicenseContext'
import Layout from './components/Layout'
import LicenseGate from './screens/LicenseGate'
import UpdateBanner from './components/UpdateBanner'
import ErrorBoundary from './components/ErrorBoundary'
import FirstTimeSetup from './screens/FirstTimeSetup'
import Login from './screens/Login'
import POS from './screens/POS'
import Queue from './screens/Queue'
import Credits from './screens/Credits'
import Clients from './screens/Clients'
// Workers and Services are legacy routes — now redirect, imports not needed
// import Workers from './screens/Workers'
// import Services from './screens/Services'
import DGII from './screens/DGII'
import Admin from './screens/Admin'
import CashReconciliation from './screens/CashReconciliation'
import PettyCash from './screens/PettyCash'
import CreditNotes from './screens/CreditNotes'
import RemoteDashboard from './screens/RemoteDashboard'
import LicenseAdmin from './screens/LicenseAdmin'
import Sistema from './screens/Sistema'
import Inventory from './screens/Inventory'
import DailyReport from './screens/reports/DailyReport'
import MonthlyReport from './screens/reports/MonthlyReport'
import WorkerReport from './screens/reports/WorkerReport'
import SalespersonReport from './screens/reports/SalespersonReport'
import Reportes from './screens/Reportes'
import PlanGate from './components/PlanGate'

// Routes accessible only to non-cashier roles
const RESTRICTED = ['/credits','/reports','/cash-recon','/dgii','/petty-cash','/credit-notes','/admin','/remote','/license-admin','/sistema','/inventory']

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
        setIsFirstRun(!empresa)
      } catch {
        setIsFirstRun(false)   // IPC unavailable (dev/web) — skip setup
      } finally {
        setSetupChecked(true)
      }
    }
    checkFirstRun()
  }, [])

  // ── Background sync: desktop SQLite → Supabase (every 15 min) ──────────────
  useEffect(() => {
    if (user && api) startSyncScheduler(api)
    return () => stopSyncScheduler()
  }, [user, api])

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
    const blockingStatuses = ['no_key', 'not_found', 'invalid_format', 'hardware_mismatch', 'inactive', 'suspended']
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
      </ErrorBoundary>
    </Layout>
    </>
  )
}
