// Terminal X — Contabilidad OCR adapter (Phase 1 stub).
//
// Phase 1: returns a `pending` envelope. The Bandeja UI lists docs as
// "OCR pendiente" and the contable classifies/posts manually.
// Phase 2 plugs Gemini 2.5 Flash vision (already in Content X stack) here:
// extract RNC, NCF, fecha, total, ITBIS, payment method, supplier name.
//
// Public API kept stable — Phase 2 only changes the internals.

/**
 * @typedef {Object} OcrEnvelope
 * @property {'pending'|'done'|'failed'} status
 * @property {string} text             plain-text dump from the doc
 * @property {Object} extracted        structured fields when status='done'
 * @property {string=} extracted.rnc
 * @property {string=} extracted.ncf
 * @property {string=} extracted.fecha    yyyy-mm-dd
 * @property {number=} extracted.total
 * @property {number=} extracted.itbis
 * @property {string=} extracted.supplier
 * @property {string=} error           when status='failed'
 */

/**
 * Run OCR over an arbitrary File / Blob / ArrayBuffer.
 * Phase 1 returns `pending` so the UI surfaces a manual-classify path.
 *
 * @param {File|Blob|ArrayBuffer|null} _file
 * @returns {Promise<OcrEnvelope>}
 */
export async function ocrDocument(_file) {
  return {
    status: 'pending',
    text: '',
    extracted: {},
  }
}

/**
 * Classify a doc by mime + filename heuristics. Used by the Bandeja drop
 * handler to pick a reasonable default `classified_type` before OCR runs.
 *
 * @param {{ name?: string, type?: string }} file
 * @returns {'ecf_xml'|'factura_pdf'|'retencion'|'banco_estado'|'tss'|'csv'|'contrato'|'otro'}
 */
export function heuristicClassify(file) {
  const name = String(file?.name || '').toLowerCase()
  const mime = String(file?.type || '').toLowerCase()
  if (mime.includes('xml') || name.endsWith('.xml')) return 'ecf_xml'
  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    if (/retenc/.test(name)) return 'retencion'
    if (/estado.*cuenta|banco|popular|reservas|bhd|scotia|santa.?cruz/.test(name)) return 'banco_estado'
    if (/tss|sello.?rojo/.test(name)) return 'tss'
    if (/contrato|poliza/.test(name)) return 'contrato'
    return 'factura_pdf'
  }
  if (mime.includes('csv') || name.endsWith('.csv') || name.endsWith('.xls') || name.endsWith('.xlsx')) return 'csv'
  return 'otro'
}
