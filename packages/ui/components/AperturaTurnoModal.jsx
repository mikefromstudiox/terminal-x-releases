// AperturaTurnoModal — first-entry-of-the-day prompt that forces a cashier to
// declare the opening cash drawer so end-of-day reconciliation starts from a
// known baseline. No close button: apertura is a workflow, not a suggestion.
// Owner escape hatch: business setting `skip_apertura_prompt=1` bypasses.
import { useState, useEffect, useRef } from 'react'
import { Wallet, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useLang } from '../i18n'

export default function AperturaTurnoModal({ userName, onConfirm, submitting = false }) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function submit(e) {
    e?.preventDefault()
    const n = Number(String(amount).replace(/,/g, ''))
    if (!Number.isFinite(n) || n < 0) { setErr(L('Ingresa un monto válido', 'Enter a valid amount')); return }
    setErr('')
    onConfirm(n)
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#b3001e]/10 flex items-center justify-center mb-3">
            <Wallet size={26} className="text-[#b3001e]" />
          </div>
          <h2 className="text-[17px] font-bold text-slate-800 dark:text-white">
            {L('Apertura de Turno', 'Open Shift')}
          </h2>
          <p className="text-[12px] text-slate-500 dark:text-white/60 mt-1">
            {userName
              ? L(`Hola ${userName} — declara tu fondo de caja inicial`, `Hi ${userName} — declare your starting cash`)
              : L('Declara tu fondo de caja inicial', 'Declare your starting cash')}
          </p>
        </div>

        <div className="px-6 pb-4">
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1.5">
            {L('Fondo inicial', 'Starting cash')}
          </label>
          {/* Side-by-side flex instead of absolute-positioned prefix.
              1Password/LastPass/Chrome autofill icons CANNOT overlap the
              RD$ label because they're drawn inside the input bounding box,
              which now starts after the prefix badge. */}
          <div className="flex items-stretch rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 focus-within:border-[#b3001e] focus-within:ring-2 focus-within:ring-[#b3001e]/20 overflow-hidden">
            <span className="flex items-center px-3 py-3 bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-white/60 text-[13px] font-semibold border-r border-slate-200 dark:border-white/10 select-none">
              RD$
            </span>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.00"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              name="apertura-monto"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              className="flex-1 min-w-0 px-3 py-3 text-[20px] font-bold text-slate-800 dark:text-white bg-transparent focus:outline-none"
            />
          </div>
          {err && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-red-500">
              <AlertCircle size={12} /> {err}
            </p>
          )}
        </div>

        <div className="px-6 pb-6">
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#b3001e] hover:bg-[#8f0018] disabled:opacity-50 text-white text-[13px] font-bold rounded-xl transition-colors"
          >
            {submitting
              ? <><Loader2 size={14} className="animate-spin" /> {L('Abriendo…', 'Opening…')}</>
              : <><CheckCircle2 size={14} /> {L('Abrir Turno', 'Open Shift')}</>}
          </button>
          <p className="mt-3 text-center text-[10px] text-slate-400 dark:text-white/40">
            {L(
              'Esto queda registrado en el historial de actividad.',
              'This is recorded in the activity history.',
            )}
          </p>
        </div>
      </form>
    </div>
  )
}
