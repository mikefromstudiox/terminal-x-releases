import { useState, useMemo, useEffect } from 'react'
import { Lock, Download, Printer, Plus, Edit2, Power, Users, Calculator, Calendar, DollarSign, AlertCircle, X, Banknote, History, Trash2, Check } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { exportLiquidacion } from '@terminal-x/services/csv'
import { printLiquidacion } from '@terminal-x/services/report-html'

// ── Dominican payroll deductions (approximate, owner-adjustable) ───────────────
// TSS = SFS 3.04% + AFP 2.87% = 5.91% (employee share)
// ISR is progressive; for UX simplicity we leave it as 0 by default and let
// the user type a custom deduction if applicable.
const TSS_RATE = 0.0591

// ── Access control ────────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['owner', 'manager', 'cfo', 'accountant']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Liquidacion calculation (Ley 16-92, Codigo de Trabajo DR) ─────────────────
const DAILY_DIVISOR = 23.83

function calcAntiguedad(startDate) {
  if (!startDate) return { years: 0, months: 0, days: 0, totalMonths: 0 }
  const start = new Date(startDate + 'T00:00:00')
  const now = new Date()
  let years = now.getFullYear() - start.getFullYear()
  let months = now.getMonth() - start.getMonth()
  let days = now.getDate() - start.getDate()
  if (days < 0) {
    months--
    const prev = new Date(now.getFullYear(), now.getMonth(), 0)
    days += prev.getDate()
  }
  if (months < 0) { years--; months += 12 }
  const totalMonths = years * 12 + months + (days >= 15 ? 1 : 0)
  return { years, months, days, totalMonths }
}

function calcVacaciones(monthlySalary, startDate) {
  if (!monthlySalary || !startDate) return { days: 0, amount: 0 }
  const dailyRate = monthlySalary / DAILY_DIVISOR
  const now = new Date()
  const start = new Date(startDate + 'T00:00:00')
  // Months worked in the current calendar year
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const effectiveStart = start > yearStart ? start : yearStart
  const monthsInYear = (now.getMonth() - effectiveStart.getMonth()) +
    (now.getFullYear() - effectiveStart.getFullYear()) * 12 +
    (now.getDate() >= effectiveStart.getDate() ? 0 : -1)
  const daysPerYear = 14
  const days = Math.max(0, parseFloat(((daysPerYear / 12) * Math.max(0, monthsInYear)).toFixed(2)))
  return { days, amount: parseFloat((days * dailyRate).toFixed(2)) }
}

function calcSalarioNavidad(monthlySalary, startDate) {
  if (!monthlySalary || !startDate) return { amount: 0 }
  const now = new Date()
  const start = new Date(startDate + 'T00:00:00')
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const effectiveStart = start > yearStart ? start : yearStart
  let monthsInYear = (now.getMonth() - effectiveStart.getMonth()) +
    (now.getFullYear() - effectiveStart.getFullYear()) * 12
  if (now.getDate() >= effectiveStart.getDate()) monthsInYear++
  monthsInYear = Math.max(0, Math.min(12, monthsInYear))
  const amount = parseFloat(((monthlySalary * monthsInYear) / 12).toFixed(2))
  return { amount }
}

function calcPreaviso(monthlySalary, totalMonths) {
  if (!monthlySalary || totalMonths < 3) return { days: 0, amount: 0 }
  const dailyRate = monthlySalary / DAILY_DIVISOR
  let days = 0
  if (totalMonths < 6) days = 7
  else if (totalMonths < 12) days = 14
  else days = 28
  return { days, amount: parseFloat((days * dailyRate).toFixed(2)) }
}

function calcCesantia(monthlySalary, totalMonths) {
  if (!monthlySalary || totalMonths < 3) return { days: 0, amount: 0 }
  const dailyRate = monthlySalary / DAILY_DIVISOR
  let days = 0
  if (totalMonths < 6) {
    days = 6
  } else if (totalMonths < 12) {
    days = 13
  } else {
    const fullYears = Math.floor(totalMonths / 12)
    const remainingMonths = totalMonths % 12
    if (fullYears <= 5) {
      days = fullYears * 21
    } else {
      days = 5 * 21 + (fullYears - 5) * 23
    }
    // Partial year proration at 15 days/year
    if (remainingMonths >= 3) {
      days += parseFloat(((15 / 12) * remainingMonths).toFixed(2))
    }
  }
  return { days: parseFloat(days.toFixed(2)), amount: parseFloat((days * dailyRate).toFixed(2)) }
}

