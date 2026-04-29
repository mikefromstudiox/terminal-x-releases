// InventoryDemo — faithful copy of Inventory.jsx render. Header + 4 KPI tiles
// + Items/Quiebres tabs + filter pills + table with low-stock warning, margin
// %, PY Precio (Pedidos Ya delivery).

import { useState, useMemo } from 'react'
import { Package, Plus, Search, Trash2, Tags, Upload, RefreshCw, AlertTriangle, TrendingDown, Edit2, X } from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

const SEED = [
  { id: 1,  name: 'Arroz 5 lb',           sku: 'SKU-0001', category: 'Alimentos', quantity: 124, min_quantity: 20, cost: 280,  price: 350,  py_price: 385,  supplier: 'Distribuidora RD' },
  { id: 2,  name: 'Aceite Girasol 1L',    sku: 'SKU-0003', category: 'Alimentos', quantity: 8,   min_quantity: 12, cost: 220,  price: 285,  py_price: 320,  supplier: 'Mayorista Caribe' },
  { id: 3,  name: 'Coca Cola 2L',         sku: 'SKU-0021', category: 'Bebidas',   quantity: 67,  min_quantity: 15, cost: 95,   price: 130,  py_price: 145,  supplier: 'Bepensa' },
  { id: 4,  name: 'Detergente 1 kg',      sku: 'SKU-0030', category: 'Limpieza',  quantity: 4,   min_quantity: 10, cost: 130,  price: 175,  py_price: 195,  supplier: 'Hogar Plus' },
  { id: 5,  name: 'Papel Higiénico 4u',   sku: 'SKU-0040', category: 'Higiene',   quantity: 89,  min_quantity: 20, cost: 110,  price: 165,  py_price: 185,  supplier: 'Hogar Plus' },
  { id: 6,  name: 'Mantequilla 1 lb',     sku: 'SKU-0008', category: 'Lácteos',   quantity: 22,  min_quantity: 8,  cost: 175,  price: 240,  py_price: 265,  supplier: 'Lacteos del Norte' },
  { id: 7,  name: 'Pollo Entero 1 lb',    sku: 'SKU-0089', category: 'Carnes',    quantity: 42,  min_quantity: 15, cost: 65,   price: 95,   py_price: 110,  supplier: 'Pollos del Cibao' },
  { id: 8,  name: 'Leche 1L',             sku: 'SKU-0023', category: 'Lácteos',   quantity: 6,   min_quantity: 12, cost: 78,   price: 110,  py_price: 125,  supplier: 'Lacteos del Norte' },
  { id: 9,  name: 'Azúcar 5 lb',          sku: 'SKU-0004', category: 'Alimentos', quantity: 53,  min_quantity: 15, cost: 165,  price: 220,  py_price: 245,  supplier: 'Distribuidora RD' },
  { id: 10, name: 'Cerveza Presidente x6', sku: 'SKU-0401', category: 'Bebidas',   quantity: 18,  min_quantity: 6,  cost: 285,  price: 380,  py_price: 425,  supplier: 'Bepensa' },
  { id: 11, name: 'Pasta Espagueti',      sku: 'SKU-0006', category: 'Alimentos', quantity: 78,  min_quantity: 20, cost: 50,   price: 75,   py_price: 85,   supplier: 'Distribuidora RD' },
  { id: 12, name: 'Salsa Tomate',         sku: 'SKU-0007', category: 'Alimentos', quantity: 31,  min_quantity: 10, cost: 42,   price: 65,   py_price: 75,   supplier: 'Distribuidora RD' },
]

const SHORTAGES = [
  { id: 1, item: 'Aceite Girasol 1L',   needed: 4,  reason: 'Promo de fin de mes', status: 'open', date: '2026-04-26' },
  { id: 2, item: 'Detergente 1 kg',     needed: 6,  reason: 'Stock mínimo bajo',   status: 'open', date: '2026-04-25' },
  { id: 3, item: 'Leche 1L',            needed: 6,  reason: 'Cliente VIP esperando', status: 'open', date: '2026-04-27' },
  { id: 4, item: 'Mantequilla 1 lb',    needed: 0,  reason: 'Resuelto · entrega martes', status: 'closed', date: '2026-04-23' },
]

