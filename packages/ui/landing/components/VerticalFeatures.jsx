import { useState, useEffect, useRef } from 'react'
import {
  Receipt, Droplets, Store, UtensilsCrossed, Wrench, Building2,
  Check, Wine, Pill, ShoppingBasket, ShoppingCart, Hammer,
  BookOpen, Shirt, Boxes, ChevronDown, ChevronUp, ArrowRight
} from 'lucide-react'

// VerticalFeatures — tabbed mega-section, replaces flat 10-card grid.
// Self-contained. Accepts `lang` prop. Default "es".

const TABS = {
  es: [
    { key: 'facturacion', label: 'Facturación', icon: Receipt, planAnchor: 'facturacion' },
    { key: 'carwash', label: 'Carwash', icon: Droplets, planAnchor: 'pro' },
    { key: 'tiendas', label: 'Tiendas', icon: Store, planAnchor: 'pro_plus' },
    { key: 'restaurantes', label: 'Restaurantes', icon: UtensilsCrossed, planAnchor: 'pro_plus' },
    { key: 'servicios', label: 'Servicios', icon: Wrench, planAnchor: 'pro_plus' },
    { key: 'empresas', label: 'Empresas', icon: Building2, planAnchor: 'pro_max' },
  ],
  en: [
    { key: 'facturacion', label: 'Invoicing', icon: Receipt, planAnchor: 'facturacion' },
    { key: 'carwash', label: 'Carwash', icon: Droplets, planAnchor: 'pro' },
    { key: 'tiendas', label: 'Retail', icon: Store, planAnchor: 'pro_plus' },
    { key: 'restaurantes', label: 'Restaurants', icon: UtensilsCrossed, planAnchor: 'pro_plus' },
    { key: 'servicios', label: 'Services', icon: Wrench, planAnchor: 'pro_plus' },
    { key: 'empresas', label: 'Enterprise', icon: Building2, planAnchor: 'pro_max' },
  ],
}

