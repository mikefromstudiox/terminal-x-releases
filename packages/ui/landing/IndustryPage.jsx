/**
 * IndustryPage.jsx — full feature page per business vertical.
 * Route: /industrias/:slug
 *
 * Content: packages/ui/landing/data/industries.js
 */

import { useEffect, useMemo } from 'react'
import { useParams, Link, Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, Check, Phone, ChevronLeft } from 'lucide-react'
import { INDUSTRIES, INDUSTRIES_INDEX } from './data/industries'
import { INDUSTRIES_EN } from './data/industries-en'

const CRIMSON = '#b3001e'
const WA = '+18098282971'

// Merge ES base + EN overrides at field level. Anything missing in EN falls
// back to ES — so SEO-critical fields stay in English while long-form Spanish
// copy keeps appearing for verticals not yet fully translated. For arrays of
// objects (subtypes), we merge by index so language-specific text overrides
// while structural metadata (e.g. lucide icons) stays from the ES base.
function localize(data, lang) {
  if (lang !== 'en') return data
  const en = INDUSTRIES_EN[data.slug] || {}
  const merged = { ...data, ...en, _lang: 'en' }
  if (Array.isArray(en.subtypes) && Array.isArray(data.subtypes)) {
    merged.subtypes = data.subtypes.map((s, i) => ({ ...s, ...(en.subtypes[i] || {}) }))
  }
  return merged
}

function upsertMeta(selector, attrName, attrValue, contentAttr, content) {
  let el = document.head.querySelector(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attrName, attrValue)
    document.head.appendChild(el)
  }
  el.setAttribute(contentAttr, content)
}

function setSEO(title, description, canonical) {
  if (typeof document === 'undefined') return
  document.title = title
  upsertMeta('meta[name="description"]', 'name', 'description', 'content', description || '')
  if (canonical) {
    let link = document.head.querySelector('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.setAttribute('rel', 'canonical')
      document.head.appendChild(link)
    }
    link.setAttribute('href', canonical)
    upsertMeta('meta[property="og:url"]',         'property', 'og:url',         'content', canonical)
  }
  upsertMeta('meta[property="og:title"]',         'property', 'og:title',       'content', title)
  upsertMeta('meta[property="og:description"]',   'property', 'og:description', 'content', description || '')
  upsertMeta('meta[name="twitter:title"]',        'name',     'twitter:title',  'content', title)
  upsertMeta('meta[name="twitter:description"]',  'name',     'twitter:description', 'content', description || '')
}

