// One-shot — wipe all transactional data for a single business from Supabase.
// Uses service_role key from .env; bypasses RLS. Scoped by business_id.
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs'); const path = require('path')
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname,'..','.env'),'utf8')
  .split('\n').filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0,i), l.slice(i+1)] }))
const BUSINESS_ID = process.argv[2]
if (!BUSINESS_ID) { console.error('Usage: node wipe-supabase.js <business_id>'); process.exit(1) }
const apply = process.argv.includes('--apply')

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const TABLES = [
  'ticket_items','tickets','queue',
  'commissions','seller_commissions','cajero_commissions',
  'credit_payments','credit_notes','activity_log','price_changes','clients'
]

;(async () => {
  console.log(`Business: ${BUSINESS_ID}\n`)
  console.log('Current counts:')
  for (const t of TABLES) {
    const { count, error } = await sb.from(t).select('id', { count: 'exact', head: true }).eq('business_id', BUSINESS_ID)
    console.log(`  ${t}: ${error ? '['+error.message+']' : count}`)
  }
  const { count: empCount } = await sb.from('empleados').select('id', { count: 'exact', head: true })
    .eq('business_id', BUSINESS_ID).in('tipo', ['lavador','hybrid','vendedor'])
  console.log(`  empleados(lavador+hybrid+vendedor): ${empCount}`)

  if (!apply) { console.log('\n[dry-run] pass --apply'); process.exit(0) }

  console.log('\nWiping...')
  for (const t of TABLES) {
    const { error, count } = await sb.from(t).delete({ count: 'exact' }).eq('business_id', BUSINESS_ID)
    console.log(`  ${t}: ${error ? 'ERR '+error.message : 'deleted '+count}`)
  }
  const { error: eErr, count: eCount } = await sb.from('empleados').delete({ count: 'exact' })
    .eq('business_id', BUSINESS_ID).in('tipo', ['lavador','hybrid','vendedor'])
  console.log(`  empleados: ${eErr ? 'ERR '+eErr.message : 'deleted '+eCount}`)
  console.log('\nDone.')
})()
