/**
 * Appointments.jsx — Day-view appointment calendar for salon/barbershop.
 *
 * v2.16.1 — Phase 4c hardening:
 *  - Top-bar mode toggle: Citas / Walk-ins / Todos.
 *  - Walk-in pre-fills now() rounded up to next :15, duration 30, is_walk_in=true.
 *  - Slot color codes: walk-ins crimson, citas sky/emerald, available white+crimson border,
 *    out-of-schedule slots greyed/non-clickable based on stylist_schedules.
 *  - Preferred-stylist tooltip + inline badge on appointment blocks.
 *  - Status modal: "Enviar recordatorio ahora" (PlanGate salon_whatsapp_reminders).
 *  - No-show flow: confirm + auto-charge E32 deposit fee via existing CobrarModal
 *    when deposit_status='held' (PlanGate salon_no_show_deposit), else stamp+bump.
 *  - Client-cell red "{N} no-show" pill when clients.no_show_count >= 2.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { fromZonedTime, toZonedTime, format as formatTz } from 'date-fns-tz'

// Santo Domingo is the only timezone Terminal X targets. Centralised so a
// future expansion (e.g. PR / multi-region) only edits one constant.
//
// v2.16.7 — The previous hand-rolled `T12:00:00` UTC roll-over guard worked
// for *display* but silently drifted any time a Date was round-tripped
// through `toISOString()` (sync queue, JSON serialisation, server logs).
// `date-fns-tz` gives us a single authoritative source: every Date that
// represents "what day is it in Santo Domingo right now" goes through
// `toZonedTime`, every string-date we send back to the DB / RPC goes
// through `fromZonedTime`. No more silent off-by-one at 8 PM AST.
const TX_TZ = 'America/Santo_Domingo'

// date-fns-tz v3 renamed v1's `zonedTimeToUtc` → `fromZonedTime` and
// `utcToZonedTime` → `toZonedTime`. We re-export the old names as no-cost
// aliases so any future code (or grep) that uses the canonical pre-v3 API
// continues to work.
const zonedTimeToUtc = fromZonedTime
const utcToZonedTime = toZonedTime
import {
  Calendar, Plus, X, Search, Clock, User, Scissors,
  Loader2, CheckCircle2, AlertCircle, ChevronLeft,
  ChevronRight, UserX, UserPlus, MessageSquare, AlertTriangle, Star,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'
import { usePlan } from '../../hooks/usePlan'
import CobrarModal from '../../components/CobrarModal'
import PaymentErrorBoundary from '../../components/PaymentErrorBoundary'

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

// All date helpers are timezone-aware. Input "d" is either a YYYY-MM-DD string
// (from the DB / form) or a Date instance. We always interpret YYYY-MM-DD as
// "midnight in Santo Domingo on that calendar date", never as UTC.
function fmtDate(d) {
  // Anchor to noon Santo Domingo to avoid any DST edge case (DR doesn't
  // observe DST, but this is the same defensive idiom used elsewhere).
  const utc = zonedTimeToUtc(`${d}T12:00:00`, TX_TZ)
  return utc.toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TX_TZ })
}

// Build YYYY-MM-DD from a Date as observed from Santo Domingo. Replaces the
// hand-rolled `getFullYear/getMonth/getDate` trio that depended on the host
// machine's local clock — a kiosk in Miami or a CI runner in UTC would hand
// back the wrong calendar date for tickets created late at night.
function toDateStr(d) {
  const zoned = utcToZonedTime(d instanceof Date ? d : new Date(d), TX_TZ)
  return formatTz(zoned, 'yyyy-MM-dd', { timeZone: TX_TZ })
}

function timeToSlotIndex(timeStr) {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return ((h - 8) * 2) + (m >= 30 ? 1 : 0)
}

function slotSpan(durationMin) {
  return Math.max(1, Math.round(durationMin / 30))
}

// Round a Date up to the next :15 increment.
function roundUpTo15(d = new Date()) {
  const m = d.getMinutes()
  const add = (15 - (m % 15)) % 15 || 15
  const out = new Date(d)
  out.setMinutes(m + add, 0, 0)
  return out
}

function timeStrFromDate(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// "HH:MM" comparison helper.
function cmpHHMM(a, b) {
  return (a || '').localeCompare(b || '')
}

// Returns true if HH:MM is inside [start_time, end_time] (closed/open interval).
function isInsideSchedule(timeStr, schedRow) {
  if (!schedRow) return false
  return cmpHHMM(timeStr, schedRow.start_time) >= 0 && cmpHHMM(timeStr, schedRow.end_time) < 0
}

// ── Appointment Form Modal ───────────────────────────────────────────────────

function AppointmentModal({
  appointment, clients, empleados, services, date, lang, onSave, onClose,
  prefill, onMarkNoShow, onSendReminder, hasFeature, currentClient,
  onVoidNoShowFee,
}) {
  const L = (es, en) => lang === 'es' ? es : en

  const [form, setForm] = useState({
    client_id:    appointment?.client_id    || '',
    empleado_id:  appointment?.empleado_id  || prefill?.empleado_id || '',
    date:         appointment?.date         || date,
    start_time:   appointment?.start_time   || prefill?.start_time || '09:00',
    duration:     appointment?.duration     || prefill?.duration || 60,
    service_ids:  appointment?.service_ids  || [],
    notes:        appointment?.notes        || '',
    status:       appointment?.status       || 'programada',
    is_walk_in:   appointment ? !!appointment.is_walk_in : !!prefill?.is_walk_in,
  })
  const [saving, setSaving] = useState(false)
  const [reminding, setReminding] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-pick preferred stylist when client picked + no stylist set yet.
  useEffect(() => {
    if (form.empleado_id || !form.client_id) return
    const c = clients.find(x => String(x.id) === String(form.client_id))
    const psId = c?.preferred_stylist_supabase_id
    if (!psId) return
    const emp = empleados.find(e => e.supabase_id === psId)
    if (emp) set('empleado_id', String(emp.id))
  }, [form.client_id]) // eslint-disable-line react-hooks/exhaustive-deps

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
        is_walk_in:  !!form.is_walk_in,
      }
      if (appointment?.id) data.id = appointment.id
      await onSave(data)
    } catch (ex) {
      setErr(ex?.message || L('Error al guardar', 'Error saving'))
    } finally {
      setSaving(false)
    }
  }

  async function handleSendReminder() {
    if (!appointment?.supabase_id) return
    setReminding(true)
    try { await onSendReminder(appointment.supabase_id) }
    finally { setReminding(false) }
  }

  // Build "client info" badges (preferred stylist + no-show count).
  const clientObj = appointment?.client_id
    ? clients.find(c => String(c.id) === String(appointment.client_id))
    : (form.client_id ? clients.find(c => String(c.id) === String(form.client_id)) : null)
  const psId = clientObj?.preferred_stylist_supabase_id
  const psEmp = psId ? empleados.find(e => e.supabase_id === psId) : null
  const noShowCount = Number(clientObj?.no_show_count || 0)
  const empMatchesPref = psEmp && String(psEmp.id) === String(form.empleado_id)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Calendar size={16} className="text-[#b3001e]" />
            {appointment ? L('Editar Cita', 'Edit Appointment') : (form.is_walk_in ? L('Walk-in', 'Walk-in') : L('Nueva Cita', 'New Appointment'))}
            {form.is_walk_in && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-[#b3001e] px-2 py-0.5 rounded-full">
                Walk-in
              </span>
            )}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Client info badges */}
          {clientObj && (psEmp || noShowCount >= 2) && (
            <div className="flex flex-wrap gap-2">
              {psEmp && (
                <span
                  title={empMatchesPref ? '' : L(`Cliente prefiere a ${psEmp.nombre}`, `Client prefers ${psEmp.nombre}`)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    empMatchesPref
                      ? 'bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/30'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/50 border border-slate-200 dark:border-white/10'
                  }`}>
                  <Star size={10} className={empMatchesPref ? 'fill-[#b3001e]' : ''} />
                  {L('Prefiere a', 'Prefers')} {psEmp.nombre}
                </span>
              )}
              {noShowCount >= 2 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-500/40">
                  <UserX size={10} />
                  {noShowCount} {L('no-show', 'no-show')}
                </span>
              )}
            </div>
          )}

          {/* Client */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Cliente', 'Client')}
            </label>
            <select value={form.client_id} onChange={e => set('client_id', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40">
              <option value="">{L('Walk-in / Sin cliente', 'Walk-in / No client')}</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name || c.nombre}
                  {Number(c.no_show_count || 0) >= 2 ? `  · ${c.no_show_count} no-show` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Stylist */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Estilista / Empleado *', 'Stylist / Employee *')}
            </label>
            <select value={form.empleado_id} onChange={e => { set('empleado_id', e.target.value); setErr('') }}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40">
              <option value="">{L('Seleccionar...', 'Select...')}</option>
              {empleados.map(e => (
                <option key={e.id} value={e.id}>
                  {e.nombre}{psEmp && e.id === psEmp.id ? '  ★' : ''}
                </option>
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
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Hora inicio', 'Start time')}
              </label>
              <select value={form.start_time} onChange={e => set('start_time', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40">
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
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40">
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

          {/* Deposit info (edit mode, when held) */}
          {appointment && appointment.deposit_status === 'held' && (
            <div className="px-3 py-2 rounded-lg bg-[#b3001e]/5 border border-[#b3001e]/30 text-[11px] text-[#b3001e] font-semibold flex items-center gap-2">
              <AlertTriangle size={12} />
              {L(`Depósito retenido: RD$${Number(appointment.deposit_dop || 0).toFixed(2)}`,
                 `Deposit held: RD$${Number(appointment.deposit_dop || 0).toFixed(2)}`)}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Notas', 'Notes')}
            </label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40 resize-none" />
          </div>

          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <div className="flex flex-wrap gap-2">
            {appointment && hasFeature?.('salon_whatsapp_reminders') && appointment.supabase_id && (
              <button type="button" onClick={handleSendReminder} disabled={reminding}
                className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors disabled:opacity-50">
                {reminding ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
                {L('Enviar recordatorio', 'Send reminder')}
              </button>
            )}
            {appointment && appointment.status !== 'no_show' && (
              <button type="button" onClick={() => onMarkNoShow(appointment)}
                className="px-3 py-2 text-[11px] font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                No Show
              </button>
            )}
            {appointment && appointment.no_show_fee_charged === true && onVoidNoShowFee && (
              <button type="button" onClick={() => onVoidNoShowFee(appointment)}
                className="px-3 py-2 text-[11px] font-semibold text-[#b3001e] border border-[#b3001e] rounded-lg hover:bg-[#b3001e] hover:text-white transition-colors">
                {L('Anular cargo no-show', 'Void no-show fee')}
              </button>
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

// ── No-show confirm dialog ───────────────────────────────────────────────────
function NoShowConfirm({ appointment, lang, onConfirm, onCancel }) {
  const L = (es, en) => lang === 'es' ? es : en
  const heldDeposit = appointment?.deposit_status === 'held'
  const fee = Number(appointment?.deposit_dop || 0)
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center gap-2">
          <AlertTriangle size={16} className="text-[#b3001e]" />
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">
            {L('Marcar como No-show', 'Mark as no-show')}
          </h3>
        </div>
        <div className="p-5 space-y-3">
          {heldDeposit ? (
            <p className="text-[13px] text-slate-700 dark:text-white/80">
              {L(`Se cobrará RD$${fee.toFixed(2)} por no presentación + e-CF E32 al consumidor final.`,
                 `RD$${fee.toFixed(2)} no-show fee will be charged + E32 e-CF (final consumer).`)}
            </p>
          ) : (
            <p className="text-[13px] text-slate-700 dark:text-white/80">
              {L('Se registrará la inasistencia y aumentará el contador del cliente.',
                 'No-show will be recorded and the client counter will increment.')}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10">
          <button onClick={onCancel}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg">
            {L('Cancelar', 'Cancel')}
          </button>
          <button onClick={onConfirm}
            className="px-4 py-2 text-[12px] font-bold bg-[#b3001e] text-white hover:bg-[#8c0017] rounded-lg">
            {heldDeposit ? L('Cobrar y registrar', 'Charge and record') : L('Registrar no-show', 'Record no-show')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function Appointments() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const { hasFeature } = usePlan()
  const L = (es, en) => lang === 'es' ? es : en

  const [appointments, setAppointments] = useState([])
  const [clients,      setClients]      = useState([])
  const [empleados,    setEmpleados]    = useState([])
  const [services,     setServices]     = useState([])
  const [schedules,    setSchedules]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()))
  const [showCreate,   setShowCreate]   = useState(false)
  const [createPrefill,setCreatePrefill]= useState(null)
  const [editAppt,     setEditAppt]     = useState(null)
  const [noShowTarget, setNoShowTarget] = useState(null)
  const [cobrarTicket, setCobrarTicket] = useState(null) // for no-show fee charge
  const [pendingFee,   setPendingFee]   = useState(null) // {client_supabase_id, fee_amount, appointment_supabase_id}
  const [toast,        setToast]        = useState(null)
  const [mode,         setMode]         = useState('all') // 'all' | 'citas' | 'walkins'

  const gridRef = useRef(null)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function loadAll() {
    setLoading(true)
    try {
      const [appts, c, e, s, sch] = await Promise.all([
        api?.appointments?.list?.({ date: selectedDate }) || [],
        api?.clients?.all?.() || [],
        api?.empleados?.all?.() || [],
        api?.services?.getAll?.() || [],
        api?.stylistSchedules?.list?.() || [],
      ])
      setAppointments(appts || [])
      setClients(c || [])
      setEmpleados(e || [])
      setServices(s || [])
      setSchedules(sch || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [selectedDate])

  async function handleSave(data) {
    if (data.id) await api.appointments.update(data)
    else         await api.appointments.create(data)
    setShowCreate(false)
    setCreatePrefill(null)
    setEditAppt(null)
    await loadAll()
    flash(data.id ? L('Cita actualizada', 'Appointment updated') : L('Cita creada', 'Appointment created'))
  }

  function handleWalkIn() {
    const start = roundUpTo15(new Date())
    setCreatePrefill({
      start_time: timeStrFromDate(start),
      duration: 30,
      is_walk_in: true,
    })
    setShowCreate(true)
  }

  function changeDate(delta) {
    // Operate on the Santo Domingo wall-clock date, not the host clock.
    // `fromZonedTime` gives us the UTC instant for "noon AST on selectedDate";
    // adding `delta` days then re-zoning yields the correct neighbour day
    // even if the user is on a UTC server / different-timezone laptop.
    const utcAtNoon = zonedTimeToUtc(`${selectedDate}T12:00:00`, TX_TZ)
    utcAtNoon.setUTCDate(utcAtNoon.getUTCDate() + delta)
    setSelectedDate(toDateStr(utcAtNoon))
  }

  async function handleVoidNoShowFee(appt) {
    // v2.16.3 — anular cargo no-show. Emite Nota de Crédito Electrónica (E34)
    // referenciando la E32 original (consumidor final). El botón está gateado
    // por no_show_fee_charged === true, así que solo corre cuando hay un cargo
    // activo. La orquestación vive en packages/services/voidNoShowFee.js.
    if (!appt?.supabase_id) return
    const fee = Number(appt?.deposit_dop || 0)
    const feeStr = fee > 0 ? `RD$${fee.toFixed(2)}` : ''
    const confirmMsg = L(
      `¿Anular el cargo de no-show ${feeStr}? Se emitirá una Nota de Crédito (E34) que va a la DGII.`,
      `Void the ${feeStr} no-show fee? A Credit Note (E34) will be issued and submitted to DGII.`
    )
    if (!confirm(confirmMsg)) return
    try {
      if (!api?.tickets?.voidNoShowFee) {
        flash(L('Funcionalidad no disponible en este build', 'Helper not available in this build'))
        return
      }
      const res = await api.tickets.voidNoShowFee({ appointment_supabase_id: appt.supabase_id })
      if (!res?.ok) {
        const code = res?.error || 'unknown'
        if (code === 'original_ticket_not_found') {
          flash(L('No se encontró el ticket original. Anula manualmente.',
                  'Original ticket not found. Void manually.'))
        } else if (code === 'fee_not_charged') {
          flash(L('Este cargo ya no está activo.', 'This fee is no longer active.'))
        } else if (code === 'ncf_reserve_failed') {
          flash(L('No se pudo reservar el NCF E34. Verifica las secuencias en DGII.',
                  'Could not reserve E34 NCF. Check DGII sequences.'))
        } else {
          flash(L(`Error al anular: ${code}`, `Void error: ${code}`))
        }
        return
      }
      await loadAll()
      const ncfStr = res.ncf || ''
      // v2.16.3 followup #2 — distinguish DGII-accepted vs queued-for-retry.
      // When DGII is unreachable, processDgiiQueue retries within 72h with
      // IndicadorEnvioDiferido=1; tell the operator instead of falsely
      // implying the credit note is already on file.
      if (res.deferred) {
        flash(L(`Cargo anulado · Nota de Crédito ${ncfStr} en cola DGII (reintenta automático)`,
                `Fee voided · Credit Note ${ncfStr} queued for DGII (auto-retry)`))
      } else {
        flash(L(`Cargo anulado · Nota de Crédito ${ncfStr}`,
                `Fee voided · Credit Note ${ncfStr}`))
      }
      setEditAppt(null)
    } catch (e) {
      flash(e?.message || L('Error al anular', 'Void error'))
    }
  }

  async function handleSendReminder(supabase_id) {
    try {
      // Prefer a typed wrapper if shipped; fall back to a raw POST against panel.js.
      if (api?.salonWhatsapp?.sendNow) {
        await api.salonWhatsapp.sendNow({ appointment_supabase_id: supabase_id })
      } else {
        const r = await fetch('/api/panel?action=salon-whatsapp-send-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ appointment_supabase_id: supabase_id }),
        })
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Send failed')
      }
      flash(L('Recordatorio enviado', 'Reminder sent'))
    } catch (e) {
      flash(e?.message || L('Error al enviar', 'Send error'))
    }
  }

  async function handleNoShowConfirm() {
    const appt = noShowTarget
    setNoShowTarget(null)
    if (!appt?.supabase_id) return
    try {
      const r = await api?.appointments?.markNoShow?.(appt.supabase_id) || {}
      if (r?.shouldChargeFee && hasFeature('salon_no_show_deposit')) {
        // Pre-fill cart with one fee line and route through CobrarModal in E32 final-consumer mode.
        const fee = Number(r.fee_amount || appt.deposit_dop || 0)
        setPendingFee({
          appointment_supabase_id: appt.supabase_id,
          client_supabase_id: r.client_supabase_id || null,
          fee_amount: fee,
        })
        setCobrarTicket({
          id: `noshow-${appt.id}`,
          ticketNo: `NS-${appt.id}`,
          vehicle: '',
          services: [{
            id: `noshow-${appt.id}`,
            name: L('No presentación', 'No-show fee'),
            price: fee,
            qty: 1,
          }],
          supabase_id: null,
        })
      } else {
        flash(L('No-show registrado', 'No-show recorded'))
        await loadAll()
      }
      setEditAppt(null)
    } catch (e) {
      flash(e?.message || L('Error', 'Error'))
    }
  }

  async function handleNoShowCobrarConfirm(payload) {
    // v2.16.1 patch (#3) — actually book the no-show ticket. The previous
    // version closed the modal and reloaded but never called tickets.create
    // or appointments.update, so the e-CF (E32) was reserved + signed without
    // a corresponding tickets row, and no_show_fee_charged stayed false → the
    // cashier could re-charge the same no-show indefinitely.
    const fee = Number(pendingFee?.fee_amount || 0)
    const apptSid = pendingFee?.appointment_supabase_id || null
    try {
      // 1. Book the ticket using the standard helper. forceNcfType='E32' on
      //    the modal already constrains the comprobante; mirror it here.
      const ticketRes = await api?.tickets?.create?.({
        items: [{
          name: L('No presentación', 'No-show fee'),
          price: fee,
          quantity: 1,
          is_wash: 0,
          aplica_itbis: 1,
        }],
        subtotal: fee, total: fee, itbis: 0, ley: 0,
        comprobante_type: payload?.ncfType || 'E32',
        ncf: payload?.ecf?.eNCF || null,
        is_consumer_final: true,
        appointment_supabase_id: apptSid,
        // v2.16.10 — Supabase tickets has no client_id col; use *_supabase_id
        // + name snapshot (audit 2026-04-30 — same bug class as Ranoza credit).
        client_supabase_id: pendingFee?.client_supabase_id || payload?.clientSupabaseId || null,
        client_name:        payload?.clientName || null,
        payment_method: payload?.formaPago || 'efectivo',
        payment_parts: payload?.payment_parts || null,
        tipo_venta: payload?.tipo || 'contado',
        status: 'cobrado',
        comentario: payload?.comentario || `No-show fee · appt ${apptSid || ''}`,
        ecf_result: payload?.ecf || {},
      })
      // 2. Mark the appointment so the row can never be charged twice.
      // v2.16.3 — stamp `no_show_fee_ticket_supabase_id` so voidNoShowFee can
      // resolve the original E32 in O(1) without scanning ticket history.
      if (apptSid) {
        try {
          await api?.appointments?.update?.(apptSid, {
            no_show_fee_charged: true,
            deposit_status: 'forfeited',
            no_show_fee_ticket_supabase_id: ticketRes?.supabase_id || null,
          })
        } catch (e) { console.warn('[no-show] appointment.update failed', e?.message || e) }
      }
      setCobrarTicket(null)
      setPendingFee(null)
      flash(L(`No-show cobrado · ${ticketRes?.docNumber || ''}`.trim(),
              `No-show charged · ${ticketRes?.docNumber || ''}`.trim()))
      await loadAll()
    } catch (e) {
      flash(e?.message || L('Error al cobrar no-show', 'No-show charge error'))
    }
  }

  // Schedule lookup by `${empleado_id}-${dow}` → schedule row
  const schedByKey = useMemo(() => {
    const m = new Map()
    for (const s of schedules) m.set(`${s.empleado_id}-${s.day_of_week}`, s)
    return m
  }, [schedules])

  // Day-of-week calculated from the Santo Domingo wall clock, not the host
  // clock — `getDay()` on a Date is host-tz-dependent and would return
  // Monday at 11:30 PM AST Sunday on a UTC server.
  const selectedDow = useMemo(() => {
    const zoned = utcToZonedTime(zonedTimeToUtc(`${selectedDate}T12:00:00`, TX_TZ), TX_TZ)
    return zoned.getDay()
  }, [selectedDate])

  // Filter appointments by mode toggle.
  const filteredAppointments = useMemo(() => {
    if (mode === 'citas')   return appointments.filter(a => !a.is_walk_in)
    if (mode === 'walkins') return appointments.filter(a => !!a.is_walk_in)
    return appointments
  }, [appointments, mode])

  // Summary metrics (always against filtered set so toggle is honest).
  const metrics = useMemo(() => {
    const total = filteredAppointments.length
    const completadas = filteredAppointments.filter(a => a.status === 'completada').length
    const pendientes = filteredAppointments.filter(a => ['programada', 'confirmada'].includes(a.status)).length
    const noShow = filteredAppointments.filter(a => a.status === 'no_show').length
    const walkInCount = appointments.filter(a => !!a.is_walk_in).length
    return { total, completadas, pendientes, noShow, walkInCount }
  }, [filteredAppointments, appointments])

  // Group appointments by stylist for grid (uses filtered set so columns track mode).
  const activeEmpleados = useMemo(() => {
    const empIds = new Set(filteredAppointments.map(a => a.empleado_id))
    return empleados.filter(e => empIds.has(e.id) || e.active !== 0).slice(0, 8) // max 8 columns
  }, [empleados, filteredAppointments])

  const apptsByEmployee = useMemo(() => {
    const map = {}
    activeEmpleados.forEach(e => { map[e.id] = [] })
    filteredAppointments.forEach(a => {
      if (!map[a.empleado_id]) map[a.empleado_id] = []
      map[a.empleado_id].push(a)
    })
    return map
  }, [filteredAppointments, activeEmpleados])

  // Client lookup for badges/tooltips
  const clientById = useMemo(() => {
    const m = new Map()
    for (const c of clients) m.set(String(c.id), c)
    return m
  }, [clients])

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

            {/* Mode toggle */}
            <div className="ml-2 inline-flex items-center gap-0 p-0.5 bg-slate-100 dark:bg-white/5 rounded-lg text-[11px] font-bold">
              <button onClick={() => setMode('all')}
                className={`px-2.5 py-1 rounded-md transition-colors ${mode === 'all' ? 'bg-white dark:bg-white/10 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-white/50'}`}>
                {L('Todos', 'All')}
              </button>
              <button onClick={() => setMode('citas')}
                className={`px-2.5 py-1 rounded-md transition-colors ${mode === 'citas' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 dark:text-white/50'}`}>
                {L('Citas', 'Booked')}
              </button>
              {hasFeature('salon_walk_in_mode') && (
                <button onClick={() => setMode('walkins')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${mode === 'walkins' ? 'bg-[#b3001e] text-white shadow-sm' : 'text-slate-500 dark:text-white/50'}`}>
                  Walk-ins
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasFeature('salon_walk_in_mode') && (
              <button onClick={handleWalkIn}
                className="flex items-center gap-2 px-4 py-2 border border-[#b3001e]/40 text-[#b3001e] rounded-xl text-sm font-semibold hover:bg-[#b3001e]/10 transition-colors">
                <UserPlus size={15} /> Walk-in
              </button>
            )}
            <button onClick={() => { setCreatePrefill(null); setShowCreate(true) }}
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
              className="text-[12px] font-semibold text-[#b3001e] hover:underline">
              {L('Ir a hoy', 'Go to today')}
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="px-3 md:px-6 py-3 grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
        {[
          { label: L('Total', 'Total'),                    value: metrics.total,        color: 'text-slate-700 dark:text-white' },
          { label: L('Walk-ins', 'Walk-ins'),              value: metrics.walkInCount,  color: metrics.walkInCount > 0 ? 'text-[#b3001e]' : 'text-slate-700 dark:text-white' },
          { label: L('Completadas', 'Completed'),          value: metrics.completadas,  color: 'text-emerald-600 dark:text-emerald-400' },
          { label: L('Pendientes', 'Pending'),             value: metrics.pendientes,   color: 'text-sky-600 dark:text-sky-400' },
          { label: L('No Show', 'No Show'),                value: metrics.noShow,       color: metrics.noShow > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-white' },
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

                      // Out-of-schedule check (only when stylist HAS a schedule
                      // row for this dow — empty schedule = always available
                      // for back-compat with the day-view).
                      const sch = schedByKey.get(`${emp.id}-${selectedDow}`)
                      const hasSchedule = !!sch
                      const inside = !hasSchedule || isInsideSchedule(slot.label, sch)

                      if (appt) {
                        const st = APPT_STATUS[appt.status] || APPT_STATUS.programada
                        const span = slotSpan(appt.duration || 60)
                        const isWI = !!appt.is_walk_in
                        const blockBg = isWI ? 'bg-[#b3001e]' : st.block
                        const c = appt.client_id ? clientById.get(String(appt.client_id)) : null
                        const noShowPill = c && Number(c.no_show_count || 0) >= 2
                        const psId = c?.preferred_stylist_supabase_id
                        const matchesPref = psId && empleados.find(e => e.supabase_id === psId)?.id === emp.id
                        return (
                          <div key={emp.id} className="flex-1 min-w-[140px] border-l border-slate-50 dark:border-white/5 relative">
                            <button
                              onClick={() => setEditAppt(appt)}
                              title={isWI ? L('Walk-in', 'Walk-in') : ''}
                              className={`absolute inset-x-1 top-0 rounded-lg px-2 py-1 text-left transition-all hover:brightness-110 cursor-pointer ${blockBg} ${isWI ? 'border-2 border-[#b3001e] ring-1 ring-[#b3001e]/30' : ''} text-white overflow-hidden`}
                              style={{ height: `${span * 40}px`, zIndex: 5 }}>
                              <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                                <p className="text-[11px] font-bold truncate">{appt.client_name || L('Walk-in', 'Walk-in')}</p>
                                {matchesPref && <Star size={9} className="fill-white shrink-0" />}
                                {noShowPill && (
                                  <span className="text-[8px] font-bold bg-white text-[#b3001e] px-1 rounded-full">
                                    {c.no_show_count} NS
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] opacity-80 truncate">{appt.service_names || ''}</p>
                            </button>
                          </div>
                        )
                      }

                      // Empty slot — outside schedule = greyed/non-clickable.
                      if (!inside) {
                        return (
                          <div key={emp.id}
                            className="flex-1 min-w-[140px] border-l border-slate-50 dark:border-white/5 bg-slate-100/60 dark:bg-white/5 opacity-30 cursor-not-allowed"
                            title={L('Fuera de horario', 'Outside schedule')}
                          />
                        )
                      }

                      // Empty + within schedule — white with crimson hint border.
                      // v2.16.2 (item #10) — accessible button with keyboard
                      // activation (Enter/Space) and a descriptive aria-label.
                      const openSlot = () => {
                        setCreatePrefill({
                          empleado_id: String(emp.id),
                          start_time: slot.label,
                          duration: 60,
                          is_walk_in: false,
                        })
                        setShowCreate(true)
                      }
                      return (
                        <button
                          key={emp.id}
                          type="button"
                          aria-label={L(`Reservar ${slot.label} con ${emp.nombre}`, `Book ${slot.label} with ${emp.nombre}`)}
                          onClick={openSlot}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openSlot()
                            }
                          }}
                          className="flex-1 min-w-[140px] border-l border-slate-50 dark:border-white/5 hover:bg-[#b3001e]/5 cursor-pointer transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b3001e] focus-visible:ring-inset relative bg-transparent text-left"
                        >
                          <div className="absolute inset-1 border border-dashed border-[#b3001e]/0 group-hover:border-[#b3001e]/30 rounded pointer-events-none" />
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile: appointment list */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-white/10">
              {filteredAppointments.length === 0 ? (
                <p className="text-center py-12 text-[12px] text-slate-400 dark:text-white/40">
                  {L('No hay citas para este dia.', 'No appointments for this day.')}
                </p>
              ) : (
                filteredAppointments
                  .slice()
                  .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
                  .map(appt => {
                    const st = APPT_STATUS[appt.status] || APPT_STATUS.programada
                    const isWI = !!appt.is_walk_in
                    const c = appt.client_id ? clientById.get(String(appt.client_id)) : null
                    const noShowPill = c && Number(c.no_show_count || 0) >= 2
                    return (
                      <button key={appt.id} onClick={() => setEditAppt(appt)}
                        className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors ${isWI ? 'border-l-4 border-[#b3001e]' : ''}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Clock size={12} className="text-slate-400 dark:text-white/40" />
                            <span className="text-[13px] font-bold text-slate-700 dark:text-white">{appt.start_time}</span>
                            <span className="text-[11px] text-slate-400 dark:text-white/40">({appt.duration || 60} min)</span>
                            {isWI && (
                              <span className="text-[9px] font-bold uppercase bg-[#b3001e] text-white px-1.5 py-0.5 rounded-full">
                                Walk-in
                              </span>
                            )}
                          </div>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${st.bg} ${st.text}`}>
                            {L(st.label_es, st.label_en)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">
                            {appt.client_name || L('Walk-in', 'Walk-in')}
                          </p>
                          {noShowPill && (
                            <span className="text-[9px] font-bold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                              {c.no_show_count} no-show
                            </span>
                          )}
                        </div>
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
          date={selectedDate} lang={lang} onSave={handleSave}
          onClose={() => { setShowCreate(false); setCreatePrefill(null) }}
          prefill={createPrefill}
          hasFeature={hasFeature}
          onSendReminder={handleSendReminder}
          onMarkNoShow={() => {}}
        />
      )}
      {editAppt && (
        <AppointmentModal
          appointment={editAppt} clients={clients} empleados={empleados} services={services}
          date={selectedDate} lang={lang} onSave={handleSave}
          onClose={() => setEditAppt(null)}
          hasFeature={hasFeature}
          onSendReminder={handleSendReminder}
          onMarkNoShow={(a) => setNoShowTarget(a)}
          onVoidNoShowFee={handleVoidNoShowFee}
        />
      )}
      {noShowTarget && (
        <NoShowConfirm appointment={noShowTarget} lang={lang}
          onCancel={() => setNoShowTarget(null)}
          onConfirm={handleNoShowConfirm} />
      )}
      {cobrarTicket && (
        <PaymentErrorBoundary onClose={() => { setCobrarTicket(null); setPendingFee(null) }}>
          <CobrarModal
            ticket={cobrarTicket}
            forceNcfType="E32"
            onClose={() => { setCobrarTicket(null); setPendingFee(null) }}
            onConfirm={handleNoShowCobrarConfirm}
          />
        </PaymentErrorBoundary>
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
