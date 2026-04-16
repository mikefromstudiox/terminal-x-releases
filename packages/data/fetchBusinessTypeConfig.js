// Phase 4 — Supabase-first business-type config fetcher with 24h local cache
// and hardcoded registry as permanent fallback. Offline-first guarantee.

import { BUSINESS_TYPES as HARDCODED, getBusinessTypeConfig } from '@terminal-x/config/businessTypes'
import { getSupabaseClient } from '@terminal-x/services/supabase'

const CACHE_KEY = 'tx_business_type_configs_v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (Date.now() - (parsed.fetchedAt || 0) > CACHE_TTL_MS) return null
    return parsed.data
  } catch { return null }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data })) } catch {}
}

function hardcodedMap() {
  const out = {}
  for (const [key, cfg] of Object.entries(HARDCODED)) {
    out[key] = {
      type: key,
      label: { es: cfg.label.es, en: cfg.label.en },
      description: { es: cfg.description.es, en: cfg.description.en },
      icon: cfg.icon,
      modules: cfg.modules,
      ui: cfg.ui,
      enabled: cfg.enabled !== false,
    }
  }
  return out
}

function normaliseRow(row) {
  return {
    type: row.type,
    label:       { es: row.label_es,       en: row.label_en },
    description: { es: row.description_es, en: row.description_en },
    icon:        row.icon,
    modules:     Array.isArray(row.modules) ? row.modules : (row.modules || []),
    ui:          row.ui || {},
    enabled:     !!row.enabled,
  }
}

/**
 * Resolve the full business-type registry. Tries Supabase first, falls back
 * to localStorage cache, finally to the hardcoded file. Never throws.
 */
export async function fetchBusinessTypeConfigs({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = readCache()
    if (cached) return cached
  }
  try {
    const sb = getSupabaseClient?.()
    if (sb) {
      const { data, error } = await sb.from('business_type_configs').select('*')
      if (!error && Array.isArray(data) && data.length > 0) {
        const map = {}
        for (const row of data) map[row.type] = normaliseRow(row)
        writeCache(map)
        return map
      }
    }
  } catch { /* swallow — network errors fall through to fallback */ }
  return hardcodedMap()
}

/** Single-type lookup. Same fallback chain. */
export async function fetchBusinessTypeConfig(type, opts) {
  const map = await fetchBusinessTypeConfigs(opts)
  return map[type] || map.carwash || getBusinessTypeConfig('carwash')
}
