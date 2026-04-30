/**
 * scale-test-audit.mjs — pre-flight audit for tickets-family partitioning.
 *
 * Reports:
 *   - All FKs INTO tickets, ticket_items, *_commissions, loyalty_transactions
 *   - Current row counts
 *   - All UNIQUE constraints (must be preserved or rebuilt with partition key)
 *   - Indexes (will be inherited per-partition)
 *
 * Usage: node scripts/scale-test-audit.mjs
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

const TARGETS = ['tickets', 'ticket_items', 'washer_commissions', 'seller_commissions', 'cajero_commissions', 'loyalty_transactions']

async function run() {
  for (const t of TARGETS) {
    console.log(`\n======= ${t} =======`)
    const cnt = await q(`SELECT count(*) FROM public.${t}`)
    console.log('rows:', cnt[0]?.count)

    const uniques = await q(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.${t}'::regclass AND contype IN ('u', 'p')
      ORDER BY conname`)
    console.log('uniques/pk:', JSON.stringify(uniques, null, 2))

    const fksIn = await q(`
      SELECT conrelid::regclass::text AS source_table, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE confrelid = 'public.${t}'::regclass AND contype = 'f'
      ORDER BY source_table`)
    console.log('FKs into:', JSON.stringify(fksIn, null, 2))

    const fksOut = await q(`
      SELECT confrelid::regclass::text AS target_table, conname
      FROM pg_constraint
      WHERE conrelid = 'public.${t}'::regclass AND contype = 'f'
      ORDER BY target_table`)
    console.log('FKs out:', JSON.stringify(fksOut, null, 2))

    const idx = await q(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = '${t}' AND schemaname = 'public' ORDER BY indexname`)
    console.log('indexes:', JSON.stringify(idx, null, 2))

    const cols = await q(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${t}'
      ORDER BY ordinal_position`)
    console.log('cols:', cols.length, 'columns')
  }
}

run().catch(e => { console.error('FATAL:', e); process.exit(1) })
