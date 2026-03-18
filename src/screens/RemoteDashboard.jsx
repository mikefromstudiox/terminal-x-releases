/**
 * RemoteDashboard — read-only web dashboard for remote access.
 *
 * Accessible to: owner, cfo, accountant roles only.
 * Auto-refreshes every 60 seconds.
 * No write operations — view only.
 *
 * To deploy as a standalone web app (outside Electron), export this component
 * and wrap it with its own auth flow that reads from Supabase directly.
 * The web URL would be: https://<your-app>.vercel.app/remote
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Globe, RefreshCw, Eye, TrendingUp, DollarSign,
  Users, Clock, CheckCircle2, AlertCircle, WifiOff,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getSupabaseClient } from '../services/supabase.js'

// ── Role guard ────────────────────────────────────────────────────────────────
const ALLOWED = ['owner', 'cfo', 'accountant']

// ── Demo data (replace with real Supabase queries) ────────────────────────────
function buildDemoSnapshot() {
  return {
    fetchedAt: new Date().toISOString(),
    today: {
      totalVendido:  48600,
      totalCobrado:  42800,
      cxcPendiente:   5800,
      carros:           24,
      facturas:         31,
      nulas:             1,
    },
    cxc: [
      { client: 'Grupo Mejía S.R.L.',    pendiente: 26500, limite: 25000, dias: 12 },
      { client: 'Importadora Del Norte', pendiente:  8400, limite: 20000, dias:  5 },
      { client: 'Ferretería El Clavo',   pendiente:  3200, limite: 15000, dias:  3 },
    ],
    washers: [
      { name: 'Juan Pérez',    cars: 8, commission: 1840 },
      { name: 'Luis García',   cars: 7, commission: 1610 },
      { name: 'Miguel Torres', cars: 6, commission: 1248 },
      { name: 'Pedro Díaz',    cars: 3, commission:  624 },
    ],
    monthlyTrend: [
      { label: 'Nov', amount: 182000 },
      { label: 'Dic', amount: 209000 },
      { label: 'Ene', amount: 196000 },
      { label: 'Feb', amount: 188000 },
      { label: 'Mar', amount: 142000 },  // current month partial
    ],
    recentTickets: [
      { no: 'T-0241', client: 'Consumidor Final', service: 'Lavado Completo', total: 1280, time: '14:32' },
      { no: 'T-0240', client: 'Grupo Mejía',      service: 'Detailing',        total: 5760, time: '13:58' },
      { no: 'T-0239', client: 'Consumidor Final', service: 'Lavado Básico',    total:  768, time: '13:21' },
      { no: 'T-0238', client: 'Seguros Caribe',   service: 'Cera Premium',     total: 3200, time: '12:44' },
      { no: 'T-0237', client: 'Consumidor Final', service: 'Aspirado',         total:  512, time: '12:08' },
    ],
  }
}

// ── Data fetcher ──────────────────────────────────────────────────────────────
async function fetchDashboardData() {
  const sb = getSupabaseClient()
  if (!sb) return buildDemoSnapshot()   // offline or not configured

  try {
    // Real queries would go here — for now return demo
    // const { data: tickets } = await sb.from('tickets').select('*').gte('paid_at', todayISO)
    return buildDemoSnapshot()
  } catch {
    return buildDemoSnapshot()
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return 'RD$' + Number(n||0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(part, total) {
  return total > 0 ? Math.round(part / total * 100) : 0
}

function MetricCard({ label, value, sub, color = 'slate', icon: Icon }) {
  const ring = { slate:'border-slate-100 bg-white', blue:'border-blue-200 bg-blue-50', green:'border-emerald-200 bg-emerald-50', red:'border-red-200 bg-red-50', amber:'border-amber-200 bg-amber-50' }
  const val  = { slate:'text-slate-800', blue:'text-blue-700', green:'text-emerald-700', red:'text-red-600', amber:'text-amber-700' }
  return (
    <div className={`rounded-2xl border p-5 flex-1 ${ring[color]}`}>
      <div className="flex justify-between items-start mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {Icon && <Icon size={15} className={val[color]} />}
      </div>
      <p className={`text-3xl font-bold tabular-nums ${val[color]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function RemoteDashboard() {
  const { user } = useAuth()
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [countdown, setCountdown] = useState(60)
  const [lastFetch, setLastFetch] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const snap = await fetchDashboardData()
    setData(snap)
    setLastFetch(new Date())
    setLoading(false)
    setCountdown(60)
  }, [])

  // Auto-refresh every 60s
  useEffect(() => {
    load()
    const refresh = setInterval(load, 60_000)
    const tick    = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => { clearInterval(refresh); clearInterval(tick) }
  }, [load])

  if (!ALLOWED.includes(user?.role)) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Eye size={40} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Acceso restringido — solo para Owner, CFO y Contador.</p>
        </div>
      </div>
    )
  }

  const d = data?.today || {}
  const maxMonth = Math.max(...(data?.monthlyTrend || []).map(m => m.amount))

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <Globe size={18} className="text-slate-500" />
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Dashboard Remoto</h1>
          <p className="text-xs text-slate-400">Solo lectura — actualización en {countdown}s</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {lastFetch && (
            <span className="text-xs text-slate-400">
              Actualizado: {lastFetch.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
          <span className="flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-600 px-3 py-1.5 rounded-lg">
            <Eye size={12} />
            Solo lectura
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Today's summary */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
            Resumen del día — {new Date().toLocaleDateString('es-DO', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}
          </p>
          <div className="flex gap-3">
            <MetricCard label="Total facturado"  value={fmt(d.totalVendido)}  sub={`${d.facturas} facturas`}  color="slate" icon={TrendingUp}   />
            <MetricCard label="Total cobrado"    value={fmt(d.totalCobrado)}  sub={`${pct(d.totalCobrado,d.totalVendido)}% cobrado`} color="green" icon={CheckCircle2} />
            <MetricCard label="CxC pendiente"    value={fmt(d.cxcPendiente)}  sub="por cobrar"                color="amber" icon={Clock}        />
            <MetricCard label="Carros lavados"   value={d.carros}             sub="hoy"                       color="blue"  icon={Users}        />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* Monthly trend */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-4">Tendencia mensual</p>
            <div className="flex items-end gap-3 h-32">
              {(data?.monthlyTrend || []).map((m, i) => {
                const h = maxMonth > 0 ? pct(m.amount, maxMonth) : 0
                const isLast = i === (data.monthlyTrend.length - 1)
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] text-slate-500 tabular-nums">{(m.amount/1000).toFixed(0)}k</span>
                    <div className="w-full relative" style={{ height: '80px' }}>
                      <div className={`absolute bottom-0 w-full rounded-t-md transition-all ${isLast ? 'bg-blue-400' : 'bg-slate-200'}`}
                        style={{ height: `${Math.max(4, h)}%` }} />
                    </div>
                    <span className={`text-[9px] font-medium ${isLast ? 'text-blue-600' : 'text-slate-400'}`}>{m.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Recent tickets */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Últimas transacciones</p>
            <div className="space-y-1">
              {(data?.recentTickets || []).map(t => (
                <div key={t.no} className="flex items-center py-1.5 border-b border-slate-50 last:border-0">
                  <span className="text-xs font-mono text-slate-400 w-16">{t.no}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 truncate">{t.client}</p>
                    <p className="text-[10px] text-slate-400">{t.service}</p>
                  </div>
                  <span className="text-sm font-medium text-slate-700 tabular-nums">{fmt(t.total)}</span>
                  <span className="text-[10px] text-slate-400 ml-3 w-12 text-right">{t.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* CxC */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Cuentas x Cobrar</p>
            <div className="space-y-2">
              {(data?.cxc || []).map((c, i) => {
                const over = c.pendiente > c.limite
                return (
                  <div key={i} className={`p-3 rounded-xl ${over ? 'bg-red-50 border border-red-100' : 'bg-slate-50'}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-slate-800">{c.client}</span>
                      <span className={`text-sm font-bold tabular-nums ${over ? 'text-red-600' : 'text-slate-700'}`}>{fmt(c.pendiente)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Límite: {fmt(c.limite)}</span>
                      <span>{c.dias} días</span>
                    </div>
                    <div className="h-1 bg-white rounded-full mt-2 overflow-hidden">
                      <div className={`h-full rounded-full ${over ? 'bg-red-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.min(pct(c.pendiente, c.limite), 100)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Washer commissions */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Comisiones hoy</p>
            <div className="space-y-2">
              {(data?.washers || []).map((w, i) => {
                const maxComm = Math.max(...data.washers.map(x => x.commission))
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-sky-100 flex items-center justify-center text-[10px] font-bold text-sky-700 flex-shrink-0">
                      {w.name.split(' ').slice(0,2).map(p=>p[0]).join('')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between mb-0.5">
                        <span className="text-sm text-slate-700">{w.name}</span>
                        <span className="text-sm font-medium tabular-nums text-emerald-700">{fmt(w.commission)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full"
                          style={{ width: `${maxComm > 0 ? pct(w.commission, maxComm) : 0}%` }} />
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 w-12 text-right">{w.cars} carros</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Read-only notice */}
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <Eye size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-700">
            Este dashboard es de solo lectura. Para registrar transacciones o modificar datos, use Terminal X POS en la caja.
          </p>
        </div>
      </div>
    </div>
  )
}
