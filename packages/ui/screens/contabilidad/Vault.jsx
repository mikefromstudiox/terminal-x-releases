// Vault — Document Vault per client (Phase 1, Storage-wired).
//
// Real upload flow:
//   1. Client requests signed upload URL via /api/panel?action=vault_upload_sign
//   2. Browser PUTs the file directly to Supabase Storage (bucket=contabilidad-vault)
//   3. Client INSERTs the accounting_documents row with the storage key (r2_key)
//   4. Audit-trail row written via api.activity.log
//
// Download:
//   - GET signed URL via vault_download_sign (1h), open in new tab
//
// Delete (admin only):
//   - vault_delete removes the storage object + the metadata row server-side
//
// 50 MB hard cap, surfaced in UI before upload starts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Folder, Upload, Trash2, Loader2, Download, AlertTriangle } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'

const PANEL_API = '/api/panel'
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB
const ADMIN_ROLES = new Set(['owner', 'manager', 'cfo', 'accountant'])

async function callPanel(action, payload, method = 'POST') {
  const mod = await import('@terminal-x/services/supabase')
  const sb = mod.getSupabaseClient?.()
  const sess = (await sb?.auth?.getSession?.())?.data?.session
  const token = sess?.access_token
  if (!token) throw new Error('Sesión expirada — inicia sesión.')
  const res = await fetch(`${PANEL_API}?action=${encodeURIComponent(action)}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j?.ok === false) {
    const code = j?.error || j?.message || `HTTP ${res.status}`
    throw new Error(code)
  }
  return j
}

function fmtBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / 1024 / 1024).toFixed(2)} MB`
}

function errLabel(code) {
  const map = {
    too_large: 'Archivo excede 50 MB',
    bad_path: 'Ruta de archivo inválida',
    insufficient_role: 'Solo dueños/contadores pueden eliminar',
    rate_limited: 'Demasiadas solicitudes — espera un momento',
    invalid_token: 'Sesión expirada',
    no_business: 'Negocio no resuelto',
    not_found: 'Documento no encontrado',
    sign_failed: 'No se pudo firmar la URL',
    upload_failed: 'Falló la subida',
  }
  return map[code] || code || 'Error'
}

export default function Vault() {
  const api = useAPI()
  const { user } = useAuth()
  const isAdmin = ADMIN_ROLES.has((user?.role || '').toLowerCase())

  const [docs, setDocs] = useState([])
  const [clients, setClients] = useState([])
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(null) // { name, pct, total, done }

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    try {
      const [d, c] = await Promise.all([
        api.contabilidad.documentList(),
        api.contabilidad.clientList(),
      ])
      setDocs(d || [])
      setClients(c || [])
    } catch (e) {
      setError(errLabel(e?.message))
    }
  }, [api])

  useEffect(() => { reload() }, [reload])

  const grouped = useMemo(() => {
    const g = new Map()
    for (const d of docs) {
      if (filter && !`${d.filename || ''} ${d.category || ''}`.toLowerCase().includes(filter.toLowerCase())) continue
      const key = d.accounting_client_id || 'firma'
      if (!g.has(key)) g.set(key, [])
      g.get(key).push(d)
    }
    return g
  }, [docs, filter])

  const clientName = (id) => id === 'firma'
    ? 'Firma (sin asignar)'
    : (clients.find(c => c.id === id)?.nombre_comercial || `Cliente #${id}`)

  async function uploadOne(file, accountingClientId) {
    if (file.size > MAX_BYTES) {
      throw new Error('too_large')
    }
    // 1) Sign
    const sign = await callPanel('vault_upload_sign', {
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      accounting_client_id: accountingClientId === 'firma' ? null : accountingClientId,
    })

    // 2) PUT directly to Supabase Storage signed URL
    const putRes = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', sign.signedUrl, true)
      xhr.setRequestHeader('Content-Type', sign.contentType || file.type || 'application/octet-stream')
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setUploadProgress({ name: file.name, pct: Math.round((ev.loaded / ev.total) * 100) })
        }
      }
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
        ? resolve(true)
        : reject(new Error(`upload_failed_${xhr.status}`))
      xhr.onerror = () => reject(new Error('upload_failed'))
      xhr.send(file)
    })
    if (!putRes) throw new Error('upload_failed')

    // 3) Insert metadata row pointing at the storage key
    await api.contabilidad.documentAdd({
      accounting_client_id: accountingClientId === 'firma' ? null : accountingClientId,
      category: 'otro',
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size || 0,
      r2_key: sign.path,
      tags: [],
    })

    // 4) Audit
    try {
      await api.activity?.log?.({
        event_type: 'vault_upload',
        severity: 'info',
        target_type: 'accounting_document',
        target_id: null,
        target_name: file.name,
        metadata: {
          filename: file.name,
          size: file.size || 0,
          mime: file.type || 'application/octet-stream',
          r2_key: sign.path,
          accounting_client_id: accountingClientId === 'firma' ? null : accountingClientId,
        },
      })
    } catch {}
  }

  async function onUpload(e, accountingClientId) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setError('')
    setBusy(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setUploadProgress({ name: f.name, pct: 0, done: i, total: files.length })
        try {
          await uploadOne(f, accountingClientId)
        } catch (err) {
          setError(`${f.name}: ${errLabel(err?.message)}`)
        }
      }
      await reload()
    } finally {
      setUploadProgress(null)
      setBusy(false)
    }
  }

  async function onDownload(d) {
    setError('')
    if (!d?.r2_key) {
      setError('Este documento no tiene archivo asociado (solo metadata).')
      return
    }
    try {
      const r = await callPanel('vault_download_sign', { r2_key: d.r2_key, download_filename: d.filename })
      try {
        await api.activity?.log?.({
          event_type: 'vault_download',
          severity: 'info',
          target_type: 'accounting_document',
          target_id: d.id,
          target_name: d.filename,
          metadata: { filename: d.filename, size: d.size || 0, r2_key: d.r2_key },
        })
      } catch {}
      window.open(r.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(errLabel(err?.message))
    }
  }

  async function onRemove(d) {
    if (!isAdmin) {
      setError('Solo dueños/contadores pueden eliminar.')
      return
    }
    if (!window.confirm(`¿Eliminar "${d.filename}" del vault? Esta acción no se puede deshacer.`)) return
    setError('')
    try {
      await callPanel('vault_delete', { document_id: d.id, r2_key: d.r2_key })
      try {
        await api.activity?.log?.({
          event_type: 'vault_delete',
          severity: 'warn',
          target_type: 'accounting_document',
          target_id: d.id,
          target_name: d.filename,
          metadata: { filename: d.filename, size: d.size || 0, r2_key: d.r2_key },
        })
      } catch {}
      await reload()
    } catch (err) {
      setError(errLabel(err?.message))
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-black dark:text-white inline-flex items-center gap-2">
          <Folder size={22} className="text-[#b3001e]" /> Vault
        </h1>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar archivos…"
          className="px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm"
        />
      </div>

      {uploadProgress && (
        <div className="mb-3 px-4 py-2 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/30 text-sm text-black dark:text-white">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-[#b3001e]" />
            <span className="truncate">Subiendo: <b>{uploadProgress.name}</b> — {uploadProgress.pct ?? 0}%</span>
          </div>
          <div className="mt-1 h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-[#b3001e] transition-all" style={{ width: `${uploadProgress.pct ?? 0}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 px-4 py-2 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/40 text-sm text-[#b3001e] flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="space-y-5">
        <ClientSection
          key="firma"
          title={clientName('firma')}
          docs={grouped.get('firma') || []}
          onUpload={(e) => onUpload(e, 'firma')}
          onDownload={onDownload}
          onRemove={onRemove}
          busy={busy}
          isAdmin={isAdmin}
        />
        {clients.map(c => (
          <ClientSection
            key={c.id}
            title={c.nombre_comercial}
            docs={grouped.get(c.id) || []}
            onUpload={(e) => onUpload(e, c.id)}
            onDownload={onDownload}
            onRemove={onRemove}
            busy={busy}
            isAdmin={isAdmin}
          />
        ))}
      </div>

      <p className="mt-4 text-xs text-black/40 dark:text-white/40">
        Tamaño máximo por archivo: 50 MB. Almacenado cifrado en Supabase Storage (bucket privado).
      </p>
    </div>
  )
}

function ClientSection({ title, docs, onUpload, onDownload, onRemove, busy, isAdmin }) {
  return (
    <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
      <header className="flex items-center justify-between bg-black text-white px-4 py-2.5">
        <h2 className="font-bold text-sm">
          {title} <span className="text-white/40">({docs.length})</span>
        </h2>
        <label className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#b3001e] hover:bg-[#c8002a] text-white text-xs font-bold ${busy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Subir
          <input type="file" multiple disabled={busy} className="hidden" onChange={onUpload} />
        </label>
      </header>
      {docs.length === 0
        ? <p className="px-4 py-6 text-xs text-black/40 dark:text-white/40">Sin archivos</p>
        : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {docs.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-[#b3001e]/5">
                <span className="text-black dark:text-white truncate flex-1">
                  {d.filename}
                  {!d.r2_key && <span className="ml-2 text-[10px] uppercase font-bold text-black/40 dark:text-white/40">solo metadata</span>}
                </span>
                <span className="text-xs text-black/50 dark:text-white/50 tabular-nums">{fmtBytes(d.size)}</span>
                <button
                  onClick={() => onDownload(d)}
                  disabled={!d.r2_key}
                  title={d.r2_key ? 'Descargar' : 'Sin archivo'}
                  className="text-black/50 dark:text-white/50 hover:text-[#b3001e] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Download size={14} />
                </button>
                {isAdmin && (
                  <button
                    onClick={() => onRemove(d)}
                    title="Eliminar"
                    className="text-black/40 dark:text-white/40 hover:text-[#b3001e]"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
