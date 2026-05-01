import { useState, useRef, useEffect } from 'react'
import logoImg from '../assets/logo.webp'
import {
  Building2, User, KeyRound, CheckCircle2,
  ChevronRight, ChevronLeft, Upload, Loader2,
  AlertTriangle, Globe, X, Eye, EyeOff,
  ReceiptText, Printer, Wifi, ArrowRight, Mail,
  Car, Store, Briefcase, UtensilsCrossed, CarFront, LayoutGrid,
  Wine, Beef, Wrench, Scissors, Banknote,
} from 'lucide-react'
import { isValidKeyFormat } from '@terminal-x/services/license'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { runDrawerAutoDetect } from '../lib/drawerAutoDetect'
import { useLicense } from '../context/LicenseContext'
import { getSupabaseClient, setStoredSetting, getStoredSetting, ensureBusinessRegistered } from '@terminal-x/services/supabase'
import { withRetry, isSupabaseRetryable } from '@terminal-x/services/retry.js'
import { humanizeNetworkError } from '@terminal-x/services/networkError.js'
import { BUSINESS_TYPES, BUSINESS_TYPE_KEYS, HYBRID_COMPONENT_KEYS, normalizeHybridComponents, isBusinessTypeEnabled } from '@terminal-x/config/businessTypes'
import { TIENDA_SUBTYPES, TIENDA_SUBTYPE_KEYS } from '@terminal-x/config/tiendaSubtypes'
import { formatRnc, formatPhone, RNC_MAX_LENGTH, PHONE_MAX_LENGTH } from '../lib/formatters'

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
    s1_btype:        'Tipo de negocio',
    s1_btype_carwash:'Car Wash',
    s1_btype_cw_desc:'Lavado de vehículos, detailing, servicios automotrices.',
    s1_btype_tienda: 'Tienda / Retail',
    s1_btype_ti_desc:'Venta de productos con inventario, SKU y código de barras.',
    s1_btype_otro:   'Otro',
    s1_btype_ot_desc:'Servicios profesionales, salón, taller, etc.',
    s1_nombre:       'Nombre del negocio',
    s1_nombre_ph:    'Ej: Mi Negocio',
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
    s4_saving:       'Guardando…',

    // Paper (B01/B02) sequence setup
    s4_paper_title:  'Secuencia NCF',
    s4_paper_sub:    'Ingresa el talonario autorizado por la DGII.',
    s4_paper_type:   'Tipo de comprobante',
    s4_paper_b01:    'B01 — Crédito Fiscal',
    s4_paper_b02:    'B02 — Consumo Final',
    s4_paper_from:   'Secuencia desde',
    s4_paper_to:     'Secuencia hasta',
    s4_paper_exp:    'Fecha de vencimiento',
    s4_err_from:     'La secuencia inicial debe ser mayor a 0.',
    s4_err_to:       'La secuencia final debe ser mayor a la inicial.',
    s4_err_exp:      'La fecha de vencimiento debe ser posterior a hoy.',
    s4_err_ncf_save: 'No se pudo guardar la secuencia NCF.',

    // Step — Done / Welcome
    s5_title:        '¡Bienvenido a Terminal X POS!',
    s5_sub:          'Tu negocio ha sido registrado exitosamente.',
    s5_go:           'Comenzar a usar Terminal X',
    s5_next:         'Proximos pasos',
    s5_step_services:'Agrega tus servicios en Configuracion → Servicios',
    s5_step_printer: 'Conecta tu impresora en Configuracion → Impresora',
    s5_step_test:    'Realiza una venta de prueba en el POS',

    // Reconnect
    reconnect_link:  'Ya tengo una cuenta — conectar dispositivo',
    rc_title:        'Conectar dispositivo',
    rc_sub:          'Inicia sesión con tu cuenta existente para sincronizar los datos de tu negocio a este equipo.',
    rc_email:        'Email',
    rc_email_ph:     'tu@correo.com',
    rc_pass:         'Contraseña',
    rc_pass_ph:      'Tu contraseña',
    rc_btn:          'Conectar',
    rc_connecting:   'Conectando...',
    rc_syncing:      'Sincronizando datos del negocio...',
    rc_done:         'Conectado. Cargando...',
    rc_err_required: 'Email y contraseña requeridos.',
    rc_err_no_staff: 'Esta cuenta no tiene usuarios registrados en la nube. Pidele al propietario que cree tu usuario primero, o usa una instalacion nueva.',
    rc_back:         'Volver',

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
    s1_btype:        'Business type',
    s1_btype_carwash:'Car Wash',
    s1_btype_cw_desc:'Vehicle washing, detailing, automotive services.',
    s1_btype_tienda: 'Store / Retail',
    s1_btype_ti_desc:'Product sales with inventory, SKU, and barcode support.',
    s1_btype_otro:   'Other',
    s1_btype_ot_desc:'Professional services, salon, workshop, etc.',
    s1_nombre:       'Business name',
    s1_nombre_ph:    'e.g. My Business',
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
    s4_saving:       'Saving…',

    // Paper (B01/B02) sequence setup
    s4_paper_title:  'NCF Sequence',
    s4_paper_sub:    'Enter the DGII-authorized receipt book.',
    s4_paper_type:   'Receipt type',
    s4_paper_b01:    'B01 — Tax Credit',
    s4_paper_b02:    'B02 — Final Consumer',
    s4_paper_from:   'Sequence from',
    s4_paper_to:     'Sequence to',
    s4_paper_exp:    'Expiry date',
    s4_err_from:     'Starting sequence must be greater than 0.',
    s4_err_to:       'Ending sequence must be greater than the start.',
    s4_err_exp:      'Expiry date must be after today.',
    s4_err_ncf_save: 'Could not save the NCF sequence.',

    // Step 5 — Done
    s5_title:        'Welcome to Terminal X POS!',
    s5_sub:          'Your business has been registered successfully.',
    s5_go:           'Start using Terminal X',
    s5_next:         'Next steps',
    s5_step_services:'Add your services in Settings → Services',
    s5_step_printer: 'Connect your printer in Settings → Printer',
    s5_step_test:    'Run a test sale in the POS',

    // Reconnect
    reconnect_link:  'I already have an account — connect device',
    rc_title:        'Connect device',
    rc_sub:          'Sign in with your existing account to sync your business data to this machine.',
    rc_email:        'Email',
    rc_email_ph:     'you@email.com',
    rc_pass:         'Password',
    rc_pass_ph:      'Your password',
    rc_btn:          'Connect',
    rc_connecting:   'Connecting...',
    rc_syncing:      'Syncing business data...',
    rc_done:         'Connected. Loading...',
    rc_err_required: 'Email and password are required.',
    rc_err_no_staff: 'This account has no staff users in the cloud. Ask the owner to create your user first, or use a fresh install.',
    rc_back:         'Back',

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
        <div className="flex items-center gap-0">
          <span className="text-2xl font-black tracking-[3px] text-white leading-none -mt-1">TERMINAL</span>
          <img src={logoImg} alt="X" className="h-9 w-auto object-contain" draggable={false} />
        </div>
        <p className="text-zinc-500 text-[11px] mt-2 tracking-wider">CONFIGURACIÓN INICIAL</p>
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
function StepWelcome({ t, onNext, onReconnect }) {
  return (
    <div className="w-full max-w-md text-center">
      {/* Mobile logo */}
      <div className="md:hidden flex flex-col items-center mb-10">
        <div className="flex items-center gap-0">
          <span className="text-4xl font-black tracking-[3px] text-white sm:text-5xl leading-none -mt-1">TERMINAL</span>
          <img src={logoImg} alt="X" className="h-12 w-auto object-contain sm:h-14" draggable={false} />
        </div>
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

      <button
        onClick={onReconnect}
        className="mt-4 text-sm text-zinc-500 hover:text-white transition underline"
      >
        {t('reconnect_link')}
      </button>
    </div>
  )
}

