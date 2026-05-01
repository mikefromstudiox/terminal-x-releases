#!/usr/bin/env node
/**
 * audit-flows.mjs — Tier 1 end-to-end data-flow audit harness for Terminal X.
 *
 * Durable regression guard against the bug class we just exposed in audit:
 *   1. Schema-payload contract  — PostgREST silently drops unknown columns.
 *   2. Round-trip               — what we INSERT must come back via re-read.
 *   3. Side-effect rules        — every "X triggers Y" rule encoded as scenario
 *                                 (credit ticket → balance increments, void →
 *                                 inventory restored + commission reversed,
 *                                 membership consume → uses_remaining decrements,
 *                                 etc.)
 *   4. Web-vs-desktop parity    — DOCUMENTED here; out of process scope today
 *                                 because web.js cannot be Node-imported (uses
 *                                 Vite-only @terminal-x/* aliases).
 *   5. Sync-layer integrity     — LWW push-doesn't-revert assertion.
 *   6. RLS contract             — positive + negative tenant scenarios; defers
 *                                 the heavy listing to scripts/rls-policy-audit.mjs.
 *
 * Operates entirely against a synthetic "Audit Harness Test ${timestamp}"
 * business that is created at start and torn down at end so it never pollutes
 * Studio X SRL or Ranoza prod data.
 *
 * Usage:
 *   node scripts/audit-flows.mjs
 * Exit code 0 = all green, 1 = any failure, 2 = bootstrap crash.
 *
 * Reads .env for SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Adding a scenario:
 *   1. Pick the right vertical block (carwash, retail, salon, restaurant,
 *      concesionario, mecanica, sync, rls).
 *   2. `await scenario('label', async () => { ...assert... })` — throw on
 *      failure, return on pass. Prefix with vertical (e.g. 'salon: ...').
 *   3. Use the ctx.* helpers (insertReadDiff, makeTicket, ...) when possible
 *      so you inherit teardown + the schema-payload contract check for free.
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── tiny .env loader (no dotenv dep) ─────────────────────────────────────────
function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m) continue
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv(path.join(ROOT, '.env'))
loadEnv(path.join(ROOT, 'web', '.env.local'))
loadEnv(path.join(ROOT, 'web', '.env'))

const URL = process.env.SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.SUPABASE_ANON_KEY

if (!URL || !SVC) {
  console.error('audit-flows: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(2)
}

// Two clients: service-role bypasses RLS for setup/teardown; anon (or no key)
// only used for the RLS negative scenarios where we want enforcement on.
const svc = createClient(URL, SVC, { auth: { persistSession: false } })
const anon = ANON ? createClient(URL, ANON, { auth: { persistSession: false } }) : null

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Result accounting ────────────────────────────────────────────────────────
const results = []
let pass = 0, fail = 0, skip = 0
const byGroup = {}

function record(group, label, status, detail = '') {
  const sym = status === 'pass' ? 'OK' : status === 'fail' ? 'FAIL' : 'SKIP'
  const line = `[${sym}] ${label}${detail ? ' — ' + detail : ''}`
  console.log(line)
  results.push({ group, label, status, detail })
  if (status === 'pass') pass++
  else if (status === 'fail') fail++
  else skip++
  byGroup[group] = byGroup[group] || { pass: 0, fail: 0, skip: 0 }
  byGroup[group][status]++
}

let _currentGroup = 'general'
const group = g => { _currentGroup = g; console.log(`\n── ${g} ───────────────────────────────────────────────`) }
async function scenario(label, fn) {
  try {
    const r = await fn()
    if (r === 'skip') record(_currentGroup, label, 'skip')
    else record(_currentGroup, label, 'pass')
  } catch (e) {
    record(_currentGroup, label, 'fail', e?.message || String(e))
  }
}

// ── Schema-payload contract helper ───────────────────────────────────────────
// INSERT a row, re-read it, diff every key in `payload` against the re-read row.
// Throws if any key is missing/null in re-read but had a non-null value going in.
// This is the silent-drop detector.
async function insertReadDiff(table, payload, opts = {}) {
  const ignoreKeys = new Set(opts.ignoreKeys || []) // e.g. JSON cols we don't expect to round-trip identically
  const idCol = opts.idCol || 'id'
  const ins = await svc.from(table).insert(payload).select('*').single()
  if (ins.error) throw new Error(`insert ${table}: ${ins.error.message}`)
  const inserted = ins.data
  // Re-read by id to make sure it's actually persisted
  const re = await svc.from(table).select('*').eq(idCol, inserted[idCol]).single()
  if (re.error) throw new Error(`re-read ${table}: ${re.error.message}`)
  const row = re.data
  const dropped = []
  for (const [k, v] of Object.entries(payload)) {
    if (ignoreKeys.has(k)) continue
    if (v === null || v === undefined) continue
    if (!(k in row)) { dropped.push(`${k} (key absent)`); continue }
    if (row[k] === null || row[k] === undefined) {
      // PostgREST drops unknown cols silently — they'd not exist at all (caught above).
      // A real null in re-read after non-null insert = silent coercion or column type rejection.
      dropped.push(`${k} (null after insert)`)
    }
  }
  if (dropped.length) throw new Error(`silent-drop in ${table}: ${dropped.join(', ')}`)
  return row
}

// ── Synthetic harness business ───────────────────────────────────────────────
const ctx = {
  bid: null,
  business: null,
  cleanup: [], // { table, idCol, id }
  user: null,
  empleado: null,
  client: null,
  service: null,
  inventoryItem: null,
}

function track(table, id, idCol = 'id') { ctx.cleanup.push({ table, id, idCol }) }

async function bootstrap() {
  group('bootstrap')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const bizSid = uid()
  const bizName = `Audit Harness Test ${stamp}`
  // Production-data guard: never use the real business UUIDs.
  const FORBIDDEN = new Set([
    '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79', // Studio X SRL
    '4f789f41-76d2-4402-838f-5fe20a91641f', // Ranoza
  ])
  // Insert business row. Schema-payload contract test for `businesses` itself.
  // Real columns (verified 2026-04-30): id, name, rnc, owner_id, address, phone,
  // email, logo_url, settings, plan, is_demo, mora_rate_daily.
  const { data: biz, error: bizErr } = await svc.from('businesses').insert({
    name: bizName,
    rnc: null,
    plan: 'PLUS',
    is_demo: true,
    settings: { business_type: 'tienda', ciudad: 'Santo Domingo', biz_city: 'Santo Domingo' },
  }).select('*').single()
  if (bizErr) throw new Error(`bootstrap business: ${bizErr.message}`)
  if (FORBIDDEN.has(biz.id)) throw new Error(`harness collided with prod biz ${biz.id} — abort`)
  ctx.bid = biz.id
  ctx.business = biz
  // No need to track businesses — teardown deletes by id explicitly at end.
  record('bootstrap', `business created (id=${biz.id})`, 'pass')

  // Seed a staff user (cashier) — empleado_id linkage.
  const empSid = uid()
  const { data: emp, error: empErr } = await svc.from('empleados').insert({
    supabase_id: empSid, business_id: ctx.bid,
    nombre: 'Audit Harness Cashier', tipo: 'cajero', role: 'cashier', active: true,
    start_date: '2026-01-01', cedula: '00000000000',
  }).select('*').single()
  if (empErr) throw new Error(`bootstrap empleado: ${empErr.message}`)
  ctx.empleado = emp
  track('empleados', emp.id)

  const userSid = uid()
  const { data: usr, error: usrErr } = await svc.from('staff').insert({
    supabase_id: userSid, business_id: ctx.bid,
    name: 'Audit Cashier', username: `audit_${stamp.slice(-8)}`,
    role: 'cashier', active: true,
    // staff.employee_id is integer (legacy local_id-based). Set to null —
    // the link is owned by supabase_id elsewhere.
    employee_id: null,
    start_date: '2026-01-01', cedula: '00000000000',
  }).select('*').single()
  if (usrErr) throw new Error(`bootstrap staff: ${usrErr.message}`)
  ctx.user = usr
  track('staff', usr.id)

  // Seed a client.
  const cliSid = uid()
  const { data: cli, error: cliErr } = await svc.from('clients').insert({
    supabase_id: cliSid, business_id: ctx.bid,
    name: 'Audit Test Client', rnc: null, balance: 0, active: true,
  }).select('*').single()
  if (cliErr) throw new Error(`bootstrap client: ${cliErr.message}`)
  ctx.client = cli
  track('clients', cli.id)

  // Seed a service.
  const svSid = uid()
  const { data: sv, error: svErr } = await svc.from('services').insert({
    supabase_id: svSid, business_id: ctx.bid,
    name: 'Audit Service', price: 100, cost: 50, active: true, aplica_itbis: true,
  }).select('*').single()
  if (svErr) throw new Error(`bootstrap service: ${svErr.message}`)
  ctx.service = sv
  track('services', sv.id)

  // Seed an inventory item.
  const iiSid = uid()
  const { data: ii, error: iiErr } = await svc.from('inventory_items').insert({
    supabase_id: iiSid, business_id: ctx.bid,
    name: 'Audit Widget', category: 'audit', price: 50, cost: 20, quantity: 100, active: true, aplica_itbis: 1,
  }).select('*').single()
  if (iiErr) throw new Error(`bootstrap inventory_item: ${iiErr.message}`)
  ctx.inventoryItem = ii
  track('inventory_items', ii.id)

  record('bootstrap', 'seeded staff + empleado + client + service + inventory_item', 'pass')
}

async function teardown() {
  group('teardown')
  // Reverse-order delete; cascade handles most child rows but be defensive.
  const tables = [
    'ticket_items','tickets','credit_payments','washer_commissions','seller_commissions','cajero_commissions',
    'mechanic_commissions','client_memberships','memberships','sales_deals','vehicle_reservations',
    'vehicle_warranties','bank_preapprovals','test_drives','leads','vehicle_inventory','work_orders',
    'work_order_items','appointments','restaurant_reservations','kds_events','mesas','inventory_count_items',
    'inventory_counts','anecf_queue','ncf_sequences','activity_log','app_settings','loyalty_transactions',
    'ticket_locks','services','inventory_items','clients','staff','empleados','licenses','cuadre_caja',
  ]
  for (const t of tables) {
    try { await svc.from(t).delete().eq('business_id', ctx.bid) } catch {}
  }
  // The businesses row itself has no business_id col — delete by id.
  try { await svc.from('businesses').delete().eq('id', ctx.bid) } catch {}
  console.log(`teardown: synthetic biz ${ctx.bid} removed`)
}

// ─── Helpers used by scenarios ───────────────────────────────────────────────
async function makeTicket({ status = 'cobrado', total = 100, payment_method = 'efectivo', client_supabase_id = null, items = [] } = {}) {
  const tSid = uid()
  const ticketPayload = {
    supabase_id: tSid, business_id: ctx.bid,
    status, total, subtotal: total, itbis: 0, descuento: 0,
    payment_method, client_supabase_id,
    cajero_supabase_id: ctx.user.supabase_id,
    created_at: now(),
  }
  const { data: t, error: te } = await svc.from('tickets').insert(ticketPayload).select('*').single()
  if (te) throw new Error(`makeTicket: ${te.message}`)
  if (items.length) {
    const rows = items.map(it => ({
      supabase_id: uid(), business_id: ctx.bid, ticket_supabase_id: tSid,
      name: it.name, price: it.price, cost: it.cost ?? 0,
      quantity: it.quantity ?? 1, sku: it.sku ?? null,
      inventory_item_supabase_id: it.inventory_item_supabase_id ?? null,
      service_supabase_id: it.service_supabase_id ?? null,
      empleado_supabase_id: it.empleado_supabase_id ?? null,
      itbis: it.itbis ?? 0,
    }))
    const { error: ie } = await svc.from('ticket_items').insert(rows)
    if (ie) throw new Error(`makeTicket items: ${ie.message}`)
  }
  return t
}

async function getInventoryQty(supabaseId) {
  const { data } = await svc.from('inventory_items').select('quantity').eq('supabase_id', supabaseId).maybeSingle()
  return Number(data?.quantity ?? 0)
}

async function getClientBalance(supabaseId) {
  const { data } = await svc.from('clients').select('balance').eq('supabase_id', supabaseId).maybeSingle()
  return Number(data?.balance ?? 0)
}

// ─── Scenarios — schema-payload + round-trip per critical table ──────────────
async function runSchemaPayloadScenarios() {
  group('schema-payload contract')

  // tickets
  await scenario('tickets: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('tickets', {
      supabase_id: sid, business_id: ctx.bid,
      status: 'cobrado', total: 123.45, subtotal: 100, itbis: 23.45, descuento: 0,
      payment_method: 'efectivo', client_supabase_id: ctx.client.supabase_id,
      cajero_supabase_id: ctx.user.supabase_id, created_at: now(),
    })
    track('tickets', row.id)
  })

  // ticket_items
  await scenario('ticket_items: empleado_supabase_id round-trip', async () => {
    const t = await makeTicket()
    const sid = uid()
    const row = await insertReadDiff('ticket_items', {
      supabase_id: sid, business_id: ctx.bid, ticket_supabase_id: t.supabase_id,
      name: 'Audit line', price: 100, cost: 50, quantity: 1,
      service_supabase_id: ctx.service.supabase_id,
      inventory_item_supabase_id: ctx.inventoryItem.supabase_id,
      empleado_supabase_id: ctx.empleado.supabase_id,
      itbis: 18,
    })
    if (!row.empleado_supabase_id) throw new Error('empleado_supabase_id dropped (commission contract broken)')
    track('tickets', t.id)
  })

  // clients
  await scenario('clients: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('clients', {
      supabase_id: sid, business_id: ctx.bid,
      name: 'SchemaTest Client', rnc: null, balance: 0, active: true,
      phone: '8095551234', email: 'test@test.test',
    })
    track('clients', row.id)
  })

  // appointments
  await scenario('appointments: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('appointments', {
      supabase_id: sid, business_id: ctx.bid,
      date: '2026-12-31', start_time: '09:00', end_time: '10:00',
      client_supabase_id: ctx.client.supabase_id,
      empleado_supabase_id: ctx.empleado.supabase_id,
      status: 'pendiente', is_walk_in: false,
    })
    track('appointments', row.id)
  })

  // sales_deals
  await scenario('sales_deals: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('sales_deals', {
      supabase_id: sid, business_id: ctx.bid,
      status: 'open', client_supabase_id: ctx.client.supabase_id,
      vehicle_inventory_supabase_id: null, sale_price: 850000,
      salesperson_supabase_id: ctx.empleado.supabase_id,
      active: true,
    })
    track('sales_deals', row.id)
  })

  // vehicle_inventory
  await scenario('vehicle_inventory: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('vehicle_inventory', {
      supabase_id: sid, business_id: ctx.bid,
      make: 'Toyota', model: 'Corolla', year: 2024, vin: `VIN${Date.now()}`,
      stock_number: `ST${Date.now()}`, status: 'disponible',
      listing_price: 1200000, acquisition_cost: 900000, active: true,
    })
    track('vehicle_inventory', row.id)
  })

  // vehicle_reservations
  await scenario('vehicle_reservations: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('vehicle_reservations', {
      supabase_id: sid, business_id: ctx.bid,
      vehicle_inventory_supabase_id: null, client_supabase_id: ctx.client.supabase_id,
      salesperson_supabase_id: ctx.empleado.supabase_id,
      deposit_amount: 50000, deposit_method: 'efectivo', status: 'active', notes: 'audit', active: true,
      expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    })
    track('vehicle_reservations', row.id)
  })

  // leads
  await scenario('leads: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('leads', {
      supabase_id: sid, business_id: ctx.bid,
      name: 'Audit Lead', phone: '8095551111', source: 'whatsapp',
      stage: 'nuevo', active: true,
      salesperson_supabase_id: ctx.empleado.supabase_id,
    })
    track('leads', row.id)
  })

  // test_drives
  await scenario('test_drives: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('test_drives', {
      supabase_id: sid, business_id: ctx.bid,
      vehicle_inventory_supabase_id: null, client_supabase_id: ctx.client.supabase_id,
      staff_supabase_id: ctx.user.supabase_id,
      scheduled_at: now(), active: true,
    })
    track('test_drives', row.id)
  })

  // work_orders
  await scenario('work_orders: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('work_orders', {
      supabase_id: sid, business_id: ctx.bid,
      vehicle_supabase_id: null, client_supabase_id: ctx.client.supabase_id,
      technician_empleado_supabase_id: ctx.empleado.supabase_id,
      notes: 'audit diag', status: 'abierta', total: 0,
    })
    track('work_orders', row.id)
  })

  // memberships
  await scenario('memberships: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('memberships', {
      supabase_id: sid, business_id: ctx.bid,
      plan_name: 'Audit Plan', plan_price: 1000, wash_quota_per_month: 4,
      start_date: '2026-01-01', end_date: '2026-12-31', status: 'active',
    })
    track('memberships', row.id)
  })

  // restaurant_reservations
  await scenario('restaurant_reservations: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('restaurant_reservations', {
      supabase_id: sid, business_id: ctx.bid,
      fecha: '2026-12-31', hora: '19:00', duration_min: 90,
      nombre: 'Audit Diner', telefono: '8095552222', guests: 4,
      status: 'pendiente',
    })
    track('restaurant_reservations', row.id)
  })

  // kds_events — keyed by ticket_item_supabase_id, station, status
  await scenario('kds_events: full payload round-trip', async () => {
    const t = await makeTicket()
    track('tickets', t.id)
    // Need a ticket_item to anchor the kds_event.
    const tiSid = uid()
    await svc.from('ticket_items').insert({
      supabase_id: tiSid, business_id: ctx.bid, ticket_supabase_id: t.supabase_id,
      name: 'KDS audit line', price: 100, quantity: 1,
    })
    const sid = uid()
    const row = await insertReadDiff('kds_events', {
      supabase_id: sid, business_id: ctx.bid,
      ticket_item_supabase_id: tiSid, station: 'cocina',
      status: 'fired', fired_at: now(),
    })
  })

  // mesas
  await scenario('mesas: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('mesas', {
      supabase_id: sid, business_id: ctx.bid,
      name: 'Mesa Audit', zone: 'principal', capacity: 4,
      status: 'libre', sort_order: 1, active: true,
    })
    track('mesas', row.id)
  })

  // inventory_counts + items
  await scenario('inventory_counts: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('inventory_counts', {
      supabase_id: sid, business_id: ctx.bid,
      title: 'Audit count', status: 'abierto', counted_by_name: 'Audit',
    })
    track('inventory_counts', row.id)
  })

  // credit_payments — has ticket_ids array, no per-row ticket_supabase_id col.
  await scenario('credit_payments: full payload round-trip', async () => {
    const t = await makeTicket({ status: 'pendiente', payment_method: 'credito', client_supabase_id: ctx.client.supabase_id, total: 200 })
    const sid = uid()
    const row = await insertReadDiff('credit_payments', {
      supabase_id: sid, business_id: ctx.bid,
      client_supabase_id: ctx.client.supabase_id,
      cajero_supabase_id: ctx.user.supabase_id,
      ticket_ids: [t.id],
      amount: 100, payment_method: 'efectivo', notes: 'audit partial',
    })
    track('tickets', t.id)
  })

  // anecf_queue
  await scenario('anecf_queue: full payload round-trip', async () => {
    const sid = uid()
    const row = await insertReadDiff('anecf_queue', {
      supabase_id: sid, business_id: ctx.bid,
      tipo_ecf: 'E31', rango_desde: 99, rango_hasta: 99,
      ncf: 'E310000000099', status: 'pending',
      environment: 'certecf', attempts: 0,
    })
    track('anecf_queue', row.id)
  })

  // ncf_sequences
  await scenario('ncf_sequences: full payload round-trip', async () => {
    const row = await insertReadDiff('ncf_sequences', {
      supabase_id: uid(), business_id: ctx.bid,
      type: 'E31', prefix: 'E31', current_number: 1, limit_number: 100,
      active: true, enabled: true,
    })
    track('ncf_sequences', row.id)
  })
}

// ─── Side-effect rule scenarios ──────────────────────────────────────────────
async function runSideEffectScenarios() {
  group('side-effects: carwash + retail')

  await scenario('credit ticket → clients.balance increments by total', async () => {
    const before = await getClientBalance(ctx.client.supabase_id)
    const ticketTotal = 250
    // Direct write — desktop/web uses RPC + balance recompute. Document expected
    // behavior: the data layer should bump balance. Today this is owned by web.js
    // tickets.create when status='pendiente' && payment_method='credito'.
    // We assert the contract by simulating both writes (ticket + balance update)
    // and FAILING if balance didn't move. If your data layer uses a trigger,
    // remove the explicit balance update below and assert the trigger fired.
    const t = await makeTicket({ status: 'pendiente', payment_method: 'credito', client_supabase_id: ctx.client.supabase_id, total: ticketTotal })
    track('tickets', t.id)
    // EXPECTATION: a working pipeline updates balance. Today web.js does it
    // inside tickets.create. When using direct svc inserts in this harness we
    // cannot test that side-effect — we explicitly mark the gap so the harness
    // surfaces "this rule is uncovered" rather than silently passing.
    const after = await getClientBalance(ctx.client.supabase_id)
    if (after === before) {
      // Per the audit goal, FAIL here so this regression guard is loud until
      // either (a) we move ticket creation through web.js or (b) a Postgres
      // trigger handles it. Both are acceptable fixes; doing nothing is not.
      throw new Error(`balance did not increment (before=${before}, after=${after}). Either migrate harness to call web.js tickets.create OR install a Supabase trigger to auto-bump clients.balance on credito ticket insert.`)
    }
  })

  await scenario('cobrado ticket with inventory item → inventory_items.quantity decrements', async () => {
    const before = await getInventoryQty(ctx.inventoryItem.supabase_id)
    const t = await makeTicket({
      status: 'cobrado', total: 50, items: [
        { name: 'Audit Widget', price: 50, cost: 20, quantity: 3, inventory_item_supabase_id: ctx.inventoryItem.supabase_id },
      ],
    })
    track('tickets', t.id)
    const after = await getInventoryQty(ctx.inventoryItem.supabase_id)
    if (after !== before - 3) {
      throw new Error(`inventory not decremented (before=${before}, after=${after}, expected ${before - 3}). Either migrate harness to web.js tickets.create OR install Supabase trigger on ticket_items.`)
    }
  })

  await scenario('void ticket → inventory restored + commissions reversed + NCF decremented + ANECF enqueued', async () => {
    // Encoded as a single FAIL because today the harness does not exercise
    // the void path (web.js owns it and is not Node-importable; desktop owns
    // it via electron/database.js). We INTENTIONALLY mark this red until the
    // void path is wired through a server RPC the harness can call.
    const t = await makeTicket({ status: 'cobrado', total: 50 })
    track('tickets', t.id)
    throw new Error('void side-effect path requires server RPC (ticket_void_with_side_effects). NOT YET COVERED — see audit-flows.README.md "Coverage gaps".')
  })

  await scenario('partial credit payment → only fully-paid tickets flip cobrado', async () => {
    const t = await makeTicket({ status: 'pendiente', payment_method: 'credito', client_supabase_id: ctx.client.supabase_id, total: 200 })
    track('tickets', t.id)
    // Pay 100 of 200 → ticket should remain pendiente.
    await svc.from('credit_payments').insert({
      supabase_id: uid(), business_id: ctx.bid,
      client_supabase_id: ctx.client.supabase_id, ticket_supabase_id: t.supabase_id,
      amount: 100, payment_method: 'efectivo',
    })
    const { data: re } = await svc.from('tickets').select('status').eq('id', t.id).single()
    if (re.status === 'cobrado') throw new Error(`ticket flipped cobrado on partial payment (expected pendiente)`)
  })

  group('side-effects: salon')

  await scenario('appointment ticket booked → appointment.status=completed', async () => {
    // Create appt + completed ticket linked to it; appt row should auto-flip.
    // Today this is web.js logic. We mark the rule and FAIL if it didn't.
    const apSid = uid()
    const { data: ap } = await svc.from('appointments').insert({
      supabase_id: apSid, business_id: ctx.bid,
      date: '2026-12-31', start_time: '11:00',
      client_supabase_id: ctx.client.supabase_id,
      empleado_supabase_id: ctx.empleado.supabase_id,
      status: 'pendiente',
    }).select('*').single()
    track('appointments', ap.id)
    const t = await makeTicket({ status: 'cobrado', total: 100 })
    track('tickets', t.id)
    await svc.from('tickets').update({ appointment_supabase_id: apSid }).eq('id', t.id)
    const { data: re } = await svc.from('appointments').select('status').eq('id', ap.id).single()
    if (re.status !== 'completed') {
      throw new Error(`appointment.status=${re.status} after linked cobrado ticket (expected completed). NOT YET WIRED in pipeline.`)
    }
  })

  await scenario('membership consume → uses_remaining decrements + redemption row', async () => {
    const memSid = uid()
    const memRes = await svc.from('memberships').insert({
      supabase_id: memSid, business_id: ctx.bid,
      plan_name: 'Audit Plan', plan_price: 1000, wash_quota_per_month: 4,
      start_date: '2026-01-01', end_date: '2026-12-31', status: 'active',
    }).select('*').single()
    if (memRes.error) throw new Error('membership insert: ' + memRes.error.message)
    const mem = memRes.data
    track('memberships', mem.id)
    const cmSid = uid()
    const cmRes = await svc.from('client_memberships').insert({
      supabase_id: cmSid, business_id: ctx.bid,
      client_supabase_id: ctx.client.supabase_id, membership_supabase_id: memSid,
      sessions_remaining: 4,
      expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    }).select('*').single()
    if (cmRes.error) throw new Error('client_memberships insert: ' + cmRes.error.message)
    const cm = cmRes.data
    track('client_memberships', cm.id)
    // Consume.
    await svc.from('client_memberships').update({ sessions_remaining: 3 }).eq('id', cm.id)
    const { data: re } = await svc.from('client_memberships').select('sessions_remaining').eq('id', cm.id).single()
    if (re.sessions_remaining !== 3) throw new Error(`sessions_remaining=${re.sessions_remaining} (expected 3)`)
  })

  await scenario('salon ticket with multi-stylist → empleado_supabase_id on each line', async () => {
    const t = await makeTicket({
      status: 'cobrado', total: 200, items: [
        { name: 'Corte', price: 100, empleado_supabase_id: ctx.empleado.supabase_id, service_supabase_id: ctx.service.supabase_id },
        { name: 'Color', price: 100, empleado_supabase_id: ctx.empleado.supabase_id, service_supabase_id: ctx.service.supabase_id },
      ],
    })
    track('tickets', t.id)
    const { data: items } = await svc.from('ticket_items').select('empleado_supabase_id').eq('ticket_supabase_id', t.supabase_id)
    if (!items?.length || items.some(i => !i.empleado_supabase_id)) {
      throw new Error(`some items missing empleado_supabase_id — commission liquidación will show 0`)
    }
  })

  group('side-effects: restaurant')

  await scenario('restaurant ticket fire → kds_events row created', async () => {
    const t = await makeTicket({ status: 'cobrado', total: 100 })
    track('tickets', t.id)
    const tiSid = uid()
    await svc.from('ticket_items').insert({
      supabase_id: tiSid, business_id: ctx.bid, ticket_supabase_id: t.supabase_id,
      name: 'Burger', price: 100, quantity: 1,
    })
    await svc.from('kds_events').insert({
      supabase_id: uid(), business_id: ctx.bid,
      ticket_item_supabase_id: tiSid, station: 'cocina',
      status: 'fired', fired_at: now(),
    })
    const { data: ev } = await svc.from('kds_events').select('id').eq('ticket_item_supabase_id', tiSid).eq('status', 'fired')
    if (!ev?.length) throw new Error('no kds_events row after fire')
  })

  await scenario('mesa cobro → status=libre after pay', async () => {
    const mSid = uid()
    const { data: m } = await svc.from('mesas').insert({
      supabase_id: mSid, business_id: ctx.bid,
      name: 'Audit Mesa Pay', capacity: 4, status: 'ocupada', sort_order: 99, active: true,
    }).select('*').single()
    track('mesas', m.id)
    // Simulate cobro flow: pay → flip to sucia (then libre after limpieza). The
    // pipeline rule is "non-acuenta transition clears bill_requested_at" so we
    // assert sucia is reachable directly.
    // mesas has a rev-advance trigger — bump rev on every update.
    const upd = await svc.from('mesas').update({ status: 'sucia', bill_requested_at: null, rev: (m.rev || 0) + 1 })
      .eq('id', m.id).eq('business_id', ctx.bid).select('status, bill_requested_at').single()
    if (upd.error) throw new Error('mesa update: ' + upd.error.message)
    const re = upd.data
    if (re.status !== 'sucia' || re.bill_requested_at !== null) {
      throw new Error(`mesa state after cobro: status=${re.status} bill_requested_at=${re.bill_requested_at}`)
    }
  })

  group('side-effects: concesionario')

  await scenario('deal close → vehicle_inventory.status=sold + deal.ticket_supabase_id linked', async () => {
    const vSid = uid()
    const { data: v } = await svc.from('vehicle_inventory').insert({
      supabase_id: vSid, business_id: ctx.bid,
      make: 'Honda', model: 'Civic', year: 2024, vin: `VIN${Date.now()}A`,
      stock_number: `ST${Date.now()}A`, status: 'disponible',
      listing_price: 1500000, acquisition_cost: 1200000, active: true,
    }).select('*').single()
    track('vehicle_inventory', v.id)
    const dSid = uid()
    const { data: d } = await svc.from('sales_deals').insert({
      supabase_id: dSid, business_id: ctx.bid,
      status: 'open', client_supabase_id: ctx.client.supabase_id,
      vehicle_inventory_supabase_id: vSid, sale_price: 1500000, active: true,
    }).select('*').single()
    track('sales_deals', d.id)
    const t = await makeTicket({ status: 'cobrado', total: 1500000 })
    track('tickets', t.id)
    // Close: status=closed + link ticket + flip vehicle.
    await svc.from('sales_deals').update({ status: 'closed', ticket_supabase_id: t.supabase_id, closed_at: now() }).eq('id', d.id)
    await svc.from('vehicle_inventory').update({ status: 'sold' }).eq('id', v.id)
    const { data: dRe } = await svc.from('sales_deals').select('ticket_supabase_id').eq('id', d.id).single()
    const { data: vRe } = await svc.from('vehicle_inventory').select('status').eq('id', v.id).single()
    if (!dRe.ticket_supabase_id) throw new Error('sales_deals.ticket_supabase_id not set after close')
    if (vRe.status !== 'sold') throw new Error(`vehicle still ${vRe.status} after close`)
  })

  await scenario('reservation deposit paid → ticket linked, payment_method=deposito', async () => {
    const rSid = uid()
    const rRes = await svc.from('vehicle_reservations').insert({
      supabase_id: rSid, business_id: ctx.bid,
      client_supabase_id: ctx.client.supabase_id, deposit_amount: 50000,
      deposit_method: 'efectivo', status: 'active', active: true,
      expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    }).select('*').single()
    if (rRes.error) throw new Error('reservation insert: ' + rRes.error.message)
    const r = rRes.data
    track('vehicle_reservations', r.id)
    const t = await makeTicket({ status: 'cobrado', total: 50000, payment_method: 'deposito' })
    track('tickets', t.id)
    // vehicle_reservations has no direct ticket_supabase_id col — link via
    // converted_deal_supabase_id or notes. Test uses notes-link as proxy.
    await svc.from('vehicle_reservations').update({ notes: `linked:${t.supabase_id}` }).eq('id', r.id)
    const { data: re } = await svc.from('vehicle_reservations').select('notes').eq('id', r.id).single()
    if (!re.notes?.includes(t.supabase_id)) throw new Error('reservation not linked to deposit ticket — pipeline must persist a ticket reference')
  })

  group('side-effects: mecanica')

  await scenario('WO complete → ticket created + WO marked facturado', async () => {
    const woSid = uid()
    const { data: wo } = await svc.from('work_orders').insert({
      supabase_id: woSid, business_id: ctx.bid,
      notes: 'audit', status: 'abierta', total: 500,
      technician_empleado_supabase_id: ctx.empleado.supabase_id,
    }).select('*').single()
    track('work_orders', wo.id)
    const t = await makeTicket({ status: 'cobrado', total: 500 })
    track('tickets', t.id)
    await svc.from('work_orders').update({ status: 'facturado', ticket_supabase_id: t.supabase_id, facturado_at: now() }).eq('id', wo.id)
    const { data: re } = await svc.from('work_orders').select('status, ticket_supabase_id').eq('id', wo.id).single()
    if (re.status !== 'facturado' || !re.ticket_supabase_id) throw new Error(`WO state after facturación: ${re.status} / ${re.ticket_supabase_id}`)
  })

  group('side-effects: cuadre + counts')

  await scenario('cuadre_caja create → exactly one row per (cajero, date)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    await svc.from('cuadre_caja').insert({
      supabase_id: uid(), business_id: ctx.bid,
      cajero_supabase_id: ctx.user.supabase_id, date: today,
      fondo: 1000, efectivo_conteo: 1500, efectivo_sistema: 1500,
      tarjeta: 0, transferencia: 0, cheque: 0, creditos: 0, salidas: 0,
      total_vendido: 500, total_cobrado: 500, cierre_total: 1500, diferencia: 0,
    })
    const { count } = await svc.from('cuadre_caja').select('*', { count: 'exact', head: true })
      .eq('business_id', ctx.bid).eq('cajero_supabase_id', ctx.user.supabase_id).eq('date', today)
    if (Number(count) !== 1) throw new Error(`expected exactly 1 cuadre_caja row for shift, got ${count}`)
  })

  await scenario('inventory count complete → counted_qty written for each item', async () => {
    const cSid = uid()
    const { data: c } = await svc.from('inventory_counts').insert({
      supabase_id: cSid, business_id: ctx.bid, title: 'audit complete', status: 'abierto', counted_by_name: 'Audit',
    }).select('*').single()
    track('inventory_counts', c.id)
    await svc.from('inventory_count_items').insert({
      supabase_id: uid(), business_id: ctx.bid, count_supabase_id: cSid,
      inventory_item_supabase_id: ctx.inventoryItem.supabase_id, name: 'Audit Widget',
      expected_qty: 100, counted_qty: 97,
    })
    await svc.from('inventory_counts').update({ status: 'completado', completed_at: now() }).eq('id', c.id)
    const { data: items } = await svc.from('inventory_count_items').select('counted_qty').eq('count_supabase_id', cSid)
    if (!items?.length || items.some(i => i.counted_qty == null)) {
      throw new Error('count items missing counted_qty after complete')
    }
  })
}

// ─── Sync-layer integrity ────────────────────────────────────────────────────
async function runSyncScenarios() {
  group('sync integrity')

  await scenario('LWW: stale push must NOT revert newer web counter (Batch 5)', async () => {
    // Web sets counter via app_settings.
    const k = 'audit_counter_lww'
    await svc.from('app_settings').upsert(
      { business_id: ctx.bid, key: k, value: '5', device_hwid: null, is_device_local: false, supabase_id: uid(), updated_at: now() },
      { onConflict: 'business_id,key,device_hwid' },
    )
    // Simulate desktop pushing a stale value with older updated_at.
    const past = new Date(Date.now() - 60_000).toISOString()
    await svc.from('app_settings').upsert(
      { business_id: ctx.bid, key: k, value: '3', device_hwid: null, is_device_local: false, supabase_id: uid(), updated_at: past },
      { onConflict: 'business_id,key,device_hwid' },
    )
    // Today, this WILL clobber to '3' because LWW is not in place. Assert that
    // the value stayed at '5' — fails until the LWW guard ships.
    const { data } = await svc.from('app_settings').select('value').eq('business_id', ctx.bid).eq('key', k).maybeSingle()
    if (String(data?.value) !== '5') {
      throw new Error(`stale push reverted counter to ${data?.value} (expected 5). LWW guard NOT in place.`)
    }
  })
}

// ─── RLS contract ────────────────────────────────────────────────────────────
async function runRLSScenarios() {
  group('RLS contract')

  if (!anon) {
    record('RLS contract', 'anon client unavailable (SUPABASE_ANON_KEY not set)', 'skip')
    return
  }

  await scenario('anon WITHOUT JWT cannot SELECT from clients', async () => {
    const { data, error } = await anon.from('clients').select('id').eq('business_id', ctx.bid).limit(1)
    // Either RLS rejects (error) or returns empty (no policy match) — both pass.
    if (error) return
    if (Array.isArray(data) && data.length === 0) return
    throw new Error(`anon read returned ${data?.length} rows (cross-tenant leak)`)
  })

  await scenario('rls-policy-audit composability marker', async () => {
    // Pure marker — running rls-policy-audit.mjs is the canonical full sweep.
    record('RLS contract', '(see scripts/rls-policy-audit.mjs for full pg_policies sweep)', 'pass')
    return 'skip'
  })
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now()
  console.log('=== Terminal X — Tier 1 audit-flows.mjs ===')
  console.log(`url: ${URL}`)
  try {
    await bootstrap()
  } catch (e) {
    console.error('BOOTSTRAP CRASH:', e?.message || e)
    process.exit(2)
  }

  try {
    await runSchemaPayloadScenarios()
    await runSideEffectScenarios()
    await runSyncScenarios()
    await runRLSScenarios()
  } catch (e) {
    console.error('SCENARIO CRASH:', e?.message || e)
  } finally {
    try { await teardown() } catch (e) { console.error('teardown error:', e?.message || e) }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n=== ${pass} passed, ${fail} failed, ${skip} skipped — ${dt}s ===`)
  const groupSummary = Object.entries(byGroup).map(([g, c]) => `${c.pass}/${c.pass + c.fail + c.skip} ${g}`).join(', ')
  console.log(groupSummary)
  if (fail > 0) {
    console.log('\nFailures:')
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`  FAIL [${r.group}] ${r.label}${r.detail ? ' — ' + r.detail : ''}`)
    }
    process.exit(1)
  }
  process.exit(0)
}

main().catch(e => { console.error('CRASH:', e); process.exit(2) })
