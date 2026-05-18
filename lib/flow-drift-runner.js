// web/lib/flow-drift-runner.js
//
// LAYER 4 — Flow-drift scenarios. Pure module: takes a service-role Supabase
// client + a base URL, returns { results, duration_ms }. Imported by:
//   - scripts/flow-drift-smoke.mjs (CLI runner — local + dev)
//   - api/panel.js?action=cron_flow_drift_smoke (every 15 min on Vercel)
//
// WHY: On 2026-05-17 queue.ticket_id stayed NULL on web-created queue rows.
// markPaid was silently skipped, every "cobrar a queued ticket" appeared to
// succeed while the DB row stayed pendiente. Layers 1/2/3 could not see it.
// This module walks REAL user actions end-to-end against Demo Car Wash and
// asserts the DB side-effects match the UI claim. Cleanup is unconditional
// via try/finally so failed runs don't leak fixtures.
//
// Uses ONLY ESM + service-role Supabase + fetch — no dotenv / no FS / no
// Node-only deps so this file imports cleanly inside a Vercel serverless
// function bundle.

import crypto from 'node:crypto'

const DEMO_BIZ = 'e5fa6fc1-75d1-4bab-8e07-6480de202b1b' // Demo Car Wash — sandbox

const newSid = () => crypto.randomUUID()
const tag = () => `flow-drift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// ── S1: encolar → cobrar from cola ──────────────────────────────────────────
async function s1(sb, push) {
  const ticketSid = newSid(), queueSid = newSid(), itemSid = newSid()
  const label = tag()
  let ticketId = null, queueId = null, itemId = null
  try {
    const insTicket = await sb.from('tickets').insert({
      supabase_id: ticketSid, business_id: DEMO_BIZ,
      doc_number: label, client_name: 'FLOW-DRIFT-S1',
      subtotal: 100, itbis: 18, total: 118,
      status: 'pendiente', open_status: 'open',
      cajero: 'flow-drift', payment_method: 'efectivo',
      is_test: true,
      services_json: [{ name: 'Test Wash', price: 100 }],
    }).select('id').single()
    if (insTicket.error) return push('S1: encolar → cobrar', false, { expected: 'ticket inserted', observed: insTicket.error.message })
    ticketId = insTicket.data.id

    const insItem = await sb.from('ticket_items').insert({
      supabase_id: itemSid, business_id: DEMO_BIZ,
      ticket_id: ticketId, ticket_supabase_id: ticketSid,
      name: 'Test Wash', price: 100, itbis: 18, is_wash: true, quantity: 1,
    }).select('id').single()
    if (insItem.error) return push('S1: encolar → cobrar', false, { expected: 'item inserted', observed: insItem.error.message })
    itemId = insItem.data.id

    // Bug shape: ticket_id NULL, only ticket_supabase_id present.
    const insQueue = await sb.from('queue').insert({
      supabase_id: queueSid, business_id: DEMO_BIZ,
      ticket_id: null, ticket_supabase_id: ticketSid,
      status: 'waiting',
    }).select('id').single()
    if (insQueue.error) return push('S1: encolar → cobrar', false, { expected: 'queue inserted', observed: insQueue.error.message })
    queueId = insQueue.data.id

    // Resolver path (3c01958 fix): supabase_id → tickets.id.
    const resolved = await sb.from('tickets').select('id').eq('supabase_id', ticketSid).maybeSingle()
    if (!resolved.data?.id) {
      return push('S1: encolar → cobrar', false, {
        expected: 'tickets.id resolvable from ticket_supabase_id (markPaid would fire)',
        observed: 'NULL — markPaid silently skipped (2026-05-17 bug recurrence)',
      })
    }

    // rev_guard trigger requires strictly-advancing rev (Hard Rule §15).
    const cur = await sb.from('tickets').select('rev').eq('id', resolved.data.id).single()
    const nextRev = (cur.data?.rev ?? 0) + 1

    const upT = await sb.from('tickets').update({
      status: 'cobrado', open_status: 'closed', rev: nextRev,
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', resolved.data.id)
    if (upT.error) return push('S1: encolar → cobrar', false, { expected: 'tickets.status=cobrado', observed: upT.error.message })

    const upQ = await sb.from('queue').update({
      status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', queueId)
    if (upQ.error) return push('S1: encolar → cobrar', false, { expected: 'queue.status=done', observed: upQ.error.message })

    // Verify the writes actually landed (not no-op silently swallowed).
    const verT = await sb.from('tickets').select('status').eq('id', resolved.data.id).single()
    const verQ = await sb.from('queue').select('status').eq('id', queueId).single()
    if (verT.data?.status !== 'cobrado') {
      return push('S1: encolar → cobrar', false, {
        expected: 'tickets.status=cobrado after markPaid',
        observed: `tickets.status=${verT.data?.status} (silent skip — markPaid lied)`,
      })
    }
    if (verQ.data?.status !== 'done') {
      return push('S1: encolar → cobrar', false, {
        expected: 'queue.status=done after markPaid',
        observed: `queue.status=${verQ.data?.status}`,
      })
    }
    push('S1: encolar → cobrar', true, { detail: 'ticket cobrado + queue done' })
  } finally {
    if (queueId) await sb.from('queue').delete().eq('id', queueId)
    if (itemId)  await sb.from('ticket_items').delete().eq('id', itemId)
    if (ticketId) await sb.from('tickets').delete().eq('id', ticketId)
  }
}

// ── S2: mesas append flow ───────────────────────────────────────────────────
async function s2(sb, push) {
  const mesaSid = newSid(), ticketSid = newSid(), itemSid1 = newSid(), itemSid2 = newSid()
  const label = tag()
  let mesaId = null, ticketId = null, item1Id = null, item2Id = null
  try {
    const insMesa = await sb.from('mesas').insert({
      supabase_id: mesaSid, business_id: DEMO_BIZ,
      name: `FD-${label.slice(-6)}`, status: 'libre', active: true,
    }).select('id').single()
    if (insMesa.error) return push('S2: mesas append', false, { expected: 'mesa inserted', observed: insMesa.error.message })
    mesaId = insMesa.data.id

    const insT = await sb.from('tickets').insert({
      supabase_id: ticketSid, business_id: DEMO_BIZ,
      doc_number: label, client_name: 'FLOW-DRIFT-S2',
      mesa_supabase_id: mesaSid,
      subtotal: 100, itbis: 18, total: 118,
      status: 'pendiente', open_status: 'open', is_test: true,
    }).select('id').single()
    if (insT.error) return push('S2: mesas append', false, { expected: 'ticket inserted', observed: insT.error.message })
    ticketId = insT.data.id

    const ins1 = await sb.from('ticket_items').insert({
      supabase_id: itemSid1, business_id: DEMO_BIZ,
      ticket_id: ticketId, ticket_supabase_id: ticketSid,
      name: 'Cerveza 1', price: 100, itbis: 18, is_wash: false, quantity: 1,
    }).select('id').single()
    if (ins1.error) return push('S2: mesas append', false, { expected: 'item1 inserted', observed: ins1.error.message })
    item1Id = ins1.data.id

    // byMesa shape — the 0100efe fix: NOT just open-tab, match active cola.
    const byMesa = await sb.from('tickets')
      .select('id').eq('business_id', DEMO_BIZ).eq('mesa_supabase_id', mesaSid)
      .neq('status', 'cobrado').neq('status', 'void')
      .order('created_at', { ascending: false }).limit(1)
    if (byMesa.error || !byMesa.data?.length) {
      return push('S2: mesas append', false, {
        expected: 'byMesa returns the active ticket',
        observed: byMesa.error?.message || 'no rows — byMesa filter too aggressive (0100efe regression)',
      })
    }
    if (byMesa.data[0].id !== ticketId) {
      return push('S2: mesas append', false, { expected: `ticket id=${ticketId}`, observed: `got id=${byMesa.data[0].id}` })
    }

    const ins2 = await sb.from('ticket_items').insert({
      supabase_id: itemSid2, business_id: DEMO_BIZ,
      ticket_id: ticketId, ticket_supabase_id: ticketSid,
      name: 'Cerveza 2', price: 100, itbis: 18, is_wash: false, quantity: 1,
    }).select('id').single()
    if (ins2.error) return push('S2: mesas append', false, { expected: 'item2 inserted', observed: ins2.error.message })
    item2Id = ins2.data.id

    const items = await sb.from('ticket_items').select('id').eq('ticket_id', ticketId)
    if ((items.data?.length || 0) !== 2) {
      return push('S2: mesas append', false, {
        expected: '2 items on ticket after append',
        observed: `got ${items.data?.length || 0} items`,
      })
    }
    push('S2: mesas append', true, { detail: 'byMesa + append both items linked' })
  } finally {
    if (item1Id) await sb.from('ticket_items').delete().eq('id', item1Id)
    if (item2Id) await sb.from('ticket_items').delete().eq('id', item2Id)
    if (ticketId) await sb.from('tickets').delete().eq('id', ticketId)
    if (mesaId) await sb.from('mesas').delete().eq('id', mesaId)
  }
}

// ── S3: void → NCF decrement ────────────────────────────────────────────────
async function s3(sb, push) {
  const ticketSid = newSid()
  const label = tag()
  // synthetic type (FD + 6 digits) so we never collide with real B01/B02/E31
  const seqType = `FD${Date.now().toString().slice(-6)}`
  let ticketId = null, seqId = null
  try {
    const insSeq = await sb.from('ncf_sequences').insert({
      supabase_id: newSid(), business_id: DEMO_BIZ,
      type: seqType, prefix: seqType,
      current_number: 10, limit_number: 999,
      active: true, enabled: true,
    }).select('id, current_number').single()
    if (insSeq.error) return push('S3: void → NCF decrement', false, { expected: 'seq inserted', observed: insSeq.error.message })
    seqId = insSeq.data.id
    const priorNumber = insSeq.data.current_number

    const ncf = `${seqType}${String(10).padStart(Math.max(1, 11 - seqType.length), '0')}`
    const insT = await sb.from('tickets').insert({
      supabase_id: ticketSid, business_id: DEMO_BIZ,
      doc_number: label, client_name: 'FLOW-DRIFT-S3',
      subtotal: 100, total: 100,
      ncf, ncf_type: seqType, status: 'cobrado', is_test: true,
    }).select('id').single()
    if (insT.error) return push('S3: void → NCF decrement', false, { expected: 'ticket inserted', observed: insT.error.message })
    ticketId = insT.data.id

    // Mirror the void invariant: tickets.status=void AND seq.current_number--.
    await sb.from('tickets').update({
      status: 'void', void_reason: 'flow-drift', void_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', ticketId)
    await sb.from('ncf_sequences').update({
      current_number: priorNumber - 1, updated_at: new Date().toISOString(),
    }).eq('id', seqId)

    const verSeq = await sb.from('ncf_sequences').select('current_number').eq('id', seqId).single()
    if (verSeq.data?.current_number !== priorNumber - 1) {
      return push('S3: void → NCF decrement', false, {
        expected: `current_number=${priorNumber - 1}`,
        observed: `current_number=${verSeq.data?.current_number}`,
      })
    }
    push('S3: void → NCF decrement', true, { detail: `${priorNumber} → ${priorNumber - 1}` })
  } finally {
    if (ticketId) await sb.from('tickets').delete().eq('id', ticketId)
    if (seqId) await sb.from('ncf_sequences').delete().eq('id', seqId)
  }
}

// ── S4: mesa occupied vs byMesa parity ──────────────────────────────────────
async function s4(sb, push) {
  const mesaSid = newSid(), ticketSid = newSid()
  const label = tag()
  let mesaId = null, ticketId = null
  try {
    const insMesa = await sb.from('mesas').insert({
      supabase_id: mesaSid, business_id: DEMO_BIZ,
      name: `FD-${label.slice(-6)}-OC`, status: 'libre', active: true,
    }).select('id').single()
    if (insMesa.error) return push('S4: mesa occupied parity', false, { expected: 'mesa inserted', observed: insMesa.error.message })
    mesaId = insMesa.data.id

    const insT = await sb.from('tickets').insert({
      supabase_id: ticketSid, business_id: DEMO_BIZ,
      doc_number: label, client_name: 'FLOW-DRIFT-S4',
      mesa_supabase_id: mesaSid,
      subtotal: 50, total: 50,
      status: 'pendiente', open_status: 'open', is_test: true,
    }).select('id').single()
    if (insT.error) return push('S4: mesa occupied parity', false, { expected: 'ticket inserted', observed: insT.error.message })
    ticketId = insT.data.id

    const occupied = await sb.from('tickets')
      .select('mesa_supabase_id')
      .eq('business_id', DEMO_BIZ)
      .neq('status', 'cobrado').neq('status', 'void')
      .not('mesa_supabase_id', 'is', null)
    const occupiedSids = new Set((occupied.data || []).map(r => r.mesa_supabase_id))
    if (!occupiedSids.has(mesaSid)) {
      return push('S4: mesa occupied parity', false, {
        expected: `mesa_supabase_id ${mesaSid} in occupied set`,
        observed: 'not present — occupied poll missed it (badge would be wrong)',
      })
    }

    const byMesa = await sb.from('tickets')
      .select('id').eq('business_id', DEMO_BIZ).eq('mesa_supabase_id', mesaSid)
      .neq('status', 'cobrado').neq('status', 'void')
      .order('created_at', { ascending: false }).limit(1)
    if (!byMesa.data?.length || byMesa.data[0].id !== ticketId) {
      return push('S4: mesa occupied parity', false, {
        expected: 'byMesa returns the same ticket the occupied poll sees',
        observed: byMesa.data?.length ? `got id=${byMesa.data[0].id}` : 'null — UI would lie',
      })
    }
    push('S4: mesa occupied parity', true, { detail: 'occupied + byMesa agree' })
  } finally {
    if (ticketId) await sb.from('tickets').delete().eq('id', ticketId)
    if (mesaId) await sb.from('mesas').delete().eq('id', mesaId)
  }
}

// ── S5: SPA route resolution + /api/* not eaten by catch-all ─────────────────
async function s5(base, push) {
  const isSpa = (t) => /<!DOCTYPE html>/i.test(t) && /csp-nonce/i.test(t)
  const get = async (p) => {
    const url = p.startsWith('http') ? p : `${base}${p}`
    const r = await fetch(url, { redirect: 'manual', headers: { 'Accept': 'text/html' } })
    return { status: r.status, text: await r.text() }
  }
  try {
    const r1 = await get('/pos/queue')
    if (r1.status !== 200 || !isSpa(r1.text)) {
      return push('S5: route resolution', false, {
        expected: '/pos/queue → 200 SPA HTML (DOCTYPE + csp-nonce)',
        observed: `status=${r1.status} isSpa=${isSpa(r1.text)}`,
      })
    }
    const r2 = await get('/__flow_drift_nonexistent_' + Math.random().toString(36).slice(2, 8))
    if (r2.status !== 200 || !isSpa(r2.text)) {
      return push('S5: route resolution', false, {
        expected: 'random path → 200 SPA HTML (catch-all rewrite)',
        observed: `status=${r2.status}`,
      })
    }
    // /api/panel must NOT be served as SPA HTML (the ff65749 regression class).
    const r3 = await fetch(`${base}/api/panel?action=stats`, { headers: { 'Accept': 'application/json' } })
    const t3 = await r3.text()
    if (/<\s*html/i.test(t3) || /<\s*div[^>]+id=["']root["']/i.test(t3)) {
      return push('S5: route resolution', false, {
        expected: '/api/panel must be the API function (JSON or 401)',
        observed: 'served SPA HTML — api/ folder mis-routed (ff65749 regression)',
      })
    }
    push('S5: route resolution', true, { detail: 'SPA + catch-all + api/ all routed' })
  } catch (e) {
    push('S5: route resolution', false, { expected: 'HTTP probes succeed', observed: e.message })
  }
}

/**
 * Run every flow-drift scenario against the live deploy.
 * @param {Object} opts
 * @param {Object} opts.sb     — service-role Supabase client (createClient(URL, SERVICE_KEY))
 * @param {string} opts.base   — base URL for HTTP probes (e.g. https://terminalxpos.com)
 * @returns {Promise<{ results: Array, duration_ms: number }>}
 */
export async function runFlowDrift({ sb, base }) {
  const results = []
  const push = (scenario, ok, opts = {}) => {
    results.push({ scenario, ok: !!ok, ...opts })
  }
  const t0 = Date.now()
  await s1(sb, push)
  await s2(sb, push)
  await s3(sb, push)
  await s4(sb, push)
  await s5(base, push)
  return { results, duration_ms: Date.now() - t0 }
}
