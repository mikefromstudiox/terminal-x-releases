import { useState, useEffect } from 'react'
import {
  Settings, KeyRound, CheckCircle2, Loader2, AlertCircle, Printer,
} from 'lucide-react'
import { useLang } from '../i18n'
import { hasIPC } from '../hooks/useDB'
import LicenseAdmin from './LicenseAdmin'

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
      toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-slate-800 text-white'
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
      } ${enabled ? 'bg-sky-500' : 'bg-slate-200'}`}
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
        <p className="text-[13px] font-semibold text-slate-700">{label}</p>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingSection({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{title}</p>
      <div className="border border-slate-200 rounded-xl px-4 divide-y divide-slate-100">
        {children}
      </div>
    </div>
  )
}

function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[12px] text-slate-700 bg-white
        focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20 placeholder:text-slate-300 ${className}`}
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
  ley_enabled:        '1',
  itbis_pct:          '18',
  usd_rate:           '61.00',
  rnc_verify:         '1',
  sucursales:         '0',
  beverages_in_pos:   '1',
  auto_backup:        '0',
  printer:            '',
  print_preticket:    '0',
  print_factura_auto: '0',
  print_conduce_auto: '0',
}

function Configuracion() {
  const { lang, setLang } = useLang()
  const { toast, show }   = useToast()

  const [cfg,      setCfg]      = useState(SISTEMA_DEFAULTS)
  const [printers, setPrinters] = useState([])
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  useEffect(() => {
    if (!hasIPC()) return
    window.electronAPI.settings.get().then(s => {
      if (!s) return
      setCfg(prev => ({
        ...prev,
        ...Object.fromEntries(
          Object.keys(SISTEMA_DEFAULTS)
            .filter(k => s[k] != null)
            .map(k => [k, s[k]])
        ),
      }))
    }).catch(() => {})

    window.electronAPI.listPrinters().then(list => {
      if (Array.isArray(list)) setPrinters(list)
    }).catch(() => {})
  }, [])

  function set(k, v) { setCfg(c => ({ ...c, [k]: v })) }
  const on = k => cfg[k] === '1'

  async function handleSave() {
    setSaving(true)
    try {
      await window.electronAPI.settings.update(cfg)
      setSaved(true)
      show(lang === 'es' ? 'Configuración guardada ✓' : 'Settings saved ✓')
      setTimeout(() => setSaved(false), 2500)
    } catch {
      show(lang === 'es' ? 'Error al guardar' : 'Error saving', 'error')
    } finally { setSaving(false) }
  }

  async function testPrint() {
    try {
      await window.electronAPI.print({ type: 'test', data: {}, printerName: cfg.printer || undefined })
      show(lang === 'es' ? 'Prueba de impresión enviada ✓' : 'Test print sent ✓')
    } catch {
      show(lang === 'es' ? 'Error al imprimir' : 'Printer error', 'error')
    }
  }

  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="max-w-2xl">
      <Toast toast={toast} />

      {/* ── Language ─────────────────────────────────────────────────────────── */}
      <SettingSection title={L('Idioma del Sistema', 'System Language')}>
        <SettingRow label={L('Idioma / Language', 'Language / Idioma')} hint={L('Cambia el idioma de toda la app inmediatamente', 'Changes app language immediately')}>
          <div className="flex gap-2">
            <button
              onClick={() => setLang('es')}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-colors ${
                lang === 'es'
                  ? 'bg-[#0C447C] border-[#0C447C] text-white'
                  : 'border-slate-200 text-slate-500 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              🇩🇴 ES
            </button>
            <button
              onClick={() => setLang('en')}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-colors ${
                lang === 'en'
                  ? 'bg-[#0C447C] border-[#0C447C] text-white'
                  : 'border-slate-200 text-slate-500 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              🇺🇸 EN
            </button>
          </div>
        </SettingRow>
      </SettingSection>

      {/* ── Calculations ─────────────────────────────────────────────────────── */}
      <SettingSection title={L('Cálculos', 'Calculations')}>
        <SettingRow
          label="Ley 10%"
          hint={L('Cargo de servicio aplicado a todas las facturas', 'Service charge applied to all invoices')}
        >
          <Toggle enabled={on('ley_enabled')} onChange={v => set('ley_enabled', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('ITBIS %', 'ITBIS %')}
          hint={L('Porcentaje del impuesto (defecto: 18)', 'Tax rate percentage (default: 18)')}
        >
          <Input
            type="number" min="0" max="100"
            value={cfg.itbis_pct}
            onChange={e => set('itbis_pct', e.target.value)}
            className="w-20 text-center"
          />
        </SettingRow>

        <SettingRow
          label={L('Tasa Cambio USD', 'USD Exchange Rate')}
          hint="RD$ por USD"
        >
          <Input
            type="number" min="0" step="0.01"
            value={cfg.usd_rate}
            onChange={e => set('usd_rate', e.target.value)}
            className="w-24 text-center"
          />
        </SettingRow>
      </SettingSection>

      {/* ── Fiscal ───────────────────────────────────────────────────────────── */}
      <SettingSection title={L('Fiscal', 'Tax & Compliance')}>
        <SettingRow
          label={L('Verificar RNC/NCF', 'Verify RNC/NCF')}
          hint={L('Valida RNC contra el API de DGII', 'Validates RNC against DGII API')}
        >
          <Toggle enabled={on('rnc_verify')} onChange={v => set('rnc_verify', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('Sucursales', 'Branches')}
          hint={L('Próximamente — gestión multi-sucursal', 'Coming soon — multi-branch management')}
        >
          <Toggle enabled={on('sucursales')} onChange={v => set('sucursales', v ? '1' : '0')} disabled />
        </SettingRow>
      </SettingSection>

      {/* ── POS ──────────────────────────────────────────────────────────────── */}
      <SettingSection title={L('Punto de Venta', 'Point of Sale')}>
        <SettingRow
          label={L('Bebidas y Snacks en POS', 'Beverages & Snacks in POS')}
          hint={L('Muestra la pestaña Extras en el POS', 'Shows the Extras tab in POS')}
        >
          <Toggle enabled={on('beverages_in_pos')} onChange={v => set('beverages_in_pos', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('Respaldo Automático', 'Auto Backup')}
          hint={L('Genera copia de seguridad automáticamente cada día', 'Generates a backup automatically every day')}
        >
          <Toggle enabled={on('auto_backup')} onChange={v => set('auto_backup', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      {/* ── Printing ─────────────────────────────────────────────────────────── */}
      <SettingSection title={L('Impresión', 'Printing')}>
        <SettingRow
          label={L('Impresora', 'Printer')}
          hint={L('Selecciona la impresora predeterminada del sistema', 'Select the default system printer')}
        >
          <div className="flex items-center gap-2">
            <select
              value={cfg.printer}
              onChange={e => set('printer', e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-700 bg-white focus:outline-none focus:border-sky-400 max-w-[220px]"
            >
              <option value="">{L('Predeterminada del sistema', 'System default')}</option>
              {printers.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.isDefault ? ' ★' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={testPrint}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Printer size={12} />
              {L('Prueba', 'Test')}
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label={L('Imprimir Pre-Ticket', 'Print Pre-Ticket')}
          hint={L('Al añadir el vehículo a la cola', 'When adding the vehicle to the queue')}
        >
          <Toggle enabled={on('print_preticket')} onChange={v => set('print_preticket', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('Imprimir Factura Automáticamente', 'Auto-Print Invoice')}
          hint={L('Al confirmar el cobro', 'On payment confirmation')}
        >
          <Toggle enabled={on('print_factura_auto')} onChange={v => set('print_factura_auto', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('Imprimir Conduce Automáticamente', 'Auto-Print Delivery Note')}
          hint={L('Al confirmar el cobro', 'On payment confirmation')}
        >
          <Toggle enabled={on('print_conduce_auto')} onChange={v => set('print_conduce_auto', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      <div className="flex justify-end mt-2">
        <SaveBtn
          saving={saving}
          saved={saved}
          label={L('Guardar Configuración', 'Save Settings')}
          onClick={handleSave}
        />
      </div>
    </div>
  )
}

// ── MAIN SISTEMA SCREEN ───────────────────────────────────────────────────────

const TABS = [
  { id: 'config',    es: 'Configuración', en: 'Settings',   icon: Settings  },
  { id: 'licencias', es: 'Licencias TX',  en: 'TX Licenses', icon: KeyRound },
]

export default function Sistema() {
  const { lang } = useLang()
  const [tab, setTab] = useState('config')

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-slate-200">
        <h2 className="text-[16px] font-bold text-slate-800">
          {lang === 'es' ? 'Sistema' : 'System'}
        </h2>
        <p className="text-[12px] text-slate-400 mt-0.5">
          {lang === 'es' ? 'Configuración del sistema y gestión de licencias' : 'System settings and license management'}
        </p>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-slate-200 px-6 overflow-x-auto">
        {TABS.map(({ id, es, en, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors shrink-0 ${
              tab === id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} />
            {lang === 'es' ? es : en}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'config' && (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <Configuracion />
        </div>
      )}
      {tab === 'licencias' && (
        <div className="flex-1 overflow-hidden">
          <LicenseAdmin />
        </div>
      )}
    </div>
  )
}
