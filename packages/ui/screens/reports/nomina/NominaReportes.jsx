/**
 * NominaReportes.jsx — Accountant reports view.
 *
 * Each report has: period picker → preview counts → CSV + PDF export buttons.
 *
 * Reports available:
 *   - TSS + INFOTEP (mensual)
 *   - ISR retenciones (mensual)
 *   - Nómina completa del período (QuickBooks/Alegra CSV)
 *   - Recibos batch (all pay stubs in one window)
 *   - Liquidaciones acumuladas (termination liability snapshot)
 */

import { useState, useEffect, useMemo } from 'react'
import { FileText, Download, Printer, Calendar, Users, DollarSign, AlertCircle, FileSpreadsheet, Receipt, Shield } from 'lucide-react'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'
import { fmtRD, MetricCard } from './shared'
import { exportTSSReport, exportISRReport, exportNominaPeriod } from '@terminal-x/services/csv'
import { printTSSReport, printISRReport, printLiquidacionesAcumuladas, printBatchStubs } from '@terminal-x/services/report-html'
import { currentMonth, previousMonth } from './lib/payPeriod'
import { calcLiquidacion } from './lib/calcLiquidacion'

export default function NominaReportes() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [empleados,  setEmpleados]  = useState([])
  const [settings,   setSettings]   = useState(null)
  const [biz,        setBiz]        = useState({})
  const [runs,       setRuns]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [commTotals, setCommTotals] = useState({ washers: {}, sellers: {}, cajeros: {} })

  // Period picker — defaults to previous full month (accountant usually reports on last closed month)
  const prevMo = previousMonth()
  const [from, setFrom] = useState(prevMo.start)
  const [to,   setTo]   = useState(prevMo.end)

  const periodLabel = useMemo(() => {
    return `${from} → ${to}`
  }, [from, to])

  useEffect(() => { loadBase() }, [])
  async function loadBase() {
    setLoading(true)
    try {
      const [list, sets, empresa, wc, sc, cc] = await Promise.all([
        api?.empleados?.all?.() || [],
        api?.payrollSettings?.get?.() || null,
        api?.admin?.getEmpresa?.() || null,
        api?.commissions?.byPeriod?.({}) || [],
        api?.sellerCommissions?.byPeriod?.({}) || [],
        api?.cajeroCommissions?.byPeriod?.({}) || [],
      ])
      setEmpleados(list || [])
      setSettings(sets)
      if (empresa) setBiz({ name: empresa.name || empresa.nombre, rnc: empresa.rnc, address: empresa.address || empresa.direccion, phone: empresa.phone || empresa.telefono, email: empresa.email, logo: empresa.logo })
      // v2.1: index by empleado_supabase_id first with legacy fallbacks.
      const build = (rows, legacySupaKey, legacyIdKey) => {
        const bySid = {}, byLegacySid = {}, byLegacyId = {}
        for (const r of (rows || [])) {
          const amt = Number(r.total_acumulado ?? r.total_commission ?? r.commission_amount ?? 0)
          if (r.empleado_supabase_id) {
            const k = String(r.empleado_supabase_id)
            bySid[k] = (bySid[k] || 0) + amt
          } else if (r[legacySupaKey]) {
            const k = String(r[legacySupaKey])
            byLegacySid[k] = (byLegacySid[k] || 0) + amt
          } else if (r[legacyIdKey] != null) {
            const k = String(r[legacyIdKey])
            byLegacyId[k] = (byLegacyId[k] || 0) + amt
          }
        }
        return { bySid, byLegacySid, byLegacyId }
      }
      setCommTotals({
        washers: build(wc, 'washer_supabase_id', 'washer_id'),
        sellers: build(sc, 'seller_supabase_id', 'seller_id'),
        cajeros: build(cc, 'cajero_supabase_id', 'cajero_id'),
      })
    } catch {}
    setLoading(false)
  }

  // Reload runs whenever period changes
  useEffect(() => {
    if (!from || !to) { setRuns([]); return }
    let cancelled = false
    Promise.resolve(api?.payrollRuns?.byPeriod?.(from, to) || [])
      .then(rows => { if (!cancelled) setRuns(rows || []) })
      .catch(() => { if (!cancelled) setRuns([]) })
    return () => { cancelled = true }
  }, [from, to])

  // Build rows ready for TSS/ISR reports. Merge empleado metadata from empleados list.
  const empById = useMemo(() => {
    const map = {}
    for (const e of empleados) map[String(e.id)] = e
    return map
  }, [empleados])

  const enrichedRuns = useMemo(() => runs.map(r => ({
    ...r,
    empleado_nombre: r.empleado_nombre || empById[String(r.empleado_id)]?.nombre || '—',
    empleado_tipo:   r.empleado_tipo   || empById[String(r.empleado_id)]?.tipo   || '',
    cedula:          empById[String(r.empleado_id)]?.cedula || '',
    puesto:          empById[String(r.empleado_id)]?.puesto || '',
    tss_id:          empById[String(r.empleado_id)]?.tss_id || '',
    cycle:           settings?.pay_cycle || 'quincenal',
  })), [runs, empById, settings])

  // ── Metrics for the selected period ─────────────────────────────────────────
  const metrics = useMemo(() => {
    const tssEmp = enrichedRuns.reduce((s, r) => s + Number(r.sfs_employee || 0) + Number(r.afp_employee || 0), 0)
    const tssEmpr = enrichedRuns.reduce((s, r) => s + Number(r.sfs_employer || 0) + Number(r.afp_employer || 0), 0)
    const infotep = enrichedRuns.reduce((s, r) => s + Number(r.infotep_employer || 0), 0)
    const isr = enrichedRuns.reduce((s, r) => s + Number(r.isr || 0), 0)
    const net = enrichedRuns.reduce((s, r) => s + Number(r.net || 0), 0)
    const gross = enrichedRuns.reduce((s, r) => s + Number(r.base || 0) + Number(r.commissions || 0) + Number(r.bonuses || 0), 0)
    return {
      count: enrichedRuns.length,
      gross, tssEmp, tssEmpr, infotep, isr, net,
      employerLoad: tssEmpr + infotep,
    }
  }, [enrichedRuns])

  // ── Liquidaciones acumuladas (current snapshot for all active employees) ────
  const liquidaciones = useMemo(() => {
    const pickCommission = (emp) => {
      const bucket = emp.tipo === 'lavador'  ? commTotals.washers
                   : emp.tipo === 'vendedor' ? commTotals.sellers
                   : emp.tipo === 'cajero'   ? commTotals.cajeros
                   : null
      if (!bucket) return 0
      const sid = emp.supabase_id ? String(emp.supabase_id) : null
      if (sid && bucket.bySid?.[sid]) return bucket.bySid[sid]
      const refSid = emp.ref_supabase_id ? String(emp.ref_supabase_id) : null
      if (refSid && bucket.byLegacySid?.[refSid]) return bucket.byLegacySid[refSid]
      const ref = emp.ref_id != null ? String(emp.ref_id) : null
      if (ref && bucket.byLegacyId?.[ref]) return bucket.byLegacyId[ref]
      return 0
    }
    const out = []
    for (const emp of empleados) {
      const liq = calcLiquidacion(emp, 'desahucio', pickCommission(emp) || 0)
      if (liq) out.push({ ...liq, nombre: emp.nombre })
    }
    return out
  }, [empleados, commTotals])

  const totalLiquidacionPasivo = liquidaciones.reduce((s, l) => s + Number(l.total || 0), 0)

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleRunTSSPdf() {
    if (enrichedRuns.length === 0) return alert(L('Sin pagos en este período', 'No payments in this period'))
    printTSSReport(biz, enrichedRuns, periodLabel)
  }
  function handleRunTSSCsv() {
    if (enrichedRuns.length === 0) return alert(L('Sin pagos en este período', 'No payments in this period'))
    exportTSSReport(biz, enrichedRuns, periodLabel)
  }
  function handleRunISRPdf() {
    if (enrichedRuns.length === 0) return alert(L('Sin pagos en este período', 'No payments in this period'))
    printISRReport(biz, enrichedRuns, periodLabel)
  }
  function handleRunISRCsv() {
    if (enrichedRuns.length === 0) return alert(L('Sin pagos en este período', 'No payments in this period'))
    exportISRReport(biz, enrichedRuns, periodLabel)
  }
  function handleRunNominaCsv() {
    if (enrichedRuns.length === 0) return alert(L('Sin pagos en este período', 'No payments in this period'))
    exportNominaPeriod(biz, enrichedRuns, periodLabel)
  }
  function handleBatchStubs() {
    if (enrichedRuns.length === 0) return alert(L('Sin pagos en este período', 'No payments in this period'))
    printBatchStubs(biz, enrichedRuns, empById)
  }
  function handleLiqAcumuladas() {
    if (liquidaciones.length === 0) return alert(L('Sin empleados con antigüedad suficiente', 'No employees with sufficient seniority'))
    printLiquidacionesAcumuladas(biz, liquidaciones)
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-white/40 text-sm">{L('Cargando…', 'Loading…')}</div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Period picker */}
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-slate-500 dark:text-white/60" />
            <h3 className="text-[13px] font-bold text-slate-700 dark:text-white">{L('Período del reporte', 'Report period')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{L('Desde', 'From')}</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{L('Hasta', 'To')}</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => { const p = previousMonth(); setFrom(p.start); setTo(p.end) }}
                className="flex-1 px-3 py-2 text-[11px] font-bold text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                {L('Mes anterior', 'Prev month')}
              </button>
              <button onClick={() => { const p = currentMonth(); setFrom(p.start); setTo(p.end) }}
                className="flex-1 px-3 py-2 text-[11px] font-bold text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                {L('Mes actual', 'Current month')}
              </button>
            </div>
          </div>
        </div>

        {/* Metrics snapshot */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard icon={Users}      label={L('Pagos registrados', 'Payments recorded')} value={metrics.count} accent="sky" />
          <MetricCard icon={DollarSign} label={L('Neto pagado', 'Net paid')}                value={fmtRD(metrics.net)} accent="green" />
          <MetricCard icon={Shield}     label="TSS + INFOTEP empleador"                      value={fmtRD(metrics.employerLoad)} accent="violet" />
          <MetricCard icon={AlertCircle} label={L('Pasivo liquidaciones', 'Severance liability')} value={fmtRD(totalLiquidacionPasivo)} accent="amber" />
        </div>

        {/* Reports grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ReportCard
            icon={Shield}
            title="TSS + INFOTEP"
            description={L('Contribuciones empleado y empleador con topes 2026 (SFS RD$232,230 · AFP RD$464,460) e INFOTEP 1%. Listo para subir al portal TSS.',
                           'Employee + employer contributions with 2026 caps and 1% INFOTEP. Ready for TSS portal upload.')}
            metric={fmtRD(metrics.tssEmp + metrics.tssEmpr + metrics.infotep)}
            metricLabel={L('Total del período', 'Total for period')}
            onPdf={handleRunTSSPdf}
            onCsv={handleRunTSSCsv}
          />
          <ReportCard
            icon={FileText}
            title="ISR (Impuesto Sobre la Renta)"
            description={L('Retención progresiva por empleado. Escalas DGII 2026: exento hasta RD$416,220/año, 15%, 20%, 25%.',
                           'Progressive withholding per employee. DGII 2026 brackets: exempt up to RD$416,220/yr, 15%, 20%, 25%.')}
            metric={fmtRD(metrics.isr)}
            metricLabel={L('ISR retenido', 'ISR withheld')}
            onPdf={handleRunISRPdf}
            onCsv={handleRunISRCsv}
          />
          <ReportCard
            icon={FileSpreadsheet}
            title={L('Nómina completa', 'Full payroll')}
            description={L('Exporta todos los pagos del período con el desglose completo (base, comisiones, bonos, descuentos, neto). Formato CSV compatible con QuickBooks y Alegra.',
                           'Export all period payments with full breakdown. CSV format compatible with QuickBooks and Alegra.')}
            metric={fmtRD(metrics.gross)}
            metricLabel={L('Bruto total', 'Total gross')}
            onCsv={handleRunNominaCsv}
          />
          <ReportCard
            icon={Receipt}
            title={L('Recibos de pago (batch)', 'Paycheck stubs (batch)')}
            description={L('Imprime todos los recibos del período en una sola ventana, uno por página.',
                           'Print all period pay stubs in one window, one per page.')}
            metric={`${metrics.count} ${L('recibos', 'stubs')}`}
            metricLabel={L('En el período', 'In period')}
            onPdf={handleBatchStubs}
          />
          <ReportCard
            icon={AlertCircle}
            title={L('Liquidaciones acumuladas', 'Accrued severance liability')}
            description={L('Snapshot del pasivo laboral: cuánto debería pagar la empresa si terminara hoy a todos los empleados activos.',
                           'Snapshot of labor liability: how much would be owed if all active employees were terminated today.')}
            metric={fmtRD(totalLiquidacionPasivo)}
            metricLabel={`${liquidaciones.length} ${L('empleados', 'employees')}`}
            onPdf={handleLiqAcumuladas}
            accent="amber"
          />
        </div>

        {enrichedRuns.length === 0 && (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-4 py-3 text-[12px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>
              {L('No hay pagos registrados en este período. Use la pestaña Pagos para registrar los pagos del período antes de generar reportes.',
                 'No payments recorded in this period. Use the Pagos tab to record payments before generating reports.')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Report card component ─────────────────────────────────────────────────────
function ReportCard({ icon: Icon, title, description, metric, metricLabel, onPdf, onCsv, accent }) {
  const iconBg = accent === 'amber'
    ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20'
    : 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-500/20'
  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 md:p-5 flex flex-col">
      <div className="flex items-start gap-3 mb-2">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${iconBg}`}>
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-bold text-slate-800 dark:text-white">{title}</h4>
          <p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="mt-2 mb-3">
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{metricLabel}</p>
        <p className="text-[18px] font-bold text-slate-800 dark:text-white">{metric}</p>
      </div>
      <div className="mt-auto flex gap-2">
        {onPdf && (
          <button onClick={onPdf}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-900 dark:bg-white dark:text-black dark:hover:bg-white/90 text-white text-[11px] font-bold rounded-lg transition-colors">
            <Printer size={12} /> PDF
          </button>
        )}
        {onCsv && (
          <button onClick={onCsv}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
            <Download size={12} /> CSV
          </button>
        )}
      </div>
    </div>
  )
}
