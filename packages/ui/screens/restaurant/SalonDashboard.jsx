/**
 * SalonDashboard.jsx — v2.16.3 Restaurante H5
 *
 * Manager Resumen del Salón. Pro PLUS+ (gated by `restaurant_salon_dashboard`).
 * Owner / CFO / accountant / manager only — RESTRICTED route. Brand:
 * black/white/#b3001e ONLY. Spanish copy.
 *
 * Tiles:
 *   1. Mesas activas (ocupadas+acuenta / total) with progress bar.
 *   2. Tiempo prom mesa hoy (live ocupadas avg + closed-today avg).
 *   3. Mesa con cuenta más alta (live ticket totals).
 *   4. Ventas turno (suma tickets.total mode='mesa' desde apertura actual).
 *
 * Lists:
 *   - Mesas que tardan: ocupadas con seated_at > 90 min.
 *   - Top platos hoy: agg ticket_items por service hoy, top 10.
 *   - Por mesero hoy: agg por waiter_empleado_id (mesas, ventas).
 *
 * Polls every 30s. Pure read-only — no mutations.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  BarChart3, Clock, Users, AlertTriangle, TrendingUp, ChefHat,
  Loader2, Eye, RefreshCw,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'

const ALLOWED = ['owner', 'cfo', 'accountant', 'manager']
const POLL_MS = 30_000
const SLOW_TABLE_THRESHOLD_MIN = 90

function fmtRD(n) {
  return 'RD$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function elapsedMin(seatedAt, now = Date.now()) {
  if (!seatedAt) return 0
  const t = new Date(seatedAt).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 60000))
}

function fmtElapsed(mins) {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60), m = mins % 60
  return `${h}h ${m}m`
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

// ── Tile ────────────────────────────────────────────────────────────────────
function Tile({ icon: Icon, label, value, sub, accent }) {
  const accentClass = {
    crimson:  'bg-[#b3001e] text-white',
    black:    'bg-black text-white',
    white:    'bg-white dark:bg-white/5 text-slate-900 dark:text-white border border-slate-200 dark:border-white/10',
  }[accent] || 'bg-white dark:bg-white/5 text-slate-900 dark:text-white border border-slate-200 dark:border-white/10'
  const iconBg = accent === 'crimson' || accent === 'black' ? 'bg-white/10' : 'bg-[#b3001e]/10'
  const iconColor = accent === 'crimson' || accent === 'black' ? 'text-white' : 'text-[#b3001e]'
  const subColor = accent === 'crimson' || accent === 'black' ? 'text-white/70' : 'text-slate-500 dark:text-white/50'
  const labelColor = accent === 'crimson' || accent === 'black' ? 'text-white/70' : 'text-slate-500 dark:text-white/60'

  return (
    <div className={`rounded-2xl p-4 ${accentClass}`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-[10px] uppercase tracking-[1.5px] font-extrabold ${labelColor}`}>{label}</span>
        <div className={`w-8 h-8 rounded-lg grid place-items-center ${iconBg}`}>
          <Icon size={15} className={iconColor} />
        </div>
      </div>
      <div className="text-2xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {sub && <div className={`text-xs mt-1 ${subColor}`}>{sub}</div>}
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function SalonDashboard() {
  const api = useAPI()
  const { user } = useAuth()
  const [now, setNow] = useState(Date.now())
  const [data, setData] = useState({
    mesas: [], tickets: [], items: [], empleados: [], shiftStartIso: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  if (!ALLOWED.includes(user?.role)) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-black">
        <div className="text-center">
          <Eye size={40} className="text-slate-300 dark:text-white/40 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-white/60">Acceso restringido — solo para gerencia.</p>
        </div>
      </div>
    )
  }

  const reload = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const today = todayISO()
      const todayStart = `${today}T00:00:00`
      const todayEnd   = `${today}T23:59:59`

      // Resolve current shift open-at if available (best-effort).
      let shiftStartIso = todayStart
      try {
        const open = await (api.cuadre?.getOpen?.({ user_id: user?.id, cajero_supabase_id: user?.supabase_id }) || null)
        if (open?.opened_at) shiftStartIso = open.opened_at
      } catch { /* non-fatal */ }

      const [mesas, todayTickets, empleados] = await Promise.all([
        api.mesas?.list?.() || [],
        api.tickets?.all?.({ dateFrom: todayStart, dateTo: todayEnd, limit: 5000 }) || [],
        api.empleados?.list?.() || api.empleados?.getAll?.() || [],
      ])

      // Flatten ticket_items already present on each ticket (web.js attaches them).
      const items = []
      for (const t of (todayTickets || [])) {
        for (const it of (t.items || [])) {
          items.push({ ...it, ticket_status: t.status, ticket_total: t.total, ticket_mesa_id: t.mesa_id, waiter_empleado_supabase_id: t.waiter_empleado_supabase_id, paid_at: t.paid_at, created_at: t.created_at })
        }
      }

      setData({
        mesas: Array.isArray(mesas) ? mesas : [],
        tickets: Array.isArray(todayTickets) ? todayTickets : [],
        items,
        empleados: Array.isArray(empleados) ? empleados : [],
        shiftStartIso,
      })
      setError(null)
    } catch (e) {
      console.error('[SalonDashboard] load failed', e)
      setError(e?.message || 'Error cargando dashboard')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [api, user])

  useEffect(() => { reload() }, [reload])

  // Poll every 30s, ticking `now` every 30s for live elapsed values.
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); reload() }, POLL_MS)
    return () => clearInterval(id)
  }, [reload])

  // ── Tile data ────────────────────────────────────────────────────────────
  const { mesas, tickets, items, empleados, shiftStartIso } = data
  const totalMesas = mesas.length
  const occupiedMesas = mesas.filter(m => m.status === 'ocupada' || m.status === 'acuenta')
  const occupiedCount = occupiedMesas.length

  const liveAvgMin = useMemo(() => {
    if (!occupiedMesas.length) return 0
    const sum = occupiedMesas.reduce((s, m) => s + elapsedMin(m.seated_at, now), 0)
    return Math.round(sum / occupiedMesas.length)
  }, [occupiedMesas, now])

  const closedAvgMin = useMemo(() => {
    const closed = (tickets || []).filter(t => (t.status === 'cobrado') && t.created_at && t.paid_at && t.mode === 'mesa')
    if (!closed.length) return 0
    const sum = closed.reduce((s, t) => {
      const a = new Date(t.created_at).getTime()
      const b = new Date(t.paid_at).getTime()
      if (Number.isFinite(a) && Number.isFinite(b)) return s + Math.max(0, Math.floor((b - a) / 60000))
      return s
    }, 0)
    return Math.round(sum / closed.length)
  }, [tickets])

  const blendedAvgMin = useMemo(() => {
    const parts = [liveAvgMin, closedAvgMin].filter(x => x > 0)
    if (!parts.length) return 0
    return Math.round(parts.reduce((s, x) => s + x, 0) / parts.length)
  }, [liveAvgMin, closedAvgMin])

  const highestMesa = useMemo(() => {
    if (!occupiedMesas.length) return null
    let best = null, bestTotal = -1
    for (const m of occupiedMesas) {
      const total = Number(m.active_ticket_total ?? m.current_ticket_total ?? 0)
      if (total > bestTotal) { best = m; bestTotal = total }
    }
    return best ? { mesa: best, total: bestTotal } : null
  }, [occupiedMesas])

  const ventasTurno = useMemo(() => {
    if (!shiftStartIso) return 0
    const start = new Date(shiftStartIso).getTime()
    if (!Number.isFinite(start)) return 0
    let sum = 0
    for (const t of (tickets || [])) {
      if (t.status === 'cobrado' && t.mode === 'mesa') {
        const ts = new Date(t.paid_at || t.created_at).getTime()
        if (Number.isFinite(ts) && ts >= start) sum += Number(t.total || 0)
      }
    }
    return sum
  }, [tickets, shiftStartIso])

  // Mesas que tardan: ocupadas con elapsed > threshold, ordenado descendente.
  const slowTables = useMemo(() => {
    return occupiedMesas
      .map(m => ({
        mesa: m,
        mins: elapsedMin(m.seated_at, now),
        waiter: empleados.find(e => e.supabase_id === m.waiter_empleado_supabase_id)?.nombre
             || empleados.find(e => e.supabase_id === m.waiter_empleado_supabase_id)?.name
             || 'Sin asignar',
      }))
      .filter(x => x.mins > SLOW_TABLE_THRESHOLD_MIN)
      .sort((a, b) => b.mins - a.mins)
  }, [occupiedMesas, empleados, now])

  // Top platos hoy
  const topPlatos = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      // Skip voided tickets and tip rows
      if (!it || !it.name) continue
      if (it.ticket_status === 'nula' || it.ticket_status === 'voided' || it.ticket_status === 'merged') continue
      const key = it.service_supabase_id || it.name
      const qty = Number(it.quantity || it.qty || 1)
      const rev = Number(it.price || 0) * qty
      const cur = map.get(key) || { name: it.name, qty: 0, revenue: 0 }
      cur.qty += qty
      cur.revenue += rev
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, 10)
  }, [items])

  // Por mesero hoy
  const porMesero = useMemo(() => {
    const map = new Map()
    for (const t of (tickets || [])) {
      if (t.mode !== 'mesa' || t.status !== 'cobrado') continue
      const key = t.waiter_empleado_supabase_id || '__sin_mesero__'
      const cur = map.get(key) || { count: 0, revenue: 0, tip: 0, name: null }
      cur.count += 1
      cur.revenue += Number(t.total || 0)
      cur.tip += Number(t.tip_amount || 0)
      map.set(key, cur)
    }
    const rows = []
    for (const [sid, agg] of map.entries()) {
      const emp = empleados.find(e => e.supabase_id === sid)
      const name = emp?.nombre || emp?.name || (sid === '__sin_mesero__' ? 'Sin asignar' : '—')
      rows.push({ name, ...agg })
    }
    return rows.sort((a, b) => b.revenue - a.revenue)
  }, [tickets, empleados])

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-500 dark:text-white/50">
        <Loader2 size={20} className="animate-spin mr-2" /> Cargando resumen…
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black p-5 lg:p-7">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-[#b3001e]/10 grid place-items-center">
          <BarChart3 className="text-[#b3001e]" size={20} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Resumen del Salón</h1>
          <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Actualiza cada 30 s</p>
        </div>
        <button onClick={() => reload(true)} disabled={refreshing}
          className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 hover:border-[#b3001e] text-slate-700 dark:text-white/70 text-xs font-bold flex items-center gap-2 disabled:opacity-40">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refrescar
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/30 text-[#b3001e] text-xs flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile
          icon={Users}
          label="Mesas activas"
          value={`${occupiedCount}/${totalMesas || 0}`}
          sub={
            totalMesas > 0 ? (
              <div className="mt-2">
                <div className="h-1.5 rounded-full bg-white/20 dark:bg-white/10 overflow-hidden">
                  <div className="h-full bg-white" style={{ width: `${Math.min(100, (occupiedCount / Math.max(1, totalMesas)) * 100)}%` }} />
                </div>
              </div>
            ) : 'Sin mesas configuradas'
          }
          accent="crimson"
        />
        <Tile
          icon={Clock}
          label="Tiempo prom. mesa hoy"
          value={blendedAvgMin > 0 ? fmtElapsed(blendedAvgMin) : '—'}
          sub={`Activas ${liveAvgMin || 0} min · Cerradas ${closedAvgMin || 0} min`}
          accent="white"
        />
        <Tile
          icon={TrendingUp}
          label="Cuenta más alta"
          value={highestMesa ? fmtRD(highestMesa.total) : '—'}
          sub={highestMesa ? `Mesa ${highestMesa.mesa.name}` : 'Sin mesas activas'}
          accent="white"
        />
        <Tile
          icon={BarChart3}
          label="Ventas del turno"
          value={fmtRD(ventasTurno)}
          sub={shiftStartIso ? `Desde ${new Date(shiftStartIso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}` : 'Turno cerrado'}
          accent="black"
        />
      </div>

      {/* Mesas que tardan */}
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-[#b3001e]" />
          <h2 className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white uppercase">
            Mesas que tardan ({slowTables.length})
          </h2>
          <span className="text-[10px] text-slate-400 dark:text-white/40">&gt; {SLOW_TABLE_THRESHOLD_MIN} min</span>
        </div>
        {slowTables.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400 dark:text-white/40">
            Sin mesas demoradas. Equipo al día.
          </div>
        ) : (
          <div className="space-y-1.5">
            {slowTables.map(({ mesa, mins, waiter }) => (
              <div key={mesa.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#b3001e] text-white flex items-center justify-center font-extrabold">
                    {mesa.name}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{mesa.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-white/50">Mesero: {waiter}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-extrabold text-[#b3001e] tabular-nums">{fmtElapsed(mins)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">en mesa</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top platos + Por mesero (2-col on lg) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <ChefHat size={16} className="text-[#b3001e]" />
            <h2 className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white uppercase">Top platos hoy</h2>
          </div>
          {topPlatos.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400 dark:text-white/40">Sin ventas hoy.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/50 border-b border-slate-100 dark:border-white/10">
                  <th className="text-left py-2 font-bold">#</th>
                  <th className="text-left py-2 font-bold">Plato</th>
                  <th className="text-right py-2 font-bold">Qty</th>
                  <th className="text-right py-2 font-bold">Ventas</th>
                </tr>
              </thead>
              <tbody>
                {topPlatos.map((p, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                    <td className="py-2 text-slate-400 dark:text-white/40 font-bold">{i + 1}</td>
                    <td className="py-2 text-slate-900 dark:text-white font-medium truncate">{p.name}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700 dark:text-white/80">{p.qty}</td>
                    <td className="py-2 text-right tabular-nums text-[#b3001e] font-bold">{fmtRD(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-[#b3001e]" />
            <h2 className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white uppercase">Por mesero hoy</h2>
          </div>
          {porMesero.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400 dark:text-white/40">Sin tickets cerrados hoy.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/50 border-b border-slate-100 dark:border-white/10">
                  <th className="text-left py-2 font-bold">Mesero</th>
                  <th className="text-right py-2 font-bold">Mesas</th>
                  <th className="text-right py-2 font-bold">Ventas</th>
                  <th className="text-right py-2 font-bold">Propinas</th>
                </tr>
              </thead>
              <tbody>
                {porMesero.map((m, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                    <td className="py-2 text-slate-900 dark:text-white font-medium truncate">{m.name}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700 dark:text-white/80">{m.count}</td>
                    <td className="py-2 text-right tabular-nums text-[#b3001e] font-bold">{fmtRD(m.revenue)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-500 dark:text-white/60">{fmtRD(m.tip)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
