// EstadoResultadosReport — Phase 5 spine slice.
// Reads from journal_entries (cloud-only ledger). Default tab is HIDDEN; the
// parent (Reportes.jsx) gates visibility by app_settings.journal_entries_v1.
//
// Account mapping (see Phase 5 spec):
//   Revenue (credit-normal, positive net = revenue):
//     revenue.carwash → Ventas Car Wash
//     revenue.bar + revenue.kitchen → Ventas Bar/Restaurante
//     revenue.tienda → Ventas Tienda
//     revenue.other + revenue.tip + revenue.service → Otros
//   Expense (debit-normal — net comes back negative; we sign-flip for display):
//     cogs → Costo de Ventas (COGS)
//     expense.* (all) → Caja Chica (gastos)
//     commission_expense → Comisiones empleados
//     payroll_expense → Nómina pagada
//     fee.card → Fee tarjeta
//     fee.py → Fee Pedidos Ya
//   Informational:
//     itbis_payable → ITBIS Cobrado
//     itbis_receivable → ITBIS Pagado (if present)
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Download, FileText } from 'lucide-react'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'
import { exportEstadoResultados } from '@terminal-x/services/csv'
import { buildEstadoResultadosPDF } from '@terminal-x/services/pdf'

const MES_FULL_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MES_FULL_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmtRD(n) {
  const v = Number(n || 0)
  return `RD$ ${Math.round(v).toLocaleString('en-US')}`
}
function fmtPct(n) {
  if (n == null || !isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}
function pctChange(cur, prev) {
  if (!prev) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}
function padDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function monthRange(year, month) {
  const last = new Date(year, month + 1, 0).getDate()
  return { from: padDate(year, month, 1), to: padDate(year, month, last) }
}
function prevMonth(year, month) {
  const pm = month === 0 ? 11 : month - 1
  const py = month === 0 ? year - 1 : year
  return { year: py, month: pm }
}

// ── Account → display row reducer ─────────────────────────────────────────
function buildView({ curRows, prevRows, lang }) {
  const cur  = Object.fromEntries((curRows  || []).map(r => [r.account, Number(r.net) || 0]))
  const prev = Object.fromEntries((prevRows || []).map(r => [r.account, Number(r.net) || 0]))

  const at = (snap, key, sign = 1) => (Number(snap[key]) || 0) * sign
  const sumPrefix = (snap, prefix, sign = 1) => {
    let total = 0
    for (const k of Object.keys(snap)) {
      if (k.startsWith(prefix)) total += (Number(snap[k]) || 0) * sign
    }
    return total
  }
  const L = (es, en) => (lang === 'en' ? en : es)

  const incomeDefs = [
    { key: 'rev_carwash', label: L('Ventas Car Wash', 'Car Wash Sales'),
      cur: at(cur, 'revenue.carwash'), prev: at(prev, 'revenue.carwash') },
    { key: 'rev_bar', label: L('Ventas Bar/Restaurante', 'Bar/Restaurant Sales'),
      cur: at(cur, 'revenue.bar') + at(cur, 'revenue.kitchen'),
      prev: at(prev, 'revenue.bar') + at(prev, 'revenue.kitchen') },
    { key: 'rev_tienda', label: L('Ventas Tienda', 'Store Sales'),
      cur: at(cur, 'revenue.tienda'), prev: at(prev, 'revenue.tienda') },
    { key: 'rev_other', label: L('Otros', 'Other'),
      cur: at(cur, 'revenue.other') + at(cur, 'revenue.tip') + at(cur, 'revenue.service'),
      prev: at(prev, 'revenue.other') + at(prev, 'revenue.tip') + at(prev, 'revenue.service') },
  ]
  const expenseDefs = [
    { key: 'cogs', label: L('Costo de Ventas (COGS)', 'Cost of Goods Sold'),
      cur:  at(cur,  'cogs', -1), prev: at(prev, 'cogs', -1) },
    { key: 'caja_chica', label: L('Caja Chica (gastos)', 'Petty Cash (expenses)'),
      cur:  sumPrefix(cur,  'expense.', -1), prev: sumPrefix(prev, 'expense.', -1) },
    { key: 'commission', label: L('Comisiones empleados', 'Employee Commissions'),
      cur:  at(cur,  'commission_expense', -1), prev: at(prev, 'commission_expense', -1) },
    { key: 'payroll', label: L('Nómina pagada', 'Payroll'),
      cur:  at(cur,  'payroll_expense', -1), prev: at(prev, 'payroll_expense', -1) },
    { key: 'fee_card', label: L('Fee tarjeta', 'Card Processor Fee'),
      cur:  at(cur,  'fee.card', -1), prev: at(prev, 'fee.card', -1) },
    { key: 'fee_py', label: L('Fee Pedidos Ya', 'Pedidos Ya Fee'),
      cur:  at(cur,  'fee.py', -1), prev: at(prev, 'fee.py', -1) },
  ]

  // Hide rows that are zero in BOTH months (per spec).
  const isLive = (r) => Math.abs(r.cur) > 0.005 || Math.abs(r.prev) > 0.005
  const incomeRows  = incomeDefs.filter(isLive).map(r => ({ ...r, group: 'ingresos', delta: pctChange(r.cur, r.prev) }))
  const expenseRows = expenseDefs.filter(isLive).map(r => ({ ...r, group: 'gastos',   delta: pctChange(r.cur, r.prev) }))

  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const ingresos      = sum(incomeRows,  'cur')
  const ingresosPrev  = sum(incomeRows,  'prev')
  const gastos        = sum(expenseRows, 'cur')
  const gastosPrev    = sum(expenseRows, 'prev')
  const utilidad      = ingresos - gastos
  const utilidadPrev  = ingresosPrev - gastosPrev
  const margen        = ingresos     > 0 ? (utilidad     / ingresos)     * 100 : 0
  const margenPrev    = ingresosPrev > 0 ? (utilidadPrev / ingresosPrev) * 100 : 0

  const itbisCobrado     = at(cur,  'itbis_payable')
  const itbisCobradoPrev = at(prev, 'itbis_payable')
  const itbisPagado      = at(cur,  'itbis_receivable', -1)
  const itbisPagadoPrev  = at(prev, 'itbis_receivable', -1)

  return {
    rows: [...incomeRows, ...expenseRows],
    totals: {
      ingresos, ingresosPrev, ingresosDelta: pctChange(ingresos, ingresosPrev),
      gastos, gastosPrev, gastosDelta: pctChange(gastos, gastosPrev),
      utilidad, utilidadPrev,
      margen, margenPrev,
      itbisCobrado, itbisCobradoPrev,
      itbisPagado,  itbisPagadoPrev,
    },
  }
}

const TODAY = new Date()
const CUR_Y = TODAY.getFullYear()
const CUR_M = TODAY.getMonth()

export default function EstadoResultadosReport() {
  const api = useAPI()
  const { lang } = useLang()

  const [year,  setYear]  = useState(CUR_Y)
  const [month, setMonth] = useState(CUR_M)
  const [loading, setLoading] = useState(false)
  const [curRows,  setCurRows]  = useState(null)
  const [prevRows, setPrevRows] = useState(null)
  const [biz, setBiz] = useState({})

  useEffect(() => {
    api.admin?.getEmpresa?.()
      .then(e => e && setBiz({
        name: e.name || e.nombre, rnc: e.rnc,
        address: e.address || e.direccion, phone: e.phone || e.telefono, email: e.email,
      }))
      .catch(err => {
        try { window.__txReportError?.(err, { severity: 'warn', category: 'reportes_pyl', extra: { stage: 'getEmpresa' } }) } catch {}
      })
  }, [api])

  const load = useCallback(async () => {
    if (!api?.journal?.pnlByMonth) { setCurRows([]); setPrevRows([]); return }
    setLoading(true)
    const cur  = monthRange(year, month)
    const p    = prevMonth(year, month)
    const prev = monthRange(p.year, p.month)
    try {
      const [c, pr] = await Promise.all([
        api.journal.pnlByMonth({ from: cur.from,  to: cur.to  }),
        api.journal.pnlByMonth({ from: prev.from, to: prev.to }),
      ])
      setCurRows(c || [])
      setPrevRows(pr || [])
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'warn', category: 'reportes_pyl', extra: { from: cur.from, to: cur.to } }) } catch {}
      setCurRows([]); setPrevRows([])
    } finally {
      setLoading(false)
    }
  }, [api, year, month])

  useEffect(() => { load() }, [load])

  const view = useMemo(() => {
    if (curRows == null || prevRows == null) return null
    return buildView({ curRows, prevRows, lang })
  }, [curRows, prevRows, lang])

  const months   = lang === 'en' ? MES_FULL_EN : MES_FULL_ES
  const label    = `${months[month]} ${year}`
  const utilidad = view?.totals?.utilidad ?? 0
  const utilUp   = utilidad >= 0

  function changeMonth(dir) {
    let m = month + dir, y = year
    if (m < 0)  { m = 11; y-- }
    if (m > 11) { m = 0;  y++ }
    if (y > CUR_Y || (y === CUR_Y && m > CUR_M)) return
    setMonth(m); setYear(y)
  }

  function onExportCsv() {
    if (!view) return
    try { exportEstadoResultados(biz, view, label) }
    catch (err) { try { window.__txReportError?.(err, { severity: 'warn', category: 'reportes_pyl_csv' }) } catch {} }
  }
  async function onExportPdf() {
    if (!view) return
    try { await buildEstadoResultadosPDF(biz, view, label, api) }
    catch (err) { try { window.__txReportError?.(err, { severity: 'warn', category: 'reportes_pyl_pdf' }) } catch {} }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="p-3 md:p-6 space-y-3 md:space-y-4 min-h-full">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
              {lang === 'en' ? 'Income Statement' : 'Estado de Resultados'}
            </h2>
            <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5 font-medium">{label}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => changeMonth(-1)}
              className="px-3 py-2 min-h-[44px] md:min-h-0 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
              ←
            </button>
            <select value={month} onChange={e => setMonth(+e.target.value)}
              className="px-2 py-2 min-h-[44px] md:min-h-0 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white">
              {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(+e.target.value)}
              className="px-2 py-2 min-h-[44px] md:min-h-0 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white">
              {[CUR_Y - 1, CUR_Y].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => changeMonth(1)} disabled={year === CUR_Y && month === CUR_M}
              className="px-3 py-2 min-h-[44px] md:min-h-0 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40">
              →
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-40 text-slate-400 dark:text-white/40 text-sm">
            {lang === 'en' ? 'Loading…' : 'Cargando…'}
          </div>
        )}

        {!loading && view && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-white/5">
                  <th className="text-left  px-4 md:px-5 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">Concepto</th>
                  <th className="text-right px-4 md:px-5 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{lang === 'en' ? 'Current' : 'Mes actual'}</th>
                  <th className="text-right px-4 md:px-5 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{lang === 'en' ? 'Previous' : 'Mes anterior'}</th>
                  <th className="text-right px-4 md:px-5 py-2.5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">Δ</th>
                </tr>
              </thead>
              <tbody>
                <SectionHeader label="INGRESOS" />
                {view.rows.filter(r => r.group === 'ingresos').map(r => (
                  <Row key={r.key} label={r.label} cur={r.cur} prev={r.prev} delta={r.delta} />
                ))}
                <TotalRow label={lang === 'en' ? 'Total Income' : 'Total Ingresos'}
                  cur={view.totals.ingresos} prev={view.totals.ingresosPrev} delta={view.totals.ingresosDelta} />

                <SectionHeader label={lang === 'en' ? 'COSTS AND EXPENSES' : 'COSTOS Y GASTOS'} />
                {view.rows.filter(r => r.group === 'gastos').map(r => (
                  <Row key={r.key} label={r.label} cur={r.cur} prev={r.prev} delta={r.delta} />
                ))}
                <TotalRow label={lang === 'en' ? 'Total Expenses' : 'Total Gastos'}
                  cur={view.totals.gastos} prev={view.totals.gastosPrev} delta={view.totals.gastosDelta} />

                <tr className="border-t-2 border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                  <td className="px-4 md:px-5 py-3 text-[13px] font-bold text-slate-800 dark:text-white">
                    {lang === 'en' ? 'Net Profit' : 'Utilidad del Mes'}
                  </td>
                  <td className={`px-4 md:px-5 py-3 text-[14px] font-bold text-right ${utilUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#b3001e]'}`}>{fmtRD(utilidad)}</td>
                  <td className="px-4 md:px-5 py-3 text-[12px] text-slate-500 dark:text-white/60 text-right">{fmtRD(view.totals.utilidadPrev)}</td>
                  <td className={`px-4 md:px-5 py-3 text-[12px] font-bold text-right ${utilUp ? 'text-emerald-600' : 'text-[#b3001e]'}`}>{fmtPct(pctChange(utilidad, view.totals.utilidadPrev))}</td>
                </tr>
                <tr className="bg-slate-50 dark:bg-white/5">
                  <td className="px-4 md:px-5 py-3 text-[12px] font-semibold text-slate-700 dark:text-white/80">
                    {lang === 'en' ? 'Net Margin' : 'Margen neto'}
                  </td>
                  <td className="px-4 md:px-5 py-3 text-[12px] font-bold text-slate-800 dark:text-white text-right">{(view.totals.margen || 0).toFixed(1)} %</td>
                  <td className="px-4 md:px-5 py-3 text-[12px] text-slate-500 dark:text-white/60 text-right">{(view.totals.margenPrev || 0).toFixed(1)} %</td>
                  <td />
                </tr>

                <SectionHeader label={lang === 'en' ? 'ITBIS (informational)' : 'ITBIS (informativo)'} />
                <Row label={lang === 'en' ? 'ITBIS Collected' : 'ITBIS Cobrado'}
                  cur={view.totals.itbisCobrado} prev={view.totals.itbisCobradoPrev}
                  delta={pctChange(view.totals.itbisCobrado, view.totals.itbisCobradoPrev)} />
                <Row label={lang === 'en' ? 'ITBIS Paid' : 'ITBIS Pagado'}
                  cur={view.totals.itbisPagado} prev={view.totals.itbisPagadoPrev}
                  delta={pctChange(view.totals.itbisPagado, view.totals.itbisPagadoPrev)} />
              </tbody>
            </table>
          </div>
        )}

        {!loading && view && view.rows.length === 0 && (
          <div className="bg-white dark:bg-white/5 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl px-5 py-8 text-center text-sm text-slate-400 dark:text-white/40">
            {lang === 'en'
              ? 'No ledger activity for this month yet. Sell, expense or close a ticket and refresh.'
              : 'Aún no hay movimiento contable este mes. Cobra, registra un gasto o cierra un ticket y actualiza.'}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-2 md:justify-end pt-2">
          <button onClick={onExportCsv} disabled={!view || loading}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] md:min-h-0 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 rounded-xl text-[12px] font-semibold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40">
            <Download size={14} /> CSV
          </button>
          <button onClick={onExportPdf} disabled={!view || loading}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] md:min-h-0 bg-[#b3001e] hover:bg-[#8f0017] rounded-xl text-[12px] font-bold text-white disabled:opacity-40">
            <FileText size={14} /> PDF
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ label }) {
  return (
    <tr>
      <td colSpan={4} className="px-4 md:px-5 pt-5 pb-2 text-[10px] font-bold tracking-widest text-[#b3001e] uppercase">
        {label}
      </td>
    </tr>
  )
}

