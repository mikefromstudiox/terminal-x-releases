import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, Droplets, Wine, Pill, ShoppingBasket, ShoppingCart,
  Hammer, BookOpen, Shirt, UtensilsCrossed, Wrench, Scissors,
  Car, Coins, ArrowRight
} from 'lucide-react'

// DemoStrip — three stacked pieces:
//   a. CertificationCallout (also exported standalone)
//   b. Trust ribbon (logos row — placeholders)
//   c. Demo grid (8 vertical demo cards)
// Self-contained. Accepts `lang` prop and `ecfsIssued` (default "10K+").

const VERTICALS = [
  { key: 'carwash', icon: Droplets, es: 'Carwash', en: 'Carwash', tease: { es: 'Cola en vivo + lavadores + comisiones.', en: 'Live queue + washers + commissions.' } },
  { key: 'licoreria', icon: Wine, es: 'Licorería', en: 'Liquor', tease: { es: 'Verificación de edad y depósito de envases.', en: 'Age-gate + bottle deposit.' } },
  { key: 'farmacia', icon: Pill, es: 'Farmacia', en: 'Pharmacy', tease: { es: 'Tracking de recetas controladas.', en: 'Controlled-rx tracking.' } },
  { key: 'colmado', icon: ShoppingBasket, es: 'Colmado', en: 'Colmado', tease: { es: 'Fiado y cobro mensual.', en: 'Fiado + monthly billing.' } },
  { key: 'supermercado', icon: ShoppingCart, es: 'Supermercado', en: 'Supermarket', tease: { es: 'Mostrador deli + venta por peso.', en: 'Deli counter + sale by weight.' } },
  { key: 'ferreteria', icon: Hammer, es: 'Ferretería', en: 'Hardware', tease: { es: 'Cotizaciones formales.', en: 'Formal estimates.' } },
  { key: 'papeleria', icon: BookOpen, es: 'Papelería', en: 'Stationery', tease: { es: 'Paquetes escolares.', en: 'School-supply packs.' } },
  { key: 'boutique', icon: Shirt, es: 'Boutique', en: 'Boutique', tease: { es: 'Variantes de talla y color.', en: 'Size + color variants.' } },
  { key: 'restaurante', icon: UtensilsCrossed, es: 'Restaurante', en: 'Restaurant', tease: { es: 'KDS + mesas + propinas.', en: 'KDS + tables + tips.' } },
  { key: 'mecanica', icon: Wrench, es: 'Mecánica', en: 'Mechanics', tease: { es: 'WorkOrders → ticket.', en: 'WorkOrders → ticket.' } },
  { key: 'salon', icon: Scissors, es: 'Salón', en: 'Salon', tease: { es: 'Citas y schedules de estilistas.', en: 'Appointments + stylist schedules.' } },
  { key: 'concesionario', icon: Car, es: 'Concesionario', en: 'Dealership', tease: { es: 'DealBuilder + ruteo E31.', en: 'DealBuilder + E31 routing.' } },
  { key: 'pawn', icon: Coins, es: 'Casa de Empeño', en: 'Pawn', tease: { es: 'Préstamos + cobranzas.', en: 'Loans + collections.' } },
]

