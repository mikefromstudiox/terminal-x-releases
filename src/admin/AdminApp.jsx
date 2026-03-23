import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, KeyRound, Building2, Users, LogOut, Loader2 } from 'lucide-react'
import logoImg from '../assets/logo.png'
import Dashboard from './pages/Dashboard'
import Licenses from './pages/Licenses'
import Clients from './pages/Clients'
import Team from './pages/Team'

export default function AdminApp({ supabase }) {
  const [admin, setAdmin] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPw, setLoginPw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-slate-900 border border-slate-800 rounded-2xl p-8 w-full max-w-sm space-y-5">
          <div className="flex flex-col items-center gap-3 mb-2">
            <img src={logoImg} alt="Terminal X" className="h-14 w-auto object-contain" />
            <div>
              <div className="flex items-center justify-center gap-1.5">
                <span className="text-[18px] font-black text-white tracking-[3px]">TERMINAL</span>
                <span className="text-[18px] font-black text-red-500">X</span>
              </div>
              <p className="text-[10px] text-slate-500 uppercase tracking-[4px] text-center mt-1">Admin Panel</p>
            </div>
          </div>
          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] p-3 rounded-xl">{error}</div>}
          <input type="email" placeholder="Email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-[13px] placeholder-slate-500 outline-none focus:border-sky-500 transition-colors" required />
          <input type="password" placeholder="Contrasena" value={loginPw} onChange={e => setLoginPw(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-[13px] placeholder-slate-500 outline-none focus:border-sky-500 transition-colors" required />
          <button type="submit" disabled={submitting}
            className="w-full py-3 bg-[#0C447C] text-white font-bold text-[13px] rounded-xl hover:bg-[#0a3a6a] disabled:opacity-50 transition-colors">
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
          <a href="/" className="block text-center text-[11px] text-slate-500 hover:text-sky-400 transition-colors">Volver al sitio</a>
        </form>
      </div>
    )
  }

  // ── Main panel ──
  const NAV = [
    { path: '/admin',          icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/admin/clients',  icon: Building2,       label: 'Clientes' },
    { path: '/admin/licenses', icon: KeyRound,        label: 'Licencias' },
    { path: '/admin/team',     icon: Users,           label: 'Equipo' },
  ]

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar */}
      <div className="w-[220px] bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-800">
          <img src={logoImg} alt="TX" className="h-8 w-8 object-contain" />
          <div>
            <div className="flex items-center gap-1">
              <span className="text-[13px] font-black text-white tracking-[2px]">TERMINAL</span>
              <span className="text-[13px] font-black text-red-500">X</span>
            </div>
            <p className="text-[8px] text-slate-500 uppercase tracking-[3px] -mt-0.5">Admin</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {NAV.map(n => {
            const active = location.pathname === n.path || (n.path !== '/admin' && location.pathname.startsWith(n.path))
            return (
              <button key={n.path} onClick={() => navigate(n.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  active
                    ? 'bg-[#0C447C] text-white shadow-lg shadow-sky-900/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                <n.icon size={16} />
                {n.label}
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800">
          <button onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[12px] text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <LogOut size={14} /> Cerrar sesion
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard getToken={getToken} refreshToken={refreshToken} />} />
          <Route path="/clients" element={<Clients getToken={getToken} refreshToken={refreshToken} />} />
          <Route path="/licenses" element={<Licenses getToken={getToken} refreshToken={refreshToken} />} />
          <Route path="/team" element={<Team getToken={getToken} refreshToken={refreshToken} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  )
}
