// Licorería-only POS helpers, extracted from the POS.jsx god-component
// (was 3,777 LOC). These are pure functions — no React state, no API calls —
// so every branch is unit-testable and reusable from CobrarModal, smoke
// harness, or a future audit batch tool.
//
// Imported from POS.jsx via the existing `useBusinessType().licoreriaConfig`
// + cart state. Do not couple this module to React.

import { requiresAgeCheck } from './age-check.js'
import { round2, clamp } from '../../../services/money.js'

// Default cap when subtype config omits maxAmount. RD$100 covers every real
// DR jaba (Presidente jaba most expensive at ~RD$50).
const DEFAULT_DEPOSIT_CAP = 100

// Expand cart → final line items, appending synthetic bottle-deposit lines
// for licorería. Each deposit line is non-ITBIS, qty-matched, and carries
// `is_deposit: true` (canonical) + `bottle_deposit_line: true` (legacy alias)
// so printer / PDF / reports can segregate it.
//
// Caps every deposit at `licoreriaConfig.bottleDeposit.maxAmount` (default
// RD$100) and rounds to centavo so a typo in inventory_items.bottle_deposit
// never books a runaway liability. Returns the input untouched when the
// feature is disabled — caller doesn't need to branch.
export function expandCartWithDeposits(items, {
  bottleDepositEnabled,
  licoreriaConfig,
  lang = 'es',
} = {}) {
  if (!bottleDepositEnabled) return items
  const cfg = licoreriaConfig?.bottleDeposit
  if (!cfg?.enabled) return items

  const lineLabel = cfg.lineLabel?.[lang] || cfg.lineLabel?.es || 'Depósito de botella'
  const maxDep   = Number(cfg.maxAmount) || DEFAULT_DEPOSIT_CAP

  const out = []
  for (const it of (items || [])) {
    if (!it) continue
    out.push(it)
    const dep = clamp(it.bottle_deposit, maxDep)
    if (dep > 0 && it.inventory_item_id) {
      out.push({
        id:                       `dep-${it.id}`,
        inventory_item_id:        null,
        service_id:               null,
        sku:                      'DEP',
        name:                     `${lineLabel} — ${it.name}`,
        price:                    round2(dep),
        cost:                     0,
        qty:                      it.qty || 1,
        aplica_itbis:             0,
        is_wash:                  0,
        is_deposit:               true,
        bottle_deposit_line:      true,
        parent_inventory_item_id: it.inventory_item_id,
      })
    }
  }
  return out
}

// Belt-and-suspenders age check at "Cobrar" time. The flag stamped on cart
// lines at add-to-cart time can go stale (category renamed mid-cart, feature
// toggled off then back on, item replaced via barcode after qty edit). This
// re-evaluates EVERY non-deposit line against the live licoreriaConfig.
//
// Returns:
//   { ok: true }                              — clear to charge
//   { ok: false, reason: 'disabled' }         — feature off, never blocks
//   { ok: false, reason: 'verified' }         — already verified, OK
//   { ok: false, reason: 'pending', item }    — must show AgeVerifyModal
export function checkAgeGate({
  items,
  ageVerificationEnabled,
  ageVerified,
  licoreriaConfig,
}) {
  if (!ageVerificationEnabled) return { ok: true, reason: 'disabled' }
  if (ageVerified)             return { ok: true, reason: 'verified' }
  const offending = (items || []).find(it =>
    it && !it.bottle_deposit_line && !it.is_deposit &&
    requiresAgeCheck(licoreriaConfig, it)
  )
  if (!offending) return { ok: true, reason: 'no_restricted_items' }
  return { ok: false, reason: 'pending', item: offending }
}

// Decreto 308-08 hook — returns true when alcohol sales should be blocked
// at this hour per the subtype config. Off by default (varies by municipio).
// The block is soft — UI layer wraps it in ManagerAuthGate so a cashier with
// a manager card can override (audit logged).
export function isLateNightBlocked(licoreriaConfig, now = new Date()) {
  const cfg = licoreriaConfig?.lateNightBlock
  if (!cfg?.enabled) return false
  const h = now.getHours()
  const start = Number(cfg.startHour)
  const end   = Number(cfg.endHour)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  // Window may wrap midnight (e.g. start=22, end=8).
  if (start <= end) return h >= start && h < end
  return h >= start || h < end
}

// Mayoreo trigger — does any single line meet caseQty, OR does subtotal
// cross the threshold? Returns the discount amount in RD$ (already rounded)
// or 0 when not eligible. Called from CobrarModal after subtotal is known.
export function computeMayoreoDiscount({ items, subtotal, licoreriaConfig, mayoreoEnabled }) {
  if (!mayoreoEnabled) return 0
  const cfg = licoreriaConfig?.mayoreo
  if (!cfg?.enabled) return 0
  const caseQty   = Number(cfg.caseQty) || 24
  const threshold = Number(cfg.subtotalThreshold) || 5000
  const pct       = Number(cfg.discountPct) || 0
  if (pct <= 0) return 0
  const hasCase = (items || []).some(l =>
    l && !l.is_deposit && Number(l.qty || 0) >= caseQty
  )
  const overThreshold = Number(subtotal || 0) >= threshold
  if (!hasCase && !overThreshold) return 0
  return round2((Number(subtotal || 0) * pct) / 100)
}
