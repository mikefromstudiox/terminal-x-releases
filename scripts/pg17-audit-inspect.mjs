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
const out={}
out.version = await q(`select version()`)
out.top_tables = await q(`
  select c.relname as table,
         pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
         pg_total_relation_size(c.oid) as bytes,
         c.reltuples::bigint as approx_rows,
         (select count(*) from pg_index i where i.indrelid=c.oid) as idx_count,
         c.relrowsecurity as rls,
         c.relkind as kind
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
  order by pg_total_relation_size(c.oid) desc limit 20`)
out.indexes_for_top = await q(`
  with t as (
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
    order by pg_total_relation_size(c.oid) desc limit 15)
  select t.relname as table, i.relname as index, am.amname as method,
         pg_get_indexdef(ix.indexrelid) as def,
         pg_size_pretty(pg_relation_size(i.oid)) as size
  from t join pg_index ix on ix.indrelid=t.oid
         join pg_class i on i.oid=ix.indexrelid
         join pg_am am on am.oid=i.relam
  order by t.relname, i.relname`)
out.partitioned = await q(`select inhrelid::regclass as part, inhparent::regclass as parent from pg_inherits limit 50`)
out.jsonb_cols = await q(`
  select table_name, column_name from information_schema.columns
  where table_schema='public' and data_type='jsonb' order by table_name`)
out.unused_indexes = await q(`
  select schemaname, relname as table, indexrelname as index, idx_scan,
         pg_size_pretty(pg_relation_size(indexrelid)) as size
  from pg_stat_user_indexes where schemaname='public' and idx_scan < 10
  order by pg_relation_size(indexrelid) desc limit 20`)
out.bloat_hint = await q(`
  select relname, n_dead_tup, n_live_tup, last_autovacuum, last_autoanalyze
  from pg_stat_user_tables where schemaname='public' and n_dead_tup > 1000
  order by n_dead_tup desc limit 15`)
out.tables_total = await q(`select count(*) from pg_tables where schemaname='public'`)
out.rls_enabled_count = await q(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity`)
out.policy_count = await q(`select count(*) from pg_policies where schemaname='public'`)
out.extensions = await q(`select extname, extversion from pg_extension order by extname`)
console.log(JSON.stringify(out,null,2))
