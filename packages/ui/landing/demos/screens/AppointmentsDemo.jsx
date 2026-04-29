// AppointmentsDemo — salon/barbería agenda. Faithful match: hour rail on
// left, stylist columns across, appointment blocks with client/service/time.

import { useState } from 'react'
import { Plus, Calendar, ChevronLeft, ChevronRight, Search, MessageCircle, Phone, X, Clock, Check } from 'lucide-react'

const STYLISTS = [
  { id: 1, name: 'Yolanda',   initials: 'YP', color: 'bg-rose-500' },
  { id: 2, name: 'Esperanza', initials: 'ED', color: 'bg-amber-500' },
  { id: 3, name: 'Karina',    initials: 'KR', color: 'bg-purple-500' },
  { id: 4, name: 'Andrés',    initials: 'AS', color: 'bg-sky-500' },
]

const APPTS = [
  { id: 1, hour: 9,  duration: 90,  stylist: 1, client: 'Maria Sanchez',     service: 'Corte + Tinte',   status: 'confirmada',  total: 3300 },
  { id: 2, hour: 10, duration: 180, stylist: 1, client: 'Ana Reyes',         service: 'Mechas',          status: 'check-in',    total: 3200 },
  { id: 3, hour: 10, duration: 30,  stylist: 4, client: 'Roberto Castillo',  service: 'Corte Hombre',    status: 'completada',  total:  450 },
  { id: 4, hour: 11, duration: 90,  stylist: 3, client: 'Lucia Almonte',     service: 'Manicure + Pedicure', status: 'en_servicio', total: 1100 },
  { id: 5, hour: 12, duration: 60,  stylist: 2, client: 'Familia Castillo',  service: '2× Corte Niño',   status: 'confirmada',  total:  700 },
  { id: 6, hour: 14, duration: 180, stylist: 1, client: 'Sra. Mendez',       service: 'Keratina',        status: 'confirmada',  total: 4500 },
  { id: 7, hour: 15, duration: 60,  stylist: 2, client: 'Carmen Diaz',       service: 'Hidratacion',     status: 'confirmada',  total: 1800 },
  { id: 8, hour: 16, duration: 120, stylist: 3, client: 'Ana Garcia',        service: 'Uñas Acrilicas',  status: 'confirmada',  total: 1800 },
]

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]

const STATUS_STYLE = {
  confirmada:   'bg-sky-50 border-sky-300 text-sky-800',
  'check-in':   'bg-amber-50 border-amber-300 text-amber-900',
  en_servicio:  'bg-emerald-50 border-emerald-300 text-emerald-800',
  completada:   'bg-slate-50 border-slate-300 text-slate-600 line-through',
}

const STATUS_LABEL = {
  confirmada: 'Confirmada', 'check-in': 'Check-in', en_servicio: 'En servicio', completada: 'Completada',
}

function fmtRD(n) { return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 0 })}` }
function fmtHour(h) { return h <= 12 ? `${h}:00 AM` : `${h - 12}:00 PM` }

export default function AppointmentsDemo() {
  const [selected, setSelected] = useState(null)

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Top bar */}
      <div className="shrink-0 border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-[16px] font-bold text-slate-800">Agenda</h1>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg">
            <button className="px-2 py-1.5 text-slate-500 hover:text-slate-800"><ChevronLeft size={14} /></button>
            <span className="text-[12px] font-semibold text-slate-700 px-2">Hoy · {new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
            <button className="px-2 py-1.5 text-slate-500 hover:text-slate-800"><ChevronRight size={14} /></button>
          </div>
          <button className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-slate-800"><Calendar size={13} /> Calendario</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-sky-400 w-56">
            <Search size={13} className="text-slate-400" />
            <input placeholder="Buscar cliente..." className="flex-1 text-[12px] bg-transparent outline-none" />
          </div>
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold bg-[#b3001e] hover:bg-[#8c0017] text-white"><Plus size={13} /> Nueva cita</button>
        </div>
      </div>

      {/* Stylist column header */}
      <div className="shrink-0 grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `64px repeat(${STYLISTS.length}, 1fr)` }}>
        <div></div>
        {STYLISTS.map(s => (
          <div key={s.id} className="px-3 py-3 border-l border-slate-200 flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full ${s.color} text-white text-[11px] font-bold flex items-center justify-center`}>{s.initials}</div>
            <div>
              <p className="text-[13px] font-bold text-slate-800">{s.name}</p>
              <p className="text-[10px] text-slate-400">{APPTS.filter(a => a.stylist === s.id).length} citas hoy</p>
            </div>
          </div>
        ))}
      </div>

      {/* Schedule grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid relative" style={{ gridTemplateColumns: `64px repeat(${STYLISTS.length}, 1fr)` }}>
          {HOURS.map(h => (
            <>
              <div key={`hr-${h}`} className="border-b border-slate-100 px-2 py-1 text-[10px] font-bold text-slate-400 text-right" style={{ height: 80 }}>
                {fmtHour(h)}
              </div>
              {STYLISTS.map(s => (
                <div key={`cell-${h}-${s.id}`} className="border-b border-l border-slate-100 relative" style={{ height: 80 }}>
                  {APPTS.filter(a => a.stylist === s.id && a.hour === h).map(a => {
                    const heightPx = (a.duration / 60) * 80
                    return (
                      <button key={a.id} onClick={() => setSelected(a)}
                        className={`absolute inset-x-1 top-0.5 rounded-lg border-l-4 px-2 py-1.5 text-left transition-all hover:shadow-md ${STATUS_STYLE[a.status]}`}
                        style={{ height: heightPx - 4 }}>
                        <p className="text-[12px] font-bold leading-tight truncate">{a.client}</p>
                        <p className="text-[10px] truncate opacity-80">{a.service}</p>
                        <p className="text-[10px] font-bold mt-1">{fmtRD(a.total)}</p>
                      </button>
                    )
                  })}
                </div>
              ))}
            </>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{STYLISTS.find(s => s.id === selected.stylist)?.name} · {fmtHour(selected.hour)}</p>
                <h3 className="text-[18px] font-extrabold text-slate-900 mt-1">{selected.client}</h3>
                <p className="text-[13px] text-slate-600 mt-1">{selected.service}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div className="bg-slate-50 rounded-lg p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Duracion</p><p className="font-bold text-slate-800 inline-flex items-center gap-1"><Clock size={11} /> {selected.duration} min</p></div>
                <div className="bg-slate-50 rounded-lg p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Total</p><p className="font-bold text-[#b3001e] tabular-nums">{fmtRD(selected.total)}</p></div>
                <div className="bg-slate-50 rounded-lg p-3 col-span-2"><p className="text-[10px] uppercase tracking-wider text-slate-400">Estado</p><p className="font-bold text-slate-800">{STATUS_LABEL[selected.status]}</p></div>
              </div>
              <div className="flex gap-2 pt-2">
                <button className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"><Phone size={13} /> Llamar</button>
                <button className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-emerald-700 hover:bg-emerald-50"><MessageCircle size={13} /> WhatsApp</button>
              </div>
              <div className="flex gap-2">
                {selected.status !== 'completada' && <button className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white"><Check size={13} /> Marcar completada</button>}
                <button className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold bg-[#b3001e] hover:bg-[#8c0017] text-white">Cobrar {fmtRD(selected.total)}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
