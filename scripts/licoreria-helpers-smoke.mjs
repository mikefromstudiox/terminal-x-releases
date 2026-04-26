// Smoke harness for the licorería helpers extracted from POS.jsx.
// Pure functions → no env, no DB, no network. Runs in <50ms.
//
// Add to CI (or local pre-release) alongside ranoza-e2e-smoke.mjs:
//   node scripts/licoreria-helpers-smoke.mjs
//
// Exits 1 on any failed assertion.

import {
  expandCartWithDeposits,
  checkAgeGate,
  isLateNightBlocked,
  computeMayoreoDiscount,
} from '../packages/ui/screens/pos/licoreria-helpers.js'
import { round2, add, sub, mul, sumLines, pctOf, clamp } from '../packages/services/money.js'

let pass = 0, fail = 0
function ok(label, cond) {
  if (cond) { console.log('✅', label); pass++ }
  else      { console.log('❌', label); fail++ }
}
function eq(label, a, b) { ok(`${label} — got ${JSON.stringify(a)}`, a === b) }

// ── money.js ───────────────────────────────────────────────────────────
eq('round2 floats',          round2(0.1 + 0.2),            0.3)
eq('round2 half away',       round2(1.005),                1.01)
eq('add no drift',           add(0.1, 0.2),                0.3)
eq('sub no drift',           sub(1.0, 0.9),                0.1)
eq('mul qty',                mul(99.99, 3),                299.97)
eq('pctOf ITBIS',            pctOf(100, 18),               18)
eq('pctOf mayoreo 8%',       pctOf(5000, 8),               400)
eq('clamp under cap',        clamp(50, 100),               50)
eq('clamp over cap',         clamp(500, 100),              100)
eq('clamp negative',         clamp(-10, 100),              0)
eq('sumLines',               sumLines([{price:99.99,qty:3},{price:0.01,qty:1}]), 299.98)

// ── expandCartWithDeposits ─────────────────────────────────────────────
const licCfg = {
  bottleDeposit: { enabled: true, defaultAmount: 5, maxAmount: 100, lineLabel: { es: 'Depósito de botella' } },
  ageVerification: { enabled: true, minAge: 18, triggerCategories: ['ron','cerveza','whisky'] },
  mayoreo: { enabled: true, caseQty: 24, subtotalThreshold: 5000, discountPct: 8 },
  lateNightBlock: { enabled: true, startHour: 0, endHour: 8 },
}

const cart = [
  { id: 1, inventory_item_id: 11, name: 'Presidente Jaba', qty: 1, bottle_deposit: 50, category: 'cerveza' },
  { id: 2, inventory_item_id: 12, name: 'Ron Brugal', qty: 2, bottle_deposit: 0,  category: 'ron' },
  { id: 3, inventory_item_id: 13, name: 'Bogus Deposit', qty: 1, bottle_deposit: 9999, category: 'ron' }, // typo
]
const expanded = expandCartWithDeposits(cart, { bottleDepositEnabled: true, licoreriaConfig: licCfg, lang: 'es' })
eq('expand: 2 deposit lines added',  expanded.length, cart.length + 2)
eq('expand: cap honored on bogus',   expanded.find(l => l.parent_inventory_item_id === 13)?.price, 100)
eq('expand: legitimate deposit',     expanded.find(l => l.parent_inventory_item_id === 11)?.price, 50)
eq('expand: deposit non-ITBIS',      expanded.find(l => l.is_deposit)?.aplica_itbis, 0)
eq('expand: feature off → noop',     expandCartWithDeposits(cart, { bottleDepositEnabled: false, licoreriaConfig: licCfg }).length, 3)

// ── checkAgeGate ───────────────────────────────────────────────────────
const gateOff = checkAgeGate({ items: cart, ageVerificationEnabled: false, ageVerified: null, licoreriaConfig: licCfg })
ok('gate: feature off → ok', gateOff.ok)
const gateVerified = checkAgeGate({ items: cart, ageVerificationEnabled: true, ageVerified: { method: 'id_check' }, licoreriaConfig: licCfg })
ok('gate: already verified → ok', gateVerified.ok)
const gatePending = checkAgeGate({ items: cart, ageVerificationEnabled: true, ageVerified: null, licoreriaConfig: licCfg })
ok('gate: restricted item → pending', !gatePending.ok && gatePending.reason === 'pending')
const gateClean = checkAgeGate({ items: [{ id: 9, name: 'Snickers', qty: 1, category: 'snacks' }], ageVerificationEnabled: true, ageVerified: null, licoreriaConfig: licCfg })
ok('gate: no restricted items → ok', gateClean.ok)
const gateMixed = checkAgeGate({
  items: [{ id: 1, name: 'Snickers', qty: 1, category: 'snacks' }, { id: 2, name: 'Presidente', qty: 1, category: 'cerveza' }],
  ageVerificationEnabled: true, ageVerified: null, licoreriaConfig: licCfg,
})
ok('gate: cerveza in mixed cart triggers', !gateMixed.ok && gateMixed.item.id === 2)

// ── isLateNightBlocked ─────────────────────────────────────────────────
ok('latenight: feature off',     !isLateNightBlocked({ lateNightBlock: { enabled: false } }, new Date('2026-04-26T03:00:00')))
ok('latenight: in window 3am',    isLateNightBlocked(licCfg, new Date('2026-04-26T03:00:00')))
ok('latenight: out of window 9am',!isLateNightBlocked(licCfg, new Date('2026-04-26T09:00:00')))
ok('latenight: wrap window 23-6', isLateNightBlocked({ lateNightBlock: { enabled: true, startHour: 23, endHour: 6 } }, new Date('2026-04-26T23:30:00')))
ok('latenight: wrap window early',isLateNightBlocked({ lateNightBlock: { enabled: true, startHour: 23, endHour: 6 } }, new Date('2026-04-26T05:00:00')))

// ── computeMayoreoDiscount ─────────────────────────────────────────────
eq('mayoreo: feature off',          computeMayoreoDiscount({ items: cart, subtotal: 6000, licoreriaConfig: licCfg, mayoreoEnabled: false }), 0)
eq('mayoreo: case qty triggers',    computeMayoreoDiscount({ items: [{ qty: 24 }], subtotal: 100, licoreriaConfig: licCfg, mayoreoEnabled: true }), 8)
eq('mayoreo: threshold triggers',   computeMayoreoDiscount({ items: [{ qty: 1 }], subtotal: 5000, licoreriaConfig: licCfg, mayoreoEnabled: true }), 400)
eq('mayoreo: below threshold',      computeMayoreoDiscount({ items: [{ qty: 1 }], subtotal: 100,  licoreriaConfig: licCfg, mayoreoEnabled: true }), 0)
eq('mayoreo: deposits ignored',     computeMayoreoDiscount({ items: [{ qty: 24, is_deposit: true }], subtotal: 100, licoreriaConfig: licCfg, mayoreoEnabled: true }), 0)

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
