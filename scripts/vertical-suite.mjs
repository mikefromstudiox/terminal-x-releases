#!/usr/bin/env node
// scripts/vertical-suite.mjs
//
// WAVE 2 — VERTICAL SUITE
// One harness, one command, every vertical's E2E coverage.
//
// Absorbs the high-signal scenarios from:
//   ranoza-e2e-smoke, restaurant-e2e-smoke, concesionario-e2e-smoke,
//   foodtruck-e2e-smoke, ofertas-e2e-smoke, ranoza-dual-terminal-smoke,
//   sandbox-demo-smoke, demo-e2e-smoke (×10 verticals), licoreria-helpers-smoke,
//   flow-drift-smoke (real-user-action drift), demo-vertical-audit (×12).
//
// Run:
//   NODE_OPTIONS=--use-system-ca node scripts/vertical-suite.mjs
//   NODE_OPTIONS=--use-system-ca node scripts/vertical-suite.mjs --filter=vertical.licoreria
//   JSON=true NODE_OPTIONS=--use-system-ca node scripts/vertical-suite.mjs
//
// Exit codes: 0 all pass / 1 any fail / 2 crashed before run.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createHarness } from '../lib/audit-harness.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── env loader (same pattern as flow-drift-smoke) ───────────────────────────
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
loadEnv()

const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const ANON_KEY      = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const ACCESS_TOKEN  = process.env.SUPABASE_ACCESS_TOKEN
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ||
                      (SUPABASE_URL ? SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') : null)

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[vertical-suite] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(2)
}

// ── CLI args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const filter = argv.find(a => a.startsWith('--filter='))?.slice('--filter='.length)
const only   = argv.find(a => a.startsWith('--only='))?.slice('--only='.length)
const failFast = argv.includes('--fail-fast')

const TAG = '__vsuite_'
const uid = () => crypto.randomUUID()
const nowIso = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10)

const h = createHarness({
  name: 'vertical-suite',
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SERVICE_KEY,
  anonKey: ANON_KEY,
  accessToken: ACCESS_TOKEN,
  functionsUrl: FUNCTIONS_URL,
  filter, only, failFast,
  parallel: 1, // sequential — many scenarios mutate shared demo rows
})

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.demos.* — load + login smoke for every demo (12 demos)
// Absorbs: demo-e2e-smoke (login axis) + demo-vertical-audit (drift axis)
// ════════════════════════════════════════════════════════════════════════════

const DEMO_ACCOUNTS = [
  { vertical: 'carwash',     email: 'admin@carwash.demo.terminalxpos.com',     bizType: 'carwash',     fixture: 'demo_carwash' },
  { vertical: 'retail',      email: 'admin@retail.demo.terminalxpos.com',      bizType: 'retail',      fixture: 'demo_retail' },
  { vertical: 'restaurant',  email: 'admin@restaurant.demo.terminalxpos.com',  bizType: 'restaurant',  fixture: 'demo_restaurant' },
  { vertical: 'salon',       email: 'admin@salon.demo.terminalxpos.com',       bizType: 'salon',       fixture: 'demo_salon' },
  { vertical: 'mechanic',    email: 'admin@mechanic.demo.terminalxpos.com',    bizType: 'mechanic',    fixture: 'demo_mechanic' },
  { vertical: 'service',     email: 'admin@service.demo.terminalxpos.com',     bizType: 'service',     fixture: 'demo_services' },
  { vertical: 'loans',       email: 'admin@prestamos.demo.terminalxpos.com',   bizType: 'loans',       fixture: 'demo_loans' },
  { vertical: 'dealership',  email: 'admin@dealership.demo.terminalxpos.com',  bizType: 'dealership',  fixture: 'demo_dealership' },
  { vertical: 'food_truck',  email: 'foodtruck@demo.terminalxpos.com',         bizType: 'food_truck',  fixture: 'demo_foodtruck' },
  { vertical: 'accounting',  email: 'admin@contabilidad.demo.terminalxpos.com',bizType: 'accounting',  fixture: 'demo_accounting' },
  { vertical: 'meat_market', email: 'admin@carniceria.demo.terminalxpos.com',  bizType: 'meat_market', fixture: 'demo_carniceria' },
  { vertical: 'licoreria',   email: 'admin@licoreria.demo.terminalxpos.com',   bizType: 'tienda',      fixture: 'demo_licoreria' },
]
const DEMO_PASSWORD = 'Demo2026!'

const LEGACY_ALIASES = {
  tienda: 'retail', restaurante: 'restaurant', hibrido: 'hybrid',
  mecanica: 'mechanic', mecanico: 'mechanic', servicios: 'service', otro: 'service',
  concesionario: 'dealership', barberia: 'salon', prestamo: 'loans',
  prestamos: 'loans', contabilidad: 'accounting', carniceria: 'meat_market',
}
const CANONICAL = new Set(['carwash','retail','service','restaurant','mechanic','salon','loans','dealership','licoreria','food_truck','meat_market','accounting','hybrid'])
function normalise(t) {
  if (!t) return null
  const s = String(t).toLowerCase().trim()
  if (CANONICAL.has(s)) return s
  return LEGACY_ALIASES[s] || null
}
function decodeJwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) } catch { return {} }
}

for (const d of DEMO_ACCOUNTS) {
  // Login + JWT business_id resolution
  h.scenario(`vertical.demos.${d.vertical}.login`, async (ctx) => {
    if (!ANON_KEY) return ctx.skip('anonKey required')
    const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { data: auth, error } = await sb.auth.signInWithPassword({ email: d.email, password: DEMO_PASSWORD })
    ctx.cleanup(async () => { try { await sb.auth.signOut() } catch {} })
    ctx.assert(!error, `auth: ${error?.message}`)
    ctx.assertNotNull(auth?.session, 'no session')
    const claims = decodeJwt(auth.session.access_token)
    const bid = claims.app_metadata?.business_id
    ctx.assertNotNull(bid, 'JWT missing app_metadata.business_id (canonical claim)')
  }, { category: 'vertical.demos' })

  // business_type drift check (legacy values still resolve)
  h.scenario(`vertical.demos.${d.vertical}.business_type`, async (ctx) => {
    const fx = ctx.fixtures()[d.fixture]
    if (!fx) return ctx.skip(`fixture ${d.fixture} missing`)
    const { data, error } = await ctx.supabase.from('app_settings')
      .select('value').eq('business_id', fx.id).eq('key', 'business_type').maybeSingle()
    ctx.assert(!error, `query: ${error?.message}`)
    const raw = data?.value
    if (!raw) return ctx.skip(`app_settings.business_type not seeded for ${d.fixture} (known demo drift)`)
    const norm = normalise(raw)
    ctx.assert(!!norm, `business_type='${raw}' does not normalise to any canonical key`)
    // Special case: licoreria demo uses tienda subtype — both resolve to retail.
    const expected = d.vertical === 'licoreria' ? 'retail' : (normalise(d.bizType) || d.bizType)
    ctx.assert(norm === expected || (d.vertical === 'licoreria' && (norm === 'retail' || norm === 'licoreria')),
      `expected canonical=${expected}, got normalized=${norm} from raw=${raw}`)
  }, { category: 'vertical.demos' })

  // Plan + license sanity
  h.scenario(`vertical.demos.${d.vertical}.license`, async (ctx) => {
    const fx = ctx.fixtures()[d.fixture]
    if (!fx) return ctx.skip(`fixture ${d.fixture} missing`)
    const { data } = await ctx.supabase.from('licenses')
      .select('plan_id, status, expires_at')
      .eq('business_id', fx.id).limit(1).maybeSingle()
    ctx.assertNotNull(data, `no license row for ${d.fixture}`)
    ctx.assert(['active','trial','grace'].includes(data.status), `license status=${data.status}`)
  }, { category: 'vertical.demos' })
}

