import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ChevronDown, Check, CheckCircle2, Search, Loader2, AlertCircle, ShoppingCart, UserRound } from 'lucide-react'
import { useLang } from '../i18n'
import { useLayout } from '../context/LayoutContext'
import { useAuth } from '../context/AuthContext'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useServices, useWashers, useSellers } from '../hooks/useDB'
import { useRNC } from '../hooks/useRNC'
import CobrarModal from '../components/CobrarModal'
import { NewClientForm } from './Clients'
import { printClientReceipt, printWasherConduce } from '../services/printer'
import { syncTicket } from '../services/supabase'
import { syncTicketFull } from '../services/sync'
import { saveReceiptPDF } from '../services/pdf'
import logoImg from '../assets/logo.png'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Category name translations — Spanish DB value → English display label
const CAT_EN = {
  'Lavado':      'Wash',
  'Lavados':     'Wash',
  'Detallado':   'Detailing',
  'Detailing':   'Detailing',
  'Adicionales': 'Add-ons',
  'Extra':       'Add-ons',
  'Combos':      'Combos',
  'Bebida':      'Beverages',
  'Bebidas':     'Beverages',
  'Snacks':      'Snacks',
}

function catLabel(cat, lang) {
  if (lang === 'en') return CAT_EN[cat] ?? cat
  return cat
}

const ITBIS = 0.18
const LEY   = 0.10

function calcTotals(items) {
  const total    = items.reduce((s, i) => s + i.price, 0) // prices already include ITBIS
  const subtotal = parseFloat((total / (1 + ITBIS)).toFixed(2))  // extract pre-ITBIS base
  const itbis    = parseFloat((total - subtotal).toFixed(2))
  return { subtotal, itbis, ley: 0, total }
}

function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS = {
  listo:     { dot: 'bg-green-500', pill: 'bg-green-100 text-green-700', label_es: 'Listo',      label_en: 'Ready'       },
  proceso:   { dot: 'bg-blue-500',  pill: 'bg-blue-100 text-blue-700',   label_es: 'En Proceso', label_en: 'In Progress'  },
  pendiente: { dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-700', label_es: 'Pendiente',  label_en: 'Pending'     },
}


// ── Skeleton loader ───────────────────────────────────────────────────────────

function GridSkeleton({ cols }) {
  return (
    <div className={`grid gap-2.5 ${cols}`}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl p-3.5 bg-slate-100 animate-pulse h-16" />
      ))}
    </div>
  )
}

// ── Worker Multi-Select ───────────────────────────────────────────────────────

