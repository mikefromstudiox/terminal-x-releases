/**
 * Reservations.jsx — v2.16.3 Restaurante H4
 *
 * Front-of-house reservation manager. Pro PLUS+ (gated by
 * `restaurant_reservations`). Brand: black/white/#b3001e only — NO gray.
 * Spanish copy throughout.
 *
 * Flow:
 *   pendiente → confirmada → sentada
 *              ↘ cancelada  ↘ no_show
 *
 * WhatsApp confirmations open wa.me deep links and stamp `whatsapp_sent_at`.
 * "Sentar" prompts for an optional mesa, flips it to ocupada, and marks the
 * reservation 'sentada'. Activity log emits one row per transition.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Calendar, Clock, User, Phone, Users as UsersIcon, MessageSquare, Plus,
  Loader2, AlertCircle, X, Check, XCircle, Filter,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { normalizeWaPhone } from '@terminal-x/services/phone'

// ── Helpers ─────────────────────────────────────────────────────────────────
function todayISO()    { const d = new Date(); return d.toISOString().slice(0, 10) }
function tomorrowISO() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) }
function weekEndISO()  { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) }

function fmtFecha(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' })
  } catch { return iso }
}

function fmtHora(t) {
  if (!t) return ''
  // t comes back from Postgres as 'HH:MM:SS' or 'HH:MM' — strip seconds for display.
  const m = String(t).match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : t
}

const STATUS_META = {
  pendiente:   { label: 'Pendiente',   pill: 'bg-amber-500 text-black' },
  confirmada:  { label: 'Confirmada',  pill: 'bg-emerald-500 text-black' },
  sentada:     { label: 'Sentada',     pill: 'bg-[#b3001e] text-white' },
  cancelada:   { label: 'Cancelada',   pill: 'bg-black text-white' },
  no_show:     { label: 'No se presentó', pill: 'bg-black text-white' },
}

// ── New / Edit Modal ────────────────────────────────────────────────────────
function ReservationModal({ open, onClose, onSubmit, initial, mesas }) {
  // v2.16.26 — DO NOT REVERT (FIX-LEDGER §Batch6). Deposit fields wired to
  // the schema columns (deposit_amount/deposit_status) that were added in
  // Batch 5. Operators can now collect a forfeit-able deposit at booking.
  const [form, setForm] = useState(() => initial || {
    nombre: '', telefono: '', fecha: todayISO(), hora: '19:00',
    duration_min: 90, guests: 2, mesa_id: '', notas: '',
    deposit_amount: 0, deposit_status: null,
  })
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  useEffect(() => {
    if (open) {
      setForm(initial || { nombre: '', telefono: '', fecha: todayISO(), hora: '19:00', duration_min: 90, guests: 2, mesa_id: '', notas: '', deposit_amount: 0, deposit_status: null })
      setErr(null)
    }
  }, [open, initial])

  if (!open) return null

  const submit = async () => {
    setErr(null)
    if (!form.nombre.trim())     { setErr('Nombre requerido'); return }
    if (!form.fecha || !form.hora) { setErr('Fecha y hora requeridas'); return }
    setBusy(true)
    try {
      const dep = Math.max(0, Number(form.deposit_amount || 0))
      await onSubmit({
        ...form,
        nombre: form.nombre.trim(),
        telefono: form.telefono?.trim() || null,
        guests: Math.max(1, Number(form.guests || 1)),
        duration_min: Math.max(15, Number(form.duration_min || 90)),
        mesa_id: form.mesa_id || null,
        deposit_amount: dep || null,
        deposit_status: dep > 0 ? (form.deposit_status || 'held') : null,
      })
      onClose()
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'reservation.create_or_update.modal', extra: { id: initial?.id, fecha: form?.fecha } }) } catch {}
      setErr(e?.message || 'Error guardando reserva')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <div>
            <div className="text-base font-extrabold text-slate-900 dark:text-white">
              {initial ? 'Editar reserva' : 'Nueva reserva'}
            </div>
            <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Front-of-house</div>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 flex items-center justify-center disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        {err && (
          <div className="m-4 p-3 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/30 text-[#b3001e] text-xs flex items-center gap-2">
            <AlertCircle size={14} /> {err}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Nombre</label>
            <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Teléfono</label>
            <input value={form.telefono || ''} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
              placeholder="809-555-0000"
              className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Fecha</label>
              <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Hora</label>
              <input type="time" value={form.hora} onChange={e => setForm(f => ({ ...f, hora: e.target.value }))}
                className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Comensales</label>
              <input type="number" min="1" value={form.guests} onChange={e => setForm(f => ({ ...f, guests: e.target.value }))}
                className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Duración (min)</label>
              <input type="number" min="15" step="15" value={form.duration_min} onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))}
                className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]" />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Mesa preferida (opcional)</label>
            <select value={form.mesa_id || ''} onChange={e => setForm(f => ({ ...f, mesa_id: e.target.value }))}
              className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]">
              <option value="">Sin asignar</option>
              {(mesas || []).map(m => (
                <option key={m.id} value={m.id}>{m.name} {m.zone ? `· ${m.zone}` : ''} ({m.capacity || '?'})</option>
              ))}
            </select>
          </div>
          {/* v2.16.26 — Depósito de reserva */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Depósito (RD$)</label>
              <input type="number" min="0" step="100"
                value={form.deposit_amount || ''}
                onChange={e => setForm(f => ({ ...f, deposit_amount: e.target.value }))}
                placeholder="0"
                className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Estado depósito</label>
              <select value={form.deposit_status || ''} onChange={e => setForm(f => ({ ...f, deposit_status: e.target.value || null }))}
                className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]">
                <option value="">— Sin depósito —</option>
                <option value="held">Retenido</option>
                <option value="applied">Aplicado al ticket</option>
                <option value="refunded">Reembolsado</option>
                <option value="forfeited">Confiscado (no-show)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Notas</label>
            <textarea value={form.notas || ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} rows={2}
              placeholder="Cumpleaños, alergias, sillas para niños…"
              className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e] resize-none" />
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-zinc-900/50">
          <button onClick={onClose} disabled={busy}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5 font-medium disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={submit} disabled={busy}
            className="flex-1 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8a0017] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Seat Modal ──────────────────────────────────────────────────────────────
