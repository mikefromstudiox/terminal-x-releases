#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
function loadEnv(f){if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);if(!m)continue;if(process.env[m[1]]==null)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv(path.join(ROOT,'.env'))
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN, ANON=process.env.SUPABASE_ANON_KEY
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},body:JSON.stringify({query:sql})}); return r.ok?r.json():(console.error(r.status,await r.text()),null)}
async function anonGet(tbl, biz){const r=await fetch(`${URL_}/rest/v1/${tbl}?business_id=eq.${biz}&limit=1&select=supabase_id`,{headers:{apikey:ANON,Authorization:`Bearer ${ANON}`}}); return [r.status, ((await r.json())||[]).length]}

console.log('=== Step 1: businesses (sample 5) ===')
const businesses = await q(`select id, name from public.businesses order by created_at limit 5`)
console.table(businesses)

console.log('\n=== Step 2: anon SELECT on hot sync tables for first 3 businesses ===')
const tables = ['services','empleados','clients','tickets','inventory_items','staff','ncf_sequences','app_settings','categorias_servicio','mesas']
const results = []
for (const biz of businesses.slice(0,3)) {
  for (const t of tables) {
    const [status, n] = await anonGet(t, biz.id)
    results.push({ biz: biz.name.slice(0,18), table: t.padEnd(20), status, anon_visible_rows: n })
  }
}
console.table(results)

console.log('\n=== Step 3: Cloud truth — what SHOULD anon see if RLS allowed ===')
for (const biz of businesses.slice(0,3)) {
  const c = await q(`select '${biz.name.slice(0,18)}' biz, (select count(*) from services where business_id='${biz.id}') services, (select count(*) from empleados where business_id='${biz.id}') empleados, (select count(*) from clients where business_id='${biz.id}') clients, (select count(*) from inventory_items where business_id='${biz.id}') inv`)
  console.log(c[0])
}

console.log('\n=== Step 4: how many policies still reference user_metadata (legacy)? ===')
console.log(await q(`select count(*) from pg_policies where schemaname='public' and (qual ilike '%user_metadata%' or with_check ilike '%user_metadata%')`))

console.log('\n=== Step 5: how many tables use the new app_metadata predicate ===')
console.log(await q(`select count(distinct tablename) tables, count(*) policies from pg_policies where schemaname='public' and (qual ilike '%app_metadata%' or with_check ilike '%app_metadata%')`))

console.log('\n=== Step 6: tables that have the OLD my_business_ids() fallback (= anon-permissive) ===')
console.log(await q(`select count(distinct tablename) from pg_policies where schemaname='public' and qual ilike '%my_business_ids%'`))

console.log('\n=== Step 7: my_business_ids() definition — does it work for anon? ===')
console.log(await q(`select pg_get_functiondef(oid) from pg_proc where proname='my_business_ids' and pronamespace='public'::regnamespace`))

console.log('\n=== Step 8: tables with RLS enabled but ZERO policies that allow anon SELECT ===')
console.log(await q(`
  with rls_tables as (
    select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
  ),
  anon_select_pol as (
    select tablename from pg_policies
    where schemaname='public' and cmd in ('SELECT','ALL') and 'anon' = ANY(roles)
  )
  select count(distinct rt.relname) tables_blocking_anon
  from rls_tables rt left join anon_select_pol ap on ap.tablename = rt.relname
  where ap.tablename is null`))
