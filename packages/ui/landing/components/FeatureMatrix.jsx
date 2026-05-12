import { useState, useMemo } from 'react'
import { Check, Minus } from 'lucide-react'
import matrix from '../data/featureMatrix.json'

// FeatureMatrix — full features × 7 tiers table.
// Self-contained. Accepts `lang` prop. Default "es".

const TIER_KEYS = ['facturacion', 'facturacion_plus', 'facturacion_unlimited', 'pro', 'pro_plus', 'pro_max']

const TIER_LABELS = {
  facturacion: 'Facturación',
  facturacion_plus: 'Facturación Plus',
  facturacion_unlimited: 'Facturación Ilim.',
  pro: 'Pro',
  pro_plus: 'Pro PLUS',
  pro_max: 'Pro MAX',
}

const TIER_PRICES = {
  facturacion: 'RD$995',
  facturacion_plus: 'RD$1,990',
  facturacion_unlimited: 'RD$2,990',
  pro: 'RD$2,490',
  pro_plus: 'RD$4,490',
  pro_max: 'RD$6,990',
}

const CATEGORY_LABELS = {
  es: { POS: 'POS', Fiscal: 'Fiscal', Inventario: 'Inventario', 'Nómina': 'Nómina', Cloud: 'Cloud', Premium: 'Premium' },
  en: { POS: 'POS', Fiscal: 'Tax', Inventario: 'Inventory', 'Nómina': 'Payroll', Cloud: 'Cloud', Premium: 'Premium' },
}

function CellValue({ v }) {
  if (v === true) return <Check size={16} className="text-[#b3001e] mx-auto" aria-label="incluido" />
  if (v === false) return <Minus size={16} className="text-black/25 mx-auto" aria-label="no incluido" />
  return <span className="text-xs font-semibold text-black/80">{v}</span>
}

export default function FeatureMatrix({ lang = 'es' }) {
  const [activeCat, setActiveCat] = useState('all')
  const categories = useMemo(() => {
    const set = new Set()
    matrix.forEach(r => set.add(r.category))
    return ['all', ...set]
  }, [])

  const rows = useMemo(() => {
    if (activeCat === 'all') return matrix
    return matrix.filter(r => r.category === activeCat)
  }, [activeCat])

  const catLabels = CATEGORY_LABELS[lang] || CATEGORY_LABELS.es
  const featKey = lang === 'en' ? 'feature_en' : 'feature_es'

  const eyebrow = lang === 'es' ? 'TODAS LAS CARACTERÍSTICAS' : 'ALL FEATURES'
  const title = lang === 'es' ? 'Qué incluye cada plan' : 'What each plan includes'
  const allLabel = lang === 'es' ? 'Todas' : 'All'

  return (
    <section id="feature-matrix" className="bg-white py-20 md:py-28 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{eyebrow}</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-black">{title}</h2>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          <button
            onClick={() => setActiveCat('all')}
            className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-colors ${
              activeCat === 'all' ? 'bg-[#b3001e] text-white' : 'bg-black/5 text-black/70 hover:bg-black/10'
            }`}
          >{allLabel}</button>
          {categories.filter(c => c !== 'all').map(c => (
            <button
              key={c}
              onClick={() => setActiveCat(c)}
              className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-colors ${
                activeCat === c ? 'bg-[#b3001e] text-white' : 'bg-black/5 text-black/70 hover:bg-black/10'
              }`}
            >{catLabels[c] || c}</button>
          ))}
        </div>

        {/* Matrix table — sticky col 1 on mobile horizontal scroll */}
        <div className="rounded-2xl border border-black/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="bg-black/[0.03]">
                  <th className="sticky left-0 z-10 bg-black/[0.03] text-left px-4 py-3 text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 min-w-[260px]">
                    {lang === 'es' ? 'Característica' : 'Feature'}
                  </th>
                  {TIER_KEYS.map(k => {
                    const isPlus = k === 'pro_plus'
                    return (
                      <th key={k} className={`px-3 py-3 text-center min-w-[100px] ${isPlus ? 'bg-[#b3001e]/5' : ''}`}>
                        <div className={`text-[11px] font-extrabold tracking-[1px] uppercase ${isPlus ? 'text-[#b3001e]' : 'text-black/70'}`}>
                          {TIER_LABELS[k]}
                        </div>
                        <div className="text-[10px] text-black/45 mt-0.5">{TIER_PRICES[k]}/mes</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={`border-t border-black/5 ${i % 2 === 0 ? '' : 'bg-black/[0.015]'}`}>
                    <td className="sticky left-0 z-10 bg-inherit px-4 py-3 text-sm text-black font-semibold">
                      <span className="text-[10px] uppercase tracking-wider text-black/40 mr-2">{catLabels[row.category] || row.category}</span>
                      <span className="block sm:inline">{row[featKey]}</span>
                    </td>
                    {TIER_KEYS.map(k => {
                      const isPlus = k === 'pro_plus'
                      return (
                        <td key={k} className={`px-3 py-3 text-center align-middle ${isPlus ? 'bg-[#b3001e]/5 border-l border-r border-[#b3001e]/20' : ''}`}>
                          <CellValue v={row.tiers[k]} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-black/45">
          {lang === 'es' ? 'Pro PLUS es el plan más popular — equilibrio óptimo entre POS y facturación electrónica.' : 'Pro PLUS is the most popular plan — best balance of POS and e-invoicing.'}
        </p>
      </div>
    </section>
  )
}
