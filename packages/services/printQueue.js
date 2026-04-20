/**
 * printQueue.js — USB-fail retry queue for thermal prints.
 *
 * When a print attempt fails (USB timeout, printer offline, IPC error), the
 * job is buffered and retried with exponential backoff (1s, 3s, 8s). After
 * `maxRetries` consecutive failures, the job is parked in a pending queue
 * surfaced via a banner in Layout. Pending jobs persist in localStorage so a
 * page reload/app relaunch doesn't lose them.
 *
 * Architecture:
 *   - enqueue(job)           → push + start worker
 *   - retryAll()             → user-triggered "re-attempt all" from banner
 *   - subscribe(listener)    → React banner subscribes to pending-count changes
 *   - getPending()           → snapshot for banner render
 *
 * Job shape: { id, type, escpos, printerName, biz, createdAt, attempts }
 * `escpos` is a *string* (ESC/POS command stream) — same value passed to the
 * Electron IPC `print` channel; binary bytes survive JSON round-trips because
 * the IPC handler re-encodes via Buffer.from(data, 'binary').
 */

const STORAGE_KEY = 'tx_print_pending_v1'
const BACKOFF_MS  = [1000, 3000, 8000]
const DEFAULT_MAX = 3

// Reads from Electron `settings.get()` if available; falls back to defaults.
// Kept async so we don't block module init.
let _cachedConfig = null
async function loadConfig() {
  if (_cachedConfig) return _cachedConfig
  try {
    const cfg = await window.electronAPI?.settings?.get?.()
    const enabledRaw = cfg?.print_retry_enabled
    const maxRaw     = cfg?.print_retry_max
    _cachedConfig = {
      enabled: enabledRaw == null ? true : String(enabledRaw) === '1',
      max:     Math.max(1, parseInt(maxRaw, 10) || DEFAULT_MAX),
    }
  } catch {
    _cachedConfig = { enabled: true, max: DEFAULT_MAX }
  }
  return _cachedConfig
}
export function invalidateConfig() { _cachedConfig = null }

// Re-read config whenever the user saves Sistema preferences
if (typeof window !== 'undefined') {
  try { window.addEventListener('tx:settings-updated', () => { _cachedConfig = null }) } catch {}
}

// ── Persistent pending store ───────────────────────────────────────────────
function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function writeStore(jobs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs)) } catch {}
}

// ── Subscriber pattern (banner listens) ─────────────────────────────────────
const listeners = new Set()
function notify() {
  const snap = getPending()
  listeners.forEach(fn => { try { fn(snap) } catch {} })
}
export function subscribe(fn) {
  listeners.add(fn)
  // Fire once so subscriber hydrates from storage immediately
  try { fn(getPending()) } catch {}
  return () => listeners.delete(fn)
}
export function getPending() { return readStore() }

// ── Core print attempt (single shot via Electron IPC) ──────────────────────
async function attemptPrint(job) {
  const eApi = window.electronAPI
  if (!eApi?.print) throw new Error('no_ipc')
  const result = await eApi.print({
    type: job.type,
    data: job.escpos,
    printerName: job.printerName,
  })
  if (!result?.success) throw new Error(result?.error || 'print_failed')
  return true
}

// ── Retry worker for a single job ──────────────────────────────────────────
// Runs up to `max` attempts with BACKOFF_MS[i] waits. On final failure the
// job lands in the persistent pending queue and listeners are notified.
async function runJob(job, max) {
  for (let i = 0; i < max; i++) {
    if (i > 0) {
      const wait = BACKOFF_MS[Math.min(i - 1, BACKOFF_MS.length - 1)]
      await new Promise(r => setTimeout(r, wait))
    }
    try {
      job.attempts = i + 1
      await attemptPrint(job)
      return { success: true }
    } catch (err) {
      job.lastError = String(err?.message || err)
      if (i === max - 1) {
        // Park job — persist for banner
        const store = readStore()
        // De-dupe by id (in case of retryAll re-enqueue)
        const filtered = store.filter(j => j.id !== job.id)
        filtered.push(job)
        writeStore(filtered)
        notify()
        return { success: false, queued: true, error: job.lastError }
      }
    }
  }
  return { success: false }
}

// ── Public API ──────────────────────────────────────────────────────────────
/**
 * Submit a print job. Falls back to direct single-shot attempt if retry is
 * disabled in settings. On final failure the job is parked and caller gets
 * { success:false, queued:true } so the UI can toast "Pendiente".
 */
export async function enqueuePrint({ type, escpos, printerName, biz }) {
  const cfg = await loadConfig()
  const job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type: type || 'print',
    escpos,
    printerName: printerName || undefined,
    biz: biz ? { name: biz.name, logo: null } : null, // don't persist logo bytes
    createdAt: Date.now(),
    attempts: 0,
  }
  if (!cfg.enabled) {
    try { await attemptPrint(job); return { success: true } }
    catch (err) {
      const store = readStore()
      store.push({ ...job, lastError: String(err?.message || err) })
      writeStore(store)
      notify()
      return { success: false, queued: true, error: String(err?.message || err) }
    }
  }
  return runJob(job, cfg.max)
}

/** Re-attempt every pending job (triggered by banner click). */
export async function retryAll() {
  const cfg = await loadConfig()
  const jobs = readStore()
  if (!jobs.length) return { recovered: 0, stillPending: 0 }
  // Clear before re-running so runJob can re-park cleanly on failure
  writeStore([])
  notify()
  let recovered = 0
  for (const job of jobs) {
    job.attempts = 0
    const r = await runJob(job, cfg.max)
    if (r.success) recovered++
  }
  return { recovered, stillPending: readStore().length }
}

/** Clear pending queue (owner manual dismiss). */
export function clearPending() {
  writeStore([])
  notify()
}
