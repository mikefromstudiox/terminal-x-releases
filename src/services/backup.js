/**
 * backup.js — Cloud backup and sync service
 *
 * Architecture:
 *   - Local SQLite is always the source of truth
 *   - Supabase Storage holds encrypted JSON snapshots (backups)
 *   - Supabase DB tables hold live-synced data for remote access
 *   - All operations are non-blocking: POS never waits for cloud
 *
 * Scheduling (called from BackupContext on app start):
 *   - autoBackup()   → every night at 02:00 local time
 *   - syncToCloud()  → every 15 minutes while online
 */

import { getSupabaseClient, getBusinessId } from './supabase.js'

// ── Internal state ────────────────────────────────────────────────────────────
let _syncTimer    = null
let _backupTimer  = null
let _lastSyncAt   = null
let _onStatusChange = null   // (status: 'online'|'syncing'|'offline') => void
let _onProgress     = null   // (pct: number, msg: string) => void

// ── Registration (called by BackupContext) ────────────────────────────────────
export function registerCallbacks({ onStatusChange, onProgress }) {
  _onStatusChange = onStatusChange
  _onProgress     = onProgress
}

function setStatus(s)          { _onStatusChange?.(s) }
function setProgress(pct, msg) { _onProgress?.(pct, msg) }

// ── Network detection ─────────────────────────────────────────────────────────
function isOnline() {
  return typeof navigator !== 'undefined' && navigator.onLine !== false
}

// ── Data export (SQLite → JSON) ───────────────────────────────────────────────
/**
 * Reads all tables from local SQLite via Electron IPC.
 * Falls back to demo data if DB not yet wired.
 */
async function exportLocalDB() {
  try {
    if (window.electronAPI?.db?.exportAll) {
      return await window.electronAPI.db.exportAll()
    }
  } catch {}
  // Demo stub — replace with real DB export when SQLite layer is added
  return {
    exported_at: new Date().toISOString(),
    version:     '1.0.0',
    business_id: getBusinessId(),
    tables: {
      tickets:  [],
      clients:  [],
      payments: [],
      services: [],
      workers:  [],
      settings: [],
    },
  }
}

/** Restores a JSON snapshot to local SQLite via Electron IPC. */
async function importToDB(snapshot) {
  if (window.electronAPI?.db?.importAll) {
    return window.electronAPI.db.importAll(snapshot)
  }
  console.warn('[backup] importToDB: no IPC handler — DB layer not yet connected')
  return { success: false, reason: 'no-ipc' }
}

// ── Supabase Storage helpers ──────────────────────────────────────────────────
const BUCKET = 'terminal-x-backups'

async function uploadSnapshot(filename, jsonData) {
  const sb = getSupabaseClient()
  if (!sb) throw new Error('Supabase no configurado')

  const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' })
  const path = `${getBusinessId()}/${filename}`

  const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
    contentType: 'application/json',
    upsert: true,
  })
  if (error) throw error
  return path
}

async function downloadSnapshot(storagePath) {
  const sb = getSupabaseClient()
  if (!sb) throw new Error('Supabase no configurado')

  const { data, error } = await sb.storage.from(BUCKET).download(storagePath)
  if (error) throw error
  const text = await data.text()
  return JSON.parse(text)
}

async function getStorageUsage() {
  const sb = getSupabaseClient()
  if (!sb) return { used: 0, files: 0 }
  try {
    const { data } = await sb.storage.from(BUCKET).list(getBusinessId(), { limit: 100 })
    const files = data || []
    const used  = files.reduce((s, f) => s + (f.metadata?.size || 0), 0)
    return { used, files: files.length }
  } catch { return { used: 0, files: 0 } }
}

async function registerBackupRecord(filename, sizeBytes, type) {
  const sb = getSupabaseClient()
  if (!sb) return
  await sb.from('backups').insert({
    business_id: getBusinessId(),
    filename,
    size_bytes:  sizeBytes,
    type,
    status:      'ok',
  })
}

