// Terminal X — Contabilidad: DGII obligation calendar templates (2026).
//
// Single source of truth for which forms a firm/cliente combo owes per month.
// Read by `accountingObligationGenerate(businessId, accountingClientId, year)`
// which seeds 12 months × applicable forms into accounting_obligations_calendar.
//
// Each template:
//   form_type            DGII form id (606/607/608/609/IT-1/IR-3/...)
//   name_es              human label
//   periodicity          'monthly' | 'quarterly' | 'annual'
//   due_day_of_month     day of the month it is due (relative to period close)
//   due_month            (annuals) — month of the year it is due
//   applies_to_regimen   'ordinario' | 'rst' | 'pst' | 'sin_operaciones' | 'all'
//   applies_to_persona   'pf' | 'pj' | 'all'
//
// All dates use America/Santo_Domingo (UTC-4, no DST).
// Source: DGII Calendario Tributario 2026 (norma general 06-2018 + 04-2023).

export const CONTABILIDAD_CALENDAR_TEMPLATES = [
  // ── Monthly ─────────────────────────────────────────────────────────────
  { form_type: 'IT-1',  name_es: 'IT-1 — Declaración mensual ITBIS',          periodicity: 'monthly',   due_day_of_month: 20, applies_to_regimen: 'ordinario',       applies_to_persona: 'all' },
  { form_type: '606',   name_es: '606 — Compras / proveedores',                periodicity: 'monthly',   due_day_of_month: 15, applies_to_regimen: 'ordinario',       applies_to_persona: 'all' },
  { form_type: '607',   name_es: '607 — Ventas / clientes',                    periodicity: 'monthly',   due_day_of_month: 15, applies_to_regimen: 'ordinario',       applies_to_persona: 'all' },
  { form_type: '608',   name_es: '608 — Comprobantes anulados',                periodicity: 'monthly',   due_day_of_month: 15, applies_to_regimen: 'ordinario',       applies_to_persona: 'all' },
  { form_type: '609',   name_es: '609 — Pagos al exterior',                    periodicity: 'monthly',   due_day_of_month: 10, applies_to_regimen: 'ordinario',       applies_to_persona: 'all' },
  { form_type: 'IR-3',  name_es: 'IR-3 — Retenciones de asalariados',          periodicity: 'monthly',   due_day_of_month: 10, applies_to_regimen: 'ordinario',       applies_to_persona: 'all' },
  { form_type: 'IR-17', name_es: 'IR-17 — Otras retenciones',                  periodicity: 'monthly',   due_day_of_month: 10, applies_to_regimen: 'ordinario',       applies_to_persona: 'all' },
  { form_type: 'TSS',   name_es: 'TSS — Planilla mensual',                     periodicity: 'monthly',   due_day_of_month: 3,  applies_to_regimen: 'all',             applies_to_persona: 'all' },
  { form_type: 'DGT-4', name_es: 'DGT-4 — Novedades laborales',                periodicity: 'monthly',   due_day_of_month: 3,  applies_to_regimen: 'all',             applies_to_persona: 'all' },

  // ── Annual ──────────────────────────────────────────────────────────────
  { form_type: 'IR-1',    name_es: 'IR-1 — Declaración jurada personas físicas',   periodicity: 'annual', due_month: 3, due_day_of_month: 31, applies_to_regimen: 'ordinario', applies_to_persona: 'pf' },
  { form_type: 'IR-2',    name_es: 'IR-2 — Declaración jurada personas jurídicas', periodicity: 'annual', due_month: 4, due_day_of_month: 30, applies_to_regimen: 'ordinario', applies_to_persona: 'pj' },
  { form_type: 'Anexo-A', name_es: 'Anexo A — Estados financieros',                periodicity: 'annual', due_month: 4, due_day_of_month: 30, applies_to_regimen: 'ordinario', applies_to_persona: 'pj' },
  { form_type: 'DGT-3',   name_es: 'DGT-3 — Planilla anual',                       periodicity: 'annual', due_month: 1, due_day_of_month: 15, applies_to_regimen: 'all',       applies_to_persona: 'all' },
]

export function applicableTemplates({ regimen = 'ordinario', persona = 'pj' } = {}) {
  return CONTABILIDAD_CALENDAR_TEMPLATES.filter(t => {
    const okR = t.applies_to_regimen === 'all' || t.applies_to_regimen === regimen
    const okP = t.applies_to_persona === 'all' || t.applies_to_persona === persona
    return okR && okP
  })
}

// Build a yyyy-mm-dd string for a given template + year + period month.
// Annuals ignore period and use template.due_month/due_day_of_month directly.
// Monthlies fall on (period_year, period_month + 1, due_day_of_month) — the
// 15th of the FOLLOWING month, per DGII rule. Day clamped to 28 for safety.
export function dueDateFor(template, periodYear, periodMonth) {
  const clampDay = Math.min(28, Math.max(1, template.due_day_of_month || 15))
  if (template.periodicity === 'annual') {
    const m = String(template.due_month || 4).padStart(2, '0')
    const d = String(clampDay).padStart(2, '0')
    return `${periodYear}-${m}-${d}`
  }
  // Monthly: due in the next month after the period closes.
  let y = periodYear
  let m = (periodMonth || 1) + 1
  if (m > 12) { m = 1; y += 1 }
  return `${y}-${String(m).padStart(2, '0')}-${String(clampDay).padStart(2, '0')}`
}
