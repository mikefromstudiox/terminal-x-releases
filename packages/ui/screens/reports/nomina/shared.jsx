/**
 * shared.jsx — Shared components and helpers for the nómina views.
 *
 * Extracted from the original PayrollReport.jsx to avoid duplication across
 * NominaDashboard, NominaEmpleados, NominaPagos, NominaReportes.
 *
 * Exports:
 *   - fmtRD, ALLOWED_ROLES, TYPE_COLORS
 *   - MetricCard, AccessDenied, TypeBadge
 *   - EmployeePanel, PayPayrollModal, PayrollHistoryPanel
 *   - printPaycheckStub
 */

import { useState } from 'react'
import { Lock, X, History, Printer, Trash2 } from 'lucide-react'
import { calcISR } from './lib/isr'
import { calcTSSEmployee, calcTSSEmployer, calcINFOTEPEmployer } from './lib/tss'

// ── Constants ─────────────────────────────────────────────────────────────────
export const ALLOWED_ROLES = ['owner', 'manager', 'cfo', 'accountant']

export const TYPE_COLORS = {
  lavador:  { bg: 'bg-sky-50 dark:bg-sky-500/10',         text: 'text-sky-700 dark:text-sky-300',         border: 'border-sky-200 dark:border-sky-500/20' },
  vendedor: { bg: 'bg-violet-50 dark:bg-violet-500/10',   text: 'text-violet-700 dark:text-violet-300',   border: 'border-violet-200 dark:border-violet-500/20' },
  cajero:   { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-500/20' },
}

export function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── MetricCard ────────────────────────────────────────────────────────────────
export function MetricCard({ icon: Icon, label, value, sub, accent = 'slate' }) {
  const a = {
    sky:     'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-100 dark:border-sky-500/20',
    green:   'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border-green-100 dark:border-green-500/20',
    violet:  'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-500/20',
    emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20',
    amber:   'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/20',
    red:     'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-100 dark:border-red-500/20',
    slate:   'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-white/10',
  }
  return (
    <div className="flex-1 min-w-0 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-3 md:px-5 py-3 md:py-4">
      {Icon && (
        <div className={`w-7 h-7 md:w-9 md:h-9 rounded-xl flex items-center justify-center border ${a[accent]} mb-2 md:mb-3`}>
          <Icon size={14} />
        </div>
      )}
      <p className="text-[9px] md:text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider truncate">{label}</p>
      <p className="text-[15px] md:text-[21px] font-bold text-slate-800 dark:text-white leading-tight mt-0.5 truncate">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── AccessDenied ──────────────────────────────────────────────────────────────
export function AccessDenied({ lang }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400 dark:text-white/40 bg-slate-50 dark:bg-black">
      <div className="w-16 h-16 bg-slate-100 dark:bg-white/10 rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-slate-300 dark:text-white/40" />
      </div>
      <div className="text-center">
        <p className="text-[15px] font-bold text-slate-600 dark:text-white/60 mb-1">
          {lang === 'es' ? 'Acceso Restringido' : 'Restricted Access'}
        </p>
        <p className="text-[12px] text-slate-400 dark:text-white/40 max-w-[260px]">
          {lang === 'es'
            ? 'Solo gerentes, dueños, contadores y CFO pueden ver las nóminas.'
            : 'Only managers, owners, accountants, and CFO can view payroll.'}
        </p>
      </div>
    </div>
  )
}

// ── TypeBadge ─────────────────────────────────────────────────────────────────
export function TypeBadge({ tipo, t }) {
  const c = TYPE_COLORS[tipo] || TYPE_COLORS.lavador
  const label = t ? t(`payroll_${tipo}`) : tipo
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
      {label}
    </span>
  )
}

// ── EmployeePanel (add/edit) ──────────────────────────────────────────────────
export function EmployeePanel({ emp, onSave, onClose, lang, t }) {
  const L = (es, en) => lang === 'es' ? es : en
  const isEdit = !!emp?.id
  const [form, setForm] = useState({
    nombre:       emp?.nombre || '',
    tipo:         emp?.tipo || 'lavador',
    salary:       emp?.salary ? String(emp.salary) : '',
    start_date:   emp?.start_date || '',
    cedula:       emp?.cedula || '',
    phone:        emp?.phone || '',
    puesto:       emp?.puesto || '',
    email:        emp?.email || '',
    bank_account: emp?.bank_account || '',
    tss_id:       emp?.tss_id || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.nombre.trim()) { setError(L('Nombre requerido', 'Name required')); return }
    if (!form.start_date) { setError(L('Fecha de entrada requerida', 'Start date required')); return }
    setSaving(true); setError('')
    try {
      await onSave({
        ...(isEdit ? { id: emp.id } : {}),
        nombre:       form.nombre.trim(),
        tipo:         form.tipo,
        salary:       parseFloat(form.salary) || 0,
        start_date:   form.start_date,
        cedula:       form.cedula.trim() || null,
        phone:        form.phone.trim() || null,
        puesto:       form.puesto.trim() || null,
        email:        form.email.trim() || null,
        bank_account: form.bank_account.trim() || null,
        tss_id:       form.tss_id.trim() || null,
      })
    } catch (e) { setError(e.message || L('Error al guardar', 'Error saving')) }
    finally { setSaving(false) }
  }

  const field = (key, label, props = {}) => (
    <div>
      <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 mb-1">{label}</label>
      <input value={form[key]} onChange={e => set(key, e.target.value)} {...props}
        className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:border-sky-400" />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 sticky top-0 bg-white dark:bg-zinc-900">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">
            {isEdit ? (t ? t('payroll_edit') : L('Editar', 'Edit')) : (t ? t('payroll_add') : L('Agregar empleado', 'Add employee'))}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {field('nombre', L('Nombre completo *', 'Full name *'), { placeholder: 'Juan García' })}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 mb-1">{L('Tipo', 'Type')}</label>
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:border-sky-400 bg-white">
              <option value="lavador">Lavador</option>
              <option value="vendedor">Vendedor</option>
              <option value="cajero">Cajero/Cajera</option>
            </select>
          </div>
          {field('puesto', L('Puesto', 'Job title'), { placeholder: L('Ej: Jefe de lavado', 'e.g. Wash supervisor') })}
          <div className="grid grid-cols-2 gap-3">
            {field('salary', L('Salario mensual', 'Monthly salary'), { type: 'number', min: 0, step: 0.01, placeholder: '0.00' })}
            {field('start_date', L('Fecha de inicio *', 'Start date *'), { type: 'date' })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('cedula', L('Cédula', 'ID'), { placeholder: '001-0000000-0' })}
            {field('phone', L('Teléfono', 'Phone'), { placeholder: '809-555-0000' })}
          </div>
          {field('email', L('Email', 'Email'), { type: 'email', placeholder: 'juan@ejemplo.com' })}
          <div className="grid grid-cols-2 gap-3">
            {field('tss_id', L('ID TSS (SUIR)', 'TSS ID (SUIR)'), { placeholder: L('Opcional', 'Optional') })}
            {field('bank_account', L('Cuenta bancaria', 'Bank account'), { placeholder: L('Opcional', 'Optional') })}
          </div>
        </div>
        {error && <p className="px-5 pb-2 text-[11px] text-red-500">{error}</p>}
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100 dark:border-white/10">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] disabled:opacity-50 transition-colors">
            {saving ? L('Guardando...', 'Saving...') : L('Guardar', 'Save')}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 text-[12px] text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
            {L('Cancelar', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PayPayrollModal (single-employee paycheck) ────────────────────────────────
// Upgraded to auto-compute TSS/ISR/INFOTEP from payroll_settings.
export function PayPayrollModal({ emp, settings, currentCommissionTotal, onSave, onClose, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const cycle = settings?.pay_cycle || 'quincenal'
  // Default period = previous quincena (1-15) or previous month depending on cycle
  const today = new Date()
  let defaultStart, defaultEnd
  if (cycle === 'mensual') {
    defaultEnd = new Date(today.getFullYear(), today.getMonth(), 0)
    defaultStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  } else {
    // Previous quincena
    const d = today.getDate()
    if (d <= 15) {
      defaultEnd = new Date(today.getFullYear(), today.getMonth() - 1, 0)
      defaultStart = new Date(defaultEnd.getFullYear(), defaultEnd.getMonth(), 16)
    } else {
      defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
      defaultEnd = new Date(today.getFullYear(), today.getMonth(), 15)
    }
  }
  const iso = (d) => d.toISOString().slice(0, 10)

  const defaultBase = cycle === 'quincenal' ? (emp.salary || 0) / 2 : (emp.salary || 0)

  const [periodStart, setPeriodStart] = useState(iso(defaultStart))
  const [periodEnd,   setPeriodEnd]   = useState(iso(defaultEnd))
  const [base,        setBase]        = useState(String(defaultBase))
  const [commissions, setCommissions] = useState('0')
  const [bonuses,     setBonuses]     = useState('0')
  const [otherDeductions, setOtherDeductions] = useState('')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)

  const baseNum   = parseFloat(base) || 0
  const commNum   = parseFloat(commissions) || 0
  const bonusNum  = parseFloat(bonuses) || 0
  const otherNum  = parseFloat(otherDeductions) || 0
  const gross     = baseNum + commNum + bonusNum

  // Auto-compute TSS (separate SFS + AFP caps) and ISR (progressive brackets).
  const tssEmp    = calcTSSEmployee(gross, settings || {})
  const tssEmpr   = calcTSSEmployer(gross, settings || {})
  const infotep   = calcINFOTEPEmployer(gross, settings?.infotep_employer_rate)
  const isrResult = settings?.isr_enabled === false
    ? { periodTax: 0, bracket: 'deshabilitado' }
    : calcISR(gross, cycle, settings?.isr_brackets)
  const isrNum    = isrResult.periodTax
  const totalDeductions = tssEmp.total + isrNum + otherNum
  const net = gross - totalDeductions

  async function handleSave() {
    if (net <= 0) return
    setSaving(true)
    try {
      await onSave({
        period_start: periodStart,
        period_end:   periodEnd,
        base:         baseNum,
        commissions:  commNum,
        bonuses:      bonusNum,
        sfs_employee: tssEmp.sfs,
        afp_employee: tssEmp.afp,
        isr:          isrNum,
        other_deductions: otherNum,
        sfs_employer: tssEmpr.sfs,
        afp_employer: tssEmpr.afp,
        infotep_employer: infotep,
        net,
        notes: notes.trim() || null,
      })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10 sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white">{L('Registrar Pago de Nómina', 'Record Payroll Payment')}</h3>
            <p className="text-[11px] text-slate-400 dark:text-white/40">{emp.nombre} · {cycle === 'mensual' ? L('mensual','monthly') : L('quincenal','biweekly')}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={18} className="text-slate-500 dark:text-white/60" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">{L('Desde', 'From')}</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">{L('Hasta', 'To')}</label>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">{L('Salario base', 'Base salary')}</label>
            <input type="number" min="0" step="0.01" value={base} onChange={e => setBase(e.target.value)}
              className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">{L('Comisiones', 'Commissions')}</label>
              {currentCommissionTotal > 0 && (
                <button type="button" onClick={() => setCommissions(String(currentCommissionTotal))}
                  className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline">
                  {L(`Usar total: ${fmtRD(currentCommissionTotal)}`, `Use total: ${fmtRD(currentCommissionTotal)}`)}
                </button>
              )}
            </div>
            <input type="number" min="0" step="0.01" value={commissions} onChange={e => setCommissions(e.target.value)}
              className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">{L('Bonos', 'Bonuses')}</label>
              <input type="number" min="0" step="0.01" value={bonuses} onChange={e => setBonuses(e.target.value)}
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">
                {L('Otros descuentos', 'Other deductions')}
              </label>
              <input type="number" min="0" step="0.01" value={otherDeductions} placeholder="0.00" onChange={e => setOtherDeductions(e.target.value)}
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">{L('Notas', 'Notes')}</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder={L('Opcional', 'Optional')}
              className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          {/* Live itemised summary */}
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-4 py-3 space-y-1">
            <div className="flex justify-between text-[12px] text-slate-600 dark:text-white/60">
              <span>{L('Bruto', 'Gross')}</span>
              <span className="font-semibold text-slate-800 dark:text-white">{fmtRD(gross)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-white/50">
              <span>SFS empleado ({((settings?.sfs_employee_rate ?? 0.0304) * 100).toFixed(2)}%)</span>
              <span>− {fmtRD(tssEmp.sfs)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-white/50">
              <span>AFP empleado ({((settings?.afp_employee_rate ?? 0.0287) * 100).toFixed(2)}%)</span>
              <span>− {fmtRD(tssEmp.afp)}</span>
            </div>
            {isrNum > 0 && (
              <div className="flex justify-between text-[11px] text-slate-500 dark:text-white/50">
                <span>ISR ({isrResult.bracket})</span>
                <span>− {fmtRD(isrNum)}</span>
              </div>
            )}
            {otherNum > 0 && (
              <div className="flex justify-between text-[11px] text-slate-500 dark:text-white/50">
                <span>{L('Otros descuentos', 'Other deductions')}</span>
                <span>− {fmtRD(otherNum)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-emerald-200 dark:border-emerald-500/20">
              <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400">{L('NETO A PAGAR', 'NET TO PAY')}</span>
              <span className="text-[16px] font-bold text-emerald-700 dark:text-emerald-400">{fmtRD(net)}</span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-white/40 pt-1">
              {L('Carga empleador:', 'Employer cost:')} SFS {fmtRD(tssEmpr.sfs)} · AFP {fmtRD(tssEmpr.afp)} · INFOTEP {fmtRD(infotep)}
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex gap-2 sticky bottom-0 bg-white dark:bg-zinc-900">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10">
            {L('Cancelar', 'Cancel')}
          </button>
          <button onClick={handleSave} disabled={saving || net <= 0}
            className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">
            {saving ? L('Guardando…', 'Saving…') : L('Registrar Pago', 'Record Payment')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PayrollHistoryPanel ───────────────────────────────────────────────────────
export function PayrollHistoryPanel({ runs, loading, onDelete, onPrint, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-300 dark:text-white/30 text-sm py-8">{L('Cargando historial…', 'Loading history…')}</div>
  }
  if (!runs.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-300 dark:text-white/30 py-8">
        <div className="text-center">
          <History size={40} className="mx-auto mb-3 text-slate-200 dark:text-white/20" />
          <p className="text-[13px]">{L('Sin pagos registrados aún', 'No payments recorded yet')}</p>
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">{L('Presione "Pagar Nómina" para registrar el primero', 'Click "Pay Payroll" to record the first one')}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-slate-100 dark:divide-white/5">
        {runs.map(r => {
          const totalDeductions = Number(r.deductions || 0) || (Number(r.sfs_employee || 0) + Number(r.afp_employee || 0) + Number(r.isr || 0) + Number(r.other_deductions || 0))
          return (
            <div key={r.id} className="px-5 py-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-[13px] font-bold text-slate-800 dark:text-white">
                    {new Date(r.paid_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-white/40">
                    {L('Período:', 'Period:')} {r.period_start} → {r.period_end}
                  </p>
                  {r.paid_by_name && <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{L('Pagó:', 'Paid by:')} {r.paid_by_name}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[15px] font-bold text-emerald-600 dark:text-emerald-400">{fmtRD(r.net)}</p>
                  <p className="text-[10px] text-slate-400 dark:text-white/40">{L('neto', 'net')}</p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-[11px] mb-2">
                <div>
                  <p className="text-slate-400 dark:text-white/40">{L('Base', 'Base')}</p>
                  <p className="text-slate-700 dark:text-white/80 font-semibold">{fmtRD(r.base || 0)}</p>
                </div>
                <div>
                  <p className="text-slate-400 dark:text-white/40">{L('Comisiones', 'Commissions')}</p>
                  <p className="text-slate-700 dark:text-white/80 font-semibold">{fmtRD(r.commissions || 0)}</p>
                </div>
                <div>
                  <p className="text-slate-400 dark:text-white/40">{L('Bonos', 'Bonuses')}</p>
                  <p className="text-slate-700 dark:text-white/80 font-semibold">{fmtRD(r.bonuses || 0)}</p>
                </div>
                <div>
                  <p className="text-slate-400 dark:text-white/40">{L('Descuentos', 'Deductions')}</p>
                  <p className="text-red-500 dark:text-red-400 font-semibold">− {fmtRD(totalDeductions)}</p>
                </div>
              </div>

              {r.notes && <p className="text-[11px] text-slate-500 dark:text-white/60 italic mb-2">{r.notes}</p>}

              <div className="flex justify-end gap-1.5">
                <button onClick={() => onPrint(r)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-md hover:bg-slate-100 dark:hover:bg-white/10">
                  <Printer size={11} /> {L('Imprimir recibo', 'Print stub')}
                </button>
                {onDelete && (
                  <button onClick={() => onDelete(r.id)}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-red-500 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Paycheck stub printer ─────────────────────────────────────────────────────
export function printPaycheckStub(biz, emp, run, L) {
  const fmt = (n) => `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const rows = []
  rows.push(['Salario base',      fmt(run.base || 0)])
  if (Number(run.commissions || 0) > 0) rows.push(['Comisiones',  fmt(run.commissions)])
  if (Number(run.bonuses || 0) > 0)     rows.push(['Bonos',       fmt(run.bonuses)])
  if (Number(run.sfs_employee || 0) > 0) rows.push(['SFS empleado',  `− ${fmt(run.sfs_employee)}`, true])
  if (Number(run.afp_employee || 0) > 0) rows.push(['AFP empleado',  `− ${fmt(run.afp_employee)}`, true])
  if (Number(run.isr || 0) > 0)         rows.push(['ISR',           `− ${fmt(run.isr)}`, true])
  if (Number(run.other_deductions || 0) > 0) rows.push(['Otros descuentos', `− ${fmt(run.other_deductions)}`, true])
  // Back-compat: old runs only have `deductions` total
  const hasItemised = Number(run.sfs_employee || 0) + Number(run.afp_employee || 0) + Number(run.isr || 0) + Number(run.other_deductions || 0) > 0
  if (!hasItemised && Number(run.deductions || 0) > 0) {
    rows.push(['Descuentos (TSS/ISR)', `− ${fmt(run.deductions)}`, true])
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${L('Recibo de Pago', 'Paycheck Stub')} — ${emp.nombre}</title><style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; color: #1e293b; }
    h1 { font-size: 18px; margin: 0; }
    .muted { color: #64748b; font-size: 11px; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
    .row:last-child { border-bottom: none; }
    .row.neg span:last-child { color: #dc2626; }
    .total { background: #ecfdf5; border-top: 2px solid #10b981; font-weight: bold; color: #047857; }
    .footer { text-align: center; font-size: 10px; color: #94a3b8; margin-top: 20px; }
    @media print { .no-print { display: none; } }
  </style></head><body>
    <div style="display:flex; justify-content:space-between; align-items:start;">
      <div>
        <h1>${biz?.name || 'Empresa'}</h1>
        ${biz?.rnc ? `<p class="muted">RNC: ${biz.rnc}</p>` : ''}
        ${biz?.address ? `<p class="muted">${biz.address}</p>` : ''}
      </div>
      <div style="text-align:right;">
        <h1>${L('RECIBO DE PAGO', 'PAYCHECK STUB')}</h1>
        <p class="muted">#${run.id}</p>
      </div>
    </div>

    <div class="box">
      <div class="row"><span class="muted">${L('Empleado', 'Employee')}</span><span><strong>${emp.nombre}</strong></span></div>
      ${emp.cedula ? `<div class="row"><span class="muted">${L('Cédula', 'ID')}</span><span>${emp.cedula}</span></div>` : ''}
      ${emp.tss_id ? `<div class="row"><span class="muted">ID TSS</span><span>${emp.tss_id}</span></div>` : ''}
      <div class="row"><span class="muted">${L('Tipo', 'Type')}</span><span style="text-transform:capitalize;">${emp.tipo}</span></div>
      ${emp.puesto ? `<div class="row"><span class="muted">${L('Puesto', 'Position')}</span><span>${emp.puesto}</span></div>` : ''}
      <div class="row"><span class="muted">${L('Período', 'Period')}</span><span>${run.period_start} → ${run.period_end}</span></div>
      <div class="row"><span class="muted">${L('Fecha de pago', 'Payment date')}</span><span>${new Date(run.paid_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
    </div>

    <div class="box">
      ${rows.map(([label, value, neg]) => `<div class="row${neg ? ' neg' : ''}"><span>${label}</span><span>${value}</span></div>`).join('')}
      <div class="row total"><span>${L('NETO A PAGAR', 'NET TO PAY')}</span><span>${fmt(run.net)}</span></div>
    </div>

    ${run.notes ? `<p class="muted" style="font-style:italic;">${L('Notas:', 'Notes:')} ${run.notes}</p>` : ''}

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px;">
      <div style="text-align:center; border-top: 1px solid #334155; padding-top: 6px;" class="muted">${L('Firma del empleado', 'Employee signature')}</div>
      <div style="text-align:center; border-top: 1px solid #334155; padding-top: 6px;" class="muted">${L('Firma autorizada', 'Authorized signature')}</div>
    </div>

    <p class="footer">${L('Generado', 'Generated')}: ${new Date().toLocaleString('es-DO')}</p>

    <div class="no-print" style="text-align:center; margin-top:20px;">
      <button onclick="window.print()" style="background:#0f172a; color:#fff; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer; margin-right:8px;">${L('Imprimir', 'Print')}</button>
      <button onclick="window.close()" style="background:#e2e8f0; color:#1e293b; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer;">${L('Cerrar', 'Close')}</button>
    </div>
  </body></html>`
  const w = window.open('', '_blank', 'width=720,height=900')
  if (!w) { alert(L('Habilite ventanas emergentes', 'Enable popups')); return }
  w.document.write(html); w.document.close()
}
