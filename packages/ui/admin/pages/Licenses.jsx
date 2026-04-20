import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Plus, Search, RotateCcw, Ban, CheckCircle2, X, ShieldAlert, ShieldCheck } from 'lucide-react'
import { listContainer, listItem, modalBackdrop, modalPanel } from '../motion'

const STATUS_BADGE_LIGHT = {
  active:    'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  pending:   'bg-amber-500/10 text-amber-600 border-amber-500/30',
  suspended: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25',
  expired:   'bg-black/5 text-black/40 border-black/10',
  cancelled: 'bg-black/5 text-black/30 border-black/10',
}

const STATUS_BADGE_DARK = {
  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  pending:   'bg-amber-500/10 text-amber-400 border-amber-500/30',
  suspended: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30',
  expired:   'bg-white/5 text-white/40 border-white/10',
  cancelled: 'bg-white/5 text-white/30 border-white/10',
}

const EMPTY_FORM = { business_id: '', platform: 'web', max_users: '5', notes: '' }

export default function Licenses({ getToken, refreshToken, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [businesses, setBusinesses] = useState([])
  const [addForm, setAddForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')

  const [rebinds, setRebinds] = useState([])
  const [rebindBusy, setRebindBusy] = useState({})

  useEffect(() => { load(); loadRebinds() }, [])

  async function loadRebinds() {
    try {
      const token = getToken()
      const resp = await fetch('/api/panel?action=rebind_requests', { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) setRebinds((await resp.json()).data || [])
    } catch {}
  }

  async function actOnRebind(id, approve) {
    setRebindBusy(b => ({ ...b, [id]: true }))
    try {
      const token = getToken()
      const action = approve ? 'approve_rebind' : 'reject_rebind'
      await fetch(`/api/panel?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id }),
      })
      await Promise.all([loadRebinds(), load()])
    } finally {
      setRebindBusy(b => { const n = { ...b }; delete n[id]; return n })
    }
  }

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const token = getToken()
      const resp = await fetch('/api/panel?action=licenses', { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) setList((await resp.json()).data || [])
      else setLoadErr(L('Error al cargar licencias', 'Error loading licenses'))
    } catch { setLoadErr(L('Error al cargar licencias', 'Error loading licenses')) }
    setLoading(false)
  }

  async function loadBusinesses() {
    try {
      const token = getToken()
      const resp = await fetch('/api/panel?action=clients', { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) {
        const result = await resp.json()
        setBusinesses((result.data || []).map(b => ({ id: b.id, name: b.name, rnc: b.rnc })))
      }
    } catch {}
  }

  async function updateLicense(id, patch) {
    const token = getToken()
    await fetch('/api/panel?action=licenses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id, ...patch }),
    })
    load()
  }

  async function createLicense() {
    if (!addForm.business_id) { setAddErr(L('Seleccione un negocio', 'Select a business')); return }
    setAdding(true); setAddErr('')
    try {
      const token = getToken()
      const resp = await fetch('/api/panel?action=licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          business_id: addForm.business_id,
          platform: addForm.platform,
          max_users: parseInt(addForm.max_users, 10) || 5,
          notes: addForm.notes.trim() || null,
        }),
      })
      if (!resp.ok) {
        const r = await resp.json()
        throw new Error(r.error || L('Error al crear', 'Error creating'))
      }
      setShowAdd(false)
      setAddForm(EMPTY_FORM)
      load()
    } catch (e) { setAddErr(e.message) }
    finally { setAdding(false) }
  }

  function openAdd() {
    setAddForm(EMPTY_FORM)
    setAddErr('')
    setShowAdd(true)
    if (!businesses.length) loadBusinesses()
  }

  const FILTER_LABELS = { all: L('Todas', 'All'), active: L('Activa', 'Active'), pending: L('Pendiente', 'Pending'), suspended: L('Suspendida', 'Suspended'), expired: L('Expirada', 'Expired') }

  const filtered = list.filter(l => {
    if (filter !== 'all' && l.status !== filter) return false
    if (search) {
      const s = search.toLowerCase()
      return (l.businesses?.name || '').toLowerCase().includes(s) ||
             (l.businesses?.rnc || '').includes(s) ||
             (l.license_key || '').toLowerCase().includes(s)
    }
    return true
  })

  const STATUS_BADGE = isDark ? STATUS_BADGE_DARK : STATUS_BADGE_LIGHT
  const tableBase = isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'
  const inputBase = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'
    : 'bg-white border-black/10 text-black placeholder-black/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'

  return (
    <div className="p-6 md:p-8 space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <h1 className={`text-[24px] font-black tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>{L('Licencias', 'Licenses')}</h1>
          <p className={`text-[12px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{list.length} total</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={openAdd}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] transition-colors shadow-lg shadow-[#b3001e]/20"
        >
          <Plus size={14} /> {L('Nueva Licencia', 'New License')}
        </motion.button>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
        className="flex items-center gap-3 flex-wrap"
      >
        <div className="relative flex-1 max-w-sm min-w-[240px]">
          <Search size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10 ${isDark ? 'text-white/30' : 'text-black/30'}`} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={L('Buscar por nombre, RNC o clave...', 'Search by name, RNC, or key...')}
            style={{ paddingLeft: 38 }}
            className={`w-full pr-3 py-2.5 border rounded-xl text-[12px] outline-none transition-all focus:ring-2 ${inputBase}`} />
        </div>
        <div className="flex gap-1 flex-wrap">
          {['all', 'active', 'pending', 'suspended', 'expired'].map(f => (
            <motion.button
              key={f}
              whileTap={{ scale: 0.95 }}
              onClick={() => setFilter(f)}
              className={`relative px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                filter === f
                  ? 'text-white'
                  : isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70'
              }`}
            >
              {filter === f && (
                <motion.div
                  layoutId="licFilterPill"
                  className="absolute inset-0 rounded-full bg-[#b3001e]"
                  transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                />
              )}
              <span className="relative">{FILTER_LABELS[f] || f}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Pending HWID rebind requests (S-H9) */}
      {rebinds.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl overflow-hidden border ${isDark ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-amber-400/40 bg-amber-50'}`}
        >
          <div className="flex items-center gap-2 px-5 py-3 border-b border-inherit">
            <ShieldAlert size={15} className="text-amber-500" />
            <h2 className={`text-[13px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
              {L('Solicitudes de rebind de equipo', 'HWID rebind requests')}
            </h2>
            <span className="ml-auto text-[11px] font-bold text-amber-500">{rebinds.length}</span>
          </div>
          <div>
            {rebinds.map(r => {
              const biz = r.licenses?.businesses
              const busy = !!rebindBusy[r.id]
              const short = (h) => h ? `${h.slice(0, 8)}...${h.slice(-6)}` : '—'
              return (
                <div key={r.id} className={`flex items-center gap-3 px-5 py-3 border-b last:border-0 flex-wrap ${isDark ? 'border-white/5' : 'border-black/5'}`}>
                  <div className="flex-1 min-w-[220px]">
                    <p className={`text-[13px] font-semibold ${isDark ? 'text-white' : 'text-black'}`}>{biz?.name || '—'}</p>
                    <p className={`text-[11px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                      {biz?.rnc || '—'} · <span className="font-mono">{r.licenses?.license_key || '—'}</span>
                    </p>
                  </div>
                  <div className="text-[11px] font-mono">
                    <p className={isDark ? 'text-white/60' : 'text-black/60'}>
                      <span className={isDark ? 'text-white/30' : 'text-black/30'}>actual:</span> {short(r.current_hwid)}
                    </p>
                    <p className="text-amber-500">
                      <span className={isDark ? 'text-white/30' : 'text-black/30'}>nuevo:</span> {short(r.requested_hwid)}
                    </p>
                  </div>
                  <div className={`text-[10px] ${isDark ? 'text-white/40' : 'text-black/40'} min-w-[110px]`}>
                    <p>{new Date(r.requested_at).toLocaleString(lang === 'es' ? 'es-DO' : 'en-US')}</p>
                    <p>Expira: {new Date(r.expires_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US')}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      disabled={busy}
                      onClick={() => actOnRebind(r.id, true)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500 text-white disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
                      {L('Aprobar', 'Approve')}
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      disabled={busy}
                      onClick={() => actOnRebind(r.id, false)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#b3001e] text-white disabled:opacity-50"
                    >
                      <X size={11} />
                      {L('Rechazar', 'Reject')}
                    </motion.button>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <motion.div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <motion.span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-[#b3001e]"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </motion.div>
        </div>
      ) : loadErr ? (
        <div className="py-12 text-center text-[13px] text-[#b3001e]">{loadErr}</div>
      ) : (
        <div className={`rounded-2xl overflow-hidden ${tableBase}`}>
          {/* Desktop table header */}
          <div className={`hidden lg:flex items-center px-5 py-3 border-b text-[10px] font-bold uppercase tracking-[1.2px] ${
            isDark ? 'bg-white/[0.02] border-white/10 text-white/30' : 'bg-black/[0.02] border-black/5 text-black/35'
          }`}>
            <span className="flex-1">{L('Negocio', 'Business')}</span>
            <span className="w-28">RNC</span>
            <span className="w-40">{L('Clave', 'Key')}</span>
            <span className="w-24">Plan</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-28">{L('Ultimo acceso', 'Last seen')}</span>
            <span className="w-24 text-right">{L('Acciones', 'Actions')}</span>
          </div>

          {filtered.length === 0 ? (
            <div className={`py-16 text-center text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#b3001e]/10 border border-[#b3001e]/20 mb-3">
                <Search size={20} className="text-[#b3001e]" />
              </div>
              <p>{L('Sin licencias.', 'No licenses.')}</p>
            </div>
          ) : (
            <motion.div variants={listContainer} initial="initial" animate="animate">
              {filtered.map(l => (
                <motion.div
                  key={l.id}
                  variants={listItem}
                  className={`border-b last:border-0 transition-colors ${
                    isDark ? 'border-white/5 hover:bg-white/[0.04]' : 'border-black/5 hover:bg-[#b3001e]/[0.03]'
                  }`}
                >
                  {/* Desktop row */}
                  <div className="hidden lg:flex items-center px-5 py-3.5">
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{l.businesses?.name || '—'}</p>
                      <p className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-white/40' : 'text-black/40'}`}>{l.platform}</p>
                    </div>
                    <span className={`w-28 text-[12px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>{l.businesses?.rnc || '—'}</span>
                    <span className={`w-40 text-[11px] font-mono ${isDark ? 'text-white/70' : 'text-black/70'}`}>{l.license_key || L('Solo web', 'Web only')}</span>
                    <span className={`w-24 text-[12px] font-medium ${isDark ? 'text-white/70' : 'text-black/70'}`}>{l.plans?.display_name || '—'}</span>
                    <div className="w-24 flex justify-center">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_BADGE[l.status] || STATUS_BADGE.cancelled}`}>
                        {l.status}
                      </span>
                    </div>
                    <span className={`w-28 text-[11px] ${isDark ? 'text-white/35' : 'text-black/35'}`}>
                      {l.last_seen ? new Date(l.last_seen).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '—'}
                    </span>
                    <div className="w-24 flex justify-end gap-1">
                      {l.status === 'active' && (
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          onClick={() => updateLicense(l.id, { status: 'suspended' })}
                          title={L('Suspender', 'Suspend')}
                          className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-white/30 hover:text-[#b3001e] hover:bg-[#b3001e]/10' : 'text-black/30 hover:text-[#b3001e] hover:bg-[#b3001e]/10'}`}
                        >
                          <Ban size={13} />
                        </motion.button>
                      )}
                      {(l.status === 'suspended' || l.status === 'pending') && (
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          onClick={() => updateLicense(l.id, { status: 'active' })}
                          title={L('Activar', 'Activate')}
                          className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                        >
                          <CheckCircle2 size={13} />
                        </motion.button>
                      )}
                      {l.hardware_id && (
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          onClick={() => updateLicense(l.id, { hardware_id: null })}
                          title="Reset HWID"
                          className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-white/30 hover:text-[#b3001e] hover:bg-[#b3001e]/10' : 'text-black/30 hover:text-[#b3001e] hover:bg-[#b3001e]/10'}`}
                        >
                          <RotateCcw size={13} />
                        </motion.button>
                      )}
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="lg:hidden px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{l.businesses?.name || '—'}</p>
                        <p className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{l.businesses?.rnc || '—'} / {l.platform}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_BADGE[l.status] || STATUS_BADGE.cancelled}`}>
                        {l.status}
                      </span>
                    </div>
                    <div className={`flex items-center justify-between text-[11px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                      <span>Plan: <span className={`font-semibold ${isDark ? 'text-white/80' : 'text-black/80'}`}>{l.plans?.display_name || '—'}</span></span>
                      <span>{l.last_seen ? new Date(l.last_seen).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '—'}</span>
                    </div>
                    {l.license_key && (
                      <p className={`font-mono text-[10px] px-2 py-1 rounded-lg truncate ${isDark ? 'text-white/60 bg-white/5' : 'text-black/60 bg-black/[0.03]'}`}>{l.license_key}</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      {l.status === 'active' && (
                        <motion.button
                          whileTap={{ scale: 0.94 }}
                          onClick={() => updateLicense(l.id, { status: 'suspended' })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#b3001e] bg-[#b3001e]/10 border border-[#b3001e]/25"
                        >
                          <Ban size={12} /> {L('Suspender', 'Suspend')}
                        </motion.button>
                      )}
                      {(l.status === 'suspended' || l.status === 'pending') && (
                        <motion.button
                          whileTap={{ scale: 0.94 }}
                          onClick={() => updateLicense(l.id, { status: 'active' })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-600 bg-emerald-500/10 border border-emerald-500/30"
                        >
                          <CheckCircle2 size={12} /> {L('Activar', 'Activate')}
                        </motion.button>
                      )}
                      {l.hardware_id && (
                        <motion.button
                          whileTap={{ scale: 0.94 }}
                          onClick={() => updateLicense(l.id, { hardware_id: null })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#b3001e] bg-[#b3001e]/10 border border-[#b3001e]/25"
                        >
                          <RotateCcw size={12} /> Reset HWID
                        </motion.button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      )}

      {/* Add License Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            variants={modalBackdrop}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowAdd(false)}
          >
            <motion.div
              variants={modalPanel}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-3xl shadow-2xl w-full max-w-md overflow-hidden ${isDark ? 'bg-black border border-white/10' : 'bg-white border border-black/10'}`}
            >
              <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                <h3 className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{L('Nueva Licencia', 'New License')}</h3>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowAdd(false)}
                  className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/40' : 'hover:bg-black/5 text-black/40'}`}
                >
                  <X size={16} />
                </motion.button>
              </div>
              <div className="px-6 py-5 space-y-3.5">
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Negocio *', 'Business *')}</label>
                  <select value={addForm.business_id} onChange={e => setAddForm(f => ({ ...f, business_id: e.target.value }))}
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`}>
                    <option value="">{L('Seleccionar negocio...', 'Select business...')}</option>
                    {businesses.map(b => (
                      <option key={b.id} value={b.id}>{b.name}{b.rnc ? ` (${b.rnc})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Plataforma', 'Platform')}</label>
                  <select value={addForm.platform} onChange={e => setAddForm(f => ({ ...f, platform: e.target.value }))}
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`}>
                    <option value="web">Web</option>
                    <option value="desktop">Desktop</option>
                    <option value="both">{L('Ambos', 'Both')}</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Max Usuarios', 'Max Users')}</label>
                  <input type="number" min="1" max="50" value={addForm.max_users}
                    onChange={e => setAddForm(f => ({ ...f, max_users: e.target.value }))}
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                </div>
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Notas', 'Notes')}</label>
                  <input value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder={L('Opcional', 'Optional')}
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                </div>
              </div>
              {addErr && <p className="px-6 pb-2 text-[11px] text-[#b3001e] font-semibold">{addErr}</p>}
              <div className={`flex gap-2 px-6 py-4 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={createLicense}
                  disabled={adding}
                  className="flex-1 px-4 py-3 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] disabled:opacity-50 transition-colors shadow-lg shadow-[#b3001e]/20 flex items-center justify-center gap-1.5"
                >
                  {adding && <Loader2 size={12} className="animate-spin" />}
                  {adding ? L('Creando...', 'Creating...') : L('Crear Licencia', 'Create License')}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowAdd(false)}
                  className={`px-4 py-3 text-[12px] font-semibold border rounded-xl transition-colors ${isDark ? 'text-white/50 border-white/10 hover:bg-white/5' : 'text-black/50 border-black/10 hover:bg-black/5'}`}
                >
                  {L('Cancelar', 'Cancel')}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
