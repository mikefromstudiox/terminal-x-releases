import { useState, useEffect, useMemo, useRef } from 'react'
import { Beef, Plus, Image as ImageIcon, Info, X, Save, Trash2, Loader2, Upload, AlertTriangle } from 'lucide-react'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'
import { useLicense } from '../../context/LicenseContext'
import { uploadCortePhoto, removePhoto, CarniceriaBuckets } from '@terminal-x/services/carniceriaStorage'

// Pre-mint a supabase_id so the storage path is stable before the DB row exists.
function newSid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16)
  })
}

const ESPECIES = [
  { key: 'pollo',     label: 'Pollo',     emoji: '🍗' },
  { key: 'res',       label: 'Res',       emoji: '🥩' },
  { key: 'cerdo',     label: 'Cerdo',     emoji: '🥓' },
  { key: 'viscera',   label: 'Vísceras',  emoji: '🫀' },
  { key: 'embutidos', label: 'Embutidos', emoji: '🌭' },
  { key: 'mariscos',  label: 'Mariscos',  emoji: '🦐' },
  { key: 'otros',     label: 'Otros',     emoji: '🍖' },
]

export default function CorteCatalog() {
  const api = useAPI()
  const { lang } = useLang()
  const { result: lic } = useLicense()
  const businessId = lic?.businessId || null
  const [tab, setTab] = useState('pollo')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const list = await api?.carniceria?.cortes?.list?.() || []
      setRows(list)
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'cortecatalog.newsid' }) } catch {} setRows([]) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => rows.filter(r => r.especie === tab), [rows, tab])

  // Save flow with photo rollback: if a freshly-uploaded photo's DB write
  // fails, we delete the orphan blob so the bucket never accumulates ghost files.
  async function save(row) {
    const uploadedThisSave = row._uploadedPhotoPath || null
    const uploadedBucket   = row._uploadedPhotoBucket || null
    // Strip transport-only keys before persisting
    const { _uploadedPhotoPath: _p, _uploadedPhotoBucket: _b, ...clean } = row
    try {
      if (clean.id) await api?.carniceria?.cortes?.update?.(clean)
      else          await api?.carniceria?.cortes?.create?.(clean)
      setEdit(null); load()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'cortecatalog.newsid' }) } catch {}
      if (uploadedThisSave) {
        await removePhoto(uploadedBucket, uploadedThisSave).catch(() => {})
      }
      alert((lang === 'es' ? 'Error al guardar el corte: ' : 'Save error: ') + (e?.message || ''))
    }
  }
  async function del(id) {
    if (!confirm(lang === 'es' ? '¿Eliminar este corte?' : 'Delete this cut?')) return
    await api?.carniceria?.cortes?.remove?.(id); load()
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-zinc-900">
      <header className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 bg-white dark:bg-black">
        <div className="flex items-center gap-3">
          <Beef size={22} className="text-[#b3001e]" />
          <h1 className="text-[18px] font-bold dark:text-white">{lang === 'es' ? 'Catálogo de Cortes' : 'Cuts Catalog'}</h1>
        </div>
        <button onClick={() => setEdit({ especie: tab, active: true })}
          className="flex items-center gap-2 px-4 py-2 bg-[#b3001e] hover:bg-[#c8002a] text-white text-[13px] font-bold rounded-xl transition-colors">
          <Plus size={15} /> {lang === 'es' ? 'Nuevo Corte' : 'New Cut'}
        </button>
      </header>

      <div className="flex gap-1 px-6 py-3 border-b border-black/10 dark:border-white/10 bg-white dark:bg-black overflow-x-auto">
        {ESPECIES.map(e => (
          <button key={e.key} onClick={() => setTab(e.key)}
            className={`px-4 py-2 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-colors ${
              tab === e.key
                ? 'bg-[#b3001e] text-white'
                : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10'
            }`}>
            <span className="mr-1.5">{e.emoji}</span>{e.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-[#b3001e]" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-[13px]">
            {lang === 'es' ? 'No hay cortes en esta categoría.' : 'No cuts in this category.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map(r => <CorteCard key={r.id} corte={r} onEdit={() => setEdit(r)} onDelete={() => del(r.id)} />)}
          </div>
        )}
      </div>

      {edit && <CorteEditor corte={edit} businessId={businessId} onSave={save} onClose={() => setEdit(null)} lang={lang} />}
    </div>
  )
}

function CorteCard({ corte, onEdit, onDelete }) {
  const [showNutri, setShowNutri] = useState(false)
  return (
    <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden hover:shadow-lg transition-shadow">
      <div className="aspect-[4/3] bg-slate-100 dark:bg-white/5 flex items-center justify-center relative">
        {corte.photo_url
          ? <img src={corte.photo_url} alt={corte.nombre} className="w-full h-full object-cover" />
          : <ImageIcon size={36} className="text-slate-300 dark:text-white/20" />}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-[13px] dark:text-white truncate">{corte.nombre}</h3>
            {corte.nombre_dr_popular && (
              <p className="text-[11px] text-slate-500 dark:text-white/40 truncate" title={corte.tooltip_traduccion || ''}>
                {corte.nombre_dr_popular}
              </p>
            )}
          </div>
          {corte.nutrition_json && (
            <button onClick={() => setShowNutri(true)} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
              <Info size={13} className="text-slate-400" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 mt-2">
          <button onClick={onEdit} className="flex-1 px-2 py-1.5 text-[11px] font-semibold bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 dark:text-white rounded-lg">Editar</button>
          <button onClick={onDelete} className="px-2 py-1.5 text-[11px] bg-red-50 dark:bg-red-500/10 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={12} /></button>
        </div>
      </div>
      {showNutri && <NutritionModal data={corte.nutrition_json} name={corte.nombre} onClose={() => setShowNutri(false)} />}
    </div>
  )
}

function NutritionModal({ data, name, onClose }) {
  const obj = typeof data === 'string' ? safeParse(data) : data || {}
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 p-6 w-[360px] max-w-[90vw] shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold dark:text-white">{name} — Nutrición</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"><X size={16} className="dark:text-white/40" /></button>
        </div>
        <div className="text-[13px] dark:text-white/80 space-y-1">
          {Object.entries(obj).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-black/5 dark:border-white/5 py-1">
              <span className="capitalize">{k}</span><span className="font-semibold">{String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CorteEditor({ corte, businessId, onSave, onClose, lang }) {
  // Pre-mint a stable supabase_id so the storage path is deterministic
  // BEFORE the DB row exists. Saved id round-trips back unchanged on update.
  const sidRef = useRef(corte.supabase_id || newSid())
  const [draft, setDraft] = useState({ ...corte, supabase_id: sidRef.current })
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [uploadErr, setUploadErr] = useState('')
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  async function pickFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    setUploadErr('')
    if (!businessId) { setUploadErr(lang === 'es' ? 'No se pudo identificar el negocio.' : 'Business id missing.'); return }
    setUploading(true); setUploadPct(0)
    try {
      const r = await uploadCortePhoto({
        business_id: businessId,
        corte_supabase_id: sidRef.current,
        file: f,
        onProgress: (p) => setUploadPct(p),
      })
      if (!r.ok) {
        const msg = r.error === 'offline'
          ? (lang === 'es' ? 'Sin conexión — no se puede subir foto. Conéctate y vuelve a intentar.' : 'Offline — cannot upload photo.')
          : (lang === 'es' ? 'Error al subir foto: ' : 'Upload error: ') + r.error
        setUploadErr(msg)
        return
      }
      setDraft(d => ({
        ...d,
        photo_url: r.url,
        _uploadedPhotoPath: r.path,
        _uploadedPhotoBucket: r.bucket,
      }))
    } finally {
      setUploading(false); setUploadPct(0)
      // Clear input so re-selecting the same file fires onChange again
      e.target.value = ''
    }
  }

  async function clearPhoto() {
    // If the operator uploaded a photo this session and then clears it
    // BEFORE saving, immediately remove the orphan blob.
    if (draft._uploadedPhotoPath) {
      await removePhoto(draft._uploadedPhotoBucket, draft._uploadedPhotoPath).catch(() => {})
    }
    setDraft(d => ({ ...d, photo_url: '', _uploadedPhotoPath: null, _uploadedPhotoBucket: null }))
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 p-6 w-[480px] max-w-[92vw] max-h-[92vh] overflow-y-auto shadow-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold dark:text-white">{corte.id ? 'Editar Corte' : 'Nuevo Corte'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"><X size={16} className="dark:text-white/40" /></button>
        </div>
        <Field label="Nombre"               value={draft.nombre || ''}              onChange={v => set('nombre', v)} />
        <Field label="Nombre DR popular"    value={draft.nombre_dr_popular || ''}   onChange={v => set('nombre_dr_popular', v)} placeholder="Ej. Fricasé" />
        <Field label="Tooltip / traducción" value={draft.tooltip_traduccion || ''}  onChange={v => set('tooltip_traduccion', v)} placeholder="Ej. Costilla picada" />
        <div>
          <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Especie</label>
          <select value={draft.especie || 'otros'} onChange={e => set('especie', e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25">
            {ESPECIES.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
        </div>

        {/* ── Photo upload ─────────────────────────────────────────────── */}
        <div>
          <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Foto del corte</label>
          {draft.photo_url ? (
            <div className="mt-1 relative">
              <img src={draft.photo_url} alt={draft.nombre || ''}
                   className="w-full max-h-56 object-cover rounded-xl border border-black/10 dark:border-white/10" />
              <button type="button" onClick={clearPhoto}
                className="absolute top-2 right-2 px-2 py-1 text-[11px] font-bold bg-black/70 hover:bg-[#b3001e] text-white rounded-lg flex items-center gap-1">
                <X size={11} /> Quitar
              </button>
            </div>
          ) : (
            <label className="mt-1 flex flex-col items-center justify-center gap-2 px-3 py-6 rounded-xl border-2 border-dashed border-black/15 dark:border-white/15 hover:border-[#b3001e] hover:bg-[#b3001e]/5 dark:hover:bg-[#b3001e]/10 cursor-pointer transition-colors">
              {uploading
                ? <><Loader2 size={20} className="animate-spin text-[#b3001e]" /><span className="text-[12px] text-slate-500 dark:text-white/60">Subiendo… {Math.round(uploadPct * 100)}%</span></>
                : <><Upload size={18} className="text-[#b3001e]" /><span className="text-[12px] text-slate-600 dark:text-white/70">Toca para subir foto</span><span className="text-[10px] text-slate-400">JPG/PNG/WebP · máx 5 MB</span></>}
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pickFile} disabled={uploading} className="hidden" />
            </label>
          )}
          {uploadErr && (
            <div className="mt-2 flex items-start gap-2 p-2 rounded-lg bg-[#b3001e]/10 text-[11px] text-[#b3001e]">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {uploadErr}
            </div>
          )}
        </div>

        <Field label="Nutrición (JSON)" value={typeof draft.nutrition_json === 'string' ? draft.nutrition_json : JSON.stringify(draft.nutrition_json || {}, null, 0)}
          onChange={v => set('nutrition_json', v)} placeholder='{"proteína":"21g","grasa":"5g"}' />
        <button disabled={uploading}
          onClick={() => onSave({ ...draft, nutrition_json: typeof draft.nutrition_json === 'string' ? safeParse(draft.nutrition_json) : draft.nutrition_json })}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#b3001e] hover:bg-[#c8002a] text-white text-[13px] font-bold rounded-xl disabled:opacity-50">
          <Save size={14} /> Guardar
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25 focus:border-[#b3001e]" />
    </div>
  )
}

function safeParse(s) { try { return JSON.parse(s) } catch (_aetherErr) {
  try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'cortecatalog.field' }) } catch {} return {} } }
