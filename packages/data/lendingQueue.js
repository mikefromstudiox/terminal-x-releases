/**
 * lendingQueue.js — Generic offline write queue for prestamos (lending) on web.
 *
 * H10. Covers ALL lending tables in one helper so a flaky wifi at the
 * prestamista's desk never silently drops a write:
 *
 *   loans · loan_payments · loan_schedule · pawn_items · pawn_documents
 *   pawn_listings · loan_contracts · loan_renewals · collections_attempts
 *   collections_log
 *
 * Storage:  IndexedDB `terminalx-lending-queue` (idb dep, already shipped)
 * Stores:
 *   - pending:  active rows  (FIFO, attempts < 5)
 *   - dead:     rows that failed 5x with a non-network business error
 *   - photos:   sentinel queue for pawn-photo File blobs (separate b/c
 *               binary blobs in IDB get hairy + storage uploads need auth)
 *
 * Idempotency:
 *   Every queued row carries a pre-generated `supabase_id` (UUIDv4) on its
 *   payload — INSERTs use upsert(payload, { onConflict: 'supabase_id' })
 *   so a retry after a partial network success is a no-op, not a duplicate.
 *
 * Carve-outs (intentional):
 *   - PDF/contract generation (loan_contracts) — pdf-lib produces a Blob;
 *     contracts require live storage upload + signed URL. Caller surfaces a
 *     "Generar contrato requiere conexión" toast and refuses to enqueue.
 *   - Storage uploads for pawn photos — separate `photos` store w/ blob.
 *   - Storage uploads for private docs (DPI/matricula) — same as photos
 *     but caller routes via enqueuePendingPhoto with bucket='pawn-documents'.
 *
 * Public API:
 *   enqueueLendingWrite({ table, op, payload, business_id, rpc_name })
 *   flushLendingQueue(supabaseClient)
 *   peekLendingQueue() / peekDeadLetters() / clearLendingQueueRow(id)
 *   enqueuePendingPhoto({ pawnSupabaseId, file, bucket, business_id, docType })
 *   peekPendingPhotos() / flushPendingPhotos(supabaseClient)
 *   startLendingQueueAutoFlush(supabaseClient) / stopLendingQueueAutoFlush()
 *
 * Pure ESM. Browser-only (uses IndexedDB + window). Never throws from
 * flush — drains best-effort and surfaces counts via peek*.
 */

import { openDB } from 'idb'

// ── DB ──────────────────────────────────────────────────────────────────────
const DB_NAME    = 'terminalx-lending-queue'
const DB_VERSION = 1

let dbPromise = null
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pending')) {
          const s = db.createObjectStore('pending', { keyPath: 'id', autoIncrement: true })
          s.createIndex('table', 'table')
          s.createIndex('created_at', 'created_at')
          s.createIndex('business_id', 'business_id')
        }
        if (!db.objectStoreNames.contains('dead')) {
          db.createObjectStore('dead', { keyPath: 'id', autoIncrement: true })
        }
        if (!db.objectStoreNames.contains('photos')) {
          const s = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true })
          s.createIndex('created_at', 'created_at')
          s.createIndex('business_id', 'business_id')
        }
      },
    })
  }
  return dbPromise
}

const ALLOWED_TABLES = new Set([
  'loans',
  'loan_payments',
  'loan_schedule',
  'pawn_items',
  'pawn_documents',
  'pawn_listings',
  'loan_contracts',
  'loan_renewals',
  'collections_attempts',
  'collections_log',
])

const ALLOWED_OPS = new Set(['insert', 'update', 'delete', 'rpc'])

const MAX_ATTEMPTS  = 5
const FLUSH_RPS     = 5            // max RPC/inserts per second to avoid Supabase throttling
const FLUSH_GAP_MS  = Math.ceil(1000 / FLUSH_RPS)

// ── Pure helpers ────────────────────────────────────────────────────────────
function nowIso() { return new Date().toISOString() }

