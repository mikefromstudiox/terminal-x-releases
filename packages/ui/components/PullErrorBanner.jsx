import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useLicense } from '../context/LicenseContext'
import { useLang } from '../i18n'

// v2.10.4 — Compact amber banner rendered above Login inputs whenever the
// initial Supabase pull fails after a successful license activation. Lets
// the user trigger `retryPull()` without reloading. Disappears automatically
// once `pullError` clears (retry success).
export default function PullErrorBanner() {
  const { pullError, retryPull, firstPullProgress } = useLicense()
  const { lang } = useLang()
  const L = (es, en) => (lang === 'es' ? es : en)

  if (!pullError) return null

  const retrying = firstPullProgress?.stage === 'starting'

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold leading-snug">
          {L('Sincronización incompleta', 'Sync incomplete')}
        </p>
        <p className="mt-0.5 break-words text-[11px] leading-snug opacity-90">
          {pullError}
        </p>
        <button
          type="button"
          onClick={retryPull}
          disabled={retrying}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-400/60 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-300/40 dark:bg-amber-400/20 dark:text-amber-100 dark:hover:bg-amber-400/30"
        >
          {retrying ? (
            <>
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              {L('Reintentando…', 'Retrying…')}
            </>
          ) : (
            <>
              <RefreshCw size={12} aria-hidden="true" />
              {L('Reintentar', 'Retry')}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
