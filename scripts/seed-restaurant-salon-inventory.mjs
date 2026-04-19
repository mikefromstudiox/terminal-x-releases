// Seed inventory_items for restaurant and salon demo businesses.
// Idempotent: skips SKUs already present in target business.
import { createClient } from '@supabase/supabase-js'
import { randomUUID as uuid } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const SUPABASE_URL = env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

const RESTAURANT_ID = 'b037c2a8-d8d2-45f6-ada1-f851cf0190a4'
const SALON_ID = 'b14f83cb-15c9-4c1f-946c-5256265dab7a'

const restaurantInv = [
  { cat: 'Bebidas', sku: 'BEB-COC-20',  barcode: '7460012399881', name: 'Coca Cola 20oz',            price: 85,  cost: 45 },
  { cat: 'Bebidas', sku: 'BEB-PRE-GRA', barcode: '7460012345678', name: 'Cerveza Presidente Grande', price: 150, cost: 95 },
  { cat: 'Bebidas', sku: 'BEB-PRE-PEQ', barcode: '7460012345685', name: 'Cerveza Presidente Pequena',price: 90,  cost: 55 },
  { cat: 'Bebidas', sku: 'BEB-AGU-500', barcode: '7460012399904', name: 'Agua 500ml',                 price: 45,  cost: 20 },
  { cat: 'Bebidas', sku: 'BEB-MALT-MOR',barcode: '7460012345692', name: 'Malta Morena',               price: 75,  cost: 45 },
  { cat: 'Bebidas', sku: 'BEB-MOR-SON', barcode: '7460012345708', name: 'Morir Sonando',              price: 95,  cost: 40 },
  { cat: 'Sides',   sku: 'SID-TOS-AJO', barcode: '2100000005011', name: 'Tostones con Ajo',           price: 120, cost: 60 },
  { cat: 'Sides',   sku: 'SID-YUC-FRI', barcode: '2100000005028', name: 'Yuca Frita',                 price: 110, cost: 55 },
  { cat: 'Sides',   sku: 'SID-ARR-BLA', barcode: '2100000005035', name: 'Arroz Blanco',               price: 75,  cost: 35 },
  { cat: 'Sides',   sku: 'SID-HAB-ROJ', barcode: '2100000005042', name: 'Habichuelas Rojas',          price: 85,  cost: 40 },
  { cat: 'Snacks',  sku: 'SNA-PAP-LAY', barcode: '2100000006011', name: 'Papitas Lays',               price: 55,  cost: 30 },
  { cat: 'Snacks',  sku: 'SNA-PAL-COS', barcode: '2100000006028', name: 'Palitos de Queso',           price: 95,  cost: 50 },
]

const salonInv = [
  { cat: 'Cabello',    sku: 'CAB-PAN-500', barcode: '0081009000050', name: 'Shampoo Pantene 500ml',         price: 395, cost: 245 },
  { cat: 'Cabello',    sku: 'CAB-PAN-ACO', barcode: '0081009000067', name: 'Acondicionador Pantene 500ml',  price: 395, cost: 245 },
  { cat: 'Cabello',    sku: 'CAB-TRE-CRE', barcode: '0081009000074', name: 'Crema de Peinar Tresemme',      price: 450, cost: 285 },
  { cat: 'Cabello',    sku: 'CAB-LOR-ACE', barcode: '0071249000012', name: "Aceite de Argan L'Oreal",       price: 695, cost: 445 },
  { cat: 'Tintes',     sku: 'TIN-LOR-NEG', barcode: '0071249100019', name: "Tinte L'Oreal Castano Oscuro",  price: 695, cost: 440 },
  { cat: 'Tintes',     sku: 'TIN-LOR-RUB', barcode: '0071249100026', name: "Tinte L'Oreal Rubio Medio",     price: 695, cost: 440 },
  { cat: 'Tintes',     sku: 'TIN-SCH-PLA', barcode: '4015100100010', name: 'Decolorante Schwarzkopf',       price: 850, cost: 540 },
  { cat: 'Unas',       sku: 'UNA-OPI-ROJ', barcode: '0094100020017', name: 'Esmalte OPI Rojo Clasico',      price: 395, cost: 240 },
  { cat: 'Unas',       sku: 'UNA-OPI-NUD', barcode: '0094100020024', name: 'Esmalte OPI Nude',              price: 395, cost: 240 },
  { cat: 'Unas',       sku: 'UNA-LIM-PRO', barcode: '0094100030011', name: 'Lima Profesional',              price: 85,  cost: 45 },
  { cat: 'Accesorios', sku: 'ACC-PIN-NEG', barcode: '6925281900019', name: 'Pinza Pelo Negra',              price: 125, cost: 65 },
  { cat: 'Accesorios', sku: 'ACC-RUL-ROS', barcode: '6925281900026', name: 'Rulos Velcro Rosa',             price: 245, cost: 150 },
]

async function seedBiz(label, businessId, items, qtyMin, qtyMax, minQty) {
  // Fetch existing SKUs for idempotency
  const { data: existing, error: exErr } = await sb
    .from('inventory_items')
    .select('sku')
    .eq('business_id', businessId)
  if (exErr) { console.error(`[${label}] fetch existing failed:`, exErr.message); return 0 }
  const have = new Set((existing || []).map(r => r.sku))

  let inserted = 0
  for (const p of items) {
    if (have.has(p.sku)) continue
    const { error } = await sb.from('inventory_items').insert({
      business_id: businessId, supabase_id: uuid(),
      sku: p.sku, barcode: p.barcode, name: p.name, category: p.cat,
      quantity: rand(qtyMin, qtyMax), min_quantity: minQty,
      price: p.price, cost: p.cost, active: true,
    })
    if (error) { console.log(`  [warn] ${label} ${p.sku}: ${error.message}`); continue }
    inserted++
  }
  return inserted
}

async function verify(label, businessId) {
  const { data, error } = await sb
    .from('inventory_items')
    .select('category')
    .eq('business_id', businessId)
  if (error) { console.error(`[${label}] verify failed:`, error.message); return }
  const total = data.length
  const byCat = {}
  for (const r of data) byCat[r.category || '(none)'] = (byCat[r.category || '(none)'] || 0) + 1
  const breakdown = Object.entries(byCat).map(([k, v]) => `${k}=${v}`).join(', ')
  console.log(`[${label}] total=${total} | ${breakdown}`)
}

const restN = await seedBiz('restaurant', RESTAURANT_ID, restaurantInv, 30, 100, 10)
const salonN = await seedBiz('salon', SALON_ID, salonInv, 15, 60, 5)

console.log(`restaurant: +${restN}, salon: +${salonN}`)
console.log('--- verification ---')
await verify('restaurant', RESTAURANT_ID)
await verify('salon', SALON_ID)
