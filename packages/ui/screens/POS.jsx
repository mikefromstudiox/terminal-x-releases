import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { X, ChevronDown, Check, CheckCircle2, Search, Loader2, AlertCircle, ShoppingCart, UserRound, Plus, Minus, Barcode, Package, LayoutGrid, Wine, Zap, ShieldCheck, Beer, Coffee, Cookie, Droplet, CupSoda, Candy, IceCreamCone, UtensilsCrossed, Sparkles, Cigarette, Flame, Leaf, Pizza, Smartphone } from 'lucide-react'
import AgeVerifyModal, { requiresAgeCheck } from '../components/AgeVerifyModal'
import WeightModal from '../components/WeightModal'
import { useLang } from '../i18n'
import { useLayout } from '../context/LayoutContext'
import { useAuth } from '../context/AuthContext'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useServices, useWashers, useSellers } from '../hooks/useDB'
import { useRNC } from '../hooks/useRNC'
import CobrarModal from '../components/CobrarModal'
import { NewClientForm } from './Clients'
import { printClientReceipt, printWasherConduce } from '@terminal-x/services/printer'
import RestaurantPOS from './restaurant/RestaurantPOS'
import { syncTicket } from '@terminal-x/services/supabase'
const saveReceiptPDF = (...args) => import('@terminal-x/services/pdf').then(m => m.saveReceiptPDF(...args))
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import { isServiceBased } from '@terminal-x/config/businessTypes'
import { usePlan } from '../hooks/usePlan.jsx'
import logoImg from '../assets/logo.webp'

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

const LEY = 0.10

// Prices already include ITBIS — strip it using the business's configured rate.
// `itbisRate` is a numeric percentage (e.g. 18 for 18%). Defaults to 18 when
// caller hasn't loaded settings yet so totals are sane pre-hydration.
function calcTotals(items, itbisRate = 18) {
  const factor   = Number(itbisRate) / 100
  const total    = items.reduce((s, i) => s + i.price * (i.qty || 1), 0)
  const subtotal = parseFloat((total / (1 + factor)).toFixed(2))
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
        <div key={i} className="rounded-xl p-3.5 bg-slate-100 dark:bg-white/10 animate-pulse h-16" />
      ))}
    </div>
  )
}

// ── Worker Multi-Select ───────────────────────────────────────────────────────

