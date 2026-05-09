// ConfigSalon — dedicated /config/salon page. Salon/barbershop deposit,
// no-show fee, and public booking link. Was buried under Mi Empresa →
// Configuracion Avanzada; promoted to its own page.
import { Scissors } from 'lucide-react'
import { SalonSettings } from '../Admin'
import { useLang } from '../../i18n'

export default function ConfigSalon() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Scissors size={22} className="text-[#b3001e]" />
            {L('Salón / Barbería', 'Salon / Barbershop')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Depósito por reserva, multa por no-show y página pública para agendar.',
               'Booking deposit, no-show fee, and public booking page.')}
          </p>
        </div>
        <SalonSettings />
      </div>
    </div>
  )
}
