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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="bg-[#b3001e] text-white px-5 py-3 mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2"><FileText size={20} />{L('Comisiones Concesionario', 'Dealership Commissions')}</h1>
        <div className="text-xs">{L('Tratos cerrados en el periodo', 'Closed deals in period')}</div>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <label className="text-xs">
          <span className="block font-semibold mb-1 flex items-center gap-1"><Calendar size={12} />{L('Desde', 'From')}</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-black px-2 py-1.5" />
        </label>
        <label className="text-xs">
          <span className="block font-semibold mb-1">{L('Hasta', 'To')}</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-black px-2 py-1.5" />
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={exportCSV} disabled={loading || rows.length === 0} className="px-3 py-2 border border-black text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            <Download size={14} />{L('Exportar CSV', 'Export CSV')}
          </button>
          <button onClick={exportPDF} disabled={loading || rows.length === 0 || exportingPdf} className="px-3 py-2 bg-black text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{L('Exportar PDF', 'Export PDF')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : rows.length === 0 ? (
        <div className="border border-black p-12 text-center text-sm">{L('Sin tratos cerrados en el periodo.', 'No closed deals in the period.')}</div>
      ) : (
        <div className="border border-black overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">{L('Vendedor', 'Salesperson')}</th>
                <th className="text-right px-3 py-2">{L('# Tratos', '# Deals')}</th>
                <th className="text-right px-3 py-2">{L('Total Ventas', 'Total Sales')}</th>
                <th className="text-right px-3 py-2">{L('Comision Bruta', 'Gross Commission')}</th>
                <th className="text-right px-3 py-2">{L('Pagada', 'Paid')}</th>
                <th className="text-right px-3 py-2">{L('Pendiente', 'Pending')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className="border-t border-black/10 hover:bg-black/5">
                  <td className="px-3 py-2 font-semibold">{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.deal_count}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney.format(r.total_ventas)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtMoney.format(r.comision_bruta)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney.format(r.pagada)}</td>
                  <td className="px-3 py-2 text-right">{r.pendiente > 0 ? <span className="text-[#b3001e] font-semibold">{fmtMoney.format(r.pendiente)}</span> : fmtMoney.format(0)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[#b3001e] bg-black/5 font-bold">
                <td className="px-3 py-2">{L('TOTAL', 'TOTAL')}</td>
                <td className="px-3 py-2 text-right">{totals.deal_count}</td>
                <td className="px-3 py-2 text-right">{fmtMoney.format(totals.total_ventas)}</td>
                <td className="px-3 py-2 text-right">{fmtMoney.format(totals.comision_bruta)}</td>
                <td className="px-3 py-2 text-right">{fmtMoney.format(totals.pagada)}</td>
                <td className="px-3 py-2 text-right">{fmtMoney.format(totals.pendiente)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
