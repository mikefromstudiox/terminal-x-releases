/**
 * Ranoza Dual-Terminal Concurrent Smoke
 * --------------------------------------
 * Simulates two POS web sessions hammering the SAME tenant (Licoreria Demo)
 * at the same instant against live Supabase. Surfaces lost-update / double-NCF
 * / cuadre fork / lock-skip races that single-actor harnesses miss.
 *
 * SAFETY: writes go to the Licoreria Demo tenant only. Ranoza is touched
 * read-only (shape probe). All seed/cleanup is per-run.
 *
 * Run:  node scripts/ranoza-dual-terminal-smoke.mjs
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL  = process.env.SUPABASE_URL
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY
const SANDBOX = '949fd70b-4609-4c71-a3af-2b9160043c3e'   // Licoreria Demo
const RANOZA  = '4f789f41-76d2-4402-838f-5fe20a91641f'   // shape probe only

if (!URL || !SVC) { console.error('missing SUPABASE env'); process.exit(2) }

// Two clients to mirror two browsers / two terminals. Service-role bypasses RLS
// (real terminals each carry a per-license JWT in prod; the racing semantics on
// the DB side are identical because all writes still pass through the same
// Postgres rows with the same constraints, RPCs, and triggers).
const A = createClient(URL, SVC, { auth: { persistSession: false }, global: { headers: { 'x-terminal': 'A' } } })
const B = createClient(URL, SVC, { auth: { persistSession: false }, global: { headers: { 'x-terminal': 'B' } } })

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10)

const results = []
let pass = 0, fail = 0
function record(name, ok, detail = '', evidence = null) {
  const sym = ok ? 'PASS' : 'FAIL'
  console.log(`[${sym}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok && evidence) console.log('       evidence:', JSON.stringify(evidence, null, 2))
  results.push({ name, ok, detail, evidence })
  ok ? pass++ : fail++
}

async function pickInventoryItem() {
  const { data } = await A.from('inventory_items')
    .select('id, supabase_id, name, quantity, price')
    .eq('business_id', SANDBOX).eq('active', true).gt('quantity', 50)
    .order('name').limit(1).single()
  return data
}

async function ensureTestClient() {
  const name = 'DUAL E2E CLIENT'
  let { data } = await A.from('clients').select('id, supabase_id, balance, loyalty_points')
    .eq('business_id', SANDBOX).eq('name', name).maybeSingle()
  if (!data) {
    const sid = uid()
    const r = await A.from('clients').insert({
      business_id: SANDBOX, supabase_id: sid, name, active: true,
      credit_limit: 100000, balance: 0, loyalty_points: 0,
    }).select('id, supabase_id, balance, loyalty_points').single()
    data = r.data
  } else {
    // Reset to zero for deterministic runs
    await A.from('clients').update({ balance: 0, loyalty_points: 0 }).eq('id', data.id)
    data.balance = 0; data.loyalty_points = 0
  }
  return data
}

async function insertTicket(client, sid, docNumber, status='cobrado') {
  return client.from('tickets').insert({
    supabase_id: sid, business_id: SANDBOX,
    doc_number: docNumber, status,
    subtotal: 100, itbis: 18, total: 118,
    ncf_type: 'B02', payment_method: 'efectivo',
    cajero_name: 'DUAL E2E', created_at: now(),
    rev: 1,
  }).select('id, supabase_id, doc_number').single()
}

// ============================================================================
// SCENARIO 1 — concurrent inventory deduct on the same SKU
// Production code path is RPC deduct_inventory_atomic. Verifies the guarded
// UPDATE serializes (final qty = pre - 2, never pre - 1).
// ============================================================================
async function scenario1_inventoryRace() {
  const item = await pickInventoryItem()
  if (!item) return record('1. inventory race (deduct_inventory_atomic)', false, 'no test SKU available')
  const pre = Number(item.quantity)

  const tA = uid(), tB = uid()
  const payload = (tid) => ({
    p_business_id: SANDBOX,
    p_ticket_supabase_id: tid,
    p_hwid: 'TERMINAL-' + tid.slice(0,4),
    // RPC body uses jsonb_array_elements; pass an array, not a stringified scalar.
    p_items: [{ item_supabase_id: item.supabase_id, qty: 1, name: item.name }],
  })
  const [rA, rB] = await Promise.all([
    A.rpc('deduct_inventory_atomic', payload(tA)),
    B.rpc('deduct_inventory_atomic', payload(tB)),
  ])

  const { data: post } = await A.from('inventory_items')
    .select('quantity').eq('id', item.id).single()
  const expected = pre - 2
  const ok = Number(post.quantity) === expected
  record('1. inventory race (deduct_inventory_atomic)', ok,
    `pre=${pre} post=${post.quantity} expected=${expected}`,
    ok ? null : { rA: rA.error || rA.data, rB: rB.error || rB.data, item: item.name })

  // restore
  await A.from('inventory_items').update({ quantity: pre }).eq('id', item.id)
}

// ============================================================================
// SCENARIO 1b — RAW lost-update probe on inventory_items.quantity
// Doesn't use the RPC — tests whether the read-modify-write pattern (which
// some legacy code paths still use) is racy. Expected to FAIL — that's the
// point: it documents that bare update-by-PK with read-then-write IS racy
// and must always go through deduct_inventory_atomic.
// ============================================================================
async function scenario1b_rawUpdateLostWrite() {
  const item = await pickInventoryItem()
  if (!item) return record('1b. raw read-modify-write lost-update probe', false, 'no test SKU')
  const pre = Number(item.quantity)
  const racyDeduct = async (cli) => {
    const { data: row } = await cli.from('inventory_items')
      .select('quantity').eq('id', item.id).single()
    return cli.from('inventory_items')
      .update({ quantity: Number(row.quantity) - 1 })
      .eq('id', item.id)
  }
  await Promise.all([racyDeduct(A), racyDeduct(B)])
  const { data: post } = await A.from('inventory_items').select('quantity').eq('id', item.id).single()
  // We REPORT this finding regardless of pass/fail. Goal is to show the
  // delta: if delta < 2, lost-update happened — proves why the RPC matters.
  const delta = pre - Number(post.quantity)
  const ok = delta === 2
  record('1b. raw read-modify-write probe (informational)', ok,
    `delta=${delta} (expected 2; <2 means lost-update — DO NOT bypass deduct_inventory_atomic)`,
    ok ? null : { pre, post: post.quantity })
  await A.from('inventory_items').update({ quantity: pre }).eq('id', item.id)
}

// ============================================================================
// SCENARIO 2 — concurrent NCF allocation
// allocate_ncf_block is HWID-scoped (each terminal owns its own block) —
// concurrent calls from DISTINCT hwids must return DISJOINT ranges.
// ============================================================================
async function scenario2_ncfRace() {
  const ncfType = 'B02'
  // Pre-bootstrap the master row (single-call) to remove first-call insert
  // collision from the race surface. Real prod always has master rows after
  // a license is provisioned. We test STEADY-STATE concurrent allocation.
  await A.rpc('allocate_ncf_block', { p_business_id: SANDBOX, p_hwid: 'BOOTSTRAP', p_ncf_type: ncfType, p_size: 10 })
  // Snapshot legacy current_number for evidence
  const { data: pre } = await A.from('ncf_sequences').select('current_number')
    .eq('business_id', SANDBOX).eq('type', ncfType).single()

  const callA = A.rpc('allocate_ncf_block', { p_business_id: SANDBOX, p_hwid: 'HWID-DUAL-A', p_ncf_type: ncfType, p_size: 50 })
  const callB = B.rpc('allocate_ncf_block', { p_business_id: SANDBOX, p_hwid: 'HWID-DUAL-B', p_ncf_type: ncfType, p_size: 50 })
  const [rA, rB] = await Promise.all([callA, callB])

  const blockA = rA.data, blockB = rB.data
  if (rA.error || rB.error || !blockA || !blockB) {
    return record('2. NCF block allocation race', false, `rpc errors`, { rA: rA.error, rB: rB.error })
  }
  // Disjoint ranges (no overlap)
  const overlap = !(blockA.range_end < blockB.range_start || blockB.range_end < blockA.range_start)
  const ok = !overlap
  record('2. NCF block allocation race (per-HWID disjoint ranges)', ok,
    `A=[${blockA.range_start}..${blockA.range_end}] B=[${blockB.range_start}..${blockB.range_end}]`,
    ok ? null : { blockA, blockB })

  // 2b — same HWID twice (idempotency: should reuse)
  const callC = A.rpc('allocate_ncf_block', { p_business_id: SANDBOX, p_hwid: 'HWID-DUAL-A', p_ncf_type: ncfType, p_size: 50 })
  const callD = A.rpc('allocate_ncf_block', { p_business_id: SANDBOX, p_hwid: 'HWID-DUAL-A', p_ncf_type: ncfType, p_size: 50 })
  const [rC, rD] = await Promise.all([callC, callD])
  // Both calls from same HWID with non-exhausted block must point to same range_start.
  const reused = rC.data?.range_start === rD.data?.range_start
  record('2b. NCF same-HWID concurrent calls reuse partial block', reused,
    `C.range_start=${rC.data?.range_start} D.range_start=${rD.data?.range_start}`,
    reused ? null : { rC: rC.data, rD: rD.data })
}

// ============================================================================
// SCENARIO 3 — concurrent ticket inserts (distinct supabase_ids)
// Two terminals create tickets in the same millisecond — both rows must land
// with no PK conflict, distinct doc_numbers, and visibility from the other.
// ============================================================================
async function scenario3_ticketInsert() {
  const sidA = uid(), sidB = uid()
  const docA = 'DUAL-A-' + Date.now(), docB = 'DUAL-B-' + Date.now()
  const [rA, rB] = await Promise.all([
    insertTicket(A, sidA, docA, 'pendiente'),
    insertTicket(B, sidB, docB, 'pendiente'),
  ])
  const ok = !rA.error && !rB.error && rA.data.supabase_id !== rB.data.supabase_id
                && rA.data.doc_number !== rB.data.doc_number
  record('3. concurrent ticket INSERT (distinct supabase_ids)', ok,
    `A=${rA.data?.doc_number} B=${rB.data?.doc_number}`,
    ok ? null : { rA: rA.error || rA.data, rB: rB.error || rB.data })

  // Cross-visibility: A reads B's ticket and vice versa
  const [seenByA, seenByB] = await Promise.all([
    A.from('tickets').select('id').eq('supabase_id', sidB).maybeSingle(),
    B.from('tickets').select('id').eq('supabase_id', sidA).maybeSingle(),
  ])
  const visOk = !!seenByA.data?.id && !!seenByB.data?.id
  record('3b. cross-visibility after concurrent insert', visOk, '',
    visOk ? null : { seenByA, seenByB })

  // cleanup
  await A.from('tickets').delete().in('supabase_id', [sidA, sidB])
}

// ============================================================================
// SCENARIO 4 — A voids while B reads for reprint
// Verifies B sees a consistent snapshot (status is either pre-void OR post-void,
// no torn read). Uses a controlled void path.
// ============================================================================
async function scenario4_voidWhileRead() {
  const sid = uid()
  const ins = await insertTicket(A, sid, 'DUAL-VOID-' + Date.now(), 'cobrado')
  if (ins.error) return record('4. void-while-read', false, ins.error.message)

  const voidOp = A.from('tickets').update({
    status: 'voided', void_reason: 'DUAL E2E', void_at: now(), rev: 2,
  }).eq('supabase_id', sid).select('status').single()
  const readOp = B.from('tickets').select('status, void_at, total').eq('supabase_id', sid).single()

  const [v, r] = await Promise.all([voidOp, readOp])
  const status = r.data?.status
  // Acceptable: either 'cobrado' (read won the race) or 'voided' (void won).
  // Unacceptable: any other value, or read has void_at set without status='voided'.
  const consistent = (status === 'cobrado' && !r.data.void_at)
                  || (status === 'voided'  &&  r.data.void_at)
  record('4. void-while-read consistent snapshot', consistent,
    `B saw status=${status} void_at=${r.data?.void_at || 'null'}`,
    consistent ? null : { v: v.error || v.data, r: r.error || r.data })

  await A.from('tickets').delete().eq('supabase_id', sid)
}

// ============================================================================
// SCENARIO 5 — ticket_locks: A holds, B tries to ring
// A acquires a lock on an inventory_item. B inserts a competing lock and reads.
// Production behaviour: ticket_locks is advisory — multiple devices CAN insert
// rows. The contract is: B's pre-write SELECT must see A's lock so the UI
// blocks/merges. Test: B's read returns A's lock row.
// ============================================================================
async function scenario5_ticketLock() {
  const item = await pickInventoryItem()
  if (!item) return record('5. ticket_locks visibility', false, 'no SKU')
  const devA = 'DEV-A-' + uid().slice(0,8)
  const devB = 'DEV-B-' + uid().slice(0,8)

  // A acquires
  const acq = await A.from('ticket_locks').insert({
    business_id: SANDBOX,
    inventory_item_supabase_id: item.supabase_id,
    device_id: devA, qty: 1,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  })
  if (acq.error) return record('5. ticket_locks acquire by A', false, acq.error.message)

  // B's pre-write check + B's competing insert run concurrently
  const [look, rival] = await Promise.all([
    B.from('ticket_locks').select('device_id, qty, expires_at')
      .eq('business_id', SANDBOX)
      .eq('inventory_item_supabase_id', item.supabase_id)
      .gt('expires_at', new Date().toISOString()),
    B.from('ticket_locks').insert({
      business_id: SANDBOX,
      inventory_item_supabase_id: item.supabase_id,
      device_id: devB, qty: 1,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
  ])
  const sawA = (look.data || []).some(r => r.device_id === devA)
  record('5. B sees A\'s active lock before ringing', sawA,
    `${look.data?.length || 0} locks visible to B`, sawA ? null : look)

  // Cleanup
  await A.from('ticket_locks').delete().in('device_id', [devA, devB])
}

// ============================================================================
// SCENARIO 6 — concurrent credit sale to same client
// Two terminals each post a 500 credit sale. Final balance must be 1000, not
// 500 (which would indicate last-writer-wins clobber on read-modify-write).
// Production path uses guarded UPDATE balance = balance + delta.
// ============================================================================
async function scenario6_creditSale() {
  const cli = await ensureTestClient()
  const delta = 500
  const bumpBalance = (c) => c.from('clients').update({
    balance: cli.balance + delta,   // simulates a NAIVE read-modify-write
  }).eq('id', cli.id)
  // First, run the naive path to demonstrate clobber risk:
  await Promise.all([bumpBalance(A), bumpBalance(B)])
  const { data: naive } = await A.from('clients').select('balance').eq('id', cli.id).single()
  const naiveLost = Number(naive.balance) === delta   // 500 instead of 1000 = clobber
  record('6a. naive read-modify-write on clients.balance is racy (informational)',
    !naiveLost, // pass if NOT lost (rare); fail = expected
    `final=${naive.balance} expected=${delta * 2} — ${naiveLost ? 'CLOBBER (use balance = balance + delta SQL pattern)' : 'no clobber observed this run'}`,
    null)

  // Reset and run the SAFE additive path:
  await A.from('clients').update({ balance: 0 }).eq('id', cli.id)
  // PostgREST doesn't support `balance = balance + X` via .update(), so use rpc-equivalent
  // via two parallel SQL via supabase functions.invoke? — not available. Use the
  // increment SQL via a one-shot RPC if present, else use parallel inserts on
  // credit_payments which is the production source-of-truth (balance is computed).
  const [pA, pB] = await Promise.all([
    A.from('credit_payments').insert({
      supabase_id: uid(), business_id: SANDBOX, client_id: cli.id, client_supabase_id: cli.supabase_id,
      amount: delta, payment_method: 'credito', ticket_ids: [],
    }),
    B.from('credit_payments').insert({
      supabase_id: uid(), business_id: SANDBOX, client_id: cli.id, client_supabase_id: cli.supabase_id,
      amount: delta, payment_method: 'credito', ticket_ids: [],
    }),
  ])
  const { data: payments } = await A.from('credit_payments').select('amount')
    .eq('business_id', SANDBOX).eq('client_id', cli.id)
  const total = (payments || []).reduce((s,r) => s + Number(r.amount), 0)
  const ok = total === delta * 2
  record('6b. concurrent credit_payments inserts (both rows persist)', ok,
    `sum=${total} expected=${delta*2}`,
    ok ? null : { pA: pA.error, pB: pB.error, payments })

  // cleanup
  await A.from('credit_payments').delete().eq('client_id', cli.id)
  await A.from('clients').update({ balance: 0 }).eq('id', cli.id)
}

// ============================================================================
// SCENARIO 7 — concurrent cuadre_caja open
// Two terminals open cuadre at the same instant. There must be exactly one
// open ('abierto') row per business/date — or the app has no DB-level guard
// (likely true today, since there's no unique partial index).
// ============================================================================
async function scenario7_cuadreOpen() {
  const d = today()
  // Clean ALL rows for sandbox+date so prior runs don't pollute.
  // (Demo tenant — destructive on demo is fine per CLAUDE.md.)
  await A.from('cuadre_caja').delete().eq('business_id', SANDBOX).eq('date', d)

  const open = (c, label) => c.from('cuadre_caja').insert({
    supabase_id: uid(), business_id: SANDBOX, date: d,
    status: 'abierto', opening_cash: 1000, opened_at: now(),
    fondo: 1000, comentario: 'DUAL E2E ' + label,
  }).select('id').single()
  const [oA, oB] = await Promise.all([open(A, 'A'), open(B, 'B')])

  // Use status='abierto' as the "open" predicate. closed_at has a DEFAULT
  // now() on this table so it is NEVER null at insert time — using
  // .is('closed_at', null) silently misses every open row. Pattern documented
  // here so the harness doesn't regress.
  const { data: openRows } = await A.from('cuadre_caja')
    .select('id, status, opened_at, closed_at, comentario')
    .eq('business_id', SANDBOX).eq('date', d).eq('status', 'abierto')
  const ok = (openRows?.length || 0) === 1
  record('7. concurrent cuadre open — exactly ONE row per (business,date)', ok,
    `${openRows?.length || 0} open rows`,
    ok ? null : { openRows, oA: oA.error || oA.data, oB: oB.error || oB.data })

  // cleanup
  await A.from('cuadre_caja').delete().eq('business_id', SANDBOX).eq('date', d)
}

// ============================================================================
// SCENARIO 8 — concurrent loyalty_award same client
// Both terminals award 50 pts to the same client. Final balance must be 100.
// ============================================================================
async function scenario8_loyaltyAccrual() {
  const cli = await ensureTestClient()
  const args = { p_business_id: SANDBOX, p_client_supabase_id: cli.supabase_id, p_ticket_supabase_id: null, p_points: 50, p_notes: 'DUAL E2E' }
  const [rA, rB] = await Promise.all([
    A.rpc('loyalty_award', args),
    B.rpc('loyalty_award', args),
  ])
  const { data: post } = await A.from('clients').select('loyalty_points').eq('id', cli.id).single()
  const expected = 100
  const ok = Number(post.loyalty_points) === expected
  record('8. concurrent loyalty_award accrual', ok,
    `final=${post.loyalty_points} expected=${expected}`,
    ok ? null : { rA: rA.error || rA.data, rB: rB.error || rB.data })

  // cleanup
  await A.from('loyalty_transactions').delete().eq('client_supabase_id', cli.supabase_id)
  await A.from('clients').update({ loyalty_points: 0, balance: 0 }).eq('id', cli.id)
}

async function runOnce(label) {
  console.log(`\n=== RUN ${label} — ${new Date().toLocaleTimeString()} ===\n`)
  const t0 = Date.now()
  await scenario1_inventoryRace()
  await scenario1b_rawUpdateLostWrite()
  await scenario2_ncfRace()
  await scenario3_ticketInsert()
  await scenario4_voidWhileRead()
  await scenario5_ticketLock()
  await scenario6_creditSale()
  await scenario7_cuadreOpen()
  await scenario8_loyaltyAccrual()
  const dt = Date.now() - t0
  console.log(`\n--- run ${label}: ${dt}ms ---`)
  return dt
}

async function main() {
  // Read-only shape probe on Ranoza so we know the schema we test under
  // matches the prod tenant.
  const { data: ran } = await A.from('businesses').select('name, settings').eq('id', RANOZA).single()
  console.log('Ranoza shape probe:', ran?.name, ran?.settings?.business_type)

  const t1 = await runOnce('1')
  // Reset counters for run 2
  results.length = 0; pass = 0; fail = 0
  const t2 = await runOnce('2')

  console.log(`\n=== SUMMARY ===`)
  console.log(`run 1: ${t1}ms | run 2: ${t2}ms`)
  console.log(`run 2: ${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('\nFailures:')
    for (const r of results.filter(r => !r.ok)) console.log(`  FAIL ${r.name} — ${r.detail}`)
    process.exit(1)
  }
}
main().catch(e => { console.error('CRASH:', e); process.exit(2) })
