/**
 * sandbox-demo-smoke.mjs — verifies the public-ish "Probar emisión" demo
 * endpoint that anyone signed in can hit to preview the e-CF flow.
 *
 * Asserts:
 *   1. Auth required.
 *   2. Returns ok=true with realistic shape (eNCF, trackId, dgiiCodigo, qrLink).
 *   3. Marks _sandbox: true so UI can label clearly.
 *   4. Either _demo: true (synthetic) or _demo: false (real DGII) — both valid.
 *   5. Rate limit: 11th call in same hour returns ok=false with limit msg.
 *
 * Usage: node scripts/sandbox-demo-smoke.mjs
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL
const ANON     = process.env.SUPABASE_ANON_KEY
const SVC      = process.env.SUPABASE_SERVICE_ROLE_KEY
const REF      = new URL(SUPA_URL).hostname.split('.')[0]
const TOK      = process.env.SUPABASE_ACCESS_TOKEN
const ENDPOINT = 'https://terminalxpos.com/api/ecf-sign'

const RANOZA_BID = '4f789f41-76d2-4402-838f-5fe20a91641f'
const EMAIL = 'Jerryfelix@gmail.com'
const PASS  = 'Rahel25@'

let pass = 0, fail = 0
function log(label, ok, detail = '') {
  console.log((ok ? '✅' : '❌') + ' ' + label + (detail ? ' — ' + detail : ''))
  if (ok) pass++; else fail++
}

async function callDemo(jwt, amount = 1000) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
    body: JSON.stringify({ business_id: RANOZA_BID, action: 'sandbox-try', amount }),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function run() {
  console.log('\n=== sandbox demo endpoint smoke ===\n')

  // Reset rate limit counter for jerryfelix to avoid carrying state across runs.
  const svc = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })
  const sb  = createClient(SUPA_URL, ANON, { auth: { persistSession: false } })

  // 1. Auth required
  const noAuthRes = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: RANOZA_BID, action: 'sandbox-try' }),
  })
  log('auth required (no JWT → 401)', noAuthRes.status === 401)

  // Sign in
  const { data: auth } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS })
  if (!auth?.session) { console.error('blocker: jerry sign-in failed'); process.exit(1) }
  const jwt = auth.session.access_token

  // Reset existing rate limit counter for this user/hour so the test is repeatable.
  try {
    const hourStart = new Date(); hourStart.setMinutes(0, 0, 0)
    await svc.from('api_rate_limits')
      .delete()
      .eq('bucket', `sandbox-try:${auth.user.id}`)
      .eq('window_start', hourStart.toISOString())
  } catch {}

  // 2. First call — should succeed
  const first = await callDemo(jwt, 1000)
  log('first call returns ok=true', first.body?.ok === true,
    `_sandbox=${first.body?._sandbox} _demo=${first.body?._demo} eNCF=${first.body?.data?.eNCF}`)

  // 3. Shape sanity
  const d = first.body?.data || {}
  log('shape: eNCF + trackId + dgiiCodigo + qrLink',
      !!(d.eNCF && d.trackId && d.dgiiCodigo !== undefined && d.qrLink),
      `eNCF=${d.eNCF?.slice(0,5)}…  qr=${(d.qrLink||'').slice(0,40)}…`)

  // 4. Sandbox flag
  log('_sandbox flag set true', first.body?._sandbox === true)

  // 5. Either real or demo, both valid
  log('_demo flag is boolean', typeof first.body?._demo === 'boolean',
    first.body?._demo === false ? 'real DGII path' : 'synthetic-realistic path')

  // 6. Rate limit — slam the endpoint and confirm cap kicks in.
  let lastBody = null
  for (let i = 0; i < 12; i++) {
    lastBody = (await callDemo(jwt, 1000)).body
  }
  log('rate limit kicks in after 10 calls/hour',
    lastBody?.ok === false && /Limite/i.test(lastBody?.error || ''),
    `last error: ${(lastBody?.error || '').slice(0, 60)}`)

  // Cleanup: delete rate-limit row so manual testing isn't blocked.
  try {
    const hourStart = new Date(); hourStart.setMinutes(0, 0, 0)
    await svc.from('api_rate_limits')
      .delete()
      .eq('bucket', `sandbox-try:${auth.user.id}`)
      .eq('window_start', hourStart.toISOString())
  } catch {}

  await sb.auth.signOut()
  console.log(`\n=== ${pass} passed, ${fail} failed ===`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch(e => { console.error('FATAL:', e); process.exit(2) })
