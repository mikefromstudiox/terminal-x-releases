#!/usr/bin/env node
// Recomputes clients.balance from the actual ledger (pending credit tickets
// minus applied credit_payments) and corrects any drift in-place.
//
// Runs against Supabase via the Management API. Dry-run by default.
//
// Usage:
//   node scripts/recompute-client-balances.mjs [--business-id <uuid>] [--apply]
//
// If --business-id is omitted, the script recomputes across ALL businesses
// and prints per-business diff counts before writing.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function parseEnv(file) {
  const txt = fs.readFileSync(file, 'utf8')
  const out = {}
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return out
}

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const bidIdx = argv.indexOf('--business-id')
const ONLY_BID = bidIdx >= 0 ? argv[bidIdx + 1] : null

const ENV = parseEnv(path.join(ROOT, '.env'))
const SB_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL
const TOKEN = ENV.SUPABASE_ACCESS_TOKEN
if (!SB_URL || !TOKEN) { console.error('Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const ref = new URL(SB_URL).hostname.split('.')[0]

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const text = await r.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  return body
}

// Compute real balance per client, using NET ticket amount (total - descuento)
// for pending credit tickets minus applied credit_payments. Supabase tickets
// table joins clients via supabase_id (no client_id FK on tickets).
const where = ONLY_BID ? `WHERE c.business_id = '${ONLY_BID}'` : ''
const diffSql = `
WITH ticket_sum AS (
  SELECT t.client_supabase_id AS client_sid,
         SUM(GREATEST(0, COALESCE(t.total,0) - COALESCE(t.descuento,0))) AS pending_owed
    FROM tickets t
   WHERE t.tipo_venta = 'credito'
     AND t.status = 'pendiente'
     AND t.client_supabase_id IS NOT NULL
   GROUP BY t.client_supabase_id
),
payment_sum AS (
  SELECT client_supabase_id AS client_sid, SUM(amount) AS paid
    FROM credit_payments
   WHERE client_supabase_id IS NOT NULL
   GROUP BY client_supabase_id
)
SELECT c.id, c.supabase_id, c.business_id, c.name, c.balance AS current_balance,
       GREATEST(0, COALESCE(ts.pending_owed, 0) - COALESCE(ps.paid, 0)) AS real_balance
  FROM clients c
  LEFT JOIN ticket_sum  ts ON ts.client_sid = c.supabase_id
  LEFT JOIN payment_sum ps ON ps.client_sid = c.supabase_id
  ${where}
  ${where ? 'AND' : 'WHERE'} ROUND(CAST(c.balance AS numeric), 2) <> ROUND(CAST(GREATEST(0, COALESCE(ts.pending_owed, 0) - COALESCE(ps.paid, 0)) AS numeric), 2)
  ORDER BY c.business_id, ABS(c.balance - GREATEST(0, COALESCE(ts.pending_owed, 0) - COALESCE(ps.paid, 0))) DESC
`

console.log(`\n=== Recompute client balances ===`)
console.log(`  mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
console.log(`  scope: ${ONLY_BID || 'ALL businesses'}`)
const rows = await q(diffSql)
console.log(`  drifted clients: ${rows.length}`)
if (!rows.length) {
  console.log('\nAll balances reconcile. Nothing to do.\n')
  process.exit(0)
}

const byBiz = {}
for (const r of rows) {
  byBiz[r.business_id] = byBiz[r.business_id] || { count: 0, delta: 0 }
  byBiz[r.business_id].count++
  byBiz[r.business_id].delta += Number(r.current_balance || 0) - Number(r.real_balance || 0)
}
console.log('\nPer-business drift:')
for (const [bid, s] of Object.entries(byBiz)) {
  console.log(`  ${bid}  —  ${s.count} clients, net over-charge RD$${s.delta.toFixed(2)}`)
}

console.log('\nTop 10 deltas:')
for (const r of rows.slice(0, 10)) {
  console.log(`  ${r.name?.slice(0,40).padEnd(40)}  current=${Number(r.current_balance).toFixed(2)}  real=${Number(r.real_balance).toFixed(2)}  delta=${(Number(r.current_balance) - Number(r.real_balance)).toFixed(2)}`)
}

if (!APPLY) {
  console.log('\n[dry-run] No writes. Re-run with --apply to correct the drift.')
  process.exit(0)
}

console.log('\nApplying corrections...')
const applySql = `
WITH ticket_sum AS (
  SELECT t.client_supabase_id AS client_sid,
         SUM(GREATEST(0, COALESCE(t.total,0) - COALESCE(t.descuento,0))) AS pending_owed
    FROM tickets t
   WHERE t.tipo_venta = 'credito' AND t.status = 'pendiente' AND t.client_supabase_id IS NOT NULL
   GROUP BY t.client_supabase_id
),
payment_sum AS (
  SELECT client_supabase_id AS client_sid, SUM(amount) AS paid FROM credit_payments WHERE client_supabase_id IS NOT NULL GROUP BY client_supabase_id
),
derived AS (
  SELECT c.id AS client_id,
         GREATEST(0, COALESCE(ts.pending_owed, 0) - COALESCE(ps.paid, 0)) AS real_balance
    FROM clients c
    LEFT JOIN ticket_sum ts ON ts.client_sid = c.supabase_id
    LEFT JOIN payment_sum ps ON ps.client_sid = c.supabase_id
   ${where}
)
UPDATE clients c
   SET balance = d.real_balance, updated_at = NOW()
  FROM derived d
 WHERE c.id = d.client_id
   AND ROUND(CAST(c.balance AS numeric), 2) <> ROUND(CAST(d.real_balance AS numeric), 2)
`
await q(applySql)
console.log('Done. Verifying...')
const after = await q(diffSql)
console.log(`  remaining drift: ${after.length}`)
