/**
 * useDB.js — React hooks for all database operations.
 *
 * Every hook returns { data, loading, error, reload }.
 * Writes return { execute, loading, error }.
 *
 * All hooks go through the DataContext abstraction (useAPI)
 * so they work on both Electron and Web platforms.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAPI } from '../context/DataContext'

// ── Check if API is available (legacy compat — prefer useHasAPI from DataContext) ─
export function hasIPC() {
  return typeof window !== 'undefined' && !!window.electronAPI
}

// ── Generic read hook ─────────────────────────────────────────────────
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
      if (!mounted.current) return
      // Guard: if result is an error-shaped object, treat as failure
      if (result && result.ok === false && result.error) {
        setError(result.error)
        setData(fallback)
      } else {
        setData(result ?? fallback)
      }
    } catch (err) {
      if (mounted.current) { setError(err?.message || String(err)); setData(fallback) }
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

// ── Generic mutation hook ─────────────────────────────────────────────
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
      setError(err.message)
      return { ok: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }, [mutator])

  return { execute, loading, error }
}

// ── Specific hooks (platform-agnostic via useAPI) ────────────────────
export function useSettings() {
  const api = useAPI()
  return useQuery(() => api ? api.settings.get() : {}, [], {})
}

export function useServices() {
  const api = useAPI()
  return useQuery(() => api ? api.services.all() : [], [], [])
}

export function useWashers() {
  const api = useAPI()
  return useQuery(() => api ? api.washers.all() : [], [], [])
}

export function useClients() {
  const api = useAPI()
  return useQuery(() => api ? api.clients.all() : [], [], [])
}

export function useTickets(params = {}) {
  const api = useAPI()
  const key = JSON.stringify(params)
  return useQuery(() => api ? api.tickets.all(params) : [], [key], [])
}

export function useQueueActive() {
  const api = useAPI()
  return useQuery(() => api ? api.queue.active() : [], [], [])
}

export function useCommissionsByPeriod(from, to) {
  const api = useAPI()
  return useQuery(() => api ? api.commissions.byPeriod({ from, to }) : [], [from, to], [])
}

export function useCuadreHistory() {
  const api = useAPI()
  return useQuery(() => api ? api.cuadre.history() : [], [], [])
}

export function useDailySummary(date) {
  const api = useAPI()
  return useQuery(() => api ? api.cuadre.daily(date) : {}, [date], {})
}

export function useNCFSequences() {
  const api = useAPI()
  return useQuery(() => api ? api.ncf.sequences() : [], [], [])
}

export function useCajaChica() {
  const api = useAPI()
  return useQuery(() => api ? api.cajaChica.all() : [], [], [])
}

export function useNotas() {
  const api = useAPI()
  return useQuery(() => api ? api.notas.all() : [], [], [])
}

export function useSellers() {
  const api = useAPI()
  return useQuery(() => api ? api.sellers.all() : [], [], [])
}

export function useUsers() {
  const api = useAPI()
  return useQuery(() => api ? api.users.all() : [], [], [])
}
