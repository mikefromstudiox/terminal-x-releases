import React from 'react'

// ─────────────────────────────────────────────────────────────────────────
// LoyaltyTierBadge
// Tier taxonomy (canonical English in DB, Spanish in UI):
//     bronze   → Bronce   (neutral, no visible badge by default)
//     silver   → Plata    (gray)
//     gold     → Oro      (gold)
//     platinum → legacy — rendered as Oro so old rows don't break.
// Props:
//   tier         — 'bronze' | 'silver' | 'gold' | 'platinum'
//   lang         — 'es' | 'en'   (default 'es')
//   size         — 'xs' | 'sm'   (default 'xs')
//   showBronze   — render Bronce pill even though it's the default. False by default.
// ─────────────────────────────────────────────────────────────────────────

export const TIER_META = Object.freeze({
  gold:     { es: 'Oro',    en: 'Gold',   classes: 'bg-amber-400/20 text-amber-700  dark:bg-amber-300/15 dark:text-amber-300  border border-amber-500/40' },
  platinum: { es: 'Oro',    en: 'Gold',   classes: 'bg-amber-400/20 text-amber-700  dark:bg-amber-300/15 dark:text-amber-300  border border-amber-500/40' },
  silver:   { es: 'Plata',  en: 'Silver', classes: 'bg-slate-300/30 text-slate-700  dark:bg-white/10     dark:text-white/75   border border-slate-400/40' },
  bronze:   { es: 'Bronce', en: 'Bronze', classes: 'bg-orange-900/10 text-orange-800 dark:bg-orange-200/10 dark:text-orange-200 border border-orange-700/30' },
})

export function tierMultiplier(tier) {
  switch (tier) {
    case 'gold':
    case 'platinum': return 1.5
    case 'silver':   return 1.25
    default:         return 1.0
  }
}

export function tierForLifetime(lifetime) {
  const n = Number(lifetime) || 0
  if (n >= 5000) return 'gold'
  if (n >= 1000) return 'silver'
  return 'bronze'
}

export default function LoyaltyTierBadge({ tier, lang = 'es', size = 'xs', showBronze = false }) {
  const t = (tier || 'bronze').toLowerCase()
  if (t === 'bronze' && !showBronze) return null
  const meta = TIER_META[t] || TIER_META.bronze
  const label = lang === 'en' ? meta.en : meta.es
  const px = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-1.5 py-[1px] text-[9px]'
  return (
    <span
      className={`inline-flex items-center rounded font-bold uppercase tracking-[1px] ${px} ${meta.classes}`}
      title={label}
    >
      {label}
    </span>
  )
}
