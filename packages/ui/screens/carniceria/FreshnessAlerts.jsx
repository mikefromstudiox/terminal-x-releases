import { useState, useEffect, useMemo, useRef } from 'react'
import { AlertTriangle, Leaf, Trash2, Camera, X, Loader2, Percent, Upload } from 'lucide-react'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'
import { useLicense } from '../../context/LicenseContext'
import { uploadDiscardPhoto, removePhoto } from '@terminal-x/services/carniceriaStorage'

function newSid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16)
  })
}

// Tipo de descarte governs whether an E33 NCC fires after the row is written.
// "interna" = inventory write-off; "post_venta" = customer return / post-sale
// merma → triggers E33 against the most recent ticket carrying this item.
const TIPOS = [
  { key: 'interna',    label: 'Merma interna (vencido en nevera)' },
  { key: 'post_venta', label: 'Devolución de cliente (post-venta)' },
]

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr); const now = new Date()
  const ms = d.setHours(0,0,0,0) - now.setHours(0,0,0,0)
  return Math.round(ms / 86400000)
}
function bandFor(days) {
  if (days == null) return 'gray'
  if (days <= 1) return 'red'
  if (days <= 3) return 'amber'
  return 'green'
}
const BAND_STYLE = {
  green:  'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10',
  amber:  'border-amber-500/40 bg-amber-50 dark:bg-amber-500/10',
  red:    'border-red-500/40 bg-red-50 dark:bg-red-500/10',
  gray:   'border-slate-300 bg-slate-50 dark:bg-white/5',
}
const BAND_TEXT = { green: 'text-emerald-700 dark:text-emerald-300', amber: 'text-amber-700 dark:text-amber-300', red: 'text-red-700 dark:text-red-300', gray: 'text-slate-500' }

export default function FreshnessAlerts() {
  const api = useAPI()
  const { lang } = useLang()
  const { result: lic } = useLicense()
  const businessId = lic?.businessId || null
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [autoDiscount, setAutoDiscount] = useState(true)
  const [discardOf, setDiscardOf] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const list = await api?.carniceria?.freshness?.list?.() || []
      setBatches(list)
    } catch { setBatches([]) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const grouped = useMemo(() => {
    const out = { red: [], amber: [], green: [] }
    for (const b of batches) {
      if (Number(b.qty_remaining || 0) <= 0) continue
      const band = bandFor(daysUntil(b.expires_at))
      if (out[band]) out[band].push({ ...b, daysLeft: daysUntil(b.expires_at) })
    }
    return out
  }, [batches])

  async function applyDiscount(b) {
    await api?.carniceria?.freshness?.applyDiscount?.({ id: b.id, pct: 50 })
    load()
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-zinc-900">
      <header className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 bg-white dark:bg-black">
        <div className="flex items-center gap-3">
          <Leaf size={22} className="text-[#b3001e]" />
          <h1 className="text-[18px] font-bold dark:text-white">{lang === 'es' ? 'Frescura & Vencimientos' : 'Freshness & Expiry'}</h1>
        </div>
        <label className="flex items-center gap-2 text-[12px] dark:text-white/70 cursor-pointer">
          <input type="checkbox" checked={autoDiscount} onChange={e => setAutoDiscount(e.target.checked)} className="accent-[#b3001e]" />
          <Percent size={13} /> {lang === 'es' ? 'Auto -50% día antes de vencer' : 'Auto -50% day before expiry'}
        </label>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-[#b3001e]" /></div>
        ) : (
          <>
            <Band title={lang === 'es' ? 'Vence hoy o mañana' : 'Expires today or tomorrow'} band="red"
                  rows={grouped.red} onDiscount={applyDiscount} onDiscard={setDiscardOf} />
            <Band title={lang === 'es' ? 'Vence en 2-3 días' : 'Expires in 2-3 days'} band="amber"
                  rows={grouped.amber} onDiscount={applyDiscount} onDiscard={setDiscardOf} />
            <Band title={lang === 'es' ? 'Frescos (4+ días)' : 'Fresh (4+ days)'} band="green"
                  rows={grouped.green} onDiscount={applyDiscount} onDiscard={setDiscardOf} />
          </>
        )}
      </div>

      {discardOf && <DiscardModal batch={discardOf} businessId={businessId} onClose={() => setDiscardOf(null)} onSaved={load} api={api} lang={lang} />}
    </div>
  )
}

