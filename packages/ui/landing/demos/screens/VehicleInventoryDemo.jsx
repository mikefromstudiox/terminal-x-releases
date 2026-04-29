// VehicleInventoryDemo — faithful copy of dealership/VehicleInventory.jsx.
// Brutalist black/white style with sharp borders. Stock # · Vehicle · VIN ·
// Miles · Price · Status pill, edit/delete actions, KPI strip.

import { useState, useMemo } from 'react'
import { CarFront, Plus, Search, Pencil, Trash2, FileUp, X, Camera, Calendar } from 'lucide-react'

const STATUSES = [
  { v: 'available',  label: 'Disponible',  cls: 'bg-white text-black border-black' },
  { v: 'reserved',   label: 'Reservado',   cls: 'bg-black text-white border-black' },
  { v: 'sold',       label: 'Vendido',     cls: 'bg-[#b3001e] text-white border-[#b3001e]' },
  { v: 'in_service', label: 'En Servicio', cls: 'bg-white text-black border-black' },
]

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

function StatusPill({ status }) {
  const s = STATUSES.find(x => x.v === status) || STATUSES[0]
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold border ${s.cls}`}>{s.label}</span>
}

const SEED = [
  { id: 1, stock_number: 'STK-001', vin: '1HGCM82633A123456', make: 'Toyota',    model: 'Corolla XLE',    year: 2024, color: 'Blanco',  mileage: 12500, listing_price: 1450000, status: 'available' },
  { id: 2, stock_number: 'STK-002', vin: '2HGFE2F50JH543210', make: 'Honda',     model: 'Civic Sport',    year: 2023, color: 'Negro',   mileage: 18200, listing_price: 1380000, status: 'available' },
  { id: 3, stock_number: 'STK-003', vin: '5NPE34AF4FH002211', make: 'Hyundai',   model: 'Tucson Limited', year: 2024, color: 'Gris',    mileage: 8500,  listing_price: 2150000, status: 'reserved' },
  { id: 4, stock_number: 'STK-004', vin: '1FTEW1EP5KFC30401', make: 'Ford',      model: 'F-150 XLT',      year: 2022, color: 'Rojo',    mileage: 45200, listing_price: 2850000, status: 'available' },
  { id: 5, stock_number: 'STK-005', vin: 'JM3KFBDM7L0789012', make: 'Mazda',     model: 'CX-5 Touring',   year: 2024, color: 'Azul',    mileage: 6200,  listing_price: 1890000, status: 'in_service' },
  { id: 6, stock_number: 'STK-006', vin: 'KNDPM3ACXD7456789', make: 'Kia',       model: 'Sportage EX',    year: 2023, color: 'Plata',   mileage: 22100, listing_price: 1620000, status: 'available' },
  { id: 7, stock_number: 'STK-007', vin: '3N1AB7AP4LY567890', make: 'Nissan',    model: 'Sentra SR',      year: 2024, color: 'Blanco',  mileage: 4800,  listing_price: 1280000, status: 'sold' },
  { id: 8, stock_number: 'STK-008', vin: '1GNSKBKD8PR234567', make: 'Chevrolet', model: 'Tahoe LT',       year: 2023, color: 'Negro',   mileage: 32100, listing_price: 3450000, status: 'available' },
]

export default function VehicleInventoryDemo() {
  const [units]         = useState(SEED)
  const [query, setQuery]               = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [editing, setEditing]           = useState(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return units.filter(u => {
      if (filterStatus && u.status !== filterStatus) return false
      if (!q) return true
      return [u.stock_number, u.vin, u.make, u.model, u.color, String(u.year)].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [units, query, filterStatus])

  const totals = useMemo(() => {
    const avail = units.filter(u => u.status === 'available')
    return {
      available: avail.length,
      invValue:  avail.reduce((s, u) => s + Number(u.listing_price || 0), 0),
      soldCount: units.filter(u => u.status === 'sold').length,
    }
  }, [units])

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-black"><CarFront size={32} /> Inventario de Vehículos</h1>
          <p className="text-sm text-black/70 mt-1">Unidades en venta — distinto del inventario de piezas.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-4 py-2 border border-black inline-flex items-center gap-2 hover:bg-slate-50"><FileUp size={16} /> Importar CSV</button>
          <button onClick={() => setEditing({})} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2 hover:bg-slate-800"><Plus size={18} /> Nueva Unidad</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="border border-black p-4"><div className="text-xs font-semibold uppercase tracking-wider">Disponibles</div><div className="text-2xl font-bold mt-1">{totals.available}</div></div>
        <div className="border border-black p-4"><div className="text-xs font-semibold uppercase tracking-wider">Valor de Inventario</div><div className="text-2xl font-bold mt-1">{fmtRD(totals.invValue)}</div></div>
        <div className="border border-black p-4"><div className="text-xs font-semibold uppercase tracking-wider">Vendidos</div><div className="text-2xl font-bold mt-1">{totals.soldCount}</div></div>
      </div>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-2 top-2.5 text-black/40" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar VIN, stock, marca…"
            className="w-full pl-8 pr-3 py-2 border border-black focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-black px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#b3001e]">
          <option value="">Todos los estados</option>
          {STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
      </div>

      <div className="border border-black overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2 w-14"></th>
              <th className="text-left px-3 py-2">Stock</th>
              <th className="text-left px-3 py-2">Vehículo</th>
              <th className="text-left px-3 py-2">VIN</th>
              <th className="text-right px-3 py-2">KM</th>
              <th className="text-right px-3 py-2">Precio</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-t border-black/10 hover:bg-black/5">
                <td className="px-2 py-1"><div className="w-12 h-9 bg-black/5 border border-black/10 flex items-center justify-center"><CarFront size={14} className="text-black/30"/></div></td>
                <td className="px-3 py-2 font-mono">{u.stock_number}</td>
                <td className="px-3 py-2 font-semibold">{u.year} {u.make} {u.model} {u.color && <span className="text-black/60 font-normal">· {u.color}</span>}</td>
                <td className="px-3 py-2 font-mono text-xs">{u.vin}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(u.mileage).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtRD(u.listing_price)}</td>
                <td className="px-3 py-2"><StatusPill status={u.status} /></td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setEditing(u)} className="p-1 hover:bg-black hover:text-white mr-1"><Pencil size={14} /></button>
                  <button className="p-1 hover:bg-[#b3001e] hover:text-white"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white border border-black max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-black">
              <h2 className="text-xl font-bold">{editing.id ? `Editar ${editing.make} ${editing.model}` : 'Nueva Unidad'}</h2>
              <button onClick={() => setEditing(null)} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <label className="block col-span-2"><span className="text-xs font-semibold">Stock #</span><input defaultValue={editing.stock_number} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block col-span-2"><span className="text-xs font-semibold">VIN</span><input defaultValue={editing.vin} className="mt-1 w-full border border-black px-2 py-1.5 font-mono" /></label>
              <label className="block"><span className="text-xs font-semibold">Marca</span><input defaultValue={editing.make} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block"><span className="text-xs font-semibold">Modelo</span><input defaultValue={editing.model} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block"><span className="text-xs font-semibold">Año</span><input defaultValue={editing.year} type="number" className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block"><span className="text-xs font-semibold">Color</span><input defaultValue={editing.color} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block"><span className="text-xs font-semibold">KM</span><input defaultValue={editing.mileage} type="number" className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block"><span className="text-xs font-semibold">Precio Listado</span><input defaultValue={editing.listing_price} type="number" className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block col-span-2"><span className="text-xs font-semibold">Estado</span>
                <select defaultValue={editing.status || 'available'} className="mt-1 w-full border border-black px-2 py-1.5">{STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}</select>
              </label>
              <div className="col-span-2 border border-dashed border-black/30 p-6 text-center">
                <Camera size={28} className="mx-auto text-black/40" />
                <p className="text-xs mt-2 text-black/60">Arrastrar fotos aquí o hacer clic para subir</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-black">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-black hover:bg-slate-50">Cancelar</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-black text-white hover:bg-slate-800">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
