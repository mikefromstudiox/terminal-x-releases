import { useState, useMemo } from 'react'
import { Lock, Download, ChevronRight, Car, CircleDollarSign, Users, BarChart3 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'

// ── Access control ────────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['owner', 'manager', 'cfo', 'accountant']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(d) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })
}

// ── Washer palette ────────────────────────────────────────────────────────────
const PALETTE = [
  { bg: 'bg-sky-100',     text: 'text-sky-700',     bar: 'bg-sky-400'     },
  { bg: 'bg-violet-100',  text: 'text-violet-700',  bar: 'bg-violet-400'  },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-400' },
  { bg: 'bg-rose-100',    text: 'text-rose-700',    bar: 'bg-rose-400'    },
]

// ── Demo data ─────────────────────────────────────────────────────────────────
const WASHERS = [
  { id: 1, name: 'Juan',   pct: 20 },
  { id: 2, name: 'Pedro',  pct: 20 },
  { id: 3, name: 'Carlos', pct: 22 },
  { id: 4, name: 'María',  pct: 18 },
]

const _N = Date.now()
const D  = (daysAgo, h = 10, m = 0) => new Date(_N - daysAgo * 86_400_000 + (h * 3600 + m * 60) * 1000)

// Services: commissionable = wash / extras. false = beverages / snacks excluded from base.
const TICKETS_RAW = [
  // ── Today ──
  { id: 1,  ticketNo: 'T-0850', washerId: 1, vehicle: 'Toyota Hilux Plateada',    client: 'Hotel Mirador del Mar',       date: D(0,14,30), estado: 'cobrado',   services: [{ name:'Full Detailing',price:3500,c:true},{name:'Encerado',price:300,c:true}] },
  { id: 2,  ticketNo: 'T-0849', washerId: 3, vehicle: 'Kia Sportage Gris',         client: 'Walk-in',                     date: D(0,13,15), estado: 'cobrado',   services: [{ name:'Lavado Básico',price:300,c:true},{name:'Agua',price:50,c:false}] },
  { id: 3,  ticketNo: 'T-0848', washerId: 2, vehicle: 'Nissan Sentra Negro',        client: 'Walk-in',                     date: D(0,11,45), estado: 'cobrado',   services: [{ name:'Lavado Completo',price:500,c:true},{name:'Aromatizante',price:100,c:true}] },
  // ── Yesterday ──
  { id: 4,  ticketNo: 'T-0847', washerId: 1, vehicle: 'Toyota Camry Rojo',          client: 'Supermercados La Cadena',     date: D(1,16,20), estado: 'pendiente', services: [{ name:'Lavado Completo',price:500,c:true},{name:'Encerado',price:300,c:true},{name:'Limpia Vidrios',price:50,c:true}] },
  { id: 5,  ticketNo: 'T-0846', washerId: 4, vehicle: 'Honda CR-V Azul',            client: 'Walk-in',                     date: D(1,14,10), estado: 'cobrado',   services: [{ name:'Full Detailing',price:3500,c:true}] },
  { id: 6,  ticketNo: 'T-0845', washerId: 3, vehicle: 'Ford F-150 Plateada',        client: 'Constructora Hernández',      date: D(1,10,30), estado: 'pendiente', services: [{ name:'Lavado Flota × 3',price:900,c:true}] },
  // ── 2 days ago ──
  { id: 7,  ticketNo: 'T-0844', washerId: 2, vehicle: 'Chevrolet Traverse Blanca',  client: 'Walk-in',                     date: D(2,15,50), estado: 'cobrado',   services: [{ name:'Lavado Premium',price:800,c:true},{name:'Silicon Tablero',price:80,c:true}] },
  { id: 8,  ticketNo: 'T-0843', washerId: 1, vehicle: 'Jeep Wrangler Verde',         client: 'Walk-in',                     date: D(2,14,0),  estado: 'cobrado',   services: [{ name:'Tapizado',price:1200,c:true},{name:'Aromatizante',price:100,c:true},{name:'Refresco',price:60,c:false}] },
  { id: 9,  ticketNo: 'T-0842', washerId: 3, vehicle: 'BMW 5 Series Negro',          client: 'Grupo Empresarial Mejía',     date: D(2,11,20), estado: 'pendiente', services: [{ name:'Lavado Premium',price:800,c:true}] },
  { id: 10, ticketNo: 'T-0841', washerId: 4, vehicle: 'Toyota Corolla Rojo',         client: 'Walk-in',                     date: D(2, 9,30), estado: 'cobrado',   services: [{ name:'Lavado Básico',price:300,c:true}] },
  // ── 3 days ago ──
  { id: 11, ticketNo: 'T-0840', washerId: 2, vehicle: 'Hyundai Santa Fe Gris',       client: 'Walk-in',                     date: D(3,14,25), estado: 'cobrado',   services: [{ name:'Lavado Completo',price:500,c:true},{name:'Encerado',price:300,c:true},{name:'Pulido',price:250,c:true}] },
  { id: 12, ticketNo: 'T-0839', washerId: 1, vehicle: 'Mazda CX-5 Azul',             client: 'Walk-in',                     date: D(3,13,0),  estado: 'cobrado',   services: [{ name:'Lavado Interior',price:400,c:true}] },
  { id: 13, ticketNo: 'T-0838', washerId: 4, vehicle: 'Land Rover Defender Negro',   client: 'Hotel Mirador del Mar',       date: D(3,11,10), estado: 'pendiente', services: [{ name:'Lavado Completo',price:500,c:true},{name:'Tapizado',price:1200,c:true}] },
  // ── 5 days ago ──
  { id: 14, ticketNo: 'T-0837', washerId: 3, vehicle: 'Mitsubishi Outlander Blanco', client: 'Walk-in',                     date: D(5,15,0),  estado: 'cobrado',   services: [{ name:'Lavado Básico',price:300,c:true},{name:'Aromatizante',price:100,c:true}] },
  { id: 15, ticketNo: 'T-0836', washerId: 1, vehicle: 'Honda Pilot Gris',             client: 'Farmacia El Alivio',          date: D(5,13,30), estado: 'pendiente', services: [{ name:'Full Detailing',price:3500,c:true},{name:'Encerado',price:300,c:true},{name:'Silicon Tablero',price:80,c:true},{name:'Café',price:80,c:false}] },
  { id: 16, ticketNo: 'T-0835', washerId: 2, vehicle: 'Suzuki Vitara Rojo',           client: 'Walk-in',                     date: D(5,11,0),  estado: 'cobrado',   services: [{ name:'Lavado Completo',price:500,c:true}] },
  { id: 17, ticketNo: 'T-0834', washerId: 4, vehicle: 'Kia Rio Plateado',             client: 'Walk-in',                     date: D(5, 9,45), estado: 'cobrado',   services: [{ name:'Lavado Básico',price:300,c:true}] },
  // ── 10 days ago ──
  { id: 18, ticketNo: 'T-0833', washerId: 3, vehicle: 'Toyota Prado Negro',           client: 'Constructora Hernández',      date: D(10,14,0), estado: 'cobrado',   services: [{ name:'Full Detailing',price:3500,c:true},{name:'Pulido',price:250,c:true}] },
  { id: 19, ticketNo: 'T-0832', washerId: 1, vehicle: 'Volvo XC90 Blanco',            client: 'Walk-in',                     date: D(10,12,0), estado: 'cobrado',   services: [{ name:'Lavado Premium',price:800,c:true},{name:'Silicon Tablero',price:80,c:true}] },
  { id: 20, ticketNo: 'T-0831', washerId: 2, vehicle: 'Ford Explorer Azul',           client: 'Walk-in',                     date: D(10,10,30),estado: 'cobrado',   services: [{ name:'Lavado Completo',price:500,c:true},{name:'Aromatizante',price:100,c:true}] },
  { id: 21, ticketNo: 'T-0830', washerId: 4, vehicle: 'Audi A4 Gris',                 client: 'Walk-in',                     date: D(10, 9,15),estado: 'cobrado',   services: [{ name:'Full Detailing',price:3500,c:true},{name:'Encerado',price:300,c:true},{name:'Cera Carnauba',price:150,c:true}] },
  // ── 15 days ago ──
  { id: 22, ticketNo: 'T-0829', washerId: 1, vehicle: 'Jeep Cherokee Verde',          client: 'Walk-in',                     date: D(15,14,0), estado: 'cobrado',   services: [{ name:'Tapizado',price:1200,c:true},{name:'Aromatizante',price:100,c:true}] },
  { id: 23, ticketNo: 'T-0828', washerId: 2, vehicle: 'Honda CRV Rojo',               client: 'Walk-in',                     date: D(15,12,30),estado: 'cobrado',   services: [{ name:'Lavado Premium',price:800,c:true}] },
  { id: 24, ticketNo: 'T-0827', washerId: 3, vehicle: 'Toyota RAV4 Plateado',         client: 'Walk-in',                     date: D(15,11,0), estado: 'cobrado',   services: [{ name:'Lavado Completo',price:500,c:true},{name:'Limpia Vidrios',price:50,c:true}] },
  { id: 25, ticketNo: 'T-0826', washerId: 4, vehicle: 'Mercedes GLA Azul',            client: 'Walk-in',                     date: D(15, 9,30),estado: 'cobrado',   services: [{ name:'Full Detailing',price:3500,c:true},{name:'Encerado',price:300,c:true}] },
]

