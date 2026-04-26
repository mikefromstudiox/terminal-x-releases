/**
 * InventoryAgingReport.jsx — Sprint 2D M7.
 *
 * Days-on-lot bucketed (0-30, 31-60, 61-90, >90) report for vehicle_inventory.
 * Inline pdf-lib export to match ConcesionarioCommissionsReport style.
 * Crimson #b3001e accent on header band, >90d row left border, totals divider.
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Download, FileText, Filter } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const fmtMoney = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })

const STATUS_TABS = [
  { v: 'available',  es: 'Disponible',  en: 'Available' },
  { v: 'reserved',   es: 'Reservado',   en: 'Reserved' },
  { v: 'sold',       es: 'Vendido',     en: 'Sold' },
  { v: 'in_service', es: 'En Servicio', en: 'In Service' },
  { v: 'all',        es: 'Todos',       en: 'All' },
]

const BUCKET_TABS = [
  { v: 'all',  label: 'Todos' },
  { v: '0-30', label: '0-30' },
  { v: '31-60', label: '31-60' },
  { v: '61-90', label: '61-90' },
  { v: '>90',  label: '>90' },
]

function bucketOf(days) {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '>90'
}

function bucketRowCls(b) {
  switch (b) {
    case '0-30':  return 'bg-white'
    case '31-60': return 'bg-slate-50 dark:bg-white/5'
    case '61-90': return 'bg-amber-50 text-amber-900 dark:bg-amber-900/20'
    case '>90':   return 'bg-red-50 text-red-900 dark:bg-red-900/20 border-l-4 border-[#b3001e]'
    default:      return ''
  }
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

export default function InventoryAgingReport() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('available')
  const [bucketFilter, setBucketFilter] = useState('all')
  const [exportingPdf, setExportingPdf] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const rows = await (api.vehicleInventory?.list?.() || Promise.resolve([]))
      setUnits(rows || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const today = useMemo(() => Date.now(), [])

  const enriched = useMemo(() => {
    return (units || []).map(u => {
      const ts = u.listing_date ? new Date(u.listing_date).getTime() : (u.created_at ? new Date(u.created_at).getTime() : today)
      const days = Math.max(0, Math.floor((today - ts) / 86400000))
      return { ...u, _days: days, _bucket: bucketOf(days) }
    })
  }, [units, today])

  const filtered = useMemo(() => {
    return enriched.filter(u => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false
      if (bucketFilter !== 'all' && u._bucket !== bucketFilter) return false
      return true
    }).sort((a, b) => b._days - a._days)
  }, [enriched, statusFilter, bucketFilter])

  const totals = useMemo(() => {
    const acc = { '0-30': 0, '31-60': 0, '61-90': 0, '>90': 0, value: 0 }
    for (const u of filtered) {
      acc[u._bucket] = (acc[u._bucket] || 0) + 1
      acc.value += Number(u.listing_price) || 0
    }
    return acc
  }, [filtered])

  function exportCSV() {
    const header = [L('# Stock', 'Stock #'), 'VIN', L('Marca', 'Make'), L('Modelo', 'Model'),
      L('Año', 'Year'), L('Color', 'Color'), L('Dias en lote', 'Days on lot'),
      L('Estado', 'Status'), L('Precio', 'Price'), L('Condicion', 'Condition'), L('Bucket', 'Bucket')]
    const lines = [header.map(csvEscape).join(',')]
    for (const u of filtered) {
      lines.push([
        u.stock_number || '', u.vin || '', u.make || '', u.model || '',
        u.year || '', u.color || '', u._days, u.status || '',
        Number(u.listing_price || 0).toFixed(2), u.condition || '', u._bucket,
      ].map(csvEscape).join(','))
    }
    lines.push([])
    lines.push([L('TOTALES por bucket', 'Bucket totals')].map(csvEscape).join(','))
    for (const b of ['0-30', '31-60', '61-90', '>90']) {
      lines.push([b, totals[b] || 0].map(csvEscape).join(','))
    }
    lines.push([L('Valor total inventario', 'Total inventory value'), totals.value.toFixed(2)].map(csvEscape).join(','))
    downloadBlob(`antiguedad-inventario-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\n'))
  }

  async function exportPDF() {
    setExportingPdf(true)
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
      const pdf = await PDFDocument.create()
      let page = pdf.addPage([595.28, 841.89]) // A4
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
      const { width, height } = page.getSize()
      let y = height - 50

      page.drawRectangle({ x: 40, y: y - 6, width: width - 80, height: 26, color: rgb(0.7019, 0, 0.1176) })
      page.drawText(L('Reporte de Antiguedad de Inventario', 'Inventory Aging Report'),
        { x: 50, y, size: 13, font: bold, color: rgb(1, 1, 1) })
      y -= 32
      page.drawText(`${L('Estado', 'Status')}: ${statusFilter} | ${L('Bucket', 'Bucket')}: ${bucketFilter}`, { x: 50, y, size: 9, font })
      y -= 18

      const cols = [
        { label: 'Stock',                       x: 50,  w: 55 },
        { label: L('Vehiculo', 'Vehicle'),      x: 105, w: 145 },
        { label: 'VIN',                         x: 250, w: 110 },
        { label: L('Dias', 'Days'),             x: 360, w: 35, align: 'right' },
        { label: L('Estado', 'Status'),         x: 400, w: 60 },
        { label: L('Precio', 'Price'),          x: 460, w: 95, align: 'right' },
      ]
      page.drawLine({ start: { x: 40, y: y + 14 }, end: { x: width - 40, y: y + 14 }, thickness: 0.5 })
      for (const c of cols) {
        page.drawText(c.label, { x: c.align === 'right' ? c.x + c.w - bold.widthOfTextAtSize(c.label, 9) : c.x, y, size: 9, font: bold })
      }
      y -= 14
      page.drawLine({ start: { x: 40, y: y + 4 }, end: { x: width - 40, y: y + 4 }, thickness: 0.5 })

      function drawCell(text, c, isBold = false, color) {
        const f = isBold ? bold : font
        const t = String(text)
        const x = c.align === 'right' ? c.x + c.w - f.widthOfTextAtSize(t, 9) : c.x
        const opts = { x, y, size: 9, font: f }
        if (color) opts.color = color
        page.drawText(t, opts)
      }

      for (const u of filtered) {
        if (y < 70) {
          page = pdf.addPage([595.28, 841.89])
          y = page.getSize().height - 50
        }
        const veh = `${u.year || ''} ${u.make || ''} ${u.model || ''}`.trim()
        const isOld = u._bucket === '>90'
        const color = isOld ? rgb(0.7019, 0, 0.1176) : undefined
        drawCell((u.stock_number || '—').slice(0, 10), cols[0], false, color)
        drawCell(veh.slice(0, 28), cols[1], false, color)
        drawCell((u.vin || '—').slice(0, 17), cols[2], false, color)
        drawCell(String(u._days), cols[3], false, color)
        drawCell(u.status || '—', cols[4], false, color)
        drawCell(fmtMoney.format(Number(u.listing_price) || 0), cols[5], false, color)
        y -= 12
      }

      y -= 6
      if (y < 80) { page = pdf.addPage([595.28, 841.89]); y = page.getSize().height - 50 }
      page.drawLine({ start: { x: 40, y: y + 6 }, end: { x: width - 40, y: y + 6 }, thickness: 1, color: rgb(0.7019, 0, 0.1176) })
      page.drawText(L('Totales por bucket', 'Bucket totals'), { x: 50, y, size: 10, font: bold })
      y -= 14
      for (const b of ['0-30', '31-60', '61-90', '>90']) {
        page.drawText(`${b}: ${totals[b] || 0}`, { x: 50, y, size: 9, font })
        y -= 12
      }
      y -= 4
      page.drawText(`${L('Valor total inventario', 'Total inventory value')}: ${fmtMoney.format(totals.value)}`,
        { x: 50, y, size: 10, font: bold })

      const bytes = await pdf.save()
      downloadBlob(`antiguedad-inventario-${new Date().toISOString().slice(0, 10)}.pdf`,
        new Blob([bytes], { type: 'application/pdf' }), 'application/pdf')
    } finally { setExportingPdf(false) }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-[#b3001e] text-white px-5 py-3 mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2"><FileText size={20} />{L('Reporte de Antigüedad de Inventario', 'Inventory Aging Report')}</h1>
        <div className="text-xs">{L('Dias en lote por unidad', 'Days on lot per unit')}</div>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <label className="text-xs">
          <span className="block font-semibold mb-1 flex items-center gap-1"><Filter size={12}/>{L('Estado', 'Status')}</span>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-black px-2 py-1.5">
            {STATUS_TABS.map(s => <option key={s.v} value={s.v}>{lang === 'es' ? s.es : s.en}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block font-semibold mb-1">{L('Bucket', 'Bucket')}</span>
          <select value={bucketFilter} onChange={e => setBucketFilter(e.target.value)} className="border border-black px-2 py-1.5">
            {BUCKET_TABS.map(b => <option key={b.v} value={b.v}>{b.label}</option>)}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={exportCSV} disabled={loading || filtered.length === 0} className="px-3 py-2 border border-black text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            <Download size={14}/>{L('Exportar CSV', 'Export CSV')}
          </button>
          <button onClick={exportPDF} disabled={loading || filtered.length === 0 || exportingPdf} className="px-3 py-2 bg-black text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {exportingPdf ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
            {L('Exportar PDF', 'Export PDF')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto"/></div>
      ) : filtered.length === 0 ? (
        <div className="border border-black p-12 text-center text-sm">{L('Sin unidades en inventario.', 'No units in inventory.')}</div>
      ) : (
        <div className="border border-black overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">Stock</th>
                <th className="text-left px-3 py-2">VIN</th>
                <th className="text-left px-3 py-2">{L('Vehiculo', 'Vehicle')}</th>
                <th className="text-left px-3 py-2">{L('Color', 'Color')}</th>
                <th className="text-right px-3 py-2">{L('Dias en lote', 'Days on lot')}</th>
                <th className="text-left px-3 py-2">{L('Estado', 'Status')}</th>
                <th className="text-right px-3 py-2">{L('Precio', 'Price')}</th>
                <th className="text-left px-3 py-2">{L('Condicion', 'Condition')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className={`border-t border-black/10 ${bucketRowCls(u._bucket)}`}>
                  <td className="px-3 py-2 font-mono text-xs">{u.stock_number || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{u.vin || '—'}</td>
                  <td className="px-3 py-2 font-semibold">{u.year || ''} {u.make || ''} {u.model || ''}</td>
                  <td className="px-3 py-2">{u.color || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{u._days}</td>
                  <td className="px-3 py-2">
                    <span className="inline-block px-2 py-0.5 text-xs font-semibold border border-black bg-white text-black">{u.status || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney.format(Number(u.listing_price) || 0)}</td>
                  <td className="px-3 py-2 capitalize">{u.condition || '—'}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[#b3001e] bg-black/5 font-bold">
                <td className="px-3 py-2" colSpan={4}>
                  {L('Totales por bucket', 'Bucket totals')}: 0-30={totals['0-30'] || 0} · 31-60={totals['31-60'] || 0} · 61-90={totals['61-90'] || 0} · &gt;90={totals['>90'] || 0}
                </td>
                <td className="px-3 py-2 text-right">{filtered.length}</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right">{fmtMoney.format(totals.value)}</td>
                <td className="px-3 py-2"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
