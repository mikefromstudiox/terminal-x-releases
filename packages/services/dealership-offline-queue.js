/**
 * dealership-offline-queue.js — IndexedDB queue for concesionario mutations
 * issued while the web POS is offline (or while a Supabase write transiently
 * fails with a network-class error). Mirrors the persistence approach of
 * offline-queue.js but is kept separate so the existing ticket/e-CF drain
 * loop is not perturbed.
 *
 * Each enqueued row carries the op_type (e.g. `dealership_salesDeals_create`)
 * and the original payload. Replay re-invokes the original mutation through
 * the api facade and deletes the row on success. Five attempts before the row
 * is marked `failed` (still queryable for a manual retry but no longer drained).
 *
 * v2.16.2 — H4.
 */

import { openDB } from 'idb'

const DB_NAME    = 'terminal-x-dealership-offline'
const DB_VERSION = 1
const STORE      = 'pending_ops'

let dbPromise = null
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
          s.createIndex('op_type', 'op_type')
          s.createIndex('status',  'status')
        }
      },
    })
  }
  return dbPromise
}

const now = () => new Date().toISOString()

/** Heuristic — do we treat this thrown error as a network/transport problem? */
export function isNetworkError(err) {
  if (!err) return false
  const msg = String(err?.message || err || '').toLowerCase()
  // Supabase / fetch transports typically raise these strings on offline / timeout.
  return msg.includes('failed to fetch')
      || msg.includes('networkerror')
      || msg.includes('network request failed')
      || msg.includes('load failed')
      || msg.includes('aborted')
      || msg.includes('timeout')
      || err?.name === 'TypeError' && msg.includes('fetch')
}

export async function enqueueDealership({ op_type, payload, ts }) {
  if (!op_type) throw new Error('enqueueDealership: op_type required')
  const db = await getDB()
  return db.add(STORE, {
    op_type,
    payload:   payload ?? null,
    ts:        ts || Date.now(),
    status:    'pending',
    attempts:  0,
    last_error: null,
    createdAt: now(),
  })
}

export async function getPendingDealership() {
  const db = await getDB()
  const all = await db.getAll(STORE)
  return all.filter(r => r.status === 'pending' && (r.attempts || 0) < 5)
}

export async function markDealershipDone(id) {
  const db = await getDB()
  return db.delete(STORE, id)
}

export async function markDealershipFailed(id, err) {
  const db = await getDB()
  const row = await db.get(STORE, id)
  if (!row) return
  row.attempts = (row.attempts || 0) + 1
  row.last_error = typeof err === 'string' ? err : (err?.message || String(err))
  if (row.attempts >= 5) row.status = 'failed'
  return db.put(STORE, row)
}

export async function getDealershipQueueCount() {
  try {
    const pending = await getPendingDealership()
    return pending.length
  } catch { return 0 }
}

/**
 * withDealershipOfflineQueue — wrap a Supabase mutation so it queues when the
 * device is offline OR when the write fails with a network-class error. The
 * original mutation runs unchanged when online and successful — there's no
 * latency cost on the happy path beyond a single navigator.onLine read.
 *
 * Returns { queued: true } when stored for later, otherwise the result of fn().
 */
export async function withDealershipOfflineQueue(opType, payload, fn) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline) {
    await enqueueDealership({ op_type: `dealership_${opType}`, payload })
    return { queued: true, op_type: `dealership_${opType}` }
  }
  try {
    return await fn()
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueueDealership({ op_type: `dealership_${opType}`, payload })
      return { queued: true, op_type: `dealership_${opType}` }
    }
    throw e
  }
}

/**
 * Replay all pending dealership ops by routing them back through the api
 * facade. Caller passes the live api object (web.js shape) — typically
 * triggered from a `window.addEventListener('online', ...)` listener wired in
 * AuthContext or a top-level effect.
 */
export async function replayDealership(api) {
  if (!api) return { replayed: 0, failed: 0 }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { replayed: 0, failed: 0 }
  const pending = await getPendingDealership()
  let replayed = 0, failed = 0
  for (const row of pending) {
    try {
      await dispatchDealership(api, row.op_type, row.payload)
      await markDealershipDone(row.id)
      replayed++
    } catch (e) {
      await markDealershipFailed(row.id, e)
      failed++
    }
  }
  return { replayed, failed }
}

