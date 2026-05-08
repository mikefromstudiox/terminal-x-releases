// Terminal X Business Configuration Engine — type registry.
//
// Single source of truth for every supported vertical. Shipped with the build
// so the desktop app never depends on Supabase being reachable to decide what
// UI to render. Phase 4 will add a Supabase `business_type_configs` layer on
// top of this file acting as fallback cache (same pattern as PLAN_FEATURES).
//
// To add a new vertical: append a key here, wire its modules in UI, seed its
// defaults in setupBusinessType.js. No other code changes required.

// v2.16.4 Sprint 2C — DR bank roster used by the Concesionario pre-approval
// flow. Order matches retail-channel mindshare (Popular/Reservas dominate the
// auto-loan book in DR). Owners cannot extend this list from the UI yet — add
// a new bank here and ship a build.
export const DR_BANKS = [
  'Banco Popular',
  'Banreservas',
  'BHD',
  'Banco Santa Cruz',
  'Promerica',
  'Banco Caribe',
  'Banco Lopez de Haro',
  'Vimenca',
  'Banesco',
  'APAP',
  'ALAVER',
]

export const BUSINESS_TYPES = {
  carwash: {
    label:       { es: 'Car Wash', en: 'Car Wash' },
    description: { es: 'Lavado de vehículos, detailing, servicios automotrices.',
                   en: 'Vehicle washing, detailing, automotive services.' },
    icon: 'Car',
    modules: ['queue', 'washers', 'service_grid', 'commissions'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: false,
      showServiceGrid: true,
      showInventory: false,
      posSegmentToggle: false,
    },
    enabled: true,
  },

  retail: {
    label:       { es: 'Tienda / Retail', en: 'Store / Retail' },
    description: { es: 'Venta de productos con inventario, SKU y código de barras.',
                   en: 'Product sales with inventory, SKU, and barcode support.' },
    icon: 'Store',
    modules: ['inventory', 'barcode', 'cart'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: true,
      showServiceGrid: false,
      showInventory: true,
      posSegmentToggle: false,
    },
    enabled: true,
  },

  service: {
    label:       { es: 'Servicios', en: 'Services' },
    description: { es: 'Servicios profesionales, salón, taller, consultoría.',
                   en: 'Professional services, salon, workshop, consulting.' },
    icon: 'Briefcase',
    modules: ['service_grid'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: false,
      showServiceGrid: true,
      showInventory: false,
      posSegmentToggle: false,
    },
    enabled: true,
  },

  restaurant: {
    label:       { es: 'Restaurante / Bar', en: 'Restaurant / Bar' },
    description: { es: 'Restaurantes, bares, cafeterías. Mesas, menú, KDS, propinas.',
                   en: 'Restaurants, bars, cafés. Tables, menu, KDS, tips.' },
    icon: 'UtensilsCrossed',
    modules: ['tables', 'menu', 'modifiers', 'kds', 'split_pay', 'multi_printer', 'tip', 'commissions'],
    ui: {
      showTableMap: true,
      enableKDS: true,
      showRetailCart: false,
      showServiceGrid: false,
      showInventory: true,
      posSegmentToggle: false,
      fulfillmentDefault: 'dine_in',
    },
    enabled: true,
  },

  mechanic: {
    label:       { es: 'Taller Mecánico', en: 'Mechanic Shop' },
    description: { es: 'Taller automotriz con órdenes de trabajo, vehículos y bahías de servicio.',
                   en: 'Automotive repair with work orders, vehicles and service bays.' },
    icon: 'Wrench',
    modules: ['work_orders', 'vehicles', 'service_bays', 'inventory', 'appointments', 'commissions', 'service_grid'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: false,
      showServiceGrid: true,
      showInventory: true,
      posSegmentToggle: false,
    },
    enabled: true,
  },

  salon: {
    label:       { es: 'Barbería / Salón', en: 'Barbershop / Salon' },
    description: { es: 'Barbería, salón de belleza, spa. Citas, estilistas y colas.',
                   en: 'Barbershop, beauty salon, spa. Appointments, stylists and queues.' },
    icon: 'Scissors',
    modules: ['appointments', 'stylist_schedules', 'queue', 'service_grid', 'commissions',
              'memberships', 'retail_upsell', 'public_booking', 'walk_in', 'dashboard'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: false,
      showServiceGrid: true,
      showInventory: true, // v2.16.1 — needed for retail upsell tile picker in cobro
      posSegmentToggle: false,
    },
    enabled: true,
  },

  prestamos: {
    label:       { es: 'Préstamos / Empeño', en: 'Lending / Pawn' },
    description: { es: 'Préstamos personales, casa de empeño, cobranza y amortización.',
                   en: 'Personal loans, pawnshop, collections and amortization.' },
    icon: 'Banknote',
    modules: ['loans', 'pawn_items', 'clients'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: false,
      showServiceGrid: false,
      showInventory: false,
      posSegmentToggle: false,
    },
    enabled: true,
  },

  dealership: {
    label:       { es: 'Dealership', en: 'Dealership' },
    description: { es: 'Venta de vehículos, con inventario de unidades.',
                   en: 'Vehicle sales with unit inventory.' },
    icon: 'CarFront',
    modules: ['inventory', 'barcode', 'vehicles'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: true,
      showServiceGrid: false,
      showInventory: true,
      posSegmentToggle: false,
    },
    // Concesionario subtypes — chosen via app_settings.dealership_subtype.
    // `vehicleItbis` flips ITBIS application on the deal line item. DGII rule:
    // vehiculos nuevos importados → ITBIS aplica; usados (segunda mano) →
    // generalmente exento. Owner override via app_settings.feature_vehicle_itbis_enabled
    // always wins (read in useBusinessType.licoreriaConfig sibling logic).
    subtypes: {
      concesionario_nuevo: {
        es: 'Concesionario (Nuevos)', en: 'Dealership (New)',
        config: { vehicleItbis: true },
      },
      concesionario_usado: {
        es: 'Concesionario (Usados)', en: 'Dealership (Used)',
        config: { vehicleItbis: false },
      },
    },
    defaultSubtype: 'concesionario_usado',
    drBanks: DR_BANKS,
    enabled: true,
  },

  licoreria: {
    label:       { es: 'Licorería', en: 'Liquor Store' },
    description: { es: 'Venta de licores, bebidas, cervezas, vinos. Verificación de edad y depósito de botellas.',
                   en: 'Liquor, beer, wine and beverage sales. Age verification and bottle deposit.' },
    icon: 'Wine',
    modules: ['inventory', 'barcode', 'cart', 'age_verification', 'bottle_deposit'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: true,
      showServiceGrid: false,
      showInventory: true,
      posSegmentToggle: false,
    },
    // DEPRECATED v2.13: read from useBusinessType().licoreriaConfig instead.
    // The canonical source is now TIENDA_SUBTYPES.licoreria.config in
    // packages/config/tiendaSubtypes.js. This block is retained for one
    // release as a fallback for installs that have business_type='licoreria'
    // without a tienda_subtype seeded. Scheduled for removal in v2.14.
    licoreria: {
      ageVerification: {
        enabled: true,
        minAge: 18,
        // Categories that trigger the 18+ prompt. Matched case-insensitively
        // against inventory_items.category.
        triggerCategories: [
          'ron', 'whisky', 'whiskey', 'vodka', 'cerveza', 'beer',
          'vino', 'wine', 'gin', 'tequila', 'licor', 'brandy',
          'champagne', 'espumante', 'aperitivo', 'cocktail',
        ],
      },
      bottleDeposit: {
        enabled: true,
        // DR standard deposit — operator can override per-SKU.
        defaultAmount: 5,
        lineLabel: { es: 'Depósito de botella', en: 'Bottle deposit' },
      },
      quickSell: {
        enabled: true,
        topN: 8,
      },
      // DR brand suggestions surfaced by the Inventory editor. Non-exhaustive
      // but covers ~95% of what a small licorería stocks on shelf.
      brandSuggestions: {
        ron:      ['Brugal Añejo', 'Brugal Extra Viejo', 'Brugal 1888', 'Barceló Imperial', 'Barceló Añejo', 'Bermudez Aniversario', 'Macorix', 'Matusalem', 'Bacardi'],
        whisky:   ['Johnnie Walker Red', 'Johnnie Walker Black', 'Buchanan\'s 12', 'Buchanan\'s 18', 'Chivas Regal 12', 'Jack Daniel\'s', 'Jim Beam', 'Macallan'],
        vodka:    ['Absolut', 'Smirnoff', 'Grey Goose', 'Ciroc', 'Belvedere'],
        cerveza:  ['Presidente', 'Presidente Light', 'Bohemia', 'Corona', 'Heineken', 'Modelo', 'Michelob', 'The One'],
        vino:     ['Santa Rita', 'Casillero del Diablo', 'Concha y Toro', 'Yellow Tail', 'Trivento', 'Frontera'],
        gin:      ['Bombay Sapphire', 'Tanqueray', 'Beefeater', 'Hendrick\'s'],
        tequila:  ['Jose Cuervo', 'Don Julio', 'Patrón', 'Herradura', 'Sauza'],
        champagne:['Moët & Chandon', 'Veuve Clicquot', 'Chandon', 'Martini Asti'],
      },
    },
    enabled: true,
  },

  food_truck: {
    label:       { es: 'Food Truck', en: 'Food Truck' },
    description: { es: 'Camión de comida móvil. Menú, KDS, propinas, take-out por defecto. Sin mesas.',
                   en: 'Mobile food truck. Menu, KDS, tips, take-out by default. No tables.' },
    icon: 'Truck',
    modules: ['menu', 'modifiers', 'kds', 'tip', 'commissions', 'inventory', 'barcode',
              'food_truck_locations', 'waste_log', 'event_mode'],
    ui: {
      showTableMap: false,
      enableKDS: true,
      showRetailCart: false,
      showServiceGrid: false,
      showInventory: true,
      posSegmentToggle: false,
      fulfillmentDefault: 'take_out',
    },
    enabled: true,
  },

  carniceria: {
    label:       { es: 'Carnicería', en: 'Butcher / Meat Market' },
    description: { es: 'Venta de carnes por peso. Báscula integrada, cortes por libra/kg.',
                   en: 'Meat sales by weight. Integrated scale, cuts priced by pound/kg.' },
    icon: 'Beef',
    modules: ['inventory', 'barcode', 'cart', 'scale', 'price_by_weight',
              'multi_scale', 'freshness', 'mayoreo', 'seasonal_promos',
              'kitchen_notes', 'prepacked_toggle', 'corte_catalog'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: true,
      showServiceGrid: false,
      showInventory: true,
      posSegmentToggle: false,
    },
    enabled: true,
  },

  // Contabilidad — full firm-side accounting suite. Phase 1: Bandeja, Cartera,
  // Calendario, Comprobantes (606/607/608), Vault, Honorarios. Phase 2/3 add
  // libro mayor, banco, nomina, activos/retenciones, tareas, cross-firm wire.
  // No POS, no inventory — invoicingOnly stays true.
  contabilidad: {
    label:       { es: 'Contabilidad', en: 'Accounting' },
    description: { es: 'Suite contable DGII completa: bandeja, cartera, calendario fiscal, libros, conciliación bancaria, nómina TSS y honorarios.',
                   en: 'Full DGII accounting suite: inbox, client roster, tax calendar, ledgers, bank reconciliation, payroll/TSS and fees.' },
    icon: 'Briefcase',
    modules: [
      'invoicing', 'clients', 'reports', 'dgii',
      'accounting_inbox', 'accounting_calendar', 'accounting_vault',
      'accounting_honorarios', 'accounting_libro_mayor', 'accounting_banco',
      'accounting_nomina', 'accounting_activos_retenciones',
      'accounting_tareas', 'accounting_reportes',
    ],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: false,
      showServiceGrid: false,
      showInventory: false,
      posSegmentToggle: false,
      invoicingOnly: true,
    },
    enabled: true,
  },

  // Hybrid is a generic combination of any 2+ other verticals chosen by the
  // owner (stored as a CSV in app_settings.hybrid_components). The block below
  // is just the registry placeholder — the *effective* config is built at
  // runtime by getHybridConfig() unioning modules + OR'ing UI flags from the
  // selected components. Defaults to restaurant + retail for backward compat
  // with installs that pre-date the generalization.
  hybrid: {
    label:       { es: 'Híbrido', en: 'Hybrid' },
    description: { es: 'Combina dos o más tipos de negocio en uno.',
                   en: 'Combine two or more business types in one.' },
    icon: 'LayoutGrid',
    modules: [],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: false,
      showServiceGrid: false,
      showInventory: false,
      posSegmentToggle: true,
    },
    defaultComponents: ['restaurant', 'retail'],
    enabled: true,
  },
}

