import { useState, useMemo, useEffect } from 'react'
import {
  Search, Plus, X, AlertTriangle, CheckCircle2,
  Phone, MapPin, Mail, CreditCard, Banknote,
  ArrowRightLeft, Landmark, Building2, ChevronRight,
  SquareCheckBig, Square, Loader2, RefreshCw, AlertCircle, Pencil, Trash2,
} from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI } from '../context/DataContext'
import { useClients, useMutation } from '../hooks/useDB'
import { useRNC } from '../hooks/useRNC'
import { printClientReceipt } from '@terminal-x/services/printer'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import { Scissors, Gift, Heart } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + (s.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// Map raw DB client → UI shape
function mapClient(c) {
  return {
    id:          c.id,
    supabase_id: c.supabase_id || null,
    name:        c.name,
    rnc:         c.rnc  || '',
    phone:       c.phone || '',
    address:     c.address || '',
    email:       c.email || '',
    creditLimit: c.credit_limit || 0,
    balance:     c.balance || 0,
    totalVisits: c.visits || 0,
    totalSpent:  c.total_spent || 0,
    lastService: c.last_service_date || null,
    notes:       c.notes || '',
    // v2.4 — Salon-vertical client attributes (ignored by other verticals).
    loyaltyPoints:             Number(c.loyalty_points) || 0,
    allergies:                 c.allergies || '',
    preferredStylistId:        c.preferred_stylist_id || null,
    preferredStylistSupabaseId: c.preferred_stylist_supabase_id || null,
    openTickets: [],
  }
}

// Loyalty tiers for salon clients — UI only. Mapping mirrors Sephora's
// Insider/VIB/Rouge progression but thresholds tuned for DR RD$ spend.
function loyaltyTier(totalSpent) {
  const s = Number(totalSpent) || 0
  if (s >= 50000) return { key: 'rouge',   es: 'Rouge',   en: 'Rouge',   color: 'bg-[#b3001e] text-white' }
  if (s >= 20000) return { key: 'vib',     es: 'VIP',     en: 'VIP',     color: 'bg-amber-400 text-black' }
  if (s >= 5000)  return { key: 'insider', es: 'Insider', en: 'Insider', color: 'bg-slate-800 text-white' }
  return { key: 'new', es: 'Nuevo', en: 'New', color: 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-white/70' }
}

const PAYMENT_METHODS = [
  { id: 'efectivo',      Icon: Banknote,       es: 'Efectivo',      en: 'Cash'     },
  { id: 'tarjeta',       Icon: CreditCard,     es: 'Tarjeta',       en: 'Card'     },
  { id: 'transferencia', Icon: ArrowRightLeft, es: 'Transferencia', en: 'Transfer' },
  { id: 'cheque',        Icon: Landmark,       es: 'Cheque',        en: 'Check'    },
]

// ── Client status helper ──────────────────────────────────────────────────────

function clientStatus(c) {
  if (c.balance > c.creditLimit) return 'overlimit'
  if (c.balance > 0)             return 'owing'
  return 'clear'
}

// ── Client card ───────────────────────────────────────────────────────────────

function ClientCard({ client, selected, onClick, lang }) {
  const status = clientStatus(client)
  const pct    = client.creditLimit > 0 ? Math.min((client.balance / client.creditLimit) * 100, 100) : 0

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-100 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors ${
        selected ? 'bg-sky-50 dark:bg-sky-500/10 border-l-2 border-l-sky-500' : 'border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${
          status === 'overlimit' ? 'bg-red-100 dark:bg-red-500/20 text-red-600'
          : status === 'owing'  ? 'bg-amber-50 dark:bg-amber-500/20 text-amber-700'
          : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60'
        }`}>
          {initials(client.name)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{client.name}</p>
            {status === 'overlimit' && (
              <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/30 rounded-full px-2 py-0.5">
                <AlertTriangle size={9} />
                {lang === 'es' ? 'Límite excedido' : 'Over limit'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
            {client.rnc ? `RNC ${client.rnc} · ` : ''}{client.phone}
          </p>

          {client.creditLimit > 0 && (
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-slate-400 dark:text-white/40 mb-1">
                <span>{fmtRD(client.balance)}</span>
                <span>{lang === 'es' ? 'Límite' : 'Limit'}: {fmtRD(client.creditLimit)}</span>
              </div>
              <div className="h-1 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    status === 'overlimit' ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-green-400'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1.5">
            {client.totalVisits} {lang === 'es' ? 'visitas' : 'visits'} · {fmtRD(client.totalSpent)} {lang === 'es' ? 'gastados' : 'spent'}
            {client.lastService ? ` · ${lang === 'es' ? 'Último' : 'Last'}: ${fmtDate(client.lastService)}` : ''}
          </p>
        </div>

        <ChevronRight size={14} className={`shrink-0 mt-2 ${selected ? 'text-sky-500' : 'text-slate-300 dark:text-white/30'}`} />
      </div>
    </button>
  )
}

// ── Skeleton client card ──────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="px-4 py-4 border-b border-slate-100 dark:border-white/10 animate-pulse">
      <div className="flex gap-3">
        <div className="w-9 h-9 bg-slate-100 dark:bg-white/10 rounded-xl shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 bg-slate-100 dark:bg-white/10 rounded w-3/4" />
          <div className="h-3 bg-slate-100 dark:bg-white/10 rounded w-1/2" />
          <div className="h-2 bg-slate-100 dark:bg-white/10 rounded w-full" />
        </div>
      </div>
    </div>
  )
}

// ── Client detail panel ───────────────────────────────────────────────────────

function ClientDetail({ client, onClose, onUpdateClient, onDelete, lang }) {
  const api = useAPI()
  const { businessType } = useBusinessType()
  const isSalon = businessType === 'salon'
  const [empleadosCache, setEmpleadosCache] = useState([])
  const [savingSalon,    setSavingSalon]    = useState(false)
  const [allergyInput,   setAllergyInput]   = useState(client.allergies || '')
  const [preferredInput, setPreferredInput] = useState(client.preferredStylistId || '')

  // Lazy-load stylist list (empleados) for the preferred-stylist picker.
  useEffect(() => {
    if (!isSalon) return
    api?.empleados?.all?.()
      .then(r => setEmpleadosCache((r || []).filter(e => e.active !== 0)))
      .catch(() => setEmpleadosCache([]))
  }, [isSalon, api])

  // Keep inputs in sync if a different client is selected.
  useEffect(() => {
    setAllergyInput(client.allergies || '')
    setPreferredInput(client.preferredStylistId || '')
  }, [client.id])

  async function saveSalonPrefs(patch) {
    setSavingSalon(true)
    try {
      const body = { id: client.id, ...patch }
      if ('preferred_stylist_id' in patch) {
        const emp = empleadosCache.find(e => e.id === Number(patch.preferred_stylist_id))
        body.preferred_stylist_supabase_id = emp?.supabase_id || null
      }
      await api?.clients?.update?.(body)
      onUpdateClient(client.id, {
        allergies: 'allergies' in patch ? patch.allergies : client.allergies,
        preferredStylistId: 'preferred_stylist_id' in patch ? patch.preferred_stylist_id : client.preferredStylistId,
        preferredStylistSupabaseId: body.preferred_stylist_supabase_id ?? client.preferredStylistSupabaseId,
      })
    } catch {}
    setSavingSalon(false)
  }

  const [openTickets,   setOpenTickets]   = useState([])
  const [loadingTix,    setLoadingTix]    = useState(true)
  const [checked,       setChecked]       = useState(new Set())
  const [formaPago,     setFormaPago]     = useState(null)
  const [ncfType,       setNcfType]       = useState('B02')
  const [rnc,           setRnc]           = useState(client.rnc || '')
  const [comentario,    setComentario]    = useState('')
  const [toast,         setToast]         = useState(null)
  const [savingPayment, setSavingPayment] = useState(false)

  // ITBIS rate — from app_settings.itbis_pct (string), default 18.
  const [itbisRate, setItbisRate] = useState(18)
  useEffect(() => {
    api?.settings?.get?.()
      .then(s => {
        const pct = Number(s?.itbis_pct)
        if (Number.isFinite(pct) && pct >= 0) setItbisRate(pct)
      })
      .catch(() => {})
  }, [api])
  const itbisFactor = Number(itbisRate) / 100

  // ── Edit mode ──────────────────────────────────────────────────────────────
  const [editing,       setEditing]       = useState(false)
  const [editForm,      setEditForm]      = useState({})
  const [editSaving,    setEditSaving]    = useState(false)

  function startEdit() {
    setEditForm({
      name:        client.name || '',
      phone:       client.phone || '',
      email:       client.email || '',
      address:     client.address || '',
      rnc:         client.rnc || '',
      creditLimit: String(client.creditLimit || 0),
      notes:       client.notes || '',
    })
    setEditing(true)
  }

  async function saveEdit() {
    setEditSaving(true)
    try {
      const data = {
        id:           client.id,
        name:         editForm.name.trim(),
        phone:        editForm.phone.trim(),
        email:        editForm.email.trim(),
        address:      editForm.address.trim(),
        rnc:          editForm.rnc.trim(),
        credit_limit: parseFloat(editForm.creditLimit) || 0,
        notes:        editForm.notes.trim(),
      }
      await api?.clients?.update?.(data)
      onUpdateClient(client.id, {
        name:        data.name,
        phone:       data.phone,
        email:       data.email,
        address:     data.address,
        rnc:         data.rnc,
        creditLimit: data.credit_limit,
        notes:       data.notes,
      })
      setEditing(false)
      flash(lang === 'es' ? 'Cliente actualizado' : 'Client updated')
    } catch (e) {
      flash(`Error: ${e?.message || 'Error'}`)
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    if (client.balance > 0) {
      flash(lang === 'es'
        ? `No se puede eliminar: balance pendiente de RD$ ${client.balance.toFixed(2)}`
        : `Cannot delete: outstanding balance of RD$ ${client.balance.toFixed(2)}`)
      return
    }
    const msg = lang === 'es' ? 'Eliminar este cliente?' : 'Delete this client?'
    if (!confirm(msg)) return
    try {
      await api?.clients?.update?.({ id: client.id, active: 0 })
      if (onDelete) onDelete(client.id)
      flash(lang === 'es' ? 'Cliente eliminado' : 'Client deleted')
    } catch (e) {
      flash(`Error: ${e?.message || 'Error'}`)
    }
  }

  // Load the client's recent ticket history (last 10) — vehicle history feed.
  // Uses the dedicated carwash IPC when present, falls back silently otherwise.
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  useEffect(() => {
    setHistory([])
    setLoadingHistory(true)
    const lookupId = (typeof window !== 'undefined' && window.electronAPI)
      ? client.id
      : (client.supabase_id || client.id)
    api?.carwash?.ticketsByClient?.(lookupId, 10)
      .then(rows => setHistory(rows || []))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false))
  }, [client.id])

  // Load active carwash memberships + combos for the visible client.
  const [memberships, setMemberships] = useState([])
  const [combos,      setCombos]      = useState([])
  useEffect(() => {
    const lookupId = (typeof window !== 'undefined' && window.electronAPI)
      ? client.id
      : (client.supabase_id || client.id)
    api?.memberships?.activeForClient?.(lookupId).then(r => setMemberships(r || [])).catch(() => setMemberships([]))
    api?.washCombos?.activeForClient?.(lookupId).then(r => setCombos(r || [])).catch(() => setCombos([]))
  }, [client.id])

  // Load open (credit, unpaid) tickets for this client
  useEffect(() => {
    setChecked(new Set())
    setFormaPago(null)
    setNcfType('B02')
    setRnc(client.rnc || '')
    setComentario('')
    setOpenTickets([])
    setLoadingTix(true)

    api?.clients?.openTickets?.(client.id)
      .then(rows => {
        setOpenTickets((rows || []).map(t => ({
          ...t,
          ticketNo: t.doc_number || `T-${t.id}`,
          date:     t.created_at?.slice(0, 10) || '',
          services: t.service_names || (t.items || []).map(i => i.name).join(' + ') || '',
          amount:   t.total || 0,
        })))
      })
      .catch(err => console.error('[openTickets]', err))
      .finally(() => setLoadingTix(false))
  }, [client.id])

  const selectedAmt = openTickets.filter(t => checked.has(t.id)).reduce((s, t) => s + t.amount, 0)
  const newBalance  = client.balance - selectedAmt
  const allChecked  = openTickets.length > 0 && checked.size === openTickets.length
  const status      = clientStatus(client)
  const pct         = client.creditLimit > 0 ? Math.min((client.balance / client.creditLimit) * 100, 100) : 0
  const newPct      = client.creditLimit > 0 ? Math.min((newBalance / client.creditLimit) * 100, 100) : 0

  const canPay = checked.size > 0 && formaPago && (ncfType === 'B02' || rnc.replace(/\D/g, '').length >= 9)

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }
  function toggleAll() {
    if (allChecked) setChecked(new Set())
    else setChecked(new Set(openTickets.map(t => t.id)))
  }
  function toggleTicket(id) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleCobrar() {
    if (!canPay) return
    setSavingPayment(true)

    try {
      // Use credits.collect to update balance + mark tickets as paid atomically
      const ticketIds = [...checked]
      if (api?.credits?.collect) {
        await api.credits.collect({
          clientId:      client.id,
          ticketIds,
          amount:        selectedAmt,
          paymentMethod: formaPago,
          ncf:           ncfType || null,
          notes:         comentario || null,
          cajeroId:      null,
        })
      } else {
        // Fallback: just update balance if credits.collect not available
        await api?.clients?.updateBalance?.({ id: client.id, delta: -selectedAmt })
      }

      const paidCount = checked.size
      const paidTickets = openTickets.filter(t => checked.has(t.id))
      const paidAmt = selectedAmt
      const paidMethod = formaPago

      onUpdateClient(client.id, {
        balance:     Math.max(0, newBalance),
        openTickets: openTickets.filter(t => !checked.has(t.id)),
      })
      setOpenTickets(prev => prev.filter(t => !checked.has(t.id)))
      setChecked(new Set())
      setFormaPago(null)
      setComentario('')
      flash(`${paidCount} ${lang === 'es' ? 'ticket(s) cobrado(s)' : 'ticket(s) collected'} · ${fmtRD(paidAmt)}`)

      // Print proper invoice receipt for each paid ticket (same as POS receipt)
      try {
        const empresa = await api?.admin?.getEmpresa?.().catch(() => null) || {}
        const biz = {
          name:    empresa?.nombre    || empresa?.name    || '',
          address: empresa?.direccion || empresa?.address || '',
          phone:   empresa?.telefono  || empresa?.phone   || '',
          rnc:     empresa?.rnc       || '',
          logo:    empresa?.logo      || '',
        }
        for (const ticket of paidTickets) {
          const items = ticket.items || []
          const subtotal = items.reduce((s, i) => s + (i.price || 0), 0)
          const itbis = items.reduce((s, i) => s + (i.is_wash ? Math.round(i.price * itbisFactor * 100) / 100 : 0), 0)
          await printClientReceipt({
            ncf:          ticket.ncf || '',
            ncfType:      ncfType || ticket.comprobante_type || 'B02',
            cajero:       '',
            lavador:      '',
            docNo:        ticket.doc_number || `T-${ticket.id}`,
            paidAt:       new Date(),
            client:       { name: client.name, rnc: client.rnc, phone: client.phone },
            vehiclePlate: ticket.vehicle_plate || '',
            tipo:         'credito',
            formaPago:    paidMethod,
            services:     items,
            subtotal,
            descuento:    ticket.descuento || 0,
            itbis,
            ley:          ticket.ley || 0,
            total:        ticket.total || 0,
            biz,
            securityCode:  null,
            signatureDate: null,
            qrLink:        null,
          }).catch(err => console.error('[Clients] print ticket failed:', err))
        }
      } catch (printErr) {
        console.error('[Clients] printClientReceipt failed:', printErr)
      }
    } catch (err) {
      flash(`Error: ${err.message}`)
    } finally {
      setSavingPayment(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-white/5 md:border-l border-slate-200 dark:border-white/10">

      {/* Header */}
      <div className="shrink-0 flex items-start justify-between px-3 py-3 md:px-6 md:py-4 border-b border-slate-100 dark:border-white/10">
        <div className="flex items-start gap-2 md:gap-3">
          {/* Back button — mobile only */}
          <button
            onClick={onClose}
            className="md:hidden w-8 h-8 flex items-center justify-center text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white rounded-lg shrink-0 mt-0.5"
          >
            <ChevronRight size={18} className="rotate-180" />
          </button>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[12px] font-bold shrink-0 ${
            status === 'overlimit' ? 'bg-red-100 dark:bg-red-500/20 text-red-600' : 'bg-sky-100 dark:bg-sky-500/20 text-sky-700'
          }`}>
            {initials(client.name)}
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-slate-800 dark:text-white leading-tight">{client.name}</h3>
            {client.rnc && <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5">RNC {client.rnc}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!editing && (
            <>
              <button onClick={startEdit} className="text-slate-400 dark:text-white/40 hover:text-sky-600 p-1.5 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors" title={lang === 'es' ? 'Editar' : 'Edit'}>
                <Pencil size={14} />
              </button>
              <button onClick={handleDelete} className="text-slate-400 dark:text-white/40 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors" title={lang === 'es' ? 'Eliminar' : 'Delete'}>
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button onClick={onClose} className="text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/10 bg-sky-50/50 dark:bg-sky-500/10 space-y-3">
          <p className="text-[11px] font-bold text-sky-600 uppercase tracking-wider">{lang === 'es' ? 'Editar Cliente' : 'Edit Client'}</p>
          {[
            { key: 'name',        label: lang === 'es' ? 'Nombre' : 'Name',          type: 'text' },
            { key: 'phone',       label: lang === 'es' ? 'Telefono' : 'Phone',       type: 'tel' },
            { key: 'email',       label: 'Email',                                     type: 'email' },
            { key: 'address',     label: lang === 'es' ? 'Direccion' : 'Address',    type: 'text' },
            { key: 'rnc',         label: 'RNC',                                       type: 'text' },
            { key: 'creditLimit', label: lang === 'es' ? 'Limite de Credito' : 'Credit Limit', type: 'number' },
            { key: 'notes',       label: lang === 'es' ? 'Notas' : 'Notes',          type: 'text' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-[10px] text-slate-500 dark:text-white/60 mb-0.5">{f.label}</label>
              <input
                type={f.type}
                value={editForm[f.key] || ''}
                onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setEditing(false)} className="px-4 py-1.5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 text-[12px] rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
              {lang === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
            <button onClick={saveEdit} disabled={editSaving} className="flex-1 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-[12px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5">
              {editSaving && <Loader2 size={11} className="animate-spin" />}
              {lang === 'es' ? 'Guardar' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* Contact info */}
        <div className="px-3 py-3 md:px-6 md:py-4 border-b border-slate-100 dark:border-white/10 grid grid-cols-1 md:grid-cols-2 gap-y-2.5 gap-x-4">
          {client.phone && (
            <div className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-white/60">
              <Phone size={12} className="text-slate-400 dark:text-white/40 shrink-0" />
              {client.phone}
            </div>
          )}
          {client.email && (
            <div className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-white/60">
              <Mail size={12} className="text-slate-400 dark:text-white/40 shrink-0" />
              <span className="truncate">{client.email}</span>
            </div>
          )}
          {client.address && (
            <div className="flex items-start gap-2 text-[12px] text-slate-600 dark:text-white/60 col-span-2">
              <MapPin size={12} className="text-slate-400 dark:text-white/40 shrink-0 mt-0.5" />
              {client.address}
            </div>
          )}
          {client.notes && (
            <div className="col-span-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-lg px-3 py-2 text-[11px] text-amber-700">
              {client.notes}
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="px-3 py-3 md:px-6 border-b border-slate-100 dark:border-white/10 flex flex-wrap gap-4 md:gap-6">
          <div className="text-center">
            <p className="text-[18px] font-bold text-slate-800 dark:text-white">{client.totalVisits}</p>
            <p className="text-[10px] text-slate-400 dark:text-white/40">{lang === 'es' ? 'Visitas' : 'Visits'}</p>
          </div>
          <div className="text-center">
            <p className="text-[18px] font-bold text-slate-800 dark:text-white">{fmtRD(client.totalSpent)}</p>
            <p className="text-[10px] text-slate-400 dark:text-white/40">{lang === 'es' ? 'Total gastado' : 'Total spent'}</p>
          </div>
          {client.lastService && (
            <div className="text-center">
              <p className="text-[18px] font-bold text-slate-800 dark:text-white">{fmtDate(client.lastService)}</p>
              <p className="text-[10px] text-slate-400 dark:text-white/40">{lang === 'es' ? 'Último servicio' : 'Last service'}</p>
            </div>
          )}
        </div>

        {/* Active carwash benefits — membership + combos (subtle badges) */}
        {(memberships.length > 0 || combos.length > 0) && (
          <div className="px-3 py-3 md:px-6 md:py-4 border-b border-slate-100 dark:border-white/10">
            <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">
              {lang === 'es' ? 'Beneficios Activos' : 'Active Benefits'}
            </p>
            <div className="flex flex-wrap gap-2">
              {memberships.map(m => {
                const remaining = Math.max(0, (m.wash_quota_per_month || 0) - (m.washes_used_this_period || 0))
                return (
                  <span key={`m-${m.id}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30">
                    {m.plan_name} · {remaining}/{m.wash_quota_per_month} {lang === 'es' ? 'disp.' : 'left'}
                  </span>
                )
              })}
              {combos.map(c => {
                const remaining = Math.max(0, (c.total_washes || 0) - (c.used_washes || 0))
                return (
                  <span key={`c-${c.id}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30">
                    {c.combo_name} · {remaining}/{c.total_washes} {lang === 'es' ? 'disp.' : 'left'}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Salon — client preferences card: loyalty tier/points, preferred stylist, allergies */}
        {isSalon && (() => {
          const tier = loyaltyTier(client.totalSpent)
          return (
            <div className="px-3 py-3 md:px-6 md:py-4 border-b border-slate-100 dark:border-white/10 space-y-3">
              <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider flex items-center gap-1.5">
                <Heart size={11} />{lang === 'es' ? 'Preferencias del Cliente' : 'Client Preferences'}
              </p>

              {/* Loyalty */}
              <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Gift size={14} className="text-[#b3001e] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400 dark:text-white/40 leading-none">{lang === 'es' ? 'Puntos de lealtad' : 'Loyalty points'}</p>
                    <p className="text-[15px] font-bold text-slate-800 dark:text-white tabular-nums leading-tight mt-0.5">{Math.round(client.loyaltyPoints).toLocaleString('en-US')}</p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${tier.color}`}>
                  {lang === 'es' ? tier.es : tier.en}
                </span>
              </div>

              {/* Preferred stylist */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Scissors size={10} />{lang === 'es' ? 'Estilista preferido' : 'Preferred stylist'}
                </label>
                <select
                  value={preferredInput || ''}
                  onChange={e => { const v = e.target.value ? Number(e.target.value) : null; setPreferredInput(v); saveSalonPrefs({ preferred_stylist_id: v }) }}
                  disabled={savingSalon}
                  className="w-full px-3 py-2 text-[13px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30">
                  <option value="">{lang === 'es' ? 'Sin preferencia' : 'No preference'}</option>
                  {empleadosCache.map(e => (
                    <option key={e.id} value={e.id}>{e.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Allergies */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <AlertTriangle size={10} className="text-amber-500" />{lang === 'es' ? 'Alergias / notas sensibles' : 'Allergies / sensitivity notes'}
                </label>
                <textarea
                  value={allergyInput}
                  onChange={e => setAllergyInput(e.target.value)}
                  onBlur={() => {
                    if ((allergyInput || '') !== (client.allergies || '')) saveSalonPrefs({ allergies: allergyInput.trim() || null })
                  }}
                  rows={2}
                  placeholder={lang === 'es' ? 'Ej: tinte con amoniaco, parafina...' : 'e.g. ammonia dye, paraffin...'}
                  className="w-full px-3 py-2 text-[12px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30 resize-none" />
              </div>
            </div>
          )
        })()}

        {/* Vehicle / ticket history — last 10 services */}
        <div className="px-3 py-3 md:px-6 md:py-4 border-b border-slate-100 dark:border-white/10">
          <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">
            {lang === 'es' ? 'Historial Reciente' : 'Recent History'}
          </p>
          {loadingHistory ? (
            <p className="text-[12px] text-slate-400 dark:text-white/40">{lang === 'es' ? 'Cargando…' : 'Loading…'}</p>
          ) : history.length === 0 ? (
            <p className="text-[12px] text-slate-400 dark:text-white/40">{lang === 'es' ? 'Sin visitas registradas' : 'No recorded visits'}</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map(h => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold text-sky-600">{h.doc_number || `T-${h.id}`}</span>
                      {h.vehicle_plate && <span className="text-[11px] text-slate-500 dark:text-white/60">· {h.vehicle_plate}</span>}
                      {h.status === 'nula' && <span className="text-[10px] font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">NULA</span>}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-white/60 truncate">{h.services || '—'}</p>
                    <p className="text-[10px] text-slate-400 dark:text-white/40">{fmtDate(String(h.created_at).slice(0, 10))}{h.washer_name ? ` · ${h.washer_name}` : ''}</p>
                  </div>
                  <span className="text-[12px] font-bold text-slate-700 dark:text-white shrink-0">{fmtRD(h.total || 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Credit block */}
        {(client.creditLimit > 0 || client.balance > 0) && (
          <div className="px-3 py-3 md:px-6 md:py-4 border-b border-slate-100 dark:border-white/10">
            <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-3">
              {lang === 'es' ? 'Crédito' : 'Credit Account'}
            </p>
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-slate-500 dark:text-white/60">{lang === 'es' ? 'Saldo pendiente' : 'Balance owed'}</span>
              <span className={`font-bold ${status === 'overlimit' ? 'text-red-600' : 'text-slate-800 dark:text-white'}`}>
                {checked.size > 0 ? (
                  <>
                    <span className="line-through text-slate-400 dark:text-white/40 mr-2">{fmtRD(client.balance)}</span>
                    <span className={newBalance < 0 ? 'text-green-600' : 'text-slate-800 dark:text-white'}>{fmtRD(Math.max(0, newBalance))}</span>
                  </>
                ) : fmtRD(client.balance)}
              </span>
            </div>
            <div className="flex justify-between text-[12px] mb-2">
              <span className="text-slate-500 dark:text-white/60">{lang === 'es' ? 'Límite de crédito' : 'Credit limit'}</span>
              <span className="font-semibold text-slate-600 dark:text-white/60">{fmtRD(client.creditLimit)}</span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden mb-1.5">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  status === 'overlimit' ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-green-400'
                }`}
                style={{ width: `${checked.size > 0 ? Math.max(0, Math.min(newPct, 100)) : pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 dark:text-white/40">
              <span>{lang === 'es' ? 'Disponible' : 'Available'}: {fmtRD(Math.max(0, client.creditLimit - (checked.size > 0 ? Math.max(0,newBalance) : client.balance)))}</span>
              <span>{Math.round(checked.size > 0 ? Math.max(0, newPct) : pct)}%</span>
            </div>
            {status === 'overlimit' && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-red-600 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-1.5">
                <AlertTriangle size={11} />
                {lang === 'es' ? 'Límite de crédito excedido' : 'Credit limit exceeded'}
              </div>
            )}
          </div>
        )}

        {/* Open tickets */}
        <div className="px-3 py-3 md:px-6 md:py-4 border-b border-slate-100 dark:border-white/10">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
              {lang === 'es' ? `Tickets a Crédito` : 'Credit Tickets'}
            </p>
            {openTickets.length > 0 && (
              <button onClick={toggleAll} className="text-[11px] font-medium text-sky-600 hover:text-sky-700">
                {allChecked ? (lang === 'es' ? 'Deseleccionar todo' : 'Deselect all') : (lang === 'es' ? 'Seleccionar todo' : 'Select all')}
              </button>
            )}
          </div>

          {loadingTix ? (
            <div className="flex items-center gap-2 text-[12px] text-slate-400 dark:text-white/40 py-2">
              <Loader2 size={13} className="animate-spin" />
              {lang === 'es' ? 'Cargando…' : 'Loading…'}
            </div>
          ) : openTickets.length === 0 ? (
            <p className="text-[13px] text-slate-400 dark:text-white/40 py-2">
              {lang === 'es' ? 'Sin tickets pendientes' : 'No open tickets'}
            </p>
          ) : (
            <div className="space-y-1.5">
              {openTickets.map(ticket => {
                const isChecked = checked.has(ticket.id)
                return (
                  <button
                    key={ticket.id}
                    onClick={() => toggleTicket(ticket.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                      isChecked ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30' : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                    }`}
                  >
                    {isChecked
                      ? <SquareCheckBig size={15} className="shrink-0 text-sky-600" />
                      : <Square size={15} className="shrink-0 text-slate-300 dark:text-white/30" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-bold text-sky-600">{ticket.ticketNo}</span>
                        <span className="text-[12px] font-semibold text-slate-700 dark:text-white">{fmtRD(ticket.amount)}</span>
                      </div>
                      {ticket.services && (
                        <p className="text-[11px] text-slate-500 dark:text-white/60 truncate">{ticket.services}</p>
                      )}
                      <p className="text-[10px] text-slate-400 dark:text-white/40">{fmtDate(ticket.date)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {checked.size > 0 && (
            <div className="mt-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 flex items-center justify-between">
              <span className="text-[12px] text-slate-500 dark:text-white/60">
                {checked.size} {lang === 'es' ? 'ticket(s) seleccionados' : 'ticket(s) selected'}
              </span>
              <span className="text-[15px] font-bold text-slate-800 dark:text-white">{fmtRD(selectedAmt)}</span>
            </div>
          )}
        </div>

        {/* Payment form — only when tickets selected */}
        {checked.size > 0 && (
          <div className="px-3 py-3 md:px-6 md:py-4">
            <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-3">
              {lang === 'es' ? 'Cobrar Pago' : 'Collect Payment'}
            </p>

            <div className="flex gap-2 mb-4">
              {[
                { id: 'B02', es: 'B02 Consumidor',    en: 'B02 Consumer' },
                { id: 'B01', es: 'B01 Crédito Fiscal', en: 'B01 Tax Credit' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setNcfType(opt.id)}
                  className={`flex-1 py-2 rounded-xl border text-[11px] font-semibold transition-all ${
                    ncfType === opt.id
                      ? 'bg-sky-600 border-sky-600 text-white'
                      : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-sky-300'
                  }`}
                >
                  {lang === 'es' ? opt.es : opt.en}
                </button>
              ))}
            </div>

            {ncfType === 'B01' && (
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1.5">
                  {lang === 'es' ? 'RNC del cliente' : 'Client RNC'}
                </label>
                <input
                  type="text"
                  value={rnc}
                  onChange={e => setRnc(e.target.value)}
                  placeholder="101-XXXXX-X"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-4">
              {PAYMENT_METHODS.map(({ id, Icon, es, en }) => (
                <button
                  key={id}
                  onClick={() => setFormaPago(id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12px] font-semibold transition-all min-h-[44px] ${
                    formaPago === id
                      ? 'bg-sky-600 border-sky-600 text-white'
                      : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-sky-300'
                  }`}
                >
                  <Icon size={14} />
                  {lang === 'es' ? es : en}
                </button>
              ))}
            </div>

            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder={lang === 'es' ? 'Comentario (opcional)' : 'Comment (optional)'}
              rows={2}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 resize-none placeholder:text-slate-400 dark:placeholder:text-white/40 mb-4"
            />

            <button
              onClick={handleCobrar}
              disabled={!canPay || savingPayment}
              className={`w-full py-3 rounded-xl text-[13px] font-bold transition-all flex items-center justify-center gap-2 ${
                canPay && !savingPayment
                  ? 'bg-green-500 hover:bg-green-400 text-white active:scale-[0.99]'
                  : 'bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-white/40 cursor-not-allowed'
              }`}
            >
              {savingPayment && <Loader2 size={14} className="animate-spin" />}
              {lang === 'es' ? 'Cobrar' : 'Collect'} · {fmtRD(selectedAmt)}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="shrink-0 mx-4 mb-4 flex items-center gap-2.5 bg-slate-800 dark:bg-white/20 text-white text-[12px] font-medium px-4 py-3 rounded-xl">
          <CheckCircle2 size={14} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}
    </div>
  )
}

// ── New client form ───────────────────────────────────────────────────────────

const EMPTY_FORM = { name: '', rnc: '', phone: '', address: '', email: '', creditLimit: '', notes: '' }

export function NewClientForm({ onClose, onSave, lang }) {
  const api = useAPI()
  const [form,   setForm]   = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const { lookup: rncLookup, lookupLoading: rncLoading } = useRNC()

  function set(field, val) { setForm(f => ({ ...f, [field]: val })) }

  async function lookupRNC(rncValue) {
    const clean = (rncValue || form.rnc).replace(/\D/g, '')
    if (clean.length !== 9 && clean.length !== 11) return
    const res = await rncLookup(clean)
    if (res?.nombre) set('name', res.nombre)
    else if (res?.name) set('name', res.name)
  }

  // Auto-lookup when RNC reaches valid length (9 empresa or 11 cédula)
  useEffect(() => {
    const clean = form.rnc.replace(/\D/g, '')
    if (clean.length === 9 || clean.length === 11) {
      const timer = setTimeout(() => lookupRNC(form.rnc), 400)
      return () => clearTimeout(timer)
    }
  }, [form.rnc])

  function validate() {
    const e = {}
    if (!form.name.trim())  e.name  = lang === 'es' ? 'Nombre requerido'   : 'Name required'
    if (!form.phone.trim()) e.phone = lang === 'es' ? 'Teléfono requerido' : 'Phone required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)

    const newClientData = {
      name:         form.name.trim(),
      rnc:          form.rnc.trim(),
      phone:        form.phone.trim(),
      address:      form.address.trim(),
      email:        form.email.trim(),
      credit_limit: parseFloat(form.creditLimit) || 0,
      notes:        form.notes.trim(),
    }

    try {
      const result = await api?.clients?.create?.(newClientData)
      const newId  = result?.lastInsertRowid || Date.now()
      onSave({
        ...mapClient({ ...newClientData, id: newId, visits: 0, total_spent: 0, balance: 0, last_service_date: null }),
      })
    } catch (err) {
      console.error('[clientCreate]', err)
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { key: 'name',        label_es: 'Nombre / Empresa',  label_en: 'Name / Company',  required: true,  type: 'text'   },
    { key: 'phone',       label_es: 'Teléfono',          label_en: 'Phone',           required: true,  type: 'tel'    },
    { key: 'address',     label_es: 'Dirección',         label_en: 'Address',         required: false, type: 'text'   },
    { key: 'email',       label_es: 'Email',             label_en: 'Email',           required: false, type: 'email'  },
    { key: 'creditLimit', label_es: 'Límite de Crédito', label_en: 'Credit Limit',    required: false, type: 'number' },
  ]

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full md:w-[420px] h-full bg-white dark:bg-black shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10">
          <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">
            {lang === 'es' ? 'Nuevo Cliente' : 'New Client'}
          </h3>
          <button onClick={onClose} className="text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1.5">
              RNC / {lang === 'es' ? 'Cédula' : 'ID'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.rnc}
                onChange={e => set('rnc', e.target.value)}
                placeholder="101-XXXXX-X"
                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400"
              />
              <button
                onClick={lookupRNC}
                disabled={rncLoading}
                className="px-3 py-2 bg-sky-50 dark:bg-sky-500/10 hover:bg-sky-100 dark:hover:bg-sky-500/20 border border-sky-200 dark:border-sky-500/30 rounded-xl text-[12px] font-semibold text-sky-700 transition-colors whitespace-nowrap"
              >
                {rncLoading ? '...' : (lang === 'es' ? 'Buscar' : 'Lookup')}
              </button>
            </div>
          </div>

          {fields.map(f => (
            <div key={f.key}>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1.5">
                {lang === 'es' ? f.label_es : f.label_en}
                {f.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              <input
                type={f.type}
                value={form[f.key]}
                onChange={e => set(f.key, e.target.value)}
                className={`w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 ${
                  errors[f.key] ? 'border-red-300 bg-red-50 dark:bg-red-500/10' : 'border-slate-200 dark:border-white/10'
                }`}
              />
              {errors[f.key] && <p className="text-[11px] text-red-500 mt-1">{errors[f.key]}</p>}
            </div>
          ))}

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1.5">
              {lang === 'es' ? 'Notas' : 'Notes'}
            </label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 resize-none"
            />
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 pb-20 md:pb-4 border-t border-slate-200 dark:border-white/10 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 md:py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-[13px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors min-h-[44px]"
          >
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 md:py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-[13px] font-bold transition-colors flex items-center justify-center gap-2 min-h-[44px]"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {lang === 'es' ? 'Guardar Cliente' : 'Save Client'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Clients screen ───────────────────────────────────────────────────────

export default function Clients() {
  const { lang } = useLang()
  const { data: rawClients, loading, error, reload } = useClients()

  const [localPatches, setLocalPatches] = useState({})  // id → patch (optimistic updates)
  const [search,       setSearch]       = useState('')
  const [selectedId,   setSelectedId]   = useState(null)
  const [showNewForm,  setShowNewForm]  = useState(false)
  const [addedClients, setAddedClients] = useState([])  // newly created this session

  // Merge DB clients + local patches + newly added
  const clients = useMemo(() => {
    const merged = [
      ...addedClients,
      ...rawClients.map(c => {
        const mapped = mapClient(c)
        return localPatches[c.id] ? { ...mapped, ...localPatches[c.id] } : mapped
      }),
    ]
    return merged
  }, [rawClients, localPatches, addedClients])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return clients
    return clients.filter(c =>
      c.name.toLowerCase().includes(q)  ||
      c.rnc.toLowerCase().includes(q)   ||
      c.phone.toLowerCase().includes(q)
    )
  }, [clients, search])

  const selectedClient = clients.find(c => c.id === selectedId) || null

  function handleUpdate(id, patch) {
    setLocalPatches(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }))
  }

  function handleSaveNew(newClient) {
    setAddedClients(cs => [newClient, ...cs])
    setSelectedId(newClient.id)
    setShowNewForm(false)
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-white dark:bg-black overflow-hidden">

      {/* Left: client list — hidden on mobile when a client is selected */}
      <div className={`flex flex-col border-r border-slate-200 dark:border-white/10 transition-all ${
        selectedClient ? 'hidden md:flex w-full md:w-[360px] md:shrink-0' : 'flex flex-1 md:max-w-xl'
      }`}>

        <div className="shrink-0 px-3 py-3 md:px-4 md:py-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center justify-between mb-2 md:mb-3">
            <div>
              <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
                {lang === 'es' ? 'Clientes' : 'Clients'}
              </h2>
              <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
                {loading ? '…' : clients.length} {lang === 'es' ? 'clientes registrados' : 'registered clients'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => reload()}
                disabled={loading}
                className="w-8 h-8 flex items-center justify-center text-slate-400 dark:text-white/40 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-500/10 rounded-lg transition-colors"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white/10 hover:bg-slate-800 dark:hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-colors"
              >
                <Plus size={14} />
                {lang === 'es' ? 'Nuevo' : 'New'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:border-sky-400">
            <Search size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={lang === 'es' ? 'Buscar por nombre, RNC o teléfono...' : 'Search by name, RNC or phone...'}
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-40 text-red-400 gap-2">
              <AlertCircle size={24} />
              <p className="text-[13px]">{lang === 'es' ? 'Error al cargar clientes' : 'Error loading clients'}</p>
              <button onClick={() => reload()} className="text-[12px] text-sky-600 hover:underline">
                {lang === 'es' ? 'Reintentar' : 'Retry'}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-300 dark:text-white/30 gap-2">
              <Building2 size={28} />
              <p className="text-[13px]">{lang === 'es' ? 'Sin resultados' : 'No results'}</p>
            </div>
          ) : (
            filtered.map(client => (
              <ClientCard
                key={client.id}
                client={client}
                selected={client.id === selectedId}
                onClick={() => setSelectedId(client.id === selectedId ? null : client.id)}
                lang={lang}
              />
            ))
          )}
        </div>
      </div>

      {/* Right: detail panel — full screen on mobile */}
      {selectedClient ? (
        <div className="flex-1 overflow-hidden">
          <ClientDetail
            key={selectedClient.id}
            client={selectedClient}
            onClose={() => setSelectedId(null)}
            onUpdateClient={handleUpdate}
            onDelete={() => { setSelectedId(null); reload() }}
            lang={lang}
          />
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-slate-300 dark:text-white/30 gap-3 flex-col">
          <Building2 size={36} />
          <p className="text-[14px]">{lang === 'es' ? 'Selecciona un cliente' : 'Select a client'}</p>
        </div>
      )}

      {showNewForm && (
        <NewClientForm
          onClose={() => setShowNewForm(false)}
          onSave={handleSaveNew}
          lang={lang}
        />
      )}
    </div>
  )
}
