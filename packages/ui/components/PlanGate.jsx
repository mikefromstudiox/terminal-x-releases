import { usePlan, PLAN_DISPLAY } from '../hooks/usePlan'
import { useLang } from '../i18n'
import { Lock, ArrowUpCircle } from 'lucide-react'

const FEATURE_PLAN_MIN = {
  // v2.16.2 — Facturación tier sprint. The standalone billing plan must be
  // DGII-compliant out of the box, which means E33/E34 (credit_notes), the
  // 606/607 monthly export (dgii_606_607), and the DGII shell + e-CF surface
  // all land at this tier. Higher tiers obviously include them.
  invoicing: 'facturacion',
  credit_notes: 'facturacion',
  dgii: 'facturacion',
  ecf: 'facturacion',
  dgii_606_607: 'facturacion',
  // Pro — core POS + basic back-office
  pos: 'pro', queue: 'pro',  // v2.3.30 — closed the ungated hole
  credits: 'pro', reports: 'pro', petty_cash: 'pro',
  cash_recon: 'pro', commissions: 'pro', inventory: 'pro',
  nomina_basic: 'pro',
  // Pro PLUS — fiscal + automation
  whatsapp_receipts: 'pro_plus', whatsapp_automation: 'pro_plus',
  restaurant_mode: 'pro_plus',
  work_orders: 'pro_plus', appointments: 'pro_plus', service_bays: 'pro_plus',
  loans: 'pro_plus', vehicles: 'pro_plus',
  // Salon vertical (v2.16.1)
  salon_memberships: 'pro_plus', salon_dashboard: 'pro_plus',
  salon_public_booking: 'pro_plus', salon_walk_in_mode: 'pro_plus',
  salon_whatsapp_reminders: 'pro_plus',
  // Pro MAX — scale + advanced
  remote_dashboard: 'pro_max', multi_location: 'pro_max',
  custom_receipt_design: 'pro_max', nomina_advanced: 'pro_max',
  pawn_items: 'pro_max', loan_analytics: 'pro_max',
  vehicle_history: 'pro_max',
  // v2.16.1 patch — stylist_schedules promoted to Pro PLUS in usePlan; align here.
  stylist_schedules: 'pro_plus',
  // v2.16.1 patch — registered features that previously fell through to 'pro'.
  salon_no_show_deposit: 'pro_max',
  salon_offline_whatsapp_queue: 'pro_max',
  salon_preferred_stylist: 'pro',
  // v2.16.2 Sprint 2E — concesionario gating
  concesionario_resumen:   'pro',
  vehicle_inventory:       'pro_plus',
  sales_pipeline:          'pro_plus',
  test_drives:             'pro_plus',
  deal_builder:            'pro_plus',
  matriculas:              'pro_plus',
  reservations:            'pro_plus',
  warranties:              'pro_plus',
  preapprovals:            'pro_plus',
  concesionario_reports:   'pro_plus',
  intrant_api:             'pro_max',
  whatsapp_auto:           'pro_max',
  // FIX-HIGH-6 — carnicería vertical
  carniceria_resumen:         'pro',
  carniceria_corte_catalog:   'pro_plus',
  carniceria_mayoreo:         'pro_plus',
  carniceria_freshness_alerts:'pro_plus',
}

// Optional per-feature custom upgrade copy. When present, overrides the generic
// "Esta funcion requiere..." description on the paywall card.
const FEATURE_DESCRIPTIONS = {
  carniceria_resumen: {
    es: 'Disponible en Pro PLUS — Catalogo de cortes, ventas al mayoreo, alertas de frescura.',
    en: 'Available on Pro PLUS — Cuts catalog, wholesale orders, freshness alerts.',
  },
  carniceria_corte_catalog: {
    es: 'Disponible en Pro PLUS — Catalogo de cortes, ventas al mayoreo, alertas de frescura.',
    en: 'Available on Pro PLUS — Cuts catalog, wholesale orders, freshness alerts.',
  },
  carniceria_mayoreo: {
    es: 'Disponible en Pro PLUS — Catalogo de cortes, ventas al mayoreo, alertas de frescura.',
    en: 'Available on Pro PLUS — Cuts catalog, wholesale orders, freshness alerts.',
  },
  carniceria_freshness_alerts: {
    es: 'Disponible en Pro PLUS — Catalogo de cortes, ventas al mayoreo, alertas de frescura.',
    en: 'Available on Pro PLUS — Cuts catalog, wholesale orders, freshness alerts.',
  },
}

export default function PlanGate({ feature, children }) {
  const { hasFeature, loading } = usePlan()
  const { lang } = useLang()

  if (loading) return null
  if (hasFeature(feature)) return children

  const minPlan = FEATURE_PLAN_MIN[feature] || 'pro'
  const planName = PLAN_DISPLAY[minPlan] || 'Pro'
  const customDesc = FEATURE_DESCRIPTIONS[feature]
  const ctaLabel = customDesc
    ? (lang === 'es' ? 'Actualizar plan' : 'Upgrade plan')
    : (lang === 'es' ? 'Ver Planes' : 'View Plans')
  const ctaClass = customDesc
    ? 'flex items-center gap-2 px-5 py-2.5 bg-[#b3001e] text-white text-[13px] font-bold rounded-xl hover:bg-[#8f0018] transition-colors'
    : 'flex items-center gap-2 px-5 py-2.5 bg-[#0C447C] text-white text-[13px] font-bold rounded-xl hover:bg-[#0a3a6a] transition-colors'

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
          {customDesc
            ? (lang === 'es' ? customDesc.es : customDesc.en)
            : (lang === 'es'
                ? `Esta funcion requiere el plan ${planName} o superior. Actualiza tu plan para desbloquear todas las herramientas que necesitas.`
                : `This feature requires ${planName} or higher. Upgrade your plan to unlock all the tools you need.`)}
        </p>
      </div>
      <a href="https://terminalxpos.com" target="_blank" rel="noopener noreferrer"
        className={ctaClass}>
        <ArrowUpCircle size={16} />
        {ctaLabel}
      </a>
      <a href="https://wa.me/18098282971" target="_blank" rel="noopener noreferrer"
        className="text-[12px] text-slate-400 hover:text-sky-600 transition-colors">
        {lang === 'es' ? 'Contactar soporte via WhatsApp' : 'Contact support via WhatsApp'}
      </a>
    </div>
  )
}
