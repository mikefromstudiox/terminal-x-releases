// Comprobantes — per-client compras/ventas/anulados register + DGII 606/607/608.
// Source of truth: accounting_comprobantes (Supabase). Bulk CSV import supported.
import { useState, useMemo, useEffect, useCallback } from 'react'
import { FileText, Download, Upload, Trash2, Plus, Loader2, GitCompare, AlertTriangle, Check } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useRNC } from '../../hooks/useRNC'
import { classifyComprobante, CATEGORY_LABELS } from '@terminal-x/services/dgiiClassifier.js'
import { buildIt1Summary, genIR17, genIR13, filenameFor } from '@terminal-x/services/dgiiComprobantes.js'

const MONTHS = [
  '01 - Enero','02 - Febrero','03 - Marzo','04 - Abril','05 - Mayo','06 - Junio',
  '07 - Julio','08 - Agosto','09 - Septiembre','10 - Octubre','11 - Noviembre','12 - Diciembre',
]

const KIND_LABEL = { compra: 'Compras (606)', venta: 'Ventas (607)', anulado: 'Anulados (608)' }
const ITBIS_LABEL = { 18: '18%', 16: '16%', 0: '0%', '-1': 'Exento' }

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDateDDMMYYYY(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}
function pad(n, w) { return String(n).padStart(w, '0') }

// ─── DGII TXT generators (606/607/608) ──────────────────────────────────────
// Spec: DGII formato 606 / 607 / 608 (rev. 2026). Pipe-delimited. ITBIS rate
// not in the wire format (DGII derives it from monto_facturado / itbis_facturado),
// but we honor the user's rate for accurate ITBIS calc on 0%/exento rows.
// Norma 06-23: 606 includes 4 ITBIS columns (facturado, retenido, proporcionalidad,
// llevado_al_costo) + Tipo Bienes y Servicios (1-11 per Norma 07-18). Default
// tipo_bs = 1 (Gastos de Personal) when contadora hasn't classified yet.
function gen606(rows, rncEmisor, year, month) {
  const rnc = (rncEmisor || '').replace(/\D/g, '')
  const period = `${year}${pad(month, 2)}`
  const lines = rows.map(r => [
    (r.rnc_contraparte || '').replace(/\D/g, ''),
    r.tipo_id === 'cedula' ? '2' : '1',
    String(r.tipo_bienes_servicios || 1).padStart(2, '0'),
    r.ncf || '',
    r.ncf_modificado || '',
    r.fecha_comprobante ? r.fecha_comprobante.replace(/-/g, '') : '',
    r.fecha_pago ? r.fecha_pago.replace(/-/g, '') : '',
    fmtMoney(r.monto_facturado),
    fmtMoney(r.itbis_facturado),
    fmtMoney(r.itbis_retenido),
    fmtMoney(r.itbis_proporcionalidad || 0),
    fmtMoney(r.itbis_llevado_al_costo || 0),
    fmtMoney(r.isr_retenido),
    fmtMoney(r.impuesto_selectivo),
    fmtMoney(r.otros_impuestos),
    fmtMoney(r.propina_legal),
    fmtMoney(r.monto_total || ((+r.monto_facturado || 0) + (+r.itbis_facturado || 0))),
  ].join('|'))
  const header = `606|${rnc}|${period}|${rows.length}`
  return [header, ...lines].join('\n') + '\n'
}

function gen607(rows, rncEmisor, year, month) {
  const rnc = (rncEmisor || '').replace(/\D/g, '')
  const period = `${year}${pad(month, 2)}`
  const lines = rows.map(r => [
    (r.rnc_contraparte || '').replace(/\D/g, ''),
    r.tipo_id === 'cedula' ? '2' : '1',
    r.ncf || '',
    r.ncf_modificado || '',
    r.fecha_comprobante ? r.fecha_comprobante.replace(/-/g, '') : '',
    fmtMoney(r.monto_facturado),
    fmtMoney(r.itbis_facturado),
    fmtMoney(r.itbis_retenido),
    fmtMoney(r.isr_retenido),
    fmtMoney(r.impuesto_selectivo),
    fmtMoney(r.otros_impuestos),
    fmtMoney(r.propina_legal),
    r.forma_pago || '01',
    fmtMoney(r.monto_total || ((+r.monto_facturado || 0) + (+r.itbis_facturado || 0))),
  ].join('|'))
  const header = `607|${rnc}|${period}|${rows.length}`
  return [header, ...lines].join('\n') + '\n'
}

function gen608(rows, rncEmisor, year, month) {
  const rnc = (rncEmisor || '').replace(/\D/g, '')
  const period = `${year}${pad(month, 2)}`
  const lines = rows.map(r => [
    r.ncf || '',
    r.fecha_comprobante ? r.fecha_comprobante.replace(/-/g, '') : '',
    r.motivo_anulacion || '01',
  ].join('|'))
  const header = `608|${rnc}|${period}|${rows.length}`
  return [header, ...lines].join('\n') + '\n'
}

