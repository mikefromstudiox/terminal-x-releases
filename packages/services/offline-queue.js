/**
 * offline-queue.js — IndexedDB-based offline queue for the Terminal X web/PWA.
 *
 * Stores tickets and e-CF submissions that failed due to network issues,
 * then syncs them automatically when connectivity is restored.
 */

import { openDB } from 'idb'

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const DB_NAME    = 'terminal-x-offline'
// v2: + pending_whatsapp_reminders + pending_whatsapp_reminders_failed (Phase 4d)
const DB_VERSION = 2

let dbPromise = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('pending_tickets')) {
          const tickets = db.createObjectStore('pending_tickets', { keyPath: 'id', autoIncrement: true })
          tickets.createIndex('status', 'status')
        }
        if (!db.objectStoreNames.contains('pending_ecf')) {
          const ecf = db.createObjectStore('pending_ecf', { keyPath: 'id', autoIncrement: true })
          ecf.createIndex('status', 'status')
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('pending_whatsapp_reminders')) {
            const wa = db.createObjectStore('pending_whatsapp_reminders', { keyPath: 'id', autoIncrement: true })
            wa.createIndex('business_id', 'business_id')
            wa.createIndex('fire_at', 'fire_at')
          }
          if (!db.objectStoreNames.contains('pending_whatsapp_reminders_failed')) {
            db.createObjectStore('pending_whatsapp_reminders_failed', { keyPath: 'id', autoIncrement: true })
          }
        }
      },
    })
  }
  return dbPromise
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now() {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export async function enqueueTicket(ticketData) {
  const db = await getDB()
  return db.add('pending_tickets', {
    payload:   ticketData,
    status:    'pending',
    attempts:  0,
    createdAt: now(),
    lastError: null,
  })
}

export async function getPendingTickets() {
  const db = await getDB()
  const all = await db.getAll('pending_tickets')
  return all.filter(t => t.status === 'pending')
}

export async function markTicketSynced(id) {
  const db = await getDB()
  return db.delete('pending_tickets', id)
}

// ---------------------------------------------------------------------------
// e-CF
// ---------------------------------------------------------------------------

export async function enqueueECF(payload) {
  const db = await getDB()
  return db.add('pending_ecf', {
    payload,
    status:    'pending',
    attempts:  0,
    createdAt: now(),
    lastError: null,
  })
}

// v2.16.3 — exponential backoff config for the e-CF queue.
//   - Max 8 attempts (was 5). After the 8th failure the row is marked
//     status='dead' (NOT deleted — kept for forensics) and an audit row is
//     emitted via the activity-log queue (which itself has an IDB fallback,
//     so dead-letter audits survive offline).
//   - Backoff: 30s, 60s, 2m, 4m, 8m, 16m, 30m, 30m (capped). Drains skip rows
//     whose nextAttemptAt is still in the future.
const ECF_MAX_ATTEMPTS  = 8
const ECF_BACKOFF_BASE  = 30_000          // 30s
const ECF_BACKOFF_CAP   = 30 * 60_000     // 30m

function _ecfBackoffMs(attempts) {
  return Math.min(ECF_BACKOFF_CAP, ECF_BACKOFF_BASE * Math.pow(2, Math.max(0, attempts - 1)))
}

export async function getPendingECFs() {
  const db = await getDB()
  const all = await db.getAll('pending_ecf')
  const t = Date.now()
  return all.filter(e =>
    e.status === 'pending'
    && (e.attempts || 0) < ECF_MAX_ATTEMPTS
    && (Number(e.nextAttemptAt) || 0) <= t
  )
}

export async function markECFSent(id) {
  const db = await getDB()
  return db.delete('pending_ecf', id)
}

// v2.16.3 — emit a "dead-letter" audit row when a queued e-CF exhausts its
// retries. Lazy-loaded to avoid pulling the supabase client into the offline
// bundle path (the activity-log queue itself has its own IDB fallback so
// this still works while offline).
async function _emitEcfDeadAudit(item) {
  try {
    const mod = await import('./activity-log-queue.js').catch(() => null)
    if (!mod || typeof mod.enqueueActivity !== 'function') return
    await mod.enqueueActivity({
      event_type: 'ecf_queue_dead',
      severity:   'critical',
      target_type: 'ecf',
      target_id:   String(item?.id ?? ''),
      reason:      'e-CF queue exhausted retries (8 attempts)',
      metadata: {
        attempts:   item?.attempts ?? null,
        last_error: item?.lastError ?? null,
        created_at: item?.createdAt ?? null,
        died_at:    now(),
        // Keep just the head of the payload so the audit row stays small but
        // forensically useful (eNCF, RNC, total are all in here).
        payload_preview: item?.payload ? JSON.stringify(item.payload).slice(0, 1024) : null,
      },
    })
  } catch (e) {
    console.error('[offline-queue] dead-letter audit emit failed:', e?.message || e)
  }
}

export async function markECFFailed(id, error) {
  const db = await getDB()
  const item = await db.get('pending_ecf', id)
  if (!item) return
  item.attempts = (item.attempts || 0) + 1
  item.lastError = typeof error === 'string' ? error : (error?.message || String(error))
  item.last_attempt_at = now()
  // Schedule next attempt with exponential backoff (drains skip until then).
  item.nextAttemptAt = Date.now() + _ecfBackoffMs(item.attempts)
  if (item.attempts >= ECF_MAX_ATTEMPTS) {
    // Dead-letter — keep the row for forensics, but stop draining and emit
    // an activity_log critical so owners see it on the dashboard.
    item.status = 'dead'
    item.diedAt = now()
    await _emitEcfDeadAudit(item)
  }
  return db.put('pending_ecf', item)
}

// ---------------------------------------------------------------------------
// WhatsApp reminders (Phase 4d) — independent stream from e-CF.
// PlanGated: salon_offline_whatsapp_queue (Pro MAX). The renderer calls
// setOfflineQueuePlanGate(fn) once on boot so non-React code (online/offline
// listeners, polling) can short-circuit without a context.
// ---------------------------------------------------------------------------

// v2.16.2 (item #12) — default deny-all. PlanProvider opts in by calling
// setOfflineQueuePlanGate(fn) on mount. Previously the permissive default
// allowed pre-React enqueues (online/offline listeners firing before React
// mounts) to bypass the plan gate during the boot window.
let _planHasFeature = () => false

export function setOfflineQueuePlanGate(fn) {
  _planHasFeature = typeof fn === 'function' ? fn : (() => false)
}

function waGateOpen() {
  try { return !!_planHasFeature('salon_offline_whatsapp_queue') } catch { return false }
}

/**
 * Enqueue a WhatsApp reminder for offline-deferred send. Returns the IDB id
 * on success, or null when the plan-gate is closed (caller should treat as
 * no-op and surface a "feature not in your plan" message upstream).
 *
 * payload shape:
 *   { business_id, appointment_supabase_id, fire_at, kind, template_vars }
 */
export async function enqueueWhatsappReminder(payload) {
  if (!waGateOpen()) return null
  if (!payload || !payload.appointment_supabase_id || !payload.business_id) {
    throw new Error('enqueueWhatsappReminder: business_id + appointment_supabase_id required')
  }
  const db = await getDB()
  return db.add('pending_whatsapp_reminders', {
    business_id:             String(payload.business_id),
    appointment_supabase_id: String(payload.appointment_supabase_id),
    fire_at:                 payload.fire_at || now(),
    kind:                    payload.kind || 'manual',
    template_vars:           payload.template_vars || {},
    attempts:                0,
    last_attempt_at:         null,
    last_error:              null,
    createdAt:               now(),
  })
}

export async function getPendingWhatsappReminders() {
  const db = await getDB()
  const all = await db.getAll('pending_whatsapp_reminders')
  // v2.16.2 (item #14) — exponential backoff. Skip rows whose nextAttemptAt
  // is still in the future so a 5xx storm doesn't burn all 5 retries in one
  // drain cycle. Cap is enforced at write time (markWhatsappReminderFailed).
  const t = Date.now()
  return all.filter(r => (r.attempts || 0) < 5 && (Number(r.nextAttemptAt) || 0) <= t)
}

export async function markWhatsappReminderSent(id) {
  const db = await getDB()
  return db.delete('pending_whatsapp_reminders', id)
}

export async function markWhatsappReminderFailed(id, error) {
  const db = await getDB()
  const item = await db.get('pending_whatsapp_reminders', id)
  if (!item) return
  item.attempts = (item.attempts || 0) + 1
  item.last_attempt_at = now()
  item.last_error = typeof error === 'string' ? error : (error?.message || String(error))
  // v2.16.2 (item #14) — exponential backoff capped at 30 minutes. The drain
  // helper skips rows whose nextAttemptAt is still in the future.
  const backoffMs = Math.min(30 * 60 * 1000, 30_000 * Math.pow(2, item.attempts))
  item.nextAttemptAt = Date.now() + backoffMs
  if (item.attempts >= 5) {
    // Dead-letter: move to the failed store and drop from the live queue.
    try {
      await db.add('pending_whatsapp_reminders_failed', {
        ...item,
        movedAt: now(),
      })
    } catch {}
    return db.delete('pending_whatsapp_reminders', id)
  }
  return db.put('pending_whatsapp_reminders', item)
}

/**
 * Drain pending WhatsApp reminders by POSTing to the panel.js manual_batch
 * path. Per-row outcome: success -> delete from IDB, failure -> bump attempts.
 *
 * supabaseClient is optional; only used to lift the JWT for the Authorization
 * header (the panel endpoint authenticates via the supabase JWT just like
 * salon-whatsapp-send-now). When no JWT is available we abort silently.
 */
export async function drainWhatsappReminders(supabaseClient, panelUrl = '/api/panel') {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (!waGateOpen()) return
    const pending = await getPendingWhatsappReminders()
    if (!pending.length) return

    let jwt = null
    try {
      const sess = await supabaseClient?.auth?.getSession?.()
      jwt = sess?.data?.session?.access_token || null
    } catch {}
    if (!jwt) return  // can't auth -> leave queue intact for next cycle

    const reminders = pending.map(p => ({
      appointment_supabase_id: p.appointment_supabase_id,
      kind:                    p.kind,
      template_vars:           p.template_vars || {},
    }))

    let json = null
    try {
      const r = await fetch(`${panelUrl}?action=salon-whatsapp-reminder-tick`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body:    JSON.stringify({ manual_batch: true, reminders }),
      })
      if (!r.ok) throw new Error(`panel ${r.status}`)
      json = await r.json()
    } catch (e) {
      // Network/transport failure -> bump attempts on every row, keep them.
      for (const p of pending) {
        try { await markWhatsappReminderFailed(p.id, e) } catch {}
      }
      return
    }

    const results = Array.isArray(json?.results) ? json.results : []
    const byId = new Map(results.map(r => [r.appointment_supabase_id, r]))
    for (const p of pending) {
      const r = byId.get(p.appointment_supabase_id)
      if (r && r.ok) {
        try { await markWhatsappReminderSent(p.id) } catch {}
      } else {
        try { await markWhatsappReminderFailed(p.id, r?.error || 'no_result') } catch {}
      }
    }
  } catch {
    // Never throw from drain.
  }
}

