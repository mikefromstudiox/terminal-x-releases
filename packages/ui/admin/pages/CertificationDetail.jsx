import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Loader2, Building2, ShieldCheck, FileText, DollarSign, Phone, Mail, MapPin, Plus, X, Wand2, Copy } from 'lucide-react'
import CertStepTracker from '../components/CertStepTracker'
import CertNotes from '../components/CertNotes'
import CertWizard from '../components/CertWizard'
import { listContainer, listItem, dropdown } from '../motion'

const PKG_BADGE = {
  advisory:           { label: 'Asesoria',      labelEn: 'Advisory',  cls: 'bg-black/5 text-black/70 border-black/15',             clsDark: 'bg-white/5 text-white/70 border-white/15' },
  full:               { label: 'Completo',      labelEn: 'Full',      cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25',   clsDark: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30' },
  full_plus_terminal: { label: 'Completo + TX', labelEn: 'Full + TX', cls: 'bg-[#b3001e] text-white border-[#b3001e]',             clsDark: 'bg-[#b3001e] text-white border-[#b3001e]' },
}

const PAY_BADGE = {
  pending: { label: 'Pendiente', labelEn: 'Pending', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30',       clsDark: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  partial: { label: 'Parcial',   labelEn: 'Partial', cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25',       clsDark: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30' },
  paid:    { label: 'Pagado',    labelEn: 'Paid',    cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', clsDark: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
}

const STATUS_OPTIONS = ['active', 'completed', 'paused']

export default function CertificationDetail({ getToken, refreshToken, isDark, lang }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('wizard')
  const [statusDropdown, setStatusDropdown] = useState(false)
  const [docForm, setDocForm] = useState({ name: '', file_path: '', file_type: '', step: '' })
  const [showDocForm, setShowDocForm] = useState(false)
  const [docSubmitting, setDocSubmitting] = useState(false)
  const [stepData, setStepData] = useState({})
  const [testResults, setTestResults] = useState([])
  const [portalCopied, setPortalCopied] = useState(false)

  async function getAuthToken() {
    let token = await refreshToken?.()
    if (!token) token = getToken()
    return token
  }

  async function load() {
    setLoading(true)
    try {
      const token = await getAuthToken()
      const [certResp, stepResp, testResp] = await Promise.all([
        fetch(`/api/panel?action=cert_detail&id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/panel?action=cert_step_data&id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null),
        fetch(`/api/panel?action=cert_test_results&id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null),
      ])
      if (!certResp.ok) throw new Error('Failed')
      setData(await certResp.json())
      if (stepResp?.ok) {
        const sd = await stepResp.json()
        setStepData(sd?.steps || sd || {})
      }
      if (testResp?.ok) {
        const tr = await testResp.json()
        setTestResults(tr?.results || tr || [])
      }
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'certificationdetail.certificationdetail' }) } catch {} console.error('CertDetail load:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function saveStepData(step, fieldData) {
    setStepData(prev => ({ ...prev, [step]: { ...prev[step], ...fieldData } }))
    try {
      const token = await getAuthToken()
      await fetch('/api/panel?action=cert_step_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id, step, data: fieldData }),
      })
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'certificationdetail.certificationdetail' }) } catch {}}
  }

  async function uploadFile(file, step, fieldKey) {
    try {
      const token = await getAuthToken()
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1]
        await fetch('/api/panel?action=cert_upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ id, step, field_key: fieldKey, filename: file.name, data: base64 }),
        })
        setStepData(prev => ({ ...prev, [step]: { ...prev[step], [fieldKey]: file.name } }))
        load()
      }
      reader.readAsDataURL(file)
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'certificationdetail.onload' }) } catch {}}
  }

  async function runTests(step, poll = false) {
    try {
      const token = await getAuthToken()
      if (!poll) {
        await fetch('/api/panel?action=cert_commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ id, step, command: 'run_tests' }),
        })
      }
      const resp = await fetch(`/api/panel?action=cert_test_results&id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) {
        const tr = await resp.json()
        setTestResults(tr?.results || tr || [])
      }
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'certificationdetail.onload' }) } catch {}}
  }

  function copyPortalUrl() {
    const token = data?.certification?.portal_token
    if (token) {
      navigator.clipboard?.writeText(`https://terminalxpos.com/cert/${token}`)
      setPortalCopied(true)
      setTimeout(() => setPortalCopied(false), 2000)
    }
  }

  async function handleStepAction(step, action, note) {
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      await fetch('/api/panel?action=cert_step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id, step, action, note }),
      })
      load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'certificationdetail.onload' }) } catch {}}
  }

  async function changeStatus(newStatus) {
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      await fetch('/api/panel?action=cert_update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id, status: newStatus }),
      })
      setStatusDropdown(false)
      load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'certificationdetail.onload' }) } catch {}}
  }

  async function markPaid() {
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      await fetch('/api/panel?action=cert_update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id, payment_status: 'paid', amount_paid: data?.certification?.price || 0 }),
      })
      load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'certificationdetail.onload' }) } catch {}}
  }

  async function addDocument() {
    if (!docForm.name.trim()) return
    setDocSubmitting(true)
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      await fetch('/api/panel?action=cert_docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id, ...docForm, step: docForm.step ? parseInt(docForm.step, 10) : null }),
      })
      setDocForm({ name: '', file_path: '', file_type: '', step: '' })
      setShowDocForm(false)
      load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'certificationdetail.onload' }) } catch {}}
    setDocSubmitting(false)
  }

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

  if (!data?.certification) {
    return (
      <div className="p-6 md:p-8">
        <button onClick={() => navigate('/admin/certifications')} className={`flex items-center gap-1.5 text-[13px] mb-4 ${isDark ? 'text-white/40 hover:text-white' : 'text-black/40 hover:text-black'}`}>
          <ArrowLeft size={15} /> {L('Volver', 'Back')}
        </button>
        <p className={`text-center text-[13px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Certificacion no encontrada.', 'Certification not found.')}</p>
      </div>
    )
  }

  const cert = data.certification
  const notes = data.notes || []
  const documents = data.documents || []
  const stepsCompleted = cert.steps_completed || []
  const currentStep = cert.current_step || 0
  const pkg = PKG_BADGE[cert.package_tier] || PKG_BADGE.full
  const pay = PAY_BADGE[cert.payment_status] || PAY_BADGE.pending

  const card = `rounded-2xl p-5 transition-colors ${isDark ? 'bg-white/[0.03] border border-white/10 hover:border-[#b3001e]/30' : 'bg-white border border-black/10 hover:border-[#b3001e]/30 shadow-sm'}`
  const lbl = `text-[10px] font-bold uppercase tracking-[1.2px] ${isDark ? 'text-white/35' : 'text-black/35'}`
  const val = `text-[13px] font-medium ${isDark ? 'text-white/85' : 'text-black/85'}`

  const statusBadge =
    cert.status === 'completed' ? (isDark ? 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30' : 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25')
    : cert.status === 'paused' ? (isDark ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-amber-500/10 text-amber-600 border-amber-500/30')
    : (isDark ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30')

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
          onClick={() => navigate('/admin/certifications')}
          className={`p-2 rounded-xl transition-colors ${isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-black/40 hover:text-black hover:bg-black/5'}`}
        >
          <ArrowLeft size={18} />
        </motion.button>
        <div className="flex-1 min-w-0">
          <h1 className={`text-[24px] font-black truncate tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>{cert.business_name}</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className={`text-[12px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
              RNC {cert.rnc || '--'} &middot; {L('Paso', 'Step')} {currentStep}/15
            </p>
            {cert.portal_token && (
              <button
                onClick={copyPortalUrl}
                className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-lg transition-colors ${
                  portalCopied
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : isDark ? 'bg-white/5 text-white/30 border border-white/10 hover:bg-white/10' : 'bg-black/5 text-black/30 border border-black/10 hover:bg-black/10'
                }`}
              >
                <Copy size={9} />
                {portalCopied ? L('Copiado', 'Copied') : 'Portal'}
              </button>
            )}
          </div>
        </div>
        <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full border uppercase tracking-wide ${statusBadge}`}>
          {cert.status || 'active'}
        </span>
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="flex flex-wrap gap-2"
      >
        {cert.contact_phone && (
          <motion.a
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.02 }}
            href={`https://wa.me/${cert.contact_phone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
          >
            <Phone size={12} /> WhatsApp
          </motion.a>
        )}
        <div className="relative">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setStatusDropdown(!statusDropdown)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
              isDark ? 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:border-[#b3001e]/40' : 'bg-black/5 text-black/70 border-black/10 hover:bg-black/10 hover:border-[#b3001e]/40'
            }`}
          >
            {L('Cambiar Estado', 'Change Status')}
          </motion.button>
          <AnimatePresence>
            {statusDropdown && (
              <motion.div
                variants={dropdown}
                initial="initial"
                animate="animate"
                exit="exit"
                className={`absolute top-full mt-2 left-0 z-20 rounded-xl shadow-2xl border overflow-hidden ${isDark ? 'bg-black border-white/15' : 'bg-white border-black/15'}`}
              >
                {STATUS_OPTIONS.map(s => (
                  <button key={s} onClick={() => changeStatus(s)}
                    className={`block w-full text-left px-5 py-2.5 text-[12px] capitalize transition-colors ${
                      isDark ? 'text-white/70 hover:bg-[#b3001e]/15 hover:text-white' : 'text-black/70 hover:bg-[#b3001e]/10 hover:text-[#b3001e]'
                    } ${cert.status === s ? 'font-bold text-[#b3001e]' : ''}`}>
                    {s}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {cert.payment_status !== 'paid' && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.02 }}
            onClick={markPaid}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/25 hover:bg-[#b3001e]/20 transition-colors"
          >
            <DollarSign size={12} /> {L('Marcar Pagado', 'Mark Paid')}
          </motion.button>
        )}
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 relative">
        {[
          { key: 'wizard',    es: 'Asistente',  en: 'Wizard' },
          { key: 'overview',  es: 'Resumen',    en: 'Overview' },
          { key: 'notes',     es: 'Notas',      en: 'Notes' },
          { key: 'documents', es: 'Documentos', en: 'Documents' },
        ].map(t => (
          <motion.button
            key={t.key}
            whileTap={{ scale: 0.96 }}
            onClick={() => setTab(t.key)}
            className={`relative px-4 py-2 rounded-xl text-[12px] font-bold transition-colors ${
              tab === t.key
                ? 'text-white'
                : isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70'
            }`}
          >
            {tab === t.key && (
              <motion.div
                layoutId="certDetailTab"
                className="absolute inset-0 rounded-xl bg-[#b3001e]"
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              />
            )}
            <span className="relative">
              {lang === 'es' ? t.es : t.en}
              {t.key === 'notes' && notes.length > 0 && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-white/20' : isDark ? 'bg-white/10' : 'bg-black/10'}`}>{notes.length}</span>
              )}
            </span>
          </motion.button>
        ))}
      </div>

      <AnimatePresence mode="wait">
      {/* Wizard Tab */}
      {tab === 'wizard' && (
        <motion.div
          key="wz"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
        >
          <CertWizard
            certification={cert}
            stepData={stepData}
            documents={documents}
            testResults={testResults}
            notes={notes}
            onSaveStepData={saveStepData}
            onCompleteStep={(step) => handleStepAction(step, 'complete')}
            onUncompleteStep={(step) => handleStepAction(step, 'uncomplete')}
            onUploadFile={uploadFile}
            onRunTests={runTests}
            onAddNote={load}
            getToken={getToken}
            refreshToken={refreshToken}
            isDark={isDark}
            lang={lang}
          />
        </motion.div>
      )}

      {/* Overview Tab */}
      {tab === 'overview' && (
        <motion.div
          key="ov"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="grid md:grid-cols-[1fr_320px] gap-5"
        >
          {/* Left: Step Tracker */}
          <motion.div variants={listItem} initial="initial" animate="animate" className={card}>
            <CertStepTracker
              stepsCompleted={stepsCompleted}
              currentStep={currentStep}
              onStepAction={handleStepAction}
              isDark={isDark}
              lang={lang}
            />
          </motion.div>

          {/* Right: Info cards */}
          <motion.div variants={listContainer} initial="initial" animate="animate" className="space-y-5">
            {/* Client info */}
            <motion.div variants={listItem} className={card}>
              <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                <Building2 size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Cliente', 'Client')}
              </p>
              <div className="space-y-2.5">
                <div><p className={lbl}>{L('Negocio', 'Business')}</p><p className={val}>{cert.business_name}</p></div>
                <div><p className={lbl}>RNC</p><p className={val}>{cert.rnc || '--'}</p></div>
                <div><p className={lbl}>{L('Contacto', 'Contact')}</p><p className={val}>{cert.contact_name || '--'}</p></div>
                {cert.contact_phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone size={11} className={isDark ? 'text-white/30' : 'text-black/30'} />
                    <p className={val}>{cert.contact_phone}</p>
                  </div>
                )}
                {cert.contact_email && (
                  <div className="flex items-center gap-1.5">
                    <Mail size={11} className={isDark ? 'text-white/30' : 'text-black/30'} />
                    <p className={val}>{cert.contact_email}</p>
                  </div>
                )}
                {cert.address && (
                  <div className="flex items-center gap-1.5">
                    <MapPin size={11} className={isDark ? 'text-white/30' : 'text-black/30'} />
                    <p className={val}>{cert.address}</p>
                  </div>
                )}
                <div>
                  <p className={lbl}>{L('Paquete', 'Package')}</p>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${isDark ? pkg.clsDark : pkg.cls}`}>
                    {lang === 'es' ? pkg.label : pkg.labelEn}
                  </span>
                </div>
              </div>
            </motion.div>

            {/* Payment */}
            <motion.div variants={listItem} className={card}>
              <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
                <DollarSign size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Pago', 'Payment')}
              </p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className={lbl}>{L('Estado', 'Status')}</p>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${isDark ? pay.clsDark : pay.cls}`}>
                    {lang === 'es' ? pay.label : pay.labelEn}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className={lbl}>{L('Pagado', 'Paid')}</p>
                  <p className={`text-[16px] font-black ${isDark ? 'text-white' : 'text-black'}`}>
                    RD${(cert.amount_paid || 0).toLocaleString('es-DO')}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <p className={lbl}>{L('Precio', 'Price')}</p>
                  <p className={val}>
                    RD${(cert.price || 0).toLocaleString('es-DO')}
                  </p>
                </div>
                {cert.price > 0 && (
                  <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                    <motion.div
                      className="h-full rounded-full bg-emerald-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, Math.round(((cert.amount_paid || 0) / cert.price) * 100))}%` }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}

      {/* Notes Tab */}
      {tab === 'notes' && (
        <motion.div
          key="nt"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
        >
          <CertNotes
            notes={notes}
            certId={id}
            token={getToken()}
            onNoteAdded={load}
            isDark={isDark}
            lang={lang}
          />
        </motion.div>
      )}

      {/* Documents Tab */}
      {tab === 'documents' && (
        <motion.div
          key="dc"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <p className={`text-[14px] font-semibold ${isDark ? 'text-white' : 'text-black'}`}>
              <FileText size={14} className="inline mr-1.5 text-[#b3001e]" />
              {L('Documentos', 'Documents')} ({documents.length})
            </p>
            <motion.button
              whileTap={{ scale: 0.96 }}
              whileHover={{ scale: 1.02 }}
              onClick={() => setShowDocForm(!showDocForm)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#b3001e] text-white text-[11px] font-bold rounded-xl hover:bg-[#c8002a] transition-colors shadow-lg shadow-[#b3001e]/20"
            >
              <Plus size={12} /> {L('Agregar', 'Add')}
            </motion.button>
          </div>

          {/* Add document form */}
          <AnimatePresence>
          {showDocForm && (
            <motion.div
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -4, height: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className={`${card} space-y-3 overflow-hidden`}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Nombre *', 'Name *')}</label>
                  <input value={docForm.name} onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={L('Certificado P12', 'P12 Certificate')}
                    className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                      isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                    }`} />
                </div>
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Tipo', 'Type')}</label>
                  <input value={docForm.file_type} onChange={e => setDocForm(f => ({ ...f, file_type: e.target.value }))}
                    placeholder="p12, pdf, xml..."
                    className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                      isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                    }`} />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_80px] gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Ruta del archivo', 'File path')}</label>
                  <input value={docForm.file_path} onChange={e => setDocForm(f => ({ ...f, file_path: e.target.value }))}
                    placeholder="/root/certs/client.p12"
                    className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                      isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                    }`} />
                </div>
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Paso', 'Step')}</label>
                  <input type="number" min="1" max="15" value={docForm.step} onChange={e => setDocForm(f => ({ ...f, step: e.target.value }))}
                    placeholder="1-15"
                    className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                      isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                    }`} />
                </div>
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={addDocument}
                  disabled={docSubmitting || !docForm.name.trim()}
                  className="px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] disabled:opacity-40 transition-colors shadow-md shadow-[#b3001e]/20"
                >
                  {docSubmitting ? L('Guardando...', 'Saving...') : L('Guardar', 'Save')}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowDocForm(false)}
                  className={`px-4 py-2.5 text-[12px] font-semibold border rounded-xl transition-colors ${isDark ? 'text-white/50 border-white/10 hover:bg-white/5' : 'text-black/50 border-black/10 hover:bg-black/5'}`}
                >
                  {L('Cancelar', 'Cancel')}
                </motion.button>
              </div>
            </motion.div>
          )}
          </AnimatePresence>

          {/* Document list */}
          {documents.length === 0 ? (
            <div className={`py-12 text-center text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#b3001e]/10 border border-[#b3001e]/20 mb-3">
                <FileText size={20} className="text-[#b3001e]" />
              </div>
              <p>{L('Sin documentos.', 'No documents.')}</p>
            </div>
          ) : (
            <div className={`rounded-2xl overflow-hidden ${isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'}`}>
              <div className={`hidden md:flex items-center px-5 py-3 border-b text-[10px] font-bold uppercase tracking-[1.2px] ${
                isDark ? 'bg-white/[0.02] border-white/10 text-white/30' : 'bg-black/[0.02] border-black/5 text-black/35'
              }`}>
                <span className="flex-1">{L('Nombre', 'Name')}</span>
                <span className="w-20">{L('Tipo', 'Type')}</span>
                <span className="w-16">{L('Paso', 'Step')}</span>
                <span className="w-28">{L('Fecha', 'Date')}</span>
              </div>
              <motion.div variants={listContainer} initial="initial" animate="animate">
                {documents.map((doc, i) => (
                  <motion.div
                    key={doc.id || i}
                    variants={listItem}
                    className={`flex items-center px-5 py-3 border-b last:border-0 transition-colors ${isDark ? 'border-white/5 hover:bg-white/[0.04]' : 'border-black/5 hover:bg-[#b3001e]/[0.03]'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{doc.name}</p>
                      {doc.file_path && <p className={`text-[11px] font-mono truncate ${isDark ? 'text-white/30' : 'text-black/30'}`}>{doc.file_path}</p>}
                    </div>
                    <span className={`w-20 text-[11px] font-medium ${isDark ? 'text-white/50' : 'text-black/50'}`}>{doc.file_type || '--'}</span>
                    <span className={`w-16 text-[11px] font-medium ${isDark ? 'text-white/50' : 'text-black/50'}`}>{doc.step || '--'}</span>
                    <span className={`w-28 text-[11px] ${isDark ? 'text-white/35' : 'text-black/35'}`}>
                      {doc.created_at ? new Date(doc.created_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '--'}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}
