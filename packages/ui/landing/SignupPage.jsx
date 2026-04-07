import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, ArrowLeft, Check } from 'lucide-react'
import logoImg from '../assets/logo.webp'

function detectLang() {
  const stored = localStorage.getItem('tx_landing_lang')
  if (stored === 'en' || stored === 'es') return stored
  return navigator.language?.startsWith('en') ? 'en' : 'es'
}

const VALID_PLANS = { pro: 'Pro', pro_plus: 'Pro PLUS', pro_max: 'Pro MAX' }

export default function SignupPage({ supabase }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [step, setStep] = useState(1)
  const rawPlan = params.get('plan') || 'pro'
  const [plan] = useState(VALID_PLANS[rawPlan] ? rawPlan : 'pro')
  const [form, setForm] = useState({ business_name: '', rnc: '', phone: '', email: '', password: '' })
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const lang = detectLang()
  const L = (es, en) => lang === 'es' ? es : en

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (step === 1) {
      if (!form.business_name.trim()) { setError(L('Nombre del negocio requerido', 'Business name required')); return }
      setStep(2)
      return
    }

    // Step 2: Create account + provision
    if (!form.email.trim() || !form.password.trim()) { setError(L('Email y contrasena requeridos', 'Email and password required')); return }
    if (form.password.length < 6) { setError(L('La contrasena debe tener al menos 6 caracteres', 'Password must be at least 6 characters')); return }

    setSubmitting(true)
    try {
      if (!supabase) throw new Error(L('Supabase no configurado', 'Supabase not configured'))

      // 1. Sign up with Supabase Auth
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
      })
      if (authErr) throw authErr
      if (!authData?.user) throw new Error(L('No se pudo crear la cuenta', 'Could not create account'))

      // 2. Get session token
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || authData.session?.access_token
      if (!token) throw new Error(L('No se pudo obtener sesion', 'Could not get session'))

      // 3. Provision business via API
      const resp = await fetch('/api/signup/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          business_name: form.business_name.trim(),
          rnc: form.rnc.trim(),
          phone: form.phone.trim(),
          plan,
        }),
      })

      const result = await resp.json()
      if (!resp.ok) throw new Error(result.error || L('Error al crear negocio', 'Error creating business'))

      // Success — redirect to POS
      navigate('/pos')
    } catch (err) {
      setError(err.message || L('Error al registrar', 'Registration error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-black rounded-2xl p-8 w-full max-w-md space-y-5 shadow-2xl">
        <button type="button" onClick={() => step === 1 ? navigate('/') : setStep(1)}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={14} /> {step === 1 ? L('Volver', 'Back') : L('Atras', 'Back')}
        </button>

        <div className="text-center">
          <div className="flex items-center justify-center gap-0">
            <span className="text-4xl font-black tracking-[3px] text-white sm:text-5xl leading-none -mt-1">TERMINAL</span>
            <img src={logoImg} alt="X" className="h-12 w-auto object-contain sm:h-14" draggable="false" />
          </div>
          <p className="text-slate-400 text-sm mt-3">
            {step === 1 ? L('Datos del negocio', 'Business details') : L('Crear cuenta', 'Create account')}
          </p>
          <div className="inline-block mt-2 px-3 py-1 bg-[#b3001e]/20 text-white text-xs font-bold rounded-full">
            {L('7 dias gratis — Plan Pro MAX', '7 days free — Pro MAX Plan')}
          </div>
        </div>

        {error && <div className="bg-red-500/20 text-red-300 text-sm p-3 rounded-lg">{error}</div>}

        {step === 1 && (
          <>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">{L('Nombre del negocio', 'Business name')} *</label>
              <input value={form.business_name} onChange={e => set('business_name', e.target.value)}
                placeholder="Car Wash Express" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">{L('RNC (opcional)', 'RNC (optional)')}</label>
              <input value={form.rnc} onChange={e => set('rnc', e.target.value)}
                placeholder="123-45678-9" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">{L('Telefono (opcional)', 'Phone (optional)')}</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="809-555-0000" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">{L('Email', 'Email')} *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="tu@email.com" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">{L('Contrasena', 'Password')} *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                placeholder={L('Minimo 6 caracteres', 'Minimum 6 characters')} className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
            </div>
          </>
        )}

        <button type="submit" disabled={submitting}
          className="w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
          {submitting ? <><Loader2 size={16} className="animate-spin" /> {L('Creando...', 'Creating...')}</> :
           step === 1 ? L('Siguiente', 'Next') : L('Crear Cuenta y Entrar', 'Create Account & Enter')}
        </button>

        <p className="text-center text-xs text-slate-500">
          {L('Ya tienes cuenta?', 'Already have an account?')} <a href="/pos" className="text-[#b3001e] hover:text-[#cc1a33]">{L('Iniciar sesion', 'Log in')}</a>
        </p>
      </form>
    </div>
  )
}
