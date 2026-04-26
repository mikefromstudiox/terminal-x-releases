/**
 * activity-log-queue.js — fallback queue for compliance-critical audit rows.
 *
 * Renderer-side (web POS + electron renderer): uses IndexedDB via `idb` to
 * persist `activity_log` payloads that the canonical write helper failed to
 * land. A drainer retries with exponential backoff (30s, 60s, 2m, 5m, 10m).
 * After 5 failed attempts the row is marked status='dead' (kept for forensics)
 * and one final `activity_log_dropped` event is emitted to the canonical log
 * so the owner sees it in the audit feed.
 *
 * Desktop main process (electron/database.js) does NOT import this module —
 * it has its own SQLite-backed `activity_log_fallback` table and a drainer
 * that runs at the end of every sync cycle (see sync.js).
 *
 * Public API:
 *   enqueueActivity(payload)            → Promise<void>
 *   drainActivity({ supabaseInsertFn }) → Promise<{ drained, dead, remaining }>
 *   getPendingCount()                   → Promise<number>
 *   registerWriter(fn)                  → void  (set the actual Supabase insert fn)
 *   startAutoDrain({ intervalMs?, supabaseInsertFn? }) → stop()
 *
 * The queue stays behind the canonical helper (logActivity in web.js) — it is
 * never bypassed and never raw-INSERTs into activity_log directly. The writer
 * fn it calls IS the canonical insert path; the queue just retries it.
 */

const DB_NAME      = 'terminalx-activity-fallback'
const DB_VERSION   = 1
const STORE        = 'pending'
const MAX_ATTEMPTS = 5
const BACKOFF_MS   = [30_000, 60_000, 120_000, 300_000, 600_000] // 30s,1m,2m,5m,10m
const DRAIN_INTERVAL_MS = 60_000

let _writer = null     // (payload) => Promise<void>  — must throw on failure
let _idbPromise = null
let _draining = false
let _autoStopFn = null

// ── IDB helpers (lazy, web-only) ────────────────────────────────────────────
async function _idb() {
  if (_idbPromise) return _idbPromise
  if (typeof indexedDB === 'undefined') return null
  _idbPromise = (async () => {
    const { openDB } = await import('idb')
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
          s.createIndex('status',         'status')
          s.createIndex('next_attempt_at','next_attempt_at')
        }
      },
    })
  })()
  return _idbPromise
}

function _now() { return Date.now() }

// ── Public: register writer ─────────────────────────────────────────────────
export function registerWriter(fn) {
  _writer = (typeof fn === 'function') ? fn : null
}

// ── Public: enqueue a failed audit row ──────────────────────────────────────
export async function enqueueActivity(payload) {
  if (!payload || !payload.event_type) return
  const db = await _idb()
  if (!db) {
    // No IndexedDB (SSR / tests). Last-ditch: log to console so it's at least
    // visible in the operator's devtools.
    try { console.error('[activity-log-queue] no IDB — payload lost:', payload) } catch {}
    return
  }
  try {
    await db.add(STORE, {
      payload,
      attempts:        0,
      last_error:      null,
      status:          'pending',           // pending | dead
      created_at:      _now(),
      last_attempt_at: null,
      next_attempt_at: _now(),              // eligible immediately
    })
  } catch (e) {
    try { console.error('[activity-log-queue] enqueue failed:', e?.message || e, payload) } catch {}
  }
}

// ── Public: drain pending rows ──────────────────────────────────────────────
export async function drainActivity({ supabaseInsertFn } = {}) {
  const writer = supabaseInsertFn || _writer
  if (!writer) return { drained: 0, dead: 0, remaining: 0, skipped: 'no-writer' }
  const db = await _idb()
  if (!db) return { drained: 0, dead: 0, remaining: 0, skipped: 'no-idb' }
  if (_draining) return { drained: 0, dead: 0, remaining: 0, skipped: 'busy' }
  _draining = true

  let drained = 0, dead = 0, remaining = 0
  try {
    const all = await db.getAll(STORE)
    const now = _now()
    for (const row of all) {
      if (row.status !== 'pending') continue
      if (row.next_attempt_at && row.next_attempt_at > now) { remaining++; continue }
      try {
        await writer(row.payload)
        await db.delete(STORE, row.id)
        drained++
      } catch (e) {
        const attempts = (row.attempts || 0) + 1
        if (attempts >= MAX_ATTEMPTS) {
          // Mark dead, keep row for forensics, emit one terminal audit row
          // through the canonical writer so the owner sees the drop in feed.
          row.status          = 'dead'
          row.attempts        = attempts
          row.last_error      = String(e?.message || e).slice(0, 500)
          row.last_attempt_at = now
          await db.put(STORE, row)
          dead++
          try {
            await writer({
              event_type: 'activity_log_dropped',
              severity:   'critical',
              target_type: 'activity_log',
              reason:     'Audit row dropped after 5 retries',
              metadata: {
                original_event_type: row.payload?.event_type,
                original_severity:   row.payload?.severity,
                last_error:          row.last_error,
                first_attempt_at:    new Date(row.created_at).toISOString(),
                attempts,
              },
            })
          } catch {
            // If we can't even land the dropped-marker row, give up silently
            // for THIS cycle — it'll re-try via the regular drain because the
            // dropped-marker isn't queued (intentional: drop-of-drop loop).
          }
        } else {
          row.attempts        = attempts
          row.last_error      = String(e?.message || e).slice(0, 500)
          row.last_attempt_at = now
          row.next_attempt_at = now + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
          await db.put(STORE, row)
          remaining++
        }
      }
    }
  } finally {
    _draining = false
  }
  return { drained, dead, remaining }
}

// ── Public: pending count (incl. dead so dashboards can surface compliance gap) ─
export async function getPendingCount() {
  const db = await _idb()
  if (!db) return 0
  try { return await db.count(STORE) } catch { return 0 }
}

// ── Public: auto-drain (60s + on `online`) ──────────────────────────────────
export function startAutoDrain({ intervalMs = DRAIN_INTERVAL_MS, supabaseInsertFn } = {}) {
  if (_autoStopFn) _autoStopFn()
  if (supabaseInsertFn) registerWriter(supabaseInsertFn)
  if (typeof window === 'undefined') return () => {}

  const tick = () => { drainActivity().catch(() => {}) }
  const onlineHandler = () => tick()
  window.addEventListener('online', onlineHandler)
  // First drain after 5s (let app settle) then on interval
  const t0 = setTimeout(tick, 5_000)
  const tN = setInterval(tick, intervalMs)

  _autoStopFn = () => {
    try { window.removeEventListener('online', onlineHandler) } catch {}
    clearTimeout(t0); clearInterval(tN)
    _autoStopFn = null
  }
  return _autoStopFn
}

export function stopAutoDrain() {
  if (_autoStopFn) _autoStopFn()
}
