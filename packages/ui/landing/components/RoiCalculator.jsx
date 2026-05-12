import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calculator, ArrowRight, TrendingDown, Clock } from 'lucide-react'
import { trackRoiCalcUsed, trackCtaClick } from '../lib/analytics'

// RoiCalculator — client-side ROI widget (Grok spec, v2).
//
// Inputs (3):
//   1. Facturas mensuales promedio (slider 0–1000, default 250)
//   2. Tiempo por factura manual (minutos)               (number, default 4)
//   3. Número de empleados en caja                       (number, default 2)
//
// Outputs (3):
//   1. Ahorro mensual estimado RD$
//        formula: (facturas × tiempo_min × employees × hourly_cost) − tier_price
//        hourly_cost = RD$200/h (DR market avg minimum-wage hour, 2026)
//   2. Tiempo ahorrado al mes (horas)
//        formula: facturas × tiempo_min / 60
//        secondary line: " = X días de trabajo recuperados" (÷ 8)
//   3. ROI en semanas
//        formula: tier_price / (savings_per_month / 4)
//
// Tier recommendation logic:
//   - empleados ≥ 3 OR facturas > 600         → pro_max
//   - facturas > 200                          → facturacion_unlimited
//   - empleados ≥ 1 AND facturas ≥ 50         → pro_plus
//   - facturas ≥ 50                           → facturacion_plus
//   - else                                    → facturacion
//
// Bar chart shows: "Tu situación actual" (manual cost) vs
// "Terminal X [recommended tier]" (the price). No competitor bars.
//
// Persisted in localStorage under `tx_roi_calc`.

const HOURLY_COST_RD = 200

const TIER_PRICES = {
  facturacion: 995,
  facturacion_plus: 1990,
  facturacion_unlimited: 2990,
  pro: 2490,
  pro_plus: 4490,
  pro_max: 6990,
}

const TIER_LABELS = {
  facturacion: 'Facturación',
  facturacion_plus: 'Facturación Plus',
  facturacion_unlimited: 'Facturación Ilimitado',
  pro: 'Pro',
  pro_plus: 'Pro PLUS',
  pro_max: 'Pro MAX',
}

const COPY = {
  es: {
    eyebrow: 'CALCULADORA ROI',
    title: 'Cuánto te ahorras con Terminal X',
    sub: 'Ajusta los inputs — el resultado es estimado para un negocio en RD facturando manualmente.',
    inFacturas: 'Facturas mensuales promedio',
    inMinutos: 'Tiempo por factura manual (minutos)',
    inEmpleados: 'Número de empleados en caja',
    saveLabel: 'Ahorro mensual estimado',
    perMonth: '/mes',
    timeSavedLabel: 'Tiempo ahorrado al mes',
    timeSavedHours: 'horas',
    timeSavedDays: 'días de trabajo recuperados',
    roiLabel: 'ROI',
    roiText: (w) => w === 0
      ? 'Pagas tu plan al instante'
      : w === Infinity
        ? 'Ajusta los inputs para ver tu ROI'
        : `Pagas tu plan en ${w} semana${w === 1 ? '' : 's'}`,
    recommended: 'Plan recomendado',
    ctaPrimary: 'Empezar 7 días gratis',
    youLabel: 'Tu costo manual actual',
    txLabel: 'Terminal X',
    note: 'Asume RD$200/hora de costo laboral (salario mínimo DR 2026). Tu ROI real depende de tu volumen y eficiencia.',
  },
  en: {
    eyebrow: 'ROI CALCULATOR',
    title: 'How much you save with Terminal X',
    sub: 'Adjust the inputs — estimate for a DR business invoicing by hand.',
    inFacturas: 'Average monthly invoices',
    inMinutos: 'Time per manual invoice (minutes)',
    inEmpleados: 'Cashier headcount',
    saveLabel: 'Estimated monthly savings',
    perMonth: '/mo',
    timeSavedLabel: 'Hours saved per month',
    timeSavedHours: 'hours',
    timeSavedDays: 'workdays recovered',
    roiLabel: 'Payback',
    roiText: (w) => w === 0
      ? 'Pays itself instantly'
      : w === Infinity
        ? 'Adjust inputs to see payback'
        : `Pays itself in ${w} week${w === 1 ? '' : 's'}`,
    recommended: 'Recommended plan',
    ctaPrimary: 'Start 7-day free trial',
    youLabel: 'Your current manual cost',
    txLabel: 'Terminal X',
    note: 'Assumes RD$200/hour labor cost (DR 2026 minimum wage). Your real payback depends on volume and efficiency.',
  },
}

