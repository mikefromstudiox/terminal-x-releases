// CertExpiryBanner — v2.11.2
//
// Persistent strip rendered at the top of the app when the DGII e-CF
// certificate is within 60 days of expiry. Dismissible per session
// (banner is hidden until the next app launch) but never permanently
// silenced. At <=30 days the strip turns orange and the companion
// <CertExpiryModal /> also fires on startup.
//
// Data source: 'tx:cert-expiry-status' CustomEvent dispatched by
// preload.js when main broadcasts `cert:expiry-status`, plus an on-mount
// pull via window.electronAPI.dgii_ecf.certExpiryCheck() so the banner
// appears without waiting for the 15s-post-boot check.

import { useEffect, useState } from 'react'
import { AlertTriangle, ShieldAlert, X } from 'lucide-react'

const DISMISS_KEY = 'tx_cert_expiry_banner_dismissed'

export default function CertExpiryBanner() {
  const [status, setStatus]       = useState(null)    // { daysLeft, tier, ... } or null
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    let alive = true

    // Initial pull — no wait for the 12h timer.
    const api = typeof window !== 'undefined' ? window.electronAPI?.dgii_ecf : null
    if (api?.certExpiryCheck) {
      api.certExpiryCheck().then(d => { if (alive && d?.installed) setStatus(d) }).catch(() => {})
    }

    // Live updates from main.
    const onStatus = (e) => { if (alive && e?.detail?.installed) setStatus(e.detail) }
    window.addEventListener('tx:cert-expiry-status', onStatus)
    return () => { alive = false; window.removeEventListener('tx:cert-expiry-status', onStatus) }
  }, [])

  if (dismissed) return null
  if (!status || !status.installed) return null

  const { daysLeft, tier } = status
  // Banner shows only for warn (31..60d) + critical (1..30d) + expired.
  if (tier === 'none' || tier === 'info') return null

  const onDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch {}
    setDismissed(true)
  }

  // Visual tiers
  const isExpired  = tier === 'expired'
  const isCritical = tier === 'critical'
  const bgCls = isExpired  ? 'bg-red-600 text-white'
              : isCritical ? 'bg-orange-500 text-white'
              :              'bg-yellow-400 text-yellow-900'
  const Icon = isExpired ? ShieldAlert : AlertTriangle

  const msg = isExpired
    ? 'Certificado DGII VENCIDO — la emision de e-CF esta detenida. Renueve ahora.'
    : isCritical
      ? `Certificado DGII vence en ${daysLeft} dia${daysLeft===1?'':'s'} — renueve HOY para no detener la facturacion electronica.`
      : `Certificado DGII vence en ${daysLeft} dias — agende la renovacion con Viafirma o su CA.`

  return (
    <div className={`shrink-0 flex items-center gap-2 px-4 py-1.5 text-[12px] font-medium ${bgCls}`}>
      <Icon size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      {!isExpired && (
        <button
          type="button"
          onClick={onDismiss}
          className={`ml-auto shrink-0 flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
            isCritical ? 'hover:bg-white/20 text-white' : 'hover:bg-yellow-900/15 text-yellow-900'
          }`}
          aria-label="Ocultar aviso hasta el proximo inicio"
          title="Ocultar hasta el proximo inicio"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