const VERTICALS = {
  es: {
    facturacion: {
      title: 'Para Facturación',
      blurb: 'Reemplaza el Facturador Gratuito de DGII con automatización real.',
      bullets: [
        'e-CF directo a DGII (E31/E32/E33/E34/E43)',
        'RNC lookup 900K registros locales',
        'Formato 606 (compras) y 607 (ventas) en 1 click',
        'Multi-moneda DOP + USD',
        'Creación de factura desde móvil',
        'Envío por WhatsApp post-cobro',
        'Cola offline 72h con IndicadorEnvioDiferido',
        'Certificado Viafirma incluido y administrado',
      ],
      planLabel: 'Plan recomendado: Facturación · desde RD$995/mes',
    },
    carwash: {
      title: 'Para Carwash',
      blurb: 'Cola en vivo, lavadores, comisiones — el flujo completo.',
      bullets: [
        'Cola de servicios + lavadores + comisiones',
        'Multi-lavador con conduce dividido',
        'Memberships con débito automático',
        'Conteo físico con varianza PDF/CSV',
        'Búsqueda por placa de vehículo',
        'Modo Kiosko con auto-bloqueo',
        'Tarjetas de autorización gerencial Code128',
        'Resumen diario al dueño por correo',
      ],
      planLabel: 'Plan recomendado: Pro · desde RD$2,490/mes',
    },
    tiendas: {
      title: 'Para Tiendas',
      blurb: '8 sub-verticales, cada una con sus reglas y categorías.',
      bullets: [
        'Códigos de barras + búsqueda SKU',
        'Inventario con alertas de stock',
        'Importación CSV/TSV con auto-mapeo',
        'Lealtad Bronce/Plata/Oro (x1.0/1.25/1.5)',
        'Pricing Pedidos Ya 1-click',
        'Precios por cliente (precedencia: cliente > PY > base)',
      ],
      subtypes: [
        { icon: Wine, name: 'Licorería', detail: 'Verificación de edad + depósito de envases' },
        { icon: Pill, name: 'Farmacia', detail: 'Tracking de recetas controladas' },
        { icon: ShoppingBasket, name: 'Colmado', detail: 'Fiado + cobro mensual' },
        { icon: ShoppingCart, name: 'Supermercado', detail: 'Mostrador deli + venta por peso' },
        { icon: Hammer, name: 'Ferretería', detail: 'Cotizaciones formales' },
        { icon: BookOpen, name: 'Papelería', detail: 'Paquetes escolares' },
        { icon: Shirt, name: 'Boutique', detail: 'Variantes (talla, color)' },
        { icon: Boxes, name: 'Otro', detail: 'Personalizable' },
      ],
      planLabel: 'Plan recomendado: Pro PLUS · desde RD$4,490/mes',
    },
    restaurantes: {
      title: 'Para Restaurantes',
      blurb: 'KDS, mesas, propinas, ruteo de impresoras — listo para servicio.',
      bullets: [
        'KDS para cocina con tickets activos',
        'Manejo de mesas con cuenta abierta',
        'SplitBill por ítem o por persona',
        'MenuBuilder con modificadores',
        'Propinas configurables',
        'Comprobante E43 para gastos',
        'Reportes restaurante (rotación, mesa, hora)',
        'Ruteo multi-impresora (cocina/bar/cajero)',
      ],
      planLabel: 'Plan recomendado: Pro PLUS · desde RD$4,490/mes',
    },
    servicios: {
      title: 'Para Servicios',
      blurb: 'Mecánica, salones, concesionarios, casas de empeño.',
      bullets: [
        'Mecánica: WorkOrders → ticket bridge, ServiceBays, historial vehicular',
        'Salones: Citas + Schedules de estilistas',
        'Concesionarios: DealBuilder + ruteo E31 ≥250K',
        'Casas de empeño: Loans + Collections + PawnItems',
        'Inventario de vehículos para concesionario',
        'Pipeline de ventas + test drives',
        'Calculadora de financiamiento',
        'Recibos formales con depreciación',
      ],
      planLabel: 'Plan recomendado: Pro PLUS · desde RD$4,490/mes',
    },
    empresas: {
      title: 'Para Empresas con Empleados',
      blurb: 'Nómina TSS/INFOTEP/ISR DR-2026 + Ley 16-92.',
      bullets: [
        'Nómina quincenal y mensual masiva en 1 click',
        'TSS automático (SFS + AFP con topes 2026)',
        'INFOTEP 1% automático',
        'ISR progresivo (escalas DGII 2026)',
        'Reportes listos para portal TSS y DGII',
        'Recibos de pago formales',
        'Cesantía Ley 16-92 con pasivo acumulado',
        'Log automático de cambios de salario',
        'Multi-ubicación + ticket locks',
        'Dashboard remoto en tiempo real',
      ],
      planLabel: 'Plan recomendado: Pro MAX · desde RD$6,990/mes',
    },
  },
  en: {
    facturacion: {
      title: 'For Invoicing',
      blurb: 'Replace the DGII Free Invoicer with real automation.',
      bullets: [
        'Direct e-CF to DGII (E31/E32/E33/E34/E43)',
        'RNC lookup 900K local records',
        'Format 606 (purchases) & 607 (sales) in 1 click',
        'Multi-currency DOP + USD',
        'Mobile invoice creation',
        'Auto WhatsApp delivery after charge',
        '72h offline queue with IndicadorEnvioDiferido',
        'Viafirma cert included and managed',
      ],
      planLabel: 'Recommended: Invoicing · from RD$995/mo',
    },
    carwash: {
      title: 'For Carwash',
      blurb: 'Live queue, washers, commissions — the full flow.',
      bullets: [
        'Service queue + washers + commissions',
        'Multi-washer split conduce',
        'Memberships with auto-debit',
        'Physical count with variance PDF/CSV',
        'License-plate vehicle lookup',
        'Kiosk mode with idle auto-lock',
        'Manager auth cards Code128',
        'Daily owner digest email',
      ],
      planLabel: 'Recommended: Pro · from RD$2,490/mo',
    },
    tiendas: {
      title: 'For Retail',
      blurb: '8 sub-verticals, each with its own rules and categories.',
      bullets: [
        'Barcodes + SKU search',
        'Inventory with stock alerts',
        'CSV/TSV import with auto-mapping',
        'Loyalty Bronze/Silver/Gold (x1.0/1.25/1.5)',
        '1-click Pedidos Ya pricing',
        'Per-client pricing (client > PY > base)',
      ],
      subtypes: [
        { icon: Wine, name: 'Liquor', detail: 'Age-gate + bottle deposit' },
        { icon: Pill, name: 'Pharmacy', detail: 'Controlled-rx tracking' },
        { icon: ShoppingBasket, name: 'Colmado', detail: 'Fiado + monthly billing' },
        { icon: ShoppingCart, name: 'Supermarket', detail: 'Deli counter + sale by weight' },
        { icon: Hammer, name: 'Hardware', detail: 'Formal estimates' },
        { icon: BookOpen, name: 'Stationery', detail: 'School-supply packs' },
        { icon: Shirt, name: 'Boutique', detail: 'Variants (size, color)' },
        { icon: Boxes, name: 'Other', detail: 'Customizable' },
      ],
      planLabel: 'Recommended: Pro PLUS · from RD$4,490/mo',
    },
    restaurantes: {
      title: 'For Restaurants',
      blurb: 'KDS, tables, tips, printer routing — service-ready.',
      bullets: [
        'KDS with active tickets',
        'Table management with open tab',
        'SplitBill per item or per person',
        'MenuBuilder with modifiers',
        'Configurable tips',
        'E43 expense receipt',
        'Restaurant reports (turnover, table, hour)',
        'Multi-printer routing (kitchen/bar/cashier)',
      ],
      planLabel: 'Recommended: Pro PLUS · from RD$4,490/mo',
    },
    servicios: {
      title: 'For Services',
      blurb: 'Mechanics, salons, dealerships, pawn shops.',
      bullets: [
        'Mechanics: WorkOrders → ticket bridge, ServiceBays, vehicle history',
        'Salons: Appointments + Stylist schedules',
        'Dealerships: DealBuilder + E31 routing ≥250K',
        'Pawn: Loans + Collections + PawnItems',
        'Vehicle inventory for dealerships',
        'Sales pipeline + test drives',
        'Financing calculator',
        'Formal receipts with depreciation',
      ],
      planLabel: 'Recommended: Pro PLUS · from RD$4,490/mo',
    },
    empresas: {
      title: 'For Businesses with Employees',
      blurb: 'Payroll TSS/INFOTEP/ISR DR-2026 + Law 16-92.',
      bullets: [
        '1-click biweekly + monthly bulk runs',
        'Auto TSS (SFS + AFP, 2026 caps)',
        'Auto INFOTEP 1%',
        'Progressive ISR (2026 DGII brackets)',
        'Reports ready for TSS + DGII portal',
        'Formal pay stubs',
        'Law 16-92 severance with accrued liability',
        'Auto salary change log',
        'Multi-location + ticket locks',
        'Real-time remote dashboard',
      ],
      planLabel: 'Recommended: Pro MAX · from RD$6,990/mo',
    },
  },
}

