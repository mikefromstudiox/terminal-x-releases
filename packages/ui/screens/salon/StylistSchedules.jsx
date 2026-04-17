/**
 * StylistSchedules.jsx — Weekly availability matrix per empleado (tipo=lavador/hybrid).
 *
 * Salon-vertical management screen. Lets the owner define Mon-Sun start/end
 * windows for each stylist. Appointments UI will later consult these rows to
 * grey out unavailable slots. A stylist with no schedule rows is treated as
 * always available (backwards-compatible with the existing day-view grid).
 *
 * Persists via api.stylistSchedules.{list,create,update,delete} which is wired
 * through electron IPC (desktop) and Supabase (web) transparently.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Clock, Plus, Trash2, Loader2, CheckCircle2, AlertCircle,
  Scissors, Calendar as CalendarIcon,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const DAYS = [
  { dow: 1, es: 'Lun', en: 'Mon', full_es: 'Lunes',     full_en: 'Monday'    },
  { dow: 2, es: 'Mar', en: 'Tue', full_es: 'Martes',    full_en: 'Tuesday'   },
  { dow: 3, es: 'Mié', en: 'Wed', full_es: 'Miércoles', full_en: 'Wednesday' },
  { dow: 4, es: 'Jue', en: 'Thu', full_es: 'Jueves',    full_en: 'Thursday'  },
  { dow: 5, es: 'Vie', en: 'Fri', full_es: 'Viernes',   full_en: 'Friday'    },
  { dow: 6, es: 'Sáb', en: 'Sat', full_es: 'Sábado',    full_en: 'Saturday'  },
  { dow: 0, es: 'Dom', en: 'Sun', full_es: 'Domingo',   full_en: 'Sunday'    },
]

const DEFAULT_START = '09:00'
const DEFAULT_END   = '18:00'

export default function StylistSchedules() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [empleados, setEmpleados] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(null) // `${empId}-${dow}`
  const [toast,     setToast]     = useState(null)

  function flash(msg, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 2500)
  }

  async function load() {
    setLoading(true)
    try {
      const [emps, schs] = await Promise.all([
        api?.empleados?.all?.() || [],
        api?.stylistSchedules?.list?.() || [],
      ])
      // Salon schedules only make sense for stylists (tipo lavador or hybrid) or any active empleado.
      setEmpleados((emps || []).filter(e => e.active !== 0))
      setSchedules(schs || [])
    } catch (e) {
      flash(e?.message || L('Error cargando', 'Error loading'), false)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Quick lookup: `${empleado_id}-${dow}` → schedule row
  const byKey = useMemo(() => {
    const m = new Map()
    for (const s of schedules) m.set(`${s.empleado_id}-${s.day_of_week}`, s)
    return m
  }, [schedules])

  async function setSlot(empleado_id, dow, patch) {
    const key = `${empleado_id}-${dow}`
    setSaving(key)
    try {
      const existing = byKey.get(key)
      if (existing) {
        if (patch.is_off) {
          await api.stylistSchedules.delete(existing.id)
        } else {
          await api.stylistSchedules.update({ id: existing.id, ...patch })
        }
      } else if (!patch.is_off) {
        await api.stylistSchedules.create({
          empleado_id,
          day_of_week: dow,
          start_time: patch.start_time || DEFAULT_START,
          end_time:   patch.end_time   || DEFAULT_END,
        })
      }
      await load()
    } catch (e) {
      flash(e?.message || L('Error al guardar', 'Save error'), false)
    }
    setSaving(null)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 md:px-6 py-3 md:py-4 shrink-0">
        <div className="flex items-center gap-3">
          <CalendarIcon size={20} className="text-slate-500 dark:text-white/60" />
          <div>
            <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
              {L('Horarios de Estilistas', 'Stylist Schedules')}
            </h1>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
              {L('Define horario semanal. Sin fila = disponible todo el día.',
                 'Set weekly hours. No row = available all day.')}
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-3 md:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 gap-2">
            <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
          </div>
        ) : empleados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/30 gap-2">
            <Scissors size={32} />
            <p className="text-sm">{L('No hay empleados activos.', 'No active employees.')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {empleados.map(emp => (
              <div key={emp.id} className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-white/10">
                  <div className="w-9 h-9 rounded-full bg-[#b3001e]/10 flex items-center justify-center text-[#b3001e] font-bold text-[12px]">
                    {(emp.nombre || '?').split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-[13px] font-bold text-slate-800 dark:text-white">{emp.nombre}</p>
                    <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">{emp.tipo || 'estilista'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-7 gap-2 p-3">
                  {DAYS.map(d => {
                    const row = byKey.get(`${emp.id}-${d.dow}`)
                    const key = `${emp.id}-${d.dow}`
                    const isSaving = saving === key
                    const active = !!row
                    return (
                      <div key={d.dow}
                        className={`rounded-xl border p-2.5 transition-colors ${
                          active
                            ? 'bg-white dark:bg-white/5 border-[#b3001e]/40'
                            : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10'
                        }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] font-bold text-slate-600 dark:text-white/70">
                            {lang === 'es' ? d.es : d.en}
                          </span>
                          {isSaving
                            ? <Loader2 size={11} className="animate-spin text-slate-400" />
                            : active
                              ? <button onClick={() => setSlot(emp.id, d.dow, { is_off: true })}
                                  className="text-[10px] text-red-500 hover:text-red-700 font-semibold">
                                  {L('Libre', 'Off')}
                                </button>
                              : <button onClick={() => setSlot(emp.id, d.dow, { start_time: DEFAULT_START, end_time: DEFAULT_END })}
                                  className="text-[10px] text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-0.5">
                                  <Plus size={10}/>{L('Trabaja', 'Work')}
                                </button>
                          }
                        </div>
                        {active && (
                          <div className="flex items-center gap-1">
                            <input type="time" value={row.start_time || DEFAULT_START}
                              onChange={e => setSlot(emp.id, d.dow, { start_time: e.target.value, end_time: row.end_time || DEFAULT_END })}
                              className="w-full px-1.5 py-1 text-[11px] rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-white tabular-nums" />
                            <span className="text-[10px] text-slate-400">—</span>
                            <input type="time" value={row.end_time || DEFAULT_END}
                              onChange={e => setSlot(emp.id, d.dow, { start_time: row.start_time || DEFAULT_START, end_time: e.target.value })}
                              className="w-full px-1.5 py-1 text-[11px] rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-white tabular-nums" />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-2 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50 ${
          toast.ok ? 'bg-slate-800 dark:bg-white/10' : 'bg-red-600'
        }`}>
          {toast.ok ? <CheckCircle2 size={14} className="text-green-400"/> : <AlertCircle size={14}/>}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
