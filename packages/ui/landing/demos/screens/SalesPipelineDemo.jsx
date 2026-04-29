// SalesPipelineDemo — faithful copy of dealership/SalesPipeline.jsx kanban.
// 5 stages (lead → test_drive → negotiation → financing → closed). Lead
// scoring with Hot/Warm/Cold heat badge. Click card to edit. Same brutalist
// black-bordered style as the rest of dealership.

import { useState, useMemo } from 'react'
import { Plus, X, User, Phone, Car, DollarSign, Trash2, ChevronRight, ChevronLeft, AlertTriangle, Calendar, MessageCircle, Flame } from 'lucide-react'

const STAGES = [
  { v: 'lead',         label: 'Prospecto' },
  { v: 'test_drive',   label: 'Prueba de Manejo' },
  { v: 'negotiation',  label: 'Negociación' },
  { v: 'financing',    label: 'Financiamiento' },
  { v: 'closed',       label: 'Cerrado' },
]
const SOURCES = [
  { v: 'walk_in',  label: 'Visita en Local' },
  { v: 'whatsapp', label: 'WhatsApp' },
  { v: 'web',      label: 'Web' },
  { v: 'referral', label: 'Referido' },
  { v: 'other',    label: 'Otro' },
]

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }) }
function isOverdue(lead) {
  if (!lead.next_followup_at || lead.stage === 'closed' || lead.stage === 'lost') return false
  return new Date(lead.next_followup_at).getTime() < Date.now()
}
function scoreLead(lead) {
  let s = 0
  if (Number(lead.budget) > 0) s += 20
  if (lead.stage === 'negotiation' || lead.stage === 'financing') s += 20
  if (lead.phone) s += 10
  if (lead.testDrove) s += 30
  if (isOverdue(lead)) s -= 30; else s += 20
  return Math.max(0, Math.min(100, s))
}
function leadHeat(score) {
  if (score >= 70) return { label: 'Caliente', color: 'bg-[#b3001e] text-white' }
  if (score >= 40) return { label: 'Tibio',    color: 'bg-amber-500 text-white' }
  return                  { label: 'Frio',     color: 'bg-slate-400 text-white' }
}

const SEED = [
  { id: 1, name: 'Roberto Castillo',     phone: '809-555-1010', source: 'walk_in', budget: 1500000, stage: 'financing',   testDrove: true,  next_followup_at: '2026-04-29', vehicle: 'Toyota Corolla XLE 2024', notes: 'Pre-aprobacion BHD pendiente' },
  { id: 2, name: 'Empresa Logistics',    phone: '809-555-2020', source: 'web',     budget: 3000000, stage: 'negotiation', testDrove: false, next_followup_at: '2026-04-28', vehicle: 'Ford F-150 XLT 2022',     notes: 'Compra flota 2 unidades' },
  { id: 3, name: 'Maria Sanchez',        phone: '829-555-3030', source: 'whatsapp', budget: 2200000, stage: 'test_drive',  testDrove: false, next_followup_at: '2026-04-27', vehicle: 'Hyundai Tucson Limited 2024', notes: 'Quiere ver opciones color' },
  { id: 4, name: 'Ana Reyes',            phone: '849-555-4040', source: 'referral', budget: 1900000, stage: 'test_drive',  testDrove: false, next_followup_at: '2026-04-30', vehicle: 'Mazda CX-5 Touring 2024', notes: 'Interesada ceramica' },
  { id: 5, name: 'Pedro Vasquez',        phone: '809-555-5050', source: 'walk_in', budget: 0,        stage: 'lead',         testDrove: false, next_followup_at: null,         vehicle: '—', notes: '' },
  { id: 6, name: 'Luis Almonte',         phone: '829-555-6060', source: 'whatsapp', budget: 1300000, stage: 'lead',         testDrove: false, next_followup_at: '2026-04-26', vehicle: 'Kia Sportage EX',        notes: '' },
  { id: 7, name: 'Carmen Diaz',          phone: '849-555-7070', source: 'web',     budget: 2800000, stage: 'closed',       testDrove: true,  next_followup_at: null,         vehicle: 'Chevrolet Tahoe LT 2023', notes: 'Cerrado · 22 abril' },
  { id: 8, name: 'Hotel Atlantico',      phone: '809-555-8080', source: 'referral', budget: 5000000, stage: 'lead',         testDrove: false, next_followup_at: '2026-04-25', vehicle: 'Suburban', notes: 'Necesita 3 unidades para flota' },
]

