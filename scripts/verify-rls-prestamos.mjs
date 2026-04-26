#!/usr/bin/env node
// Verifies the tightened prestamos RLS policies behave as expected.
//
// Gates:
//   1. logged-in admin@prestamos: SELECT loans for own business_id  → > 0 (or 0 ok if empty)
//   2. logged-in admin@prestamos: SELECT loans for fake business_id → must be exactly 0 rows (filtered, NOT error)
//   3. anon (no login):           SELECT loans                       → must be exactly 0 rows
//   4. anon (no login):           SELECT pawn_listings published     → succeeds (>= 0)

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL  = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
if (!URL || !ANON) { console.error('Missing SUPABASE_URL/SUPABASE_ANON_KEY'); process.exit(1) }

const EMAIL = 'admin@prestamos.demo.terminalxpos.com'
const PASS  = 'Demo2026!'
const FAKE_BID = '00000000-0000-0000-0000-000000000000'

let pass = 0, fail = 0
function log(step, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ' — ' + detail : ''}`)
  ok ? pass++ : fail++
}

async function run() {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } })

  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS })
  log('auth: prestamos demo sign-in', !authErr && !!auth?.session, authErr?.message || EMAIL)
  if (!auth?.session) process.exit(1)
  const BID = auth.user?.user_metadata?.business_id
  log('jwt: user_metadata.business_id present', !!BID, BID || '(missing)')

  // Gate 1: own business
  const r1 = await sb.from('loans').select('id, business_id').eq('business_id', BID).limit(5)
  log('gate1: select loans WHERE business_id = own', !r1.error, r1.error?.message || `${r1.data?.length ?? 0} rows`)

  // Gate 2: fake business → must filter to 0, not error
  const r2 = await sb.from('loans').select('id, business_id').eq('business_id', FAKE_BID).limit(5)
  log('gate2: select loans WHERE business_id = fake → 0 rows',
      !r2.error && (r2.data?.length ?? 0) === 0,
      r2.error?.message || `${r2.data?.length ?? 0} rows`)

  // Gate 3: anon (no JWT) → must be 0
  await sb.auth.signOut()
  const r3 = await sb.from('loans').select('id').limit(5)
  log('gate3: anon (no login) select loans → 0 rows',
      !r3.error && (r3.data?.length ?? 0) === 0,
      r3.error?.message || `${r3.data?.length ?? 0} rows`)

  // Gate 4: anon public listings carve-out
  const r4 = await sb.from('pawn_listings').select('id, status').eq('status', 'published').limit(5)
  log('gate4: anon select pawn_listings WHERE status=published',
      !r4.error,
      r4.error?.message || `${r4.data?.length ?? 0} published`)

  console.log(`\n${pass} pass / ${fail} fail`)
  process.exit(fail ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