// Vertical → screenshot file. Captured via scripts/capture-demo-screenshots.mjs.
const SCREENSHOTS = {
  facturacion:  '/screenshots/facturacion.png',
  carwash:      '/screenshots/carwash.png',
  tiendas:      '/screenshots/tiendas.png',
  restaurantes: '/screenshots/restaurantes.png',
  servicios:    '/screenshots/servicios.png',
  empresas:     '/screenshots/empresas.png',
}

function PreviewShot({ vertical, alt }) {
  const src = SCREENSHOTS[vertical]
  if (!src) return null
  return (
    <img
      src={src}
      alt={alt}
      width={1280}
      height={720}
      loading="lazy"
      decoding="async"
      className="w-full h-auto rounded-2xl"
    />
  )
}

// Legacy SVG fallback — kept commented in case WebP/PNG loading breaks.
// function PreviewSvg({ vertical }) {
//   return (
//     <svg viewBox="0 0 400 280" className="w-full h-auto rounded-2xl">
//       <rect width="400" height="280" rx="14" fill="#0a0a0a" />
//       <rect x="14" y="14" width="372" height="32" rx="6" fill="#fff" opacity="0.06" />
//       <rect x="22" y="24" width="120" height="12" rx="3" fill="#b3001e" />
//       <rect x="14" y="56" width="120" height="210" rx="6" fill="#fff" opacity="0.04" />
//       <rect x="146" y="56" width="240" height="120" rx="6" fill="#fff" opacity="0.05" />
//       <rect x="146" y="186" width="116" height="80" rx="6" fill="#b3001e" opacity="0.85" />
//       <rect x="270" y="186" width="116" height="80" rx="6" fill="#fff" opacity="0.05" />
//       <text x="200" y="270" fontSize="9" fill="#fff" opacity="0.3" textAnchor="middle" fontFamily="monospace">{vertical.toUpperCase()}</text>
//     </svg>
//   )
// }

