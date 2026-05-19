// Pendientes — every food-truck ticket with open_status='open'.
// Cashier flow: order rang → Send to Kitchen → ticket lands here → customer
// arrives → cashier loads it back into the cart from this list → Cobrar.
//
// Color coding:
//   green  → KDS bumped to ready (waiting for pickup)
//   amber  → kitchen still preparing (or KDS not touched)
//   red    → elapsed > 25 min (likely abandoned / needs follow-up)
//
// Live count badge in the sidebar is driven by the same listOpen call this
// screen polls (every 20s while the screen is mounted; sidebar polls too).
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock, Phone, Truck, Store, Smartphone, ChefHat, DollarSign,
  ClipboardPaste, Bike, Loader2, AlertCircle, RefreshCw, Send,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const SOURCE_META = {
  mostrador:        { label: 'Mostrador',     icon: Store,           color: '#64748b' },
  telefono:         { label: 'Teléfono',      icon: Phone,           color: '#0ea5e9' },
  pedidos_ya:       { label: 'Pedidos Ya',    icon: ClipboardPaste,  color: '#FA0050' },
  uber_eats:        { label: 'Uber Eats',     icon: ClipboardPaste,  color: '#06C167' },
  delivery_propio:  { label: 'Delivery propio', icon: Bike,          color: '#b3001e' },
  pos:              { label: 'POS',           icon: Store,           color: '#64748b' }, // legacy
}

function fmtRD(n) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', minimumFractionDigits: 2 }).format(Number(n || 0))
}

