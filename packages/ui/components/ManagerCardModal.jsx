/**
 * ManagerCardModal.jsx — One-time display + print flow for a newly generated
 * Manager Authorization Card.
 *
 * Rules:
 *  - The plaintext token is shown ONCE, guarded by a "reveal" click.
 *  - Closing the modal without printing triggers a confirm dialog.
 *  - After print (or explicit acknowledgement), the token is wiped from state.
 *
 * Props:
 *   user          { id, name, role, username }
 *   businessName  optional — header on the card PDF
 *   logoPng       optional Uint8Array for header logo
 *   onClose()     called after the cashier acknowledges & closes
 *   onRevoke?     optional — renders a subtle "Revocar" action
 */

import { useState, useEffect } from 'react'
import { X, Printer, Eye, EyeOff, AlertTriangle, Loader2, CheckCircle2, Copy } from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI } from '../context/DataContext'
import { formatToken } from '@terminal-x/services/managerAuthToken'
import { buildManagerCardPDF, downloadManagerCardPDF } from '@terminal-x/services/managerCardPdf'

export default function ManagerCardModal({ user, businessName, logoPng, onClose, onRevoke }) {
  const { lang } = useLang()
  const api      = useAPI()
  const L        = (es, en) => lang === 'es' ? es : en

  const [phase,     setPhase]     = useState('idle')  // 'idle' | 'generating' | 'ready' | 'printed'
  const [err,       setErr]       = useState('')
  const [token,     setToken]     = useState(null)    // plaintext — ONLY in memory
  const [rotatedAt, setRotatedAt] = useState(null)
  const [reveal,    setReveal]    = useState(false)
  const [printed,   setPrinted]   = useState(false)
  const [copyOk,    setCopyOk]    = useState(false)

  // Wipe token on unmount — belt-and-suspenders.
  useEffect(() => () => { setToken(null) }, [])

  async function generate() {
    setPhase('generating'); setErr('')
    try {
      const r = await api.staff.generateAuthCard(user.id)
      if (!r?.token) throw new Error(r?.error || 'No token returned')
      setToken(r.token)
      setRotatedAt(r.rotatedAt)
      setPhase('ready')
    } catch (e) {
      setErr(e?.message || L('Error al generar tarjeta', 'Card generate error'))
      setPhase('idle')
    }
  }

  async function print() {
    if (!token) return
    setErr('')
    try {
      await downloadManagerCardPDF(
        { token, managerName: user?.name, role: user?.role, businessName, issuedAt: rotatedAt, logoPng },
        `tarjeta-${(user?.username || 'manager').toLowerCase()}.pdf`,
      )
      setPrinted(true)
      setPhase('printed')
    } catch (e) {
      setErr(e?.message || L('Error al imprimir', 'Print error'))
    }
  }

  async function copyToken() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(formatToken(token))
      setCopyOk(true)
      setTimeout(() => setCopyOk(false), 1200)
    } catch {}
  }

  function tryClose() {
    if (phase === 'ready' && !printed) {
      const ok = confirm(L(
        'No has impreso la tarjeta. El token NO se volverá a mostrar. ¿Cerrar de todos modos?',
        'You have not printed the card. The token will NOT be shown again. Close anyway?',
      ))
      if (!ok) return
    }
    setToken(null)
    onClose?.()
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white dark:bg-black rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-white/10">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-black text-slate-900 dark:text-white">
              {L('Tarjeta de Autorización', 'Authorization Card')}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">
              {user?.name} <span className="text-slate-400 dark:text-white/40">· {user?.role}</span>
            </p>
          </div>
          <button onClick={tryClose}
            className="text-slate-400 hover:text-slate-700 dark:text-white/40 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {phase === 'idle' && (
            <>
              <div className="flex items-start gap-2.5 bg-[#b3001e]/5 border border-[#b3001e]/20 rounded-xl px-3.5 py-3">
                <AlertTriangle size={15} className="text-[#b3001e] shrink-0 mt-0.5" />
                <div className="text-[12px] text-slate-700 dark:text-white/80 leading-relaxed space-y-1">
                  <p className="font-bold">{L('Al generar:', 'On generate:')}</p>
                  <ul className="list-disc ml-4 space-y-0.5">
                    <li>{L('La tarjeta anterior deja de funcionar inmediatamente.', 'The previous card stops working immediately.')}</li>
                    <li>{L('El nuevo token se muestra UNA sola vez — imprímalo ya.', 'The new token is shown ONCE — print it now.')}</li>
                    <li>{L('Si el gerente pierde la tarjeta, revocarla y generar otra.', 'If the manager loses it, revoke and re-issue.')}</li>
                  </ul>
                </div>
              </div>
              <button onClick={generate}
                className="w-full px-3 py-2.5 text-[13px] font-black text-white bg-[#b3001e] rounded-xl hover:bg-[#8f0018] flex items-center justify-center gap-2">
                <Printer size={14} /> {L('Generar tarjeta nueva', 'Generate new card')}
              </button>
              {onRevoke && (
                <button onClick={onRevoke}
                  className="w-full px-3 py-2 text-[11px] font-semibold text-slate-500 dark:text-white/50 hover:text-[#b3001e] underline underline-offset-2">
                  {L('Revocar tarjeta actual', 'Revoke current card')}
                </button>
              )}
            </>
          )}

          {phase === 'generating' && (
            <div className="py-8 flex items-center justify-center gap-2 text-slate-500 dark:text-white/60">
              <Loader2 size={15} className="animate-spin" /> {L('Generando…', 'Generating…')}
            </div>
          )}

          {(phase === 'ready' || phase === 'printed') && token && (
            <>
              <div className="rounded-xl border-2 border-[#b3001e] bg-[#b3001e]/5 px-4 py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[#b3001e] uppercase tracking-widest">
                    {L('Token (se muestra una sola vez)', 'Token (one-time display)')}
                  </p>
                  <button onClick={() => setReveal(r => !r)}
                    className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-white/70 hover:text-[#b3001e]">
                    {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
                    {reveal ? L('Ocultar', 'Hide') : L('Mostrar', 'Show')}
                  </button>
                </div>
                <p className={`text-center font-mono font-black text-lg tracking-[0.2em] text-slate-900 dark:text-white select-all break-all ${reveal ? '' : 'blur-md select-none'}`}>
                  {formatToken(token)}
                </p>
                <div className="flex gap-2 pt-1">
                  <button onClick={copyToken}
                    className="flex-1 text-[11px] font-semibold text-slate-600 dark:text-white/70 hover:text-[#b3001e] border border-slate-200 dark:border-white/10 rounded-lg py-1.5 flex items-center justify-center gap-1">
                    {copyOk ? <CheckCircle2 size={12} className="text-green-600" /> : <Copy size={12} />}
                    {copyOk ? L('Copiado', 'Copied') : L('Copiar texto', 'Copy text')}
                  </button>
                </div>
              </div>

              <button onClick={print}
                className="w-full px-3 py-2.5 text-[13px] font-black text-white bg-[#b3001e] rounded-xl hover:bg-[#8f0018] flex items-center justify-center gap-2">
                <Printer size={14} />
                {printed ? L('Reimprimir tarjeta PDF', 'Reprint card PDF') : L('Imprimir tarjeta (PDF)', 'Print card (PDF)')}
              </button>

              <div className="flex items-center justify-between text-[11px]">
                <label className="flex items-center gap-1.5 text-slate-600 dark:text-white/70 cursor-pointer">
                  <input type="checkbox" checked={printed} onChange={e => setPrinted(e.target.checked)} className="accent-[#b3001e]" />
                  {L('Ya imprimí / guardé la tarjeta', 'I printed / saved the card')}
                </label>
                <button onClick={tryClose}
                  className="text-slate-500 dark:text-white/60 hover:text-[#b3001e] font-semibold">
                  {L('Cerrar', 'Close')}
                </button>
              </div>
            </>
          )}

          {err && (
            <p className="text-[12px] font-semibold text-[#b3001e] flex items-center gap-1.5">
              <AlertTriangle size={12} /> {err}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
