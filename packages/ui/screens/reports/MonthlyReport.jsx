import { useState, useMemo, useEffect, useCallback } from 'react'
import { TrendingUp, TrendingDown, Download, Printer, Car, CircleDollarSign, Clock, ReceiptText } from 'lucide-react'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'
import { exportMonthlyReport } from '@terminal-x/services/csv'
import { printMonthlyReport } from '@terminal-x/services/report-html'

// ── Constants ─────────────────────────────────────────────────────────────────
const MES_ES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MES_EN   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MES_FULL_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MES_FULL_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']

const PAY_METHODS = [
  { es: 'Transferencia', en: 'Transfer', key: 'transfer',     color: 'bg-sky-500',     dot: 'bg-sky-500'    },
  { es: 'Tarjeta',       en: 'Card',     key: 'card',         color: 'bg-violet-400',  dot: 'bg-violet-400' },
  { es: 'Efectivo',      en: 'Cash',     key: 'cash',         color: 'bg-emerald-400', dot: 'bg-emerald-400'},
  { es: 'Crédito',       en: 'Credit',   key: 'credit',       color: 'bg-amber-400',   dot: 'bg-amber-400'  },
  { es: 'Cheque',        en: 'Check',    key: 'check',        color: 'bg-rose-400',    dot: 'bg-rose-400'   },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${Math.round(n).toLocaleString('en-US')}`
}
function fmtPct(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}
function pctChange(cur, prev) {
  if (!prev) return 0
  return ((cur - prev) / prev) * 100
}

function padDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ── Date range builders ───────────────────────────────────────────────────────
function periodToRange(period) {
  if (period.type === 'month') {
    const { year, month } = period
    const last = new Date(year, month + 1, 0).getDate()
    return {
      from: padDate(year, month, 1),
      to:   `${padDate(year, month, last)}T23:59:59`,
    }
  }
  // range
  const lastDay = new Date(period.toYear, period.toMonth + 1, 0).getDate()
  return {
    from: padDate(period.fromYear, period.fromMonth, 1),
    to:   `${padDate(period.toYear, period.toMonth, lastDay)}T23:59:59`,
  }
}

function prevPeriodOf(period) {
  if (period.type === 'month') {
    const pm = period.month === 0 ? 11 : period.month - 1
    const py = period.month === 0 ? period.year - 1 : period.year
    return { type: 'month', year: py, month: pm }
  }
  const months = getMonthsInRange(period.fromYear, period.fromMonth, period.toYear, period.toMonth)
  const n = months.length
  let fy = period.fromYear, fm = period.fromMonth - n
  while (fm < 0) { fm += 12; fy-- }
  let ty = period.fromYear, tm = period.fromMonth - 1
  if (tm < 0) { tm = 11; ty-- }
  return { type: 'range', fromYear: fy, fromMonth: fm, toYear: ty, toMonth: tm }
}

// ── Ticket aggregation ────────────────────────────────────────────────────────
function aggregateTickets(tickets, period) {
  if (!tickets || !tickets.length) {
    return {
      metrics:     { facturado: 0, cobrado: 0, pendiente: 0, carros: tickets?.length ?? 0 },
      weeks:       [{ label: 'S1', facturado: 0, cobrado: 0 }, { label: 'S2', facturado: 0, cobrado: 0 }, { label: 'S3', facturado: 0, cobrado: 0 }, { label: 'S4', facturado: 0, cobrado: 0 }],
      bars:        [],
      payMethods:  PAY_METHODS.map(m => ({ ...m, pct: 0, amount: 0 })),
      topClients:  [],
      topServices: [],
      cxc:         [],
      washers:     [],
      isMulti:     period.type !== 'month',
    }
  }

  const facturado = tickets.reduce((s, t) => s + (t.total || 0), 0)
  const cobrado   = tickets.filter(t => t.status === 'cobrado').reduce((s, t) => s + (t.total || 0), 0)
  const pendiente = facturado - cobrado
  const carros    = tickets.length

  // ── Weekly breakdown (for single-month view) ────────────────────────────
  const weeks = [
    { label: 'S1', facturado: 0, cobrado: 0 },
    { label: 'S2', facturado: 0, cobrado: 0 },
    { label: 'S3', facturado: 0, cobrado: 0 },
    { label: 'S4', facturado: 0, cobrado: 0 },
  ]
  tickets.forEach(t => {
    const d = new Date(t.created_at)
    const day = d.getDate()
    const wi = day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3
    weeks[wi].facturado += t.total || 0
    if (t.status === 'cobrado') weeks[wi].cobrado += t.total || 0
  })

  // ── Multi-month bars ─────────────────────────────────────────────────────
  let bars = []
  if (period.type !== 'month') {
    const months = getMonthsInRange(period.fromYear, period.fromMonth, period.toYear, period.toMonth)
    const monthBuckets = {}
    months.forEach(m => { monthBuckets[`${m.year}-${m.month}`] = { facturado: 0, cobrado: 0 } })
    tickets.forEach(t => {
      const d = new Date(t.created_at)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (monthBuckets[key]) {
        monthBuckets[key].facturado += t.total || 0
        if (t.status === 'cobrado') monthBuckets[key].cobrado += t.total || 0
      }
    })
    bars = months.map(m => ({
      label:     MES_ES[m.month],
      facturado: monthBuckets[`${m.year}-${m.month}`]?.facturado ?? 0,
      cobrado:   monthBuckets[`${m.year}-${m.month}`]?.cobrado   ?? 0,
    }))
  }

  // ── Payment methods ──────────────────────────────────────────────────────
  const payBuckets = {}
  PAY_METHODS.forEach(m => { payBuckets[m.key] = 0 })
  tickets.filter(t => t.status === 'cobrado').forEach(t => {
    const pm = (t.payment_method || 'cash').toLowerCase()
    const matched = PAY_METHODS.find(m => pm.includes(m.key) || pm === m.key)
    const key = matched ? matched.key : 'cash'
    payBuckets[key] = (payBuckets[key] || 0) + (t.total || 0)
  })
  const cobradoNonZero = cobrado || 1
  const payMethods = PAY_METHODS.map(m => ({
    ...m,
    amount: payBuckets[m.key] || 0,
    pct:    Math.round((payBuckets[m.key] || 0) / cobradoNonZero * 100),
  })).filter(m => m.amount > 0)

  // ── Top clients ──────────────────────────────────────────────────────────
  const clientMap = {}
  tickets.forEach(t => {
    const name = t.client_name || 'Consumidor Final'
    clientMap[name] = clientMap[name] ?? { name, tickets: 0, total: 0 }
    clientMap[name].tickets++
    clientMap[name].total += t.total || 0
  })
  const topClients = Object.values(clientMap).sort((a, b) => b.total - a.total).slice(0, 5)

  // ── Top services (from ticket items — best effort from ticket names) ──────
  // Since byDateRange doesn't join items, we derive from tickets themselves
  // using available fields. We group by comprobante_type as a proxy for service
  // type, or show top clients as top "service buckets" if items not available.
  // Real items require a separate query; approximate here from ticket data.
  const serviceMap = {}
  tickets.forEach(t => {
    // Use comprobante type as a service category
    const svc = t.comprobante_type === 'B01' ? 'Crédito Fiscal' : 'Consumidor Final'
    serviceMap[svc] = serviceMap[svc] ?? { name: svc, count: 0, total: 0 }
    serviceMap[svc].count++
    serviceMap[svc].total += t.total || 0
  })
  const topServices = Object.values(serviceMap).sort((a, b) => b.total - a.total).slice(0, 5)

  // ── CxC — credit tickets ─────────────────────────────────────────────────
  const cxcMap = {}
  tickets.filter(t => t.tipo_venta === 'credito' || t.status === 'pendiente').forEach(t => {
    const name = t.client_name || 'Cliente'
    cxcMap[name] = cxcMap[name] ?? { client: name, facturado: 0, cobrado: 0 }
    cxcMap[name].facturado += t.total || 0
    if (t.status === 'cobrado') cxcMap[name].cobrado += t.total || 0
  })
  const cxc = Object.values(cxcMap).map(c => ({ ...c, pendiente: c.facturado - c.cobrado })).sort((a, b) => b.pendiente - a.pendiente)

  return {
    metrics: { facturado, cobrado, pendiente, carros },
    weeks,
    bars,
    payMethods,
    topClients,
    topServices,
    cxc,
    washers: [],  // commission data requires separate washer_commissions query
    isMulti: period.type !== 'month',
  }
}

function getMonthsInRange(fy, fm, ty, tm) {
  const out = []
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ year: y, month: m })
    if (++m > 11) { m = 0; y++ }
  }
  return out
}

function periodLabel(period, lang) {
  if (period.type === 'month') {
    const name = lang === 'es' ? MES_FULL_ES[period.month] : MES_FULL_EN[period.month]
    return `${name} ${period.year}`
  }
  const from = lang === 'es' ? MES_ES[period.fromMonth] : MES_EN[period.fromMonth]
  const to   = lang === 'es' ? MES_ES[period.toMonth]   : MES_EN[period.toMonth]
  return `${from} – ${to} ${period.toYear}`
}

// ── Export CSV (removed — now uses services/csv.js) ──────────────────────────

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, change, accent }) {
  const isUp = change >= 0
  const accents = {
    sky:    'bg-sky-50 text-sky-600 border-sky-100',
    green:  'bg-green-50 text-green-600 border-green-100',
    amber:  'bg-amber-50 text-amber-600 border-amber-100',
    slate:  'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <div className="flex-1 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${accents[accent]}`}>
          <Icon size={16} />
        </div>
        <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${
          isUp ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
        }`}>
          {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {fmtPct(change)}
        </div>
      </div>
      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{label}</p>
      <p className="text-[22px] font-bold text-slate-800 dark:text-white leading-tight mt-0.5">{value}</p>
    </div>
  )
}

function BarChart({ bars, lang }) {
  const maxVal = Math.max(...bars.map(b => b.facturado), 1)
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-3 text-[11px] text-slate-500 dark:text-white/60">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-sky-500 rounded-sm inline-block" />{lang === 'es' ? 'Facturado' : 'Billed'}</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-sky-200 rounded-sm inline-block" />{lang === 'es' ? 'Cobrado' : 'Collected'}</div>
      </div>
      <div className="flex-1 flex items-end gap-2" style={{ minHeight: 140 }}>
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end gap-0.5" style={{ height: 128 }}>
              <div
                className="flex-1 bg-sky-500 rounded-t min-h-[3px] transition-all duration-500"
                style={{ height: `${(b.facturado / maxVal) * 100}%` }}
                title={fmtRD(b.facturado)}
              />
              <div
                className="flex-1 bg-sky-200 rounded-t min-h-[3px] transition-all duration-500"
                style={{ height: `${(b.cobrado / maxVal) * 100}%` }}
                title={fmtRD(b.cobrado)}
              />
            </div>
            <span className="text-[10px] text-slate-400 dark:text-white/40 font-medium">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PayChart({ methods, lang }) {
  const maxPct = Math.max(...methods.map(m => m.pct), 1)
  return (
    <div className="flex flex-col gap-3.5 justify-center h-full">
      {methods.length === 0 && (
        <p className="text-sm text-slate-400 text-center">{lang === 'es' ? 'Sin datos de cobro' : 'No collection data'}</p>
      )}
      {methods.map(m => (
        <div key={m.key} className="flex items-center gap-3">
          <div className="flex items-center gap-2 w-28 shrink-0 justify-end">
            <span className={`w-2 h-2 rounded-full ${m.dot}`} />
            <span className="text-[12px] text-slate-600 dark:text-white/60">{lang === 'es' ? m.es : m.en}</span>
          </div>
          <div className="flex-1 h-4 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full ${m.color} rounded-full transition-all duration-500`} style={{ width: `${Math.round(m.pct / maxPct * 100)}%` }} />
          </div>
          <span className="text-[11px] font-bold text-slate-500 dark:text-white/60 w-8 text-right">{m.pct}%</span>
          <span className="text-[12px] font-bold text-slate-700 dark:text-white w-24 text-right">{fmtRD(m.amount)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const TODAY   = new Date()
const CUR_Y   = TODAY.getFullYear()
const CUR_M   = TODAY.getMonth()

const PILLS = [
  { id: 'mes',    es: 'Este mes',         en: 'This month',     period: () => ({ type: 'month', year: CUR_Y,     month: CUR_M     }) },
  {
    id: 'mesP',   es: 'Mes pasado',       en: 'Last month',
    period: () => {
      const pm = CUR_M === 0 ? 11 : CUR_M - 1
      const py = CUR_M === 0 ? CUR_Y - 1 : CUR_Y
      return { type: 'month', year: py, month: pm }
    }
  },
  {
    id: 'tres',   es: 'Últimos 3 meses',  en: 'Last 3 months',
    period: () => {
      let fm = CUR_M - 2, fy = CUR_Y
      if (fm < 0) { fm += 12; fy-- }
      return { type: 'range', fromYear: fy, fromMonth: fm, toYear: CUR_Y, toMonth: CUR_M }
    }
  },
  {
    id: 'anio',   es: 'Este año',         en: 'This year',
    period: () => ({ type: 'range', fromYear: CUR_Y, fromMonth: 0, toYear: CUR_Y, toMonth: CUR_M })
  },
]

export default function MonthlyReport() {
  const api = useAPI()
  const { lang } = useLang()

  const [mode,       setMode]      = useState('mes')
  const [activePill, setPill]      = useState('mes')
  const [period,     setPeriod]    = useState({ type: 'month', year: CUR_Y, month: CUR_M })

  // Range mode local state
  const [rangeFrom, setRangeFrom] = useState({ year: CUR_Y, month: CUR_M === 0 ? 11 : CUR_M - 1 })
  const [rangeTo,   setRangeTo]   = useState({ year: CUR_Y, month: CUR_M })

  // DB ticket data
  const [tickets,     setTickets]     = useState(null)   // null = not yet loaded
  const [prevTickets, setPrevTickets] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [biz,         setBiz]         = useState({})

  useEffect(() => { api.admin?.getEmpresa?.().then(e => e && setBiz({ name: e.name || e.nombre, rnc: e.rnc, address: e.address || e.direccion, phone: e.phone || e.telefono, email: e.email, logo: e.logo })).catch(() => {}) }, [])

  // ── Fetch tickets for current period and previous period ──────────────────
  const loadTickets = useCallback(async () => {
    setLoading(true)
    try {
      const range     = periodToRange(period)
      const prevRange = periodToRange(prevPeriodOf(period))

      const [cur, prev] = await Promise.all([
        api.tickets.byDateRange({ from: range.from,     to: range.to     }),
        api.tickets.byDateRange({ from: prevRange.from, to: prevRange.to }),
      ])
      setTickets(cur     ?? [])
      setPrevTickets(prev ?? [])
    } catch (e) {
      console.error('MonthlyReport load error:', e)
      setTickets([])
      setPrevTickets([])
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { loadTickets() }, [loadTickets])

  // ── Aggregate data ─────────────────────────────────────────────────────────
  const data     = useMemo(() => tickets     !== null ? aggregateTickets(tickets,     period)              : null, [tickets,     period])
  const prevData = useMemo(() => prevTickets !== null ? aggregateTickets(prevTickets, prevPeriodOf(period)) : null, [prevTickets, period])

  function selectPill(pill) {
    setPill(pill.id)
    setMode('mes')
    setPeriod(pill.period())
  }

  function selectMonth(year, month) {
    if (year > CUR_Y || (year === CUR_Y && month > CUR_M)) return
    setPill(null)
    setPeriod({ type: 'month', year, month })
  }

  function applyRange() {
    setPill(null)
    setPeriod({ type: 'range', fromYear: rangeFrom.year, fromMonth: rangeFrom.month, toYear: rangeTo.year, toMonth: rangeTo.month })
  }

  const bars = data ? (data.isMulti ? data.bars : data.weeks) : []

  // Years to show in grid
  const gridYears = [CUR_Y - 1, CUR_Y]

  function monthState(year, month) {
    if (year > CUR_Y || (year === CUR_Y && month > CUR_M)) return 'future'
    if (period.type === 'month') {
      return (period.year === year && period.month === month) ? 'selected' : 'past'
    }
    const months = getMonthsInRange(period.fromYear, period.fromMonth, period.toYear, period.toMonth)
    return months.some(m => m.year === year && m.month === month) ? 'selected' : 'past'
  }

  const label = periodLabel(period, lang)

  function chg(key) {
    if (!data || !prevData) return 0
    return pctChange(data.metrics[key], prevData.metrics[key])
  }

  const MONTH_LABELS = lang === 'es' ? MES_ES : MES_EN

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-3 md:py-4 space-y-3 md:space-y-4 min-h-full">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{lang === 'es' ? 'Reporte Mensual' : 'Monthly Report'}</h2>
            <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5 font-medium">{label}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => data && exportMonthlyReport(biz, data, label)}
              disabled={!data || loading}
              className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] md:min-h-0 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              <Download size={13} />
              {lang === 'es' ? 'Exportar CSV' : 'Export CSV'}
            </button>
            <button
              onClick={() => data && printMonthlyReport(biz, data, label)}
              disabled={!data || loading}
              className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] md:min-h-0 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              <Printer size={13} />
              {lang === 'es' ? 'Imprimir' : 'Print'}
            </button>
          </div>
        </div>

        {/* ── Date selector card ───────────────────────────────────────── */}
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">

          {/* Mode tabs */}
          <div className="flex gap-1 mb-4">
            {[
              { id: 'mes',   es: 'Mes',   en: 'Month' },
              { id: 'rango', es: 'Rango', en: 'Range' },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                  mode === m.id ? 'bg-slate-800 text-white' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/20'
                }`}
              >
                {lang === 'es' ? m.es : m.en}
              </button>
            ))}
          </div>

          {/* Quick pills */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {PILLS.map(p => (
              <button
                key={p.id}
                onClick={() => selectPill(p)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
                  activePill === p.id
                    ? 'bg-slate-800 border-slate-800 text-white'
                    : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:border-slate-400'
                }`}
              >
                {lang === 'es' ? p.es : p.en}
              </button>
            ))}
          </div>

          {/* Mes mode: month grid */}
          {mode !== 'rango' && (
            <div className="space-y-2">
              {gridYears.map(year => (
                <div key={year} className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 w-10 text-right shrink-0">{year}</span>
                  <div className="flex-1 grid grid-cols-6 md:grid-cols-12 gap-1">
                    {Array.from({ length: 12 }, (_, m) => {
                      const state = monthState(year, m)
                      return (
                        <button
                          key={m}
                          onClick={() => selectMonth(year, m)}
                          disabled={state === 'future'}
                          className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                            state === 'selected' ? 'bg-slate-800 text-white'
                            : state === 'past'   ? 'bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10'
                            :                      'bg-slate-50 dark:bg-white/5 text-slate-300 dark:text-white/20 cursor-not-allowed'
                          }`}
                        >
                          {MONTH_LABELS[m]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Rango mode */}
          {mode === 'rango' && (
            <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-4">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-slate-400 dark:text-white/40 mb-1.5">{lang === 'es' ? 'Desde' : 'From'}</label>
                <div className="flex gap-2">
                  <select value={rangeFrom.month} onChange={e => setRangeFrom(f => ({ ...f, month: +e.target.value }))}
                    className="flex-1 px-2 py-2 min-h-[44px] md:min-h-0 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white focus:outline-none focus:border-sky-400">
                    {MONTH_LABELS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select value={rangeFrom.year} onChange={e => setRangeFrom(f => ({ ...f, year: +e.target.value }))}
                    className="px-2 py-2 min-h-[44px] md:min-h-0 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white focus:outline-none focus:border-sky-400">
                    {[CUR_Y - 1, CUR_Y].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-slate-400 dark:text-white/40 mb-1.5">{lang === 'es' ? 'Hasta' : 'To'}</label>
                <div className="flex gap-2">
                  <select value={rangeTo.month} onChange={e => setRangeTo(f => ({ ...f, month: +e.target.value }))}
                    className="flex-1 px-2 py-2 min-h-[44px] md:min-h-0 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white focus:outline-none focus:border-sky-400">
                    {MONTH_LABELS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select value={rangeTo.year} onChange={e => setRangeTo(f => ({ ...f, year: +e.target.value }))}
                    className="px-2 py-2 min-h-[44px] md:min-h-0 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white focus:outline-none focus:border-sky-400">
                    {[CUR_Y - 1, CUR_Y].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={applyRange} className="w-full md:w-auto px-4 py-2 min-h-[44px] md:min-h-0 bg-slate-800 hover:bg-slate-700 text-white text-[12px] font-bold rounded-xl transition-colors">
                {lang === 'es' ? 'Aplicar' : 'Apply'}
              </button>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center h-40 text-slate-400 dark:text-white/40 text-sm">
            {lang === 'es' ? 'Cargando datos…' : 'Loading data…'}
          </div>
        )}

        {!loading && !data && (
          <div className="flex items-center justify-center h-40 text-slate-400 dark:text-white/40">
            {lang === 'es' ? 'Sin datos para el período seleccionado' : 'No data for selected period'}
          </div>
        )}

        {!loading && data && (
          <>

            {/* ── Metric cards ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              <MetricCard icon={ReceiptText}      label={lang === 'es' ? 'Total Facturado' : 'Total Billed'}       value={fmtRD(data.metrics.facturado)} change={chg('facturado')} accent="sky"   />
              <MetricCard icon={CircleDollarSign} label={lang === 'es' ? 'Total Cobrado'   : 'Total Collected'}    value={fmtRD(data.metrics.cobrado)}   change={chg('cobrado')}   accent="green" />
              <MetricCard icon={Clock}            label={lang === 'es' ? 'Pendiente Cobrar': 'Pending Collection'} value={fmtRD(data.metrics.pendiente)} change={chg('pendiente')} accent="amber" />
              <MetricCard icon={Car}              label={lang === 'es' ? 'Tickets / Carros'  : 'Tickets / Cars'}    value={data.metrics.carros}           change={chg('carros')}    accent="slate" />
            </div>

            {/* ── Charts row ───────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Weekly / monthly bar chart */}
              <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5">
                <p className="text-[12px] font-bold text-slate-600 dark:text-white/60 mb-4">
                  {data.isMulti
                    ? (lang === 'es' ? 'Desglose Mensual' : 'Monthly Breakdown')
                    : (lang === 'es' ? 'Desglose Semanal'  : 'Weekly Breakdown')}
                </p>
                <BarChart bars={bars} lang={lang} />
              </div>

              {/* Payment method breakdown */}
              <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5">
                <p className="text-[12px] font-bold text-slate-600 dark:text-white/60 mb-4">
                  {lang === 'es' ? 'Métodos de Pago (Cobrado)' : 'Payment Methods (Collected)'}
                </p>
                <PayChart methods={data.payMethods} lang={lang} />
              </div>
            </div>

            {/* ── Top clients + top services ───────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Top 5 clients */}
              <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10">
                  <p className="text-[12px] font-bold text-slate-700 dark:text-white">{lang === 'es' ? 'Top 5 Clientes' : 'Top 5 Clients'}</p>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-white/5">
                      <th className="text-left px-5 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider w-8">#</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                        {lang === 'es' ? 'Cliente' : 'Client'}
                      </th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">Tickets</th>
                      <th className="text-right px-5 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topClients.length === 0 && (
                      <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-slate-400">{lang === 'es' ? 'Sin datos' : 'No data'}</td></tr>
                    )}
                    {data.topClients.map((c, i) => (
                      <tr key={i} className="border-t border-slate-50 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/5">
                        <td className="px-5 py-3 text-[12px] font-bold text-slate-400 dark:text-white/40">{i + 1}</td>
                        <td className="px-4 py-3 text-[12px] font-medium text-slate-700 dark:text-white truncate max-w-[180px]">{c.name}</td>
                        <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-white/60 text-right">{c.tickets}</td>
                        <td className="px-5 py-3 text-[12px] font-bold text-slate-800 dark:text-white text-right">{fmtRD(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Top services */}
              <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10">
                  <p className="text-[12px] font-bold text-slate-700 dark:text-white">{lang === 'es' ? 'Comprobantes por Tipo' : 'Receipts by Type'}</p>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-white/5">
                      <th className="text-left px-5 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                        {lang === 'es' ? 'Tipo' : 'Type'}
                      </th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                        {lang === 'es' ? 'Cantidad' : 'Count'}
                      </th>
                      <th className="text-right px-5 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                        {lang === 'es' ? 'Ingresos' : 'Revenue'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topServices.length === 0 && (
                      <tr><td colSpan={3} className="px-5 py-6 text-center text-sm text-slate-400">{lang === 'es' ? 'Sin datos' : 'No data'}</td></tr>
                    )}
                    {data.topServices.map((s, i) => (
                      <tr key={i} className="border-t border-slate-50 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/5">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${['bg-sky-500','bg-violet-400','bg-emerald-400','bg-amber-400','bg-rose-400'][i]}`} />
                            <span className="text-[12px] font-medium text-slate-700 dark:text-white">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-slate-500 dark:text-white/60 text-right">{s.count}×</td>
                        <td className="px-5 py-3 text-[12px] font-bold text-slate-800 text-right">{fmtRD(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── CxC summary (full width) ─────────────────────────────── */}
            <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden overflow-x-auto">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
                <p className="text-[12px] font-bold text-slate-700 dark:text-white">
                  {lang === 'es' ? 'Resumen CxC — Cuentas por Cobrar' : 'A/R Summary — Accounts Receivable'}
                </p>
                <span className="text-[11px] text-slate-400 dark:text-white/40">{label}</span>
              </div>
              {data.cxc.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-slate-400">
                  {lang === 'es' ? 'Sin cuentas por cobrar en este período' : 'No accounts receivable in this period'}
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-white/5">
                      {[
                        { es: 'Cliente',    en: 'Client',    cls: 'text-left  px-5 py-2.5 flex-1' },
                        { es: 'Facturado',  en: 'Billed',    cls: 'text-right px-5 py-2.5 w-[160px]' },
                        { es: 'Cobrado',    en: 'Collected', cls: 'text-right px-5 py-2.5 w-[160px]' },
                        { es: 'Pendiente',  en: 'Pending',   cls: 'text-right px-5 py-2.5 w-[160px]' },
                      ].map(col => (
                        <th key={col.es} className={`${col.cls} text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider`}>
                          {lang === 'es' ? col.es : col.en}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.cxc.map((c, i) => (
                      <tr key={i} className={`border-t border-slate-100 ${c.pendiente > 0 ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50/50'}`}>
                        <td className="px-5 py-3 text-[12px] font-medium text-slate-700 dark:text-white">{c.client}</td>
                        <td className="px-5 py-3 text-[12px] text-slate-600 dark:text-white/60 text-right">{fmtRD(c.facturado)}</td>
                        <td className="px-5 py-3 text-[12px] text-slate-600 dark:text-white/60 text-right">{fmtRD(c.cobrado)}</td>
                        <td className="px-5 py-3 text-right">
                          {c.pendiente > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[12px] font-bold text-red-600">{fmtRD(c.pendiente)}</span>
                          ) : (
                            <span className="text-[12px] font-bold text-green-600">{lang === 'es' ? 'Pagado' : 'Paid'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="border-t-2 border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                      <td className="px-5 py-3 text-[12px] font-bold text-slate-700 dark:text-white">TOTAL</td>
                      <td className="px-5 py-3 text-[12px] font-bold text-slate-800 dark:text-white text-right">{fmtRD(data.cxc.reduce((s, c) => s + c.facturado, 0))}</td>
                      <td className="px-5 py-3 text-[12px] font-bold text-slate-800 dark:text-white text-right">{fmtRD(data.cxc.reduce((s, c) => s + c.cobrado, 0))}</td>
                      <td className="px-5 py-3 text-[12px] font-bold text-red-600 text-right">{fmtRD(data.cxc.reduce((s, c) => s + c.pendiente, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Payment summary (full width) — replaces washer commissions when no washer data ── */}
            <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
                <p className="text-[12px] font-bold text-slate-700 dark:text-white">
                  {lang === 'es' ? 'Resumen de Cobros por Método' : 'Collections by Payment Method'}
                </p>
                <span className="text-[11px] text-slate-400 dark:text-white/40">{label}</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    {[
                      { es: 'Método',     en: 'Method',     cls: 'text-left  px-5 py-2.5' },
                      { es: 'Tickets',    en: 'Tickets',    cls: 'text-right px-5 py-2.5 w-[120px]' },
                      { es: 'Monto',      en: 'Amount',     cls: 'text-right px-5 py-2.5 w-[160px]' },
                      { es: 'Proporción', en: 'Share',      cls: 'px-5 py-2.5 w-[200px]' },
                    ].map(col => (
                      <th key={col.es} className={`${col.cls} text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider`}>
                        {col.es === 'Proporción' ? '' : (lang === 'es' ? col.es : col.en)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.payMethods.length === 0 && (
                    <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">{lang === 'es' ? 'Sin cobros en este período' : 'No collections in this period'}</td></tr>
                  )}
                  {(() => {
                    const maxAmt = Math.max(...data.payMethods.map(m => m.amount), 1)
                    // Count tickets per method from raw tickets
                    const methodCounts = {}
                    ;(tickets || []).filter(t => t.status === 'cobrado').forEach(t => {
                      const pm = (t.payment_method || 'cash').toLowerCase()
                      methodCounts[pm] = (methodCounts[pm] || 0) + 1
                    })
                    return data.payMethods.map((m, i) => {
                      const cnt = methodCounts[m.key] || 0
                      return (
                        <tr key={i} className="border-t border-slate-100 dark:border-white/10 hover:bg-slate-50/50 dark:hover:bg-white/5">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-3 h-3 rounded-full ${m.dot}`} />
                              <span className="text-[13px] font-semibold text-slate-800 dark:text-white">{lang === 'es' ? m.es : m.en}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-[12px] text-slate-600 dark:text-white/60 text-right">{cnt}</td>
                          <td className="px-5 py-3 text-[13px] font-bold text-slate-800 dark:text-white text-right">{fmtRD(m.amount)}</td>
                          <td className="px-5 py-3">
                            <div className="h-2 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${m.color} rounded-full transition-all duration-500`}
                                style={{ width: `${(m.amount / maxAmt) * 100}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  })()}
                  <tr className="border-t-2 border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                    <td className="px-5 py-3 text-[12px] font-bold text-slate-700" colSpan={2}>TOTAL</td>
                    <td className="px-5 py-3 text-[13px] font-bold text-slate-800 dark:text-white text-right">{fmtRD(data.metrics.cobrado)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

          </>
        )}
      </div>
    </div>
  )
}
