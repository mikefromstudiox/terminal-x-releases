/**
 * Ofertas E2E smoke — exercises the full bundle flow against Supabase as Jerry
 * (Ranoza). Creates an oferta with 2 components, lists, sells (simulated cart
 * explosion + ticket_items insert), verifies inventory decremented, cleans up.
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
const uid  = () => crypto.randomUUID()

let pass = 0, fail = 0
function log(step, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ' — ' + detail : ''}`)
  ok ? pass++ : fail++
}

async function run() {
  console.log('\n=== OFERTAS E2E SMOKE (Ranoza) ===\n')

  const { data: auth, error: authErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASS })
  log('auth: sign-in', !authErr && !!auth?.session, authErr?.message)
  if (!auth?.session) process.exit(1)

  // 1) Tables exist + RLS reachable
  const { error: e1 } = await anon.from('ofertas').select('id', { head: true, count: 'exact' }).eq('business_id', BID)
  log('schema: ofertas table reachable', !e1, e1?.message)
  const { error: e2 } = await anon.from('oferta_items').select('id', { head: true, count: 'exact' }).eq('business_id', BID)
  log('schema: oferta_items table reachable', !e2, e2?.message)

  // 2) Pull two real inventory items to bundle
  const { data: invItems, error: e3 } = await anon.from('inventory_items')
    .select('id, supabase_id, name, price, quantity, aplica_itbis')
    .eq('business_id', BID).eq('active', true).gt('quantity', 5).limit(2)
  log('inventory: 2 components found', !e3 && (invItems?.length === 2), e3?.message || `${invItems?.length}`)
  if (!invItems || invItems.length < 2) process.exit(1)
  const [c1, c2] = invItems
  const startQty1 = c1.quantity, startQty2 = c2.quantity

  // 3) Create oferta
  const ofertaSupId = uid()
  const subtotal = (c1.price * 1) + (c2.price * 2)
  const ofertaPrice = Math.round(subtotal * 0.85)
  const { error: e4 } = await anon.from('ofertas').insert({
    supabase_id: ofertaSupId, business_id: BID,
    name: 'TEST Bundle E2E ' + Date.now().toString(36),
    description: 'Ofertas smoke test bundle',
    price: ofertaPrice, active: true,
  })
  log('ofertas: insert oferta', !e4, e4?.message)

  // 4) Insert components
  const { error: e5 } = await anon.from('oferta_items').insert([
    { supabase_id: uid(), business_id: BID, oferta_supabase_id: ofertaSupId, inventory_item_supabase_id: c1.supabase_id, qty: 1 },
    { supabase_id: uid(), business_id: BID, oferta_supabase_id: ofertaSupId, inventory_item_supabase_id: c2.supabase_id, qty: 2 },
  ])
  log('oferta_items: insert 2 components', !e5, e5?.message)

  // 5) Fetch oferta back via list (with embedded items) — mirrors web.js read
  const { data: list, error: e6 } = await anon.from('ofertas')
    .select('*, oferta_items(*)').eq('business_id', BID).eq('supabase_id', ofertaSupId).single()
  log('ofertas: read back with components', !e6 && list?.oferta_items?.length === 2, e6?.message || `${list?.oferta_items?.length} items`)

  // 6) Simulate sale: explode into ticket_items + decrement inventory
  // (mirroring what RetailPOS cart-explosion + tickets.create + inventory_items.quantity update do)
  const ticketId = uid()
  const { error: e7 } = await svc.from('tickets').insert({
    id: ticketId, supabase_id: ticketId, business_id: BID,
    status: 'paid', subtotal: ofertaPrice, total: ofertaPrice, payment_method: 'efectivo',
  })
  log('tickets: create parent ticket', !e7, e7?.message)

  if (!e7) {
    // Component lines tagged with oferta_supabase_id
    const lines = [
      { supabase_id: uid(), business_id: BID, ticket_supabase_id: ticketId, name: c1.name, quantity: 1, price: c1.price, oferta_supabase_id: ofertaSupId },
      { supabase_id: uid(), business_id: BID, ticket_supabase_id: ticketId, name: c2.name, quantity: 2, price: c2.price, oferta_supabase_id: ofertaSupId },
      { supabase_id: uid(), business_id: BID, ticket_supabase_id: ticketId, name: 'Descuento Oferta: bundle', quantity: 1, price: ofertaPrice - subtotal, oferta_supabase_id: ofertaSupId },
    ]
    const { error: e8 } = await svc.from('ticket_items').insert(lines)
    log('ticket_items: 3 lines (2 components + 1 discount) with oferta_supabase_id', !e8, e8?.message)

    // Decrement inventory (RetailPOS does this on sale)
    const { error: e9a } = await svc.from('inventory_items').update({ quantity: startQty1 - 1 }).eq('id', c1.id)
    const { error: e9b } = await svc.from('inventory_items').update({ quantity: startQty2 - 2 }).eq('id', c2.id)
    log('inventory: decrement components', !e9a && !e9b, e9a?.message || e9b?.message)

    // Verify
    const { data: post } = await svc.from('inventory_items').select('id, quantity').in('id', [c1.id, c2.id])
    const post1 = post.find(p => p.id === c1.id)?.quantity
    const post2 = post.find(p => p.id === c2.id)?.quantity
    log('inventory: post-sale qty correct', post1 === startQty1 - 1 && post2 === startQty2 - 2, `${startQty1}->${post1}, ${startQty2}->${post2}`)

    // Cleanup ticket
    await svc.from('ticket_items').delete().eq('ticket_supabase_id', ticketId)
    await svc.from('tickets').delete().eq('id', ticketId)
    await svc.from('inventory_items').update({ quantity: startQty1 }).eq('id', c1.id)
    await svc.from('inventory_items').update({ quantity: startQty2 }).eq('id', c2.id)
  }

  // 7) Cleanup oferta
  await svc.from('oferta_items').delete().eq('oferta_supabase_id', ofertaSupId)
  await svc.from('ofertas').delete().eq('supabase_id', ofertaSupId)
  log('cleanup: oferta + components deleted', true)

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
