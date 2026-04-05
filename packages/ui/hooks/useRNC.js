/**
 * useRNC — RNC lookup + DGII database sync hook.
 *
 * Lookup priority:
 *   1. Local SQLite (instant, offline — full DGII database once synced)
 *   2. megaplus.com.do live API (fallback, caches result locally)
 *
 * Usage:
 *   const { lookup, sync, lookupLoading, syncing, syncProgress, dbStatus } = useRNC()
 */
import { useState, useEffect } from 'react'
import { useAPI } from '../context/DataContext'

export function useRNC() {
  const api = useAPI()
  const [lookupLoading, setLookupLoading] = useState(false)
  const [syncing,       setSyncing]       = useState(false)
  const [syncProgress,  setSyncProgress]  = useState(null)   // { percent, message }
  const [dbStatus,      setDbStatus]      = useState({ count: 0, lastSync: null })

  useEffect(() => {
    // Wire progress events from main process (Electron only)
    if (api?.rnc?.onSyncProgress) api.rnc.onSyncProgress(setSyncProgress)
    // Load current DB status
    api?.rnc?.status?.().then(setDbStatus).catch(() => {})
  }, [])

  async function lookup(rnc) {
    if (!api?.rnc?.lookup || !rnc) return null
    setLookupLoading(true)
    try {
      return await api.rnc.lookup(rnc)
    } finally {
      setLookupLoading(false)
    }
  }

  async function sync() {
    if (!api?.rnc?.sync) return
    setSyncing(true)
    setSyncProgress({ percent: 0, message: 'Iniciando...' })
    try {
      const res = await api.rnc.sync()
      if (res?.ok) {
        const status = await api.rnc.status()
        setDbStatus(status)
        setSyncProgress({ percent: 100, message: `✅ ${res.count?.toLocaleString()} contribuyentes` })
      } else {
        setSyncProgress({ percent: 0, message: `❌ ${res?.error || 'Error desconocido'}` })
      }
      return res
    } finally {
      setSyncing(false)
    }
  }

  return { lookup, sync, lookupLoading, syncing, syncProgress, dbStatus }
}
