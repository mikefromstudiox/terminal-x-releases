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

  hybrid: {
    label:       { es: 'Híbrido', en: 'Hybrid' },
    description: { es: 'Combinación — ej: restaurante con tienda de merch.',
                   en: 'Combination — e.g. restaurant with merch store.' },
    icon: 'LayoutGrid',
    modules: ['tables', 'menu', 'modifiers', 'kds', 'split_pay', 'multi_printer',
              'tip', 'inventory', 'barcode', 'cart', 'commissions'],
    ui: {
      showTableMap: true,
      enableKDS: true,
      showRetailCart: true,
      showServiceGrid: false,
      showInventory: true,
      posSegmentToggle: true, // Mesa vs Venta directa
      fulfillmentDefault: 'dine_in',
    },
    enabled: true,
  },
}

export const BUSINESS_TYPE_KEYS = ['carwash', 'retail', 'licoreria', 'carniceria', 'service', 'restaurant', 'mechanic', 'salon', 'prestamos', 'dealership', 'hybrid']

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
