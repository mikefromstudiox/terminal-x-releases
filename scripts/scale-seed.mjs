/**
 * scale-seed.mjs — synthetic ticket load for performance probing.
 *
 * Generates N tickets + ~3N ticket_items + ~N×0.4 commission rows into a
 * target business spread across the past 12 months so partition / index
 * planners see realistic time distribution. Marks every row is_test=true
 * so the cleanup pass deletes them safely without touching real data.
 *
 * Usage:
 *   TICKETS=200000 BUSINESS_ID=<uuid> node scripts/scale-seed.mjs
 *   node scripts/scale-seed.mjs --cleanup           (deletes is_test=true rows)
 *   node scripts/scale-seed.mjs --measure           (runs EXPLAIN ANALYZE)
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY — bypasses RLS, sets is_test flag.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const SUPA_URL = process.env.SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const TOK = process.env.SUPABASE_ACCESS_TOKEN

const TICKETS = Number(process.env.TICKETS) || 200_000
const BID = process.env.BUSINESS_ID || '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79' // STUDIO X SRL
const BATCH = 500   // PostgREST request size
const ITEMS_PER_TICKET = 3
const REF = new URL(SUPA_URL).hostname.split('.')[0]

const sb = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })

async function mgmtQ(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  return r.json()
}

const PAYMENTS = ['efectivo', 'tarjeta', 'transferencia']
const STATUSES = ['cobrado', 'cobrado', 'cobrado', 'cobrado', 'pendiente', 'nula'] // weighted

function ticketRow(now, idx) {
  const sid = crypto.randomUUID()
  const subtotal = Math.round(Math.random() * 500000) / 100
  const itbis = +(subtotal * 0.18).toFixed(2)
  const total = +(subtotal + itbis).toFixed(2)
  return {
    id: crypto.randomUUID(),
    supabase_id: sid,
    business_id: BID,
    legacy_code: `TX-${idx}`,
    subtotal,
    itbis,
    total,
    payment_method: PAYMENTS[idx % PAYMENTS.length],
    status: STATUSES[idx % STATUSES.length],
    is_test: true,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    paid_at: STATUSES[idx % STATUSES.length] === 'cobrado' ? now.toISOString() : null,
    rev: 1,
  }
}

function itemRow(ticket, idx) {
  const price = +(Math.random() * 1000).toFixed(2)
  return {
    id: crypto.randomUUID(),
    supabase_id: crypto.randomUUID(),
    business_id: BID,
    ticket_id: ticket.id,
    ticket_supabase_id: ticket.supabase_id,
    name: `Test Item ${idx}`,
    price,
    cost: +(price * 0.5).toFixed(2),
    itbis: +(price * 0.18).toFixed(2),
    quantity: 1 + (idx % 3),
    is_wash: false,
    created_at: ticket.created_at,
  }
}

async function seed() {
  console.log(`[seed] target ${TICKETS} tickets into business ${BID}`)
  const start = Date.now()
  let done = 0

  while (done < TICKETS) {
    const sliceSize = Math.min(BATCH, TICKETS - done)
    const tickets = []
    for (let i = 0; i < sliceSize; i++) {
      // distribute over past 365 days
      const ageDays = Math.random() * 365
      const created = new Date(Date.now() - ageDays * 86400_000)
      tickets.push(ticketRow(created, done + i))
    }

    const { error: tErr } = await sb.from('tickets').insert(tickets)
    if (tErr) { console.error('[seed] tickets insert err:', tErr.message); process.exit(1) }

    const items = []
    for (const t of tickets) {
      for (let j = 0; j < ITEMS_PER_TICKET; j++) {
        items.push(itemRow(t, done * ITEMS_PER_TICKET + j))
      }
    }

    // ticket_items in chunks too
    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH)
      const { error: iErr } = await sb.from('ticket_items').insert(chunk)
      if (iErr) { console.error('[seed] ticket_items insert err:', iErr.message); process.exit(1) }
    }

    done += sliceSize
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const rps = (done / elapsed).toFixed(0)
    process.stdout.write(`\r[seed] ${done}/${TICKETS}  ${elapsed}s  ${rps} tickets/s    `)
  }
  console.log(`\n[seed] done in ${((Date.now() - start) / 1000).toFixed(1)}s`)
}

async function cleanup() {
  console.log(`[cleanup] deleting is_test=true rows for business ${BID}`)
  const start = Date.now()
  // Delete ticket_items first (FK), then tickets
  const r1 = await mgmtQ(`DELETE FROM public.ticket_items WHERE business_id='${BID}' AND ticket_supabase_id IN (SELECT supabase_id FROM tickets WHERE business_id='${BID}' AND is_test=true)`)
  console.log('[cleanup] ticket_items:', JSON.stringify(r1).slice(0, 200))
  const r2 = await mgmtQ(`DELETE FROM public.tickets WHERE business_id='${BID}' AND is_test=true`)
  console.log('[cleanup] tickets:', JSON.stringify(r2).slice(0, 200))
  console.log(`[cleanup] done in ${((Date.now() - start) / 1000).toFixed(1)}s`)
}

async function measure() {
  console.log(`[measure] EXPLAIN ANALYZE on hot queries against business ${BID}`)
  const queries = [
    {
      label: 'tickets.byDateRange (last 30 days, status<>nula)',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.tickets WHERE business_id='${BID}' AND status <> 'nula' AND created_at > now() - interval '30 days' ORDER BY paid_at DESC NULLS LAST, created_at DESC LIMIT 500`,
    },
    {
      label: 'tickets full year scan with status filter',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT count(*), sum(total) FROM public.tickets WHERE business_id='${BID}' AND status='cobrado' AND created_at > now() - interval '1 year'`,
    },
    {
      label: 'ticket_items join via ticket_supabase_id (50 ticket fan-out)',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) WITH t AS (SELECT supabase_id FROM public.tickets WHERE business_id='${BID}' ORDER BY created_at DESC LIMIT 50) SELECT count(*) FROM public.ticket_items i WHERE i.business_id='${BID}' AND i.ticket_supabase_id IN (SELECT supabase_id FROM t)`,
    },
    {
      label: 'tickets daily group-by (last 30 days)',
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT date_trunc('day', created_at), count(*), sum(total) FROM public.tickets WHERE business_id='${BID}' AND created_at > now() - interval '30 days' GROUP BY 1`,
    },
  ]
  for (const q of queries) {
    console.log(`\n--- ${q.label} ---`)
    const r = await mgmtQ(q.sql)
    if (r.message) { console.log('ERR:', r.message); continue }
    const plan = r[0]?.['QUERY PLAN']?.[0]
    if (plan) {
      console.log(`Execution Time: ${plan['Execution Time']?.toFixed(2)}ms  |  Planning: ${plan['Planning Time']?.toFixed(2)}ms`)
      console.log(`Total Cost: ${plan.Plan['Total Cost']}  Rows: ${plan.Plan['Plan Rows']}`)
      // First level node summary
      console.log(`Top node: ${plan.Plan['Node Type']}  ${plan.Plan['Index Name'] || ''}  ${plan.Plan['Relation Name'] || ''}`)
    } else {
      console.log(JSON.stringify(r).slice(0, 400))
    }
  }
}

const arg = process.argv[2]
if (arg === '--cleanup') cleanup().catch(e => { console.error(e); process.exit(1) })
else if (arg === '--measure') measure().catch(e => { console.error(e); process.exit(1) })
else seed().catch(e => { console.error(e); process.exit(1) })
