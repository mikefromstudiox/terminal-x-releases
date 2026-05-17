/**
 * Generic demo E2E smoke — exercises any of the 9 demo verticals end-to-end:
 *   carwash | tienda | restaurante | salon | hibrido | mecanica | servicios | prestamos | concesionario
 *
 * Common track (every vertical):
 *   - Auth, business resolution, app_settings.business_type
 *   - services list (active=1) + allAdmin (incl. inactive)
 *   - reorder persistence (the v2.16.x sort_order fix)
 *   - soft-delete fallback + hard-delete
 *   - empleados, tickets, cuadre, ncf, license, activity_log
 *
 * Vertical-specific track (only when feature is core to the vertical):
 *   - carwash:        vehicle_plate + washer_empleado_supabase_ids
 *   - tienda:         inventory_items rows
 *   - restaurante:    mesas + modificadores
 *   - salon:          stylist_schedules
 *   - mecanica:       work_orders + vehicles
 *   - concesionario:  vehicle_inventory + sales_deals
 *   - servicios:      service_projects (no cuadre check)
 *   - prestamos:      loans (no cuadre check)
 *   - hibrido:        inventory + tickets carry both products & services
 *
 * Usage:
 *   node scripts/demo-e2e-smoke.mjs carwash
 *   node scripts/demo-e2e-smoke.mjs tienda
 *   npm run e2e:demo -- carwash
 *   npm run e2e:demo:all   # runs every vertical sequentially
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

// 2026-05-17 — VERTICAL keys cleaned to canonical English (matches
// BUSINESS_TYPES in packages/config/businessTypes.js). Legacy Spanish
// CLI aliases still accepted via CLI_ALIASES below so old commands work.
const VERTICALS = {
  carwash:    { email: 'admin@carwash.demo.terminalxpos.com',    label: 'Carwash',           bizType: 'carwash' },
  retail:     { email: 'admin@retail.demo.terminalxpos.com',     label: 'Tienda / Retail',   bizType: 'retail' },
  restaurant: { email: 'admin@restaurant.demo.terminalxpos.com', label: 'Restaurante',       bizType: 'restaurant' },
  salon:      { email: 'admin@salon.demo.terminalxpos.com',      label: 'Salón / Barbería',  bizType: 'salon' },
  hybrid:     { email: 'admin@hybrid.demo.terminalxpos.com',     label: 'Híbrido',           bizType: 'hybrid' },
  mechanic:   { email: 'admin@mechanic.demo.terminalxpos.com',   label: 'Mecánica',          bizType: 'mechanic' },
  service:    { email: 'admin@service.demo.terminalxpos.com',    label: 'Servicios',         bizType: 'service' },
  prestamos:  { email: 'admin@prestamos.demo.terminalxpos.com',  label: 'Préstamos',         bizType: 'prestamos' },
  dealership: { email: 'admin@dealership.demo.terminalxpos.com', label: 'Concesionario',     bizType: 'dealership' },
  carniceria: { email: 'admin@carniceria.demo.terminalxpos.com', label: 'Carnicería',        bizType: 'carniceria' },
}
const CLI_ALIASES = {
  tienda: 'retail', restaurante: 'restaurant', hibrido: 'hybrid',
  mecanica: 'mechanic', servicios: 'service', concesionario: 'dealership', barberia: 'salon',
}
const PASS = 'Demo2026!'

// Verticals where cuadre_caja is NOT part of the model (per memory:demo_accounts).
const SKIP_CUADRE = new Set(['prestamos', 'dealership', 'service'])

const URL  = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !ANON || !SVC) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const rawArg = (process.argv[2] || '').toLowerCase()
const arg = CLI_ALIASES[rawArg] || rawArg
if (!arg || !VERTICALS[arg]) {
  console.log('\nUsage: node scripts/demo-e2e-smoke.mjs <vertical>')
  console.log('Verticals:', Object.keys(VERTICALS).join(', '))
  console.log('(Legacy Spanish aliases also accepted:', Object.keys(CLI_ALIASES).join(', ') + ')')
  process.exit(1)
}
const VERTICAL = arg
const { email: EMAIL, label: LABEL } = VERTICALS[VERTICAL]

const anon = createClient(URL, ANON, { auth: { persistSession: false } })
const svc  = createClient(URL, SVC,  { auth: { persistSession: false } })
const uid  = () => crypto.randomUUID()

let pass = 0, fail = 0
const results = []
function log(step, ok, detail = '') {
  const sym = ok ? '✅' : '❌'
  console.log(`${sym} ${step}${detail ? ' — ' + detail : ''}`)
  results.push({ step, ok, detail })
  ok ? pass++ : fail++
}

async function run() {
  console.log(`\n=== ${LABEL.toUpperCase()} DEMO E2E SMOKE (${VERTICAL}) ===\n`)

  // 1. Auth
  const { data: auth, error: authErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASS })
  log('auth: demo sign-in', !authErr && !!auth?.session, authErr?.message || EMAIL)
  if (!auth?.session) { console.log('\nBLOCKER — cannot proceed without session'); process.exit(1) }

  // 2. Resolve business_id
  let BID = auth.user?.user_metadata?.business_id
  log('business: resolve business_id', !!BID, BID)
  if (!BID) process.exit(1)

  // 3. Business type assertion — Spanish CLI alias → canonical key from VERTICALS map.
  const expectedBT = VERTICALS[VERTICAL]?.bizType || VERTICAL
  const { data: bizRow } = await svc.from('businesses').select('*').eq('id', BID).single()
  const bizName = bizRow?.name || bizRow?.business_name || bizRow?.razon_social || '(unnamed)'
  const { data: btKV } = await svc.from('app_settings').select('value')
    .eq('business_id', BID).eq('key', 'business_type').maybeSingle()
  log(`app_settings.business_type=${expectedBT}`, btKV?.value === expectedBT, `name="${bizName}" kv="${btKV?.value}"`)

  // 4. services.all (active=1 — POS view)
  const { data: activeSvcs, error: e4 } = await anon.from('services').select('*')
    .eq('business_id', BID).eq('active', true).order('category').order('sort_order').order('id')
  log('services.all (active=1)', !e4 && Array.isArray(activeSvcs), `${activeSvcs?.length ?? 0} active services`)

  // 5. services.allAdmin
  const { data: allSvcs } = await anon.from('services').select('*').eq('business_id', BID)
  const inactiveCount = (allSvcs || []).filter(s => !s.active).length
  log('services.allAdmin', Array.isArray(allSvcs) && allSvcs.length >= (activeSvcs?.length ?? 0),
    `${allSvcs?.length} total / ${inactiveCount} inactive`)

  // 6. Reorder persistence
  const byCat = {}
  for (const s of (activeSvcs || [])) (byCat[s.category] ||= []).push(s)
  const reorderCat = Object.keys(byCat).find(c => byCat[c].length >= 2)
  if (reorderCat) {
    const orig = byCat[reorderCat]
    const reversed = [...orig].reverse()
    const original = orig.map(s => ({ id: s.id, sort_order: s.sort_order }))
    const wrote = await Promise.all(reversed.map((s, i) =>
      svc.from('services').update({ sort_order: i + 1, updated_at: new Date().toISOString() })
        .eq('id', s.id).eq('business_id', BID)
        .then(({ error }) => ({ id: s.id, ok: !error, err: error?.message }))
    ))
    const writeFails = wrote.filter(w => !w.ok)
    log('reorder: writes succeeded', writeFails.length === 0, writeFails.length ? JSON.stringify(writeFails) : `${wrote.length} rows`)
    const { data: afterSvcs } = await anon.from('services').select('id, sort_order').in('id', reversed.map(r => r.id))
    const afterMap = new Map((afterSvcs || []).map(r => [r.id, r.sort_order]))
    const orderHolds = reversed.every((s, i) => Number(afterMap.get(s.id)) === i + 1)
    log('reorder: persists after re-read', orderHolds, orderHolds ? 'sort_order matches reversed sequence' : 'mismatch')
    await Promise.all(original.map(o =>
      svc.from('services').update({ sort_order: o.sort_order, updated_at: new Date().toISOString() })
        .eq('id', o.id).eq('business_id', BID)
    ))
  } else {
    log('reorder: no category with ≥2 svcs', true, 'skipped')
  }

  // 7. Soft-delete (FK fallback)
  const { data: tiSample } = await svc.from('ticket_items').select('service_supabase_id').limit(50)
  const referencedSvcIds = new Set((tiSample || []).map(t => t.service_supabase_id).filter(Boolean))
  const refSvc = (activeSvcs || []).find(s => referencedSvcIds.has(s.supabase_id))
  if (refSvc) {
    await svc.from('services').update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', refSvc.id).eq('business_id', BID)
    const { data: check } = await anon.from('services').select('active').eq('id', refSvc.id).single()
    log('soft-delete: active=0', check?.active === false, `svc#${refSvc.id} ${refSvc.name}`)
    const { data: posView } = await anon.from('services').select('id')
      .eq('business_id', BID).eq('active', true).eq('id', refSvc.id)
    log('soft-delete: hidden from active POS query', (posView || []).length === 0)
    const { data: adminView } = await anon.from('services').select('id, active').eq('id', refSvc.id)
    log('soft-delete: visible to allAdmin query', (adminView || []).length === 1 && adminView[0].active === false)
    await svc.from('services').update({ active: true, updated_at: new Date().toISOString() })
      .eq('id', refSvc.id).eq('business_id', BID)
  } else {
    log('soft-delete: FK scenario', true, 'skipped — no svc with ticket_items refs')
  }

  // 8. Hard-delete
  const tmpSid = uid()
  const { data: tmpInsert, error: e8 } = await svc.from('services').insert({
    supabase_id: tmpSid, business_id: BID, name: 'TEMP-E2E-DELETE-' + Date.now().toString(36),
    category: '_e2e', price: 1, active: true, sort_order: 9999, is_wash: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select().single()
  log('hard-delete: insert temp svc', !e8 && !!tmpInsert, e8?.message)
  if (tmpInsert) {
    const { error: delErr } = await svc.from('services').delete().eq('id', tmpInsert.id).eq('business_id', BID)
    log('hard-delete: delete succeeds', !delErr, delErr?.message)
    const { data: gone } = await anon.from('services').select('id').eq('id', tmpInsert.id)
    log('hard-delete: row truly gone', (gone || []).length === 0)
  }

  // 9. Empleados
  const { data: empleados } = await svc.from('empleados').select('id, nombre, tipo, active')
    .eq('business_id', BID).eq('active', true)
  log('empleados: ≥1 active', (empleados || []).length >= 1, `${empleados?.length ?? 0} active employees`)

  // 10. Tickets
  const { data: tickets } = await svc.from('tickets')
    .select('id, total, vehicle_plate, washer_empleado_supabase_ids, seller_empleado_supabase_id, status, created_at, mode')
    .eq('business_id', BID).order('created_at', { ascending: false }).limit(20)
  log('tickets: recent history', (tickets || []).length >= 1, `${tickets?.length ?? 0} recent`)

  // 11. Cuadre (skip for verticals without a cash-drawer model)
  if (SKIP_CUADRE.has(VERTICAL)) {
    log('cuadre_caja: not applicable to this vertical', true, 'skipped')
  } else {
    const { data: cuadre } = await svc.from('cuadre_caja').select('id').eq('business_id', BID).limit(5)
    log('cuadre_caja: rows present', (cuadre || []).length >= 1, `${cuadre?.length ?? 0} rows`)
  }

  // 12. NCF
  const { data: ncf } = await svc.from('ncf_sequences').select('type, current_number, limit_number, active')
    .eq('business_id', BID)
  log('ncf_sequences: configured', (ncf || []).length >= 1, `types=${(ncf || []).map(n => n.type).join(',')}`)

  // 13. License
  const licRes = await svc.from('licenses').select('plan_id, status, expires_at, license_key')
    .eq('business_id', BID).limit(1).maybeSingle()
  const license = licRes?.data
  log('license: active', license?.status === 'active', `key=${license?.license_key} status=${license?.status}`)

  // 14. Activity log write
  const { error: actErr } = await svc.from('activity_log').insert({
    supabase_id: uid(), business_id: BID, event_type: 'e2e_smoke',
    severity: 'info', target_type: 'system', target_name: `${VERTICAL}-smoke`,
    metadata: { source: 'demo-e2e-smoke.mjs', vertical: VERTICAL, when: new Date().toISOString() },
    created_at: new Date().toISOString(),
  })
  log('activity_log: insert', !actErr, actErr?.message)

  // ── Vertical-specific assertions
  console.log(`\n--- ${LABEL}-specific assertions ---`)
  if (VERTICAL === 'carwash') {
    const withPlate = (tickets || []).filter(t => t.vehicle_plate && String(t.vehicle_plate).trim()).length
    log('tickets carry vehicle_plate', withPlate >= 1, `${withPlate}/${tickets?.length ?? 0}`)
    const withWasher = (tickets || []).filter(t => Array.isArray(t.washer_empleado_supabase_ids) && t.washer_empleado_supabase_ids.length).length
    log('tickets carry washer assignment', withWasher >= 1, `${withWasher}/${tickets?.length ?? 0}`)
    const washers = (empleados || []).filter(e => ['lavador', 'hybrid'].includes(e.tipo))
    log('washers: ≥1 active lavador', washers.length >= 1, `${washers.length} washers`)
  } else if (VERTICAL === 'retail') {
    const { data: inv } = await svc.from('inventory_items').select('id, name, quantity').eq('business_id', BID).eq('active', true).limit(5)
    log('inventory_items: ≥1 row', (inv || []).length >= 1, `${inv?.length ?? 0} products`)
  } else if (VERTICAL === 'restaurant') {
    const { data: mesas } = await svc.from('mesas').select('id, name, status').eq('business_id', BID).eq('active', true)
    log('mesas: ≥1 active', (mesas || []).length >= 1, `${mesas?.length ?? 0} mesas`)
    const { data: mods } = await svc.from('modificadores').select('id').eq('business_id', BID).eq('active', true).limit(1)
    log('modificadores: queryable', Array.isArray(mods), `${mods?.length ?? 0}`)
  } else if (VERTICAL === 'salon') {
    const { data: sched } = await svc.from('stylist_schedules').select('id').eq('business_id', BID).limit(1)
    log('stylist_schedules: queryable', Array.isArray(sched), `${sched?.length ?? 0}`)
  } else if (VERTICAL === 'mechanic') {
    const { data: wo } = await svc.from('work_orders').select('id, status').eq('business_id', BID).limit(5)
    log('work_orders: ≥0 rows', Array.isArray(wo), `${wo?.length ?? 0}`)
    const { data: veh } = await svc.from('vehicles').select('id, plate').eq('business_id', BID).limit(5)
    log('vehicles: ≥0 rows', Array.isArray(veh), `${veh?.length ?? 0}`)
  } else if (VERTICAL === 'dealership') {
    const { data: vinv } = await svc.from('vehicle_inventory').select('id, vin, status').eq('business_id', BID).limit(5)
    log('vehicle_inventory: ≥0 rows', Array.isArray(vinv), `${vinv?.length ?? 0}`)
    const { data: deals } = await svc.from('sales_deals').select('id').eq('business_id', BID).limit(5)
    log('sales_deals: queryable', Array.isArray(deals), `${deals?.length ?? 0}`)
  } else if (VERTICAL === 'prestamos') {
    // ── v2.16.2 prestamos hardening — schema + CRUD round-trip + storage ─────
    // 1. loans table baseline + new columns (amortization_method, renewal_count)
    const { data: loans, error: lErr } = await svc.from('loans')
      .select('id, status, amortization_method, renewal_count').eq('business_id', BID).limit(5)
    log('loans: queryable', !lErr && Array.isArray(loans), lErr?.message || `${loans?.length ?? 0}`)
    log('loans.amortization_method column present',
        !lErr && (loans || []).every(r => 'amortization_method' in r), 'schema check')
    log('loans.renewal_count column present',
        !lErr && (loans || []).every(r => 'renewal_count' in r), 'schema check')

    // 2. pawn_items new columns (default_alert_days, valoracion_notes, offered_pct, signature_dataurl)
    const { data: pawns, error: pErr } = await svc.from('pawn_items')
      .select('id, default_alert_days, valoracion_notes, offered_pct, signature_dataurl')
      .eq('business_id', BID).limit(5)
    log('pawn_items: queryable', !pErr && Array.isArray(pawns), pErr?.message || `${pawns?.length ?? 0}`)
    for (const col of ['default_alert_days','valoracion_notes','offered_pct','signature_dataurl']) {
      log(`pawn_items.${col} column present`,
          !pErr && (pawns || []).every(r => col in r), 'schema check')
    }

    // 3. Round-trip a temp loan + dependent rows in 5 new tables
    const loanSid = uid()
    const { error: loanInsErr } = await svc.from('loans').insert({
      supabase_id: loanSid, business_id: BID, principal: 10000, term_months: 6,
      interest_rate: 5, monthly_payment: 1900, status: 'active',
      amortization_method: 'interest_only', renewal_count: 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    log('loans: insert temp loan', !loanInsErr, loanInsErr?.message)

    if (!loanInsErr) {
      // 4. loan_contracts round-trip
      const lcSid = uid()
      const { error: lcInsErr } = await svc.from('loan_contracts').insert({
        supabase_id: lcSid, business_id: BID, loan_supabase_id: loanSid,
        pdf_url: 'test://contract.pdf', signature_dataurl: 'data:image/png;base64,iVBORw0KGgo',
        dpi_photo_url: 'test://dpi.jpg', signed_at: new Date().toISOString(),
        apr_monthly: 0.05, apr_annual_equiv: 0.7959, clauses_version: 'v1-2026-04',
      })
      log('loan_contracts: insert', !lcInsErr, lcInsErr?.message)
      if (!lcInsErr) {
        const { data: lcRead } = await svc.from('loan_contracts')
          .select('apr_annual_equiv, clauses_version').eq('supabase_id', lcSid).maybeSingle()
        log('loan_contracts: read-back', lcRead?.clauses_version === 'v1-2026-04',
            `apr_annual=${lcRead?.apr_annual_equiv}`)
        await svc.from('loan_contracts').delete().eq('supabase_id', lcSid)
      }

      // 5. loan_renewals round-trip
      const lrSid = uid()
      const { error: lrInsErr } = await svc.from('loan_renewals').insert({
        supabase_id: lrSid, business_id: BID, loan_supabase_id: loanSid,
        renewal_count: 1, interest_paid: 500, new_due_date: '2026-06-25',
        previous_due_date: '2026-05-25', notes: 'e2e-renewal',
      })
      log('loan_renewals: insert', !lrInsErr, lrInsErr?.message)
      if (!lrInsErr) {
        const { data: lrRead } = await svc.from('loan_renewals')
          .select('renewal_count, interest_paid').eq('supabase_id', lrSid).maybeSingle()
        log('loan_renewals: read-back', lrRead?.renewal_count === 1,
            `paid=${lrRead?.interest_paid}`)
        await svc.from('loan_renewals').delete().eq('supabase_id', lrSid)
      }

      // 6. collections_attempts round-trip + outcome enum check
      const caSid = uid()
      const { error: caInsErr } = await svc.from('collections_attempts').insert({
        supabase_id: caSid, business_id: BID, loan_supabase_id: loanSid,
        outcome: 'promised', notes: 'e2e-promised', whatsapp_sent: true,
        next_followup_at: new Date(Date.now() + 86400000).toISOString(),
      })
      log('collections_attempts: insert', !caInsErr, caInsErr?.message)
      if (!caInsErr) {
        const { data: caRead } = await svc.from('collections_attempts')
          .select('outcome, whatsapp_sent').eq('supabase_id', caSid).maybeSingle()
        log('collections_attempts: read-back', caRead?.outcome === 'promised' && caRead?.whatsapp_sent === true,
            `outcome=${caRead?.outcome}`)
        await svc.from('collections_attempts').delete().eq('supabase_id', caSid)
      }
      // 6b. outcome CHECK constraint rejects garbage
      const { error: caBadErr } = await svc.from('collections_attempts').insert({
        supabase_id: uid(), business_id: BID, loan_supabase_id: loanSid, outcome: 'BOGUS',
      })
      log('collections_attempts: rejects bad outcome', !!caBadErr, caBadErr?.message?.slice(0, 60))

      // 7. pawn_items + pawn_documents + pawn_listings cascade
      const pawnSid = uid()
      const { error: pawnInsErr } = await svc.from('pawn_items').insert({
        supabase_id: pawnSid, business_id: BID, description: 'E2E-PRENDA', estimated_value: 5000,
        offered_pct: 60, default_alert_days: 3, valoracion_notes: 'e2e',
        status: 'held',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      log('pawn_items: insert temp', !pawnInsErr, pawnInsErr?.message)

      if (!pawnInsErr) {
        const pdSid = uid()
        const { error: pdInsErr } = await svc.from('pawn_documents').insert({
          supabase_id: pdSid, business_id: BID, pawn_supabase_id: pawnSid,
          doc_type: 'foto', file_url: 'test://pawn-photos/foo.jpg', mime_type: 'image/jpeg',
        })
        log('pawn_documents: insert', !pdInsErr, pdInsErr?.message)
        if (!pdInsErr) await svc.from('pawn_documents').delete().eq('supabase_id', pdSid)

        // bad doc_type rejected
        const { error: pdBadErr } = await svc.from('pawn_documents').insert({
          supabase_id: uid(), business_id: BID, pawn_supabase_id: pawnSid,
          doc_type: 'invalid_type', file_url: 'x',
        })
        log('pawn_documents: rejects bad doc_type', !!pdBadErr, pdBadErr?.message?.slice(0, 60))

        const plSid = uid()
        const slug = 'e2e-' + pawnSid.slice(0, 8)
        const { error: plInsErr } = await svc.from('pawn_listings').insert({
          supabase_id: plSid, business_id: BID, pawn_supabase_id: pawnSid,
          list_price: 6000, slug, status: 'published',
          published_at: new Date().toISOString(),
        })
        log('pawn_listings: insert', !plInsErr, plInsErr?.message)
        if (!plInsErr) {
          const { data: plRead } = await svc.from('pawn_listings')
            .select('slug, status, list_price').eq('supabase_id', plSid).maybeSingle()
          log('pawn_listings: read-back published', plRead?.status === 'published',
              `slug=${plRead?.slug} price=${plRead?.list_price}`)
          // unique slug per business
          const { error: plDupeErr } = await svc.from('pawn_listings').insert({
            supabase_id: uid(), business_id: BID, pawn_supabase_id: pawnSid,
            list_price: 1, slug, status: 'draft',
          })
          log('pawn_listings: unique(slug,business) enforced', !!plDupeErr, plDupeErr?.message?.slice(0, 80))
          await svc.from('pawn_listings').delete().eq('supabase_id', plSid)
        }

        await svc.from('pawn_items').delete().eq('supabase_id', pawnSid)
      }

      await svc.from('loans').delete().eq('supabase_id', loanSid)
    }

    // 8. Storage buckets exist
    const expectedBuckets = ['pawn-photos','pawn-documents','loan-documents']
    for (const b of expectedBuckets) {
      const { data: bucketList, error: bErr } = await svc.storage.listBuckets()
      const exists = !bErr && (bucketList || []).some(x => x.id === b || x.name === b)
      log(`storage bucket: ${b} exists`, exists, bErr?.message)
      // only need one listBuckets call but keeping per-bucket assertions readable
      if (bErr) break
    }

    // 9. Storage round-trip on private loan-documents bucket
    const testPath = `e2e-smoke/${BID}/test-${Date.now()}.txt`
    const blob = new Blob(['e2e-test'], { type: 'text/plain' })
    const { error: upErr } = await svc.storage.from('loan-documents').upload(testPath, blob, { upsert: true })
    log('loan-documents: upload', !upErr, upErr?.message)
    if (!upErr) {
      const { data: signed, error: sErr } = await svc.storage.from('loan-documents')
        .createSignedUrl(testPath, 60)
      log('loan-documents: signed URL (private)', !sErr && !!signed?.signedUrl, sErr?.message)
      await svc.storage.from('loan-documents').remove([testPath])
    }

    // 10. Storage public bucket round-trip on pawn-photos
    const photoPath = `e2e-smoke/${BID}/photo-${Date.now()}.txt`
    const { error: phUpErr } = await svc.storage.from('pawn-photos').upload(photoPath, blob, { upsert: true })
    log('pawn-photos: upload', !phUpErr, phUpErr?.message)
    if (!phUpErr) {
      const { data: pubUrl } = svc.storage.from('pawn-photos').getPublicUrl(photoPath)
      log('pawn-photos: public URL', !!pubUrl?.publicUrl, pubUrl?.publicUrl?.slice(0, 60))
      await svc.storage.from('pawn-photos').remove([photoPath])
    }
  } else if (VERTICAL === 'service') {
    // ── Servicios vertical — service_projects schema + CRUD round-trip ──
    const { data: proj, error: projErr } = await svc.from('service_projects').select('id').eq('business_id', BID).limit(5)
    log('service_projects: queryable', !projErr && Array.isArray(proj), projErr?.message || `${proj?.length ?? 0}`)

    // Round-trip a temp project
    const spSid = uid()
    const { error: spIns } = await svc.from('service_projects').insert({
      supabase_id: spSid, business_id: BID,
      project_name: 'E2E-PROJECT-' + Date.now().toString(36),
      billing_type: 'project', fixed_price: 5000, status: 'active',
    })
    log('service_projects: insert', !spIns, spIns?.message)
    if (!spIns) {
      const { data: spRead } = await svc.from('service_projects').select('billing_type, status').eq('supabase_id', spSid).maybeSingle()
      log('service_projects: read-back', spRead?.billing_type === 'project' && spRead?.status === 'active', `billing=${spRead?.billing_type}`)
      // CHECK constraint rejects bogus billing_type
      const { error: badErr } = await svc.from('service_projects').insert({
        supabase_id: uid(), business_id: BID, project_name: 'bad', billing_type: 'NOT_A_TYPE',
      })
      log('service_projects: rejects bad billing_type', !!badErr, badErr?.message?.slice(0,60))
      await svc.from('service_projects').delete().eq('supabase_id', spSid)
    }
  } else if (VERTICAL === 'hybrid') {
    const { data: inv } = await svc.from('inventory_items').select('id').eq('business_id', BID).eq('active', true).limit(1)
    log('inventory_items present (hybrid)', (inv || []).length >= 1, `${inv?.length ?? 0}`)
    log('services present (hybrid)', (activeSvcs || []).length >= 1, `${activeSvcs?.length ?? 0}`)
  } else if (VERTICAL === 'carniceria') {
    // ── v2.16.3 carnicería hardening — schema + CRUD round-trip ──────────
    // 1. inventory_items must carry sold_by_weight, prepacked, expires_at, received_at
    const { data: inv } = await svc.from('inventory_items')
      .select('id, name, sold_by_weight, prepacked, expires_at, received_at, price_per_unit, unit')
      .eq('business_id', BID).eq('active', true).limit(20)
    log('inventory_items: ≥1 row', (inv || []).length >= 1, `${inv?.length ?? 0} products`)
    log('inventory_items.prepacked column present',
        Array.isArray(inv) && inv.every(r => 'prepacked' in r),
        'schema check')
    log('inventory_items.expires_at column present',
        Array.isArray(inv) && inv.every(r => 'expires_at' in r),
        'schema check')
    const byWeight = (inv || []).filter(r => r.sold_by_weight && r.unit && r.price_per_unit > 0)
    log('inventory_items: ≥1 sold-by-weight row', byWeight.length >= 1,
        `${byWeight.length} weight-priced (lb/kg)`)

    // 2. Cortes catalog (carniceria_corte_categories)
    const { data: cortes, error: cErr } = await svc.from('carniceria_corte_categories')
      .select('id, supabase_id, nombre, especie, active').eq('business_id', BID).limit(50)
    log('carniceria_corte_categories: queryable', !cErr && Array.isArray(cortes),
        cErr?.message || `${cortes?.length ?? 0} cortes`)

    // 3. Round-trip a temp corte (insert → read → delete)
    const corteSid = uid()
    const { error: cInsErr } = await svc.from('carniceria_corte_categories').insert({
      supabase_id: corteSid, business_id: BID,
      nombre: 'E2E-CORTE-' + Date.now().toString(36), especie: 'pollo',
      sort_order: 9999, active: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    log('cortes: insert', !cInsErr, cInsErr?.message)
    if (!cInsErr) {
      const { data: cRead } = await svc.from('carniceria_corte_categories')
        .select('especie').eq('supabase_id', corteSid).maybeSingle()
      log('cortes: read-back', cRead?.especie === 'pollo', `especie=${cRead?.especie}`)
      await svc.from('carniceria_corte_categories').delete().eq('supabase_id', corteSid)
    }

    // 4. Freshness batches table
    const { data: fresh, error: fErr } = await svc.from('inventory_freshness_log')
      .select('id, expires_at, qty_remaining, auto_discount_applied').eq('business_id', BID).limit(10)
    log('inventory_freshness_log: queryable', !fErr && Array.isArray(fresh),
        fErr?.message || `${fresh?.length ?? 0} batches`)

    // 5. Discards table
    const { data: disc, error: dErr } = await svc.from('inventory_discards')
      .select('id, motivo, qty').eq('business_id', BID).limit(10)
    log('inventory_discards: queryable', !dErr && Array.isArray(disc),
        dErr?.message || `${disc?.length ?? 0} discards`)

    // 6. Recurring orders (mayoreo)
    const { data: rec, error: rErr } = await svc.from('recurring_orders')
      .select('id, dia_semana, items_json, whatsapp_confirmar').eq('business_id', BID).limit(10)
    log('recurring_orders: queryable', !rErr && Array.isArray(rec),
        rErr?.message || `${rec?.length ?? 0} mayoreo orders`)

    // 7. Multi-scale registry
    const { data: scales, error: sErr } = await svc.from('carniceria_scales')
      .select('id, nombre, tipo, protocol, active_default').eq('business_id', BID).limit(10)
    log('carniceria_scales: queryable', !sErr && Array.isArray(scales),
        sErr?.message || `${scales?.length ?? 0} scales`)

    // 8. Generic promotions (DR seasonal seed lives here)
    const { data: promos, error: pErr } = await svc.from('promotions')
      .select('id, name, tipo, season_key, active').eq('business_id', BID).limit(20)
    log('promotions: queryable', !pErr && Array.isArray(promos),
        pErr?.message || `${promos?.length ?? 0} promos`)

    // 9. ticket_items.preparation_notes column round-trip (schema check via select)
    const { data: tiCol, error: tiErr } = await svc.from('ticket_items')
      .select('id, preparation_notes').limit(1)
    log('ticket_items.preparation_notes column present', !tiErr && Array.isArray(tiCol),
        tiErr?.message || 'schema OK')

    // 10. e-CF E31 readiness — RNC clients + E31 sequence
    const { data: rncClients } = await svc.from('clients')
      .select('id, name, rnc').eq('business_id', BID).not('rnc', 'is', null).limit(5)
    log('clients: ≥1 with RNC (auto-E31 source)', (rncClients || []).length >= 1,
        `${rncClients?.length ?? 0} RNC-bearing clients`)
    const { data: ncfE31 } = await svc.from('ncf_sequences')
      .select('type, current_number').eq('business_id', BID).eq('type', 'E31').maybeSingle()
    log('ncf_sequences.E31 configured', !!ncfE31,
        ncfE31 ? `next=${ncfE31.current_number}` : 'no E31 sequence yet')
  }

  // 15. Sign-out
  const { error: outErr } = await anon.auth.signOut()
  log('auth: sign-out', !outErr, outErr?.message)

  console.log(`\n=== ${LABEL.toUpperCase()} RESULTS: ${pass} pass / ${fail} fail / ${pass + fail} total ===`)
  if (fail > 0) {
    console.log('\nFailed steps:')
    results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.step}${r.detail ? ' — ' + r.detail : ''}`))
    process.exit(1)
  }
  process.exit(0)
}

run().catch(e => { console.error('FATAL:', e); process.exit(1) })