function SubtypeCard({ icon: Icon, name, detail }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      onClick={() => setOpen(!open)}
      className="w-full text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-4 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon size={18} className="text-[#b3001e]" />
          <span className="font-bold text-sm text-white">{name}</span>
        </div>
        {open ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
      </div>
      {open && <p className="mt-3 text-xs text-white/60 leading-relaxed">{detail}</p>}
    </button>
  )
}

export default function VerticalFeatures({ lang = 'es' }) {
  const [active, setActive] = useState('facturacion')
  const tabs = TABS[lang] || TABS.es
  const verticals = VERTICALS[lang] || VERTICALS.es
  const data = verticals[active]
  const tabBarRef = useRef(null)

  function scrollToPlan(anchor) {
    const target = document.getElementById(`plan-${anchor}`) || document.getElementById('pricing')
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const sectionTitle = lang === 'es' ? 'Construido para tu vertical' : 'Built for your vertical'
  const eyebrow = lang === 'es' ? 'POR INDUSTRIA' : 'BY INDUSTRY'

  return (
    <section id="vertical-features" className="bg-white py-20 md:py-28 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-10 md:mb-12">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{eyebrow}</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-black">{sectionTitle}</h2>
        </div>

        {/* Sticky tab bar */}
        <div ref={tabBarRef} className="sticky top-[120px] z-30 -mx-4 sm:mx-0 mb-10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 border-y border-black/5">
          <div className="flex overflow-x-auto no-scrollbar gap-1 px-4 sm:px-2 py-3">
            {tabs.map(tab => {
              const Icon = tab.icon
              const isActive = tab.key === active
              return (
                <button
                  key={tab.key}
                  onClick={() => setActive(tab.key)}
                  className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-[#b3001e] text-white shadow-lg shadow-[#b3001e]/25'
                      : 'bg-black/5 text-black/70 hover:bg-black/10'
                  }`}
                >
                  <Icon size={15} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Panel */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16 items-start">
          <div>
            <h3 className="text-2xl sm:text-3xl font-black text-black tracking-tight">{data.title}</h3>
            <p className="mt-3 text-black/60 text-base leading-relaxed">{data.blurb}</p>
            <ul className="mt-6 space-y-3">
              {data.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[#b3001e]/10 flex items-center justify-center">
                    <Check size={12} className="text-[#b3001e]" />
                  </div>
                  <span className="text-sm text-black/80 leading-snug">{b}</span>
                </li>
              ))}
            </ul>

            {data.subtypes && (
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.subtypes.map((s, i) => (
                  <div key={i} className="rounded-xl border border-black/10 bg-black/[0.02] hover:bg-black/[0.04] p-4 transition-colors">
                    <div className="flex items-center gap-3">
                      <s.icon size={18} className="text-[#b3001e]" />
                      <span className="font-bold text-sm text-black">{s.name}</span>
                    </div>
                    <p className="mt-2 text-xs text-black/60 leading-relaxed">{s.detail}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
              <button
                onClick={() => scrollToPlan(tabs.find(t => t.key === active)?.planAnchor)}
                className="group inline-flex items-center gap-2 bg-black hover:bg-[#b3001e] text-white font-bold px-6 py-3 rounded-xl transition-colors"
              >
                {lang === 'es' ? 'Ver plan recomendado' : 'See recommended plan'}
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
              <span className="text-xs font-semibold text-black/50">{data.planLabel}</span>
            </div>
          </div>

          <div className="rounded-2xl bg-black p-3 shadow-2xl shadow-black/10 sticky md:top-[200px]">
            <PreviewShot vertical={active} alt={data.title} />
          </div>
        </div>
      </div>
    </section>
  )
}
