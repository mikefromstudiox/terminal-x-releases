import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Plus, Loader2, X, Edit, Trash2, FileText } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

export default function Aseguradoras() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  async function refresh() {
    setLoading(true)
    setRows((await api.aseguradoras?.list?.().catch(() => [])) || [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, []) // eslint-disable-line

  async function remove(row) {
    if (!confirm(L(`Eliminar ${row.nombre}?`, `Delete ${row.nombre}?`))) return
    await api.aseguradoras?.delete?.(row.id)
    refresh()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 dark:text-white"><Shield size={32} />{L('Aseguradoras', 'Insurers')}</h1>
          <p className="text-sm text-black/70 dark:text-white/70 mt-1">{L('Modo e-CF por aseguradora: por WO (default) o lote mensual consolidado.', 'e-CF mode per insurer: per WO (default) or monthly consolidated batch.')}</p>
        </div>
        <button onClick={() => setEditing({})} className="px-4 py-2 bg-[#b3001e] text-white font-bold hover:bg-black flex items-center gap-2"><Plus size={16}/>{L('Nueva', 'New')}</button>
      </div>

      {loading ? <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto"/></div> : (
        <div className="border border-black dark:border-white/20 bg-white dark:bg-white/5">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase tracking-wide bg-black text-white">
            <div className="col-span-3">{L('Nombre', 'Name')}</div>
            <div className="col-span-2">{L('RNC', 'RNC')}</div>
            <div className="col-span-2">{L('Teléfono', 'Phone')}</div>
            <div className="col-span-2">{L('Modo e-CF', 'e-CF Mode')}</div>
            <div className="col-span-3 text-right">{L('Acciones', 'Actions')}</div>
          </div>
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-black/50 dark:text-white/50">{L('Aún sin aseguradoras.', 'No insurers yet.')}</p>
          ) : rows.map(r => (
            <div key={r.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-black/10 dark:border-white/10 dark:text-white">
              <div className="col-span-3 font-semibold">{r.nombre}</div>
              <div className="col-span-2">{r.rnc || '—'}</div>
              <div className="col-span-2">{r.contacto_telefono || '—'}</div>
              <div className="col-span-2">
                <span className={`inline-block px-2 py-0.5 text-xs ${r.ecf_mode === 'monthly_batch' ? 'bg-[#b3001e] text-white' : 'bg-black text-white'}`}>
                  {r.ecf_mode === 'monthly_batch' ? L('Lote mensual', 'Monthly batch') : L('Por WO', 'Per WO')}
                </span>
              </div>
              <div className="col-span-3 flex items-center justify-end gap-2">
                <Link to={`/aseguradoras/lote/${r.supabase_id}`} title={L('Ver lotes','View batches')} className="text-xs underline dark:text-white"><FileText size={14} className="inline mr-1"/>{L('Lotes','Batches')}</Link>
                <button onClick={() => setEditing(r)} className="dark:text-white" title={L('Editar','Edit')}><Edit size={14}/></button>
                <button onClick={() => remove(r)} className="text-[#b3001e]" title={L('Eliminar','Delete')}><Trash2 size={14}/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <Editor row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); refresh() }} />}
    </div>
  )
}

function Editor({ row, onClose, onSaved }) {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    nombre: row?.nombre || '',
    rnc: row?.rnc || '',
    contacto_telefono: row?.contacto_telefono || '',
    contacto_email: row?.contacto_email || '',
    ecf_mode: row?.ecf_mode || 'per_wo',
    notas: row?.notas || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    if (!form.nombre) return
    setSaving(true)
    setErr('')
    try {
      if (row?.id) await api.aseguradoras?.update?.(row.id, form)
      else         await api.aseguradoras?.create?.(form)
      onSaved?.()
    } catch (e) {
      setErr(e?.message || 'Error guardando aseguradora')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-black border border-black dark:border-white max-w-lg w-full">
        <div className="p-4 border-b border-black dark:border-white flex items-center justify-between">
          <h2 className="font-bold text-lg flex items-center gap-2 dark:text-white"><Shield size={18}/>{row?.id ? L('Editar', 'Edit') : L('Nueva Aseguradora', 'New Insurer')}</h2>
          <button onClick={onClose} className="dark:text-white"><X size={18}/></button>
        </div>
        <div className="p-4 space-y-3 dark:text-white">
          <input className="w-full p-2 border border-black dark:border-white/30 dark:bg-white/5" placeholder={L('Nombre','Name')} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}/>
          <input className="w-full p-2 border border-black dark:border-white/30 dark:bg-white/5" placeholder="RNC" value={form.rnc} onChange={e => setForm({ ...form, rnc: e.target.value })}/>
          <div className="grid grid-cols-2 gap-2">
            <input className="p-2 border border-black dark:border-white/30 dark:bg-white/5" placeholder={L('Teléfono','Phone')} value={form.contacto_telefono} onChange={e => setForm({ ...form, contacto_telefono: e.target.value })}/>
            <input className="p-2 border border-black dark:border-white/30 dark:bg-white/5" placeholder="Email" value={form.contacto_email} onChange={e => setForm({ ...form, contacto_email: e.target.value })}/>
          </div>
          <div>
            <div className="text-xs font-bold uppercase mb-1">{L('Modo de Facturación e-CF', 'e-CF Billing Mode')}</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm({ ...form, ecf_mode: 'per_wo' })} className={`p-3 border text-left ${form.ecf_mode === 'per_wo' ? 'border-[#b3001e] bg-[#b3001e] text-white' : 'border-black dark:border-white/30'}`}>
                <div className="font-bold text-sm">{L('Por WO','Per WO')}</div>
                <div className="text-[11px] opacity-80">{L('Un E31 por orden al cerrar.','One E31 per work order on close.')}</div>
              </button>
              <button type="button" onClick={() => setForm({ ...form, ecf_mode: 'monthly_batch' })} className={`p-3 border text-left ${form.ecf_mode === 'monthly_batch' ? 'border-[#b3001e] bg-[#b3001e] text-white' : 'border-black dark:border-white/30'}`}>
                <div className="font-bold text-sm">{L('Lote mensual','Monthly batch')}</div>
                <div className="text-[11px] opacity-80">{L('Un E31 mensual consolidado.','One consolidated E31 per month.')}</div>
              </button>
            </div>
          </div>
          <textarea className="w-full p-2 border border-black dark:border-white/30 dark:bg-white/5" rows="2" placeholder={L('Notas','Notes')} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })}/>
          {err && <p className="text-[12px] text-[#b3001e] font-bold">{err}</p>}
        </div>
        <div className="p-4 border-t border-black dark:border-white flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-black dark:border-white dark:text-white">{L('Cancelar','Cancel')}</button>
          <button disabled={saving || !form.nombre} onClick={save} className="px-4 py-2 bg-[#b3001e] text-white font-bold hover:bg-black disabled:opacity-50">{saving ? '…' : L('Guardar','Save')}</button>
        </div>
      </div>
    </div>
  )
}
