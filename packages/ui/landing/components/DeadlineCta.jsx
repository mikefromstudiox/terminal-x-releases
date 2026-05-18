import { useNavigate } from 'react-router-dom'
import { ArrowRight, MessageSquare } from 'lucide-react'
import DeadlineCountdown from './DeadlineCountdown'
import copy from '../data/copy.json'
import { trackCtaClick } from '../lib/analytics'

// DeadlineCta — final-CTA section that replaces the generic
// "¿Listo para modernizar?" footer. Black background, crimson accents,
// huge live-computed countdown to May 15, 2026.
//
// Copy comes from `copy.json -> final_cta.alt_2_*` (Option 3 in the brief):
//   ES: "¿Todavía usando el Facturador Gratuito?"
//   EN: equivalent EN headline
//
// Self-contained. Accepts `lang` prop ('es' | 'en'), default 'es'.

export default function DeadlineCta({ lang = 'es' }) {
  const navigate = useNavigate()

  // Pull headline + subhead from copy.json. Falls back gracefully if a key
  // is missing (it shouldn't be — both alt_2 langs are populated by Grok).
  const headline =
    lang === 'en'
      ? copy.final_cta?.alt_2?.headline_en
      : copy.final_cta?.alt_2?.headline_es
  const subhead =
    lang === 'en'
      ? copy.final_cta?.alt_2?.subhead_en
      : copy.final_cta?.alt_2?.subhead_es
  const ctaLabel =
    lang === 'en'
      ? copy.final_cta?.alt_2?.cta_en || 'Start free trial'
      : copy.final_cta?.alt_2?.cta_es || 'Empezar gratis 7 días'

  // The brief calls out a specific CTA target — facturacion plan with a
  // deadline_cta UTM source so the marketing-attribution dashboard can
  // distinguish this CTA from /api/panel?action=marketing-lead-capture leads.
  function handlePrimary() {
    try { trackCtaClick('final_cta', 'facturacion') } catch {}
    navigate('/signup?plan=facturacion&utm_source=deadline_cta')
  }

  function handleSecondary() {
    try { trackCtaClick('final_cta', 'facturacion') } catch {}
  }

  return (
    <section
      id="deadline-cta"
      className="relative bg-black text-white py-20 md:py-28 px-4 sm:px-6 lg:px-8 overflow-hidden"
    >
      {/* Crimson radial glow background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 30%, rgba(179,0,30,0.35) 0%, rgba(179,0,30,0) 70%)',
        }}
      />
      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative max-w-5xl mx-auto text-center">
        {/* Live countdown — biggest visual element */}
        <div className="mb-10 md:mb-12 flex justify-center">
          <DeadlineCountdown lang={lang} />
        </div>

        {/* Headline + subhead from copy.final_cta.alt_2 */}
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight leading-tight">
          {headline}
        </h2>
        <p className="mt-4 text-base sm:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed">
          {subhead}
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={handlePrimary}
            className="group inline-flex items-center justify-center gap-2 bg-[#b3001e] hover:bg-[#d4002a] text-white font-bold px-8 py-4 rounded-xl shadow-2xl shadow-[#b3001e]/40 transition-all hover:scale-[1.02]"
          >
            {ctaLabel}
            <ArrowRight
              size={18}
              className="group-hover:translate-x-0.5 transition-transform"
            />
          </button>
          <a
            href="https://wa.me/18098282971?text=Hola%2C%20quiero%20migrar%20del%20Facturador%20Gratuito%20a%20Terminal%20X"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSecondary}
            className="inline-flex items-center justify-center gap-2 border border-white/20 hover:border-white/40 hover:bg-white/5 text-white font-bold px-8 py-4 rounded-xl transition-colors"
          >
            <MessageSquare size={18} />
            {lang === 'en' ? 'WhatsApp' : 'WhatsApp'}
          </a>
        </div>

        <p className="mt-6 text-[11px] sm:text-xs text-white/60 tracking-wide">
          DGII Cert #42483 · RNC 133410321 ·{' '}
          {lang === 'en' ? 'No credit card · Cancel anytime' : 'Sin tarjeta · Cancela cuando quieras'}
        </p>
      </div>
    </section>
  )
}
