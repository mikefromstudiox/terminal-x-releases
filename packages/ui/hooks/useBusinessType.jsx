import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useAPI } from '../context/DataContext'
import {
  BUSINESS_TYPE_KEYS,
  getBusinessTypeConfig,
  hasModule as cfgHasModule,
} from '@terminal-x/config/businessTypes'

const BusinessTypeContext = createContext(null)

// Canonical business types — re-exported from the registry so legacy imports keep working.
export const BUSINESS_TYPES = BUSINESS_TYPE_KEYS

function normalise(raw) {
  if (!raw) return 'carwash'
  // Backwards-compat aliases from the pre-1.9.19 three-value enum.
  if (raw === 'tienda') return 'retail'
  if (raw === 'otro')   return 'service'
  return BUSINESS_TYPE_KEYS.includes(raw) ? raw : 'carwash'
}

// Group membership flags — how each type maps to POS behavior.
// stockTracked → retail-style POS with inventory + barcode + qty cart
// serviceBased → car-wash-style POS with service grid + queue + workers
// hybrid       → both (combined view)
function flagsFor(type) {
  const stockTracked = ['retail', 'dealership', 'restaurant', 'hybrid'].includes(type)
  const serviceBased = ['carwash', 'service', 'hybrid'].includes(type)
  return {
    isRetail:     stockTracked,   // kept for backward-compat with existing call sites
    isCarWash:    serviceBased,   // kept for backward-compat
    isHybrid:     type === 'hybrid',
    isService:    type === 'service',
    isDealership: type === 'dealership',
    isRestaurant: type === 'restaurant',
    stockTracked, serviceBased,
  }
}

export function BusinessTypeProvider({ children }) {
  const api = useAPI()
  const [businessType, setType] = useState('carwash')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const settings = await api?.settings?.get?.()
        if (!cancelled && settings?.business_type) setType(normalise(settings.business_type))
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [api])

  const setBusinessType = useCallback(async (type) => {
    const norm = normalise(type)
    setType(norm)
    try { await api?.settings?.update?.({ business_type: norm }) } catch {}
  }, [api])

  const flags = flagsFor(businessType)
  const config = getBusinessTypeConfig(businessType)
  const hasModule = (m) => cfgHasModule(businessType, m)

  return (
    <BusinessTypeContext.Provider value={{
      businessType,
      ...flags,
      setBusinessType,
      loading,
      modules: config.modules,
      ui: config.ui,
      config,
      hasModule,
    }}>
      {children}
    </BusinessTypeContext.Provider>
  )
}

export function useBusinessType() {
  const ctx = useContext(BusinessTypeContext)
  if (!ctx) {
    const config = getBusinessTypeConfig('carwash')
    return {
      businessType: 'carwash',
      ...flagsFor('carwash'),
      setBusinessType: () => {},
      loading: false,
      modules: config.modules,
      ui: config.ui,
      config,
      hasModule: (m) => cfgHasModule('carwash', m),
    }
  }
  return ctx
}
