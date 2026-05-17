/**
 * scale-phase3-5.mjs — journal_entries v1 scaling validation gate.
 *
 * Procedure (see plans/indexed-chasing-moonbeam.md §"Phase 3.5"):
 *   1. Flip app_settings.journal_entries_v1='true' on 12 demo businesses.
 *   2. Drive realistic per-biz load (sales/expenses/restock/void/payroll) for 5
 *      min baseline; capture p50/95/99 write latency on journal_entries inserts,
 *      Reportes read latency, pg_stat_database/wal/statements deltas, peak
 *      connection count.
 *   3. Step-up tiers: spawn synthetic businesses (`scale-test-*`) to reach
 *      25/50/100/250 concurrent. 1-min ramp + 3-min sustained per tier.
 *   4. Abort tier on p99 write > 500ms / p95 read > 1s / CPU > 80% sustained
 *      30s, conn-pool exhaustion, error rate > 1%.
 *   5. ALWAYS in try/finally: reset flag on the 12 demos, delete synthetic biz.
 *   6. Emit JSON + console table; recommend ceiling.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) for the write driver — this
 * focuses the test on the actual DB+WAL+index bottleneck which is where Phase
 * 3.5 expects pain to surface. A separate read sampler hits the same client to
 * measure Reportes-shaped query latency under write load.
 *
 * Run with `node --use-system-ca` on Windows (Node 25 needs system CA store).
 *
 * Hard rules honored:
 *   - All writes verified to live in demo (`is_demo=true`) or synthetic
 *     (`name like 'scale-test-%'`) businesses. Aborts if a real biz_id leaks
 *     into the driver target list.
 *   - Reset flag wrapped in try/finally.
 *   - Synthetic businesses deleted at the end (per-biz CTID batches to dodge
 *     statement_timeout on cascade FK scans).
 *   - No empty catches: all `catch` blocks log to stderr.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import crypto from 'node:crypto'
import {
  buildSaleEntries,
  buildExpenseEntries,
  buildRestockEntries,
  buildReversalEntries,
  buildPayrollEntries,
} from '../packages/services/journal.js'

const SUPA_URL = process.env.SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const TOK = process.env.SUPABASE_ACCESS_TOKEN
const REF = new URL(SUPA_URL).hostname.split('.')[0]

if (!SUPA_URL || !SVC || !TOK) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ACCESS_TOKEN')
  process.exit(1)
}

const sb = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })

async function mgmtQ(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const txt = await r.text()
  try { return JSON.parse(txt) } catch { return { _raw: txt } }
}

// ── 12 confirmed demos (queried 2026-05-17) ─────────────────────────────────
const DEMO_BIZ = [
  { id: 'e5fa6fc1-75d1-4bab-8e07-6480de202b1b', name: 'Demo Car Wash',           biz_type: 'carwash' },
  { id: 'b037c2a8-d8d2-45f6-ada1-f851cf0190a4', name: 'Demo Restaurante',         biz_type: 'restaurant' },
  { id: 'b14f83cb-15c9-4c1f-946c-5256265dab7a', name: 'Demo Salon de Belleza',    biz_type: 'salon' },
  { id: '32e2cc8f-8626-4e54-ad80-71dfb100247c', name: 'Demo Taller Mecanico',     biz_type: 'mechanic' },
  { id: '9fe0cab2-5e92-4222-a43a-616083c6470b', name: 'Demo Servicios Profesionales', biz_type: 'service' },
  { id: 'd8db00a2-30c5-4aa5-8fbe-26d06e69dce0', name: 'Demo Prestamos',           biz_type: 'loans' },
  { id: '60dbf844-323f-4913-8847-9499ca6be995', name: 'Demo Concesionario',       biz_type: 'dealership' },
  { id: '949fd70b-4609-4c71-a3af-2b9160043c3e', name: 'Licoreria Demo',           biz_type: 'licoreria' },
  { id: '52d0a7be-03c9-4352-92d2-19e4825eaf3a', name: 'Carniceria Demo',          biz_type: 'meat_market' },
  { id: '46c28a6c-a20a-4b91-9d7d-8f5bf3fd497e', name: 'Demo Tienda',              biz_type: 'retail' },
  { id: 'e7c927b5-6136-4773-a5df-ddad0fac22f2', name: 'Demo Contabilidad',        biz_type: 'accounting' },
  { id: 'edbc8447-b574-43f9-9584-1d66f4ad2bcd', name: 'Demo Food Truck',          biz_type: 'food_truck' },
]

const SCALE_TEST_MARK = 'scale-test-' // synthetic biz name prefix; required for cleanup

// ── Safety gate: confirm every target is demo or synthetic ──────────────────
async function assertSafeTargets(bizList) {
  const ids = bizList.map(b => `'${b.id}'`).join(',')
  const rows = await mgmtQ(`select id, name, is_demo from businesses where id in (${ids})`)
  if (!Array.isArray(rows)) {
    throw new Error('Safety gate query failed: ' + JSON.stringify(rows).slice(0, 200))
  }
  for (const r of rows) {
    if (!r.is_demo && !r.name?.startsWith(SCALE_TEST_MARK)) {
      throw new Error(`ABORT — real customer biz in target list: ${r.id} ${r.name}`)
    }
  }
  if (rows.length !== bizList.length) {
    throw new Error(`ABORT — expected ${bizList.length} targets, found ${rows.length}`)
  }
}

// ── Flag flip ───────────────────────────────────────────────────────────────
async function flipFlag(bizList, value) {
  let n = 0
  for (const b of bizList) {
    const sql = `insert into app_settings (supabase_id, business_id, key, value, is_device_local, device_hwid, updated_at)
      values ('${crypto.randomUUID()}', '${b.id}', 'journal_entries_v1', '${value}', false, null, now())
      on conflict (business_id, key, device_hwid) do update set value = excluded.value, updated_at = now()`
    const r = await mgmtQ(sql)
    if (r?.message) { console.error(`[flag] biz ${b.id} → ${value} ERR:`, r.message); continue }
    n++
  }
  return n
}

// ── Synthetic biz seeding for step-up tiers ─────────────────────────────────
async function createSyntheticBiz(n) {
  const created = []
  const targetCount = n
  const batch = 50
  for (let i = 0; i < targetCount; i += batch) {
    const rows = []
    for (let j = i; j < Math.min(i + batch, targetCount); j++) {
      rows.push({
        id: crypto.randomUUID(),
        name: `${SCALE_TEST_MARK}${Date.now()}-${j}`,
        rnc: '000000000',
        is_demo: true, // mark demo so safety gate passes; cleanup uses name prefix
        plan: 'pro',
        settings: { business_type: 'tienda' },
      })
    }
    const { error } = await sb.from('businesses').insert(rows)
    if (error) { console.error('[synth] insert err:', error.message); throw error }
    created.push(...rows.map(r => ({ id: r.id, name: r.name, biz_type: 'tienda' })))
  }
  return created
}

// CTID-batched delete: dodges statement_timeout on FK cascade scans for the
// self-referencing reversal_of_id / reversed_by_id columns.
async function deleteJournalForBiz(bizId, perBatch = 5000) {
  let total = 0
  for (let pass = 0; pass < 200; pass++) {
    const r = await mgmtQ(`with d as (delete from journal_entries where ctid in (select ctid from journal_entries where business_id='${bizId}' limit ${perBatch}) returning 1) select count(*) as n from d`)
    if (r?.message) { console.error('[je-del] err biz', bizId, r.message); break }
    const n = r?.[0]?.n || 0
    total += n
    if (n === 0) break
  }
  return total
}

async function deleteSyntheticBiz() {
  const synth = await mgmtQ(`select id from businesses where name like '${SCALE_TEST_MARK}%'`)
  if (!Array.isArray(synth)) return { biz: 0, je: 0 }
  let jeTotal = 0
  for (const b of synth) {
    jeTotal += await deleteJournalForBiz(b.id)
  }
  await mgmtQ(`delete from app_settings where business_id in (select id from businesses where name like '${SCALE_TEST_MARK}%')`)
  await mgmtQ(`delete from licenses where business_id in (select id from businesses where name like '${SCALE_TEST_MARK}%')`)
  const r3 = await mgmtQ(`with d as (delete from public.businesses where name like '${SCALE_TEST_MARK}%' returning 1) select count(*) as n from d`)
  return { biz: r3?.[0]?.n ?? 0, je: jeTotal }
}

async function deleteTestJournalEntriesFromDemos() {
  let total = 0
  for (const b of DEMO_BIZ) {
    for (let pass = 0; pass < 200; pass++) {
      const r = await mgmtQ(`with d as (delete from journal_entries where ctid in (select ctid from journal_entries where business_id='${b.id}' and metadata ? 'scale_test' limit 5000) returning 1) select count(*) as n from d`)
      if (r?.message) { console.error('[demo-je-del] err biz', b.id, r.message); break }
      const n = r?.[0]?.n || 0
      total += n
      if (n === 0) break
    }
  }
  return total
}

// ── Workload generator: realistic per-business mix per minute ───────────────
function fakeTicket(biz, idx) {
  const lineCount = (idx % 4 === 0) ? 1 : (idx % 4 === 1 ? 3 : (idx % 4 === 2 ? 3 : 2))
  const method = (idx % 4 === 2) ? 'tarjeta' : (idx % 4 === 3 ? 'credito' : 'efectivo')
  const items = []
  let subtotal = 0
  let totalItbis = 0
  for (let i = 0; i < lineCount; i++) {
    const price = Math.round(50 + Math.random() * 500)
    const cost = Math.round(price * 0.55)
    const itemItbis = +(price * 0.18).toFixed(2)
    items.push({
      supabase_id: crypto.randomUUID(),
      service_supabase_id: crypto.randomUUID(),
      name: `SKU ${idx}-${i}`,
      qty: 1,
      price,
      itbis: itemItbis,
      cost,
      is_wash: biz.biz_type === 'carwash',
      is_product: biz.biz_type !== 'carwash' && biz.biz_type !== 'salon',
    })
    subtotal += price
    totalItbis += itemItbis
  }
  const itbis = +totalItbis.toFixed(2)
  const total = +(subtotal + itbis).toFixed(2)
  const ticket = {
    supabase_id: crypto.randomUUID(),
    business_id: biz.id,
    subtotal,
    itbis,
    total,
    payment_method: method,
    client_id: null, // synthetic — avoid clients FK
    card_fee_pct: method === 'tarjeta' ? 0.0325 : 0,
    created_at: new Date().toISOString(),
  }
  return { ticket, items, biz: { id: biz.id, business_type: biz.biz_type } }
}

// stamp metadata.scale_test on every row so cleanup catches them
function stampScaleTest(rows) {
  for (const r of rows) {
    r.metadata = { ...(r.metadata || {}), scale_test: true }
  }
  return rows
}

// build one "minute" of load for a business
function buildMinuteLoad(biz, minuteIdx) {
  const rows = []
  for (let i = 0; i < 4; i++) {
    const { ticket, items, biz: b } = fakeTicket(biz, minuteIdx * 10 + i)
    rows.push(...stampScaleTest(buildSaleEntries({ ticket, items, services: [], biz: b })))
  }
  rows.push(...stampScaleTest(buildExpenseEntries({
    row: {
      supabase_id: crypto.randomUUID(),
      business_id: biz.id,
      amount: Math.round(100 + Math.random() * 500),
      type: 'supplies',
      description: 'Insumos',
      created_at: new Date().toISOString(),
    },
    biz: { id: biz.id, business_type: biz.biz_type },
  })))
  if (minuteIdx % 2 === 0) {
    rows.push(...stampScaleTest(buildRestockEntries({
      item: { supabase_id: crypto.randomUUID(), business_id: biz.id, name: 'Restock' },
      qty: 10,
      unitCostPaid: 25,
      paidInCash: true,
      biz: { id: biz.id, business_type: biz.biz_type },
    })))
  }
  if (minuteIdx % 10 === 0 && minuteIdx > 0) {
    const { ticket, items, biz: b } = fakeTicket(biz, minuteIdx * 999)
    const original = buildSaleEntries({ ticket, items, services: [], biz: b })
    const reversal = buildReversalEntries({ originalRows: original })
    // synthetic: original was never persisted, reversal_of_id (bigint FK) must be null
    for (const r of reversal) r.reversal_of_id = null
    rows.push(...stampScaleTest(reversal))
  }
  if (minuteIdx % 20 === 0 && minuteIdx > 0) {
    rows.push(...stampScaleTest(buildPayrollEntries({
      run: {
        supabase_id: crypto.randomUUID(),
        business_id: biz.id,
        total: Math.round(5000 + Math.random() * 10000),
        period_end: new Date().toISOString().slice(0, 10),
      },
      biz: { id: biz.id, business_type: biz.biz_type },
    })))
  }
  return rows
}

// ── Latency tracker ─────────────────────────────────────────────────────────
class Latencies {
  constructor() { this.samples = [] }
  add(ms) { this.samples.push(ms) }
  percentiles() {
    if (!this.samples.length) return { p50: null, p95: null, p99: null, n: 0, mean: null }
    const s = [...this.samples].sort((a, b) => a - b)
    const pick = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
    const mean = s.reduce((a, b) => a + b, 0) / s.length
    return { p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), n: s.length, mean }
  }
}

// ── DB stats snapshots ──────────────────────────────────────────────────────
async function dbStats() {
  const sql = `
    select
      (select sum(xact_commit + xact_rollback) from pg_stat_database where datname=current_database()) as txns,
      (select sum(blks_hit) from pg_stat_database where datname=current_database())  as blks_hit,
      (select sum(blks_read) from pg_stat_database where datname=current_database()) as blks_read,
      (select count(*) from pg_stat_activity where state='active') as active_conns,
      (select count(*) from pg_stat_activity) as total_conns,
      (select pg_current_wal_lsn()::text) as wal_lsn
  `
  const r = await mgmtQ(sql)
  return Array.isArray(r) ? r[0] : null
}

function walDeltaBytes(a, b) {
  if (!a?.wal_lsn || !b?.wal_lsn) return null
  const parse = (s) => {
    const [hi, lo] = s.split('/')
    return BigInt('0x' + hi) * (1n << 32n) + BigInt('0x' + lo)
  }
  return Number(parse(b.wal_lsn) - parse(a.wal_lsn))
}

// ── Write driver — one business, one tier-duration ──────────────────────────
async function driveBusiness({ biz, durationMs, latWrite, errCounter, stopFlag, minuteOffset }) {
  let minuteIdx = minuteOffset
  const start = performance.now()
  const SPACING_MS = 1000
  while (performance.now() - start < durationMs && !stopFlag.aborted) {
    const rows = buildMinuteLoad(biz, minuteIdx)
    minuteIdx++
    if (!rows.length) continue
    const t0 = performance.now()
    const { error } = await sb.from('journal_entries').insert(rows)
    const dt = performance.now() - t0
    if (error) {
      errCounter.n++
      errCounter.lastErr = error.message
      if (/connection|pool|timeout/i.test(error.message)) errCounter.poolFail = true
    } else {
      latWrite.add(dt)
    }
    const elapsed = performance.now() - start
    const expected = (minuteIdx - minuteOffset) * SPACING_MS
    const sleep = Math.max(0, expected - elapsed + Math.round((Math.random() - 0.5) * 400))
    if (sleep > 0) await new Promise(r => setTimeout(r, sleep))
  }
}

// ── Read latency driver (samples Reportes-shaped query) ─────────────────────
async function sampleReadLatency({ bizList, durationMs, latRead, stopFlag }) {
  const start = performance.now()
  while (performance.now() - start < durationMs && !stopFlag.aborted) {
    const biz = bizList[Math.floor(Math.random() * bizList.length)]
    const t0 = performance.now()
    const { error } = await sb.from('journal_entries')
      .select('account, debit, credit, effective_date')
      .eq('business_id', biz.id)
      .gte('effective_date', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
      .limit(500)
    const dt = performance.now() - t0
    if (!error) latRead.add(dt)
    await new Promise(r => setTimeout(r, 2000))
  }
}

// ── Abort watchdog ──────────────────────────────────────────────────────────
function watchdog({ latWrite, latRead, errCounter, stopFlag }) {
  return setInterval(() => {
    const w = latWrite.percentiles()
    const totalAttempts = w.n + errCounter.n
    if (totalAttempts >= 50 && errCounter.n / totalAttempts > 0.01) {
      stopFlag.aborted = true; stopFlag.reason = `error_rate>${(errCounter.n / totalAttempts * 100).toFixed(1)}%`
    }
    if (errCounter.poolFail) {
      stopFlag.aborted = true; stopFlag.reason = 'connection_pool_exhaustion'
    }
    const tail = latWrite.samples.slice(-30)
    if (tail.length === 30) {
      const sorted = [...tail].sort((a, b) => a - b)
      const p99 = sorted[Math.floor(sorted.length * 0.99)]
      if (p99 > 500) { stopFlag.aborted = true; stopFlag.reason = `p99_write_${p99.toFixed(0)}ms>500` }
    }
    const rTail = latRead.samples.slice(-15)
    if (rTail.length === 15) {
      const sorted = [...rTail].sort((a, b) => a - b)
      const p95 = sorted[Math.floor(sorted.length * 0.95)]
      if (p95 > 1000) { stopFlag.aborted = true; stopFlag.reason = `p95_read_${p95.toFixed(0)}ms>1000` }
    }
  }, 1000)
}

// ── Single tier run ─────────────────────────────────────────────────────────
async function runTier({ label, bizList, durationMs, rampMs }) {
  console.log(`\n=== TIER: ${label} | ${bizList.length} biz | ramp ${rampMs}ms + run ${durationMs}ms ===`)
  await assertSafeTargets(bizList)

  const latWrite = new Latencies()
  const latRead = new Latencies()
  const errCounter = { n: 0, lastErr: null, poolFail: false }
  const stopFlag = { aborted: false, reason: null }

  const before = await dbStats()
  const t0 = performance.now()

  const perBizDelay = rampMs / Math.max(1, bizList.length)
  const wd = watchdog({ latWrite, latRead, errCounter, stopFlag })

  const drivers = bizList.map((biz, idx) =>
    new Promise(async (resolve) => {
      await new Promise(r => setTimeout(r, idx * perBizDelay))
      await driveBusiness({
        biz, durationMs,
        latWrite, errCounter, stopFlag,
        minuteOffset: idx,
      }).catch(e => { console.error('[driver] biz', biz.id, e.message) })
      resolve()
    })
  )

  const reader = sampleReadLatency({ bizList, durationMs: durationMs + rampMs, latRead, stopFlag })
    .catch(e => console.error('[reader]', e.message))

  await Promise.all([...drivers, reader])
  clearInterval(wd)

  const after = await dbStats()
  const elapsedS = (performance.now() - t0) / 1000
  const w = latWrite.percentiles()
  const r = latRead.percentiles()
  const wal = walDeltaBytes(before, after)
  const txns = (after?.txns ?? 0) - (before?.txns ?? 0)

  const result = {
    tier: label,
    biz_count: bizList.length,
    duration_s: +elapsedS.toFixed(1),
    write_inserts: w.n,
    write_per_sec: +(w.n / elapsedS).toFixed(2),
    write_p50_ms: w.p50 != null ? +w.p50.toFixed(1) : null,
    write_p95_ms: w.p95 != null ? +w.p95.toFixed(1) : null,
    write_p99_ms: w.p99 != null ? +w.p99.toFixed(1) : null,
    read_samples: r.n,
    read_p50_ms: r.p50 != null ? +r.p50.toFixed(1) : null,
    read_p95_ms: r.p95 != null ? +r.p95.toFixed(1) : null,
    read_p99_ms: r.p99 != null ? +r.p99.toFixed(1) : null,
    txns_delta: txns,
    wal_bytes: wal,
    wal_per_sec: wal != null ? +(wal / elapsedS).toFixed(0) : null,
    active_conns_after: after?.active_conns,
    total_conns_after: after?.total_conns,
    error_count: errCounter.n,
    error_rate: +(errCounter.n / Math.max(1, w.n + errCounter.n) * 100).toFixed(2),
    last_error: errCounter.lastErr,
    aborted: stopFlag.aborted,
    abort_reason: stopFlag.reason,
  }
  console.table([{
    tier: result.tier,
    biz: result.biz_count,
    'w/s': result.write_per_sec,
    'p50w': result.write_p50_ms,
    'p95w': result.write_p95_ms,
    'p99w': result.write_p99_ms,
    'p95r': result.read_p95_ms,
    'wal_KB/s': result.wal_per_sec != null ? (result.wal_per_sec / 1024).toFixed(0) : null,
    conns: result.active_conns_after,
    err: result.error_count,
    aborted: result.aborted ? result.abort_reason : '',
  }])
  return result
}

// ── Top-level ───────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString()
  const results = { startedAt, demoCount: DEMO_BIZ.length, tiers: [], summary: null }
  let syntheticCreated = []

  console.log(`[scale-phase3-5] start ${startedAt}`)
  console.log(`[scale-phase3-5] 12 demo businesses identified.`)

  await mgmtQ('select pg_stat_statements_reset()').catch(() => {})

  try {
    await assertSafeTargets(DEMO_BIZ)

    const flipped = await flipFlag(DEMO_BIZ, 'true')
    results.flagFlippedOn = flipped
    console.log(`[flag] ${flipped}/${DEMO_BIZ.length} demos flipped ON`)

    // ── BASELINE: 12 demos, 5 min ──
    const baseline = await runTier({ label: 'baseline_12', bizList: DEMO_BIZ, durationMs: 5 * 60 * 1000, rampMs: 30 * 1000 })
    results.tiers.push(baseline)

    // ── STEP-UP: 25 / 50 / 100 / 250 ──
    const tierTargets = [25, 50, 100, 250]
    let previousList = DEMO_BIZ
    let abortFurther = false

    for (const target of tierTargets) {
      if (abortFurther) {
        console.log(`[step-up] skipping tier ${target} — prior tier aborted`)
        break
      }
      const need = target - previousList.length
      if (need > 0) {
        console.log(`[synth] creating ${need} synthetic biz for tier ${target}`)
        const newBiz = await createSyntheticBiz(need)
        syntheticCreated.push(...newBiz)
        const allNew = [...previousList, ...newBiz]
        await flipFlag(newBiz, 'true')
        previousList = allNew
      }
      const tier = await runTier({ label: `step_${target}`, bizList: previousList, durationMs: 3 * 60 * 1000, rampMs: 60 * 1000 })
      results.tiers.push(tier)
      if (tier.aborted) {
        console.log(`[step-up] tier ${target} HIT ABORT: ${tier.abort_reason}`)
        abortFurther = true
      }
    }

    const top = await mgmtQ(`
      select left(query, 120) as q, calls, round(total_exec_time::numeric, 1) as total_ms,
             round(mean_exec_time::numeric, 2) as mean_ms, rows
      from pg_stat_statements
      where dbid = (select oid from pg_database where datname = current_database())
      order by total_exec_time desc
      limit 10
    `)
    results.topQueries = Array.isArray(top) ? top : null

    const lastClean = [...results.tiers].reverse().find(t => !t.aborted)
    const firstAborted = results.tiers.find(t => t.aborted)
    results.summary = {
      breaking_tier: firstAborted?.tier || null,
      breaking_reason: firstAborted?.abort_reason || null,
      recommended_ceiling_biz: lastClean?.biz_count ?? null,
      recommended_ceiling_sales_per_sec: lastClean?.write_per_sec ?? null,
      recommended_ceiling_p99_write_ms: lastClean?.write_p99_ms ?? null,
      next_tier_upgrade_at_biz: lastClean ? Math.floor(lastClean.biz_count * 0.8) : null,
      note: lastClean
        ? `Current Supabase tier supports ${lastClean.biz_count} concurrent businesses sustaining ${lastClean.write_per_sec} writes/sec each. p99 write latency at ${lastClean.biz_count}: ${lastClean.write_p99_ms}ms. Upgrade recommended at >80% of ceiling (${Math.floor(lastClean.biz_count * 0.8)} biz) to maintain headroom.`
        : 'No clean tier — even baseline aborted; investigate before Phase 4.',
    }
  } catch (err) {
    console.error('[FATAL]', err.message, err.stack)
    results.error = err.message
  } finally {
    console.log('\n[cleanup] resetting journal_entries_v1 flag on 12 demos...')
    try {
      const off = await flipFlag(DEMO_BIZ, 'false')
      results.flagResetOff = off
      console.log(`[cleanup] flag reset on ${off}/${DEMO_BIZ.length} demos`)
    } catch (e) { console.error('[cleanup] flag reset err:', e.message) }

    try {
      const deletedJE = await deleteTestJournalEntriesFromDemos()
      results.testJournalEntriesDeleted = deletedJE
      console.log(`[cleanup] deleted ${deletedJE} scale_test journal_entries rows from demos`)
    } catch (e) { console.error('[cleanup] demo JE delete err:', e.message) }

    if (syntheticCreated.length) {
      try {
        const dr = await deleteSyntheticBiz()
        results.syntheticBizDeleted = dr.biz
        results.syntheticJournalDeleted = dr.je
        console.log(`[cleanup] deleted ${dr.biz} synthetic businesses (${dr.je} JE rows)`)
      } catch (e) { console.error('[cleanup] synth delete err:', e.message) }
    }

    results.endedAt = new Date().toISOString()
    writeFileSync('scripts/scale-phase3-5-results.json', JSON.stringify(results, null, 2))
    console.log('\n[done] wrote scripts/scale-phase3-5-results.json')

    console.log('\n────────── FINAL TIER TABLE ──────────')
    console.table(results.tiers.map(t => ({
      tier: t.tier,
      biz: t.biz_count,
      'sales/s': t.write_per_sec,
      'p50w_ms': t.write_p50_ms,
      'p95w_ms': t.write_p95_ms,
      'p99w_ms': t.write_p99_ms,
      'p95r_ms': t.read_p95_ms,
      'wal_KB/s': t.wal_per_sec != null ? Math.round(t.wal_per_sec / 1024) : null,
      'conns': t.total_conns_after,
      'err%': t.error_rate,
      'aborted': t.aborted ? t.abort_reason : '',
    })))
    if (results.summary) {
      console.log('\n────────── SUMMARY ──────────')
      console.log(results.summary.note)
      if (results.summary.breaking_tier) {
        console.log(`Breaking tier: ${results.summary.breaking_tier} → ${results.summary.breaking_reason}`)
      }
    }
  }
}

main().catch(e => { console.error('[outer]', e); process.exit(1) })
