// settingsWhitelist.js — classifies app_settings keys as business-level (cloud-synced)
// vs device-local (never synced). ESM mirror of electron/settingsWhitelist.js.
// Keep both files IDENTICAL.

// Business-level settings — cloud-synced. Same value on desktop, web, and every device in the business.
export const BUSINESS_SETTING_KEYS = new Set([
  'itbis_pct', 'usd_rate', 'rnc_verify', 'sucursales',
  'whatsapp_instance', 'whatsapp_token',
  'biz_name', 'biz_rnc', 'biz_address', 'biz_phone', 'biz_city', 'biz_type',
  'biz_email', 'biz_logo', 'biz_website',
  'business_type', 'biz_business_type',
  'ley_enabled',
  'go_live_date',
  // Add any future business-wide key here. If unsure, keep it device-local.
])

// Device-local settings — NEVER synced. Each POS/device has its own.
export const DEVICE_SETTING_KEYS = new Set([
  'printer',
  'print_factura_auto', 'print_conduce_auto', 'print_preticket',
  'hwid',
  'multi_pos_enabled',
  'ncf_block_size', 'doc_block_size',
  // sync internal state
  'supabase_business_id', 'last_pulled_business_id', 'business_id_changed_at',
  'sync_v3_supabase_id', 'sync_v4_ticket_resync', 'pull_reset_version',
  'logo_synced_hash', 'logo_synced_url',
  'tx_lang', 'tx_last_valid', 'tx_license_cache', 'tx_license_cache_ts',
])

export function isBusinessSetting(key) { return BUSINESS_SETTING_KEYS.has(key) }
export function isDeviceSetting(key)   { return DEVICE_SETTING_KEYS.has(key) }
// Unknown keys default to device-local (safe — won't leak to cloud accidentally)
