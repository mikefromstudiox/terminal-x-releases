// StylistSchedulesDemo — faithful copy of salon/StylistSchedules.jsx.
// Weekly schedule grid: 7 days × stylist rows. Toggle on/off per slot.
// Vacation/break overlays.

import { useState } from 'react'
import { Plus, Calendar, Clock, X, Check, Coffee, Plane } from 'lucide-react'

const DAYS = [
  { id: 'lun', label: 'Lun' },
  { id: 'mar', label: 'Mar' },
  { id: 'mie', label: 'Mié' },
  { id: 'jue', label: 'Jue' },
  { id: 'vie', label: 'Vie' },
  { id: 'sab', label: 'Sáb' },
  { id: 'dom', label: 'Dom' },
]

const STYLISTS = [
  { id: 1, name: 'Yolanda Peña',   color: 'bg-rose-500',   schedule: { lun: '9-18', mar: '9-18', mie: '9-18', jue: '9-18', vie: '9-19', sab: '9-15', dom: 'off' } },
  { id: 2, name: 'Esperanza Diaz', color: 'bg-amber-500',  schedule: { lun: '8-17', mar: '8-17', mie: 'off',  jue: '8-17', vie: '8-18', sab: '8-15', dom: 'off' } },
  { id: 3, name: 'Karina Reyes',   color: 'bg-purple-500', schedule: { lun: 'off',  mar: '10-19', mie: '10-19', jue: '10-19', vie: '10-20', sab: '9-16', dom: '11-15' } },
  { id: 4, name: 'Andrés Soto',    color: 'bg-sky-500',    schedule: { lun: '9-18', mar: '9-18', mie: '9-18', jue: '9-18', vie: '9-19', sab: '9-16', dom: 'off' } },
]

const VACATIONS = [
  { stylist: 'Yolanda Peña',   from: '2026-05-12', to: '2026-05-19', kind: 'vacation' },
  { stylist: 'Esperanza Diaz', from: '2026-04-30', to: '2026-04-30', kind: 'sick' },
]

export default function StylistSchedulesDemo() {
  const [schedules, setSchedules] = useState(STYLISTS)
  const [editing, setEditing]     = useState(null)

  function toggleDay(stylistId, dayId) {
    setSchedules(ss => ss.map(s => {
      if (s.id !== stylistId) return s
      const cur = s.schedule[dayId]
      return { ...s, schedule: { ...s.schedule, [dayId]: cur === 'off' ? '9-17' : 'off' } }
    }))
  }

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-y-auto bg-white">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3"><Calendar size={26} /> Horarios de Estilistas</h1>
          <p className="text-sm text-slate-500 mt-1">Plantilla semanal · public booking respeta estos slots</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50"><Plane size={13} /> Marcar vacaciones</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#b3001e] text-white rounded-lg text-sm font-bold hover:bg-[#8c0017]"><Plus size={13} /> Agregar estilista</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200 w-56">Estilista</th>
              {DAYS.map(d => <th key={d.id} className="text-center px-2 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">{d.label}</th>)}
              <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">Horas</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => {
              const totalHours = DAYS.reduce((sum, d) => {
                const v = s.schedule[d.id]
                if (v === 'off') return sum
                const [a, b] = v.split('-').map(n => parseInt(n, 10))
                return sum + Math.max(0, b - a)
              }, 0)
              return (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-9 h-9 rounded-full ${s.color} text-white text-[11px] font-bold flex items-center justify-center`}>{s.name.split(' ').map(p => p[0]).slice(0, 2).join('')}</div>
                      <div>
                        <p className="font-bold text-slate-800">{s.name}</p>
                        <button onClick={() => setEditing(s)} className="text-[10px] text-sky-600 hover:underline">Editar perfil</button>
                      </div>
                    </div>
                  </td>
                  {DAYS.map(d => {
                    const v = s.schedule[d.id]
                    const off = v === 'off'
                    return (
                      <td key={d.id} className="px-1 py-2 text-center">
                        <button onClick={() => toggleDay(s.id, d.id)}
                          className={`w-full px-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors border ${off ? 'bg-slate-50 text-slate-400 border-slate-200' : 'bg-emerald-50 text-emerald-700 border-emerald-300'}`}>
                          {off ? 'Off' : v}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">{totalHours}h</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <h2 className="text-[14px] font-bold text-slate-800 mb-3 inline-flex items-center gap-2"><Plane size={14} /> Próximas vacaciones / ausencias</h2>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
              <tr><th className="text-left px-4 py-2.5 font-bold">Estilista</th><th className="text-left px-4 py-2.5 font-bold">Desde</th><th className="text-left px-4 py-2.5 font-bold">Hasta</th><th className="text-left px-4 py-2.5 font-bold">Tipo</th><th className="text-right px-4 py-2.5"></th></tr>
            </thead>
            <tbody>
              {VACATIONS.map((v, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-800">{v.stylist}</td>
                  <td className="px-4 py-3 text-slate-600">{v.from}</td>
                  <td className="px-4 py-3 text-slate-600">{v.to}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${v.kind === 'vacation' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>{v.kind === 'vacation' ? 'Vacaciones' : 'Día libre'}</span></td>
                  <td className="px-4 py-3 text-right"><button className="text-slate-400 hover:text-red-600 p-1"><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-slate-800">{editing.name}</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-3">
              <label className="block"><span className="text-xs font-semibold text-slate-500">Especialidad</span><input className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Color, Corte, Uñas..." /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Comisión %</span><input type="number" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" defaultValue={40} /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Color de avatar</span>
                <div className="mt-1 flex gap-2">
                  {['bg-rose-500','bg-amber-500','bg-purple-500','bg-sky-500','bg-emerald-500','bg-pink-500'].map(c => (
                    <button key={c} className={`w-8 h-8 rounded-full ${c} ${editing.color === c ? 'ring-2 ring-offset-2 ring-slate-800' : ''}`} />
                  ))}
                </div>
              </label>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-[#b3001e] text-white rounded-lg text-sm font-bold hover:bg-[#8c0017]">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
