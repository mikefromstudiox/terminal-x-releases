// settingsWhitelist.js — classifies app_settings keys by scope.
// CommonJS mirror of packages/services/settingsWhitelist.js — keep IDENTICAL.
//
// Three categories:
//   1. BUSINESS_SETTING_KEYS  — cloud-synced, business-wide. Same on every device.
//   2. DEVICE_LOCAL_CLOUD_MIRROR_KEYS — v2.10.5: device-local BUT mirrored to
//      Supabase tagged with the writing device's HWID. Recovery-safe:
//      a fresh install on the SAME hwid can pull its previous config.
//      Different hwid -> rows are ignored (so device A's printer settings
//      never overwrite device B's).
//   3. DEVICE_ONLY_KEYS — device-local and NEVER leave this machine
//      (sync internals, caches, transient markers).

// ── 1. BUSINESS-level (cloud-synced, no hwid) ────────────────────────────────
const BUSINESS_SETTING_KEYS = new Set([
  'itbis_pct', 'usd_rate', 'rnc_verify', 'sucursales',
  'whatsapp_instance', 'whatsapp_token',
  'biz_name', 'biz_rnc', 'biz_address', 'biz_phone', 'biz_city', 'biz_type',
  'biz_email', 'biz_logo', 'biz_website',
  'direccion',
  // Per-business receipt customization (v1)
  'receipt_show_itbis_pct',
  'receipt_show_commission',
  // Facturación tier custom branding (v2.16.5) — invoice footer + logo URL.
  'invoice_footer',
  'logo_url',
  'business_type', 'biz_business_type',
  'ley_enabled',
  'go_live_date',
  'daily_digest_enabled', 'last_digest_sent',
  'pos_tab_order', 'pos_tab_hidden',
  'loyalty_enabled', 'loyalty_points_ratio', 'loyalty_redemption_ratio',
  'loyalty_tier_silver', 'loyalty_tier_gold', 'loyalty_tier_platinum',
  // Tienda subtype template system — cloud-synced, business-wide.
  'tienda_subtype',
  'feature_age_verification_enabled',
  'feature_pedidos_ya_enabled',
  'feature_bottle_deposit_enabled',
  'feature_mamajuana_tracking_enabled',
  'feature_prescription_tracking_enabled',
  'feature_expiry_alerts_enabled',
  'feature_controlled_substance_log_enabled',
  'feature_mixed_food_nonfood_enabled',
  'feature_credit_sales_enabled',
  'feature_pricing_by_weight_enabled',
  'feature_deli_counter_enabled',
  'feature_serial_number_tracking_enabled',
  'feature_job_estimates_enabled',
  'feature_school_packages_enabled',
  'feature_size_variants_enabled',
  'feature_color_variants_enabled',
  // Salon vertical (v2.16.1) — public booking + deposit / no-show config.
  'salon_require_deposit', 'salon_deposit_amount_dop', 'salon_no_show_fee_dop',
  'salon_public_booking_enabled', 'salon_public_booking_slug',
  // Mecánica vertical (v2.16.x FIX-HIGH-7) — owner-configurable tow/delivery
  // fee auto-added when "Marcar Listo" toggles entrega a domicilio. Replaces
  // the hardcoded RD$ 500 in WorkOrders. Cloud-synced so every register sees
  // the same fee the moment Sistema is saved.
  'mechanic_tow_fee_default',
])

// ── 2. DEVICE-LOCAL, CLOUD-MIRRORED (recovery-safe, tagged with HWID) ────────
// These are per-device settings (printer config, kiosk state, etc.) that were
// previously lost forever when a cash register PC died. v2.10.5 mirrors them
// to Supabase tagged with device_hwid so a reinstall on the SAME hardware
// recovers them automatically. Cross-device writes cannot race: each HWID
// is a sole-writer partition, so LWW is safe within each partition.
const DEVICE_LOCAL_CLOUD_MIRROR_KEYS = new Set([
  'printer',              // ESC/POS printer JSON config (vendor, port, width)
  'drawer_pulse_hex',     // cash drawer kick pulse bytes
  'print_factura_auto',
  'print_conduce_auto',
  'print_preticket',
  'kiosk_mode',
  'kiosk_exit_pin',
  'kiosk_auto_lock_enabled',
  'kiosk_auto_lock_minutes',
  'default_form_pago',    // cashier's preferred default payment method
  'ncf_block_size',       // multi-POS block sizes (per-device config)
  'doc_block_size',
  'multi_pos_enabled',
])

// ── 3. DEVICE-ONLY (never leaves this machine) ───────────────────────────────
// Sync internals, caches, one-shot migration markers. Mirroring these to cloud
// would either be nonsense (sync_v3_supabase_id) or leak private state
// (license cache). Keep them local-only.
const DEVICE_SETTING_KEYS = new Set([
  'hwid',
  'supabase_business_id', 'last_pulled_business_id', 'business_id_changed_at',
  'sync_v3_supabase_id', 'sync_v4_ticket_resync', 'pull_reset_version',
  'updated_at_triggers_v2_done', 'updated_at_iso_migration_done',
  'salary_changes_nullable_empleado_id', 'schema_version', 'v2_1_orphans',
  'logo_synced_hash', 'logo_synced_url',
  'tx_lang', 'tx_last_valid', 'tx_license_cache', 'tx_license_cache_ts',
])

function isBusinessSetting(key)           { return BUSINESS_SETTING_KEYS.has(key) }
function isDeviceLocalCloudMirror(key)    { return DEVICE_LOCAL_CLOUD_MIRROR_KEYS.has(key) }
function isDeviceOnlySetting(key)         { return DEVICE_SETTING_KEYS.has(key) }
function isDeviceSetting(key)             { return DEVICE_LOCAL_CLOUD_MIRROR_KEYS.has(key) || DEVICE_SETTING_KEYS.has(key) }

module.exports = {
  BUSINESS_SETTING_KEYS,
  DEVICE_LOCAL_CLOUD_MIRROR_KEYS,
  DEVICE_SETTING_KEYS,
  isBusinessSetting,
  isDeviceLocalCloudMirror,
  isDeviceOnlySetting,
  isDeviceSetting,
}
