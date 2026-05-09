/**
 * NominaDashboard.jsx — Landing view for the Nómina module.
 *
 * Shows at-a-glance payroll health + quick actions:
 *   - 4 metric cards (monthly total, active employees, last paid, next period)
 *   - Pending actions (employees missing start_date/cedula, unpaid commissions, period unpaid)
 *   - Activity feed (last 10 payroll runs)
 *   - Commission trends chart (6 months, SVG bars by tipo)
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Users, DollarSign, Calendar, Clock, AlertCircle, ChevronRight, TrendingUp,
  Banknote, FileText,
} from 'lucide-react'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'
import { useBusinessType } from '../../../hooks/useBusinessType.jsx'
import { fmtRD, MetricCard, TYPE_COLORS } from './shared'
import { currentQuincena, currentMonth, nextPayDate } from './lib/payPeriod'

// Vertical-aware label for the "lavador" commission bucket. Empleados.tipo
// in the data model is unchanged ('lavador' for the primary worker); this
// only relabels the UI per business vertical.
function primaryWorkerLabel(businessType, lang) {
  const map = {
    carwash:    { es: 'Lavadores',  en: 'Washers' },
    restaurant: { es: 'Meseros',    en: 'Servers' },
    hybrid:     { es: 'Meseros',    en: 'Servers' },
    salon:      { es: 'Estilistas', en: 'Stylists' },
    barberia:   { es: 'Barberos',   en: 'Barbers' },
    mechanic:   { es: 'Mecánicos',  en: 'Mechanics' },
    dealership: { es: 'Vendedores', en: 'Salespeople' },
    service:    { es: 'Prestadores', en: 'Providers' },
  }
  const entry = map[businessType] || { es: 'Lavadores', en: 'Washers' }
  return lang === 'es' ? entry.es : entry.en
}

export default function NominaDashboard({ onNavigate }) {
  const api = useAPI()
  const { lang } = useLang()
  const { businessType } = useBusinessType()
  const L = (es, en) => lang === 'es' ? es : en
  const lavadorLabel = primaryWorkerLabel(businessType, lang)

  const [empleados,  setEmpleados]  = useState([])
  const [settings,   setSettings]   = useState(null)
  const [recentRuns, setRecentRuns] = useState([])
  const [commTrends, setCommTrends] = useState({ washers: [], sellers: [], cajeros: [] })
  const [loading,    setLoading]    = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      // Last 6 months of data for trends
      const now = new Date()
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const from = sixMonthsAgo.toISOString().slice(0, 10)
      const to = now.toISOString().slice(0, 10)

      const [list, sets, runs, wc, sc, cc] = await Promise.all([
        api?.empleados?.all?.() || [],
        api?.payrollSettings?.get?.() || null,
        api?.payrollRuns?.byPeriod?.(from, to) || [],
        api?.commissions?.byPeriod?.({ from, to }) || [],
        api?.sellerCommissions?.byPeriod?.({ from, to }) || [],
        api?.cajeroCommissions?.byPeriod?.({ from, to }) || [],
      ])
      setEmpleados(list || [])
      setSettings(sets)
      setRecentRuns((runs || []).slice(0, 10))
      // We'd need per-month queries for true trends; for now aggregate by month on what we have
      setCommTrends({ washers: wc || [], sellers: sc || [], cajeros: cc || [] })
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'nominadashboard.primaryworkerlabel' }) } catch {}}
    setLoading(false)
  }

  const cycle = settings?.pay_cycle || 'quincenal'

  // ── Metrics ────────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const monthlyTotal = empleados.reduce((s, e) => s + Number(e.salary || 0), 0)
    const lastPaid = recentRuns[0] || null
    const period = cycle === 'mensual' ? currentMonth() : currentQuincena()
    return {
      monthlyTotal,
      activeCount: empleados.length,
      lastPaid,
      nextPayDate: period.end,
      nextPayLabel: period.label,
    }
  }, [empleados, recentRuns, cycle])

  // ── Pending actions ────────────────────────────────────────────────────────
  const pending = useMemo(() => {
    const issues = []
    const missingStart = empleados.filter(e => !e.start_date).length
    if (missingStart > 0) {
      issues.push({ level: 'red', text: L(`${missingStart} empleado(s) sin fecha de inicio`, `${missingStart} employee(s) without start date`), hint: L('Impide cálculo de liquidación', 'Breaks severance calculation') })
    }
    const missingCedula = empleados.filter(e => !e.cedula).length
    if (missingCedula > 0) {
      issues.push({ level: 'amber', text: L(`${missingCedula} empleado(s) sin cédula`, `${missingCedula} employee(s) without ID`), hint: L('Necesaria para reportes TSS/ISR', 'Needed for TSS/ISR filings') })
    }
    // Only flag as "no salary/no commission" when the employee tipo is salary-expected
    // (not lavador/vendedor/cajero/hybrid — those are commission-first by design).
    const commissionTipos = ['lavador', 'vendedor', 'cajero', 'hybrid']
    const noSalary = empleados.filter(e => !e.salary && !e.ref_id && !commissionTipos.includes(e.tipo)).length
    if (noSalary > 0) {
      issues.push({ level: 'amber', text: L(`${noSalary} empleado(s) sin salario ni comisiones`, `${noSalary} employee(s) with no salary or commissions`), hint: L('Revise la configuración', 'Review configuration') })
    }
    return issues
  }, [empleados])

  // ── Commission trends (last 6 months, stacked by tipo) ────────────────────
  const trendData = useMemo(() => {
    // Group commission rows by month + tipo
    const monthMap = {}
    const addRow = (row, tipo) => {
      const d = row.created_at ? new Date(row.created_at) : null
      if (!d) return
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!monthMap[key]) monthMap[key] = { lavador: 0, vendedor: 0, cajero: 0 }
      monthMap[key][tipo] += Number(row.total_acumulado ?? row.total_commission ?? row.commission_amount ?? 0)
    }
    for (const r of commTrends.washers) addRow(r, 'lavador')
    for (const r of commTrends.sellers) addRow(r, 'vendedor')
    for (const r of commTrends.cajeros) addRow(r, 'cajero')

    // Build last 6 months in order (even if empty)
    const now = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('es-DO', { month: 'short' })
      months.push({
        key, label,
        lavador:  monthMap[key]?.lavador || 0,
        vendedor: monthMap[key]?.vendedor || 0,
        cajero:   monthMap[key]?.cajero || 0,
      })
    }
    return months
  }, [commTrends])

  const maxTrend = Math.max(1, ...trendData.map(m => m.lavador + m.vendedor + m.cajero))

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-white/40 text-sm">{L('Cargando dashboard…', 'Loading dashboard…')}</div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Metric cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            icon={DollarSign}
            label={L('Nómina mensual', 'Monthly payroll')}
            value={fmtRD(metrics.monthlyTotal)}
            sub={L('salarios fijos', 'fixed salaries')}
            accent="green"
          />
          <MetricCard
            icon={Users}
            label={L('Empleados activos', 'Active employees')}
            value={metrics.activeCount}
            sub={cycle === 'mensual' ? L('ciclo mensual', 'monthly cycle') : L('ciclo quincenal', 'biweekly cycle')}
            accent="sky"
          />
          <MetricCard
            icon={Banknote}
            label={L('Último pago', 'Last payment')}
            value={metrics.lastPaid ? fmtRD(metrics.lastPaid.net) : '—'}
            sub={metrics.lastPaid ? new Date(metrics.lastPaid.paid_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }) : L('Sin pagos', 'No payments')}
            accent="emerald"
          />
          <MetricCard
            icon={Calendar}
            label={L('Próximo pago', 'Next payment')}
            value={metrics.nextPayDate}
            sub={metrics.nextPayLabel}
            accent="violet"
          />
        </div>

        {/* Pending actions (only show if there are any) */}
        {pending.length > 0 && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 md:p-5">
            <h3 className="text-[12px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <AlertCircle size={14} className="text-amber-500" />
              {L('Acciones pendientes', 'Pending actions')}
            </h3>
            <div className="space-y-2">
              {pending.map((p, i) => (
                <div key={i} className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border ${
                  p.level === 'red'
                    ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
                    : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
                }`}>
                  <AlertCircle size={14} className={p.level === 'red' ? 'text-red-500 dark:text-red-400 mt-0.5' : 'text-amber-500 dark:text-amber-400 mt-0.5'} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] font-semibold ${p.level === 'red' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>{p.text}</p>
                    <p className={`text-[10px] ${p.level === 'red' ? 'text-red-600/70 dark:text-red-300/70' : 'text-amber-600/70 dark:text-amber-300/70'}`}>{p.hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grid: trends + activity feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Commission trends chart (SVG) */}
          <div className="lg:col-span-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[12px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider flex items-center gap-2">
                <TrendingUp size={14} />
                {L('Tendencia de comisiones (6 meses)', 'Commission trends (6 months)')}
              </h3>
            </div>
            <TrendChart data={trendData} max={maxTrend} lang={lang} lavadorLabel={lavadorLabel} />
          </div>

          {/* Activity feed */}
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 md:p-5">
            <h3 className="text-[12px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Clock size={14} />
              {L('Actividad reciente', 'Recent activity')}
            </h3>
            {recentRuns.length === 0 ? (
              <p className="text-[12px] text-slate-400 dark:text-white/40 italic py-4 text-center">
                {L('Sin actividad aún', 'No activity yet')}
              </p>
            ) : (
              <div className="space-y-2">
                {recentRuns.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 dark:border-white/5 last:border-0">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-slate-700 dark:text-white truncate">{r.empleado_nombre || `#${r.empleado_id}`}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/40">
                        {new Date(r.paid_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })} · {r.period_start}→{r.period_end}
                      </p>
                    </div>
                    <p className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{fmtRD(r.net)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 dark:from-zinc-900 dark:to-black rounded-2xl p-4 md:p-5">
          <h3 className="text-[12px] font-bold text-white/60 uppercase tracking-wider mb-3">{L('Acciones rápidas', 'Quick actions')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <QuickAction icon={Banknote} label={L('Pagar período', 'Pay period')}    hint={L('Ir a la vista Pagos', 'Go to Payments tab')} onClick={() => onNavigate?.('pagos')} />
            <QuickAction icon={Users}    label={L('Ver empleados', 'View employees')} hint={L('Lista y detalles', 'List and details')} onClick={() => onNavigate?.('empleados')} />
            <QuickAction icon={FileText} label={L('Reportes fiscales', 'Tax reports')} hint={L('TSS, ISR, liquidaciones', 'TSS, ISR, severance')} onClick={() => onNavigate?.('reportes')} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Trend chart (inline SVG, no external library) ─────────────────────────────
function TrendChart({ data, max, lang, lavadorLabel }) {
  const L = (es, en) => lang === 'es' ? es : en
  const width = 100
  const height = 140
  const barWidth = width / (data.length * 1.5)
  const gap = barWidth / 2

  const total = (m) => m.lavador + m.vendedor + m.cajero

  return (
    <div className="flex flex-col">
      <svg viewBox={`0 0 ${width} ${height + 20}`} className="w-full h-40">
        {data.map((m, i) => {
          const x = gap + i * (barWidth + gap)
          const t = total(m)
          const h = (t / max) * height
          const yStart = height - h
          // Stacked: lavador on top, vendedor middle, cajero bottom
          const hL = t > 0 ? (m.lavador / max) * height : 0
          const hV = t > 0 ? (m.vendedor / max) * height : 0
          const hC = t > 0 ? (m.cajero / max) * height : 0
          let y = height
          const segs = []
          if (hC > 0) { y -= hC; segs.push(<rect key="c" x={x} y={y} width={barWidth} height={hC} fill="#10b981" />) }
          if (hV > 0) { y -= hV; segs.push(<rect key="v" x={x} y={y} width={barWidth} height={hV} fill="#8b5cf6" />) }
          if (hL > 0) { y -= hL; segs.push(<rect key="l" x={x} y={y} width={barWidth} height={hL} fill="#0ea5e9" />) }
          if (t === 0) segs.push(<rect key="e" x={x} y={height - 1} width={barWidth} height={1} fill="#e2e8f0" />)
          return (
            <g key={m.key}>
              {segs}
              <text x={x + barWidth / 2} y={height + 10} fontSize="4" fill="#94a3b8" textAnchor="middle" className="capitalize">{m.label}</text>
            </g>
          )
        })}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-1 text-[10px]">
        <span className="flex items-center gap-1 text-slate-500 dark:text-white/60"><span className="w-2 h-2 rounded-full bg-sky-500" />{lavadorLabel || 'Lavadores'}</span>
        <span className="flex items-center gap-1 text-slate-500 dark:text-white/60"><span className="w-2 h-2 rounded-full bg-violet-500" />Vendedores</span>
        <span className="flex items-center gap-1 text-slate-500 dark:text-white/60"><span className="w-2 h-2 rounded-full bg-emerald-500" />Cajeros</span>
      </div>
      {max === 1 && (
        <p className="text-[10px] text-slate-400 dark:text-white/40 italic text-center mt-2">
          {L('Sin comisiones registradas aún — se llenará automáticamente al facturar tickets', 'No commissions recorded yet — will fill automatically as tickets are billed')}
        </p>
      )}
    </div>
  )
}

// ── Quick action button ───────────────────────────────────────────────────────
function QuickAction({ icon: Icon, label, hint, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left w-full">
      <div className="w-9 h-9 rounded-xl bg-[#b3001e]/20 flex items-center justify-center text-[#b3001e] shrink-0">
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-bold text-white">{label}</p>
        <p className="text-[10px] text-white/40">{hint}</p>
      </div>
      <ChevronRight size={14} className="text-white/40 shrink-0" />
    </button>
  )
}
