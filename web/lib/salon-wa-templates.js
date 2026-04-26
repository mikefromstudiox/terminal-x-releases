/**
 * salon-wa-templates.js — single source of truth for salón WhatsApp template
 * copy + the fillTemplate helper.
 *
 * Imported by:
 *   - web/api/panel.js               (cron + send-now reminder paths)
 *   - tests/salon-v2-16-2.spec.mjs   (contract test for {stylist} fallback)
 *
 * The template strings are LOCKED from the v2.16.1 plan — do not edit copy
 * without a customer-facing review (Mike).
 *
 * The {stylist} fallback `'tu equipo'` is applied at the call site when the
 * appointment has no empleado_supabase_id (any-stylist booking). See
 * processReminder() in panel.js for the canonical resolution rule.
 */
export const SALON_WA_TEMPLATES = {
  '24h':     'Hola {name}, te recordamos tu cita mañana {time} con {stylist} en {biz_name}. Confirma con SI.',
  '2h':      'Hola {name}, tu cita es en 2 horas con {stylist}. ¡Te esperamos!',
  'confirm': '{biz_name}: cita confirmada para {date} {time} con {stylist}. Servicio: {service}. Para cancelar, responde NO.',
  'manual':  'Hola {name}, te recordamos tu cita {date} {time} con {stylist} en {biz_name}.',
}

/**
 * Replaces {placeholder} tokens with values from `vars`. Missing keys render
 * as the empty string (NOT the literal `{placeholder}` token) so a missing
 * variable degrades to a slightly-broken-but-deliverable message rather
 * than leaking placeholder syntax to the customer's phone.
 */
export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
}

/**
 * Resolves the template variables for a reminder. Encapsulates the
 * `'tu equipo'` fallback so the spec can verify it without booting the
 * full processReminder() function.
 *
 * Inputs (any may be null/undefined):
 *   - kind:         '24h' | '2h' | 'confirm' | 'manual'
 *   - clientName:   client display name
 *   - empleadoName: stylist display name (null/undefined → 'tu equipo')
 *   - bizName:      business display name
 *   - date:         YYYY-MM-DD
 *   - time:         HH:MM
 *   - service:      first service name on the appointment
 */
export function resolveReminderVars({ clientName, empleadoName, bizName, date, time, service }) {
  return {
    name: clientName || '',
    time: time || '',
    date: date || '',
    // v2.16.2 fallback — any-stylist bookings render "tu equipo" instead of
    // leaking literal "{stylist}" or producing "con .  ¡Te esperamos!".
    stylist: empleadoName || 'tu equipo',
    biz_name: bizName || '',
    service: service || '',
  }
}
