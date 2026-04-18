import { useState, useRef, useEffect } from 'react'
import { Wine, CheckCircle2, X, Calendar, ShieldAlert } from 'lucide-react'

// ── Age verification modal (18+) ───────────────────────────────────────────────
// Triggered the first time a licoreria cart contains an age-restricted item.
// The cashier can either confirm visual ID-check (fast path) or scan/type a
// birth date for compliance. Result persists on the ticket so every line item
// benefits from a single verification. Cancel clears the offending items.
export default function AgeVerifyModal({ minAge = 18, onConfirm, onCancel, productName }) {
  const [mode, setMode]   = useState('id')     // 'id' | 'dob'
  const [dob, setDob]     = useState('')
  const [error, setError] = useState('')
  const firstBtnRef = useRef(null)

  useEffect(() => { firstBtnRef.current?.focus() }, [])

  function handleIdConfirm() {
    onConfirm({ method: 'id_check', minAge, verifiedAt: new Date().toISOString() })
  }

  function handleDobConfirm() {
    if (!dob) { setError('Ingresa la fecha de nacimiento'); return }
    const d = new Date(dob + 'T00:00:00')
    if (Number.isNaN(d.getTime())) { setError('Fecha inválida'); return }
    const now   = new Date()
    let age     = now.getFullYear() - d.getFullYear()
    const m     = now.getMonth() - d.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
    if (age < minAge) { setError(`Cliente tiene ${age} años — no cumple ${minAge}+`); return }
    onConfirm({ method: 'dob', dob, age, minAge, verifiedAt: new Date().toISOString() })
  }

  // Today minus 18y — the ceiling for a valid DOB entry.
  const maxDob = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - minAge)
    return d.toISOString().slice(0, 10)
  })()

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-white dark:bg-black rounded-2xl border-2 border-[#b3001e] shadow-2xl">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="inline-flex w-14 h-14 rounded-full bg-[#b3001e]/10 items-center justify-center mb-3">
            <ShieldAlert size={28} className="text-[#b3001e]" />
          </div>
          <h3 className="text-xl font-black text-black dark:text-white">Verificación de Edad</h3>
          <p className="text-sm text-black/60 dark:text-white/60 mt-1">
            Producto restringido: <span className="font-semibold text-black dark:text-white">{productName}</span>
          </p>
          <p className="text-xs text-black/50 dark:text-white/50 mt-2">
            Debe ser mayor de <strong>{minAge} años</strong> para comprar bebidas alcohólicas (Ley 42-01).
          </p>
        </div>

        <div className="px-6 flex gap-2 border-b border-black/10 dark:border-white/10">
          <button onClick={() => setMode('id')}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              mode === 'id' ? 'border-[#b3001e] text-[#b3001e]' : 'border-transparent text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70'
            }`}>
            Verificar por cédula
          </button>
          <button onClick={() => setMode('dob')}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              mode === 'dob' ? 'border-[#b3001e] text-[#b3001e]' : 'border-transparent text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70'
            }`}>
            Fecha de nacimiento
          </button>
        </div>

        <div className="px-6 py-5">
          {mode === 'id' ? (
            <div className="space-y-3">
              <p className="text-sm text-black/70 dark:text-white/70">
                Confirma que viste la cédula física del cliente y tiene al menos <strong>{minAge} años</strong>.
              </p>
              <button ref={firstBtnRef} onClick={handleIdConfirm}
                className="w-full py-3 bg-[#b3001e] hover:bg-[#c8002a] text-white font-bold rounded-xl flex items-center justify-center gap-2">
                <CheckCircle2 size={18} /> Sí, verifiqué — continuar
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-black/60 dark:text-white/60 mb-1">
                Fecha de nacimiento
              </label>
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40 pointer-events-none" />
                <input ref={firstBtnRef} type="date" value={dob} max={maxDob}
                  onChange={e => { setDob(e.target.value); setError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleDobConfirm() }}
                  className="w-full pl-11 pr-3 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30 focus:border-[#b3001e]" />
              </div>
              {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
              <button onClick={handleDobConfirm}
                className="w-full py-3 bg-[#b3001e] hover:bg-[#c8002a] text-white font-bold rounded-xl flex items-center justify-center gap-2">
                <CheckCircle2 size={18} /> Verificar y continuar
              </button>
            </div>
          )}
        </div>

        <div className="px-6 pb-5 pt-1">
          <button onClick={onCancel}
            className="w-full py-2.5 text-sm font-medium text-black/60 dark:text-white/60 hover:text-[#b3001e] flex items-center justify-center gap-2">
            <X size={15} /> Cancelar — retirar del carrito
          </button>
        </div>
      </div>
    </div>
  )
}

// Helper — given a licoreriaConfig and an inventory item, does it require 18+?
export function requiresAgeCheck(config, item) {
  if (!config?.ageVerification?.enabled) return false
  const trigger = (config.ageVerification.triggerCategories || []).map(s => String(s).toLowerCase())
  const cat = String(item?.category || '').toLowerCase().trim()
  if (!cat) return false
  return trigger.some(t => cat === t || cat.includes(t))
}
