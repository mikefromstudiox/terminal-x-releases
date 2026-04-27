// Vault — Document Vault per client (Phase 1).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Folder, Upload, Trash2, Loader2 } from 'lucide-react'
import { useAPI } from '../../context/DataContext'

export default function Vault() {
  const api = useAPI()
  const [docs, setDocs] = useState([])
  const [clients, setClients] = useState([])
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    const [d, c] = await Promise.all([
      api.contabilidad.documentList(),
      api.contabilidad.clientList(),
    ])
    setDocs(d || [])
    setClients(c || [])
  }, [api])

  useEffect(() => { reload() }, [reload])

  const grouped = useMemo(() => {
    const g = new Map()
    for (const d of docs) {
      if (filter && !`${d.filename} ${d.category}`.toLowerCase().includes(filter.toLowerCase())) continue
      const key = d.accounting_client_id || 'firma'
      if (!g.has(key)) g.set(key, [])
      g.get(key).push(d)
    }
    return g
  }, [docs, filter])

  const clientName = (id) => id === 'firma' ? 'Firma (sin asignar)' :
    (clients.find(c => c.id === id)?.nombre_comercial || `Cliente #${id}`)

  async function upload(e, accountingClientId) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setBusy(true)
    try {
      for (const f of files) {
        await api.contabilidad.documentAdd({
          accounting_client_id: accountingClientId === 'firma' ? null : accountingClientId,
          category: 'otro',
          filename: f.name,
          mime: f.type || 'application/octet-stream',
          size: f.size || 0,
          tags: [],
        })
      }
      await reload()
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  async function remove(id) {
    if (!window.confirm('¿Eliminar este documento del vault?')) return
    await api.contabilidad.documentDelete(id)
    await reload()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-black dark:text-white inline-flex items-center gap-2">
          <Folder size={22} className="text-[#b3001e]" /> Vault
        </h1>
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar archivos…"
          className="px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm" />
      </div>

      <div className="space-y-5">
        <ClientSection
          key="firma"
          title={clientName('firma')}
          docs={grouped.get('firma') || []}
          onUpload={(e) => upload(e, 'firma')}
          onRemove={remove}
          busy={busy}
        />
        {clients.map(c => (
          <ClientSection
            key={c.id}
            title={c.nombre_comercial}
            docs={grouped.get(c.id) || []}
            onUpload={(e) => upload(e, c.id)}
            onRemove={remove}
            busy={busy}
          />
        ))}
      </div>
    </div>
  )
}

function ClientSection({ title, docs, onUpload, onRemove, busy }) {
  return (
    <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
      <header className="flex items-center justify-between bg-black text-white px-4 py-2.5">
        <h2 className="font-bold text-sm">{title} <span className="text-white/40">({docs.length})</span></h2>
        <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#b3001e] hover:bg-[#c8002a] text-white text-xs font-bold cursor-pointer">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Subir
          <input type="file" multiple className="hidden" onChange={onUpload} />
        </label>
      </header>
      {docs.length === 0
        ? <p className="px-4 py-6 text-xs text-black/40 dark:text-white/40">Sin archivos</p>
        : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {docs.map(d => (
              <li key={d.id} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-[#b3001e]/5">
                <span className="text-black dark:text-white truncate">{d.filename}</span>
                <span className="text-xs text-black/50 dark:text-white/50 mr-3">{Math.round((d.size || 0)/1024)} KB</span>
                <button onClick={() => onRemove(d.id)} className="text-black/40 dark:text-white/40 hover:text-[#b3001e]">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
