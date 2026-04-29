// Apply migrations/2026_04_27_anticipos_isr.sql via Supabase Management API.
import { readFileSync } from 'fs'
import { resolve } from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: resolve(import.meta.dirname, '..', '.env') })

const SQL_PATH = resolve(import.meta.dirname, '..', 'migrations', '2026_04_27_anticipos_isr.sql')
const sql = readFileSync(SQL_PATH, 'utf8')
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const URL_  = process.env.SUPABASE_URL
if (!TOKEN || !URL_) { console.error('Missing env'); process.exit(1) }
const REF = new URL(URL_).host.split('.')[0]

console.log(`[anticipos-isr] applying to ${REF} (${sql.length} chars)...`)
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
const body = await res.text()
if (!res.ok) { console.error(`HTTP ${res.status}: ${body.slice(0, 2000)}`); process.exit(1) }
console.log('[anticipos-isr] applied OK', body.slice(0, 200))
