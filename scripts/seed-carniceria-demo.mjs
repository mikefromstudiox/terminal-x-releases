// Seed the Carnicería demo Supabase tenant with realistic v2.16.3 data:
//   • E31 NCF sequence (auto-detect mayoreo on cobro)
//   • 6 inventory_items (sold-by-weight, lb, with received_at + expires_at)
//   • 6 carniceria_corte_categories (DR-popular cuts w/ tooltips)
//   • 2 inventory_freshness_log batches (one fresh, one near-expiry)
//   • 2 recurring_orders (mayoreo: martes pollo, viernes carne molida)
//   • 2 carniceria_scales (plataforma trasera + banco al frente)
//   • DR seasonal promotions (auto-seeded by date)
//
// Idempotent: every row is keyed by a deterministic supabase_id so re-runs are safe.
//
//   node scripts/seed-carniceria-demo.mjs

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL_  = process.env.SUPABASE_URL
const SVC   = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON  = process.env.SUPABASE_ANON_KEY
if (!URL_ || !SVC || !ANON) { console.error('Missing SUPABASE env'); process.exit(1) }

const EMAIL = 'admin@carniceria.demo.terminalxpos.com'
const PASS  = 'Demo2026!'
const svc   = createClient(URL_, SVC,  { auth: { persistSession: false } })
const anon  = createClient(URL_, ANON, { auth: { persistSession: false } })

