import { useState, useRef } from 'react'
import {
  Building2, User, KeyRound, CheckCircle2,
  ChevronRight, ChevronLeft, Upload, Loader2,
  AlertTriangle, Globe, X, Eye, EyeOff,
} from 'lucide-react'
import { isValidKeyFormat } from '../services/license'
import { useLicense } from '../context/LicenseContext'

// ── Bilingual copy ─────────────────────────────────────────────────────────────
const COPY = {
  es: {
    // Step labels
    step1: 'Negocio',
    step2: 'Administrador',
    step3: 'Licencia',
    step4: 'Listo',

    // Welcome
    welcome_title:   '¡Bienvenido a Terminal X!',
    welcome_sub:     'Vamos a configurar tu sistema en unos minutos.',
    welcome_p1:      'Necesitaremos información básica de tu negocio, crear tu usuario administrador y activar tu licencia.',
    welcome_btn:     'Comenzar',

    // Step 1 — Empresa
    s1_title:        'Tu Negocio',
    s1_sub:          'Esta información aparecerá en los recibos y reportes.',
    s1_nombre:       'Nombre del negocio',
    s1_nombre_ph:    'Ej: Car Wash Express',
    s1_rnc:          'RNC / Cédula',
    s1_rnc_ph:       'Ej: 130123456  (opcional)',
    s1_dir:          'Dirección',
    s1_dir_ph:       'Av. Winston Churchill 1099  (opcional)',
    s1_tel:          'Teléfono',
    s1_tel_ph:       '809-555-0123  (opcional)',
    s1_email:        'Email',
    s1_email_ph:     'info@carwash.do  (opcional)',
    s1_logo:         'Logo del negocio',
    s1_logo_btn:     'Subir imagen',
    s1_logo_hint:    'PNG o JPG — máx. 2 MB',
    s1_logo_change:  'Cambiar',
    s1_logo_remove:  'Quitar',
    s1_err_nombre:   'El nombre del negocio es requerido.',

    // Step 2 — Usuario
    s2_title:        'Usuario Administrador',
    s2_sub:          'Este usuario tendrá acceso total al sistema.',
    s2_nombre:       'Nombre completo',
    s2_nombre_ph:    'Ej: Carlos Martínez',
    s2_username:     'Nombre de usuario',
    s2_username_ph:  'admin',
    s2_pin:          'PIN (4–6 dígitos)',
    s2_pin_ph:       '• • • •',
    s2_confirm:      'Confirmar PIN',
    s2_confirm_ph:   '• • • •',
    s2_show:         'Mostrar',
    s2_hide:         'Ocultar',
    s2_err_nombre:   'El nombre es requerido.',
    s2_err_digits:   'El PIN solo puede contener números.',
    s2_err_short:    'El PIN debe tener al menos 4 dígitos.',
    s2_err_mismatch: 'Los PINes no coinciden.',
    s2_saving:       'Guardando…',

    // Step 3 — Licencia
    s3_title:        'Clave de Licencia',
    s3_sub:          'Ingresa la clave que recibiste al adquirir Terminal X.',
    s3_key:          'Clave de licencia',
    s3_key_ph:       'TXL-XXXX-XXXX-XXXX',
    s3_rnc:          'RNC / Cédula del negocio',
    s3_rnc_ph:       'Ej: 130123456',
    s3_activate:     'Activar licencia',
    s3_activating:   'Verificando…',
    s3_success:      'Licencia activada correctamente.',
    s3_skip:         'Activar más tarde',
    s3_skip_note:    'Podrás activarlo desde Administración → Sistema.',
    s3_err_format:   'Formato inválido. Ejemplo: TXL-A1B2-C3D4-E5F6',
    s3_err_rnc:      'Ingresa el RNC o cédula.',
    s3_hwid:         'ID de equipo',

    // Step 4 — Done
    s4_title:        '¡Terminal X está listo!',
    s4_sub:          'Tu sistema ha sido configurado exitosamente.',
    s4_go:           'Ir al inicio de sesión',

    // Shared
    next:            'Continuar',
    back:            'Atrás',
  },

  en: {
    step1: 'Business',
    step2: 'Admin',
    step3: 'License',
    step4: 'Done',

    welcome_title:   'Welcome to Terminal X!',
    welcome_sub:     "Let's set up your system in just a few minutes.",
    welcome_p1:      "We'll collect basic business info, create your admin user, and activate your license.",
    welcome_btn:     'Get Started',

    s1_title:        'Your Business',
    s1_sub:          'This information will appear on receipts and reports.',
    s1_nombre:       'Business name',
    s1_nombre_ph:    'e.g. Car Wash Express',
    s1_rnc:          'Tax ID / RNC',
    s1_rnc_ph:       'e.g. 130123456  (optional)',
    s1_dir:          'Address',
    s1_dir_ph:       'e.g. 1099 Winston Churchill Ave.  (optional)',
    s1_tel:          'Phone',
    s1_tel_ph:       '809-555-0123  (optional)',
    s1_email:        'Email',
    s1_email_ph:     'info@carwash.do  (optional)',
    s1_logo:         'Business logo',
    s1_logo_btn:     'Upload image',
    s1_logo_hint:    'PNG or JPG — max 2 MB',
    s1_logo_change:  'Change',
    s1_logo_remove:  'Remove',
    s1_err_nombre:   'Business name is required.',

    s2_title:        'Admin User',
    s2_sub:          'This user will have full access to the system.',
    s2_nombre:       'Full name',
    s2_nombre_ph:    'e.g. Carlos Martínez',
    s2_username:     'Username',
    s2_username_ph:  'admin',
    s2_pin:          'PIN (4–6 digits)',
    s2_pin_ph:       '• • • •',
    s2_confirm:      'Confirm PIN',
    s2_confirm_ph:   '• • • •',
    s2_show:         'Show',
    s2_hide:         'Hide',
    s2_err_nombre:   'Name is required.',
    s2_err_digits:   'PIN must contain only digits.',
    s2_err_short:    'PIN must be at least 4 digits.',
    s2_err_mismatch: 'PINs do not match.',
    s2_saving:       'Saving…',

    s3_title:        'License Key',
    s3_sub:          'Enter the key you received when purchasing Terminal X.',
    s3_key:          'License key',
    s3_key_ph:       'TXL-XXXX-XXXX-XXXX',
    s3_rnc:          'Tax ID / RNC',
    s3_rnc_ph:       'e.g. 130123456',
    s3_activate:     'Activate license',
    s3_activating:   'Verifying…',
    s3_success:      'License activated successfully.',
    s3_skip:         'Activate later',
    s3_skip_note:    'You can activate it from Administration → System.',
    s3_err_format:   'Invalid format. Example: TXL-A1B2-C3D4-E5F6',
    s3_err_rnc:      'Enter the business Tax ID / RNC.',
    s3_hwid:         'Machine ID',

    s4_title:        'Terminal X is Ready!',
    s4_sub:          'Your system has been successfully configured.',
    s4_go:           'Go to login',

    next:            'Continue',
    back:            'Back',
  },
}