function Row({ label, cur, prev, delta }) {
  return (
    <tr className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/5">
      <td className="px-4 md:px-5 py-2.5 text-[12px] text-slate-700 dark:text-white">{label}</td>
      <td className="px-4 md:px-5 py-2.5 text-[12px] font-semibold text-slate-800 dark:text-white text-right">{fmtRD(cur)}</td>
      <td className="px-4 md:px-5 py-2.5 text-[12px] text-slate-500 dark:text-white/60 text-right">{fmtRD(prev)}</td>
      <td className={`px-4 md:px-5 py-2.5 text-[11px] font-bold text-right ${delta == null ? 'text-slate-400 dark:text-white/40' : (delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#b3001e]')}`}>
        {fmtPct(delta)}
      </td>
    </tr>
  )
}

function TotalRow({ label, cur, prev, delta }) {
  return (
    <tr className="border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
      <td className="px-4 md:px-5 py-2.5 text-[12px] font-bold text-slate-800 dark:text-white">{label}</td>
      <td className="px-4 md:px-5 py-2.5 text-[12px] font-bold text-slate-800 dark:text-white text-right">{fmtRD(cur)}</td>
      <td className="px-4 md:px-5 py-2.5 text-[12px] font-semibold text-slate-600 dark:text-white/60 text-right">{fmtRD(prev)}</td>
      <td className={`px-4 md:px-5 py-2.5 text-[11px] font-bold text-right ${delta == null ? 'text-slate-400 dark:text-white/40' : (delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#b3001e]')}`}>
        {fmtPct(delta)}
      </td>
    </tr>
  )
}
