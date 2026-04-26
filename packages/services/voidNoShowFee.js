/**
 * voidNoShowFee — anular el cargo de no-show salón v2.16.3.
 *
 * Emite una Nota de Crédito Electrónica (E34) que referencia la E32 original
 * (cargo no-show, consumidor final). Patrón DGII NCFModificado / CodigoModificacion=1
 * (anulación total). NO usa ANECF — eso solo aplica a secuencias sin emitir.
 *
 * Se ejecuta en el renderer porque depende de:
 *   - api.dgii_ecf.submit  (electron) o api.dgii_ecf  (web/edge)
 *   - api.ncf.next('E34')
 *   - api.tickets.byId / api.appointments.list / api.notas.create / api.activity.record
 *
 * El mismo orquestador se llama desde web.js (tickets.voidNoShowFee) y desde
 * el adaptador electron data layer (packages/data/electron.js). En ambos casos,
 * `api` es el objeto unificado que devuelve useAPI().
 *
 * Devuelve: { ok: true, credit_note_supabase_id, ncf, deferred } o
 *           { ok: false, error: 'fee_not_charged' | 'original_ticket_not_found' | ... }
 */

import { signAndSubmitECF } from './ecf.js'

const MOTIVO_ANULA_TOTAL = '1' // DGII CodigoModificacion=1 = Anula NCF Referenciado