function waLink(text) {
  return `https://wa.me/${WA.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

export default function IndustryPage({ forceLang }) {
  const { slug } = useParams()
  const location = useLocation()
  const lang = forceLang === 'en' || location.pathname.startsWith('/en/') ? 'en' : 'es'
  const baseData = INDUSTRIES[slug]
  const data = baseData ? localize(baseData, lang) : null

  useEffect(() => {
    if (data) {
      const canonicalPath = lang === 'en'
        ? `/en/industries/${data.slug}`
        : `/industrias/${data.slug}`
      setSEO(
        `Terminal X · ${data.eyebrow.replace(/·/g, '|')}`,
        data.lede,
        `https://terminalxpos.com${canonicalPath}`,
      )
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [slug, data])

  if (!data) return <Navigate to={lang === 'en' ? '/en' : '/'} replace />
  const T = (es, en) => (lang === 'en' ? en : es)
  const homeHref = lang === 'en' ? '/en' : '/'
  const signupHref = lang === 'en' ? '/en/signup' : '/signup'
  const industryHrefBase = lang === 'en' ? '/en/industries/' : '/industrias/'

  const Icon = data.icon
  const screenshotSrc = `/screenshots/${data.slug === 'salon' || data.slug === 'mecanica' || data.slug === 'prestamos' ? 'tiendas' : data.slug}.png`

  return (
    <div className="min-h-screen bg-white">
      {/* Top nav */}
      <nav className="sticky top-0 z-40 bg-black text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to={homeHref} className="flex items-center gap-3 group">
            <ChevronLeft size={18} className="opacity-60 group-hover:opacity-100 transition" />
            <span className="font-black tracking-tight">TERMINAL X</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to={signupHref}
              className="hidden sm:inline-flex items-center gap-2 bg-[#b3001e] hover:brightness-110 text-white font-bold px-4 py-2 rounded-lg text-sm"
            >
              {T('Empezar gratis 7 días', 'Start free 7-day trial')}
            </Link>
            <a
              href={waLink(T(`Hola, quiero saber más de Terminal X para ${data.eyebrow}`, `Hi, I'd like to know more about Terminal X for ${data.eyebrow}`))}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-2 rounded-lg text-sm"
            >
              <Phone size={14} /> WhatsApp
            </a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="bg-black text-white px-4 sm:px-6 lg:px-8 py-20 md:py-28">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#b3001e] flex items-center justify-center">
              <Icon size={20} className="text-white" />
            </div>
            <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e]">{data.eyebrow}</p>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight max-w-4xl leading-[1.05]">
            {data.title}
          </h1>
          <p className="mt-6 text-base md:text-lg text-white/70 max-w-3xl leading-relaxed">{data.lede}</p>

          {data.heroBadges?.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {data.heroBadges.map(b => (
                <span key={b} className="px-3 py-1.5 bg-white/10 border border-white/10 rounded-full text-xs font-semibold text-white/80">
                  {b}
                </span>
              ))}
            </div>
          )}

          <div className="mt-10 flex flex-col sm:flex-row gap-3">
            <Link
              to={`${signupHref}?utm_source=industria_${data.slug}`}
              className="inline-flex items-center justify-center gap-2 bg-[#b3001e] hover:brightness-110 text-white font-bold px-7 py-4 rounded-xl text-sm sm:text-base"
            >
              {T('Probar 7 días gratis', 'Try free for 7 days')} <ArrowRight size={16} />
            </Link>
            <a
              href={waLink(T(`Hola, quiero ver una demo de Terminal X para ${data.eyebrow}`, `Hi, I'd like a demo of Terminal X for ${data.eyebrow}`))}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold px-7 py-4 rounded-xl text-sm sm:text-base"
            >
              <Phone size={16} /> {T('Pedir demo por WhatsApp', 'Request a WhatsApp demo')}
            </a>
          </div>

          <p className="mt-6 text-xs text-white/40 font-semibold tracking-wide uppercase">
            {T('Plan recomendado', 'Recommended plan')}: {data.plan.name} · {data.plan.price}
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-white py-20 md:py-28 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{T('CÓMO FUNCIONA', 'HOW IT WORKS')}</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-black">{T('El flujo, paso a paso', 'The flow, step by step')}</h2>
          <div className="mt-12 grid gap-8 md:gap-10 md:grid-cols-2">
            {data.howItWorks.map(step => (
              <div key={step.n} className="flex gap-5">
                <div className="shrink-0 w-12 h-12 rounded-xl bg-[#b3001e] text-white font-black text-xl flex items-center justify-center">
                  {step.n}
                </div>
                <div>
                  <h3 className="font-black text-black text-lg leading-tight">{step.title}</h3>
                  <p className="mt-2 text-sm text-black/70 leading-relaxed">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SUBTYPES (only tiendas) */}
      {data.subtypes && (
        <section className="bg-black text-white py-20 md:py-28 px-4 sm:px-6 lg:px-8 border-t border-white/5">
          <div className="max-w-6xl mx-auto">
            <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{T('SUB-VERTICALES', 'SUB-VERTICALS')}</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{T('8 plantillas, una sola plataforma', '8 templates, one platform')}</h2>
            <p className="mt-4 text-white/60 max-w-3xl">{T('Cada sub-vertical arranca con sus categorías, validaciones y reglas activadas — no tienes que configurarlas tú.', 'Each sub-vertical ships with its own categories, validation rules and behaviors enabled — you do not have to configure them.')}</p>
            <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.subtypes.map(s => (
                <div key={s.name} className="rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition p-5">
                  <div className="flex items-center gap-3">
                    <s.icon size={22} className="text-[#b3001e]" />
                    <h3 className="font-black text-white">{s.name}</h3>
                  </div>
                  <p className="mt-3 text-xs text-white/60 leading-relaxed">{s.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FEATURES */}
      <section className="bg-white py-20 md:py-28 px-4 sm:px-6 lg:px-8 border-t border-black/5">
        <div className="max-w-6xl mx-auto">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{T('QUÉ INCLUYE', "WHAT'S INCLUDED")}</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-black">{T('Funcionalidades específicas para tu vertical', 'Vertical-specific features built for you')}</h2>
          <ul className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.features.map((f, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl border border-black/5 bg-black/[0.02] p-4">
                <div className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[#b3001e]/10 flex items-center justify-center">
                  <Check size={12} className="text-[#b3001e]" />
                </div>
                <span className="text-sm text-black/85 leading-snug">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* SCREENS */}
      {data.screens?.length > 0 && (
        <section className="bg-black text-white py-20 md:py-28 px-4 sm:px-6 lg:px-8 border-t border-white/5">
          <div className="max-w-6xl mx-auto">
            <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{T('PANTALLAS QUE USARÁS', "SCREENS YOU'LL USE")}</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{T('Diseñado para el día a día', 'Designed for everyday operation')}</h2>
            <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.screens.map(s => (
                <div key={s.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                  <h3 className="font-black text-white">{s.name}</h3>
                  <p className="mt-2 text-xs text-white/55 leading-relaxed">{s.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      {data.faq?.length > 0 && (
        <section className="bg-white py-20 md:py-28 px-4 sm:px-6 lg:px-8 border-t border-black/5">
          <div className="max-w-4xl mx-auto">
            <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{T('PREGUNTAS FRECUENTES', 'FREQUENTLY ASKED QUESTIONS')}</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-black">{T('Lo que más nos preguntan', 'What we get asked most')}</h2>
            <div className="mt-12 divide-y divide-black/10">
              {data.faq.map((f, i) => (
                <details key={i} className="group py-5">
                  <summary className="cursor-pointer list-none flex items-start justify-between gap-6">
                    <span className="font-bold text-black text-base">{f.q}</span>
                    <span className="shrink-0 text-[#b3001e] font-black text-2xl leading-none group-open:rotate-45 transition-transform">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-black/70 leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* RELATED VERTICALS */}
      <section className="bg-black text-white py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{T('OTROS SECTORES', 'OTHER INDUSTRIES')}</p>
          <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">{T('Terminal X funciona también para…', 'Terminal X also works for…')}</h2>
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {INDUSTRIES_INDEX.filter(i => i.slug !== data.slug).map(i => {
              const RIcon = i.icon
              return (
                <Link
                  key={i.slug}
                  to={`${industryHrefBase}${i.slug}`}
                  className="group rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-[#b3001e]/40 transition p-4 flex items-center gap-3"
                >
                  <RIcon size={18} className="text-[#b3001e]" />
                  <span className="text-sm font-bold text-white/90 group-hover:text-white">{i.eyebrow.split('·')[0].trim()}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-[#b3001e] text-white py-20 md:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{T('¿Listo para arrancar?', 'Ready to get started?')}</h2>
          <p className="mt-5 text-white/85 text-base md:text-lg max-w-2xl mx-auto">
            {T('Prueba Terminal X 7 días gratis con tu Pro MAX desbloqueado. Sin tarjeta, sin compromisos.', 'Try Terminal X free for 7 days with full Pro MAX unlocked. No card, no commitment.')}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to={`${signupHref}?utm_source=industria_${data.slug}_cta`}
              className="inline-flex items-center justify-center gap-2 bg-black hover:bg-white hover:text-black text-white font-bold px-8 py-4 rounded-xl"
            >
              {T('Empezar gratis', 'Start free')} <ArrowRight size={16} />
            </Link>
            <a
              href={waLink(T(`Hola, quiero info de Terminal X para ${data.eyebrow}`, `Hi, I'd like info about Terminal X for ${data.eyebrow}`))}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-bold px-8 py-4 rounded-xl"
            >
              <Phone size={16} /> WhatsApp +1 (809) 828-2971
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-black text-white/40 text-xs py-10 px-4 sm:px-6 lg:px-8 text-center border-t border-white/5">
        © {new Date().getFullYear()} Terminal X · Studio X · Santo Domingo, {T('RD', 'Dominican Republic')} ·{' '}
        <Link to={homeHref} className="hover:text-white">terminalxpos.com</Link>
      </footer>
    </div>
  )
}
