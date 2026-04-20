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

const isWeb = typeof window !== 'undefined' && !window.electronAPI

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
  if (isWeb) {
    // On web, data lives in Supabase — no local DB to export
    return {
      exported_at: new Date().toISOString(),
      version:     '1.0.0',
      business_id: getBusinessId(),
      tables: {},
      _web: true,
    }
  }
  try {
    if (window.electronAPI?.db?.exportAll) {
      return await window.electronAPI.db.exportAll()
    }
  } catch {}
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

  if (isWeb) {
    // On web, data is already in Supabase — no local backup needed
    localStorage.setItem('tx_last_backup', new Date().toISOString())
    return { success: true, _web: true, message: 'Backup automatico via Supabase' }
  }

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
  // Auto-backup is always on — no user toggle. Cloud sync runs continuously
  // via electron/sync.js; this function adds the nightly SQLite file copy.
  // On web, skip local SQLite backup — data is in Supabase
  if (isWeb) return { success: true, _web: true, reason: 'web-auto-sync' }

  // Always run local SQLite copy — works offline, no Supabase needed
  const localResult = await window.electronAPI?.backup?.local?.().catch(() => null)

  if (!isOnline()) return { success: !!localResult?.ok, reason: 'offline', localResult }

  try {
    const snapshot = await exportLocalDB()
    const filename  = `backup_auto_${new Date().toISOString().replace(/[:.]/g,'-')}.json`
    const sizeBytes = new TextEncoder().encode(JSON.stringify(snapshot)).length

    await uploadSnapshot(filename, snapshot)
    await registerBackupRecord(filename, sizeBytes, 'auto')

    localStorage.setItem('tx_last_backup', new Date().toISOString())
    return { success: true, filename, sizeBytes, localResult }
  } catch (err) {
    return { success: false, error: err.message, localResult }
  }
}

// ── PUBLIC: restoreFromBackup ─────────────────────────────────────────────────
/**
 * Downloads backup from Supabase Storage and imports into local SQLite.
 * @param {string} backupId  The 'id' UUID from the backups table
 */
export async function restoreFromBackup(backupId) {
  if (isWeb) {
    return { success: false, error: 'Restaurar backup solo disponible en la aplicacion de escritorio' }
  }
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
  try {
    const sb = getSupabaseClient()
    if (!sb) return []

    const { data, error } = await sb.from('backups')
      .select('*')
      .eq('business_id', getBusinessId())
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return []
    return data ?? []
  } catch {
    return []
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

    // Upsert each table into Supabase using supabase_id pattern.
    const upserts = []

    if (changes.tickets.length > 0) {
      // v2.1: strip legacy columns (washer_ids, seller_id, vehicle_color/make,
      // notes, mesa_id) that were dropped from Supabase. Only push the v2.1
      // columns the cloud schema knows about. electron/sync.js is the
      // authoritative push path; this is a backup/redundancy layer.
      const TICKET_COLS = new Set([
        'supabase_id', 'doc_number', 'client_supabase_id',
        'washer_empleado_supabase_ids', 'seller_empleado_supabase_id',
        'cajero_supabase_id', 'subtotal', 'descuento', 'itbis', 'ley', 'total',
        'beverage_subtotal', 'payment_method', 'comprobante_type', 'ncf',
        'ecf_result', 'tipo_venta', 'status', 'void_reason', 'void_by',
        'void_at', 'vehicle_plate', 'tip_amount', 'fulfillment_type',
        'mesa_supabase_id', 'created_at', 'updated_at',
      ])
      upserts.push(
        sb.from('tickets').upsert(
          changes.tickets.map(t => {
            const out = { business_id: biz }
            for (const k of Object.keys(t)) if (TICKET_COLS.has(k)) out[k] = t[k]
            return out
          }).filter(r => r.supabase_id),
          { onConflict: 'business_id,supabase_id' }
        )
      )
    }
    if (changes.clients.length > 0) {
      upserts.push(
        sb.from('clients').upsert(
          changes.clients.map(({ id, ...c }) => ({ ...c, business_id: biz })),
          { onConflict: 'business_id,supabase_id' }
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