/**
 * Convenience wrapper for callers that want fire-and-forget semantics:
 * if online + gated, POST direct via salon-whatsapp-send-now; if offline,
 * enqueue. Returns { sent, queued, gated }.
 *
 * payload: { business_id, appointment_supabase_id, kind, template_vars, fire_at? }
 */
export async function sendOrQueueWhatsappReminder(payload, opts = {}) {
  const { supabaseClient, panelUrl = '/api/panel' } = opts
  if (!waGateOpen()) return { sent: false, queued: false, gated: true }

  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  if (online) {
    try {
      let jwt = null
      try {
        const sess = await supabaseClient?.auth?.getSession?.()
        jwt = sess?.data?.session?.access_token || null
      } catch {}
      if (jwt) {
        const r = await fetch(`${panelUrl}?action=salon-whatsapp-send-now`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body:    JSON.stringify({ appointment_supabase_id: payload.appointment_supabase_id }),
        })
        if (r.ok) return { sent: true, queued: false, gated: false }
      }
    } catch {}
  }
  // Offline or send-now failed -> queue.
  await enqueueWhatsappReminder(payload)
  return { sent: false, queued: true, gated: false }
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export async function getQueueCounts() {
  const db = await getDB()
  const tickets  = (await db.getAll('pending_tickets')).filter(t => t.status === 'pending').length
  const ecf      = (await db.getAll('pending_ecf')).filter(e => e.status === 'pending' && (e.attempts || 0) < ECF_MAX_ATTEMPTS).length
  let whatsapp = 0
  let whatsapp_failed = 0
  try {
    whatsapp = (await db.getAll('pending_whatsapp_reminders')).filter(r => (r.attempts || 0) < 5).length
  } catch {}
  // v2.16.1 patch (#13) — surface dead-letter so the UI can offer a retry.
  try {
    whatsapp_failed = (await db.getAll('pending_whatsapp_reminders_failed')).length
  } catch {}
  return { tickets, ecf, whatsapp, whatsapp_failed }
}

