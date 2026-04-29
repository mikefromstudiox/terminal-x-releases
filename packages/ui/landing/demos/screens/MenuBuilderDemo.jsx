// MenuBuilderDemo — faithful copy of restaurant/MenuBuilder.jsx render.
// Dark-themed (zinc-900 / black) with red-accent header. 3 tabs: Categorias /
// Items / Modificadores. Each tab is a faithful list-with-modal pattern.

import { useState } from 'react'
import { UtensilsCrossed, Tag, Settings2, Plus, Edit2, Trash2, X, Check, GripVertical, Image as ImageIcon, AlertCircle, Search } from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

const CATEGORIES = [
  { id: 1, nombre: 'Entradas',      orden: 1, items_count: 4 },
  { id: 2, nombre: 'Plato Fuerte',  orden: 2, items_count: 6 },
  { id: 3, nombre: 'Postres',       orden: 3, items_count: 3 },
  { id: 4, nombre: 'Bebidas',       orden: 4, items_count: 4 },
  { id: 5, nombre: 'Vinos',         orden: 5, items_count: 3 },
]

const ITEMS = [
  { id: 1,  nombre: 'Tostones con Queso',     categoria: 'Entradas',     price: 285,  cost: 95,   prep_time: 5,  modifiers: 1, in_stock: true },
  { id: 2,  nombre: 'Empanadas (3 ud)',       categoria: 'Entradas',     price: 245,  cost: 75,   prep_time: 8,  modifiers: 0, in_stock: true },
  { id: 3,  nombre: 'Pollo Guisado',          categoria: 'Plato Fuerte', price: 485,  cost: 165,  prep_time: 15, modifiers: 2, in_stock: true },
  { id: 4,  nombre: 'Mofongo con Camarones',  categoria: 'Plato Fuerte', price: 895,  cost: 320,  prep_time: 20, modifiers: 1, in_stock: true },
  { id: 5,  nombre: 'Bistec Encebollado',     categoria: 'Plato Fuerte', price: 685,  cost: 240,  prep_time: 18, modifiers: 1, in_stock: true },
  { id: 6,  nombre: 'Pescado Frito',          categoria: 'Plato Fuerte', price: 785,  cost: 285,  prep_time: 20, modifiers: 0, in_stock: false },
  { id: 7,  nombre: 'Tres Leches',            categoria: 'Postres',      price: 195,  cost: 45,   prep_time: 2,  modifiers: 0, in_stock: true },
  { id: 8,  nombre: 'Refresco 12oz',          categoria: 'Bebidas',      price: 85,   cost: 30,   prep_time: 1,  modifiers: 0, in_stock: true },
  { id: 9,  nombre: 'Cerveza Presidente',     categoria: 'Bebidas',      price: 165,  cost: 70,   prep_time: 1,  modifiers: 0, in_stock: true },
  { id: 10, nombre: 'Vino Tinto Copa',        categoria: 'Vinos',        price: 285,  cost: 110,  prep_time: 1,  modifiers: 0, in_stock: true },
]

const MODIFIERS = [
  { id: 1, nombre: 'Punto de cocción',  required: true,  multi: false, options: [{ name: 'Bien cocido' }, { name: 'Tres cuartos' }, { name: 'Medio' }, { name: 'Crudo' }], assigned: 3 },
  { id: 2, nombre: 'Acompañamiento',    required: false, multi: true,  options: [{ name: 'Tostones', delta: 0 }, { name: 'Maduros', delta: 0 }, { name: 'Yuca', delta: 50 }, { name: 'Arroz blanco', delta: 0 }], assigned: 4 },
  { id: 3, nombre: 'Tipo de pan',       required: true,  multi: false, options: [{ name: 'Telera' }, { name: 'Integral', delta: 30 }, { name: 'Sin pan' }], assigned: 2 },
  { id: 4, nombre: 'Hielo',             required: false, multi: false, options: [{ name: 'Con hielo' }, { name: 'Sin hielo' }], assigned: 5 },
]

