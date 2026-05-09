/**
 * Reservations.jsx — Dealership unit reservations (deposit + expiry).
 *
 * Real DR concesionario: cliente paga RD$5K-50K para reservar la unidad por X
 * dias; si no completa antes del vencimiento se libera y la unidad vuelve a
 * 'available'. Liberar manualmente devuelve la unidad al inventario; convertir
 * a trato lleva al DealBuilder con el vehiculo y cliente preseleccionados.
 *
 * v2.16.4 Sprint 2A H2.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, X, Loader2, Calendar, AlertTriangle, Trash2, Pencil, ArrowRightCircle,
  Search, DollarSign, MessageCircle,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import DateTimeModal from '../../components/DateTimeModal'
import { sendReservationExpiring } from '../../../services/whatsapp-dealership.js'

const STATUS_META = {
  active:    { es: 'Activa',    en: 'Active',    cls: 'bg-black text-white' },
  converted: { es: 'Convertida',en: 'Converted', cls: 'bg-emerald-600 text-white' },
  released:  { es: 'Liberada',  en: 'Released',  cls: 'bg-slate-500 text-white' },
  expired:   { es: 'Vencida',   en: 'Expired',   cls: 'bg-[#b3001e] text-white' },
}

const DEPOSIT_METHODS = [
  { v: 'efectivo',      es: 'Efectivo',       en: 'Cash' },
  { v: 'tarjeta',       es: 'Tarjeta',        en: 'Card' },
  { v: 'transferencia', es: 'Transferencia',  en: 'Transfer' },
]

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtDT(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function hoursUntil(iso) {
  if (!iso) return Infinity
  return (new Date(iso).getTime() - Date.now()) / 36e5
}

// ── Modals ───────────────────────────────────────────────────────────────────

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
            onClick={() => onChange(c.id)}
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

function ReservationModal({ initial, units, clients, staff, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState(() => ({
    id:                            initial?.id || null,
    supabase_id:                   initial?.supabase_id || null,
    vehicle_inventory_supabase_id: initial?.vehicle_inventory_supabase_id || '',
    client_id:                     initial?.client_id || '',
    client_supabase_id:            initial?.client_supabase_id || null,
    salesperson_id:                initial?.salesperson_id || '',
    salesperson_supabase_id:       initial?.salesperson_supabase_id || null,
    deposit_amount:                initial?.deposit_amount ?? 5000,
    deposit_method:                initial?.deposit_method || 'efectivo',
    expires_at:                    initial?.expires_at || new Date(Date.now() + 7 * 86400000).toISOString(),
    notes:                         initial?.notes || '',
  }))
  const [showDateModal, setShowDateModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const availableUnits = useMemo(() => {
    // When editing, keep the currently-attached unit selectable even if it's
    // 'reserved' (it's reserved BY this row).
    return (units || []).filter(u =>
      u.status === 'available' || (initial && u.supabase_id === initial.vehicle_inventory_supabase_id)
    )
  }, [units, initial])

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.vehicle_inventory_supabase_id) { setErr(L('Selecciona la unidad.', 'Pick the unit.')); return }
    if (!form.client_id) { setErr(L('Selecciona el cliente.', 'Pick the client.')); return }
    if (!(Number(form.deposit_amount) >= 0)) { setErr(L('Deposito invalido.', 'Invalid deposit.')); return }
    if (!form.expires_at) { setErr(L('Fecha de vencimiento requerida.', 'Expiration required.')); return }
    setSaving(true)
    try {
      const client = clients.find(c => c.id === form.client_id)
      const emp = staff.find(s => s.id === form.salesperson_id)
      await onSave({
        id:                            form.id,
        supabase_id:                   form.supabase_id,
        vehicle_inventory_supabase_id: form.vehicle_inventory_supabase_id,
        client_id:                     form.client_id,
        client_supabase_id:            client?.supabase_id || null,
        salesperson_id:                form.salesperson_id || null,
        salesperson_supabase_id:       emp?.supabase_id || null,
        deposit_amount:                Number(form.deposit_amount) || 0,
        deposit_method:                form.deposit_method || 'efectivo',
        expires_at:                    new Date(form.expires_at).toISOString(),
        notes:                         form.notes || null,
        status:                        'active',
      })
      onClose()
    } catch (ex) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(ex, { severity: 'error', category: 'reservations.reservationmodal' }) } catch {}
      setErr(ex?.message || 'Error')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-lg w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold">{initial ? L('Editar reserva', 'Edit reservation') : L('Nueva reserva', 'New reservation')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white" aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          {err && <div className="bg-[#b3001e] text-white px-3 py-2 text-xs">{err}</div>}

          <div>
            <span className="text-xs font-semibold">{L('Cliente', 'Client')}*</span>
            <ClientPicker clients={clients} value={form.client_id} onChange={(id) => set('client_id', id)} lang={lang} />
          </div>

          <label className="block">
            <span className="text-xs font-semibold">{L('Vehiculo', 'Vehicle')}*</span>
            <select
              value={form.vehicle_inventory_supabase_id}
              onChange={e => set('vehicle_inventory_supabase_id', e.target.value)}
              required
              className="mt-1 w-full border border-black px-2 py-1.5"
            >
              <option value="">{L('Seleccionar…', 'Select…')}</option>
              {availableUnits.map(u => (
                <option key={u.id} value={u.supabase_id}>
                  {u.year} {u.make} {u.model} {u.stock_number ? `· #${u.stock_number}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold">{L('Vendedor', 'Salesperson')}</span>
            <select value={form.salesperson_id} onChange={e => set('salesperson_id', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">—</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold">{L('Deposito', 'Deposit')} RD$</span>
              <input
                type="number" step="0.01" min="0"
                value={form.deposit_amount}
                onChange={e => set('deposit_amount', e.target.value)}
                className="mt-1 w-full border border-black px-2 py-1.5"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">{L('Metodo', 'Method')}</span>
              <select value={form.deposit_method} onChange={e => set('deposit_method', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                {DEPOSIT_METHODS.map(m => <option key={m.v} value={m.v}>{lang === 'es' ? m.es : m.en}</option>)}
              </select>
            </label>
          </div>

          <div>
            <span className="text-xs font-semibold flex items-center gap-1"><Calendar size={12}/>{L('Vence el', 'Expires on')}*</span>
            <button
              type="button"
              onClick={() => setShowDateModal(true)}
              className="mt-1 w-full border border-black px-2 py-1.5 text-left hover:bg-black/5"
            >
              {fmtDT(form.expires_at)}
            </button>
          </div>

          <label className="block">
            <span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-black">{L('Cancelar', 'Cancel')}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-[#b3001e] text-white font-bold disabled:opacity-50 inline-flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {L('Guardar', 'Save')}
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

function ReleaseModal({ row, lang, onConfirm, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-lg font-bold">{L('Liberar reserva', 'Release reservation')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={18} /></button>
        </div>
        <form
          onSubmit={async e => {
            e.preventDefault()
            setBusy(true)
            try { await onConfirm(reason.trim() || null); onClose() } catch (_aetherErr) {
              try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'reservations.releasemodal' }) } catch {} setBusy(false) }
          }}
          className="p-5 space-y-3 text-sm"
        >
          <p className="text-xs text-black/70">
            {L('La unidad volvera a estar disponible para la venta.', 'The unit will be available again for sale.')}
          </p>
          <label className="block">
            <span className="text-xs font-semibold">{L('Motivo (opcional)', 'Reason (optional)')}</span>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-black">{L('Cancelar', 'Cancel')}</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-[#b3001e] text-white font-bold disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}
              {L('Liberar', 'Release')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main screen ──────────────────────────────────────────────────────────────

const FILTER_TABS = [
  { v: 'active',     es: 'Activas',          en: 'Active' },
  { v: 'soon',       es: 'Vencen pronto',    en: 'Expiring soon' },
  { v: 'converted',  es: 'Convertidas',      en: 'Converted' },
  { v: 'closed',     es: 'Liberadas/Vencidas', en: 'Released/Expired' },
]

export default function Reservations() {
  const api = useAPI()
  const { lang } = useLang()
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en

  const [rows, setRows] = useState([])
  const [units, setUnits] = useState([])
  const [clients, setClients] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('active')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [releaseRow, setReleaseRow] = useState(null)

  async function load() {
    setLoading(true)
    const [r, u, c, s] = await Promise.all([
      api.vehicleReservation?.list?.() || Promise.resolve([]),
      api.vehicleInventory?.list?.() || Promise.resolve([]),
      api.clients?.list?.() || api.clients?.all?.() || Promise.resolve([]),
      api.empleados?.list?.() || api.empleados?.all?.() || Promise.resolve([]),
    ])
    setRows(r || []); setUnits(u || []); setClients(c || []); setStaff(s || [])
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  async function save(payload) {
    await api.vehicleReservation.upsert(payload)
    await load()
  }
  async function release(row, reason) {
    await api.vehicleReservation.release({ id: row.id, reason })
    await load()
  }
  function convertToDeal(row) {
    const unit = units.find(u => u.supabase_id === row.vehicle_inventory_supabase_id)
    const params = new URLSearchParams()
    if (unit?.id) params.set('vehicle_id', unit.id)
    if (row.client_id) params.set('client_id', row.client_id)
    if (row.id) params.set('reservation_id', row.id)
    navigate(`/deal-builder?${params.toString()}`)
  }

  // Visible rows by filter tab.
  const filtered = useMemo(() => {
    const list = rows || []
    switch (filter) {
      case 'active':
        return list.filter(r => r.status === 'active')
      case 'soon': {
        return list.filter(r => r.status === 'active' && hoursUntil(r.expires_at) <= 48)
      }
      case 'converted':
        return list.filter(r => r.status === 'converted')
      case 'closed': {
        const cutoff = Date.now() - 30 * 86400000
        return list.filter(r => (r.status === 'released' || r.status === 'expired')
          && (r.released_at ? new Date(r.released_at).getTime() >= cutoff : true))
      }
      default: return list
    }
  }, [rows, filter])

  const expiringSoonCount = useMemo(() => {
    return (rows || []).filter(r => r.status === 'active' && hoursUntil(r.expires_at) <= 48).length
  }, [rows])

  function unitLabel(supabase_id) {
    const u = units.find(x => x.supabase_id === supabase_id)
    if (!u) return '—'
    return `${u.year || ''} ${u.make || ''} ${u.model || ''}`.trim()
  }
  function clientLabel(row) {
    const c = clients.find(x => x.supabase_id === row.client_supabase_id) || clients.find(x => x.id === row.client_id)
    return c?.name || '—'
  }
  function sellerLabel(row) {
    const s = staff.find(x => x.supabase_id === row.salesperson_supabase_id) || staff.find(x => x.id === row.salesperson_id)
    return s?.nombre || '—'
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Calendar size={32} />
            {L('Reservas de Vehiculos', 'Vehicle Reservations')}
            {expiringSoonCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#b3001e] text-white text-xs font-semibold">
                <AlertTriangle size={12} />
                {L(`${expiringSoonCount} vencen pronto`, `${expiringSoonCount} expiring soon`)}
              </span>
            )}
          </h1>
          <p className="text-sm text-black/70 mt-1">
            {L('Deposito por unidad con vencimiento. La unidad regresa al inventario al vencer.', 'Per-unit deposit with expiry. The unit returns to inventory on expiry.')}
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true) }} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2">
          <Plus size={18} />{L('Nueva reserva', 'New reservation')}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTER_TABS.map(t => (
          <button
            key={t.v}
            onClick={() => setFilter(t.v)}
            className={`px-3 py-1.5 text-xs border border-black ${filter === t.v ? 'bg-black text-white' : 'bg-white text-black hover:bg-black/5'}`}
          >
            {lang === 'es' ? t.es : t.en}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="border border-black p-12 text-center text-sm text-black/60">
          {L('Sin reservas activas todavia.', 'No active reservations yet.')}
        </div>
      ) : (
        <div className="border border-black overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">{L('Cliente', 'Client')}</th>
                <th className="text-left px-3 py-2">{L('Vehiculo', 'Vehicle')}</th>
                <th className="text-right px-3 py-2">{L('Deposito', 'Deposit')}</th>
                <th className="text-left px-3 py-2">{L('Vencimiento', 'Expires')}</th>
                <th className="text-left px-3 py-2">{L('Vendedor', 'Salesperson')}</th>
                <th className="text-left px-3 py-2">{L('Estado', 'Status')}</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const meta = STATUS_META[r.status] || STATUS_META.active
                const hrs = hoursUntil(r.expires_at)
                const isUrgent = r.status === 'active' && hrs <= 24
                return (
                  <tr key={r.id} className="border-t border-black/10 hover:bg-black/5">
                    <td className="px-3 py-2 font-semibold">{clientLabel(r)}</td>
                    <td className="px-3 py-2">{unitLabel(r.vehicle_inventory_supabase_id)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1"><DollarSign size={12} className="opacity-60" />{fmtRD(r.deposit_amount)}</span>
                      {r.deposit_method && <div className="text-[10px] text-black/50 capitalize">{r.deposit_method}</div>}
                    </td>
                    <td className={`px-3 py-2 ${isUrgent ? 'text-[#b3001e] font-semibold' : ''}`}>
                      {fmtDT(r.expires_at)}
                      {isUrgent && <div className="text-[10px]">{hrs < 0 ? L('Vencida', 'Overdue') : L('< 24h', '< 24h')}</div>}
                    </td>
                    <td className="px-3 py-2">{sellerLabel(r)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>
                        {lang === 'es' ? meta.es : meta.en}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.status === 'active' && (
                        <>
                          {filter === 'soon' && (() => {
                            const cli = clients.find(x => x.supabase_id === r.client_supabase_id) || clients.find(x => x.id === r.client_id)
                            const veh = units.find(x => x.supabase_id === r.vehicle_inventory_supabase_id)
                            return cli?.phone ? (
                              <button
                                onClick={() => {
                                  const ok = sendReservationExpiring(r, cli, veh)
                                  if (!ok) alert(L('Cliente sin telefono valido.', 'Client has no valid phone.'))
                                }}
                                title={L('Recordar al cliente por WhatsApp', 'Remind client on WhatsApp')}
                                className="p-1 mr-1 border border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white inline-flex items-center"
                              >
                                <MessageCircle size={12}/>
                              </button>
                            ) : null
                          })()}
                          <button onClick={() => convertToDeal(r)} title={L('Convertir a trato', 'Convert to deal')} className="px-2 py-0.5 text-xs bg-[#b3001e] text-white mr-1 inline-flex items-center gap-1">
                            <ArrowRightCircle size={12} />{L('Trato', 'Deal')}
                          </button>
                          <button onClick={() => { setEditing(r); setShowModal(true) }} title={L('Editar', 'Edit')} className="p-1 hover:bg-black hover:text-white mr-1"><Pencil size={14} /></button>
                          <button onClick={() => setReleaseRow(r)} title={L('Liberar', 'Release')} className="p-1 hover:bg-[#b3001e] hover:text-white"><Trash2 size={14} /></button>
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

      {showModal && (
        <ReservationModal
          initial={editing}
          units={units}
          clients={clients}
          staff={staff}
          lang={lang}
          onSave={save}
          onClose={() => { setShowModal(false); setEditing(null) }}
        />
      )}
      {releaseRow && (
        <ReleaseModal
          row={releaseRow}
          lang={lang}
          onConfirm={(reason) => release(releaseRow, reason)}
          onClose={() => setReleaseRow(null)}
        />
      )}
    </div>
  )
}
