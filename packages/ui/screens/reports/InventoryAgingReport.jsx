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
    case '0-30':  return ''
    case '31-60': return ''
    case '61-90': return 'bg-amber-50/60 dark:bg-amber-500/[0.06]'
    case '>90':   return 'bg-[#b3001e]/[0.05] dark:bg-[#b3001e]/[0.1] border-l-4 border-l-[#b3001e]'
    default:      return ''
  }
}

function bucketBadgeCls(b) {
  switch (b) {
    case '0-30':  return 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white/70 border border-slate-200 dark:border-white/10'
    case '31-60': return 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white/70 border border-slate-200 dark:border-white/10'
    case '61-90': return 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-500/30'
    case '>90':   return 'bg-[#b3001e]/10 dark:bg-[#b3001e]/20 text-[#b3001e] border border-[#b3001e]/20'
    default:      return 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white/70'
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
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="p-3 md:p-6 max-w-7xl mx-auto space-y-4 md:space-y-5">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#b3001e] via-[#9a0019] to-[#7a0014] text-white px-4 md:px-6 py-4 md:py-5 shadow-sm">
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/[0.06] blur-2xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-10 w-44 h-44 rounded-full bg-white/[0.04] blur-2xl pointer-events-none" />
          <div className="relative flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center"><FileText size={18} /></div>
              <h1 className="text-[18px] md:text-[22px] font-black tracking-tight">{L('Antigüedad de Inventario', 'Inventory Aging')}</h1>
            </div>
            <div className="text-[10px] uppercase tracking-[3px] text-white/85">{L('Dias en lote por unidad', 'Days on lot per unit')}</div>
          </div>
        </div>

        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 md:p-4">
          <div className="flex flex-col md:flex-row md:flex-wrap md:items-end gap-3">
            <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
              <label className="text-xs">
                <span className="font-semibold mb-1 flex items-center gap-1 text-slate-600 dark:text-white/70"><Filter size={12}/>{L('Estado', 'Status')}</span>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full md:w-auto rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:border-[#b3001e] outline-none transition px-2 py-1.5 min-h-[40px] text-slate-800 dark:text-white">
                  {STATUS_TABS.map(s => <option key={s.v} value={s.v}>{lang === 'es' ? s.es : s.en}</option>)}
                </select>
              </label>
              <label className="text-xs">
                <span className="block font-semibold mb-1 text-slate-600 dark:text-white/70">{L('Bucket', 'Bucket')}</span>
                <select value={bucketFilter} onChange={e => setBucketFilter(e.target.value)} className="w-full md:w-auto rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:border-[#b3001e] outline-none transition px-2 py-1.5 min-h-[40px] text-slate-800 dark:text-white">
                  {BUCKET_TABS.map(b => <option key={b.v} value={b.v}>{b.label}</option>)}
                </select>
              </label>
            </div>
            <div className="md:ml-auto flex gap-2 overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0">
              <button onClick={exportCSV} disabled={loading || filtered.length === 0} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 shrink-0 min-h-[40px] transition-colors">
                <Download size={14}/><span className="hidden sm:inline">{L('Exportar CSV', 'Export CSV')}</span><span className="sm:hidden">CSV</span>
              </button>
              <button onClick={exportPDF} disabled={loading || filtered.length === 0 || exportingPdf} className="px-3 py-2 rounded-xl bg-[#b3001e] hover:bg-[#9a0019] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 shrink-0 min-h-[40px] transition-colors">
                {exportingPdf ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
                <span className="hidden sm:inline">{L('Exportar PDF', 'Export PDF')}</span><span className="sm:hidden">PDF</span>
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
        ) : filtered.length === 0 ? (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-10 md:p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-3">
              <Filter className="text-slate-400 dark:text-white/40" size={20} />
            </div>
            <div className="text-[14px] font-bold text-slate-700 dark:text-white">{L('Sin unidades en inventario.', 'No units in inventory.')}</div>
            <div className="text-[11px] text-slate-400 dark:text-white/40 mt-1">{L('Cambia los filtros para ver más resultados.', 'Adjust filters to see more results.')}</div>
          </div>
        ) : (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-bold">Stock</th>
                    <th className="text-left px-3 py-2.5 font-bold">VIN</th>
                    <th className="text-left px-3 py-2.5 font-bold">{L('Vehiculo', 'Vehicle')}</th>
                    <th className="text-left px-3 py-2.5 font-bold">{L('Color', 'Color')}</th>
                    <th className="text-right px-3 py-2.5 font-bold">{L('Dias en lote', 'Days on lot')}</th>
                    <th className="text-left px-3 py-2.5 font-bold">{L('Estado', 'Status')}</th>
                    <th className="text-right px-3 py-2.5 font-bold">{L('Precio', 'Price')}</th>
                    <th className="text-left px-3 py-2.5 font-bold">{L('Condicion', 'Condition')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id} className={`border-t border-slate-100 dark:border-white/5 hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors ${bucketRowCls(u._bucket)}`}>
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-800 dark:text-white">{u.stock_number || '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600 dark:text-white/70">{u.vin || '—'}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-white">{u.year || ''} {u.make || ''} {u.model || ''}</td>
                      <td className="px-3 py-2.5 text-slate-700 dark:text-white/80">{u.color || '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-xs ${bucketBadgeCls(u._bucket)}`}>{u._days}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white/70 border border-slate-200 dark:border-white/10 capitalize">{u.status || '—'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800 dark:text-white">{fmtMoney.format(Number(u.listing_price) || 0)}</td>
                      <td className="px-3 py-2.5 capitalize text-slate-700 dark:text-white/80">{u.condition || '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[#b3001e] bg-[#b3001e]/[0.04] dark:bg-[#b3001e]/[0.08] font-bold">
                    <td className="px-3 py-2.5 text-slate-900 dark:text-white" colSpan={4}>
                      {L('Totales por bucket', 'Bucket totals')}: 0-30={totals['0-30'] || 0} · 31-60={totals['31-60'] || 0} · 61-90={totals['61-90'] || 0} · &gt;90={totals['>90'] || 0}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{filtered.length}</td>
                    <td className="px-3 py-2.5"></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{fmtMoney.format(totals.value)}</td>
                    <td className="px-3 py-2.5"></td>
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
