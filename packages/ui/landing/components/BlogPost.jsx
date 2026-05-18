import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
// Twitter icon was removed from lucide-react v1.7+ in favor of brand-neutral
// icons. Use Send (paper-plane) for the X/Twitter share affordance — matches
// the hover-to-crimson visual language and stays brand-agnostic.
import { Clock, ArrowLeft, ArrowRight, Send, MessageCircle, Link2, Check } from 'lucide-react'
import posts from '../data/blogPosts.json'

// BlogPost — article view at /blog/:slug. TOC sidebar, share buttons, CTA card.
// TODO: swap body_html for full MDX rendering when react-markdown is added.

const COPY = {
  es: {
    notFound: 'Artículo no encontrado',
    backToBlog: 'Volver al blog',
    toc: 'En este artículo',
    share: 'Compartir',
    copy: 'Copiar enlace',
    copied: 'Copiado',
    ctaTitle: 'Empezar con Terminal X · 7 días gratis',
    ctaBody: 'Sin tarjeta. Configurado por nuestro equipo. Cancelas cuando quieras.',
    ctaBtn: 'Crear cuenta',
    readM: 'min lectura',
  },
  en: {
    notFound: 'Article not found',
    backToBlog: 'Back to blog',
    toc: 'In this article',
    share: 'Share',
    copy: 'Copy link',
    copied: 'Copied',
    ctaTitle: 'Start with Terminal X · 7 days free',
    ctaBody: 'No credit card. Set up by our team. Cancel anytime.',
    ctaBtn: 'Create account',
    readM: 'min read',
  },
}

function extractToc(html) {
  const matches = [...(html.matchAll(/<h2\s+id="([^"]+)"[^>]*>([^<]+)<\/h2>/gi) || [])]
  return matches.map(m => ({ id: m[1], label: m[2] }))
}

export default function BlogPost({ lang = 'es' }) {
  const { slug } = useParams()
  const navigate = useNavigate()
  const t = COPY[lang] || COPY.es
  const [copied, setCopied] = useState(false)

  const post = useMemo(() => posts.find(p => p.slug === slug), [slug])
  const bodyHtml = post ? (lang === 'en' && post.body_html_en ? post.body_html_en : post.body_html) : ''
  const toc = useMemo(() => post ? extractToc(bodyHtml) : [], [post, bodyHtml])

  useEffect(() => { window.scrollTo(0, 0) }, [slug])

  if (!post) {
    return (
      <section className="bg-white py-24 px-4 min-h-screen flex flex-col items-center justify-center">
        <h1 className="text-2xl font-black text-black">{t.notFound}</h1>
        <Link to={lang === 'en' ? '/en/blog' : '/blog'} className="mt-4 inline-flex items-center gap-2 text-[#b3001e] font-bold">
          <ArrowLeft size={16} />{t.backToBlog}
        </Link>
      </section>
    )
  }

  const titleKey = lang === 'en' ? 'title_en' : 'title_es'
  const title = post[titleKey]
  const url = typeof window !== 'undefined' ? window.location.href : ''

  function copyLink() {
    try {
      navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <article className="bg-white py-20 md:py-24 px-4 sm:px-6 lg:px-8 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <Link to={lang === 'en' ? '/en/blog' : '/blog'} className="inline-flex items-center gap-2 text-sm font-bold text-black/60 hover:text-[#b3001e] mb-8 transition-colors">
          <ArrowLeft size={14} />{t.backToBlog}
        </Link>

        <header className="mb-10">
          <div className="flex flex-wrap gap-2 mb-4">
            {post.tags?.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-full bg-[#b3001e]/10 text-[10px] font-bold tracking-wider uppercase text-[#b3001e]">{tag}</span>
            ))}
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight text-black leading-tight">{title}</h1>
          <div className="mt-5 flex items-center gap-4 text-xs text-black/60">
            <span className="font-semibold">{post.author}</span>
            <span>·</span>
            <span>{post.date}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Clock size={12} />{post.readMinutes} {t.readM}</span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* TOC sidebar */}
          {toc.length > 0 && (
            <aside className="lg:col-span-3 lg:order-2">
              <div className="sticky top-[140px]">
                <p className="text-[10px] font-extrabold tracking-[3px] uppercase text-black/60 mb-3">{t.toc}</p>
                <ul className="space-y-2">
                  {toc.map(h => (
                    <li key={h.id}>
                      <a href={`#${h.id}`} className="text-sm text-black/65 hover:text-[#b3001e] transition-colors">{h.label}</a>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 pt-6 border-t border-black/10">
                  <p className="text-[10px] font-extrabold tracking-[3px] uppercase text-black/60 mb-3">{t.share}</p>
                  <div className="flex gap-2">
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="w-9 h-9 rounded-lg bg-black/5 hover:bg-[#b3001e] hover:text-white text-black/60 flex items-center justify-center transition-colors"
                      aria-label="Twitter"
                    ><Send size={15} /></a>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="w-9 h-9 rounded-lg bg-black/5 hover:bg-[#b3001e] hover:text-white text-black/60 flex items-center justify-center transition-colors"
                      aria-label="WhatsApp"
                    ><MessageCircle size={15} /></a>
                    <button
                      onClick={copyLink}
                      className="w-9 h-9 rounded-lg bg-black/5 hover:bg-[#b3001e] hover:text-white text-black/60 flex items-center justify-center transition-colors"
                      aria-label={t.copy}
                    >{copied ? <Check size={15} /> : <Link2 size={15} />}</button>
                  </div>
                </div>
              </div>
            </aside>
          )}

          {/* Body */}
          <div className="lg:col-span-9 lg:order-1">
            <div
              className="prose prose-lg max-w-none text-black/80
                [&_h2]:text-2xl [&_h2]:md:text-3xl [&_h2]:font-black [&_h2]:tracking-tight [&_h2]:text-black [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:scroll-mt-32
                [&_h3]:text-xl [&_h3]:font-extrabold [&_h3]:text-black [&_h3]:mt-8 [&_h3]:mb-3
                [&_p]:text-base [&_p]:leading-relaxed [&_p]:mb-5
                [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:my-5
                [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:my-5
                [&_li]:text-base [&_li]:leading-relaxed
                [&_a]:text-[#b3001e] [&_a]:font-semibold [&_a]:underline"
              // body_html is hand-authored content from blogPosts.json — safe.
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />

            {/* CTA card */}
            <div className="mt-14 rounded-3xl bg-black text-white p-8 md:p-10">
              <h3 className="text-2xl md:text-3xl font-black tracking-tight">{t.ctaTitle}</h3>
              <p className="mt-2 text-white/65 max-w-xl">{t.ctaBody}</p>
              <button
                onClick={() => navigate(`${lang === 'en' ? '/en/signup' : '/signup'}?plan=facturacion`)}
                className="mt-6 group inline-flex items-center gap-2 bg-[#b3001e] hover:bg-[#d4002a] text-white font-bold px-6 py-3 rounded-xl transition-colors"
              >
                {t.ctaBtn}<ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
