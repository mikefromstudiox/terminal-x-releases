import { useState, useMemo, useEffect } from 'react'
import { Lock, Download, Printer, ChevronRight, TrendingUp, CircleDollarSign, Users, BarChart3 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { exportSellerDetail, exportSellerSummary } from '@terminal-x/services/csv'
import { printCommissionDetail, printCommissionSummary } from '@terminal-x/services/report-html'

// ── Access control ────────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['owner', 'manager', 'cfo', 'accountant']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })
}

// ── Seller palette ────────────────────────────────────────────────────────────
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

  if (period === 'hoy') {
    return { from: todayStr, to: tomorrowStr }
  }
  if (period === 'semana') {
    const mon = new Date(now)
    const day = mon.getDay()
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

// ── Past 12 months for dropdown ───────────────────────────────────────────────
const TODAY_OBJ = new Date()
const CUR_Y     = TODAY_OBJ.getFullYear()
const CUR_M     = TODAY_OBJ.getMonth()
const MES_ES    = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const PAST_MONTHS = Array.from({ length: 12 }, (_, i) => {
  let m = CUR_M - i, y = CUR_Y
  while (m < 0) { m += 12; y-- }
  return { year: y, month: m }
})

// ── CSV export (now uses shared professional utility) ─────────────────────────

// ── Sub-components ────────────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, sub, accent }) {
  const a = {
    sky:    'bg-sky-50 text-sky-600 border-sky-100',
    green:  'bg-green-50 text-green-600 border-green-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    slate:  'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <div className="flex-1 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${a[accent]} mb-3`}>
        <Icon size={16} />
      </div>
      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{label}</p>
      <p className="text-[21px] font-bold text-slate-800 dark:text-white leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Ticket table for an individual seller ────────────────────────────────────
const TICKET_COLS = [
  { es: '#',            en: '#',              cls: 'w-[100px] shrink-0'          },
  { es: 'Cliente',      en: 'Client',         cls: 'flex-1 min-w-0'             },
  { es: 'Vehículo',     en: 'Vehicle',        cls: 'w-[120px] shrink-0'         },
  { es: 'Subtotal',     en: 'Subtotal',       cls: 'w-[110px] shrink-0 text-right' },
  { es: '%',            en: '%',              cls: 'w-[48px]  shrink-0 text-center' },
  { es: 'Comisión',     en: 'Commission',     cls: 'w-[110px] shrink-0 text-right' },
  { es: 'Estado',       en: 'Status',         cls: 'w-[100px] shrink-0'         },
]

function SellerTicketTable({ tickets, lang, loading }) {
  const L = (es, en) => lang === 'es' ? es : en
  const totalBase       = tickets.reduce((s, t) => s + t.commBase,   0)
  const totalCommission = tickets.reduce((s, t) => s + t.commission, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-300 dark:text-white/30 gap-3">
        <div className="w-5 h-5 border-2 border-slate-200 dark:border-white/10 border-t-sky-500 rounded-full animate-spin" />
        <span className="text-[13px]">{L('Cargando tickets…', 'Loading tickets…')}</span>
      </div>
    )
  }

  if (!tickets.length) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-300 dark:text-white/30 text-[13px]">
        {L('Sin tickets en este período', 'No tickets in this period')}
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Column headers */}
      <div className="flex items-center h-9 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-5 shrink-0">
        {TICKET_COLS.map((col, i) => (
          <div key={i} className={`${col.cls} text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider pr-3`}>
            {L(col.es, col.en)}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {tickets.map(t => (
          <div key={t.id} className="flex items-center h-14 border-b border-slate-100 dark:border-white/10 px-5 hover:bg-slate-50/60 dark:hover:bg-white/5 transition-colors">
            <div className="w-[100px] shrink-0 pr-3">
              <span className="text-[13px] font-bold text-sky-600">{t.doc_number}</span>
              <p className="text-[10px] text-slate-400 dark:text-white/40">{fmtDate(t.created_at)}</p>
            </div>
            <div className="flex-1 min-w-0 pr-3">
              <p className="text-[12px] font-semibold text-slate-800 dark:text-white truncate">{t.client_name || '—'}</p>
              <p className="text-[11px] text-slate-400 dark:text-white/40 truncate">{t.cajero_name || '—'}</p>
            </div>
            <div className="w-[120px] shrink-0 pr-3">
              <span className="text-[12px] text-slate-700 dark:text-white truncate block">{t.vehicle_plate || '—'}</span>
            </div>
            <div className="w-[110px] shrink-0 pr-3 text-right">
              <span className="text-[12px] font-semibold text-emerald-700">{fmtRD(t.commBase)}</span>
            </div>
            <div className="w-[48px] shrink-0 pr-3 text-center">
              <span className="text-[12px] text-slate-500 dark:text-white/60">{t.pct}%</span>
            </div>
            <div className="w-[110px] shrink-0 pr-3 text-right">
              <span className="text-[13px] font-bold text-sky-700">{fmtRD(t.commission)}</span>
            </div>
            <div className="w-[100px] shrink-0">
              <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
                t.status === 'cobrado'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : t.status === 'void'
                  ? 'bg-slate-100 text-slate-400 border border-slate-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
                {t.status === 'cobrado'  ? L('Cobrado',  'Collected')
                 : t.status === 'void'   ? L('Anulado',  'Voided')
                 : L('Pendiente', 'Pending')}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Totals footer */}
      <div className="shrink-0 flex items-center h-11 border-t-2 border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-5">
        <div className="w-[100px] shrink-0 pr-3">
          <span className="text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wide">
            {tickets.length} {L('tickets', 'tickets')}
          </span>
        </div>
        <div className="flex-1 min-w-0 pr-3" />
        <div className="w-[120px] shrink-0 pr-3" />
        <div className="w-[110px] shrink-0 pr-3 text-right">
          <span className="text-[12px] font-bold text-emerald-700">{fmtRD(totalBase)}</span>
        </div>
        <div className="w-[48px] shrink-0 pr-3" />
        <div className="w-[110px] shrink-0 pr-3 text-right">
          <span className="text-[14px] font-bold text-sky-700">{fmtRD(totalCommission)}</span>
        </div>
        <div className="w-[100px] shrink-0" />
      </div>
    </div>
  )
}

// ── Access denied ─────────────────────────────────────────────────────────────
function AccessDenied({ lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400 dark:text-white/40 bg-slate-50 dark:bg-black">
      <div className="w-16 h-16 bg-slate-100 dark:bg-white/10 rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-slate-300 dark:text-white/30" />
      </div>
      <div className="text-center">
        <p className="text-[15px] font-bold text-slate-600 dark:text-white/60 mb-1">
          {L('Acceso Restringido', 'Restricted Access')}
        </p>
        <p className="text-[12px] text-slate-400 dark:text-white/40 max-w-[260px]">
          {L(
            'Solo gerentes, dueños, contadores y CFO pueden ver las comisiones de vendedores.',
            'Only managers, owners, accountants, and CFO can view salesperson commissions.'
          )}
        </p>
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SalespersonReport() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [period,         setPeriod]         = useState('mes')
  const [customY,        setCustomY]        = useState(CUR_Y)
  const [customM,        setCustomM]        = useState(CUR_M)
  const [sellerId,       setSellerId]       = useState('all')

  // DB data
  const [sellers,        setSellers]        = useState([])
  const [tickets,        setTickets]        = useState([])
  const [loadingTickets, setLoadingTickets] = useState(false)
  const [biz,            setBiz]            = useState({})

  const allowed = ALLOWED_ROLES.includes(user?.role)

  // Load sellers + biz once on mount
  useEffect(() => {
    if (!allowed) return
    // Post-v2.1 canonical source: empleados table, filtered by tipo (vendedor/hybrid).
    // Map commission_pct <- comision_pct so existing UI keeps working.
    api.empleados?.allAdmin?.()
      .then(rows => {
        const filtered = (rows || [])
          .filter(e => e.tipo === 'vendedor' || e.tipo === 'hybrid')
          .map(e => ({
            id: e.id,
            supabase_id: e.supabase_id,
            name: e.nombre,
            commission_pct: e.comision_pct || 0,
            tipo: e.tipo,
          }))
        setSellers(filtered)
      })
      .catch(() => setSellers([]))
    api.admin?.getEmpresa?.().then(e => {
      if (e) setBiz({ name: e.name || e.nombre, rnc: e.rnc, address: e.address || e.direccion, phone: e.phone || e.telefono, email: e.email, logo: e.logo })
    }).catch(() => {})
  }, [])

  // Load tickets when period changes
  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    setLoadingTickets(true)
    setSellerId('all')
    const range = getDateRange(period, customY, customM)
    api.tickets.byDateRange(range)
      .then(rows => { if (!cancelled) setTickets(rows || []) })
      .catch(() => { if (!cancelled) setTickets([]) })
      .finally(() => { if (!cancelled) setLoadingTickets(false) })
    return () => { cancelled = true }
  }, [period, customY, customM])

  // ── Group tickets by seller ──────────────────────────────────────────────
  const sellerSummaries = useMemo(() => {
    // Index sellers (empleados-sourced) by supabase_id and legacy id for
    // dual-key lookup during the v2.1 schema transition.
    const sellerBySid = Object.fromEntries(sellers.filter(s => s.supabase_id).map(s => [s.supabase_id, s]))
    const sellerById  = Object.fromEntries(sellers.map(s => [s.id, s]))

    // Group tickets by empleado_supabase_id first; fall back to seller_supabase_id,
    // then legacy seller_id, and finally cajero_name when no linkage exists.
    const groups = {}
    for (const t of tickets) {
      if (t.status === 'void') continue  // skip voided
      const empSid = t.empleado_supabase_id ?? t.seller_supabase_id ?? null
      const legacyId = empSid == null ? (t.seller_id ?? null) : null
      const key = empSid != null ? `sid:${empSid}`
                : legacyId != null ? `id:${legacyId}`
                : `name:${t.cajero_name || 'Sin asignar'}`
      if (!groups[key]) {
        const seller = empSid != null
          ? (sellerBySid[empSid] || null)
          : (legacyId != null ? (sellerById[legacyId] || null) : null)
        groups[key] = {
          key,
          sellerId:      seller?.id ?? legacyId,
          supabaseId:    seller?.supabase_id ?? empSid,
          name:          seller?.name ?? t.cajero_name ?? L('Sin asignar', 'Unassigned'),
          commissionPct: seller?.commission_pct ?? 0,
          tickets:       [],
        }
      }
      groups[key].tickets.push(t)
    }

    // Compute totals per seller
    return Object.values(groups).map((g, i) => {
      const totalBilled = g.tickets.reduce((s, t) => s + (t.subtotal || 0), 0)
      // commission base = subtotal (pre-ITBIS, pre-Ley). Subtotal in DB is already net of discounts.
      const commBase    = totalBilled
      const commission  = parseFloat((commBase * g.commissionPct / 100).toFixed(2))
      return {
        ...g,
        totalBilled,
        commBase,
        commission,
        ticketCount: g.tickets.length,
        palette:     PALETTE[i % PALETTE.length],
      }
    }).sort((a, b) => b.commission - a.commission)
  }, [tickets, sellers, lang])

  // Selected seller's tickets — enriched with commission data
  const selectedSummary = sellerId === 'all'
    ? null
    : sellerSummaries.find(s => s.key === sellerId) ?? null

  const selectedTickets = useMemo(() => {
    if (!selectedSummary) return []
    return selectedSummary.tickets.map(t => ({
      ...t,
      commBase:   t.subtotal || 0,
      commission: parseFloat(((t.subtotal || 0) * selectedSummary.commissionPct / 100).toFixed(2)),
      pct:        selectedSummary.commissionPct,
    }))
  }, [selectedSummary])

  // Summary metrics
  const summary = useMemo(() => {
    const totalCommission  = sellerSummaries.reduce((s, g) => s + g.commission, 0)
    const totalBilled      = sellerSummaries.reduce((s, g) => s + g.totalBilled, 0)
    const totalTickets     = sellerSummaries.reduce((s, g) => s + g.ticketCount, 0)
    const activeSellers    = sellerSummaries.length
    return { totalCommission, totalBilled, totalTickets, activeSellers }
  }, [sellerSummaries])

  // Period label for export
  const periodLabel = period === 'hoy'    ? L('Hoy',         'Today')
                    : period === 'semana' ? L('Esta semana', 'This week')
                    : period === 'mes'    ? L('Este mes',    'This month')
                    : `${MES_ES[customM]} ${customY}`

  function handleExport() {
    if (sellerId === 'all') {
      exportSellerSummary(biz, sellerSummaries, periodLabel)
    } else {
      exportSellerDetail(biz, selectedTickets, selectedSummary?.name ?? 'Vendedor', selectedSummary?.commissionPct || 0, periodLabel)
    }
  }

  function handlePrint() {
    if (sellerId === 'all') {
      printCommissionSummary(biz, sellerSummaries, 'Vendedores', periodLabel)
    } else {
      printCommissionDetail(biz, selectedTickets, selectedSummary?.name ?? 'Vendedor', selectedSummary?.commissionPct || 0, periodLabel)
    }
  }

  const PILLS = [
    { id: 'hoy',    es: 'Hoy',          en: 'Today'      },
    { id: 'semana', es: 'Esta semana',  en: 'This week'  },
    { id: 'mes',    es: 'Este mes',     en: 'This month' },
  ]

  if (!allowed) return <AccessDenied lang={lang} />

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
              {L('Comisiones de Vendedores', 'Salesperson Commissions')}
            </h2>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
              {L('Calculado sobre subtotal del ticket (pre-ITBIS/Ley).', 'Calculated on ticket subtotal (pre-ITBIS/Ley).')}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
            >
              <Download size={13} />
              {L('Exportar CSV', 'Export CSV')}
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
            >
              <Printer size={13} />
              Imprimir
            </button>
          </div>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {PILLS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
                period === p.id
                  ? 'bg-slate-800 border-slate-800 text-white'
                  : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:border-slate-400 dark:hover:border-white/30'
              }`}
            >
              {L(p.es, p.en)}
            </button>
          ))}

          <div className="w-px h-5 bg-slate-200 dark:bg-white/10 mx-1" />

          <div className="flex items-center gap-2">
            <select
              value={customM}
              onChange={e => { setCustomM(+e.target.value); setPeriod('custom') }}
              className="appearance-none pl-3 pr-7 py-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              {PAST_MONTHS.map(pm => (
                <option key={`${pm.year}-${pm.month}`} value={pm.month}>{MES_ES[pm.month]}</option>
              ))}
            </select>
            <select
              value={customY}
              onChange={e => { setCustomY(+e.target.value); setPeriod('custom') }}
              className="appearance-none pl-3 pr-7 py-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              {[...new Set(PAST_MONTHS.map(m => m.year))].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {period === 'custom' && (
              <span className="text-[11px] text-sky-600 font-semibold">
                ← {L('período activo', 'active period')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Scrollable content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 px-6 py-4">

        {/* ── Summary cards ─────────────────────────────────────────────────── */}
        <div className="flex gap-3">
          <MetricCard
            icon={CircleDollarSign}
            label={L('Total Comisiones', 'Total Commissions')}
            value={fmtRD(summary.totalCommission)}
            accent="sky"
          />
          <MetricCard
            icon={TrendingUp}
            label={L('Total Facturado', 'Total Billed')}
            value={fmtRD(summary.totalBilled)}
            accent="green"
          />
          <MetricCard
            icon={BarChart3}
            label={L('Total Tickets', 'Total Tickets')}
            value={summary.totalTickets}
            accent="violet"
          />
          <MetricCard
            icon={Users}
            label={L('Vendedores Activos', 'Active Salespersons')}
            value={summary.activeSellers}
            accent="slate"
          />
        </div>

        {/* ── Seller selector + summary strip ───────────────────────────────── */}
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
          {/* Selector header */}
          <div className="flex items-center gap-4 px-5 py-3.5 border-b border-slate-100 dark:border-white/10">
            <p className="text-[12px] font-bold text-slate-500 dark:text-white/60 shrink-0">
              {L('Vendedor', 'Salesperson')}
            </p>
            <div className="relative">
              <select
                value={sellerId}
                onChange={e => setSellerId(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] font-semibold text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all">{L('Todos los vendedores', 'All salespersons')}</option>
                {sellerSummaries.map(g => (
                  <option key={g.key} value={g.key}>
                    {g.name}{g.commissionPct > 0 ? ` (${g.commissionPct}%)` : ''}
                  </option>
                ))}
              </select>
              <ChevronRight size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40 pointer-events-none rotate-90" />
            </div>
            {sellerId !== 'all' && selectedSummary && (
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${selectedSummary.palette?.bg} ${selectedSummary.palette?.text}`}>
                {selectedSummary.commissionPct}% {L('comisión', 'commission')}
              </span>
            )}
          </div>

          {/* All-sellers summary strip */}
          {sellerId === 'all' && (
            <div>
              {loadingTickets ? (
                <div className="flex items-center justify-center h-24 text-slate-300 dark:text-white/30 gap-3">
                  <div className="w-5 h-5 border-2 border-slate-200 dark:border-white/10 border-t-sky-500 rounded-full animate-spin" />
                  <span className="text-[13px]">{L('Cargando datos…', 'Loading data…')}</span>
                </div>
              ) : sellerSummaries.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-slate-300 dark:text-white/30 text-[13px]">
                  {L('Sin datos para este período', 'No data for this period')}
                </div>
              ) : (
                <>
                  {sellerSummaries.map(g => {
                    const maxComm = Math.max(...sellerSummaries.map(x => x.commission), 1)
                    return (
                      <button
                        key={g.key}
                        onClick={() => setSellerId(g.key)}
                        className="w-full flex items-center gap-4 px-5 py-3.5 border-b border-slate-50 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left last:border-0 group"
                      >
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${g.palette.bg} ${g.palette.text}`}>
                          {g.name.slice(0, 2).toUpperCase()}
                        </div>
                        {/* Name + % */}
                        <div className="w-[130px] shrink-0">
                          <p className="text-[13px] font-bold text-slate-800 dark:text-white">{g.name}</p>
                          <p className="text-[11px] text-slate-400 dark:text-white/40">
                            {g.commissionPct}% {L('comisión', 'commission')}
                          </p>
                        </div>
                        {/* Ticket count */}
                        <div className="w-[80px] shrink-0 text-center">
                          <p className="text-[15px] font-bold text-slate-700 dark:text-white">{g.ticketCount}</p>
                          <p className="text-[10px] text-slate-400 dark:text-white/40">{L('tickets', 'tickets')}</p>
                        </div>
                        {/* Total billed */}
                        <div className="w-[130px] shrink-0 text-right">
                          <p className="text-[12px] font-semibold text-emerald-700">{fmtRD(g.totalBilled)}</p>
                          <p className="text-[10px] text-slate-400 dark:text-white/40">{L('facturado', 'billed')}</p>
                        </div>
                        {/* Commission + bar */}
                        <div className="flex-1 flex items-center gap-3">
                          <div className="flex-1 h-2 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${g.palette.bar} rounded-full transition-all duration-500`}
                              style={{ width: `${(g.commission / maxComm) * 100}%` }}
                            />
                          </div>
                          <span className="text-[14px] font-bold text-sky-700 w-[110px] text-right shrink-0">{fmtRD(g.commission)}</span>
                        </div>
                        <ChevronRight size={14} className="text-slate-300 dark:text-white/30 group-hover:text-sky-500 transition-colors shrink-0" />
                      </button>
                    )
                  })}

                  {/* Grand total */}
                  <div className="flex items-center gap-4 px-5 py-3 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10">
                    <div className="w-9 shrink-0" />
                    <div className="w-[130px] shrink-0">
                      <p className="text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wide">Total</p>
                    </div>
                    <div className="w-[80px] shrink-0 text-center">
                      <p className="text-[14px] font-bold text-slate-700 dark:text-white">{summary.totalTickets}</p>
                    </div>
                    <div className="w-[130px] shrink-0 text-right">
                      <p className="text-[12px] font-bold text-emerald-700">{fmtRD(summary.totalBilled)}</p>
                    </div>
                    <div className="flex-1 text-right">
                      <p className="text-[15px] font-bold text-sky-700">{fmtRD(summary.totalCommission)}</p>
                    </div>
                    <div className="w-5 shrink-0" />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Individual seller summary cards */}
          {sellerId !== 'all' && selectedSummary && (
            <div className="flex gap-3 px-5 py-4 border-b border-slate-100 dark:border-white/10">
              {[
                { label_es: 'Tickets',          label_en: 'Tickets',           value: selectedSummary.ticketCount },
                { label_es: 'Total Facturado',  label_en: 'Total Billed',      value: fmtRD(selectedSummary.totalBilled) },
                { label_es: 'Comisión ganada',  label_en: 'Commission earned', value: fmtRD(selectedSummary.commission) },
              ].map((card, i) => (
                <div key={i} className={`flex-1 rounded-xl px-4 py-3 ${i === 2 ? 'bg-sky-50 border border-sky-100' : 'bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10'}`}>
                  <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                    {L(card.label_es, card.label_en)}
                  </p>
                  <p className={`text-[18px] font-bold mt-0.5 ${i === 2 ? 'text-sky-700' : 'text-slate-800 dark:text-white'}`}>
                    {card.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Ticket table (individual seller) ──────────────────────────────── */}
        {sellerId !== 'all' && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: 320 }}>
            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/10 flex items-center justify-between shrink-0">
              <p className="text-[12px] font-bold text-slate-700 dark:text-white">
                {L('Tickets del período', 'Period tickets')}
                <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-white/40">· {periodLabel}</span>
              </p>
              <p className="text-[11px] text-amber-600 font-medium">
                {L('⚠ Comisión calculada sobre subtotal pre-ITBIS', '⚠ Commission on pre-ITBIS subtotal only')}
              </p>
            </div>
            <SellerTicketTable
              tickets={selectedTickets}
              lang={lang}
              loading={loadingTickets}
            />
          </div>
        )}
      </div>
    </div>
  )
}
