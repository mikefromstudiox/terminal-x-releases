/**
 * scale-measure-realistic.mjs — query a SMALL tenant against a database with
 * a mega-tenant present. Simulates realistic fleet distribution: most
 * tenants are small, planner stats are dominated by the largest one.
 */
import 'dotenv/config'

const TOK = process.env.SUPABASE_ACCESS_TOKEN
const REF = new URL(process.env.SUPABASE_URL).hostname.split('.')[0]

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  return r.json()
}

// Ranoza Liquor Store — 4 real tickets only. Represents a "small but realistic" tenant
// living in a database that contains a 419K mega-tenant.
const SMALL = '4f789f41-76d2-4402-838f-5fe20a91641f'

const cases = [
  { label: 'Daily Report (last 30 days)',
    sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, supabase_id, total, status, payment_method FROM public.tickets WHERE business_id='${SMALL}' AND status <> 'nula' AND created_at > now() - interval '30 days' ORDER BY paid_at DESC NULLS LAST, created_at DESC LIMIT 500` },
  { label: 'Full year aggregate',
    sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT count(*), sum(total) FROM public.tickets WHERE business_id='${SMALL}' AND status='cobrado' AND created_at > now() - interval '1 year'` },
  { label: 'ticket_items join (10 tickets)',
    sql: `EXPLAIN (ANALYZE, BUFFERS) WITH t AS (SELECT supabase_id FROM public.tickets WHERE business_id='${SMALL}' ORDER BY created_at DESC LIMIT 10) SELECT count(*) FROM public.ticket_items i WHERE i.business_id='${SMALL}' AND i.ticket_supabase_id IN (SELECT supabase_id FROM t)` },
  { label: 'Daily group-by last 30 days',
    sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT date_trunc('day', created_at), count(*), sum(total) FROM public.tickets WHERE business_id='${SMALL}' AND created_at > now() - interval '30 days' GROUP BY 1` },
]

for (const c of cases) {
  const r = await q(c.sql)
  if (r.message) { console.log(c.label, 'ERR:', r.message); continue }
  const lines = r.map(x => x['QUERY PLAN'])
  const exec = lines.find(l => l && l.startsWith('Execution Time'))
  const planning = lines.find(l => l && l.startsWith('Planning Time'))
  console.log(`${c.label}: ${exec || 'N/A'}  |  ${planning || ''}`)
}
