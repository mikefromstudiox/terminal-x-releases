// PhoneOrderCaptureModal — captures customer info for non-walk-up orders.
// Shown when the cashier picks Teléfono / Delivery propio from the
// FoodTruckPOS source pill row. Mandatory name + phone, optional ETA + notes.
//
// Returns: { name, phone, eta_minutes, notes } via onConfirm(info, pendingSource).
import { useState, useEffect, useRef } from 'react'
import { X, Phone, Clock, AlertCircle } from 'lucide-react'

const ETA_OPTIONS = [10, 15, 20, 30, 45, 60]

export default function PhoneOrderCaptureModal({ pendingSource, onConfirm, onClose }) {
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [eta, setEta]     = useState(15)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const nameRef = useRef(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  const sourceLabel = ({
    telefono:        'Teléfono',
    delivery_propio: 'Delivery propio',
    pedidos_ya:      'Pedidos Ya',
    uber_eats:       'Uber Eats',
  })[pendingSource] || 'Pedido'

  const submit = () => {
    const cleanName  = name.trim()
    const cleanPhone = phone.replace(/[^0-9]/g, '')
    if (!cleanName)   { setError('Nombre requerido'); return }
    if (cleanPhone.length < 10) { setError('Teléfono requerido (mínimo 10 dígitos)'); return }
    onConfirm({ name: cleanName, phone: cleanPhone, eta_minutes: Number(eta) || null, notes: notes.trim() || null }, pendingSource)
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-black rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-white/10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Phone size={16} className="text-[#b3001e]" />
            <h2 className="text-[15px] font-extrabold text-slate-900 dark:text-white">Orden por {sourceLabel}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[11px] font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase mb-1.5">Nombre *</label>
            <input
              ref={nameRef}
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') document.getElementById('phc-phone')?.focus() }}
              placeholder="Juan Mendez"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white text-sm focus:border-[#b3001e] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase mb-1.5">Teléfono *</label>
            <input
              id="phc-phone" type="tel" inputMode="numeric"
              value={phone} onChange={e => setPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="809-555-0123"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white text-sm focus:border-[#b3001e] focus:outline-none font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase mb-1.5">
              <Clock size={11} className="inline mr-1" /> ETA (minutos)
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {ETA_OPTIONS.map(m => (
                <button
                  key={m} type="button"
                  onClick={() => setEta(m)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border ${eta === m
                    ? 'bg-[#b3001e] text-white border-[#b3001e]'
                    : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-slate-300 dark:hover:border-white/20'}`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-extrabold tracking-[1.5px] text-slate-500 dark:text-white/50 uppercase mb-1.5">Notas</label>
            <input
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Sin cebolla, llevar para 6, etc."
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white text-sm focus:border-[#b3001e] focus:outline-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/20 text-[#b3001e] text-[12px]">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 dark:border-white/10">
          <button
            type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-sm font-bold hover:bg-slate-50 dark:hover:bg-white/5"
          >Cancelar</button>
          <button
            type="button" onClick={submit}
            className="px-4 py-2 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white text-sm font-extrabold"
          >Guardar</button>
        </div>
      </div>
    </div>
  )
}
