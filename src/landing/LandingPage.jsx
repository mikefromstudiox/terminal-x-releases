import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Monitor, Shield, Zap, BarChart3, Receipt, Users, ArrowRight, Check, X, Wifi, WifiOff, Printer, MessageSquare, ChevronDown, ChevronUp, Clock, CreditCard, FileText, Lock, Smartphone, Star, TrendingUp, Headphones } from 'lucide-react'
import xMark from '../assets/x-mark.png'

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

function CheckIcon() { return <Check size={16} className="text-[#b3001e] mx-auto" /> }
function XIcon() { return <X size={16} className="text-white/20 mx-auto" /> }
function XIconLight() { return <X size={16} className="text-slate-300 mx-auto" /> }

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/5 transition-colors">
        <span className="font-bold text-[14px] text-white pr-4">{q}</span>
        {open ? <ChevronUp size={18} className="text-slate-400 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
      </button>
      {open && <p className="px-5 pb-4 text-[13px] text-slate-400 leading-relaxed">{a}</p>}
    </div>
  )
}

export default function LandingPage({ section }) {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-4 bg-black sticky top-0 z-50">
        <div className="flex items-center gap-1">
          <span className="text-2xl md:text-3xl font-black text-white tracking-[3px]">TERMINAL</span>
          <img src={xMark} alt="X" className="h-20 md:h-28 w-20 md:w-28 object-contain mt-1" />
        </div>
        <div className="flex items-center gap-4">
          <a href="#features" className="text-sm text-white/60 hover:text-white transition-colors hidden md:block">Funciones</a>
          <a href="#pricing" className="text-sm text-white/60 hover:text-white transition-colors hidden md:block">Planes</a>
          <a href="#compare" className="text-sm text-white/60 hover:text-white transition-colors hidden md:block">Comparar</a>
          <a href="#faq" className="text-sm text-white/60 hover:text-white transition-colors hidden md:block">FAQ</a>
          <button onClick={() => navigate('/pos')}
            className="px-4 py-2 text-sm font-semibold bg-[#b3001e] hover:bg-[#8c0017] text-white rounded-lg transition-colors">
            Iniciar Sesion
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 md:px-12 py-20 md:py-28 text-center max-w-4xl mx-auto">
        <div className="inline-block mb-6 px-4 py-1.5 bg-black text-white text-xs font-bold rounded-full tracking-wide">
          EL UNICO POS EN RD CON e-CF DIRECTO DGII — SIN INTERMEDIARIOS
        </div>
        <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6">
          El sistema POS mas completo de <span className="text-[#b3001e]">Republica Dominicana</span>
        </h1>
        <p className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto mb-4">
          Facturacion electronica directa con DGII. Desktop + Web + Movil. Modo offline.
          Nuestro equipo configura todo por ti.
        </p>
        <p className="text-sm text-slate-400 mb-10">
          Car Wash, talleres, barber shops, dealers, tiendas — cualquier negocio de servicios en RD.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap mb-12">
          <button onClick={() => navigate('/signup?plan=pro_plus')}
            className="px-8 py-3.5 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold rounded-xl text-lg transition-colors shadow-lg shadow-[#b3001e]/25">
            Empezar gratis <ArrowRight size={18} className="inline ml-1" />
          </button>
          <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20informacion%20sobre%20Terminal%20X" target="_blank" rel="noopener noreferrer"
            className="px-8 py-3.5 border-2 border-slate-300 hover:border-slate-500 text-slate-600 font-semibold rounded-xl text-lg transition-colors">
            Hablar con ventas
          </a>
        </div>
        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl mx-auto">
          {STATS.map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-3xl md:text-4xl font-black text-[#b3001e]">{s.value}</p>
              <p className="text-xs text-slate-400 font-medium mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust bar */}
      <section className="px-6 md:px-12 py-6 bg-slate-50 border-y border-slate-200">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-6 md:gap-10 text-sm text-slate-600">
          {[
            { icon: Receipt, text: 'e-CF directo DGII' },
            { icon: WifiOff, text: 'Offline ilimitado' },
            { icon: Monitor, text: 'Desktop + Web + Movil' },
            { icon: Printer, text: 'Impresora termica 80mm' },
            { icon: Lock, text: 'Datos seguros locales' },
          ].map(({ icon: Icon, text }, i) => (
            <div key={i} className="flex items-center gap-2">
              <Icon size={16} className="text-[#b3001e]" />
              <span className="font-medium">{text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 md:px-12 py-16 bg-black text-white">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">Como funciona</h2>
        <p className="text-slate-400 text-center mb-12 text-sm">En 3 pasos estas operando</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          {[
            { step: '1', title: 'Registrate', desc: 'Crea tu cuenta en 2 minutos. Sin tarjeta de credito. Sin compromiso.' },
            { step: '2', title: 'Nosotros configuramos', desc: 'Nuestro equipo configura tu negocio, servicios, impresora y facturacion remotamente.' },
            { step: '3', title: 'Empieza a cobrar', desc: 'Crea tickets, cobra, imprime facturas con NCF/e-CF y ve tus reportes al instante.' },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <div className="w-14 h-14 bg-[#b3001e] text-white text-2xl font-black rounded-2xl flex items-center justify-center mx-auto mb-4">
                {s.step}
              </div>
              <h3 className="text-[16px] font-bold mb-2">{s.title}</h3>
              <p className="text-[13px] text-slate-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 md:px-12 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">Todo lo que necesitas en un solo sistema</h2>
        <p className="text-slate-500 text-center mb-12 text-sm max-w-lg mx-auto">Terminal X es el unico POS en RD que combina facturacion electronica directa con DGII, modo offline 100% y herramientas completas para negocios de servicios.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {FEATURES.map((f, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="w-10 h-10 bg-[#b3001e]/10 rounded-xl flex items-center justify-center mb-4">
                <f.icon size={20} className="text-[#b3001e]" />
              </div>
              <h3 className="text-[15px] font-bold text-slate-800 mb-2">{f.title}</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 md:px-12 py-20 bg-black text-white">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">Planes y Precios</h2>
        <p className="text-slate-400 text-center mb-3 text-sm">Elige el plan ideal para tu negocio. Sin contrato. Cancela cuando quieras.</p>
        <p className="text-[#b3001e] text-center mb-12 text-sm font-semibold">Todos los planes incluyen impresora termica, cajon de dinero y actualizaciones.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {PLANS.map(plan => (
            <div key={plan.key}
              className={`rounded-2xl p-6 border flex flex-col ${
                plan.highlight
                  ? 'bg-white/10 border-[#b3001e] ring-2 ring-[#b3001e]/30 relative scale-[1.02]'
                  : 'bg-white/5 border-white/10'
              }`}>
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#b3001e] text-white text-[10px] font-bold rounded-full uppercase tracking-wider whitespace-nowrap">
                  {plan.badge}
                </div>
              )}
              <h3 className="text-xl font-bold mb-0.5">{plan.name}</h3>
              <p className="text-[12px] text-slate-400 mb-3">{plan.desc}</p>
              <p className="text-3xl font-black mb-0.5">{plan.price}<span className="text-sm font-normal text-slate-400">{plan.sub}</span></p>
              <p className="text-[11px] text-slate-500 mb-1">{plan.annual}</p>
              <p className="text-[11px] font-semibold text-[#b3001e] mb-5">{plan.users}</p>
              <ul className="space-y-2.5 mb-4 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-slate-300">
                    <Check size={14} className="text-[#b3001e] shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className={`rounded-lg px-3 py-2 mb-4 text-[11px] font-semibold ${plan.highlight ? 'bg-[#b3001e]/20 text-[#b3001e]' : 'bg-white/5 text-slate-400'}`}>
                <Headphones size={12} className="inline mr-1.5" />
                {plan.support}
              </div>
              <button onClick={() => navigate(`/signup?plan=${plan.key}`)}
                className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${
                  plan.highlight
                    ? 'bg-[#b3001e] hover:bg-[#8c0017] text-white shadow-lg shadow-[#b3001e]/25'
                    : 'bg-white hover:bg-slate-100 text-black'
                }`}>
                {plan.cta} <ArrowRight size={14} className="inline ml-1" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Support tiers breakdown */}
      <section className="px-6 md:px-12 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">Nivel de soporte por plan</h2>
        <p className="text-slate-500 text-center mb-10 text-sm">No solo vendemos software. Te acompanamos.</p>
        <div className="max-w-4xl mx-auto overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="text-left py-3 px-4 font-bold text-slate-700">Soporte</th>
                <th className="py-3 px-3 text-center font-bold text-slate-600">Pro</th>
                <th className="py-3 px-3 text-center font-bold text-[#b3001e]">Pro PLUS</th>
                <th className="py-3 px-3 text-center font-bold text-slate-600">Pro MAX</th>
              </tr>
            </thead>
            <tbody className="text-[13px]">
              {[
                { s: 'Configuracion inicial del negocio', pro: 'Tu mismo', plus: 'Nuestro equipo', max: 'Mismo dia' },
                { s: 'Acceso admin a tu cuenta (read-only)', pro: true, plus: true, max: true },
                { s: 'Configuracion remota por admin', pro: false, plus: true, max: true },
                { s: 'Soporte WhatsApp', pro: false, plus: 'Horario laboral', max: 'Prioritario' },
                { s: 'Visitas tecnicas a tu negocio', pro: 'Pago extra', plus: '1 por trimestre', max: '1 por mes' },
                { s: 'Ejecutivo de cuenta dedicado', pro: false, plus: false, max: true },
              ].map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : ''}>
                  <td className="py-3 px-4 font-medium text-slate-700">{row.s}</td>
                  {['pro', 'plus', 'max'].map(col => {
                    const v = row[col]
                    return (
                      <td key={col} className="py-3 px-3 text-center">
                        {v === true ? <Check size={16} className="text-[#b3001e] mx-auto" /> :
                         v === false ? <X size={16} className="text-slate-300 mx-auto" /> :
                         <span className="text-slate-600 font-medium">{v}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Comparison table */}
      <section id="compare" className="px-6 md:px-12 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">Por que Terminal X?</h2>
        <p className="text-slate-500 text-center mb-10 text-sm">Comparado con Alegra, WilPOS, Facturador y otros sistemas POS en RD.</p>
        <div className="max-w-4xl mx-auto overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="text-left py-3 px-4 font-bold text-slate-700">Caracteristica</th>
                <th className="py-3 px-3 font-bold text-[#b3001e] text-center">Terminal X</th>
                <th className="py-3 px-3 font-medium text-slate-400 text-center">Alegra</th>
                <th className="py-3 px-3 font-medium text-slate-400 text-center">WilPOS</th>
                <th className="py-3 px-3 font-medium text-slate-400 text-center">Otros</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                  <td className="py-3 px-4 text-slate-700 font-medium">{row.feature}</td>
                  <td className="py-3 px-3 text-center">{row.tx ? <CheckIcon /> : <XIconLight />}</td>
                  <td className="py-3 px-3 text-center">{row.alegra ? <CheckIcon /> : <XIconLight />}</td>
                  <td className="py-3 px-3 text-center">{row.wil ? <CheckIcon /> : <XIconLight />}</td>
                  <td className="py-3 px-3 text-center">{row.otros ? <CheckIcon /> : <XIconLight />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-center mt-8 text-sm text-slate-500 font-semibold">
          Terminal X: el mas completo, el mas moderno, y el mejor precio del mercado dominicano.
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-6 md:px-12 py-16 bg-black text-white">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">Preguntas Frecuentes</h2>
        <div className="max-w-2xl mx-auto space-y-3">
          {FAQ.map((item, i) => (
            <FaqItem key={i} q={item.q} a={item.a} />
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-6 md:px-12 py-20 text-center">
        <h2 className="text-2xl md:text-4xl font-black mb-4">Listo para modernizar tu negocio?</h2>
        <p className="text-slate-500 mb-4 text-sm max-w-lg mx-auto">Facturacion electronica directa con DGII, sin intermediarios. El unico POS en RD con e-CF directo, modo offline y configuracion remota.</p>
        <p className="text-[#b3001e] font-bold text-lg mb-8">Desde RD$2,490/mes. Sin contrato. Sin sorpresas.</p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <button onClick={() => navigate('/signup?plan=pro_plus')}
            className="px-10 py-4 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold rounded-xl text-lg transition-colors shadow-lg shadow-[#b3001e]/25">
            Empezar ahora <ArrowRight size={18} className="inline ml-1" />
          </button>
          <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20informacion%20sobre%20Terminal%20X" target="_blank" rel="noopener noreferrer"
            className="px-10 py-4 border-2 border-slate-300 hover:border-slate-500 text-slate-600 font-semibold rounded-xl text-lg transition-colors">
            Hablar por WhatsApp
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 md:px-12 py-10 border-t border-slate-200">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-center md:text-left">
            <p className="text-sm font-bold text-slate-700">Terminal X by Studio X Tech</p>
            <p className="text-xs text-slate-400 mt-1">Santo Domingo, Republica Dominicana</p>
          </div>
          <div className="text-center md:text-right">
            <p className="text-xs text-slate-400">WhatsApp: +1 (809) 828-2971</p>
            <p className="text-xs text-slate-400">info@studioxmedia.io | terminalxpos.com</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