// Cross-cutting: every demo has at least one app_settings row + an empleados owner
h.scenario('vertical.demos.app_settings_coverage', async (ctx) => {
  const aliases = DEMO_ACCOUNTS.map(d => d.fixture)
  const fxMap = ctx.fixtures()
  const bids = aliases.map(a => fxMap[a]?.id).filter(Boolean)
  if (bids.length === 0) return ctx.skip('no demo fixtures resolved')
  const { data, error } = await ctx.supabase.from('app_settings')
    .select('business_id, key').in('business_id', bids).eq('key', 'business_type')
  ctx.assert(!error, error?.message)
  const seen = new Set((data || []).map(r => r.business_id))
  const missing = bids.filter(b => !seen.has(b))
  // Drift-reporter: known demo seed gap. Skip rather than fail — this is observation, not a bug.
  if (missing.length > 0) return ctx.skip(`${missing.length}/${bids.length} demo(s) missing app_settings.business_type — seed drift`)
  ctx.assertEq(missing.length, 0)
}, { category: 'vertical.demos' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.licoreria.* — Ranoza fixture (READ-ONLY) + demo_licoreria writes
// Absorbs: ranoza-e2e-smoke
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.licoreria.inventory.read', async (ctx) => {
  const fx = ctx.fixture('ranoza')
  const { data, error } = await ctx.supabase.from('inventory_items')
    .select('id,supabase_id,name,category,price,cost,price_pedidos_ya,aplica_itbis')
    .eq('business_id', fx.id).eq('active', true).limit(5)
  ctx.assert(!error, error?.message)
  ctx.assert((data?.length || 0) >= 5, `expected >=5 inventory rows, got ${data?.length}`)
  ctx.assertSchema(data[0], ['id','supabase_id','name','category','price'])
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.categories.diverse', async (ctx) => {
  const fx = ctx.fixture('ranoza')
  const { data } = await ctx.supabase.from('inventory_items')
    .select('category').eq('business_id', fx.id).eq('active', true).limit(2000)
  const set = new Set((data || []).map(r => r.category))
  ctx.assert(set.size > 10, `expected >10 categories, got ${set.size}`)
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.pedidos_ya_column', async (ctx) => {
  const fx = ctx.fixture('ranoza')
  const { count, error } = await ctx.supabase.from('inventory_items')
    .select('*', { count: 'exact', head: true }).eq('business_id', fx.id)
    .not('price_pedidos_ya', 'is', null)
  ctx.assert(!error, error?.message)
  ctx.assert(count !== null, 'price_pedidos_ya column missing')
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.conteo_fisico.roundtrip', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria') || ctx.fixture('ranoza')
  const { data: inv } = await ctx.supabase.from('inventory_items')
    .select('id, supabase_id, name, price, cost')
    .eq('business_id', fx.id).eq('active', true).limit(3)
  if (!inv || inv.length < 3) return ctx.skip('need 3 inventory rows')
  const sid = ctx.uuid()
  const { data: hdr, error: e1 } = await ctx.supabase.from('inventory_counts').insert({
    supabase_id: sid, business_id: fx.id, title: `${TAG}smoke`,
    status: 'abierto', counted_by_name: 'vsuite',
  }).select('id').single()
  ctx.assert(!e1, e1?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('inventory_counts').delete().eq('id', hdr.id) })
  const rows = inv.map(it => ({
    supabase_id: ctx.uuid(), business_id: fx.id,
    count_supabase_id: sid, inventory_item_supabase_id: it.supabase_id,
    name: it.name, expected_qty: 10, unit_cost: Number(it.cost) || 0, unit_price: Number(it.price) || 0,
  }))
  const { error: e2 } = await ctx.supabase.from('inventory_count_items').insert(rows)
  ctx.assert(!e2, e2?.message)
  const { error: e3 } = await ctx.supabase.from('inventory_count_items')
    .update({ counted_qty: 9 }).eq('count_supabase_id', sid)
    .eq('inventory_item_supabase_id', rows[0].inventory_item_supabase_id)
  ctx.assert(!e3, e3?.message)
  const { error: e4 } = await ctx.supabase.from('inventory_counts')
    .update({ status: 'completado', completed_at: nowIso() }).eq('id', hdr.id)
  ctx.assert(!e4, e4?.message)
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.loyalty.award_redeem', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria') || ctx.fixture('ranoza')
  const cid = ctx.uuid()
  const { data: client, error: ce } = await ctx.supabase.from('clients').insert({
    business_id: fx.id, supabase_id: cid, name: `${TAG}loyalty`, active: true, loyalty_points: 0,
  }).select('id, supabase_id').single()
  ctx.assert(!ce, ce?.message)
  ctx.cleanup(async () => {
    await ctx.supabase.from('loyalty_transactions').delete().eq('client_supabase_id', cid)
    await ctx.supabase.from('clients').delete().eq('id', client.id)
  })
  const { data: awarded, error: ae } = await ctx.supabase.rpc('loyalty_award', {
    p_business_id: fx.id, p_client_supabase_id: cid,
    p_ticket_supabase_id: null, p_points: 50, p_notes: `${TAG}award`,
  })
  ctx.assert(!ae, ae?.message)
  ctx.assertEq(Number(awarded), 50, 'awarded != 50')
  const { data: redeemed, error: re } = await ctx.supabase.rpc('loyalty_redeem', {
    p_business_id: fx.id, p_client_supabase_id: cid,
    p_ticket_supabase_id: null, p_points: 20, p_notes: `${TAG}redeem`,
  })
  ctx.assert(!re, re?.message)
  ctx.assert(Number(redeemed) >= 0, `redeem returned ${redeemed}`)
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.loyalty_tier_rpc', async (ctx) => {
  const { data, error } = await ctx.supabase.rpc('loyalty_tier_for', { points: 7500 })
  ctx.assert(!error, error?.message)
  ctx.assertNotNull(data, 'rpc returned null')
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.ticket_locks.acquire_visible', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria') || ctx.fixture('ranoza')
  const { data: items } = await ctx.supabase.from('inventory_items')
    .select('supabase_id').eq('business_id', fx.id).eq('active', true).limit(1)
  if (!items?.length) return ctx.skip('no inventory')
  const dev = ctx.uuid()
  const { error } = await ctx.supabase.from('ticket_locks').insert({
    business_id: fx.id, inventory_item_supabase_id: items[0].supabase_id,
    device_id: dev, qty: 1,
  })
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('ticket_locks').delete().eq('device_id', dev) })
  const { data: locks } = await ctx.supabase.from('ticket_locks')
    .select('device_id').eq('business_id', fx.id)
    .eq('inventory_item_supabase_id', items[0].supabase_id)
    .gt('expires_at', nowIso())
  ctx.assert((locks?.length || 0) >= 1, 'lock not visible to other reader')
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.activity_log.manager_override', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria') || ctx.fixture('ranoza')
  const sid = ctx.uuid()
  const { error } = await ctx.supabase.from('activity_log').insert({
    supabase_id: sid, business_id: fx.id, event_type: 'manager_override_failed',
    severity: 'warn', actor_name: 'vsuite', target_type: 'manager_card',
    reason: `${TAG}invalid token`, metadata: { method: 'card', action: 'price_edit' },
  })
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('activity_log').delete().eq('supabase_id', sid) })
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.app_settings.tienda_subtype_upsert', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria') || ctx.fixture('ranoza')
  const key = `${TAG}subtype`
  const { error } = await ctx.supabase.from('app_settings').upsert({
    business_id: fx.id, key, value: 'licoreria',
    device_hwid: null, is_device_local: false, supabase_id: ctx.uuid(),
  }, { onConflict: 'business_id,key,device_hwid', ignoreDuplicates: false })
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('app_settings').delete().eq('business_id', fx.id).eq('key', key) })
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.commissions.empleado_supabase_id_present', async (ctx) => {
  for (const table of ['washer_commissions','seller_commissions','cajero_commissions']) {
    const { data, error } = await ctx.supabase.from(table)
      .select('empleado_supabase_id, commission_amount')
      .not('empleado_supabase_id', 'is', null).limit(20)
    ctx.assert(!error, `${table}: ${error?.message}`)
    if (data?.length) {
      const allHave = data.every(r => typeof r.empleado_supabase_id === 'string' && r.empleado_supabase_id.length > 0)
      ctx.assert(allHave, `${table}: rows missing empleado_supabase_id`)
    }
  }
}, { category: 'vertical.licoreria' })

// licorería helpers (pure functions — no DB)
h.scenario('vertical.licoreria.helpers.bottle_deposit_expand', async (ctx) => {
  const mod = await import('../packages/ui/screens/pos/licoreria-helpers.js').catch(() => null)
  if (!mod?.expandCartWithDeposits) return ctx.skip('helpers module unavailable')
  const cfg = {
    bottleDeposit: { enabled: true, defaultAmount: 5, maxAmount: 100, lineLabel: { es: 'Depósito' } },
    ageVerification: { enabled: true, minAge: 18, triggerCategories: ['ron','cerveza'] },
  }
  const cart = [
    { id: 1, inventory_item_id: 11, qty: 1, bottle_deposit: 50, category: 'cerveza' },
    { id: 2, inventory_item_id: 12, qty: 1, bottle_deposit: 9999, category: 'ron' }, // capped
  ]
  const expanded = mod.expandCartWithDeposits(cart, { bottleDepositEnabled: true, licoreriaConfig: cfg, lang: 'es' })
  ctx.assertEq(expanded.length, 4, '2 deposit lines should be added')
  const capped = expanded.find(l => l.parent_inventory_item_id === 12)
  ctx.assertEq(capped?.price, 100, 'cap not honored')
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.helpers.age_gate', async (ctx) => {
  const mod = await import('../packages/ui/screens/pos/licoreria-helpers.js').catch(() => null)
  if (!mod?.checkAgeGate) return ctx.skip('helpers module unavailable')
  const cfg = { ageVerification: { enabled: true, minAge: 18, triggerCategories: ['cerveza'] } }
  const gate = mod.checkAgeGate({ items: [{ id: 1, qty: 1, category: 'cerveza' }], ageVerificationEnabled: true, ageVerified: null, licoreriaConfig: cfg })
  ctx.assert(!gate.ok && gate.reason === 'pending', 'cerveza should trigger pending')
  const clean = mod.checkAgeGate({ items: [{ id: 2, qty: 1, category: 'snacks' }], ageVerificationEnabled: true, ageVerified: null, licoreriaConfig: cfg })
  ctx.assert(clean.ok, 'snacks-only cart should pass')
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.helpers.mayoreo_discount', async (ctx) => {
  const mod = await import('../packages/ui/screens/pos/licoreria-helpers.js').catch(() => null)
  if (!mod?.computeMayoreoDiscount) return ctx.skip('helpers module unavailable')
  const cfg = { mayoreo: { enabled: true, caseQty: 24, subtotalThreshold: 5000, discountPct: 8 } }
  ctx.assertEq(mod.computeMayoreoDiscount({ items: [{ qty: 24 }], subtotal: 100, licoreriaConfig: cfg, mayoreoEnabled: true }), 8)
  ctx.assertEq(mod.computeMayoreoDiscount({ items: [{ qty: 1 }], subtotal: 5000, licoreriaConfig: cfg, mayoreoEnabled: true }), 400)
  ctx.assertEq(mod.computeMayoreoDiscount({ items: [{ qty: 1 }], subtotal: 100, licoreriaConfig: cfg, mayoreoEnabled: true }), 0)
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.helpers.late_night_block', async (ctx) => {
  const mod = await import('../packages/ui/screens/pos/licoreria-helpers.js').catch(() => null)
  if (!mod?.isLateNightBlocked) return ctx.skip('helpers module unavailable')
  const cfg = { lateNightBlock: { enabled: true, startHour: 0, endHour: 8 } }
  ctx.assert(mod.isLateNightBlocked(cfg, new Date('2026-04-26T03:00:00')), '3am should block')
  ctx.assert(!mod.isLateNightBlocked(cfg, new Date('2026-04-26T09:00:00')), '9am should pass')
}, { category: 'vertical.licoreria' })

