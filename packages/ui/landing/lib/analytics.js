/**
 * analytics.js — typed event helpers for the terminalxpos.com landing page.
 *
 * Wraps `gtag('event', ...)` for GA4 (loaded at runtime via /ga-bootstrap.js,
 * deferred 3s after page-load — see web/index.html) and the optional
 * `window.va()` tracker installed by `@vercel/analytics`. Each helper
 * gracefully no-ops when the underlying tracker is missing — never throws,
 * never blocks render. All calls also push into `window.dataLayer` if a GTM
 * container is loaded so server-side event mirroring works without changes.
 *
 * Dev override: set `localStorage.tx_debug_analytics = '1'` to console.log
 * every event payload. Useful for verifying events fire from React handlers
 * before deploying.
 *
 * Event-name conventions follow the GA4 recommended-event taxonomy where
 * applicable; custom events use snake_case to match GA4's parameter style.
 *
 * @typedef {('hero'|'sticky'|'pricing_card'|'comparison'|'roi_calc'|'final_cta'|'nav'|'mobile_sticky'|'exit_intent'|'demo_strip')} CtaLocation
 * @typedef {('facturacion'|'facturacion_plus'|'facturacion_ilimitado'|'pro'|'pro_plus'|'pro_max')} PlanKey
 * @typedef {('mensual'|'anual')} PlanPeriod
 * @typedef {('carwash'|'tienda'|'licoreria'|'farmacia'|'colmado'|'supermercado'|'ferreteria'|'papeleria'|'boutique'|'restaurante'|'mecanica'|'salon'|'concesionario'|'pawn'|'servicios')} VerticalKey
 */

const isBrowser = typeof window !== 'undefined'

function debug() {
  try { return isBrowser && window.localStorage?.getItem('tx_debug_analytics') === '1' } catch { return false }
}

/**
 * Low-level dispatcher. Calls (in order, all guarded):
 *   1. window.gtag('event', name, params)        — GA4
 *   2. window.va('event', { name, ...params })   — Vercel Analytics
 *   3. window.dataLayer.push({ event: name, ... }) — GTM
 *
 * @param {string} name
 * @param {Record<string, any>} [params]
 */
function track(name, params) {
  if (!isBrowser) return
  const payload = params || {}
  if (debug()) {
    try { console.log('[tx_analytics]', name, payload) } catch (e) { /* noop */ }
  }
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, payload)
    }
  } catch (e) { /* noop */ }
  try {
    if (typeof window.va === 'function') {
      window.va('event', { name, ...payload })
    }
  } catch (e) { /* noop */ }
  try {
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: name, ...payload })
    }
  } catch (e) { /* noop */ }
}

/**
 * @param {CtaLocation} location
 * @param {PlanKey} [plan]
 */
export function trackCtaClick(location, plan) {
  track('cta_click', { location: String(location || ''), plan: plan ? String(plan) : null })
}

/** @param {string} feature */
export function trackComparisonRowClick(feature) {
  track('comparison_row_click', { feature: String(feature || '') })
}

/**
 * @param {number} savings  monthly savings in DOP (positive integer)
 * @param {PlanKey} recommendedTier
 */
export function trackRoiCalcUsed(savings, recommendedTier) {
  const num = Number.isFinite(+savings) ? Math.max(0, Math.round(+savings)) : 0
  track('roi_calc_used', { savings: num, recommended_tier: String(recommendedTier || '') })
}

/**
 * @param {PlanKey} tier
 * @param {PlanPeriod} planPeriod
 */
export function trackPricingCardView(tier, planPeriod) {
  track('pricing_card_view', { tier: String(tier || ''), plan_period: String(planPeriod || 'mensual') })
}

/**
 * @param {PlanKey} plan
 * @param {CtaLocation} source
 */
export function trackSignupInitiated(plan, source) {
  track('signup_initiated', { plan: String(plan || ''), source: String(source || '') })
}

export function trackVideoPlay() {
  track('video_play', {})
}

/** @param {25|50|75|100} percent */
export function trackVideoProgress(percent) {
  const p = [25, 50, 75, 100].includes(+percent) ? +percent : 0
  if (!p) return
  track('video_progress', { percent: p })
}

/** @param {VerticalKey} vertical */
export function trackDemoLoginClick(vertical) {
  track('demo_login_click', { vertical: String(vertical || '') })
}

export function trackExitIntentSubmit() {
  track('exit_intent_submit', {})
}
