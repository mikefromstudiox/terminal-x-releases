// TestDrivesDemo — faithful copy of dealership/TestDrives.jsx. Schedule + log
// of test drives. Brutalist style. Status pills (agendado/completado/no_show).

import { useState } from 'react'
import { CarFront, Plus, Calendar, Clock, User, Phone, X, Check, AlertTriangle, MessageCircle, FileSignature } from 'lucide-react'

const SEED = [
  { id: 1, datetime: '2026-04-27T10:00', client: 'Maria Sanchez',  phone: '829-555-1010', vehicle: 'Hyundai Tucson Limited 2024', salesperson: 'Pedro Mendez', status: 'agendado',   id_check: false, license_check: false },
  { id: 2, datetime: '2026-04-27T11:30', client: 'Pedro Vasquez',  phone: '809-555-2020', vehicle: 'Mazda CX-5 Touring 2024',     salesperson: 'Carlos Reyes',  status: 'completado', id_check: true,  license_check: true,  duration_min: 28, distance_km: 12, notes: 'Cliente quedó muy satisfecho. Pendiente cotización por escrito.' },
  { id: 3, datetime: '2026-04-27T14:00', client: 'Ana Reyes',      phone: '849-555-3030', vehicle: 'Mazda CX-5 Touring 2024',     salesperson: 'Carlos Reyes',  status: 'agendado',   id_check: true,  license_check: false },
  { id: 4, datetime: '2026-04-27T15:30', client: 'Empresa Trans',  phone: '809-555-4040', vehicle: 'Ford F-150 XLT 2022',         salesperson: 'Carlos Reyes',  status: 'agendado',   id_check: false, license_check: false },
  { id: 5, datetime: '2026-04-26T16:00', client: 'Roberto Castillo', phone: '809-555-5050', vehicle: 'Toyota Corolla XLE 2024',  salesperson: 'Pedro Mendez', status: 'completado', id_check: true,  license_check: true,  duration_min: 18, distance_km: 8, notes: 'Pre-aprobacion BHD pendiente para cerrar' },
  { id: 6, datetime: '2026-04-26T11:00', client: 'Cliente Walk-in', phone: '—',           vehicle: 'Honda Civic Sport 2023',      salesperson: 'Sofia Almonte', status: 'no_show',    id_check: false, license_check: false },
]

const STATUS = {
  agendado:    { label: 'Agendado',    cls: 'bg-blue-50 text-blue-700 border-blue-300' },
  completado:  { label: 'Completado',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  no_show:     { label: 'No-show',     cls: 'bg-red-50 text-red-700 border-red-300' },
  cancelado:   { label: 'Cancelado',   cls: 'bg-slate-100 text-slate-600 border-slate-300' },
}

function fmtDate(s) { const d = new Date(s); return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }
function fmtTime(s) { const d = new Date(s); return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) }

