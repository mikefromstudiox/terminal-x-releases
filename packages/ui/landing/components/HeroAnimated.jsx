import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, ArrowRight, ChevronDown } from 'lucide-react'

// HeroAnimated — replaces the text-only hero. 3-column animated SVG mockup grid.
// Self-contained. Accepts `lang` prop ("es" | "en"). Default "es".
//
// Visual mockups are pure SVG (no images yet — Mike will swap real screenshots later).
// TODO: replace SVG mockups with real product screenshots once available.

const COPY = {
  es: {
    eyebrow: 'CUANDO 150 FACTURAS NO ALCANZAN',
    headline: 'Cuando el Facturador Gratuito de DGII no alcanza',
    sub: 'Misma compliance Ley 32-23. API, móvil, WhatsApp y modo offline. Desde RD$995/mes.',
    primary: 'Empezar gratis 7 días',
    secondary: 'Ver comparación con Gratuito',
    trust: 'DGII Cert #42483 · RNC 133410321 · Viafirma · 7 días gratis · Sin tarjeta',
    mockDesktop: 'POS de escritorio',
    mockWeb: 'Factura web',
    mockMobile: 'Recibo móvil',
  },
  en: {
    eyebrow: 'WHEN 150 INVOICES ARE NOT ENOUGH',
    headline: 'When the DGII Free Invoicer is not enough',
    sub: 'Same Law 32-23 compliance. API, mobile, WhatsApp and offline mode. From RD$995/mo.',
    primary: 'Start 7-day free trial',
    secondary: 'See vs Free comparison',
    trust: 'DGII Cert #42483 · RNC 133410321 · Viafirma · 7 days free · No card required',
    mockDesktop: 'Desktop POS',
    mockWeb: 'Web invoice',
    mockMobile: 'Mobile receipt',
  },
}

// Hero shots captured via scripts/capture-demo-screenshots.mjs.
// SVG fallbacks kept commented at end of file in case PNG loading breaks.

function DesktopMockup({ alt }) {
  return (
    <img
      src="/hero/desktop-pos.png"
      srcSet="/hero/desktop-pos-sm.png 640w, /hero/desktop-pos.png 1280w"
      sizes="(max-width: 768px) 50vw, 640px"
      alt={alt}
      width={1600}
      height={1000}
      fetchpriority="high"
      decoding="async"
      className="w-full h-auto block"
    />
  )
}

function WebMockup({ alt }) {
  return (
    <img
      src="/hero/web-invoice.png"
      srcSet="/hero/web-invoice-sm.png 640w, /hero/web-invoice.png 1280w"
      sizes="(max-width: 768px) 100vw, 640px"
      alt={alt}
      width={1600}
      height={1000}
      loading="lazy"
      decoding="async"
      className="w-full h-auto block rounded-lg"
    />
  )
}

function MobileMockup({ alt }) {
  return (
    <img
      src="/hero/mobile-receipt.png"
      srcSet="/hero/mobile-receipt-sm.png 360w, /hero/mobile-receipt.png 600w"
      sizes="(max-width: 768px) 80vw, 300px"
      alt={alt}
      width={390}
      height={844}
      loading="lazy"
      decoding="async"
      className="w-full h-auto block rounded-2xl"
    />
  )
}

export default function HeroAnimated({ lang = 'es' }) {
  const navigate = useNavigate()
  const t = COPY[lang] || COPY.es

  const handleSecondary = (e) => {
    e.preventDefault()
    const target = document.getElementById('dgii-comparison')
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="relative bg-white overflow-hidden">
      {/* Subtle grid background */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: copy */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#b3001e]/10 border border-[#b3001e]/20 mb-6">
              <ShieldCheck size={14} className="text-[#b3001e]" />
              <span className="text-[11px] font-extrabold tracking-[2px] text-[#b3001e]">{t.eyebrow}</span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-[1.05] tracking-tight text-black">
              {t.headline.split(' ').map((word, i, arr) => {
                const isHighlight = word.toLowerCase().includes('gratuito') || word.toLowerCase().includes('free')
                return (
                  <span key={i} className={isHighlight ? 'text-[#b3001e]' : ''}>
                    {word}{i < arr.length - 1 ? ' ' : ''}
                  </span>
                )
              })}
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-black/65 leading-relaxed max-w-xl">{t.sub}</p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center">
              <button
                onClick={() => navigate('/signup?plan=facturacion')}
                className="group inline-flex items-center justify-center gap-2 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold px-7 py-4 rounded-xl shadow-xl shadow-[#b3001e]/25 transition-all hover:scale-[1.02]"
              >
                {t.primary}
                <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button
                onClick={handleSecondary}
                className="inline-flex items-center justify-center gap-2 bg-black/5 hover:bg-black/10 text-black font-bold px-7 py-4 rounded-xl transition-colors"
              >
                {t.secondary}
                <ChevronDown size={18} />
              </button>
            </div>

            <p className="mt-7 text-xs sm:text-sm font-medium text-black/50 leading-relaxed">{t.trust}</p>
          </motion.div>

          {/* Right: 3-column animated mockup */}
          <div className="relative">
            <div className="grid grid-cols-12 gap-4 items-end">
              {/* Desktop — largest, back-left */}
              <motion.div
                initial={{ opacity: 0, y: 24, rotate: -2 }}
                animate={{ opacity: 1, y: 0, rotate: -2 }}
                transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
                className="col-span-7 row-start-1 relative z-10"
              >
                <div className="rounded-2xl bg-black p-3 shadow-2xl shadow-black/20">
                  <DesktopMockup alt={t.mockDesktop} />
                </div>
                <p className="mt-2 text-[10px] uppercase tracking-[2px] font-bold text-black/40 text-center">{t.mockDesktop}</p>
              </motion.div>

              {/* Mobile — smallest, foreground-right */}
              <motion.div
                initial={{ opacity: 0, y: 24, rotate: 4 }}
                animate={{ opacity: 1, y: 0, rotate: 4 }}
                transition={{ duration: 0.7, delay: 0.25, ease: 'easeOut' }}
                className="col-span-5 row-start-1 relative z-20 -ml-6 sm:-ml-10 mt-12"
              >
                <div className="rounded-3xl bg-black p-1.5 shadow-2xl shadow-black/30">
                  <MobileMockup alt={t.mockMobile} />
                </div>
                <p className="mt-2 text-[10px] uppercase tracking-[2px] font-bold text-black/40 text-center">{t.mockMobile}</p>
              </motion.div>

              {/* Web invoice — bottom row spans full width */}
              <motion.div
                initial={{ opacity: 0, y: 24, rotate: 1 }}
                animate={{ opacity: 1, y: 0, rotate: 1 }}
                transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
                className="col-span-12 row-start-2 mt-6 max-w-[80%] mx-auto"
              >
                <div className="rounded-2xl bg-white border border-black/10 p-3 shadow-2xl shadow-black/10">
                  <WebMockup alt={t.mockWeb} />
                </div>
                <p className="mt-2 text-[10px] uppercase tracking-[2px] font-bold text-black/40 text-center">{t.mockWeb}</p>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Legacy SVG mockups (kept commented for revert) ────────────────────────
// function DesktopMockupSvg() { return <svg viewBox="0 0 320 220" className="w-full h-auto" aria-hidden="true">{/* ...original art... */}</svg> }
// function WebMockupSvg()     { return <svg viewBox="0 0 320 220" className="w-full h-auto" aria-hidden="true">{/* ...original art... */}</svg> }
// function MobileMockupSvg()  { return <svg viewBox="0 0 180 280" className="w-full h-auto" aria-hidden="true">{/* ...original art... */}</svg> }
