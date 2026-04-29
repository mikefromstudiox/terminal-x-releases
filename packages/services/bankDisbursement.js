// Pago Masivo / Nómina — bank disbursement file generators for Dominican banks.
//
// Inputs are `accounting_payroll_lines` rows that were enriched with beneficiary
// bank info (`cuenta_destino`, `banco_destino`, `tipo_cuenta`). Lines that are
// missing `cuenta_destino` are excluded and returned in `excluded` so the
// contadora can fix the roster before re-exporting.
//
// All three generators share the same shape:
//   { filename: string, content: string, included: line[], excluded: line[],
//     totalAmount: number, count: number, warnings: string[] }
//
// Pure JS, zero deps. Spanish comments mirror what the contadora sees.
//
// IMPORTANT: DR banks update the exact column order / separators of their Pago
// Masivo templates from time to time. The actual format the bank's portal
// accepts on a given day overrides anything here. The `genericCsv` fallback is
// always a safe "open in Excel and adjust" output.

// ── Helpers ───────────────────────────────────────────────────────────────────

const ASCII_REPLACE = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ñ: 'N', Ü: 'U',
}
function stripAccents(s) {
  return String(s || '').replace(/[áéíóúñüÁÉÍÓÚÑÜ]/g, (c) => ASCII_REPLACE[c] || c)
}
function digits(s, max) {
  const d = String(s || '').replace(/\D+/g, '')
  return max ? d.slice(0, max) : d
}
function num2(n) {
  return Number(n || 0).toFixed(2)
}
function csvField(s) {
  const v = String(s ?? '')
  return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
function pad(s, len, fillChar = ' ', align = 'left') {
  const v = String(s ?? '')
  if (v.length >= len) return v.slice(0, len)
  const fill = fillChar.repeat(len - v.length)
  return align === 'right' ? fill + v : v + fill
}

function rncDigits(rnc) { return digits(rnc, 11) }

// Tipo de cuenta normalized to bank-portal vocabulary.
//   corriente → 'CC' / '1'   ahorros → 'CA' / '2'
function tipoCuentaCode(tipo, dialect = 'short') {
  const t = String(tipo || '').toLowerCase()
  if (dialect === 'numeric') return t === 'corriente' ? '1' : t === 'ahorros' ? '2' : '0'
  return t === 'corriente' ? 'CC' : t === 'ahorros' ? 'CA' : ''
}

function todayYYYYMMDD(d) {
  const x = d ? new Date(d) : new Date()
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`
}
function periodTagFromDate(d) {
  const x = d ? new Date(d) : new Date()
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}`
}

function partition(lines) {
  const included = []
  const excluded = []
  for (const l of lines || []) {
    const cuenta = digits(l?.cuenta_destino)
    const monto  = Number(l?.neto || 0)
    if (!cuenta) {
      excluded.push({ ...l, _reason: 'cuenta_destino faltante' })
    } else if (!(monto > 0)) {
      excluded.push({ ...l, _reason: 'neto cero o negativo' })
    } else {
      included.push(l)
    }
  }
  return { included, excluded }
}

function totalOf(included) {
  return included.reduce((s, l) => s + Number(l.neto || 0), 0)
}

function safeFilename(s) {
  return stripAccents(String(s || ''))
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

function warningsFromExcluded(excluded) {
  if (!excluded.length) return []
  const names = excluded.map(l => l.employee_name || l.employee_cedula || 's/n').slice(0, 12)
  const more  = excluded.length > 12 ? ` (+${excluded.length - 12} más)` : ''
  return [`Excluidos por falta de cuenta o monto inválido: ${names.join(', ')}${more}`]
}

// ── BHD León — Pago Masivo (CSV) ─────────────────────────────────────────────
//
// Columnas (header incluido, separador coma, UTF-8 sin BOM):
//   Cuenta_Origen, Cuenta_Destino, Banco_Destino_Codigo, Tipo_Cuenta,
//   Monto, Cedula_Beneficiario, Nombre_Beneficiario, Concepto,
//   Email_Notificacion, Referencia
//
// Banco_Destino_Codigo: si el banco destino es BHD se acepta vacío. Para otros
// bancos, se envía el código ABA del banco destino en mayúsculas
// (BHD/BRES/POPULAR/SCOTIA/PROGRESO/CARIBE/SANTACRUZ/PROMERICA/LAFISE/ADEMI/
// ADOPEM…). El valor se pasa tal cual venga en `banco_destino`; si el portal
// rechaza, la contadora corrige y reexporta.
export function genBhdLeonNomina(payrollLines, opts = {}) {
  const {
    rncEmpresa,
    cuentaOrigen,
    fecha,                 // 'YYYY-MM-DD' or Date — used only for filename tag
    concepto = 'Nomina',
    referencia = '',
    emailNotificacion = '',
  } = opts || {}

  const { included, excluded } = partition(payrollLines)
  const cuentaOrig = digits(cuentaOrigen)

  const header = [
    'Cuenta_Origen', 'Cuenta_Destino', 'Banco_Destino_Codigo', 'Tipo_Cuenta',
    'Monto', 'Cedula_Beneficiario', 'Nombre_Beneficiario', 'Concepto',
    'Email_Notificacion', 'Referencia',
  ].join(',')

  const rows = included.map((l) => {
    const cols = [
      cuentaOrig,
      digits(l.cuenta_destino),
      stripAccents(l.banco_destino || 'BHD').toUpperCase(),
      tipoCuentaCode(l.tipo_cuenta, 'short'),               // CC / CA
      num2(l.neto),
      digits(l.employee_cedula, 11),
      stripAccents(l.employee_name || '').toUpperCase().slice(0, 60),
      stripAccents(concepto).slice(0, 40),
      String(l.employee_email || emailNotificacion || '').slice(0, 80),
      stripAccents(referencia || `Nomina ${periodTagFromDate(fecha)}`).slice(0, 30),
    ].map(csvField).join(',')
    return cols
  })

  const content = [header, ...rows].join('\r\n') + '\r\n'
  const filename = safeFilename(`BHD_NOMINA_${rncDigits(rncEmpresa)}_${periodTagFromDate(fecha)}.csv`)

  return {
    filename,
    content,
    included,
    excluded,
    totalAmount: totalOf(included),
    count: included.length,
    warnings: warningsFromExcluded(excluded),
    bank: 'bhd_leon',
  }
}

// ── Banreservas — Pago a Terceros / Nómina (TXT pipe-delimited) ──────────────
//
// Header line (1 row):
//   H|<RNC empresa>|<fecha YYYYMMDD>|<count>|<monto total>
// Detail rows (N rows):
//   D|<cuenta destino>|<monto>|<cedula>|<nombre>|<concepto>|<tipo cuenta>|<banco>
//
// Encoding ASCII (acentos removidos). EOL: CRLF. Filename:
//   BANRESERVAS_NOMINA_<RNC>_<YYYYMM>.txt
export function genBanreservasNomina(payrollLines, opts = {}) {
  const {
    rncEmpresa,
    cuentaOrigen,          // se usa solo en el header de bitácora, no exigido por portal
    fecha,                 // YYYY-MM-DD or Date
    concepto = 'Nomina',
  } = opts || {}

  const { included, excluded } = partition(payrollLines)
  const total = totalOf(included)
  const headerCols = [
    'H',
    rncDigits(rncEmpresa),
    todayYYYYMMDD(fecha),
    String(included.length),
    num2(total),
  ]
  if (cuentaOrigen) headerCols.push(digits(cuentaOrigen))

  const lines = [headerCols.join('|')]

  for (const l of included) {
    const detail = [
      'D',
      digits(l.cuenta_destino),
      num2(l.neto),
      digits(l.employee_cedula, 11),
      stripAccents(l.employee_name || '').toUpperCase().slice(0, 60),
      stripAccents(concepto).slice(0, 40),
      tipoCuentaCode(l.tipo_cuenta, 'numeric'),         // 1 / 2
      stripAccents(l.banco_destino || 'BRES').toUpperCase(),
    ].join('|')
    lines.push(detail)
  }

  const content = lines.join('\r\n') + '\r\n'
  const filename = safeFilename(`BANRESERVAS_NOMINA_${rncDigits(rncEmpresa)}_${periodTagFromDate(fecha)}.txt`)

  return {
    filename,
    content,
    included,
    excluded,
    totalAmount: total,
    count: included.length,
    warnings: warningsFromExcluded(excluded),
    bank: 'banreservas',
  }
}

// ── CSV genérico (otro banco) ─────────────────────────────────────────────────
//
// Universal CSV the contadora can adapt for cualquier banco que no tenga
// plantilla específica. Encabezado en español, separador coma, EOL CRLF, UTF-8
// con BOM (Excel-friendly).
export function genGenericCsvNomina(payrollLines, opts = {}) {
  const {
    rncEmpresa,
    cuentaOrigen = '',
    fecha,
    concepto = 'Nomina',
  } = opts || {}

  const { included, excluded } = partition(payrollLines)

  const header = [
    'Cuenta Origen', 'Cuenta Destino', 'Banco Destino', 'Tipo Cuenta',
    'Monto', 'Cedula', 'Nombre', 'Concepto', 'Email', 'NSS',
  ].join(',')

  const rows = included.map((l) => [
    digits(cuentaOrigen),
    digits(l.cuenta_destino),
    stripAccents(l.banco_destino || '').toUpperCase(),
    String(l.tipo_cuenta || '').toLowerCase(),
    num2(l.neto),
    digits(l.employee_cedula, 11),
    stripAccents(l.employee_name || ''),
    stripAccents(concepto),
    String(l.employee_email || ''),
    digits(l.employee_nss),
  ].map(csvField).join(','))

  const content = '﻿' + [header, ...rows].join('\r\n') + '\r\n'
  const filename = safeFilename(`PAGO_NOMINA_${rncDigits(rncEmpresa)}_${periodTagFromDate(fecha)}.csv`)

  return {
    filename,
    content,
    included,
    excluded,
    totalAmount: totalOf(included),
    count: included.length,
    warnings: warningsFromExcluded(excluded),
    bank: 'generic',
  }
}

// ── Browser download helper (no new dep) ─────────────────────────────────────
export function downloadBankFile({ filename, content }, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Convenience dispatcher used by the UI.
export function generateDisbursement(bank, payrollLines, opts) {
  switch (bank) {
    case 'bhd_leon':    return genBhdLeonNomina(payrollLines, opts)
    case 'banreservas': return genBanreservasNomina(payrollLines, opts)
    case 'generic':
    default:            return genGenericCsvNomina(payrollLines, opts)
  }
}

export default {
  genBhdLeonNomina,
  genBanreservasNomina,
  genGenericCsvNomina,
  generateDisbursement,
  downloadBankFile,
}
