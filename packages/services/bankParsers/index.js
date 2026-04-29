// bankParsers/index.js — Plugin registry for DR bank statement parsers.
//
// Public API:
//   detectFormat(content) → { bank, format } | null
//   parseStatement({ content, mime, banco }) → { ok, banco, lines, errors }
//   PARSERS                 — keyed registry for UI dropdowns
//   SUPPORTED_BANKS         — entries the UI may show as "selectable now"
//   COMING_SOON_BANKS       — entries the UI may show as "Próximamente"
//
// Phase 3 ship (2026-04-27): all 4 banks live.
//   - Scotiabank, Banco Popular: OFX
//   - BHD León, Banreservas: CSV (generic DR-bank parser)

import scotiabank from './scotiabank.js'
import bancoPopular from './bancoPopular.js'
import bhdLeon from './bhdLeon.js'
import banreservas from './banreservas.js'

export const PARSERS = {
  scotiabank,
  banco_popular: bancoPopular,
  bhd_leon: bhdLeon,
  banreservas,
}

export const BANK_LABELS = {
  scotiabank:    'Scotiabank',
  banco_popular: 'Banco Popular',
  bhd_leon:      'BHD León',
  banreservas:   'Banreservas',
  otro:          'Otro',
}

export const SUPPORTED_BANKS   = ['scotiabank', 'banco_popular', 'bhd_leon', 'banreservas']
export const COMING_SOON_BANKS = []

/**
 * Sniff content for OFX format. Returns null when fingerprint not recognized
 * so the caller can fall back to a manual banco picker.
 */
export function detectFormat(content) {
  if (!content || typeof content !== 'string') return null
  const head = content.slice(0, 512).toUpperCase()
  if (head.includes('OFXHEADER') || /<\?XML/.test(head) || head.includes('<OFX>')) {
    return { bank: null, format: 'ofx' }
  }
  // CSV heuristic — first 5 non-empty lines have at least 3 commas/pipes/tabs each
  const lines = content.split(/\r?\n/).filter(l => l.trim()).slice(0, 5)
  if (lines.length >= 2) {
    const sepCounts = lines.map(l => Math.max(
      (l.match(/,/g) || []).length,
      (l.match(/;/g) || []).length,
      (l.match(/\|/g) || []).length,
      (l.match(/\t/g) || []).length,
    ))
    if (sepCounts.every(c => c >= 3)) return { bank: null, format: 'csv' }
  }
  return null
}

/**
 * Parse a statement. Caller passes the explicit `banco` (the user picks it on
 * the importer screen because BHD/Banreservas can't be auto-detected).
 */
export function parseStatement({ content, banco }) {
  const parser = PARSERS[banco]
  if (!parser) {
    return { ok: false, banco: banco || 'otro', lines: [], errors: [`Banco no soportado: ${banco || 'desconocido'}`] }
  }
  return parser.parse(content)
}

export default { PARSERS, BANK_LABELS, SUPPORTED_BANKS, COMING_SOON_BANKS, detectFormat, parseStatement }
