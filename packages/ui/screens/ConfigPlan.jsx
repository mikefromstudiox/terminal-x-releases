// ConfigPlan — read-only "Plan & facturación" mini-page reachable from
// ConfigGrid. Replaces a misrouted card (was pointing at /admin/clients,
// which non-admin roles can't reach). Shows current plan, expiration,
// trial flag, and an upgrade link. Owner gets a "Manage in admin" button
// that deep-links to /admin/clients/:id.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crown, Calendar, ArrowUpRight, Loader2, Sparkles, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI } from '../context/DataContext'
import { useLang } from '../i18n'
import { usePlan } from '../hooks/usePlan'

const PLAN_LABELS = {
  pro: 'Pro',
  pro_plus: 'Pro PLUS',
  pro_max: 'Pro MAX',
  facturacion: 'Facturación',
  pro_ctb: 'Pro CTB',
}

// 2026-05-18 — Prices realigned to the canonical 2026-05-12 lock
// (see memory/reference_pricing_locked_20260512.md + landing's
// RoiCalculator + FeatureMatrix). Old values 2,990/5,490/9,990 were
// the 2026-04-27 numbers that never got updated here, so /config/plan
// showed Pro MAX as RD$9,990 while the landing said RD$6,990.
const PLAN_PRICE = {
  pro:         'RD$ 2,490',
  pro_plus:    'RD$ 4,490',
  pro_max:     'RD$ 6,990',
  facturacion: 'RD$ 490',
  pro_ctb:     'RD$ 7,990',
}

export default function ConfigPlan() {
  const api = useAPI()
  const { user } = useAuth()
  const { plan: licensePlan } = usePlan()
  const navigate = useNavigate()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [biz, setBiz]         = useState(null)
  const [license, setLicense] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [b, lic] = await Promise.all([
          api.admin?.getEmpresa?.() ?? Promise.resolve(null),
          api.license?.current?.() ?? Promise.resolve(null),
        ])
        if (!cancelled) {
          setBiz(b || null)
          setLicense(lic || null)
        }
      } catch (e) {
        try {
          window.__txReportError?.(e, { severity: 'warn', category: 'config_plan_load' })
        } catch (_aetherErr) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'configplan.configplan' }) } catch {}}
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [api])

  const planKey   = biz?.plan || licensePlan || 'pro'
  const planLabel = PLAN_LABELS[planKey] || planKey
  const price     = PLAN_PRICE[planKey] || ''
  const expiresAt = license?.expires_at ? new Date(license.expires_at) : null
  const trialEnd  = license?.trial_end  ? new Date(license.trial_end)  : null
  const onTrial   = trialEnd && trialEnd > new Date()

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Crown size={22} className="text-[#b3001e]" />
            {L('Plan y facturación', 'Plan & billing')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Tu plan actual, próximo cobro e historial.',
               'Your active plan, next charge and history.')}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/30">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current plan card */}
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 md:p-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-[11px] font-extrabold tracking-[1.5px] text-slate-400 dark:text-white/40 uppercase mb-1">{L('Plan activo', 'Active plan')}</p>
                  <p className="text-[28px] md:text-[34px] font-black text-slate-900 dark:text-white inline-flex items-center gap-2">
                    {planLabel}
                    {onTrial && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        <Sparkles size={11} /> {L('Prueba gratis', 'Free trial')}
                      </span>
                    )}
                  </p>
                  {price && (
                    <p className="text-[14px] text-slate-500 dark:text-white/50 mt-1">{price} / {L('mes', 'month')}</p>
                  )}
                </div>
                <Crown size={28} className="text-[#b3001e]" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-slate-100 dark:border-white/10">
                <div>
                  <p className="text-[10px] font-bold tracking-[1.5px] text-slate-400 dark:text-white/40 uppercase">{L('Próximo cobro', 'Next charge')}</p>
                  <p className="text-[14px] font-bold text-slate-700 dark:text-white mt-1 inline-flex items-center gap-1.5">
                    <Calendar size={13} />
                    {expiresAt ? expiresAt.toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-[1.5px] text-slate-400 dark:text-white/40 uppercase">{L('Estado', 'Status')}</p>
                  <p className="text-[14px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {license?.status === 'active' || !license ? (L('Activo', 'Active')) : license.status}
                  </p>
                </div>
              </div>
            </div>

            {/* Upgrade hook */}
            {planKey !== 'pro_max' && (
              <div className="rounded-2xl border-2 border-[#b3001e]/20 bg-[#b3001e]/5 p-5">
                <p className="text-[14px] font-bold text-slate-900 dark:text-white">{L('¿Quieres más funciones?', 'Want more features?')}</p>
                <p className="text-[12px] text-slate-600 dark:text-white/60 mt-1 mb-3">
                  {L('Pro MAX incluye: ofertas, dashboard remoto, multi-locación, pantalla de recogida, comisiones avanzadas y más.',
                     'Pro MAX includes bundles, remote dashboard, multi-location, pickup display, advanced commissions and more.')}
                </p>
                <a
                  href="https://wa.me/18098282971?text=Quiero%20upgrade%20a%20Pro%20MAX"
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white text-[12px] font-extrabold"
                >
                  {L('Hablar con Studio X', 'Contact Studio X')} <ArrowUpRight size={14} />
                </a>
              </div>
            )}

            {/* Owner-only deep link to admin */}
            {user?.role === 'owner' && (
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 text-left hover:border-[#b3001e] transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-bold text-slate-900 dark:text-white">
                      {L('Administrar facturación', 'Manage billing')}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
                      {L('Historial de pagos, métodos de pago, cambios de plan.',
                         'Payment history, payment methods, plan changes.')}
                    </p>
                  </div>
                  <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#b3001e]" />
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
