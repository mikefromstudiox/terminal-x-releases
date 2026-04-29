// ReportesDemo — faithful copy of packages/ui/screens/Reportes.jsx +
// reports/DailyReport.jsx render. API calls stripped, dark removed,
// hard-coded Spanish, seed transactions instead of api.tickets.byDateRange.

import { useState, useMemo } from 'react'
import {
  Search, X, Eye, Printer, AlertTriangle, CheckCircle2,
  ChevronDown, ReceiptText, TrendingUp, CircleDollarSign,
  Clock, Ban, Download, BarChart2, Calendar, DollarSign, Package,
} from 'lucide-react'

const TABS = [
  { id: 'daily',     label: 'Diario',     icon: BarChart2  },
  { id: 'monthly',   label: 'Mensual',    icon: Calendar   },
  { id: 'productos', label: 'Productos',  icon: Package    },
  { id: 'comm',      label: 'Comisiones', icon: DollarSign },
]
const DATE_PILLS = [{ id: 'hoy', es: 'Hoy' }, { id: 'ayer', es: 'Ayer' }, { id: 'semana', es: 'Esta Semana' }, { id: 'mes', es: 'Este Mes' }]
const TAB_FILTERS = [
  { id: 'all',   es: 'Todas',   fn: () => true },
  { id: 'paid',  es: 'Pagadas', fn: t => t.payMethod !== 'credit' && t.estado !== 'nula' },
  { id: 'cxc',   es: 'CxC',     fn: t => t.payMethod === 'credit' && t.estado !== 'nula' },
  { id: 'nulas', es: 'Nulas',   fn: t => t.estado === 'nula' },
]
const COLS = [
  { key: 'no',       label: '#',          cls: 'w-[80px]' },
  { key: 'client',   label: 'Cliente',    cls: 'flex-1 min-w-[120px]' },
  { key: 'services', label: 'Servicios',  cls: 'w-[160px]' },
  { key: 'cashier',  label: 'Cajero',     cls: 'w-[90px]' },
  { key: 'date',     label: 'Fecha',      cls: 'w-[120px]' },
  { key: 'sub',      label: 'Subtotal',   cls: 'w-[96px] text-right' },
  { key: 'itbis',    label: 'ITBIS',      cls: 'w-[84px] text-right' },
  { key: 'total',    label: 'Total',      cls: 'w-[104px] text-right' },
  { key: 'estado',   label: 'Estado',     cls: 'w-[108px]' },
]

function fmtRD(n) { return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtDate(d) { return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }
function fmtTime(d) { return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) }

