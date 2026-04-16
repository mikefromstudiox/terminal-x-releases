import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useAPI } from '../context/DataContext'
import { useLicense } from '../context/LicenseContext'

const PLAN_FEATURES = {
  facturacion: ['invoicing', 'ecf', 'dgii', 'clients', 'reports'],
  pro:       ['pos', 'queue', 'clients', 'credits', 'reports', 'petty_cash', 'credit_notes', 'cash_recon', 'commissions', 'inventory', 'invoicing'],
  pro_plus:  ['pos', 'queue', 'clients', 'credits', 'reports', 'petty_cash', 'credit_notes', 'cash_recon', 'commissions', 'inventory', 'ecf', 'dgii', 'restaurant_mode', 'work_orders', 'appointments', 'service_bays', 'loans', 'vehicles', 'invoicing'],
  pro_max:   ['pos', 'queue', 'clients', 'credits', 'reports', 'petty_cash', 'credit_notes', 'cash_recon', 'commissions', 'ecf', 'dgii', 'inventory', 'remote_dashboard', 'whatsapp_receipts', 'multi_location', 'nomina_advanced', 'restaurant_mode', 'work_orders', 'appointments', 'service_bays', 'loans', 'vehicles', 'pawn_items', 'loan_analytics', 'vehicle_history', 'stylist_schedules', 'invoicing'],
}

const PLAN_DISPLAY = { facturacion: 'Facturacion', pro: 'Pro', pro_plus: 'Pro PLUS', pro_max: 'Pro MAX' }

const PlanContext = createContext(null)

// Dev override: force Pro MAX in vite dev mode so all features are visible
// without touching the DB. Production builds ignore this entirely.
const DEV_PLAN_OVERRIDE = import.meta.env.DEV ? 'pro_max' : null

export function PlanProvider({ children }) {
  const api = useAPI()
  const { result: licenseResult } = useLicense()
  const [plan, setPlan] = useState(DEV_PLAN_OVERRIDE || 'pro')
  const [loading, setLoading] = useState(true)

  // Load from local DB first, then override with server response
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const emp = await api?.admin?.getEmpresa?.()
        if (!cancelled && emp?.plan && !DEV_PLAN_OVERRIDE) setPlan(emp.plan)
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [api])

  // Sync plan from license server response (updates every 4h)
  useEffect(() => {
    if (DEV_PLAN_OVERRIDE) return
    if (licenseResult?.plan && PLAN_FEATURES[licenseResult.plan]) {
      setPlan(licenseResult.plan)
    }
  }, [licenseResult?.plan])

  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.pro
  const hasFeature = useCallback((key) => features.includes(key), [features])
  const displayName = PLAN_DISPLAY[plan] || 'Pro'

  const value = { plan, displayName, features, hasFeature, loading }

  return (
    <PlanContext.Provider value={value}>
      {children}
    </PlanContext.Provider>
  )
}

export function usePlan() {
  const ctx = useContext(PlanContext)
  if (!ctx) return { plan: 'pro', displayName: 'Pro', features: PLAN_FEATURES.pro, hasFeature: (k) => PLAN_FEATURES.pro.includes(k), loading: false }
  return ctx
}

export { PLAN_FEATURES, PLAN_DISPLAY }
