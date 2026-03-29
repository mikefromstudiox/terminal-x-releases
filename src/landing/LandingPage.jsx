import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Monitor, Shield, Zap, BarChart3, Receipt, Users, ArrowRight, Check, X, Wifi, WifiOff, Printer, MessageSquare, ChevronDown, ChevronUp, Clock, CreditCard, FileText, Lock, Smartphone, Star, TrendingUp, Headphones, Menu, ExternalLink } from 'lucide-react'
import logoImg from '../assets/logo.png'

const PLANS = [
  {
    name: 'Pro', key: 'pro', price: 'RD$2,490', annual: 'RD$2,117/mes facturado anual (15% OFF)',
    sub: '/mes',
    desc: 'Ideal para negocios pequenos',
    users: '2 usuarios',
    features: [
      'POS completo + cobrar + imprimir',
      'Directorio de clientes',
      'NCF B01/B02 (papel)',
      'Reportes diario y mensual',
      'Cuadre de Caja + Caja Chica',
      'Actualizaciones automaticas',
    ],
    support: 'Autoservicio — tu configuras todo',
    cta: 'Comenzar con Pro', highlight: false,
  },
  {
    name: 'Pro PLUS', key: 'pro_plus', price: 'RD$4,490', annual: 'RD$3,817/mes facturado anual (15% OFF)',
    sub: '/mes',
    badge: 'Mas popular',
    desc: 'Para negocios que quieren crecer',
    users: '5 usuarios',
    features: [
      'Todo en Pro, mas:',
      'Creditos + Notas de Credito',
      'Inventario con alertas de stock',
      'Comisiones por empleado/vendedor/cajera',
      'e-CF electronico directo DGII',
      'Reportes avanzados + Nomina Ley 16-92',
      'Soporte WhatsApp horario laboral',
      'Configuracion remota por nuestro equipo',
    ],
    support: 'Nuestro equipo te configura todo remoto',
    cta: 'Comenzar con Pro PLUS', highlight: true,
  },
  {
    name: 'Pro MAX', key: 'pro_max', price: 'RD$6,990', annual: 'RD$5,942/mes facturado anual (15% OFF)',
    sub: '/mes',
    desc: 'Para cadenas y alto volumen',
    users: 'Usuarios ilimitados',
    features: [
      'Todo en Pro PLUS, mas:',
      'Recibos por WhatsApp automatico',
      'Dashboard Remoto en tiempo real',
      'Cuenta dedicada con tu ejecutivo',
      'Visita tecnica mensual a tu negocio',
      'Onboarding el mismo dia',
      'Soporte WhatsApp prioritario',
    ],
    support: 'Soporte prioritario + ejecutivo dedicado',
    cta: 'Comenzar con Pro MAX', highlight: false,
  },
]

const FEATURES = [
  { icon: Receipt, title: 'e-CF Directo con DGII', desc: 'Facturacion electronica sin intermediarios. Los 10 tipos de e-CF con QR code. 100% Ley 32-23. Sin PSFE, sin costos ocultos.' },
  { icon: Monitor, title: 'Desktop + Web + Movil', desc: 'App nativa para Windows, web PWA para cualquier navegador y celular. Una sola cuenta, todas las plataformas.' },
  { icon: WifiOff, title: '100% Offline', desc: 'Funciona sin internet. Cola inteligente con reintento automatico 72 horas. Se sincroniza cuando vuelve la conexion.' },
  { icon: BarChart3, title: 'Reportes + Comisiones', desc: 'Ventas diarias, mensuales, por vendedor. Comisiones automaticas por empleado/vendedor/cajera. Nomina Ley 16-92.' },
  { icon: Shield, title: 'DGII Integrado', desc: 'Reportes 606, 607. RNC lookup automatico con 900,000+ registros. NCF B01/B02 + todos los e-CF.' },
  { icon: Users, title: 'Multi-usuario + Roles', desc: '5 niveles de acceso: dueno, gerente, CFO, contador, cajero. Cada rol ve solo lo que necesita.' },
  { icon: Printer, title: 'Impresion Termica', desc: 'Impresora 80mm con cajon de dinero integrado. Facturas con NCF/e-CF, QR code, conduce de servicio.' },
  { icon: Headphones, title: 'Soporte Humano', desc: 'Nuestro equipo configura tu sistema remotamente. No tienes que ser experto en tecnologia.' },
  { icon: CreditCard, title: 'Creditos + Cobros', desc: 'Clientes a credito, pagos parciales, notas de credito. Control total de cuentas por cobrar.' },
]