// Components a hybrid setup can be built from. Excludes 'hybrid' itself.
export const HYBRID_COMPONENT_KEYS = ['carwash', 'retail', 'licoreria', 'carniceria', 'service', 'restaurant', 'food_truck', 'mechanic', 'salon', 'prestamos', 'dealership']

// Validate + normalize a list of hybrid components. Always returns at least
// the registry default (['restaurant','retail']) so the POS never renders
// blank when an owner clears the picker.
export function normalizeHybridComponents(input) {
  const raw = Array.isArray(input)
    ? input
    : (typeof input === 'string' ? input.split(',') : [])
  const seen = new Set()
  const out = []
  for (const v of raw) {
    const k = normalizeBusinessType(v)
    if (k === 'hybrid' || !HYBRID_COMPONENT_KEYS.includes(k)) continue
    if (seen.has(k)) continue
    seen.add(k); out.push(k)
  }
  return out.length >= 2 ? out : (BUSINESS_TYPES.hybrid.defaultComponents || ['restaurant', 'retail'])
}

// Build the effective hybrid config by unioning modules + OR'ing UI flags
// across the selected component types. Label/description are composed from
// the component labels so the UI ("Restaurante + Tienda") reflects the mix.
export function getHybridConfig(components) {
  const comps = normalizeHybridComponents(components)
  const modules = new Set()
  const ui = {
    showTableMap: false,
    enableKDS: false,
    showRetailCart: false,
    showServiceGrid: false,
    showInventory: false,
    posSegmentToggle: true,
    fulfillmentDefault: undefined,
  }
  for (const k of comps) {
    const cfg = BUSINESS_TYPES[k]
    if (!cfg) continue
    for (const m of cfg.modules || []) modules.add(m)
    for (const flag of ['showTableMap', 'enableKDS', 'showRetailCart', 'showServiceGrid', 'showInventory']) {
      if (cfg.ui?.[flag]) ui[flag] = true
    }
    if (!ui.fulfillmentDefault && cfg.ui?.fulfillmentDefault) ui.fulfillmentDefault = cfg.ui.fulfillmentDefault
  }
  const labelEs = comps.map(k => BUSINESS_TYPES[k]?.label?.es || k).join(' + ')
  const labelEn = comps.map(k => BUSINESS_TYPES[k]?.label?.en || k).join(' + ')
  return {
    label:       { es: labelEs, en: labelEn },
    description: BUSINESS_TYPES.hybrid.description,
    icon: 'LayoutGrid',
    modules: Array.from(modules),
    ui,
    components: comps,
    enabled: true,
  }
}

