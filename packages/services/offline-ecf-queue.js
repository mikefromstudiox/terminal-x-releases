/**
 * offline-ecf-queue.js — Web-only offline e-CF queue (FIX-H4).
 *
 * Why this exists
 * ───────────────
 * The Facturación tier ships as a web PWA. When the operator loses internet
 * mid-emisión we cannot lose the invoice — DGII's `IndicadorEnvioDiferido=1`
 * rule lets us retry within 72 hours and the receipt is still valid.
 *
 * Why IndexedDB (not Background Sync API)
 * ───────────────────────────────────────
 * Safari iOS does not implement Background Sync. IndexedDB + a window
 * `online` event listener is the most universally supported pattern, and it
 * survives tab reloads / browser restarts.
 *
 * Behavior
 * ────────
 *  - enqueue(payload, accessToken)  → stores into 'tx_ecf_queue' DB.
 *  - drain(submitFn)                → walks pending rows, replays each via
 *                                     the supplied submitFn(payload, token),
 *                                     promoting `IndicadorEnvioDiferido=1`
 *                                     on every retry attempt.
 *  - autoDrain(submitFn)            → registers a single online + interval
 *                                     handler, idempotent if called twice.
 *  - count(), all(), remove(id), purgeStale72h()
 *
 * Lifetime
 * ────────
 *  - Rows older than 72h are pruned automatically (DGII's deferred limit).
 *  - Successful drains delete the row immediately.
 *  - Failed retries increment `attempts`; we cap at 500 to match the desktop
 *    `ecf_queue` semantics.
 */

const DB_NAME      = 'tx_ecf_queue'
const DB_VERSION   = 1
const STORE        = 'pending'
const MAX_AGE_MS   = 72 * 60 * 60 * 1000
const MAX_ATTEMPTS = 500

let _dbPromise = null
let _autoBound = false

function openDB() {
  if (_dbPromise) return _dbPromise
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'))
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('createdAt', 'createdAt')
        store.createIndex('eNCF', 'eNCF', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

async function tx(mode) {
  const db = await openDB()
  return db.transaction(STORE, mode).objectStore(STORE)
}

export async function enqueue({ invoicePayload, eNCF, ticketId, accessToken }) {
  if (!invoicePayload) throw new Error('invoicePayload required')
  // FIX 5.7 — dedupe by eNCF. Without this, a flaky network during cobrar
  // can enqueue the SAME e-CF twice and DGII receives two submissions when
  // the queue drains — fiscal duplicate. eNCF is unique per ticket by
  // construction (sequence reserved before sign), so identity is safe.
  if (eNCF) {
    const existing = await all()
    const dup = existing.find(r => r.eNCF === eNCF)
    if (dup) return dup.id
  }
  const store = await tx('readwrite')
  const row = {
    eNCF: eNCF || null,
    ticketId: ticketId || null,
    invoicePayload,        // full body sent to /api/ecf-sign — payload + emisor + comprador + totales
    accessToken: accessToken || null, // session token captured at enqueue time; refreshed on drain when possible
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  }
  return new Promise((resolve, reject) => {
    const r = store.add(row)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export async function all() {
  const store = await tx('readonly')
  return new Promise((resolve, reject) => {
    const r = store.getAll()
    r.onsuccess = () => resolve(r.result || [])
    r.onerror = () => reject(r.error)
  })
}

export async function count() {
  const store = await tx('readonly')
  return new Promise((resolve, reject) => {
    const r = store.count()
    r.onsuccess = () => resolve(r.result || 0)
    r.onerror = () => reject(r.error)
  })
}

export async function remove(id) {
  const store = await tx('readwrite')
  return new Promise((resolve, reject) => {
    const r = store.delete(id)
    r.onsuccess = () => resolve(true)
    r.onerror = () => reject(r.error)
  })
}

async function update(id, patch) {
  const store = await tx('readwrite')
  return new Promise((resolve, reject) => {
    const getR = store.get(id)
    getR.onsuccess = () => {
      const row = getR.result
      if (!row) return resolve(false)
      Object.assign(row, patch)
      const putR = store.put(row)
      putR.onsuccess = () => resolve(true)
      putR.onerror = () => reject(putR.error)
    }
    getR.onerror = () => reject(getR.error)
  })
}

export async function purgeStale72h() {
  const rows = await all()
  const now = Date.now()
  let purged = 0
  for (const row of rows) {
    if (now - row.createdAt > MAX_AGE_MS) {
      await remove(row.id)
      purged++
    }
  }
  return purged
}

/**
 * drain — replay every pending row through submitFn.
 * @param submitFn  async (invoicePayload, accessToken) => { ok, data, error }
 *                  Must NOT throw — it should return { ok: false, error } on
 *                  network failure so we can retain the row.
 */
export async function drain(submitFn) {
  await purgeStale72h()
  const rows = await all()
  let succeeded = 0, failed = 0, retained = 0
  for (const row of rows) {
    if (row.attempts >= MAX_ATTEMPTS) { retained++; continue }
    // DGII rule: every replay must carry IndicadorEnvioDiferido=1 so DGII
    // accepts the receipt under the 72h deferred-emission allowance.
    const payload = { ...row.invoicePayload }
    if (payload.payload?.ECF?.Encabezado?.IdDoc) {
      payload.payload.ECF.Encabezado.IdDoc.IndicadorEnvioDiferido = '1'
    }
    let result
    try { result = await submitFn(payload, row.accessToken) }
    catch (err) { result = { ok: false, error: err?.message || 'submitFn threw' } }
    if (result?.ok) {
      await remove(row.id)
      succeeded++
      // Best-effort hook so UI / activity log can react.
      try { window.dispatchEvent(new CustomEvent('tx:ecf-queue-drained', { detail: { id: row.id, ticketId: row.ticketId, eNCF: row.eNCF, result: result.data } })) } catch {}
    } else {
      await update(row.id, { attempts: (row.attempts || 0) + 1, lastError: String(result?.error || 'unknown'), lastTried: Date.now() })
      failed++
      retained++
    }
  }
  try { window.dispatchEvent(new CustomEvent('tx:ecf-queue-status', { detail: { succeeded, failed, retained } })) } catch {}
  return { succeeded, failed, retained }
}

/**
 * autoDrain — bind a one-shot online listener + 5-minute poll. Idempotent.
 * The submitFn receives (payload, token) and must do its own auth refresh.
 */
export function autoDrain(submitFn) {
  if (_autoBound) return
  _autoBound = true
  const run = () => { if (navigator.onLine) drain(submitFn).catch(() => {}) }
  window.addEventListener('online', run)
  setInterval(run, 5 * 60 * 1000)
  // Drain once at boot in case the user reloaded after coming back online.
  run()
}
