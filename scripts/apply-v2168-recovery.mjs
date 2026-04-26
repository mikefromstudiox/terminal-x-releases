#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
function loadEnv(f){if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);if(!m)continue;if(process.env[m[1]]==null)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv(path.join(ROOT,'.env'))
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function applyFile(p) {
  const sql = fs.readFileSync(path.join(ROOT, p), 'utf8')
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},
    body:JSON.stringify({query:sql})
  })
  console.log(`[${r.status}] ${p}: ${(await r.text()).slice(0, 200)}`)
}
const files = [
  'migrations/2026_04_26_service_recipes.sql',
  'migrations/2026_04_26_restaurant_reservations.sql',
  'migrations/2026_04_26_services_in_stock.sql',
  'migrations/2026_04_27_v2168_recovery.sql',
]
for (const f of files) await applyFile(f)
