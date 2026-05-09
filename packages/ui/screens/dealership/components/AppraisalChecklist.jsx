/**
 * AppraisalChecklist.jsx — Sprint 2E item 2.
 *
 * Detailed trade-in vehicle appraisal. Categorias: motor, transmision,
 * carroceria, interior, llantas, electrico, papeles. Each rated
 * Excelente / Bueno / Regular / Malo / N/A. Photos optional via Supabase
 * storage (vehicle-photos/appraisals/{deal_temp_id}/). Notes textarea.
 *
 * Suggested value calculation:
 *   base = trade-in input value
 *   each "Regular" -2%, each "Malo" -5%
 *
 * onApply(suggestedValue): writes back to DealBuilder tradeIn.appraisal.
 * onSave(checklistJson): persists checklist; DealBuilder appends to notes.
 */

import { useState, useEffect } from 'react'
import { X, Camera, Check, Loader2, FileText } from 'lucide-react'
import { useLang } from '../../../i18n'

const CATEGORIES = [
  { id: 'motor',       es: 'Motor',        en: 'Engine' },
  { id: 'transmision', es: 'Transmision',  en: 'Transmission' },
  { id: 'carroceria',  es: 'Carroceria',   en: 'Body' },
  { id: 'interior',    es: 'Interior',     en: 'Interior' },
  { id: 'llantas',     es: 'Llantas',      en: 'Tires' },
  { id: 'electrico',   es: 'Electrico',    en: 'Electrical' },
  { id: 'papeles',     es: 'Papeles',      en: 'Papers' },
]
const RATINGS = [
  { v: 'excelente', es: 'Excelente', en: 'Excellent', delta: 0,    color: 'bg-emerald-50 border-emerald-600 text-emerald-800' },
  { v: 'bueno',     es: 'Bueno',     en: 'Good',      delta: 0,    color: 'bg-sky-50 border-sky-600 text-sky-800' },
  { v: 'regular',   es: 'Regular',   en: 'Fair',      delta: -2,   color: 'bg-amber-50 border-amber-600 text-amber-800' },
  { v: 'malo',      es: 'Malo',      en: 'Poor',      delta: -5,   color: 'bg-red-50 border-[#b3001e] text-[#b3001e]' },
  { v: 'na',        es: 'N/A',       en: 'N/A',       delta: 0,    color: 'bg-slate-50 border-slate-400 text-slate-600' },
]

const fmtMoney = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })

function calcSuggested(baseValue, categories) {
  const base = Math.max(0, Number(baseValue) || 0)
  let pct = 0
  for (const cat of CATEGORIES) {
    const r = categories?.[cat.id]
    const ratingDef = RATINGS.find(x => x.v === r)
    if (ratingDef) pct += ratingDef.delta
  }
  return Math.max(0, +(base * (1 + pct / 100)).toFixed(2))
}

