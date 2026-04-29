// QueueDemo — line-by-line faithful demo copy of packages/ui/screens/Queue.jsx.
//
// Source: packages/ui/screens/Queue.jsx (real production POS)
// Render is identical — everything below the data layer was stripped:
//   - useAPI / useAuth / useBusinessType / useQueueActive / useWashers / usePrinterAPI
//   - api.queue.* and api.tickets.* mutations replaced with local setState
//   - PrintClientReceipt / PrintWasherConduce / printerApi.openDrawer no-ops
//   - dark mode classes stripped (demo is light-only)
//   - useLang stripped (Spanish only)
//   - real CobrarModal swapped for the demo CobrarModal in _shared.jsx
//   - ManagerAuthGate replaced by a simple PIN dialog
//   - PaymentErrorBoundary stripped
//
// The JSX, class names, layout, status colors, sky-600 ticket numbers and the
// wait-time KPI strip are intentionally preserved verbatim.

import { useState, useRef, useEffect } from 'react'
import { Search, Plus, ChevronDown, CheckCircle2, Loader2, RefreshCw, AlertCircle, Trash2, Pencil, Lock, MessageCircle } from 'lucide-react'
import { CobrarModal as DemoCobrarModal, RD as RDfmt } from '../_shared'

// ── Constants — verbatim from Queue.jsx ────────────────────────────────────
const STATUS = {
  pendiente: { es: 'Pendiente',  bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500'  },
  proceso:   { es: 'En Proceso', bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500'   },
  listo:     { es: 'Listo',      bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500'  },
}
const CYCLE_UI = { pendiente: 'proceso', proceso: 'listo', listo: 'listo' }

function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtTime(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

// ── Worker assign dropdown — verbatim ──────────────────────────────────────
function AssignDropdown({ ticketId, washers, onAssign, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden min-w-[128px]">
      {washers.map(w => (
        <button
          key={w.id}
          onClick={() => { onAssign(ticketId, w); onClose() }}
          className="w-full text-left px-3.5 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
        >
          {w.name}
        </button>
      ))}
    </div>
  )
}

// ── Mobile card — verbatim ─────────────────────────────────────────────────
function QueueCard({ ticket, washers, assigningId, setAssigningId, onCycle, onAssign, onCobrar, onNotify, onDelete, onEditPrice }) {
  const sc   = STATUS[ticket.status]
  const main = ticket.services[0]?.name || ticket.servicesStr

  return (
    <div className={`border-b border-slate-100 px-3 py-3 ${sc.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-sky-600 truncate max-w-[120px]">{ticket.ticketNo}</span>
        <span className="text-[11px] text-slate-400 shrink-0">{fmtTime(ticket.createdAt)}</span>
      </div>
      <p className="text-[13px] font-semibold text-slate-800 truncate">
        {ticket.plate || ticket.clientName || 'Al Portador'}
        {ticket.plate && ticket.clientName ? <span className="text-slate-400 font-normal"> · {ticket.clientName}</span> : null}
      </p>
      <p className="text-[12px] text-slate-500 truncate mt-0.5">{main}</p>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-slate-700">{fmtRD(ticket.amount)}</span>
          <button onClick={() => onEditPrice(ticket)} className="p-1 text-slate-400 hover:text-[#b3001e]">
            <Pencil size={11} />
          </button>
        </div>
        {ticket.worker ? (
          <span className="text-[12px] text-slate-600 truncate max-w-[80px]" title={ticket.worker.fullName}>{ticket.worker.name}</span>
        ) : (
          <div className="relative">
            <button
              onClick={() => setAssigningId(assigningId === ticket.id ? null : ticket.id)}
              className="flex items-center gap-1 text-[11px] font-medium text-amber-600 border border-amber-200 rounded-lg px-2.5 py-1.5 min-h-[44px] transition-colors"
            >
              <Plus size={11} />
              Asignar
            </button>
            {assigningId === ticket.id && (
              <AssignDropdown ticketId={ticket.id} washers={washers} onAssign={onAssign} onClose={() => setAssigningId(null)} />
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
          {sc.es}
          <ChevronDown size={9} className="ml-0.5 opacity-50" />
        </button>
        {ticket.status === 'listo' && ticket.clientPhone && (
          <button onClick={() => onNotify?.(ticket)} title="Notificar al cliente por WhatsApp"
            className="p-2 text-emerald-600 hover:text-white hover:bg-emerald-500 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center border border-emerald-200 transition-all active:scale-95">
            <MessageCircle size={16} />
          </button>
        )}
        {ticket.status === 'listo' && (
          <button onClick={() => onCobrar(ticket)}
            className="flex-1 py-2 bg-green-500 hover:bg-green-400 text-white text-[12px] font-bold rounded-lg min-h-[44px] transition-all active:scale-95">
            Cobrar
          </button>
        )}
        <button onClick={() => onDelete(ticket)} title="Eliminar de cola"
          className="p-2 text-slate-400 hover:text-red-500 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Desktop row — verbatim ─────────────────────────────────────────────────
function QueueRow({ ticket, washers, assigningId, setAssigningId, onCycle, onAssign, onCobrar, onNotify, onDelete, onEditPrice }) {
  const sc   = STATUS[ticket.status]
  const main = ticket.services[0]?.name || ticket.servicesStr
  const extra = ticket.services.length - 1

  return (
    <div className={`flex items-center h-14 w-full border-b border-slate-100 px-5 transition-colors group ${sc.bg} hover:brightness-95`}>
      <div className="w-[64px] shrink-0">
        <span className="text-[11px] font-semibold text-sky-600 truncate block">{ticket.ticketNo}</span>
      </div>
      <div className="w-[150px] pr-2">
        <p className="text-[13px] font-semibold text-slate-800 truncate">
          {ticket.plate || ticket.clientName || 'Al Portador'}
          {ticket.plate && ticket.clientName ? <span className="text-slate-400 font-normal"> · {ticket.clientName}</span> : null}
        </p>
      </div>
      <div className="w-[160px] shrink-0 pr-2 flex items-center gap-1.5 min-w-0">
        <span className="text-[13px] font-semibold text-slate-800 truncate">{main}</span>
        {extra > 0 && (
          <span className="shrink-0 text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">+{extra}</span>
        )}
      </div>
      <div className="w-[110px] shrink-0 pr-2 relative">
        {ticket.worker ? (
          <span className="text-[13px] text-slate-700 truncate" title={ticket.worker.fullName}>{ticket.worker.name}</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-amber-600">Sin asignar</span>
            <div className="relative">
              <button onClick={() => setAssigningId(assigningId === ticket.id ? null : ticket.id)}
                className="flex items-center gap-0.5 text-[11px] font-medium text-slate-400 hover:text-sky-600 border border-slate-200 hover:border-sky-300 rounded-md px-1.5 py-0.5 transition-colors">
                <Plus size={10} />
                Asignar
              </button>
              {assigningId === ticket.id && (
                <AssignDropdown ticketId={ticket.id} washers={washers} onAssign={onAssign} onClose={() => setAssigningId(null)} />
              )}
            </div>
          </div>
        )}
      </div>
      <div className="w-[96px] shrink-0 pr-2 text-right flex items-center justify-end gap-1">
        <button onClick={() => onEditPrice(ticket)} title="Cambiar precio"
          className="p-1 text-slate-400 hover:text-[#b3001e] hover:bg-[#b3001e]/10 rounded transition-colors shrink-0">
          <Pencil size={12} />
        </button>
        <span className="text-[13px] font-semibold text-slate-700">{fmtRD(ticket.amount)}</span>
      </div>
      <div className="w-[52px] shrink-0 pr-2">
        <span className="text-[12px] text-slate-400">{fmtTime(ticket.createdAt)}</span>
      </div>
      <div className="w-[200px] shrink-0 flex items-center gap-1.5">
        <button onClick={() => onCycle(ticket.id)} title="Clic para cambiar estado"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-semibold cursor-pointer transition-all hover:brightness-95 active:scale-95 ${sc.bg} ${sc.text} ${sc.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dot}`} />
          {sc.es}
          <ChevronDown size={9} className="ml-0.5 opacity-50" />
        </button>
        {ticket.status === 'listo' && ticket.clientPhone && (
          <button onClick={() => onNotify?.(ticket)} title="Notificar al cliente por WhatsApp"
            className="p-1.5 text-emerald-600 hover:text-white hover:bg-emerald-500 rounded-lg transition-all shrink-0 active:scale-95 border border-emerald-200">
            <MessageCircle size={14} />
          </button>
        )}
        <button onClick={() => onCobrar(ticket)}
          className={`px-3 py-1.5 bg-green-500 hover:bg-green-400 text-white text-[11px] font-bold rounded-lg transition-all active:scale-95 shrink-0 ${ticket.status === 'listo' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          Cobrar
        </button>
        <button onClick={() => onDelete(ticket)} title="Eliminar de cola"
          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors shrink-0">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center h-14 border-b border-slate-100 px-5 gap-4 animate-pulse">
      <div className="w-16 h-4 bg-slate-100 rounded" />
      <div className="flex-1 h-4 bg-slate-100 rounded" />
      <div className="w-40 h-4 bg-slate-100 rounded" />
      <div className="w-32 h-4 bg-slate-100 rounded" />
      <div className="w-20 h-4 bg-slate-100 rounded" />
      <div className="w-12 h-4 bg-slate-100 rounded" />
      <div className="w-28 h-6 bg-slate-100 rounded-full" />
    </div>
  )
}

// ── Price change modal — verbatim ──────────────────────────────────────────
function PriceChangeModal({ ticket, onConfirm, onClose }) {
  const [step, setStep] = useState('pin')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [newPrice, setNewPrice] = useState(String(ticket.amount))
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handlePinSubmit(e) {
    e.preventDefault()
    if (pin.length < 4) { setPinError('PIN debe tener al menos 4 digitos'); return }
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
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        {step === 'pin' ? (
          <form onSubmit={handlePinSubmit}>
            <div className="flex items-center gap-2 mb-4">
              <Lock size={18} className="text-[#b3001e]" />
              <h3 className="text-[15px] font-bold text-slate-800">PIN de Administrador</h3>
            </div>
            <p className="text-[12px] text-slate-500 mb-4">Se requiere PIN de dueno o gerente para cambiar precios.</p>
            <input type="password" inputMode="numeric" autoFocus value={pin}
              onChange={e => { setPin(e.target.value); setPinError('') }}
              placeholder="PIN"
              className="w-full px-4 py-3 rounded-lg bg-slate-50 border border-slate-200 text-center text-lg font-bold tracking-[8px] text-slate-800 focus:outline-none focus:border-sky-400" />
            {pinError && <p className="text-red-500 text-xs mt-2">{pinError}</p>}
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg">Cancelar</button>
              <button type="submit" className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-[#b3001e] hover:bg-[#8c0017] rounded-lg transition-colors">Verificar</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-2 mb-4">
              <Pencil size={18} className="text-[#b3001e]" />
              <h3 className="text-[15px] font-bold text-slate-800">Cambiar Precio — {ticket.ticketNo}</h3>
            </div>
            <p className="text-[12px] text-slate-500 mb-3">Precio actual: <strong className="text-slate-800">{fmtRD(ticket.amount)}</strong></p>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Nuevo precio total</label>
            <input type="text" inputMode="decimal" autoFocus value={newPrice} onChange={e => setNewPrice(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-slate-50 border border-slate-200 text-lg font-bold text-slate-800 focus:outline-none focus:border-sky-400 mb-3" />
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Razon del cambio (obligatorio)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej: Cliente solicito servicio adicional..."
              rows={2}
              className="w-full px-4 py-3 rounded-lg bg-slate-50 border border-slate-200 text-[13px] text-slate-800 focus:outline-none focus:border-sky-400 resize-none mb-4" />
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg">Cancelar</button>
              <button type="submit" disabled={submitting || !reason.trim()}
                className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-[#b3001e] hover:bg-[#8c0017] rounded-lg transition-colors disabled:opacity-50">
                {submitting ? 'Guardando...' : 'Cambiar Precio'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function SumStat({ dot, label, value, highlight, warn }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="text-[12px] text-slate-500">{label}</span>
      <span className={`text-[15px] font-bold ${highlight ? 'text-green-600' : warn ? 'text-amber-600' : 'text-slate-700'}`}>{value}</span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function QueueDemo({ initialQueue, washers, isSalon = false }) {
  const [queue, setQueue]             = useState(initialQueue)
  const [filter, setFilter]           = useState('all')
  const [search, setSearch]           = useState('')
  const [assigningId, setAssigningId] = useState(null)
  const [toast, setToast]             = useState(null)
  const [cobrarModal, setCobrarModal] = useState(null)
  const [loadingTicket, setLoadingTicket] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [priceChangeModal, setPriceChangeModal] = useState(null)
  const [loading, setLoading]         = useState(false)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }
  function reload() { setLoading(true); setTimeout(() => setLoading(false), 500) }

  function deleteFromQueue(ticket) {
    setQueue(q => q.filter(t => t.id !== ticket.id))
    flash(`${ticket.ticketNo} · Eliminado de cola`)
    setDeleteConfirm(null)
  }
  function cycleStatus(id) {
    setQueue(q => q.map(t => {
      if (t.id !== id) return t
      if (t.status === 'listo') return t
      return { ...t, status: CYCLE_UI[t.status] }
    }))
  }
  function assignWorker(queueId, washer) {
    setQueue(q => q.map(t => t.id === queueId ? { ...t, worker: washer } : t))
    flash(`${washer.name} → ${queue.find(t => t.id === queueId)?.ticketNo}`)
  }
  function cobrar(ticket) {
    setLoadingTicket(true)
    setTimeout(() => { setLoadingTicket(false); setCobrarModal(ticket) }, 350)
  }
  function notifyReady(ticket) { flash(`WhatsApp enviado a ${ticket.clientPhone}`) }
  async function handlePriceChange({ newPrice }) {
    const ticket = priceChangeModal
    if (!ticket) return
    setQueue(q => q.map(t => t.id === ticket.id ? { ...t, amount: newPrice } : t))
    flash(`${ticket.ticketNo} · Precio actualizado → ${fmtRD(newPrice)}`)
    setPriceChangeModal(null)
  }

  // Counts
  const counts = {
    all:        queue.length,
    listo:      queue.filter(t => t.status === 'listo').length,
    proceso:    queue.filter(t => t.status === 'proceso').length,
    unassigned: queue.filter(t => !t.worker).length,
  }

  // Wait-time KPI
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
    { id: 'all',        es: 'Todos',       count: counts.all        },
    { id: 'listo',      es: 'Listo',       count: counts.listo      },
    { id: 'proceso',    es: 'En Proceso',  count: counts.proceso    },
    { id: 'unassigned', es: 'Sin Asignar', count: counts.unassigned },
  ]

  const COL_HEADERS = [
    { label: 'Ticket',                              w: 'w-[64px]'  },
    { label: isSalon ? 'Cliente'   : 'Vehículo',    w: 'w-[150px]' },
    { label: 'Servicio(s)',                         w: 'w-[160px]' },
    { label: isSalon ? 'Estilista' : 'Lavador',     w: 'w-[110px]' },
    { label: 'Monto',                               w: 'w-[96px] text-right' },
    { label: 'Hora',                                w: 'w-[52px]'  },
    { label: 'Estado',                              w: 'w-[200px]' },
  ]

  // For demo CobrarModal we map ticket → cart shape
  const cobrarCart = cobrarModal ? cobrarModal.services.map((s, i) => ({ id: i, name: s.name, price: s.price || cobrarModal.amount / cobrarModal.services.length, qty: 1 })) : []
  const cobrarSubtotal = cobrarModal ? cobrarModal.amount / 1.18 : 0
  const cobrarItbis    = cobrarModal ? cobrarModal.amount - cobrarSubtotal : 0

  return (
    <div className="h-full flex flex-col bg-white">

      <div className="shrink-0 border-b border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 gap-2 md:gap-0">
          <div>
            <h2 className="text-base md:text-lg font-bold text-slate-800">Cola de Espera</h2>
            <p className="text-xs text-slate-400 mt-0.5 hidden md:block">Actualiza el estado haciendo clic en el badge</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => reload()} disabled={loading}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" title="Actualizar">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-sky-400 w-full md:w-64 flex-1 md:flex-none">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={isSalon ? 'Buscar ticket o cliente...' : 'Buscar ticket o vehículo...'}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400" />
            </div>
          </div>
        </div>

        {waitMetrics.count > 0 && (
          <div className="flex items-center flex-wrap gap-2 md:gap-3 px-3 md:px-6 pb-2 md:pb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
              Espera promedio: {waitMetrics.avgMin} min
            </span>
            {waitMetrics.longestMin >= 10 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                <AlertCircle size={11} />
                Más demorado: {waitMetrics.longestNo || '—'} · {waitMetrics.longestMin} min
              </span>
            )}
          </div>
        )}

        <div className="flex px-3 md:px-6 gap-1 overflow-x-auto">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3.5 py-2.5 text-[12px] md:text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                filter === f.id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}>
              {f.es}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                filter === f.id ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-500'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Column headers — desktop only */}
      <div className="hidden md:flex items-center h-9 w-full bg-slate-50 border-b border-slate-200 px-5 shrink-0">
        {COL_HEADERS.map((col, i) => (
          <div key={i} className={`${col.w} text-[10px] font-bold text-slate-400 uppercase tracking-wider pr-2`}>{col.label}</div>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-300 gap-2">
            <span className="text-3xl">🚗</span>
            <p className="text-sm">No hay tickets en esta vista</p>
          </div>
        ) : (
          <>
            <div className="block md:hidden">
              {visible.map(ticket => (
                <QueueCard key={ticket.id} ticket={ticket} washers={washers}
                  assigningId={assigningId} setAssigningId={setAssigningId}
                  onCycle={cycleStatus} onAssign={assignWorker} onCobrar={cobrar}
                  onNotify={notifyReady} onDelete={t => setDeleteConfirm(t)}
                  onEditPrice={t => setPriceChangeModal(t)} />
              ))}
            </div>
            <div className="hidden md:block">
              {visible.map(ticket => (
                <QueueRow key={ticket.id} ticket={ticket} washers={washers}
                  assigningId={assigningId} setAssigningId={setAssigningId}
                  onCycle={cycleStatus} onAssign={assignWorker} onCobrar={cobrar}
                  onNotify={notifyReady} onDelete={t => setDeleteConfirm(t)}
                  onEditPrice={t => setPriceChangeModal(t)} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Summary bar */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-3 md:px-6 py-2 md:py-3 flex items-center gap-3 md:gap-6 flex-wrap">
        <SumStat dot="bg-green-500" label="Listos"      value={counts.listo}      highlight={counts.listo > 0} />
        <SumStat dot="bg-blue-500"  label="Proceso"     value={counts.proceso} />
        <SumStat dot="bg-amber-500" label="Sin asignar" value={counts.unassigned} warn={counts.unassigned > 0} />
        <div className="ml-auto pl-3 md:pl-6 border-l border-slate-200">
          <SumStat dot="bg-slate-400" label="Total" value={counts.all} />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}

      {loadingTicket && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl px-8 py-6 flex items-center gap-3 shadow-2xl">
            <Loader2 size={20} className="text-sky-500 animate-spin" />
            <p className="text-[14px] font-semibold text-slate-700">Cargando ticket…</p>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-bold text-slate-800 mb-1">Eliminar ticket de cola</p>
            <p className="text-[13px] text-slate-500 mb-5">¿Seguro que deseas eliminar {deleteConfirm.ticketNo}? Esta accion queda registrada.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg">Cancelar</button>
              <button onClick={() => deleteFromQueue(deleteConfirm)} className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg">Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {priceChangeModal && <PriceChangeModal ticket={priceChangeModal} onConfirm={handlePriceChange} onClose={() => setPriceChangeModal(null)} />}
      {cobrarModal && (
        <DemoCobrarModal cart={cobrarCart} subtotal={cobrarSubtotal} itbis={cobrarItbis} total={cobrarModal.amount}
          client={cobrarModal.clientName ? { name: cobrarModal.clientName } : null}
          onClose={() => setCobrarModal(null)}
          onComplete={() => { setQueue(q => q.filter(t => t.id !== cobrarModal.id)); setCobrarModal(null); flash(`${cobrarModal.ticketNo} · Cobrado ✓`) }} />
      )}
    </div>
  )
}