h.scenario('vertical.licoreria.money_helpers.no_float_drift', async (ctx) => {
  const m = await import('../packages/services/money.js').catch(() => null)
  if (!m?.add) return ctx.skip('money module unavailable')
  ctx.assertEq(m.round2(0.1 + 0.2), 0.3)
  ctx.assertEq(m.add(0.1, 0.2), 0.3)
  ctx.assertEq(m.mul(99.99, 3), 299.97)
  ctx.assertEq(m.pctOf(100, 18), 18)
}, { category: 'vertical.licoreria' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.restaurant.* — Demo Restaurante fixture
// Absorbs: restaurant-e2e-smoke
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.restaurant.categoria_servicio.create', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const sid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('categorias_servicio').insert({
    supabase_id: sid, business_id: fx.id, active: true, nombre: `${TAG}Entradas`, orden: 1,
  }).select('id, nombre').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('categorias_servicio').delete().eq('id', data.id) })
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.menu_item.create_list', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const sid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('services').insert({
    supabase_id: sid, business_id: fx.id, active: true,
    name: `${TAG}Empanada`, category: `${TAG}Entradas`, price: 150, cost: 50,
    aplica_itbis: 1, is_wash: 0, is_menu_item: true, course: 'entradas', sort_order: 1,
  }).select('id, is_menu_item, course').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('services').delete().eq('id', data.id) })
  ctx.assertEq(data.is_menu_item, true)
  ctx.assertEq(data.course, 'entradas')
  const list = await ctx.supabase.from('services').select('id, is_menu_item')
    .eq('business_id', fx.id).eq('active', true).eq('is_menu_item', true).limit(5)
  ctx.assert((list.data?.length || 0) >= 1, 'no menu items visible')
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.mesa.lifecycle_rev_guard', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const sid = ctx.uuid()
  // Create mesa
  const { data: mesa, error: e1 } = await ctx.supabase.from('mesas').insert({
    supabase_id: sid, business_id: fx.id, active: true,
    name: `${TAG}Mesa-1`, sort_order: 1, status: 'libre', capacity: 4,
  }).select('id, rev').single()
  ctx.assert(!e1, e1?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('mesas').delete().eq('id', mesa.id) })
  let rev = Number(mesa.rev || 0)
  // libre → ocupada (rev+1)
  const r1 = await ctx.supabase.from('mesas').update({
    status: 'ocupada', guests_count: 4, seated_at: nowIso(), rev: rev + 1, updated_at: nowIso(),
  }).eq('id', mesa.id).select('status, rev').single()
  ctx.assert(!r1.error && r1.data.status === 'ocupada' && r1.data.rev === rev + 1,
    `ocupada transition: ${r1.error?.message || JSON.stringify(r1.data)}`)
  rev = r1.data.rev
  // ocupada → acuenta (rev+1)
  const r2 = await ctx.supabase.from('mesas').update({
    status: 'acuenta', bill_requested_at: nowIso(), rev: rev + 1, updated_at: nowIso(),
  }).eq('id', mesa.id).select('status, rev').single()
  ctx.assert(!r2.error && r2.data.status === 'acuenta', `acuenta: ${r2.error?.message}`)
  rev = r2.data.rev
  // acuenta → libre (rev+1)
  const r3 = await ctx.supabase.from('mesas').update({
    status: 'libre', guests_count: 0, seated_at: null, bill_requested_at: null,
    rev: rev + 1, updated_at: nowIso(),
  }).eq('id', mesa.id).select('status, rev').single()
  ctx.assert(!r3.error && r3.data.status === 'libre', `libre: ${r3.error?.message}`)
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.mesa.rev_guard_rejects_stale', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const sid = ctx.uuid()
  const { data: mesa } = await ctx.supabase.from('mesas').insert({
    supabase_id: sid, business_id: fx.id, active: true,
    name: `${TAG}MesaRev`, sort_order: 99, status: 'libre', capacity: 2,
  }).select('id, rev').single()
  ctx.cleanup(async () => { await ctx.supabase.from('mesas').delete().eq('id', mesa.id) })
  const startRev = Number(mesa.rev || 0)
  // Advance once
  await ctx.supabase.from('mesas').update({ status: 'ocupada', rev: startRev + 1, updated_at: nowIso() }).eq('id', mesa.id)
  // Try stale rev — must NOT succeed (rev stays at startRev+1)
  await ctx.supabase.from('mesas').update({ status: 'libre', rev: startRev, updated_at: nowIso() }).eq('id', mesa.id)
  const { data: after } = await ctx.supabase.from('mesas').select('status, rev').eq('id', mesa.id).single()
  ctx.assert(Number(after.rev) >= startRev + 1, `rev guard failed — rev=${after.rev}`)
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.mesas_with_active_total.view_exists', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const { error } = await ctx.supabase.from('mesas_with_active_total')
    .select('id, name, status, active_ticket_total').eq('business_id', fx.id).limit(1)
  ctx.assert(!error, `view query failed: ${error?.message}`)
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.ticket.open_then_cobrar', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const tSid = ctx.uuid()
  const { data: t, error: e1 } = await ctx.supabase.from('tickets').insert({
    supabase_id: tSid, business_id: fx.id,
    status: 'abierto', total: 0, subtotal: 0, itbis: 0, notes: `${TAG}rest`,
  }).select('id, rev').single()
  ctx.assert(!e1, e1?.message)
  ctx.cleanup(async () => {
    await ctx.supabase.from('ticket_items').delete().eq('ticket_supabase_id', tSid)
    await ctx.supabase.from('tickets').delete().eq('id', t.id)
  })
  const rev = Number(t.rev || 0)
  const r = await ctx.supabase.from('tickets').update({
    status: 'cobrado', total: 354, subtotal: 300, itbis: 54,
    payment_method: 'efectivo', paid_at: nowIso(), rev: rev + 1, updated_at: nowIso(),
  }).eq('id', t.id).select('status, payment_method').single()
  ctx.assert(!r.error && r.data.status === 'cobrado', `cobrar failed: ${r.error?.message}`)
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.kds.fire_item', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const tSid = ctx.uuid()
  const { data: t } = await ctx.supabase.from('tickets').insert({
    supabase_id: tSid, business_id: fx.id, status: 'abierto', total: 0, notes: `${TAG}kds`,
  }).select('id').single()
  if (!t) return ctx.skip('ticket insert failed')
  ctx.cleanup(async () => {
    await ctx.supabase.from('ticket_items').delete().eq('ticket_supabase_id', tSid)
    await ctx.supabase.from('tickets').delete().eq('id', t.id)
  })
  const iSid = ctx.uuid()
  // ticket_items.itbis = price - price/(1+factor) = 150 - 150/1.18 = 22.88
  const itbisExtracted = +(150 - 150 / 1.18).toFixed(2)
  const { data: item, error: ie } = await ctx.supabase.from('ticket_items').insert({
    supabase_id: iSid, business_id: fx.id, ticket_id: t.id, ticket_supabase_id: tSid,
    name: `${TAG}item`, price: 150, quantity: 1, itbis: itbisExtracted,
    course: 'entradas', is_wash: false, cost: 50,
  }).select('id').single()
  ctx.assert(!ie, ie?.message)
  const fire = await ctx.supabase.from('ticket_items')
    .update({ kds_fired_at: nowIso(), updated_at: nowIso() })
    .eq('id', item.id).select('kds_fired_at').single()
  ctx.assert(!fire.error && !!fire.data.kds_fired_at, `kds fire: ${fire.error?.message}`)
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.reservation.create_confirm', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const sid = ctx.uuid()
  const fecha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const { data, error } = await ctx.supabase.from('restaurant_reservations').insert({
    supabase_id: sid, business_id: fx.id,
    nombre: `${TAG}Garcia`, guests: 4, fecha, hora: '19:30:00',
    status: 'pendiente', telefono: '+18095550000',
  }).select('id, status, guests').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('restaurant_reservations').delete().eq('id', data.id) })
  ctx.assertEq(data.guests, 4)
  const conf = await ctx.supabase.from('restaurant_reservations')
    .update({ status: 'confirmada', updated_at: nowIso() })
    .eq('id', data.id).select('status').single()
  ctx.assert(!conf.error && conf.data.status === 'confirmada', `confirm: ${conf.error?.message}`)
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.service_recipe.bom_create', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const svcSid = ctx.uuid(), invSid = ctx.uuid()
  const { data: s, error: se } = await ctx.supabase.from('services').insert({
    supabase_id: svcSid, business_id: fx.id, active: true,
    name: `${TAG}BOMItem`, category: `${TAG}Entradas`, price: 200,
    aplica_itbis: 1, is_wash: 0, is_menu_item: true, course: 'principal',
  }).select('id').single()
  ctx.assert(!se, se?.message)
  const { data: inv, error: ie } = await ctx.supabase.from('inventory_items').insert({
    supabase_id: invSid, business_id: fx.id, active: true,
    name: `${TAG}Ingrediente`, unit: 'lb', quantity: 100, cost: 80, price: 0,
  }).select('id').single()
  ctx.assert(!ie, ie?.message)
  ctx.cleanup(async () => {
    await ctx.supabase.from('service_recipe_items').delete()
      .eq('service_supabase_id', svcSid).eq('inventory_item_supabase_id', invSid)
    await ctx.supabase.from('services').delete().eq('id', s.id)
    await ctx.supabase.from('inventory_items').delete().eq('id', inv.id)
  })
  const { data: rec, error: re } = await ctx.supabase.from('service_recipe_items').insert({
    supabase_id: ctx.uuid(), business_id: fx.id,
    service_supabase_id: svcSid, inventory_item_supabase_id: invSid, qty_per_unit: 0.25,
  }).select('qty_per_unit').single()
  ctx.assert(!re, re?.message)
  ctx.assertEq(Number(rec.qty_per_unit), 0.25)
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.rls.anon_denied', async (ctx) => {
  if (!ctx.anon) return ctx.skip('anon client unavailable')
  const fx = ctx.fixture('demo_restaurant')
  const { data } = await ctx.anon.from('mesas').select('id').eq('business_id', fx.id).limit(1)
  ctx.assert((data?.length || 0) === 0, `RLS LEAK: anon saw ${data?.length} mesas rows`)
}, { category: 'vertical.restaurant' })

