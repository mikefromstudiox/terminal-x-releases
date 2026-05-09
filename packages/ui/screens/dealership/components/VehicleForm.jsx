/**
 * VehicleForm.jsx — Sprint 2D M1.
 *
 * Extracted CRUD form modal from VehicleInventory.jsx (preserves behavior 1:1).
 * Tabs: data + docs (when editing). Photo upload, status/title/condition selects.
 *
 * Props: open, unit, lang, onSave(data), onClose, onReload
 */

import { useRef, useState } from 'react'
import { X, Loader2, Upload, Image as ImageIcon } from 'lucide-react'
import { useAPI } from '../../../context/DataContext'
import VehicleDocumentManager from './VehicleDocumentManager.jsx'

const CONDITIONS = [
  { v: 'new',       es: 'Nuevo',       en: 'New' },
  { v: 'used',      es: 'Usado',       en: 'Used' },
  { v: 'certified', es: 'Certificado', en: 'Certified' },
]
const STATUSES = [
  { v: 'available',  es: 'Disponible', en: 'Available' },
  { v: 'reserved',   es: 'Reservado',  en: 'Reserved' },
  { v: 'sold',       es: 'Vendido',    en: 'Sold' },
  { v: 'in_service', es: 'En Servicio',en: 'In Service' },
]
const TITLE_STATUS = [
  { v: 'clean',   es: 'Limpio',      en: 'Clean' },
  { v: 'salvage', es: 'Salvamento',  en: 'Salvage' },
  { v: 'lien',    es: 'Con Gravamen',en: 'Lien' },
  { v: 'pending', es: 'Pendiente',   en: 'Pending' },
]

