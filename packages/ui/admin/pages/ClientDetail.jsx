import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Building2, KeyRound, Users, ShoppingCart, Layers, UserCheck, Settings, CheckCircle2, Pencil, Save, X } from 'lucide-react'
import { useLang } from '../../i18n'
import OnboardingChecklist from '../components/OnboardingChecklist'
import QuickActions from '../components/QuickActions'
import ConfigEditor from '../components/ConfigEditor'

const STATUS_CLS = {
  active:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  expired:   'bg-slate-100 text-slate-500 border-slate-200',
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

  async function load() {
    setLoading(true)
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      const resp = await fetch(`/api/panel?action=client_detail&id=${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
      if (!resp.ok) throw new Error('Failed')
      setData(await resp.json())
    } catch (e) { console.error('ClientDetail load:', e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-slate-400" size={20} /></div>
  }
  if (!data?.business) {
    return (
      <div className="p-6 md:p-8">
        <button onClick={() => navigate('/admin/clients')} className="flex items-center gap-1.5 text-[13px] mb-4 text-slate-400 hover:text-slate-700">
          <ArrowLeft size={15} /> {L('Volver', 'Back')}
        </button>
        <p className="text-center text-[13px] text-slate-400">{L('Cliente no encontrado.', 'Client not found.')}</p>
      </div>
    )
  }

  const biz = data.business
  const license = data.license
  const staff = data.staff || []
  const onboarding = data.onboarding
  const metrics = data.metrics || {}

  const card = `rounded-2xl p-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-slate-200'}`
  const lbl = `text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-white/30' : 'text-slate-400'}`
  const val = `text-[13px] font-medium ${isDark ? 'text-white/80' : 'text-slate-700'}`

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

  const planDisplay = typeof biz.plan === 'string' ? biz.plan.replace('_', ' ').toUpperCase() : '—'
  const licPlanDisplay = license?.plans?.display_name || '—'
  const ticketCount = metrics.ticketCount || 0
  const totalRevenue = metrics.totalRevenue || 0
  const serviceCount = metrics.serviceCount || 0
  const clientCount = metrics.clientCount || 0
  const staffActive = staff.filter(s => s.active).length
  const lastSale = metrics.lastSaleDate ? new Date(metrics.lastSaleDate).toLocaleDateString('es-DO') : '—'

  return (
    <div className="p-6 md:p-8 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin/clients')} className={`p-2 rounded-lg transition-colors ${isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className={`text-[20px] font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>{String(biz.name || '')}</h1>
          <p className={`text-[12px] ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
            {String(biz.rnc || L('Sin RNC', 'No RNC'))} &middot; {L('Creado', 'Created')} {new Date(biz.created_at).toLocaleDateString('es-DO')}
          </p>
        </div>
        {license && (
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_CLS[license.status] || STATUS_CLS.expired}`}>
            {String(license.status)}
          </span>
        )}
      </div>

      {/* Quick Actions */}
      <QuickActions business={biz} license={license} getToken={getToken} onRefresh={load} isDark={isDark} />

      {/* Tabs */}
      <div className="flex gap-1">
        {['overview', 'config'].map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
              tab === k
                ? isDark ? 'bg-white/10 text-white' : 'bg-slate-800 text-white'
                : isDark ? 'text-white/40 hover:text-white/60 hover:bg-white/5' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            }`}>
            {k === 'overview' ? L('Resumen', 'Overview') : L('Configuracion', 'Configuration')}
          </button>
        ))}
      </div>

      {tab === 'config' && (
        <ConfigEditor businessId={id} getToken={getToken} onRefresh={load} isDark={isDark} />
      )}

      {tab === 'overview' && <>
        <div className="grid md:grid-cols-2 gap-5">
          {/* Business Info */}
          <div className={card}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-[14px] font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>
                <Building2 size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Negocio', 'Business')}
              </p>
              {!editing && (
                <button onClick={startEdit} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-white/30 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-sky-600 hover:bg-sky-50'}`} title={L('Editar', 'Edit')}>
                  <Pencil size={14} />
                </button>
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
                      className={`w-full px-3 py-1.5 rounded-lg text-[13px] border focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-700'}`} />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setEditing(false)} className={`px-4 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${isDark ? 'border-white/10 text-white/50 hover:bg-white/5' : 'border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                    <X size={12} className="inline mr-1" />{L('Cancelar', 'Cancel')}
                  </button>
                  <button onClick={saveEdit} disabled={editSaving} className="flex-1 py-1.5 bg-[#b3001e] hover:bg-[#8f0018] disabled:opacity-60 text-white text-[12px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5">
                    {editSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {L('Guardar', 'Save')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                <div><p className={lbl}>{L('Nombre', 'Name')}</p><p className={val}>{String(biz.name || '—')}</p></div>
                <div><p className={lbl}>RNC</p><p className={val}>{String(biz.rnc || '—')}</p></div>
                <div><p className={lbl}>{L('Telefono', 'Phone')}</p><p className={val}>{String(biz.phone || '—')}</p></div>
                <div><p className={lbl}>Email</p><p className={val}>{String(biz.email || '—')}</p></div>
                <div><p className={lbl}>{L('Direccion', 'Address')}</p><p className={val}>{String(biz.address || '—')}</p></div>
                <div><p className={lbl}>Plan</p><p className={val}>{planDisplay}</p></div>
              </div>
            )}
          </div>

          {/* License */}
          <div className={card}>
            <p className={`text-[14px] font-semibold mb-3 ${isDark ? 'text-white' : 'text-slate-800'}`}>
              <KeyRound size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Licencia', 'License')}
            </p>
            {license ? (
              <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                <div><p className={lbl}>{L('Clave', 'Key')}</p><p className={`font-mono text-[11px] ${isDark ? 'text-white/60' : 'text-slate-600'}`}>{String(license.license_key || 'Web only')}</p></div>
                <div><p className={lbl}>{L('Plataforma', 'Platform')}</p><p className={val}>{String(license.platform || '—')}</p></div>
                <div><p className={lbl}>Plan</p><p className={val}>{String(licPlanDisplay)}</p></div>
                <div><p className={lbl}>Status</p><p className={val}>{String(license.status || '—')}</p></div>
                <div><p className={lbl}>{L('Ultimo acceso', 'Last seen')}</p><p className={val}>{license.last_seen ? new Date(license.last_seen).toLocaleDateString('es-DO') : '—'}</p></div>
                <div><p className={lbl}>HWID</p><p className={`font-mono text-[10px] truncate ${isDark ? 'text-white/40' : 'text-slate-400'}`}>{String(license.hardware_id || '—')}</p></div>
                {license.expires_at && <div className="col-span-2"><p className={lbl}>{L('Expira', 'Expires')}</p><p className={val}>{new Date(license.expires_at).toLocaleDateString('es-DO')}</p></div>}
              </div>
            ) : (
              <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-slate-400'}`}>{L('Sin licencia.', 'No license.')}</p>
            )}
          </div>

          {/* Metrics */}
          <div className={card}>
            <p className={`text-[14px] font-semibold mb-3 ${isDark ? 'text-white' : 'text-slate-800'}`}>
              <ShoppingCart size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Metricas', 'Metrics')}
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div><p className={lbl}>Tickets</p><p className={`text-[16px] font-bold mt-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{ticketCount}</p></div>
              <div><p className={lbl}>{L('Ingresos', 'Revenue')}</p><p className={`text-[16px] font-bold mt-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{'RD$' + totalRevenue.toLocaleString('es-DO', { minimumFractionDigits: 0 })}</p></div>
              <div><p className={lbl}>{L('Servicios', 'Services')}</p><p className={`text-[16px] font-bold mt-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{serviceCount}</p></div>
              <div><p className={lbl}>{L('Clientes', 'Customers')}</p><p className={`text-[16px] font-bold mt-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{clientCount}</p></div>
              <div><p className={lbl}>Staff</p><p className={`text-[16px] font-bold mt-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{staffActive}</p></div>
              <div><p className={lbl}>{L('Ultima venta', 'Last sale')}</p><p className={`text-[16px] font-bold mt-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{lastSale}</p></div>
            </div>
          </div>

          {/* Onboarding */}
          <div className={card}>
            <OnboardingChecklist onboarding={onboarding} compact={false} isDark={isDark} />
          </div>
        </div>

        {/* Staff List */}
        <div className={card}>
          <p className={`text-[14px] font-semibold mb-3 ${isDark ? 'text-white' : 'text-slate-800'}`}>
            <Users size={14} className="inline mr-1.5 text-[#b3001e]" />{L('Personal', 'Staff')} ({staff.length})
          </p>
          {staff.length === 0 ? (
            <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-slate-400'}`}>{L('Sin personal.', 'No staff.')}</p>
          ) : (
            <div className="space-y-0">
              {staff.map(s => (
                <div key={s.id} className={`flex items-center justify-between py-2.5 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-slate-100'}`}>
                  <div>
                    <p className={`text-[13px] font-medium ${isDark ? 'text-white/80' : 'text-slate-700'}`}>{String(s.name)}</p>
                    <p className={`text-[11px] ${isDark ? 'text-white/30' : 'text-slate-400'}`}>{String(s.username)} &middot; {String(s.role)}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    s.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'
                  }`}>
                    {s.active ? L('Activo', 'Active') : L('Inactivo', 'Inactive')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>}
    </div>
  )
}
