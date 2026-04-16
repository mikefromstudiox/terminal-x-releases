import { useState, useMemo, useEffect } from 'react'
import { X, Users, Banknote, CreditCard, ArrowRightLeft, Check, Plus, Minus } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  const v = Number.isFinite(n) ? n : 0
  return `RD$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const METHODS = [
  { id: 'efectivo',      label: 'Efectivo',      icon: Banknote },
  { id: 'tarjeta',       label: 'Tarjeta',       icon: CreditCard },
  { id: 'transferencia', label: 'Transferencia', icon: ArrowRightLeft },
]

const MIN_PARTS = 2
const MAX_PARTS = 10

/**
 * SplitBillModal — equal N-way split across payment methods.
 *
 * Props:
 *   open          : boolean
 *   onClose()     : fn
 *   totalAmount   : number — full ticket total including tip, in pesos
 *   onPay(parts)  : fn — parts is [{ amount, method }, ...]
 *
 * NOTE: the downstream ticket API today accepts a single payment_method per ticket.
 * The caller records the split parts but sets the ticket's primary payment_method
 * to parts[0].method. When the backend gains multi-payment support, extend
 * api.tickets.create to accept the full parts[] array unchanged.
 */
export default function SplitBillModal({ open, onClose, totalAmount = 0, onPay }) {
  const [parts, setParts] = useState(2)
  const [methods, setMethods] = useState(Array.from({ length: 2 }, () => 'efectivo'))

  useEffect(() => {
    if (open) {
      setParts(2)
      setMethods(['efectivo', 'efectivo'])
    }
  }, [open])

  // Keep methods array in sync with parts count
  useEffect(() => {
    setMethods(prev => {
      if (prev.length === parts) return prev
      if (prev.length < parts) return [...prev, ...Array.from({ length: parts - prev.length }, () => 'efectivo')]
      return prev.slice(0, parts)
    })
  }, [parts])

  const { perPart, amounts } = useMemo(() => {
    const totalCents = Math.round(totalAmount * 100)
    const base = Math.floor(totalCents / parts)
    const remainder = totalCents - base * parts
    const arr = Array.from({ length: parts }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100)
    return { perPart: base / 100, amounts: arr }
  }, [totalAmount, parts])

  const setPartMethod = (idx, method) => {
    setMethods(prev => prev.map((m, i) => (i === idx ? method : m)))
  }

  const handlePay = () => {
    const payload = amounts.map((amount, i) => ({ amount, method: methods[i] }))
    onPay(payload)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600/15 border border-red-600/30 flex items-center justify-center">
              <Users size={18} className="text-red-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">Dividir Cuenta</div>
              <div className="text-xs text-white/50 mt-0.5">Total: {fmtRD(totalAmount)}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Parts selector */}
          <div>
            <div className="text-sm font-medium text-white/70 mb-2">
              ¿En cuántas partes dividir?
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setParts(p => Math.max(MIN_PARTS, p - 1))}
                disabled={parts <= MIN_PARTS}
                className="w-12 h-12 rounded-xl bg-zinc-900 border border-white/10 text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <Minus size={18} />
              </button>
              <div className="flex-1 bg-zinc-900 border border-white/10 rounded-xl py-3 text-center">
                <div className="text-2xl font-bold text-white">{parts}</div>
                <div className="text-[10px] text-white/50 uppercase tracking-wider">partes</div>
              </div>
              <button
                onClick={() => setParts(p => Math.min(MAX_PARTS, p + 1))}
                disabled={parts >= MAX_PARTS}
                className="w-12 h-12 rounded-xl bg-zinc-900 border border-white/10 text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="mt-2 text-xs text-white/50">
              Monto por parte: <span className="text-white font-semibold">{fmtRD(perPart)}</span>
              {amounts.some(a => a !== perPart) && (
                <span className="ml-2 text-amber-400">
                  (ajuste de centavos aplicado)
                </span>
              )}
            </div>
          </div>

          {/* Parts list */}
          <div className="space-y-2">
            {amounts.map((amt, i) => (
              <div
                key={i}
                className="bg-zinc-900 rounded-xl p-3 border border-white/5"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-white">
                    Parte {i + 1}
                  </div>
                  <div className="text-white font-bold">{fmtRD(amt)}</div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {METHODS.map(m => {
                    const Icon = m.icon
                    const active = methods[i] === m.id
                    return (
                      <button
                        key={m.id}
                        onClick={() => setPartMethod(i, m.id)}
                        className={`py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                          active
                            ? 'bg-red-600 border-red-500 text-white'
                            : 'bg-zinc-950 border-white/10 text-white/60 hover:border-white/30'
                        }`}
                      >
                        <Icon size={13} />
                        <span className="hidden sm:inline">{m.label}</span>
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
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-white/10 text-white/70 hover:bg-white/5 font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handlePay}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center justify-center gap-2"
          >
            <Check size={18} /> Cobrar {parts} partes
          </button>
        </div>
      </div>
    </div>
  )
}