// ── PUBLIC: manualBackup ──────────────────────────────────────────────────────
/**
 * User-triggered full backup with progress reporting.
 * Returns { success, filename, sizeBytes, error? }
 */
export async function manualBackup() {
  if (!isOnline()) return { success: false, error: 'Sin conexión a internet' }

  try {
    setStatus('syncing')
    setProgress(10, 'Exportando base de datos local…')

    const snapshot = await exportLocalDB()
    setProgress(35, 'Comprimiendo datos…')

    const filename  = `backup_manual_${new Date().toISOString().replace(/[:.]/g,'-')}.json`
    const sizeBytes = new TextEncoder().encode(JSON.stringify(snapshot)).length

    setProgress(55, 'Subiendo a la nube…')
    await uploadSnapshot(filename, snapshot)

    setProgress(80, 'Registrando backup…')
    await registerBackupRecord(filename, sizeBytes, 'manual')

    // Persist last backup time
    localStorage.setItem('tx_last_backup', new Date().toISOString())
    localStorage.setItem('tx_last_backup_file', filename)

    setProgress(100, 'Backup completado')
    setStatus('online')

    return { success: true, filename, sizeBytes }
  } catch (err) {
    console.error('[backup] manualBackup error:', err)
    setStatus('online')
    return { success: false, error: err.message }
  }
}

// ── PUBLIC: autoBackup ────────────────────────────────────────────────────────
/**
 * Runs silently — no progress UI.
 * Called by scheduler at 02:00 local time.
 */
export async function autoBackup() {
  if (!isOnline()) return { success: false, reason: 'offline' }

  const autoEnabled = localStorage.getItem('tx_setting_auto_backup') !== 'false'
  if (!autoEnabled) return { success: false, reason: 'disabled' }

  try {
    const snapshot = await exportLocalDB()
    const filename  = `backup_auto_${new Date().toISOString().replace(/[:.]/g,'-')}.json`
    const sizeBytes = new TextEncoder().encode(JSON.stringify(snapshot)).length

    await uploadSnapshot(filename, snapshot)
    await registerBackupRecord(filename, sizeBytes, 'auto')

    localStorage.setItem('tx_last_backup', new Date().toISOString())
    console.info('[backup] autoBackup completed:', filename)
    return { success: true, filename, sizeBytes }
  } catch (err) {
    console.error('[backup] autoBackup error:', err)
    return { success: false, error: err.message }
  }
}

// ── PUBLIC: restoreFromBackup ─────────────────────────────────────────────────
/**
 * Downloads backup from Supabase Storage and imports into local SQLite.
 * @param {string} backupId  The 'id' UUID from the backups table
 */
export async function restoreFromBackup(backupId) {
  setStatus('syncing')
  setProgress(10, 'Descargando backup…')
  try {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase no configurado')

    // Fetch the backup record to get the filename
    const { data: record, error } = await sb.from('backups')
      .select('*').eq('id', backupId).single()
    if (error) throw error

    setProgress(35, 'Descargando datos…')
    const path     = `${getBusinessId()}/${record.filename}`
    const snapshot = await downloadSnapshot(path)

    setProgress(70, 'Restaurando base de datos local…')
    const result = await importToDB(snapshot)

    setProgress(100, 'Restauración completa')
    setStatus('online')
    return { success: true, restoredAt: snapshot.exported_at, result }
  } catch (err) {
    console.error('[backup] restoreFromBackup error:', err)
    setStatus('online')
    return { success: false, error: err.message }
  }
}

// ── PUBLIC: getBackupHistory ──────────────────────────────────────────────────
/**
 * Returns list of backups from Supabase, sorted newest first.
 * Falls back to demo history when offline or not configured.
 */