function downloadTxt(txt, name) {
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

// ─── CSV parser ────────────────────────────────────────────────────────────
// Accepts comma OR pipe OR tab as separator. First non-empty line is header.
// Recognized headers (case-insensitive, accent-tolerant):
//   ncf, ncf_modificado, fecha (or fecha_comprobante), fecha_pago,
//   rnc (or rnc_contraparte), razon_social, tipo_id (rnc/cedula),
//   itbis_rate (18/16/0/-1), monto (or monto_facturado), itbis (or itbis_facturado),
//   itbis_retenido, isr_retenido, propina, total, forma_pago, motivo_anulacion
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const sep = lines[0].includes('|') ? '|' : lines[0].includes('\t') ? '\t' : ','
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  const headers = lines[0].split(sep).map(h => norm(h))
  const map = {
    ncf: ['ncf'],
    ncf_modificado: ['ncf_modificado','ncfmodificado','ncf modificado','ncf_ref'],
    fecha_comprobante: ['fecha','fecha_comprobante','fecha comprobante','fecha emision'],
    fecha_pago: ['fecha_pago','fecha pago'],
    rnc_contraparte: ['rnc','rnc_contraparte','rnc_proveedor','rnc_cliente','rnccontraparte'],
    razon_social: ['razon_social','razon social','nombre','proveedor','cliente'],
    tipo_id: ['tipo_id','tipo id','tipoid'],
    itbis_rate: ['itbis_rate','itbis rate','tasa_itbis','tasa itbis','rate'],
    monto_facturado: ['monto','monto_facturado','base','subtotal','neto'],
    itbis_facturado: ['itbis','itbis_facturado','impuesto'],
    itbis_retenido: ['itbis_retenido','itbis ret','retencion_itbis','itbis retenido'],
    itbis_proporcionalidad: ['itbis_proporcionalidad','itbis proporcionalidad','proporcionalidad','sujeto_proporcionalidad'],
    itbis_llevado_al_costo: ['itbis_llevado_al_costo','itbis llevado al costo','itbis costo','itbis_no_deducible'],
    isr_retenido: ['isr_retenido','isr ret','isr','retencion_isr'],
    tipo_bienes_servicios: ['tipo_bienes_servicios','tipo bienes y servicios','tipo_bs','tbs'],
    retencion_renta: ['retencion_renta','retencion renta'],
    impuesto_selectivo: ['impuesto_selectivo','isc','selectivo'],
    otros_impuestos: ['otros_impuestos','otros'],
    propina_legal: ['propina','propina_legal'],
    monto_total: ['total','monto_total'],
    forma_pago: ['forma_pago','forma pago','metodo_pago'],
    motivo_anulacion: ['motivo','motivo_anulacion'],
  }
  const idx = {}
  for (const [k, alts] of Object.entries(map)) {
    const i = headers.findIndex(h => alts.includes(h))
    if (i >= 0) idx[k] = i
  }
  const num = (v) => {
    if (v == null || v === '') return 0
    const n = Number(String(v).replace(/[$,\s]/g, '').replace(/[^\d.\-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  const dateIso = (v) => {
    if (!v) return null
    const s = String(v).trim()
    // ISO yyyy-mm-dd
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (m) return `${m[1]}-${pad(m[2],2)}-${pad(m[3],2)}`
    // dd/mm/yyyy
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) return `${m[3]}-${pad(m[2],2)}-${pad(m[1],2)}`
    // yyyymmdd
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    return null
  }
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim())
    if (cols.every(c => !c)) continue
    const get = (k) => idx[k] != null ? cols[idx[k]] : ''
    const row = {
      ncf: get('ncf') || null,
      ncf_modificado: get('ncf_modificado') || null,
      fecha_comprobante: dateIso(get('fecha_comprobante')),
      fecha_pago: dateIso(get('fecha_pago')),
      rnc_contraparte: (get('rnc_contraparte') || '').replace(/\D/g, '') || null,
      razon_social: get('razon_social') || null,
      tipo_id: (get('tipo_id') || 'rnc').toLowerCase(),
      itbis_rate: (() => {
        const v = get('itbis_rate')
        if (!v) return 18
        const n = Number(String(v).replace(/[^\d-]/g, ''))
        return [18, 16, 0, -1].includes(n) ? n : 18
      })(),
      monto_facturado: num(get('monto_facturado')),
      itbis_facturado: num(get('itbis_facturado')),
      itbis_retenido: num(get('itbis_retenido')),
      itbis_proporcionalidad: num(get('itbis_proporcionalidad')),
      itbis_llevado_al_costo: num(get('itbis_llevado_al_costo')),
      isr_retenido: num(get('isr_retenido')),
      tipo_bienes_servicios: (() => {
        const v = get('tipo_bienes_servicios')
        if (!v) return null
        const n = Number(String(v).replace(/[^\d]/g, ''))
        return n >= 1 && n <= 11 ? n : null
      })(),
      retencion_renta: num(get('retencion_renta')),
      impuesto_selectivo: num(get('impuesto_selectivo')),
      otros_impuestos: num(get('otros_impuestos')),
      propina_legal: num(get('propina_legal')),
      monto_total: num(get('monto_total')),
      forma_pago: get('forma_pago') || null,
      motivo_anulacion: get('motivo_anulacion') || null,
    }
    if (!row.monto_total) row.monto_total = (row.monto_facturado || 0) + (row.itbis_facturado || 0)
    out.push(row)
  }
  return out
}

// ─── Component ─────────────────────────────────────────────────────────────
// Norma 06-23 retención ITBIS rules:
//   - Formal RNC (active in rnc_contribuyentes): 30% retención on services
//   - Informal supplier (no RNC, only cédula, or RNC not registered): 100%
//   - Goods (mercaderías): 0% retención regardless
async function autoTagRetencion(row, rncLookup) {
  if (row.retencion_pct != null && row.retencion_pct !== '') return row // already set
  const rnc = (row.rnc_contraparte || '').replace(/\D/g, '')
  if (!rnc || rnc.length < 9) {
    row.retencion_pct = 100 // no RNC = informal
    return row
  }
  if (row.tipo_id === 'cedula') {
    row.retencion_pct = 100 // cédula-only = informal
    return row
  }
  try {
    const result = await rncLookup(rnc)
    if (result && (result.estado || '').toLowerCase().includes('activ')) {
      row.retencion_pct = 30
    } else {
      row.retencion_pct = 100
    }
  } catch (_aetherErr) {
    try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'comprobantes.autotagretencion' }) } catch {} row.retencion_pct = 30 } // network fail → conservative default
  return row
}

