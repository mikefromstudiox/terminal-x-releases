import { useState, useRef, useEffect } from 'react'
import { Search, Plus, ChevronDown, CheckCircle2, Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useQueueActive, useWashers } from '../hooks/useDB'
import CobrarModal from '../components/CobrarModal'
import { printClientReceipt, printWasherConduce } from '../services/printer'
import { syncTicket } from '../services/supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS = {
  pendiente: { es: 'Pendiente',  en: 'Pending',      bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500'  },
  proceso:   { es: 'En Proceso', en: 'In Progress',  bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500'   },
  listo:     { es: 'Listo',      en: 'Ready',        bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500'  },
}

// DB status → UI status
const FROM_DB  = { waiting: 'pendiente', in_progress: 'proceso', done: 'listo' }
// UI status → DB status
const TO_DB    = { pendiente: 'waiting', proceso: 'in_progress', listo: 'done' }
// UI cycle order
const CYCLE_UI = { pendiente: 'proceso', proceso: 'listo', listo: 'pendiente' }

function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtTime(date) {
  return new Date(date).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

// ── Map raw DB row to UI ticket shape ─────────────────────────────────────────

function mapRow(row) {
  return {
    id:          row.id,
    ticketId:    row.ticket_id,
    ticketNo:    row.doc_number || `Q-${row.id}`,
    vehicle:     row.client_name || row.vehicle_plate || 'Al Portador',
    servicesStr: row.services || '',
    services:    (row.services || '').split(' + ').filter(Boolean).map(n => ({ name: n, price: 0 })),
    worker:      row.washer_id ? { id: row.washer_id, name: row.washer_name || '—' } : null,
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

// ── Table row ─────────────────────────────────────────────────────────────────

// ── Mobile card for queue ──────────────────────────────────────────────────────

function QueueCard({ ticket, washers, assigningId, setAssigningId, onCycle, onAssign, onCobrar, lang }) {
  const sc   = STATUS[ticket.status]
  const main = ticket.services[0]?.name || ticket.servicesStr

  return (
    <div className={`border-b border-slate-100 px-3 py-3 ${sc.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-sky-600">{ticket.ticketNo}</span>
        <span className="text-[11px] text-slate-400">{fmtTime(ticket.createdAt)}</span>
      </div>
      <p className="text-[13px] font-semibold text-slate-800 truncate">{ticket.vehicle}</p>
      <p className="text-[12px] text-slate-500 truncate mt-0.5">{main}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[13px] font-semibold text-slate-700">{fmtRD(ticket.amount)}</span>
        {ticket.worker ? (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 bg-slate-100 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-600 shrink-0">
              {ticket.worker.name[0]}
            </div>
            <span className="text-[12px] text-slate-600 truncate max-w-[80px]">{ticket.worker.name}</span>
          </div>
        ) : (
          <div className="relative">
            <button
              onClick={() => setAssigningId(assigningId === ticket.id ? null : ticket.id)}
              className="flex items-center gap-1 text-[11px] font-medium text-amber-600 border border-amber-200 rounded-lg px-2.5 py-1.5 min-h-[44px] transition-colors"
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
        {ticket.status === 'listo' && (
          <button
            onClick={() => onCobrar(ticket)}
            className="flex-1 py-2 bg-green-500 hover:bg-green-400 text-white text-[12px] font-bold rounded-lg min-h-[44px] transition-all active:scale-95"
          >
            {lang === 'es' ? 'Cobrar' : 'Collect'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Desktop table row ─────────────────────────────────────────────────────────

function QueueRow({ ticket, washers, assigningId, setAssigningId, onCycle, onAssign, onCobrar, lang }) {
  const sc   = STATUS[ticket.status]
  const main = ticket.services[0]?.name || ticket.servicesStr
  const extra = ticket.services.length - 1

  return (
    <div className={`flex items-center h-14 border-b border-slate-100 px-5 transition-colors group ${sc.bg} hover:brightness-95`}>

      <div className="w-[72px] shrink-0">
        <span className="text-[13px] font-bold text-sky-600">{ticket.ticketNo}</span>
      </div>

      <div className="flex-1 min-w-0 pr-4">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{ticket.vehicle}</p>
      </div>

      <div className="w-[190px] shrink-0 pr-4 flex items-center gap-1.5 min-w-0">
        <span className="text-[13px] font-semibold text-slate-800 truncate">{main}</span>
        {extra > 0 && (
          <span className="shrink-0 text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
            +{extra}
          </span>
        )}
      </div>

      <div className="w-[148px] shrink-0 pr-4 relative">
        {ticket.worker ? (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">
              {ticket.worker.name[0]}
            </div>
            <span className="text-[13px] text-slate-700 truncate">{ticket.worker.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-amber-600">
              {lang === 'es' ? 'Sin asignar' : 'Unassigned'}
            </span>
            <div className="relative">
              <button
                onClick={() => setAssigningId(assigningId === ticket.id ? null : ticket.id)}
                className="flex items-center gap-0.5 text-[11px] font-medium text-slate-400 hover:text-sky-600 border border-slate-200 hover:border-sky-300 rounded-md px-1.5 py-0.5 transition-colors"
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

      <div className="w-[96px] shrink-0 pr-4 text-right">
        <span className="text-[13px] font-semibold text-slate-700">{fmtRD(ticket.amount)}</span>
      </div>

      <div className="w-[56px] shrink-0 pr-4">
        <span className="text-[12px] text-slate-400">{fmtTime(ticket.createdAt)}</span>
      </div>

      <div className="w-[192px] shrink-0 flex items-center gap-2">
        <button
          onClick={() => onCycle(ticket.id)}
          title={lang === 'es' ? 'Clic para cambiar estado' : 'Click to change status'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-semibold cursor-pointer transition-all hover:brightness-95 active:scale-95 ${sc.bg} ${sc.text} ${sc.border}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dot}`} />
          {lang === 'es' ? sc.es : sc.en}
          <ChevronDown size={9} className="ml-0.5 opacity-50" />
        </button>

        <button
          onClick={() => onCobrar(ticket)}
          className={`px-3 py-1.5 bg-green-500 hover:bg-green-400 text-white text-[11px] font-bold rounded-lg transition-all active:scale-95 shrink-0 ${
            ticket.status === 'listo' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {lang === 'es' ? 'Cobrar' : 'Collect'}
        </button>
      </div>
    </div>
  )
}

// ── Skeleton row ─────────────────────────────────────────────────────────────

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

// ── Main Queue Screen ─────────────────────────────────────────────────────────

export default function Queue() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { lang } = useLang()

  const { data: dbQueue, loading, error, reload } = useQueueActive()
  const { data: washers }                         = useWashers()

  const [queue,       setQueue]       = useState([])
  const [filter,      setFilter]      = useState('all')
  const [search,      setSearch]      = useState('')
  const [assigningId, setAssigningId] = useState(null)
  const [toast,       setToast]       = useState(null)
  const [cobrarModal, setCobrarModal] = useState(null)
  const [loadingTicket, setLoadingTicket] = useState(false)

  // Sync DB data → local state (preserves optimistic updates)
  useEffect(() => {
    if (!loading && dbQueue) {
      setQueue(dbQueue.map(mapRow))
    }
  }, [dbQueue, loading])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function cycleStatus(id) {
    const ticket   = queue.find(t => t.id === id)
    if (!ticket) return
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
      flash(`Error: ${err.message}`)
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
        services: full?.items?.map(i => ({ name: i.name, price: i.price }))
                  ?? [{ name: ticket.servicesStr, price: ticket.amount }],
      })
    } catch {
      setCobrarModal({
        id:       ticket.ticketId,
        queueId:  ticket.id,
        ticketNo: ticket.ticketNo,
        vehicle:  ticket.vehicle,
        services: ticket.services.length ? ticket.services : [{ name: ticket.servicesStr, price: ticket.amount }],
      })
    } finally {
      setLoadingTicket(false)
    }
  }

  async function handlePaymentConfirm(data) {
    const snapshot = cobrarModal
    const queueId  = snapshot.queueId
    const ticketId = snapshot.id

    // ── Fire print + drawer BEFORE closing modal ──────────────────────────
    // This lets the cashier still see the total/change while the receipt prints
    if (window.electronAPI) {
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
        }
        const services = snapshot.services || []
        const subtotal  = services.reduce((s, i) => s + (i.price || 0), 0)
        const ticketData = {
          ncf:          data.ecf?.eNCF    || '',
          ncfType:      data.ncfType      || 'E32',
          cajero:       '',
          lavador:      snapshot.worker?.name || '',
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
        }
        if (cfg.print_factura_auto === '1') printClientReceipt(ticketData).catch(() => {})
        if (cfg.print_conduce_auto === '1') printWasherConduce(ticketData).catch(() => {})
        // Kick drawer for cash/check payments
        const fm = data.formaPago || ''
        if (data.tipo !== 'credito' && !['tarjeta', 'transferencia'].includes(fm)) {
          printerApi?.openDrawer?.().catch?.(() => {})
        }
      } catch { /* print errors never block the queue flow */ }
    }

    // ── Close modal + update queue ────────────────────────────────────────
    setCobrarModal(null)
    setQueue(q => q.filter(t => t.id !== queueId))
    flash(`${data.ticketNo} · ${lang === 'es' ? 'Cobrado' : 'Collected'} ✓`)

    // ── Persist to DB ─────────────────────────────────────────────────────
    if (ticketId) {
      try {
        const markResult = await api.tickets.markPaid({
          id:            ticketId,
          paymentMethod: data.tipo === 'credito' ? 'credit' : (data.formaPago || 'cash'),
          ncf:           data.ecf?.eNCF || null,
          ecfResult:     data.ecf || null,
          clientId:      data.clientId || null,
          tipoVenta:     data.tipo || null,
        })
        syncTicket({
          client_name:    data.clientId ? String(data.clientId) : null,
          payment_method: data.tipo === 'credito' ? 'credit' : (data.formaPago || 'cash'),
          total:          data.total || 0,
          status:         'cobrado',
        }, { docNumber: data.ticketNo || snapshot?.ticketNo }).catch(() => {})
      } catch (err) {
        console.error('[Queue] markPaid error:', err)
      }
    }
  }

  // Counts
  const counts = {
    all:        queue.length,
    listo:      queue.filter(t => t.status === 'listo').length,
    proceso:    queue.filter(t => t.status === 'proceso').length,
    unassigned: queue.filter(t => !t.worker).length,
  }

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

  const COL_HEADERS = [
    { label_es: 'Ticket',      label_en: 'Ticket',    w: 'w-[72px]'  },
    { label_es: 'Vehículo',    label_en: 'Vehicle',   w: 'flex-1'    },
    { label_es: 'Servicio(s)', label_en: 'Service(s)',w: 'w-[190px]' },
    { label_es: 'Lavador',     label_en: 'Washer',    w: 'w-[148px]' },
    { label_es: 'Monto',       label_en: 'Amount',    w: 'w-[96px] text-right' },
    { label_es: 'Hora',        label_en: 'Time',      w: 'w-[56px]'  },
    { label_es: 'Estado',      label_en: 'Status',    w: 'w-[192px]' },
  ]

  return (
    <div className="h-full flex flex-col bg-white">

      <div className="shrink-0 border-b border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 gap-2 md:gap-0">
          <div>
            <h2 className="text-base md:text-lg font-bold text-slate-800">
              {lang === 'es' ? 'Cola de Espera' : 'Service Queue'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 hidden md:block">
              {lang === 'es' ? 'Actualiza el estado haciendo clic en el badge' : 'Click the badge to update status'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Reload */}
            <button
              onClick={() => reload()}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
              title={lang === 'es' ? 'Actualizar' : 'Refresh'}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>

            {/* Search */}
            <div className="relative flex-1 md:flex-none">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={lang === 'es' ? 'Buscar ticket o vehículo...' : 'Search ticket or vehicle...'}
                className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:border-sky-400 w-full md:w-64 placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>

        <div className="flex px-3 md:px-6 gap-1 overflow-x-auto">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3.5 py-2.5 text-[12px] md:text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                filter === f.id
                  ? 'border-sky-500 text-sky-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {lang === 'es' ? f.es : f.en}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                filter === f.id ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-500'
              }`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Column headers — desktop only */}
      <div className="hidden md:flex items-center h-9 bg-slate-50 border-b border-slate-200 px-5 shrink-0">
        {COL_HEADERS.map((col, i) => (
          <div key={i} className={`${col.w} text-[10px] font-bold text-slate-400 uppercase tracking-wider pr-4`}>
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
          <div className="flex flex-col items-center justify-center h-48 text-slate-300 gap-2">
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
                  lang={lang}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Summary bar */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-3 md:px-6 py-2 md:py-3 flex items-center gap-3 md:gap-6 flex-wrap">
        <SumStat dot="bg-green-500" label={lang === 'es' ? 'Listos' : 'Ready'} value={counts.listo} highlight={counts.listo > 0} />
        <SumStat dot="bg-blue-500"  label={lang === 'es' ? 'Proceso' : 'Progress'}  value={counts.proceso} />
        <SumStat dot="bg-amber-500" label={lang === 'es' ? 'Sin asignar' : 'Unassigned'} value={counts.unassigned} warn={counts.unassigned > 0} />
        <div className="ml-auto pl-3 md:pl-6 border-l border-slate-200">
          <SumStat dot="bg-slate-400" label={lang === 'es' ? 'Total' : 'Total'} value={counts.all} />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}

      {/* Loading ticket overlay */}
      {loadingTicket && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl px-8 py-6 flex items-center gap-3 shadow-2xl">
            <Loader2 size={20} className="text-sky-500 animate-spin" />
            <p className="text-[14px] font-semibold text-slate-700">
              {lang === 'es' ? 'Cargando ticket…' : 'Loading ticket…'}
            </p>
          </div>
        </div>
      )}

      {/* Cobrar Modal */}
      {cobrarModal && (
        <CobrarModal
          ticket={cobrarModal}
          onConfirm={handlePaymentConfirm}
          onClose={() => setCobrarModal(null)}
        />
      )}
    </div>
  )
}

function SumStat({ dot, label, value, highlight, warn }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="text-[12px] text-slate-500">{label}</span>
      <span className={`text-[15px] font-bold ${
        highlight ? 'text-green-600' : warn ? 'text-amber-600' : 'text-slate-700'
      }`}>
        {value}
      </span>
    </div>
  )
}