function Band({ title, band, rows, onDiscount, onDiscard }) {
  if (rows.length === 0) return null
  return (
    <section>
      <h2 className={`text-[13px] font-bold mb-2 flex items-center gap-2 ${BAND_TEXT[band]}`}>
        {band === 'red' && <AlertTriangle size={14} />} {title} <span className="text-[11px] opacity-60">({rows.length})</span>
      </h2>
      <div className="grid gap-2">
        {rows.map(b => (
          <div key={b.id} className={`flex items-center gap-3 p-3 rounded-xl border ${BAND_STYLE[band]}`}>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[13px] dark:text-white">{b.item_name || b.inventory_item_supabase_id}</p>
              <p className="text-[11px] text-slate-500 dark:text-white/50">
                Lote {b.batch_lote || '—'} · Recibido {b.received_at} · Vence {b.expires_at}
                {b.daysLeft != null && <> · <span className={BAND_TEXT[band]}>{b.daysLeft <= 0 ? 'hoy' : `en ${b.daysLeft} día${b.daysLeft===1?'':'s'}`}</span></>}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-white/60 mt-0.5">
                Quedan <strong>{Number(b.qty_remaining).toFixed(2)} {b.unit || 'lb'}</strong>
                {b.auto_discount_applied && <span className="ml-2 px-1.5 py-0.5 rounded bg-[#b3001e]/15 text-[#b3001e] text-[10px] font-bold">-50% APLICADO</span>}
              </p>
            </div>
            {!b.auto_discount_applied && (
              <button onClick={() => onDiscount(b)}
                className="px-3 py-2 text-[11px] font-bold bg-[#b3001e] hover:bg-[#c8002a] text-white rounded-lg whitespace-nowrap">
                Aplicar -50%
              </button>
            )}
            <button onClick={() => onDiscard(b)}
              className="px-3 py-2 text-[11px] font-semibold bg-white dark:bg-white/10 hover:bg-slate-100 dark:hover:bg-white/20 text-slate-700 dark:text-white border border-black/10 dark:border-white/20 rounded-lg flex items-center gap-1">
              <Trash2 size={12} /> Descartar
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function DiscardModal({ batch, businessId, onClose, onSaved, api, lang }) {
  // Pre-mint the discard supabase_id so the photo's storage path is stable
  // BEFORE the DB row exists. If save fails we delete the orphan blob.
  const sidRef = useRef(newSid())
  const [qty, setQty] = useState(batch.qty_remaining)
  const [motivo, setMotivo] = useState('')
  const [tipo, setTipo] = useState('interna')
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoPath, setPhotoPath] = useState(null)
  const [photoBucket, setPhotoBucket] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [e33Notice, setE33Notice] = useState(null)

  async function pickPhoto(e) {
    const f = e.target.files?.[0]; if (!f) return
    setErr('')
    if (!businessId) { setErr(lang === 'es' ? 'No se pudo identificar el negocio.' : 'Business id missing.'); e.target.value = ''; return }
    setUploading(true); setUploadPct(0)
    try {
      const r = await uploadDiscardPhoto({
        business_id: businessId,
        discard_supabase_id: sidRef.current,
        file: f,
        onProgress: (p) => setUploadPct(p),
      })
      if (!r.ok) {
        const msg = r.error === 'offline'
          ? (lang === 'es' ? 'Sin conexión — la foto del descarte requiere internet.' : 'Offline — discard photo requires internet.')
          : (lang === 'es' ? 'Error al subir foto: ' : 'Upload error: ') + r.error
        setErr(msg)
        return
      }
      setPhotoUrl(r.url); setPhotoPath(r.path); setPhotoBucket(r.bucket)
    } finally {
      setUploading(false); setUploadPct(0); e.target.value = ''
    }
  }

  async function clearPhoto() {
    if (photoPath && photoBucket) {
      await removePhoto(photoBucket, photoPath).catch(() => {})
    }
    setPhotoUrl(''); setPhotoPath(null); setPhotoBucket(null)
  }

  async function save() {
    if (!motivo.trim()) return
    setSaving(true)
    setErr('')
    setE33Notice(null)
    try {
      const fn = api?.carniceria?.discards?.create
      if (typeof fn !== 'function') throw new Error(lang === 'es' ? 'Descartes no disponibles en este modo.' : 'Discards unavailable in this mode.')
      const result = await fn({
        supabase_id: sidRef.current,
        inventory_item_supabase_id: batch.inventory_item_supabase_id,
        freshness_log_supabase_id: batch.supabase_id,
        qty: Number(qty), unit: batch.unit || 'lb',
        motivo: motivo.trim(),
        photo_url: photoUrl,
        is_post_sale: tipo === 'post_venta' ? 1 : 0,
      })
      // E33 enqueue feedback — DB returns { id, supabase_id, e33_enqueued? }
      if (result?.e33_enqueued) {
        setE33Notice(lang === 'es'
          ? `E33 (Nota de Crédito) en cola: ${result.e33_enqueued.encf || 'pendiente'}`
          : `E33 credit note queued: ${result.e33_enqueued.encf || 'pending'}`)
        // brief delay so cashier sees the notice before the modal closes
        setTimeout(() => { onSaved(); onClose() }, 1500)
      } else {
        onSaved(); onClose()
      }
    } catch (e) {
      // H4: rollback the orphan photo blob if the DB row failed.
      if (photoPath && photoBucket) {
        await removePhoto(photoBucket, photoPath).catch(() => {})
        setPhotoUrl(''); setPhotoPath(null); setPhotoBucket(null)
      }
      const base = lang === 'es'
        ? 'No se pudo registrar el descarte (el corte sigue en inventario): '
        : 'Could not record discard (the cut is still in inventory): '
      setErr(base + (e?.message || (lang === 'es' ? 'error desconocido' : 'unknown error')))
      // eslint-disable-next-line no-console
      console.error('[FreshnessAlerts.discard]', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 p-6 w-[420px] max-w-[92vw] shadow-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold dark:text-white">{lang === 'es' ? 'Descartar producto' : 'Discard product'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"><X size={16} className="dark:text-white/40" /></button>
        </div>
        <p className="text-[12px] text-slate-500 dark:text-white/50">
          {batch.item_name} — Lote {batch.batch_lote || '—'}
        </p>
        <div>
          <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Cantidad ({batch.unit || 'lb'})</label>
          <input type="number" step="0.01" value={qty} onChange={e => setQty(e.target.value)} max={batch.qty_remaining}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Tipo de descarte</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25">
            {TIPOS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          {tipo === 'post_venta' && (
            <p className="mt-1 text-[10px] text-[#b3001e] font-semibold flex items-center gap-1">
              <AlertTriangle size={10} /> Generará Nota de Crédito Electrónica E33 automática.
            </p>
          )}
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Motivo</label>
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
            placeholder={tipo === 'post_venta' ? 'Cliente devolvió porque…' : 'Olor, color, derrame…'}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25 resize-none" />
        </div>

        {/* ── Photo upload ─────────────────────────────────────────────── */}
        {photoUrl ? (
          <div className="relative">
            <img src={photoUrl} alt="descarte" className="w-full max-h-48 object-cover rounded-xl border border-black/10 dark:border-white/10" />
            <button type="button" onClick={clearPhoto}
              className="absolute top-2 right-2 px-2 py-1 text-[11px] font-bold bg-black/70 hover:bg-[#b3001e] text-white rounded-lg flex items-center gap-1">
              <X size={11} /> Quitar
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-1 px-3 py-4 rounded-xl border-2 border-dashed border-black/15 dark:border-white/15 hover:border-[#b3001e] hover:bg-[#b3001e]/5 dark:hover:bg-[#b3001e]/10 cursor-pointer transition-colors">
            {uploading
              ? <><Loader2 size={18} className="animate-spin text-[#b3001e]" /><span className="text-[12px] text-slate-500 dark:text-white/60">Subiendo… {Math.round(uploadPct * 100)}%</span></>
              : <><Camera size={16} className="text-[#b3001e]" /><span className="text-[12px] text-slate-600 dark:text-white/70">Adjuntar foto del descarte</span><span className="text-[10px] text-slate-400">JPG/PNG/WebP · máx 8 MB</span></>}
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
              onChange={pickPhoto} disabled={uploading} className="hidden" />
          </label>
        )}

        {err && (
          <div className="text-[12px] text-white bg-[#b3001e] px-3 py-2 rounded-xl font-semibold flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {err}
          </div>
        )}
        {e33Notice && (
          <div className="text-[12px] text-white bg-[#b3001e] px-3 py-2 rounded-xl font-semibold flex items-start gap-2">
            <Trash2 size={14} className="shrink-0 mt-0.5" /> {e33Notice}
          </div>
        )}
        <button onClick={save} disabled={!motivo.trim() || saving || uploading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#b3001e] hover:bg-[#c8002a] text-white text-[13px] font-bold rounded-xl disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          {tipo === 'post_venta' ? 'Confirmar descarte + E33' : 'Confirmar descarte'}
        </button>
      </div>
    </div>
  )
}
