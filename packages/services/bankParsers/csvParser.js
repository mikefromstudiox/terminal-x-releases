// csvParser.js — Generic DR-bank CSV statement parser.
//
// DR banks (BHD León, Banreservas, others) only export CSV/PDF — never OFX.
// Their CSVs share a common shape: Fecha | Descripción | Referencia | Débito |
// Crédito | Saldo (column names and order vary slightly).
//
// This parser:
//   1. Auto-detects separator (`,`, `;`, `|`, tab)
//   2. Maps column names with accent + case + synonym tolerance
//   3. Handles dd/mm/yyyy, yyyy-mm-dd, dd-mm-yyyy
//   4. Handles "1,234.56" (US) and "1.234,56" (DR/EU) decimals
//   5. Accepts split débito/crédito columns OR a signed amount column
//   6. Strips currency markers (RD$, $, DOP, etc.)
//
// Returns { lines: [{ fecha, descripcion, referencia, debit, credit, balance }] }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

const HEADER_MAP = {
  fecha:       ['fecha', 'fecha movimiento', 'fecha mov', 'fecha trans', 'fecha transaccion', 'date', 'f. movimiento', 'f. mov'],
  descripcion: ['descripcion', 'descripción', 'descripcion movimiento', 'concepto', 'detalle', 'description', 'memo', 'narrativa'],
  referencia:  ['referencia', 'documento', 'no. documento', 'no documento', 'ref', 'reference', 'comprobante', 'transaccion', 'numero'],
  debit:       ['debito', 'débito', 'cargo', 'cargos', 'salida', 'salidas', 'retiro', 'retiros', 'debit', 'debe'],
  credit:      ['credito', 'crédito', 'abono', 'abonos', 'entrada', 'entradas', 'deposito', 'depósito', 'credit', 'haber'],
  amount:      ['monto', 'importe', 'amount', 'valor', 'transaccion'],
  balance:     ['balance', 'saldo', 'saldo total', 'saldo final', 'running balance'],
}

function detectSeparator(line) {
  const counts = {
    ',':  (line.match(/,/g)  || []).length,
    ';':  (line.match(/;/g)  || []).length,
    '|':  (line.match(/\|/g) || []).length,
    '\t': (line.match(/\t/g) || []).length,
  }
  let best = ',', max = 0
  for (const [k, v] of Object.entries(counts)) {
    if (v > max) { max = v; best = k }
  }
  return best
}

