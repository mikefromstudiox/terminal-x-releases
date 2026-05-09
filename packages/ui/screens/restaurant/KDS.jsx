import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Slash, X, Loader2, ArrowLeft } from 'lucide-react'
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
    // M4 (audit) — exponentialRampToValueAtTime requires target > 0. The
    // prior 0.0001 endpoints flirted with the boundary; bump to 0.001 on
    // both ends so any browser that strictly enforces "must be positive"
    // never throws and silently kills the bell. Imperceptible audibly.
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55)
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
function OrderCard({ evt, now, staleSeconds, warnSeconds, onStart, onReady, onBump, busy }) {
  const firedAt = evt.fired_at ? new Date(evt.fired_at).getTime() : now
  const elapsedMs = Math.max(0, now - firedAt)
  const elapsedSec = Math.floor(elapsedMs / 1000)

  // M3 (audit) — thresholds come from app_settings (kds_warn_seconds,
  // kds_stale_seconds). Defaults preserve historical 300 / 600 values.
  let borderClass = 'border-zinc-800'
  let bgClass = 'bg-zinc-900'
  if (elapsedSec >= (staleSeconds || 600)) {
    borderClass = 'border-red-600 animate-pulse'
  } else if (elapsedSec >= (warnSeconds || 300)) {
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
    // M3 (audit) — read both warn + stale thresholds. Legacy
    // kds_stale_order_seconds is kept for backward compat with installs
    // that already set it; new key kds_stale_seconds wins when present.
    kds_stale_order_seconds: 600,
    kds_warn_seconds: 300,
    kds_sound_enabled: true,
  })

  // M5 (audit) — Audio context starts in 'suspended' state until a user
  // gesture. Show a banner inviting the user to tap to activate sound.
  // Persist dismissed state so we don't nag on every refresh.
  const [audioBlocked, setAudioBlocked] = useState(() => {
    try { return localStorage.getItem('kds_audio_unlocked') !== '1' } catch { return true }
  })

  // H8 (audit) — Realtime reconnect banner. Sample channel.state every 2s;
  // when not in {joined,joining} for >5s, show amber "Reconectando…". On
  // recovery, flash green for 2s.
  const [rtState, setRtState] = useState({ healthy: true, retries: 0, justRecovered: false })
  const channelRef = useRef(null)

  // v2.16.3 — 86 list (sold-out plates) modal
  const [show86, setShow86] = useState(false)

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
          kds_stale_order_seconds: Number(s.kds_stale_seconds) > 0
            ? Number(s.kds_stale_seconds)
            : (Number(s.kds_stale_order_seconds) > 0 ? Number(s.kds_stale_order_seconds) : 600),
          kds_warn_seconds: Number(s.kds_warn_seconds) > 0 ? Number(s.kds_warn_seconds) : 300,
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
        // H8 — stamp success time for the health probe.
        lastRefreshRef.current = Date.now()
        setError(null)
      } catch (e) {
        if (!alive) return
        try { window.__txReportError?.(e, { severity: 'warn', category: 'kds.refresh' }) } catch {}
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
      try { window.__txReportError?.(e, { severity: 'error', category: 'kds.advance', extra: { id: evt?.id, from: evt?.status, to: nextStatus, station: evt?.station } }) } catch {}
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

  // M5 (audit) — Click anywhere unlocks the audio context.
  const unlockAudio = useCallback(() => {
    try {
      const ctx = getAudioCtx()
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    } catch { /* noop */ }
    try { localStorage.setItem('kds_audio_unlocked', '1') } catch {}
    setAudioBlocked(false)
  }, [])

  useEffect(() => {
    if (!audioBlocked) return
    const handler = () => unlockAudio()
    window.addEventListener('click', handler, { once: true, capture: true })
    window.addEventListener('keydown', handler, { once: true, capture: true })
    return () => {
      window.removeEventListener('click', handler, { capture: true })
      window.removeEventListener('keydown', handler, { capture: true })
    }
  }, [audioBlocked, unlockAudio])

  // H8 (audit) — connection health probe. We don't have a direct hook into
  // Supabase channel state from the api wrapper, so we infer health from
  // ingest cadence: if the polling refresh hasn't completed in >15s the
  // realtime + safety-net poll have both stalled — show "Reconectando".
  // On the next successful refresh, show the green flash.
  const lastRefreshRef = useRef(Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      const stale = (Date.now() - lastRefreshRef.current) > 15000
      setRtState(prev => {
        if (stale && prev.healthy) return { healthy: false, retries: prev.retries + 1, justRecovered: false }
        if (!stale && !prev.healthy) {
          // Mark recovered + auto-clear after 2s.
          setTimeout(() => setRtState(p => ({ ...p, justRecovered: false })), 2000)
          return { healthy: true, retries: prev.retries, justRecovered: true }
        }
        return prev
      })
    }, 2000)
    return () => clearInterval(id)
  }, [])

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
      {/* M5 — audio gesture banner */}
      {audioBlocked && (
        <div
          onClick={unlockAudio}
          className="sticky top-0 z-20 bg-amber-500 text-black text-center py-2 px-4 font-bold text-sm cursor-pointer hover:bg-amber-400"
        >
          Toca para activar sonido (las alertas de cocina sonarán cuando lleguen nuevas órdenes)
        </div>
      )}
      {/* H8 — realtime reconnect banner */}
      {!rtState.healthy && (
        <div className="sticky top-0 z-20 bg-amber-500 text-black text-center py-2 px-4 font-bold text-sm">
          ⚠ Reconectando... (intento {rtState.retries})
        </div>
      )}
      {rtState.healthy && rtState.justRecovered && (
        <div className="sticky top-0 z-20 bg-emerald-500 text-black text-center py-2 px-4 font-bold text-sm">
          ✓ Conectado
        </div>
      )}
      {/* top bar */}
      <div className="sticky top-0 z-10 h-12 bg-black/95 backdrop-blur border-b border-zinc-800 flex items-center gap-4 px-4">
        <a
          href="/pos"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-bold text-zinc-300 hover:text-white hover:bg-zinc-800 border border-zinc-700"
          title="Volver al POS"
        >
          <ArrowLeft size={16} />
          Salir
        </a>
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
                warnSeconds={settings.kds_warn_seconds}
                busy={busyIds.has(evt.id)}
                onStart={() => transition(evt, 'in_progress')}
                onReady={() => transition(evt, 'ready')}
                onBump={() => transition(evt, 'bumped')}
              />
            ))}
          </div>
        )}
      </div>

      {/* v2.16.3 — 86 list floating button + modal */}
      <button
        onClick={() => setShow86(true)}
        className="fixed bottom-6 right-6 z-40 px-5 py-3 rounded-2xl bg-[#b3001e] hover:bg-[#8c0017] text-white text-sm font-bold shadow-2xl flex items-center gap-2"
        title="Ver y marcar platos agotados (86)"
      >
        <Slash size={16} />
        86 list
      </button>
      {show86 && <EightySixModal onClose={() => setShow86(false)} />}
    </div>
  )
}

