import { useMemo, useState } from 'react'
import {
  Building2, Users, FileDown, Play, Check, Calendar,
  DollarSign, Receipt, FileSpreadsheet, ChevronRight
} from 'lucide-react'
import { fmtRD, t } from '../demoMockData'

// ─── DR 2026 ISR brackets (annual) ─────────────────────────────────────────
// Source: DGII 2026 escalas — same numbers used in packages/ui/screens/reports/nomina/lib/isr.js
const ISR_BRACKETS = [
  { upTo: 416220.00, rate: 0,    base: 0 },
  { upTo: 624329.00, rate: 0.15, base: 0 },
  { upTo: 867123.00, rate: 0.20, base: 31216.00 },
  { upTo: Infinity,  rate: 0.25, base: 79776.00 },
]

function calcISRAnnual(annual) {
  if (annual <= ISR_BRACKETS[0].upTo) return 0
  for (let i = 1; i < ISR_BRACKETS.length; i++) {
    const b = ISR_BRACKETS[i]
    const prev = ISR_BRACKETS[i - 1].upTo
    if (annual <= b.upTo) return b.base + (annual - prev) * b.rate
  }
  return 0
}

// ─── TSS / INFOTEP rates (DR 2026) ─────────────────────────────────────────
const SFS_RATE = 0.0304    // 3.04% empleado
const AFP_RATE = 0.0287    // 2.87% empleado
const INFOTEP_RATE = 0.01  // 1% empresa (illustrative — usually employer side)
const SFS_CAP = 252480     // 2026 cap (10x salario mínimo cotizable)
const AFP_CAP = 505080     // 2026 cap

function calcRow(monthly) {
  const sfsBase = Math.min(monthly, SFS_CAP)
  const afpBase = Math.min(monthly, AFP_CAP)
  const sfs = sfsBase * SFS_RATE
  const afp = afpBase * AFP_RATE
  const tss = sfs + afp
  const infotep = monthly * INFOTEP_RATE
  // ISR is computed on (gross - SFS - AFP) annualized
  const taxable = (monthly - tss) * 12
  const isrAnnual = calcISRAnnual(taxable)
  const isr = isrAnnual / 12
  // Quincena = half month
  const tssQ = tss / 2
  const infotepQ = infotep / 2
  const isrQ = isr / 2
  const grossQ = monthly / 2
  const neto = grossQ - tssQ - isrQ
  return { grossQ, tssQ, infotepQ, isrQ, neto, sfsQ: sfs / 2, afpQ: afp / 2 }
}

const EMPLOYEES = [
  { id: 1, name: 'Juan Pérez',         puesto: 'Cajero',         monthly: 15000 },
  { id: 2, name: 'María García',       puesto: 'Vendedora',      monthly: 22000 },
  { id: 3, name: 'Luis Rodríguez',     puesto: 'Supervisor',     monthly: 35000 },
  { id: 4, name: 'Ana Martínez',       puesto: 'Contadora',      monthly: 48000 },
  { id: 5, name: 'Carlos López',       puesto: 'Gerente',        monthly: 65000 },
  { id: 6, name: 'Sofía Hernández',    puesto: 'Directora',      monthly: 95000 },
]

function HeaderCell({ children, className = '' }) {
  return (
    <th className={`px-4 py-3 text-[10px] font-extrabold tracking-[1.5px] uppercase text-black/50 dark:text-white/50 ${className}`}>
      {children}
    </th>
  )
}

function Cell({ children, className = '', mono = false }) {
  return (
    <td className={`px-4 py-3.5 text-sm ${mono ? 'tabular-nums font-mono' : ''} text-black dark:text-white ${className}`}>
      {children}
    </td>
  )
}

