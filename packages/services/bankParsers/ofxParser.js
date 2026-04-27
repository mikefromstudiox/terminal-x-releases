// ofxParser.js — OFX 1.x (SGML) + OFX 2.x (XML) statement parser.
//
// Spec source:
//   OFX 2.2 Specification (Open Financial Exchange) — https://www.ofx.org/downloads.html
//   OFX 1.6 SGML format (legacy) — https://www.ofx.org/downloads.html
//
// We extract the BANKMSGSRSV1 → STMTTRNRS → STMTRS → BANKTRANLIST block,
// iterating <STMTTRN> elements. Each transaction yields:
//   { fecha, descripcion, referencia, debit, credit, balance }
//
// Sign convention: TRNAMT < 0 → debit (money out); TRNAMT > 0 → credit (money in).
// Closing LEDGERBAL.BALAMT is attached to the LAST transaction line so the UI
// can display a running balance without re-deriving it.
//
// Parser strategy:
//   - 2.x (XML): detect by leading `<?xml` prolog → parse with @xmldom/xmldom.
//   - 1.x (SGML): fallback regex tokenizer over normalized SGML (we strip the
//     header block and convert unclosed tags into a flat KV stream).

import { DOMParser } from '@xmldom/xmldom'

const STMTTRN_RE_SGML = /<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>)/gi
const TAG_RE_SGML     = /<([A-Z0-9.]+)>([^<\r\n]*)/gi

function parseDateOFX(s) {
  if (!s) return null
  // YYYYMMDD or YYYYMMDDHHMMSS or YYYYMMDDHHMMSS.XXX[GMT]
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

function num(v) {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/,/g, '.'))
  return Number.isFinite(n) ? n : 0
}

function clean(s) { return (s == null ? '' : String(s)).trim() }

function parseXmlOfx(text, errors) {
  try {
    const doc = new DOMParser({
      errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
    }).parseFromString(text, 'text/xml')
    const tx = []
    const trns = doc.getElementsByTagName('STMTTRN')
    for (let i = 0; i < trns.length; i++) {
      const t = trns[i]
      const get = (tag) => {
        const el = t.getElementsByTagName(tag)[0]
        return el ? clean(el.textContent) : ''
      }
      const dt   = parseDateOFX(get('DTPOSTED'))
      const amt  = num(get('TRNAMT'))
      const memo = get('MEMO') || get('NAME')
      const fid  = get('FITID')
      tx.push({
        fecha: dt,
        descripcion: memo || get('TRNTYPE') || '',
        referencia: fid || get('CHECKNUM') || '',
        debit:  amt < 0 ? Math.abs(amt) : 0,
        credit: amt > 0 ? amt : 0,
        balance: null,
      })
    }
    const ledger = doc.getElementsByTagName('LEDGERBAL')[0]
    if (ledger && tx.length) {
      const balEl = ledger.getElementsByTagName('BALAMT')[0]
      if (balEl) tx[tx.length - 1].balance = num(clean(balEl.textContent))
    }
    return tx
  } catch (e) {
    errors.push(`OFX 2.x parse: ${e?.message || e}`)
    return []
  }
}

function parseSgmlOfx(text, errors) {
  try {
    const start = text.search(/<OFX>/i)
    const body  = start >= 0 ? text.slice(start) : text
    const tx = []
    let m
    STMTTRN_RE_SGML.lastIndex = 0
    while ((m = STMTTRN_RE_SGML.exec(body)) !== null) {
      const block = m[1]
      const kv = {}
      let t
      TAG_RE_SGML.lastIndex = 0
      while ((t = TAG_RE_SGML.exec(block)) !== null) {
        kv[t[1].toUpperCase()] = clean(t[2])
      }
      const amt = num(kv.TRNAMT)
      tx.push({
        fecha: parseDateOFX(kv.DTPOSTED),
        descripcion: kv.MEMO || kv.NAME || kv.TRNTYPE || '',
        referencia: kv.FITID || kv.CHECKNUM || '',
        debit:  amt < 0 ? Math.abs(amt) : 0,
        credit: amt > 0 ? amt : 0,
        balance: null,
      })
    }
    // LEDGERBAL on last line
    const balMatch = body.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i)
    if (balMatch && tx.length) tx[tx.length - 1].balance = num(clean(balMatch[1]))
    return tx
  } catch (e) {
    errors.push(`OFX 1.x parse: ${e?.message || e}`)
    return []
  }
}

/**
 * Parse OFX content (1.x SGML or 2.x XML).
 * @param {string} text
 * @returns {{ lines: Array, errors: string[] }}
 */
export function parseOFX(text) {
  const errors = []
  if (!text || typeof text !== 'string') {
    return { lines: [], errors: ['Contenido OFX vacío.'] }
  }
  const isXml = /^\s*<\?xml/i.test(text)
  const lines = isXml ? parseXmlOfx(text, errors) : parseSgmlOfx(text, errors)
  if (!lines.length && !errors.length) errors.push('No se encontraron transacciones (<STMTTRN>).')
  return { lines, errors }
}

export default { parseOFX }
