import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, X } from 'lucide-react'

// StickyMobileCta — bottom-fixed bar (md:hidden), appears at scroll >800px.
// Self-contained; drop at the end of LandingPage return.

const STORAGE_KEY = 'tx_sticky_cta_dismissed_until'
const TTL_MS = 24 * 60 * 60 * 1000 // 24h

export default function StickyMobileCta({ lang = 'es' }) {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Initial dismiss check
    try {
      const until = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10)
      if (until && Date.now() < until) {
        setDismissed(true)
        return
      }
    } catch {}

    function onScroll() {
      setVisible(window.scrollY > 800)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function dismiss(e) {
    e.stopPropagation()
    try { localStorage.setItem(STORAGE_KEY, String(Date.now() + TTL_MS)) } catch {}
    setDismissed(true)
  }

  if (dismissed) return null

  const copy = lang === 'es' ? 'Desde RD$995/mes · 7 días gratis' : 'From RD$995/mo · 7 days free'

  return (
    <div
      className={`md:hidden fixed bottom-0 inset-x-0 z-50 px-3 pb-3 pt-2 transition-transform duration-300 ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      role="region"
      aria-label="Sticky CTA"
    >
      <div className="rounded-2xl bg-[#b3001e] shadow-2xl shadow-[#b3001e]/40 flex items-center pl-4 pr-2 py-2.5">
        <button
          onClick={() => navigate('/signup?plan=facturacion')}
          className="flex-1 flex items-center justify-between text-left text-white"
        >
          <span className="text-sm font-bold">{copy}</span>
          <ArrowRight size={18} className="ml-2 shrink-0" />
        </button>
        <button
          onClick={dismiss}
          aria-label={lang === 'es' ? 'Cerrar' : 'Dismiss'}
          className="ml-2 w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
