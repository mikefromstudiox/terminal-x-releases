// bankParsers/index.js — Plugin registry for DR bank statement parsers.
//
// Public API:
//   detectFormat(content) → { bank, format } | null
//   parseStatement({ content, mime, banco }) → { ok, banco, lines, errors }
//   PARSERS                 — keyed registry for UI dropdowns
//   SUPPORTED_BANKS         — entries the UI may show as "selectable now"
//   COMING_SOON_BANKS       — entries the UI may show as "Próximamente"
//
// Phase 2 Slice 3 ship: OFX-only via Scotiabank + Banco Popular.
// BHD León + Banreservas return "not yet supported" until we receive samples.

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

export const SUPPORTED_BANKS   = ['scotiabank', 'banco_popular']
export const COMING_SOON_BANKS = ['bhd_leon', 'banreservas']

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
