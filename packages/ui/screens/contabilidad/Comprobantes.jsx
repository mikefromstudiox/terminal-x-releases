// Comprobantes — wraps existing dgii-reports.js generators (606/607/608).
// Phase 1: reuse — no rebuild.
import { useState, useMemo } from 'react'
import { FileText, Download } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import {
  generateFormato606Txt, generateFormato607Txt,
  filename606, filename607, downloadTxt,
} from '@terminal-x/services/dgii-reports.js'

const MONTHS = [
  '01 - Enero','02 - Febrero','03 - Marzo','04 - Abril','05 - Mayo','06 - Junio',
  '07 - Julio','08 - Agosto','09 - Septiembre','10 - Octubre','11 - Noviembre','12 - Diciembre',
]

export default function Comprobantes() {
  const api = useAPI()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [rnc, setRnc] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const years = useMemo(() => {
    const y = today.getFullYear()
    return [y, y - 1, y - 2]
  }, [today])

  async function build(kind) {
    setBusy(true)
    try {
      let txt = '', name = ''
      if (kind === '606') {
        const compras = await api?.dgii?.compras607?.({ year, month }) || []
        txt = generateFormato606Txt(compras, rnc, year, month)
        name = filename606(rnc, year, month)
      } else if (kind === '607') {
        const tickets = await api?.dgii?.ventas606?.({ year, month }) || []
        txt = generateFormato607Txt(tickets, rnc, year, month)
        name = filename607(rnc, year, month)
      } else if (kind === '608') {
        const anulados = await api?.dgii?.anulados608?.({ year, month }) || []
        const header = `608|${rnc.replace(/\D/g,'')}|${year}${String(month).padStart(2,'0')}|${anulados.length}`
        const body = anulados.map(a => [a.ncf || '', a.fecha_anulacion || '', a.motivo || '01'].join('|')).join('\n')
        txt = [header, body].filter(Boolean).join('\n') + '\n'
        name = `DGII_F608_${rnc.replace(/\D/g,'')}_${year}${String(month).padStart(2,'0')}.txt`
      }
      setPreview({ kind, name, txt })
    } finally {
      setBusy(false)
    }
  }

  function download() {
    if (!preview) return
    downloadTxt(preview.txt, preview.name)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-black text-black dark:text-white mb-5 inline-flex items-center gap-2">
        <FileText size={22} className="text-[#b3001e]" /> Comprobantes DGII
      </h1>

      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 p-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">RNC emisor</label>
          <input value={rnc} onChange={(e) => setRnc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-black border border-black/15 dark:border-white/15 text-black dark:text-white" />
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
        <div className="flex items-end">
          <div className="grid grid-cols-3 gap-2 w-full">
            {['606','607','608'].map(k => (
              <button key={k} onClick={() => build(k)} disabled={busy || !rnc}
                className="px-3 py-2 rounded-lg bg-[#b3001e] hover:bg-[#c8002a] text-white text-sm font-bold disabled:opacity-50">{k}</button>
            ))}
          </div>
        </div>
      </div>

      {preview && (
        <div className="mt-5 rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-black dark:text-white">Vista previa: {preview.name}</h2>
            <button onClick={download}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-black text-white text-xs font-bold hover:bg-[#b3001e] dark:bg-white dark:text-black">
              <Download size={12} /> Descargar TXT
            </button>
          </div>
          <pre className="max-h-96 overflow-auto text-[11px] font-mono whitespace-pre-wrap text-black/80 dark:text-white/80 bg-black/[0.02] dark:bg-white/[0.02] p-3 rounded-lg">{preview.txt || '— sin filas —'}</pre>
        </div>
      )}
    </div>
  )
}
