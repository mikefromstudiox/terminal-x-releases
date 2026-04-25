import { Link } from 'react-router-dom'
import { Clock, ArrowRight } from 'lucide-react'
import posts from '../data/blogPosts.json'

// BlogIndex — list view at /blog. Self-contained.

const COPY = {
  es: { eyebrow: 'BLOG', title: 'Guías y comparativas', readM: 'min lectura', read: 'Leer' },
  en: { eyebrow: 'BLOG', title: 'Guides and comparisons', readM: 'min read', read: 'Read' },
}

export default function BlogIndex({ lang = 'es' }) {
  const t = COPY[lang] || COPY.es
  const titleKey = lang === 'en' ? 'title_en' : 'title_es'
  const excerptKey = lang === 'en' ? 'excerpt_en' : 'excerpt_es'

  return (
    <section className="bg-white py-20 md:py-24 px-4 sm:px-6 lg:px-8 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="mb-12">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{t.eyebrow}</p>
          <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tight text-black">{t.title}</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {posts.map(p => (
            <Link
              key={p.slug}
              to={`/blog/${p.slug}`}
              className="group block rounded-2xl border border-black/10 bg-white hover:border-[#b3001e]/40 hover:shadow-xl hover:-translate-y-0.5 transition-all p-6"
            >
              <div className="flex flex-wrap gap-2 mb-3">
                {p.tags?.slice(0, 3).map(tag => (
                  <span key={tag} className="px-2 py-0.5 rounded-full bg-[#b3001e]/10 text-[10px] font-bold tracking-wider uppercase text-[#b3001e]">{tag}</span>
                ))}
              </div>
              <h2 className="text-xl md:text-2xl font-black text-black leading-snug tracking-tight">{p[titleKey]}</h2>
              <p className="mt-2 text-sm text-black/60 line-clamp-3 leading-relaxed">{p[excerptKey]}</p>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 text-black/50">
                  <Clock size={12} />
                  {p.readMinutes} {t.readM}
                </span>
                <span className="inline-flex items-center gap-1 font-bold text-[#b3001e] group-hover:gap-2 transition-all">
                  {t.read}<ArrowRight size={12} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