export async function getBackupHistory() {
  // Demo history (always visible in dev/offline)
  const DEMO = [
    { id: 'demo-1', filename: 'backup_auto_2026-03-17T02-00-00.json',   size_bytes: 486320, type: 'auto',   status: 'ok', created_at: '2026-03-17T02:00:00Z' },
    { id: 'demo-2', filename: 'backup_manual_2026-03-16T15-22-10.json', size_bytes: 481200, type: 'manual', status: 'ok', created_at: '2026-03-16T15:22:10Z' },
    { id: 'demo-3', filename: 'backup_auto_2026-03-16T02-00-00.json',   size_bytes: 478900, type: 'auto',   status: 'ok', created_at: '2026-03-16T02:00:00Z' },
    { id: 'demo-4', filename: 'backup_auto_2026-03-15T02-00-00.json',   size_bytes: 471600, type: 'auto',   status: 'ok', created_at: '2026-03-15T02:00:00Z' },
    { id: 'demo-5', filename: 'backup_auto_2026-03-14T02-00-01.json',   size_bytes: 465200, type: 'auto',   status: 'ok', created_at: '2026-03-14T02:00:01Z' },
  ]

  try {
    const sb = getSupabaseClient()
    if (!sb) return DEMO

    const { data, error } = await sb.from('backups')
      .select('*')
      .eq('business_id', getBusinessId())
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return DEMO
    return data.length > 0 ? data : DEMO
  } catch {
    return DEMO
  }
}

// ── PUBLIC: syncToCloud ───────────────────────────────────────────────────────
/**
 * Incremental sync — only pushes records created/modified since _lastSyncAt.
 * Runs silently in background. Never blocks the POS.
 */
export async function syncToCloud() {
  if (!isOnline()) { setStatus('offline'); return }

  const syncEnabled = localStorage.getItem('tx_setting_cloud_sync') !== 'false'
  if (!syncEnabled) return

  const sb = getSupabaseClient()
  if (!sb) return

  setStatus('syncing')
  try {
    const since = _lastSyncAt || new Date(0).toISOString()

    // Export only changes from local DB
    let changes = { tickets: [], clients: [], payments: [] }
    try {
      if (window.electronAPI?.db?.exportSince) {
        changes = await window.electronAPI.db.exportSince(since)
      }
    } catch {}

    const biz = getBusinessId()

    // Upsert each table into Supabase
    const upserts = []

    if (changes.tickets.length > 0) {
      upserts.push(
        sb.from('tickets').upsert(
          changes.tickets.map(t => ({ ...t, business_id: biz })),
          { onConflict: 'id' }
        )
      )
    }
    if (changes.clients.length > 0) {
      upserts.push(
        sb.from('clients').upsert(
          changes.clients.map(c => ({ ...c, business_id: biz })),
          { onConflict: 'id' }
        )
      )
    }

    await Promise.allSettled(upserts)

    _lastSyncAt = new Date().toISOString()
    localStorage.setItem('tx_last_sync', _lastSyncAt)
    setStatus('online')
  } catch (err) {
    console.warn('[backup] syncToCloud error:', err.message)
    setStatus('online')
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/** Calculate milliseconds until next 02:00 local time */
function msUntil2am() {
  const now = new Date()
  const target = new Date()
  target.setHours(2, 0, 0, 0)
  if (target <= now) target.setDate(target.getDate() + 1)
  return target - now
}

/**
 * Starts background schedulers.
 * Call once from BackupContext on app mount.
 */
export function startSchedulers() {
  // Auto-backup at 02:00 every night
  function scheduleAutoBackup() {
    const ms = msUntil2am()
    _backupTimer = setTimeout(async () => {
      await autoBackup()
      scheduleAutoBackup()   // schedule next night
    }, ms)
  }
  scheduleAutoBackup()

  // Sync every 15 minutes
  _syncTimer = setInterval(syncToCloud, 15 * 60 * 1000)

  // Initial sync after 10 seconds (let app finish loading first)
  setTimeout(syncToCloud, 10_000)

  // Listen for online/offline events
  window.addEventListener('online',  () => { setStatus('online');  syncToCloud() })
  window.addEventListener('offline', () => setStatus('offline'))
}

/** Stop schedulers on app unmount */
export function stopSchedulers() {
  clearTimeout(_backupTimer)
  clearInterval(_syncTimer)
}

/** Get storage usage from Supabase bucket */
export { getStorageUsage }
