import { useState, useMemo, useEffect } from 'react'
import { Lock, Download, Printer, ChevronRight, Car, CircleDollarSign, Users, BarChart3, Coffee, AlertCircle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { exportCommissionDetail, exportCommissionSummary } from '../../services/csv'
import { printCommissionDetail, printCommissionSummary } from '../../services/report-html'

// ── Access control ────────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['owner', 'manager', 'cfo', 'accountant']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(d) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })
}

// ── Palette ───────────────────────────────────────────────────────────────────
const PALETTE = [
  { bg: 'bg-sky-100',     text: 'text-sky-700',     bar: 'bg-sky-400'     },
  { bg: 'bg-violet-100',  text: 'text-violet-700',  bar: 'bg-violet-400'  },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-400' },
  { bg: 'bg-rose-100',    text: 'text-rose-700',    bar: 'bg-rose-400'    },
]

// ── Date range helpers ────────────────────────────────────────────────────────
function getDateRange(period, customY, customM) {
  const now         = new Date()
  const todayStr    = now.toISOString().slice(0, 10)
  const tomorrow    = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  if (period === 'hoy')    return { from: todayStr, to: tomorrowStr }
  if (period === 'semana') {
    const mon = new Date(now); const day = mon.getDay()
    mon.setDate(mon.getDate() - (day === 0 ? 6 : day - 1))
    return { from: mon.toISOString().slice(0, 10), to: tomorrowStr }
  }
  if (period === 'mes') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: first.toISOString().slice(0, 10), to: tomorrowStr }
  }
  if (period === 'custom') {
    const first = new Date(customY, customM, 1)
    const last  = new Date(customY, customM + 1, 1)
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
  }
  return { from: todayStr, to: tomorrowStr }
}

const TODAY_OBJ = new Date()
const CUR_Y     = TODAY_OBJ.getFullYear()
const CUR_M     = TODAY_OBJ.getMonth()
const MES_ES    = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const PAST_MONTHS = Array.from({ length: 12 }, (_, i) => {
  let m = CUR_M - i, y = CUR_Y
  while (m < 0) { m += 12; y-- }
  return { year: y, month: m }
})