// Deterministic UUID5 from a name + namespace so re-runs don't create dupes.
const NS = '6c0a1f5a-2e1c-4a25-8b7c-c2c2c2c2c2c2'
function det(name) {
  const h = crypto.createHash('sha1').update(NS + ':' + name).digest()
  // Build a v5-style UUID
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.toString('hex').slice(0, 32)
  return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20,32)}`
}

const today  = new Date()
const iso    = (d) => d.toISOString().slice(0, 10)
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d }

let pass = 0, fail = 0
function log(step, ok, detail = '') {
  const sym = ok ? '✅' : '❌'
  console.log(`${sym} ${step}${detail ? ' — ' + detail : ''}`)
  ok ? pass++ : fail++
}

async function upsert(table, rows, conflict = 'supabase_id') {
  const { error } = await svc.from(table).upsert(rows, { onConflict: conflict, ignoreDuplicates: false })
  if (error) console.log(`   ↳ [${table}] ${error.message}`)
  return error
}

async function run() {
  console.log('\n=== CARNICERÍA DEMO SEED ===\n')

  // 1. Resolve business_id via demo sign-in
  const { data: auth, error: aErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASS })
  log('auth: sign in as demo admin', !aErr && !!auth?.session, aErr?.message || EMAIL)
  if (!auth?.session) process.exit(1)
  const BID = auth.user?.user_metadata?.business_id
  log('business: resolve BID', !!BID, BID)

  // 2. NCF — E31 sequence (mayoreo auto-detect)
  // Schema: ncf_sequences (business_id, type, prefix, current_number, limit_number, valid_until, active, enabled)
  const ncfRows = [{
    supabase_id: det(`${BID}:ncf:E31`),
    business_id: BID,
    type: 'E31',
    prefix: 'E31',
    current_number: 1,
    limit_number: 100000000,
    valid_until: '2030-12-31',
    active: true,
    enabled: true,
    updated_at: new Date().toISOString(),
  }]
  // ncf_sequences has no unique on supabase_id; use natural key (business_id, type)
  const { data: existingNcf } = await svc.from('ncf_sequences')
    .select('id').eq('business_id', BID).eq('type', 'E31').maybeSingle()
  let ncfErr
  if (existingNcf) {
    ;({ error: ncfErr } = await svc.from('ncf_sequences')
      .update({ active: true, enabled: true, current_number: 1, limit_number: 100000000, valid_until: '2030-12-31', updated_at: new Date().toISOString() })
      .eq('id', existingNcf.id))
  } else {
    ;({ error: ncfErr } = await svc.from('ncf_sequences').insert(ncfRows))
  }
  if (ncfErr) console.log('   ↳ [ncf_sequences]', ncfErr.message)
  log('ncf: ensure E31 sequence', !ncfErr, existingNcf ? 'updated existing' : 'inserted new')

  // 3. Cortes catalog — 6 popular DR cuts
  const cortes = [
    { especie: 'pollo',     nombre: 'Pollo entero',         drp: 'Pollo entero',  tip: 'Pollo completo, sin trocear' },
    { especie: 'pollo',     nombre: 'Pechuga deshuesada',   drp: 'Pechuga',       tip: 'Pechuga sin hueso, lista para asar' },
    { especie: 'res',       nombre: 'Bistec de res',        drp: 'Bistec',        tip: 'Filete fino para freír' },
    { especie: 'res',       nombre: 'Costilla picada',      drp: 'Fricasé',       tip: 'Costilla cortada en cubos para guisar' },
    { especie: 'cerdo',     nombre: 'Pernil de cerdo',      drp: 'Pernil',        tip: 'Pieza completa para hornear (Navidad)' },
    { especie: 'embutidos', nombre: 'Longaniza fresca',     drp: 'Longaniza',     tip: 'Embutido fresco dominicano' },
  ]
  const corteRows = cortes.map((c, i) => ({
    supabase_id: det(`${BID}:corte:${c.nombre}`),
    business_id: BID,
    nombre: c.nombre,
    nombre_dr_popular: c.drp,
    tooltip_traduccion: c.tip,
    especie: c.especie,
    sort_order: i + 1,
    active: true,
    updated_at: new Date().toISOString(),
  }))
  log('cortes: upsert 6 categorías', !(await upsert('carniceria_corte_categories', corteRows)),
      cortes.map(c => c.drp).join(', '))

  // 4. Inventory items — 6 sold-by-weight rows w/ freshness dates
  // Schema notes: inventory_items requires (business_id, name, price, quantity, sold_by_weight,
  //   unit, price_per_unit). v2.16.3 columns: prepacked, expires_at, received_at, corte_category_supabase_id.
  const inv = [
    { name: 'Pollo entero',           price: 95,  ppu: 95,  cat: corteRows[0], days: 4, lote: 'POL-001' },
    { name: 'Pechuga deshuesada',     price: 175, ppu: 175, cat: corteRows[1], days: 3, lote: 'PEC-001' },
    { name: 'Bistec de res',          price: 280, ppu: 280, cat: corteRows[2], days: 5, lote: 'BIS-001' },
    { name: 'Carne molida (res)',     price: 210, ppu: 210, cat: corteRows[2], days: 2, lote: 'MOL-001' },
    { name: 'Costilla de cerdo',      price: 195, ppu: 195, cat: corteRows[4], days: 5, lote: 'COC-001' },
    { name: 'Longaniza fresca',       price: 185, ppu: 185, cat: corteRows[5], days: 7, lote: 'LON-001' },
  ]
  const invRows = inv.map((p, i) => ({
    supabase_id: det(`${BID}:inv:${p.name}`),
    business_id: BID,
    sku: 'CAR-' + String(i + 1).padStart(3, '0'),
    name: p.name,
    category: 'Carnes',
    price: p.price,
    cost: Math.round(p.price * 0.7),
    quantity: 50,
    min_quantity: 5,
    aplica_itbis: 1,
    sold_by_weight: true,
    unit: 'lb',
    price_per_unit: p.ppu,
    tare_default: 0.05,
    prepacked: false,
    corte_category_supabase_id: p.cat.supabase_id,
    received_at: iso(today),
    expires_at: iso(addDays(p.days)),
    active: true,
    updated_at: new Date().toISOString(),
  }))
  // inventory_items has no unique on supabase_id either — use (business_id, sku) natural key
  let invErr = null
  for (const row of invRows) {
    const { data: existing } = await svc.from('inventory_items')
      .select('id').eq('business_id', BID).eq('sku', row.sku).maybeSingle()
    const { sku, business_id, supabase_id, ...patch } = row
    if (existing) {
      const { error } = await svc.from('inventory_items').update(patch).eq('id', existing.id)
      if (error) { invErr = error; break }
    } else {
      const { error } = await svc.from('inventory_items').insert(row)
      if (error) { invErr = error; break }
    }
  }
  if (invErr) console.log('   ↳ [inventory_items]', invErr.message)
  log('inventory: upsert 6 sold-by-weight cortes', !invErr,
      inv.map(p => `${p.name}@RD$${p.ppu}/lb`).join(', '))

  // 5. Freshness batches — 1 fresh, 1 near-expiry (yellow band)
  const freshRows = [
    {
      supabase_id: det(`${BID}:fresh:POL-001`),
      business_id: BID,
      inventory_item_supabase_id: invRows[0].supabase_id,
      batch_lote: 'POL-001-2026-04-25',
      received_at: iso(today),
      expires_at: iso(addDays(4)),
      qty_received: 50, qty_remaining: 42,
      unit: 'lb', auto_discount_applied: false,
      updated_at: new Date().toISOString(),
    },
    {
      supabase_id: det(`${BID}:fresh:MOL-001`),
      business_id: BID,
      inventory_item_supabase_id: invRows[3].supabase_id,
      batch_lote: 'MOL-001-2026-04-23',
      received_at: iso(addDays(-2)),
      expires_at: iso(addDays(2)),  // 2-day amber band
      qty_received: 20, qty_remaining: 12,
      unit: 'lb', auto_discount_applied: false,
      updated_at: new Date().toISOString(),
    },
  ]
  log('freshness: upsert 2 batches (1 fresh, 1 amber)',
      !(await upsert('inventory_freshness_log', freshRows)),
      `${freshRows.length} batches`)

  // 6. Recurring orders — mayoreo
  // First need a client to attach. Use one of the existing RNC-bearing clients.
  const { data: rncClients } = await svc.from('clients')
    .select('supabase_id, name').eq('business_id', BID).not('rnc', 'is', null).limit(2)
  let recRows = []
  if (rncClients && rncClients.length >= 1) {
    const c1 = rncClients[0]
    const c2 = rncClients[1] || rncClients[0]
    recRows = [
      {
        supabase_id: det(`${BID}:rec:${c1.supabase_id}:martes`),
        business_id: BID,
        client_supabase_id: c1.supabase_id,
        nombre: 'Pedido típico martes',
        dia_semana: 2,
        items_json: JSON.stringify([{ qty: 50, unit: 'lb', name: 'Pollo entero', price_per_unit: 95 }]),
        total_estimado: 4750,
        whatsapp_confirmar: true,
        active: true,
        updated_at: new Date().toISOString(),
      },
      {
        supabase_id: det(`${BID}:rec:${c2.supabase_id}:viernes`),
        business_id: BID,
        client_supabase_id: c2.supabase_id,
        nombre: 'Pedido típico viernes',
        dia_semana: 5,
        items_json: JSON.stringify([
          { qty: 20, unit: 'lb', name: 'Carne molida (res)', price_per_unit: 210 },
          { qty: 10, unit: 'lb', name: 'Bistec de res',      price_per_unit: 280 },
        ]),
        total_estimado: 7000,
        whatsapp_confirmar: true,
        active: true,
        updated_at: new Date().toISOString(),
      },
    ]
    log('recurring: upsert 2 mayoreo orders', !(await upsert('recurring_orders', recRows)),
        recRows.map(r => r.nombre).join(' / '))
  } else {
    log('recurring: skipped — no RNC clients on demo', true, '(non-blocking)')
  }

  // 7. Multi-scale registry — plataforma trasera (default) + banco al frente
  const scaleRows = [
    {
      supabase_id: det(`${BID}:scale:plataforma`),
      business_id: BID,
      nombre: 'Plataforma trasera',
      tipo: 'plataforma',
      device_path: 'COM3',
      protocol: 'cas-pdii',
      baud_rate: 9600,
      capacidad_max_lb: 150,
      tare_default: 0.5,
      active_default: true,
      active: true,
      updated_at: new Date().toISOString(),
    },
    {
      supabase_id: det(`${BID}:scale:banco`),
      business_id: BID,
      nombre: 'Banco al frente',
      tipo: 'banco',
      device_path: 'COM4',
      protocol: 'generic',
      baud_rate: 9600,
      capacidad_max_lb: 30,
      tare_default: 0.05,
      active_default: false,
      active: true,
      updated_at: new Date().toISOString(),
    },
  ]
  log('scales: upsert 2 (plataforma + banco)', !(await upsert('carniceria_scales', scaleRows)),
      'plataforma=ACTIVA, banco=secundaria')

  // 8. Seasonal promotions — for the active season today (if any).
  const easter = (function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100
    const d = Math.floor(b / 4), e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4), k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(year, month - 1, day)
  })(today.getFullYear())
  function shift(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
  const promosCatalog = [
    { key: 'ano_nuevo',    start: new Date(today.getFullYear() - 1, 11, 26), end: new Date(today.getFullYear(), 0, 2),
      banner: '🎆 Año Nuevo — 10% en cortes premium' },
    { key: 'navidad',      start: new Date(today.getFullYear(), 11, 15), end: new Date(today.getFullYear(), 11, 24),
      banner: '🎄 Navidad — pernil y costilla con descuento' },
    { key: 'semana_santa', start: shift(easter, -7), end: easter,
      banner: '🐟 Semana Santa — pescado y mariscos' },
  ]
  const promoRows = promosCatalog.map((p, i) => ({
    supabase_id: det(`${BID}:promo:${p.key}:${p.start.getFullYear()}`),
    business_id: BID,
    name: p.banner.split('—')[0].trim(),
    tipo: 'pct',
    discount_pct: 10,
    start_date: iso(p.start),
    end_date: iso(p.end),
    season_key: p.key,
    banner_text: p.banner,
    active: true,
    updated_at: new Date().toISOString(),
  }))
  log('promotions: upsert 3 seasonal (ano_nuevo, navidad, semana_santa)',
      !(await upsert('promotions', promoRows)),
      promosCatalog.map(p => p.key).join(', '))

  await anon.auth.signOut()
  console.log(`\n=== SEED RESULTS: ${pass} pass / ${fail} fail ===`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch(e => { console.error('FATAL:', e); process.exit(1) })
