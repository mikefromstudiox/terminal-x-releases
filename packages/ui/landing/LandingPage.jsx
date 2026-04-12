import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Monitor, Shield, Zap, BarChart3, Receipt, Users, ArrowRight, Check, X, Wifi, WifiOff, Printer, MessageSquare, ChevronDown, ChevronUp, Clock, CreditCard, FileText, Lock, Smartphone, Star, TrendingUp, Headphones, Menu, ExternalLink, Globe, Banknote, Calculator, Crown } from 'lucide-react'
import logoImg from '../assets/logo.webp'

function useBrowserLang() {
  const [lang, setLang] = useState(() => {
    const stored = localStorage.getItem('tx_landing_lang')
    if (stored === 'en' || stored === 'es') return stored
    return navigator.language?.startsWith('en') ? 'en' : 'es'
  })
  function toggle() {
    const next = lang === 'es' ? 'en' : 'es'
    localStorage.setItem('tx_landing_lang', next)
    setLang(next)
  }
  return { lang, toggle }
}

const PLANS = {
  es: [
    {
      name: 'Pro', key: 'pro', price: 'RD$2,490', annual: 'RD$2,117/mes facturado anual (15% OFF)',
      sub: '/mes', desc: 'Ideal para negocios pequenos', users: '2 usuarios',
      features: ['POS completo + cobrar + imprimir', 'Directorio de clientes', 'NCF B01/B02 (papel)', 'Certificado digital Viafirma INCLUIDO (valor RD$2,360/ano)', 'Reportes diario y mensual', 'Cuadre de Caja + Caja Chica', 'Actualizaciones automaticas'],
      support: 'Autoservicio — tu configuras todo', cta: 'Comenzar con Pro', highlight: false,
    },
    {
      name: 'Pro PLUS', key: 'pro_plus', price: 'RD$4,490', annual: 'RD$3,817/mes facturado anual (15% OFF)',
      sub: '/mes', badge: 'Mas popular', desc: 'Para negocios que quieren crecer', users: '5 usuarios',
      features: ['Todo en Pro, mas:', 'Creditos + Notas de Credito', 'Inventario con alertas de stock', 'Comisiones por empleado/vendedor/cajera', 'e-CF DIRECTO A DGII — sin PSFE, sin costo por comprobante', 'Certificado digital Viafirma INCLUIDO (valor RD$2,360/ano)', 'Reportes avanzados + Nomina Ley 16-92', 'Soporte WhatsApp horario laboral', 'Configuracion remota por nuestro equipo'],
      support: 'Nuestro equipo te configura todo remoto', cta: 'Comenzar con Pro PLUS', highlight: true,
    },
    {
      name: 'Pro MAX', key: 'pro_max', price: 'RD$6,990', annual: 'RD$5,942/mes facturado anual (15% OFF)',
      sub: '/mes', desc: 'Para cadenas y alto volumen', users: 'Usuarios ilimitados',
      features: [
        'Todo en Pro PLUS, mas:',
        'Certificado digital Viafirma INCLUIDO',
        'Nomina in-house: pagos quincenales y mensuales masivos',
        'TSS + INFOTEP automatico (topes 2026)',
        'ISR progresivo automatico (escalas DGII 2026)',
        'Reportes fiscales para el portal DGII (TSS, ISR, 606)',
        'Recibos de pago formales + liquidaciones acumuladas',
        'Log automatico de cambios de salario',
        'Recibos por WhatsApp automatico',
        'Dashboard Remoto en tiempo real',
        'Cuenta dedicada con tu ejecutivo',
        'Visita tecnica mensual a tu negocio',
        'Onboarding el mismo dia',
        'Soporte WhatsApp prioritario',
      ],
      support: 'Soporte prioritario + ejecutivo dedicado', cta: 'Comenzar con Pro MAX', highlight: false,
    },
  ],
  en: [
    {
      name: 'Pro', key: 'pro', price: 'RD$2,490', annual: 'RD$2,117/mo billed annually (15% OFF)',
      sub: '/mo', desc: 'Ideal for small businesses', users: '2 users',
      features: ['Full POS + charge + print', 'Client directory', 'NCF B01/B02 (paper)', 'Viafirma digital certificate INCLUDED (RD$2,360/yr value)', 'Daily and monthly reports', 'Cash Recon + Petty Cash', 'Automatic updates'],
      support: 'Self-service — you configure everything', cta: 'Start with Pro', highlight: false,
    },
    {
      name: 'Pro PLUS', key: 'pro_plus', price: 'RD$4,490', annual: 'RD$3,817/mo billed annually (15% OFF)',
      sub: '/mo', badge: 'Most popular', desc: 'For growing businesses', users: '5 users',
      features: ['Everything in Pro, plus:', 'Credits + Credit Notes', 'Inventory with stock alerts', 'Commissions per employee/seller/cashier', 'e-CF DIRECT TO DGII — no PSFE, no per-invoice fees', 'Viafirma digital certificate INCLUDED (RD$2,360/yr value)', 'Advanced reports + Payroll Law 16-92', 'WhatsApp support business hours', 'Remote config by our team'],
      support: 'Our team configures everything remotely', cta: 'Start with Pro PLUS', highlight: true,
    },
    {
      name: 'Pro MAX', key: 'pro_max', price: 'RD$6,990', annual: 'RD$5,942/mo billed annually (15% OFF)',
      sub: '/mo', desc: 'For chains and high volume', users: 'Unlimited users',
      features: [
        'Everything in Pro PLUS, plus:',
        'Viafirma digital certificate INCLUDED',
        'In-house payroll: bulk biweekly + monthly runs',
        'Auto TSS + INFOTEP (2026 caps)',
        'Auto progressive ISR (2026 DGII brackets)',
        'Tax reports for DGII portal (TSS, ISR, 606)',
        'Formal paycheck stubs + accrued severance',
        'Automatic salary change log',
        'WhatsApp receipts automatic',
        'Remote Dashboard real-time',
        'Dedicated account executive',
        'Monthly on-site tech visit',
        'Same-day onboarding',
        'Priority WhatsApp support',
      ],
      support: 'Priority support + dedicated executive', cta: 'Start with Pro MAX', highlight: false,
    },
  ],
}

