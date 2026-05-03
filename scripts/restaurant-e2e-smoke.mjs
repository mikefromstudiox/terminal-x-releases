/**
 * Restaurant E2E smoke test against live Supabase.
 *
 * Exercises each action a restaurant client (Crokao) does in the POS, using the
 * actual deployed schema (verified via docs/SCHEMA-SNAPSHOT.md).
 *
 * Cleans up tagged rows on success.
 *
 * Usage: node scripts/restaurant-e2e-smoke.mjs
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'

const env = fs.readFileSync('.env', 'utf8')
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1].trim()
const URL = get('SUPABASE_URL') || get('VITE_SUPABASE_URL')
const SVC = get('SUPABASE_SERVICE_ROLE_KEY')

const BID = '8ca2af1e-a0d4-4f97-b8f9-d9e481ca40f8' // Crokao
const TAG = '__e2e_'

const svc = createClient(URL, SVC, { auth: { persistSession: false } })
const uid = () => crypto.randomUUID()

let pass = 0, fail = 0
const failures = []
function log(step, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ' — ' + detail : ''}`)
  if (ok) pass++
  else { fail++; failures.push(`${step}: ${detail}`) }
}

async function cleanup() {
  // Order matters: deepest FK first.
  await svc.from('service_recipe_items').delete().eq('business_id', BID).like('service_supabase_id', `${TAG}%`).then(() => {})
  // service_recipe_items has no easy tag — clean by service we created (matched by supabase_id pattern)
  await svc.from('ticket_items').delete().eq('business_id', BID).like('name', `${TAG}%`)
  await svc.from('tickets').delete().eq('business_id', BID).like('notes', `${TAG}%`)
  await svc.from('mesas').delete().eq('business_id', BID).like('name', `${TAG}%`)
  await svc.from('services').delete().eq('business_id', BID).like('name', `${TAG}%`)
  await svc.from('categorias_servicio').delete().eq('business_id', BID).like('nombre', `${TAG}%`)
  await svc.from('empleados').delete().eq('business_id', BID).like('nombre', `${TAG}%`)
  await svc.from('restaurant_reservations').delete().eq('business_id', BID).like('nombre', `${TAG}%`)
  await svc.from('app_settings').delete().eq('business_id', BID).like('key', `${TAG}%`)
  await svc.from('inventory_items').delete().eq('business_id', BID).like('name', `${TAG}%`)
}

async function run() {
  console.log('\n=== RESTAURANT E2E SMOKE (Crokao) ===\n')

  await cleanup()

  // ── 1. categorias_servicio.create ────────────────────────────────────────────
  const catSid = uid()
  const catRes = await svc.from('categorias_servicio').insert({
    supabase_id: catSid, business_id: BID, active: true,
    nombre: '__e2e_Entradas', orden: 1,
  }).select('id, nombre').single()
  log('categorias_servicio.create', !catRes.error && catRes.data?.nombre === '__e2e_Entradas', catRes.error?.message)

  // ── 2. services.create (menu item) ───────────────────────────────────────────
  const svcSid = uid()
  const svcRes = await svc.from('services').insert({
    supabase_id: svcSid, business_id: BID, active: true,
    name: '__e2e_Empanada Pollo', category: '__e2e_Entradas',
    price: 150, cost: 50, aplica_itbis: 1, is_wash: 0,
    no_commission: false, commission_washer: true, commission_seller: true, commission_cashier: true,
    is_menu_item: true, course: 'entradas',
    sort_order: 1,
  }).select('id, supabase_id, name, course, is_menu_item').single()
  log('services.create (menu item)', !svcRes.error && svcRes.data?.is_menu_item === true && svcRes.data?.course === 'entradas', svcRes.error?.message)
  const svcId = svcRes.data?.id

  // ── 3. services.list (RestaurantPOS reads with .eq('active', true)) ──────────
  const svcList = await svc.from('services').select('id, name, course, is_menu_item').eq('business_id', BID).eq('active', true)
  log('services.list (active)', !svcList.error && (svcList.data?.length ?? 0) >= 1, svcList.error?.message || `${svcList.data?.length} rows`)
  const menuItems = (svcList.data || []).filter(s => s.is_menu_item)
  log('  → at least one menu item visible', menuItems.length >= 1, `${menuItems.length} menu items`)

  // ── 4. mesas.create ──────────────────────────────────────────────────────────
  const mesaSid = uid()
  const mesaRes = await svc.from('mesas').insert({
    supabase_id: mesaSid, business_id: BID, active: true,
    name: '__e2e_Mesa-1', sort_order: 1, status: 'libre', capacity: 4,
  }).select('id, name, status').single()
  log('mesas.create', !mesaRes.error && mesaRes.data?.status === 'libre', mesaRes.error?.message)
  const mesaId = mesaRes.data?.id

  // ── 5. mesas.setStatus → ocupada (status changes require rev++ per trigger) ──
  const seatRes = await svc.from('mesas').update({
    status: 'ocupada', guests_count: 4, seated_at: new Date().toISOString(),
    rev: 1,
    updated_at: new Date().toISOString(),
  }).eq('id', mesaId).select('status, guests_count, seated_at, rev').single()
  log('mesas.setStatus (libre→ocupada + guests_count + seated_at + rev++)',
    !seatRes.error && seatRes.data?.status === 'ocupada' && seatRes.data?.guests_count === 4 && seatRes.data?.rev === 1,
    seatRes.error?.message)

  // ── 6. mesas_with_active_total VIEW (RestaurantPOS reads this) ───────────────
  const viewRes = await svc.from('mesas_with_active_total').select('id, name, status, active_ticket_total').eq('business_id', BID)
  log('mesas_with_active_total VIEW exists', !viewRes.error,
    viewRes.error?.message || `${viewRes.data?.length} rows`)

  // ── 7. tickets.openForMesa (open ticket for seated mesa) ─────────────────────
  const ticketSid = uid()
  const ticketRes = await svc.from('tickets').insert({
    supabase_id: ticketSid, business_id: BID,
    mesa_supabase_id: mesaSid,
    status: 'abierto', total: 0, subtotal: 0, itbis: 0,
    notes: `${TAG}smoke`,
  }).select('id, supabase_id, status').single()
  log('tickets.openForMesa', !ticketRes.error && ticketRes.data?.status === 'abierto', ticketRes.error?.message)
  const ticketId = ticketRes.data?.id

  // ── 8. ticket_items.insert (add menu item with course tag) ───────────────────
  const itemSid = uid()
  const itemRes = await svc.from('ticket_items').insert({
    supabase_id: itemSid, business_id: BID,
    ticket_id: ticketId, ticket_supabase_id: ticketSid,
    service_id: svcId, service_supabase_id: svcSid,
    name: `${TAG}Empanada Pollo`, price: 150, quantity: 2, itbis: 54,
    course: 'entradas', is_wash: false, cost: 50,
  }).select('id, course, kds_fired_at').single()
  log('ticket_items.insert (with course tag)',
    !itemRes.error && itemRes.data?.course === 'entradas' && !itemRes.data?.kds_fired_at,
    itemRes.error?.message)
  const itemId = itemRes.data?.id

  // ── 9. KDS fire (kds_fired_at is text on this table) ─────────────────────────
  if (itemId) {
    const fireRes = await svc.from('ticket_items').update({
      kds_fired_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', itemId).select('kds_fired_at').single()
    log('kds.fire (ticket_items.kds_fired_at stamped)', !fireRes.error && !!fireRes.data?.kds_fired_at, fireRes.error?.message)
  }

  // ── 10. mesas.requestBill (status → acuenta, rev++) ─────────────────────────
  if (mesaId) {
    const billRes = await svc.from('mesas').update({
      status: 'acuenta', bill_requested_at: new Date().toISOString(),
      rev: 2,
      updated_at: new Date().toISOString(),
    }).eq('id', mesaId).select('status, bill_requested_at, rev').single()
    log('mesas.requestBill (ocupada→acuenta + rev++)',
      !billRes.error && billRes.data?.status === 'acuenta' && !!billRes.data?.bill_requested_at && billRes.data?.rev === 2,
      billRes.error?.message)
  }

  // ── 11. cobrar: ticket → cobrado (status change needs rev++) ─────────────────
  if (ticketId) {
    const closeTicketRes = await svc.from('tickets').update({
      status: 'cobrado', total: 354, subtotal: 300, itbis: 54,
      payment_method: 'efectivo',
      paid_at: new Date().toISOString(),
      rev: 1,
      updated_at: new Date().toISOString(),
    }).eq('id', ticketId).select('status, total, payment_method, rev').single()
    log('tickets.cobrar (status→cobrado, payment_method, totals + rev++)',
      !closeTicketRes.error && closeTicketRes.data?.status === 'cobrado' && closeTicketRes.data?.payment_method === 'efectivo',
      closeTicketRes.error?.message)
  }

  // ── 12. mesas.setStatus (acuenta→libre after pago, rev++) ────────────────────
  if (mesaId) {
    const freeRes = await svc.from('mesas').update({
      status: 'libre', guests_count: 0, seated_at: null,
      bill_requested_at: null, waiter_empleado_supabase_id: null,
      rev: 3,
      updated_at: new Date().toISOString(),
    }).eq('id', mesaId).select('status, rev').single()
    log('mesas.setStatus (acuenta→libre after cobro + rev++)',
      !freeRes.error && freeRes.data?.status === 'libre' && freeRes.data?.rev === 3,
      freeRes.error?.message)
  }

  // ── 13. empleados.create (waiter = tipo='vendedor') ──────────────────────────
  const empSid = uid()
  const empRes = await svc.from('empleados').insert({
    supabase_id: empSid, business_id: BID, active: true,
    nombre: `${TAG}Mesero Test`, tipo: 'vendedor', role: 'cashier',
    cedula: '00000000001', start_date: new Date().toISOString().slice(0, 10),
  }).select('id, nombre, tipo').single()
  log('empleados.create (mesero)', !empRes.error && empRes.data?.tipo === 'vendedor', empRes.error?.message)

  // ── 14. restaurant_reservations.create (Spanish columns: nombre/telefono/fecha/hora) ─
  const tomorrow = new Date(Date.now() + 86400000)
  const fecha = tomorrow.toISOString().slice(0, 10)
  const resSid = uid()
  const resRes = await svc.from('restaurant_reservations').insert({
    supabase_id: resSid, business_id: BID,
    nombre: `${TAG}Familia Garcia`,
    guests: 4,
    fecha, hora: '19:30:00',
    status: 'pendiente',
    telefono: '+18095550000',
  }).select('id, status, guests').single()
  log('restaurant_reservations.create', !resRes.error && resRes.data?.status === 'pendiente' && resRes.data?.guests === 4, resRes.error?.message)
  const resId = resRes.data?.id

  // ── 15. restaurant_reservations.confirm (status flip: pendiente → confirmada) ─
  if (resId) {
    const confRes = await svc.from('restaurant_reservations').update({
      status: 'confirmada', updated_at: new Date().toISOString(),
    }).eq('id', resId).select('status').single()
    log('restaurant_reservations.confirm', !confRes.error && confRes.data?.status === 'confirmada', confRes.error?.message)
  }

  // ── 16. app_settings business-scoped write ───────────────────────────────────
  const settingsKey = `${TAG}test_pref`
  const settingsRes = await svc.from('app_settings').upsert({
    business_id: BID,
    key: settingsKey,
    value: 'on',
    device_hwid: null,
    is_device_local: false,
    supabase_id: uid(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id,key,device_hwid' }).select('key, value, is_device_local').single()
  log('app_settings.upsert (business setting cloud-synced)',
    !settingsRes.error && settingsRes.data?.value === 'on' && settingsRes.data?.is_device_local === false,
    settingsRes.error?.message)

  // ── 17. settings.get filter — what useBusinessType reads ─────────────────────
  const readSettingsRes = await svc.from('app_settings').select('key, value').eq('business_id', BID).eq('is_device_local', false)
  const hasBizType = (readSettingsRes.data || []).some(r => r.key === 'business_type' && r.value === 'restaurant')
  log('app_settings.list (is_device_local=false includes business_type=restaurant)',
    !readSettingsRes.error && hasBizType,
    hasBizType ? '' : 'business_type row missing or has wrong is_device_local')

  // ── 18. inventory_items.create (recipe ingredient) ───────────────────────────
  const invSid = uid()
  const invRes = await svc.from('inventory_items').insert({
    supabase_id: invSid, business_id: BID, active: true,
    name: `${TAG}Carne Molida`, unit: 'lb', quantity: 100, cost: 80, price: 0, category: '',
  }).select('id, supabase_id').single()
  log('inventory_items.create (recipe ingredient)', !invRes.error, invRes.error?.message)

  // ── 19. service_recipe_items.create (BOM) ────────────────────────────────────
  if (invRes.data && svcSid) {
    const recRes = await svc.from('service_recipe_items').insert({
      supabase_id: uid(), business_id: BID,
      service_supabase_id: svcSid,
      inventory_item_supabase_id: invRes.data.supabase_id,
      qty_per_unit: 0.25,
    }).select('id, qty_per_unit').single()
    log('service_recipe_items.create (BOM 0.25 lb per empanada)',
      !recRes.error && recRes.data?.qty_per_unit === 0.25,
      recRes.error?.message)
  }

  // ── 20. RLS — anon can't read Crokao data without a JWT ──────────────────────
  const anonKey = get('SUPABASE_ANON_KEY') || get('VITE_SUPABASE_ANON_KEY')
  if (anonKey) {
    const anon = createClient(URL, anonKey, { auth: { persistSession: false } })
    const anonRes = await anon.from('mesas').select('id').eq('business_id', BID).limit(1)
    const denied = (anonRes.data?.length ?? 0) === 0
    log('RLS: anon cannot read Crokao mesas (no JWT)', denied,
      denied ? '0 rows returned (correctly denied)' : `LEAK: ${anonRes.data?.length} rows visible to anon`)
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  console.log('\n--- Cleanup ---')
  await cleanup()

  console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`)
  if (fail > 0) {
    console.log('\nFailures:')
    failures.forEach(f => console.log('  - ' + f))
    process.exit(1)
  }
}

run().catch(e => {
  console.error('FATAL:', e)
  process.exit(2)
})
