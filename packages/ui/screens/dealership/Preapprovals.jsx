/**
 * Preapprovals.jsx — Concesionario manual bank pre-approval workflow.
 *
 * Real DR concesionario: vendedor llama Popular/Reservas/BHD/Promerica/Vimenca,
 * registra la oferta. Cuando el cliente cierra el deal, la pre-aprobacion
 * pre_aprobada se marca 'utilizada' por DealBuilder.
 *
 * Estados: solicitada → en_revision → pre_aprobada → utilizada
 *                                                 ↘ rechazada
 *                                                 ↘ expirada (sweep job)
 *
 * v2.16.4 Sprint 2C H5.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  X, Loader2, Banknote, Plus, Pencil, CheckCircle, Ban, Upload, Search,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import DateTimeModal from '../../components/DateTimeModal'
import { DR_BANKS } from '../../../config/businessTypes'

const STATUS_META = {
  solicitada:   { es: 'Solicitada',   en: 'Requested',   cls: 'bg-slate-500 text-white' },
  en_revision:  { es: 'En revision',  en: 'Under review',cls: 'bg-amber-500 text-white' },
  pre_aprobada: { es: 'Pre-aprobada', en: 'Pre-approved',cls: 'bg-emerald-600 text-white' },
  rechazada:    { es: 'Rechazada',    en: 'Rejected',    cls: 'bg-[#b3001e] text-white' },
  expirada:     { es: 'Expirada',     en: 'Expired',     cls: 'bg-slate-500 text-white' },
  utilizada:    { es: 'Utilizada',    en: 'Used',        cls: 'bg-indigo-600 text-white' },
}

const TABS = [
  { v: 'active',   es: 'Activas',    en: 'Active' },
  { v: 'history',  es: 'Historial',  en: 'History (90d)' },
]

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtD(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Standard amortization formula — used by the auto-calc helper button so the
// vendedor can populate monthly_quota_offered when the bank only quoted the
// rate + term. cuota = P * r / (1 - (1+r)^-n) with r monthly.
function calcMonthly(amount, ratePctAnnual, months) {
  const P = Number(amount) || 0
  const r = (Number(ratePctAnnual) || 0) / 100 / 12
  const n = Number(months) || 0
  if (P <= 0 || n <= 0) return 0
  if (r === 0) return +(P / n).toFixed(2)
  return +(P * r / (1 - Math.pow(1 + r, -n))).toFixed(2)
}

// ── Client picker (same shape as Reservations.jsx) ─────────────────────────

function ClientPicker({ clients, value, onChange, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = (clients || []).filter(c => !!c.id)
    if (!term) return list.slice(0, 50)
    return list.filter(c =>
      (c.name || '').toLowerCase().includes(term) ||
      (c.phone || '').toLowerCase().includes(term) ||
      (c.cedula || '').toLowerCase().includes(term)
    ).slice(0, 50)
  }, [q, clients])
  const selected = (clients || []).find(c => c.id === value)
  return (
    <div>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-black/40" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={L('Buscar cliente por nombre, telefono o cedula…', 'Search client by name, phone or ID…')}
          className="w-full border border-black pl-9 pr-2 py-1.5 text-sm"
        />
      </div>
      <div className="mt-1 max-h-36 overflow-y-auto border border-black/20">
        {filtered.length === 0 ? (
          <div className="text-xs text-black/40 p-2">{L('Sin resultados.', 'No results.')}</div>
        ) : filtered.map(c => (
          <button
            type="button"
            key={c.id}
            onClick={() => onChange(c)}
            className={`block w-full text-left px-2 py-1.5 text-xs border-t border-black/10 ${value === c.id ? 'bg-black text-white' : 'hover:bg-black/5'}`}
          >
            <span className="font-semibold">{c.name}</span>
            {c.phone && <span className="ml-2 text-[10px] opacity-70">{c.phone}</span>}
          </button>
        ))}
      </div>
      {selected && (
        <p className="mt-1 text-[10px] text-black/60">
          {L('Seleccionado:', 'Selected:')} <strong>{selected.name}</strong>
        </p>
      )}
    </div>
  )
}

// ── New / Edit modal ───────────────────────────────────────────────────────

function PreapprovalModal({ initial, clients, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState(() => ({
    id:                     initial?.id || null,
    supabase_id:            initial?.supabase_id || null,
    client_id:              initial?.client_id || '',
    client_supabase_id:     initial?.client_supabase_id || null,
    bank:                   initial?.bank || DR_BANKS[0],
    bank_contact:           initial?.bank_contact || '',
    requested_amount:       initial?.requested_amount ?? 0,
    term_months:            initial?.term_months ?? 60,
    rate_offered:           initial?.rate_offered ?? '',
    monthly_quota_offered:  initial?.monthly_quota_offered ?? '',
    status:                 initial?.status || 'solicitada',
    expires_at:             initial?.expires_at || new Date(Date.now() + 30 * 86400000).toISOString(),
    notes:                  initial?.notes || '',
  }))
  const [showDateModal, setShowDateModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setClient = (c) => setForm(f => ({ ...f, client_id: c.id, client_supabase_id: c.supabase_id || null }))

  function autocalcMonthly() {
    const cuota = calcMonthly(form.requested_amount, form.rate_offered, form.term_months)
    if (cuota > 0) set('monthly_quota_offered', cuota)
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.bank) { setErr(L('Banco requerido.', 'Bank required.')); return }
    if (!form.client_id) { setErr(L('Cliente requerido.', 'Client required.')); return }
    if (Number(form.requested_amount) <= 0) { setErr(L('Monto solicitado debe ser > 0.', 'Requested amount must be > 0.')); return }
    setBusy(true)
    try {
      await onSave({
        ...form,
        requested_amount:      Number(form.requested_amount) || 0,
        term_months:           form.term_months === '' ? null : Number(form.term_months),
        rate_offered:          form.rate_offered === '' ? null : Number(form.rate_offered),
        monthly_quota_offered: form.monthly_quota_offered === '' ? null : Number(form.monthly_quota_offered),
      })
      onClose()
    } catch (ex) {
      setErr(ex?.message || 'Error')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-lg font-bold flex items-center gap-2"><Banknote size={18} />
            {form.id ? L('Editar Pre-aprobacion', 'Edit Pre-approval') : L('Nueva Solicitud', 'New Request')}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3 text-sm">
          {err && <div className="bg-[#b3001e] text-white px-3 py-1.5 text-xs">{err}</div>}

          <div>
            <span className="text-xs font-semibold">{L('Cliente', 'Client')}*</span>
            <ClientPicker clients={clients} value={form.client_id} onChange={setClient} lang={lang} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold">{L('Banco', 'Bank')}*</span>
              <select value={form.bank} onChange={e => set('bank', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                {DR_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Contacto en banco', 'Bank contact')}</span>
              <input value={form.bank_contact} onChange={e => set('bank_contact', e.target.value)} placeholder={L('Nombre del oficial', 'Officer name')} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs font-semibold">{L('Monto', 'Amount')} RD$*</span>
              <input type="number" step="0.01" min="0" value={form.requested_amount} onChange={e => set('requested_amount', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Plazo (meses)', 'Term (mo)')}</span>
              <input type="number" min="1" value={form.term_months} onChange={e => set('term_months', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Tasa %', 'Rate %')}</span>
              <input type="number" step="0.001" min="0" value={form.rate_offered} onChange={e => set('rate_offered', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2 items-end">
            <label className="block col-span-2">
              <span className="text-xs font-semibold">{L('Cuota mensual ofertada', 'Monthly quota offered')} RD$</span>
              <input type="number" step="0.01" min="0" value={form.monthly_quota_offered} onChange={e => set('monthly_quota_offered', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <button type="button" onClick={autocalcMonthly} className="px-2 py-1.5 border border-black text-xs hover:bg-black hover:text-white" title={L('Calcular con monto + tasa + plazo', 'Calc from amount + rate + term')}>
              {L('Auto-calc', 'Auto-calc')}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold">{L('Estado', 'Status')}</span>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                {Object.entries(STATUS_META).filter(([v]) => v !== 'utilizada').map(([v, m]) => (
                  <option key={v} value={v}>{lang === 'es' ? m.es : m.en}</option>
                ))}
              </select>
            </label>
            <div>
              <span className="text-xs font-semibold">{L('Vence', 'Expires')}</span>
              <button type="button" onClick={() => setShowDateModal(true)} className="mt-1 w-full border border-black px-2 py-1.5 text-left hover:bg-black/5">
                {fmtD(form.expires_at)}
              </button>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-black">{L('Cancelar', 'Cancel')}</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-[#b3001e] text-white font-bold disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}{L('Guardar', 'Save')}
            </button>
          </div>
        </form>
        <DateTimeModal
          open={showDateModal}
          title={L('Vence el', 'Expires on')}
          initialValue={form.expires_at}
          minDate={new Date().toISOString()}
          onConfirm={(iso) => { set('expires_at', iso); setShowDateModal(false) }}
          onCancel={() => setShowDateModal(false)}
        />
      </div>
    </div>
  )
}

// ── Status-action modals (reject reason / upload letter URL) ────────────────

function ReasonModal({ title, label, lang, onConfirm, onClose, confirmLabel }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-black">
          <h2 className="font-bold">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onConfirm(val.trim() || null); onClose() } catch { setBusy(false) } }} className="p-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-xs font-semibold">{label}</span>
            <textarea value={val} onChange={e => setVal(e.target.value)} rows={3} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 border border-black text-xs">{L('Cancelar', 'Cancel')}</button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 bg-[#b3001e] text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1">
              {busy && <Loader2 size={12} className="animate-spin" />}{confirmLabel || L('Confirmar', 'Confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function Preapprovals() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [rows, setRows] = useState([])
  const [clients, setClients] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('active')
  const [editRow, setEditRow] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [rejectRow, setRejectRow] = useState(null)
  const [uploadRow, setUploadRow] = useState(null)

  async function load() {
    setLoading(true)
    const settled = await Promise.allSettled([
      api.bankPreapproval?.list?.() ?? Promise.resolve([]),
      api.clients?.list?.() ?? api.clients?.all?.() ?? Promise.resolve([]),
      api.empleados?.list?.() ?? Promise.resolve([]),
    ])
    const [r, c, s] = settled
    setRows(r.status === 'fulfilled' ? (r.value || []) : [])
    setClients(c.status === 'fulfilled' ? (c.value || []) : [])
    setStaff(s.status === 'fulfilled' ? (s.value || []) : [])
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  function clientOf(r) {
    return clients.find(x => x.supabase_id === r.client_supabase_id) || clients.find(x => x.id === r.client_id)
  }
  function staffOf(r) {
    return staff.find(x => x.supabase_id === r.salesperson_supabase_id) || staff.find(x => x.id === r.salesperson_id)
  }

  const filtered = useMemo(() => {
    const list = rows || []
    const nowTs = Date.now()
    if (tab === 'active') {
      return list.filter(r => ['solicitada','en_revision','pre_aprobada'].includes(r.status)
        && (!r.expires_at || new Date(r.expires_at).getTime() > nowTs))
    }
    // history — last 90 days
    const cutoff = nowTs - 90 * 86400000
    return list.filter(r => {
      const t = r.updated_at ? new Date(r.updated_at).getTime() : new Date(r.created_at).getTime()
      return t >= cutoff
    })
  }, [rows, tab])

  const preApprovedActiveCount = useMemo(() => {
    const nowTs = Date.now()
    return (rows || []).filter(r => r.status === 'pre_aprobada' && (!r.expires_at || new Date(r.expires_at).getTime() > nowTs)).length
  }, [rows])

  async function handleSave(payload) {
    await api.bankPreapproval.upsert(payload)
    await load()
  }
  async function handleSetStatus(id, status, extras = {}) {
    await api.bankPreapproval.setStatus({ id, status, ...extras })
    await load()
  }
  async function handleMarkUsed(row) {
    if (!confirm(L(`Marcar pre-aprobacion de ${row.bank} como UTILIZADA?`, `Mark pre-approval from ${row.bank} as USED?`))) return
    await handleSetStatus(row.id, 'utilizada')
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Banknote size={32} />
            {L('Pre-aprobaciones Bancarias', 'Bank Pre-approvals')}
            {preApprovedActiveCount > 0 && (
              <span className="inline-flex items-center px-2 py-1 bg-[#b3001e] text-white text-xs font-semibold">
                {preApprovedActiveCount} {L('pre-aprobadas no utilizadas', 'pre-approved unused')}
              </span>
            )}
          </h1>
          <p className="text-sm text-black/70 mt-1">
            {L('Solicitudes manuales a bancos: Popular, Reservas, BHD, Promerica, Vimenca, etc.', 'Manual requests to DR banks (Popular, Reservas, BHD, Promerica, Vimenca, etc.)')}
          </p>
        </div>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 bg-[#b3001e] text-white font-bold inline-flex items-center gap-2">
          <Plus size={16} />{L('Nueva solicitud', 'New request')}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map(t => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            className={`px-3 py-1.5 text-xs border border-black ${tab === t.v ? 'bg-black text-white' : 'bg-white text-black hover:bg-black/5'}`}
          >
            {lang === 'es' ? t.es : t.en}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="border border-black p-12 text-center text-sm text-black/60">
          {L('Sin solicitudes activas.', 'No active requests.')}
        </div>
      ) : (
        <div className="border border-black overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">{L('Cliente', 'Client')}</th>
                <th className="text-left px-3 py-2">{L('Banco', 'Bank')}</th>
                <th className="text-right px-3 py-2">{L('Monto', 'Amount')}</th>
                <th className="text-right px-3 py-2">{L('Tasa', 'Rate')}</th>
                <th className="text-right px-3 py-2">{L('Cuota', 'Quota')}</th>
                <th className="text-left px-3 py-2">{L('Estado', 'Status')}</th>
                <th className="text-left px-3 py-2">{L('Vence', 'Expires')}</th>
                <th className="text-left px-3 py-2">{L('Vendedor', 'Salesperson')}</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const meta = STATUS_META[r.status] || STATUS_META.solicitada
                const cli = clientOf(r)
                const sp = staffOf(r)
                const closed = r.status === 'utilizada' || r.status === 'rechazada' || r.status === 'expirada'
                return (
                  <tr key={r.id} className="border-t border-black/10 hover:bg-black/5">
                    <td className="px-3 py-2 font-semibold">{cli?.name || '—'}</td>
                    <td className="px-3 py-2">{r.bank}{r.bank_contact ? <span className="block text-[10px] text-black/60">{r.bank_contact}</span> : null}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtRD(r.requested_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.rate_offered != null ? `${Number(r.rate_offered).toFixed(2)}%` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.monthly_quota_offered != null ? fmtRD(r.monthly_quota_offered) : '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>
                        {lang === 'es' ? meta.es : meta.en}
                      </span>
                    </td>
                    <td className="px-3 py-2">{fmtD(r.expires_at)}</td>
                    <td className="px-3 py-2">{sp?.nombre || sp?.name || '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {!closed && (
                        <>
                          <button onClick={() => setEditRow(r)} title={L('Editar', 'Edit')} className="p-1 hover:bg-black hover:text-white mr-1"><Pencil size={14} /></button>
                          <button onClick={() => setUploadRow(r)} title={L('Subir carta', 'Upload letter')} className="p-1 hover:bg-black hover:text-white mr-1"><Upload size={14} /></button>
                          {r.status === 'pre_aprobada' && (
                            <button onClick={() => handleMarkUsed(r)} title={L('Marcar utilizada', 'Mark used')} className="p-1 hover:bg-indigo-600 hover:text-white mr-1"><CheckCircle size={14} /></button>
                          )}
                          <button onClick={() => setRejectRow(r)} title={L('Marcar rechazada', 'Mark rejected')} className="p-1 hover:bg-[#b3001e] hover:text-white"><Ban size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {(showNew || editRow) && (
        <PreapprovalModal
          initial={editRow}
          clients={clients}
          lang={lang}
          onSave={handleSave}
          onClose={() => { setShowNew(false); setEditRow(null) }}
        />
      )}
      {rejectRow && (
        <ReasonModal
          title={L('Marcar como rechazada', 'Mark as rejected')}
          label={L('Motivo del rechazo', 'Reason for rejection')}
          confirmLabel={L('Rechazar', 'Reject')}
          lang={lang}
          onConfirm={(reason) => handleSetStatus(rejectRow.id, 'rechazada', { notes: reason || null })}
          onClose={() => setRejectRow(null)}
        />
      )}
      {uploadRow && (
        <ReasonModal
          title={L('Subir carta de pre-aprobacion', 'Upload pre-approval letter')}
          label={L('URL de la carta (PDF/imagen)', 'Letter URL (PDF/image)')}
          confirmLabel={L('Guardar', 'Save')}
          lang={lang}
          onConfirm={(url) => handleSetStatus(uploadRow.id, 'pre_aprobada', { decision_letter_url: url || null })}
          onClose={() => setUploadRow(null)}
        />
      )}
    </div>
  )
}
