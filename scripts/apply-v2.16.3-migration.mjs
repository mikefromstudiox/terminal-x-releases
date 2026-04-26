// Apply db/supabase-migration-v2.16.3.sql to the production Supabase project
// using the Management API (project-level SQL endpoint).
import { readFileSync } from 'fs'
import { resolve } from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: resolve(import.meta.dirname, '..', '.env') })

const SQL_PATH = resolve(import.meta.dirname, '..', 'db', 'supabase-migration-v2.16.3.sql')
const sql = readFileSync(SQL_PATH, 'utf8')

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const URL_  = process.env.SUPABASE_URL
if (!TOKEN || !URL_) { console.error('Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL in .env'); process.exit(1) }
const REF = new URL(URL_).host.split('.')[0]

console.log(`[v2.16.3] applying migration to project ${REF} (${sql.length} chars)...`)

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
const body = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${body.slice(0, 1500)}`)
  process.exit(1)
}
console.log('[v2.16.3] migration applied OK')
console.log(body.slice(0, 400))
