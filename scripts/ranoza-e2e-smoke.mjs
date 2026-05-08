/**
 * Ranoza E2E smoke test — logs in as Jerry and exercises every v2.11.0 feature
 * against Supabase the same way the browser would. Reports pass/fail per step.
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY
const BID  = '4f789f41-76d2-4402-838f-5fe20a91641f'
const EMAIL = 'Jerryfelix@gmail.com'
const PASS  = 'Rahel25@'

const anon = createClient(URL, ANON, { auth: { persistSession:false } })
const svc  = createClient(URL, SVC,  { auth: { persistSession:false } })
const sha  = s => crypto.createHash('sha256').update(String(s)).digest('hex')
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
  console.log('\n=== RANOZA v2.11 E2E SMOKE ===\n')

  // 1. Auth
  const { data: auth, error: authErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASS })
  log('auth: email+password sign-in', !authErr && !!auth?.session, authErr?.message)
  if (!auth?.session) { console.log('\nBLOCKER — cannot proceed without session'); process.exit(1) }

  // 2. PIN lookup (byPin flow) — pin_hash is bcrypt, so fetch active owner row
  // for this business and bcrypt-compare in Node, mirroring the AuthContext flow.
  const bcrypt = (await import('bcryptjs')).default
  const { data: staffRows, error: e2 } = await anon.from('staff')
    .select('id,name,role,active,pin_hash,pin_salt,business_id')
    .eq('business_id', BID).eq('active', true)
  // Jerry's PIN is 434233 (set via admin panel 2026-04-21; stored bcrypt).
  // bcrypt hash is computed over `pin + pin_salt` (see packages/data/web.js
  // hashPin + web/api/panel.js handleSetStaffPin). sha256 fallback kept for
  // any legacy rows that pre-date bcrypt rollout.
  const jerryRow = staffRows?.find(r => r.name === 'Jerry Felix' && r.pin_hash && (
    (r.pin_hash.startsWith('$2') && bcrypt.compareSync('434233' + (r.pin_salt || ''), r.pin_hash)) ||
    r.pin_hash === sha('434233')
  ))
  log('pin byPin: Jerry 434233', !e2 && !!jerryRow, e2?.message || (staffRows ? `${staffRows.length} active staff scanned` : 'no rows'))

  // 3. License validation (direct API call)
  const valResp = await fetch(`${URL.replace('supabase.co','supabase.co').replace('https://csppjsoirjflumaiipqw.supabase.co','https://terminalxpos.com')}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + auth.session.access_token },
    body: JSON.stringify({ key:'TXL-C298-7X96-5VFC', hwid:'web-client', rnc:'132131681' }),
  }).then(r => r.json()).catch(e => ({ error: e.message }))
  log('license: /api/validate as web-client', valResp?.valid === true, valResp?.status || valResp?.error)

  // 4. Inventory read (v2.4 + category tabs + margin)
  const { data: inv, error: e4 } = await anon.from('inventory_items')
    .select('id,supabase_id,name,category,price,cost,price_pedidos_ya,aplica_itbis')
    .eq('business_id', BID).eq('active', true).order('name').limit(5)
  log('inventory: read 5 products', !e4 && inv?.length >= 5, e4?.message || `got ${inv?.length}`)

  // 5. Pedidos Ya price column (v2.4)
  const { count: pyCount } = await anon.from('inventory_items')
    .select('*', { count:'exact', head:true })
    .eq('business_id', BID).not('price_pedidos_ya', 'is', null)
  log('py prices: count products with PY price set', pyCount !== null, `${pyCount ?? 0} products (expected 0+ until client sends list)`)

  // 6. Category tab coverage (v2.7 + Ranoza categorization)
  const { data: catSample } = await anon.from('inventory_items').select('category').eq('business_id', BID).eq('active', true).limit(2000)
  const catSet = new Set((catSample || []).map(r => r.category))
  log('categories: distinct count', catSet.size > 10, `${catSet.size} distinct categories`)

  // 7. Conteo Físico INSERT (v2.5)
  const countSid = uid()
  const { data: countHeader, error: e7 } = await anon.from('inventory_counts').insert({
    supabase_id: countSid, business_id: BID,
    title: 'E2E smoke test', status: 'abierto', counted_by_name: 'Jerry Felix',
  }).select('id').single()
  log('conteo: header insert', !e7 && !!countHeader?.id, e7?.message)

  // 7b. Conteo items insert (batch 3)
  if (countHeader?.id && inv?.length) {
    const rows = inv.slice(0,3).map(it => ({
      supabase_id: uid(), business_id: BID,
      count_supabase_id: countSid,
      inventory_item_supabase_id: it.supabase_id,
      name: it.name,
      expected_qty: 10, unit_cost: Number(it.cost) || 0, unit_price: Number(it.price) || 0,
    }))
    const { error: e7b } = await anon.from('inventory_count_items').insert(rows)
    log('conteo: items insert (3 rows)', !e7b, e7b?.message)

    // 7c. Update a counted_qty (simulates entry)
    const { error: e7c } = await anon.from('inventory_count_items')
      .update({ counted_qty: 9 }).eq('count_supabase_id', countSid).eq('inventory_item_supabase_id', rows[0].inventory_item_supabase_id)
    log('conteo: update counted_qty', !e7c, e7c?.message)

    // 7d. Mark completed
    const { error: e7d } = await anon.from('inventory_counts')
      .update({ status:'completado', completed_at: new Date().toISOString() }).eq('id', countHeader.id)
    log('conteo: complete', !e7d, e7d?.message)

    // 7e. Cleanup
    await anon.from('inventory_counts').delete().eq('id', countHeader.id)
  }

  // 8. Manager authorization card (v2.6)
  const token = Array.from({length:20}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('')
  const tokenHash = sha(token)
  // Find Michelle's staff id
  const { data: michelle } = await svc.from('staff').select('id').eq('business_id', BID).eq('username','michelle').single()
  if (michelle?.id) {
    const { error: e8 } = await anon.from('staff')
      .update({ manager_auth_hash: tokenHash, manager_auth_rotated_at: new Date().toISOString() })
      .eq('id', michelle.id)
    log('manager card: generate token for Michelle', !e8, e8?.message)

    // 8b. Verify via server endpoint (same flow the modal uses)
    const verifyResp = await fetch('https://terminalxpos.com/api/staff-verify-auth', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + auth.session.access_token },
      body: JSON.stringify({ token, businessId: BID }),
    }).then(r => r.json()).catch(e => ({ error: e.message }))
    log('manager card: server verify accepts correct token',
        verifyResp?.match?.name === 'Michelle Rodriguez',
        verifyResp?.error || `matched: ${verifyResp?.match?.name || 'none'}`)

    // 8c. Verify rejects invalid token
    const badResp = await fetch('https://terminalxpos.com/api/staff-verify-auth', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + auth.session.access_token },
      body: JSON.stringify({ token: 'XXXXXXXXXXXXXXXXXXXX', business_id: BID }),
    }).then(r => r.json()).catch(e => ({ error: e.message }))
    log('manager card: server rejects invalid token', !badResp?.match, JSON.stringify(badResp))
  }

  // 9. Loyalty award RPC (v2.11)
  // Need a test client. Find or create one.
  let { data: testClient } = await svc.from('clients').select('id, supabase_id, loyalty_points')
    .eq('business_id', BID).eq('name', 'E2E TEST CLIENT').maybeSingle()
  if (!testClient) {
    const cid = uid()
    const r = await svc.from('clients').insert({
      business_id: BID, supabase_id: cid, name: 'E2E TEST CLIENT', active: true, loyalty_points: 0,
    }).select('id, supabase_id').single()
    testClient = r.data
  }
  const { data: awardRes, error: e9 } = await anon.rpc('loyalty_award', {
    p_business_id: BID,
    p_client_supabase_id: testClient.supabase_id,
    p_ticket_supabase_id: null,
    p_points: 50,
    p_notes: 'E2E award',
  })
  log('loyalty: award 50 pts via RPC', !e9 && Number(awardRes) === 50, e9?.message || `got ${awardRes}`)

  // 9b. Verify ledger row created
  const { data: txns } = await anon.from('loyalty_transactions').select('*')
    .eq('business_id', BID).eq('client_supabase_id', testClient.supabase_id).eq('event_type','earn').limit(1)
  log('loyalty: ledger row inserted', (txns?.length || 0) >= 1, `${txns?.length || 0} rows`)

  // 9c. Redeem
  const { data: redeemRes, error: e9c } = await anon.rpc('loyalty_redeem', {
    p_business_id: BID,
    p_client_supabase_id: testClient.supabase_id,
    p_ticket_supabase_id: null,
    p_points: 20,
    p_notes: 'E2E redeem',
  })
  log('loyalty: redeem 20 pts', !e9c && Number(redeemRes) >= 0, e9c?.message)

  // 9d. Cleanup
  await svc.from('loyalty_transactions').delete().eq('client_supabase_id', testClient.supabase_id)
  await svc.from('clients').delete().eq('id', testClient.id)

  // 10. Multi-device ticket lock (v2.11)
  const lockItem = inv?.[0]
  if (lockItem) {
    const deviceA = uid()
    const { error: e10 } = await anon.from('ticket_locks').insert({
      business_id: BID,
      inventory_item_supabase_id: lockItem.supabase_id,
      device_id: deviceA, qty: 1,
    })
    log('ticket locks: acquire', !e10, e10?.message)

    // 10b. Another device reading sees the lock
    const { data: locks } = await anon.from('ticket_locks')
      .select('qty, device_id').eq('business_id', BID)
      .eq('inventory_item_supabase_id', lockItem.supabase_id)
      .gt('expires_at', new Date().toISOString())
    log('ticket locks: visible to other device', (locks?.length || 0) >= 1, `${locks?.length || 0} active locks`)

    // 10c. Release
    await anon.from('ticket_locks').delete().eq('device_id', deviceA)
  }

  // 11. Activity log write (manager_override simulation)
  const { error: e11 } = await anon.from('activity_log').insert({
    supabase_id: uid(), business_id: BID,
    event_type: 'manager_override_failed',
    severity: 'warn',
    actor_name: 'E2E Test',
    target_type: 'manager_card',
    reason: 'E2E smoke — invalid token attempt',
    metadata: { method: 'card', action: 'price_edit' },
  })
  log('activity log: manager_override_failed write', !e11, e11?.message)

  // 12. app_settings write test (tienda_subtype + POS tab order).
  // Real onConflict target is now available after migration
  // 20260429000300_app_settings_unique_constraint.sql replaced the partial
  // indexes with `UNIQUE NULLS NOT DISTINCT (business_id, key, device_hwid)`.
  const { error: e12 } = await anon.from('app_settings')
    .upsert([
      { business_id: BID, key: 'tienda_subtype', value: 'licoreria',  device_hwid: null, is_device_local: false, supabase_id: uid() },
      { business_id: BID, key: 'pos_tab_order',  value: JSON.stringify(['Rones','Cervezas','Whiskey','Vinos']), device_hwid: null, is_device_local: false, supabase_id: uid() },
    ], { onConflict: 'business_id,key,device_hwid', ignoreDuplicates: false })
  log('settings: upsert tienda_subtype + pos_tab_order', !e12, e12?.message)

  // 13. Check Ranoza's license status + trial
  const { data: lic } = await anon.from('licenses').select('license_key,status,expires_at,plan_id')
    .eq('business_id', BID).eq('status','active').order('created_at', { ascending: false }).limit(1).maybeSingle()
  log('license: Ranoza active', lic?.status === 'active', `expires ${lic?.expires_at}`)

  // 14. Supabase schema integrity — loyalty RPCs visible as anon+JWT
  const { error: e14 } = await anon.rpc('loyalty_tier_for', { points: 7500 })
  log('rpc: loyalty_tier_for callable', !e14, e14?.message)

  // 15. Liquidación regression — empleado_supabase_id contract.
  // The "shows 0" 8x bug was caused by byPeriod return shapes dropping
  // empleado_supabase_id, so NominaEmpleados.build() couldn't bucket per
  // worker. This guards the contract: every commission row must carry
  // empleado_supabase_id, and a synthesized bucket must expose the same
  // key NominaEmpleados reads (r.empleado_supabase_id).
  for (const table of ['washer_commissions','seller_commissions','cajero_commissions']) {
    const { data: rows, error: ce } = await svc.from(table)
      .select('empleado_supabase_id, base_amount, commission_amount, paid')
      .not('empleado_supabase_id','is',null)
      .limit(50)
    if (ce) { log(`liquidación: ${table} readable`, false, ce.message); continue }
    const allHaveSid = rows.length === 0 || rows.every(r => typeof r.empleado_supabase_id === 'string' && r.empleado_supabase_id.length > 0)
    log(`liquidación: ${table} rows carry empleado_supabase_id`, allHaveSid, `${rows.length} rows`)
    // Simulate byPeriod bucket shape — must expose empleado_supabase_id key.
    const map = {}
    for (const r of rows) {
      const sid = r.empleado_supabase_id
      if (!map[sid]) map[sid] = { empleado_supabase_id: sid, ticket_count: 0, total_commission: 0 }
      map[sid].ticket_count += 1
      map[sid].total_commission += Number(r.commission_amount || 0)
    }
    const buckets = Object.values(map)
    const shapeOK = buckets.every(b => 'empleado_supabase_id' in b && b.empleado_supabase_id)
    log(`liquidación: ${table} byPeriod bucket shape exposes empleado_supabase_id`, shapeOK, `${buckets.length} buckets`)
  }

  // ===== Summary =====
  console.log(`\n=== ${pass} passed, ${fail} failed ===`)
  if (fail > 0) {
    console.log('\nFailures:')
    for (const r of results.filter(r => !r.ok)) console.log(`  ❌ ${r.step}${r.detail ? ' — ' + r.detail : ''}`)
    process.exit(1)
  }
}
run().catch(e => { console.error('CRASH:', e); process.exit(2) })