// ── Step R — Reconnect ───────────────────────────────────────────────────────
function StepReconnect({ t, onBack, onComplete }) {
  const api = useAPI()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('idle') // idle | signing_in | syncing | done | error
  const [error, setError] = useState('')

  async function handleReconnect() {
    if (!email.trim() || !password) { setError(t('rc_err_required')); return }
    setError('')
    setStatus('signing_in')

    try {
      const sb = getSupabaseClient()
      if (!sb) throw new Error('Supabase no disponible. Verifica tu conexion.')

      // 1. Sign in (retry transient network errors; auth errors surface immediately)
      const { data: authData, error: authError } = await withRetry(
        () => sb.auth.signInWithPassword({ email: email.trim(), password }),
        { label: 'auth.reconnect.signIn', isRetryable: isSupabaseRetryable },
      )
      if (authError) throw authError
      if (!authData?.session) throw new Error('No se pudo iniciar sesion.')

      const userId = authData.session.user.id

      // 2. Find business — try owner_id first, then staff table
      let business = null
      let businessId = null

      const { data: ownedBiz } = await sb
        .from('businesses')
        .select('*')
        .eq('owner_id', userId)
        .limit(1)
        .maybeSingle()

      if (ownedBiz) {
        business = ownedBiz
        businessId = ownedBiz.id
      } else {
        // Try staff table
        const { data: staffRow } = await sb
          .from('staff')
          .select('business_id')
          .eq('auth_user_id', userId)
          .limit(1)
          .maybeSingle()

        if (staffRow?.business_id) {
          businessId = staffRow.business_id
          const { data: biz } = await sb
            .from('businesses')
            .select('*')
            .eq('id', businessId)
            .single()
          business = biz
        }
      }

      if (!business || !businessId) {
        throw new Error('No se encontro un negocio asociado a esta cuenta.')
      }

      // 3. Store Supabase connection
      setStoredSetting('business_id', businessId)

      // 4. Store auth info + business_id in SQLite so sync.js can resolve it
      try {
        await api?.settings?.update?.({
          supabase_business_id: businessId,
          supabase_auth_email: email.trim(),
          supabase_user_id: userId,
        })
      } catch {}

      // 5. Seed local database with business info
      await api?.admin?.saveEmpresa?.({
        name: business.name || 'Mi Negocio',
        rnc: business.rnc || '',
        address: business.address || '',
        phone: business.phone || '',
        email: business.email || '',
      })

      // 6. Store business_type from settings
      const bizSettings = business.settings || {}
      if (bizSettings.business_type) {
        await api?.settings?.update?.({ business_type: bizSettings.business_type })
      }

      // 7. Pull staff from Supabase and create local users
      const { data: remoteStaff } = await sb
        .from('staff')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at')

      if (remoteStaff?.length) {
        for (const u of remoteStaff) {
          try {
            // F2 — pass the row's SYNC identity (`supabase_id`), NOT its
            // PRIMARY KEY (`id`). Using `u.id` here was the single root
            // cause of the staff/empleados duplicate-row cascade: every
            // reconnect wrote the wrong UUID, sync push created a new
            // Supabase row, next pull brought it back, infinite dup loop.
            // Fall back to `u.id` only for legacy rows that predate the
            // supabase_id column (shouldn't exist in prod — defensive).
            await api?.admin?.saveUsuario?.({
              name: u.name || 'Admin',
              username: u.username || u.name?.toLowerCase?.().replace(/\s+/g, '') || 'admin',
              pin_hash: u.pin_hash,  // forward remote hash directly — never clobber with 0000
              role: u.role || 'admin',
              supabase_id: u.supabase_id || u.id,
              discount_pct: u.discount_pct || 0,
              commission_pct: u.commission_pct || 0,
              cedula: u.cedula || null,
              start_date: u.start_date || null,
              employee_id: u.employee_id || null,
            })
          } catch {} // skip duplicates
        }
      } else {
        // F11 — no hardcoded PIN='0000' fallback. Remote has zero staff →
        // stop the reconnect here and make the operator set a real PIN
        // before we push any user to Supabase. Surfacing this as an error
        // so the UI lands in the 'error' branch with a clear CTA instead
        // of silently creating a weak admin/0000 account.
        setStatus('error')
        setError(t('rc_err_no_staff') || 'Esta cuenta no tiene usuarios registrados. Crea el administrador desde un nuevo asistente de instalacion, o pidele al propietario que cree tu usuario primero.')
        return
      }

      setStatus('syncing')

      // 8. Trigger sync
      try {
        await window.electronAPI?.sync?.now?.()
      } catch {}

      setStatus('done')
      setTimeout(() => onComplete(), 1500)
    } catch (e) {
      console.error('[reconnect]', e)
      setError(humanizeNetworkError(e, { context: 'reconnect' }))
      setStatus('error')
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <div className="mb-7">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center mb-4">
            <Wifi size={18} className="text-red-500" />
          </div>
          <h2 className="text-white text-[22px] font-bold">{t('rc_title')}</h2>
          <p className="text-zinc-500 text-[13px] mt-1">{t('rc_sub')}</p>
        </div>

        <div className="space-y-4">
          <Field label={t('rc_email')} id="rc-email">
            <TextInput
              id="rc-email"
              type="email"
              value={email}
              onChange={v => { setEmail(v); setError('') }}
              placeholder={t('rc_email_ph')}
              disabled={status !== 'idle' && status !== 'error'}
              autoFocus
            />
          </Field>

          <Field label={t('rc_pass')} id="rc-pass">
            <input
              id="rc-pass"
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder={t('rc_pass_ph')}
              disabled={status !== 'idle' && status !== 'error'}
              onKeyDown={e => e.key === 'Enter' && handleReconnect()}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-[14px] placeholder-zinc-600
                         focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            />
          </Field>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle size={12} />
              {error}
            </div>
          )}

          {status === 'syncing' && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              {t('rc_syncing')}
            </div>
          )}

          {status === 'done' && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-xs text-green-400 flex items-center gap-2">
              <CheckCircle2 size={14} />
              {t('rc_done')}
            </div>
          )}

          <button
            onClick={handleReconnect}
            disabled={status === 'signing_in' || status === 'syncing' || status === 'done'}
            className="w-full py-3.5 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold rounded-xl text-[14px] transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {status === 'signing_in'
              ? <><Loader2 size={15} className="animate-spin" /> {t('rc_connecting')}</>
              : <>{t('rc_btn')} <ArrowRight size={16} /></>}
          </button>

          <button
            onClick={onBack}
            disabled={status === 'syncing' || status === 'done'}
            className="w-full text-center text-sm text-zinc-500 hover:text-white transition disabled:opacity-30"
          >
            {t('rc_back')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Step 1 — Empresa ──────────────────────────────────────────────────────────
// Type list is derived from the BUSINESS_TYPES registry in @terminal-x/config.
// Add a new vertical there and it shows up here automatically.
const TYPE_ICONS = {
  Car, Store, Briefcase, UtensilsCrossed, CarFront, LayoutGrid,
  Wine, Beef, Wrench, Scissors, Banknote,
}
const BIZ_TYPES = BUSINESS_TYPE_KEYS.map(key => {
  const cfg = BUSINESS_TYPES[key]
  return {
    value: key,
    icon: TYPE_ICONS[cfg.icon] || Briefcase,
    label: cfg.label,
    description: cfg.description,
    disabled: !cfg.enabled,
  }
})

function StepEmpresa({ t, lang, onNext, onBack }) {
  const api = useAPI()
  const [bizType,  setBizType]  = useState('carwash')
  // Hybrid: owner picks 2+ component verticals. Defaults to restaurant+retail
  // (legacy hardcoded behavior) so existing installs keep working.
  const [hybridComps, setHybridComps] = useState(['restaurant', 'retail'])
  // Tienda subtype — only used when bizType is a tienda vertical. Defaults
  // to 'otro' so we always write something; owner refines it later in Settings.
  const [tiendaSub, setTiendaSub] = useState('otro')
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
      // Seed tienda_subtype for any tienda-like vertical. For top-level
      // licoreria / carniceria we lock the subtype to match; for retail
      // the owner picked it explicitly above.
      const tiendaLike = bizType === 'retail' || bizType === 'licoreria' || bizType === 'carniceria'
      const subtypeToWrite = bizType === 'licoreria' ? 'licoreria'
                           : bizType === 'carniceria' ? 'otro'
                           : tiendaSub
      const payload = { business_type: bizType }
      if (tiendaLike) payload.tienda_subtype = subtypeToWrite
      if (bizType === 'hybrid') {
        payload.hybrid_components = normalizeHybridComponents(hybridComps).join(',')
      }
      await api?.settings?.update?.(payload)
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
          {/* Business type selector */}
          <div>
            <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
              {t('s1_btype')}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {BIZ_TYPES.map(({ value, icon: Icon, label, description, disabled }) => (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  onClick={() => !disabled && setBizType(value)}
                  className={`relative flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border-2 text-center transition-all
                    ${disabled
                      ? 'border-zinc-800 bg-zinc-900/40 opacity-50 cursor-not-allowed'
                      : bizType === value
                        ? 'border-red-500 bg-red-500/5'
                        : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                    }`}
                >
                  {disabled && (
                    <span className="absolute top-1 right-1 text-[8px] uppercase tracking-wider text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                      {lang === 'en' ? 'Soon' : 'Próx.'}
                    </span>
                  )}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center
                    ${bizType === value && !disabled ? 'bg-red-600/20' : 'bg-zinc-700'}`}>
                    <Icon size={15} className={bizType === value && !disabled ? 'text-red-400' : 'text-zinc-400'} />
                  </div>
                  <p className={`text-[11px] font-semibold leading-tight ${bizType === value && !disabled ? 'text-white' : 'text-zinc-300'}`}>
                    {label[lang] || label.es}
                  </p>
                  <p className="text-[9px] text-zinc-500 leading-tight">{description[lang] || description.es}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Hybrid components — pick 2+ verticals to combine */}
          {bizType === 'hybrid' && (
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                {lang === 'en' ? 'Combine which business types?' : 'Combinar cuáles tipos de negocio?'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {HYBRID_COMPONENT_KEYS.map(key => {
                  const cfg = BUSINESS_TYPES[key]
                  if (!cfg || cfg.enabled === false) return null
                  const checked = hybridComps.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setHybridComps(prev => checked ? prev.filter(k => k !== key) : [...prev, key])}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-left transition-all
                        ${checked ? 'border-red-500 bg-red-500/5 text-white' : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-500'}`}
                    >
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                        ${checked ? 'border-red-500 bg-red-500' : 'border-zinc-600'}`}>
                        {checked && <X size={10} className="text-white rotate-45" />}
                      </span>
                      <span className="text-[12px] font-semibold">{cfg.label[lang] || cfg.label.es}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] text-zinc-500 mt-1.5">
                {lang === 'en'
                  ? 'Pick at least 2. Modules and POS layout combine automatically.'
                  : 'Elige al menos 2. Los módulos y la vista del POS se combinan automáticamente.'}
              </p>
              {hybridComps.length < 2 && (
                <p className="text-[10px] text-amber-400 mt-1">
                  {lang === 'en' ? 'Select at least 2 — falls back to Restaurant + Retail otherwise.' : 'Elige al menos 2 — si no, se usará Restaurante + Tienda.'}
                </p>
              )}
            </div>
          )}

          {/* Tienda subtype — only when retail/tienda was picked */}
          {bizType === 'retail' && (
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                {lang === 'en' ? 'Store type' : 'Tipo de tienda'}
              </label>
              <select
                value={tiendaSub}
                onChange={(e) => setTiendaSub(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-zinc-700 bg-zinc-800 text-white focus:outline-none focus:border-red-500"
              >
                {TIENDA_SUBTYPE_KEYS.map(key => (
                  <option key={key} value={key}>{TIENDA_SUBTYPES[key][lang] || TIENDA_SUBTYPES[key].es}</option>
                ))}
              </select>
              <p className="text-[10px] text-zinc-500 mt-1.5">
                {lang === 'en'
                  ? 'Sets default categories and features. You can change this later in Settings.'
                  : 'Configura categorías y funciones por defecto. Puedes cambiarlo luego en Configuración.'}
              </p>
            </div>
          )}

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
              <TextInput id="emp-rnc" value={rnc} onChange={v => setRnc(formatRnc(v))}
                placeholder="XXX-XXXXX-X" inputMode="numeric" maxLength={RNC_MAX_LENGTH} />
            </Field>
            <Field label={t('s1_tel')} id="emp-tel">
              <TextInput id="emp-tel" value={tel} onChange={v => setTel(formatPhone(v))}
                placeholder="809-555-0123" inputMode="tel" maxLength={PHONE_MAX_LENGTH} />
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
        const address = empresa?.address || ''
        const body = { business_name: name, rnc, phone, email, address, hwid, language: t('next') === 'Continue' ? 'en' : 'es' }
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
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  // Paper-mode NCF seed inputs (O-H3 fix — otherwise cobrar returns blank NCF)
  const [ncfType, setNcfType] = useState('B02')           // 'B01' | 'B02'
  const [ncfFrom, setNcfFrom] = useState('1')
  const [ncfTo,   setNcfTo]   = useState('999')
  const [ncfExp,  setNcfExp]  = useState('')              // YYYY-MM-DD (DGII-assigned)
  const [fieldErr, setFieldErr] = useState({})            // { from?, to?, exp? }

  function validatePaper() {
    const from = parseInt(ncfFrom, 10)
    const to   = parseInt(ncfTo,   10)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const expDate = ncfExp ? new Date(`${ncfExp}T00:00:00`) : null
    const e = {}
    if (!Number.isFinite(from) || from <= 0) e.from = t('s4_err_from')
    if (!Number.isFinite(to)   || to   <= from) e.to = t('s4_err_to')
    if (!expDate || isNaN(expDate.getTime()) || expDate <= today) e.exp = t('s4_err_exp')
    setFieldErr(e)
    return { ok: Object.keys(e).length === 0, from, to, expDate }
  }

  async function handleNext() {
    setErr('')
    if (mode === 'paper') {
      const v = validatePaper()
      if (!v.ok) return
      setSaving(true)
      try {
        const biz = await api?.admin?.getEmpresa?.()
        const s   = biz?.settings ? JSON.parse(biz.settings) : {}
        await api?.admin?.saveEmpresa?.({
          settings: JSON.stringify({ ...s, facturacion_mode: mode }),
        })
        // Seed the ncf_sequences row so cobrar can generate NCFs.
        // Desktop: ncfUpdateSequence UPDATEs the pre-seeded B01/B02 row.
        // Web:     saveSecuenciaNcf upserts on (business_id, type).
        // Both paths are exposed via api.admin.saveSecuenciaNcf.
        const saveSeq = api?.admin?.saveSecuenciaNcf
        if (typeof saveSeq !== 'function') throw new Error('NCF API no disponible')
        await saveSeq({
          type:           ncfType,
          prefix:         ncfType,                 // 'B01' | 'B02' — 11-digit NCF: prefix + 8 digits
          current_number: Math.max(0, v.from - 1), // ncfGetNext() pre-increments, so store "last used"
          limit_number:   v.to,
          valid_until:    ncfExp,                   // ISO date string
          active:         1,
          enabled:        1,
        })
        onNext()
      } catch (e) {
        setErr(e?.message || t('s4_err_ncf_save'))
      } finally {
        setSaving(false)
      }
      return
    }

    // e-CF branch — preserved verbatim
    setSaving(true)
    try {
      const biz = await api?.admin?.getEmpresa?.()
      const s   = biz?.settings ? JSON.parse(biz.settings) : {}
      await api?.admin?.saveEmpresa?.({
        settings: JSON.stringify({ ...s, facturacion_mode: mode }),
      })
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

        {/* Paper NCF sequence (required for cobrar to emit an NCF) */}
        {mode === 'paper' && (
          <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-5 mb-4 space-y-4">
            <div>
              <p className="text-[12px] font-bold text-zinc-300 mb-0.5">{t('s4_paper_title')}</p>
              <p className="text-[11px] text-zinc-500">{t('s4_paper_sub')}</p>
            </div>

            <Field label={t('s4_paper_type')} id="ncf-type">
              <div className="flex gap-2">
                {['B01', 'B02'].map(tp => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setNcfType(tp)}
                    className={`flex-1 px-3 py-2.5 rounded-xl border-2 text-[12px] font-semibold transition-all
                      ${ncfType === tp
                        ? 'border-red-500 bg-red-500/10 text-white'
                        : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-500'
                      }`}
                  >
                    {tp === 'B01' ? t('s4_paper_b01') : t('s4_paper_b02')}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('s4_paper_from')} id="ncf-from" error={fieldErr.from}>
                <TextInput
                  id="ncf-from"
                  value={ncfFrom}
                  onChange={setNcfFrom}
                  type="number"
                  inputMode="numeric"
                  placeholder="1"
                />
              </Field>
              <Field label={t('s4_paper_to')} id="ncf-to" error={fieldErr.to}>
                <TextInput
                  id="ncf-to"
                  value={ncfTo}
                  onChange={setNcfTo}
                  type="number"
                  inputMode="numeric"
                  placeholder="999"
                />
              </Field>
            </div>

            <Field label={t('s4_paper_exp')} id="ncf-exp" error={fieldErr.exp}>
              <TextInput
                id="ncf-exp"
                value={ncfExp}
                onChange={setNcfExp}
                type="date"
              />
            </Field>
          </div>
        )}

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

// ── Optional drawer auto-detect panel (desktop only) ──────────────────────────
// Shown at the top of StepDone. Gives the owner a one-shot "connect my drawer"
// flow so they never have to open Settings → Impresora on day one. Skippable.
function StepDoneDrawerPanel({ lang }) {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const [phase, setPhase] = useState('idle') // idle | running | saved | skipped
  const [currentIdx, setCurrentIdx] = useState(null)
  const ctlRef = useRef(null)

  if (!printerApi?.fireDrawerVariant) return null // web / no printer IPC

  const L = (es, en) => lang === 'es' ? es : en

  function start() {
    setPhase('running')
    ctlRef.current = runDrawerAutoDetect({
      printerApi,
      onProgress: ({ idx }) => setCurrentIdx(idx),
      onExhausted: () => { setPhase('idle'); setCurrentIdx(null) },
    })
  }

  async function confirm() {
    const { hex } = ctlRef.current?.getCurrent?.() || {}
    ctlRef.current?.cancel()
    if (hex) {
      try { await api?.settings?.update?.({ drawer_pulse_hex: hex }) } catch {}
      setPhase('saved')
    } else {
      setPhase('idle')
    }
    setCurrentIdx(null)
  }

  function cancel() {
    ctlRef.current?.cancel()
    setPhase('skipped')
    setCurrentIdx(null)
  }

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 mb-4 text-left">
      <div className="flex items-center gap-2 mb-2">
        <Printer size={13} className="text-zinc-400" />
        <p className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
          {L('Gaveta de dinero', 'Cash drawer')}
        </p>
      </div>
      {phase === 'idle' && (
        <>
          <p className="text-[12px] text-zinc-400 mb-3">
            {L('¿Tienes gaveta conectada? Toca para que abra automáticamente al cobrar.',
               'Have a drawer connected? Tap to auto-configure it for cobro.')}
          </p>
          <div className="flex gap-2">
            <button onClick={start}
              className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-bold rounded-lg transition-colors">
              {L('Detectar ahora', 'Detect now')}
            </button>
            <button onClick={() => setPhase('skipped')}
              className="px-3 py-2 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-[12px] rounded-lg">
              {L('Saltar', 'Skip')}
            </button>
          </div>
        </>
      )}
      {phase === 'running' && (
        <>
          <p className="text-[12px] text-amber-300 mb-3">
            {L(`Probando… cuando la gaveta abra, toca "¡Se abrió!"`,
               `Testing… when the drawer pops, tap "It opened!"`)}
            {currentIdx !== null && <span className="ml-1 text-zinc-500">({currentIdx + 1})</span>}
          </p>
          <div className="flex gap-2">
            <button onClick={confirm}
              className="flex-1 py-2 bg-green-500 hover:bg-green-400 text-white text-[13px] font-bold rounded-lg animate-pulse">
              {L('¡Se abrió!', 'It opened!')}
            </button>
            <button onClick={cancel}
              className="px-3 py-2 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-[12px] rounded-lg">
              {L('Parar', 'Stop')}
            </button>
          </div>
        </>
      )}
      {phase === 'saved' && (
        <p className="text-[12px] text-green-400 flex items-center gap-1.5">
          <CheckCircle2 size={13} />
          {L('Gaveta configurada y guardada ✓', 'Drawer configured and saved ✓')}
        </p>
      )}
      {phase === 'skipped' && (
        <p className="text-[11px] text-zinc-500">
          {L('Puedes configurarla luego en Configuración → Impresora.',
             'You can configure it later in Settings → Printer.')}
        </p>
      )}
    </div>
  )
}

// ── Step 5 — Done ─────────────────────────────────────────────────────────────
function StepDone({ t, empresaNombre, onComplete, lang }) {
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

        <StepDoneDrawerPanel lang={lang} />

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
    // v2.16.28 (B5) — write to BOTH the legacy `configuracion` blob (so
    // older readers that haven't been migrated still see it) AND the
    // canonical `app_settings` KV that OnboardingChecklist + the
    // OnboardingWizard read from. The wizard re-fired on every fresh
    // device login because only the legacy table got the value while
    // every reader had been ported to KV. Belt-and-suspenders writes
    // here close the gap; the legacy write can drop in v2.17 once we
    // confirm no downstream still reads from `configuracion`.
    try {
      await Promise.all([
        api?.admin?.saveConfiguracion?.({ setup_complete: '1' }),
        api?.settings?.update?.({ setup_complete: '1' }),
      ])
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
          <StepWelcome t={t} onNext={() => setStep(1)} onReconnect={() => setStep('reconnect')} />
        )}

        {step === 'reconnect' && (
          <StepReconnect t={t} onBack={() => setStep(0)} onComplete={markSetupComplete} />
        )}

        {step === 1 && (
          <StepEmpresa
            t={t}
            lang={lang}
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
            lang={lang}
            empresaNombre={empresaNombre}
            onComplete={markSetupComplete}
          />
        )}
      </div>
    </div>
  )
}
