// Static mock data for /demo/:vertical pages.
// All inline — zero fetches, zero persistence. Visitors interact freely.
// Prices in DOP, RNCs follow 130-XXXXX-X pattern (formatting only — fake values).

export const fmtRD = (n) =>
  `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Vertical → template mapping
export const VERTICAL_TO_TEMPLATE = {
  carwash:       'carwash',
  mecanica:      'carwash',
  salon:         'carwash',
  licoreria:     'tienda',
  farmacia:      'tienda',
  colmado:       'tienda',
  supermercado:  'tienda',
  ferreteria:    'tienda',
  papeleria:     'tienda',
  boutique:      'tienda',
  tienda:        'tienda',
  restaurante:   'restaurante',
  concesionario: 'concesionario',
  facturacion:   'facturacion',
  pawn:          'tienda', // light reuse — pawn-flavored copy
  nomina:        'nomina',
}

export const VERTICAL_LABEL = {
  carwash:       { es: 'Carwash',         en: 'Carwash' },
  mecanica:      { es: 'Mecánica',        en: 'Mechanics' },
  salon:         { es: 'Salón',           en: 'Salon' },
  licoreria:     { es: 'Licorería',       en: 'Liquor Store' },
  farmacia:      { es: 'Farmacia',        en: 'Pharmacy' },
  colmado:       { es: 'Colmado',         en: 'Colmado' },
  supermercado:  { es: 'Supermercado',    en: 'Supermarket' },
  ferreteria:    { es: 'Ferretería',      en: 'Hardware' },
  papeleria:     { es: 'Papelería',       en: 'Stationery' },
  boutique:      { es: 'Boutique',        en: 'Boutique' },
  tienda:        { es: 'Tienda',          en: 'Retail' },
  restaurante:   { es: 'Restaurante',     en: 'Restaurant' },
  concesionario: { es: 'Concesionario',   en: 'Dealership' },
  facturacion:   { es: 'Facturación',     en: 'Invoicing' },
  pawn:          { es: 'Casa de Empeño',  en: 'Pawn Shop' },
  nomina:        { es: 'Nómina',          en: 'Payroll' },
}

// ─── TIENDA — vertical-specific catalogs ───────────────────────────────────
export const TIENDA_CATALOG = {
  licoreria: {
    categories: ['Ron', 'Whisky', 'Cerveza', 'Vino', 'Vodka'],
    products: [
      { sku: '7501001',  name: 'Brugal Añejo 750ml',          cat: 'Ron',     price: 850 },
      { sku: '7501002',  name: 'Brugal Extra Viejo 750ml',    cat: 'Ron',     price: 1450 },
      { sku: '7501003',  name: 'Barceló Imperial 750ml',      cat: 'Ron',     price: 1295 },
      { sku: '7502001',  name: 'Johnnie Walker Black 750ml',  cat: 'Whisky',  price: 3895 },
      { sku: '7502002',  name: 'Buchanan\'s 12 Años 750ml',   cat: 'Whisky',  price: 3450 },
      { sku: '7503001',  name: 'Presidente 6-pack',           cat: 'Cerveza', price: 480 },
      { sku: '7503002',  name: 'Modelo Especial 6-pack',      cat: 'Cerveza', price: 650 },
      { sku: '7504001',  name: 'Concha y Toro Cabernet 750ml', cat: 'Vino',   price: 950 },
      { sku: '7505001',  name: 'Smirnoff Vodka 750ml',         cat: 'Vodka',  price: 875 },
    ],
  },
  farmacia: {
    categories: ['Analgésicos', 'Antibióticos', 'Vitaminas', 'Cuidado'],
    products: [
      { sku: 'F-001', name: 'Acetaminofén 500mg x20',     cat: 'Analgésicos', price: 95 },
      { sku: 'F-002', name: 'Ibuprofeno 400mg x10',       cat: 'Analgésicos', price: 145 },
      { sku: 'F-003', name: 'Aspirina 100mg x30',         cat: 'Analgésicos', price: 180 },
      { sku: 'F-004', name: 'Amoxicilina 500mg x21',      cat: 'Antibióticos', price: 425 },
      { sku: 'F-005', name: 'Azitromicina 500mg x3',      cat: 'Antibióticos', price: 380 },
      { sku: 'F-006', name: 'Centrum Adulto x30',         cat: 'Vitaminas',   price: 695 },
      { sku: 'F-007', name: 'Vitamina C 1000mg x60',      cat: 'Vitaminas',   price: 425 },
      { sku: 'F-008', name: 'Alcohol 70% 500ml',          cat: 'Cuidado',     price: 145 },
    ],
  },
  colmado: {
    categories: ['Granos', 'Lácteos', 'Bebidas', 'Limpieza'],
    products: [
      { sku: 'C-001', name: 'Arroz Crema 5lb',            cat: 'Granos',   price: 295 },
      { sku: 'C-002', name: 'Habichuelas Rojas 1lb',      cat: 'Granos',   price: 95 },
      { sku: 'C-003', name: 'Aceite Mazola 1L',           cat: 'Granos',   price: 285 },
      { sku: 'C-004', name: 'Leche Rica 1L',              cat: 'Lácteos',  price: 145 },
      { sku: 'C-005', name: 'Queso Geo 1lb',              cat: 'Lácteos',  price: 325 },
      { sku: 'C-006', name: 'Coca-Cola 2L',               cat: 'Bebidas',  price: 175 },
      { sku: 'C-007', name: 'Agua Crystal 6-pack',        cat: 'Bebidas',  price: 195 },
      { sku: 'C-008', name: 'Detergente Ace 1kg',         cat: 'Limpieza', price: 295 },
    ],
  },
  supermercado: {
    categories: ['Carnes', 'Frutas', 'Lácteos', 'Despensa'],
    products: [
      { sku: 'S-001', name: 'Pollo Entero (lb)',          cat: 'Carnes',   price: 75 },
      { sku: 'S-002', name: 'Carne Molida Premium (lb)',  cat: 'Carnes',   price: 245 },
      { sku: 'S-003', name: 'Plátano Verde (un)',         cat: 'Frutas',   price: 15 },
      { sku: 'S-004', name: 'Aguacate (un)',              cat: 'Frutas',   price: 65 },
      { sku: 'S-005', name: 'Yogurt Yoplait 6-pack',      cat: 'Lácteos',  price: 245 },
      { sku: 'S-006', name: 'Mantequilla Anchor 250g',    cat: 'Lácteos',  price: 295 },
      { sku: 'S-007', name: 'Pasta Barilla 500g',         cat: 'Despensa', price: 145 },
      { sku: 'S-008', name: 'Atún Calvo 140g',            cat: 'Despensa', price: 95 },
    ],
  },
  ferreteria: {
    categories: ['Herramientas', 'Plomería', 'Eléctrico', 'Pintura'],
    products: [
      { sku: 'FE-001', name: 'Martillo 16oz Stanley',     cat: 'Herramientas', price: 695 },
      { sku: 'FE-002', name: 'Taladro DeWalt 20V',        cat: 'Herramientas', price: 8950 },
      { sku: 'FE-003', name: 'Tubo PVC 1/2" x 10\'',      cat: 'Plomería',     price: 245 },
      { sku: 'FE-004', name: 'Llave de paso 1/2"',        cat: 'Plomería',     price: 295 },
      { sku: 'FE-005', name: 'Cable THHN #12 (m)',        cat: 'Eléctrico',    price: 35 },
      { sku: 'FE-006', name: 'Breaker 20A Square D',      cat: 'Eléctrico',    price: 445 },
      { sku: 'FE-007', name: 'Pintura Sherwin-Williams 1gal', cat: 'Pintura',  price: 1895 },
      { sku: 'FE-008', name: 'Brocha 3" Premium',         cat: 'Pintura',      price: 245 },
    ],
  },
  papeleria: {
    categories: ['Útiles', 'Papel', 'Mochilas', 'Arte'],
    products: [
      { sku: 'P-001', name: 'Cuaderno Norma 100h',        cat: 'Papel',    price: 95 },
      { sku: 'P-002', name: 'Lápiz Mongol 2B (caja 12)',  cat: 'Útiles',   price: 125 },
      { sku: 'P-003', name: 'Bolígrafo BIC Cristal x10',  cat: 'Útiles',   price: 145 },
      { sku: 'P-004', name: 'Resma Hammermill Carta',     cat: 'Papel',    price: 425 },
      { sku: 'P-005', name: 'Mochila Totto Escolar',      cat: 'Mochilas', price: 2495 },
      { sku: 'P-006', name: 'Crayolas 24 colores',        cat: 'Arte',     price: 195 },
      { sku: 'P-007', name: 'Marcadores Sharpie x8',      cat: 'Arte',     price: 395 },
      { sku: 'P-008', name: 'Calculadora Casio FX-82',    cat: 'Útiles',   price: 1895 },
    ],
  },
  boutique: {
    categories: ['Damas', 'Caballeros', 'Niños', 'Accesorios'],
    products: [
      { sku: 'B-001', name: 'Blusa Floral Talla M',       cat: 'Damas',       price: 1495 },
      { sku: 'B-002', name: 'Vestido Casual Talla S',     cat: 'Damas',       price: 2495 },
      { sku: 'B-003', name: 'Camisa Polo Caballero L',    cat: 'Caballeros',  price: 1895 },
      { sku: 'B-004', name: 'Jeans Slim-Fit 32x32',       cat: 'Caballeros',  price: 2895 },
      { sku: 'B-005', name: 'Conjunto Niño 4-5 años',     cat: 'Niños',       price: 1295 },
      { sku: 'B-006', name: 'Vestido Niña 6-7 años',      cat: 'Niños',       price: 1395 },
      { sku: 'B-007', name: 'Cartera de cuero',           cat: 'Accesorios',  price: 3495 },
      { sku: 'B-008', name: 'Cinturón ejecutivo',         cat: 'Accesorios',  price: 1295 },
    ],
  },
  pawn: {
    categories: ['Joyería', 'Electrónica', 'Herramientas'],
    products: [
      { sku: 'PW-001', name: 'Cadena oro 14k 18"',       cat: 'Joyería',      price: 24500 },
      { sku: 'PW-002', name: 'Anillo oro 14k',           cat: 'Joyería',      price: 12500 },
      { sku: 'PW-003', name: 'iPhone 13 128GB usado',    cat: 'Electrónica',  price: 24900 },
      { sku: 'PW-004', name: 'PlayStation 5 usado',      cat: 'Electrónica',  price: 28500 },
      { sku: 'PW-005', name: 'Taladro DeWalt usado',     cat: 'Herramientas', price: 4500 },
    ],
  },
}

// Default to licoreria if subtype isn't in catalog
export function catalogFor(vertical) {
  return TIENDA_CATALOG[vertical] || TIENDA_CATALOG.licoreria
}

// ─── CARWASH / SERVICE ─────────────────────────────────────────────────────
export const CARWASH_SERVICES = {
  carwash: {
    categories: ['Lavados', 'Detallado', 'Adicionales'],
    services: [
      { id: 1, name: 'Lavado Express',         cat: 'Lavados',     price: 350 },
      { id: 2, name: 'Lavado Completo',        cat: 'Lavados',     price: 650 },
      { id: 3, name: 'Lavado Premium',         cat: 'Lavados',     price: 950 },
      { id: 4, name: 'Encerado completo',      cat: 'Detallado',   price: 1950 },
      { id: 5, name: 'Pulido + cera',          cat: 'Detallado',   price: 3500 },
      { id: 6, name: 'Aspirado profundo',      cat: 'Adicionales', price: 450 },
      { id: 7, name: 'Tratamiento de cuero',   cat: 'Adicionales', price: 850 },
      { id: 8, name: 'Hand wax',               cat: 'Adicionales', price: 650 },
    ],
  },
  mecanica: {
    categories: ['Diagnóstico', 'Frenos', 'Motor', 'Aceite'],
    services: [
      { id: 1, name: 'Diagnóstico computarizado',  cat: 'Diagnóstico', price: 850 },
      { id: 2, name: 'Cambio pastillas Toyota',     cat: 'Frenos',      price: 2495 },
      { id: 3, name: 'Cambio discos delanteros',    cat: 'Frenos',      price: 4500 },
      { id: 4, name: 'Cambio aceite + filtro',      cat: 'Aceite',      price: 1495 },
      { id: 5, name: 'Tune-up completo',            cat: 'Motor',       price: 3500 },
      { id: 6, name: 'Cambio bujías',               cat: 'Motor',       price: 1295 },
    ],
  },
  salon: {
    categories: ['Cabello', 'Uñas', 'Spa'],
    services: [
      { id: 1, name: 'Corte caballero',           cat: 'Cabello', price: 350 },
      { id: 2, name: 'Corte dama + secado',       cat: 'Cabello', price: 750 },
      { id: 3, name: 'Tinte completo',            cat: 'Cabello', price: 2495 },
      { id: 4, name: 'Manicure clásico',          cat: 'Uñas',    price: 450 },
      { id: 5, name: 'Pedicure spa',              cat: 'Uñas',    price: 695 },
      { id: 6, name: 'Tratamiento facial',        cat: 'Spa',     price: 1895 },
    ],
  },
}

export function servicesFor(vertical) {
  return CARWASH_SERVICES[vertical] || CARWASH_SERVICES.carwash
}

export const QUEUE_SAMPLE = [
  { id: 'A-104', client: 'Juan Pérez',        plate: 'A123456', service: 'Lavado Premium',     status: 'proceso',   worker: 'Luis M.',    eta: 12 },
  { id: 'A-105', client: 'Ana Rodríguez',     plate: 'B789012', service: 'Lavado Completo',    status: 'proceso',   worker: 'Carlos R.',  eta: 8  },
  { id: 'A-106', client: 'Pedro Martínez',    plate: 'X456789', service: 'Encerado completo', status: 'pendiente', worker: '—',         eta: 25 },
  { id: 'A-107', client: 'Sofía González',    plate: 'C112233', service: 'Lavado Express',     status: 'listo',     worker: 'Luis M.',    eta: 0  },
  { id: 'A-108', client: 'Roberto Díaz',      plate: 'D998877', service: 'Lavado Premium',     status: 'pendiente', worker: '—',         eta: 30 },
]

// ─── RESTAURANTE ───────────────────────────────────────────────────────────
export const RESTAURANT_TABLES = Array.from({ length: 10 }, (_, i) => {
  const states = ['libre', 'ocupada', 'ocupada', 'libre', 'cuenta', 'libre', 'ocupada', 'libre', 'cuenta', 'ocupada']
  return {
    id: i + 1,
    label: `Mesa ${i + 1}`,
    state: states[i],
    cover: states[i] !== 'libre' ? Math.floor(Math.random() * 4) + 1 : 0,
    total: states[i] === 'ocupada' ? Math.round(450 + Math.random() * 2400) : states[i] === 'cuenta' ? Math.round(800 + Math.random() * 1800) : 0,
  }
})

export const RESTAURANT_MENU = [
  { id: 1, name: 'Mofongo de pollo',         cat: 'Platos',    price: 425 },
  { id: 2, name: 'Pechuga a la plancha',     cat: 'Platos',    price: 495 },
  { id: 3, name: 'Lasagna casera',           cat: 'Platos',    price: 545 },
  { id: 4, name: 'Ensalada César',           cat: 'Entradas',  price: 295 },
  { id: 5, name: 'Sopa del día',             cat: 'Entradas',  price: 195 },
  { id: 6, name: 'Coca-Cola',                cat: 'Bebidas',   price: 95 },
  { id: 7, name: 'Jugo natural',             cat: 'Bebidas',   price: 145 },
  { id: 8, name: 'Flan de la casa',          cat: 'Postres',   price: 195 },
]

export const KDS_ORDERS = [
  { id: 'M-3', table: 'Mesa 3', items: ['2x Mofongo de pollo', '1x Ensalada César'], age: '4 min', status: 'cocinando' },
  { id: 'M-7', table: 'Mesa 7', items: ['1x Lasagna', '1x Pechuga a la plancha', '2x Coca-Cola'], age: '7 min', status: 'cocinando' },
  { id: 'M-9', table: 'Mesa 9', items: ['1x Flan', '1x Jugo natural'], age: '1 min', status: 'pendiente' },
]

// ─── CONCESIONARIO ─────────────────────────────────────────────────────────
export const VEHICLES = [
  { id: 1, year: 2024, make: 'Toyota',  model: 'Corolla SE',         price: 1450000, km: 0,      vin: 'JTDBR32E120123456' },
  { id: 2, year: 2023, make: 'Honda',   model: 'CR-V Touring',       price: 1985000, km: 18500,  vin: 'JHLRM4H50PC012345' },
  { id: 3, year: 2024, make: 'Hyundai', model: 'Tucson Limited',     price: 1795000, km: 0,      vin: 'KM8J3CA46PU012345' },
  { id: 4, year: 2022, make: 'Nissan',  model: 'Sentra SR',          price: 1195000, km: 32000,  vin: '3N1AB8CV5NY012345' },
  { id: 5, year: 2024, make: 'Kia',     model: 'Sportage X-Line',    price: 1850000, km: 0,      vin: 'KNDPRCA50P7012345' },
  { id: 6, year: 2023, make: 'Mazda',   model: 'CX-5 Grand Touring', price: 2050000, km: 12000,  vin: 'JM3KFBDM5P0123456' },
]

// ─── CLIENTS (shared) ──────────────────────────────────────────────────────
export const CLIENTS = [
  { id: 1, name: 'Juan Pérez',        rnc: '040-1234567-8', phone: '809-555-0101' },
  { id: 2, name: 'Ana Rodríguez',     rnc: '402-9876543-2', phone: '829-555-0202' },
  { id: 3, name: 'Distribuidora SX',  rnc: '130-12345-6',   phone: '809-555-0303' },
  { id: 4, name: 'Pedro Martínez',    rnc: '001-2345678-9', phone: '849-555-0404' },
]

// Fake NCF generator (purely cosmetic — does not persist)
let _ncfCounter = 18
export function nextFakeNCF() {
  _ncfCounter += 1
  return `E32${String(_ncfCounter).padStart(10, '0')}`
}

// Fake CodigoSeguridad — 6 chars base64-ish
export function fakeSecurityCode() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz'
  let s = ''
  for (let i = 0; i < 6; i++) s += alpha[Math.floor(Math.random() * alpha.length)]
  return s
}

export const t = (lang, es, en) => (lang === 'en' ? en : es)