export default function AppraisalChecklist({
  baseValue = 0,
  tempId,
  initial = null,
  onApply,
  onSave,
  onClose,
}) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [categories, setCategories] = useState(() => initial?.categories || {})
  const [notes, setNotes] = useState(initial?.notes || '')
  const [photos, setPhotos] = useState(initial?.photos || [])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  const suggested = calcSuggested(baseValue, categories)

  function setRating(catId, rating) {
    setCategories(c => ({ ...c, [catId]: rating }))
  }

  async function handlePhotos(files) {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      // Lazy-load supabase only when the cashier actually uploads — keeps the
      // modal cheap on initial mount and lets the screen render even when the
      // SDK isn't configured (no-op if storage rejects).
      const mod = await import('@terminal-x/services/supabase.js').catch(() => null)
      const sb = mod?.getSupabaseClient?.()
      if (!sb) throw new Error('Supabase no configurado')
      const out = []
      for (const f of files) {
        if (!f) continue
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `appraisals/${tempId || 'no-id'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await sb.storage.from('vehicle-photos').upload(path, f, {
          contentType: f.type || 'image/jpeg', upsert: false,
        })
        if (upErr) throw upErr
        const { data: pub } = sb.storage.from('vehicle-photos').getPublicUrl(path)
        out.push({ path, url: pub?.publicUrl || null })
      }
      setPhotos(p => [...p, ...out])
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'appraisalchecklist.calcsuggested' }) } catch {}
      setUploadError(e?.message || String(e))
    } finally {
      setUploading(false)
    }
  }

  function applyAndSave() {
    const checklist = {
      categories,
      notes: notes.trim() || null,
      photos,
      base_value: Number(baseValue) || 0,
      suggested_value: suggested,
      recorded_at: new Date().toISOString(),
    }
    onApply?.(suggested)
    onSave?.(checklist)
  }

  function applyOnly() {
    onApply?.(suggested)
    onSave?.({
      categories, notes: notes.trim() || null, photos,
      base_value: Number(baseValue) || 0, suggested_value: suggested,
      recorded_at: new Date().toISOString(),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="bg-[#b3001e] text-white px-5 py-3 flex items-center justify-between sticky top-0 z-10">
          <h2 className="text-lg font-bold flex items-center gap-2"><FileText size={18} />{L('Tasacion Detallada', 'Detailed Appraisal')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-white hover:text-[#b3001e]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="border border-black bg-black text-white p-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] opacity-70 uppercase">{L('Valor Base', 'Base Value')}</div>
              <div className="text-lg font-bold tabular-nums">{fmtMoney.format(baseValue || 0)}</div>
            </div>
            <div>
              <div className="text-[10px] opacity-70 uppercase">{L('Ajuste', 'Adjustment')}</div>
              <div className="text-lg font-bold tabular-nums">
                {((baseValue ? (suggested - baseValue) / baseValue : 0) * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] opacity-70 uppercase">{L('Sugerido', 'Suggested')}</div>
              <div className="text-2xl font-extrabold tabular-nums text-[#b3001e]">{fmtMoney.format(suggested)}</div>
            </div>
          </div>

          <div className="space-y-2">
            {CATEGORIES.map(cat => (
              <div key={cat.id} className="border border-black p-3">
                <div className="text-sm font-bold mb-2">{lang === 'es' ? cat.es : cat.en}</div>
                <div className="grid grid-cols-5 gap-1">
                  {RATINGS.map(r => {
                    const selected = categories[cat.id] === r.v
                    return (
                      <button
                        key={r.v}
                        type="button"
                        onClick={() => setRating(cat.id, r.v)}
                        className={`text-xs font-semibold px-2 py-2 border-2 transition-all ${
                          selected ? r.color : 'border-black/20 bg-white text-black/60 hover:border-black/60'
                        }`}
                      >
                        {lang === 'es' ? r.es : r.en}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="border border-black p-3">
            <div className="text-sm font-bold mb-2 flex items-center gap-2"><Camera size={14} />{L('Fotos (opcional)', 'Photos (optional)')}</div>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={e => handlePhotos(e.target.files)}
              disabled={uploading}
              className="text-xs w-full"
            />
            {uploading && <div className="text-xs text-black/60 mt-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{L('Subiendo...', 'Uploading...')}</div>}
            {uploadError && <div className="text-xs text-[#b3001e] mt-2">{uploadError}</div>}
            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative aspect-square border border-black/20 bg-black/5 overflow-hidden">
                    {p.url ? (
                      <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-black/30 text-[10px]">{p.path}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder={L('Detalles adicionales, defectos visibles, historial conocido...', 'Additional details, visible defects, known history...')}
              className="mt-1 w-full border border-black px-2 py-1.5 text-xs" />
          </label>
        </div>

        <div className="border-t border-black p-4 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 border border-black text-sm">{L('Cancelar', 'Cancel')}</button>
          <button onClick={applyAndSave}
            className="px-4 py-2 bg-[#b3001e] text-white text-sm font-bold inline-flex items-center gap-2">
            <Check size={14} />
            {L('Aplicar tasacion sugerida', 'Apply suggested value')}
          </button>
        </div>
      </div>
    </div>
  )
}
