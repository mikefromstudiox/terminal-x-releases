import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useLicense } from './context/LicenseContext'
import Layout from './components/Layout'
import LicenseGate from './screens/LicenseGate'
import UpdateBanner from './components/UpdateBanner'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './screens/Login'
import POS from './screens/POS'
import Queue from './screens/Queue'
import Credits from './screens/Credits'
import Clients from './screens/Clients'
import Workers from './screens/Workers'
import Services from './screens/Services'
import DGII from './screens/DGII'
import Admin from './screens/Admin'
import CashReconciliation from './screens/CashReconciliation'
import PettyCash from './screens/PettyCash'
import CreditNotes from './screens/CreditNotes'
import RemoteDashboard from './screens/RemoteDashboard'
import LicenseAdmin from './screens/LicenseAdmin'
import DailyReport from './screens/reports/DailyReport'
import MonthlyReport from './screens/reports/MonthlyReport'
import WorkerReport from './screens/reports/WorkerReport'
import SalespersonReport from './screens/reports/SalespersonReport'

export default function App() {
  const { user }                              = useAuth()
  const { result, checking, isReadOnly }     = useLicense()

  // Still loading — show minimal spinner
  if (checking && !result) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="w-12 h-12 bg-sky-500 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-white font-bold text-xl">TX</span>
          </div>
          <p className="text-slate-400 text-sm">Verificando licencia…</p>
        </div>
      </div>
    )
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
        <Route path="/credits"               element={<Credits />} />
        <Route path="/reports/daily"         element={<DailyReport />} />
        <Route path="/reports/monthly"       element={<MonthlyReport />} />
        <Route path="/reports/workers"       element={<WorkerReport />} />
        <Route path="/reports/salesperson"   element={<SalespersonReport />} />
        <Route path="/cash-recon"            element={<CashReconciliation />} />
        <Route path="/dgii"                  element={<DGII />} />
        <Route path="/petty-cash"            element={<PettyCash />} />
        <Route path="/credit-notes"          element={<CreditNotes />} />
        <Route path="/admin"                 element={<Admin />} />
        <Route path="/remote"                element={<RemoteDashboard />} />
        <Route path="/license-admin"         element={<LicenseAdmin />} />
        {/* Legacy routes */}
        <Route path="/workers"               element={<Workers />} />
        <Route path="/services"              element={<Services />} />
        <Route path="/settings"              element={<Admin />} />
        <Route path="*"                      element={<Navigate to="/pos" replace />} />
      </Routes>
      </ErrorBoundary>
    </Layout>
    </>
  )
}
