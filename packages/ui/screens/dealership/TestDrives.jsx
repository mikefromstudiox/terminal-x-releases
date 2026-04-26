/**
 * TestDrives.jsx — Dealership test-drive log.
 * Links client + vehicle_inventory unit + staff. Stores waiver URL.
 */

import { useState, useEffect } from 'react'
import { Plus, X, Loader2, Check, Trash2, Car as CarIcon, Trophy, Frown, Phone, MessageCircle } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { sendTestDriveReminder } from '../../../services/whatsapp-dealership.js'

function fmtDT(s) {
  if (!s) return '—'
  return new Date(s).toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const OUTCOMES = [
  { v: 'sold',      es: 'Vendido',     en: 'Sold',     icon: Trophy, cls: 'bg-black text-white' },
  { v: 'follow_up', es: 'Seguimiento', en: 'Follow-up', icon: Phone,  cls: 'bg-white text-black border border-black' },
  { v: 'lost',      es: 'Perdido',     en: 'Lost',     icon: Frown,  cls: 'bg-[#b3001e] text-white' },
]

function TDModal({ lang, onSave, onClose, clients, units, staff }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    client_id: '', client_supabase_id: '',
    vehicle_inventory_id: '', vehicle_inventory_supabase_id: '',
    staff_id: '', staff_supabase_id: '',
    scheduled_at: new Date().toISOString().slice(0, 16),
    license_number: '', signed_waiver_url: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!form.client_id || !form.vehicle_inventory_id) return
    // C6 — DR Ley 146-02 requires verified license + signed waiver before drive.
    const cedRgx  = /^\d{3}-\d{7}-\d$/
    const passRgx = /^[A-Z0-9]{6,12}$/i
    const lic = (form.license_number || '').trim()
    if (!lic || !(cedRgx.test(lic) || passRgx.test(lic))) {
      alert('Cedula (formato 000-0000000-0) o pasaporte requerido para registrar prueba de manejo.')
      return
    }
    const waiver = (form.signed_waiver_url || '').trim()
    if (!waiver || !/^https?:\/\//i.test(waiver)) {
      alert('Waiver firmado (URL https) es requerido por Ley 146-02 antes de la prueba de manejo.')
      return
    }
    setSaving(true)
    const client = clients.find(c => c.id === form.client_id)
    const unit   = units.find(u => u.id === form.vehicle_inventory_id)
    const emp    = staff.find(s => s.id === form.staff_id)
    try {
      await onSave({
        ...form,
        license_number: lic,
        signed_waiver_url: waiver,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        client_supabase_id: client?.supabase_id || null,
        vehicle_inventory_supabase_id: unit?.supabase_id || null,
        staff_supabase_id: emp?.supabase_id || null,
      })
      onClose()
    } catch { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold">{L('Nueva Prueba de Manejo', 'New Test Drive')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <label className="block"><span className="text-xs font-semibold">{L('Cliente', 'Client')}*</span>
            <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} required className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">{L('Seleccionar...', 'Select...')}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Vehículo', 'Vehicle')}*</span>
            <select value={form.vehicle_inventory_id} onChange={e => setForm(f => ({ ...f, vehicle_inventory_id: e.target.value }))} required className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">{L('Seleccionar...', 'Select...')}</option>
              {units.filter(u => u.status === 'available' || u.status === 'reserved').map(u => <option key={u.id} value={u.id}>{u.year} {u.make} {u.model} {u.stock_number ? `· #${u.stock_number}` : ''}{u.status === 'reserved' ? ' · (Reservado)' : ''}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Vendedor', 'Salesperson')}</span>
            <select value={form.staff_id} onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">—</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Fecha / Hora', 'Date / Time')}</span>
            <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Cedula o Pasaporte', 'ID or Passport')}*</span>
            <input value={form.license_number} onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))} placeholder="000-0000000-0" required className="mt-1 w-full border border-black px-2 py-1.5 font-mono" />
            <span className="block mt-0.5 text-[10px] text-black/60">{L('Requerido por Ley 146-02.', 'Required by Ley 146-02.')}</span>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('URL del Descargo Firmado (Waiver)', 'Signed Waiver URL')}*</span>
            <input type="url" value={form.signed_waiver_url} onChange={e => setForm(f => ({ ...f, signed_waiver_url: e.target.value }))} placeholder="https://..." required className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-black">{L('Cancelar', 'Cancel')}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-black text-white disabled:opacity-50 inline-flex items-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />}{L('Guardar', 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function TestDrives() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [rows, setRows] = useState([])
  const [clients, setClients] = useState([])
  const [units, setUnits] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  async function load() {
    setLoading(true)
    const [r, c, u, s] = await Promise.all([
      api.testDrives.list(),
      api.clients?.list?.() || Promise.resolve([]),
      api.vehicleInventory.list(),
      api.empleados?.list?.() || Promise.resolve([]),
    ])
    setRows(r || []); setClients(c || []); setUnits(u || []); setStaff(s || [])
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  async function save(data) { await api.testDrives.create(data); await load() }
  async function complete(id) {
    const notes = prompt(L('Notas del recorrido:', 'Drive notes:')) || ''
    await api.testDrives.complete(id, notes); await load()
  }
  async function setOutcome(td, outcome) {
    const notes = prompt(L('Notas del resultado (opcional):', 'Outcome notes (optional):'), td.outcome_notes || '') || ''
    // C6 — for follow_up the lead must be created BEFORE flipping outcome,
    // otherwise a partial state ships (drive marked completed, no lead row).
    if (outcome === 'follow_up' && td.client_id) {
      try {
        await api.leads.create({
          name: td.clients?.name || L('Cliente', 'Client'),
          phone: td.clients?.phone || null,
          source: 'walk_in',
          stage: 'negotiation',
          notes: `${L('Seguimiento desde prueba de manejo', 'Follow-up from test drive')}: ${notes}`.trim(),
          next_followup_at: new Date(Date.now() + 3 * 86400000).toISOString(),
        })
      } catch (e) {
        alert(L('No se pudo crear el prospecto de seguimiento. La prueba NO se marco completada. ', 'Lead create failed. The test drive was NOT marked completed. ') + (e?.message || ''))
        return
      }
    }
    await api.testDrives.setOutcome(td.id, { outcome, outcomeNotes: notes })
    await load()
  }
  async function remove(r) {
    if (!confirm(L('¿Eliminar registro?', 'Delete record?'))) return
    await api.testDrives.delete(r.id); await load()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3"><CarIcon size={32} />{L('Pruebas de Manejo', 'Test Drives')}</h1>
          <p className="text-sm text-black/70 mt-1">{L('Registro con descargo firmado y licencia del cliente.', 'Log with signed waiver and client license.')}</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2"><Plus size={18} />{L('Nueva Prueba', 'New Test Drive')}</button>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : rows.length === 0 ? (
        <div className="border border-black p-12 text-center">{L('Sin registros.', 'No records.')}</div>
      ) : (
        <div className="border border-black overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">{L('Fecha', 'Date')}</th>
                <th className="text-left px-3 py-2">{L('Cliente', 'Client')}</th>
                <th className="text-left px-3 py-2">{L('Vehículo', 'Vehicle')}</th>
                <th className="text-left px-3 py-2">{L('Licencia', 'License')}</th>
                <th className="text-left px-3 py-2">{L('Estado', 'Status')}</th>
                <th className="text-left px-3 py-2">{L('Resultado', 'Outcome')}</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const unit = units.find(u => u.id === r.vehicle_inventory_id)
                return (
                  <tr key={r.id} className="border-t border-black/10 hover:bg-black/5">
                    <td className="px-3 py-2">{fmtDT(r.scheduled_at)}</td>
                    <td className="px-3 py-2 font-semibold">{r.clients?.name || '—'}</td>
                    <td className="px-3 py-2">{unit ? `${unit.year} ${unit.make} ${unit.model}` : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.license_number || '—'}</td>
                    <td className="px-3 py-2">{r.completed_at
                      ? <span className="inline-flex items-center gap-1 text-xs font-semibold"><Check size={12}/>{L('Completada', 'Completed')}</span>
                      : <span className="text-xs">{L('Programada', 'Scheduled')}</span>}</td>
                    <td className="px-3 py-2">
                      {r.outcome ? (() => {
                        const o = OUTCOMES.find(x => x.v === r.outcome)
                        if (!o) return null
                        const Icon = o.icon
                        return <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold ${o.cls}`}><Icon size={10}/>{lang === 'es' ? o.es : o.en}</span>
                      })() : (
                        <div className="flex gap-1">
                          {OUTCOMES.map(o => {
                            const Icon = o.icon
                            return <button key={o.v} onClick={() => setOutcome(r, o.v)} title={lang==='es'?o.es:o.en} className={`p-1 text-xs ${o.cls} opacity-70 hover:opacity-100`}><Icon size={10}/></button>
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!r.completed_at && r.clients?.phone && (
                        <button
                          onClick={() => {
                            const ok = sendTestDriveReminder(r, r.clients)
                            if (!ok) alert(L('Cliente sin telefono valido.', 'Client has no valid phone.'))
                          }}
                          title={L('Enviar recordatorio por WhatsApp', 'Send WhatsApp reminder')}
                          className="px-2 py-0.5 text-xs border border-black mr-1 inline-flex items-center gap-1 hover:bg-emerald-600 hover:text-white hover:border-emerald-600"
                        >
                          <MessageCircle size={11}/>{L('Recordar', 'Remind')}
                        </button>
                      )}
                      {!r.completed_at && <button onClick={() => complete(r.id)} className="px-2 py-0.5 text-xs bg-black text-white mr-1">{L('Completar', 'Complete')}</button>}
                      <button onClick={() => remove(r)} className="p-1 hover:bg-[#b3001e] hover:text-white"><Trash2 size={14}/></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <TDModal lang={lang} clients={clients} units={units} staff={staff} onSave={save} onClose={() => setShowModal(false)} />}
    </div>
  )
}
