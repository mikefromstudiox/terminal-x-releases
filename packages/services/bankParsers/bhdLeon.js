// bhdLeon.js — BHD León (BHD Bank) DR statement adapter — STUB.
//
// BHD's online banking only exports CSV/PDF (no OFX) as of 2026-04-27.
// We need a real CSV sample from a pilot client before shipping a parser, so
// this entry deliberately returns an explicit "not yet supported" envelope.
//
// Source check: https://www.bhd.com.do (Banca Digital → Mis Cuentas →
// Movimientos → Exportar → "Excel / CSV / PDF").

export const banco = 'bhd_leon'
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