// ── Computed ticket fields ────────────────────────────────────────────────────
const TICKETS = TICKETS_RAW.map(t => {
  const washer       = WASHERS.find(w => w.id === t.washerId)
  const commBase     = t.services.filter(s => s.c).reduce((s, x) => s + x.price, 0)
  const subtotal     = t.services.reduce((s, x) => s + x.price, 0)
  const total        = subtotal * 1.28                         // × 1.28 = +18% ITBIS +10% Ley
  const commission   = commBase * (washer?.pct ?? 0) / 100
  const mainService  = t.services.find(s => s.c) ?? t.services[0]
  return { ...t, washer, commBase, subtotal, total, commission, pct: washer?.pct ?? 0, mainService }
})

// ── Date period filter ────────────────────────────────────────────────────────
const TODAY    = new Date()
const CUR_Y    = TODAY.getFullYear()
const CUR_M    = TODAY.getMonth()

function inPeriod(date, period, cy, cm) {
  const d   = new Date(date)
  const now = new Date()
  const t0  = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'hoy')   return d >= t0
  if (period === 'semana') {
    const mon = new Date(t0)
    mon.setDate(mon.getDate() - (mon.getDay() === 0 ? 6 : mon.getDay() - 1))
    return d >= mon
  }
  if (period === 'mes')    return d >= new Date(now.getFullYear(), now.getMonth(), 1)
  if (period === 'custom') return d >= new Date(cy, cm, 1) && d < new Date(cy, cm + 1, 1)
  return true
}

