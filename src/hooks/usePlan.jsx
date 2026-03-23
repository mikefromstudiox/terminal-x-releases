import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useAPI } from '../context/DataContext'

const PLAN_FEATURES = {
  free:      ['pos', 'queue', 'clients'],
  pro:       ['pos', 'queue', 'clients', 'credits', 'reports', 'petty_cash', 'credit_notes', 'cash_recon'],
  pro_plus:  ['pos', 'queue', 'clients', 'credits', 'reports', 'petty_cash', 'credit_notes', 'cash_recon', 'ecf', 'dgii', 'inventory', 'commissions'],
  pro_max:   ['pos', 'queue', 'clients', 'credits', 'reports', 'petty_cash', 'credit_notes', 'cash_recon', 'ecf', 'dgii', 'inventory', 'commissions', 'remote_dashboard', 'whatsapp_receipts', 'multi_location'],
}

const PLAN_DISPLAY = { free: 'Free', pro: 'Pro', pro_plus: 'Pro+', pro_max: 'Pro Max' }

const PlanContext = createContext(null)

export function PlanProvider({ children }) {
  const api = useAPI()
  const [plan, setPlan] = useState('free')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const emp = await api?.admin?.getEmpresa?.()
        if (!cancelled && emp?.plan) setPlan(emp.plan)
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [api])

  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.free
  const hasFeature = useCallback((key) => features.includes(key), [features])
  const isFreePlan = plan === 'free'
  const displayName = PLAN_DISPLAY[plan] || 'Free'

  const value = { plan, displayName, features, hasFeature, isFreePlan, loading }

  return (
    <PlanContext.Provider value={value}>
      {children}
    </PlanContext.Provider>
  )
}

export function usePlan() {
  const ctx = useContext(PlanContext)
  if (!ctx) return { plan: 'pro_max', displayName: 'Pro Max', features: PLAN_FEATURES.pro_max, hasFeature: () => true, isFreePlan: false, loading: false }
  return ctx
}

export { PLAN_FEATURES, PLAN_DISPLAY }
