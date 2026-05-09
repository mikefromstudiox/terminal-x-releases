import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Plus, Minus, Trash2, ChefHat, X, AlertCircle, Loader2, Search,
  Truck, MapPin, ShoppingCart, Sparkles, Phone, ClipboardPaste,
  DollarSign, Clock, Send, Bike, Smartphone, Store,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAPI } from '../../context/DataContext'
import CobrarModal from '../../components/CobrarModal'
import PaymentErrorBoundary from '../../components/PaymentErrorBoundary'
import EventModeBanner from './EventModeBanner'
import PhoneOrderCaptureModal from '../../components/PhoneOrderCaptureModal'
import AggregatorPasteModal from '../../components/AggregatorPasteModal'
import useFoodTruckHotkeys from '../../hooks/useFoodTruckHotkeys'

// Order-source pill options. Tracked on tickets.order_source. Drives later
// reporting (Cuadre por canal) and the aggregator paste flow.
const SOURCE_PILLS = [
  { id: 'mostrador',       label: 'Mostrador',     icon: Store,      capture: false },
  { id: 'telefono',        label: 'Teléfono',      icon: Phone,      capture: 'phone' },
  { id: 'pedidos_ya',      label: 'Pedidos Ya',    icon: ClipboardPaste, capture: 'paste',  channel: 'pedidos_ya' },
  { id: 'uber_eats',       label: 'Uber Eats',     icon: ClipboardPaste, capture: 'paste',  channel: 'uber_eats' },
  { id: 'delivery_propio', label: 'Delivery propio', icon: Bike,     capture: 'phone' },
]

function fmtRD(n) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', minimumFractionDigits: 2 }).format(Number(n || 0))
}

