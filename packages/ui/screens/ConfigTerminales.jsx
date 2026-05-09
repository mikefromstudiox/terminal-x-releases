// ConfigTerminales — read-only "Terminales" mini-page reachable from
// ConfigGrid. Replaces a misrouted card (was pointing at /admin/clients).
// Shows every license belonging to this business with last_seen + label
// + hardware_id so the owner can see which terminals are active.
//
// Owner can click "Editar etiqueta" to inline-rename a terminal — same
// PATCH path used by the admin Licencias tab, just scoped to "my business".
import { useState, useEffect } from 'react'
import { Smartphone, Loader2, Edit2, Check, X, RefreshCw, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI } from '../context/DataContext'
import { useLang } from '../i18n'

function CopyChip({ value }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
          setCopied(true); setTimeout(() => setCopied(false), 1400)
        } catch {}
      }}
      title="Copiar"
      className="ml-1 p-0.5 rounded text-slate-400 hover:text-slate-700 dark:text-white/40 dark:hover:text-white"
    >{copied ? <Check size={11} className="text-emerald-500" /> : <Edit2 size={11} />}</button>
  )
}

export default function ConfigTerminales() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editLabel, setEditLabel] = useState('')

  const reload = async () => {
    setLoading(true)
    try {
      // api.license.listForBusiness gives every license row scoped to the
      // current tenant. RLS already filters anon to its own business.
      const rows = await api.license?.listForBusiness?.()
        || await api.license?.allForCurrentBusiness?.()
        || []
      setList(Array.isArray(rows) ? rows : [])
      setError(null)
    } catch (e) {
      try {
        window.__txReportError?.(e, { severity: 'warn', category: 'config_terminales_load' })
      } catch {}
      setError(e?.message || 'No se pudieron cargar los terminales')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [])

  const saveLabel = async (id) => {
    try {
      await api.license?.updateLabel?.({ id, label: editLabel.trim() || null })
      setEditingId(null)
      setEditLabel('')
      reload()
    } catch (e) {
      try {
        window.__txReportError?.(e, {
          severity: 'warn',
          category: 'config_terminales_label',
          extra: { license_id: id },
        })
      } catch {}
      setError(e?.message || 'No se pudo guardar la etiqueta')
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
              <Smartphone size={22} className="text-[#b3001e]" />
              {L('Terminales', 'Terminals')}
            </h1>
            <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
              {L('Cajas activas en tu negocio. Cada cobro se registra contra el terminal donde se hizo.',
                 'Active terminals at your business. Every cobro is logged against the terminal it ran on.')}
            </p>
          </div>
          <button
            type="button" onClick={reload}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[12px] font-bold hover:border-slate-300 dark:hover:border-white/20"
          >
            <RefreshCw size={13} /> {L('Refrescar', 'Refresh')}
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/20 flex items-center gap-2 text-[#b3001e] text-[13px]">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/30">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-dashed border-slate-200 dark:border-white/10 p-10 text-center">
            <Smartphone size={32} className="mx-auto text-slate-300 dark:text-white/20 mb-3" />
            <p className="text-[14px] font-bold text-slate-700 dark:text-white/70">{L('Sin terminales registrados', 'No terminals registered')}</p>
            <p className="text-[12px] text-slate-500 dark:text-white/40 mt-1">
              {L('Cada instalación de Terminal X aparece aquí cuando se valida la licencia.',
                 'Each Terminal X install shows up here on first license validation.')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {list.map(lic => {
              const last = lic.last_seen ? new Date(lic.last_seen) : null
              const elapsedMin = last ? Math.round((Date.now() - last.getTime()) / 60000) : null
              const isActive = elapsedMin != null && elapsedMin < 60
              return (
                <div key={lic.id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      {editingId === lic.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={editLabel}
                            onChange={e => setEditLabel(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveLabel(lic.id); if (e.key === 'Escape') { setEditingId(null); setEditLabel('') } }}
                            placeholder="Caja 1 / iPad mostrador"
                            className="flex-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black text-slate-900 dark:text-white text-[13px]"
                            autoFocus
                          />
                          <button onClick={() => saveLabel(lic.id)} className="p-1 rounded text-emerald-600"><Check size={14} /></button>
                          <button onClick={() => { setEditingId(null); setEditLabel('') }} className="p-1 rounded text-slate-400"><X size={14} /></button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setEditingId(lic.id); setEditLabel(lic.label || '') }}
                          disabled={user?.role !== 'owner'}
                          className={`text-[14px] font-bold text-left disabled:cursor-default disabled:opacity-100 ${lic.label ? 'text-slate-900 dark:text-white' : 'italic text-slate-400 dark:text-white/40'}`}
                        >
                          {lic.label || L('sin etiqueta', 'no label')}
                          {user?.role === 'owner' && <Edit2 size={11} className="inline ml-1.5 opacity-50" />}
                        </button>
                      )}
                      <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-white/40 mt-0.5">{lic.platform || '—'}</p>
                    </div>
                    <span className={`text-[10px] font-extrabold tracking-[1.5px] px-2 py-0.5 rounded-full uppercase ${isActive
                      ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40'}`}>
                      {isActive ? L('Activo', 'Active') : L('Inactivo', 'Idle')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-[11px] pt-3 border-t border-slate-100 dark:border-white/10">
                    <div>
                      <p className="text-slate-400 dark:text-white/40">{L('Clave', 'Key')}</p>
                      <p className="font-mono text-[10px] text-slate-700 dark:text-white/70 truncate">
                        {lic.license_key || L('Solo web', 'Web only')}
                        <CopyChip value={lic.license_key} />
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 dark:text-white/40">{L('Último acceso', 'Last seen')}</p>
                      <p className="text-slate-700 dark:text-white/70">{last ? last.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 dark:text-white/40">HWID</p>
                      <p className="font-mono text-[10px] text-slate-500 dark:text-white/50 truncate">{lic.hardware_id || '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 dark:text-white/40">{L('Estado', 'Status')}</p>
                      <p className="text-slate-700 dark:text-white/70">{lic.status || '—'}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
