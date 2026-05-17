// scripts/seed-carwash-bar-starter.mjs
//
// Reusable starter-pack seed for carwash+bar (hybrid) clients.
// NO fictitious clients. NO historical sales. ONLY catalog data:
//   - app_settings: business_type=hybrid + hybrid_components + restaurant_bar_mode + currency + itbis_pct
//   - services: 6 carwash + 15 bar/menu items
//   - inventory_items: 15 stockable bar/menu products + 6 carwash supplies
//   - mesas: 6 pre-configured tables
//
// USAGE
//   node scripts/seed-carwash-bar-starter.mjs --business-id=<UUID>
//   node scripts/seed-carwash-bar-starter.mjs --business-id=<UUID> --dry-run
//   node scripts/seed-carwash-bar-starter.mjs --business-id=<UUID> --force   # re-seed even if rows exist
//
// HARD RULES enforced:
//   - service-role bypasses RLS — uses SUPABASE_SERVICE_ROLE_KEY from .env
//   - every row: supabase_id = crypto.randomUUID(), updated_at = ISO now
//   - app_settings: is_device_local=false + device_hwid=null + supabase_id (per check constraint)
//   - explicit try/catch around every INSERT batch with full error log — NO empty catches
//   - idempotent: counts pre-existing rows per table; aborts unless --force
//   - --dry-run: prints exactly what would be inserted, writes nothing
//
// Idempotency check: counts services/inventory/mesas rows for the business_id and aborts
// if any are non-zero (unless --force). app_settings is upserted via natural key so it
// is always safe to re-run.

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

// ─── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const val  = (name) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const BID     = val('business-id')
const DRY_RUN = flag('dry-run')
const FORCE   = flag('force')

if (!BID) {
  console.error('ERROR: --business-id=<UUID> is required')
  console.error('Usage: node scripts/seed-carwash-bar-starter.mjs --business-id=<UUID> [--dry-run] [--force]')
  process.exit(2)
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(BID)) {
  console.error(`ERROR: --business-id is not a valid UUID: ${BID}`)
  process.exit(2)
}

// ─── Supabase client (service role) ───────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SVC_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SVC_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  process.exit(2)
}
const sb = createClient(SUPABASE_URL, SVC_KEY, { auth: { persistSession: false } })

const nowISO = () => new Date().toISOString()
const uuid   = () => crypto.randomUUID()

// ─── Catalog data ─────────────────────────────────────────────────────────
const APP_SETTINGS = [
  { key: 'business_type',       value: 'hybrid' },
  { key: 'hybrid_components',   value: 'carwash,restaurant' },
  { key: 'restaurant_bar_mode', value: 'false' },
  { key: 'currency',            value: 'DOP' },
  { key: 'itbis_pct',           value: '18' },
]

const CARWASH_SERVICES = [
  { name: 'Lavado Básico',          price: 200,  cost: 45,  category: 'Servicios Car Wash' },
  { name: 'Lavado Premium',         price: 350,  cost: 80,  category: 'Servicios Car Wash' },
  { name: 'Encerado a Mano',        price: 500,  cost: 120, category: 'Servicios Car Wash' },
  { name: 'Aspirado Profundo',      price: 250,  cost: 50,  category: 'Servicios Car Wash' },
  { name: 'Lavado Motor',           price: 400,  cost: 70,  category: 'Servicios Car Wash' },
  { name: 'Full Detail (Premium+Encerado+Aspirado)', price: 1000, cost: 220, category: 'Servicios Car Wash' },
]

