import { useState, useMemo, useEffect } from 'react'
import { Lock, Download, Printer, Plus, Edit2, Power, Users, Calculator, Calendar, DollarSign, AlertCircle, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { exportLiquidacion } from '../../services/csv'
import { printLiquidacion } from '../../services/report-html'

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

  // For commission-based workers (lavadores), use average monthly commissions as salary base
  let monthlySalary = emp.salary || 0
  let isCommissionBased = false
  if (emp.tipo === 'lavador' && commissionTotal > 0 && ant.totalMonths > 0) {
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
    <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-2xl px-3 md:px-5 py-3 md:py-4">
      <div className={`w-7 h-7 md:w-9 md:h-9 rounded-xl flex items-center justify-center border ${a[accent]} mb-2 md:mb-3`}>
        <Icon size={14} />
      </div>
      <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</p>
      <p className="text-[15px] md:text-[21px] font-bold text-slate-800 leading-tight mt-0.5 truncate">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function AccessDenied({ lang }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400 bg-slate-50">
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-slate-300" />
      </div>
      <div className="text-center">
        <p className="text-[15px] font-bold text-slate-600 mb-1">
          {lang === 'es' ? 'Acceso Restringido' : 'Restricted Access'}
        </p>
        <p className="text-[12px] text-slate-400 max-w-[260px]">
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-[14px] font-bold text-slate-800">
            {isEdit ? t('payroll_edit') : t('payroll_add')}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">{t('payroll_name')} *</label>
            <input value={form.nombre} onChange={e => set('nombre', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" placeholder="Juan Garcia" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">{t('payroll_type')}</label>
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400 bg-white">
              <option value="lavador">{t('payroll_lavador')}</option>
              <option value="vendedor">{t('payroll_vendedor')}</option>
              <option value="cajero">{t('payroll_cajero')}</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">{t('payroll_salary')}</label>
            <input type="number" min="0" step="0.01" value={form.salary} onChange={e => set('salary', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">{t('payroll_start_date')} *</label>
            <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">{t('payroll_cedula')}</label>
              <input value={form.cedula} onChange={e => set('cedula', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" placeholder="001-0000000-0" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">{t('payroll_phone')}</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" placeholder="809-555-0000" />
            </div>
          </div>
        </div>
        {error && <p className="px-5 pb-2 text-[11px] text-red-500">{error}</p>}
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] disabled:opacity-50 transition-colors">
            {saving ? (lang === 'es' ? 'Guardando...' : 'Saving...') : (lang === 'es' ? 'Guardar' : 'Save')}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [washerCommTotals, setWasherCommTotals] = useState({}) // washer_id -> total_commission
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [tipo, setTipo] = useState('desahucio')
  const [showPanel, setShowPanel] = useState(null) // null | 'add' | empleado object
  const [biz, setBiz] = useState({})

  useEffect(() => { load() }, [])
  useEffect(() => { api.admin?.getEmpresa?.().then(e => e && setBiz({ name: e.nombre, rnc: e.rnc, address: e.direccion, phone: e.telefono, email: e.email })).catch(() => {}) }, [])

  async function load() {
    setLoading(true)
    try {
      const [list, commData] = await Promise.all([
        api?.empleados?.all?.() || [],
        api?.commissions?.byPeriod?.({}) || [],
      ])
      setEmpleados(list || [])
      // Build washer_id -> total_commission map
      const map = {}
      for (const row of (commData || [])) {
        const wid = String(row.washer_id)
        map[wid] = (map[wid] || 0) + (row.total_commission || 0)
      }
      setWasherCommTotals(map)
    } catch {}
    setLoading(false)
  }

  const selected = useMemo(() => {
    if (!selectedId) return null
    return empleados.find(e => String(e.id) === String(selectedId)) || null
  }, [selectedId, empleados])

  const liq = useMemo(() => {
    if (!selected) return null
    // For lavadores, look up their total commissions via ref_id (links to washers.id)
    let commTotal = 0
    if (selected.tipo === 'lavador' && selected.ref_id) {
      commTotal = washerCommTotals[String(selected.ref_id)] || 0
    }
    return calcLiquidacion(selected, tipo, commTotal)
  }, [selected, tipo, washerCommTotals])

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

  // Summary metrics
  const totalNomina = useMemo(() => empleados.reduce((s, e) => s + (e.salary || 0), 0), [empleados])
  const conSalario = useMemo(() => empleados.filter(e => e.salary > 0).length, [empleados])
  const conComision = useMemo(() => empleados.filter(e => e.tipo === 'lavador' && !e.salary && e.ref_id && washerCommTotals[String(e.ref_id)] > 0).length, [empleados, washerCommTotals])

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
        <div className="md:w-[340px] shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="text-[12px] font-bold text-slate-500">{empleados.length} {L('empleados', 'employees')}</p>
            <button onClick={() => setShowPanel('add')}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#0C447C] text-white text-[11px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
              <Plus size={12} /> {t('payroll_add')}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-slate-300 gap-3">
                <div className="w-5 h-5 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin" />
              </div>
            ) : empleados.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-slate-300 text-[13px]">
                {t('payroll_no_employees')}
              </div>
            ) : (
              empleados.map(emp => {
                const ant = calcAntiguedad(emp.start_date)
                const isSelected = String(emp.id) === String(selectedId)
                return (
                  <button key={emp.id} onClick={() => setSelectedId(String(emp.id))}
                    className={`w-full flex items-center gap-3 px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors text-left ${isSelected ? 'bg-sky-50/60 border-l-2 border-l-sky-500' : ''}`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${TYPE_COLORS[emp.tipo]?.bg || 'bg-slate-100'} ${TYPE_COLORS[emp.tipo]?.text || 'text-slate-600'}`}>
                      {emp.nombre.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-800 truncate">{emp.nombre}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <TypeBadge tipo={emp.tipo} t={t} />
                        {ant.totalMonths > 0 && (
                          <span className="text-[10px] text-slate-400">
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
        <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-slate-300">
              <div className="text-center">
                <Calculator size={40} className="mx-auto mb-3 text-slate-200" />
                <p className="text-[13px]">{t('payroll_select_worker')}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Employee header */}
              <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold ${TYPE_COLORS[selected.tipo]?.bg} ${TYPE_COLORS[selected.tipo]?.text}`}>
                    {selected.nombre.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold text-slate-800">{selected.nombre}</h3>
                    <div className="flex items-center gap-2">
                      <TypeBadge tipo={selected.tipo} t={t} />
                      {selected.cedula && <span className="text-[11px] text-slate-400">{selected.cedula}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowPanel(selected)}
                    className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => handleDeactivate(selected)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Power size={14} />
                  </button>
                </div>
              </div>

              {/* Renuncia / Desahucio toggle */}
              <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  {L('Tipo de salida', 'Exit type')}
                </span>
                <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {['desahucio', 'renuncia'].map(t2 => (
                    <button key={t2} onClick={() => setTipo(t2)}
                      className={`px-4 py-2 text-[12px] font-semibold transition-colors ${tipo === t2 ? 'bg-[#0C447C] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
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
                    <div className="rounded-xl px-4 py-3 bg-slate-50 border border-slate-200">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('payroll_antiguedad')}</p>
                      <p className="text-[16px] md:text-[18px] font-bold text-slate-800 mt-0.5">
                        {liq.antiguedad.years}a {liq.antiguedad.months}m
                      </p>
                      <p className="text-[10px] text-slate-400">{liq.antiguedad.days} {t('payroll_days')}</p>
                    </div>
                    <div className="rounded-xl px-4 py-3 bg-slate-50 border border-slate-200">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {liq.isCommissionBased ? L('Ingreso Mensual', 'Monthly Income') : t('payroll_daily_rate')}
                      </p>
                      <p className="text-[16px] md:text-[18px] font-bold text-slate-800 mt-0.5">
                        {liq.isCommissionBased ? fmtRD(liq.monthlySalary) : fmtRD(liq.dailyRate)}
                      </p>
                      <p className="text-[10px] text-slate-400">
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
                      <div className="flex items-center px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
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
                        <div key={row.key} className="flex items-center px-4 py-3 border-b border-slate-100 last:border-0">
                          <span className="flex-1 text-[13px] text-slate-700 font-medium">{row.label}</span>
                          <span className="w-[80px] text-right text-[12px] text-slate-500">
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
                        className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        <Download size={12} /> {t('payroll_export')}
                      </button>
                      <button onClick={() => printLiquidacion(biz, selected, { ...liq, antiguedad: `${liq.antiguedad.years}a ${liq.antiguedad.months}m ${liq.antiguedad.days}d`, monthlyBase: liq.monthlySalary }, tipo)}
                        className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        <Printer size={12} /> Imprimir
                      </button>
                    </div>
                  </div>

                  {/* Legal reference */}
                  <div className="px-4 md:px-5 pb-4">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
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
    </div>
  )
}
