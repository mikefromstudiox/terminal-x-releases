import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, History, Wifi, WifiOff, TrendingUp, Receipt, DollarSign, Clock, ShieldAlert, ShieldCheck, RefreshCw, FileBarChart, Palette, X as XIcon } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { useAuth } from '../../context/AuthContext'

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// FIX-C8 — single safe-parser shared with InvoiceList.jsx semantics.
function safeParseEcf(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return {} }
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function todayRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  return { from, to }
}

function monthRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  return { from, to }
}

// Cert expiry classifier — mirrors DGII's grace expectations.
//   expired: past expiry → BLOCKING (red, no e-CF emission).
//   critical: ≤ 7 days  → red banner, still functional.
//   warning: 8-30 days  → amber banner.
//   ok:     > 30 days   → green pill.
const MS_PER_DAY = 86_400_000
function classifyCertExpiry(cert) {
  if (!cert?.installed) return { state: 'missing', daysLeft: null }
  if (!cert.expiry) return { state: 'unknown', daysLeft: null }
  const exp = new Date(cert.expiry).getTime()
  if (!Number.isFinite(exp)) return { state: 'unknown', daysLeft: null }
  const daysLeft = Math.floor((exp - Date.now()) / MS_PER_DAY)
  if (cert.expired || daysLeft < 0) return { state: 'expired', daysLeft }
  if (daysLeft <= 7) return { state: 'critical', daysLeft }
  if (daysLeft <= 30) return { state: 'warning', daysLeft }
  return { state: 'ok', daysLeft }
}

