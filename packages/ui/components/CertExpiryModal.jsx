// CertExpiryModal — v2.11.2
//
// Startup modal shown when the DGII e-CF certificate is within 30 days
// of expiry (tier: 'critical'). Dismissible but re-shows on the next
// app launch (via a per-day sessionStorage flag so it doesn't pop up
// repeatedly on the same calendar day, but DOES return the next day).
//
// The 'expired' tier has its own blocking handling in CobrarModal — this
// modal intentionally does NOT fire for tier='expired' to avoid
// double-dialog stacking.

import { useEffect, useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'

const DISMISS_KEY_PREFIX = 'tx_cert_expiry_modal_dismissed_'
const WA_NUMBER = '18098282971'

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export default function CertExpiryModal() {
  const [status, setStatus] = useState(null)
  const [open, setOpen]     = useState(false)

  useEffect(() => {
    let alive = true
    const api = typeof window !== 'undefined' ? window.electronAPI?.dgii_ecf : null
    if (api?.certExpiryCheck) {
      api.certExpiryCheck().then(d => {
        if (!alive || !d?.installed) return
        setStatus(d)
        if (d.tier === 'critical') {
          // Re-show daily but not on every boot within the same day.
          const key = DISMISS_KEY_PREFIX + todayKey()
          let already = false
          try { already = sessionStorage.getItem(key) === '1' } catch {}
          if (!already) setOpen(true)
        }
      }).catch(() => {})
    }
    const onStatus = (e) => {
      const d = e?.detail
      if (!alive || !d?.installed) return
      setStatus(d)
      if (d.tier === 'critical') {
        const key = DISMISS_KEY_PREFIX + todayKey()
        let already = false
        try { already = sessionStorage.getItem(key) === '1' } catch {}
        if (!already) setOpen(true)
      }
    }
    window.addEventListener('tx:cert-expiry-status', onStatus)
    return () => { alive = false; window.removeEventListener('tx:cert-expiry-status', onStatus) }
  }, [])

  if (!open || !status) return null
  const { daysLeft, expiry, subject } = status

  const onClose = () => {
    try { sessionStorage.setItem(DISMISS_KEY_PREFIX + todayKey(), '1') } catch {}
    setOpen(false)
  }

  const waMsg  = encodeURIComponent(`Hola, necesito renovar mi certificado digital DGII (vence en ${daysLeft} dias).`)
  const waHref = `https://wa.me/${WA_NUMBER}?text=${waMsg}`

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cert-expiry-modal-title"
    >
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-orange-500/30 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-orange-500 text-white">
          <ShieldAlert size={20} className="shrink-0" />
          <h2 id="cert-expiry-modal-title" className="flex-1 text-[15px] font-bold">
            Certificado DGII por vencer
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-white/20 transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-5 space-y-3 text-[13px] text-zinc-700 dark:text-zinc-200">
          <p>
            Su certificado digital <strong>vence en {daysLeft} dia{daysLeft===1?'':'s'}</strong>.
            Cuando venza, Terminal X no podra firmar ni enviar e-CF a la DGII y las
            ventas tendran que hacerse sin comprobante fiscal electronico.
          </p>
          <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/60 px-3 py-2 text-[12px]">
            <div><span className="opacity-60">Titular:</span> <strong>{subject || '—'}</strong></div>
            <div><span className="opacity-60">Fecha de vencimiento:</span> <strong>{new Date(expiry).toLocaleDateString('es-DO')}</strong></div>
          </div>
          <p className="text-[12px] opacity-80">
            Renueve con su autoridad certificadora (Viafirma, Avansi, Camara TIC…) y
            reinstalelo en <strong>Configuracion - e-CF - Instalar certificado</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2 px-5 py-3 bg-zinc-50 dark:bg-zinc-900/60 border-t border-zinc-200 dark:border-white/10">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center px-4 py-2 rounded-lg bg-[#25d366] text-white text-[13px] font-bold hover:bg-[#20b857] transition-colors"
          >
            Pedir ayuda por WhatsApp
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-white text-[13px] font-semibold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
          >
            Recordar mañana
          </button>
        </div>
      </div>
    </div>
  )
}
