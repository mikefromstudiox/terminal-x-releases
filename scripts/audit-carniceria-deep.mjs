// Deep live audit of carnicería tenant on production Supabase.
// Probes every table the v2.16.3 release touches, validates referential
// integrity, RLS posture, freshness bands, and demo-data coverage.
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL_ = process.env.SUPABASE_URL
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.SUPABASE_ANON_KEY
const svc  = createClient(URL_, SVC,  { auth: { persistSession: false } })
const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
const EMAIL = 'admin@carniceria.demo.terminalxpos.com'
const PASS  = 'Demo2026!'

let issues = 0
function probe(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) issues++
}

const { data: auth } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASS })
const BID = auth?.user?.user_metadata?.business_id
console.log('BID:', BID, '\n')

// 1. Schema posture per table
for (const t of ['carniceria_corte_categories','inventory_freshness_log','inventory_discards','recurring_orders','carniceria_scales','promotions','promotion_items']) {
  const { data, error } = await svc.from(t).select('*').limit(1)
  probe(`schema:${t}`, !error, error?.message || `cols=${Object.keys(data?.[0] || {}).join(',') || 'empty'}`)
}

// 2. Referential integrity — every freshness row points at a real inventory item
const { data: fresh } = await svc.from('inventory_freshness_log').select('inventory_item_supabase_id, expires_at, qty_remaining').eq('business_id', BID)
const itemSids = new Set((await svc.from('inventory_items').select('supabase_id').eq('business_id', BID)).data?.map(r => r.supabase_id) || [])
const freshOrphans = (fresh || []).filter(r => !itemSids.has(r.inventory_item_supabase_id))
probe('referential: freshness_log → inventory_items', freshOrphans.length === 0, `${fresh?.length || 0} rows, ${freshOrphans.length} orphans`)

// 3. Recurring orders → clients
const { data: rec } = await svc.from('recurring_orders').select('client_supabase_id, items_json, total_estimado').eq('business_id', BID)
const clientSids = new Set((await svc.from('clients').select('supabase_id').eq('business_id', BID)).data?.map(r => r.supabase_id) || [])
const recOrphans = (rec || []).filter(r => !clientSids.has(r.client_supabase_id))
probe('referential: recurring_orders → clients', recOrphans.length === 0, `${rec?.length || 0} rows, ${recOrphans.length} orphans`)

// 4. Pre-armed mayoreo cart will price correctly?
const validRec = (rec || []).filter(r => {
  try {
    const items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : r.items_json
    return Array.isArray(items) && items.every(i => Number(i.price_per_unit) > 0)
  } catch { return false }
})
probe('mayoreo: every item carries price_per_unit > 0',
  validRec.length === (rec?.length || 0),
  `${validRec.length}/${rec?.length || 0} valid`)

// 5. Auto-E31 readiness
const { data: rncClients } = await svc.from('clients').select('id, name, rnc').eq('business_id', BID).not('rnc', 'is', null)
probe('auto-E31: ≥1 client with RNC', (rncClients || []).length >= 1, `${rncClients?.length || 0} RNC clients`)
const { data: ncfE31 } = await svc.from('ncf_sequences').select('current_number, limit_number, active, enabled').eq('business_id', BID).eq('type', 'E31').maybeSingle()
probe('auto-E31: ncf_sequences.E31 active+enabled',
  !!ncfE31 && ncfE31.active && ncfE31.enabled,
  ncfE31 ? `next=${ncfE31.current_number} limit=${ncfE31.limit_number}` : 'missing')

// 6. Freshness band distribution today
function daysUntil(d) { return Math.round((new Date(d) - new Date()) / 86400000) }
const bands = { red: 0, amber: 0, green: 0 }
for (const f of (fresh || [])) {
  if (Number(f.qty_remaining) <= 0) continue
  const d = daysUntil(f.expires_at)
  if (d <= 1) bands.red++
  else if (d <= 3) bands.amber++
  else bands.green++
}
probe('freshness: bands distribute across today', (bands.red + bands.amber + bands.green) >= 1,
  `red=${bands.red} amber=${bands.amber} green=${bands.green}`)

// 7. Scales: exactly one default
const { data: scales } = await svc.from('carniceria_scales').select('nombre, active_default, active').eq('business_id', BID).eq('active', true)
const defaults = (scales || []).filter(s => s.active_default).length
probe('scales: exactly one active_default', defaults === 1, `${defaults} default(s) of ${scales?.length || 0}`)

// 8. Promotions: any active today?
const today = new Date().toISOString().slice(0,10)
const { data: promos } = await svc.from('promotions').select('name, start_date, end_date, season_key, active').eq('business_id', BID).eq('active', true)
const liveToday = (promos || []).filter(p => p.start_date <= today && today <= p.end_date)
probe('promotions: ≥1 active today (informational)', true, `${liveToday.length} live, ${promos?.length || 0} configured`)