function elapsedMinutes(iso) {
  if (!iso) return 0
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

function statusColor(elapsed, kdsReady) {
  if (kdsReady) return { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/30', label: 'LISTO' }
  if (elapsed >= 25) return { text: 'text-[#b3001e]', bg: 'bg-[#b3001e]/5', border: 'border-[#b3001e]/30', label: 'DEMORADO' }
  return { text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/30', label: 'EN COCINA' }
}

// Parse the structured phone-order prefix from notes:
//   "📞 Juan Mendez · 809-555-0123 · ETA 15min"
function parseNotes(notes) {
  if (!notes) return null
  const m = String(notes).match(/^📞\s*([^·]+)(?:·\s*([\d\-+()\s]{8,}))?(?:·\s*ETA\s*(\d+)\s*min)?/i)
  if (!m) return null
  return {
    name:  (m[1] || '').trim(),
    phone: (m[2] || '').replace(/[^\d]/g, '') || null,
    eta_minutes: m[3] ? Number(m[3]) : null,
  }
}

function waLink(phone, name, docNumber, ready) {
  if (!phone) return null
  const cleaned = String(phone).replace(/\D/g, '')
  const e164 = cleaned.length === 10 ? '1' + cleaned : cleaned
  const txt = ready
    ? `¡Hola ${name || ''}! Tu orden ${docNumber} está LISTA para retirar. Gracias!`
    : `¡Hola ${name || ''}! Tu orden ${docNumber} está confirmada. Te avisamos cuando esté lista.`
  return `https://wa.me/${e164}?text=${encodeURIComponent(txt)}`
}

export default function Pendientes() {
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busyId, setBusyId]   = useState(null)
  const [tick, setTick]       = useState(0)  // forces re-render every minute for elapsed-time

  const reload = useCallback(async () => {
    try {
      const list = await api.tickets?.listOpen?.({})
      setRows(Array.isArray(list) ? list : [])
      setError(null)
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'foodtruck.pending.reload' }) } catch {}
      setError(e?.message || 'No se pudieron cargar las órdenes pendientes')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { reload() }, [reload])
  // Poll every 20s + bump tick every 60s to keep elapsed-time fresh.
  useEffect(() => {
    const a = setInterval(reload, 20000)
    const b = setInterval(() => setTick(t => t + 1), 60000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [reload])

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [rows, tick])

  // Cobrar directo — load ticket into cart and route to /pos so the cashier
  // sees the cart with banner + Cobrar button. We use sessionStorage as the
  // hand-off (POS reads this on mount; same pattern as restaurant mesa
  // hand-offs).
  const cobrarDirect = (row) => {
    try { sessionStorage.setItem('foodtruck_load_pending', JSON.stringify(row)) } catch (e) {
      try { window.__txReportError?.(e, { severity: 'warn', category: 'foodtruck.pending.cobrar_direct', extra: { id: row?.id } }) } catch {}
    }
    navigate('/pos/')
  }
  const loadToCart = cobrarDirect

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
              <Clock size={22} className="text-[#b3001e]" />
              {L('Órdenes pendientes', 'Pending orders')}
            </h1>
            <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
              {L('Toda orden enviada a cocina sin cobrar todavía. Cárgala al carrito cuando el cliente venga a pagar.',
                 'Every order fired to kitchen but not yet paid. Load to cart when the customer arrives.')}
            </p>
          </div>
          <button
            type="button" onClick={() => { setLoading(true); reload() }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[12px] font-bold hover:border-slate-300 dark:hover:border-white/20"
          >
            <RefreshCw size={13} /> {L('Refrescar', 'Refresh')}
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/20 flex items-center gap-2 text-[#b3001e] text-[13px]">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/30">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-dashed border-slate-200 dark:border-white/10 p-10 text-center">
            <Truck size={32} className="mx-auto text-slate-300 dark:text-white/20 mb-3" />
            <p className="text-[14px] font-bold text-slate-700 dark:text-white/70">{L('No hay órdenes pendientes', 'No pending orders')}</p>
            <p className="text-[12px] text-slate-500 dark:text-white/40 mt-1">{L('Las órdenes aparecen aquí cuando le das "Cocina" en el POS sin cobrar todavía.',
                                                                                  'Orders show up here when you press "Kitchen" without charging yet.')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sorted.map(r => {
              const meta     = SOURCE_META[r.order_source] || SOURCE_META.mostrador
              const SrcIcon  = meta.icon
              const elapsed  = elapsedMinutes(r.created_at)
              const kdsReady = false  // optional refinement: query kds_events for this ticket
              const status   = statusColor(elapsed, kdsReady)
              const phoneInfo = parseNotes(r.notes)
              const wa = phoneInfo?.phone ? waLink(phoneInfo.phone, phoneInfo.name, r.doc_number, kdsReady) : null
              const busy = busyId === r.supabase_id

              return (
                <div key={r.supabase_id} className={`rounded-2xl border ${status.border} ${status.bg} p-4 transition-shadow hover:shadow-md`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider"
                          style={{ color: meta.color, background: meta.color + '18' }}
                        >
                          <SrcIcon size={11} /> {meta.label}
                        </span>
                        <p className="text-[11px] font-mono text-slate-400 dark:text-white/30 uppercase">{r.doc_number}</p>
                      </div>
                      <p className="text-[15px] font-extrabold text-slate-900 dark:text-white truncate">
                        {phoneInfo?.name || L('Cliente sin nombre', 'Walk-up customer')}
                      </p>
                      {phoneInfo?.phone && (
                        <p className="text-[11px] font-mono text-slate-500 dark:text-white/50 mt-0.5">{phoneInfo.phone}</p>
                      )}
                    </div>
                    <span className={`text-[10px] font-extrabold tracking-[1.5px] uppercase ${status.text} whitespace-nowrap`}>{status.label}</span>
                  </div>

                  {Array.isArray(r.items) && r.items.length > 0 && (
                    <ul className="mb-3 space-y-0.5 text-[12px] text-slate-700 dark:text-white/70">
                      {r.items.slice(0, 4).map((it, idx) => (
                        <li key={idx} className="truncate">
                          <span className="font-bold tabular-nums">{it.quantity}×</span>{' '}
                          <span className="font-semibold">{it.name}</span>
                          {it.preparation_notes && (
                            <span className="text-[11px] text-slate-500 dark:text-white/40 italic"> · {it.preparation_notes}</span>
                          )}
                        </li>
                      ))}
                      {r.items.length > 4 && (
                        <li className="text-[11px] text-slate-400 dark:text-white/30">+{r.items.length - 4} más…</li>
                      )}
                    </ul>
                  )}

                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-white/50">
                      <Clock size={11} /> {elapsed} min
                    </span>
                    {phoneInfo?.eta_minutes && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-white/50">
                        ETA {phoneInfo.eta_minutes}m
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mb-3 pt-3 border-t border-slate-100 dark:border-white/10">
                    <span className="text-[11px] text-slate-500 dark:text-white/50">
                      {r.item_count || 0} {L((r.item_count === 1 ? 'item' : 'items'), (r.item_count === 1 ? 'item' : 'items'))}
                    </span>
                    <span className="text-[15px] font-extrabold tabular-nums text-slate-900 dark:text-white">
                      {fmtRD(r.running_total)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => loadToCart(r)}
                      className="py-2 rounded-xl border-2 border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e]/5 dark:hover:bg-[#b3001e]/10 text-[12px] font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-40"
                    >
                      <Send size={12} /> {L('Cargar', 'Load')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => cobrarDirect(r)}
                      className="py-2 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white text-[12px] font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-40"
                    >
                      <DollarSign size={12} /> {L('Cobrar', 'Charge')}
                    </button>
                  </div>

                  {wa && (
                    <a
                      href={wa} target="_blank" rel="noopener noreferrer"
                      className="mt-2 w-full py-2 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-[12px] font-extrabold flex items-center justify-center gap-1.5"
                    >
                      <Smartphone size={12} /> {L('WhatsApp', 'WhatsApp')}
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
