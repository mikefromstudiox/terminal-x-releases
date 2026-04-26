/**
 * Resumen.jsx — v2.16.2 lending KPI dashboard.
 *
 * Route: /lending/resumen
 *
 * 5 KPI tiles:
 *   1) Cartera Activa     — Σ (principal - total_paid) WHERE status='active'
 *   2) Intereses por Cobrar — sum of unpaid loan_schedule.interest_due (or
 *                             principal × monthly_rate × remaining_months for
 *                             interest_only); aggregated from loan_schedule
 *                             when available, falls back to per-loan estimate.
 *   3) Mora Actual %      — overdue_active / active * 100
 *   4) Redenciones Mes    — count(pawn_items.status='redeemed' this month)
 *   5) Tasa Default %     — defaulted_last12 / created_last12 * 100
 *
 * Crimson accent on Mora % and Default %.
 *
 * Below: 3 alert cards (Préstamos en mora hoy | Empeños vencen ≤3 días |
 * Renovaciones recientes).
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Banknote, TrendingUp, AlertTriangle, Package, Activity,
  Loader2, ArrowRight, RefreshCw, Calendar,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmtPct(n) {
  return `${(Number(n || 0)).toFixed(1)}%`
}
function fmtDate(d) {
  if (!d) return '---'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function startOfMonth() {
  const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1)
}
function startOfYearMinus(months) {
  const d = new Date(); d.setMonth(d.getMonth() - months); return d
}

// ── KPI tile (mirrors Loans.jsx SummaryCard pattern) ────────────────────────
function KPITile({ icon: Icon, label, value, sub, accent = 'slate', to }) {
  const accents = {
    slate:   { icon: 'text-slate-500 dark:text-white/60',   ring: 'border-slate-200 dark:border-white/10' },
    emerald: { icon: 'text-emerald-600 dark:text-emerald-400', ring: 'border-slate-200 dark:border-white/10' },
    amber:   { icon: 'text-amber-600 dark:text-amber-400',  ring: 'border-slate-200 dark:border-white/10' },
    crimson: { icon: 'text-[#b3001e]',                       ring: 'border-[#b3001e]/40' },
  }
  const A = accents[accent] || accents.slate
  const Body = (
    <div className={`bg-white dark:bg-white/5 rounded-2xl border ${A.ring} px-4 py-3.5 h-full transition-shadow ${to ? 'hover:shadow-lg cursor-pointer' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={A.icon} />
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-[22px] md:text-[24px] font-bold leading-none ${accent === 'crimson' ? 'text-[#b3001e]' : 'text-slate-800 dark:text-white'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 dark:text-white/50 mt-1.5">{sub}</p>}
    </div>
  )
  return to ? <Link to={to}>{Body}</Link> : Body
}

// ── Alert card (compact list with link) ─────────────────────────────────────
function AlertCard({ icon: Icon, title, items, emptyText, renderItem, to, tone = 'slate' }) {
  const tones = {
    slate:   'border-slate-200 dark:border-white/10',
    crimson: 'border-[#b3001e]/40',
    amber:   'border-amber-300 dark:border-amber-500/30',
  }
  return (
    <div className={`bg-white dark:bg-white/5 rounded-2xl border ${tones[tone]} overflow-hidden flex flex-col`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-white/5">
        <div className="flex items-center gap-2">
          <Icon size={14} className={tone === 'crimson' ? 'text-[#b3001e]' : tone === 'amber' ? 'text-amber-500' : 'text-slate-500'} />
          <h3 className="text-[12px] font-bold text-slate-700 dark:text-white">{title}</h3>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60">{items.length}</span>
        </div>
        {to && (
          <Link to={to} className="text-[10px] font-semibold text-[#b3001e] hover:underline flex items-center gap-1">
            Ver todo <ArrowRight size={10} />
          </Link>
        )}
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-white/5 max-h-72 overflow-auto">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-[12px] text-slate-400 dark:text-white/40">{emptyText}</li>
        ) : items.map((it, i) => (
          <li key={i} className="px-4 py-2.5">{renderItem(it)}</li>
        ))}
      </ul>
    </div>
  )
}

// ── Estimate per-loan remaining interest when loan_schedule is unavailable ──
// french/german: total_expected = monthly_payment × term_months; remaining =
//   total_expected - total_paid (proxy — bounded ≥0)
// interest_only: principal × monthly_rate × term_months_remaining
function estimateRemainingInterest(loan, paidPrincipalMap) {
  const principal = Number(loan.principal || 0)
  const totalPaid = Number(loan.total_paid || 0)
  const r = (Number(loan.interest_rate || 0)) / 100
  const n = Number(loan.term_months || 0)
  const monthly = Number(loan.monthly_payment || 0)
  const method = loan.amortization_method || loan.method || 'french'

  if (method === 'interest_only' || method === 'flat' || method === 'balloon') {
    // Interest is paid each month; remaining = principal × r × periods left
    // We don't know how many periods are left exactly; use ratio of paid/expected
    const expectedPaid = monthly * n
    const remainingMonths = monthly > 0 ? Math.max(0, n - Math.floor(totalPaid / monthly)) : n
    return principal * r * remainingMonths
  }
  // French/german: total expected interest = monthly × n − principal
  const totalExpected = Math.max(0, monthly * n - principal)
  // Approx already-collected interest = (totalPaid / (monthly × n)) × totalExpected
  const collected = monthly * n > 0 ? (totalPaid / (monthly * n)) * totalExpected : 0
  return Math.max(0, totalExpected - collected)
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function Resumen() {
  const api = useAPI()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loans, setLoans] = useState([])
  const [pawn, setPawn]   = useState([])
  const [renewals, setRenewals] = useState([])

  const load = async () => {
    setRefreshing(true)
    try {
      try { await (api?.collections?.computeMora?.() ?? Promise.resolve()) } catch {}
      const [allLoans, allPawn, ren] = await Promise.all([
        (api?.loans?.list?.({}) ?? Promise.resolve([])),
        (api?.pawnItems?.list?.({}) ?? Promise.resolve([])),
        (api?.loanRenewals?.list?.({}) ?? api?.loanRenewals?.list?.() ?? Promise.resolve([])),
      ])
      setLoans(Array.isArray(allLoans) ? allLoans : [])
      setPawn(Array.isArray(allPawn) ? allPawn : [])
      setRenewals(Array.isArray(ren) ? ren : [])
    } catch {
      setLoans([]); setPawn([]); setRenewals([])
    } finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const kpis = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    const monthStart = startOfMonth().getTime()
    const yearAgo = startOfYearMinus(12).getTime()

    const active = loans.filter(l => l.status === 'active')
    const cartera = active.reduce((s, l) =>
      s + Math.max(0, Number(l.principal || 0) - Number(l.total_paid || 0)), 0)

    const intereses = active.reduce((s, l) => s + estimateRemainingInterest(l), 0)

    const overdue = active.filter(l => {
      if (!l.next_due_date) return false
      return new Date(l.next_due_date) < today
    })
    const moraPct = active.length === 0 ? 0 : (overdue.length / active.length) * 100

    const redenciones = pawn.filter(p => {
      if (p.status !== 'redeemed') return false
      const ts = new Date(p.redemption_date || p.redeemed_at || p.updated_at || 0).getTime()
      return ts >= monthStart
    }).length

    // Default rate (last 12 months)
    const recentLoans = loans.filter(l => new Date(l.created_at || 0).getTime() >= yearAgo)
    const recentDefaults = recentLoans.filter(l => l.status === 'defaulted')
    const defaultPct = recentLoans.length === 0 ? 0 : (recentDefaults.length / recentLoans.length) * 100

    return {
      cartera,
      intereses,
      moraPct,
      redenciones,
      defaultPct,
      activeCount: active.length,
      overdueCount: overdue.length,
      recentCount: recentLoans.length,
      recentDefaults: recentDefaults.length,
    }
  }, [loans, pawn])

  // Alert lists
  const alerts = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    const in3days = new Date(today); in3days.setDate(in3days.getDate() + 3)

    const overdueLoans = loans
      .filter(l => l.status === 'active' && l.next_due_date && new Date(l.next_due_date) < today)
      .sort((a, b) => Number(b.days_late || 0) - Number(a.days_late || 0))
      .slice(0, 8)

    const expiringPawns = pawn
      .filter(p => {
        if (p.status !== 'active') return false
        if (!p.due_date) return false
        const dd = new Date(p.due_date)
        return dd >= today && dd <= in3days
      })
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 8)

    const recentRenewals = (renewals || [])
      .slice()
      .sort((a, b) => new Date(b.renewed_at || b.created_at || 0) - new Date(a.renewed_at || a.created_at || 0))
      .slice(0, 10)

    return { overdueLoans, expiringPawns, recentRenewals }
  }, [loans, pawn, renewals])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-black">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> Cargando dashboard...
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Banknote size={20} className="text-[#b3001e]" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">Resumen — Préstamos & Empeños</h1>
        </div>
        <button onClick={load} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[11px] font-semibold text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors disabled:opacity-50">
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          Refrescar
        </button>
      </div>

      <div className="flex-1 overflow-auto px-3 md:px-6 py-4 md:py-6 space-y-6">
        {/* 5 KPIs — md:grid-cols-5 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KPITile
            icon={Banknote}
            label="Cartera Activa"
            value={fmtRD(kpis.cartera)}
            sub={`${kpis.activeCount} préstamos activos`}
            accent="slate"
            to="/loans"
          />
          <KPITile
            icon={TrendingUp}
            label="Intereses por Cobrar"
            value={fmtRD(kpis.intereses)}
            sub="Estimado restante"
            accent="emerald"
          />
          <KPITile
            icon={AlertTriangle}
            label="Mora Actual"
            value={fmtPct(kpis.moraPct)}
            sub={`${kpis.overdueCount} de ${kpis.activeCount} vencidos`}
            accent="crimson"
            to="/collections"
          />
          <KPITile
            icon={Package}
            label="Redenciones (mes)"
            value={kpis.redenciones}
            sub="Empeños redimidos"
            accent="slate"
            to="/pawn-items"
          />
          <KPITile
            icon={Activity}
            label="Tasa Default"
            value={fmtPct(kpis.defaultPct)}
            sub={`${kpis.recentDefaults} de ${kpis.recentCount} (12m)`}
            accent="crimson"
          />
        </div>

        {/* 3 alert cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <AlertCard
            icon={AlertTriangle}
            title="Préstamos en mora hoy"
            items={alerts.overdueLoans}
            emptyText="Sin préstamos en mora hoy."
            tone={alerts.overdueLoans.length > 0 ? 'crimson' : 'slate'}
            to="/collections"
            renderItem={l => (
              <Link to="/collections" className="flex items-center justify-between gap-2 group">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-slate-800 dark:text-white truncate group-hover:text-[#b3001e]">
                    {l.clients?.name || `Cliente #${l.client_id}`}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-white/40">#{l.id} · vencía {fmtDate(l.next_due_date)}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#b3001e] text-white shrink-0">{l.days_late || 0}d</span>
              </Link>
            )}
          />
          <AlertCard
            icon={Calendar}
            title="Empeños vencen ≤3 días"
            items={alerts.expiringPawns}
            emptyText="Ningún empeño próximo a vencer."
            tone={alerts.expiringPawns.length > 0 ? 'amber' : 'slate'}
            to="/pawn-items"
            renderItem={p => (
              <Link to="/pawn-items" className="flex items-center justify-between gap-2 group">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-slate-800 dark:text-white truncate group-hover:text-[#b3001e]">
                    {p.description || p.ticket_code || `Empeño #${p.id}`}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-white/40">{p.clients?.name || `Cliente #${p.client_id}`}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white shrink-0 tabular-nums">{fmtDate(p.due_date)}</span>
              </Link>
            )}
          />
          <AlertCard
            icon={RefreshCw}
            title="Renovaciones recientes"
            items={alerts.recentRenewals}
            emptyText="Sin renovaciones recientes."
            tone="slate"
            renderItem={r => (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-slate-800 dark:text-white truncate">
                    Préstamo · renovación #{r.renewal_count || '—'}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-white/40">{fmtDate(r.renewed_at || r.created_at)}</p>
                </div>
                {r.interest_paid != null && (
                  <span className="text-[11px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">{fmtRD(r.interest_paid)}</span>
                )}
              </div>
            )}
          />
        </div>
      </div>
    </div>
  )
}