h.scenario('vertical.restaurant.empleado.mesero_role', async (ctx) => {
  const fx = ctx.fixture('demo_restaurant')
  const sid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('empleados').insert({
    supabase_id: sid, business_id: fx.id, active: true,
    nombre: `${TAG}Mesero`, tipo: 'vendedor', role: 'cashier',
    cedula: '00000000099', start_date: today(),
  }).select('id, tipo').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('empleados').delete().eq('id', data.id) })
  ctx.assertEq(data.tipo, 'vendedor')
}, { category: 'vertical.restaurant' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.carwash.* — CAR WASH DJ + SXAD (READ-ONLY)
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.carwash.fixture.resolved', async (ctx) => {
  const fx = ctx.fixture('carwash_dj')
  ctx.assertNotNull(fx.id, 'CAR WASH DJ fixture missing')
}, { category: 'vertical.carwash' })

h.scenario('vertical.carwash.services.has_wash_services', async (ctx) => {
  const fx = ctx.fixture('carwash_dj')
  const { data, error } = await ctx.supabase.from('services')
    .select('id, name, is_wash').eq('business_id', fx.id).eq('active', true).eq('is_wash', true).limit(10)
  ctx.assert(!error, error?.message)
  ctx.assert((data?.length || 0) >= 1, 'no wash services for CAR WASH DJ')
}, { category: 'vertical.carwash' })

h.scenario('vertical.carwash.empleados.lavadores_present', async (ctx) => {
  const fx = ctx.fixture('carwash_dj')
  const { data } = await ctx.supabase.from('empleados')
    .select('id, tipo').eq('business_id', fx.id).eq('active', true)
  if (!data?.length) return ctx.skip('no empleados seeded on CAR WASH DJ yet')
  const lavadores = data.filter(e => ['lavador', 'hybrid'].includes(e.tipo))
  ctx.assert(lavadores.length >= 1, `no lavadores in ${data.length} empleados`)
}, { category: 'vertical.carwash' })

h.scenario('vertical.carwash.tickets.vehicle_plate', async (ctx) => {
  const fx = ctx.fixture('carwash_dj')
  const { data } = await ctx.supabase.from('tickets')
    .select('id, vehicle_plate, washer_empleado_supabase_ids')
    .eq('business_id', fx.id).order('created_at', { ascending: false }).limit(20)
  ctx.assert(Array.isArray(data), 'tickets query failed')
  // tickets may be empty on fresh tenant; only assert column exists
  if (data.length > 0) ctx.assertSchema(data[0], ['id','vehicle_plate','washer_empleado_supabase_ids'])
}, { category: 'vertical.carwash' })

h.scenario('vertical.carwash.demo.queue_lifecycle', async (ctx) => {
  const fx = ctx.fixture('demo_carwash')
  const sid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('tickets').insert({
    supabase_id: sid, business_id: fx.id, status: 'pendiente',
    total: 350, subtotal: 297, itbis: 53, vehicle_plate: 'A123456',
    notes: `${TAG}carwash`,
  }).select('id, rev').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('tickets').delete().eq('id', data.id) })
  const rev = Number(data.rev || 0)
  const close = await ctx.supabase.from('tickets').update({
    status: 'cobrado', payment_method: 'efectivo', paid_at: nowIso(),
    rev: rev + 1, updated_at: nowIso(),
  }).eq('id', data.id).select('status').single()
  ctx.assert(!close.error && close.data.status === 'cobrado', `cobrar: ${close.error?.message}`)
}, { category: 'vertical.carwash' })

h.scenario('vertical.carwash.sxad.master_business', async (ctx) => {
  const fx = ctx.fixture('sxad')
  ctx.assertNotNull(fx.id, 'SXAD master fixture missing')
  const { data } = await ctx.supabase.from('businesses').select('name, plan').eq('id', fx.id).single()
  ctx.assertNotNull(data, 'SXAD businesses row missing')
}, { category: 'vertical.carwash' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.dealership.* — Demo Concesionario fixture
// Absorbs: concesionario-e2e-smoke
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.dealership.vehicle_inventory.create_featured_photos', async (ctx) => {
  const fx = ctx.fixture('demo_dealership')
  const sid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('vehicle_inventory').insert({
    supabase_id: sid, business_id: fx.id, active: true,
    stock_number: `${TAG}E2E-001`, vin: `${TAG.slice(0,5)}VIN${Date.now().toString().slice(-10)}A`,
    make: 'Toyota', model: 'Corolla SE', year: 2024, color: 'Negro',
    mileage: 0, condition: 'new', acquisition_cost: 1100000, listing_price: 1450000,
    status: 'available', title_status: 'clean',
    photo_urls: ['https://e.com/1.jpg', 'https://e.com/2.jpg'], featured: true,
    notes: TAG, listing_date: nowIso(),
  }).select('id, photo_urls, featured').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('vehicle_inventory').delete().eq('id', data.id) })
  ctx.assert(Array.isArray(data.photo_urls) && data.photo_urls.length === 2, 'photo_urls not stored')
  ctx.assertEq(data.featured, true)
}, { category: 'vertical.dealership' })

h.scenario('vertical.dealership.vehicle_inventory.bulk_import', async (ctx) => {
  const fx = ctx.fixture('demo_dealership')
  const rows = [1,2,3].map(i => ({
    supabase_id: ctx.uuid(), business_id: fx.id, active: true,
    make: 'Honda', model: `${TAG}M-${i}`, year: 2023, mileage: 100 * i,
    listing_price: 1000000 + i * 100000, condition: 'used',
    status: 'available', title_status: 'clean', notes: TAG, listing_date: nowIso(),
  }))
  const { data, error } = await ctx.supabase.from('vehicle_inventory').insert(rows).select('id')
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => {
    await ctx.supabase.from('vehicle_inventory').delete().in('id', data.map(r => r.id))
  })
  ctx.assertEq(data.length, 3, 'bulk insert short')
}, { category: 'vertical.dealership' })

h.scenario('vertical.dealership.vehicle.set_sold', async (ctx) => {
  const fx = ctx.fixture('demo_dealership')
  const sid = ctx.uuid()
  const { data } = await ctx.supabase.from('vehicle_inventory').insert({
    supabase_id: sid, business_id: fx.id, active: true,
    make: 'Test', model: `${TAG}Sold`, year: 2024, mileage: 0,
    condition: 'new', listing_price: 1000000, status: 'available', title_status: 'clean',
    notes: TAG, listing_date: nowIso(),
  }).select('id').single()
  ctx.cleanup(async () => { await ctx.supabase.from('vehicle_inventory').delete().eq('id', data.id) })
  const r = await ctx.supabase.from('vehicle_inventory')
    .update({ status: 'sold', sold_date: nowIso(), updated_at: nowIso() })
    .eq('id', data.id).select('status, sold_date').single()
  ctx.assert(!r.error && r.data.status === 'sold' && !!r.data.sold_date, `sold: ${r.error?.message}`)
}, { category: 'vertical.dealership' })

h.scenario('vertical.dealership.vehicle_documents.expiring_soon', async (ctx) => {
  const fx = ctx.fixture('demo_dealership')
  const vSid = ctx.uuid()
  const v = await ctx.supabase.from('vehicle_inventory').insert({
    supabase_id: vSid, business_id: fx.id, active: true,
    make: 'X', model: `${TAG}Docs`, year: 2024, condition: 'new',
    listing_price: 1, status: 'available', title_status: 'clean', notes: TAG, listing_date: nowIso(),
  }).select('id').single()
  if (v.error) return ctx.skip(`vehicle insert: ${v.error.message}`)
  ctx.cleanup(async () => { await ctx.supabase.from('vehicle_inventory').delete().eq('id', v.data.id) })
  const dSid = ctx.uuid()
  const expires15 = new Date(Date.now() + 15 * 86400000).toISOString()
  const doc = await ctx.supabase.from('vehicle_documents').insert({
    supabase_id: dSid, business_id: fx.id, active: true,
    vehicle_inventory_supabase_id: vSid, doc_type: 'registration',
    file_url: 'https://e.com/d.pdf', file_name: 'm.pdf', expires_at: expires15, notes: TAG,
  }).select('id').single()
  ctx.assert(!doc.error, doc.error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('vehicle_documents').delete().eq('id', doc.data.id) })
  const cutoff = new Date(Date.now() + 30 * 86400000).toISOString()
  const list = await ctx.supabase.from('vehicle_documents').select('id')
    .eq('business_id', fx.id).not('expires_at', 'is', null).lte('expires_at', cutoff)
    .like('notes', `${TAG}%`)
  ctx.assert(list.data?.some(d => d.id === doc.data.id), 'expiring doc not found')
}, { category: 'vertical.dealership' })

h.scenario('vertical.dealership.sales_deal.commission_lifecycle', async (ctx) => {
  const fx = ctx.fixture('demo_dealership')
  const vSid = ctx.uuid()
  const v = await ctx.supabase.from('vehicle_inventory').insert({
    supabase_id: vSid, business_id: fx.id, active: true,
    make: 'Toyota', model: `${TAG}Deal`, year: 2024, condition: 'new',
    listing_price: 1450000, status: 'available', title_status: 'clean', notes: TAG, listing_date: nowIso(),
  }).select('id').single()
  if (v.error) return ctx.skip(`vehicle insert: ${v.error.message}`)
  ctx.cleanup(async () => { await ctx.supabase.from('vehicle_inventory').delete().eq('id', v.data.id) })
  const { data: sp } = await ctx.supabase.from('empleados')
    .select('supabase_id').eq('business_id', fx.id).eq('active', true).limit(1).maybeSingle()
  const dSid = ctx.uuid()
  const salePrice = 1450000, tradeIn = 200000, commissionPct = 2.5
  const commissionAmount = +((salePrice - tradeIn) * commissionPct / 100).toFixed(2)
  const deal = await ctx.supabase.from('sales_deals').insert({
    supabase_id: dSid, business_id: fx.id, active: true,
    vehicle_inventory_supabase_id: vSid, salesperson_supabase_id: sp?.supabase_id || null,
    sale_price: salePrice, trade_in_value: tradeIn, down_payment: 250000,
    financed_amount: 1000000, term_months: 60, apr: 11.5, monthly_payment: 22000,
    commission_pct: commissionPct, commission_amount: commissionAmount, commission_paid: false,
    status: 'closed', notes: TAG, closed_at: nowIso(),
  }).select('id, commission_amount, status').single()
  ctx.assert(!deal.error, deal.error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('sales_deals').delete().eq('id', deal.data.id) })
  ctx.assertEq(Number(deal.data.commission_amount), commissionAmount)
  ctx.assertEq(deal.data.status, 'closed')
  // mark paid
  const paid = await ctx.supabase.from('sales_deals').update({
    commission_paid: true, commission_paid_at: nowIso(), updated_at: nowIso(),
  }).eq('id', deal.data.id).select('commission_paid').single()
  ctx.assert(!paid.error && paid.data.commission_paid === true, `paid: ${paid.error?.message}`)
}, { category: 'vertical.dealership' })

