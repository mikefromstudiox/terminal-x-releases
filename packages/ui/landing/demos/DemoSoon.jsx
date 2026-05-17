// /probar/:vertical placeholder for verticals whose interactive demo isn't
// shipped yet. Routes to WhatsApp for a guided walk-through with the team.

import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, MessageCircle, Sparkles, ArrowRight } from 'lucide-react'

const VERTICAL_LABELS = {
  retail:        'Tienda / Retail',
  licoreria:     'Licoreria',
  carniceria:    'Carniceria',
  service:       'Servicios',
  restaurant:    'Restaurante',
  mechanic:      'Mecanica / Taller',
  salon:         'Salon / Barbershop',
  prestamos:     'Prestamos / Empenos',
  dealership:    'Concesionario',
  hybrid:        'Hibrido (POS + Restaurant)',
}

export default function DemoSoon() {
  const { vertical } = useParams()
  const navigate = useNavigate()
  const [allowed, setAllowed] = useState(null)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('tx_signup_resume')
      if (!raw) { setAllowed(false); return }
      const r = JSON.parse(raw)
      setAllowed(!!(r && r.email && r.business_name))
    } catch { setAllowed(false) }
  }, [])
  useEffect(() => {
    if (allowed === false) navigate('/signup', { replace: true })
  }, [allowed, navigate])
  const label = VERTICAL_LABELS[vertical] || 'tu negocio'
  const waMsg = encodeURIComponent(`Hola, quiero ver el demo interactivo de Terminal X para ${label}.`)
  if (allowed !== true) return null

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl text-center">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-bold text-black/50 hover:text-[#b3001e] mb-8">
          <ArrowLeft size={14} /> Volver al inicio
        </Link>

        <div className="w-16 h-16 mx-auto rounded-full bg-[#b3001e]/10 flex items-center justify-center">
          <Sparkles size={28} className="text-[#b3001e]" />
        </div>

        <p className="mt-6 text-[11px] font-extrabold tracking-[3px] uppercase text-[#b3001e]">Demo interactivo</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-black text-black tracking-tight">
          Demo de {label} — proximamente
        </h1>
        <p className="mt-4 text-base text-black/60 leading-relaxed max-w-md mx-auto">
          Estamos terminando el demo interactivo para <strong className="text-black">{label}</strong>. Mientras tanto, te lo mostramos en vivo por WhatsApp con datos reales de tu industria.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a href={`https://wa.me/18098282971?text=${waMsg}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold px-6 py-3 rounded-xl transition-colors">
            <MessageCircle size={16} /> Ver demo por WhatsApp
          </a>
          <button onClick={() => navigate('/probar/carwash')}
            className="inline-flex items-center gap-2 bg-black hover:bg-black/80 text-white font-bold px-6 py-3 rounded-xl transition-colors">
            Probar demo Car Wash <ArrowRight size={14} />
          </button>
        </div>

        <p className="mt-10 text-[11px] text-black/40">
          +1 (809) 828-2971 · soporte@terminalxpos.com
        </p>
      </div>
    </div>
  )
}
