import { usePlan, PLAN_DISPLAY } from '../hooks/usePlan'
import { useLang } from '../i18n'
import { Lock, ArrowUpCircle } from 'lucide-react'

const FEATURE_PLAN_MIN = {
  credits: 'pro', reports: 'pro', petty_cash: 'pro', credit_notes: 'pro', cash_recon: 'pro', commissions: 'pro', inventory: 'pro',
  ecf: 'pro_plus', dgii: 'pro_plus', restaurant_mode: 'pro_plus',
  work_orders: 'pro_plus', appointments: 'pro_plus', service_bays: 'pro_plus', loans: 'pro_plus', vehicles: 'pro_plus',
  remote_dashboard: 'pro_max', whatsapp_receipts: 'pro_max', multi_location: 'pro_max',
  pawn_items: 'pro_max', loan_analytics: 'pro_max', vehicle_history: 'pro_max', stylist_schedules: 'pro_max',
}

export default function PlanGate({ feature, children }) {
  const { hasFeature, loading } = usePlan()
  const { lang } = useLang()

  if (loading) return null
  if (hasFeature(feature)) return children

  const minPlan = FEATURE_PLAN_MIN[feature] || 'pro'
  const planName = PLAN_DISPLAY[minPlan] || 'Pro'

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 bg-slate-50 px-6">
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-slate-300" />
      </div>
      <div className="text-center max-w-sm">
        <p className="text-[16px] font-bold text-slate-700 mb-2">
          {lang === 'es' ? `Disponible en ${planName}` : `Available on ${planName}`}
        </p>
        <p className="text-[13px] text-slate-400 leading-relaxed">
          {lang === 'es'
            ? `Esta funcion requiere el plan ${planName} o superior. Actualiza tu plan para desbloquear todas las herramientas que necesitas.`
            : `This feature requires ${planName} or higher. Upgrade your plan to unlock all the tools you need.`}
        </p>
      </div>
      <a href="https://terminalxpos.com" target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2 px-5 py-2.5 bg-[#0C447C] text-white text-[13px] font-bold rounded-xl hover:bg-[#0a3a6a] transition-colors">
        <ArrowUpCircle size={16} />
        {lang === 'es' ? 'Ver Planes' : 'View Plans'}
      </a>
      <a href="https://wa.me/18098282971" target="_blank" rel="noopener noreferrer"
        className="text-[12px] text-slate-400 hover:text-sky-600 transition-colors">
        {lang === 'es' ? 'Contactar soporte via WhatsApp' : 'Contact support via WhatsApp'}
      </a>
    </div>
  )
}
