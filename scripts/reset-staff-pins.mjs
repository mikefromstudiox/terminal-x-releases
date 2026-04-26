#!/usr/bin/env node
// Resets all active staff PINs for a business to a known value (default 1234).
// Mirrors electron/database.js bcryptComparePin: bcrypt.hash(PIN + per-row salt).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'; import crypto from 'node:crypto'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
function loadEnv(f){if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);if(!m)continue;if(process.env[m[1]]==null)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv(path.join(ROOT,'.env'))
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},body:JSON.stringify({query:sql})}); return r.ok?r.json():(console.error(r.status,await r.text()),null)}
const BIZ = process.argv[2] || '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const PIN = process.argv[3] || '1234'
const targets = await q(`select supabase_id, username from public.staff where business_id='${BIZ}' and active=true order by username`)
console.log(`Resetting ${targets.length} staff for biz ${BIZ} to PIN ${PIN}`)
for (const t of targets) {
  const salt = crypto.randomBytes(24).toString('hex')
  const hash = bcrypt.hashSync(PIN + salt, 10)
  await q(`UPDATE public.staff SET pin_hash='${hash}', pin_salt='${salt}', pin_hash_algo='bcrypt', pin_failed_attempts=0, pin_locked_until=NULL, updated_at=now() WHERE supabase_id='${t.supabase_id}'`)
  console.log(`  ✓ ${t.username}`)
}
console.log('\nVerify:')
console.table(await q(`select username, pin_hash_algo, length(pin_hash) hashlen, pin_salt is not null has_salt, pin_failed_attempts att, pin_locked_until lock, updated_at from public.staff where business_id='${BIZ}' and active=true order by username`))
