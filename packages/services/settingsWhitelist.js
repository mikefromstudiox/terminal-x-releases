// settingsWhitelist.js — classifies app_settings keys by scope.
// ESM mirror of electron/settingsWhitelist.js — keep IDENTICAL.
//
// Three categories:
//   1. BUSINESS_SETTING_KEYS  — cloud-synced, business-wide.
//   2. DEVICE_LOCAL_CLOUD_MIRROR_KEYS — v2.10.5: device-local but cloud-mirrored
//      tagged with HWID. Recovery-safe on same hardware; rows from a different
//      HWID are ignored so device A's printer never lands on device B.
//   3. DEVICE_SETTING_KEYS — device-only, never leaves this machine.

export const BUSINESS_SETTING_KEYS = new Set([
  'itbis_pct', 'usd_rate', 'rnc_verify', 'sucursales',
  'whatsapp_instance', 'whatsapp_token',
  'biz_name', 'biz_rnc', 'biz_address', 'biz_phone', 'biz_city', 'biz_type',
  'biz_email', 'biz_logo', 'biz_website',
  'direccion',
  // Per-business receipt customization (v1)
  'receipt_show_itbis_pct',
  'receipt_show_commission',
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
  // loyalty override (feature_loyalty_enabled) intentionally NOT added —
  // reuse existing `loyalty_enabled` above for that feature.
])

export const DEVICE_LOCAL_CLOUD_MIRROR_KEYS = new Set([
  'printer',
  'drawer_pulse_hex',
  'print_factura_auto',
  'print_conduce_auto',
  'print_preticket',
  'kiosk_mode',
  'kiosk_exit_pin',
  'kiosk_auto_lock_enabled',
  'kiosk_auto_lock_minutes',
  'default_form_pago',
  'ncf_block_size',
  'doc_block_size',
  'multi_pos_enabled',
])

export const DEVICE_SETTING_KEYS = new Set([
  'hwid',
  'supabase_business_id', 'last_pulled_business_id', 'business_id_changed_at',
  'sync_v3_supabase_id', 'sync_v4_ticket_resync', 'pull_reset_version',
  'updated_at_triggers_v2_done', 'updated_at_iso_migration_done',
  'salary_changes_nullable_empleado_id', 'schema_version', 'v2_1_orphans',
  'logo_synced_hash', 'logo_synced_url',
  'tx_lang', 'tx_last_valid', 'tx_license_cache', 'tx_license_cache_ts',
])

export function isBusinessSetting(key)        { return BUSINESS_SETTING_KEYS.has(key) }
export function isDeviceLocalCloudMirror(key) { return DEVICE_LOCAL_CLOUD_MIRROR_KEYS.has(key) }
export function isDeviceOnlySetting(key)      { return DEVICE_SETTING_KEYS.has(key) }
export function isDeviceSetting(key)          { return DEVICE_LOCAL_CLOUD_MIRROR_KEYS.has(key) || DEVICE_SETTING_KEYS.has(key) }
// Unknown keys default to device-local (safe — won't leak to cloud accidentally).