const FEATURES = {
  es: [
    { icon: Receipt, title: 'e-CF Directo con DGII', desc: <span>Emisor Electronico certificado (Solicitud #42483). Firma digital RSA-SHA256 con certificado X.509 de Viafirma. Codigo de seguridad y QR verificable en cada comprobante.<br /><strong className="text-[#b3001e]">Sin PSFE &bull; Sin costo por factura</strong></span> },
    { icon: Monitor, title: 'Desktop + Web + Movil', desc: 'App nativa para Windows, web PWA para cualquier navegador y celular. Una sola cuenta, todas las plataformas.' },
    { icon: WifiOff, title: '100% Offline', desc: 'Funciona sin internet. Cola inteligente con reintento automatico 72 horas. Se sincroniza cuando vuelve la conexion.' },
    { icon: BarChart3, title: 'Nomina in-house (Pro MAX)', desc: 'Despidete del contador externo. Pagos quincenales/mensuales masivos, TSS + INFOTEP + ISR progresivo automatico (topes 2026), reportes para el portal DGII, recibos formales y log de cambios de salario.' },
    { icon: Shield, title: 'DGII Integrado', desc: 'Reportes 606, 607. RNC lookup automatico con 900,000+ registros. NCF B01/B02 + todos los e-CF.' },
    { icon: Users, title: 'Multi-usuario + Roles', desc: '5 niveles de acceso: dueno, gerente, CFO, contador, cajero. Cada rol ve solo lo que necesita.' },
    { icon: Printer, title: 'Impresion Termica', desc: 'Impresora 80mm con cajon de dinero integrado. Facturas con NCF/e-CF, QR code, conduce de servicio.' },
    { icon: Headphones, title: 'Soporte Humano', desc: 'Nuestro equipo configura tu sistema remotamente. No tienes que ser experto en tecnologia.' },
    { icon: CreditCard, title: 'Creditos + Cobros', desc: 'Clientes a credito, pagos parciales, notas de credito. Control total de cuentas por cobrar.' },
    { icon: Star, title: 'Certificacion DGII como Servicio', desc: 'Quieres ser Emisor Electronico directo tu tambien? Nosotros te guiamos y hacemos todo el proceso completo. Precio especial para clientes Terminal X.', cta: true },
  ],
  en: [
    { icon: Receipt, title: 'Direct e-CF with DGII', desc: <span>Certified Electronic Issuer (Application #42483). RSA-SHA256 digital signature with Viafirma X.509 certificate. Security code and verifiable QR on every invoice.<br /><strong className="text-[#b3001e]">No PSFE &bull; No per-invoice cost</strong></span> },
    { icon: Monitor, title: 'Desktop + Web + Mobile', desc: 'Native Windows app, web PWA for any browser and phone. One account, all platforms.' },
    { icon: WifiOff, title: '100% Offline', desc: 'Works without internet. Smart queue with auto-retry for 72 hours. Syncs when connection returns.' },
    { icon: BarChart3, title: 'In-house Payroll (Pro MAX)', desc: 'Say goodbye to your external accountant. Biweekly/monthly bulk runs, auto TSS + INFOTEP + progressive ISR (2026 caps), DGII portal reports, formal pay stubs and salary change log.' },
    { icon: Shield, title: 'DGII Integrated', desc: 'Reports 606, 607. Auto RNC lookup with 900,000+ records. NCF B01/B02 + all e-CF types.' },
    { icon: Users, title: 'Multi-user + Roles', desc: '5 access levels: owner, manager, CFO, accountant, cashier. Each role sees only what they need.' },
    { icon: Printer, title: 'Thermal Printing', desc: '80mm printer with built-in cash drawer. Invoices with NCF/e-CF, QR code, service dispatch.' },
    { icon: Headphones, title: 'Human Support', desc: 'Our team configures your system remotely. You don\'t have to be a tech expert.' },
    { icon: CreditCard, title: 'Credits + Collections', desc: 'Credit clients, partial payments, credit notes. Full control of accounts receivable.' },
    { icon: Star, title: 'DGII Certification as a Service', desc: 'Want to become a direct Electronic Issuer too? We guide you and handle the entire process. Special pricing for Terminal X clients.', cta: true },
  ],
}

const COMPARISON = {
  es: [
    { feature: 'Certificado digital Viafirma incluido', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Facturacion directa DGII (sin intermediario)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Emisor Electronico propio (sin PSFE)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Todos los 10 tipos de e-CF + RFCE', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'QR code en facturas electronicas', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Modo offline real (72 horas)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'App Desktop nativa + Web/PWA', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Cola de servicio en tiempo real', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Nomina in-house completa (Pro MAX)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Pagos de nomina quincenales + mensuales masivos', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'TSS + INFOTEP + ISR automatico (topes DGII 2026)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Reportes TSS/ISR listos para el portal DGII', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Liquidacion Ley 16-92 + pasivo acumulado', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Comisiones por empleado/vendedor/cajero', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Impresora termica + cajon', tx: true, alegra: true, wil: true, otros: false },
    { feature: 'Configuracion remota por nuestro equipo', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Visitas tecnicas a tu negocio', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Actualizaciones automaticas', tx: true, alegra: true, wil: false, otros: false },
    { feature: 'Precio menor a RD$5,000/mes', tx: true, alegra: false, wil: true, otros: true },
  ],
  en: [
    { feature: 'Viafirma digital certificate included', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Direct DGII invoicing (no middleman)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Own Electronic Issuer (no PSFE)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'All 10 e-CF types + RFCE', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'QR code on electronic invoices', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Real offline mode (72 hours)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Native Desktop app + Web/PWA', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Real-time service queue', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Full in-house payroll (Pro MAX)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Bulk biweekly + monthly payroll runs', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Auto TSS + INFOTEP + ISR (2026 DGII caps)', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'TSS/ISR reports ready for DGII portal', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Law 16-92 severance + accrued liability', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Commissions per employee/seller/cashier', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Thermal printer + cash drawer', tx: true, alegra: true, wil: true, otros: false },
    { feature: 'Remote config by our team', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'On-site tech visits', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Automatic updates', tx: true, alegra: true, wil: false, otros: false },
    { feature: 'Price under RD$5,000/mo', tx: true, alegra: false, wil: true, otros: true },
  ],
}

const FAQ = {
  es: [
    { q: 'Puedo cambiar de plan en cualquier momento?', a: 'Si, puedes subir o bajar de plan en cualquier momento desde el panel de administracion. El cambio se aplica inmediatamente.' },
    { q: 'Hay contrato anual obligatorio?', a: 'No. Puedes pagar mes a mes sin compromiso. El plan anual tiene 15% de descuento pero no es obligatorio.' },
    { q: 'Que pasa si me quedo sin internet?', a: 'Todo sigue funcionando 100% offline. Puedes cobrar, imprimir facturas, ver reportes. Se sincroniza automaticamente cuando vuelve la conexion (hasta 72 horas de cola).' },
    { q: 'Necesito comprar impresora especial?', a: 'Terminal X funciona con cualquier impresora termica de 80mm con conexion USB. Nosotros podemos recomendarte e instalarte la impresora y el cajon de dinero.' },
    { q: 'Que es e-CF y por que lo necesito?', a: 'e-CF (Comprobante Fiscal Electronico) es el nuevo formato obligatorio de la DGII bajo la Ley 32-23. Todos los negocios deben migrar antes de mayo 2026. Terminal X es el unico POS que se conecta directo a la DGII, sin intermediarios ni costos adicionales.' },
    { q: 'Funciona para mi tipo de negocio?', a: 'Si. Terminal X tiene modo Car Wash (cola de servicios, lavadores, comisiones), modo Tienda/Retail (inventario con codigo de barras, carrito con cantidades, stock automatico), y modo Servicios (talleres, salones, barber shops). El sistema se adapta automaticamente.' },
    { q: 'Como funciona el soporte?', a: 'Pro: autoservicio con guias. Pro PLUS: nuestro equipo te configura todo remotamente y soporte por WhatsApp en horario laboral. Pro MAX: ejecutivo dedicado + soporte prioritario + visita tecnica mensual.' },
    { q: 'Puedo manejar la nomina sin contratar un contador externo?', a: 'Si, y es una de las ventajas mas grandes de Pro MAX. Terminal X incluye nomina in-house completa: pagos quincenales o mensuales masivos en un click, calculo automatico de TSS (SFS + AFP con topes oficiales 2026), INFOTEP 1%, ISR progresivo (escalas DGII 2026), reportes listos para subir al portal TSS y DGII, recibos formales de pago, y log automatico de cambios de salario. Un contador externo en RD cobra entre RD$8,000 y RD$15,000/mes solo por esto — Pro MAX lo incluye por RD$6,990/mes.' },
    { q: 'Puedo importar datos de mi sistema anterior?', a: 'Si. Nuestro equipo puede importar tu historial de ventas, clientes y productos desde Starsisa, WilPOS u otros sistemas.' },
    { q: 'Que pasa si mi proveedor de facturacion electronica (PSFE) se cae?', a: 'Nada — porque no usamos uno. Terminal X es Emisor Electronico directo ante DGII. No dependemos de ef2.do, Indexa, ni ningun otro PSFE. Tu sistema firma y transmite los e-CF directamente al portal de DGII. Si un PSFE se cae, tus competidores dejan de facturar. Tu no.' },
  ],
  en: [
    { q: 'Can I change plans anytime?', a: 'Yes, you can upgrade or downgrade at any time from the admin panel. Changes apply immediately.' },
    { q: 'Is there a mandatory annual contract?', a: 'No. You can pay month-to-month with no commitment. The annual plan has a 15% discount but is not required.' },
    { q: 'What happens if I lose internet?', a: 'Everything keeps working 100% offline. You can charge, print invoices, view reports. It syncs automatically when connection returns (up to 72 hours queued).' },
    { q: 'Do I need a special printer?', a: 'Terminal X works with any 80mm thermal printer with USB connection. We can recommend and install the printer and cash drawer for you.' },
    { q: 'What is e-CF and why do I need it?', a: 'e-CF (Electronic Fiscal Receipt) is the new mandatory DGII format under Law 32-23. All businesses must migrate before May 2026. Terminal X is the only POS that connects directly to DGII, with no middlemen or additional costs.' },
    { q: 'Does it work for my type of business?', a: 'Yes. Terminal X works for any service business in DR: Car Wash, auto shops, barber shops, dealers, stores, colmados, and more. The system adapts to your services and products.' },
    { q: 'How does support work?', a: 'Pro: self-service with guides. Pro PLUS: our team configures everything remotely + WhatsApp support during business hours. Pro MAX: dedicated executive + priority support + monthly on-site visit.' },
    { q: 'Can I run payroll without hiring an external accountant?', a: 'Yes — this is one of the biggest Pro MAX advantages. Terminal X includes full in-house payroll: biweekly or monthly bulk runs in one click, auto TSS (SFS + AFP with official 2026 caps), INFOTEP 1%, progressive ISR (2026 DGII brackets), reports ready for the TSS and DGII portals, formal pay stubs, and automatic salary change logs. An external accountant in DR charges RD$8,000–15,000/month for this alone — Pro MAX includes it for RD$6,990/month.' },
    { q: 'Can I import data from my previous system?', a: 'Yes. Our team can import your sales history, clients, and products from Starsisa, WilPOS, or other systems.' },
    { q: 'What happens if my e-invoicing provider (PSFE) goes down?', a: 'Nothing — because we don\'t use one. Terminal X is a direct Electronic Issuer with DGII. We don\'t depend on ef2.do, Indexa, or any other PSFE. Your system signs and transmits e-CFs directly to DGII\'s portal. If a PSFE goes down, your competitors stop invoicing. You don\'t.' },
  ],
}

const STATS = {
  es: [
    { value: '10', label: 'tipos de e-CF' },
    { value: '900K+', label: 'RNCs integrados' },
    { value: '72h', label: 'modo offline' },
    { value: '100%', label: 'Ley 32-23' },
    { value: '0', label: 'intermediarios' },
  ],
  en: [
    { value: '10', label: 'e-CF types' },
    { value: '900K+', label: 'RNCs integrated' },
    { value: '72h', label: 'offline mode' },
    { value: '100%', label: 'Law 32-23' },
    { value: '0', label: 'middlemen' },
  ],
}

const ECOSYSTEM = [
  { name: 'STUDIO', url: 'https://studioxrd.com', es: 'Hub corporativo', en: 'Corporate hub' },
  { name: 'TECH', url: 'https://studioxrdtech.com', es: 'Computadoras, camaras, IT', en: 'Computers, cameras, IT' },
  { name: 'MEDIA', url: 'https://studioxmedia.io', es: 'Redes sociales, contenido, software', en: 'Social media, content, software' },
  { name: 'CONTENT', url: 'https://studioxmedia.io/contentx', es: 'Produccion de contenido', en: 'Content production' },
  { name: 'DETAILING', url: 'https://studioxdetailing.com', es: 'Car wash, detailing, tints', en: 'Car wash, detailing, tints' },
]

function CheckIcon() { return <Check size={16} className="text-[#b3001e] mx-auto" /> }
function XIcon() { return <X size={16} className="text-white/20 mx-auto" /> }
function XIconLight() { return <X size={16} className="text-gray-300 mx-auto" /> }

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-6 py-5 text-left">
        <span className="font-bold text-[15px] text-black pr-4">{q}</span>
        {open ? <ChevronUp size={18} className="text-gray-500 shrink-0" /> : <ChevronDown size={18} className="text-gray-500 shrink-0" />}
      </button>
      {open && <p className="px-6 pb-5 text-sm text-gray-500 leading-relaxed">{a}</p>}
    </div>
  )
}

export default function LandingPage({ section }) {
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { lang, toggle: toggleLang } = useBrowserLang()
  const L = (es, en) => lang === 'es' ? es : en

  const navLinks = [
    { label: L('Funciones', 'Features'), href: '#features' },
    { label: L('Planes', 'Plans'), href: '#pricing' },
    { label: L('Comparar', 'Compare'), href: '#compare' },
    { label: 'FAQ', href: '#faq' },
  ]

  return (
    <div className="min-h-screen bg-white">
      {/* Header — sticky black, h-[120px] */}
      <nav className="h-[120px] bg-black sticky top-0 z-50 border-b border-white/10">
        <div className="max-w-7xl mx-auto h-full flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-0">
            <span className="text-2xl font-black tracking-[3px] text-white leading-none -mt-1">TERMINAL</span>
            <img src={logoImg} alt="X" width="48" height="48" className="h-9 w-auto object-contain" draggable="false" />
          </div>
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map(link => (
              <a key={link.href} href={link.href} className="text-sm font-medium text-white/70 hover:text-[#b3001e] transition-colors">{link.label}</a>
            ))}
            <button onClick={toggleLang} className="flex items-center gap-1.5 text-sm font-medium text-white/50 hover:text-white transition-colors">
              <Globe size={14} /> {lang === 'es' ? 'EN' : 'ES'}
            </button>
            <button onClick={() => navigate('/pos')} className="bg-[#b3001e] hover:bg-[#d4002a] rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors shadow-lg shadow-red-500/25">
              {L('Iniciar Sesion', 'Log In')}
            </button>
          </div>
          <div className="md:hidden flex items-center gap-2">
            <button onClick={toggleLang} className="text-white/50 hover:text-white text-xs font-bold">{lang === 'es' ? 'EN' : 'ES'}</button>
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu" className="text-white/70 hover:text-white">
              <Menu size={24} />
            </button>
          </div>
        </div>
        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-black border-t border-white/10 px-4 pb-4">
            {navLinks.map(link => (
              <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className="block py-3 text-sm font-medium text-white/70 hover:text-[#b3001e] transition-colors">{link.label}</a>
            ))}
            <button onClick={() => { setMobileMenuOpen(false); navigate('/pos') }} className="mt-2 w-full bg-[#b3001e] hover:bg-[#d4002a] rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors">
              {L('Iniciar Sesion', 'Log In')}
            </button>
          </div>
        )}
      </nav>

      {/* SECTION 1: Hero — WHITE */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Emisor Electronico Certificado DGII', 'Certified DGII Electronic Issuer')}</p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">
            {L(<>El unico POS en RD certificado como <span className="text-[#b3001e]">Emisor Electronico directo</span> ante DGII</>, <>The only POS in DR certified as a <span className="text-[#b3001e]">direct Electronic Issuer</span> with DGII</>)}
          </h1>
          <p className="mt-4 text-lg text-gray-500 max-w-2xl mx-auto">
            {L('Facturacion electronica directa a DGII — sin intermediarios, sin PSFE, sin costo por comprobante. Desktop + Web + Movil. Modo offline. Configuracion remota por nuestro equipo.', 'Direct electronic invoicing to DGII — no middlemen, no PSFE, no per-invoice fees. Desktop + Web + Mobile. Offline mode. Remote setup by our team.')}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {L('Car Wash, tiendas, retail, talleres, barber shops, dealers — cualquier negocio en RD. Inventario con codigo de barras, POS con cantidades, stock automatico. Cumple la Ley 32-23.', 'Car Wash, stores, retail, workshops, barber shops, dealers — any business in DR. Inventory with barcode, POS with quantities, auto stock. Meet Ley 32-23.')}
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap mt-10">
            <button onClick={() => navigate('/signup?plan=pro_plus')}
              className="bg-[#b3001e] hover:bg-[#d4002a] px-6 py-3 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-red-500/25">
              {L('Empezar ahora', 'Start now')} <ArrowRight size={16} className="inline ml-1" />
            </button>
            <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20informacion%20sobre%20Terminal%20X" target="_blank" rel="noopener noreferrer"
              className="border border-gray-300 text-gray-700 hover:border-gray-400 hover:shadow-lg px-6 py-3 text-sm font-bold rounded-lg transition-all">
              {L('Hablar con ventas', 'Talk to sales')}
            </a>
            <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20ver%20un%20demo%20de%20Terminal%20X" target="_blank" rel="noopener noreferrer"
              className="border border-gray-300 text-gray-700 hover:border-gray-400 hover:shadow-lg px-6 py-3 text-sm font-bold rounded-lg transition-all flex items-center gap-2">
              <Smartphone size={16} />
              {L('Ver demo', 'See demo')}
            </a>
          </div>
          {/* Certification badge */}
          <div className="mt-8 flex items-center justify-center">
            <div className="flex items-center gap-2 px-6 py-3 rounded-2xl border border-[#b3001e] bg-[#b3001e]/10 text-sm font-bold uppercase tracking-widest text-black">
              <Shield className="w-5 h-5 text-[#b3001e]" />
              <span>{L('Emisor Electronico Certificado DGII — Solicitud #42483', 'Certified Electronic Issuer DGII — Application #42483')}</span>
            </div>
          </div>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6 max-w-3xl mx-auto mt-16">
            {STATS[lang].map((s, i) => (
              <div key={i} className="text-center">
                <p className="text-3xl sm:text-4xl font-extrabold text-[#b3001e]">{s.value}</p>
                <p className="text-sm text-gray-500 font-medium mt-1">{s.label}</p>
              </div>
            ))}
          </div>
          {/* Trust bar */}
          <p className="mt-10 text-xs text-gray-500 tracking-wide text-center">
            {L(
              'Certificado digital Viafirma \u00B7 Solicitud DGII #42483 \u00B7 RNC 133410321 \u00B7 Santo Domingo, RD',
              'Viafirma digital certificate \u00B7 DGII Application #42483 \u00B7 RNC 133410321 \u00B7 Santo Domingo, DR'
            )}
          </p>
        </div>
      </section>

      {/* SECTION 2: How it works — BLACK */}
      <section className="bg-black px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Rapido y facil', 'Fast and easy')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">{L('Como funciona', 'How it works')}</h2>
            <p className="mt-4 text-lg text-white/50">{L('En 3 pasos estas operando', 'Up and running in 3 steps')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto mt-16">
            {[
              { step: '1', title: L('Registrate', 'Sign up'), desc: L('Crea tu cuenta en 2 minutos. Sin tarjeta de credito. Sin compromiso.', 'Create your account in 2 minutes. No credit card. No commitment.') },
              { step: '2', title: L('Nosotros configuramos', 'We configure'), desc: L('Nuestro equipo configura tu negocio, servicios, impresora y facturacion remotamente.', 'Our team configures your business, services, printer and invoicing remotely.') },
              { step: '3', title: L('Empieza a cobrar', 'Start charging'), desc: L('Crea tickets, cobra, imprime facturas con NCF/e-CF y ve tus reportes al instante.', 'Create tickets, charge, print invoices with NCF/e-CF and view your reports instantly.') },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="w-14 h-14 bg-[#b3001e] text-white text-2xl font-black rounded-2xl flex items-center justify-center mx-auto mb-5">
                  {s.step}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{s.title}</h3>
                <p className="text-sm text-white/50">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 3: Features — WHITE */}
      <section id="features" className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Funciones', 'Features')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">{L('Todo lo que necesitas en un solo sistema', 'Everything you need in one system')}</h2>
            <p className="mt-4 text-lg text-gray-500 max-w-2xl mx-auto">{L('Terminal X es el unico sistema de punto de venta en Republica Dominicana que combina facturacion electronica e-CF directa con DGII, inventario con codigo de barras, modo offline 100% y herramientas completas para car wash, tiendas y negocios de servicios.', 'Terminal X is the only POS system in the Dominican Republic that combines direct e-CF electronic invoicing with DGII, barcode inventory, 100% offline mode, and complete tools for car washes, stores, and service businesses.')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            {FEATURES[lang].map((f, i) => (
              <div key={i} className={`rounded-2xl border p-8 transition-all hover:-translate-y-2 hover:shadow-2xl ${f.cta ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-gray-100 bg-gray-50'}`}>
                <div className="w-12 h-12 bg-[#b3001e]/10 rounded-xl flex items-center justify-center mb-5">
                  <f.icon size={22} className="text-[#b3001e]" />
                </div>
                <h3 className="text-base font-bold text-black mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.desc}</p>
                {f.cta && (
                  <a href="https://wa.me/18098282971?text=Quiero%20el%20servicio%20de%20certificaci%C3%B3n%20DGII" target="_blank" rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 bg-[#b3001e] hover:bg-[#d4002a] px-4 py-2 text-xs font-bold text-white rounded-lg transition-colors">
                    <MessageSquare size={14} />
                    {L('Solicitar certificacion', 'Request certification')}
                  </a>
                )}
              </div>
            ))}
          </div>

          {/* ── Nómina in-house showcase (Pro MAX) — inverted dark card inside white section to preserve WHITE→BLACK alternation ── */}
          <div id="nomina" className="mt-20 scroll-mt-32">
            <div className="rounded-3xl bg-black border border-white/10 p-8 sm:p-12 lg:p-16">
              <div className="text-center">
                <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">
                  {L('Exclusivo Pro MAX', 'Pro MAX Exclusive')}
                </p>
                <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">
                  {L('Maneja tu nómina in-house', 'Run payroll in-house')}
                </h2>
                <p className="mt-4 text-lg text-white/50 max-w-3xl mx-auto">
                  {L(
                    'Despídete del contador externo. Paga a tu equipo en minutos con cálculos automáticos de TSS, INFOTEP e ISR según las tasas oficiales DGII 2026. Reportes listos para el portal TSS, todo desde la misma pantalla donde cobras.',
                    'Say goodbye to the external accountant. Pay your team in minutes with automatic TSS, INFOTEP and ISR calculations per official 2026 DGII rates. Reports ready for the TSS portal, all from the same screen where you charge.'
                  )}
                </p>
              </div>

              {/* Savings stat card */}
              <div className="max-w-4xl mx-auto mt-12">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
                    <div>
                      <p className="text-4xl sm:text-5xl font-extrabold text-white">RD$8–15K</p>
                      <p className="mt-2 text-xs uppercase tracking-wider text-white/50">
                        {L('cobra un contador externo / mes', 'external accountant / mo')}
                      </p>
                    </div>
                    <div className="sm:border-x sm:border-white/10 sm:px-6 pt-6 sm:pt-0 border-t sm:border-t-0 border-white/10">
                      <p className="text-4xl sm:text-5xl font-extrabold text-white">RD$6,990</p>
                      <p className="mt-2 text-xs uppercase tracking-wider text-white/50">
                        {L('Pro MAX incluye TODO esto / mes', 'Pro MAX includes ALL this / mo')}
                      </p>
                    </div>
                    <div className="pt-6 sm:pt-0 border-t sm:border-t-0 border-white/10">
                      <p className="text-4xl sm:text-5xl font-extrabold text-[#b3001e]">50%+</p>
                      <p className="mt-2 text-xs uppercase tracking-wider text-white/50">
                        {L('ahorro vs contador externo', 'savings vs external accountant')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
                {[
                  { icon: Banknote,   title: L('Pagos masivos',          'Bulk runs'),             desc: L('Quincenales o mensuales con un click. Selecciona empleados, confirma, listo.', 'Biweekly or monthly with one click. Select employees, confirm, done.') },
                  { icon: Calculator, title: L('TSS + INFOTEP auto',     'Auto TSS + INFOTEP'),    desc: L('SFS 3.04% + AFP 2.87% empleado. SFS 7.09% + AFP 7.10% + INFOTEP 1% empleador. Topes 2026 aplicados por fondo.', 'SFS 3.04% + AFP 2.87% employee. SFS 7.09% + AFP 7.10% + INFOTEP 1% employer. 2026 caps applied per fund.') },
                  { icon: FileText,   title: L('ISR progresivo',         'Progressive ISR'),       desc: L('Escalas DGII 2026: exento hasta RD$416,220/año, 15%, 20%, 25%. Cálculo marginal por empleado.', 'DGII 2026 brackets: exempt up to RD$416,220/yr, 15%, 20%, 25%. Marginal calculation per employee.') },
                  { icon: BarChart3,  title: L('Reportes para DGII',     'Reports for DGII'),      desc: L('TSS + INFOTEP, ISR con proyección anual, 606 retenciones. PDF con membrete + CSV para el portal.', 'TSS + INFOTEP, ISR with annual projection, 606 withholdings. PDF with letterhead + CSV for portal.') },
                  { icon: Receipt,    title: L('Recibos de pago',        'Pay stubs'),             desc: L('Recibo formal por empleado con desglose completo, cédula, TSS-ID, firma. Impresión masiva disponible.', 'Formal stub per employee with full breakdown, ID, TSS-ID, signature. Bulk print available.') },
                  { icon: Shield,     title: L('Liquidaciones Ley 16-92','Law 16-92 severance'),   desc: L('Vacaciones Art. 177, Navidad Art. 219, Preaviso Art. 76, Cesantía Art. 80. Pasivo laboral acumulado en tiempo real.', 'Vacation Art. 177, Christmas Art. 219, Notice Art. 76, Severance Art. 80. Accrued liability in real-time.') },
                  { icon: Clock,      title: L('Historial completo',     'Full history'),          desc: L('Todos los pagos por empleado con filtro de fechas, búsqueda, y log automático de cambios de salario.', 'Every payment per employee with date filters, search, and automatic salary change log.') },
                  { icon: Users,      title: L('Comisión-only OK',       'Commission-only OK'),    desc: L('Lavadores, vendedores y cajeros sin salario fijo se pagan de sus comisiones automáticamente.', 'Washers, sellers and cashiers with no fixed salary pay from commissions automatically.') },
                  { icon: TrendingUp, title: L('Dashboard visual',       'Visual dashboard'),      desc: L('Nómina mensual total, próximo pago, última actividad, tendencias de comisiones de 6 meses.', 'Monthly payroll total, next payment, recent activity, 6-month commission trends.') },
                ].map((f, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-8 hover:border-white/20 hover:bg-white/10 transition-all">
                    <div className="w-12 h-12 rounded-xl bg-[#b3001e]/20 flex items-center justify-center mb-5">
                      <f.icon size={22} className="text-[#b3001e]" />
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-white/50">{f.desc}</p>
                  </div>
                ))}
              </div>

              {/* CTA row */}
              <div className="mt-12 flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
                  className="inline-flex items-center justify-center gap-2 bg-[#b3001e] hover:bg-[#d4002a] px-6 py-3 text-sm font-bold text-white rounded-lg shadow-lg shadow-red-500/25 transition-colors">
                  <Crown size={16} />
                  {L('Ver plan Pro MAX', 'See Pro MAX plan')}
                  <ArrowRight size={16} />
                </button>
                <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20m%C3%A1s%20info%20sobre%20N%C3%B3mina%20in-house%20en%20Pro%20MAX"
                   target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center justify-center gap-2 border border-white/20 text-white hover:border-white/40 hover:bg-white/5 px-6 py-3 text-sm font-bold rounded-lg transition-colors">
                  <MessageSquare size={16} />
                  {L('Hablar con un experto', 'Talk to an expert')}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3.5: Multi-Business Type — WHITE */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Multi-Negocio', 'Multi-Business')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">
              {L('Un sistema, cualquier tipo de negocio', 'One system, any business type')}
            </h2>
            <p className="mt-4 text-lg text-gray-500 max-w-2xl mx-auto">
              {L(
                'Terminal X se adapta automaticamente a tu tipo de negocio. Car wash, tienda, retail, taller, salon — el mismo sistema con la interfaz perfecta para cada uno.',
                'Terminal X automatically adapts to your business type. Car wash, store, retail, workshop, salon — the same system with the perfect interface for each.'
              )}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            {[
              {
                title: L('Car Wash / Detailing', 'Car Wash / Detailing'),
                desc: L('Cola de servicios, asignacion de lavadores, comisiones automaticas, placa de vehiculo, conduce impreso.', 'Service queue, washer assignment, automatic commissions, vehicle plate, printed conduce.'),
                items: [L('Cola en tiempo real', 'Real-time queue'), L('Comisiones por lavador', 'Washer commissions'), L('Placa + conduce', 'Plate + conduce')],
              },
              {
                title: L('Tienda / Retail', 'Store / Retail'),
                desc: L('Inventario con codigo de barras, busqueda por SKU, carrito con cantidades, deduccion automatica de stock al vender.', 'Inventory with barcode, SKU search, cart with quantities, automatic stock deduction on sale.'),
                items: [L('Codigo de barras / SKU', 'Barcode / SKU'), L('Carrito con cantidades', 'Cart with quantities'), L('Stock automatico', 'Auto stock deduction')],
                highlight: true,
              },
              {
                title: L('Servicios / Otro', 'Services / Other'),
                desc: L('Talleres, salones, barber shops, dealers — cualquier negocio de servicios con facturacion DGII incluida.', 'Workshops, salons, barber shops, dealers — any service business with DGII invoicing included.'),
                items: [L('Servicios + productos', 'Services + products'), L('Creditos a clientes', 'Client credits'), L('Reportes 606/607', '606/607 reports')],
              },
            ].map((biz, i) => (
              <div key={i} className={`rounded-2xl border p-8 transition-all hover:-translate-y-2 hover:shadow-2xl ${biz.highlight ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-gray-100 bg-gray-50'}`}>
                <h3 className="text-lg font-bold text-black mb-2">{biz.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">{biz.desc}</p>
                <ul className="space-y-2">
                  {biz.items.map((item, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm text-black">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#b3001e] shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 3.6: Studio X Car Wash — Live Client — BLACK */}
      <section className="bg-black px-4 py-16 sm:px-6 lg:px-8 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Cliente en produccion real', 'Live production client')}</p>
          <h2 className="mt-3 text-3xl sm:text-4xl font-extrabold text-white">{L('Studio X Car Wash ya factura 100% con Terminal X', 'Studio X Car Wash invoices 100% with Terminal X')}</h2>
          <p className="mt-4 text-lg text-white/50 max-w-2xl mx-auto">
            {L(
              'Car wash en Santo Domingo operando diariamente con e-CF directo a DGII, cola de servicios, caja chica, reportes y cuadre automatico.',
              'Car wash in Santo Domingo operating daily with direct e-CF to DGII, service queue, petty cash, reports and automatic cash reconciliation.'
            )}
          </p>
          <div className="flex justify-center gap-12 mt-10">
            <div className="text-center">
              <div className="text-4xl sm:text-5xl font-extrabold text-[#b3001e]">{L('Directo', 'Direct')}</div>
              <div className="text-white/50 text-sm mt-1">{L('a DGII', 'to DGII')}</div>
            </div>
            <div className="text-center">
              <div className="text-4xl sm:text-5xl font-extrabold text-[#b3001e]">100%</div>
              <div className="text-white/50 text-sm mt-1">Offline</div>
            </div>
            <div className="text-center">
              <div className="text-4xl sm:text-5xl font-extrabold text-[#b3001e]">1</div>
              <div className="text-white/50 text-sm mt-1">{L('Terminal, todo incluido', 'Terminal, all-in-one')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: Pricing — BLACK */}
      <section id="pricing" className="bg-black px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Planes', 'Plans')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">{L('Planes y Precios', 'Plans & Pricing')}</h2>
            <p className="mt-4 text-lg text-white/50">{L('Elige el plan ideal para tu negocio. Sin contrato. Cancela cuando quieras.', 'Choose the ideal plan for your business. No contract. Cancel anytime.')}</p>
            <p className="mt-2 text-sm font-semibold text-[#b3001e]">{L('Todos los planes incluyen certificado digital Viafirma, impresora termica, cajon de dinero y actualizaciones.', 'All plans include Viafirma digital certificate, thermal printer, cash drawer and updates.')}</p>
            <div className="mt-6 inline-flex items-center gap-3 px-5 py-3 rounded-2xl border border-white/10 bg-white/5">
              <p className="text-[13px] text-white/70">{L('Pagas RD$6,000/mes por un sistema sin e-CF? Cambiate hoy.', 'Paying RD$6,000/mo for a system without e-CF? Switch today.')}</p>
              <span className="text-[12px] font-bold text-[#b3001e] whitespace-nowrap">{L('Ahorra 58%', 'Save 58%')}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mt-16">
            {PLANS[lang].map(plan => (
              <div key={plan.key}
                className={`rounded-2xl p-8 border flex flex-col transition-all ${
                  plan.highlight
                    ? 'bg-white/10 border-[#b3001e] ring-2 ring-[#b3001e]/30 relative scale-[1.02] hover:bg-white/15'
                    : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                }`}>
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#b3001e] text-white text-[10px] font-bold rounded-full uppercase tracking-wider whitespace-nowrap">
                    {plan.badge}
                  </div>
                )}
                <h3 className="text-xl font-bold text-white mb-0.5">{plan.name}</h3>
                <p className="text-sm text-white/50 mb-3">{plan.desc}</p>
                <p className="text-3xl font-extrabold text-white mb-0.5">{plan.price}<span className="text-sm font-normal text-white/50">{plan.sub}</span></p>
                <p className="text-xs text-white/50 mb-1">{plan.annual}</p>
                <p className="text-xs font-semibold text-[#b3001e] mb-6">{plan.users}</p>
                <ul className="space-y-3 mb-6 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className={`flex items-start gap-2 text-sm ${f.includes('DGII') && f.includes('DIRECT') ? 'text-white font-bold' : 'text-white/70'}`}>
                      <Check size={14} className="text-[#b3001e] shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                {(plan.key === 'pro_plus' || plan.key === 'pro_max') && (
                  <div className="flex items-center gap-1.5 px-3 py-2 mb-4 rounded-lg border border-[#b3001e]/30 bg-[#b3001e]/10 text-[10px] font-bold uppercase tracking-wider text-[#b3001e]">
                    <Shield size={12} />
                    {L('e-CF Directo DGII — Certificado', 'Direct e-CF DGII — Certified')}
                  </div>
                )}
                <div className={`rounded-lg px-3 py-2 mb-5 text-xs font-semibold ${plan.highlight ? 'bg-[#b3001e]/20 text-[#b3001e]' : 'bg-white/5 text-white/50'}`}>
                  <Headphones size={12} className="inline mr-1.5" />
                  {plan.support}
                </div>
                <button onClick={() => navigate(`/signup?plan=${plan.key}`)}
                  className={`w-full py-3 rounded-lg text-sm font-bold transition-colors ${
                    plan.highlight
                      ? 'bg-[#b3001e] hover:bg-[#d4002a] text-white shadow-lg shadow-red-500/25'
                      : 'border border-white/20 text-white hover:border-white/40 hover:bg-white/5'
                  }`}>
                  {plan.cta} <ArrowRight size={14} className="inline ml-1" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5: Support tiers — WHITE */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Soporte', 'Support')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">{L('Nivel de soporte por plan', 'Support level by plan')}</h2>
            <p className="mt-4 text-lg text-gray-500">{L('No solo vendemos software. Te acompanamos.', 'We don\'t just sell software. We walk with you.')}</p>
          </div>
          <div className="max-w-4xl mx-auto overflow-x-auto mt-12">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-4 font-bold text-black">{L('Soporte', 'Support')}</th>
                  <th className="py-3 px-3 text-center font-bold text-gray-600">Pro</th>
                  <th className="py-3 px-3 text-center font-bold text-[#b3001e]">Pro PLUS</th>
                  <th className="py-3 px-3 text-center font-bold text-gray-600">Pro MAX</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {[
                  { s: L('Configuracion inicial del negocio', 'Initial business setup'), pro: L('Tu mismo', 'Self-service'), plus: L('Nuestro equipo', 'Our team'), max: L('Mismo dia', 'Same day') },
                  { s: L('Acceso admin a tu cuenta (read-only)', 'Admin access to your account (read-only)'), pro: true, plus: true, max: true },
                  { s: L('Configuracion remota por admin', 'Remote config by admin'), pro: false, plus: true, max: true },
                  { s: L('Soporte WhatsApp', 'WhatsApp support'), pro: false, plus: L('Horario laboral', 'Business hours'), max: L('Prioritario', 'Priority') },
                  { s: L('Visitas tecnicas a tu negocio', 'On-site tech visits'), pro: L('Pago extra', 'Extra fee'), plus: L('1 por trimestre', '1 per quarter'), max: L('1 por mes', '1 per month') },
                  { s: L('Ejecutivo de cuenta dedicado', 'Dedicated account executive'), pro: false, plus: false, max: true },
                ].map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="py-3 px-4 font-medium text-black">{row.s}</td>
                    {['pro', 'plus', 'max'].map(col => {
                      const v = row[col]
                      return (
                        <td key={col} className="py-3 px-3 text-center">
                          {v === true ? <Check size={16} className="text-[#b3001e] mx-auto" /> :
                           v === false ? <X size={16} className="text-gray-300 mx-auto" /> :
                           <span className="text-gray-600 font-medium">{v}</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* SECTION 6: Comparison — BLACK */}
      <section id="compare" className="bg-black px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Comparacion', 'Comparison')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white flex items-center justify-center">
              {L('Por que', 'Why')}&nbsp;<span className="font-black tracking-[3px] leading-none">TERMINAL</span><img src={logoImg} alt="X" width="48" height="48" className="h-10 sm:h-12 w-auto object-contain" draggable="false" />?
            </h2>
            <p className="mt-4 text-lg text-white/50">{L('Comparado con Alegra, WilPOS, Facturador y otros sistemas POS en RD.', 'Compared to Alegra, WilPOS, Facturador and other POS systems in DR.')}</p>
          </div>
          <div className="max-w-4xl mx-auto overflow-x-auto mt-12">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-white/20">
                  <th className="text-left py-3 px-4 font-bold text-white">{L('Caracteristica', 'Feature')}</th>
                  <th className="py-3 px-3 font-bold text-[#b3001e] text-center">
                    <span className="flex items-center justify-center gap-0"><span className="text-sm font-black tracking-[2px] leading-none -mt-1">TERMINAL</span><img src={logoImg} alt="X" width="48" height="48" className="h-4 w-auto object-contain" draggable="false" /></span>
                  </th>
                  <th className="py-3 px-3 font-medium text-white/60 text-center">Alegra</th>
                  <th className="py-3 px-3 font-medium text-white/60 text-center">WilPOS</th>
                  <th className="py-3 px-3 font-medium text-white/60 text-center">{L('Otros', 'Others')}</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON[lang].map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white/5' : ''}>
                    <td className="py-3 px-4 text-white/70 font-medium">{row.feature}</td>
                    <td className="py-3 px-3 text-center">{row.tx ? <CheckIcon /> : <XIcon />}</td>
                    <td className="py-3 px-3 text-center">{row.alegra ? <CheckIcon /> : <XIcon />}</td>
                    <td className="py-3 px-3 text-center">{row.wil ? <CheckIcon /> : <XIcon />}</td>
                    <td className="py-3 px-3 text-center">{row.otros ? <CheckIcon /> : <XIcon />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center mt-10 text-sm text-white/50 font-semibold">
            {L('Terminal X: el mas completo, el mas moderno, y el mejor precio del mercado dominicano.', 'Terminal X: the most complete, the most modern, and the best price in the Dominican market.')}
          </p>
        </div>
      </section>

      {/* SECTION 7: FAQ — WHITE */}
      <section id="faq" className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">FAQ</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">{L('Preguntas Frecuentes', 'Frequently Asked Questions')}</h2>
          </div>
          <div className="max-w-2xl mx-auto space-y-3 mt-12">
            {FAQ[lang].map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 8: Ecosystem — BLACK */}
      <section className="bg-black px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Ecosistema', 'Ecosystem')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white flex items-center justify-center">
              {L('Parte de', 'Part of')}&nbsp;<span className="font-black tracking-[3px] leading-none">STUDIO</span><img src={logoImg} alt="X" width="48" height="48" className="h-10 sm:h-12 w-auto object-contain" draggable="false" />
            </h2>
            <p className="mt-4 text-lg text-white/50">{L('Un grupo de empresas interconectadas en Republica Dominicana.', 'A group of interconnected businesses in the Dominican Republic.')}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 max-w-4xl mx-auto mt-12">
            {ECOSYSTEM.map((brand, i) => (
              <a key={i} href={brand.url} target="_blank" rel="noopener noreferrer"
                className={`rounded-2xl border p-6 text-center transition-all flex flex-col items-center ${
                  brand.active
                    ? 'border-[#b3001e] bg-[#b3001e]/10'
                    : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                }`}>
                <div className="flex items-center gap-0 mb-2">
                  <span className="text-sm font-black tracking-[2px] text-white leading-none">{brand.name}</span>
                  <img src={logoImg} alt="X" width="48" height="48" className="h-4 w-auto object-contain" draggable="false" />
                </div>
                <p className="text-[10px] text-white/60 leading-snug">{lang === 'es' ? brand.es : brand.en}</p>
                <ExternalLink size={10} className="text-white/20 mt-2" />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 9: Final CTA — WHITE */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Empieza hoy', 'Start today')}</p>
          <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">{L('Listo para modernizar tu negocio?', 'Ready to modernize your business?')}</h2>
          <p className="mt-4 text-lg text-gray-500 max-w-lg mx-auto">{L('Facturacion electronica directa con DGII, sin intermediarios. El unico POS en RD con e-CF directo, modo offline y configuracion remota.', 'Direct electronic invoicing with DGII, no middlemen. The only POS in DR with direct e-CF, offline mode and remote configuration.')}</p>
          <p className="mt-3 text-[#b3001e] font-bold text-lg">{L('Desde RD$2,490/mes. Sin contrato. Sin sorpresas.', 'From RD$2,490/mo. No contract. No surprises.')}</p>
          <p className="mt-2 text-sm text-gray-500 font-medium">{L('La Ley 32-23 es obligatoria desde mayo 2026. No esperes a que tu PSFE te resuelva — resuelve tu mismo.', 'Ley 32-23 is mandatory from May 2026. Don\'t wait for your PSFE to figure it out — take control.')}</p>
          <div className="flex items-center justify-center gap-4 flex-wrap mt-10">
            <button onClick={() => navigate('/signup?plan=pro_plus')}
              className="bg-[#b3001e] hover:bg-[#d4002a] px-6 py-3 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-red-500/25">
              {L('Empezar ahora', 'Start now')} <ArrowRight size={16} className="inline ml-1" />
            </button>
            <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20informacion%20sobre%20Terminal%20X" target="_blank" rel="noopener noreferrer"
              className="border border-gray-300 text-gray-700 hover:border-gray-400 hover:shadow-lg px-6 py-3 text-sm font-bold rounded-lg transition-all">
              {L('Hablar por WhatsApp', 'Chat on WhatsApp')}
            </a>
          </div>
        </div>
      </section>

      {/* Footer — BLACK */}
      <footer className="bg-black border-t border-white/10 px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
            {/* Logo + subtitle */}
            <div className="md:col-span-1">
              <div className="flex items-center gap-0 mb-3">
                <span className="text-2xl font-black tracking-[3px] text-white leading-none -mt-1">TERMINAL</span>
                <img src={logoImg} alt="X" width="48" height="48" className="h-9 w-auto object-contain" draggable="false" />
              </div>
              <p className="text-sm text-white/60 flex items-center">{L('Parte de', 'Part of')}&nbsp;<span className="text-sm font-black tracking-[2px] text-white/60 leading-none">STUDIO</span><img src={logoImg} alt="X" width="48" height="48" className="h-3.5 w-auto object-contain opacity-40" draggable="false" /></p>
              <p className="text-xs text-white/50 mt-1">Santo Domingo, Republica Dominicana</p>
              <div className="flex flex-wrap gap-2 mt-4">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                  <Shield size={12} className="text-[#b3001e]" />
                  {L('Emisor Electronico Certificado', 'Certified Electronic Issuer')}
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                  <Check size={12} className="text-[#b3001e]" />
                  100% Ley 32-23
                </div>
              </div>
            </div>
            {/* Product */}
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-white/50 mb-4">{L('Producto', 'Product')}</p>
              <div className="space-y-2">
                <a href="#features" className="block text-sm text-white/60 hover:text-white transition-colors">{L('Funciones', 'Features')}</a>
                <a href="#pricing" className="block text-sm text-white/60 hover:text-white transition-colors">{L('Planes', 'Plans')}</a>
                <a href="#compare" className="block text-sm text-white/60 hover:text-white transition-colors">{L('Comparar', 'Compare')}</a>
                <a href="#faq" className="block text-sm text-white/60 hover:text-white transition-colors">FAQ</a>
              </div>
            </div>
            {/* Company */}
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-white/50 mb-4">{L('Empresa', 'Company')}</p>
              <div className="space-y-2">
                <a href="https://studioxrd.com" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/60 hover:text-white transition-colors">Studio X Group</a>
                <a href="https://studioxmedia.io" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/60 hover:text-white transition-colors">Studio X Media</a>
                <a href="https://studioxrdtech.com" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/60 hover:text-white transition-colors">Studio X Tech</a>
                <a href="https://studioxdetailing.com" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/60 hover:text-white transition-colors">Studio X Detailing</a>
              </div>
            </div>
            {/* Contact */}
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-white/50 mb-4">{L('Contacto', 'Contact')}</p>
              <div className="space-y-2">
                <a href="https://wa.me/18098282971" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/60 hover:text-white transition-colors">WhatsApp: +1 (809) 828-2971</a>
                <a href="mailto:info@studioxmedia.io" className="block text-sm text-white/60 hover:text-white transition-colors">info@studioxmedia.io</a>
                <a href="https://terminalxpos.com" className="block text-sm text-white/60 hover:text-white transition-colors">terminalxpos.com</a>
              </div>
            </div>
          </div>
          <div className="border-t border-white/10 mt-12 pt-8 text-center">
            <p className="text-xs text-white/50">&copy; {new Date().getFullYear()} Terminal X SRL. {L('Todos los derechos reservados.', 'All rights reserved.')}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
