import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Plus, Minus, Trash2, ChefHat, X, AlertCircle, Loader2, Search,
  Truck, MapPin, ShoppingCart, Sparkles,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import CobrarModal from '../../components/CobrarModal'
import PaymentErrorBoundary from '../../components/PaymentErrorBoundary'
import EventModeBanner from './EventModeBanner'

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
    const ticketSid = uuidv4()
    const tipAmount = Number(payload?.tip_amount ?? 0) || 0
    const total = Number(payload?.total ?? (ticketSubtotal + tipAmount))
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
      mac_jti: payload?.mac_jti || null,
      ecf: payload?.ecf || null,
    }
    try {
      await api.tickets.create(cobroPayload)
    } catch (e) {
      console.error('[FoodTruckPOS] ticket create failed', e)
      setError(e?.message || 'No se pudo registrar el ticket.')
      setCobrarModal(null)
      setBusy(null)
      return
    }
    // Best-effort fire-to-KDS after persistence.
    try { await fireKitchen(ticketSid) } catch (e) { console.warn('[FoodTruckPOS] fireKitchen failed', e) }
    setCobrarModal(null)
    clearCart()
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
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar plato o categoría..."
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
          <button
            disabled={!items.length}
            onClick={openCobro}
            className="w-full py-3.5 rounded-xl bg-[#b3001e] hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-extrabold tracking-wide flex items-center justify-center gap-2"
          >
            <ChefHat size={16} /> Cobrar
          </button>
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
    </div>
  )
}
