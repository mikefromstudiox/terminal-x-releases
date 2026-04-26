#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
function loadEnv(f){ if(!fs.existsSync(f))return; for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if(!m)continue; if(process.env[m[1]]==null) process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv(path.join(ROOT,'.env'))
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function q(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},body:JSON.stringify({query:sql})})
  if(!r.ok){console.error(r.status, await r.text()); return null}
  return r.json()
}
const tables = ['tickets','ticket_items','cajero_commissions','inventory_items','license_events','activity_log','ecf_queue','ecf_submissions','loyalty_transactions','inventory_count_items','seller_commissions'];
for(const t of tables){
  const rows=await q(`select indexrelname as i, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) sz, pg_get_indexdef(indexrelid) def from pg_stat_user_indexes where schemaname='public' and relname='${t}' order by idx_scan, indexrelname`)
  console.log('\n## '+t)
  for(const r of rows||[]) console.log(`  scan=${r.idx_scan} ${r.sz} ${r.i}\n     ${r.def}`)
}
console.log('\n## created_at presence')
const cols=await q(`select table_name, column_name from information_schema.columns where table_schema='public' and column_name='created_at' and table_name = ANY('{${tables.join(',')}}'::text[]) order by table_name`)
for(const r of cols||[]) console.log('  '+r.table_name)
