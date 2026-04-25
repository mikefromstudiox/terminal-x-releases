import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Mail, X, Check } from 'lucide-react'

// ExitIntentModal — fires once per session on desktop mouseleave (toward top)
// or mobile popstate. Hidden on /signup and /admin paths.
// POSTs to /api/panel?action=marketing-lead-capture.

const SESSION_KEY = 'tx_exit_intent_shown'

const COPY = {
  es: {
    title: 'Guía gratis: Cómo migrar del Facturador Gratuito de DGII en 7 días',
    sub: 'Te enviamos el PDF a tu correo. Sin spam.',
    placeholder: 'tu@correo.com',
    submit: 'Enviarme la guía',
    submitting: 'Enviando…',
    success: 'Te enviaremos la guía en minutos.',
    error: 'No pudimos enviar. Intenta de nuevo.',
    close: 'Cerrar',
  },
  en: {
    title: 'Free guide: How to migrate from the DGII Free Invoicer in 7 days',
    sub: 'We will email the PDF to you. No spam.',
    placeholder: 'you@email.com',
    submit: 'Send me the guide',
    submitting: 'Sending…',
    success: 'You will receive the guide in minutes.',
    error: 'Could not send. Please try again.',
    close: 'Close',
  },
}

export default function ExitIntentModal({ lang = 'es', vertical = null }) {
  const location = useLocation()
  const t = COPY[lang] || COPY.es
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  const blocked =
    location.pathname.startsWith('/signup') ||
    location.pathname.startsWith('/admin')

  useEffect(() => {
    if (blocked) return
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return
    } catch {}

    let armed = true

    function arm() {
      if (!armed) return
      armed = false
      try { sessionStorage.setItem(SESSION_KEY, '1') } catch {}
      setOpen(true)
    }

    function onMouseLeave(e) {
      // Desktop only — mouse leaving viewport toward the top
      if (e.clientY <= 4) arm()
    }

    function onPopState() {
      // Mobile back-button intent
      if (window.matchMedia('(max-width: 767px)').matches) arm()
    }

    document.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('popstate', onPopState)
    return () => {
      document.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('popstate', onPopState)
    }
  }, [blocked])

  if (blocked || !open) return null

  async function submit(e) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/panel?action=marketing-lead-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'exit_intent', vertical }),
      })
      if (!res.ok) throw new Error('bad-status')
      setDone(true)
      setTimeout(() => setOpen(false), 2200)
    } catch {
      setError(t.error)
    } finally {
      setSubmitting(false)
    }
  }

  function close() { setOpen(false) }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-[slideUp_220ms_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={close}
          aria-label={t.close}
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-black/60 transition-colors z-10"
        >
          <X size={16} />
        </button>

        <div className="p-7 md:p-8">
          <div className="w-12 h-12 rounded-2xl bg-[#b3001e]/10 flex items-center justify-center mb-4">
            <Mail size={22} className="text-[#b3001e]" />
          </div>
          <h3 className="text-xl md:text-2xl font-black text-black leading-snug tracking-tight">{t.title}</h3>
          <p className="mt-2 text-sm text-black/60">{t.sub}</p>

          {done ? (
            <div className="mt-6 flex items-center gap-3 p-4 rounded-xl bg-[#b3001e]/10 text-[#b3001e]">
              <Check size={18} />
              <span className="text-sm font-bold">{t.success}</span>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t.placeholder}
                className="w-full px-4 py-3 rounded-xl bg-black/5 border border-black/10 text-black font-semibold focus:outline-none focus:ring-2 focus:ring-[#b3001e] focus:bg-white transition-all"
                autoComplete="email"
                inputMode="email"
              />
              {error && <p className="text-xs font-semibold text-[#b3001e]">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-50 text-white font-bold transition-colors"
              >
                {submitting ? t.submitting : t.submit}
              </button>
            </form>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
