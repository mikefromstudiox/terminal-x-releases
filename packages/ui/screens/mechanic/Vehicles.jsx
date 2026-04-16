/**
 * Vehicles.jsx — Vehicle registry with service history.
 *
 * Table with search, create/edit modal, detail view with work order history.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Car, Plus, Search, X, Pencil, Trash2, Loader2,
  AlertCircle, CheckCircle2, History, Hash, Palette,
  Gauge, FileText, ChevronRight,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(s) {
  if (!s) return '---'
  return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Vehicle Form Modal ───────────────────────────────────────────────────────

function VehicleModal({ vehicle, clients, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    vin:       vehicle?.vin       || '',
    plate:     vehicle?.plate     || '',
    make:      vehicle?.make      || '',
    model:     vehicle?.model     || '',
    year:      vehicle?.year      || '',
    color:     vehicle?.color     || '',
    mileage:   vehicle?.mileage   || '',
    client_id: vehicle?.client_id || '',
    notes:     vehicle?.notes     || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.plate.trim()) {
      setErr(L('La placa es requerida.', 'Plate is required.'))
      return
    }
    setSaving(true)
    try {
      const data = {
        ...form,
        plate:   form.plate.trim().toUpperCase(),
        vin:     form.vin.trim().toUpperCase() || null,
        make:    form.make.trim() || null,
        model:   form.model.trim() || null,
        year:    form.year ? Number(form.year) : null,
        color:   form.color.trim() || null,
        mileage: form.mileage ? Number(form.mileage) : null,
        client_id: form.client_id || null,
        notes:   form.notes.trim() || null,
      }
      if (vehicle?.id) data.id = vehicle.id
      await onSave(data)
    } catch (ex) {
      setErr(ex?.message || L('Error al guardar', 'Error saving'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Car size={16} className="text-[#b3001e]" />
            {vehicle ? L('Editar Vehiculo', 'Edit Vehicle') : L('Nuevo Vehiculo', 'New Vehicle')}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Placa *', 'Plate *')}
              </label>
              <input value={form.plate} onChange={e => { set('plate', e.target.value.toUpperCase()); setErr('') }}
                placeholder="A123456"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">VIN</label>
              <input value={form.vin} onChange={e => set('vin', e.target.value.toUpperCase())}
                placeholder="1HGBH41JXMN109186"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Marca', 'Make')}
              </label>
              <input value={form.make} onChange={e => set('make', e.target.value)}
                placeholder="Toyota"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Modelo', 'Model')}
              </label>
              <input value={form.model} onChange={e => set('model', e.target.value)}
                placeholder="Corolla"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Ano', 'Year')}
              </label>
              <input type="number" min="1970" max="2030" value={form.year} onChange={e => set('year', e.target.value)}
                placeholder="2024"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">Color</label>
              <input value={form.color} onChange={e => set('color', e.target.value)}
                placeholder="Blanco"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Kilometraje', 'Mileage')}
              </label>
              <input type="number" min="0" value={form.mileage} onChange={e => set('mileage', e.target.value)}
                placeholder="50000"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Cliente', 'Client')}
            </label>
            <select value={form.client_id} onChange={e => set('client_id', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
              <option value="">{L('Sin cliente asignado', 'No client assigned')}</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name || c.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Notas', 'Notes')}
            </label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none" />
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
            {vehicle ? L('Guardar Cambios', 'Save Changes') : L('Crear Vehiculo', 'Create Vehicle')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ vehicle, lang, onClose }) {
  const api = useAPI()
  const L = (es, en) => lang === 'es' ? es : en
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  useEffect(() => {
    setLoadingHistory(true)
    Promise.resolve(api?.workOrders?.list?.({ vehicle_id: vehicle.id }) || [])
      .then(list => { setHistory(list || []); setLoadingHistory(false) })
      .catch(() => setLoadingHistory(false))
  }, [vehicle.id])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Car size={16} className="text-sky-500" />
            {vehicle.plate}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Vehicle info */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <InfoPill icon={Car} label={L('Marca/Modelo', 'Make/Model')} value={`${vehicle.make || '---'} ${vehicle.model || ''}`} />
            <InfoPill icon={Hash} label={L('Ano', 'Year')} value={vehicle.year || '---'} />
            <InfoPill icon={Palette} label="Color" value={vehicle.color || '---'} />
            <InfoPill icon={Hash} label="VIN" value={vehicle.vin || '---'} />
            <InfoPill icon={Gauge} label={L('Kilometraje', 'Mileage')} value={vehicle.mileage ? `${Number(vehicle.mileage).toLocaleString()} km` : '---'} />
            <InfoPill icon={FileText} label={L('Cliente', 'Client')} value={vehicle.client_name || '---'} />
          </div>

          {vehicle.notes && (
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{L('Notas', 'Notes')}</p>
              <p className="text-[13px] text-slate-600 dark:text-white/70">{vehicle.notes}</p>
            </div>
          )}

          {/* Service history */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2 flex items-center gap-1">
              <History size={12} /> {L('Historial de Ordenes', 'Work Order History')}
            </p>
            <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
              {loadingHistory ? (
                <p className="text-center py-8 text-slate-400 dark:text-white/40 text-[12px]">{L('Cargando...', 'Loading...')}</p>
              ) : history.length === 0 ? (
                <p className="text-center py-8 text-slate-400 dark:text-white/40 text-[12px]">
                  {L('Sin ordenes de trabajo previas.', 'No previous work orders.')}
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {history.map(wo => {
                    const total = (wo.items || []).reduce((s, i) => s + (Number(i.qty) * Number(i.unit_price)), 0)
                    return (
                      <div key={wo.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 dark:text-white">
                            WO-{String(wo.order_number || wo.id).padStart(4, '0')}
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-white/40">{fmtDate(wo.created_at)}</p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-[13px] font-bold text-slate-700 dark:text-white">{fmtRD(total)}</p>
                          <span className="text-[10px] font-medium text-slate-500 dark:text-white/50 capitalize">{wo.status?.replace('_', ' ')}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <button onClick={onClose}
            className="w-full py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
            {L('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function InfoPill({ icon: Icon, label, value }) {
  return (
    <div className="bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-2">
      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider flex items-center gap-1">
        <Icon size={10} /> {label}
      </p>
      <p className="text-[13px] font-semibold text-slate-700 dark:text-white mt-0.5 truncate">{value}</p>
    </div>
  )
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function Vehicles() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [vehicles,  setVehicles]  = useState([])
  const [clients,   setClients]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [modal,     setModal]     = useState(null)    // null | { vehicle } for create/edit
  const [detail,    setDetail]    = useState(null)    // vehicle for detail view
  const [delConfirm, setDelConfirm] = useState(null)
  const [toast,     setToast]     = useState(null)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function loadAll() {
    setLoading(true)
    try {
      const [v, c] = await Promise.all([
        api?.vehicles?.list?.() || [],
        api?.clients?.all?.() || [],
      ])
      setVehicles(v || [])
      setClients(c || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  async function handleSave(data) {
    if (data.id) await api.vehicles.update(data)
    else         await api.vehicles.create(data)
    setModal(null)
    await loadAll()
    flash(data.id ? L('Vehiculo actualizado', 'Vehicle updated') : L('Vehiculo creado', 'Vehicle created'))
  }

  async function handleDelete(vehicle) {
    await api.vehicles.delete({ id: vehicle.id })
    setDelConfirm(null)
    await loadAll()
    flash(L('Vehiculo eliminado', 'Vehicle deleted'))
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return vehicles
    const q = search.toLowerCase()
    return vehicles.filter(v =>
      (v.plate || '').toLowerCase().includes(q) ||
      (v.vin || '').toLowerCase().includes(q) ||
      (v.make || '').toLowerCase().includes(q) ||
      (v.model || '').toLowerCase().includes(q) ||
      (v.client_name || '').toLowerCase().includes(q)
    )
  }, [vehicles, search])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Car size={20} className="text-slate-500 dark:text-white/60" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{L('Vehiculos', 'Vehicles')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:border-sky-400 w-full md:w-64 flex-1 md:flex-none">
            <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={L('Buscar placa, VIN, marca...', 'Search plate, VIN, make...')}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
          </div>
          <button onClick={() => setModal({ vehicle: null })}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shrink-0">
            <Plus size={15} /> {L('Nuevo Vehiculo', 'New Vehicle')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="px-3 md:px-6 py-3 grid grid-cols-2 md:grid-cols-3 gap-3 shrink-0">
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
          <p className="text-xs text-slate-400 dark:text-white/40 mb-1">{L('Total Vehiculos', 'Total Vehicles')}</p>
          <p className="text-[18px] font-bold text-slate-700 dark:text-white">{vehicles.length}</p>
        </div>
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
          <p className="text-xs text-slate-400 dark:text-white/40 mb-1">{L('Con Cliente', 'With Client')}</p>
          <p className="text-[18px] font-bold text-sky-600 dark:text-sky-400">{vehicles.filter(v => v.client_id).length}</p>
        </div>
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3 hidden md:block">
          <p className="text-xs text-slate-400 dark:text-white/40 mb-1">{L('Marcas Unicas', 'Unique Makes')}</p>
          <p className="text-[18px] font-bold text-slate-700 dark:text-white">{new Set(vehicles.map(v => v.make).filter(Boolean)).size}</p>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-3 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/30 gap-2">
            <Car size={32} />
            <p className="text-sm">{vehicles.length === 0 ? L('No hay vehiculos registrados.', 'No vehicles registered.') : L('Sin resultados.', 'No results.')}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            {/* Desktop table */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/10 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">{L('Placa', 'Plate')}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">VIN</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">{L('Marca', 'Make')}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">{L('Modelo', 'Model')}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">{L('Ano', 'Year')}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">Color</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">{L('Cliente', 'Client')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} className="border-b border-slate-50 dark:border-white/5 last:border-0 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    onClick={() => setDetail(v)}>
                    <td className="px-4 py-3 font-bold text-sky-600 dark:text-sky-400">{v.plate}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-white/50 text-xs font-mono">{v.vin || '---'}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-white">{v.make || '---'}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-white">{v.model || '---'}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-white/60">{v.year || '---'}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-white/60">{v.color || '---'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-white/70">{v.client_name || '---'}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setModal({ vehicle: v })}
                          className="p-1.5 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-50 dark:hover:bg-white/10" title={L('Editar', 'Edit')}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDelConfirm(v)}
                          className="p-1.5 text-slate-400 dark:text-white/40 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10" title={L('Eliminar', 'Delete')}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-white/10">
              {filtered.map(v => (
                <div key={v.id} className="px-4 py-3 space-y-2" onClick={() => setDetail(v)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-sky-600 dark:text-sky-400">{v.plate}</p>
                      <p className="text-[12px] text-slate-600 dark:text-white/70">{v.make || '---'} {v.model || ''} {v.year ? `(${v.year})` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setModal({ vehicle: v })}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 dark:text-white/40 hover:text-slate-600">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setDelConfirm(v)}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 dark:text-white/40 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 dark:text-white/50">{v.client_name || L('Sin cliente', 'No client')}</span>
                    {v.color && <span className="text-slate-400 dark:text-white/40">{v.color}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal && (
        <VehicleModal vehicle={modal.vehicle} clients={clients} lang={lang} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {detail && (
        <DetailModal vehicle={detail} lang={lang} onClose={() => setDetail(null)} />
      )}

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDelConfirm(null)}>
          <div className="bg-white dark:bg-black rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-slate-800 dark:text-white mb-2">{L('Eliminar vehiculo?', 'Delete vehicle?')}</p>
            <p className="text-sm text-slate-500 dark:text-white/60 mb-6">
              {L('Se eliminara', 'Will delete')} <span className="font-medium text-slate-700 dark:text-white">{delConfirm.plate}</span>.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)}
                className="flex-1 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
                {L('Cancelar', 'Cancel')}
              </button>
              <button onClick={() => handleDelete(delConfirm)}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
                {L('Eliminar', 'Delete')}
              </button>
            </div>
          </div>
        </div>
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