export default function InvoiceDashboard() {
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const [todayTickets, setTodayTickets] = useState([])
  const [monthTickets, setMonthTickets] = useState([])
  const [recentTickets, setRecentTickets] = useState([])
  const [ecfStatus, setEcfStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  // FIX-C7 reconciler state
  const [reconciling, setReconciling] = useState(false)
  const [reconcileResult, setReconcileResult] = useState(null)
  // FIX-H4 — offline queue depth (renders only when > 0)
  const [offlineQueueCount, setOfflineQueueCount] = useState(0)

  // Custom-receipt branding modal (Facturación tier polish — invoice_footer
  // + logo URL persisted into app_settings via api.settings.update so the PDF
  // builder picks them up on every emisión without code changes).
  const [brandingOpen, setBrandingOpen] = useState(false)
  const [brandingFooter, setBrandingFooter] = useState('')
  const [brandingLogo, setBrandingLogo] = useState('')
  const [brandingSaving, setBrandingSaving] = useState(false)
  useEffect(() => {
    let cancelled = false
    async function loadBranding() {
      try {
        const s = (await api?.settings?.get?.()) || {}
        if (cancelled) return
        setBrandingFooter(s.invoice_footer || '')
        setBrandingLogo(s.logo_url || s.biz_logo || '')
      } catch {}
    }
    loadBranding()
    return () => { cancelled = true }
  }, [api])
  async function saveBranding() {
    setBrandingSaving(true)
    try {
      await api?.settings?.update?.({ invoice_footer: brandingFooter, logo_url: brandingLogo })
      setBrandingOpen(false)
    } catch (e) {
      alert(L('No se pudo guardar la personalización: ', 'Could not save branding: ') + (e?.message || ''))
    } finally {
      setBrandingSaving(false)
    }
  }
  useEffect(() => {
    let cancelled = false
    let unbind = () => {}
    async function load() {
      try {
        const mod = await import('@terminal-x/services/offline-ecf-queue')
        const update = async () => {
          if (cancelled) return
          try { setOfflineQueueCount(await mod.count()) } catch {}
        }
        update()
        const onEnq    = () => update()
        const onStatus = () => update()
        window.addEventListener('tx:ecf-queue-enqueued', onEnq)
        window.addEventListener('tx:ecf-queue-status', onStatus)
        window.addEventListener('tx:ecf-queue-drained', onStatus)
        unbind = () => {
          window.removeEventListener('tx:ecf-queue-enqueued', onEnq)
          window.removeEventListener('tx:ecf-queue-status', onStatus)
          window.removeEventListener('tx:ecf-queue-drained', onStatus)
        }
      } catch { /* electron build — ignore */ }
    }
    load()
    return () => { cancelled = true; unbind() }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { from: tFrom, to: tTo } = todayRange()
        const { from: mFrom, to: mTo } = monthRange()

        const [today, month, recent, cert] = await Promise.all([
          api?.tickets?.all?.({ dateFrom: tFrom, dateTo: tTo, status: 'cobrado' }) || [],
          api?.tickets?.all?.({ dateFrom: mFrom, dateTo: mTo, status: 'cobrado' }) || [],
          api?.tickets?.all?.({ limit: 10 }) || [],
          api?.dgii_ecf?.certInfo?.() || null,
        ])

        if (cancelled) return
        setTodayTickets(today || [])
        setMonthTickets(month || [])
        setRecentTickets((recent || []).slice(0, 10))
        setEcfStatus(cert)
      } catch (err) {
        console.error('[InvoiceDashboard]', err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [api])

  // FIX-C7 — EN_PROCESO reconciler. Web facturación-tier customers don't have
  // the desktop processDgiiQueue() background loop, so without this their
  // EN_PROCESO tickets never reach a final verdict. Poll every 5 minutes and
  // expose a manual button. Pending count comes straight from recentTickets.
  const pendingCount = recentTickets.filter(t => {
    const ecf = safeParseEcf(t.ecf_result)
    const st = String(ecf?.status || '').toUpperCase()
    return ecf?.trackId && (st === 'EN_PROCESO' || st === 'PENDIENTE' || st === '')
  }).length

  async function reconcileNow() {
    if (reconciling) return
    if (!api?.tickets?.reconcileEnProceso && !api?.dgii_ecf?.reconcileEnProceso) return
    setReconciling(true)
    try {
      const r = await (api?.dgii_ecf?.reconcileEnProceso?.() || api?.tickets?.reconcileEnProceso?.())
      setReconcileResult(r)
      // Refresh recent tickets after reconcile
      try {
        const recent = (await api?.tickets?.all?.({ limit: 10 })) || []
        setRecentTickets(recent.slice(0, 10))
      } catch {}
    } finally {
      setReconciling(false)
    }
  }

  useEffect(() => {
    if (!api?.dgii_ecf?.reconcileEnProceso) return
    // Auto-reconcile every 5 minutes (300_000 ms) as long as the dashboard is mounted.
    const id = setInterval(() => { reconcileNow() }, 5 * 60 * 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const todayCount = todayTickets.length
  const todayTotal = todayTickets.reduce((sum, t) => sum + Number(t.total || 0), 0)
  const monthCount = monthTickets.length
  const monthTotal = monthTickets.reduce((sum, t) => sum + Number(t.total || 0), 0)

  const bizName = user?.business_name || user?.name || 'Tu Negocio'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-white/10 border-t-[#b3001e] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">{L('Facturacion', 'Invoicing')}</h1>
          <p className="text-sm text-slate-500 dark:text-white/50">{bizName}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setBrandingOpen(true)}
            title={L('Personalizar recibo (logo + pie de página)', 'Customize receipt (logo + footer)')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40 text-slate-700 dark:text-white text-xs font-semibold transition-colors"
          >
            <Palette size={14} /> {L('Personalizar', 'Customize')}
          </button>
          <CertStatusPill cert={ecfStatus} L={L} />
        </div>
      </div>

      <CertExpiryBanner cert={ecfStatus} L={L} onConfigure={() => navigate('/dgii')} />

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Receipt, label: L('Facturas Hoy', 'Invoices Today'), value: todayCount, color: 'text-[#b3001e]' },
          { icon: DollarSign, label: L('Total Hoy', 'Total Today'), value: fmtRD(todayTotal), color: 'text-[#b3001e]' },
          { icon: TrendingUp, label: L('Facturas Este Mes', 'Invoices This Month'), value: monthCount, color: 'text-[#b3001e]' },
          { icon: DollarSign, label: L('Total Este Mes', 'Total This Month'), value: fmtRD(monthTotal), color: 'text-[#b3001e]' },
        ].map((card, i) => (
          <div key={i} className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-[#b3001e]/10 flex items-center justify-center">
                <card.icon size={16} className="text-[#b3001e]" />
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-white/50">{card.label}</span>
            </div>
            <p className={`text-xl font-bold ${card.color} dark:text-white`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => navigate('/invoicing/create')}
          className="flex items-center gap-2 px-5 py-3 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold rounded-xl transition-colors shadow-lg shadow-red-500/20"
        >
          <Plus size={18} />
          {L('Nueva Factura', 'New Invoice')}
        </button>
        <button
          onClick={() => navigate('/invoicing/history')}
          className="flex items-center gap-2 px-5 py-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
        >
          <History size={18} />
          {L('Ver Historial', 'View History')}
        </button>
      </div>

      {/* Quick links — Cotizaciones + Notas de Crédito + 606/607 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/invoicing/quotes')}
          className="flex items-center gap-3 p-4 bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40 transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-[#b3001e]/10 flex items-center justify-center shrink-0">
            <FileText size={18} className="text-[#b3001e]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-white">{L('Cotizaciones', 'Quotes')}</p>
            <p className="text-xs text-slate-500 dark:text-white/50">{L('Borradores que se convierten en factura', 'Drafts that become real invoices')}</p>
          </div>
        </button>
        <button
          onClick={() => navigate('/credit-notes')}
          className="flex items-center gap-3 p-4 bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40 transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-[#b3001e]/10 flex items-center justify-center shrink-0">
            <FileText size={18} className="text-[#b3001e]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-white">{L('Notas de Crédito (E33/E34)', 'Credit Notes (E33/E34)')}</p>
            <p className="text-xs text-slate-500 dark:text-white/50">{L('Anular o corregir facturas emitidas', 'Void or correct issued invoices')}</p>
          </div>
        </button>
        <button
          onClick={() => navigate('/dgii')}
          className="flex items-center gap-3 p-4 bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40 transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-[#b3001e]/10 flex items-center justify-center shrink-0">
            <FileBarChart size={18} className="text-[#b3001e]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-white">{L('Reportes 606 y 607', '606 and 607 Reports')}</p>
            <p className="text-xs text-slate-500 dark:text-white/50">{L('Exportar TXT mensual para tu contador', 'Export monthly TXT for your accountant')}</p>
          </div>
        </button>
      </div>

      {/* FIX-H4 — offline queue indicator. Only renders when there's work
          waiting to be replayed against DGII (network came back). */}
      {offlineQueueCount > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-[#b3001e]/5 border border-[#b3001e]/30">
          <WifiOff size={18} className="text-[#b3001e] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#b3001e]">
              {L(`${offlineQueueCount} factura${offlineQueueCount === 1 ? '' : 's'} pendiente${offlineQueueCount === 1 ? '' : 's'} de reenvío diferido`, `${offlineQueueCount} invoice${offlineQueueCount === 1 ? '' : 's'} queued for deferred resubmission`)}
            </p>
            <p className="text-xs text-[#b3001e] opacity-80">{L('Se enviarán automáticamente cuando vuelva la conexión (regla DGII 72h).', 'They will auto-send when the connection returns (DGII 72h rule).')}</p>
          </div>
        </div>
      )}

      {/* EN_PROCESO reconciler — only shows when there's pending work */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20">
          <Clock size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
              {L(`${pendingCount} factura${pendingCount === 1 ? '' : 's'} en proceso en DGII`, `${pendingCount} invoice${pendingCount === 1 ? '' : 's'} pending at DGII`)}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 opacity-80">
              {reconcileResult
                ? L(`Última verificación: ${reconcileResult.updated} actualizada${reconcileResult.updated === 1 ? '' : 's'}, ${reconcileResult.stillPending} aún pendiente${reconcileResult.stillPending === 1 ? '' : 's'}`, `Last check: ${reconcileResult.updated} updated, ${reconcileResult.stillPending} still pending`)
                : L('Verificación automática cada 5 minutos', 'Auto-check every 5 minutes')}
            </p>
          </div>
          <button
            onClick={reconcileNow}
            disabled={reconciling}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-xs font-bold disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={reconciling ? 'animate-spin' : ''} />
            {reconciling ? L('Verificando...', 'Checking...') : L('Verificar ahora', 'Check now')}
          </button>
        </div>
      )}

      {/* Recent invoices */}
      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-sm font-bold text-slate-700 dark:text-white">{L('Facturas Recientes', 'Recent Invoices')}</h2>
          <button onClick={() => navigate('/invoicing/history')} className="text-xs text-[#b3001e] font-semibold hover:underline">
            {L('Ver todas', 'View all')}
          </button>
        </div>
        {recentTickets.length === 0 ? (
          <div className="py-12 text-center">
            <FileText size={40} className="mx-auto text-slate-300 dark:text-white/20 mb-3" />
            <p className="text-sm text-slate-500 dark:text-white/50">{L('No hay facturas aun', 'No invoices yet')}</p>
            <button onClick={() => navigate('/invoicing/create')} className="mt-3 text-sm font-semibold text-[#b3001e] hover:underline">
              {L('Crear tu primera factura', 'Create your first invoice')}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {recentTickets.map((t) => {
              const ecf = safeParseEcf(t.ecf_result)
              return (
                <div
                  key={t.id}
                  onClick={() => navigate('/invoicing/history')}
                  className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0">
                      <FileText size={14} className="text-slate-500 dark:text-white/50" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-white truncate">
                        {t.doc_number || t.id} {t.client_name ? `- ${t.client_name}` : ''}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-white/40">
                        {fmtDate(t.created_at)} {ecf?.eNCF ? `| ${ecf.eNCF}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-bold text-slate-800 dark:text-white">{fmtRD(t.total)}</p>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      t.status === 'cobrado' ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400' :
                      t.status === 'anulado' ? 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400' :
                      'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                    }`}>
                      {t.status === 'cobrado' ? L('Cobrado', 'Paid') : t.status === 'anulado' ? L('Anulado', 'Voided') : L('Pendiente', 'Pending')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Branding modal — facturación-tier custom receipt config */}
      {brandingOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={() => !brandingSaving && setBrandingOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-[#b3001e]/5 border-b border-[#b3001e]/20 px-5 py-4 flex items-center gap-2">
              <Palette size={18} className="text-[#b3001e]" />
              <h3 className="text-base font-bold text-[#b3001e] flex-1">{L('Personalizar Recibo', 'Customize Receipt')}</h3>
              <button onClick={() => setBrandingOpen(false)} className="p-1 hover:bg-black/5 rounded">
                <XIcon size={16} className="text-slate-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">{L('Pie de página personalizado', 'Custom footer')}</label>
                <textarea
                  value={brandingFooter}
                  onChange={e => setBrandingFooter(e.target.value.slice(0, 200))}
                  rows={3}
                  placeholder={L('Ej: Términos y condiciones en www.minegocio.com — Tel +1 809 555 0123', 'e.g. Terms at www.mybusiness.com — Tel +1 809 555 0123')}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30 resize-none"
                />
                <p className="mt-1 text-[10px] text-slate-400">{brandingFooter.length}/200 · {L('Aparece debajo de "Conserve este comprobante" en cada PDF.', 'Shown beneath "Conserve este comprobante" on every PDF.')}</p>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">{L('Logo URL', 'Logo URL')}</label>
                <input
                  type="url"
                  value={brandingLogo}
                  onChange={e => setBrandingLogo(e.target.value.slice(0, 500))}
                  placeholder="https://…/logo.png"
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                />
                <p className="mt-1 text-[10px] text-slate-400">{L('PNG o JPG, idealmente cuadrado o más ancho que alto. Se imprime sobre la franja crimson.', 'PNG or JPG, ideally square or wider than tall. Renders on the crimson header band.')}</p>
              </div>
            </div>
            <div className="px-5 py-4 bg-slate-50 dark:bg-white/5 flex justify-end gap-2 border-t border-slate-100 dark:border-white/5">
              <button
                onClick={() => setBrandingOpen(false)}
                disabled={brandingSaving}
                className="px-4 py-2 rounded-lg bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-sm font-semibold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/15 transition-colors disabled:opacity-50"
              >
                {L('Cancelar', 'Cancel')}
              </button>
              <button
                onClick={saveBranding}
                disabled={brandingSaving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-sm font-bold disabled:opacity-50 transition-colors"
              >
                {brandingSaving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                {brandingSaving ? L('Guardando...', 'Saving...') : L('Guardar', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Certificate status — header pill ──────────────────────────────────────
function CertStatusPill({ cert, L }) {
  const c = classifyCertExpiry(cert)
  if (c.state === 'missing') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
        <WifiOff size={14} className="text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{L('Sin certificado', 'No certificate')}</span>
      </div>
    )
  }
  if (c.state === 'expired') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/30">
        <ShieldAlert size={14} className="text-[#b3001e]" />
        <span className="text-xs font-semibold text-[#b3001e]">{L('Certificado VENCIDO', 'Certificate EXPIRED')}</span>
      </div>
    )
  }
  if (c.state === 'critical') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/30">
        <ShieldAlert size={14} className="text-[#b3001e]" />
        <span className="text-xs font-semibold text-[#b3001e]">{L(`Vence en ${c.daysLeft} día${c.daysLeft === 1 ? '' : 's'}`, `Expires in ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'}`)}</span>
      </div>
    )
  }
  if (c.state === 'warning') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
        <ShieldAlert size={14} className="text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{L(`Vence en ${c.daysLeft} días`, `Expires in ${c.daysLeft} days`)}</span>
      </div>
    )
  }
  // ok / unknown
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
      <ShieldCheck size={14} className="text-green-600 dark:text-green-400" />
      <span className="text-xs font-semibold text-green-700 dark:text-green-400">{L('Conectado a DGII', 'Connected to DGII')}</span>
    </div>
  )
}

// ── Certificate expiry — full-width banner (only when action needed) ──────
function CertExpiryBanner({ cert, L, onConfigure }) {
  const c = classifyCertExpiry(cert)
  if (c.state === 'ok' || c.state === 'unknown' || c.state === 'missing') return null
  const isBlocking = c.state === 'expired' || c.state === 'critical'
  const palette = isBlocking
    ? { bg: 'bg-[#b3001e]/5', border: 'border-[#b3001e]/30', icon: 'text-[#b3001e]', text: 'text-[#b3001e]', btnBg: 'bg-[#b3001e] hover:bg-[#8c0017] text-white' }
    : { bg: 'bg-amber-50 dark:bg-amber-500/5', border: 'border-amber-200 dark:border-amber-500/20', icon: 'text-amber-600 dark:text-amber-400', text: 'text-amber-800 dark:text-amber-300', btnBg: 'bg-amber-600 hover:bg-amber-700 text-white' }
  const title = c.state === 'expired'
    ? L('Tu certificado e-CF VENCIÓ — no podrás emitir nuevas facturas', 'Your e-CF certificate has EXPIRED — you cannot issue new invoices')
    : c.state === 'critical'
      ? L(`Tu certificado vence en ${c.daysLeft} día${c.daysLeft === 1 ? '' : 's'} — renueva ya con Viafirma`, `Your certificate expires in ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'} — renew now with Viafirma`)
      : L(`Tu certificado vence en ${c.daysLeft} días — planifica la renovación`, `Your certificate expires in ${c.daysLeft} days — plan the renewal`)
  const subject = cert?.subject ? ` (${cert.subject})` : ''
  const expiry = cert?.expiry ? new Date(cert.expiry).toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' }) : ''
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${palette.bg} ${palette.border}`}>
      <ShieldAlert size={20} className={`shrink-0 mt-0.5 ${palette.icon}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${palette.text}`}>{title}</p>
        {expiry && <p className={`text-xs mt-0.5 ${palette.text} opacity-80`}>{L('Fecha de vencimiento', 'Expiry date')}: {expiry}{subject}</p>}
      </div>
      <button onClick={onConfigure} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shrink-0 ${palette.btnBg}`}>
        {L('Renovar', 'Renew')}
      </button>
    </div>
  )
}
