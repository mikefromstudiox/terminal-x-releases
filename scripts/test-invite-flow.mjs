#!/usr/bin/env node
// One-shot test of the contabilidad email-invite flow against preview.
// Signs in as staging firm → creates invite → looks up token (public) →
// signs in as staging client → accepts → verifies DB side-effects.

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const PREVIEW = 'https://terminalx-njgzg9ova-michaels-projects-d6ab0573.vercel.app'
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SB_ANON = process.env.VITE_SUPABASE_ANON_KEY
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

const FIRM = { email: 'staging@studioxrd.com', password: 'Staging2026!', biz_id: '699e0559-3009-4b58-891c-ecffe060dd08' }
const CLIENT = { email: 'staging-client@studioxrd.com', password: 'Staging2026!', biz_id: '73bdb95b-8f57-4407-841d-3ecf473aa531' }
const TEST_EMAIL = 'staging-client@studioxrd.com'

const PASS = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const FAIL = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const INFO = (m) => console.log(`  · ${m}`)

async function signIn(creds) {
  const sb = createClient(SB_URL, SB_ANON)
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password })
  if (error) throw new Error(`signIn(${creds.email}): ${error.message}`)
  return data.session.access_token
}

async function api(action, { method = 'POST', token, body, query } = {}) {
  const qs = query ? '&' + new URLSearchParams(query).toString() : ''
  const r = await fetch(`${PREVIEW}/api/panel?action=${action}${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  })
  const data = await r.json().catch(() => ({}))
  return { status: r.status, data }
}

async function baselineErrors() {
  const sb = createClient(SB_URL, SB_SERVICE)
  const { data } = await sb.from('client_errors').select('id, created_at').order('created_at', { ascending: false }).limit(1)
  return data?.[0]?.created_at || '1970-01-01'
}

async function newErrorsSince(ts) {
  const sb = createClient(SB_URL, SB_SERVICE)
  const { data } = await sb.from('client_errors').select('id, message, severity, route, business_id, metadata').gt('created_at', ts).order('created_at', { ascending: false })
  return data || []
}

async function preCleanup() {
  // Delete any prior staging accounting_clients pointing at staging-client.
  const sb = createClient(SB_URL, SB_SERVICE)
  await sb.from('accounting_clients').delete().eq('business_id', FIRM.biz_id).eq('invite_email', TEST_EMAIL)
  // Drop the auto-created staff row in client tenant (if exists from prior run).
  const { data: firm } = await sb.from('businesses').select('owner_id').eq('id', FIRM.biz_id).maybeSingle()
  if (firm?.owner_id) {
    await sb.from('staff').delete().eq('business_id', CLIENT.biz_id).eq('auth_user_id', firm.owner_id).eq('role', 'accountant')
  }
  INFO('cleaned prior invite + staff rows')
}

async function main() {
  console.log(`\n=== invite-flow test — preview ${PREVIEW} ===\n`)
  if (!SB_URL || !SB_ANON || !SB_SERVICE) { FAIL('missing env'); return }

  const baseline = await baselineErrors()
  INFO(`baseline client_errors last ts: ${baseline}`)

  await preCleanup()

  console.log('\n[1] firm signs in + creates invite')
  const firmToken = await signIn(FIRM)
  PASS(`firm session token (len ${firmToken.length})`)

  const inviteRes = await api('ctb_invite_by_email', { token: firmToken, body: { email: TEST_EMAIL, business_name: 'TX Staging Client', send_email: false } })
  if (inviteRes.status !== 200 || !inviteRes.data.ok) { FAIL(`invite create: ${inviteRes.status} ${JSON.stringify(inviteRes.data)}`); return }
  PASS(`invite created (ac_id=${inviteRes.data.accounting_client_id})`)
  const magicLink = inviteRes.data.magic_link
  const token = new URL(magicLink).searchParams.get('token')
  INFO(`magic_link host: ${new URL(magicLink).host}`)
  INFO(`token prefix: ${token.slice(0, 10)}…`)

  console.log('\n[2] public lookup resolves firm name')
  const lookupRes = await api('ctb_invite_lookup', { method: 'GET', query: { token } })
  if (lookupRes.status !== 200 || !lookupRes.data.ok) { FAIL(`lookup: ${lookupRes.status} ${JSON.stringify(lookupRes.data)}`); return }
  PASS(`lookup ok — firm_name="${lookupRes.data.firm_name}"`)

  console.log('\n[3] client signs in + accepts')
  const clientToken = await signIn(CLIENT)
  PASS(`client session token (len ${clientToken.length})`)

  const acceptRes = await api('ctb_accept_invite_token', { token: clientToken, body: { token } })
  if (acceptRes.status !== 200 || !acceptRes.data.ok) { FAIL(`accept: ${acceptRes.status} ${JSON.stringify(acceptRes.data)}`); return }
  PASS(`accept ok — staff_user_created=${acceptRes.data.staff_user_created}, firm_name="${acceptRes.data.firm_name}"`)

  console.log('\n[4] DB side-effects')
  const sb = createClient(SB_URL, SB_SERVICE)
  const { data: ac } = await sb.from('accounting_clients').select('id, shared_business_id, access_granted, invite_token, invite_expires_at').eq('id', inviteRes.data.accounting_client_id).maybeSingle()
  if (ac?.shared_business_id !== CLIENT.biz_id) FAIL(`shared_business_id wrong: ${ac?.shared_business_id}`)
  else PASS(`accounting_clients.shared_business_id = ${ac.shared_business_id}`)
  if (!ac?.access_granted) FAIL('access_granted=false'); else PASS('access_granted=true')
  if (ac?.invite_token !== null) FAIL(`invite_token NOT consumed: ${ac?.invite_token?.slice(0,10)}…`); else PASS('invite_token nulled (single-use consumed)')

  const { data: firm } = await sb.from('businesses').select('owner_id').eq('id', FIRM.biz_id).maybeSingle()
  const { data: staffRow } = await sb.from('staff').select('id, role, auth_user_id, business_id, username').eq('business_id', CLIENT.biz_id).eq('auth_user_id', firm.owner_id).maybeSingle()
  if (!staffRow) FAIL('no staff row in client tenant for firm.owner_id')
  else if (staffRow.role !== 'accountant') FAIL(`staff role wrong: ${staffRow.role}`)
  else PASS(`staff row created (id=${staffRow.id}, role=${staffRow.role}, username=${staffRow.username})`)

  console.log('\n[5] error log check')
  await new Promise(r => setTimeout(r, 2000)) // give report-error any in-flight chance to land
  const errs = await newErrorsSince(baseline)
  if (errs.length === 0) PASS('0 new client_errors during flow')
  else {
    FAIL(`${errs.length} new client_errors:`)
    errs.forEach(e => console.log(`     [${e.severity}] ${e.route} → ${e.message?.slice(0, 200)}`))
  }

  console.log('\n=== done ===')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