function calcLiquidacion(emp, tipo, commissionTotal) {
  const startDate = emp.start_date
  if (!startDate) return null

  const ant = calcAntiguedad(startDate)

  // For commission-based workers (lavador / vendedor / cajero), use average
  // monthly commissions as the salary base when no fixed salary is set.
  let monthlySalary = emp.salary || 0
  let isCommissionBased = false
  const commissionTipos = ['lavador', 'vendedor', 'cajero']
  if (commissionTipos.includes(emp.tipo) && commissionTotal > 0 && ant.totalMonths > 0 && !emp.salary) {
    monthlySalary = parseFloat((commissionTotal / ant.totalMonths).toFixed(2))
    isCommissionBased = true
  }

  if (!monthlySalary) return null

  const vacaciones = calcVacaciones(monthlySalary, startDate)
  const navidad = calcSalarioNavidad(monthlySalary, startDate)
  const preaviso = tipo === 'desahucio' ? calcPreaviso(monthlySalary, ant.totalMonths) : { days: 0, amount: 0 }
  const cesantia = tipo === 'desahucio' ? calcCesantia(monthlySalary, ant.totalMonths) : { days: 0, amount: 0 }
  const total = vacaciones.amount + navidad.amount + preaviso.amount + cesantia.amount

  return {
    antiguedad: ant,
    monthlySalary,
    dailyRate: parseFloat((monthlySalary / DAILY_DIVISOR).toFixed(2)),
    vacaciones,
    navidad,
    preaviso,
    cesantia,
    total: parseFloat(total.toFixed(2)),
    isCommissionBased,
    commissionTotal: isCommissionBased ? commissionTotal : null,
  }
}

// ── Type badge colors ─────────────────────────────────────────────────────────
const TYPE_COLORS = {
  lavador:  { bg: 'bg-sky-50',    text: 'text-sky-700',    border: 'border-sky-200' },
  vendedor: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
  cajero:   { bg: 'bg-emerald-50',text: 'text-emerald-700',border: 'border-emerald-200' },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, sub, accent }) {
  const a = {
    sky:    'bg-sky-50 text-sky-600 border-sky-100',
    green:  'bg-green-50 text-green-600 border-green-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    slate:  'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <div className="flex-1 min-w-0 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-3 md:px-5 py-3 md:py-4">
      <div className={`w-7 h-7 md:w-9 md:h-9 rounded-xl flex items-center justify-center border ${a[accent]} mb-2 md:mb-3`}>
        <Icon size={14} />
      </div>
      <p className="text-[9px] md:text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider truncate">{label}</p>
      <p className="text-[15px] md:text-[21px] font-bold text-slate-800 dark:text-white leading-tight mt-0.5 truncate">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{sub}</p>}
    </div>
  )
}

function AccessDenied({ lang }) {
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
            ? 'Solo gerentes, duenos, contadores y CFO pueden ver las nominas.'
            : 'Only managers, owners, accountants, and CFO can view payroll.'}
        </p>
      </div>
    </div>
  )
}

function TypeBadge({ tipo, t }) {
  const c = TYPE_COLORS[tipo] || TYPE_COLORS.lavador
  const label = t(`payroll_${tipo}`)
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
      {label}
    </span>
  )
}

// ── Employee form panel ───────────────────────────────────────────────────────