export default function TestDrivesDemo() {
  const [drives, setDrives] = useState(SEED)
  const [filter, setFilter] = useState('hoy')
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null)

  const todayStr = new Date().toISOString().slice(0, 10)
  const filtered = drives.filter(d => {
    const dStr = (d.datetime || '').slice(0, 10)
    if (filter === 'hoy')      return dStr === todayStr
    if (filter === 'agendado') return d.status === 'agendado'
    if (filter === 'completado') return d.status === 'completado'
    return true
  }).sort((a, b) => a.datetime.localeCompare(b.datetime))

  const counts = {
    hoy:        drives.filter(d => (d.datetime || '').slice(0, 10) === todayStr).length,
    agendado:   drives.filter(d => d.status === 'agendado').length,
    completado: drives.filter(d => d.status === 'completado').length,
    all:        drives.length,
  }

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3"><CarFront size={32} /> Test Drives</h1>
          <p className="text-sm text-black/70 mt-1">Pruebas de manejo agendadas y completadas · {counts.completado} completados este mes</p>
        </div>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2 hover:bg-slate-800"><Plus size={18} /> Agendar nuevo</button>
      </div>

      <div className="flex gap-1 mb-4">
        {[
          { id: 'hoy',        label: 'Hoy',         count: counts.hoy },
          { id: 'agendado',   label: 'Agendados',   count: counts.agendado },
          { id: 'completado', label: 'Completados', count: counts.completado },
          { id: 'all',        label: 'Todos',       count: counts.all },
        ].map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)} className={`px-3 py-2 border border-black text-sm font-bold inline-flex items-center gap-1.5 ${filter === t.id ? 'bg-black text-white' : 'hover:bg-slate-50'}`}>
            {t.label}
            <span className={`text-[10px] px-1.5 ${filter === t.id ? 'bg-white text-black' : 'bg-slate-100'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className="border border-black overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2">Hora</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Vehículo</th>
              <th className="text-left px-3 py-2">Vendedor</th>
              <th className="text-center px-3 py-2">ID</th>
              <th className="text-center px-3 py-2">Licencia</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(d => (
              <tr key={d.id} onClick={() => setDetail(d)} className="border-t border-black/10 hover:bg-black/5 cursor-pointer">
                <td className="px-3 py-2 font-mono text-sm font-bold">{fmtTime(d.datetime)}<p className="text-[10px] text-black/40 font-normal">{fmtDate(d.datetime)}</p></td>
                <td className="px-3 py-2"><p className="font-semibold">{d.client}</p><p className="text-[10px] text-black/50 inline-flex items-center gap-1"><Phone size={9} /> {d.phone}</p></td>
                <td className="px-3 py-2 text-black/70">{d.vehicle}</td>
                <td className="px-3 py-2 text-black/70">{d.salesperson}</td>
                <td className="px-3 py-2 text-center">{d.id_check ? <Check size={14} className="text-emerald-600 inline" /> : <X size={14} className="text-red-500 inline" />}</td>
                <td className="px-3 py-2 text-center">{d.license_check ? <Check size={14} className="text-emerald-600 inline" /> : <X size={14} className="text-red-500 inline" />}</td>
                <td className="px-3 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 border ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span></td>
                <td className="px-3 py-2 text-right"><button className="p-1 hover:bg-black hover:text-white"><FileSignature size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showNew || detail) && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => { setShowNew(false); setDetail(null) }}>
          <div className="bg-white border border-black max-w-lg w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-black">
              <h2 className="text-xl font-bold">{detail ? `Test Drive · ${detail.client}` : 'Nuevo Test Drive'}</h2>
              <button onClick={() => { setShowNew(false); setDetail(null) }} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              {detail && detail.status === 'agendado' && (!detail.id_check || !detail.license_check) && (
                <div className="border-2 border-amber-500 bg-amber-50 p-3 text-xs flex gap-2"><AlertTriangle size={14} className="text-amber-700 mt-0.5 shrink-0" /><span className="text-amber-900">Verifica cédula y licencia antes de entregar la unidad. Es obligatorio para la cobertura del seguro.</span></div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-xs font-semibold">Fecha</span><input type="date" defaultValue={detail?.datetime?.slice(0, 10) || ''} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
                <label className="block"><span className="text-xs font-semibold">Hora</span><input type="time" defaultValue={detail?.datetime?.slice(11, 16) || ''} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              </div>
              <label className="block"><span className="text-xs font-semibold">Cliente</span><input defaultValue={detail?.client || ''} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-xs font-semibold">Teléfono</span><input defaultValue={detail?.phone || ''} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
                <label className="block"><span className="text-xs font-semibold">Vendedor</span><input defaultValue={detail?.salesperson || ''} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              </div>
              <label className="block"><span className="text-xs font-semibold">Vehículo</span><input defaultValue={detail?.vehicle || ''} className="mt-1 w-full border border-black px-2 py-1.5" /></label>

              <div className="border border-black p-3 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider">Verificación pre-test-drive</p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={detail?.id_check} className="accent-[#b3001e]" /> Cédula verificada</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={detail?.license_check} className="accent-[#b3001e]" /> Licencia de conducir vigente</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#b3001e]" /> Cliente firmó liberación de responsabilidad</label>
              </div>

              {detail?.notes && <div className="border border-black p-3"><p className="text-xs font-bold mb-1">Notas:</p><p className="text-sm">{detail.notes}</p></div>}

              {detail?.status === 'completado' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-black p-2"><p className="text-xs uppercase">Duración</p><p className="font-bold">{detail.duration_min} min</p></div>
                  <div className="border border-black p-2"><p className="text-xs uppercase">Distancia</p><p className="font-bold">{detail.distance_km} km</p></div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 p-5 border-t border-black">
              <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-black text-sm hover:bg-slate-50"><MessageCircle size={13} /> WhatsApp</button>
              {detail?.status === 'agendado' && (
                <>
                  <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-red-500 text-red-700 text-sm hover:bg-red-50">No-show</button>
                  <button className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700"><Check size={13} /> Marcar completado</button>
                </>
              )}
              {!detail && <button className="ml-auto px-4 py-2 bg-black text-white font-bold hover:bg-slate-800">Agendar</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