const COMPARISON = [
  { feature: 'Facturacion directa DGII (sin intermediario)', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'Todos los 10 tipos de e-CF + RFCE', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'QR code en facturas electronicas', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'Modo offline real (72 horas)', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'App Desktop nativa + Web/PWA', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'Cola de servicio en tiempo real', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'Nomina Ley 16-92 + liquidacion', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'Comisiones por empleado/vendedor/cajero', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'Impresora termica + cajon', tx: true, alegra: true, wil: true, otros: false },
  { feature: 'Configuracion remota por nuestro equipo', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'Visitas tecnicas a tu negocio', tx: true, alegra: false, wil: false, otros: false },
  { feature: 'Actualizaciones automaticas', tx: true, alegra: true, wil: false, otros: false },
  { feature: 'Precio menor a RD$5,000/mes', tx: true, alegra: false, wil: true, otros: true },
]

const FAQ = [
  { q: 'Puedo cambiar de plan en cualquier momento?', a: 'Si, puedes subir o bajar de plan en cualquier momento desde el panel de administracion. El cambio se aplica inmediatamente.' },
  { q: 'Hay contrato anual obligatorio?', a: 'No. Puedes pagar mes a mes sin compromiso. El plan anual tiene 15% de descuento pero no es obligatorio.' },
  { q: 'Que pasa si me quedo sin internet?', a: 'Todo sigue funcionando 100% offline. Puedes cobrar, imprimir facturas, ver reportes. Se sincroniza automaticamente cuando vuelve la conexion (hasta 72 horas de cola).' },
  { q: 'Necesito comprar impresora especial?', a: 'Terminal X funciona con cualquier impresora termica de 80mm con conexion USB. Nosotros podemos recomendarte e instalarte la impresora y el cajon de dinero.' },
  { q: 'Que es e-CF y por que lo necesito?', a: 'e-CF (Comprobante Fiscal Electronico) es el nuevo formato obligatorio de la DGII bajo la Ley 32-23. Todos los negocios deben migrar antes de mayo 2026. Terminal X es el unico POS que se conecta directo a la DGII, sin intermediarios ni costos adicionales.' },
  { q: 'Funciona para mi tipo de negocio?', a: 'Si. Terminal X sirve para cualquier negocio de servicios en RD: Car Wash, talleres mecanicos, barber shops, dealers, tiendas, colmados, y mas. El sistema se adapta a tus servicios y productos.' },
  { q: 'Como funciona el soporte?', a: 'Pro: autoservicio con guias. Pro PLUS: nuestro equipo te configura todo remotamente y soporte por WhatsApp en horario laboral. Pro MAX: ejecutivo dedicado + soporte prioritario + visita tecnica mensual.' },
  { q: 'Puedo importar datos de mi sistema anterior?', a: 'Si. Nuestro equipo puede importar tu historial de ventas, clientes y productos desde Starsisa, WilPOS u otros sistemas.' },
]

const STATS = [
  { value: '10', label: 'tipos de e-CF' },
  { value: '900K+', label: 'RNCs integrados' },
  { value: '72h', label: 'modo offline' },
  { value: '100%', label: 'Ley 32-23' },
]

const ECOSYSTEM = [
  { name: 'STUDIO X', sub: 'Hub', url: 'https://studioxrd.com' },
  { name: 'TECH', sub: 'X', url: 'https://studioxrdtech.com' },
  { name: 'TERMINAL', sub: 'X POS', url: 'https://terminalxpos.com', active: true },
  { name: 'MEDIA', sub: 'X', url: 'https://studioxmedia.io' },
  { name: 'DETAILING', sub: 'X', url: 'https://studioxdetailing.com' },
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
        {open ? <ChevronUp size={18} className="text-gray-400 shrink-0" /> : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
      </button>
      {open && <p className="px-6 pb-5 text-sm text-gray-500 leading-relaxed">{a}</p>}
    </div>
  )
}

