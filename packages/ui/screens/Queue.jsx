import { useState, useRef, useEffect } from 'react'
import { Search, Plus, ChevronDown, CheckCircle2, Loader2, RefreshCw, AlertCircle, Trash2, Pencil, Lock, MessageCircle } from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useQueueActive, useWashers } from '../hooks/useDB'
import CobrarModal from '../components/CobrarModal'
import PaymentErrorBoundary from '../components/PaymentErrorBoundary'
import ManagerAuthGate from '../components/ManagerAuthGate'
import { printClientReceipt, printWasherConduce } from '@terminal-x/services/printer'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import { hasModule } from '@terminal-x/config/businessTypes'
import { Navigate } from 'react-router-dom'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS = {
  pendiente: { es: 'Pendiente',  en: 'Pending',      bg: 'bg-amber-50 dark:bg-amber-500/10',  text: 'text-amber-700 dark:text-amber-400',  border: 'border-amber-200 dark:border-amber-500/30',  dot: 'bg-amber-500'  },
  proceso:   { es: 'En Proceso', en: 'In Progress',  bg: 'bg-blue-50 dark:bg-blue-500/10',   text: 'text-blue-700 dark:text-blue-400',   border: 'border-blue-200 dark:border-blue-500/30',   dot: 'bg-blue-500'   },
  listo:     { es: 'Listo',      en: 'Ready',        bg: 'bg-green-50 dark:bg-green-500/10',  text: 'text-green-700 dark:text-green-400',  border: 'border-green-200 dark:border-green-500/30',  dot: 'bg-green-500'  },
}

// DB status → UI status
// v2.3.30 — `ready` introduced so "listo" (green) stays visible in Cola until
// cashier explicitly Cobrars. Previously listo mapped to DB 'done', which the
// queue.active filter excluded → the row silently disappeared when the lavador
// marked it ready. 'done' still maps back to listo so any legacy rows keep
// rendering correctly on older data.
const FROM_DB  = { waiting: 'pendiente', in_progress: 'proceso', ready: 'listo', done: 'listo' }
// UI status → DB status
const TO_DB    = { pendiente: 'waiting', proceso: 'in_progress', listo: 'ready' }
// UI cycle order
const CYCLE_UI = { pendiente: 'proceso', proceso: 'listo', listo: 'listo' }

