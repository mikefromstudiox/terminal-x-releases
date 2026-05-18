import { useNavigate, Link } from 'react-router-dom'
import { useState, useEffect, Suspense, lazy } from 'react'
import { Monitor, Shield, Zap, BarChart3, Receipt, Users, ArrowRight, ArrowUp, Check, X, Wifi, WifiOff, Printer, MessageSquare, MessageCircle, ChevronDown, ChevronUp, Clock, CreditCard, FileText, Lock, Smartphone, Star, TrendingUp, Headphones, Menu, ExternalLink, Globe, Banknote, Calculator, Crown, Award, BadgeCheck, Package, Gift, ClipboardList, Mail, IdCard, BookOpen } from 'lucide-react'
import logoImg from '../assets/logo.webp'

// New section components — see brief "Plan reference: steady-mixing-charm.md"
import HeroAnimated from './components/HeroAnimated'
import DgiiComparison from './components/DgiiComparison'
import VerticalFeatures from './components/VerticalFeatures'
// Below-the-fold sections — lazy-split to shrink the landing entry bundle.
// Suspense fallback reserves vertical space to avoid CLS while the chunk loads.
const FeatureMatrix = lazy(() => import('./components/FeatureMatrix'))
const RoiCalculator = lazy(() => import('./components/RoiCalculator'))
const DeadlineCta   = lazy(() => import('./components/DeadlineCta'))
import StickyMobileCta from './components/StickyMobileCta'
import ExitIntentModal from './components/ExitIntentModal'

// Placeholder block sized to the largest of the three sections so the lazy
// swap is layout-shift-free (CLS = 0). Heights are min-h so the real section
// can grow taller without reflow.
const LazySkeleton = ({ minH = '480px', dark = false }) => (
  <div style={{ minHeight: minH }} className={dark ? 'bg-black' : 'bg-white'} aria-hidden="true" />
)

// Marketing copy lives in copy.json so future edits don't touch code.
import copy from './data/copy.json'

// Analytics helpers
import { trackCtaClick } from './lib/analytics'

function useBrowserLang(forced) {
  const [lang, setLang] = useState(() => {
    if (forced === 'en' || forced === 'es') return forced
    // URL pathname trumps localStorage so /en/ and / always render the
    // language Google indexed for that URL — no flash of stored lang.
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/en')) return 'en'
    const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem('tx_landing_lang') : null
    if (stored === 'en' || stored === 'es') return stored
    return navigator.language?.startsWith('en') ? 'en' : 'es'
  })
  // If forced changes (route change), follow it.
  useEffect(() => {
    if (forced === 'en' || forced === 'es') setLang(forced)
  }, [forced])
  function toggle() {
    // URL-based switch — navigate to the sibling-language page so the URL,
    // canonical, hreflang and indexable content all stay coherent. Falls back
    // to localStorage toggle for routes without a language pair.
    if (typeof window !== 'undefined') {
      const p = window.location.pathname
      let target = null
      if (p === '/' || p === '') target = '/en'
      else if (p === '/en' || p === '/en/') target = '/'
      else if (p === '/pricing') target = '/en/pricing'
      else if (p === '/en/pricing') target = '/pricing'
      else if (p === '/signup') target = '/en/signup'
      else if (p === '/en/signup') target = '/signup'
      else if (p === '/blog') target = '/en/blog'
      else if (p === '/en/blog') target = '/blog'
      else if (p.startsWith('/blog/')) target = '/en' + p
      else if (p.startsWith('/en/blog/')) target = p.slice(3)
      else if (p.startsWith('/industrias/')) target = '/en/industries/' + p.slice('/industrias/'.length)
      else if (p.startsWith('/en/industries/')) target = '/industrias/' + p.slice('/en/industries/'.length)
      if (target) { window.location.assign(target + window.location.search + window.location.hash); return }
    }
    const next = lang === 'es' ? 'en' : 'es'
    if (typeof localStorage !== 'undefined') localStorage.setItem('tx_landing_lang', next)
    setLang(next)
  }
  return { lang, toggle }
}