// Each drink/food has: name, price, cost, kind ('drink' | 'food'), stockable=true means seed inventory_item too.
const MENU_ITEMS = [
  { name: 'Presidente 12oz',         price: 120, cost: 70,  kind: 'drink' },
  { name: 'Presidente 16oz',         price: 180, cost: 100, kind: 'drink' },
  { name: 'Heineken',                price: 200, cost: 120, kind: 'drink' },
  { name: 'Brugal Añejo (vaso)',     price: 200, cost: 80,  kind: 'drink' },
  { name: 'Brahma Light',            price: 130, cost: 75,  kind: 'drink' },
  { name: 'Coca-Cola 12oz',          price: 80,  cost: 35,  kind: 'drink' },
  { name: 'Sprite 12oz',             price: 80,  cost: 35,  kind: 'drink' },
  { name: 'Country Club Frambuesa',  price: 80,  cost: 35,  kind: 'drink' },
  { name: 'Agua 500ml',              price: 50,  cost: 15,  kind: 'drink' },
  { name: 'Red Bull',                price: 200, cost: 110, kind: 'drink' },
  { name: 'Chicharrón de Pollo',     price: 350, cost: 140, kind: 'food'  },
  { name: 'Tostones con Queso',      price: 200, cost: 60,  kind: 'food'  },
  { name: 'Yaroa de Pollo',          price: 400, cost: 160, kind: 'food'  },
  { name: 'Pica Pollo (1/4)',        price: 350, cost: 130, kind: 'food'  },
  { name: 'Sandwich Cubano',         price: 300, cost: 120, kind: 'food'  },
]

const CARWASH_SUPPLIES = [
  { name: 'Champú para auto 1gal',    cost: 450, quantity: 4, min_quantity: 2 },
  { name: 'Cera líquida 1gal',        cost: 650, quantity: 2, min_quantity: 1 },
  { name: 'Jabón para llantas 1gal',  cost: 380, quantity: 3, min_quantity: 2 },
  { name: 'Microfibras (paquete 10)', cost: 250, quantity: 5, min_quantity: 2 },
  { name: 'Ambientadores (paquete 50)', cost: 400, quantity: 2, min_quantity: 1 },
  { name: 'Limpiavidrios 1gal',       cost: 320, quantity: 3, min_quantity: 2 },
]

// ─── Row builders ─────────────────────────────────────────────────────────
function buildAppSettingsRows() {
  return APP_SETTINGS.map(s => ({
    business_id:     BID,
    key:             s.key,
    value:           s.value,
    supabase_id:     uuid(),
    is_device_local: false,
    device_hwid:     null,
    updated_at:      nowISO(),
  }))
}

function buildServiceRows() {
  const ts = nowISO()
  const carwash = CARWASH_SERVICES.map((s, i) => ({
    business_id:   BID,
    supabase_id:   uuid(),
    name:          s.name,
    category:      s.category,
    price:         s.price,
    cost:          s.cost,
    aplica_itbis:  true,
    is_wash:       true,
    is_menu_item:  false,
    no_commission: false,
    active:        true,
    in_stock:      true,
    sort_order:    i + 1,
    updated_at:    ts,
  }))
  const menu = MENU_ITEMS.map((m, i) => ({
    business_id:   BID,
    supabase_id:   uuid(),
    name:          m.name,
    category:      m.kind === 'drink' ? 'Bebidas' : 'Comida',
    price:         m.price,
    cost:          m.cost,
    aplica_itbis:  true,
    is_wash:       false,
    is_menu_item:  true,
    no_commission: false,
    active:        true,
    in_stock:      true,
    sort_order:    100 + i + 1,
    updated_at:    ts,
  }))
  return [...carwash, ...menu]
}

function buildInventoryRows() {
  const ts = nowISO()
  const bar = MENU_ITEMS.map((m, i) => ({
    business_id:  BID,
    supabase_id:  uuid(),
    sku:          (m.kind === 'drink' ? 'BAR' : 'KIT') + '-' + String(i + 1).padStart(3, '0'),
    name:         m.name,
    category:     m.kind === 'drink' ? 'Bebidas' : 'Comida',
    price:        m.price,
    cost:         m.cost,
    quantity:     24,
    min_quantity: 12,
    aplica_itbis: 1,
    active:       true,
    updated_at:   ts,
  }))
  const supplies = CARWASH_SUPPLIES.map((s, i) => ({
    business_id:  BID,
    supabase_id:  uuid(),
    sku:          'CWS-' + String(i + 1).padStart(3, '0'),
    name:         s.name,
    category:     'Insumos Car Wash',
    price:        0,
    cost:         s.cost,
    quantity:     s.quantity,
    min_quantity: s.min_quantity,
    aplica_itbis: 1,
    active:       true,
    updated_at:   ts,
  }))
  return [...bar, ...supplies]
}

