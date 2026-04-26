/**
 * VehicleInventory.jsx — Dealership inventory of vehicles for sale.
 *
 * Sprint 2D M1: split into VehicleForm / VehicleDocumentManager /
 * VehicleCsvImporter under ./components/. This file is now a thin orchestrator:
 * list, filters, KPIs, and modal toggles only.
 *
 * SEPARATE from customer vehicles (mechanic). Stock units with VIN, condition,
 * listing price, acquisition cost, status (available/reserved/sold/in_service),
 * title status and photo URLs.
 */

import { useState, useEffect, useMemo } from 'react'
import { CarFront, Plus, Search, Pencil, Trash2, Loader2, FileUp } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import VehicleForm from './components/VehicleForm.jsx'
import VehicleCsvImporter from './components/VehicleCsvImporter.jsx'

const STATUSES = [
  { v: 'available',  es: 'Disponible',  en: 'Available',  cls: 'bg-white text-black border-black' },
  { v: 'reserved',   es: 'Reservado',   en: 'Reserved',   cls: 'bg-black text-white border-black' },
  { v: 'sold',       es: 'Vendido',     en: 'Sold',       cls: 'bg-[#b3001e] text-white border-[#b3001e]' },
  { v: 'in_service', es: 'En Servicio', en: 'In Service', cls: 'bg-white text-black border-black' },
]

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StatusPill({ status, lang }) {
  const s = STATUSES.find(x => x.v === status) || STATUSES[0]
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold border ${s.cls}`}>{lang === 'es' ? s.es : s.en}</span>
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
  const [showCsv, setShowCsv] = useState(false)

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
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCsv(true)} className="px-4 py-2 border border-black inline-flex items-center gap-2"><FileUp size={16}/>{L('Importar CSV', 'Import CSV')}</button>
          <button onClick={() => { setEditing(null); setShowModal(true) }} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2"><Plus size={18} /> {L('Nueva Unidad', 'New Unit')}</button>
        </div>
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
                <th className="text-left px-3 py-2 w-14"></th>
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
              {filtered.map(u => {
                const thumb = Array.isArray(u.photo_urls) ? u.photo_urls[0] : null
                return (
                  <tr key={u.id} className="border-t border-black/10 hover:bg-black/5">
                    <td className="px-2 py-1">
                      <div className="w-12 h-9 bg-black/5 border border-black/10 overflow-hidden flex items-center justify-center">
                        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy"/> : <CarFront size={14} className="text-black/30"/>}
                      </div>
                    </td>
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
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <VehicleForm
        open={showModal}
        unit={editing}
        lang={lang}
        onSave={save}
        onClose={() => setShowModal(false)}
        onReload={load}
      />
      <VehicleCsvImporter
        open={showCsv}
        lang={lang}
        onImported={load}
        onClose={() => setShowCsv(false)}
      />
    </div>
  )
}