// ── Past 12 months for dropdown ───────────────────────────────────────────────
const MES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const PAST_MONTHS = Array.from({ length: 12 }, (_, i) => {
  let m = CUR_M - i, y = CUR_Y
  while (m < 0) { m += 12; y-- }
  return { year: y, month: m }
})

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(tickets, washerName, period) {
  const rows = [
    [`Comisiones — ${washerName} — ${period}`], [],
    ['#Ticket','Vehículo','Servicio','Total','Base s/ITBIS','%','Comisión','Estado'],
    ...tickets.map(t => [
      t.ticketNo, t.vehicle, t.mainService.name,
      t.total.toFixed(2), t.commBase.toFixed(2), `${t.pct}%`, t.commission.toFixed(2), t.estado,
    ]),
    [],
    ['','','TOTALES',
      tickets.reduce((s, t) => s + t.total,      0).toFixed(2),
      tickets.reduce((s, t) => s + t.commBase,   0).toFixed(2), '',
      tickets.reduce((s, t) => s + t.commission, 0).toFixed(2), '',
    ],
  ]
  const csv  = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `comisiones-${washerName.toLowerCase()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, sub, accent }) {
  const a = { sky:'bg-sky-50 text-sky-600 border-sky-100', green:'bg-green-50 text-green-600 border-green-100', violet:'bg-violet-50 text-violet-600 border-violet-100', slate:'bg-slate-100 text-slate-600 border-slate-200' }
  return (
    <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-5 py-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${a[accent]} mb-3`}>
        <Icon size={16} />
      </div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-[21px] font-bold text-slate-800 leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function EstadoBadge({ estado, lang }) {
  return estado === 'cobrado'
    ? <span className="text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">{lang === 'es' ? 'Cobrado' : 'Collected'}</span>
    : <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">{lang === 'es' ? 'Pendiente' : 'Pending'}</span>
}

