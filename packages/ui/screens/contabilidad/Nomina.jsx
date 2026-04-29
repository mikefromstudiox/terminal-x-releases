// Nomina — Contabilidad payroll module: Períodos · Empleados · Cálculo · TSS / IR-3.
// Plan-gated by `contabilidad_nomina`. Uses calcPayroll (Ley 87-01 + ISR 2026)
// and packages/services/dgii-reports.js IR-3 generator (already wired in Slice 2).
//
// Functional flow:
//   1. Pick cliente + período (year/month)
//   2. Crear período → empty draft
//   3. Add empleados manually OR copy roster from previous period
//   4. Edit salario_base + dependientes → calc auto-runs (deducciones SDSS + ISR)
//   5. Postear período → status='posted', auto-creates journal entry (debit
//      Gastos de Personal, credit Cuentas por Pagar/Caja según seleccion)
//   6. Exportar TSS TXT (proxy via IR-3 generator) y PDF de volante por empleado
//
// All Spanish, brand palette #b3001e/black/white only.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, Plus, Trash2, Loader2, FileDown, Check, Lock, X, Calculator, MessageCircle, Banknote,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { usePlan } from '../../hooks/usePlan'
import { calcPayroll, DR_PAYROLL_RATES } from '@terminal-x/config/drPayrollRates.js'
import {
  genBhdLeonNomina, genBanreservasNomina, genGenericCsvNomina, downloadBankFile,
} from '@terminal-x/services/bankDisbursement.js'

const DR_BANKS = [
  { code: 'BHD',       label: 'BHD León' },
  { code: 'BRES',      label: 'Banreservas' },
  { code: 'POPULAR',   label: 'Banco Popular' },
  { code: 'SCOTIA',    label: 'Scotiabank' },
  { code: 'PROGRESO',  label: 'Banco del Progreso' },
  { code: 'CARIBE',    label: 'Banco Caribe' },
  { code: 'SANTACRUZ', label: 'Banco Santa Cruz' },
  { code: 'PROMERICA', label: 'Banco Promerica' },
  { code: 'LAFISE',    label: 'Banco Lafise' },
  { code: 'ADEMI',     label: 'Banco Ademi' },
  { code: 'ADOPEM',    label: 'Banco Adopem' },
  { code: 'OTRO',      label: 'Otro' },
]

const MONTHS = [
  '01 - Enero','02 - Febrero','03 - Marzo','04 - Abril','05 - Mayo','06 - Junio',
  '07 - Julio','08 - Agosto','09 - Septiembre','10 - Octubre','11 - Noviembre','12 - Diciembre',
]

function fmtRD(n) { return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function todayISO() { return new Date().toISOString().slice(0, 10) }

function ComingSoon() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-6">
        <div className="flex items-center gap-2 text-[#b3001e] font-bold mb-2"><Lock size={16}/> Próximamente</div>
        <div className="text-sm text-black/80 dark:text-white/80">
          El módulo Nómina requiere el plan Pro CTB o Pro MAX. Contáctanos por WhatsApp para activar.
        </div>
      </div>
    </div>
  )
}

