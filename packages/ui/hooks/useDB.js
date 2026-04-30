/**
 * useDB.js — React hooks for all database operations.
 *
 * Every hook returns { data, loading, error, reload }.
 * Writes return { execute, loading, error }.
 *
 * All hooks go through the DataContext abstraction (useAPI)
 * so they work on both Electron and Web platforms.
 *
 * SECURITY: every hook MUST include `api` in its deps array. The `api`
 * object closes over the current tenant's business_id (createWebAPI(supabase,
 * businessId) on web, electronAPI on desktop). When the user signs out and
 * signs back in as a different tenant, useMemo rebuilds `api` with the new
 * business_id — but if the hook's deps were empty, useEffect never re-runs
 * and the previous tenant's data stays in React state. This was the 2026-04-29
 * cross-tenant data exposure root cause. The forced remount on the
 * SupabaseAuthGate `key` prop is the primary defense; this is belt-and-
 * suspenders for in-tab impersonation switches that reuse the same auth user.
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
// Every hook below MUST include `api` in its deps so a tenant change re-fetches.
export function useSettings() {
  const api = useAPI()
  return useQuery(() => api ? api.settings.get() : {}, [api], {})
}

export function useServices() {
  const api = useAPI()
  return useQuery(() => api ? api.services.all() : [], [api], [])
}

export function useWashers() {
  const api = useAPI()
  return useQuery(() => api ? api.washers.all() : [], [api], [])
}

export function useClients() {
  const api = useAPI()
  return useQuery(() => api ? api.clients.all() : [], [api], [])
}

export function useTickets(params = {}) {
  const api = useAPI()
  const key = JSON.stringify(params)
  return useQuery(() => api ? api.tickets.all(params) : [], [api, key], [])
}

export function useQueueActive() {
  const api = useAPI()
  return useQuery(() => api ? api.queue.active() : [], [api], [])
}

export function useCommissionsByPeriod(from, to) {
  const api = useAPI()
  return useQuery(() => api ? api.commissions.byPeriod({ from, to }) : [], [api, from, to], [])
}

export function useCuadreHistory() {
  const api = useAPI()
  return useQuery(() => api ? api.cuadre.history() : [], [api], [])
}

export function useDailySummary(date) {
  const api = useAPI()
  return useQuery(() => api ? api.cuadre.daily(date) : {}, [api, date], {})
}

export function useNCFSequences() {
  const api = useAPI()
  return useQuery(() => api ? api.ncf.sequences() : [], [api], [])
}

export function useCajaChica() {
  const api = useAPI()
  return useQuery(() => api ? api.cajaChica.all() : [], [api], [])
}

export function useNotas() {
  const api = useAPI()
  return useQuery(() => api ? api.notas.all() : [], [api], [])
}

export function useSellers() {
  const api = useAPI()
  return useQuery(() => api ? api.sellers.all() : [], [api], [])
}

export function useUsers() {
  const api = useAPI()
  return useQuery(() => api ? api.users.all() : [], [api], [])
}
