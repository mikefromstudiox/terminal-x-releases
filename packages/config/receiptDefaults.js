// receiptDefaults.js — per-business-type defaults for the printed-receipt
// customization flags shipped in v2.16.30 (9-flag receipt overhaul).
//
// Resolution order at render time (see resolveReceiptFlag in
// packages/services/printer.js):
//   1. Owner override in app_settings (cfg[key])   '1'/'0' wins
//   2. RECEIPT_DEFAULTS_BY_BIZ_TYPE[type][key]     boolean fallback
//   3. false                                       safe default
//
// Boolean shape on disk: app_settings stores '1' = on, '' / '0' = off
// (matches the existing receipt_show_itbis_pct / receipt_show_commission
// keys already in BUSINESS_SETTING_KEYS).
//
// Adding a new flag:
//   - Pick a key in the `receipt_*` namespace.
//   - Add the default per business_type below (defaults to `false` if
//     the type isn't listed).
//   - Add to BUSINESS_SETTING_KEYS so it cloud-syncs across registers.
//   - Add a SettingRow in Sistema.jsx → "Personalización de Recibo".
//   - Wire the render in buildClientReceipt and read via resolveReceiptFlag.

import { normalizeBusinessType } from './businessTypes.js'

// Shared base — every business gets these on by default. Verticals can
// override individual entries below.
const BASE = {
  receipt_show_sku:              false,
  receipt_show_unit_price:       false,
  receipt_show_exempt_label:     true,    // DGII — always on
  receipt_show_client_address:   true,    // E31-gated at render time
  receipt_show_servicio_ley:     false,   // ticket already controls amount
  receipt_show_credit_ref:       true,    // E33/E34-gated at render time
  receipt_show_vehicle_details:  false,
  receipt_show_contact_extra:    true,
  receipt_show_loyalty:          true,    // client+points-gated at render time
}

export const RECEIPT_DEFAULTS_BY_BIZ_TYPE = {
  carwash: {
    ...BASE,
    receipt_show_vehicle_details: true,
  },
  retail: {
    ...BASE,
    receipt_show_sku:         true,
    receipt_show_unit_price:  true,
  },
  licoreria: {
    ...BASE,
    receipt_show_sku:         true,
    receipt_show_unit_price:  true,
  },
  meat_market: {
    ...BASE,
    receipt_show_sku:         true,
    receipt_show_unit_price:  true,
  },
  restaurant: {
    ...BASE,
    receipt_show_unit_price:  true,
    receipt_show_servicio_ley: true,
  },
  food_truck: {
    ...BASE,
    receipt_show_unit_price:  true,
    receipt_show_servicio_ley: true,
  },
  salon: {
    ...BASE,
  },
  mechanic: {
    ...BASE,
    receipt_show_sku:             true,
    receipt_show_vehicle_details: true,
  },
  dealership: {
    ...BASE,
    receipt_show_sku:             true,
    receipt_show_vehicle_details: true,
  },
  service: {
    ...BASE,
  },
  loans: {
    ...BASE,
    // These verticals rarely print thermal — keep contact/footer/loyalty only.
    receipt_show_exempt_label: false,
  },
  accounting: {
    ...BASE,
    receipt_show_exempt_label: false,
  },
  hybrid: {
    ...BASE,
    // Hybrid lights the union of common flags so SKU + unit-price + vehicle
    // all render when applicable; per-flag opt-out via Sistema if too noisy.
    receipt_show_sku:             true,
    receipt_show_unit_price:      true,
    receipt_show_vehicle_details: true,
  },
}

// Default footer when receipt_footer_message is unset.
export const RECEIPT_DEFAULT_FOOTER = 'GRACIAS POR SU PREFERENCIA'

// Length cap for the customizable footer line on 80mm thermal (COL_WIDTH).
export const RECEIPT_FOOTER_MAX_CHARS = 42

/**
 * resolveReceiptFlag(cfg, businessType, key) → boolean
 *
 *   - cfg          app_settings keyed object (data.cfg on the receipt builder)
 *   - businessType raw business_type string (will be normalized)
 *   - key          one of the receipt_* boolean keys
 *
 * Owner override wins if the cfg value is the string '1' or boolean true.
 * Explicit '0' / '' from cfg overrides the type default to OFF (so an owner
 * can disable a flag that the vertical enables by default).
 */
export function resolveReceiptFlag(cfg, businessType, key) {
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, key)) {
    const v = cfg[key]
    if (v === '1' || v === 1 || v === true) return true
    if (v === '0' || v === 0 || v === false || v === '') return false
  }
  const type = normalizeBusinessType(businessType)
  const defaults = RECEIPT_DEFAULTS_BY_BIZ_TYPE[type] || BASE
  return !!defaults[key]
}

// Resolve the footer message with cap. Owner override > built-in default.
export function resolveReceiptFooter(cfg) {
  const raw = String(cfg?.receipt_footer_message || '').trim()
  const out = raw || RECEIPT_DEFAULT_FOOTER
  return out.slice(0, RECEIPT_FOOTER_MAX_CHARS)
}
