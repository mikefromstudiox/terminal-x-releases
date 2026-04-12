import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Loader2, Building2, KeyRound, Users, ShoppingCart, Save, X, ShieldCheck, ShieldAlert, Lock, Pencil, Calendar, MapPin, Plus } from 'lucide-react'
import { useLang } from '../../i18n'
import OnboardingChecklist from '../components/OnboardingChecklist'
import QuickActions from '../components/QuickActions'
import ConfigEditor from '../components/ConfigEditor'
import { listContainer, listItem } from '../motion'

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
  const [visits, setVisits] = useState([])
  const [showVisitForm, setShowVisitForm] = useState(false)
  const [visitDate, setVisitDate] = useState('')
  const [visitType, setVisitType] = useState('onsite')
  const [visitNotes, setVisitNotes] = useState('')
  const [savingVisit, setSavingVisit] = useState(false)

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
      } catch {}
    } catch (e) { console.error('ClientDetail load:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

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
    setEditForm({ name: biz.name || '', rnc: biz.rnc || '', phone: biz.phone || '', email: biz.email || '', address: biz.address || '' })
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
    } catch (e) { console.error('Save failed:', e) }
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
    } catch {}
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
    } catch {}
  }

  const planDisplay = typeof biz.plan === 'string' ? biz.plan.replace('_', ' ').toUpperCase() : '—'
  const licPlanDisplay = license?.plans?.display_name || '—'
  const ticketCount = metrics.ticketCount || 0
  const totalRevenue = metrics.totalRevenue || 0
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
        {['overview', 'config'].map(k => (
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
            <span className="relative">{k === 'overview' ? L('Resumen', 'Overview') : L('Configuracion', 'Configuration')}</span>
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

        {tab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
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
                  </div>
                )}
              </motion.div>

              {/* License */}
              <motion.div variants={listItem} className={card}>
                <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                  <KeyRound size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Licencia', 'License')}
                </p>
                {license ? (
                  <div className="grid grid-cols-2 gap-y-3.5 gap-x-4">
                    <div><p className={lbl}>{L('Clave', 'Key')}</p><p className={`font-mono text-[11px] ${isDark ? 'text-white/70' : 'text-black/70'}`}>{String(license.license_key || 'Web only')}</p></div>
                    <div><p className={lbl}>{L('Plataforma', 'Platform')}</p><p className={val}>{String(license.platform || '—')}</p></div>
                    <div><p className={lbl}>Plan</p><p className={val}>{String(licPlanDisplay)}</p></div>
                    <div><p className={lbl}>Status</p><p className={val}>{String(license.status || '—')}</p></div>
                    <div><p className={lbl}>{L('Ultimo acceso', 'Last seen')}</p><p className={val}>{license.last_seen ? new Date(license.last_seen).toLocaleDateString('es-DO') : '—'}</p></div>
                    <div><p className={lbl}>HWID</p><p className={`font-mono text-[10px] truncate ${isDark ? 'text-white/40' : 'text-black/40'}`}>{String(license.hardware_id || '—')}</p></div>
                    {license.expires_at && <div className="col-span-2"><p className={lbl}>{L('Expira', 'Expires')}</p><p className={val}>{new Date(license.expires_at).toLocaleDateString('es-DO')}</p></div>}
                  </div>
                ) : (
                  <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin licencia.', 'No license.')}</p>
                )}
              </motion.div>

              {/* Metrics */}
              <motion.div variants={listItem} className={card}>
                <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                  <ShoppingCart size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Metricas', 'Metrics')}
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div><p className={lbl}>Tickets</p><p className={`text-[18px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>{ticketCount}</p></div>
                  <div><p className={lbl}>{L('Ingresos', 'Revenue')}</p><p className={`text-[14px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>{'RD$' + totalRevenue.toLocaleString('es-DO', { minimumFractionDigits: 0 })}</p></div>
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
                      {s.ecf_cert_expiry && <div><p className={lbl}>{L('Expira', 'Expires')}</p><p className={val}>{new Date(s.ecf_cert_expiry).toLocaleDateString('es-DO')}</p></div>}
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
                            {String(s.username)} &middot; {String(s.role)}
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
                                  } catch (e) { setPinErr(e.message) }
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
