// Force PostgREST to reload its schema cache after a DDL ALTER.
// One-shot helper; safe and idempotent.
import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(import.meta.dirname, '..', '.env') })
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const URL_  = process.env.SUPABASE_URL
const REF = new URL(URL_).host.split('.')[0]
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "NOTIFY pgrst, 'reload schema';" }),
})
console.log('reload schema:', r.status, (await r.text()).slice(0, 120))
