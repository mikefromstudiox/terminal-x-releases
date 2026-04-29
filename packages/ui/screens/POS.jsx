import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { X, ChevronDown, Check, CheckCircle2, Search, Loader2, AlertCircle, ShoppingCart, UserRound, Plus, Minus, Barcode, Package, LayoutGrid, Wine, Zap, ShieldCheck, Beer, Coffee, Cookie, Droplet, CupSoda, Candy, IceCreamCone, UtensilsCrossed, Sparkles, Cigarette, Flame, Leaf, Pizza, Smartphone, Edit2, Eye, EyeOff, Lock } from 'lucide-react'
import AgeVerifyModal, { requiresAgeCheck } from '../components/AgeVerifyModal'
import {
  expandCartWithDeposits as licExpandCartWithDeposits,
  checkAgeGate as licCheckAgeGate,
} from './pos/licoreria-helpers'
import WeightModal from '../components/WeightModal'
import { CarniceriaModeToggle, PrepNotesButton, SeasonalPromoBanner } from '../components/CarniceriaCartExtras'
import { activeSeasons } from '@terminal-x/services/seasonalPromotions'
import { ScaleRegistry } from '@terminal-x/services/scale'
import { pickBestDiscount, applyDiscountToLine, discountPillLabel } from '@terminal-x/services/discountEngine'
import DepositReturnModal from '../components/DepositReturnModal'
import ManagerAuthGate from '../components/ManagerAuthGate'
import AperturaTurnoModal from '../components/AperturaTurnoModal'
import { needsGate } from '@terminal-x/services/managerGateRules'
import { useLang } from '../i18n'
import { useLayout } from '../context/LayoutContext'
import { useAuth } from '../context/AuthContext'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useServices, useWashers, useSellers } from '../hooks/useDB'
import { useRNC } from '../hooks/useRNC'
import CobrarModal from '../components/CobrarModal'
import PaymentErrorBoundary from '../components/PaymentErrorBoundary'
import LoyaltyTierBadge from '../components/LoyaltyTierBadge'
import { NewClientForm } from './Clients'
import { printClientReceipt, printWasherConduce, printKitchenPrepSlip } from '@terminal-x/services/printer'
import RestaurantPOS from './restaurant/RestaurantPOS'
import { getBusinessId } from '@terminal-x/services/supabase'
import { getDeviceId, acquireLock, releaseLock, releaseAll, activeLocksQty, sweepExpired, subscribeLocks } from '@terminal-x/services/inventoryLock'
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

