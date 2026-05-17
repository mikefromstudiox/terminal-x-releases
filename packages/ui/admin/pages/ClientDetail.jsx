import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Loader2, Building2, KeyRound, Users, ShoppingCart, Save, X, ShieldCheck, ShieldAlert, Lock, Pencil, Calendar, MapPin, Plus, Trash2, Gift, Mail, Send, CheckCircle2, XCircle, MessageCircle, RefreshCw, AlertTriangle, AlertCircle, Activity } from 'lucide-react'
import { useLang } from '../../i18n'
import OnboardingChecklist from '../components/OnboardingChecklist'
import QuickActions from '../components/QuickActions'
import ConfigEditor from '../components/ConfigEditor'
import { listContainer, listItem } from '../motion'

const ROLE_LABELS = {
  owner:      { es: 'Dueño',    en: 'Owner' },
  manager:    { es: 'Gerente',  en: 'Manager' },
  cfo:        { es: 'CFO',      en: 'CFO' },
  accountant: { es: 'Contador', en: 'Accountant' },
  cashier:    { es: 'Cajero',   en: 'Cashier' },
  tech:       { es: 'Técnico',  en: 'Tech' },
  none:       { es: '—',        en: '—' },
}
const roleLbl = (r, lang) => (ROLE_LABELS[r]?.[lang] || r || '—')

const STATUS_CLS_LIGHT = {
  active:    'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  pending:   'bg-amber-500/10 text-amber-600 border-amber-500/30',
  suspended: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25',
  expired:   'bg-black/5 text-black/40 border-black/10',
}

const STATUS_CLS_DARK = {
  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  pending:   'bg-amber-500/10 text-amber-400 border-amber-500/30',
  suspended: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30',
  expired:   'bg-white/5 text-white/40 border-white/10',
}