function SeatReservationModal({ open, onClose, onConfirm, mesas, reservation }) {
  const [mesaId, setMesaId] = useState('')
  useEffect(() => {
    if (open) setMesaId(reservation?.mesa_id ? String(reservation.mesa_id) : '')
  }, [open, reservation])

  if (!open) return null

  const free = (mesas || []).filter(m => ['libre', 'sucia', 'reservada'].includes(m.status))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-sm bg-white dark:bg-zinc-950 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <div>
            <div className="text-base font-extrabold text-slate-900 dark:text-white">Sentar reserva</div>
            <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5 truncate">
              {reservation?.nombre} · {reservation?.guests} pers.
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/60 font-bold mb-1.5 block">Mesa</label>
            <select value={mesaId} onChange={e => setMesaId(e.target.value)}
              className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]">
              <option value="">Sin mesa específica</option>
              {free.map(m => (
                <option key={m.id} value={m.id}>{m.name} {m.zone ? `· ${m.zone}` : ''} (cap. {m.capacity || '?'})</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5 font-medium">
              Cancelar
            </button>
            <button onClick={() => onConfirm(mesaId ? Number(mesaId) : null)}
              className="flex-1 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8a0017] text-white font-bold">
              Sentar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────────────────────
function ReservationCard({ r, bizName, onConfirm, onCancel, onSeat, onSendWhatsApp, onMarkNoShow }) {
  const meta = STATUS_META[r.status] || STATUS_META.pendiente
  const phone = normalizeWaPhone(r.telefono)
  const sentBefore = !!r.whatsapp_sent_at

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-16 text-center">
          <div className="text-2xl font-extrabold tracking-tight text-[#b3001e] tabular-nums">{fmtHora(r.hora)}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/50 mt-0.5">{fmtFecha(r.fecha)}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-base font-extrabold text-slate-900 dark:text-white truncate">{r.nombre}</span>
            <span className={`text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full ${meta.pill}`}>
              {meta.label.toUpperCase()}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-white/60 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><UsersIcon size={11} /> {r.guests} pers.</span>
            {r.telefono && (
              <a href={phone ? `https://wa.me/${phone}` : `tel:${r.telefono}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline">
                <Phone size={11} /> {r.telefono}
              </a>
            )}
            {r.mesa_id && <span className="inline-flex items-center gap-1 text-[#b3001e]">Mesa #{r.mesa_id}</span>}
          </div>
          {r.notas && (
            <div className="text-xs text-slate-500 dark:text-white/50 mt-1.5 italic">"{r.notas}"</div>
          )}
        </div>
      </div>

      {/* Actions */}
      {(r.status === 'pendiente' || r.status === 'confirmada') && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.status === 'pendiente' && (
            <button onClick={() => onConfirm(r)}
              className="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-black text-xs font-bold inline-flex items-center gap-1.5">
              <Check size={12} /> Confirmar
            </button>
          )}
          <button onClick={() => onSeat(r)}
            className="px-3 py-2 rounded-lg bg-[#b3001e] hover:bg-[#8a0017] text-white text-xs font-bold inline-flex items-center gap-1.5">
            <UsersIcon size={12} /> Sentar
          </button>
          {phone && (
            <button onClick={() => onSendWhatsApp(r, bizName)}
              className="px-3 py-2 rounded-lg border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs font-bold inline-flex items-center gap-1.5">
              <MessageSquare size={12} /> {sentBefore ? 'Reenviar' : 'Enviar confirmación'}
            </button>
          )}
          <button onClick={() => onCancel(r)}
            className="px-3 py-2 rounded-lg border border-[#b3001e]/40 text-[#b3001e] hover:bg-[#b3001e]/10 text-xs font-bold inline-flex items-center gap-1.5">
            <XCircle size={12} /> Cancelar
          </button>
          <button onClick={() => onMarkNoShow(r)}
            className="px-3 py-2 rounded-lg border border-black/20 dark:border-white/20 text-slate-700 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5 text-xs font-bold">
            No se presentó
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function Reservations() {
  const api = useAPI()
  const { user } = useAuth()
  const [date, setDate] = useState(todayISO())
  const [statusFilter, setStatusFilter] = useState('all') // all | pendiente | confirmada
  const [scope, setScope] = useState('day') // day | tomorrow | week
  const [list, setList] = useState([])
  const [mesas, setMesas] = useState([])
  const [bizName, setBizName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [seating, setSeating] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = scope === 'week'
        ? { dateFrom: todayISO(), dateTo: weekEndISO() }
        : { date: scope === 'tomorrow' ? tomorrowISO() : date }
      if (statusFilter !== 'all') params.status = statusFilter

      const [rows, mesaList, settings] = await Promise.all([
        api.restaurantReservations?.list?.(params) || [],
        api.mesas?.list?.() || [],
        api.settings?.get?.() || {},
      ])
      setList(Array.isArray(rows) ? rows : [])
      setMesas(Array.isArray(mesaList) ? mesaList : [])
      setBizName(settings?.business_name || settings?.biz_name || settings?.razon_social || '')
      setError(null)
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'reservation.load' }) } catch {}
      console.error('[Reservations] load failed', e)
      setError(e?.message || 'Error cargando reservas')
    } finally { setLoading(false) }
  }, [api, date, scope, statusFilter])

  useEffect(() => { reload() }, [reload])

  const onSubmit = async (form) => {
    try {
      if (editing) {
        await api.restaurantReservations.update(editing.id, form)
      } else {
        await api.restaurantReservations.create(form)
      }
      setEditing(null)
      setCreateOpen(false)
      await reload()
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'reservation.submit', extra: { editing: !!editing, id: editing?.id } }) } catch {}
      throw e
    }
  }

  const onConfirm = async (r) => {
    try { await api.restaurantReservations.confirm(r.id); await reload() }
    catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'reservation.confirm', extra: { id: r?.id } }) } catch {}
      setError(e?.message || 'Error confirmando reserva')
    }
  }

  const onCancel = async (r) => {
    const reason = window.prompt('Motivo de cancelación (opcional):') || null
    try { await api.restaurantReservations.cancel(r.id, reason); await reload() }
    catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'reservation.cancel', extra: { id: r?.id } }) } catch {}
      setError(e?.message || 'Error cancelando reserva')
    }
  }

  const onMarkNoShow = async (r) => {
    if (!window.confirm(`Marcar como NO se presentó: ${r.nombre}?`)) return
    try { await api.restaurantReservations.markNoShow(r.id); await reload() }
    catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'reservation.no_show', extra: { id: r?.id } }) } catch {}
      setError(e?.message || 'Error registrando no-show')
    }
  }

  const onSeat = (r) => setSeating(r)
  const confirmSeat = async (mesaId) => {
    if (!seating) return
    try {
      await api.restaurantReservations.seat(seating.id, mesaId)
      setSeating(null)
      await reload()
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'reservation.seat', extra: { id: seating?.id, mesaId } }) } catch {}
      setError(e?.message || 'Error sentando reserva')
    }
  }

  const onSendWhatsApp = async (r, biz) => {
    const phone = normalizeWaPhone(r.telefono)
    if (!phone) { setError('Teléfono no válido para WhatsApp'); return }
    const lugar = biz || 'nuestro restaurante'
    const text = `Hola ${r.nombre}, confirmamos su reserva en ${lugar} para ${fmtFecha(r.fecha)} a las ${fmtHora(r.hora)} para ${r.guests} ${r.guests === 1 ? 'persona' : 'personas'}. ¡Le esperamos!`
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener')
    try { await api.restaurantReservations.stampWhatsapp(r.id); await reload() }
    catch (e) { try { window.__txReportError?.(e, { severity: 'warn', category: 'reservation.whatsapp.stamp', extra: { id: r?.id } }) } catch {} }
  }

  const sortedList = useMemo(() => {
    return [...list].sort((a, b) => {
      const ka = (a.fecha || '') + 'T' + (a.hora || '')
      const kb = (b.fecha || '') + 'T' + (b.hora || '')
      return ka.localeCompare(kb)
    })
  }, [list])

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black p-5 lg:p-7">
      {/* Error toast */}
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] max-w-md p-3 rounded-xl bg-[#b3001e] text-white text-sm flex items-center justify-between gap-3 shadow-2xl">
          <span className="flex items-center gap-2"><AlertCircle size={16} /> {error}</span>
          <button onClick={() => setError(null)} className="text-white/80 hover:text-white"><X size={16} /></button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-[#b3001e]/10 grid place-items-center">
          <Calendar className="text-[#b3001e]" size={20} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Reservas</h1>
          <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">{sortedList.length} reservas en vista</p>
        </div>
        <button onClick={() => { setEditing(null); setCreateOpen(true) }}
          className="px-4 py-2.5 rounded-xl bg-[#b3001e] hover:bg-[#8a0017] text-white font-bold flex items-center gap-2 text-sm shadow-lg">
          <Plus size={16} /> Nueva
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {['day', 'tomorrow', 'week'].map(s => (
          <button key={s} onClick={() => setScope(s)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors border ${
              scope === s
                ? 'bg-[#b3001e] text-white border-[#b3001e]'
                : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40'
            }`}>
            {s === 'day' ? 'Hoy' : s === 'tomorrow' ? 'Mañana' : 'Toda la semana'}
          </button>
        ))}
        {scope === 'day' && (
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#b3001e]" />
        )}
        <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1" />
        <Filter size={14} className="text-slate-400 dark:text-white/40" />
        {[
          { id: 'all',         label: 'Todas' },
          { id: 'pendiente',   label: 'Pendiente' },
          { id: 'confirmada',  label: 'Confirmada' },
        ].map(f => (
          <button key={f.id} onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
              statusFilter === f.id
                ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40">
          <Loader2 size={20} className="animate-spin mr-2" /> Cargando…
        </div>
      ) : sortedList.length === 0 ? (
        <div className="text-center py-16 text-sm text-slate-400 dark:text-white/40">
          Sin reservas en este filtro.
        </div>
      ) : (
        <div className="space-y-2.5 max-w-3xl">
          {sortedList.map(r => (
            <ReservationCard key={r.id} r={r} bizName={bizName}
              onConfirm={onConfirm} onCancel={onCancel} onSeat={onSeat}
              onSendWhatsApp={onSendWhatsApp} onMarkNoShow={onMarkNoShow} />
          ))}
        </div>
      )}

      {/* Modals */}
      <ReservationModal
        open={createOpen}
        initial={editing}
        mesas={mesas}
        onClose={() => { setCreateOpen(false); setEditing(null) }}
        onSubmit={onSubmit}
      />

      <SeatReservationModal
        open={!!seating}
        reservation={seating}
        mesas={mesas}
        onClose={() => setSeating(null)}
        onConfirm={confirmSeat}
      />
    </div>
  )
}
