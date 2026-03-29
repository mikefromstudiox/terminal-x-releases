import { useState, useRef, useEffect } from 'react'
import logoImg from '../assets/logo.png'
import {
  Building2, User, KeyRound, CheckCircle2,
  ChevronRight, ChevronLeft, Upload, Loader2,
  AlertTriangle, Globe, X, Eye, EyeOff,
  ReceiptText, Printer, Wifi, ArrowRight, Mail,
} from 'lucide-react'
import { isValidKeyFormat } from '../services/license'
import { useAPI } from '../context/DataContext'
import { useLicense } from '../context/LicenseContext'
import { getSupabaseClient, setStoredSetting, getStoredSetting, ensureBusinessRegistered } from '../services/supabase'

// ── Bilingual copy ─────────────────────────────────────────────────────────────
const COPY = {
  es: {
    // Step labels
    step1: 'Negocio',
    step2: 'Cuenta',
    step3: 'Administrador',
    step4: 'Fiscal',
    step5: 'Activacion',
    step6: 'Listo',

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

    // Step 2 — Cuenta Principal
    s2a_title:       'Cuenta Principal',
    s2a_sub:         'Este email te permite acceder desde cualquier dispositivo (web, tablet, otro PC).',
    s2a_email:       'Email',
    s2a_email_ph:    'tu@correo.com',
    s2a_pass:        'Contrasena',
    s2a_pass_ph:     'Minimo 6 caracteres',
    s2a_confirm:     'Confirmar contrasena',
    s2a_confirm_ph:  'Repite la contrasena',
    s2a_register:    'Crear cuenta',
    s2a_registering: 'Creando cuenta...',
    s2a_skip:        'Omitir — solo usar offline',
    s2a_skip_note:   'Podras vincularlo despues en Configuracion.',
    s2a_err_email:   'Ingresa un email valido.',
    s2a_err_pass:    'La contrasena debe tener al menos 6 caracteres.',
    s2a_err_mismatch:'Las contrasenas no coinciden.',
    s2a_success:     'Cuenta creada. Podras iniciar sesion en la version web con este email.',

    // Step 3 — Usuario
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

    // Step — Activation
    s3_title:        'Registro del Negocio',
    s3_sub:          'Tu negocio ha sido registrado. Esperando activacion por el equipo de Terminal X.',
    s3_registering:  'Registrando tu negocio...',
    s3_waiting:      'Esperando activacion...',
    s3_waiting_sub:  'Nuestro equipo activara tu cuenta en breve. Esta pantalla se actualizara automaticamente.',
    s3_hwid:         'ID de equipo',
    s3_err_register: 'Error al registrar. Verifica tu conexion a internet.',

    // Step 4 — Fiscal
    s4_title:        'Comprobantes Fiscales',
    s4_sub:          'Selecciona el modo de facturación de tu negocio.',
    s4_paper:        'B01 / B02 — Papel (NCF tradicional)',
    s4_paper_desc:   'Talonarios físicos autorizados por la DGII.',
    s4_ecf:          'E31 / E32 — e-CF (Electrónico)',
    s4_ecf_desc:     'Obligatorio para nuevos contribuyentes. Ley 32-23.',
    s4_ecf_warn:     'Requiere certificado digital (.p12) de la DGII.',
    s4_ef2_title:    'Configuración DGII',
    s4_ef2_sub:      'Opcional — puedes configurarlo después en Configuración → e-CF.',
    s4_ef2_user:     'RNC Emisor',
    s4_ef2_user_ph:  'XXX-XXXXX-X',
    s4_ef2_token:    'Certificado .p12',
    s4_ef2_token_ph: 'Se configura en Configuración → e-CF',
    s4_saving:       'Guardando…',

    // Step — Done / Welcome
    s5_title:        '¡Bienvenido a Terminal X POS!',
    s5_sub:          'Tu negocio ha sido registrado exitosamente.',
    s5_go:           'Comenzar a usar Terminal X',
    s5_next:         'Proximos pasos',
    s5_step_services:'Agrega tus servicios en Configuracion → Servicios',
    s5_step_printer: 'Conecta tu impresora en Configuracion → Impresora',
    s5_step_test:    'Realiza una venta de prueba en el POS',

    // Shared
    next:            'Continuar',
    back:            'Atrás',
  },

  en: {
    step1: 'Business',
    step2: 'Account',
    step3: 'Admin',
    step4: 'Fiscal',
    step5: 'Activation',
    step6: 'Done',

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

    s2a_title:       'Main Account',
    s2a_sub:         'This email lets you access from any device (web, tablet, another PC).',
    s2a_email:       'Email',
    s2a_email_ph:    'you@email.com',
    s2a_pass:        'Password',
    s2a_pass_ph:     'Minimum 6 characters',
    s2a_confirm:     'Confirm password',
    s2a_confirm_ph:  'Repeat password',
    s2a_register:    'Create account',
    s2a_registering: 'Creating account...',
    s2a_skip:        'Skip — offline only',
    s2a_skip_note:   'You can link it later in Settings.',
    s2a_err_email:   'Enter a valid email.',
    s2a_err_pass:    'Password must be at least 6 characters.',
    s2a_err_mismatch:'Passwords do not match.',
    s2a_success:     'Account created. You can log in to the web version with this email.',

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

    s3_title:        'Business Registration',
    s3_sub:          'Your business has been registered. Waiting for activation by the Terminal X team.',
    s3_registering:  'Registering your business...',
    s3_waiting:      'Waiting for activation...',
    s3_waiting_sub:  'Our team will activate your account shortly. This screen will update automatically.',
    s3_hwid:         'Machine ID',
    s3_err_register: 'Registration failed. Check your internet connection.',

    // Step 4 — Fiscal
    s4_title:        'Fiscal Receipts',
    s4_sub:          'Select the billing mode for your business.',
    s4_paper:        'B01 / B02 — Paper (traditional NCF)',
    s4_paper_desc:   'Physical receipt books authorized by DGII.',
    s4_ecf:          'E31 / E32 — e-CF (Electronic)',
    s4_ecf_desc:     'Required for new taxpayers. Law 32-23.',
    s4_ecf_warn:     'Requires a digital certificate (.p12) from DGII.',
    s4_ef2_title:    'DGII Configuration',
    s4_ef2_sub:      'Optional — you can configure this later in Settings → e-CF.',
    s4_ef2_user:     'Emisor RNC',
    s4_ef2_user_ph:  'XXX-XXXXX-X',
    s4_ef2_token:    '.p12 Certificate',
    s4_ef2_token_ph: 'Configure in Settings → e-CF',
    s4_saving:       'Saving…',

    // Step 5 — Done
    s5_title:        'Welcome to Terminal X POS!',
    s5_sub:          'Your business has been registered successfully.',
    s5_go:           'Start using Terminal X',
    s5_next:         'Next steps',
    s5_step_services:'Add your services in Settings → Services',
    s5_step_printer: 'Connect your printer in Settings → Printer',
    s5_step_test:    'Run a test sale in the POS',

    next:            'Continue',
    back:            'Back',
  },
}

