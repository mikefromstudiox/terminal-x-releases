/**
 * SBReport.jsx — v2.16.2 Superintendencia de Bancos exporter (CSV-only).
 *
 * Route: /lending/reporte-sb
 *
 * Exports 3 CSVs (Cartera Activa, Mora Aging, Redenciones) for the chosen
 * Mes/Año filter. The PDF SB button is disabled with a tooltip until Mike
 * provides the official template — see the amber banner.
 *
 * CSV builder is intentionally tiny (no extra deps): JSON.stringify-quoted
 * values, comma-joined, UTF-8 BOM prefix so Excel opens it correctly.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  FileText, Download, AlertTriangle, Loader2, FileSpreadsheet, Lock,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'

const MONTHS = [
  { v: 1,  l: 'Enero' }, { v: 2,  l: 'Febrero' }, { v: 3,  l: 'Marzo' },
  { v: 4,  l: 'Abril' }, { v: 5,  l: 'Mayo' },    { v: 6,  l: 'Junio' },
  { v: 7,  l: 'Julio' }, { v: 8,  l: 'Agosto' },  { v: 9,  l: 'Septiembre' },
  { v: 10, l: 'Octubre' },{ v: 11, l: 'Noviembre' },{ v: 12, l: 'Diciembre' },
]

function fmtRD(n) {
  return Number(n || 0).toFixed(2)
}
function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
}
function annualEquiv(monthlyRatePct) {
  const r = Number(monthlyRatePct || 0) / 100
  if (!r) return '0.00'
  return ((Math.pow(1 + r, 12) - 1) * 100).toFixed(2)
}

// Tiny client-side CSV builder. UTF-8 BOM prefix so Excel reads accents.
function buildCSV(columns, rows) {
  const header = columns.map(c => JSON.stringify(c.label)).join(',')
  const body = rows.map(r =>
    columns.map(c => {
      const v = c.get(r)
      return JSON.stringify(v ?? '')
    }).join(',')
  ).join('\n')
  return '﻿' + header + '\n' + body
}

function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 0)
}

export default function SBReport() {
  const api = useAPI()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year,  setYear]  = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // 'cartera' | 'mora' | 'redenciones'
  const [loans, setLoans] = useState([])
  const [pawn, setPawn]   = useState([])
  const [logs, setLogs]   = useState([])
  const [attempts, setAttempts] = useState({})

  useEffect(() => { (async () => {
    setLoading(true)
    try {
      try { await (api?.collections?.computeMora?.() ?? Promise.resolve()) } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sbreport.fmtrd' }) } catch {}}
      const [a, b, c, d] = await Promise.all([
        (api?.loans?.list?.({}) ?? Promise.resolve([])),
        (api?.pawnItems?.list?.({}) ?? Promise.resolve([])),
        (api?.collections?.logList?.({}) ?? Promise.resolve([])),
        (api?.collections?.lastAttempts?.() ?? Promise.resolve({})),
      ])
      setLoans(Array.isArray(a) ? a : [])
      setPawn(Array.isArray(b) ? b : [])
      setLogs(Array.isArray(c) ? c : [])
      setAttempts(d && typeof d === 'object' ? d : {})
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sbreport.fmtrd' }) } catch {}
      setLoans([]); setPawn([]); setLogs([]); setAttempts({})
    } finally { setLoading(false) }
  })() }, []) // eslint-disable-line

  const yearOptions = useMemo(() => {
    const out = []; const y = now.getFullYear()
    for (let i = y - 4; i <= y + 1; i++) out.push(i)
    return out
  }, [])

  // Cartera Activa — every loan with status='active' as of selected period
  // (snapshot view = current state filtered by created_at within period or
  // active during period). We export all currently active loans (period
  // doesn't filter the snapshot — it's the closing balance for the month).
  function exportCarteraActiva() {
    setBusy('cartera')
    try {
      const rows = loans.filter(l => l.status === 'active')
      const cols = [
        { label: 'loan_id',              get: r => r.id },
        { label: 'client_name',          get: r => r.clients?.name || '' },
        { label: 'client_dpi',           get: r => r.clients?.rnc || '' },
        { label: 'principal',            get: r => fmtRD(r.principal) },
        { label: 'balance',              get: r => fmtRD(Math.max(0, Number(r.principal || 0) - Number(r.total_paid || 0))) },
        { label: 'monthly_rate_pct',     get: r => Number(r.interest_rate || 0).toFixed(4) },
        { label: 'annual_rate_equiv_pct',get: r => annualEquiv(r.interest_rate) },
        { label: 'term_months',          get: r => r.term_months || 0 },
        { label: 'disbursed_at',         get: r => fmtDate(r.disbursed_at || r.created_at) },
        { label: 'next_due_date',        get: r => fmtDate(r.next_due_date) },
        { label: 'status',               get: r => r.status || '' },
        { label: 'amortization_method',  get: r => r.amortization_method || r.method || '' },
      ]
      const csv = buildCSV(cols, rows)
      downloadCSV(`SB_CarteraActiva_${year}-${String(month).padStart(2,'0')}.csv`, csv)
    } finally { setBusy(null) }
  }

  // Mora Aging — overdue active loans
  function exportMoraAging() {
    setBusy('mora')
    try {
      const today = new Date(); today.setHours(0,0,0,0)
      const rows = loans.filter(l => l.status === 'active' && l.next_due_date && new Date(l.next_due_date) < today)
      const cols = [
        { label: 'loan_id',         get: r => r.id },
        { label: 'client_name',     get: r => r.clients?.name || '' },
        { label: 'dias_mora',       get: r => Number(r.days_late || 0) },
        { label: 'monto_vencido',   get: r => fmtRD(Number(r.monthly_payment || 0) + Number(r.mora_amount || 0)) },
        { label: 'mora_acumulada',  get: r => fmtRD(r.mora_amount) },
        { label: 'ultimo_pago',     get: r => fmtDate(r.last_payment_at || '') },
        { label: 'ultimo_contacto', get: r => {
            const a = attempts[r.supabase_id]
            return a ? fmtDate(a.attempt_at) : ''
          } },
        { label: 'outcome',         get: r => attempts[r.supabase_id]?.outcome || '' },
      ]
      const csv = buildCSV(cols, rows)
      downloadCSV(`SB_MoraAging_${year}-${String(month).padStart(2,'0')}.csv`, csv)
    } finally { setBusy(null) }
  }

  // Redenciones — pawn items redeemed in the selected month
  function exportRedenciones() {
    setBusy('redenciones')
    try {
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd   = new Date(year, month, 1)
      const rows = pawn.filter(p => {
        if (p.status !== 'redeemed' && p.status !== 'forfeited' && p.status !== 'sold') return false
        const ts = new Date(p.redemption_date || p.redeemed_at || p.updated_at || 0)
        return ts >= periodStart && ts < periodEnd
      })
      const cols = [
        { label: 'pawn_id',         get: r => r.id },
        { label: 'ticket_code',     get: r => r.ticket_code || '' },
        { label: 'client_name',     get: r => r.clients?.name || '' },
        { label: 'description',     get: r => r.description || '' },
        { label: 'estimated_value', get: r => fmtRD(r.estimated_value) },
        { label: 'redeemed_at',     get: r => fmtDate(r.redemption_date || r.redeemed_at || '') },
        { label: 'sold_for',        get: r => r.sold_for != null ? fmtRD(r.sold_for) : '' },
        { label: 'status',          get: r => r.status || '' },
      ]
      const csv = buildCSV(cols, rows)
      downloadCSV(`SB_Redenciones_${year}-${String(month).padStart(2,'0')}.csv`, csv)
    } finally { setBusy(null) }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <FileText size={20} className="text-[#b3001e]" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">Reporte SB — Superintendencia de Bancos</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 md:px-6 py-4 md:py-6 max-w-5xl mx-auto w-full space-y-5">
        {/* Pending official-template banner */}
        <div className="rounded-2xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex gap-3">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[12px] text-amber-900 dark:text-amber-200 leading-relaxed">
            <strong className="font-bold">Plantilla oficial Superintendencia de Bancos pendiente.</strong>{' '}
            Esta vista exporta los datos crudos en CSV. La generación PDF según el formato oficial SB
            se habilitará cuando Mike provea la plantilla.{' '}
            <span className="font-bold uppercase tracking-wide">No usar el PDF generado como reporte oficial.</span>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 px-4 py-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">Mes</label>
              <select value={month} onChange={e => setMonth(Number(e.target.value))}
                className="px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]">
                {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">Año</label>
              <select value={year} onChange={e => setYear(Number(e.target.value))}
                className="px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]">
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-[11px] text-slate-400 ml-auto">
                <Loader2 size={12} className="animate-spin" /> Cargando datos...
              </div>
            )}
          </div>
        </div>

        {/* Export buttons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ExportTile
            icon={FileSpreadsheet}
            title="Cartera Activa"
            desc="Todos los préstamos activos: principal, balance, tasas, plazos, método de amortización."
            onClick={exportCarteraActiva}
            busy={busy === 'cartera'}
            disabled={loading}
          />
          <ExportTile
            icon={FileSpreadsheet}
            title="Mora Aging"
            desc="Préstamos vencidos: días de mora, monto vencido, último contacto y resultado."
            onClick={exportMoraAging}
            busy={busy === 'mora'}
            disabled={loading}
          />
          <ExportTile
            icon={FileSpreadsheet}
            title="Redenciones"
            desc="Empeños redimidos / decomisados / vendidos durante el mes seleccionado."
            onClick={exportRedenciones}
            busy={busy === 'redenciones'}
            disabled={loading}
          />
        </div>

        {/* Disabled PDF button */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-[13px] font-bold text-slate-700 dark:text-white">Exportar PDF SB (formato oficial)</h3>
              <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">Pendiente — habilitar cuando se provea la plantilla oficial.</p>
            </div>
            <button disabled
              title="Plantilla SB pendiente — habilitar cuando se provea formato oficial"
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-200 dark:bg-white/5 text-slate-400 dark:text-white/30 text-[12px] font-bold rounded-lg cursor-not-allowed">
              <Lock size={12} />
              Exportar PDF SB
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExportTile({ icon: Icon, title, desc, onClick, busy, disabled }) {
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 px-4 py-4 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-[#b3001e]" />
        <h3 className="text-[13px] font-bold text-slate-800 dark:text-white">{title}</h3>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-white/50 leading-relaxed mb-4 flex-1">{desc}</p>
      <button onClick={onClick} disabled={busy || disabled}
        className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#b3001e] hover:bg-[#8b0018] text-white text-[12px] font-bold rounded-lg disabled:opacity-50 transition-colors min-h-[40px]">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {busy ? 'Generando...' : 'Descargar CSV'}
      </button>
    </div>
  )
}