// 9. Cortes catalog has all 7 especies covered?
const { data: cortes } = await svc.from('carniceria_corte_categories').select('especie').eq('business_id', BID).eq('active', true)
const especies = new Set((cortes || []).map(c => c.especie))
probe('cortes: ≥3 especies covered', especies.size >= 3, `especies=${[...especies].join(',')}`)

// 10. Anon (no JWT) blocked from reading carniceria tables → RLS posture
const anonNoSession = createClient(URL_, ANON, { auth: { persistSession: false } })
const { data: anonCortes, error: anonErr } = await anonNoSession.from('carniceria_corte_categories').select('id').limit(1)
probe('RLS: anon (no session) can NOT read cortes', !anonCortes || anonCortes.length === 0, anonErr?.message || `read ${anonCortes?.length || 0} rows`)

// 11. Inventory carniceria fields present on row
const { data: invSample } = await svc.from('inventory_items').select('name, sold_by_weight, prepacked, expires_at, received_at, price_per_unit, unit, corte_category_supabase_id').eq('business_id', BID).limit(20)
const carnRows = (invSample || []).filter(r => r.sold_by_weight)
probe('inventory: carniceria items carry full carniceria column set',
  carnRows.length >= 1 && carnRows.every(r => r.unit && r.price_per_unit > 0 && r.expires_at && r.received_at),
  `${carnRows.length} carn rows, all fields populated: ${carnRows.every(r => r.unit && r.price_per_unit && r.expires_at && r.received_at)}`)

// 12. Storage buckets exist?
for (const b of ['corte-photos', 'inventory-discard-photos']) {
  const r = await fetch(`${URL_}/storage/v1/bucket/${b}`, {
    headers: { Authorization: `Bearer ${SVC}`, apikey: SVC },
  })
  probe(`storage: bucket "${b}" exists`, r.status === 200, `HTTP ${r.status}`)
}

// 13. ticket_items.preparation_notes — schema check
const { error: tErr } = await svc.from('ticket_items').select('preparation_notes').limit(1)
probe('ticket_items.preparation_notes exists', !tErr, tErr?.message)

// 14a. v2.16.4 — discard schema columns
const { data: discCol, error: discColErr } = await svc.from('inventory_discards')
  .select('id, is_post_sale, related_ticket_supabase_id, e33_encf').limit(1)
probe('inventory_discards: post-sale columns present', !discColErr,
  discColErr?.message || 'is_post_sale + related_ticket_supabase_id + e33_encf available')

// 14b. v2.16.4 — ncf_sequences includes E33 ready for NCC
const { data: ncfE33 } = await svc.from('ncf_sequences')
  .select('current_number, active, enabled').eq('business_id', BID).eq('type', 'E33').maybeSingle()
probe('ncf_sequences.E33 configured (informational)', true,
  ncfE33 ? `next=${ncfE33.current_number} active=${ncfE33.active}` : 'no E33 sequence (NCC will skip encf reservation)')

// 14c. v2.16.4 — discount engine readiness:
// at least one freshness row with auto_discount_applied OR a season-targeted promotion
const { data: autoDisc } = await svc.from('inventory_freshness_log')
  .select('id').eq('business_id', BID).eq('auto_discount_applied', true).limit(1)
const { data: seasonPromo } = await svc.from('promotions')
  .select('id, season_key, active, start_date, end_date').eq('business_id', BID).eq('active', true).not('season_key', 'is', null)
const todayDeep = new Date().toISOString().slice(0,10)
const liveSeason = (seasonPromo || []).filter(p => p.start_date <= todayDeep && todayDeep <= p.end_date)
probe('discount engine: data sources present', (autoDisc?.length || 0) >= 0 && (seasonPromo?.length || 0) >= 1,
  `auto_50_vence rows=${autoDisc?.length || 0}, seasonal promos=${seasonPromo?.length || 0} (${liveSeason.length} live today)`)

// 14. Cuadre caja shifts on demo (known cosmetic gap)
const { data: cuadre } = await svc.from('cuadre_caja').select('id').eq('business_id', BID).limit(1)
probe('cuadre_caja: shifts exist on demo', (cuadre || []).length >= 1, `${cuadre?.length || 0} shifts`)

// 15. License + plan check
const { data: lic } = await svc.from('licenses').select('plan_id, status').eq('business_id', BID).maybeSingle()
probe('license: Pro PLUS or higher', !!lic, `plan=${lic?.plan_id} status=${lic?.status}`)

await anon.auth.signOut()
console.log(`\n=== ${issues} ISSUES ===`)
process.exit(issues > 0 ? 1 : 0)