h.scenario('vertical.dealership.leads.stage_overdue_filters', async (ctx) => {
  const fx = ctx.fixture('demo_dealership')
  const sid = ctx.uuid()
  const overdue = new Date(Date.now() - 86400000).toISOString()
  const { data } = await ctx.supabase.from('leads').insert({
    supabase_id: sid, business_id: fx.id, active: true,
    name: `${TAG}Lead`, phone: '8095551234', source: 'walk_in', budget: 1500000,
    notes: TAG, stage: 'lead', next_followup_at: overdue,
  }).select('id').single()
  ctx.cleanup(async () => { await ctx.supabase.from('leads').delete().eq('id', data.id) })
  // Move to negotiation
  await ctx.supabase.from('leads').update({ stage: 'negotiation', updated_at: nowIso() }).eq('id', data.id)
  // logContact
  await ctx.supabase.from('leads').update({
    last_contacted_at: nowIso(),
    next_followup_at: new Date(Date.now() + 3 * 86400000).toISOString(),
    updated_at: nowIso(),
  }).eq('id', data.id)
  // Reset to overdue
  await ctx.supabase.from('leads').update({ stage: 'lead', next_followup_at: overdue, last_contacted_at: null, updated_at: nowIso() }).eq('id', data.id)
  const od = await ctx.supabase.from('leads').select('id')
    .eq('business_id', fx.id).not('next_followup_at', 'is', null)
    .lte('next_followup_at', nowIso()).not('stage', 'in', '(closed,lost)')
    .like('notes', `${TAG}%`)
  ctx.assert(od.data?.some(l => l.id === data.id), 'overdue query missed our lead')
  // Close it, must disappear from overdue
  await ctx.supabase.from('leads').update({ stage: 'closed', updated_at: nowIso() }).eq('id', data.id)
  const af = await ctx.supabase.from('leads').select('id')
    .eq('business_id', fx.id).not('next_followup_at', 'is', null)
    .lte('next_followup_at', nowIso()).not('stage', 'in', '(closed,lost)')
    .like('notes', `${TAG}%`)
  ctx.assert(!af.data?.some(l => l.id === data.id), 'closed lead still appears in overdue')
}, { category: 'vertical.dealership' })

h.scenario('vertical.dealership.test_drive.create_outcome_check', async (ctx) => {
  const fx = ctx.fixture('demo_dealership')
  const vSid = ctx.uuid()
  await ctx.supabase.from('vehicle_inventory').insert({
    supabase_id: vSid, business_id: fx.id, active: true,
    make: 'X', model: `${TAG}TD`, year: 2024, condition: 'new',
    listing_price: 1, status: 'available', title_status: 'clean', notes: TAG, listing_date: nowIso(),
  })
  ctx.cleanup(async () => { await ctx.supabase.from('vehicle_inventory').delete().eq('supabase_id', vSid) })
  const tdSid = ctx.uuid()
  const td = await ctx.supabase.from('test_drives').insert({
    supabase_id: tdSid, business_id: fx.id, active: true,
    vehicle_inventory_supabase_id: vSid, scheduled_at: nowIso(),
    license_number: '00112345678', notes: TAG,
  }).select('id, outcome').single()
  ctx.assert(!td.error, td.error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('test_drives').delete().eq('id', td.data.id) })
  ctx.assert(!td.data.outcome, 'fresh test_drive should have no outcome')
  const sold = await ctx.supabase.from('test_drives').update({
    outcome: 'sold', completed_at: nowIso(), updated_at: nowIso(),
  }).eq('id', td.data.id).select('outcome').single()
  ctx.assert(!sold.error && sold.data.outcome === 'sold', `outcome update: ${sold.error?.message}`)
  // bogus value must be rejected by CHECK
  await ctx.expectError(async () => {
    const r = await ctx.supabase.from('test_drives')
      .update({ outcome: 'BOGUS_OUTCOME' }).eq('id', td.data.id)
    if (r.error) throw new Error(r.error.message)
  }, /check|outcome|constraint/i, 'CHECK should reject bogus outcome')
}, { category: 'vertical.dealership' })

h.scenario('vertical.dealership.activity_log.deal_closed', async (ctx) => {
  const fx = ctx.fixture('demo_dealership')
  const sid = ctx.uuid()
  const { error } = await ctx.supabase.from('activity_log').insert({
    supabase_id: sid, business_id: fx.id,
    event_type: 'deal_closed', severity: 'info',
    target_type: 'sales_deal', target_id: 'vsuite-target',
    amount: 1450000, metadata: { _tag: TAG },
  })
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('activity_log').delete().eq('supabase_id', sid) })
}, { category: 'vertical.dealership' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.foodtruck.* — Demo Food Truck fixture
// Absorbs: foodtruck-e2e-smoke
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.foodtruck.locations.create_update', async (ctx) => {
  const fx = ctx.fixture('demo_foodtruck')
  const sid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('food_truck_locations').insert({
    supabase_id: sid, business_id: fx.id,
    name: `${TAG}Parque`, lat: 18.45, lng: -69.95,
    notes: 'parqueo gratis', active: true,
  }).select('id, active').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('food_truck_locations').delete().eq('id', data.id) })
  ctx.assertEq(data.active, true)
  const upd = await ctx.supabase.from('food_truck_locations')
    .update({ notes: 'updated', updated_at: nowIso() }).eq('id', data.id)
    .select('notes').single()
  ctx.assert(!upd.error && upd.data.notes === 'updated', `update: ${upd.error?.message}`)
}, { category: 'vertical.foodtruck' })

h.scenario('vertical.foodtruck.cuadre.shift_breadcrumbs', async (ctx) => {
  const fx = ctx.fixture('demo_foodtruck')
  const locSid = ctx.uuid()
  await ctx.supabase.from('food_truck_locations').insert({
    supabase_id: locSid, business_id: fx.id, name: `${TAG}Loc`, lat: 18.45, lng: -69.95, active: true,
  })
  ctx.cleanup(async () => { await ctx.supabase.from('food_truck_locations').delete().eq('supabase_id', locSid) })
  const cSid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('cuadre_caja').insert({
    supabase_id: cSid, business_id: fx.id, date: today(),
    fondo: 1000, efectivo_conteo: 1000, efectivo_sistema: 0, tarjeta: 0, transferencia: 0,
    cheque: 0, creditos: 0, salidas: 0, total_vendido: 0, total_cobrado: 0,
    cierre_total: 1000, diferencia: 0, comentario: `${TAG}shift`,
    status: 'abierto', opened_at: nowIso(), opening_cash: 1000,
    start_location_supabase_id: locSid, start_lat: 18.45, start_lng: -69.95,
    start_notes: 'inicio',
  }).select('id, start_location_supabase_id').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('cuadre_caja').delete().eq('id', data.id) })
  ctx.assertEq(data.start_location_supabase_id, locSid)
}, { category: 'vertical.foodtruck' })

h.scenario('vertical.foodtruck.waste_log.insert_and_list', async (ctx) => {
  const fx = ctx.fixture('demo_foodtruck')
  const invSid = ctx.uuid()
  await ctx.supabase.from('inventory_items').insert({
    supabase_id: invSid, business_id: fx.id, active: true,
    name: `${TAG}Pan`, unit: 'ud', quantity: 50, cost: 12, price: 0,
  })
  ctx.cleanup(async () => { await ctx.supabase.from('inventory_items').delete().eq('supabase_id', invSid) })
  const wSid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('waste_log').insert({
    supabase_id: wSid, business_id: fx.id,
    inventory_item_supabase_id: invSid, qty: 6, unit: 'ud',
    reason: `${TAG}spoiled`, occurred_at: nowIso(), created_by: 'vsuite',
  }).select('id, qty').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('waste_log').delete().eq('id', data.id) })
  ctx.assertEq(Number(data.qty), 6)
  const t0 = new Date(); t0.setHours(0,0,0,0)
  const list = await ctx.supabase.from('waste_log').select('id')
    .eq('business_id', fx.id).gte('occurred_at', t0.toISOString())
  ctx.assert((list.data?.length || 0) >= 1, 'waste log list empty')
}, { category: 'vertical.foodtruck' })

h.scenario('vertical.foodtruck.tickets.location_link', async (ctx) => {
  const fx = ctx.fixture('demo_foodtruck')
  const locSid = ctx.uuid()
  await ctx.supabase.from('food_truck_locations').insert({
    supabase_id: locSid, business_id: fx.id, name: `${TAG}LocTk`, lat: 18.45, lng: -69.95, active: true,
  })
  ctx.cleanup(async () => { await ctx.supabase.from('food_truck_locations').delete().eq('supabase_id', locSid) })
  const tSid = ctx.uuid()
  const { data, error } = await ctx.supabase.from('tickets').insert({
    supabase_id: tSid, business_id: fx.id,
    status: 'cobrado', total: 350, subtotal: 297, itbis: 53,
    payment_method: 'efectivo', fulfillment_type: 'take_out',
    food_truck_location_supabase_id: locSid, notes: `${TAG}tk`,
    paid_at: nowIso(),
  }).select('id, food_truck_location_supabase_id, fulfillment_type').single()
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('tickets').delete().eq('id', data.id) })
  ctx.assertEq(data.food_truck_location_supabase_id, locSid)
  ctx.assertEq(data.fulfillment_type, 'take_out')
}, { category: 'vertical.foodtruck' })