export async function voidNoShowFeeOrchestrator({ appointment_supabase_id }, api) {
  if (!appointment_supabase_id) return { ok: false, error: 'missing_appointment_supabase_id' }
  if (!api) return { ok: false, error: 'no_api' }

  // 1. Find the appointment (by supabase_id). Both desktop + web expose
  //    `appointments.list({ ... })` returning an array; we filter locally.
  let appt = null
  try {
    const all = (await api.appointments?.list?.({})) || []
    appt = all.find(a => a.supabase_id === appointment_supabase_id) || null
  } catch {}
  // Fallback — wider load (some screens cache by date only)
  if (!appt) {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const all = (await api.appointments?.list?.({ date: today })) || []
      appt = all.find(a => a.supabase_id === appointment_supabase_id) || null
    } catch {}
  }
  if (!appt) return { ok: false, error: 'appointment_not_found' }
  // Some adapters store `no_show_fee_charged` as 0/1 (SQLite) or true/false (Supabase).
  const feeCharged = appt.no_show_fee_charged === true || appt.no_show_fee_charged === 1
  if (!feeCharged) return { ok: false, error: 'fee_not_charged' }

  // 2. Resolve the original ticket — direct join key first.
  let originalTicket = null
  const stampedSid = appt.no_show_fee_ticket_supabase_id || null
  if (stampedSid) {
    try {
      // Both adapters expose tickets.byId(idOrSupabaseId). Web's byId takes the
      // numeric PK; for supabase_id we scan via byDateRange. Cheaper to scan
      // a 14-day window than load every ticket.
      const recent = (await api.tickets?.byDateRange?.({ from: addDays(-30), to: addDays(1) })) || []
      originalTicket = recent.find(t => t.supabase_id === stampedSid) || null
    } catch {}
  }
  if (!originalTicket) {
    // Fallback — match by appointment ref in `notes`/`comentario` or comprobante_type=E32
    // emitted on the same client around the no-show date.
    try {
      const recent = (await api.tickets?.byDateRange?.({ from: addDays(-30), to: addDays(1) })) || []
      const candidate = recent
        .filter(t => t.comprobante_type === 'E32' && t.status !== 'nula')
        .filter(t => {
          const note = String(t.notes || t.comentario || '')
          return note.includes(appointment_supabase_id) || note.includes(`appt ${appointment_supabase_id}`)
        })
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null
      originalTicket = candidate
    } catch {}
  }
  if (!originalTicket) return { ok: false, error: 'original_ticket_not_found' }
  if (!originalTicket.ncf) return { ok: false, error: 'original_ncf_missing' }

  // Hydrate items if byDateRange didn't include them.
  let originalItems = Array.isArray(originalTicket.items) ? originalTicket.items : []
  if (!originalItems.length && originalTicket.id != null) {
    try {
      const hydrated = await api.tickets?.byId?.(originalTicket.id)
      if (hydrated?.items?.length) originalItems = hydrated.items
    } catch {}
  }
  if (!originalItems.length) {
    // Synthesize a single line from totals — keeps DGII E34 valid even when
    // the adapter didn't return ticket_items (e.g. offline cache miss).
    originalItems = [{
      name: 'No presentación',
      price: Number(originalTicket.total) || 0,
      quantity: 1,
      aplica_itbis: 0,
    }]
  }

  // 3. Reserve E34 NCF.
  let eNCF = null
  try { eNCF = await api.ncf?.next?.('E34') } catch {}
  if (!eNCF || typeof eNCF !== 'string') return { ok: false, error: 'ncf_reserve_failed' }

  // 4. Resolve emisor + bizSettings for the e-CF payload.
  let bizSettings = {}
  try { bizSettings = (await api.settings?.get?.()) || {} } catch {}
  const emisorRncRaw = String(bizSettings.biz_rnc || bizSettings.rnc || '').replace(/[-\s]/g, '')
  // 5. Build invoice payload + sign.
  const totalAmt   = Number(originalTicket.total)    || 0
  const subtotalAmt= Number(originalTicket.subtotal) || totalAmt
  const itbisAmt   = Number(originalTicket.itbis)    || 0
  const invoiceData = {
    eNCF,
    tipoECF: '34',
    emisor: {
      rnc:       emisorRncRaw,
      nombre:    bizSettings.biz_name    || bizSettings.name    || 'Terminal X',
      direccion: bizSettings.biz_address || bizSettings.address || 'Santo Domingo',
      email:     bizSettings.biz_email   || bizSettings.email   || '',
    },
    comprador: null,                // E32 original era consumidor final → mismo en E34
    totales: { subtotal: subtotalAmt, itbis: itbisAmt, total: totalAmt },
    items: originalItems.map(it => ({
      nombre: it.name || 'No presentación',
      precio: Number(it.price) || 0,
      cantidad: Number(it.quantity) || 1,
      indicadorBienoServicio: '2',
      unidadMedida: '43',
    })),
    referencia: {
      ncfModificado:      originalTicket.ncf,
      razonModificacion:  'Anulación cargo no-show',
      codigoModificacion: MOTIVO_ANULA_TOTAL,
    },
    ncfType: 'E34',
    formaPago: 'efectivo',
    ticket:   { id: originalTicket.id, ticketNo: originalTicket.doc_number },
    paidAt:   new Date(),
  }

  let ecf = null
  let deferred = false
  try {
    ecf = await signAndSubmitECF(invoiceData, api)
    // v2.16.3 followup #2 — `signAndSubmitECF` does NOT throw on DGII network
    // failure; it returns `{ queued: true, ok: false, error }` because the
    // dgii:submit IPC catches the error and pushes into ecf_queue with
    // IndicadorEnvioDiferido=1 (so processDgiiQueue retries within 72h).
    // We must surface that as `deferred` so the activity log + UI message
    // correctly say "Cargo anulado · Nota de Crédito en cola DGII" rather
    // than claiming the receipt already cleared.
    if (ecf && (ecf.queued === true || ecf.ok === false)) {
      deferred = true
      ecf = { ...ecf, eNCF: ecf.eNCF || eNCF, status: ecf.status || 'pending_offline' }
    }
  } catch (err) {
    // True throw (web stub fail / unexpected) — same handling as queued state.
    deferred = true
    ecf = { eNCF, status: 'pending_offline', error: err?.message || String(err) }
  }

  // 6. Persist a notas_credito row so the audit + 606 export pick it up.
  let creditNoteSupabaseId = null
  try {
    const notaRes = await api.notas?.create?.({
      ncf:                  eNCF,
      client_id:            originalTicket.client_id          || null,
      client_supabase_id:   originalTicket.client_supabase_id || null,
      original_ticket_id:   originalTicket.id                 || null,
      original_ticket_supabase_id: originalTicket.supabase_id || null,
      ticket_supabase_id:   originalTicket.supabase_id        || null,
      motivo:               'Anulación cargo no-show',
      amount:               totalAmt,
      itbis_revertido:      itbisAmt,
      forma_devolucion:     'Crédito en cuenta',
      comentario:           `appointment_supabase_id=${appointment_supabase_id}`,
      cajero_id:            null,
    })
    creditNoteSupabaseId = notaRes?.supabase_id || notaRes?.id || null
  } catch (e) {
    // Non-fatal: nota row failure doesn't unwind DGII submission.
    console.error('[voidNoShowFee] notas.create failed:', e?.message || e)
  }

  // 7. Update appointment — clear flag + mark deposit refunded.
  try {
    if (api.appointments?.update) {
      // Web signature is (id, data); desktop preload accepts ({id, ...data}).
      // Both work when we pass the supabase_id as `id` because:
      //   - web's appointments.update(id, data) treats id as PK and updates by id;
      //     when called with supabase_id it silently no-ops on the row but still
      //     updates the row by id=supabase_id chain — so we use the explicit
      //     `setStatus`-like primitive only on web. On desktop, id is the int PK.
      // To stay platform-uniform we pass {id: appt.id, supabase_id, ...patch}
      // and let each adapter pick what it needs.
      await api.appointments.update(appt.id, {
        id: appt.id,
        supabase_id: appointment_supabase_id,
        no_show_fee_charged: false,
        deposit_status: 'refunded',
      })
    }
  } catch (e) {
    console.error('[voidNoShowFee] appointments.update failed:', e?.message || e)
  }

  // 8. Activity log — critical, so dueño sees it in the feed.
  try {
    if (api.activity?.record || api.activity?.log) {
      const evt = {
        event_type: 'no_show_fee_voided',
        severity:   'critical',
        target_type: 'appointment',
        target_id:   appt.id != null ? String(appt.id) : null,
        target_name: appointment_supabase_id,
        amount:      totalAmt,
        reason:      'Cargo no-show anulado · Nota de Crédito E34',
        metadata: {
          original_ticket_supabase_id: originalTicket.supabase_id || null,
          original_ncf:                originalTicket.ncf,
          credit_note_supabase_id:     creditNoteSupabaseId,
          credit_note_ncf:             eNCF,
          appointment_supabase_id,
          deferred,
          dgii_status: ecf?.status || null,
        },
      }
      if (api.activity.record) await api.activity.record(evt)
      else                     await api.activity.log(evt)
    }
  } catch {}

  return {
    ok: true,
    credit_note_supabase_id: creditNoteSupabaseId,
    ncf: eNCF,
    deferred,
  }
}

function addDays(delta) {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}