function recommendTier({ facturas, empleados }) {
  if (empleados >= 3 || facturas > 600) return 'pro_max'
  if (facturas > 200) return 'facturacion_unlimited'
  if (empleados >= 1 && facturas >= 50) return 'pro_plus'
  if (facturas >= 50) return 'facturacion_plus'
  return 'facturacion'
}

const DEFAULTS = { facturas: 250, minutos: 4, empleados: 2 }

export default function RoiCalculator({ lang = 'es' }) {
  const navigate = useNavigate()
  const t = COPY[lang] || COPY.es

  const initial = (() => {
    try {
      const raw = localStorage.getItem('tx_roi_calc')
      if (raw) {
        const parsed = JSON.parse(raw)
        // Migration: old shape had {facturas, gasto, empleados}. Drop `gasto`,
        // pull `minutos` if present, otherwise fall back to default.
        return {
          facturas: Number.isFinite(+parsed.facturas) ? +parsed.facturas : DEFAULTS.facturas,
          minutos: Number.isFinite(+parsed.minutos) ? +parsed.minutos : DEFAULTS.minutos,
          empleados: Number.isFinite(+parsed.empleados) ? +parsed.empleados : DEFAULTS.empleados,
        }
      }
    } catch {}
    return DEFAULTS
  })()

  const [facturas, setFacturas] = useState(initial.facturas)
  const [minutos, setMinutos] = useState(initial.minutos)
  const [empleados, setEmpleados] = useState(initial.empleados)

  useEffect(() => {
    try {
      localStorage.setItem('tx_roi_calc', JSON.stringify({ facturas, minutos, empleados }))
    } catch {}
  }, [facturas, minutos, empleados])

  const tierKey = useMemo(
    () => recommendTier({ facturas, empleados }),
    [facturas, empleados],
  )
  const txPrice = TIER_PRICES[tierKey]

  // Manual labor cost: total minutes × hourly rate / 60.
  const manualCost = useMemo(
    () => Math.round((facturas * minutos * empleados * HOURLY_COST_RD) / 60),
    [facturas, minutos, empleados],
  )
  const savings = Math.max(0, manualCost - txPrice)
  const hoursSaved = Math.round((facturas * minutos) / 60)
  const daysSaved = Math.round((hoursSaved / 8) * 10) / 10
  const weeksToPayback = useMemo(() => {
    if (savings <= 0) return Infinity
    const w = Math.ceil(txPrice / (savings / 4))
    return w < 1 ? 0 : w
  }, [savings, txPrice])

  // Fire trackRoiCalcUsed (debounced ~600ms after the last input change).
  const debounceRef = useRef(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      try { trackRoiCalcUsed(savings, tierKey) } catch {}
    }, 600)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [savings, tierKey])

  // Bar chart: 2 bars only (manual vs recommended TX tier).
  const bars = [
    { key: 'you', label: t.youLabel, price: manualCost, color: 'bg-white/30' },
    { key: 'tx',  label: `${t.txLabel} ${TIER_LABELS[tierKey]}`, price: txPrice, color: 'bg-[#b3001e]' },
  ]
  const max = Math.max(...bars.map(b => b.price), 1)

  function handleCta() {
    try { trackCtaClick('roi_calc', tierKey) } catch {}
    navigate(`/signup?plan=${tierKey}&utm_source=roi_calc&calc_savings=${savings}`)
  }

  return (
    <section id="roi-calculator" className="bg-black text-white py-20 md:py-28 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{t.eyebrow}</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">{t.title}</h2>
          <p className="mt-3 text-white/60 text-base max-w-2xl mx-auto">{t.sub}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          {/* Inputs */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6 md:p-8">
            <div className="flex items-center gap-2 mb-6">
              <Calculator size={18} className="text-[#b3001e]" />
              <span className="text-xs font-extrabold tracking-[2px] uppercase text-white/70">Inputs</span>
            </div>

            {/* facturas slider */}
            <div className="mb-6">
              <div className="flex items-baseline justify-between mb-2">
                <label htmlFor="roi-facturas" className="text-sm font-semibold text-white">{t.inFacturas}</label>
                <span className="text-2xl font-black text-[#b3001e] tabular-nums">{facturas}</span>
              </div>
              <input
                id="roi-facturas"
                type="range" min="0" max="1000" step="10"
                value={facturas}
                onChange={e => setFacturas(parseInt(e.target.value, 10))}
                className="w-full accent-[#b3001e]"
              />
              <div className="flex justify-between text-[10px] text-white/40 mt-1">
                <span>0</span><span>500</span><span>1000+</span>
              </div>
            </div>

            {/* minutos */}
            <div className="mb-6">
              <label htmlFor="roi-minutos" className="block text-sm font-semibold text-white mb-2">{t.inMinutos}</label>
              <input
                id="roi-minutos"
                type="number" min="1" max="60" step="1"
                value={minutos}
                onChange={e => setMinutos(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-[#b3001e]"
              />
            </div>

            {/* empleados */}
            <div>
              <label htmlFor="roi-empleados" className="block text-sm font-semibold text-white mb-2">{t.inEmpleados}</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEmpleados(Math.max(0, empleados - 1))}
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold transition-colors"
                  aria-label="-1"
                >−</button>
                <input
                  id="roi-empleados"
                  type="number" min="0" max="50"
                  value={empleados}
                  onChange={e => setEmpleados(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-bold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-[#b3001e]"
                />
                <button
                  type="button"
                  onClick={() => setEmpleados(empleados + 1)}
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold transition-colors"
                  aria-label="+1"
                >+</button>
              </div>
            </div>
          </div>

          {/* Output */}
          <div>
            {/* Primary output: monthly savings */}
            <div className="rounded-2xl bg-[#b3001e] p-6 md:p-8 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown size={18} className="text-white/80" />
                <span className="text-xs font-extrabold tracking-[2px] uppercase text-white/85">{t.saveLabel}</span>
              </div>
              <div className="text-5xl md:text-6xl font-black tabular-nums leading-none">
                RD${savings.toLocaleString('es-DO')}
                <span className="text-xl font-bold text-white/70 ml-1">{t.perMonth}</span>
              </div>
              <div className="mt-4 text-sm text-white/85">
                <span className="opacity-75">{t.recommended}: </span>
                <span className="font-bold">{TIER_LABELS[tierKey]} · RD${txPrice.toLocaleString('es-DO')}{t.perMonth}</span>
              </div>
            </div>

            {/* Secondary outputs row: hours saved + ROI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Clock size={16} className="text-[#b3001e]" />
                  <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-white/60">{t.timeSavedLabel}</span>
                </div>
                <div className="text-2xl font-black tabular-nums text-white">
                  {hoursSaved.toLocaleString('es-DO')} <span className="text-sm font-bold text-white/60">{t.timeSavedHours}</span>
                </div>
                <p className="mt-1 text-[11px] text-white/50">= {daysSaved} {t.timeSavedDays}</p>
              </div>
              <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowRight size={16} className="text-[#b3001e]" />
                  <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-white/60">{t.roiLabel}</span>
                </div>
                <div className="text-base font-black text-white leading-snug">
                  {t.roiText(weeksToPayback)}
                </div>
              </div>
            </div>

            {/* Bar chart — 2 bars only (manual vs TX) */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 space-y-3">
              {bars.map(b => {
                const pct = Math.max(2, Math.round((b.price / max) * 100))
                return (
                  <div key={b.key}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-xs font-bold text-white truncate pr-2">{b.label}</span>
                      <span className="text-xs font-black tabular-nums text-white/85">RD${b.price.toLocaleString('es-DO')}</span>
                    </div>
                    <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                      <div className={`h-full ${b.color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>

            <button
              onClick={handleCta}
              className="mt-6 group w-full inline-flex items-center justify-center gap-2 bg-white text-black font-bold px-7 py-4 rounded-xl shadow-xl transition-all hover:scale-[1.01] hover:bg-white/90"
            >
              {t.ctaPrimary} · {TIER_LABELS[tierKey]}
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>

            <p className="mt-3 text-[11px] text-white/40 text-center">{t.note}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
