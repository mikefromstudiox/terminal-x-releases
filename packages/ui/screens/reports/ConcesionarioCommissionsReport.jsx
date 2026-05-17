/**
 * ConcesionarioCommissionsReport.jsx — H1 (v2.16.2).
 *
 * Per-vendedor commission breakdown for closed sales_deals over a date range.
 * Groups by salesperson_supabase_id (falls back to salesperson_id legacy int).
 * Exports CSV (Blob) + PDF (pdf-lib) using inline helpers — no dependency on
 * the existing csv.js/pdf.js builders since this report has its own column set.
 *
 * Currency: Intl.NumberFormat('es-DO', { style:'currency', currency:'DOP' }).
 * Crimson #b3001e accent on header band, totals row, and PDF section divider.
 */

import { useState, useEffect, useMemo } from 'react'
import { Loader2, Download, FileText, Calendar } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const fmtMoney = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })

function firstOfMonthISO() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function csvEscape(s) {
  const v = s == null ? '' : String(s)
  if (/[",\n;]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function downloadBlob(filename, data, mime = 'text/csv;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ConcesionarioCommissionsReport() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [from, setFrom] = useState(firstOfMonthISO())
  const [to,   setTo]   = useState(todayISO())
  const [deals, setDeals] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)
  const [exportingPdf, setExportingPdf] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [d, e] = await Promise.all([
        api.salesDeals?.list?.({ status: 'closed' }) || Promise.resolve([]),
        (api.empleados?.list?.() || api.empleados?.all?.() || Promise.resolve([])),
      ])
      setDeals((d || []).filter(x => {
        if (!x.closed_at) return false
        const ts = x.closed_at.slice(0, 10)
        return ts >= from && ts <= to
      }))
      setEmpleados(e || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [from, to]) // eslint-disable-line

  const empById = useMemo(() => {
    const m = new Map()
    for (const e of empleados) {
      if (e.supabase_id) m.set(e.supabase_id, e)
      if (e.id != null)  m.set(`int:${e.id}`, e)
    }
    return m
  }, [empleados])

  const rows = useMemo(() => {
    const acc = new Map()
    for (const d of deals) {
      const key = d.salesperson_supabase_id || (d.salesperson_id != null ? `int:${d.salesperson_id}` : '__none__')
      if (!acc.has(key)) {
        acc.set(key, {
          key,
          name: empById.get(key)?.nombre || (key === '__none__' ? L('Sin asignar', 'Unassigned') : '—'),
          deal_count: 0,
          total_ventas: 0,
          comision_bruta: 0,
          pagada: 0,
          pendiente: 0,
        })
      }
      const r = acc.get(key)
      r.deal_count += 1
      r.total_ventas   += Number(d.sale_price) || 0
      const com = Number(d.commission_amount) || 0
      r.comision_bruta += com
      if (d.commission_paid) r.pagada += com
      else r.pendiente += com
    }
    return [...acc.values()].sort((a, b) => b.comision_bruta - a.comision_bruta)
  }, [deals, empById, L])

  const totals = useMemo(() => rows.reduce((t, r) => ({
    deal_count:     t.deal_count + r.deal_count,
    total_ventas:   t.total_ventas + r.total_ventas,
    comision_bruta: t.comision_bruta + r.comision_bruta,
    pagada:         t.pagada + r.pagada,
    pendiente:      t.pendiente + r.pendiente,
  }), { deal_count: 0, total_ventas: 0, comision_bruta: 0, pagada: 0, pendiente: 0 }), [rows])

  function exportCSV() {
    const header = [L('Vendedor', 'Salesperson'), L('# Tratos', '# Deals'), L('Total Ventas', 'Total Sales'),
                    L('Comision Bruta', 'Gross Commission'), L('Pagada', 'Paid'), L('Pendiente', 'Pending')]
    const lines = [header.map(csvEscape).join(',')]
    for (const r of rows) {
      lines.push([r.name, r.deal_count, r.total_ventas.toFixed(2), r.comision_bruta.toFixed(2),
                  r.pagada.toFixed(2), r.pendiente.toFixed(2)].map(csvEscape).join(','))
    }
    lines.push([L('TOTAL', 'TOTAL'), totals.deal_count, totals.total_ventas.toFixed(2),
                totals.comision_bruta.toFixed(2), totals.pagada.toFixed(2), totals.pendiente.toFixed(2)].map(csvEscape).join(','))
    downloadBlob(`comisiones-concesionario-${from}-${to}.csv`, '﻿' + lines.join('\n'))
  }

  async function exportPDF() {
    setExportingPdf(true)
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
      const pdf = await PDFDocument.create()
      const page = pdf.addPage([595.28, 841.89]) // A4
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
      const { width, height } = page.getSize()
      let y = height - 50

      page.drawRectangle({ x: 40, y: y - 6, width: width - 80, height: 26, color: rgb(0.7019, 0, 0.1176) })
      page.drawText(L('Reporte de Comisiones — Concesionario', 'Commissions Report — Dealership'),
        { x: 50, y: y, size: 13, font: bold, color: rgb(1, 1, 1) })
      y -= 35
      page.drawText(`${L('Periodo', 'Period')}: ${from} -> ${to}`, { x: 50, y, size: 10, font })
      y -= 20

      const cols = [
        { label: L('Vendedor', 'Salesperson'), x: 50,  w: 150 },
        { label: L('# Tratos', '# Deals'),     x: 210, w: 50, align: 'right' },
        { label: L('Ventas', 'Sales'),         x: 270, w: 80, align: 'right' },
        { label: L('Comision', 'Commission'),  x: 360, w: 80, align: 'right' },
        { label: L('Pagada', 'Paid'),          x: 450, w: 60, align: 'right' },
        { label: L('Pend.', 'Pending'),        x: 510, w: 60, align: 'right' },
      ]
      page.drawLine({ start: { x: 40, y: y + 14 }, end: { x: width - 40, y: y + 14 }, thickness: 0.5 })
      for (const c of cols) {
        page.drawText(c.label, { x: c.align === 'right' ? c.x + c.w - bold.widthOfTextAtSize(c.label, 9) : c.x, y, size: 9, font: bold })
      }
      y -= 14
      page.drawLine({ start: { x: 40, y: y + 4 }, end: { x: width - 40, y: y + 4 }, thickness: 0.5 })

      function drawCell(text, c, isBold = false) {
        const f = isBold ? bold : font
        const t = String(text)
        const x = c.align === 'right' ? c.x + c.w - f.widthOfTextAtSize(t, 9) : c.x
        page.drawText(t, { x, y, size: 9, font: f })
      }

      for (const r of rows) {
        if (y < 60) break
        drawCell((r.name || '—').slice(0, 30), cols[0])
        drawCell(String(r.deal_count), cols[1])
        drawCell(fmtMoney.format(r.total_ventas), cols[2])
        drawCell(fmtMoney.format(r.comision_bruta), cols[3])
        drawCell(fmtMoney.format(r.pagada), cols[4])
        drawCell(fmtMoney.format(r.pendiente), cols[5])
        y -= 12
      }
      y -= 4
      page.drawLine({ start: { x: 40, y: y + 6 }, end: { x: width - 40, y: y + 6 }, thickness: 1, color: rgb(0.7019, 0, 0.1176) })
      drawCell(L('TOTAL', 'TOTAL'), cols[0], true)
      drawCell(String(totals.deal_count), cols[1], true)
      drawCell(fmtMoney.format(totals.total_ventas), cols[2], true)
      drawCell(fmtMoney.format(totals.comision_bruta), cols[3], true)
      drawCell(fmtMoney.format(totals.pagada), cols[4], true)
      drawCell(fmtMoney.format(totals.pendiente), cols[5], true)

      const bytes = await pdf.save()
      downloadBlob(`comisiones-concesionario-${from}-${to}.pdf`, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf')
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="p-3 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-5">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#b3001e] via-[#9a0019] to-[#7a0014] text-white px-4 md:px-6 py-4 md:py-5 shadow-sm">
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/[0.06] blur-2xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-10 w-44 h-44 rounded-full bg-white/[0.04] blur-2xl pointer-events-none" />
          <div className="relative flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center"><FileText size={18} /></div>
              <h1 className="text-[18px] md:text-[22px] font-black tracking-tight">{L('Comisiones', 'Commissions')}</h1>
            </div>
            <div className="text-[10px] uppercase tracking-[3px] text-white/85">{L('Tratos cerrados en el periodo', 'Closed deals in period')}</div>
          </div>
        </div>

        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 md:p-4">
          <div className="flex flex-col md:flex-row md:flex-wrap md:items-end gap-3">
            <div className="flex gap-2 flex-1 md:flex-none">
              <label className="text-xs flex-1 md:flex-none">
                <span className="font-semibold mb-1 flex items-center gap-1 text-slate-600 dark:text-white/70"><Calendar size={12} />{L('Desde', 'From')}</span>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full md:w-auto rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:border-[#b3001e] outline-none transition px-2 py-1.5 min-h-[40px] text-slate-800 dark:text-white" />
              </label>
              <label className="text-xs flex-1 md:flex-none">
                <span className="block font-semibold mb-1 text-slate-600 dark:text-white/70">{L('Hasta', 'To')}</span>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full md:w-auto rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:border-[#b3001e] outline-none transition px-2 py-1.5 min-h-[40px] text-slate-800 dark:text-white" />
              </label>
            </div>
            <div className="md:ml-auto flex gap-2 overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0">
              <button onClick={exportCSV} disabled={loading || rows.length === 0} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 shrink-0 min-h-[40px] transition-colors">
                <Download size={14} /><span className="hidden sm:inline">{L('Exportar CSV', 'Export CSV')}</span><span className="sm:hidden">CSV</span>
              </button>
              <button onClick={exportPDF} disabled={loading || rows.length === 0 || exportingPdf} className="px-3 py-2 rounded-xl bg-[#b3001e] hover:bg-[#9a0019] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 shrink-0 min-h-[40px] transition-colors">
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}<span className="hidden sm:inline">{L('Exportar PDF', 'Export PDF')}</span><span className="sm:hidden">PDF</span>
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-10 md:p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-3">
              <Loader2 className="animate-spin text-slate-400 dark:text-white/40" size={20} />
            </div>
            <div className="text-[14px] font-bold text-slate-700 dark:text-white">{L('Cargando...', 'Loading...')}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-10 md:p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-3">
              <FileText className="text-slate-400 dark:text-white/40" size={20} />
            </div>
            <div className="text-[14px] font-bold text-slate-700 dark:text-white">{L('Sin tratos cerrados en el periodo.', 'No closed deals in the period.')}</div>
            <div className="text-[11px] text-slate-400 dark:text-white/40 mt-1">{L('Ajusta el rango de fechas.', 'Adjust the date range.')}</div>
          </div>
        ) : (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-bold">{L('Vendedor', 'Salesperson')}</th>
                    <th className="text-right px-3 py-2.5 font-bold">{L('# Tratos', '# Deals')}</th>
                    <th className="text-right px-3 py-2.5 font-bold">{L('Total Ventas', 'Total Sales')}</th>
                    <th className="text-right px-3 py-2.5 font-bold">{L('Comision Bruta', 'Gross Commission')}</th>
                    <th className="text-right px-3 py-2.5 font-bold">{L('Pagada', 'Paid')}</th>
                    <th className="text-right px-3 py-2.5 font-bold">{L('Pendiente', 'Pending')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key} className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors">
                      <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-white">{r.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-white/80">{r.deal_count}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-white/80">{fmtMoney.format(r.total_ventas)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800 dark:text-white">{fmtMoney.format(r.comision_bruta)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-white/80">{fmtMoney.format(r.pagada)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.pendiente > 0 ? <span className="text-[#b3001e] font-semibold">{fmtMoney.format(r.pendiente)}</span> : <span className="text-slate-400 dark:text-white/40">{fmtMoney.format(0)}</span>}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[#b3001e] bg-[#b3001e]/[0.04] dark:bg-[#b3001e]/[0.08] font-bold">
                    <td className="px-3 py-2.5 text-slate-900 dark:text-white">{L('TOTAL', 'TOTAL')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{totals.deal_count}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{fmtMoney.format(totals.total_ventas)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{fmtMoney.format(totals.comision_bruta)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{fmtMoney.format(totals.pagada)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#b3001e]">{fmtMoney.format(totals.pendiente)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