function EmployeePanel({ emp, onSave, onClose, lang, t }) {
  const L = (es, en) => lang === 'es' ? es : en
  const isEdit = !!emp?.id
  const [form, setForm] = useState({
    nombre: emp?.nombre || '',
    tipo: emp?.tipo || 'lavador',
    salary: emp?.salary ? String(emp.salary) : '',
    start_date: emp?.start_date || '',
    cedula: emp?.cedula || '',
    phone: emp?.phone || '',
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
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        salary: parseFloat(form.salary) || 0,
        start_date: form.start_date,
        cedula: form.cedula.trim() || null,
        phone: form.phone.trim() || null,
      })
    } catch (e) { setError(e.message || L('Error al guardar', 'Error saving')) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-black rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">
            {isEdit ? t('payroll_edit') : t('payroll_add')}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 mb-1">{t('payroll_name')} *</label>
            <input value={form.nombre} onChange={e => set('nombre', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:border-sky-400" placeholder="Juan Garcia" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 mb-1">{t('payroll_type')}</label>
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:border-sky-400 bg-white">
              <option value="lavador">{t('payroll_lavador')}</option>
              <option value="vendedor">{t('payroll_vendedor')}</option>
              <option value="cajero">{t('payroll_cajero')}</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 mb-1">{t('payroll_salary')}</label>
            <input type="number" min="0" step="0.01" value={form.salary} onChange={e => set('salary', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:border-sky-400" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 mb-1">{t('payroll_start_date')} *</label>
            <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:border-sky-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 mb-1">{t('payroll_cedula')}</label>
              <input value={form.cedula} onChange={e => set('cedula', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:border-sky-400" placeholder="001-0000000-0" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 mb-1">{t('payroll_phone')}</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:border-sky-400" placeholder="809-555-0000" />
            </div>
          </div>
        </div>
        {error && <p className="px-5 pb-2 text-[11px] text-red-500">{error}</p>}
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100 dark:border-white/10">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] disabled:opacity-50 transition-colors">

            {saving ? (lang === 'es' ? 'Guardando...' : 'Saving...') : (lang === 'es' ? 'Guardar' : 'Save')}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 text-[12px] text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Pay Payroll Modal ─────────────────────────────────────────────────────────
function PayPayrollModal({ emp, currentCommissionTotal, onSave, onClose, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  // Default period = previous full calendar month (1st to last day)
  const today = new Date()
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const iso = (d) => d.toISOString().slice(0, 10)

  const [periodStart, setPeriodStart] = useState(iso(lastMonthStart))
  const [periodEnd,   setPeriodEnd]   = useState(iso(lastMonthEnd))
  const [base,        setBase]        = useState(String(emp.salary || 0))
  const [commissions, setCommissions] = useState('0')
  const [bonuses,     setBonuses]     = useState('0')
  const [deductions,  setDeductions]  = useState('')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)

  const baseNum = parseFloat(base) || 0
  const commNum = parseFloat(commissions) || 0
  const bonusNum = parseFloat(bonuses) || 0
  const deductNum = deductions === '' ? parseFloat(((baseNum + commNum) * TSS_RATE).toFixed(2)) : (parseFloat(deductions) || 0)
  const gross = baseNum + commNum + bonusNum
  const net = gross - deductNum

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
        deductions:   deductNum,
        net,
        notes:        notes.trim() || null,
      })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white">{L('Registrar Pago de Nómina', 'Record Payroll Payment')}</h3>
            <p className="text-[11px] text-slate-400 dark:text-white/40">{emp.nombre}</p>
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
            <label className="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">
              <span>{L('Comisiones', 'Commissions')}</span>
              {currentCommissionTotal > 0 && (
                <button type="button" onClick={() => setCommissions(String(currentCommissionTotal))}
                  className="text-[10px] text-emerald-600 dark:text-emerald-400 normal-case tracking-normal hover:underline">
                  {L(`Usar total: ${fmtRD(currentCommissionTotal)}`, `Use total: ${fmtRD(currentCommissionTotal)}`)}
                </button>
              )}
            </label>
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
                {L('Descuentos', 'Deductions')} <span className="text-slate-400 dark:text-white/30 normal-case">({L('auto TSS', 'auto TSS')})</span>
              </label>
              <input type="number" min="0" step="0.01" value={deductions} placeholder={String(parseFloat(((baseNum + commNum) * TSS_RATE).toFixed(2)))} onChange={e => setDeductions(e.target.value)}
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">{L('Notas', 'Notes')}</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder={L('Opcional', 'Optional')}
              className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          {/* Live summary */}
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-4 py-3 space-y-1">
            <div className="flex justify-between text-[12px] text-slate-600 dark:text-white/60">
              <span>{L('Bruto', 'Gross')}</span>
              <span className="font-semibold text-slate-800 dark:text-white">{fmtRD(gross)}</span>
            </div>
            <div className="flex justify-between text-[12px] text-slate-600 dark:text-white/60">
              <span>{L('Descuentos', 'Deductions')}</span>
              <span className="font-semibold text-red-600 dark:text-red-400">− {fmtRD(deductNum)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-emerald-200 dark:border-emerald-500/20">
              <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400">{L('NETO A PAGAR', 'NET TO PAY')}</span>
              <span className="text-[16px] font-bold text-emerald-700 dark:text-emerald-400">{fmtRD(net)}</span>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex gap-2">
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

// ── Payroll History Panel (shown when viewMode === 'history') ─────────────────
function PayrollHistoryPanel({ runs, loading, onDelete, onPrint, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-300 dark:text-white/30 text-sm">{L('Cargando historial…', 'Loading history…')}</div>
  }
  if (!runs.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-300 dark:text-white/30">
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
        {runs.map(r => (
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
                <p className="text-red-500 dark:text-red-400 font-semibold">− {fmtRD(r.deductions || 0)}</p>
              </div>
            </div>

            {r.notes && <p className="text-[11px] text-slate-500 dark:text-white/60 italic mb-2">{r.notes}</p>}

            <div className="flex justify-end gap-1.5">
              <button onClick={() => onPrint(r)}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-md hover:bg-slate-100 dark:hover:bg-white/10">
                <Printer size={11} /> {L('Imprimir recibo', 'Print stub')}
              </button>
              <button onClick={() => onDelete(r.id)}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-red-500 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10">
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Paycheck stub printer ─────────────────────────────────────────────────────
function printPaycheckStub(biz, emp, run, L) {
  const fmt = (n) => `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${L('Recibo de Pago', 'Paycheck Stub')} — ${emp.nombre}</title><style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; color: #1e293b; }
    h1 { font-size: 18px; margin: 0; }
    .muted { color: #64748b; font-size: 11px; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
    .row:last-child { border-bottom: none; }
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
      <div class="row"><span class="muted">${L('Tipo', 'Type')}</span><span style="text-transform:capitalize;">${emp.tipo}</span></div>
      <div class="row"><span class="muted">${L('Período', 'Period')}</span><span>${run.period_start} → ${run.period_end}</span></div>
      <div class="row"><span class="muted">${L('Fecha de pago', 'Payment date')}</span><span>${new Date(run.paid_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
    </div>

    <div class="box">
      <div class="row"><span>${L('Salario base', 'Base salary')}</span><span>${fmt(run.base)}</span></div>
      <div class="row"><span>${L('Comisiones', 'Commissions')}</span><span>${fmt(run.commissions)}</span></div>
      <div class="row"><span>${L('Bonos', 'Bonuses')}</span><span>${fmt(run.bonuses)}</span></div>
      <div class="row"><span>${L('Descuentos (TSS/ISR)', 'Deductions (TSS/ISR)')}</span><span style="color:#dc2626;">− ${fmt(run.deductions)}</span></div>
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

// ── CSV export ────────────────────────────────────────────────────────────────
// ── CSV export (removed — now uses services/csv.js) ──────────────────────────

// ── Main component ────────────────────────────────────────────────────────────

export default function PayrollReport() {
  const { user } = useAuth()
  const api = useAPI()
  const { lang, t } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  if (!ALLOWED_ROLES.includes(user?.role)) return <AccessDenied lang={lang} />

  const [empleados, setEmpleados] = useState([])
  const [washerCommTotals, setWasherCommTotals] = useState({}) // washer_id -> total
  const [sellerCommTotals, setSellerCommTotals] = useState({}) // seller_id -> total
  const [cajeroCommTotals, setCajeroCommTotals] = useState({}) // cajero_id -> total
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [tipo, setTipo] = useState('desahucio')
  const [showPanel, setShowPanel] = useState(null) // null | 'add' | empleado object
  const [biz, setBiz] = useState({})
  const [viewMode, setViewMode] = useState('liquidacion') // 'liquidacion' | 'history'
  const [runs, setRuns] = useState([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => { load() }, [])
  useEffect(() => { api.admin?.getEmpresa?.().then(e => e && setBiz({ name: e.name || e.nombre, rnc: e.rnc, address: e.address || e.direccion, phone: e.phone || e.telefono, email: e.email, logo: e.logo })).catch(() => {}) }, [])

  async function load() {
    setLoading(true)
    try {
      const [list, washerData, sellerData, cajeroData] = await Promise.all([
        api?.empleados?.all?.() || [],
        api?.commissions?.byPeriod?.({}) || [],
        api?.sellerCommissions?.byPeriod?.({}) || [],
        api?.cajeroCommissions?.byPeriod?.({}) || [],
      ])
      setEmpleados(list || [])
      const buildMap = (rows, idKey) => {
        const map = {}
        for (const row of (rows || [])) {
          const id = String(row[idKey])
          map[id] = (map[id] || 0) + (row.total_commission || row.commission_amount || 0)
        }
        return map
      }
      setWasherCommTotals(buildMap(washerData, 'washer_id'))
      setSellerCommTotals(buildMap(sellerData, 'seller_id'))
      setCajeroCommTotals(buildMap(cajeroData, 'cajero_id'))
    } catch {}
    setLoading(false)
  }

  const selected = useMemo(() => {
    if (!selectedId) return null
    return empleados.find(e => String(e.id) === String(selectedId)) || null
  }, [selectedId, empleados])

  // Get total commissions for any employee type based on their ref_id
  function getCommissionTotal(emp) {
    if (!emp?.ref_id) return 0
    const ref = String(emp.ref_id)
    if (emp.tipo === 'lavador')  return washerCommTotals[ref] || 0
    if (emp.tipo === 'vendedor') return sellerCommTotals[ref] || 0
    if (emp.tipo === 'cajero')   return cajeroCommTotals[ref] || 0
    return 0
  }

  const liq = useMemo(() => {
    if (!selected) return null
    return calcLiquidacion(selected, tipo, getCommissionTotal(selected))
  }, [selected, tipo, washerCommTotals, sellerCommTotals, cajeroCommTotals])

  async function handleSave(data) {
    if (data.id) {
      await api.empleados.update(data)
    } else {
      await api.empleados.create(data)
    }
    setShowPanel(null)
    await load()
  }

  async function handleDeactivate(emp) {
    if (!confirm(t('payroll_confirm_delete'))) return
    await api.empleados.update({ id: emp.id, active: 0 })
    if (String(selectedId) === String(emp.id)) setSelectedId(null)
    await load()
  }

  // Load payroll history for the selected employee whenever the selection changes
  useEffect(() => {
    if (!selected?.id) { setRuns([]); return }
    let cancelled = false
    setLoadingRuns(true)
    Promise.resolve(api?.payrollRuns?.byEmpleado?.(selected.id, 50) || [])
      .then(rows => { if (!cancelled) setRuns(rows || []) })
      .catch(() => { if (!cancelled) setRuns([]) })
      .finally(() => { if (!cancelled) setLoadingRuns(false) })
    return () => { cancelled = true }
  }, [selected?.id])

  async function handleRecordRun(payload) {
    try {
      await api.payrollRuns.create({
        empleado_id: selected.id,
        ...payload,
        paid_by: user?.id || null,
      })
      const rows = await api.payrollRuns.byEmpleado(selected.id, 50)
      setRuns(rows || [])
      setShowPayModal(false)
      showToast(L('Nómina registrada ✓', 'Paycheck recorded ✓'))
    } catch (e) {
      showToast(L('Error al guardar nómina', 'Error saving paycheck'), 'error')
    }
  }

  async function handleDeleteRun(runId) {
    if (!confirm(L('¿Eliminar este pago del historial?', 'Delete this paycheck from history?'))) return
    try {
      await api.payrollRuns.remove(runId)
      setRuns(runs.filter(r => r.id !== runId))
      showToast(L('Eliminado', 'Deleted'))
    } catch { showToast(L('Error al eliminar', 'Error deleting'), 'error') }
  }

  function showToast(msg, variant = 'ok') {
    setToast({ msg, variant })
    setTimeout(() => setToast(null), 2500)
  }

  // Summary metrics
  const totalNomina = useMemo(() => empleados.reduce((s, e) => s + (e.salary || 0), 0), [empleados])
  const conSalario = useMemo(() => empleados.filter(e => e.salary > 0).length, [empleados])
  const conComision = useMemo(() => empleados.filter(e => !e.salary && getCommissionTotal(e) > 0).length, [empleados, washerCommTotals, sellerCommTotals, cajeroCommTotals])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 md:px-6 py-3 md:py-4">
        <div className="grid grid-cols-2 md:flex gap-2 md:gap-3 mb-4">
          <MetricCard icon={Users}      label={L('Empleados', 'Employees')}          value={empleados.length}   accent="sky" />
          <MetricCard icon={DollarSign} label={L('Nomina Mensual', 'Monthly Payroll')} value={fmtRD(totalNomina)} accent="green" />
          <MetricCard icon={Calculator} label={L('Con Salario', 'With Salary')}       value={conSalario}          accent="violet" />
          <MetricCard icon={Calendar}   label={L('Solo Comision', 'Commission Only')} value={conComision} sub={conComision > 0 ? L(`de ${empleados.length - conSalario} sin salario`, `of ${empleados.length - conSalario} no salary`) : null} accent="slate" />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden px-3 md:px-6 pb-4 gap-4">

        {/* Left: employee list */}
        <div className="md:w-[340px] shrink-0 flex flex-col bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-white/10">
            <p className="text-[12px] font-bold text-slate-500 dark:text-white/60">{empleados.length} {L('empleados', 'employees')}</p>
            <button onClick={() => setShowPanel('add')}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#0C447C] text-white text-[11px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
              <Plus size={12} /> {t('payroll_add')}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-slate-300 dark:text-white/30 gap-3">
                <div className="w-5 h-5 border-2 border-slate-200 dark:border-white/10 border-t-sky-500 rounded-full animate-spin" />
              </div>
            ) : empleados.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-slate-300 dark:text-white/30 text-[13px]">
                {t('payroll_no_employees')}
              </div>
            ) : (
              empleados.map(emp => {
                const ant = calcAntiguedad(emp.start_date)
                const isSelected = String(emp.id) === String(selectedId)
                return (
                  <button key={emp.id} onClick={() => setSelectedId(String(emp.id))}
                    className={`w-full flex items-center gap-3 px-4 py-3 border-b border-slate-50 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left ${isSelected ? 'bg-sky-50/60 dark:bg-sky-900/20 border-l-2 border-l-sky-500' : ''}`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${TYPE_COLORS[emp.tipo]?.bg || 'bg-slate-100'} ${TYPE_COLORS[emp.tipo]?.text || 'text-slate-600'}`}>
                      {emp.nombre.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{emp.nombre}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <TypeBadge tipo={emp.tipo} t={t} />
                        {ant.totalMonths > 0 && (
                          <span className="text-[10px] text-slate-400 dark:text-white/40">
                            {ant.years > 0 ? `${ant.years}a ` : ''}{ant.months}m
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {emp.salary > 0 ? (
                        <p className="text-[12px] font-semibold text-emerald-700">{fmtRD(emp.salary)}</p>
                      ) : emp.tipo === 'lavador' && emp.ref_id && washerCommTotals[String(emp.ref_id)] > 0 ? (
                        <div>
                          <p className="text-[12px] font-semibold text-sky-700">
                            {fmtRD(washerCommTotals[String(emp.ref_id)])}
                          </p>
                          <p className="text-[9px] text-sky-500">{L('comisiones', 'commissions')}</p>
                        </div>
                      ) : (
                        <span className="text-[10px] text-amber-600 flex items-center gap-1">
                          <AlertCircle size={10} /> {L('Sin salario', 'No salary')}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: liquidacion detail */}
        <div className="flex-1 flex flex-col bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-slate-300 dark:text-white/30">
              <div className="text-center">
                <Calculator size={40} className="mx-auto mb-3 text-slate-200 dark:text-white/20" />
                <p className="text-[13px]">{t('payroll_select_worker')}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Employee header */}
              <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold ${TYPE_COLORS[selected.tipo]?.bg} ${TYPE_COLORS[selected.tipo]?.text}`}>
                    {selected.nombre.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">{selected.nombre}</h3>
                    <div className="flex items-center gap-2">
                      <TypeBadge tipo={selected.tipo} t={t} />
                      {selected.cedula && <span className="text-[11px] text-slate-400 dark:text-white/40">{selected.cedula}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowPayModal(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold rounded-lg transition-colors">
                    <Banknote size={13} /> {L('Pagar Nómina', 'Pay Payroll')}
                  </button>
                  <button onClick={() => setShowPanel(selected)}
                    className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => handleDeactivate(selected)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                    <Power size={14} />
                  </button>
                </div>
              </div>

              {/* View mode toggle: Liquidación / Historial */}
              <div className="shrink-0 flex items-center gap-2 px-5 py-2.5 border-b border-slate-100 dark:border-white/10">
                {[
                  { id: 'liquidacion', icon: Calculator, label: L('Liquidación', 'Severance') },
                  { id: 'history',     icon: History,    label: L('Historial de Nómina', 'Payroll History'), count: runs.length },
                ].map(m => {
                  const Icon = m.icon
                  const active = viewMode === m.id
                  return (
                    <button key={m.id} onClick={() => setViewMode(m.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                        active
                          ? 'bg-slate-800 text-white dark:bg-white dark:text-black'
                          : 'text-slate-500 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}>
                      <Icon size={13} />
                      {m.label}
                      {m.count != null && m.count > 0 && (
                        <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                          active ? 'bg-white/20 dark:bg-black/20' : 'bg-slate-200 dark:bg-white/10'
                        }`}>{m.count}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {viewMode === 'history' ? (
                <PayrollHistoryPanel
                  runs={runs}
                  loading={loadingRuns}
                  onDelete={handleDeleteRun}
                  onPrint={(run) => printPaycheckStub(biz, selected, run, L)}
                  lang={lang}
                />
              ) : (<>

              {/* Renuncia / Desahucio toggle */}
              <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5">
                <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                  {L('Tipo de salida', 'Exit type')}
                </span>
                <div className="flex bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
                  {['desahucio', 'renuncia'].map(t2 => (
                    <button key={t2} onClick={() => setTipo(t2)}
                      className={`px-4 py-2 text-[12px] font-semibold transition-colors ${tipo === t2 ? 'bg-[#0C447C] text-white' : 'text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
                      {t(`payroll_${t2}`)}
                    </button>
                  ))}
                </div>
              </div>

              {!liq ? (
                <div className="flex-1 flex items-center justify-center text-amber-500">
                  <div className="text-center">
                    <AlertCircle size={32} className="mx-auto mb-2" />
                    <p className="text-[13px] font-semibold">
                      {!selected.start_date
                        ? t('payroll_no_start')
                        : selected.tipo === 'lavador' && !selected.salary
                          ? L('Sin comisiones registradas', 'No commissions recorded')
                          : t('payroll_no_salary')}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {selected.tipo === 'lavador' && !selected.salary
                        ? L('Este lavador no tiene salario fijo ni comisiones para calcular', 'This washer has no fixed salary or commissions to calculate from')
                        : L('Edite el empleado para completar los datos', 'Edit the employee to complete the data')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  {/* Commission-based income notice */}
                  {liq.isCommissionBased && (
                    <div className="mx-4 md:mx-5 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                      <p className="text-[11px] text-amber-700 font-medium">
                        {L(
                          `Base: promedio mensual de comisiones (${fmtRD(liq.commissionTotal)} total / ${liq.antiguedad.totalMonths} meses = ${fmtRD(liq.monthlySalary)}/mes)`,
                          `Base: average monthly commissions (${fmtRD(liq.commissionTotal)} total / ${liq.antiguedad.totalMonths} months = ${fmtRD(liq.monthlySalary)}/mo)`
                        )}
                      </p>
                    </div>
                  )}

                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-2 md:gap-3 px-4 md:px-5 py-3 md:py-4">
                    <div className="rounded-xl px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{t('payroll_antiguedad')}</p>
                      <p className="text-[16px] md:text-[18px] font-bold text-slate-800 dark:text-white mt-0.5">
                        {liq.antiguedad.years}a {liq.antiguedad.months}m
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-white/40">{liq.antiguedad.days} {t('payroll_days')}</p>
                    </div>
                    <div className="rounded-xl px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                        {liq.isCommissionBased ? L('Ingreso Mensual', 'Monthly Income') : t('payroll_daily_rate')}
                      </p>
                      <p className="text-[16px] md:text-[18px] font-bold text-slate-800 dark:text-white mt-0.5">
                        {liq.isCommissionBased ? fmtRD(liq.monthlySalary) : fmtRD(liq.dailyRate)}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-white/40">
                        {liq.isCommissionBased ? L('prom. comisiones', 'avg. commissions') : '/ 23.83'}
                      </p>
                    </div>
                    <div className="rounded-xl px-4 py-3 bg-sky-50 border border-sky-100">
                      <p className="text-[10px] font-bold text-sky-500 uppercase tracking-wider">{t('payroll_total')}</p>
                      <p className="text-[16px] md:text-[18px] font-bold text-sky-700 mt-0.5">{fmtRD(liq.total)}</p>
                      <p className="text-[10px] text-sky-400">{t(`payroll_${tipo}`)}</p>
                    </div>
                  </div>

                  {/* Breakdown table */}
                  <div className="px-4 md:px-5 pb-4">
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                        <span className="flex-1">{t('payroll_concepto')}</span>
                        <span className="w-[80px] text-right">{t('payroll_dias')}</span>
                        <span className="w-[130px] text-right">{t('payroll_monto')}</span>
                      </div>
                      {/* Rows */}
                      {[
                        { key: 'vacaciones', label: t('payroll_vacaciones'), days: liq.vacaciones.days, amount: liq.vacaciones.amount, show: true },
                        { key: 'navidad',    label: t('payroll_navidad'),    days: null,                amount: liq.navidad.amount,    show: true },
                        { key: 'preaviso',   label: t('payroll_preaviso'),   days: liq.preaviso.days,   amount: liq.preaviso.amount,   show: tipo === 'desahucio' },
                        { key: 'cesantia',   label: t('payroll_cesantia'),   days: liq.cesantia.days,   amount: liq.cesantia.amount,   show: tipo === 'desahucio' },
                      ].filter(r => r.show).map(row => (
                        <div key={row.key} className="flex items-center px-4 py-3 border-b border-slate-100 dark:border-white/10 last:border-0">
                          <span className="flex-1 text-[13px] text-slate-700 dark:text-white font-medium">{row.label}</span>
                          <span className="w-[80px] text-right text-[12px] text-slate-500 dark:text-white/60">
                            {row.days != null ? row.days.toFixed(1) : '--'}
                          </span>
                          <span className="w-[130px] text-right text-[13px] font-semibold text-emerald-700">
                            {fmtRD(row.amount)}
                          </span>
                        </div>
                      ))}
                      {/* Total */}
                      <div className="flex items-center px-4 py-3 bg-sky-50 border-t-2 border-sky-200">
                        <span className="flex-1 text-[13px] font-bold text-sky-800 uppercase">Total</span>
                        <span className="w-[80px]" />
                        <span className="w-[130px] text-right text-[16px] font-bold text-sky-700">{fmtRD(liq.total)}</span>
                      </div>
                    </div>

                    {/* Export / Print buttons */}
                    <div className="flex justify-end gap-2 mt-3">
                      <button onClick={() => exportLiquidacion(biz, selected, { ...liq, antiguedad: `${liq.antiguedad.years}a ${liq.antiguedad.months}m ${liq.antiguedad.days}d`, monthlyBase: liq.monthlySalary }, tipo)}
                        className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
                        <Download size={12} /> {t('payroll_export')}
                      </button>
                      <button onClick={() => printLiquidacion(biz, selected, { ...liq, antiguedad: `${liq.antiguedad.years}a ${liq.antiguedad.months}m ${liq.antiguedad.days}d`, monthlyBase: liq.monthlySalary }, tipo)}
                        className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
                        <Printer size={12} /> Imprimir
                      </button>
                    </div>
                  </div>

                  {/* Legal reference */}
                  <div className="px-4 md:px-5 pb-4">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                        {L('Base Legal', 'Legal Basis')}
                      </p>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        {L(
                          'Codigo de Trabajo, Ley 16-92. Divisor legal: 23.83 dias/mes. Cesantia Art. 80. Preaviso Art. 76. Vacaciones Art. 177-180. Salario de Navidad Art. 219.',
                          'Dominican Labor Code, Law 16-92. Legal divisor: 23.83 days/month. Severance Art. 80. Notice Art. 76. Vacation Art. 177-180. Christmas Bonus Art. 219.'
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              </>)}
            </>
          )}
        </div>
      </div>

      {/* Employee form modal */}
      {showPanel && (
        <EmployeePanel
          emp={showPanel === 'add' ? null : showPanel}
          onSave={handleSave}
          onClose={() => setShowPanel(null)}
          lang={lang}
          t={t}
        />
      )}

      {/* Pay Payroll modal */}
      {showPayModal && selected && (
        <PayPayrollModal
          emp={selected}
          currentCommissionTotal={getCommissionTotal(selected)}
          onSave={handleRecordRun}
          onClose={() => setShowPayModal(false)}
          lang={lang}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2 ${
          toast.variant === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          <Check size={15} /> {toast.msg}
        </div>
      )}
    </div>
  )
}
