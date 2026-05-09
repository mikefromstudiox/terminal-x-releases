/**
 * WOModal.jsx — Create + Detail modals for the WorkOrders screen.
 *
 * Houses CreateModal, DetailModal, plus their internal helpers
 * (InspectionPanel, TotalsBreakdown, InfoRow). Visual layout is
 * byte-identical to the pre-refactor inline JSX. The only behavior change
 * versus the legacy file is the tow fee: it now arrives as a `towFee` prop
 * (sourced from app_settings.mechanic_tow_fee_default) instead of being
 * hardcoded to RD$ 500 inline.
 */

import { useEffect, useState } from 'react'
import {
  Wrench, Plus, X, ChevronDown, Clock, Car, User, MapPin, DollarSign, Loader2,
  Trash2, CheckCircle2, AlertCircle, Hash,
  ClipboardCheck, PackageOpen, PenLine, Link2, Copy,
  Camera, Shield, Truck,
} from 'lucide-react'
import VehicleHistoryModal from '../../../components/VehicleHistoryModal'
import { useAPI } from '../../../context/DataContext'
import {
  STATUS_MAP, NEXT_STATUS, ACTION_LABELS, LINE_TYPES, fmtWO,
} from '../wo/constants'

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(s) {
  if (!s) return '---'
  return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Create Work Order Modal ──────────────────────────────────────────────────

export function CreateModal({ vehicles, clients, empleados, bays, lang, onSave, onClose }) {
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
      try { (typeof window !== 'undefined') && window.__txReportError?.(ex, { severity: 'error', category: 'womodal.fmtrd' }) } catch {}
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
                    onBlur={e => {
                      // FIX-M1 — autosearch on blur. If the typed plate matches
                      // an existing vehicle, prompt to load that record instead
                      // (avoids dupes from typo'd quick-add).
                      const typed = String(e.target.value || '').trim().toUpperCase()
                      if (!typed) return
                      const hit = (vehicles || []).find(v => String(v.plate || '').toUpperCase() === typed)
                      if (hit) {
                        const ok = window.confirm(L(
                          `Vehículo encontrado: ${hit.make || ''} ${hit.model || ''} (${hit.plate}). ¿Cargar este vehículo en lugar de crear uno nuevo?`,
                          `Vehicle found: ${hit.make || ''} ${hit.model || ''} (${hit.plate}). Load this existing vehicle instead of creating a new one?`,
                        ))
                        if (ok) {
                          set('quickVehicle', false)
                          set('vehicle_id', hit.id)
                          set('plate', '')
                          set('make', ''); set('model', ''); set('year', ''); set('color', '')
                          if (hit.client_id) set('client_id', hit.client_id)
                        }
                      }
                    }}
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

// ── Digital Vehicle Inspection ───────────────────────────────────────────────

const INSPECTION_ITEMS = [
  { id: 'frenos',     label_es: 'Frenos',     label_en: 'Brakes' },
  { id: 'llantas',    label_es: 'Llantas',    label_en: 'Tires' },
  { id: 'fluidos',    label_es: 'Fluidos',    label_en: 'Fluids' },
  { id: 'luces',      label_es: 'Luces',      label_en: 'Lights' },
  { id: 'bateria',    label_es: 'Bateria',    label_en: 'Battery' },
  { id: 'filtros',    label_es: 'Filtros',    label_en: 'Filters' },
  { id: 'correas',    label_es: 'Correas',    label_en: 'Belts' },
  { id: 'suspension', label_es: 'Suspension', label_en: 'Suspension' },
]

const STATUS_STYLES = {
  pass: { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-500', label_es: 'Bien',     label_en: 'Pass' },
  warn: { bg: 'bg-amber-500',   text: 'text-white', border: 'border-amber-500',   label_es: 'Atencion', label_en: 'Warn' },
  fail: { bg: 'bg-[#b3001e]',   text: 'text-white', border: 'border-[#b3001e]',   label_es: 'Falla',    label_en: 'Fail' },
}

function InspectionPanel({ inspection, lang, onChange, onSave, saving, workOrderSupabaseId, vehicleSupabaseId }) {
  const L = (es, en) => lang === 'es' ? es : en
  const apiInsp = useAPI()
  const rows = inspection?.items || {}
  const [uploadingId, setUploadingId] = useState(null)
  function set(id, patch) {
    onChange({ ...inspection, items: { ...rows, [id]: { ...(rows[id] || {}), ...patch } } })
  }
  async function uploadInspectionPhoto(itemId, file) {
    if (!file) return
    setUploadingId(itemId)
    try {
      const r = await apiInsp.workOrderPhotos?.upload?.({
        work_order_supabase_id: workOrderSupabaseId,
        vehicle_supabase_id: vehicleSupabaseId,
        phase: 'antes',
        file,
        caption: `Inspección: ${itemId}`,
      })
      const path = r?.storage_path || r?.signed_url || null
      if (path) set(itemId, { photo_url: path })
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'womodal.inspectionpanel' }) } catch {}
      console.warn('[InspectionPanel] photo upload failed', e?.message || e)
      try { window.alert(L('No se pudo subir la foto. Verifique conexión.', 'Photo upload failed. Check connection.')) } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.inspectionpanel' }) } catch {}}
    } finally {
      setUploadingId(null)
    }
  }
  return (
    <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-bold text-slate-700 dark:text-white flex items-center gap-1.5">
          <ClipboardCheck size={14} className="text-[#b3001e]" /> {L('Inspeccion Digital', 'Digital Inspection')}
        </p>
        <button type="button" onClick={onSave} disabled={saving}
          className="flex items-center gap-1 px-3 py-1.5 bg-black text-white text-[11px] font-bold rounded-lg disabled:opacity-50">
          {saving && <Loader2 size={11} className="animate-spin" />} {L('Guardar', 'Save')}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {INSPECTION_ITEMS.map(it => {
          const row = rows[it.id] || {}
          const hasPhoto = !!row.photo_url
          return (
            <div key={it.id} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[12px] font-semibold text-slate-800 dark:text-white">{L(it.label_es, it.label_en)}</p>
                <div className="flex gap-1">
                  {['pass','warn','fail'].map(s => {
                    const st = STATUS_STYLES[s]
                    const selected = row.status === s
                    return (
                      <button type="button" key={s} onClick={() => set(it.id, { status: s })}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                          selected ? `${st.bg} ${st.text} ${st.border}` : 'bg-white dark:bg-white/5 text-slate-500 dark:text-white/50 border-slate-200 dark:border-white/10 hover:border-slate-300'
                        }`}>
                        {L(st.label_es, st.label_en)}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <input value={row.note || ''} onChange={e => set(it.id, { note: e.target.value })}
                  placeholder={L('Nota (opcional)', 'Note (optional)')}
                  className="flex-1 px-2 py-1 border border-slate-200 dark:border-white/10 rounded text-[11px] bg-white dark:bg-white/5 text-slate-700 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-400" />
                <label
                  title={hasPhoto ? L('Cambiar foto', 'Change photo') : L('Tomar foto', 'Take photo')}
                  className={`shrink-0 px-2 py-1 rounded text-[10px] font-bold border cursor-pointer flex items-center gap-1 ${
                    hasPhoto
                      ? 'bg-[#b3001e] border-[#b3001e] text-white'
                      : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:border-[#b3001e] hover:text-[#b3001e]'
                  } ${uploadingId === it.id ? 'opacity-60 cursor-wait' : ''}`}
                >
                  {uploadingId === it.id
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Camera size={11} />}
                  <span className="hidden md:inline">{hasPhoto ? '✓' : L('Foto', 'Photo')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={uploadingId === it.id || !workOrderSupabaseId}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) uploadInspectionPhoto(it.id, f)
                      e.target.value = ''
                    }}
                  />
                </label>
                {hasPhoto && (
                  <button type="button" onClick={() => set(it.id, { photo_url: null })}
                    title={L('Quitar foto', 'Remove photo')}
                    className="shrink-0 px-1.5 py-1 rounded text-[10px] text-slate-400 hover:text-[#b3001e]">
                    <X size={11} />
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

// ── Totals Breakdown (labor / parts / ITBIS 18%) ─────────────────────────────

function TotalsBreakdown({ items, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const labor = items.filter(i => (i.type === 'labor' || i.type === 'service')).reduce((s, i) => s + (Number(i.qty ?? i.quantity ?? 1) * Number(i.unit_price || 0)), 0)
  const parts = items.filter(i => i.type === 'part').reduce((s, i) => s + (Number(i.qty ?? i.quantity ?? 1) * Number(i.unit_price || 0)), 0)
  const itbis = Math.round(parts * 0.18 * 100) / 100
  const total = Math.round((labor + parts + itbis) * 100) / 100
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10 text-[12px]">
      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">{L('Mano de Obra', 'Labor')}</p><p className="font-semibold text-slate-800 dark:text-white">{fmtRD(labor)}</p></div>
      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">{L('Repuestos', 'Parts')}</p><p className="font-semibold text-slate-800 dark:text-white">{fmtRD(parts)}</p></div>
      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">{L('ITBIS 18%', 'ITBIS 18%')}</p><p className="font-semibold text-slate-800 dark:text-white">{fmtRD(itbis)}</p></div>
      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">{L('Total', 'Total')}</p><p className="font-bold text-slate-800 dark:text-white text-[14px]">{fmtRD(total)}</p></div>
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

// ── Detail Modal ─────────────────────────────────────────────────────────────

export function DetailModal({
  order, lang, towFee,
  onStatusChange, onAddItem, onDeleteItem, onSaveInspection,
  onGenerateApprovalLink, onSetPartsOrder, onClose,
}) {
  const L = (es, en) => lang === 'es' ? es : en
  const st = STATUS_MAP[order.status] || STATUS_MAP.estimado
  const items = order.items || []
  const total = items.reduce((s, i) => s + (Number(i.qty) * Number(i.unit_price)), 0)

  const [showAddItem, setShowAddItem] = useState(false)
  const [newItem, setNewItem] = useState({ type: 'labor', name: '', qty: 1, unit_price: 0 })
  const [addingItem, setAddingItem] = useState(false)
  const [confirmInvoice, setConfirmInvoice] = useState(false)
  const [showInspection, setShowInspection] = useState(false)
  const [inspection, setInspection] = useState(() => {
    try { return typeof order.inspection_json === 'string' ? JSON.parse(order.inspection_json || '{}') : (order.inspection_json || {}) }
    catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.totalsbreakdown' }) } catch {} return {} }
  })
  const [savingInsp, setSavingInsp] = useState(false)
  const [showParts, setShowParts] = useState(false)
  const [partsDate, setPartsDate] = useState(order.expected_parts_arrival || '')
  const [approvalLink, setApprovalLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [photoCount, setPhotoCount] = useState({ antes: 0, despues: 0 })
  const [photoUploading, setPhotoUploading] = useState(false)
  const [showInsurance, setShowInsurance] = useState(!!order.aseguradora_supabase_id)
  const [insuranceForm, setInsuranceForm] = useState({
    aseguradora_supabase_id: order.aseguradora_supabase_id || '',
    poliza_no: order.poliza_no || '',
    reclamo_no: order.reclamo_no || '',
    aseguradora_status: order.aseguradora_status || 'pendiente',
  })
  const [aseguradoras, setAseguradoras] = useState([])
  const [showVehicleHistory, setShowVehicleHistory] = useState(false)
  const [confirmListo, setConfirmListo] = useState(false)
  const [deliveryToggle, setDeliveryToggle] = useState(!!order.delivery_required)
  const apiRef = useAPI()

  // FIX-HIGH-7 — guarantee a sane fallback even if the orchestrator fails to
  // fetch settings (offline first run). 500 keeps prior behavior verbatim.
  const effectiveTowFee = Number.isFinite(Number(towFee)) && Number(towFee) > 0
    ? Number(towFee)
    : 500

  useEffect(() => {
    (async () => {
      if (!order?.supabase_id) return
      try {
        const photos = await apiRef.workOrderPhotos?.listByWO?.(order.supabase_id) || []
        setPhotoCount({
          antes: photos.filter(p => p.phase === 'antes').length,
          despues: photos.filter(p => p.phase === 'despues').length,
        })
      } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.inforow' }) } catch {}}
      try {
        const list = await apiRef.aseguradoras?.list?.() || []
        setAseguradoras(list)
      } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.inforow' }) } catch {}}
    })()
  }, [order?.supabase_id]) // eslint-disable-line

  async function handlePhotoUpload(phase, file) {
    if (!file || !order.supabase_id) return
    setPhotoUploading(true)
    try {
      await apiRef.workOrderPhotos?.upload?.({
        work_order_supabase_id: order.supabase_id,
        vehicle_supabase_id: order.vehicle_supabase_id,
        phase, file,
      })
      setPhotoCount(c => ({ ...c, [phase]: (c[phase] || 0) + 1 }))
    } finally { setPhotoUploading(false) }
  }

  async function handleSaveInsurance() {
    await apiRef.workOrders?.update?.(order.id, insuranceForm)
  }

  async function handleConfirmListo() {
    const patch = { status: 'listo', ready_at: new Date().toISOString() }
    const REMOLQUE_NAME = 'Servicio de remolque / entrega'
    if (deliveryToggle && !order.delivery_required) {
      patch.delivery_required = true
      patch.delivery_fee = effectiveTowFee
      try {
        await apiRef.workOrders?.addItem?.({
          work_order_id: order.id, type: 'service',
          name: REMOLQUE_NAME, qty: 1, unit_price: effectiveTowFee,
        })
      } catch (e) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'womodal.detailmodal' }) } catch {} console.warn('[Listo] addItem remolque failed', e?.message || e) }
    } else if (!deliveryToggle && order.delivery_required) {
      // FIX-M3 — toggle off removes the auto-added remolque so the customer
      // doesn't pay double when the cashier changes their mind.
      patch.delivery_required = false
      patch.delivery_fee = 0
      try {
        const remolque = (order.items || []).find(i =>
          i.type === 'service' && String(i.name || '').toLowerCase() === REMOLQUE_NAME.toLowerCase()
        )
        if (remolque?.id) {
          await apiRef.workOrders?.deleteItem?.({ work_order_id: order.id, item_id: remolque.id })
        }
      } catch (e) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'womodal.handlephotoupload' }) } catch {} console.warn('[Listo] remolque cleanup failed', e?.message || e) }
    }
    try { await apiRef.workOrders?.update?.(order.id, patch) } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'womodal.handlephotoupload' }) } catch {} console.warn('[Listo] update failed', e?.message || e) }
    // FIX-WA — auto-dispatch the "vehicle ready" WhatsApp via the configured
    // UltraMsg instance when the client has a phone.
    try {
      const phone = String(order.client_phone || '').replace(/\D/g, '')
      if (phone && order.vehicle_plate) {
        const body = deliveryToggle
          ? `Su vehículo ${order.vehicle_plate} está LISTO. Coordinaremos la entrega a domicilio. Gracias por su confianza.`
          : `Su vehículo ${order.vehicle_plate} está LISTO para recoger. Gracias por su confianza.`
        await apiRef.whatsapp?.send?.({ to: phone, body })
      }
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'womodal.handlephotoupload' }) } catch {} console.warn('[Listo] WhatsApp send skipped', e?.message || e) }
    setConfirmListo(false)
    onStatusChange(order.id, 'listo')
  }

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
    // FIX-H6 — mandatory pre/post photos. Manager override: hold Shift.
    const evt = (typeof window !== 'undefined' && window.event) ? window.event : null
    const overrideHeld = !!evt?.shiftKey
    if (next === 'en_progreso' && photoCount.antes === 0 && !overrideHeld) {
      try { window.alert(L('Tome al menos una foto ANTES para iniciar (mantenga Shift al hacer clic para anular).', 'Take at least one BEFORE photo to start (hold Shift while clicking to override).')) } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.handlephotoupload' }) } catch {}}
      return
    }
    if (next === 'completado' && photoCount.despues === 0 && !overrideHeld) {
      try { window.alert(L('Tome al menos una foto DESPUÉS para completar (mantenga Shift al hacer clic para anular).', 'Take at least one AFTER photo to complete (hold Shift while clicking to override).')) } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.handlephotoupload' }) } catch {}}
      return
    }
    if (next === 'facturado') { setConfirmInvoice(true); return }
    if (next === 'listo')     { setConfirmListo(true);   return }
    onStatusChange(order.id, next)
  }

  async function handleSaveInspection() {
    setSavingInsp(true)
    try { await onSaveInspection(order.id, inspection) } finally { setSavingInsp(false) }
  }
  async function handlePartsOrder() {
    if (!partsDate) return
    await onSetPartsOrder(order.id, partsDate)
    setShowParts(false)
  }
  async function handleApprovalLink() {
    const r = await onGenerateApprovalLink(order.id)
    if (r?.token) {
      const base = (typeof window !== 'undefined' ? window.location.origin : 'https://terminalxpos.com')
      setApprovalLink(`${base}/wo/approve/${r.token}`)
    }
  }
  async function handleCopy() {
    if (!approvalLink) return
    try { await navigator.clipboard.writeText(approvalLink); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.handleadditem' }) } catch {}}
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
              <TotalsBreakdown items={items} lang={lang} />
            </div>
          </div>

          {/* Mechanic extensions: inspection + parts order + approval link */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowInspection(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5">
                <ClipboardCheck size={13} /> {L('Inspeccion Digital', 'Digital Inspection')}
              </button>
              {order.status !== 'facturado' && (
                <button type="button" onClick={() => setShowParts(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10">
                  <PackageOpen size={13} /> {L('Esperando Repuestos', 'Awaiting Parts')}
                </button>
              )}
              {(order.status === 'estimado' || order.status === 'estimate') && (
                <button type="button" onClick={handleApprovalLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-sky-300 dark:border-sky-500/40 text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10">
                  <PenLine size={13} /> {L('Generar Link de Aprobacion', 'Generate Approval Link')}
                </button>
              )}
            </div>

            {showInspection && (
              <InspectionPanel
                inspection={inspection}
                lang={lang}
                onChange={setInspection}
                onSave={handleSaveInspection}
                saving={savingInsp}
                workOrderSupabaseId={order.supabase_id}
                vehicleSupabaseId={order.vehicle_supabase_id}
              />
            )}

            {showParts && order.status !== 'facturado' && (
              <div className="bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3">
                <p className="text-[12px] font-bold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-1.5">
                  <PackageOpen size={13} /> {L('Marcar en espera de repuestos', 'Mark as awaiting parts')}
                </p>
                <div className="flex items-center gap-2">
                  <input type="date" value={partsDate} onChange={e => setPartsDate(e.target.value)}
                    min={new Date().toISOString().slice(0,10)}
                    className="flex-1 px-3 py-2 border border-amber-200 dark:border-amber-500/30 rounded-lg text-[12px] bg-white dark:bg-white/5 text-slate-700 dark:text-white" />
                  <button type="button" onClick={handlePartsOrder} disabled={!partsDate}
                    className="px-3 py-2 bg-amber-500 text-white text-[12px] font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50">
                    {L('Confirmar', 'Confirm')}
                  </button>
                </div>
                {order.vehicle_plate && (
                  <a className="inline-block mt-2 text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline"
                    href={`https://wa.me/?text=${encodeURIComponent(L(
                      `Su vehiculo ${order.vehicle_plate} en la orden WO-${String(order.order_number || order.id).padStart(4,'0')} esta en espera de repuestos. Fecha estimada de llegada: ${partsDate || '---'}. Le avisaremos cuando este listo.`,
                      `Your vehicle ${order.vehicle_plate} (WO-${String(order.order_number || order.id).padStart(4,'0')}) is awaiting parts. Expected arrival: ${partsDate || '---'}. We'll notify you when ready.`
                    ))}`} target="_blank" rel="noopener">
                    {L('Enviar aviso por WhatsApp', 'Send WhatsApp notice')}
                  </a>
                )}
              </div>
            )}

            {/* v2.16.0 — Photos + Insurance + Vehicle History */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="border border-black dark:border-white/20 rounded-xl p-3">
                <p className="text-[12px] font-bold text-slate-800 dark:text-white flex items-center gap-1.5 mb-2"><Camera size={13}/>{L('Fotos del Servicio', 'Service Photos')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="border border-dashed border-black dark:border-white/30 rounded-lg p-2 flex flex-col items-center cursor-pointer hover:bg-black/5 dark:hover:bg-white/5">
                    <span className="text-[10px] uppercase">{L('Antes','Before')}</span>
                    <span className="font-bold text-base">{photoCount.antes}</span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload('antes', f); e.target.value = '' }}/>
                  </label>
                  <label className="border border-dashed border-black dark:border-white/30 rounded-lg p-2 flex flex-col items-center cursor-pointer hover:bg-black/5 dark:hover:bg-white/5">
                    <span className="text-[10px] uppercase">{L('Después','After')}</span>
                    <span className="font-bold text-base">{photoCount.despues}</span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload('despues', f); e.target.value = '' }}/>
                  </label>
                </div>
                {photoUploading && <p className="text-[10px] mt-1 text-slate-500"><Loader2 size={10} className="inline animate-spin mr-1"/>{L('Subiendo…','Uploading…')}</p>}
              </div>

              <div className="border border-black dark:border-white/20 rounded-xl p-3">
                <button type="button" onClick={() => setShowInsurance(s => !s)} className="text-[12px] font-bold text-slate-800 dark:text-white flex items-center gap-1.5 mb-2">
                  <Shield size={13}/>{L('Trabajo de Aseguradora','Insurance Work')}<ChevronDown size={12} className={`transition-transform ${showInsurance ? 'rotate-180' : ''}`}/>
                </button>
                {showInsurance && (
                  <div className="space-y-2">
                    <select value={insuranceForm.aseguradora_supabase_id} onChange={e => setInsuranceForm(f => ({...f, aseguradora_supabase_id: e.target.value}))} className="w-full px-2 py-1.5 border border-black dark:border-white/30 rounded text-[12px] bg-white dark:bg-white/5 dark:text-white">
                      <option value="">{L('— Sin aseguradora —','— None —')}</option>
                      {aseguradoras.map(a => <option key={a.id} value={a.supabase_id}>{a.nombre}</option>)}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder={L('Póliza','Policy')} value={insuranceForm.poliza_no} onChange={e => setInsuranceForm(f => ({...f, poliza_no: e.target.value}))} className="px-2 py-1.5 border border-black dark:border-white/30 rounded text-[12px] bg-white dark:bg-white/5 dark:text-white"/>
                      <input placeholder={L('Reclamo #','Claim #')} value={insuranceForm.reclamo_no} onChange={e => setInsuranceForm(f => ({...f, reclamo_no: e.target.value}))} className="px-2 py-1.5 border border-black dark:border-white/30 rounded text-[12px] bg-white dark:bg-white/5 dark:text-white"/>
                    </div>
                    <select value={insuranceForm.aseguradora_status} onChange={e => setInsuranceForm(f => ({...f, aseguradora_status: e.target.value}))} className="w-full px-2 py-1.5 border border-black dark:border-white/30 rounded text-[12px] bg-white dark:bg-white/5 dark:text-white">
                      <option value="pendiente">{L('Pendiente','Pending')}</option>
                      <option value="aprobado">{L('Aprobado','Approved')}</option>
                      <option value="rechazado">{L('Rechazado','Rejected')}</option>
                    </select>
                    <button type="button" onClick={handleSaveInsurance} className="w-full py-1.5 bg-black text-white text-[11px] font-bold rounded hover:bg-[#b3001e]">{L('Guardar','Save')}</button>
                    {/* FIX-M5 — descargar Hoja Técnica formato aseguradora. */}
                    {insuranceForm.aseguradora_supabase_id && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const { buildInspectionReportPdf } = await import('@terminal-x/services/pdf')
                            const empresa = await (apiRef.admin?.getEmpresa?.() || Promise.resolve({}))
                            const aseg = aseguradoras.find(a => a.supabase_id === insuranceForm.aseguradora_supabase_id) || {}
                            let photos = []
                            try {
                              const list = (await apiRef.workOrderPhotos?.listByWO?.(order.supabase_id)) || []
                              const picks = [...list.filter(p => p.phase === 'antes').slice(0, 2),
                                             ...list.filter(p => p.phase === 'despues').slice(0, 2)]
                              for (const p of picks) {
                                const url = p.signed_url || (apiRef.workOrderPhotos?.signedUrl ? await apiRef.workOrderPhotos.signedUrl(p.storage_path) : null)
                                if (!url) continue
                                const resp = await fetch(url)
                                if (!resp.ok) continue
                                const blob = await resp.blob()
                                const b64 = await new Promise((res, rej) => {
                                  const fr = new FileReader()
                                  fr.onerror = () => rej(fr.error); fr.onload = () => res(String(fr.result))
                                  fr.readAsDataURL(blob)
                                })
                                photos.push({ phase: p.phase, base64: b64, caption: p.caption || null })
                              }
                            } catch (_aetherErr) {
                              try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.for' }) } catch {}}
                            const { pdfBytes, filename } = await buildInspectionReportPdf({
                              wo: { ...order, items: order.items || [] },
                              business: empresa,
                              aseguradora: { ...aseg, ...insuranceForm },
                              client: order.client_name ? { name: order.client_name, phone: order.client_phone } : null,
                              photos,
                            })
                            const blob = new Blob([pdfBytes], { type: 'application/pdf' })
                            const a = document.createElement('a')
                            a.href = URL.createObjectURL(blob); a.download = filename; a.click()
                            setTimeout(() => URL.revokeObjectURL(a.href), 1000)
                          } catch (e) {
                            try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'womodal.for' }) } catch {}
                            console.warn('[hojaTecnica] failed', e?.message || e)
                            try { window.alert(L('No se pudo generar la hoja técnica.','Could not generate inspection report.')) } catch (_aetherErr) {
                              try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'womodal.for' }) } catch {}}
                          }
                        }}
                        className="w-full mt-2 py-1.5 bg-[#b3001e] text-white text-[11px] font-bold rounded hover:bg-black"
                      >
                        {L('Descargar Hoja Técnica (PDF)','Download Inspection Report (PDF)')}
                      </button>
                    )}
                  </div>
                )}
                {order.vehicle_supabase_id && (
                  <button type="button" onClick={() => setShowVehicleHistory(true)} className="mt-2 text-[11px] underline dark:text-white">{L('Ver historial del vehículo','View vehicle history')}</button>
                )}
              </div>
            </div>

            {approvalLink && (
              <div className="bg-sky-50 dark:bg-sky-500/5 border border-sky-200 dark:border-sky-500/20 rounded-xl p-3 space-y-2">
                <p className="text-[12px] font-bold text-sky-800 dark:text-sky-300 flex items-center gap-1.5">
                  <Link2 size={13} /> {L('Link de aprobacion del cliente', 'Customer approval link')}
                </p>
                <div className="flex items-center gap-2">
                  <input value={approvalLink} readOnly
                    className="flex-1 px-3 py-2 border border-sky-200 dark:border-sky-500/30 rounded-lg text-[11px] bg-white dark:bg-white/5 text-slate-700 dark:text-white font-mono" />
                  <button type="button" onClick={handleCopy}
                    className="px-3 py-2 bg-sky-600 text-white text-[11px] font-bold rounded-lg hover:bg-sky-700 flex items-center gap-1">
                    <Copy size={12} /> {copied ? L('Copiado', 'Copied') : L('Copiar', 'Copy')}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-white/50">
                  {L('Envia este link al cliente para que apruebe el estimado antes de iniciar el trabajo.', 'Send this link to the customer to approve the estimate before work starts.')}
                </p>
              </div>
            )}
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

        {/* v2.16.0 — Listo confirm + WhatsApp + delivery */}
        {confirmListo && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={() => setConfirmListo(false)}>
            <div className="bg-white dark:bg-black rounded-2xl p-6 max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <p className="text-[15px] font-bold text-slate-800 dark:text-white mb-1 flex items-center gap-2"><CheckCircle2 size={16} className="text-[#b3001e]"/>{L('Marcar Listo', 'Mark Ready')}</p>
              <p className="text-[12px] text-slate-500 dark:text-white/60 mb-3">{L('Notifica al cliente y opcionalmente añade cargo de entrega.','Notify the client and optionally add delivery fee.')}</p>
              <label className="flex items-center gap-2 mb-3 cursor-pointer">
                <input type="checkbox" checked={deliveryToggle} onChange={e => setDeliveryToggle(e.target.checked)} className="accent-[#b3001e]"/>
                <span className="text-[13px] dark:text-white">
                  <Truck size={12} className="inline mr-1"/>
                  {L(`Entrega a domicilio (+ ${fmtRD(effectiveTowFee)} remolque)`, `Home delivery (+ ${fmtRD(effectiveTowFee)} tow)`)}
                </span>
              </label>
              {order.vehicle_plate && (
                <a className="block mb-3 text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline"
                  href={`https://wa.me/?text=${encodeURIComponent(L(
                    `Su vehiculo ${order.vehicle_plate} esta LISTO para recoger. Gracias por su confianza.`,
                    `Your vehicle ${order.vehicle_plate} is READY for pickup. Thank you.`
                  ))}`} target="_blank" rel="noopener">
                  {L('Enviar WhatsApp al cliente','Send WhatsApp to client')}
                </a>
              )}
              <div className="flex gap-3 mt-3">
                <button onClick={() => setConfirmListo(false)} className="flex-1 py-2.5 text-[13px] font-semibold text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg">
                  {L('Cancelar','Cancel')}
                </button>
                <button onClick={handleConfirmListo} className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-[#b3001e] hover:bg-[#8c0017] rounded-lg">
                  {L('Confirmar Listo','Confirm Ready')}
                </button>
              </div>
            </div>
          </div>
        )}

        {showVehicleHistory && order.vehicle_supabase_id && (
          <VehicleHistoryModal
            vehicle={{
              id: order.vehicle_id,
              supabase_id: order.vehicle_supabase_id,
              plate: order.vehicle_plate || order.plate,
              vin: order.vehicle_vin,
              make: order.vehicle_make || order.make,
              model: order.vehicle_model || order.model,
            }}
            onClose={() => setShowVehicleHistory(false)}
          />
        )}
      </div>
    </div>
  )
}
