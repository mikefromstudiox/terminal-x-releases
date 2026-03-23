import { useNavigate } from 'react-router-dom'
import { Monitor, Smartphone, Shield, Zap, BarChart3, Receipt, Users, ArrowRight, Check } from 'lucide-react'

const PLANS = [
  {
    name: 'Free', key: 'free', price: 'Gratis', sub: 'Para siempre',
    features: ['Punto de venta', 'Cola de espera', 'Clientes', '2 usuarios'],
    cta: 'Comenzar Gratis', highlight: false,
  },
  {
    name: 'Pro', key: 'pro', price: 'Contactar', sub: '',
    features: ['Todo en Free', 'Creditos', 'Reportes', 'Cuadre de caja', 'Caja chica', 'Notas de credito', '5 usuarios'],
    cta: 'Comenzar', highlight: false,
  },
  {
    name: 'Pro+', key: 'pro_plus', price: 'Contactar', sub: 'Mas popular',
    features: ['Todo en Pro', 'e-CF electronico', 'DGII / 606-607', 'Inventario', 'Comisiones', '15 usuarios'],
    cta: 'Comenzar', highlight: true,
  },
  {
    name: 'Pro Max', key: 'pro_max', price: 'Contactar', sub: 'Para empresas',
    features: ['Todo en Pro+', 'Dashboard remoto', 'WhatsApp recibos', 'Multi-sucursal', 'Usuarios ilimitados', 'Soporte prioritario'],
    cta: 'Contactar', highlight: false,
  },
]

const FEATURES = [
  { icon: Receipt, title: 'Facturacion e-CF', desc: 'Comprobantes electronicos con QR, 100% Ley 32-23' },
  { icon: Monitor, title: 'Desktop + Web + Movil', desc: 'Usa desde Windows, navegador o celular' },
  { icon: Shield, title: 'DGII integrado', desc: '606, 607, RNC lookup automatico' },
  { icon: Zap, title: 'Rapido y offline', desc: 'Funciona sin internet, sincroniza cuando conecta' },
  { icon: BarChart3, title: 'Reportes completos', desc: 'Ventas diarias, mensuales, comisiones, cuadre' },
  { icon: Users, title: 'Multi-usuario', desc: 'Roles: dueno, gerente, cajero, contador' },
]

export default function LandingPage({ section }) {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black tracking-[3px]">TERMINAL</span>
          <span className="text-xl font-black text-sky-400">X</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#pricing" className="text-sm text-slate-400 hover:text-white transition-colors">Planes</a>
          <button onClick={() => navigate('/pos')}
            className="px-4 py-2 text-sm font-semibold bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors">
            Iniciar Sesion
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 md:px-12 py-20 md:py-32 text-center max-w-4xl mx-auto">
        <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6">
          El POS #1 para negocios en <span className="text-sky-400">Republica Dominicana</span>
        </h1>
        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-8">
          Facturacion electronica, reportes DGII, comisiones, inventario — todo en una app rapida y facil de usar.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => navigate('/signup?plan=free')}
            className="px-8 py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-lg transition-colors">
            Comenzar Gratis
          </button>
          <a href="https://wa.me/18098282971" target="_blank" rel="noopener noreferrer"
            className="px-8 py-3 border border-slate-600 hover:border-slate-400 text-slate-300 font-semibold rounded-xl text-lg transition-colors">
            WhatsApp
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 md:px-12 py-16 bg-slate-900/50">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">Todo lo que necesitas</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {FEATURES.map((f, i) => (
            <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
              <div className="w-10 h-10 bg-sky-600/20 rounded-xl flex items-center justify-center mb-4">
                <f.icon size={20} className="text-sky-400" />
              </div>
              <h3 className="text-[15px] font-bold mb-1">{f.title}</h3>
              <p className="text-[13px] text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 md:px-12 py-20">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">Planes</h2>
        <p className="text-slate-400 text-center mb-12 text-sm">Empieza gratis. Actualiza cuando quieras.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 max-w-6xl mx-auto">
          {PLANS.map(plan => (
            <div key={plan.key}
              className={`rounded-2xl p-6 border flex flex-col ${
                plan.highlight
                  ? 'bg-sky-600/10 border-sky-500 ring-2 ring-sky-500/30'
                  : 'bg-slate-800/50 border-slate-700'
              }`}>
              {plan.sub && <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 mb-2">{plan.sub}</span>}
              <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
              <p className="text-2xl font-black mb-4">{plan.price}</p>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-slate-300">
                    <Check size={14} className="text-sky-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate(`/signup?plan=${plan.key}`)}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${
                  plan.highlight
                    ? 'bg-sky-600 hover:bg-sky-500 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}>
                {plan.cta} <ArrowRight size={14} className="inline ml-1" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 md:px-12 py-8 border-t border-slate-800 text-center">
        <p className="text-sm text-slate-500">Terminal X by Studio X Tech — Santiago, RD</p>
        <p className="text-xs text-slate-600 mt-1">WhatsApp: +1 (809) 828-2971</p>
      </footer>
    </div>
  )
}
