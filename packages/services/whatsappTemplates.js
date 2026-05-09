// whatsappTemplates.js — per-vertical default WhatsApp message templates.
//
// Each business_type gets its own sensible default for every template
// (receipt, listo, kds_ready, appointment, balance). The Preferencias
// page uses these as the textarea `placeholder` so the operator sees
// what their default would look like before they customize. Send call
// sites can use defaultFor() as a final fallback when cfg.<template> is
// empty after trim — that way unconfigured shops still send something
// vertical-appropriate.
//
// Placeholders supported in every template (substituted at send time):
//   {cliente} {biz} {ticket} {total}
// Receipt: + {cliente} {biz} {ticket} {total}
// Listo (vehicle ready): + {vehiculo}
// KDS ready (food order ready for pickup): + {ticket}
// Appointment: + {fecha} {hora} {servicio} {estilista}
// Balance: + {saldo} {cuentas}
//
// To add a new vertical or template: extend WHATSAPP_TEMPLATE_DEFAULTS
// below. Keep messages short (<160 chars) — UltraMsg charges per segment.

export const WHATSAPP_TEMPLATE_DEFAULTS = {
  // Carwash — vehicle ready when wash done.
  carwash: {
    receipt:     'Hola {cliente}, gracias por escoger {biz}. Recibo #{ticket} · Total: {total}.',
    listo:       'Hola {cliente}, tu vehículo {vehiculo} está LISTO en {biz}. Te esperamos para retirar. Gracias!',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Food truck — pickup orders, KDS-driven readiness.
  food_truck: {
    receipt:     '¡Hola {cliente}! Gracias por tu orden en {biz}. Ticket {ticket} · {total}. ¡Buen provecho!',
    kds_ready:   '¡Hola {cliente}! Tu orden {ticket} está LISTA para retirar en {biz}. Gracias!',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Restaurant — same pattern as food_truck plus optional appointment.
  restaurant: {
    receipt:     'Hola {cliente}, gracias por visitar {biz}. Cuenta {ticket} · {total}. ¡Vuelve pronto!',
    kds_ready:   '¡Hola {cliente}! Tu pedido {ticket} en {biz} está listo. Pasa a la barra a recogerlo.',
    appointment: 'Hola {cliente}, te recordamos tu reserva en {biz} para {fecha} a las {hora}. ¡Te esperamos!',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Salon / barbershop — appointment-heavy.
  salon: {
    receipt:     'Hola {cliente}, gracias por visitarnos en {biz}. Recibo {ticket} · {total}. ¡Te esperamos pronto!',
    appointment: 'Hola {cliente}, te recordamos tu cita en {biz} para {fecha} a las {hora} con {estilista}. Servicio: {servicio}.',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Mechanic — vehicle ready + appointment.
  mechanic: {
    receipt:     'Hola {cliente}, gracias por escoger {biz}. Factura {ticket} · {total}.',
    listo:       'Hola {cliente}, tu vehículo {vehiculo} está LISTO en {biz}. Pasa a retirarlo cuando puedas.',
    appointment: 'Hola {cliente}, te recordamos tu cita en {biz} para {fecha} a las {hora}. Trae el vehículo {vehiculo}.',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Retail / licorería / carnicería — receipt + balance only.
  retail: {
    receipt:     'Hola {cliente}, gracias por tu compra en {biz}. Ticket {ticket} · {total}.',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },
  licoreria: {
    receipt:     'Hola {cliente}, gracias por tu compra en {biz}. Ticket {ticket} · {total}. ¡Salud!',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },
  carniceria: {
    receipt:     'Hola {cliente}, gracias por tu compra en {biz}. Ticket {ticket} · {total}.',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Concesionario — high-ticket; receipt + balance.
  dealership: {
    receipt:     'Hola {cliente}, gracias por escoger {biz}. Factura {ticket} · {total}.',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Préstamos / pawn — payment reminder centric.
  prestamos: {
    receipt:     'Hola {cliente}, hemos recibido tu pago en {biz}. Recibo {ticket} · {total}.',
    balance:     'Hola {cliente}, tu próximo pago en {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Service vertical — generic professional services.
  service: {
    receipt:     'Hola {cliente}, gracias por escoger {biz}. Recibo {ticket} · {total}.',
    appointment: 'Hola {cliente}, te recordamos tu cita en {biz} para {fecha} a las {hora}. Servicio: {servicio}.',
    balance:     'Hola {cliente}, tu saldo pendiente con {biz} es {saldo}. Cuentas para pagar:\n{cuentas}',
  },

  // Hybrid + contabilidad fall back to retail/service shape via defaultFor.
}

/**
 * Get the default message template for a given vertical + template name.
 * Falls back through retail → service if the vertical doesn't have one.
 * Returns null if neither has it (so callers can skip empty sends).
 */
export function defaultFor(businessType, templateName) {
  const v = WHATSAPP_TEMPLATE_DEFAULTS[businessType]
  if (v && v[templateName]) return v[templateName]
  // Fallback chain — retail covers most goods-only verticals; service is
  // the appointment-friendly fallback.
  return WHATSAPP_TEMPLATE_DEFAULTS.retail?.[templateName]
      || WHATSAPP_TEMPLATE_DEFAULTS.service?.[templateName]
      || null
}

/**
 * Substitute placeholders in a message body. Unknown placeholders are
 * left untouched (e.g. `{custom_var}` stays as `{custom_var}` so it's
 * obvious which keys weren't filled).
 */
export function substitute(template, vars = {}) {
  if (!template) return ''
  return String(template).replace(/\{(\w+)\}/g, (m, key) => {
    return vars[key] != null ? String(vars[key]) : m
  })
}

/**
 * One-shot helper: pick the configured cfg.<template> if non-empty, else
 * the per-vertical default, else null. Then substitute. Used by send call
 * sites that want a single function call:
 *
 *   const msg = renderTemplate(cfg, businessType, 'receipt', {
 *     cliente: 'Juan', biz: 'Crokao', ticket: 'T-0042', total: 'RD$ 540',
 *   })
 *   if (msg) await api.whatsapp.send({ to, body: msg })
 */
export function renderTemplate(cfg, businessType, templateName, vars) {
  const cfgKey = templateName === 'receipt'    ? 'wa_receipt_template'
              : templateName === 'kds_ready'  ? 'wa_kds_ready_template'
              : templateName === 'listo'      ? 'wa_listo_template'
              : templateName === 'appointment' ? 'wa_appointment_template'
              : templateName === 'balance'    ? 'wa_balance_template'
              : null
  if (!cfgKey) return null
  const tpl = String((cfg || {})[cfgKey] || '').trim() || defaultFor(businessType, templateName)
  if (!tpl) return null
  return substitute(tpl, vars)
}
