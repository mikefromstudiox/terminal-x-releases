/**
 * wo/constants.js — Shared constants for the Taller Mecánico Work-Orders screen.
 *
 * Extracted from WorkOrders.jsx so siblings (Cotizaciones, MechanicResumen,
 * Suministros) can import the same status vocabulary instead of redefining it.
 *
 * Keep this file pure: no React, no API calls, no side effects.
 */

export const STATUSES = [
  { id: 'estimado',       label_es: 'Estimado',            label_en: 'Estimated',          bg: 'bg-slate-100 dark:bg-white/10',         text: 'text-slate-600 dark:text-white/60',     dot: 'bg-slate-400',  border: 'border-slate-200 dark:border-white/10' },
  { id: 'aprobado',       label_es: 'Aprobado',            label_en: 'Approved',           bg: 'bg-sky-50 dark:bg-sky-500/10',          text: 'text-sky-700 dark:text-sky-400',        dot: 'bg-sky-500',    border: 'border-sky-200 dark:border-sky-500/30' },
  { id: 'awaiting_parts', label_es: 'Esperando Repuestos', label_en: 'Awaiting Parts',     bg: 'bg-amber-50 dark:bg-amber-500/10',      text: 'text-amber-700 dark:text-amber-400',    dot: 'bg-amber-500',  border: 'border-amber-200 dark:border-amber-500/30' },
  { id: 'en_progreso',    label_es: 'En Progreso',         label_en: 'In Progress',        bg: 'bg-amber-50 dark:bg-amber-500/10',      text: 'text-amber-700 dark:text-amber-400',    dot: 'bg-amber-500',  border: 'border-amber-200 dark:border-amber-500/30' },
  { id: 'completado',     label_es: 'Completado',          label_en: 'Completed',          bg: 'bg-emerald-50 dark:bg-emerald-500/10',  text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-500/30' },
  { id: 'listo',          label_es: 'Listo (Cliente)',     label_en: 'Ready (Pickup)',     bg: 'bg-rose-50 dark:bg-rose-500/10',        text: 'text-[#b3001e] dark:text-rose-400',     dot: 'bg-[#b3001e]',  border: 'border-[#b3001e]/40 dark:border-rose-500/30' },
  { id: 'facturado',      label_es: 'Facturado',           label_en: 'Invoiced',           bg: 'bg-violet-50 dark:bg-violet-500/10',    text: 'text-violet-700 dark:text-violet-400',  dot: 'bg-violet-500', border: 'border-violet-200 dark:border-violet-500/30' },
]

// DB may store legacy English values ('estimate'/'approved'/'in_progress'/'completed'/'closed')
// or Spanish kanban ids. Normalize so consumers compare a single canonical form.
export const STATUS_ALIAS = {
  estimate: 'estimado', approved: 'aprobado', in_progress: 'en_progreso',
  completed: 'completado', closed: 'facturado', invoiced: 'facturado',
}

export function normStatus(s) { return STATUS_ALIAS[s] || s || 'estimado' }

export const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]))

export const NEXT_STATUS = {
  estimado: 'aprobado',
  aprobado: 'en_progreso',
  en_progreso: 'completado',
  completado: 'listo',
  listo: 'facturado',
}

export const ACTION_LABELS = {
  estimado:    { es: 'Aprobar',         en: 'Approve' },
  aprobado:    { es: 'Iniciar',         en: 'Start' },
  en_progreso: { es: 'Completar',       en: 'Complete' },
  completado:  { es: 'Marcar Listo',    en: 'Mark Ready' },
  listo:       { es: 'Facturar',        en: 'Invoice' },
}

export const LINE_TYPES = [
  { id: 'labor',    label_es: 'Mano de Obra', label_en: 'Labor' },
  { id: 'part',     label_es: 'Repuesto',     label_en: 'Part' },
  { id: 'service',  label_es: 'Servicio',     label_en: 'Service' },
]

// Stamp the right ISO timestamp column when a WO transitions to a new status.
// Returns an empty object for transitions that don't carry a timing fact (e.g.
// estimado → aprobado is approval, not a timing event — handled by the public
// /wo/approve endpoint instead).
export function timingPatchForStatus(nextStatus) {
  const now = new Date().toISOString()
  if (nextStatus === 'en_progreso') return { started_at: now }
  if (nextStatus === 'completado')  return { finished_at: now }
  if (nextStatus === 'listo')       return { ready_at: now }
  return {}
}

export function fmtWO(num) {
  return `WO-${String(num ?? '').replace(/\D/g, '').padStart(4, '0')}`
}
