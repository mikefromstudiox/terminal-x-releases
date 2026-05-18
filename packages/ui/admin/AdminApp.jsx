import { useState, useEffect, useCallback, Component } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { LayoutDashboard, KeyRound, Building2, Users, LogOut, Loader2, Sun, Moon, Monitor, ShieldCheck, MessageCircle, ShieldAlert, FlaskConical, Target } from 'lucide-react'
import { withRetry, isSupabaseRetryable } from '@terminal-x/services/retry.js'
import { humanizeNetworkError } from '@terminal-x/services/networkError.js'

class AdminErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-center">
          <p className="text-[#b3001e] font-bold mb-2">Error in admin panel</p>
          <pre className="text-xs text-left bg-[#b3001e]/10 border border-[#b3001e]/20 p-4 rounded-lg overflow-auto max-h-40 text-[#b3001e]">{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
          <button onClick={() => { this.setState({ error: null }); window.location.hash = '/admin' }}
            className="mt-4 px-4 py-2 bg-black text-white rounded-lg text-sm">Volver al Dashboard</button>
        </div>
      )
    }
    return this.props.children
  }
}
import logoImg from '../assets/logo.webp'
import xMark from '../assets/x-mark.webp'
import { useLang } from '../i18n'
import Dashboard from './pages/Dashboard'
import Licenses from './pages/Licenses'
import LicenseRebinds from './pages/LicenseRebinds'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Team from './pages/Team'
import Certifications from './pages/Certifications'
import CertificationDetail from './pages/CertificationDetail'
import Support from './pages/Support'
import CRM from './pages/CRM'
import CRMLead from './pages/CRMLead'
import { loginCard, buttonTap, pageVariants } from './motion'

function getSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useAdminTheme() {
  const [preference, setPreference] = useState(() => {
    const stored = localStorage.getItem('tx_admin_theme')
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
    return 'system'
  })

  const resolved = preference === 'system' ? getSystemTheme() : preference
  const isDark = resolved === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('tx_admin_theme', preference)
  }, [isDark, preference])

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handler = () => { if (preference === 'system') setPreference('system') }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [preference])

  function toggle() {
    const order = ['system', 'light', 'dark']
    setPreference(p => order[(order.indexOf(p) + 1) % 3])
  }

  return { preference, isDark, toggle }
}

