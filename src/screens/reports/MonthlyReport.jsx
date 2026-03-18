import { useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, Download, Printer, Car, CircleDollarSign, Clock, ReceiptText } from 'lucide-react'
import { useLang } from '../../i18n'

// ── Constants ─────────────────────────────────────────────────────────────────
const MES_ES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MES_EN   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MES_FULL_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MES_FULL_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Seasonal multipliers (0-indexed). March = 1.0 baseline.
const SEASON = [0.87, 0.81, 1.00, 0.93, 0.96, 1.05, 1.09, 1.11, 0.98, 1.04, 0.91, 1.19]

const PAY_METHODS = [
  { es: 'Transferencia', en: 'Transfer', pct: 35, color: 'bg-sky-500',     dot: 'bg-sky-500'    },
  { es: 'Tarjeta',       en: 'Card',     pct: 28, color: 'bg-violet-400',  dot: 'bg-violet-400' },
  { es: 'Efectivo',      en: 'Cash',     pct: 25, color: 'bg-emerald-400', dot: 'bg-emerald-400'},
  { es: 'Cheque',        en: 'Check',    pct: 12, color: 'bg-amber-400',   dot: 'bg-amber-400'  },
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

// Deterministic "hash" for data variation
function h(year, month) {
  return ((year * 12 + month) * 6364136223846793005 + 1442695040888963407) & 0xffffffff
}

// ── Data generation ───────────────────────────────────────────────────────────
function buildMonthData(year, month) {
  const today = new Date()
  const curY = today.getFullYear(), curM = today.getMonth()
  if (year > curY || (year === curY && month > curM)) return null // future

  const yearMult = year < curY ? 0.87 : 1.0
  const base     = SEASON[month] * yearMult

  // Deterministic collection ratio 80–90%
  const hv = Math.abs(h(year, month)) % 100
  const collRatio = 0.80 + (hv % 10) * 0.01

  const facturado = Math.round(485_000 * base)
  const cobrado   = Math.round(facturado * collRatio)
  const pendiente = facturado - cobrado
  const carros    = Math.round(315 * base)

  const weekW = [0.19, 0.26, 0.30, 0.25]
  const weeks = weekW.map((w, i) => ({
    label:     `S${i + 1}`,
    facturado: Math.round(facturado * w),
    cobrado:   Math.round(cobrado   * w * (0.90 + i * 0.035)),
  }))

  const payMethods = PAY_METHODS.map(m => ({ ...m, amount: Math.round(cobrado * m.pct / 100) }))

  const topClients = [
    { name: 'Hotel Mirador del Mar, SAS',     tickets: Math.round(18 * base), total: Math.round(95_000 * base) },
    { name: 'Constructora Hernández & Asoc.', tickets: Math.round(24 * base), total: Math.round(72_000 * base) },
    { name: 'Supermercados La Cadena, SRL',   tickets: Math.round(12 * base), total: Math.round(45_000 * base) },
    { name: 'Grupo Empresarial Mejía, SA',    tickets: Math.round( 8 * base), total: Math.round(28_000 * base) },
    { name: 'Farmacia El Alivio, SRL',        tickets: Math.round( 5 * base), total: Math.round(12_000 * base) },
  ]

  const topServices = [
    { name: 'Lavado Básico',   count: Math.round(145 * base), total: Math.round( 43_500 * base) },
    { name: 'Lavado Completo', count: Math.round( 98 * base), total: Math.round( 49_000 * base) },
    { name: 'Full Detailing',  count: Math.round( 32 * base), total: Math.round(112_000 * base) },
    { name: 'Lavado Premium',  count: Math.round( 22 * base), total: Math.round( 17_600 * base) },
    { name: 'Tapizado',        count: Math.round( 15 * base), total: Math.round( 18_000 * base) },
  ]

  const cxcRaw = [
    { client: 'Hotel Mirador del Mar, SAS',     facturado: Math.round(95_000 * base), cobrado: Math.round(62_000 * base) },
    { client: 'Constructora Hernández & Asoc.', facturado: Math.round(72_000 * base), cobrado: Math.round(68_000 * base) },
    { client: 'Supermercados La Cadena, SRL',   facturado: Math.round(45_000 * base), cobrado: Math.round(38_350 * base) },
    { client: 'Grupo Empresarial Mejía, SA',    facturado: Math.round(28_000 * base), cobrado: 0 },
  ]
  const cxc = cxcRaw.map(c => ({ ...c, pendiente: c.facturado - c.cobrado }))

  const washers = [
    { name: 'Juan',   pct: 20, cars: Math.round(98 * base), commission: Math.round(19_600 * base) },
    { name: 'Pedro',  pct: 20, cars: Math.round(87 * base), commission: Math.round(17_400 * base) },
    { name: 'Carlos', pct: 22, cars: Math.round(76 * base), commission: Math.round(16_720 * base) },
    { name: 'María',  pct: 18, cars: Math.round(51 * base), commission: Math.round( 8_748 * base) },
  ]

  return { metrics: { facturado, cobrado, pendiente, carros }, weeks, payMethods, topClients, topServices, cxc, washers }
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

function buildPeriodData(period) {
  let months
  const today = new Date()
  const cy = today.getFullYear(), cm = today.getMonth()

  if (period.type === 'month') {
    months = [{ year: period.year, month: period.month }]
  } else {
    months = getMonthsInRange(period.fromYear, period.fromMonth, period.toYear, period.toMonth)
  }

  const arr = months.map(m => buildMonthData(m.year, m.month)).filter(Boolean)
  if (!arr.length) return null
  if (arr.length === 1) return { ...arr[0], isMulti: false, months }

  const metrics = {
    facturado: arr.reduce((s, d) => s + d.metrics.facturado, 0),
    cobrado:   arr.reduce((s, d) => s + d.metrics.cobrado,   0),
    pendiente: arr.reduce((s, d) => s + d.metrics.pendiente, 0),
    carros:    arr.reduce((s, d) => s + d.metrics.carros,    0),
  }

  // For multi-month, bars = one bar per month
  const bars = months.map((mo, i) => ({
    label:     MES_ES[mo.month],
    facturado: arr[i]?.metrics.facturado ?? 0,
    cobrado:   arr[i]?.metrics.cobrado   ?? 0,
  }))

  // Merge clients
  const cm2 = {}
  arr.forEach(d => d.topClients.forEach(c => {
    cm2[c.name] = cm2[c.name] ?? { name: c.name, tickets: 0, total: 0 }
    cm2[c.name].tickets += c.tickets
    cm2[c.name].total   += c.total
  }))
  const topClients = Object.values(cm2).sort((a, b) => b.total - a.total).slice(0, 5)

  // Merge services
  const sm = {}
  arr.forEach(d => d.topServices.forEach(s => {
    sm[s.name] = sm[s.name] ?? { name: s.name, count: 0, total: 0 }
    sm[s.name].count += s.count
    sm[s.name].total += s.total
  }))
  const topServices = Object.values(sm).sort((a, b) => b.total - a.total).slice(0, 5)

  // Merge washers
  const wm = {}
  arr.forEach(d => d.washers.forEach(w => {
    wm[w.name] = wm[w.name] ?? { name: w.name, pct: w.pct, cars: 0, commission: 0 }
    wm[w.name].cars       += w.cars
    wm[w.name].commission += w.commission
  }))
  const washers = Object.values(wm).sort((a, b) => b.commission - a.commission)

  const payMethods = PAY_METHODS.map(m => ({ ...m, amount: Math.round(metrics.cobrado * m.pct / 100) }))
  const cxc        = arr[arr.length - 1].cxc // use last month's CxC balances

  return { metrics, bars, payMethods, topClients, topServices, cxc, washers, isMulti: true, months }
}

function getPrevPeriod(period) {
  if (period.type === 'month') {
    const pm = period.month === 0 ? 11 : period.month - 1
    const py = period.month === 0 ? period.year - 1 : period.year
    return { type: 'month', year: py, month: pm }
  }
  const months = getMonthsInRange(period.fromYear, period.fromMonth, period.toYear, period.toMonth)
  const n = months.length
  const last = months[0]
  let fy = last.year, fm = last.month - n
  while (fm < 0) { fm += 12; fy-- }
  let ty = last.year, tm = last.month - 1
  if (tm < 0) { tm = 11; ty-- }
  return { type: 'range', fromYear: fy, fromMonth: fm, toYear: ty, toMonth: tm }
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

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportCSV(data, label) {
  const { metrics, topClients, topServices, cxc, washers } = data
  const rows = [
    [`Reporte Mensual — ${label}`], [],
    ['MÉTRICAS'], ['Total Facturado', metrics.facturado], ['Total Cobrado', metrics.cobrado],
    ['Pendiente Cobrar', metrics.pendiente], ['Carros Lavados', metrics.carros], [],
    ['TOP 5 CLIENTES'], ['#','Cliente','Tickets','Total'],
    ...topClients.map((c, i) => [i + 1, c.name, c.tickets, c.total]), [],
    ['TOP 5 SERVICIOS'], ['Servicio','Veces','Total'],
    ...topServices.map(s => [s.name, s.count, s.total]), [],
    ['CXC RESUMEN'], ['Cliente','Facturado','Cobrado','Pendiente'],
    ...cxc.map(c => [c.client, c.facturado, c.cobrado, c.pendiente]), [],
    ['COMISIONES'], ['Lavador','%','Carros','Comisión'],
    ...washers.map(w => [w.name, `${w.pct}%`, w.cars, w.commission]),
  ]
  const csv  = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `reporte-${label.replace(/\s+/g, '-').toLowerCase()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

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
    <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-5 py-4">
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
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-[22px] font-bold text-slate-800 leading-tight mt-0.5">{value}</p>
    </div>
  )
}

function BarChart({ bars, lang }) {
  const maxVal = Math.max(...bars.map(b => b.facturado), 1)
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-3 text-[11px] text-slate-500">
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
            <span className="text-[10px] text-slate-400 font-medium">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PayChart({ methods, lang }) {
  return (
    <div className="flex flex-col gap-3.5 justify-center h-full">
      {methods.map(m => (
        <div key={m.es} className="flex items-center gap-3">
          <div className="flex items-center gap-2 w-28 shrink-0 justify-end">
            <span className={`w-2 h-2 rounded-full ${m.dot}`} />
            <span className="text-[12px] text-slate-600">{lang === 'es' ? m.es : m.en}</span>
          </div>
          <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full ${m.color} rounded-full transition-all duration-500`} style={{ width: `${m.pct}%` }} />
          </div>
          <span className="text-[11px] font-bold text-slate-500 w-8 text-right">{m.pct}%</span>
          <span className="text-[12px] font-bold text-slate-700 w-24 text-right">{fmtRD(m.amount)}</span>
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
  { id: 'hoy',    es: 'Hoy',              en: 'Today',          period: () => ({ type: 'month', year: CUR_Y,     month: CUR_M     }) },
  { id: 'ayer',   es: 'Ayer',             en: 'Yesterday',      period: () => ({ type: 'month', year: CUR_Y,     month: CUR_M     }) },
  { id: 'semana', es: 'Esta semana',      en: 'This week',      period: () => ({ type: 'month', year: CUR_Y,     month: CUR_M     }) },
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
  const { lang } = useLang()

  const [mode,    setMode]    = useState('mes')  // 'dia' | 'mes' | 'rango'
  const [activePill, setPill] = useState('mes')
  const [period,  setPeriod]  = useState({ type: 'month', year: CUR_Y, month: CUR_M })

  // Range mode local state
  const [rangeFrom, setRangeFrom] = useState({ year: CUR_Y, month: CUR_M === 0 ? 11 : CUR_M - 1 < 0 ? 11 : CUR_M - 1 })
  const [rangeTo,   setRangeTo]   = useState({ year: CUR_Y, month: CUR_M })

  const data     = useMemo(() => buildPeriodData(period),         [period])
  const prevData = useMemo(() => buildPeriodData(getPrevPeriod(period)), [period])

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

  // Years to show in grid (current year and previous year)
  const gridYears = [CUR_Y - 1, CUR_Y]

  // Is month selected / highlighted in grid
  function monthState(year, month) {
    if (year > CUR_Y || (year === CUR_Y && month > CUR_M)) return 'future'
    if (period.type === 'month') {
      return (period.year === year && period.month === month) ? 'selected' : 'past'
    }
    // range
    const months = getMonthsInRange(period.fromYear, period.fromMonth, period.toYear, period.toMonth)
    return months.some(m => m.year === year && m.month === month) ? 'selected' : 'past'
  }

  const label = data ? periodLabel(period, lang) : '—'

  // Metric % changes
  function chg(key) {
    if (!data || !prevData) return 0
    return pctChange(data.metrics[key], prevData.metrics[key])
  }

  const MONTH_LABELS = lang === 'es' ? MES_ES : MES_EN

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="px-6 py-4 space-y-4 min-h-full">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-bold text-slate-800">{lang === 'es' ? 'Reporte Mensual' : 'Monthly Report'}</h2>
            <p className="text-[12px] text-slate-400 mt-0.5 font-medium">{label}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => data && exportCSV(data, label)}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Download size={13} />
              {lang === 'es' ? 'Exportar CSV' : 'Export CSV'}
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Printer size={13} />
              {lang === 'es' ? 'Imprimir' : 'Print'}
            </button>
          </div>
        </div>

        {/* ── Date selector card ───────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4">

          {/* Mode tabs */}
          <div className="flex gap-1 mb-4">
            {[
              { id: 'dia',   es: 'Día',   en: 'Day'   },
              { id: 'mes',   es: 'Mes',   en: 'Month' },
              { id: 'rango', es: 'Rango', en: 'Range' },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                  mode === m.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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
                    ? 'bg-sky-600 border-sky-600 text-white'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-sky-300 hover:text-sky-600'
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
                  <span className="text-[11px] font-bold text-slate-400 w-10 text-right shrink-0">{year}</span>
                  <div className="flex-1 grid grid-cols-12 gap-1">
                    {Array.from({ length: 12 }, (_, m) => {
                      const state = monthState(year, m)
                      return (
                        <button
                          key={m}
                          onClick={() => selectMonth(year, m)}
                          disabled={state === 'future'}
                          className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                            state === 'selected' ? 'bg-slate-800 text-white'
                            : state === 'past'   ? 'bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-100'
                            :                      'bg-slate-50 text-slate-300 cursor-not-allowed'
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
            <div className="flex items-end gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">{lang === 'es' ? 'Desde' : 'From'}</label>
                <div className="flex gap-2">
                  <select value={rangeFrom.month} onChange={e => setRangeFrom(f => ({ ...f, month: +e.target.value }))}
                    className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-sky-400">
                    {MONTH_LABELS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select value={rangeFrom.year} onChange={e => setRangeFrom(f => ({ ...f, year: +e.target.value }))}
                    className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-sky-400">
                    {[CUR_Y - 1, CUR_Y].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">{lang === 'es' ? 'Hasta' : 'To'}</label>
                <div className="flex gap-2">
                  <select value={rangeTo.month} onChange={e => setRangeTo(f => ({ ...f, month: +e.target.value }))}
                    className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-sky-400">
                    {MONTH_LABELS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                  <select value={rangeTo.year} onChange={e => setRangeTo(f => ({ ...f, year: +e.target.value }))}
                    className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-sky-400">
                    {[CUR_Y - 1, CUR_Y].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={applyRange} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-bold rounded-xl transition-colors">
                {lang === 'es' ? 'Aplicar' : 'Apply'}
              </button>
            </div>
          )}
        </div>

        {!data ? (
          <div className="flex items-center justify-center h-40 text-slate-400">
            {lang === 'es' ? 'Sin datos para el período seleccionado' : 'No data for selected period'}
          </div>
        ) : (
          <>

            {/* ── Metric cards ─────────────────────────────────────────── */}
            <div className="flex gap-3">
              <MetricCard icon={ReceiptText}      label={lang === 'es' ? 'Total Facturado' : 'Total Billed'}       value={fmtRD(data.metrics.facturado)} change={chg('facturado')} accent="sky"   />
              <MetricCard icon={CircleDollarSign} label={lang === 'es' ? 'Total Cobrado'   : 'Total Collected'}    value={fmtRD(data.metrics.cobrado)}   change={chg('cobrado')}   accent="green" />
              <MetricCard icon={Clock}            label={lang === 'es' ? 'Pendiente Cobrar': 'Pending Collection'} value={fmtRD(data.metrics.pendiente)} change={chg('pendiente')} accent="amber" />
              <MetricCard icon={Car}              label={lang === 'es' ? 'Carros Lavados'  : 'Cars Washed'}        value={data.metrics.carros}           change={chg('carros')}    accent="slate" />
            </div>

            {/* ── Charts row ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">

              {/* Weekly / monthly bar chart */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <p className="text-[12px] font-bold text-slate-600 mb-4">
                  {data.isMulti
                    ? (lang === 'es' ? 'Desglose Mensual' : 'Monthly Breakdown')
                    : (lang === 'es' ? 'Desglose Semanal'  : 'Weekly Breakdown')}
                </p>
                <BarChart bars={bars} lang={lang} />
              </div>

              {/* Payment method breakdown */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <p className="text-[12px] font-bold text-slate-600 mb-4">
                  {lang === 'es' ? 'Métodos de Pago (Cobrado)' : 'Payment Methods (Collected)'}
                </p>
                <PayChart methods={data.payMethods} lang={lang} />
              </div>
            </div>

            {/* ── Top clients + top services ───────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">

              {/* Top 5 clients */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <p className="text-[12px] font-bold text-slate-700">{lang === 'es' ? 'Top 5 Clientes' : 'Top 5 Clients'}</p>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-8">#</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {lang === 'es' ? 'Cliente' : 'Client'}
                      </th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {lang === 'es' ? 'Tickets' : 'Tickets'}
                      </th>
                      <th className="text-right px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topClients.map((c, i) => (
                      <tr key={i} className="border-t border-slate-50 hover:bg-slate-50/50">
                        <td className="px-5 py-3 text-[12px] font-bold text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3 text-[12px] font-medium text-slate-700 truncate max-w-[180px]">{c.name}</td>
                        <td className="px-4 py-3 text-[12px] text-slate-500 text-right">{c.tickets}</td>
                        <td className="px-5 py-3 text-[12px] font-bold text-slate-800 text-right">{fmtRD(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Top 5 services */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <p className="text-[12px] font-bold text-slate-700">{lang === 'es' ? 'Top 5 Servicios' : 'Top 5 Services'}</p>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {lang === 'es' ? 'Servicio' : 'Service'}
                      </th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {lang === 'es' ? 'Vendidos' : 'Sold'}
                      </th>
                      <th className="text-right px-5 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {lang === 'es' ? 'Ingresos' : 'Revenue'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topServices.map((s, i) => (
                      <tr key={i} className="border-t border-slate-50 hover:bg-slate-50/50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${['bg-sky-500','bg-violet-400','bg-emerald-400','bg-amber-400','bg-rose-400'][i]}`} />
                            <span className="text-[12px] font-medium text-slate-700">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-slate-500 text-right">{s.count}×</td>
                        <td className="px-5 py-3 text-[12px] font-bold text-slate-800 text-right">{fmtRD(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── CxC summary (full width) ─────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-[12px] font-bold text-slate-700">
                  {lang === 'es' ? 'Resumen CxC — Cuentas por Cobrar' : 'A/R Summary — Accounts Receivable'}
                </p>
                <span className="text-[11px] text-slate-400">{label}</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    {[
                      { es: 'Cliente',    en: 'Client',    cls: 'text-left  px-5 py-2.5 flex-1' },
                      { es: 'Facturado',  en: 'Billed',    cls: 'text-right px-5 py-2.5 w-[160px]' },
                      { es: 'Cobrado',    en: 'Collected', cls: 'text-right px-5 py-2.5 w-[160px]' },
                      { es: 'Pendiente',  en: 'Pending',   cls: 'text-right px-5 py-2.5 w-[160px]' },
                    ].map(col => (
                      <th key={col.es} className={`${col.cls} text-[10px] font-bold text-slate-400 uppercase tracking-wider`}>
                        {lang === 'es' ? col.es : col.en}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.cxc.map((c, i) => (
                    <tr key={i} className={`border-t border-slate-100 ${c.pendiente > 0 ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50/50'}`}>
                      <td className="px-5 py-3 text-[12px] font-medium text-slate-700">{c.client}</td>
                      <td className="px-5 py-3 text-[12px] text-slate-600 text-right">{fmtRD(c.facturado)}</td>
                      <td className="px-5 py-3 text-[12px] text-slate-600 text-right">{fmtRD(c.cobrado)}</td>
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
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="px-5 py-3 text-[12px] font-bold text-slate-700">{lang === 'es' ? 'TOTAL' : 'TOTAL'}</td>
                    <td className="px-5 py-3 text-[12px] font-bold text-slate-800 text-right">{fmtRD(data.cxc.reduce((s, c) => s + c.facturado, 0))}</td>
                    <td className="px-5 py-3 text-[12px] font-bold text-slate-800 text-right">{fmtRD(data.cxc.reduce((s, c) => s + c.cobrado, 0))}</td>
                    <td className="px-5 py-3 text-[12px] font-bold text-red-600 text-right">{fmtRD(data.cxc.reduce((s, c) => s + c.pendiente, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Washer commissions (full width) ─────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <p className="text-[12px] font-bold text-slate-700">
                  {lang === 'es' ? 'Comisiones de Lavadores' : 'Washer Commissions'}
                </p>
                <span className="text-[11px] text-slate-400">{label}</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    {[
                      { es: 'Lavador',    en: 'Washer',      cls: 'text-left  px-5 py-2.5' },
                      { es: '% Comisión', en: 'Commission %', cls: 'text-right px-5 py-2.5 w-[120px]' },
                      { es: 'Carros',     en: 'Cars',         cls: 'text-right px-5 py-2.5 w-[120px]' },
                      { es: 'Comisión',   en: 'Commission',   cls: 'text-right px-5 py-2.5 w-[160px]' },
                      { es: 'Barra',      en: 'Bar',          cls: 'px-5 py-2.5 w-[200px]' },
                    ].map(col => (
                      <th key={col.es} className={`${col.cls} text-[10px] font-bold text-slate-400 uppercase tracking-wider`}>
                        {col.es === 'Barra' ? '' : (lang === 'es' ? col.es : col.en)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const maxComm = Math.max(...data.washers.map(w => w.commission), 1)
                    return data.washers.map((w, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 bg-slate-100 rounded-full flex items-center justify-center text-[11px] font-bold text-slate-600">
                              {w.name[0]}
                            </div>
                            <span className="text-[13px] font-semibold text-slate-800">{w.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-[12px] text-slate-600 text-right">{w.pct}%</td>
                        <td className="px-5 py-3 text-[12px] text-slate-600 text-right">{w.cars}</td>
                        <td className="px-5 py-3 text-[13px] font-bold text-slate-800 text-right">{fmtRD(w.commission)}</td>
                        <td className="px-5 py-3">
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-sky-400 rounded-full transition-all duration-500"
                              style={{ width: `${(w.commission / maxComm) * 100}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))
                  })()}
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="px-5 py-3 text-[12px] font-bold text-slate-700" colSpan={2}>TOTAL</td>
                    <td className="px-5 py-3 text-[12px] font-bold text-slate-800 text-right">{data.washers.reduce((s, w) => s + w.cars, 0)}</td>
                    <td className="px-5 py-3 text-[13px] font-bold text-slate-800 text-right">{fmtRD(data.washers.reduce((s, w) => s + w.commission, 0))}</td>
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