function WorkerSelect({ selected, onChange, washers, t }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  function toggle(worker) {
    onChange(
      selected.some(w => w.id === worker.id)
        ? selected.filter(w => w.id !== worker.id)
        : [...selected, worker]
    )
  }

  return (
    <div ref={ref} className="relative">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map(w => (
            <span
              key={w.id}
              className="flex items-center gap-1 pl-2 pr-1 py-0.5 bg-slate-800 text-white text-[11px] font-medium rounded-full"
            >
              {w.name}
              <button
                onClick={() => toggle(w)}
                className="w-3.5 h-3.5 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm md:text-[12px] text-slate-500 hover:border-slate-400 transition-colors min-h-[44px] md:min-h-0"
      >
        <span>
          {selected.length === 0
            ? t('pos_workers_placeholder')
            : `${selected.length} ${selected.length === 1 ? t('pos_selected_one') : t('pos_selected_many')}`
          }
        </span>
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden max-h-48 overflow-y-auto">
          {washers.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px] text-slate-400 italic">Sin lavadores disponibles</p>
          ) : (
            washers.map(w => {
              const checked = selected.some(s => s.id === w.id)
              return (
                <button
                  key={w.id}
                  onClick={() => toggle(w)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left min-h-[44px] md:min-h-0"
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    checked ? 'bg-sky-500 border-sky-500' : 'border-slate-300'
                  }`}>
                    {checked && <Check size={9} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className="text-[13px] text-slate-700">{w.name}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// ── Queue Strip ───────────────────────────────────────────────────────────────

function QueueStrip({ queue, lang }) {
  const visible = queue.slice(-3)
  if (!visible.length) return null

  return (
    <div className="border-t border-slate-100 bg-white px-4 py-2.5 flex items-center gap-3 shrink-0">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
        {lang === 'es' ? 'En Cola' : 'In Queue'}
      </span>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {visible.map(car => {
          const s = STATUS[car.status] || STATUS.pendiente
          return (
            <div key={car.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 shrink-0 border border-slate-100">
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
              <div>
                <p className="text-[11px] font-semibold text-slate-700 leading-none">{car.vehicle}</p>
                <p className="text-[10px] text-slate-400 leading-none mt-0.5">{car.service}</p>
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${s.pill}`}>
                {lang === 'es' ? s.label_es : s.label_en}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main POS Screen ───────────────────────────────────────────────────────────

export default function POS() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { t, lang } = useLang()
  const { collapsed } = useLayout()
  const { user } = useAuth()
  const navigate = useNavigate()

  // ── DB data
  const { data: rawServicesDB, loading: svcLoading, error: svcError } = useServices()
  const rawServices = rawServicesDB || []
  const { data: rawWashersDB, loading: wsrLoading }                  = useWashers()
  const rawWashers = rawWashersDB || []
  const { data: rawSellersDB }                                       = useSellers()
  const rawSellers = rawSellersDB || []
  const { lookup: rncLookup }                                        = useRNC()

  // ── Derived: categories + services grouped
  const categories = useMemo(() => {
    const seen = new Set()
    const cats = []
    for (const svc of rawServices) {
      if (!seen.has(svc.category)) {
        seen.add(svc.category)
        cats.push({ id: svc.category, label: svc.category })
      }
    }
    return cats
  }, [rawServices])

  const servicesByCategory = useMemo(() => {
    const groups = {}
    for (const svc of rawServices) {
      if (!groups[svc.category]) groups[svc.category] = []
      groups[svc.category].push(svc)
    }
    return groups
  }, [rawServices])

  // ── UI state
  const [category,  setCategory]  = useState(null)
  const [items,     setItems]     = useState([])
  const [queue,     setQueue]     = useState([])
  const [toast,     setToast]     = useState(null)
  const [cobrarModal, setCobrarModal] = useState(null)

  // Client state
  const [clients,        setClients]        = useState([])
  const [selectedClient, setSelectedClient] = useState(null) // { id, name, rnc }
  const [showClientPicker, setShowClientPicker] = useState(false)
  const [showNewClient,  setShowNewClient]  = useState(false)
  const [clientSearch,   setClientSearch]   = useState('')

  // Load clients once (re-run when api becomes available)
  useEffect(() => {
    api.clients?.all?.().then(r => setClients(r || [])).catch(() => flash(lang === 'es' ? 'Error al cargar clientes' : 'Error loading clients'))
  }, [api])

  // Form state
  const [rnc,         setRnc]         = useState('')
  const [rncName,     setRncName]     = useState('')
  const [vehicle,     setVehicle]     = useState('')
  const [workers,     setWorkers]     = useState([])
  const [salesperson, setSalesperson] = useState('')

  // Keep selected category in sync with DB categories
  useEffect(() => {
    if (categories.length > 0 && (category === null || !categories.find(c => c.id === category))) {
      setCategory(categories[0].id)
    }
  }, [categories])

  const allOrderItems = items
  const { subtotal, itbis, ley, total } = calcTotals(allOrderItems)
  const gridCols = collapsed ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'

  // Mobile cart visibility
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const cartRef = useRef(null)

  // O(1) lookup instead of O(n) items.some() per service button
  const selectedIds = useMemo(() => new Set(items.map(i => i.id)), [items])

  function clearForm() {
    setItems([])
    setVehicle('')
    setRnc('')
    setRncName('')
    setSelectedClient(null)
    setWorkers([])
    setSalesperson('')
  }

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      // Ignore when typing inside an input / textarea / select
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'F1') {
        e.preventDefault()
        clearForm()
      } else if (e.key === 'F2') {
        e.preventDefault()
        if (allOrderItems.length > 0) {
          setCobrarModal({ vehicle, items: allOrderItems, workers, salesperson, clientId: selectedClient?.id || null, clientName: selectedClient?.name || rncName || '', client: selectedClient || null })
        }
      } else if (e.key === 'F3') {
        e.preventDefault()
        navigate('/queue')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allOrderItems, vehicle, workers, salesperson, rncName, navigate])

  function toggleService(svc) {
    setItems(prev =>
      prev.some(i => i.id === svc.id)
        ? prev.filter(i => i.id !== svc.id)
        : [...prev, svc]
    )
  }

  function removeOrderItem(item) {
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  async function handleRncLookup() {
    if (rnc.replace(/\D/g, '').length < 9) return
    const res = await rncLookup(rnc)
    if (res?.ok && res.nombre) setRncName(res.nombre)
  }

  async function handleEncolar() {
    if (allOrderItems.length === 0 && !vehicle.trim()) return

    try {
      const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(allOrderItems)
      const beverageSubtotal = allOrderItems
        .filter(s => s.is_wash === 0)
        .reduce((s, i) => s + i.price, 0)

      const result = await api.tickets.create({
        vehicle_plate:     vehicle.trim() || null,
        client_id:         selectedClient?.id || null,
        washer_ids:        workers.map(w => w.id),
        seller_id:         salesperson || null,
        cajero_id:         (user?.id && user.id !== 'web') ? user.id : null,
        comprobante_type:  'B02',
        payment_method:    'cash',
        tipo_venta:        'contado',
        status:            'pendiente',
        subtotal:          sub,
        itbis:             itp,
        ley:               ly,
        total:             tot,
        beverage_subtotal: beverageSubtotal,
        items:             allOrderItems.map(s => ({
          service_id: typeof s.id === 'number' ? s.id : null,
          name:       s.name,
          price:      s.price,
          is_wash:    s.is_wash ?? 1,
        })),
      })

      clearForm()
      if (result?.offlineReason) {
        flash(`OFFLINE: ${result.offlineReason}`)
      } else if (result?.queueError) {
        flash(`${result.docNumber} · Queue error: ${result.queueError}`)
      } else {
        flash(`${result?.docNumber || 'Ticket'} · ${lang === 'es' ? 'Puesto en cola ✓' : 'Added to queue ✓'}`)
      }
    } catch (err) {
      flash(`Error: ${err.message}`)
    }
  }

  const handlePaymentConfirm = useCallback(async (paymentData) => {
    const pending = cobrarModal
    setCobrarModal(null)

    try {
      const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(pending.items)
      const beverageSubtotal = pending.items
        .filter(s => s.is_wash === 0)
        .reduce((s, i) => s + i.price, 0)

      const result = await api.tickets.create({
        vehicle_plate:    pending.vehicle,
        client_id:        pending.clientId || null,
        washer_ids:       pending.workers.map(w => w.id),
        seller_id:        pending.salesperson || null,
        cajero_id:        (user?.id && user.id !== 'web') ? user.id : null,
        comprobante_type: paymentData.ncfType || 'E32',
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        tipo_venta:       paymentData.tipo || 'contado',
        subtotal:         sub,
        itbis:            itp,
        ley:              ly,
        total:            tot,
        beverage_subtotal: beverageSubtotal,
        ecf_result:       paymentData.ecf || {},
        items:            pending.items.map(s => ({
          service_id: typeof s.id === 'number' ? s.id : null,
          name:       s.name,
          price:      s.price,
          is_wash:    s.is_wash ?? 1,
        })),
        comentario: paymentData.comentario || '',
      })

      if (result?.docNumber) {
        setQueue(prev => [...prev, {
          id:      Date.now(),
          ticketNo: result.docNumber,
          vehicle:  pending.vehicle,
          service:  pending.items[0]?.name ?? '—',
          status:   'pendiente',
        }])
      }
      clearForm()
      flash(`${result?.docNumber || 'Ticket'} · ${lang === 'es' ? 'Creado ✓' : 'Created ✓'}`)

      // Sync to Supabase for RemoteDashboard — fire and forget
      syncTicket({
        client_name:      pending.clientName || null,
        comprobante_type: paymentData.ncfType || 'E32',
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        tipo_venta:       paymentData.tipo || 'contado',
        subtotal: sub, itbis: itp, ley: ly, total: tot,
        status:           'cobrado',
        cajero_name:      user?.name || null,
        items:            pending.items,
        ecf_result:       paymentData.ecf || {},
      }, result).catch(() => {})

      // Full sync via sync service — fire and forget
      syncTicketFull({
        client_name:      pending.clientName || null,
        comprobante_type: paymentData.ncfType || 'E32',
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        tipo_venta:       paymentData.tipo || 'contado',
        subtotal: sub, itbis: itp, ley: ly, total: tot,
        status:           'cobrado',
        cajero_name:      user?.name || null,
        items:            pending.items,
        ecf_result:       paymentData.ecf || {},
      }, result)

      // ── Auto-print receipt + conduce ────────────────────────────────────────
      try {
        const [cfg, empresa] = await Promise.all([
          api.settings.get().catch(() => ({})),
          api.admin.getEmpresa().catch(() => ({})),
        ])
        const biz = {
          name:    empresa?.nombre   || empresa?.name    || '',
          address: empresa?.direccion || empresa?.address || '',
          phone:   empresa?.telefono  || empresa?.phone   || '',
          rnc:     empresa?.rnc       || '',
          logo:    empresa?.logo      || '',
        }
        const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(pending.items)
        const ticketData = {
          ncf:          result?.ncf       || '',
          ncfType:      paymentData.ncfType || 'E32',
          cajero:       user?.name         || '',
          lavador:      pending.workers?.map(w => w.name).join(', ') || '',
          docNo:        result?.docNumber  || '',
          paidAt:       new Date(),
          client:       pending.client     || null,
          vehiclePlate: pending.vehicle    || '',
          tipo:         paymentData.tipo   || 'contado',
          formaPago:    paymentData.formaPago || 'cash',
          services:     pending.items,
          subtotal:     sub,
          descuento:    0,
          itbis:        itp,
          ley:          ly,
          total:        tot,
          biz,
        }
        if (cfg.print_factura_auto === '1') printClientReceipt(ticketData).catch(() => flash(lang === 'es' ? 'Error al imprimir factura' : 'Print error: invoice'))
        if (cfg.print_conduce_auto === '1') printWasherConduce(ticketData).catch(() => flash(lang === 'es' ? 'Error al imprimir conduce' : 'Print error: conduce'))
        // Save PDF copy to userData/receipts/
        saveReceiptPDF(ticketData).catch(() => flash(lang === 'es' ? 'Error al guardar PDF' : 'PDF save error'))
        // Kick drawer for cash/check payments
        const fm = paymentData.formaPago || ''
        if (paymentData.tipo !== 'credito' && !['tarjeta', 'transferencia'].includes(fm)) {
          printerApi?.openDrawer?.().catch?.(() => {})
        }
      } catch { /* print errors never block the POS flow */ }
    } catch (err) {
      flash(`Error: ${err.message}`)
    }
  }, [cobrarModal, queue.length, lang])

  return (
    <div className="h-full flex flex-col md:flex-row">

      {/* ══ CENTER ══════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile header with logo — matches desktop sidebar style */}
        <div className="md:hidden flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-0.5">
            <span className="text-[#0C447C] font-black text-[15px] tracking-[3px]">TERMINAL</span>
            <img src={logoImg} alt="X" className="h-6 w-auto object-contain -ml-0.5" draggable={false} />
          </div>
          <span className="text-xs text-slate-400">{new Date().toLocaleDateString('es-DO')}</span>
        </div>

        {/* Category tabs — horizontal scroll on mobile */}
        <div className="flex border-b border-slate-200 bg-white shrink-0 overflow-x-auto scrollbar-hide">
          {svcLoading ? (
            <div className="flex gap-1 px-4 py-2">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-8 w-20 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-4 md:px-5 py-3 md:py-3.5 text-xs md:text-sm font-semibold transition-colors border-b-2 -mb-px shrink-0 min-h-[44px] ${
                category === cat.id
                  ? 'border-[#0C447C] text-[#0C447C]'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              {catLabel(cat.label, lang)}
            </button>
          ))}
        </div>

        {/* Service grid */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4 pb-24 md:pb-4">
          {svcLoading ? (
            <GridSkeleton cols={gridCols} />
          ) : svcError ? (
            <div className="flex flex-col items-center justify-center h-48 text-red-400 gap-2">
              <AlertCircle size={28} />
              <p className="text-sm">{lang === 'es' ? 'Error al cargar servicios' : 'Error loading services'}</p>
            </div>
          ) : (
            <div className={`grid gap-2 md:gap-2.5 ${gridCols}`}>
              {(servicesByCategory[category] ?? []).map(svc => {
                const selected = selectedIds.has(svc.id)
                return (
                  <button
                    key={svc.id}
                    onClick={() => toggleService(svc)}
                    className={`rounded-xl p-3 md:p-3.5 text-left transition-all border min-h-[44px] ${
                      selected
                        ? 'bg-[#E6F1FB] border-[#0C447C] text-[#0C447C] shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-[#0C447C]/40 hover:shadow-sm'
                    }`}
                  >
                    <p className="text-xs md:text-[13px] font-semibold leading-snug">
                      {lang === 'es' ? svc.name : (svc.name_en || svc.name)}
                    </p>
                    <p className={`text-[11px] md:text-[12px] font-bold mt-1 md:mt-1.5 ${selected ? 'text-[#0C447C]/70' : 'text-slate-400'}`}>
                      {fmtRD(svc.price)}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Queue strip */}
        <div className="hidden md:block">
          <QueueStrip queue={queue} lang={lang} />
        </div>
      </div>

      {/* ══ MOBILE: Floating cart button ═════════════════════════════════ */}
      {allOrderItems.length > 0 && !mobileCartOpen && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="md:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-40 bg-[#0C447C] text-white font-bold py-3 px-6 rounded-full shadow-lg shadow-[#0C447C]/30 flex items-center gap-2 min-h-[44px] active:scale-95 transition-transform"
        >
          <ShoppingCart size={18} />
          <span className="text-sm">
            {lang === 'es' ? 'Ver Carrito' : 'View Cart'} ({allOrderItems.length})
          </span>
          <span className="text-xs opacity-70">{fmtRD(total)}</span>
        </button>
      )}

      {/* ══ MOBILE: Cart overlay backdrop ════════════════════════════════ */}
      {mobileCartOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setMobileCartOpen(false)}
        />
      )}

      {/* ══ RIGHT PANEL / MOBILE SLIDE-UP CART ══════════════════════════ */}
      <div
        ref={cartRef}
        className={`
          md:w-[220px] md:shrink-0 md:border-l md:border-slate-200 md:flex md:flex-col md:bg-white md:static md:translate-y-0 md:rounded-none md:z-auto md:max-h-none
          fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col max-h-[85vh] transition-transform duration-300 ease-out
          ${mobileCartOpen ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}
        `}
      >
        {/* Mobile drag handle + close */}
        <div className="md:hidden flex items-center justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="md:hidden flex items-center justify-between px-4 pb-2 shrink-0">
          <p className="text-sm font-bold text-slate-700">
            {lang === 'es' ? 'Carrito' : 'Cart'} ({allOrderItems.length})
          </p>
          <button
            onClick={() => setMobileCartOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 min-h-[44px] min-w-[44px]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">

          {/* Client selector */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              {lang === 'es' ? 'Cliente' : 'Client'}
            </label>
            {selectedClient ? (
              <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-2 min-h-[44px] md:min-h-0">
                <UserRound size={14} className="text-sky-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-sky-800 truncate">{selectedClient.name}</p>
                  {selectedClient.rnc && <p className="text-[10px] text-sky-500">{selectedClient.rnc}</p>}
                </div>
                <button onClick={() => setSelectedClient(null)} className="text-sky-400 hover:text-sky-600 p-1">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <button
                  onClick={() => setShowClientPicker(true)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-sm md:text-[12px] min-h-[44px] md:min-h-0 text-slate-400 hover:border-sky-300 hover:text-sky-500 transition-colors"
                >
                  <UserRound size={14} />
                  <span className="truncate">{lang === 'es' ? 'Seleccionar cliente...' : 'Select client...'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Client picker modal */}
          {showClientPicker && (
            <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30" onClick={() => setShowClientPicker(false)}>
              <div className="bg-white w-full md:w-[380px] md:rounded-2xl shadow-2xl max-h-[70vh] flex flex-col rounded-t-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                  <Search size={14} className="text-slate-400" />
                  <input
                    type="text"
                    autoFocus
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    placeholder={lang === 'es' ? 'Buscar cliente...' : 'Search client...'}
                    className="flex-1 text-[13px] focus:outline-none placeholder:text-slate-300"
                  />
                  <button onClick={() => setShowClientPicker(false)} className="text-slate-400 hover:text-slate-600 p-1">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {/* New client + Consumidor Final */}
                  <button
                    onClick={() => { setShowClientPicker(false); setShowNewClient(true); setClientSearch('') }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-50 border-b border-slate-100 text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-[14px] font-bold">+</div>
                    <span className="text-[13px] font-semibold text-emerald-700">{lang === 'es' ? 'Nuevo Cliente' : 'New Client'}</span>
                  </button>
                  <button
                    onClick={() => { setSelectedClient(null); setShowClientPicker(false); setClientSearch('') }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-50 text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400"><UserRound size={14} /></div>
                    <span className="text-[13px] text-slate-500 italic">{lang === 'es' ? 'Consumidor Final (sin cliente)' : 'Walk-in (no client)'}</span>
                  </button>
                  {clients
                    .filter(c => {
                      if (!clientSearch.trim()) return true
                      const q = clientSearch.toLowerCase()
                      return (c.name || '').toLowerCase().includes(q) || (c.rnc || '').includes(q) || (c.phone || '').includes(q)
                    })
                    .slice(0, 50)
                    .map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedClient(c); setShowClientPicker(false); setClientSearch(''); if (c.rnc) { setRnc(c.rnc); setRncName(c.name) } }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-sky-50 border-b border-slate-50 text-left transition-colors"
                      >
                        <div className="w-8 h-8 rounded-full bg-[#0C447C] flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                          {(c.name || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {[c.rnc, c.phone].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        {c.balance > 0 && (
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full shrink-0">
                            {lang === 'es' ? 'Debe' : 'Owes'} {fmtRD(c.balance)}
                          </span>
                        )}
                      </button>
                    ))
                  }
                  {clients.length === 0 && (
                    <p className="text-center py-8 text-[12px] text-slate-400">
                      {lang === 'es' ? 'No hay clientes registrados' : 'No clients registered'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* New client form */}
          {showNewClient && (
            <NewClientForm
              onClose={() => setShowNewClient(false)}
              onSave={(newClient) => {
                setShowNewClient(false)
                setSelectedClient(newClient)
                // Refresh clients list
                api.clients?.all?.().then(r => setClients(r || [])).catch(() => flash(lang === 'es' ? 'Error al cargar clientes' : 'Error loading clients'))
              }}
              lang={lang}
            />
          )}

          {/* Vehicle + Workers + Seller — stack vertically always, full width on mobile */}
          <div className="grid grid-cols-1 gap-3.5">
            {/* Vehicle */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                {t('pos_vehicle')}
              </label>
              <input
                type="text"
                value={vehicle}
                onChange={e => setVehicle(e.target.value)}
                placeholder={t('pos_vehicle_placeholder')}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-sm md:text-[12px] min-h-[44px] md:min-h-0 focus:outline-none focus:border-sky-400 placeholder:text-slate-300"
              />
            </div>

            {/* Workers */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                {t('pos_workers_label')}
              </label>
              {wsrLoading ? (
                <div className="h-9 bg-slate-100 rounded-lg animate-pulse" />
              ) : (
                <WorkerSelect selected={workers} onChange={setWorkers} washers={rawWashers} t={t} />
              )}
            </div>

            {/* Sold by */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                {t('pos_sold_by')}
              </label>
              <select
                value={salesperson}
                onChange={e => setSalesperson(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-sm md:text-[12px] text-slate-700 min-h-[44px] md:min-h-0 focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="">{t('pos_walkin')}</option>
                {rawSellers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* Order items */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              {t('pos_order_items')}
            </p>
            {allOrderItems.length === 0 ? (
              <p className="text-[11px] text-slate-300 italic">{t('pos_order_empty')}</p>
            ) : (
              <div className="space-y-1.5 md:space-y-1">
                {allOrderItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-1 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm md:text-[12px] text-slate-700 font-medium truncate leading-snug">
                        {item.name}
                      </p>
                      <p className="text-xs md:text-[11px] text-slate-400 leading-none">{fmtRD(item.price)}</p>
                    </div>
                    <button
                      onClick={() => removeOrderItem(item)}
                      className="w-8 h-8 md:w-5 md:h-5 flex items-center justify-center rounded-full text-slate-400 md:text-slate-300 hover:text-red-500 hover:bg-red-50 md:opacity-0 md:group-hover:opacity-100 transition-all shrink-0 min-h-[44px] md:min-h-0 min-w-[44px] md:min-w-0"
                    >
                      <X size={14} className="md:hidden" />
                      <X size={11} className="hidden md:block" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Totals + Buttons ─────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-slate-200 p-3.5 space-y-3">

          {allOrderItems.length > 0 ? (
            <div className="space-y-1">
              <div className="flex justify-between text-xs md:text-[12px] text-slate-500">
                <span>{t('pos_subtotal')}</span>
                <span>{fmtRD(subtotal)}</span>
              </div>
              <div className="flex justify-between text-xs md:text-[12px] text-slate-500">
                <span>{t('pos_itbis')}</span>
                <span>{fmtRD(itbis)}</span>
              </div>
              <div className="flex justify-between text-xs md:text-[12px] text-slate-500">
                <span>{t('pos_ley')}</span>
                <span>{fmtRD(ley)}</span>
              </div>
              <div className="flex justify-between text-sm md:text-[13px] font-bold text-slate-800 border-t border-slate-100 pt-1.5 mt-1">
                <span>{t('pos_total')}</span>
                <span>{fmtRD(total)}</span>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-300 text-[12px] py-2">
              {t('pos_no_items_yet')}
            </div>
          )}

          {/* Mobile: side-by-side buttons. Desktop: stacked */}
          <div className="flex gap-2 md:flex-col md:gap-3">
            <button
              onClick={handleEncolar}
              disabled={allOrderItems.length === 0 && !vehicle.trim()}
              className="flex-1 md:flex-none w-full bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm md:text-[13px] transition-all active:scale-[0.98] shadow-md shadow-green-500/20 min-h-[44px]"
            >
              <span className="flex items-center justify-center gap-2">
                <span>{t('pos_queue_btn')}</span>
              </span>
            </button>

            <button
              onClick={() => {
                if (allOrderItems.length > 0) {
                  setMobileCartOpen(false)
                  setCobrarModal({ vehicle, items: allOrderItems, workers, salesperson, clientId: selectedClient?.id || null, clientName: selectedClient?.name || rncName || '', client: selectedClient || null })
                }
              }}
              disabled={allOrderItems.length === 0}
              className="flex-1 md:flex-none w-full bg-[#0C447C] hover:bg-[#0a3868] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm md:text-[13px] transition-all active:scale-[0.98] shadow-md shadow-[#0C447C]/20 flex items-center justify-center gap-2 min-h-[44px]"
            >
              <span>{lang === 'es' ? 'Cobrar' : 'Charge'}</span>
              <span className="text-[10px] opacity-60 font-normal hidden md:inline">F2</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 flex items-center gap-2.5 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}

      {/* ── Cobrar Modal ──────────────────────────────────────────────────── */}
      {cobrarModal && (
        <CobrarModal
          ticket={{
            id:       null,
            ticketNo: lang === 'es' ? 'NUEVO' : 'NEW',
            vehicle:  cobrarModal.vehicle,
            services: cobrarModal.items,
          }}
          onConfirm={handlePaymentConfirm}
          onClose={() => setCobrarModal(null)}
        />
      )}
    </div>
  )
}
