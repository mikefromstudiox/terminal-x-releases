#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
function loadEnv(f){if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);if(!m)continue;if(process.env[m[1]]==null)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv(path.join(ROOT,'.env'))
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},body:JSON.stringify({query:sql})}); return r.ok?r.json():(console.error(r.status,await r.text()),null)}
const B='1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const rows = await q(`select username, pin_hash, pin_salt, length(pin_salt) saltlen, length(pin_hash) hashlen from public.staff where business_id='${B}' and username in ('michael','esoliman','wlugo')`)
const expected = { michael:'0714', esoliman:'0715', wlugo:'1234' }
console.log('=== Cloud-side verification — does bcrypt.compareSync(PIN + salt, hash) return true? ===\n')
for (const r of rows) {
  const pin = expected[r.username]
  const tests = [
    ['pin as string',           String(pin)],
    ['pin as Number(pin)',      String(Number(pin))],
    ['pin as parseInt(pin,10)', String(parseInt(pin,10))],
    ['pin trimmed',             String(pin).trim()],
    ['pin no-leading-zero',     pin.replace(/^0+/,'')],
  ]
  console.log(`--- ${r.username} (cloud salt=${r.pin_salt.slice(0,12)}… len=${r.saltlen}, hash=${r.pin_hash.slice(0,12)}… len=${r.hashlen}) ---`)
  for (const [label, candidate] of tests) {
    const ok = bcrypt.compareSync(candidate + (r.pin_salt || ''), r.pin_hash)
    console.log(`   ${ok ? '✅' : '❌'}  ${label.padEnd(28)} → "${candidate}"`)
  }
  console.log()
}
