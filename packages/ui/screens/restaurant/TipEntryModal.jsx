import { useState, useMemo, useEffect } from 'react'
import { X, Percent, DollarSign, Check } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  const v = Number.isFinite(n) ? n : 0
  return `RD$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const PERCENT_CHIPS = [0, 10, 15, 20]

/**
 * TipEntryModal — prompts the waiter for a tip before cobro.
 *
 * Props:
 *   open        : boolean
 *   onClose()   : fn
 *   subtotal    : number (pre-tip total, in pesos)
 *   onConfirm(tipAmountInPesos)  : fn
 */
export default function TipEntryModal({ open, onClose, subtotal = 0, onConfirm }) {
  const [mode, setMode]         = useState('percent')    // 'percent' | 'custom'
  const [percent, setPercent]   = useState(10)
  const [customVal, setCustomVal] = useState('')
  const [customKind, setCustomKind] = useState('pesos')  // 'pesos' | 'percent'

  useEffect(() => {
    if (open) {
      setMode('percent')
      setPercent(10)
      setCustomVal('')
      setCustomKind('pesos')
    }
  }, [open])

  const tipAmount = useMemo(() => {
    if (mode === 'percent') {
      return Math.round((subtotal * percent) / 100 * 100) / 100
    }
    const n = parseFloat(customVal)
    if (!Number.isFinite(n) || n < 0) return 0
    if (customKind === 'percent') return Math.round((subtotal * n) / 100 * 100) / 100
    return Math.round(n * 100) / 100
  }, [mode, percent, customVal, customKind, subtotal])

  const finalTotal = subtotal + tipAmount

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <div className="text-lg font-bold text-white">Propina</div>
            <div className="text-xs text-white/50 mt-0.5">Subtotal: {fmtRD(subtotal)}</div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Percent chips */}
          <div className="grid grid-cols-4 gap-2">
            {PERCENT_CHIPS.map(p => {
              const active = mode === 'percent' && percent === p
              return (
                <button
                  key={p}
                  onClick={() => { setMode('percent'); setPercent(p) }}
                  className={`py-3 rounded-xl border text-center transition-colors ${
                    active
                      ? 'bg-red-600 border-red-500 text-white'
                      : 'bg-zinc-900 border-white/10 text-white/70 hover:border-white/30'
                  }`}
                >
                  <div className="text-lg font-bold">{p}%</div>
                  <div className="text-[10px] opacity-75 mt-0.5">
                    {fmtRD((subtotal * p) / 100)}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Custom */}
          <div>
            <button
              onClick={() => setMode('custom')}
              className={`w-full py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                mode === 'custom'
                  ? 'bg-red-600 border-red-500 text-white'
                  : 'bg-zinc-900 border-white/10 text-white/70 hover:border-white/30'
              }`}
            >
              Personalizado
            </button>

            {mode === 'custom' && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setCustomKind('pesos')}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                      customKind === 'pesos'
                        ? 'bg-white/10 border-white/30 text-white'
                        : 'bg-zinc-900 border-white/10 text-white/50'
                    }`}
                  >
                    <DollarSign size={14} /> Pesos
                  </button>
                  <button
                    onClick={() => setCustomKind('percent')}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                      customKind === 'percent'
                        ? 'bg-white/10 border-white/30 text-white'
                        : 'bg-zinc-900 border-white/10 text-white/50'
                    }`}
                  >
                    <Percent size={14} /> Porcentaje
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step={customKind === 'percent' ? '1' : '10'}
                  value={customVal}
                  onChange={e => setCustomVal(e.target.value)}
                  autoFocus
                  placeholder={customKind === 'percent' ? 'Ej. 12' : 'Ej. 200'}
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-white/30 focus:outline-none focus:border-red-500"
                />
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="bg-zinc-900 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60">Propina</span>
              <span className="text-white font-semibold">{fmtRD(tipAmount)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60">Subtotal</span>
              <span className="text-white">{fmtRD(subtotal)}</span>
            </div>
            <div className="h-px bg-white/10 my-1" />
            <div className="flex items-center justify-between">
              <span className="text-white/80 font-semibold">Total</span>
              <span className="text-white text-xl font-bold">{fmtRD(finalTotal)}</span>
            </div>
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
            onClick={() => onConfirm(tipAmount)}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center justify-center gap-2"
          >
            <Check size={18} /> Continuar
          </button>
        </div>
      </div>
    </div>
  )
}
