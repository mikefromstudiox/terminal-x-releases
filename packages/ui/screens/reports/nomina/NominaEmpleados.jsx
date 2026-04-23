/**
 * NominaEmpleados.jsx — Employee list + detail view.
 *
 * Left: scrollable list with search + type filter
 * Right: selected employee profile with inner sub-tabs:
 *   - Historial de Pagos (PayrollHistoryPanel)
 *   - Comisiones (monthly earnings chart)
 *   - Liquidación (Ley 16-92 severance calc)
 *   - Cambios de salario (audit log from salary_changes)
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Plus, Edit2, Power, Search, AlertCircle, Banknote, History, TrendingUp,
  Calculator, ClipboardList, Mail, Phone, CreditCard, IdCard, Calendar,
  Briefcase, Trash2, X, ChevronLeft,
} from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'
import { useBusinessType } from '../../../hooks/useBusinessType.jsx'
import { isServiceBased } from '@terminal-x/config/businessTypes'
import {
  fmtRD, TYPE_COLORS, MetricCard, TypeBadge, EmployeePanel, PayPayrollModal,
  PayrollHistoryPanel, printPaycheckStub,
} from './shared'
import { calcLiquidacion, calcAntiguedad } from './lib/calcLiquidacion'

export default function NominaEmpleados() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const { businessType } = useBusinessType()
  const showWashers = isServiceBased(businessType)
  const L = (es, en) => lang === 'es' ? es : en

  const [empleados,       setEmpleados]       = useState([])
  const [loading,         setLoading]         = useState(true)
  const [selectedId,      setSelectedId]      = useState(null)
  const [search,          setSearch]          = useState('')
  const [filterTipo,      setFilterTipo]      = useState('all')
  const [innerTab,        setInnerTab]        = useState('historial')  // historial | comisiones | liquidacion | salary-log
  const [showPanel,       setShowPanel]       = useState(null)          // null | 'add' | emp
  const [showPayModal,    setShowPayModal]    = useState(false)
  const [settings,        setSettings]        = useState(null)
  const [biz,             setBiz]             = useState({})
  // Selected employee state
  const [runs,            setRuns]            = useState([])
  const [loadingRuns,     setLoadingRuns]     = useState(false)
  const [salaryChanges,   setSalaryChanges]   = useState([])
  const [commRows,        setCommRows]        = useState([])
  // Commission totals (all-time per employee for liquidación calc)
  const [commTotals,      setCommTotals]      = useState({ washers: {}, sellers: {}, cajeros: {} })
  const [liqTipo,         setLiqTipo]         = useState('desahucio')
  const [toast,           setToast]           = useState(null)
  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const [showCommModal,   setShowCommModal]   = useState(false)
  const canHardDelete = user?.role === 'owner' || user?.role === 'manager'

  function showToast(msg, variant = 'ok') {
    setToast({ msg, variant })
    setTimeout(() => setToast(null), 2500)
  }

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [list, sets, empresa, washerComm, sellerComm, cajeroComm] = await Promise.all([
        api?.empleados?.all?.() || [],
        api?.payrollSettings?.get?.() || null,
        api?.admin?.getEmpresa?.() || null,
        api?.commissions?.byPeriod?.({}) || [],
        api?.sellerCommissions?.byPeriod?.({}) || [],
        api?.cajeroCommissions?.byPeriod?.({}) || [],
      ])
      setEmpleados(list || [])
      setSettings(sets)
      if (empresa) setBiz({ name: empresa.name || empresa.nombre, rnc: empresa.rnc, address: empresa.address || empresa.direccion, phone: empresa.phone || empresa.telefono, email: empresa.email, logo: empresa.logo })
      // v2.1: Build commission totals keyed by empleado_supabase_id first, with
      // legacy fallbacks (washer_supabase_id → washer_id, etc.) so pre-migration
      // rows still render until sync backfills empleado_supabase_id.
      const build = (rows, legacySupaKey, legacyIdKey) => {
        const bySid = {}, byLegacySid = {}, byLegacyId = {}
        for (const r of (rows || [])) {
          const amt = Number(r.total_commission || r.commission_amount || 0)
          if (r.empleado_supabase_id) {
            const k = String(r.empleado_supabase_id)
            bySid[k] = (bySid[k] || 0) + amt
          } else if (r[legacySupaKey]) {
            const k = String(r[legacySupaKey])
            byLegacySid[k] = (byLegacySid[k] || 0) + amt
          } else if (r[legacyIdKey] != null) {
            const k = String(r[legacyIdKey])
            byLegacyId[k] = (byLegacyId[k] || 0) + amt
          }
        }
        return { bySid, byLegacySid, byLegacyId }
      }
      setCommTotals({
        washers: build(washerComm, 'washer_supabase_id', 'washer_id'),
        sellers: build(sellerComm, 'seller_supabase_id', 'seller_id'),
        cajeros: build(cajeroComm, 'cajero_supabase_id', 'cajero_id'),
      })
    } catch {}
    setLoading(false)
  }

  // ── Selected employee ───────────────────────────────────────────────────────
  const selected = useMemo(() => empleados.find(e => String(e.id) === String(selectedId)) || null, [selectedId, empleados])

  function getCommissionTotal(emp) {
    if (!emp) return 0
    // Pick the table for this empleado's tipo.
    const bucket = emp.tipo === 'lavador'  ? commTotals.washers
                 : emp.tipo === 'vendedor' ? commTotals.sellers
                 : emp.tipo === 'cajero'   ? commTotals.cajeros
                 : null
    if (!bucket) return 0
    // v2.1 canonical: match on empleados.supabase_id → commission.empleado_supabase_id.
    // Fallback 1: legacy washer/seller/cajero supabase_id via empleados.ref_supabase_id.
    // Fallback 2: legacy integer ref_id.
    const sid = emp.supabase_id ? String(emp.supabase_id) : null
    if (sid && bucket.bySid?.[sid]) return bucket.bySid[sid]
    const refSid = emp.ref_supabase_id ? String(emp.ref_supabase_id) : null
    if (refSid && bucket.byLegacySid?.[refSid]) return bucket.byLegacySid[refSid]
    const ref = emp.ref_id != null ? String(emp.ref_id) : null
    if (ref && bucket.byLegacyId?.[ref]) return bucket.byLegacyId[ref]
    return 0
  }

  // Load history + salary changes when selection changes
  useEffect(() => {
    if (!selected?.id) { setRuns([]); setSalaryChanges([]); return }
    let cancelled = false
    setLoadingRuns(true)
    Promise.all([
      api?.payrollRuns?.byEmpleado?.(selected.id, 100) || [],
      api?.salaryChanges?.byEmpleado?.(selected.id) || [],
    ])
    .then(([runRows, salRows]) => {
      if (cancelled) return
      setRuns(runRows || [])
      setSalaryChanges(salRows || [])
    })
    .catch(() => { if (!cancelled) { setRuns([]); setSalaryChanges([]) } })
    .finally(() => { if (!cancelled) setLoadingRuns(false) })
    return () => { cancelled = true }
  }, [selected?.id])

  // ── Filtering ──────────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    let list = empleados
    if (filterTipo !== 'all') list = list.filter(e => e.tipo === filterTipo)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e =>
        e.nombre.toLowerCase().includes(q) ||
        (e.cedula || '').toLowerCase().includes(q) ||
        (e.puesto || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [empleados, search, filterTipo])

  // ── Per-employee stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!selected) return null
    const year = new Date().getFullYear()
    const thisYear = runs.filter(r => new Date(r.paid_at).getFullYear() === year)
    const totalYear = thisYear.reduce((s, r) => s + (r.net || 0), 0)
    const lastPaid = runs.length > 0 ? runs[0] : null
    const monthsActive = Math.max(1, calcAntiguedad(selected.start_date).totalMonths)
    const avgMonthly = totalYear / Math.min(12, monthsActive)
    const commissionsPending = Math.max(0, getCommissionTotal(selected))  // Simplified: total across all tickets
    return {
      totalYear,
      lastPaid,
      avgMonthly,
      commissionsPending,
    }
  }, [selected, runs, commTotals])

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleSave(data) {
    try {
      if (data.id) await api.empleados.update({ ...data, changed_by: user?.id })
      else         await api.empleados.create(data)
      setShowPanel(null)
      await loadAll()
      showToast(L('Empleado guardado', 'Employee saved'))
    } catch (e) {
      showToast(e?.message || L('Error al guardar', 'Error saving'), 'error')
    }
  }

  async function handleDeactivate(emp) {
    if (!confirm(L('¿Desactivar este empleado?', 'Deactivate this employee?'))) return
    try {
      await api.empleados.update({ id: emp.id, active: 0 })
      if (String(selectedId) === String(emp.id)) setSelectedId(null)
      await loadAll()
      showToast(L('Empleado desactivado', 'Employee deactivated'))
    } catch (e) { showToast(e?.message || L('Error', 'Error'), 'error') }
  }

  async function handleHardDelete(emp) {
    if (!confirm(L(
      `¿ELIMINAR permanentemente a ${emp.nombre}?\n\nEsta acción borra al empleado de la base de datos. Si tiene pagos de nómina o comisiones registradas, se desactivará en su lugar.`,
      `PERMANENTLY delete ${emp.nombre}?\n\nThis removes the employee from the database. If they have payroll runs or commissions on file, they'll be deactivated instead.`
    ))) return
    try {
      const r = await api.empleados.hardDelete?.(emp.id)
      if (r?.softDeleted) {
        showToast(L('Empleado desactivado (tiene historial financiero)', 'Employee deactivated (has financial history)'))
      } else {
        showToast(L('Empleado eliminado ✓', 'Employee deleted ✓'))
      }
      if (String(selectedId) === String(emp.id)) setSelectedId(null)
      await loadAll()
    } catch (e) { showToast(e?.message || L('Error al eliminar', 'Error deleting'), 'error') }
  }

  async function handleSaveSalaryChange(payload) {
    if (!selected) return
    try {
      await api.salaryChanges.create({
        empleado_id: selected.id,
        new_salary: payload.new_salary,
        effective_date: payload.effective_date,
        reason: payload.reason || null,
        changed_by: user?.id || null,
      })
      const rows = await api.salaryChanges.byEmpleado(selected.id)
      setSalaryChanges(rows || [])
      await loadAll()
      setShowSalaryModal(false)
      showToast(L('Cambio de salario registrado ✓', 'Salary change recorded ✓'))
    } catch (e) {
      showToast(e?.message || L('Error al guardar', 'Error saving'), 'error')
    }
  }

  async function handleDeleteSalaryChange(id) {
    if (!confirm(L('¿Eliminar este cambio de salario?', 'Delete this salary change?'))) return
    try {
      await api.salaryChanges.remove(id)
      const rows = await api.salaryChanges.byEmpleado(selected.id)
      setSalaryChanges(rows || [])
      await loadAll()
      showToast(L('Eliminado', 'Deleted'))
    } catch (e) { showToast(e?.message || L('Error', 'Error'), 'error') }
  }

  async function handleRecordPayment(payload) {
    try {
      await api.payrollRuns.create({
        empleado_id: selected.id,
        ...payload,
        paid_by: user?.id || null,
      })
      const rows = await api.payrollRuns.byEmpleado(selected.id, 100)
      setRuns(rows || [])
      setShowPayModal(false)
      showToast(L('Nómina registrada ✓', 'Paycheck recorded ✓'))
    } catch (e) {
      showToast(e?.message || L('Error al guardar nómina', 'Error saving paycheck'), 'error')
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

  // ── Liquidación (current selection) ─────────────────────────────────────────
  const liq = useMemo(() => {
    if (!selected) return null
    return calcLiquidacion(selected, liqTipo, getCommissionTotal(selected))
  }, [selected, liqTipo, commTotals])

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden p-3 md:p-4 gap-3 md:gap-4">
      {/* ── Left: employee list (hidden on mobile when an employee is selected) */}
      <div className={`md:w-[320px] shrink-0 flex-col bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden ${selected ? 'hidden md:flex' : 'flex'}`}>
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 dark:border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-bold text-slate-500 dark:text-white/60">{empleados.length} {L('empleados', 'employees')}</p>
            <button onClick={() => setShowPanel('add')}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#0C447C] text-white text-[11px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
              <Plus size={12} /> {L('Agregar', 'Add')}
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg focus-within:border-sky-400">
            <Search size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Nombre, cédula…', 'Name, ID…')}
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(() => {
              // Dynamic filter chips — only show a tipo chip when the business
              // has MORE THAN ONE empleado of that tipo. A business with one of
              // each type stays on "Todos". Clutter-free by default, unlocks as
              // the team grows. Lavadores additionally gated by showWashers.
              const counts = empleados.reduce((m, e) => { m[e.tipo] = (m[e.tipo] || 0) + 1; return m }, {})
              const chips = [
                { id: 'all', label: L('Todos', 'All'), show: true },
                { id: 'lavador',   label: L('Lavadores', 'Washers'),    show: showWashers && (counts.lavador || 0) > 1 },
                { id: 'vendedor',  label: L('Vendedores', 'Sellers'),   show: (counts.vendedor || 0) > 1 },
                { id: 'cajero',    label: L('Cajeros', 'Cashiers'),     show: (counts.cajero || 0) > 1 },
                { id: 'seguridad', label: L('Seguridad', 'Security'),   show: (counts.seguridad || 0) > 1 },
                { id: 'servicio',  label: L('Servicio', 'Service'),     show: (counts.servicio || 0) > 1 },
              ]
              // If the currently-selected filter was auto-hidden (count dropped
              // to ≤1), fall back to 'all' so the list isn't empty.
              if (filterTipo !== 'all' && !chips.find(c => c.id === filterTipo)?.show) {
                setTimeout(() => setFilterTipo('all'), 0)
              }
              return chips.filter(f => f.show)
            })().map(f => (
              <button key={f.id} onClick={() => setFilterTipo(f.id)}
                className={`flex-1 px-1 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                  filterTipo === f.id
                    ? 'bg-slate-800 text-white dark:bg-white dark:text-black'
                    : 'text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'
                }`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-300 dark:text-white/30">
              <div className="w-5 h-5 border-2 border-slate-200 dark:border-white/10 border-t-sky-500 rounded-full animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-300 dark:text-white/30 text-[12px]">
              {empleados.length === 0 ? L('Sin empleados', 'No employees') : L('Sin resultados', 'No results')}
            </div>
          ) : (
            visible.map(emp => {
              const ant = calcAntiguedad(emp.start_date)
              const isSelected = String(emp.id) === String(selectedId)
              const commTotal = getCommissionTotal(emp)
              return (
                <button key={emp.id} onClick={() => setSelectedId(String(emp.id))}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b border-slate-50 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left ${isSelected ? 'bg-sky-50/60 dark:bg-sky-900/20 border-l-2 border-l-sky-500' : ''}`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${TYPE_COLORS[emp.tipo]?.bg || ''} ${TYPE_COLORS[emp.tipo]?.text || ''}`}>
                    {emp.nombre.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{emp.nombre}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <TypeBadge tipo={emp.tipo} />
                      {ant.totalMonths > 0 && (
                        <span className="text-[10px] text-slate-400 dark:text-white/40">
                          {ant.years > 0 ? `${ant.years}a ` : ''}{ant.months}m
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {emp.salary > 0 ? (
                      <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{fmtRD(emp.salary)}</p>
                    ) : commTotal > 0 ? (
                      <div>
                        <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-400">{fmtRD(commTotal)}</p>
                        <p className="text-[9px] text-sky-500 dark:text-sky-400/70">{L('comisiones', 'commissions')}</p>
                      </div>
                    ) : ['lavador', 'vendedor', 'cajero', 'hybrid'].includes(emp.tipo) ? (
                      <span className="text-[10px] text-slate-400 dark:text-white/40">
                        {L('por comisión', 'by commission')}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 dark:text-white/40">—</span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right: detail ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden min-h-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-slate-300 dark:text-white/30">
            <div className="text-center">
              <ClipboardList size={40} className="mx-auto mb-3 text-slate-200 dark:text-white/20" />
              <p className="text-[13px]">{L('Seleccione un empleado para ver sus detalles', 'Select an employee to see details')}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Profile header */}
            <div className="shrink-0 px-5 py-4 border-b border-slate-200 dark:border-white/10">
              {/* Mobile back button */}
              <button onClick={() => setSelectedId(null)}
                className="md:hidden flex items-center gap-1 text-[12px] text-sky-600 dark:text-sky-400 font-semibold mb-3 -ml-1">
                <ChevronLeft size={16} /> {L('Volver a la lista', 'Back to list')}
              </button>
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold shrink-0 ${TYPE_COLORS[selected.tipo]?.bg} ${TYPE_COLORS[selected.tipo]?.text}`}>
                    {selected.nombre.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold text-slate-800 dark:text-white truncate">{selected.nombre}</h3>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <TypeBadge tipo={selected.tipo} />
                      {selected.puesto && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-white/60">
                          <Briefcase size={10} /> {selected.puesto}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-slate-400 dark:text-white/40">
                      {selected.cedula && <span className="flex items-center gap-1"><IdCard size={10} />{selected.cedula}</span>}
                      {selected.phone && <span className="flex items-center gap-1"><Phone size={10} />{selected.phone}</span>}
                      {selected.email && <span className="flex items-center gap-1 truncate"><Mail size={10} />{selected.email}</span>}
                      {selected.start_date && <span className="flex items-center gap-1"><Calendar size={10} />{selected.start_date}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setShowPayModal(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold rounded-lg transition-colors">
                    <Banknote size={13} /> {L('Pagar', 'Pay')}
                  </button>
                  <button onClick={() => setShowPanel(selected)}
                    title={L('Editar', 'Edit')}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => handleDeactivate(selected)}
                    title={L('Desactivar', 'Deactivate')}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors">
                    <Power size={14} />
                  </button>
                  {canHardDelete && (
                    <button onClick={() => handleHardDelete(selected)}
                      title={L('Eliminar permanentemente', 'Permanently delete')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Stats row */}
            {stats && (
              <div className="shrink-0 px-5 py-3 grid grid-cols-2 md:grid-cols-4 gap-2 border-b border-slate-100 dark:border-white/10">
                <MiniStat label={L('Pagado este año', 'Paid this year')} value={fmtRD(stats.totalYear)} />
                <MiniStat label={L('Último pago', 'Last paid')} value={stats.lastPaid ? fmtRD(stats.lastPaid.net) : '—'} sub={stats.lastPaid ? new Date(stats.lastPaid.paid_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }) : null} />
                <MiniStat label={L('Promedio mensual', 'Monthly avg')} value={fmtRD(stats.avgMonthly)} />
                <MiniStat label={L('Comisiones ac.', 'Commissions')} value={fmtRD(stats.commissionsPending)} />
              </div>
            )}

            {/* Inner sub-tabs */}
            <div className="shrink-0 flex items-center gap-1 px-5 py-2 border-b border-slate-100 dark:border-white/10 overflow-x-auto">
              {[
                { id: 'historial',   icon: History,    label: L('Historial de Pagos', 'Payment History'), count: runs.length },
                { id: 'comisiones',  icon: TrendingUp, label: L('Comisiones', 'Commissions') },
                { id: 'liquidacion', icon: Calculator, label: L('Liquidación', 'Severance') },
                { id: 'salary-log',  icon: ClipboardList, label: L('Cambios de salario', 'Salary Changes'), count: salaryChanges.length },
              ].map(tab => {
                const Icon = tab.icon
                const active = innerTab === tab.id
                return (
                  <button key={tab.id} onClick={() => setInnerTab(tab.id)}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-slate-800 text-white dark:bg-white dark:text-black'
                        : 'text-slate-500 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10'
                    }`}>
                    <Icon size={12} />
                    {tab.label}
                    {tab.count != null && tab.count > 0 && (
                      <span className={`ml-0.5 text-[9px] px-1.5 py-0.5 rounded-full ${
                        active ? 'bg-white/20 dark:bg-black/20' : 'bg-slate-200 dark:bg-white/10'
                      }`}>{tab.count}</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Inner view content */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {innerTab === 'historial' && (
                <PayrollHistoryPanel
                  runs={runs}
                  loading={loadingRuns}
                  onDelete={handleDeleteRun}
                  onPrint={(run) => printPaycheckStub(biz, selected, run, L)}
                  lang={lang}
                />
              )}
              {innerTab === 'comisiones' && (
                <CommissionsTab
                  emp={selected}
                  commTotal={getCommissionTotal(selected)}
                  lang={lang}
                  onAddManual={() => setShowCommModal(true)}
                />
              )}
              {innerTab === 'liquidacion' && (
                <LiquidacionTab emp={selected} liq={liq} tipo={liqTipo} onTipoChange={setLiqTipo} lang={lang} />
              )}
              {innerTab === 'salary-log' && (
                <SalaryChangesTab
                  changes={salaryChanges}
                  lang={lang}
                  onAdd={() => setShowSalaryModal(true)}
                  onDelete={handleDeleteSalaryChange}
                  canDelete={canHardDelete}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Employee add/edit panel */}
      {showPanel && (
        <EmployeePanel
          emp={showPanel === 'add' ? null : showPanel}
          onSave={handleSave}
          onClose={() => setShowPanel(null)}
          lang={lang}
          showWashers={showWashers}
        />
      )}

      {/* Salary change modal */}
      {showSalaryModal && selected && (
        <SalaryChangeModal
          emp={selected}
          onSave={handleSaveSalaryChange}
          onClose={() => setShowSalaryModal(false)}
          lang={lang}
        />
      )}

      {/* Manual commission modal */}
      {showCommModal && selected && (
        <AddCommissionModal
          emp={selected}
          api={api}
          onSaved={(ok) => {
            setShowCommModal(false)
            if (ok) {
              showToast(L('Comisión agregada', 'Commission added'))
              loadAll()
            }
          }}
          onClose={() => setShowCommModal(false)}
          lang={lang}
        />
      )}

      {/* Pay modal */}
      {showPayModal && selected && (
        <PayPayrollModal
          emp={selected}
          settings={settings}
          currentCommissionTotal={getCommissionTotal(selected)}
          onSave={handleRecordPayment}
          onClose={() => setShowPayModal(false)}
          lang={lang}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 text-white text-sm px-5 py-3 rounded-full shadow-lg ${
          toast.variant === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Mini stat card ─────────────────────────────────────────────────────────────
function MiniStat({ label, value, sub }) {
  return (
    <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5">
      <p className="text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{label}</p>
      <p className="text-[14px] font-bold text-slate-800 dark:text-white mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 dark:text-white/40">{sub}</p>}
    </div>
  )
}

// ── Commissions tab ────────────────────────────────────────────────────────────
function CommissionsTab({ emp, commTotal, lang, onAddManual }) {
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-md">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{L('Resumen de comisiones', 'Commissions summary')}</p>
          {onAddManual && (
            <button onClick={onAddManual}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#0C447C] text-white text-[11px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
              <Plus size={12} /> {L('Agregar manual', 'Add manual')}
            </button>
          )}
        </div>
        <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 rounded-xl px-5 py-4">
          <p className="text-[12px] text-slate-500 dark:text-white/60">{L('Total acumulado (todos los tiempos)', 'All-time total')}</p>
          <p className="text-[24px] font-bold text-sky-700 dark:text-sky-400">{fmtRD(commTotal)}</p>
        </div>
        {commTotal === 0 && (
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-3 italic">
            {L('Este empleado aún no tiene comisiones registradas. Las comisiones se acumulan automáticamente al facturar tickets, o pulse "Agregar manual" para registrarlas a mano.',
               'This employee has no commissions yet. Commissions accrue automatically on ticket sales, or press "Add manual" to record one by hand.')}
          </p>
        )}
        <p className="text-[10px] text-slate-400 dark:text-white/40 mt-4">
          {L('Las comisiones manuales se usan para liquidación histórica o ajustes, sin necesidad de un ticket.',
             'Manual commissions are used for historical liquidación or adjustments, with no ticket required.')}
        </p>
      </div>
    </div>
  )
}

// ── Manual commission modal ────────────────────────────────────────────────────
function AddCommissionModal({ emp, api, onSaved, onClose, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const defaultPct = Number(emp?.comision_pct || 0)
  const today = new Date().toISOString().slice(0, 10)
  // v2.14.1: "Auto (base × %)" now defaults OFF — most manual entries are flat
  // numbers typed in by the owner (liquidación de un mes, ajuste retroactivo).
  const [base,   setBase]   = useState('')
  const [pct,    setPct]    = useState(defaultPct ? String(defaultPct) : '')
  const [amount, setAmount] = useState('')
  const [autoCalc, setAutoCalc] = useState(false)
  const [date,   setDate]   = useState(today)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState(null)
  const savingRef = useRef(false)  // hard guard against double-click → double-insert

  useEffect(() => {
    if (!autoCalc) return
    const b = Number(base) || 0
    const p = Number(pct)  || 0
    const a = Math.round(b * p) / 100
    setAmount(a ? String(a) : '')
  }, [base, pct, autoCalc])

  async function handleSave() {
    if (savingRef.current) return      // belt-and-suspenders against re-entry
    setErr(null)
    const b = Number(base)   || 0
    const p = Number(pct)    || 0
    const a = Number(amount) || 0
    if (!reason.trim())           return setErr(L('Ingrese una razón', 'Enter a reason'))
    if (a <= 0)                   return setErr(L('Monto de comisión debe ser mayor a 0', 'Commission amount must be > 0'))
    if (!date)                    return setErr(L('Seleccione una fecha', 'Pick a date'))
    if (!emp?.supabase_id)        return setErr(L('Empleado sin supabase_id — no se puede guardar', 'Employee is missing supabase_id'))

    const tipo = emp.tipo === 'hybrid' ? 'lavador' : emp.tipo
    const endpoint = tipo === 'vendedor' ? api?.sellerCommissions?.create
                   : tipo === 'cajero'   ? api?.cajeroCommissions?.create
                   : api?.commissions?.create
    if (!endpoint) return setErr(L('Tipo de empleado no soporta comisión manual', 'Employee type does not support manual commission'))

    savingRef.current = true
    setSaving(true)
    try {
      const createdIso = new Date(date + 'T12:00:00-04:00').toISOString()
      const res = await endpoint({
        empleado_supabase_id: emp.supabase_id,
        base_amount:        b,
        commission_pct:     p,
        commission_amount:  a,
        created_at:         createdIso,
        manual_reason:      reason.trim(),
      })
      if (!res || res?.ok === false) throw new Error(res?.error || 'create failed')
      onSaved?.(true)
    } catch (e) {
      console.error('[AddCommissionModal] save error', e)
      setErr(e?.message || String(e))
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-700 dark:text-white">{L('Agregar comisión manual', 'Add manual commission')}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-2">
            <p className="text-[10px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">{L('Empleado', 'Employee')}</p>
            <p className="text-[13px] text-slate-800 dark:text-white">{emp?.nombre}</p>
            <p className="text-[10px] text-slate-400 dark:text-white/40">{emp?.tipo} {defaultPct ? `• ${defaultPct}%` : ''}</p>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 dark:text-white/60">{L('Fecha (período)', 'Date (period)')}</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-sm text-slate-800 dark:text-white mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500 dark:text-white/60">{L('Monto base (RD$)', 'Base amount (RD$)')}</label>
              <input type="number" step="0.01" min="0" value={base} onChange={e => setBase(e.target.value)} placeholder="0.00"
                className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-sm text-slate-800 dark:text-white mt-1 tabular-nums" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 dark:text-white/60">{L('% Comisión', 'Commission %')}</label>
              <input type="number" step="0.01" min="0" value={pct} onChange={e => setPct(e.target.value)} placeholder="0"
                className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-sm text-slate-800 dark:text-white mt-1 tabular-nums" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-500 dark:text-white/60">{L('Monto de comisión (RD$)', 'Commission amount (RD$)')}</label>
              <label className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-white/40 cursor-pointer">
                <input type="checkbox" checked={autoCalc} onChange={e => setAutoCalc(e.target.checked)} />
                {L('Auto (base × %)', 'Auto (base × %)')}
              </label>
            </div>
            <input type="number" step="0.01" min="0" value={amount} disabled={autoCalc}
              onChange={e => setAmount(e.target.value)} placeholder="0.00"
              className={`w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm mt-1 tabular-nums ${autoCalc ? 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/60' : 'bg-white dark:bg-white/5 text-slate-800 dark:text-white'}`} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 dark:text-white/60">{L('Razón / nota', 'Reason / note')}</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder={L('Ej: liquidación mes de agosto', 'Ex: August liquidación')}
              className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-sm text-slate-800 dark:text-white mt-1" />
          </div>
          {err && <p className="text-[12px] text-red-600 dark:text-red-400">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-3 py-1.5 text-[12px] font-bold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 rounded-lg">
            {L('Cancelar', 'Cancel')}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-[12px] font-bold text-white bg-[#0C447C] hover:bg-[#0a3a6a] rounded-lg disabled:opacity-50">
            {saving ? L('Guardando…', 'Saving…') : L('Guardar', 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Liquidación tab ────────────────────────────────────────────────────────────
function LiquidacionTab({ emp, liq, tipo, onTipoChange, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  if (!liq) {
    return (
      <div className="flex-1 flex items-center justify-center text-amber-500 p-5">
        <div className="text-center">
          <AlertCircle size={32} className="mx-auto mb-2" />
          <p className="text-[13px] font-semibold">
            {!emp.start_date ? L('Sin fecha de inicio', 'No start date') : L('No hay datos suficientes', 'Not enough data')}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">
            {L('Edite el empleado para completar los datos', 'Edit the employee to complete required data')}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">{L('Tipo de salida', 'Exit type')}</span>
          <div className="flex bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            {['desahucio', 'renuncia'].map(t => (
              <button key={t} onClick={() => onTipoChange(t)}
                className={`px-4 py-2 text-[12px] font-semibold transition-colors ${tipo === t ? 'bg-[#0C447C] text-white' : 'text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
                {t === 'desahucio' ? L('Desahucio', 'Dismissal') : L('Renuncia', 'Resignation')}
              </button>
            ))}
          </div>
        </div>

        {liq.isCommissionBased && (
          <div className="mb-4 px-4 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
            <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
              {L(`Base: promedio mensual de comisiones (${fmtRD(liq.commissionTotal)} / ${liq.antiguedad.totalMonths.toFixed(1)} meses = ${fmtRD(liq.monthlySalary)}/mes)`,
                 `Base: avg monthly commissions (${fmtRD(liq.commissionTotal)} / ${liq.antiguedad.totalMonths.toFixed(1)} months = ${fmtRD(liq.monthlySalary)}/mo)`)}
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatBox label={L('Antigüedad', 'Seniority')} value={`${liq.antiguedad.years}a ${liq.antiguedad.months}m`} sub={`${liq.antiguedad.days} ${L('días', 'days')}`} />
          <StatBox label={L('Salario mensual', 'Monthly salary')} value={fmtRD(liq.monthlySalary)} sub={`${fmtRD(liq.dailyRate)} /día`} />
          <StatBox label={L('Total a pagar', 'Total payable')} value={fmtRD(liq.total)} sub={tipo === 'desahucio' ? L('desahucio', 'dismissal') : L('renuncia', 'resignation')} accent="sky" />
        </div>

        <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="flex items-center px-4 py-2.5 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
            <span className="flex-1">{L('Concepto', 'Concept')}</span>
            <span className="w-[80px] text-right">{L('Días', 'Days')}</span>
            <span className="w-[130px] text-right">{L('Monto', 'Amount')}</span>
          </div>
          {[
            { key: 'vacaciones', label: L('Vacaciones (Art. 177)', 'Vacation (Art. 177)'), days: liq.vacaciones.days, amount: liq.vacaciones.amount, show: true },
            { key: 'navidad',    label: L('Salario de Navidad (Art. 219)', 'Christmas bonus (Art. 219)'), days: null, amount: liq.navidad.amount, show: true },
            { key: 'preaviso',   label: L('Preaviso (Art. 76)', 'Notice (Art. 76)'), days: liq.preaviso.days, amount: liq.preaviso.amount, show: tipo === 'desahucio' },
            { key: 'cesantia',   label: L('Cesantía (Art. 80)', 'Severance (Art. 80)'), days: liq.cesantia.days, amount: liq.cesantia.amount, show: tipo === 'desahucio' },
          ].filter(r => r.show).map(row => (
            <div key={row.key} className="flex items-center px-4 py-3 border-b border-slate-100 dark:border-white/10 last:border-0">
              <span className="flex-1 text-[13px] text-slate-700 dark:text-white font-medium">{row.label}</span>
              <span className="w-[80px] text-right text-[12px] text-slate-500 dark:text-white/60">
                {row.days != null ? row.days.toFixed(1) : '—'}
              </span>
              <span className="w-[130px] text-right text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">{fmtRD(row.amount)}</span>
            </div>
          ))}
          <div className="flex items-center px-4 py-3 bg-sky-50 dark:bg-sky-500/10 border-t-2 border-sky-200 dark:border-sky-500/30">
            <span className="flex-1 text-[13px] font-bold text-sky-800 dark:text-sky-300 uppercase">Total</span>
            <span className="w-[80px]" />
            <span className="w-[130px] text-right text-[16px] font-bold text-sky-700 dark:text-sky-400">{fmtRD(liq.total)}</span>
          </div>
        </div>

        <p className="text-[10px] text-slate-400 dark:text-white/40 mt-4">
          {L('Base legal: Código de Trabajo, Ley 16-92. Divisor legal: 23.83 días/mes.',
             'Legal basis: Dominican Labor Code, Law 16-92. Legal divisor: 23.83 days/month.')}
        </p>
      </div>
    </div>
  )
}

function StatBox({ label, value, sub, accent }) {
  const bg = accent === 'sky'
    ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20'
    : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10'
  const valColor = accent === 'sky' ? 'text-sky-700 dark:text-sky-400' : 'text-slate-800 dark:text-white'
  return (
    <div className={`rounded-xl border px-4 py-3 ${bg}`}>
      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{label}</p>
      <p className={`text-[16px] font-bold ${valColor} mt-0.5`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 dark:text-white/40">{sub}</p>}
    </div>
  )
}

// ── Salary changes tab ─────────────────────────────────────────────────────────
function SalaryChangesTab({ changes, lang, onAdd, onDelete, canDelete }) {
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-white/10">
        <p className="text-[12px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">
          {L('Historial salarial', 'Salary history')}
        </p>
        {onAdd && (
          <button onClick={onAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0C447C] text-white text-[11px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
            <Plus size={12} /> {L('Registrar cambio', 'Record change')}
          </button>
        )}
      </div>
      {changes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-300 dark:text-white/30 p-5">
          <div className="text-center">
            <ClipboardList size={40} className="mx-auto mb-3 text-slate-200 dark:text-white/20" />
            <p className="text-[13px]">{L('Sin cambios de salario registrados', 'No salary changes recorded')}</p>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">
              {L('Haz clic en "Registrar cambio" para añadir el salario inicial o un aumento.',
                 'Click "Record change" to add the initial salary or a raise.')}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {changes.map(c => {
              const delta = Number(c.new_salary) - Number(c.old_salary)
              const positive = delta >= 0
              return (
                <div key={c.id} className="px-5 py-3 group">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-bold text-slate-800 dark:text-white">
                        {new Date(c.effective_date).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">
                        <span className="line-through text-slate-400 dark:text-white/40">{fmtRD(c.old_salary)}</span>
                        {' → '}
                        <strong className="text-slate-700 dark:text-white">{fmtRD(c.new_salary)}</strong>
                      </p>
                      {c.changed_by_name && <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{L('Por:', 'By:')} {c.changed_by_name}</p>}
                      {c.reason && <p className="text-[10px] text-slate-500 dark:text-white/60 italic mt-0.5">{c.reason}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className={`text-right ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        <p className="text-[13px] font-bold">{positive ? '+' : ''}{fmtRD(delta)}</p>
                        <p className="text-[10px]">{positive ? L('aumento', 'increase') : L('reducción', 'decrease')}</p>
                      </div>
                      {canDelete && onDelete && (
                        <button onClick={() => onDelete(c.id)}
                          title={L('Eliminar', 'Delete')}
                          className="p-1.5 rounded-lg text-slate-300 dark:text-white/30 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Salary change modal ───────────────────────────────────────────────────────
function SalaryChangeModal({ emp, onSave, onClose, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [newSalary, setNewSalary]         = useState('')
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason]               = useState('')
  const [saving, setSaving]               = useState(false)
  const [err, setErr]                     = useState('')

  async function submit() {
    const n = Number(newSalary)
    if (!Number.isFinite(n) || n < 0) { setErr(L('Salario inválido', 'Invalid salary')); return }
    if (!effectiveDate) { setErr(L('Fecha requerida', 'Date required')); return }
    setSaving(true); setErr('')
    try {
      await onSave({ new_salary: n, effective_date: effectiveDate, reason: reason.trim() || null })
    } catch (e) { setErr(e?.message || L('Error', 'Error')) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-white/10">
          <div>
            <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">
              {L('Registrar cambio de salario', 'Record salary change')}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-white/60">{emp.nombre}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">
              {L('Nuevo salario RD$', 'New salary RD$')}
            </label>
            <input type="number" min="0" step="0.01" value={newSalary}
              onChange={e => setNewSalary(e.target.value)}
              placeholder="20000"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[14px] text-slate-800 dark:text-white focus:border-sky-400 outline-none" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">
              {L('Fecha efectiva', 'Effective date')}
            </label>
            <input type="date" value={effectiveDate}
              onChange={e => setEffectiveDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[14px] text-slate-800 dark:text-white focus:border-sky-400 outline-none" />
            <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">
              {L('Para el salario inicial, usa la fecha de contratación.',
                 'For the starting salary, use the hire date.')}
            </p>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1">
              {L('Motivo (opcional)', 'Reason (optional)')}
            </label>
            <input type="text" value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={L('Ej: aumento anual, promoción, salario inicial', 'e.g. annual raise, promotion, starting salary')}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-800 dark:text-white focus:border-sky-400 outline-none" />
          </div>
          {err && <p className="text-[11px] text-red-500 dark:text-red-400">{err}</p>}
        </div>
        <div className="flex gap-2 px-5 py-3 border-t border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5">
          <button onClick={submit} disabled={saving}
            className="flex-1 px-4 py-2 bg-[#0C447C] text-white text-[13px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors disabled:opacity-50">
            {saving ? L('Guardando…', 'Saving…') : L('Guardar', 'Save')}
          </button>
          <button onClick={onClose}
            className="px-4 py-2 text-[13px] text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
            {L('Cancelar', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
