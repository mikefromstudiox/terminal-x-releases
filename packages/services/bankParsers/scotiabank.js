// scotiabank.js — Scotiabank República Dominicana statement adapter.
//
// Source: Scotia DR online banking exports OFX (Quicken/Money) directly.
// Statement export path: https://scotiabank.com.do (Banca en Línea →
// Mis Cuentas → Movimientos → Exportar → "OFX / Quicken / Money").
//
// Wraps the generic OFX parser and stamps banco='scotiabank'.

import { parseOFX } from './ofxParser.js'

export const banco = 'scotiabank'
export const supportedMimes = ['application/x-ofx', 'application/vnd.intu.qfx', 'text/plain']

export function parse(text) {
  const r = parseOFX(text)
  return { ok: r.lines.length > 0, banco, lines: r.lines, errors: r.errors }
}

export default { banco, parse, supportedMimes }