export default function Comprobantes() {
  const api = useAPI()
  const { lookup: rncLookup } = useRNC()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [kind, setKind] = useState('compra')
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(null)
  const [addBusy, setAddBusy] = useState(false)
  const [reconcile, setReconcile] = useState(null) // result from comprobantesReconcile
  const [reconcileBusy, setReconcileBusy] = useState(false)
  const [it1, setIt1] = useState(null)
  const [csvText, setCsvText] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState('')

  const years = useMemo(() => {
    const y = today.getFullYear()
    return [y, y - 1, y - 2]
  }, [today])

  const selectedClient = useMemo(() => clients.find(c => String(c.id) === String(clientId)), [clients, clientId])

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    if (!clientId) { setRows([]); return }
    setLoading(true)
    try {
      const list = await api.contabilidad.comprobantesList({
        accountingClientId: Number(clientId), year, month, kind,
      })
      setRows(list || [])
    } finally { setLoading(false) }
  }, [api, clientId, year, month, kind])

  useEffect(() => {
    if (!api?.contabilidad) return
    api.contabilidad.clientList().then(c => setClients(c || []))
  }, [api])

  useEffect(() => { reload() }, [reload])

  function openAdd() {
    setAddForm({
      ncf: '', ncf_modificado: '',
      fecha_comprobante: new Date().toISOString().slice(0, 10),
      fecha_pago: '',
      rnc_contraparte: '', razon_social: '', tipo_id: 'rnc',
      itbis_rate: 18,
      monto_facturado: '', itbis_facturado: '',
      itbis_retenido: '', itbis_proporcionalidad: '', itbis_llevado_al_costo: '',
      isr_retenido: '', impuesto_selectivo: '', otros_impuestos: '', propina_legal: '',
      monto_total: '',
      forma_pago: '01', motivo_anulacion: kind === 'anulado' ? '01' : '',
      tipo_bienes_servicios: '',
      notes: '',
    })
    setShowAdd(true)
  }

  async function saveAddRow() {
    if (!clientId) return
    const f = addForm
    const num = (v) => Number(String(v ?? '').replace(/[^\d.\-]/g, '')) || 0
    const monto = num(f.monto_facturado)
    const itbis = num(f.itbis_facturado)
    const total = num(f.monto_total) || (monto + itbis)
    const row = {
      kind,
      accounting_client_id: Number(clientId),
      accounting_client_supabase_id: selectedClient?.supabase_id || null,
      period_year: year, period_month: month,
      ncf: f.ncf || null,
      ncf_modificado: f.ncf_modificado || null,
      fecha_comprobante: f.fecha_comprobante || null,
      fecha_pago: f.fecha_pago || null,
      rnc_contraparte: (f.rnc_contraparte || '').replace(/\D/g, '') || null,
      razon_social: f.razon_social || null,
      tipo_id: f.tipo_id || 'rnc',
      itbis_rate: Number(f.itbis_rate) || 18,
      monto_facturado: monto,
      itbis_facturado: itbis,
      itbis_retenido: num(f.itbis_retenido),
      itbis_proporcionalidad: num(f.itbis_proporcionalidad),
      itbis_llevado_al_costo: num(f.itbis_llevado_al_costo),
      isr_retenido: num(f.isr_retenido),
      impuesto_selectivo: num(f.impuesto_selectivo),
      otros_impuestos: num(f.otros_impuestos),
      propina_legal: num(f.propina_legal),
      monto_total: total,
      forma_pago: f.forma_pago || null,
      motivo_anulacion: kind === 'anulado' ? (f.motivo_anulacion || '01') : null,
      tipo_bienes_servicios: f.tipo_bienes_servicios ? Number(f.tipo_bienes_servicios) : null,
      notes: f.notes || null,
      source: 'manual',
    }
    if (kind === 'compra' && !row.tipo_bienes_servicios) {
      const { tipo_bienes_servicios } = classifyComprobante(row)
      row.tipo_bienes_servicios = tipo_bienes_servicios
    }
    setAddBusy(true)
    try {
      await api.contabilidad.comprobantesAdd(row)
      setShowAdd(false); setAddForm(null)
      reload()
    } catch (e) {
      window.alert(`Error: ${e.message || e}`)
    } finally { setAddBusy(false) }
  }

  async function buildIt1() {
    if (!clientId) return
    const [v, c, a] = await Promise.all([
      api.contabilidad.comprobantesList({ accountingClientId: Number(clientId), year, month, kind: 'venta' }),
      api.contabilidad.comprobantesList({ accountingClientId: Number(clientId), year, month, kind: 'compra' }),
      api.contabilidad.comprobantesList({ accountingClientId: Number(clientId), year, month, kind: 'anulado' }),
    ])
    setIt1(buildIt1Summary({ ventas: v || [], compras: c || [], anulados: a || [] }))
  }

  async function buildIR17() {
    if (!clientId) return
    const rnc = selectedClient?.rnc || selectedClient?.cedula || ''
    if (!rnc) { window.alert('El cliente seleccionado no tiene RNC/Cédula configurado'); return }
    const last = new Date(year, month, 0).getDate()
    const from = `${year}-${pad(month, 2)}-01`
    const to   = `${year}-${pad(month, 2)}-${pad(last, 2)}`
    const list = await api.contabilidad.retentionEmitidaList?.({
      accountingClientId: Number(clientId),
      accountingClientSupabaseId: selectedClient?.supabase_id || null,
      dateFrom: from, dateTo: to,
    }) || []
    if (!list.length) { window.alert('Sin retenciones para este período'); return }
    const txt = genIR17(list, rnc, year, month)
    downloadTxt(txt, filenameFor('IR17', rnc, year, month))
  }

  async function buildIR13() {
    if (!clientId) return
    const rnc = selectedClient?.rnc || selectedClient?.cedula || ''
    if (!rnc) { window.alert('El cliente seleccionado no tiene RNC/Cédula configurado'); return }
    const list = await api.contabilidad.retentionEmitidaList?.({
      accountingClientId: Number(clientId),
      accountingClientSupabaseId: selectedClient?.supabase_id || null,
      dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`,
    }) || []
    if (!list.length) { window.alert('Sin retenciones para este año'); return }
    const txt = genIR13(list, rnc, year)
    downloadTxt(txt, filenameFor('IR13', rnc, year))
  }

  async function runReconcile() {
    if (!clientId) return
    setReconcileBusy(true); setReconcile(null)
    try {
      const result = await api.contabilidad.comprobantesReconcile({
        accountingClientId: Number(clientId),
        clientRnc: selectedClient?.rnc || null,
        year, month,
      })
      setReconcile(result)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'comprobantes.buildit1' }) } catch {}
      setReconcile({ error: e.message || String(e) })
    } finally { setReconcileBusy(false) }
  }

  async function importMissingFromDgii() {
    if (!reconcile?.missingInLocal?.length) return
    setReconcileBusy(true)
    try {
      const rows = reconcile.missingInLocal.map(d => ({
        kind: 'compra',
        accounting_client_id: Number(clientId),
        accounting_client_supabase_id: selectedClient?.supabase_id || null,
        period_year: year, period_month: month,
        ncf: d.ncf, ncf_modificado: d.ncf_modificado,
        fecha_comprobante: d.fecha_emision,
        rnc_contraparte: (d.emisor_rnc || '').replace(/\D/g, '') || null,
        razon_social: d.emisor_razon_social || null,
        tipo_id: 'rnc',
        itbis_rate: d.itbis_rate || 18,
        monto_facturado: Number(d.monto_facturado || 0),
        itbis_facturado: Number(d.itbis_facturado || 0),
        monto_total: Number(d.monto_total || 0),
        source: 'xml',
      }))
      await api.contabilidad.comprobantesBulkInsert(rows)
      setReconcile(null); reload()
    } catch (e) { window.alert(`Error: ${e.message}`) }
    finally { setReconcileBusy(false) }
  }

  async function deleteRow(id) {
    if (!window.confirm('¿Eliminar este comprobante?')) return
    await api.contabilidad.comprobantesDelete(id)
    reload()
  }

  async function bulkImport() {
    if (!clientId) { setImportMsg('Selecciona un cliente primero'); return }
    const parsed = parseCSV(csvText)
    if (!parsed.length) { setImportMsg('No se detectaron filas válidas'); return }
    setImportBusy(true)
    try {
      const payload = parsed.map(r => ({
        ...r,
        kind,
        accounting_client_id: Number(clientId),
        accounting_client_supabase_id: selectedClient?.supabase_id || null,
        period_year: year,
        period_month: month,
      }))
      // Auto-retención 30/100 for compras: lookup each unique RNC once.
      // Auto-classify Tipo Bienes y Servicios (Norma 07-18 1-11) for any row
      // that didn't carry an explicit tipo_bienes_servicios in the CSV.
      if (kind === 'compra') {
        const cache = {}
        for (const row of payload) {
          const rnc = (row.rnc_contraparte || '').replace(/\D/g, '')
          if (!cache[rnc]) cache[rnc] = autoTagRetencion(row, rncLookup)
          else cache[rnc] = cache[rnc].then(prev => { row.retencion_pct = prev.retencion_pct; return row })
          if (!row.tipo_bienes_servicios) {
            const { tipo_bienes_servicios } = classifyComprobante(row)
            row.tipo_bienes_servicios = tipo_bienes_servicios
          }
        }
        await Promise.all(Object.values(cache))
      }
      const { inserted, total } = await api.contabilidad.comprobantesBulkInsert(payload)
      setImportMsg(`${inserted} de ${total} filas importadas (duplicados ignorados)`)
      setCsvText('')
      reload()
    } catch (e) {
      setImportMsg(`Error: ${e.message || e}`)
    } finally {
      setImportBusy(false)
    }
  }

  function generateTxt() {
    const rnc = selectedClient?.rnc || ''
    if (!rnc) { window.alert('El cliente seleccionado no tiene RNC configurado'); return }
    let txt = '', name = ''
    const period = `${year}${pad(month, 2)}`
    const cleanRnc = rnc.replace(/\D/g, '')
    if (kind === 'compra') {
      txt = gen606(rows, rnc, year, month)
      name = `DGII_F606_${cleanRnc}_${period}.txt`
    } else if (kind === 'venta') {
      txt = gen607(rows, rnc, year, month)
      name = `DGII_F607_${cleanRnc}_${period}.txt`
    } else {
      txt = gen608(rows, rnc, year, month)
      name = `DGII_F608_${cleanRnc}_${period}.txt`
    }
    downloadTxt(txt, name)
  }

  // Summary by ITBIS rate
  const summary = useMemo(() => {
    const buckets = { 18: 0, 16: 0, 0: 0, '-1': 0 }
    let totalBase = 0, totalItbis = 0, totalGeneral = 0
    for (const r of rows) {
      const rate = String(r.itbis_rate ?? 18)
      buckets[rate] = (buckets[rate] || 0) + Number(r.monto_facturado || 0)
      totalBase += Number(r.monto_facturado || 0)
      totalItbis += Number(r.itbis_facturado || 0)
      totalGeneral += Number(r.monto_total || 0)
    }
    return { buckets, totalBase, totalItbis, totalGeneral, count: rows.length }
  }, [rows])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-black text-black dark:text-white mb-5 inline-flex items-center gap-2">
        <FileText size={22} className="text-[#b3001e]" /> Comprobantes
      </h1>

      {/* Filters */}
      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 mb-4">
        <div className="sm:col-span-2">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Cliente</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-black border border-black/15 dark:border-white/15 text-black dark:text-white">
            <option value="">— Selecciona un cliente —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}{c.rnc ? ` (${c.rnc})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Año</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-black border border-black/15 dark:border-white/15 text-black dark:text-white">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Mes</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-black border border-black/15 dark:border-white/15 text-black dark:text-white">
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button disabled={!clientId || !rows.length} onClick={generateTxt}
            className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-black text-white text-sm font-bold hover:bg-[#b3001e] disabled:opacity-40 dark:bg-white dark:text-black">
            <Download size={14} /> {kind === 'compra' ? '606' : kind === 'venta' ? '607' : '608'}
          </button>
        </div>
      </div>

      {/* Kind tabs */}
      <div className="flex gap-1 mb-4">
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              kind === k
                ? 'bg-[#b3001e] text-white'
                : 'bg-white dark:bg-white/5 text-black/60 dark:text-white/60 hover:bg-[#b3001e]/10 hover:text-[#b3001e] border border-black/10 dark:border-white/10'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-black/50 dark:text-white/50">
          {selectedClient ? `${rows.length} filas — ${selectedClient.nombre_comercial}` : 'Selecciona un cliente'}
        </p>
        <div className="flex gap-2">
          <button disabled={!clientId} onClick={openAdd}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#b3001e] text-white text-xs font-bold hover:bg-[#c8002a] disabled:opacity-40">
            <Plus size={12} /> Agregar
          </button>
          <button disabled={!clientId} onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-black dark:text-white text-xs font-bold hover:border-[#b3001e] hover:text-[#b3001e] disabled:opacity-40">
            <Upload size={12} /> Importar CSV
          </button>
          {kind === 'compra' && (
            <button disabled={!clientId || reconcileBusy} onClick={runReconcile}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-600 text-xs font-bold hover:bg-amber-500/10 disabled:opacity-40">
              {reconcileBusy ? <Loader2 size={12} className="animate-spin"/> : <GitCompare size={12} />} Conciliar con DGII
            </button>
          )}
          <button disabled={!clientId} onClick={buildIt1}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#b3001e]/40 text-[#b3001e] text-xs font-bold hover:bg-[#b3001e]/10 disabled:opacity-40">
            <FileText size={12} /> IT-1 del mes
          </button>
          <button disabled={!clientId} onClick={buildIR17}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#b3001e]/40 text-[#b3001e] text-xs font-bold hover:bg-[#b3001e]/10 disabled:opacity-40"
            title="Otras Retenciones (mensual) — DGII Norma 02-2011">
            <Download size={12} /> IR-17 del mes
          </button>
          <button disabled={!clientId} onClick={buildIR13}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#b3001e]/40 text-[#b3001e] text-xs font-bold hover:bg-[#b3001e]/10 disabled:opacity-40"
            title="Resumen Anual de Retenciones — agrupado por beneficiario">
            <Download size={12} /> IR-13 del año
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr className="text-left">
              <th className="px-3 py-2 font-bold">NCF</th>
              <th className="px-3 py-2 font-bold">Fecha</th>
              <th className="px-3 py-2 font-bold">RNC</th>
              <th className="px-3 py-2 font-bold">Razón social</th>
              <th className="px-3 py-2 font-bold text-center">ITBIS</th>
              <th className="px-3 py-2 font-bold text-right">Base</th>
              <th className="px-3 py-2 font-bold text-right">ITBIS RD$</th>
              <th className="px-3 py-2 font-bold text-right">Total</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan="9" className="px-3 py-10 text-center"><Loader2 size={16} className="inline animate-spin text-[#b3001e]" /></td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan="9" className="px-3 py-10 text-center text-black/40 dark:text-white/40">
                {clientId ? 'Sin comprobantes en este período. Importa un CSV.' : 'Selecciona un cliente para ver comprobantes.'}
              </td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="border-b border-black/5 dark:border-white/10 hover:bg-[#b3001e]/5">
                <td className="px-3 py-1.5 font-mono text-black dark:text-white">{r.ncf || '—'}</td>
                <td className="px-3 py-1.5 text-black/70 dark:text-white/70">{fmtDateDDMMYYYY(r.fecha_comprobante)}</td>
                <td className="px-3 py-1.5 font-mono text-black/70 dark:text-white/70">{r.rnc_contraparte || '—'}</td>
                <td className="px-3 py-1.5 text-black/70 dark:text-white/70 truncate max-w-[200px]">{r.razon_social || '—'}</td>
                <td className="px-3 py-1.5 text-center text-xs font-bold">
                  <span className={`px-1.5 py-0.5 rounded ${r.itbis_rate === -1 ? 'bg-black/10 dark:bg-white/10' : r.itbis_rate === 0 ? 'bg-amber-500/15 text-amber-700' : r.itbis_rate === 16 ? 'bg-blue-500/15 text-blue-700' : 'bg-[#b3001e]/15 text-[#b3001e]'}`}>
                    {ITBIS_LABEL[String(r.itbis_rate)] || `${r.itbis_rate}%`}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.monto_facturado)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.itbis_facturado)}</td>
                <td className="px-3 py-1.5 text-right font-bold tabular-nums">{fmtMoney(r.monto_total)}</td>
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => deleteRow(r.id)} className="text-black/40 dark:text-white/40 hover:text-[#b3001e]"><Trash2 size={12}/></button>
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-black/5 dark:bg-white/5 font-bold">
              <tr>
                <td colSpan="5" className="px-3 py-2 text-right text-black dark:text-white">Total {summary.count}:</td>
                <td className="px-3 py-2 text-right tabular-nums text-black dark:text-white">{fmtMoney(summary.totalBase)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-black dark:text-white">{fmtMoney(summary.totalItbis)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-black dark:text-white">{fmtMoney(summary.totalGeneral)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ITBIS rate breakdown */}
      {rows.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[18, 16, 0, -1].map(rate => (
            <div key={rate} className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50">{ITBIS_LABEL[String(rate)]}</p>
              <p className="text-base font-black text-black dark:text-white tabular-nums">{fmtMoney(summary.buckets[String(rate)] || 0)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-auto">
            <h2 className="text-lg font-black text-black dark:text-white mb-1">Importar CSV — {KIND_LABEL[kind]}</h2>
            <p className="text-xs text-black/60 dark:text-white/60 mb-3">
              Cabecera esperada (en cualquier orden): <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 font-mono">ncf, fecha, rnc, razon_social, itbis_rate, monto, itbis, total, forma_pago</code>.
              Separador detectado automáticamente (coma / pipe / tab). Fechas <code>dd/mm/yyyy</code> o <code>yyyy-mm-dd</code>.
            </p>
            <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder="Pega aquí el CSV..."
              rows={12}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white font-mono text-xs"/>
            <div className="mt-3 flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-black/70 dark:text-white/70 cursor-pointer">
                <Upload size={14} /> Subir archivo
                <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0]; if (!f) return
                  const reader = new FileReader()
                  reader.onload = (ev) => setCsvText(String(ev.target.result || ''))
                  reader.readAsText(f)
                }} />
              </label>
              {importMsg && <span className="text-xs text-black/60 dark:text-white/60">{importMsg}</span>}
              <div className="flex gap-2">
                <button onClick={() => setShowImport(false)}
                  className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 text-black/70 dark:text-white/70 text-sm font-bold">Cancelar</button>
                <button disabled={importBusy || !csvText.trim()} onClick={bulkImport}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold disabled:opacity-50">
                  {importBusy ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14} />} Importar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {it1 && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setIt1(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-auto">
            <h2 className="text-lg font-black text-black dark:text-white mb-1 inline-flex items-center gap-2">
              <FileText size={18} className="text-[#b3001e]" /> IT-1 — {String(month).padStart(2,'0')}/{year}
            </h2>
            <p className="text-xs text-black/60 dark:text-white/60 mb-4">
              {selectedClient?.nombre_comercial} · Casillas listas para copiar al formulario IT-1 en DGII Oficina Virtual.
              <br/>
              <span className="text-[10px]">{it1.counts.ventas} ventas · {it1.counts.compras} compras · {it1.counts.anulados} anulados</span>
            </p>
            <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ['I — OPERACIONES', null, true],
                    ['C1 Total Ventas', it1.casillas.C1_TotalVentas],
                    ['C2 Total Compras', it1.casillas.C2_TotalCompras],
                    ['II — ITBIS DÉBITO FISCAL', null, true],
                    ['C3 ITBIS Facturado', it1.casillas.C3_ITBISFacturado],
                    ['C4 ITBIS de Anulados', it1.casillas.C4_ITBISAnulados],
                    ['C5 ITBIS Débito Fiscal (C3 − C4)', it1.casillas.C5_ITBISDebitoFiscal, false, true],
                    ['III — ITBIS CRÉDITO FISCAL', null, true],
                    ['C6 ITBIS Pagado en Compras', it1.casillas.C6_ITBISPagadoCompras],
                    ['C7 ITBIS Llevado al Costo', it1.casillas.C7_ITBISLlevadoAlCosto],
                    ['C8 ITBIS Sujeto a Proporcionalidad', it1.casillas.C8_ITBISProporcionalidad],
                    ['C9 ITBIS Crédito Fiscal', it1.casillas.C9_ITBISCreditoFiscal, false, true],
                    ['IV — RETENCIONES', null, true],
                    ['C10 ITBIS Retenido (sobre tus ventas)', it1.casillas.C10_ITBISRetenidoVentas],
                    ['C11 ITBIS Retenido (a tus proveedores)', it1.casillas.C11_ITBISRetenidoCompras],
                    ['V — RESULTADO', null, true],
                    ['C12 ITBIS A PAGAR', it1.casillas.C12_ITBISAPagar, false, true],
                    ['C13 Saldo a Favor', it1.casillas.C13_SaldoAFavor, false, true],
                  ].map(([label, val, header, highlight], i) => (
                    header ? (
                      <tr key={i} className="bg-black text-white"><td colSpan={2} className="px-3 py-1.5 font-bold text-[11px] uppercase tracking-wider">{label}</td></tr>
                    ) : (
                      <tr key={i} className={`border-b border-black/5 dark:border-white/10 ${highlight ? 'bg-[#b3001e]/5' : ''}`}>
                        <td className="px-3 py-1.5 text-black/80 dark:text-white/80">{label}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums font-mono ${highlight ? 'font-bold text-[#b3001e]' : 'text-black dark:text-white'}`}>{fmtMoney(val)}</td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] mt-3 text-black/50 dark:text-white/50">
              Cálculo simplificado bajo Norma 06-23. Validar contra el cierre real antes de declarar — esta es una guía.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => {
                const text = Object.entries(it1.casillas).map(([k, v]) => `${k}\t${v}`).join('\n')
                try { navigator.clipboard?.writeText(text) } catch (_aetherErr) {
                  try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'comprobantes.handler' }) } catch {}}
              }} className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 text-black dark:text-white text-sm font-bold">Copiar TSV</button>
              <button onClick={() => setIt1(null)}
                className="px-4 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {reconcile && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setReconcile(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-auto">
            <h2 className="text-lg font-black text-black dark:text-white mb-1 inline-flex items-center gap-2">
              <GitCompare size={18} className="text-[#b3001e]" /> Conciliación 606 vs DGII
            </h2>
            <p className="text-xs text-black/60 dark:text-white/60 mb-4">
              {selectedClient?.nombre_comercial} · {String(month).padStart(2,'0')}/{year} — comparación entre tu registro local y los e-CFs descargados de DGII Mis Comprobantes.
            </p>
            {reconcile.error ? (
              <p className="text-red-500 text-sm">Error: {reconcile.error}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-3">
                    <p className="text-[10px] font-bold uppercase text-black/50 dark:text-white/50">Local</p>
                    <p className="text-2xl font-black text-black dark:text-white tabular-nums">{reconcile.summary.local_count}</p>
                  </div>
                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-3">
                    <p className="text-[10px] font-bold uppercase text-black/50 dark:text-white/50">DGII</p>
                    <p className="text-2xl font-black text-black dark:text-white tabular-nums">{reconcile.summary.dgii_count}</p>
                  </div>
                  <div className={`rounded-xl border p-3 ${reconcile.summary.missing_in_local > 0 ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
                    <p className="text-[10px] font-bold uppercase text-black/50 dark:text-white/50">Falta en local</p>
                    <p className={`text-2xl font-black tabular-nums ${reconcile.summary.missing_in_local > 0 ? 'text-red-500' : 'text-emerald-500'}`}>{reconcile.summary.missing_in_local}</p>
                  </div>
                  <div className={`rounded-xl border p-3 ${reconcile.summary.amount_mismatch > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
                    <p className="text-[10px] font-bold uppercase text-black/50 dark:text-white/50">Diferencia montos</p>
                    <p className={`text-2xl font-black tabular-nums ${reconcile.summary.amount_mismatch > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{reconcile.summary.amount_mismatch}</p>
                  </div>
                </div>

                {reconcile.missingInLocal.length > 0 && (
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-red-500 inline-flex items-center gap-1">
                        <AlertTriangle size={14} /> En DGII pero NO en tu local ({reconcile.missingInLocal.length})
                      </h3>
                      <button onClick={importMissingFromDgii} disabled={reconcileBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#b3001e] text-white text-xs font-bold disabled:opacity-50">
                        {reconcileBusy ? <Loader2 size={12} className="animate-spin"/> : <Plus size={12}/>} Importar todos
                      </button>
                    </div>
                    <div className="rounded-lg border border-red-500/20 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-red-500/10 text-black/70 dark:text-white/70"><tr>
                          <th className="px-2 py-1.5 text-left">NCF</th><th className="px-2 py-1.5 text-left">Fecha</th>
                          <th className="px-2 py-1.5 text-left">Emisor</th><th className="px-2 py-1.5 text-right">Total</th>
                        </tr></thead>
                        <tbody>
                          {reconcile.missingInLocal.slice(0, 50).map(r => (
                            <tr key={r.id} className="border-t border-red-500/10">
                              <td className="px-2 py-1 font-mono">{r.ncf}</td>
                              <td className="px-2 py-1">{fmtDateDDMMYYYY(r.fecha_emision)}</td>
                              <td className="px-2 py-1 truncate max-w-[200px]">{r.emisor_razon_social || r.emisor_rnc}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(r.monto_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {reconcile.missingInDgii.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-sm font-bold text-black/70 dark:text-white/70 inline-flex items-center gap-1 mb-2">
                      En tu local pero NO en DGII ({reconcile.missingInDgii.length})
                    </h3>
                    <p className="text-[11px] text-black/50 dark:text-white/50 mb-2">Estos pueden ser: NCFs erróneos, comprobantes no electrónicos (B-series), o e-CFs rechazados por DGII.</p>
                    <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-black/5 dark:bg-white/5"><tr>
                          <th className="px-2 py-1.5 text-left">NCF</th><th className="px-2 py-1.5 text-left">Fecha</th>
                          <th className="px-2 py-1.5 text-left">Razón social</th><th className="px-2 py-1.5 text-right">Total</th>
                        </tr></thead>
                        <tbody>
                          {reconcile.missingInDgii.slice(0, 50).map(r => (
                            <tr key={r.id} className="border-t border-black/5 dark:border-white/10">
                              <td className="px-2 py-1 font-mono">{r.ncf || '—'}</td>
                              <td className="px-2 py-1">{fmtDateDDMMYYYY(r.fecha_comprobante)}</td>
                              <td className="px-2 py-1 truncate max-w-[200px]">{r.razon_social}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(r.monto_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {reconcile.amountMismatch.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-sm font-bold text-amber-500 inline-flex items-center gap-1 mb-2">
                      <AlertTriangle size={14} /> Diferencia de montos ({reconcile.amountMismatch.length})
                    </h3>
                    <div className="rounded-lg border border-amber-500/20 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-amber-500/10"><tr>
                          <th className="px-2 py-1.5 text-left">NCF</th><th className="px-2 py-1.5 text-right">Local</th>
                          <th className="px-2 py-1.5 text-right">DGII</th><th className="px-2 py-1.5 text-right">Δ</th>
                        </tr></thead>
                        <tbody>
                          {reconcile.amountMismatch.slice(0, 50).map(m => (
                            <tr key={m.ncf} className="border-t border-amber-500/10">
                              <td className="px-2 py-1 font-mono">{m.ncf}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(m.localTotal)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(m.dgiiTotal)}</td>
                              <td className="px-2 py-1 text-right tabular-nums font-bold text-amber-600">{fmtMoney(m.delta)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {reconcile.summary.missing_in_local + reconcile.summary.missing_in_dgii + reconcile.summary.amount_mismatch === 0 && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                    <Check size={32} className="text-emerald-500 mx-auto mb-2"/>
                    <p className="text-emerald-500 font-bold">Conciliación 100% correcta — todo cuadra con DGII.</p>
                  </div>
                )}
              </>
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={() => setReconcile(null)}
                className="px-4 py-2 rounded-lg border border-black/10 dark:border-white/10 text-black dark:text-white text-sm font-bold">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showAdd && addForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-auto">
            <h2 className="text-lg font-black text-black dark:text-white mb-3">Agregar comprobante — {KIND_LABEL[kind]}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">NCF</label>
                <input value={addForm.ncf} onChange={e => setAddForm({ ...addForm, ncf: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white font-mono text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Fecha</label>
                <input type="date" value={addForm.fecha_comprobante} onChange={e => setAddForm({ ...addForm, fecha_comprobante: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Fecha de pago</label>
                <input type="date" value={addForm.fecha_pago} onChange={e => setAddForm({ ...addForm, fecha_pago: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Razón social</label>
                <input value={addForm.razon_social} onChange={e => setAddForm({ ...addForm, razon_social: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">RNC / Cédula</label>
                <input value={addForm.rnc_contraparte} onChange={e => setAddForm({ ...addForm, rnc_contraparte: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white font-mono text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Tipo ID</label>
                <select value={addForm.tipo_id} onChange={e => setAddForm({ ...addForm, tipo_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm">
                  <option value="rnc">RNC</option>
                  <option value="cedula">Cédula</option>
                  <option value="passport">Pasaporte</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Tasa ITBIS</label>
                <select value={addForm.itbis_rate} onChange={e => setAddForm({ ...addForm, itbis_rate: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm">
                  <option value={18}>18% (general)</option>
                  <option value={16}>16% (reducida)</option>
                  <option value={0}>0% (export)</option>
                  <option value={-1}>Exento</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Monto facturado</label>
                <input type="number" step="0.01" value={addForm.monto_facturado} onChange={e => setAddForm({ ...addForm, monto_facturado: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">ITBIS facturado</label>
                <input type="number" step="0.01" value={addForm.itbis_facturado} onChange={e => setAddForm({ ...addForm, itbis_facturado: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">ITBIS retenido</label>
                <input type="number" step="0.01" value={addForm.itbis_retenido} onChange={e => setAddForm({ ...addForm, itbis_retenido: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">ITBIS proporcionalidad</label>
                <input type="number" step="0.01" value={addForm.itbis_proporcionalidad} onChange={e => setAddForm({ ...addForm, itbis_proporcionalidad: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">ITBIS llevado al costo</label>
                <input type="number" step="0.01" value={addForm.itbis_llevado_al_costo} onChange={e => setAddForm({ ...addForm, itbis_llevado_al_costo: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">ISR retenido</label>
                <input type="number" step="0.01" value={addForm.isr_retenido} onChange={e => setAddForm({ ...addForm, isr_retenido: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Total</label>
                <input type="number" step="0.01" value={addForm.monto_total} onChange={e => setAddForm({ ...addForm, monto_total: e.target.value })}
                  placeholder="auto"
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
              {kind === 'compra' && (
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Tipo Bienes y Servicios (Norma 07-18)</label>
                  <select value={addForm.tipo_bienes_servicios} onChange={e => setAddForm({ ...addForm, tipo_bienes_servicios: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm">
                    <option value="">Auto-detectar al guardar</option>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{k}. {v}</option>)}
                  </select>
                </div>
              )}
              {kind === 'venta' && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Forma de pago</label>
                  <select value={addForm.forma_pago} onChange={e => setAddForm({ ...addForm, forma_pago: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm">
                    <option value="01">01 - Efectivo</option>
                    <option value="02">02 - Cheques/Transferencia</option>
                    <option value="03">03 - Tarjeta crédito/débito</option>
                    <option value="04">04 - Compra a crédito</option>
                    <option value="05">05 - Permuta</option>
                    <option value="06">06 - Bonos/Certificados</option>
                    <option value="07">07 - Otra forma de venta</option>
                  </select>
                </div>
              )}
              {kind === 'anulado' && (
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Motivo anulación</label>
                  <select value={addForm.motivo_anulacion} onChange={e => setAddForm({ ...addForm, motivo_anulacion: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm">
                    <option value="01">01 - Deterioro de factura preimpresa</option>
                    <option value="02">02 - Errores de impresión</option>
                    <option value="03">03 - Impresión defectuosa</option>
                    <option value="04">04 - Corrección de información</option>
                    <option value="05">05 - Cambio de productos</option>
                    <option value="06">06 - Devolución de productos</option>
                    <option value="07">07 - Omisión de productos</option>
                    <option value="08">08 - Errores en secuencia NCF</option>
                    <option value="09">09 - Por cese de operaciones</option>
                    <option value="10">10 - Pérdida o hurto de talonarios</option>
                  </select>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)}
                className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 text-black/70 dark:text-white/70 text-sm font-bold">Cancelar</button>
              <button disabled={addBusy} onClick={saveAddRow}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold disabled:opacity-50">
                {addBusy ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