// ── CSV export (removed — now uses services/csv.js) ──────────────────────────

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, sub, accent }) {
  const a = { sky:'bg-sky-50 text-sky-600 border-sky-100', green:'bg-green-50 text-green-600 border-green-100', violet:'bg-violet-50 text-violet-600 border-violet-100', slate:'bg-slate-100 text-slate-600 border-slate-200' }
  return (
    <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-2xl px-3 md:px-5 py-3 md:py-4">
      <div className={`w-7 h-7 md:w-9 md:h-9 rounded-xl flex items-center justify-center border ${a[accent]} mb-2 md:mb-3`}>
        <Icon size={14} />
      </div>
      <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</p>
      <p className="text-[15px] md:text-[21px] font-bold text-slate-800 leading-tight mt-0.5 truncate">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function EstadoBadge({ estado, lang }) {
  return estado === 'cobrado'
    ? <span className="text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">{lang === 'es' ? 'Cobrado' : 'Collected'}</span>
    : <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">{lang === 'es' ? 'Pendiente' : 'Pending'}</span>
}

const COLS = [
  { es: '#',            en: '#',              cls: 'w-[80px] shrink-0'           },
  { es: 'Cliente / Vehiculo', en: 'Client / Vehicle', cls: 'flex-1 min-w-0'    },
  { es: 'Servicio',     en: 'Service',        cls: 'w-[148px] shrink-0'         },
  { es: 'Base s/ITBIS', en: 'Base ex-ITBIS',  cls: 'w-[104px] shrink-0 text-right' },
  { es: '%',            en: '%',              cls: 'w-[48px]  shrink-0 text-center' },
  { es: 'Comision',     en: 'Commission',     cls: 'w-[100px] shrink-0 text-right' },
  { es: 'Estado',       en: 'Status',         cls: 'w-[100px] shrink-0'         },
]

function TicketTable({ tickets, personName, lang, loading }) {
  const totalBase       = tickets.reduce((s, t) => s + t.commBase,   0)
  const totalCommission = tickets.reduce((s, t) => s + t.commission, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-300 gap-3">
        <div className="w-5 h-5 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin" />
        <span className="text-[13px]">{lang === 'es' ? 'Cargando tickets...' : 'Loading tickets...'}</span>
      </div>
    )
  }

  if (!tickets.length) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-300 text-[13px]">
        {lang === 'es' ? 'Sin tickets en este periodo' : 'No tickets in this period'}
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center h-9 bg-slate-50 border-b border-slate-200 px-5 shrink-0">
        {COLS.map((col, i) => (
          <div key={i} className={`${col.cls} text-[10px] font-bold text-slate-400 uppercase tracking-wider pr-3`}>
            {lang === 'es' ? col.es : col.en}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tickets.map(t => (
          <div key={t.id} className="flex items-center h-14 border-b border-slate-100 px-5 hover:bg-slate-50/60 transition-colors">
            <div className="w-[80px] shrink-0 pr-3">
              <span className="text-[13px] font-bold text-sky-600">{t.ticketNo}</span>
              <p className="text-[10px] text-slate-400">{fmtDate(t.date)}</p>
            </div>
            <div className="flex-1 min-w-0 pr-3">
              <p className="text-[12px] font-semibold text-slate-800 truncate">{t.vehicle}</p>
              <p className="text-[11px] text-slate-400 truncate">{t.client}</p>
            </div>
            <div className="w-[148px] shrink-0 pr-3">
              <span className="text-[12px] text-slate-700 truncate block">{t.mainService.name}</span>
            </div>
            <div className="w-[104px] shrink-0 pr-3 text-right">
              <span className="text-[12px] font-semibold text-emerald-700">{fmtRD(t.commBase)}</span>
            </div>
            <div className="w-[48px] shrink-0 pr-3 text-center">
              <span className="text-[12px] text-slate-500">{t.pct}%</span>
            </div>
            <div className="w-[100px] shrink-0 pr-3 text-right">
              <span className="text-[13px] font-bold text-sky-700">{fmtRD(t.commission)}</span>
            </div>
            <div className="w-[100px] shrink-0">
              <EstadoBadge estado={t.estado} lang={lang} />
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 flex items-center h-11 border-t-2 border-slate-200 bg-slate-50 px-5">
        <div className="w-[80px] shrink-0 pr-3">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{tickets.length} tickets</span>
        </div>
        <div className="flex-1 min-w-0 pr-3" />
        <div className="w-[148px] shrink-0 pr-3" />
        <div className="w-[104px] shrink-0 pr-3 text-right">
          <span className="text-[12px] font-bold text-emerald-700">{fmtRD(totalBase)}</span>
        </div>
        <div className="w-[48px] shrink-0 pr-3" />
        <div className="w-[100px] shrink-0 pr-3 text-right">
          <span className="text-[14px] font-bold text-sky-700">{fmtRD(totalCommission)}</span>
        </div>
        <div className="w-[100px] shrink-0" />
      </div>
    </div>
  )
}

function AccessDenied({ lang }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400 bg-slate-50">
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-slate-300" />
      </div>
      <div className="text-center">
        <p className="text-[15px] font-bold text-slate-600 mb-1">
          {lang === 'es' ? 'Acceso Restringido' : 'Restricted Access'}
        </p>
        <p className="text-[12px] text-slate-400 max-w-[260px]">
          {lang === 'es'
            ? 'Solo gerentes, duenos, contadores y CFO pueden ver las comisiones.'
            : 'Only managers, owners, accountants, and CFO can view commissions.'}
        </p>
      </div>
    </div>
  )
}

// ── Generic commission panel (reused for each sub-tab) ───────────────────────

function CommissionPanel({
  lang, period, customY, customM,
  // Data
  people,           // all washers/sellers/cajeros from allAdmin()
  periodSummaries,  // byPeriod results
  loadingSummary,
  // Labels
  personLabel,      // e.g. 'Lavador' / 'Vendedor' / 'Cajera'
  personLabelAll,   // e.g. 'Todos los lavadores'
  metricLabels,     // { total, count, active, avg }
  baseLabel,        // e.g. 'base s/ITBIS' or 'base bebidas'
  // Detail
  selectedId, setSelectedId,
  detailTickets, loadingTickets,
  periodLabel,
  onExport,
}) {
  // Build summaries with palette
  const summaries = useMemo(() => {
    return periodSummaries.map((ps, i) => {
      const idx = people.findIndex(p => p.id === (ps.washer_id || ps.seller_id || ps.cajero_id))
      const paletteIdx = idx >= 0 ? idx : i
      return {
        id:         ps.washer_id || ps.seller_id || ps.cajero_id,
        name:       ps.washer_name || ps.seller_name || ps.cajero_name,
        pct:        ps.commission_pct,
        palette:    PALETTE[paletteIdx % PALETTE.length],
        cars:       ps.ticket_count || 0,
        commission: ps.total_commission || 0,
        commBase:   ps.total_base || 0,
      }
    })
  }, [periodSummaries, people])

  const summary = useMemo(() => {
    const totalCommission = summaries.reduce((s, w) => s + w.commission, 0)
    const totalCars       = summaries.reduce((s, w) => s + w.cars, 0)
    const active          = summaries.length
    const avg             = active > 0 ? totalCommission / active : 0
    return { totalCommission, totalCars, active, avg }
  }, [summaries])

  const selectedData = summaries.find(w => String(w.id) === String(selectedId)) ?? null

  const dropdownList = useMemo(() => {
    if (people.length > 0) return people
    return summaries.map(w => ({ id: w.id, name: w.name, commission_pct: w.pct }))
  }, [people, summaries])

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:flex gap-2 md:gap-3">
        <MetricCard icon={CircleDollarSign} label={metricLabels.total} value={fmtRD(summary.totalCommission)} accent="sky" />
        <MetricCard icon={Car}              label={metricLabels.count} value={summary.totalCars}              accent="green" />
        <MetricCard icon={Users}            label={metricLabels.active} value={summary.active}                accent="violet" />
        <MetricCard icon={BarChart3}        label={metricLabels.avg}   value={fmtRD(summary.avg)}             accent="slate" />
      </div>

      {/* Person selector + summary strip */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-3.5 border-b border-slate-100">
          <p className="text-[12px] font-bold text-slate-500 shrink-0">{personLabel}</p>
          <div className="relative">
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-semibold text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              <option value="all">{personLabelAll}</option>
              {dropdownList.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}{w.commission_pct != null ? ` (${w.commission_pct}%)` : ''}
                </option>
              ))}
            </select>
            <ChevronRight size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none rotate-90" />
          </div>
          {selectedId !== 'all' && selectedData && (
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${selectedData.palette?.bg} ${selectedData.palette?.text}`}>
              {selectedData.pct}% {lang === 'es' ? 'comision' : 'commission'}
            </span>
          )}
        </div>

        {/* All-persons strip */}
        {selectedId === 'all' && (
          <div>
            {loadingSummary ? (
              <div className="flex items-center justify-center h-24 text-slate-300 gap-3">
                <div className="w-5 h-5 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin" />
                <span className="text-[13px]">{lang === 'es' ? 'Cargando comisiones...' : 'Loading commissions...'}</span>
              </div>
            ) : summaries.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-slate-300 text-[13px]">
                {lang === 'es' ? 'Sin datos para este periodo' : 'No data for this period'}
              </div>
            ) : (
              <>
                {summaries.map((w) => {
                  const maxComm = Math.max(...summaries.map(x => x.commission), 1)
                  return (
                    <button
                      key={w.id}
                      onClick={() => setSelectedId(String(w.id))}
                      className="w-full flex items-center gap-4 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-colors text-left last:border-0 group"
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${w.palette.bg} ${w.palette.text}`}>
                        {w.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-slate-800 truncate">{w.name}</p>
                        <p className="text-[11px] text-slate-400">{w.pct}% · {w.cars} tickets</p>
                      </div>
                      <div className="hidden md:block w-[120px] shrink-0 text-right">
                        <p className="text-[12px] font-semibold text-emerald-700">{fmtRD(w.commBase)}</p>
                        <p className="text-[10px] text-slate-400">{baseLabel}</p>
                      </div>
                      <div className="hidden md:flex flex-1 items-center gap-3">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${w.palette.bar} rounded-full transition-all duration-500`} style={{ width: `${(w.commission / maxComm) * 100}%` }} />
                        </div>
                      </div>
                      <span className="text-[13px] md:text-[14px] font-bold text-sky-700 shrink-0">{fmtRD(w.commission)}</span>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-sky-500 transition-colors shrink-0" />
                    </button>
                  )
                })}
                <div className="flex items-center gap-4 px-5 py-3 bg-slate-50 border-t border-slate-200">
                  <div className="w-9 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Total · {summary.totalCars} tickets</p>
                  </div>
                  <span className="text-[15px] font-bold text-sky-700 shrink-0">{fmtRD(summary.totalCommission)}</span>
                  <div className="w-5 shrink-0" />
                </div>
              </>
            )}
          </div>
        )}

        {/* Individual summary cards */}
        {selectedId !== 'all' && selectedData && (
          <div className="grid grid-cols-3 gap-2 md:gap-3 px-4 md:px-5 py-3 md:py-4 border-b border-slate-100">
            {[
              { label_es: 'Tickets',          label_en: 'Tickets',            value: selectedData.cars },
              { label_es: 'Base s/ITBIS',     label_en: 'Base ex-ITBIS',     value: fmtRD(selectedData.commBase) },
              { label_es: 'Comision ganada',   label_en: 'Commission earned', value: fmtRD(selectedData.commission) },
            ].map((card, i) => (
              <div key={i} className={`flex-1 rounded-xl px-4 py-3 ${i === 2 ? 'bg-sky-50 border border-sky-100' : 'bg-slate-50 border border-slate-200'}`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {lang === 'es' ? card.label_es : card.label_en}
                </p>
                <p className={`text-[18px] font-bold mt-0.5 ${i === 2 ? 'text-sky-700' : 'text-slate-800'}`}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ticket table (individual) */}
      {selectedId !== 'all' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col max-h-[500px]" style={{ minHeight: 320 }}>
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
            <p className="text-[12px] font-bold text-slate-700">
              {lang === 'es' ? 'Tickets del periodo' : 'Period tickets'}
              <span className="ml-2 text-[11px] font-normal text-slate-400">· {periodLabel}</span>
            </p>
          </div>
          <TicketTable tickets={detailTickets} personName={selectedData?.name ?? ''} lang={lang} loading={loadingTickets} />
        </div>
      )}
    </>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function WorkerReport() {
  const api = useAPI()
  const { user }  = useAuth()
  const { lang }  = useLang()

  // Sub-tab: lavadores | vendedores | cajeras
  const [subTab, setSubTab] = useState('lavadores')

  const [period,  setPeriod]  = useState('mes')
  const [customY, setCustomY] = useState(CUR_Y)
  const [customM, setCustomM] = useState(CUR_M)

  // Washer state
  const [washers,          setWashers]          = useState([])
  const [washerSummaries,  setWasherSummaries]  = useState([])
  const [washerId,         setWasherId]         = useState('all')
  const [washerTickets,    setWasherTickets]    = useState([])
  const [loadingWS,        setLoadingWS]        = useState(false)
  const [loadingWT,        setLoadingWT]        = useState(false)

  // Seller state
  const [sellers,          setSellers]          = useState([])
  const [sellerSummaries,  setSellerSummaries]  = useState([])
  const [sellerId,         setSellerId]         = useState('all')
  const [sellerTickets,    setSellerTickets]    = useState([])
  const [loadingSS,        setLoadingSS]        = useState(false)
  const [loadingST,        setLoadingST]        = useState(false)

  // Cajero state
  const [cajeros,          setCajeros]          = useState([])
  const [cajeroSummaries,  setCajeroSummaries]  = useState([])
  const [cajeroId,         setCajeroId]         = useState('all')
  const [cajeroTickets,    setCajeroTickets]    = useState([])
  const [loadingCS,        setLoadingCS]        = useState(false)
  const [loadingCT,        setLoadingCT]        = useState(false)
  const [toast,            setToast]            = useState(null)
  const [biz,              setBiz]              = useState({})

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const hasAccess = ALLOWED_ROLES.includes(user?.role)

  // Load people lists once
  useEffect(() => {
    if (!hasAccess) return
    api.washers.allAdmin().then(r => setWashers(r || [])).catch(() => { setWashers([]); flash(lang === 'es' ? 'Error al cargar lavadores' : 'Error loading washers') })
    api.sellers.allAdmin().then(r => setSellers(r || [])).catch(() => { setSellers([]); flash(lang === 'es' ? 'Error al cargar vendedores' : 'Error loading sellers') })
    // Cajeros = users with cashier role or commission_pct > 0
    api.users?.all?.().then(r => {
      const users = (r || []).filter(u => u.role === 'cashier' || (u.commission_pct && u.commission_pct > 0))
      setCajeros(users)
    }).catch(() => { setCajeros([]); flash(lang === 'es' ? 'Error al cargar cajeras' : 'Error loading cashiers') })
    api.admin?.getEmpresa?.().then(e => e && setBiz({ name: e.nombre, rnc: e.rnc, address: e.direccion, phone: e.telefono, email: e.email })).catch(() => {})
  }, [])

  const range = getDateRange(period, customY, customM)

  // Load washer summaries
  useEffect(() => {
    if (!hasAccess || subTab !== 'lavadores') return
    let cancelled = false
    setLoadingWS(true); setWasherId('all'); setWasherTickets([])
    api.commissions.byPeriod(range)
      .then(rows => { if (!cancelled) setWasherSummaries(rows || []) })
      .catch(() => { if (!cancelled) { setWasherSummaries([]); flash(lang === 'es' ? 'Error al cargar comisiones' : 'Error loading commissions') } })
      .finally(() => { if (!cancelled) setLoadingWS(false) })
    return () => { cancelled = true }
  }, [subTab, period, customY, customM])

  // Load washer detail
  useEffect(() => {
    if (!hasAccess || subTab !== 'lavadores' || washerId === 'all') { setWasherTickets([]); return }
    let cancelled = false; setLoadingWT(true)
    api.commissions.byWasher({ washerId: washerId, ...range })
      .then(rows => {
        if (!cancelled) setWasherTickets((rows || []).map(r => ({
          id: r.id, ticketNo: r.doc_number, vehicle: r.vehicle_plate || '—', client: '—',
          date: new Date(r.ticket_date), mainService: { name: r.services || '—' }, services: [],
          commBase: r.base_amount || 0, commission: r.commission_amount || 0, pct: r.commission_pct || 0,
          estado: r.paid ? 'cobrado' : 'pendiente',
        })))
      })
      .catch(() => { if (!cancelled) { setWasherTickets([]); flash(lang === 'es' ? 'Error al cargar detalle' : 'Error loading detail') } })
      .finally(() => { if (!cancelled) setLoadingWT(false) })
    return () => { cancelled = true }
  }, [subTab, washerId, period, customY, customM])

  // Load seller summaries
  useEffect(() => {
    if (!hasAccess || subTab !== 'vendedores') return
    let cancelled = false
    setLoadingSS(true); setSellerId('all'); setSellerTickets([])
    api.sellerCommissions.byPeriod(range)
      .then(rows => { if (!cancelled) setSellerSummaries(rows || []) })
      .catch(() => { if (!cancelled) { setSellerSummaries([]); flash(lang === 'es' ? 'Error al cargar comisiones' : 'Error loading commissions') } })
      .finally(() => { if (!cancelled) setLoadingSS(false) })
    return () => { cancelled = true }
  }, [subTab, period, customY, customM])

  // Load seller detail
  useEffect(() => {
    if (!hasAccess || subTab !== 'vendedores' || sellerId === 'all') { setSellerTickets([]); return }
    let cancelled = false; setLoadingST(true)
    api.sellerCommissions.bySeller({ sellerId: sellerId, ...range })
      .then(rows => {
        if (!cancelled) setSellerTickets((rows || []).map(r => ({
          id: r.id, ticketNo: r.doc_number, vehicle: r.vehicle_plate || '—', client: '—',
          date: new Date(r.ticket_date), mainService: { name: r.services || '—' }, services: [],
          commBase: r.base_amount || 0, commission: r.commission_amount || 0, pct: r.commission_pct || 0,
          estado: r.paid ? 'cobrado' : 'pendiente',
        })))
      })
      .catch(() => { if (!cancelled) { setSellerTickets([]); flash(lang === 'es' ? 'Error al cargar detalle' : 'Error loading detail') } })
      .finally(() => { if (!cancelled) setLoadingST(false) })
    return () => { cancelled = true }
  }, [subTab, sellerId, period, customY, customM])

  // Load cajero summaries
  useEffect(() => {
    if (!hasAccess || subTab !== 'cajeras') return
    let cancelled = false
    setLoadingCS(true); setCajeroId('all'); setCajeroTickets([])
    api.cajeroCommissions.byPeriod(range)
      .then(rows => { if (!cancelled) setCajeroSummaries(rows || []) })
      .catch(() => { if (!cancelled) { setCajeroSummaries([]); flash(lang === 'es' ? 'Error al cargar comisiones' : 'Error loading commissions') } })
      .finally(() => { if (!cancelled) setLoadingCS(false) })
    return () => { cancelled = true }
  }, [subTab, period, customY, customM])

  // Load cajero detail
  useEffect(() => {
    if (!hasAccess || subTab !== 'cajeras' || cajeroId === 'all') { setCajeroTickets([]); return }
    let cancelled = false; setLoadingCT(true)
    api.cajeroCommissions.byCajero({ cajeroId: cajeroId, ...range })
      .then(rows => {
        if (!cancelled) setCajeroTickets((rows || []).map(r => ({
          id: r.id, ticketNo: r.doc_number, vehicle: r.vehicle_plate || '—', client: '—',
          date: new Date(r.ticket_date), mainService: { name: r.services || '—' }, services: [],
          commBase: r.base_amount || 0, commission: r.commission_amount || 0, pct: r.commission_pct || 0,
          estado: r.paid ? 'cobrado' : 'pendiente',
        })))
      })
      .catch(() => { if (!cancelled) { setCajeroTickets([]); flash(lang === 'es' ? 'Error al cargar detalle' : 'Error loading detail') } })
      .finally(() => { if (!cancelled) setLoadingCT(false) })
    return () => { cancelled = true }
  }, [subTab, cajeroId, period, customY, customM])

  if (!hasAccess) return <AccessDenied lang={lang} />

  const periodLabel = period === 'hoy'    ? (lang === 'es' ? 'Hoy'          : 'Today')
                    : period === 'semana' ? (lang === 'es' ? 'Esta semana'  : 'This week')
                    : period === 'mes'    ? (lang === 'es' ? 'Este mes'     : 'This month')
                    : `${MES_ES[customM]} ${customY}`

  function handleExport() {
    let summaries, tickets, name, allLabel
    if (subTab === 'lavadores') { summaries = washerSummaries; tickets = washerTickets; name = washers.find(w => String(w.id) === String(washerId))?.name; allLabel = 'Lavadores' }
    else if (subTab === 'vendedores') { summaries = sellerSummaries; tickets = sellerTickets; name = sellers.find(s => String(s.id) === String(sellerId))?.name; allLabel = 'Vendedores' }
    else { summaries = cajeroSummaries; tickets = cajeroTickets; name = cajeros.find(c => String(c.id) === String(cajeroId))?.name; allLabel = 'Cajeras' }
    const curId = subTab === 'lavadores' ? washerId : subTab === 'vendedores' ? sellerId : cajeroId
    if (curId === 'all') {
      exportCommissionSummary(biz, summaries, allLabel, periodLabel)
    } else {
      const pct = tickets[0]?.pct || 0
      exportCommissionDetail(biz, tickets, name ?? allLabel, pct, periodLabel)
    }
  }

  function handlePrint() {
    let summaries, tickets, name, allLabel
    if (subTab === 'lavadores') { summaries = washerSummaries; tickets = washerTickets; name = washers.find(w => String(w.id) === String(washerId))?.name; allLabel = 'Lavadores' }
    else if (subTab === 'vendedores') { summaries = sellerSummaries; tickets = sellerTickets; name = sellers.find(s => String(s.id) === String(sellerId))?.name; allLabel = 'Vendedores' }
    else { summaries = cajeroSummaries; tickets = cajeroTickets; name = cajeros.find(c => String(c.id) === String(cajeroId))?.name; allLabel = 'Cajeras' }
    const curId = subTab === 'lavadores' ? washerId : subTab === 'vendedores' ? sellerId : cajeroId
    if (curId === 'all') {
      printCommissionSummary(biz, summaries, allLabel, periodLabel)
    } else {
      const pct = tickets[0]?.pct || 0
      printCommissionDetail(biz, tickets, name ?? allLabel, pct, periodLabel)
    }
  }

  const PILLS = [
    { id: 'hoy',    es: 'Hoy',           en: 'Today'      },
    { id: 'semana', es: 'Esta semana',   en: 'This week'  },
    { id: 'mes',    es: 'Este mes',      en: 'This month' },
  ]

  const SUB_TABS = [
    { id: 'lavadores',  es: 'Lavadores',  en: 'Washers'     },
    { id: 'vendedores', es: 'Vendedores', en: 'Salespeople' },
    { id: 'cajeras',    es: 'Cajeras',    en: 'Cashiers'    },
  ]

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-xl text-[13px] font-semibold bg-red-500 text-white">
          <AlertCircle size={14} />{toast}
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800">{lang === 'es' ? 'Comisiones' : 'Commissions'}</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {lang === 'es' ? 'Calculado sobre base pre-ITBIS. Bebidas y snacks excluidos para lavadores/vendedores.' : 'Calculated on pre-ITBIS base. Beverages excluded for washers/sellers.'}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
              <Download size={13} />
              {lang === 'es' ? 'Exportar CSV' : 'Export CSV'}
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
              <Printer size={13} />
              Imprimir
            </button>
          </div>
        </div>

        {/* Sub-tabs: Lavadores / Vendedores / Cajeras */}
        <div className="flex items-center gap-1 mb-3">
          {SUB_TABS.map(st => (
            <button key={st.id} onClick={() => setSubTab(st.id)}
              className={`px-4 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                subTab === st.id
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}>
              {lang === 'es' ? st.es : st.en}
            </button>
          ))}
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {PILLS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
                period === p.id ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
              }`}>
              {lang === 'es' ? p.es : p.en}
            </button>
          ))}
          <div className="w-px h-5 bg-slate-200 mx-1" />
          <div className="flex items-center gap-2">
            <select value={customM} onChange={e => { setCustomM(+e.target.value); setPeriod('custom') }}
              className="appearance-none pl-3 pr-7 py-1.5 bg-white border border-slate-200 rounded-xl text-[12px] text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer">
              {PAST_MONTHS.map(pm => (
                <option key={`${pm.year}-${pm.month}`} value={pm.month}>{MES_ES[pm.month]}</option>
              ))}
            </select>
            <select value={customY} onChange={e => { setCustomY(+e.target.value); setPeriod('custom') }}
              className="appearance-none pl-3 pr-7 py-1.5 bg-white border border-slate-200 rounded-xl text-[12px] text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer">
              {[...new Set(PAST_MONTHS.map(m => m.year))].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {period === 'custom' && (
              <span className="text-[11px] text-sky-600 font-semibold">
                ← {lang === 'es' ? 'periodo activo' : 'active period'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 px-6 py-4">

        {subTab === 'lavadores' && (
          <CommissionPanel
            lang={lang} period={period} customY={customY} customM={customM}
            people={washers} periodSummaries={washerSummaries} loadingSummary={loadingWS}
            personLabel={lang === 'es' ? 'Lavador' : 'Washer'}
            personLabelAll={lang === 'es' ? 'Todos los lavadores' : 'All washers'}
            metricLabels={{
              total:  lang === 'es' ? 'Total Comisiones'     : 'Total Commissions',
              count:  lang === 'es' ? 'Carros Lavados'       : 'Cars Washed',
              active: lang === 'es' ? 'Lavadores Activos'    : 'Active Washers',
              avg:    lang === 'es' ? 'Promedio por Lavador' : 'Avg per Washer',
            }}
            baseLabel={lang === 'es' ? 'base s/ITBIS' : 'base ex-ITBIS'}
            selectedId={washerId} setSelectedId={setWasherId}
            detailTickets={washerTickets} loadingTickets={loadingWT}
            periodLabel={periodLabel} onExport={handleExport}
          />
        )}

        {subTab === 'vendedores' && (
          <CommissionPanel
            lang={lang} period={period} customY={customY} customM={customM}
            people={sellers} periodSummaries={sellerSummaries} loadingSummary={loadingSS}
            personLabel={lang === 'es' ? 'Vendedor' : 'Salesperson'}
            personLabelAll={lang === 'es' ? 'Todos los vendedores' : 'All salespeople'}
            metricLabels={{
              total:  lang === 'es' ? 'Total Comisiones'       : 'Total Commissions',
              count:  lang === 'es' ? 'Tickets'                : 'Tickets',
              active: lang === 'es' ? 'Vendedores Activos'     : 'Active Salespeople',
              avg:    lang === 'es' ? 'Promedio por Vendedor'  : 'Avg per Salesperson',
            }}
            baseLabel={lang === 'es' ? 'base s/ITBIS' : 'base ex-ITBIS'}
            selectedId={sellerId} setSelectedId={setSellerId}
            detailTickets={sellerTickets} loadingTickets={loadingST}
            periodLabel={periodLabel} onExport={handleExport}
          />
        )}

        {subTab === 'cajeras' && (
          <CommissionPanel
            lang={lang} period={period} customY={customY} customM={customM}
            people={cajeros} periodSummaries={cajeroSummaries} loadingSummary={loadingCS}
            personLabel={lang === 'es' ? 'Cajera' : 'Cashier'}
            personLabelAll={lang === 'es' ? 'Todas las cajeras' : 'All cashiers'}
            metricLabels={{
              total:  lang === 'es' ? 'Total Comisiones'     : 'Total Commissions',
              count:  lang === 'es' ? 'Tickets'              : 'Tickets',
              active: lang === 'es' ? 'Cajeras Activas'      : 'Active Cashiers',
              avg:    lang === 'es' ? 'Promedio por Cajera'  : 'Avg per Cashier',
            }}
            baseLabel={lang === 'es' ? 'base bebidas' : 'beverage base'}
            selectedId={cajeroId} setSelectedId={setCajeroId}
            detailTickets={cajeroTickets} loadingTickets={loadingCT}
            periodLabel={periodLabel} onExport={handleExport}
          />
        )}
      </div>
    </div>
  )
}