function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtTime(date) {
  // SQLite datetime('now') stores UTC as 'YYYY-MM-DD HH:MM:SS' with no timezone
  // marker. Chrome's Date parser treats that as LOCAL time, producing a UTC-offset
  // drift (off by 4h in DR). Normalise to ISO-8601 Z before parsing.
  if (!date) return ''
  const s = typeof date === 'string' && !date.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(date)
    ? date.replace(' ', 'T') + 'Z'
    : date
  return new Date(s).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

// ── Map raw DB row to UI ticket shape ─────────────────────────────────────────

function mapRow(row) {
  const plate  = (row.vehicle_plate || '').trim()
  const client = (row.client_name   || '').trim()
  const vehicle = plate || client || 'Al Portador'
  // v2.14.20 — when a ticket has multiple washers, washer_names is the
  // " + "-joined list from washer_commissions. Fall back to single washer_name.
  const allWashers = (row.washer_names || row.washer_name || '').trim()
  const fullWasher = allWashers
  const firstNameWasher = allWashers
    ? allWashers.split(' + ').map(n => n.trim().split(/\s+/)[0]).filter(Boolean).join(' + ')
    : '—'
  return {
    id:          row.id,
    ticketId:    row.ticket_id,
    ticketNo:    row.doc_number || `Q-${row.id}`,
    plate,
    clientName:  client,
    clientPhone: (row.client_phone || '').trim() || null,
    vehicle,
    queueCreatedAt: row.created_at || null,
    servicesStr: row.services || '',
    services:    (row.services || '').split(' + ').filter(Boolean).map(n => ({ name: n, price: 0 })),
    worker:      (row.empleado_supabase_id || row.washer_supabase_id || fullWasher)
                   ? { id: row.empleado_supabase_id || row.washer_supabase_id, name: firstNameWasher, fullName: fullWasher || '—' }
                   : null,
    amount:      row.total || 0,
    createdAt:   row.ticket_created || row.created_at,
    status:      FROM_DB[row.status] || 'pendiente',
  }
}

// ── Worker assign dropdown ────────────────────────────────────────────────────

function AssignDropdown({ ticketId, washers, onAssign, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-xl shadow-lg z-30 overflow-hidden min-w-[128px]">
      {washers.map(w => (
        <button
          key={w.id}
          onClick={() => { onAssign(ticketId, w); onClose() }}
          className="w-full text-left px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
        >
          {w.name}
        </button>
      ))}
    </div>
  )
}

// ── Table row ─────────────────────────────────────────────────────────────────

// ── Mobile card for queue ──────────────────────────────────────────────────────

function QueueCard({ ticket, washers, assigningId, setAssigningId, onCycle, onAssign, onCobrar, onNotify, onDelete, onEditPrice, lang }) {
  const sc   = STATUS[ticket.status]
  const main = ticket.services[0]?.name || ticket.servicesStr

  return (
    <div className={`border-b border-slate-100 dark:border-white/10 px-3 py-3 ${sc.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-sky-600 truncate max-w-[120px]">{ticket.ticketNo}</span>
        <span className="text-[11px] text-slate-400 dark:text-white/40 shrink-0">{fmtTime(ticket.createdAt)}</span>
      </div>
      <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">
        {ticket.plate || ticket.clientName || 'Al Portador'}
        {ticket.plate && ticket.clientName ? <span className="text-slate-400 dark:text-white/40 font-normal"> · {ticket.clientName}</span> : null}
      </p>
      <p className="text-[12px] text-slate-500 dark:text-white/60 truncate mt-0.5">{main}</p>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-slate-700 dark:text-white">{fmtRD(ticket.amount)}</span>
          <button onClick={() => onEditPrice(ticket)} className="p-1 text-slate-400 dark:text-white/40 hover:text-[#b3001e]">
            <Pencil size={11} />
          </button>
        </div>
        {ticket.worker ? (
          <span className="text-[12px] text-slate-600 dark:text-white/60 truncate max-w-[80px]" title={ticket.worker.fullName}>{ticket.worker.name}</span>
        ) : (
          <div className="relative">
            <button
              onClick={() => setAssigningId(assigningId === ticket.id ? null : ticket.id)}
              className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 rounded-lg px-2.5 py-1.5 min-h-[44px] transition-colors"
            >
              <Plus size={11} />
              {lang === 'es' ? 'Asignar' : 'Assign'}
            </button>
            {assigningId === ticket.id && (
              <AssignDropdown
                ticketId={ticket.id}
                washers={washers}
                onAssign={onAssign}
                onClose={() => setAssigningId(null)}
              />
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <button
          onClick={() => onCycle(ticket.id)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full border text-[11px] font-semibold min-h-[44px] transition-all active:scale-95 ${sc.bg} ${sc.text} ${sc.border}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dot}`} />
          {lang === 'es' ? sc.es : sc.en}
          <ChevronDown size={9} className="ml-0.5 opacity-50" />
        </button>
        {ticket.status === 'listo' && ticket.clientPhone && (
          <button
            onClick={() => onNotify?.(ticket)}
            title={lang === 'es' ? 'Notificar al cliente por WhatsApp' : 'Notify client via WhatsApp'}
            className="p-2 text-emerald-600 hover:text-white hover:bg-emerald-500 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center border border-emerald-200 dark:border-emerald-500/30 transition-all active:scale-95"
          >
            <MessageCircle size={16} />
          </button>
        )}
        {ticket.status === 'listo' && (
          <button
            onClick={() => onCobrar(ticket)}
            className="flex-1 py-2 bg-green-500 hover:bg-green-400 text-white text-[12px] font-bold rounded-lg min-h-[44px] transition-all active:scale-95"
          >
            {lang === 'es' ? 'Cobrar' : 'Collect'}
          </button>
        )}
        <button
          onClick={() => onDelete(ticket)}
          className="p-2 text-slate-400 dark:text-white/40 hover:text-red-500 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors"
          title={lang === 'es' ? 'Eliminar de cola' : 'Remove from queue'}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Desktop table row ─────────────────────────────────────────────────────────

function QueueRow({ ticket, washers, assigningId, setAssigningId, onCycle, onAssign, onCobrar, onNotify, onDelete, onEditPrice, lang }) {
  const sc   = STATUS[ticket.status]
  const main = ticket.services[0]?.name || ticket.servicesStr
  const extra = ticket.services.length - 1

  return (
    <div className={`flex items-center h-14 w-full border-b border-slate-100 dark:border-white/10 px-5 transition-colors group ${sc.bg} hover:brightness-95`}>

      <div className="w-[64px] shrink-0">
        <span className="text-[11px] font-semibold text-sky-600 truncate block">{ticket.ticketNo}</span>
      </div>

      <div className="w-[150px] pr-2">
        <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">
          {ticket.plate || ticket.clientName || 'Al Portador'}
          {ticket.plate && ticket.clientName ? <span className="text-slate-400 dark:text-white/40 font-normal"> · {ticket.clientName}</span> : null}
        </p>
      </div>

      <div className="w-[160px] shrink-0 pr-2 flex items-center gap-1.5 min-w-0">
        <span className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{main}</span>
        {extra > 0 && (
          <span className="shrink-0 text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60 px-1.5 py-0.5 rounded-full">
            +{extra}
          </span>
        )}
      </div>

      <div className="w-[110px] shrink-0 pr-2 relative">
        {ticket.worker ? (
          <span className="text-[13px] text-slate-700 dark:text-white truncate" title={ticket.worker.fullName}>{ticket.worker.name}</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
              {lang === 'es' ? 'Sin asignar' : 'Unassigned'}
            </span>
            <div className="relative">
              <button
                onClick={() => setAssigningId(assigningId === ticket.id ? null : ticket.id)}
                className="flex items-center gap-0.5 text-[11px] font-medium text-slate-400 dark:text-white/40 hover:text-sky-600 border border-slate-200 dark:border-white/10 hover:border-sky-300 rounded-md px-1.5 py-0.5 transition-colors"
              >
                <Plus size={10} />
                {lang === 'es' ? 'Asignar' : 'Assign'}
              </button>
              {assigningId === ticket.id && (
                <AssignDropdown
                  ticketId={ticket.id}
                  washers={washers}
                  onAssign={onAssign}
                  onClose={() => setAssigningId(null)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="w-[96px] shrink-0 pr-2 text-right flex items-center justify-end gap-1">
        <button
          onClick={() => onEditPrice(ticket)}
          className="p-1 text-slate-400 dark:text-white/50 hover:text-[#b3001e] hover:bg-[#b3001e]/10 rounded transition-colors shrink-0"
          title={lang === 'es' ? 'Cambiar precio' : 'Change price'}
        >
          <Pencil size={12} />
        </button>
        <span className="text-[13px] font-semibold text-slate-700 dark:text-white">{fmtRD(ticket.amount)}</span>
      </div>

      <div className="w-[52px] shrink-0 pr-2">
        <span className="text-[12px] text-slate-400 dark:text-white/40">{fmtTime(ticket.createdAt)}</span>
      </div>

      <div className="w-[200px] shrink-0 flex items-center gap-1.5">
        <button
          onClick={() => onCycle(ticket.id)}
          title={lang === 'es' ? 'Clic para cambiar estado' : 'Click to change status'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-semibold cursor-pointer transition-all hover:brightness-95 active:scale-95 ${sc.bg} ${sc.text} ${sc.border}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dot}`} />
          {lang === 'es' ? sc.es : sc.en}
          <ChevronDown size={9} className="ml-0.5 opacity-50" />
        </button>

        {ticket.status === 'listo' && ticket.clientPhone && (
          <button
            onClick={() => onNotify?.(ticket)}
            title={lang === 'es' ? 'Notificar al cliente por WhatsApp' : 'Notify client via WhatsApp'}
            className="p-1.5 text-emerald-600 hover:text-white hover:bg-emerald-500 rounded-lg transition-all shrink-0 active:scale-95 border border-emerald-200 dark:border-emerald-500/30"
          >
            <MessageCircle size={14} />
          </button>
        )}
        <button
          onClick={() => onCobrar(ticket)}
          className={`px-3 py-1.5 bg-green-500 hover:bg-green-400 text-white text-[11px] font-bold rounded-lg transition-all active:scale-95 shrink-0 ${
            ticket.status === 'listo' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {lang === 'es' ? 'Cobrar' : 'Collect'}
        </button>
        <button
          onClick={() => onDelete(ticket)}
          className="p-1.5 text-slate-400 dark:text-white/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors shrink-0"
          title={lang === 'es' ? 'Eliminar de cola' : 'Remove from queue'}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center h-14 border-b border-slate-100 dark:border-white/10 px-5 gap-4 animate-pulse">
      <div className="w-16 h-4 bg-slate-100 dark:bg-white/10 rounded" />
      <div className="flex-1 h-4 bg-slate-100 dark:bg-white/10 rounded" />
      <div className="w-40 h-4 bg-slate-100 dark:bg-white/10 rounded" />
      <div className="w-32 h-4 bg-slate-100 dark:bg-white/10 rounded" />
      <div className="w-20 h-4 bg-slate-100 dark:bg-white/10 rounded" />
      <div className="w-12 h-4 bg-slate-100 dark:bg-white/10 rounded" />
      <div className="w-28 h-6 bg-slate-100 dark:bg-white/10 rounded-full" />
    </div>
  )
}

// ── Price Change Modal ───────────────────────────────────────────────────────
function PriceChangeModal({ ticket, onConfirm, onClose, lang }) {
  const [step, setStep] = useState('pin')  // 'pin' | 'edit'
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [newPrice, setNewPrice] = useState(String(ticket.amount))
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handlePinSubmit(e) {
    e.preventDefault()
    if (pin.length < 4) {
      setPinError(lang === 'es' ? 'PIN debe tener al menos 4 digitos' : 'PIN must be at least 4 digits')
      return
    }
    setPinError('')
    setStep('edit')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!reason.trim()) return
    const price = parseFloat(newPrice.replace(/,/g, ''))
    if (isNaN(price) || price <= 0) return
    setSubmitting(true)
    await onConfirm({ newPrice: price, reason: reason.trim(), adminPin: pin })
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        {step === 'pin' ? (
          <form onSubmit={handlePinSubmit}>
            <div className="flex items-center gap-2 mb-4">
              <Lock size={18} className="text-[#b3001e]" />
              <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">
                {lang === 'es' ? 'PIN de Administrador' : 'Admin PIN'}
              </h3>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-white/60 mb-4">
              {lang === 'es'
                ? 'Se requiere PIN de dueno o gerente para cambiar precios.'
                : 'Owner or manager PIN required to change prices.'}
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={e => { setPin(e.target.value); setPinError('') }}
              placeholder="PIN"
              className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-center text-lg font-bold tracking-[8px] text-slate-800 dark:text-white focus:outline-none focus:border-sky-400"
            />
            {pinError && <p className="text-red-500 text-xs mt-2">{pinError}</p>}
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 text-[13px] font-semibold text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg">
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button type="submit"
                className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-[#b3001e] hover:bg-[#8c0017] rounded-lg transition-colors">
                {lang === 'es' ? 'Verificar' : 'Verify'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-2 mb-4">
              <Pencil size={18} className="text-[#b3001e]" />
              <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">
                {lang === 'es' ? 'Cambiar Precio' : 'Change Price'} — {ticket.ticketNo}
              </h3>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-white/60 mb-3">
              {lang === 'es' ? 'Precio actual' : 'Current price'}: <strong className="text-slate-800 dark:text-white">{fmtRD(ticket.amount)}</strong>
            </p>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-1">
              {lang === 'es' ? 'Nuevo precio total' : 'New total price'}
            </label>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-lg font-bold text-slate-800 dark:text-white focus:outline-none focus:border-sky-400 mb-3"
            />
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-1">
              {lang === 'es' ? 'Razon del cambio (obligatorio)' : 'Reason for change (required)'}
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={lang === 'es' ? 'Ej: Cliente solicito servicio adicional...' : 'E.g. Customer requested additional service...'}
              rows={2}
              className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-sky-400 resize-none mb-4"
            />
            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 text-[13px] font-semibold text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg">
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button type="submit" disabled={submitting || !reason.trim()}
                className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-[#b3001e] hover:bg-[#8c0017] rounded-lg transition-colors disabled:opacity-50">
                {submitting
                  ? (lang === 'es' ? 'Guardando...' : 'Saving...')
                  : (lang === 'es' ? 'Cambiar Precio' : 'Change Price')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Main Queue Screen ─────────────────────────────────────────────────────────

export default function Queue() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { lang } = useLang()
  const { user } = useAuth()
  const { businessType } = useBusinessType()

  // Queue is carwash/service/salon-specific. Redirect non-service verticals to POS.
  if (!hasModule(businessType, 'queue')) {
    return <Navigate to="/pos" replace />
  }

  const { data: dbQueue, loading, error, reload } = useQueueActive()
  const { data: washers }                         = useWashers()

  const [queue,       setQueue]       = useState([])
  const [filter,      setFilter]      = useState('all')
  const [search,      setSearch]      = useState('')
  const [assigningId, setAssigningId] = useState(null)
  const [toast,       setToast]       = useState(null)
  const [cobrarModal, setCobrarModal] = useState(null)
  const [loadingTicket, setLoadingTicket] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [priceChangeModal, setPriceChangeModal] = useState(null)
  const [deleteAuthFor, setDeleteAuthFor] = useState(null)

  // Sync DB data → local state (preserves optimistic updates)
  useEffect(() => {
    if (!loading && dbQueue) {
      setQueue(dbQueue.map(mapRow))
    }
  }, [dbQueue, loading])

  // Realtime queue updates (web only — Supabase Realtime)
  useEffect(() => {
    if (!api?.realtime?.subscribeQueue) return
    const unsub = api.realtime.subscribeQueue(() => {
      reload()
    })
    return unsub
  }, [api])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function deleteFromQueue(ticket, approval = null) {
    // Owners are exempt server-side; non-owners must scan a Manager Auth Card.
    if (!approval && user?.role && user.role !== 'owner') {
      setDeleteConfirm(null)
      setDeleteAuthFor(ticket)
      return
    }
    try {
      await api.queue.delete({
        id: ticket.id,
        deletedBy: user?.name || user?.username || 'unknown',
        mac_jti: approval?.mac_jti || null,
      })
      setQueue(q => q.filter(t => t.id !== ticket.id))
      flash(`${ticket.ticketNo} · ${lang === 'es' ? 'Eliminado de cola' : 'Removed from queue'}`)
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'warn', category: 'queue.delete', extra: { id: ticket.id, ticketNo: ticket.ticketNo } }) } catch {}
      flash(err.message || (lang === 'es' ? 'Error al eliminar' : 'Delete error'))
    }
    setDeleteConfirm(null)
    setDeleteAuthFor(null)
  }

  async function cycleStatus(id) {
    const ticket   = queue.find(t => t.id === id)
    if (!ticket) return
    if (ticket.status === 'listo') return  // Already done — use Cobrar button
    const nextUI   = CYCLE_UI[ticket.status]
    const nextDB   = TO_DB[nextUI]

    // Optimistic update
    setQueue(q => q.map(t => t.id === id ? { ...t, status: nextUI } : t))

    try {
      await api.queue.updateStatus({
        id,
        status:   nextDB,
        washerId: ticket.worker?.id || null,
      })
    } catch (err) {
      // Revert on error
      setQueue(q => q.map(t => t.id === id ? { ...t, status: ticket.status } : t))
      try { window.__txReportError?.(err, { severity: 'warn', category: 'queue.cycle_status', extra: { id, from: ticket.status, to: nextUI } }) } catch {}
      flash(`Error: ${err.message}`)
    }
  }

  async function assignWorker(queueId, washer) {
    setQueue(q => q.map(t => t.id === queueId ? { ...t, worker: washer } : t))
    flash(`${washer.name} → ${queue.find(t => t.id === queueId)?.ticketNo}`)

    try {
      await api.queue.updateStatus({
        id:       queueId,
        status:   TO_DB[queue.find(t => t.id === queueId)?.status || 'pendiente'],
        washerId: washer.id,
      })
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'warn', category: 'queue.assign_worker', extra: { queueId, washerId: washer?.id } }) } catch {}
      flash(`Error: ${err.message}`)
    }
  }

  // v2.3.29 — WhatsApp "car is ready" notifier. Fires from the listo row's
  // green message-circle icon. Uses template from Settings → WhatsApp, falls
  // back to a sensible default. Doesn't block the cobrar flow — cashier still
  // has to explicitly click Cobrar when the client arrives.
  async function notifyReady(ticket) {
    const phone = (ticket.clientPhone || '').replace(/\D/g, '')
    if (!phone) { flash(lang === 'es' ? 'Cliente sin teléfono' : 'Client has no phone'); return }
    const to = phone.length === 10 && (phone[0] === '8' || phone[0] === '9') ? '1' + phone
             : phone.length === 11 && phone[0] === '1' ? phone : phone
    try {
      const s = await api?.settings?.get?.()
      const bizName = s?.biz_name || 'Terminal X'
      const tpl = (s?.wa_listo_template || '').trim() ||
        (lang === 'es'
          ? `Hola {cliente}, tu vehículo {vehiculo} ya está listo para recoger en ${bizName}. ¡Gracias!`
          : `Hi {cliente}, your vehicle {vehiculo} is ready for pickup at ${bizName}. Thanks!`)
      const body = tpl
        .replace(/\{cliente\}/g, ticket.clientName || '')
        .replace(/\{vehiculo\}/g, ticket.plate || ticket.vehicle || '')
        .replace(/\{ticket\}/g, ticket.ticketNo || '')
        .replace(/\{biz\}/g, bizName)
      const r = await api?.whatsapp?.send?.({ to, body })
      if (r?.success || r === true || r?.ok) flash(lang === 'es' ? 'WhatsApp enviado ✓' : 'WhatsApp sent ✓')
      else flash(lang === 'es' ? 'No se pudo enviar WhatsApp' : 'Could not send WhatsApp')
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'queue.notify_whatsapp', extra: { ticketNo: ticket?.ticketNo } }) } catch {}
      flash(`Error: ${e.message || e}`)
    }
  }

  async function cobrar(ticket) {
    setLoadingTicket(true)
    try {
      const full = await api.tickets.byId(ticket.ticketId)
      setCobrarModal({
        id:       full?.id ?? ticket.ticketId,
        queueId:  ticket.id,
        ticketNo: full?.doc_number ?? ticket.ticketNo,
        vehicle:  full?.vehicle_plate ?? ticket.vehicle,
        washerName: ticket.worker?.name || '',
        services: full?.items?.map(i => ({ name: i.name, price: i.price }))
                  ?? [{ name: ticket.servicesStr, price: ticket.amount }],
        client:   full?.client_id ? { id: full.client_id, name: full.client_name || '', rnc: full.client_rnc || '' } : null,
      })
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'warn', category: 'queue.cobrar.load_ticket', extra: { ticketId: ticket?.ticketId } }) } catch {}
      setCobrarModal({
        id:       ticket.ticketId,
        queueId:  ticket.id,
        ticketNo: ticket.ticketNo,
        vehicle:  ticket.vehicle,
        washerName: ticket.worker?.name || '',
        services: ticket.services.length ? ticket.services : [{ name: ticket.servicesStr, price: ticket.amount }],
      })
    } finally {
      setLoadingTicket(false)
    }
  }

  async function handlePriceChange({ newPrice, reason, adminPin }) {
    const ticket = priceChangeModal
    if (!ticket) return
    try {
      // Get all ticket items to find the first one (for single-service tickets, this is the item to update)
      const full = await api.tickets.byId(ticket.ticketId)
      if (!full?.items?.length) { flash(lang === 'es' ? 'No se encontraron items' : 'No items found'); setPriceChangeModal(null); return }
      // For multi-item tickets, scale all items proportionally
      const oldTotal = full.items.reduce((s, i) => s + i.price, 0)
      const ratio = newPrice / oldTotal
      let lastError = null
      for (const item of full.items) {
        const itemNewPrice = Math.round(item.price * ratio * 100) / 100
        const result = await api.tickets.updateItemPrice({
          ticketItemId: item.id,
          newPrice: itemNewPrice,
          reason,
          adminPin,
        })
        if (!result?.ok) { lastError = result?.error; break }
      }
      if (lastError) {
        flash(lastError)
      } else {
        // Update local queue state with new amount
        setQueue(q => q.map(t => t.id === ticket.id ? { ...t, amount: newPrice } : t))
        flash(`${ticket.ticketNo} · ${lang === 'es' ? 'Precio actualizado' : 'Price updated'} → ${fmtRD(newPrice)}`)
      }
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'warn', category: 'queue.price_change', extra: { ticketId: ticket?.ticketId, newPrice } }) } catch {}
      flash(err.message || (lang === 'es' ? 'Error al cambiar precio' : 'Price change error'))
    }
    setPriceChangeModal(null)
  }

  async function handlePaymentConfirm(data) {
    const snapshot = cobrarModal
    const queueId  = snapshot.queueId
    const ticketId = snapshot.id

    // ── Persist to DB FIRST ────────────────────────────────────────────────
    if (ticketId) {
      try {
        await api.tickets.markPaid({
          id:            ticketId,
          paymentMethod: data.tipo === 'credito' ? 'credit' : (data.formaPago || 'cash'),
          ncf:           data.ecf?.eNCF || null,
          ecfResult:     data.ecf || null,
          clientId:      data.clientId || null,
          tipoVenta:     data.tipo || null,
          comentario:    (Number(data.descuento || 0) > 0 && data.descuentoReason)
                           ? `[Descuento: ${data.descuentoReason}] ${data.comentario || ''}`.trim()
                           : (data.comentario || null),
          descuento:     data.descuento != null ? Number(data.descuento) : null,
          descuento_reason: data.descuentoReason || null,
          mac_jti:       data.mac_jti || null,
        })
        if (queueId) await api.queue.updateStatus({ id: queueId, status: 'done' })
      } catch (err) {
        try { window.__txReportError?.(err, { severity: 'error', category: 'queue.payment.confirm', extra: { ticketId, queueId, tipo: data?.tipo, formaPago: data?.formaPago } }) } catch {}
        console.error('[Queue] markPaid error:', err)
        flash(lang === 'es' ? 'Error al cobrar — intente de nuevo' : 'Payment error — try again')
        setCobrarModal(null)
        return
      }
    }

    // ── Print + drawer AFTER DB persistence ──────────────────────────────
    try {
      const [cfg, empresa] = await Promise.all([
        api.settings.get().catch(() => ({})),
        api.admin.getEmpresa().catch(() => ({})),
      ])
      const biz = {
        name:    empresa?.nombre    || empresa?.name    || '',
        address: empresa?.direccion || empresa?.address || '',
        phone:   empresa?.telefono  || empresa?.phone   || '',
        rnc:     empresa?.rnc       || '',
        logo:    empresa?.logo      || '',
        settings: empresa?.settings || {},
      }
      const services = snapshot.services || []
      const subtotal  = services.reduce((s, i) => s + (i.price || 0), 0)
      const ticketData = {
        ncf:          data.ecf?.eNCF    || '',
        ncfType:      data.ncfType      || 'E32',
        cajero:       user?.name         || '',
        lavador:      snapshot.worker?.name || snapshot.washerName || '',
        docNo:        snapshot.ticketNo  || '',
        paidAt:       new Date(),
        client:       null,
        vehiclePlate: snapshot.vehicle  || '',
        tipo:         data.tipo         || 'contado',
        formaPago:    data.formaPago    || 'cash',
        services,
        subtotal,
        descuento:    0,
        itbis:        parseFloat((subtotal - subtotal / 1.18).toFixed(2)),
        ley:          0,
        total:        subtotal,
        biz,
        cfg,
      }
      // v2.14.34 — fetch washer commissions ONCE up front so we can both
      // (a) thread total commission into the factura for the optional
      // "Comisión" line and (b) reuse the rows in the conduce loop below.
      let washerListEarly = []
      try {
        if (ticketId) {
          const commRows = await api.commissions?.byTicket?.({ ticketId })
          if (Array.isArray(commRows) && commRows.length) {
            washerListEarly = commRows.map(r => ({ name: r.nombre || r.name || '-', commAmount: Number(r.commission_amount) || 0 }))
          }
        }
      } catch {}
      ticketData.commTotal = parseFloat(washerListEarly.reduce((s, w) => s + (Number(w.commAmount) || 0), 0).toFixed(2))
      // v2.14.34 — await factura BEFORE conduce loop so the printer queues
      // FACTURA first then CONDUCE. Previously fire-and-forget reversed the
      // order on physical paper.
      if (cfg.print_factura_auto === '1') {
        await printClientReceipt(ticketData).catch(err => {
          try { window.__txReportError?.(err, { severity: 'warn', category: 'queue.print.factura', extra: { ticketId } }) } catch {}
          flash(lang === 'es' ? 'Error al imprimir factura' : 'Print error: invoice')
        })
      }
      // v2.14.24 — Cobrar-from-Cola must print one conduce per washer, same
      // as POS direct-Cobrar. queue.empleado_supabase_id stores ONLY the
      // first washer (schema limitation), so pull all washers from the
      // ticket's washer_commissions rows (most authoritative). Falls back
      // to the single queue worker if that lookup fails.
      // Identified in print audit 2026-04-24.
      if (cfg.print_conduce_auto === '1') {
        // v2.14.34 — reuse washerListEarly fetched above (avoids second
        // commissions API call). Falls back to single queue worker on miss.
        let washerList = washerListEarly
        if (!washerList.length) {
          washerList = [{ name: snapshot.worker?.name || snapshot.washerName || '-', commAmount: 0 }]
        }
        // v2.14.34 — derive each washer's SHARE of the wash work from their
        // commission_amount proportion. Even split fallback when commissions
        // aren't recorded. Scale wash services so each conduce shows that
        // washer's portion only (RD$300 each on 50/50 split, not RD$600).
        const totalComm = washerList.reduce((s, w) => s + (Number(w.commAmount) || 0), 0)
        for (const w of washerList) {
          const myShare = totalComm > 0
            ? ((Number(w.commAmount) || 0) / totalComm)
            : (1 / washerList.length)
          const scaledServices = services.map(s => {
            const isWash = (s.is_wash ?? (s.c !== false ? 1 : 0)) !== 0
            if (!isWash) return s
            return {
              ...s,
              price: parseFloat((Number(s.price || 0) * myShare).toFixed(2)),
              itbis: s.itbis != null ? parseFloat((Number(s.itbis || 0) * myShare).toFixed(2)) : s.itbis,
            }
          })
          await printWasherConduce({ ...ticketData, services: scaledServices, lavador: w.name, commAmount: w.commAmount, cfg })
            .catch(err => {
              try { window.__txReportError?.(err, { severity: 'warn', category: 'queue.print.conduce', extra: { ticketId, washer: w?.name } }) } catch {}
              flash(lang === 'es' ? 'Error al imprimir conduce' : 'Print error: conduce')
            })
        }
      }
      // Kick drawer for cash/check payments
      const fm = data.formaPago || ''
      if (data.tipo !== 'credito' && !['tarjeta', 'transferencia'].includes(fm)) {
        printerApi?.openDrawer?.().catch?.(() => {})
      }
    } catch { /* print errors never block the queue flow */ }

    // ── Update UI + sync ────────────────────────────────────────────────
    // v2.14.34 — keep the modal mounted so CobrarModal's SuccessView (WhatsApp
    // send + receipt actions) stays interactive. Modal closes itself via the
    // user clicking the close button → onClose prop wired to setCobrarModal(null).
    if (ticketId) {
      setQueue(q => q.filter(t => t.id !== queueId))
      flash(`${data.ticketNo} · ${lang === 'es' ? 'Cobrado' : 'Collected'} ✓`)
    }
  }

  // Counts
  const counts = {
    all:        queue.length,
    listo:      queue.filter(t => t.status === 'listo').length,
    proceso:    queue.filter(t => t.status === 'proceso').length,
    unassigned: queue.filter(t => !t.worker).length,
  }

  // Wait-time metrics (carwash KPI) — derived from pendiente tickets only,
  // since in_progress/listo have already left the waiting state.
  // Re-computed every 30s via a lightweight ticker so the chip stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const waitMetrics = (() => {
    const waiting = queue.filter(t => t.status === 'pendiente')
    if (!waiting.length) return { avgMin: 0, longestMin: 0, longestNo: null, count: 0 }
    const now = Date.now()
    let total = 0, longest = { ms: 0, no: null }
    for (const t of waiting) {
      const ms = Math.max(0, now - new Date(t.createdAt).getTime())
      total += ms
      if (ms > longest.ms) longest = { ms, no: t.ticketNo }
    }
    return {
      avgMin:      Math.round((total / waiting.length) / 60000),
      longestMin:  Math.round(longest.ms / 60000),
      longestNo:   longest.no,
      count:       waiting.length,
    }
  })()

  const visible = queue
    .filter(t => {
      if (filter === 'listo')      return t.status === 'listo'
      if (filter === 'proceso')    return t.status === 'proceso'
      if (filter === 'unassigned') return !t.worker
      return true
    })
    .filter(t => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return t.ticketNo.toLowerCase().includes(q) || t.vehicle.toLowerCase().includes(q)
    })

  const FILTERS = [
    { id: 'all',        es: 'Todos',      en: 'All',         count: counts.all        },
    { id: 'listo',      es: 'Listo',      en: 'Ready',       count: counts.listo      },
    { id: 'proceso',    es: 'En Proceso', en: 'In Progress', count: counts.proceso    },
    { id: 'unassigned', es: 'Sin Asignar',en: 'Unassigned',  count: counts.unassigned },
  ]

  // Salon vertical uses customer-centric language instead of car-centric:
  // "Vehículo" → "Cliente", "Lavador" → "Estilista". All other service-based
  // verticals keep the original labels (carwash terminology is the default).
  const isSalon = businessType === 'salon'
  const COL_HEADERS = [
    { label_es: 'Ticket',      label_en: 'Ticket',    w: 'w-[64px]'  },
    isSalon
      ? { label_es: 'Cliente',   label_en: 'Client',    w: 'w-[150px]'    }
      : { label_es: 'Vehículo',  label_en: 'Vehicle',   w: 'w-[150px]'    },
    { label_es: 'Servicio(s)', label_en: 'Service(s)',w: 'w-[160px]' },
    isSalon
      ? { label_es: 'Estilista', label_en: 'Stylist',   w: 'w-[110px]' }
      : { label_es: 'Lavador',   label_en: 'Washer',    w: 'w-[110px]' },
    { label_es: 'Monto',       label_en: 'Amount',    w: 'w-[96px] text-right' },
    { label_es: 'Hora',        label_en: 'Time',      w: 'w-[52px]'  },
    { label_es: 'Estado',      label_en: 'Status',    w: 'w-[200px]' },
  ]

  return (
    <div className="h-full flex flex-col bg-white dark:bg-white/5">

      <div className="shrink-0 border-b border-slate-200 dark:border-white/10">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 gap-2 md:gap-0">
          <div>
            <h2 className="text-base md:text-lg font-bold text-slate-800 dark:text-white">
              {lang === 'es' ? 'Cola de Espera' : 'Service Queue'}
            </h2>
            <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5 hidden md:block">
              {lang === 'es' ? 'Actualiza el estado haciendo clic en el badge' : 'Click the badge to update status'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Reload */}
            <button
              onClick={() => reload()}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center text-slate-400 dark:text-white/40 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-white/10 rounded-lg transition-colors"
              title={lang === 'es' ? 'Actualizar' : 'Refresh'}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>

            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:border-sky-400 w-full md:w-64 flex-1 md:flex-none">
              <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={lang === 'es'
                  ? (isSalon ? 'Buscar ticket o cliente...' : 'Buscar ticket o vehículo...')
                  : (isSalon ? 'Search ticket or client...'  : 'Search ticket or vehicle...')}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40"
              />
            </div>
          </div>
        </div>

        {/* Wait-time metrics strip (carwash KPI) */}
        {waitMetrics.count > 0 && (
          <div className="flex items-center flex-wrap gap-2 md:gap-3 px-3 md:px-6 pb-2 md:pb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
              {lang === 'es' ? 'Espera promedio' : 'Avg wait'}: {waitMetrics.avgMin} min
            </span>
            {waitMetrics.longestMin >= 10 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
                <AlertCircle size={11} />
                {lang === 'es' ? 'Más demorado' : 'Longest wait'}: {waitMetrics.longestNo || '—'} · {waitMetrics.longestMin} min
              </span>
            )}
          </div>
        )}

        <div className="flex px-3 md:px-6 gap-1 overflow-x-auto">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3.5 py-2.5 text-[12px] md:text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                filter === f.id
                  ? 'border-sky-500 text-sky-600'
                  : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              {lang === 'es' ? f.es : f.en}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                filter === f.id ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-600' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60'
              }`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Column headers — desktop only */}
      <div className="hidden md:flex items-center h-9 w-full bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-5 shrink-0">
        {COL_HEADERS.map((col, i) => (
          <div key={i} className={`${col.w} text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider pr-2`}>
            {lang === 'es' ? col.label_es : col.label_en}
          </div>
        ))}
      </div>

      {/* Table body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-red-400 gap-2">
            <AlertCircle size={28} />
            <p className="text-sm">{lang === 'es' ? 'Error al cargar la cola' : 'Error loading queue'}</p>
            <button onClick={() => reload()} className="text-sm text-sky-600 hover:underline">
              {lang === 'es' ? 'Reintentar' : 'Retry'}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-300 dark:text-white/30 gap-2">
            <span className="text-3xl">🚗</span>
            <p className="text-sm">{lang === 'es' ? 'No hay tickets en esta vista' : 'No tickets in this view'}</p>
          </div>
        ) : (
          <>
            {/* Mobile card layout */}
            <div className="block md:hidden">
              {visible.map(ticket => (
                <QueueCard
                  key={ticket.id}
                  ticket={ticket}
                  washers={washers}
                  assigningId={assigningId}
                  setAssigningId={setAssigningId}
                  onCycle={cycleStatus}
                  onAssign={assignWorker}
                  onCobrar={cobrar}
                  onNotify={notifyReady}
                  onDelete={t => setDeleteConfirm(t)}
                  onEditPrice={t => setPriceChangeModal(t)}
                  lang={lang}
                />
              ))}
            </div>
            {/* Desktop table layout */}
            <div className="hidden md:block">
              {visible.map(ticket => (
                <QueueRow
                  key={ticket.id}
                  ticket={ticket}
                  washers={washers}
                  assigningId={assigningId}
                  setAssigningId={setAssigningId}
                  onCycle={cycleStatus}
                  onAssign={assignWorker}
                  onCobrar={cobrar}
                  onNotify={notifyReady}
                  onDelete={t => setDeleteConfirm(t)}
                  onEditPrice={t => setPriceChangeModal(t)}
                  lang={lang}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Summary bar */}
      <div className="shrink-0 border-t border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 md:px-6 py-2 md:py-3 flex items-center gap-3 md:gap-6 flex-wrap">
        <SumStat dot="bg-green-500" label={lang === 'es' ? 'Listos' : 'Ready'} value={counts.listo} highlight={counts.listo > 0} />
        <SumStat dot="bg-blue-500"  label={lang === 'es' ? 'Proceso' : 'Progress'}  value={counts.proceso} />
        <SumStat dot="bg-amber-500" label={lang === 'es' ? 'Sin asignar' : 'Unassigned'} value={counts.unassigned} warn={counts.unassigned > 0} />
        <div className="ml-auto pl-3 md:pl-6 border-l border-slate-200 dark:border-white/10">
          <SumStat dot="bg-slate-400" label={lang === 'es' ? 'Total' : 'Total'} value={counts.all} />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-slate-800 dark:bg-white/10 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}

      {/* Loading ticket overlay */}
      {loadingTicket && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-black rounded-2xl px-8 py-6 flex items-center gap-3 shadow-2xl">
            <Loader2 size={20} className="text-sky-500 animate-spin" />
            <p className="text-[14px] font-semibold text-slate-700 dark:text-white">
              {lang === 'es' ? 'Cargando ticket…' : 'Loading ticket…'}
            </p>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-black rounded-2xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-bold text-slate-800 dark:text-white mb-1">
              {lang === 'es' ? 'Eliminar ticket de cola' : 'Remove ticket from queue'}
            </p>
            <p className="text-[13px] text-slate-500 dark:text-white/60 mb-5">
              {lang === 'es'
                ? `¿Seguro que deseas eliminar ${deleteConfirm.ticketNo}? Esta accion queda registrada.`
                : `Are you sure you want to remove ${deleteConfirm.ticketNo}? This action is logged.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 text-[13px] font-semibold text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg"
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={() => deleteFromQueue(deleteConfirm)}
                className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                {lang === 'es' ? 'Eliminar' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager auth — required to delete from queue (non-owner) */}
      {deleteAuthFor && (
        <ManagerAuthGate
          action="queue:delete"
          actionLabel={lang === 'es'
            ? `Eliminar ${deleteAuthFor.ticketNo} de la cola`
            : `Remove ${deleteAuthFor.ticketNo} from queue`}
          context={{
            target_type: 'ticket',
            target_id:   deleteAuthFor.id != null ? String(deleteAuthFor.id) : null,
            target_name: deleteAuthFor.ticketNo,
          }}
          onApprove={(approval) => deleteFromQueue(deleteAuthFor, approval)}
          onCancel={() => setDeleteAuthFor(null)}
        />
      )}

      {/* Price Change Modal */}
      {priceChangeModal && (
        <PriceChangeModal
          ticket={priceChangeModal}
          onConfirm={handlePriceChange}
          onClose={() => setPriceChangeModal(null)}
          lang={lang}
        />
      )}

      {/* Cobrar Modal */}
      {cobrarModal && (
        <PaymentErrorBoundary onClose={() => setCobrarModal(null)}>
          <CobrarModal
            ticket={cobrarModal}
            onConfirm={handlePaymentConfirm}
            onClose={() => setCobrarModal(null)}
          />
        </PaymentErrorBoundary>
      )}
    </div>
  )
}

function SumStat({ dot, label, value, highlight, warn }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="text-[12px] text-slate-500 dark:text-white/60">{label}</span>
      <span className={`text-[15px] font-bold ${
        highlight ? 'text-green-600 dark:text-green-400' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-white'
      }`}>
        {value}
      </span>
    </div>
  )
}
