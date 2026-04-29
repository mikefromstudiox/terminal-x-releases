// bhdLeon.js — BHD León (BHD Bank) DR statement adapter.
//
// BHD's online banking exports CSV/PDF (no OFX) as of 2026-04-27. We use the
// generic DR-bank CSV parser which auto-detects column names and handles the
// common DR formats (Fecha, Descripción, Documento, Débito, Crédito, Balance).
//
// Source: https://www.bhd.com.do (Banca Empresas → Mis Cuentas → Movimientos
// → Exportar → "Excel / CSV / PDF"). PDF parsing is not yet supported.

import { parseCSVStatement } from './csvParser.js'

export const banco = 'bhd_leon'
export const supportedMimes = ['text/csv', 'application/vnd.ms-excel', 'text/plain']

export function parse(text) {
  const r = parseCSVStatement(text)
  return { ok: r.lines.length > 0, banco, lines: r.lines, errors: r.errors }
}

export default { banco, parse, supportedMimes }