/**
 * Map op_type → original api method. Kept as a flat switch so adding a new
 * mutation is one line + one wrapper at the call site.
 */
async function dispatchDealership(api, opType, payload) {
  const p = payload || {}
  switch (opType) {
    // vehicleInventory
    case 'dealership_vehicleInventory_create':    return api.vehicleInventory.create(p)
    case 'dealership_vehicleInventory_update':    return api.vehicleInventory.update(p.id, p.data)
    case 'dealership_vehicleInventory_setStatus': return api.vehicleInventory.setStatus(p.id, p.status)
    case 'dealership_vehicleInventory_delete':    return api.vehicleInventory.delete(p.id)
    // leads
    case 'dealership_leads_create':     return api.leads.create(p)
    case 'dealership_leads_update':     return api.leads.update(p.id, p.data)
    case 'dealership_leads_setStage':   return api.leads.setStage(p.id, p.stage, p.extra)
    case 'dealership_leads_logContact': return api.leads.logContact(p.id, p.opts)
    case 'dealership_leads_delete':     return api.leads.delete(p.id)
    // testDrives
    case 'dealership_testDrives_create':     return api.testDrives.create(p)
    case 'dealership_testDrives_update':     return api.testDrives.update(p.id, p.data)
    case 'dealership_testDrives_complete':   return api.testDrives.complete(p.id, p.notes)
    case 'dealership_testDrives_setOutcome': return api.testDrives.setOutcome(p.id, p.opts)
    case 'dealership_testDrives_delete':     return api.testDrives.delete(p.id)
    // salesDeals
    case 'dealership_salesDeals_create': return api.salesDeals.create(p)
    case 'dealership_salesDeals_update': return api.salesDeals.update(p.id, p.data)
    case 'dealership_salesDeals_close':  return api.salesDeals.close(p.id, p.ticketInfo)
    case 'dealership_salesDeals_markCommissionPaid': return api.salesDeals.markCommissionPaid(p.id)
    case 'dealership_salesDeals_delete': return api.salesDeals.delete(p.id)
    // vehicleTitulo (v2.16.2)
    case 'dealership_vehicleTitulo_upsert': return api.vehicleTitulo.upsert(p)
    case 'dealership_vehicleTitulo_delete': return api.vehicleTitulo.delete(p.id)
    // vehicleReservation (v2.16.4)
    case 'dealership_vehicleReservation_upsert':  return api.vehicleReservation.upsert(p)
    case 'dealership_vehicleReservation_release': return api.vehicleReservation.release(p)
    case 'dealership_vehicleReservation_convert': return api.vehicleReservation.convert(p)
    // vehicleWarranty (v2.16.4 Sprint 2B H3)
    case 'dealership_vehicleWarranty_upsert':   return api.vehicleWarranty.upsert(p)
    case 'dealership_vehicleWarranty_addClaim': return api.vehicleWarranty.addClaim(p)
    case 'dealership_vehicleWarranty_void':     return api.vehicleWarranty.void(p)
    // bankPreapproval (v2.16.4 Sprint 2C H5)
    case 'dealership_bankPreapproval_upsert':    return api.bankPreapproval.upsert(p)
    case 'dealership_bankPreapproval_setStatus': return api.bankPreapproval.setStatus(p)
    default:
      throw new Error(`replayDealership: unknown op_type "${opType}"`)
  }
}

/** Online listener — fire-and-forget replay on connectivity restored. */
let _onlineHandler = null
export function startDealershipReplay(api) {
  if (typeof window === 'undefined') return () => {}
  stopDealershipReplay()
  _onlineHandler = () => { replayDealership(api).catch(() => {}) }
  window.addEventListener('online', _onlineHandler)
  // Run once immediately if online.
  if (navigator.onLine) _onlineHandler()
  return stopDealershipReplay
}
export function stopDealershipReplay() {
  if (_onlineHandler && typeof window !== 'undefined') {
    try { window.removeEventListener('online', _onlineHandler) } catch {}
  }
  _onlineHandler = null
}