/**
 * Returns true iff `e` is a transport-level failure (worth queueing for retry)
 * vs a genuine business error (RLS / validation / FK — must surface immediately).
 *
 * Tuned against:
 *   - browser fetch:        TypeError "Failed to fetch"
 *   - supabase-js timeout:  AbortError, "aborted"
 *   - node http:            ENOTFOUND, ECONNRESET, ETIMEDOUT, EAI_AGAIN
 *   - generic strings:      "network", "timeout"
 */
export function isNetworkError(e) {
  if (!e) return false
  const msg = String(e?.message || e || '')
  if (e?.name === 'TypeError' && /fetch/i.test(msg)) return true
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return true
  return /fetch|network|timeout|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|load failed|networkerror/i.test(msg)
}

// ── Enqueue ─────────────────────────────────────────────────────────────────
/**
 * Persist a single lending write to the offline queue.
 * Caller MUST set payload.supabase_id (UUIDv4) on `insert` ops so re-flush
 * is idempotent. We assert it loudly to catch missing callsites in dev.
 */
export async function enqueueLendingWrite({ table, op, payload, business_id, rpc_name = null }) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`enqueueLendingWrite: unknown table "${table}"`)
  if (!ALLOWED_OPS.has(op))       throw new Error(`enqueueLendingWrite: unknown op "${op}"`)
  if (!business_id)               throw new Error('enqueueLendingWrite: business_id required')
  if (!payload || typeof payload !== 'object') throw new Error('enqueueLendingWrite: payload required')

  // Idempotency contract — INSERTs and RPCs both must carry a supabase_id.
  if ((op === 'insert' || op === 'rpc') && !payload.supabase_id) {
    throw new Error(`enqueueLendingWrite: payload.supabase_id required for ${op} (idempotency)`)
  }
  if (op === 'rpc' && !rpc_name) {
    throw new Error('enqueueLendingWrite: rpc_name required for op=rpc')
  }

  const db = await getDB()
  const id = await db.add('pending', {
    table, op, rpc_name,
    payload,
    business_id,
    created_at: nowIso(),
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
  })
  // eslint-disable-next-line no-console
  console.warn(`[lendingQueue] queued ${op} ${table}${rpc_name ? ` rpc=${rpc_name}` : ''} id=${id}`)
  return id
}

export async function peekLendingQueue() {
  const db = await getDB()
  return (await db.getAll('pending')).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
}

export async function peekDeadLetters() {
  const db = await getDB()
  return db.getAll('dead')
}

export async function clearLendingQueueRow(id) {
  const db = await getDB()
  return db.delete('pending', id)
}

export async function clearDeadLetterRow(id) {
  const db = await getDB()
  return db.delete('dead', id)
}

export async function getLendingQueueCounts() {
  const db = await getDB()
  const [pending, dead, photos] = await Promise.all([
    db.count('pending'), db.count('dead'), db.count('photos'),
  ])
  return { pending, dead, photos }
}

// ── Dispatch ────────────────────────────────────────────────────────────────
/**
 * Route a single queue row to the correct supabase call.
 * Returns the supabase response or throws.
 *
 * INSERTs use upsert(.., { onConflict: 'supabase_id' }) so the operation is
 * idempotent against partial-success retries.
 */
async function dispatchRow(supabase, row) {
  const { table, op, payload, rpc_name, business_id } = row
  const enriched = { ...payload, business_id }

  if (op === 'rpc') {
    const { data, error } = await supabase.rpc(rpc_name, enriched)
    if (error) throw error
    return data
  }
  if (op === 'insert') {
    const { data, error } = await supabase
      .from(table)
      .upsert(enriched, { onConflict: 'supabase_id', ignoreDuplicates: false })
      .select()
    if (error) throw error
    return data
  }
  if (op === 'update') {
    // Update path: payload must include either supabase_id or id to target the row.
    const { id, supabase_id, ...rest } = payload
    let q = supabase.from(table).update({ ...rest, updated_at: nowIso() })
    if (supabase_id)   q = q.eq('supabase_id', supabase_id)
    else if (id)       q = q.eq('id', id)
    else throw new Error(`update on ${table} missing id/supabase_id`)
    q = q.eq('business_id', business_id)
    const { data, error } = await q.select()
    if (error) throw error
    return data
  }
  if (op === 'delete') {
    const { id, supabase_id } = payload
    let q = supabase.from(table).delete()
    if (supabase_id)   q = q.eq('supabase_id', supabase_id)
    else if (id)       q = q.eq('id', id)
    else throw new Error(`delete on ${table} missing id/supabase_id`)
    q = q.eq('business_id', business_id)
    const { error } = await q
    if (error) throw error
    return true
  }
  throw new Error(`dispatchRow: unsupported op ${op}`)
}