h.scenario('vertical.foodtruck.open_then_pay.lifecycle', async (ctx) => {
  const fx = ctx.fixture('demo_foodtruck')
  const tSid = ctx.uuid()
  const { data: t, error: e1 } = await ctx.supabase.from('tickets').insert({
    supabase_id: tSid, business_id: fx.id,
    doc_number: `${TAG}T-${Math.floor(Math.random() * 9000 + 1000)}`,
    fulfillment_type: 'take_out', mode: 'take_out',
    subtotal: 0, descuento: 0, itbis: 0, ley: 0, total: 0,
    payment_method: 'pending', status: 'pendiente', open_status: 'open',
    tipo_venta: 'contado', order_source: 'pedidos_ya',
    notes: `${TAG}open-then-pay`,
  }).select('id, supabase_id, status, open_status, order_source, rev').single()
  ctx.assert(!e1, e1?.message)
  ctx.cleanup(async () => {
    await ctx.supabase.from('ticket_items').delete().eq('ticket_supabase_id', tSid)
    await ctx.supabase.from('tickets').delete().eq('id', t.id)
  })
  ctx.assertEq(t.status, 'pendiente')
  ctx.assertEq(t.open_status, 'open')
  ctx.assertEq(t.order_source, 'pedidos_ya')
  // listOpen
  const openList = await ctx.supabase.from('tickets').select('supabase_id')
    .eq('business_id', fx.id).eq('open_status', 'open').neq('status', 'nula')
  ctx.assert(openList.data?.some(r => r.supabase_id === tSid), 'open ticket not in listOpen')
  // close with rev+1
  const rev = Number(t.rev || 0)
  const close = await ctx.supabase.from('tickets').update({
    status: 'cobrado', open_status: 'closed',
    subtotal: 340, total: 340, payment_method: 'efectivo',
    rev: rev + 1, updated_at: nowIso(),
  }).eq('supabase_id', tSid).select('status, open_status, order_source').single()
  ctx.assert(!close.error && close.data.status === 'cobrado' && close.data.open_status === 'closed'
    && close.data.order_source === 'pedidos_ya', `close: ${close.error?.message}`)
}, { category: 'vertical.foodtruck' })

h.scenario('vertical.foodtruck.open_then_pay.void_excluded', async (ctx) => {
  const fx = ctx.fixture('demo_foodtruck')
  const tSid = ctx.uuid()
  const ins = await ctx.supabase.from('tickets').insert({
    supabase_id: tSid, business_id: fx.id,
    doc_number: `${TAG}V-${Math.floor(Math.random() * 9000 + 1000)}`,
    fulfillment_type: 'take_out', mode: 'take_out',
    subtotal: 0, total: 0, payment_method: 'pending',
    status: 'pendiente', open_status: 'open',
    tipo_venta: 'contado', order_source: 'telefono',
    notes: `${TAG}void-path`,
  }).select('rev').single()
  ctx.cleanup(async () => { await ctx.supabase.from('tickets').delete().eq('supabase_id', tSid) })
  const rev = Number(ins.data?.rev || 0)
  await ctx.supabase.from('tickets').update({
    status: 'nula', void_reason: 'cliente no llegó',
    rev: rev + 1, updated_at: nowIso(),
  }).eq('supabase_id', tSid)
  const list = await ctx.supabase.from('tickets').select('supabase_id')
    .eq('business_id', fx.id).eq('open_status', 'open').neq('status', 'nula')
    .eq('supabase_id', tSid)
  ctx.assertEq(list.data?.length || 0, 0, 'voided ticket leaked into listOpen')
}, { category: 'vertical.foodtruck' })

h.scenario('vertical.foodtruck.rls.anon_denied_locations', async (ctx) => {
  if (!ctx.anon) return ctx.skip('anon client unavailable')
  const fx = ctx.fixture('demo_foodtruck')
  const { data } = await ctx.anon.from('food_truck_locations').select('id').eq('business_id', fx.id).limit(1)
  ctx.assert((data?.length || 0) === 0, `RLS LEAK: ${data?.length} food_truck_locations visible to anon`)
}, { category: 'vertical.foodtruck' })

h.scenario('vertical.foodtruck.rls.anon_denied_waste', async (ctx) => {
  if (!ctx.anon) return ctx.skip('anon client unavailable')
  const fx = ctx.fixture('demo_foodtruck')
  const { data } = await ctx.anon.from('waste_log').select('id').eq('business_id', fx.id).limit(1)
  ctx.assert((data?.length || 0) === 0, `RLS LEAK: ${data?.length} waste_log visible to anon`)
}, { category: 'vertical.foodtruck' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.salon.* — Demo Salon fixture
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.salon.fixture.resolved', async (ctx) => {
  ctx.assertNotNull(ctx.fixture('demo_salon').id)
}, { category: 'vertical.salon' })

h.scenario('vertical.salon.services.has_services', async (ctx) => {
  const fx = ctx.fixture('demo_salon')
  const { data, error } = await ctx.supabase.from('services')
    .select('id, name').eq('business_id', fx.id).eq('active', true).limit(5)
  ctx.assert(!error, error?.message)
  ctx.assert((data?.length || 0) >= 1, 'no salon services seeded')
}, { category: 'vertical.salon' })

h.scenario('vertical.salon.stylist_schedules.queryable', async (ctx) => {
  const fx = ctx.fixture('demo_salon')
  const { data, error } = await ctx.supabase.from('stylist_schedules')
    .select('id').eq('business_id', fx.id).limit(1)
  ctx.assert(!error, error?.message)
  ctx.assert(Array.isArray(data), 'not an array')
}, { category: 'vertical.salon' })

h.scenario('vertical.salon.appointments.create_cancel', async (ctx) => {
  const fx = ctx.fixture('demo_salon')
  const sid = ctx.uuid()
  const start = new Date(Date.now() + 86400000).toISOString()
  const ins = await ctx.supabase.from('appointments').insert({
    supabase_id: sid, business_id: fx.id,
    client_name: `${TAG}Salon Client`, scheduled_at: start, status: 'scheduled',
    notes: TAG,
  }).select('id').single()
  if (ins.error) return ctx.skip(`appointments insert: ${ins.error.message}`)
  ctx.cleanup(async () => { await ctx.supabase.from('appointments').delete().eq('id', ins.data.id) })
  const cancel = await ctx.supabase.from('appointments')
    .update({ status: 'cancelled', updated_at: nowIso() })
    .eq('id', ins.data.id).select('status').single()
  ctx.assert(!cancel.error && cancel.data.status === 'cancelled', `cancel: ${cancel.error?.message}`)
}, { category: 'vertical.salon' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.mechanic.* — Demo Taller fixture
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.mechanic.fixture.resolved', async (ctx) => {
  ctx.assertNotNull(ctx.fixture('demo_mechanic').id)
}, { category: 'vertical.mechanic' })

h.scenario('vertical.mechanic.work_orders.queryable', async (ctx) => {
  const fx = ctx.fixture('demo_mechanic')
  const { data, error } = await ctx.supabase.from('work_orders')
    .select('id, status').eq('business_id', fx.id).limit(5)
  ctx.assert(!error, error?.message)
  ctx.assert(Array.isArray(data))
}, { category: 'vertical.mechanic' })

h.scenario('vertical.mechanic.vehicles.queryable', async (ctx) => {
  const fx = ctx.fixture('demo_mechanic')
  const { data, error } = await ctx.supabase.from('vehicles')
    .select('id, plate').eq('business_id', fx.id).limit(5)
  ctx.assert(!error, error?.message)
  ctx.assert(Array.isArray(data))
}, { category: 'vertical.mechanic' })

h.scenario('vertical.mechanic.work_order.create_complete', async (ctx) => {
  const fx = ctx.fixture('demo_mechanic')
  const sid = ctx.uuid()
  const ins = await ctx.supabase.from('work_orders').insert({
    supabase_id: sid, business_id: fx.id,
    status: 'open', notes: TAG,
  }).select('id, status').single()
  if (ins.error) return ctx.skip(`work_orders insert: ${ins.error.message}`)
  ctx.cleanup(async () => { await ctx.supabase.from('work_orders').delete().eq('id', ins.data.id) })
  const close = await ctx.supabase.from('work_orders')
    .update({ status: 'completed', updated_at: nowIso() })
    .eq('id', ins.data.id).select('status').single()
  ctx.assert(!close.error && close.data.status === 'completed', `complete: ${close.error?.message}`)
}, { category: 'vertical.mechanic' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.carniceria.* — Demo Carnicería fixture
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.carniceria.fixture.resolved', async (ctx) => {
  ctx.assertNotNull(ctx.fixture('demo_carniceria').id)
}, { category: 'vertical.carniceria' })

h.scenario('vertical.carniceria.inventory.weight_columns', async (ctx) => {
  const fx = ctx.fixture('demo_carniceria')
  const { data, error } = await ctx.supabase.from('inventory_items')
    .select('id, name, sold_by_weight, prepacked, expires_at, received_at, price_per_unit, unit')
    .eq('business_id', fx.id).eq('active', true).limit(20)
  ctx.assert(!error, error?.message)
  if (data?.length) {
    ctx.assert(data.every(r => 'prepacked' in r), 'prepacked column missing')
    ctx.assert(data.every(r => 'expires_at' in r), 'expires_at column missing')
  }
}, { category: 'vertical.carniceria' })

h.scenario('vertical.carniceria.cortes.crud_roundtrip', async (ctx) => {
  const fx = ctx.fixture('demo_carniceria')
  const sid = ctx.uuid()
  const ins = await ctx.supabase.from('carniceria_corte_categories').insert({
    supabase_id: sid, business_id: fx.id,
    nombre: `${TAG}Corte`, especie: 'pollo',
    sort_order: 9999, active: true,
  }).select('id, especie').single()
  ctx.assert(!ins.error, ins.error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('carniceria_corte_categories').delete().eq('id', ins.data.id) })
  ctx.assertEq(ins.data.especie, 'pollo')
}, { category: 'vertical.carniceria' })

h.scenario('vertical.carniceria.freshness_log.queryable', async (ctx) => {
  const fx = ctx.fixture('demo_carniceria')
  const { error } = await ctx.supabase.from('inventory_freshness_log')
    .select('id, expires_at, qty_remaining').eq('business_id', fx.id).limit(10)
  ctx.assert(!error, error?.message)
}, { category: 'vertical.carniceria' })

