import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
const { data, error } = await sb.auth.signInWithPassword({ email: 'staging@studioxrd.com', password: 'Staging2026!' })
if (error) { console.error(error); process.exit(1) }

const r = await fetch('https://terminalxpos.com/api/panel?action=ctb_invite_by_email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + data.session.access_token },
  body: JSON.stringify({ email: 'michaelmmejia@icloud.com', business_name: 'Resend Preview Test', send_email: true }),
})
const j = await r.json()
console.log('status:', r.status)
console.log('email:', JSON.stringify(j.email, null, 2))
console.log('magic_link:', j.magic_link)
