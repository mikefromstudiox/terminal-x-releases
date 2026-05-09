// AggregatorPasteModal — paste an order from Pedidos Ya / Uber Eats and the
// regex parser extracts items + customer + total + ETA. Shown when the
// cashier picks Pedidos Ya / Uber Eats from the FoodTruckPOS source pill row.
//
// The parser is intentionally forgiving — it handles the most common formats
// (PY shopping-cart text export and Uber Eats order copy) and falls back to
// best-guess line-by-line parsing for anything else. Cashier always sees the
// preview and can edit before confirming.
//
// Returns: { items: [{name, qty, price}], customer_name, customer_phone,
//            total, eta_minutes, raw } via onConfirm(parsed, channel).
import { useState, useEffect, useMemo, useRef } from 'react'
import { X, ClipboardPaste, AlertCircle, Check } from 'lucide-react'

// Per-channel display config + parser hints.
const CHANNEL_META = {
  pedidos_ya: { label: 'Pedidos Ya', color: '#FA0050', placeholder: `2x Chimi clásico — RD$440\n1x Refresco lata — RD$60\nCliente: Juan Mendez\nTel: 809-555-0123\nETA: 25 min\nTotal: RD$500` },
  uber_eats:  { label: 'Uber Eats',  color: '#06C167', placeholder: `1× Yaroa de pollo  $280\n1× Tostones con salsa $140\nCustomer: Maria Pena\nPhone: 829-444-1212\nTotal $420` },
}

// Forgiving line parser. Handles:
//   "2x Chimi clásico — RD$440"
//   "1× Yaroa de pollo  $280"
//   "  3 x  Refresco        60"
//   "Tostones con salsa - $140"
function parseItemLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return null
  // Skip obvious non-item lines.
  if (/^(cliente|customer|tel|phone|total|subtotal|eta|fecha|date|orden|order|delivery|propina|tip|driver|repartidor)\b/i.test(trimmed)) return null

  // Try: "QTY x|× NAME  PRICE"
  let m = trimmed.match(/^(\d+)\s*[x×]\s+(.+?)[\s—\-:]+(?:RD\$|\$)?\s*([\d.,]+)$/i)
  if (m) return { qty: parseInt(m[1], 10) || 1, name: m[2].trim().replace(/\s{2,}/g, ' '), price: parseFloat(m[3].replace(/[,.]/g, m[3].lastIndexOf(',') > m[3].lastIndexOf('.') ? '.' : '')) || 0 }

  // Try: "NAME  PRICE" (qty defaults to 1)
  m = trimmed.match(/^(.+?)[\s—\-:]+(?:RD\$|\$)?\s*([\d.,]+)$/)
  if (m && !/^[\d.,]+$/.test(m[1])) {
    return { qty: 1, name: m[1].trim().replace(/\s{2,}/g, ' '), price: parseFloat(m[2].replace(/[,.]/g, m[2].lastIndexOf(',') > m[2].lastIndexOf('.') ? '.' : '')) || 0 }
  }
  return null
}

function parsePaste(raw) {
  if (!raw || !raw.trim()) return { items: [], customer_name: '', customer_phone: '', total: 0, eta_minutes: null }
  const lines = raw.split(/\r?\n/)
  const items = []
  let customer_name = ''
  let customer_phone = ''
  let total = 0
  let eta_minutes = null
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    // Customer name
    let m = t.match(/^(?:cliente|customer|nombre|name)\s*[:\-]\s*(.+)$/i)
    if (m && !customer_name) { customer_name = m[1].trim(); continue }
    // Phone
    m = t.match(/^(?:tel(?:efono)?|phone|cel(?:ular)?)\s*[:\-]?\s*([+\d().\s\-]{8,})$/i)
    if (m && !customer_phone) { customer_phone = m[1].replace(/[^\d]/g, ''); continue }
    // Total
    m = t.match(/^(?:total|monto)\s*[:\-]?\s*(?:RD\$|\$)?\s*([\d.,]+)$/i)
    if (m) { total = parseFloat(m[1].replace(/[,.]/g, m[1].lastIndexOf(',') > m[1].lastIndexOf('.') ? '.' : '')) || total; continue }
    // ETA
    m = t.match(/^eta\s*[:\-]?\s*(\d+)\s*(?:min|minutos)?$/i)
    if (m) { eta_minutes = parseInt(m[1], 10); continue }
    // Item
    const item = parseItemLine(t)
    if (item) items.push(item)
  }
  if (!total && items.length) total = items.reduce((s, it) => s + it.price * it.qty, 0)
  return { items, customer_name, customer_phone, total, eta_minutes }
}

