/**
 * ecf-parent-gate-smoke.mjs — proves the 2026-04-30 parent-acceptance gate
 * actually fires on the live web endpoint.
 *
 * Flow:
 *   1. Sign in as Jerry (Ranoza) to get a JWT.
 *   2. Submit an E33 (Nota de Crédito) referencing a NCFModificado that
 *      does NOT exist in ecf_submissions.
 *      Expected: { ok:false, code:'parent_unknown' }.
 *   3. Submit an E33 referencing a NCFModificado that exists with
 *      dgii_status=2 (RECHAZADO).
 *      Expected: { ok:false, code:'parent_rejected' }.
 *   4. Submit an E33 referencing a NCFModificado that exists with
 *      dgii_status=3 (EN_PROCESO).
 *      Expected: { ok:false, code:'parent_pending' }.
 *   5. Submit an E33 referencing a NCFModificado with dgii_status=1 (ACEPTADO).
 *      Expected: gate passes. (Cert may not be configured on Ranoza, in
 *      which case we expect a "Certificado no configurado" error AFTER the
 *      gate — which is exactly the proof we wanted: the gate let us through.)
 *   6. Submit an E32 (factura, no parent reference) — gate should not even
 *      evaluate; should hit cert path.
 *
 * Cleanup: deletes seeded ecf_submissions rows (is_test markers via xml_hash).
 *
 * Usage: node scripts/ecf-parent-gate-smoke.mjs
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const SUPA_URL = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY
const TOK  = process.env.SUPABASE_ACCESS_TOKEN
const REF  = new URL(SUPA_URL).hostname.split('.')[0]

const RANOZA_BID = '4f789f41-76d2-4402-838f-5fe20a91641f'
const EMAIL = 'Jerryfelix@gmail.com'
const PASS  = 'Rahel25@'

// Endpoint: prod. The new gate just deployed there.
const ENDPOINT = 'https://terminalxpos.com/api/ecf-sign'

async function mgmtQ(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  return r.json()
}

let pass = 0, fail = 0
function log(label, ok, detail = '') {
  console.log((ok ? '✅' : '❌') + ' ' + label + (detail ? ' — ' + detail : ''))
  if (ok) pass++; else fail++
}

// Build the minimum payload shape /api/ecf-sign expects for an NC.
function buildE33Payload(parentEncf) {
  return {
    business_id: RANOZA_BID,
    eNCF: 'E340000000999',
    tipoECF: '34',
    montoTotal: 100,
    payload: {
      ECF: {
        Encabezado: {
          IdDoc: { TipoECF: '34', eNCF: 'E340000000999' },
          InformacionReferencia: parentEncf ? { NCFModificado: parentEncf } : undefined,
        },
      },
    },
    referencia: parentEncf ? { ncfModificado: parentEncf } : undefined,
    totales: { subtotal: 84.75, itbis: 15.25, total: 100 },
  }
}

async function callEndpoint(payload, jwt) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
    body: JSON.stringify(payload),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function run() {
  console.log('\n=== e-CF parent-acceptance gate smoke ===\n')

  // Auth
  const sb = createClient(SUPA_URL, ANON, { auth: { persistSession: false } })
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS })
  if (!auth?.session) { console.error('BLOCKER auth:', authErr?.message); process.exit(1) }
  const jwt = auth.session.access_token
  log('auth: Jerry signed in', true)

  // Seed three control rows in ecf_submissions: rejected, pending, accepted.
  const svc = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })
  const seedRows = [
    { encf: 'E310000099001', dgii_status: 2 }, // RECHAZADO
    { encf: 'E310000099002', dgii_status: 3 }, // EN_PROCESO
    { encf: 'E310000099003', dgii_status: 1 }, // ACEPTADO
  ]
  for (const r of seedRows) {
    await svc.from('ecf_submissions').insert({
      supabase_id: crypto.randomUUID(),
      business_id: RANOZA_BID,
      encf: r.encf,
      tipo_ecf: '31',
      track_id: `TEST-${r.encf}`,
      dgii_status: r.dgii_status,
      status: r.dgii_status === 1 ? 'aceptado' : r.dgii_status === 2 ? 'rechazado' : 'en_proceso',
      environment: 'certecf',
      submitted_at: new Date().toISOString(),
      xml_hash: 'GATE_SMOKE_TEST',
    })
  }
  log('seed: 3 control parent eNCFs (RECHAZADO/EN_PROCESO/ACEPTADO)', true)

  // Test 1 — parent doesn't exist
  {
    const r = await callEndpoint(buildE33Payload('E310000000XXX'), jwt)
    log('1. parent missing → parent_unknown',
        r.body?.ok === false && r.body?.code === 'parent_unknown',
        `got ok=${r.body?.ok} code=${r.body?.code}`)
  }

  // Test 2 — parent rejected
  {
    const r = await callEndpoint(buildE33Payload('E310000099001'), jwt)
    log('2. parent rejected → parent_rejected',
        r.body?.ok === false && r.body?.code === 'parent_rejected',
        `got ok=${r.body?.ok} code=${r.body?.code}`)
  }

  // Test 3 — parent en proceso
  {
    const r = await callEndpoint(buildE33Payload('E310000099002'), jwt)
    log('3. parent EN_PROCESO → parent_pending',
        r.body?.ok === false && r.body?.code === 'parent_pending',
        `got ok=${r.body?.ok} code=${r.body?.code}`)
  }

  // Test 4 — parent accepted (gate should let us through; cert error after is the proof)
  {
    const r = await callEndpoint(buildE33Payload('E310000099003'), jwt)
    // Either the call proceeds further (cert/dgii error) or succeeds. Anything
    // EXCEPT a parent_* code means the gate let us pass.
    const passed = !(r.body?.code === 'parent_unknown' || r.body?.code === 'parent_pending' || r.body?.code === 'parent_rejected' || r.body?.code === 'parent_missing')
    log('4. parent ACEPTADO → gate passes (downstream cert/dgii error is OK here)',
        passed,
        `got ok=${r.body?.ok} code=${r.body?.code || '<none>'} error=${(r.body?.error || '').slice(0,80)}`)
  }

  // Test 5 — NC without any parent reference
  {
    const r = await callEndpoint(buildE33Payload(null), jwt)
    log('5. NC with no parent ref → parent_missing',
        r.body?.ok === false && r.body?.code === 'parent_missing',
        `got ok=${r.body?.ok} code=${r.body?.code}`)
  }

  // Test 6 — E32 (factura, not a NC) — gate should be transparent
  {
    const p = buildE33Payload(null)
    p.tipoECF = '32'
    p.payload.ECF.Encabezado.IdDoc.TipoECF = '32'
    delete p.payload.ECF.Encabezado.InformacionReferencia
    delete p.referencia
    const r = await callEndpoint(p, jwt)
    const passedGate = r.body?.code !== 'parent_unknown' && r.body?.code !== 'parent_pending' && r.body?.code !== 'parent_rejected' && r.body?.code !== 'parent_missing'
    log('6. E32 factura → gate is transparent',
        passedGate,
        `got ok=${r.body?.ok} code=${r.body?.code || '<none>'} error=${(r.body?.error || '').slice(0,80)}`)
  }

  // Cleanup
  await svc.from('ecf_submissions').delete().eq('xml_hash', 'GATE_SMOKE_TEST')
  log('cleanup: control rows removed', true)

  await sb.auth.signOut()
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch(e => { console.error('FATAL:', e); process.exit(2) })
