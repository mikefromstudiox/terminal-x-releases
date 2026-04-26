/**
 * PawnItems.jsx — Collateral registry for pawn loans.
 *
 * Summary cards, searchable table, create/edit/redeem/forfeit modals.
 * Status: held (En Custodia), redeemed (Redimido), forfeited (Decomisado).
 *
 * v2.16.2 hardening:
 *   A) Valoración Prenda flow on create (foto + valoración + firma + DPI)
 *   B) Default alert badge on list view (default_alert_days)
 *   C) Publicar para Venta on forfeited rows
 *   D) Documentos tab (pawn_documents) for vehicle pawns
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  ShieldCheck, Plus, Search, X, Loader2, Check, Eye, Camera,
  AlertTriangle, Clock, Package, MapPin, Calendar, FileText,
  Pencil, Archive, Ban, DollarSign, Users, Printer, Upload,
  Trash2, Tag, Link2, Copy, Globe, Image as ImageIcon, Download,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { printPawnTicket } from '../../../services/printer.js'
import SignaturePad from '../../components/SignaturePad.jsx'
import { formatAPR } from '../../../services/apr.js'
import { getSupabaseClient, getBusinessId } from '../../../services/supabase.js'

// ── Upload constants (shared by PawnModal create flow) ───────────────────────
const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Best-effort rollback helper. Deletes every {bucket,path} that was uploaded
 * during a failed create flow. Never throws — Promise.allSettled guarantees
 * we surface the original error to the user without masking it.
 *
 * Reuse this for any future pawn/loan storage flow that needs transactional
 * semantics over Supabase Storage.
 */