// ── Flush ───────────────────────────────────────────────────────────────────
let flushing = false   // module-level mutex (one concurrent run)

/**
 * Drain the queue in FIFO order. Best-effort: never throws.
 * Returns { sent, failed, deferred } counts.
 */
export async function flushLendingQueue(supabase) {
  if (flushing) return { sent: 0, failed: 0, deferred: 0, busy: true }
  if (!supabase) return { sent: 0, failed: 0, deferred: 0 }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { sent: 0, failed: 0, deferred: 0 }
  }
  flushing = true
  let sent = 0, failed = 0, deferred = 0
  try {
    const db = await getDB()
    const rows = (await db.getAll('pending'))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))

    for (const row of rows) {
      try {
        await dispatchRow(supabase, row)
        await db.delete('pending', row.id)
        sent++
      } catch (err) {
        if (isNetworkError(err)) {
          // Transport: leave row alone, abort the rest of this flush cycle.
          deferred++
          // eslint-disable-next-line no-console
          console.warn('[lendingQueue] flush deferred (network):', err?.message || err)
          break
        }
        // Business error: bump attempts, dead-letter at MAX_ATTEMPTS.
        const updated = {
          ...row,
          attempts: (row.attempts || 0) + 1,
          last_error: String(err?.message || err),
          last_attempt_at: nowIso(),
        }
        if (updated.attempts >= MAX_ATTEMPTS) {
          try { await db.add('dead', { ...updated, moved_at: nowIso() }) }
          catch (deadErr) { try { (typeof window !== 'undefined') && window.__txReportError?.(deadErr, { severity: 'warn', category: 'lendingQueue.dead_letter_write_failed', extra: { row_id: row.id, attempts: updated.attempts } }) } catch {} }
          await db.delete('pending', row.id)
        } else {
          await db.put('pending', updated)
        }
        failed++
        // eslint-disable-next-line no-console
        console.error('[lendingQueue] flush row failed', row.table, row.op, err?.message || err)
      }
      // Throttle to FLUSH_RPS rows/sec.
      await new Promise(r => setTimeout(r, FLUSH_GAP_MS))
    }
  } finally {
    flushing = false
  }
  return { sent, failed, deferred }
}

// ── Photo sentinel queue ────────────────────────────────────────────────────
/**
 * Photos are stored as raw File blobs + metadata. Storage uploads can't be
 * batched into the JSON queue (Supabase storage SDK signs requests against
 * a live JWT and bucket policy). On reconnect we replay them in order.
 */