function WorkerSelect({ selected, onChange, washers, t, businessType, lang }) {
  const washCtx = isServiceBased(businessType) && businessType === 'carwash'
  const emptyLabel = washCtx
    ? (lang === 'es' ? 'Sin lavadores disponibles' : 'No washers available')
    : (lang === 'es' ? 'Sin empleados disponibles' : 'No employees available')
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
              className="flex items-center gap-1 pl-2 pr-1 py-0.5 bg-slate-800 dark:bg-white/20 text-white text-[11px] font-medium rounded-full"
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
        className="w-full flex items-center justify-between bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm md:text-[12px] text-slate-500 dark:text-white/60 hover:border-slate-400 dark:hover:border-white/20 transition-colors min-h-[44px] md:min-h-0"
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
        <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-xl shadow-lg z-20 overflow-hidden max-h-48 overflow-y-auto">
          {washers.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px] text-slate-400 dark:text-white/40 italic">{emptyLabel}</p>
          ) : (
            washers.map(w => {
              const checked = selected.some(s => s.id === w.id)
              return (
                <button
                  key={w.id}
                  onClick={() => toggle(w)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors text-left min-h-[44px] md:min-h-0"
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    checked ? 'bg-sky-500 border-sky-500' : 'border-slate-300 dark:border-white/30'
                  }`}>
                    {checked && <Check size={9} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className="text-[13px] text-slate-700 dark:text-white">{w.name}</span>
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
    <div className="border-t border-slate-100 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-2.5 flex items-center gap-3 shrink-0">
      <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider shrink-0">
        {lang === 'es' ? 'En Cola' : 'In Queue'}
      </span>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {visible.map(car => {
          const s = STATUS[car.status] || STATUS.pendiente
          return (
            <div key={car.id} className="flex items-center gap-2 bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-1.5 shrink-0 border border-slate-100 dark:border-white/10">
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
              <div>
                <p className="text-[11px] font-semibold text-slate-700 dark:text-white leading-none">{car.vehicle}</p>
                <p className="text-[10px] text-slate-400 dark:text-white/40 leading-none mt-0.5">{car.service}</p>
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

function CarWashPOS() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { t, lang } = useLang()
  const { collapsed } = useLayout()
  const { businessType } = useBusinessType()
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

  // ── Inventory items (products: drinks, snacks, etc.) ───────────────────
  // Loaded alongside services. Shows as additional category tabs on the POS.
  // Only items with quantity > 0 appear. Stock deducted on sale.
  const [invItems, setInvItems] = useState([])
  const [invLoading, setInvLoading] = useState(true)
  useEffect(() => {
    api?.inventory?.all?.()
      .then(r => setInvItems((r || []).filter(i => i.quantity > 0)))
      .catch(() => {})
      .finally(() => setInvLoading(false))
  }, [api])

  // ── Category order from categorias_servicio
  const [catOrder, setCatOrder] = useState({})
  useEffect(() => {
    api?.categorias?.all?.().then(cats => {
      if (cats?.length) {
        const order = {}
        cats.forEach(c => { order[c.nombre] = c.orden ?? 999 })
        setCatOrder(order)
      }
    }).catch(() => {})
  }, [])

  // ── Derived: categories + services grouped (includes inventory categories)
  // Normalize singular/plural variants so "Bebida" + "Bebidas" → one tab.
  const normalizeCat = (c) => {
    if (!c) return c
    const map = { 'Bebida': 'Bebidas', 'Snack': 'Snacks', 'Combo': 'Combos', 'Extra': 'Adicionales', 'Add-on': 'Adicionales', 'Add-ons': 'Adicionales' }
    return map[c] || c
  }
  const categories = useMemo(() => {
    // Single namespace — services + inventory share category IDs so a "Bebidas"
    // service and a "Bebidas" inventory item land under one tab.
    const seen = new Set()
    const cats = []
    for (const svc of rawServices) {
      const cat = normalizeCat(svc.category)
      if (!seen.has(cat)) {
        seen.add(cat)
        cats.push({ id: cat, label: cat, type: 'service' })
      }
    }
    for (const inv of invItems) {
      const cat = normalizeCat(inv.category) || 'Productos'
      if (!seen.has(cat)) {
        seen.add(cat)
        cats.push({ id: cat, label: cat, type: 'inventory' })
      }
    }
    cats.sort((a, b) => (catOrder[a.id] ?? 999) - (catOrder[b.id] ?? 999))
    return cats
  }, [rawServices, catOrder, invItems])

  const servicesByCategory = useMemo(() => {
    const groups = {}
    for (const svc of rawServices) {
      const cat = normalizeCat(svc.category)
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(svc)
    }
    for (const inv of invItems) {
      const cat = normalizeCat(inv.category) || 'Productos'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push({ ...inv, _isInventory: true, is_wash: 0 })
    }
    return groups
  }, [rawServices, invItems])

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

  // ITBIS rate — lives in app_settings, mutable per-business. Default 18.
  const [itbisRate, setItbisRate] = useState(18)
  useEffect(() => {
    api?.settings?.get?.()
      .then(s => {
        const pct = Number(s?.itbis_pct)
        if (Number.isFinite(pct) && pct >= 0) setItbisRate(pct)
      })
      .catch(() => {})
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
  const { subtotal, itbis, ley, total } = calcTotals(allOrderItems, itbisRate)
  const gridCols = collapsed ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'

  // Mobile cart visibility
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const cartRef = useRef(null)

  // O(1) lookup instead of O(n) items.some() per service button
  const selectedIds = useMemo(() => new Set(items.map(i => i._cartKey || i.id)), [items])

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
    if (svc._isInventory) {
      // Inventory items: tap adds qty, not toggle. Uses a prefixed key to avoid
      // collisions with service IDs (inventory items have UUID ids from Supabase).
      // `price` is always the UNIT price — calcTotals multiplies by qty.
      const cartKey = 'inv:' + svc.id
      setItems(prev => {
        const existing = prev.find(i => i._cartKey === cartKey)
        if (existing) {
          if (existing.qty >= svc.quantity) return prev // already at max stock
          return prev.map(i => i._cartKey === cartKey ? { ...i, qty: i.qty + 1, quantity: i.qty + 1 } : i)
        }
        return [...prev, {
          _cartKey:          cartKey,
          _isInventory:      true,
          id:                svc.id,
          inventory_item_id: svc.id,
          name:              svc.name,
          price:             svc.price,   // unit price — calcTotals does price * qty
          cost:              svc.cost || 0,
          sku:               svc.sku || null,
          is_wash:           0,
          aplica_itbis:      svc.aplica_itbis ?? 1,
          qty:               1,
          quantity:           1,
          _stock:            svc.quantity,
        }]
      })
      return
    }
    // Regular services: toggle on/off
    setItems(prev =>
      prev.some(i => i.id === svc.id)
        ? prev.filter(i => i.id !== svc.id)
        : [...prev, svc]
    )
  }

  function removeOrderItem(item) {
    const key = item._cartKey || item.id
    setItems(prev => prev.filter(i => (i._cartKey || i.id) !== key))
  }

  function adjustOrderQty(item, delta) {
    const key = item._cartKey || item.id
    setItems(prev => prev.map(i => {
      const iKey = i._cartKey || i.id
      if (iKey !== key) return i
      const nextQty = (i.qty || 1) + delta
      if (nextQty <= 0) return null
      // Respect stock cap for inventory items
      const isInv = typeof iKey === 'string' && iKey.startsWith('inv:')
      if (delta > 0 && isInv && i.stock != null && nextQty > i.stock) return i
      return { ...i, qty: nextQty, quantity: nextQty }
    }).filter(Boolean))
  }

  async function handleRncLookup() {
    if (rnc.replace(/\D/g, '').length < 9) return
    const res = await rncLookup(rnc)
    if (res?.ok && res.nombre) setRncName(res.nombre)
  }

  async function handleEncolar() {
    if (allOrderItems.length === 0 && !vehicle.trim()) return

    try {
      const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(allOrderItems, itbisRate)
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
          service_id:        s._isInventory ? null : (typeof s.id === 'number' ? s.id : null),
          inventory_item_id: s.inventory_item_id || null,
          name:              s.name,
          price:             s.price,  // always unit price
          cost:              s.cost || 0,
          is_wash:           s.is_wash ?? 1,
          quantity:           s.qty || 1,
          sku:               s.sku || null,
          aplica_itbis:      s.aplica_itbis ?? 1,
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
    // DON'T close the modal here — let CobrarModal show its SuccessView
    // (with WhatsApp send, receipt QR, print button). The modal closes when
    // the user clicks Cerrar in the success view via the onClose prop.

    try {
      const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(pending.items, itbisRate)
      const descNum = Number(paymentData.descuento || 0)
      const netTotal = Math.max(0, tot - descNum)
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
        status:           paymentData.tipo === 'credito' ? 'pendiente' : 'cobrado',
        subtotal:         sub,
        itbis:            itp,
        ley:              ly,
        total:            netTotal,
        beverage_subtotal: beverageSubtotal,
        ecf_result:       paymentData.ecf || {},
        items:            pending.items.map(s => ({
          service_id:        s._isInventory ? null : (typeof s.id === 'number' ? s.id : null),
          inventory_item_id: s.inventory_item_id || null,
          name:              s.name,
          price:             s.price,  // always unit price
          cost:              s.cost || 0,
          is_wash:           s.is_wash ?? 1,
          quantity:           s.qty || 1,
          sku:               s.sku || null,
          aplica_itbis:      s.aplica_itbis ?? 1,
        })),
        comentario: (Number(paymentData.descuento || 0) > 0 && paymentData.descuentoReason)
                     ? `[Descuento: ${paymentData.descuentoReason}] ${paymentData.comentario || ''}`.trim()
                     : (paymentData.comentario || ''),
        descuento:  Number(paymentData.descuento || 0),
        descuento_reason: paymentData.descuentoReason || null,
      })

      // Direct cobrar does NOT add to queue — the ticket is already cobrado.
      // Queue entries are only created by handleEncolar (pendiente → queue workflow).
      clearForm()
      flash(`${result?.docNumber || 'Ticket'} · ${lang === 'es' ? 'Cobrado ✓' : 'Charged ✓'}`)

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
          settings: empresa?.settings || {},
        }
        const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(pending.items, itbisRate)
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
          signatureDate: paymentData.ecf?.signatureDate || null,
          securityCode:  paymentData.ecf?.securityCode || null,
          qrLink:        paymentData.ecf?.qrLink || null,
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
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-black">

        {/* Mobile header with logo — matches desktop sidebar style */}
        <div className="md:hidden flex items-center justify-between px-4 py-2 bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-0">
            <span className="text-[15px] font-black tracking-[3px] text-black leading-none -mt-1">TERMINAL</span>
            <img src={logoImg} alt="X" className="h-6 w-auto object-contain" draggable={false} />
          </div>
          <span className="text-xs text-slate-400 dark:text-white/40">{new Date().toLocaleDateString('es-DO')}</span>
        </div>

        {/* Category tabs — horizontal scroll on mobile */}
        <div className="flex border-b border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 shrink-0 overflow-x-auto scrollbar-hide">
          {svcLoading ? (
            <div className="flex gap-1 px-4 py-2">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-8 w-20 bg-slate-100 dark:bg-white/10 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-4 md:px-5 py-3 md:py-3.5 text-xs md:text-sm font-semibold transition-colors border-b-2 -mb-px shrink-0 min-h-[44px] ${
                category === cat.id
                  ? 'border-[#b3001e] text-[#b3001e] dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/30'
              }`}
            >
              {categories.length === 1 ? (lang === 'es' ? 'Todos' : 'All') : catLabel(cat.label, lang)}
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
                const key = svc._isInventory ? 'inv:' + svc.id : svc.id
                const selected = selectedIds.has(key)
                const cartItem = svc._isInventory ? items.find(i => i._cartKey === key) : null
                return (
                  <button
                    key={key}
                    onClick={() => toggleService(svc)}
                    className={`group relative overflow-hidden flex flex-col justify-between p-4 md:p-5 rounded-2xl border text-left transition-all duration-200 ease-out min-h-[124px] md:min-h-[132px] will-change-transform ${
                      selected
                        ? 'border-[#b3001e] bg-gradient-to-br from-[#b3001e]/[0.09] via-white to-white dark:from-[#b3001e]/25 dark:via-white/[0.04] dark:to-white/[0.03] shadow-[0_12px_30px_-12px_rgba(179,0,30,0.55),inset_0_1px_0_0_rgba(255,255,255,0.6)] dark:shadow-[0_12px_30px_-12px_rgba(179,0,30,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]'
                        : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:border-[#b3001e] hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-12px_rgba(179,0,30,0.45),inset_0_1px_0_0_rgba(255,255,255,0.6)] active:translate-y-0 active:scale-[0.99]'
                    }`}
                  >
                    <span className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent transition-opacity duration-300 ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                    <span className={`pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-white/60 via-transparent to-transparent dark:from-white/[0.06] transition-opacity ${selected ? 'opacity-100' : 'opacity-40 group-hover:opacity-80'}`} />
                    {selected && (
                      <span className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full bg-[#b3001e] text-white flex items-center justify-center shadow-[0_4px_10px_-2px_rgba(179,0,30,0.6)] ring-2 ring-white dark:ring-black">
                        <Check size={12} strokeWidth={3.5} />
                      </span>
                    )}
                    <p className={`relative text-[14px] md:text-[15px] font-semibold leading-snug line-clamp-2 pr-6 tracking-[-0.01em] ${selected ? 'text-[#b3001e] dark:text-white' : 'text-slate-800 dark:text-white'}`}>
                      {lang === 'es' ? svc.name : (svc.name_en || svc.name)}
                    </p>
                    <div className="relative flex justify-end items-baseline gap-1.5 mt-3 pt-2.5 border-t border-dashed border-slate-200/70 dark:border-white/10">
                      <span className="text-[11px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-[0.1em]">RD$</span>
                      <span className="font-black tabular-nums leading-none tracking-[-0.02em] text-[26px] md:text-[28px] text-[#b3001e]">
                        {Number(svc.price || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
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
          className="md:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-40 bg-[#b3001e] text-white font-bold py-3 px-6 rounded-full shadow-lg shadow-[#b3001e]/30 flex items-center gap-2 min-h-[44px] active:scale-95 transition-transform"
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
          md:w-[220px] md:shrink-0 md:border-l md:border-slate-200 dark:md:border-white/10 md:flex md:flex-col md:bg-white dark:md:bg-white/5 md:static md:translate-y-0 md:rounded-none md:z-auto md:max-h-none
          fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-black rounded-t-2xl shadow-2xl flex flex-col max-h-[85vh] transition-transform duration-300 ease-out
          ${mobileCartOpen ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}
        `}
      >
        {/* Mobile drag handle + close */}
        <div className="md:hidden flex items-center justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-white/30" />
        </div>
        <div className="md:hidden flex items-center justify-between px-4 pb-2 shrink-0">
          <p className="text-sm font-bold text-slate-700 dark:text-white">
            {lang === 'es' ? 'Carrito' : 'Cart'} ({allOrderItems.length})
          </p>
          <button
            onClick={() => setMobileCartOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 dark:text-white/40 min-h-[44px] min-w-[44px]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">

          {/* Client selector */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1.5">
              {lang === 'es' ? 'Cliente' : 'Client'}
            </label>
            {selectedClient ? (
              <div className="flex items-center gap-2 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-500/30 rounded-lg px-2.5 py-2 min-h-[44px] md:min-h-0">
                <UserRound size={14} className="text-sky-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-sky-800 dark:text-sky-200 truncate">{selectedClient.name}</p>
                  {selectedClient.rnc && <p className="text-[10px] text-sky-500 dark:text-sky-400">{selectedClient.rnc}</p>}
                </div>
                <button onClick={() => setSelectedClient(null)} className="text-sky-400 hover:text-sky-600 p-1">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <button
                  onClick={() => setShowClientPicker(true)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-2 text-sm md:text-[12px] min-h-[44px] md:min-h-0 text-slate-400 dark:text-white/40 hover:border-sky-300 dark:hover:border-sky-500/50 hover:text-sky-500 transition-colors"
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
              <div className="bg-white dark:bg-black w-full md:w-[380px] md:rounded-2xl shadow-2xl max-h-[70vh] flex flex-col rounded-t-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/10">
                  <Search size={14} className="text-slate-400 dark:text-white/40" />
                  <input
                    type="text"
                    autoFocus
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    placeholder={lang === 'es' ? 'Buscar cliente...' : 'Search client...'}
                    className="flex-1 text-[13px] bg-transparent text-slate-800 dark:text-white focus:outline-none placeholder:text-slate-300 dark:placeholder:text-white/30"
                  />
                  <button onClick={() => setShowClientPicker(false)} className="text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white p-1">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {/* New client + Consumidor Final */}
                  <button
                    onClick={() => { setShowClientPicker(false); setShowNewClient(true); setClientSearch('') }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border-b border-slate-100 dark:border-white/10 text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-[14px] font-bold">+</div>
                    <span className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">{lang === 'es' ? 'Nuevo Cliente' : 'New Client'}</span>
                  </button>
                  <button
                    onClick={() => { setSelectedClient(null); setShowClientPicker(false); setClientSearch('') }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/10 border-b border-slate-50 dark:border-white/5 text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-400 dark:text-white/40"><UserRound size={14} /></div>
                    <span className="text-[13px] text-slate-500 dark:text-white/60 italic">{lang === 'es' ? 'Consumidor Final (sin cliente)' : 'Walk-in (no client)'}</span>
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
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-sky-50 dark:hover:bg-sky-900/20 border-b border-slate-50 dark:border-white/5 text-left transition-colors"
                      >
                        <div className="w-8 h-8 rounded-full bg-[#b3001e] flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                          {(c.name || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{c.name}</p>
                          <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">
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
                    <p className="text-center py-8 text-[12px] text-slate-400 dark:text-white/40">
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
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1.5">
                {t('pos_vehicle')}
              </label>
              <input
                type="text"
                value={vehicle}
                onChange={e => setVehicle(e.target.value)}
                placeholder={t('pos_vehicle_placeholder')}
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-2 text-sm md:text-[12px] text-slate-800 dark:text-white min-h-[44px] md:min-h-0 focus:outline-none focus:border-sky-400 placeholder:text-slate-300 dark:placeholder:text-white/30"
              />
            </div>

            {/* Workers */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1.5">
                {t('pos_workers_label')}
              </label>
              {wsrLoading ? (
                <div className="h-9 bg-slate-100 dark:bg-white/10 rounded-lg animate-pulse" />
              ) : (
                <WorkerSelect selected={workers} onChange={setWorkers} washers={rawWashers} t={t} businessType={businessType} lang={lang} />
              )}
            </div>

            {/* Sold by */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1.5">
                {t('pos_sold_by')}
              </label>
              <select
                value={salesperson}
                onChange={e => setSalesperson(e.target.value)}
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-2 text-sm md:text-[12px] text-slate-700 dark:text-white min-h-[44px] md:min-h-0 focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="">{t('pos_walkin')}</option>
                {rawSellers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-white/10" />

          {/* Order items */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1.5">
              {t('pos_order_items')}
            </p>
            {allOrderItems.length === 0 ? (
              <p className="text-[11px] text-slate-300 dark:text-white/30 italic">{t('pos_order_empty')}</p>
            ) : (
              <div className="space-y-1.5">
                {allOrderItems.map(item => {
                  const key = item._cartKey || item.id
                  const isInv = typeof key === 'string' && key.startsWith('inv:')
                  const qty = item.qty || 1
                  const lineTotal = (item.price || 0) * qty
                  return (
                    <div key={key} className="flex items-center gap-2 py-1.5 border-b border-slate-50 dark:border-white/[0.04] last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-slate-800 dark:text-white leading-tight truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-slate-400 dark:text-white/40 tabular-nums">{fmtRD(item.price)} {qty > 1 && `× ${qty}`}</span>
                          {qty > 1 && <span className="text-[11px] font-black text-[#b3001e] tabular-nums">{fmtRD(lineTotal)}</span>}
                        </div>
                      </div>
                      {isInv ? (
                        <div className="flex items-center rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-black shrink-0">
                          <button onClick={() => adjustOrderQty(item, -1)}
                            className="w-7 h-7 flex items-center justify-center text-[#b3001e] hover:bg-[#b3001e] hover:text-white active:scale-95 transition-all"
                            title={qty <= 1 ? 'Quitar' : '-1'}>
                            {qty <= 1 ? <X size={12} /> : <Minus size={12} />}
                          </button>
                          <span className="w-7 text-center text-[12px] font-black text-slate-800 dark:text-white tabular-nums border-x border-slate-200 dark:border-white/10 py-1">{qty}</span>
                          <button onClick={() => adjustOrderQty(item, 1)}
                            className="w-7 h-7 flex items-center justify-center text-[#b3001e] hover:bg-[#b3001e] hover:text-white active:scale-95 transition-all"
                            title="+1">
                            <Plus size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => removeOrderItem(item)}
                          className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 dark:text-white/30 hover:text-white hover:bg-[#b3001e] transition-colors shrink-0"
                          title="Quitar">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Totals + Buttons ─────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-slate-200 dark:border-white/10 p-3.5 space-y-3">

          {allOrderItems.length > 0 ? (
            <div className="space-y-1">
              <div className="flex justify-between text-xs md:text-[12px] text-slate-500 dark:text-white/60">
                <span>{t('pos_subtotal')}</span>
                <span>{fmtRD(subtotal)}</span>
              </div>
              <div className="flex justify-between text-xs md:text-[12px] text-slate-500 dark:text-white/60">
                <span>{t('pos_itbis')}</span>
                <span>{fmtRD(itbis)}</span>
              </div>
              {ley > 0 && (
              <div className="flex justify-between text-xs md:text-[12px] text-slate-500 dark:text-white/60">
                <span>{t('pos_ley')}</span>
                <span>{fmtRD(ley)}</span>
              </div>
              )}
              <div className="flex justify-between text-sm md:text-[13px] font-bold text-slate-800 dark:text-white border-t border-slate-100 dark:border-white/10 pt-1.5 mt-1">
                <span>{t('pos_total')}</span>
                <span>{fmtRD(total)}</span>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-300 dark:text-white/30 text-[12px] py-2">
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
              className="flex-1 md:flex-none w-full bg-[#b3001e] hover:bg-[#0a3868] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm md:text-[13px] transition-all active:scale-[0.98] shadow-md shadow-[#b3001e]/20 flex items-center justify-center gap-2 min-h-[44px]"
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
            client:   cobrarModal.client || null,
          }}
          onConfirm={handlePaymentConfirm}
          onClose={() => setCobrarModal(null)}
        />
      )}
    </div>
  )
}

// ── Retail POS ────────────────────────────────────────────────────────────────

function RetailPOS() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { t, lang } = useLang()
  const { collapsed } = useLayout()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { businessType, isHybrid, isMechanic, isDealership, isLicoreria, licoreriaConfig, isCarniceria } = useBusinessType()

  // ── Carnicería-specific state ──────────────────────────────────────────────
  // Weight entry modal. When the cashier taps a sold_by_weight product we park
  // it here; on confirm we push a weighted line to the cart; on cancel we drop.
  const [pendingWeightItem, setPendingWeightItem] = useState(null)

  // The Services tab only makes sense for verticals that mix products + services
  // (hybrid, mechanic, dealership). Pure retail/licoreria/carniceria should not
  // see it — it just confuses the cashier.
  const showServicesTab = isHybrid || isMechanic || isDealership

  // ── Licorería-specific state ────────────────────────────────────────────────
  // Age-verification state. Persists for the life of the ticket and clears on
  // successful cobro or explicit form reset. `pendingAgeItem` holds a product
  // awaiting verification so the cashier can confirm/cancel without losing it.
  const [ageVerified, setAgeVerified]       = useState(null)
  const [pendingAgeItem, setPendingAgeItem] = useState(null)
  const [quickSells, setQuickSells]         = useState([])

  // Services for hybrid mode (services tab)
  const { data: rawServicesDB } = useServices()
  const rawServices = rawServicesDB || []

  // ── UI state
  const [cart, setCart] = useState([])        // { id, inventory_item_id, service_id, sku, name, price, cost, qty, aplica_itbis }
  const [toast, setToast] = useState(null)
  const [cobrarModal, setCobrarModal] = useState(null)
  const [tab, setTab] = useState('products')  // 'products' | 'services'
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  // Client state
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [showClientPicker, setShowClientPicker] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [clientSearch, setClientSearch] = useState('')

  // RNC
  const [rnc, setRnc] = useState('')
  const [rncName, setRncName] = useState('')
  const [salesperson, setSalesperson] = useState('')

  // Mobile cart
  const [mobileCartOpen, setMobileCartOpen] = useState(false)

  // ── Pedidos Ya channel toggle ─────────────────────────────────────────────
  // Retail + licoreria only. When on, tiles + cart re-price to each item's
  // `price_pedidos_ya` (fallback to `price`), and the resulting ticket is
  // stamped `order_source='pedidos_ya'`. Toggling mid-cart reprices untouched
  // lines (skip anything the cashier manually edited, gated by `_priceEdited`).
  const pyAvailable = isRetail || isLicoreria
  const [pyMode, setPyMode] = useState(false)
  function effectivePrice(product) {
    if (!product) return 0
    const base = Number(product.price || 0)
    if (!pyMode) return base
    const py = product.price_pedidos_ya
    return (py != null && py !== '' && Number.isFinite(Number(py))) ? Number(py) : base
  }

  useEffect(() => {
    api.clients?.all?.().then(r => setClients(r || [])).catch(() => {})
  }, [api])

  // Hybrid cross-mode conversion — absorb items pushed from the Mesa pane so
  // converting a dine-in ticket to takeout preserves every line + keeps a
  // breadcrumb (converted_from_*) that rides along at cobro time.
  const [hybridConvertMeta, setHybridConvertMeta] = useState(null)
  useEffect(() => {
    if (!isHybrid) return
    try {
      const raw = window.localStorage.getItem('tx_hybrid_convert_cart')
      if (!raw) return
      window.localStorage.removeItem('tx_hybrid_convert_cart')
      const payload = JSON.parse(raw)
      if (!payload?.items?.length) return
      setCart(payload.items.map((it, idx) => ({
        id: `conv_${idx}_${Date.now()}`,
        service_id: it.service_id || null,
        inventory_item_id: null,
        sku: null,
        name: it.name,
        price: Number(it.price) || 0,
        cost: 0,
        qty: Number(it.qty) || 1,
        aplica_itbis: 1,
      })))
      setHybridConvertMeta({
        convertedFromTicketSupabaseId: payload.from_ticket_supabase_id || null,
        convertedFromMesaSupabaseId:   payload.from_mesa_supabase_id   || null,
      })
      setToast(payload.note || 'Items movidos a Venta Directa')
      setTimeout(() => setToast(null), 3500)
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHybrid])

  // ITBIS rate — lives in app_settings, mutable per-business. Default 18.
  const [itbisRate, setItbisRate] = useState(18)
  useEffect(() => {
    api?.settings?.get?.()
      .then(s => {
        const pct = Number(s?.itbis_pct)
        if (Number.isFinite(pct) && pct >= 0) setItbisRate(pct)
      })
      .catch(() => {})
  }, [api])

  // Service categories for hybrid tab
  const serviceCategories = useMemo(() => {
    const seen = new Set()
    return rawServices.reduce((cats, svc) => {
      if (!seen.has(svc.category)) { seen.add(svc.category); cats.push(svc.category) }
      return cats
    }, [])
  }, [rawServices])
  const [svcCategory, setSvcCategory] = useState(null)
  useEffect(() => { if (serviceCategories.length && !svcCategory) setSvcCategory(serviceCategories[0]) }, [serviceCategories])

  // Totals include auto-generated bottle-deposit lines so the cashier sees
  // the real number *before* the CobrarModal opens.
  const finalLineItems = useMemo(() => expandCartWithDeposits(cart),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, isLicoreria, licoreriaConfig])
  const { subtotal, itbis, total } = calcTotals(finalLineItems, itbisRate)
  const cartCount = cart.reduce((s, i) => s + (i.qty || 1), 0)
  const bottleDepositTotal = useMemo(() => {
    if (!isLicoreria) return 0
    return cart.reduce((s, i) => s + Number(i.bottle_deposit || 0) * (i.qty || 1), 0)
  }, [cart, isLicoreria])

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function clearForm() {
    setCart([])
    setSelectedClient(null)
    setRnc('')
    setRncName('')
    setSalesperson('')
    setSearchQuery('')
    setSearchResults([])
    setAgeVerified(null)
    setPendingAgeItem(null)
    setHybridConvertMeta(null)
  }

  // ── Licorería quick-sells: load top-N active products ────────────────────
  // Uses inventory_items ordered by recent updated_at as a cheap proxy for
  // "moves often". Real bestseller ranking will come in Phase 2 with a
  // dedicated `product_sales_rank` materialized view.
  useEffect(() => {
    if (!isLicoreria || !licoreriaConfig?.quickSell?.enabled) return
    let cancelled = false
    const n = licoreriaConfig.quickSell.topN || 8
    ;(async () => {
      try {
        const all = await api?.inventory?.all?.() || []
        // Prefer items in the age-restricted categories, then sort by updated_at desc.
        const trigger = (licoreriaConfig.ageVerification?.triggerCategories || []).map(s => s.toLowerCase())
        const scored = (all || [])
          .filter(p => p.active !== 0 && p.active !== false)
          .map(p => ({
            p,
            score: (trigger.includes(String(p.category || '').toLowerCase()) ? 1 : 0) * 10
                 + Number(p.quantity || 0) / 100,
            ts: p.updated_at ? Date.parse(p.updated_at) : 0,
          }))
          .sort((a, b) => (b.score - a.score) || (b.ts - a.ts))
          .slice(0, n)
          .map(x => x.p)
        if (!cancelled) setQuickSells(scored)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [api, isLicoreria, licoreriaConfig])

  // Toggle Pedidos Ya — reprice untouched inventory lines in-place. Lines
  // without a `_basePrice` were added before the toggle existed (or are
  // services / bottle-deposit synthetics) — we leave them alone. Cashier edits
  // (`_priceEdited`) lock a line from automatic reprice.
  useEffect(() => {
    setCart(prev => prev.map(it => {
      if (it._priceEdited) return it
      if (it._basePrice == null) return it        // not a re-priceable line
      const next = pyMode && it._pyPrice != null ? it._pyPrice : it._basePrice
      if (Number(it.price) === Number(next)) return it
      return { ...it, price: next, _py: pyMode && it._pyPrice != null }
    }))
  }, [pyMode])

  // ── Search / barcode lookup ────────────────────────────────────────────────
  function handleSearchInput(value) {
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) { setSearchResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await api.inventory.search(value.trim())
        setSearchResults(results || [])
      } catch { setSearchResults([]) }
      setSearching(false)
    }, 300)
  }

  async function handleBarcodeScan(e) {
    if (e.key !== 'Enter') return
    const val = searchQuery.trim()
    if (!val) return
    try {
      const item = await api.inventory.lookupSku(val)
      if (item) {
        addToCart(item)
        setSearchQuery('')
        setSearchResults([])
        return
      }
    } catch {}
    handleSearchInput(val)
  }

  // ── Cart operations ────────────────────────────────────────────────────────
  function addToCart(product) {
    // Licorería — if this item is age-restricted and we haven't verified yet
    // for this ticket, park it and pop the modal. The cashier either confirms
    // (we then add the item) or cancels (we drop it).
    if (isLicoreria && !ageVerified && requiresAgeCheck(licoreriaConfig, product)) {
      setPendingAgeItem(product)
      return
    }
    // Carnicería — sold-by-weight products always route through the weight modal.
    // Each scan/tap pushes a NEW cart line (different weight per cut) rather
    // than merging into an existing line like qty-based products do.
    if (product?.sold_by_weight) {
      setPendingWeightItem(product)
      return
    }
    let nextQty = 1
    let stackedExisting = false
    let stockCapped = false
    setCart(prev => {
      const existing = prev.find(i => i.inventory_item_id === product.id)
      if (existing) {
        if (existing.qty >= (product.quantity || Infinity)) { stockCapped = true; nextQty = existing.qty; return prev }
        stackedExisting = true
        nextQty = existing.qty + 1
        return prev.map(i => i.inventory_item_id === product.id ? { ...i, qty: i.qty + 1 } : i)
      }
      const basePrice = Number(product.price || 0)
      const pyPrice   = product.price_pedidos_ya != null && Number.isFinite(Number(product.price_pedidos_ya))
                          ? Number(product.price_pedidos_ya) : null
      const usedPrice = pyMode && pyPrice != null ? pyPrice : basePrice
      return [...prev, {
        id: `inv-${product.id}`,
        inventory_item_id: product.id,
        service_id: null,
        sku: product.sku || product.barcode || '',
        name: product.name,
        price: usedPrice,
        _basePrice: basePrice,
        _pyPrice: pyPrice,
        _py: pyMode && pyPrice != null,
        cost: product.cost || 0,
        qty: 1,
        aplica_itbis: product.aplica_itbis ?? 1,
        is_wash: 0,
        stock: product.quantity,
        // Licorería metadata — bottle deposit flows through to the ticket line
        // as a separate synthetic item in handlePaymentConfirm().
        bottle_deposit: Number(product.bottle_deposit || 0) || 0,
        age_restricted: isLicoreria ? requiresAgeCheck(licoreriaConfig, product) : false,
      }]
    })
    if (stockCapped) flash(lang === 'es' ? `Stock maximo (${nextQty}) — ${product.name}` : `Max stock (${nextQty}) — ${product.name}`)
    else if (stackedExisting) flash(`${product.name} × ${nextQty}`)
    else flash(lang === 'es' ? `${product.name} agregado` : `${product.name} added`)
  }

  // Expand cart → final line items, appending synthetic bottle-deposit lines
  // for licoreria. Each deposit line is non-ITBIS, qty-matched, and carries a
  // `bottle_deposit: true` flag so printer / PDF / reports can segregate it.
  function expandCartWithDeposits(items) {
    if (!isLicoreria || !licoreriaConfig?.bottleDeposit?.enabled) return items
    const lineLabel = licoreriaConfig.bottleDeposit.lineLabel?.[lang] ||
                      licoreriaConfig.bottleDeposit.lineLabel?.es || 'Depósito de botella'
    const out = []
    for (const it of items) {
      out.push(it)
      const dep = Number(it.bottle_deposit || 0)
      if (dep > 0 && it.inventory_item_id) {
        out.push({
          id:                `dep-${it.id}`,
          inventory_item_id: null,
          service_id:        null,
          sku:               'DEP',
          name:              `${lineLabel} — ${it.name}`,
          price:             dep,
          cost:              0,
          qty:               it.qty || 1,
          aplica_itbis:      0,
          is_wash:           0,
          bottle_deposit_line: true,
          parent_inventory_item_id: it.inventory_item_id,
        })
      }
    }
    return out
  }

  // Called by AgeVerifyModal on successful verification.
  function handleAgeConfirmed(verification) {
    setAgeVerified(verification)
    const item = pendingAgeItem
    setPendingAgeItem(null)
    // Log to activity_log (non-blocking, one entry per ticket).
    try {
      api?.activity?.record?.({
        event_type: 'age_verified',
        severity:   'info',
        target_type:'ticket',
        target_name:item?.name || 'Licorería — producto 18+',
        metadata:   verification,
      })
    } catch {}
    if (item) addToCart(item)  // re-runs, now verified, falls through to push
  }

  // Called by WeightModal on confirm. Pushes a new weighted line; price is
  // computed as weight × price_per_unit (already RD$/unit).
  function handleWeightConfirmed({ weight, unit, price_per_unit, line_total }) {
    const product = pendingWeightItem
    setPendingWeightItem(null)
    if (!product) return
    const unique = `invw-${product.id}-${Date.now()}`
    setCart(prev => [...prev, {
      id: unique,
      inventory_item_id: product.id,
      service_id: null,
      sku: product.sku || product.barcode || '',
      // Receipt-friendly label (peso × precio ya embebido en price/qty=1).
      name: `${product.name} (${weight.toFixed(3)} ${unit})`,
      price: line_total,          // line subtotal ITBIS-inclusive (same rule as others)
      cost: product.cost || 0,
      qty: 1,                     // line stored as a single unit; weight is the multiplier
      weight,                     // persisted to ticket_items.weight
      unit,                       // persisted to ticket_items.unit
      price_per_unit,             // persisted to ticket_items.price_per_unit
      aplica_itbis: product.aplica_itbis ?? 1,
      is_wash: 0,
      stock: product.quantity,
    }])
  }

  function addServiceToCart(svc) {
    const svcName = lang === 'es' ? svc.name : (svc.name_en || svc.name)
    let nextQty = 1
    let stacked = false
    setCart(prev => {
      const existing = prev.find(i => i.service_id === svc.id)
      if (existing) {
        stacked = true
        nextQty = existing.qty + 1
        return prev.map(i => i.service_id === svc.id ? { ...i, qty: i.qty + 1 } : i)
      }
      return [...prev, {
        id: `svc-${svc.id}`,
        inventory_item_id: null,
        service_id: svc.id,
        sku: '',
        name: svcName,
        price: svc.price,
        cost: svc.cost || 0,
        qty: 1,
        aplica_itbis: svc.aplica_itbis ?? 1,
        is_wash: svc.is_wash ?? 0,
      }]
    })
    if (stacked) flash(`${svcName} × ${nextQty}`)
    else flash(lang === 'es' ? `${svcName} agregado` : `${svcName} added`)
  }

  function updateQty(cartId, delta) {
    setCart(prev => prev.map(i => {
      if (i.id !== cartId) return i
      const newQty = Math.min(i.stock || Infinity, Math.max(1, i.qty + delta))
      return { ...i, qty: newQty }
    }))
  }

  function removeFromCart(cartId) {
    setCart(prev => prev.filter(i => i.id !== cartId))
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'F1') { e.preventDefault(); clearForm() }
      else if (e.key === 'F2') {
        e.preventDefault()
        if (cart.length > 0) {
          setCobrarModal({ items: expandCartWithDeposits(cart), ageVerified, clientId: selectedClient?.id || null, clientName: selectedClient?.name || rncName || '', client: selectedClient || null, salesperson, pyMode })
        }
      }
      else if (e.key === 'F4') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart, selectedClient, rncName, salesperson])

  // ── Payment confirm ────────────────────────────────────────────────────────
  const handlePaymentConfirm = useCallback(async (paymentData) => {
    const pending = cobrarModal
    setCobrarModal(null)

    try {
      const { subtotal: sub, itbis: itp, total: tot } = calcTotals(pending.items, itbisRate)
      const descNum = Number(paymentData.descuento || 0)
      const netTotal = Math.max(0, tot - descNum)

      const result = await api.tickets.create({
        vehicle_plate:    null,
        client_id:        pending.clientId || null,
        washer_ids:       [],
        seller_id:        pending.salesperson || null,
        cajero_id:        (user?.id && user.id !== 'web') ? user.id : null,
        comprobante_type: paymentData.ncfType || 'E32',
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        tipo_venta:       paymentData.tipo || 'contado',
        subtotal:         sub,
        itbis:            itp,
        ley:              0,
        total:            netTotal,
        beverage_subtotal: 0,
        ecf_result:       paymentData.ecf || {},
        // Hybrid vertical — flag retail-cart sales so the Ventas report can
        // filter dine-in vs. takeout vs. direct-retail independently.
        mode:             isHybrid ? 'directa' : undefined,
        order_source:     pending.pyMode ? 'pedidos_ya' : 'pos',
        converted_from_ticket_supabase_id: pending.convertedFromTicketSupabaseId || hybridConvertMeta?.convertedFromTicketSupabaseId || undefined,
        converted_from_mesa_supabase_id:   pending.convertedFromMesaSupabaseId   || hybridConvertMeta?.convertedFromMesaSupabaseId   || undefined,
        items:            pending.items.map(i => ({
          service_id:        i.service_id || null,
          inventory_item_id: i.inventory_item_id || null,
          name:              i.name,
          price:             i.price,
          cost:              i.cost || 0,
          quantity:          i.qty || 1,
          sku:               i.sku || null,
          is_wash:           i.is_wash ?? 0,
          aplica_itbis:      i.aplica_itbis ?? 1,
          weight:            i.weight != null ? Number(i.weight) : null,
          unit:              i.unit || null,
          price_per_unit:    i.price_per_unit != null ? Number(i.price_per_unit) : null,
        })),
        comentario: (Number(paymentData.descuento || 0) > 0 && paymentData.descuentoReason)
                     ? `[Descuento: ${paymentData.descuentoReason}] ${paymentData.comentario || ''}`.trim()
                     : (paymentData.comentario || ''),
        descuento:  Number(paymentData.descuento || 0),
        descuento_reason: paymentData.descuentoReason || null,
      })

      clearForm()
      flash(`${result?.docNumber || 'Ticket'} · ${lang === 'es' ? 'Creado ✓' : 'Created ✓'}`)

      syncTicket({
        client_name:      pending.clientName || null,
        comprobante_type: paymentData.ncfType || 'E32',
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        tipo_venta:       paymentData.tipo || 'contado',
        subtotal: sub, itbis: itp, ley: 0, total: tot,
        status:           'cobrado',
        cajero_name:      user?.name || null,
        items:            pending.items,
        ecf_result:       paymentData.ecf || {},
      }, result).catch(() => {})

      try {
        const [cfg, empresa] = await Promise.all([
          api.settings.get().catch(() => ({})),
          api.admin.getEmpresa().catch(() => ({})),
        ])
        const biz = {
          name: empresa?.nombre || empresa?.name || '',
          address: empresa?.direccion || empresa?.address || '',
          phone: empresa?.telefono || empresa?.phone || '',
          rnc: empresa?.rnc || '',
          logo: empresa?.logo || '',
          settings: empresa?.settings || {},
        }
        const ticketData = {
          ncf: result?.ncf || '',
          ncfType: paymentData.ncfType || 'E32',
          cajero: user?.name || '',
          lavador: '',
          docNo: result?.docNumber || '',
          paidAt: new Date(),
          client: pending.client || null,
          vehiclePlate: '',
          tipo: paymentData.tipo || 'contado',
          formaPago: paymentData.formaPago || 'cash',
          services: pending.items,
          subtotal: sub, descuento: 0, itbis: itp, ley: 0, total: tot,
          biz,
          signatureDate: paymentData.ecf?.signatureDate || null,
          securityCode: paymentData.ecf?.securityCode || null,
          qrLink: paymentData.ecf?.qrLink || null,
        }
        if (cfg.print_factura_auto === '1') printClientReceipt(ticketData).catch(() => {})
        saveReceiptPDF(ticketData).catch(() => {})
        const fm = paymentData.formaPago || ''
        if (paymentData.tipo !== 'credito' && !['tarjeta', 'transferencia'].includes(fm)) {
          printerApi?.openDrawer?.().catch?.(() => {})
        }
      } catch {}
    } catch (err) {
      flash(`Error: ${err.message}`)
    }
  }, [cobrarModal, lang])

  // ── Render ─────────────────────────────────────────────────────────────────
  const gridCols = collapsed ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* ── Left: Product browser ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white dark:bg-black">
        {/* Channel toolbar — Pedidos Ya toggle (retail + licoreria only) */}
        {pyAvailable && (
          <div className={`flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-white/10 transition-colors ${pyMode ? 'bg-[#b3001e]' : 'bg-white dark:bg-black'}`}>
            <div className="flex items-center gap-2 min-w-0">
              {pyMode ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-white font-black text-[11px] tracking-[0.14em] uppercase">
                    <Smartphone size={14} strokeWidth={2.5} />
                    {lang === 'es' ? 'Pedidos Ya Activo' : 'Pedidos Ya Active'}
                  </span>
                  <span className="hidden sm:inline text-[10px] text-white/80 font-medium">
                    {lang === 'es' ? 'Precios del canal de delivery aplicados' : 'Delivery channel pricing applied'}
                  </span>
                </>
              ) : (
                <span className="text-[11px] font-semibold text-slate-400 dark:text-white/40 uppercase tracking-[0.14em]">
                  {lang === 'es' ? 'Canal de venta' : 'Sales channel'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPyMode(v => !v)}
              aria-pressed={pyMode}
              title={lang === 'es' ? 'Alternar precios Pedidos Ya' : 'Toggle Pedidos Ya pricing'}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-wider min-h-[36px] transition-all border active:scale-[0.97] ${
                pyMode
                  ? 'bg-white text-[#b3001e] border-white shadow-[0_4px_12px_-2px_rgba(0,0,0,0.35)] hover:bg-white/95'
                  : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/80 border-slate-200 dark:border-white/10 hover:border-[#b3001e] hover:text-[#b3001e]'
              }`}
            >
              <span className="text-[13px] leading-none">📱</span>
              <span>Pedidos Ya</span>
              <span className={`w-8 h-[18px] rounded-full relative transition-colors ${pyMode ? 'bg-[#b3001e]' : 'bg-slate-300 dark:bg-white/20'}`}>
                <span className={`absolute top-0.5 w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${pyMode ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </span>
            </button>
          </div>
        )}
        {/* Search bar — flex layout guarantees icon and input never overlap */}
        <div className="p-3 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-black">
          <div className="flex items-center gap-2 px-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-[#b3001e]/30 focus-within:border-[#b3001e]">
            <Search size={16} className="text-slate-400 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={e => handleSearchInput(e.target.value)}
              onKeyDown={handleBarcodeScan}
              placeholder={lang === 'es' ? 'Buscar producto, SKU o codigo de barras...' : 'Search product, SKU or barcode...'}
              className="flex-1 min-w-0 bg-transparent py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 outline-none"
            />
            {searching && <Loader2 size={16} className="text-slate-400 animate-spin shrink-0" />}
            {!searching && searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]) }}
                className="text-slate-400 hover:text-slate-600 shrink-0">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Tab switcher — services tab only for hybrid/mechanic/dealership verticals */}
        {showServicesTab && (
        <div className="flex border-b border-slate-200 dark:border-white/10 bg-white dark:bg-black">
          {[
            { key: 'products', icon: Package, es: 'Productos', en: 'Products' },
            { key: 'services', icon: LayoutGrid, es: 'Servicios', en: 'Services' },
          ].map(({ key, icon: Icon, es, en }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                tab === key
                  ? 'border-[#b3001e] text-[#b3001e] dark:text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-white/60'
              }`}>
              <Icon size={15} />
              {lang === 'es' ? es : en}
            </button>
          ))}
        </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 bg-white dark:bg-black">
          {/* Search results overlay */}
          {searchQuery && tab === 'products' && (
            <div className="mb-4">
              {searchResults.length === 0 && !searching && (
                <p className="text-center text-slate-400 text-sm py-8">
                  {lang === 'es' ? 'No se encontraron productos' : 'No products found'}
                </p>
              )}
              <div className={`grid ${gridCols} gap-2`}>
                {searchResults.map(item => {
                  const py = item.price_pedidos_ya != null && Number.isFinite(Number(item.price_pedidos_ya)) ? Number(item.price_pedidos_ya) : null
                  const showPY = pyMode && py != null
                  const shown  = showPY ? py : Number(item.price || 0)
                  const showStrike = showPY && py !== Number(item.price || 0)
                  return (
                  <button key={item.id} onClick={() => addToCart(item)}
                    className="flex flex-col items-start p-3 rounded-xl border-2 border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-[#b3001e] hover:bg-[#b3001e]/10 dark:hover:bg-[#b3001e]/15 transition-all text-left">
                    <p className="text-[13px] font-semibold text-slate-800 dark:text-white leading-tight line-clamp-2">{item.name}</p>
                    {item.sku && <p className="text-[10px] text-slate-400 mt-0.5">{item.sku}</p>}
                    <div className="flex items-center justify-between w-full mt-2">
                      <div className="flex flex-col">
                        <p className="text-[13px] font-bold text-[#b3001e] dark:text-blue-400">{fmtRD(shown)}</p>
                        {showStrike && <p className="text-[10px] text-slate-400 line-through tabular-nums">{fmtRD(Number(item.price || 0))}</p>}
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        item.quantity <= 0 ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400'
                        : item.quantity <= (item.min_quantity || 5) ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400'
                        : 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400'
                      }`}>
                        {item.quantity <= 0 ? (lang === 'es' ? 'Agotado' : 'Out') : `${item.quantity} disp.`}
                      </span>
                    </div>
                  </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Licorería — quick-sells bestseller grid above inventory */}
          {tab === 'products' && !searchQuery && isLicoreria && quickSells.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={13} className="text-[#b3001e]" />
                <p className="text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider">
                  {lang === 'es' ? 'Más Vendidos' : 'Top Sellers'}
                </p>
              </div>
              <div className={`grid ${gridCols} gap-2`}>
                {quickSells.map(item => {
                  const restricted = requiresAgeCheck(licoreriaConfig, item)
                  return (
                    <button key={`qs-${item.id}`} onClick={() => addToCart(item)}
                      className="group relative overflow-hidden flex flex-col justify-between p-4 md:p-5 rounded-2xl border border-[#b3001e]/50 bg-gradient-to-br from-[#b3001e]/[0.07] via-white to-white dark:from-[#b3001e]/20 dark:via-white/[0.04] dark:to-white/[0.03] text-left transition-all duration-200 ease-out min-h-[136px] will-change-transform shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] hover:border-[#b3001e] hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-12px_rgba(179,0,30,0.55),inset_0_1px_0_0_rgba(255,255,255,0.7)] active:translate-y-0 active:scale-[0.99]">
                      <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent opacity-70 group-hover:opacity-100 transition-opacity duration-300" />
                      <span className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-white/50 via-transparent to-transparent dark:from-white/[0.05] opacity-60 group-hover:opacity-100 transition-opacity" />
                      <div className="relative flex items-start justify-between gap-2 mb-1.5">
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-md bg-[#b3001e] text-white shadow-[0_4px_10px_-2px_rgba(179,0,30,0.6)]">
                          <Zap size={9} strokeWidth={3} /> TOP
                        </span>
                        {restricted && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-black text-white border border-[#b3001e] shadow-sm">18+</span>
                        )}
                      </div>
                      <div className="relative flex-1">
                        <p className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-white leading-snug line-clamp-2 tracking-[-0.01em]">{item.name}</p>
                        {item.sku && <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5 font-mono tracking-tight">{item.sku}</p>}
                      </div>
                      <div className="relative flex justify-end items-baseline gap-1.5 mt-2 pt-2.5 border-t border-dashed border-[#b3001e]/20 dark:border-white/10">
                        <span className="text-[11px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-[0.1em]">RD$</span>
                        <span className="font-black tabular-nums leading-none tracking-[-0.02em] text-[26px] text-[#b3001e]">
                          {Number(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Products tab — show all inventory */}
          {tab === 'products' && !searchQuery && (
            <ProductGrid api={api} lang={lang} gridCols={gridCols} onAdd={addToCart} pyMode={pyMode} />
          )}

          {/* Services tab */}
          {showServicesTab && tab === 'services' && (
            <div>
              <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-hide">
                {serviceCategories.map(cat => (
                  <button key={cat} onClick={() => setSvcCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all border ${
                      svcCategory === cat
                        ? 'bg-[#b3001e] text-white border-[#b3001e]'
                        : 'bg-white dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10 hover:border-[#b3001e]'
                    }`}>
                    {catLabel(cat, lang)}
                  </button>
                ))}
              </div>
              <div className={`grid ${gridCols} gap-2`}>
                {rawServices.filter(s => s.category === svcCategory).map(svc => (
                  <button key={svc.id} onClick={() => addServiceToCart(svc)}
                    className="group relative overflow-hidden flex flex-col justify-between p-4 md:p-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-left transition-all duration-200 ease-out min-h-[124px] md:min-h-[132px] will-change-transform shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:border-[#b3001e] hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-12px_rgba(179,0,30,0.45),inset_0_1px_0_0_rgba(255,255,255,0.6)] active:translate-y-0 active:scale-[0.99]">
                    <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <span className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-white/50 via-transparent to-transparent dark:from-white/[0.05] opacity-40 group-hover:opacity-90 transition-opacity" />
                    <p className="relative text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-white leading-snug line-clamp-2 tracking-[-0.01em]">{lang === 'es' ? svc.name : (svc.name_en || svc.name)}</p>
                    <div className="relative flex justify-end items-baseline gap-1.5 mt-3 pt-2.5 border-t border-dashed border-slate-200/70 dark:border-white/10">
                      <span className="text-[11px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-[0.1em]">RD$</span>
                      <span className="font-black tabular-nums leading-none tracking-[-0.02em] text-[26px] text-[#b3001e]">
                        {Number(svc.price || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile floating cart button ──────────────────────────────────── */}
      {cart.length > 0 && !mobileCartOpen && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="md:hidden fixed bottom-20 right-4 z-30 bg-[#b3001e] text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
        >
          <ShoppingCart size={22} />
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">{cartCount}</span>
        </button>
      )}

      {/* ── Right: Cart panel ────────────────────────────────────────────── */}
      <div className={`${mobileCartOpen ? 'fixed inset-0 z-40 bg-white dark:bg-black' : 'hidden'} md:flex md:relative md:w-[340px] lg:w-[380px] flex-col border-l border-slate-200 dark:border-white/10 bg-white dark:bg-black`}>
        {/* Cart header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ShoppingCart size={16} />
            {lang === 'es' ? 'Carrito' : 'Cart'}
            {cart.length > 0 && <span className="text-[11px] font-medium text-slate-400">({cartCount})</span>}
            {pyMode && (
              <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-md bg-[#b3001e] text-white shadow-sm">
                <Smartphone size={9} strokeWidth={3} /> PY
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {cart.length > 0 && (
              <button onClick={clearForm} className="text-[11px] text-red-500 hover:text-red-600 font-medium">
                {lang === 'es' ? 'Vaciar' : 'Clear'}
              </button>
            )}
            <button onClick={() => setMobileCartOpen(false)} className="md:hidden text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Client selector */}
        <div className="px-4 py-2 border-b border-slate-100 dark:border-white/5">
          {selectedClient ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserRound size={14} className="text-[#b3001e]" />
                <span className="text-[13px] font-medium text-slate-800 dark:text-white">{selectedClient.name}</span>
              </div>
              <button onClick={() => setSelectedClient(null)} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
            </div>
          ) : (
            <button onClick={() => setShowClientPicker(true)}
              className="w-full text-left text-[12px] text-slate-400 hover:text-[#b3001e] flex items-center gap-2 py-1">
              <UserRound size={13} />
              {lang === 'es' ? '+ Agregar cliente' : '+ Add client'}
            </button>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300 dark:text-white/20 gap-2">
              <ShoppingCart size={40} strokeWidth={1} />
              <p className="text-[13px]">{lang === 'es' ? 'Carrito vacio' : 'Cart empty'}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {cart.map(item => (
                <div key={item.id} className="group relative py-2.5 px-2 rounded-xl border border-slate-100 dark:border-white/5 hover:border-[#b3001e]/30 dark:hover:border-[#b3001e]/40 bg-white dark:bg-white/[0.02] transition-colors">
                  {/* Row 1 — name + delete */}
                  <div className="flex items-start gap-2 mb-1.5">
                    <p className="flex-1 text-[13px] font-semibold text-slate-800 dark:text-white leading-tight line-clamp-2">{item.name}</p>
                    <button onClick={() => removeFromCart(item.id)}
                      className="shrink-0 w-6 h-6 rounded-md text-slate-400 dark:text-white/30 hover:bg-[#b3001e] hover:text-white transition-colors flex items-center justify-center"
                      title={lang === 'es' ? 'Quitar' : 'Remove'}>
                      <X size={13} />
                    </button>
                  </div>
                  {/* Row 2 — unit price / detail + qty controls + line total */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {item.weight != null
                        ? <p className="text-[10px] text-slate-400 dark:text-white/40 tabular-nums">{item.weight.toFixed(3)} {item.unit} × {fmtRD(item.price_per_unit || 0)}/{item.unit}</p>
                        : <p className="text-[10px] text-slate-400 dark:text-white/40 tabular-nums">{fmtRD(item.price)} c/u</p>}
                      <p className="text-[14px] font-black text-[#b3001e] tabular-nums leading-none mt-0.5">{fmtRD(item.price * (item.qty || 1))}</p>
                    </div>
                    {item.weight == null && (
                      <div className="flex items-center gap-0 rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-black shrink-0">
                        <button onClick={() => item.qty <= 1 ? removeFromCart(item.id) : updateQty(item.id, -1)}
                          className="w-9 h-9 flex items-center justify-center text-[#b3001e] hover:bg-[#b3001e] hover:text-white active:scale-95 transition-all"
                          title={item.qty <= 1 ? (lang === 'es' ? 'Quitar' : 'Remove') : '-1'}>
                          {item.qty <= 1 ? <X size={14} /> : <Minus size={14} />}
                        </button>
                        <span className="w-10 text-center text-[15px] font-black text-slate-800 dark:text-white tabular-nums border-x border-slate-200 dark:border-white/10 py-1.5">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, 1)}
                          className="w-9 h-9 flex items-center justify-center text-[#b3001e] hover:bg-[#b3001e] hover:text-white active:scale-95 transition-all"
                          title="+1">
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Licorería — verified badge + deposit summary */}
        {isLicoreria && (ageVerified || bottleDepositTotal > 0) && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-white/5 space-y-1">
            {ageVerified && (
              <div className="flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400">
                <ShieldCheck size={13} />
                <span className="font-semibold">{lang === 'es' ? 'Edad verificada' : 'Age verified'}</span>
                <span className="text-slate-400 dark:text-white/40">· {ageVerified.method === 'dob' ? `DOB ${ageVerified.dob}` : 'ID check'}</span>
              </div>
            )}
            {bottleDepositTotal > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-[#b3001e]">
                <Wine size={13} />
                <span className="font-semibold">{lang === 'es' ? 'Depósito botellas' : 'Bottle deposit'}:</span>
                <span>{fmtRD(bottleDepositTotal)}</span>
              </div>
            )}
          </div>
        )}

        {/* Totals + Cobrar */}
        <div className="border-t border-slate-200 dark:border-white/10 px-4 py-3 space-y-2">
          <div className="flex justify-between text-[12px] text-slate-400"><span>Subtotal</span><span>{fmtRD(subtotal)}</span></div>
          <div className="flex justify-between text-[12px] text-slate-400"><span>ITBIS ({itbisRate}%)</span><span>{fmtRD(itbis)}</span></div>
          <div className="flex justify-between text-[15px] font-bold text-slate-800 dark:text-white border-t border-slate-200 dark:border-white/10 pt-2">
            <span>Total</span><span>{fmtRD(total)}</span>
          </div>
          <button
            onClick={() => {
              if (cart.length > 0) {
                setMobileCartOpen(false)
                setCobrarModal({
                  items: expandCartWithDeposits(cart), salesperson,
                  ageVerified,
                  clientId: selectedClient?.id || null,
                  clientName: selectedClient?.name || rncName || '',
                  client: selectedClient || null,
                  pyMode,
                })
              }
            }}
            disabled={cart.length === 0}
            className="w-full py-3 bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-40 text-white font-bold rounded-xl text-[14px] transition-colors flex items-center justify-center gap-2"
          >
            <ShoppingCart size={16} />
            {lang === 'es' ? 'Cobrar' : 'Charge'} — {fmtRD(total)}
          </button>
        </div>
      </div>

      {/* Client picker modal */}
      {showClientPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowClientPicker(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 dark:border-white/10">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} autoFocus
                  placeholder={lang === 'es' ? 'Buscar cliente...' : 'Search client...'}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {clients.filter(c => !clientSearch || c.name?.toLowerCase().includes(clientSearch.toLowerCase()) || c.rnc?.includes(clientSearch))
                .map(c => (
                  <button key={c.id} onClick={() => { setSelectedClient(c); setShowClientPicker(false); setClientSearch('') }}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 border-b border-slate-100 dark:border-white/5 last:border-0">
                    <p className="text-[13px] font-medium text-slate-800 dark:text-white">{c.name}</p>
                    {c.rnc && <p className="text-[11px] text-slate-400">{c.rnc}</p>}
                  </button>
                ))}
            </div>
            <div className="p-3 border-t border-slate-200 dark:border-white/10">
              <button onClick={() => { setShowClientPicker(false); setShowNewClient(true) }}
                className="w-full py-2 text-[13px] text-[#b3001e] font-medium hover:bg-[#b3001e]/10 rounded-lg transition-colors">
                + {lang === 'es' ? 'Nuevo cliente' : 'New client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewClient && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowNewClient(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-md">
            <NewClientForm
              onCreated={c => { setClients(prev => [c, ...prev]); setSelectedClient(c); setShowNewClient(false) }}
              onCancel={() => setShowNewClient(false)}
            />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2">
          <CheckCircle2 size={15} className="text-green-400" />
          {toast}
        </div>
      )}

      {/* CobrarModal */}
      {cobrarModal && (
        <CobrarModal
          ticket={{
            id: null,
            ticketNo: lang === 'es' ? 'NUEVO' : 'NEW',
            vehicle: '',
            services: cobrarModal.items,
            client:   cobrarModal.client || null,
          }}
          onConfirm={handlePaymentConfirm}
          onClose={() => setCobrarModal(null)}
        />
      )}

      {/* Licorería — age verification gate */}
      {pendingAgeItem && (
        <AgeVerifyModal
          minAge={licoreriaConfig?.ageVerification?.minAge || 18}
          productName={pendingAgeItem.name}
          onConfirm={handleAgeConfirmed}
          onCancel={() => setPendingAgeItem(null)}
        />
      )}

      {/* Carnicería — weight entry */}
      {pendingWeightItem && (
        <WeightModal
          product={pendingWeightItem}
          onConfirm={handleWeightConfirmed}
          onClose={() => setPendingWeightItem(null)}
        />
      )}
    </div>
  )
}

// ── Product grid (lazy-loaded inventory) ──────────────────────────────────────

// Category → icon map. Falls back to Package. Keyword match is case-insensitive.
const PRODUCT_ICON_RULES = [
  { match: /(cerveza|brahma|presidente|modelo|corona|heineken|stella|miller|beer|lata|malta)/i, icon: Beer },
  { match: /(vino|whisky|ron|vodka|tequila|gin|licor|wine|liquor)/i, icon: Wine },
  { match: /(agua|water|enriquillo|cristal|pellegrino|mineral)/i, icon: Droplet },
  { match: /(refresco|pepsi|coca|soda|sprite|7up|seven|fanta|gatorade|jugo|juice|natural|energizante|red bull|monster)/i, icon: CupSoda },
  { match: /(cafe|coffee|té|tea|chocolate caliente|capuchino|espresso)/i, icon: Coffee },
  { match: /(cheetos|doritos|frito|rufles|papitas|chips|snack|platanitos|caribas|hojuela)/i, icon: Cookie },
  { match: /(caramelo|chocolate|dulce|candy|chicle|gum|bombon)/i, icon: Candy },
  { match: /(helado|popsicle|ice cream|paleta|sorbete)/i, icon: IceCreamCone },
  { match: /(cigarro|cigarette|marlboro|tabaco|cigar)/i, icon: Cigarette },
  { match: /(mofongo|sancocho|pollo|carne|comida|food|plato|almuerzo|cena|burger|pizza|taco|sandwich|wrap|ensalada|salad)/i, icon: UtensilsCrossed },
  { match: /(pizza)/i, icon: Pizza },
  { match: /(aromatizante|limpia|lavado|shampoo|pulido|cera|ozono|fragancia|perfume|desinfectante)/i, icon: Sparkles },
  { match: /(encendedor|fosforo|fuego|combustible|gas|lighter)/i, icon: Flame },
  { match: /(flan|postre|dessert|leche|natilla|pudín)/i, icon: IceCreamCone },
  { match: /(hierba|organic|natural|verde|saludable|organico)/i, icon: Leaf },
]

function iconFor(product) {
  const txt = `${product.name || ''} ${product.category || ''}`
  for (const r of PRODUCT_ICON_RULES) if (r.match.test(txt)) return r.icon
  return Package
}

function ProductGrid({ api, lang, gridCols, onAdd, pyMode }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCat, setActiveCat] = useState('all')

  useEffect(() => {
    api.inventory?.all?.().then(items => {
      setProducts(items || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [api])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-[#b3001e]" />
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 gap-3">
        <div className="w-14 h-14 rounded-2xl bg-[#b3001e]/10 border border-[#b3001e]/30 flex items-center justify-center">
          <Package size={26} className="text-[#b3001e]" strokeWidth={1.75} />
        </div>
        <p className="text-[13px] font-semibold text-slate-700 dark:text-white">{lang === 'es' ? 'No hay productos en inventario' : 'No inventory products'}</p>
        <p className="text-[11px] text-slate-500 dark:text-white/50">{lang === 'es' ? 'Agrega productos en Inventario' : 'Add products in Inventory'}</p>
      </div>
    )
  }

  const groups = {}
  for (const p of products) {
    const cat = p.category || (lang === 'es' ? 'Sin Categoría' : 'Uncategorized')
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(p)
  }
  // Alphabetical, then push "General" / "Sin Categoría" to the end.
  const catNames = Object.keys(groups).sort((a, b) => {
    const TAIL = ['general', 'sin categoría', 'sin categoria', 'uncategorized']
    const ai = TAIL.includes(a.toLowerCase()) ? 1 : 0
    const bi = TAIL.includes(b.toLowerCase()) ? 1 : 0
    if (ai !== bi) return ai - bi
    return a.localeCompare(b, 'es', { sensitivity: 'base' })
  })
  const visibleCats = activeCat === 'all' ? catNames : catNames.filter(c => c === activeCat)

  return (
    <div className="space-y-5">
      {/* Category tabs — scrollable horizontally on mobile. Active tab gets a
         crimson underline. "Todos" always first; "General" sorted last. */}
      {catNames.length > 1 && (
        <div className="sticky top-0 z-10 -mx-3 px-3 bg-white dark:bg-black border-b border-slate-200 dark:border-white/10">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            <button onClick={() => setActiveCat('all')}
              className={`shrink-0 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors min-h-[44px] ${
                activeCat === 'all'
                  ? 'border-[#b3001e] text-[#b3001e]'
                  : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
              }`}>
              {lang === 'es' ? 'Todos' : 'All'}
              <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                activeCat === 'all' ? 'bg-[#b3001e]/10 text-[#b3001e]' : 'bg-slate-100 dark:bg-white/10 text-slate-400'
              }`}>{products.length}</span>
            </button>
            {catNames.map(c => (
              <button key={c} onClick={() => setActiveCat(c)}
                className={`shrink-0 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors min-h-[44px] ${
                  activeCat === c
                    ? 'border-[#b3001e] text-[#b3001e]'
                    : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
                }`}>
                {c}
                <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeCat === c ? 'bg-[#b3001e]/10 text-[#b3001e]' : 'bg-slate-100 dark:bg-white/10 text-slate-400'
                }`}>{groups[c].length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {visibleCats.map(cat => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block w-1 h-4 rounded-full bg-[#b3001e]" />
            <p className="text-[10px] font-black text-slate-700 dark:text-white uppercase tracking-[0.15em]">{cat}</p>
            <span className="text-[10px] text-slate-400 dark:text-white/40 font-medium">{groups[cat].length}</span>
            <span className="flex-1 h-px bg-gradient-to-r from-slate-200 dark:from-white/10 to-transparent" />
          </div>
          <div className={`grid ${gridCols} gap-2.5`}>
            {groups[cat].map(item => {
              const Icon = iconFor(item)
              const out = item.quantity <= 0
              const low = !out && item.quantity <= (item.min_quantity || 5)
              return (
                <button key={item.id} onClick={() => !out && onAdd(item)} disabled={out}
                  className={`group relative overflow-hidden flex flex-col justify-between p-4 md:p-5 rounded-2xl border bg-white dark:bg-white/[0.03] text-left transition-all duration-200 ease-out min-h-[140px] md:min-h-[148px] will-change-transform
                    ${out
                      ? 'border-slate-200 dark:border-white/10 opacity-55 cursor-not-allowed grayscale-[0.3]'
                      : 'border-slate-200 dark:border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:border-[#b3001e] hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-12px_rgba(179,0,30,0.45),inset_0_1px_0_0_rgba(255,255,255,0.6)] active:translate-y-0 active:scale-[0.99]'
                    }`}
                >
                  {/* Crimson accent sweep on hover */}
                  {!out && <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />}
                  {!out && <span className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-white/50 via-transparent to-transparent dark:from-white/[0.05] opacity-40 group-hover:opacity-90 transition-opacity" />}
                  {/* Icon badge */}
                  <div className="relative flex items-start justify-between gap-2 mb-2">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 ring-1 ring-inset
                      ${out
                        ? 'bg-slate-100 dark:bg-white/5 ring-slate-200/60 dark:ring-white/5'
                        : 'bg-slate-100 dark:bg-white/5 ring-slate-200/60 dark:ring-white/10 group-hover:bg-[#b3001e] group-hover:ring-[#b3001e] group-hover:text-white group-hover:shadow-[0_6px_14px_-4px_rgba(179,0,30,0.5)]'
                      }`}>
                      <Icon size={18} strokeWidth={1.75} className={out ? 'text-slate-400 dark:text-white/30' : 'text-[#b3001e] group-hover:text-white transition-colors'} />
                    </div>
                    {out ? (
                      <span className="text-[9px] font-black uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-[#b3001e] text-white shadow-[0_4px_10px_-2px_rgba(179,0,30,0.5)]">
                        {lang === 'es' ? 'Agotado' : 'Out'}
                      </span>
                    ) : low ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.12em] px-2 py-0.5 rounded-full bg-white dark:bg-white/10 text-[#b3001e] border border-[#b3001e]/40 shadow-sm">
                        <span className="w-1 h-1 rounded-full bg-[#b3001e] animate-pulse" />
                        {item.quantity}
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-slate-400 dark:text-white/40 tabular-nums tracking-tight">
                        ×{item.quantity}
                      </span>
                    )}
                  </div>

                  {/* Name + SKU */}
                  <div className="relative mb-2.5 min-h-[36px]">
                    <p className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-white leading-snug line-clamp-2 tracking-[-0.01em]">{item.name}</p>
                    {item.sku && <p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5 font-mono tracking-tight">{item.sku}</p>}
                  </div>

                  {/* Price row — Pedidos Ya override when toggle is on */}
                  {(() => {
                    const base = Number(item.price || 0)
                    const pyRaw = item.price_pedidos_ya
                    const py = pyRaw != null && pyRaw !== '' && Number.isFinite(Number(pyRaw)) ? Number(pyRaw) : null
                    const showPY = pyMode && py != null
                    const shown = showPY ? py : base
                    const strike = showPY && py !== base
                    return (
                      <div className="relative pt-2.5 border-t border-dashed border-slate-200/70 dark:border-white/10">
                        {strike && (
                          <div className="flex justify-end">
                            <span className="text-[11px] text-slate-400 dark:text-white/40 line-through tabular-nums">
                              RD$ {base.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-end items-baseline gap-1.5">
                          <p className="text-[11px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-[0.1em]">RD$</p>
                          <p className={`font-black tabular-nums leading-none tracking-[-0.02em] ${out ? 'text-slate-400 dark:text-white/30 line-through decoration-[#b3001e]/40' : 'text-[#b3001e]'} text-[26px] transition-colors`}>
                            {shown.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    )
                  })()}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Lending Dashboard (POS landing for prestamos businesses) ──────────────────

function LendingDashboard() {
  const api = useAPI()
  const { lang } = useLang()
  const navigate = useNavigate()
  const [stats, setStats] = useState({ active: 0, dueToday: 0, portfolio: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const summary = await api?.loans?.summary?.()
        if (summary) setStats({ active: summary.active || 0, dueToday: summary.due_today || 0, portfolio: summary.portfolio || 0 })
      } catch {}
      setLoading(false)
    }
    load()
  }, [api])

  const cards = [
    { label: lang === 'es' ? 'Préstamos Activos' : 'Active Loans', value: stats.active, color: 'text-[#b3001e]', bg: 'bg-blue-50 dark:bg-blue-900/20' },
    { label: lang === 'es' ? 'Pagos Pendientes Hoy' : 'Payments Due Today', value: stats.dueToday, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20' },
    { label: lang === 'es' ? 'Total Cartera' : 'Total Portfolio', value: `RD$ ${stats.portfolio.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  ]

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-black">
      <h1 className="text-2xl font-black text-slate-800 dark:text-white mb-8">
        {lang === 'es' ? 'Dashboard de Préstamos' : 'Lending Dashboard'}
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl mb-8">
        {cards.map((card, i) => (
          <div key={i} className={`${card.bg} rounded-2xl p-5 border border-slate-200 dark:border-white/10`}>
            <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">{card.label}</p>
            {loading ? (
              <div className="h-8 w-20 bg-slate-200 dark:bg-white/10 rounded-lg animate-pulse" />
            ) : (
              <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => navigate('/loans')}
          className="px-6 py-3 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold rounded-xl text-[14px] transition-colors"
        >
          {lang === 'es' ? 'Ver Préstamos' : 'View Loans'}
        </button>
        <button
          onClick={() => navigate('/loans')}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-[14px] transition-colors"
        >
          {lang === 'es' ? 'Registrar Pago' : 'Register Payment'}
        </button>
      </div>
    </div>
  )
}

// ── POS Wrapper ───────────────────────────────────────────────────────────────

// Hybrid wrapper — Mesa / Venta Directa toggle. Mode persists per-user in
// localStorage so a server reopens in the segment they last used.
function HybridPOS() {
  const KEY = 'tx_hybrid_pos_mode'
  const initial = (typeof window !== 'undefined' && window.localStorage?.getItem(KEY)) || 'mesa'
  const [mode, setMode] = useState(initial === 'directa' ? 'directa' : 'mesa')
  useEffect(() => {
    try { window.localStorage?.setItem(KEY, mode) } catch {}
  }, [mode])
  // Allow the Mesa pane to push the cart into Venta Directa via a custom event.
  // Keeps the two panes decoupled — no prop drilling, no shared context needed.
  useEffect(() => {
    const onSwitch = (e) => {
      const next = e?.detail === 'directa' || e?.detail === 'mesa' ? e.detail : null
      if (next) setMode(next)
    }
    window.addEventListener('tx_hybrid_mode_change', onSwitch)
    return () => window.removeEventListener('tx_hybrid_mode_change', onSwitch)
  }, [])
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-center gap-0 px-3 py-2 bg-black border-b border-white/10">
        <div className="inline-flex rounded-full bg-white/5 border border-white/10 p-0.5">
          <button
            onClick={() => setMode('mesa')}
            className={`px-5 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
              mode === 'mesa' ? 'bg-[#b3001e] text-white' : 'text-white/70 hover:text-white'
            }`}
          >Mesa</button>
          <button
            onClick={() => setMode('directa')}
            className={`px-5 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
              mode === 'directa' ? 'bg-[#b3001e] text-white' : 'text-white/70 hover:text-white'
            }`}
          >Venta Directa</button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {mode === 'mesa' ? <RestaurantPOS /> : <RetailPOS />}
      </div>
    </div>
  )
}

export default function POS() {
  const { isRetail, isRestaurant, isHybrid, isPrestamos } = useBusinessType()
  const { plan } = usePlan()
  if (plan === 'facturacion') return <Navigate to="/invoicing" replace />
  if (isHybrid) return <HybridPOS />
  if (isRestaurant) return <RestaurantPOS />
  if (isPrestamos) return <LendingDashboard />
  return isRetail ? <RetailPOS /> : <CarWashPOS />
}