function CategoryTab() {
  const [editing, setEditing] = useState(null)
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Categorías del menú</h2>
          <p className="text-xs text-white/50 mt-0.5">{CATEGORIES.length} categorías · arrastra para reordenar</p>
        </div>
        <button onClick={() => setEditing({})} className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold inline-flex items-center gap-1.5"><Plus size={14} /> Nueva categoría</button>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {CATEGORIES.map((c, i) => (
          <div key={c.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-zinc-800' : ''} hover:bg-zinc-800/50 group`}>
            <GripVertical size={14} className="text-white/20 group-hover:text-white/60 cursor-grab" />
            <span className="text-xs text-white/40 w-6 tabular-nums">#{c.orden}</span>
            <p className="font-semibold flex-1">{c.nombre}</p>
            <span className="text-xs text-white/50 mr-3">{c.items_count} items</span>
            <button onClick={() => setEditing(c)} className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded"><Edit2 size={13} /></button>
            <button className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-zinc-900 border border-zinc-800 max-w-md w-full rounded-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-zinc-800">
              <h3 className="font-bold text-white">{editing.id ? 'Editar categoría' : 'Nueva categoría'}</h3>
              <button onClick={() => setEditing(null)} className="p-1 hover:bg-white/10 rounded text-white/60"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <label className="block"><span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Nombre *</span><input defaultValue={editing.nombre} className="mt-1 w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-red-500 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Orden</span><input type="number" defaultValue={editing.orden || CATEGORIES.length + 1} className="mt-1 w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-red-500 outline-none" /></label>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-zinc-800">
              <button onClick={() => setEditing(null)} className="px-3 py-2 border border-zinc-700 text-white/70 rounded text-sm hover:bg-white/5">Cancelar</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-red-600 text-white rounded text-sm font-bold hover:bg-red-700">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ItemsTab() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [catFilter, setCat] = useState('all')

  const filtered = ITEMS.filter(it => {
    if (catFilter !== 'all' && it.categoria !== catFilter) return false
    if (search.trim() && !it.nombre.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold">Items del menú</h2>
          <p className="text-xs text-white/50 mt-0.5">{ITEMS.length} platos · {ITEMS.filter(i => !i.in_stock).length} en 86</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={catFilter} onChange={e => setCat(e.target.value)} className="bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm rounded">
            <option value="all">Todas las categorías</option>
            {CATEGORIES.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
          </select>
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg w-52">
            <Search size={13} className="text-white/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar plato..." className="flex-1 text-sm bg-transparent outline-none text-white placeholder:text-white/30" />
          </div>
          <button onClick={() => setEditing({})} className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold inline-flex items-center gap-1.5"><Plus size={14} /> Nuevo</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(it => (
          <button key={it.id} onClick={() => setEditing(it)} className={`text-left bg-zinc-900 border ${it.in_stock ? 'border-zinc-800 hover:border-red-600' : 'border-amber-700/40'} rounded-xl p-4 transition-colors`}>
            <div className="flex items-start gap-3 mb-2">
              <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center"><ImageIcon size={18} className="text-white/30" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white truncate">{it.nombre}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider mt-0.5">{it.categoria}</p>
              </div>
              {!it.in_stock && <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">86</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-zinc-800 text-[11px]">
              <div><p className="text-white/40 uppercase tracking-wider">Precio</p><p className="font-bold text-red-400 tabular-nums">{fmtRD(it.price)}</p></div>
              <div><p className="text-white/40 uppercase tracking-wider">Costo</p><p className="font-bold text-white/80 tabular-nums">{fmtRD(it.cost)}</p></div>
              <div><p className="text-white/40 uppercase tracking-wider">Margen</p><p className="font-bold text-emerald-400 tabular-nums">{Math.round(((it.price - it.cost) / it.price) * 100)}%</p></div>
            </div>
            {it.modifiers > 0 && <p className="text-[10px] text-white/50 mt-2 inline-flex items-center gap-1"><Settings2 size={9} /> {it.modifiers} modificadores</p>}
          </button>
        ))}
      </div>
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-zinc-900 border border-zinc-800 max-w-2xl w-full rounded-xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-zinc-800">
              <h3 className="font-bold text-white">{editing.id ? `Editar ${editing.nombre}` : 'Nuevo item del menú'}</h3>
              <button onClick={() => setEditing(null)} className="p-1 hover:bg-white/10 rounded text-white/60"><X size={18} /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <label className="block col-span-2"><span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Nombre *</span><input defaultValue={editing.nombre} className="mt-1 w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-red-500 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Categoría</span>
                <select defaultValue={editing.categoria} className="mt-1 w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm text-white">{CATEGORIES.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}</select>
              </label>
              <label className="block"><span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Tiempo prep (min)</span><input type="number" defaultValue={editing.prep_time} className="mt-1 w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-red-500 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Precio venta RD$</span><input type="number" defaultValue={editing.price} className="mt-1 w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-red-500 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Costo RD$</span><input type="number" defaultValue={editing.cost} className="mt-1 w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:border-red-500 outline-none" /></label>
              <label className="block col-span-2"><span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Foto</span>
                <div className="mt-1 border-2 border-dashed border-zinc-700 rounded-lg p-6 text-center"><ImageIcon size={28} className="mx-auto text-white/30" /><p className="text-xs text-white/50 mt-2">Arrastra imagen o clic para subir</p></div>
              </label>
              <label className="flex items-center gap-2 col-span-2 text-sm text-white/80"><input type="checkbox" defaultChecked={editing.in_stock !== false} className="accent-red-600" /> En stock (mostrar en menú)</label>
              <div className="col-span-2 border border-zinc-800 rounded-lg p-3">
                <p className="text-xs font-bold text-white/60 uppercase tracking-wide mb-2 inline-flex items-center gap-1.5"><Settings2 size={12} /> Modificadores asignados</p>
                <div className="flex flex-wrap gap-1.5">
                  {MODIFIERS.slice(0, 2).map(m => (
                    <span key={m.id} className="text-[11px] font-semibold bg-red-600/20 border border-red-600/40 text-red-300 px-2 py-0.5 rounded">{m.nombre}</span>
                  ))}
                  <button className="text-[11px] font-semibold border border-zinc-700 text-white/70 px-2 py-0.5 rounded hover:bg-white/5">+ Agregar</button>
                </div>
              </div>
            </div>
            <div className="flex justify-between p-5 border-t border-zinc-800">
              <button className="text-sm text-red-400 hover:bg-red-500/10 px-3 py-2 rounded inline-flex items-center gap-1.5"><Trash2 size={13} /> Eliminar</button>
              <div className="flex gap-2">
                <button onClick={() => setEditing(null)} className="px-3 py-2 border border-zinc-700 text-white/70 rounded text-sm hover:bg-white/5">Cancelar</button>
                <button onClick={() => setEditing(null)} className="px-4 py-2 bg-red-600 text-white rounded text-sm font-bold hover:bg-red-700">Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ModifiersTab() {
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Modificadores</h2>
          <p className="text-xs text-white/50 mt-0.5">Variantes y add-ons aplicables a items del menú</p>
        </div>
        <button className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold inline-flex items-center gap-1.5"><Plus size={14} /> Nuevo modificador</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {MODIFIERS.map(m => (
          <div key={m.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-red-600 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-bold text-white">{m.nombre}</p>
                <div className="flex items-center gap-2 mt-1">
                  {m.required && <span className="text-[9px] font-bold uppercase tracking-wider bg-red-600/15 text-red-400 border border-red-600/30 px-1.5 py-0.5 rounded">Obligatorio</span>}
                  <span className="text-[9px] font-bold uppercase tracking-wider bg-white/5 text-white/60 border border-zinc-700 px-1.5 py-0.5 rounded">{m.multi ? 'Multi-selección' : 'Selección única'}</span>
                </div>
              </div>
              <button className="text-white/40 hover:text-white p-1"><Edit2 size={13} /></button>
            </div>
            <div className="space-y-1 mt-3 pt-3 border-t border-zinc-800">
              {m.options.map((o, i) => (
                <div key={i} className="flex items-center justify-between text-[12px]">
                  <span className="text-white/80">· {o.name}</span>
                  {o.delta > 0 && <span className="text-red-400 font-bold">+{fmtRD(o.delta)}</span>}
                </div>
              ))}
            </div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider mt-3 pt-3 border-t border-zinc-800">Asignado a {m.assigned} platos</div>
          </div>
        ))}
      </div>
    </>
  )
}

export default function MenuBuilderDemo() {
  const [tab, setTab] = useState('items')
  const tabs = [
    { id: 'categorias',    label: 'Categorías',     icon: Tag },
    { id: 'items',         label: 'Items del Menú', icon: UtensilsCrossed },
    { id: 'modificadores', label: 'Modificadores',  icon: Settings2 },
  ]
  return (
    <div className="min-h-full h-full overflow-y-auto bg-black text-white">
      <div className="px-6 pt-6 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/30 flex items-center justify-center"><UtensilsCrossed size={20} className="text-red-500" /></div>
          <div>
            <h1 className="text-2xl font-bold">Menú</h1>
            <p className="text-xs text-white/50">Categorías, platos y modificadores</p>
          </div>
        </div>
      </div>
      <div className="px-6 pt-4 flex gap-1 border-b border-zinc-800">
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg flex items-center gap-2 transition ${active ? 'bg-zinc-900 text-white border border-zinc-800 border-b-transparent -mb-px' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
              <Icon size={15} />
              {t.label}
            </button>
          )
        })}
      </div>
      <div className="p-6">
        {tab === 'categorias'    && <CategoryTab />}
        {tab === 'items'         && <ItemsTab />}
        {tab === 'modificadores' && <ModifiersTab />}
      </div>
    </div>
  )
}
