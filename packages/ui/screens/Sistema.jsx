import { useState, useEffect, useRef } from 'react'
import {
  Settings, KeyRound, CheckCircle2, Loader2, AlertCircle, Printer,
  RefreshCw, Download, ArrowDownToLine, FileText, HardDrive,
  Activity, XCircle, AlertTriangle, ChevronDown, Clock, Wifi, Shield, Globe2, Cloud,
  Laptop,
} from 'lucide-react'
import { isDeviceSetting } from '@terminal-x/services/settingsWhitelist'
import { useLang } from '../i18n'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import { hasVehicles } from '@terminal-x/config/businessTypes'
import { usePlan } from '../hooks/usePlan.jsx'
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

function SettingRow({ label, hint, children, settingKey }) {
  // Auto-hint when the key is whitelisted as device-local (printer, print_*, etc.)
  // Keeps the UI honest: Mike and clients see at a glance what's cloud-synced
  // vs what lives on this POS only.
  const deviceOnly = settingKey ? isDeviceSetting(settingKey) : false
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 pr-4">
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] font-semibold text-slate-700 dark:text-white">{label}</p>
          {deviceOnly && (
            <span
              title="Este dispositivo / This device only"
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-white/50 bg-slate-100 dark:bg-white/10"
            >
              <Laptop size={10} />
              <span>Solo este dispositivo</span>
            </span>
          )}
        </div>
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

// ── Drawer tester (numbered variant picker) ──────────────────────────────────
// Five numbered buttons fire each ESC/POS drawer-kick variant. The one that
// actually opens the drawer stays highlighted + updates the pending settings;
// the page-wide Guardar at the bottom of Preferencias persists it.
function DrawerTester({ printerApi, cfg, set, persistKey, show, L }) {
  const [selected, setSelected] = useState(null)   // 0..N-1 — highlighted variant
  const [total,    setTotal]    = useState(8)      // confirmed on first fire via IPC response
  const [autoIdx,  setAutoIdx]  = useState(null)   // null | 0..total-1 — current probe position
  const [autoHex,  setAutoHex]  = useState(null)   // hex of the variant firing RIGHT NOW (for Se Abrio callback)
  const autoRef = useRef({ cancelled: false, timer: null })

  async function abrirCaja() {
    try {
      const r = await printerApi?.openDrawer?.()
      if (r?.success || r === true) show(L('Pulso enviado ✓', 'Pulse sent ✓'))
      else show(L('Sin respuesta. Revisa conexion RJ11 impresora → gaveta.', 'No response. Check RJ11 cable printer → drawer.'), 'error')
    } catch (e) { show(L('Error: ', 'Error: ') + (e?.message || ''), 'error') }
  }

  async function fireVariant(idx) {
    setSelected(idx)
    try {
      const r = await printerApi?.fireDrawerVariant?.(idx, cfg.printer || undefined)
      if (r?.total) setTotal(r.total)
      if (r?.hex) set('drawer_pulse_hex', r.hex) // stage for the page-wide Guardar
      if (!r?.success) show(L('Error: ', 'Error: ') + (r?.error || 'desconocido'), 'error')
      return r
    } catch (e) { show(L('Error: ', 'Error: ') + (e?.message || ''), 'error'); return null }
  }

  async function startAutoDetect() {
    autoRef.current = { cancelled: false, timer: null }
    for (let i = 0; i < total; i++) {
      if (autoRef.current.cancelled) return
      setAutoIdx(i)
      try {
        const r = await printerApi?.fireDrawerVariant?.(i, cfg.printer || undefined)
        if (r?.total) setTotal(r.total)
        setAutoHex(r?.hex || null)
        // During this 1.6s window, if the cashier clicks "Se abrió" the current
        // autoHex is captured and saved.
      } catch {}
      await new Promise(res => { autoRef.current.timer = setTimeout(res, 1600) })
    }
    if (!autoRef.current.cancelled) {
      setAutoIdx(null); setAutoHex(null)
      show(L('Ninguna variante abrió. Revisa cable RJ11 + posición de la llave de la gaveta.', 'No variant opened. Check RJ11 cable + drawer key position.'), 'error')
    }
  }

  async function confirmAutoOpened() {
    if (autoHex) {
      setSelected(autoIdx)
      // Auto-detect persists immediately — no second Guardar click needed.
      await persistKey('drawer_pulse_hex', autoHex)
      show(L(`Variante ${autoIdx + 1} guardada ✓`, `Variant ${autoIdx + 1} saved ✓`))
    }
    stopAutoDetect()
  }

  function stopAutoDetect() {
    autoRef.current.cancelled = true
    if (autoRef.current.timer) clearTimeout(autoRef.current.timer)
    setAutoIdx(null); setAutoHex(null)
  }

  const savedHex = cfg.drawer_pulse_hex || null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={abrirCaja}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-white/10 rounded-lg text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 whitespace-nowrap">
          {L('Abrir Caja', 'Open Drawer')}
        </button>
        {autoIdx === null ? (
          <button onClick={startAutoDetect}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 rounded-lg text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/20 whitespace-nowrap">
            {L('Detección Automática', 'Auto Detect')}
          </button>
        ) : (
          <>
            <button onClick={confirmAutoOpened}
              className="px-3 py-1.5 text-[11px] font-bold bg-green-500 hover:bg-green-600 text-white rounded-lg animate-pulse">
              {L('¡Se abrió!', 'It opened!')}
            </button>
            <button onClick={stopAutoDetect}
              className="px-2 py-1.5 text-[11px] text-slate-400 hover:text-slate-600">
              {L('Parar', 'Stop')}
            </button>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-slate-400 dark:text-white/40">{L('Variantes:', 'Variants:')}</span>
        {[[0, 5], [5, total]].map(([start, end], rowIdx) => (
          end > start && (
            <div key={rowIdx} className="flex items-center gap-1.5">
              {Array.from({ length: end - start }, (_, j) => {
                const i = start + j
                return (
                  <button key={i} onClick={() => fireVariant(i)} disabled={autoIdx !== null}
                    className={`w-8 h-8 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40 ${
                      (autoIdx === i)
                        ? 'bg-amber-500 text-white border-2 border-amber-500 animate-pulse'
                        : selected === i
                          ? 'bg-[#b3001e] text-white border-2 border-[#b3001e] shadow-sm'
                          : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
                    }`}>
                    {i + 1}
                  </button>
                )
              })}
            </div>
          )
        ))}
      </div>
      {autoIdx !== null && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          {L(`Probando variante ${autoIdx + 1} de ${total}… haz clic en "¡Se abrió!" cuando la caja abra.`, `Testing variant ${autoIdx + 1} of ${total}… click "It opened!" the moment the drawer pops.`)}
        </p>
      )}
      {savedHex && autoIdx === null && <p className="text-[10px] text-slate-400 dark:text-white/40">{L('Variante activa:', 'Active variant:')} <span className="font-mono">{savedHex}</span> — {L('recuerda Guardar abajo', 'remember to Save below')}</p>}
    </div>
  )
}

