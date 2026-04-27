#!/usr/bin/env node
// Apply migrations/2026_05_03_contabilidad_cross_firm.sql via Supabase
// Management API. Idempotent — re-running is safe.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m) continue
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv(path.join(ROOT, '.env'))

const URL_       = process.env.SUPABASE_URL
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF = (URL_ || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
if (!MGMT_TOKEN || !PROJECT_REF) {
  console.error('✗ SUPABASE_ACCESS_TOKEN / SUPABASE_URL missing in .env')
  process.exit(2)
}

const FILES = [
  '2026_05_01_contabilidad_phase1.sql',
  '2026_05_02_contabilidad_phase1_hardening.sql',
  '2026_05_02_contabilidad_phase2.sql',
  '2026_05_03_contabilidad_cross_firm.sql',
]

for (const f of FILES) {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')
  process.stdout.write(`→ ${f} … `)
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status}`)
    console.error(text)
    process.exit(1)
  }
  console.log('OK')
}
console.log('\n✓ All Contabilidad migrations applied via Management API')
