import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  ArrowLeft, Users, User, Clock, Plus, Minus, Trash2, ChefHat, CreditCard,
  Check, X, AlertCircle, Loader2, Utensils, Coffee, Wine, IceCream, Soup,
  ListOrdered, Split,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import CobrarModal from '../../components/CobrarModal'
import TipEntryModal from './TipEntryModal'
import SplitBillModal from './SplitBillModal'
import SplitByItemModal from './SplitByItemModal'
import { effectivePrice, isHappyHourActive } from './happyHour'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  const v = Number.isFinite(n) ? n : 0
  return `RD$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function elapsedMinutes(seatedAt, now) {
  if (!seatedAt) return 0
  const t = new Date(seatedAt).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 60000))
}

function fmtElapsed(mins) {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Course → icon + spanish label
const COURSES = [
  { id: 'entradas',    label: 'Entradas',    icon: Soup },
  { id: 'principales', label: 'Principales', icon: Utensils },
  { id: 'bebidas',     label: 'Bebidas',     icon: Coffee },
  { id: 'cocteles',    label: 'Cócteles',    icon: Wine },
  { id: 'postres',     label: 'Postres',     icon: IceCream },
  { id: 'otros',       label: 'Otros',       icon: ListOrdered },
]

function courseForService(svc) {
  const c = (svc.course || svc.categoria || '').toLowerCase().trim()
  // Accept legacy singular aliases shipped in sampleMenus / MenuBuilder options
  // so a menu seeded with `course='bebida'` still slots into the `bebidas` tab.
  const alias = {
    entrada: 'entradas', entradas: 'entradas', appetizer: 'entradas',
    principal: 'principales', principales: 'principales', entree: 'principales', main: 'principales',
    bebida: 'bebidas', bebidas: 'bebidas', drink: 'bebidas',
    coctel: 'cocteles', cocteles: 'cocteles', cocktail: 'cocteles',
    postre: 'postres', postres: 'postres', dessert: 'postres',
  }
  const mapped = alias[c]
  if (mapped) return mapped
  const hit = COURSES.find(x => x.id === c)
  return hit ? hit.id : 'otros'
}

// Persist a course tag on an item so KDS + DB + analytics agree. Falls back
// to the service's course/categoria; defaults to 'otros' so every line has
// exactly one non-null bucket.
function itemCourseTag(it, services) {
  if (it.course) return it.course
  const svc = services.find(s => s.id === it.service_id || s.supabase_id === it.service_supabase_id)
  return svc ? courseForService(svc) : 'otros'
}

// ── MODIFIER MODAL (inline) ───────────────────────────────────────────────────
function ModifierModal({ open, service, groups, onClose, onConfirm }) {
  const [selections, setSelections] = useState({}) // { groupId: Set<modId> }

  useEffect(() => {
    if (open) setSelections({})
  }, [open, service?.id])

  const toggle = (group, mod) => {
    setSelections(prev => {
      const curr = new Set(prev[group.id] || [])
      const maxSel = group.max_select ?? 99
      if (curr.has(mod.id)) {
        curr.delete(mod.id)
      } else {
        if (maxSel === 1) {
          curr.clear()
          curr.add(mod.id)
        } else if (curr.size < maxSel) {
          curr.add(mod.id)
        }
      }
      return { ...prev, [group.id]: curr }
    })
  }

  const { allValid, totalDelta, selectedMods } = useMemo(() => {
    let ok = true
    let delta = 0
    const picked = []
    for (const g of groups) {
      const set = selections[g.id] || new Set()
      if (set.size < (g.min_select || 0)) ok = false
      for (const m of g.modificadores || []) {
        if (set.has(m.id)) {
          delta += Number(m.price_delta || 0)
          picked.push({
            modificador_id: m.id,
            modificador_supabase_id: m.supabase_id || null,
            group_id: g.id,
            group_name: g.name,
            name: m.name,
            price_delta: Number(m.price_delta || 0),
          })
        }
      }
    }
    return { allValid: ok, totalDelta: delta, selectedMods: picked }
  }, [selections, groups])

  if (!open || !service) return null

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div className="text-lg font-bold text-white">{service.name}</div>
            <div className="text-xs text-white/50 mt-0.5">
              Precio base: {fmtRD(service.price)} · + {fmtRD(totalDelta)} en extras
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {(!groups || groups.length === 0) ? (
            <div className="text-center text-white/50 py-8 text-sm">
              Este producto no tiene modificadores.
            </div>
          ) : groups.map(g => {
            const set = selections[g.id] || new Set()
            const required = (g.min_select || 0) > 0
            const incomplete = set.size < (g.min_select || 0)
            return (
              <div key={g.id} className="bg-zinc-900 rounded-xl border border-white/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-semibold text-white">{g.name}</div>
                    <div className="text-[10px] text-white/50 uppercase tracking-wider mt-0.5">
                      {required ? `Requerido · elige ${g.min_select}` : 'Opcional'}
                      {g.max_select > 1 && ` · máx ${g.max_select}`}
                    </div>
                  </div>
                  {incomplete && <AlertCircle size={16} className="text-amber-400" />}
                </div>
                <div className="space-y-1">
                  {(g.modificadores || []).map(m => {
                    const active = set.has(m.id)
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggle(g, m)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                          active
                            ? 'bg-red-600/15 border-red-600/50 text-white'
                            : 'bg-zinc-950 border-white/10 text-white/70 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${active ? 'bg-red-600 border-red-500' : 'border-white/30'}`}>
                            {active && <Check size={12} className="text-white" />}
                          </div>
                          <span className="text-sm truncate">{m.name}</span>
                        </div>
                        {Number(m.price_delta) !== 0 && (
                          <span className={`text-xs font-semibold shrink-0 ${active ? 'text-white' : 'text-white/50'}`}>
                            {Number(m.price_delta) > 0 ? '+' : ''}{fmtRD(Number(m.price_delta))}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10 bg-zinc-900/50">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/70 hover:bg-white/5 font-medium">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(selectedMods, totalDelta)}
            disabled={!allValid}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> Agregar {fmtRD(service.price + totalDelta)}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SEAT PROMPT ───────────────────────────────────────────────────────────────
function SeatPromptModal({ open, mesa, empleados, onClose, onConfirm }) {
  const [guests, setGuests] = useState(2)
  const [waiterId, setWaiterId] = useState('')

  useEffect(() => {
    if (open) {
      setGuests(mesa?.capacity || 2)
      setWaiterId('')
    }
  }, [open, mesa])

  if (!open || !mesa) return null

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div className="text-lg font-bold text-white">Sentar en {mesa.name}</div>
            <div className="text-xs text-white/50 mt-0.5">Crear ticket nuevo</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-white/60 uppercase tracking-wider mb-1.5 block">Comensales</label>
            <div className="flex items-center gap-3">
              <button onClick={() => setGuests(g => Math.max(1, g - 1))} className="w-10 h-10 rounded-lg bg-zinc-900 border border-white/10 text-white hover:border-white/30 flex items-center justify-center">
                <Minus size={16} />
              </button>
              <div className="flex-1 bg-zinc-900 border border-white/10 rounded-lg py-2.5 text-center text-xl font-bold text-white">{guests}</div>
              <button onClick={() => setGuests(g => g + 1)} className="w-10 h-10 rounded-lg bg-zinc-900 border border-white/10 text-white hover:border-white/30 flex items-center justify-center">
                <Plus size={16} />
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-white/60 uppercase tracking-wider mb-1.5 block">Mesero</label>
            <select
              value={waiterId}
              onChange={e => setWaiterId(e.target.value)}
              className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-red-500"
            >
              <option value="">Sin asignar</option>
              {empleados.map(e => (
                <option key={e.id} value={e.id}>{e.name || e.full_name || e.nombre}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10 bg-zinc-900/50">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/70 hover:bg-white/5 font-medium">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm({ guests, waiterId: waiterId || null })}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold"
          >
            Sentar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MESA CARD (compact) ───────────────────────────────────────────────────────
const STATUS_STYLE = {
  libre:     { chip: 'bg-green-500/15 text-green-400 border-green-500/30', ring: 'border-green-500/40 hover:border-green-500/70', label: 'Libre' },
  ocupada:   { chip: 'bg-red-600/15 text-red-400 border-red-600/30',       ring: 'border-red-600/50 hover:border-red-600/80',     label: 'Ocupada' },
  sucia:     { chip: 'bg-amber-500/15 text-amber-400 border-amber-500/30', ring: 'border-amber-500/40 hover:border-amber-500/70', label: 'Sucia' },
  reservada: { chip: 'bg-blue-500/15 text-blue-400 border-blue-500/30',    ring: 'border-blue-500/40 hover:border-blue-500/70',   label: 'Reservada' },
}

function MesaCompactCard({ mesa, now, onClick }) {
  const s = STATUS_STYLE[mesa.status] || STATUS_STYLE.libre
  const mins = mesa.status === 'ocupada' ? elapsedMinutes(mesa.seated_at, now) : 0
  return (
    <button
      onClick={onClick}
      className={`group bg-zinc-900 rounded-2xl p-4 border text-left transition-all ${s.ring} hover:-translate-y-0.5`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="text-xl font-bold text-white truncate">{mesa.name}</div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.chip}`}>
          {s.label}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-white/60">
        <span className="inline-flex items-center gap-1">
          <Users size={12} /> {mesa.guests ?? mesa.capacity ?? 0}
        </span>
        {mesa.status === 'ocupada' && (
          <span className="inline-flex items-center gap-1">
            <Clock size={12} /> {fmtElapsed(mins)}
          </span>
        )}
      </div>
    </button>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function RestaurantPOS() {
  const api = useAPI()

  // Data
  const [mesas, setMesas]           = useState([])
  const [services, setServices]     = useState([])
  const [empleados, setEmpleados]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  // View state
  const [now, setNow]               = useState(Date.now())
  const [activeTicket, setActiveTicket] = useState(null) // { id, supabase_id, mesa, waiterId, guests, items:[], startedAt }
  const [courseFilter, setCourseFilter] = useState(COURSES[0].id)

  // Modals
  const [seatPrompt, setSeatPrompt] = useState(null)     // mesa
  const [modifierState, setModifierState] = useState(null) // { service, groups }
  const [tipModal, setTipModal]     = useState(false)
  const [splitModal, setSplitModal] = useState(null)     // { total }
  const [splitItemModal, setSplitItemModal] = useState(null) // { total }
  const [cobrarModal, setCobrarModal] = useState(null)   // ticket shape
  const [busy, setBusy]             = useState(null)     // label while async
  const [happyHourEnabled, setHappyHourEnabled] = useState(true)

  // Tick for elapsed times
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  // Initial load
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [mList, sList, eList, settings] = await Promise.all([
        api.mesas?.list?.() || [],
        api.services?.getAll?.() || [],
        api.empleados?.list?.() || api.empleados?.getAll?.() || [],
        api.settings?.get?.() || Promise.resolve({}),
      ])
      const hhFlag = settings?.restaurant_happy_hour_enabled
      setHappyHourEnabled(hhFlag == null ? true : (hhFlag === '1' || hhFlag === 1 || hhFlag === true))
      setMesas(Array.isArray(mList) ? mList : [])
      setServices((Array.isArray(sList) ? sList : []).filter(s => s.is_menu_item === 1 || s.is_menu_item === true))
      setEmpleados(Array.isArray(eList) ? eList : [])
      setError(null)
    } catch (e) {
      console.error('[RestaurantPOS] load failed', e)
      setError(e.message || 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { reload() }, [reload])

  // Derived
  const courseGroups = useMemo(() => {
    const byCourse = {}
    for (const svc of services) {
      const c = courseForService(svc)
      if (!byCourse[c]) byCourse[c] = []
      byCourse[c].push(svc)
    }
    return byCourse
  }, [services])

  const availableCourses = useMemo(
    () => COURSES.filter(c => (courseGroups[c.id] || []).length > 0),
    [courseGroups]
  )

  useEffect(() => {
    if (availableCourses.length && !availableCourses.find(c => c.id === courseFilter)) {
      setCourseFilter(availableCourses[0].id)
    }
  }, [availableCourses, courseFilter])

  const ticketSubtotal = useMemo(() => {
    if (!activeTicket) return 0
    return activeTicket.items.reduce((s, it) => {
      const modSum = (it.modifiers || []).reduce((x, m) => x + Number(m.price_delta || 0), 0)
      return s + (Number(it.price) + modSum) * it.qty
    }, 0)
  }, [activeTicket])

  const hasUnfiredItems = useMemo(
    () => !!activeTicket?.items?.some(it => !it.kds_fired_at),
    [activeTicket]
  )

  // Courses present in the current ticket's unfired queue — drives the
  // per-course "Fire entradas / Fire principales" buttons in the footer.
  const unfiredCoursesInTicket = useMemo(() => {
    if (!activeTicket) return []
    const set = new Set()
    for (const it of activeTicket.items) {
      if (it.kds_fired_at) continue
      set.add(itemCourseTag(it, services))
    }
    return COURSES.filter(c => set.has(c.id))
  }, [activeTicket, services])

  // Actions
  const openMesa = async (mesa) => {
    if (mesa.status === 'libre' || mesa.status === 'sucia' || mesa.status === 'reservada') {
      setSeatPrompt(mesa)
      return
    }
    // ocupada → load its existing ticket
    try {
      setBusy('Cargando ticket...')
      const ticket = await (api.tickets?.getActiveByMesa?.(mesa.id) || api.tickets?.getByMesa?.(mesa.id))
      if (!ticket) {
        setError('No se encontró el ticket activo de esta mesa.')
        return
      }
      setActiveTicket({
        id: ticket.id,
        supabase_id: ticket.supabase_id,
        mesa,
        waiterId: ticket.waiter_empleado_id || mesa.waiter_empleado_id || null,
        guests: ticket.guests || mesa.guests || 0,
        items: (ticket.items || []).map(it => ({
          local_id: it.local_id || uuidv4(),
          ticket_item_id: it.id,
          ticket_item_supabase_id: it.supabase_id,
          service_id: it.service_id,
          service_supabase_id: it.service_supabase_id,
          name: it.name,
          price: Number(it.price),
          qty: Number(it.qty || 1),
          modifiers: it.modifiers || [],
          kds_fired_at: it.kds_fired_at || null,
        })),
        startedAt: ticket.created_at || mesa.seated_at || new Date().toISOString(),
      })
    } catch (e) {
      console.error(e)
      setError(e.message || 'Error cargando ticket')
    } finally {
      setBusy(null)
    }
  }

  const handleSeat = async ({ guests, waiterId }) => {
    const mesa = seatPrompt
    setSeatPrompt(null)
    if (!mesa) return
    try {
      setBusy('Sentando mesa...')
      await api.mesas.setStatus(mesa.id, 'ocupada', {
        guests,
        waiter_empleado_id: waiterId,
        seated_at: new Date().toISOString(),
      })
      const freshMesa = { ...mesa, status: 'ocupada', guests, waiter_empleado_id: waiterId, seated_at: new Date().toISOString() }
      setActiveTicket({
        id: null,
        supabase_id: uuidv4(),
        mesa: freshMesa,
        waiterId,
        guests,
        items: [],
        startedAt: new Date().toISOString(),
      })
      await reload()
    } catch (e) {
      console.error(e)
      setError(e.message || 'Error sentando mesa')
    } finally {
      setBusy(null)
    }
  }

  const addServiceToTicket = async (svc) => {
    // Detect modifier groups
    let groups = []
    try {
      groups = await (api.modificadores?.listForService?.(svc.id) || [])
    } catch (e) {
      console.warn('[RestaurantPOS] modificadores load failed', e)
    }
    const hasRequired = groups.some(g => (g.min_select || 0) > 0)
    if (hasRequired || groups.length > 0) {
      setModifierState({ service: svc, groups })
      return
    }
    pushItem(svc, [])
  }

  const pushItem = (svc, modifiers) => {
    setActiveTicket(t => {
      if (!t) return t
      const unit = effectivePrice(svc, { enabled: happyHourEnabled, now: new Date() })
      const applied = unit !== Number(svc.price || 0)
      return {
        ...t,
        items: [
          ...t.items,
          {
            local_id: uuidv4(),
            ticket_item_id: null,
            ticket_item_supabase_id: uuidv4(),
            service_id: svc.id,
            service_supabase_id: svc.supabase_id,
            name: applied ? `${svc.name} · Happy Hour` : svc.name,
            price: unit,
            qty: 1,
            modifiers,
            kds_fired_at: null,
            course: courseForService(svc),
            happy_hour_applied: applied,
          },
        ],
      }
    })
  }

  const confirmModifier = (mods) => {
    const svc = modifierState?.service
    setModifierState(null)
    if (svc) pushItem(svc, mods)
  }

  const incQty = (localId, delta) => {
    setActiveTicket(t => {
      if (!t) return t
      return {
        ...t,
        items: t.items
          .map(it => it.local_id === localId ? { ...it, qty: Math.max(0, it.qty + delta) } : it)
          .filter(it => it.qty > 0 || it.kds_fired_at),
      }
    })
  }

  const removeItem = (localId) => {
    setActiveTicket(t => {
      if (!t) return t
      return { ...t, items: t.items.filter(it => it.local_id !== localId || it.kds_fired_at) }
    })
  }

  // When courseId is null/undefined → fire ALL unfired. Otherwise only fire
  // the items whose course tag matches — classic "coursing" workflow (appetizers
  // first, entrees when the table is ready, dessert at the end).
  const fireToKDS = async (courseId = null) => {
    if (!activeTicket) return
    let unfired = activeTicket.items.filter(it => !it.kds_fired_at)
    if (courseId) unfired = unfired.filter(it => itemCourseTag(it, services) === courseId)
    if (!unfired.length) return
    try {
      setBusy('Enviando a cocina...')
      const station = (svc) => {
        const pr = (services.find(s => s.id === svc.service_id)?.printer_route || 'kitchen').toLowerCase()
        if (pr === 'bar') return 'bar'
        if (pr === 'kitchen' || pr === 'cocina') return 'kitchen'
        return 'kitchen'
      }
      for (const it of unfired) {
        await api.kds.fire({
          ticket_item_id: it.ticket_item_id,
          ticket_item_supabase_id: it.ticket_item_supabase_id,
          mesa_id: activeTicket.mesa.id,
          mesa_supabase_id: activeTicket.mesa.supabase_id,
          station: station(it),
          name: it.name,
          qty: it.qty,
          modifiers: it.modifiers,
        })
      }
      const firedAt = new Date().toISOString()
      const firedIds = new Set(unfired.map(u => u.local_id))
      setActiveTicket(t => ({
        ...t,
        items: t.items.map(it => (it.kds_fired_at || !firedIds.has(it.local_id)) ? it : { ...it, kds_fired_at: firedAt }),
      }))
    } catch (e) {
      console.error(e)
      setError(e.message || 'Error enviando a cocina')
    } finally {
      setBusy(null)
    }
  }

  const openCobroFlow = () => {
    if (!activeTicket || !activeTicket.items.length) return
    setTipModal(true)
  }

  const handleTipConfirmed = (tipAmount) => {
    setTipModal(false)
    // Open the combined payment view — we use CobrarModal directly, offering a Split button via the sibling splitModal
    const ticketShape = buildCobrarTicket(tipAmount, false)
    setCobrarModal({ ticket: ticketShape, tipAmount })
  }

  const buildCobrarTicket = (tipAmount) => {
    const mesa = activeTicket.mesa
    return {
      ticketNo: `M-${mesa.name}`,
      vehicle: `Mesa ${mesa.name}`,
      services: activeTicket.items.map(it => {
        const modSum = (it.modifiers || []).reduce((x, m) => x + Number(m.price_delta || 0), 0)
        return {
          id: it.service_id,
          name: it.name + ((it.modifiers || []).length ? ` (${it.modifiers.map(m => m.name).join(', ')})` : ''),
          price: Number(it.price) + modSum,
          qty: it.qty,
        }
      }).concat(tipAmount > 0 ? [{ id: '__tip__', name: 'Propina', price: tipAmount, qty: 1 }] : []),
      mesa_id: mesa.id,
      mesa_supabase_id: mesa.supabase_id,
      tip_amount: tipAmount,
      fulfillment_type: 'dine_in',
      mode: 'mesa',
    }
  }

  // Called when CobrarModal successfully records payment
  const handleTicketPaid = async () => {
    try {
      // Persist modifier snapshots if needed (best-effort)
      if (api.restaurant?.itemModificadores?.snapshot) {
        for (const it of activeTicket.items) {
          if (it.modifiers?.length) {
            try {
              await api.restaurant.itemModificadores.snapshot(
                it.ticket_item_supabase_id,
                it.ticket_item_id,
                it.modifiers
              )
            } catch (e) { console.warn('[RestaurantPOS] snapshot mod failed', e) }
          }
        }
      }
      // Free the mesa → sucia
      await api.mesas.setStatus(activeTicket.mesa.id, 'sucia', {
        guests: null,
        waiter_empleado_id: null,
        seated_at: null,
      })
    } catch (e) {
      console.error('[RestaurantPOS] post-cobro cleanup failed', e)
    } finally {
      setCobrarModal(null)
      setActiveTicket(null)
      await reload()
    }
  }

  const openSplit = () => {
    if (!cobrarModal) return
    const total = cobrarModal.ticket.services.reduce((s, svc) => s + svc.price * (svc.qty || 1), 0)
    setSplitModal({ total })
  }

  // NOTE: the ticket API currently persists a single payment_method per ticket.
  // We record the full parts[] array locally and set the primary method to parts[0].method.
  // When the backend supports multi-payment, pass `parts` directly to api.tickets.create.
  const handleSplitPay = async (parts) => {
    try {
      setBusy('Registrando pagos...')
      const total = parts.reduce((s, p) => s + p.amount, 0)
      const ticketShape = cobrarModal.ticket
      const items = activeTicket.items.map(it => {
        const modSum = (it.modifiers || []).reduce((x, m) => x + Number(m.price_delta || 0), 0)
        return {
          service_id: it.service_id,
          service_supabase_id: it.service_supabase_id,
          name: it.name,
          price: Number(it.price) + modSum,
          qty: it.qty,
          modifiers: it.modifiers,
        }
      })
      await api.tickets.create({
        items,
        mesa_id: activeTicket.mesa.id,
        mesa_supabase_id: activeTicket.mesa.supabase_id,
        fulfillment_type: 'dine_in',
        mode: 'mesa',
        tip_amount: cobrarModal.tipAmount || 0,
        total,
        payment_method: parts[0].method,
        payment_parts: parts,
        split: parts.length > 1,
      })
      setSplitModal(null)
      setCobrarModal(null)
      await api.mesas.setStatus(activeTicket.mesa.id, 'sucia', {
        guests: null,
        waiter_empleado_id: null,
        seated_at: null,
      })
      setActiveTicket(null)
      await reload()
    } catch (e) {
      console.error(e)
      setError(e.message || 'Error registrando pagos')
    } finally {
      setBusy(null)
    }
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-white/50">
        <Loader2 className="animate-spin mr-2" size={20} /> Cargando restaurante...
      </div>
    )
  }

  const waiterName = activeTicket
    ? (empleados.find(e => e.id === activeTicket.waiterId)?.name
        || empleados.find(e => e.id === activeTicket.waiterId)?.full_name
        || empleados.find(e => e.id === activeTicket.waiterId)?.nombre
        || 'Sin asignar')
    : null

  const elapsedTicketMin = activeTicket ? elapsedMinutes(activeTicket.startedAt, now) : 0
  const activeCourseGroup = courseGroups[courseFilter] || []

  return (
    <div className="h-full flex flex-col bg-black text-white">
      {/* Error banner */}
      {error && (
        <div className="m-3 p-3 rounded-xl bg-red-600/15 border border-red-600/40 text-red-300 text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertCircle size={16} /> {error}</span>
          <button onClick={() => setError(null)} className="text-red-300/70 hover:text-white"><X size={16} /></button>
        </div>
      )}

      {busy && (
        <div className="fixed top-4 right-4 z-[70] bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/80 flex items-center gap-2 shadow-2xl">
          <Loader2 size={14} className="animate-spin text-red-500" /> {busy}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* LEFT PANE (60%) */}
        <div className="w-[60%] border-r border-white/10 flex flex-col min-h-0">
          {!activeTicket ? (
            <>
              <div className="px-5 py-4 border-b border-white/10">
                <div className="text-lg font-bold text-white">Mesas</div>
                <div className="text-xs text-white/50 mt-0.5">Toca una mesa libre para sentar comensales</div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {mesas.length === 0 ? (
                  <div className="text-center text-white/40 py-12 text-sm">
                    No hay mesas configuradas todavía.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {mesas.map(m => (
                      <MesaCompactCard key={m.id} mesa={m} now={now} onClick={() => openMesa(m)} />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Ticket header */}
              <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3">
                <button
                  onClick={() => setActiveTicket(null)}
                  className="w-9 h-9 rounded-lg bg-zinc-900 border border-white/10 hover:border-white/30 text-white/70 hover:text-white flex items-center justify-center"
                  title="Volver a mesas"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-bold text-white truncate">{activeTicket.mesa.name}</div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-red-600/15 text-red-400 border-red-600/30">
                      Ocupada
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-white/60 mt-0.5">
                    <span className="inline-flex items-center gap-1"><User size={11} /> {waiterName}</span>
                    <span className="inline-flex items-center gap-1"><Users size={11} /> {activeTicket.guests}</span>
                    <span className="inline-flex items-center gap-1"><Clock size={11} /> {fmtElapsed(elapsedTicketMin)}</span>
                  </div>
                </div>
              </div>

              {/* Ticket items */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {activeTicket.items.length === 0 ? (
                  <div className="text-center text-white/40 py-12 text-sm">
                    Agrega productos desde el menú →
                  </div>
                ) : activeTicket.items.map(it => {
                  const modSum = (it.modifiers || []).reduce((x, m) => x + Number(m.price_delta || 0), 0)
                  const lineTotal = (Number(it.price) + modSum) * it.qty
                  const fired = !!it.kds_fired_at
                  return (
                    <div
                      key={it.local_id}
                      className={`bg-zinc-900 rounded-xl border p-3 ${fired ? 'border-green-500/30' : 'border-white/5'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white font-semibold truncate">{it.name}</span>
                            {fired && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 uppercase tracking-wider">
                                Enviado
                              </span>
                            )}
                          </div>
                          {(it.modifiers || []).length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {it.modifiers.map((m, i) => (
                                <div key={i} className="text-[11px] text-white/50 pl-2">
                                  · {m.name}
                                  {Number(m.price_delta) !== 0 && (
                                    <span className="ml-1 text-white/40">
                                      ({Number(m.price_delta) > 0 ? '+' : ''}{fmtRD(Number(m.price_delta))})
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="text-xs text-white/50 mt-1">
                            {it.qty} × {fmtRD(Number(it.price) + modSum)}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <div className="text-white font-bold">{fmtRD(lineTotal)}</div>
                          {!fired && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => incQty(it.local_id, -1)} className="w-6 h-6 rounded bg-zinc-950 border border-white/10 hover:border-white/30 text-white/70 flex items-center justify-center">
                                <Minus size={12} />
                              </button>
                              <span className="w-6 text-center text-sm text-white">{it.qty}</span>
                              <button onClick={() => incQty(it.local_id, 1)} className="w-6 h-6 rounded bg-zinc-950 border border-white/10 hover:border-white/30 text-white/70 flex items-center justify-center">
                                <Plus size={12} />
                              </button>
                              <button onClick={() => removeItem(it.local_id)} className="w-6 h-6 rounded bg-zinc-950 border border-red-600/30 hover:bg-red-600/20 text-red-400 flex items-center justify-center ml-1">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Footer */}
              <div className="border-t border-white/10 bg-zinc-950 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white/60 text-sm">Subtotal</span>
                  <span className="text-white text-xl font-bold">{fmtRD(ticketSubtotal)}</span>
                </div>

                {/* Coursing — fire one course at a time */}
                {unfiredCoursesInTicket.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1.5 flex items-center gap-1.5">
                      <ChefHat size={11} /> Firing courses
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {unfiredCoursesInTicket.map(c => {
                        const Icon = c.icon
                        return (
                          <button
                            key={c.id}
                            onClick={() => fireToKDS(c.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-white/10 hover:border-[#b3001e] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                          >
                            <Icon size={12} /> {c.label}
                          </button>
                        )
                      })}
                      <button
                        onClick={() => fireToKDS(null)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-white/10 hover:border-white/30 text-white/70 text-xs font-medium flex items-center gap-1.5"
                      >
                        Todo
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => fireToKDS(null)}
                    disabled={!hasUnfiredItems}
                    className="py-3 rounded-xl bg-zinc-900 border border-white/10 hover:border-white/30 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChefHat size={16} /> Enviar todo
                  </button>
                  <button
                    onClick={openCobroFlow}
                    disabled={activeTicket.items.length === 0}
                    className="py-3 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CreditCard size={16} /> Cobrar
                  </button>
                </div>
                {/* Cross-mode conversion — hybrid vertical only. Moves the
                    current mesa's lines into the Venta Directa cart (takeout)
                    via localStorage so no items are lost in the switch. */}
                <button
                  onClick={() => {
                    if (!activeTicket?.items?.length) return
                    const payload = {
                      items: activeTicket.items.map(it => ({
                        service_id: it.service_id,
                        service_supabase_id: it.service_supabase_id,
                        name: it.name,
                        price: Number(it.price) + (it.modifiers || []).reduce((x, m) => x + Number(m.price_delta || 0), 0),
                        qty: it.qty,
                      })),
                      from_mesa_id: activeTicket.mesa?.id || null,
                      from_mesa_supabase_id: activeTicket.mesa?.supabase_id || null,
                      from_ticket_supabase_id: activeTicket.supabase_id || null,
                      note: activeTicket.mesa ? `Convertido de Mesa ${activeTicket.mesa.name}` : '',
                    }
                    try {
                      window.localStorage.setItem('tx_hybrid_convert_cart', JSON.stringify(payload))
                      window.localStorage.setItem('tx_hybrid_pos_mode', 'directa')
                      window.dispatchEvent(new CustomEvent('tx_hybrid_mode_change', { detail: 'directa' }))
                    } catch {}
                  }}
                  disabled={!activeTicket?.items?.length}
                  className="mt-2 w-full py-2 rounded-lg bg-transparent border border-white/15 hover:border-[#b3001e] text-white/70 hover:text-white text-[11px] font-semibold transition-colors disabled:opacity-40"
                >
                  Convertir a Venta Directa (Takeout)
                </button>
              </div>
            </>
          )}
        </div>

        {/* RIGHT PANE (40%) — Menu */}
        <div className="w-[40%] flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-white/10">
            <div className="text-sm font-bold text-white mb-2">Menú</div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {availableCourses.map(c => {
                const Icon = c.icon
                const active = courseFilter === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => setCourseFilter(c.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                      active
                        ? 'bg-red-600 border-red-500 text-white'
                        : 'bg-zinc-900 border-white/10 text-white/60 hover:border-white/30'
                    }`}
                  >
                    <Icon size={13} /> {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {!activeTicket ? (
              <div className="text-center text-white/40 py-12 text-sm px-4">
                Selecciona una mesa para comenzar a ordenar.
              </div>
            ) : activeCourseGroup.length === 0 ? (
              <div className="text-center text-white/40 py-12 text-sm">
                Sin productos en esta categoría.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {activeCourseGroup.map(svc => {
                  const hh = isHappyHourActive(svc, { enabled: happyHourEnabled })
                  const base = Number(svc.price || 0)
                  const eff  = effectivePrice(svc, { enabled: happyHourEnabled })
                  return (
                    <button
                      key={svc.id}
                      onClick={() => addServiceToTicket(svc)}
                      className={`bg-zinc-900 rounded-xl border p-3 text-left transition-colors ${
                        hh ? 'border-[#b3001e]/60 hover:border-[#b3001e]' : 'border-white/5 hover:border-red-500/50'
                      }`}
                    >
                      <div className="text-sm font-semibold text-white line-clamp-2">{svc.name}</div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          {hh ? (
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-[#b3001e] font-bold text-sm">{fmtRD(eff)}</span>
                              <span className="text-[10px] text-white/40 line-through">{fmtRD(base)}</span>
                            </div>
                          ) : (
                            <span className="text-red-400 font-bold text-sm">{fmtRD(base)}</span>
                          )}
                          {hh && <div className="text-[9px] uppercase tracking-wider text-[#b3001e] font-bold mt-0.5">Happy Hour</div>}
                        </div>
                        <Plus size={14} className="text-white/40 shrink-0" />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <SeatPromptModal
        open={!!seatPrompt}
        mesa={seatPrompt}
        empleados={empleados}
        onClose={() => setSeatPrompt(null)}
        onConfirm={handleSeat}
      />

      <ModifierModal
        open={!!modifierState}
        service={modifierState?.service}
        groups={modifierState?.groups || []}
        onClose={() => setModifierState(null)}
        onConfirm={confirmModifier}
      />

      <TipEntryModal
        open={tipModal}
        subtotal={ticketSubtotal}
        onClose={() => setTipModal(false)}
        onConfirm={handleTipConfirmed}
      />

      {/* Floating "Dividir" buttons on top of CobrarModal */}
      {cobrarModal && !splitModal && !splitItemModal && (
        <div className="fixed bottom-6 left-6 z-[65] flex flex-col gap-2">
          <button
            onClick={openSplit}
            className="px-4 py-2.5 rounded-full bg-zinc-900 border border-white/20 hover:border-white/40 text-white text-sm font-semibold shadow-2xl flex items-center gap-2"
          >
            <Split size={14} /> Dividir en partes iguales
          </button>
          <button
            onClick={() => {
              if (!cobrarModal) return
              const total = cobrarModal.ticket.services.reduce((s, svc) => s + svc.price * (svc.qty || 1), 0)
              setSplitItemModal({ total })
            }}
            className="px-4 py-2.5 rounded-full bg-[#b3001e] hover:bg-red-700 text-white text-sm font-semibold shadow-2xl flex items-center gap-2"
          >
            <Users size={14} /> Dividir por plato
          </button>
        </div>
      )}

      {cobrarModal && (
        <CobrarModal
          ticket={cobrarModal.ticket}
          onClose={() => setCobrarModal(null)}
          onConfirm={handleTicketPaid}
        />
      )}

      {splitModal && (
        <SplitBillModal
          open={true}
          totalAmount={splitModal.total}
          onClose={() => setSplitModal(null)}
          onPay={handleSplitPay}
        />
      )}

      {splitItemModal && (
        <SplitByItemModal
          open={true}
          items={activeTicket?.items || []}
          guestsCount={activeTicket?.guests || 2}
          tipAmount={cobrarModal?.tipAmount || 0}
          onClose={() => setSplitItemModal(null)}
          onPay={async (parts, assignment) => {
            // Stamp guest_number onto each item from the assignment map so the
            // downstream ticket_items rows carry per-guest attribution.
            setActiveTicket(t => t && {
              ...t,
              items: t.items.map(it => ({ ...it, guest_number: (assignment[it.local_id] ?? 0) + 1 })),
            })
            await handleSplitPay(parts)
            setSplitItemModal(null)
          }}
        />
      )}
    </div>
  )
}
