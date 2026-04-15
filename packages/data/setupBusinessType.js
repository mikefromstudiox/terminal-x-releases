// Idempotent seeder for switching or initializing a business type.
//
// Phase 1: persists the type selection to SQLite app_settings + Supabase
// businesses.settings.business_type via api.settings.update(). Safe to call
// repeatedly; no data drops, only additive writes.
//
// Phase 2 will expand this to seed per-type defaults (mesas, sample menus,
// modifiers, KDS config) via a module-dispatch table.

import { getBusinessTypeConfig, BUSINESS_TYPE_KEYS, isBusinessTypeEnabled } from '@terminal-x/config/businessTypes'

/**
 * Persist a business-type change. Safe to call on first-time setup AND on
 * admin-initiated type switches. Never deletes existing data.
 *
 * @param {object} api          Return value of useAPI()
 * @param {string} type         Canonical business type key
 * @returns {Promise<{ type: string, config: object }>}
 */
export async function setupBusinessType(api, type) {
  if (!BUSINESS_TYPE_KEYS.includes(type)) {
    throw new Error(`Unknown business type: ${type}`)
  }
  if (!isBusinessTypeEnabled(type)) {
    throw new Error(`Business type "${type}" is not enabled yet.`)
  }

  const config = getBusinessTypeConfig(type)

  try {
    await api?.settings?.update?.({ business_type: type })
  } catch (e) {
    console.error('[setupBusinessType] failed to persist business_type:', e)
    throw e
  }

  // ── Phase 2 hook ────────────────────────────────────────────────────────
  // Per-module seeding goes here, dispatched off config.modules. Each seeder
  // must be idempotent (WHERE NOT EXISTS guards) so calling setupBusinessType
  // on an existing restaurant doesn't duplicate mesas or menu items.
  //
  //   if (config.modules.includes('tables'))   await seedMesas(api)
  //   if (config.modules.includes('menu'))     await seedSampleMenu(api, type)
  //   if (config.modules.includes('kds'))      await seedKdsConfig(api)
  // ────────────────────────────────────────────────────────────────────────

  return { type, config }
}
