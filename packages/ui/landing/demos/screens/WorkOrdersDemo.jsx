// WorkOrdersDemo — mecánica work orders. Faithful match of real WorkOrders.jsx
// kanban: Cotización / Aprobada / En proceso / Lista / Cerrada. Each card
// shows placa, vehicle, mechanic, items, total, badges. WhatsApp send button
// for cotización awaiting client approval.

import { useState, useMemo } from 'react'
import { Plus, Car, Clock, MessageCircle, Wrench, Search, AlertCircle, Check, FileSignature } from 'lucide-react'

const SEED = [
  { id: 'WO-1042', plate: 'A123456', vehicle: 'Honda Civic 2022', client: 'Roberto Castillo', items: ['Cambio Aceite', 'Cambio Filtro Aire'], total: 2400, status: 'en_proceso',           bay: 'Bay 1', mecanico: 'Juan Reyes',     elapsedMin: 18 },
  { id: 'WO-1043', plate: 'B789012', vehicle: 'Toyota Corolla',   client: 'Maria Sanchez',    items: ['Diagnostico Motor', 'Cambio Bujias'],  total: 4000, status: 'en_proceso',           bay: 'Bay 2', mecanico: 'Carlos Diaz',    elapsedMin: 52 },
  { id: 'WO-1044', plate: 'C345678', vehicle: 'Hyundai Tucson',   client: 'Walk-in',          items: ['Alineacion + Balanceo'],               total: 2800, status: 'cotizacion',          bay: '—',     mecanico: '—',              elapsedMin: 0 },
  { id: 'WO-1045', plate: 'D901234', vehicle: 'Ford F-150',       client: 'Empresa Logistics', items: ['Cambio Pastillas', 'Rectificar Discos'], total: 8000, status: 'aprobada',          bay: 'Bay 3', mecanico: 'Pedro Almonte',  elapsedMin: 0 },
  { id: 'WO-1046', plate: 'E567890', vehicle: 'Mazda CX-5',       client: 'Ana Reyes',        items: ['Cambio Banda Distribucion'],           total: 12500, status: 'esperando_aprobacion', bay: '—',    mecanico: '—',              elapsedMin: 0 },
  { id: 'WO-1041', plate: 'F234567', vehicle: 'Kia Sportage',     client: 'Pedro Vasquez',    items: ['Mantenimiento 50K', 'Cambio Liquido Frenos'], total: 5200, status: 'lista',         bay: 'Bay 4', mecanico: 'Juan Reyes',     elapsedMin: 145 },
  { id: 'WO-1040', plate: 'G890123', vehicle: 'Nissan Sentra',    client: 'Lucia Almonte',    items: ['Cambio Aceite'],                       total: 1200, status: 'cerrada',             bay: '—',     mecanico: 'Carlos Diaz',    elapsedMin: 0 },
]

const COLS = [
  { id: 'cotizacion',           label: 'Cotización',         pill: 'bg-slate-100 text-slate-600 border-slate-200',         border: 'border-l-slate-400' },
  { id: 'esperando_aprobacion', label: 'Esperando cliente',  pill: 'bg-amber-100 text-amber-700 border-amber-200',         border: 'border-l-amber-500' },
  { id: 'aprobada',             label: 'Aprobada',           pill: 'bg-sky-100 text-sky-700 border-sky-200',               border: 'border-l-sky-500' },
  { id: 'en_proceso',           label: 'En Proceso',         pill: 'bg-blue-100 text-blue-700 border-blue-200',            border: 'border-l-blue-500' },
  { id: 'lista',                label: 'Lista',              pill: 'bg-emerald-100 text-emerald-700 border-emerald-200',   border: 'border-l-emerald-500' },
  { id: 'cerrada',              label: 'Cerrada',            pill: 'bg-zinc-100 text-zinc-500 border-zinc-200',            border: 'border-l-zinc-400' },
]

