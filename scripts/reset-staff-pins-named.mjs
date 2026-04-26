#!/usr/bin/env node
// Reset specific staff PINs by username with distinct PINs.
// Usage: node scripts/reset-staff-pins-named.mjs <biz_id> <username:pin> [<username:pin>...]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'; import crypto from 'node:crypto'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
function loadEnv(f){if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);if(!m)continue;if(process.env[m[1]]==null)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv(path.join(ROOT,'.env'))
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},body:JSON.stringify({query:sql})}); return r.ok?r.json():(console.error(r.status,await r.text()),null)}
const BIZ = process.argv[2]
const pairs = process.argv.slice(3).map(s => { const [u,p] = s.split(':'); return { username: u, pin: p } })
if (!BIZ || !pairs.length) { console.error('usage: <biz_id> <username:pin> [...]'); process.exit(2) }
for (const { username, pin } of pairs) {
  const row = (await q(`select supabase_id from public.staff where business_id='${BIZ}' and username='${username}' and active=true limit 1`))?.[0]
  if (!row) { console.error(`✗ ${username}: not found`); continue }
  const salt = crypto.randomBytes(24).toString('hex')
  const hash = bcrypt.hashSync(pin + salt, 10)
  await q(`UPDATE public.staff SET pin_hash='${hash}', pin_salt='${salt}', pin_hash_algo='bcrypt', pin_failed_attempts=0, pin_locked_until=NULL, updated_at=now() WHERE supabase_id='${row.supabase_id}'`)
  console.log(`  ✓ ${username} → PIN ${pin}`)
}
console.log('\nFinal state:')
console.table(await q(`select username, name, role, pin_hash_algo, pin_failed_attempts att, pin_locked_until lock, updated_at from public.staff where business_id='${BIZ}' and active=true order by username`))