export default function VehicleForm({ open, unit, lang, onSave, onClose, onReload }) {
  const api = useAPI()
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    stock_number:     unit?.stock_number     || '',
    vin:              unit?.vin              || '',
    make:             unit?.make             || '',
    model:            unit?.model            || '',
    year:             unit?.year             || new Date().getFullYear(),
    color:            unit?.color            || '',
    mileage:          unit?.mileage          || 0,
    condition:        unit?.condition        || 'used',
    acquisition_cost: unit?.acquisition_cost || 0,
    listing_price:    unit?.listing_price    || 0,
    status:           unit?.status           || 'available',
    title_status:     unit?.title_status     || 'clean',
    notes:            unit?.notes            || '',
  })
  const [photos, setPhotos] = useState(Array.isArray(unit?.photo_urls) ? unit.photo_urls : [])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('data')
  const fileRef = useRef(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  if (!open) return null

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length || !unit?.id) return
    setUploading(true)
    try {
      for (const f of files) {
        const url = await api.vehicleInventory.uploadPhoto(unit.id, f)
        if (url) setPhotos(p => [...p, url])
      }
      onReload?.()
    } catch (ex) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(ex, { severity: 'error', category: 'vehicleform.vehicleform' }) } catch {} setErr(ex?.message || L('Subida falló', 'Upload failed')) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }
  async function handleRemovePhoto(url) {
    if (!unit?.id) return
    if (!confirm(L('¿Eliminar foto?', 'Delete photo?'))) return
    await api.vehicleInventory.removePhoto(unit.id, url)
    setPhotos(p => p.filter(u => u !== url))
    onReload?.()
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.make.trim() || !form.model.trim()) { setErr(L('Marca y modelo son requeridos.', 'Make and model are required.')); return }
    setSaving(true); setErr('')
    try {
      await onSave({
        ...form,
        year: Number(form.year) || null,
        mileage: Number(form.mileage) || 0,
        acquisition_cost: Number(form.acquisition_cost) || 0,
        listing_price: Number(form.listing_price) || 0,
      })
      onClose()
    } catch (ex) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(ex, { severity: 'error', category: 'vehicleform.vehicleform' }) } catch {} setErr(ex?.message || L('Error al guardar.', 'Save failed.')); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold">{unit ? L('Editar Unidad', 'Edit Unit') : L('Nueva Unidad', 'New Unit')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
        </div>
        {unit?.id && (
          <div className="flex border-b border-black">
            <button type="button" onClick={() => setTab('data')} className={`flex-1 px-4 py-2 text-sm font-semibold ${tab === 'data' ? 'bg-black text-white' : 'bg-white text-black'}`}>{L('Datos', 'Details')}</button>
            <button type="button" onClick={() => setTab('docs')} className={`flex-1 px-4 py-2 text-sm font-semibold border-l border-black ${tab === 'docs' ? 'bg-black text-white' : 'bg-white text-black'}`}>{L('Documentos', 'Documents')}</button>
          </div>
        )}
        {tab === 'docs' && unit?.id ? (
          <VehicleDocumentManager embedded vehicle={unit} onClose={onClose} />
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            {err && <div className="bg-[#b3001e] text-white px-3 py-2 text-sm">{err}</div>}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold">{L('# Stock', 'Stock #')}</span>
                <input value={form.stock_number} onChange={e => set('stock_number', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">VIN</span>
                <input value={form.vin} onChange={e => set('vin', e.target.value.toUpperCase())} maxLength={17} className="mt-1 w-full border border-black px-2 py-1.5 font-mono" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Marca', 'Make')}*</span>
                <input value={form.make} onChange={e => set('make', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" required />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Modelo', 'Model')}*</span>
                <input value={form.model} onChange={e => set('model', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" required />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Año', 'Year')}</span>
                <input type="number" value={form.year} onChange={e => set('year', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Color', 'Color')}</span>
                <input value={form.color} onChange={e => set('color', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Kilometraje', 'Mileage')}</span>
                <input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Condición', 'Condition')}</span>
                <select value={form.condition} onChange={e => set('condition', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                  {CONDITIONS.map(c => <option key={c.v} value={c.v}>{lang === 'es' ? c.es : c.en}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Costo de Adquisición', 'Acquisition Cost')}</span>
                <input type="number" step="0.01" value={form.acquisition_cost} onChange={e => set('acquisition_cost', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Precio de Venta', 'Listing Price')}</span>
                <input type="number" step="0.01" value={form.listing_price} onChange={e => set('listing_price', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Estado', 'Status')}</span>
                <select value={form.status} onChange={e => set('status', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                  {STATUSES.map(s => <option key={s.v} value={s.v}>{lang === 'es' ? s.es : s.en}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold">{L('Título', 'Title')}</span>
                <select value={form.title_status} onChange={e => set('title_status', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                  {TITLE_STATUS.map(t => <option key={t.v} value={t.v}>{lang === 'es' ? t.es : t.en}</option>)}
                </select>
              </label>
            </div>
            {unit?.id && (
              <div className="border-t border-black/10 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold flex items-center gap-1"><ImageIcon size={14}/>{L('Fotos', 'Photos')} ({photos.length})</span>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="px-3 py-1.5 text-xs bg-black text-white inline-flex items-center gap-1 disabled:opacity-50">
                    {uploading ? <Loader2 size={12} className="animate-spin"/> : <Upload size={12}/>}
                    {L('Subir', 'Upload')}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload}/>
                </div>
                {photos.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {photos.map(url => (
                      <div key={url} className="relative aspect-square border border-black/20 group">
                        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy"/>
                        <button type="button" onClick={() => handleRemovePhoto(url)} className="absolute top-0 right-0 p-1 bg-[#b3001e] text-white opacity-0 group-hover:opacity-100"><X size={12}/></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-black/40 text-center py-3 border border-dashed border-black/20">{L('Sin fotos', 'No photos')}</p>
                )}
              </div>
            )}
            {!unit?.id && <p className="text-xs text-black/50 italic">{L('Guarde la unidad primero para subir fotos.', 'Save the unit first to upload photos.')}</p>}
            <label className="block">
              <span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 border border-black">{L('Cancelar', 'Cancel')}</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-black text-white disabled:opacity-50 inline-flex items-center gap-2">
                {saving && <Loader2 size={16} className="animate-spin" />} {L('Guardar', 'Save')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
