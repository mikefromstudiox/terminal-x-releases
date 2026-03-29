import { useState, useEffect, useCallback, Component } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, KeyRound, Building2, Users, LogOut, Loader2, Sun, Moon, Monitor } from 'lucide-react'

class AdminErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-center">
          <p className="text-red-500 font-bold mb-2">Error in admin panel</p>
          <pre className="text-xs text-left bg-red-50 p-4 rounded-lg overflow-auto max-h-40 text-red-700">{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
          <button onClick={() => { this.setState({ error: null }); window.location.hash = '/admin' }}
            className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm">Volver al Dashboard</button>
        </div>
      )
    }
    return this.props.children
  }
}
import logoImg from '../assets/logo.png'
import xMark from '../assets/x-mark.png'
import { useLang } from '../i18n'
import Dashboard from './pages/Dashboard'
import Licenses from './pages/Licenses'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Team from './pages/Team'

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
      const { error: err } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPw })
      if (err) throw err
      await checkAdmin(true)
    } catch (err) {
      setError(err.message || 'Error al iniciar sesion')
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-500" size={24} />
      </div>
    )
  }

  // ── Login screen ──
  if (!admin) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-black rounded-2xl p-8 w-full max-w-sm space-y-5 shadow-2xl">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <span className="text-3xl font-black text-white tracking-[3px]">TERMINAL</span>
              <img src={xMark} alt="X" className="h-28 w-28 object-contain mt-1" />
            </div>
            <div className="inline-block mt-2 px-3 py-1 bg-[#b3001e]/20 text-white text-xs font-bold rounded-full">
              Admin Panel
            </div>
          </div>
          {error && <div className="bg-red-500/20 text-red-300 text-sm p-3 rounded-lg">{error}</div>}
          <div>
            <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Email</label>
            <input type="email" placeholder="tu@email.com" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
          </div>
          <div>
            <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Contrasena</label>
            <input type="password" placeholder="Tu contrasena" value={loginPw} onChange={e => setLoginPw(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
          </div>
          <button type="submit" disabled={submitting}
            className="w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-50 transition-colors">
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
          <a href="/" className="block text-center text-[11px] text-slate-500 hover:text-[#b3001e] transition-colors">Volver al sitio</a>
        </form>
      </div>
    )
  }

  // ── Main panel ──
  const L = (es, en) => lang === 'es' ? es : en
  const NAV = [
    { path: '/admin',          icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/admin/clients',  icon: Building2,       label: L('Clientes', 'Clients') },
    { path: '/admin/licenses', icon: KeyRound,        label: L('Licencias', 'Licenses') },
    { path: '/admin/team',     icon: Users,           label: L('Equipo', 'Team') },
  ]

  return (
    <div className={`min-h-screen flex flex-col md:flex-row ${theme.isDark ? 'bg-black' : 'bg-gray-50'}`}>
      {/* Desktop Sidebar — always black */}
      <div className="hidden md:flex w-[260px] flex-col shrink-0 border-r bg-black border-white/10">
        <div className="flex items-center justify-center px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-1">
            <span className="text-2xl font-black tracking-[3px] text-white">TERMINAL</span>
            <img src={xMark} alt="X" className="h-20 w-20 object-contain mt-1" />
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {NAV.map(n => {
            const active = location.pathname === n.path || (n.path !== '/admin' && location.pathname.startsWith(n.path))
            return (
              <button key={n.path} onClick={() => navigate(n.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  active ? 'bg-[#b3001e]/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}>
                <n.icon size={16} className="text-[#b3001e]" />
                {n.label}
              </button>
            )
          })}
        </nav>
        <div className="p-3 border-t border-white/10 space-y-2">
          {/* Theme toggle */}
          <button onClick={theme.toggle}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors text-[#b3001e] hover:text-[#ff1a3a] hover:bg-white/5"
            title={theme.preference === 'system' ? (lang === 'es' ? 'Sistema' : 'System') : theme.preference === 'dark' ? (lang === 'es' ? 'Modo dia' : 'Day mode') : (lang === 'es' ? 'Modo noche' : 'Night mode')}>
            {theme.preference === 'system' ? <Monitor size={14} /> : theme.preference === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {theme.preference === 'system' ? (lang === 'es' ? 'Sistema' : 'System') : theme.preference === 'dark' ? (lang === 'es' ? 'Modo dia' : 'Day') : (lang === 'es' ? 'Modo noche' : 'Night')}
          </button>
          <div className="flex items-center justify-center gap-0.5 bg-white/5 rounded-full p-0.5">
            {['es', 'en'].map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`flex-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-colors uppercase text-center ${
                  lang === l ? 'bg-[#b3001e] text-white' : 'text-white/40 hover:text-white'
                }`}>
                {l === 'es' ? 'ES' : 'EN'}
              </button>
            ))}
          </div>
          <button onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[12px] transition-colors text-white/50 hover:text-red-400 hover:bg-red-500/10">
            <LogOut size={14} /> {lang === 'es' ? 'Cerrar sesion' : 'Log out'}
          </button>
        </div>
      </div>

      {/* Mobile Top Bar — always black */}
      <div className="md:hidden bg-black border-b border-white/10">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-1">
            <span className="text-[14px] font-black text-white tracking-[2px]">TERMINAL</span>
            <img src={xMark} alt="X" className="h-10 w-10 object-contain" />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={theme.toggle} className="p-2 text-[#b3001e] hover:text-[#ff1a3a]">
              {theme.preference === 'system' ? <Monitor size={16} /> : theme.preference === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={logout} className="p-2 text-white/50 hover:text-red-400">
              <LogOut size={16} />
            </button>
          </div>
        </div>
        <div className="flex px-2 pb-2 gap-1">
          {NAV.map(n => {
            const active = location.pathname === n.path || (n.path !== '/admin' && location.pathname.startsWith(n.path))
            return (
              <button key={n.path} onClick={() => navigate(n.path)}
                className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-medium transition-colors ${
                  active ? 'bg-[#b3001e]/10 text-white' : 'text-white/50 hover:text-white'
                }`}>
                <n.icon size={15} className="text-[#b3001e]" />
                {n.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${theme.isDark ? 'bg-black' : 'bg-gray-50'}`}>
        <AdminErrorBoundary>
        <Routes>
          <Route path="/" element={<Dashboard getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
          <Route path="/clients" element={<Clients getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
          <Route path="/clients/:id" element={<ClientDetail getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
          <Route path="/licenses" element={<Licenses getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
          <Route path="/team" element={<Team getToken={getToken} refreshToken={refreshToken} isDark={theme.isDark} lang={lang} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        </AdminErrorBoundary>
      </div>
    </div>
  )
}