function buildMesaRows() {
  const ts = nowISO()
  return Array.from({ length: 6 }, (_, i) => ({
    business_id: BID,
    supabase_id: uuid(),
    name:        `Mesa ${i + 1}`,
    status:      'libre',
    capacity:    4,
    sort_order:  i + 1,
    active:      true,
    rev:         0,
    updated_at:  ts,
  }))
}

// ─── Idempotency check ────────────────────────────────────────────────────
async function countExisting(table) {
  const { count, error } = await sb.from(table)
    .select('id', { count: 'exact', head: true })
    .eq('business_id', BID)
  if (error) throw new Error(`count(${table}) failed: ${error.message}`)
  return count || 0
}

// ─── Verify business exists ───────────────────────────────────────────────
async function verifyBusiness() {
  const { data, error } = await sb.from('businesses')
    .select('id, name, is_demo').eq('id', BID).maybeSingle()
  if (error) throw new Error(`businesses lookup failed: ${error.message}`)
  if (!data)  throw new Error(`business_id ${BID} not found in businesses table`)
  return data
}

// ─── Insert helpers (no silent catch) ─────────────────────────────────────
async function upsertAppSettings(rows) {
  // Natural key: (business_id, key, device_hwid) UNIQUE NULLS NOT DISTINCT.
  // For each row, manually look up by (business_id, key) and UPDATE or INSERT.
  // Doing it row-by-row avoids relying on PostgREST's on_conflict for the
  // NULLS-NOT-DISTINCT composite which has bitten us before.
  let inserted = 0, updated = 0
  for (const row of rows) {
    const { data: existing, error: selErr } = await sb.from('app_settings')
      .select('id').eq('business_id', BID).eq('key', row.key).is('device_hwid', null).maybeSingle()
    if (selErr) throw new Error(`app_settings select(${row.key}) failed: ${selErr.message}`)
    if (existing) {
      const { error } = await sb.from('app_settings')
        .update({ value: row.value, is_device_local: false, updated_at: row.updated_at })
        .eq('id', existing.id)
      if (error) throw new Error(`app_settings update(${row.key}) failed: ${error.message}`)
      updated++
    } else {
      const { error } = await sb.from('app_settings').insert(row)
      if (error) throw new Error(`app_settings insert(${row.key}) failed: ${error.message}`)
      inserted++
    }
  }
  return { inserted, updated }
}

async function insertRows(table, rows) {
  if (rows.length === 0) return 0
  // Chunk to avoid huge payloads (cap 100).
  let total = 0
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100)
    const { error } = await sb.from(table).insert(slice)
    if (error) throw new Error(`insert(${table}) chunk ${i}-${i + slice.length} failed: ${error.message}`)
    total += slice.length
  }
  return total
}

