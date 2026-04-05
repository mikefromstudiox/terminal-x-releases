import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Building2, ShieldCheck, FileText, MessageSquare, DollarSign, Phone, Mail, MapPin, Plus, X, ExternalLink } from 'lucide-react'
import CertStepTracker from '../components/CertStepTracker'
import CertNotes from '../components/CertNotes'

const PKG_BADGE = {
  advisory:           { label: 'Asesoria',      labelEn: 'Advisory',  cls: 'bg-sky-50 text-sky-700 border-sky-200',             clsDark: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  full:               { label: 'Completo',      labelEn: 'Full',      cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/20', clsDark: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/20' },
  full_plus_terminal: { label: 'Completo + TX', labelEn: 'Full + TX', cls: 'bg-purple-50 text-purple-700 border-purple-200',     clsDark: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
}

const PAY_BADGE = {
  pending: { label: 'Pendiente', labelEn: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200',       clsDark: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  partial: { label: 'Parcial',   labelEn: 'Partial', cls: 'bg-sky-50 text-sky-700 border-sky-200',             clsDark: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  paid:    { label: 'Pagado',    labelEn: 'Paid',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', clsDark: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
}

const STATUS_OPTIONS = ['active', 'completed', 'paused']

export default function CertificationDetail({ getToken, refreshToken, isDark, lang }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [statusDropdown, setStatusDropdown] = useState(false)
  const [docForm, setDocForm] = useState({ name: '', file_path: '', file_type: '', step: '' })
  const [showDocForm, setShowDocForm] = useState(false)
  const [docSubmitting, setDocSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      const resp = await fetch(`/api/panel?action=cert_detail&id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (!resp.ok) throw new Error('Failed')
      setData(await resp.json())
    } catch (e) { console.error('CertDetail load:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

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
    } catch {}
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
    } catch {}
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
    } catch {}
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
        body: JSON.stringify({ id, ...docForm, step: docForm.step ? parseInt(docForm.step) : null }),
      })
      setDocForm({ name: '', file_path: '', file_type: '', step: '' })
      setShowDocForm(false)
      load()
    } catch {}
    setDocSubmitting(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className={`animate-spin ${isDark ? 'text-white/20' : 'text-black/20'}`} size={20} /></div>
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

  const card = `rounded-2xl p-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-black/10'}`
  const lbl = `text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-white/30' : 'text-black/30'}`
  const val = `text-[13px] font-medium ${isDark ? 'text-white/80' : 'text-black/80'}`

  return (
    <div className="p-6 md:p-8 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin/certifications')} className={`p-2 rounded-lg transition-colors ${isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-black/40 hover:text-black hover:bg-black/5'}`}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className={`text-[20px] font-bold truncate ${isDark ? 'text-white' : 'text-black'}`}>{cert.business_name}</h1>
          <p className={`text-[12px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            RNC {cert.rnc || '--'} &middot; {L('Paso', 'Step')} {currentStep}/15
          </p>
        </div>
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border capitalize ${
          cert.status === 'completed' ? (isDark ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' : 'bg-sky-50 text-sky-700 border-sky-200')
          : cert.status === 'paused' ? (isDark ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-amber-50 text-amber-700 border-amber-200')
          : (isDark ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border-emerald-200')
        }`}>
          {cert.status || 'active'}
        </span>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        {cert.contact_phone && (
          <a href={`https://wa.me/${cert.contact_phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-200 hover:bg-emerald-500/20 transition-colors">
            <Phone size={12} /> WhatsApp
          </a>
        )}
        <div className="relative">
          <button onClick={() => setStatusDropdown(!statusDropdown)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
              isDark ? 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10' : 'bg-black/5 text-black/60 border-black/10 hover:bg-black/10'
            }`}>
            {L('Cambiar Estado', 'Change Status')}
          </button>
          {statusDropdown && (
            <div className={`absolute top-full mt-1 left-0 z-20 rounded-lg shadow-lg border overflow-hidden ${isDark ? 'bg-black border-white/10' : 'bg-white border-black/10'}`}>
              {STATUS_OPTIONS.map(s => (
                <button key={s} onClick={() => changeStatus(s)}
                  className={`block w-full text-left px-4 py-2 text-[12px] capitalize transition-colors ${
                    isDark ? 'text-white/70 hover:bg-white/10' : 'text-black/70 hover:bg-black/5'
                  } ${cert.status === s ? 'font-bold' : ''}`}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {cert.payment_status !== 'paid' && (
          <button onClick={markPaid}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/20 hover:bg-[#b3001e]/20 transition-colors">
            <DollarSign size={12} /> {L('Marcar Pagado', 'Mark Paid')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {[
          { key: 'overview',  es: 'Resumen',    en: 'Overview' },
          { key: 'notes',     es: 'Notas',      en: 'Notes' },
          { key: 'documents', es: 'Documentos', en: 'Documents' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
              tab === t.key
                ? isDark ? 'bg-white/10 text-white' : 'bg-black text-white'
                : isDark ? 'text-white/40 hover:text-white/60 hover:bg-white/5' : 'text-black/40 hover:text-black/60 hover:bg-black/5'
            }`}>
            {lang === 'es' ? t.es : t.en}
            {t.key === 'notes' && notes.length > 0 && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>{notes.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="grid md:grid-cols-[1fr_320px] gap-5">
          {/* Left: Step Tracker */}
          <div className={card}>
            <CertStepTracker
              stepsCompleted={stepsCompleted}
              currentStep={currentStep}
              onStepAction={handleStepAction}
              isDark={isDark}
              lang={lang}
            />
          </div>

          {/* Right: Info cards */}
          <div className="space-y-5">
            {/* Client info */}
            <div className={card}>
              <p className={`text-[14px] font-semibold mb-3 ${isDark ? 'text-white' : 'text-black'}`}>
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
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isDark ? pkg.clsDark : pkg.cls}`}>
                    {lang === 'es' ? pkg.label : pkg.labelEn}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment */}
            <div className={card}>
              <p className={`text-[14px] font-semibold mb-3 ${isDark ? 'text-white' : 'text-black'}`}>
                <DollarSign size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Pago', 'Payment')}
              </p>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className={lbl}>{L('Estado', 'Status')}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isDark ? pay.clsDark : pay.cls}`}>
                    {lang === 'es' ? pay.label : pay.labelEn}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className={lbl}>{L('Pagado', 'Paid')}</p>
                  <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
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
                  <div className={`h-1.5 rounded-full ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                    <div className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(100, Math.round(((cert.amount_paid || 0) / cert.price) * 100))}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes Tab */}
      {tab === 'notes' && (
        <CertNotes
          notes={notes}
          certId={id}
          token={getToken()}
          onNoteAdded={load}
          isDark={isDark}
          lang={lang}
        />
      )}

      {/* Documents Tab */}
      {tab === 'documents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className={`text-[14px] font-semibold ${isDark ? 'text-white' : 'text-black'}`}>
              <FileText size={14} className="inline mr-1.5 text-[#b3001e]" />
              {L('Documentos', 'Documents')} ({documents.length})
            </p>
            <button onClick={() => setShowDocForm(!showDocForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#b3001e] text-white text-[11px] font-bold rounded-lg hover:bg-[#8c0017] transition-colors">
              <Plus size={12} /> {L('Agregar', 'Add')}
            </button>
          </div>

          {/* Add document form */}
          {showDocForm && (
            <div className={`${card} space-y-3`}>
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
                <button onClick={addDocument} disabled={docSubmitting || !docForm.name.trim()}
                  className="px-4 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] disabled:opacity-40 transition-colors">
                  {docSubmitting ? L('Guardando...', 'Saving...') : L('Guardar', 'Save')}
                </button>
                <button onClick={() => setShowDocForm(false)}
                  className={`px-4 py-2 text-[12px] border rounded-lg ${isDark ? 'text-white/50 border-white/10 hover:bg-white/5' : 'text-black/50 border-black/10 hover:bg-black/5'}`}>
                  {L('Cancelar', 'Cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Document list */}
          {documents.length === 0 ? (
            <p className={`text-center text-[12px] py-8 ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              {L('Sin documentos.', 'No documents.')}
            </p>
          ) : (
            <div className={`rounded-2xl overflow-hidden border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-black/10'}`}>
              <div className={`hidden md:flex items-center px-5 py-2.5 border-b text-[10px] font-bold uppercase tracking-wider ${
                isDark ? 'bg-white/5 border-white/10 text-white/30' : 'bg-black/[0.02] border-black/10 text-black/30'
              }`}>
                <span className="flex-1">{L('Nombre', 'Name')}</span>
                <span className="w-20">{L('Tipo', 'Type')}</span>
                <span className="w-16">{L('Paso', 'Step')}</span>
                <span className="w-28">{L('Fecha', 'Date')}</span>
              </div>
              {documents.map((doc, i) => (
                <div key={doc.id || i} className={`flex items-center px-5 py-3 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-black/5'}`}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-medium truncate ${isDark ? 'text-white' : 'text-black'}`}>{doc.name}</p>
                    {doc.file_path && <p className={`text-[11px] truncate ${isDark ? 'text-white/30' : 'text-black/30'}`}>{doc.file_path}</p>}
                  </div>
                  <span className={`w-20 text-[11px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>{doc.file_type || '--'}</span>
                  <span className={`w-16 text-[11px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>{doc.step || '--'}</span>
                  <span className={`w-28 text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    {doc.created_at ? new Date(doc.created_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '--'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
