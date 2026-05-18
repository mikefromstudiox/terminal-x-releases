import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Search, Download, Send, X, AlertCircle, Check, Plus, ArrowLeft, Loader2, QrCode, Ban, FileSpreadsheet } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { useAuth } from '../../context/AuthContext'
import { waLink } from '@terminal-x/services/whatsapp'
const saveReceiptPDF = (...args) => import('@terminal-x/services/pdf').then(m => m.saveReceiptPDF(...args))
import { getQRCode } from '@terminal-x/services/ecf'

// FIX-C8 — single safe-parser for ecf_result. Eliminates the 6 ad-hoc
// JSON.parse call sites flagged in the audit (§3.2.b) and gives every
// renderer a stable shape even when the column holds malformed JSON.
function safeParseEcf(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return {} }
}

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDateTime(d) {
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function todayRange() {
  const now = new Date()
  return {
    from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString(),
  }
}

function weekRange() {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  monday.setHours(0, 0, 0, 0)
  return {
    from: monday.toISOString(),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString(),
  }
}

function monthRange() {
  const now = new Date()
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString(),
  }
}

const TABS = [
  { key: 'all', es: 'Todas', en: 'All' },
  { key: 'today', es: 'Hoy', en: 'Today' },
  { key: 'week', es: 'Esta Semana', en: 'This Week' },
  { key: 'month', es: 'Este Mes', en: 'This Month' },
]

