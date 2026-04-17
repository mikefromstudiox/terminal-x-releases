import { useState, useMemo, useEffect } from 'react'
import { X, Users, Check, ChevronLeft, ChevronRight, Banknote, CreditCard, ArrowRightLeft } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  const v = Number.isFinite(n) ? n : 0
  return `RD$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const METHODS = [
  { id: 'efectivo',      label: 'Efectivo',      icon: Banknote },
  { id: 'tarjeta',       label: 'Tarjeta',       icon: CreditCard },
  { id: 'transferencia', label: 'Transf.',       icon: ArrowRightLeft },
]

/**
 * SplitByItemModal — guest-level itemized split.
 *
 * Every cart line lands in guest #1 by default; waiter taps < > arrows to
 * move it to any guest. Tip (if any) is split evenly across guests with
 * any assigned items. Each guest gets a discrete payment method.
 *
 * Props:
 *   open         : boolean
 *   onClose()    : fn
 *   items        : [{ local_id, name, price, qty, modifiers?: [{price_delta}] }]
 *   guestsCount  : number (default 2) — initial column count
 *   tipAmount    : number — pooled tip in pesos
 *   onPay(parts) : fn — parts is [{ amount, method, guest_number }]
 */
export default function SplitByItemModal({
  open, onClose, items = [], guestsCount = 2, tipAmount = 0, onPay,
}) {
  const [guests, setGuests] = useState(Math.max(2, guestsCount))
  // assignment: local_id → guestIdx (0-based)
  const [assignment, setAssignment] = useState({})
  const [methods, setMethods] = useState([])

  useEffect(() => {
    if (open) {
      const g = Math.max(2, guestsCount || 2)
      setGuests(g)
      const a = {}
      for (const it of items) a[it.local_id] = 0
      setAssignment(a)
      setMethods(Array.from({ length: g }, () => 'efectivo'))
    }
  }, [open, items, guestsCount])

  useEffect(() => {
    setMethods(prev => {
      if (prev.length === guests) return prev
      if (prev.length < guests) return [...prev, ...Array.from({ length: guests - prev.length }, () => 'efectivo')]
      return prev.slice(0, guests)
    })
    setAssignment(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) if (next[k] >= guests) next[k] = guests - 1
      return next
    })
  }, [guests])

  const lineTotal = (it) => {
    const modSum = (it.modifiers || []).reduce((x, m) => x + Number(m.price_delta || 0), 0)
    return (Number(it.price) + modSum) * Number(it.qty || 1)
  }

  const { perGuestSubtotal, perGuestTip, perGuestTotal, guestsWithItems } = useMemo(() => {
    const sub = Array.from({ length: guests }, () => 0)
    for (const it of items) {
      const g = Math.min(guests - 1, assignment[it.local_id] ?? 0)
      sub[g] += lineTotal(it)
    }
    const withItems = sub.map(s => s > 0).filter(Boolean).length
    const tipCents = Math.round(Number(tipAmount || 0) * 100)
    const tipPer = withItems > 0 ? Math.floor(tipCents / withItems) / 100 : 0
    const rem = withItems > 0 ? (tipCents - Math.floor(tipCents / withItems) * withItems) / 100 : 0
    let remLeft = Math.round(rem * 100)
    const tipArr = sub.map(s => {
      if (s <= 0) return 0
      let t = tipPer
      if (remLeft > 0) { t += 0.01; remLeft -= 1 }
      return t
    })
    const totals = sub.map((s, i) => s + (tipArr[i] || 0))
    return { perGuestSubtotal: sub, perGuestTip: tipArr, perGuestTotal: totals, guestsWithItems: withItems }
  }, [items, assignment, guests, tipAmount])

  const move = (localId, delta) => {
    setAssignment(prev => {
      const cur = prev[localId] ?? 0
      const next = (cur + delta + guests) % guests
      return { ...prev, [localId]: next }
    })
  }

  const setMethod = (idx, m) => setMethods(prev => prev.map((x, i) => i === idx ? m : x))

  const handlePay = () => {
    const parts = perGuestTotal
      .map((amount, i) => ({ amount, method: methods[i] || 'efectivo', guest_number: i + 1 }))
      .filter(p => p.amount > 0)
    onPay(parts, assignment)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-3xl bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600/15 border border-red-600/30 flex items-center justify-center">
              <Users size={18} className="text-[#b3001e]" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">Dividir por comensal</div>
              <div className="text-xs text-white/50 mt-0.5">
                Asigna cada plato a un comensal. La propina se divide entre quienes tengan consumo.
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Guest count adjust */}
          <div className="flex items-center gap-3">
            <div className="text-sm text-white/70">Comensales:</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGuests(g => Math.max(2, g - 1))}
                disabled={guests <= 2}
                className="w-8 h-8 rounded-lg bg-zinc-900 border border-white/10 text-white hover:border-white/30 disabled:opacity-30 flex items-center justify-center"
              >−</button>
              <div className="min-w-[2.5rem] text-center text-lg font-bold text-white">{guests}</div>
              <button
                onClick={() => setGuests(g => Math.min(10, g + 1))}
                disabled={guests >= 10}
                className="w-8 h-8 rounded-lg bg-zinc-900 border border-white/10 text-white hover:border-white/30 disabled:opacity-30 flex items-center justify-center"
              >+</button>
            </div>
          </div>

          {/* Items list with guest toggler */}
          <div className="space-y-2">
            {items.map(it => {
              const g = assignment[it.local_id] ?? 0
              const total = lineTotal(it)
              return (
                <div key={it.local_id} className="bg-zinc-900 rounded-xl p-3 border border-white/5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{it.name}</div>
                    <div className="text-[11px] text-white/50">{it.qty} × {fmtRD(total / Number(it.qty || 1))}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => move(it.local_id, -1)}
                      className="w-7 h-7 rounded-lg bg-zinc-950 border border-white/10 hover:border-white/30 text-white flex items-center justify-center"
                    ><ChevronLeft size={14} /></button>
                    <div className="min-w-[3.5rem] text-center text-xs font-bold text-white uppercase tracking-wider">
                      Com. {g + 1}
                    </div>
                    <button
                      onClick={() => move(it.local_id, 1)}
                      className="w-7 h-7 rounded-lg bg-zinc-950 border border-white/10 hover:border-white/30 text-white flex items-center justify-center"
                    ><ChevronRight size={14} /></button>
                  </div>
                  <div className="w-20 text-right text-white font-bold text-sm">{fmtRD(total)}</div>
                </div>
              )
            })}
          </div>

          {/* Guest totals + payment methods */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
            {Array.from({ length: guests }, (_, i) => (
              <div key={i} className={`bg-zinc-900 rounded-xl p-3 border ${perGuestSubtotal[i] > 0 ? 'border-red-600/30' : 'border-white/5 opacity-60'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-white">Comensal {i + 1}</div>
                  <div className="text-white font-bold">{fmtRD(perGuestTotal[i])}</div>
                </div>
                <div className="text-[11px] text-white/50 mb-2">
                  Subtotal {fmtRD(perGuestSubtotal[i])}
                  {perGuestTip[i] > 0 && <> · Propina {fmtRD(perGuestTip[i])}</>}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {METHODS.map(m => {
                    const Icon = m.icon
                    const active = methods[i] === m.id
                    return (
                      <button
                        key={m.id}
                        onClick={() => setMethod(i, m.id)}
                        disabled={perGuestSubtotal[i] <= 0}
                        className={`py-1.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 transition-colors disabled:opacity-40 ${
                          active
                            ? 'bg-[#b3001e] border-[#b3001e] text-white'
                            : 'bg-zinc-950 border-white/10 text-white/60 hover:border-white/30'
                        }`}
                      >
                        <Icon size={11} /><span>{m.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10 bg-zinc-900/50">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-white/70 hover:bg-white/5 font-medium">
            Cancelar
          </button>
          <button
            onClick={handlePay}
            disabled={guestsWithItems === 0}
            className="flex-1 py-3 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Check size={18} /> Cobrar {guestsWithItems} comensales
          </button>
        </div>
      </div>
    </div>
  )
}
