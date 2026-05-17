/**
 * TestDriveFunnelReport.jsx — Sprint 2E item 4.
 *
 * Conversion funnel for the dealership vertical:
 *   leads -> scheduled (test drive scheduled) -> completed -> converted (deal)
 *
 * Per-vendedor breakdown with leads / test drives / conversiones / % conversion.
 * Top 5 marca/modelo más probadas. Top 5 más convertidas.
 *
 * Export CSV + PDF (mirrors InventoryAgingReport / ConcesionarioCommissionsReport).
 * Currency RD$ via Intl.NumberFormat('es-DO', {style:'currency', currency:'DOP'}).
 */

import { useState, useEffect, useMemo } from 'react'
import { Loader2, Download, Calendar, TrendingUp } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const fmtMoney = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })
void fmtMoney // reserved for future revenue rows

function firstOfMonthISO() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

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
function pct(num, den) {
  if (!den) return '0.0%'
  return ((num / den) * 100).toFixed(1) + '%'
}

export default function TestDriveFunnelReport() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [from, setFrom] = useState(firstOfMonthISO())
  const [to,   setTo]   = useState(todayISO())
  const [leads, setLeads] = useState([])
  const [testDrives, setTestDrives] = useState([])
  const [deals, setDeals] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)
  const [exportingPdf, setExportingPdf] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [l, td, d, v, e] = await Promise.all([
        api.leads?.list?.() || Promise.resolve([]),
        api.testDrives?.list?.() || Promise.resolve([]),
        api.salesDeals?.list?.({ status: 'closed' }) || Promise.resolve([]),
        api.vehicleInventory?.list?.() || Promise.resolve([]),
        api.empleados?.list?.() || api.empleados?.all?.() || Promise.resolve([]),
      ])
      const inRange = (iso) => {
        if (!iso) return false
        const day = String(iso).slice(0, 10)
        return day >= from && day <= to
      }
      setLeads((l || []).filter(x => inRange(x.created_at)))
      setTestDrives((td || []).filter(x => inRange(x.created_at) || inRange(x.scheduled_at)))
      setDeals((d || []).filter(x => inRange(x.closed_at)))
      setVehicles(v || [])
      setEmpleados(e || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [from, to]) // eslint-disable-line

  const vehicleById = useMemo(() => {
    const m = new Map()
    for (const v of vehicles) {
      if (v.id != null) m.set(`int:${v.id}`, v)
      if (v.supabase_id) m.set(v.supabase_id, v)
    }
    return m
  }, [vehicles])

  const funnel = useMemo(() => {
    const leadsCount = leads.length
    const scheduled  = testDrives.length
    const completed  = testDrives.filter(td => td.status === 'completed' || td.completed_at).length
    const converted  = deals.length
    return { leadsCount, scheduled, completed, converted }
  }, [leads, testDrives, deals])

  const salespersonRows = useMemo(() => {
    const acc = new Map()
    function pick(k, name) {
      if (!acc.has(k)) acc.set(k, { key: k, name: name || '—', leads: 0, drives: 0, deals: 0 })
      return acc.get(k)
    }
    // v2.16.10 — schema-drift fix. leads has salesperson_supabase_id (no
    // assigned_to_supabase_id). test_drives has staff_supabase_id (no
    // salesperson_supabase_id). Audit 2026-04-30 — every funnel row was
    // bucketing into __none__.
    for (const lead of leads) {
      const k = lead.salesperson_supabase_id || (lead.salesperson_id ? `int:${lead.salesperson_id}` : '__none__')
      const e = empleados.find(x => x.supabase_id === k || `int:${x.id}` === k)
      pick(k, e?.nombre).leads += 1
    }
    for (const td of testDrives) {
      const k = td.staff_supabase_id || (td.staff_id ? `int:${td.staff_id}` : '__none__')
      const e = empleados.find(x => x.supabase_id === k || `int:${x.id}` === k)
      pick(k, e?.nombre).drives += 1
    }
    for (const d of deals) {
      const k = d.salesperson_supabase_id || (d.salesperson_id ? `int:${d.salesperson_id}` : '__none__')
      const e = empleados.find(x => x.supabase_id === k || `int:${x.id}` === k)
      pick(k, e?.nombre).deals += 1
    }
    return [...acc.values()].sort((a, b) => b.deals - a.deals)
  }, [leads, testDrives, deals, empleados])

  function makeModel(v) {
    if (!v) return '—'
    return [v.make, v.model].filter(Boolean).join(' ').trim() || '—'
  }
  const topTested = useMemo(() => {
    const counts = new Map()
    for (const td of testDrives) {
      const v = vehicleById.get(td.vehicle_inventory_supabase_id) || vehicleById.get(`int:${td.vehicle_inventory_id}`)
      const k = makeModel(v)
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [testDrives, vehicleById])
  const topConverted = useMemo(() => {
    const counts = new Map()
    for (const d of deals) {
      const v = vehicleById.get(d.vehicle_inventory_supabase_id) || vehicleById.get(`int:${d.vehicle_inventory_id}`)
      const k = makeModel(v)
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [deals, vehicleById])

  function exportCSV() {
    const lines = []
    lines.push(L('# Funnel', '# Funnel'))
    lines.push([L('Etapa', 'Stage'), L('Cantidad', 'Count')].map(csvEscape).join(','))
    lines.push([L('Leads', 'Leads'), funnel.leadsCount].map(csvEscape).join(','))
    lines.push([L('Pruebas agendadas', 'Test drives scheduled'), funnel.scheduled].map(csvEscape).join(','))
    lines.push([L('Pruebas completadas', 'Test drives completed'), funnel.completed].map(csvEscape).join(','))
    lines.push([L('Convertidos a trato', 'Converted to deal'), funnel.converted].map(csvEscape).join(','))
    lines.push('')
    lines.push(L('# Por vendedor', '# By salesperson'))
    lines.push([L('Vendedor', 'Salesperson'), L('Leads', 'Leads'), L('Pruebas', 'Drives'), L('Conversiones', 'Conversions'), L('% Conv', '% Conv')].map(csvEscape).join(','))
    for (const r of salespersonRows) {
      lines.push([r.name, r.leads, r.drives, r.deals, pct(r.deals, r.leads)].map(csvEscape).join(','))
    }
    lines.push('')
    lines.push(L('# Top 5 mas probados', '# Top 5 most tested'))
    for (const [n, c] of topTested) lines.push([n, c].map(csvEscape).join(','))
    lines.push('')
    lines.push(L('# Top 5 mas convertidos', '# Top 5 most converted'))
    for (const [n, c] of topConverted) lines.push([n, c].map(csvEscape).join(','))
    downloadBlob(`funnel-concesionario-${from}-${to}.csv`, '﻿' + lines.join('\n'))
  }

  async function exportPDF() {
    setExportingPdf(true)
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
      const pdf = await PDFDocument.create()
      const page = pdf.addPage([595.28, 841.89])
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
      const { width, height } = page.getSize()
      let y = height - 50

      page.drawRectangle({ x: 40, y: y - 6, width: width - 80, height: 26, color: rgb(0.7019, 0, 0.1176) })
      page.drawText(L('Funnel de Conversion - Concesionario', 'Conversion Funnel - Dealership'),
        { x: 50, y, size: 13, font: bold, color: rgb(1, 1, 1) })
      y -= 35
      page.drawText(`${L('Periodo', 'Period')}: ${from} -> ${to}`, { x: 50, y, size: 10, font })
      y -= 20

      function section(title) {
        y -= 6
        page.drawLine({ start: { x: 40, y: y + 12 }, end: { x: width - 40, y: y + 12 }, thickness: 0.5, color: rgb(0.7019, 0, 0.1176) })
        page.drawText(title, { x: 40, y, size: 11, font: bold, color: rgb(0.7019, 0, 0.1176) })
        y -= 16
      }
      function line(a, b) {
        page.drawText(String(a), { x: 50, y, size: 10, font })
        const txt = String(b)
        page.drawText(txt, { x: width - 50 - bold.widthOfTextAtSize(txt, 10), y, size: 10, font: bold })
        y -= 14
      }

      section(L('Funnel', 'Funnel'))
      line(L('Leads', 'Leads'), funnel.leadsCount)
      line(L('Pruebas agendadas', 'Test drives scheduled'), `${funnel.scheduled} (${pct(funnel.scheduled, funnel.leadsCount)})`)
      line(L('Pruebas completadas', 'Test drives completed'), `${funnel.completed} (${pct(funnel.completed, funnel.scheduled)})`)
      line(L('Convertidos a trato', 'Converted to deal'), `${funnel.converted} (${pct(funnel.converted, funnel.completed)})`)

      section(L('Por vendedor', 'By salesperson'))
      for (const r of salespersonRows) {
        if (y < 100) break
        line(r.name, `${r.leads} L - ${r.drives} TD - ${r.deals} D (${pct(r.deals, r.leads)})`)
      }
      section(L('Top 5 mas probados', 'Top 5 most tested'))
      for (const [n, c] of topTested) { if (y < 80) break; line(n, c) }
      section(L('Top 5 mas convertidos', 'Top 5 most converted'))
      for (const [n, c] of topConverted) { if (y < 60) break; line(n, c) }

      const bytes = await pdf.save()
      downloadBlob(`funnel-concesionario-${from}-${to}.pdf`, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf')
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
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center"><TrendingUp size={18} /></div>
              <h1 className="text-[18px] md:text-[22px] font-black tracking-tight">{L('Funnel de Conversion', 'Conversion Funnel')}</h1>
            </div>
            <div className="text-[10px] uppercase tracking-[3px] text-white/85">{L('Pruebas de manejo + cierres', 'Test drives + closures')}</div>
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
              <button onClick={exportCSV} disabled={loading} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 shrink-0 min-h-[40px] transition-colors">
                <Download size={14} /><span className="hidden sm:inline">{L('Exportar CSV', 'Export CSV')}</span><span className="sm:hidden">CSV</span>
              </button>
              <button onClick={exportPDF} disabled={loading || exportingPdf} className="px-3 py-2 rounded-xl bg-[#b3001e] hover:bg-[#9a0019] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 shrink-0 min-h-[40px] transition-colors">
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
        ) : (
          <div className="space-y-4 md:space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              <FunnelCard label={L('Leads', 'Leads')} value={funnel.leadsCount} />
              <FunnelCard label={L('Pruebas agendadas', 'Drives scheduled')} value={funnel.scheduled} pctLabel={pct(funnel.scheduled, funnel.leadsCount)} />
              <FunnelCard label={L('Completadas', 'Completed')} value={funnel.completed} pctLabel={pct(funnel.completed, funnel.scheduled)} />
              <FunnelCard label={L('Convertidos', 'Converted')} value={funnel.converted} pctLabel={pct(funnel.converted, funnel.completed)} accent />
            </div>

            <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-bold">{L('Vendedor', 'Salesperson')}</th>
                      <th className="text-right px-3 py-2.5 font-bold">{L('Leads', 'Leads')}</th>
                      <th className="text-right px-3 py-2.5 font-bold">{L('Pruebas', 'Drives')}</th>
                      <th className="text-right px-3 py-2.5 font-bold">{L('Conversiones', 'Conversions')}</th>
                      <th className="text-right px-3 py-2.5 font-bold">{L('% Conversion', '% Conversion')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salespersonRows.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-[12px] text-slate-400 dark:text-white/40">{L('Sin actividad en el periodo.', 'No activity in the period.')}</td></tr>
                    ) : salespersonRows.map(r => (
                      <tr key={r.key} className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors">
                        <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-white">{r.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-white/80">{r.leads}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-white/80">{r.drives}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800 dark:text-white">{r.deals}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[#b3001e] font-bold">{pct(r.deals, r.leads)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 md:gap-5">
              <TopList title={L('Top 5 mas probados', 'Top 5 most tested')} rows={topTested} />
              <TopList title={L('Top 5 mas convertidos', 'Top 5 most converted')} rows={topConverted} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FunnelCard({ label, value, pctLabel, accent }) {
  return (
    <div className={`rounded-2xl p-4 md:p-5 border transition-all ${accent
      ? 'border-[#b3001e]/30 ring-1 ring-[#b3001e]/10 bg-gradient-to-br from-[#b3001e]/[0.06] via-white to-white dark:via-black dark:to-black'
      : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10'}`}>
      <div className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400 dark:text-white/40">{label}</div>
      <div className={`text-[22px] md:text-[28px] font-black tabular-nums leading-none mt-2 ${accent ? 'text-[#b3001e]' : 'text-slate-900 dark:text-white'}`}>{value}</div>
      {pctLabel && <div className={`text-[11px] mt-1.5 tabular-nums ${accent ? 'text-[#b3001e]/80 font-semibold' : 'text-slate-400 dark:text-white/40'}`}>{pctLabel}</div>}
    </div>
  )
}

function TopList({ title, rows }) {
  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-slate-50 dark:bg-white/[0.03] px-3 py-2.5 text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-white/40">{title}</div>
      <ul className="divide-y divide-slate-100 dark:divide-white/5">
        {rows.length === 0 ? (
          <li className="px-3 py-4 text-[12px] text-slate-400 dark:text-white/40 text-center">—</li>
        ) : rows.map(([name, count]) => (
          <li key={name} className="px-3 py-2.5 flex items-center justify-between text-sm hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors">
            <span className="truncate text-slate-800 dark:text-white font-medium">{name}</span>
            <span className="font-bold tabular-nums text-slate-900 dark:text-white">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