// ── Shared field IDs for a11y ──────────────────────────────────────────────────
// ipc() helper removed — use `const api = useAPI()` inside each component

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
  { n: 2, icon: Mail },
  { n: 3, icon: User },
  { n: 4, icon: ReceiptText },
  { n: 5, icon: KeyRound },
  { n: 6, icon: CheckCircle2 },
]

function StepProgress({ step, lang }) {
  const t = k => COPY[lang][k] || k
  const labels = [t('step1'), t('step2'), t('step3'), t('step4'), t('step5'), t('step6')]

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
          <img src={logoImg} alt="Terminal X" className="w-11 h-11 object-contain" draggable={false} />
        </div>
        <p className="text-white font-[500] tracking-[3px] text-[18px]">TERMINAL X</p>
        <p className="text-zinc-500 text-[11px] mt-1 tracking-wider">CONFIGURACIÓN INICIAL</p>
      </div>

      {/* Step progress — only shown during steps 1-5 */}
      {step >= 1 && step <= 6 && (
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
          <img src={logoImg} alt="Terminal X" className="w-11 h-11 object-contain" draggable={false} />
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
  const api = useAPI()
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
      await api?.admin?.saveEmpresa?.({
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
              <TextInput id="emp-rnc" value={rnc} onChange={v => {
                const digits = v.replace(/\D/g, '').slice(0, 9)
                if (digits.length <= 3) setRnc(digits)
                else if (digits.length <= 8) setRnc(digits.slice(0,3) + '-' + digits.slice(3))
                else setRnc(digits.slice(0,3) + '-' + digits.slice(3,8) + '-' + digits.slice(8))
              }} placeholder="XXX-XXXXX-X" inputMode="numeric" maxLength={11} />
            </Field>
            <Field label={t('s1_tel')} id="emp-tel">
              <TextInput id="emp-tel" value={tel} onChange={v => {
                const digits = v.replace(/\D/g, '').slice(0, 10)
                if (digits.length <= 3) setTel(digits)
                else if (digits.length <= 6) setTel(digits.slice(0,3) + '-' + digits.slice(3))
                else setTel(digits.slice(0,3) + '-' + digits.slice(3,6) + '-' + digits.slice(6))
              }} placeholder="809-555-0123" inputMode="tel" maxLength={12} />
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

// ── Step 2 — Main Account (Supabase Auth) ─────────────────────────────────────
function StepCuenta({ t, onNext, onBack, empresaNombre, empresaRnc }) {
  const api = useAPI()
  const [email,      setEmail]      = useState('')
  const [pass,       setPass]       = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [showPass,   setShowPass]   = useState(false)
  const [err,        setErr]        = useState('')
  const [saving,     setSaving]     = useState(false)
  const [success,    setSuccess]    = useState(false)

  async function handleRegister() {
    // Validate
    if (!email.trim() || !email.includes('@')) { setErr(t('s2a_err_email')); return }
    if (pass.length < 6)  { setErr(t('s2a_err_pass')); return }
    if (pass !== confirm)  { setErr(t('s2a_err_mismatch')); return }
    setErr('')
    setSaving(true)

    try {
      const sb = getSupabaseClient()
      if (!sb) throw new Error('Supabase no configurado. Verifica las credenciales en .env')

      // 1. Create Supabase Auth user
      const { data: authData, error: authErr } = await sb.auth.signUp({
        email: email.trim(),
        password: pass,
      })
      if (authErr) throw authErr
      const userId = authData.user?.id
      if (!userId) throw new Error('No se pudo crear el usuario')

      // 2. Store the Supabase URL/key so desktop can sync
      // (already in .env, but also persist to app_settings for runtime)
      try {
        await api?.settings?.update?.({
          supabase_auth_email: email.trim(),
          supabase_user_id:    userId,
        })
      } catch {}

      // 3. Create/update business row with owner_id
      // First check if business exists from desktop sync
      const existingBizId = getStoredSetting('business_id')
      if (existingBizId) {
        // Update existing business with owner_id
        await sb.from('businesses').update({ owner_id: userId }).eq('id', existingBizId)
      } else {
        // Create new business
        const { data: biz, error: bizErr } = await sb.from('businesses')
          .insert({
            owner_id: userId,
            name:     empresaNombre || 'Mi Negocio',
            rnc:      empresaRnc || '',
          })
          .select('id')
          .single()
        if (bizErr) throw bizErr
        setStoredSetting('business_id', biz.id)
      }

      // 4. Create staff row linking auth user to business
      const bizId = getStoredSetting('business_id')
      if (bizId) {
        await sb.from('staff').upsert({
          business_id:  bizId,
          auth_user_id: userId,
          name:         'Owner',
          username:     'owner',
          role:         'owner',
        }, { onConflict: 'business_id,auth_user_id' }).select()
      }

      setSuccess(true)
    } catch (e) {
      setErr(e?.message || 'Error al crear la cuenta')
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
          <div className="w-14 h-14 bg-green-600/10 border border-green-600/20 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 size={28} className="text-green-500" />
          </div>
          <h2 className="text-white text-[20px] font-bold mb-2">{t('s2a_success')}</h2>
          <p className="text-zinc-500 text-[13px] mb-6">{email}</p>
          <button onClick={() => onNext()} className="w-full py-3.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-[14px] transition-colors flex items-center justify-center gap-2">
            {t('next')} <ChevronRight size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <div className="mb-7">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center mb-4">
            <Mail size={18} className="text-red-500" />
          </div>
          <h2 className="text-white text-[22px] font-bold">{t('s2a_title')}</h2>
          <p className="text-zinc-500 text-[13px] mt-1">{t('s2a_sub')}</p>
        </div>

        <div className="space-y-5">
          <Field label={t('s2a_email')} id="acct-email" error={err && !email.includes('@') ? err : ''}>
            <TextInput id="acct-email" value={email} onChange={v => { setEmail(v); setErr('') }}
              placeholder={t('s2a_email_ph')} type="email" autoFocus />
          </Field>

          <Field label={t('s2a_pass')} id="acct-pass" error={err && pass.length < 6 ? err : ''}>
            <div className="relative">
              <TextInput id="acct-pass" value={pass} onChange={v => { setPass(v); setErr('') }}
                placeholder={t('s2a_pass_ph')} type={showPass ? 'text' : 'password'} />
              <button type="button" onClick={() => setShowPass(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>

          <Field label={t('s2a_confirm')} id="acct-confirm" error={err && pass !== confirm ? err : ''}>
            <TextInput id="acct-confirm" value={confirm} onChange={v => { setConfirm(v); setErr('') }}
              placeholder={t('s2a_confirm_ph')} type={showPass ? 'text' : 'password'} />
          </Field>

          {err && email.includes('@') && pass.length >= 6 && pass === confirm && (
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
          <button onClick={handleRegister} disabled={saving}
            className="flex-1 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-bold rounded-xl text-[14px] transition-colors flex items-center justify-center gap-2">
            {saving ? <><Loader2 size={15} className="animate-spin" /> {t('s2a_registering')}</>
                    : <>{t('s2a_register')} <ChevronRight size={16} /></>}
          </button>
        </div>

        {/* Skip option */}
        <div className="mt-5 text-center">
          <button onClick={() => onNext()}
            className="text-zinc-500 hover:text-zinc-300 text-[12px] underline underline-offset-2 transition-colors">
            {t('s2a_skip')}
          </button>
          <p className="text-zinc-600 text-[11px] mt-1">{t('s2a_skip_note')}</p>
        </div>
      </div>
    </div>
  )
}

// ── Step 3 — Admin User ───────────────────────────────────────────────────────
function StepUsuario({ t, onNext, onBack }) {
  const api = useAPI()
  const [nombre,   setNombre]   = useState('')
  const [username, setUsername] = useState('')
  const [userEdited, setUserEdited] = useState(false) // true once user manually edits username
  const [pin,      setPin]      = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPin,  setShowPin]  = useState(false)
  const [err,      setErr]      = useState('')
  const [saving,   setSaving]   = useState(false)

  // Auto-generate username from nombre (until user edits it manually)
  function handleNombreChange(v) {
    setNombre(v)
    if (!userEdited) {
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
      const result = await api?.admin?.saveUsuario?.({
        name:     nombre.trim(),
        username: (username.trim() || nombre.trim().toLowerCase().replace(/\s+/g, '.')).slice(0, 30),
        pin,
        role:     'owner',
        discount_pct: 0,
      })
      // Verify the user was actually created
      const users = await api?.admin?.getUsuarios?.()
      if (!users || users.length === 0) throw new Error('No se pudo crear el usuario. Intenta de nuevo.')
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
            <TextInput id="usr-username" value={username} onChange={v => { setUserEdited(true); setUsername(v.replace(/\s/g, '').toLowerCase()) }}
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
function StepActivation({ t, onNext, onBack, empresaNombre, empresaRnc, hwid }) {
  const api = useAPI()
  const { activate } = useLicense()
  const [phase, setPhase] = useState('registering')
  const [err, setErr] = useState('')
  const [licenseKey, setLicenseKey] = useState('')

  useEffect(() => {
    if (!hwid) return // wait for hwid to load
    let cancelled = false
    async function register() {
      try {
        const empresa = await api?.admin?.getEmpresa?.()
        const name = empresa?.name || empresaNombre || 'Business'
        const rnc = empresa?.rnc || empresaRnc || ''
        const phone = empresa?.phone || ''
        const email = empresa?.email || ''
        const body = { business_name: name, rnc, phone, email, hwid, language: t('next') === 'Continue' ? 'en' : 'es' }
        // Use IPC on desktop (no CORS), fetch on web
        const result = window.electronAPI?.remote
          ? await window.electronAPI.remote.register(body)
          : await fetch('https://terminalxpos.com/api/panel?action=register', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }).then(r => { if (!r.ok) throw new Error('fail'); return r.json() })
        if (!cancelled) {
          if (result.data?.license_key) setLicenseKey(result.data.license_key)
          setPhase('waiting')
        }
      } catch {
        if (!cancelled) { setErr(t('s3_err_register')); setPhase('error') }
      }
    }
    register()
    return () => { cancelled = true }
  }, [hwid])

  useEffect(() => {
    if (phase !== 'waiting' || !licenseKey) return
    let cancelled = false
    const poll = async () => {
      try {
        const body = { key: licenseKey, hwid, rnc: (empresaRnc || '').replace(/\D/g, '') }
        // Use IPC on desktop (no CORS), fetch on web
        const data = window.electronAPI?.remote
          ? await window.electronAPI.remote.validate(body)
          : await fetch('https://terminalxpos.com/api/validate', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }).then(r => r.json())
        if (!cancelled && data.valid && data.status === 'active') {
          setPhase('activated')
          try { await activate(licenseKey, (empresaRnc || '').replace(/\D/g, '')) } catch {}
        }
      } catch {}
    }
    poll()
    const id = setInterval(poll, 10000)
    return () => { cancelled = true; clearInterval(id) }
  }, [phase, licenseKey])

  useEffect(() => {
    if (phase === 'activated') {
      const timer = setTimeout(onNext, 2500)
      return () => clearTimeout(timer)
    }
  }, [phase])

  return (
    <div className="w-full max-w-md">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <div className="mb-7">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center mb-4">
            <KeyRound size={18} className="text-red-500" />
          </div>
          <h2 className="text-white text-[22px] font-bold">{t('s3_title')}</h2>
        </div>

        {(phase === 'registering') && (
          <div className="flex flex-col items-center py-12 gap-4">
            <Loader2 size={32} className="animate-spin text-red-500" />
            <p className="text-zinc-400 text-[14px] font-medium">{t('s3_registering')}</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center py-8 gap-4">
            <AlertTriangle size={32} className="text-red-400" />
            <p className="text-red-400 text-[13px] text-center">{err}</p>
            <button onClick={onBack}
              className="px-5 py-2.5 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 rounded-xl text-[13px] font-medium transition-colors">
              <ChevronLeft size={14} className="inline mr-1" /> {t('back')}
            </button>
          </div>
        )}

        {phase === 'waiting' && (
          <div className="flex flex-col items-center py-6 gap-5">
            <div className="w-20 h-20 rounded-full bg-amber-500/10 border-2 border-amber-500/20 flex items-center justify-center">
              <Loader2 size={28} className="animate-spin text-amber-400" />
            </div>
            <div className="text-center">
              <p className="text-amber-400 font-semibold text-[16px]">{t('s3_waiting')}</p>
              <p className="text-zinc-500 text-[12px] mt-2 max-w-xs">{t('s3_waiting_sub')}</p>
            </div>
            {empresaNombre && (
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 w-full text-center">
                <p className="text-white text-[15px] font-semibold">{empresaNombre}</p>
                {empresaRnc && <p className="text-zinc-500 text-[12px] mt-0.5">{empresaRnc}</p>}
              </div>
            )}
            {hwid && (
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3 w-full">
                <span className="text-[10px] font-bold text-zinc-500 uppercase">{t('s3_hwid')}</span>
                <p className="text-[11px] text-zinc-400 font-mono mt-0.5 select-all">{hwid}</p>
              </div>
            )}
            <button onClick={onBack}
              className="mt-2 px-5 py-2.5 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 rounded-xl text-[13px] font-medium transition-colors">
              <ChevronLeft size={14} className="inline mr-1" /> {t('back')}
            </button>
          </div>
        )}

        {phase === 'activated' && (
          <div className="flex flex-col items-center py-8 gap-4">
            <div className="w-20 h-20 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center animate-pulse">
              <CheckCircle2 size={36} className="text-green-400" />
            </div>
            <p className="text-green-400 font-bold text-[18px]">{t('s5_title')}</p>
            <p className="text-zinc-400 text-[13px]">{t('s5_sub')}</p>
            {empresaNombre && <p className="text-white font-semibold text-[15px]">{empresaNombre}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Step 4 — Fiscal ───────────────────────────────────────────────────────────
function StepFiscal({ t, onNext, onBack }) {
  const api = useAPI()
  const [mode,     setMode]     = useState('paper')   // 'paper' | 'ecf'
  const [ef2User,  setEf2User]  = useState('')
  const [ef2Token, setEf2Token] = useState('')
  const [showToken,setShowToken]= useState(false)
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  async function handleNext() {
    setSaving(true)
    try {
      const biz = await api?.admin?.getEmpresa?.()
      const s   = biz?.settings ? JSON.parse(biz.settings) : {}
      await api?.admin?.saveEmpresa?.({
        settings: JSON.stringify({ ...s, facturacion_mode: mode }),
      })
      if (mode === 'ecf' && ef2Token.trim()) {
        await api?.safe?.set?.('ef2_token', ef2Token.trim())
      }
      onNext()
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
            <ReceiptText size={18} className="text-red-500" />
          </div>
          <h2 className="text-white text-[22px] font-bold">{t('s4_title')}</h2>
          <p className="text-zinc-500 text-[13px] mt-1">{t('s4_sub')}</p>
        </div>

        {/* Mode selector */}
        <div className="space-y-3 mb-6">
          {[
            { value: 'paper', icon: ReceiptText, label: t('s4_paper'), desc: t('s4_paper_desc') },
            { value: 'ecf',   icon: Wifi,        label: t('s4_ecf'),   desc: t('s4_ecf_desc')   },
          ].map(({ value, icon: Icon, label, desc }) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`w-full flex items-start gap-4 px-4 py-4 rounded-xl border-2 text-left transition-all
                ${mode === value
                  ? 'border-red-500 bg-red-500/5'
                  : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5
                ${mode === value ? 'bg-red-600/20' : 'bg-zinc-700'}`}>
                <Icon size={15} className={mode === value ? 'text-red-400' : 'text-zinc-400'} />
              </div>
              <div>
                <p className={`text-[13px] font-semibold ${mode === value ? 'text-white' : 'text-zinc-300'}`}>{label}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">{desc}</p>
              </div>
              <div className={`ml-auto w-4 h-4 rounded-full border-2 shrink-0 mt-1 transition-all
                ${mode === value ? 'border-red-500 bg-red-500' : 'border-zinc-600'}`} />
            </button>
          ))}
        </div>

        {/* e-CF credentials (optional) */}
        {mode === 'ecf' && (
          <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-5 mb-4 space-y-4">
            <div>
              <p className="text-[12px] font-bold text-zinc-300 mb-0.5">{t('s4_ef2_title')}</p>
              <p className="text-[11px] text-zinc-500">{t('s4_ef2_sub')}</p>
            </div>
            <Field label={t('s4_ef2_user')} id="fiscal-ef2user">
              <TextInput id="fiscal-ef2user" value={ef2User} onChange={setEf2User}
                placeholder={t('s4_ef2_user_ph')} type="email" />
            </Field>
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                {t('s4_ef2_token')}
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={ef2Token}
                  onChange={e => setEf2Token(e.target.value)}
                  placeholder={t('s4_ef2_token_ph')}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-[13px] font-mono
                             placeholder-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30 transition-colors pr-10"
                />
                <button type="button" onClick={() => setShowToken(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {err && (
          <p className="text-[12px] text-red-400 flex items-center gap-1 mb-4">
            <AlertTriangle size={11} /> {err}
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={onBack}
            className="flex items-center gap-1.5 px-5 py-3 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 rounded-xl text-[13px] font-medium transition-colors">
            <ChevronLeft size={14} /> {t('back')}
          </button>
          <button onClick={handleNext} disabled={saving}
            className="flex-1 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[14px] transition-all active:scale-[0.98] flex items-center justify-center gap-2">
            {saving ? <><Loader2 size={15} className="animate-spin" /> {t('s4_saving')}</> : <>{t('next')} <ChevronRight size={15} /></>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Step 5 — Done ─────────────────────────────────────────────────────────────
function StepDone({ t, empresaNombre, onComplete }) {
  const nextSteps = [
    { icon: ReceiptText, text: t('s5_step_services') },
    { icon: Printer,     text: t('s5_step_printer')  },
    { icon: ArrowRight,  text: t('s5_step_test')     },
  ]

  return (
    <div className="w-full max-w-md text-center">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10">
        {/* Animated success ring */}
        <div className="w-24 h-24 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center mx-auto mb-7 animate-pulse">
          <CheckCircle2 size={44} className="text-green-400" />
        </div>

        <h2 className="text-white text-[26px] font-bold mb-3">{t('s5_title')}</h2>
        <p className="text-zinc-400 text-[14px] mb-2">{t('s5_sub')}</p>
        {empresaNombre && (
          <p className="text-zinc-600 text-[13px] mb-6">
            <span className="text-zinc-400 font-semibold">{empresaNombre}</span>
          </p>
        )}

        {/* Next steps */}
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 mb-7 text-left">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">{t('s5_next')}</p>
          <div className="space-y-2.5">
            {nextSteps.map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={12} className="text-zinc-400" />
                </div>
                <p className="text-[12px] text-zinc-400 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onComplete}
          className="w-full py-4 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold rounded-xl text-[15px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
        >
          {t('s5_go')}
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

// ── Root wizard ───────────────────────────────────────────────────────────────
export default function FirstTimeSetup({ onComplete }) {
  const api = useAPI()
  const { hwid } = useLicense()

  const [lang,         setLang]         = useState('es')
  const [step,         setStep]         = useState(0)
  const [empresaRnc,   setEmpresaRnc]   = useState('')
  const [empresaNombre,setEmpresaNombre]= useState('')

  const t = k => COPY[lang][k] || k

  async function markSetupComplete() {
    try {
      await api?.admin?.saveConfiguracion?.({ setup_complete: '1' })
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
              // On desktop, skip Supabase account step (no credentials available)
              setStep(window.electronAPI ? 3 : 2)
            }}
          />
        )}

        {step === 2 && (
          <StepCuenta
            t={t}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            empresaNombre={empresaNombre}
            empresaRnc={empresaRnc}
          />
        )}

        {step === 3 && (
          <StepUsuario
            t={t}
            onBack={() => setStep(window.electronAPI ? 1 : 2)}
            onNext={() => setStep(4)}
          />
        )}

        {step === 4 && (
          <StepFiscal
            t={t}
            onBack={() => setStep(3)}
            onNext={() => setStep(5)}
          />
        )}

        {step === 5 && (
          <StepActivation
            t={t}
            onBack={() => setStep(4)}
            onNext={() => setStep(6)}
            empresaNombre={empresaNombre}
            empresaRnc={empresaRnc}
            hwid={hwid}
          />
        )}

        {step === 6 && (
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
