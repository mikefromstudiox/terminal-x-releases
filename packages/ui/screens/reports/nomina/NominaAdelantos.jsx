/**
 * NominaAdelantos.jsx — Salary advances (adelantos de nomina).
 *
 * Summary cards + full table + "Nuevo Adelanto" modal.
 * Pending adelantos auto-deduct during payroll runs (NominaPagos).
 */

import { useState, useMemo, useEffect } from 'react'
import {
  HandCoins, Plus, X, Search, Filter, AlertCircle, Check, Ban,
  Calendar, Users, DollarSign,
} from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'
import { fmtRD, MetricCard, TypeBadge } from './shared'

const STATUS_STYLES = {
  pendiente: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-300', label_es: 'Pendiente', label_en: 'Pending' },
  deducido:  { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', label_es: 'Deducido', label_en: 'Deducted' },
  cancelado: { bg: 'bg-slate-100 dark:bg-white/5', text: 'text-slate-500 dark:text-white/40', label_es: 'Cancelado', label_en: 'Cancelled' },
}

export default function NominaAdelantos() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [adelantos,  setAdelantos]  = useState([])
  const [empleados,  setEmpleados]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showModal,  setShowModal]  = useState(false)
  const [toast,      setToast]      = useState(null)

  // Filters
  const [filterStatus,    setFilterStatus]    = useState('all')
  const [filterEmpleado,  setFilterEmpleado]  = useState('')
  const [filterDateFrom,  setFilterDateFrom]  = useState('')
  const [filterDateTo,    setFilterDateTo]    = useState('')
  const [search,          setSearch]          = useState('')

  function showToast(msg, variant = 'ok') {
    setToast({ msg, variant })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [list, emps] = await Promise.all([
        api?.adelantos?.list?.({}) || [],
        api?.empleados?.all?.() || [],
      ])
      setAdelantos(list || [])
      setEmpleados(emps || [])
    } catch {}
    setLoading(false)
  }

  // ── Summary metrics ────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const pending = adelantos.filter(a => a.status === 'pendiente')
    const totalPending = pending.reduce((s, a) => s + Number(a.amount || 0), 0)
    const uniqueEmps = new Set(pending.map(a => a.empleado_id)).size
    return { totalPending, uniqueEmps, pendingCount: pending.length }
  }, [adelantos])

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = adelantos
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus)
    if (filterEmpleado)         list = list.filter(a => String(a.empleado_id) === filterEmpleado)
    if (filterDateFrom)         list = list.filter(a => a.date >= filterDateFrom)
    if (filterDateTo)           list = list.filter(a => a.date <= filterDateTo)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(a =>
        (a.empleado_nombre || '').toLowerCase().includes(q) ||
        (a.notes || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [adelantos, filterStatus, filterEmpleado, filterDateFrom, filterDateTo, search])

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleCancel(id) {
    if (!confirm(L('Cancelar este adelanto? Esta accion no se puede deshacer.', 'Cancel this advance? This cannot be undone.'))) return
    try {
      await api.adelantos.cancel(id)
      await loadAll()
      showToast(L('Adelanto cancelado', 'Advance cancelled'))
    } catch (e) { showToast(e?.message || L('Error', 'Error'), 'error') }
  }

  async function handleCreate(data) {
    try {
      await api.adelantos.create(data)
      setShowModal(false)
      await loadAll()
      showToast(L('Adelanto registrado', 'Advance recorded'))
    } catch (e) { showToast(e?.message || L('Error al registrar', 'Error recording'), 'error') }
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-white/40 text-sm">{L('Cargando...', 'Loading...')}</div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* ── Summary cards ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <MetricCard icon={DollarSign} label={L('Total Pendiente', 'Total Pending')} value={fmtRD(metrics.totalPending)} accent="amber" />
          <MetricCard icon={Users} label={L('Empleados con Adelantos', 'Employees with Advances')} value={String(metrics.uniqueEmps)} accent="sky" />
          <MetricCard icon={HandCoins} label={L('Adelantos Pendientes', 'Pending Advances')} value={String(metrics.pendingCount)} accent="violet" />
        </div>

        {/* ── Filters + New button ───────────────────────────────────── */}
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg flex-1 min-w-0 focus-within:border-sky-400">
              <Search size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Buscar...', 'Search...')}
                className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
            </div>

            {/* Status filter */}
            <div className="flex gap-1 flex-wrap">
              {[
                { id: 'all',        label: L('Todos', 'All') },
                { id: 'pendiente',  label: L('Pendiente', 'Pending') },
                { id: 'deducido',   label: L('Deducido', 'Deducted') },
                { id: 'cancelado',  label: L('Cancelado', 'Cancelled') },
              ].map(f => (
                <button key={f.id} onClick={() => setFilterStatus(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border ${
                    filterStatus === f.id
                      ? 'bg-slate-800 text-white dark:bg-white dark:text-black border-slate-800 dark:border-white'
                      : 'bg-white dark:bg-white/5 text-slate-500 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
                  }`}>{f.label}</button>
              ))}
            </div>

            {/* Employee filter */}
            <select value={filterEmpleado} onChange={e => setFilterEmpleado(e.target.value)}
              className="px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] bg-white dark:bg-white/5 text-slate-700 dark:text-white">
              <option value="">{L('Todos los empleados', 'All employees')}</option>
              {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>

            {/* Date range */}
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              className="px-2 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] bg-white dark:bg-white/5 dark:text-white w-[130px]" />
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              className="px-2 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] bg-white dark:bg-white/5 dark:text-white w-[130px]" />

            {/* New button */}
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors shrink-0">
              <Plus size={14} /> {L('Nuevo Adelanto', 'New Advance')}
            </button>
          </div>
        </div>

        {/* ── Table ──────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2 text-left">{L('Empleado', 'Employee')}</th>
                  <th className="px-4 py-2 text-left">{L('Fecha', 'Date')}</th>
                  <th className="px-4 py-2 text-right">{L('Monto', 'Amount')}</th>
                  <th className="px-4 py-2 text-center">{L('Estado', 'Status')}</th>
                  <th className="px-4 py-2 text-left">{L('Notas', 'Notes')}</th>
                  <th className="px-4 py-2 text-left">{L('Aprobado por', 'Approved by')}</th>
                  <th className="px-4 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-10 text-slate-400 dark:text-white/40">
                    {L('Sin adelantos registrados', 'No advances recorded')}
                  </td></tr>
                )}
                {filtered.map(a => {
                  const st = STATUS_STYLES[a.status] || STATUS_STYLES.pendiente
                  return (
                    <tr key={a.id} className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-800 dark:text-white">{a.empleado_nombre || `#${a.empleado_id}`}</p>
                        {a.empleado_tipo && <TypeBadge tipo={a.empleado_tipo} />}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-white/70 tabular-nums">
                        {new Date(a.date + 'T12:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-800 dark:text-white tabular-nums">{fmtRD(a.amount)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold ${st.bg} ${st.text}`}>
                          {L(st.label_es, st.label_en)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-white/50 max-w-[200px] truncate">{a.notes || '---'}</td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-white/50">{a.approved_by || '---'}</td>
                      <td className="px-4 py-2.5">
                        {a.status === 'pendiente' && (
                          <button onClick={() => handleCancel(a.id)}
                            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                            <Ban size={11} /> {L('Cancelar', 'Cancel')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
            {filtered.length === 0 && (
              <p className="text-center py-10 text-[12px] text-slate-400 dark:text-white/40">
                {L('Sin adelantos registrados', 'No advances recorded')}
              </p>
            )}
            {filtered.map(a => {
              const st = STATUS_STYLES[a.status] || STATUS_STYLES.pendiente
              return (
                <div key={a.id} className="px-4 py-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-slate-800 dark:text-white">{a.empleado_nombre || `#${a.empleado_id}`}</p>
                      <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
                        {new Date(a.date + 'T12:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[14px] font-bold text-slate-800 dark:text-white">{fmtRD(a.amount)}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${st.bg} ${st.text} mt-1`}>
                        {L(st.label_es, st.label_en)}
                      </span>
                    </div>
                  </div>
                  {a.notes && <p className="text-[11px] text-slate-500 dark:text-white/50 mt-1 truncate">{a.notes}</p>}
                  {a.status === 'pendiente' && (
                    <button onClick={() => handleCancel(a.id)}
                      className="mt-2 flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                      <Ban size={11} /> {L('Cancelar', 'Cancel')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── New Adelanto Modal ───────────────────────────────────────── */}
      {showModal && (
        <AdelantoModal
          empleados={empleados}
          user={user}
          lang={lang}
          onSave={handleCreate}
          onClose={() => setShowModal(false)}
          api={api}
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

// ── New Adelanto Modal ──────────────────────────────────────────────────────────
function AdelantoModal({ empleados, user, lang, onSave, onClose, api }) {
  const L = (es, en) => lang === 'es' ? es : en

  const [empleadoId,  setEmpleadoId]  = useState('')
  const [amount,      setAmount]      = useState('')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [pendingInfo, setPendingInfo] = useState(null)

  // When employee changes, fetch their pending total + salary for warning
  useEffect(() => {
    if (!empleadoId) { setPendingInfo(null); return }
    let cancelled = false
    Promise.resolve(api?.adelantos?.pendingTotal?.(Number(empleadoId)) || 0)
      .then(total => { if (!cancelled) setPendingInfo({ total }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [empleadoId])

  const selectedEmp = empleados.find(e => String(e.id) === empleadoId)
  const salary = selectedEmp?.salary || 0
  const amtNum = Number(amount) || 0
  const totalWithNew = (pendingInfo?.total || 0) + amtNum
  const warnHigh = salary > 0 && totalWithNew > salary * 0.5

  async function handleSubmit(e) {
    e.preventDefault()
    if (!empleadoId || amtNum <= 0) return
    setSaving(true)
    try {
      await onSave({
        empleado_id: Number(empleadoId),
        amount: amtNum,
        notes: notes.trim() || null,
        approved_by: user?.name || user?.username || null,
      })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit}
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <HandCoins size={16} className="text-amber-500" />
            {L('Nuevo Adelanto de Nomina', 'New Salary Advance')}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Employee */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Empleado', 'Employee')}
            </label>
            <select value={empleadoId} onChange={e => setEmpleadoId(e.target.value)} required
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
              <option value="">{L('Seleccionar empleado...', 'Select employee...')}</option>
              {empleados.filter(e => e.active !== 0).map(e => (
                <option key={e.id} value={e.id}>{e.nombre} — {e.tipo || 'otro'}</option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Monto (RD$)', 'Amount (RD$)')}
            </label>
            <input type="number" min="1" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Notas (opcional)', 'Notes (optional)')}
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none" />
          </div>

          {/* Pending info */}
          {pendingInfo && pendingInfo.total > 0 && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2">
              <AlertCircle size={12} className="inline mr-1" />
              {L(
                `Este empleado ya tiene ${fmtRD(pendingInfo.total)} en adelantos pendientes.`,
                `This employee already has ${fmtRD(pendingInfo.total)} in pending advances.`
              )}
            </div>
          )}

          {/* Warning: > 50% of salary */}
          {warnHigh && (
            <div className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle size={12} className="inline mr-1" />
              {L(
                `Advertencia: El total de adelantos (${fmtRD(totalWithNew)}) supera el 50% del salario mensual (${fmtRD(salary)}).`,
                `Warning: Total advances (${fmtRD(totalWithNew)}) exceed 50% of monthly salary (${fmtRD(salary)}).`
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            {L('Cancelar', 'Cancel')}
          </button>
          <button type="submit" disabled={saving || !empleadoId || amtNum <= 0}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] disabled:opacity-50 transition-colors">
            <HandCoins size={13} />
            {saving ? L('Registrando...', 'Recording...') : L('Registrar Adelanto', 'Record Advance')}
          </button>
        </div>
      </form>
    </div>
  )
}