// Split CSV row honoring "quoted, fields"
function splitRow(row, sep) {
  const out = []
  let cur = '', inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = !inQuotes }
    } else if (ch === sep && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map(c => c.trim().replace(/^["']|["']$/g, ''))
}

function parseDateAny(s) {
  if (!s) return null
  const t = String(s).trim()
  if (!t) return null
  // ISO yyyy-mm-dd
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`
  // dd/mm/yyyy or dd-mm-yyyy
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/)
  if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`
  // dd/mm/yy
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/)
  if (m) {
    const yy = Number(m[3])
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy
    return `${yyyy}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`
  }
  // yyyymmdd
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

function parseAmount(s) {
  if (s == null || s === '') return 0
  let v = String(s).replace(/[^\d.,\-+()]/g, '').trim()
  if (!v) return 0
  // Parens = negative (accounting convention)
  let neg = false
  if (/^\(.*\)$/.test(v)) { neg = true; v = v.slice(1, -1) }
  if (v.startsWith('-')) { neg = true; v = v.slice(1) }
  if (v.startsWith('+')) { v = v.slice(1) }
  // Decimal heuristic: if both `,` and `.` present, the LAST one is the decimal.
  const lastComma = v.lastIndexOf(',')
  const lastDot   = v.lastIndexOf('.')
  if (lastComma > lastDot) {
    // DR/EU: "1.234,56" → strip dots, comma → dot
    v = v.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    // US: "1,234.56" → strip commas
    v = v.replace(/,/g, '')
  } else if (lastComma >= 0) {
    // Only commas: assume decimal if exactly one comma followed by 1-2 digits
    if (/,\d{1,2}$/.test(v)) v = v.replace(',', '.')
    else v = v.replace(/,/g, '')
  }
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return neg ? -n : n
}

function findHeaderRow(rows, sep) {
  // Some banks put junk rows above the header (account info, period, etc.).
  // Scan first 15 rows for one that contains at least 'fecha' AND ('debito'
  // OR 'credito' OR 'monto' OR 'descripcion').
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = splitRow(rows[i], sep).map(norm)
    const hasFecha = cells.some(c => HEADER_MAP.fecha.includes(c))
    const hasDescOrAmount = cells.some(c =>
      HEADER_MAP.descripcion.includes(c) ||
      HEADER_MAP.debit.includes(c) ||
      HEADER_MAP.credit.includes(c) ||
      HEADER_MAP.amount.includes(c))
    if (hasFecha && hasDescOrAmount) return i
  }
  return 0
}

function mapHeaders(headerCells) {
  const idx = {}
  for (const [k, alts] of Object.entries(HEADER_MAP)) {
    const i = headerCells.findIndex(h => alts.includes(h))
    if (i >= 0) idx[k] = i
  }
  return idx
}

/**
 * Parse a DR-bank CSV statement.
 * @param {string} text
 * @returns {{ lines: Array, errors: string[] }}
 */
export function parseCSVStatement(text) {
  const errors = []
  if (!text || typeof text !== 'string') return { lines: [], errors: ['Contenido vacío.'] }
  const allRows = text.split(/\r?\n/).map(l => l.replace(/^﻿/, '')).filter(l => l.trim())
  if (allRows.length < 2) return { lines: [], errors: ['CSV demasiado corto.'] }
  const sep = detectSeparator(allRows[0])
  const headerIdx = findHeaderRow(allRows, sep)
  const headerCells = splitRow(allRows[headerIdx], sep).map(norm)
  const idx = mapHeaders(headerCells)
  if (idx.fecha == null) {
    errors.push('No se encontró columna de fecha en la cabecera.')
    return { lines: [], errors }
  }
  const hasSplitColumns = idx.debit != null || idx.credit != null
  const hasAmount = idx.amount != null
  if (!hasSplitColumns && !hasAmount) {
    errors.push('No se encontraron columnas de débito/crédito ni monto firmado.')
    return { lines: [], errors }
  }
  const lines = []
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const cells = splitRow(allRows[i], sep)
    if (cells.length < 2) continue
    if (cells.every(c => !c.trim())) continue
    const fecha = parseDateAny(cells[idx.fecha])
    if (!fecha) continue // skip totals / blank / footer rows
    let debit = 0, credit = 0
    if (hasSplitColumns) {
      debit  = parseAmount(idx.debit  != null ? cells[idx.debit]  : 0)
      credit = parseAmount(idx.credit != null ? cells[idx.credit] : 0)
      // If both columns have values OR none, skip suspicious rows
      if (debit < 0) debit = Math.abs(debit)
      if (credit < 0) credit = Math.abs(credit)
    } else {
      const amt = parseAmount(cells[idx.amount])
      if (amt < 0) debit = Math.abs(amt)
      else credit = amt
    }
    if (debit === 0 && credit === 0) continue
    lines.push({
      fecha,
      descripcion: idx.descripcion != null ? (cells[idx.descripcion] || '').trim() : '',
      referencia:  idx.referencia  != null ? (cells[idx.referencia]  || '').trim() : '',
      debit,
      credit,
      balance: idx.balance != null ? parseAmount(cells[idx.balance]) || null : null,
    })
  }
  if (!lines.length && !errors.length) errors.push('No se detectaron transacciones (verifica formato del CSV).')
  return { lines, errors }
}

export default { parseCSVStatement }
