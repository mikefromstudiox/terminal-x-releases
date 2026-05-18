/**
 * SeoLandingPage.jsx — generalized commercial landing page used by the 4
 * Phase-1 SEO sprint pages:
 *
 *   /sistema-pos
 *   /software-pos
 *   /alternativa-facturador-gratuito-dgii
 *   /facturador-electronico-dgii
 *
 * Content lives in data/seoLandingPages.js — copy edits do not touch JSX.
 *
 * Brand: black/white/#b3001e crimson only. NO gray. WhatsApp +1 (809) 828-2971
 * is primary CTA. FAQ schema is emitted by web/middleware.js based on the
 * SEO_LANDING_FAQS map exported below.
 */

import { useEffect } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { ArrowRight, Check, Phone, ChevronLeft } from 'lucide-react'
import { SEO_LANDING_PAGES } from './data/seoLandingPages'
import { INDUSTRIES_INDEX } from './data/industries'

const CRIMSON = '#b3001e'
const WA = '+18098282971'

function upsertMeta(selector, attrName, attrValue, contentAttr, content) {
  if (typeof document === 'undefined') return
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
  }
}

function waLink(text) {
  return `https://wa.me/${WA.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

function industryHref(slug) {
  return `/industrias/${slug}`
}

export default function SeoLandingPage({ pageKey }) {
  // Route can either be pre-bound via `pageKey` prop or resolved from `:slug`.
  const params = useParams()
  const key = pageKey || params.slug
  const data = SEO_LANDING_PAGES[key]

  useEffect(() => {
    if (data) {
      setSEO(`${data.h1} · Terminal X`, data.lede, data.canonical)
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [key, data])

  if (!data) return <Navigate to="/" replace />

  const industryBySlug = Object.fromEntries(INDUSTRIES_INDEX.map(i => [i.slug, i]))

  return (
    <div className="min-h-screen bg-white">
      {/* Top nav */}
      <nav className="sticky top-0 z-40 bg-black text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <ChevronLeft size={18} className="opacity-60 group-hover:opacity-100 transition" />
            <span className="font-black tracking-tight">TERMINAL X</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to={data.ctaPrimary.href}
              className="hidden sm:inline-flex items-center gap-2 bg-[#b3001e] hover:brightness-110 text-white font-bold px-4 py-2 rounded-lg text-sm"
            >
              {data.ctaPrimary.label}
            </Link>
            <a
              href={waLink(data.ctaSecondary.wa)}
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
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-6">{data.eyebrow}</p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight max-w-4xl leading-[1.05]">
            {data.h1}
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
              to={data.ctaPrimary.href}
              className="inline-flex items-center justify-center gap-2 bg-[#b3001e] hover:brightness-110 text-white font-bold px-7 py-4 rounded-xl text-sm sm:text-base"
            >
              {data.ctaPrimary.label} <ArrowRight size={16} />
            </Link>
            <a
              href={waLink(data.ctaSecondary.wa)}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold px-7 py-4 rounded-xl text-sm sm:text-base"
            >
              <Phone size={16} /> {data.ctaSecondary.label}
            </a>
          </div>
        </div>
      </section>

      {/* SECTIONS — alternating white/black for visual rhythm per brand */}
      {data.sections.map((sec, idx) => {
        const isBlack = idx % 2 === 1
        const bg = isBlack ? 'bg-black text-white border-t border-white/5' : 'bg-white text-black border-t border-black/5'

        if (sec.kind === 'prose') {
          return (
            <section key={idx} className={`${bg} py-20 md:py-28 px-4 sm:px-6 lg:px-8`}>
              <div className="max-w-4xl mx-auto">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{sec.title}</h2>
                <div className="mt-8 space-y-5">
                  {sec.body.map((p, i) => (
                    <p key={i} className={`text-base md:text-lg leading-relaxed ${isBlack ? 'text-white/75' : 'text-black/75'}`}>{p}</p>
                  ))}
                </div>
              </div>
            </section>
          )
        }

        if (sec.kind === 'pillars') {
          return (
            <section key={idx} className={`${bg} py-20 md:py-28 px-4 sm:px-6 lg:px-8`}>
              <div className="max-w-6xl mx-auto">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{sec.title}</h2>
                <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {sec.items.map((it, i) => (
                    <div key={i} className={`rounded-2xl p-6 ${isBlack ? 'bg-white/5 border border-white/10' : 'bg-black/[0.03] border border-black/5'}`}>
                      <h3 className={`font-black text-lg leading-tight ${isBlack ? 'text-white' : 'text-black'}`}>{it.h}</h3>
                      <p className={`mt-3 text-sm leading-relaxed ${isBlack ? 'text-white/65' : 'text-black/70'}`}>{it.p}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )
        }

        if (sec.kind === 'industries') {
          return (
            <section key={idx} className={`${bg} py-20 md:py-28 px-4 sm:px-6 lg:px-8`}>
              <div className="max-w-6xl mx-auto">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{sec.title}</h2>
                <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {sec.items.map(it => {
                    const ind = industryBySlug[it.slug]
                    const Icon = ind?.icon
                    return (
                      <Link
                        key={it.slug}
                        to={industryHref(it.slug)}
                        className={`group rounded-2xl p-5 transition ${isBlack ? 'bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:border-[#b3001e]/40' : 'bg-black/[0.03] border border-black/5 hover:bg-black/[0.05] hover:border-[#b3001e]/40'}`}
                      >
                        <div className="flex items-center gap-3">
                          {Icon && <Icon size={18} className="text-[#b3001e]" />}
                          <h3 className={`font-black ${isBlack ? 'text-white' : 'text-black'}`}>{it.label}</h3>
                        </div>
                        <p className={`mt-3 text-xs leading-relaxed ${isBlack ? 'text-white/60' : 'text-black/65'}`}>{it.detail}</p>
                      </Link>
                    )
                  })}
                </div>
              </div>
            </section>
          )
        }

        if (sec.kind === 'comparisonTable') {
          return (
            <section key={idx} className={`${bg} py-20 md:py-28 px-4 sm:px-6 lg:px-8`}>
              <div className="max-w-6xl mx-auto">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{sec.title}</h2>
                <div className="mt-10 overflow-x-auto">
                  <table className={`w-full text-sm ${isBlack ? 'text-white' : 'text-black'}`}>
                    <thead>
                      <tr className={isBlack ? 'border-b border-white/10' : 'border-b border-black/10'}>
                        {sec.headers.map((h, i) => (
                          <th key={i} className={`text-left font-black uppercase tracking-wide text-xs py-4 px-3 ${i === 1 ? 'text-[#b3001e]' : ''}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sec.rows.map((row, i) => (
                        <tr key={i} className={isBlack ? 'border-b border-white/5' : 'border-b border-black/5'}>
                          {row.map((cell, j) => (
                            <td key={j} className={`py-4 px-3 align-top ${j === 0 ? 'font-bold' : ''} ${j === 1 ? 'text-[#b3001e] font-bold' : ''} ${isBlack ? 'text-white/85' : 'text-black/85'}`}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {sec.footer && (
                  <p className={`mt-6 text-xs italic ${isBlack ? 'text-white/60' : 'text-black/60'}`}>{sec.footer}</p>
                )}
              </div>
            </section>
          )
        }

        if (sec.kind === 'resources') {
          return (
            <section key={idx} className={`${bg} py-16 md:py-20 px-4 sm:px-6 lg:px-8`}>
              <div className="max-w-4xl mx-auto">
                <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">{sec.title}</h2>
                <ul className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sec.items.map((it, i) => (
                    <li key={i}>
                      <Link
                        to={it.href}
                        className={`flex items-start gap-3 rounded-xl p-4 transition ${isBlack ? 'bg-white/5 hover:bg-white/10 border border-white/10' : 'bg-black/[0.03] hover:bg-black/[0.06] border border-black/5'}`}
                      >
                        <ArrowRight size={16} className="text-[#b3001e] mt-1 shrink-0" />
                        <span className={`text-sm font-bold ${isBlack ? 'text-white' : 'text-black'}`}>{it.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )
        }

        return null
      })}

      {/* FAQ */}
      {data.faq?.length > 0 && (
        <section className="bg-white py-20 md:py-28 px-4 sm:px-6 lg:px-8 border-t border-black/5">
          <div className="max-w-4xl mx-auto">
            <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">PREGUNTAS FRECUENTES</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-black">Lo que más nos preguntan</h2>
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

      {/* FINAL CTA */}
      <section className="bg-[#b3001e] text-white py-20 md:py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{data.closingPitch.title}</h2>
          <p className="mt-5 text-white/85 text-base md:text-lg max-w-2xl mx-auto">{data.closingPitch.body}</p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to={data.ctaPrimary.href}
              className="inline-flex items-center justify-center gap-2 bg-black hover:bg-white hover:text-black text-white font-bold px-8 py-4 rounded-xl"
            >
              {data.ctaPrimary.label} <ArrowRight size={16} />
            </Link>
            <a
              href={waLink(data.ctaSecondary.wa)}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-bold px-8 py-4 rounded-xl"
            >
              <Phone size={16} /> WhatsApp +1 (809) 828-2971
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-black text-white/60 text-xs py-10 px-4 sm:px-6 lg:px-8 text-center border-t border-white/5">
        © {new Date().getFullYear()} Terminal X · Studio X · Santo Domingo, RD ·{' '}
        <Link to="/" className="hover:text-white">terminalxpos.com</Link>
      </footer>
    </div>
  )
}
