// Bandeja — Contabilidad universal drop zone (Phase 1).
// Drag-drop / file-pick → enqueue accounting_inbox row with heuristic
// classification + pending OCR. The contable then picks a client + corrects
// the type + hits "Postear" on the side panel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, FileText, FileX2, Check, Loader2, Filter } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { ocrDocument, heuristicClassify } from '@terminal-x/services/ocr.js'

const STATUS_PILL = {
  unclassified: { es: 'Sin clasificar', cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30' },
  classified:   { es: 'Clasificado',    cls: 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white' },
  posted:       { es: 'Posteado',       cls: 'bg-[#b3001e] text-white border-[#b3001e]' },
  archived:     { es: 'Archivado',      cls: 'bg-white text-black border-black/10 dark:bg-black dark:text-white/70 dark:border-white/20' },
}

const TYPE_LABELS = {
  ecf_xml:     'e-CF XML',
  factura_pdf: 'Factura PDF',
  retencion:   'Retención',
  banco_estado:'Estado de cuenta',
  tss:         'Planilla TSS',
  csv:         'CSV / Excel',
  contrato:    'Contrato',
  otro:        'Otro',
}

function Pill({ kind, children }) {
  const meta = STATUS_PILL[kind] || STATUS_PILL.unclassified
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}>{children || meta.es}</span>
}

export default function Bandeja() {
  const api = useAPI()
  const [items, setItems] = useState([])
  const [clients, setClients] = useState([])
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    const [docs, cli] = await Promise.all([
      api.contabilidad.inboxList(),
      api.contabilidad.clientList(),
    ])
    setItems(docs || [])
    setClients(cli || [])
  }, [api])

  useEffect(() => { reload() }, [reload])

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    return items.filter(i => i.status === filter)
  }, [items, filter])

  async function handleFiles(fileList) {
    if (!api?.contabilidad?.inboxAdd) return
    const files = Array.from(fileList || [])
    if (!files.length) return
    setBusy(true)
    try {
      for (const f of files) {
        const classified = heuristicClassify(f)
        const ocr = await ocrDocument(f)
        await api.contabilidad.inboxAdd({
          source: 'dropzone',
          original_filename: f.name,
          mime: f.type || 'application/octet-stream',
          size: f.size || 0,
          ocr_status: ocr.status,
          ocr_text: ocr.text || '',
          classified_type: classified,
          status: 'unclassified',
        })
      }
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function classify(item, patch) {
    if (!api?.contabilidad?.inboxClassify) return
    await api.contabilidad.inboxClassify(item.id, patch)
    await reload()
  }

  async function postEntry(item) {
    if (!api?.contabilidad?.inboxPost) return
    await api.contabilidad.inboxPost(item.id)
    await reload()
    setSelected(null)
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-black dark:text-white">Bandeja</h1>
        <div className="flex items-center gap-2 text-sm">
          <Filter size={14} className="text-[#b3001e]" />
          {['all','unclassified','classified','posted'].map(k => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded-full border text-xs font-bold transition-colors ${filter===k ? 'bg-[#b3001e] text-white border-[#b3001e]' : 'border-black/10 dark:border-white/20 text-black/70 dark:text-white/70 hover:border-[#b3001e]'}`}>
              {k === 'all' ? 'Todos' : (STATUS_PILL[k]?.es || k)}
            </button>
          ))}
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors mb-6
          ${dragOver ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-black/15 dark:border-white/15 hover:border-[#b3001e]'}`}
      >
        <input ref={fileInputRef} type="file" multiple className="hidden"
          onChange={(e) => handleFiles(e.target.files)} />
        <Upload size={28} className="mx-auto text-[#b3001e] mb-2" />
        <p className="text-sm font-bold text-black dark:text-white">Arrastra archivos aquí o haz clic para seleccionar</p>
        <p className="text-xs text-black/50 dark:text-white/50 mt-1">PDF, XML, CSV, imágenes — clasificación automática + OCR</p>
        {busy && <p className="mt-3 text-xs text-[#b3001e] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Subiendo…</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr className="text-left">
                <th className="px-4 py-2 font-bold">Documento</th>
                <th className="px-4 py-2 font-bold">Tipo</th>
                <th className="px-4 py-2 font-bold">Estado</th>
                <th className="px-4 py-2 font-bold">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan="4" className="px-4 py-8 text-center text-black/40 dark:text-white/40">Sin documentos</td></tr>
              )}
              {filtered.map(i => (
                <tr key={i.id} onClick={() => setSelected(i)}
                  className={`cursor-pointer border-b border-black/5 dark:border-white/10 hover:bg-[#b3001e]/5 ${selected?.id === i.id ? 'bg-[#b3001e]/10' : ''}`}>
                  <td className="px-4 py-2 inline-flex items-center gap-2 text-black dark:text-white">
                    <FileText size={14} className="text-[#b3001e]" /> {i.original_filename}
                  </td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{TYPE_LABELS[i.classified_type] || i.classified_type}</td>
                  <td className="px-4 py-2"><Pill kind={i.status} /></td>
                  <td className="px-4 py-2 text-black/50 dark:text-white/50 whitespace-nowrap">{(i.created_at || '').slice(0,10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 p-5">
          {!selected && <p className="text-sm text-black/50 dark:text-white/50">Selecciona un documento.</p>}
          {selected && (
            <div className="space-y-3 text-sm">
              <h3 className="font-black text-black dark:text-white text-base break-all">{selected.original_filename}</h3>
              <Pill kind={selected.status} />

              <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mt-3">Cliente</label>
              <select
                value={selected.accounting_client_id || ''}
                onChange={(e) => classify(selected, { accounting_client_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-black border border-black/15 dark:border-white/15 text-black dark:text-white">
                <option value="">— Sin asignar —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
              </select>

              <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50">Tipo</label>
              <select
                value={selected.classified_type}
                onChange={(e) => classify(selected, { classified_type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-black border border-black/15 dark:border-white/15 text-black dark:text-white">
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>

              <details className="rounded-lg border border-black/10 dark:border-white/10 p-2">
                <summary className="cursor-pointer text-xs font-bold text-black/70 dark:text-white/70">Texto OCR</summary>
                <pre className="mt-2 max-h-40 overflow-auto text-[11px] whitespace-pre-wrap text-black/80 dark:text-white/80">{selected.ocr_text || '— Pendiente —'}</pre>
              </details>

              <div className="flex gap-2 pt-2">
                <button onClick={() => postEntry(selected)}
                  disabled={selected.status === 'posted'}
                  className="flex-1 px-3 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold disabled:opacity-50 hover:bg-[#c8002a] inline-flex items-center justify-center gap-1">
                  <Check size={14} /> Postear
                </button>
                <button onClick={() => classify(selected, { status: 'archived' })}
                  className="px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 text-black/70 dark:text-white/70 text-sm hover:border-[#b3001e] hover:text-[#b3001e]">
                  <FileX2 size={14} />
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
