// Terminal X — Tienda Subtype Template System.
//
// `business_type='tienda'` (retail) is too coarse — a licorería, farmacia,
// colmado, supermercado, ferretería, papelería and boutique all need a
// different default category set + feature toggles. Instead of creating
// a new top-level business_type per vertical (unmaintainable), we layer
// subtypes ON TOP of the tienda base.
//
// Owner flow:
//   1. Pick "Tienda / Retail" during FirstTimeSetup → step 1.
//   2. Pick a subtype (licorería / farmacia / …).
//   3. Get the right default categories + feature flags.
//   4. Turn individual features on/off à la carte later in Settings.
//
// Effective feature state:
//   owner override (app_settings.feature_<name>_enabled) → subtype preset
//   → default false.
//
// Adding a new subtype: append a key here + (optional) seed logic in a
// setup script. No other code changes required.

export const TIENDA_SUBTYPES = {
  licoreria: {
    es: 'Licorería',
    en: 'Liquor store',
    features: {
      age_verification: true,
      pedidos_ya:       true,
      bottle_deposit:   true,
      mamajuana_tracking: false,   // legacy flag, keep off
    },
    defaultCategories: [
      'Rones', 'Cervezas', 'Whiskey', 'Vinos', 'Vodkas', 'Licores',
      'Tequilas', 'Ginebras', 'Cognac', 'Espumantes', 'Refrescos',
      'Snacks', 'Cigarrillos', 'Vapers', 'Energéticas', 'Aguas', 'Jugos',
    ],
    // Vertical-specific business rules. Surfaced through
    // `useBusinessType().licoreriaConfig`. Shape kept identical to the legacy
    // `BUSINESS_TYPES.licoreria.licoreria` block (deprecated v2.13, removal v2.14)
    // so existing consumers (POS.jsx, Inventory.jsx, AgeVerifyModal.jsx) keep
    // working with zero changes.
    config: {
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
  },

  farmacia: {
    es: 'Farmacia',
    en: 'Pharmacy',
    features: {
      prescription_tracking:     true,
      age_verification:          false,
      expiry_alerts:             true,
      controlled_substance_log:  true,
      pedidos_ya:                false,
    },
    defaultCategories: [
      'Analgésicos', 'Antibióticos', 'Vitaminas', 'Primeros Auxilios',
      'Cuidado Personal', 'Higiene', 'Bebé', 'Suplementos',
      'Salud Sexual', 'Belleza', 'Cosméticos', 'Recetados', 'Sin Receta',
    ],
  },

  colmado: {
    es: 'Colmado',
    en: 'Corner store',
    features: {
      pedidos_ya:          true,
      mixed_food_nonfood:  true,
      credit_sales:        true,   // "fiado" — key colmado feature
    },
    defaultCategories: [
      'Abarrotes', 'Bebidas', 'Snacks', 'Lácteos', 'Panadería', 'Limpieza',
      'Higiene', 'Cigarrillos', 'Cervezas', 'Frutas y Verduras', 'Congelados',
    ],
  },

  supermercado: {
    es: 'Supermercado',
    en: 'Supermarket',
    features: {
      pedidos_ya:         true,
      pricing_by_weight:  true,
      loyalty:            true,
      deli_counter:       true,
    },
    defaultCategories: [
      'Carnes', 'Embutidos', 'Lácteos', 'Panadería', 'Frutas', 'Verduras',
      'Congelados', 'Abarrotes', 'Bebidas', 'Snacks', 'Limpieza', 'Higiene',
      'Mascotas', 'Bebé',
    ],
  },

  ferreteria: {
    es: 'Ferretería',
    en: 'Hardware store',
    features: {
      serial_number_tracking: false,
      job_estimates:          true,
      loyalty:                false,
      pedidos_ya:             false,
    },
    defaultCategories: [
      'Herramientas', 'Eléctrico', 'Plomería', 'Pintura', 'Construcción',
      'Jardinería', 'Seguridad', 'Tornillería', 'Medidas', 'Consumibles',
    ],
  },

  papeleria: {
    es: 'Papelería',
    en: 'Stationery',
    features: {
      school_packages: true,
      loyalty:         true,
      pedidos_ya:      false,
    },
    defaultCategories: [
      'Cuadernos', 'Bolígrafos', 'Carpetas', 'Arte', 'Oficina', 'Libros',
      'Regalos', 'Tecnología', 'Mochilas', 'Útiles Escolares',
    ],
  },

  boutique: {
    es: 'Boutique',
    en: 'Clothing boutique',
    features: {
      size_variants:  true,
      color_variants: true,
      loyalty:        true,
      pedidos_ya:     false,
    },
    defaultCategories: [
      'Damas', 'Caballeros', 'Niños', 'Accesorios', 'Calzado',
      'Ropa Interior', 'Vestidos', 'Camisas', 'Pantalones', 'Temporada',
    ],
  },

  otro: {
    es: 'Otra tienda',
    en: 'Other retail',
    features: {},
    defaultCategories: ['General'],
  },
}

export const TIENDA_SUBTYPE_KEYS = Object.keys(TIENDA_SUBTYPES)

// Canonical list of feature flags known to the subtype system. Used by
// Settings.jsx to render per-feature toggles and by useBusinessType to
// validate override keys.
export const TIENDA_FEATURE_KEYS = [
  'age_verification',
  'pedidos_ya',
  'bottle_deposit',
  'mamajuana_tracking',
  'prescription_tracking',
  'expiry_alerts',
  'controlled_substance_log',
  'mixed_food_nonfood',
  'credit_sales',
  'pricing_by_weight',
  'loyalty',
  'deli_counter',
  'serial_number_tracking',
  'job_estimates',
  'school_packages',
  'size_variants',
  'color_variants',
]

// Bilingual human labels for the feature toggles UI. Falls back to
// the raw key if missing.
export const TIENDA_FEATURE_LABELS = {
  age_verification:         { es: 'Verificación de edad',        en: 'Age verification' },
  pedidos_ya:               { es: 'Pedidos Ya (delivery)',       en: 'Pedidos Ya (delivery)' },
  bottle_deposit:           { es: 'Depósito de botella',         en: 'Bottle deposit' },
  mamajuana_tracking:       { es: 'Control de mamajuana',        en: 'Mamajuana tracking' },
  prescription_tracking:    { es: 'Control de recetas',          en: 'Prescription tracking' },
  expiry_alerts:            { es: 'Alertas de vencimiento',      en: 'Expiry alerts' },
  controlled_substance_log: { es: 'Registro de sustancias controladas', en: 'Controlled substance log' },
  mixed_food_nonfood:       { es: 'Mezcla comida / no-comida',   en: 'Mixed food / non-food' },
  credit_sales:             { es: 'Ventas a crédito (fiado)',    en: 'Credit sales (fiado)' },
  pricing_by_weight:        { es: 'Precio por peso (balanza)',   en: 'Price by weight (scale)' },
  loyalty:                  { es: 'Programa de lealtad',         en: 'Loyalty program' },
  deli_counter:             { es: 'Mostrador de deli',           en: 'Deli counter' },
  serial_number_tracking:   { es: 'Control de números de serie', en: 'Serial number tracking' },
  job_estimates:            { es: 'Cotizaciones de trabajo',     en: 'Job estimates' },
  school_packages:          { es: 'Paquetes escolares',          en: 'School packages' },
  size_variants:            { es: 'Variantes de talla',          en: 'Size variants' },
  color_variants:           { es: 'Variantes de color',          en: 'Color variants' },
}

export function getTiendaSubtype(key) {
  return TIENDA_SUBTYPES[key] || TIENDA_SUBTYPES.otro
}

// Returns the subtype preset value (true/false) for a given feature, or
// null if the subtype doesn't define it. Null ≠ false: it tells callers
// "no opinion" so an owner override can still flip it on.
export function subtypeFeaturePreset(subtypeKey, featureName) {
  const sub = TIENDA_SUBTYPES[subtypeKey]
  if (!sub) return null
  return Object.prototype.hasOwnProperty.call(sub.features, featureName)
    ? !!sub.features[featureName]
    : null
}

// app_settings key conventions.
export const SUBTYPE_SETTING_KEY = 'tienda_subtype'
export const featureOverrideKey = (featureName) => `feature_${featureName}_enabled`
