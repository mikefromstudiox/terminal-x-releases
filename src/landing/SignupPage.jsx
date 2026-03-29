import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, ArrowLeft, Check } from 'lucide-react'
import xMark from '../assets/x-mark.png'

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

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (step === 1) {
      if (!form.business_name.trim()) { setError('Nombre del negocio requerido'); return }
      setStep(2)
      return
    }

    // Step 2: Create account + provision
    if (!form.email.trim() || !form.password.trim()) { setError('Email y contrasena requeridos'); return }
    if (form.password.length < 6) { setError('La contrasena debe tener al menos 6 caracteres'); return }

    setSubmitting(true)
    try {
      if (!supabase) throw new Error('Supabase no configurado')

      // 1. Sign up with Supabase Auth
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
      })
      if (authErr) throw authErr
      if (!authData?.user) throw new Error('No se pudo crear la cuenta')

      // 2. Get session token
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || authData.session?.access_token
      if (!token) throw new Error('No se pudo obtener sesion')

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
      if (!resp.ok) throw new Error(result.error || 'Error al crear negocio')

      // Success — redirect to POS
      navigate('/pos')
    } catch (err) {
      setError(err.message || 'Error al registrar')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-black rounded-2xl p-8 w-full max-w-md space-y-5 shadow-2xl">
        <button type="button" onClick={() => step === 1 ? navigate('/') : setStep(1)}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={14} /> {step === 1 ? 'Volver' : 'Atras'}
        </button>

        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <span className="text-3xl font-black text-white tracking-[3px]">TERMINAL</span>
            <img src={xMark} alt="X" className="h-28 w-28 object-contain mt-1" />
          </div>
          <p className="text-slate-400 text-sm mt-3">
            {step === 1 ? 'Datos del negocio' : 'Crear cuenta'}
          </p>
          <div className="inline-block mt-2 px-3 py-1 bg-[#b3001e]/20 text-white text-xs font-bold rounded-full">
            Plan {VALID_PLANS[plan]}
          </div>
        </div>

        {error && <div className="bg-red-500/20 text-red-300 text-sm p-3 rounded-lg">{error}</div>}

        {step === 1 && (
          <>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Nombre del negocio *</label>
              <input value={form.business_name} onChange={e => set('business_name', e.target.value)}
                placeholder="Car Wash Express" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">RNC (opcional)</label>
              <input value={form.rnc} onChange={e => set('rnc', e.target.value)}
                placeholder="123-45678-9" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Telefono (opcional)</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="809-555-0000" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="tu@email.com" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-white uppercase tracking-wider mb-1">Contrasena *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                placeholder="Minimo 6 caracteres" className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#b3001e]" required />
            </div>
          </>
        )}

        <button type="submit" disabled={submitting}
          className="w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
          {submitting ? <><Loader2 size={16} className="animate-spin" /> Creando...</> :
           step === 1 ? 'Siguiente' : 'Crear Cuenta y Entrar'}
        </button>

        <p className="text-center text-xs text-slate-500">
          Ya tienes cuenta? <a href="/pos" className="text-[#b3001e] hover:text-[#cc1a33]">Iniciar sesion</a>
        </p>
      </form>
    </div>
  )
}
