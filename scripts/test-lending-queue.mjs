/**
 * test-lending-queue.mjs — H10 verification for the generic lending offline
 * write queue. Manual invocation (Node).
 *
 * Strategy:
 *   1. Polyfill IndexedDB (fake-indexeddb) and `navigator.onLine`.
 *   2. enqueue 5 distinct lending writes covering different tables/ops.
 *   3. peekLendingQueue → confirms 5 rows.
 *   4. Flip online + inject a fake supabase client that records every call.
 *   5. flushLendingQueue → confirms 5 dispatched calls, queue empty.
 *
 * Requires `fake-indexeddb` (devDependency). If not installed, the script
 * prints clear instructions and exits 0 so CI never goes red on a missing
 * optional dep — for full verification run:
 *   npm i -D fake-indexeddb
 *   node scripts/test-lending-queue.mjs
 *
 * You can also run this directly in browser DevTools by pasting the
 * `enqueueLendingWrite` calls — IndexedDB is real there.
 */

import { randomUUID } from 'node:crypto'

// ── Polyfill IDB ────────────────────────────────────────────────────────────
let fakeIdbOk = false
try {
  await import('fake-indexeddb/auto')
  fakeIdbOk = true
} catch {
  console.warn('[test-lending-queue] fake-indexeddb not installed — install with:')
  console.warn('  npm i -D fake-indexeddb')
  console.warn('Skipping (run in browser DevTools for full coverage).')
  process.exit(0)
}

// Polyfill navigator (Node 21+ exposes a read-only navigator getter; we
// install our own writable property so the test can flip onLine).
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false }, writable: true, configurable: true,
  })
} catch {
  if (!globalThis.navigator) globalThis.navigator = { onLine: false }
}
try {
  Object.defineProperty(globalThis, 'window', {
    value: { addEventListener() {}, removeEventListener() {} },
    writable: true, configurable: true,
  })
} catch {
  if (!globalThis.window) globalThis.window = { addEventListener() {}, removeEventListener() {} }
}
if (!globalThis.crypto) globalThis.crypto = { randomUUID }

// ── Import after polyfills ──────────────────────────────────────────────────
const { enqueueLendingWrite, peekLendingQueue, flushLendingQueue, isNetworkError, __resetLendingQueueForTests } =
  await import('../packages/data/lendingQueue.js')

let assertions = 0
function assert(cond, msg) {
  assertions++
  if (!cond) { console.error('[FAIL]', msg); process.exit(1) }
  console.log('[ok]  ', msg)
}

// ── 1. isNetworkError sanity ────────────────────────────────────────────────
assert(isNetworkError(new TypeError('Failed to fetch')),                      'TypeError fetch → network')
assert(isNetworkError({ name: 'AbortError', message: 'aborted' }),            'AbortError → network')
assert(isNetworkError({ message: 'connect ECONNRESET 10.0.0.1:443' }),        'ECONNRESET → network')
assert(isNetworkError({ message: 'request timeout after 60s' }),              'timeout → network')
assert(!isNetworkError({ message: 'duplicate key value violates unique' }),   'unique → NOT network')
assert(!isNetworkError({ message: 'new row violates row-level security' }),   'RLS → NOT network')

// ── 2. enqueue 5 different rows ─────────────────────────────────────────────
const biz = randomUUID()
const calls = [
  { table: 'loans',                op: 'rpc',    rpc_name: 'create_loan_with_schedule',
    payload: { supabase_id: randomUUID(), p_business_id: biz, p_loan: { principal: 1000 }, p_schedule: [] } },
  { table: 'loan_payments',        op: 'insert', payload: { supabase_id: randomUUID(), amount: 100, loan_id: 1 } },
  { table: 'pawn_items',           op: 'insert', payload: { supabase_id: randomUUID(), ticket_code: 'P260425ABCD' } },
  { table: 'pawn_listings',        op: 'insert', payload: { supabase_id: randomUUID(), list_price: 5000, slug: 'rolex' } },
  { table: 'collections_attempts', op: 'insert', payload: { supabase_id: randomUUID(), outcome: 'no_answer' } },
]

for (const c of calls) {
  await enqueueLendingWrite({ ...c, business_id: biz })
}

const peeked = await peekLendingQueue()
assert(peeked.length === 5, `peek returned ${peeked.length} rows (want 5)`)
assert(peeked.every(r => r.payload?.supabase_id), 'every row has payload.supabase_id')
assert(peeked[0].created_at <= peeked[4].created_at, 'peek is FIFO-ordered')

// ── 3. flush with a fake supabase ──────────────────────────────────────────
globalThis.navigator.onLine = true

const dispatched = []
const fakeSupabase = {
  rpc(name, args) {
    dispatched.push({ kind: 'rpc', name, args })
    return Promise.resolve({ data: args.p_loan?.supabase_id || true, error: null })
  },
  from(table) {
    const ctx = { table, op: null, payload: null, _filters: [] }
    const chain = {
      upsert(payload) { ctx.op = 'upsert'; ctx.payload = payload; return chain },
      update(payload) { ctx.op = 'update'; ctx.payload = payload; return chain },
      delete()        { ctx.op = 'delete'; return chain },
      eq(c, v)        { ctx._filters.push([c, v]); return chain },
      select()        { return chain },
      then(resolve)   { dispatched.push({ kind: 'sql', ...ctx }); resolve({ data: [], error: null }); return chain },
    }
    return chain
  },
}

const result = await flushLendingQueue(fakeSupabase)
assert(result.sent === 5, `flush sent ${result.sent} (want 5)`)
assert(result.failed === 0, 'no failures')
assert(result.deferred === 0, 'no deferrals')

const after = await peekLendingQueue()
assert(after.length === 0, `queue empty after flush (got ${after.length})`)

assert(dispatched.length === 5, `dispatched ${dispatched.length} (want 5)`)
assert(dispatched.filter(d => d.kind === 'rpc').length === 1, 'exactly 1 RPC dispatched')
assert(dispatched.filter(d => d.kind === 'sql').length === 4, 'exactly 4 SQL dispatched')

console.log(`\n[test-lending-queue] PASS — ${assertions} assertions in ${dispatched.length} dispatches`)
__resetLendingQueueForTests()
process.exit(0)
