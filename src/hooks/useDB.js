/**
 * useDB.js — React hooks for all database operations.
 *
 * Every hook returns { data, loading, error, reload }.
 * Writes return { execute, loading, error }.
 *
 * Falls back gracefully when window.electronAPI is not available
 * (e.g., running in a plain browser during development).
 */
import { useState, useEffect, useCallback, useRef } from 'react'

// ── Check if IPC is available ─────────────────────────────────────────────────
export function hasIPC() {
  return typeof window !== 'undefined' && !!window.electronAPI
}

// ── Generic read hook ─────────────────────────────────────────────────────────
export function useQuery(fetcher, deps = [], fallback = null) {
  const [data,    setData]    = useState(fallback ?? null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const mounted               = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      if (mounted.current) setData(result ?? fallback)
    } catch (err) {
      console.error('[useQuery]', err)
      if (mounted.current) { setError(err.message); setData(fallback) }
    } finally {
      if (mounted.current) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false }
  }, [load])

  return { data, loading, error, reload: load }
}

// ── Generic mutation hook ─────────────────────────────────────────────────────
export function useMutation(mutator) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const execute = useCallback(async (...args) => {
    setLoading(true)
    setError(null)
    try {
      const result = await mutator(...args)
      return { ok: true, data: result }
    } catch (err) {
      console.error('[useMutation]', err)
      setError(err.message)
      return { ok: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }, [mutator])

  return { execute, loading, error }
}

// ── Specific hooks ────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.settings.get() : Promise.resolve({}),
    [], {}
  )
}

export function useServices() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.services.all() : Promise.resolve([]),
    [], []
  )
}

export function useWashers() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.washers.all() : Promise.resolve([]),
    [], []
  )
}

export function useClients() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.clients.all() : Promise.resolve([]),
    [], []
  )
}

export function useTickets(params = {}) {
  const key = JSON.stringify(params)
  return useQuery(
    () => hasIPC() ? window.electronAPI.tickets.all(params) : Promise.resolve([]),
    [key], []
  )
}

export function useQueueActive() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.queue.active() : Promise.resolve([]),
    [], []
  )
}

export function useCommissionsByPeriod(from, to) {
  return useQuery(
    () => hasIPC() ? window.electronAPI.commissions.byPeriod({ from, to }) : Promise.resolve([]),
    [from, to], []
  )
}

export function useCuadreHistory() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.cuadre.history() : Promise.resolve([]),
    [], []
  )
}

export function useDailySummary(date) {
  return useQuery(
    () => hasIPC() ? window.electronAPI.cuadre.daily(date) : Promise.resolve({}),
    [date], {}
  )
}

export function useNCFSequences() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.ncf.sequences() : Promise.resolve([]),
    [], []
  )
}

export function useCajaChica() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.cajaChica.all() : Promise.resolve([]),
    [], []
  )
}

export function useNotas() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.notas.all() : Promise.resolve([]),
    [], []
  )
}

export function useSellers() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.sellers.all() : Promise.resolve([]),
    [], []
  )
}

export function useUsers() {
  return useQuery(
    () => hasIPC() ? window.electronAPI.users.all() : Promise.resolve([]),
    [], []
  )
}