export default function PayrollDemo({ vertical, lang, onCobrar }) {
  const [processing, setProcessing] = useState(false)
  const [paid, setPaid] = useState(false)

  const rows = useMemo(() => EMPLOYEES.map(e => ({ ...e, ...calcRow(e.monthly) })), [])
  const totals = useMemo(() => rows.reduce((acc, r) => ({
    gross: acc.gross + r.grossQ,
    tss: acc.tss + r.tssQ,
    infotep: acc.infotep + r.infotepQ,
    isr: acc.isr + r.isrQ,
    neto: acc.neto + r.neto,
  }), { gross: 0, tss: 0, infotep: 0, isr: 0, neto: 0 }), [rows])

  const totalEmpresa = totals.gross + totals.infotep // empresa paga bruto + infotep

  function handleProcess() {
    if (paid) return
    setProcessing(true)
    setTimeout(() => {
      setProcessing(false)
      setPaid(true)
      onCobrar?.()
    }, 900)
  }

  return (
    <div className="min-h-[calc(100vh-44px)] bg-slate-50 dark:bg-black px-4 sm:px-6 py-6 max-w-[1600px] mx-auto">
      {/* ─── Top header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#b3001e] flex items-center justify-center shadow-lg shadow-[#b3001e]/30 flex-shrink-0">
            <Building2 size={24} className="text-white" />
          </div>
          <div>
            <p className="text-[10px] font-extrabold tracking-[2px] text-[#b3001e] uppercase mb-1">
              {t(lang, 'Nómina', 'Payroll')}
            </p>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-black dark:text-white leading-tight">
              {t(lang, 'Quincena del 16-30 abril 2026', 'Pay period · April 16-30, 2026')}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-black/60 dark:text-white/60">
              <span className="inline-flex items-center gap-1.5"><Calendar size={12} />30 {t(lang, 'abr', 'Apr')} 2026</span>
              <span className="inline-flex items-center gap-1.5"><Users size={12} />{EMPLOYEES.length} {t(lang, 'empleados activos', 'active employees')}</span>
              <span className="inline-flex items-center gap-1.5"><DollarSign size={12} />RNC 130-12345-6</span>
            </div>
          </div>
        </div>

        <button
          onClick={handleProcess}
          disabled={processing}
          className={`group inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-wide shadow-xl transition-all ${
            paid
              ? 'bg-emerald-600 text-white shadow-emerald-600/30'
              : 'bg-[#b3001e] hover:bg-[#8c0017] text-white shadow-[#b3001e]/30 hover:scale-[1.02]'
          }`}
        >
          {paid ? (
            <>
              <Check size={18} strokeWidth={3} />
              {t(lang, 'Pagos Procesados', 'Payroll Processed')}
            </>
          ) : processing ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {t(lang, 'Procesando…', 'Processing…')}
            </>
          ) : (
            <>
              <Play size={18} strokeWidth={2.5} />
              {t(lang, 'Procesar Pagos', 'Process Payroll')}
              <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </>
          )}
        </button>
      </div>

      {/* ─── Main grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        {/* Employees table */}
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-black dark:text-white">
              {t(lang, 'Detalle por Empleado', 'Employee Breakdown')}
            </h2>
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-black/40 dark:text-white/40">
              ISR · TSS · INFOTEP
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/10">
                <tr>
                  <HeaderCell className="text-left">{t(lang, 'Empleado', 'Employee')}</HeaderCell>
                  <HeaderCell className="text-right">{t(lang, 'Salario Base', 'Base Salary')}</HeaderCell>
                  <HeaderCell className="text-right">TSS</HeaderCell>
                  <HeaderCell className="text-right">INFOTEP</HeaderCell>
                  <HeaderCell className="text-right">ISR</HeaderCell>
                  <HeaderCell className="text-right">{t(lang, 'Neto a Pagar', 'Net Pay')}</HeaderCell>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                    <Cell>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#b3001e] to-[#8c0017] text-white flex items-center justify-center text-[11px] font-black flex-shrink-0">
                          {r.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                        </div>
                        <div>
                          <p className="font-bold text-sm leading-tight">{r.name}</p>
                          <p className="text-[11px] text-black/50 dark:text-white/50 mt-0.5">{r.puesto}</p>
                        </div>
                      </div>
                    </Cell>
                    <Cell className="text-right" mono>
                      <span className="font-bold">{fmtRD(r.grossQ)}</span>
                      <p className="text-[10px] text-black/40 dark:text-white/40 font-sans mt-0.5">{fmtRD(r.monthly)}/{t(lang, 'mes', 'mo')}</p>
                    </Cell>
                    <Cell className="text-right" mono>
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">−{fmtRD(r.tssQ)}</span>
                      <p className="text-[10px] text-black/40 dark:text-white/40 font-sans mt-0.5">SFS+AFP</p>
                    </Cell>
                    <Cell className="text-right" mono>
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">−{fmtRD(r.infotepQ)}</span>
                      <p className="text-[10px] text-black/40 dark:text-white/40 font-sans mt-0.5">1%</p>
                    </Cell>
                    <Cell className="text-right" mono>
                      <span className={r.isrQ > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-black/30 dark:text-white/30'}>
                        {r.isrQ > 0 ? `−${fmtRD(r.isrQ)}` : '—'}
                      </span>
                      <p className="text-[10px] text-black/40 dark:text-white/40 font-sans mt-0.5">
                        {r.isrQ === 0 ? t(lang, 'exento', 'exempt') : `${r.monthly >= 72260 ? '20-25' : '15'}%`}
                      </p>
                    </Cell>
                    <Cell className="text-right" mono>
                      <span className="font-black text-base text-emerald-700 dark:text-emerald-400">{fmtRD(r.neto)}</span>
                    </Cell>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-black dark:bg-white/[0.06] text-white">
                <tr>
                  <Cell className="text-left font-black uppercase tracking-wider text-[11px] text-white">
                    {t(lang, 'Totales Quincena', 'Period Totals')}
                  </Cell>
                  <Cell className="text-right text-white" mono>
                    <span className="font-black">{fmtRD(totals.gross)}</span>
                  </Cell>
                  <Cell className="text-right text-white" mono>
                    <span className="font-black">−{fmtRD(totals.tss)}</span>
                  </Cell>
                  <Cell className="text-right text-white" mono>
                    <span className="font-black">−{fmtRD(totals.infotep)}</span>
                  </Cell>
                  <Cell className="text-right text-white" mono>
                    <span className="font-black">−{fmtRD(totals.isr)}</span>
                  </Cell>
                  <Cell className="text-right text-white" mono>
                    <span className="font-black text-base text-[#b3001e]">{fmtRD(totals.neto)}</span>
                  </Cell>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Cost summary footer */}
          <div className="px-5 py-4 bg-slate-50 dark:bg-white/[0.03] border-t border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold tracking-[1.5px] uppercase text-black/50 dark:text-white/50">
                {t(lang, 'Costo Total para la Empresa', 'Total Company Cost')}
              </p>
              <p className="text-2xl font-black tracking-tight text-black dark:text-white tabular-nums mt-0.5">{fmtRD(totalEmpresa)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-extrabold tracking-[1.5px] uppercase text-black/50 dark:text-white/50">
                {t(lang, 'Pago Neto a Empleados', 'Net to Employees')}
              </p>
              <p className="text-2xl font-black tracking-tight text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">{fmtRD(totals.neto)}</p>
            </div>
          </div>
        </div>

        {/* ─── Right sidebar — DGII reports ────────────────────────────── */}
        <aside className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 bg-gradient-to-br from-[#b3001e] to-[#8c0017] text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                  <Receipt size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-extrabold tracking-[2px] uppercase opacity-80">DGII / TSS</p>
                  <h3 className="font-black text-sm tracking-tight">{t(lang, 'Reportes Listos', 'Reports Ready')}</h3>
                </div>
              </div>
            </div>
            <div className="p-3 space-y-2">
              {[
                { code: 'TSS-T7', label: t(lang, 'Tesorería SS · Cotizantes', 'Social Security · Contributors'), icon: FileSpreadsheet },
                { code: 'ISR-IR4', label: t(lang, 'DGII · Retenciones ISR', 'DGII · ISR Withholdings'), icon: FileDown },
                { code: '606',     label: t(lang, 'DGII · Compras del mes', 'DGII · Monthly Purchases'), icon: FileDown },
              ].map(r => (
                <button
                  key={r.code}
                  onClick={() => onCobrar?.()}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-50 dark:bg-white/[0.04] hover:bg-slate-100 dark:hover:bg-white/[0.08] border border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40 transition-all group text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 flex items-center justify-center flex-shrink-0">
                    <r.icon size={15} className="text-[#b3001e]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-mono font-black text-black dark:text-white">{r.code}</p>
                    <p className="text-[11px] text-black/60 dark:text-white/60 truncate">{r.label}</p>
                  </div>
                  <FileDown size={15} className="text-black/30 dark:text-white/30 group-hover:text-[#b3001e] transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {/* Compliance card */}
          <div className="rounded-2xl bg-black text-white p-5 shadow-xl shadow-black/10">
            <div className="flex items-center gap-2 mb-3">
              <Check size={14} strokeWidth={3} className="text-emerald-400" />
              <p className="text-[10px] font-extrabold tracking-[2px] uppercase text-emerald-400">
                {t(lang, 'Cumplimiento DR-2026', 'DR-2026 Compliance')}
              </p>
            </div>
            <ul className="space-y-2 text-xs text-white/80">
              <li className="flex items-start gap-2">
                <Check size={12} className="text-[#b3001e] mt-0.5 flex-shrink-0" />
                <span>{t(lang, 'Escalas ISR 2026 actualizadas', 'Updated 2026 ISR brackets')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={12} className="text-[#b3001e] mt-0.5 flex-shrink-0" />
                <span>{t(lang, 'Topes SFS / AFP 2026', '2026 SFS / AFP caps')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={12} className="text-[#b3001e] mt-0.5 flex-shrink-0" />
                <span>{t(lang, 'Cesantía Ley 16-92 acumulada', 'Law 16-92 severance accrued')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={12} className="text-[#b3001e] mt-0.5 flex-shrink-0" />
                <span>{t(lang, 'Recibos formales por empleado', 'Formal pay stubs per employee')}</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}
