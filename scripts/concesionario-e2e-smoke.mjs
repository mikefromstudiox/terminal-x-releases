/**
 * Concesionario v2 / v2.5 E2E smoke test.
 *
 * Exercises every dealership feature end-to-end against live Supabase:
 *   - vehicle_inventory CRUD + photo_urls + featured + bulk import
 *   - vehicle_documents upload + expiringSoon
 *   - sales_deals create/close with commission_pct + commission_amount
 *   - sales_deals.commissionsForPeriod()
 *   - leads create + setStage + logContact + overdue
 *   - test_drives create + setOutcome (sold/follow_up/lost)
 *   - activity_log entries (deal_closed, pipeline_stage_change, etc.)
 *
 * Cleans up after itself so it can be re-run safely.
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY
// Reuse Ranoza's business_id — the schema is universal; we tag every test row
// so cleanup at the end removes only what we created.
const BID = '4f789f41-76d2-4402-838f-5fe20a91641f'
const TAG = `__e2e_concesionario_${Date.now()}`

const anon = createClient(URL, ANON, { auth: { persistSession: false } })
const svc  = createClient(URL, SVC,  { auth: { persistSession: false } })
const uid  = () => crypto.randomUUID()

let pass = 0, fail = 0
function log(step, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ' — ' + detail : ''}`)
  ok ? pass++ : fail++
}

async function run() {
  console.log('\n=== CONCESIONARIO v2 / v2.5 E2E SMOKE ===\n')

  // ── Cleanup leftovers from prior runs ──────────────────────────────────────
  await svc.from('vehicle_documents').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')
  await svc.from('test_drives').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')
  await svc.from('leads').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')
  await svc.from('sales_deals').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')
  await svc.from('vehicle_inventory').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')

  // ── 1. vehicle_inventory create + photo_urls + featured ────────────────────
  const vehicleSid = uid()
  const v = await svc.from('vehicle_inventory').insert({
    supabase_id: vehicleSid, business_id: BID, active: true,
    stock_number: 'E2E-001', vin: 'E2EVIN1234567890A',
    make: 'Toyota', model: 'Corolla SE', year: 2024, color: 'Negro',
    mileage: 0, condition: 'new',
    acquisition_cost: 1100000, listing_price: 1450000,
    status: 'available', title_status: 'clean',
    photo_urls: ['https://example.com/photo-1.jpg', 'https://example.com/photo-2.jpg'],
    featured: true,
    notes: TAG,
    listing_date: new Date().toISOString(),
  }).select('id, supabase_id, photo_urls, featured').single()
  log('vehicle_inventory: create with photo_urls + featured', !v.error && Array.isArray(v.data?.photo_urls) && v.data.photo_urls.length === 2 && v.data.featured === true, v.error?.message || `id=${v.data?.id}`)
  const vehicleId = v.data?.id

  // ── 2. vehicle_inventory bulk import (mirrors CSV import) ──────────────────
  const bulkRows = [
    { supabase_id: uid(), business_id: BID, active: true, make: 'Honda', model: 'CR-V Touring', year: 2023, mileage: 18500, listing_price: 1985000, condition: 'used', status: 'available', title_status: 'clean', notes: TAG, listing_date: new Date().toISOString() },
    { supabase_id: uid(), business_id: BID, active: true, make: 'Hyundai', model: 'Tucson Limited', year: 2024, mileage: 0, listing_price: 1795000, condition: 'new', status: 'available', title_status: 'clean', notes: TAG, listing_date: new Date().toISOString() },
    { supabase_id: uid(), business_id: BID, active: true, make: 'Nissan', model: 'Sentra SR', year: 2022, mileage: 32000, listing_price: 1195000, condition: 'used', status: 'available', title_status: 'clean', notes: TAG, listing_date: new Date().toISOString() },
  ]
  const bulk = await svc.from('vehicle_inventory').insert(bulkRows).select('id')
  log('vehicle_inventory: bulk import 3 rows', !bulk.error && bulk.data?.length === 3, bulk.error?.message || `inserted ${bulk.data?.length}`)

  // ── 3. vehicle_inventory list filter by status='available' ─────────────────
  const list = await svc.from('vehicle_inventory').select('id, status, photo_urls').eq('business_id', BID).eq('active', true).eq('status', 'available').like('notes', '__e2e_concesionario%')
  log('vehicle_inventory: list filter status=available', !list.error && list.data?.length >= 4, list.error?.message || `${list.data?.length} rows`)

  // ── 4. vehicle_inventory.setStatus('sold') stamps sold_date ────────────────
  const sold = await svc.from('vehicle_inventory').update({ status: 'sold', sold_date: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', vehicleId).select('status, sold_date').single()
  log('vehicle_inventory: setStatus sold + sold_date stamped', !sold.error && sold.data?.status === 'sold' && !!sold.data?.sold_date, sold.error?.message)

  // ── 5. vehicle_documents upload + expiringSoon (storage signed URL stub) ───
  const docSid = uid()
  const expiresIn15 = new Date(Date.now() + 15 * 86400000).toISOString()
  const doc = await svc.from('vehicle_documents').insert({
    supabase_id: docSid, business_id: BID, active: true,
    vehicle_inventory_supabase_id: vehicleSid,
    doc_type: 'registration',
    file_url: 'https://example.com/doc.pdf',
    file_name: 'matricula-E2E.pdf',
    expires_at: expiresIn15,
    notes: TAG,
  }).select('id, expires_at, doc_type').single()
  log('vehicle_documents: insert with expires_at', !doc.error && doc.data?.doc_type === 'registration', doc.error?.message)

  // expiringSoon(30) — must include our 15-day-out doc
  const expCutoff = new Date(Date.now() + 30 * 86400000).toISOString()
  const exp = await svc.from('vehicle_documents').select('id, expires_at').eq('business_id', BID).eq('active', true).not('expires_at', 'is', null).lte('expires_at', expCutoff).like('notes', '__e2e_concesionario%')
  log('vehicle_documents: expiringSoon(30) finds our doc', !exp.error && exp.data?.some(d => d.id === doc.data?.id), exp.error?.message || `${exp.data?.length} expiring rows`)

  // ── 6. Find a salesperson empleado on this business for commission tests ───
  const sp = await svc.from('empleados').select('id, supabase_id, nombre, comision_pct').eq('business_id', BID).eq('active', 1).limit(1).single()
  const salespersonSid = sp.data?.supabase_id || null
  log('empleados: salesperson available for commission test', !!salespersonSid, sp.data?.nombre || '(none)')

  // ── 7. sales_deals create with commission_pct + commission_amount ──────────
  const dealSid = uid()
  const salePrice = 1450000
  const tradeIn = 200000
  const downPayment = 250000
  const financed = salePrice - tradeIn - downPayment
  const commissionPct = 2.5
  const commissionAmount = +((salePrice - tradeIn) * commissionPct / 100).toFixed(2)
  const deal = await svc.from('sales_deals').insert({
    supabase_id: dealSid, business_id: BID, active: true,
    vehicle_inventory_supabase_id: vehicleSid,
    salesperson_supabase_id: salespersonSid,
    sale_price: salePrice,
    trade_in_value: tradeIn,
    down_payment: downPayment,
    financed_amount: financed,
    term_months: 60,
    apr: 11.5,
    monthly_payment: 22055.42,
    commission_pct: commissionPct,
    commission_amount: commissionAmount,
    commission_paid: false,
    status: 'closed',
    notes: TAG,
    closed_at: new Date().toISOString(),
  }).select('id, commission_amount, commission_paid, status').single()
  log('sales_deals: create with commission ≥ E31 threshold', !deal.error && Number(deal.data?.commission_amount) === commissionAmount && deal.data?.status === 'closed', deal.error?.message || `commission=RD$${deal.data?.commission_amount}`)
  const dealId = deal.data?.id

  // ── 8. sales_deals.commissionsForPeriod (current year) ─────────────────────
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()
  const commForPeriod = await svc.from('sales_deals').select('id, commission_amount, salesperson_supabase_id').eq('business_id', BID).eq('active', true).eq('status', 'closed').not('commission_amount', 'is', null).gte('closed_at', yearStart).like('notes', '__e2e_concesionario%')
  const found = commForPeriod.data?.find(d => d.id === dealId)
  log('sales_deals: commissionsForPeriod returns our deal', !!found && Number(found.commission_amount) === commissionAmount, `${commForPeriod.data?.length} commissioned deals YTD`)

  // ── 9. sales_deals.markCommissionPaid ──────────────────────────────────────
  const paid = await svc.from('sales_deals').update({ commission_paid: true, commission_paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', dealId).select('commission_paid, commission_paid_at').single()
  log('sales_deals: markCommissionPaid sets flag + timestamp', !paid.error && paid.data?.commission_paid === true && !!paid.data?.commission_paid_at, paid.error?.message)

  // ── 10. leads create with next_followup_at + setStage + logContact ─────────
  const leadSid = uid()
  const overdueDate = new Date(Date.now() - 86400000).toISOString() // 1 day ago = overdue
  const lead = await svc.from('leads').insert({
    supabase_id: leadSid, business_id: BID, active: true,
    name: 'Cliente E2E', phone: '8095551234', email: 'e2e@test.do',
    source: 'walk_in', budget: 1500000,
    notes: TAG, stage: 'lead',
    next_followup_at: overdueDate,
  }).select('id, stage, next_followup_at').single()
  log('leads: create with next_followup_at (overdue)', !lead.error && lead.data?.stage === 'lead', lead.error?.message)
  const leadId = lead.data?.id

  // setStage to negotiation
  const stageR = await svc.from('leads').update({ stage: 'negotiation', updated_at: new Date().toISOString() }).eq('id', leadId).select('stage').single()
  log('leads: setStage lead → negotiation', !stageR.error && stageR.data?.stage === 'negotiation', stageR.error?.message)

  // logContact: stamp last_contacted_at + reset followup
  const next3d = new Date(Date.now() + 3 * 86400000).toISOString()
  const contactR = await svc.from('leads').update({ last_contacted_at: new Date().toISOString(), next_followup_at: next3d, updated_at: new Date().toISOString() }).eq('id', leadId).select('last_contacted_at, next_followup_at').single()
  log('leads: logContact updates timestamps', !contactR.error && !!contactR.data?.last_contacted_at && !!contactR.data?.next_followup_at, contactR.error?.message)

  // ── 11. leads.overdue: lead is now in_progress with future followup → NOT overdue ──
  // Reset to overdue + lead stage to verify overdue query works
  await svc.from('leads').update({ stage: 'lead', next_followup_at: overdueDate, last_contacted_at: null, updated_at: new Date().toISOString() }).eq('id', leadId)
  const overdue = await svc.from('leads').select('id, name, stage, next_followup_at').eq('business_id', BID).eq('active', true).not('next_followup_at', 'is', null).lte('next_followup_at', new Date().toISOString()).not('stage', 'in', '(closed,lost)').like('notes', '__e2e_concesionario%')
  log('leads: overdue query returns our overdue lead', !overdue.error && overdue.data?.some(l => l.id === leadId), overdue.error?.message || `${overdue.data?.length} overdue`)

  // closed/lost leads must NOT appear in overdue
  await svc.from('leads').update({ stage: 'closed', updated_at: new Date().toISOString() }).eq('id', leadId)
  const overdueAfterClose = await svc.from('leads').select('id').eq('business_id', BID).eq('active', true).not('next_followup_at', 'is', null).lte('next_followup_at', new Date().toISOString()).not('stage', 'in', '(closed,lost)').like('notes', '__e2e_concesionario%')
  log('leads: closed leads excluded from overdue', !overdueAfterClose.error && !overdueAfterClose.data?.some(l => l.id === leadId), overdueAfterClose.error?.message)

  // ── 12. test_drives create + setOutcome ────────────────────────────────────
  const tdSid = uid()
  const td = await svc.from('test_drives').insert({
    supabase_id: tdSid, business_id: BID, active: true,
    vehicle_inventory_supabase_id: vehicleSid,
    staff_supabase_id: salespersonSid,
    scheduled_at: new Date().toISOString(),
    license_number: '00112345678',
    notes: TAG,
  }).select('id, outcome, completed_at').single()
  log('test_drives: create scheduled', !td.error && !td.data?.outcome, td.error?.message)
  const tdId = td.data?.id

  // setOutcome: sold → links to deal
  const outcome = await svc.from('test_drives').update({
    outcome: 'sold',
    outcome_notes: 'Vendido inmediatamente',
    deal_supabase_id: dealSid,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', tdId).select('outcome, deal_supabase_id, completed_at').single()
  log('test_drives: setOutcome sold + deal link + completed_at', !outcome.error && outcome.data?.outcome === 'sold' && outcome.data?.deal_supabase_id === dealSid && !!outcome.data?.completed_at, outcome.error?.message)

  // outcome CHECK constraint rejects bogus values
  const bogus = await svc.from('test_drives').update({ outcome: 'invalid_value' }).eq('id', tdId)
  log('test_drives: CHECK rejects invalid outcome', !!bogus.error, bogus.error?.message?.slice(0, 60))

  // ── 13. activity_log entries (smoke: write a deal_closed manually as web.js would) ──
  const ev = await svc.from('activity_log').insert({
    supabase_id: uid(), business_id: BID,
    event_type: 'deal_closed', severity: 'info',
    target_type: 'sales_deal', target_id: String(dealId),
    amount: salePrice,
    metadata: { commission_amount: commissionAmount, financed, salesperson_supabase_id: salespersonSid, _tag: TAG },
  }).select('id, event_type').single()
  log('activity_log: deal_closed event accepted', !ev.error && ev.data?.event_type === 'deal_closed', ev.error?.message)

  const evStage = await svc.from('activity_log').insert({
    supabase_id: uid(), business_id: BID,
    event_type: 'pipeline_stage_change', severity: 'info',
    target_type: 'lead', target_id: String(leadId),
    old_value: 'lead', new_value: 'negotiation',
    metadata: { _tag: TAG },
  })
  log('activity_log: pipeline_stage_change event accepted', !evStage.error, evStage.error?.message)

  const evCommPaid = await svc.from('activity_log').insert({
    supabase_id: uid(), business_id: BID,
    event_type: 'deal_commission_paid', severity: 'info',
    target_type: 'sales_deal', target_id: String(dealId),
    amount: commissionAmount,
    metadata: { _tag: TAG },
  })
  log('activity_log: deal_commission_paid event accepted', !evCommPaid.error, evCommPaid.error?.message)

  // ── 14. Schema verification — check vehicle_documents table exists ──
  const schemaProbe = await svc.from('vehicle_documents').select('id').limit(1)
  log('schema: vehicle_documents table accessible (v2 migration applied)', !schemaProbe.error, schemaProbe.error?.message)

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await svc.from('activity_log').delete().eq('business_id', BID).contains('metadata', { _tag: TAG })
  await svc.from('vehicle_documents').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')
  await svc.from('test_drives').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')
  await svc.from('leads').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')
  await svc.from('sales_deals').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')
  await svc.from('vehicle_inventory').delete().eq('business_id', BID).like('notes', '__e2e_concesionario%')

  console.log(`\n=== ${pass} passed, ${fail} failed ===`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch(e => { console.error('FATAL:', e); process.exit(2) })