// ── Configuración (System Settings) ──────────────────────────────────────────

const SISTEMA_DEFAULTS = {
  ley_enabled:          '1',
  itbis_pct:            '18',
  usd_rate:             '61.00',
  rnc_verify:           '1',
  sucursales:           '0',
  printer:              '',
  print_preticket:      '0',
  print_factura_auto:   '0',
  print_conduce_auto:   '0',
  drawer_pulse_hex:     '',
  whatsapp_instance:    '',
  whatsapp_token:       '',
  wa_listo_template:    '',
  wa_balance_template:  '',
  biz_bank_accounts:    '',
  // v2.3 — Multi-POS (NCF/doc_number block allocation, oversell detection).
  // OFF by default; Pro MAX only. See docs/MULTI-POS-ARCHITECTURE.md.
  multi_pos_enabled:    '0',
  ncf_block_size:       '500',
  doc_block_size:       '200',
  // Go-live date (YYYY-MM-DD). Empty = disabled. When set, the Dashboard
  // Remoto shows a "Solo go-live" toggle that filters out imported historical
  // tickets (created before this date).
  go_live_date:         '',
  // v2.7.1 — daily owner digest (Pro MAX). OFF by default.
  daily_digest_enabled: '0',
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
  const { cfg, set, on, handleSave, saving, saved, printers, toast, show, printerApi, api } = useSettings()
  const { lang, setLang } = useLang()
  const { businessType } = useBusinessType()
  const { plan, hasFeature } = usePlan()
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const showPreTicket = hasVehicles(businessType)
  const multiPosAllowed = plan === 'pro_max' || hasFeature?.('multi_pos')
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

      <SettingSection title={L('Autorización de Gerente', 'Manager Authorization')}>
        <div className="text-[11px] text-slate-500 dark:text-white/60 mb-2">
          {L(
            'Exige tarjeta de autorización (o PIN de emergencia) para acciones sensibles. El gerente escanea su tarjeta; el cajero nunca ve el token.',
            'Require an authorization card (or emergency PIN) for sensitive actions. The manager scans the card; the cashier never sees the token.',
          )}
        </div>
        <SettingRow label={L('Descuentos grandes', 'Large discounts')} hint={L('> RD$500 o > 15% del total', '> RD$500 or > 15% of total')}>
          <Toggle enabled={String(cfg.mgr_gate_enabled_discount_big ?? '1') === '1'} onChange={v => set('mgr_gate_enabled_discount_big', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label={L('Anulación de factura', 'Invoice void')}>
          <Toggle enabled={String(cfg.mgr_gate_enabled_void ?? '1') === '1'} onChange={v => set('mgr_gate_enabled_void', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label={L('Nota de crédito', 'Credit note')}>
          <Toggle enabled={String(cfg.mgr_gate_enabled_credit_note ?? '1') === '1'} onChange={v => set('mgr_gate_enabled_credit_note', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label={L('Ajuste de inventario', 'Inventory adjustment')}>
          <Toggle enabled={String(cfg.mgr_gate_enabled_inv_adjust ?? '1') === '1'} onChange={v => set('mgr_gate_enabled_inv_adjust', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow label={L('Edición de precio en POS', 'Price edit in POS')} hint={L('Disponible en v2.6.1', 'Available in v2.6.1')}>
          <Toggle enabled={String(cfg.mgr_gate_enabled_price_edit ?? '1') === '1'} onChange={v => set('mgr_gate_enabled_price_edit', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      {hasFeature?.('loyalty') && (
        <SettingSection title={L('Programa de Lealtad', 'Loyalty Program')}>
          <SettingRow
            label={L('Activar programa', 'Enable program')}
            hint={L('Acumula puntos por compra y permite canjear en cobro', 'Earn points per sale and redeem at checkout')}
          >
            <Toggle enabled={on('loyalty_enabled')} onChange={v => set('loyalty_enabled', v ? '1' : '0')} />
          </SettingRow>
          {on('loyalty_enabled') && (
            <>
              <SettingRow
                label={L('RD$ por 1 punto', 'RD$ per 1 point')}
                hint={L('Cuánto gasta el cliente para ganar 1 punto (defecto: 100)', 'How much client spends to earn 1 point (default: 100)')}
              >
                <Input type="number" min="1" max="100000" step="1"
                  value={cfg.loyalty_points_ratio ?? '100'}
                  onChange={e => set('loyalty_points_ratio', e.target.value)}
                  className="w-24 text-center" />
              </SettingRow>
              <SettingRow
                label={L('Puntos por RD$1 de descuento', 'Points per RD$1 off')}
                hint={L('Canje: 2 = 100 pts dan RD$50 (defecto)', 'Redeem: 2 = 100 pts = RD$50 off (default)')}
              >
                <Input type="number" min="0.1" max="100" step="0.1"
                  value={cfg.loyalty_redemption_ratio ?? '2'}
                  onChange={e => set('loyalty_redemption_ratio', e.target.value)}
                  className="w-24 text-center" />
              </SettingRow>
              <SettingRow label={L('Umbral Silver (pts)', 'Silver threshold (pts)')}>
                <Input type="number" min="0" step="100"
                  value={cfg.loyalty_tier_silver ?? '1000'}
                  onChange={e => set('loyalty_tier_silver', e.target.value)}
                  className="w-28 text-center" />
              </SettingRow>
              <SettingRow label={L('Umbral Gold (pts)', 'Gold threshold (pts)')}>
                <Input type="number" min="0" step="100"
                  value={cfg.loyalty_tier_gold ?? '5000'}
                  onChange={e => set('loyalty_tier_gold', e.target.value)}
                  className="w-28 text-center" />
              </SettingRow>
              <SettingRow label={L('Umbral Platinum (pts)', 'Platinum threshold (pts)')}>
                <Input type="number" min="0" step="100"
                  value={cfg.loyalty_tier_platinum ?? '10000'}
                  onChange={e => set('loyalty_tier_platinum', e.target.value)}
                  className="w-28 text-center" />
              </SettingRow>
            </>
          )}
        </SettingSection>
      )}

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

      {isOwner && (
        <SettingSection title={L('Fecha de Go-Live', 'Go-Live Date')}>
          <SettingRow
            label={L('Fecha de inicio operativo', 'Operational start date')}
            hint={L(
              'Filtra tickets historicos importados en el Dashboard Remoto. Dejar vacio para ver todo.',
              'Filters imported historical tickets in Remote Dashboard. Leave empty to see all.'
            )}
          >
            <input
              type="date"
              value={cfg.go_live_date || ''}
              onChange={e => set('go_live_date', e.target.value)}
              className="border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-[#b3001e]"
            />
          </SettingRow>
        </SettingSection>
      )}

      <SettingSection title={L('Impresora', 'Printer')}>
        <SettingRow settingKey="printer" label={L('Impresora del sistema', 'System Printer')} hint={L('Impresora configurada en el OS', 'OS-configured printer')}>
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
        <SettingRow label={L('Probar Gaveta de Dinero', 'Test Cash Drawer')} hint={L('Envia pulso al cajon. Prueba si no abre al cobrar.', 'Sends pulse to drawer. Use if it does not open on cobro.')}>
          <DrawerTester printerApi={printerApi} cfg={cfg} set={set} persistKey={async (k, v) => { set(k, v); try { await api.settings.update({ [k]: v }) } catch {} }} show={show} L={L} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={L('Impresion Automatica', 'Auto Print')}>
        {showPreTicket && (
          <SettingRow settingKey="print_preticket" label={L('Pre-Ticket', 'Pre-Ticket')} hint={L('Al agregar vehiculo a cola', 'When adding vehicle to queue')}>
            <Toggle enabled={on('print_preticket')} onChange={v => set('print_preticket', v ? '1' : '0')} />
          </SettingRow>
        )}
        <SettingRow settingKey="print_factura_auto" label={L('Factura', 'Invoice')} hint={L('Al confirmar cobro', 'On payment')}>
          <Toggle enabled={on('print_factura_auto')} onChange={v => set('print_factura_auto', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow settingKey="print_conduce_auto" label={L('Conduce', 'Delivery Note')} hint={showPreTicket ? L('Al confirmar cobro', 'On payment') : L('Copia para control de inventario', 'Copy for inventory check')}>
          <Toggle enabled={on('print_conduce_auto')} onChange={v => set('print_conduce_auto', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={L('Resumen Diario del Dueño', 'Owner Daily Digest')}>
        <SettingRow
          settingKey="daily_digest_enabled"
          label={L('Resumen diario', 'Daily digest')}
          hint={hasFeature?.('remote_dashboard')
            ? L('Recibe cada mañana a las 9 AM un resumen del día anterior (ventas, top 3 productos, alertas).',
                'Every morning at 9 AM get yesterday\'s recap (sales, top 3 products, alerts).')
            : L('Requiere plan Pro MAX', 'Requires Pro MAX plan')}
        >
          <Toggle
            enabled={on('daily_digest_enabled')}
            onChange={v => hasFeature?.('remote_dashboard') && set('daily_digest_enabled', v ? '1' : '0')}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={L('Multi-POS', 'Multi-POS')}>
        <SettingRow
          settingKey="multi_pos_enabled"
          label={L('Modo multi-POS', 'Multi-POS Mode')}
          hint={multiPosAllowed
            ? L('Activar para correr 2+ POS en el mismo negocio con NCFs sincronizados desde la nube',
                'Enable to run 2+ POS for the same business with cloud-synced NCFs')
            : L('Requiere plan Pro MAX', 'Requires Pro MAX plan')}
        >
          <Toggle
            enabled={on('multi_pos_enabled')}
            onChange={v => multiPosAllowed && set('multi_pos_enabled', v ? '1' : '0')}
          />
        </SettingRow>
        {on('multi_pos_enabled') && (
          <>
            <SettingRow label={L('Tamaño de bloque NCF', 'NCF Block Size')} hint={L('Cuántos NCFs se reservan por dispositivo por bloque (defecto: 500)', 'How many NCFs reserved per device per block (default: 500)')}>
              <input
                type="number" min="50" max="10000" step="50"
                className="w-32 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5"
                value={cfg.ncf_block_size || '500'}
                onChange={e => set('ncf_block_size', e.target.value)}
              />
            </SettingRow>
            <SettingRow label={L('Tamaño de bloque ticket', 'Ticket Block Size')} hint={L('Cuántos doc_numbers por bloque (defecto: 200)', 'How many doc_numbers per block (default: 200)')}>
              <input
                type="number" min="20" max="5000" step="20"
                className="w-32 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5"
                value={cfg.doc_block_size || '200'}
                onChange={e => set('doc_block_size', e.target.value)}
              />
            </SettingRow>
          </>
        )}
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
  const { businessType } = useBusinessType()
  const showPreTicket = hasVehicles(businessType)
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
        <SettingRow settingKey="printer" label={L('Impresora del sistema', 'System Printer')} hint={L('Impresora configurada en el OS', 'OS-configured printer')}>
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
        <SettingRow label={L('Probar Gaveta de Dinero', 'Test Cash Drawer')} hint={L('Envia pulso al cajon. Prueba si no abre al cobrar.', 'Sends pulse to drawer. Use if it does not open on cobro.')}>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try {
                  const r = await printerApi?.openDrawer?.()
                  if (r?.success || r === true) show(L('Pulso enviado ✓', 'Pulse sent ✓'))
                  else show(L('Sin respuesta. Revisa conexion RJ11 impresora → gaveta.', 'No response. Check RJ11 cable printer → drawer.'), 'error')
                } catch (e) { show(L('Error: ', 'Error: ') + (e?.message || ''), 'error') }
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-white/10 rounded-lg text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 whitespace-nowrap">
              {L('Abrir Gaveta', 'Open Drawer')}
            </button>
            <button
              onClick={async () => {
                try {
                  const r = await printerApi?.testDrawerVariants?.(cfg.printer || undefined)
                  if (r?.success) show(L('Variantes enviadas. Observa cual abre.', 'Variants sent. See which opens.'))
                  else show(L('Error: ', 'Error: ') + (r?.error || 'desconocido'), 'error')
                } catch (e) { show(L('Error: ', 'Error: ') + (e?.message || ''), 'error') }
              }}
              title={L('Envia 4 comandos distintos con retraso entre cada uno', 'Sends 4 different commands with delay between each')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-white/10 rounded-lg text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 whitespace-nowrap">
              {L('Probar 4 Variantes', 'Test 4 Variants')}
            </button>
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title={L('Impresion Automatica', 'Auto Print')}>
        {showPreTicket && (
          <SettingRow settingKey="print_preticket" label={L('Pre-Ticket', 'Pre-Ticket')} hint={L('Al agregar vehiculo a cola', 'When adding vehicle to queue')}>
            <Toggle enabled={on('print_preticket')} onChange={v => set('print_preticket', v ? '1' : '0')} />
          </SettingRow>
        )}
        <SettingRow settingKey="print_factura_auto" label={L('Factura', 'Invoice')} hint={L('Al confirmar cobro', 'On payment')}>
          <Toggle enabled={on('print_factura_auto')} onChange={v => set('print_factura_auto', v ? '1' : '0')} />
        </SettingRow>
        <SettingRow settingKey="print_conduce_auto" label={L('Conduce', 'Delivery Note')} hint={showPreTicket ? L('Al confirmar cobro', 'On payment') : L('Copia para control de inventario', 'Copy for inventory check')}>
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
        <SettingRow label={L('Mensaje "Vehículo Listo"', 'Vehicle Ready Message')} hint={L('Placeholders: {cliente} {vehiculo} {ticket} {biz}', 'Placeholders: {cliente} {vehiculo} {ticket} {biz}')}>
          <textarea
            value={cfg.wa_listo_template}
            onChange={e => set('wa_listo_template', e.target.value)}
            rows={3}
            placeholder={L('Tu mensaje aquí. Ej: Hola {cliente}, tu vehículo {vehiculo} está listo en {biz}.', 'Your message here. E.g. Hi {cliente}, your vehicle {vehiculo} is ready at {biz}.')}
            className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none"
          />
        </SettingRow>
        <SettingRow label={L('Mensaje "Saldo Pendiente"', 'Balance Reminder Message')} hint={L('Placeholders: {cliente} {saldo} {cuentas} {biz}', 'Placeholders: {cliente} {saldo} {cuentas} {biz}')}>
          <textarea
            value={cfg.wa_balance_template}
            onChange={e => set('wa_balance_template', e.target.value)}
            rows={4}
            placeholder={L('Tu mensaje aquí. Ej: Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}', 'Your message here. E.g. Hi {cliente}, your pending balance with {biz} is {saldo}. Accounts:\n{cuentas}')}
            className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none"
          />
        </SettingRow>
        <SettingRow label={L('Cuentas Bancarias', 'Bank Accounts')} hint={L('Un banco/cuenta por línea. Usado como {cuentas} en los mensajes.', 'One bank/account per line. Used as {cuentas} in messages.')}>
          <textarea
            value={cfg.biz_bank_accounts}
            onChange={e => set('biz_bank_accounts', e.target.value)}
            rows={3}
            placeholder={L('Banco Popular 000-123456-7\nBanreservas 000-987654-3', 'Banco Popular 000-123456-7\nBanreservas 000-987654-3')}
            className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none font-mono"
          />
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
  const [channel,  setChannel]  = useState('latest')  // 'latest' (stable) | 'beta'
  const [chanSaving, setChanSaving] = useState(false)
  const [chanNotice, setChanNotice] = useState('')
  const unsubRef = useRef(null)

  useEffect(() => {
    if (!api?.version) return
    api.version().then(v => setVersion(v)).catch(() => {})
    if (api?.updater?.getChannel) {
      api.updater.getChannel().then(r => {
        if (r?.channel) setChannel(r.channel)
      }).catch(() => {})
    }

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

  async function handleChangeChannel(next) {
    if (!api?.updater?.setChannel) return
    if (next === channel) return
    setChanSaving(true)
    setChanNotice('')
    const res = await api.updater.setChannel(next).catch(() => ({ error: 'failed' }))
    setChanSaving(false)
    if (res?.ok) {
      setChannel(res.channel)
      setChanNotice(L(
        'Canal actualizado. Reinicia Terminal X para aplicar completamente.',
        'Channel updated. Restart Terminal X to fully apply.'
      ))
    } else {
      setChanNotice(L('No se pudo cambiar el canal', 'Could not change channel'))
    }
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

      {/* Update channel picker */}
      <div className="mt-6 border-t border-slate-100 dark:border-white/10 pt-5">
        <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">
          {L('Canal de actualizaciones', 'Update channel')}
        </p>
        <div className="flex items-center gap-3">
          <select
            value={channel}
            disabled={chanSaving}
            onChange={e => handleChangeChannel(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-800 dark:text-white font-semibold disabled:opacity-50"
          >
            <option value="latest">{L('Estable (recomendado)', 'Stable (recommended)')}</option>
            <option value="beta">{L('Beta (pruebas tempranas)', 'Beta (early testing)')}</option>
          </select>
          {chanSaving && (
            <span className="text-[12px] text-slate-400 dark:text-white/40">
              {L('Guardando…', 'Saving…')}
            </span>
          )}
        </div>
        {chanNotice && (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{chanNotice}</p>
        )}
        <p className="mt-2 text-[11px] text-slate-400 dark:text-white/40 leading-relaxed">
          {L(
            'El canal Beta recibe versiones pre-lanzamiento para probar nuevas funciones antes del lanzamiento oficial. Usa Estable en producción.',
            'The Beta channel receives pre-release builds to test new features ahead of general release. Use Stable in production.'
          )}
        </p>
      </div>

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

// ── Diagnosticar Red (Network Diagnostics) ────────────────────────────────────
//
// Self-diagnose "failed to fetch" login errors without calling the owner.
// Runs 6 checks in parallel, each wrapped in try/catch with a 5s timeout so
// the panel never hangs. Cashier sees pass/fail rows + troubleshooting tips.

const DIAG_TIMEOUT_MS = 5000

function withTimeout(promise, ms = DIAG_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ])
}

// Each test returns { status: 'pass' | 'fail' | 'warn' | 'na', detail, meta? }
async function testClockDrift() {
  try {
    const res = await withTimeout(fetch('https://www.google.com/generate_204', {
      method: 'HEAD', mode: 'no-cors', cache: 'no-store',
    }))
    const serverDate = res.headers.get('date')
    if (!serverDate) {
      // no-cors HEAD usually strips headers — fall back to Cloudflare trace
      const t = await withTimeout(fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' }))
      const txt = await t.text()
      const tsLine = txt.split('\n').find(l => l.startsWith('ts='))
      if (!tsLine) return { status: 'warn', detail: 'No se pudo leer la hora del servidor' }
      const serverTs = parseFloat(tsLine.split('=')[1]) * 1000
      const driftMin = Math.abs(Date.now() - serverTs) / 60000
      if (driftMin > 5) return { status: 'fail', detail: `Desfase: ${driftMin.toFixed(1)} min` }
      return { status: 'pass', detail: `Desfase: ${driftMin.toFixed(1)} min` }
    }
    const serverTs = new Date(serverDate).getTime()
    const driftMin = Math.abs(Date.now() - serverTs) / 60000
    if (driftMin > 5) return { status: 'fail', detail: `Desfase: ${driftMin.toFixed(1)} min` }
    return { status: 'pass', detail: `Desfase: ${driftMin.toFixed(1)} min` }
  } catch (e) {
    return { status: 'fail', detail: e?.message === 'timeout' ? 'Timeout 5s' : 'No se pudo verificar' }
  }
}

function getSupabaseHost() {
  try {
    const url = import.meta.env?.VITE_SUPABASE_URL
    if (url) return new URL(url).host
  } catch {}
  return 'csppjsoirjflumaiipqw.supabase.co'
}

async function testDNS() {
  const host = getSupabaseHost()
  try {
    const res = await withTimeout(fetch(`https://${host}/rest/v1/`, {
      method: 'HEAD', mode: 'no-cors', cache: 'no-store',
    }))
    // no-cors HEAD always "succeeds" (opaque) if connection was made.
    // Any resolution counts as DNS pass. If the fetch threw, DNS or TLS failed.
    return { status: 'pass', detail: host }
  } catch (e) {
    return { status: 'fail', detail: `${host} — ${e?.message === 'timeout' ? 'Timeout' : 'No resuelve'}` }
  }
}

async function testSupabaseReach() {
  const host = getSupabaseHost()
  const anon = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''
  try {
    const res = await withTimeout(fetch(`https://${host}/rest/v1/?apikey=${encodeURIComponent(anon)}`, {
      method: 'HEAD', mode: 'no-cors', cache: 'no-store',
    }))
    return { status: 'pass', detail: 'Conexión TLS OK' }
  } catch (e) {
    return { status: 'fail', detail: e?.message === 'timeout' ? 'Timeout 5s' : 'Firewall o antivirus' }
  }
}

async function testIPv6() {
  try {
    const res = await withTimeout(fetch('https://api6.ipify.org?format=json', { cache: 'no-store' }), 4000)
    if (res.ok) {
      const j = await res.json().catch(() => ({}))
      return { status: 'pass', detail: `IPv6 OK · ${j.ip || ''}` }
    }
    return { status: 'warn', detail: 'IPv6 no disponible (informativo)' }
  } catch {
    return { status: 'warn', detail: 'IPv6 no disponible (informativo)' }
  }
}

async function testLicenseCache() {
  const isDesktopLocal = typeof window !== 'undefined' && !!window.electronAPI
  if (!isDesktopLocal) return { status: 'na', detail: 'N/A — solo escritorio' }
  try {
    // Renderer owns the real license cache (localStorage)
    const raw = localStorage.getItem('tx_license_cache')
    const ts  = parseInt(localStorage.getItem('tx_license_cache_ts') || '0', 10)
    // Augment with main-process proxy (hwid.json mtime)
    const mainStatus = await withTimeout(window.electronAPI.license.status(), 3000).catch(() => null)

    if (!raw || !ts) {
      return { status: 'fail', detail: 'Sin caché de licencia — necesitas validar en línea' }
    }
    const ageH = (Date.now() - ts) / 3600000
    const cache = JSON.parse(raw)
    const expiresAt = cache.expiresAt ? new Date(cache.expiresAt) : null
    const inGrace = ageH < 72
    if (!inGrace) {
      return { status: 'fail', detail: `Caché vencida (hace ${ageH.toFixed(0)}h)` }
    }
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      return { status: 'warn', detail: `Licencia vencida el ${expiresAt.toLocaleDateString('es-DO')}` }
    }
    const expStr = expiresAt ? ` · vence ${expiresAt.toLocaleDateString('es-DO')}` : ''
    return { status: 'pass', detail: `Caché válida (${ageH.toFixed(0)}h)${expStr}` }
  } catch (e) {
    return { status: 'fail', detail: 'Error leyendo caché' }
  }
}

async function testInternet() {
  try {
    const res = await withTimeout(fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' }))
    if (res.ok) {
      const txt = await res.text()
      const locLine = txt.split('\n').find(l => l.startsWith('loc='))
      const loc = locLine ? locLine.split('=')[1] : ''
      return { status: 'pass', detail: loc ? `Internet OK · ${loc}` : 'Internet OK' }
    }
    return { status: 'fail', detail: `Cloudflare respondió ${res.status}` }
  } catch (e) {
    return { status: 'fail', detail: e?.message === 'timeout' ? 'Timeout 5s' : 'Sin conexión' }
  }
}

const DIAG_TESTS_DEF = (L) => [
  { id: 'clock',    icon: Clock,   run: testClockDrift,    es: 'Reloj del sistema',     en: 'System clock',
    fixEs: 'Click derecho en la hora de Windows → Ajustar fecha y hora → Sincronizar ahora.',
    fixEn: 'Right-click the Windows clock → Adjust date/time → Sync now.' },
  { id: 'dns',      icon: Globe2,  run: testDNS,           es: 'DNS (Supabase)',        en: 'DNS (Supabase)',
    fixEs: 'Cambia el DNS de tu WiFi a 1.1.1.1 (Cloudflare) o 8.8.8.8 (Google). Pídele ayuda a tu proveedor de internet.',
    fixEn: 'Change your WiFi DNS to 1.1.1.1 (Cloudflare) or 8.8.8.8 (Google). Ask your ISP for help.' },
  { id: 'reach',    icon: Cloud,   run: testSupabaseReach, es: 'Conexión IPv4 a Supabase', en: 'IPv4 reach to Supabase',
    fixEs: 'Tu firewall o antivirus bloquea supabase.co. Desactívalo temporalmente y prueba de nuevo.',
    fixEn: 'Your firewall or antivirus is blocking supabase.co. Disable it temporarily and try again.' },
  { id: 'ipv6',     icon: Wifi,    run: testIPv6,          es: 'Preferencia IPv6',      en: 'IPv6 preference',
    fixEs: 'Tu router tiene IPv6 mal configurado. Pídele al ISP que lo desactive, o usa data móvil como prueba.',
    fixEn: 'Your router has IPv6 misconfigured. Ask the ISP to disable it, or test with mobile data.' },
  { id: 'license',  icon: Shield,  run: testLicenseCache,  es: 'Caché de licencia',     en: 'License cache',
    fixEs: 'Abre Sistema → Licencia y haz click en "Revalidar licencia" cuando tengas internet.',
    fixEn: 'Open System → License and click "Revalidate license" when you have internet.' },
  { id: 'internet', icon: Globe2,  run: testInternet,      es: 'Conexión a internet',   en: 'Internet connection',
    fixEs: 'No tienes internet. Revisa tu router/WiFi o conéctate a data móvil.',
    fixEn: 'No internet. Check your router/WiFi or switch to mobile data.' },
]

function StatusIcon({ status }) {
  if (status === 'pass') return <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
  if (status === 'fail') return <XCircle size={16} className="text-[#b3001e] shrink-0" />
  if (status === 'warn') return <AlertTriangle size={16} className="text-amber-500 shrink-0" />
  if (status === 'running') return <Loader2 size={16} className="text-slate-400 dark:text-white/40 shrink-0 animate-spin" />
  if (status === 'na') return <AlertCircle size={16} className="text-slate-300 dark:text-white/30 shrink-0" />
  return <div className="w-4 h-4 rounded-full border border-slate-200 dark:border-white/10 shrink-0" />
}

export function NetworkDiagnostics() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const TESTS = DIAG_TESTS_DEF(L)

  const [results, setResults]   = useState({}) // { id: { status, detail } }
  const [running, setRunning]   = useState(false)
  const [expanded, setExpanded] = useState({}) // { id: bool }
  const [ranOnce, setRanOnce]   = useState(false)

  async function runAll() {
    setRunning(true)
    setRanOnce(true)
    // initialize all to running
    const init = {}
    TESTS.forEach(t => { init[t.id] = { status: 'running', detail: '' } })
    setResults(init)

    // fire all in parallel, update as each resolves
    await Promise.all(TESTS.map(async t => {
      const r = await t.run().catch(e => ({ status: 'fail', detail: String(e?.message || e) }))
      setResults(prev => ({ ...prev, [t.id]: r }))
    }))
    setRunning(false)
  }

  const fails = TESTS.filter(t => results[t.id]?.status === 'fail').length
  const warns = TESTS.filter(t => results[t.id]?.status === 'warn').length

  let summaryColor = 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-white'
  let summaryLabel = L('Listo para diagnosticar', 'Ready to diagnose')
  let summaryIcon  = <Activity size={18} />
  if (ranOnce && !running) {
    if (fails > 0) {
      summaryColor = 'bg-[#b3001e]/5 border-[#b3001e]/30 text-[#b3001e]'
      summaryIcon  = <XCircle size={18} />
      summaryLabel = fails === 1
        ? L('1 problema detectado', '1 problem detected')
        : L(`${fails} problemas detectados`, `${fails} problems detected`)
    } else if (warns > 0) {
      summaryColor = 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-400'
      summaryIcon  = <AlertTriangle size={18} />
      summaryLabel = L('Todo funciona, con advertencias', 'Working, with warnings')
    } else {
      summaryColor = 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
      summaryIcon  = <CheckCircle2 size={18} />
      summaryLabel = L('Todo bien', 'All good')
    }
  }

  return (
    <div className="max-w-2xl">
      {/* Summary card */}
      <div className={`border rounded-xl p-4 md:p-5 mb-4 flex items-center justify-between gap-4 ${summaryColor}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0">{summaryIcon}</div>
          <div className="min-w-0">
            <p className="text-[13px] md:text-[14px] font-bold truncate">{summaryLabel}</p>
            <p className="text-[11px] opacity-70 mt-0.5">
              {L('Prueba de conexión para errores de inicio de sesión.',
                 'Connection test for login errors.')}
            </p>
          </div>
        </div>
        <button
          onClick={runAll}
          disabled={running}
          className="flex items-center gap-1.5 px-3 md:px-4 py-2 bg-black dark:bg-white text-white dark:text-black hover:bg-[#b3001e] dark:hover:bg-[#b3001e] dark:hover:text-white disabled:opacity-50 text-[12px] font-bold rounded-lg transition-colors shrink-0"
        >
          <RefreshCw size={13} className={running ? 'animate-spin' : ''} />
          {running ? L('Ejecutando…', 'Running…') : L('Ejecutar diagnóstico', 'Run diagnostic')}
        </button>
      </div>

      {/* Tests list */}
      <div className="border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-100 dark:divide-white/10 overflow-hidden">
        {TESTS.map(t => {
          const r = results[t.id]
          const status = r?.status || 'idle'
          const TestIcon = t.icon
          const isOpen = !!expanded[t.id]
          const canExpand = status === 'fail' || status === 'warn'

          return (
            <div key={t.id} className="bg-white dark:bg-white/5">
              <div className="flex items-center gap-3 px-4 py-3">
                <StatusIcon status={status} />
                <TestIcon size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">
                    {L(t.es, t.en)}
                  </p>
                  {r?.detail && (
                    <p className={`text-[11px] mt-0.5 truncate ${
                      status === 'fail' ? 'text-[#b3001e]' :
                      status === 'warn' ? 'text-amber-600 dark:text-amber-400' :
                      status === 'pass' ? 'text-emerald-600 dark:text-emerald-400' :
                      'text-slate-400 dark:text-white/40'
                    }`}>
                      {r.detail}
                    </p>
                  )}
                </div>
                {canExpand && (
                  <button
                    onClick={() => setExpanded(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-white/60 hover:text-[#b3001e] shrink-0"
                  >
                    {L('Ver cómo arreglar', 'How to fix')}
                    <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
                {status === 'na' && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 shrink-0">
                    {L('Solo escritorio', 'Desktop only')}
                  </span>
                )}
              </div>
              {canExpand && isOpen && (
                <div className="px-4 pb-4 pt-1 bg-slate-50 dark:bg-white/[0.02]">
                  <div className="flex gap-2 items-start border-l-2 border-[#b3001e] pl-3 py-1">
                    <p className="text-[12px] text-slate-700 dark:text-white/80 leading-relaxed">
                      {L(t.fixEs, t.fixEn)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      <p className="text-[11px] text-slate-400 dark:text-white/40 mt-4 leading-relaxed">
        {L('Si todo sale verde y aún no puedes iniciar sesión, envía una captura de esta pantalla por WhatsApp al +1 (809) 828-2971.',
           'If everything is green and you still can\'t log in, send a screenshot of this screen via WhatsApp to +1 (809) 828-2971.')}
      </p>
    </div>
  )
}

// ── MAIN SISTEMA SCREEN ───────────────────────────────────────────────────────

// Actualizaciones is desktop-only (Electron auto-updater). Hidden on web/mobile.
const isDesktop = typeof window !== 'undefined' && !!window.electronAPI
const TABS = [
  { id: 'config', es: 'Preferencias', en: 'Preferences', icon: Settings },
  ...(isDesktop ? [{ id: 'actualizaciones', es: 'Actualizaciones', en: 'Updates', icon: Download }] : []),
  { id: 'diagnostico', es: 'Diagnóstico', en: 'Diagnostics', icon: Activity },
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
      {tab === 'diagnostico' && (
        <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6">
          <NetworkDiagnostics />
        </div>
      )}
      {/* LicenseAdmin tab removed — dead code. Admin panel is at terminalxpos.com/admin */}
    </div>
  )
}
