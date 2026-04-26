#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
function loadEnv(f){ if(!fs.existsSync(f))return; for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i); if(!m)continue; if(process.env[m[1]]==null) process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv(path.join(ROOT,'.env'))
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},body:JSON.stringify({query:sql})}); return r.ok?r.json():(console.error(r.status,await r.text()),null)}
const tests = [
  ['tickets.payment_parts (GIN)', `EXPLAIN (FORMAT TEXT) SELECT id FROM public.tickets WHERE payment_parts @> '[{"method":"efectivo"}]'::jsonb LIMIT 10`],
  ['tickets.ecf_result (GIN partial)', `EXPLAIN (FORMAT TEXT) SELECT id FROM public.tickets WHERE ecf_result @> '{"status":"aceptado"}'::jsonb LIMIT 10`],
  ['businesses.settings (GIN)', `EXPLAIN (FORMAT TEXT) SELECT id FROM public.businesses WHERE settings @> '{"feature_flags":{"e_cf":true}}'::jsonb`],
  ['activity_log.metadata (GIN)', `EXPLAIN (FORMAT TEXT) SELECT id FROM public.activity_log WHERE metadata @> '{"reason":"test"}'::jsonb LIMIT 10`],
  ['ecf_queue.body_json (GIN)', `EXPLAIN (FORMAT TEXT) SELECT id FROM public.ecf_queue WHERE body_json @> '{"tipo":"E31"}'::jsonb LIMIT 10`],
  ['activity_log time-range (BRIN)', `EXPLAIN (FORMAT TEXT) SELECT count(*) FROM public.activity_log WHERE created_at >= now() - interval '30 days'`],
  ['license_events time-range (BRIN)', `EXPLAIN (FORMAT TEXT) SELECT count(*) FROM public.license_events WHERE created_at >= now() - interval '90 days'`],
  ['ecf_submissions time-range (BRIN)', `EXPLAIN (FORMAT TEXT) SELECT count(*) FROM public.ecf_submissions WHERE created_at >= now() - interval '1 year'`],
]
for(const [name,sql] of tests){
  console.log(`\n--- ${name} ---`)
  const r=await q(sql)
  const plan=(r||[]).map(x=>x['QUERY PLAN']).join('\n')
  console.log(plan)
}
