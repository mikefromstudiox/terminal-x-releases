/**
 * WabaStubBanner.jsx — v2.16.7
 *
 * HONESTY BANNER. Renders an amber notice on every dealership / lending screen
 * that advertises the `whatsapp_auto` Pro MAX feature, until WhatsApp Business
 * API is actually approved.
 *
 * Visibility rules (all four must be true):
 *   1. usePlan().hasFeature('whatsapp_auto') — user is on a plan that sells it.
 *   2. app_settings.waba_approved !== 'true' — we have NOT been approved yet.
 *   3. app_settings.waba_banner_dismissed !== 'true' — owner has not muted it.
 *   4. We're not still loading settings (no flicker on mount).
 *
 * When WABA is later approved, the admin panel sets app_settings.waba_approved
 * to 'true' (string) and this banner disappears automatically across every
 * screen — no client-side release needed.
 *
 * Hard rule: NO string in this component may claim automated send. We say
 * "modo manual" everywhere. The "Ver detalles" link opens the canonical doc.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useAPI } from '../context/DataContext'
import { usePlan } from '../hooks/usePlan'
import { useLang } from '../i18n'

const DETAILS_URL = 'https://terminalxpos.com/docs/whatsapp-business-status'

export default function WabaStubBanner() {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [show, setShow] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Reads app_settings via the canonical api.settings.get() so it works on
  // both desktop (electron IPC) and web (Supabase web.js). Defensive against
  // either path being missing during dev tooling/tests.
  useEffect(() => {
    let alive = true
    if (!hasFeature('whatsapp_auto')) { setShow(false); return () => { alive = false } }
    ;(async () => {
      try {
        const s = await (api?.settings?.get?.() ?? Promise.resolve({}))
        if (!alive) return
        const approved  = String(s?.waba_approved ?? '').toLowerCase() === 'true'
        const muted     = String(s?.waba_banner_dismissed ?? '').toLowerCase() === 'true'
        setDismissed(muted)
        setShow(!approved && !muted)
      } catch {
        if (alive) setShow(false)
      }
    })()
    return () => { alive = false }
  }, [api, hasFeature])

  async function handleDismiss() {
    setDismissed(true); setShow(false)
    try { await api?.settings?.update?.({ waba_banner_dismissed: 'true' }) } catch { /* persist best-effort */ }
  }

  if (!show || dismissed) return null

  return (
    <div
      role="status"
      className="mx-3 md:mx-6 mt-3 mb-1 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-2.5 flex items-start gap-3"
    >
      <AlertTriangle size={16} className="text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-amber-900 dark:text-amber-100 leading-snug">
          <span className="font-bold">
            {L('Mensajeria WhatsApp en modo manual', 'WhatsApp messaging in manual mode')}
          </span>
          {' — '}
          {L(
            'pendiente aprobacion de WhatsApp Business API. Los enlaces se abren para confirmar antes de enviar.',
            'pending WhatsApp Business API approval. Links open so you can confirm before sending.'
          )}
        </p>
        <a
          href={DETAILS_URL} target="_blank" rel="noopener noreferrer"
          className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 underline hover:text-amber-900 dark:hover:text-amber-100"
        >
          {L('Ver detalles', 'See details')}
        </a>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        title={L('Ocultar este aviso', 'Hide this notice')}
        className="p-1 rounded-md hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  )
}
