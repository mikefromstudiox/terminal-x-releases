// PaymentErrorBoundary
// ──────────────────────────────────────────────────────────────────────────────
// Defensive wrapper for the CobrarModal mount sites.
//
// Why this exists:
// CobrarModal is a 2,493-line god component that handles every payment path
// (cash, card, transfer, mixto, e-CF signing, loyalty, deposits…). A full
// split is multi-day work. In the meantime an unhandled exception inside the
// modal would crash the entire React tree — the cashier would see a white
// screen *while the customer is paying in cash*, and the ticket could be
// lost. This boundary contains the blast radius:
//
//   • getDerivedStateFromError → switches to a Spanish fallback card.
//   • componentDidCatch         → forwards to Sentry (if loaded) AND records
//                                 a `cobrar_modal_crashed` activity_log entry
//                                 (critical severity) so the owner sees it
//                                 in Actividad.
//   • "Reintentar"              → resets boundary state so the parent can
//                                 re-mount CobrarModal without a page reload.
//   • "Cerrar y revisar manualmente" → calls the parent's onClose so the
//                                 ticket stays in queue/POS for manual review.
//
// The boundary is transparent on the happy path (it just renders children).
// It MUST live above CobrarModal in the tree but below the modal-controlling
// state, so that a cleared `cobrarModal` state on the parent unmounts the
// boundary too.
import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { captureSentryException } from '@terminal-x/services/sentry-renderer'
import { useAPI } from '../context/DataContext'

class PaymentErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errMessage: '' }
    this.handleRetry = this.handleRetry.bind(this)
    this.handleClose = this.handleClose.bind(this)
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, errMessage: err?.message || 'Error desconocido' }
  }

  componentDidCatch(err, info) {
    // Never let the error reporter itself throw — we are already in a broken
    // render path and a second throw here will tear down the whole app.
    try {
      captureSentryException(err, { componentStack: info?.componentStack || null, scope: 'CobrarModal' })
    } catch (e) {
      try { console.error('[PaymentErrorBoundary] sentry capture failed:', e) } catch {}
    }
    try {
      const api = this.props._api
      // v2.16.12 — was 500 chars which truncated the trace at frame 4 of
      // the 'Cannot access Ht before initialization' bug, hiding the file
      // path that would have pinpointed the TDZ source. 4000 chars covers
      // ~25 frames with sourcemaps resolved.
      const stack = (err?.stack || '').slice(0, 4000)
      api?.activity?.record?.({
        event_type: 'cobrar_modal_crashed',
        severity: 'critical',
        metadata: { error: err?.message || String(err), stack },
      })
    } catch (e) {
      try { console.error('[PaymentErrorBoundary] activity.record failed:', e) } catch {}
    }
    try { console.error('[PaymentErrorBoundary] CobrarModal crashed:', err) } catch {}
  }

  handleRetry() {
    this.setState({ hasError: false, errMessage: '' })
  }

  handleClose() {
    this.setState({ hasError: false, errMessage: '' })
    try { this.props.onClose?.() } catch (e) { try { console.error(e) } catch {} }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/80 dark:bg-black/80 backdrop-blur-sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="payment-error-title"
      >
        <div className="w-full max-w-md bg-white dark:bg-black border-2 border-[#b3001e] rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-[#b3001e] text-white px-5 py-4 flex items-center gap-3">
            <AlertTriangle size={22} className="shrink-0" />
            <h2 id="payment-error-title" className="font-bold text-lg">Error en el cobro</h2>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-sm text-slate-800 dark:text-white leading-relaxed">
              Ocurrió un problema procesando esta venta. La venta NO se ha cerrado todavía.
              Verifica el monto y vuelve a intentar.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleRetry}
                className="flex-1 bg-[#b3001e] hover:bg-[#8a0017] text-white font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={this.handleClose}
                className="flex-1 border-2 border-black dark:border-white/40 text-black dark:text-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                Cerrar y revisar manualmente
              </button>
            </div>

            <p className="text-slate-500 dark:text-white/50 text-xs text-center pt-1">
              Reporte enviado a soporte automáticamente.
            </p>
          </div>
        </div>
      </div>
    )
  }
}

// Hook bridge — class components can't use hooks, so we read the API context
// in a tiny functional wrapper and forward it as a prop.
export default function PaymentErrorBoundary({ onClose, children }) {
  const api = useAPI()
  return (
    <PaymentErrorBoundaryInner _api={api} onClose={onClose}>
      {children}
    </PaymentErrorBoundaryInner>
  )
}
