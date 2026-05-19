import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import {
  Settings, KeyRound, CheckCircle2, Loader2, AlertCircle, Printer,
  RefreshCw, Download, ArrowDownToLine, FileText, HardDrive,
  Activity, XCircle, AlertTriangle, ChevronDown, Clock, Wifi, Shield, Globe2, Cloud,
  Laptop, Send, X as IconX,
} from 'lucide-react'
import { isDeviceSetting } from '@terminal-x/services/settingsWhitelist'
import { defaultFor as waDefaultFor } from '@terminal-x/services/whatsappTemplates'
import { useLang } from '../i18n'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import { hasVehicles } from '@terminal-x/config/businessTypes'
import { resolveReceiptFlag, RECEIPT_DEFAULT_FOOTER } from '@terminal-x/config/receiptDefaults'
import { usePlan } from '../hooks/usePlan.jsx'
import { isTech } from '../lib/roles'
import { ScaleRegistry as _ScaleRegistry } from '@terminal-x/services/scale'
import { runDrawerAutoDetect } from '../lib/drawerAutoDetect'

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState(null)
  function show(msg, type = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return { toast, show }
}

export function Toast({ toast }) {
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

export function Toggle({ enabled, onChange, disabled = false }) {
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

export function SettingRow({ label, hint, children, settingKey }) {
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

function GoLiveSection({ api, goLiveDate, committedAt, set, show, L }) {
  const [draft, setDraft] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [testCount, setTestCount] = useState(null)
  const [working, setWorking] = useState(false)
  const committed = !!committedAt
  const today = new Date(); today.setHours(0,0,0,0)
  const parsed = goLiveDate ? new Date(`${goLiveDate}T00:00:00`) : null
  const inFuture = parsed && parsed.getTime() > today.getTime()
  const isLive = !!parsed && parsed.getTime() <= today.getTime()

  async function onPick(value) {
    setDraft(value)
    if (!value) { set('go_live_date', ''); return }
    const picked = new Date(`${value}T00:00:00`)
    if (picked.getTime() > today.getTime()) {
      // Future date: just save (POS stays in test until that date).
      set('go_live_date', value)
      return
    }
    // Today or past → confirm modal + wipe.
    try {
      const c = await api.app?.testDataCount?.()
      setTestCount(c?.tickets ?? 0)
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.usetoast' }) } catch {} setTestCount(0) }
    setConfirmOpen(true)
  }

  async function confirmGoLive() {
    setWorking(true)
    try {
      // 1) persist the date in app_settings.
      set('go_live_date', draft)
      await api.settings.update({ go_live_date: draft })
      // 2) wipe is_test rows + stamp go_live_committed_at.
      await api.app?.goLiveCommit?.()
      // 3) reflect locally so the lock UI shows immediately.
      set('go_live_committed_at', new Date().toISOString())
      try { window.dispatchEvent(new CustomEvent('tx:settings-changed')) } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.toggle' }) } catch {}}
      show(L('Producción activada', 'Production activated'))
      setConfirmOpen(false)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.toggle' }) } catch {}
      show(L('Error al activar producción', 'Failed to activate production'), 'error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <SettingSection title={L('Fecha de puesta en producción', 'Go-Live Date')}>
      <SettingRow
        label={L('Fecha de inicio operativo', 'Operational start date')}
        hint={L(
          'Mientras esta fecha esté vacía o sea futura, el POS está en MODO PRUEBA: ningún ticket se sincroniza ni se reporta al DGII, y no se generan comisiones ni crédito.',
          'While empty or in the future, the POS is in TEST MODE: no tickets sync, no DGII, no commissions, no credit.'
        )}
      >
        <div className="flex flex-col items-end gap-1">
          <input
            type="date"
            value={goLiveDate || ''}
            disabled={committed}
            onChange={e => onPick(e.target.value)}
            className="border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-[#b3001e] disabled:opacity-60"
          />
          {committed && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
              {L('Producción activada el', 'Activated on')} {String(committedAt).slice(0, 10)}
            </span>
          )}
          {!committed && !goLiveDate && (
            <span className="text-[10px] text-[#b3001e] font-bold uppercase tracking-wide">
              {L('⚠ MODO PRUEBA — configure una fecha para activar', '⚠ TEST MODE — set a date to activate')}
            </span>
          )}
          {!committed && inFuture && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
              {L('Activará automáticamente el', 'Will activate on')} {goLiveDate}
            </span>
          )}
          {!committed && isLive && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
              {L('LIVE', 'LIVE')}
            </span>
          )}
        </div>
      </SettingRow>

      {confirmOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border-4 border-[#b3001e]">
            <h3 className="text-lg font-bold text-[#b3001e] mb-2">
              {L('Activar producción', 'Activate production')}
            </h3>
            <p className="text-[13px] text-slate-700 dark:text-white/80 mb-3">
              {L(
                'Esta acción es irreversible. A partir de hoy todas las ventas se sincronizarán con la nube y se reportarán al DGII.',
                'This is irreversible. From today on, every sale will sync to the cloud and report to DGII.'
              )}
            </p>
            <div className="bg-[#b3001e]/10 border border-[#b3001e]/30 rounded-lg px-3 py-2 mb-4">
              <p className="text-[12px] text-[#b3001e] font-semibold">
                {L('Se borrarán', 'Will delete')} <span className="text-base">{testCount ?? '…'}</span>{' '}
                {L('tickets de prueba', 'test tickets')}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-white/60 mt-1">
                {L(
                  'Incluye items, pagos, y cualquier dato de prueba acumulado durante la configuración.',
                  'Includes items, payments, and any test data accumulated during setup.'
                )}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={working}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50"
              >
                {L('Cancelar', 'Cancel')}
              </button>
              <button
                onClick={confirmGoLive}
                disabled={working}
                className="px-4 py-2 rounded-lg text-[13px] font-bold bg-[#b3001e] text-white hover:bg-[#8e0018] disabled:opacity-50"
              >
                {working ? L('Activando…', 'Activating…') : L('Activar y borrar pruebas', 'Activate and wipe tests')}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingSection>
  )
}

// 2026-05-09 — `id` prop drives the new ConfigGrid hash-anchored deep links
// (/config/preferencias#printer, #whatsapp, #commissions, etc.). The
// scroll-to-hash effect on Preferencias picks these up.  scroll-mt-20 keeps
// the section title visible below the modal header when the browser
// auto-scrolls to it.
export function SettingSection({ id, title, children }) {
  return (
    <div className="mb-5 scroll-mt-20" {...(id ? { id } : {})}>
      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">{title}</p>
      <div className="border border-slate-200 dark:border-white/10 rounded-xl px-4 divide-y divide-slate-100 dark:divide-white/10">
        {children}
      </div>
    </div>
  )
}

export function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full px-2.5 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5
        focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20 placeholder:text-slate-300 dark:placeholder:text-white/40 ${className}`}
    />
  )
}

export function SaveBtn({ saving, saved, label, onClick }) {
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

// ── Drawer tester ────────────────────────────────────────────────────────────
// Default view: "Abrir Caja" (single pulse) + "Detección Automática" (cycles
// variants until cashier confirms). Auto-detect persists immediately, so the
// owner never has to touch numbered variant buttons or Guardar.
// `showAdvanced` (tech role only) reveals the raw variant grid for installers
// who need to manually pick a pulse.
function DrawerTester({ printerApi, cfg, set, persistKey, show, L, showAdvanced }) {
  const [selected, setSelected] = useState(null)   // highlighted variant (advanced only)
  const [total,    setTotal]    = useState(8)
  const [autoIdx,  setAutoIdx]  = useState(null)
  const [autoHex,  setAutoHex]  = useState(null)
  const ctlRef = useRef(null)

  async function abrirCaja() {
    try {
      const r = await printerApi?.openDrawer?.()
      if (r?.success || r === true) show(L('Pulso enviado ✓', 'Pulse sent ✓'))
      else show(L('Sin respuesta. Revisa conexion RJ11 impresora → gaveta.', 'No response. Check RJ11 cable printer → drawer.'), 'error')
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.settingsection' }) } catch {} show(L('Error: ', 'Error: ') + (e?.message || ''), 'error') }
  }

  async function fireVariant(idx) {
    setSelected(idx)
    try {
      const r = await printerApi?.fireDrawerVariant?.(idx, cfg.printer || undefined)
      if (r?.total) setTotal(r.total)
      if (r?.hex) set('drawer_pulse_hex', r.hex) // stage for the page-wide Guardar
      if (!r?.success) show(L('Error: ', 'Error: ') + (r?.error || 'desconocido'), 'error')
      return r
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.settingsection' }) } catch {} show(L('Error: ', 'Error: ') + (e?.message || ''), 'error'); return null }
  }

  function startAutoDetect() {
    ctlRef.current = runDrawerAutoDetect({
      printerApi,
      printer: cfg.printer,
      onProgress: ({ idx, total: t, hex }) => {
        if (t) setTotal(t)
        setAutoIdx(idx)
        setAutoHex(hex)
      },
      onExhausted: () => {
        setAutoIdx(null); setAutoHex(null)
        show(L('Ninguna variante abrió. Revisa cable RJ11 + posición de la llave de la gaveta.', 'No variant opened. Check RJ11 cable + drawer key position.'), 'error')
      },
    })
  }

  async function confirmAutoOpened() {
    // v2.16.15 — cancel the auto-detect LOOP before awaiting persistKey.
    // Previously persistKey ran first; while it was awaiting (~1-3s for the
    // write + cloud sync round-trip) the runDrawerAutoDetect timer kept
    // firing the next variant every 1.6s, so the gaveta would keep popping
    // even after the user clicked "¡Se abrió!". Snapshot the values, cancel
    // the loop, THEN persist.
    const hexToPersist = autoHex
    const idxToSelect = autoIdx
    stopAutoDetect()
    if (hexToPersist) {
      setSelected(idxToSelect)
      await persistKey('drawer_pulse_hex', hexToPersist)
      show(L('Gaveta configurada ✓ Guardado', 'Drawer configured ✓ Saved'))
    }
  }

  function stopAutoDetect() {
    ctlRef.current?.cancel()
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
      {showAdvanced && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-slate-400 dark:text-white/40">{L('Variantes (técnico):', 'Variants (tech):')}</span>
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
      )}
      {autoIdx !== null && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          {L(`Probando variante ${autoIdx + 1} de ${total}… haz clic en "¡Se abrió!" cuando la caja abra.`, `Testing variant ${autoIdx + 1} of ${total}… click "It opened!" the moment the drawer pops.`)}
        </p>
      )}
      {savedHex && autoIdx === null && showAdvanced && (
        <p className="text-[10px] text-slate-400 dark:text-white/40">
          {L('Variante activa:', 'Active variant:')} <span className="font-mono">{savedHex}</span>
        </p>
      )}
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
  // v2.6.2 — Kiosk auto-lock (idle timeout). OFF by default. Owner-configurable.
  // When enabled, N minutes of no input triggers a PIN overlay that gates the
  // terminal without flushing the session (cart, route, modals all survive).
  kiosk_auto_lock_enabled: '0',
  kiosk_auto_lock_minutes: '10',
  // v2.6.x — USB-fail retry queue for thermal prints. Buffers failed jobs,
  // retries with backoff (1s/3s/8s), surfaces a banner after max attempts.
  print_retry_enabled: '1',
  print_retry_max:     '3',
  // v2.14.34 — Per-business receipt customization. Cloud-synced (BUSINESS_SETTING_KEYS)
  // so all registers in a business inherit the same look. Toggles affect the
  // customer-facing factura only (buildClientReceipt in services/printer.js).
  receipt_show_itbis_pct:  '0',
  receipt_show_commission: '0',
  // v2.17.7 — conduce_show_commission gates the "Comision: $X" line on the
  // washer dispatch slip. Default OFF (washers shouldn't see the gross
  // commission to avoid disputes). Toggle flips behaviour back to the
  // pre-v2.17.7 "always show" mode. Cloud-synced.
  conduce_show_commission: '0',
  // v2.16.30 — 9-flag receipt overhaul. Empty-string default = "fall through to
  // per-business-type baseline" (see packages/config/receiptDefaults.js).
  // Owner can flip explicitly to '1' (force on) or '0' (force off); both
  // override the vertical default. Footer message defaults to '' so the
  // renderer substitutes RECEIPT_DEFAULT_FOOTER.
  receipt_show_sku:             '',
  receipt_show_unit_price:      '',
  receipt_show_exempt_label:    '',
  receipt_show_client_address:  '',
  receipt_show_servicio_ley:    '',
  receipt_show_credit_ref:      '',
  receipt_show_vehicle_details: '',
  receipt_show_contact_extra:   '',
  receipt_show_loyalty:         '',
  receipt_footer_message:       '',
  // v2.16.x FIX-HIGH-7 — Mecánica: owner-configurable tow/delivery fee auto-
  // added to a WO when "Marcar Listo" toggles entrega a domicilio. Was hardcoded
  // RD$ 500. Cloud-synced (BUSINESS_SETTING_KEYS) so every register matches.
  mechanic_tow_fee_default: '500',
  // v2.17.4 — Pedidos Ya channel: cloud-synced toggles + commission. Adding here
  // ensures useSettings.loadSettings rehydrates them from app_settings on mount
  // so the toggle state persists across reloads (filter on line 481 skips any
  // key not in SISTEMA_DEFAULTS).
  pedidos_ya_enabled:        '0',
  pedidos_ya_commission_pct: '15',
  // py_show_breakdown: when '1' (default) Inventory + Daily + Monthly reports
  // render the −PY% and −5% card commission lines as visible breakdown rows
  // alongside Ganancia Bruta. When '0' the breakdown collapses (gross only).
  py_show_breakdown: '1',
}

// Shared settings hook — loads cfg from DB once, provides set/save
export function useSettings() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { lang } = useLang()
  const { toast, show } = useToast()
  const [cfg, setCfg] = useState(SISTEMA_DEFAULTS)
  const [printers, setPrinters] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // v2.16.27 — QZ Tray availability tracker. On web, listPrinters bridges
  // through the qz-tray.js WebSocket on localhost:8181-8484. If the daemon
  // isn't installed, every connection times out and `printers` stays []
  // — historically that left the cashier staring at "Predeterminada" with
  // no explanation. We surface a friendly help block instead.
  const [qzStatus, setQzStatus] = useState('checking')   // 'checking' | 'ok' | 'unreachable'
  const isWebPwa = typeof window !== 'undefined' && !window.electronAPI

  useEffect(() => {
    const loadSettings = () => api.settings.get().then(s => {
      if (!s) return
      setCfg(prev => ({ ...prev, ...Object.fromEntries(Object.keys(SISTEMA_DEFAULTS).filter(k => s[k] != null).map(k => [k, s[k]])) }))
    }).catch(() => {})
    loadSettings()
    printerApi?.listPrinters().then(res => {
      if (res?.ok && Array.isArray(res.data) && res.data.length > 0) {
        setPrinters(res.data)
        setQzStatus('ok')
      } else {
        setQzStatus(isWebPwa ? 'unreachable' : 'ok')
      }
    }).catch(() => { setQzStatus(isWebPwa ? 'unreachable' : 'ok') })
    // Re-fetch after cloud sync pull completes so a freshly-launched app
    // picks up the latest printer/drawer/POS config without requiring a
    // manual page reload. preload.js re-emits sync:pull-complete from main
    // as a CustomEvent on window.
    const onPull = () => loadSettings()
    window.addEventListener('tx:sync-pull-complete', onPull)
    return () => window.removeEventListener('tx:sync-pull-complete', onPull)
  }, [])

  function set(k, v) { setCfg(c => ({ ...c, [k]: v })) }
  const on = k => cfg[k] === '1'

  async function handleSave() {
    setSaving(true)
    try {
      await api.settings.update(cfg)
      // Notify in-app listeners (e.g. KioskProvider) that settings changed so
      // they can reload without a full page refresh.
      try { window.dispatchEvent(new CustomEvent('tx:settings-updated')) } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.usesettings' }) } catch {}}
      setSaved(true)
      show(lang === 'es' ? 'Guardado' : 'Saved')
      setTimeout(() => setSaved(false), 2500)
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.usesettings' }) } catch {} show(lang === 'es' ? 'Error al guardar' : 'Error saving', 'error') }
    finally { setSaving(false) }
  }

  return { cfg, set, on, handleSave, saving, saved, printers, toast, show, api, printerApi, qzStatus, isWebPwa }
}

// ── Preferencias (General settings: language, taxes, POS toggles, printing) ──

export function Preferencias() {
  // 2026-05-19 — Stripped as part of the atomic config rework. Every
  // setting that used to live here now has its own card under /config.
  // Hash-anchor redirects (e.g. /sistema#manager → /config/security)
  // keep old bookmarks working.
  const navigate = useNavigate()
  const location = useLocation()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  useEffect(() => {
    const hash = (location.hash || '').toLowerCase()
    const map = SISTEMA_HASH_REDIRECTS
    if (hash && map[hash]) navigate(map[hash], { replace: true })
  }, [location.hash, navigate])
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-4">
      <Settings size={40} className="mx-auto text-[#b3001e]" />
      <h2 className="text-xl font-bold text-slate-800 dark:text-white">
        {L('Configuración movida', 'Configuration moved')}
      </h2>
      <p className="text-sm text-slate-600 dark:text-white/70">
        {L('Cada ajuste ahora vive en su tarjeta dedicada en Configuración.',
           'Every setting now lives in its dedicated card under Configuration.')}
      </p>
      <Link to="/config" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#b3001e] text-white font-bold text-sm hover:bg-[#8e0018]">
        {L('Ir a Configuración', 'Go to Configuration')} →
      </Link>
    </div>
  )
}

// Hash-anchor redirect map for backward-compat with old /sistema#xxx deep-links.
const SISTEMA_HASH_REDIRECTS = {
  '#manager':     '/config/security',
  '#printer':     '/config/printer',
  '#whatsapp':    '/config/whatsapp',
  '#commissions': '/config/commissions',
  '#license':     '/config/license',
  '#loyalty':     '/config/loyalty',
  '#multi-pos':   '/config/funciones',
  '#go-live':     '/config/go-live',
  '#recibo':      '/config/recibo',
  '#impuestos':   '/config/impuestos',
}

// ── Impresion (Printing settings only) ────────────────────────────────────

export function ImpresionSettings() {
  const { cfg, set, on, handleSave, saving, saved, printers, toast, show, printerApi, api, qzStatus } = useSettings()
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
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.impresionsettings' }) } catch {}
      show(L('Error al imprimir: ', 'Print error: ') + (e?.message || ''), 'error')
    }
  }

  return (
    <div className="max-w-2xl">
      <Toast toast={toast} />
      <SettingSection title={L('Impresora', 'Printer')}>
        <SettingRow settingKey="printer" label={L('Impresora del sistema', 'System Printer')} hint={L('Se guarda al seleccionar', 'Saves on selection')}>
          <div className="flex items-center gap-2">
            <select value={cfg.printer} onChange={async (e) => {
                const v = e.target.value
                set('printer', v)
                try { await api.settings.update({ printer: v }); show(L('Impresora guardada ✓', 'Printer saved ✓')) }
                catch (_aetherErr) {
                  try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.impresionsettings' }) } catch {} show(L('Error al guardar impresora', 'Error saving printer'), 'error') }
              }}
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
                } catch (e) {
                  try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.impresionsettings' }) } catch {} show(L('Error: ', 'Error: ') + (e?.message || ''), 'error') }
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
                } catch (e) {
                  try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.if' }) } catch {} show(L('Error: ', 'Error: ') + (e?.message || ''), 'error') }
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

      {/* v2.14.34 / v2.16.30 — Per-business receipt customization. Toggles
          affect the customer-facing factura only. Stored in
          BUSINESS_SETTING_KEYS so all registers in the business inherit the
          same look after sync. Empty cfg → falls back to per-vertical default
          (see packages/config/receiptDefaults.js); '1' / '0' explicitly
          overrides. The "(por defecto)" suffix on the hint surfaces which
          state the vertical baseline picks for this business_type. */}
      <SettingSection title={L('Personalización de Recibo', 'Receipt Customization')}>
        {/* Helper: render the row with an effective-state hint. */}
        {(() => {
          const rcptRow = (key, labelEs, labelEn, hintEs, hintEn) => {
            const explicit = cfg[key] === '1' || cfg[key] === '0'
            const effective = resolveReceiptFlag(cfg, businessType, key)
            const defaultOn = resolveReceiptFlag({}, businessType, key)
            const sourceTag = explicit
              ? (lang === 'es' ? ' (forzado)' : ' (forced)')
              : (defaultOn ? (lang === 'es' ? ' (por defecto: ON)' : ' (default: ON)')
                           : (lang === 'es' ? ' (por defecto: OFF)' : ' (default: OFF)'))
            return (
              <SettingRow key={key} settingKey={key} label={L(labelEs, labelEn)} hint={L(hintEs, hintEn) + sourceTag}>
                <div className="flex items-center gap-2">
                  <Toggle enabled={effective} onChange={v => set(key, v ? '1' : '0')} />
                  {explicit && (
                    <button
                      type="button"
                      onClick={() => set(key, '')}
                      className="text-[10px] uppercase tracking-wider text-slate-400 hover:text-[#b3001e]"
                      title={L('Restablecer al valor por defecto del tipo de negocio', 'Reset to business-type default')}
                    >{L('Restablecer', 'Reset')}</button>
                  )}
                </div>
              </SettingRow>
            )
          }
          return (
            <>
              {rcptRow('receipt_show_itbis_pct',
                'Mostrar % de ITBIS', 'Show ITBIS %',
                'Muestra "ITBIS 18%" en los totales del recibo',
                'Shows "ITBIS 18%" on the totals line')}
              {rcptRow('receipt_show_commission',
                'Mostrar comisión en factura', 'Show commission on invoice',
                'Imprime una línea de Comisión en los totales (solo factura, no afecta el conduce)',
                'Prints a Commission line in totals (invoice only, not the conduce)')}
              {rcptRow('conduce_show_commission',
                'Mostrar comisión en conduce', 'Show commission on conduce',
                'Imprime "Comisión: RD$X" al pie del conduce del lavador',
                'Prints "Comisión: RD$X" at the foot of the washer conduce')}
              {rcptRow('receipt_show_sku',
                'Mostrar SKU/código por línea', 'Show SKU/code per line',
                'Imprime el SKU debajo del nombre del producto',
                'Prints the SKU underneath each item name')}
              {rcptRow('receipt_show_unit_price',
                'Precio por unidad en multi-cantidad', 'Per-unit price on multi-qty',
                'En líneas con cantidad mayor a 1, muestra "Producto @ RD$ precio"',
                'On qty > 1 lines, shows "Item @ RD$ price"')}
              {rcptRow('receipt_show_exempt_label',
                'Etiqueta EXENTO en items 0% ITBIS', 'EXENTO label on 0% ITBIS items',
                'Imprime "[EXENTO ITBIS]" en productos exentos (normativa DGII)',
                'Prints "[EXENTO ITBIS]" on tax-exempt items (DGII normative)')}
              {rcptRow('receipt_show_client_address',
                'Dirección del cliente en E31', 'Client address on E31',
                'Imprime la dirección del cliente cuando el comprobante es Crédito Fiscal',
                'Prints the client address when the receipt is Credit Fiscal')}
              {rcptRow('receipt_show_servicio_ley',
                'Servicio 10% Ley 16-92', 'Service 10% Law 16-92',
                'Imprime "Servicio Ley 10%" cuando el ticket carga propina de servicio',
                'Prints "Servicio Ley 10%" when the ticket carries service tip')}
              {rcptRow('receipt_show_credit_ref',
                'Referencia NCF en notas de crédito', 'NCF reference on credit notes',
                'En E33/E34 imprime "MODIFICA NCF" con el NCF del comprobante original',
                'On E33/E34 prints "MODIFICA NCF" with the original NCF')}
              {rcptRow('receipt_show_vehicle_details',
                'Detalles del vehículo (marca/modelo/VIN)', 'Vehicle details (make/model/VIN)',
                'Imprime VIN, marca, modelo y kilometraje cuando están disponibles',
                'Prints VIN, make, model and odometer when available')}
              {rcptRow('receipt_show_contact_extra',
                'Email/IG/Website del negocio', 'Business email/IG/website',
                'Línea adicional en el encabezado con email, @instagram y sitio web',
                'Extra header line with email, @instagram and website')}
              {rcptRow('receipt_show_loyalty',
                'Puntos de fidelidad en el recibo', 'Loyalty points on receipt',
                'Imprime "Acumulas +N pts" y "Saldo total" cuando el cliente tiene puntos',
                'Prints "Acumulas +N pts" and "Saldo total" when the client has points')}
            </>
          )
        })()}
        {/* Customizable footer message — text input (capped at 42 chars). */}
        <SettingRow
          settingKey="receipt_footer_message"
          label={L('Mensaje al pie del recibo', 'Receipt footer message')}
          hint={L(
            `Máx 42 caracteres. Vacío usa: "${RECEIPT_DEFAULT_FOOTER}"`,
            `Max 42 chars. Empty uses: "${RECEIPT_DEFAULT_FOOTER}"`,
          )}
        >
          <input
            type="text"
            maxLength={42}
            value={cfg.receipt_footer_message || ''}
            onChange={e => set('receipt_footer_message', e.target.value)}
            placeholder={RECEIPT_DEFAULT_FOOTER}
            className="w-72 max-w-full px-3 py-1.5 text-[13px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40"
          />
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
  const { cfg, set, handleSave, saving, saved, toast, show } = useSettings()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [testOpen, setTestOpen] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testSending, setTestSending] = useState(false)

  async function sendTestWa() {
    const phone = String(testPhone || '').trim()
    if (!phone) return
    setTestSending(true)
    try {
      const r = await fetch('/api/panel?action=salon-whatsapp-send-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ test_message: true, test_phone: phone }),
      })
      if (r.status === 429) {
        show(L('Espera 1 minuto e intenta de nuevo', 'Wait 1 minute and try again'), 'error')
      } else if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        if (j?.error === 'invalid_phone') {
          show(L('Teléfono inválido', 'Invalid phone'), 'error')
        } else {
          show(L('No se pudo enviar', 'Could not send'), 'error')
        }
      } else {
        show(L(`Mensaje enviado a ${phone}`, `Message sent to ${phone}`))
        setTestOpen(false)
        setTestPhone('')
      }
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.whatsappsettings' }) } catch {}
      show(L('Error de red', 'Network error'), 'error')
    }
    setTestSending(false)
  }

  return (
    <div className="max-w-2xl">
      <Toast toast={toast} />
      <SettingSection id="whatsapp" title="WhatsApp (UltraMsg)">
        <SettingRow label="Instance ID" hint={L('ID de instancia UltraMsg', 'UltraMsg instance ID')}>
          <Input type="text" value={cfg.whatsapp_instance} onChange={e => set('whatsapp_instance', e.target.value)} placeholder="instance166620" className="w-44" />
        </SettingRow>
        <SettingRow label="Token" hint={L('Token de autenticacion', 'Auth token')}>
          <Input type="text" value={cfg.whatsapp_token} onChange={e => set('whatsapp_token', e.target.value)} placeholder="token..." className="w-44" />
        </SettingRow>
        <SettingRow label={L('Probar conexión', 'Test connection')} hint={L('Envía un mensaje de prueba a un número.', 'Sends a test message to a phone.')}>
          <button
            type="button"
            onClick={() => setTestOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e] hover:text-white rounded-lg text-[12px] font-bold transition-colors"
          >
            <Send size={12}/> {L('Enviar prueba WhatsApp', 'Send WhatsApp test')}
          </button>
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

      {testOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-w-sm w-full p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <Send size={14} className="text-[#b3001e]" />
                {L('Enviar prueba WhatsApp', 'Send WhatsApp test')}
              </h3>
              <button onClick={() => setTestOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
                <IconX size={14} className="text-slate-500 dark:text-white/50"/>
              </button>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-white/60 mb-3">
              {L('Ingresa un número de teléfono para enviar un mensaje de prueba.', 'Enter a phone number to send a test message.')}
            </p>
            <input
              type="tel"
              autoFocus
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              placeholder="809-555-0123"
              className="w-full px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-[#b3001e] focus:ring-1 focus:ring-[#b3001e]/30"
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setTestOpen(false)}
                disabled={testSending}
                className="px-3 py-1.5 text-[12px] rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10"
              >
                {L('Cancelar', 'Cancel')}
              </button>
              <button
                onClick={sendTestWa}
                disabled={testSending || !testPhone.trim()}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold flex items-center gap-1.5 disabled:opacity-60"
              >
                {testSending && <Loader2 size={11} className="animate-spin" />}
                {L('Enviar', 'Send')}
              </button>
            </div>
          </div>
        </div>
      )}
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
          <p className="text-[22px] font-bold text-slate-800 dark:text-white">Terminal X <span className="text-[#b3001e]">V1</span></p>
          <p className="text-[12px] text-slate-500 dark:text-white/60 mt-0.5 font-mono">build v{version} · Studio X Tech</p>
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
    try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.withtimeout' }) } catch {}
    return { status: 'fail', detail: e?.message === 'timeout' ? 'Timeout 5s' : 'No se pudo verificar' }
  }
}

function getSupabaseHost() {
  try {
    const url = import.meta.env?.VITE_SUPABASE_URL
    if (url) return new URL(url).host
  } catch (_aetherErr) {
    try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.withtimeout' }) } catch {}}
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
    try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.withtimeout' }) } catch {}
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
    try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.withtimeout' }) } catch {}
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
  } catch (_aetherErr) {
    try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.withtimeout' }) } catch {}
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
    try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.getsupabasehost' }) } catch {}
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
    try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.getsupabasehost' }) } catch {}
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
    </div>
  )
}

// ── v2.16.3 — Carnicería multi-scale CRUD (Settings → Báscula) ───────────────
export function CarniceriaScalesSection({ L, api, show }) {
  const [scales, setScales] = useState([])
  const [editing, setEditing] = useState(null)

  async function load() {
    try {
      const rows = await api?.carniceria?.scales?.list?.() || []
      setScales(rows)
      // Re-hydrate the runtime registry so POS picks up the change without
      // a restart. Active scale is the row with active_default=1.
      _ScaleRegistry.hydrate(rows)
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.sistema' }) } catch {} setScales([]) }
  }
  useEffect(() => { load() }, [])

  async function save(row) {
    try {
      if (row.id) await api?.carniceria?.scales?.update?.(row)
      else        await api?.carniceria?.scales?.create?.(row)
      show(L('Báscula guardada ✓', 'Scale saved ✓'))
      setEditing(null); load()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'sistema.sistema' }) } catch {} show(L('Error al guardar', 'Error saving'), 'error') }
  }
  async function del(id) {
    if (!confirm(L('¿Eliminar esta báscula?', 'Delete this scale?'))) return
    try { await api?.carniceria?.scales?.remove?.(id); load() } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.sistema' }) } catch {}}
  }
  async function setActiveDefault(id) {
    try { await api?.carniceria?.scales?.setActiveDefault?.(id); load() } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'sistema.sistema' }) } catch {}}
  }

  return (
    <SettingSection title={L('Básculas (Carnicería)', 'Scales (Butcher)')}>
      <div className="space-y-2">
        {scales.length === 0 && (
          <p className="text-[12px] text-slate-400 px-2 py-3">
            {L('No hay básculas registradas. Agrega la báscula de plataforma o de banco.', 'No scales registered. Add the platform or bench scale.')}
          </p>
        )}
        {scales.map(s => (
          <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-slate-800 dark:text-white">
                {s.nombre} <span className="text-[10px] font-normal text-slate-400">· {s.tipo}</span>
                {s.active_default && <span className="ml-2 px-1.5 py-0.5 rounded bg-[#b3001e] text-white text-[9px] font-bold">ACTIVA</span>}
              </p>
              <p className="text-[10px] text-slate-400">{s.protocol} · {s.baud_rate} bps · {s.device_path || '—'}</p>
            </div>
            {!s.active_default && (
              <button onClick={() => setActiveDefault(s.id)}
                className="px-2.5 py-1 text-[11px] font-semibold border border-slate-200 dark:border-white/10 rounded-lg text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
                {L('Activar', 'Activate')}
              </button>
            )}
            <button onClick={() => setEditing(s)}
              className="px-2.5 py-1 text-[11px] font-semibold border border-slate-200 dark:border-white/10 rounded-lg text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
              {L('Editar', 'Edit')}
            </button>
            <button onClick={() => del(s.id)}
              className="px-2 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">×</button>
          </div>
        ))}
        <button onClick={() => setEditing({ tipo: 'plataforma', protocol: 'generic', baud_rate: 9600, active: 1 })}
          className="w-full px-3 py-2 text-[12px] font-bold bg-[#b3001e] hover:bg-[#c8002a] text-white rounded-lg">
          + {L('Agregar báscula', 'Add scale')}
        </button>
      </div>
      {editing && <ScaleEditor row={editing} onSave={save} onClose={() => setEditing(null)} L={L} />}
    </SettingSection>
  )
}

function ScaleEditor({ row, onSave, onClose, L }) {
  const [d, setD] = useState(row)
  const set = (k, v) => setD(p => ({ ...p, [k]: v }))
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 p-6 w-[460px] max-w-[92vw] shadow-2xl space-y-3">
        <h3 className="font-bold dark:text-white">{row.id ? L('Editar Báscula', 'Edit Scale') : L('Nueva Báscula', 'New Scale')}</h3>
        <input value={d.nombre || ''} onChange={e => set('nombre', e.target.value)} placeholder={L('Nombre (ej: Plataforma trasera)', 'Name (e.g. Back platform)')}
          className="w-full px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25" />
        <div className="grid grid-cols-2 gap-2">
          <select value={d.tipo} onChange={e => set('tipo', e.target.value)}
            className="px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px]">
            <option value="plataforma">{L('Plataforma', 'Platform')}</option>
            <option value="banco">{L('Banco', 'Bench')}</option>
            <option value="otra">{L('Otra', 'Other')}</option>
          </select>
          <select value={d.protocol} onChange={e => set('protocol', e.target.value)}
            className="px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px]">
            <option value="generic">Generic</option>
            <option value="cas-pdii">CAS PD-II</option>
            <option value="toledo">Toledo</option>
            <option value="mock">Mock</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={d.device_path || ''} onChange={e => set('device_path', e.target.value)} placeholder="COM3 / /dev/ttyUSB0"
            className="px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px]" />
          <input type="number" value={d.baud_rate || 9600} onChange={e => set('baud_rate', Number(e.target.value))} placeholder="9600"
            className="px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" step="0.001" value={d.tare_default || 0} onChange={e => set('tare_default', Number(e.target.value))} placeholder={L('Tara por defecto', 'Default tare')}
            className="px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px]" />
          <input type="number" step="0.1" value={d.capacidad_max_lb || ''} onChange={e => set('capacidad_max_lb', Number(e.target.value))} placeholder={L('Cap. máx (lb)', 'Max cap (lb)')}
            className="px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px]" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3 py-2 text-[12px] font-semibold bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 dark:text-white rounded-lg">{L('Cancelar', 'Cancel')}</button>
          <button onClick={() => onSave(d)} disabled={!d.nombre}
            className="flex-1 px-3 py-2 text-[12px] font-bold bg-[#b3001e] hover:bg-[#c8002a] text-white rounded-lg disabled:opacity-50">
            {L('Guardar', 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}