export default function LandingPage({ section }) {
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navLinks = [
    { label: 'Funciones', href: '#features' },
    { label: 'Planes', href: '#pricing' },
    { label: 'Comparar', href: '#compare' },
    { label: 'FAQ', href: '#faq' },
  ]

  return (
    <div className="min-h-screen bg-white">
      {/* Header — sticky black, h-[120px] */}
      <nav className="h-[120px] bg-black sticky top-0 z-50 border-b border-white/10">
        <div className="max-w-7xl mx-auto h-full flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-0">
            <span className="text-2xl font-black tracking-[3px] text-white leading-none -mt-0.5">TERMINAL</span>
            <img src={logoImg} alt="X" className="h-10 w-auto object-contain" draggable="false" />
          </div>
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map(link => (
              <a key={link.href} href={link.href} className="text-sm font-medium text-white/70 hover:text-[#b3001e] transition-colors">{link.label}</a>
            ))}
            <button onClick={() => navigate('/pos')} className="bg-[#b3001e] hover:bg-[#d4002a] rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors shadow-lg shadow-red-500/25">
              Iniciar Sesion
            </button>
          </div>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden text-white/70 hover:text-white">
            <Menu size={24} />
          </button>
        </div>
        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-black border-t border-white/10 px-4 pb-4">
            {navLinks.map(link => (
              <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className="block py-3 text-sm font-medium text-white/70 hover:text-[#b3001e] transition-colors">{link.label}</a>
            ))}
            <button onClick={() => { setMobileMenuOpen(false); navigate('/pos') }} className="mt-2 w-full bg-[#b3001e] hover:bg-[#d4002a] rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors">
              Iniciar Sesion
            </button>
          </div>
        )}
      </nav>

      {/* SECTION 1: Hero — WHITE */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">El unico POS en RD con e-CF directo DGII</p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">
            El sistema POS mas completo de <span className="text-[#b3001e]">Republica Dominicana</span>
          </h1>
          <p className="mt-4 text-lg text-gray-500 max-w-2xl mx-auto">
            Facturacion electronica directa con DGII. Desktop + Web + Movil. Modo offline.
            Nuestro equipo configura todo por ti.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Car Wash, talleres, barber shops, dealers, tiendas — cualquier negocio de servicios en RD.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap mt-10">
            <button onClick={() => navigate('/signup?plan=pro_plus')}
              className="bg-[#b3001e] hover:bg-[#d4002a] px-6 py-3 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-red-500/25">
              Empezar gratis <ArrowRight size={16} className="inline ml-1" />
            </button>
            <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20informacion%20sobre%20Terminal%20X" target="_blank" rel="noopener noreferrer"
              className="border border-gray-300 text-gray-700 hover:border-gray-400 hover:shadow-lg px-6 py-3 text-sm font-bold rounded-lg transition-all">
              Hablar con ventas
            </a>
          </div>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl mx-auto mt-16">
            {STATS.map((s, i) => (
              <div key={i} className="text-center">
                <p className="text-3xl sm:text-4xl font-extrabold text-[#b3001e]">{s.value}</p>
                <p className="text-sm text-gray-500 font-medium mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 2: How it works — BLACK */}
      <section className="bg-black px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">Rapido y facil</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">Como funciona</h2>
            <p className="mt-4 text-lg text-white/50">En 3 pasos estas operando</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto mt-16">
            {[
              { step: '1', title: 'Registrate', desc: 'Crea tu cuenta en 2 minutos. Sin tarjeta de credito. Sin compromiso.' },
              { step: '2', title: 'Nosotros configuramos', desc: 'Nuestro equipo configura tu negocio, servicios, impresora y facturacion remotamente.' },
              { step: '3', title: 'Empieza a cobrar', desc: 'Crea tickets, cobra, imprime facturas con NCF/e-CF y ve tus reportes al instante.' },
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
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">Funciones</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">Todo lo que necesitas en un solo sistema</h2>
            <p className="mt-4 text-lg text-gray-500 max-w-2xl mx-auto">Terminal X es el unico POS en RD que combina facturacion electronica directa con DGII, modo offline 100% y herramientas completas para negocios de servicios.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            {FEATURES.map((f, i) => (
              <div key={i} className="rounded-2xl border border-gray-100 bg-gray-50 p-8 transition-all hover:-translate-y-2 hover:shadow-2xl">
                <div className="w-12 h-12 bg-[#b3001e]/10 rounded-xl flex items-center justify-center mb-5">
                  <f.icon size={22} className="text-[#b3001e]" />
                </div>
                <h3 className="text-base font-bold text-black mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 4: Pricing — BLACK */}
      <section id="pricing" className="bg-black px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">Planes</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">Planes y Precios</h2>
            <p className="mt-4 text-lg text-white/50">Elige el plan ideal para tu negocio. Sin contrato. Cancela cuando quieras.</p>
            <p className="mt-2 text-sm font-semibold text-[#b3001e]">Todos los planes incluyen impresora termica, cajon de dinero y actualizaciones.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mt-16">
            {PLANS.map(plan => (
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
                    <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                      <Check size={14} className="text-[#b3001e] shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
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
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">Soporte</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">Nivel de soporte por plan</h2>
            <p className="mt-4 text-lg text-gray-500">No solo vendemos software. Te acompanamos.</p>
          </div>
          <div className="max-w-4xl mx-auto overflow-x-auto mt-12">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-4 font-bold text-black">Soporte</th>
                  <th className="py-3 px-3 text-center font-bold text-gray-600">Pro</th>
                  <th className="py-3 px-3 text-center font-bold text-[#b3001e]">Pro PLUS</th>
                  <th className="py-3 px-3 text-center font-bold text-gray-600">Pro MAX</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {[
                  { s: 'Configuracion inicial del negocio', pro: 'Tu mismo', plus: 'Nuestro equipo', max: 'Mismo dia' },
                  { s: 'Acceso admin a tu cuenta (read-only)', pro: true, plus: true, max: true },
                  { s: 'Configuracion remota por admin', pro: false, plus: true, max: true },
                  { s: 'Soporte WhatsApp', pro: false, plus: 'Horario laboral', max: 'Prioritario' },
                  { s: 'Visitas tecnicas a tu negocio', pro: 'Pago extra', plus: '1 por trimestre', max: '1 por mes' },
                  { s: 'Ejecutivo de cuenta dedicado', pro: false, plus: false, max: true },
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
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">Comparacion</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">Por que Terminal X?</h2>
            <p className="mt-4 text-lg text-white/50">Comparado con Alegra, WilPOS, Facturador y otros sistemas POS en RD.</p>
          </div>
          <div className="max-w-4xl mx-auto overflow-x-auto mt-12">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-white/20">
                  <th className="text-left py-3 px-4 font-bold text-white">Caracteristica</th>
                  <th className="py-3 px-3 font-bold text-[#b3001e] text-center">Terminal X</th>
                  <th className="py-3 px-3 font-medium text-white/40 text-center">Alegra</th>
                  <th className="py-3 px-3 font-medium text-white/40 text-center">WilPOS</th>
                  <th className="py-3 px-3 font-medium text-white/40 text-center">Otros</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
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
            Terminal X: el mas completo, el mas moderno, y el mejor precio del mercado dominicano.
          </p>
        </div>
      </section>

      {/* SECTION 7: FAQ — WHITE */}
      <section id="faq" className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">FAQ</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">Preguntas Frecuentes</h2>
          </div>
          <div className="max-w-2xl mx-auto space-y-3 mt-12">
            {FAQ.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 8: Ecosystem — BLACK */}
      <section className="bg-black px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">Ecosistema</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-white">Parte de Studio X</h2>
            <p className="mt-4 text-lg text-white/50">Un grupo de empresas interconectadas en Republica Dominicana.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 max-w-4xl mx-auto mt-12">
            {ECOSYSTEM.map((brand, i) => (
              <a key={i} href={brand.url} target="_blank" rel="noopener noreferrer"
                className={`rounded-2xl border p-6 text-center transition-all ${
                  brand.active
                    ? 'border-[#b3001e] bg-[#b3001e]/10'
                    : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                }`}>
                <div className="flex items-center justify-center gap-1 mb-2">
                  <span className="text-base font-black tracking-[2px] text-white">{brand.name}</span>
                  <img src={logoImg} alt="X" className="h-5 w-auto object-contain" />
                </div>
                <p className="text-xs text-white/50">{brand.sub}</p>
                <ExternalLink size={12} className="text-white/30 mx-auto mt-2" />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 9: Final CTA — WHITE */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-[4px] text-[#b3001e]">Empieza hoy</p>
          <h2 className="mt-3 text-4xl sm:text-5xl font-extrabold text-black">Listo para modernizar tu negocio?</h2>
          <p className="mt-4 text-lg text-gray-500 max-w-lg mx-auto">Facturacion electronica directa con DGII, sin intermediarios. El unico POS en RD con e-CF directo, modo offline y configuracion remota.</p>
          <p className="mt-3 text-[#b3001e] font-bold text-lg">Desde RD$2,490/mes. Sin contrato. Sin sorpresas.</p>
          <div className="flex items-center justify-center gap-4 flex-wrap mt-10">
            <button onClick={() => navigate('/signup?plan=pro_plus')}
              className="bg-[#b3001e] hover:bg-[#d4002a] px-6 py-3 text-sm font-bold text-white rounded-lg transition-colors shadow-lg shadow-red-500/25">
              Empezar ahora <ArrowRight size={16} className="inline ml-1" />
            </button>
            <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20informacion%20sobre%20Terminal%20X" target="_blank" rel="noopener noreferrer"
              className="border border-gray-300 text-gray-700 hover:border-gray-400 hover:shadow-lg px-6 py-3 text-sm font-bold rounded-lg transition-all">
              Hablar por WhatsApp
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
                <span className="text-2xl font-black tracking-[3px] text-white leading-none -mt-0.5">TERMINAL</span>
                <img src={logoImg} alt="X" className="h-10 w-auto object-contain" draggable="false" />
              </div>
              <p className="text-sm text-white/40">Part of Studio X</p>
              <p className="text-xs text-white/30 mt-1">Santo Domingo, Republica Dominicana</p>
            </div>
            {/* Product */}
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-white/50 mb-4">Producto</p>
              <div className="space-y-2">
                <a href="#features" className="block text-sm text-white/40 hover:text-white transition-colors">Funciones</a>
                <a href="#pricing" className="block text-sm text-white/40 hover:text-white transition-colors">Planes</a>
                <a href="#compare" className="block text-sm text-white/40 hover:text-white transition-colors">Comparar</a>
                <a href="#faq" className="block text-sm text-white/40 hover:text-white transition-colors">FAQ</a>
              </div>
            </div>
            {/* Company */}
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-white/50 mb-4">Empresa</p>
              <div className="space-y-2">
                <a href="https://studioxrd.com" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/40 hover:text-white transition-colors">Studio X Group</a>
                <a href="https://studioxmedia.io" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/40 hover:text-white transition-colors">Studio X Media</a>
                <a href="https://studioxrdtech.com" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/40 hover:text-white transition-colors">Studio X Tech</a>
                <a href="https://studioxdetailing.com" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/40 hover:text-white transition-colors">Studio X Detailing</a>
              </div>
            </div>
            {/* Contact */}
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-white/50 mb-4">Contacto</p>
              <div className="space-y-2">
                <a href="https://wa.me/18098282971" target="_blank" rel="noopener noreferrer" className="block text-sm text-white/40 hover:text-white transition-colors">WhatsApp: +1 (809) 828-2971</a>
                <a href="mailto:info@studioxmedia.io" className="block text-sm text-white/40 hover:text-white transition-colors">info@studioxmedia.io</a>
                <a href="https://terminalxpos.com" className="block text-sm text-white/40 hover:text-white transition-colors">terminalxpos.com</a>
              </div>
            </div>
          </div>
          <div className="border-t border-white/10 mt-12 pt-8 text-center">
            <p className="text-xs text-white/30">&copy; {new Date().getFullYear()} Terminal X SRL. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
