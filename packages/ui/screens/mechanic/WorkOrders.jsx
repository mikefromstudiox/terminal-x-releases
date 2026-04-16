/**
 * WorkOrders.jsx — Kanban-style work order management board.
 *
 * Statuses: Estimado -> Aprobado -> En Progreso -> Completado -> Facturado
 * Cards show WO number, vehicle, client, bay, technician, totals, dates.
 * Includes create modal, detail modal with line items, and status transitions.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Wrench, Plus, Search, X, ChevronDown, Clock, Car,
  User, MapPin, FileText, DollarSign, Loader2, Trash2,
  CheckCircle2, AlertCircle, ClipboardList, Hash,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUSES = [
  { id: 'estimado',    label_es: 'Estimado',    label_en: 'Estimated',    bg: 'bg-slate-100 dark:bg-white/10',       text: 'text-slate-600 dark:text-white/60',    dot: 'bg-slate-400',  border: 'border-slate-200 dark:border-white/10' },
  { id: 'aprobado',    label_es: 'Aprobado',    label_en: 'Approved',     bg: 'bg-sky-50 dark:bg-sky-500/10',        text: 'text-sky-700 dark:text-sky-400',       dot: 'bg-sky-500',    border: 'border-sky-200 dark:border-sky-500/30' },
  { id: 'en_progreso', label_es: 'En Progreso', label_en: 'In Progress',  bg: 'bg-amber-50 dark:bg-amber-500/10',    text: 'text-amber-700 dark:text-amber-400',   dot: 'bg-amber-500',  border: 'border-amber-200 dark:border-amber-500/30' },
  { id: 'completado',  label_es: 'Completado',  label_en: 'Completed',    bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-500/30' },
  { id: 'facturado',   label_es: 'Facturado',   label_en: 'Invoiced',     bg: 'bg-violet-50 dark:bg-violet-500/10',  text: 'text-violet-700 dark:text-violet-400',  dot: 'bg-violet-500', border: 'border-violet-200 dark:border-violet-500/30' },
]

const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]))

const NEXT_STATUS = {
  estimado: 'aprobado',
  aprobado: 'en_progreso',
  en_progreso: 'completado',
  completado: 'facturado',
}

const ACTION_LABELS = {
  estimado:    { es: 'Aprobar',   en: 'Approve' },
  aprobado:    { es: 'Iniciar',   en: 'Start' },
  en_progreso: { es: 'Completar', en: 'Complete' },
  completado:  { es: 'Facturar',  en: 'Invoice' },
}

const LINE_TYPES = [
  { id: 'labor',    label_es: 'Mano de Obra', label_en: 'Labor' },
  { id: 'part',     label_es: 'Repuesto',     label_en: 'Part' },
  { id: 'service',  label_es: 'Servicio',     label_en: 'Service' },
]

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(s) {
  if (!s) return '---'
  return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtWO(num) {
  return `WO-${String(num).padStart(4, '0')}`
}

// ── Create Work Order Modal ──────────────────────────────────────────────────

function CreateModal({ vehicles, clients, empleados, bays, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    vehicle_id: '',
    plate: '', make: '', model: '', year: '', color: '',
    client_id: '',
    technician_id: '',
    bay_id: '',
    promised_date: '',
    notes: '',
    quickVehicle: false,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.vehicle_id && !form.plate.trim()) {
      setErr(L('Selecciona un vehiculo o ingresa una placa.', 'Select a vehicle or enter a plate.'))
      return
    }
    setSaving(true)
    try {
      await onSave({
        vehicle_id: form.vehicle_id || null,
        plate: form.plate.trim() || null,
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        year: form.year ? Number(form.year) : null,
        color: form.color.trim() || null,
        client_id: form.client_id || null,
        technician_id: form.technician_id || null,
        bay_id: form.bay_id || null,
        promised_date: form.promised_date || null,
        notes: form.notes.trim() || null,
      })
    } catch (ex) {
      setErr(ex?.message || L('Error al crear orden', 'Error creating order'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Wrench size={16} className="text-[#b3001e]" />
            {L('Nueva Orden de Trabajo', 'New Work Order')}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Vehicle selection */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Vehiculo', 'Vehicle')}
            </label>
            {!form.quickVehicle ? (
              <div className="space-y-2">
                <select value={form.vehicle_id} onChange={e => set('vehicle_id', e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
                  <option value="">{L('Seleccionar vehiculo...', 'Select vehicle...')}</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.plate} - {v.make} {v.model}</option>
                  ))}
                </select>
                <button type="button" onClick={() => set('quickVehicle', true)}
                  className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline">
                  {L('+ Agregar vehiculo nuevo', '+ Add new vehicle')}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.plate} onChange={e => set('plate', e.target.value.toUpperCase())}
                    placeholder={L('Placa *', 'Plate *')}
                    className="px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
                  <input value={form.make} onChange={e => set('make', e.target.value)}
                    placeholder={L('Marca', 'Make')}
                    className="px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={form.model} onChange={e => set('model', e.target.value)}
                    placeholder={L('Modelo', 'Model')}
                    className="px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
                  <input value={form.year} onChange={e => set('year', e.target.value)} type="number" min="1970" max="2030"
                    placeholder={L('Ano', 'Year')}
                    className="px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
                  <input value={form.color} onChange={e => set('color', e.target.value)}
                    placeholder="Color"
                    className="px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
                </div>
                <button type="button" onClick={() => { set('quickVehicle', false); set('plate', ''); set('make', ''); set('model', '') }}
                  className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline">
                  {L('Seleccionar vehiculo existente', 'Select existing vehicle')}
                </button>
              </div>
            )}
          </div>

          {/* Client */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Cliente', 'Client')}
            </label>
            <select value={form.client_id} onChange={e => set('client_id', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
              <option value="">{L('Seleccionar cliente...', 'Select client...')}</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name || c.nombre}</option>
              ))}
            </select>
          </div>

          {/* Technician + Bay */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Tecnico', 'Technician')}
              </label>
              <select value={form.technician_id} onChange={e => set('technician_id', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
                <option value="">{L('Seleccionar...', 'Select...')}</option>
                {empleados.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Bahia', 'Bay')}
              </label>
              <select value={form.bay_id} onChange={e => set('bay_id', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
                <option value="">{L('Sin asignar', 'Unassigned')}</option>
                {bays.filter(b => b.status === 'libre').map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Promised date */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Fecha prometida', 'Promised date')}
            </label>
            <input type="date" value={form.promised_date} onChange={e => set('promised_date', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Notas', 'Notes')}
            </label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              placeholder={L('Descripcion del trabajo...', 'Work description...')}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none" />
          </div>

          {err && (
            <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{err}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            {L('Cancelar', 'Cancel')}
          </button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {L('Crear Orden', 'Create Order')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ order, lang, onStatusChange, onAddItem, onDeleteItem, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const st = STATUS_MAP[order.status] || STATUS_MAP.estimado
  const items = order.items || []
  const total = items.reduce((s, i) => s + (Number(i.qty) * Number(i.unit_price)), 0)

  const [showAddItem, setShowAddItem] = useState(false)
  const [newItem, setNewItem] = useState({ type: 'labor', name: '', qty: 1, unit_price: 0 })
  const [addingItem, setAddingItem] = useState(false)
  const [confirmInvoice, setConfirmInvoice] = useState(false)

  async function handleAddItem() {
    if (!newItem.name.trim()) return
    setAddingItem(true)
    await onAddItem(order.id, {
      type: newItem.type,
      name: newItem.name.trim(),
      qty: Number(newItem.qty) || 1,
      unit_price: parseFloat(newItem.unit_price) || 0,
    })
    setNewItem({ type: 'labor', name: '', qty: 1, unit_price: 0 })
    setShowAddItem(false)
    setAddingItem(false)
  }

  function handleStatusAction() {
    const next = NEXT_STATUS[order.status]
    if (!next) return
    if (next === 'facturado') {
      setConfirmInvoice(true)
      return
    }
    onStatusChange(order.id, next)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-bold text-slate-800 dark:text-white">{fmtWO(order.order_number || order.id)}</h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${st.bg} ${st.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
              {L(st.label_es, st.label_en)}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Info grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <InfoRow icon={Car} label={L('Vehiculo', 'Vehicle')} value={`${order.plate || '---'} ${order.make || ''} ${order.model || ''}`.trim()} />
            <InfoRow icon={User} label={L('Cliente', 'Client')} value={order.client_name || '---'} />
            <InfoRow icon={User} label={L('Tecnico', 'Technician')} value={order.technician_name || L('Sin asignar', 'Unassigned')} />
            <InfoRow icon={MapPin} label={L('Bahia', 'Bay')} value={order.bay_name || L('Sin asignar', 'Unassigned')} />
            <InfoRow icon={Clock} label={L('Creado', 'Created')} value={fmtDate(order.created_at)} />
            <InfoRow icon={Clock} label={L('Prometido', 'Promised')} value={fmtDate(order.promised_date)} />
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{L('Notas', 'Notes')}</p>
              <p className="text-[13px] text-slate-600 dark:text-white/70">{order.notes}</p>
            </div>
          )}

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                {L('Items', 'Line Items')} ({items.length})
              </p>
              {order.status !== 'facturado' && (
                <button onClick={() => setShowAddItem(!showAddItem)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline">
                  <Plus size={12} /> {L('Agregar Item', 'Add Item')}
                </button>
              )}
            </div>

            {/* Add item form */}
            {showAddItem && (
              <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 mb-3 space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  <select value={newItem.type} onChange={e => setNewItem(n => ({ ...n, type: e.target.value }))}
                    className="px-2 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] bg-white dark:bg-white/5 dark:text-white">
                    {LINE_TYPES.map(t => <option key={t.id} value={t.id}>{L(t.label_es, t.label_en)}</option>)}
                  </select>
                  <input value={newItem.name} onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))}
                    placeholder={L('Descripcion', 'Description')}
                    className="col-span-3 px-2 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min="1" value={newItem.qty} onChange={e => setNewItem(n => ({ ...n, qty: e.target.value }))}
                    placeholder="Cant."
                    className="w-20 px-2 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400 text-center" />
                  <input type="number" min="0" step="0.01" value={newItem.unit_price} onChange={e => setNewItem(n => ({ ...n, unit_price: e.target.value }))}
                    placeholder={L('Precio unit.', 'Unit price')}
                    className="flex-1 px-2 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
                  <button onClick={handleAddItem} disabled={addingItem || !newItem.name.trim()}
                    className="px-3 py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors shrink-0">
                    {addingItem ? <Loader2 size={13} className="animate-spin" /> : L('Agregar', 'Add')}
                  </button>
                </div>
              </div>
            )}

            {/* Items table */}
            <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
              {items.length === 0 ? (
                <p className="text-center py-6 text-[12px] text-slate-400 dark:text-white/40">
                  {L('Sin items. Agrega mano de obra o repuestos.', 'No items. Add labor or parts.')}
                </p>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left">{L('Tipo', 'Type')}</th>
                      <th className="px-3 py-2 text-left">{L('Descripcion', 'Description')}</th>
                      <th className="px-3 py-2 text-center">{L('Cant.', 'Qty')}</th>
                      <th className="px-3 py-2 text-right">{L('Precio', 'Price')}</th>
                      <th className="px-3 py-2 text-right">{L('Total', 'Total')}</th>
                      {order.status !== 'facturado' && <th className="px-3 py-2 w-10"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const lineType = LINE_TYPES.find(t => t.id === item.type) || LINE_TYPES[0]
                      return (
                        <tr key={item.id || idx} className="border-t border-slate-100 dark:border-white/5">
                          <td className="px-3 py-2">
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60">
                              {L(lineType.label_es, lineType.label_en)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-white">{item.name}</td>
                          <td className="px-3 py-2 text-center text-slate-600 dark:text-white/70">{item.qty}</td>
                          <td className="px-3 py-2 text-right text-slate-600 dark:text-white/70">{fmtRD(item.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800 dark:text-white">{fmtRD(item.qty * item.unit_price)}</td>
                          {order.status !== 'facturado' && (
                            <td className="px-3 py-2">
                              <button onClick={() => onDeleteItem(order.id, item.id || idx)}
                                className="p-1 text-slate-400 dark:text-white/30 hover:text-red-500 rounded transition-colors">
                                <Trash2 size={12} />
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {/* Total */}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10">
                <span className="text-[12px] font-bold text-slate-500 dark:text-white/50 uppercase">{L('Total', 'Total')}</span>
                <span className="text-[16px] font-bold text-slate-800 dark:text-white">{fmtRD(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            {L('Cerrar', 'Close')}
          </button>
          {NEXT_STATUS[order.status] && (
            <button onClick={handleStatusAction}
              className={`flex items-center gap-1.5 px-5 py-2 text-[12px] font-bold rounded-lg transition-colors ${
                order.status === 'completado'
                  ? 'bg-[#b3001e] text-white hover:bg-[#8c0017]'
                  : 'bg-black text-white hover:bg-slate-800'
              }`}>
              {L(ACTION_LABELS[order.status]?.es, ACTION_LABELS[order.status]?.en)}
            </button>
          )}
        </div>

        {/* Invoice confirmation */}
        {confirmInvoice && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={() => setConfirmInvoice(false)}>
            <div className="bg-white dark:bg-black rounded-2xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <p className="text-[15px] font-bold text-slate-800 dark:text-white mb-1">
                {L('Facturar orden de trabajo', 'Invoice work order')}
              </p>
              <p className="text-[13px] text-slate-500 dark:text-white/60 mb-2">
                {L(
                  `Se creara un ticket/factura por ${fmtRD(total)} para esta orden. Esta accion no se puede deshacer.`,
                  `A ticket/invoice for ${fmtRD(total)} will be created for this order. This action cannot be undone.`
                )}
              </p>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setConfirmInvoice(false)}
                  className="flex-1 py-2.5 text-[13px] font-semibold text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg">
                  {L('Cancelar', 'Cancel')}
                </button>
                <button onClick={() => { setConfirmInvoice(false); onStatusChange(order.id, 'facturado') }}
                  className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-[#b3001e] hover:bg-[#8c0017] rounded-lg transition-colors">
                  {L('Facturar', 'Invoice')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={13} className="text-slate-400 dark:text-white/40 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{label}</p>
        <p className="text-[13px] text-slate-700 dark:text-white truncate">{value}</p>
      </div>
    </div>
  )
}

// ── Work Order Card ──────────────────────────────────────────────────────────

function WOCard({ order, lang, onClick }) {
  const L = (es, en) => lang === 'es' ? es : en
  const st = STATUS_MAP[order.status] || STATUS_MAP.estimado
  const total = (order.items || []).reduce((s, i) => s + (Number(i.qty) * Number(i.unit_price)), 0)

  return (
    <button onClick={() => onClick(order)}
      className="w-full text-left bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 hover:shadow-md dark:hover:border-white/20 transition-all group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-sky-600 dark:text-sky-400">{fmtWO(order.order_number || order.id)}</span>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${st.bg} ${st.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
          {L(st.label_es, st.label_en)}
        </span>
      </div>
      <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">
        {order.plate || '---'} {order.make ? `- ${order.make} ${order.model || ''}` : ''}
      </p>
      <p className="text-[12px] text-slate-500 dark:text-white/50 truncate mt-0.5">
        {order.client_name || L('Sin cliente', 'No client')}
      </p>
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2 min-w-0">
          {order.technician_name && (
            <div className="flex items-center gap-1 min-w-0">
              <div className="w-5 h-5 bg-slate-100 dark:bg-white/10 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-600 dark:text-white/60 shrink-0">
                {order.technician_name[0]}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-white/50 truncate">{order.technician_name}</span>
            </div>
          )}
          {order.bay_name && (
            <span className="text-[10px] font-medium text-slate-400 dark:text-white/30 bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded shrink-0">
              {order.bay_name}
            </span>
          )}
        </div>
        <span className="text-[13px] font-bold text-slate-700 dark:text-white shrink-0">{fmtRD(total)}</span>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-white/30 mt-2">{fmtDate(order.created_at)}</p>
    </button>
  )
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function WorkOrders() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [orders,    setOrders]    = useState([])
  const [vehicles,  setVehicles]  = useState([])
  const [clients,   setClients]   = useState([])
  const [empleados, setEmpleados] = useState([])
  const [bays,      setBays]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [detail,    setDetail]    = useState(null)
  const [toast,     setToast]     = useState(null)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function loadAll() {
    setLoading(true)
    try {
      const [wo, v, c, e, b] = await Promise.all([
        api?.workOrders?.list?.() || [],
        api?.vehicles?.list?.() || [],
        api?.clients?.all?.() || [],
        api?.empleados?.all?.() || [],
        api?.serviceBays?.list?.() || [],
      ])
      setOrders(wo || [])
      setVehicles(v || [])
      setClients(c || [])
      setEmpleados(e || [])
      setBays(b || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  async function handleCreate(data) {
    await api.workOrders.create(data)
    setShowCreate(false)
    await loadAll()
    flash(L('Orden de trabajo creada', 'Work order created'))
  }

  async function handleStatusChange(id, newStatus) {
    await api.workOrders.updateStatus({ id, status: newStatus })
    await loadAll()
    // Refresh detail if open
    if (detail?.id === id) {
      const updated = (await api.workOrders.list())?.find(o => o.id === id)
      if (updated) setDetail(updated)
    }
    flash(L('Estado actualizado', 'Status updated'))
  }

  async function handleAddItem(orderId, item) {
    await api.workOrders.addItem({ work_order_id: orderId, ...item })
    await loadAll()
    const updated = (await api.workOrders.list())?.find(o => o.id === orderId)
    if (updated) setDetail(updated)
  }

  async function handleDeleteItem(orderId, itemId) {
    await api.workOrders.deleteItem({ work_order_id: orderId, item_id: itemId })
    await loadAll()
    const updated = (await api.workOrders.list())?.find(o => o.id === orderId)
    if (updated) setDetail(updated)
  }

  // Counts per status
  const counts = useMemo(() => {
    const c = { all: orders.length }
    STATUSES.forEach(s => { c[s.id] = orders.filter(o => o.status === s.id).length })
    return c
  }, [orders])

  // Filtered list
  const visible = useMemo(() => {
    let list = orders
    if (filter !== 'all') list = list.filter(o => o.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        (o.plate || '').toLowerCase().includes(q) ||
        (o.client_name || '').toLowerCase().includes(q) ||
        (o.make || '').toLowerCase().includes(q) ||
        (o.model || '').toLowerCase().includes(q) ||
        fmtWO(o.order_number || o.id).toLowerCase().includes(q)
      )
    }
    return list
  }, [orders, filter, search])

  const FILTERS = [
    { id: 'all', label: L('Todos', 'All'), count: counts.all },
    ...STATUSES.map(s => ({ id: s.id, label: L(s.label_es, s.label_en), count: counts[s.id] || 0 })),
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 gap-2 md:gap-0">
          <div className="flex items-center gap-3">
            <Wrench size={20} className="text-slate-500 dark:text-white/60" />
            <div>
              <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
                {L('Ordenes de Trabajo', 'Work Orders')}
              </h1>
              <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5 hidden md:block">
                {L('Gestiona estimaciones, trabajos en progreso y facturacion', 'Manage estimates, work in progress and invoicing')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:border-sky-400 w-full md:w-64 flex-1 md:flex-none">
              <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={L('Buscar placa, cliente...', 'Search plate, client...')}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
            </div>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shrink-0">
              <Plus size={15} /> {L('Nueva Orden', 'New Order')}
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex px-3 md:px-6 gap-1 overflow-x-auto">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-2.5 md:px-3.5 py-2.5 text-[12px] md:text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                filter === f.id
                  ? 'border-sky-500 text-sky-600'
                  : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
              }`}>
              {f.label}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                filter === f.id ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-600' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="px-3 md:px-6 py-3 grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
        {STATUSES.map(s => (
          <div key={s.id} className={`rounded-xl border px-3 py-2.5 ${s.border} ${s.bg}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${s.text} opacity-70`}>{L(s.label_es, s.label_en)}</p>
            <p className={`text-[18px] font-bold ${s.text}`}>{counts[s.id] || 0}</p>
          </div>
        ))}
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/30 gap-2">
            <ClipboardList size={32} />
            <p className="text-sm">{L('No hay ordenes de trabajo', 'No work orders')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map(order => (
              <WOCard key={order.id} order={order} lang={lang} onClick={setDetail} />
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          vehicles={vehicles} clients={clients} empleados={empleados} bays={bays}
          lang={lang} onSave={handleCreate} onClose={() => setShowCreate(false)}
        />
      )}

      {/* Detail modal */}
      {detail && (
        <DetailModal
          order={detail} lang={lang}
          onStatusChange={handleStatusChange}
          onAddItem={handleAddItem}
          onDeleteItem={handleDeleteItem}
          onClose={() => setDetail(null)}
        />
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
