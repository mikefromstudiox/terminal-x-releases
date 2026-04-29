// banreservas.js — Banco de Reservas (Banreservas) DR statement adapter.
//
// Banreservas Internet Banking exports CSV/PDF (no OFX) as of 2026-04-27.
// Uses the generic DR-bank CSV parser — auto-detects column names (Fecha,
// Concepto/Descripción, Referencia, Cargo/Débito, Abono/Crédito, Saldo).
//
// Source: https://www.banreservas.com (Internet Banking → Cuentas →
// Movimientos → Exportar → "Excel / CSV / PDF"). PDF support not implemented.

import { parseCSVStatement } from './csvParser.js'

export const banco = 'banreservas'
export const supportedMimes = ['text/csv', 'application/vnd.ms-excel', 'text/plain']

export function parse(text) {
  const r = parseCSVStatement(text)
  return { ok: r.lines.length > 0, banco, lines: r.lines, errors: r.errors }
}

export default { banco, parse, supportedMimes }