function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Food Truck POS — take-out-first, mesa-free.
//
// Differences from RestaurantPOS:
//   - No mesa map, no waiter assignment, no SeatPromptModal.
//   - Single in-progress ticket draft (cart). On Cobrar we persist via
//     api.tickets.create() with fulfillment_type='take_out' (no mesa_id).
//   - Items auto-fire to KDS on Cobrar (kitchen sees orders as they're paid).
//     Manual fire-before-pay is unnecessary for the food truck workflow.
//   - Optional location stamp (current parking spot) carried on the ticket.
//   - Optional Modo Evento (price multiplier + receipt label).
export default function FoodTruckPOS() {
  const api = useAPI()
  const navigate = useNavigate()
  const searchInputRef = useRef(null)

  // Data
  const [services, setServices]   = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [busy, setBusy]           = useState(null)

  // Settings (event mode + active location)
  const [event, setEvent] = useState({ active: false, label: '', multiplier: 1 })
  const [activeLocationSid, setActiveLocationSid] = useState(null)

  // Cart
  const [items, setItems]         = useState([])  // { local_id, service_id, service_supabase_id, name, price, qty, course, printer_route }
  const [cobrarModal, setCobrarModal] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  // 2026-05-09 — order source (channel) + pending-ticket lifecycle.
  // When the cart is loaded from a Pendientes row, pendingTicket holds
  // { supabase_id, doc_number, source } and Cobrar finalizes via
  // closeWithPayment instead of create.
  const [orderSource, setOrderSource]     = useState('mostrador')
  const [phoneInfo, setPhoneInfo]         = useState(null)  // { name, phone, eta_minutes, notes } | null
  const [pendingTicket, setPendingTicket] = useState(null)  // { supabase_id, doc_number, source, opened_at } | null
  const [phoneModal, setPhoneModal]       = useState(null)  // pending source selection awaiting capture
  const [pasteModal, setPasteModal]       = useState(null)  // { channel: 'pedidos_ya'|'uber_eats' }
  const [postKitchenToast, setPostKitchenToast] = useState(null)  // { docNumber, phone, name } after successful send

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [sList, lList, settings] = await Promise.all([
        api.services?.all?.() || [],
        api.foodTruckLocations?.list?.({ activeOnly: true }) || [],
        api.settings?.get?.() || {},
      ])
      setServices((Array.isArray(sList) ? sList : []).filter(s => s.is_menu_item === 1 || s.is_menu_item === true))
      setLocations(Array.isArray(lList) ? lList : [])
      setEvent({
        active:     settings?.food_truck_event_active === '1' || settings?.food_truck_event_active === true,
        label:      settings?.food_truck_event_label || '',
        multiplier: Math.max(0.5, Math.min(5, Number(settings?.food_truck_event_multiplier) || 1)),
      })
      setActiveLocationSid(settings?.food_truck_active_location_supabase_id || null)
      setError(null)
    } catch (e) {
      setError(e?.message || 'Error cargando POS')
    } finally {
      setLoading(false)
    }
  }, [api])
  useEffect(() => { reload() }, [reload])

  // Pendientes hand-off — when user clicks "Cargar / Cobrar" on the
  // Pendientes screen, it stashes the ticket row in sessionStorage and
  // navigates here. Pull it on mount, load into the cart, then clear.
  useEffect(() => {
    let cancelled = false
    try {
      const raw = sessionStorage.getItem('foodtruck_load_pending')
      if (!raw) return
      sessionStorage.removeItem('foodtruck_load_pending')
      const row = JSON.parse(raw)
      if (!cancelled && row?.supabase_id) loadPending(row)
    } catch {}
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return services
    return services.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q)
    )
  }, [services, searchQuery])

  const eventMultiplier = event.active ? event.multiplier : 1

  const ticketSubtotal = useMemo(
    () => items.reduce((s, it) => s + Number(it.price) * it.qty, 0),
    [items]
  )

  // Add item — instant cart push, fire-and-forget.
  const addItem = (svc) => {
    const unit = Math.round(Number(svc.price || 0) * eventMultiplier * 100) / 100
    setItems(prev => {
      const existing = prev.find(it => it.service_id === svc.id && !it.modifiers?.length)
      if (existing) {
        return prev.map(it => it === existing ? { ...it, qty: it.qty + 1 } : it)
      }
      return [...prev, {
        local_id: uuidv4(),
        service_id: svc.id,
        service_supabase_id: svc.supabase_id,
        name: svc.name,
        price: unit,
        qty: 1,
        course: svc.course || 'principal',
        printer_route: svc.printer_route || 'kitchen',
      }]
    })
  }

  const incQty = (localId, delta) => {
    setItems(prev => prev
      .map(it => it.local_id === localId ? { ...it, qty: Math.max(0, it.qty + delta) } : it)
      .filter(it => it.qty > 0)
    )
  }

  const removeItem = (localId) => setItems(prev => prev.filter(it => it.local_id !== localId))
  const clearCart = () => setItems([])

  const activeLocation = useMemo(
    () => locations.find(l => l.supabase_id === activeLocationSid) || null,
    [locations, activeLocationSid]
  )

  const setLocation = async (sid) => {
    setActiveLocationSid(sid || null)
    try { await api.settings?.update?.({ food_truck_active_location_supabase_id: sid || '' }) } catch {}
  }

  // ── Source pill row ─────────────────────────────────────────────────────
  // Tapping a non-walk-up pill captures customer info (phone capture for
  // Teléfono / Delivery propio) or opens the aggregator paste modal
  // (Pedidos Ya / Uber Eats). Switching channels mid-cart is allowed —
  // we just rewrite the source state.
  const pickSource = (pillId) => {
    const pill = SOURCE_PILLS.find(p => p.id === pillId)
    if (!pill) return
    if (pill.capture === 'phone') {
      setPhoneModal({ pendingSource: pill.id })
    } else if (pill.capture === 'paste') {
      setPasteModal({ channel: pill.channel || pill.id })
    } else {
      setOrderSource(pill.id)
      setPhoneInfo(null)
    }
  }
  const handlePhoneCaptured = (info, pendingSource) => {
    setPhoneInfo(info)
    setOrderSource(pendingSource)
    setPhoneModal(null)
  }
  const handlePasteParsed = (parsed, channel) => {
    // parsed: { items: [{name, qty, price}], customer_name, customer_phone, eta_minutes, total, raw }
    const cartLines = (parsed.items || []).map(it => {
      // Try to match a real service by name (case-insensitive); unmatched
      // → free-form line with no service_id (will skip inventory deduction).
      const match = services.find(s => (s.name || '').toLowerCase() === (it.name || '').toLowerCase())
      return {
        local_id: uuidv4(),
        service_id: match?.id || null,
        service_supabase_id: match?.supabase_id || null,
        name: match?.name || it.name,
        price: Number(it.price) || Number(match?.price) || 0,
        qty: Number(it.qty) || 1,
        course: match?.course || 'principal',
        printer_route: match?.printer_route || 'kitchen',
        modifiers: [],
      }
    })
    setItems(cartLines)
    setOrderSource(channel)
    if (parsed.customer_phone || parsed.customer_name) {
      setPhoneInfo({
        name:  parsed.customer_name  || '',
        phone: parsed.customer_phone || '',
        eta_minutes: parsed.eta_minutes || null,
        notes: parsed.raw ? `Importado de ${channel}` : null,
      })
    }
    setPasteModal(null)
  }

  // ── Pendientes — load a previously-fired ticket back into the cart ──────
  const loadPending = async (pendingTicketRow) => {
    setBusy('Cargando orden…')
    try {
      // Fetch full ticket + items so we can rebuild the cart shape.
      const ticket = await api.tickets?.getById?.(pendingTicketRow.id) || pendingTicketRow
      const lines = Array.isArray(ticket.items) ? ticket.items : []
      setItems(lines.map(it => ({
        local_id: uuidv4(),
        service_id:           it.service_id || null,
        service_supabase_id:  it.service_supabase_id || null,
        ticket_item_supabase_id: it.supabase_id || null,
        name:    it.name,
        price:   Number(it.price) || 0,
        qty:     Number(it.quantity || it.qty) || 1,
        course:  it.course || 'principal',
        printer_route: 'kitchen',
        modifiers: [],
      })))
      setPendingTicket({
        supabase_id: ticket.supabase_id || pendingTicketRow.supabase_id,
        doc_number:  ticket.doc_number  || pendingTicketRow.doc_number,
        source:      ticket.order_source || pendingTicketRow.order_source || 'mostrador',
        opened_at:   ticket.created_at  || pendingTicketRow.created_at,
        notes:       ticket.notes || pendingTicketRow.notes,
      })
      setOrderSource(ticket.order_source || pendingTicketRow.order_source || 'mostrador')
    } catch (e) {
      setError(e?.message || 'No se pudo cargar la orden pendiente.')
    } finally {
      setBusy(null)
    }
  }
  const releasePending = () => {
    setPendingTicket(null)
    clearCart?.()
    setOrderSource('mostrador')
    setPhoneInfo(null)
  }

  // ── Send to Kitchen — fire-then-pay flow ─────────────────────────────────
  const sendToKitchen = async () => {
    if (!items.length) return
    setBusy('Enviando a cocina…')
    try {
      const phoneNotes = phoneInfo
        ? `📞 ${phoneInfo.name}${phoneInfo.phone ? ' · ' + phoneInfo.phone : ''}${phoneInfo.eta_minutes ? ' · ETA ' + phoneInfo.eta_minutes + 'min' : ''}${phoneInfo.notes ? ' · ' + phoneInfo.notes : ''}`
        : null
      let opened = pendingTicket
      if (!opened) {
        opened = await api.tickets?.openForFulfillment?.({
          fulfillment_type: 'take_out',
          mode: 'take_out',
          food_truck_location_supabase_id: activeLocationSid || null,
          order_source: orderSource,
          notes: phoneNotes,
        })
        if (!opened?.supabase_id) throw new Error('No se pudo abrir la orden')
        // Persist each cart line so KDS has supabase_ids to fire against.
        for (const it of items) {
          try {
            await api.tickets?.addItem?.({
              ticket_supabase_id: opened.supabase_id,
              service_supabase_id: it.service_supabase_id || null,
              service_id: it.service_id || null,
              name: it.name,
              price: it.price,
              qty: it.qty,
              course: it.course || 'principal',
            })
          } catch (e) {
            console.warn('[FoodTruckPOS] addItem failed', it.name, e?.message)
          }
        }
      }
      // Fire to KDS for every line (best-effort).
      const station = (it) => (it.printer_route || 'kitchen').toLowerCase() === 'bar' ? 'bar' : 'kitchen'
      for (const it of items) {
        try {
          await api.kds?.fire?.({
            ticket_item_supabase_id: it.ticket_item_supabase_id || null,
            station: station(it),
            name: it.name,
            qty: it.qty,
            modifiers: it.modifiers || [],
          })
        } catch (e) {
          console.warn('[FoodTruckPOS] kds.fire failed', it.name, e?.message)
        }
      }
      setPostKitchenToast({
        docNumber: opened.doc_number,
        phone: phoneInfo?.phone || null,
        name:  phoneInfo?.name  || null,
      })
      // Reset cart for the next order. Keep source on Mostrador for walk-up.
      setItems([])
      setPendingTicket(null)
      setPhoneInfo(null)
      setOrderSource('mostrador')
    } catch (e) {
      setError(e?.message || 'No se pudo enviar a cocina')
    } finally {
      setBusy(null)
    }
  }

  const clearEvent = async () => {
    setEvent({ active: false, label: '', multiplier: 1 })
    try {
      await api.settings?.update?.({
        food_truck_event_active: '0',
        food_truck_event_label: '',
        food_truck_event_multiplier: '1',
      })
    } catch {}
  }

  // ── Desktop hotkeys ────────────────────────────────────────────────────
  // F2 = focus search · F3 = Send to Kitchen · F4 = Cobrar · F8 = Pendientes
  // Esc = close any open modal. Disabled while typing into an input.
  useFoodTruckHotkeys({
    onSearchFocus: () => searchInputRef.current?.focus(),
    onSendKitchen: () => { if (items.length && !pendingTicket) sendToKitchen() },
    onCobrar:      () => { if (items.length) openCobro() },
    onPendientes:  () => navigate('/pendientes'),
    onCancel:      () => {
      if (cobrarModal) setCobrarModal(null)
      else if (phoneModal) setPhoneModal(null)
      else if (pasteModal) setPasteModal(null)
      else if (postKitchenToast) setPostKitchenToast(null)
    },
  })

  // Build the cobro payload mirror of RestaurantPOS but mesa-free.
  const openCobro = () => {
    if (!items.length) return
    setCobrarModal({
      ticket: {
        ticketNo: 'FT',
        vehicle: activeLocation?.name || 'Food Truck',
        services: items.map(it => ({
          id: it.service_id,
          name: it.name,
          price: it.price,
          qty: it.qty,
        })),
        fulfillment_type: 'take_out',
        mode: 'take_out',
      },
    })
  }

  const fireKitchen = async (ticketSid) => {
    if (!api.kds?.fire) return
    const station = (it) => (it.printer_route || 'kitchen').toLowerCase() === 'bar' ? 'bar' : 'kitchen'
    for (const it of items) {
      try {
        await api.kds.fire({
          ticket_item_id: null,
          ticket_item_supabase_id: null,
          mesa_id: null,
          mesa_supabase_id: null,
          station: station(it),
          name: it.name,
          qty: it.qty,
          modifiers: it.modifiers || [],
        })
      } catch (e) {
        console.warn('[FoodTruckPOS] kds.fire failed for', it.name, e?.message)
      }
    }
  }

  const handleTicketPaid = async (payload = {}) => {
    if (!items.length) { setCobrarModal(null); return }
    setBusy('Registrando ticket...')
    const ticketSid = pendingTicket?.supabase_id || uuidv4()
    const tipAmount = Number(payload?.tip_amount ?? 0) || 0
    const total = Number(payload?.total ?? (ticketSubtotal + tipAmount))
    const sourceFromPayload = payload?.order_source || pendingTicket?.source || orderSource
    const phoneNotes = phoneInfo
      ? `📞 ${phoneInfo.name}${phoneInfo.phone ? ' · ' + phoneInfo.phone : ''}${phoneInfo.eta_minutes ? ' · ETA ' + phoneInfo.eta_minutes + 'min' : ''}${phoneInfo.notes ? ' · ' + phoneInfo.notes : ''}`
      : null
    const cobroPayload = {
      supabase_id: ticketSid,
      items: items.map(it => ({
        service_id: it.service_id,
        service_supabase_id: it.service_supabase_id,
        name: it.name,
        price: Number(it.price),
        qty: it.qty,
        course: it.course || 'principal',
      })),
      fulfillment_type: 'take_out',
      mode: 'take_out',
      mesa_id: null,
      mesa_supabase_id: null,
      food_truck_location_supabase_id: activeLocationSid || null,
      tip_amount: tipAmount,
      total,
      subtotal: Number(payload?.subtotal ?? ticketSubtotal),
      itbis: Number(payload?.itbis ?? 0),
      descuento: Number(payload?.descuento ?? 0),
      descuento_reason: payload?.descuentoReason || null,
      payment_method: payload?.payment_method || 'efectivo',
      payment_parts: payload?.payment_parts || null,
      comprobante_type: payload?.comprobante_type || null,
      ncf: payload?.ncf || null,
      tipo_venta: payload?.tipo_venta || null,
      client_id: payload?.client_id || null,
      client_supabase_id: payload?.client_supabase_id || null,
      cajero_id: payload?.cajero_id || null,
      comentario: payload?.comentario || (event.active ? `EVENTO: ${event.label}` : null),
      notes: pendingTicket?.notes || phoneNotes || null,
      order_source: sourceFromPayload,
      mac_jti: payload?.mac_jti || null,
      ecf: payload?.ecf || null,
    }
    try {
      if (pendingTicket?.supabase_id && api.tickets?.closeWithPayment) {
        // Pending ticket already exists in DB → finalize via closeWithPayment.
        // Items were already added on Send-to-Kitchen; closeWithPayment only
        // updates totals + payment + flips open_status to 'closed'.
        await api.tickets.closeWithPayment({
          ticket_supabase_id: pendingTicket.supabase_id,
          payload: cobroPayload,
        })
      } else {
        await api.tickets.create(cobroPayload)
      }
    } catch (e) {
      console.error('[FoodTruckPOS] ticket persist failed', e)
      setError(e?.message || 'No se pudo registrar el ticket.')
      setCobrarModal(null)
      setBusy(null)
      return
    }
    // Best-effort fire-to-KDS after persistence (skip if items were already
    // fired during Send-to-Kitchen — pending tickets don't need a re-fire).
    if (!pendingTicket) {
      try { await fireKitchen(ticketSid) } catch (e) { console.warn('[FoodTruckPOS] fireKitchen failed', e) }
    }
    setCobrarModal(null)
    clearCart()
    setPendingTicket(null)
    setPhoneInfo(null)
    setOrderSource('mostrador')
    setBusy(null)
  }

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_360px] bg-slate-50 dark:bg-black min-h-0">
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] max-w-md p-3 rounded-xl bg-[#b3001e] text-white text-sm flex items-center justify-between gap-3 shadow-2xl">
          <span className="flex items-center gap-2"><AlertCircle size={16} /> {error}</span>
          <button onClick={() => setError(null)} className="text-white/80 hover:text-white"><X size={16} /></button>
        </div>
      )}

      {busy && (
        <div className="fixed top-4 right-4 z-[70] bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-white flex items-center gap-2 shadow-2xl">
          <Loader2 size={14} className="animate-spin text-[#b3001e]" /> {busy}
        </div>
      )}

      {/* MAIN PANE */}
      <div className="overflow-y-auto p-5 lg:p-7 min-h-0">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#b3001e]/10 grid place-items-center">
            <Truck className="text-[#b3001e]" size={20} />
          </div>
          <div>
            <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Food Truck</h1>
            <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Take-out · Pago directo</p>
          </div>
        </div>

        {event.active && (
          <EventModeBanner label={event.label} multiplier={event.multiplier} onClear={clearEvent} />
        )}

        {/* Source pill row — channel/origin of this order. Stamped on the
            ticket so end-of-shift reports break revenue down by channel. */}
        <div className="mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase mr-1">Origen</span>
            {SOURCE_PILLS.map(p => {
              const Icon = p.icon
              const active = orderSource === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickSource(p.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${active
                    ? 'bg-[#b3001e] text-white border-[#b3001e] shadow'
                    : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-slate-300 dark:hover:border-white/20'}`}
                >
                  <Icon size={12} /> {p.label}
                </button>
              )
            })}
            {phoneInfo && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-slate-700 dark:text-white/70 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <Phone size={11} className="text-[#b3001e]" /> {phoneInfo.name}{phoneInfo.phone ? ' · ' + phoneInfo.phone : ''}{phoneInfo.eta_minutes ? ` · ETA ${phoneInfo.eta_minutes}m` : ''}
                <button onClick={() => setPhoneInfo(null)} className="ml-1 opacity-60 hover:opacity-100"><X size={10} /></button>
              </span>
            )}
          </div>
        </div>

        {/* Pending-ticket banner. Shown when cart was loaded from /pendientes
            so the cashier knows Cobrar will close that ticket (vs creating
            a new one). [Liberar] disconnects without closing the ticket. */}
        {pendingTicket && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
            <Clock size={16} className="text-amber-600 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-amber-900 dark:text-amber-200">
                Editando orden <span className="font-mono">{pendingTicket.doc_number}</span>
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300/80">
                pendiente desde {pendingTicket.opened_at ? new Date(pendingTicket.opened_at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : '—'} · {pendingTicket.source}
              </p>
            </div>
            <button
              type="button"
              onClick={releasePending}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/15"
            >Liberar</button>
          </div>
        )}

        {/* Post-Send-to-Kitchen toast with WhatsApp deep-link if customer
            phone was captured. One-tap from cashier; no auto-send. */}
        {postKitchenToast && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30">
            <ChefHat size={16} className="text-emerald-600 dark:text-emerald-400" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-emerald-900 dark:text-emerald-200">
                Orden <span className="font-mono">{postKitchenToast.docNumber}</span> enviada a cocina
              </p>
              {postKitchenToast.name && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300/80">
                  Para {postKitchenToast.name}{postKitchenToast.phone ? ' · ' + postKitchenToast.phone : ''}
                </p>
              )}
            </div>
            {postKitchenToast.phone && (() => {
              const cleanPhone = String(postKitchenToast.phone).replace(/\D/g, '')
              const e164 = cleanPhone.length === 10 ? '1' + cleanPhone : cleanPhone
              const txt = encodeURIComponent(`¡Hola ${postKitchenToast.name || ''}! Tu orden ${postKitchenToast.docNumber} está confirmada. Te avisamos cuando esté lista. Gracias!`)
              return (
                <a
                  href={`https://wa.me/${e164}?text=${txt}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-[#25D366] text-white hover:bg-[#1da851]"
                >
                  <Smartphone size={12} /> WhatsApp
                </a>
              )
            })()}
            <button onClick={() => setPostKitchenToast(null)} className="text-emerald-600 dark:text-emerald-400 hover:opacity-80"><X size={14} /></button>
          </div>
        )}

        {/* Location selector */}
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10">
            <MapPin size={14} className="text-[#b3001e]" />
            <span className="text-xs font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase">Parada</span>
          </div>
          <button
            onClick={() => setLocation(null)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors
              ${!activeLocationSid
                ? 'border-[#b3001e] text-[#b3001e] bg-[#b3001e]/5'
                : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-slate-300 dark:hover:border-white/20'}`}
          >
            Sin ubicación
          </button>
          {locations.map(loc => (
            <button
              key={loc.id}
              onClick={() => setLocation(loc.supabase_id)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors
                ${activeLocationSid === loc.supabase_id
                  ? 'border-[#b3001e] text-[#b3001e] bg-[#b3001e]/5'
                  : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-slate-300 dark:hover:border-white/20'}`}
            >
              {loc.name}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mb-4 flex items-center gap-2.5 px-4 py-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 focus-within:border-[#b3001e]">
          <Search size={16} className="shrink-0 text-slate-400 dark:text-white/40" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar plato o categoría... (F2)"
            className="flex-1 min-w-0 bg-transparent text-slate-900 dark:text-white text-sm focus:outline-none placeholder:text-slate-400 dark:placeholder:text-white/40"
            autoComplete="off"
          />
        </div>

        {/* Menu grid */}
        {loading ? (
          <div className="text-center py-12 text-slate-400 dark:text-white/40 text-sm">Cargando menú...</div>
        ) : filteredServices.length === 0 ? (
          <div className="text-center py-12 text-sm text-slate-400 dark:text-white/40">
            {searchQuery.trim() ? `Sin coincidencias para "${searchQuery}"` : 'No hay productos en el menú.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredServices.map(svc => {
              const oos = svc.in_stock === 0 || svc.in_stock === false
              const displayPrice = Math.round(Number(svc.price || 0) * eventMultiplier * 100) / 100
              return (
                <button
                  key={svc.id}
                  disabled={oos}
                  onClick={() => addItem(svc)}
                  className={`text-left p-4 rounded-2xl border transition-all
                    ${oos
                      ? 'border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 opacity-50 cursor-not-allowed'
                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-[#b3001e] hover:shadow-sm'}`}
                >
                  <div className="text-[10px] font-extrabold tracking-[1.5px] text-slate-400 dark:text-white/40 uppercase mb-1.5 truncate">
                    {svc.category || svc.course || ''}
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 mb-2">{svc.name}</div>
                  <div className="text-sm font-semibold text-[#b3001e]">{fmtRD(displayPrice)}</div>
                  {oos && <div className="text-[10px] font-extrabold text-slate-500 dark:text-white/50 mt-1.5">AGOTADO</div>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* CART SIDEBAR */}
      <div className="border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-950 flex flex-col min-h-0">
        <div className="p-5 border-b border-slate-200 dark:border-white/10 flex items-center gap-2">
          <ShoppingCart size={16} className="text-[#b3001e]" />
          <div className="flex-1 text-sm font-extrabold tracking-tight text-slate-900 dark:text-white">Pedido</div>
          {items.length > 0 && (
            <button
              onClick={clearCart}
              className="text-xs font-semibold text-slate-500 dark:text-white/50 hover:text-[#b3001e]"
            >
              Limpiar
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {items.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400 dark:text-white/40">
              Toca un plato para agregarlo
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map(it => (
                <div key={it.local_id} className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{it.name}</div>
                    <div className="text-xs text-slate-500 dark:text-white/50">{fmtRD(it.price)}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => incQty(it.local_id, -1)}
                      className="w-7 h-7 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 grid place-items-center text-slate-600 dark:text-white/70"
                    >
                      <Minus size={12} />
                    </button>
                    <div className="w-6 text-center text-sm font-bold text-slate-900 dark:text-white">{it.qty}</div>
                    <button
                      onClick={() => incQty(it.local_id, 1)}
                      className="w-7 h-7 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 grid place-items-center text-slate-600 dark:text-white/70"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  <button
                    onClick={() => removeItem(it.local_id)}
                    className="p-1.5 rounded-lg hover:bg-[#b3001e]/10 text-[#b3001e]"
                    aria-label="Eliminar"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 dark:border-white/10">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase">Subtotal</span>
            <span className="text-xl font-extrabold text-slate-900 dark:text-white">{fmtRD(ticketSubtotal)}</span>
          </div>
          {event.active && (
            <div className="text-[10px] font-extrabold tracking-[1px] text-[#b3001e] uppercase mb-2 flex items-center gap-1">
              <Sparkles size={10} /> Precios con multiplicador de evento aplicado
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!items.length || !!pendingTicket}
              onClick={sendToKitchen}
              title={pendingTicket ? 'Esta orden ya fue enviada a cocina' : 'Enviar a cocina sin cobrar'}
              className="py-3.5 rounded-xl border-2 border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e]/5 dark:hover:bg-[#b3001e]/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-extrabold tracking-wide flex items-center justify-center gap-2"
            >
              <Send size={16} /> Cocina
            </button>
            <button
              type="button"
              disabled={!items.length}
              onClick={openCobro}
              className="py-3.5 rounded-xl bg-[#b3001e] hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-extrabold tracking-wide flex items-center justify-center gap-2"
            >
              <DollarSign size={16} /> Cobrar
            </button>
          </div>
        </div>
      </div>

      {cobrarModal && (
        <PaymentErrorBoundary onClose={() => setCobrarModal(null)}>
          <CobrarModal
            ticket={cobrarModal.ticket}
            onClose={() => setCobrarModal(null)}
            onConfirm={handleTicketPaid}
          />
        </PaymentErrorBoundary>
      )}

      {phoneModal && (
        <PhoneOrderCaptureModal
          pendingSource={phoneModal.pendingSource}
          onConfirm={handlePhoneCaptured}
          onClose={() => setPhoneModal(null)}
        />
      )}

      {pasteModal && (
        <AggregatorPasteModal
          channel={pasteModal.channel}
          services={services}
          onConfirm={handlePasteParsed}
          onClose={() => setPasteModal(null)}
        />
      )}
    </div>
  )
}
