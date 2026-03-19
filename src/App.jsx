import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
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
import DailyReport from './screens/reports/DailyReport'
import MonthlyReport from './screens/reports/MonthlyReport'
import WorkerReport from './screens/reports/WorkerReport'
import SalespersonReport from './screens/reports/SalespersonReport'

// Routes accessible only to non-cashier roles
const RESTRICTED = ['/credits','/reports','/cash-recon','/dgii','/petty-cash','/credit-notes','/admin','/remote','/license-admin','/sistema']

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
          <img src="/assets/logo.png" alt="TX" className="w-8 h-8 object-contain" />
        </div>
        <p className="text-zinc-500 text-sm">Cargando...</p>
      </div>
    </div>
  )
}

export default function App() {
  const { user }                          = useAuth()
  const { result, checking, isReadOnly } = useLicense()

  // ── First-run detection ─────────────────────────────────────────────────────
  const [setupChecked, setSetupChecked] = useState(false)
  const [isFirstRun,   setIsFirstRun]   = useState(false)

  useEffect(() => {
    async function checkFirstRun() {
      try {
        const empresa = await window.electronAPI?.admin?.getEmpresa?.()
        setIsFirstRun(!empresa)
      } catch {
        setIsFirstRun(false)   // IPC unavailable (dev/web) — skip setup
      } finally {
        setSetupChecked(true)
      }
    }
    checkFirstRun()
  }, [])

  // ── Startup gate: wait for both setup check and license check ──────────────
  if (!setupChecked || (checking && !result)) return <Spinner />

  // ── First-run wizard ────────────────────────────────────────────────────────
  if (isFirstRun) {
    return <FirstTimeSetup onComplete={() => setIsFirstRun(false)} />  // setIsFirstRun(false) = setAppState('login')
  }

  // License missing or invalid (not just expired) → show gate
  const blockingStatuses = ['no_key', 'not_found', 'invalid_format', 'hardware_mismatch', 'inactive', 'suspended']
  if (!result || blockingStatuses.includes(result.status)) {
    return <LicenseGate />
  }

  // Expired beyond grace period → show gate in expired mode (read-only bypass available)
  if (result.status === 'expired') {
    // App still renders but isReadOnly = true + expired banner shown
    // The LicenseGate for expired shows a continue-in-read-only option handled within LicenseGate
    // We show the expired gate unless user explicitly chose read-only mode
    const readOnlyChosen = sessionStorage.getItem('tx_read_only_chosen')
    if (!readOnlyChosen) {
      return <LicenseGate />
    }
  }

  if (!user) return <Login />

  return (
    <>
    <UpdateBanner />
    <Layout>
      <ErrorBoundary>
      <Routes>
        <Route path="/"                      element={<Navigate to="/pos" replace />} />
        <Route path="/pos"                   element={<POS />} />
        <Route path="/queue"                 element={<Queue />} />
        <Route path="/clients"               element={<Clients />} />
        <Route path="/credits"               element={<ProtectedRoute element={<Credits />} />} />
        <Route path="/reports/daily"         element={<ProtectedRoute element={<DailyReport />} />} />
        <Route path="/reports/monthly"       element={<ProtectedRoute element={<MonthlyReport />} />} />
        <Route path="/reports/workers"       element={<ProtectedRoute element={<WorkerReport />} />} />
        <Route path="/reports/salesperson"   element={<ProtectedRoute element={<SalespersonReport />} />} />
        <Route path="/cash-recon"            element={<ProtectedRoute element={<CashReconciliation />} />} />
        <Route path="/dgii"                  element={<ProtectedRoute element={<DGII />} />} />
        <Route path="/petty-cash"            element={<ProtectedRoute element={<PettyCash />} />} />
        <Route path="/credit-notes"          element={<ProtectedRoute element={<CreditNotes />} />} />
        <Route path="/admin"                 element={<ProtectedRoute element={<Admin />} />} />
        <Route path="/remote"                element={<ProtectedRoute element={<RemoteDashboard />} />} />
        <Route path="/license-admin"         element={<ProtectedRoute element={<LicenseAdmin />} />} />
        <Route path="/sistema"               element={<ProtectedRoute element={<Sistema />} />} />
        {/* Legacy routes — redirect to canonical destinations */}
        <Route path="/workers"               element={<Navigate to="/reports/workers" replace />} />
        <Route path="/services"              element={<Navigate to="/admin" replace />} />
        <Route path="/settings"              element={<Navigate to="/admin" replace />} />
        <Route path="*"                      element={<Navigate to="/pos" replace />} />
      </Routes>
      </ErrorBoundary>
    </Layout>
    </>
  )
}