export function CertificationCallout({ lang = 'es' }) {
  const eyebrow = lang === 'es' ? 'CERTIFICACIÓN' : 'CERTIFICATION'
  const title = lang === 'es'
    ? 'El único POS en RD certificado como Emisor Electrónico directo'
    : 'The only POS in DR directly certified as Electronic Issuer'
  const bullets = lang === 'es'
    ? ['DGII Cert #42483', 'RNC 133410321', 'Sin PSFE intermediario', 'Sin costo por comprobante']
    : ['DGII Cert #42483', 'RNC 133410321', 'No PSFE middleman', 'No per-invoice fee']

  return (
    <div className="relative rounded-3xl border-2 border-[#b3001e] bg-black text-white p-8 md:p-12 overflow-hidden">
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-[#b3001e]/20 blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#b3001e]/15 border border-[#b3001e]/40 mb-5">
          <ShieldCheck size={14} className="text-[#b3001e]" />
          <span className="text-[11px] font-extrabold tracking-[2px] text-[#b3001e]">{eyebrow}</span>
        </div>
        <h3 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight leading-tight max-w-3xl">{title}</h3>
        <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
          {bullets.map((b, i) => (
            <li key={i} className="text-sm font-bold text-white/85 inline-flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#b3001e]" />{b}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// Logos live at /logos/{slug}.svg — drop transparent SVGs into web/public/logos/
// Falls back to the brand name as bold text if the SVG hasn't been uploaded yet.
function TrustRibbon({ lang = 'es' }) {
  const label = lang === 'es' ? 'Construido sobre' : 'Powered by'
  const items = [
    { slug: 'dgii',       name: 'DGII' },
    { slug: 'viafirma',   name: 'Viafirma' },
    { slug: 'supabase',   name: 'Supabase' },
    { slug: 'vercel',     name: 'Vercel' },
    { slug: 'cloudflare', name: 'Cloudflare' },
  ]
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-6 md:p-8">
      <p className="text-[10px] font-extrabold tracking-[3px] uppercase text-black/40 mb-4 text-center">{label}</p>
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {items.map(i => (
          <img
            key={i.slug}
            src={`/logos/${i.slug}.svg`}
            alt={i.name}
            className="h-8 md:h-10 w-auto opacity-60 hover:opacity-100 transition-opacity grayscale hover:grayscale-0"
            loading="lazy"
            onError={e => {
              // SVG missing — fallback to bold text label so the ribbon never breaks
              const fallback = document.createElement('span')
              fallback.className = 'text-xl md:text-2xl font-black tracking-wide text-black/45'
              fallback.textContent = i.name
              e.target.replaceWith(fallback)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function VerticalCard({ v, lang }) {
  const navigate = useNavigate()
  const Icon = v.icon
  return (
    <button
      onClick={() => navigate(`/demo/${v.key}`)}
      className="group text-left rounded-2xl border border-black/10 bg-white hover:border-[#b3001e]/40 hover:shadow-xl hover:-translate-y-0.5 transition-all p-5 flex flex-col"
    >
      <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center mb-3">
        <Icon size={20} className="text-[#b3001e]" />
      </div>
      <h4 className="text-base font-black text-black">{lang === 'en' ? v.en : v.es}</h4>
      <p className="mt-1 text-xs text-black/55 leading-snug line-clamp-2 flex-1">{lang === 'en' ? v.tease.en : v.tease.es}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#b3001e] group-hover:gap-2 transition-all">
        {lang === 'es' ? 'Probar demo' : 'Try demo'}
        <ArrowRight size={13} />
      </span>
    </button>
  )
}

export default function DemoStrip({ lang = 'es', ecfsIssued = '10K+' }) {
  const eyebrow = lang === 'es' ? 'PRUEBA EN VIVO' : 'LIVE TRY'
  const title = lang === 'es' ? 'Prueba un POS por vertical, sin instalar nada' : 'Try a POS per vertical, install-free'
  const volumeLine = lang === 'es'
    ? `${ecfsIssued} e-CFs emitidos · ${ecfsIssued} comprobantes validados por DGII`
    : `${ecfsIssued} e-CFs issued · ${ecfsIssued} receipts validated by DGII`

  return (
    <section id="demo-strip" className="bg-white py-20 md:py-28 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-10 md:space-y-14">
        <CertificationCallout lang={lang} />
        <TrustRibbon lang={lang} />

        <div>
          <div className="text-center mb-8">
            <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{eyebrow}</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-black">{title}</h2>
            <p className="mt-3 text-sm font-bold text-black/55 tabular-nums">{volumeLine}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {VERTICALS.map(v => <VerticalCard key={v.key} v={v} lang={lang} />)}
          </div>
        </div>
      </div>
    </section>
  )
}