function ClientPicker({ clients, value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
      <option value="">— Cliente —</option>
      {(clients || []).map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
    </select>
  )
}

function PeriodPicker({ year, month, onYear, onMonth }) {
  const today = new Date()
  const years = [today.getFullYear() + 1, today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2]
  return (
    <div className="flex gap-2">
      <select value={year} onChange={(e) => onYear(Number(e.target.value))}
        className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select value={month} onChange={(e) => onMonth(Number(e.target.value))}
        className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
        {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
      </select>
    </div>
  )
}

// ── Empleado modal ────────────────────────────────────────────────────────────

function EmployeeModal({ initial, onClose, onSave, busy }) {
  const [form, setForm] = useState({
    employee_name:    initial?.employee_name    || '',
    employee_cedula:  initial?.employee_cedula  || '',
    employee_nss:     initial?.employee_nss     || '',
    salario_base:     Number(initial?.salario_base || 0),
    dependientes:     Number(initial?.dependientes || 0),
    otras_deducciones: Number(initial?.otras_deducciones || 0),
    cuenta_destino:   initial?.cuenta_destino   || '',
    banco_destino:    initial?.banco_destino    || '',
    tipo_cuenta:      initial?.tipo_cuenta      || '',
    employee_email:   initial?.employee_email   || '',
  })
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  const calc = useMemo(() => calcPayroll({
    salarioBase: Number(form.salario_base) || 0,
    dependientes: Number(form.dependientes) || 0,
  }), [form.salario_base, form.dependientes])
  const otras = Math.max(0, Number(form.otras_deducciones) || 0)
  const netoFinal = Math.max(0, calc.neto - otras)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-xl w-full p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold inline-flex items-center gap-2"><Users size={16}/> {initial?.id ? 'Editar empleado' : 'Nuevo empleado'}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">Nombre completo
            <input value={form.employee_name} onChange={(e) => set('employee_name', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Cédula
              <input value={form.employee_cedula} onChange={(e) => set('employee_cedula', e.target.value.replace(/\D/g, '').slice(0, 11))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono"/>
            </label>
            <label className="block text-xs font-bold">NSS (opcional)
              <input value={form.employee_nss} onChange={(e) => set('employee_nss', e.target.value.replace(/\D/g, ''))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono"/>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Salario base mensual (RD$)
              <input type="number" min="0" step="0.01" value={form.salario_base} onChange={(e) => set('salario_base', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
            <label className="block text-xs font-bold">Dependientes (informativo)
              <input type="number" min="0" max="20" value={form.dependientes} onChange={(e) => set('dependientes', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
          </div>
          <label className="block text-xs font-bold">Otras deducciones (préstamos, embargos…)
            <input type="number" min="0" step="0.01" value={form.otras_deducciones} onChange={(e) => set('otras_deducciones', Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
          </label>

          <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3 bg-white dark:bg-black/40">
            <div className="text-xs font-bold mb-2 inline-flex items-center gap-2"><Banknote size={14}/> Datos bancarios (Pago Masivo)</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold">Banco destino
                <select value={form.banco_destino} onChange={(e) => set('banco_destino', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
                  <option value="">— Seleccionar —</option>
                  {DR_BANKS.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold">Tipo de cuenta
                <select value={form.tipo_cuenta} onChange={(e) => set('tipo_cuenta', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
                  <option value="">— Seleccionar —</option>
                  <option value="corriente">Corriente</option>
                  <option value="ahorros">Ahorros</option>
                </select>
              </label>
            </div>
            <label className="block text-xs font-bold mt-2">Cuenta destino (número)
              <input value={form.cuenta_destino} onChange={(e) => set('cuenta_destino', e.target.value.replace(/\D+/g, '').slice(0, 20))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono"/>
            </label>
            <label className="block text-xs font-bold mt-2">Email para notificación (opcional)
              <input type="email" value={form.employee_email} onChange={(e) => set('employee_email', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
            </label>
            <div className="text-[10px] text-black/50 dark:text-white/50 mt-2">Se guarda en la nómina y en el roster del cliente — no hay que volver a escribirlo el próximo mes.</div>
          </div>

          {Number(form.salario_base) > 0 && (
            <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-3 text-xs">
              <div className="font-bold mb-2 flex items-center gap-2 text-[#b3001e]"><Calculator size={14}/> Cálculo Ley 87-01 (RD 2026)</div>
              <div className="grid grid-cols-2 gap-1">
                <div>AFP empleado (2.87%)</div><div className="text-right font-mono">{fmtRD(calc.afp)}</div>
                <div>SFS empleado (3.04%)</div><div className="text-right font-mono">{fmtRD(calc.sfs)}</div>
                <div>ISR (escala progresiva)</div><div className="text-right font-mono">{fmtRD(calc.isr)}</div>
                <div>Otras deducciones</div><div className="text-right font-mono">{fmtRD(otras)}</div>
                <div className="font-bold pt-1 border-t border-black/10 dark:border-white/10">Total deducciones</div>
                <div className="text-right font-mono font-bold pt-1 border-t border-black/10 dark:border-white/10">{fmtRD(calc.totalDeducciones + otras)}</div>
                <div className="font-bold text-[#b3001e]">Neto a pagar</div>
                <div className="text-right font-mono font-bold text-[#b3001e]">RD$ {fmtRD(netoFinal)}</div>
                <div className="text-black/60 dark:text-white/60 pt-1">Costo empleador (incluye AFP/SFS/SRL patronal)</div>
                <div className="text-right font-mono text-black/60 dark:text-white/60 pt-1">{fmtRD(calc.employerCost)}</div>
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy || !form.employee_name || Number(form.salario_base) <= 0}
            onClick={() => onSave({
              ...form,
              afp: calc.afp, sfs: calc.sfs, ars: calc.ars,
              riesgos_laborales: 0, // empleado no aporta SRL
              isr: calc.isr,
              otras_deducciones: otras,
              neto: netoFinal,
              cuenta_destino: form.cuenta_destino || null,
              banco_destino:  form.banco_destino  || null,
              tipo_cuenta:    form.tipo_cuenta    || null,
              employee_email: form.employee_email || null,
            })}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50">
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Período list / create ─────────────────────────────────────────────────────

function PeriodosList({ api, clientId, year, periods, reload, onSelect, currentMonth }) {
  const [busy, setBusy] = useState(false)

  async function createForMonth(month) {
    if (!clientId) return alert('Selecciona un cliente.')
    if (periods.find(p => p.year === year && p.month === month)) return alert('Ya existe un período para ese mes.')
    setBusy(true)
    try {
      await api.contabilidad.payrollPeriodCreate({ accounting_client_id: clientId, year, month, status: 'draft' })
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function remove(id) {
    if (!confirm('¿Eliminar este período y sus empleados?')) return
    setBusy(true)
    try { await api.contabilidad.payrollPeriodDelete(id); await reload() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const byMonth = new Map(periods.map(p => [Number(p.month), p]))

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs text-black/60 dark:text-white/60">
        Períodos {year}. Crea uno nuevo haciendo clic en el mes correspondiente.
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {months.map(m => {
          const p = byMonth.get(m)
          const exists = !!p
          const isCurrent = m === currentMonth
          return (
            <div key={m} className={`rounded-2xl border p-3 ${isCurrent ? 'border-[#b3001e]/40 bg-[#b3001e]/5' : 'border-black/10 dark:border-white/10'}`}>
              <div className="text-xs font-bold mb-1">{MONTHS[m - 1]}</div>
              {exists ? (
                <div className="space-y-1">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border
                    ${p.status === 'posted' ? 'bg-[#b3001e] text-white border-[#b3001e]'
                    : p.status === 'paid'   ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                    : 'bg-white text-black border-black/20 dark:bg-black dark:text-white dark:border-white/20'}`}>
                    {p.status === 'posted' ? 'Posteado' : p.status === 'paid' ? 'Pagado' : 'Borrador'}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => onSelect(p.id)} className="flex-1 px-2 py-1 rounded-lg bg-[#b3001e] text-white text-xs font-bold hover:bg-[#8f0018]">Abrir</button>
                    {p.status !== 'posted' && p.status !== 'paid' && (
                      <button onClick={() => remove(p.id)} className="px-2 py-1 rounded-lg border border-black/10 dark:border-white/10 text-black/60 dark:text-white/60 hover:text-[#b3001e]"><Trash2 size={12}/></button>
                    )}
                  </div>
                </div>
              ) : (
                <button disabled={busy} onClick={() => createForMonth(m)}
                  className="w-full px-2 py-1 rounded-lg border border-dashed border-black/20 dark:border-white/20 text-xs font-bold text-black/60 dark:text-white/60 hover:border-[#b3001e] hover:text-[#b3001e] disabled:opacity-50">
                  + Crear
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Período detail (empleados + post + IR-3) ─────────────────────────────────

function PeriodDetail({ api, clientId, period, accounts, onChange, onClose, clientPhone, clientName, client }) {
  const [lines, setLines] = useState([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [postOpen, setPostOpen] = useState(false)
  const [roster, setRoster] = useState([])
  const [disbursementOpen, setDisbursementOpen] = useState(false)

  const reload = useCallback(async () => {
    if (!api?.contabilidad || !period?.id) { setLines([]); return }
    const ll = await api.contabilidad.payrollLineList({ payrollPeriodId: period.id, payrollPeriodSupabaseId: period.supabase_id })
    setLines(ll || [])
  }, [api, period])

  useEffect(() => { reload() }, [reload])

  // Load roster bank cache for this client.
  useEffect(() => {
    let cancelled = false
    async function loadRoster() {
      if (!api?.contabilidad?.payrollEmpBankList || !clientId) { setRoster([]); return }
      const r = await api.contabilidad.payrollEmpBankList({ accountingClientId: clientId })
      if (!cancelled) setRoster(r || [])
    }
    loadRoster()
    return () => { cancelled = true }
  }, [api, clientId])

  // Hydrate edit form with roster bank data when adding a new employee.
  function startEdit(line) {
    if (line && line.id) { setEditing(line); return }
    // For new employees the modal starts blank; nothing to hydrate yet.
    setEditing(line || {})
  }
  function rosterMatch(cedula) {
    const c = String(cedula || '').replace(/\D+/g, '')
    if (!c) return null
    return roster.find(r => String(r.employee_cedula || '').replace(/\D+/g, '') === c) || null
  }

  const totals = useMemo(() => {
    const t = { salario: 0, afp: 0, sfs: 0, isr: 0, otras: 0, neto: 0, employerCost: 0 }
    for (const l of lines) {
      const sb = Number(l.salario_base || 0)
      t.salario += sb
      t.afp    += Number(l.afp || 0)
      t.sfs    += Number(l.sfs || 0)
      t.isr    += Number(l.isr || 0)
      t.otras  += Number(l.otras_deducciones || 0)
      t.neto   += Number(l.neto || 0)
      // re-derive employer cost so the totals reflect Ley 87-01 patronal aporte
      const c = calcPayroll({ salarioBase: sb })
      t.employerCost += c.employerCost
    }
    return t
  }, [lines])

  async function saveEmployee(form) {
    setBusy(true)
    try {
      // If the user typed only a cédula (and no bank info), borrow whatever the
      // roster cache already has for that empleado so re-entry is unnecessary.
      const cached = rosterMatch(form.employee_cedula)
      const merged = {
        ...form,
        cuenta_destino: form.cuenta_destino || cached?.cuenta_destino || null,
        banco_destino:  form.banco_destino  || cached?.banco_destino  || null,
        tipo_cuenta:    form.tipo_cuenta    || cached?.tipo_cuenta    || null,
        employee_email: form.employee_email || cached?.employee_email || null,
      }

      if (editing?.id) {
        // payrollLineDelete + add (no update endpoint; deterministic replace)
        await api.contabilidad.payrollLineDelete(editing.id)
      }
      await api.contabilidad.payrollLineAdd({
        payroll_period_id: period.id,
        payroll_period_supabase_id: period.supabase_id,
        employee_name: merged.employee_name,
        employee_cedula: merged.employee_cedula,
        employee_nss: merged.employee_nss,
        salario_base: merged.salario_base,
        dependientes: merged.dependientes,
        afp: merged.afp, sfs: merged.sfs, ars: merged.ars,
        riesgos_laborales: merged.riesgos_laborales,
        isr: merged.isr,
        otras_deducciones: merged.otras_deducciones,
        neto: merged.neto,
        cuenta_destino: merged.cuenta_destino,
        banco_destino:  merged.banco_destino,
        tipo_cuenta:    merged.tipo_cuenta,
      })

      // Upsert roster bank cache so the next período auto-fills.
      if (merged.employee_cedula && api?.contabilidad?.payrollEmpBankUpsert &&
          (merged.cuenta_destino || merged.banco_destino || merged.tipo_cuenta || merged.employee_email)) {
        try {
          await api.contabilidad.payrollEmpBankUpsert({
            accounting_client_id: clientId,
            employee_cedula: merged.employee_cedula,
            employee_name:   merged.employee_name,
            employee_email:  merged.employee_email,
            cuenta_destino:  merged.cuenta_destino,
            banco_destino:   merged.banco_destino,
            tipo_cuenta:     merged.tipo_cuenta,
          })
          const r = await api.contabilidad.payrollEmpBankList({ accountingClientId: clientId })
          setRoster(r || [])
        } catch { /* non-fatal: período saved, roster will retry next save */ }
      }

      setEditing(null)
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function generateDisbursement(bank) {
    const rnc = (client?.rnc || client?.cedula || '').replace(/\D+/g, '')
    if (!rnc) {
      alert('El cliente no tiene RNC/cédula configurado. Edítalo en Cartera para generar el archivo de pago.')
      return
    }
    const fecha = `${period.year}-${String(period.month).padStart(2,'0')}-15`
    const cuentaOrigen = window.prompt('Cuenta de origen del cliente (cuenta empresa que paga la nómina):', '') || ''
    const opts = {
      rncEmpresa: rnc,
      cuentaOrigen,
      fecha,
      concepto: `Nomina ${MONTHS[period.month - 1]} ${period.year}`,
      referencia: `NOMINA ${period.year}${String(period.month).padStart(2,'0')}`,
    }
    let res
    try {
      if (bank === 'bhd_leon')         res = genBhdLeonNomina(lines, opts)
      else if (bank === 'banreservas') res = genBanreservasNomina(lines, opts)
      else                             res = genGenericCsvNomina(lines, opts)
    } catch (e) {
      alert(`Error generando archivo: ${e?.message || e}`)
      return
    }
    if (!res.count) {
      alert(`No hay empleados con cuenta destino válida.\n${(res.warnings || []).join('\n')}`)
      return
    }
    const mime = bank === 'banreservas' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8'
    downloadBankFile(res, mime)
    try {
      await api.contabilidad.payrollPeriodUpdate(period.id, {
        disbursement_generated_at: new Date().toISOString(),
        disbursement_bank: bank,
      })
    } catch { /* column may be absent on legacy desktop; non-fatal */ }
    setDisbursementOpen(false)
    const warn = res.warnings?.length ? `\n\nAdvertencias:\n${res.warnings.join('\n')}` : ''
    alert(`Archivo generado: ${res.filename}\n${res.count} empleados · RD$ ${fmtRD(res.totalAmount)}${warn}`)
  }

  async function removeEmployee(id) {
    if (!confirm('¿Eliminar empleado del período?')) return
    setBusy(true)
    try { await api.contabilidad.payrollLineDelete(id); await reload() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  // Post-to-ledger: creates one journal entry with three buckets:
  //   Dr Gastos de Personal (5101)        = total salario
  //   Cr Cuentas por Pagar Empleados      = total neto
  //   Cr Cuentas por Pagar TSS / DGII     = total deducciones empleado
  async function post(payload) {
    if (totals.salario <= 0) return alert('No hay empleados con salario.')
    setBusy(true)
    try {
      // mark period posted + serialize totals
      await api.contabilidad.payrollPeriodUpdate(period.id, {
        status: 'posted',
        totals_json: JSON.stringify(totals),
      })
      // create journal entry (manual classification = 'auto_payroll')
      const fecha = `${period.year}-${String(period.month).padStart(2,'0')}-${String(Math.min(28, new Date(period.year, period.month, 0).getDate())).padStart(2,'0')}`
      const totDeduc = totals.afp + totals.sfs + totals.isr + totals.otras
      const entry = await api.contabilidad.journalEntryCreate({
        accounting_client_id: clientId,
        fecha,
        description: `Nómina ${MONTHS[period.month - 1]} ${period.year}`,
        type: 'auto_payroll',
        period_year: period.year, period_month: period.month,
        totals_debit: totals.salario, totals_credit: totals.salario,
        status: 'posted',
      })
      // dr gasto
      await api.contabilidad.journalLineAdd({
        journal_entry_id: entry.id,
        account_id: payload.gastoAccountId,
        debit: totals.salario, credit: 0,
        memo: `Salarios brutos ${MONTHS[period.month - 1]}`,
      })
      // cr neto
      if (totals.neto > 0) {
        await api.contabilidad.journalLineAdd({
          journal_entry_id: entry.id,
          account_id: payload.netoAccountId,
          debit: 0, credit: totals.neto,
          memo: `Cuentas por pagar empleados`,
        })
      }
      // cr tss/dgii
      if (totDeduc > 0) {
        await api.contabilidad.journalLineAdd({
          journal_entry_id: entry.id,
          account_id: payload.deducAccountId,
          debit: 0, credit: totDeduc,
          memo: `Retenciones SDSS + ISR a pagar`,
        })
      }
      setPostOpen(false)
      await onChange?.()
      alert('Período posteado al diario contable.')
    } catch (e) { alert(`Error al postear: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function exportIR3() {
    if (!api?.contabilidad?.dgii?.genIR3) return alert('Generador IR-3 no disponible.')
    setBusy(true)
    try {
      const r = await api.contabilidad.dgii.genIR3({
        accountingClientId: clientId, year: period.year, month: period.month,
      })
      // Trigger download
      const mod = await import('@terminal-x/services/dgii-reports.js')
      mod.downloadTxt(r.content || '', r.filename || `DGII_IR3_${period.year}${String(period.month).padStart(2,'0')}.txt`)
    } catch (e) { alert(`Error IR-3: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function exportVolante(line) {
    const mod = await import('@terminal-x/services/pdf.js')
    if (!mod.buildPayrollVoucherPDF) {
      // fallback: print plain receipt
      const txt = [
        `${clientName}`,
        `Volante de pago — ${MONTHS[period.month - 1]} ${period.year}`,
        ''.padEnd(40, '─'),
        `Empleado:  ${line.employee_name}`,
        `Cédula:    ${line.employee_cedula}`,
        `Salario base:        RD$ ${fmtRD(line.salario_base)}`,
        `AFP (2.87%):        -RD$ ${fmtRD(line.afp)}`,
        `SFS (3.04%):        -RD$ ${fmtRD(line.sfs)}`,
        `ISR:                 -RD$ ${fmtRD(line.isr)}`,
        `Otras deducciones:  -RD$ ${fmtRD(line.otras_deducciones)}`,
        ''.padEnd(40, '─'),
        `NETO A PAGAR:        RD$ ${fmtRD(line.neto)}`,
      ].join('\n')
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `volante_${(line.employee_cedula || line.employee_name || 'emp').replace(/\W+/g,'_')}_${period.year}${String(period.month).padStart(2,'0')}.txt`
      a.click(); URL.revokeObjectURL(url)
      return
    }
    await mod.buildPayrollVoucherPDF({
      clientName, period: { year: period.year, month: period.month, label: MONTHS[period.month - 1] },
      line,
    })
  }

  function whatsappVolante(line) {
    const tel = (clientPhone || '').replace(/\D/g, '')
    const msg = encodeURIComponent(
      `Hola ${line.employee_name}, tu volante de pago de ${MONTHS[period.month - 1]} ${period.year}: ` +
      `Salario RD$${fmtRD(line.salario_base)}, deducciones RD$${fmtRD((line.afp || 0) + (line.sfs || 0) + (line.isr || 0) + (line.otras_deducciones || 0))}, NETO RD$${fmtRD(line.neto)}.`
    )
    window.open(tel ? `https://wa.me/${tel}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank', 'noopener')
  }

  const isReadonly = period?.status === 'posted' || period?.status === 'paid'

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onClose} className="text-xs font-bold text-[#b3001e] hover:underline">← Volver a períodos</button>
        <div className="ml-2 font-bold">Nómina · {MONTHS[period.month - 1]} {period.year}</div>
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border
          ${period.status === 'posted' ? 'bg-[#b3001e] text-white border-[#b3001e]'
          : period.status === 'paid'   ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
          : 'bg-white text-black border-black/20 dark:bg-black dark:text-white dark:border-white/20'}`}>
          {period.status === 'posted' ? 'Posteado' : period.status === 'paid' ? 'Pagado' : 'Borrador'}
        </span>
        <div className="ml-auto flex gap-2">
          {!isReadonly && (
            <button onClick={() => setEditing({})}
              className="inline-flex items-center gap-1 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018]">
              <Plus size={14}/> Empleado
            </button>
          )}
          {!isReadonly && (
            <button disabled={!lines.length} onClick={() => setPostOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-2 text-sm font-bold disabled:opacity-50">
              <Check size={14}/> Postear al diario
            </button>
          )}
          <button onClick={exportIR3}
            className="inline-flex items-center gap-1 rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-xs font-bold">
            <FileDown size={12}/> IR-3 TXT
          </button>
          {isReadonly && (
            <button onClick={() => setDisbursementOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-xs font-bold hover:bg-[#8f0018]">
              <Banknote size={12}/> Generar pago bancario
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2">Empleado</th>
              <th className="text-left px-3 py-2">Cédula</th>
              <th className="text-right px-3 py-2">Salario</th>
              <th className="text-right px-3 py-2">AFP</th>
              <th className="text-right px-3 py-2">SFS</th>
              <th className="text-right px-3 py-2">ISR</th>
              <th className="text-right px-3 py-2">Otras</th>
              <th className="text-right px-3 py-2">Neto</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!lines.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Sin empleados. Agrega uno.</td></tr>}
            {lines.map(l => (
              <tr key={l.id} className="border-t border-black/10 dark:border-white/10">
                <td className="px-3 py-2 font-bold">{l.employee_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.employee_cedula || '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(l.salario_base)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(l.afp)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(l.sfs)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(l.isr)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(l.otras_deducciones)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(l.neto)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => exportVolante(l)} title="Volante" className="text-xs font-bold text-[#b3001e] hover:underline mr-2"><FileDown size={12} className="inline"/></button>
                  <button onClick={() => whatsappVolante(l)} title="WhatsApp" className="text-xs font-bold text-black/60 dark:text-white/60 hover:text-[#b3001e] mr-2"><MessageCircle size={12} className="inline"/></button>
                  {!isReadonly && (
                    <>
                      <button onClick={() => setEditing(l)} className="text-xs font-bold text-[#b3001e] hover:underline mr-2">Editar</button>
                      <button onClick={() => removeEmployee(l.id)} className="text-xs font-bold text-black/60 dark:text-white/60 hover:text-[#b3001e]"><Trash2 size={12} className="inline"/></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-white dark:bg-black">
            <tr className="border-t-2 border-black dark:border-white">
              <td colSpan={2} className="px-3 py-2 font-bold">Totales</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(totals.salario)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(totals.afp)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(totals.sfs)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(totals.isr)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(totals.otras)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold text-[#b3001e]">{fmtRD(totals.neto)}</td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={9} className="px-3 py-2 text-xs text-black/60 dark:text-white/60">
                Costo total empleador (incluye AFP 7.10% + SFS 7.09% + SRL 1.10% patronal): <strong>RD$ {fmtRD(totals.employerCost)}</strong>
                {' · '}TSS Sal. Mín. Cotizable {DR_PAYROLL_RATES.year}: RD${fmtRD(DR_PAYROLL_RATES.smcSdss)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editing && <EmployeeModal initial={editing} onClose={() => setEditing(null)} onSave={saveEmployee} busy={busy}/>}
      {postOpen && (
        <PostModal totals={totals} accounts={accounts} onClose={() => setPostOpen(false)} onConfirm={post} busy={busy}/>
      )}
      {disbursementOpen && (
        <DisbursementModal
          lines={lines} period={period} client={client}
          onClose={() => setDisbursementOpen(false)}
          onGenerate={generateDisbursement}
          busy={busy}
        />
      )}
    </div>
  )
}

function DisbursementModal({ lines, period, client, onClose, onGenerate, busy }) {
  const missing = (lines || []).filter(l => !String(l.cuenta_destino || '').replace(/\D+/g, ''))
  const ready   = (lines || []).length - missing.length
  const total   = (lines || []).filter(l => !!String(l.cuenta_destino || '').replace(/\D+/g, ''))
                              .reduce((s, l) => s + Number(l.neto || 0), 0)
  const rnc = (client?.rnc || client?.cedula || '').replace(/\D+/g, '')

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold inline-flex items-center gap-2"><Banknote size={16}/> Pago Masivo de Nómina</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="text-xs text-black/70 dark:text-white/70 mb-3">
          Período: <strong>{MONTHS[period.month - 1]} {period.year}</strong> · RNC: <strong>{rnc || '— faltante —'}</strong>
        </div>
        <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3 mb-3 text-xs">
          <div className="flex justify-between"><span>Empleados con cuenta válida</span><strong>{ready}</strong></div>
          <div className="flex justify-between"><span>Empleados excluidos</span><strong className={missing.length ? 'text-[#b3001e]' : ''}>{missing.length}</strong></div>
          <div className="flex justify-between border-t border-black/10 dark:border-white/10 mt-1 pt-1"><span>Monto total a pagar</span><strong className="font-mono">RD$ {fmtRD(total)}</strong></div>
          {missing.length > 0 && (
            <div className="mt-2 text-[11px] text-[#b3001e]">
              Sin cuenta destino: {missing.slice(0, 8).map(l => l.employee_name || l.employee_cedula || 's/n').join(', ')}{missing.length > 8 ? ` (+${missing.length - 8} más)` : ''}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2">
          <button disabled={busy || !rnc || !ready} onClick={() => onGenerate('bhd_leon')}
            className="w-full text-left px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:border-[#b3001e] hover:bg-[#b3001e]/5 disabled:opacity-50">
            <div className="text-sm font-bold">Generar pago BHD León</div>
            <div className="text-[11px] text-black/60 dark:text-white/60">CSV · Pago Masivo (Servicios Empresariales)</div>
          </button>
          <button disabled={busy || !rnc || !ready} onClick={() => onGenerate('banreservas')}
            className="w-full text-left px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:border-[#b3001e] hover:bg-[#b3001e]/5 disabled:opacity-50">
            <div className="text-sm font-bold">Generar pago Banreservas</div>
            <div className="text-[11px] text-black/60 dark:text-white/60">TXT pipe-delimited · Pago a Terceros / Nómina</div>
          </button>
          <button disabled={busy || !rnc || !ready} onClick={() => onGenerate('generic')}
            className="w-full text-left px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:border-[#b3001e] hover:bg-[#b3001e]/5 disabled:opacity-50">
            <div className="text-sm font-bold">CSV genérico (otro banco)</div>
            <div className="text-[11px] text-black/60 dark:text-white/60">Para Popular, Scotia y otros — adapta columnas si el portal lo exige</div>
          </button>
        </div>
        {!rnc && <div className="mt-3 text-[11px] text-[#b3001e]">El cliente no tiene RNC/cédula. Edítalo en Cartera primero.</div>}
      </div>
    </div>
  )
}

function PostModal({ totals, accounts, onClose, onConfirm, busy }) {
  // Reasonable defaults from Catálogo Único PYME DR if seeded:
  //   5101 Sueldos y salarios  → débito gasto
  //   2104 Cuentas por pagar empleados (or generic 2101) → crédito neto
  //   2105 TSS / Retenciones por pagar → crédito deducciones
  const guess = useMemo(() => {
    const byCode = (code) => accounts.find(a => String(a.code).startsWith(code))
    return {
      gasto: byCode('5101') || byCode('51') || null,
      neto:  byCode('2104') || byCode('2101') || byCode('2102') || null,
      deduc: byCode('2105') || byCode('2103') || byCode('2102') || null,
    }
  }, [accounts])
  const [gastoId, setGastoId] = useState(guess.gasto?.id || null)
  const [netoId,  setNetoId]  = useState(guess.neto?.id  || null)
  const [deducId, setDeducId] = useState(guess.deduc?.id || null)
  const totDeduc = totals.afp + totals.sfs + totals.isr + totals.otras

  const postable = (accounts || []).filter(a => a.is_postable)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold">Postear nómina al diario</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="text-xs text-black/60 dark:text-white/60 mb-3">
          Se creará un asiento balanceado: Dr {fmtRD(totals.salario)} | Cr neto {fmtRD(totals.neto)} + deducciones {fmtRD(totDeduc)}.
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">Cuenta de gasto (Dr)
            <select value={gastoId || ''} onChange={(e) => setGastoId(Number(e.target.value) || null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Seleccionar —</option>
              {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">Cuenta por pagar empleados (Cr neto)
            <select value={netoId || ''} onChange={(e) => setNetoId(Number(e.target.value) || null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Seleccionar —</option>
              {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">Cuenta de retenciones por pagar (Cr deducciones)
            <select value={deducId || ''} onChange={(e) => setDeducId(Number(e.target.value) || null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Seleccionar —</option>
              {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy || !gastoId || !netoId || !deducId}
            onClick={() => onConfirm({ gastoAccountId: gastoId, netoAccountId: netoId, deducAccountId: deducId })}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50 inline-flex items-center gap-1">
            {busy && <Loader2 size={12} className="animate-spin"/>} Postear
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export default function Nomina() {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const allowed = hasFeature('contabilidad_nomina')

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState(null)
  const [accounts, setAccounts] = useState([])
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [periods, setPeriods] = useState([])
  const [openPeriodId, setOpenPeriodId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!api?.contabilidad) return
      const c = await api.contabilidad.clientList()
      if (cancelled) return
      setClients(c || [])
      if (!clientId && c?.length) setClientId(c[0].id)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const reloadPeriods = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setPeriods([]); return }
    const r = await api.contabilidad.payrollPeriodList({ accountingClientId: clientId, year })
    setPeriods(r || [])
  }, [api, clientId, year])

  const reloadAccounts = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setAccounts([]); return }
    const r = await api.contabilidad.coaList({ accountingClientId: clientId })
    setAccounts(r || [])
  }, [api, clientId])

  useEffect(() => { reloadPeriods() }, [reloadPeriods])
  useEffect(() => { reloadAccounts() }, [reloadAccounts])

  const openPeriod = useMemo(() => periods.find(p => p.id === openPeriodId) || null, [periods, openPeriodId])
  const client = useMemo(() => clients.find(c => c.id === clientId) || null, [clients, clientId])
  const clientPhone = (client?.notes || '').match(/8\d{9}/)?.[0] || ''

  if (!allowed) return <ComingSoon/>

  return (
    <div className="flex flex-col min-h-full">
      <div className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-bold text-[#b3001e]">
          <Users size={16}/> Nómina
        </div>
        <ClientPicker clients={clients} value={clientId} onChange={(id) => { setClientId(id); setOpenPeriodId(null) }}/>
        {!openPeriod && <PeriodPicker year={year} month={month} onYear={setYear} onMonth={setMonth}/>}
      </div>
      <div className="flex-1 min-w-0 bg-white dark:bg-black">
        {!clientId && <div className="p-6 text-sm text-black/60 dark:text-white/60">Selecciona un cliente para empezar.</div>}
        {clientId && !openPeriod && (
          <PeriodosList api={api} clientId={clientId} year={year} periods={periods}
            reload={reloadPeriods} onSelect={setOpenPeriodId} currentMonth={month}/>
        )}
        {clientId && openPeriod && (
          <PeriodDetail api={api} clientId={clientId} period={openPeriod}
            accounts={accounts} clientName={client?.nombre_comercial || ''} clientPhone={clientPhone} client={client}
            onChange={reloadPeriods} onClose={() => setOpenPeriodId(null)}/>
        )}
      </div>
    </div>
  )
}
