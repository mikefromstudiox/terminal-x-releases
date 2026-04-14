import { useState, useEffect, useCallback } from 'react'
import { Globe, Eye, WifiOff, RefreshCw, TrendingUp, ReceiptText, Banknote, CreditCard, ArrowRightLeft, Clock,
  Activity, UserX, Tag, XCircle, Wallet, Percent, Package, PiggyBank, Scale, ChevronDown, ChevronUp } from 'lucide-react'
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
  const [activeTab,   setActiveTab]   = useState('summary')

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

      <TabBar lang={lang} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'activity' && <ActivityFeed lang={lang} />}
      {activeTab === 'summary' && (
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
      )}
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
    <div className="bg-white dark:bg-white/5 border-b border-slate-100 dark:border-white/10 px-6 flex items-center gap-1 shrink-0">
      {tabs.map(({ id, es, en, Icon }) => (
        <button key={id} onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
            active === id
              ? 'border-[#b3001e] text-[#b3001e] dark:text-red-400'
              : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
          }`}>
          <Icon size={13} /> {lang === 'es' ? es : en}
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
  payroll_paid:          { Icon: Wallet,   color: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10 dark:text-violet-300', es: 'Nómina pagada',         en: 'Payroll paid' },
  discount_applied:      { Icon: Percent,  color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300', es: 'Descuento aplicado',        en: 'Discount applied' },
  inventory_adjusted:    { Icon: Package,  color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300',    es: 'Ajuste de inventario',      en: 'Inventory adjusted' },
  caja_chica_withdrawal: { Icon: PiggyBank,color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300',    es: 'Retiro caja chica',         en: 'Petty cash withdrawal' },
  cuadre_discrepancy:    { Icon: Scale,    color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300',        es: 'Descuadre en caja',         en: 'Cash reconciliation discrepancy' },
}

const FILTER_CHIPS = [
  { id: 'all',      es: 'Todo',         en: 'All',          types: null },
  { id: 'deletes',  es: 'Eliminaciones',en: 'Deletions',    types: ['user_deleted','user_deactivated','service_deleted'] },
  { id: 'prices',   es: 'Precios',      en: 'Prices',       types: ['service_price_changed'] },
  { id: 'voids',    es: 'Anulaciones',  en: 'Voids',        types: ['ticket_voided','nota_credito_created'] },
  { id: 'payouts',  es: 'Pagos',        en: 'Payouts',      types: ['payroll_paid'] },
  { id: 'discounts',es: 'Descuentos',   en: 'Discounts',    types: ['discount_applied'] },
  { id: 'stock',    es: 'Inventario',   en: 'Inventory',    types: ['inventory_adjusted'] },
  { id: 'caja',     es: 'Caja Chica',   en: 'Petty Cash',   types: ['caja_chica_withdrawal'] },
  { id: 'cuadre',   es: 'Cuadre',       en: 'Reconciliation', types: ['cuadre_discrepancy'] },
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

function ActivityFeed({ lang }) {
  const sb = getSupabaseClient()
  const bid = getBusinessId()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [chip, setChip]       = useState('all')
  const [openId, setOpenId]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      let q = sb.from('activity_log').select('*').eq('business_id', bid)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(300)
      const chipDef = FILTER_CHIPS.find(c => c.id === chip)
      if (chipDef?.types) q = q.in('event_type', chipDef.types)
      const { data: r, error: e } = await q
      if (e) throw e
      setRows(r || [])
    } catch (e) { setError(e?.message || String(e)) }
    finally { setLoading(false) }
  }, [sb, bid, chip])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 45000); return () => clearInterval(t) }, [load])

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_CHIPS.map(c => (
          <button key={c.id} onClick={() => setChip(c.id)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              chip === c.id
                ? 'bg-[#b3001e] text-white border-[#b3001e]'
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
            }`}>
            {lang === 'es' ? c.es : c.en}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-[11px] flex items-center gap-1 px-2.5 py-1 rounded-full border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
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
                        <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Tipo:' : 'Type:'}</span> <span className="text-slate-700 dark:text-white/80 font-mono">{r.event_type}</span></div>
                        <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Fecha:' : 'Date:'}</span> <span className="text-slate-700 dark:text-white/80">{fmtTime(r.created_at)}</span></div>
                        {r.target_type && <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Destino:' : 'Target:'}</span> <span className="text-slate-700 dark:text-white/80">{r.target_type}{r.target_id ? ` #${r.target_id}` : ''}</span></div>}
                        {r.reason && <div className="col-span-2"><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Motivo:' : 'Reason:'}</span> <span className="text-slate-700 dark:text-white/80">{r.reason}</span></div>}
                        {metaObj && Object.keys(metaObj).length > 0 && (
                          <div className="col-span-2">
                            <span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Detalles:' : 'Details:'}</span>
                            <pre className="mt-1 p-2 bg-white dark:bg-black/40 rounded text-[10px] text-slate-600 dark:text-white/70 overflow-x-auto">{JSON.stringify(metaObj, null, 2)}</pre>
                          </div>
                        )}
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
