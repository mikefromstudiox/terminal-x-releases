// banreservas.js — Banco de Reservas (Banreservas) DR statement adapter — STUB.
//
// Banreservas online banking only exports CSV/PDF (no OFX) as of 2026-04-27.
// Awaiting a real sample from a pilot client before shipping a parser.
//
// Source check: https://www.banreservas.com (Internet Banking → Cuentas →
// Movimientos → Exportar → "Excel / PDF").

export const banco = 'banreservas'
export const supportedMimes = []

export function parse() {
  return {
    ok: false,
    banco,
    lines: [],
    errors: ['Esperando muestra de estado de cuenta — contacta soporte para subir tu archivo CSV/PDF.'],
  }
}

export default { banco, parse, supportedMimes }
