// KDSDemo — Kitchen Display System. Faithful style match to the real KDS:
// dark background, three columns (En cola / Cocinando / Listo), large
// monospace-style ticket cards with elapsed timer chip, item list, advance
// button. State is local only.

import { useState, useEffect } from 'react'
import { Clock, Check, ChefHat, AlertTriangle, RefreshCw } from 'lucide-react'

const SEED = [
  { id: 'T-201', mesa: 'Mesa 2',     items: ['1× Pollo Guisado', '2× Tostones'],                   status: 'cocinando', startedAt: new Date(Date.now() - 8 * 60_000),  course: 1 },
  { id: 'T-202', mesa: 'Mesa 3',     items: ['1× Mofongo + Camarones', '1× Bistec', '2× Cerveza'], status: 'cocinando', startedAt: new Date(Date.now() - 12 * 60_000), course: 1 },
  { id: 'T-203', mesa: 'Mesa 6',     items: ['3× Sancocho', '4× Tostones'],                        status: 'cola',      startedAt: new Date(Date.now() - 4 * 60_000),  course: 1 },
  { id: 'T-204', mesa: 'Bar 1',      items: ['2× Empanadas'],                                      status: 'cola',      startedAt: new Date(Date.now() - 2 * 60_000),  course: 1 },
  { id: 'T-205', mesa: 'Terraza 1',  items: ['1× Pescado Frito', '1× Arroz con Pollo', '2× Refresco'], status: 'listo',  startedAt: new Date(Date.now() - 16 * 60_000), course: 1 },
  { id: 'T-206', mesa: 'Mesa 3',     items: ['1× Tres Leches', '1× Flan'],                         status: 'cola',      startedAt: new Date(Date.now() - 1 * 60_000),  course: 2 },
]

const COLS = [
  { id: 'cola',      label: 'En Cola',      style: 'bg-amber-500/10 border-amber-500/30',  pill: 'bg-amber-500/20 text-amber-400'   },
  { id: 'cocinando', label: 'Cocinando',    style: 'bg-blue-500/10 border-blue-500/30',    pill: 'bg-blue-500/20 text-blue-400'     },
  { id: 'listo',     label: 'Listo Servir', style: 'bg-green-500/10 border-green-500/30',  pill: 'bg-green-500/20 text-green-400'   },
]

const NEXT = { cola: 'cocinando', cocinando: 'listo', listo: 'listo' }

function fmtElapsed(start, now) {
  const min = Math.max(0, Math.floor((now - new Date(start).getTime()) / 60_000))
  return `${min} min`
}

function urgencyChip(start, now) {
  const min = Math.floor((now - new Date(start).getTime()) / 60_000)
  if (min >= 15) return 'bg-red-500/20 text-red-400 border-red-500/30'
  if (min >= 10) return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  return 'bg-zinc-700 text-white/70 border-zinc-600'
}

export default function KDSDemo() {
  const [tickets, setTickets] = useState(SEED)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  function advance(id) {
    setTickets(ts => ts.map(t => t.id === id ? { ...t, status: NEXT[t.status], startedAt: t.status !== 'cocinando' ? t.startedAt : new Date() } : t))
  }

  return (
    <div className="h-full bg-black text-white flex flex-col overflow-hidden">
      <div className="border-b border-zinc-800 bg-zinc-900/40 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ChefHat size={20} className="text-red-500" />
          <h1 className="text-lg font-bold">Kitchen Display System</h1>
          <span className="text-xs text-white/50">· {tickets.length} tickets activos</span>
        </div>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-zinc-800 rounded-lg text-white/70 hover:text-white hover:bg-zinc-800">
          <RefreshCw size={12} /> Refrescar
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 overflow-hidden">
        {COLS.map(col => {
          const colTickets = tickets.filter(t => t.status === col.id)
          return (
            <div key={col.id} className={`flex flex-col rounded-2xl border ${col.style} min-h-0`}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60">
                <span className="text-sm font-bold text-white">{col.label}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.pill}`}>{colTickets.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {colTickets.map(t => {
                  const isStuck = (now - new Date(t.startedAt).getTime()) / 60_000 >= 15
                  return (
                    <div key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-[15px] font-bold text-white">{t.mesa}</span>
                          <span className="text-[11px] text-white/40 ml-2 font-mono">{t.id}</span>
                        </div>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${urgencyChip(t.startedAt, now)}`}>
                          <Clock size={9} />
                          {fmtElapsed(t.startedAt, now)}
                          {isStuck && <AlertTriangle size={9} className="text-red-400" />}
                        </span>
                      </div>
                      <ul className="space-y-1 mb-3">
                        {t.items.map((it, i) => (
                          <li key={i} className="text-[13px] text-white font-mono leading-tight">· {it}</li>
                        ))}
                      </ul>
                      {t.course > 1 && <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wider mb-2">Tiempo {t.course}</p>}
                      <button onClick={() => advance(t.id)}
                        className={`w-full py-2 rounded-lg text-[12px] font-bold transition-all ${
                          col.id === 'cola' ? 'bg-blue-600 hover:bg-blue-500 text-white' :
                          col.id === 'cocinando' ? 'bg-green-600 hover:bg-green-500 text-white' :
                          'bg-zinc-700 text-white/60 cursor-default'
                        }`}>
                        {col.id === 'cola' ? 'Empezar a cocinar' : col.id === 'cocinando' ? <span className="inline-flex items-center gap-1.5"><Check size={13} /> Marcar listo</span> : 'En espera de mesero'}
                      </button>
                    </div>
                  )
                })}
                {colTickets.length === 0 && <p className="text-center text-xs text-white/30 py-8">Sin tickets en esta columna</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
