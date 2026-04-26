/**
 * Matriculas.jsx — Concesionario INTRANT matricula / traspaso tracker (v2.16.2).
 *
 * Joins closed sales_deals with vehicle_titulo rows (left join in JS by
 * sales_deal_supabase_id). Empty state renders when there are no closed deals.
 * Edit modal upserts `placa`, `intrant_status`, `matricula_url`, `notes`.
 *
 * Matches the visual style of TestDrives.jsx — black/white surface, crimson
 * #b3001e accent on count badge + destructive actions.
 */

import { useState, useEffect, useMemo } from 'react'
import { Loader2, X, Edit3, FileText, ExternalLink, MessageCircle } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { sendMatriculaReady } from '../../../services/whatsapp-dealership.js'

const INTRANT_STATUS = [
  { v: 'pendiente',   es: 'Pendiente',   en: 'Pending',     cls: 'bg-white text-black border border-black' },
  { v: 'en_tramite',  es: 'En tramite',  en: 'In progress', cls: 'bg-black text-white' },
  { v: 'entregada',   es: 'Entregada',   en: 'Delivered',   cls: 'bg-black text-white' },
  { v: 'rechazada',   es: 'Rechazada',   en: 'Rejected',    cls: 'bg-[#b3001e] text-white' },
]

function fmtDT(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '—' }
}

function statusChip(status, lang) {
  const s = INTRANT_STATUS.find(x => x.v === status) || INTRANT_STATUS[0]
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{lang === 'es' ? s.es : s.en}</span>
}