// Column definition — shared between header and rows
const COLS = [
  { es: '#',            en: '#',              cls: 'w-[80px] shrink-0'           },
  { es: 'Cliente / Vehículo', en: 'Client / Vehicle', cls: 'flex-1 min-w-0'    },
  { es: 'Servicio',     en: 'Service',        cls: 'w-[148px] shrink-0'         },
  { es: 'Total Ticket', en: 'Ticket Total',   cls: 'w-[100px] shrink-0 text-right' },
  { es: 'Base s/ITBIS', en: 'Base ex-ITBIS',  cls: 'w-[104px] shrink-0 text-right' },
  { es: '%',            en: '%',              cls: 'w-[48px]  shrink-0 text-center' },
  { es: 'Comisión',     en: 'Commission',     cls: 'w-[100px] shrink-0 text-right' },
  { es: 'Estado',       en: 'Status',         cls: 'w-[100px] shrink-0'         },
]

// ── Individual washer ticket table ────────────────────────────────────────────
function WasherTicketTable({ tickets, washerName, lang }) {
  const totalTickets    = tickets.reduce((s, t) => s + t.total,      0)
  const totalBase       = tickets.reduce((s, t) => s + t.commBase,   0)
  const totalCommission = tickets.reduce((s, t) => s + t.commission, 0)

  if (!tickets.length) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-300 text-[13px]">
        {lang === 'es' ? 'Sin tickets en este período' : 'No tickets in this period'}
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Column headers */}
      <div className="flex items-center h-9 bg-slate-50 border-b border-slate-200 px-5 shrink-0">
        {COLS.map((col, i) => (
          <div key={i} className={`${col.cls} text-[10px] font-bold text-slate-400 uppercase tracking-wider pr-3`}>
            {lang === 'es' ? col.es : col.en}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {tickets.map(t => (
          <div key={t.id} className="flex items-center h-14 border-b border-slate-100 px-5 hover:bg-slate-50/60 transition-colors">
            {/* # */}
            <div className="w-[80px] shrink-0 pr-3">
              <span className="text-[13px] font-bold text-sky-600">{t.ticketNo}</span>
              <p className="text-[10px] text-slate-400">{fmtDate(t.date)}</p>
            </div>
            {/* Client / Vehicle */}
            <div className="flex-1 min-w-0 pr-3">
              <p className="text-[12px] font-semibold text-slate-800 truncate">{t.vehicle}</p>
              <p className="text-[11px] text-slate-400 truncate">{t.client}</p>
            </div>
            {/* Service */}
            <div className="w-[148px] shrink-0 pr-3">
              <span className="text-[12px] text-slate-700 truncate block">{t.mainService.name}</span>
              {t.services.some(s => !s.c) && (
                <span className="text-[10px] text-slate-400">
                  {lang === 'es' ? '(bebidas excluidas)' : '(beverages excluded)'}
                </span>
              )}
            </div>
            {/* Ticket Total */}
            <div className="w-[100px] shrink-0 pr-3 text-right">
              <span className="text-[12px] font-semibold text-slate-700">{fmtRD(t.total)}</span>
            </div>
            {/* Base s/ITBIS */}
            <div className="w-[104px] shrink-0 pr-3 text-right">
              <span className="text-[12px] font-semibold text-emerald-700">{fmtRD(t.commBase)}</span>
            </div>
            {/* % */}
            <div className="w-[48px] shrink-0 pr-3 text-center">
              <span className="text-[12px] text-slate-500">{t.pct}%</span>
            </div>
            {/* Commission */}
            <div className="w-[100px] shrink-0 pr-3 text-right">
              <span className="text-[13px] font-bold text-sky-700">{fmtRD(t.commission)}</span>
            </div>
            {/* Estado */}
            <div className="w-[100px] shrink-0">
              <EstadoBadge estado={t.estado} lang={lang} />
            </div>
          </div>
        ))}
      </div>

      {/* Totals footer */}
      <div className="shrink-0 flex items-center h-11 border-t-2 border-slate-200 bg-slate-50 px-5">
        <div className="w-[80px] shrink-0 pr-3">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            {tickets.length} {lang === 'es' ? 'tickets' : 'tickets'}
          </span>
        </div>
        <div className="flex-1 min-w-0 pr-3" />
        <div className="w-[148px] shrink-0 pr-3" />
        <div className="w-[100px] shrink-0 pr-3 text-right">
          <span className="text-[12px] font-bold text-slate-700">{fmtRD(totalTickets)}</span>
        </div>
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

// ── Access denied ─────────────────────────────────────────────────────────────
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
            ? 'Solo gerentes, dueños, contadores y CFO pueden ver las comisiones.'
            : 'Only managers, owners, accountants, and CFO can view commissions.'}
        </p>
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function WorkerReport() {
  const { user }  = useAuth()
  const { lang }  = useLang()

  const [period,     setPeriod]     = useState('mes')      // 'hoy'|'semana'|'mes'|'custom'
  const [customY,    setCustomY]    = useState(CUR_Y)
  const [customM,    setCustomM]    = useState(CUR_M)
  const [washerId,   setWasherId]   = useState('all')      // 'all' | washer id

  if (!ALLOWED_ROLES.includes(user?.role)) return <AccessDenied lang={lang} />

  // Filtered tickets
  const periodTickets = useMemo(() =>
    TICKETS.filter(t => inPeriod(t.date, period, customY, customM))
  , [period, customY, customM])

  const visibleTickets = useMemo(() =>
    washerId === 'all'
      ? periodTickets
      : periodTickets.filter(t => t.washerId === +washerId)
  , [periodTickets, washerId])

  // Summary metrics
  const summary = useMemo(() => {
    const totalCommission = periodTickets.reduce((s, t) => s + t.commission, 0)
    const totalCars       = periodTickets.length
    const activeWashers   = new Set(periodTickets.map(t => t.washerId)).size
    const avgCommission   = activeWashers > 0 ? totalCommission / activeWashers : 0
    return { totalCommission, totalCars, activeWashers, avgCommission }
  }, [periodTickets])

  // Per-washer aggregates (for the summary strip)
  const washerSummaries = useMemo(() =>
    WASHERS.map((w, i) => {
      const wt = periodTickets.filter(t => t.washerId === w.id)
      return {
        ...w,
        palette:    PALETTE[i % PALETTE.length],
        cars:       wt.length,
        commission: wt.reduce((s, t) => s + t.commission, 0),
        commBase:   wt.reduce((s, t) => s + t.commBase, 0),
        total:      wt.reduce((s, t) => s + t.total, 0),
      }
    })
  , [periodTickets])

  // Individual washer summary cards
  const selectedWasher    = WASHERS.find(w => w.id === +washerId)
  const selectedPalette   = selectedWasher ? PALETTE[WASHERS.indexOf(selectedWasher) % PALETTE.length] : null
  const selectedSummary   = washerSummaries.find(w => w.id === +washerId)

  // Period label for export
  const periodLabel = period === 'hoy'    ? (lang === 'es' ? 'Hoy'          : 'Today')
                    : period === 'semana' ? (lang === 'es' ? 'Esta semana'  : 'This week')
                    : period === 'mes'    ? (lang === 'es' ? 'Este mes'     : 'This month')
                    : `${MES_ES[customM]} ${customY}`

  function handleExport() {
    if (washerId === 'all') {
      WASHERS.forEach(w => {
        const wt = periodTickets.filter(t => t.washerId === w.id)
        if (wt.length > 0) exportCSV(wt, w.name, periodLabel)
      })
    } else {
      exportCSV(visibleTickets, selectedWasher?.name ?? 'Lavador', periodLabel)
    }
  }

  const PILLS = [
    { id: 'hoy',    es: 'Hoy',           en: 'Today'      },
    { id: 'semana', es: 'Esta semana',   en: 'This week'  },
    { id: 'mes',    es: 'Este mes',      en: 'This month' },
  ]

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[16px] font-bold text-slate-800">{lang === 'es' ? 'Comisiones' : 'Commissions'}</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {lang === 'es' ? 'Calculado sobre base pre-ITBIS. Bebidas y snacks excluidos.' : 'Calculated on pre-ITBIS base. Beverages and snacks excluded.'}
            </p>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Download size={13} />
            {lang === 'es' ? 'Exportar CSV' : 'Export CSV'}
          </button>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick pills */}
          {PILLS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
                period === p.id
                  ? 'bg-slate-800 border-slate-800 text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
              }`}
            >
              {lang === 'es' ? p.es : p.en}
            </button>
          ))}

          {/* Divider */}
          <div className="w-px h-5 bg-slate-200 mx-1" />

          {/* Month/year dropdowns */}
          <div className="flex items-center gap-2">
            <select
              value={customM}
              onChange={e => { setCustomM(+e.target.value); setPeriod('custom') }}
              className="appearance-none pl-3 pr-7 py-1.5 bg-white border border-slate-200 rounded-xl text-[12px] text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              {PAST_MONTHS.map(pm => (
                <option key={`${pm.year}-${pm.month}`} value={pm.month}>{MES_ES[pm.month]}</option>
              ))}
            </select>
            <select
              value={customY}
              onChange={e => { setCustomY(+e.target.value); setPeriod('custom') }}
              className="appearance-none pl-3 pr-7 py-1.5 bg-white border border-slate-200 rounded-xl text-[12px] text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              {[...new Set(PAST_MONTHS.map(m => m.year))].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {period === 'custom' && (
              <span className="text-[11px] text-sky-600 font-semibold">
                ← {lang === 'es' ? 'período activo' : 'active period'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Scrollable content ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 px-6 py-4">

        {/* ── Summary cards ───────────────────────────────────────────────── */}
        <div className="flex gap-3">
          <MetricCard icon={CircleDollarSign} label={lang === 'es' ? 'Total Comisiones'    : 'Total Commissions'}     value={fmtRD(summary.totalCommission)} accent="sky"    />
          <MetricCard icon={Car}              label={lang === 'es' ? 'Carros Lavados'      : 'Cars Washed'}           value={summary.totalCars}              accent="green"  />
          <MetricCard icon={Users}            label={lang === 'es' ? 'Lavadores Activos'   : 'Active Washers'}        value={summary.activeWashers}          accent="violet" />
          <MetricCard icon={BarChart3}        label={lang === 'es' ? 'Promedio por Lavador': 'Avg per Washer'}        value={fmtRD(summary.avgCommission)}   accent="slate"  />
        </div>

        {/* ── Washer selector + all-washers strip ─────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {/* Selector header */}
          <div className="flex items-center gap-4 px-5 py-3.5 border-b border-slate-100">
            <p className="text-[12px] font-bold text-slate-500 shrink-0">
              {lang === 'es' ? 'Lavador' : 'Washer'}
            </p>
            <div className="relative">
              <select
                value={washerId}
                onChange={e => setWasherId(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-semibold text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all">{lang === 'es' ? 'Todos los lavadores' : 'All washers'}</option>
                {WASHERS.map(w => (
                  <option key={w.id} value={w.id}>{w.name} ({w.pct}%)</option>
                ))}
              </select>
              <ChevronRight size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none rotate-90" />
            </div>
            {washerId !== 'all' && selectedWasher && (
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${selectedPalette?.bg} ${selectedPalette?.text}`}>
                {selectedWasher.pct}% {lang === 'es' ? 'comisión' : 'commission'}
              </span>
            )}
          </div>

          {/* All washers summary strip */}
          {washerId === 'all' && (
            <div>
              {washerSummaries.map((w, i) => {
                const maxComm = Math.max(...washerSummaries.map(x => x.commission), 1)
                return (
                  <button
                    key={w.id}
                    onClick={() => setWasherId(String(w.id))}
                    className="w-full flex items-center gap-4 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-colors text-left last:border-0 group"
                  >
                    {/* Avatar */}
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${w.palette.bg} ${w.palette.text}`}>
                      {w.name.slice(0, 2).toUpperCase()}
                    </div>
                    {/* Name + % */}
                    <div className="w-[120px] shrink-0">
                      <p className="text-[13px] font-bold text-slate-800">{w.name}</p>
                      <p className="text-[11px] text-slate-400">{w.pct}% {lang === 'es' ? 'comisión' : 'commission'}</p>
                    </div>
                    {/* Cars */}
                    <div className="w-[80px] shrink-0 text-center">
                      <p className="text-[15px] font-bold text-slate-700">{w.cars}</p>
                      <p className="text-[10px] text-slate-400">{lang === 'es' ? 'carros' : 'cars'}</p>
                    </div>
                    {/* Base */}
                    <div className="w-[120px] shrink-0 text-right">
                      <p className="text-[12px] font-semibold text-emerald-700">{fmtRD(w.commBase)}</p>
                      <p className="text-[10px] text-slate-400">{lang === 'es' ? 'base s/ITBIS' : 'base ex-ITBIS'}</p>
                    </div>
                    {/* Commission + bar */}
                    <div className="flex-1 flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${w.palette.bar} rounded-full transition-all duration-500`}
                          style={{ width: `${(w.commission / maxComm) * 100}%` }}
                        />
                      </div>
                      <span className="text-[14px] font-bold text-sky-700 w-[110px] text-right shrink-0">{fmtRD(w.commission)}</span>
                    </div>
                    {/* Drill arrow */}
                    <ChevronRight size={14} className="text-slate-300 group-hover:text-sky-500 transition-colors shrink-0" />
                  </button>
                )
              })}
              {/* Grand total */}
              <div className="flex items-center gap-4 px-5 py-3 bg-slate-50 border-t border-slate-200">
                <div className="w-9 shrink-0" />
                <div className="w-[120px] shrink-0">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Total</p>
                </div>
                <div className="w-[80px] shrink-0 text-center">
                  <p className="text-[14px] font-bold text-slate-700">{summary.totalCars}</p>
                </div>
                <div className="w-[120px] shrink-0 text-right">
                  <p className="text-[12px] font-bold text-emerald-700">{fmtRD(washerSummaries.reduce((s, w) => s + w.commBase, 0))}</p>
                </div>
                <div className="flex-1 text-right">
                  <p className="text-[15px] font-bold text-sky-700">{fmtRD(summary.totalCommission)}</p>
                </div>
                <div className="w-5 shrink-0" />
              </div>
            </div>
          )}

          {/* Individual washer — summary cards */}
          {washerId !== 'all' && selectedSummary && (
            <div className="flex gap-3 px-5 py-4 border-b border-slate-100">
              {[
                { label_es:'Carros lavados',    label_en:'Cars washed',       value: selectedSummary.cars },
                { label_es:'Total facturado',   label_en:'Total billed',      value: fmtRD(selectedSummary.total) },
                { label_es:'Base s/ITBIS',      label_en:'Base ex-ITBIS',     value: fmtRD(selectedSummary.commBase) },
                { label_es:'Comisión ganada',   label_en:'Commission earned', value: fmtRD(selectedSummary.commission) },
              ].map((card, i) => (
                <div key={i} className={`flex-1 rounded-xl px-4 py-3 ${i === 3 ? 'bg-sky-50 border border-sky-100' : 'bg-slate-50 border border-slate-200'}`}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {lang === 'es' ? card.label_es : card.label_en}
                  </p>
                  <p className={`text-[18px] font-bold mt-0.5 ${i === 3 ? 'text-sky-700' : 'text-slate-800'}`}>
                    {card.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Ticket table (individual washer) ────────────────────────────── */}
        {washerId !== 'all' && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: 320 }}>
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <p className="text-[12px] font-bold text-slate-700">
                {lang === 'es' ? 'Tickets del período' : 'Period tickets'}
                <span className="ml-2 text-[11px] font-normal text-slate-400">· {periodLabel}</span>
              </p>
              <p className="text-[11px] text-amber-600 font-medium">
                {lang === 'es'
                  ? '⚠ Comisión calculada sobre base pre-ITBIS'
                  : '⚠ Commission on pre-ITBIS base only'}
              </p>
            </div>
            <WasherTicketTable tickets={visibleTickets} washerName={selectedWasher?.name ?? ''} lang={lang} />
          </div>
        )}
      </div>
    </div>
  )
}
