import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { X, ChevronDown, Check, CheckCircle2, Search, Loader2, AlertCircle } from 'lucide-react'
import { useLang } from '../i18n'
import { useLayout } from '../context/LayoutContext'
import { useServices, useWashers, useSellers, hasIPC } from '../hooks/useDB'
import CobrarModal from '../components/CobrarModal'

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
  const subtotal = items.reduce((s, i) => s + i.price, 0)
  return {
    subtotal,
    itbis: subtotal * ITBIS,
    ley:   subtotal * LEY,
    total: subtotal * (1 + ITBIS + LEY),
  }
}

function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS = {
  listo:     { dot: 'bg-green-500', pill: 'bg-green-100 text-green-700', label_es: 'Listo',      label_en: 'Ready'       },
  proceso:   { dot: 'bg-blue-500',  pill: 'bg-blue-100 text-blue-700',   label_es: 'En Proceso', label_en: 'In Progress'  },
  pendiente: { dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-700', label_es: 'Pendiente',  label_en: 'Pending'     },
}

// ── Demo services fallback (shown when DB returns empty) ──────────────────────
const DEMO_SERVICES = [
  { id:1,  name:'Lavado Básico',      name_en:'Basic Wash',        category:'Lavados',  price:500,  is_wash:1, sort_order:1 },
  { id:2,  name:'Lavado Completo',    name_en:'Full Wash',         category:'Lavados',  price:800,  is_wash:1, sort_order:2 },
  { id:3,  name:'Lavado de Motor',    name_en:'Engine Wash',       category:'Lavados',  price:1200, is_wash:1, sort_order:3 },
  { id:4,  name:'Lavado Jeepeta',     name_en:'SUV Wash',          category:'Lavados',  price:1000, is_wash:1, sort_order:4 },
  { id:5,  name:'Lavado Camión',      name_en:'Truck Wash',        category:'Lavados',  price:1800, is_wash:1, sort_order:5 },
  { id:6,  name:'Aromatizante',       name_en:'Air Freshener',     category:'Extra',    price:150,  is_wash:1, sort_order:6 },
  { id:7,  name:'Brillo de Gomas',    name_en:'Tire Shine',        category:'Extra',    price:200,  is_wash:1, sort_order:7 },
  { id:8,  name:'Aspirado Interior',  name_en:'Interior Vacuum',   category:'Extra',    price:400,  is_wash:1, sort_order:8 },
  { id:9,  name:'Ozono',              name_en:'Ozone Treatment',   category:'Extra',    price:1200, is_wash:1, sort_order:9 },
  { id:10, name:'Lavado + Cera',      name_en:'Wash + Wax',        category:'Combos',   price:2000, is_wash:1, sort_order:10 },
  { id:11, name:'Lavado + Aspirado',  name_en:'Wash + Vacuum',     category:'Combos',   price:1100, is_wash:1, sort_order:11 },
  { id:12, name:'Detailing Completo', name_en:'Full Detailing',    category:'Combos',   price:4500, is_wash:1, sort_order:12 },
  { id:13, name:'Agua Fría',          name_en:'Cold Water',        category:'Bebidas',  price:50,   is_wash:0, sort_order:13 },
  { id:14, name:'Refresco',           name_en:'Soda',              category:'Bebidas',  price:100,  is_wash:0, sort_order:14 },
  { id:15, name:'Café',               name_en:'Coffee',            category:'Bebidas',  price:75,   is_wash:0, sort_order:15 },
  { id:16, name:'Papitas',            name_en:'Chips',             category:'Snacks',   price:80,   is_wash:0, sort_order:16 },
  { id:17, name:'Galletas',           name_en:'Cookies',           category:'Snacks',   price:60,   is_wash:0, sort_order:17 },
]

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
        className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] text-slate-500 hover:border-slate-400 transition-colors"
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
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
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
  const { t, lang } = useLang()
  const { collapsed } = useLayout()

  // ── DB data
  const { data: rawServicesDB, loading: svcLoading, error: svcError } = useServices()
  // Fall back to demo services if DB returns nothing
  const rawServices = (!svcLoading && (!rawServicesDB || rawServicesDB.length === 0))
    ? DEMO_SERVICES
    : (rawServicesDB || [])
  const { data: rawWashers, loading: wsrLoading }                   = useWashers()
  const { data: rawSellers }                                         = useSellers()

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
  const gridCols = collapsed ? 'grid-cols-5' : 'grid-cols-4'

  // O(1) lookup instead of O(n) items.some() per service button
  const selectedIds = useMemo(() => new Set(items.map(i => i.id)), [items])

  function clearForm() {
    setItems([])
    setVehicle('')
    setRnc('')
    setRncName('')
    setWorkers([])
    setSalesperson('')
  }

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

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

  function handleRncLookup() {
    if (rnc.length >= 9) setRncName('Empresa Demo S.R.L.')
  }

  async function handleEncolar() {
    if (allOrderItems.length === 0 && !vehicle.trim()) return

    if (!hasIPC()) {
      // Dev fallback — just show in local queue strip
      const ticketNo = `T-${String(queue.length + 1).padStart(3, '0')}`
      setQueue(prev => [...prev, {
        id:      Date.now(),
        ticketNo,
        vehicle: vehicle.trim() || '—',
        service: allOrderItems[0]?.name ?? '—',
        status:  'pendiente',
      }])
      clearForm()
      flash(`${ticketNo} · ${lang === 'es' ? 'Puesto en cola' : 'Added to queue'}`)
      return
    }

    try {
      const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(allOrderItems)
      const beverageSubtotal = allOrderItems
        .filter(s => s.is_wash === 0)
        .reduce((s, i) => s + i.price, 0)

      const result = await window.electronAPI.tickets.create({
        vehicle_plate:     vehicle.trim() || null,
        washer_ids:        workers.map(w => w.id),
        seller_id:         salesperson ? parseInt(salesperson) : null,
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
      flash(`${result?.docNumber || 'Ticket'} · ${lang === 'es' ? 'Puesto en cola ✓' : 'Added to queue ✓'}`)
    } catch (err) {
      flash(`Error: ${err.message}`)
    }
  }

  const handlePaymentConfirm = useCallback(async (paymentData) => {
    const pending = cobrarModal
    setCobrarModal(null)

    if (!hasIPC()) {
      // Dev mode: just add to local queue strip
      const ticketNo = `T-${String(queue.length + 1).padStart(3, '0')}`
      setQueue(prev => [...prev, {
        id:      Date.now(),
        ticketNo,
        vehicle: pending.vehicle,
        service: pending.items[0]?.name ?? '—',
        status:  'pendiente',
      }])
      clearForm()
      flash(`${ticketNo} · ${lang === 'es' ? 'Puesto en cola' : 'Added to queue'}`)
      return
    }

    try {
      const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(pending.items)
      const beverageSubtotal = pending.items
        .filter(s => s.is_wash === 0)
        .reduce((s, i) => s + i.price, 0)

      const result = await window.electronAPI.tickets.create({
        vehicle_plate:    pending.vehicle,
        client_id:        pending.clientId || null,
        washer_ids:       pending.workers.map(w => w.id),
        seller_id:        pending.salesperson ? parseInt(pending.salesperson) : null,
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

      // Open cash drawer for cash/check payments (not card or transfer)
      const fm = paymentData.formaPago || ''
      if (paymentData.tipo !== 'credito' && !['tarjeta', 'transferencia'].includes(fm)) {
        window.electronAPI?.openDrawer?.().catch?.(() => {})
      }
    } catch (err) {
      flash(`Error: ${err.message}`)
    }
  }, [cobrarModal, queue.length, lang])

  return (
    <div className="h-full flex">

      {/* ══ CENTER ══════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Category tabs */}
        <div className="flex border-b border-slate-200 bg-white shrink-0 overflow-x-auto">
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
              className={`px-5 py-3.5 text-sm font-semibold transition-colors border-b-2 -mb-px shrink-0 ${
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
        <div className="flex-1 overflow-y-auto p-4">
          {svcLoading ? (
            <GridSkeleton cols={gridCols} />
          ) : svcError ? (
            <div className="flex flex-col items-center justify-center h-48 text-red-400 gap-2">
              <AlertCircle size={28} />
              <p className="text-sm">{lang === 'es' ? 'Error al cargar servicios' : 'Error loading services'}</p>
            </div>
          ) : (
            <div className={`grid gap-2.5 ${gridCols}`}>
              {(servicesByCategory[category] ?? []).map(svc => {
                const selected = selectedIds.has(svc.id)
                return (
                  <button
                    key={svc.id}
                    onClick={() => toggleService(svc)}
                    className={`rounded-xl p-3.5 text-left transition-all border ${
                      selected
                        ? 'bg-[#E6F1FB] border-[#0C447C] text-[#0C447C] shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-[#0C447C]/40 hover:shadow-sm'
                    }`}
                  >
                    <p className="text-[13px] font-semibold leading-snug">
                      {lang === 'es' ? svc.name : (svc.name_en || svc.name)}
                    </p>
                    <p className={`text-[12px] font-bold mt-1.5 ${selected ? 'text-[#0C447C]/70' : 'text-slate-400'}`}>
                      {fmtRD(svc.price)}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Queue strip */}
        <QueueStrip queue={queue} lang={lang} />
      </div>

      {/* ══ RIGHT PANEL ═════════════════════════════════════════════════════ */}
      <div className="w-[220px] shrink-0 border-l border-slate-200 flex flex-col bg-white">

        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">

          {/* RNC / Cédula */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              {t('pos_rnc_cedula')}
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={rnc}
                onChange={e => { setRnc(e.target.value); setRncName('') }}
                placeholder="000-00000-0"
                maxLength={11}
                className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-[12px] focus:outline-none focus:border-sky-400 placeholder:text-slate-300"
              />
              <button
                onClick={handleRncLookup}
                title="Buscar DGII"
                className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-sky-50 hover:text-sky-600 text-slate-500 rounded-lg transition-colors shrink-0"
              >
                <Search size={13} />
              </button>
            </div>
            {rncName && (
              <p className="mt-1 text-[11px] text-sky-600 font-medium truncate">{rncName}</p>
            )}
          </div>

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
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-[12px] focus:outline-none focus:border-sky-400 placeholder:text-slate-300"
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
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-[12px] text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              <option value="">{t('pos_walkin')}</option>
              {rawSellers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
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
              <div className="space-y-1">
                {allOrderItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-1 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-slate-700 font-medium truncate leading-snug">
                        {item.name}
                      </p>
                      <p className="text-[11px] text-slate-400 leading-none">{fmtRD(item.price)}</p>
                    </div>
                    <button
                      onClick={() => removeOrderItem(item)}
                      className="w-5 h-5 flex items-center justify-center rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Totals + Button ─────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-slate-200 p-3.5 space-y-3">

          {allOrderItems.length > 0 ? (
            <div className="space-y-1">
              <div className="flex justify-between text-[12px] text-slate-500">
                <span>{t('pos_subtotal')}</span>
                <span>{fmtRD(subtotal)}</span>
              </div>
              <div className="flex justify-between text-[12px] text-slate-500">
                <span>{t('pos_itbis')}</span>
                <span>{fmtRD(itbis)}</span>
              </div>
              <div className="flex justify-between text-[12px] text-slate-500">
                <span>{t('pos_ley')}</span>
                <span>{fmtRD(ley)}</span>
              </div>
              <div className="flex justify-between text-[13px] font-bold text-slate-800 border-t border-slate-100 pt-1.5 mt-1">
                <span>{t('pos_total')}</span>
                <span>{fmtRD(total)}</span>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-300 text-[12px] py-2">
              {t('pos_no_items_yet')}
            </div>
          )}

          <button
            onClick={handleEncolar}
            disabled={allOrderItems.length === 0 && !vehicle.trim()}
            className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-[13px] transition-all active:scale-[0.98] shadow-md shadow-green-500/20"
          >
            {t('pos_queue_btn')}
          </button>
        </div>
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
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
