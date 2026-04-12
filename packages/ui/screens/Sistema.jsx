import { useState, useEffect, useRef } from 'react'
import {
  Settings, KeyRound, CheckCircle2, Loader2, AlertCircle, Printer,
  RefreshCw, Download, ArrowDownToLine, FileText, HardDrive,
} from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI, usePrinterAPI } from '../context/DataContext'
// LicenseAdmin removed — was dead code (API key auth incompatible with Supabase JWT backend).
// Real admin panel: terminalxpos.com/admin

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState(null)
  function show(msg, type = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return { toast, show }
}

function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-xl text-[13px] font-semibold ${
      toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-slate-800 dark:bg-white/10 text-white'
    }`}>
      {toast.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
      {toast.msg}
    </div>
  )
}

function Toggle({ enabled, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      aria-pressed={enabled}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${enabled ? 'bg-sky-500' : 'bg-slate-200 dark:bg-white/10'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
        enabled ? 'translate-x-4' : 'translate-x-0'
      }`} />
    </button>
  )
}

function SettingRow({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-[13px] font-semibold text-slate-700 dark:text-white">{label}</p>
        {hint && <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingSection({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">{title}</p>
      <div className="border border-slate-200 dark:border-white/10 rounded-xl px-4 divide-y divide-slate-100 dark:divide-white/10">
        {children}
      </div>
    </div>
  )
}

function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full px-2.5 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5
        focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20 placeholder:text-slate-300 dark:placeholder:text-white/40 ${className}`}
    />
  )
}

function SaveBtn({ saving, saved, label, onClick }) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const lbl = label ?? L('Guardar', 'Save')
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="flex items-center gap-1.5 px-4 py-2 bg-[#0C447C] hover:bg-[#0a3a6a] disabled:opacity-50
        text-white text-[12px] font-bold rounded-lg transition-colors"
    >
      {saving ? <><Loader2 size={12} className="animate-spin" /> {L('Guardando…', 'Saving…')}</>
              : saved  ? <><CheckCircle2 size={12} /> {L('Guardado', 'Saved')}</>
              : lbl}
    </button>
  )
}

// ── Configuración (System Settings) ──────────────────────────────────────────

const SISTEMA_DEFAULTS = {
  ley_enabled:          '1',
  itbis_pct:            '18',
  usd_rate:             '61.00',
  rnc_verify:           '1',
  sucursales:           '0',
  auto_backup:          '0',
  printer:              '',
  print_preticket:      '0',
  print_factura_auto:   '0',
  print_conduce_auto:   '0',
  whatsapp_instance:    '',
  whatsapp_token:       '',
}

// Shared settings hook — loads cfg from DB once, provides set/save
function useSettings() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { lang } = useLang()
  const { toast, show } = useToast()
  const [cfg, setCfg] = useState(SISTEMA_DEFAULTS)
  const [printers, setPrinters] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.settings.get().then(s => {
      if (!s) return
      setCfg(prev => ({ ...prev, ...Object.fromEntries(Object.keys(SISTEMA_DEFAULTS).filter(k => s[k] != null).map(k => [k, s[k]])) }))
    }).catch(() => {})
    printerApi?.listPrinters().then(res => {
      if (res?.ok && Array.isArray(res.data)) setPrinters(res.data)
    }).catch(() => {})
  }, [])

  function set(k, v) { setCfg(c => ({ ...c, [k]: v })) }
  const on = k => cfg[k] === '1'

  async function handleSave() {
    setSaving(true)
    try {
      await api.settings.update(cfg)
      setSaved(true)
      show(lang === 'es' ? 'Guardado' : 'Saved')
      setTimeout(() => setSaved(false), 2500)
    } catch { show(lang === 'es' ? 'Error al guardar' : 'Error saving', 'error') }
    finally { setSaving(false) }
  }

  return { cfg, set, on, handleSave, saving, saved, printers, toast, show, api, printerApi }
}

// ── Preferencias (General settings: language, taxes, POS toggles, printing) ──

export function Preferencias() {
  const { cfg, set, on, handleSave, saving, saved, printers, toast, show, printerApi } = useSettings()
  const { lang, setLang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  async function testPrint() {
    // Build a minimal ESC/POS test receipt. Must be a binary string, not an
    // object — the IPC handler writes it raw to the printer spooler.
    const ESC = '\x1B', GS = '\x1D', LF = '\x0A'
    const INIT         = ESC + '@'
    const ALIGN_CENTER = ESC + 'a' + '\x01'
    const ALIGN_LEFT   = ESC + 'a' + '\x00'
    const BOLD_ON      = ESC + 'E' + '\x01'
    const BOLD_OFF     = ESC + 'E' + '\x00'
    const DOUBLE_ON    = GS  + '!' + '\x11'
    const DOUBLE_OFF   = GS  + '!' + '\x00'
    const CUT          = GS  + 'V' + '\x41' + '\x03'
    const now = new Date().toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const buf =
      INIT +
      ALIGN_CENTER + BOLD_ON + DOUBLE_ON +
      'TERMINAL X' + LF +
      DOUBLE_OFF + BOLD_OFF + LF +
      'PRUEBA DE IMPRESION' + LF +
      '--------------------' + LF +
      ALIGN_LEFT +
      'Fecha: ' + now + LF +
      'Impresora: ' + (cfg.printer || '(predeterminada)').slice(0, 32) + LF +
      LF +
      'Si puedes leer esto,' + LF +
      'la impresora funciona.' + LF +
      LF + LF + LF +
      CUT

    try {
      if (!printerApi?.print) {
        show(L('API de impresion no disponible', 'Print API not available'), 'error')
        return
      }
      const result = await printerApi.print({ data: buf, printerName: cfg.printer || undefined })
      if (result?.success) {
        show(L('Prueba enviada ✓', 'Test sent ✓'))
      } else {
        show(L('Error: ', 'Error: ') + (result?.error || 'desconocido'), 'error')
      }
    } catch (e) {
      show(L('Error al imprimir: ', 'Print error: ') + (e?.message || ''), 'error')
    }
  }

  return (
    <div className="max-w-2xl">
      <Toast toast={toast} />
      <SettingSection title={L('Idioma', 'Language')}>
        <SettingRow label={L('Idioma / Language', 'Language / Idioma')} hint={L('Cambia el idioma de toda la app', 'Changes app language')}>
          <div className="flex gap-2">
            <button onClick={() => setLang('es')} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-colors ${lang === 'es' ? 'bg-[#0C447C] border-[#0C447C] text-white' : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:border-slate-400'}`}>ES</button>
            <button onClick={() => setLang('en')} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-colors ${lang === 'en' ? 'bg-[#0C447C] border-[#0C447C] text-white' : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:border-slate-400'}`}>EN</button>
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title={L('Impuestos y Cargos', 'Taxes & Charges')}>
        <SettingRow label="Ley 10%" hint={L('Cargo de servicio en facturas', 'Service charge on invoices')}>
          <Toggle enabled={on('ley_enabled')} onChange={v => set('ley_enabled', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label="ITBIS %" hint={L('Porcentaje del impuesto (defecto: 18)', 'Tax rate (default: 18)')}>
          <Input type="number" min="0" max="100" value={cfg.itbis_pct} onChange={e => set('itbis_pct', e.target.value)} className="w-20 text-center" />
        </SettingRow>
        <SettingRow label={L('Tasa USD', 'USD Rate')} hint="RD$ por USD">
          <Input type="number" min="0" step="0.01" value={cfg.usd_rate} onChange={e => set('usd_rate', e.target.value)} className="w-24 text-center" />
        </SettingRow>
        <SettingRow label={L('Verificar RNC', 'Verify RNC')} hint={L('Valida RNC contra DGII', 'Validates RNC against DGII')}>
          <Toggle enabled={on('rnc_verify')} onChange={v => set('rnc_verify', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={L('Impresora', 'Printer')}>
        <SettingRow label={L('Impresora del sistema', 'System Printer')} hint={L('Impresora configurada en el OS', 'OS-configured printer')}>
          <div className="flex items-center gap-2">
            <select value={cfg.printer} onChange={e => set('printer', e.target.value)}
              className="border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 max-w-[220px]">
              <option value="">{L('Predeterminada', 'Default')}</option>
              {printers.map(p => <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' *' : ''}</option>)}
            </select>
            <button onClick={testPrint} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-white/10 rounded-lg text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 whitespace-nowrap">
              <Printer size={12} />{L('Prueba', 'Test')}
            </button>
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title={L('Impresion Automatica', 'Auto Print')}>
        <SettingRow label={L('Pre-Ticket', 'Pre-Ticket')} hint={L('Al agregar vehiculo a cola', 'When adding vehicle to queue')}>
          <Toggle enabled={on('print_preticket')} onChange={v => set('print_preticket', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label={L('Factura', 'Invoice')} hint={L('Al confirmar cobro', 'On payment')}>
          <Toggle enabled={on('print_factura_auto')} onChange={v => set('print_factura_auto', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label={L('Conduce', 'Delivery Note')} hint={L('Al confirmar cobro', 'On payment')}>
          <Toggle enabled={on('print_conduce_auto')} onChange={v => set('print_conduce_auto', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      <div className="flex justify-end mt-2">
        <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
      </div>
    </div>
  )
}

// ── Impresion (Printing settings only) ────────────────────────────────────

export function ImpresionSettings() {
  const { cfg, set, on, handleSave, saving, saved, printers, toast, show, printerApi } = useSettings()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  async function testPrint() {
    const ESC = '\x1B', GS = '\x1D', LF = '\x0A'
    const now = new Date().toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const buf =
      ESC + '@' +
      ESC + 'a' + '\x01' + ESC + 'E' + '\x01' + GS + '!' + '\x11' +
      'TERMINAL X' + LF +
      GS + '!' + '\x00' + ESC + 'E' + '\x00' + LF +
      'PRUEBA DE IMPRESION' + LF +
      '--------------------' + LF +
      ESC + 'a' + '\x00' +
      'Fecha: ' + now + LF +
      'Impresora: ' + (cfg.printer || '(predeterminada)').slice(0, 32) + LF +
      LF +
      'Si puedes leer esto,' + LF +
      'la impresora funciona.' + LF +
      LF + LF + LF +
      GS + 'V' + '\x41' + '\x03'
    try {
      if (!printerApi?.print) {
        show(L('API de impresion no disponible', 'Print API not available'), 'error')
        return
      }
      const result = await printerApi.print({ data: buf, printerName: cfg.printer || undefined })
      if (result?.success) show(L('Prueba enviada ✓', 'Test sent ✓'))
      else show(L('Error: ', 'Error: ') + (result?.error || 'desconocido'), 'error')
    } catch (e) {
      show(L('Error al imprimir: ', 'Print error: ') + (e?.message || ''), 'error')
    }
  }

  return (
    <div className="max-w-2xl">
      <Toast toast={toast} />
      <SettingSection title={L('Impresora', 'Printer')}>
        <SettingRow label={L('Impresora del sistema', 'System Printer')} hint={L('Impresora configurada en el OS', 'OS-configured printer')}>
          <div className="flex items-center gap-2">
            <select value={cfg.printer} onChange={e => set('printer', e.target.value)}
              className="border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 max-w-[220px]">
              <option value="">{L('Predeterminada', 'Default')}</option>
              {printers.map(p => <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' *' : ''}</option>)}
            </select>
            <button onClick={testPrint} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-white/10 rounded-lg text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 whitespace-nowrap">
              <Printer size={12} />{L('Prueba', 'Test')}
            </button>
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title={L('Impresion Automatica', 'Auto Print')}>
        <SettingRow label={L('Pre-Ticket', 'Pre-Ticket')} hint={L('Al agregar vehiculo a cola', 'When adding vehicle to queue')}>
          <Toggle enabled={on('print_preticket')} onChange={v => set('print_preticket', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label={L('Factura', 'Invoice')} hint={L('Al confirmar cobro', 'On payment')}>
          <Toggle enabled={on('print_factura_auto')} onChange={v => set('print_factura_auto', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label={L('Conduce', 'Delivery Note')} hint={L('Al confirmar cobro', 'On payment')}>
          <Toggle enabled={on('print_conduce_auto')} onChange={v => set('print_conduce_auto', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      <div className="flex justify-end mt-2">
        <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
      </div>
    </div>
  )
}

// ── WhatsApp settings only ────────────────────────────────────────────────

export function WhatsAppSettings() {
  const { cfg, set, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="max-w-2xl">
      <Toast toast={toast} />
      <SettingSection title="WhatsApp (UltraMsg)">
        <SettingRow label="Instance ID" hint={L('ID de instancia UltraMsg', 'UltraMsg instance ID')}>
          <Input type="text" value={cfg.whatsapp_instance} onChange={e => set('whatsapp_instance', e.target.value)} placeholder="instance166620" className="w-44" />
        </SettingRow>
        <SettingRow label="Token" hint={L('Token de autenticacion', 'Auth token')}>
          <Input type="text" value={cfg.whatsapp_token} onChange={e => set('whatsapp_token', e.target.value)} placeholder="token..." className="w-44" />
        </SettingRow>
      </SettingSection>
      <div className="flex justify-end mt-2">
        <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
      </div>
    </div>
  )
}

// Legacy combined view (used when Sistema is rendered directly via /sistema)
function Configuracion() {
  return (
    <div className="space-y-6">
      <Preferencias />
    </div>
  )
}

// ── Actualizaciones ────────────────────────────────────────────────────────────

function Actualizaciones() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [version,  setVersion]  = useState('—')
  const [status,   setStatus]   = useState('idle')   // idle | checking | up-to-date | available | downloading | downloaded | error
  const [progress, setProgress] = useState(0)
  const [info,     setInfo]     = useState(null)      // { version } or error string
  const unsubRef = useRef(null)

  useEffect(() => {
    if (!api?.version) return
    api.version().then(v => setVersion(v)).catch(() => {})

    if (!api?.updater?.onStatus) return
    const unsub = api.updater.onStatus((event, data) => {
      if (event === 'checking')   { setStatus('checking');   setInfo(null) }
      if (event === 'up-to-date') { setStatus('up-to-date'); setInfo(null) }
      if (event === 'available')  { setStatus('available');  setInfo(data) }
      if (event === 'progress')   { setStatus('downloading'); setProgress(data ?? 0) }
      if (event === 'downloaded') { setStatus('downloaded'); setInfo(data) }
      if (event === 'error')      { setStatus('error');      setInfo(data) }
    })
    unsubRef.current = unsub
    return () => { if (typeof unsubRef.current === 'function') unsubRef.current() }
  }, [])

  function handleInstall() {
    api.updater.install()
  }

  async function handleCheckNow() {
    if (!api?.updater?.check) return
    setStatus('checking')
    setInfo(null)
    const res = await api.updater.check().catch(() => ({ error: 'failed' }))
    if (res?.error === 'dev-mode') {
      setStatus('error')
      setInfo(L('No disponible en modo desarrollo', 'Not available in dev mode'))
    }
  }

  const statusMap = {
    idle:        { color: 'text-slate-400', label: L('Sin verificar', 'Not checked') },
    checking:    { color: 'text-sky-500',   label: L('Verificando…', 'Checking…') },
    'up-to-date':{ color: 'text-emerald-600', label: L('Terminal X está al día', 'Terminal X is up to date') },
    available:   { color: 'text-amber-600', label: L('Actualización disponible', 'Update available') },
    downloading: { color: 'text-sky-500',   label: L(`Descargando… ${progress}%`, `Downloading… ${progress}%`) },
    downloaded:  { color: 'text-emerald-600', label: L('Lista para instalar', 'Ready to install') },
    error:       { color: 'text-red-500',   label: L('Error al verificar', 'Update check failed') },
  }

  const s = statusMap[status] ?? statusMap.idle

  return (
    <div className="max-w-2xl">
      {/* Current version card */}
      <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 mb-5 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
            {L('Versión instalada', 'Installed version')}
          </p>
          <p className="text-[22px] font-bold text-slate-800 dark:text-white font-mono">v{version}</p>
          <p className="text-[12px] text-slate-500 dark:text-white/60 mt-0.5">Terminal X · Studio X Tech</p>
        </div>
        <div className="text-right">
          <p className={`text-[12px] font-semibold ${s.color}`}>{s.label}</p>
          {info?.version && (
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
              {L('Nueva versión', 'New version')}: v{info.version}
            </p>
          )}
          {status === 'error' && info && (
            <p className="text-[11px] text-red-400 mt-0.5 max-w-[200px]">{info}</p>
          )}
        </div>
      </div>

      {/* Progress bar while downloading */}
      {status === 'downloading' && (
        <div className="mb-5">
          <div className="flex justify-between text-[11px] text-slate-500 dark:text-white/60 mb-1.5">
            <span>{L('Descargando actualización…', 'Downloading update…')}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-2 bg-sky-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 items-center">
        {status === 'downloaded' ? (
          <button
            onClick={handleInstall}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold rounded-lg transition-colors"
          >
            <ArrowDownToLine size={14} />
            {L('Instalar y reiniciar', 'Install & restart')}
          </button>
        ) : (
          <>
            <button
              onClick={handleCheckNow}
              disabled={status === 'checking' || status === 'downloading'}
              className="flex items-center gap-2 px-4 py-2.5 bg-black hover:bg-black/80 disabled:opacity-50 text-white text-[13px] font-bold rounded-lg transition-colors"
            >
              <RefreshCw size={14} className={status === 'checking' ? 'animate-spin' : ''} />
              {status === 'checking'
                ? L('Verificando…', 'Checking…')
                : L('Buscar actualizaciones', 'Check for updates')}
            </button>
            {status === 'downloading' && (
              <p className="text-[12px] text-slate-400 dark:text-white/40 italic">
                {L('Descargando…', 'Downloading…')}
              </p>
            )}
          </>
        )}
      </div>

      {/* Release notes placeholder */}
      {(status === 'available' || status === 'downloaded') && info?.version && (
        <div className="mt-5 border border-amber-200 bg-amber-50 rounded-xl p-4">
          <p className="text-[12px] font-bold text-amber-800 mb-1">
            {L('Novedades en', 'What\'s new in')} v{info.version}
          </p>
          <p className="text-[12px] text-amber-700">
            {status === 'downloaded'
              ? L('La actualización está lista. Haz clic en "Instalar y reiniciar" para aplicarla.', 'The update is ready. Click "Install & restart" to apply it.')
              : L('Descargando en segundo plano…', 'Downloading in the background…')}
          </p>
        </div>
      )}

      {/* How updates work */}
      <div className="mt-6 border-t border-slate-100 dark:border-white/10 pt-5">
        <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-3">
          {L('Cómo funcionan las actualizaciones', 'How updates work')}
        </p>
        <ul className="space-y-2">
          {[
            L('Terminal X verifica actualizaciones automáticamente al iniciar.', 'Terminal X checks for updates automatically on startup.'),
            L('Las actualizaciones se descargan en segundo plano sin interrumpir el trabajo.', 'Updates download in the background without interrupting your work.'),
            L('Cuando la descarga termine, aparecerá el botón "Instalar y reiniciar".', 'When the download finishes, the "Install & restart" button will appear.'),
            L('La instalación tarda menos de 30 segundos.', 'Installation takes less than 30 seconds.'),
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-slate-500 dark:text-white/60">
              <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-white/40 text-[10px] font-bold flex items-center justify-center">
                {i + 1}
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ── MAIN SISTEMA SCREEN ───────────────────────────────────────────────────────

// Actualizaciones is desktop-only (Electron auto-updater). Hidden on web/mobile.
const isDesktop = typeof window !== 'undefined' && !!window.electronAPI
const TABS = [
  { id: 'config', es: 'Preferencias', en: 'Preferences', icon: Settings },
  ...(isDesktop ? [{ id: 'actualizaciones', es: 'Actualizaciones', en: 'Updates', icon: Download }] : []),
]

export default function Sistema({ initialTab, hideHeader }) {
  const { lang } = useLang()
  const [tab, setTab] = useState(initialTab || 'config')

  useEffect(() => {
    if (initialTab && initialTab !== tab) setTab(initialTab)
  }, [initialTab])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      {!hideHeader && (
        <>
          {/* Header */}
          <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 border-b border-slate-200 dark:border-white/10">
            <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
              {lang === 'es' ? 'Sistema' : 'System'}
            </h2>
            <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5">
              {lang === 'es' ? 'Configuración del sistema y gestión de licencias' : 'System settings and license management'}
            </p>
          </div>

          {/* Tabs */}
          <div className="shrink-0 flex border-b border-slate-200 dark:border-white/10 px-2 md:px-6 overflow-x-auto scrollbar-none">
            {TABS.map(({ id, es, en, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 md:px-4 py-3 text-xs md:text-[13px] font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap ${
                  tab === id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white'
                }`}>
                <Icon size={14} />
                {lang === 'es' ? es : en}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Content */}
      {tab === 'config' && (
        <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6">
          <Configuracion />
        </div>
      )}
      {tab === 'actualizaciones' && (
        <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6">
          <Actualizaciones />
        </div>
      )}
      {/* LicenseAdmin tab removed — dead code. Admin panel is at terminalxpos.com/admin */}
    </div>
  )
}