// ─── Dry-run printer ──────────────────────────────────────────────────────
function printDryRun({ appSettings, services, inventory, mesas }) {
  console.log('\n=== DRY RUN — no rows will be written ===\n')
  console.log(`business_id: ${BID}`)
  console.log(`timestamp:   ${nowISO()}`)

  const preview = (label, rows, fields) => {
    console.log(`\n[${label}] ${rows.length} row(s) — first 3:`)
    rows.slice(0, 3).forEach((r, i) => {
      const obj = Object.fromEntries(fields.map(f => [f, r[f]]))
      console.log(`  ${i + 1}. ${JSON.stringify(obj)}`)
    })
  }
  preview('app_settings',    appSettings, ['key','value','is_device_local','device_hwid'])
  preview('services',        services,    ['name','category','price','cost','is_wash','is_menu_item'])
  preview('inventory_items', inventory,   ['sku','name','category','cost','quantity','min_quantity'])
  preview('mesas',           mesas,       ['name','status','capacity','rev'])

  console.log('\n--- SUMMARY ---')
  console.log(`app_settings:    ${appSettings.length}`)
  console.log(`services:        ${services.length}`)
  console.log(`inventory_items: ${inventory.length}`)
  console.log(`mesas:           ${mesas.length}`)
  console.log('=========================================\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== seed-carwash-bar-starter ===')
  console.log(`business_id: ${BID}`)
  console.log(`dry-run:     ${DRY_RUN}`)
  console.log(`force:       ${FORCE}`)

  // 1. Verify business exists (skipped on --dry-run to allow offline rehearsal)
  let biz = null
  if (!DRY_RUN) {
    try {
      biz = await verifyBusiness()
      console.log(`business:    ${biz.name} (is_demo=${biz.is_demo})`)
    } catch (e) {
      console.error('FATAL:', e.message)
      process.exit(1)
    }
  } else {
    console.log('business:    (verification skipped — dry-run)')
  }

  // 2. Build all row sets in memory first
  const appSettings = buildAppSettingsRows()
  const services    = buildServiceRows()
  const inventory   = buildInventoryRows()
  const mesas       = buildMesaRows()

  if (DRY_RUN) {
    printDryRun({ appSettings, services, inventory, mesas })
    process.exit(0)
  }

  // 3. Idempotency: count pre-existing rows
  try {
    const counts = {
      services:        await countExisting('services'),
      inventory_items: await countExisting('inventory_items'),
      mesas:           await countExisting('mesas'),
    }
    const total = counts.services + counts.inventory_items + counts.mesas
    if (total > 0 && !FORCE) {
      console.error('\nABORT: business already has catalog rows. Use --force to re-seed.')
      console.error(`  services:        ${counts.services}`)
      console.error(`  inventory_items: ${counts.inventory_items}`)
      console.error(`  mesas:           ${counts.mesas}`)
      process.exit(3)
    }
    if (total > 0) console.warn(`WARN: --force re-seed; existing rows kept and new rows appended. (services=${counts.services}, inventory=${counts.inventory_items}, mesas=${counts.mesas})`)
  } catch (e) {
    console.error('FATAL idempotency check:', e.message)
    process.exit(1)
  }

  // 4. Insert
  const summary = { app_settings: 0, services: 0, inventory_items: 0, mesas: 0 }

  try {
    const r = await upsertAppSettings(appSettings)
    summary.app_settings = r.inserted + r.updated
    console.log(`app_settings:    inserted=${r.inserted} updated=${r.updated}`)
  } catch (e) {
    console.error('FATAL app_settings:', e.message); process.exit(1)
  }

  try {
    summary.services = await insertRows('services', services)
    console.log(`services:        inserted=${summary.services}`)
  } catch (e) {
    console.error('FATAL services:', e.message); process.exit(1)
  }

  try {
    summary.inventory_items = await insertRows('inventory_items', inventory)
    console.log(`inventory_items: inserted=${summary.inventory_items}`)
  } catch (e) {
    console.error('FATAL inventory_items:', e.message); process.exit(1)
  }

  try {
    summary.mesas = await insertRows('mesas', mesas)
    console.log(`mesas:           inserted=${summary.mesas}`)
  } catch (e) {
    console.error('FATAL mesas:', e.message); process.exit(1)
  }

  console.log('\n=== SEED COMPLETE ===')
  console.log(`business:        ${biz?.name || '(unknown)'} (${BID})`)
  console.log(`timestamp:       ${nowISO()}`)
  console.log(`app_settings:    ${summary.app_settings}`)
  console.log(`services:        ${summary.services}`)
  console.log(`inventory_items: ${summary.inventory_items}`)
  console.log(`mesas:           ${summary.mesas}`)
  console.log('=====================')
  process.exit(0)
}

main().catch(e => { console.error('UNCAUGHT FATAL:', e); process.exit(1) })
