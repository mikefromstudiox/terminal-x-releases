// bancoPopular.js — Banco Popular Dominicano statement adapter.
//
// Source: Banco Popular DR online banking exports OFX (Money/Quicken).
// Statement export path: https://www.popularenlinea.com (Mis Cuentas →
// Movimientos → Exportar → "OFX").
//
// Wraps the generic OFX parser and stamps banco='banco_popular'.

import { parseOFX } from './ofxParser.js'

export const banco = 'banco_popular'
export const supportedMimes = ['application/x-ofx', 'application/vnd.intu.qfx', 'text/plain']

export function parse(text) {
  const r = parseOFX(text)
  return { ok: r.lines.length > 0, banco, lines: r.lines, errors: r.errors }
}

export default { banco, parse, supportedMimes }
