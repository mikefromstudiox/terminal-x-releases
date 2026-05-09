/**
 * salon/Memberships.jsx — Salón / barbería membership catalog + per-client balances.
 *
 * Two-pane layout:
 *  - Left: catalog (CRUD of `memberships` rows where active_template=true and
 *    total_sessions IS NOT NULL). Create / edit / archive.
 *  - Right: client search → per-client balances (`client_memberships.byClient`).
 *
 * Reuses the salon brand: black + white + crimson #b3001e. Tailwind 4.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Tag, Plus, Search, X, Loader2, CheckCircle2, AlertCircle,
  Clock, Archive, Edit3, RefreshCw, User, ShoppingCart,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function daysUntil(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return Math.ceil(ms / (24 * 3600 * 1000))
}

// ── Catalog form modal ─────────────────────────────────────────────────────

function CatalogModal({ row, services, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    nombre:               row?.nombre               || '',
    service_supabase_id:  row?.service_supabase_id  || '',
    total_sessions:       row?.total_sessions       || 10,
    price_dop:            row?.price_dop            || 0,
    validity_days:        row?.validity_days        || 365,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e) {
    e.preventDefault()
    if (!form.nombre.trim()) { setErr(L('Nombre requerido', 'Name required')); return }
    if (!form.total_sessions || form.total_sessions < 1) { setErr(L('Sesiones >= 1', 'Sessions >= 1')); return }
    if (!form.price_dop || form.price_dop <= 0) { setErr(L('Precio requerido', 'Price required')); return }
    setSaving(true)
    try {
      await onSave({
        ...form,
        nombre:              form.nombre.trim(),
        service_supabase_id: form.service_supabase_id || null,
        total_sessions:      Number(form.total_sessions),
        price_dop:           Number(form.price_dop),
        validity_days:       Number(form.validity_days) || 365,
      })
    } catch (ex) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(ex, { severity: 'error', category: 'memberships.fmtrd' }) } catch {} setErr(ex?.message || L('Error al guardar', 'Save error')) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Tag size={16} className="text-[#b3001e]" />
            {row ? L('Editar Membresía', 'Edit Membership') : L('Nueva Membresía', 'New Membership')}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Nombre', 'Name')}
            </label>
            <input value={form.nombre} onChange={e => set('nombre', e.target.value)}
              placeholder={L('10 Cortes Premium', '10 Premium Cuts')}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30 focus:border-[#b3001e]" />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              {L('Servicio', 'Service')}
            </label>
            <select value={form.service_supabase_id} onChange={e => set('service_supabase_id', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30 focus:border-[#b3001e]">
              <option value="">{L('Cualquier servicio', 'Any service')}</option>
              {services.map(s => (
                <option key={s.supabase_id || s.id} value={s.supabase_id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Sesiones', 'Sessions')}
              </label>
              <input type="number" min="1" value={form.total_sessions} onChange={e => set('total_sessions', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30 focus:border-[#b3001e]" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Precio RD$', 'Price RD$')}
              </label>
              <input type="number" min="0" step="50" value={form.price_dop} onChange={e => set('price_dop', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30 focus:border-[#b3001e]" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                {L('Días', 'Days')}
              </label>
              <input type="number" min="1" value={form.validity_days} onChange={e => set('validity_days', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30 focus:border-[#b3001e]" />
            </div>
          </div>

          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            {L('Cancelar', 'Cancel')}
          </button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#b3001e] hover:bg-[#8c0017] text-white text-[12px] font-bold rounded-lg disabled:opacity-50 transition-colors">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {row ? L('Guardar', 'Save') : L('Crear', 'Create')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Sell-membership modal (Fix 1) ─────────────────────────────────────────
//
// Pick the client receiving the package, then route to /pos with state so the
// POS preloads a cart line carrying `_membershipPurchase` markers. The
// CarWashPOS handlePaymentConfirm reads those markers and calls
// `clientMemberships.purchase` after `tickets.create` resolves with a real
// `ticket_supabase_id`. Result: paying RD$5,000 for "10 Cortes" creates the
// e-CF AND the persistent client_memberships balance in one cobro.
function SellModal({ row, clients, lang, onClose, onPick }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const qDigits = qq.replace(/\D/g, '')
    if (!qq) return clients.slice(0, 30)
    return clients.filter(c => {
      const name = String(c.name || c.nombre || '').toLowerCase()
      const phoneDigits = String(c.phone || '').replace(/\D/g, '')
      return name.includes(qq) || (qDigits && phoneDigits.includes(qDigits))
    }).slice(0, 50)
  }, [q, clients])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <ShoppingCart size={16} className="text-[#b3001e]" />
              {L('Vender Membresía', 'Sell Membership')}
            </h2>
            <p className="text-[12px] text-slate-500 dark:text-white/50 mt-0.5 truncate">
              {row.nombre} · <span className="font-semibold text-[#b3001e]">RD$ {Number(row.price_dop || 0).toLocaleString('en-US')}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 shrink-0">
            <X size={16} className="text-slate-400" />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40" />
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus
              placeholder={L('Buscar cliente por nombre o teléfono…', 'Search client by name or phone…')}
              className="w-full pl-9 pr-3 py-2 text-[13px] bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40" />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <p className="px-5 py-8 text-center text-[12px] text-slate-400 dark:text-white/40">
              {L('Sin resultados.', 'No results.')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/10">
              {filtered.map(c => (
                <li key={c.id || c.supabase_id}>
                  <button type="button" onClick={() => onPick(c)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-[#b3001e]/5 dark:hover:bg-white/5 transition-colors text-left">
                    <User size={14} className="text-slate-300 dark:text-white/30 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{c.name || c.nombre}</p>
                      <p className="text-[11px] text-slate-400 dark:text-white/40">{c.phone || L('sin teléfono', 'no phone')}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function Memberships() {
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [catalog, setCatalog]   = useState([])
  const [services, setServices] = useState([])
  const [clients, setClients]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)

  const [editRow, setEditRow]   = useState(null)
  const [showNew, setShowNew]   = useState(false)
  // v2.16.2 (Fix 1) — sell-membership flow. Picks client → routes to /pos
  // with state.membershipPurchase preloaded. POS adds the line as a regular
  // service item with a `_membershipPurchase` marker; handlePaymentConfirm
  // calls clientMemberships.purchase after tickets.create succeeds.
  const [sellRow, setSellRow]   = useState(null) // membership template being sold

  const [clientQuery, setClientQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [clientBalances, setClientBalances] = useState([])
  const [balancesLoading, setBalancesLoading] = useState(false)

  const [toast, setToast] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [balancesError, setBalancesError] = useState('')
  function flash(msg, type = 'ok') { setToast({ msg, type }); setTimeout(() => setToast(null), 2500) }

  async function loadAll() {
    setLoading(true)
    setLoadError('')
    try {
      // H3: surface any failure so an empty catalog is never mistaken for
      // "no memberships configured". Without this, a 401 / RLS reject made
      // the page silently render the empty state.
      const [cat, svc, cli] = await Promise.all([
        api?.salonMemberships?.list?.() ?? Promise.resolve([]),
        api?.services?.all?.() ?? Promise.resolve([]),
        api?.clients?.all?.() ?? Promise.resolve([]),
      ])
      setCatalog(cat || [])
      setServices(svc || [])
      setClients(cli || [])
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'memberships.memberships' }) } catch {}
      // eslint-disable-next-line no-console
      console.error('[Memberships.loadAll]', e)
      setLoadError(e?.message || L('Error cargando membresías', 'Error loading memberships'))
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  async function loadBalances(client) {
    if (!client?.supabase_id) { setClientBalances([]); setBalancesError(''); return }
    setBalancesLoading(true)
    setBalancesError('')
    try {
      // v2.16.2 (item #9) — surface RLS / network errors. Previously a silent
      // catch rendered an empty balances list, prompting the receptionist to
      // charge full price for a client who actually had remaining sessions.
      const rows = await api.clientMemberships.byClient(client.supabase_id) || []
      setClientBalances(rows)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'memberships.memberships' }) } catch {}
      // eslint-disable-next-line no-console
      console.error('[Memberships.loadBalances]', e)
      setClientBalances([])
      setBalancesError(e?.message || L('Error cargando saldos', 'Error loading balances'))
    }
    setBalancesLoading(false)
  }

  useEffect(() => { if (selectedClient) loadBalances(selectedClient) }, [selectedClient])

  async function handleCreate(data) {
    setBusy(true)
    try {
      await api.salonMemberships.create(data)
      flash(L('Membresía creada', 'Membership created'))
      setShowNew(false)
      await loadAll()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'memberships.memberships' }) } catch {} flash(e?.message || L('Error', 'Error'), 'error') }
    finally { setBusy(false) }
  }

  async function handleUpdate(data) {
    if (!editRow?.supabase_id) return
    setBusy(true)
    try {
      await api.salonMemberships.update(editRow.supabase_id, data)
      flash(L('Membresía actualizada', 'Membership updated'))
      setEditRow(null)
      await loadAll()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'memberships.memberships' }) } catch {} flash(e?.message || L('Error', 'Error'), 'error') }
    finally { setBusy(false) }
  }

  async function handleArchive(row) {
    if (!confirm(L('¿Archivar esta membresía? Los clientes con sesiones activas no se ven afectados.', 'Archive this membership? Clients with active sessions are unaffected.'))) return
    try {
      await api.salonMemberships.archive(row.supabase_id)
      flash(L('Archivada', 'Archived'))
      await loadAll()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'memberships.flash' }) } catch {} flash(e?.message || L('Error', 'Error'), 'error') }
  }

  async function handleRenovar(balance) {
    if (!selectedClient?.supabase_id || !balance?.membership_supabase_id) return
    if (!confirm(L(`¿Renovar "${balance.membership_nombre}" para ${selectedClient.name}?`, `Renew "${balance.membership_nombre}" for ${selectedClient.name}?`))) return
    try {
      await api.clientMemberships.purchase({
        client_supabase_id: selectedClient.supabase_id,
        membership_supabase_id: balance.membership_supabase_id,
      })
      flash(L('Renovada', 'Renewed'))
      await loadBalances(selectedClient)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'memberships.flash' }) } catch {} flash(e?.message || L('Error', 'Error'), 'error') }
  }

  // Filter clients by query
  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase()
    if (!q) return clients.slice(0, 20)
    // v2.16.2 (item #10) — normalise digits both sides so "8091234567" matches
    // a stored "+1 (809) 123-4567".
    const qDigits = q.replace(/\D/g, '')
    return clients.filter(c => {
      const name = String(c.name || c.nombre || '').toLowerCase()
      const phoneDigits = String(c.phone || '').replace(/\D/g, '')
      return name.includes(q) || (qDigits && phoneDigits.includes(qDigits))
    }).slice(0, 30)
  }, [clientQuery, clients])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 shrink-0">
        <div className="flex items-center justify-between px-3 md:px-6 py-4">
          <div className="flex items-center gap-3">
            <Tag size={20} className="text-[#b3001e]" />
            <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
              {L('Membresías', 'Memberships')}
            </h1>
          </div>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#b3001e] hover:bg-[#8c0017] text-white rounded-xl text-sm font-medium transition-colors">
            <Plus size={15} /> {L('Nueva', 'New')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-white/40 text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-3 md:px-6 py-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Catalog pane ─────────────────────────────────────────── */}
          <section className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10">
              <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                {L('Catálogo', 'Catalog')}
              </p>
              <p className="text-[12px] text-slate-500 dark:text-white/50 mt-1">
                {L('Plantillas que se venden a los clientes.', 'Templates that get sold to clients.')}
              </p>
            </div>

            {loadError ? (
              <div className="px-4 py-6 bg-[#b3001e]/5 border-y border-[#b3001e]/20 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-[#b3001e] uppercase tracking-wider">
                    {L('Error al cargar membresías', 'Error loading memberships')}
                  </p>
                  <p className="text-[12px] text-[#b3001e] mt-1 truncate">{loadError}</p>
                </div>
                <button onClick={loadAll}
                  className="px-3 py-1.5 text-[12px] font-bold bg-[#b3001e] hover:bg-black text-white rounded-lg whitespace-nowrap transition-colors">
                  {L('Reintentar', 'Retry')}
                </button>
              </div>
            ) : catalog.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-300 dark:text-white/30">
                <Tag size={28} className="mx-auto mb-3" />
                <p className="text-[13px]">{L('No hay membresías. Crea la primera.', 'No memberships yet. Create the first one.')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/10">
                {catalog.map(row => (
                  <li key={row.supabase_id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{row.nombre}</p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-white/50">
                        <span>{row.total_sessions} {L('sesiones', 'sessions')}</span>
                        <span className="text-slate-300 dark:text-white/20">·</span>
                        <span className="font-semibold text-[#b3001e]">{fmtRD(row.price_dop)}</span>
                        <span className="text-slate-300 dark:text-white/20">·</span>
                        <span>{row.validity_days}d</span>
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5 truncate">
                        {row.service_name || L('Cualquier servicio', 'Any service')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setSellRow(row)} title={L('Vender Membresía', 'Sell Membership')}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-[11px] font-bold transition-colors">
                        <ShoppingCart size={12} />
                        {L('Vender', 'Sell')}
                      </button>
                      <button onClick={() => setEditRow(row)} title={L('Editar', 'Edit')}
                        className="p-2 rounded-lg text-slate-400 hover:text-[#b3001e] hover:bg-[#b3001e]/10 transition-colors">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => handleArchive(row)} title={L('Archivar', 'Archive')}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">
                        <Archive size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Per-client pane ───────────────────────────────────────── */}
          <section className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10">
              <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                {L('Saldos por cliente', 'Per-client balances')}
              </p>
              <div className="relative mt-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40" />
                <input value={clientQuery} onChange={e => { setClientQuery(e.target.value); setSelectedClient(null) }}
                  placeholder={L('Buscar cliente por nombre o teléfono...', 'Search client by name or phone...')}
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30 focus:border-[#b3001e]" />
              </div>
            </div>

            {!selectedClient ? (
              <div className="flex-1 overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[12px] text-slate-400 dark:text-white/40">
                    {clientQuery ? L('Sin resultados', 'No results') : L('Empieza a escribir para buscar', 'Start typing to search')}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-white/10">
                    {filteredClients.map(c => (
                      <li key={c.id || c.supabase_id}>
                        <button onClick={() => setSelectedClient(c)}
                          className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-[11px] font-bold text-slate-500 dark:text-white/60">
                            {((c.name || c.nombre || '?')[0] || '?').toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-slate-700 dark:text-white truncate">{c.name || c.nombre}</p>
                            {c.phone && <p className="text-[11px] text-slate-400 dark:text-white/40">{c.phone}</p>}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <User size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
                    <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">
                      {selectedClient.name || selectedClient.nombre}
                    </p>
                  </div>
                  <button onClick={() => setSelectedClient(null)}
                    className="text-[11px] text-slate-400 hover:text-[#b3001e] transition-colors">
                    {L('Cambiar', 'Change')}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {balancesError ? (
                    <div className="m-4 px-4 py-3 bg-[#b3001e]/5 border border-[#b3001e]/20 rounded-xl flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-[#b3001e] uppercase tracking-wider">
                          {L('Error al cargar saldos', 'Error loading balances')}
                        </p>
                        <p className="text-[12px] text-[#b3001e] mt-1 truncate">{balancesError}</p>
                      </div>
                      <button onClick={() => loadBalances(selectedClient)}
                        className="px-3 py-1.5 text-[12px] font-bold bg-[#b3001e] hover:bg-black text-white rounded-lg whitespace-nowrap transition-colors">
                        {L('Reintentar', 'Retry')}
                      </button>
                    </div>
                  ) : null}
                  {balancesLoading ? (
                    <div className="px-4 py-8 text-center text-slate-400 dark:text-white/40 text-sm flex items-center justify-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> {L('Cargando...', 'Loading...')}
                    </div>
                  ) : clientBalances.length === 0 ? (
                    <div className="px-4 py-12 text-center text-slate-300 dark:text-white/30">
                      <Tag size={28} className="mx-auto mb-3" />
                      <p className="text-[13px]">{L('Este cliente no tiene membresías activas.', 'This client has no active memberships.')}</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-white/10">
                      {clientBalances.map(b => {
                        const remain = Number(b.sessions_remaining) || 0
                        const total = Number(b.membership_total_sessions) || 0
                        const days = daysUntil(b.expires_at)
                        const expiringSoon = days !== null && days < 7
                        return (
                          <li key={b.supabase_id} className="px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{b.membership_nombre || L('Membresía', 'Membership')}</p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                                    <div className="h-full bg-[#b3001e] transition-all" style={{ width: `${total > 0 ? (remain / total) * 100 : 0}%` }} />
                                  </div>
                                  <span className="text-[11px] font-semibold text-slate-600 dark:text-white/70 shrink-0">
                                    {remain}/{total}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                                  <Clock size={11} className={expiringSoon ? 'text-red-500' : 'text-slate-400 dark:text-white/40'} />
                                  <span className={expiringSoon ? 'text-red-500 font-bold' : 'text-slate-400 dark:text-white/40'}>
                                    {fmtDate(b.expires_at)} {days !== null && days >= 0 ? `(${days}d)` : ''}
                                  </span>
                                  {expiringSoon && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[9px] font-bold uppercase">
                                      {L('Por vencer', 'Expiring')}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">
                                  {L('Comprada', 'Purchased')}: {fmtDate(b.purchased_at)}
                                </p>
                              </div>
                              <button onClick={() => handleRenovar(b)}
                                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e] hover:text-white rounded-lg text-[11px] font-bold transition-colors shrink-0">
                                <RefreshCw size={12} /> {L('Renovar', 'Renew')}
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Modals */}
      {showNew && (
        <CatalogModal row={null} services={services} lang={lang} onSave={handleCreate} onClose={() => setShowNew(false)} />
      )}
      {editRow && (
        <CatalogModal row={editRow} services={services} lang={lang} onSave={handleUpdate} onClose={() => setEditRow(null)} />
      )}
      {sellRow && (
        <SellModal row={sellRow} clients={clients} lang={lang}
          onClose={() => setSellRow(null)}
          onPick={(client) => {
            // Hand off to /pos. The POS reads location.state on mount and
            // injects the cart line + flags it `_membershipPurchase` so
            // handlePaymentConfirm calls clientMemberships.purchase after
            // tickets.create. Offline-safe: tickets.create + purchase both
            // have local SQLite implementations on Electron.
            navigate('/pos', {
              state: {
                membershipPurchase: {
                  membership_supabase_id: sellRow.supabase_id,
                  nombre: sellRow.nombre,
                  price_dop: Number(sellRow.price_dop) || 0,
                  total_sessions: Number(sellRow.total_sessions) || 0,
                },
                preloadClient: client,
              },
            })
          }} />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-2.5 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50 ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-slate-800 dark:bg-white/10'
        }`}>
          {toast.type === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} className="text-green-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
