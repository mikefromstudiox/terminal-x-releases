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
  // Detach any test tickets that pointed at our cleaned location, then delete them.
  await svc.from('tickets').delete().eq('business_id', BID).like('notes', `${TAG}%`)
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