const PLANS = {
  es: [
    {
      name: 'Pro', key: 'pro', price: 'RD$2,490', annual: 'RD$2,117/mes facturado anual (15% OFF)',
      sub: '/mes', desc: 'Ideal para negocios pequenos', users: '2 usuarios',
      features: ['POS completo + cobrar + imprimir', 'Directorio de clientes', 'NCF B01/B02 (papel)', 'Reportes diario y mensual', 'Cuadre de Caja + Caja Chica', 'Actualizaciones automaticas'],
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
      features: ['Full POS + charge + print', 'Client directory', 'NCF B01/B02 (paper)', 'Daily and monthly reports', 'Cash Recon + Petty Cash', 'Automatic updates'],
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

const FACTURACION_PLANS = {
  es: [
    {
      name: 'Pro', key: 'facturacion_pro', price: 'RD$490',
      sub: '/mes', desc: 'Hasta 50 e-CFs al mes', endpoint: '+ Endpoint DGII Basico RD$300/mes',
      features: ['Hasta 50 facturas e-CF al mes', 'Directo a DGII (sin PSFE)', 'PDF con QR verificable', 'Envio por WhatsApp', 'Base de clientes', '1 usuario', '100% web (movil + tablet)'],
      cta: 'Probar 7 dias gratis', highlight: false,
    },
    {
      name: 'Pro PLUS', key: 'facturacion_plus', price: 'RD$990',
      sub: '/mes', badge: 'Mas popular', desc: 'Hasta 250 e-CFs al mes', endpoint: '+ Endpoint DGII Pro RD$600/mes',
      features: ['Hasta 250 facturas e-CF al mes', 'Directo a DGII (sin PSFE)', 'Multi-usuario (hasta 3)', 'Multi-moneda DOP + USD', 'Plantillas personalizadas con tu logo', 'Base de clientes', 'Reportes 606/607 automaticos', '100% web (movil + tablet)'],
      cta: 'Probar 7 dias gratis', highlight: true,
    },
    {
      name: 'Pro MAX', key: 'facturacion_max', price: 'RD$1,990',
      sub: '/mes', desc: 'e-CFs ilimitados', endpoint: '+ Endpoint DGII Ilimitado RD$1,200/mes',
      features: ['Facturas e-CF ILIMITADAS', 'Directo a DGII (sin PSFE)', 'Multi-usuario ilimitado', 'Multi-sucursal y multi-RNC', 'API para integrar con tu sistema', 'Multi-moneda DOP + USD', 'Plantillas personalizadas con tu logo', 'Reportes 606/607 automaticos', 'Soporte prioritario WhatsApp'],
      cta: 'Probar 7 dias gratis', highlight: false,
    },
  ],
  en: [
    {
      name: 'Pro', key: 'facturacion_pro', price: 'RD$490',
      sub: '/mo', desc: 'Up to 50 e-CFs/mo', endpoint: '+ DGII Endpoint Basic RD$300/mo',
      features: ['Up to 50 e-CF invoices/month', 'Direct to DGII (no PSFE)', 'PDF with verifiable QR', 'Send via WhatsApp', 'Client database', '1 user', '100% web (mobile + tablet)'],
      cta: 'Try 7 days free', highlight: false,
    },
    {
      name: 'Pro PLUS', key: 'facturacion_plus', price: 'RD$990',
      sub: '/mo', badge: 'Most popular', desc: 'Up to 250 e-CFs/mo', endpoint: '+ DGII Endpoint Pro RD$600/mo',
      features: ['Up to 250 e-CF invoices/month', 'Direct to DGII (no PSFE)', 'Multi-user (up to 3)', 'Multi-currency DOP + USD', 'Custom templates with your logo', 'Client database', 'Auto 606/607 reports', '100% web (mobile + tablet)'],
      cta: 'Try 7 days free', highlight: true,
    },
    {
      name: 'Pro MAX', key: 'facturacion_max', price: 'RD$1,990',
      sub: '/mo', desc: 'Unlimited e-CFs', endpoint: '+ DGII Endpoint Unlimited RD$1,200/mo',
      features: ['UNLIMITED e-CF invoices', 'Direct to DGII (no PSFE)', 'Unlimited users', 'Multi-location and multi-RNC', 'API for system integration', 'Multi-currency DOP + USD', 'Custom templates with your logo', 'Auto 606/607 reports', 'Priority WhatsApp support'],
      cta: 'Try 7 days free', highlight: false,
    },
  ],
}

const CERT_PACKAGES = {
  es: [
    {
      name: 'Asesoria DIY', price: 'RD$5,000', featured: false,
      features: ['Guia paso a paso de los 15 pasos DGII', 'Scripts pre-construidos de generacion y envio', 'Soporte por WhatsApp durante el proceso', 'Documentacion de errores y soluciones'],
      wa: 'Hola%2C%20quiero%20el%20servicio%20de%20Asesor%C3%ADa%20DIY%20de%20certificaci%C3%B3n%20e-CF',
    },
    {
      name: 'Certificacion Completa', price: 'RD$15,000', featured: false,
      features: ['Todo lo de Asesoria DIY', 'Ejecutamos los 15 pasos por ti', 'Endpoints de recepcion hospedados', '21 e-CFs + 4 RFCEs generados y enviados', 'Pruebas DGII monitoreadas y depuradas', 'Asistencia para cambio a produccion', '90 dias de garantia'],
      wa: 'Hola%2C%20quiero%20el%20servicio%20de%20Certificaci%C3%B3n%20Completa%20e-CF',
    },
    {
      name: 'Certificacion + Facturacion de por Vida', price: 'RD$18,000', featured: true,
      features: ['Todo lo de Certificacion Completa', 'Terminal X Facturacion Pro GRATIS de por vida (sin mensualidad)', 'Envio automatico de e-CF (E31, E32, E33, E34, E43, E47)', 'QR en cada factura + reportes 606/607 automaticos', 'Endpoint DGII a precio de costo (desde RD$300/mes)', 'Soporte prioritario WhatsApp 30 dias', 'Sesion de entrenamiento al personal'],
      wa: 'Hola%2C%20quiero%20Certificaci%C3%B3n%20%2B%20Facturaci%C3%B3n%20de%20por%20Vida',
    },
  ],
  en: [
    {
      name: 'DIY Advisory', price: 'RD$5,000', featured: false,
      features: ['Step-by-step guide for the 15 DGII steps', 'Pre-built generation and submission scripts', 'WhatsApp support during the process', 'Error and resolution documentation'],
      wa: 'Hello%2C%20I%20want%20the%20DIY%20Advisory%20e-CF%20certification%20service',
    },
    {
      name: 'Full Certification', price: 'RD$15,000', featured: false,
      features: ['Everything in DIY Advisory', 'We run all 15 steps for you', 'Receiver endpoints hosted', '21 e-CFs + 4 RFCEs generated and submitted', 'DGII tests monitored and debugged', 'Production switch-over assistance', '90-day warranty'],
      wa: 'Hello%2C%20I%20want%20the%20Full%20e-CF%20Certification%20service',
    },
    {
      name: 'Certification + Lifetime Invoicing', price: 'RD$18,000', featured: true,
      features: ['Everything in Full Certification', 'Terminal X Facturacion Pro FREE for life (no monthly fee)', 'Automatic e-CF submission (E31, E32, E33, E34, E43, E47)', 'QR on every invoice + auto 606/607 reports', 'DGII endpoint at cost (from RD$300/mo)', '30-day priority WhatsApp support', 'Staff training session'],
      wa: 'Hello%2C%20I%20want%20Certification%20%2B%20Lifetime%20Invoicing',
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
    { icon: Printer, title: 'Hardware Compatible', desc: 'Funciona con cualquier impresora termica 80mm USB y cajon de dinero estandar. Te vendemos los accesorios 2connect a precio de costo (ver mas abajo).' },
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
    { icon: Printer, title: 'Compatible Hardware', desc: 'Works with any 80mm USB thermal printer and standard cash drawer. We sell 2connect accessories at cost (see below).' },
    { icon: Headphones, title: 'Human Support', desc: 'Our team configures your system remotely. You don\'t have to be a tech expert.' },
    { icon: CreditCard, title: 'Credits + Collections', desc: 'Credit clients, partial payments, credit notes. Full control of accounts receivable.' },
    { icon: Star, title: 'DGII Certification as a Service', desc: 'Want to become a direct Electronic Issuer too? We guide you and handle the entire process. Special pricing for Terminal X clients.', cta: true },
  ],
}

const COMPARISON = {
  es: [
    { feature: 'Certificado Viafirma incluido (Pro PLUS y Pro MAX)', tx: true, alegra: false, wil: false, otros: false },
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
    { feature: 'Configuracion remota por nuestro equipo', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Visitas tecnicas a tu negocio', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Actualizaciones automaticas', tx: true, alegra: true, wil: false, otros: false },
    { feature: 'Precio menor a RD$5,000/mes', tx: true, alegra: false, wil: true, otros: true },
  ],
  en: [
    { feature: 'Viafirma digital certificate included (Pro PLUS and Pro MAX)', tx: true, alegra: false, wil: false, otros: false },
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
    { feature: 'Remote config by our team', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'On-site tech visits', tx: true, alegra: false, wil: false, otros: false },
    { feature: 'Automatic updates', tx: true, alegra: true, wil: false, otros: false },
    { feature: 'Price under RD$5,000/mo', tx: true, alegra: false, wil: true, otros: true },
  ],
}

const FAQ = {
  es: [
    // ── Facturación tier (desde RD$490/mes) — Q&A ─────────────────────────
    { q: 'Que incluye el plan Facturacion desde RD$490/mes?', a: 'Es la linea de solo facturacion electronica para negocios que ya usan otro POS o no necesitan cobrar en mostrador. Tres planes: Pro RD$490/mes (50 e-CFs/mes), Pro PLUS RD$990/mes (250 e-CFs/mes, multi-usuario, multi-moneda) y Pro MAX RD$1,990/mes (e-CFs ilimitados, multi-sucursal, API). Todos incluyen: emision directa de e-CF E31/E32/E33/E34 a DGII sin intermediarios PSFE, exportacion 606/607 para tu contador, RNC lookup local y envio por WhatsApp. El certificado Viafirma se incluye en Pro PLUS y Pro MAX.' },
    { q: 'Que pasa si emito una factura sin internet?', a: 'Terminal X la guarda en una cola local cifrada y la firma con IndicadorEnvioDiferido=1 cuando vuelva la conexion — exactamente como permite la DGII bajo la regla de 72 horas diferidas. La factura nunca se pierde y el comprobante sigue siendo valido.' },
    { q: 'Puedo emitir notas de credito (E33/E34) con el plan Facturacion?', a: 'Si. El plan Facturacion incluye emision de notas de credito E33 y E34 referenciando el e-NCF original. Las facturas anuladas se envian automaticamente a la cola de ANECF para que DGII las reciba como anuladas.' },
    { q: 'Puedo exportar 606 y 607 con el plan Facturacion?', a: 'Si — y es la razon principal por la que un plan de solo facturacion sirve en Republica Dominicana. Cada mes generas el TXT formato 606 (Compras) y 607 (Ventas) listo para subir al portal DGII. Tu contador no necesita armar nada a mano.' },
    { q: 'Que pasa cuando se vence mi certificado e-CF?', a: 'Terminal X te avisa con un banner rojo en el dashboard 30 dias antes del vencimiento, y bloquea la emision el dia que vence para que nunca subas un comprobante con certificado caducado. Cuando renuevas con Viafirma, instalas el nuevo .p12 y todo sigue. Sin sorpresas, sin multas.' },
    { q: 'Puedo manejar varias tasas de ITBIS y descuentos en una factura?', a: 'Si. Cada linea de la factura tiene su propia tasa (18% general, 16% reducida, 0% exportacion o Exento) y descuento por linea en porcentaje. Ademas puedes aplicar un descuento global en RD$ o porcentaje sobre el subtotal — todo con desglose correcto en el e-CF (MontoGravadoI1, MontoGravadoI2, MontoExento, MontoTotalDescuento).' },
    { q: 'Puedo cambiar de plan en cualquier momento?', a: 'Si, puedes subir o bajar de plan en cualquier momento desde el panel de administracion. El cambio se aplica inmediatamente.' },
    { q: 'Hay contrato anual obligatorio?', a: 'No. Puedes pagar mes a mes sin compromiso. El plan anual tiene 15% de descuento pero no es obligatorio.' },
    { q: 'Que pasa si me quedo sin internet?', a: 'Todo sigue funcionando 100% offline. Puedes cobrar, imprimir facturas, ver reportes. Se sincroniza automaticamente cuando vuelve la conexion (hasta 72 horas de cola).' },
    { q: 'Necesito comprar impresora especial?', a: 'Terminal X funciona con cualquier impresora termica 80mm USB. Si necesitas hardware nuevo, te lo vendemos a precio de costo: Impresora 2connect USB v6 RD$3,600, Impresora 2connect USB+LAN+Bluetooth+WiFi v10 RD$4,200, Lector 2D RD$1,400, Lector 2D inalambrico RD$2,000, Cajon 4 billetes/5 monedas RD$2,120, Cajon 5 billetes/8 monedas RD$3,170. El hardware NO esta incluido en la suscripcion mensual.' },
    { q: 'Que es e-CF y por que lo necesito?', a: 'e-CF (Comprobante Fiscal Electronico) es el nuevo formato obligatorio de la DGII bajo la Ley 32-23. Todos los negocios deben migrar antes de mayo 2026. Terminal X es el unico POS que se conecta directo a la DGII, sin intermediarios ni costos adicionales.' },
    { q: 'Funciona para mi tipo de negocio?', a: 'Si. Terminal X tiene modo Car Wash (cola de servicios, lavadores, comisiones), modo Tienda/Retail (inventario con codigo de barras, carrito con cantidades, stock automatico), y modo Servicios (talleres, salones, barber shops). El sistema se adapta automaticamente.' },
    { q: 'Como funciona el soporte?', a: 'Pro: autoservicio con guias. Pro PLUS: nuestro equipo te configura todo remotamente y soporte por WhatsApp en horario laboral. Pro MAX: ejecutivo dedicado + soporte prioritario + visita tecnica mensual.' },
    { q: 'Puedo manejar la nomina sin contratar un contador externo?', a: 'Si, y es una de las ventajas mas grandes de Pro MAX. Terminal X incluye nomina in-house completa: pagos quincenales o mensuales masivos en un click, calculo automatico de TSS (SFS + AFP con topes oficiales 2026), INFOTEP 1%, ISR progresivo (escalas DGII 2026), reportes listos para subir al portal TSS y DGII, recibos formales de pago, y log automatico de cambios de salario. Un contador externo en RD cobra entre RD$8,000 y RD$15,000/mes solo por esto — Pro MAX lo incluye por RD$6,990/mes.' },
    { q: 'Soy contador y manejo varios clientes — Terminal X me sirve?', a: 'Si — Pro MAX esta especificamente disenado para tu flujo. Tienes un cockpit Portfolio que muestra los 32 clientes en una sola pantalla con semaforo de obligaciones (verde radicado, ambar listo, rojo vencido). El sistema baja automaticamente cada noche los e-CFs recibidos de cada cliente desde el portal DGII Oficina Virtual (auto-pull). Generas el 606, 607, 608, 609, IR-17 e IR-13 de TODOS tus clientes con UN click — descarga un ZIP listo para subir. Conciliacion automatica detecta NCFs que faltan grabar. IT-1 mensual calculado con casillas listas para copiar. Anticipos ISR PJ calculados por Art. 314. Activos fijos con flujo de venta. Pago masivo bancario para BHD Leon y Banreservas. Modo "Ver como cliente" auditado para soporte directo. Cada cliente extra es solo un RNC mas — sin limite. Perla, nuestra contadora piloto, paso de 3 dias por cierre a 4 horas.' },
    { q: 'Como funciona el auto-pull de DGII?', a: 'En el panel Portfolio configuras la sesion DGII de cada cliente (pegas el ASP.NET_SessionId desde DevTools — F12 → Application → Cookies — o usas usuario/contrasena que el sistema cifra con AES-256-GCM). Cada noche a las 03:00 AST, un cron worker se conecta al portal DGII Oficina Virtual de cada cliente, descarga la lista de e-CFs Recibidos via la pagina ConsultaRCF.aspx, exporta el XLS, lo parsea, y guarda los registros. La proxima manana ves todos los comprobantes nuevos listos para clasificar. Cuando un cliente no te ha enviado un comprobante que el portal DGII si tiene registrado, el boton "Conciliar con DGII" lo detecta y te ofrece importarlo con un click, o generar un mensaje WhatsApp con los NCFs exactos que faltan.' },
    { q: 'Puedo importar datos de mi sistema anterior?', a: 'Si. Nuestro equipo puede importar tu historial de ventas, clientes y productos desde Starsisa, WilPOS u otros sistemas.' },
    { q: 'Que pasa si mi proveedor de facturacion electronica (PSFE) se cae?', a: 'Nada — porque no usamos uno. Terminal X es Emisor Electronico directo ante DGII. No dependemos de ef2.do, Indexa, ni ningun otro PSFE. Tu sistema firma y transmite los e-CF directamente al portal de DGII. Si un PSFE se cae, tus competidores dejan de facturar. Tu no.' },
  ],
  en: [
    // ── Facturación tier (from RD$490/mo) — Q&A ───────────────────────────
    { q: 'What does the Facturación plan from RD$490/mo include?', a: 'It is the invoicing-only tier for businesses that already use another POS or do not need a counter checkout. Three plans: Pro RD$490/mo (50 e-CFs/mo), Pro PLUS RD$990/mo (250 e-CFs/mo, multi-user, multi-currency) and Pro MAX RD$1,990/mo (unlimited e-CFs, multi-location, API). All include direct E31/E32/E33/E34 e-CF issuance with DGII (zero PSFE middlemen), 606/607 export for your accountant, local RNC lookup and WhatsApp delivery. The Viafirma certificate is bundled in Pro PLUS and Pro MAX.' },
    { q: 'What happens if I issue an invoice without internet?', a: 'Terminal X stores it in an encrypted local queue and signs it with IndicadorEnvioDiferido=1 once the connection returns — exactly the way DGII allows under the 72-hour deferred-emission rule. The invoice is never lost and the receipt stays valid.' },
    { q: 'Can I issue credit notes (E33/E34) on the Facturación plan?', a: 'Yes. The Facturación plan includes E33 and E34 credit notes that reference the original e-NCF. Voided invoices are auto-routed to the ANECF queue so DGII receives them as cancelled.' },
    { q: 'Can I export 606 and 607 reports on the Facturación plan?', a: 'Yes — and this is the main reason an invoicing-only plan even works in the Dominican Republic. Every month you generate the 606 (Purchases) and 607 (Sales) TXT files ready to upload to the DGII portal. Your accountant does not have to assemble anything by hand.' },
    { q: 'What happens when my e-CF certificate expires?', a: 'Terminal X shows a red dashboard banner 30 days before expiry and blocks issuance the day it expires so you never submit a receipt with an expired certificate. When you renew with Viafirma you install the new .p12 and everything keeps going. No surprises, no fines.' },
    { q: 'Can I handle multiple ITBIS rates and discounts on a single invoice?', a: 'Yes. Every line carries its own rate (18% general, 16% reduced, 0% export, or Exempt) and a per-line discount in percent. You can also apply a global discount in RD$ or percent on the subtotal — all properly broken down in the e-CF (MontoGravadoI1, MontoGravadoI2, MontoExento, MontoTotalDescuento).' },
    { q: 'Can I change plans anytime?', a: 'Yes, you can upgrade or downgrade at any time from the admin panel. Changes apply immediately.' },
    { q: 'Is there a mandatory annual contract?', a: 'No. You can pay month-to-month with no commitment. The annual plan has a 15% discount but is not required.' },
    { q: 'What happens if I lose internet?', a: 'Everything keeps working 100% offline. You can charge, print invoices, view reports. It syncs automatically when connection returns (up to 72 hours queued).' },
    { q: 'Do I need a special printer?', a: 'Terminal X works with any 80mm USB thermal printer. If you need new hardware, we sell it at cost: 2connect USB Printer v6 RD$3,600, 2connect USB+LAN+Bluetooth+WiFi Printer v10 RD$4,200, 2D Scanner RD$1,400, Wireless 2D Scanner RD$2,000, 4-bill/5-coin Drawer RD$2,120, 5-bill/8-coin Drawer RD$3,170. Hardware is NOT included in the monthly subscription.' },
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
function XIconLight() { return <X size={16} className="text-black/20 mx-auto" /> }

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-black/10 bg-white overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-6 py-5 text-left">
        <span className="font-bold text-[15px] text-black pr-4">{q}</span>
        {open ? <ChevronUp size={18} className="text-black/60 shrink-0" /> : <ChevronDown size={18} className="text-black/60 shrink-0" />}
      </button>
      {open && <p className="px-6 pb-5 text-sm text-black/60 leading-relaxed">{a}</p>}
    </div>
  )
}

export default function LandingPage({ section, forceLang }) {
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const { lang, toggle: toggleLang } = useBrowserLang(forceLang)
  const L = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const navLinks = [
    { label: L('Funciones', 'Features'), href: '#features' },
    { label: L('Facturacion', 'Invoicing'), href: '#facturacion' },
    { label: L('Planes', 'Plans'), href: '#pricing' },
    { label: L('Certificacion', 'Certification'), href: '#certificacion' },
    { label: 'Blog', href: '/blog', isRoute: true },
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
              link.isRoute
                ? <Link key={link.href} to={link.href} className="text-sm font-medium text-white/70 hover:text-[#b3001e] transition-colors">{link.label}</Link>
                : <a key={link.href} href={link.href} className="text-sm font-medium text-white/70 hover:text-[#b3001e] transition-colors">{link.label}</a>
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
              link.isRoute
                ? <Link key={link.href} to={link.href} onClick={() => setMobileMenuOpen(false)} className="block py-3 text-sm font-medium text-white/70 hover:text-[#b3001e] transition-colors">{link.label}</Link>
                : <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className="block py-3 text-sm font-medium text-white/70 hover:text-[#b3001e] transition-colors">{link.label}</a>
            ))}
            <button onClick={() => { setMobileMenuOpen(false); navigate('/pos') }} className="mt-2 w-full bg-[#b3001e] hover:bg-[#d4002a] rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors">
              {L('Iniciar Sesion', 'Log In')}
            </button>
          </div>
        )}
      </nav>

      {/* SECTION 1: Hero — WHITE — HeroAnimated (3-col SVG mockup grid) */}
      <HeroAnimated lang={lang} />

      {/* SECTION 1.2: Verticals (WHITE) — moved up so visitors see "Por Industria" right after the hero */}
      <VerticalFeatures lang={lang} />

      {/* SECTION 1.5: DGII vs Terminal X — BLACK — head-to-head capability table */}
      <DgiiComparison lang={lang} />

      {/* (legacy hero block retained but never rendered — kept for reference until copy migration ships) */}
      {false && (
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Emisor Electronico Certificado DGII', 'Certified DGII Electronic Issuer')}</p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">
            {L(<>El unico POS en RD certificado como <span className="text-[#b3001e]">Emisor Electronico directo</span> ante DGII</>, <>The only POS in DR certified as a <span className="text-[#b3001e]">direct Electronic Issuer</span> with DGII</>)}
          </h1>
          <p className="mt-4 text-lg text-black/60 max-w-2xl mx-auto">
            {L('Facturacion electronica directa a DGII — sin intermediarios, sin PSFE, sin costo por comprobante. Desktop + Web + Movil. Modo offline. Configuracion remota por nuestro equipo.', 'Direct electronic invoicing to DGII — no middlemen, no PSFE, no per-invoice fees. Desktop + Web + Mobile. Offline mode. Remote setup by our team.')}
          </p>
          <p className="mt-2 text-sm text-black/60">
            {L('Car Wash, tiendas, retail, talleres, barber shops, dealers — cualquier negocio en RD. Inventario con codigo de barras, POS con cantidades, stock automatico. Cumple la Ley 32-23.', 'Car Wash, stores, retail, workshops, barber shops, dealers — any business in DR. Inventory with barcode, POS with quantities, auto stock. Meet Ley 32-23.')}
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap mt-10">
            <button onClick={() => navigate('/signup?plan=pro_plus')}
              className="bg-[#b3001e] hover:bg-[#d4002a] px-6 py-3 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-red-500/25">
              {L('Empezar ahora', 'Start now')} <ArrowRight size={16} className="inline ml-1" />
            </button>
            <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20informacion%20sobre%20Terminal%20X" target="_blank" rel="noopener noreferrer"
              className="border border-black/20 text-black/80 hover:border-black/40 hover:shadow-lg px-6 py-3 text-sm font-bold rounded-lg transition-all">
              {L('Hablar con ventas', 'Talk to sales')}
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
                <p className="text-sm text-black/60 font-medium mt-1">{s.label}</p>
              </div>
            ))}
          </div>
          {/* Trust bar */}
          <p className="mt-10 text-xs text-black/60 tracking-wide text-center">
            {L(
              'Certificado digital Viafirma \u00B7 Solicitud DGII #42483 \u00B7 RNC 133410321 \u00B7 Santo Domingo, RD',
              'Viafirma digital certificate \u00B7 DGII Application #42483 \u00B7 RNC 133410321 \u00B7 Santo Domingo, DR'
            )}
          </p>
        </div>
      </section>
      )}

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
            <p className="mt-4 text-lg text-black/60 max-w-2xl mx-auto">{L('Terminal X es el unico sistema de punto de venta en Republica Dominicana que combina facturacion electronica e-CF directa con DGII, inventario con codigo de barras, modo offline 100% y herramientas completas para car wash, tiendas y negocios de servicios.', 'Terminal X is the only POS system in the Dominican Republic that combines direct e-CF electronic invoicing with DGII, barcode inventory, 100% offline mode, and complete tools for car washes, stores, and service businesses.')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            {FEATURES[lang].map((f, i) => (
              <div key={i} className={`rounded-2xl border p-8 transition-all hover:-translate-y-2 hover:shadow-2xl ${f.cta ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-black/10 bg-white'}`}>
                <div className="w-12 h-12 bg-[#b3001e]/10 rounded-xl flex items-center justify-center mb-5">
                  <f.icon size={22} className="text-[#b3001e]" />
                </div>
                <h3 className="text-base font-bold text-black mb-2">{f.title}</h3>
                <p className="text-sm text-black/60 leading-relaxed">{f.desc}</p>
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

      {/* SECTION 3.4: Nuevo en Terminal X — v2.11.0 hero features — BLACK */}
      <section id="nuevo" className="bg-black px-4 py-24 sm:px-6 lg:px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#b3001e]/15 border border-[#b3001e]/40 mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-[#b3001e] animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[2px] text-[#b3001e]">v2.11.0 · {L('Abril 2026', 'April 2026')}</span>
            </div>
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Nuevo en Terminal X', 'New in Terminal X')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">{L('Lo ultimo que cambiamos por ti.', 'The latest upgrades we shipped for you.')}</h2>
            <p className="mt-4 text-lg text-white/60 max-w-2xl mx-auto">{L('Seis funciones nuevas que te ahorran tiempo, previenen perdidas y te dan el control real del negocio — incluidas en tu plan actual, sin costo extra.', 'Six new features that save you time, prevent losses, and give you real control of the business — included in your current plan at no extra cost.')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-16">
            {[
              {
                Icon: IdCard,
                title: L('Tarjeta de Autorizacion de Gerente', 'Manager Authorization Card'),
                body: L('Tus cajeras no memorizan PINs. Los gerentes llevan una tarjeta fisica con codigo de barras — se escanea, se autoriza, se registra.', 'Cashiers don\'t memorize PINs. Managers carry a physical card with barcode — scan, authorize, log.'),
              },
              {
                Icon: Gift,
                title: L('Programa de Lealtad', 'Loyalty Program'),
                body: L('Tus clientes acumulan puntos y regresan mas. Automatico, por niveles, con canje en el POS.', 'Customers earn points and come back more. Automatic, tiered, redeemable at checkout.'),
              },
              {
                Icon: ClipboardList,
                title: L('Conteo Fisico Semanal', 'Weekly Physical Count'),
                body: L('Imprime la hoja, cuenta, entra los numeros. Recibes un reporte de merma en RD$ por SKU.', 'Print the sheet, count, enter the numbers. Get a shrinkage report in RD$ by SKU.'),
              },
              {
                Icon: Users,
                title: L('Multi-dispositivo Sin Conflicto', 'Multi-device without Conflicts'),
                body: L('Dos cajeras vendiendo al mismo tiempo sin vender la misma botella dos veces. Bloqueo de ticket en tiempo real.', 'Two cashiers selling at the same time without double-selling the same bottle. Real-time ticket locks.'),
              },
              {
                Icon: WifiOff,
                title: L('Modo Offline', 'Offline Mode'),
                body: L('El internet se cae, tu sigues vendiendo. Se sincroniza solo cuando vuelve la senal. 100% PWA.', 'Internet drops, you keep selling. Syncs automatically when it comes back. 100% PWA.'),
              },
              {
                Icon: Mail,
                title: L('Resumen Diario Automatico', 'Automatic Daily Digest'),
                body: L('Cada manana a las 9:00 AM te llega el WhatsApp con las ventas de ayer — sin abrir el sistema.', 'Every morning at 9:00 AM the WhatsApp arrives with yesterday\'s sales — without opening the system.'),
              },
            ].map(({ Icon, title, body }, i) => (
              <div key={i} className="group rounded-2xl border border-white/10 bg-white/5 p-8 transition-all hover:-translate-y-2 hover:border-[#b3001e] hover:bg-[#b3001e]/5 hover:shadow-2xl hover:shadow-[#b3001e]/20">
                <div className="w-12 h-12 bg-[#b3001e]/15 border border-[#b3001e]/40 rounded-xl flex items-center justify-center mb-5 group-hover:bg-[#b3001e] transition-colors">
                  <Icon size={22} className="text-[#b3001e] group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-4 flex-wrap mt-14">
            <a href="#pricing" className="bg-[#b3001e] hover:bg-[#d4002a] px-6 py-3 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-red-500/25">
              {L('Ver plan completo', 'See full plan')} <ArrowRight size={16} className="inline ml-1" />
            </a>
          </div>
        </div>
      </section>

      {/* SECTION 3.55: WhatsApp demo CTA (WHITE) — replaces the in-app demo grid.
          Every "demo" entry-point on the site routes to WhatsApp for a guided walk-through. */}
      <section className="bg-white px-4 py-20 sm:px-6 lg:px-8 border-t border-black/5">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">
            {L('VER UNA DEMO', 'SEE A DEMO')}
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-black">
            {L('Hablemos por WhatsApp', "Let's talk on WhatsApp")}
          </h2>
          <p className="mt-5 text-base text-black/60 max-w-2xl mx-auto leading-relaxed">
            {L(
              'Te damos acceso a una cuenta de demo real con datos sembrados para tu vertical y te guiamos en vivo. Nada de juguetes — el sistema completo, con tu plan y tu industria.',
              'We give you access to a real demo account with seeded data for your vertical and walk you through live. No toys — the full system, with your plan and your industry.'
            )}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={`https://wa.me/18098282971?text=${encodeURIComponent(
                L('Hola, quiero ver una demo de Terminal X', 'Hi, I want to see a Terminal X demo')
              )}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-[#b3001e] hover:brightness-110 text-white font-bold px-8 py-4 rounded-xl transition"
            >
              {L('Pedir demo por WhatsApp', 'Request demo on WhatsApp')}
            </a>
            <a
              href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-black hover:bg-black/80 text-white font-bold px-8 py-4 rounded-xl transition"
            >
              {L('Empezar 7 días gratis', 'Start 7-day free trial')}
            </a>
          </div>
          <p className="mt-6 text-xs text-black/60 font-semibold tracking-wide">
            +1 (809) 828-2971 · {L('Lunes a sábado', 'Mon–Sat')} · 9am–7pm
          </p>
        </div>
      </section>

      {/* (legacy 3.5 + 3.6 retained but never rendered for diff readability) */}
      {false && (<>
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Multi-Negocio', 'Multi-Business')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">
              {L('Un sistema, cualquier tipo de negocio', 'One system, any business type')}
            </h2>
            <p className="mt-4 text-lg text-black/60 max-w-2xl mx-auto">
              {L(
                'Terminal X se adapta automaticamente a tu tipo de negocio. Car wash, tienda, retail, taller, salon — el mismo sistema con la interfaz perfecta para cada uno.',
                'Terminal X automatically adapts to your business type. Car wash, store, retail, workshop, salon — the same system with the perfect interface for each.'
              )}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16">
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
                title: L('Licorería', 'Liquor Store'),
                desc: L('Venta de licores, cervezas, vinos. Verificacion de edad 18+ automatica, deposito de botellas, top-sellers Brugal / Presidente / Johnnie Walker a la mano.', 'Liquor, beer, wine sales. Automatic 18+ age verification, bottle deposit tracker, top-sellers (Brugal / Presidente / Johnnie Walker) one tap away.'),
                items: [L('Verificacion de edad 18+', 'Age verification 18+'), L('Deposito de botellas', 'Bottle deposit'), L('Accesos rapidos a top-sellers', 'Quick access top-sellers')],
              },
              {
                title: L('Carnicería', 'Butcher / Meat Market'),
                desc: L('Venta de carnes por peso con bascula integrada. Res, pollo, cerdo, embutidos, mariscos — precio por libra, tara, recibo con peso + precio/lb.', 'Meat sales by weight with integrated scale. Beef, pork, chicken, seafood — price per pound, tare, receipt shows weight + price per lb.'),
                items: [L('Precio por libra / kg', 'Price per pound / kg'), L('Bascula integrada + tara', 'Integrated scale + tare'), L('Catalogo de cortes', 'Cut catalog')],
              },
              {
                title: L('Servicios / Otro', 'Services / Other'),
                desc: L('Talleres, salones, barber shops, dealers — cualquier negocio de servicios con facturacion DGII incluida.', 'Workshops, salons, barber shops, dealers — any service business with DGII invoicing included.'),
                items: [L('Servicios + productos', 'Services + products'), L('Creditos a clientes', 'Client credits'), L('Reportes 606/607', '606/607 reports')],
              },
            ].map((biz, i) => (
              <div key={i} className={`rounded-2xl border p-8 transition-all hover:-translate-y-2 hover:shadow-2xl ${biz.highlight ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-black/10 bg-white'}`}>
                <h3 className="text-lg font-bold text-black mb-2">{biz.title}</h3>
                <p className="text-sm text-black/70 leading-relaxed mb-4">{biz.desc}</p>
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
      </>)}

      {/* SECTION 3.7: Facturacion Plan — WHITE */}
      <section id="facturacion" className="bg-white px-4 py-24 sm:px-6 lg:px-8 scroll-mt-32">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Solo Facturacion', 'Invoicing Only')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">
              {L(<>Cumple la Ley 32-23 <span className="text-[#b3001e]">sin necesitar un POS</span></>, <>Meet Law 32-23 <span className="text-[#b3001e]">without needing a POS</span></>)}
            </h2>
            <p className="mt-4 text-lg text-black/60 max-w-2xl mx-auto">
              {L('Si solo necesitas emitir comprobantes electronicos, este plan es para ti. Facturacion e-CF directa a DGII desde tu navegador, sin instalar nada.', 'If you only need to issue electronic invoices, this plan is for you. Direct e-CF invoicing to DGII from your browser, no installation needed.')}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 max-w-5xl mx-auto">
            {(FACTURACION_PLANS[lang] || FACTURACION_PLANS.es).map((fp, idx) => (
              <div key={idx} className={`rounded-2xl p-7 sm:p-8 relative transition-all ${fp.highlight ? 'border-2 border-[#b3001e] bg-[#b3001e]/5 scale-[1.02] hover:bg-[#b3001e]/10 shadow-lg shadow-[#b3001e]/10 hover:shadow-xl hover:shadow-[#b3001e]/20' : 'border border-black/10 bg-white hover:border-[#b3001e]/30 hover:bg-[#b3001e]/[0.02] hover:shadow-lg hover:shadow-black/5'}`}>
                {fp.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#b3001e] text-white text-[10px] font-bold rounded-full uppercase tracking-wider whitespace-nowrap">
                    {fp.badge}
                  </div>
                )}
                <div className="text-center mb-5">
                  <h3 className="text-lg font-bold text-black">{fp.name}</h3>
                  <p className="text-xs text-black/60 mt-1 font-medium">{fp.desc}</p>
                  <p className="text-3xl font-extrabold text-black mt-3">{fp.price}<span className="text-sm font-normal text-black/60">{fp.sub}</span></p>
                  {fp.annual && <p className="text-[11px] text-black/60 mt-1">{fp.annual}</p>}
                  {fp.endpoint && <p className="text-[11px] text-black/60 font-medium mt-1">{fp.endpoint}</p>}
                  {fp.overage && <p className="text-[11px] text-[#b3001e] font-medium mt-1">{fp.overage}</p>}
                </div>
                <ul className="space-y-2.5 mb-6">
                  {fp.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-black/70">
                      <Check size={13} className="text-[#b3001e] shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => { try { trackCtaClick('pricing_card', fp.key) } catch {}; navigate(`/signup?plan=${fp.key}`) }}
                  className={`w-full py-3 rounded-lg text-sm font-bold transition-colors ${fp.highlight ? 'bg-[#b3001e] hover:bg-[#d4002a] text-white shadow-lg shadow-red-500/25' : 'bg-black hover:bg-black/80 text-white'}`}>
                  {fp.cta} <ArrowRight size={14} className="inline ml-1" />
                </button>
                <button onClick={() => { try { trackCtaClick('pricing_card_demo', fp.key) } catch {}; navigate(`/signup?plan=${fp.key}&type=contabilidad`) }}
                  className="w-full mt-2 py-2.5 rounded-lg text-[12px] font-bold text-black/70 hover:text-[#b3001e] border border-black/10 hover:border-[#b3001e]/40 transition-colors">
                  {L('Ver demo interactivo', 'Try interactive demo')} <ArrowRight size={12} className="inline ml-1" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-center mt-6 text-xs text-black/60">
            {L('Necesitas punto de venta?', 'Need a point of sale?')}{' '}
            <a href="#pricing" className="text-[#b3001e] font-semibold hover:underline">
              {L('Ver planes POS', 'See POS plans')} <ArrowRight size={10} className="inline" />
            </a>
          </p>
        </div>
      </section>

      {/* SECTION 4: Pricing — BLACK */}
      <section id="pricing" className="bg-black px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Planes', 'Plans')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">{L('Planes y Precios', 'Plans & Pricing')}</h2>
            <p className="mt-4 text-lg text-white/50">{L('Elige el plan ideal para tu negocio. Sin contrato. Cancela cuando quieras.', 'Choose the ideal plan for your business. No contract. Cancel anytime.')}</p>
            <p className="mt-2 text-sm font-semibold text-[#b3001e]">{L('Certificado digital Viafirma incluido en Pro PLUS y Pro MAX. Hardware (impresora, cajon, lector) se vende aparte a precio de costo.', 'Viafirma digital certificate included in Pro PLUS and Pro MAX. Hardware (printer, drawer, scanner) sold separately at cost.')}</p>
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
                <div className={`rounded-lg px-3 py-2 mb-5 text-xs font-semibold ${plan.highlight ? 'bg-[#b3001e] text-white' : 'bg-white/5 text-white/70'}`}>
                  <Headphones size={12} className="inline mr-1.5" />
                  {plan.support}
                </div>
                <button onClick={() => { try { trackCtaClick('pricing_card', plan.key) } catch {}; navigate(`/signup?plan=${plan.key}`) }}
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

          {/* Add-ons — WhatsApp Automatización (UltraMsg) */}
          <div className="max-w-3xl mx-auto mt-12">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-7">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#b3001e]/15 flex items-center justify-center shrink-0">
                  <MessageCircle size={20} className="text-[#b3001e]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-base font-bold text-white">{L('Add-on: Automatización WhatsApp', 'Add-on: WhatsApp Automation')}</h3>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-white/10 text-white/70">{L('Opcional', 'Optional')}</span>
                  </div>
                  <p className="text-[13px] text-white/60 leading-relaxed">
                    {L(
                      'Envío automático de recibos, recordatorios de pago y facturas por WhatsApp desde el POS. Requiere instancia UltraMsg activa por cuenta del cliente. Sin add-on, los planes incluyen envío manual vía wa.me (un toque para abrir WhatsApp con el mensaje listo).',
                      'Automated sending of receipts, payment reminders and invoices via WhatsApp from the POS. Requires an active UltraMsg instance billed to the client. Without the add-on, all plans include manual sending via wa.me (one tap opens WhatsApp with the message ready).'
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[12px]">
                    <span className="text-[#b3001e] font-bold">RD$1,990<span className="text-white/60 font-normal">/{L('mes', 'mo')}</span></span>
                    <span className="text-white/60">{L('o el cliente paga UltraMsg directo (~US$39/mes)', 'or the client pays UltraMsg directly (~US$39/mo)')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4.4: Hardware accesorios — WHITE */}
      <section id="hardware" className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Hardware', 'Hardware')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">{L('Accesorios 2connect a precio de costo', '2connect accessories at cost')}</h2>
            <p className="mt-4 text-lg text-black/60 max-w-2xl mx-auto">{L('El hardware NO esta incluido en la suscripcion mensual. Si necesitas impresora, cajon o lector, te los vendemos al mismo precio que pagamos. Tambien funciona con tu hardware actual.', 'Hardware is NOT included in the monthly subscription. If you need a printer, drawer or scanner, we sell them at the same price we pay. Also works with your existing hardware.')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-14">
            {[
              { icon: Printer, title: L('Impresora termica 2connect USB v6', '2connect USB Thermal Printer v6'), desc: L('80mm USB. La opcion mas economica.', '80mm USB. Most affordable option.'), price: 'RD$3,600' },
              { icon: Printer, title: L('Impresora termica 2connect v10', '2connect Thermal Printer v10'), desc: L('80mm USB + LAN + Bluetooth + WiFi. Multi-conexion.', '80mm USB + LAN + Bluetooth + WiFi. Multi-connection.'), price: 'RD$4,200', badge: L('Recomendada', 'Recommended') },
              { icon: Package, title: L('Cajon de dinero 4 billetes / 5 monedas', '4-bill / 5-coin Cash Drawer'), desc: L('Compacto, ideal para mostrador pequeno.', 'Compact, ideal for small counter.'), price: 'RD$2,120' },
              { icon: Package, title: L('Cajon de dinero 5 billetes / 8 monedas', '5-bill / 8-coin Cash Drawer'), desc: L('Tamano completo. Mas espacio para vueltos.', 'Full size. More room for change.'), price: 'RD$3,170' },
              { icon: Zap, title: L('Lector 2D 2connect (USB)', '2connect 2D Scanner (USB)'), desc: L('Lee codigos de barras 1D y QR. Cable USB.', 'Reads 1D barcodes and QR. USB cable.'), price: 'RD$1,400' },
              { icon: Zap, title: L('Lector 2D 2connect inalambrico', '2connect Wireless 2D Scanner'), desc: L('1D + QR sin cable. Para movilidad en tienda.', '1D + QR wireless. For in-store mobility.'), price: 'RD$2,000' },
            ].map((h, i) => {
              const Icon = h.icon
              return (
                <div key={i} className="rounded-2xl border border-black/10 bg-white p-6 hover:border-[#b3001e]/40 hover:shadow-lg transition-all relative">
                  {h.badge && (
                    <div className="absolute -top-3 left-6 px-3 py-1 bg-[#b3001e] text-white text-[10px] font-bold rounded-full uppercase tracking-wider">{h.badge}</div>
                  )}
                  <div className="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center mb-4">
                    <Icon size={22} className="text-[#b3001e]" />
                  </div>
                  <h3 className="text-base font-bold text-black leading-tight">{h.title}</h3>
                  <p className="text-sm text-black/60 mt-2 leading-relaxed">{h.desc}</p>
                  <p className="text-2xl font-extrabold text-black mt-4">{h.price}</p>
                  <p className="text-[11px] text-black/60 uppercase tracking-wider mt-1">{L('Pago unico', 'One-time')}</p>
                </div>
              )
            })}
          </div>
          <p className="text-center mt-10 text-sm text-black/60 max-w-2xl mx-auto">
            {L('Pidelo por WhatsApp al ', 'Order via WhatsApp at ')}
            <a href="https://wa.me/18098282971" className="text-[#b3001e] font-bold hover:underline">+1 (809) 828-2971</a>
            {L('. Lo configuramos contigo el dia que llegue.', '. We configure it with you the day it arrives.')}
          </p>
        </div>
      </section>

      {/* SECTION 4.5: Feature Matrix — WHITE — full 60-row × 6-tier table */}
      <Suspense fallback={<LazySkeleton minH="720px" />}>
        <FeatureMatrix lang={lang} />
      </Suspense>

      {/* SECTION 4.6: ROI Calculator — BLACK — Grok-spec inputs (facturas, minutos, empleados) */}
      <Suspense fallback={<LazySkeleton minH="560px" dark />}>
        <RoiCalculator lang={lang} />
      </Suspense>

      {/* SECTION 5: Support tiers — WHITE */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Soporte', 'Support')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">{L('Nivel de soporte por plan', 'Support level by plan')}</h2>
            <p className="mt-4 text-lg text-black/60">{L('No solo vendemos software. Te acompanamos.', 'We don\'t just sell software. We walk with you.')}</p>
          </div>
          <div className="max-w-4xl mx-auto overflow-x-auto mt-12">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-black/20">
                  <th className="text-left py-3 px-4 font-bold text-black">{L('Soporte', 'Support')}</th>
                  <th className="py-3 px-3 text-center font-bold text-black/70">Pro</th>
                  <th className="py-3 px-3 text-center font-bold text-[#b3001e]">Pro PLUS</th>
                  <th className="py-3 px-3 text-center font-bold text-black/70">Pro MAX</th>
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
                  <tr key={i} className={i % 2 === 0 ? 'bg-black/[0.03]' : 'bg-white'}>
                    <td className="py-3 px-4 font-medium text-black">{row.s}</td>
                    {['pro', 'plus', 'max'].map(col => {
                      const v = row[col]
                      return (
                        <td key={col} className="py-3 px-3 text-center">
                          {v === true ? <Check size={16} className="text-[#b3001e] mx-auto" /> :
                           v === false ? <X size={16} className="text-black/30 mx-auto" /> :
                           <span className="text-black/70 font-medium">{v}</span>}
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

      {/* SECTION 6.5: e-CF Certification Service — WHITE */}
      <section id="certificacion" className="bg-white px-4 py-24 sm:px-6 lg:px-8 scroll-mt-32">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Certificacion e-CF', 'e-CF Certification')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">
              {L('Servicio de Certificacion e-CF', 'e-CF Certification Service')}
            </h2>
            <p className="mt-4 text-lg text-black/60 max-w-2xl mx-auto">
              {L('Nos encargamos de todo el proceso de certificacion ante DGII. Tu solo firmas — nosotros hacemos el resto.', 'We handle the entire DGII certification process. You just sign — we do the rest.')}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mt-16">
            {CERT_PACKAGES[lang].map((pkg, i) => (
              <div key={i}
                className={`rounded-2xl p-8 border flex flex-col transition-all hover:-translate-y-2 hover:shadow-2xl ${
                  pkg.featured
                    ? 'border-[#b3001e] bg-[#b3001e]/5 ring-2 ring-[#b3001e]/30 relative scale-[1.02]'
                    : 'border-black/10 bg-white'
                }`}>
                {pkg.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#b3001e] text-white text-[10px] font-bold rounded-full uppercase tracking-wider whitespace-nowrap">
                    {L('Recomendado', 'Recommended')}
                  </div>
                )}
                <h3 className="text-xl font-bold text-black mb-1">{pkg.name}</h3>
                <p className="text-3xl font-extrabold text-black mb-6">{pkg.price}</p>
                <ul className="space-y-3 mb-8 flex-1">
                  {pkg.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-black/70">
                      <Check size={14} className="text-[#b3001e] shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <a href={`https://wa.me/18098282971?text=${pkg.wa}`} target="_blank" rel="noopener noreferrer"
                  className={`w-full py-3 rounded-lg text-sm font-bold text-center transition-colors flex items-center justify-center gap-2 ${
                    pkg.featured
                      ? 'bg-[#b3001e] hover:bg-[#d4002a] text-white shadow-lg shadow-red-500/25'
                      : 'border border-black/20 text-black hover:border-black/40 hover:bg-black/5'
                  }`}>
                  <MessageSquare size={14} />
                  {L('Solicitar', 'Request')}
                </a>
              </div>
            ))}
          </div>
          {/* Trust indicators */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10 mt-16">
            <div className="flex items-center gap-2 text-sm font-bold text-black">
              <Award size={18} className="text-[#b3001e]" />
              {L('Emisor Electronico Certificado — DGII', 'Certified Electronic Issuer — DGII')}
            </div>
            <div className="flex items-center gap-2 text-sm font-bold text-black">
              <BadgeCheck size={18} className="text-[#b3001e]" />
              {L('15 pasos completados — 100% de aprobacion', '15 steps completed — 100% approval')}
            </div>
            <div className="flex items-center gap-2 text-sm font-bold text-black">
              <Shield size={18} className="text-[#b3001e]" />
              RNC 133410321 — Studio X SRL
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6.6: DGII e-CF FAQ — BLACK (answers the questions every lead asks Mike) */}
      <section id="ecf-faq" className="bg-black px-4 py-24 sm:px-6 lg:px-8 scroll-mt-32">
        <div className="max-w-5xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">{L('Guia e-CF DGII', 'DGII e-CF Guide')}</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">
              {L('Todo lo que necesitas saber sobre e-CF', 'Everything you need to know about e-CF')}
            </h2>
            <p className="mt-4 text-lg text-white/50 max-w-2xl mx-auto">
              {L(
                'Antes de que contactes, revisa las opciones. La Ley 32-23 te obliga a emitir Comprobantes Fiscales Electronicos, pero no todas las soluciones sirven para tu negocio.',
                'Before you reach out, review the options. Law 32-23 requires you to issue Electronic Fiscal Receipts, but not every solution fits your business.'
              )}
            </p>
          </div>

          {/* A) Facturador Gratuito DGII vs Terminal X Pro PLUS */}
          <div className="mt-16">
            <div className="text-center">
              <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
                {L('Y el Facturador Gratuito de DGII?', 'What about DGII\'s Free Facturador?')}
              </h3>
              <p className="mt-3 text-white/50 max-w-2xl mx-auto text-sm">
                {L(
                  'Es una herramienta valida para profesionales liberales. Pero si tienes un negocio con volumen, te quedas corto en semanas.',
                  'It\'s a valid tool for liberal professionals. But if you run a business with volume, you\'ll outgrow it in weeks.'
                )}
              </p>
            </div>

            <div className="max-w-4xl mx-auto overflow-x-auto mt-10 rounded-2xl border border-white/10 bg-white/5">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-white/20">
                    <th className="text-left py-4 px-4 font-bold text-white">{L('Caracteristica', 'Feature')}</th>
                    <th className="py-4 px-3 font-medium text-white/60 text-center">
                      {L('Facturador Gratuito', 'Free Facturador')}
                    </th>
                    <th className="py-4 px-3 font-bold text-[#b3001e] text-center whitespace-nowrap">
                      <span className="inline-flex items-center gap-0">
                        <span className="text-sm font-black tracking-[2px] leading-none -mt-1">TERMINAL</span>
                        <img src={logoImg} alt="X" width="48" height="48" className="h-4 w-auto object-contain" draggable="false" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { f: L('Facturas por mes', 'Invoices per month'),                              g: L('~150 max', '~150 max'),                                  t: L('ILIMITADAS', 'UNLIMITED'),                                 tBold: true },
                    { f: L('Inventario / SKU / codigo de barras', 'Inventory / SKU / barcode'),    g: false,                                                      t: true },
                    { f: L('Base de clientes guardada', 'Saved client database'),                  g: false,                                                      t: true },
                    { f: L('POS (cobrar, imprimir, gaveta)', 'POS (charge, print, drawer)'),       g: false,                                                      t: true },
                    { f: L('Multi-moneda (USD)', 'Multi-currency (USD)'),                          g: L('Solo DOP', 'DOP only'),                                  t: true },
                    { f: L('Certificado digital incluido', 'Digital certificate included'),        g: L('Solo dentro del facturador', 'Only inside the tool'),    t: L('Viafirma en Pro PLUS y Pro MAX', 'Viafirma in Pro PLUS and Pro MAX'), tBold: true },
                    { f: L('Reportes avanzados (ventas, inventario, nomina)', 'Advanced reports (sales, inventory, payroll)'), g: false, t: true },
                    { f: L('Funciona offline', 'Works offline'),                                   g: false,                                                      t: L('Desktop', 'Desktop') },
                    { f: L('Costo', 'Cost'),                                                       g: L('Gratis', 'Free'),                                        t: 'RD$4,490/mes' },
                    { f: L('Ideal para', 'Ideal for'),                                             g: L('Profesionales liberales (3–5 facturas/mes)', 'Liberal professionals (3–5 invoices/mo)'), t: L('Negocios con 50+ ventas/dia', 'Businesses with 50+ sales/day') },
                  ].map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white/5' : ''}>
                      <td className="py-3 px-4 text-white/80 font-medium">{row.f}</td>
                      <td className="py-3 px-3 text-center">
                        {row.g === true ? <CheckIcon /> :
                         row.g === false ? <XIcon /> :
                         <span className="text-white/60 text-[13px]">{row.g}</span>}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {row.t === true ? <CheckIcon /> :
                         row.t === false ? <XIcon /> :
                         <span className={`text-[13px] ${row.tBold ? 'text-[#b3001e] font-bold' : 'text-white font-semibold'}`}>{row.t}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-center mt-6 text-sm text-white/50 italic max-w-2xl mx-auto">
              {L(
                '"El Facturador Gratuito es una herramienta de emergencia. Si tu negocio hace mas de 150 facturas al mes, necesitas un sistema real."',
                '"The Free Facturador is an emergency tool. If your business issues more than 150 invoices per month, you need a real system."'
              )}
            </p>
          </div>

          {/* B) FAQ cards */}
          <div className="mt-20">
            <div className="text-center">
              <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
                {L('Preguntas frecuentes sobre e-CF', 'Frequently asked questions about e-CF')}
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-10">
              {[
                {
                  q: L('Que es el e-CF y cuando es obligatorio?', 'What is e-CF and when is it mandatory?'),
                  a: L(
                    'La Ley 32-23 obliga a todos los contribuyentes a emitir Comprobantes Fiscales Electronicos (e-CF). Grandes y medianos desde 15 nov 2025. MIPYMEs y personas fisicas: 15 de mayo 2026.',
                    'Law 32-23 requires all taxpayers to issue Electronic Fiscal Receipts (e-CF). Large and medium companies since Nov 15 2025. MSMEs and individuals: May 15 2026.'
                  ),
                },
                {
                  q: L('Necesito pagar para emitir e-CF?', 'Do I need to pay to issue e-CF?'),
                  a: L(
                    'Si. Necesitas un certificado digital (RD$2,360/ano) + un sistema autorizado. Terminal X incluye ambos desde RD$2,490/mes.',
                    'Yes. You need a digital certificate (RD$2,360/yr) + an authorized system. Terminal X includes both starting at RD$2,490/mo.'
                  ),
                },
                {
                  q: L('Que es el Facturador Gratuito de DGII?', 'What is DGII\'s Free Facturador?'),
                  a: L(
                    'Una herramienta de DGII para profesionales liberales. Maximo ~150 facturas/mes, sin inventario, sin POS, sin base de clientes. No funciona para negocios con volumen.',
                    'A DGII tool for liberal professionals. Max ~150 invoices/mo, no inventory, no POS, no client database. Doesn\'t work for businesses with volume.'
                  ),
                },
                {
                  q: L('Cuanto cuesta certificarme?', 'How much does certification cost?'),
                  a: L(
                    'Nosotros te hacemos todo el proceso por RD$45,000 (one-time). Incluye Viafirma, configuracion, los 15 examenes DGII y paso a produccion. Con garantia de 90 dias.',
                    'We run the whole process for RD$45,000 (one-time). Includes Viafirma, setup, the 15 DGII tests and production go-live. 90-day warranty.'
                  ),
                },
                {
                  q: L('Cuanto tiempo toma certificarse?', 'How long does certification take?'),
                  a: L(
                    '2–3 semanas desde que firmas hasta que estas emitiendo e-CF en produccion.',
                    '2–3 weeks from signing until you\'re issuing e-CF in production.'
                  ),
                },
                {
                  q: L('Que pasa si no me certifico antes del 15 de mayo?', 'What happens if I don\'t certify before May 15?'),
                  a: L(
                    'Tu RNC queda marcado como incumplidor. No podras emitir facturas con credito fiscal, lo que significa que tus clientes empresariales se van con la competencia que si emite e-CF.',
                    'Your RNC gets flagged as non-compliant. You won\'t be able to issue invoices with tax credit, which means your business clients switch to competitors who do issue e-CF.'
                  ),
                },
              ].map((item, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-6 hover:border-[#b3001e]/40 hover:bg-white/10 transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-[#b3001e]/20 flex items-center justify-center">
                      <FileText size={16} className="text-[#b3001e]" />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-bold text-white leading-snug">{item.q}</h4>
                      <p className="mt-2 text-sm text-white/60 leading-relaxed">{item.a}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* C) Reinforced CTA */}
          <div className="mt-16 rounded-3xl border border-[#b3001e]/40 bg-[#b3001e]/10 p-8 sm:p-12 text-center">
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
              {L('La Ley 32-23 es obligatoria. No esperes mas.', 'Law 32-23 is mandatory. Don\'t wait.')}
            </h3>
            <p className="mt-3 text-white/70 text-base max-w-2xl mx-auto">
              {L(
                'Ya certificamos nuestro propio negocio. Ahora te certificamos a ti, con garantia de 90 dias.',
                'We already certified our own business. Now we certify yours, with a 90-day warranty.'
              )}
            </p>
            <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20agendar%20mi%20certificaci%C3%B3n%20e-CF%20con%20Terminal%20X" target="_blank" rel="noopener noreferrer"
              className="mt-8 inline-flex items-center gap-2 bg-[#b3001e] hover:bg-[#d4002a] px-8 py-4 text-base font-bold text-white rounded-xl shadow-lg shadow-red-500/25 transition-colors">
              <MessageSquare size={18} />
              {L('Agenda tu certificacion e-CF', 'Schedule your e-CF certification')}
              <ArrowRight size={18} />
            </a>
          </div>
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

      {/* SECTION 9: Final CTA — BLACK — DeadlineCta with live countdown to May 15, 2026 */}
      <Suspense fallback={<LazySkeleton minH="420px" dark />}>
        <DeadlineCta lang={lang} />
      </Suspense>

      {/* Footer — BLACK */}
      <footer className="bg-black border-t border-white/10 px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Recursos row — Phase-1 SEO sprint (2026-05-18) commercial landing
              pages with keyword anchor text. EN keeps Spanish slugs since the
              pages are Spanish-only for now; falls back to /pricing. */}
          {lang !== 'en' && (
            <div className="border-b border-white/10 pb-10 mb-10">
              <p className="text-sm font-bold uppercase tracking-wider text-white/50 mb-4">Recursos</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Link to="/sistema-pos"                          className="text-sm text-white/70 hover:text-white transition-colors">Sistema POS para RD</Link>
                <Link to="/software-pos"                         className="text-sm text-white/70 hover:text-white transition-colors">Software POS DGII</Link>
                <Link to="/facturador-electronico-dgii"          className="text-sm text-white/70 hover:text-white transition-colors">Facturador electrónico DGII</Link>
                <Link to="/alternativa-facturador-gratuito-dgii" className="text-sm text-white/70 hover:text-white transition-colors">Alternativa al Facturador Gratuito DGII</Link>
                <Link to="/pricing"                              className="text-sm text-white/70 hover:text-white transition-colors">Precios POS RD 2026</Link>
              </div>
            </div>
          )}
          {/* Industrias row — internal linking + anchor-text SEO to vertical pages */}
          <div className="border-b border-white/10 pb-10 mb-10">
            <p className="text-sm font-bold uppercase tracking-wider text-white/50 mb-4">{L('Industrias que servimos en RD', 'Industries we serve in the Dominican Republic')}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(() => {
                const base = lang === 'en' ? '/en/industries/' : '/industrias/'
                const items = [
                  ['facturacion',   L('Facturación electrónica DGII',     'DGII e-invoicing')],
                  ['carwash',       L('POS para carwash',                  'Carwash POS')],
                  ['tiendas',       L('POS para tiendas y retail',         'Retail POS')],
                  ['restaurantes',  L('POS para restaurantes',             'Restaurant POS')],
                  ['mecanica',      L('POS para talleres y mecánica',      'Auto repair POS')],
                  ['salon',         L('POS para salones y barberías',      'Salon & barbershop POS')],
                  ['concesionario', L('POS para concesionarios',           'Auto dealership POS')],
                  ['prestamos',     L('Sistema de préstamos y empeños',    'Loans & pawnshop')],
                  ['servicios',     L('POS para servicios profesionales',  'Professional services POS')],
                  ['empresas',      L('Nómina TSS / INFOTEP / ISR',        'Payroll TSS / INFOTEP / ISR')],
                ]
                return items.map(([slug, label]) => (
                  <Link key={slug} to={`${base}${slug}`} className="text-sm text-white/70 hover:text-white transition-colors">{label}</Link>
                ))
              })()}
            </div>
          </div>
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
                <a href="#facturacion" className="block text-sm text-white/60 hover:text-white transition-colors">{L('Facturacion', 'Invoicing')}</a>
                <a href="#pricing" className="block text-sm text-white/60 hover:text-white transition-colors">{L('Planes', 'Plans')}</a>
                <a href="#certificacion" className="block text-sm text-white/60 hover:text-white transition-colors">{L('Certificacion', 'Certification')}</a>
                <Link to="/blog" className="block text-sm text-white/60 hover:text-white transition-colors">Blog</Link>
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
            <p className="text-[10px] text-white/55 mt-3">
              <a
                href="https://github.com/mikefromstudiox/terminal-x-releases/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white/70 transition-colors"
              >
                {L('Clientes existentes: descargar última versión de escritorio (Windows) — v2.17.8', 'Existing customers: download latest desktop build (Windows) — v2.17.8')}
              </a>
            </p>
          </div>
        </div>
      </footer>

      <button
        type="button"
        onClick={scrollToTop}
        aria-label={L('Subir al inicio', 'Scroll to top')}
        className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-[#b3001e] hover:bg-[#d4002a] text-white shadow-lg shadow-red-500/30 flex items-center justify-center transition-all duration-300 ${showScrollTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      >
        <ArrowUp size={20} strokeWidth={2.5} />
      </button>

      {/* Sticky mobile CTA — bottom-fixed bar (md:hidden) appears at scroll>800px */}
      <StickyMobileCta lang={lang} />

      {/* Exit-intent modal — fires once per session on desktop mouseleave */}
      <ExitIntentModal lang={lang} />
    </div>
  )
}