// v2.16.1 patch (#13) — list + retry the dead-letter store. UI binds these
// to "Recordatorios fallidos: N" + "Reintentar todos".
export async function getFailedWhatsappReminders() {
  const db = await getDB()
  try { return await db.getAll('pending_whatsapp_reminders_failed') } catch { return [] }
}

export async function retryAllFailedWhatsappReminders() {
  const db = await getDB()
  let restored = 0
  let rows = []
  try { rows = await db.getAll('pending_whatsapp_reminders_failed') } catch { return { restored: 0 } }
  for (const r of rows) {
    try {
      const { id: _id, movedAt: _m, ...rest } = r
      await db.add('pending_whatsapp_reminders', {
        ...rest,
        attempts: 0,
        last_attempt_at: null,
        last_error: null,
      })
      await db.delete('pending_whatsapp_reminders_failed', r.id)
      restored++
    } catch {}
  }
  return { restored }
}

// ---------------------------------------------------------------------------
// Sync — Tickets
// ---------------------------------------------------------------------------

export async function syncPendingTickets(supabase, businessId) {
  try {
    if (!navigator.onLine || !supabase || !businessId) return

    const pending = await getPendingTickets()
    const db = await getDB()
    for (const item of pending) {
      try {
        const data = item.payload

        // v2.16.27 — DUPLICATE-PREVENTION. Two-stage idempotency:
        //  1. Orphan items enqueued by the pre-fix code lack supabase_id.
        //     Discard them — replaying with a fresh UUID would create a
        //     phantom ticket. The original POS click already inserted the
        //     real row; this queued row was the bug.
        //  2. If supabase_id is set, check whether the ticket already exists
        //     in DB (prior cycle inserted it but mark-synced was skipped due
        //     to a side-effect failure). If yes, just markSynced and skip.
        if (!data.supabase_id) {
          await markTicketSynced(item.id)
          continue
        }
        const { data: existing } = await supabase.from('tickets')
          .select('id').eq('business_id', businessId).eq('supabase_id', data.supabase_id).maybeSingle()
        if (existing) {
          await markTicketSynced(item.id)
          continue
        }

        // Generate doc_number
        const { count } = await supabase.from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
        const docNum = `T-${String((count || 0) + 1).padStart(4, '0')}`

        const status = data.tipo_venta === 'credito' || data.payment_method === 'credit' ? 'pendiente' : 'cobrado'

        // v2.16.27 — Go-Live gate parity. The direct INSERT path used to
        // omit `is_test`, so Postgres column DEFAULT FALSE turned every
        // queued/replayed ticket into a "live" row regardless of whether
        // the business had flipped go_live_date. Replicate the same lookup
        // web.js:2603-2613 does so a queued credit-sale during pre-launch
        // replays as is_test=true.
        let _liveWeb = false
        try {
          const { data: gl } = await supabase.from('app_settings')
            .select('value').eq('business_id', businessId).eq('key', 'go_live_date').maybeSingle()
          const v = gl?.value
          if (v) {
            const today = new Date(); today.setHours(0,0,0,0)
            const d = new Date(`${v}T00:00:00`)
            if (!Number.isNaN(d.getTime())) _liveWeb = d.getTime() <= today.getTime()
          }
        } catch {}

        const { data: ticket, error: ticketErr } = await supabase.from('tickets').insert({
          business_id:                  businessId,
          supabase_id:                  data.supabase_id,
          is_test:                      !_liveWeb,
          doc_number:                   docNum,
          client_supabase_id:           data.client_supabase_id || null,
          washer_empleado_supabase_ids: data.washer_empleado_supabase_ids || data.washer_ids || [],
          seller_empleado_supabase_id:  data.seller_empleado_supabase_id || data.seller_supabase_id || null,
          cajero_supabase_id:           data.cajero_supabase_id || null,
          subtotal:         data.subtotal || 0,
          descuento:        data.descuento || 0,
          itbis:            data.itbis || 0,
          ley:              data.ley || 0,
          total:            data.total || 0,
          payment_method:   data.payment_method || 'cash',
          comprobante_type: data.comprobante_type || 'B02',
          ecf_result:       data.ecf_result || {},
          tipo_venta:       data.tipo_venta || 'contado',
          status,
          vehicle_plate:    data.vehicle_plate || null,
          notes:            data.notes || null,
        }).select().single()

        if (ticketErr) throw ticketErr

        // v2.16.27 — Mark synced IMMEDIATELY after the ticket lands. Any
        // downstream side-effect (items / queue / balance) that throws must
        // NOT trigger another replay cycle on this row — that's exactly what
        // was producing the T-0017…T-0021 duplicates. Side-effects are
        // best-effort from here.
        await markTicketSynced(item.id)

        // v2.16.27 — Insert items via the canonical supabase_id-architecture
        // shape. Replay used to write a v2.10 fossil row (only ticket_id +
        // service_id, no ticket_supabase_id, no oferta_supabase_id, no
        // quantity/cost/empleado_supabase_id/inventory_item_supabase_id),
        // so every web read (filtered on ticket_supabase_id) saw zero items
        // even though the rows existed. Mirror web.js:2784-2812 exactly.
        const items = data.items || []
        if (items.length && ticket?.id) {
          const itbisFactor = Number.isFinite(Number(data.itbis_rate))
            ? Number(data.itbis_rate) / 100
            : 0.18
          try {
            await supabase.from('ticket_items').insert(items.map(i => ({
              supabase_id:                  crypto.randomUUID(),
              business_id:                  businessId,
              ticket_id:                    ticket.id,
              ticket_supabase_id:           data.supabase_id,
              service_supabase_id:          i.service_supabase_id || null,
              inventory_item_supabase_id:   i.inventory_item_supabase_id || null,
              empleado_supabase_id:         i.empleado_supabase_id || null,
              oferta_supabase_id:           i.oferta_supabase_id || null,
              course:                       i.course || null,
              guest_number:                 i.guest_number || null,
              preparation_notes:            i.preparation_notes || null,
              name:                         i.name,
              price:                        i.price,
              cost:                         i.cost != null ? Number(i.cost) : 0,
              itbis:                        i.itbis != null
                                              ? Number(i.itbis)
                                              : ((i.aplica_itbis !== 0)
                                                  ? parseFloat((i.price * itbisFactor).toFixed(2))
                                                  : 0),
              is_wash:                      i.is_wash ?? true,
              quantity:                     i.quantity || 1,
              sku:                          i.sku || null,
              weight:                       i.weight != null ? Number(i.weight) : null,
              unit:                         i.unit || null,
              price_per_unit:               i.price_per_unit != null ? Number(i.price_per_unit) : null,
            })))
          } catch (e) { console.warn('[offline-queue] ticket_items insert failed (non-fatal)', e?.message) }

          // v2.16.28 (P1) — DOUBLE-DEDUCT FIX (replay parity). The DB
          // trigger trg_ticket_items_decrement_inventory handles cobrado
          // tickets at INSERT time. For replayed credit sales
          // (status='pendiente') we keep deducting in JS. See web.js
          // tickets.create for the full rationale.
          for (const item of (status === 'cobrado' ? [] : items)) {
            const invSid = item.inventory_item_supabase_id
            if (!invSid) continue
            const qty = item.quantity || 1
            try {
              const { data: inv } = await supabase.from('inventory_items')
                .select('quantity, name').eq('supabase_id', invSid).eq('business_id', businessId).single()
              if (!inv) continue
              const available = Math.max(0, Number(inv.quantity || 0))
              await supabase.from('inventory_items')
                .update({ quantity: Math.max(0, available - qty) })
                .eq('supabase_id', invSid).eq('business_id', businessId)
              if (qty > available) {
                try {
                  await supabase.from('inventory_oversells').insert({
                    supabase_id:        crypto.randomUUID(),
                    business_id:        businessId,
                    ticket_supabase_id: data.supabase_id,
                    item_supabase_id:   invSid,
                    item_name:          inv.name || item.name || null,
                    requested_qty:      qty,
                    actual_qty:         available,
                  })
                } catch (e2) { console.warn('[offline-queue] oversell insert failed', e2?.message) }
              }
            } catch (e) { console.warn('[offline-queue] stock deduction failed', e?.message) }
          }
        }

        // Add to queue (best-effort)
        if (ticket?.id) {
          try {
            const firstWasher = Array.isArray(data.washer_ids) && data.washer_ids[0] ? data.washer_ids[0] : null
            // v2.16.29 (C4) — queue.ticket_supabase_id is a UUID column.
            // Pre-fix code passed `ticket.id` (the INT PK from the just-
            // inserted tickets row), which Postgres rejects with a type
            // cast error. The catch logged a warning but the queue row
            // never existed — every replayed sale produced an orphan
            // pendiente ticket with no queue entry, breaking the carwash
            // queue display + cuadre. Use data.supabase_id (the
            // pre-minted UUID consistent with the ticket row).
            await supabase.from('queue').insert({
              supabase_id:           crypto.randomUUID(),
              business_id:           businessId,
              ticket_supabase_id:    data.supabase_id,
              status:                'waiting',
              empleado_supabase_id:  firstWasher,
            })
          } catch (e) { console.warn('[offline-queue] queue insert failed (non-fatal)', e?.message) }
        }

        // Update client balance for credit (best-effort)
        if (status === 'pendiente' && data.client_id) {
          await supabase.rpc('increment_client_balance', { cid: data.client_id, delta: data.total }).catch(() => {})
        }
      } catch {
        // Individual ticket failed — leave in queue for next cycle
      }
    }
  } catch {
    // Never throw from sync
  }
}