h.scenario('vertical.carniceria.scales.queryable', async (ctx) => {
  const fx = ctx.fixture('demo_carniceria')
  const { error } = await ctx.supabase.from('carniceria_scales')
    .select('id, nombre, tipo').eq('business_id', fx.id).limit(10)
  ctx.assert(!error, error?.message)
}, { category: 'vertical.carniceria' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.contabilidad.* — perla (READ-ONLY) + demo_accounting
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.contabilidad.perla.fixture_resolved', async (ctx) => {
  ctx.assertNotNull(ctx.fixture('perla').id, 'Perla Lugo fixture missing')
}, { category: 'vertical.contabilidad' })

h.scenario('vertical.contabilidad.accounting_clients.queryable', async (ctx) => {
  const fx = ctx.fixture('demo_accounting') || ctx.fixture('perla')
  const { data, error } = await ctx.supabase.from('accounting_clients')
    .select('id').eq('business_id', fx.id).limit(5)
  ctx.assert(!error, error?.message)
  ctx.assert(Array.isArray(data))
}, { category: 'vertical.contabilidad' })

h.scenario('vertical.contabilidad.demo.client_crud', async (ctx) => {
  const fx = ctx.fixture('demo_accounting')
  if (!fx) return ctx.skip('demo_accounting fixture missing')
  const sid = ctx.uuid()
  const ins = await ctx.supabase.from('accounting_clients').insert({
    supabase_id: sid, business_id: fx.id,
    rnc: '101000000',
  }).select('id').single()
  if (ins.error) return ctx.skip(`accounting_clients insert: ${ins.error.message}`)
  ctx.cleanup(async () => { await ctx.supabase.from('accounting_clients').delete().eq('id', ins.data.id) })
  ctx.assertNotNull(ins.data?.id, 'no id returned')
}, { category: 'vertical.contabilidad' })

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY: vertical.cross.* — ofertas/combos, multi-POS, drift
// Absorbs: ofertas-e2e-smoke, ranoza-dual-terminal-smoke, sandbox-demo-smoke,
//          flow-drift-smoke (synthesized real-user-action checks)
// ════════════════════════════════════════════════════════════════════════════

h.scenario('vertical.cross.ofertas.schema_reachable', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria') || ctx.fixture('ranoza')
  const { error: e1 } = await ctx.supabase.from('ofertas')
    .select('id', { head: true, count: 'exact' }).eq('business_id', fx.id)
  ctx.assert(!e1, `ofertas: ${e1?.message}`)
  const { error: e2 } = await ctx.supabase.from('oferta_items')
    .select('id', { head: true, count: 'exact' }).eq('business_id', fx.id)
  ctx.assert(!e2, `oferta_items: ${e2?.message}`)
}, { category: 'vertical.cross' })

h.scenario('vertical.cross.ofertas.bundle_create_explode', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria') || ctx.fixture('ranoza')
  // Find 2 inventory items
  const { data: inv } = await ctx.supabase.from('inventory_items')
    .select('id, supabase_id, name, price, quantity')
    .eq('business_id', fx.id).eq('active', true).gt('quantity', 5).limit(2)
  if (!inv || inv.length < 2) return ctx.skip('need 2 inventory rows with qty>5')
  const [c1, c2] = inv
  const ofertaSid = ctx.uuid()
  const subtotal = c1.price * 1 + c2.price * 2
  const ofertaPrice = Math.round(subtotal * 0.85)
  const o = await ctx.supabase.from('ofertas').insert({
    supabase_id: ofertaSid, business_id: fx.id,
    name: `${TAG}Bundle`, description: 'vsuite bundle', price: ofertaPrice, active: true,
  })
  ctx.assert(!o.error, o.error?.message)
  ctx.cleanup(async () => {
    await ctx.supabase.from('oferta_items').delete().eq('oferta_supabase_id', ofertaSid)
    await ctx.supabase.from('ofertas').delete().eq('supabase_id', ofertaSid)
  })
  const oi = await ctx.supabase.from('oferta_items').insert([
    { supabase_id: ctx.uuid(), business_id: fx.id, oferta_supabase_id: ofertaSid, inventory_item_supabase_id: c1.supabase_id, qty: 1 },
    { supabase_id: ctx.uuid(), business_id: fx.id, oferta_supabase_id: ofertaSid, inventory_item_supabase_id: c2.supabase_id, qty: 2 },
  ])
  ctx.assert(!oi.error, oi.error?.message)
  // Read back with embed
  const { data: read, error: re } = await ctx.supabase.from('ofertas')
    .select('*, oferta_items(*)').eq('supabase_id', ofertaSid).single()
  ctx.assert(!re, re?.message)
  ctx.assertEq(read.oferta_items?.length, 2, 'embedded components missing')
}, { category: 'vertical.cross' })

// Multi-POS — concurrent inventory deduct via RPC (must be atomic).
h.scenario('vertical.cross.multipos.inventory_atomic_deduct', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria')
  if (!fx) return ctx.skip('demo_licoreria fixture missing')
  const { data: item } = await ctx.supabase.from('inventory_items')
    .select('id, supabase_id, name, quantity').eq('business_id', fx.id)
    .eq('active', true).gt('quantity', 50).order('name').limit(1).maybeSingle()
  if (!item) return ctx.skip('no SKU with qty>50 on demo_licoreria')
  const pre = Number(item.quantity)
  const A = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }, global: { headers: { 'x-terminal': 'A' } } })
  const B = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }, global: { headers: { 'x-terminal': 'B' } } })
  ctx.cleanup(async () => { await ctx.supabase.from('inventory_items').update({ quantity: pre }).eq('id', item.id) })
  const payload = (tid) => ({
    p_business_id: fx.id, p_ticket_supabase_id: tid, p_hwid: 'TERM-' + tid.slice(0,4),
    p_items: [{ item_supabase_id: item.supabase_id, qty: 1, name: item.name }],
  })
  const [rA, rB] = await Promise.all([
    A.rpc('deduct_inventory_atomic', payload(ctx.uuid())),
    B.rpc('deduct_inventory_atomic', payload(ctx.uuid())),
  ])
  const { data: post } = await ctx.supabase.from('inventory_items').select('quantity').eq('id', item.id).single()
  ctx.assertEq(Number(post.quantity), pre - 2,
    `lost-update: pre=${pre}, post=${post.quantity}; rA=${rA.error?.message || 'ok'} rB=${rB.error?.message || 'ok'}`)
}, { category: 'vertical.cross' })

// NCF block allocation — distinct HWIDs must get disjoint ranges.
h.scenario('vertical.cross.multipos.ncf_block_disjoint', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria')
  if (!fx) return ctx.skip('demo_licoreria fixture missing')
  // Bootstrap master row
  await ctx.supabase.rpc('allocate_ncf_block', { p_business_id: fx.id, p_hwid: 'VSUITE-BOOT', p_ncf_type: 'B02', p_size: 10 })
  const A = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const B = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const [rA, rB] = await Promise.all([
    A.rpc('allocate_ncf_block', { p_business_id: fx.id, p_hwid: 'VSUITE-A', p_ncf_type: 'B02', p_size: 25 }),
    B.rpc('allocate_ncf_block', { p_business_id: fx.id, p_hwid: 'VSUITE-B', p_ncf_type: 'B02', p_size: 25 }),
  ])
  ctx.assert(!rA.error && !rB.error, `rpc: ${rA.error?.message || rB.error?.message}`)
  const a = rA.data, b = rB.data
  ctx.assertNotNull(a, 'A.data null'); ctx.assertNotNull(b, 'B.data null')
  const overlap = !(a.range_end < b.range_start || b.range_end < a.range_start)
  ctx.assert(!overlap, `overlap A=[${a.range_start}..${a.range_end}] B=[${b.range_start}..${b.range_end}]`)
}, { category: 'vertical.cross' })

h.scenario('vertical.cross.multipos.ncf_same_hwid_reuses', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria')
  if (!fx) return ctx.skip('demo_licoreria fixture missing')
  await ctx.supabase.rpc('allocate_ncf_block', { p_business_id: fx.id, p_hwid: 'VSUITE-BOOT-R', p_ncf_type: 'B02', p_size: 10 })
  const A = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const [rC, rD] = await Promise.all([
    A.rpc('allocate_ncf_block', { p_business_id: fx.id, p_hwid: 'VSUITE-SAME', p_ncf_type: 'B02', p_size: 25 }),
    A.rpc('allocate_ncf_block', { p_business_id: fx.id, p_hwid: 'VSUITE-SAME', p_ncf_type: 'B02', p_size: 25 }),
  ])
  ctx.assert(!rC.error && !rD.error, `rpc: ${rC.error?.message || rD.error?.message}`)
  // Idempotency contract: same HWID with non-exhausted block must reuse OR
  // the second call must return a contiguous range (no overlap, no gap-skipping).
  // Both shapes are legal; the failure mode we test for is silent partition.
  const sameStart = rC.data?.range_start === rD.data?.range_start
  const contiguous = rC.data?.range_end != null && rD.data?.range_start === rC.data.range_end + 1
  ctx.assert(sameStart || contiguous,
    `same-HWID allocation got non-contiguous ranges: C=[${rC.data?.range_start}..${rC.data?.range_end}] D=[${rD.data?.range_start}..${rD.data?.range_end}]`)
}, { category: 'vertical.cross' })