export default function InventoryDemo() {
  const [items]            = useState(SEED)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [tab, setTab]       = useState('items')
  const [editing, setEditing] = useState(null)

  const filtered = useMemo(() => {
    let list = items
    if (filter === 'low') list = list.filter(i => i.quantity <= i.min_quantity)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
    }
    return list
  }, [items, search, filter])

  const lowCount    = items.filter(i => i.quantity <= i.min_quantity).length
  const totalValue  = items.reduce((s, i) => s + (i.quantity * i.price), 0)
  const totalCost   = items.reduce((s, i) => s + (i.quantity * i.cost), 0)
  const totalProfit = totalValue - totalCost

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 h-full overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-3">
          <Package size={20} className="text-slate-500" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800">Inventario</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="flex items-center gap-2 px-3 py-2 border border-red-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50"><Trash2 size={15} /> Borrar Todo</button>
          <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50"><Tags size={15} className="text-[#b3001e]" /> Organizar</button>
          <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50"><Upload size={15} /> Importar CSV</button>
          <button onClick={() => setEditing({})} className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800"><Plus size={15} /> Agregar item</button>
        </div>
      </div>

      <div className="px-3 md:px-6 pt-3 flex items-center gap-1 shrink-0">
        <button onClick={() => setTab('items')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'items' ? 'bg-black text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
          <Package size={14} /> Productos
        </button>
        <button onClick={() => setTab('shortages')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'shortages' ? 'bg-black text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
          <TrendingDown size={14} /> Quiebres de stock
        </button>
      </div>

      {tab === 'shortages' ? (
        <div className="flex-1 overflow-auto px-3 md:px-6 py-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <tr><th className="text-left px-4 py-2.5">Producto</th><th className="text-right px-4 py-2.5">Necesario</th><th className="text-left px-4 py-2.5">Razón</th><th className="text-left px-4 py-2.5">Fecha</th><th className="text-right px-4 py-2.5">Estado</th></tr>
              </thead>
              <tbody>
                {SHORTAGES.map(s => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-semibold text-slate-800">{s.item}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">{s.needed}</td>
                    <td className="px-4 py-3 text-slate-600">{s.reason}</td>
                    <td className="px-4 py-3 text-slate-500">{s.date}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${s.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{s.status === 'open' ? 'Abierto' : 'Cerrado'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
            {[
              { label: 'Total items',         value: items.length,         color: 'text-slate-700' },
              { label: 'Stock bajo',          value: lowCount,             color: lowCount > 0 ? 'text-amber-600' : 'text-slate-700' },
              { label: 'Valor en stock',      value: fmtRD(totalValue),    color: 'text-slate-700' },
              { label: 'Ganancia potencial',  value: fmtRD(totalProfit),   color: 'text-emerald-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-400 mb-1">{label}</p>
                <p className={`text-[18px] font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="px-6 pb-3 flex items-center gap-3 shrink-0 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-400 flex-1 max-w-xs">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, SKU, categoría…"
                className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400" />
            </div>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
              {[['all', 'Todos'], ['low', `Stock bajo (${lowCount})`]].map(([v, label]) => (
                <button key={v} onClick={() => setFilter(v)} className={`px-4 py-1.5 font-medium transition ${filter === v ? 'bg-black text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{label}</button>
              ))}
            </div>
            <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors"><RefreshCw size={14} /></button>
          </div>

          <div className="flex-1 overflow-auto px-6 pb-6">
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="hidden md:table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Categoría</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Stock</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Costo</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Precio</th>
                    <th className="px-4 py-3 text-xs font-semibold text-[#b3001e] uppercase tracking-wide text-right whitespace-nowrap">PY Precio</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Margen</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Valor</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => {
                    const isLow = item.quantity <= item.min_quantity
                    const margin = ((item.price - item.cost) / item.price) * 100
                    return (
                      <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{item.name}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{item.sku}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{item.category}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold text-base ${isLow ? 'text-amber-600' : 'text-slate-700'}`}>{item.quantity}</span>
                          {isLow && <AlertTriangle size={11} className="inline ml-1 text-amber-600" />}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtRD(item.cost)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-700">{fmtRD(item.price)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#b3001e] font-semibold">{fmtRD(item.py_price)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-semibold">{margin.toFixed(0)}%</td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">{fmtRD(item.quantity * item.price)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => setEditing(item)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Edit2 size={13} /></button>
                          <button className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-slate-800">{editing.id ? 'Editar producto' : 'Nuevo producto'}</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-3">
              <label className="block col-span-2"><span className="text-xs font-semibold text-slate-500">Nombre *</span><input defaultValue={editing.name} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">SKU</span><input defaultValue={editing.sku} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:border-blue-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Categoría</span><input defaultValue={editing.category} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Stock</span><input type="number" defaultValue={editing.quantity} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Stock mínimo</span><input type="number" defaultValue={editing.min_quantity} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Costo</span><input type="number" defaultValue={editing.cost} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Precio</span><input type="number" defaultValue={editing.price} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 outline-none" /></label>
              <label className="block col-span-2"><span className="text-xs font-semibold text-[#b3001e]">PY Precio (Pedidos Ya)</span><input type="number" defaultValue={editing.py_price} className="mt-1 w-full border border-[#b3001e]/30 rounded-lg px-3 py-2 text-sm focus:border-[#b3001e] outline-none" /></label>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-black text-white rounded-lg text-sm font-bold hover:bg-slate-800">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
