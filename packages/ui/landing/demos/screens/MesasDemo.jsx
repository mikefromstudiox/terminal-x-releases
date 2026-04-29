// MesasDemo — faithful copy of packages/ui/screens/restaurant/Mesas.jsx.
// Same dark zinc-900 theme + red status tint. State is local; api.mesas.*
// stripped to setState. Modals retained for click interactivity.

import { useState, useEffect, useMemo } from 'react'
import { Plus, Users, User, Clock, MoreVertical, Edit2, Trash2, Check, X, AlertCircle } from 'lucide-react'

const STATUS = {
  libre:     { label: 'Libre',     chip: 'bg-green-500/15 text-green-400 border-green-500/30',  ring: 'border-green-500/40 hover:border-green-500/70',  dot: 'bg-green-500' },
  ocupada:   { label: 'Ocupada',   chip: 'bg-red-600/15  text-red-400  border-red-600/30',     ring: 'border-red-600/50 hover:border-red-600/80',       dot: 'bg-red-500'   },
  sucia:     { label: 'Sucia',     chip: 'bg-amber-500/15 text-amber-400 border-amber-500/30',  ring: 'border-amber-500/40 hover:border-amber-500/70',  dot: 'bg-amber-500' },
  reservada: { label: 'Reservada', chip: 'bg-blue-500/15 text-blue-400 border-blue-500/30',     ring: 'border-blue-500/40 hover:border-blue-500/70',     dot: 'bg-blue-500'  },
}
const STATUS_ORDER = ['libre', 'ocupada', 'sucia', 'reservada']

