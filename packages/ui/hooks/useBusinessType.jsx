import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useAPI } from '../context/DataContext'
import {
  BUSINESS_TYPE_KEYS,
  getBusinessTypeConfig,
  hasModule as cfgHasModule,
  normalizeBusinessType,
} from '@terminal-x/config/businessTypes'
import {
  TIENDA_SUBTYPES,
  getTiendaSubtype,
  subtypeFeaturePreset,
  SUBTYPE_SETTING_KEY,
  featureOverrideKey,
} from '@terminal-x/config/tiendaSubtypes'

const BusinessTypeContext = createContext(null)

// Canonical business types — re-exported from the registry so legacy imports keep working.
export const BUSINESS_TYPES = BUSINESS_TYPE_KEYS

const normalise = normalizeBusinessType

// Which business types are considered "tienda" for subtype purposes.
// LEGACY_ALIASES maps Spanish "tienda" → canonical "retail", so `retail`
// is the base type the subtype layer applies to. `licoreria` and
// `carniceria` kept top-level verticals — a licorería owner who already
// signed up as business_type=licoreria still benefits from the subtype
// metadata (we set tienda_subtype=licoreria under the hood).
function isTiendaBaseType(type) {
  return type === 'retail' || type === 'licoreria' || type === 'carniceria'
}

// Group membership flags — how each type maps to POS behavior.
// stockTracked → retail-style POS with inventory + barcode + qty cart
// serviceBased → car-wash-style POS with service grid + queue + workers
// hybrid       → both (combined view)
function flagsFor(type) {
  const stockTracked = ['retail', 'dealership', 'restaurant', 'hybrid', 'mechanic', 'licoreria', 'carniceria'].includes(type)
  const serviceBased = ['carwash', 'service', 'hybrid', 'salon', 'mechanic'].includes(type)
  const priceByWeight = ['carniceria'].includes(type)
  const scaleEnabled  = priceByWeight
  return {
    isRetail:     stockTracked,   // kept for backward-compat with existing call sites
    isCarWash:    serviceBased,   // kept for backward-compat
    isHybrid:     type === 'hybrid',
    isService:    type === 'service',
    isDealership: type === 'dealership',
    isRestaurant: type === 'restaurant',
    isMechanic:   type === 'mechanic',
    isSalon:      type === 'salon',
    isPrestamos:  type === 'prestamos',
    isLicoreria:  type === 'licoreria',
    isCarniceria: type === 'carniceria',
    isTienda:     isTiendaBaseType(type),
    stockTracked, serviceBased, priceByWeight, scaleEnabled,
  }
}

// Parse an app_settings override value ('true' | 'false' | '1' | '0' | '')
// into a tri-state: true / false / null (= no opinion).
function parseOverride(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const v = String(raw).toLowerCase().trim()
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
  return null
}

export function BusinessTypeProvider({ children }) {
  const api = useAPI()
  const [businessType, setType] = useState('carwash')
  const [tiendaSubtype, setTiendaSubtypeState] = useState(null)
  const [featureOverrides, setFeatureOverrides] = useState({})  // { [featureName]: 'true'|'false' }
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const settings = await api?.settings?.get?.()
        if (cancelled) return
        if (settings?.business_type) setType(normalise(settings.business_type))
        const sub = settings?.[SUBTYPE_SETTING_KEY]
        if (sub && TIENDA_SUBTYPES[sub]) setTiendaSubtypeState(sub)
        // Scrape every feature_*_enabled key from the settings bag.
        const overrides = {}
        for (const [k, v] of Object.entries(settings || {})) {
          const m = /^feature_(.+)_enabled$/.exec(k)
          if (m) overrides[m[1]] = v
        }
        setFeatureOverrides(overrides)
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

  const setTiendaSubtype = useCallback(async (subtype) => {
    const key = TIENDA_SUBTYPES[subtype] ? subtype : 'otro'
    setTiendaSubtypeState(key)
    try { await api?.settings?.update?.({ [SUBTYPE_SETTING_KEY]: key }) } catch {}
  }, [api])

  const setFeatureOverride = useCallback(async (featureName, value) => {
    // value === null|undefined → clear the override (revert to subtype preset).
    const next = { ...featureOverrides }
    if (value === null || value === undefined) delete next[featureName]
    else next[featureName] = value ? 'true' : 'false'
    setFeatureOverrides(next)
    try {
      const payload = { [featureOverrideKey(featureName)]: value === null || value === undefined ? '' : (value ? 'true' : 'false') }
      await api?.settings?.update?.(payload)
    } catch {}
  }, [api, featureOverrides])

  const clearFeatureOverrides = useCallback(async () => {
    const keys = Object.keys(featureOverrides)
    setFeatureOverrides({})
    try {
      const payload = {}
      for (const k of keys) payload[featureOverrideKey(k)] = ''
      if (keys.length) await api?.settings?.update?.(payload)
    } catch {}
  }, [api, featureOverrides])

  const flags = flagsFor(businessType)
  const config = getBusinessTypeConfig(businessType)
  const hasModule = (m) => cfgHasModule(businessType, m)

  // Subtype config — only meaningful when the base type is a tienda-like vertical.
  const subtypeConfig = flags.isTienda && tiendaSubtype ? getTiendaSubtype(tiendaSubtype) : null

  // Effective feature state: owner override wins → else subtype preset → else
  // hardwired legacy behavior for licoreria (backward-compat: isLicoreria
  // already implied age_verification + pedidos_ya + bottle_deposit) → else false.
  const hasFeature = useCallback((featureName) => {
    const override = parseOverride(featureOverrides[featureName])
    if (override !== null) return override
    if (subtypeConfig) {
      const preset = subtypeFeaturePreset(tiendaSubtype, featureName)
      if (preset !== null) return preset
    }
    // Legacy fallback — a business with business_type='licoreria' that
    // hasn't been migrated to have tienda_subtype='licoreria' yet still
    // gets the licorería features out of the box.
    if (flags.isLicoreria) {
      if (featureName === 'age_verification') return true
      if (featureName === 'pedidos_ya')       return true
      if (featureName === 'bottle_deposit')   return true
    }
    if (flags.isCarniceria && featureName === 'pricing_by_weight') return true
    return false
  }, [featureOverrides, subtypeConfig, tiendaSubtype, flags.isLicoreria, flags.isCarniceria])

  return (
    <BusinessTypeContext.Provider value={{
      businessType,
      ...flags,
      setBusinessType,
      loading,
      modules: config.modules,
      ui: config.ui,
      config,
      licoreriaConfig: config.licoreria || null,
      hasModule,
      // ── Tienda subtype template API ────────────────────────────────────
      tiendaSubtype,
      subtypeConfig,
      setTiendaSubtype,
      featureOverrides,
      setFeatureOverride,
      clearFeatureOverrides,
      hasFeature,
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
      licoreriaConfig: null,
      hasModule: (m) => cfgHasModule('carwash', m),
      tiendaSubtype: null,
      subtypeConfig: null,
      setTiendaSubtype: () => {},
      featureOverrides: {},
      setFeatureOverride: () => {},
      clearFeatureOverrides: () => {},
      hasFeature: () => false,
    }
  }
  return ctx
}