export const BUSINESS_TYPE_KEYS = ['carwash', 'retail', 'licoreria', 'carniceria', 'service', 'restaurant', 'food_truck', 'mechanic', 'salon', 'prestamos', 'dealership', 'contabilidad', 'hybrid']

// Service-based verticals — where vehicle/worker/queue concepts apply.
export const SERVICE_BASED_TYPES = ['carwash', 'service', 'mechanic', 'salon', 'hybrid']

// Verticals where Ventas should show the "Cliente / Vehículo" column.
export const VEHICLE_TYPES = ['carwash', 'mechanic', 'dealership']

// Legacy Spanish keys → canonical English keys. Existing demo tenants and
// older installs stored the Spanish values directly in settings.business_type
// before the registry was Englishized. Without this map they fall back to
// `carwash` and see the wrong UI (Cola tab in a retail store, etc.).
const LEGACY_ALIASES = {
  tienda:        'retail',
  restaurante:   'restaurant',
  hibrido:       'hybrid',
  mecanica:      'mechanic',
  mecanico:      'mechanic',
  servicios:     'service',
  otro:          'service',
  concesionario: 'dealership',
  barberia:      'salon',
  prestamo:      'prestamos',
  licoreria:     'licoreria',
  carniceria:    'carniceria',
}

export function normalizeBusinessType(type) {
  if (!type) return 'carwash'
  const t = String(type).toLowerCase().trim()
  if (BUSINESS_TYPES[t]) return t
  return LEGACY_ALIASES[t] || 'carwash'
}

export function isServiceBased(type) { return SERVICE_BASED_TYPES.includes(normalizeBusinessType(type)) }
export function hasVehicles(type) { return VEHICLE_TYPES.includes(normalizeBusinessType(type)) }

export function getBusinessTypeConfig(type) {
  return BUSINESS_TYPES[normalizeBusinessType(type)] || BUSINESS_TYPES.carwash
}

export function hasModule(type, moduleName) {
  return getBusinessTypeConfig(type).modules.includes(moduleName)
}

export function isBusinessTypeEnabled(type) {
  return getBusinessTypeConfig(type).enabled !== false
}
