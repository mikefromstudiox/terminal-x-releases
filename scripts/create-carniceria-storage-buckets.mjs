// Create the two Supabase storage buckets used by the carnicería vertical.
//   • corte-photos              public,  cache 7 days
//   • inventory-discard-photos  private, signed URLs only
// Idempotent — safe to re-run; HTTP 409 (already exists) is treated as success.
//
//   node scripts/create-carniceria-storage-buckets.mjs
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL_  = process.env.SUPABASE_URL
const SVC   = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !SVC) { console.error('Missing SUPABASE env'); process.exit(1) }

const BUCKETS = [
  { id: 'corte-photos',             name: 'corte-photos',             public: true,
    file_size_limit: 5 * 1024 * 1024,  allowed_mime_types: ['image/jpeg','image/png','image/webp'] },
  { id: 'inventory-discard-photos', name: 'inventory-discard-photos', public: false,
    file_size_limit: 8 * 1024 * 1024,  allowed_mime_types: ['image/jpeg','image/png','image/webp'] },
]

let pass = 0, fail = 0
for (const b of BUCKETS) {
  const r = await fetch(`${URL_}/storage/v1/bucket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SVC}`, apikey: SVC, 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  })
  if (r.status === 200 || r.status === 201) { console.log('✅ created', b.id); pass++ }
  else if (r.status === 409 || r.status === 400) {
    // 409 already exists; 400 may mean already exists (some Supabase versions).
    const txt = await r.text()
    if (txt.includes('already') || txt.includes('exists') || txt.includes('Duplicate')) {
      console.log('✅ exists  ', b.id); pass++
    } else { console.log('❌', b.id, r.status, txt.slice(0,200)); fail++ }
  } else {
    const txt = await r.text()
    console.log('❌', b.id, r.status, txt.slice(0,200)); fail++
  }
}
console.log(`\n${pass} ok / ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