function MetricCard({ icon: Icon, label, value, accent = 'sky', sub }) {
  const colors = {
    sky:    'text-sky-700 bg-sky-50',
    green:  'text-emerald-700 bg-emerald-50',
    violet: 'text-violet-700 bg-violet-50',
    amber:  'text-amber-700 bg-amber-50',
    red:    'text-red-700 bg-red-50',
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3 md:p-4 flex items-start gap-3">
      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${colors[accent]}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-[16px] md:text-[18px] font-extrabold text-slate-800 tabular-nums truncate">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function EstadoBadge({ t }) {
  if (t.estado === 'nula') return <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700"><Ban size={10} /> Nula</span>
  if (t.payMethod === 'credit') return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">CxC</span>
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Pagada</span>
}

function MixtoBadge({ parts }) {
  if (!parts || parts.length < 2) return null
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Mixto</span>
}

export default function ReportesDemo({ transactions: TX_SEED, reportTitle = 'Ventas / Facturas' }) {
  const [tab, setTab]           = useState('daily')
  const [datePill, setDatePill] = useState('hoy')
  const [search, setSearch]     = useState('')
  const [cashier, setCashier]   = useState('all')
  const [filter, setFilter]     = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  const transactions = TX_SEED.map(t => ({ ...t, date: t.date instanceof Date ? t.date : new Date(t.date) }))
  const cashierOptions = useMemo(() => [...new Set(transactions.map(t => t.cashier).filter(Boolean))].sort(), [])

  const baseFiltered = useMemo(() => transactions.filter(t => cashier === 'all' || t.cashier === cashier), [cashier, transactions])
  const summary = useMemo(() => {
    const active = baseFiltered.filter(t => t.estado !== 'nula')
    return {
      count: active.length,
      total: active.reduce((s, t) => s + t.total, 0),
      itbis: active.reduce((s, t) => s + t.itbis, 0),
      cxc:   baseFiltered.filter(t => t.payMethod === 'credit' && t.estado !== 'nula').reduce((s, t) => s + t.total, 0),
      nulas: baseFiltered.filter(t => t.estado === 'nula').length,
    }
  }, [baseFiltered])

  const visible = useMemo(() => {
    const tabFn = TAB_FILTERS.find(f => f.id === filter)?.fn ?? (() => true)
    const q = search.toLowerCase().trim()
    return baseFiltered.filter(tabFn).filter(t =>
      !q || t.client.toLowerCase().includes(q) || t.ticketNo.toLowerCase().includes(q) || (t.vehicle || '').toLowerCase().includes(q))
  }, [baseFiltered, filter, search])
  const tabCounts = useMemo(() => {
    const r = {}
    TAB_FILTERS.forEach(f => { r[f.id] = baseFiltered.filter(f.fn).length })
    return r
  }, [baseFiltered])

  const selected = transactions.find(t => t.id === selectedId)

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Top tabs (Reportes shell) */}
      <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 border-b border-slate-200 bg-white">
        <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800">Reportes</h2>
      </div>
      <div className="shrink-0 flex border-b border-slate-200 bg-white px-2 md:px-6 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 md:px-4 py-3 text-xs md:text-[13px] font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap ${
              tab === id ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Filter header — same as DailyReport */}
      <div className="shrink-0 bg-white border-b border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 gap-2 md:gap-4">
          <div>
            <h3 className="text-[14px] md:text-[15px] font-bold text-slate-800">{reportTitle}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5 hidden md:block">Historial completo de transacciones</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="relative flex-1 md:flex-none">
              <select value={cashier} onChange={e => setCashier(e.target.value)}
                className="appearance-none w-full md:w-auto pl-3 pr-8 py-2 min-h-[44px] md:min-h-0 bg-slate-50 border border-slate-200 rounded-xl text-[12px] text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer">
                <option value="all">Todos los cajeros</option>
                {cashierOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 min-h-[44px] md:min-h-0 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-sky-400 flex-1 md:flex-none w-full md:w-56">
              <Search size={13} className="text-slate-400 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente o # factura..."
                className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-slate-700 placeholder:text-slate-400" />
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pb-0 gap-1 md:gap-0">
          <div className="flex gap-0.5 flex-wrap">
            {TAB_FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3.5 py-2.5 text-[11px] md:text-[12px] font-medium border-b-2 -mb-px transition-colors shrink-0 ${
                  filter === f.id ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}>
                {f.es}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                  filter === f.id ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-400'
                }`}>{tabCounts[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 pb-2.5 overflow-x-auto">
            {DATE_PILLS.map(p => (
              <button key={p.id} onClick={() => setDatePill(p.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors shrink-0 ${
                  datePill === p.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}>{p.es}</button>
            ))}
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-500 hover:bg-slate-200 shrink-0">
              <Download size={12} /> CSV
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-500 hover:bg-slate-200 shrink-0">
              <Printer size={12} /> Imprimir
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI bar */}
      <div className="shrink-0 grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 px-3 md:px-6 py-2 md:py-3">
        <MetricCard icon={ReceiptText}      label="Total Facturas"     value={summary.count}        accent="sky"    />
        <MetricCard icon={TrendingUp}       label="Total Facturado"    value={fmtRD(summary.total)} accent="green"  />
        <MetricCard icon={CircleDollarSign} label="ITBIS Generado"     value={fmtRD(summary.itbis)} accent="violet" />
        <MetricCard icon={Clock}            label="CxC Pendiente"      value={fmtRD(summary.cxc)}   accent="amber"  />
        <MetricCard icon={Ban}              label="Facturas Nulas"     value={summary.nulas}        accent="red"    />
      </div>

      {/* Table */}
      <div className="flex-1 flex flex-col bg-white mx-2 md:mx-6 mb-3 rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          <div className="hidden md:flex items-center h-9 bg-slate-50 border-b border-slate-200 px-5 sticky top-0 z-10">
            {COLS.map(col => (
              <div key={col.key} className={`${col.cls} text-[10px] font-bold text-slate-400 uppercase tracking-wider pr-4`}>{col.label}</div>
            ))}
          </div>
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-300 gap-2">
              <ReceiptText size={28} />
              <p className="text-[13px]">Sin resultados para este filtro</p>
            </div>
          ) : visible.map(t => {
            const isSelected = t.id === selectedId
            const isNula = t.estado === 'nula'
            const isCxC = t.payMethod === 'credit' && !isNula
            const main = t.services[0]?.name || '—'
            const extra = (t.services?.length || 0) - 1
            return (
              <button key={t.id} onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                className={`w-full text-left transition-colors border-b border-slate-100 ${
                  isSelected ? 'bg-sky-50 border-l-2 border-l-sky-500'
                  : isNula ? 'bg-red-50/60 hover:bg-red-50 border-l-2 border-l-transparent'
                  : isCxC ? 'bg-amber-50/50 hover:bg-amber-50 border-l-2 border-l-transparent'
                  : 'bg-white hover:bg-slate-50 border-l-2 border-l-transparent'
                }`}>
                <div className="md:hidden px-3 py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-[13px] font-bold ${isNula ? 'text-red-400 line-through' : 'text-sky-600'}`}>{t.ticketNo}</span>
                    <span className={`text-[13px] font-bold ${isNula ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{fmtRD(t.total)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className={`text-[12px] font-semibold truncate flex-1 ${isNula ? 'text-slate-400' : 'text-slate-800'}`}>{t.client}</p>
                    <div className="flex items-center gap-1.5 shrink-0"><MixtoBadge parts={t.paymentParts} /><EstadoBadge t={t} /></div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    {t.vehicle && t.vehicle !== '—' && <span>{t.vehicle}</span>}
                    <span>{fmtDate(t.date)} {fmtTime(t.date)}</span>
                  </div>
                </div>
                <div className="hidden md:flex items-center h-14 px-5">
                  <div className="w-[80px] shrink-0 pr-4"><span className={`text-[13px] font-bold ${isNula ? 'text-red-400 line-through' : 'text-sky-600'}`}>{t.ticketNo}</span></div>
                  <div className="flex-1 min-w-[120px] pr-4">
                    <p className={`text-[12px] font-semibold truncate ${isNula ? 'text-slate-400' : 'text-slate-800'}`}>{t.client || '—'}</p>
                    {t.vehicle && t.vehicle !== '—' && <p className="text-[11px] text-slate-400 truncate">{t.vehicle}</p>}
                  </div>
                  <div className="w-[160px] shrink-0 pr-4 flex items-center gap-1.5 min-w-0">
                    <span className={`text-[12px] truncate ${isNula ? 'text-slate-400' : 'text-slate-700'}`}>{main}</span>
                    {extra > 0 && <span className="shrink-0 text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">+{extra}</span>}
                  </div>
                  <div className="w-[90px] shrink-0 pr-4"><span className={`text-[12px] ${isNula ? 'text-slate-400' : 'text-slate-600'}`}>{t.cashier}</span></div>
                  <div className="w-[120px] shrink-0 pr-4"><p className={`text-[11px] ${isNula ? 'text-slate-400' : 'text-slate-700'}`}>{fmtDate(t.date)}</p><p className="text-[10px] text-slate-400">{fmtTime(t.date)}</p></div>
                  <div className="w-[96px] shrink-0 pr-4 text-right"><span className={`text-[12px] ${isNula ? 'text-slate-400 line-through' : 'text-slate-600'}`}>{fmtRD(t.subtotal)}</span></div>
                  <div className="w-[84px] shrink-0 pr-4 text-right"><span className={`text-[12px] ${isNula ? 'text-slate-400 line-through' : 'text-slate-500'}`}>{fmtRD(t.itbis)}</span></div>
                  <div className="w-[104px] shrink-0 pr-4 text-right"><span className={`text-[13px] font-bold ${isNula ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{fmtRD(t.total)}</span></div>
                  <div className="w-[108px] shrink-0 flex items-center gap-1"><EstadoBadge t={t} /><MixtoBadge parts={t.paymentParts} /></div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-5 py-2 flex items-center justify-between bg-slate-50/50">
          <span className="text-[11px] text-slate-400">{visible.length} registros{search && ` · filtrado por "${search}"`}</span>
          <span className="text-[11px] font-semibold text-slate-600">Total visible: {fmtRD(visible.filter(t => t.estado !== 'nula').reduce((s, t) => s + t.total, 0))}</span>
        </div>
      </div>

      {/* Bottom action bar */}
      {selected && (
        <div className="shrink-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-4">
          <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"><X size={15} /></button>
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-bold text-sky-600">{selected.ticketNo}</span>
            {selected.vehicle && selected.vehicle !== '—' && <span className="text-[13px] text-slate-500 ml-2">{selected.vehicle}</span>}
            <span className="text-[13px] font-semibold text-slate-800 ml-3">{fmtRD(selected.total)}</span>
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50"><Eye size={13} /> Ver detalle</button>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50"><Printer size={13} /> Reimprimir</button>
            {!selected.estado || selected.estado !== 'nula' ? (
              <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-red-50 text-red-700 hover:bg-red-100"><Ban size={13} /> Anular</button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
