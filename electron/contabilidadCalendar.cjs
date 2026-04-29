// Terminal X — Contabilidad calendar templates (CommonJS shim).
//
// Mirrors packages/config/contabilidadCalendar.js (ESM) so electron/database.js
// can require() the canonical source instead of duplicating the array inline.
// Keep this file in lockstep with the ESM source — if you change one, change
// the other. Verified parity 2026-04-27 (Phase 2 Slice 1).

'use strict'

const CONTABILIDAD_CALENDAR_TEMPLATES = [
  // Monthly
  { form_type: 'IT-1',  name_es: 'IT-1 — Declaración mensual ITBIS',         periodicity: 'monthly', due_day_of_month: 20, applies_to_regimen: 'ordinario', applies_to_persona: 'all' },
  { form_type: '606',   name_es: '606 — Compras / proveedores',               periodicity: 'monthly', due_day_of_month: 15, applies_to_regimen: 'ordinario', applies_to_persona: 'all' },
  { form_type: '607',   name_es: '607 — Ventas / clientes',                   periodicity: 'monthly', due_day_of_month: 15, applies_to_regimen: 'ordinario', applies_to_persona: 'all' },
  { form_type: '608',   name_es: '608 — Comprobantes anulados',               periodicity: 'monthly', due_day_of_month: 15, applies_to_regimen: 'ordinario', applies_to_persona: 'all' },
  { form_type: '609',   name_es: '609 — Pagos al exterior',                   periodicity: 'monthly', due_day_of_month: 10, applies_to_regimen: 'ordinario', applies_to_persona: 'all' },
  { form_type: 'IR-3',  name_es: 'IR-3 — Retenciones de asalariados',         periodicity: 'monthly', due_day_of_month: 10, applies_to_regimen: 'ordinario', applies_to_persona: 'all' },
  { form_type: 'IR-17', name_es: 'IR-17 — Otras retenciones',                 periodicity: 'monthly', due_day_of_month: 10, applies_to_regimen: 'ordinario', applies_to_persona: 'all' },
  { form_type: 'TSS',     name_es: 'TSS — Planilla mensual',                    periodicity: 'monthly', due_day_of_month: 3,  applies_to_regimen: 'all',       applies_to_persona: 'all' },
  { form_type: 'DGT-4',   name_es: 'DGT-4 — Novedades laborales',               periodicity: 'monthly', due_day_of_month: 3,  applies_to_regimen: 'all',       applies_to_persona: 'all' },
  { form_type: 'ANT-IR2', name_es: 'Anticipo ISR — Cuota mensual (PJ)',         periodicity: 'monthly', due_day_of_month: 15, applies_to_regimen: 'ordinario', applies_to_persona: 'pj' },
  { form_type: 'ANT-RST', name_es: 'Anticipo RST — Cuota mensual',              periodicity: 'monthly', due_day_of_month: 15, applies_to_regimen: 'rst',       applies_to_persona: 'all' },
  // Annual
  { form_type: 'IR-1',      name_es: 'IR-1 — Declaración jurada personas físicas',   periodicity: 'annual', due_month: 3,  due_day_of_month: 31, applies_to_regimen: 'ordinario', applies_to_persona: 'pf' },
  { form_type: 'IR-2',      name_es: 'IR-2 — Declaración jurada personas jurídicas', periodicity: 'annual', due_month: 4,  due_day_of_month: 30, applies_to_regimen: 'ordinario', applies_to_persona: 'pj' },
  { form_type: 'Anexo-A',   name_es: 'Anexo A — Estados financieros',                periodicity: 'annual', due_month: 4,  due_day_of_month: 30, applies_to_regimen: 'ordinario', applies_to_persona: 'pj' },
  { form_type: 'IR-13',     name_es: 'IR-13 — Resumen anual de retenciones',         periodicity: 'annual', due_month: 1,  due_day_of_month: 15, applies_to_regimen: 'ordinario', applies_to_persona: 'all' },
  { form_type: 'DGT-3',     name_es: 'DGT-3 — Planilla anual',                       periodicity: 'annual', due_month: 1,  due_day_of_month: 15, applies_to_regimen: 'all',       applies_to_persona: 'all' },
  // PF anticipos cuatrimestrales (3 cuotas — junio/septiembre/diciembre)
  { form_type: 'ANT-IR1-1', name_es: 'Anticipo ISR PF — 1ra cuota (junio)',          periodicity: 'annual', due_month: 6,  due_day_of_month: 15, applies_to_regimen: 'ordinario', applies_to_persona: 'pf' },
  { form_type: 'ANT-IR1-2', name_es: 'Anticipo ISR PF — 2da cuota (septiembre)',     periodicity: 'annual', due_month: 9,  due_day_of_month: 15, applies_to_regimen: 'ordinario', applies_to_persona: 'pf' },
  { form_type: 'ANT-IR1-3', name_es: 'Anticipo ISR PF — 3ra cuota (diciembre)',      periodicity: 'annual', due_month: 12, due_day_of_month: 15, applies_to_regimen: 'ordinario', applies_to_persona: 'pf' },
  // RST regimen
  { form_type: 'RST-1',     name_es: 'RST-1 — Declaración jurada anual (RST)',       periodicity: 'annual', due_month: 3,  due_day_of_month: 31, applies_to_regimen: 'rst',       applies_to_persona: 'all' },
]

function applicableTemplates({ regimen = 'ordinario', persona = 'pj' } = {}) {
  const effectivePersona = persona === 'eirl' ? 'pj' : persona
  return CONTABILIDAD_CALENDAR_TEMPLATES.filter(t => {
    const okR = t.applies_to_regimen === 'all' || t.applies_to_regimen === regimen
    const okP = t.applies_to_persona === 'all' || t.applies_to_persona === effectivePersona
    return okR && okP
  })
}

function dueDateFor(template, periodYear, periodMonth) {
  const clampDay = Math.min(28, Math.max(1, template.due_day_of_month || 15))
  if (template.periodicity === 'annual') {
    const m = String(template.due_month || 4).padStart(2, '0')
    const d = String(clampDay).padStart(2, '0')
    return `${periodYear}-${m}-${d}`
  }
  let y = periodYear
  let m = (periodMonth || 1) + 1
  if (m > 12) { m = 1; y += 1 }
  return `${y}-${String(m).padStart(2, '0')}-${String(clampDay).padStart(2, '0')}`
}

module.exports = { CONTABILIDAD_CALENDAR_TEMPLATES, applicableTemplates, dueDateFor }
