/**
 * Appointments.jsx — Day-view appointment calendar for salon/barbershop.
 *
 * Grid layout: columns = stylists, rows = 30-min time slots (8:00 AM - 8:00 PM).
 * Colored blocks for appointments spanning their duration.
 * Create/edit modals, walk-in button, summary cards.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Calendar, Plus, X, Search, Clock, User, Scissors,
  Loader2, CheckCircle2, AlertCircle, ChevronLeft,
  ChevronRight, UserX, UserPlus,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'

// ── Constants ─────────────────────────────────────────────────────────────────

const APPT_STATUS = {
  programada: { label_es: 'Programada', label_en: 'Scheduled', bg: 'bg-sky-100 dark:bg-sky-500/20',        text: 'text-sky-700 dark:text-sky-300',       border: 'border-sky-300 dark:border-sky-500/40',     block: 'bg-sky-500/80' },
  confirmada: { label_es: 'Confirmada', label_en: 'Confirmed', bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-300 dark:border-emerald-500/40', block: 'bg-emerald-500/80' },
  en_progreso:{ label_es: 'En Progreso',label_en: 'In Progress',bg: 'bg-amber-100 dark:bg-amber-500/20',   text: 'text-amber-700 dark:text-amber-300',    border: 'border-amber-300 dark:border-amber-500/40', block: 'bg-amber-500/80' },
  completada: { label_es: 'Completada', label_en: 'Completed', bg: 'bg-slate-100 dark:bg-white/10',         text: 'text-slate-500 dark:text-white/40',     border: 'border-slate-200 dark:border-white/10',     block: 'bg-slate-400/60' },
  no_show:    { label_es: 'No Show',    label_en: 'No Show',   bg: 'bg-red-100 dark:bg-red-500/20',         text: 'text-red-700 dark:text-red-300',        border: 'border-red-300 dark:border-red-500/40',     block: 'bg-red-500/80' },
}

const DURATION_OPTIONS = [
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 hora' },
  { value: 90,  label: '1.5 horas' },
  { value: 120, label: '2 horas' },
]

// Generate time slots from 8:00 to 20:00 in 30-min increments
const TIME_SLOTS = []
for (let h = 8; h < 20; h++) {
  TIME_SLOTS.push({ hour: h, minute: 0,  label: `${String(h).padStart(2, '0')}:00` })
  TIME_SLOTS.push({ hour: h, minute: 30, label: `${String(h).padStart(2, '0')}:30` })
}

function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function toDateStr(d) {
  return d.toISOString().split('T')[0]
}

function timeToSlotIndex(timeStr) {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return ((h - 8) * 2) + (m >= 30 ? 1 : 0)
}

function slotSpan(durationMin) {
  return Math.max(1, Math.round(durationMin / 30))
}

// ── Appointment Form Modal ───────────────────────────────────────────────────

function AppointmentModal({ appointment, clients, empleados, services, date, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en

  const [form, setForm] = useState({
    client_id:    appointment?.client_id    || '',
    empleado_id:  appointment?.empleado_id  || '',
    date:         appointment?.date         || date,
    start_time:   appointment?.start_time   || '09:00',
    duration:     appointment?.duration     || 60,
    service_ids:  appointment?.service_ids  || [],
    notes:        appointment?.notes        || '',
    status:       appointment?.status       || 'programada',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function toggleService(id) {
    setForm(f => ({
      ...f,
      service_ids: f.service_ids.includes(id)
        ? f.service_ids.filter(s => s !== id)
        : [...f.service_ids, id],
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.empleado_id) {
      setErr(L('Selecciona un estilista.', 'Select a stylist.'))
      return
    }
    setSaving(true)
    try {
      const data = {
        ...form,
        client_id:   form.client_id || null,
        empleado_id: Number(form.empleado_id),
        duration:    Number(form.duration),
        notes:       form.notes.trim() || null,
      }
      if (appointment?.id) data.id = appointment.id
      await onSave(data)
    } catch (ex) {
      setErr(ex?.message || L('Error al guardar', 'Error saving'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Calendar size={16} className="text-[#b3001e]" />
            {appointment ? L('Editar Cita', 'Edit Appointment') : L('Nueva Cita', 'New Appointment')}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Client */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Cliente', 'Client')}
            </label>
            <select value={form.client_id} onChange={e => set('client_id', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
              <option value="">{L('Walk-in / Sin cliente', 'Walk-in / No client')}</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name || c.nombre}</option>
              ))}
            </select>
          </div>

          {/* Stylist */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Estilista / Empleado *', 'Stylist / Employee *')}
            </label>
            <select value={form.empleado_id} onChange={e => { set('empleado_id', e.target.value); setErr('') }}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
              <option value="">{L('Seleccionar...', 'Select...')}</option>
              {empleados.map(e => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          </div>

          {/* Date + Time + Duration */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Fecha', 'Date')}
              </label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Hora inicio', 'Start time')}
              </label>
              <select value={form.start_time} onChange={e => set('start_time', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
                {TIME_SLOTS.map(t => (
                  <option key={t.label} value={t.label}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Duracion', 'Duration')}
              </label>
              <select value={form.duration} onChange={e => set('duration', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
                {DURATION_OPTIONS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Services multi-select */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Servicios', 'Services')}
            </label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {services.map(s => {
                const selected = form.service_ids.includes(s.id)
                return (
                  <button key={s.id} type="button" onClick={() => toggleService(s.id)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors border min-h-[36px] ${
                      selected
                        ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                        : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
                    }`}>
                    {s.name || s.nombre}
                  </button>
                )
              })}
              {services.length === 0 && (
                <p className="text-[12px] text-slate-400 dark:text-white/40">{L('No hay servicios disponibles.', 'No services available.')}</p>
              )}
            </div>
          </div>

          {/* Status (edit mode) */}
          {appointment && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Estado', 'Status')}
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(APPT_STATUS).map(([key, st]) => (
                  <button key={key} type="button" onClick={() => set('status', key)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors border ${
                      form.status === key
                        ? `${st.bg} ${st.text} ${st.border}`
                        : 'bg-white dark:bg-white/5 text-slate-500 dark:text-white/50 border-slate-200 dark:border-white/10'
                    }`}>
                    {L(st.label_es, st.label_en)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Notas', 'Notes')}
            </label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none" />
          </div>

          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <div className="flex gap-2">
            {appointment && (
              <>
                {appointment.status !== 'no_show' && (
                  <button type="button" onClick={() => { set('status', 'no_show'); }}
                    className="px-3 py-2 text-[11px] font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                    No Show
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
              {L('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 bg-black text-white text-[12px] font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
              {saving && <Loader2 size={13} className="animate-spin" />}
              {appointment ? L('Guardar Cambios', 'Save Changes') : L('Crear Cita', 'Create Appointment')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function Appointments() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [appointments, setAppointments] = useState([])
  const [clients,      setClients]      = useState([])
  const [empleados,    setEmpleados]    = useState([])
  const [services,     setServices]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()))
  const [showCreate,   setShowCreate]   = useState(false)
  const [editAppt,     setEditAppt]     = useState(null)
  const [toast,        setToast]        = useState(null)

  const gridRef = useRef(null)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function loadAll() {
    setLoading(true)
    try {
      const [appts, c, e, s] = await Promise.all([
        api?.appointments?.list?.({ date: selectedDate }) || [],
        api?.clients?.all?.() || [],
        api?.empleados?.all?.() || [],
        api?.services?.getAll?.() || [],
      ])
      setAppointments(appts || [])
      setClients(c || [])
      setEmpleados(e || [])
      setServices(s || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [selectedDate])

  async function handleSave(data) {
    if (data.id) await api.appointments.update(data)
    else         await api.appointments.create(data)
    setShowCreate(false)
    setEditAppt(null)
    await loadAll()
    flash(data.id ? L('Cita actualizada', 'Appointment updated') : L('Cita creada', 'Appointment created'))
  }

  async function handleWalkIn() {
    try {
      const now = new Date()
      const startTime = `${String(now.getHours()).padStart(2, '0')}:${now.getMinutes() < 30 ? '00' : '30'}`
      setShowCreate(true)
    } catch {}
  }

  function changeDate(delta) {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    setSelectedDate(toDateStr(d))
  }

  // Summary metrics
  const metrics = useMemo(() => {
    const total = appointments.length
    const completadas = appointments.filter(a => a.status === 'completada').length
    const pendientes = appointments.filter(a => ['programada', 'confirmada'].includes(a.status)).length
    const noShow = appointments.filter(a => a.status === 'no_show').length
    return { total, completadas, pendientes, noShow }
  }, [appointments])

  // Group appointments by stylist for grid
  const activeEmpleados = useMemo(() => {
    const empIds = new Set(appointments.map(a => a.empleado_id))
    return empleados.filter(e => empIds.has(e.id) || e.active !== 0).slice(0, 8) // max 8 columns
  }, [empleados, appointments])

  const apptsByEmployee = useMemo(() => {
    const map = {}
    activeEmpleados.forEach(e => { map[e.id] = [] })
    appointments.forEach(a => {
      if (!map[a.empleado_id]) map[a.empleado_id] = []
      map[a.empleado_id].push(a)
    })
    return map
  }, [appointments, activeEmpleados])

  const isToday = selectedDate === toDateStr(new Date())

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 gap-2 md:gap-0">
          <div className="flex items-center gap-3">
            <Calendar size={20} className="text-slate-500 dark:text-white/60" />
            <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
              {L('Citas', 'Appointments')}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleWalkIn}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
              <UserPlus size={15} /> Walk-in
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shrink-0">
              <Plus size={15} /> {L('Nueva Cita', 'New Appointment')}
            </button>
          </div>
        </div>

        {/* Date picker */}
        <div className="flex items-center justify-between px-3 md:px-6 pb-3">
          <div className="flex items-center gap-2">
            <button onClick={() => changeDate(-1)}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 transition-colors">
              <ChevronLeft size={18} />
            </button>
            <div className="text-center min-w-[200px]">
              <p className="text-[14px] font-bold text-slate-800 dark:text-white capitalize">{fmtDate(selectedDate)}</p>
              {isToday && <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase">{L('Hoy', 'Today')}</span>}
            </div>
            <button onClick={() => changeDate(1)}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>
          {!isToday && (
            <button onClick={() => setSelectedDate(toDateStr(new Date()))}
              className="text-[12px] font-semibold text-sky-600 dark:text-sky-400 hover:underline">
              {L('Ir a hoy', 'Go to today')}
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="px-3 md:px-6 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        {[
          { label: L('Total Citas', 'Total Appts'),       value: metrics.total,       color: 'text-slate-700 dark:text-white' },
          { label: L('Completadas', 'Completed'),          value: metrics.completadas, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: L('Pendientes', 'Pending'),             value: metrics.pendientes,  color: 'text-sky-600 dark:text-sky-400' },
          { label: L('No Show', 'No Show'),                value: metrics.noShow,      color: metrics.noShow > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-white' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
            <p className="text-xs text-slate-400 dark:text-white/40 mb-1">{label}</p>
            <p className={`text-[18px] font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto px-3 md:px-6 pb-6" ref={gridRef}>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
          </div>
        ) : activeEmpleados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/30 gap-2">
            <Calendar size={32} />
            <p className="text-sm">{L('No hay empleados activos.', 'No active employees.')}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            {/* Desktop: grid calendar */}
            <div className="hidden md:block overflow-x-auto">
              <div className="min-w-[600px]">
                {/* Header row: stylist names */}
                <div className="flex border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 sticky top-0 z-10">
                  <div className="w-16 shrink-0 px-2 py-3 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase">
                    {L('Hora', 'Time')}
                  </div>
                  {activeEmpleados.map(emp => (
                    <div key={emp.id} className="flex-1 min-w-[140px] px-3 py-3 text-center border-l border-slate-100 dark:border-white/5">
                      <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center text-[11px] font-bold text-slate-600 dark:text-white/60 mx-auto mb-1">
                        {(emp.nombre || '?')[0]}
                      </div>
                      <p className="text-[12px] font-semibold text-slate-700 dark:text-white truncate">{emp.nombre}</p>
                    </div>
                  ))}
                </div>

                {/* Time slot rows */}
                {TIME_SLOTS.map((slot, slotIdx) => (
                  <div key={slot.label} className="flex border-b border-slate-50 dark:border-white/5 min-h-[40px]">
                    <div className="w-16 shrink-0 px-2 py-1 text-[11px] text-slate-400 dark:text-white/30 font-mono text-right pr-3 border-r border-slate-100 dark:border-white/5">
                      {slot.label}
                    </div>
                    {activeEmpleados.map(emp => {
                      const empAppts = apptsByEmployee[emp.id] || []
                      const appt = empAppts.find(a => {
                        const aIdx = timeToSlotIndex(a.start_time)
                        return aIdx === slotIdx
                      })
                      // Check if this slot is occupied by an appointment that started earlier
                      const coveredBy = empAppts.find(a => {
                        const aIdx = timeToSlotIndex(a.start_time)
                        const span = slotSpan(a.duration || 60)
                        return aIdx < slotIdx && slotIdx < aIdx + span
                      })

                      if (coveredBy) {
                        return <div key={emp.id} className="flex-1 min-w-[140px] border-l border-slate-50 dark:border-white/5" />
                      }

                      if (appt) {
                        const st = APPT_STATUS[appt.status] || APPT_STATUS.programada
                        const span = slotSpan(appt.duration || 60)
                        return (
                          <div key={emp.id} className="flex-1 min-w-[140px] border-l border-slate-50 dark:border-white/5 relative">
                            <button
                              onClick={() => setEditAppt(appt)}
                              className={`absolute inset-x-1 top-0 rounded-lg px-2 py-1 text-left transition-all hover:brightness-110 cursor-pointer ${st.block} text-white overflow-hidden`}
                              style={{ height: `${span * 40}px`, zIndex: 5 }}>
                              <p className="text-[11px] font-bold truncate">{appt.client_name || L('Walk-in', 'Walk-in')}</p>
                              <p className="text-[10px] opacity-80 truncate">{appt.service_names || ''}</p>
                            </button>
                          </div>
                        )
                      }

                      return (
                        <div key={emp.id}
                          className="flex-1 min-w-[140px] border-l border-slate-50 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                          onClick={() => {
                            setShowCreate(true)
                          }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile: appointment list */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-white/10">
              {appointments.length === 0 ? (
                <p className="text-center py-12 text-[12px] text-slate-400 dark:text-white/40">
                  {L('No hay citas para este dia.', 'No appointments for this day.')}
                </p>
              ) : (
                appointments
                  .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
                  .map(appt => {
                    const st = APPT_STATUS[appt.status] || APPT_STATUS.programada
                    return (
                      <button key={appt.id} onClick={() => setEditAppt(appt)}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Clock size={12} className="text-slate-400 dark:text-white/40" />
                            <span className="text-[13px] font-bold text-slate-700 dark:text-white">{appt.start_time}</span>
                            <span className="text-[11px] text-slate-400 dark:text-white/40">({appt.duration || 60} min)</span>
                          </div>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${st.bg} ${st.text}`}>
                            {L(st.label_es, st.label_en)}
                          </span>
                        </div>
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">
                          {appt.client_name || L('Walk-in', 'Walk-in')}
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-white/50">
                            <User size={11} />
                            <span className="truncate">{appt.empleado_name || '---'}</span>
                          </div>
                          {appt.service_names && (
                            <span className="text-[11px] text-slate-400 dark:text-white/40 truncate max-w-[150px]">
                              {appt.service_names}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <AppointmentModal
          appointment={null} clients={clients} empleados={empleados} services={services}
          date={selectedDate} lang={lang} onSave={handleSave} onClose={() => setShowCreate(false)}
        />
      )}
      {editAppt && (
        <AppointmentModal
          appointment={editAppt} clients={clients} empleados={empleados} services={services}
          date={selectedDate} lang={lang} onSave={handleSave} onClose={() => setEditAppt(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-slate-800 dark:bg-white/10 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}
    </div>
  )
}
