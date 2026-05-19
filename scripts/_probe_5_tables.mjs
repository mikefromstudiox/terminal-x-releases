import 'dotenv/config'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT = 'csppjsoirjflumaiipqw'
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
    method:'POST', headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ query: sql })
  })
  if(!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  return r.json()
}
const tables = ['modificadores','service_packages','wash_combos','memberships','recurring_orders']
console.log('=== COLUMNS ===')
for(const t of tables){
  const cols = await q(`SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' ORDER BY ordinal_position`)
  console.log(`\n[${t}] (${cols.length} cols)`)
  console.log(cols.map(c=>`  ${c.column_name} ${c.data_type}${c.is_nullable==='NO'?' NOT NULL':''}`).join('\n'))
}
console.log('\n=== EXISTING UNIQUE/PK CONSTRAINTS ===')
for(const t of tables){
  const cs = await q(`SELECT con.conname, pg_get_constraintdef(con.oid) AS def FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${t}' AND con.contype IN ('u','p')`)
  console.log(`\n[${t}]`)
  console.log(cs.map(c=>`  ${c.conname}: ${c.def}`).join('\n') || '  (none)')
}
console.log('\n=== EXISTING UNIQUE INDEXES (partial too) ===')
for(const t of tables){
  const ix = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='${t}'`)
  console.log(`\n[${t}]`)
  console.log(ix.map(i=>`  ${i.indexname}: ${i.indexdef}`).join('\n') || '  (none)')
}
console.log('\n=== ROW COUNTS ===')
for(const t of tables){
  const c = await q(`SELECT COUNT(*) AS n FROM public.${t}`)
  console.log(`  ${t}: ${c[0].n}`)
}