// ─── v2.16.3 — 86 list modal ────────────────────────────────────────────────
// Lists every menu item with a quick-toggle. Cocina-friendly (large hit areas,
// dark theme to match the KDS board, instant optimistic UI).
function EightySixModal({ onClose }) {
  const api = useAPI()
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // service id in flight
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      // Prefer admin list so inactive flips don't disappear after toggle.
      const fn = api.services?.allAdmin || api.services?.all
      const list = (await fn?.()) || []
      // Restaurant-relevant only — menu items, ordered by category then name.
      const filtered = list
        .filter(s => s.is_menu_item === 1 || s.is_menu_item === true)
        .sort((a, b) =>
          (a.category || '').localeCompare(b.category || '') ||
          (a.name || '').localeCompare(b.name || '')
        )
      setServices(filtered)
    } catch (e) {
      setErr(e?.message || 'Error cargando platos.')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  async function toggle(svc) {
    const next = (svc.in_stock === 0 || svc.in_stock === false) ? 1 : 0
    const key = svc.id ?? svc.supabase_id
    setBusy(svc.id)
    // Optimistic flip
    setServices(prev => prev.map(r => r.id === svc.id ? { ...r, in_stock: next } : r))
    try {
      if (api.services?.setInStock) {
        await api.services.setInStock(key, next)
      } else {
        await api.services.update(svc.id, { in_stock: next })
      }
    } catch (e) {
      // Revert on failure
      setServices(prev => prev.map(r => r.id === svc.id ? { ...r, in_stock: svc.in_stock } : r))
      try { window.__txReportError?.(e, { severity: 'warn', category: 'kds.86_list.toggle', extra: { id: svc?.id, name: svc?.name, target: (svc.in_stock === 0 || svc.in_stock === false) ? 1 : 0 } }) } catch {}
      alert(e?.message || 'Error al actualizar.')
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return services
    const n = q.trim().toLowerCase()
    return services.filter(s =>
      (s.name || '').toLowerCase().includes(n) ||
      (s.category || '').toLowerCase().includes(n)
    )
  }, [services, q])

  const oosCount = useMemo(
    () => services.filter(s => s.in_stock === 0 || s.in_stock === false).length,
    [services]
  )

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#b3001e]/15 border border-[#b3001e]/40 flex items-center justify-center">
              <Slash size={18} className="text-[#b3001e]" />
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">86 list</h3>
              <p className="text-xs text-white/50">
                {oosCount > 0 ? `${oosCount} plato(s) agotado(s)` : 'Todos disponibles'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-2"><X size={20} /></button>
        </div>

        <div className="px-6 py-3 border-b border-zinc-800 shrink-0">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar plato o categoría…"
            className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#b3001e]"
          />
        </div>

        <div className="overflow-y-auto flex-1">
          {err && <div className="m-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{err}</div>}
          {loading ? (
            <div className="p-12 flex justify-center"><Loader2 size={24} className="animate-spin text-white/40" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-white/40 text-sm">Sin resultados.</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {filtered.map(s => {
                const oos = s.in_stock === 0 || s.in_stock === false
                return (
                  <button
                    key={s.id}
                    onClick={() => toggle(s)}
                    disabled={busy === s.id}
                    className="w-full flex items-center justify-between gap-3 px-6 py-4 hover:bg-white/5 disabled:opacity-50 text-left transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className={`text-base font-semibold truncate ${oos ? 'text-white/40 line-through' : 'text-white'}`}>
                        {s.name}
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">{s.category || 'Sin categoría'}</div>
                    </div>
                    <div className={`text-xs font-extrabold tracking-wide uppercase px-3 py-2 rounded-lg border min-w-[110px] text-center
                      ${oos
                        ? 'bg-[#b3001e] border-[#b3001e] text-white'
                        : 'bg-white/5 border-white/15 text-white/70'}`}>
                      {busy === s.id ? '...' : (oos ? 'Agotado' : 'Disponible')}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-semibold"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
