import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useAPI } from '../../context/DataContext'

/**
 * Kitchen Display System (KDS)
 * Fullscreen high-contrast board for kitchen tablets / monitors.
 * Route: /kds  (wrapper removes DashboardLayout chrome)
 */

const STATUS_LABEL = {
  fired: 'Disparado',
  in_progress: 'En proceso',
  ready: 'Listo',
}

const STATUS_BADGE_CLASS = {
  fired: 'bg-red-600 text-white',
  in_progress: 'bg-amber-500 text-black',
  ready: 'bg-emerald-500 text-black',
}

function getQueryParam(name) {
  try {
    const url = new URL(window.location.href)
    return url.searchParams.get(name)
  } catch {
    return null
  }
}

function setQueryParam(name, value) {
  try {
    const url = new URL(window.location.href)
    if (value == null || value === '' || value === 'all') url.searchParams.delete(name)
    else url.searchParams.set(name, value)
    window.history.replaceState({}, '', url.toString())
  } catch {
    /* noop */
  }
}

function formatElapsed(ms) {
  if (ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatClock(d) {
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

// ---------- sound ----------
let _audioCtx = null
function getAudioCtx() {
  if (_audioCtx) return _audioCtx
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null
    _audioCtx = new Ctor()
    return _audioCtx
  } catch {
    return null
  }
}

function playBell() {
  const ctx = getAudioCtx()
  if (!ctx) return
  try {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.6)
  } catch {
    /* silent fallback */
  }
}

// ---------- hooks ----------
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

// ---------- card ----------
function OrderCard({ evt, now, staleSeconds, onStart, onReady, onBump, busy }) {
  const firedAt = evt.fired_at ? new Date(evt.fired_at).getTime() : now
  const elapsedMs = Math.max(0, now - firedAt)
  const elapsedSec = Math.floor(elapsedMs / 1000)

  let borderClass = 'border-zinc-800'
  let bgClass = 'bg-zinc-900'
  if (elapsedSec >= staleSeconds || elapsedSec >= 600) {
    borderClass = 'border-red-600 animate-pulse'
  } else if (elapsedSec >= 300) {
    borderClass = 'border-amber-500'
  }

  const mesaLabel = evt.mesa_name || (evt.mesa_id ? `Mesa ${evt.mesa_id}` : 'Para llevar')
  const itemName = evt.item_name || 'Ítem'
  const modifiers = Array.isArray(evt.modifiers) ? evt.modifiers : []
  const waiter = evt.waiter_initials || evt.waiter || null
  const status = evt.status || 'fired'

  return (
    <div
      className={`rounded-2xl border-4 ${borderClass} ${bgClass} p-5 flex flex-col gap-3 min-h-[240px] shadow-xl`}
    >
      <div className="flex items-center justify-between">
        <div className="text-3xl font-black tracking-tight text-white leading-none">
          {mesaLabel}
        </div>
        <div className="text-3xl font-mono font-bold text-white tabular-nums">
          {formatElapsed(elapsedMs)}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <div className="text-4xl font-black text-white leading-tight break-words">
          {itemName}
        </div>
        {modifiers.length > 0 && (
          <ul className="mt-2 space-y-1">
            {modifiers.map((m, i) => {
              const label = typeof m === 'string' ? m : (m?.name || m?.label || '')
              if (!label) return null
              return (
                <li key={i} className="text-xl text-zinc-300 leading-snug">
                  • {label}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800">
        <div className="flex items-center gap-3">
          {waiter && (
            <div className="h-10 w-10 rounded-full bg-zinc-700 text-white font-bold text-base flex items-center justify-center">
              {String(waiter).slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className={`px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider ${STATUS_BADGE_CLASS[status] || 'bg-zinc-700 text-white'}`}>
            {STATUS_LABEL[status] || status}
          </span>
        </div>
        <div className="flex gap-2">
          {status === 'fired' && (
            <button
              disabled={busy}
              onClick={onStart}
              className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-lg font-bold"
            >
              Iniciar
            </button>
          )}
          {status === 'in_progress' && (
            <button
              disabled={busy}
              onClick={onReady}
              className="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black text-lg font-bold"
            >
              Listo
            </button>
          )}
          {status === 'ready' && (
            <button
              disabled={busy}
              onClick={onBump}
              className="px-5 py-3 rounded-xl bg-white hover:bg-zinc-200 disabled:opacity-50 text-black text-lg font-bold"
            >
              Marcar servido
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- main ----------
export default function KDS() {
  const api = useAPI()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyIds, setBusyIds] = useState(() => new Set())
  const [stations, setStations] = useState([])

  const [station, setStation] = useState(() => {
    const qp = getQueryParam('station')
    if (qp) return qp
    try {
      return localStorage.getItem('kds_station_filter') || 'all'
    } catch {
      return 'all'
    }
  })

  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('kds_muted') === '1'
    } catch {
      return false
    }
  })

  const [settings, setSettings] = useState({
    kds_stale_order_seconds: 600,
    kds_sound_enabled: true,
  })

  const now = useNow(1000)
  const clockNow = useMemo(() => new Date(now), [now])

  const knownIdsRef = useRef(new Set())
  const firstLoadRef = useRef(true)
  const cacheRef = useRef(new Map()) // ticket_item_id -> enrichment

  // ---- load settings
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const s = (await api.settings?.get?.()) || {}
        if (!alive) return
        setSettings({
          kds_stale_order_seconds: Number(s.kds_stale_order_seconds) > 0 ? Number(s.kds_stale_order_seconds) : 600,
          kds_sound_enabled: s.kds_sound_enabled === false ? false : true,
        })
      } catch {
        /* defaults ok */
      }
    })()
    return () => {
      alive = false
    }
  }, [api])

  // ---- enrich raw rows fallback (Option B)
  const enrichRow = useCallback(
    async (row) => {
      if (row.item_name) return row
      const key = row.ticket_item_id
      if (key && cacheRef.current.has(key)) {
        return { ...cacheRef.current.get(key), ...row }
      }
      try {
        let item_name = row.item_name
        let modifiers = row.modifiers
        let mesa_name = row.mesa_name
        let waiter_initials = row.waiter_initials
        if (!item_name && api.ticketItems?.get) {
          const ti = await api.ticketItems.get(row.ticket_item_id).catch(() => null)
          if (ti) {
            item_name = ti.item_name || ti.name || ti.product_name
            modifiers = ti.modifiers || modifiers
            waiter_initials = waiter_initials || ti.waiter_initials
          }
        }
        if (!mesa_name && row.mesa_id && api.mesas?.get) {
          const m = await api.mesas.get(row.mesa_id).catch(() => null)
          if (m) mesa_name = m.name || m.label || `Mesa ${m.number || row.mesa_id}`
        }
        const enriched = { ...row, item_name, modifiers, mesa_name, waiter_initials }
        if (key) cacheRef.current.set(key, enriched)
        return enriched
      } catch {
        return row
      }
    },
    [api]
  )

  const ingest = useCallback(
    async (rows) => {
      if (!Array.isArray(rows)) return
      const needsEnrich = rows.some((r) => !r.item_name)
      const final = needsEnrich ? await Promise.all(rows.map(enrichRow)) : rows

      // detect new fired events
      const prevKnown = knownIdsRef.current
      const newIds = []
      const nextKnown = new Set()
      for (const r of final) {
        nextKnown.add(r.id)
        if (!prevKnown.has(r.id) && r.status === 'fired') newIds.push(r.id)
      }
      knownIdsRef.current = nextKnown

      if (!firstLoadRef.current && newIds.length > 0) {
        if (!muted && settings.kds_sound_enabled) playBell()
      }
      firstLoadRef.current = false

      // dedupe stations
      const stationSet = new Set()
      final.forEach((r) => r.station && stationSet.add(r.station))
      setStations((prev) => {
        const merged = new Set([...prev, ...stationSet])
        return Array.from(merged).sort()
      })

      setEvents(final)
      setLoading(false)
    },
    [enrichRow, muted, settings.kds_sound_enabled]
  )

  // ---- initial + polling + realtime
  useEffect(() => {
    let alive = true
    let pollId = null
    let unsubscribe = null

    const refresh = async () => {
      try {
        const rows = (await api.kds?.listActive?.()) || []
        if (!alive) return
        await ingest(rows)
        setError(null)
      } catch (e) {
        if (!alive) return
        setError(e?.message || 'Error al cargar órdenes')
        setLoading(false)
      }
    }

    refresh()

    if (typeof api.subscribeKdsEvents === 'function') {
      try {
        unsubscribe = api.subscribeKdsEvents(() => {
          refresh()
        })
      } catch {
        /* fall through to polling */
      }
    }

    if (!unsubscribe) {
      pollId = setInterval(refresh, 3000)
    } else {
      // safety net poll every 15s even with realtime
      pollId = setInterval(refresh, 15000)
    }

    return () => {
      alive = false
      if (pollId) clearInterval(pollId)
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe()
        } catch {
          /* noop */
        }
      }
    }
  }, [api, ingest])

  // ---- actions
  const markBusy = (id, v) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (v) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const transition = async (evt, nextStatus) => {
    markBusy(evt.id, true)
    // optimistic
    setEvents((prev) => {
      if (nextStatus === 'bumped') return prev.filter((e) => e.id !== evt.id)
      return prev.map((e) => (e.id === evt.id ? { ...e, status: nextStatus } : e))
    })
    try {
      await api.kds.setStatus(evt.id, nextStatus)
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar el estado')
      // refetch to reconcile
      try {
        const rows = (await api.kds?.listActive?.()) || []
        await ingest(rows)
      } catch {
        /* noop */
      }
    } finally {
      markBusy(evt.id, false)
    }
  }

  // ---- station filter persist
  const onStationChange = (val) => {
    setStation(val)
    try {
      localStorage.setItem('kds_station_filter', val)
    } catch {
      /* noop */
    }
    setQueryParam('station', val)
  }

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m
      try {
        localStorage.setItem('kds_muted', next ? '1' : '0')
      } catch {
        /* noop */
      }
      return next
    })
  }

  // ---- filtered & sorted
  const visible = useMemo(() => {
    let list = events.filter((e) => e.status !== 'bumped')
    if (station && station !== 'all') list = list.filter((e) => e.station === station)
    // oldest first (most urgent)
    list.sort((a, b) => {
      const ta = a.fired_at ? new Date(a.fired_at).getTime() : 0
      const tb = b.fired_at ? new Date(b.fired_at).getTime() : 0
      return ta - tb
    })
    return list
  }, [events, station])

  return (
    <div className="fixed inset-0 bg-black text-white overflow-auto">
      {/* top bar */}
      <div className="sticky top-0 z-10 h-12 bg-black/95 backdrop-blur border-b border-zinc-800 flex items-center gap-4 px-4">
        <div className="text-xl font-black tracking-widest text-white">KDS</div>
        <div className="text-lg font-mono tabular-nums text-zinc-300">
          {formatClock(clockNow)}
        </div>
        {stations.length > 0 && (
          <select
            value={station}
            onChange={(e) => onStationChange(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-white rounded-md px-2 py-1 text-sm"
          >
            <option value="all">Todas las estaciones</option>
            {stations.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-sm font-bold">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          {visible.length} activas
        </span>
        <button
          onClick={toggleMute}
          className={`px-3 py-1 rounded-md text-sm font-bold border ${muted ? 'bg-zinc-800 border-zinc-700 text-zinc-400' : 'bg-red-600 border-red-500 text-white'}`}
          title={muted ? 'Sonido silenciado' : 'Sonido activo'}
        >
          {muted ? 'Silenciado' : 'Sonido'}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-4 py-2 rounded-md bg-red-900/40 border border-red-700 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* grid */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-[60vh] text-zinc-500 text-2xl">
            Cargando órdenes…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[70vh] text-center">
            <div className="text-6xl font-black text-zinc-700 mb-3">Sin órdenes</div>
            <div className="text-xl text-zinc-500">Esperando disparos de cocina…</div>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visible.map((evt) => (
              <OrderCard
                key={evt.id}
                evt={evt}
                now={now}
                staleSeconds={settings.kds_stale_order_seconds}
                busy={busyIds.has(evt.id)}
                onStart={() => transition(evt, 'in_progress')}
                onReady={() => transition(evt, 'ready')}
                onBump={() => transition(evt, 'bumped')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
