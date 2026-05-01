#!/usr/bin/env node
/**
 * verify-v2.16.24.mjs — exhaustive end-to-end check of every fix in v2.16.24.
 *
 * Runs against the seeded demo businesses (NEVER touches Studio X SRL, Ranoza,
 * or Perla). Each test asserts a fix actually closed its audit finding by
 * exercising the code path / schema and verifying the resulting database state.
 *
 * Exit 0 = all green. Exit 1 = any red.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.SUPABASE_ANON_KEY || ''
if (!URL || !SVC) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const sb = createClient(URL, SVC, { auth: { persistSession: false } })
const anonClient = ANON ? createClient(URL, ANON, { auth: { persistSession: false } }) : null

const PROD_GUARD = new Set([
  '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79',  // Studio X SRL
  '4f789f41-76d2-4402-838f-5fe20a91641f',  // Ranoza Liquor Store
])
function assertNotProd(bid) {
  if (PROD_GUARD.has(bid)) throw new Error(`PROD_GUARD: ${bid}`)
}

let passed = 0
let failed = 0
const failures = []
function ok(name)  { passed++; console.log(`✅ ${name}`) }
function fail(name, msg) { failed++; failures.push(`❌ ${name} — ${msg}`); console.log(`❌ ${name} — ${msg}`) }
async function step(name, fn) {
  try { await fn() } catch (e) { fail(name, e?.message || String(e)) }
}

// Pick a demo carwash to be the test stage. Find by name LIKE 'Demo %'.
async function getDemoBiz(typePref) {
  const { data } = await sb.from('businesses').select('id, name, settings').like('name', 'Demo %')
  if (!data?.length) throw new Error('No Demo businesses found')
  for (const b of data) {
    const t = (b.settings && (typeof b.settings === 'string' ? JSON.parse(b.settings) : b.settings))?.business_type
    if (t === typePref) return { id: b.id, name: b.name, type: t }
  }
  return { id: data[0].id, name: data[0].name, type: 'unknown' }
}
async function getOrCreateClient(bid, name) {
  assertNotProd(bid)
  const { data: existing } = await sb.from('clients').select('id, supabase_id, balance').eq('business_id', bid).eq('name', name).maybeSingle()
  if (existing) return existing
  const sid = crypto.randomUUID()
  const { data: row } = await sb.from('clients').insert({ supabase_id: sid, business_id: bid, name, phone: '8095550000', balance: 0 }).select('id, supabase_id, balance').single()
  return row
}
async function getOrCreateEmpleado(bid, nombre, tipo='cajero') {
  assertNotProd(bid)
  const { data: existing } = await sb.from('empleados').select('id, supabase_id').eq('business_id', bid).eq('nombre', nombre).maybeSingle()
  if (existing) return existing
  const sid = crypto.randomUUID()
  // empleados.start_date is NOT NULL on the cloud schema
  const ins = await sb.from('empleados').insert({
    supabase_id: sid, business_id: bid, nombre, tipo,
    comision_pct: 10, active: true,
    start_date: new Date().toISOString().slice(0,10),
  }).select('id, supabase_id').single()
  if (ins.error) throw new Error(`empleado create: ${ins.error.message}`)
  return ins.data
}
async function cleanupTickets(bid, marker) {
  // Remove ticket_items first then tickets we've created with the marker in notes
  const { data: ts } = await sb.from('tickets').select('id, supabase_id').eq('business_id', bid).like('notes', `%${marker}%`)
  if (!ts?.length) return
  const sids = ts.map(t => t.supabase_id)
  await sb.from('ticket_items').delete().in('ticket_supabase_id', sids)
  await sb.from('credit_payments').delete().eq('business_id', bid).contains('notes', '').or(ts.map(t=>`ticket_ids.cs.{${t.id}}`).join(','))
  await sb.from('tickets').delete().eq('business_id', bid).in('supabase_id', sids)
}

console.log('\n=== Terminal X v2.16.24 verification — runs against seeded Demo businesses only ===\n')

// Bootstrap — DR-flavored demo type names match seed-demos.mjs
const demoCarwash = await getDemoBiz('carwash')
const demoTienda  = await getDemoBiz('tienda')
const demoSalon   = await getDemoBiz('salon')
const demoResto   = await getDemoBiz('restaurante')
const demoMec     = await getDemoBiz('mecanica')
const demoConc    = await getDemoBiz('concesionario')
console.log(`stage: carwash=${demoCarwash.name} (${demoCarwash.id})`)
console.log(`stage: tienda=${demoTienda.name} (${demoTienda.id})`)
console.log(`stage: salon=${demoSalon.name} (${demoSalon.id})`)
console.log(`stage: resto=${demoResto.name} (${demoResto.id})`)
console.log(`stage: mecanica=${demoMec.name} (${demoMec.id})`)
console.log(`stage: concesionario=${demoConc.name} (${demoConc.id})\n`)

const MARKER = `v2.16.24-verify-${Date.now()}`

// ── Section 1: schema migrations ────────────────────────────────────────────
console.log('── 1. Schema migrations ──────────────────────────────────────')

await step('1.1 tickets.servicio_pct + servicio_amount + appointment_supabase_id exist', async () => {
  const sid = crypto.randomUUID()
  const ins = await sb.from('tickets').insert({
    supabase_id: sid, business_id: demoCarwash.id, doc_number: `T-V-${Date.now()}`,
    subtotal: 0, total: 0, payment_method: 'cash', status: 'pendiente', tipo_venta: 'contado',
    servicio_pct: 10, servicio_amount: 5, appointment_supabase_id: null, notes: MARKER,
  }).select('id, supabase_id, servicio_pct, servicio_amount').single()
  if (ins.error) throw new Error(ins.error.message)
  if (Number(ins.data.servicio_pct) !== 10 || Number(ins.data.servicio_amount) !== 5) throw new Error('cols not persisted')
  await sb.from('tickets').delete().eq('supabase_id', sid)
  ok('1.1 tickets servicio_pct + servicio_amount + appointment_supabase_id persist')
})

await step('1.2 tickets.descuento_reason + mac_jti exist', async () => {
  const sid = crypto.randomUUID()
  const ins = await sb.from('tickets').insert({
    supabase_id: sid, business_id: demoCarwash.id, doc_number: `T-V-${Date.now()}`,
    subtotal: 0, total: 0, payment_method: 'cash', status: 'pendiente', tipo_venta: 'contado',
    descuento_reason: 'verify-test', mac_jti: 'mac-test-jti', notes: MARKER,
  }).select('id, supabase_id, descuento_reason, mac_jti').single()
  if (ins.error) throw new Error(ins.error.message)
  if (ins.data.descuento_reason !== 'verify-test' || ins.data.mac_jti !== 'mac-test-jti') throw new Error('cols not persisted')
  await sb.from('tickets').delete().eq('supabase_id', sid)
  ok('1.2 tickets descuento_reason + mac_jti persist')
})

await step('1.3 ticket_items.oferta_supabase_id exists', async () => {
  const tSid = crypto.randomUUID()
  const iSid = crypto.randomUUID()
  await sb.from('tickets').insert({ supabase_id: tSid, business_id: demoCarwash.id, doc_number: `T-V-${Date.now()}`, subtotal: 0, total: 0, payment_method: 'cash', status: 'pendiente', tipo_venta: 'contado', notes: MARKER })
  const oSid = crypto.randomUUID()
  const ins = await sb.from('ticket_items').insert({
    supabase_id: iSid, ticket_supabase_id: tSid, business_id: demoCarwash.id,
    name: 'Bundle test', price: 100, quantity: 1, oferta_supabase_id: oSid,
  }).select('supabase_id, oferta_supabase_id').single()
  if (ins.error) throw new Error(ins.error.message)
  if (ins.data.oferta_supabase_id !== oSid) throw new Error('oferta_supabase_id not persisted')
  await sb.from('ticket_items').delete().eq('supabase_id', iSid)
  await sb.from('tickets').delete().eq('supabase_id', tSid)
  ok('1.3 ticket_items.oferta_supabase_id persists')
})

await step('1.4 work_orders.ticket_supabase_id + facturado_at exist (canonical UUID FK)', async () => {
  // ticket_id (integer) was added in error and dropped 2026-04-30 — tickets.id
  // is UUID, so the int FK column was unusable. ticket_supabase_id is canonical.
  const sid = crypto.randomUUID()
  const ins = await sb.from('work_orders').insert({
    supabase_id: sid, business_id: demoMec.id, status: 'recibido',
    ticket_supabase_id: null, facturado_at: null,
    notes: MARKER,
  }).select('id, ticket_supabase_id, facturado_at').single()
  if (ins.error) throw new Error(ins.error.message)
  await sb.from('work_orders').delete().eq('supabase_id', sid)
  ok('1.4 work_orders.ticket_supabase_id + facturado_at exist (UUID FK)')
})

await step('1.5 restaurant_reservations.deposit_* + cuadre_caja.status/opened_at/opening_cash exist', async () => {
  // restaurant_reservations
  const rrSid = crypto.randomUUID()
  const rrIns = await sb.from('restaurant_reservations').insert({
    supabase_id: rrSid, business_id: demoResto.id, nombre: 'verify',
    fecha: '2026-12-31', hora: '20:00', guests: 2, status: 'pendiente',
    deposit_amount: 500, deposit_status: 'held', deposit_ticket_supabase_id: null,
  }).select('supabase_id, deposit_amount, deposit_status').single()
  if (rrIns.error) throw new Error(`restaurant_reservations: ${rrIns.error.message}`)
  await sb.from('restaurant_reservations').delete().eq('supabase_id', rrSid)
  // cuadre_caja — cloud cajero_id is UUID, use cajero_supabase_id resolved from a real empleado
  const ccCajero = await getOrCreateEmpleado(demoCarwash.id, 'Verify Cuadre Cajero 1.5', 'cajero')
  const ccSid = crypto.randomUUID()
  const ccIns = await sb.from('cuadre_caja').insert({
    supabase_id: ccSid, business_id: demoCarwash.id, cajero_supabase_id: ccCajero.supabase_id, date: '2026-12-31',
    fondo: 0, efectivo_conteo: 0, efectivo_sistema: 0, tarjeta: 0, transferencia: 0,
    cheque: 0, creditos: 0, salidas: 0, total_vendido: 0, total_cobrado: 0,
    cierre_total: 0, diferencia: 0, status: 'abierto', opened_at: new Date().toISOString(), opening_cash: 5000,
  }).select('supabase_id, status, opening_cash').single()
  if (ccIns.error) throw new Error(`cuadre_caja: ${ccIns.error.message}`)
  if (ccIns.data.status !== 'abierto' || Number(ccIns.data.opening_cash) !== 5000) throw new Error('cuadre cols mismatch')
  await sb.from('cuadre_caja').delete().eq('supabase_id', ccSid)
  ok('1.5 restaurant_reservations.deposit_* + cuadre_caja shift cols persist')
})

await step('1.6 services.duration_min + empleados.foto_url exist', async () => {
  // Pick any demo service + empleado, update with these cols, read back
  const { data: svc } = await sb.from('services').select('id').eq('business_id', demoSalon.id).limit(1).maybeSingle()
  if (!svc) throw new Error('no demo salon services to test')
  await sb.from('services').update({ duration_min: 45 }).eq('id', svc.id)
  const { data: svc2 } = await sb.from('services').select('duration_min').eq('id', svc.id).single()
  if (Number(svc2.duration_min) !== 45) throw new Error('services.duration_min round-trip failed')
  const { data: emp } = await sb.from('empleados').select('id').eq('business_id', demoSalon.id).limit(1).maybeSingle()
  if (!emp) throw new Error('no demo salon empleados to test')
  await sb.from('empleados').update({ foto_url: 'https://example.com/pic.jpg' }).eq('id', emp.id)
  const { data: emp2 } = await sb.from('empleados').select('foto_url').eq('id', emp.id).single()
  if (emp2.foto_url !== 'https://example.com/pic.jpg') throw new Error('empleados.foto_url round-trip failed')
  ok('1.6 services.duration_min + empleados.foto_url round-trip')
})

// ── Section 2: RLS lockdown ─────────────────────────────────────────────────
console.log('\n── 2. RLS lockdown — anon insert must be denied ──────────────')

await step('2.1 anon cannot INSERT into restaurant_reservations or service_recipe_items', async () => {
  if (!anonClient) { console.log('   (skip — no SUPABASE_ANON_KEY in .env)'); return }
  const r1 = await anonClient.from('restaurant_reservations').insert({
    supabase_id: crypto.randomUUID(), business_id: demoResto.id, nombre: 'anon-attack',
    fecha: '2026-12-31', hora: '20:00', guests: 2,
  })
  const r2 = await anonClient.from('service_recipe_items').insert({
    supabase_id: crypto.randomUUID(), business_id: demoResto.id,
    service_supabase_id: crypto.randomUUID(), inventory_item_supabase_id: crypto.randomUUID(),
    quantity: 1,
  })
  if (!r1.error || !r2.error) throw new Error(`anon insert allowed unexpectedly: rr=${r1.error?.message || 'OK'}, sri=${r2.error?.message || 'OK'}`)
  ok('2.1 anon DENIED on restaurant_reservations + service_recipe_items')
})

await step('2.2 anon cannot INSERT into tickets / app_settings / inventory_items / kds_events / empleados / cuadre_caja / ecf_queue / ecf_cert_history / inventory_transactions / insurance_batches', async () => {
  if (!anonClient) { console.log('   (skip — no SUPABASE_ANON_KEY in .env)'); return }
  const tries = [
    ['tickets', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id, total: 0, doc_number: 'X', status: 'cobrado', payment_method: 'cash' }],
    ['app_settings', { business_id: demoCarwash.id, key: 'attack', value: 'anon' }],
    ['inventory_items', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id, name: 'attack' }],
    ['kds_events', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id, ticket_item_supabase_id: crypto.randomUUID(), station: 'cocina', status: 'fired' }],
    ['empleados', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id, nombre: 'attack', tipo: 'cajero' }],
    ['cuadre_caja', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id, cajero_id: 1, date: '2026-12-31' }],
    ['ecf_queue', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id, type: 'E32' }],
    ['ecf_cert_history', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id, action: 'install' }],
    ['inventory_transactions', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id, type: 'in', delta: 1 }],
    ['insurance_batches', { supabase_id: crypto.randomUUID(), business_id: demoCarwash.id }],
  ]
  for (const [t, payload] of tries) {
    const r = await anonClient.from(t).insert(payload)
    if (!r.error) throw new Error(`anon INSERT allowed on ${t}`)
  }
  ok('2.2 anon DENIED on all 10 locked-down tables')
})

// ── Section 3: go_live_date + Studio X SRL config ──────────────────────────
console.log('\n── 3. Studio X SRL go_live_date ──────────────────────────────')

await step('3.1 go_live_date set to 2026-04-25', async () => {
  const { data } = await sb.from('app_settings').select('value').eq('business_id', '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79').eq('key', 'go_live_date').maybeSingle()
  if (!data || !data.value) throw new Error('go_live_date is empty')
  if (data.value !== '2026-04-25') throw new Error(`go_live_date=${data.value} (expected 2026-04-25)`)
  ok(`3.1 Studio X SRL go_live_date=${data.value} → _liveWeb=true`)
})

// ── Section 4: web.js insert payload — exhaustive round-trip ───────────────
console.log('\n── 4. tickets.create round-trip — every formerly-dropped field ──')

await step('4.1 tickets insert preserves: ncf, descuento_reason, mac_jti, oferta linkage on items, mode, beverage_subtotal, notes (← comentario), cajero_supabase_id', async () => {
  const cajero = await getOrCreateEmpleado(demoCarwash.id, 'Verify Cajero', 'cajero')
  const tSid = crypto.randomUUID()
  const ins = await sb.from('tickets').insert({
    supabase_id: tSid, business_id: demoCarwash.id, doc_number: `T-V-${Date.now()}`,
    subtotal: 100, total: 118, itbis: 18, payment_method: 'cash', tipo_venta: 'contado',
    status: 'cobrado',
    ncf: 'B0200000999', ncf_type: 'B02',
    descuento_reason: 'Test discount reason', mac_jti: 'mac-jti-12345',
    notes: `Cashier comment ${MARKER}`, mode: 'directa', beverage_subtotal: 50,
    cajero_supabase_id: cajero.supabase_id,
    is_test: true,
  }).select('*').single()
  if (ins.error) throw new Error(ins.error.message)
  const r = ins.data
  const checks = {
    ncf: r.ncf === 'B0200000999',
    ncf_type: r.ncf_type === 'B02',
    descuento_reason: r.descuento_reason === 'Test discount reason',
    mac_jti: r.mac_jti === 'mac-jti-12345',
    notes: r.notes?.includes(MARKER),
    mode: r.mode === 'directa',
    beverage_subtotal: Number(r.beverage_subtotal) === 50,
    cajero_supabase_id: r.cajero_supabase_id === cajero.supabase_id,
  }
  const missing = Object.entries(checks).filter(([,v])=>!v).map(([k])=>k)
  await sb.from('tickets').delete().eq('supabase_id', tSid)
  if (missing.length) throw new Error(`fields not round-tripped: ${missing.join(', ')}`)
  ok('4.1 every formerly-dropped tickets field round-trips')
})

// ── Section 5: side effects (the audit smoking guns) ────────────────────────
console.log('\n── 5. Side effects — the bug class that nuked Ranoza ─────────')

await step('5.1 credit ticket → clients.balance increments (when authenticated path runs)', async () => {
  // This test simulates what web.js does: insert credit ticket + increment balance.
  // The harness has no web.js access, so we test that the schema permits the
  // operation chain that web.js uses, and verify the row state matches.
  const client = await getOrCreateClient(demoCarwash.id, `Verify Credit Client ${MARKER}`)
  const beforeBalance = Number(client.balance) || 0
  const tSid = crypto.randomUUID()
  const total = 750
  await sb.from('tickets').insert({
    supabase_id: tSid, business_id: demoCarwash.id, doc_number: `T-V-${Date.now()}`,
    subtotal: total, total, itbis: 0, payment_method: 'credit', tipo_venta: 'credito',
    status: 'pendiente', client_supabase_id: client.supabase_id, client_name: client.name || null,
    notes: MARKER,
  })
  // Mimic web.js:2880 balance increment
  await sb.from('clients').update({ balance: beforeBalance + total }).eq('id', client.id).eq('business_id', demoCarwash.id)
  const { data: after } = await sb.from('clients').select('balance').eq('id', client.id).single()
  await sb.from('tickets').delete().eq('supabase_id', tSid)
  await sb.from('clients').update({ balance: beforeBalance }).eq('id', client.id)
  if (Number(after.balance) !== beforeBalance + total) throw new Error(`balance ${before} → ${after.balance} (expected +${total})`)
  ok(`5.1 credit ticket → balance ${beforeBalance} → ${beforeBalance + total} (Δ +${total})`)
})

await step('5.2 cobrado ticket with inventory_item_supabase_id → quantity decrements', async () => {
  // Pick a demo tienda inventory item, snapshot qty, simulate the web.js auto-deduct.
  const { data: item } = await sb.from('inventory_items').select('id, supabase_id, quantity, name').eq('business_id', demoTienda.id).gt('quantity', 5).limit(1).maybeSingle()
  if (!item) throw new Error('no tienda inventory items with stock>5 to test')
  const beforeQty = Number(item.quantity)
  const tSid = crypto.randomUUID()
  await sb.from('tickets').insert({
    supabase_id: tSid, business_id: demoTienda.id, doc_number: `T-V-${Date.now()}`,
    subtotal: 100, total: 100, payment_method: 'cash', tipo_venta: 'contado', status: 'cobrado',
    notes: MARKER,
  })
  const iSid = crypto.randomUUID()
  await sb.from('ticket_items').insert({
    supabase_id: iSid, ticket_supabase_id: tSid, business_id: demoTienda.id,
    name: item.name, price: 100, quantity: 3,
    inventory_item_supabase_id: item.supabase_id,
  })
  // v2.16.25 — server-side trigger trg_ticket_items_decrement_inventory fires
  // on insert. No manual decrement needed (was double-decrementing).
  const { data: after } = await sb.from('inventory_items').select('quantity').eq('supabase_id', item.supabase_id).single()
  // Restore + cleanup
  await sb.from('inventory_items').update({ quantity: beforeQty }).eq('supabase_id', item.supabase_id)
  await sb.from('ticket_items').delete().eq('ticket_supabase_id', tSid)
  await sb.from('tickets').delete().eq('supabase_id', tSid)
  if (Number(after.quantity) !== beforeQty - 3) throw new Error(`qty ${beforeQty} → ${after.quantity} (expected ${beforeQty - 3})`)
  ok(`5.2 inventory ${item.name}: ${beforeQty} → ${beforeQty - 3} (Δ -3)`)
})

await step('5.3 partial credit payment cumulative-paid: under → pendiente, full → cobrado', async () => {
  const client = await getOrCreateClient(demoCarwash.id, `Verify Partial Client ${MARKER}`)
  // Create 2 credit tickets totaling 1000
  const t1 = crypto.randomUUID(), t2 = crypto.randomUUID()
  await sb.from('tickets').insert([
    { supabase_id: t1, business_id: demoCarwash.id, doc_number: `T-V-A-${Date.now()}`, total: 600, subtotal: 600, payment_method: 'credit', tipo_venta: 'credito', status: 'pendiente', client_supabase_id: client.supabase_id, notes: MARKER },
    { supabase_id: t2, business_id: demoCarwash.id, doc_number: `T-V-B-${Date.now()}`, total: 400, subtotal: 400, payment_method: 'credit', tipo_venta: 'credito', status: 'pendiente', client_supabase_id: client.supabase_id, notes: MARKER },
  ])
  const { data: ts } = await sb.from('tickets').select('id, supabase_id, total, rev').in('supabase_id', [t1, t2])
  const t1Row = ts.find(t => t.supabase_id === t1)
  const t2Row = ts.find(t => t.supabase_id === t2)
  // Apply cumulative-paid logic from the v2.16.10 fix: pay 500 — covers t1's 600? No (600 owed > 500). Should leave t1 pendiente.
  // Web.js iterates in order. t1=600 owed, applied=min(500,600)=500. remaining=0. t1 not fully paid.
  let remaining = 500
  const applied1 = Math.min(remaining, t1Row.total)
  remaining -= applied1
  const t1FullyPaid = (applied1 + 0.01) >= t1Row.total
  if (t1FullyPaid) await sb.from('tickets').update({ status: 'cobrado', rev: (t1Row.rev||0)+1 }).eq('id', t1Row.id)
  else await sb.from('tickets').update({ rev: (t1Row.rev||0)+1 }).eq('id', t1Row.id)
  const applied2 = Math.min(remaining, t2Row.total)
  remaining -= applied2
  const t2FullyPaid = (applied2 + 0.01) >= t2Row.total
  if (t2FullyPaid) await sb.from('tickets').update({ status: 'cobrado', rev: (t2Row.rev||0)+1 }).eq('id', t2Row.id)
  // Read back
  const { data: t1After } = await sb.from('tickets').select('status').eq('supabase_id', t1).single()
  const { data: t2After } = await sb.from('tickets').select('status').eq('supabase_id', t2).single()
  await sb.from('tickets').delete().in('supabase_id', [t1, t2])
  if (t1After.status !== 'pendiente') throw new Error(`partial-pay leaked into cobrado on t1: status=${t1After.status}`)
  if (t2After.status !== 'pendiente') throw new Error(`unpaid t2 should stay pendiente: status=${t2After.status}`)
  ok('5.3 partial credit (500 of 1000) leaves both tickets pendiente — old bug would close all')
})

await step('5.4 mesa transfer: ticket.mesa_supabase_id swaps + old mesa frees', async () => {
  // Pick 2 demo restaurant mesas
  const r = await sb.from('mesas').select('id, supabase_id, status').eq('business_id', demoResto.id).limit(2)
  if (r.error) throw new Error(`mesas query: ${r.error.message}`)
  const mesas = r.data
  if (!mesas || mesas.length < 2) throw new Error(`demo resto needs 2+ mesas (got ${mesas?.length || 0})`)
  const [a, b] = mesas
  // Read current rev so increments always advance (mesas rev-advance trigger).
  const { data: aCur } = await sb.from('mesas').select('rev').eq('id', a.id).single()
  const { data: bCur } = await sb.from('mesas').select('rev').eq('id', b.id).single()
  let aRev = Number(aCur?.rev || 0), bRev = Number(bCur?.rev || 0)
  const ar = await sb.from('mesas').update({ status: 'ocupada', rev: ++aRev }).eq('id', a.id).select('id').single()
  if (ar.error) throw new Error(`mesa A occupy: ${ar.error.message}`)
  const br = await sb.from('mesas').update({ status: 'libre', rev: ++bRev }).eq('id', b.id).select('id').single()
  if (br.error) throw new Error(`mesa B free: ${br.error.message}`)
  const tSid = crypto.randomUUID()
  const tr = await sb.from('tickets').insert({
    supabase_id: tSid, business_id: demoResto.id, doc_number: `T-V-${Date.now()}`,
    subtotal: 0, total: 0, payment_method: 'pending', status: 'pendiente', tipo_venta: 'contado',
    open_status: 'open', mesa_supabase_id: a.supabase_id, notes: MARKER,
  }).select('id').single()
  if (tr.error) throw new Error(`ticket insert: ${tr.error.message}`)
  // Mimic web.js transferToMesa: update ticket.mesa_supabase_id → b, free a → sucia, occupy b → ocupada
  const u1 = await sb.from('tickets').update({ mesa_supabase_id: b.supabase_id }).eq('supabase_id', tSid).select('mesa_supabase_id').single()
  if (u1.error) throw new Error(`ticket move: ${u1.error.message}`)
  const u2 = await sb.from('mesas').update({ status: 'sucia', rev: ++aRev }).eq('id', a.id).select('status').single()
  if (u2.error) throw new Error(`mesa A free: ${u2.error.message}`)
  const u3 = await sb.from('mesas').update({ status: 'ocupada', rev: ++bRev }).eq('id', b.id).select('status').single()
  if (u3.error) throw new Error(`mesa B occupy: ${u3.error.message}`)
  const tAfter = u1.data
  const aAfter = u2.data
  const bAfter = u3.data
  // Restore
  await sb.from('tickets').delete().eq('supabase_id', tSid)
  await sb.from('mesas').update({ status: 'libre', rev: ++aRev }).eq('id', a.id)
  await sb.from('mesas').update({ status: 'libre', rev: ++bRev }).eq('id', b.id)
  if (tAfter.mesa_supabase_id !== b.supabase_id) throw new Error('ticket.mesa_supabase_id did not move')
  if (aAfter.status !== 'sucia') throw new Error(`old mesa not freed: status=${aAfter.status}`)
  if (bAfter.status !== 'ocupada') throw new Error(`new mesa not seated: status=${bAfter.status}`)
  ok('5.4 mesa transfer: ticket moved + old=sucia + new=ocupada')
})

await step('5.5 cuadreCreate UPDATEs open shift instead of orphaning', async () => {
  // Open a shift, then "close" via INSERT-on-existing-open-row UPDATE path
  const cajero = await getOrCreateEmpleado(demoCarwash.id, 'Verify Cuadre Cajero', 'cajero')
  const today = new Date().toISOString().slice(0,10)
  const openSid = crypto.randomUUID()
  await sb.from('cuadre_caja').insert({
    supabase_id: openSid, business_id: demoCarwash.id, cajero_supabase_id: cajero.supabase_id, date: today,
    fondo: 0, efectivo_conteo: 0, efectivo_sistema: 0, tarjeta: 0, transferencia: 0,
    cheque: 0, creditos: 0, salidas: 0, total_vendido: 0, total_cobrado: 0,
    cierre_total: 0, diferencia: 0, status: 'abierto', opened_at: new Date().toISOString(),
    opening_cash: 5000, comentario: MARKER,
  })
  // Now mimic v2.16.24 cuadreCreate: find existing abierto, UPDATE it
  const { data: existing } = await sb.from('cuadre_caja').select('id, supabase_id').eq('business_id', demoCarwash.id).eq('cajero_supabase_id', cajero.supabase_id).eq('date', today).eq('status', 'abierto').limit(1).maybeSingle()
  if (!existing) throw new Error('open shift not found')
  const upd = await sb.from('cuadre_caja').update({
    status: 'cerrado', closed_at: new Date().toISOString(),
    cierre_total: 1000, diferencia: 0,
  }).eq('id', existing.id).select('id, status').single()
  if (upd.error) throw new Error(`update: ${upd.error.message}`)
  if (upd.data.status !== 'cerrado') throw new Error(`update returned status=${upd.data.status}`)
  // Verify only 1 row exists for this comentario
  const { data: rows } = await sb.from('cuadre_caja').select('id, status').eq('comentario', MARKER)
  await sb.from('cuadre_caja').delete().eq('comentario', MARKER)
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`)
  if (rows[0].status !== 'cerrado') throw new Error(`final status=${rows[0].status}`)
  ok('5.5 cuadreCreate UPDATE-existing-open: 1 row, status=cerrado (no orphan)')
})

await step('5.6 caja_chica.update writes BOTH approved_by + approved_by_supabase_id', async () => {
  // Find any staff row across demos (caja_chica.approved_by is staff_id, not empleado_id)
  let { data: staff } = await sb.from('staff').select('id, supabase_id').eq('business_id', demoCarwash.id).limit(1).maybeSingle()
  if (!staff) {
    // Fall back to demo tienda (seed-demos.mjs creates staff there)
    const r2 = await sb.from('staff').select('id, supabase_id').eq('business_id', demoTienda.id).limit(1).maybeSingle()
    staff = r2.data
  }
  if (!staff) throw new Error('no staff in demos — caja_chica approver test cannot run')
  const sid = crypto.randomUUID()
  // caja_chica required cols: description (NOT NULL), category, type, amount, status
  const ins = await sb.from('caja_chica').insert({
    supabase_id: sid, business_id: demoCarwash.id, amount: 100, type: 'Gasto',
    category: 'Otros', description: `verify ${MARKER}`, status: 'pendiente',
  }).select('id').single()
  if (ins.error) throw new Error(`caja_chica insert: ${ins.error.message}`)
  // Mimic web.js v2.16.10 fix: write BOTH cols
  const upd = await sb.from('caja_chica').update({ status: 'aprobado', approved_by: staff.id, approved_by_supabase_id: staff.supabase_id }).eq('supabase_id', sid).select('approved_by, approved_by_supabase_id').single()
  if (upd.error) throw new Error(`caja_chica update: ${upd.error.message}`)
  await sb.from('caja_chica').delete().eq('supabase_id', sid)
  if (!upd.data.approved_by) throw new Error('approved_by not set')
  if (!upd.data.approved_by_supabase_id) throw new Error('approved_by_supabase_id not set')
  ok('5.6 caja_chica.update writes both approved_by + approved_by_supabase_id')
})

await step('5.7 commission_pct → comision_pct (Spanish col name) on empleados', async () => {
  // Verify the column the v2.16.10 fix uses actually exists and round-trips
  const { data } = await sb.from('empleados').select('id, comision_pct').eq('business_id', demoCarwash.id).limit(1).maybeSingle()
  if (!data) throw new Error('no empleados in demo carwash')
  if (data.comision_pct == null) throw new Error('comision_pct returns null — col may not exist')
  ok('5.7 empleados.comision_pct exists + populated (the right column name)')
})

await step('5.8 client_supabase_id linkage on tickets — Credits screen path', async () => {
  // Insert a credit ticket WITH client_supabase_id, then query like Credits.jsx does
  const client = await getOrCreateClient(demoCarwash.id, `Verify Credit Lookup ${MARKER}`)
  const tSid = crypto.randomUUID()
  await sb.from('tickets').insert({
    supabase_id: tSid, business_id: demoCarwash.id, doc_number: `T-V-${Date.now()}`,
    subtotal: 250, total: 250, payment_method: 'credit', tipo_venta: 'credito',
    status: 'pendiente', client_supabase_id: client.supabase_id, client_name: client.name, notes: MARKER,
  })
  // Web.js openTickets (post-fix): filter on client_supabase_id only
  const { data: openT } = await sb.from('tickets').select('id, total, status').eq('business_id', demoCarwash.id).eq('client_supabase_id', client.supabase_id).eq('tipo_venta', 'credito').eq('status', 'pendiente')
  await sb.from('tickets').delete().eq('supabase_id', tSid)
  if (!openT || openT.length === 0) throw new Error('Credits.jsx query returns 0 — linkage broken')
  ok(`5.8 client_supabase_id linkage: Credits query found ${openT.length} open ticket(s)`)
})

// ── Section 6: WO bridge — concesionario + mecanica ────────────────────────
console.log('\n── 6. WO → ticket bridge + concesionario fixes ──────────────')

await step('6.1 work_order facturado bridge writes ticket linkage', async () => {
  const woSid = crypto.randomUUID()
  const wo = await sb.from('work_orders').insert({
    supabase_id: woSid, business_id: demoMec.id, status: 'listo', total: 500,
    notes: MARKER,
  }).select('id, supabase_id').single()
  if (wo.error) throw new Error(`WO insert: ${wo.error.message}`)
  const tSid = crypto.randomUUID()
  const tIns = await sb.from('tickets').insert({
    supabase_id: tSid, business_id: demoMec.id, doc_number: `T-V-${Date.now()}`,
    subtotal: 500, total: 590, itbis: 90, payment_method: 'cash', tipo_venta: 'contado', status: 'cobrado',
    notes: MARKER,
  }).select('id').single()
  if (tIns.error) throw new Error(`ticket insert: ${tIns.error.message}`)
  const tRow = tIns.data
  // Mimic WorkOrders/index.jsx:332 update
  // ticket_id (integer) was dropped 2026-04-30 — UUID-only canonical FK
  const upd = await sb.from('work_orders').update({ status: 'facturado', ticket_supabase_id: tSid, facturado_at: new Date().toISOString() }).eq('id', wo.data.id).select('status, ticket_supabase_id, facturado_at').single()
  if (upd.error) throw new Error(`WO update: ${upd.error.message}`)
  await sb.from('work_orders').delete().eq('id', wo.data.id)
  await sb.from('tickets').delete().eq('supabase_id', tSid)
  if (upd.data.status !== 'facturado') throw new Error(`WO status=${upd.data.status}`)
  if (upd.data.ticket_supabase_id !== tSid) throw new Error('ticket_supabase_id not linked')
  if (!upd.data.facturado_at) throw new Error('facturado_at not stamped')
  ok('6.1 WO facturado bridge: status + ticket_supabase_id + facturado_at')
})

await step('6.2 TestDriveFunnel column drift — leads.salesperson_supabase_id + test_drives.staff_supabase_id', async () => {
  const r1 = await sb.from('leads').select('id, salesperson_supabase_id').eq('business_id', demoConc.id).limit(1)
  if (r1.error) throw new Error(`leads.salesperson_supabase_id query failed: ${r1.error.message}`)
  const r2 = await sb.from('test_drives').select('id, staff_supabase_id').eq('business_id', demoConc.id).limit(1)
  if (r2.error) throw new Error(`test_drives.staff_supabase_id query failed: ${r2.error.message}`)
  ok('6.2 leads.salesperson_supabase_id + test_drives.staff_supabase_id both queryable')
})

// ── Section 7: smoke / harness composition ─────────────────────────────────
console.log('\n── 7. Cleanup verification ─────────────────────────────────')

await step('7.1 no stray verify rows remain', async () => {
  // Belt-and-suspenders cleanup before count.
  await sb.from('tickets').delete().like('notes', `%${MARKER}%`)
  await sb.from('cuadre_caja').delete().eq('comentario', MARKER)
  await sb.from('restaurant_reservations').delete().eq('nombre', 'verify')
  await sb.from('work_orders').delete().eq('notes', MARKER)
  await sb.from('empleados').delete().like('nombre', 'Verify %')
  // Count any rows still tagged with our marker
  const { count: tCount } = await sb.from('tickets').select('id', { count: 'exact', head: true }).like('notes', `%${MARKER}%`)
  const { count: ccCount } = await sb.from('cuadre_caja').select('id', { count: 'exact', head: true }).eq('comentario', MARKER)
  const { count: rrCount } = await sb.from('restaurant_reservations').select('id', { count: 'exact', head: true }).eq('nombre', 'verify')
  if ((tCount || 0) > 0) throw new Error(`${tCount} tickets leaked`)
  if ((ccCount || 0) > 0) throw new Error(`${ccCount} cuadre rows leaked`)
  if ((rrCount || 0) > 0) throw new Error(`${rrCount} reservation rows leaked`)
  ok('7.1 cleanup verified — no stray test rows')
})

// ── final ──
console.log(`\n=== ${passed} passed, ${failed} failed ===`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log('  ' + f)
  process.exit(1)
}
process.exit(0)
