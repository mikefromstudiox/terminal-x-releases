// Terminal X Business Configuration Engine — type registry.
//
// Single source of truth for every supported vertical. Shipped with the build
// so the desktop app never depends on Supabase being reachable to decide what
// UI to render. Phase 4 will add a Supabase `business_type_configs` layer on
// top of this file acting as fallback cache (same pattern as PLAN_FEATURES).
//
// To add a new vertical: append a key here, wire its modules in UI, seed its
// defaults in setupBusinessType.js. No other code changes required.

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

  dealership: {
    label:       { es: 'Dealership', en: 'Dealership' },
    description: { es: 'Venta de vehículos, con inventario de unidades.',
                   en: 'Vehicle sales with unit inventory.' },
    icon: 'CarFront',
    modules: ['inventory', 'barcode'],
    ui: {
      showTableMap: false,
      enableKDS: false,
      showRetailCart: true,
      showServiceGrid: false,
      showInventory: true,
      posSegmentToggle: false,
    },
    enabled: false, // placeholder — surfaces in UI as "próximamente"
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

export const BUSINESS_TYPE_KEYS = Object.keys(BUSINESS_TYPES)

export function getBusinessTypeConfig(type) {
  return BUSINESS_TYPES[type] || BUSINESS_TYPES.carwash
}

export function hasModule(type, moduleName) {
  return getBusinessTypeConfig(type).modules.includes(moduleName)
}

export function isBusinessTypeEnabled(type) {
  return getBusinessTypeConfig(type).enabled !== false
}
