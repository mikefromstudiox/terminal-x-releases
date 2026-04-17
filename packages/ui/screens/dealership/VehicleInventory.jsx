/**
 * VehicleInventory.jsx — Dealership inventory of vehicles for sale.
 *
 * SEPARATE from customer vehicles (mechanic). Stock units with VIN, condition,
 * listing price, acquisition cost, status (available/reserved/sold/in_service),
 * title status and photo URLs.
 *
 * Shared by the dealership vertical only.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  CarFront, Plus, Search, X, Pencil, Trash2, Loader2,
  DollarSign, Tag, Gauge, Palette, Hash, FileText, CheckCircle2,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const CONDITIONS = [
  { v: 'new',       es: 'Nuevo',       en: 'New' },
  { v: 'used',      es: 'Usado',       en: 'Used' },
  { v: 'certified', es: 'Certificado', en: 'Certified' },
]
const STATUSES = [
  { v: 'available',  es: 'Disponible', en: 'Available',  cls: 'bg-white text-black border-black' },
  { v: 'reserved',   es: 'Reservado',  en: 'Reserved',   cls: 'bg-black text-white border-black' },
  { v: 'sold',       es: 'Vendido',    en: 'Sold',       cls: 'bg-[#b3001e] text-white border-[#b3001e]' },
  { v: 'in_service', es: 'En Servicio',en: 'In Service', cls: 'bg-white text-black border-black' },
]
const TITLE_STATUS = [
  { v: 'clean',   es: 'Limpio',    en: 'Clean' },
  { v: 'salvage', es: 'Salvamento',en: 'Salvage' },
  { v: 'lien',    es: 'Con Gravamen',en: 'Lien' },
  { v: 'pending', es: 'Pendiente', en: 'Pending' },
]

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StatusPill({ status, lang }) {
  const s = STATUSES.find(x => x.v === status) || STATUSES[0]
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold border ${s.cls}`}>{lang === 'es' ? s.es : s.en}</span>
}

function VehicleModal({ unit, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    stock_number:     unit?.stock_number     || '',
    vin:              unit?.vin              || '',
    make:             unit?.make             || '',
    model:            unit?.model            || '',
    year:             unit?.year             || new Date().getFullYear(),
    color:            unit?.color            || '',
    mileage:          unit?.mileage          || 0,
    condition:        unit?.condition        || 'used',
    acquisition_cost: unit?.acquisition_cost || 0,
    listing_price:    unit?.listing_price    || 0,
    status:           unit?.status           || 'available',
    title_status:     unit?.title_status     || 'clean',
    notes:            unit?.notes            || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.make.trim() || !form.model.trim()) { setErr(L('Marca y modelo son requeridos.', 'Make and model are required.')); return }
    setSaving(true); setErr('')
    try {
      await onSave({
        ...form,
        year: Number(form.year) || null,
        mileage: Number(form.mileage) || 0,
        acquisition_cost: Number(form.acquisition_cost) || 0,
        listing_price: Number(form.listing_price) || 0,
      })
      onClose()
    } catch (ex) { setErr(ex?.message || L('Error al guardar.', 'Save failed.')); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold">{unit ? L('Editar Unidad', 'Edit Unit') : L('Nueva Unidad', 'New Unit')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {err && <div className="bg-[#b3001e] text-white px-3 py-2 text-sm">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">{L('# Stock', 'Stock #')}</span>
              <input value={form.stock_number} onChange={e => set('stock_number', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">VIN</span>
              <input value={form.vin} onChange={e => set('vin', e.target.value.toUpperCase())} maxLength={17} className="mt-1 w-full border border-black px-2 py-1.5 font-mono" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Marca', 'Make')}*</span>
              <input value={form.make} onChange={e => set('make', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" required />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Modelo', 'Model')}*</span>
              <input value={form.model} onChange={e => set('model', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" required />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Año', 'Year')}</span>
              <input type="number" value={form.year} onChange={e => set('year', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Color', 'Color')}</span>
              <input value={form.color} onChange={e => set('color', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Kilometraje', 'Mileage')}</span>
              <input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Condición', 'Condition')}</span>
              <select value={form.condition} onChange={e => set('condition', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                {CONDITIONS.map(c => <option key={c.v} value={c.v}>{lang === 'es' ? c.es : c.en}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Costo de Adquisición', 'Acquisition Cost')}</span>
              <input type="number" step="0.01" value={form.acquisition_cost} onChange={e => set('acquisition_cost', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Precio de Venta', 'Listing Price')}</span>
              <input type="number" step="0.01" value={form.listing_price} onChange={e => set('listing_price', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Estado', 'Status')}</span>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                {STATUSES.map(s => <option key={s.v} value={s.v}>{lang === 'es' ? s.es : s.en}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Título', 'Title')}</span>
              <select value={form.title_status} onChange={e => set('title_status', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                {TITLE_STATUS.map(t => <option key={t.v} value={t.v}>{lang === 'es' ? t.es : t.en}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-black">{L('Cancelar', 'Cancel')}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-black text-white disabled:opacity-50 inline-flex items-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />} {L('Guardar', 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function VehicleInventory() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(false)

  async function load() {
    setLoading(true)
    const rows = await api.vehicleInventory.list()
    setUnits(rows || [])
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return units.filter(u => {
      if (filterStatus && u.status !== filterStatus) return false
      if (!q) return true
      return [u.stock_number, u.vin, u.make, u.model, u.color, String(u.year)].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [units, query, filterStatus])

  async function save(data) {
    if (editing) await api.vehicleInventory.update(editing.id, data)
    else         await api.vehicleInventory.create(data)
    await load()
  }
  async function remove(u) {
    if (!confirm(L(`¿Eliminar ${u.make} ${u.model}?`, `Delete ${u.make} ${u.model}?`))) return
    await api.vehicleInventory.delete(u.id); await load()
  }

  const totals = useMemo(() => {
    const avail = units.filter(u => u.status === 'available')
    const sold  = units.filter(u => u.status === 'sold')
    return {
      available: avail.length,
      invValue:  avail.reduce((s, u) => s + Number(u.listing_price || 0), 0),
      soldCount: sold.length,
    }
  }, [units])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3"><CarFront size={32} /> {L('Inventario de Vehículos', 'Vehicle Inventory')}</h1>
          <p className="text-sm text-black/70 mt-1">{L('Unidades en venta — distinto del inventario de piezas.', 'Units for sale — separate from parts inventory.')}</p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true) }} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2"><Plus size={18} /> {L('Nueva Unidad', 'New Unit')}</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="border border-black p-4"><div className="text-xs font-semibold">{L('Disponibles', 'Available')}</div><div className="text-2xl font-bold">{totals.available}</div></div>
        <div className="border border-black p-4"><div className="text-xs font-semibold">{L('Valor de Inventario', 'Inventory Value')}</div><div className="text-2xl font-bold">{fmtRD(totals.invValue)}</div></div>
        <div className="border border-black p-4"><div className="text-xs font-semibold">{L('Vendidos', 'Sold')}</div><div className="text-2xl font-bold">{totals.soldCount}</div></div>
      </div>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-2 top-2.5" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={L('Buscar VIN, stock, marca…', 'Search VIN, stock, make…')} className="w-full pl-8 pr-3 py-2 border border-black" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-black px-3 py-2">
          <option value="">{L('Todos los estados', 'All statuses')}</option>
          {STATUSES.map(s => <option key={s.v} value={s.v}>{lang === 'es' ? s.es : s.en}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="border border-black p-12 text-center">
          <CarFront size={48} className="mx-auto mb-3" />
          <p>{L('Sin unidades. Agregue su primer vehículo.', 'No units. Add your first vehicle.')}</p>
        </div>
      ) : (
        <div className="border border-black overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">Stock</th>
                <th className="text-left px-3 py-2">{L('Vehículo', 'Vehicle')}</th>
                <th className="text-left px-3 py-2">VIN</th>
                <th className="text-right px-3 py-2">{L('KM', 'Miles')}</th>
                <th className="text-right px-3 py-2">{L('Precio', 'Price')}</th>
                <th className="text-left px-3 py-2">{L('Estado', 'Status')}</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-t border-black/10 hover:bg-black/5">
                  <td className="px-3 py-2 font-mono">{u.stock_number || '—'}</td>
                  <td className="px-3 py-2 font-semibold">{u.year} {u.make} {u.model} {u.color ? <span className="text-black/60 font-normal">· {u.color}</span> : null}</td>
                  <td className="px-3 py-2 font-mono text-xs">{u.vin || '—'}</td>
                  <td className="px-3 py-2 text-right">{Number(u.mileage || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtRD(u.listing_price)}</td>
                  <td className="px-3 py-2"><StatusPill status={u.status} lang={lang} /></td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => { setEditing(u); setShowModal(true) }} className="p-1 hover:bg-black hover:text-white mr-1"><Pencil size={14} /></button>
                    <button onClick={() => remove(u)} className="p-1 hover:bg-[#b3001e] hover:text-white"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <VehicleModal unit={editing} lang={lang} onSave={save} onClose={() => setShowModal(false)} />}
    </div>
  )
}