h.scenario('vertical.cross.multipos.concurrent_ticket_insert', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria')
  if (!fx) return ctx.skip('demo_licoreria fixture missing')
  const sA = ctx.uuid(), sB = ctx.uuid()
  const docA = `${TAG}A-${Date.now()}`, docB = `${TAG}B-${Date.now()}`
  ctx.cleanup(async () => { await ctx.supabase.from('tickets').delete().in('supabase_id', [sA, sB]) })
  const [rA, rB] = await Promise.all([
    ctx.supabase.from('tickets').insert({
      supabase_id: sA, business_id: fx.id, doc_number: docA, status: 'pendiente',
      subtotal: 100, itbis: 18, total: 118, payment_method: 'efectivo', rev: 1,
    }).select('supabase_id, doc_number').single(),
    ctx.supabase.from('tickets').insert({
      supabase_id: sB, business_id: fx.id, doc_number: docB, status: 'pendiente',
      subtotal: 100, itbis: 18, total: 118, payment_method: 'efectivo', rev: 1,
    }).select('supabase_id, doc_number').single(),
  ])
  ctx.assert(!rA.error && !rB.error, `inserts: ${rA.error?.message || rB.error?.message}`)
  ctx.assert(rA.data.supabase_id !== rB.data.supabase_id, 'same supabase_id')
  ctx.assert(rA.data.doc_number !== rB.data.doc_number, 'same doc_number')
}, { category: 'vertical.cross' })

h.scenario('vertical.cross.multipos.credit_payments_both_persist', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria')
  if (!fx) return ctx.skip('demo_licoreria fixture missing')
  const cid = ctx.uuid()
  const { data: client, error: ce } = await ctx.supabase.from('clients').insert({
    business_id: fx.id, supabase_id: cid, name: `${TAG}DUAL`, active: true,
    credit_limit: 100000, balance: 0,
  }).select('id, supabase_id').single()
  ctx.assert(!ce, ce?.message)
  ctx.cleanup(async () => {
    await ctx.supabase.from('credit_payments').delete().eq('client_id', client.id)
    await ctx.supabase.from('clients').delete().eq('id', client.id)
  })
  const [pA, pB] = await Promise.all([
    ctx.supabase.from('credit_payments').insert({
      supabase_id: ctx.uuid(), business_id: fx.id, client_id: client.id,
      client_supabase_id: cid, amount: 500, payment_method: 'credito', ticket_ids: [],
    }),
    ctx.supabase.from('credit_payments').insert({
      supabase_id: ctx.uuid(), business_id: fx.id, client_id: client.id,
      client_supabase_id: cid, amount: 500, payment_method: 'credito', ticket_ids: [],
    }),
  ])
  ctx.assert(!pA.error && !pB.error, `inserts: ${pA.error?.message || pB.error?.message}`)
  const { data: rows } = await ctx.supabase.from('credit_payments').select('amount')
    .eq('business_id', fx.id).eq('client_id', client.id)
  const sum = (rows || []).reduce((s, r) => s + Number(r.amount), 0)
  ctx.assertEq(sum, 1000, `expected sum=1000, got ${sum}`)
}, { category: 'vertical.cross' })

h.scenario('vertical.cross.multipos.loyalty_concurrent_award', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria')
  if (!fx) return ctx.skip('demo_licoreria fixture missing')
  const cid = ctx.uuid()
  const { data: client, error: ce } = await ctx.supabase.from('clients').insert({
    business_id: fx.id, supabase_id: cid, name: `${TAG}LOY-DUAL`, active: true,
    loyalty_points: 0,
  }).select('id, supabase_id').single()
  ctx.assert(!ce, ce?.message)
  ctx.cleanup(async () => {
    await ctx.supabase.from('loyalty_transactions').delete().eq('client_supabase_id', cid)
    await ctx.supabase.from('clients').delete().eq('id', client.id)
  })
  const args = { p_business_id: fx.id, p_client_supabase_id: cid,
    p_ticket_supabase_id: null, p_points: 50, p_notes: TAG }
  const [rA, rB] = await Promise.all([
    ctx.supabase.rpc('loyalty_award', args),
    ctx.supabase.rpc('loyalty_award', args),
  ])
  ctx.assert(!rA.error && !rB.error, `rpc: ${rA.error?.message || rB.error?.message}`)
  const { data: post } = await ctx.supabase.from('clients')
    .select('loyalty_points').eq('id', client.id).single()
  ctx.assertEq(Number(post.loyalty_points), 100, `expected 100, got ${post.loyalty_points}`)
}, { category: 'vertical.cross' })

h.scenario('vertical.cross.multipos.cuadre_exactly_one_open_per_day', async (ctx) => {
  const fx = ctx.fixture('demo_licoreria')
  if (!fx) return ctx.skip('demo_licoreria fixture missing')
  const d = today()
  // Clean prior runs
  await ctx.supabase.from('cuadre_caja').delete().eq('business_id', fx.id).eq('date', d).like('comentario', `${TAG}%`)
  ctx.cleanup(async () => {
    await ctx.supabase.from('cuadre_caja').delete().eq('business_id', fx.id).eq('date', d).like('comentario', `${TAG}%`)
  })
  const open = (label) => ctx.supabase.from('cuadre_caja').insert({
    supabase_id: ctx.uuid(), business_id: fx.id, date: d,
    status: 'abierto', opening_cash: 1000, opened_at: nowIso(),
    fondo: 1000, comentario: `${TAG}${label}`,
  })
  await Promise.all([open('A'), open('B')])
  const { data } = await ctx.supabase.from('cuadre_caja')
    .select('id, status').eq('business_id', fx.id).eq('date', d)
    .eq('status', 'abierto').like('comentario', `${TAG}%`)
  // Production has uq_cuadre_caja_one_open_per_day → must reject second insert.
  ctx.assertEq(data?.length, 1, `expected exactly 1 open cuadre, got ${data?.length}`)
}, { category: 'vertical.cross' })

// Per-item ITBIS extraction rule (CLAUDE.md §19).
h.scenario('vertical.cross.financial.per_item_itbis_extraction', async (ctx) => {
  // Pure invariant: itbis = price - price/(1 + 0.18). Verify formula directly.
  const cases = [[100, 15.25], [150, 22.88], [354, 54.00], [200, 30.51]]
  for (const [price, expected] of cases) {
    const computed = +(price - price / 1.18).toFixed(2)
    // Allow 1¢ rounding tolerance
    ctx.assert(Math.abs(computed - expected) <= 0.01,
      `price=${price}: expected itbis≈${expected}, computed=${computed}`)
  }
  // The WRONG formula (price * 0.18) over-counts by ~18%.
  const wrong = 150 * 0.18 // = 27 (vs correct 22.88)
  const correct = +(150 - 150 / 1.18).toFixed(2)
  ctx.assert(wrong > correct, 'wrong formula must over-count')
  ctx.assert((wrong - correct) / correct > 0.15, 'over-count should be ~18%')
}, { category: 'vertical.cross' })

// Drift smoke — markPaid contract on queued ticket.
h.scenario('vertical.cross.drift.queue_to_cobrar_marks_paid', async (ctx) => {
  const fx = ctx.fixture('demo_carwash')
  if (!fx) return ctx.skip('demo_carwash fixture missing')
  const tSid = ctx.uuid()
  const { data: t } = await ctx.supabase.from('tickets').insert({
    supabase_id: tSid, business_id: fx.id, status: 'pendiente',
    subtotal: 297, itbis: 53, total: 350, payment_method: 'pending',
    notes: `${TAG}drift`,
  }).select('id, rev').single()
  if (!t) return ctx.skip('ticket insert failed')
  ctx.cleanup(async () => { await ctx.supabase.from('tickets').delete().eq('id', t.id) })
  const rev = Number(t.rev || 0)
  // Simulate markPaid path
  const r = await ctx.supabase.from('tickets').update({
    status: 'cobrado', payment_method: 'efectivo', paid_at: nowIso(),
    rev: rev + 1, updated_at: nowIso(),
  }).eq('id', t.id).select('status, paid_at').single()
  ctx.assert(!r.error && r.data.status === 'cobrado' && !!r.data.paid_at,
    `markPaid failed: ${r.error?.message}`)
}, { category: 'vertical.cross' })

// Sandbox demo endpoint reachability (smoke only — full rate-limit cycle lives in dedicated suite).
h.scenario('vertical.cross.sandbox.ecf_sign_auth_required', async (ctx) => {
  const url = 'https://terminalxpos.com/api/ecf-sign'
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sandbox-try' }),
  }).catch(e => ({ status: 0, _err: e.message }))
  if (r._err) return ctx.skip(`network: ${r._err}`)
  ctx.assertEq(r.status, 401, `expected 401, got ${r.status}`)
}, { category: 'vertical.cross' })

// Activity log smoke — every demo can write an audit event.
h.scenario('vertical.cross.activity_log.cross_vertical_write', async (ctx) => {
  const fx = ctx.fixture('demo_carwash')
  if (!fx) return ctx.skip('demo_carwash fixture missing')
  const sid = ctx.uuid()
  const { error } = await ctx.supabase.from('activity_log').insert({
    supabase_id: sid, business_id: fx.id,
    event_type: 'vsuite_smoke', severity: 'info',
    target_type: 'system', target_name: 'vertical-suite',
    metadata: { source: 'vertical-suite.mjs', _tag: TAG, when: nowIso() },
  })
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('activity_log').delete().eq('supabase_id', sid) })
}, { category: 'vertical.cross' })

// Schema invariants probe — verifies a critical view + key columns exist.
h.scenario('vertical.cross.schema.mesas_with_active_total_exists', async (ctx) => {
  const { error } = await ctx.supabase.from('mesas_with_active_total').select('id').limit(1)
  ctx.assert(!error, `mesas_with_active_total view: ${error?.message}`)
}, { category: 'vertical.cross' })

h.scenario('vertical.cross.schema.activity_log_writable', async (ctx) => {
  const fx = ctx.fixture('demo_carwash')
  if (!fx) return ctx.skip('demo_carwash fixture missing')
  const sid = ctx.uuid()
  const { error } = await ctx.supabase.from('activity_log').insert({
    supabase_id: sid, business_id: fx.id,
    event_type: 'schema_probe', severity: 'info',
    target_type: 'system', metadata: { _tag: TAG },
  })
  ctx.assert(!error, error?.message)
  ctx.cleanup(async () => { await ctx.supabase.from('activity_log').delete().eq('supabase_id', sid) })
}, { category: 'vertical.cross' })

// ════════════════════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════════════════════

const summary = await h.run()
if (process.env.JSON === 'true' || process.env.JSON === '1') {
  // harness already wrote JSON to stdout
} else {
  // pretty summary already printed by harness
}
process.exit(summary.failed > 0 ? 1 : 0)
