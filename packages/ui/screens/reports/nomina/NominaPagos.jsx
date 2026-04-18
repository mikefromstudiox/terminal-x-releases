/**
 * NominaPagos.jsx — Bulk payroll run interface.
 *
 * Flow:
 *   1. Pick a pay cycle: Quincenal (1-15 or 16-end) · Mensual · Personalizado
 *   2. Period dates auto-fill
 *   3. Table renders ALL active employees with auto-computed:
 *      - Base (prorated from monthly salary by cycle)
 *      - Commissions (unpaid in period, from washer/seller/cajero commission tables)
 *      - Bonos (editable per row)
 *      - TSS (SFS+AFP with caps)
 *      - ISR (progressive brackets, if enabled)
 *      - Net
 *   4. Checkboxes to include/exclude each employee
 *   5. Pagar Seleccionados → transactional bulkCreate → auto-marks commissions paid
 *   6. Historical runs accordion at the bottom
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Calendar, Check, CheckCircle2, AlertCircle, Banknote, Printer, History,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'
import { fmtRD, TypeBadge, printPaycheckStub } from './shared'
import { calcTSSEmployee, calcTSSEmployer, calcINFOTEPEmployer } from './lib/tss'
import { calcISR } from './lib/isr'
import { currentQuincena, currentMonth, previousQuincena, previousMonth, prorateSalary } from './lib/payPeriod'

const CYCLE_OPTIONS = [
  { id: 'q-current',  label_es: 'Quincena actual',   label_en: 'Current quincena' },
  { id: 'q-previous', label_es: 'Quincena anterior', label_en: 'Previous quincena' },
  { id: 'm-current',  label_es: 'Mes actual',        label_en: 'Current month' },
  { id: 'm-previous', label_es: 'Mes anterior',      label_en: 'Previous month' },
  { id: 'custom',     label_es: 'Personalizado',     label_en: 'Custom' },
]

function getPeriodFromPreset(preset) {
  if (preset === 'q-current')  return currentQuincena()
  if (preset === 'q-previous') return previousQuincena()
  if (preset === 'm-current')  return currentMonth()
  if (preset === 'm-previous') return previousMonth()
  return null
}

export default function NominaPagos() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [empleados,       setEmpleados]       = useState([])
  const [settings,        setSettings]        = useState(null)
  const [biz,             setBiz]             = useState({})
  const [loading,         setLoading]         = useState(true)
  const [commRows,        setCommRows]        = useState({ washers: [], sellers: [], cajeros: [] })
  const [historical,      setHistorical]      = useState([])
  const [showHistory,     setShowHistory]     = useState(false)
  const [adelantoTotals,  setAdelantoTotals] = useState({}) // empleado_id → pending total

  // Period state
  const [preset,      setPreset]      = useState('q-previous')
  const [customStart, setCustomStart] = useState('')
  const [customEnd,   setCustomEnd]   = useState('')

  // Per-row state
  const [selected, setSelected] = useState({})  // empleado.id → boolean
  const [bonuses,  setBonuses]  = useState({})  // empleado.id → number
  const [saving,   setSaving]   = useState(false)
  const [toast,    setToast]    = useState(null)
  const [periodSalaries, setPeriodSalaries] = useState({}) // empleado.id → salary at period end

  function showToast(msg, variant = 'ok') {
    setToast({ msg, variant })
    setTimeout(() => setToast(null), 3000)
  }

  // Resolve the actual period
  const period = useMemo(() => {
    if (preset === 'custom') {
      if (!customStart || !customEnd) return null
      return { cycle: 'custom', start: customStart, end: customEnd, label: `${customStart} → ${customEnd}` }
    }
    return getPeriodFromPreset(preset)
  }, [preset, customStart, customEnd])

  // ── Load base data ─────────────────────────────────────────────────────────
  useEffect(() => { loadBase() }, [])

  async function loadBase() {
    setLoading(true)
    try {
      const [list, sets, empresa, adelantoSummary] = await Promise.all([
        api?.empleados?.all?.() || [],
        api?.payrollSettings?.get?.() || null,
        api?.admin?.getEmpresa?.() || null,
        api?.adelantos?.summary?.() || [],
      ])
      setEmpleados(list || [])
      setSettings(sets)
      if (empresa) setBiz({ name: empresa.name || empresa.nombre, rnc: empresa.rnc, address: empresa.address || empresa.direccion, logo: empresa.logo })
      // Build adelanto pending totals map: empleado_id → pending_total
      const aMap = {}
      for (const s of (adelantoSummary || [])) aMap[s.id] = s.pending_total || 0
      setAdelantoTotals(aMap)
    } catch {}
    setLoading(false)
  }

  // When pay_cycle in settings differs, default the preset to match
  useEffect(() => {
    if (settings?.pay_cycle === 'mensual') setPreset('m-previous')
  }, [settings?.pay_cycle])

  // ── Load commissions for the period ───────────────────────────────────────
  useEffect(() => {
    if (!period) return
    let cancelled = false
    Promise.all([
      api?.commissions?.byPeriod?.({ from: period.start, to: period.end }) || [],
      api?.sellerCommissions?.byPeriod?.({ from: period.start, to: period.end }) || [],
      api?.cajeroCommissions?.byPeriod?.({ from: period.start, to: period.end }) || [],
    ])
    .then(([washers, sellers, cajeros]) => {
      if (cancelled) return
      setCommRows({
        washers: washers || [],
        sellers: sellers || [],
        cajeros: cajeros || [],
      })
    })
    .catch(() => { if (!cancelled) setCommRows({ washers: [], sellers: [], cajeros: [] }) })
    return () => { cancelled = true }
  }, [period?.start, period?.end])

  // Reset selection when period changes
  useEffect(() => {
    setSelected({})
    setBonuses({})
  }, [period?.start, period?.end])

  // Load historical salary for each employee at the period end date
  useEffect(() => {
    if (!period?.end || !empleados.length) return
    let cancelled = false
    Promise.all(empleados.map(emp =>
      (api?.salaryChanges?.atDate?.(emp.id, period.end) ?? Promise.resolve(emp.salary || 0))
        .then(sal => [emp.id, sal])
    )).then(pairs => {
      if (cancelled) return
      setPeriodSalaries(Object.fromEntries(pairs))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [period?.end, empleados])

  // ── Load historical runs for this period ──────────────────────────────────
  useEffect(() => {
    if (!period) return
    let cancelled = false
    Promise.resolve(api?.payrollRuns?.byPeriod?.(period.start, period.end) || [])
      .then(rows => { if (!cancelled) setHistorical(rows || []) })
      .catch(() => { if (!cancelled) setHistorical([]) })
    return () => { cancelled = true }
  }, [period?.start, period?.end])

  // ── Commission totals per employee (v2.1: keyed by empleado_supabase_id) ─
  // Each bucket holds three parallel maps so we can match empleados by
  // supabase_id first, then fall back to legacy washer/seller/cajero keys.
  const commTotals = useMemo(() => {
    const build = (rows, legacySupaKey, legacyIdKey) => {
      const bySid = {}, byLegacySid = {}, byLegacyId = {}
      for (const r of (rows || [])) {
        const amt = Number(r.total_commission || r.commission_amount || 0)
        if (r.empleado_supabase_id) {
          const k = String(r.empleado_supabase_id)
          bySid[k] = (bySid[k] || 0) + amt
        } else if (r[legacySupaKey]) {
          const k = String(r[legacySupaKey])
          byLegacySid[k] = (byLegacySid[k] || 0) + amt
        } else if (r[legacyIdKey] != null) {
          const k = String(r[legacyIdKey])
          byLegacyId[k] = (byLegacyId[k] || 0) + amt
        }
      }
      return { bySid, byLegacySid, byLegacyId }
    }
    return {
      washers: build(commRows.washers, 'washer_supabase_id', 'washer_id'),
      sellers: build(commRows.sellers, 'seller_supabase_id', 'seller_id'),
      cajeros: build(commRows.cajeros, 'cajero_supabase_id', 'cajero_id'),
    }
  }, [commRows])

  function getCommission(emp) {
    if (!emp) return 0
    const bucket = emp.tipo === 'lavador'  ? commTotals.washers
                 : emp.tipo === 'vendedor' ? commTotals.sellers
                 : emp.tipo === 'cajero'   ? commTotals.cajeros
                 : null
    if (!bucket) return 0
    const sid = emp.supabase_id ? String(emp.supabase_id) : null
    if (sid && bucket.bySid?.[sid]) return bucket.bySid[sid]
    const refSid = emp.ref_supabase_id ? String(emp.ref_supabase_id) : null
    if (refSid && bucket.byLegacySid?.[refSid]) return bucket.byLegacySid[refSid]
    const ref = emp.ref_id != null ? String(emp.ref_id) : null
    if (ref && bucket.byLegacyId?.[ref]) return bucket.byLegacyId[ref]
    return 0
  }

  // Employees already paid for this period (show disabled)
  const alreadyPaid = useMemo(() => {
    const set = new Set()
    for (const run of historical) {
      if (run.period_start === period?.start && run.period_end === period?.end) {
        set.add(String(run.empleado_id))
      }
    }
    return set
  }, [historical, period])

  // ── Per-row computation ────────────────────────────────────────────────────
  const cycle = period?.cycle === 'mensual' || preset.startsWith('m-') ? 'mensual' : 'quincenal'

  const periodsPerMonth = cycle === 'quincenal' ? 2 : 1

  function rowCalc(emp) {
    const historicalSalary = periodSalaries[emp.id] ?? emp.salary ?? 0
    const base       = prorateSalary(historicalSalary, cycle)
    const commission = getCommission(emp)
    const bonus      = Number(bonuses[emp.id] || 0)
    const gross      = base + commission + bonus
    const tssEmp     = calcTSSEmployee(gross, settings || {}, periodsPerMonth)
    const tssEmpr    = calcTSSEmployer(gross, settings || {}, periodsPerMonth)
    const infotep    = calcINFOTEPEmployer(gross, settings?.infotep_employer_rate)
    const isr        = settings?.isr_enabled === false
      ? { periodTax: 0, bracket: 'deshabilitado' }
      : calcISR(gross, cycle, settings?.isr_brackets)
    const adelanto   = Number(adelantoTotals[emp.id] || 0)
    const totalDeductions = tssEmp.total + isr.periodTax + adelanto
    const net = gross - totalDeductions
    return {
      base, commission, bonus, gross, adelanto,
      sfs_employee: tssEmp.sfs, afp_employee: tssEmp.afp, isr: isr.periodTax,
      sfs_employer: tssEmpr.sfs, afp_employer: tssEmpr.afp, infotep_employer: infotep,
      totalDeductions, net,
    }
  }

  // ── Totals for selected employees ─────────────────────────────────────────
  const totals = useMemo(() => {
    let gross = 0, deductions = 0, net = 0, count = 0, employerLoad = 0
    for (const emp of empleados) {
      if (!selected[emp.id]) continue
      const c = rowCalc(emp)
      gross += c.gross
      deductions += c.totalDeductions
      net += c.net
      employerLoad += c.sfs_employer + c.afp_employer + c.infotep_employer
      count++
    }
    return { gross, deductions, net, count, employerLoad }
  }, [selected, empleados, bonuses, settings, commTotals])

  // ── Select all / none ──────────────────────────────────────────────────────
  function toggleAll() {
    const allEligible = empleados.filter(e => !alreadyPaid.has(String(e.id)) && ((periodSalaries[e.id] ?? e.salary ?? 0) > 0 || getCommission(e) > 0))
    const allSelected = allEligible.every(e => selected[e.id])
    if (allSelected) {
      setSelected({})
    } else {
      const next = {}
      for (const e of allEligible) next[e.id] = true
      setSelected(next)
    }
  }

  // ── Save bulk run ──────────────────────────────────────────────────────────
  async function handleBulkSave() {
    const rows = empleados.filter(e => selected[e.id]).map(emp => {
      const c = rowCalc(emp)
      return {
        empleado_id:      emp.id,
        period_start:     period.start,
        period_end:       period.end,
        base:             c.base,
        commissions:      c.commission,
        bonuses:          c.bonus,
        sfs_employee:     c.sfs_employee,
        afp_employee:     c.afp_employee,
        isr:              c.isr,
        other_deductions: c.adelanto,
        sfs_employer:     c.sfs_employer,
        afp_employer:     c.afp_employer,
        infotep_employer: c.infotep_employer,
        net:              c.net,
        notes:            c.adelanto > 0 ? `Incluye adelanto: ${fmtRD(c.adelanto)}` : null,
        paid_by:          user?.id || null,
      }
    })
    if (!rows.length) return
    if (!confirm(L(`Confirmar pago de nomina para ${rows.length} empleado(s) por un total neto de ${fmtRD(totals.net)}?`,
                    `Confirm payroll payment for ${rows.length} employee(s), net total ${fmtRD(totals.net)}?`))) return
    setSaving(true)
    try {
      const result = await api.payrollRuns.bulkCreate(rows)
      // Auto-deduct pending adelantos for each paid employee
      for (const row of rows) {
        if (Number(adelantoTotals[row.empleado_id] || 0) > 0) {
          try {
            const pending = await (api?.adelantos?.byEmpleado?.(row.empleado_id) || [])
            for (const a of (pending || [])) {
              try { await api.adelantos.deduct(a.id, result?.ids?.[0] || null) } catch {}
            }
          } catch {}
        }
      }
      showToast(L(`${result.created || rows.length} pagos registrados`, `${result.created || rows.length} payments recorded`))
      setSelected({})
      setBonuses({})
      // Reload everything (historical, commissions, adelantos)
      const [newHist, newWC, newSC, newCC, newAdelSummary] = await Promise.all([
        api?.payrollRuns?.byPeriod?.(period.start, period.end) || [],
        api?.commissions?.byPeriod?.({ from: period.start, to: period.end }) || [],
        api?.sellerCommissions?.byPeriod?.({ from: period.start, to: period.end }) || [],
        api?.cajeroCommissions?.byPeriod?.({ from: period.start, to: period.end }) || [],
        api?.adelantos?.summary?.() || [],
      ])
      setHistorical(newHist || [])
      setCommRows({ washers: newWC || [], sellers: newSC || [], cajeros: newCC || [] })
      const aMap = {}
      for (const s of (newAdelSummary || [])) aMap[s.id] = s.pending_total || 0
      setAdelantoTotals(aMap)
    } catch (e) {
      showToast(e?.message || L('Error al registrar pagos', 'Error recording payments'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-white/40 text-sm">{L('Cargando…', 'Loading…')}</div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* ── Period selector ───────────────────────────────────────────── */}
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-slate-500 dark:text-white/60" />
            <h3 className="text-[13px] font-bold text-slate-700 dark:text-white">{L('Período de pago', 'Pay period')}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {CYCLE_OPTIONS.map(opt => (
              <button key={opt.id} onClick={() => setPreset(opt.id)}
                className={`px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors border ${
                  preset === opt.id
                    ? 'bg-slate-800 text-white dark:bg-white dark:text-black border-slate-800 dark:border-white'
                    : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
                }`}>
                {L(opt.label_es, opt.label_en)}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{L('Desde', 'From')}</label>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{L('Hasta', 'To')}</label>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400" />
              </div>
            </div>
          ) : period ? (
            <p className="text-[12px] text-slate-500 dark:text-white/60 mt-3">
              <strong className="text-slate-700 dark:text-white">{period.label}</strong> · {period.start} → {period.end} · {cycle === 'mensual' ? L('mensual', 'monthly') : L('quincenal', 'biweekly')}
            </p>
          ) : null}
        </div>

        {/* ── Employee table ────────────────────────────────────────────── */}
        {period && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 flex items-center justify-between">
              <h3 className="text-[13px] font-bold text-slate-700 dark:text-white">{L('Empleados', 'Employees')}</h3>
              <button onClick={toggleAll} className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline">
                {L('Seleccionar todos elegibles', 'Select all eligible')}
              </button>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 w-10"></th>
                    <th className="px-3 py-2 text-left">{L('Empleado', 'Employee')}</th>
                    <th className="px-3 py-2 text-right">{L('Base', 'Base')}</th>
                    <th className="px-3 py-2 text-right">{L('Comisiones', 'Commissions')}</th>
                    <th className="px-3 py-2 text-right w-24">{L('Bonos', 'Bonuses')}</th>
                    <th className="px-3 py-2 text-right">TSS</th>
                    <th className="px-3 py-2 text-right">ISR</th>
                    <th className="px-3 py-2 text-right">{L('Adelantos', 'Advances')}</th>
                    <th className="px-3 py-2 text-right">{L('Neto', 'Net')}</th>
                    <th className="px-3 py-2 text-center">{L('Estado', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {empleados.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-8 text-slate-400 dark:text-white/40">
                      {L('Sin empleados activos', 'No active employees')}
                    </td></tr>
                  )}
                  {empleados.map(emp => {
                    const c = rowCalc(emp)
                    const paid = alreadyPaid.has(String(emp.id))
                    const eligible = !paid && ((periodSalaries[emp.id] ?? emp.salary ?? 0) > 0 || c.commission > 0)
                    return (
                      <tr key={emp.id} className={`border-t border-slate-100 dark:border-white/5 ${paid ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" disabled={!eligible}
                            checked={!!selected[emp.id]}
                            onChange={e => setSelected(s => ({ ...s, [emp.id]: e.target.checked }))}
                            className="w-4 h-4 accent-emerald-600" />
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-semibold text-slate-800 dark:text-white">{emp.nombre}</p>
                          <div className="flex items-center gap-1.5 mt-0.5"><TypeBadge tipo={emp.tipo} /></div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-white/80 tabular-nums">{fmtRD(c.base)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-white/80 tabular-nums">{c.commission > 0 ? fmtRD(c.commission) : '—'}</td>
                        <td className="px-3 py-2">
                          <input type="number" min="0" step="0.01" value={bonuses[emp.id] || ''} placeholder="0"
                            onChange={e => setBonuses(b => ({ ...b, [emp.id]: e.target.value }))}
                            disabled={!eligible}
                            className="w-full px-2 py-1 text-right text-[11px] border border-slate-200 dark:border-white/10 rounded-md dark:bg-white/5 dark:text-white disabled:opacity-50" />
                        </td>
                        <td className="px-3 py-2 text-right text-red-500 dark:text-red-400 tabular-nums">− {fmtRD(c.sfs_employee + c.afp_employee)}</td>
                        <td className="px-3 py-2 text-right text-red-500 dark:text-red-400 tabular-nums">{c.isr > 0 ? `− ${fmtRD(c.isr)}` : '—'}</td>
                        <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400 tabular-nums">{c.adelanto > 0 ? `− ${fmtRD(c.adelanto)}` : '—'}</td>
                        <td className="px-3 py-2 text-right font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{fmtRD(c.net)}</td>
                        <td className="px-3 py-2 text-center">
                          {paid ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 size={11} /> {L('Pagado', 'Paid')}
                            </span>
                          ) : !eligible ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-500 dark:text-amber-400">
                              <AlertCircle size={11} /> {L('Sin base', 'No base')}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 dark:text-white/40">{L('Pendiente', 'Pending')}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
              {empleados.map(emp => {
                const c = rowCalc(emp)
                const paid = alreadyPaid.has(String(emp.id))
                const eligible = !paid && ((periodSalaries[emp.id] ?? emp.salary ?? 0) > 0 || c.commission > 0)
                return (
                  <div key={emp.id} className={`px-4 py-3 ${paid ? 'opacity-50' : ''}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" disabled={!eligible}
                        checked={!!selected[emp.id]}
                        onChange={e => setSelected(s => ({ ...s, [emp.id]: e.target.checked }))}
                        className="w-4 h-4 accent-emerald-600 mt-1" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-white">{emp.nombre}</p>
                        <TypeBadge tipo={emp.tipo} />
                        <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
                          <div><span className="text-slate-400 dark:text-white/40">Base:</span> <span className="font-semibold text-slate-700 dark:text-white">{fmtRD(c.base)}</span></div>
                          <div><span className="text-slate-400 dark:text-white/40">Com:</span> <span className="font-semibold text-slate-700 dark:text-white">{fmtRD(c.commission)}</span></div>
                          <div><span className="text-slate-400 dark:text-white/40">TSS+ISR:</span> <span className="text-red-500">− {fmtRD(c.sfs_employee + c.afp_employee + c.isr)}</span></div>
                          {c.adelanto > 0 && <div><span className="text-slate-400 dark:text-white/40">Adelanto:</span> <span className="text-amber-600 dark:text-amber-400">− {fmtRD(c.adelanto)}</span></div>}
                          <div><span className="text-slate-400 dark:text-white/40">Neto:</span> <span className="font-bold text-emerald-600 dark:text-emerald-400">{fmtRD(c.net)}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer with totals + save button */}
            <div className="border-t border-slate-200 dark:border-white/10 px-4 py-3 bg-slate-50 dark:bg-white/5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="grid grid-cols-2 md:flex md:items-center gap-3 md:gap-6 text-[11px]">
                  <div>
                    <p className="text-slate-400 dark:text-white/40 uppercase font-bold">{L('Seleccionados', 'Selected')}</p>
                    <p className="text-[14px] font-bold text-slate-800 dark:text-white">{totals.count}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 dark:text-white/40 uppercase font-bold">{L('Bruto', 'Gross')}</p>
                    <p className="text-[14px] font-bold text-slate-800 dark:text-white">{fmtRD(totals.gross)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 dark:text-white/40 uppercase font-bold">{L('Descuentos', 'Deductions')}</p>
                    <p className="text-[14px] font-bold text-red-500 dark:text-red-400">− {fmtRD(totals.deductions)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 dark:text-white/40 uppercase font-bold">{L('Neto', 'Net')}</p>
                    <p className="text-[14px] font-bold text-emerald-600 dark:text-emerald-400">{fmtRD(totals.net)}</p>
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <p className="text-slate-400 dark:text-white/40 uppercase font-bold">{L('Carga empleador', 'Employer cost')}</p>
                    <p className="text-[12px] font-semibold text-slate-600 dark:text-white/70">{fmtRD(totals.employerLoad)}</p>
                  </div>
                </div>
                <button onClick={handleBulkSave} disabled={saving || totals.count === 0}
                  className="flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold rounded-xl disabled:opacity-50 transition-colors">
                  <Banknote size={14} />
                  {saving ? L('Procesando…', 'Processing…') : L('Pagar Seleccionados', 'Pay Selected')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Historical runs accordion ─────────────────────────────────── */}
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
          <button onClick={() => setShowHistory(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
            <div className="flex items-center gap-2">
              <History size={15} className="text-slate-500 dark:text-white/60" />
              <h3 className="text-[13px] font-bold text-slate-700 dark:text-white">
                {L('Pagos ya registrados en este período', 'Payments already recorded this period')}
                {historical.length > 0 && (
                  <span className="ml-2 text-[11px] text-slate-400 dark:text-white/40 font-normal">({historical.length})</span>
                )}
              </h3>
            </div>
            {showHistory ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
          </button>
          {showHistory && (
            <div className="border-t border-slate-100 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5">
              {historical.length === 0 ? (
                <p className="text-[12px] text-slate-400 dark:text-white/40 text-center py-6">{L('Sin pagos registrados en este período', 'No payments recorded in this period')}</p>
              ) : historical.map(r => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-800 dark:text-white">{r.empleado_nombre || `#${r.empleado_id}`}</p>
                    <p className="text-[10px] text-slate-400 dark:text-white/40">{new Date(r.paid_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-[13px] font-bold text-emerald-600 dark:text-emerald-400">{fmtRD(r.net)}</p>
                    <button onClick={() => printPaycheckStub(biz, { nombre: r.empleado_nombre, tipo: r.empleado_tipo, cedula: '', puesto: '' }, r, L)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-500/10">
                      <Printer size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2 ${
          toast.variant === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          <Check size={15} /> {toast.msg}
        </div>
      )}
    </div>
  )
}