async function rollbackStorage(sb, uploaded) {
  if (!sb || !uploaded?.length) return
  try {
    await Promise.allSettled(
      uploaded.map(({ bucket, path }) => sb.storage.from(bucket).remove([path]))
    )
  } catch (_) { /* never throws */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(d) {
  if (!d) return '---'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function today() {
  return new Date().toISOString().split('T')[0]
}
function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
function daysUntil(dateStr) {
  if (!dateStr) return Infinity
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  held:      { label: 'En Custodia', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-300' },
  redeemed:  { label: 'Redimido',    bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300' },
  forfeited: { label: 'Decomisado',  bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-300' },
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, accent = 'slate' }) {
  const accents = {
    slate:   'text-slate-500 dark:text-white/60',
    amber:   'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    red:     'text-red-600 dark:text-red-400',
  }
  return (
    <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={accents[accent]} />
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-[18px] font-bold text-slate-800 dark:text-white">{value}</p>
    </div>
  )
}

// ── Status Badge with deadline alert ──────────────────────────────────────────

function StatusPill({ item }) {
  const days = daysUntil(item.redeem_deadline)
  const alertDays = Number(item.default_alert_days ?? 3)
  if (item.status === 'held' && days < 0) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white bg-[#b3001e] animate-pulse">
        VENCIDO
      </span>
    )
  }
  if (item.status === 'held' && days <= alertDays) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white bg-[#b3001e]">
        Vence en {days}d
      </span>
    )
  }
  const s = STATUS_CONFIG[item.status] || STATUS_CONFIG.held
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function Section({ step, title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-1 border-b border-slate-100 dark:border-white/5">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#b3001e] text-white text-[10px] font-bold">
          {step}
        </span>
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-700 dark:text-white">{title}</h3>
      </div>
      {children}
    </div>
  )
}

// ── Photo uploader (Foto + descripción) ───────────────────────────────────────

function PhotoUploader({ photos, onAdd, onRemove }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = (files) => {
    if (!files?.length) return
    Array.from(files).forEach(f => {
      if (!f.type?.startsWith('image/')) return
      const localUrl = URL.createObjectURL(f)
      onAdd({ file: f, localUrl })
    })
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        className={`border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-[#b3001e] bg-[#b3001e]/5'
            : 'border-slate-200 dark:border-white/10 hover:border-[#b3001e] hover:bg-slate-50 dark:hover:bg-white/5'
        }`}>
        <Upload size={20} className="mx-auto mb-2 text-slate-400 dark:text-white/40" />
        <p className="text-[12px] font-semibold text-slate-700 dark:text-white">Arrastra fotos aqui o haz click</p>
        <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">JPG / PNG — hasta varias imagenes</p>
        <input ref={inputRef} type="file" accept="image/*" multiple capture="environment" className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
      </div>
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mt-3">
          {photos.map((p, idx) => (
            <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 aspect-square bg-slate-50 dark:bg-white/5">
              <img src={p.localUrl || p.file_url} alt="" className="w-full h-full object-cover" />
              <button type="button" onClick={() => onRemove(idx)}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/70 hover:bg-[#b3001e] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────

function PawnModal({ item, onClose, onSave, showToast }) {
  const api = useAPI()
  const [clients, setClients] = useState([])
  const [loans, setLoans] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [form, setForm] = useState({
    client_id: item?.client_id ? String(item.client_id) : '',
    loan_id: item?.loan_id ? String(item.loan_id) : '',
    description: item?.description || '',
    estimated_value: item?.estimated_value ? String(item.estimated_value) : '',
    storage_location: item?.storage_location || '',
    redeem_deadline: item?.redeem_deadline || addDays(today(), 30),
    notes: item?.notes || '',
    offered_pct: item?.offered_pct != null ? Number(item.offered_pct) : 60,
    valoracion_notes: item?.valoracion_notes || '',
    default_alert_days: item?.default_alert_days != null ? Number(item.default_alert_days) : 3,
    loan_amount: '',
  })
  const [photos, setPhotos] = useState([])    // [{ file, localUrl }]
  const [signature, setSignature] = useState(item?.signature_dataurl || null)
  const [prestamistaSignature, setPrestamistaSignature] = useState(item?.prestamista_signature_dataurl || null)
  const [dpiFile, setDpiFile] = useState(null)
  const [dpiPreview, setDpiPreview] = useState(null)
  const [biz, setBiz] = useState(null)
  const isEdit = !!item?.id

  useEffect(() => {
    Promise.all([
      api?.clients?.all?.() || [],
      api?.loans?.list?.({}) || [],
      (api?.empresa?.get?.() ?? api?.business?.get?.() ?? Promise.resolve({})),
    ])
      .then(([c, l, b]) => {
        setClients(c || [])
        setLoans(l || [])
        setBiz(b || {})
        setLoadingData(false)
      })
      .catch(() => setLoadingData(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-compute monto prestado from valor × pct (only if user hasn't overridden)
  const computedLoanAmount = useMemo(() => {
    const v = parseFloat(form.estimated_value) || 0
    const p = Number(form.offered_pct) || 0
    return Math.round(v * p) / 100
  }, [form.estimated_value, form.offered_pct])

  useEffect(() => {
    // when value or pct changes, refresh suggested loan amount unless user typed one
    if (!form.loan_amount || form.loan_amount === '_user') return
    set('loan_amount', String(computedLoanAmount))
  }, [computedLoanAmount])

  // initialize loan_amount once value is filled
  useEffect(() => {
    if (form.loan_amount === '' && form.estimated_value) {
      set('loan_amount', String(computedLoanAmount))
    }
  }, [form.estimated_value])

  // Filter loans by selected client
  const clientLoans = useMemo(() => {
    if (!form.client_id) return []
    return (loans || []).filter(l => String(l.client_id) === form.client_id && l.status === 'active')
  }, [loans, form.client_id])

  useEffect(() => {
    if (!item) set('loan_id', '')
  }, [form.client_id])

  const handleAddPhoto = (p) => setPhotos(prev => [...prev, p])
  const handleRemovePhoto = (idx) => setPhotos(prev => prev.filter((_, i) => i !== idx))

  const handleDpi = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setDpiFile(f)
    setDpiPreview(URL.createObjectURL(f))
  }

  async function handleSubmit(e, opts = {}) {
    e?.preventDefault?.()
    if (!form.description.trim()) { setErr('La descripcion es requerida.'); return }
    if (!form.client_id) { setErr('Selecciona un cliente.'); return }

    // ── C9 — Papeleta legalmente vinculante: hard validations on create ──
    if (!isEdit) {
      const clientObj = clients.find(c => String(c.id) === form.client_id) || {}
      const cedula = String(clientObj.rnc || '').replace(/\D/g, '')
      if (cedula.length !== 11) { setErr('Cédula del cliente obligatoria (11 dígitos)'); return }
      const rncDigits = String(biz?.rnc || '').replace(/\D/g, '')
      if (rncDigits.length !== 9) {
        setErr('RNC del negocio obligatorio (9 dígitos). Configure en Ajustes → Negocio → RNC.')
        return
      }
      if (!signature || !prestamistaSignature) {
        setErr('Ambas firmas son obligatorias para registrar el empeño')
        return
      }
    }

    setSaving(true)
    setErr('')
    try {
      const data = {
        client_id: Number(form.client_id),
        loan_id: form.loan_id ? Number(form.loan_id) : null,
        description: form.description.trim(),
        estimated_value: parseFloat(form.estimated_value) || 0,
        storage_location: form.storage_location.trim() || null,
        redeem_deadline: form.redeem_deadline || null,
        notes: form.notes.trim() || null,
        offered_pct: Number(form.offered_pct) || 0,
        valoracion_notes: form.valoracion_notes.trim() || null,
        default_alert_days: Number(form.default_alert_days) || 3,
        signature_dataurl: signature || null,
        prestamista_signature_dataurl: prestamistaSignature || null,
        status: item?.status || 'held',
      }

      // ── Pre-upload validation (before any pawn_items row is created) ──
      // Block oversized / wrong-MIME assets up front so we never attempt the
      // upload — saves bandwidth and avoids partial-rollback edge cases.
      for (let i = 0; i < photos.length; i++) {
        const f = photos[i]?.file
        if (!f) continue
        if (!ALLOWED_PHOTO_MIME.has(f.type)) {
          setSaving(false)
          setErr(`Foto ${i + 1}: formato no permitido (use JPG, PNG o WebP)`)
          return
        }
        if (f.size > MAX_PHOTO_BYTES) {
          setSaving(false)
          setErr('Foto excede 5MB')
          return
        }
      }
      if (dpiFile) {
        if (dpiFile.size > MAX_PHOTO_BYTES) {
          setSaving(false)
          setErr('Foto excede 5MB')
          return
        }
        if (dpiFile.type && !ALLOWED_PHOTO_MIME.has(dpiFile.type) && dpiFile.type !== 'application/pdf') {
          setSaving(false)
          setErr('DPI: formato no permitido')
          return
        }
      }

      let saved
      if (isEdit) {
        await api.pawnItems.update({ id: item.id, ...data })
        saved = { id: item.id, supabase_id: item.supabase_id, ticket_code: item.ticket_code }
      } else {
        saved = await api.pawnItems.create(data)
      }

      const pawnSupabaseId = saved?.supabase_id
      const sb  = getSupabaseClient()
      const bid = getBusinessId()

      // Storage rollback ledger — every successful upload is recorded so a
      // later blocking failure (DPI/signature/insert) can clean orphans up.
      const uploaded = []

      // ── Photos (NON-blocking) ───────────────────────────────────────────
      // Per spec: a failure on individual photos must not abort the whole
      // empeño — the prenda matters more than its photos. Collect failures
      // into `failed[]`, push successes into `uploaded[]` (and into the
      // pawn_documents trail).
      const failed = []
      const photoTotal = photos.length
      if (sb && bid && pawnSupabaseId && photoTotal) {
        for (let i = 0; i < photoTotal; i++) {
          const p = photos[i]
          if (!p?.file) continue
          try {
            const ext  = (p.file.name?.split('.').pop() || 'jpg').toLowerCase()
            const path = `${bid}/${pawnSupabaseId}/${Date.now()}-${i}-${Math.random().toString(36).slice(2,8)}.${ext}`
            const { error: upErr } = await sb.storage.from('pawn-photos')
              .upload(path, p.file, { contentType: p.file.type || 'image/jpeg', upsert: false })
            if (upErr) throw upErr
            uploaded.push({ bucket: 'pawn-photos', path })
            const { data: pub } = sb.storage.from('pawn-photos').getPublicUrl(path)
            await sb.from('pawn_documents').insert({
              supabase_id: crypto.randomUUID(),
              business_id: bid,
              pawn_supabase_id: pawnSupabaseId,
              doc_type: 'foto',
              file_url: pub?.publicUrl || path,
              mime_type: p.file.type || 'image/jpeg',
            })
          } catch (e) {
            console.error('[PawnItems.uploadPhoto]', i, e)
            failed.push(i + 1)
          }
        }
      }

      // ── DPI (BLOCKING) ──────────────────────────────────────────────────
      if (sb && bid && pawnSupabaseId && dpiFile) {
        try {
          const ext  = (dpiFile.name?.split('.').pop() || 'jpg').toLowerCase()
          const path = `${bid}/${pawnSupabaseId}/dpi-${Date.now()}.${ext}`
          const { error: upErr } = await sb.storage.from('pawn-documents')
            .upload(path, dpiFile, { contentType: dpiFile.type, upsert: false })
          if (upErr) throw upErr
          uploaded.push({ bucket: 'pawn-documents', path })
          const { data: signed } = await sb.storage.from('pawn-documents')
            .createSignedUrl(path, 60 * 60 * 24 * 365)
          await sb.from('pawn_documents').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            pawn_supabase_id: pawnSupabaseId,
            doc_type: 'dpi',
            file_url: signed?.signedUrl || path,
            mime_type: dpiFile.type || null,
          })
        } catch (e) {
          console.error('[PawnItems.uploadDpi]', e)
          await rollbackStorage(sb, uploaded)
          if (!isEdit && pawnSupabaseId) {
            try { await sb.from('pawn_items').delete().eq('supabase_id', pawnSupabaseId).eq('business_id', bid) } catch (_) {}
          }
          throw new Error(`Error guardando empeño: ${e?.message || 'fallo subiendo DPI'}. Archivos subidos fueron eliminados.`)
        }
      }

      // ── Signature (BLOCKING on create only) ─────────────────────────────
      if (sb && bid && pawnSupabaseId && signature && !isEdit) {
        try {
          const { error: sigErr } = await sb.from('pawn_documents').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            pawn_supabase_id: pawnSupabaseId,
            doc_type: 'firma',
            file_url: signature,
            mime_type: 'image/png',
          })
          if (sigErr) throw sigErr
        } catch (e) {
          console.error('[PawnItems.saveSignature]', e)
          await rollbackStorage(sb, uploaded)
          if (!isEdit && pawnSupabaseId) {
            try { await sb.from('pawn_items').delete().eq('supabase_id', pawnSupabaseId).eq('business_id', bid) } catch (_) {}
          }
          throw new Error(`Error guardando empeño: ${e?.message || 'fallo guardando firma'}. Archivos subidos fueron eliminados.`)
        }
      }

      // Photo summary toasts (non-blocking warnings).
      if (failed.length) {
        if (uploaded.filter(u => u.bucket === 'pawn-photos').length === 0) {
          showToast?.(`${failed.length} fotos no se subieron, intente de nuevo más tarde`, 'error')
        } else {
          const okCount = photoTotal - failed.length
          showToast?.(`${okCount} de ${photoTotal} fotos subieron — ${failed.length} fallaron`, 'error')
        }
      }

      // Print ticket if requested
      if (opts.print) {
        try {
          const biz = (await (api?.empresa?.get?.() ?? api?.business?.get?.() ?? Promise.resolve({}))) || {}
          const clientObj = clients.find(c => String(c.id) === form.client_id) || {}
          let loan = null
          if (form.loan_id) {
            try { loan = await (api?.loans?.getById?.(Number(form.loan_id)) ?? api?.loans?.byId?.(Number(form.loan_id))) } catch {}
          }
          await printPawnTicket({
            biz,
            ticket_code: saved?.ticket_code,
            client_name: clientObj?.name,
            client_phone: clientObj?.phone,
            client_dpi: clientObj?.rnc || null,
            description: data.description,
            estimated_value: data.estimated_value,
            offered_pct: data.offered_pct,
            loan_amount: parseFloat(form.loan_amount) || (data.estimated_value * data.offered_pct / 100),
            interest_rate: loan?.interest_rate,
            interest_rate_label: loan?.interest_rate ? formatAPR(Number(loan.interest_rate)) : null,
            mora_rate_daily: loan?.mora_rate_daily ?? loan?.late_fee_rate ?? null,
            storage_location: data.storage_location,
            redeem_deadline: data.redeem_deadline,
            valoracion_notes: data.valoracion_notes,
            created_at: new Date().toISOString(),
            notes: data.notes,
            client_signature_dataurl: signature || null,
            prestamista_signature_dataurl: prestamistaSignature || null,
          }, api)
        } catch (e) {
          showToast?.('Empeno guardado, pero fallo la impresion', 'error')
        }
      }

      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit}
        className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ShieldCheck size={16} className="text-[#b3001e]" />
            {isEdit ? 'Editar Articulo' : 'Valoracion de Prenda'}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-6 overflow-y-auto">
          {loadingData ? (
            <div className="flex items-center justify-center py-8 text-slate-400 dark:text-white/40">
              <Loader2 size={16} className="animate-spin mr-2" /> Cargando datos...
            </div>
          ) : (
            <>
              {/* 1. Foto + Descripcion */}
              <Section step={1} title="Foto y Descripcion">
                {!isEdit && (
                  <PhotoUploader photos={photos} onAdd={handleAddPhoto} onRemove={handleRemovePhoto} />
                )}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    Descripcion del Articulo *
                  </label>
                  <textarea value={form.description} onChange={e => { set('description', e.target.value); setErr('') }}
                    rows={2} required
                    placeholder="Ej: Cadena de oro 18K, 24 pulgadas, 35 gramos..."
                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e] resize-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    Ubicacion de Custodia
                  </label>
                  <input type="text" value={form.storage_location}
                    onChange={e => set('storage_location', e.target.value)}
                    placeholder="Caja fuerte A-3"
                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
                </div>
              </Section>

              {/* 2. Valoracion */}
              <Section step={2} title="Valoracion">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                      Valor Estimado (RD$)
                    </label>
                    <input type="number" min="0" step="0.01" value={form.estimated_value}
                      onChange={e => set('estimated_value', e.target.value)}
                      placeholder="15,000"
                      className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                      % Ofrecido ({form.offered_pct}%)
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="range" min="10" max="90" step="1" value={form.offered_pct}
                        onChange={e => set('offered_pct', Number(e.target.value))}
                        className="flex-1 accent-[#b3001e]" />
                      <input type="number" min="0" max="100" value={form.offered_pct}
                        onChange={e => set('offered_pct', Number(e.target.value))}
                        className="w-16 px-2 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                      Monto Prestado (RD$)
                    </label>
                    <input type="number" min="0" step="0.01" value={form.loan_amount}
                      onChange={e => set('loan_amount', e.target.value)}
                      placeholder={fmtRD(computedLoanAmount)}
                      className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
                    <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">Sugerido: {fmtRD(computedLoanAmount)}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                      Dias para Retirar
                    </label>
                    <input type="number" min="1" value={(() => {
                      const d = daysUntil(form.redeem_deadline)
                      return Math.max(1, d)
                    })()}
                      onChange={e => set('redeem_deadline', addDays(today(), Number(e.target.value) || 30))}
                      className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
                    <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">Vence: {fmtDate(form.redeem_deadline)}</p>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    Dias de Alerta antes de Vencer
                  </label>
                  <input type="number" min="0" max="30" value={form.default_alert_days}
                    onChange={e => set('default_alert_days', Number(e.target.value))}
                    className="w-32 px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    Notas de Valoracion
                  </label>
                  <textarea value={form.valoracion_notes} onChange={e => set('valoracion_notes', e.target.value)}
                    rows={2}
                    placeholder="Quilataje, peso bruto, condicion, marca..."
                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e] resize-none" />
                </div>
              </Section>

              {/* 3. Cliente */}
              <Section step={3} title="Cliente">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    Cliente
                  </label>
                  <select value={form.client_id} onChange={e => { set('client_id', e.target.value); setErr('') }} required
                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]">
                    <option value="">Seleccionar cliente...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.rnc ? ` (${c.rnc})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    Prestamo Asociado (opcional)
                  </label>
                  <select value={form.loan_id} onChange={e => set('loan_id', e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]">
                    <option value="">Sin Prestamo</option>
                    {clientLoans.map(l => (
                      <option key={l.id} value={l.id}>
                        Prestamo #{l.id} -- {fmtRD(l.principal)} @ {l.interest_rate}%
                      </option>
                    ))}
                  </select>
                  {form.client_id && clientLoans.length === 0 && (
                    <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">Este cliente no tiene prestamos activos.</p>
                  )}
                </div>
              </Section>

              {/* 4. Firma + DPI */}
              {!isEdit && (
                <Section step={4} title="Firmas y DPI">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                      Firma del empeñador (cliente)
                    </label>
                    <SignaturePad value={signature} onChange={setSignature} height={140} />
                  </div>
                  <div className="mt-3">
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                      Firma del prestamista (operador)
                    </label>
                    <SignaturePad value={prestamistaSignature} onChange={setPrestamistaSignature} height={140} />
                    <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">
                      Ambas firmas son obligatorias — la papeleta es el contrato legal del empeño.
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                      Foto de DPI / Cedula
                    </label>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] font-semibold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 cursor-pointer">
                        <Camera size={13} /> {dpiFile ? 'Cambiar foto' : 'Tomar / Subir foto'}
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleDpi} />
                      </label>
                      {dpiPreview && (
                        <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10">
                          <img src={dpiPreview} alt="DPI" className="w-full h-full object-cover" />
                          <button type="button" onClick={() => { setDpiFile(null); setDpiPreview(null) }}
                            className="absolute top-0 right-0 p-0.5 rounded-bl-lg bg-black/70 text-white">
                            <X size={10} />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">Almacenado en bucket privado, acceso por URL firmada.</p>
                  </div>
                </Section>
              )}

              {/* Notas internas */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                  Notas Internas
                </label>
                <input type="text" value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Condiciones especiales, marcas, serial..."
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
              </div>

              {err && (
                <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} /> {err}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            Cancelar
          </button>
          {!isEdit && (
            <button type="button" onClick={(e) => handleSubmit(e, { print: true })} disabled={saving || loadingData}
              className="flex items-center gap-1.5 px-4 py-2 border border-[#b3001e] text-[#b3001e] text-[12px] font-bold rounded-lg hover:bg-[#b3001e]/10 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
              Guardar e Imprimir
            </button>
          )}
          <button type="submit" disabled={saving || loadingData}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            {saving ? 'Guardando...' : (isEdit ? 'Guardar Cambios' : 'Registrar Empeno')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Documents Modal (item 8: vehicle pawn documents) ──────────────────────────

function DocumentsModal({ item, onClose, showToast }) {
  const api = useAPI()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadType, setUploadType] = useState('matricula')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = item?.supabase_id ? await api?.pawnDocuments?.byPawn?.(item.supabase_id) : []
      setDocs(rows || [])
    } catch { setDocs([]) }
    finally { setLoading(false) }
  }, [item])

  useEffect(() => { load() }, [load])

  const handleUpload = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !item?.supabase_id) return
    setUploading(true)
    try {
      if (uploadType === 'foto') {
        await api.pawnDocuments.uploadPhoto({ pawnSupabaseId: item.supabase_id, file: f })
      } else {
        await api.pawnDocuments.uploadPrivate({ pawnSupabaseId: item.supabase_id, file: f, docType: uploadType })
      }
      await load()
      showToast?.('Documento subido')
    } catch (e) {
      showToast?.(e?.message || 'Error subiendo documento', 'error')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (doc) => {
    if (!confirm('Eliminar este documento?')) return
    try {
      await api.pawnDocuments.delete(doc.id)
      await load()
      showToast?.('Documento eliminado')
    } catch (e) {
      showToast?.(e?.message || 'Error', 'error')
    }
  }

  const TYPE_LABEL = {
    foto: 'Foto', dpi: 'DPI', matricula: 'Matricula', firma: 'Firma', contrato: 'Contrato', otro: 'Otro',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <FileText size={16} className="text-[#b3001e]" /> Documentos — {item?.description}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {/* Uploader */}
          <div className="flex items-center gap-2 p-3 border border-dashed border-slate-200 dark:border-white/10 rounded-lg">
            <select value={uploadType} onChange={e => setUploadType(e.target.value)}
              className="px-2 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] bg-white dark:bg-white/5 text-slate-700 dark:text-white">
              <option value="matricula">Matricula</option>
              <option value="contrato">Contrato</option>
              <option value="dpi">DPI</option>
              <option value="foto">Foto</option>
              <option value="otro">Otro</option>
            </select>
            <label className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors ${
              uploading ? 'bg-slate-100 dark:bg-white/5 text-slate-400' : 'bg-[#b3001e] text-white hover:bg-[#8c0017]'
            }`}>
              {uploading ? <><Loader2 size={13} className="animate-spin" /> Subiendo...</> : <><Upload size={13} /> Subir Documento</>}
              <input type="file" className="hidden" disabled={uploading} onChange={handleUpload}
                accept={uploadType === 'foto' || uploadType === 'dpi' ? 'image/*' : '*'} />
            </label>
          </div>

          {/* Doc list */}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400 dark:text-white/40">
              <Loader2 size={16} className="animate-spin mr-2" /> Cargando...
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-8 text-[12px] text-slate-400 dark:text-white/40">
              No hay documentos. Sube matricula, contrato, etc.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/5 border border-slate-200 dark:border-white/10 rounded-lg">
              {docs.map(d => (
                <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                    {d.doc_type === 'foto' || d.mime_type?.startsWith('image/') ? (
                      <img src={d.file_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <FileText size={16} className="text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/70 uppercase">
                      {TYPE_LABEL[d.doc_type] || d.doc_type}
                    </span>
                    <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5 truncate">
                      {fmtDate(d.uploaded_at || d.created_at)}
                    </p>
                  </div>
                  <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 text-slate-400 hover:text-[#b3001e] rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                    <Download size={13} />
                  </a>
                  <button onClick={() => handleDelete(d)}
                    className="p-1.5 text-slate-400 hover:text-[#b3001e] rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Publicar para Venta Modal ─────────────────────────────────────────────────

/**
 * C8 — Avalúo de remate auto 70% con override admin.
 *
 * DR empeño legal practice: avalúo de remate = 70% del valor estimado. Real
 * prestamistas defend remate prices in court if the cliente disputes them; 70%
 * is the safe-harbor default. Overrides require a conscious unlock (typing the
 * word OVERRIDE — visible by design; this is a soft gate, not a security wall)
 * and emit a `pawn_remate_override` activity_log row capturing both prices.
 */
function PublishModal({ item, onClose, onPublished, showToast }) {
  const api = useAPI()
  const estimated = Number(item?.estimated_value) || 0
  const REMATE_PCT = 0.7
  const remateLegal = useMemo(() => Math.round(estimated * REMATE_PCT * 100) / 100, [estimated])

  const [price, setPrice]               = useState(String(remateLegal))
  const [unlocked, setUnlocked]         = useState(false)
  const [showUnlock, setShowUnlock]     = useState(false)
  const [unlockTok, setUnlockTok]       = useState('')
  const [unlockErr, setUnlockErr]       = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [saving, setSaving]             = useState(false)

  // Re-sync the default if the parent swaps `item` while modal is open
  useEffect(() => { setPrice(String(remateLegal)) }, [remateLegal])

  function attemptUnlock() {
    // Soft gate. We accept the literal token "OVERRIDE" (case-insensitive)
    // as a conscious-decision wall. The screen below it states the legal
    // implication, so anyone typing this is acknowledging it.
    if (String(unlockTok).trim().toUpperCase() === 'OVERRIDE') {
      setUnlocked(true)
      setShowUnlock(false)
      setUnlockErr('')
    } else {
      setUnlockErr('Token incorrecto. Escribe la palabra OVERRIDE en mayúsculas.')
    }
  }

  async function handlePublish() {
    if (!item?.supabase_id) { showToast?.('Falta supabase_id', 'error'); return }
    const finalPrice = parseFloat(price) || 0
    if (finalPrice <= 0) { showToast?.('Precio inválido', 'error'); return }
    const isOverride = unlocked && Math.abs(finalPrice - remateLegal) > 0.01

    const slug = `${String(item.supabase_id).slice(0, 8)}-${slugify(item.description || 'prenda')}`
    setSaving(true)
    try {
      const row = await api.pawnListings.publish({
        pawnSupabaseId: item.supabase_id,
        list_price: finalPrice,
        slug,
        list_price_override: isOverride,
        override_reason: isOverride ? (overrideReason.trim() || null) : null,
      })

      // Audit trail — only on actual override. Best-effort: never block publish on log failure.
      if (isOverride) {
        try {
          await api?.activity?.record?.({
            event_type: 'pawn_remate_override',
            severity:   'warn',
            target_type: 'pawn_listing',
            target_id:   row?.supabase_id || item.supabase_id,
            target_name: item.description || `Empeño #${item.id}`,
            amount:      finalPrice,
            old_value:   String(remateLegal),
            new_value:   String(finalPrice),
            reason:      overrideReason.trim() || null,
            metadata:    {
              pawn_supabase_id: item.supabase_id,
              estimated_value:  estimated,
              legal_70pct:      remateLegal,
              override_price:   finalPrice,
            },
          })
        } catch (e) { console.warn('[PublishModal] activity_log failed:', e?.message) }
      }

      onPublished({ slug: row?.slug || slug })
    } catch (e) {
      showToast?.(e?.message || 'Error al publicar', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Tag size={16} className="text-[#b3001e]" /> Publicar para Venta
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-[12px] text-slate-600 dark:text-white/70">
            <p className="font-semibold text-slate-800 dark:text-white">{item?.description}</p>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">
              Valor estimado: {fmtRD(estimated)}
            </p>
          </div>

          {unlocked && (
            <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>Estás sobrescribiendo el avalúo legal de remate. Esta decisión queda registrada.</span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              Precio de Venta (RD$)
              {!unlocked && <Archive size={10} className="text-slate-400" aria-label="Bloqueado" />}
            </label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" step="0.01" value={price}
                readOnly={!unlocked}
                onChange={e => setPrice(e.target.value)}
                className={`flex-1 px-3 py-2.5 border rounded-lg text-[13px] focus:outline-none focus:ring-2 ${
                  unlocked
                    ? 'border-amber-300 dark:border-amber-500/40 bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:ring-amber-400'
                    : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-white/80 cursor-not-allowed'
                }`} />
              {!unlocked && (
                <button type="button" onClick={() => { setShowUnlock(true); setUnlockTok(''); setUnlockErr('') }}
                  className="px-3 py-2.5 text-[11px] font-bold text-[#b3001e] border border-[#b3001e]/40 hover:bg-[#b3001e]/10 rounded-lg whitespace-nowrap">
                  Sobrescribir avalúo
                </button>
              )}
            </div>
            <p className="text-[10px] text-[#b3001e] dark:text-[#ff6b7e] mt-1 font-medium">
              Avalúo de remate sugerido: 70% del valor estimado ({fmtRD(remateLegal)})
            </p>
          </div>

          {unlocked && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                Motivo del override (opcional)
              </label>
              <input type="text" value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                placeholder="Ej.: precio de mercado más alto, condición premium…"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <button onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg">
            Cancelar
          </button>
          <button onClick={handlePublish} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            Publicar
          </button>
        </div>

        {/* Override unlock dialog */}
        {showUnlock && (
          <div className="absolute inset-0 z-10 bg-slate-900/70 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-amber-300 dark:border-amber-500/30 overflow-hidden">
              <div className="px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400" />
                <h3 className="text-[12px] font-bold text-amber-800 dark:text-amber-200">Sobrescribir avalúo legal</h3>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-[11px] text-slate-600 dark:text-white/70 leading-relaxed">
                  El avalúo de remate del 70% es la práctica legal estándar en RD.
                  Sobrescribirlo te expone a disputas en tribunales si el cliente
                  reclama el precio de venta.
                </p>
                <p className="text-[11px] text-slate-600 dark:text-white/70">
                  Para confirmar, escribe <span className="font-mono font-bold text-[#b3001e]">OVERRIDE</span> abajo:
                </p>
                <input
                  autoFocus type="text" value={unlockTok}
                  onChange={e => { setUnlockTok(e.target.value); setUnlockErr('') }}
                  onKeyDown={e => { if (e.key === 'Enter') attemptUnlock() }}
                  placeholder="OVERRIDE"
                  className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] font-mono bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
                {unlockErr && <p className="text-[11px] text-red-500">{unlockErr}</p>}
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                <button onClick={() => setShowUnlock(false)}
                  className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg">
                  Cancelar
                </button>
                <button onClick={attemptUnlock}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold rounded-lg">
                  Desbloquear
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Listing inline cell ───────────────────────────────────────────────────────

function ListingCell({ item, listings, onPublish, onUnpublish, showToast }) {
  const active = listings?.find(l => l.status === 'published')
  if (!active) {
    return (
      <button onClick={() => onPublish(item)}
        className="px-2 py-1 text-[10px] font-semibold text-white bg-[#b3001e] hover:bg-[#8c0017] rounded-lg transition-colors">
        Publicar para Venta
      </button>
    )
  }
  const url = `/tienda-empenos/${active.slug}`
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => {
          try { navigator.clipboard.writeText(window.location.origin + url); showToast?.('Link copiado') } catch {}
        }}
        title="Copiar link"
        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-[#b3001e] border border-[#b3001e]/40 hover:bg-[#b3001e]/10 rounded-lg">
        <Copy size={10} /> {url}
      </button>
      <button onClick={() => onUnpublish(active)} title="Despublicar"
        className="px-2 py-1 text-[10px] font-semibold text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 rounded-lg">
        Despublicar
      </button>
    </div>
  )
}

// ── Main PawnItems Screen ─────────────────────────────────────────────────────

export default function PawnItems() {
  const api = useAPI()
  const [items, setItems] = useState([])
  const [listingsByPawn, setListingsByPawn] = useState({}) // { supabase_id: [rows] }
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [sortBy, setSortBy] = useState('created') // created | deadline
  const [sortDir, setSortDir] = useState('desc')
  const [modal, setModal] = useState(null)
  const [docsModal, setDocsModal] = useState(null)
  const [publishModal, setPublishModal] = useState(null)
  const [toast, setToast] = useState(null)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api?.pawnItems?.list?.({})
      setItems(rows || [])
      // Load listings for forfeited rows
      const forfeited = (rows || []).filter(r => r.status === 'forfeited' && r.supabase_id)
      const map = {}
      await Promise.all(forfeited.map(async r => {
        try { map[r.supabase_id] = await api.pawnListings.byPawn(r.supabase_id) } catch { map[r.supabase_id] = [] }
      }))
      setListingsByPawn(map)
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadItems() }, [loadItems])

  // ── Metrics ──────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const held = items.filter(i => i.status === 'held')
    const totalValue = held.reduce((s, i) => s + (Number(i.estimated_value) || 0), 0)
    const expiringThisWeek = held.filter(i => {
      const days = daysUntil(i.redeem_deadline)
      return days >= 0 && days <= 7
    }).length
    const forfeited = items.filter(i => i.status === 'forfeited').length
    return {
      heldCount: held.length,
      totalValue,
      expiringThisWeek,
      forfeitedCount: forfeited,
    }
  }, [items])

  // ── Filtered + sorted list ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = items
    if (filterStatus !== 'all') list = list.filter(i => i.status === filterStatus)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        (i.description || '').toLowerCase().includes(q) ||
        (i.client_name || '').toLowerCase().includes(q) ||
        (i.storage_location || '').toLowerCase().includes(q)
      )
    }
    list = [...list].sort((a, b) => {
      let av, bv
      if (sortBy === 'deadline') {
        av = a.redeem_deadline ? new Date(a.redeem_deadline).getTime() : Infinity
        bv = b.redeem_deadline ? new Date(b.redeem_deadline).getTime() : Infinity
      } else {
        av = a.created_at ? new Date(a.created_at).getTime() : 0
        bv = b.created_at ? new Date(b.created_at).getTime() : 0
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return list
  }, [items, filterStatus, search, sortBy, sortDir])

  function showToast(msg, variant = 'ok') {
    setToast({ msg, variant })
    setTimeout(() => setToast(null), 3000)
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir(col === 'deadline' ? 'asc' : 'desc') }
  }

  async function handleRedeem(item) {
    if (!confirm(`Redimir "${item.description}"? El articulo sera devuelto al cliente.`)) return
    try {
      await api.pawnItems.update({ id: item.id, status: 'redeemed', redemption_date: new Date().toISOString() })
      await loadItems()
      showToast('Articulo redimido')
    } catch (e) {
      showToast(e?.message || 'Error al redimir', 'error')
    }
  }

  async function handlePrintPapeleta(item) {
    try {
      let loan = null
      if (item.loan_id) {
        try { loan = await (api?.loans?.getById?.(item.loan_id) ?? api?.loans?.byId?.(item.loan_id)) } catch {}
      }
      const biz = (await (api?.empresa?.get?.() ?? api?.business?.get?.() ?? Promise.resolve({}))) || {}
      // C9 — papeleta is a legal contract: refuse to print without RNC.
      const rncDigits = String(biz?.rnc || '').replace(/\D/g, '')
      if (rncDigits.length !== 9) {
        showToast('Configure RNC del negocio antes de imprimir papeleta', 'error')
        return
      }
      await printPawnTicket({
        biz,
        ticket_code: item.ticket_code,
        client_name: item.client_name,
        client_phone: item.client_phone,
        client_dpi: item.client_rnc || item.client_dpi || null,
        description: item.description,
        estimated_value: item.estimated_value,
        offered_pct: item.offered_pct,
        loan_amount: loan?.principal,
        interest_rate: loan?.interest_rate,
        interest_rate_label: loan?.interest_rate ? formatAPR(Number(loan.interest_rate)) : null,
        mora_rate_daily: loan?.mora_rate_daily ?? loan?.late_fee_rate ?? null,
        client_signature_dataurl: item.signature_dataurl || null,
        prestamista_signature_dataurl: item.prestamista_signature_dataurl || null,
        storage_location: item.storage_location,
        redeem_deadline: item.redeem_deadline,
        valoracion_notes: item.valoracion_notes,
        created_at: item.created_at,
        notes: item.notes,
      }, api)
      showToast('Papeleta impresa')
    } catch (e) {
      showToast(e?.message || 'Error imprimiendo papeleta', 'error')
    }
  }

  async function handleForfeit(item) {
    if (!confirm(`Decomisar "${item.description}"? Esta accion no se puede deshacer.`)) return
    try {
      await api.pawnItems.update({ id: item.id, status: 'forfeited' })
      await loadItems()
      showToast('Articulo decomisado')
    } catch (e) {
      showToast(e?.message || 'Error al decomisar', 'error')
    }
  }

  async function handleUnpublish(listing) {
    if (!confirm('Despublicar esta prenda? Dejara de aparecer en la tienda.')) return
    try {
      await api.pawnListings.unpublish(listing.id)
      await loadItems()
      showToast('Despublicado')
    } catch (e) {
      showToast(e?.message || 'Error al despublicar', 'error')
    }
  }

  const STATUS_FILTERS = [
    { id: 'all',       label: 'Todos' },
    { id: 'held',      label: 'En Custodia' },
    { id: 'redeemed',  label: 'Redimidos' },
    { id: 'forfeited', label: 'Decomisados' },
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <ShieldCheck size={20} className="text-slate-500 dark:text-white/60" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">Articulos en Empeno</h1>
        </div>
        <button onClick={() => setModal({ type: 'create', item: null })}
          className="flex items-center gap-2 px-4 py-2 bg-[#b3001e] text-white hover:bg-[#8c0017] rounded-xl text-sm font-medium transition-colors min-h-[44px]">
          <Plus size={15} /> Nuevo Empeno
        </button>
      </div>

      {/* Summary cards */}
      <div className="px-3 md:px-6 py-3 md:py-4 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <SummaryCard icon={Package} label="Articulos en Custodia" value={String(metrics.heldCount)} accent="amber" />
        <SummaryCard icon={DollarSign} label="Valor Total Estimado" value={fmtRD(metrics.totalValue)} accent="amber" />
        <SummaryCard icon={Clock} label="Vencen Esta Semana" value={String(metrics.expiringThisWeek)} accent={metrics.expiringThisWeek > 0 ? 'red' : 'slate'} />
        <SummaryCard icon={Ban} label="Decomisados" value={String(metrics.forfeitedCount)} accent="red" />
      </div>

      {/* Filters + search */}
      <div className="px-3 md:px-6 pb-3 flex flex-col md:flex-row md:items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-[#b3001e] flex-1 max-w-sm">
          <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por descripcion, cliente, ubicacion..."
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilterStatus(f.id)}
              className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors border whitespace-nowrap min-h-[44px] ${
                filterStatus === f.id
                  ? 'bg-[#b3001e] text-white border-[#b3001e]'
                  : 'bg-white dark:bg-white/5 text-slate-500 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-3 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Cargando articulos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <ShieldCheck size={32} className="text-slate-300 dark:text-white/20 mx-auto mb-3" />
            <p className="text-[13px] text-slate-500 dark:text-white/60 font-medium">
              {items.length === 0 ? 'No hay articulos registrados' : 'Sin resultados para esta busqueda'}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">
              {items.length === 0 && 'Haz clic en "Nuevo Empeno" para registrar el primero.'}
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 text-left">#</th>
                    <th className="px-4 py-2.5 text-left">Descripcion</th>
                    <th className="px-4 py-2.5 text-left">Cliente</th>
                    <th className="px-4 py-2.5 text-center">Prestamo</th>
                    <th className="px-4 py-2.5 text-right">Valor Est.</th>
                    <th className="px-4 py-2.5 text-left">Ubicacion</th>
                    <th className="px-4 py-2.5 text-left cursor-pointer select-none hover:text-[#b3001e]"
                        onClick={() => toggleSort('deadline')}>
                      Vence {sortBy === 'deadline' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th className="px-4 py-2.5 text-center">Estado</th>
                    <th className="px-4 py-2.5 w-40"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => {
                    const days = daysUntil(item.redeem_deadline)
                    const alertDays = Number(item.default_alert_days ?? 3)
                    const isAlert = item.status === 'held' && days >= 0 && days <= alertDays
                    const isExpired = item.status === 'held' && days < 0
                    const listings = listingsByPawn[item.supabase_id] || []
                    return (
                      <tr key={item.id}
                        className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-2.5 text-slate-500 dark:text-white/50 tabular-nums">{item.id}</td>
                        <td className="px-4 py-2.5 max-w-[200px]">
                          <p className="font-semibold text-slate-800 dark:text-white truncate">{item.description}</p>
                          {item.notes && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate mt-0.5">{item.notes}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 dark:text-white">{item.client_name || `#${item.client_id}`}</td>
                        <td className="px-4 py-2.5 text-center text-slate-500 dark:text-white/50">
                          {item.loan_id ? `#${item.loan_id}` : '---'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800 dark:text-white tabular-nums">
                          {fmtRD(item.estimated_value)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-white/60">
                          {item.storage_location || '---'}
                        </td>
                        <td className={`px-4 py-2.5 tabular-nums ${
                          isExpired ? 'text-[#b3001e] font-semibold' :
                          isAlert ? 'text-[#b3001e] font-semibold' :
                          'text-slate-600 dark:text-white/60'
                        }`}>
                          {fmtDate(item.redeem_deadline)}
                          {isAlert && !isExpired && <span className="ml-1 text-[9px]">{days}d</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusPill item={item} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            {item.status === 'forfeited' && (
                              <ListingCell item={item} listings={listings}
                                onPublish={(it) => setPublishModal(it)}
                                onUnpublish={handleUnpublish}
                                showToast={showToast} />
                            )}
                            <button onClick={() => setDocsModal(item)}
                              title="Documentos"
                              className="p-1.5 text-slate-400 dark:text-white/40 hover:text-[#b3001e] rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                              <FileText size={13} />
                            </button>
                            <button onClick={() => handlePrintPapeleta(item)}
                              title="Imprimir Papeleta"
                              className="p-1.5 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                              <Printer size={13} />
                            </button>
                            {item.status === 'held' && (
                              <>
                                <button onClick={() => handleRedeem(item)}
                                  title="Redimir"
                                  className="px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors">
                                  Redimir
                                </button>
                                <button onClick={() => handleForfeit(item)}
                                  title="Decomisar"
                                  className="px-2 py-1 text-[10px] font-semibold text-[#b3001e] hover:bg-[#b3001e]/10 rounded-lg transition-colors">
                                  Decomisar
                                </button>
                              </>
                            )}
                            <button onClick={() => setModal({ type: 'edit', item })}
                              title="Editar"
                              className="p-1.5 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                              <Pencil size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
              {filtered.map(item => {
                const days = daysUntil(item.redeem_deadline)
                const alertDays = Number(item.default_alert_days ?? 3)
                const isAlert = item.status === 'held' && days >= 0 && days <= alertDays
                const isExpired = item.status === 'held' && days < 0
                const listings = listingsByPawn[item.supabase_id] || []
                return (
                  <div key={item.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-white">{item.description}</p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
                          {item.client_name || `Cliente #${item.client_id}`}
                          {item.loan_id ? ` -- Prestamo #${item.loan_id}` : ''}
                        </p>
                      </div>
                      <StatusPill item={item} />
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 dark:text-white/50">
                        Valor: <span className="font-semibold text-slate-800 dark:text-white">{fmtRD(item.estimated_value)}</span>
                      </span>
                      <span className={`${
                        isExpired || isAlert ? 'text-[#b3001e] font-semibold' :
                        'text-slate-500 dark:text-white/50'
                      }`}>
                        Vence: {fmtDate(item.redeem_deadline)}
                      </span>
                    </div>

                    {item.storage_location && (
                      <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-white/40">
                        <MapPin size={10} /> {item.storage_location}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1 flex-wrap">
                      {item.status === 'held' && (
                        <>
                          <button onClick={() => handleRedeem(item)}
                            className="flex-1 py-2 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors min-h-[44px]">
                            Redimir
                          </button>
                          <button onClick={() => handleForfeit(item)}
                            className="flex-1 py-2 text-[11px] font-semibold text-[#b3001e] border border-[#b3001e]/30 rounded-lg hover:bg-[#b3001e]/10 transition-colors min-h-[44px]">
                            Decomisar
                          </button>
                        </>
                      )}
                      {item.status === 'forfeited' && (
                        <div className="flex-1">
                          <ListingCell item={item} listings={listings}
                            onPublish={(it) => setPublishModal(it)}
                            onUnpublish={handleUnpublish}
                            showToast={showToast} />
                        </div>
                      )}
                      <button onClick={() => setDocsModal(item)}
                        className="px-3 py-2 text-[11px] border border-slate-200 dark:border-white/10 rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 min-h-[44px]">
                        <FileText size={13} />
                      </button>
                      <button onClick={() => setModal({ type: 'edit', item })}
                        className="px-3 py-2 text-[11px] border border-slate-200 dark:border-white/10 rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 min-h-[44px]">
                        <Pencil size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <PawnModal
          item={modal.item}
          onClose={() => setModal(null)}
          showToast={showToast}
          onSave={() => {
            setModal(null)
            loadItems()
            showToast(modal.item ? 'Articulo actualizado' : 'Empeno registrado')
          }}
        />
      )}

      {/* Documents Modal */}
      {docsModal && (
        <DocumentsModal item={docsModal} onClose={() => setDocsModal(null)} showToast={showToast} />
      )}

      {/* Publish Modal */}
      {publishModal && (
        <PublishModal
          item={publishModal}
          onClose={() => setPublishModal(null)}
          showToast={showToast}
          onPublished={({ slug }) => {
            setPublishModal(null)
            loadItems()
            showToast(`Publicado en /tienda-empenos/${slug}`)
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2 ${
          toast.variant === 'error' ? 'bg-[#b3001e]' : 'bg-emerald-600'
        }`}>
          <Check size={15} /> {toast.msg}
        </div>
      )}
    </div>
  )
}