// ---------------------------------------------------------------------------
// Sync — e-CF
// ---------------------------------------------------------------------------

export async function syncPendingECFs(supabase, businessId) {
  try {
    if (!navigator.onLine || !supabase || !businessId) return

    const pending = await getPendingECFs()
    for (const item of pending) {
      try {
        const { data, error } = await supabase.functions.invoke('submit-ecf', {
          body: { ...item.payload, business_id: businessId },
        })
        if (error) throw error
        await markECFSent(item.id)
      } catch (err) {
        await markECFFailed(item.id, err)
      }
    }
  } catch {
    // Never throw from sync
  }
}

// ---------------------------------------------------------------------------
// Auto-sync runner
// ---------------------------------------------------------------------------

let syncInterval = null
let _onOnlineHandler = null

/**
 * Globally cancel any in-flight offline-sync interval + online listener.
 * Called by AuthContext.logout() to guarantee no closure keeps a reference
 * to the (about-to-be-torn-down) Supabase client. Safe to call multiple
 * times / before startOfflineSync was ever invoked.
 */
export function stopOfflineSync() {
  try {
    if (_onOnlineHandler) window.removeEventListener('online', _onOnlineHandler)
  } catch {}
  _onOnlineHandler = null
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null }
}

export function startOfflineSync(supabase, businessId) {
  if (!supabase || !businessId) return

  // Defensive: wipe any prior interval/listener from a previous session so a
  // logout→re-login cycle never ends up with two closures (old client + new).
  stopOfflineSync()

  // Run once immediately if online
  if (navigator.onLine) {
    syncPendingTickets(supabase, businessId)
    syncPendingECFs(supabase, businessId)
    drainWhatsappReminders(supabase)
  }

  // Listen for online events
  const onOnline = () => {
    syncPendingTickets(supabase, businessId)
    syncPendingECFs(supabase, businessId)
    drainWhatsappReminders(supabase)
  }
  _onOnlineHandler = onOnline
  window.addEventListener('online', onOnline)

  // Poll every 60s when online
  syncInterval = setInterval(() => {
    if (navigator.onLine) {
      syncPendingTickets(supabase, businessId)
      syncPendingECFs(supabase, businessId)
      drainWhatsappReminders(supabase)
    }
  }, 60_000)

  // Return cleanup function (used by React useEffect cleanup too)
  return stopOfflineSync
}