// ── Shared field IDs for a11y ──────────────────────────────────────────────────
const ipc = () => window?.electronAPI

// ── Input component ───────────────────────────────────────────────────────────
function Field({ label, id, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 text-[11px] text-red-400 flex items-center gap-1">
          <AlertTriangle size={10} />
          {error}
        </p>
      )}
    </div>
  )
}

function TextInput({ id, value, onChange, placeholder, type = 'text', autoFocus, inputMode, maxLength, disabled }) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      inputMode={inputMode}
      maxLength={maxLength}
      disabled={disabled}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-[14px] placeholder-zinc-600
                 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30
                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    />
  )
}

// ── Step progress (left panel) ────────────────────────────────────────────────
const STEP_META = [
  { n: 1, icon: Building2 },
  { n: 2, icon: User },
  { n: 3, icon: KeyRound },
  { n: 4, icon: CheckCircle2 },
]

function StepProgress({ step, lang }) {
  const t = k => COPY[lang][k] || k
  const labels = [t('step1'), t('step2'), t('step3'), t('step4')]

  return (
    <div className="flex flex-col items-start gap-0 w-full">
      {STEP_META.map(({ n, icon: Icon }, idx) => {
        const done    = step > n
        const active  = step === n
        const future  = step < n

        return (
          <div key={n} className="flex flex-col items-start w-full">
            <div className="flex items-center gap-3">
              {/* Circle */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all
                ${done   ? 'bg-red-600'   : ''}
                ${active ? 'bg-red-600 ring-4 ring-red-600/20' : ''}
                ${future ? 'bg-zinc-800 border border-zinc-700' : ''}
              `}>
                {done
                  ? <CheckCircle2 size={14} className="text-white" />
                  : <Icon size={13} className={active ? 'text-white' : 'text-zinc-600'} />
                }
              </div>
              {/* Label */}
              <span className={`text-[13px] font-semibold transition-colors
                ${done || active ? 'text-white' : 'text-zinc-600'}
              `}>
                {labels[idx]}
              </span>
            </div>

            {/* Connector line — not after last item */}
            {idx < STEP_META.length - 1 && (
              <div className={`ml-4 w-px h-6 my-0.5 transition-colors ${step > n ? 'bg-red-600/40' : 'bg-zinc-800'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Left panel ────────────────────────────────────────────────────────────────
function LeftPanel({ step, lang, setLang }) {
  return (
    <div className="hidden md:flex flex-col w-64 shrink-0 bg-black border-r border-zinc-800 py-10 px-7">
      {/* Logo */}
      <div className="flex flex-col items-center mb-12">
        <div className="w-16 h-16 bg-white rounded-[14px] flex items-center justify-center mb-4 shadow-lg">
          <img src="/assets/logo.png" alt="Terminal X" className="w-11 h-11 object-contain" draggable={false} />
        </div>
        <p className="text-white font-[500] tracking-[3px] text-[18px]">TERMINAL X</p>
        <p className="text-zinc-500 text-[11px] mt-1 tracking-wider">CONFIGURACIÓN INICIAL</p>
      </div>

      {/* Step progress — only shown during steps 1-4 */}
      {step >= 1 && step <= 4 && (
        <div className="flex-1">
          <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-5">Pasos</p>
          <StepProgress step={step} lang={lang} />
        </div>
      )}
      {step === 0 && <div className="flex-1" />}

      {/* Language toggle */}
      <button
        onClick={() => setLang(l => l === 'es' ? 'en' : 'es')}
        className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-[12px] font-medium transition-colors self-start mt-8"
      >
        <Globe size={13} />
        {lang === 'es' ? 'English' : 'Español'}
      </button>
    </div>
  )
}

// ── Step 0 — Welcome ──────────────────────────────────────────────────────────
function StepWelcome({ t, onNext }) {
  return (
    <div className="w-full max-w-md text-center">
      {/* Mobile logo */}
      <div className="md:hidden flex flex-col items-center mb-10">
        <div className="w-16 h-16 bg-white rounded-[14px] flex items-center justify-center mb-3 shadow-lg">
          <img src="/assets/logo.png" alt="Terminal X" className="w-11 h-11 object-contain" draggable={false} />
        </div>
        <p className="text-white font-[500] tracking-[3px] text-[18px]">TERMINAL X</p>
      </div>

      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-600/10 border border-red-600/20 mb-8">
        <CheckCircle2 size={36} className="text-red-500" />
      </div>

      <h1 className="text-white text-[28px] font-bold mb-3">{t('welcome_title')}</h1>
      <p className="text-zinc-400 text-[15px] mb-3">{t('welcome_sub')}</p>
      <p className="text-zinc-500 text-[13px] mb-12 max-w-sm mx-auto leading-relaxed">{t('welcome_p1')}</p>

      {/* Steps preview */}
      <div className="flex items-center justify-center gap-6 mb-12">
        {[
          { Icon: Building2, label: t('step1') },
          { Icon: User,      label: t('step2') },
          { Icon: KeyRound,  label: t('step3') },
        ].map(({ Icon, label }, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <Icon size={16} className="text-zinc-400" />
            </div>
            <span className="text-zinc-500 text-[11px]">{label}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="w-full max-w-xs mx-auto py-4 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold rounded-xl text-[15px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
      >
        {t('welcome_btn')}
        <ChevronRight size={18} />
      </button>
    </div>
  )
}

// ── Step 1 — Empresa ──────────────────────────────────────────────────────────
function StepEmpresa({ t, onNext, onBack }) {
  const [nombre,   setNombre]   = useState('')
  const [rnc,      setRnc]      = useState('')
  const [dir,      setDir]      = useState('')
  const [tel,      setTel]      = useState('')
  const [email,    setEmail]    = useState('')
  const [logo,     setLogo]     = useState(null)   // base64 data URL
  const [logoErr,  setLogoErr]  = useState('')
  const [err,      setErr]      = useState('')
  const [saving,   setSaving]   = useState(false)
  const fileRef = useRef(null)

  function handleLogoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setLogoErr('Imagen muy grande (máx. 2 MB)'); return }
    setLogoErr('')
    const reader = new FileReader()
    reader.onload = ev => setLogo(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function handleNext() {
    if (!nombre.trim()) { setErr(t('s1_err_nombre')); return }
    setErr('')
    setSaving(true)
    try {
      await ipc()?.admin?.saveEmpresa?.({
        name:    nombre.trim(),
        rnc:     rnc.trim(),
        address: dir.trim(),
        phone:   tel.trim(),
        email:   email.trim(),
        logo:    logo || undefined,
      })
      onNext({ rnc: rnc.trim(), nombre: nombre.trim() })
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <div className="mb-7">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center mb-4">
            <Building2 size={18} className="text-red-500" />
          </div>
          <h2 className="text-white text-[22px] font-bold">{t('s1_title')}</h2>
          <p className="text-zinc-500 text-[13px] mt-1">{t('s1_sub')}</p>
        </div>

        <div className="space-y-5">
          {/* Logo upload */}
          <div>
            <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
              {t('s1_logo')}
            </label>
            {logo ? (
              <div className="flex items-center gap-4">
                <img src={logo} alt="logo" className="w-16 h-16 rounded-xl object-contain bg-zinc-800 border border-zinc-700 p-1" />
                <div className="flex flex-col gap-2">
                  <button onClick={() => fileRef.current?.click()}
                    className="text-[12px] text-zinc-400 hover:text-white transition-colors underline underline-offset-2">
                    {t('s1_logo_change')}
                  </button>
                  <button onClick={() => { setLogo(null); if (fileRef.current) fileRef.current.value = '' }}
                    className="text-[12px] text-red-500 hover:text-red-400 transition-colors underline underline-offset-2 flex items-center gap-1">
                    <X size={10} /> {t('s1_logo_remove')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full py-5 border-2 border-dashed border-zinc-700 hover:border-zinc-500 rounded-xl flex flex-col items-center justify-center gap-2 transition-colors group"
              >
                <Upload size={20} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                <span className="text-[13px] text-zinc-500 group-hover:text-zinc-400">{t('s1_logo_btn')}</span>
                <span className="text-[11px] text-zinc-600">{t('s1_logo_hint')}</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
              className="hidden" onChange={handleLogoChange} />
            {logoErr && <p className="mt-1.5 text-[11px] text-red-400">{logoErr}</p>}
          </div>

          <Field label={t('s1_nombre')} id="emp-nombre" error={err && !nombre.trim() ? err : ''}>
            <TextInput id="emp-nombre" value={nombre} onChange={v => { setNombre(v); setErr('') }}
              placeholder={t('s1_nombre_ph')} autoFocus />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t('s1_rnc')} id="emp-rnc">
              <TextInput id="emp-rnc" value={rnc} onChange={setRnc}
                placeholder={t('s1_rnc_ph')} inputMode="numeric" />
            </Field>
            <Field label={t('s1_tel')} id="emp-tel">
              <TextInput id="emp-tel" value={tel} onChange={setTel}
                placeholder={t('s1_tel_ph')} inputMode="tel" />
            </Field>
          </div>

          <Field label={t('s1_dir')} id="emp-dir">
            <TextInput id="emp-dir" value={dir} onChange={setDir} placeholder={t('s1_dir_ph')} />
          </Field>

          <Field label={t('s1_email')} id="emp-email">
            <TextInput id="emp-email" value={email} onChange={setEmail}
              placeholder={t('s1_email_ph')} type="email" />
          </Field>

          {err && nombre.trim() && (
            <p className="text-[12px] text-red-400 flex items-center gap-1">
              <AlertTriangle size={11} /> {err}
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-8">
          <button onClick={onBack}
            className="flex items-center gap-1.5 px-5 py-3 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 rounded-xl text-[13px] font-medium transition-colors">
            <ChevronLeft size={14} /> {t('back')}
          </button>
          <button onClick={handleNext} disabled={saving}
            className="flex-1 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[14px] transition-all active:scale-[0.98] flex items-center justify-center gap-2">
            {saving ? <><Loader2 size={15} className="animate-spin" /> {t('next')}</> : <>{t('next')} <ChevronRight size={15} /></>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Step 2 — Admin User ───────────────────────────────────────────────────────
function StepUsuario({ t, onNext, onBack }) {
  const [nombre,   setNombre]   = useState('')
  const [username, setUsername] = useState('')
  const [pin,      setPin]      = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPin,  setShowPin]  = useState(false)
  const [err,      setErr]      = useState('')
  const [saving,   setSaving]   = useState(false)

  // Auto-generate username from nombre
  function handleNombreChange(v) {
    setNombre(v)
    if (!username) {
      const slug = v.trim().toLowerCase().split(' ')[0].replace(/[^a-z0-9]/g, '')
      setUsername(slug || '')
    }
    setErr('')
  }

  function validatePin(p) {
    if (!/^\d+$/.test(p) && p.length > 0) return t('s2_err_digits')
    return ''
  }

  async function handleNext() {
    if (!nombre.trim()) { setErr(t('s2_err_nombre')); return }
    if (!/^\d+$/.test(pin))  { setErr(t('s2_err_digits')); return }
    if (pin.length < 4)       { setErr(t('s2_err_short'));  return }
    if (pin !== confirm)      { setErr(t('s2_err_mismatch')); return }
    setErr('')
    setSaving(true)
    try {
      await ipc()?.admin?.saveUsuario?.({
        name:     nombre.trim(),
        username: (username.trim() || nombre.trim().toLowerCase().replace(/\s+/g, '.')).slice(0, 30),
        pin,
        role:     'owner',
        discount_pct: 0,
      })
      onNext()
    } catch (e) {
      setErr(e?.message || 'Error al guardar usuario.')
    } finally {
      setSaving(false)
    }
  }

  // PIN dots display
  const pinLen = pin.length
  const dots   = Array.from({ length: 6 }).map((_, i) => (
    <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all duration-100 ${
      i < pinLen ? 'bg-red-500 scale-110' : 'bg-zinc-700 border border-zinc-600'
    }`} />
  ))

  return (
    <div className="w-full max-w-md">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <div className="mb-7">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center mb-4">
            <User size={18} className="text-red-500" />
          </div>
          <h2 className="text-white text-[22px] font-bold">{t('s2_title')}</h2>
          <p className="text-zinc-500 text-[13px] mt-1">{t('s2_sub')}</p>
        </div>

        <div className="space-y-5">
          <Field label={t('s2_nombre')} id="usr-nombre">
            <TextInput id="usr-nombre" value={nombre} onChange={handleNombreChange}
              placeholder={t('s2_nombre_ph')} autoFocus />
          </Field>

          <Field label={t('s2_username')} id="usr-username">
            <TextInput id="usr-username" value={username} onChange={v => setUsername(v.replace(/\s/g, '').toLowerCase())}
              placeholder={t('s2_username_ph')} />
          </Field>

          {/* PIN field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                {t('s2_pin')}
              </label>
              <button type="button" onClick={() => setShowPin(s => !s)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors">
                {showPin ? <EyeOff size={11} /> : <Eye size={11} />}
                {showPin ? t('s2_hide') : t('s2_show')}
              </button>
            </div>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                inputMode="numeric"
                maxLength={6}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '')
                  setPin(v)
                  setErr('')
                }}
                placeholder="••••"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-[14px] font-mono tracking-widest
                           placeholder-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30 transition-colors text-center"
              />
            </div>
            {/* Dots */}
            <div className="flex items-center gap-1.5 mt-2 justify-center">{dots}</div>
          </div>

          {/* Confirm PIN */}
          <Field label={t('s2_confirm')} id="usr-confirm" error={err.includes('coin') || err.includes('match') ? err : ''}>
            <input
              id="usr-confirm"
              type={showPin ? 'text' : 'password'}
              value={confirm}
              inputMode="numeric"
              maxLength={6}
              onChange={e => {
                setConfirm(e.target.value.replace(/\D/g, ''))
                setErr('')
              }}
              placeholder="••••"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-[14px] font-mono tracking-widest
                         placeholder-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30 transition-colors text-center"
            />
          </Field>

          {err && !err.includes('coin') && !err.includes('match') && (
            <p className="text-[12px] text-red-400 flex items-center gap-1">
              <AlertTriangle size={11} /> {err}
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-8">
          <button onClick={onBack}
            className="flex items-center gap-1.5 px-5 py-3 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 rounded-xl text-[13px] font-medium transition-colors">
            <ChevronLeft size={14} /> {t('back')}
          </button>
          <button onClick={handleNext} disabled={saving}
            className="flex-1 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[14px] transition-all active:scale-[0.98] flex items-center justify-center gap-2">
            {saving
              ? <><Loader2 size={15} className="animate-spin" /> {t('s2_saving')}</>
              : <>{t('next')} <ChevronRight size={15} /></>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Step 3 — License ──────────────────────────────────────────────────────────
function StepLicencia({ t, onNext, onBack, prefillRnc, hwid }) {
  const { activate } = useLicense()

  const [key,        setKey]        = useState('')
  const [rnc,        setRnc]        = useState(prefillRnc || '')
  const [activating, setActivating] = useState(false)
  const [activated,  setActivated]  = useState(false)
  const [err,        setErr]        = useState('')
  const [skipWarn,   setSkipWarn]   = useState(false)

  async function handleActivate() {
    const k = key.trim().toUpperCase()
    const r = rnc.trim().replace(/\D/g, '')
    const isMaster = await window.electronAPI?.license?.isMaster?.(k)
    if (!isMaster && !isValidKeyFormat(k)) { setErr(t('s3_err_format')); return }
    if (!r) { setErr(t('s3_err_rnc')); return }
    setErr('')
    setActivating(true)
    try {
      await activate(k, r)
      setActivated(true)
      setErr('')
    } catch (e) {
      setErr(e?.message || 'Error al verificar la licencia.')
    } finally {
      setActivating(false)
    }
  }

  function handleSkip() {
    setSkipWarn(true)
    setTimeout(() => onNext(), 2200)
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <div className="mb-7">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center mb-4">
            <KeyRound size={18} className="text-red-500" />
          </div>
          <h2 className="text-white text-[22px] font-bold">{t('s3_title')}</h2>
          <p className="text-zinc-500 text-[13px] mt-1">{t('s3_sub')}</p>
        </div>

        {activated ? (
          <div className="flex flex-col items-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-green-400" />
            </div>
            <p className="text-green-400 font-semibold text-[15px]">{t('s3_success')}</p>
            <button onClick={onNext}
              className="mt-4 w-full py-3.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-[14px] transition-all active:scale-[0.98] flex items-center justify-center gap-2">
              {t('next')} <ChevronRight size={15} />
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label={t('s3_key')} id="lic-key" error={err.includes('format') || err.includes('nválid') || err.includes('nvalid') ? err : ''}>
              <input
                id="lic-key"
                type="text"
                value={key}
                onChange={e => {
                  let v = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
                  // Auto-insert dashes at TXL- positions
                  setKey(v)
                  setErr('')
                }}
                onKeyDown={e => e.key === 'Enter' && handleActivate()}
                placeholder={t('s3_key_ph')}
                autoFocus
                maxLength={19}
                spellCheck={false}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-[14px] font-mono tracking-widest
                           placeholder-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30 transition-colors text-center uppercase"
              />
            </Field>

            <Field label={t('s3_rnc')} id="lic-rnc" error={err.includes('RNC') || err.includes('Tax') || err.includes('edula') ? err : ''}>
              <TextInput id="lic-rnc" value={rnc}
                onChange={v => { setRnc(v); setErr('') }}
                placeholder={t('s3_rnc_ph')} inputMode="numeric" />
            </Field>

            {err && !err.includes('format') && !err.includes('nválid') && !err.includes('nvalid') &&
              !err.includes('RNC') && !err.includes('Tax') && !err.includes('edula') && (
              <p className="text-[12px] text-red-400 flex items-center gap-1">
                <AlertTriangle size={11} /> {err}
              </p>
            )}

            <button onClick={handleActivate} disabled={activating || !key.trim()}
              className="w-full py-3.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[14px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-md shadow-red-600/20">
              {activating
                ? <><Loader2 size={15} className="animate-spin" /> {t('s3_activating')}</>
                : <><KeyRound size={15} /> {t('s3_activate')}</>
              }
            </button>

            {/* HWID for support */}
            {hwid && (
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-3 mt-2">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{t('s3_hwid')}</p>
                <code className="text-[11px] text-zinc-400 font-mono break-all">{hwid}</code>
              </div>
            )}

            {/* Skip */}
            {skipWarn ? (
              <p className="text-center text-[12px] text-amber-400 flex items-center justify-center gap-1.5">
                <AlertTriangle size={12} /> {t('s3_skip_note')}
              </p>
            ) : (
              <button onClick={handleSkip}
                className="w-full text-center text-zinc-600 hover:text-zinc-400 text-[12px] transition-colors pt-1">
                {t('s3_skip')}
              </button>
            )}
          </div>
        )}
      </div>

      {!activated && (
        <div className="mt-3">
          <button onClick={onBack}
            className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 text-[13px] transition-colors">
            <ChevronLeft size={14} /> {t('back')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Step 4 — Done ─────────────────────────────────────────────────────────────
function StepDone({ t, empresaNombre, onComplete }) {
  return (
    <div className="w-full max-w-md text-center">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10">
        {/* Animated success ring */}
        <div className="w-24 h-24 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center mx-auto mb-7 animate-pulse">
          <CheckCircle2 size={44} className="text-green-400" />
        </div>

        <h2 className="text-white text-[26px] font-bold mb-3">{t('s4_title')}</h2>
        <p className="text-zinc-400 text-[14px] mb-2">{t('s4_sub')}</p>
        {empresaNombre && (
          <p className="text-zinc-600 text-[13px] mb-8">
            <span className="text-zinc-400 font-semibold">{empresaNombre}</span>
          </p>
        )}

        <button
          onClick={onComplete}
          className="w-full py-4 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold rounded-xl text-[15px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
        >
          {t('s4_go')}
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

// ── Root wizard ───────────────────────────────────────────────────────────────
export default function FirstTimeSetup({ onComplete }) {
  const { hwid } = useLicense()

  const [lang,         setLang]         = useState('es')
  const [step,         setStep]         = useState(0)
  const [empresaRnc,   setEmpresaRnc]   = useState('')
  const [empresaNombre,setEmpresaNombre]= useState('')

  const t = k => COPY[lang][k] || k

  async function markSetupComplete() {
    try {
      await ipc()?.admin?.saveConfiguracion?.({ setup_complete: '1' })
    } catch {}
    onComplete()
  }

  return (
    <div className="fixed inset-0 bg-black flex overflow-hidden">
      {/* Language toggle (mobile — top right) */}
      <button
        onClick={() => setLang(l => l === 'es' ? 'en' : 'es')}
        className="md:hidden absolute top-4 right-4 z-10 flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-[12px] font-medium transition-colors"
      >
        <Globe size={13} />
        {lang === 'es' ? 'EN' : 'ES'}
      </button>

      {/* Left panel */}
      <LeftPanel step={step} lang={lang} setLang={setLang} />

      {/* Right content */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center p-6 md:p-12">
        {step === 0 && (
          <StepWelcome t={t} onNext={() => setStep(1)} />
        )}

        {step === 1 && (
          <StepEmpresa
            t={t}
            onBack={() => setStep(0)}
            onNext={({ rnc, nombre }) => {
              setEmpresaRnc(rnc)
              setEmpresaNombre(nombre)
              setStep(2)
            }}
          />
        )}

        {step === 2 && (
          <StepUsuario
            t={t}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <StepLicencia
            t={t}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
            prefillRnc={empresaRnc}
            hwid={hwid}
          />
        )}

        {step === 4 && (
          <StepDone
            t={t}
            empresaNombre={empresaNombre}
            onComplete={markSetupComplete}
          />
        )}
      </div>
    </div>
  )
}