export async function enqueuePendingPhoto({
  pawnSupabaseId, file, bucket = 'pawn-photos',
  business_id, docType = 'foto', isPrivate = false,
}) {
  if (!file)            throw new Error('enqueuePendingPhoto: file required')
  if (!pawnSupabaseId)  throw new Error('enqueuePendingPhoto: pawnSupabaseId required')
  if (!business_id)     throw new Error('enqueuePendingPhoto: business_id required')

  const db = await getDB()
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
  const path = isPrivate
    ? `${business_id}/${pawnSupabaseId}/${docType}-${Date.now()}.${ext}`
    : `${business_id}/${pawnSupabaseId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const id = await db.add('photos', {
    pawn_supabase_id: pawnSupabaseId,
    business_id,
    bucket,
    doc_type: docType,
    is_private: !!isPrivate,
    path,
    blob: file,                                          // File extends Blob, IDB stores it natively
    mime_type: file.type || 'image/jpeg',
    doc_supabase_id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null,
    created_at: nowIso(),
    attempts: 0,
    last_error: null,
  })
  // eslint-disable-next-line no-console
  console.warn(`[lendingQueue] photo queued bucket=${bucket} id=${id}`)
  return id
}

export async function peekPendingPhotos() {
  const db = await getDB()
  return db.getAll('photos')
}

export async function flushPendingPhotos(supabase) {
  if (!supabase) return { sent: 0, failed: 0 }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { sent: 0, failed: 0 }

  const db = await getDB()
  const rows = await db.getAll('photos')
  let sent = 0, failed = 0
  for (const row of rows) {
    try {
      const { error: upErr } = await supabase.storage
        .from(row.bucket)
        .upload(row.path, row.blob, { contentType: row.mime_type, upsert: false })
      if (upErr && !/duplicate|exists/i.test(upErr.message || '')) throw upErr

      let file_url
      if (row.is_private) {
        const { data: signed, error: sErr } = await supabase.storage
          .from(row.bucket).createSignedUrl(row.path, 60 * 60 * 24 * 365)
        if (sErr) throw sErr
        file_url = signed?.signedUrl || row.path
      } else {
        const { data: pub } = supabase.storage.from(row.bucket).getPublicUrl(row.path)
        file_url = pub?.publicUrl
        if (!file_url) throw new Error('No public URL after photo upload')
      }

      const { error: insErr } = await supabase.from('pawn_documents').upsert({
        supabase_id:       row.doc_supabase_id || crypto.randomUUID(),
        business_id:       row.business_id,
        pawn_supabase_id:  row.pawn_supabase_id,
        doc_type:          row.doc_type,
        file_url,
        mime_type:         row.mime_type,
      }, { onConflict: 'supabase_id' })
      if (insErr) throw insErr

      await db.delete('photos', row.id)
      sent++
    } catch (err) {
      const updated = {
        ...row,
        attempts: (row.attempts || 0) + 1,
        last_error: String(err?.message || err),
      }
      try { await db.put('photos', updated) }
      catch (photoErr) { try { (typeof window !== 'undefined') && window.__txReportError?.(photoErr, { severity: 'warn', category: 'lendingQueue.photo_retry_write_failed', extra: { photo_id: row.id, attempts: updated.attempts } }) } catch {} }
      failed++
      if (isNetworkError(err)) break  // transport — stop, retry later
    }
    await new Promise(r => setTimeout(r, FLUSH_GAP_MS))
  }
  return { sent, failed }
}

// ── Auto-flush wiring ───────────────────────────────────────────────────────
let _onOnline = null
let _interval = null

export function startLendingQueueAutoFlush(supabase) {
  stopLendingQueueAutoFlush()
  if (typeof window === 'undefined') return
  const tick = () => {
    if (navigator.onLine) {
      flushLendingQueue(supabase).catch((err) => { try { window.__txReportError?.(err, { severity: 'warn', category: 'lendingQueue.autoflush_failed' }) } catch {} })
      flushPendingPhotos(supabase).catch((err) => { try { window.__txReportError?.(err, { severity: 'warn', category: 'lendingQueue.photoflush_failed' }) } catch {} })
    }
  }
  _onOnline = tick
  window.addEventListener('online', _onOnline)
  // boot run
  tick()
  // poll every 60s as a belt-and-suspenders safety net
  _interval = setInterval(tick, 60_000)
}

export function stopLendingQueueAutoFlush() {
  try { if (_onOnline) window.removeEventListener('online', _onOnline) } catch {}
  _onOnline = null
  if (_interval) { clearInterval(_interval); _interval = null }
}

// ── Test / debug hook ───────────────────────────────────────────────────────
/** Reset module-level state. ONLY for tests — do not call in app code. */
export function __resetLendingQueueForTests() {
  flushing  = false
  dbPromise = null
  _onOnline = null
  if (_interval) clearInterval(_interval)
  _interval = null
}
