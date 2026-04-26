/**
 * VehicleDocumentManager.jsx — Sprint 2D M1.
 *
 * Documents tab for a vehicle_inventory unit. Self-fetches via
 * api.vehicleDocuments.byVehicle(supabase_id). Upload, delete, expiry chips.
 * Extracted verbatim (behavior-preserving) from VehicleInventory.jsx.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Upload, Trash2, FileText, Calendar, X } from 'lucide-react'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'

const DOC_TYPES = [
  { v: 'title',         es: 'Título',           en: 'Title' },
  { v: 'registration',  es: 'Matrícula',        en: 'Registration' },
  { v: 'insurance',     es: 'Seguro',           en: 'Insurance' },
  { v: 'inspection',    es: 'Inspección',       en: 'Inspection' },
  { v: 'other',         es: 'Otro',             en: 'Other' },
]

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function expiryClass(expires_at) {
  if (!expires_at) return ''
  const days = Math.floor((new Date(expires_at).getTime() - Date.now()) / 86400000)
  if (days < 0) return 'bg-[#b3001e] text-white'
  if (days <= 30) return 'bg-black text-white'
  return 'border border-black'
}

export default function VehicleDocumentManager({ open, vehicle, onClose, embedded = false }) {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const vehicleSupabaseId = vehicle?.supabase_id

  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [docType, setDocType] = useState('title')
  const [expiresAt, setExpiresAt] = useState('')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  async function load() {
    if (!vehicleSupabaseId) { setDocs([]); setLoading(false); return }
    setLoading(true)
    const r = await api.vehicleDocuments.byVehicle(vehicleSupabaseId)
    setDocs(r || [])
    setLoading(false)
  }
  useEffect(() => { if (open || embedded) load() }, [vehicleSupabaseId, open, embedded]) // eslint-disable-line

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true); setErr('')
    try {
      await api.vehicleDocuments.upload({
        vehicleSupabaseId,
        file: f,
        docType,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        notes: notes || null,
      })
      setExpiresAt(''); setNotes('')
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (ex) { setErr(ex?.message || L('Subida falló', 'Upload failed')) }
    finally { setUploading(false) }
  }

  async function remove(d) {
    if (!confirm(L('¿Eliminar documento?', 'Delete document?'))) return
    await api.vehicleDocuments.delete(d.id)
    await load()
  }

  const body = (
    <div className="p-5 space-y-4">
      {err && <div className="bg-[#b3001e] text-white px-3 py-2 text-sm">{err}</div>}
      <div className="border border-black p-3 space-y-2">
        <div className="text-xs font-semibold mb-1">{L('Subir Documento', 'Upload Document')}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs">{L('Tipo', 'Type')}</span>
            <select value={docType} onChange={e => setDocType(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5 text-sm">
              {DOC_TYPES.map(t => <option key={t.v} value={t.v}>{lang === 'es' ? t.es : t.en}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs flex items-center gap-1"><Calendar size={10}/>{L('Vence', 'Expires')}</span>
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5 text-sm"/>
          </label>
        </div>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder={L('Notas', 'Notes')} className="w-full border border-black px-2 py-1.5 text-sm"/>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full px-3 py-2 bg-black text-white inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {uploading ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>}
          {L('Seleccionar Archivo', 'Choose File')}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf" className="hidden" onChange={onFile}/>
      </div>

      <div>
        <div className="text-xs font-semibold mb-2 flex items-center gap-1"><FileText size={12}/>{L('Documentos', 'Documents')} ({docs.length})</div>
        {loading ? <div className="text-center py-4"><Loader2 size={16} className="animate-spin mx-auto"/></div>
        : docs.length === 0 ? <p className="text-xs text-black/40 text-center py-4 border border-dashed border-black/20">{L('Sin documentos.', 'No documents.')}</p>
        : (
          <ul className="divide-y divide-black/10 border border-black/10">
            {docs.map(d => {
              const t = DOC_TYPES.find(x => x.v === d.doc_type)
              return (
                <li key={d.id} className="p-2 flex items-center gap-2 text-sm">
                  <span className="px-2 py-0.5 text-xs font-semibold bg-black text-white">{t ? (lang === 'es' ? t.es : t.en) : d.doc_type}</span>
                  <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate underline text-xs">{d.file_name || L('Ver archivo', 'View file')}</a>
                  {d.expires_at && (
                    <span className={`px-1.5 py-0.5 text-xs font-semibold ${expiryClass(d.expires_at)}`}>
                      {fmtDate(d.expires_at)}
                    </span>
                  )}
                  <button onClick={() => remove(d)} className="p-1 hover:bg-[#b3001e] hover:text-white"><Trash2 size={12}/></button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )

  if (embedded) return body
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold">{L('Documentos', 'Documents')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={20}/></button>
        </div>
        {body}
      </div>
    </div>
  )
}