export default function InvoiceList() {
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [empresa, setEmpresa] = useState(null)
  const [brandingSettings, setBrandingSettings] = useState({ invoice_footer: '', logo_url: '' })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = (await api?.settings?.get?.()) || {}
        if (!cancelled) setBrandingSettings({ invoice_footer: s.invoice_footer || '', logo_url: s.logo_url || s.biz_logo || '' })
      } catch (e) { try { window.__txReportError?.(e, { severity: 'warn', category: 'invoiceList.branding_load' }) } catch {} }
    })()
    return () => { cancelled = true }
  }, [api])

  // Load tickets
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const params = { limit: 500 }
        if (tab === 'today') { const r = todayRange(); params.dateFrom = r.from; params.dateTo = r.to }
        else if (tab === 'week') { const r = weekRange(); params.dateFrom = r.from; params.dateTo = r.to }
        else if (tab === 'month') { const r = monthRange(); params.dateFrom = r.from; params.dateTo = r.to }

        const [data, emp] = await Promise.all([
          api?.tickets?.all?.(params) || [],
          empresa ? Promise.resolve(empresa) : api?.admin?.getEmpresa?.() || null,
        ])
        if (cancelled) return
        setTickets(data || [])
        if (emp) setEmpresa(emp)
      } catch (err) {
        console.error('[InvoiceList]', err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [api, tab])

  // FIX-M8 — parse ecf_result ONCE per row and stash it as `_ecf`. Every
  // downstream renderer (table, detail modal, search) reads from the cached
  // shape instead of re-parsing on every keystroke.
  const ticketsParsed = useMemo(
    () => (tickets || []).map(t => ({ ...t, _ecf: safeParseEcf(t.ecf_result) })),
    [tickets]
  )

  // Filter + search — operates on pre-parsed rows so search keystrokes don't
  // re-JSON.parse the entire list.
  const filtered = useMemo(() => {
    let rows = ticketsParsed
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(t =>
        (t.client_name || '').toLowerCase().includes(q) ||
        (t.client_rnc || '').includes(q) ||
        (t._ecf?.eNCF || '').toLowerCase().includes(q) ||
        (t.doc_number || '').toLowerCase().includes(q)
      )
    }
    if (filterType) {
      rows = rows.filter(t => (t.comprobante_type || '').startsWith(filterType))
    }
    if (filterStatus) {
      rows = rows.filter(t => t.status === filterStatus)
    }
    return rows
  }, [ticketsParsed, search, filterType, filterStatus])

  // Summary stats
  const totalFacturas = filtered.length
  const montoTotal = filtered.reduce((s, t) => s + Number(t.total || 0), 0)
  const itbisTotal = filtered.reduce((s, t) => s + Number(t.itbis || 0), 0)
  const pendientes = filtered.filter(t => t.status === 'pendiente').length

  // Open detail
  async function openDetail(ticket) {
    setDetailLoading(true)
    setDetail(ticket)
    try {
      const full = await api?.tickets?.byId?.(ticket.id)
      if (full) setDetail(full)
    } catch (e) { try { window.__txReportError?.(e, { severity: 'warn', category: 'invoiceList.openDetail.byId_failed', extra: { ticket_id: ticket?.id } }) } catch {} }
    setDetailLoading(false)
  }

  // PDF
  async function downloadPDF(t) {
    const ecf = t._ecf || safeParseEcf(t.ecf_result)
    await saveReceiptPDF({
      docNo: ecf?.eNCF || t.doc_number || `T-${t.id}`,
      ncf: ecf?.eNCF || t.comprobante_type || '',
      ncfType: t.comprobante_type || 'E32',
      total: t.total, subtotal: t.subtotal || t.total, itbis: t.itbis || 0, ley: t.ley || 0, descuento: t.descuento || 0,
      formaPago: t.payment_method || 'efectivo',
      services: (t.items || []).map(i => ({ name: i.name, price: i.price, qty: i.quantity || 1 })),
      biz: {
        name: empresa?.name || '',
        rnc: empresa?.rnc || '',
        phone: empresa?.phone || '',
        address: empresa?.address || '',
        logo: brandingSettings.logo_url,
        invoice_footer: brandingSettings.invoice_footer,
      },
      customFooter: brandingSettings.invoice_footer,
      client: t.client_name ? { name: t.client_name, rnc: t.client_rnc } : null,
      paidAt: t.created_at,
      securityCode: ecf?.securityCode,
      signatureDate: ecf?.signatureDate,
      qrLink: ecf?.qrLink,
    }, api)
  }

  // WhatsApp — FIX-C2. Pull the client phone from the embedded ticket row OR
  // hydrate via api.clients.byId so we never open `wa.me/` with no recipient.
  // If no phone is on file we surface a Spanish toast instead of opening an
  // empty WhatsApp prompt.
  async function sendWhatsApp(t) {
    const ecf = safeParseEcf(t.ecf_result)
    let phone = (t.client_phone || t.phone || '').toString()
    if (!phone && (t.client_id || t.client_supabase_id)) {
      try {
        const client = await api?.clients?.byId?.(t.client_id || t.client_supabase_id)
        phone = (client?.phone || '').toString()
      } catch (e) { try { window.__txReportError?.(e, { severity: 'warn', category: 'invoiceList.whatsapp.client_phone_lookup' }) } catch {} }
    }
    if (!phone || !phone.replace(/\D/g, '')) {
      alert(L('Este cliente no tiene teléfono registrado. Edita el cliente y agrega el número antes de enviar por WhatsApp.', 'This client has no phone on file. Edit the client and add a number before sending via WhatsApp.'))
      return
    }
    const text = `Factura ${ecf?.eNCF || t.doc_number}\nTotal: ${fmtRD(t.total)}${ecf?.qrLink ? `\nVerificar: ${ecf.qrLink}` : ''}`
    window.open(waLink(phone, text), '_blank')
  }


  // FIX-M7 — crimson confirm modal replaces the native browser confirm()
  // because the brand book disallows native dialogs (no gray system chrome).
  // Two-state: voidCandidate=null (closed) | voidCandidate=ticket (open).
  const [voidCandidate, setVoidCandidate] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)

  function askVoid(t) {
    setVoidReason('')
    setVoidCandidate(t)
  }

  async function confirmVoid() {
    const t = voidCandidate
    if (!t || voiding) return
    setVoiding(true)
    try {
      await api?.tickets?.void?.({ id: t.id, reason: voidReason || null, voidById: user?.id })
      setTickets(prev => prev.map(tk => tk.id === t.id ? { ...tk, status: 'anulado' } : tk))
      // FIX-M6 — emit invoice_voided activity row so the Owner Activity Feed
      // can surface it. Best-effort: the void itself is what matters.
      try {
        await api?.activity?.record?.({
          event_type: 'invoice_voided',
          severity: 'warn',
          target_type: 'ticket',
          target_id: t.id,
          target_name: t._ecf?.eNCF || t.doc_number || `T-${t.id}`,
          amount: Number(t.total || 0),
          reason: voidReason || null,
          metadata: { eNCF: t._ecf?.eNCF || null, comprobante_type: t.comprobante_type || null },
        })
      } catch (err) {
        try { window.__txReportError?.(err, { severity: 'warn', category: 'invoice.void.activity_log', extra: { ticketId: t.id, eNCF: t._ecf?.eNCF || null } }) } catch {}
      }
      setDetail(null)
      setVoidCandidate(null)
    } catch (err) {
      alert(err.message || L('Error al anular', 'Error voiding'))
    } finally {
      setVoiding(false)
    }
  }

  // FIX-M5 — CSV export of the currently-filtered Historial. Mirrors the on-
  // screen columns + adds eNCF / trackId / status so the operator can hand
  // it straight to their contador without further reformatting. Excel-safe
  // (BOM + CRLF + comma-quoted strings) for opening with es-DO locale.
  function exportCSV() {
    if (!filtered.length) {
      alert(L('No hay facturas que exportar.', 'No invoices to export.'))
      return
    }
    const headers = ['Documento', 'Fecha', 'Cliente', 'RNC', 'Tipo', 'eNCF', 'TrackId', 'Subtotal', 'ITBIS', 'Total', 'Estado DGII', 'Estado']
    const lines = [headers.join(',')]
    for (const t of filtered) {
      const ecf = t._ecf || {}
      const cells = [
        t.doc_number || '',
        new Date(t.created_at).toISOString(),
        t.client_name || '',
        t.client_rnc || '',
        t.comprobante_type || '',
        ecf.eNCF || '',
        ecf.trackId || '',
        Number(t.subtotal || 0).toFixed(2),
        Number(t.itbis || 0).toFixed(2),
        Number(t.total || 0).toFixed(2),
        ecf.status || '',
        t.status || '',
      ].map(v => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      })
      lines.push(cells.join(','))
    }
    // Excel-on-Windows wants UTF-8 BOM + CRLF for proper accent rendering.
    const csv = '﻿' + lines.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = new Date().toISOString().slice(0, 10)
    a.download = `facturacion-historial-${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/invoicing')} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-slate-500 dark:text-white/50" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">{L('Historial de Facturas', 'Invoice History')}</h1>
        </div>
        <button
          onClick={exportCSV}
          title={L('Exportar Historial a CSV', 'Export History to CSV')}
          className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40 text-slate-700 dark:text-white font-semibold rounded-xl text-sm transition-colors"
        >
          <FileSpreadsheet size={16} /> CSV
        </button>
        <button
          onClick={() => navigate('/invoicing/create')}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold rounded-xl text-sm transition-colors"
        >
          <Plus size={16} /> {L('Nueva', 'New')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-white/10 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'bg-[#b3001e] text-white'
                : 'text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            {lang === 'es' ? t.es : t.en}
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={L('Buscar por cliente, RNC, eNCF...', 'Search by client, RNC, eNCF...')}
            style={{ paddingLeft: 40 }}
            className="w-full pr-4 py-2.5 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-[#b3001e]/30"
          />
        </div>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-white outline-none"
        >
          <option value="">{L('Todos los tipos', 'All types')}</option>
          <option value="E31">E31 - {L('Credito Fiscal', 'Tax Credit')}</option>
          <option value="E32">E32 - {L('Consumidor', 'Consumer')}</option>
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-white outline-none"
        >
          <option value="">{L('Todos los estados', 'All statuses')}</option>
          <option value="cobrado">{L('Cobrado', 'Paid')}</option>
          <option value="pendiente">{L('Pendiente', 'Pending')}</option>
          <option value="anulado">{L('Anulado', 'Voided')}</option>
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: L('Total Facturas', 'Total Invoices'), value: totalFacturas },
          { label: L('Monto Total', 'Total Amount'), value: fmtRD(montoTotal) },
          { label: L('ITBIS Total', 'Total ITBIS'), value: fmtRD(itbisTotal) },
          { label: L('Pendientes', 'Pending'), value: pendientes },
        ].map((c, i) => (
          <div key={i} className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-4">
            <p className="text-xs text-slate-500 dark:text-white/50">{c.label}</p>
            <p className="text-lg font-bold text-slate-800 dark:text-white mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 size={24} className="animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FileText size={40} className="mx-auto text-slate-300 dark:text-white/20 mb-3" />
            <p className="text-sm text-slate-500 dark:text-white/50">{L('No se encontraron facturas', 'No invoices found')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                  <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-white/60">#</th>
                  <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-white/60">{L('Fecha', 'Date')}</th>
                  <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-white/60">{L('Cliente', 'Client')}</th>
                  <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-white/60">RNC</th>
                  <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-white/60">{L('Tipo', 'Type')}</th>
                  <th className="text-left py-3 px-4 font-bold text-slate-600 dark:text-white/60">eNCF</th>
                  <th className="text-right py-3 px-4 font-bold text-slate-600 dark:text-white/60">Total</th>
                  <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-white/60">{L('Estado', 'Status')}</th>
                  <th className="text-center py-3 px-4 font-bold text-slate-600 dark:text-white/60">{L('Acciones', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map(t => {
                  const ecf = t._ecf || {}
                  return (
                    <tr
                      key={t.id}
                      onClick={() => openDetail(t)}
                      className="hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-white/60">{t.doc_number}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-white/60 whitespace-nowrap">{fmtDate(t.created_at)}</td>
                      <td className="py-3 px-4 font-medium text-slate-800 dark:text-white">{t.client_name || '-'}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 dark:text-white/40">{t.client_rnc || '-'}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/10 text-xs font-semibold text-slate-600 dark:text-white/60">
                          {t.comprobante_type || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 dark:text-white/70">{ecf?.eNCF || '-'}</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-white">{fmtRD(t.total)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          t.status === 'cobrado' ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400' :
                          t.status === 'anulado' ? 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400' :
                          'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                        }`}>
                          {t.status === 'cobrado' ? L('Cobrado', 'Paid') : t.status === 'anulado' ? L('Anulado', 'Voided') : L('Pendiente', 'Pending')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => downloadPDF(t)} title={L('Descargar PDF', 'Download PDF')} className="p-1.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
                            <Download size={14} className="text-slate-500 dark:text-white/50" />
                          </button>
                          <button onClick={() => sendWhatsApp(t)} title="WhatsApp" className="p-1.5 hover:bg-green-50 dark:hover:bg-green-500/10 rounded-lg transition-colors">
                            <Send size={14} className="text-green-600 dark:text-green-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setDetail(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-white/10">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">{L('Detalle de Factura', 'Invoice Detail')}</h3>
              <button onClick={() => setDetail(null)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {detailLoading && (
                <div className="flex justify-center py-4">
                  <Loader2 size={20} className="animate-spin text-slate-400" />
                </div>
              )}

              {/* Info header */}
              {(() => {
                const ecf = detail._ecf || safeParseEcf(detail.ecf_result)
                return (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-slate-500 dark:text-white/50">{L('Documento', 'Document')}</p>
                        <p className="font-bold text-slate-800 dark:text-white">{detail.doc_number}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-white/50">{L('Fecha', 'Date')}</p>
                        <p className="font-medium text-slate-800 dark:text-white">{fmtDateTime(detail.created_at)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-white/50">{L('Cliente', 'Client')}</p>
                        <p className="font-medium text-slate-800 dark:text-white">{detail.client_name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-white/50">RNC</p>
                        <p className="font-mono text-slate-800 dark:text-white">{detail.client_rnc || '-'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-white/50">{L('Tipo', 'Type')}</p>
                        <p className="font-medium text-slate-800 dark:text-white">{detail.comprobante_type || '-'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-white/50">{L('Pago', 'Payment')}</p>
                        <p className="font-medium text-slate-800 dark:text-white capitalize">{detail.payment_method || '-'}</p>
                      </div>
                    </div>

                    {/* Items */}
                    {detail.items?.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-2">Items</p>
                        <div className="bg-slate-50 dark:bg-white/5 rounded-lg divide-y divide-slate-100 dark:divide-white/5">
                          {detail.items.map((item, i) => (
                            <div key={i} className="flex justify-between px-4 py-2.5 text-sm">
                              <span className="text-slate-700 dark:text-white">
                                {(item.quantity || 1) > 1 ? `${item.quantity}x ` : ''}{item.name}
                              </span>
                              <span className="font-medium text-slate-800 dark:text-white">
                                {fmtRD(Number(item.price) * (item.quantity || 1))}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Totals */}
                    <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500 dark:text-white/50">Subtotal</span>
                        <span className="text-slate-800 dark:text-white">{fmtRD(detail.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500 dark:text-white/50">ITBIS</span>
                        <span className="text-slate-800 dark:text-white">{fmtRD(detail.itbis)}</span>
                      </div>
                      <div className="h-px bg-slate-200 dark:bg-white/10" />
                      <div className="flex justify-between">
                        <span className="font-bold text-slate-800 dark:text-white">Total</span>
                        <span className="font-extrabold text-[#b3001e]">{fmtRD(detail.total)}</span>
                      </div>
                    </div>

                    {/* e-CF info */}
                    {ecf?.eNCF && (
                      <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-4 space-y-2">
                        <p className="text-xs font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider">e-CF</p>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500 dark:text-white/50">eNCF</span>
                          <span className="font-mono font-bold text-slate-800 dark:text-white">{ecf.eNCF}</span>
                        </div>
                        {ecf.trackId && (
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500 dark:text-white/50">TrackId</span>
                            <span className="font-mono text-xs text-slate-600 dark:text-white/60">{ecf.trackId}</span>
                          </div>
                        )}
                        {ecf.securityCode && (
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500 dark:text-white/50">{L('Codigo Seguridad', 'Security Code')}</span>
                            <span className="font-mono text-slate-800 dark:text-white">{ecf.securityCode}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500 dark:text-white/50">Status</span>
                          <span className={`font-bold ${ecf.status === 'ACEPTADO' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {ecf.status || '-'}
                          </span>
                        </div>
                        {ecf.qrLink && (
                          <div className="flex justify-center pt-2">
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=4&data=${encodeURIComponent(ecf.qrLink)}`}
                              alt="QR"
                              width="120"
                              height="120"
                              className="rounded-lg"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => downloadPDF(detail)} className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 rounded-lg text-sm font-semibold text-slate-700 dark:text-white transition-colors">
                        <Download size={14} /> PDF
                      </button>
                      <button onClick={() => sendWhatsApp(detail)} className="flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-500/10 hover:bg-green-200 dark:hover:bg-green-500/15 rounded-lg text-sm font-semibold text-green-700 dark:text-green-400 transition-colors">
                        <Send size={14} /> WhatsApp
                      </button>
                      {detail.status !== 'anulado' && (
                        <button onClick={() => askVoid(detail)} className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/15 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 transition-colors ml-auto">
                          <Ban size={14} /> {L('Anular', 'Void')}
                        </button>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* FIX-M7 — crimson confirm-void modal (replaces native confirm()). */}
      {voidCandidate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={() => !voiding && setVoidCandidate(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-[#b3001e]/5 border-b border-[#b3001e]/20 px-5 py-4 flex items-center gap-2">
              <Ban size={18} className="text-[#b3001e]" />
              <h3 className="text-base font-bold text-[#b3001e]">{L('Anular factura', 'Void invoice')}</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-700 dark:text-white/80">
                {L('Vas a anular la factura', 'You are voiding invoice')}{' '}
                <span className="font-mono font-bold">{voidCandidate._ecf?.eNCF || voidCandidate.doc_number}</span>{' '}
                {L('por', 'for')}{' '}
                <span className="font-bold">{fmtRD(voidCandidate.total)}</span>.{' '}
                {L('Esta acción se enviará a DGII vía ANECF y no se puede deshacer.', 'This action is sent to DGII via ANECF and cannot be undone.')}
              </p>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">
                  {L('Motivo (opcional)', 'Reason (optional)')}
                </label>
                <input
                  type="text"
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  placeholder={L('Ej: error en el monto, cliente equivocado…', 'e.g. wrong amount, wrong client…')}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                />
              </div>
            </div>
            <div className="px-5 py-4 bg-slate-50 dark:bg-white/5 flex justify-end gap-2 border-t border-slate-100 dark:border-white/5">
              <button
                onClick={() => setVoidCandidate(null)}
                disabled={voiding}
                className="px-4 py-2 rounded-lg bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-sm font-semibold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/15 transition-colors disabled:opacity-50"
              >
                {L('Cancelar', 'Cancel')}
              </button>
              <button
                onClick={confirmVoid}
                disabled={voiding}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-sm font-bold disabled:opacity-50 transition-colors"
              >
                {voiding ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                {voiding ? L('Anulando...', 'Voiding...') : L('Anular factura', 'Void invoice')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
