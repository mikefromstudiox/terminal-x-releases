/**
 * NominaAjustes.jsx — Per-business payroll settings.
 *
 * Edits the single row in `payroll_settings` (desktop) or the per-business
 * row (web). Controls pay cycle, TSS/INFOTEP rates, cotization caps,
 * ISR brackets, and legal constants.
 */

import { useState, useEffect } from 'react'
import { Save, RotateCcw, Info, Check } from 'lucide-react'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'

const DEFAULTS = {
  pay_cycle: 'quincenal',
  sfs_employee_rate: 0.0304,
  afp_employee_rate: 0.0287,
  sfs_employer_rate: 0.0709,
  afp_employer_rate: 0.0710,
  infotep_employer_rate: 0.01,
  sfs_monthly_cap: 232230,
  afp_monthly_cap: 464460,
  isr_enabled: 1,
  isr_brackets: [
    [0,      416220,    0],
    [416220, 624329,    0.15],
    [624329, 867123,    0.20],
    [867123, 999999999, 0.25],
  ],
  navidad_enabled: 1,
  vacation_days: 14,
  daily_divisor: 23.83,
}

function pct(n) { return `${(Number(n) * 100).toFixed(2)}%` }
function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US')}` }

export default function NominaAjustes() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [form, setForm] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const settings = await api?.payrollSettings?.get?.()
        if (!cancelled && settings) {
          setForm({
            ...DEFAULTS,
            ...settings,
            // Ensure isr_brackets is always an array (may arrive as JSON string or parsed)
            isr_brackets: Array.isArray(settings.isr_brackets)
              ? settings.isr_brackets
              : (() => { try { return JSON.parse(settings.isr_brackets || '[]') } catch (_aetherErr) {
                try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'nominaajustes.isr_brackets' }) } catch {} return DEFAULTS.isr_brackets } })(),
          })
        }
      } catch (e) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'nominaajustes.isr_brackets' }) } catch {}
        if (!cancelled) setError(e?.message || L('Error al cargar', 'Error loading'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [api])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setSaved(false) }
  function setBracket(idx, field, v) {
    const next = form.isr_brackets.map(b => [...b])
    next[idx][field] = parseFloat(v) || 0
    setForm(f => ({ ...f, isr_brackets: next }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false)
    try {
      await api.payrollSettings.update({
        ...form,
        isr_enabled: form.isr_enabled ? 1 : 0,
        navidad_enabled: form.navidad_enabled ? 1 : 0,
        isr_brackets: form.isr_brackets,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'nominaajustes.isr_brackets' }) } catch {}
      setError(e?.message || L('Error al guardar', 'Error saving'))
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (!confirm(L('¿Restablecer todos los valores a los valores oficiales 2026?', 'Reset all values to official 2026 defaults?'))) return
    setForm(DEFAULTS)
    setSaved(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 dark:text-white/40 text-sm">{L('Cargando…', 'Loading…')}</div>
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5">
        {/* Info banner */}
        <div className="rounded-xl bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 px-4 py-3 flex items-start gap-3">
          <Info size={16} className="text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
          <div className="text-[12px] text-sky-900 dark:text-sky-200">
            <p className="font-semibold mb-0.5">{L('Valores oficiales República Dominicana 2026', 'Official Dominican Republic 2026 values')}</p>
            <p className="text-[11px] opacity-80">
              {L('TSS: SFS 3.04% + AFP 2.87% empleado · SFS 7.09% + AFP 7.10% empleador. INFOTEP 1% empleador. Topes: SFS RD$232,230 · AFP RD$464,460. ISR exento hasta RD$416,220/año.',
                 'TSS: SFS 3.04% + AFP 2.87% employee · SFS 7.09% + AFP 7.10% employer. INFOTEP 1% employer. Caps: SFS RD$232,230 · AFP RD$464,460. ISR exempt up to RD$416,220/yr.')}
            </p>
          </div>
        </div>

        {/* Pay cycle */}
        <Section title={L('Ciclo de Pago', 'Pay Cycle')}>
          <div className="flex gap-2">
            {[
              { id: 'quincenal', label: L('Quincenal (1-15, 16-fin)', 'Biweekly (1-15, 16-end)') },
              { id: 'mensual',   label: L('Mensual (1 al fin de mes)', 'Monthly (1st to end of month)') },
            ].map(opt => (
              <button key={opt.id} onClick={() => set('pay_cycle', opt.id)}
                className={`flex-1 px-4 py-3 rounded-xl text-[12px] font-bold transition-colors border ${
                  form.pay_cycle === opt.id
                    ? 'bg-[#0C447C] text-white border-[#0C447C]'
                    : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Employee-side TSS */}
        <Section title={L('TSS — Retenciones al Empleado', 'TSS — Employee Withholdings')}>
          <div className="grid grid-cols-2 gap-3">
            <RateField label="SFS" value={form.sfs_employee_rate} onChange={v => set('sfs_employee_rate', v)} />
            <RateField label="AFP" value={form.afp_employee_rate} onChange={v => set('afp_employee_rate', v)} />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-white/40 mt-2">
            Total empleado: <strong className="text-slate-700 dark:text-white">{pct(form.sfs_employee_rate + form.afp_employee_rate)}</strong>
          </p>
        </Section>

        {/* Employer-side TSS + INFOTEP */}
        <Section title={L('Cargas del Empleador', 'Employer Load')}>
          <div className="grid grid-cols-3 gap-3">
            <RateField label="SFS" value={form.sfs_employer_rate} onChange={v => set('sfs_employer_rate', v)} />
            <RateField label="AFP" value={form.afp_employer_rate} onChange={v => set('afp_employer_rate', v)} />
            <RateField label="INFOTEP" value={form.infotep_employer_rate} onChange={v => set('infotep_employer_rate', v)} />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-white/40 mt-2">
            Total empleador: <strong className="text-slate-700 dark:text-white">{pct(form.sfs_employer_rate + form.afp_employer_rate + form.infotep_employer_rate)}</strong>
          </p>
        </Section>

        {/* Cotization caps */}
        <Section title={L('Topes de Cotización Mensual', 'Monthly Cotization Caps')}>
          <div className="grid grid-cols-2 gap-3">
            <MoneyField label={L('Tope SFS', 'SFS cap')} value={form.sfs_monthly_cap} onChange={v => set('sfs_monthly_cap', v)} hint="10× salario mínimo" />
            <MoneyField label={L('Tope AFP', 'AFP cap')} value={form.afp_monthly_cap} onChange={v => set('afp_monthly_cap', v)} hint="20× salario mínimo" />
          </div>
        </Section>

        {/* ISR */}
        <Section title="ISR (Impuesto Sobre la Renta)">
          <label className="flex items-center gap-2 mb-3 cursor-pointer">
            <input type="checkbox" checked={!!form.isr_enabled} onChange={e => set('isr_enabled', e.target.checked ? 1 : 0)}
              className="w-4 h-4 rounded accent-[#0C447C]" />
            <span className="text-[12px] text-slate-700 dark:text-white/80">
              {L('Calcular y retener ISR automáticamente en cada pago', 'Auto-calculate and withhold ISR on each paycheck')}
            </span>
          </label>
          {form.isr_enabled ? (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                <span>{L('Escala', 'Bracket')}</span>
                <span className="text-right">{L('Desde (anual)', 'From (annual)')}</span>
                <span className="text-right">{L('Hasta (anual)', 'To (annual)')}</span>
                <span className="text-right">{L('Tasa', 'Rate')}</span>
              </div>
              {form.isr_brackets.map((b, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-2 items-center">
                  <span className="text-[11px] text-slate-500 dark:text-white/60">
                    {idx === 0 ? L('1ra (exento)', '1st (exempt)') : idx === 1 ? '2da (15%)' : idx === 2 ? '3ra (20%)' : '4ta (25%)'}
                  </span>
                  <input type="number" min="0" value={b[0]} onChange={e => setBracket(idx, 0, e.target.value)}
                    className="px-2 py-1.5 text-[12px] text-right border border-slate-200 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white" />
                  <input type="number" min="0" value={b[1] === 999999999 ? '' : b[1]} placeholder="∞" onChange={e => setBracket(idx, 1, e.target.value || 999999999)}
                    className="px-2 py-1.5 text-[12px] text-right border border-slate-200 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white" />
                  <input type="number" min="0" max="1" step="0.01" value={b[2]} onChange={e => setBracket(idx, 2, e.target.value)}
                    className="px-2 py-1.5 text-[12px] text-right border border-slate-200 dark:border-white/10 rounded-lg dark:bg-white/5 dark:text-white" />
                </div>
              ))}
              <p className="text-[10px] text-slate-400 dark:text-white/40 mt-2">
                {L('Valores en RD$ anuales. La tasa es marginal (solo el exceso de cada escala).',
                   'Values in RD$ annual. Rate is marginal (only excess of each bracket).')}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 dark:text-white/40 italic">{L('ISR deshabilitado — deberá ingresarse manualmente en cada pago.', 'ISR disabled — must be entered manually on each paycheck.')}</p>
          )}
        </Section>

        {/* Legal constants */}
        <Section title={L('Constantes Legales (Ley 16-92)', 'Legal Constants (Law 16-92)')}>
          <div className="grid grid-cols-2 gap-3">
            <NumField label={L('Días vacaciones/año', 'Vacation days/year')} value={form.vacation_days} onChange={v => set('vacation_days', v)} min={0} step={1} />
            <NumField label={L('Divisor diario', 'Daily divisor')} value={form.daily_divisor} onChange={v => set('daily_divisor', v)} min={0} step={0.01} />
          </div>
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input type="checkbox" checked={!!form.navidad_enabled} onChange={e => set('navidad_enabled', e.target.checked ? 1 : 0)}
              className="w-4 h-4 rounded accent-[#0C447C]" />
            <span className="text-[12px] text-slate-700 dark:text-white/80">
              {L('Acumular salario de Navidad (Art. 219)', 'Accrue Christmas bonus (Art. 219)')}
            </span>
          </label>
        </Section>

        {/* Error */}
        {error && <p className="text-[12px] text-red-500 dark:text-red-400">{error}</p>}

        {/* Action bar */}
        <div className="flex items-center gap-2 sticky bottom-0 py-3 bg-gradient-to-t from-white dark:from-zinc-900 to-transparent">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold rounded-xl disabled:opacity-50 transition-colors">
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saving ? L('Guardando…', 'Saving…') : saved ? L('Guardado', 'Saved') : L('Guardar cambios', 'Save changes')}
          </button>
          <button onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-xl hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
            <RotateCcw size={13} /> {L('Restablecer defaults', 'Reset defaults')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Small internal field helpers ──────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 md:p-5">
      <h3 className="text-[12px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

function RateField({ label, value, onChange }) {
  // Stores rate as decimal (0.0304) but shows as percent (3.04)
  const pctValue = (Number(value || 0) * 100).toString()
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{label} (%)</label>
      <input type="number" min="0" max="100" step="0.01" value={pctValue}
        onChange={e => onChange(parseFloat(e.target.value || 0) / 100)}
        className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
    </div>
  )
}

function MoneyField({ label, value, onChange, hint }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{label}</label>
      <input type="number" min="0" step="1" value={value}
        onChange={e => onChange(parseFloat(e.target.value || 0))}
        className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
      {hint && <p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">{hint}</p>}
    </div>
  )
}

function NumField({ label, value, onChange, min, step }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{label}</label>
      <input type="number" min={min} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value || 0))}
        className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] dark:text-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
    </div>
  )
}
