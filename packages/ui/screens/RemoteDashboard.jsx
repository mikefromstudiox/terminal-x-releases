import { useState, useEffect, useCallback, useRef } from 'react'
import { Globe, Eye, WifiOff, RefreshCw, TrendingUp, ReceiptText, Banknote, CreditCard, ArrowRightLeft, Clock,
  Activity, UserX, Tag, XCircle, Wallet, Percent, Package, PiggyBank, Scale, Lock, ChevronDown, ChevronUp, ClipboardList, Sunrise } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI } from '../context/DataContext'
import { useLang } from '../i18n'
import { getSupabaseClient, getBusinessId, fetchDashboardData, ensureBusinessRegistered } from '@terminal-x/services/supabase.js'

const ALLOWED = ['owner', 'cfo', 'accountant']

const REFRESH_MS = 30_000

function fmtRD(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function parseSqliteUtc(v) {
  if (!v) return null
  if (v instanceof Date) return v
  if (typeof v === 'string' && !v.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(v)) {
    return new Date(v.replace(' ', 'T') + 'Z')
  }
  return new Date(v)
}
function fmtTime(iso) {
  if (!iso) return '—'
  return parseSqliteUtc(iso).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtClock(iso) {
  if (!iso) return '—'
  return parseSqliteUtc(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
// Pull-to-refresh for iOS Safari. No deps. Fires onRefresh() when user drags
// >80px down while scrollTop=0. Returns ref to attach to scroll container
// plus current pull distance so we can render a visual indicator.
function usePullToRefresh(onRefresh, enabled = true) {
  const ref = useRef(null)
  const startY = useRef(0)
  const pulling = useRef(false)
  const [pull, setPull] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const onStart = (e) => {
      if (el.scrollTop > 0) { pulling.current = false; return }
      startY.current = e.touches[0].clientY
      pulling.current = true
    }
    const onMove = (e) => {
      if (!pulling.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0 && el.scrollTop <= 0) {
        setPull(Math.min(dy, 120))
        if (dy > 10) e.preventDefault()
      }
    }
    const onEnd = () => {
      if (pulling.current && pull > 80) onRefresh()
      pulling.current = false
      setPull(0)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove',  onMove,  { passive: false })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove',  onMove)
      el.removeEventListener('touchend',   onEnd)
    }
  }, [onRefresh, enabled, pull])
  return [ref, pull]
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
    <div className={`rounded-xl border p-3 md:p-4 ${colors[accent]} dark:border-white/10 dark:bg-white/5`}>
      <p className="text-[11px] md:text-xs text-slate-500 dark:text-white/60 mb-1 leading-tight">{label}</p>
      <p className="text-xl md:text-2xl font-extrabold text-slate-800 dark:text-white tracking-tight tabular-nums">{value}</p>
      {sub  && <p className="text-[11px] md:text-xs text-slate-500 dark:text-white/60 mt-0.5">{sub}</p>}
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
  const api = useAPI()
  const { lang }  = useLang()
  // Web sessions resolve business_id via the authenticated Supabase JWT
  // (api.dashboard.fetch is wired in packages/data/web.js). When that path
  // exists we skip the legacy localStorage + ensureBusinessRegistered flow —
  // trying to INSERT a new businesses row with the anon key always fails RLS.
  const isWebSession = !!api?.dashboard?.fetch

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

  if (!isWebSession && !getBusinessId()) {
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

function Header({ onRefresh, refreshing, lastUpdated, goLiveDate, goLiveOnly, onToggleGoLive }) {
  return (
    <div className="bg-white dark:bg-white/5 border-b border-slate-100 dark:border-white/10 px-4 md:px-6 py-2.5 md:py-4 flex items-center gap-3 shrink-0">
      <Globe size={18} className="text-slate-500 dark:text-white/60 shrink-0" />
      <div className="flex-1 min-w-0">
        <h1 className="text-base md:text-lg font-semibold text-slate-800 dark:text-white leading-tight">Dashboard Remoto</h1>
        <p className="text-[11px] md:text-xs text-slate-400 dark:text-white/40 truncate">
          {lastUpdated ? <>Actualizado <span className="font-semibold text-slate-600 dark:text-white/70 tabular-nums">{fmtClock(lastUpdated)}</span></> : 'Solo lectura — datos en tiempo real'}
        </p>
      </div>
      {goLiveDate && onToggleGoLive && (
        <GoLivePill enabled={goLiveOnly} onToggle={onToggleGoLive} />
      )}
      {onRefresh && (
        <button onClick={onRefresh} disabled={refreshing} aria-label="Actualizar"
          className="flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 md:px-3 md:py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-xs text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40">
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden md:inline">Actualizar</span>
        </button>
      )}
    </div>
  )
}

// Brand-compliant segmented pill. Black/white/#b3001e only.
// ON  = "Solo go-live" (filters historical imports)
// OFF = "Todo el historial"
function GoLivePill({ enabled, onToggle }) {
  const seg = 'px-2.5 md:px-3 h-8 md:h-7 text-[11px] md:text-[10px] font-semibold rounded-full transition-colors whitespace-nowrap min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center'
  return (
    <div
      role="group"
      aria-label="Filtro go-live"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 shrink-0"
    >
      <button
        type="button"
        onClick={() => onToggle(true)}
        aria-pressed={enabled}
        className={`${seg} ${enabled
          ? 'bg-[#b3001e] text-white'
          : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}
      >
        <span className="hidden md:inline">Solo go-live</span>
        <span className="md:hidden">Go-live</span>
      </button>
      <button
        type="button"
        onClick={() => onToggle(false)}
        aria-pressed={!enabled}
        className={`${seg} ${!enabled
          ? 'bg-[#b3001e] text-white'
          : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}
      >
        <span className="hidden md:inline">Todo el historial</span>
        <span className="md:hidden">Todo</span>
      </button>
    </div>
  )
}

function Dashboard({ lang }) {
  const api = useAPI()
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [refreshing,  setRefreshing]  = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [activeTab,   setActiveTab]   = useState('summary')
  const [goLiveDate,  setGoLiveDate]  = useState(null) // 'YYYY-MM-DD' or null
  const [goLiveOnly,  setGoLiveOnly]  = useState(true) // default ON

  // Load go_live_date from settings once. Cheap; no dependency churn.
  useEffect(() => {
    let alive = true
    api?.settings?.get?.().then(s => {
      if (!alive) return
      const v = s?.go_live_date
      setGoLiveDate(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
    }).catch(() => {})
    return () => { alive = false }
  }, [api])

  // DR is UTC-4; local midnight = T04:00:00Z
  const sinceIso = goLiveDate && goLiveOnly
    ? new Date(goLiveDate + 'T04:00:00Z').toISOString()
    : null

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else           setLoading(true)
    setError(null)

    // Prefer the auth-bound api.dashboard.fetch (web — uses SupabaseAuthGate
    // session). Falls back to the legacy fetchDashboardData (desktop — reads
    // creds from localStorage configured in Settings → Respaldo).
    const opts = sinceIso ? { since: sinceIso } : {}
    const result = api?.dashboard?.fetch
      ? await api.dashboard.fetch(opts)
      : await fetchDashboardData(opts)

    if (result?.error) {
      setError(result.error)
    } else if (result) {
      setData(result)
      setLastUpdated(new Date().toISOString())
    }

    setLoading(false)
    setRefreshing(false)
  }, [api, sinceIso])

  useEffect(() => {
    load()
    const interval = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(interval)
  }, [load])

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
        <Header />
        <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0,1,2,3].map(i => (
              <div key={i} className="rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-white/5 p-3 md:p-4 animate-pulse">
                <div className="h-3 w-16 bg-slate-100 dark:bg-white/10 rounded mb-2" />
                <div className="h-6 w-24 bg-slate-200 dark:bg-white/10 rounded" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="h-40 rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-white/5 animate-pulse" />
            <div className="lg:col-span-2 h-56 rounded-xl border border-slate-100 dark:border-white/10 bg-white dark:bg-white/5 animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
        <Header
          onRefresh={() => load(true)}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
          goLiveDate={goLiveDate}
          goLiveOnly={goLiveOnly}
          onToggleGoLive={setGoLiveOnly}
        />
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
      <Header
        onRefresh={() => load(true)}
        refreshing={refreshing}
        lastUpdated={lastUpdated}
        goLiveDate={goLiveDate}
        goLiveOnly={goLiveOnly}
        onToggleGoLive={setGoLiveOnly}
      />

      <TabBar lang={lang} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'activity' && <ActivityFeed lang={lang} onRefreshDashboard={() => load(true)} sinceIso={sinceIso} />}
      {activeTab === 'summary' && (
      <SummaryPane onRefresh={() => load(true)} refreshing={refreshing}>

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
                    <div key={i} className="py-2.5 flex items-center gap-3">
                      <span className={`w-8 h-8 md:w-6 md:h-6 rounded-md flex items-center justify-center shrink-0 ${pm.color}`}>
                        <Icon size={13} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-800 dark:text-white truncate">
                          {t.doc_number || '—'}
                          {t.client_name ? <span className="text-slate-400 dark:text-white/40 font-normal"> · {t.client_name}</span> : null}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40 truncate">{t.services || '—'}</p>
                      </div>
                      {t.ncf && (
                        <span className="hidden md:inline text-[10px] text-slate-400 dark:text-white/40 font-mono shrink-0">{t.ncf}</span>
                      )}
                      <div className="text-right shrink-0">
                        <p className="text-sm md:text-xs font-bold md:font-semibold text-slate-800 dark:text-white tabular-nums">{fmtRD(t.total)}</p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40">{fmtTime(t.paid_at)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

      </SummaryPane>
      )}
    </div>
  )
}

// Scroll container wrapping the Summary tab. Hosts pull-to-refresh for iOS.
function SummaryPane({ onRefresh, refreshing, children }) {
  const [ref, pull] = usePullToRefresh(onRefresh, true)
  const ready = pull > 80
  return (
    <div ref={ref} className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-5 space-y-4 md:space-y-5 relative">
      <div
        className="absolute left-0 right-0 top-0 flex items-center justify-center pointer-events-none transition-opacity"
        style={{ height: pull, opacity: pull > 0 ? 1 : 0 }}>
        <RefreshCw size={18}
          className={`${refreshing || ready ? 'text-[#b3001e]' : 'text-slate-400 dark:text-white/40'} ${refreshing ? 'animate-spin' : ''}`}
          style={{ transform: `rotate(${pull * 3}deg)` }} />
      </div>
      {children}
    </div>
  )
}

// ── Tab bar ──────────────────────────────────────────────────────────────────
function TabBar({ lang, active, onChange }) {
  const tabs = [
    { id: 'summary',  es: 'Resumen',   en: 'Summary',   Icon: TrendingUp },
    { id: 'activity', es: 'Actividad', en: 'Activity',  Icon: Activity },
  ]
  return (
    <div className="sticky top-0 z-20 bg-white dark:bg-white/5 border-b border-slate-100 dark:border-white/10 px-4 md:px-6 flex items-center gap-1 shrink-0">
      {tabs.map(({ id, es, en, Icon }) => (
        <button key={id} onClick={() => onChange(id)}
          className={`flex items-center justify-center gap-1.5 flex-1 md:flex-none md:px-3 min-h-[44px] py-2.5 text-sm md:text-xs font-semibold border-b-2 -mb-px transition-colors ${
            active === id
              ? 'border-[#b3001e] text-[#b3001e] dark:text-red-400'
              : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
          }`}>
          <Icon size={15} /> {lang === 'es' ? es : en}
        </button>
      ))}
    </div>
  )
}

// ── Activity feed ────────────────────────────────────────────────────────────
const EVENT_META = {
  user_deleted:          { Icon: UserX,    color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',        es: 'Usuario eliminado',         en: 'User deleted' },
  user_deactivated:      { Icon: UserX,    color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300', es: 'Usuario desactivado',       en: 'User deactivated' },
  service_deleted:       { Icon: XCircle,  color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',        es: 'Servicio eliminado',        en: 'Service deleted' },
  service_price_changed: { Icon: Tag,      color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300', es: 'Precio cambiado',           en: 'Price changed' },
  ticket_voided:         { Icon: XCircle,  color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',        es: 'Ticket anulado',            en: 'Ticket voided' },
  nota_credito_created:  { Icon: ReceiptText, color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',     es: 'Nota de crédito',           en: 'Credit note' },
  invoice_issued:        { Icon: ReceiptText, color: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10 dark:text-sky-300',      es: 'Factura emitida',           en: 'Invoice issued' },
  payroll_paid:          { Icon: Wallet,   color: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10 dark:text-violet-300', es: 'Nómina pagada',         en: 'Payroll paid' },
  discount_applied:      { Icon: Percent,  color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300', es: 'Descuento aplicado',        en: 'Discount applied' },
  inventory_adjusted:    { Icon: Package,  color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300',    es: 'Ajuste de inventario',      en: 'Inventory adjusted' },
  inventory_count_completed: { Icon: ClipboardList, color: 'text-slate-700 bg-slate-100 dark:bg-white/10 dark:text-white/80', es: 'Conteo fisico',        en: 'Physical count' },
  caja_chica_withdrawal: { Icon: PiggyBank,color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300',    es: 'Retiro caja chica',         en: 'Petty cash withdrawal' },
  cuadre_discrepancy:    { Icon: Scale,    color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',        es: 'Descuadre en caja',         en: 'Cash reconciliation discrepancy' },
  shift_opened:          { Icon: Sunrise,  color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300', es: 'Apertura de turno',    en: 'Shift opened' },
  permission_denied:     { Icon: XCircle,  color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',        es: 'Permiso denegado',          en: 'Permission denied' },
  user_pin_changed:      { Icon: Lock,     color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300', es: 'PIN de usuario cambiado',   en: 'User PIN changed' },
  user_hard_deleted:     { Icon: UserX,    color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',        es: 'Usuario eliminado (definitivo)', en: 'User hard deleted' },
  adelanto_created:      { Icon: Wallet,   color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300',    es: 'Adelanto creado',           en: 'Advance created' },
  adelanto_cancelled:    { Icon: Wallet,   color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300', es: 'Adelanto cancelado',        en: 'Advance cancelled' },
  // v2.6 — Manager Authorization Card audit events
  manager_override:      { Icon: Lock,     color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',        es: 'Autorización de gerente',   en: 'Manager override' },
  manager_card_rotated:  { Icon: Lock,     color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300', es: 'Tarjeta de gerente emitida', en: 'Manager card issued' },
  manager_card_revoked:  { Icon: Lock,     color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300', es: 'Tarjeta de gerente revocada', en: 'Manager card revoked' },
}
function eventLabel(evt, lang) {
  const m = EVENT_META[evt]
  if (!m) return evt
  return lang === 'es' ? m.es : m.en
}

// Human-readable labels for activity_log metadata keys.
// Keys are spoken in Spanish; we skip internal-only IDs that mean nothing to the owner.
const META_KEY_LABELS = {
  es: {
    ticket_number: 'Factura', ticket_id: 'Factura', ticket_supabase_id: null,
    item_name: 'Producto', product_name: 'Producto', service_name: 'Servicio',
    sku: 'Código', barcode: 'Código de barras',
    client_name: 'Cliente', washer_name: 'Lavador', seller_name: 'Vendedor',
    amount: 'Monto', total: 'Total', subtotal: 'Subtotal',
    discount_amount: 'Descuento', discount_pct: 'Descuento %',
    itbis: 'ITBIS', ley: 'Ley',
    old_qty: 'Cantidad anterior', new_qty: 'Cantidad nueva',
    old_price: 'Precio anterior', new_price: 'Precio nuevo',
    old_value: 'Valor anterior', new_value: 'Valor nuevo',
    variance: 'Diferencia', total_variance_value: 'Diferencia total',
    count_id: 'Conteo', count_title: 'Conteo',
    top_losses: 'Productos con más diferencia',
    method: 'Método',
    approved_by_name: 'Autorizado por', approved_by_role: 'Rol',
    action: 'Acción', reason: 'Motivo', note: 'Nota', notes: 'Nota',
    payment_method: 'Forma de pago', payment_parts: 'Pagos',
    quantity: 'Cantidad', qty: 'Cantidad',
    currency: null, business_id: null,
    user_id: null, user_supabase_id: null,
    id: null, supabase_id: null,
  },
}
const METHOD_LABELS = {
  es: { card: 'Tarjeta de gerente', pin_fallback: 'PIN de emergencia', pin: 'PIN' },
}
const ACTION_LABELS = {
  es: {
    price_edit: 'Cambio de precio', void: 'Anulación', credit_note: 'Nota de crédito',
    discount_big: 'Descuento grande', inv_adjust: 'Ajuste de inventario',
    ticket_delete: 'Borrar factura', product_disable: 'Desactivar producto',
  },
}
function fmtMetaValue(key, v, lang) {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? (lang === 'es' ? 'Sí' : 'Yes') : (lang === 'es' ? 'No' : 'No')
  if (Array.isArray(v)) {
    if (!v.length) return '—'
    // top_losses: array of {name, variance_qty, variance_cost}
    if (v.every(x => x && typeof x === 'object' && ('name' in x))) {
      return v.slice(0, 5).map(x => {
        const qty = x.variance_qty ?? x.qty ?? ''
        const loss = x.variance_cost ?? x.loss ?? x.amount
        return `${x.name}${qty !== '' ? ` (${qty})` : ''}${loss != null ? ` — ${fmtRD(loss)}` : ''}`
      }).join('\n')
    }
    return v.join(', ')
  }
  if (typeof v === 'object') {
    // Skip nested objects (rare) — flatten to short JSON
    try { return JSON.stringify(v) } catch { return '—' }
  }
  const num = Number(v)
  const isNum = !Number.isNaN(num) && v !== '' && typeof v !== 'boolean'
  if (key === 'method') return (METHOD_LABELS.es[v] || v)
  if (key === 'action') return (ACTION_LABELS.es[v] || v)
  if (/_pct$|percent/i.test(key) && isNum) return `${num}%`
  if (/amount|total|price|cost|variance|subtotal|itbis|ley|loss|value|descuento|monto/i.test(key) && isNum) return fmtRD(num)
  return String(v)
}
function renderMetaPairs(obj, lang) {
  if (!obj || typeof obj !== 'object') return []
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    // Skip UUID-ish and internal IDs
    if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) && /_id$/.test(k)) continue
    const label = META_KEY_LABELS.es[k]
    if (label === null) continue   // explicitly suppressed
    if (label === undefined && /_id$|_uuid$/i.test(k)) continue
    const pretty = label || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    out.push({ key: k, label: pretty, value: fmtMetaValue(k, v, lang) })
  }
  return out
}

const FILTER_CHIPS = [
  { id: 'all',      es: 'Todo',         en: 'All',          types: null },
  { id: 'deletes',  es: 'Eliminaciones',en: 'Deletions',    types: ['user_deleted','user_deactivated','service_deleted'] },
  { id: 'prices',   es: 'Precios',      en: 'Prices',       types: ['service_price_changed'] },
  { id: 'voids',    es: 'Anulaciones',  en: 'Voids',        types: ['ticket_voided','nota_credito_created'] },
  { id: 'invoices', es: 'Facturas',     en: 'Invoices',     types: ['invoice_issued'] },
  { id: 'payouts',  es: 'Pagos',        en: 'Payouts',      types: ['payroll_paid'] },
  { id: 'discounts',es: 'Descuentos',   en: 'Discounts',    types: ['discount_applied'] },
  { id: 'stock',    es: 'Inventario',   en: 'Inventory',    types: ['inventory_adjusted'] },
  { id: 'counts',   es: 'Conteos',      en: 'Counts',       types: ['inventory_count_completed'] },
  { id: 'caja',     es: 'Caja Chica',   en: 'Petty Cash',   types: ['caja_chica_withdrawal'] },
  { id: 'cuadre',   es: 'Cuadre',       en: 'Reconciliation', types: ['cuadre_discrepancy'] },
  { id: 'turnos',   es: 'Turnos',       en: 'Shifts',       types: ['shift_opened'] },
  { id: 'mgr',      es: 'Gerente',      en: 'Manager',      types: ['manager_override','manager_card_rotated','manager_card_revoked'] },
]

function fmtRel(iso, lang) {
  if (!iso) return '—'
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const m = Math.floor(diff / 60000)
  if (m < 1)  return lang === 'es' ? 'ahora' : 'now'
  if (m < 60) return lang === 'es' ? `hace ${m} min` : `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return lang === 'es' ? `hace ${h}h` : `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)  return lang === 'es' ? `hace ${d}d` : `${d}d ago`
  return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })
}

function ActivityFeed({ lang, onRefreshDashboard, sinceIso }) {
  const sb = getSupabaseClient()
  const bid = getBusinessId()
  // Mark the feed as "seen" so the Sidebar unread-badge clears. Fired once
  // per tab-open; Sidebar stores the timestamp in localStorage per business.
  useEffect(() => {
    if (!bid) return
    try { window.dispatchEvent(new CustomEvent('tx:actividad-seen', { detail: { businessId: bid } })) } catch {}
  }, [bid])
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [chip, setChip]       = useState('all')
  const [openId, setOpenId]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    // Skip the query entirely if business_id isn't a valid UUID.
    const validBid = typeof bid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bid)
    if (!sb || !validBid) { setRows([]); setLoading(false); return }
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      // When go-live filter is ON and its cutoff is newer than 30d,
      // clamp UP so activity from pre-go-live imports stays hidden.
      const fromIso = sinceIso && sinceIso > thirtyDaysAgo ? sinceIso : thirtyDaysAgo
      let q = sb.from('activity_log').select('*').eq('business_id', bid)
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(300)
      const chipDef = FILTER_CHIPS.find(c => c.id === chip)
      if (chipDef?.types) q = q.in('event_type', chipDef.types)
      const { data: r, error: e } = await q
      if (e) throw e
      setRows(r || [])
    } catch (e) { setError(e?.message || String(e)) }
    finally { setLoading(false) }
  }, [sb, bid, chip, sinceIso])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 45000); return () => clearInterval(t) }, [load])

  const [ptrRef, pull] = usePullToRefresh(load, true)
  const ready = pull > 80

  return (
    <div ref={ptrRef} className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-5 space-y-4 relative">
      <div className="absolute left-0 right-0 top-0 flex items-center justify-center pointer-events-none transition-opacity"
        style={{ height: pull, opacity: pull > 0 ? 1 : 0 }}>
        <RefreshCw size={18}
          className={`${loading || ready ? 'text-[#b3001e]' : 'text-slate-400 dark:text-white/40'} ${loading ? 'animate-spin' : ''}`}
          style={{ transform: `rotate(${pull * 3}deg)` }} />
      </div>
      {/* Filter chips — scrollable row on mobile, wrap on desktop */}
      <div className="flex md:flex-wrap gap-1.5 overflow-x-auto md:overflow-x-visible -mx-4 md:mx-0 px-4 md:px-0 pb-1 md:pb-0">
        {FILTER_CHIPS.map(c => (
          <button key={c.id} onClick={() => setChip(c.id)}
            className={`shrink-0 text-xs md:text-[11px] font-semibold px-3 md:px-2.5 py-2 md:py-1 rounded-full border transition-colors ${
              chip === c.id
                ? 'bg-[#b3001e] text-white border-[#b3001e]'
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
            }`}>
            {lang === 'es' ? c.es : c.en}
          </button>
        ))}
        <button onClick={load} className="shrink-0 ml-auto text-xs md:text-[11px] flex items-center gap-1 px-3 md:px-2.5 py-2 md:py-1 rounded-full border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {lang === 'es' ? 'Actualizar' : 'Refresh'}
        </button>
      </div>

      {/* Feed */}
      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/10 overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="py-12 flex justify-center"><RefreshCw size={20} className="animate-spin text-slate-300 dark:text-white/30" /></div>
        ) : error ? (
          <div className="py-10 text-center text-xs text-red-500 dark:text-red-400">{error}</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <Activity size={28} className="text-slate-300 dark:text-white/30 mx-auto mb-2" />
            <p className="text-xs text-slate-400 dark:text-white/40">{lang === 'es' ? 'Sin actividad en los últimos 30 días' : 'No activity in the last 30 days'}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-white/5">
            {rows.map(r => {
              const meta  = EVENT_META[r.event_type] || { Icon: Activity, color: 'text-slate-500 bg-slate-50 dark:bg-white/5 dark:text-white/60', es: r.event_type, en: r.event_type }
              const Icon  = meta.Icon
              const label = lang === 'es' ? meta.es : meta.en
              const open  = openId === r.id
              const sev   = r.severity || 'info'
              const sevRail = sev === 'critical' ? 'bg-red-500' : sev === 'warn' ? 'bg-amber-500' : 'bg-slate-300 dark:bg-white/20'
              const metaObj = r.metadata && typeof r.metadata === 'object' ? r.metadata : null
              return (
                <div key={r.id} className="flex">
                  <div className={`w-0.5 shrink-0 ${sevRail}`} />
                  <div className="flex-1 min-w-0">
                    <button onClick={() => setOpenId(open ? null : r.id)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
                        <Icon size={13} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 dark:text-white truncate">
                          {label}
                          {r.target_name ? <span className="text-slate-400 dark:text-white/40 font-normal"> · {r.target_name}</span> : null}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40 truncate">
                          {r.actor_name || '—'}
                          {r.actor_role ? <span className="ml-1 text-slate-300 dark:text-white/30">({r.actor_role})</span> : null}
                          {r.reason ? <span> · {r.reason}</span> : null}
                        </p>
                      </div>
                      {r.amount != null && (
                        <span className={`text-xs font-semibold shrink-0 ${Number(r.amount) < 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-700 dark:text-white'}`}>
                          {fmtRD(r.amount)}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400 dark:text-white/40 shrink-0 w-16 text-right">{fmtRel(r.created_at, lang)}</span>
                      {open ? <ChevronUp size={13} className="text-slate-300 dark:text-white/30" /> : <ChevronDown size={13} className="text-slate-300 dark:text-white/30" />}
                    </button>
                    {open && (
                      <div className="px-4 pb-3 pt-1 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/10 grid grid-cols-2 gap-2 text-[11px]">
                        {r.old_value != null && r.new_value != null && (
                          <div className="col-span-2 flex items-center gap-2">
                            <span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Cambio:' : 'Change:'}</span>
                            <span className="text-slate-500 dark:text-white/60 line-through">{r.old_value}</span>
                            <span className="text-slate-400 dark:text-white/40">→</span>
                            <span className="text-slate-800 dark:text-white font-semibold">{r.new_value}</span>
                          </div>
                        )}
                        <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Tipo:' : 'Type:'}</span> <span className="text-slate-700 dark:text-white/80">{eventLabel(r.event_type, lang)}</span></div>
                        <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Fecha:' : 'Date:'}</span> <span className="text-slate-700 dark:text-white/80">{fmtTime(r.created_at)}</span></div>
                        {r.target_type && <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Destino:' : 'Target:'}</span> <span className="text-slate-700 dark:text-white/80">{r.target_type}{r.target_id ? ` #${r.target_id}` : ''}</span></div>}
                        {r.reason && <div className="col-span-2"><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Motivo:' : 'Reason:'}</span> <span className="text-slate-700 dark:text-white/80">{r.reason}</span></div>}
                        {(() => {
                          const pairs = renderMetaPairs(metaObj, lang)
                          if (!pairs.length) return null
                          return (
                            <div className="col-span-2 mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                              {pairs.map(({ key, label, value }) => (
                                <div key={key} className={value && value.includes('\n') ? 'col-span-2' : ''}>
                                  <span className="text-slate-400 dark:text-white/40">{label}:</span>{' '}
                                  <span className="text-slate-800 dark:text-white whitespace-pre-line">{value}</span>
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
