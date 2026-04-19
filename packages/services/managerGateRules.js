/**
 * managerGateRules.js — single source of truth for when the Manager Auth Gate
 * is required. Centralised so we don't drift between POS/CobrarModal/Queue/etc.
 *
 * Roles:
 *   - owner    → bypasses always.
 *   - manager  → normally bypasses except inv_adjust / credit_note (traceable).
 *   - cashier  → always gated on protected actions.
 *
 * Per-action remote-off switches live in app_settings under
 *   `mgr_gate_enabled_<action>` (1 / 0). Defaults: ALL ON. When a flag is
 *   explicitly '0' the gate is skipped even for cashiers — lets a client disable
 *   the friction on actions they don't care about without a code change.
 */

export const GATED_ACTIONS = Object.freeze([
  'price_edit',
  'discount_big',
  'void',
  'credit_note',
  'inv_adjust',
  'return',
])

const MANAGER_ALWAYS_GATED = new Set(['inv_adjust', 'credit_note'])

/**
 * @param {Object} user           { role: 'owner'|'manager'|'cashier'|… }
 * @param {string} action         one of GATED_ACTIONS
 * @param {Object} settings       app_settings object (optional)
 * @returns {boolean}
 */
export function needsGate(user, action, settings = null) {
  if (!action) return false
  if (settings && String(settings[`mgr_gate_enabled_${action}`] ?? '1') === '0') return false
  const role = user?.role
  if (role === 'owner') return false
  if (role === 'manager') return MANAGER_ALWAYS_GATED.has(action)
  return true
}

/** Threshold for "big" discount → RD$500 or >15% of subtotal. */
export function isBigDiscount({ descuento = 0, subtotal = 0, userDiscountPct = 0 }) {
  const d = Number(descuento) || 0
  const s = Number(subtotal) || 0
  if (d <= 0) return false
  if (d > 500) return true
  const pctLimit = (Number(userDiscountPct) || 0) / 100 * s
  if (pctLimit > 0 && d > pctLimit) return true
  if (s > 0 && d / s > 0.15) return true
  return false
}