export default function AdminApp({ supabase }) {
  const [admin, setAdmin] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPw, setLoginPw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const { lang, setLang } = useLang()
  const location = useLocation()
  const theme = useAdminTheme()

  const checkAdmin = useCallback(async (showErrors = false) => {
    if (!supabase) { setLoading(false); return }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setLoading(false); return }

      const token = session.access_token
      const resp = await fetch('/api/panel?action=stats', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (resp.status === 403 || resp.status === 401) {
        if (showErrors) setError('No tienes acceso de administrador.')
        setLoading(false)
        return
      }
      if (!resp.ok) throw new Error('Error al conectar')

      setAdmin({ token })
    } catch (e) {
      if (showErrors) setError(e.message)
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { checkAdmin(false) }, [checkAdmin])

  async function handleLogin(e) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const { error: err } = await withRetry(
        () => supabase.auth.signInWithPassword({ email: loginEmail, password: loginPw }),
        { label: 'auth.admin.signIn', isRetryable: isSupabaseRetryable },
      )
      if (err) throw err
      await checkAdmin(true)
    } catch (err) {
      setError(humanizeNetworkError(err, { context: 'auth.admin.signIn' }))
    }
    setSubmitting(false)
  }

  function getToken() { return admin?.token || '' }

  async function refreshToken() {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) { setAdmin({ token: session.access_token }); return session.access_token }
    return ''
  }

  async function logout() {
    await supabase.auth.signOut()
    setAdmin(null)
    navigate('/admin')
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="w-2 h-2 rounded-full bg-[#b3001e]"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.1, 0.85] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
            />
          ))}
        </motion.div>
      </div>
    )
  }

  // ── Login screen ──
  if (!admin) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center p-4 relative overflow-hidden">
        {/* Ambient red glow blobs */}
        <motion.div
          className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-[#b3001e]/10 blur-[140px] pointer-events-none"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.div
          className="absolute -bottom-40 -right-40 w-[520px] h-[520px] rounded-full bg-[#b3001e]/8 blur-[140px] pointer-events-none"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        />

        <motion.form
          onSubmit={handleLogin}
          variants={loginCard}
          initial="initial"
          animate="animate"
          className="relative bg-black rounded-3xl p-9 sm:p-10 w-full max-w-md space-y-6 shadow-[0_40px_120px_-20px_rgba(179,0,30,0.45)] border border-white/10"
        >
          <div className="text-center">
            <motion.div
              className="flex items-center justify-center gap-0"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="text-4xl sm:text-5xl font-black tracking-[2px] text-white leading-none">TERMINAL</span>
              <img src={logoImg} alt="X" className="h-12 sm:h-14 w-auto object-contain -ml-1" draggable="false" />
            </motion.div>
            <motion.div
              className="inline-block mt-4 px-3.5 py-1 bg-[#b3001e]/15 border border-[#b3001e]/30 text-white text-[10px] font-bold tracking-[2px] rounded-full uppercase"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
            >
              Admin Panel
            </motion.div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-[#b3001e]/15 border border-[#b3001e]/30 text-white/90 text-[12px] p-3 rounded-xl">{error}</div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-4">
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35, duration: 0.4 }}
            >
              <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[1.5px] mb-1.5">Email</label>
              <input
                type="email"
                placeholder="tu@email.com"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                autoComplete="username"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none transition-all focus:border-[#b3001e] focus:bg-white/[0.07] focus:ring-2 focus:ring-[#b3001e]/30"
                required
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.42, duration: 0.4 }}
            >
              <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[1.5px] mb-1.5">Contrasena</label>
              <input
                type="password"
                placeholder="Tu contrasena"
                value={loginPw}
                onChange={e => setLoginPw(e.target.value)}
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 outline-none transition-all focus:border-[#b3001e] focus:bg-white/[0.07] focus:ring-2 focus:ring-[#b3001e]/30"
                required
              />
            </motion.div>
          </div>

          <motion.button
            type="submit"
            disabled={submitting}
            whileTap={{ scale: 0.97 }}
            whileHover={{ scale: submitting ? 1 : 1.01 }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            className="w-full py-3.5 rounded-xl bg-[#b3001e] hover:bg-[#c8002a] text-white text-[13px] font-bold tracking-wide disabled:opacity-50 transition-colors shadow-lg shadow-[#b3001e]/25"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Entrando...
              </span>
            ) : 'Entrar'}
          </motion.button>

          <motion.a
            href="/"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="block text-center text-[11px] text-white/40 hover:text-[#b3001e] transition-colors"
          >
            Volver al sitio
          </motion.a>
        </motion.form>
      </div>
    )
  }

  // ── Main panel ──
  const L = (es, en) => lang === 'es' ? es : en
  const NAV = [
    { path: '/admin',          icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/admin/crm',      icon: Target,          label: 'CRM' },
    { path: '/admin/clients',  icon: Building2,       label: L('Clientes', 'Clients') },
    { path: '/admin/demos',    icon: FlaskConical,    label: L('Demos', 'Demos') },
    { path: '/admin/licenses', icon: KeyRound,        label: L('Licencias', 'Licenses') },
    { path: '/admin/license-rebinds', icon: ShieldAlert, label: L('Rebinds', 'Rebinds') },
    { path: '/admin/certifications', icon: ShieldCheck, label: L('Certificaciones', 'Certifications') },
    { path: '/admin/support',  icon: MessageCircle,   label: L('Soporte', 'Support') },
    { path: '/admin/team',     icon: Users,           label: L('Equipo', 'Team') },
  ]

  return (
    <div className={`min-h-screen flex flex-col md:flex-row ${theme.isDark ? 'bg-black' : 'bg-white'}`}>
      {/* Desktop Sidebar — always black */}
      <div className="hidden md:flex w-[260px] flex-col shrink-0 border-r bg-black border-white/10 relative">
        {/* Subtle ambient red glow top-left of sidebar */}
        <div className="absolute top-0 left-0 w-56 h-56 bg-[#b3001e]/10 blur-[80px] pointer-events-none" />

        {/* Header — logo only. Theme toggle moved to the bottom panel above
            ES/EN per Mike's 2026-05-18 spec. Keeps the top breathing-room
            clean and groups all controls (theme + lang + logout) together. */}
        <div className="relative flex items-center justify-start px-5 py-6 border-b border-white/10">
          <div className="flex items-center gap-0">
            <span className="text-[22px] font-black tracking-[3px] text-white leading-none -mt-1">TERMINAL</span>
            <img src={logoImg} alt="X" className="h-8 w-auto object-contain" draggable="false" />
          </div>
        </div>

        <nav className="relative flex-1 py-5 px-3 space-y-1">
          {NAV.map((n, i) => {
            const active = location.pathname === n.path || (n.path !== '/admin' && location.pathname.startsWith(n.path))
            return (
              <motion.button
                key={n.path}
                onClick={() => navigate(n.path)}
                whileTap={{ scale: 0.97 }}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + i * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${
                  active ? 'text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="adminNavActive"
                    className="absolute inset-0 rounded-xl bg-[#b3001e]/15 border border-[#b3001e]/30"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                )}
                <n.icon size={16} className="relative text-[#b3001e]" />
                <span className="relative">{n.label}</span>
              </motion.button>
            )
          })}
        </nav>

        <div className="relative p-3 border-t border-white/10 space-y-2">
          {/* Theme toggle — moved here from the top header 2026-05-18. Sits
              directly above ES/EN so all sidebar controls live together. */}
          <motion.button
            onClick={theme.toggle}
            whileTap={{ scale: 0.96 }}
            title={theme.preference === 'system' ? (lang === 'es' ? 'Sistema' : 'System') : theme.preference === 'dark' ? (lang === 'es' ? 'Modo dia' : 'Day mode') : (lang === 'es' ? 'Modo noche' : 'Night mode')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12px] text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            {theme.preference === 'system' ? <Monitor size={14} /> : theme.preference === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span>{theme.preference === 'system' ? (lang === 'es' ? 'Sistema' : 'System') : theme.preference === 'dark' ? (lang === 'es' ? 'Modo dia' : 'Day mode') : (lang === 'es' ? 'Modo noche' : 'Night mode')}</span>
          </motion.button>

          <div className="flex items-center justify-center gap-0.5 bg-white/5 rounded-full p-0.5 relative">
            {['es', 'en'].map(l => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`relative flex-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold uppercase text-center transition-colors ${
                  lang === l ? 'text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {lang === l && (
                  <motion.span
                    layoutId="langPill"
                    className="absolute inset-0 rounded-full bg-[#b3001e]"
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                  />
                )}
                <span className="relative">{l === 'es' ? 'ES' : 'EN'}</span>
              </button>
            ))}
          </div>

          <motion.button
            onClick={logout}
            whileTap={{ scale: 0.96 }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[12px] transition-colors text-white/50 hover:text-[#b3001e] hover:bg-[#b3001e]/10"
          >
            <LogOut size={14} /> {lang === 'es' ? 'Cerrar sesion' : 'Log out'}
          </motion.button>
        </div>
      </div>

      {/* Mobile Top Bar — always black */}
      <div className="md:hidden bg-black border-b border-white/10 sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-0">
            <span className="text-[15px] font-black tracking-[3px] text-white leading-none -mt-1">TERMINAL</span>
            <img src={logoImg} alt="X" className="h-6 w-auto object-contain" draggable="false" />
          </div>
          <div className="flex items-center gap-1">
            <motion.button whileTap={{ scale: 0.9 }} onClick={theme.toggle} className="p-2 text-[#b3001e] hover:text-white">
              {theme.preference === 'system' ? <Monitor size={16} /> : theme.preference === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={logout} className="p-2 text-white/50 hover:text-[#b3001e]">
              <LogOut size={16} />
            </motion.button>
          </div>
        </div>
        <div className="flex px-2 pb-2 gap-1">
          {NAV.map(n => {
            const active = location.pathname === n.path || (n.path !== '/admin' && location.pathname.startsWith(n.path))
            return (
              <motion.button
                key={n.path}
                onClick={() => navigate(n.path)}
                whileTap={{ scale: 0.94 }}
                className={`relative flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-medium transition-colors ${
                  active ? 'text-white' : 'text-white/50 hover:text-white'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="adminNavActiveMobile"
                    className="absolute inset-0 rounded-xl bg-[#b3001e]/15 border border-[#b3001e]/30"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                )}
                <n.icon size={15} className="relative text-[#b3001e]" />
                <span className="relative">{n.label}</span>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${theme.isDark ? 'bg-black' : 'bg-white'}`}>
        <AdminErrorBoundary>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <Routes location={location}>
                <Route path="/" element={<Dashboard getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/crm" element={<CRM getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/crm/:id" element={<CRMLead getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/clients" element={<Clients getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/demos" element={<Clients getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} demoMode />} />
                <Route path="/clients/:id" element={<ClientDetail getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/certifications" element={<Certifications getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/certifications/:id" element={<CertificationDetail getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/licenses" element={<Licenses getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/license-rebinds" element={<LicenseRebinds getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/support" element={<Support getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="/team" element={<Team getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </AdminErrorBoundary>
      </div>
    </div>
  )
}
