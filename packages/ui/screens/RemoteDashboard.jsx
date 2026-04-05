import { useState, useEffect, useCallback } from 'react'
import { Globe, Eye, WifiOff, RefreshCw, TrendingUp, ReceiptText, Banknote, CreditCard, ArrowRightLeft, Clock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../i18n'
import { getSupabaseClient, getBusinessId, fetchDashboardData, ensureBusinessRegistered } from '@terminal-x/services/supabase.js'

const ALLOWED = ['owner', 'cfo', 'accountant']

const REFRESH_MS = 30_000

function fmtRD(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function pctChange(current, previous) {
  if (!previous) return null
  return ((current - previous) / previous * 100).toFixed(1)
}

const PM_LABEL = {
  efectivo:      { label: 'Efectivo',      icon: Banknote,        color: 'text-emerald-600 bg-emerald-50' },
  cash:          { label: 'Efectivo',      icon: Banknote,        color: 'text-emerald-600 bg-emerald-50' },
  tarjeta:       { label: 'Tarjeta',       icon: CreditCard,      color: 'text-blue-600 bg-blue-50'       },
  transferencia: { label: 'Transferencia', icon: ArrowRightLeft,  color: 'text-violet-600 bg-violet-50'   },
  credit:        { label: 'Crédito',       icon: Clock,           color: 'text-amber-600 bg-amber-50'     },
  credito:       { label: 'Crédito',       icon: Clock,           color: 'text-amber-600 bg-amber-50'     },
}

function MetricCard({ label, value, sub, trend, accent = 'blue' }) {
  const colors = {
    blue:    'border-blue-100   bg-blue-50/60',
    green:   'border-emerald-100 bg-emerald-50/60',
    violet:  'border-violet-100  bg-violet-50/60',
    amber:   'border-amber-100   bg-amber-50/60',
  }
  const trendColor = trend === null ? '' : Number(trend) >= 0 ? 'text-emerald-600' : 'text-red-500'
  return (
    <div className={`rounded-xl border p-4 ${colors[accent]} dark:border-white/10 dark:bg-white/5`}>
      <p className="text-xs text-slate-500 dark:text-white/60 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">{value}</p>
      {sub  && <p className="text-xs text-slate-500 dark:text-white/60 mt-0.5">{sub}</p>}
      {trend !== null && trend !== undefined && (
        <p className={`text-xs font-medium mt-1 ${trendColor}`}>
          {Number(trend) >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs ayer
        </p>
      )}
    </div>
  )
}

export default function RemoteDashboard() {
  const { user } = useAuth()
  const { lang }  = useLang()

  if (!ALLOWED.includes(user?.role)) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-black">
        <div className="text-center">
          <Eye size={40} className="text-slate-300 dark:text-white/40 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-white/60">Acceso restringido — solo para Owner, CFO y Contador.</p>
        </div>
      </div>
    )
  }

  const sb = getSupabaseClient()

  if (!sb) {
    return (
      <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <WifiOff size={40} className="text-slate-300 dark:text-white/40 mx-auto mb-4" />
            <p className="text-slate-700 dark:text-white font-semibold mb-1">Supabase no configurado</p>
            <p className="text-slate-400 dark:text-white/40 text-sm">
              Ve a Sistema → Respaldo y configura las credenciales de Supabase.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!getBusinessId()) {
    return <RegisteringBusiness lang={lang} />
  }

  return <Dashboard lang={lang} />
}

function RegisteringBusiness({ lang }) {
  const [status, setStatus] = useState('registering') // 'registering' | 'ok' | 'error'
  const [error,  setError]  = useState(null)

  useEffect(() => {
    ensureBusinessRegistered().then(res => {
      if (res.ok) setStatus('ok')
      else { setStatus('error'); setError(res.error) }
    })
  }, [])

  if (status === 'ok') return <Dashboard lang={lang} />

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
      <Header />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          {status === 'registering' ? (
            <>
              <RefreshCw size={32} className="text-slate-300 dark:text-white/40 mx-auto mb-4 animate-spin" />
              <p className="text-slate-600 dark:text-white/60 text-sm">Registrando negocio en la nube…</p>
            </>
          ) : (
            <>
              <WifiOff size={40} className="text-red-300 mx-auto mb-4" />
              <p className="text-slate-700 dark:text-white font-semibold mb-1">Error al registrar</p>
              <p className="text-slate-400 dark:text-white/40 text-sm">{error}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Header({ onRefresh, refreshing, lastUpdated }) {
  return (
    <div className="bg-white dark:bg-white/5 border-b border-slate-100 dark:border-white/10 px-6 py-4 flex items-center gap-3 shrink-0">
      <Globe size={18} className="text-slate-500 dark:text-white/60" />
      <div className="flex-1">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-white">Dashboard Remoto</h1>
        <p className="text-xs text-slate-400 dark:text-white/40">
          {lastUpdated ? `Actualizado ${fmtTime(lastUpdated)}` : 'Solo lectura — datos en tiempo real'}
        </p>
      </div>
      {onRefresh && (
        <button onClick={onRefresh} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-xs text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Actualizar
        </button>
      )}
    </div>
  )
}

function Dashboard({ lang }) {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [refreshing,  setRefreshing]  = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else           setLoading(true)
    setError(null)

    const result = await fetchDashboardData()

    if (result?.error) {
      setError(result.error)
    } else if (result) {
      setData(result)
      setLastUpdated(new Date().toISOString())
    }

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(interval)
  }, [load])

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400 dark:text-white/40 text-sm">Cargando datos…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
        <Header onRefresh={() => load(true)} refreshing={refreshing} lastUpdated={lastUpdated} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <WifiOff size={36} className="text-red-300 mx-auto mb-3" />
            <p className="text-slate-700 dark:text-white font-semibold mb-1">Error de conexion</p>
            <p className="text-slate-400 dark:text-white/40 text-sm">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { today, yesterday, week, recentTickets, paymentBreakdown } = data
  const trend = pctChange(today.revenue, yesterday.revenue)

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
      <Header onRefresh={() => load(true)} refreshing={refreshing} lastUpdated={lastUpdated} />

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* ── KPI row ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label={lang === 'es' ? 'Hoy — Ingresos' : 'Today — Revenue'}
            value={fmtRD(today.revenue)}
            sub={`${today.count} ${today.count === 1 ? 'ticket' : 'tickets'}`}
            trend={trend}
            accent="green"
          />
          <MetricCard
            label={lang === 'es' ? 'Ayer' : 'Yesterday'}
            value={fmtRD(yesterday.revenue)}
            sub={`${yesterday.count} tickets`}
            accent="blue"
          />
          <MetricCard
            label={lang === 'es' ? 'Últimos 7 días' : 'Last 7 days'}
            value={fmtRD(week.revenue)}
            sub={`${week.count} tickets`}
            accent="violet"
          />
          <MetricCard
            label={lang === 'es' ? 'Prom. por ticket' : 'Avg per ticket'}
            value={today.count ? fmtRD(today.revenue / today.count) : '—'}
            sub={lang === 'es' ? 'solo hoy' : 'today only'}
            accent="amber"
          />
        </div>

        {/* ── Payment breakdown + recent tickets ─────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          {/* Payment breakdown */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10 p-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-3">
              {lang === 'es' ? 'Formas de pago — 7 dias' : 'Payment methods — 7 days'}
            </p>
            {paymentBreakdown.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-white/40">Sin datos</p>
            ) : (
              <div className="space-y-2">
                {paymentBreakdown.map(({ method, total }) => {
                  const meta  = PM_LABEL[method] || { label: method, color: 'text-slate-600 bg-slate-50' }
                  const Icon  = meta.icon || Banknote
                  const pct   = week.revenue ? Math.round(total / week.revenue * 100) : 0
                  return (
                    <div key={method} className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${meta.color}`}>
                        <Icon size={12} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-slate-700 dark:text-white font-medium">{meta.label}</span>
                          <span className="text-slate-500 dark:text-white/60">{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-slate-600 dark:text-white/60 font-medium shrink-0">{fmtRD(total)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent tickets */}
          <div className="lg:col-span-2 bg-white dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10 p-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-3">
              {lang === 'es' ? 'Ultimos tickets' : 'Recent tickets'}
            </p>
            {recentTickets.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-white/40">Sin tickets registrados</p>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-white/5">
                {recentTickets.map((t, i) => {
                  const pm   = PM_LABEL[t.payment_method] || { label: t.payment_method || '—', color: 'text-slate-500 bg-slate-50' }
                  const Icon = pm.icon || Banknote
                  return (
                    <div key={i} className="py-2 flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${pm.color}`}>
                        <Icon size={11} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-800 dark:text-white truncate">
                          {t.doc_number || '—'}
                          {t.client_name ? <span className="text-slate-400 dark:text-white/40 font-normal"> · {t.client_name}</span> : null}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40 truncate">{t.services || '—'}</p>
                      </div>
                      {t.ncf && (
                        <span className="text-[10px] text-slate-400 dark:text-white/40 font-mono shrink-0">{t.ncf}</span>
                      )}
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold text-slate-700 dark:text-white">{fmtRD(t.total)}</p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40">{fmtTime(t.paid_at)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
