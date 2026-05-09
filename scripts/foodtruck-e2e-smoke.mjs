/**
 * Food Truck E2E smoke test against live Supabase.
 *
 * Exercises the food_truck Phase 1 surface end-to-end against the deployed
 * schema (verified via docs/SCHEMA-SNAPSHOT.md after the
 * 2026_05_08_food_truck.sql migration lands).
 *
 * We piggyback on the Crokao restaurant test tenant for schema-level checks —
 * the new tables (food_truck_locations, waste_log) and ALTERs (cuadre_caja,
 * tickets) are additive, so flipping business_type isn't required to validate
 * the data layer.
 *
 * Cleans up tagged rows on success.
 *
 * Usage: node scripts/foodtruck-e2e-smoke.mjs
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'

const env = fs.readFileSync('.env', 'utf8')
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1].trim()
const URL = get('SUPABASE_URL') || get('VITE_SUPABASE_URL')
const SVC = get('SUPABASE_SERVICE_ROLE_KEY')

// 2026-05-08 — moved off Crokao (real client) to Demo Food Truck seed tenant
// so production data isn't churned by every smoke run.
const BID = 'edbc8447-b574-43f9-9584-1d66f4ad2bcd' // Demo Food Truck (is_demo=true)
const TAG = '__ftruck_'

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
  await svc.from('waste_log').delete().eq('business_id', BID).like('reason', `${TAG}%`)
  await svc.from('food_truck_locations').delete().eq('business_id', BID).like('name', `${TAG}%`)
  // 2026-05-09 — open-then-pay tickets land with notes like "TAG..." or
  // "📞 ... · TAG..." — wipe by the doc_number prefix to be safe.
  await svc.from('ticket_items').delete().eq('business_id', BID).like('name', `${TAG}%`)
  await svc.from('tickets').delete().eq('business_id', BID).like('notes', `${TAG}%`)
  await svc.from('tickets').delete().eq('business_id', BID).ilike('notes', `%${TAG}%`)
  await svc.from('cuadre_caja').delete().eq('business_id', BID).like('comentario', `${TAG}%`)
  await svc.from('inventory_items').delete().eq('business_id', BID).like('name', `${TAG}%`)
}

async function run() {
  console.log('\n=== FOOD TRUCK E2E SMOKE (Crokao tenant) ===\n')

  await cleanup()

  // ── 1. food_truck_locations.create ──────────────────────────────────────
  const locSid = uid()
  const locRes = await svc.from('food_truck_locations').insert({
    supabase_id: locSid, business_id: BID,
    name: `${TAG}Parque Mirador`,
    lat: 18.4500, lng: -69.9500,
    notes: 'parqueo gratis los sábados',
    active: true,
  }).select('id, supabase_id, name, active').single()
  log('food_truck_locations.create', !locRes.error && locRes.data?.active === true, locRes.error?.message)
  const locId = locRes.data?.id

  // ── 2. food_truck_locations.list (RLS-aware service role read) ──────────
  const locList = await svc.from('food_truck_locations').select('id, name').eq('business_id', BID).eq('active', true)
  log('food_truck_locations.list (active)',
    !locList.error && (locList.data?.length ?? 0) >= 1, locList.error?.message || `${locList.data?.length} rows`)

  // ── 3. food_truck_locations.update ──────────────────────────────────────
  if (locId) {
    const upd = await svc.from('food_truck_locations').update({
      notes: 'actualizado',
      updated_at: new Date().toISOString(),
    }).eq('id', locId).select('notes').single()
    log('food_truck_locations.update', !upd.error && upd.data?.notes === 'actualizado', upd.error?.message)
  }

  // ── 4. cuadre_caja with truck shift breadcrumbs ──────────────────────────
  const cuadreSid = uid()
  const cuadreRes = await svc.from('cuadre_caja').insert({
    supabase_id: cuadreSid, business_id: BID,
    date: new Date().toISOString().slice(0, 10),
    fondo: 1000, efectivo_conteo: 1000, efectivo_sistema: 0,
    tarjeta: 0, transferencia: 0, cheque: 0, creditos: 0, salidas: 0,
    total_vendido: 0, total_cobrado: 0, cierre_total: 1000, diferencia: 0,
    comentario: `${TAG}shift open`,
    status: 'abierto',
    opened_at: new Date().toISOString(),
    opening_cash: 1000,
    start_location_supabase_id: locSid,
    start_lat: 18.4500, start_lng: -69.9500,
    start_notes: 'inicio sábado',
  }).select('id, supabase_id, start_location_supabase_id, start_lat, opening_cash').single()
  log('cuadre_caja.create (with truck shift breadcrumbs)',
    !cuadreRes.error
      && cuadreRes.data?.start_location_supabase_id === locSid
      && Number(cuadreRes.data?.start_lat) === 18.45,
    cuadreRes.error?.message)

  // ── 5. inventory_items + waste_log roundtrip ────────────────────────────
  const invSid = uid()
  const invRes = await svc.from('inventory_items').insert({
    supabase_id: invSid, business_id: BID, active: true,
    name: `${TAG}Pan Hot Dog`, unit: 'ud', quantity: 50, cost: 12, price: 0, category: '',
  }).select('id, supabase_id').single()
  log('inventory_items.create (waste target)', !invRes.error, invRes.error?.message)

  const wasteSid = uid()
  const wasteRes = await svc.from('waste_log').insert({
    supabase_id: wasteSid, business_id: BID,
    inventory_item_supabase_id: invRes.data?.supabase_id || null,
    qty: 6,
    unit: 'ud',
    reason: `${TAG}spoiled`,
    occurred_at: new Date().toISOString(),
    cuadre_supabase_id: cuadreSid,
    created_by: 'smoke',
  }).select('id, qty, reason, cuadre_supabase_id').single()
  log('waste_log.create',
    !wasteRes.error
      && Number(wasteRes.data?.qty) === 6
      && wasteRes.data?.cuadre_supabase_id === cuadreSid,
    wasteRes.error?.message)

  // ── 6. waste_log.list filtered by date ──────────────────────────────────
  const today = new Date(); today.setHours(0,0,0,0)
  const wasteList = await svc.from('waste_log').select('id, qty, reason')
    .eq('business_id', BID)
    .gte('occurred_at', today.toISOString())
    .order('occurred_at', { ascending: false })
  log('waste_log.list (today range)', !wasteList.error && (wasteList.data?.length ?? 0) >= 1,
    wasteList.error?.message || `${wasteList.data?.length} rows`)

  // ── 7. tickets carries food_truck_location_supabase_id ──────────────────
  const ticketSid = uid()
  const ticketRes = await svc.from('tickets').insert({
    supabase_id: ticketSid, business_id: BID,
    status: 'cobrado', total: 350, subtotal: 297, itbis: 53,
    payment_method: 'efectivo',
    fulfillment_type: 'take_out',
    food_truck_location_supabase_id: locSid,
    notes: `${TAG}take-out`,
    paid_at: new Date().toISOString(),
  }).select('id, food_truck_location_supabase_id, fulfillment_type').single()
  log('tickets.create (take_out + food_truck_location_supabase_id)',
    !ticketRes.error
      && ticketRes.data?.food_truck_location_supabase_id === locSid
      && ticketRes.data?.fulfillment_type === 'take_out',
    ticketRes.error?.message)

  // ── 8. tickets read-back with location join (PostgREST embed) ───────────
  const joinRes = await svc.from('tickets')
    .select('id, food_truck_location_supabase_id, food_truck_locations!tickets_food_truck_location_supabase_id_fkey(name)')
    .eq('business_id', BID)
    .eq('id', ticketRes.data?.id || '00000000-0000-0000-0000-000000000000')
    .maybeSingle()
  // Embed may not work without an explicit FK — fall back to a manual two-step.
  if (joinRes.error || !joinRes.data) {
    const t = await svc.from('tickets').select('food_truck_location_supabase_id').eq('id', ticketRes.data?.id).single()
    const l = t.data?.food_truck_location_supabase_id
      ? await svc.from('food_truck_locations').select('name').eq('supabase_id', t.data.food_truck_location_supabase_id).single()
      : { data: null }
    log('tickets→food_truck_locations resolution (manual two-step)',
      !!l.data?.name && l.data.name.startsWith(TAG),
      l.data?.name || 'no resolution')
  } else {
    log('tickets→food_truck_locations join (PostgREST embed)', !!joinRes.data?.food_truck_locations?.name)
  }

  // ── 8b. open-then-pay lifecycle (2026-05-09) ─────────────────────────────
  // Simulates: cashier rings 2 chimis → Send to Kitchen → ticket lands in
  // Pendientes with status='pendiente' open_status='open' order_source set
  // → Cobrar later closes via the cobrar/closeWithPayment path → row flips
  // to status='cobrado' open_status='closed' with totals stamped.
  // Uses service-role direct INSERTs to mimic what api.tickets.openForFulfillment
  // would do; the client-side handler is exercised manually on Demo Food Truck.
  const openTicketSid = uid()
  const phoneNotes = `${TAG}📞 Test Customer · 8095551234 · ETA 15min`
  const openTicket = await svc.from('tickets').insert({
    supabase_id: openTicketSid, business_id: BID,
    doc_number: `${TAG.slice(0,3)}T-${Math.floor(Math.random() * 9000 + 1000)}`,
    fulfillment_type: 'take_out', mode: 'take_out',
    subtotal: 0, descuento: 0, itbis: 0, ley: 0, total: 0,
    payment_method: 'pending', status: 'pendiente', open_status: 'open',
    tipo_venta: 'contado', order_source: 'pedidos_ya',
    notes: phoneNotes,
  }).select('id, supabase_id, doc_number, status, open_status, order_source').single()
  log('open-then-pay: ticket opened with order_source=pedidos_ya',
    !openTicket.error
      && openTicket.data?.status === 'pendiente'
      && openTicket.data?.open_status === 'open'
      && openTicket.data?.order_source === 'pedidos_ya',
    openTicket.error?.message || `${openTicket.data?.doc_number}`)

  // Add 2 ticket_items to the open ticket (mimics addItem loop).
  const itemA = await svc.from('ticket_items').insert({
    supabase_id: uid(), ticket_supabase_id: openTicketSid, business_id: BID,
    name: `${TAG}Chimi clásico`, price: 220, cost: 90, itbis: 0,
    is_wash: false, quantity: 1, course: 'principal',
  })
  const itemB = await svc.from('ticket_items').insert({
    supabase_id: uid(), ticket_supabase_id: openTicketSid, business_id: BID,
    name: `${TAG}Refresco lata`, price: 60, cost: 25, itbis: 0,
    is_wash: false, quantity: 2, course: 'bebida',
  })
  log('open-then-pay: 2 ticket_items added', !itemA.error && !itemB.error,
    [itemA.error?.message, itemB.error?.message].filter(Boolean).join(' / '))

  // Pendientes listOpen — query directly (mirror of api.tickets.listOpen).
  const openList = await svc.from('tickets')
    .select('id, supabase_id, doc_number, order_source, open_status')
    .eq('business_id', BID).eq('open_status', 'open').neq('status', 'nula')
  const seenInOpen = (openList.data || []).some(t => t.supabase_id === openTicketSid)
  log('open-then-pay: ticket appears in listOpen', seenInOpen,
    `${(openList.data || []).length} open tickets total`)

  // Now flip to cobrado (mimic closeWithPayment). Per the project's rev-guard
  // trigger, ticket status updates must strictly advance `rev`. Read current
  // rev first, then UPDATE with rev+1.
  const cur = await svc.from('tickets').select('rev').eq('supabase_id', openTicketSid).single()
  const close = await svc.from('tickets').update({
    status: 'cobrado', open_status: 'closed',
    subtotal: 340, total: 340, payment_method: 'efectivo',
    rev: (Number(cur.data?.rev) || 0) + 1,
  }).eq('supabase_id', openTicketSid)
    .select('status, open_status, total, order_source').single()
  log('open-then-pay: closeWithPayment flips status + open_status',
    !close.error
      && close.data?.status === 'cobrado'
      && close.data?.open_status === 'closed'
      && Number(close.data?.total) === 340
      && close.data?.order_source === 'pedidos_ya',  // source preserved through close
    close.error?.message || `total=${close.data?.total}, source=${close.data?.order_source}`)

  // After close, ticket should NOT appear in listOpen anymore.
  const openListAfter = await svc.from('tickets')
    .select('supabase_id').eq('business_id', BID).eq('open_status', 'open')
    .eq('supabase_id', openTicketSid)
  log('open-then-pay: ticket no longer in listOpen after close',
    (openListAfter.data || []).length === 0,
    `${(openListAfter.data || []).length} rows`)

  // ── 8c. open-then-pay reverse: open → void (status=nula) ────────────────
  // Customer doesn't show up; cashier voids without paying. Should also
  // disappear from listOpen.
  const voidTicketSid = uid()
  await svc.from('tickets').insert({
    supabase_id: voidTicketSid, business_id: BID,
    doc_number: `${TAG.slice(0,3)}V-${Math.floor(Math.random() * 9000 + 1000)}`,
    fulfillment_type: 'take_out', mode: 'take_out',
    subtotal: 0, total: 0, payment_method: 'pending',
    status: 'pendiente', open_status: 'open',
    tipo_venta: 'contado', order_source: 'telefono',
    notes: `${TAG}reverse void`,
  })
  // rev-guard advance for void too.
  const voidCur = await svc.from('tickets').select('rev').eq('supabase_id', voidTicketSid).single()
  await svc.from('tickets').update({
    status: 'nula', void_reason: 'cliente no llegó',
    rev: (Number(voidCur.data?.rev) || 0) + 1,
  }).eq('supabase_id', voidTicketSid)
  const voidedInOpen = await svc.from('tickets')
    .select('supabase_id').eq('business_id', BID).eq('open_status', 'open')
    .eq('supabase_id', voidTicketSid)
  // open_status stays 'open' but listOpen filters status<>'nula' so it
  // won't surface — confirm via the filtered query.
  const filteredVoid = await svc.from('tickets')
    .select('supabase_id').eq('business_id', BID).eq('open_status', 'open')
    .neq('status', 'nula').eq('supabase_id', voidTicketSid)
  log('open-then-pay (reverse): voided ticket excluded from listOpen',
    (filteredVoid.data || []).length === 0,
    `${(filteredVoid.data || []).length} rows in filtered listOpen`)

  // ── 9. RLS — anon can't read Crokao food_truck_locations without a JWT ──
  const anonKey = get('SUPABASE_ANON_KEY') || get('VITE_SUPABASE_ANON_KEY')
  if (anonKey) {
    const anon = createClient(URL, anonKey, { auth: { persistSession: false } })
    const anonLoc = await anon.from('food_truck_locations').select('id').eq('business_id', BID).limit(1)
    const deniedLoc = (anonLoc.data?.length ?? 0) === 0
    log('RLS: anon cannot read food_truck_locations (no JWT)', deniedLoc,
      deniedLoc ? '0 rows returned (correctly denied)' : `LEAK: ${anonLoc.data?.length} rows visible`)

    const anonWaste = await anon.from('waste_log').select('id').eq('business_id', BID).limit(1)
    const deniedWaste = (anonWaste.data?.length ?? 0) === 0
    log('RLS: anon cannot read waste_log (no JWT)', deniedWaste,
      deniedWaste ? '0 rows returned (correctly denied)' : `LEAK: ${anonWaste.data?.length} rows visible`)
  }

  // ── 10. cleanup ─────────────────────────────────────────────────────────
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
