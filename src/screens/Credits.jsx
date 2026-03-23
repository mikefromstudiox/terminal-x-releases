import { useState, useEffect, useCallback } from 'react'
import {
  Search, Plus, X, CreditCard, Banknote, Smartphone, ArrowLeftRight,
  CheckCircle2, AlertTriangle, Phone, Mail, MapPin, Loader2,
  Check, ChevronRight, StickyNote, RefreshCw,
} from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI } from '../context/DataContext'
import { useRNC } from '../hooks/useRNC'
import { printCreditPayment } from '../services/printer'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRD(n) {
  return `RD$ ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function initials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}
// ── Sub-components ────────────────────────────────────────────────────────────

function Avatar({ name, overLimit, size = 40 }) {
  const bg = overLimit ? 'bg-red-500' : 'bg-[#0C447C]'
  return (
    <div className={`${bg} rounded-full flex items-center justify-center shrink-0 text-white font-bold select-none`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {initials(name)}
    </div>
  )
}

function CreditBar({ balance, limit, height = 'h-1.5' }) {
  const pct = limit > 0 ? Math.min((balance / limit) * 100, 100) : 0
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div className={`w-full bg-slate-100 rounded-full ${height} overflow-hidden`}>
      <div className={`${color} ${height} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── New Client slide-in panel ─────────────────────────────────────────────────

function NewClientPanel({ onClose, onSaved }) {
  const api = useAPI()
  const { lookup: rncLookup, lookupLoading: rncLoading } = useRNC()
  const [form, setForm]     = useState({ name:'', rnc:'', phone:'', email:'', address:'', credit_limit:'', notes:'' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function lookupRNC() {
    const clean = form.rnc.replace(/\D/g, '')
    if (clean.length < 9) return
    const res = await rncLookup(clean)
    if (res?.nombre) set('name', res.nombre)
    else if (res?.name) set('name', res.name)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('El nombre es requerido.'); return }
    const limit = parseFloat(form.credit_limit) || 0
    setSaving(true); setError('')
    try {
      await api.clients.create({
        name:         form.name.trim(),
        rnc:          form.rnc.trim(),
        phone:        form.phone.trim(),
        email:        form.email.trim(),
        address:      form.address.trim(),
        credit_limit: limit,
        notes:        form.notes.trim(),
      })
      onSaved()
    } catch (e) {
      setError(e.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { k:'name',         label:'Nombre / Empresa *', ph:'Importadora Del Norte SRL', type:'text' },
    { k:'phone',        label:'Teléfono',           ph:'809-555-0000',              type:'text' },
    { k:'email',        label:'Email',              ph:'contacto@empresa.com',      type:'email' },
    { k:'address',      label:'Dirección',          ph:'Av. Winston Churchill 1099',type:'text' },
    { k:'credit_limit', label:'Límite de Crédito',  ph:'10000',                    type:'number' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full md:w-[380px] bg-white h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-[15px] font-bold text-slate-800">Nuevo Cliente</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* RNC with lookup */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">RNC</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.rnc}
                onChange={e => set('rnc', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && lookupRNC()}
                placeholder="130-12345-6"
                className="flex-1 min-w-0"
              />
              <button
                onClick={lookupRNC}
                disabled={rncLoading}
                className="px-3 py-2 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl text-[12px] font-semibold text-sky-700 transition-colors whitespace-nowrap min-h-[44px]"
              >
                {rncLoading ? '...' : 'Buscar'}
              </button>
            </div>
          </div>

          {fields.map(f => (
            <div key={f.k}>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">{f.label}</label>
              <input
                type={f.type}
                value={form[f.k]}
                onChange={e => set(f.k, e.target.value)}
                placeholder={f.ph}
              />
            </div>
          ))}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Observaciones internas…"
              rows={3}
              className="resize-none"
            />
          </div>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 pb-20 md:pb-4 border-t border-slate-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 md:py-2.5 bg-[#0C447C] hover:bg-[#0a3a6b] disabled:opacity-60 text-white font-bold rounded-xl text-[13px] transition-colors flex items-center justify-center gap-2 min-h-[44px]"
          >
            {saving ? <><Loader2 size={14} className="animate-spin" /> Guardando…</> : 'Guardar Cliente'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Client list card ──────────────────────────────────────────────────────────

function ClientCard({ client, selected, onClick }) {
  const overLimit = client.balance > client.credit_limit && client.credit_limit > 0
  const pct       = client.credit_limit > 0 ? Math.round((client.balance / client.credit_limit) * 100) : 0
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-100 transition-colors ${
        selected ? 'bg-[#f0f6ff] border-l-2 border-l-[#378ADD]' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <Avatar name={client.name} overLimit={overLimit} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[13px] font-bold text-slate-800 truncate">{client.name}</p>
            {overLimit && (
              <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full leading-none">
                EXCEDIDO
              </span>
            )}
          </div>
          {client.rnc   && <p className="text-[11px] text-slate-400 mt-0.5">RNC: {client.rnc}</p>}
          {client.phone && <p className="text-[11px] text-slate-400">{client.phone}</p>}
          <div className="mt-1.5">
            <CreditBar balance={client.balance} limit={client.credit_limit} />
            <div className="flex items-center justify-between mt-0.5">
              <p className="text-[10px] text-slate-500 font-medium">{fmtRD(client.balance)} adeudado</p>
              <p className="text-[10px] text-slate-400">{pct}%</p>
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}

// ── Payment form ──────────────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { id:'cash',     label:'Efectivo',     icon: Banknote      },
  { id:'card',     label:'Tarjeta',      icon: CreditCard    },
  { id:'transfer', label:'Transfer.',    icon: Smartphone    },
  { id:'check',    label:'Cheque',       icon: ArrowLeftRight},
]

function PaymentForm({ total, clientRnc, onPay, paying, isManual = false }) {
  const [ncfType,    setNcfType]    = useState('E32')
  const [rnc,        setRnc]        = useState(clientRnc || '')
  const [method,     setMethod]     = useState('cash')
  const [comentario, setComentario] = useState('')
  const [amount,     setAmount]     = useState(total)

  // Keep amount in sync when total changes (e.g. tickets selected/deselected)
  useEffect(() => { setAmount(total) }, [total])

  function handlePay() {
    const finalAmount = isManual ? (parseFloat(amount) || 0) : total
    if (finalAmount <= 0) return
    onPay({ ncfType, rnc: ncfType === 'E31' ? rnc : '', method, comentario, amount: finalAmount })
  }

  return (
    <div className="border-t border-slate-100 pt-4 space-y-3">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
        {isManual ? 'Registrar Abono Manual' : 'Forma de Cobro'}
      </p>

      {/* Manual amount input when no tickets selected */}
      {isManual && (
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Monto a abonar (RD$)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Ingresa el monto que el cliente está pagando. Se descontará del balance total.
          </p>
        </div>
      )}

      {/* NCF type */}
      <div className="flex gap-2">
        {['E32','E31'].map(t => (
          <button key={t} onClick={() => setNcfType(t)}
            className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
              ncfType === t
                ? 'bg-[#E6F1FB] border-[#0C447C] text-[#0C447C]'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            }`}>
            {t} {t === 'E32' ? '(Consumidor)' : '(Crédito Fiscal)'}
          </button>
        ))}
      </div>

      {/* RNC field for E31 */}
      {ncfType === 'E31' && (
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">RNC del cliente</label>
          <input type="text" value={rnc} onChange={e => setRnc(e.target.value)} placeholder="130-12345-6" />
        </div>
      )}

      {/* Payment method */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        {PAYMENT_METHODS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setMethod(id)}
            className={`flex flex-col items-center gap-1 py-2.5 md:py-2 rounded-xl border text-[11px] font-semibold transition-colors min-h-[48px] ${
              method === id
                ? 'bg-[#E6F1FB] border-[#0C447C] text-[#0C447C]'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            }`}>
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Comentario */}
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Comentario (opcional)</label>
        <input type="text" value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Abono parcial, referencia de cheque…" />
      </div>

      {/* Pay button */}
      <button
        onClick={handlePay}
        disabled={paying || (isManual && (parseFloat(amount) || 0) <= 0)}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold rounded-xl text-[14px] transition-colors flex items-center justify-center gap-2"
      >
        {paying
          ? <><Loader2 size={15} className="animate-spin" /> Procesando…</>
          : <><CheckCircle2 size={15} /> {isManual ? `Abonar ${fmtRD(parseFloat(amount)||0)}` : `Cobrar ${fmtRD(total)}`}</>
        }
      </button>
    </div>
  )
}

// ── Client detail panel ───────────────────────────────────────────────────────

function ClientDetail({ client, onReload }) {
  const api = useAPI()
  const [tickets,  setTickets]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [checked,  setChecked]  = useState(new Set())
  const [paying,   setPaying]   = useState(false)
  const [toast,    setToast]    = useState(null)

  const loadTickets = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api?.clients?.openTickets?.(client.id)
      setTickets(rows || [])
    } catch { setTickets([]) }
    finally  { setLoading(false) }
  }, [client.id])

  useEffect(() => { loadTickets(); setChecked(new Set()) }, [loadTickets])

  const overLimit  = client.balance > client.credit_limit && client.credit_limit > 0
  const available  = Math.max(0, client.credit_limit - client.balance)
  const pct        = client.credit_limit > 0 ? Math.min((client.balance / client.credit_limit) * 100, 100) : 0
  const allChecked = tickets.length > 0 && checked.size === tickets.length
  const selectedTotal = tickets.filter(t => checked.has(t.id)).reduce((s, t) => s + (t.total || 0), 0)

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(tickets.map(t => t.id)))
  }
  function toggleOne(id) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handlePay({ ncfType, rnc, method, comentario, amount: manualAmount }) {
    const ticketIds      = [...checked]
    const selectedTickets = tickets.filter(t => checked.has(t.id))
    const amount         = ticketIds.length > 0 ? selectedTotal : (manualAmount || 0)
    if (amount <= 0) return
    setPaying(true)
    try {
      await api.credits.collect({
        clientId:      client.id,
        ticketIds,
        amount,
        paymentMethod: method,
        ncf:           ncfType,
        notes:         comentario,
        cajeroId:      null,
      })
      setToast(`Cobro registrado — ${fmtRD(amount)}`)
      setTimeout(() => setToast(null), 3000)
      setChecked(new Set())
      await loadTickets()
      onReload()

      // Print credit payment receipt
      try {
        const empresa = await api.admin.getEmpresa().catch(() => ({}))
        const biz = {
          name:    empresa?.nombre    || empresa?.name    || '',
          address: empresa?.direccion || empresa?.address || '',
          phone:   empresa?.telefono  || empresa?.phone   || '',
          rnc:     empresa?.rnc       || '',
        }
        printCreditPayment({
          biz,
          client:     { name: client.name, rnc: client.rnc },
          ncfType,
          formaPago:  method,
          tickets:    selectedTickets,
          amount,
          comentario: comentario || '',
        }).catch(() => {})
      } catch { /* print errors never block the payment flow */ }
    } catch (e) {
      setToast('Error: ' + (e.message || 'No se pudo registrar el cobro.'))
      setTimeout(() => setToast(null), 4000)
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Toast */}
      {toast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-slate-800 text-white text-[12px] font-medium px-4 py-2 rounded-xl shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* Header */}
        <div className="flex items-start gap-3">
          <Avatar name={client.name} overLimit={overLimit} size={44} />
          <div>
            <h2 className="text-[16px] font-bold text-slate-800 leading-tight">{client.name}</h2>
            {client.rnc && <p className="text-[12px] text-slate-400">RNC: {client.rnc}</p>}
          </div>
        </div>

        {/* Contact */}
        <div className="space-y-1.5">
          {client.phone   && <div className="flex items-center gap-2 text-[12px] text-slate-600"><Phone size={12} className="text-slate-400 shrink-0" />{client.phone}</div>}
          {client.email   && <div className="flex items-center gap-2 text-[12px] text-slate-600"><Mail  size={12} className="text-slate-400 shrink-0" />{client.email}</div>}
          {client.address && <div className="flex items-center gap-2 text-[12px] text-slate-600"><MapPin size={12} className="text-slate-400 shrink-0" />{client.address}</div>}
        </div>

        {/* Notes */}
        {client.notes && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <StickyNote size={13} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-800">{client.notes}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label:'Visitas',      value: client.visits || 0 },
            { label:'Total Gastado', value: fmtRD(client.total_spent) },
            { label:'Desde',        value: fmtDate(client.created_at) },
          ].map(s => (
            <div key={s.label} className="bg-slate-50 rounded-xl px-3 py-2.5 text-center">
              <p className="text-[13px] font-bold text-slate-800 leading-tight">{s.value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Credit block */}
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Crédito</span>
            <span className="text-[11px] text-slate-400">Límite: {fmtRD(client.credit_limit)}</span>
          </div>
          <CreditBar balance={client.balance} limit={client.credit_limit} height="h-2" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[18px] font-black text-slate-800">{fmtRD(client.balance)}</p>
              <p className="text-[11px] text-slate-400">Balance adeudado</p>
            </div>
            <div className="text-right">
              <p className={`text-[15px] font-bold ${overLimit ? 'text-red-500' : 'text-emerald-600'}`}>
                {fmtRD(available)}
              </p>
              <p className="text-[11px] text-slate-400">Disponible</p>
            </div>
          </div>
        </div>

        {/* Over-limit alert */}
        {overLimit && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            <AlertTriangle size={14} className="text-red-500 shrink-0" />
            <p className="text-[12px] text-red-700 font-medium">
              Límite de crédito excedido en {fmtRD(client.balance - client.credit_limit)}
            </p>
          </div>
        )}

        {/* ── Ticket list ──────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Tickets Pendientes {tickets.length > 0 && `(${tickets.length})`}
            </p>
            {tickets.length > 0 && (
              <button onClick={toggleAll}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#0C447C] hover:underline">
                <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors ${
                  allChecked ? 'bg-[#0C447C] border-[#0C447C]' : 'border-slate-300'
                }`}>
                  {allChecked && <Check size={8} className="text-white" strokeWidth={3} />}
                </div>
                {allChecked ? 'Quitar todos' : 'Seleccionar todos'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 size={18} className="animate-spin mr-2" />
              <span className="text-[12px]">Cargando tickets…</span>
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-6">
              <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
              <p className="text-[13px] text-slate-500 font-medium">No hay tickets pendientes</p>
              <p className="text-[11px] text-slate-400">Esta cuenta está al día</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map(t => (
                <button key={t.id} onClick={() => toggleOne(t.id)}
                  className={`w-full rounded-xl border text-left transition-colors overflow-hidden ${
                    checked.has(t.id)
                      ? 'bg-[#E6F1FB] border-[#0C447C]/40'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}>
                  {/* Ticket header row */}
                  <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      checked.has(t.id) ? 'bg-[#0C447C] border-[#0C447C]' : 'border-slate-300'
                    }`}>
                      {checked.has(t.id) && <Check size={9} className="text-white" strokeWidth={3} />}
                    </div>
                    <p className="text-[12px] font-bold text-slate-700 flex-1">{t.doc_number}</p>
                    <p className="text-[10px] text-slate-400 shrink-0">{fmtDate(t.created_at)}</p>
                  </div>

                  {/* Item lines */}
                  {t.items && t.items.length > 0 ? (
                    <div className="px-3 pb-2.5 space-y-1 border-t border-slate-100 pt-2">
                      {t.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-600 truncate pr-2">{item.name}</span>
                          <span className="text-[11px] font-semibold text-slate-700 shrink-0 tabular-nums">{fmtRD(item.price)}</span>
                        </div>
                      ))}
                      {/* Ticket subtotal */}
                      <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-200">
                        <span className="text-[10px] text-slate-400">
                          {t.vehicle_plate ? `Vehículo: ${t.vehicle_plate}` : 'Al portador'}
                        </span>
                        <span className="text-[12px] font-black text-slate-800 tabular-nums">{fmtRD(t.total)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 pb-2.5 flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-[11px] text-slate-400">{t.vehicle_plate || 'Al portador'}</span>
                      <span className="text-[12px] font-black text-slate-800">{fmtRD(t.total)}</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Invoice preview — appears when tickets are selected ────────── */}
        {checked.size > 0 && (
          <div className="bg-white border border-[#0C447C]/20 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="bg-[#f0f6ff] px-4 py-2.5 flex items-center justify-between">
              <p className="text-[11px] font-bold text-[#0C447C] uppercase tracking-wider">
                Vista Previa — Factura Consolidada
              </p>
              <span className="text-[10px] bg-[#0C447C] text-white px-2 py-0.5 rounded-full font-bold">
                {checked.size} ticket{checked.size > 1 ? 's' : ''}
              </span>
            </div>

            {/* Line items grouped by ticket */}
            <div className="px-4 py-3 space-y-3">
              {tickets.filter(t => checked.has(t.id)).map((t, idx, arr) => (
                <div key={t.id}>
                  {/* Ticket label */}
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">
                    {t.doc_number} · {fmtDate(t.created_at)}
                    {t.vehicle_plate ? ` · ${t.vehicle_plate}` : ''}
                  </p>
                  {/* Items */}
                  {(t.items || []).map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-0.5">
                      <span className="text-[12px] text-slate-700 truncate pr-3">{item.name}</span>
                      <span className="text-[12px] font-semibold text-slate-700 tabular-nums shrink-0">{fmtRD(item.price)}</span>
                    </div>
                  ))}
                  {/* Ticket total */}
                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-100">
                    <span className="text-[11px] text-slate-400">Subtotal ticket</span>
                    <span className="text-[12px] font-bold text-slate-700 tabular-nums">{fmtRD(t.total)}</span>
                  </div>
                  {idx < arr.length - 1 && <div className="border-t border-dashed border-slate-200 mt-3" />}
                </div>
              ))}

              {/* Grand total */}
              <div className="border-t-2 border-slate-800 pt-2 flex items-center justify-between">
                <p className="text-[13px] font-bold text-slate-800">Total a Cobrar</p>
                <p className="text-[18px] font-black text-slate-800 tabular-nums">{fmtRD(selectedTotal)}</p>
              </div>

              <p className="text-[10px] text-slate-400 text-center">
                Se emitirá <strong>un solo comprobante</strong> por el total de todos los tickets seleccionados
              </p>
            </div>
          </div>
        )}

        {/* ── Payment form ──────────────────────────────────────────────── */}
        {(checked.size > 0 || (client.balance > 0 && tickets.length === 0 && !loading)) && (
          <PaymentForm
            total={checked.size > 0 ? selectedTotal : client.balance}
            clientRnc={client.rnc}
            onPay={handlePay}
            paying={paying}
            isManual={checked.size === 0}
          />
        )}

      </div>
    </div>
  )
}

// ── Main Credits screen ───────────────────────────────────────────────────────

export default function Credits() {
  const api = useAPI()
  const { t } = useLang()
  const [clients,   setClients]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [selectedId,setSelectedId]= useState(null)
  const [showNew,   setShowNew]   = useState(false)

  const loadClients = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api?.clients?.all?.()
      setClients(rows || [])
    } catch { setClients([]) }
    finally  { setLoading(false) }
  }, [])

  useEffect(() => { loadClients() }, [loadClients])

  // Only show clients with a credit limit or existing balance
  const creditClients = clients.filter(c => c.credit_limit > 0 || c.balance > 0)

  const filtered = creditClients.filter(c =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.rnc?.includes(search) ||
    c.phone?.includes(search)
  )

  // Sort: over-limit first, then by balance desc
  const sorted = [...filtered].sort((a, b) => {
    const aOver = a.balance > a.credit_limit && a.credit_limit > 0
    const bOver = b.balance > b.credit_limit && b.credit_limit > 0
    if (aOver !== bOver) return aOver ? -1 : 1
    return b.balance - a.balance
  })

  const selectedClient = clients.find(c => c.id === selectedId) || null

  return (
    <div className="h-full flex flex-col md:flex-row bg-white">

      {/* ── Left panel — client list (hidden on mobile when detail is open) ── */}
      <div className={`border-r border-slate-100 flex flex-col ${
        selectedClient ? 'hidden md:flex w-full md:w-[300px] md:shrink-0' : 'flex flex-1'
      }`}>

        {/* Header */}
        <div className="shrink-0 px-3 py-2.5 md:px-4 md:py-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[14px] font-bold text-slate-800">Cuentas x Cobrar</h2>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0C447C] hover:bg-[#0a3a6b] text-white text-[11px] font-bold rounded-lg transition-colors min-h-[44px]"
            >
              <Plus size={12} /> Nuevo
            </button>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar cliente, RNC, teléfono…"
              className="pl-8"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={18} className="animate-spin mr-2" />
              <span className="text-[12px]">Cargando clientes…</span>
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 px-4">
              <p className="text-[13px] text-slate-400">
                {search ? 'Sin resultados para esta búsqueda.' : 'No hay clientes con límite de crédito o saldo pendiente.'}
              </p>
            </div>
          ) : (
            sorted.map(c => (
              <ClientCard
                key={c.id}
                client={c}
                selected={c.id === selectedId}
                onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right panel — detail (full screen on mobile) ──────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedClient ? (
          <>
            {/* Mobile back button */}
            <div className="md:hidden shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-100">
              <button
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-slate-700 min-h-[44px]"
              >
                <ChevronRight size={16} className="rotate-180" />
                Volver
              </button>
            </div>
            <ClientDetail
              key={selectedClient.id}
              client={selectedClient}
              onReload={loadClients}
            />
          </>
        ) : (
          <div className="hidden md:flex flex-1 flex-col items-center justify-center text-center px-8">
            <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mb-4">
              <CreditCard size={24} className="text-slate-300" />
            </div>
            <p className="text-[14px] font-semibold text-slate-500">Selecciona un cliente</p>
            <p className="text-[12px] text-slate-400 mt-1">
              Haz clic en un cliente de la lista para ver su cuenta y registrar cobros.
            </p>
          </div>
        )}
      </div>

      {/* New client panel */}
      {showNew && (
        <NewClientPanel
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); loadClients() }}
        />
      )}
    </div>
  )
}
