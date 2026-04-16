import {
  getBusinessTypeConfig,
  BUSINESS_TYPE_KEYS,
  isBusinessTypeEnabled,
} from '@terminal-x/config/businessTypes'
import { SAMPLE_MESAS, SAMPLE_MENUS } from '@terminal-x/config/sampleMenus'

// Each seeder is idempotent — checks for existing data before inserting.
// A second call to setupBusinessType('restaurant') must not duplicate rows.

async function seedMesas(api) {
  try {
    const existing = await api?.mesas?.list?.() || []
    if (existing.length > 0) return  // already seeded or user-added mesas exist
    for (const [i, m] of SAMPLE_MESAS.entries()) {
      await api.mesas.create({ ...m, sort_order: i })
    }
  } catch (e) { console.warn('[setupBusinessType] seedMesas failed:', e?.message) }
}

async function seedSampleMenu(api, typeKey) {
  const menu = SAMPLE_MENUS[typeKey]
  if (!menu) return
  try {
    // Check if services already exist — if the business has ANY services, skip.
    const existingServices = await api?.services?.getAll?.() || []
    if (existingServices.length > 0) return

    // 1. Categorias (best-effort; some adapters may not expose the CRUD)
    if (api?.categorias?.create) {
      for (const c of menu.categorias) {
        try { await api.categorias.create(c) } catch {}
      }
    }

    // 2. Items as services, is_menu_item=1
    const nameToId = new Map()
    for (const item of menu.items) {
      try {
        const created = await api.services.create({
          ...item,
          is_menu_item: 1,
          active: 1,
        })
        if (created?.id) nameToId.set(item.name, created.id)
      } catch {}
    }

    // 3. Modificadores
    if (api?.modificadores?.create) {
      for (const mod of menu.modificadores) {
        try { await api.modificadores.create(mod) } catch {}
      }
    }
    // Note: attachments to specific items deferred — the operator can wire
    // "Punto de cocción" to steaks / "Acompañante" to mains via the Menu
    // Builder UI. Auto-attachment by category would be guesswork.
  } catch (e) { console.warn('[setupBusinessType] seedSampleMenu failed:', e?.message) }
}

async function seedKdsConfig(api, typeKey) {
  const menu = SAMPLE_MENUS[typeKey]
  if (!menu?.kds) return
  try {
    // Merge into existing settings (don't clobber unrelated keys)
    const current = (await api?.settings?.get?.()) || {}
    const patch = {}
    for (const [k, v] of Object.entries(menu.kds)) {
      if (current[k] == null) patch[k] = v  // only set if not already present
    }
    if (Object.keys(patch).length > 0) {
      await api?.settings?.update?.(patch)
    }
  } catch (e) { console.warn('[setupBusinessType] seedKdsConfig failed:', e?.message) }
}

export async function setupBusinessType(api, type) {
  if (!BUSINESS_TYPE_KEYS.includes(type)) {
    throw new Error(`Unknown business type: ${type}`)
  }
  if (!isBusinessTypeEnabled(type)) {
    throw new Error(`Business type "${type}" is not enabled yet.`)
  }
  const config = getBusinessTypeConfig(type)

  await api?.settings?.update?.({ business_type: type })

  // Module-dispatched seeding. Each seeder is idempotent.
  if (config.modules.includes('tables')) await seedMesas(api)
  if (config.modules.includes('menu'))   await seedSampleMenu(api, type)
  if (config.modules.includes('kds'))    await seedKdsConfig(api, type)

  return { type, config }
}
