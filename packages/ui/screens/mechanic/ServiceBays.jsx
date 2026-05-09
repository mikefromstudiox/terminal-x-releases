/**
 * ServiceBays.jsx — Visual bay management grid.
 *
 * Grid of bay cards with status badges, occupancy info, quick actions.
 * Create bay modal, status change actions, summary bar.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  LayoutGrid, Plus, X, Loader2, CheckCircle2,
  Wrench, AlertCircle, Settings, Car, User,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'

// ── Constants ─────────────────────────────────────────────────────────────────

const BAY_STATUS = {
  libre:         { label_es: 'Libre',         label_en: 'Free',        bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-500/30', ring: 'ring-emerald-500/20' },
  ocupado:       { label_es: 'Ocupado',       label_en: 'Occupied',    bg: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-700 dark:text-amber-400',     dot: 'bg-amber-500',    border: 'border-amber-200 dark:border-amber-500/30',   ring: 'ring-amber-500/20' },
  mantenimiento: { label_es: 'Mantenimiento', label_en: 'Maintenance', bg: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-700 dark:text-red-400',         dot: 'bg-red-500',      border: 'border-red-200 dark:border-red-500/30',       ring: 'ring-red-500/20' },
}

const BAY_TYPES = [
  { id: 'general',     label_es: 'General',        label_en: 'General' },
  { id: 'mecanica',    label_es: 'Mecanica',       label_en: 'Mechanical' },
  { id: 'electrica',   label_es: 'Electrica',      label_en: 'Electrical' },
  { id: 'pintura',     label_es: 'Pintura',        label_en: 'Paint' },
  { id: 'alineacion',  label_es: 'Alineacion',     label_en: 'Alignment' },
  { id: 'diagnostico', label_es: 'Diagnostico',    label_en: 'Diagnostics' },
]

// ── Create/Edit Bay Modal ────────────────────────────────────────────────────

function BayModal({ bay, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    name:     bay?.name     || '',
    bay_type: bay?.bay_type || 'general',
    capacity: bay?.capacity || 1,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      setErr(L('El nombre es requerido.', 'Name is required.'))
      return
    }
    setSaving(true)
    try {
      const data = {
        name:     form.name.trim(),
        bay_type: form.bay_type,
        capacity: Number(form.capacity) || 1,
      }
      if (bay?.id) data.id = bay.id
      await onSave(data)
    } catch (ex) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(ex, { severity: 'error', category: 'servicebays.baymodal' }) } catch {}
      setErr(ex?.message || L('Error al guardar', 'Error saving'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <LayoutGrid size={16} className="text-[#b3001e]" />
            {bay ? L('Editar Bahia', 'Edit Bay') : L('Nueva Bahia', 'New Bay')}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Nombre *', 'Name *')}
            </label>
            <input value={form.name} onChange={e => { set('name', e.target.value); setErr('') }}
              placeholder={L('Ej: Bahia 1', 'E.g. Bay 1')}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Tipo de Bahia', 'Bay Type')}
            </label>
            <select value={form.bay_type} onChange={e => set('bay_type', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
              {BAY_TYPES.map(t => (
                <option key={t.id} value={t.id}>{L(t.label_es, t.label_en)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Capacidad', 'Capacity')}
            </label>
            <input type="number" min="1" max="10" value={form.capacity} onChange={e => set('capacity', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>

          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            {L('Cancelar', 'Cancel')}
          </button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {bay ? L('Guardar', 'Save') : L('Crear Bahia', 'Create Bay')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Quick Actions Modal ──────────────────────────────────────────────────────

function QuickActionsModal({ bay, lang, onStatusChange, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const current = BAY_STATUS[bay.status] || BAY_STATUS.libre

  const actions = [
    { status: 'libre',         icon: CheckCircle2, color: 'bg-emerald-500 hover:bg-emerald-600', hidden: bay.status === 'libre' },
    { status: 'mantenimiento', icon: Wrench,        color: 'bg-[#b3001e] hover:bg-[#8c0017]',    hidden: bay.status === 'mantenimiento' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-xs bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">{bay.name}</h3>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold mt-1 ${current.bg} ${current.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${current.dot}`} />
            {L(current.label_es, current.label_en)}
          </span>
        </div>

        {/* Current work order info if occupied */}
        {bay.status === 'ocupado' && bay.work_order && (
          <div className="px-5 py-3 bg-amber-50 dark:bg-amber-500/5 border-b border-amber-100 dark:border-amber-500/10">
            <div className="flex items-center gap-2 text-[12px]">
              <Car size={13} className="text-amber-600 dark:text-amber-400" />
              <span className="font-semibold text-amber-700 dark:text-amber-300">{bay.work_order.plate || '---'}</span>
            </div>
            {bay.work_order.client_name && (
              <div className="flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                <User size={11} />
                <span>{bay.work_order.client_name}</span>
              </div>
            )}
            {bay.work_order.technician_name && (
              <div className="flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                <Wrench size={11} />
                <span>{bay.work_order.technician_name}</span>
              </div>
            )}
          </div>
        )}

        <div className="p-4 space-y-2">
          {actions.filter(a => !a.hidden).map(a => {
            const st = BAY_STATUS[a.status]
            return (
              <button key={a.status}
                onClick={() => { onStatusChange(bay.id, a.status); onClose() }}
                className={`w-full flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-xl text-white text-[13px] font-semibold transition-colors ${a.color}`}>
                <a.icon size={16} />
                {L(`Marcar ${st.label_es}`, `Mark ${st.label_en}`)}
              </button>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10">
          <button onClick={onClose}
            className="w-full py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
            {L('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bay Card ─────────────────────────────────────────────────────────────────

function BayCard({ bay, lang, onClick }) {
  const L = (es, en) => lang === 'es' ? es : en
  const st = BAY_STATUS[bay.status] || BAY_STATUS.libre
  const bayType = BAY_TYPES.find(t => t.id === bay.bay_type) || BAY_TYPES[0]

  return (
    <button onClick={() => onClick(bay)}
      className={`w-full text-left rounded-2xl border-2 p-5 transition-all hover:shadow-lg active:scale-[0.98] ${st.border} ${st.bg} ring-0 hover:ring-4 ${st.ring}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-[16px] font-bold text-slate-800 dark:text-white">{bay.name}</h3>
          <span className="text-[11px] font-medium text-slate-500 dark:text-white/50">
            {L(bayType.label_es, bayType.label_en)}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${st.bg} ${st.text} border ${st.border}`}>
          <span className={`w-2 h-2 rounded-full ${st.dot} animate-pulse`} />
          {L(st.label_es, st.label_en)}
        </span>
      </div>

      {bay.status === 'ocupado' && bay.work_order ? (
        <div className="space-y-1.5 mt-2">
          <div className="flex items-center gap-2">
            <Car size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-[13px] font-semibold text-slate-700 dark:text-white truncate">
              {bay.work_order.plate || '---'} {bay.work_order.make ? `- ${bay.work_order.make}` : ''}
            </span>
          </div>
          {bay.work_order.client_name && (
            <div className="flex items-center gap-2">
              <User size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
              <span className="text-[12px] text-slate-500 dark:text-white/50 truncate">{bay.work_order.client_name}</span>
            </div>
          )}
          {bay.work_order.technician_name && (
            <div className="flex items-center gap-2">
              <Wrench size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
              <span className="text-[12px] text-slate-500 dark:text-white/50 truncate">{bay.work_order.technician_name}</span>
            </div>
          )}
        </div>
      ) : bay.status === 'mantenimiento' ? (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-red-500 dark:text-red-400">
          <Settings size={13} className="animate-spin" style={{ animationDuration: '3s' }} />
          {L('En mantenimiento', 'Under maintenance')}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={13} />
          {L('Disponible para trabajo', 'Available for work')}
        </div>
      )}
    </button>
  )
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function ServiceBays() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [bays,      setBays]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [quickAction, setQuickAction] = useState(null)
  const [toast,     setToast]     = useState(null)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function loadBays() {
    setLoading(true)
    try {
      const data = await api?.serviceBays?.list?.() || []
      setBays(data || [])
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'servicebays.baycard' }) } catch {}}
    setLoading(false)
  }

  useEffect(() => { loadBays() }, [])

  async function handleCreate(data) {
    if (data.id) await api.serviceBays.update(data)
    else         await api.serviceBays.create(data)
    setShowCreate(false)
    await loadBays()
    flash(data.id ? L('Bahia actualizada', 'Bay updated') : L('Bahia creada', 'Bay created'))
  }

  async function handleStatusChange(bayId, newStatus) {
    await api.serviceBays.updateStatus({ id: bayId, status: newStatus })
    await loadBays()
    flash(L('Estado actualizado', 'Status updated'))
  }

  const counts = useMemo(() => ({
    libre:         bays.filter(b => b.status === 'libre').length,
    ocupado:       bays.filter(b => b.status === 'ocupado').length,
    mantenimiento: bays.filter(b => b.status === 'mantenimiento').length,
    total:         bays.length,
  }), [bays])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <LayoutGrid size={20} className="text-slate-500 dark:text-white/60" />
          <div>
            <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
              {L('Bahias de Servicio', 'Service Bays')}
            </h1>
            <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5 hidden md:block">
              {L('Gestiona las estaciones de trabajo', 'Manage work stations')}
            </p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shrink-0">
          <Plus size={15} /> {L('Nueva Bahia', 'New Bay')}
        </button>
      </div>

      {/* Summary bar */}
      <div className="px-3 md:px-6 py-3 flex items-center gap-3 md:gap-6 flex-wrap shrink-0">
        {Object.entries(BAY_STATUS).map(([key, st]) => (
          <div key={key} className="flex items-center gap-2.5">
            <span className={`w-3 h-3 rounded-full ${st.dot}`} />
            <span className="text-[12px] text-slate-500 dark:text-white/60">{L(st.label_es, st.label_en)}</span>
            <span className={`text-[16px] font-bold ${st.text}`}>{counts[key]}</span>
          </div>
        ))}
        <div className="ml-auto pl-3 md:pl-6 border-l border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] text-slate-500 dark:text-white/60">{L('Total', 'Total')}</span>
            <span className="text-[16px] font-bold text-slate-700 dark:text-white">{counts.total}</span>
          </div>
        </div>
      </div>

      {/* Bay grid */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
          </div>
        ) : bays.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/30 gap-2">
            <LayoutGrid size={32} />
            <p className="text-sm">{L('No hay bahias creadas.', 'No bays created.')}</p>
            <button onClick={() => setShowCreate(true)}
              className="mt-2 text-[13px] text-sky-600 dark:text-sky-400 hover:underline">
              {L('Crear primera bahia', 'Create first bay')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bays.map(bay => (
              <BayCard key={bay.id} bay={bay} lang={lang} onClick={setQuickAction} />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <BayModal bay={null} lang={lang} onSave={handleCreate} onClose={() => setShowCreate(false)} />
      )}
      {quickAction && (
        <QuickActionsModal bay={quickAction} lang={lang} onStatusChange={handleStatusChange} onClose={() => setQuickAction(null)} />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-slate-800 dark:bg-white/10 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}
    </div>
  )
}
