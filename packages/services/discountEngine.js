// Carnicería discount engine — pure function, runs in renderer.
// Given a list of cart items + the active-discounts payload from the DB,
// returns per-item discount metadata so the cart can show the crimson pill
// AND apply the correct line price.
//
// Sources merged in priority order:
//   1. auto_50_vence  → −50 % when the linked freshness batch was tagged
//                       "Aplicar -50%" (highest priority — overrides season)
//   2. season:<key>   → percentage discount from a seasonal promotions row
//                       active today and either targeting the item directly
//                       or applying to the whole carnicería catalog
//
// The DB provides `activeDiscounts(item_supabase_ids)` returning:
//   { [item_supabase_id]: [{ source, pct, label, banner_text, season_key }, ...] }
// (already filtered to today's window by date math in SQL).

export function pickBestDiscount(discounts) {
  if (!Array.isArray(discounts) || discounts.length === 0) return null
  // auto_50_vence wins outright
  const venc = discounts.find(d => d.source === 'auto_50_vence')
  if (venc) return venc
  // Otherwise highest pct wins, ties broken by alphabetical season_key for determinism
  return [...discounts].sort((a, b) => {
    const ap = Number(a.pct) || 0, bp = Number(b.pct) || 0
    if (bp !== ap) return bp - ap
    return String(a.season_key || '').localeCompare(String(b.season_key || ''))
  })[0]
}

// Apply a discount to a per-line unit price (does NOT touch quantity/weight).
// Returns { unitPriceAfter, lineSubtotalAfter, discountAmount }.
// Caller is responsible for re-running ITBIS calc on the discounted subtotal.
export function applyDiscountToLine({ unitPrice, qtyOrWeight, discount }) {
  const u = Number(unitPrice) || 0
  const q = Number(qtyOrWeight) || 0
  if (!discount || !discount.pct) {
    return { unitPriceAfter: u, lineSubtotalAfter: u * q, discountAmount: 0, discount: null }
  }
  const factor = 1 - (Number(discount.pct) / 100)
  const unitPriceAfter = Math.round(u * factor * 100) / 100
  const lineSubtotalAfter = Math.round(unitPriceAfter * q * 100) / 100
  const original = Math.round(u * q * 100) / 100
  return {
    unitPriceAfter,
    lineSubtotalAfter,
    discountAmount: Math.round((original - lineSubtotalAfter) * 100) / 100,
    discount,
  }
}

// Map a discount source to the crimson pill copy shown on the cart line.
export function discountPillLabel(discount, lang = 'es') {
  if (!discount) return ''
  if (discount.source === 'auto_50_vence') {
    return lang === 'es' ? '−50 % Vencimiento' : '−50% Expiry'
  }
  if (String(discount.source || '').startsWith('season:')) {
    const key = discount.season_key || discount.source.split(':')[1]
    const map = {
      ano_nuevo:    lang === 'es' ? 'Año Nuevo'        : 'New Year',
      navidad:      lang === 'es' ? 'Navidad'          : 'Christmas',
      dia_madres:   lang === 'es' ? 'Día Madres'       : 'Mother\'s Day',
      dia_padres:   lang === 'es' ? 'Día Padres'       : 'Father\'s Day',
      semana_santa: lang === 'es' ? 'Semana Santa'     : 'Holy Week',
    }
    const label = map[key] || (lang === 'es' ? 'Promoción' : 'Promo')
    return `−${Number(discount.pct)} % ${label}`
  }
  return `−${Number(discount.pct) || 0} %`
}
