/**
 * BackupContext — provides connection status + backup state to all components.
 *
 * Consumed by:
 *   - Sidebar → connection status dot
 *   - Settings Backup panel → last backup, progress, history
 *   - Any component that needs to check online state before a cloud op
 */
import { createContext, useContext, useState, useEffect, useRef } from 'react'
import {
  registerCallbacks,
  startSchedulers,
  stopSchedulers,
  getBackupHistory,
  getStorageUsage,
} from '@terminal-x/services/backup.js'
import { getStoredSetting } from '@terminal-x/services/supabase.js'

const BackupContext = createContext(null)

export function BackupProvider({ children }) {
  const [status, setStatus]           = useState('offline')  // 'online'|'syncing'|'offline'
  const [progress, setProgress]       = useState(null)       // null | { pct, msg }
  const [lastBackup, setLastBackup]   = useState(null)
  const [lastSync, setLastSync]       = useState(null)
  const [history, setHistory]         = useState([])
  const [storageUsed, setStorageUsed] = useState(0)
  const [configured, setConfigured]   = useState(false)
  const schedulersStarted             = useRef(false)

  useEffect(() => {
    // Restore persisted timestamps
    setLastBackup(localStorage.getItem('tx_last_backup'))
    setLastSync(localStorage.getItem('tx_last_sync'))

    // Check if Supabase is configured
    const url = getStoredSetting('supabase_url')
    const key = getStoredSetting('supabase_anon_key')
    setConfigured(!!(url && key))

    // Set initial network status
    setStatus(navigator.onLine ? 'online' : 'offline')

    // Register callbacks
    registerCallbacks({
      onStatusChange: (s) => {
        setStatus(s)
        if (s === 'online') setLastSync(new Date().toISOString())
      },
      onProgress: (pct, msg) => {
        setProgress({ pct, msg })
        if (pct >= 100) setTimeout(() => setProgress(null), 2000)
      },
    })

    // Start background schedulers only once
    if (!schedulersStarted.current) {
      schedulersStarted.current = true
      startSchedulers()
    }

    return () => stopSchedulers()
  }, [])

  /** Refresh backup list and storage usage (called by backup panel) */
  async function refreshHistory() {
    const [hist, storage] = await Promise.all([
      getBackupHistory(),
      getStorageUsage(),
    ])
    setHistory(hist)
    setStorageUsed(storage.used)
    setLastBackup(localStorage.getItem('tx_last_backup'))
  }

  /** Called by Settings when credentials are saved */
  function markConfigured(isConfigured) {
    setConfigured(isConfigured)
    if (isConfigured) setStatus(navigator.onLine ? 'online' : 'offline')
    else setStatus('offline')
  }

  return (
    <BackupContext.Provider value={{
      status,
      progress,
      lastBackup,
      lastSync,
      history,
      storageUsed,
      configured,
      refreshHistory,
      markConfigured,
    }}>
      {children}
    </BackupContext.Provider>
  )
}

export function useBackup() {
  const ctx = useContext(BackupContext)
  if (!ctx) throw new Error('useBackup must be inside BackupProvider')
  return ctx
}
