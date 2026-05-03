import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useAPI } from '../context/DataContext'
import {
  BUSINESS_TYPE_KEYS,
  BUSINESS_TYPES as BUSINESS_TYPE_REGISTRY,
  getBusinessTypeConfig,
  getHybridConfig,
  normalizeHybridComponents,
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
// hybrid       → flags are derived from the union of component types
function flagsFor(type, hybridComponents) {
  // For hybrid, build the membership set as the union of every component.
  // The convenience flags (isRestaurant, isRetail, isCarWash...) all stay
  // true if ANY component qualifies, so plan-gated UI ("show KDS",
  // "show service grid") just works without a hybrid-specific code path.
  const members = type === 'hybrid'
    ? new Set(normalizeHybridComponents(hybridComponents))
    : new Set([type])
  const has = (k) => members.has(k)

  const stockTracked  = has('retail') || has('dealership') || has('restaurant') || has('mechanic') || has('licoreria') || has('carniceria')
  const serviceBased  = has('carwash') || has('service') || has('salon') || has('mechanic')
  const priceByWeight = has('carniceria')
  const scaleEnabled  = priceByWeight
  return {
    isRetail:     stockTracked,   // kept for backward-compat with existing call sites
    isCarWash:    serviceBased,   // kept for backward-compat
    isHybrid:     type === 'hybrid',
    isService:    has('service'),
    isDealership: has('dealership'),
    isRestaurant: has('restaurant'),
    isMechanic:   has('mechanic'),
    isSalon:      has('salon'),
    isPrestamos:  has('prestamos'),
    isLicoreria:  has('licoreria'),
    isCarniceria: has('carniceria'),
    isTienda:     [...members].some(isTiendaBaseType),
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

// Dealership-only setting key (parallel to SUBTYPE_SETTING_KEY for tienda).
const DEALERSHIP_SUBTYPE_KEY = 'dealership_subtype'
// Hybrid components — CSV in app_settings (e.g. "restaurant,retail").
const HYBRID_COMPONENTS_KEY = 'hybrid_components'

// SECURITY (2026-04-29): an earlier patch added a per-business localStorage
// cache to avoid the 'carwash' default flashing on web reload. That cache was
// the wrong shape — it relied on `tx_business_id` (set by LicenseContext, not
// SupabaseAuthGate, so it didn't seed reliably on web), and it persisted UI
// vertical state across logouts on shared computers. Removed in favor of a
// loading-state render gate (see end of provider). No flash, no cache, no
// cross-tenant UI leak surface.

export function BusinessTypeProvider({ children }) {
  const api = useAPI()
  const [businessType, setType] = useState('carwash')
  const [tiendaSubtype, setTiendaSubtypeState] = useState(null)
  const [dealershipSubtype, setDealershipSubtypeState] = useState(null)
  const [hybridComponents, setHybridComponentsState] = useState(['restaurant', 'retail'])
  const [featureOverrides, setFeatureOverrides] = useState({})  // { [featureName]: 'true'|'false' }
  const [loading, setLoading] = useState(true)

  // 2026-05-03 (peppy-greeting-popcorn) — expose current businessType to the
  // global error reporter so /admin Errores rows include business_type in
  // metadata. Single line, no perf cost.
  useEffect(() => {
    try { if (typeof window !== 'undefined') window.__txBusinessType = businessType || null } catch {}
  }, [businessType])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const settings = await api?.settings?.get?.()
        if (cancelled) return
        if (settings?.business_type) setType(normalise(settings.business_type))
        const sub = settings?.[SUBTYPE_SETTING_KEY]
        if (sub && TIENDA_SUBTYPES[sub]) setTiendaSubtypeState(sub)
        const dsub = settings?.[DEALERSHIP_SUBTYPE_KEY]
        if (dsub) setDealershipSubtypeState(dsub)
        const hyb = settings?.[HYBRID_COMPONENTS_KEY]
        if (hyb) setHybridComponentsState(normalizeHybridComponents(hyb))
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

  const setHybridComponents = useCallback(async (next) => {
    const norm = normalizeHybridComponents(next)
    setHybridComponentsState(norm)
    try { await api?.settings?.update?.({ [HYBRID_COMPONENTS_KEY]: norm.join(',') }) } catch {}
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

  const flags = flagsFor(businessType, hybridComponents)
  const config = businessType === 'hybrid'
    ? getHybridConfig(hybridComponents)
    : getBusinessTypeConfig(businessType)
  const hasModule = (m) => (config.modules || []).includes(m)

  // Subtype config — only meaningful when the base type is a tienda-like vertical.
  let subtypeConfig = flags.isTienda && tiendaSubtype ? getTiendaSubtype(tiendaSubtype) : null
  // Dealership uses an inline subtypes block on the registry (no separate file).
  // Resolution: settings.dealership_subtype → registry.defaultSubtype → null.
  if (!subtypeConfig && flags.isDealership && config?.subtypes) {
    const key = (dealershipSubtype && config.subtypes[dealershipSubtype])
      ? dealershipSubtype
      : (config.defaultSubtype && config.subtypes[config.defaultSubtype]) ? config.defaultSubtype : null
    if (key) subtypeConfig = config.subtypes[key]
  }

  // Unified licorería config selector.
  // Precedence (v2.13):
  //   1. Active tienda_subtype's `.config` block (canonical)
  //   2. Implicit licoreria subtype for business_type='licoreria' without a
  //      tienda_subtype set yet (forward-compat with legacy installs)
  //   3. Legacy `BUSINESS_TYPES.licoreria.licoreria` block (DEPRECATED v2.13,
  //      removal v2.14)
  //   4. null
  // Shape is guaranteed identical to the legacy block: { ageVerification,
  // bottleDeposit, quickSell, brandSuggestions }.
  let licoreriaConfig = null
  if (subtypeConfig?.config) {
    licoreriaConfig = subtypeConfig.config
  } else if (flags.isLicoreria) {
    licoreriaConfig = TIENDA_SUBTYPES.licoreria?.config || config.licoreria || null
  }

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
    // v2.16.10 — Per-business customizable defaults (Mi Empresa toggles).
    // Discounts at cobro: ON globally. Owner can flip OFF per-business
    // (Ranoza opted out — no discount field at checkout).
    if (featureName === 'discounts') return true
    // Receipt ITBIS per line: OFF globally. Returns false via the final
    // fall-through, no special case needed — listed here for inventory.
    // v2.14.36 — Comisiones default. Service-based verticals run commissions
    // (lavadores/vendedores/cajeros), tienda subtypes opt-in via the preset
    // map above. Owner override always wins.
    if (featureName === 'commissions') {
      return !!(flags.isCarWash || flags.isMechanic || flags.isSalon ||
                flags.isHybrid  || flags.isDealership || flags.isRestaurant ||
                flags.isService)
    }
    return false
  }, [featureOverrides, subtypeConfig, tiendaSubtype, flags.isLicoreria, flags.isCarniceria,
      flags.isCarWash, flags.isMechanic, flags.isSalon, flags.isHybrid, flags.isDealership, flags.isRestaurant, flags.isService])

  // SECURITY: while settings.get() is in flight, do NOT render children. Until
  // we know the actual business_type / tienda_subtype, every screen below
  // would render against the 'carwash' default — exactly the flash that
  // tipped Mike off to the underlying cross-tenant exposure incident on
  // 2026-04-29. A small loader is acceptable; rendering the wrong vertical
  // is not.
  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-black/10 dark:border-white/10" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#b3001e] animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <BusinessTypeContext.Provider value={{
      businessType,
      ...flags,
      setBusinessType,
      loading,
      modules: config.modules,
      ui: config.ui,
      config,
      licoreriaConfig,
      hasModule,
      // ── Tienda subtype template API ────────────────────────────────────
      tiendaSubtype,
      subtypeConfig,
      setTiendaSubtype,
      hybridComponents,
      setHybridComponents,
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
      hybridComponents: ['restaurant', 'retail'],
      setHybridComponents: () => {},
      featureOverrides: {},
      setFeatureOverride: () => {},
      clearFeatureOverrides: () => {},
      hasFeature: () => false,
    }
  }
  return ctx
}
