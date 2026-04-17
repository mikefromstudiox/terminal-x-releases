// WeightModal — carniceria weight entry.
// Numeric keypad + optional tare + live line-total preview.
// Renders RD$/unit × weight = total with aerospace-grade rounding (2 dp).

import { useEffect, useMemo, useState } from 'react'
import { Scale, X, Delete } from 'lucide-react'
import { parseWeight, applyTare } from '../../services/scale.js'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function WeightModal({ product, onConfirm, onClose }) {
  const unit        = product?.unit || 'lb'
  const pricePerUnit = Number(product?.price_per_unit ?? product?.price ?? 0)
  const tareDefault  = Number(product?.tare_default || 0)
  const [raw, setRaw]       = useState('')
  const [tare, setTare]     = useState(tareDefault ? String(tareDefault) : '')
  const [showTare, setShowTare] = useState(!!tareDefault)

  const gross = parseWeight(raw)
  const tareN = parseWeight(tare) || 0
  const net   = gross != null ? applyTare(gross, tareN) : 0
  const total = useMemo(() => Math.round(net * pricePerUnit * 100) / 100, [net, pricePerUnit])

  const canConfirm = gross != null && net > 0 && pricePerUnit > 0

  function push(ch) {
    if (ch === '.') {
      if (raw.includes('.')) return
      setRaw(r => (r === '' ? '0.' : r + '.'))
      return
    }
    setRaw(r => {
      const next = r + ch
      // clamp at 3 decimals
      if (/\.\d{4,}/.test(next)) return r
      // clamp at 9999.999
      if (Number(next) > 9999.999) return r
      return next
    })
  }
  function backspace() { setRaw(r => r.slice(0, -1)) }
  function clearAll()  { setRaw('') }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'Enter' && canConfirm) { e.preventDefault(); confirm() }
      else if (/^[0-9]$/.test(e.key)) { e.preventDefault(); push(e.key) }
      else if (e.key === '.' || e.key === ',') { e.preventDefault(); push('.') }
      else if (e.key === 'Backspace') { e.preventDefault(); backspace() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canConfirm, raw])

  function confirm() {
    if (!canConfirm) return
    onConfirm({
      weight:         net,
      unit,
      price_per_unit: pricePerUnit,
      line_total:     total,
    })
  }

  const Btn = ({ label, onClick, className = '' }) => (
    <button type="button" onClick={onClick}
      className={`h-14 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[22px] font-bold text-slate-800 dark:text-white active:scale-95 transition-all ${className}`}>
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/10 bg-[#b3001e]/5">
          <div className="flex items-center gap-2">
            <Scale size={17} className="text-[#b3001e]" />
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Pesar producto</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-5 pt-4 pb-2">
          <p className="text-[15px] font-semibold text-slate-800 dark:text-white leading-tight">{product?.name}</p>
          <p className="text-[12px] text-slate-500 dark:text-white/50 mt-0.5">
            {fmtRD(pricePerUnit)} / {unit}
          </p>
        </div>

        {/* Weight display */}
        <div className="mx-5 my-2 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 text-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Peso neto</p>
          <p className="text-[38px] font-black text-slate-800 dark:text-white tabular-nums leading-none mt-1">
            {net > 0 ? net.toFixed(3) : '0.000'} <span className="text-[16px] font-bold text-slate-400">{unit}</span>
          </p>
          {tareN > 0 && gross != null && (
            <p className="text-[10px] text-slate-400 mt-1">Bruto {gross.toFixed(3)} − Tara {tareN.toFixed(3)}</p>
          )}
          <p className="text-[20px] font-bold text-[#b3001e] mt-2 tabular-nums">= {fmtRD(total)}</p>
        </div>

        {/* Tare toggle */}
        <div className="px-5 pt-1 pb-2">
          <button onClick={() => setShowTare(s => !s)}
            className="text-[11px] font-semibold text-slate-500 dark:text-white/50 hover:text-[#b3001e]">
            {showTare ? '− Ocultar tara' : '+ Agregar tara (envase)'}
          </button>
          {showTare && (
            <input type="text" inputMode="decimal" value={tare}
              onChange={e => setTare(e.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder={`0.000 ${unit}`}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[13px] font-medium text-slate-800 dark:text-white text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
          )}
        </div>

        {/* Keypad */}
        <div className="px-5 pb-4 grid grid-cols-3 gap-2">
          {['7','8','9','4','5','6','1','2','3'].map(n =>
            <Btn key={n} label={n} onClick={() => push(n)} />
          )}
          <Btn label="." onClick={() => push('.')} />
          <Btn label="0" onClick={() => push('0')} />
          <button type="button" onClick={backspace}
            className="h-14 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-red-100 dark:hover:bg-red-500/20 text-slate-800 dark:text-white hover:text-red-500 flex items-center justify-center active:scale-95 transition-all">
            <Delete size={20} />
          </button>
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button onClick={clearAll}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-[13px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5">
            Limpiar
          </button>
          <button onClick={confirm} disabled={!canConfirm}
            className="flex-[2] py-3 rounded-xl bg-[#b3001e] hover:bg-[#c8002a] disabled:opacity-40 text-white text-[14px] font-bold">
            Agregar — {fmtRD(total)}
          </button>
        </div>
      </div>
    </div>
  )
}
