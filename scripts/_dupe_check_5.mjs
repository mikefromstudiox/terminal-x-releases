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
const checks = [
  ['modificadores', `SELECT business_id, modifier_group_supabase_id, name, COUNT(*) c FROM modificadores GROUP BY 1,2,3 HAVING COUNT(*)>1`],
  ['modificadores group_name', `SELECT business_id, group_name, name, COUNT(*) c FROM modificadores GROUP BY 1,2,3 HAVING COUNT(*)>1`],
  ['service_packages', `SELECT business_id, client_supabase_id, package_name, purchased_at, COUNT(*) c FROM service_packages GROUP BY 1,2,3,4 HAVING COUNT(*)>1`],
  ['wash_combos', `SELECT business_id, client_supabase_id, combo_name, purchased_at, COUNT(*) c FROM wash_combos GROUP BY 1,2,3,4 HAVING COUNT(*)>1`],
  ['memberships active', `SELECT business_id, client_supabase_id, plan_name, COUNT(*) c FROM memberships WHERE status='active' GROUP BY 1,2,3 HAVING COUNT(*)>1`],
  ['memberships template', `SELECT business_id, nombre, COUNT(*) c FROM memberships WHERE active_template=true GROUP BY 1,2 HAVING COUNT(*)>1`],
  ['recurring_orders', `SELECT business_id, client_supabase_id, nombre, COUNT(*) c FROM recurring_orders GROUP BY 1,2,3 HAVING COUNT(*)>1`],
]
for(const [label, sql] of checks){
  const r = await q(sql)
  console.log(`[${label}] dupes: ${r.length}`)
  if(r.length) console.log('  ', JSON.stringify(r))
}
// Also look at memberships data to see status values + active_template usage
console.log('\n--- memberships sample ---')
const m = await q(`SELECT supabase_id, business_id, client_supabase_id, plan_name, nombre, status, active_template, period_start, period_end FROM memberships`)
console.log(JSON.stringify(m, null, 2))
console.log('\n--- recurring_orders sample ---')
const r = await q(`SELECT supabase_id, business_id, client_supabase_id, nombre FROM recurring_orders`)
console.log(JSON.stringify(r, null, 2))
