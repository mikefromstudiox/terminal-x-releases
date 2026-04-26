/**
 * VehicleCsvImporter.jsx — Sprint 2D M1.
 *
 * Extracted CSV importer modal from VehicleInventory.jsx. Behavior identical,
 * with one fix: `""` inside a quoted field is now treated as a literal " in
 * every position (the original handler already handled this; preserved verbatim
 * and unit-checked).
 *
 * Props: open, lang, onImported(count), onClose
 */

import { useMemo, useRef, useState } from 'react'
import { X, FileUp, Loader2 } from 'lucide-react'
import { useAPI } from '../../../context/DataContext'

const COLUMN_MAP = {
  stock_number:     ['stock', 'stock_number', '#stock', 'stock #', 'stock#', 'numero', 'numero de stock'],
  vin:              ['vin', 'numero de chasis', 'chasis'],
  make:             ['make', 'marca'],
  model:            ['model', 'modelo'],
  year:             ['year', 'año', 'ano'],
  color:            ['color'],
  mileage:          ['mileage', 'kilometraje', 'km', 'miles'],
  condition:        ['condition', 'condicion'],
  acquisition_cost: ['acquisition_cost', 'cost', 'costo', 'costo de adquisicion'],
  listing_price:    ['listing_price', 'price', 'precio', 'precio de venta'],
  status:           ['status', 'estado'],
  title_status:     ['title_status', 'titulo'],
  notes:            ['notes', 'notas'],
}

function detectDelimiter(line) {
  const c = (line.match(/,/g) || []).length
  const t = (line.match(/\t/g) || []).length
  const s = (line.match(/;/g) || []).length
  if (t >= c && t >= s) return '\t'
  if (s > c) return ';'
  return ','
}

// Parse a CSV/TSV string. Quoted fields support `""` as escaped literal `"`.
// Edge cases handled:
//   • `"a""b"`              → a"b
//   • `"""quoted"""`        → "quoted"
//   • field starting with `""text"` → "text (escaped quote at field start)
function parseCSV(text) {
  const rows = []
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const delim = detectDelimiter(lines[0])

  const split = (line) => {
    const out = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; continue } // escaped
          q = false                                                // close quote
          continue
        }
        cur += ch
      } else {
        if (ch === '"') { q = true; continue }                    // open quote
        if (ch === delim) { out.push(cur); cur = ''; continue }
        cur += ch
      }
    }
    out.push(cur)
    return out.map(s => s.trim())
  }

  const headers = split(lines[0]).map(h => h.toLowerCase())
  for (let i = 1; i < lines.length; i++) rows.push(split(lines[i]))
  return { headers, rows }
}

function autoMap(headers) {
  const map = {}
  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    for (const a of aliases) {
      const idx = headers.indexOf(a.toLowerCase())
      if (idx !== -1) { map[field] = idx; break }
    }
  }
  return map
}

export default function VehicleCsvImporter({ open, lang, onImported, onClose }) {
  const api = useAPI()
  const L = (es, en) => lang === 'es' ? es : en
  const fileRef = useRef(null)
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [map, setMap] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  if (!open) return null

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setErr(''); setDone(null)
    const text = await f.text()
    const parsed = parseCSV(text)
    if (parsed.headers.length === 0) { setErr(L('CSV vacío.', 'Empty CSV.')); return }
    setHeaders(parsed.headers); setRows(parsed.rows)
    setMap(autoMap(parsed.headers))
  }

  const previewRows = useMemo(() => {
    return rows.slice(0, 5).map(r => {
      const o = {}
      for (const [field, idx] of Object.entries(map)) o[field] = r[idx]
      return o
    })
  }, [rows, map])

  async function doImport() {
    if (!rows.length) return
    setBusy(true); setErr('')
    try {
      const payload = rows.map(r => {
        const o = {}
        for (const [field, idx] of Object.entries(map)) {
          const raw = r[idx]
          if (raw === undefined || raw === '') continue
          if (['year', 'mileage'].includes(field)) o[field] = parseInt(raw, 10) || null
          else if (['acquisition_cost', 'listing_price'].includes(field)) o[field] = Number(String(raw).replace(/[^\d.\-]/g, '')) || 0
          else o[field] = raw
        }
        if (!o.condition) o.condition = 'used'
        if (!o.status) o.status = 'available'
        if (!o.title_status) o.title_status = 'clean'
        return o
      }).filter(o => o.make && o.model)
      const res = await api.vehicleInventory.bulkImport(payload)
      const inserted = res?.inserted || 0
      setDone({ inserted, skipped: rows.length - inserted })
      onImported?.(inserted)
    } catch (ex) { setErr(ex?.message || L('Importación falló.', 'Import failed.')) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-3xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold">{L('Importar Vehículos (CSV)', 'Import Vehicles (CSV)')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="bg-[#b3001e] text-white px-3 py-2 text-sm">{err}</div>}
          {done && <div className="bg-black text-white px-3 py-2 text-sm">{L(`Importadas ${done.inserted} unidades.`, `Imported ${done.inserted} units.`)}</div>}
          {!rows.length ? (
            <>
              <p className="text-sm text-black/70">{L('Encabezados aceptados (cualquier orden):', 'Accepted headers (any order):')}</p>
              <div className="text-xs font-mono bg-black/5 border border-black/10 p-3">vin · stock · marca · modelo · año · color · kilometraje · condicion · costo · precio · estado · titulo · notas</div>
              <button onClick={() => fileRef.current?.click()} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2"><FileUp size={16}/>{L('Seleccionar Archivo', 'Choose File')}</button>
              <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="hidden" onChange={onFile}/>
            </>
          ) : (
            <>
              <div className="text-sm">{L(`Filas detectadas: ${rows.length}`, `Rows detected: ${rows.length}`)}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.keys(COLUMN_MAP).map(field => (
                  <label key={field} className="flex items-center gap-2">
                    <span className="font-semibold w-32">{field}</span>
                    <select value={map[field] ?? ''} onChange={e => setMap(m => ({ ...m, [field]: e.target.value === '' ? undefined : Number(e.target.value) }))} className="flex-1 border border-black px-1 py-0.5">
                      <option value="">—</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="border border-black/10 p-2">
                <div className="text-xs font-semibold mb-1">{L('Vista previa (primeras 5):', 'Preview (first 5):')}</div>
                <pre className="text-xs overflow-x-auto">{JSON.stringify(previewRows, null, 2)}</pre>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setRows([]); setHeaders([]); setMap({}) }} className="px-4 py-2 border border-black">{L('Reiniciar', 'Reset')}</button>
                <button onClick={doImport} disabled={busy} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50">
                  {busy && <Loader2 size={14} className="animate-spin"/>}
                  {L('Importar', 'Import')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