function LeadCard({ lead, onClick }) {
  const score = scoreLead(lead)
  const heat = leadHeat(score)
  const overdue = isOverdue(lead)
  return (
    <button onClick={onClick}
      className={`w-full text-left bg-white border ${overdue ? 'border-red-500' : 'border-black/30'} hover:border-black p-3 transition-colors`}>
      <div className="flex items-start justify-between mb-1">
        <p className="font-bold text-sm text-black truncate flex-1">{lead.name}</p>
        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 ${heat.color} inline-flex items-center gap-1`}>
          <Flame size={9} /> {heat.label}
        </span>
      </div>
      {lead.vehicle !== '—' && <p className="text-[11px] text-black/60 truncate"><Car size={10} className="inline mr-1" />{lead.vehicle}</p>}
      <div className="flex items-center gap-3 mt-2 text-[10px] text-black/50">
        {lead.budget > 0 && <span className="font-mono"><DollarSign size={9} className="inline" />{fmtRD(lead.budget)}</span>}
        {lead.next_followup_at && (
          <span className={overdue ? 'text-red-600 font-bold' : ''}>
            <Calendar size={9} className="inline mr-0.5" />{fmtDate(lead.next_followup_at)}
            {overdue && <AlertTriangle size={9} className="inline ml-0.5" />}
          </span>
        )}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-black/40 mt-1.5 inline-flex items-center gap-1">
        <Phone size={8} /> {lead.phone}
      </div>
    </button>
  )
}

export default function SalesPipelineDemo() {
  const [leads, setLeads] = useState(SEED)
  const [editing, setEditing] = useState(null)

  const grouped = useMemo(() => {
    const g = {}
    STAGES.forEach(s => { g[s.v] = [] })
    leads.forEach(l => { (g[l.stage] || (g[l.stage] = [])).push(l) })
    return g
  }, [leads])

  function move(id, dir) {
    setLeads(ls => ls.map(l => {
      if (l.id !== id) return l
      const idx = STAGES.findIndex(s => s.v === l.stage)
      const next = STAGES[Math.max(0, Math.min(STAGES.length - 1, idx + dir))]
      return { ...l, stage: next.v }
    }))
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto h-full overflow-hidden flex flex-col">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-black">Pipeline de Ventas</h1>
          <p className="text-sm text-black/70 mt-1">{leads.length} prospectos · {leads.filter(isOverdue).length} con seguimiento vencido</p>
        </div>
        <button onClick={() => setEditing({ stage: 'lead' })} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2 hover:bg-slate-800"><Plus size={18} /> Nuevo Prospecto</button>
      </div>

      <div className="grid gap-3 flex-1 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(240px, 1fr))` }}>
        {STAGES.map(stage => {
          const cards = grouped[stage.v] || []
          return (
            <div key={stage.v} className="border border-black flex flex-col bg-slate-50/30 min-h-0">
              <div className="bg-black text-white px-3 py-2 flex items-center justify-between sticky top-0 z-10">
                <span className="text-[12px] font-bold uppercase tracking-wider">{stage.label}</span>
                <span className="text-[10px] font-bold bg-white text-black px-1.5 py-0.5">{cards.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {cards.map(l => <LeadCard key={l.id} lead={l} onClick={() => setEditing(l)} />)}
                {cards.length === 0 && <p className="text-center text-[11px] text-black/30 py-4">—</p>}
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white border border-black max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-black">
              <h2 className="text-xl font-bold">{editing.id ? 'Editar Prospecto' : 'Nuevo Prospecto'}</h2>
              <button onClick={() => setEditing(null)} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <label className="block"><span className="text-xs font-semibold">Nombre *</span><input defaultValue={editing.name} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-xs font-semibold">Teléfono</span><input defaultValue={editing.phone} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
                <label className="block"><span className="text-xs font-semibold">Email</span><input className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-xs font-semibold">Origen</span><select defaultValue={editing.source} className="mt-1 w-full border border-black px-2 py-1.5">{SOURCES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}</select></label>
                <label className="block"><span className="text-xs font-semibold">Presupuesto RD$</span><input type="number" defaultValue={editing.budget} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              </div>
              <label className="block"><span className="text-xs font-semibold flex items-center gap-1"><Calendar size={12} /> Próximo Seguimiento</span><input type="date" defaultValue={editing.next_followup_at} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block"><span className="text-xs font-semibold">Vehículo de interés</span><input defaultValue={editing.vehicle} className="mt-1 w-full border border-black px-2 py-1.5" /></label>
              <label className="block"><span className="text-xs font-semibold">Notas</span><textarea rows={3} defaultValue={editing.notes} className="mt-1 w-full border border-black px-2 py-1.5 resize-none" /></label>
              {editing.id && (
                <div className="flex gap-1 pt-2">
                  <button onClick={() => move(editing.id, -1)} className="flex-1 inline-flex items-center justify-center gap-1 border border-black px-3 py-2 text-xs font-bold hover:bg-slate-50"><ChevronLeft size={13} /> Atrás</button>
                  <button onClick={() => move(editing.id, 1)} className="flex-1 inline-flex items-center justify-center gap-1 border border-black px-3 py-2 text-xs font-bold hover:bg-slate-50">Avanzar etapa <ChevronRight size={13} /></button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-black">
              {editing.id && <button className="mr-auto px-3 py-2 inline-flex items-center gap-1.5 text-red-700 hover:bg-red-50 text-sm"><Trash2 size={13} /> Eliminar</button>}
              <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-black text-sm hover:bg-slate-50"><MessageCircle size={13} /> WhatsApp</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-black text-white hover:bg-slate-800 text-sm font-bold">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