function elapsedMinutes(seatedAt, now) {
  if (!seatedAt) return 0
  const t = seatedAt instanceof Date ? seatedAt.getTime() : new Date(seatedAt).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 60000))
}
function fmtElapsed(mins) {
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function MesaCard({ mesa, now, onClick }) {
  const s = STATUS[mesa.status] || STATUS.libre
  const mins = mesa.status === 'ocupada' ? elapsedMinutes(mesa.seated_at, now) : 0
  return (
    <button onClick={onClick} className={`group relative text-left bg-zinc-900 rounded-2xl p-4 border transition-all ${s.ring} hover:-translate-y-0.5`}>
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <div className="text-xl font-bold text-white truncate">{mesa.name}</div>
          {mesa.zone && <div className="text-xs text-white/50 truncate mt-0.5">{mesa.zone}</div>}
        </div>
        <MoreVertical size={16} className="text-white/30 group-hover:text-white/60 shrink-0" />
      </div>
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold ${s.chip}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
        {s.label}
        {mesa.status === 'ocupada' && mesa.seated_at && (
          <span className="ml-1 flex items-center gap-0.5 text-[10px] opacity-80"><Clock size={10} />{fmtElapsed(mins)}</span>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[12px] text-white/60"><Users size={12} /><span>Capacidad {mesa.capacity ?? 0}</span></div>
        {mesa.status === 'ocupada' && mesa.guests_count && <div className="flex items-center gap-1.5 text-[12px] text-white/80"><Users size={12} /><span>{mesa.guests_count} comensales</span></div>}
        {mesa.waiter && <div className="flex items-center gap-1.5 text-[12px] text-white/60 truncate"><User size={12} /><span className="truncate">{mesa.waiter}</span></div>}
      </div>
    </button>
  )
}

function ActionSheet({ mesa, onClose, onSetStatus }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end md:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h3 className="font-bold text-white">{mesa.name}</h3>
            {mesa.zone && <p className="text-xs text-white/50 mt-0.5">{mesa.zone}</p>}
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-2">
          {STATUS_ORDER.filter(s => s !== mesa.status).map(s => {
            const meta = STATUS[s]
            return (
              <button key={s} onClick={() => onSetStatus(s)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800 text-left transition-colors">
                <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <span className="text-sm font-semibold text-white">Marcar como {meta.label}</span>
              </button>
            )
          })}
          <div className="flex gap-2 pt-2">
            <button className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-zinc-800 text-white/80 hover:bg-zinc-800 text-sm font-semibold"><Edit2 size={14} /> Editar</button>
            <button className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-red-400 hover:bg-red-600/10 text-sm font-semibold"><Trash2 size={14} /> Eliminar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const SEED = [
  { id: 1,  name: 'Mesa 1', zone: 'Salón',  capacity: 4, status: 'libre' },
  { id: 2,  name: 'Mesa 2', zone: 'Salón',  capacity: 4, status: 'ocupada', guests_count: 3, seated_at: new Date(Date.now() - 32 * 60_000), waiter: 'Carlos' },
  { id: 3,  name: 'Mesa 3', zone: 'Salón',  capacity: 6, status: 'ocupada', guests_count: 5, seated_at: new Date(Date.now() - 18 * 60_000), waiter: 'Maria' },
  { id: 4,  name: 'Mesa 4', zone: 'Salón',  capacity: 2, status: 'libre' },
  { id: 5,  name: 'Mesa 5', zone: 'Salón',  capacity: 4, status: 'reservada' },
  { id: 6,  name: 'Mesa 6', zone: 'Salón',  capacity: 8, status: 'ocupada', guests_count: 7, seated_at: new Date(Date.now() - 65 * 60_000), waiter: 'Carlos' },
  { id: 7,  name: 'Mesa 7', zone: 'Terraza', capacity: 4, status: 'libre' },
  { id: 8,  name: 'Mesa 8', zone: 'Terraza', capacity: 2, status: 'sucia' },
  { id: 9,  name: 'Bar 1',  zone: 'Bar',     capacity: 2, status: 'ocupada', guests_count: 2, seated_at: new Date(Date.now() - 14 * 60_000), waiter: 'Bar' },
  { id: 10, name: 'Bar 2',  zone: 'Bar',     capacity: 2, status: 'libre' },
  { id: 11, name: 'Terraza 1', zone: 'Terraza', capacity: 6, status: 'ocupada', guests_count: 5, seated_at: new Date(Date.now() - 42 * 60_000), waiter: 'Pedro' },
  { id: 12, name: 'Terraza 2', zone: 'Terraza', capacity: 6, status: 'libre' },
]

export default function MesasDemo() {
  const [mesas, setMesas]     = useState(SEED)
  const [actionOn, setActionOn] = useState(null)
  const [now, setNow]         = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const counts = useMemo(() => {
    const c = { libre: 0, ocupada: 0, sucia: 0, reservada: 0 }
    for (const m of mesas) if (c[m.status] != null) c[m.status]++
    return c
  }, [mesas])

  function setStatus(mesa, status) {
    setMesas(ms => ms.map(m => m.id === mesa.id ? { ...m, status, ...(status === 'ocupada' ? { seated_at: new Date(), guests_count: 2, waiter: 'Carlos' } : { seated_at: null, guests_count: 0 }) } : m))
    setActionOn(null)
  }

  return (
    <div className="min-h-full h-full overflow-y-auto bg-black text-white">
      <div className="border-b border-zinc-800 bg-zinc-900/40 sticky top-0 z-10 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Mesas</h1>
            <p className="text-xs text-white/50 mt-0.5">{mesas.length} mesas activas</p>
          </div>
          <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">
            <Plus size={16} /> Nueva Mesa
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {STATUS_ORDER.map(k => {
            const s = STATUS[k]
            return (
              <div key={k} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${s.dot}`} /><span className="text-xs font-semibold uppercase tracking-wide text-white/60">{s.label}</span></div>
                <div className="text-2xl font-bold text-white mt-1">{counts[k] || 0}</div>
              </div>
            )
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {mesas.map(m => <MesaCard key={m.id} mesa={m} now={now} onClick={() => setActionOn(m)} />)}
        </div>
      </div>

      {actionOn && <ActionSheet mesa={actionOn} onClose={() => setActionOn(null)} onSetStatus={s => setStatus(actionOn, s)} />}
    </div>
  )
}