function WorkerSelect({ selected, onChange, overrides = {}, onOverrideChange, shareTotalTarget = 0, itbisFrac = 0.18, washers, t, businessType, lang }) {
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
      {/* v2.14.20 — per-washer commission override. Shown when 2+ washers
          are on the ticket so the owner can split the commission unevenly
          (e.g. one washer did the hard part). Blank = auto-calc from
          empleado.comision_pct. Hidden when only 1 washer is selected. */}
      {selected.length >= 2 && onOverrideChange && (() => {
        // v2.14.25 — the override is each washer's SHARE of the ticket (the
        // portion of the service value that worker is responsible for), NOT
        // a raw commission amount. Sum of shares must equal the ticket's
        // commission-eligible total (shareTotalTarget, ITBIS-inclusive).
        // Per-washer commission is derived: share / (1+itbisFrac) × pct.
        // Cobrar is blocked when the divider is incomplete.
        const sum = selected.reduce((s, w) => s + (Number(overrides[w.id]) || 0), 0)
        const delta = sum - shareTotalTarget
        const allBlank = selected.every(w => !overrides[w.id])
        const incomplete = !allBlank && Math.abs(delta) > 0.01 && shareTotalTarget > 0
        return (
          <div className={`mb-2 space-y-1.5 p-2 rounded-lg bg-slate-50 dark:bg-white/5 border ${incomplete ? 'border-red-400 dark:border-red-500/40' : 'border-slate-200 dark:border-white/10'}`}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wider">
                {lang === 'es' ? 'Dividir ticket entre lavadores' : 'Split ticket between washers'}
              </p>
              {shareTotalTarget > 0 && (
                <p className="text-[10px] font-semibold text-slate-400 dark:text-white/40">
                  {lang === 'es' ? 'Meta' : 'Target'}: RD${shareTotalTarget.toFixed(2)}
                </p>
              )}
            </div>
            {selected.map(w => {
              const share = Number(overrides[w.id]) || 0
              const pct = Number(w.commission_pct ?? w.comision_pct ?? 0)
              // Per-washer commission = share ÷ (1+itbis) × pct/100
              const comm = share > 0 && pct > 0
                ? (share / (1 + itbisFrac)) * (pct / 100)
                : 0
              return (
                <div key={w.id} className="flex items-center gap-2">
                  <span className="flex-1 text-[12px] text-slate-700 dark:text-white truncate">
                    {w.name}
                    <span className="text-[10px] text-slate-400 dark:text-white/40 ml-1">({pct}%)</span>
                  </span>
                  <div className="flex items-center bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-md overflow-hidden focus-within:border-[#b3001e]">
                    <span className="px-1.5 text-[10px] text-slate-400 select-none">RD$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={overrides[w.id] ?? ''}
                      onChange={e => onOverrideChange(w.id, e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder={lang === 'es' ? 'parte' : 'share'}
                      className="w-20 px-1 py-1 text-[12px] font-semibold text-right text-slate-800 dark:text-white bg-transparent focus:outline-none"
                    />
                  </div>
                  <span className="w-20 text-right text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    = RD${comm.toFixed(2)}
                  </span>
                </div>
              )
            })}
            {!allBlank && (
              <div className={`flex items-center justify-between pt-1.5 mt-1 border-t text-[11px] font-bold ${incomplete ? 'border-red-400 text-red-600 dark:text-red-400' : 'border-emerald-400 text-emerald-600 dark:text-emerald-400'}`}>
                <span>{lang === 'es' ? 'Suma de partes' : 'Share sum'}</span>
                <span>RD${sum.toFixed(2)} / {shareTotalTarget.toFixed(2)}</span>
              </div>
            )}
            {incomplete && (
              <p className="text-[11px] text-red-600 dark:text-red-400 font-bold">
                {lang === 'es'
                  ? (delta > 0
                      ? `⚠ Divider incompleto — sobran RD$${delta.toFixed(2)}. Ajusta las partes para sumar RD$${shareTotalTarget.toFixed(2)}.`
                      : `⚠ Divider incompleto — faltan RD$${Math.abs(delta).toFixed(2)}. Completa el total.`)
                  : `⚠ Divider incomplete — sum must equal RD$${shareTotalTarget.toFixed(2)}.`}
              </p>
            )}
            {allBlank && (
              <p className="text-[9px] text-slate-400 dark:text-white/40 italic">
                {lang === 'es'
                  ? 'Deja en blanco para dividir el total uniformemente y usar el % de cada empleado.'
                  : 'Leave blank to split evenly using each worker\'s %.'}
              </p>
            )}
          </div>
        )
      })()}

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

// PlateLookup — debounced placa search via api.vehicles.list. Offline-safe:
// reads from local SQLite (electron) or Supabase (web). Free-typing always
// allowed so unregistered plates still flow through.
function PlateLookup({ value, onChange, onPick, placeholder, api, lang }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const q = (value || '').trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const rows = await (api?.vehicles?.list?.({ search: q, limit: 8 }) ?? [])
        if (cancelled) return
        // Server already filtered when supported; keep client-side fallback
        // for web (Supabase) where `search` may be ignored.
        const Q = q.toUpperCase()
        const filtered = (rows || [])
          .filter(v => (v.plate || '').toUpperCase().includes(Q)
                    || (v.make  || '').toUpperCase().includes(Q)
                    || (v.model || '').toUpperCase().includes(Q))
          .slice(0, 8)
        setResults(filtered)
        setOpen(filtered.length > 0)
      } catch { if (!cancelled) setResults([]) }
      finally { if (!cancelled) setLoading(false) }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [value, api])

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value.toUpperCase())}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-2 text-sm md:text-[12px] text-slate-800 dark:text-white min-h-[44px] md:min-h-0 focus:outline-none focus:border-[#b3001e] placeholder:text-slate-300 dark:placeholder:text-white/30 uppercase"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-lg shadow-xl z-40 overflow-hidden max-h-64 overflow-y-auto">
          {results.map(v => (
            <button
              key={v.id}
              type="button"
              onClick={() => { onPick(v); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-[#b3001e]/5 dark:hover:bg-white/10 border-b border-slate-100 dark:border-white/5 last:border-b-0"
            >
              <div className="text-[13px] font-bold text-slate-800 dark:text-white tracking-wide">{v.plate}</div>
              <div className="text-[11px] text-slate-500 dark:text-white/60 truncate">
                {[v.make, v.model, v.color].filter(Boolean).join(' · ')}
                {v.client_name ? ` — ${v.client_name}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
      {loading && (
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">…</div>
      )}
    </div>
  )
}

// FIX 5.4 — banner showing pending 72h-deferred DGII e-CFs. Reads counts
// from the offline IndexedDB queue (web) and ecf_queue (desktop) so the
// cashier knows the receipts will be retried within 72h.
function DeferredEcfBanner({ lang }) {
  const [count, setCount] = useState(0)
  const [oldestAgeHrs, setOldestAgeHrs] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        // Web path
        if (typeof indexedDB !== 'undefined' && !window.electronAPI) {
          const mod = await import('@terminal-x/services/offline-ecf-queue')
          // FIX 5.8 — auto-purge >72h rows so the banner never reflects rows
          // that DGII would reject anyway. Counts the remaining valid set.
          try { await mod.purgeStale72h() } catch {}
          const rows = await mod.all()
          if (cancelled) return
          setCount(rows.length)
          const oldest = rows.reduce((m, r) => Math.min(m, r.createdAt || Date.now()), Date.now())
          setOldestAgeHrs(rows.length > 0 ? Math.max(0, (Date.now() - oldest) / 3_600_000) : 0)
          return
        }
        // Desktop path
        const rows = await window.electronAPI?.dgii?.queueList?.({ status: 'pending' })
        if (cancelled) return
        setCount(rows?.length || 0)
      } catch { if (!cancelled) setCount(0) }
    }
    refresh()
    const onEvt = () => refresh()
    window.addEventListener('tx:ecf-queue-enqueued', onEvt)
    window.addEventListener('tx:ecf-queue-status', onEvt)
    window.addEventListener('tx:ecf-queue-drained', onEvt)
    const id = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener('tx:ecf-queue-enqueued', onEvt)
      window.removeEventListener('tx:ecf-queue-status', onEvt)
      window.removeEventListener('tx:ecf-queue-drained', onEvt)
    }
  }, [])

  if (!count) return null
  const aging = oldestAgeHrs > 60
  return (
    <div className={`mt-2 px-3 py-2 rounded-lg border text-[12px] font-semibold flex items-center gap-2 ${aging ? 'bg-[#b3001e]/10 border-[#b3001e]/30 text-[#b3001e]' : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400'}`}>
      <AlertCircle size={14} />
      {lang === 'es'
        ? `${count} e-CF en envío diferido (DGII 72h)${oldestAgeHrs > 0 ? ` · más antiguo ${oldestAgeHrs.toFixed(1)}h` : ''}`
        : `${count} e-CF pending deferred submission (DGII 72h)${oldestAgeHrs > 0 ? ` · oldest ${oldestAgeHrs.toFixed(1)}h` : ''}`}
    </div>
  )
}

function CarWashPOS() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { t, lang } = useLang()
  const { collapsed } = useLayout()
  const { businessType } = useBusinessType()
  const { user } = useAuth()
  const navigate = useNavigate()
  // v2.16.2 (Fix 1) — read route state for membership-purchase preload
  // dispatched from salon/Memberships.jsx "Vender" button.
  const location = useLocation()

  // ── DB data
  const { data: rawServicesDB, loading: svcLoading, error: svcError, reload: reloadServices } = useServices()
  const rawServices = rawServicesDB || []
  const { data: rawWashersDB, loading: wsrLoading }                  = useWashers()
  const rawWashers = (rawWashersDB || []).filter(w => w.role !== 'owner')
  const { data: rawSellersDB }                                       = useSellers()
  // v2.16.12 — exclude owners (admin hybrid users) from POS pickers. Owners
  // hold empleado rows for login/payroll but shouldn't be selectable as the
  // physical seller/washer on a ticket. Same filter applied to washers above.
  const rawSellers = (rawSellersDB || []).filter(s => s.role !== 'owner')
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
    // v2.14.20 — sort each category by sort_order ASC (nulls last), then id,
    // so owner-set reorder persists. Inventory items fall to the end.
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => {
        const ai = a._isInventory ? 1 : 0
        const bi = b._isInventory ? 1 : 0
        if (ai !== bi) return ai - bi
        const ao = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 9999
        const bo = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 9999
        if (ao !== bo) return ao - bo
        return (a.id || 0) - (b.id || 0)
      })
    }
    return groups
  }, [rawServices, invItems])

  // ── UI state
  const [category,  setCategory]  = useState(null)
  const [items,     setItems]     = useState([])
  const [queue,     setQueue]     = useState([])
  const [toast,     setToast]     = useState(null)
  const [cobrarModal, setCobrarModal] = useState(null)

  // v2.14.20 — tile reorder mode on the main service grid. Owner/manager only.
  // In reorder mode, tiles become draggable and the add-to-cart tap is disabled.
  // Save persists sort_order per service via api.services.update.
  const canReorderTiles = ['owner', 'manager'].includes(String(user?.role || '').toLowerCase())
  const [reorderMode, setReorderMode] = useState(false)
  const [reorderDraft, setReorderDraft] = useState([])   // array of current-category svc objects in draft order
  const [dragTileIdx, setDragTileIdx] = useState(null)
  const [savingOrder, setSavingOrder] = useState(false)

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

  // v2.16.2 (Fix 1) — membership-purchase preload from /salon/memberships.
  // The Memberships "Vender" button navigates here with state carrying the
  // template + chosen client. We push a single cart line shaped like a
  // service item, plus an opaque `_membershipPurchase` marker that
  // handlePaymentConfirm reads AFTER tickets.create succeeds to call
  // clientMemberships.purchase with the real ticket_supabase_id.
  // Idempotent: the route-state is consumed once, then cleared so a
  // back/forward doesn't re-inject.
  const preloadConsumedRef = useRef(false)
  useEffect(() => {
    if (preloadConsumedRef.current) return
    const st = location?.state
    if (!st || !st.membershipPurchase) return
    const mp = st.membershipPurchase
    const cli = st.preloadClient || null
    preloadConsumedRef.current = true
    setItems([{
      id: `membership-${mp.membership_supabase_id}`,
      _cartKey: `membership-${mp.membership_supabase_id}`,
      _membershipPurchase: {
        membership_supabase_id: mp.membership_supabase_id,
        client_supabase_id: cli?.supabase_id || null,
      },
      service_id: null,
      inventory_item_id: null,
      name: `${lang === 'es' ? 'Membresía' : 'Membership'}: ${mp.nombre}`,
      price: Number(mp.price_dop) || 0,
      cost: 0,
      qty: 1,
      is_wash: 0,
      aplica_itbis: 1,
      no_commission: 1, // membership sale itself is not a service line for commission
    }])
    if (cli) setSelectedClient(cli)
    flash(lang === 'es'
      ? `Membresía cargada · cliente: ${cli?.name || cli?.nombre || ''}`
      : `Membership loaded · client: ${cli?.name || cli?.nombre || ''}`)
    // Clear the route state so a refresh doesn't re-inject.
    try { window.history.replaceState({}, '') } catch {}
  }, [location?.state, lang])

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
  // v2.14.20 — per-washer commission override (RD$). Map keyed by worker id.
  // Blank/zero = use auto-calc (empleado.comision_pct × base).
  const [workerOverrides, setWorkerOverrides] = useState({})
  const [salesperson, setSalesperson] = useState('')

  // Keep selected category in sync with DB categories
  useEffect(() => {
    if (categories.length > 0 && (category === null || !categories.find(c => c.id === category))) {
      setCategory(categories[0].id)
    }
  }, [categories])

  const allOrderItems = items
  const { subtotal, itbis, ley, total } = calcTotals(allOrderItems, itbisRate)
  const gridCols = collapsed ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'

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
    setWorkerOverrides({})
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
          setCobrarModal({ vehicle, items: allOrderItems, workers, workerOverrides, salesperson, clientId: selectedClient?.id || null, clientName: selectedClient?.name || rncName || '', client: selectedClient || null })
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

      // v2.14.25 — override input is each washer's SHARE of the ticket
      // (portion of service value they handled, ITBIS-inclusive). Commission
      // amount = share ÷ (1+itbis) × empleado.comision_pct / 100.
      // Sum of shares must equal shareTotalTarget or the UI blocks submit;
      // here we compute commission per washer from whatever shares exist.
      const _itbisFrac = (Number(itbisRate) || 18) / 100
      const washerOverrides = (workers.length >= 2)
        ? workers
            .map(w => {
              const share = Number(workerOverrides[w.id] || 0)
              const pct = Number(w.commission_pct ?? w.comision_pct ?? 0)
              const amount = share > 0 && pct > 0
                ? parseFloat(((share / (1 + _itbisFrac)) * (pct / 100)).toFixed(2))
                : 0
              return {
                empleado_supabase_id: w.supabase_id || null,
                amount,
              }
            })
            .filter(o => o.empleado_supabase_id && o.amount > 0)
        : []

      const result = await api.tickets.create({
        vehicle_plate:     vehicle.trim() || null,
        client_id:         selectedClient?.id || null,
        washer_ids:        workers.map(w => w.id),
        washer_commission_overrides: washerOverrides,
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
          weight:            s.weight ?? null,
          unit:              s.unit ?? null,
          price_per_unit:    s.price_per_unit ?? null,
          preparation_notes: s.preparation_notes || null, // v2.16.3 carnicería
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

      // v2.14.25 — override is share of ticket, not commission amount. See
      // handleEncolar for the math. Convert here too.
      const _itbisFracCb = (Number(itbisRate) || 18) / 100
      const washerOverridesCb = (pending.workers?.length >= 2 && pending.workerOverrides)
        ? pending.workers
            .map(w => {
              const share = Number(pending.workerOverrides[w.id] || 0)
              const pct = Number(w.commission_pct ?? w.comision_pct ?? 0)
              const amount = share > 0 && pct > 0
                ? parseFloat(((share / (1 + _itbisFracCb)) * (pct / 100)).toFixed(2))
                : 0
              return { empleado_supabase_id: w.supabase_id || null, amount }
            })
            .filter(o => o.empleado_supabase_id && o.amount > 0)
        : []
      const result = await api.tickets.create({
        vehicle_plate:    pending.vehicle,
        client_id:        pending.clientId || null,
        washer_ids:       pending.workers.map(w => w.id),
        washer_commission_overrides: washerOverridesCb,
        seller_id:        pending.salesperson || null,
        cajero_id:        (user?.id && user.id !== 'web') ? user.id : null,
        comprobante_type: paymentData.ncfType || 'E32',
        // v2.14.19 — pass the eNCF already reserved by CobrarModal so the
        // ticket row stores exactly what DGII received. Without this the
        // ticket's ncf column shows the NEXT sequence value (N+1) while
        // the actual eNCF sent to DGII was N — caused the off-by-one
        // seen on the first real E320000000018 sale.
        ncf:              paymentData.ecf?.eNCF || null,
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        payment_parts:    paymentData.payment_parts || null,
        split:            (paymentData.payment_parts?.length || 0) > 1,
        tipo_venta:       paymentData.tipo || 'contado',
        status:           paymentData.tipo === 'credito' ? 'pendiente' : 'cobrado',
        subtotal:         sub,
        itbis:            itp,
        ley:              ly,
        total:            netTotal,
        beverage_subtotal: beverageSubtotal,
        ecf_result:       paymentData.ecf || {},
        items:            pending.items.map((s, idx) => {
          // v2.16.1 patch (#2) — splice per-line stylist credit when the
          // salon CobrarModal returned a `lineStylists` array. Falls back to
          // null (commission writers will then credit the ticket-level seller
          // / washer as before, preserving non-salon behaviour).
          const ls = (paymentData.lineStylists || []).find(l => l.line_idx === idx)
          return {
            service_id:        s._isInventory ? null : (typeof s.id === 'number' ? s.id : null),
            inventory_item_id: s.inventory_item_id || null,
            name:              s.name,
            price:             s.price,  // always unit price
            cost:              s.cost || 0,
            is_wash:           s.is_wash ?? 1,
            quantity:           s.qty || 1,
            sku:               s.sku || null,
            aplica_itbis:      s.aplica_itbis ?? 1,
            empleado_supabase_id: ls?.empleado_supabase_id || null,
          }
        }),
        comentario: (Number(paymentData.descuento || 0) > 0 && paymentData.descuentoReason)
                     ? `[Descuento: ${paymentData.descuentoReason}] ${paymentData.comentario || ''}`.trim()
                     : (paymentData.comentario || ''),
        descuento:  Number(paymentData.descuento || 0),
        descuento_reason: paymentData.descuentoReason || null,
        mac_jti:    paymentData.mac_jti || null,
      })

      // v2.16.1 patch (#1) — consume any membership redemptions surfaced by
      // CobrarModal. The ticket is already booked; consume failures must NOT
      // roll back the cobro (audit ledger, not blocking). Surface a red toast
      // + Sentry log so the receptionist knows to manually decrement.
      const tsid = result?.supabase_id || result?.ticket_supabase_id || null
      const redemptions = paymentData.redemptions || []
      if (redemptions.length && tsid) {
        const consumeFn = (typeof window !== 'undefined' && window.electronAPI?.salon?.clientMemberships?.consume)
          ? window.electronAPI.salon.clientMemberships.consume
          : api?.salon?.clientMemberships?.consume || api?.clientMemberships?.consume
        if (consumeFn) {
          for (const r of redemptions) {
            try {
              const res = await consumeFn({
                client_membership_supabase_id: r.client_membership_supabase_id,
                ticket_supabase_id: tsid,
                appointment_supabase_id: paymentData.appointment_supabase_id || null,
              })
              if (res && res.ok === false) throw new Error(res.error || 'consume_failed')
            } catch (err) {
              console.error('[membership.consume] failed for', r, err)
              flash(lang === 'es'
                ? 'Membresía no se pudo descontar — anótalo manualmente'
                : 'Membership decrement failed — record manually')
              try { window?.Sentry?.captureException?.(err, { tags: { feature: 'salon_membership_consume' } }) } catch {}
            }
          }
        }
      }

      // v2.16.2 (Fix 1) — membership PURCHASE persistence. Cart lines flagged
      // `_membershipPurchase` are catalog templates being sold. After the
      // ticket books (so the e-CF + cash-drawer flow already ran), call
      // clientMemberships.purchase to create the persistent balance row.
      // Without this, paying RD$5,000 for "10 Cortes" cobraba pero NUNCA
      // creaba el saldo → cliente regresaba y "no tiene membresía".
      // Failures are non-blocking (the ticket is already booked) but loud:
      // red toast + Sentry so the receptionist creates the balance manually.
      const purchases = (pending.items || [])
        .filter(it => it && it._membershipPurchase && it._membershipPurchase.membership_supabase_id)
        .map(it => it._membershipPurchase)
      if (purchases.length && tsid) {
        const purchaseFn = (typeof window !== 'undefined' && window.electronAPI?.salon?.clientMemberships?.purchase)
          ? window.electronAPI.salon.clientMemberships.purchase
          : api?.salon?.clientMemberships?.purchase || api?.clientMemberships?.purchase
        if (purchaseFn) {
          for (const p of purchases) {
            const clientSid = p.client_supabase_id || pending.client?.supabase_id || null
            if (!clientSid) {
              flash(lang === 'es'
                ? 'Membresía cobrada pero sin cliente — saldo no creado'
                : 'Membership charged but no client — balance not created')
              continue
            }
            try {
              const res = await purchaseFn({
                client_supabase_id: clientSid,
                membership_supabase_id: p.membership_supabase_id,
                ticket_supabase_id: tsid,
              })
              if (res && res.ok === false) throw new Error(res.error || 'purchase_failed')
            } catch (err) {
              console.error('[membership.purchase] failed for', p, err)
              flash(lang === 'es'
                ? 'Saldo de membresía no creado — créalo manualmente'
                : 'Membership balance not created — create manually')
              try { window?.Sentry?.captureException?.(err, { tags: { feature: 'salon_membership_purchase' } }) } catch {}
            }
          }
        }
      }

      // Direct cobrar does NOT add to queue — the ticket is already cobrado.
      // Queue entries are only created by handleEncolar (pendiente → queue workflow).
      clearForm()
      flash(`${result?.docNumber || 'Ticket'} · ${lang === 'es' ? 'Cobrado ✓' : 'Charged ✓'}`)

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
          commercial_name: (cfg?.biz_commercial_name || '').trim(),
          settings: empresa?.settings || {},
        }
        const { subtotal: sub, itbis: itp, ley: ly, total: tot } = calcTotals(pending.items, itbisRate)
        // v2.14.20 — thread the applied discount into the printed receipt.
        // Was hardcoded to 0, so the printout always showed the full gross
        // total with no Descuento line even when the cashier applied one.
        const dscto = Number(paymentData.descuento || 0)
        const ticketData = {
          ncf:          result?.ncf       || '',
          ncfType:      paymentData.ncfType || 'E32',
          cajero:       user?.name         || '',
          lavador:      pending.workers?.map(w => w.name).join(', ') || '',
          docNo:        result?.docNumber  || '',
          paidAt:       new Date(),
          client:       pending.client     || null,
          // Client-name resolution chain (receipt + conduce de despacho):
          //   1. pending.client.name  — saved client picked from directory
          //   2. pending.clientName   — inline name typed at the POS screen
          //      (setCobrarModal passes this when selectedClient is null but
          //      the cashier entered a name via the quick-client input).
          //   3. paymentData.rncName  — DGII RNC lookup result from CobrarModal
          //   Printer treats 'Consumidor Final' as the true walk-in case only.
          client_name:  pending.client?.name || pending.clientName || paymentData.rncName || '',
          client_rnc:   pending.client?.rnc  || paymentData.rnc    || '',
          rncName:      paymentData.rncName  || pending.clientName || '',
          rnc:          paymentData.rnc      || '',
          vehiclePlate: pending.vehicle    || '',
          tipo:         paymentData.tipo   || 'contado',
          formaPago:    paymentData.formaPago || 'cash',
          payment_parts: paymentData.payment_parts || null,
          services:     pending.items,
          subtotal:     sub,
          descuento:    dscto,
          itbis:        itp,
          ley:          ly,
          total:        parseFloat((tot - dscto).toFixed(2)),
          biz,
          signatureDate: paymentData.ecf?.signatureDate || null,
          securityCode:  paymentData.ecf?.securityCode || null,
          qrLink:        paymentData.ecf?.qrLink || null,
          // v2.14.34 — pre-compute total commission so the factura's optional
          // "Comisión" line (Personalización de Recibo toggle) shows the right
          // amount. Same math as the per-washer conduce loop below.
          commTotal: (() => {
            const itbisFracPre = (Number(itbisRate) || 18) / 100
            const washerBasePre = pending.items
              .filter(s => (s.is_wash ?? 1) !== 0)
              .reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 1), 0) / (1 + itbisFracPre)
            const workersPre = (pending.workers?.length ? pending.workers : [])
            return parseFloat(workersPre.reduce((acc, w) => {
              const share = Number(pending.workerOverrides?.[w.id] || 0)
              const pct = Number(w.commission_pct ?? w.comision_pct ?? 0)
              const amt = share > 0 && pct > 0
                ? (share / (1 + itbisFracPre)) * (pct / 100)
                : (washerBasePre * pct / 100)
              return acc + amt
            }, 0).toFixed(2))
          })(),
          cfg,
        }
        // v2.14.34 — await factura BEFORE conduce loop so the printer queues
        // FACTURA first then CONDUCE. Previously fire-and-forget meant the
        // sequential conduce awaits hit the queue first.
        if (cfg.print_factura_auto === '1') {
          await printClientReceipt(ticketData).catch(() => flash(lang === 'es' ? 'Error al imprimir factura' : 'Print error: invoice'))
        }
        // v2.16.3 carnicería — kitchen prep slip if any line carries notes.
        // Falls back to inline COCINA block on the same receipt when no
        // dedicated kitchen printer is configured (graceful degradation).
        if (isCarniceria && ticketData.items?.some(i => (i.preparation_notes || '').trim())) {
          try {
            const r = await printKitchenPrepSlip(ticketData, cfg, api)
            if (r?.fallback === 'inline') {
              flash(lang === 'es' ? 'Notas de cocina impresas en recibo principal' : 'Kitchen notes printed on main receipt')
            }
          } catch {}
        }
        // v2.14.20 — when a ticket has 2+ washers, print one conduce per
        // washer so each worker walks away with their own dispatch slip.
        // Sequential so the printer queues them in order.
        if (cfg.print_conduce_auto === '1') {
          const workers = (pending.workers?.length ? pending.workers : [{ name: ticketData.lavador || '-' }])
          // v2.14.20 — each conduce shows the commission THIS lavador earned.
          // Priority: cashier's per-washer override > empleado.comision_pct
          // × washerBase (gross-of-ITBIS stripped out at 1 + itbisFactor).
          const itbisFrac = (Number(itbisRate) || 18) / 100
          const washerBase = pending.items
            .filter(s => (s.is_wash ?? 1) !== 0)
            .reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 1), 0) / (1 + itbisFrac)
          // v2.14.34 — derive each washer's SHARE of the wash work (0..1).
          // If per-worker share overrides exist (gross RD$ amount typed by
          // cashier), use those as proportions. Else even split across N
          // workers. Used to scale per-washer service line prices on the
          // conduce so each slip shows that washer's portion only (RD$300
          // each on a 50/50 RD$600 service, not RD$600 on every conduce).
          const overrides = workers.map(w => Number(pending.workerOverrides?.[w.id] || 0))
          const overrideSum = overrides.reduce((a, b) => a + b, 0)
          const useOverrideShares = overrideSum > 0
          for (let i = 0; i < workers.length; i++) {
            const w = workers[i]
            // v2.14.25 — override is a SHARE (gross, ITBIS-incl). Convert
            // to commission: share / (1+itbis) × pct / 100. Falls back to
            // whole washerBase × pct when no per-worker share is set.
            const shareOverride = overrides[i]
            const pct = Number(w.commission_pct ?? w.comision_pct ?? 0)
            const overrideAmt = shareOverride > 0 && pct > 0
              ? parseFloat(((shareOverride / (1 + itbisFrac)) * (pct / 100)).toFixed(2))
              : 0
            const commAmount = overrideAmt > 0
              ? overrideAmt
              : parseFloat((washerBase * pct / 100).toFixed(2))
            const myShare = useOverrideShares
              ? (shareOverride / overrideSum)
              : (1 / workers.length)
            const scaledServices = (ticketData.services || []).map(s => {
              const isWash = (s.is_wash ?? (s.c !== false ? 1 : 0)) !== 0
              if (!isWash) return s
              return {
                ...s,
                price: parseFloat((Number(s.price || 0) * myShare).toFixed(2)),
                itbis: s.itbis != null ? parseFloat((Number(s.itbis || 0) * myShare).toFixed(2)) : s.itbis,
              }
            })
            await printWasherConduce({ ...ticketData, services: scaledServices, lavador: w.name || '-', commAmount })
              .catch(() => flash(lang === 'es' ? 'Error al imprimir conduce' : 'Print error: conduce'))
          }
        }
        // Save PDF copy to userData/receipts/
        saveReceiptPDF(ticketData).catch(() => flash(lang === 'es' ? 'Error al guardar PDF' : 'PDF save error'))
        // Kick drawer for cash/check payments — also fires when a Mixto split
        // contains a cash or cheque part (cashier still receives bills).
        const fm = paymentData.formaPago || ''
        const partMethods = (paymentData.payment_parts || []).map(p => p?.method || '')
        const hasCashLike = ['efectivo', 'cash', 'cheque'].includes(fm) || partMethods.some(m => ['efectivo', 'cash', 'cheque'].includes(m))
        if (paymentData.tipo !== 'credito' && hasCashLike) {
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

        {/* Category tabs — horizontal scroll on mobile. v2.14.20: reorder
            pencil lives in a PINNED right-rail so it never gets lost in the
            horizontal overflow when there are many categories. */}
        <div className="flex items-center border-b border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 shrink-0">
          <div className="flex-1 min-w-0 flex items-center overflow-x-auto scrollbar-hide">
            {svcLoading ? (
              <div className="flex gap-1 px-4 py-2">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-8 w-20 bg-slate-100 dark:bg-white/10 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => { if (!reorderMode) setCategory(cat.id) }}
                disabled={reorderMode && category !== cat.id}
                className={`px-4 md:px-5 py-3 md:py-3.5 text-xs md:text-sm font-semibold transition-colors border-b-2 -mb-px shrink-0 min-h-[44px] ${
                  category === cat.id
                    ? 'border-[#b3001e] text-[#b3001e] dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/30 disabled:opacity-40'
                }`}
              >
                {categories.length === 1 ? (lang === 'es' ? 'Todos' : 'All') : catLabel(cat.label, lang)}
              </button>
            ))}
          </div>
          {/* Pinned right rail — visible regardless of category overflow. */}
          {canReorderTiles && !svcLoading && category && (
            <div className="shrink-0 flex items-center gap-1 pl-2 pr-2 border-l border-slate-200 dark:border-white/10">
              {!reorderMode ? (
                <button
                  onClick={() => {
                    setReorderDraft([...(servicesByCategory[category] ?? [])])
                    setReorderMode(true)
                  }}
                  title={lang === 'es' ? 'Reordenar servicios' : 'Reorder services'}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-slate-500 dark:text-white/60 hover:text-[#b3001e] hover:bg-[#b3001e]/10 transition-colors"
                >
                  <Edit2 size={13} />
                  <span className="hidden md:inline">{lang === 'es' ? 'Reordenar' : 'Reorder'}</span>
                </button>
              ) : (
                <>
                  <button
                    disabled={savingOrder}
                    onClick={async () => {
                      setSavingOrder(true)
                      try {
                        const svcOnly = reorderDraft.filter(x => !x._isInventory)
                        const results = await Promise.all(svcOnly.map((s, i) =>
                          api?.services?.update?.({ id: s.id, sort_order: i + 1 })
                            .then(() => ({ ok: true }))
                            .catch(err => ({ ok: false, err }))
                        ))
                        const failed = results.filter(r => !r.ok)
                        if (failed.length) {
                          console.error('[reorder] failed writes:', failed)
                          flash(lang === 'es' ? `Error al guardar (${failed.length} servicios)` : `Error saving (${failed.length} services)`)
                        } else {
                          await reloadServices?.()
                          flash(lang === 'es' ? 'Orden guardado ✓' : 'Order saved ✓')
                          setReorderMode(false)
                        }
                      } catch (e) {
                        console.error('[reorder] save error:', e)
                        flash(lang === 'es' ? 'Error al guardar orden' : 'Error saving order')
                      }
                      setSavingOrder(false)
                      setDragTileIdx(null)
                    }}
                    className="px-2.5 py-1.5 rounded-md text-[11px] font-bold text-white bg-[#b3001e] hover:bg-[#b3001e]/90 disabled:opacity-50 transition-colors"
                  >
                    {savingOrder ? (lang === 'es' ? 'Guardando…' : 'Saving…') : (lang === 'es' ? 'Guardar' : 'Save')}
                  </button>
                  <button
                    disabled={savingOrder}
                    onClick={() => { setReorderMode(false); setDragTileIdx(null) }}
                    className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors"
                  >
                    {lang === 'es' ? 'Cancelar' : 'Cancel'}
                  </button>
                </>
              )}
            </div>
          )}
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
              {(reorderMode ? reorderDraft : (servicesByCategory[category] ?? [])).map((svc, idx) => {
                const key = svc._isInventory ? 'inv:' + svc.id : svc.id
                const selected = !reorderMode && selectedIds.has(key)
                const cartItem = !reorderMode && svc._isInventory ? items.find(i => i._cartKey === key) : null
                const dragging = reorderMode && dragTileIdx === idx
                return (
                  <button
                    key={key}
                    onClick={() => { if (!reorderMode) toggleService(svc) }}
                    draggable={reorderMode && !svc._isInventory}
                    onDragStart={reorderMode ? () => setDragTileIdx(idx) : undefined}
                    onDragOver={reorderMode ? (e) => { e.preventDefault() } : undefined}
                    onDrop={reorderMode ? (e) => {
                      e.preventDefault()
                      if (dragTileIdx === null || dragTileIdx === idx) { setDragTileIdx(null); return }
                      setReorderDraft(prev => {
                        const next = [...prev]
                        const [m] = next.splice(dragTileIdx, 1)
                        next.splice(idx, 0, m)
                        return next
                      })
                      setDragTileIdx(null)
                    } : undefined}
                    className={`group relative overflow-hidden flex flex-col justify-between p-4 md:p-5 rounded-2xl border text-left transition-all duration-200 ease-out min-h-[124px] md:min-h-[132px] will-change-transform ${
                      reorderMode
                        ? `${svc._isInventory ? 'opacity-40 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${dragging ? 'opacity-40' : ''} border-dashed border-[#b3001e]/40 bg-white dark:bg-white/[0.03] hover:border-[#b3001e]`
                        : selected
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

        {/* FIX 5.4 — 72h deferred DGII banner (carwash) */}
        <DeferredEcfBanner lang={lang} />
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
                  <p className="text-[12px] font-semibold text-sky-800 dark:text-sky-200 truncate flex items-center gap-1.5">
                    <span className="truncate">{selectedClient.name}</span>
                    <LoyaltyTierBadge tier={selectedClient.loyalty_tier} lang={lang} />
                  </p>
                  <p className="text-[10px] text-sky-500 dark:text-sky-400">
                    {selectedClient.rnc ? `${selectedClient.rnc} · ` : ''}
                    {Math.max(0, Math.round(Number(selectedClient.loyalty_points) || 0)).toLocaleString()} pts
                  </p>
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
              <PlateLookup
                value={vehicle}
                onChange={setVehicle}
                onPick={(v) => {
                  setVehicle((v.plate || '').toUpperCase())
                  if (v.client_id && clients) {
                    const c = clients.find(c => c.id === v.client_id)
                    if (c) setSelectedClient(c)
                  }
                  flash(lang === 'es'
                    ? `Vehículo encontrado · ${v.plate}${v.client_name ? ' · ' + v.client_name : ''}`
                    : `Vehicle found · ${v.plate}${v.client_name ? ' · ' + v.client_name : ''}`)
                }}
                placeholder={t('pos_vehicle_placeholder')}
                api={api}
                lang={lang}
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
                <WorkerSelect
                  selected={workers}
                  onChange={setWorkers}
                  overrides={workerOverrides}
                  onOverrideChange={(id, val) => setWorkerOverrides(prev => ({ ...prev, [id]: val }))}
                  shareTotalTarget={allOrderItems
                    .filter(s => (s.is_wash ?? 1) !== 0)
                    .reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 1), 0)}
                  itbisFrac={(Number(itbisRate) || 18) / 100}
                  washers={rawWashers}
                  t={t} businessType={businessType} lang={lang}
                />
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
                  setCobrarModal({ vehicle, items: allOrderItems, workers, workerOverrides, salesperson, clientId: selectedClient?.id || null, clientName: selectedClient?.name || rncName || '', client: selectedClient || null })
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
        <PaymentErrorBoundary onClose={() => setCobrarModal(null)}>
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
        </PaymentErrorBoundary>
      )}

    </div>
  )
}

// ── Pedidos Ya wordmark ───────────────────────────────────────────────────────
// Inline SVG reproduction — sunrise arc over the "Y", Pedidos Ya pink (#FA0050)
// as default, accepts a color prop so it can render on white (pink) or red (white).
function PedidosYaWordmark({ color = '#FA0050', height = 16 }) {
  return (
    <svg viewBox="0 0 140 24" height={height} style={{ height, width: 'auto' }} aria-label="PedidosYa">
      {/* Sunrise arc over the Y (positions 96-114 cover the Y glyph) */}
      <path d="M 100 6 A 5 5 0 0 1 110 6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <text
        x="0" y="20"
        fill={color}
        style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontWeight: 900, fontSize: '20px', fontStyle: 'italic', letterSpacing: '-0.5px' }}
      >PedidosYa</text>
    </svg>
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
  const { businessType, isRetail, isHybrid, isMechanic, isDealership, isLicoreria, licoreriaConfig, isCarniceria, hasFeature: hasBizFeature } = useBusinessType()
  // v2.11 — Tienda subtype feature gates. `hasBizFeature()` returns the
  // effective feature state honoring the tienda_subtype preset + any owner
  // override. Falls back to legacy isLicoreria behavior for un-migrated tenants.
  const ageVerificationEnabled = hasBizFeature('age_verification')
  const pedidosYaEnabled       = hasBizFeature('pedidos_ya')
  const bottleDepositEnabled   = hasBizFeature('bottle_deposit')
  const { hasFeature } = usePlan()

  // ── v2.7.1 — Multi-device ticket locks (Pro MAX) ───────────────────────────
  // Reserve inventory on addToCart so two cashiers can't oversell the last
  // bottle. Degrades silently when `multi_location` feature is unavailable
  // (lower plans) or Supabase is unreachable — cashier is never blocked.
  const lockingEnabled = hasFeature('multi_location')
  const deviceIdRef = useRef(null)
  if (!deviceIdRef.current) { try { deviceIdRef.current = getDeviceId() } catch { deviceIdRef.current = null } }
  const [otherLockedByItem, setOtherLockedByItem] = useState({})  // { [item_supabase_id]: qty }

  async function refreshLockForItem(itemSid) {
    if (!lockingEnabled || !itemSid) return
    try {
      const bid = getBusinessId?.()
      if (!bid) return
      const qty = await activeLocksQty(bid, itemSid, deviceIdRef.current)
      setOtherLockedByItem(prev => {
        if ((prev[itemSid] || 0) === qty) return prev
        const next = { ...prev }
        if (qty > 0) next[itemSid] = qty; else delete next[itemSid]
        return next
      })
    } catch {}
  }

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

  // Re-validation gate: block "Cobrar" if any cart line is age-restricted
  // (per the live config, not the stale flag stamped at add-to-cart time)
  // and the ticket has no verification yet. Pure logic lives in
  // pos/licoreria-helpers.js so it's testable and reusable.
  function ensureAgeVerifiedForCart(items) {
    const result = licCheckAgeGate({
      items, ageVerificationEnabled, ageVerified, licoreriaConfig,
    })
    if (result.ok) return true
    if (result.reason === 'pending') setPendingAgeItem(result.item)
    return false
  }
  const [quickSells, setQuickSells]         = useState([])
  // v2.6 — Licoreria: Devolución de envases modal (bottle-return refunds).
  const [depositReturnOpen, setDepositReturnOpen] = useState(false)
  const [depositReturnToast, setDepositReturnToast] = useState(null)

  // Services for hybrid mode (services tab)
  const { data: rawServicesDB } = useServices()
  const rawServices = rawServicesDB || []

  // ── UI state
  const [cart, setCart] = useState([])        // { id, inventory_item_id, service_id, sku, name, price, cost, qty, aplica_itbis }
  const [toast, setToast] = useState(null)
  const [cobrarModal, setCobrarModal] = useState(null)
  const [tab, setTab] = useState('products')  // 'products' | 'services'
  // v2.16.10 — Ofertas (bundle promos). Pro PLUS+ only. Live list of active
  // bundles, refreshed on mount and after each ticket close.
  const ofertasEnabled = hasFeature('ofertas')
  const [ofertas, setOfertas] = useState([])
  useEffect(() => {
    if (!ofertasEnabled) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await api?.ofertas?.list?.({ activeOnly: true })
        if (!cancelled) setOfertas(Array.isArray(rows) ? rows : [])
      } catch { if (!cancelled) setOfertas([]) }
    })()
    return () => { cancelled = true }
  }, [api, ofertasEnabled])
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
  // v2.11 — gate Pedidos Ya on the tienda subtype feature flag so a
  // farmacia / ferretería / boutique owner doesn't see the delivery
  // toolbar. Retail/licoreria tenants without a subtype yet fall back to
  // the legacy "visible for any retail-style vertical" behavior via
  // hasBizFeature()'s isLicoreria fallback — safe for un-migrated tenants.
  const pyAvailable = (isRetail || isLicoreria) && pedidosYaEnabled
  const [pyMode, setPyMode] = useState(false)

  // ── v2.5 — Per-client inventory overrides ────────────────────────────────
  // Fetched on client change. Precedence (highest → lowest):
  //   clientOverride > pyMode ? price_pedidos_ya : null > price
  // Client override ALWAYS wins (mayorista price beats PY promo pricing).
  // Inactive clients never apply overrides; inactive items excluded from list.
  const [clientItemOverrides, setClientItemOverrides] = useState({})
  useEffect(() => {
    const cid = selectedClient?.id
    if (!cid || selectedClient?.active === 0) { setClientItemOverrides({}); return }
    let cancelled = false
    const webKey = typeof window !== 'undefined' && !window.electronAPI
    const params = webKey ? { clientSupabaseId: selectedClient.supabase_id || cid } : { clientId: cid }
    api?.clientItemPrices?.list?.(params)
      .then(rows => {
        if (cancelled) return
        const map = {}
        for (const r of (rows || [])) {
          if (r.item_active === 0) continue
          const key = r.inventory_item_supabase_id
          const p   = Number(r.custom_price)
          if (key && Number.isFinite(p) && p > 0) map[key] = p
        }
        setClientItemOverrides(map)
      })
      .catch(() => { if (!cancelled) setClientItemOverrides({}) })
    return () => { cancelled = true }
  }, [api, selectedClient?.id, selectedClient?.supabase_id, selectedClient?.active])

  function effectivePrice(product) {
    if (!product) return 0
    const base = Number(product.price || 0)
    const ov = clientItemOverrides[product.supabase_id]
    if (ov != null) return ov
    if (!pyMode) return base
    const py = product.price_pedidos_ya
    return (py != null && py !== '' && Number.isFinite(Number(py))) ? Number(py) : base
  }

  useEffect(() => {
    api.clients?.all?.().then(r => setClients(r || [])).catch(() => {})
  }, [api])

  // ── v2.7.1 — Lock housekeeping + realtime subscription ─────────────────────
  useEffect(() => {
    if (!lockingEnabled) return
    const bid = getBusinessId?.()
    const did = deviceIdRef.current
    if (!bid || !did) return
    sweepExpired(did).catch(() => {})
    const unsub = subscribeLocks(bid, did, (_evt, row) => {
      const sid = row?.inventory_item_supabase_id
      if (!sid) return
      activeLocksQty(bid, sid, did).then(qty => {
        setOtherLockedByItem(prev => {
          if ((prev[sid] || 0) === qty) return prev
          const next = { ...prev }
          if (qty > 0) next[sid] = qty; else delete next[sid]
          return next
        })
        const inCart = cartRef.current?.find?.(i => i._clientOverrideKey === sid)
        if (inCart) {
          const stock = Number(inCart.stock ?? Infinity)
          if (stock !== Infinity && (inCart.qty || 1) + qty > stock) {
            flash(lang === 'es'
              ? `⚠️ Otra caja también tiene "${inCart.name}" en su ticket.`
              : `⚠️ Another register also has "${inCart.name}" on their ticket.`)
          }
        }
      }).catch(() => {})
    })
    return () => { try { unsub?.() } catch {} }
  }, [lockingEnabled, lang])

  // Stable ref so the realtime callback can read the latest cart cheaply.
  const cartRef = useRef(cart)
  useEffect(() => { cartRef.current = cart }, [cart])

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

  // v2.16.4 — fold carnicería active discounts into a list of lines.
  // Pure: same input → same output. Reused by `finalLineItems` AND by every
  // ticket-create call site so subtotal/ITBIS and the persisted ticket_items
  // rows agree on the post-discount price.
  function applyCarniceriaDiscounts(lines) {
    if (!isCarniceria) return lines
    return lines.map(it => {
      const sid = it.inventory_item_supabase_id
      const d = sid ? discountByItemSid[sid] : null
      if (!d) return it
      const qty = it.weight != null ? Number(it.weight) : (it.qty || 1)
      const unitPriceBefore = it.weight != null && it.price_per_unit ? Number(it.price_per_unit) : Number(it.price)
      const r = applyDiscountToLine({ unitPrice: unitPriceBefore, qtyOrWeight: qty, discount: d })
      return {
        ...it,
        price: it.weight != null ? r.lineSubtotalAfter : r.unitPriceAfter,
        price_per_unit: it.weight != null ? r.unitPriceAfter : it.price_per_unit,
        _discount: d,
        _discountAmount: r.discountAmount,
        _originalPrice: it.weight != null ? Math.round(unitPriceBefore * qty * 100) / 100 : unitPriceBefore,
        // Persisted on ticket_items via the existing pipeline so receipts and
        // 606 reports show the rebate.
        discount_pct: Number(d.pct) || 0,
        discount_source: d.source,
      }
    })
  }

  // Totals include auto-generated bottle-deposit lines so the cashier sees
  // the real number *before* the CobrarModal opens.
  const finalLineItems = useMemo(
    () => applyCarniceriaDiscounts(expandCartWithDeposits(cart)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, isLicoreria, licoreriaConfig, isCarniceria, discountByItemSid]
  )
  const { subtotal, itbis, total } = calcTotals(finalLineItems, itbisRate)
  const carniceriaDiscountTotal = useMemo(() => {
    if (!isCarniceria) return 0
    return finalLineItems.reduce((s, l) => s + (Number(l._discountAmount) || 0), 0)
  }, [isCarniceria, finalLineItems])
  const cartCount = cart.reduce((s, i) => s + (i.qty || 1), 0)
  const bottleDepositTotal = useMemo(() => {
    if (!isLicoreria) return 0
    return cart.reduce((s, i) => s + Number(i.bottle_deposit || 0) * (i.qty || 1), 0)
  }, [cart, isLicoreria])

  // v2.16.3/4 — Carnicería: pre-pack vs at-moment mode + prep notes + discounts.
  const [carniceriaMode, setCarniceriaMode] = useState('at_moment') // 'prepacked' | 'at_moment'
  const [seasonalActive, setSeasonalActive] = useState([])
  const [seasonalDismissed, setSeasonalDismissed] = useState(false)
  // Active-discount map keyed by inventory item supabase_id.
  // { [item_supabase_id]: { source, pct, label, banner_text, season_key } | null }
  const [discountByItemSid, setDiscountByItemSid] = useState({})
  useEffect(() => {
    if (!isCarniceria) return
    setSeasonalActive(activeSeasons(new Date()))
    // Hydrate the scale registry from carniceria_scales so multi-scale
    // hot-swap works on POS without a restart. Re-runs cheaply on focus.
    const hydrate = async () => {
      try {
        const rows = await api?.carniceria?.scales?.list?.() || []
        ScaleRegistry.hydrate(rows)
      } catch {}
    }
    hydrate()
    const onFocus = () => hydrate()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isCarniceria, api])

  // v2.16.4 — Carnicería: re-fetch active discounts whenever the cart's
  // inventory items change. Keeps the lookup small (only items in cart) and
  // refreshes when the cashier adds/removes lines.
  useEffect(() => {
    if (!isCarniceria) { setDiscountByItemSid({}); return }
    const itemSids = Array.from(new Set(
      cart.map(i => i.inventory_item_supabase_id).filter(Boolean)
    ))
    if (itemSids.length === 0) { setDiscountByItemSid({}); return }
    let cancelled = false
    ;(async () => {
      try {
        const map = await api?.carniceria?.discounts?.activeFor?.(itemSids) || {}
        if (cancelled) return
        const picked = {}
        for (const sid of itemSids) {
          picked[sid] = pickBestDiscount(map[sid] || []) || null
        }
        setDiscountByItemSid(picked)
      } catch { if (!cancelled) setDiscountByItemSid({}) }
    })()
    return () => { cancelled = true }
    // Use the joined sid list as the dep so we don't refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCarniceria, cart.map(i => i.inventory_item_supabase_id || '').join(','), api])
  // v2.16.3 — Mayoreo pre-arm hook. MayoreoOrders writes items_json into
  // localStorage and navigates to /pos; consume on mount and add to cart.
  useEffect(() => {
    if (!isCarniceria) return
    try {
      const raw = localStorage.getItem('tx_prearm_cart')
      if (!raw) return
      const items = JSON.parse(raw)
      if (Array.isArray(items) && items.length) {
        setCart(prev => [
          ...prev,
          ...items.map((it, idx) => ({
            id: `prearm-${Date.now()}-${idx}`,
            inventory_item_id: null,
            service_id: null,
            sku: '',
            name: `${it.name} (${it.qty} ${it.unit || 'lb'})`,
            price: Number(it.qty) * Number(it.price_per_unit || 0) || 0,
            cost: 0,
            qty: 1,
            weight: Number(it.qty) || 0,
            unit: it.unit || 'lb',
            price_per_unit: Number(it.price_per_unit || 0),
            aplica_itbis: 1,
            is_wash: 0,
          })),
        ])
        flash(lang === 'es' ? 'Pedido pre-armado' : 'Order pre-armed')
      }
      localStorage.removeItem('tx_prearm_cart')
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCarniceria])

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
    // v2.7.1 — release every lock this device holds (fire-and-forget).
    if (lockingEnabled) {
      const bid = getBusinessId?.()
      const did = deviceIdRef.current
      if (bid && did) releaseAll(bid, did).catch(() => {})
    }
    // v2.16.10 — refresh ofertas availability after each ticket close.
    if (ofertasEnabled) {
      api?.ofertas?.list?.({ activeOnly: true })
        .then(rows => setOfertas(Array.isArray(rows) ? rows : []))
        .catch(() => {})
    }
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
      // Client override still wins over PY. Only reprice PY on non-override lines.
      const ov = it._clientOverrideKey ? clientItemOverrides[it._clientOverrideKey] : undefined
      if (ov != null) return it
      const next = pyMode && it._pyPrice != null ? it._pyPrice : it._basePrice
      if (Number(it.price) === Number(next)) return it
      return { ...it, price: next, _py: pyMode && it._pyPrice != null }
    }))
  }, [pyMode])

  // ── v2.5 — Client-change reprice ─────────────────────────────────────────
  // When the selected client changes (or overrides load after selection),
  // re-apply pricing to every inventory line in the cart. Cashier-edited
  // lines (`_priceEdited`) are locked. Service lines aren't touched — their
  // override flow lives in `client_service_rates` via the carwash path.
  useEffect(() => {
    setCart(prev => prev.map(it => {
      if (it._priceEdited) return it
      if (it._basePrice == null) return it
      if (!it._clientOverrideKey && !it.inventory_item_id) return it
      const key = it._clientOverrideKey
      const ov  = key ? clientItemOverrides[key] : undefined
      if (ov != null) {
        if (Number(it.price) === Number(ov) && it._clientPrice) return it
        return { ...it, price: Number(ov), _clientPrice: true, _py: false }
      }
      // No override — fall back to PY (if toggle on) else base.
      const next = pyMode && it._pyPrice != null ? it._pyPrice : it._basePrice
      if (Number(it.price) === Number(next) && !it._clientPrice) return it
      return { ...it, price: next, _clientPrice: false, _py: pyMode && it._pyPrice != null }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id, clientItemOverrides])

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
    if (ageVerificationEnabled && !ageVerified && requiresAgeCheck(licoreriaConfig, product)) {
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
      const clientOverride = clientItemOverrides[product.supabase_id]
      const hasOverride = clientOverride != null
      // Precedence: client override > PY > base.
      const usedPrice = hasOverride ? clientOverride : (pyMode && pyPrice != null ? pyPrice : basePrice)
      return [...prev, {
        id: `inv-${product.id}`,
        inventory_item_id: product.id,
        service_id: null,
        sku: product.sku || product.barcode || '',
        name: product.name,
        price: usedPrice,
        _basePrice: basePrice,
        _pyPrice: pyPrice,
        _clientPrice: hasOverride,
        _clientOverrideKey: product.supabase_id || null,
        _py: !hasOverride && pyMode && pyPrice != null,
        cost: product.cost || 0,
        qty: 1,
        aplica_itbis: product.aplica_itbis ?? 1,
        is_wash: 0,
        stock: product.quantity,
        // Licorería metadata — bottle deposit flows through to the ticket line
        // as a separate synthetic item in handlePaymentConfirm().
        bottle_deposit: Number(product.bottle_deposit || 0) || 0,
        age_restricted: ageVerificationEnabled ? requiresAgeCheck(licoreriaConfig, product) : false,
      }]
    })
    if (stockCapped) flash(lang === 'es' ? `Stock maximo (${nextQty}) — ${product.name}` : `Max stock (${nextQty}) — ${product.name}`)
    else if (stackedExisting) flash(`${product.name} × ${nextQty}`)
    else flash(lang === 'es' ? `${product.name} agregado` : `${product.name} added`)

    // v2.7.1 — Multi-device lock: reserve this unit on Supabase and surface
    // other-device reservations so the cashier knows real-time availability.
    if (lockingEnabled && product?.supabase_id && !stockCapped) {
      const bid = getBusinessId?.()
      const did = deviceIdRef.current
      if (bid && did) {
        ;(async () => {
          try {
            const other = await activeLocksQty(bid, product.supabase_id, did)
            const stock = Number(product.quantity ?? Infinity)
            const remaining = Math.max(0, stock - other)
            if (other > 0) {
              setOtherLockedByItem(prev => ({ ...prev, [product.supabase_id]: other }))
            }
            if (nextQty + other > stock && stock !== Infinity) {
              flash(lang === 'es'
                ? `⚠️ Otra caja está cobrando este producto. Quedan solo ${remaining} disponibles.`
                : `⚠️ Another register is charging this item. Only ${remaining} left.`)
            }
            await acquireLock(bid, product.supabase_id, did, nextQty)
          } catch {}
        })()
      }
    }
  }

  // ── v2.16.10 — Ofertas (bundle promos) ────────────────────────────────────
  // Click an active oferta tile → push N component lines + 1-2 discount lines
  // (split across taxable vs exempt) so ITBIS math stays correct. Every line
  // shares an `oferta_group_id` so the cart can render them grouped and remove
  // the whole group when the cashier deletes any line. Persists via
  // `oferta_supabase_id` on each ticket_item.
  function addOfertaToCart(oferta) {
    if (!oferta) return
    const components = (oferta.items || [])
    if (components.length === 0) {
      flash(lang === 'es' ? 'Oferta sin componentes' : 'Bundle has no components')
      return
    }
    // Available units already accounts for inventory quantity. Reduce by what
    // other oferta groups in cart already consume from the same components.
    const pendingByComponent = {}
    for (const line of cart) {
      if (!line.oferta_group_id) continue
      const key = line._clientOverrideKey || line.inventory_item_supabase_id
      if (key) pendingByComponent[key] = (pendingByComponent[key] || 0) + Number(line.qty || 0)
    }
    let blockedComponent = null
    for (const c of components) {
      const key = c.inventory_item_supabase_id
      if (!key) continue // services don't decrement stock
      const have = Number(c.available_units ?? Infinity)
      const used = pendingByComponent[key] || 0
      if (have - used < Number(c.qty || 1)) { blockedComponent = c; break }
    }
    const liveAvailable = Number(oferta.oferta_available ?? 0)
    if (liveAvailable < 1 || blockedComponent) {
      const name = blockedComponent?.name || components[0]?.name || ''
      flash(lang === 'es' ? `Sin stock — falta ${name}` : `Out of stock — missing ${name}`)
      return
    }

    const groupId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `og-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const newLines = []
    let subtotal = 0
    let taxableSub = 0
    for (const c of components) {
      const qty = Number(c.qty || 1)
      const basePrice = Number(c.base_price || 0)
      const aplica = c.aplica_itbis ?? 1
      const lineSub = basePrice * qty
      subtotal += lineSub
      if (aplica) taxableSub += lineSub
      newLines.push({
        id: `oferta-${groupId}-${c.service_supabase_id || c.inventory_item_supabase_id || newLines.length}`,
        inventory_item_id: null,
        inventory_item_supabase_id: c.inventory_item_supabase_id || null,
        service_id: null,
        service_supabase_id: c.service_supabase_id || null,
        _clientOverrideKey: c.inventory_item_supabase_id || null,
        sku: '',
        name: c.name,
        price: basePrice,
        cost: 0,
        qty,
        aplica_itbis: aplica,
        is_wash: 0,
        oferta_supabase_id: oferta.supabase_id,
        oferta_group_id: groupId,
        oferta_name: oferta.name,
      })
    }
    const ofertaPrice = Number(oferta.price || 0)
    const discountTotal = ofertaPrice - subtotal // negative when oferta saves money
    if (discountTotal !== 0 && subtotal > 0) {
      const taxableShare = taxableSub / subtotal
      const discountTaxable = Number((discountTotal * taxableShare).toFixed(2))
      const discountExempt = Number((discountTotal - discountTaxable).toFixed(2))
      const baseDiscount = {
        inventory_item_id: null,
        service_id: null,
        sku: '',
        cost: 0,
        qty: 1,
        is_wash: 0,
        _ofertaDiscount: true,
        oferta_supabase_id: oferta.supabase_id,
        oferta_group_id: groupId,
        oferta_name: oferta.name,
      }
      if (discountTaxable !== 0) {
        newLines.push({
          ...baseDiscount,
          id: `oferta-disc-tx-${groupId}`,
          name: `${lang === 'es' ? 'Descuento Oferta' : 'Bundle discount'}: ${oferta.name}`,
          price: discountTaxable,
          aplica_itbis: 1,
        })
      }
      if (discountExempt !== 0) {
        newLines.push({
          ...baseDiscount,
          id: `oferta-disc-ex-${groupId}`,
          name: discountTaxable !== 0
            ? `${lang === 'es' ? 'Descuento Oferta (ex.)' : 'Bundle discount (ex.)'}: ${oferta.name}`
            : `${lang === 'es' ? 'Descuento Oferta' : 'Bundle discount'}: ${oferta.name}`,
          price: discountExempt,
          aplica_itbis: 0,
        })
      }
    }
    setCart(prev => [...prev, ...newLines])
    flash(lang === 'es' ? `Oferta agregada: ${oferta.name}` : `Bundle added: ${oferta.name}`)
  }

  // Expand cart → final line items, appending synthetic bottle-deposit lines
  // for licoreria. Each deposit line is non-ITBIS, qty-matched, and carries a
  // `bottle_deposit: true` flag so printer / PDF / reports can segregate it.
  // Pure helper now lives in pos/licoreria-helpers.js — closure here just
  // forwards the live config + lang.
  function expandCartWithDeposits(items) {
    return licExpandCartWithDeposits(items, {
      bottleDepositEnabled, licoreriaConfig, lang,
    })
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
    setCart(prev => {
      const victim = prev.find(i => i.id === cartId)
      // v2.7.1 — release the lock for this item (best-effort, fire-and-forget).
      if (lockingEnabled && victim?.inventory_item_id) {
        const bid = getBusinessId?.()
        const did = deviceIdRef.current
        // Resolve supabase_id via the in-memory cart row (we store `_clientOverrideKey`
        // == supabase_id for inventory lines). Fall back to looking it up on the product.
        const itemSid = victim._clientOverrideKey || null
        if (bid && did && itemSid) {
          releaseLock(bid, itemSid, did).catch(() => {})
        }
      }
      // v2.16.10 — Removing any line of an oferta group removes the whole bundle.
      if (victim?.oferta_group_id) {
        return prev.filter(i => i.oferta_group_id !== victim.oferta_group_id)
      }
      return prev.filter(i => i.id !== cartId)
    })
  }

  // ── Manual price-edit on cart line (v2.7.1) ───────────────────────────────
  // Cashier taps the pencil icon; if role needs gating we show ManagerAuthGate
  // first. On save we stamp `_priceEdited=true` so the PY / client-override
  // reprice effects skip this line.
  const [editingPriceCartId, setEditingPriceCartId] = useState(null) // id being edited
  const [editingPriceValue,  setEditingPriceValue]  = useState('')
  const [priceGateForCartId, setPriceGateForCartId] = useState(null) // waiting for mgr auth

  function requestPriceEdit(cartId) {
    const line = cart.find(i => i.id === cartId)
    if (!line) return
    if (needsGate(user, 'price_edit')) {
      setPriceGateForCartId(cartId)
      return
    }
    openPriceEditor(line)
  }
  function openPriceEditor(line) {
    setEditingPriceCartId(line.id)
    setEditingPriceValue(String(Number(line.price || 0).toFixed(2)))
  }
  function commitPriceEdit(cartId) {
    const raw = String(editingPriceValue).replace(',', '.').trim()
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n) || n < 0) { setEditingPriceCartId(null); return }
    setCart(prev => prev.map(i => i.id === cartId
      ? { ...i, price: Number(n.toFixed(2)), _priceEdited: true }
      : i))
    setEditingPriceCartId(null)
    setEditingPriceValue('')
  }
  function cancelPriceEdit() {
    setEditingPriceCartId(null)
    setEditingPriceValue('')
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'F1') { e.preventDefault(); clearForm() }
      else if (e.key === 'F2') {
        e.preventDefault()
        if (cart.length > 0) {
          const items = applyCarniceriaDiscounts(expandCartWithDeposits(cart))
          if (!ensureAgeVerifiedForCart(items)) return
          setCobrarModal({ items, ageVerified, clientId: selectedClient?.id || null, clientName: selectedClient?.name || rncName || '', client: selectedClient || null, salesperson, pyMode })
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
    // v2.14.34 — DO NOT close the modal here. CobrarModal renders its
    // SuccessView (with WhatsApp send button + receipt actions) once ecfState
    // hits 'success'; closing the parent state unmounts the modal before the
    // user can interact with that view. Modal closes itself via
    // handleSuccessClose() (user dismissal) → CobrarModal's onClose prop.

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
        payment_parts:    paymentData.payment_parts || null,
        split:            (paymentData.payment_parts?.length || 0) > 1,
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
          // v2.16.10 — bundle promo grouping; backend persists in ticket_items.
          oferta_supabase_id: i.oferta_supabase_id || null,
        })),
        comentario: (Number(paymentData.descuento || 0) > 0 && paymentData.descuentoReason)
                     ? `[Descuento: ${paymentData.descuentoReason}] ${paymentData.comentario || ''}`.trim()
                     : (paymentData.comentario || ''),
        descuento:  Number(paymentData.descuento || 0),
        descuento_reason: paymentData.descuentoReason || null,
        mac_jti:    paymentData.mac_jti || null,
      })

      clearForm()
      flash(`${result?.docNumber || 'Ticket'} · ${lang === 'es' ? 'Creado ✓' : 'Created ✓'}`)

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
          commercial_name: (cfg?.biz_commercial_name || '').trim(),
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
          client_name: pending.client?.name || pending.clientName || paymentData.rncName || '',
          client_rnc:  pending.client?.rnc  || paymentData.rnc    || '',
          rncName:     paymentData.rncName  || pending.clientName || '',
          rnc:         paymentData.rnc      || '',
          vehiclePlate: '',
          tipo: paymentData.tipo || 'contado',
          formaPago: paymentData.formaPago || 'cash',
          payment_parts: paymentData.payment_parts || null,
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
        const partMethods = (paymentData.payment_parts || []).map(p => p?.method || '')
        const hasCashLike = ['efectivo', 'cash', 'cheque'].includes(fm) || partMethods.some(m => ['efectivo', 'cash', 'cheque'].includes(m))
        if (paymentData.tipo !== 'credito' && hasCashLike) {
          printerApi?.openDrawer?.().catch?.(() => {})
        }
      } catch (e) { console.error('post-sale side-effect failed', e) }
    } catch (err) {
      flash(`Error: ${err.message}`)
    }
  }, [cobrarModal, lang])

  // ── Render ─────────────────────────────────────────────────────────────────
  const gridCols = collapsed ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* ── Left: Product browser ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white dark:bg-black">
        {/* Channel toolbar — Pedidos Ya toggle (retail + licoreria only) */}
        {pyAvailable && (
          <div className={`flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-white/10 transition-colors ${pyMode ? 'bg-[#FA0050]' : 'bg-white dark:bg-black'}`}>
            <div className="flex items-center gap-2 min-w-0">
              {pyMode ? (
                <>
                  <PedidosYaWordmark color="#ffffff" height={18} />
                  <span className="hidden sm:inline text-[11px] text-white font-semibold uppercase tracking-[0.14em]">
                    {lang === 'es' ? 'Precios delivery' : 'Delivery pricing'}
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
              className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-full min-h-[36px] transition-all border active:scale-[0.97] ${
                pyMode
                  ? 'bg-white border-white shadow-[0_4px_12px_-2px_rgba(0,0,0,0.35)] hover:bg-white/95'
                  : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-[#FA0050]'
              }`}
            >
              <PedidosYaWordmark color={pyMode ? '#FA0050' : '#FA0050'} height={16} />
              <span className={`w-8 h-[18px] rounded-full relative transition-colors ${pyMode ? 'bg-[#FA0050]' : 'bg-slate-300 dark:bg-white/20'}`}>
                <span className={`absolute top-0.5 w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${pyMode ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </span>
            </button>
          </div>
        )}
        {/* v2.6 — Licoreria: Devolver envases (bottle-return refund). Only
            visible when the tienda subtype is licoreria AND the bottle_deposit
            feature flag is on. Button is compact so it never crowds the
            Pedidos Ya channel toolbar on smaller registers. */}
        {isLicoreria && bottleDepositEnabled && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-black">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-white/40 uppercase tracking-[0.14em]">
              {lang === 'es' ? 'Envases' : 'Bottles'}
            </span>
            <button
              type="button"
              onClick={() => setDepositReturnOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full min-h-[36px] text-[12px] font-bold uppercase tracking-[0.08em] border-2 border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e] hover:text-white transition-colors active:scale-[0.97]"
              title={lang === 'es' ? 'Registrar devolución de envases' : 'Record bottle return'}
            >
              <Wine size={14} />
              {lang === 'es' ? 'Devolver envases' : 'Return bottles'}
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
                  const base = Number(item.price || 0)
                  const ov = clientItemOverrides[item.supabase_id]
                  const py = item.price_pedidos_ya != null && Number.isFinite(Number(item.price_pedidos_ya)) ? Number(item.price_pedidos_ya) : null
                  const showOv = ov != null
                  const showPY = !showOv && pyMode && py != null
                  const shown  = showOv ? ov : (showPY ? py : base)
                  const showStrike = shown !== base
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

          {/* v2.16.10 — Ofertas (bundle promos). Pro PLUS+ only. Renders above
              the product grid as a horizontal scroller of crimson-accent tiles. */}
          {tab === 'products' && !searchQuery && ofertasEnabled && ofertas.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={13} className="text-[#b3001e]" />
                <p className="text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider">
                  {lang === 'es' ? 'Ofertas' : 'Bundles'}
                </p>
              </div>
              <div className={`grid ${gridCols} gap-2`}>
                {ofertas.map(o => {
                  const available = Number(o.oferta_available ?? 0)
                  const inStock = available >= 1
                  const components = o.items || []
                  const subtotal = components.reduce((s, c) => s + Number(c.base_price || 0) * Number(c.qty || 1), 0)
                  const saves = Math.max(0, subtotal - Number(o.price || 0))
                  const firstMissing = components.find(c => c.inventory_item_supabase_id && Number(c.available_units ?? Infinity) < Number(c.qty || 1))
                  const tooltip = !inStock && firstMissing
                    ? (lang === 'es' ? `Sin stock — falta ${firstMissing.name}` : `Out of stock — missing ${firstMissing.name}`)
                    : ''
                  return (
                    <button
                      key={o.supabase_id}
                      onClick={() => inStock && addOfertaToCart(o)}
                      disabled={!inStock}
                      title={tooltip}
                      className={`group relative overflow-hidden flex flex-col justify-between p-4 md:p-5 rounded-2xl border text-left transition-all duration-200 ease-out min-h-[136px] will-change-transform ${inStock
                        ? 'border-[#b3001e]/50 bg-gradient-to-br from-[#b3001e]/[0.07] via-white to-white dark:from-[#b3001e]/20 dark:via-white/[0.04] dark:to-white/[0.03] hover:border-[#b3001e] hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-12px_rgba(179,0,30,0.55)] active:translate-y-0 active:scale-[0.99]'
                        : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 opacity-50 cursor-not-allowed'}`}>
                      <span className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent ${inStock ? 'opacity-70 group-hover:opacity-100' : 'opacity-30'} transition-opacity duration-300`} />
                      <div className="relative flex items-start justify-between gap-2 mb-1.5">
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-md bg-[#b3001e] text-white shadow-[0_4px_10px_-2px_rgba(179,0,30,0.6)]">
                          <Sparkles size={9} strokeWidth={3} /> OFERTA
                        </span>
                        {inStock ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            {available} {lang === 'es' ? 'disp.' : 'avail.'}
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400">
                            {lang === 'es' ? 'Sin stock' : 'Out'}
                          </span>
                        )}
                      </div>
                      <div className="relative flex-1">
                        <p className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-white leading-snug line-clamp-2 tracking-[-0.01em]">{o.name}</p>
                        {components.length > 0 && (
                          <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1 line-clamp-1">
                            {components.map(c => `${c.name}×${c.qty}`).join(' + ')}
                          </p>
                        )}
                      </div>
                      <div className="relative mt-2 pt-2.5 border-t border-dashed border-[#b3001e]/20 dark:border-white/10">
                        {saves > 0 && (
                          <div className="flex justify-end">
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                              −{fmtRD(saves)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-end items-baseline gap-1.5">
                          <span className="text-[11px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-[0.1em]">RD$</span>
                          <span className="font-black tabular-nums leading-none tracking-[-0.02em] text-[26px] text-[#b3001e]">
                            {Number(o.price || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </span>
                        </div>
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
                  const base = Number(item.price || 0)
                  const ov = clientItemOverrides[item.supabase_id]
                  const qsShown = ov != null ? ov : base
                  const qsStrike = ov != null && ov !== base
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
                      <div className="relative mt-2 pt-2.5 border-t border-dashed border-[#b3001e]/20 dark:border-white/10">
                        {qsStrike && (
                          <div className="flex justify-end">
                            <span className="text-[11px] text-slate-400 dark:text-white/40 line-through tabular-nums">
                              RD$ {base.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-end items-baseline gap-1.5">
                          <span className="text-[11px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-[0.1em]">RD$</span>
                          <span className="font-black tabular-nums leading-none tracking-[-0.02em] text-[26px] text-[#b3001e]">
                            {qsShown.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Products tab — show all inventory */}
          {tab === 'products' && !searchQuery && (
            <ProductGrid api={api} lang={lang} gridCols={gridCols} onAdd={addToCart} pyMode={pyMode} overrides={clientItemOverrides} />
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

        {/* v2.16.3 — Carnicería mode toggle + seasonal banner */}
        {isCarniceria && (
          <div className="px-4 pt-2">
            {!seasonalDismissed && seasonalActive.length > 0 && (
              <div className="-mx-4 mb-2">
                <SeasonalPromoBanner seasons={seasonalActive} lang={lang} onDismiss={() => setSeasonalDismissed(true)} />
              </div>
            )}
            <CarniceriaModeToggle mode={carniceriaMode} onChange={setCarniceriaMode} lang={lang} />
          </div>
        )}

        {/* Client selector */}
        <div className="px-4 py-2 border-b border-slate-100 dark:border-white/5">
          {selectedClient ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <UserRound size={14} className="text-[#b3001e] shrink-0" />
                <span className="text-[13px] font-medium text-slate-800 dark:text-white truncate">{selectedClient.name}</span>
                <LoyaltyTierBadge tier={selectedClient.loyalty_tier} lang={lang} />
                {Number(selectedClient.loyalty_points) > 0 && (
                  <span className="text-[10px] font-semibold text-[#b3001e] tabular-nums shrink-0">
                    {Math.round(selectedClient.loyalty_points).toLocaleString()} pts
                  </span>
                )}
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
                    <div className="flex-1 min-w-0">
                      {item.oferta_group_id && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-md bg-[#b3001e] text-white mb-1">
                          <Sparkles size={9} strokeWidth={3} /> OFERTA
                        </span>
                      )}
                      <p className="text-[13px] font-semibold text-slate-800 dark:text-white leading-tight line-clamp-2">{item.name}</p>
                    </div>
                    {isCarniceria && (
                      <PrepNotesButton
                        value={item.preparation_notes || ''}
                        onChange={(v) => setCart(prev => prev.map(i => i.id === item.id ? { ...i, preparation_notes: v } : i))}
                        lang={lang} />
                    )}
                    <button onClick={() => removeFromCart(item.id)}
                      className="shrink-0 w-6 h-6 rounded-md text-slate-400 dark:text-white/30 hover:bg-[#b3001e] hover:text-white transition-colors flex items-center justify-center"
                      title={lang === 'es' ? 'Quitar' : 'Remove'}>
                      <X size={13} />
                    </button>
                  </div>
                  {isCarniceria && item.preparation_notes && (
                    <p className="text-[10px] text-[#b3001e] italic px-1 mb-1 line-clamp-1" title={item.preparation_notes}>
                      📝 {item.preparation_notes}
                    </p>
                  )}
                  {/* v2.16.4 — crimson discount pill (cart-line) */}
                  {isCarniceria && item.inventory_item_supabase_id && discountByItemSid[item.inventory_item_supabase_id] && (
                    <div className="px-1 mb-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#b3001e] text-white text-[10px] font-bold uppercase tracking-wider"
                            title={discountByItemSid[item.inventory_item_supabase_id].label}>
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        {discountPillLabel(discountByItemSid[item.inventory_item_supabase_id], lang)}
                      </span>
                    </div>
                  )}
                  {/* Row 2 — unit price / detail + qty controls + line total */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {item.weight != null ? (
                        <p className="text-[10px] text-slate-400 dark:text-white/40 tabular-nums">{item.weight.toFixed(3)} {item.unit} × {fmtRD(item.price_per_unit || 0)}/{item.unit}</p>
                      ) : editingPriceCartId === item.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 dark:text-white/40">RD$</span>
                          <input
                            autoFocus
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            value={editingPriceValue}
                            onChange={e => setEditingPriceValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); commitPriceEdit(item.id) }
                              else if (e.key === 'Escape') { e.preventDefault(); cancelPriceEdit() }
                            }}
                            onBlur={() => commitPriceEdit(item.id)}
                            className="w-20 text-[11px] tabular-nums bg-white dark:bg-black border border-[#b3001e] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#b3001e] text-slate-800 dark:text-white"
                          />
                          <span className="text-[10px] text-slate-400 dark:text-white/40">c/u</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => requestPriceEdit(item.id)}
                          className="group/price flex items-center gap-1 text-[10px] text-slate-400 dark:text-white/40 tabular-nums hover:text-[#b3001e] transition-colors"
                          title={lang === 'es' ? 'Editar precio' : 'Edit price'}
                        >
                          <span>{fmtRD(item.price)} c/u</span>
                          {item._priceEdited && <Lock size={9} className="text-[#b3001e]" />}
                          <Edit2 size={9} className="opacity-40 group-hover/price:opacity-100" />
                        </button>
                      )}
                      <p className="text-[14px] font-black text-[#b3001e] tabular-nums leading-none mt-0.5">{fmtRD(item.price * (item.qty || 1))}</p>
                    </div>
                    {item.weight == null && !item._ofertaDiscount && !item.oferta_group_id && (
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

        {/* v2.16.4 — Carnicería discount strip */}
        {isCarniceria && carniceriaDiscountTotal > 0 && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#b3001e] text-white">
              <span className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {lang === 'es' ? 'Descuentos aplicados' : 'Discounts applied'}
              </span>
              <span className="text-[13px] font-black tabular-nums">−{fmtRD(carniceriaDiscountTotal)}</span>
            </div>
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
                const items = applyCarniceriaDiscounts(expandCartWithDeposits(cart))
                if (!ensureAgeVerifiedForCart(items)) return
                setMobileCartOpen(false)
                setCobrarModal({
                  items, salesperson,
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
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} autoFocus
                  placeholder={lang === 'es' ? 'Buscar cliente...' : 'Search client...'}
                  className="w-full pl-11 pr-3 py-2 text-sm bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
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
        <PaymentErrorBoundary onClose={() => setCobrarModal(null)}>
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
        </PaymentErrorBoundary>
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

      {/* v2.6 — Licorería bottle-deposit return */}
      <DepositReturnModal
        open={depositReturnOpen}
        onClose={() => setDepositReturnOpen(false)}
        onDone={({ qty: rq, amount, method }) => {
          setDepositReturnToast(
            lang === 'es'
              ? `Devolución registrada: ${rq} envase${rq === 1 ? '' : 's'} · ${method === 'efectivo' ? 'Efectivo' : 'Crédito'} · RD$${amount.toFixed(2)}`
              : `Return recorded: ${rq} bottle${rq === 1 ? '' : 's'} · ${method === 'efectivo' ? 'Cash' : 'Credit'} · RD$${amount.toFixed(2)}`
          )
          setTimeout(() => setDepositReturnToast(null), 3500)
        }}
      />
      {depositReturnToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[220] bg-[#b3001e] text-white px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold">
          {depositReturnToast}
        </div>
      )}

      {/* v2.7.1 — Cart-line price edit: manager auth gate */}
      {priceGateForCartId != null && (() => {
        const line = cart.find(i => i.id === priceGateForCartId)
        if (!line) return null
        return (
          <ManagerAuthGate
            action="price_edit"
            actionLabel={lang === 'es'
              ? `Editar precio · ${line.name}`
              : `Edit price · ${line.name}`}
            context={{
              target_id:    line.inventory_item_id || line.service_id || null,
              target_name:  line.name,
              amount:       Number(line.price || 0),
              old_price:    Number(line.price || 0),
              cart_line_id: line.id,
            }}
            onApprove={() => { setPriceGateForCartId(null); openPriceEditor(line) }}
            onCancel={() => setPriceGateForCartId(null)}
          />
        )
      })()}
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

function ProductGrid({ api, lang, gridCols, onAdd, pyMode, overrides = {} }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCat, setActiveCat] = useState('all')

  // v2.7 — cloud-synced tab customization. `pos_tab_order` is a JSON array of
  // category names in the user's chosen order; `pos_tab_hidden` is a JSON
  // array of names to suppress from the tab strip (products stay searchable).
  // Both keys live in app_settings (business-scoped) so all devices share them.
  const [tabOrder,  setTabOrder]  = useState([])
  const [hiddenCats, setHiddenCats] = useState([])
  const [editMode,  setEditMode]  = useState(false)
  const [draftOrder, setDraftOrder] = useState([])
  const [draftHidden, setDraftHidden] = useState([])
  const [dragIdx, setDragIdx] = useState(null)

  useEffect(() => {
    api.inventory?.all?.().then(items => {
      setProducts(items || [])
      setLoading(false)
    }).catch(() => setLoading(false))
    // Load saved tab preferences (fall through gracefully if not set).
    ;(async () => {
      try {
        const s = await api?.settings?.get?.()
        const parseArr = (v) => {
          if (Array.isArray(v)) return v
          if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
          return []
        }
        setTabOrder(parseArr(s?.pos_tab_order))
        setHiddenCats(parseArr(s?.pos_tab_hidden))
      } catch {}
    })()
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
  // Build ordered list: saved order first (stable), then any new categories
  // appended by product-count desc. "General" / "Sin Categoría" push to tail.
  const allCatNames = Object.keys(groups)
  const TAIL = new Set(['general','sin categoría','sin categoria','uncategorized'])
  function baseOrder(names) {
    return [...names].sort((a, b) => {
      const ai = TAIL.has(a.toLowerCase()) ? 1 : 0
      const bi = TAIL.has(b.toLowerCase()) ? 1 : 0
      if (ai !== bi) return ai - bi
      const d = (groups[b]?.length || 0) - (groups[a]?.length || 0)
      return d !== 0 ? d : a.localeCompare(b, 'es', { sensitivity: 'base' })
    })
  }
  const savedOrderFiltered = (editMode ? draftOrder : tabOrder).filter(c => allCatNames.includes(c))
  const unseeded = allCatNames.filter(c => !savedOrderFiltered.includes(c))
  const catNames = [...savedOrderFiltered, ...baseOrder(unseeded)]
  const effectiveHidden = new Set(editMode ? draftHidden : hiddenCats)
  const shownCats = editMode ? catNames : catNames.filter(c => !effectiveHidden.has(c))
  const visibleCats = activeCat === 'all' ? shownCats : shownCats.filter(c => c === activeCat)

  // Split into 2 rows — balanced by count, heavier on top.
  const rowSize = Math.ceil(shownCats.length / 2)
  const row1 = shownCats.slice(0, rowSize)
  const row2 = shownCats.slice(rowSize)

  function enterEdit() {
    setDraftOrder(catNames)
    setDraftHidden([...hiddenCats])
    setEditMode(true)
  }
  function cancelEdit() { setEditMode(false); setDragIdx(null) }
  async function saveEdit() {
    try {
      await api?.settings?.update?.({
        pos_tab_order: JSON.stringify(draftOrder),
        pos_tab_hidden: JSON.stringify(draftHidden),
      })
      setTabOrder(draftOrder)
      setHiddenCats(draftHidden)
    } catch {}
    setEditMode(false); setDragIdx(null)
  }
  function toggleHidden(cat) {
    setDraftHidden(h => h.includes(cat) ? h.filter(x => x !== cat) : [...h, cat])
  }
  function moveCat(fromIdx, toIdx) {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return
    setDraftOrder(prev => {
      const next = [...prev]
      const [m] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, m)
      return next
    })
  }

  return (
    <div className="space-y-5">
      {/* Category tabs — 2 rows, horizontally scrollable. Edit mode (pencil)
         enables drag-to-reorder + hide-tab per-category. Preferences persist
         to app_settings (cloud-synced). "Todos" always pinned, not reorderable. */}
      {catNames.length > 1 && (
        <div className="sticky top-0 z-10 -mx-3 px-3 bg-white dark:bg-black border-b border-slate-200 dark:border-white/10">
          <div className="flex items-start gap-2 py-1">
            {/* Pinned "Todos" + edit toggle */}
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => !editMode && setActiveCat('all')}
                disabled={editMode}
                className={`shrink-0 px-3 py-2 text-[12px] font-semibold whitespace-nowrap border-b-2 transition-colors min-h-[40px] ${
                  activeCat === 'all' && !editMode
                    ? 'border-[#b3001e] text-[#b3001e]'
                    : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white disabled:opacity-50'
                }`}>
                {lang === 'es' ? 'Todos' : 'All'}
                <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeCat === 'all' ? 'bg-[#b3001e]/10 text-[#b3001e]' : 'bg-slate-100 dark:bg-white/10 text-slate-400'
                }`}>{products.length}</span>
              </button>
              {!editMode ? (
                <button onClick={enterEdit}
                  title={lang === 'es' ? 'Editar pestañas' : 'Edit tabs'}
                  className="shrink-0 p-1.5 rounded-md text-slate-400 dark:text-white/40 hover:text-[#b3001e] hover:bg-[#b3001e]/10 transition-colors">
                  <Edit2 size={14} />
                </button>
              ) : (
                <div className="flex items-center gap-1 shrink-0 pl-1 border-l border-slate-200 dark:border-white/10 ml-1">
                  <button onClick={saveEdit}
                    className="px-2.5 py-1.5 rounded-md text-[11px] font-bold text-white bg-[#b3001e] hover:bg-[#b3001e]/90 transition-colors">
                    {lang === 'es' ? 'Guardar' : 'Save'}
                  </button>
                  <button onClick={cancelEdit}
                    className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors">
                    {lang === 'es' ? 'Cancelar' : 'Cancel'}
                  </button>
                </div>
              )}
            </div>

            {/* Two-row tab strip */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              {[row1, row2].map((row, rowIdx) => row.length > 0 && (
                <div key={rowIdx} className="flex gap-1 overflow-x-auto scrollbar-hide">
                  {row.map((c) => {
                    const idx = catNames.indexOf(c)
                    const isHidden = effectiveHidden.has(c)
                    const isActive = activeCat === c && !editMode && !isHidden
                    return (
                      <div key={c}
                        draggable={editMode}
                        onDragStart={editMode ? () => setDragIdx(idx) : undefined}
                        onDragOver={editMode ? (e) => { e.preventDefault() } : undefined}
                        onDrop={editMode ? (e) => { e.preventDefault(); if (dragIdx !== null) moveCat(dragIdx, idx); setDragIdx(null) } : undefined}
                        className={`shrink-0 inline-flex items-center rounded-md transition-all ${
                          editMode
                            ? `cursor-grab active:cursor-grabbing border ${isHidden ? 'border-dashed border-slate-200 dark:border-white/10 opacity-50' : 'border-slate-200 dark:border-white/10'} ${dragIdx === idx ? 'opacity-40' : ''} hover:border-[#b3001e]`
                            : ''
                        }`}>
                        <button onClick={() => !editMode && setActiveCat(c)}
                          disabled={editMode}
                          className={`shrink-0 px-3 py-2 text-[12px] font-semibold whitespace-nowrap ${
                            !editMode ? 'border-b-2 transition-colors min-h-[36px]' : 'min-h-[32px]'
                          } ${
                            isActive
                              ? 'border-[#b3001e] text-[#b3001e]'
                              : !editMode
                                ? 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
                                : `${isHidden ? 'text-slate-400 dark:text-white/30 line-through' : 'text-slate-700 dark:text-white/80'}`
                          }`}>
                          {c}
                          <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            isActive ? 'bg-[#b3001e]/10 text-[#b3001e]' : 'bg-slate-100 dark:bg-white/10 text-slate-400'
                          }`}>{groups[c].length}</span>
                        </button>
                        {editMode && (
                          <button onClick={() => toggleHidden(c)}
                            title={isHidden ? (lang === 'es' ? 'Mostrar' : 'Show') : (lang === 'es' ? 'Ocultar' : 'Hide')}
                            className="px-1.5 py-1 text-slate-400 hover:text-[#b3001e] dark:text-white/40 dark:hover:text-[#b3001e] transition-colors">
                            {isHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          {editMode && (
            <p className="text-[10px] text-slate-400 dark:text-white/40 pb-1.5">
              {lang === 'es'
                ? 'Arrastra para reordenar · El ojo oculta pestañas (los productos siguen buscables)'
                : 'Drag to reorder · Eye icon hides tabs (products still searchable)'}
            </p>
          )}
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

                  {/* Price row — Pedidos Ya override when toggle is on.
                      v2.5: client-specific override wins over PY. Same visual
                      pattern as PY — main number = effective price, base price
                      renders strikethrough above when different. */}
                  {(() => {
                    const base = Number(item.price || 0)
                    const ov = overrides[item.supabase_id]
                    const pyRaw = item.price_pedidos_ya
                    const py = pyRaw != null && pyRaw !== '' && Number.isFinite(Number(pyRaw)) ? Number(pyRaw) : null
                    const showOv = ov != null
                    const showPY = !showOv && pyMode && py != null
                    const shown = showOv ? ov : (showPY ? py : base)
                    const strike = shown !== base
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

// v2.6.2 — Apertura de Turno gate.
// v2.13.2 — Restricted to cashier role only. Owner/manager/cfo/accountant
// open shifts for their staff via the Cuadre screen instead of being prompted
// at POS load. Lavadores/vendedores never touch the register.
// Skipped for:
//   - kiosk/demo contexts (business setting kiosk_mode=1 or owner opt-out)
//   - any role except 'cashier'
function AperturaTurnoGate({ children }) {
  const api = useAPI()
  const { user, logout } = useAuth()
  const [ready, setReady] = useState(false)
  const [needsOpen, setNeedsOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // No user / web-setup owner: skip
        if (!user?.id || user.id === 'web') { if (!cancelled) setReady(true); return }
        // Cashier-only gate: every other role (owner/manager/cfo/accountant/none)
        // is exempt. Owners/managers handle apertura for cashiers from Cuadre.
        if (String(user.role || '').toLowerCase() !== 'cashier') {
          if (!cancelled) setReady(true)
          return
        }
        // Settings: owner escape + kiosk/demo skip
        let skip = false
        try {
          const s = await api?.settings?.get?.()
          if (s && (String(s.skip_apertura_prompt) === '1' || String(s.kiosk_mode) === '1')) skip = true
        } catch {}
        if (skip) { if (!cancelled) setReady(true); return }
        // Look for open shift
        try {
          const open = await api?.cuadre?.getOpen?.({ user_id: user.id, cajero_id: user.id })
          if (!cancelled) {
            setNeedsOpen(!open)
            setReady(true)
          }
        } catch {
          if (!cancelled) setReady(true)
        }
      } catch {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [api, user?.id, user?.employee_id])

  async function handleOpen(opening_cash) {
    if (submitting) return
    setSubmitting(true)
    try {
      await api?.cuadre?.openShift?.({ user_id: user.id, cajero_id: user.id, opening_cash, opened_at: new Date().toISOString() })
      setNeedsOpen(false)
    } catch (e) {
      // Surface the error by re-prompting; keep modal open.
      console.error('[apertura]', e)
    } finally {
      setSubmitting(false)
    }
  }

  if (!ready) return null
  return (
    <>
      {children}
      {needsOpen && (
        <AperturaTurnoModal
          userName={user?.name || ''}
          onConfirm={handleOpen}
          onLogout={logout}
          submitting={submitting}
        />
      )}
    </>
  )
}

export default function POS() {
  const { isRetail, isRestaurant, isHybrid, isPrestamos } = useBusinessType()
  const { plan } = usePlan()
  if (plan === 'facturacion') return <Navigate to="/invoicing" replace />
  const inner = isHybrid
    ? <HybridPOS />
    : isRestaurant
      ? <RestaurantPOS />
      : isPrestamos
        ? <LendingDashboard />
        : isRetail ? <RetailPOS /> : <CarWashPOS />
  return <AperturaTurnoGate>{inner}</AperturaTurnoGate>
}