function EditModal({ lang, deal, units, current, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    placa:           current?.placa || '',
    intrant_status:  current?.intrant_status || 'pendiente',
    matricula_url:   current?.matricula_url || '',
    notes:           current?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const unit = units.find(u => u.supabase_id === deal.vehicle_inventory_supabase_id)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const url = (form.matricula_url || '').trim()
    if (url && !/^https?:\/\//i.test(url)) {
      setErr(L('La URL de la matricula debe comenzar con https://', 'Matricula URL must start with https://'))
      return
    }
    setSaving(true)
    try {
      await onSave({
        id: current?.id || undefined,
        sales_deal_supabase_id: deal.supabase_id,
        vehicle_inventory_supabase_id: deal.vehicle_inventory_supabase_id || null,
        placa: form.placa.trim() || null,
        intrant_status: form.intrant_status,
        matricula_url: url || null,
        notes: form.notes.trim() || null,
        traspaso_initiated_at: form.intrant_status === 'en_tramite' && !current?.traspaso_initiated_at
          ? new Date().toISOString() : current?.traspaso_initiated_at,
        traspaso_completed_at: form.intrant_status === 'entregada'
          ? (current?.traspaso_completed_at || new Date().toISOString())
          : current?.traspaso_completed_at || null,
      })
      onClose()
    } catch (e) {
      setErr(e?.message || L('Error al guardar.', 'Save failed.'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold">{L('Matricula y Traspaso', 'Title and Transfer')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div className="text-xs text-black/70">
            <div><strong>{L('Cliente', 'Client')}:</strong> {deal.clients?.name || '—'}</div>
            <div><strong>{L('Vehiculo', 'Vehicle')}:</strong> {unit ? `${unit.year || ''} ${unit.make || ''} ${unit.model || ''}`.trim() : '—'}</div>
            <div><strong>{L('Cierre', 'Closed')}:</strong> {fmtDT(deal.closed_at)}</div>
          </div>
          <label className="block"><span className="text-xs font-semibold">{L('Placa', 'Plate')}</span>
            <input value={form.placa} onChange={e => setForm(f => ({ ...f, placa: e.target.value.toUpperCase() }))} placeholder="A123456" className="mt-1 w-full border border-black px-2 py-1.5 font-mono" maxLength={10} />
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Estado INTRANT', 'INTRANT Status')}*</span>
            <select value={form.intrant_status} onChange={e => setForm(f => ({ ...f, intrant_status: e.target.value }))} required className="mt-1 w-full border border-black px-2 py-1.5">
              {INTRANT_STATUS.map(s => <option key={s.v} value={s.v}>{lang === 'es' ? s.es : s.en}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('URL de la Matricula (PDF firmado)', 'Matricula URL (signed PDF)')}</span>
            <input type="url" value={form.matricula_url} onChange={e => setForm(f => ({ ...f, matricula_url: e.target.value }))} placeholder="https://..." className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          {err && <div className="text-xs text-[#b3001e] font-semibold">{err}</div>}
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

export default function Matriculas() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [deals, setDeals] = useState([])
  const [titulos, setTitulos] = useState([])
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // { deal, current }

  async function load() {
    setLoading(true)
    try {
      const [d, t, u] = await Promise.all([
        api.salesDeals?.list?.({ status: 'closed' }) || Promise.resolve([]),
        api.vehicleTitulo?.list?.() || Promise.resolve([]),
        api.vehicleInventory?.list?.() || Promise.resolve([]),
      ])
      setDeals(d || [])
      setTitulos(t || [])
      setUnits(u || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  // Left join in JS by sales_deal_supabase_id
  const tituloByDeal = useMemo(() => {
    const m = new Map()
    for (const tt of titulos) if (tt.sales_deal_supabase_id) m.set(tt.sales_deal_supabase_id, tt)
    return m
  }, [titulos])

  const pendientesCount = useMemo(() => {
    return deals.reduce((acc, d) => {
      const tt = tituloByDeal.get(d.supabase_id)
      const status = tt?.intrant_status || 'pendiente'
      return acc + (status !== 'entregada' ? 1 : 0)
    }, 0)
  }, [deals, tituloByDeal])

  async function save(data) {
    await api.vehicleTitulo.upsert(data)
    await load()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <FileText size={32} />{L('Matriculas y Traspasos', 'Titles and Transfers')}
            {pendientesCount > 0 && (
              <span className="text-sm font-bold bg-[#b3001e] text-white px-2 py-0.5">
                {pendientesCount} {L('pendientes', 'pending')}
              </span>
            )}
          </h1>
          <p className="text-sm text-black/70 mt-1">{L('Seguimiento del traspaso INTRANT por cada venta cerrada.', 'INTRANT transfer tracking for every closed sale.')}</p>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : deals.length === 0 ? (
        <div className="border border-black p-12 text-center text-sm">{L('Sin tratos cerrados todavia.', 'No closed deals yet.')}</div>
      ) : (
        <div className="border border-black overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">{L('Cliente', 'Client')}</th>
                <th className="text-left px-3 py-2">{L('Vehiculo', 'Vehicle')}</th>
                <th className="text-left px-3 py-2">{L('Placa', 'Plate')}</th>
                <th className="text-left px-3 py-2">{L('Estado INTRANT', 'INTRANT Status')}</th>
                <th className="text-left px-3 py-2">{L('Cierre', 'Closed')}</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {deals.map(d => {
                const tt = tituloByDeal.get(d.supabase_id)
                const unit = units.find(u => u.supabase_id === d.vehicle_inventory_supabase_id)
                return (
                  <tr key={d.id} className="border-t border-black/10 hover:bg-black/5">
                    <td className="px-3 py-2 font-semibold">{d.clients?.name || '—'}</td>
                    <td className="px-3 py-2">{unit ? `${unit.year || ''} ${unit.make || ''} ${unit.model || ''}`.trim() : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{tt?.placa || '—'}</td>
                    <td className="px-3 py-2">{statusChip(tt?.intrant_status || 'pendiente', lang)}</td>
                    <td className="px-3 py-2">{fmtDT(d.closed_at)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {tt?.intrant_status === 'entregada' && d.clients?.phone && (
                        <button
                          onClick={() => {
                            const ok = sendMatriculaReady({ vehicle: unit }, d.clients)
                            if (!ok) alert(L('Cliente sin telefono valido.', 'Client has no valid phone.'))
                          }}
                          title={L('Avisar al cliente por WhatsApp', 'Notify client on WhatsApp')}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs border border-emerald-600 text-emerald-700 mr-1 hover:bg-emerald-600 hover:text-white"
                        >
                          <MessageCircle size={10} />{L('Avisar al cliente', 'Notify client')}
                        </button>
                      )}
                      {tt?.matricula_url && (
                        <a href={tt.matricula_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 text-xs border border-black mr-1 hover:bg-black hover:text-white">
                          <ExternalLink size={10} />{L('PDF', 'PDF')}
                        </a>
                      )}
                      <button onClick={() => setEditing({ deal: d, current: tt || null })} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-black text-white">
                        <Edit3 size={10} />{L('Editar', 'Edit')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal
          lang={lang}
          deal={editing.deal}
          current={editing.current}
          units={units}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
