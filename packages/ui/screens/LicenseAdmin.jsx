/**
 * LicenseAdmin.jsx — In-app License Dashboard
 *
 * Uses the Terminal X License Server HTTP API (same server as license validation).
 * The full-featured web admin panel is at: YOUR_SERVER_URL/admin
 *
 * Set VITE_LICENSE_API in .env to your server URL.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  KeyRound, Plus, Search, ShieldCheck, ShieldX, AlertTriangle,
  RefreshCw, Copy, CheckCircle2, Trash2, RotateCcw, ChevronDown,
  X, Loader2, Lock, Calendar, ExternalLink,
} from 'lucide-react'
import { generateLicenseKey, isAdminSession, startAdminSession, endAdminSession } from '@terminal-x/services/license'
import { useLicense } from '../context/LicenseContext'

const LICENSE_API = import.meta.env.VITE_LICENSE_API || 'https://terminalxpos.com'

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiAdmin(method, path, adminKey, body) {
  const r = await fetch(`${LICENSE_API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 401) throw new Error('Clave de admin incorrecta.')
  if (!r.ok) throw new Error(`Error del servidor: ${r.status}`)
  return r.json()
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function daysUntil(d) {
  if (!d) return null
  return Math.floor((new Date(d) - new Date()) / 86400000)
}

const STATUS_CONFIG = {
  active:    { label: 'Activa',     bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500'  },
  pending:   { label: 'Pendiente',  bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  inactive:  { label: 'Inactiva',   bg: 'bg-slate-100',  text: 'text-slate-600',  dot: 'bg-slate-400'  },
  suspended: { label: 'Suspendida', bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500'    },
}
const PLAN_CONFIG = {
  trial:      { label: 'Trial',      color: 'bg-purple-100 text-purple-700' },
  standard:   { label: 'Standard',   color: 'bg-sky-100 text-sky-700'       },
  pro:        { label: 'Pro',        color: 'bg-emerald-100 text-emerald-700'},
  enterprise: { label: 'Enterprise', color: 'bg-indigo-100 text-indigo-700' },
}

// ── Admin Login ───────────────────────────────────────────────────────────────
function AdminLogin({ onSuccess }) {
  const [adminKey, setAdminKey] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleLogin() {
    if (!adminKey.trim()) return
    setLoading(true)
    setError('')
    try {
      await apiAdmin('GET', '/api/licenses', adminKey)
      startAdminSession(adminKey)
      onSuccess(adminKey)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 dark:bg-black p-8">
      <div className="bg-white dark:bg-white/5 rounded-2xl shadow-lg border border-slate-200 dark:border-white/10 p-8 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-100 dark:bg-white/10 rounded-xl flex items-center justify-center">
            <Lock size={18} className="text-sky-600" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">Acceso Admin</h3>
            <p className="text-[12px] text-slate-400 dark:text-white/40">Clave de administrador del servidor</p>
          </div>
        </div>

        <input type="password" value={adminKey}
          onChange={e => { setAdminKey(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          placeholder="Admin API Key"
          autoFocus
          className="w-full px-4 py-3 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] focus:outline-none focus:border-sky-400 bg-slate-50 dark:bg-white/5 dark:text-white" />

        {error && <p className="text-[12px] text-red-500">{error}</p>}

        <button onClick={handleLogin} disabled={loading || !adminKey.trim()}
          className="w-full py-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold rounded-xl text-[13px] transition-colors flex items-center justify-center gap-2">
          {loading ? <><Loader2 size={14} className="animate-spin" /> Verificando…</> : 'Entrar'}
        </button>

        <a href={`${LICENSE_API}/admin`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-[12px] text-sky-600 hover:underline">
          <ExternalLink size={12} />
          Abrir panel web completo
        </a>
      </div>
    </div>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────────
function CreateModal({ adminKey, onClose, onCreated }) {
  const [form, setForm] = useState({
    business_name: '', business_rnc: '', plan: 'standard',
    months: '12', max_users: '10', notes: '',
  })
  const [key,    setKey]    = useState(generateLicenseKey())
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleCreate() {
    if (!form.business_name.trim() || !form.business_rnc.trim()) {
      setError('Nombre y RNC son requeridos.'); return
    }
    setSaving(true); setError('')
    try {
      const res = await apiAdmin('POST', '/api/licenses', adminKey, {
        business_name: form.business_name.trim(),
        business_rnc:  form.business_rnc.trim(),
        plan:          form.plan,
        months:        parseInt(form.months) || null,
        max_users:     parseInt(form.max_users) || 10,
        notes:         form.notes.trim(),
        license_key:   key,
      })
      onCreated(res.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10">
          <h3 className="text-[15px] font-bold dark:text-white">Nueva Licencia</h3>
          <button onClick={onClose} className="p-1 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white"><X size={16} /></button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Key */}
          <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold text-sky-500 uppercase tracking-wider mb-1">Clave</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[14px] font-mono font-bold text-sky-700 tracking-widest">{key}</code>
              <button onClick={() => setKey(generateLicenseKey())} className="p-1.5 hover:bg-sky-100 rounded text-sky-500"><RefreshCw size={13} /></button>
              <button onClick={() => navigator.clipboard?.writeText(key)} className="p-1.5 hover:bg-sky-100 rounded text-sky-500"><Copy size={13} /></button>
            </div>
          </div>

          {[
            { k: 'business_name', label: 'Nombre del Negocio', ph: 'Car Wash El Brillo SRL' },
            { k: 'business_rnc',  label: 'RNC',                ph: '130-12345-6' },
          ].map(f => (
            <div key={f.k}>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{f.label} <span className="text-red-400">*</span></label>
              <input type="text" value={form[f.k]} onChange={e => set(f.k, e.target.value)} placeholder={f.ph}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] dark:text-white focus:outline-none focus:border-sky-400" />
            </div>
          ))}

          <div className="grid grid-cols-3 gap-3">
            {[
              { k: 'plan', label: 'Plan', type: 'select', opts: [['standard','Standard'],['pro','Pro'],['enterprise','Enterprise'],['trial','Trial']] },
              { k: 'months', label: 'Meses', type: 'select', opts: [['1','1 mes'],['3','3 meses'],['6','6 meses'],['12','1 año'],['24','2 años'],['0','Perpetua']] },
              { k: 'max_users', label: 'Usuarios', type: 'number' },
            ].map(f => (
              <div key={f.k}>
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{f.label}</label>
                {f.type === 'select'
                  ? <select value={form[f.k]} onChange={e => set(f.k, e.target.value)}
                      className="w-full px-2 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white focus:outline-none focus:border-sky-400">
                      {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  : <input type="number" value={form[f.k]} onChange={e => set(f.k, e.target.value)} min="1"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white focus:outline-none focus:border-sky-400" />
                }
              </div>
            ))}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">Notas</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] dark:text-white focus:outline-none focus:border-sky-400 resize-none" />
          </div>

          {error && <p className="text-[12px] text-red-500 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 rounded-xl text-[13px] font-semibold hover:bg-slate-50 dark:hover:bg-white/10">Cancelar</button>
          <button onClick={handleCreate} disabled={saving}
            className="flex-[2] py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white rounded-xl text-[13px] font-bold flex items-center justify-center gap-2">
            {saving ? <><Loader2 size={14} className="animate-spin" /> Guardando…</> : <><Plus size={14} /> Crear Licencia</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── License row ───────────────────────────────────────────────────────────────
function LicenseRow({ license, adminKey, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [copied,   setCopied]   = useState(false)

  const sc   = STATUS_CONFIG[license.status] || STATUS_CONFIG.pending
  const pc   = PLAN_CONFIG[license.plan]     || PLAN_CONFIG.standard
  const days = daysUntil(license.expires_at)
  const expiryColor = days === null ? '' : days < 0 ? 'text-red-600' : days < 30 ? 'text-amber-600' : 'text-slate-600'

  async function doUpdate(patch) {
    setLoading(true)
    try { await apiAdmin('PATCH', `/api/licenses/${license.id}`, adminKey, patch) } catch {}
    finally { setLoading(false); onRefresh() }
  }

  async function doExtend(months) {
    const base = (license.expires_at && new Date(license.expires_at) > new Date()) ? new Date(license.expires_at) : new Date()
    await doUpdate({ expires_at: new Date(base.getTime() + months * 30 * 86400000).toISOString(), status: 'active' })
  }

  async function doDeactivate() {
    if (!confirm('¿Desactivar esta licencia?')) return
    setLoading(true)
    try { await apiAdmin('DELETE', `/api/licenses/${license.id}`, adminKey) } catch {}
    finally { setLoading(false); onRefresh() }
  }

  async function doResetHw() {
    if (!confirm('¿Liberar el hardware ID? El cliente podrá activar en otro equipo.')) return
    await doUpdate({ hardware_id: null, activated_at: null, status: 'pending' })
  }

  return (
    <div className={`border-b border-slate-100 dark:border-white/10 ${expanded ? 'bg-slate-50 dark:bg-white/5' : 'hover:bg-slate-50/50 dark:hover:bg-white/5'}`}>
      <button className="w-full flex items-center px-5 h-14 gap-4 text-left" onClick={() => setExpanded(e => !e)}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${sc.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{license.business_name}</p>
          <p className="text-[11px] text-slate-400 dark:text-white/40">{license.business_rnc}</p>
        </div>
        <div className="w-[168px] shrink-0 flex items-center gap-1.5">
          <code className="text-[12px] font-mono text-sky-600 font-bold tracking-widest">{license.license_key}</code>
          <button onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(license.license_key); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            className="p-1 hover:bg-sky-100 rounded text-sky-400">
            {copied ? <CheckCircle2 size={11} className="text-green-500" /> : <Copy size={11} />}
          </button>
        </div>
        <div className="w-[80px] shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pc.color}`}>{pc.label}</span>
        </div>
        <div className="w-[88px] shrink-0">
          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
        </div>
        <div className="w-[112px] shrink-0 text-right">
          <p className={`text-[12px] font-medium ${expiryColor}`}>
            {license.expires_at ? (days === null ? fmtDate(license.expires_at) : days < 0 ? `Venció hace ${-days}d` : `${days}d`) : 'Perpetua'}
          </p>
        </div>
        <div className="w-[80px] shrink-0 text-right">
          {license.hardware_id
            ? <span className="text-[10px] font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">Vinculada</span>
            : <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Libre</span>
          }
        </div>
        <ChevronDown size={14} className={`text-slate-400 dark:text-white/40 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-5 pb-4 pt-3 border-t border-slate-100 dark:border-white/10 space-y-3">
          <div className="grid grid-cols-4 gap-4 text-[12px]">
            {[
              ['Creada', fmtDate(license.created_at)],
              ['Activada', fmtDate(license.activated_at)],
              ['Vence', fmtDate(license.expires_at) || 'Sin vencimiento'],
              ['Usuarios', license.max_users],
            ].map(([lbl, val]) => (
              <div key={lbl}><p className="text-slate-400 dark:text-white/40 mb-0.5">{lbl}</p><p className="font-medium text-slate-700 dark:text-white">{val}</p></div>
            ))}
          </div>

          {license.hardware_id && (
            <div className="bg-slate-100 dark:bg-white/10 rounded-lg px-3 py-2">
              <p className="text-[10px] text-slate-400 dark:text-white/40 mb-0.5">ID de Equipo</p>
              <code className="text-[11px] text-slate-600 dark:text-white/60 font-mono break-all">{license.hardware_id}</code>
            </div>
          )}
          {license.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-[12px] text-amber-700">{license.notes}</div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {license.status !== 'active' && (
              <Btn icon={ShieldCheck} color="green" loading={loading} onClick={() => doUpdate({ status: 'active' })}>Activar</Btn>
            )}
            {license.status === 'active' && (
              <Btn icon={ShieldX} color="red" loading={loading} onClick={() => doUpdate({ status: 'suspended' })}>Suspender</Btn>
            )}
            {license.status !== 'inactive' && (
              <Btn icon={Trash2} color="slate" loading={loading} onClick={doDeactivate}>Desactivar</Btn>
            )}
            <Btn icon={Calendar} color="sky" loading={loading} onClick={() => doExtend(6)}>+6 Meses</Btn>
            <Btn icon={Calendar} color="sky" loading={loading} onClick={() => doExtend(12)}>+1 Año</Btn>
            {license.hardware_id && (
              <Btn icon={RotateCcw} color="amber" loading={loading} onClick={doResetHw}>Reset Equipo</Btn>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Btn({ icon: Icon, onClick, color, loading, children }) {
  const c = { green: 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200', red: 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200', slate: 'bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200', sky: 'bg-sky-50 text-sky-700 hover:bg-sky-100 border-sky-200', amber: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200' }
  return (
    <button onClick={onClick} disabled={loading}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${c[color]} disabled:opacity-50`}>
      {loading ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />}
      {children}
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function LicenseAdmin() {
  const { hwid } = useLicense()
  const [adminKey,    setAdminKey]    = useState(() => sessionStorage.getItem('tx_admin_key') || '')
  const [authed,      setAuthed]      = useState(!!sessionStorage.getItem('tx_admin_key') && isAdminSession())
  const [licenses,    setLicenses]    = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [search,      setSearch]      = useState('')
  const [showCreate,  setShowCreate]  = useState(false)

  function onLogin(key) {
    sessionStorage.setItem('tx_admin_key', key)
    setAdminKey(key)
    setAuthed(true)
  }

  function onLogout() {
    endAdminSession()
    sessionStorage.removeItem('tx_admin_key')
    setAuthed(false)
    setAdminKey('')
    setLicenses([])
  }

  const loadLicenses = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await apiAdmin('GET', '/api/licenses', adminKey)
      setLicenses(res.data || [])
    } catch (err) {
      setError(err.message)
      if (err.message.includes('incorrecta')) onLogout()
    } finally {
      setLoading(false)
    }
  }, [adminKey])

  useEffect(() => { if (authed && adminKey) loadLicenses() }, [authed])  // eslint-disable-line

  if (!authed) return (
    <div className="h-full flex flex-col">
      <PageHeader hwid={hwid} onLogout={null} />
      <AdminLogin onSuccess={onLogin} />
    </div>
  )

  const stats = {
    total:    licenses.length,
    active:   licenses.filter(l => l.status === 'active').length,
    expiring: licenses.filter(l => { const d = daysUntil(l.expires_at); return d !== null && d >= 0 && d <= 30 }).length,
    expired:  licenses.filter(l => { const d = daysUntil(l.expires_at); return d !== null && d < 0 }).length,
  }

  const filtered = licenses.filter(l => {
    const q = search.toLowerCase().trim()
    return !q || [l.business_name, l.business_rnc, l.license_key].some(v => (v||'').toLowerCase().includes(q))
  })

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      <PageHeader hwid={hwid} onLogout={onLogout} />

      {/* Stats */}
      <div className="shrink-0 px-6 py-4 border-b border-slate-100 dark:border-white/10 grid grid-cols-4 gap-4">
        {[
          ['Total', stats.total, 'text-slate-800'],
          ['Activas', stats.active, 'text-green-600'],
          ['Vencen pronto', stats.expiring, 'text-amber-600'],
          ['Vencidas', stats.expired, 'text-red-600'],
        ].map(([lbl, val, color]) => (
          <div key={lbl} className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-center">
            <p className={`text-[24px] font-bold ${color}`}>{val}</p>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{lbl}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="shrink-0 px-6 py-3 border-b border-slate-100 dark:border-white/10 flex items-center gap-3">
        <div className="flex-1 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar negocio, RNC, clave…"
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] dark:text-white focus:outline-none focus:border-sky-400" />
        </div>
        <a href={`${LICENSE_API}/admin`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 text-[12px] font-medium rounded-xl transition-colors">
          <ExternalLink size={13} /> Panel Web
        </a>
        <button onClick={loadLicenses} disabled={loading}
          className="w-9 h-9 flex items-center justify-center text-slate-400 dark:text-white/40 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-white/10 rounded-xl">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-bold rounded-xl">
          <Plus size={14} /> Nueva Licencia
        </button>
      </div>

      {/* Column headers */}
      <div className="shrink-0 flex items-center h-9 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider gap-4">
        <span className="w-2 shrink-0" /><span className="flex-1">Negocio</span>
        <span className="w-[168px] shrink-0">Clave</span><span className="w-[80px] shrink-0">Plan</span>
        <span className="w-[88px] shrink-0">Estado</span><span className="w-[112px] shrink-0 text-right">Vencimiento</span>
        <span className="w-[80px] shrink-0 text-right">Equipo</span><span className="w-4 shrink-0" />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center h-32 text-red-400 gap-2">
            <AlertTriangle size={20} /><p className="text-[13px]">{error}</p>
          </div>
        ) : loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center h-14 border-b border-slate-100 dark:border-white/10 px-5 gap-4 animate-pulse">
              <div className="w-2 h-2 bg-slate-100 dark:bg-white/10 rounded-full" />
              <div className="flex-1 space-y-1.5"><div className="h-3.5 bg-slate-100 dark:bg-white/10 rounded w-3/4" /><div className="h-3 bg-slate-100 dark:bg-white/10 rounded w-1/3" /></div>
              <div className="w-40 h-4 bg-slate-100 dark:bg-white/10 rounded" /><div className="w-16 h-5 bg-slate-100 dark:bg-white/10 rounded-full" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-300 dark:text-white/40 gap-2">
            <KeyRound size={28} /><p className="text-[13px]">{licenses.length === 0 ? 'No hay licencias' : 'Sin resultados'}</p>
          </div>
        ) : (
          filtered.map(l => <LicenseRow key={l.id} license={l} adminKey={adminKey} onRefresh={loadLicenses} />)
        )}
      </div>

      {showCreate && (
        <CreateModal adminKey={adminKey} onClose={() => setShowCreate(false)}
          onCreated={newLic => { setLicenses(prev => [newLic, ...prev]); setShowCreate(false) }} />
      )}
    </div>
  )
}

function PageHeader({ hwid, onLogout }) {
  return (
    <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-sky-600 rounded-xl flex items-center justify-center">
          <KeyRound size={15} className="text-white" />
        </div>
        <div>
          <h2 className="text-[16px] font-bold text-slate-800 dark:text-white">Licencias TX</h2>
          <p className="text-[11px] text-slate-400 dark:text-white/40">Solo para administradores Terminal X</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {hwid && <p className="text-[10px] text-slate-400 dark:text-white/40"><span className="font-medium">HWID:</span> <code>{hwid?.slice(0,8)}…</code></p>}
        {onLogout && (
          <button onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 text-[12px] font-medium rounded-xl">
            <Lock size={12} /> Cerrar sesión
          </button>
        )}
      </div>
    </div>
  )
}