export default function AggregatorPasteModal({ channel = 'pedidos_ya', services = [], onConfirm, onClose }) {
  const [raw, setRaw] = useState('')
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])

  const meta = CHANNEL_META[channel] || CHANNEL_META.pedidos_ya
  const parsed = useMemo(() => parsePaste(raw), [raw])

  // Match each parsed item against the live services list (case-insensitive).
  const matched = useMemo(() => parsed.items.map(it => {
    const svc = services.find(s => (s.name || '').toLowerCase() === (it.name || '').toLowerCase())
    return { ...it, matched: !!svc, service_id: svc?.id || null, service_supabase_id: svc?.supabase_id || null }
  }), [parsed.items, services])

  const allMatched = matched.length > 0 && matched.every(m => m.matched)
  const submit = () => {
    if (!matched.length) return
    onConfirm({ ...parsed, items: matched, raw }, channel)
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-black rounded-2xl shadow-2xl w-full max-w-3xl border border-slate-200 dark:border-white/10 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/10">
          <div className="flex items-center gap-2">
            <ClipboardPaste size={16} style={{ color: meta.color }} />
            <h2 className="text-[15px] font-extrabold text-slate-900 dark:text-white">Pegar orden de {meta.label}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 flex-1 min-h-0 overflow-hidden">
          {/* Paste area */}
          <div className="p-5 border-r border-slate-100 dark:border-white/10 flex flex-col min-h-0">
            <label className="block text-[11px] font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase mb-2">Pega aquí</label>
            <textarea
              ref={ref}
              value={raw} onChange={e => setRaw(e.target.value)}
              placeholder={meta.placeholder}
              className="flex-1 min-h-[260px] px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white text-[13px] font-mono focus:border-[#b3001e] focus:outline-none resize-none"
            />
          </div>

          {/* Live preview */}
          <div className="p-5 flex flex-col min-h-0">
            <label className="block text-[11px] font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase mb-2">Vista previa</label>

            {!parsed.items.length ? (
              <div className="flex-1 flex items-center justify-center text-center text-slate-400 dark:text-white/30 text-[13px]">
                Pega el texto a la izquierda y aquí verás los items detectados.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                {(parsed.customer_name || parsed.customer_phone) && (
                  <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[12px] text-slate-700 dark:text-white/70">
                    {parsed.customer_name && <span className="font-bold">{parsed.customer_name}</span>}
                    {parsed.customer_phone && <span className="font-mono ml-2">{parsed.customer_phone}</span>}
                    {parsed.eta_minutes && <span className="ml-2 text-slate-500">· ETA {parsed.eta_minutes}m</span>}
                  </div>
                )}
                {matched.map((it, i) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${it.matched
                    ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/5'
                    : 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5'}`}>
                    {it.matched
                      ? <Check size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                      : <AlertCircle size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />}
                    <span className="font-mono text-[11px] text-slate-500 dark:text-white/50 w-8">{it.qty}×</span>
                    <span className="flex-1 text-[13px] text-slate-800 dark:text-white truncate">{it.name}</span>
                    <span className="text-[12px] tabular-nums font-bold text-slate-700 dark:text-white/80">RD$ {it.price.toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 mt-2 rounded-lg bg-slate-100 dark:bg-white/10">
                  <span className="text-[12px] font-extrabold uppercase text-slate-600 dark:text-white/60">Total detectado</span>
                  <span className="text-[15px] font-extrabold tabular-nums text-slate-900 dark:text-white">RD$ {parsed.total.toFixed(2)}</span>
                </div>
                {!allMatched && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300/80 mt-2">
                    Algunos items no aparecen en tu menú. Se enviarán igual a cocina como texto libre — el costo no se descuenta del inventario.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 dark:border-white/10">
          <p className="text-[11px] text-slate-400 dark:text-white/30">El parser tolera diferentes formatos. Revisa antes de enviar.</p>
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-sm font-bold hover:bg-slate-50 dark:hover:bg-white/5"
            >Cancelar</button>
            <button
              type="button" onClick={submit}
              disabled={!matched.length}
              className="px-4 py-2 rounded-xl bg-[#b3001e] hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-extrabold"
            >Cargar al carrito</button>
          </div>
        </div>
      </div>
    </div>
  )
}
