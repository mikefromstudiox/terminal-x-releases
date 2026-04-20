import { useEffect, useState, useCallback } from 'react'
import { Printer, RefreshCw, X } from 'lucide-react'
import { subscribe, retryAll, clearPending } from '@terminal-x/services/printQueue.js'

/**
 * PrintQueueBanner — persistent amber banner shown when one or more print
 * jobs have exhausted their retries and are parked in the pending queue.
 * Clicking "Reintentar" fires retryAll() which re-runs each job through the
 * backoff sequence again. Auto-hides when the queue drains.
 */
export default function PrintQueueBanner() {
  const [pending, setPending] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsub = subscribe(setPending)
    return () => unsub()
  }, [])

  const onRetry = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try { await retryAll() } finally { setBusy(false) }
  }, [busy])

  const onDismiss = useCallback(() => {
    if (!confirm('Descartar ' + pending.length + ' impresion(es) pendiente(s)? Esta accion no se puede deshacer.')) return
    clearPending()
  }, [pending.length])

  if (!pending || !pending.length) return null

  const n = pending.length

  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-400 text-amber-900 text-[12px] font-semibold">
      <Printer size={13} className="shrink-0" />
      <span className="flex-1">
        Hay {n} impresion{n === 1 ? '' : 'es'} pendiente{n === 1 ? '' : 's'} — revisa impresora
      </span>
      <button
        onClick={onRetry}
        disabled={busy}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold bg-amber-900/20 hover:bg-amber-900/30 text-amber-900 disabled:opacity-50"
      >
        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
        {busy ? 'Reintentando...' : 'Reintentar'}
      </button>
      <button
        onClick={onDismiss}
        title="Descartar"
        className="shrink-0 flex items-center justify-center w-6 h-6 rounded-lg bg-amber-900/10 hover:bg-amber-900/25 text-amber-900"
      >
        <X size={12} />
      </button>
    </div>
  )
}
