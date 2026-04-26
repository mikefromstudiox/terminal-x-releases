/**
 * whatsapp-dealership.js — Sprint 2D M4.
 *
 * One-tap wa.me deep links for the concesionario vertical. No Twilio, no
 * scheduled sends — the vendor decides when to click. All builders return a
 * boolean (true on success, false if the phone is missing/invalid). Spanish
 * copy, dd/mm/yyyy hh:mm 24h DR locale.
 */

import { normalizePhone } from './whatsapp.js'
// v2.16.2 Sprint 2E item 9 — WhatsApp Business API auto-send stub. Once WABA
// is approved + configured per business, replace the stub with the real Meta
// Cloud API client (template messages, opt-in checks, queue + retry). The
// caller chain stays the same: try sendAutomatic, fall back to wa.me.
import { sendAutomatic, isWabaConfigured } from './whatsapp-business-stub.js'

function digits(p) { return String(p || '').replace(/\D+/g, '') }

function fmtDT(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  // dd/mm/yyyy hh:mm — 24h DR locale
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Santo_Domingo',
  }).format(d).replace(',', '')
}
function fmtD(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Santo_Domingo',
  }).format(d)
}
function money(n) {
  return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function vehicleLabel(v) {
  if (!v) return ''
  return [v.year, v.make, v.model].filter(Boolean).join(' ').trim()
}

function open(phone, message) {
  const p = normalizePhone(phone)
  if (!p || !digits(p)) return false
  if (typeof window === 'undefined' || !window.open) return false
  const url = `https://wa.me/${p}?text=${encodeURIComponent(message)}`
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

// Pro MAX upgrade hook: when WABA is configured, fire-and-forget the auto send
// and report success. On any non-success path (not configured, network error,
// rejection) fall back to the existing wa.me deep link so the cashier can still
// dispatch the message manually with one click.
async function sendOrOpen(phone, message) {
  if (isWabaConfigured()) {
    try {
      const r = await sendAutomatic({ phone: normalizePhone(phone), message })
      if (r?.sent) return true
    } catch {}
  }
  return open(phone, message)
}
void sendOrOpen // exported via async wrappers below for callers that want the promise

// 1. Test-drive reminder (1h before scheduled — vendor clicks)
export function sendTestDriveReminder(testDrive, client) {
  if (!testDrive || !client?.phone) return false
  const name = client.name || 'cliente'
  const when = fmtDT(testDrive.scheduled_at)
  const dealer = testDrive.dealer_name ? ` ${testDrive.dealer_name}.` : ''
  const msg = `Hola ${name}, le recordamos su prueba de manejo programada para ${when}.${dealer} Gracias.`
  return open(client.phone, msg)
}

// 2. Internal — opens chat with the SALESPERSON, not the client
export function sendFollowupOverdue(lead, salesperson) {
  if (!salesperson?.phone) return false
  const leadName = lead?.name || 'Sin nombre'
  const phone = lead?.phone || 'N/D'
  const since = fmtD(lead?.next_followup_at)
  const stage = lead?.stage || 'lead'
  const budget = money(lead?.budget)
  const msg = `Recordatorio: lead ${leadName} (${phone}) tiene seguimiento vencido desde ${since}. Stage: ${stage}. Presupuesto: RD$${budget}.`
  return open(salesperson.phone, msg)
}

// 3. Matricula ready for pickup
export function sendMatriculaReady(deal, client) {
  if (!client?.phone) return false
  const name = client.name || 'cliente'
  const veh = vehicleLabel(deal?.vehicle) || vehicleLabel(deal)
  const msg = `Hola ${name}, su matricula y placa estan listas para retirar. Vehiculo: ${veh}. Pase por nuestro concesionario para entrega. Gracias.`
  return open(client.phone, msg)
}

// 4. Warranty expiring soon
export function sendWarrantyExpiringSoon(warranty, client, vehicle) {
  if (!client?.phone) return false
  const name = client.name || 'cliente'
  const kind = warranty?.kind || 'general'
  const veh = vehicleLabel(vehicle)
  const when = fmtD(warranty?.expires_at)
  const msg = `Hola ${name}, su garantia (${kind}) del vehiculo ${veh} vence el ${when}. Si tiene algun reclamo pendiente, contactenos antes de esa fecha.`
  return open(client.phone, msg)
}

// 5. Reservation expiring
export function sendReservationExpiring(reservation, client, vehicle) {
  if (!client?.phone) return false
  const name = client.name || 'cliente'
  const veh = vehicleLabel(vehicle)
  const when = fmtDT(reservation?.expires_at)
  const dep = money(reservation?.deposit_amount)
  const msg = `Hola ${name}, su reserva del vehiculo ${veh} vence el ${when}. Por favor contactenos para completar el cierre antes de esa fecha. Deposito: RD$${dep}.`
  return open(client.phone, msg)
}

export default {
  sendTestDriveReminder,
  sendFollowupOverdue,
  sendMatriculaReady,
  sendWarrantyExpiringSoon,
  sendReservationExpiring,
}