export default function ClientDetail({ getToken, refreshToken, isDark }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [pinStaffId, setPinStaffId] = useState(null)
  const [pinValue, setPinValue] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinOk, setPinOk] = useState(false)
  const [pinErr, setPinErr] = useState('')
  const [deletingStaffId, setDeletingStaffId] = useState(null)
  const [visits, setVisits] = useState([])
  const [showVisitForm, setShowVisitForm] = useState(false)
  const [visitDate, setVisitDate] = useState('')
  const [visitType, setVisitType] = useState('onsite')
  const [visitNotes, setVisitNotes] = useState('')
  const [savingVisit, setSavingVisit] = useState(false)
  const [loyalty, setLoyalty] = useState(null)
  const [loyaltyLoading, setLoyaltyLoading] = useState(false)
  const [digestStatus, setDigestStatus] = useState(null)
  const [digestSending, setDigestSending] = useState(false)
  const [digestMsg, setDigestMsg] = useState(null)
  const [errors, setErrors] = useState(null)
  const [errorsLoading, setErrorsLoading] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  // e-CF certificate rotation history — loaded lazily when the section expands.
  const [certHistory, setCertHistory] = useState(null)
  const [certHistoryLoading, setCertHistoryLoading] = useState(false)
  const [certHistoryOpen, setCertHistoryOpen] = useState(false)
  // UltraMsg WhatsApp creds + live status.
  const [waCreds, setWaCreds] = useState({ instance: '', token_masked: '', has_token: false })
  const [waInstance, setWaInstance] = useState('')
  const [waToken, setWaToken] = useState('')
  const [waStatus, setWaStatus] = useState(null) // {state, message, instance}
  const [waLoading, setWaLoading] = useState(false)
  const [waSaving, setWaSaving] = useState(false)
  const [waEditing, setWaEditing] = useState(false)

  async function loadWhatsapp() {
    if (!id) return
    setWaLoading(true)
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      const headers = { 'Authorization': `Bearer ${token}` }
      const [credsResp, statusResp] = await Promise.all([
        fetch(`/api/panel?action=ultramsg_get&business_id=${id}`, { headers }),
        fetch(`/api/panel?action=ultramsg_status&business_id=${id}`, { headers }),
      ])
      const credsJson = await credsResp.json().catch(() => ({}))
      const statusJson = await statusResp.json().catch(() => ({}))
      if (credsJson.data) {
        setWaCreds(credsJson.data)
        setWaInstance(credsJson.data.instance || '')
      }
      if (statusJson.data) setWaStatus(statusJson.data)
    } finally {
      setWaLoading(false)
    }
  }

  async function saveWhatsapp() {
    if (!waInstance || !waToken) return
    setWaSaving(true)
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      const r = await fetch('/api/panel?action=ultramsg_save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ business_id: id, instance: waInstance.trim(), token: waToken.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setWaToken('')
      setWaEditing(false)
      await loadWhatsapp()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.clientdetail' }) } catch {}
      alert('Error: ' + (e.message || e))
    } finally {
      setWaSaving(false)
    }
  }

  async function load() {
    setLoading(true)
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      const resp = await fetch(`/api/panel?action=client_detail&id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (!resp.ok) throw new Error('Failed')
      setData(await resp.json())
      // Also fetch visits
      try {
        const vResp = await fetch(`/api/panel?action=client_visits&id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
        if (vResp.ok) { const vData = await vResp.json(); setVisits(vData.data || []) }
      } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'clientdetail.loadwhatsapp' }) } catch {}}
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.loadwhatsapp' }) } catch {} console.error('ClientDetail load:', e) }
    setLoading(false)
  }

  useEffect(() => { load(); loadWhatsapp() }, [id])

  async function loadErrors() {
    setErrorsLoading(true)
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      const url = `/api/panel?action=errors_list&business_id=${id}&limit=200${showResolved ? '' : '&unresolved=1'}`
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) setErrors((await resp.json()).data || [])
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.loadwhatsapp' }) } catch {} console.error('loadErrors:', e) }
    setErrorsLoading(false)
  }

  async function resolveError(errId, resolution) {
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      await fetch('/api/panel?action=errors_resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id: errId, resolution: resolution || null }),
      })
      setErrors(null); loadErrors()
    } catch (_) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_, { severity: 'error', category: 'clientdetail.loadwhatsapp' }) } catch {}}
  }

  async function loadLoyalty() {
    setLoyaltyLoading(true)
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      const resp = await fetch(`/api/panel?action=business-loyalty&business_id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) setLoyalty(await resp.json())
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.loadwhatsapp' }) } catch {} console.error('loadLoyalty:', e) }
    setLoyaltyLoading(false)
  }

  async function loadCertHistory() {
    setCertHistoryLoading(true)
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      const resp = await fetch(`/api/panel?action=cert_history&id=${id}&limit=10`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) {
        const d = await resp.json()
        setCertHistory(d.history || [])
      } else {
        setCertHistory([])
      }
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.savewhatsapp' }) } catch {} console.error('loadCertHistory:', e); setCertHistory([]) }
    setCertHistoryLoading(false)
  }

  async function loadDigestStatus() {
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      const resp = await fetch(`/api/panel?action=business-digest&business_id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) {
        const d = await resp.json()
        setDigestStatus({
          enabled:  !!d.enabled,
          lastSent: d.last_sent || null,
          sent30d:  d.sent_30d || 0,
          recent:   d.recent || [],
        })
      }
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.load' }) } catch {} console.error('loadDigestStatus:', e) }
  }

  async function sendDigestNow() {
    if (!confirm(L('¿Enviar el resumen diario ahora?', 'Send daily digest now?'))) return
    setDigestSending(true); setDigestMsg(null)
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      const resp = await fetch(`/api/panel?action=digest-send-now&business_id=${id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(body?.error || 'Error')
      setDigestMsg({ ok: true, text: L('Enviado.', 'Sent.') })
      await loadDigestStatus()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.load' }) } catch {}
      setDigestMsg({ ok: false, text: e.message || 'Error' })
    }
    setDigestSending(false)
  }

  useEffect(() => {
    if (tab === 'loyalty' && !loyalty && !loyaltyLoading) loadLoyalty()
    if (tab === 'digests' && !digestStatus) loadDigestStatus()
    if (tab === 'errors' && errors === null && !errorsLoading) loadErrors()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteStaff(s) {
    if (!confirm(L(
      `¿Eliminar a ${s.name || s.username}? Si tiene historial se desactivará en su lugar.`,
      `Delete ${s.name || s.username}? If it has history it will be deactivated instead.`
    ))) return
    setDeletingStaffId(s.id)
    try {
      let token = await refreshToken?.(); if (!token) token = getToken()
      const resp = await fetch('/api/panel?action=delete_staff', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: s.id }),
      })
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || 'Failed') }
      await load()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.resolveerror' }) } catch {} alert(e.message || 'Error') }
    finally { setDeletingStaffId(null) }
  }

  const STATUS_CLS = isDark ? STATUS_CLS_DARK : STATUS_CLS_LIGHT

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <motion.div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="w-2 h-2 rounded-full bg-[#b3001e]"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </motion.div>
      </div>
    )
  }
  if (!data?.business) {
    return (
      <div className="p-6 md:p-8">
        <button onClick={() => navigate('/admin/clients')} className={`flex items-center gap-1.5 text-[13px] mb-4 ${isDark ? 'text-white/40 hover:text-white' : 'text-black/40 hover:text-black'}`}>
          <ArrowLeft size={15} /> {L('Volver', 'Back')}
        </button>
        <p className={`text-center text-[13px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Cliente no encontrado.', 'Client not found.')}</p>
      </div>
    )
  }

  const biz = data.business
  const license = data.license
  const licenses = Array.isArray(data.licenses) ? data.licenses : (license ? [license] : [])
  const staff = data.staff || []
  const onboarding = data.onboarding
  const metrics = data.metrics || {}

  const card = `rounded-2xl p-5 transition-colors ${isDark ? 'bg-white/[0.03] border border-white/10 hover:border-[#b3001e]/30' : 'bg-white border border-black/10 hover:border-[#b3001e]/30 shadow-sm'}`
  const lbl = `text-[10px] font-bold uppercase tracking-[1.2px] ${isDark ? 'text-white/35' : 'text-black/35'}`
  const val = `text-[13px] font-medium ${isDark ? 'text-white/85' : 'text-black/85'}`
  const inputBase = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'
    : 'bg-white border-black/10 text-black placeholder-black/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'

  function startEdit() {
    setEditForm({ name: biz.name || '', rnc: biz.rnc || '', phone: biz.phone || '', email: biz.email || '', address: biz.address || '', business_type: biz.business_type || '' })
    setEditing(true)
  }

  async function saveEdit() {
    setEditSaving(true)
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      const resp = await fetch('/api/panel?action=update_business', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id, ...editForm }),
      })
      if (!resp.ok) throw new Error('Failed')
      setEditing(false)
      load()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.deletestaff' }) } catch {} console.error('Save failed:', e) }
    setEditSaving(false)
  }

  async function addVisit() {
    if (!visitDate) return
    setSavingVisit(true)
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      await fetch('/api/panel?action=client_visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ business_id: id, scheduled_date: visitDate, visit_type: visitType, notes: visitNotes }),
      })
      setShowVisitForm(false); setVisitDate(''); setVisitNotes('')
      load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'clientdetail.startedit' }) } catch {}}
    setSavingVisit(false)
  }

  async function toggleVisit(visitId, completed) {
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      await fetch('/api/panel?action=client_visits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ business_id: id, visit_id: visitId, completed }),
      })
      load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'clientdetail.startedit' }) } catch {}}
  }

  const planDisplay = typeof biz.plan === 'string' ? biz.plan.replace('_', ' ').toUpperCase() : '—'
  const licPlanDisplay = license?.plans?.display_name || '—'
  const ticketCount      = metrics.ticketCount || 0
  const ticketCountYear  = metrics.ticketCountYear || 0
  const ticketCountMonth = metrics.ticketCountMonth || 0
  const totalRevenue      = metrics.totalRevenue || 0
  const totalRevenueYear  = metrics.totalRevenueYear || 0
  const totalRevenueMonth = metrics.totalRevenueMonth || 0
  const fmtRev = v => 'RD$' + Math.round(v).toLocaleString('es-DO')
  const serviceCount = metrics.serviceCount || 0
  const clientCount = metrics.clientCount || 0
  const staffActive = staff.filter(s => s.active).length
  const lastSale = metrics.lastSaleDate ? new Date(metrics.lastSaleDate).toLocaleDateString('es-DO') : '—'

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-3"
      >
        <motion.button
          whileTap={{ scale: 0.9 }}
          whileHover={{ x: -2 }}
          onClick={() => navigate('/admin/clients')}
          className={`p-2 rounded-xl transition-colors ${isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-black/40 hover:text-black hover:bg-black/5'}`}
        >
          <ArrowLeft size={18} />
        </motion.button>
        <div className="flex-1 min-w-0">
          <h1 className={`text-[24px] font-black truncate tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>{String(biz.name || '')}</h1>
          <p className={`text-[12px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {String(biz.rnc || L('Sin RNC', 'No RNC'))} &middot; {L('Creado', 'Created')} {new Date(biz.created_at).toLocaleDateString('es-DO')}
          </p>
        </div>
        {license && (
          <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full border uppercase tracking-wide ${STATUS_CLS[license.status] || STATUS_CLS.expired}`}>
            {String(license.status)}
          </span>
        )}
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
      >
        <QuickActions business={biz} license={license} getToken={getToken} onRefresh={load} isDark={isDark} />
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 relative">
        {[
          { k: 'overview', es: 'Resumen',       en: 'Overview' },
          { k: 'config',   es: 'Configuracion', en: 'Configuration' },
          { k: 'errors',   es: 'Errores',       en: 'Errors' },
          { k: 'loyalty',  es: 'Lealtad',       en: 'Loyalty' },
          { k: 'digests',  es: 'Digests',       en: 'Digests' },
        ].map(({ k, es, en }) => (
          <motion.button
            key={k}
            whileTap={{ scale: 0.96 }}
            onClick={() => setTab(k)}
            className={`relative px-4 py-2 rounded-xl text-[12px] font-bold transition-colors ${
              tab === k
                ? 'text-white'
                : isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70'
            }`}
          >
            {tab === k && (
              <motion.div
                layoutId="clientDetailTab"
                className="absolute inset-0 rounded-xl bg-[#b3001e]"
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              />
            )}
            <span className="relative">{L(es, en)}</span>
          </motion.button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'config' && (
          <motion.div
            key="config"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
          >
            <ConfigEditor businessId={id} getToken={getToken} onRefresh={load} isDark={isDark} plan={license?.plans?.name || biz?.plan || 'pro'} />
          </motion.div>
        )}

        {tab === 'errors' && (
          <motion.div
            key="errors"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className={`text-[16px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{L('Errores reportados', 'Reported errors')}</h2>
                <p className={`text-[11px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                  {L('Capturados automaticamente del navegador del cliente', 'Auto-captured from the client browser')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowResolved(s => !s); setErrors(null) }}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                    showResolved
                      ? isDark ? 'bg-white/10 border-white/20 text-white' : 'bg-black/5 border-black/15 text-black'
                      : isDark ? 'border-white/10 text-white/40 hover:text-white/70' : 'border-black/10 text-black/40 hover:text-black/70'
                  }`}
                >
                  {showResolved ? L('Mostrando todos', 'Showing all') : L('Solo sin resolver', 'Unresolved only')}
                </button>
                <button
                  onClick={() => { setErrors(null); loadErrors() }}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${isDark ? 'text-white/60 hover:text-white hover:bg-white/5' : 'text-black/60 hover:text-black hover:bg-black/5'}`}
                >
                  {L('Refrescar', 'Refresh')}
                </button>
              </div>
            </div>

            {errorsLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 size={18} className="animate-spin text-[#b3001e]" /></div>
            ) : !errors || errors.length === 0 ? (
              <div className={`rounded-2xl border p-8 text-center text-[12px] ${isDark ? 'border-white/10 bg-white/[0.03] text-white/50' : 'border-black/10 bg-white text-black/50'}`}>
                {L('Sin errores reportados.', 'No errors reported.')}
              </div>
            ) : (
              <div className="space-y-2">
                {errors.map(e => {
                  const sevColor = e.severity === 'error' ? 'text-red-400 border-red-500/30 bg-red-500/5'
                                  : e.severity === 'warning' ? 'text-amber-400 border-amber-500/30 bg-amber-500/5'
                                  : 'text-blue-400 border-blue-500/30 bg-blue-500/5'
                  return (
                    <div key={e.id} className={`rounded-xl border p-4 ${e.resolved_at ? 'opacity-60' : ''} ${isDark ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-white'}`}>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${sevColor}`}>{e.severity}</span>
                            <span className={`text-[10px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                              {new Date(e.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {e.app_version && <span className={`text-[10px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>v{e.app_version}</span>}
                            {e.resolved_at && <span className="text-[10px] font-bold text-emerald-400">{L('Resuelto', 'Resolved')}</span>}
                          </div>
                          <p className={`text-[13px] font-bold break-words ${isDark ? 'text-white' : 'text-black'}`}>{e.message}</p>
                          {e.route && <p className={`text-[11px] mt-1 font-mono ${isDark ? 'text-white/40' : 'text-black/40'}`}>{e.route}</p>}
                          {e.stack && (
                            <details className="mt-2">
                              <summary className={`text-[11px] cursor-pointer ${isDark ? 'text-white/50 hover:text-white/80' : 'text-black/50 hover:text-black/80'}`}>{L('Stack trace', 'Stack trace')}</summary>
                              <pre className={`mt-2 text-[10px] font-mono whitespace-pre-wrap break-all p-2 rounded ${isDark ? 'bg-black/40 text-white/60' : 'bg-black/5 text-black/60'}`}>{e.stack}</pre>
                            </details>
                          )}
                          {e.user_agent && <p className={`text-[10px] mt-1 truncate ${isDark ? 'text-white/30' : 'text-black/30'}`}>{e.user_agent}</p>}
                        </div>
                        {!e.resolved_at && (
                          <button
                            onClick={() => {
                              const note = window.prompt(L('Nota de resolucion (opcional):', 'Resolution note (optional):'), '')
                              if (note !== null) resolveError(e.id, note)
                            }}
                            className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 transition-colors"
                          >
                            {L('Marcar resuelto', 'Mark resolved')}
                          </button>
                        )}
                      </div>
                      {e.resolution && (
                        <p className={`text-[11px] italic mt-2 pt-2 border-t ${isDark ? 'border-white/10 text-white/50' : 'border-black/10 text-black/50'}`}>
                          {e.resolution}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}

        {tab === 'loyalty' && (
          <motion.div
            key="loyalty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            {loyaltyLoading && !loyalty ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={18} className="animate-spin text-[#b3001e]" />
              </div>
            ) : !loyalty ? (
              <p className={`text-center text-[13px] py-8 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                {L('Sin datos de lealtad.', 'No loyalty data.')}
              </p>
            ) : (
              <>
                {/* KPI strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className={card}>
                    <p className={lbl}>{L('Estado', 'State')}</p>
                    <p className={`mt-1 inline-flex items-center gap-1.5 text-[13px] font-bold ${loyalty.loyalty_enabled ? 'text-emerald-500' : 'text-[#b3001e]'}`}>
                      {loyalty.loyalty_enabled
                        ? <><CheckCircle2 size={14} /> {L('Activo', 'Enabled')}</>
                        : <><XCircle size={14} /> {L('Inactivo', 'Disabled')}</>}
                    </p>
                  </div>
                  <div className={card}>
                    <p className={lbl}>{L('Otorgados', 'Lifetime Earned')}</p>
                    <p className={`text-[20px] font-black mt-1 ${isDark ? 'text-white' : 'text-black'}`}>
                      {Math.round(loyalty.lifetime_earned || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className={card}>
                    <p className={lbl}>{L('Canjeados', 'Lifetime Redeemed')}</p>
                    <p className={`text-[20px] font-black mt-1 ${isDark ? 'text-white' : 'text-black'}`}>
                      {Math.round(loyalty.lifetime_redeemed || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className={card}>
                    <p className={lbl}>{L('Saldo vivo', 'Outstanding')}</p>
                    <p className="text-[20px] font-black mt-1 text-[#b3001e]">
                      {Math.round(loyalty.outstanding || 0).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Top clients + recent transactions */}
                <div className="grid md:grid-cols-2 gap-5">
                  <div className={card}>
                    <p className={`text-[14px] font-bold mb-3 ${isDark ? 'text-white' : 'text-black'}`}>
                      <Gift size={14} className="inline mr-1.5 text-[#b3001e]" />
                      {L('Top 5 clientes', 'Top 5 Customers')}
                    </p>
                    {(loyalty.top_clients || []).length === 0 ? (
                      <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin clientes con puntos.', 'None yet.')}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {loyalty.top_clients.map((c, i) => (
                          <div key={i} className={`flex items-center gap-2 py-1.5 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-black/5'}`}>
                            <span className={`text-[10px] font-bold w-5 shrink-0 ${isDark ? 'text-white/30' : 'text-black/30'}`}>{i + 1}.</span>
                            <span className={`text-[12px] font-semibold truncate flex-1 ${isDark ? 'text-white/85' : 'text-black/85'}`}>{c.name}</span>
                            <span className="text-[11px] font-bold text-[#b3001e] shrink-0">{Math.round(c.points).toLocaleString()}</span>
                            <span className={`text-[9px] font-bold uppercase tracking-[1px] shrink-0 px-1.5 py-0.5 rounded ${isDark ? 'bg-white/5 text-white/50' : 'bg-black/5 text-black/50'}`}>{c.tier}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className={card}>
                    <p className={`text-[14px] font-bold mb-3 ${isDark ? 'text-white' : 'text-black'}`}>
                      {L('Ultimas 20 transacciones', 'Last 20 Transactions')}
                    </p>
                    {(loyalty.transactions || []).length === 0 ? (
                      <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin transacciones.', 'None yet.')}</p>
                    ) : (
                      <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
                        {loyalty.transactions.map(t => {
                          const positive = Number(t.points) > 0
                          const typeLabel = t.event_type === 'earn'   ? L('Acumulo', 'Earn')
                                         : t.event_type === 'redeem' ? L('Canje',  'Redeem')
                                         : t.event_type === 'adjust' ? L('Ajuste', 'Adjust')
                                         : t.event_type
                          return (
                            <div key={t.id} className={`flex items-center gap-2 py-1.5 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-black/5'}`}>
                              <span className={`text-[9px] font-bold uppercase tracking-[1px] shrink-0 px-1.5 py-0.5 rounded ${t.event_type === 'earn' ? 'bg-emerald-500/10 text-emerald-500' : t.event_type === 'redeem' ? 'bg-[#b3001e]/10 text-[#b3001e]' : 'bg-amber-500/10 text-amber-500'}`}>{typeLabel}</span>
                              <span className={`text-[11px] truncate flex-1 ${isDark ? 'text-white/70' : 'text-black/70'}`}>{t.client_name || '—'}</span>
                              <span className={`text-[11px] font-bold shrink-0 ${positive ? 'text-emerald-500' : 'text-[#b3001e]'}`}>{positive ? '+' : ''}{Math.round(t.points).toLocaleString()}</span>
                              <span className={`text-[10px] shrink-0 ${isDark ? 'text-white/25' : 'text-black/25'}`}>
                                {t.created_at ? new Date(t.created_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { month: 'short', day: '2-digit' }) : ''}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}

        {tab === 'digests' && (
          <motion.div
            key="digests"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            {!digestStatus ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={18} className="animate-spin text-[#b3001e]" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className={card}>
                    <p className={lbl}>{L('Digest diario', 'Daily Digest')}</p>
                    <p className={`mt-1 inline-flex items-center gap-1.5 text-[13px] font-bold ${digestStatus.enabled ? 'text-emerald-500' : 'text-[#b3001e]'}`}>
                      {digestStatus.enabled
                        ? <><CheckCircle2 size={14} /> {L('Activo', 'Enabled')}</>
                        : <><XCircle size={14} /> {L('Inactivo', 'Disabled')}</>}
                    </p>
                  </div>
                  <div className={card}>
                    <p className={lbl}>{L('Ultimo envio', 'Last Sent')}</p>
                    <p className={`text-[13px] font-bold mt-1 ${isDark ? 'text-white/85' : 'text-black/85'}`}>
                      {digestStatus.lastSent
                        ? new Date(digestStatus.lastSent).toLocaleString(lang === 'es' ? 'es-DO' : 'en-US')
                        : L('Nunca', 'Never')}
                    </p>
                  </div>
                  <div className={card}>
                    <p className={lbl}>{L('Enviados 30d', 'Sent in 30d')}</p>
                    <p className={`text-[20px] font-black mt-1 ${isDark ? 'text-white' : 'text-black'}`}>
                      {digestStatus.sent30d}
                    </p>
                  </div>
                </div>

                <div className={card}>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                    <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                      <Mail size={14} className="inline mr-1.5 text-[#b3001e]" />
                      {L('Envio manual', 'Manual Send')}
                    </p>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={sendDigestNow}
                      disabled={digestSending}
                      className="px-4 py-2 bg-[#b3001e] hover:bg-[#c8002a] disabled:opacity-50 text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 shadow-md shadow-[#b3001e]/20"
                    >
                      {digestSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      {L('Enviar digest ahora', 'Send digest now')}
                    </motion.button>
                  </div>
                  {digestMsg && (
                    <p className={`text-[12px] ${digestMsg.ok ? 'text-emerald-500' : 'text-[#b3001e]'}`}>
                      {digestMsg.text}
                    </p>
                  )}
                  <p className={`text-[11px] mt-2 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    {L('Forza un envio inmediato del resumen diario para este negocio (ignora el cron).', 'Force immediate daily digest for this business (bypasses cron schedule).')}
                  </p>
                </div>

                <div className={card}>
                  <p className={`text-[14px] font-bold mb-3 ${isDark ? 'text-white' : 'text-black'}`}>
                    {L('Eventos recientes (30d)', 'Recent Events (30d)')}
                  </p>
                  {(digestStatus.recent || []).length === 0 ? (
                    <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin envios registrados.', 'No deliveries logged.')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {digestStatus.recent.map(e => {
                        const ch = e.metadata?.channels || {}
                        const stats = e.metadata?.stats || {}
                        const sev = e.severity || 'info'
                        return (
                          <div key={e.id} className={`py-2 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-black/5'}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[9px] font-bold uppercase tracking-[1px] px-1.5 py-0.5 rounded shrink-0 ${sev === 'critical' ? 'bg-[#b3001e]/10 text-[#b3001e]' : sev === 'warn' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>{sev}</span>
                              <span className={`text-[11px] font-semibold ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                                {e.created_at ? new Date(e.created_at).toLocaleString(lang === 'es' ? 'es-DO' : 'en-US') : ''}
                              </span>
                              {ch.email && <span className={`text-[10px] shrink-0 ${String(ch.email).startsWith('error') ? 'text-[#b3001e]' : ch.email === 'sent' ? 'text-emerald-500' : (isDark ? 'text-white/40' : 'text-black/40')}`}>email:{ch.email}</span>}
                              {ch.whatsapp && <span className={`text-[10px] shrink-0 ${String(ch.whatsapp).startsWith('error') ? 'text-[#b3001e]' : ch.whatsapp === 'sent' ? 'text-emerald-500' : (isDark ? 'text-white/40' : 'text-black/40')}`}>wa:{ch.whatsapp}</span>}
                            </div>
                            {stats && (stats.tickets !== undefined) && (
                              <p className={`text-[10px] mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                                {L('Tickets', 'Tickets')}: {stats.tickets || 0} · {L('Ventas', 'Revenue')}: RD$ {Number(stats.revenue || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}

        {tab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            {/* 2026-05-03 (peppy-greeting-popcorn Phase 2) — Diagnóstico card */}
            <DiagnosticoCard
              businessId={biz.id}
              businessType={biz.business_type}
              isDark={isDark}
              getToken={getToken}
              refreshToken={refreshToken}
              L={L}
            />

            <motion.div
              variants={listContainer}
              initial="initial"
              animate="animate"
              className="grid md:grid-cols-2 gap-5"
            >
              {/* Business Info */}
              <motion.div variants={listItem} className={card}>
                <div className="flex items-center justify-between mb-4">
                  <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                    <Building2 size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Negocio', 'Business')}
                  </p>
                  {!editing && (
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={startEdit}
                      className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-white/30 hover:text-[#b3001e] hover:bg-[#b3001e]/10' : 'text-black/30 hover:text-[#b3001e] hover:bg-[#b3001e]/10'}`}
                      title={L('Editar', 'Edit')}
                    >
                      <Pencil size={14} />
                    </motion.button>
                  )}
                </div>
                {editing ? (
                  <div className="space-y-3">
                    {[
                      { key: 'name', label: L('Nombre', 'Name') },
                      { key: 'rnc', label: 'RNC' },
                      { key: 'phone', label: L('Telefono', 'Phone') },
                      { key: 'email', label: 'Email' },
                      { key: 'address', label: L('Direccion', 'Address') },
                    ].map(f => (
                      <div key={f.key}>
                        <p className={lbl + ' mb-1'}>{f.label}</p>
                        <input value={editForm[f.key] || ''} onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                          className={`w-full px-3 py-2 rounded-xl text-[13px] border outline-none transition-all focus:ring-2 ${inputBase}`} />
                      </div>
                    ))}
                    <div>
                      <p className={lbl + ' mb-1'}>{L('Tipo de negocio', 'Business type')}</p>
                      <select value={editForm.business_type || ''} onChange={e => setEditForm(p => ({ ...p, business_type: e.target.value }))}
                        className={`w-full px-3 py-2 rounded-xl text-[13px] border outline-none transition-all focus:ring-2 ${inputBase}`}>
                        <option value="">— {L('Sin definir', 'Not set')}</option>
                        <option value="carwash">Car Wash</option>
                        <option value="retail">Tienda / Retail</option>
                        <option value="restaurant">Restaurante</option>
                        <option value="salon">Salón / Barbería</option>
                        <option value="mechanic">Mecánica / Taller</option>
                        <option value="dealership">Concesionario</option>
                        <option value="meat_market">Carnicería</option>
                        <option value="licoreria">Licorería</option>
                        <option value="food_truck">Food Truck</option>
                        <option value="service">Servicios</option>
                        <option value="loans">Préstamos</option>
                        <option value="accounting">Contabilidad</option>
                        <option value="hybrid">Híbrido</option>
                      </select>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setEditing(false)}
                        className={`px-4 py-2 rounded-xl text-[12px] font-semibold border transition-colors ${isDark ? 'border-white/10 text-white/50 hover:bg-white/5' : 'border-black/10 text-black/50 hover:bg-black/5'}`}
                      >
                        <X size={12} className="inline mr-1" />{L('Cancelar', 'Cancel')}
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={saveEdit}
                        disabled={editSaving}
                        className="flex-1 py-2 bg-[#b3001e] hover:bg-[#c8002a] disabled:opacity-60 text-white text-[12px] font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                      >
                        {editSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        {L('Guardar', 'Save')}
                      </motion.button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-y-3.5 gap-x-4">
                    <div><p className={lbl}>{L('Nombre', 'Name')}</p><p className={val}>{String(biz.name || '—')}</p></div>
                    <div><p className={lbl}>RNC</p><p className={val}>{String(biz.rnc || '—')}</p></div>
                    <div><p className={lbl}>{L('Telefono', 'Phone')}</p><p className={val}>{String(biz.phone || '—')}</p></div>
                    <div><p className={lbl}>Email</p><p className={val}>{String(biz.email || '—')}</p></div>
                    <div><p className={lbl}>{L('Direccion', 'Address')}</p><p className={val}>{String(biz.address || '—')}</p></div>
                    <div><p className={lbl}>Plan</p><p className={val}>{planDisplay}</p></div>
                    <div><p className={lbl}>{L('Tipo de negocio', 'Business type')}</p><p className={val}>{biz.business_type ? biz.business_type.charAt(0).toUpperCase() + biz.business_type.slice(1) : <span className="opacity-40">—</span>}</p></div>
                  </div>
                )}
              </motion.div>

              {/* Licenses (per-terminal) */}
              <motion.div variants={listItem} className={card}>
                <p className={`text-[14px] font-bold mb-4 flex items-center justify-between ${isDark ? 'text-white' : 'text-black'}`}>
                  <span><KeyRound size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Licencias / Terminales', 'Licenses / Terminals')}</span>
                  <span className={`text-[11px] font-medium ${isDark ? 'text-white/40' : 'text-black/40'}`}>{licenses.length}</span>
                </p>
                {licenses.length === 0 ? (
                  <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin licencias.', 'No licenses.')}</p>
                ) : (
                  <div className="space-y-3">
                    {licenses.map(lic => (
                      <div key={lic.id} className={`rounded-xl p-3 border ${isDark ? 'border-white/10 bg-white/[0.02]' : 'border-black/10 bg-black/[0.02]'}`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <button
                              onClick={async () => {
                                const v = prompt(L('Etiqueta del terminal (ej: Caja 1):', 'Terminal label (e.g. Caja 1):'), lic.label || '')
                                if (v === null) return
                                try {
                                  const token = await getToken()
                                  const resp = await fetch('/api/panel?action=licenses', {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                    body: JSON.stringify({ id: lic.id, label: v.trim() || null }),
                                  })
                                  if (!resp.ok) {
                                    const r = await resp.json().catch(() => ({}))
                                    throw new Error(r.error || `License label update failed (${resp.status})`)
                                  }
                                  load()
                                } catch (err) {
                                  try {
                                    window.__txReportError?.(err, { severity: 'warn', category: 'admin_license_label',
                                      extra: { license_id: lic.id, business_id: id } })
                                  } catch (_aetherErr) {
                                    try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'clientdetail.if' }) } catch {}}
                                  alert(`Error: ${err.message}`)
                                }
                              }}
                              className={`text-[13px] font-semibold text-left hover:underline ${lic.label ? (isDark ? 'text-white' : 'text-black') : 'italic opacity-60'}`}
                              title={L('Editar etiqueta', 'Edit label')}
                            >
                              {lic.label || L('sin etiqueta — clic para editar', 'no label — click to edit')}
                            </button>
                            <p className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-white/40' : 'text-black/40'}`}>{lic.platform || '—'}</p>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_CLS[lic.status] || STATUS_CLS.expired}`}>{lic.status}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-[11px]">
                          <div><p className={lbl}>{L('Clave', 'Key')}</p><p className={`font-mono ${isDark ? 'text-white/70' : 'text-black/70'}`}>{lic.license_key || L('Solo web', 'Web only')}</p></div>
                          <div><p className={lbl}>Plan</p><p className={val}>{lic.plans?.display_name || '—'}</p></div>
                          <div><p className={lbl}>{L('Ultimo acceso', 'Last seen')}</p><p className={val}>{lic.last_seen ? new Date(lic.last_seen).toLocaleDateString('es-DO') : '—'}</p></div>
                          <div><p className={lbl}>HWID</p><p className={`font-mono text-[10px] truncate ${isDark ? 'text-white/40' : 'text-black/40'}`}>{lic.hardware_id || '—'}</p></div>
                          {lic.expires_at && <div className="col-span-2"><p className={lbl}>{L('Expira', 'Expires')}</p><p className={val}>{new Date(lic.expires_at).toLocaleDateString('es-DO')}</p></div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* Metrics */}
              <motion.div variants={listItem} className={card}>
                <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                  <ShoppingCart size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Metricas', 'Metrics')}
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className={lbl}>Tickets</p>
                    <p className={`text-[11px] font-bold mt-0.5 leading-tight ${isDark ? 'text-white' : 'text-black'}`}>
                      <span className="text-slate-400 mr-1">M:</span>{ticketCountMonth.toLocaleString('es-DO')}
                    </p>
                    <p className={`text-[11px] font-bold leading-tight ${isDark ? 'text-white' : 'text-black'}`}>
                      <span className="text-slate-400 mr-1">Y:</span>{ticketCountYear.toLocaleString('es-DO')}
                    </p>
                    <p className={`text-[11px] font-bold leading-tight ${isDark ? 'text-white' : 'text-black'}`}>
                      <span className="text-slate-400 mr-1">A:</span>{ticketCount.toLocaleString('es-DO')}
                    </p>
                  </div>
                  <div>
                    <p className={lbl}>{L('Ingresos', 'Revenue')}</p>
                    <p className={`text-[11px] font-bold mt-0.5 leading-tight ${isDark ? 'text-white' : 'text-black'}`}>
                      <span className="text-slate-400 mr-1">M:</span>{fmtRev(totalRevenueMonth)}
                    </p>
                    <p className={`text-[11px] font-bold leading-tight ${isDark ? 'text-white' : 'text-black'}`}>
                      <span className="text-slate-400 mr-1">Y:</span>{fmtRev(totalRevenueYear)}
                    </p>
                    <p className={`text-[11px] font-bold leading-tight ${isDark ? 'text-white' : 'text-black'}`}>
                      <span className="text-slate-400 mr-1">A:</span>{fmtRev(totalRevenue)}
                    </p>
                  </div>
                  <div><p className={lbl}>{L('Servicios', 'Services')}</p><p className={`text-[18px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>{serviceCount}</p></div>
                  <div><p className={lbl}>{L('Clientes', 'Customers')}</p><p className={`text-[18px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>{clientCount}</p></div>
                  <div><p className={lbl}>Staff</p><p className={`text-[18px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>{staffActive}</p></div>
                  <div><p className={lbl}>{L('Ultima venta', 'Last sale')}</p><p className={`text-[13px] font-bold mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>{lastSale}</p></div>
                </div>
              </motion.div>

              {/* e-CF Status */}
              {(() => {
                const s = biz.settings || {}
                const certInstalled = s.ecf_cert_installed
                const certExpired = s.ecf_cert_expired
                const ecfEnv = s.ecf_environment
                const ecfReady = certInstalled && !certExpired && ecfEnv === 'ecf'
                const hasAnyEcfData = certInstalled !== undefined
                // v2.11.2 — expiring-soon window (<=60d) for admin visibility.
                let certDaysLeft = null
                if (certInstalled && !certExpired && s.ecf_cert_expiry) {
                  const ms = new Date(s.ecf_cert_expiry).getTime()
                  if (Number.isFinite(ms)) certDaysLeft = Math.ceil((ms - Date.now()) / 86_400_000)
                }
                const expiringSoon = certDaysLeft != null && certDaysLeft > 0 && certDaysLeft <= 60
                const expiringCritical = certDaysLeft != null && certDaysLeft > 0 && certDaysLeft <= 30
                return hasAnyEcfData ? (
                  <motion.div variants={listItem} className={card}>
                    <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                      {ecfReady
                        ? <ShieldCheck size={14} className="inline mr-1.5 text-emerald-500" />
                        : <ShieldAlert size={14} className="inline mr-1.5 text-amber-500" />}
                      e-CF Status
                    </p>
                    <div className="grid grid-cols-2 gap-y-3.5 gap-x-4">
                      <div>
                        <p className={lbl}>{L('Certificado', 'Certificate')}</p>
                        <p className={val}>{certInstalled
                          ? (certExpired ? L('Expirado', 'Expired') : L('Instalado', 'Installed'))
                          : L('No instalado', 'Not installed')}</p>
                      </div>
                      <div>
                        <p className={lbl}>{L('Ambiente', 'Environment')}</p>
                        <p className={`text-[13px] font-bold ${ecfEnv === 'ecf' ? 'text-emerald-500' : 'text-amber-500'}`}>
                          {ecfEnv === 'ecf' ? L('Produccion', 'Production') : ecfEnv === 'certecf' ? L('Certificacion', 'Certification') : ecfEnv || '—'}
                        </p>
                      </div>
                      {s.ecf_cert_subject && <div><p className={lbl}>{L('Titular', 'Subject')}</p><p className={val}>{String(s.ecf_cert_subject)}</p></div>}
                      {s.ecf_cert_expiry && (
                        <div>
                          <p className={lbl}>{L('Expira', 'Expires')}</p>
                          <p className={val}>
                            {new Date(s.ecf_cert_expiry).toLocaleDateString('es-DO')}
                            {expiringSoon && (
                              <span className={`ml-2 inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                                expiringCritical
                                  ? 'bg-orange-500/15 text-orange-500 border-orange-500/30'
                                  : 'bg-yellow-400/15 text-yellow-600 border-yellow-500/30'
                              }`}>
                                {L(`Vence en ${certDaysLeft}d`, `Expires in ${certDaysLeft}d`)}
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                      <div className="col-span-2">
                        <p className={lbl}>{L('Listo para e-CF', 'e-CF Ready')}</p>
                        <p className={`text-[13px] font-bold ${ecfReady ? 'text-emerald-500' : 'text-amber-500'}`}>
                          {ecfReady ? L('Si', 'Yes') : L('No — ', 'No — ') + (
                            !certInstalled ? L('falta certificado', 'missing certificate')
                            : certExpired ? L('certificado expirado', 'certificate expired')
                            : ecfEnv !== 'ecf' ? L('ambiente no es produccion', 'environment not production')
                            : ''
                          )}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div variants={listItem} className={card}>
                    <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                      <ShieldAlert size={14} className={`inline mr-1.5 ${isDark ? 'text-white/30' : 'text-black/30'}`} /> e-CF Status
                    </p>
                    <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin datos — el desktop aun no ha reportado.', 'No data — desktop has not reported yet.')}</p>
                  </motion.div>
                )
              })()}

              {/* Historial de Certificados — DGII .p12 rotation audit trail */}
              <motion.div variants={listItem} className={card}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !certHistoryOpen
                    setCertHistoryOpen(next)
                    if (next && certHistory == null && !certHistoryLoading) loadCertHistory()
                  }}
                  className="w-full flex items-center justify-between"
                >
                  <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                    <ShieldCheck size={14} className={`inline mr-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`} />
                    {L('Historial de Certificados', 'Certificate History')}
                  </p>
                  <span className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    {certHistoryOpen ? '−' : '+'}
                  </span>
                </button>
                {certHistoryOpen && (
                  <div className="mt-4">
                    {certHistoryLoading && (
                      <p className={`text-[12px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Cargando…', 'Loading…')}</p>
                    )}
                    {!certHistoryLoading && certHistory && certHistory.length === 0 && (
                      <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin rotaciones registradas todavia.', 'No rotations recorded yet.')}</p>
                    )}
                    {!certHistoryLoading && certHistory && certHistory.length > 0 && (
                      <div className="space-y-2">
                        {certHistory.map((h) => {
                          const reasonColor = h.rotation_reason === 'initial'
                            ? (isDark ? 'text-emerald-400' : 'text-emerald-600')
                            : h.rotation_reason === 'replacement'
                              ? (isDark ? 'text-orange-400' : 'text-orange-600')
                              : (isDark ? 'text-amber-400' : 'text-amber-600')
                          const reasonLabel = h.rotation_reason === 'initial' ? L('Inicial', 'Initial')
                            : h.rotation_reason === 'renewal' ? L('Renovacion', 'Renewal')
                            : h.rotation_reason === 'replacement' ? L('Reemplazo', 'Replacement')
                            : (h.rotation_reason || '—')
                          const fromLabel = h.installed_from === 'desktop' ? 'Desktop'
                            : h.installed_from === 'web' ? 'Web'
                            : h.installed_from === 'admin' ? 'Admin'
                            : (h.installed_from || '—')
                          return (
                            <div key={h.id} className={`rounded-xl p-3 ${isDark ? 'bg-white/5 border border-white/5' : 'bg-black/5 border border-black/5'}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className={`text-[12px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                                    {new Date(h.installed_at).toLocaleString('es-DO')}
                                  </p>
                                  <p className={`text-[11px] ${isDark ? 'text-white/50' : 'text-black/50'} truncate`}>
                                    {h.installed_by_name || L('Sin nombre', 'Unknown')} · {fromLabel}
                                  </p>
                                </div>
                                <span className={`text-[10px] font-bold uppercase tracking-wide ${reasonColor}`}>
                                  {reasonLabel}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-y-1 gap-x-3">
                                <div>
                                  <p className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Serial', 'Serial')}</p>
                                  <p className={`text-[11px] font-mono ${isDark ? 'text-white/80' : 'text-black/80'} truncate`}>{h.cert_serial || '—'}</p>
                                </div>
                                <div>
                                  <p className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Expira', 'Expires')}</p>
                                  <p className={`text-[11px] ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                                    {h.expires_at ? new Date(h.expires_at).toLocaleDateString('es-DO') : '—'}
                                  </p>
                                </div>
                                {h.subject_cn && (
                                  <div className="col-span-2">
                                    <p className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Titular', 'Subject')}</p>
                                    <p className={`text-[11px] ${isDark ? 'text-white/80' : 'text-black/80'} truncate`}>{h.subject_cn}</p>
                                  </div>
                                )}
                                {h.prev_serial && (
                                  <div className="col-span-2">
                                    <p className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Reemplaza serial', 'Replaces serial')}</p>
                                    <p className={`text-[11px] font-mono ${isDark ? 'text-white/50' : 'text-black/50'} truncate`}>{h.prev_serial}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>

              {/* Visits */}
              <motion.div variants={listItem} className={card}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-[1.2px] text-[#b3001e] flex items-center gap-2">
                    <Calendar size={13} /> {L('Visitas', 'Visits')}
                  </p>
                  <button onClick={() => setShowVisitForm(v => !v)}
                    className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-colors ${isDark ? 'text-white/40 hover:text-white/70 border border-white/10' : 'text-black/40 hover:text-black/70 border border-black/10'}`}>
                    <Plus size={11} className="inline mr-1" />{L('Agendar', 'Schedule')}
                  </button>
                </div>

                {showVisitForm && (
                  <div className={`rounded-xl p-3 mb-3 space-y-2 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)}
                        className={`px-2.5 py-2 rounded-lg text-[12px] outline-none ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-white border border-black/10 text-black'}`} />
                      <select value={visitType} onChange={e => setVisitType(e.target.value)}
                        className={`px-2.5 py-2 rounded-lg text-[12px] outline-none ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-white border border-black/10 text-black'}`}>
                        <option value="onsite">{L('Presencial', 'On-site')}</option>
                        <option value="remote">{L('Remoto', 'Remote')}</option>
                      </select>
                    </div>
                    <input value={visitNotes} onChange={e => setVisitNotes(e.target.value)} placeholder={L('Notas...', 'Notes...')}
                      className={`w-full px-2.5 py-2 rounded-lg text-[12px] outline-none ${isDark ? 'bg-white/5 border border-white/10 text-white placeholder-white/30' : 'bg-white border border-black/10 text-black placeholder-black/30'}`} />
                    <button onClick={addVisit} disabled={!visitDate || savingVisit}
                      className="w-full px-3 py-2 rounded-lg text-[11px] font-bold bg-[#b3001e] text-white hover:bg-[#c8002a] disabled:opacity-50 transition-colors">
                      {savingVisit ? L('Guardando...', 'Saving...') : L('Agendar Visita', 'Schedule Visit')}
                    </button>
                  </div>
                )}

                {visits.length === 0 ? (
                  <p className={`text-[11px] ${isDark ? 'text-white/25' : 'text-black/25'}`}>{L('Sin visitas agendadas.', 'No visits scheduled.')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {visits.sort((a, b) => new Date(b.scheduled_date) - new Date(a.scheduled_date)).map(v => (
                      <div key={v.id} className={`flex items-center gap-2.5 py-2 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-black/5'}`}>
                        <input type="checkbox" checked={v.completed} onChange={e => toggleVisit(v.id, e.target.checked)} className="accent-[#b3001e]" />
                        <MapPin size={12} className={v.completed ? 'text-emerald-500' : 'text-[#b3001e]'} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] ${v.completed ? 'line-through opacity-50' : ''} ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                            {new Date(v.scheduled_date).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
                            <span className={`ml-2 text-[10px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                              {v.visit_type === 'remote' ? L('Remoto', 'Remote') : L('Presencial', 'On-site')}
                            </span>
                          </p>
                          {v.notes && <p className={`text-[10px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{v.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* WhatsApp UltraMsg status */}
              <motion.div variants={listItem} className={card}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-[1.2px] text-[#b3001e] flex items-center gap-2">
                    <MessageCircle size={13} /> {L('WhatsApp (UltraMsg)', 'WhatsApp (UltraMsg)')}
                  </p>
                  <button onClick={loadWhatsapp} disabled={waLoading}
                    title={L('Verificar estado en vivo', 'Re-check live status')}
                    className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-colors disabled:opacity-40 ${isDark ? 'text-white/40 hover:text-white/70 border border-white/10' : 'text-black/40 hover:text-black/70 border border-black/10'}`}>
                    <RefreshCw size={11} className={`inline mr-1 ${waLoading ? 'animate-spin' : ''}`} />
                    {L('Verificar', 'Check')}
                  </button>
                </div>

                {(() => {
                  const s = waStatus?.state
                  const dot = s === 'active' ? 'bg-emerald-500'
                            : s === 'suspended' ? 'bg-red-500'
                            : s === 'not_configured' ? (isDark ? 'bg-white/20' : 'bg-black/20')
                            : 'bg-amber-500'
                  const label = s === 'active' ? L('Activo', 'Active')
                              : s === 'suspended' ? L('Suspendido — pago vencido', 'Suspended — payment due')
                              : s === 'not_configured' ? L('Sin configurar', 'Not configured')
                              : s === 'error' ? L('Error', 'Error')
                              : L('Desconocido', 'Unknown')
                  return (
                    <div className={`rounded-xl p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        <span className={`text-[12px] font-semibold ${isDark ? 'text-white/90' : 'text-black/90'}`}>{label}</span>
                      </div>
                      {waStatus?.message && (
                        <p className={`text-[11px] leading-relaxed ${s === 'suspended' ? 'text-red-500' : (isDark ? 'text-white/50' : 'text-black/50')}`}>
                          {waStatus.message}
                        </p>
                      )}
                      {waCreds.instance && (
                        <p className={`text-[10px] mt-1.5 font-mono ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                          {waCreds.instance} · token: {waCreds.token_masked || '—'}
                        </p>
                      )}
                    </div>
                  )
                })()}

                {!waEditing ? (
                  <button onClick={() => { setWaEditing(true); setWaToken('') }}
                    className={`w-full px-3 py-2 rounded-lg text-[11px] font-bold transition-colors ${isDark ? 'bg-white/5 text-white/70 hover:bg-white/10 border border-white/10' : 'bg-black/5 text-black/70 hover:bg-black/10 border border-black/10'}`}>
                    {waCreds.has_token ? L('Cambiar credenciales', 'Change credentials') : L('Configurar credenciales', 'Configure credentials')}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input value={waInstance} onChange={e => setWaInstance(e.target.value)}
                      placeholder="instance166620"
                      className={`w-full px-2.5 py-2 rounded-lg text-[12px] font-mono outline-none ${isDark ? 'bg-white/5 border border-white/10 text-white placeholder-white/30' : 'bg-white border border-black/10 text-black placeholder-black/30'}`} />
                    <input value={waToken} onChange={e => setWaToken(e.target.value)}
                      placeholder={L('Token nuevo', 'New token')}
                      className={`w-full px-2.5 py-2 rounded-lg text-[12px] font-mono outline-none ${isDark ? 'bg-white/5 border border-white/10 text-white placeholder-white/30' : 'bg-white border border-black/10 text-black placeholder-black/30'}`} />
                    <div className="flex gap-2">
                      <button onClick={saveWhatsapp} disabled={!waInstance || !waToken || waSaving}
                        className="flex-1 px-3 py-2 rounded-lg text-[11px] font-bold bg-[#b3001e] text-white hover:bg-[#c8002a] disabled:opacity-50 transition-colors">
                        {waSaving ? L('Guardando...', 'Saving...') : L('Guardar', 'Save')}
                      </button>
                      <button onClick={() => { setWaEditing(false); setWaToken('') }}
                        className={`px-3 py-2 rounded-lg text-[11px] font-bold transition-colors ${isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-black/5 text-black/60 hover:bg-black/10'}`}>
                        {L('Cancelar', 'Cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>

              {/* Onboarding */}
              <motion.div variants={listItem} className={card}>
                <OnboardingChecklist onboarding={onboarding} compact={false} isDark={isDark} />
              </motion.div>
            </motion.div>

            {/* Staff List */}
            <div className={card}>
              <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                <Users size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Personal', 'Staff')} ({staff.length})
              </p>
              {staff.length === 0 ? (
                <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin personal.', 'No staff.')}</p>
              ) : (
                <motion.div variants={listContainer} initial="initial" animate="animate" className="space-y-0">
                  {staff.map(s => (
                    <motion.div
                      key={s.id}
                      variants={listItem}
                      className={`py-3 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-black/5'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-[13px] font-semibold ${isDark ? 'text-white' : 'text-black'}`}>{String(s.name)}</p>
                          <p className={`text-[11px] mt-0.5 ${isDark ? 'text-white/35' : 'text-black/35'}`}>
                            {String(s.username)} &middot; {roleLbl(s.role, lang)}
                            {s.has_pin ? '' : <span className="ml-1.5 text-amber-500">&middot; {L('Sin PIN', 'No PIN')}</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <motion.button
                            whileTap={{ scale: 0.94 }}
                            onClick={() => { setPinStaffId(pinStaffId === s.id ? null : s.id); setPinValue(''); setPinErr(''); setPinOk(false) }}
                            className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition-colors ${isDark ? 'border-white/10 text-white/60 hover:border-[#b3001e]/40 hover:text-[#b3001e] hover:bg-[#b3001e]/10' : 'border-black/10 text-black/60 hover:border-[#b3001e]/40 hover:text-[#b3001e] hover:bg-[#b3001e]/5'}`}
                          >
                            <Lock size={10} /> {s.has_pin ? L('Cambiar PIN', 'Change PIN') : L('Asignar PIN', 'Set PIN')}
                          </motion.button>
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                            s.active
                              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                              : isDark ? 'bg-white/5 text-white/40 border-white/10' : 'bg-black/5 text-black/40 border-black/10'
                          }`}>
                            {s.active ? L('Activo', 'Active') : L('Inactivo', 'Inactive')}
                          </span>
                          <motion.button
                            whileTap={{ scale: 0.94 }}
                            onClick={() => deleteStaff(s)}
                            disabled={deletingStaffId === s.id}
                            title={L('Eliminar', 'Delete')}
                            className={`p-1.5 rounded-lg border flex items-center transition-colors disabled:opacity-50 ${isDark ? 'border-white/10 text-white/50 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/10' : 'border-black/10 text-black/50 hover:border-red-500/40 hover:text-red-500 hover:bg-red-500/5'}`}
                          >
                            {deletingStaffId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </motion.button>
                        </div>
                      </div>
                      <AnimatePresence>
                        {pinStaffId === s.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0, marginTop: 0 }}
                            animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                            exit={{ opacity: 0, height: 0, marginTop: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            className={`overflow-hidden`}
                          >
                            <div className={`flex items-center gap-2 p-2.5 rounded-xl ${isDark ? 'bg-white/5 border border-white/10' : 'bg-black/[0.03] border border-black/10'}`}>
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="PIN (4-6)"
                                value={pinValue}
                                onChange={e => { setPinValue(e.target.value.replace(/\D/g, '').slice(0, 6)); setPinErr(''); setPinOk(false) }}
                                className={`w-28 px-2.5 py-2 rounded-lg text-[13px] font-mono tracking-[3px] text-center border outline-none transition-all focus:ring-2 ${inputBase}`}
                              />
                              <motion.button
                                whileTap={{ scale: 0.95 }}
                                disabled={pinSaving || pinValue.length < 4}
                                onClick={async () => {
                                  setPinSaving(true); setPinErr('')
                                  try {
                                    const resp = await fetch('/api/panel?action=set_staff_pin', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                                      body: JSON.stringify({ staff_id: s.id, pin: pinValue }),
                                    })
                                    const result = await resp.json()
                                    if (!resp.ok) throw new Error(result.error || 'Failed')
                                    setPinOk(true); setPinValue('')
                                    setTimeout(() => { setPinStaffId(null); load() }, 1200)
                                  } catch (e) {
                                    try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.handler' }) } catch {} setPinErr(e.message) }
                                  setPinSaving(false)
                                }}
                                className="px-3 py-2 bg-[#b3001e] hover:bg-[#c8002a] disabled:opacity-50 text-white text-[11px] font-bold rounded-lg flex items-center gap-1 shadow-md shadow-[#b3001e]/20"
                              >
                                {pinSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                {L('Guardar', 'Save')}
                              </motion.button>
                              {pinOk && <span className="text-[11px] text-emerald-500 font-bold">{L('PIN actualizado', 'PIN updated')}</span>}
                              {pinErr && <span className="text-[11px] text-[#b3001e] font-semibold">{pinErr}</span>}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// 2026-05-03 (peppy-greeting-popcorn Phase 2) — per-client health diagnostic.
// Bundled call to /api/panel?action=client_health_snapshot. Color-codes each
// row green/amber/red so Mike sees provisioning gaps + recent errors at a
// glance instead of running ad-hoc queries.
function DiagnosticoCard({ businessId, businessType, isDark, getToken, refreshToken, L }) {
  const [snap, setSnap] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const r = await fetch(`/api/panel?action=client_health_snapshot&business_id=${encodeURIComponent(businessId)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error')
      setSnap(j)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'clientdetail.load' }) } catch {} setErr(e.message || 'Error') }
    setLoading(false)
  }
  useEffect(() => { load() }, [businessId])

  const card = `rounded-2xl border p-5 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/8'}`

  if (loading && !snap) return (
    <div className={card}>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={14} className="animate-spin" />
        {L('Cargando diagnóstico…', 'Loading diagnostic…')}
      </div>
    </div>
  )
  if (err) return (
    <div className={card}>
      <p className="text-sm text-[#b3001e]">{L('No se pudo cargar', 'Could not load')}: {err}</p>
    </div>
  )
  if (!snap) return null

  // Vertical-aware heuristics: a restaurant with 0 mesas/services is amber,
  // a carwash with 0 mesas is fine. Returns 'ok'|'warn'|'bad'.
  const bt = businessType || snap.business?.business_type_app_settings || 'carwash'
  const restaurantLike = ['restaurant', 'hybrid'].includes(bt)
  const retailLike = ['retail', 'tienda', 'licoreria', 'carniceria', 'dealership', 'mechanic'].includes(bt)
  const serviceLike = ['carwash', 'salon', 'barberia', 'service'].includes(bt)

  const rows = []

  // Business type sync
  rows.push({
    label: L('Tipo de negocio', 'Business type'),
    value: snap.business.business_type_app_settings || L('(no definido)', '(not set)'),
    status: snap.business.business_type_in_sync ? 'ok'
      : snap.business.business_type_app_settings ? 'warn'
      : 'bad',
    hint: snap.business.business_type_in_sync ? null
      : !snap.business.business_type_app_settings ? L('Falta business_type en app_settings — POS cargará como car wash', 'business_type missing in app_settings — POS loads as carwash')
      : L('app_settings y settings.json no coinciden', 'app_settings and settings.json mismatch'),
  })

  // License
  if (!snap.license) {
    rows.push({ label: 'License', value: L('Sin licencia', 'No license'), status: 'bad',
      hint: L('Sin licencia → DGII y Pro PLUS+ verticals quedarán bloqueados', 'No license → DGII + Pro PLUS+ verticals will be locked') })
  } else {
    const days = snap.license.days_until_expiry
    rows.push({
      label: 'License',
      value: `${snap.license.plan_name || '?'} · ${snap.license.status}${days != null ? ` · ${days}d` : ''}`,
      status: !snap.license.is_active ? 'bad'
        : !snap.license.plan_matches_business ? 'warn'
        : (days != null && days < 3) ? 'warn'
        : 'ok',
      hint: !snap.license.plan_matches_business
        ? L(`Plan no coincide: license=${snap.license.plan_name}, business=${snap.business.plan}`, `Plan mismatch: license=${snap.license.plan_name}, business=${snap.business.plan}`)
        : (days != null && days < 3) ? L(`Vence en ${days} días`, `Expires in ${days} days`)
        : null,
    })
  }

  // Owner email
  rows.push({
    label: L('Cuenta del dueño', 'Owner account'),
    value: snap.business.owner_email || L('(no vinculada)', '(not linked)'),
    status: snap.business.owner_email ? 'ok' : 'bad',
  })

  // Data counts (vertical-aware)
  const dc = snap.data_counts
  if (restaurantLike) {
    rows.push({ label: 'Mesas', value: dc.mesas, status: dc.mesas === 0 ? 'warn' : 'ok',
      hint: dc.mesas === 0 ? L('Restaurante sin mesas — el cliente debe crearlas', 'Restaurant with no mesas — client needs to create them') : null })
  }
  rows.push({ label: L('Servicios activos', 'Active services'), value: dc.services_active, status: dc.services_active === 0 ? 'warn' : 'ok' })
  if (restaurantLike) {
    rows.push({ label: L('Items del menú', 'Menu items'), value: dc.services_menu_items, status: dc.services_menu_items === 0 ? 'warn' : 'ok',
      hint: dc.services_menu_items === 0 ? L('Sin items con is_menu_item — la pantalla de menú se ve vacía', 'No services flagged is_menu_item — menu screen will be empty') : null })
  }
  rows.push({ label: 'Empleados', value: dc.empleados, status: dc.empleados === 0 ? (serviceLike || restaurantLike ? 'warn' : 'ok') : 'ok' })
  rows.push({ label: L('Tickets (30d)', 'Tickets (30d)'), value: dc.tickets_30d, status: 'ok' })

  // Recent errors
  const errs = snap.recent_errors_24h
  rows.push({
    label: L('Errores 24h', 'Errors 24h'),
    value: errs.total === 0 ? '0' : `${errs.total}${errs.critical > 0 ? ` (${errs.critical} críticos)` : ''}`,
    status: errs.critical > 0 ? 'bad' : errs.total > 5 ? 'warn' : 'ok',
    hint: errs.total > 0 ? Object.entries(errs.by_category).map(([k,v]) => `${k}=${v}`).join(' · ') : null,
  })

  // Last activity
  const lastT = snap.last_ticket_at
  rows.push({
    label: L('Último ticket', 'Last ticket'),
    value: lastT ? new Date(lastT).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : L('Ninguno', 'None'),
    status: lastT ? 'ok' : 'warn',
  })

  const dotCls = (s) => s === 'ok' ? 'bg-emerald-500'
    : s === 'warn' ? 'bg-amber-500'
    : 'bg-[#b3001e]'

  const summary = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
  const overall = summary.bad > 0 ? 'bad' : summary.warn > 0 ? 'warn' : 'ok'
  const overallIcon = overall === 'bad' ? AlertCircle : overall === 'warn' ? AlertTriangle : CheckCircle2
  const OverallIcon = overallIcon
  const overallLabel = overall === 'bad' ? L('Problemas críticos', 'Critical issues')
    : overall === 'warn' ? L('Atención requerida', 'Needs attention')
    : L('Todo en orden', 'All clear')
  const overallTone = overall === 'bad' ? 'text-[#b3001e]' : overall === 'warn' ? 'text-amber-500' : 'text-emerald-500'

  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-[#b3001e]" />
          <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
            {L('Diagnóstico', 'Diagnostic')}
          </p>
          <div className={`flex items-center gap-1 ${overallTone}`}>
            <OverallIcon size={12} />
            <span className="text-[11px] font-bold">{overallLabel}</span>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors ${isDark ? 'text-white/50 hover:text-white hover:bg-white/5' : 'text-black/50 hover:text-black hover:bg-black/5'}`}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {L('Refrescar', 'Refresh')}
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-x-4 gap-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start gap-2.5 py-1">
            <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dotCls(r.status)}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-white/50' : 'text-black/50'}`}>{r.label}</span>
                <span className={`text-[12px] font-mono break-all ${isDark ? 'text-white/90' : 'text-black/90'}`}>{r.value}</span>
              </div>
              {r.hint && (
                <p className={`text-[10px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{r.hint}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