function fmtRD(n) { return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

export default function WorkOrdersDemo() {
  const [orders, setOrders] = useState(SEED)
  const [search, setSearch] = useState('')

  const grouped = useMemo(() => {
    const g = {}
    COLS.forEach(c => { g[c.id] = [] })
    const q = search.trim().toLowerCase()
    orders.filter(o => !q || o.plate.toLowerCase().includes(q) || o.client.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
      .forEach(o => { (g[o.status] || (g[o.status] = [])).push(o) })
    return g
  }, [orders, search])

  function advance(id) {
    setOrders(os => os.map(o => {
      if (o.id !== id) return o
      const idx = COLS.findIndex(c => c.id === o.status)
      const next = COLS[Math.min(COLS.length - 1, idx + 1)]?.id || o.status
      return { ...o, status: next }
    }))
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Wrench size={18} className="text-[#b3001e]" />
          <h1 className="text-[16px] font-bold text-slate-800">Órdenes de Trabajo</h1>
          <span className="text-[12px] text-slate-500">· {orders.length} ordenes activas</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-sky-400 w-56">
            <Search size={13} className="text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar placa o cliente..." className="flex-1 text-[12px] bg-transparent outline-none" />
          </div>
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold bg-[#b3001e] hover:bg-[#8c0017] text-white"><Plus size={13} /> Nueva orden</button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="grid h-full gap-3 p-3 min-w-[1200px]" style={{ gridTemplateColumns: `repeat(${COLS.length}, minmax(0, 1fr))` }}>
          {COLS.map(col => {
            const cards = grouped[col.id] || []
            return (
              <div key={col.id} className="flex flex-col bg-white rounded-2xl border border-slate-200 min-h-0">
                <div className="shrink-0 px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-slate-700">{col.label}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${col.pill}`}>{cards.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {cards.map(o => (
                    <div key={o.id} className={`rounded-xl bg-slate-50 border-l-4 border-y border-r border-slate-100 ${col.border} p-3 hover:bg-white hover:shadow-md transition-all`}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Car size={14} className="text-slate-400" />
                          <div>
                            <p className="text-[12px] font-bold text-slate-800 tracking-wide">{o.plate}</p>
                            <p className="text-[10px] text-slate-500 truncate">{o.vehicle}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">{o.id}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mb-2 truncate">{o.client}</p>
                      <ul className="space-y-0.5 mb-2 pb-2 border-b border-dashed border-slate-200">
                        {o.items.slice(0, 2).map((it, i) => <li key={i} className="text-[11px] text-slate-700 truncate">· {it}</li>)}
                        {o.items.length > 2 && <li className="text-[10px] text-slate-400">+{o.items.length - 2} mas</li>}
                      </ul>
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] text-slate-500">
                          {o.bay !== '—' && <span className="font-bold text-slate-700">{o.bay}</span>}
                          {o.mecanico !== '—' && <span> · {o.mecanico.split(' ')[0]}</span>}
                          {o.elapsedMin > 0 && <span className="ml-1 inline-flex items-center gap-0.5"><Clock size={9} /> {o.elapsedMin}m</span>}
                        </div>
                        <span className="text-[12px] font-black text-[#b3001e] tabular-nums">{fmtRD(o.total)}</span>
                      </div>

                      {o.status === 'esperando_aprobacion' && (
                        <button className="w-full mt-2 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold inline-flex items-center justify-center gap-1.5">
                          <MessageCircle size={11} /> Enviar cotización por WhatsApp
                        </button>
                      )}
                      {o.status === 'cotizacion' && (
                        <button onClick={() => advance(o.id)} className="w-full mt-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-bold inline-flex items-center justify-center gap-1.5">
                          <FileSignature size={11} /> Enviar a cliente
                        </button>
                      )}
                      {(o.status === 'aprobada' || o.status === 'en_proceso') && (
                        <button onClick={() => advance(o.id)} className="w-full mt-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold">
                          {o.status === 'aprobada' ? 'Empezar trabajo' : 'Marcar lista'}
                        </button>
                      )}
                      {o.status === 'lista' && (
                        <button onClick={() => advance(o.id)} className="w-full mt-2 py-1.5 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-[11px] font-bold">Cobrar y cerrar</button>
                      )}
                    </div>
                  ))}
                  {cards.length === 0 && <p className="text-center text-[11px] text-slate-300 py-4">Sin ordenes</p>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
