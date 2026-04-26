/**
 * DealBuilder.jsx — Dealership big-ticket checkout.
 *
 * Dealerships don't use the standard POS for a vehicle sale — the math is
 * different (trade-in, down payment, financing), the ticket is one line item,
 * and the unit's inventory status needs to flip to `sold`.
 *
 * This screen:
 *   1) pick vehicle from available inventory
 *   2) pick client
 *   3) optional trade-in (appraisal → new row in vehicle_inventory with
 *      acquisition_cost = appraisal, status=available)
 *   4) down payment + financing terms (APR, months) → live monthly payment
 *   5) save deal + mark unit sold
 *
 * e-CF/legal NCF flow is intentionally out of scope here — a dealership in DR
 * normally issues the fiscal document via the Invoicing module (B01/E31) with
 * the client's RNC. This screen stores the deal record so Reportes and the
 * RemoteDashboard can surface it.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  CarFront, User, DollarSign, Calendar, Percent, Loader2, Check,
  ArrowDown, Plus, FileText, Banknote, X,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'
import { useBusinessType } from '../../hooks/useBusinessType.jsx'
import { computeDeal } from './lib/financing.js'
// FIX-HIGH-8 — fallback queue for compliance-critical audit rows (reservation
// override failures + silent reservation conflict catches) so a transient
// activity_log insert error never erases the trail.
import { enqueueActivity } from '@terminal-x/services/activity-log-queue.js'
import CobrarModal from '../../components/CobrarModal'
import PaymentErrorBoundary from '../../components/PaymentErrorBoundary'
import UafComplianceModal from '../../components/UafComplianceModal'
import DateTimeModal from '../../components/DateTimeModal'
import QuotePdfModal from './components/QuotePdfModal'
import AppraisalChecklist from './components/AppraisalChecklist'
import WabaStubBanner from '../../components/WabaStubBanner'

// DGII: E31 (Crédito Fiscal) required when the buyer expects ITBIS credit,
// and is the norm for DR dealership vehicle sales ≥ RD$250,000. Below that
// threshold, default to E32 (Consumo).
const ECF_E31_THRESHOLD = 250000
// UAF Ley 155-17 — cash operations >= USD 15,000 (~RD$880K) trigger reporting.
const UAF_CASH_THRESHOLD = 880000

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

export default function DealBuilder() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const { hasFeature, subtypeConfig, businessType } = useBusinessType()
  const L = (es, en) => lang === 'es' ? es : en
  // Vehicle ITBIS — owners override per-business via feature_vehicle_itbis_enabled.
  // Default: concesionario_nuevo = true, otherwise (used) = false.
  const vehicleItbisEnabled = useMemo(() => {
    if (hasFeature('vehicle_itbis')) return true
    const sub = subtypeConfig?.config?.vehicleItbis
    if (typeof sub === 'boolean') return sub
    return false
  }, [hasFeature, subtypeConfig])

  const [units, setUnits] = useState([])
  const [clients, setClients] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  // v2.6.2 — Ticket + e-CF bridge. After salesDeals.create succeeds we open
  // CobrarModal with the vehicle as a single line item so the sale produces
  // a fiscal receipt + hits Cuadre / reports.
  const [cobrarCtx, setCobrarCtx] = useState(null)
  // v2.16.6 — surface-only toast for reservation/override failures. Mirrors the
  // WorkOrders FIX-HIGH-7 pattern (kind: 'ok' | 'error', auto-dismiss).
  const [toast, setToast] = useState(null)
  function flashToast(msg, kind = 'ok') {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), kind === 'error' ? 5000 : 3000)
  }
  // Route a compliance-critical audit row through the canonical helper, with
  // an IDB fallback queue (FIX-HIGH-8) so the trail survives a Supabase blip.
  async function safeAudit(payload) {
    try { await api.activity?.log?.(payload) }
    catch { try { await enqueueActivity(payload) } catch {} }
  }

  const [vehicleId, setVehicleId] = useState('')
  const [clientId, setClientId] = useState('')
  const [salespersonId, setSalespersonId] = useState('')
  const [commissionPct, setCommissionPct] = useState(0)
  const [salePrice, setSalePrice] = useState(0)
  const [hasTradeIn, setHasTradeIn] = useState(false)
  const [tradeIn, setTradeIn] = useState({ make: '', model: '', year: '', vin: '', mileage: 0, appraisal: 0 })
  const [downPayment, setDownPayment] = useState(0)
  const [aprAnnual, setAprAnnual] = useState(0)
  const [termMonths, setTermMonths] = useState(0)
  const [notes, setNotes] = useState('')
  const [downPaymentMethod, setDownPaymentMethod] = useState('cash') // cash | transfer | check
  const [uafCtx, setUafCtx] = useState(null)         // when set, blocks deal until acknowledged
  const [uafAck, setUafAck] = useState(null)         // { uaf_report_url, uaf_acknowledged_by, uaf_acknowledged_at }
  // v2.16.4 — reservation context for the selected vehicle. When the unit is
  // currently reserved by ANOTHER client we surface a crimson warning + an
  // explicit "continue anyway" override that audits the action.
  const [activeReservation, setActiveReservation] = useState(null) // row from vehicle_reservations or null
  const [reservationOverride, setReservationOverride] = useState(false)
  // v2.16.4 Sprint 2B H3 — post-sale warranty creation toggle (default ON, +90d expiry).
  const [createWarranty, setCreateWarranty] = useState(true)
  const [warrantyKind, setWarrantyKind] = useState('general')
  const [warrantyExpiresAt, setWarrantyExpiresAt] = useState(() => new Date(Date.now() + 90 * 86400000).toISOString())
  const [warrantyTerms, setWarrantyTerms] = useState('')
  const [showWarrantyDateModal, setShowWarrantyDateModal] = useState(false)
  // v2.16.4 Sprint 2C H5 — bank pre-approval picker.
  const [showPreapprovalModal, setShowPreapprovalModal] = useState(false)
  const [preapprovalOptions, setPreapprovalOptions] = useState([])
  const [preapprovalLoading, setPreapprovalLoading] = useState(false)
  const [usedPreapproval, setUsedPreapproval] = useState(null) // { id, supabase_id, bank, ... } when one was applied
  // v2.16.2 Sprint 2E — pre-sale quote PDF + appraisal checklist modals.
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [showAppraisalModal, setShowAppraisalModal] = useState(false)
  const [appraisalChecklist, setAppraisalChecklist] = useState(null) // persisted JSON appended to notes on close

  useEffect(() => { (async () => {
    setLoading(true)
    const [u, c, s] = await Promise.all([
      api.vehicleInventory.list({ status: 'available' }),
      api.clients?.list?.() || Promise.resolve([]),
      api.empleados?.list?.() || Promise.resolve([]),
    ])
    setUnits(u || []); setClients(c || []); setStaff(s || [])
    setLoading(false)
  })() }, []) // eslint-disable-line

  const selectedUnit = useMemo(() => units.find(u => u.id === vehicleId), [units, vehicleId])
  const selectedSalesperson = useMemo(() => staff.find(s => s.id === salespersonId), [staff, salespersonId])
  useEffect(() => {
    if (selectedUnit && !salePrice) setSalePrice(Number(selectedUnit.listing_price || 0))
  }, [selectedUnit]) // eslint-disable-line
  useEffect(() => {
    // Default commission % from empleados.commission_pct (or 0).
    if (selectedSalesperson && (commissionPct === 0 || commissionPct === '')) {
      const pct = Number(selectedSalesperson.commission_pct || selectedSalesperson.commission || 0)
      if (pct > 0) setCommissionPct(pct)
    }
  }, [selectedSalesperson]) // eslint-disable-line
  const vehiclePhoto = useMemo(() => {
    const arr = Array.isArray(selectedUnit?.photo_urls) ? selectedUnit.photo_urls : []
    return arr.find(Boolean) || null
  }, [selectedUnit])

  const deal = useMemo(() => computeDeal({
    salePrice,
    tradeInValue: hasTradeIn ? tradeIn.appraisal : 0,
    downPayment,
    aprAnnualPct: aprAnnual,
    termMonths,
  }), [salePrice, hasTradeIn, tradeIn.appraisal, downPayment, aprAnnual, termMonths])

  function resetAll() {
    setVehicleId(''); setClientId(''); setSalespersonId(''); setCommissionPct(0); setSalePrice(0)
    setHasTradeIn(false); setTradeIn({ make: '', model: '', year: '', vin: '', mileage: 0, appraisal: 0 })
    setDownPayment(0); setAprAnnual(0); setTermMonths(0); setNotes('')
    setResult(null); setCobrarCtx(null); setUafCtx(null); setUafAck(null)
    setDownPaymentMethod('cash')
    setActiveReservation(null); setReservationOverride(false)
    setCreateWarranty(true); setWarrantyKind('general'); setWarrantyTerms('')
    setWarrantyExpiresAt(new Date(Date.now() + 90 * 86400000).toISOString())
    setUsedPreapproval(null); setPreapprovalOptions([]); setShowPreapprovalModal(false)
  }

  // v2.16.4 Sprint 2C H5 — open the picker AFTER fetching active pre-approvals
  // for the currently-selected client. The button is disabled when clientId is
  // empty so this always has a target to query against.
  async function openPreapprovalPicker() {
    const client = clients.find(c => c.id === clientId)
    if (!client?.supabase_id) {
      alert('Selecciona un cliente con cuenta sincronizada antes de cargar pre-aprobaciones.')
      return
    }
    setPreapprovalLoading(true)
    setShowPreapprovalModal(true)
    try {
      const rows = await api.bankPreapproval?.activeByClient?.(client.supabase_id)
      setPreapprovalOptions(Array.isArray(rows) ? rows : [])
    } catch (e) {
      console.warn('[DealBuilder] preapproval fetch failed', e)
      setPreapprovalOptions([])
    } finally {
      setPreapprovalLoading(false)
    }
  }

  // Apply one of the picker rows: auto-fill APR / term / monthly + remember
  // which row to mark 'utilizada' once the deal closes successfully.
  function applyPreapproval(row) {
    if (!row) return
    setUsedPreapproval(row)
    if (row.rate_offered != null)          setAprAnnual(Number(row.rate_offered))
    if (row.term_months != null)           setTermMonths(Number(row.term_months))
    if (row.monthly_quota_offered != null) {
      // If the bank quoted a monthly cuota, write the implied financed amount as
      // a hint via downPayment delta — but don't fight a value the user already
      // entered. Cuota itself is shown in the summary row "Pago Mensual" via
      // computeDeal so we DO need APR + term to be correct above. The cuota
      // here is informational; we surface it through the picker UI label.
    }
    setShowPreapprovalModal(false)
  }

  // v2.16.4 — when the cashier picks a unit, look up any active reservation so
  // we can warn before they close a deal that would step on someone else's
  // deposit. The reservation row stays in state so closeDeal() can convert it
  // (when the buyer matches) and the warning banner can render.
  useEffect(() => {
    let cancelled = false
    setReservationOverride(false)
    if (!selectedUnit?.supabase_id) { setActiveReservation(null); return }
    ;(async () => {
      try {
        const rows = await api.vehicleReservation?.active?.({ vehicle_inventory_supabase_id: selectedUnit.supabase_id })
        if (cancelled) return
        const first = Array.isArray(rows) ? rows[0] : (rows || null)
        setActiveReservation(first || null)
      } catch { if (!cancelled) setActiveReservation(null) }
    })()
    return () => { cancelled = true }
  }, [selectedUnit?.supabase_id]) // eslint-disable-line

  // Reservation belongs-to-other-client predicate. A reservation by the SAME
  // client that's now buying is a happy-path conversion — no warning needed.
  const reservationConflict = !!(activeReservation && clientId && activeReservation.client_supabase_id
    && (clients.find(c => c.id === clientId)?.supabase_id !== activeReservation.client_supabase_id))
  const reservationByThisClient = !!(activeReservation && clientId
    && clients.find(c => c.id === clientId)?.supabase_id === activeReservation.client_supabase_id)

  const totalForCommission = useMemo(() => {
    return Math.max(0, Number(salePrice) - (hasTradeIn ? Number(tradeIn.appraisal) || 0 : 0))
  }, [salePrice, hasTradeIn, tradeIn.appraisal])
  const commissionAmount = useMemo(() => {
    const pct = Number(commissionPct) || 0
    return +(totalForCommission * pct / 100).toFixed(2)
  }, [totalForCommission, commissionPct])

  async function closeDeal(uafOverride) {
    if (!vehicleId || !clientId) return

    // v2.16.4 — if another client holds the reservation, demand explicit override.
    if (reservationConflict && !reservationOverride) {
      alert('Esta unidad esta reservada por otro cliente. Marca "Continuar de todos modos" para anular la reserva y continuar.')
      return
    }
    if (reservationConflict && reservationOverride) {
      // v2.16.6 — was a silent try/catch. Reservation override is a real
      // money-affecting event (we are about to anular another client's hold).
      // Route through the canonical helper + IDB fallback queue so the audit
      // row never silently disappears. If BOTH paths fail we still surface a
      // crimson Spanish toast and emit a higher-severity recovery event so
      // the owner can see what happened in the Actividad feed.
      const overridePayload = {
        event_type:  'reservation_override',
        severity:    'warn',
        target_type: 'vehicle_reservation',
        target_id:   activeReservation?.id || null,
        metadata:    {
          vehicle_inventory_supabase_id: activeReservation?.vehicle_inventory_supabase_id || null,
          held_by_client_supabase_id:    activeReservation?.client_supabase_id || null,
          buyer_client_id:               clientId,
          expires_at:                    activeReservation?.expires_at || null,
        },
      }
      let auditOk = true
      try { await api.activity?.log?.(overridePayload) }
      catch {
        auditOk = false
        try { await enqueueActivity(overridePayload) } catch {}
      }
      if (!auditOk) {
        flashToast('No se pudo aplicar la anulación de reservación. Reintenta.', 'error')
        await safeAudit({
          event_type:  'reservation_conflict_silent_catch_recovered',
          severity:    'warn',
          target_type: 'vehicle_reservation',
          target_id:   activeReservation?.id || null,
          metadata:    {
            scope: 'reservation_override_audit',
            deal_vehicle_id: vehicleId,
            buyer_client_id: clientId,
          },
        })
      }
    }

    // C1 — hardened total compute. NaN/negative kills E31/E32 routing.
    const numericSale  = Number(salePrice) || 0
    const numericTrade = hasTradeIn ? (Number(tradeIn.appraisal) || 0) : 0
    const totalPrice   = numericSale - numericTrade
    if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
      alert('Precio total invalido. Revisa el precio de venta y la tasacion del trade-in antes de continuar.')
      return
    }
    const forceType = totalPrice >= ECF_E31_THRESHOLD ? 'E31' : 'E32'
    const client = clients.find(c => c.id === clientId)
    if (forceType === 'E31' && !(client?.rnc || client?.cedula)) {
      alert('Venta >= RD$250,000 requiere RNC o cedula del comprador para emitir E31 (Credito Fiscal).')
      return
    }

    // C5 — UAF Ley 155-17. Cash portion >= RD$880K (USD 15K) → block until ack.
    const cashPortion = downPaymentMethod === 'cash'
      ? (Number(downPayment) || 0)
      : 0
    const ack = uafOverride || uafAck
    if (cashPortion >= UAF_CASH_THRESHOLD && !ack) {
      setUafCtx({ cashPortion, totalPrice })
      return
    }

    setSaving(true)
    try {
      let tradeInIdRef = null
      let tradeInSidRef = null
      if (hasTradeIn && Number(tradeIn.appraisal) > 0) {
        const ti = await api.vehicleInventory.create({
          make: tradeIn.make, model: tradeIn.model,
          year: tradeIn.year ? Number(tradeIn.year) : null,
          vin: tradeIn.vin, mileage: Number(tradeIn.mileage) || 0,
          acquisition_cost: Number(tradeIn.appraisal) || 0,
          listing_price: 0, condition: 'used', status: 'available',
          title_status: 'pending',
          notes: L('Recibido como intercambio', 'Received as trade-in'),
        })
        tradeInIdRef = ti?.id || null
        tradeInSidRef = ti?.supabase_id || null
      }

      const sp = staff.find(s => s.id === salespersonId)

      // v2.16.2 Sprint 2E — append serialized appraisal checklist to notes so the
      // detailed condition record persists with the deal record itself.
      let dealNotes = notes
      if (appraisalChecklist) {
        const block = '\n--- TASACION ---\n' + JSON.stringify(appraisalChecklist, null, 2)
        dealNotes = (dealNotes || '') + block
      }

      const created = await api.salesDeals.create({
        client_id: clientId,
        client_supabase_id: client?.supabase_id || null,
        vehicle_inventory_id: vehicleId,
        vehicle_inventory_supabase_id: selectedUnit?.supabase_id || null,
        salesperson_id: salespersonId || null,
        salesperson_supabase_id: sp?.supabase_id || null,
        sale_price: numericSale,
        trade_in_vehicle_id: tradeInIdRef,
        trade_in_supabase_id: tradeInSidRef,
        trade_in_value: numericTrade,
        down_payment: Number(downPayment) || 0,
        financed_amount: deal.financed,
        term_months: Number(termMonths) || 0,
        apr: Number(aprAnnual) || 0,
        monthly_payment: deal.monthly,
        commission_pct: Number(commissionPct) || 0,
        commission_amount: commissionAmount,
        commission_paid: false,
        status: 'closed',
        notes: dealNotes,
        closed_at: new Date().toISOString(),
        // C4 — fiscal/AML markers persisted on the deal.
        dgii_e31_required:       forceType === 'E31',
        uaf_threshold_exceeded:  cashPortion >= UAF_CASH_THRESHOLD,
        uaf_report_url:          ack?.uaf_report_url || null,
        uaf_acknowledged_by:     ack?.uaf_acknowledged_by || null,
        uaf_acknowledged_at:     ack?.uaf_acknowledged_at || null,
        // v2.16.4 Sprint 2C H5 — link the bank pre-approval used to finance.
        bank_preapproval_supabase_id: usedPreapproval?.supabase_id || null,
      })

      await api.vehicleInventory.setStatus(vehicleId, 'sold')
      setCobrarCtx({
        dealId:         created?.id || null,
        dealSupabaseId: created?.supabase_id || null,
        client,
        totalPrice,
        forceType,
        ticket: {
          id:       `deal-${created?.id || 'new'}`,
          ticketNo: `DEAL-${created?.id || ''}`,
          vehicle:  selectedUnit ? `${selectedUnit.year || ''} ${selectedUnit.make || ''} ${selectedUnit.model || ''} ${selectedUnit.vin ? '· VIN ' + selectedUnit.vin : ''}`.trim() : '',
          services: [{
            id:           `deal-${created?.id || 'new'}-veh`,
            name:         selectedUnit ? `${selectedUnit.year || ''} ${selectedUnit.make || ''} ${selectedUnit.model || ''}`.trim() : L('Vehículo', 'Vehicle'),
            price:        totalPrice,
            qty:          1,
            cost:         Number(selectedUnit?.acquisition_cost) || 0,
            is_wash:      0,
            // C3 — dynamic ITBIS via subtype/feature override.
            aplica_itbis: vehicleItbisEnabled ? 1 : 0,
          }],
          client: client ? { id: client.id, supabase_id: client.supabase_id, name: client.name } : null,
        },
      })
    } catch (ex) {
      setResult({ ok: false, err: ex?.message || 'Error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDealCobrarConfirm(paymentData) {
    const ctx = cobrarCtx
    if (!ctx) return
    try {
      const result = await api.tickets.create({
        vehicle_plate:    null,
        client_id:        ctx.client?.id || null,
        client_supabase_id: ctx.client?.supabase_id || null,
        washer_ids:       [],
        seller_id:        salespersonId || null,
        cajero_id:        (user?.id && user.id !== 'web') ? user.id : null,
        comprobante_type: paymentData.ncfType || ctx.forceType,
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        tipo_venta:       paymentData.tipo || 'contado',
        status:           paymentData.tipo === 'credito' ? 'pendiente' : 'cobrado',
        subtotal:         Number(paymentData.subtotal) || 0,
        itbis:            Number(paymentData.itbis) || 0,
        ley:              Number(paymentData.ley) || 0,
        total:            Number(paymentData.total) || 0,
        ecf_result:       paymentData.ecf || {},
        items: [{
          service_id:        null,
          inventory_item_id: null,
          name:              ctx.ticket.services[0].name,
          price:             ctx.ticket.services[0].price,
          cost:              ctx.ticket.services[0].cost,
          is_wash:           0,
          quantity:          1,
          sku:               selectedUnit?.vin || null,
          aplica_itbis:      vehicleItbisEnabled ? 1 : 0,
        }],
        comentario:       `[Deal ${ctx.dealId || '?'} · Vehicle ${vehicleId}${selectedUnit?.vin ? ' · VIN ' + selectedUnit.vin : ''}] ${paymentData.comentario || ''}`.trim(),
        descuento:        Number(paymentData.descuento) || 0,
        descuento_reason: paymentData.descuentoReason || null,
        mac_jti:          paymentData.mac_jti || null,
      })

      // C2 — salesDeals.close failure leaves a live e-CF with no deal link.
      // Compensate: classify-log critical event, enqueue ANECF anulacion via
      // electron IPC (web no-op), re-open the deal, surface crimson error.
      try {
        if (ctx.dealId) {
          await api.salesDeals.close(ctx.dealId, {
            ticket_id:          result?.id || null,
            ticket_supabase_id: result?.supabase_id || null,
          })
        }
        // v2.16.4 — convert the reservation now that the deal is closed cleanly.
        // Best-effort: any failure here just leaves the reservation 'active' for
        // a manual release in /reservations; the deal itself is already booked.
        // v2.16.6 — was silent. Surface to a Spanish toast + recoverable audit
        // row so the owner sees the orphan reservation that needs manual close.
        if (activeReservation?.id && (reservationByThisClient || reservationOverride)) {
          try {
            await api.vehicleReservation?.convert?.({ id: activeReservation.id, deal_supabase_id: ctx.dealSupabaseId || null })
          } catch (rcErr) {
            flashToast('No se pudo aplicar la anulación de reservación. Reintenta.', 'error')
            await safeAudit({
              event_type:  'reservation_conflict_silent_catch_recovered',
              severity:    'warn',
              target_type: 'vehicle_reservation',
              target_id:   activeReservation.id,
              metadata:    {
                scope: 'reservation_convert_after_deal_close',
                dealId: ctx.dealId || null,
                deal_supabase_id: ctx.dealSupabaseId || null,
                error: String(rcErr?.message || rcErr),
              },
            })
          }
        }
        // v2.16.4 Sprint 2B H3 — auto-create post-sale warranty if cashier kept
        // the toggle on. Best-effort: failure does NOT block the deal close
        // (deal is already booked). We log a warn-severity activity event so
        // the owner can spot warranties that silently failed to record.
        if (createWarranty && ctx.dealSupabaseId) {
          try {
            await api.vehicleWarranty?.upsert?.({
              sales_deal_supabase_id:        ctx.dealSupabaseId,
              vehicle_inventory_supabase_id: selectedUnit?.supabase_id || null,
              client_id:                     ctx.client?.id || null,
              client_supabase_id:            ctx.client?.supabase_id || null,
              kind:                          warrantyKind || 'general',
              starts_at:                     new Date().toISOString(),
              expires_at:                    new Date(warrantyExpiresAt).toISOString(),
              terms:                         warrantyTerms?.trim() || null,
              status:                        'active',
            })
          } catch (wErr) {
            try {
              await api.activity?.log?.({
                event_type:  'warranty_create_failed',
                severity:    'warn',
                target_type: 'sales_deal',
                target_id:   ctx.dealId,
                metadata:    { error: String(wErr?.message || wErr), deal_supabase_id: ctx.dealSupabaseId },
              })
            } catch {}
          }
        }
        // v2.16.4 Sprint 2C H5 — flip the chosen pre-approval to 'utilizada' so
        // it stops surfacing in the picker and Resumen tile. Best-effort: if it
        // fails the deal is already booked; an owner can manually mark it.
        if (usedPreapproval?.id) {
          try {
            await api.bankPreapproval?.setStatus?.({ id: usedPreapproval.id, status: 'utilizada' })
            // v2.16.2 Sprint 2E — emit preapproval_used so the activity feed
            // reflects which deal consumed which bank pre-approval row.
            try {
              await api.activity?.log?.({
                event_type:  'preapproval_used',
                severity:    'info',
                target_type: 'bank_preapproval',
                target_id:   usedPreapproval.id,
                target_name: usedPreapproval.bank || null,
                amount:      Number(usedPreapproval.requested_amount) || 0,
                metadata: {
                  deal_id:               ctx.dealId || null,
                  deal_supabase_id:      ctx.dealSupabaseId || null,
                  preapproval_supabase_id: usedPreapproval.supabase_id || null,
                  rate_offered:          usedPreapproval.rate_offered || null,
                  term_months:           usedPreapproval.term_months || null,
                },
              })
            } catch {}
          } catch (paErr) {
            console.warn('[DealBuilder] preapproval setStatus utilizada failed', paErr)
          }
        }
        setResult({ ok: true, id: ctx.dealId })
      } catch (e) {
        const eNCF = paymentData?.ecf?.eNCF || paymentData?.ecf?.encf || null
        try {
          await api.activity?.log?.({
            event_type:  'deal_close_failed',
            severity:    'critical',
            target_type: 'sales_deal',
            target_id:   ctx.dealId,
            metadata:    { eNCF, ticket_id: result?.id || null, error: String(e?.message || e) },
          })
        } catch {}
        if (eNCF) {
          try {
            await window.electronAPI?.dgii?.queueAnecfVoid?.({
              eNCF,
              ticketId: result?.id || null,
              ticketSupabaseId: result?.supabase_id || null,
              reason: 'deal_close_failed',
            })
          } catch {}
        }
        // Re-open the deal so the cashier can retry. Status reset is best-effort.
        try {
          await api.salesDeals.update(ctx.dealId, { status: 'open', closed_at: null, ticket_id: null, ticket_supabase_id: null })
        } catch {}
        try { await api.vehicleInventory.setStatus(vehicleId, 'available') } catch {}
        const msg = `Error al cerrar el trato. Se encolo anulacion automatica del e-CF ${eNCF || '(sin eNCF)'}. Contacte soporte: +1 809-828-2971`
        setResult({ ok: false, err: msg })
      }
    } catch (ex) {
      setResult({ ok: false, err: ex?.message || 'Error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>

  if (result?.ok) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="border border-black p-8 text-center bg-white">
          <Check size={48} className="mx-auto mb-4" />
          <h2 className="text-2xl font-bold">{L('Venta cerrada', 'Deal closed')}</h2>
          <p className="text-sm mt-2">{L('Unidad marcada como vendida y ticket emitido.', 'Unit marked as sold and ticket issued.')}</p>
          <button onClick={resetAll} className="mt-6 px-4 py-2 bg-black text-white inline-flex items-center gap-2"><Plus size={16} />{L('Nueva Venta', 'New Deal')}</button>
        </div>
      </div>
    )
  }

  const cobrarModal = cobrarCtx ? (
    <PaymentErrorBoundary onClose={() => setCobrarCtx(null)}>
      <CobrarModal
        ticket={cobrarCtx.ticket}
        forceNcfType={cobrarCtx.forceType}
        onConfirm={handleDealCobrarConfirm}
        onClose={() => setCobrarCtx(null)}
      />
    </PaymentErrorBoundary>
  ) : null

  const preapprovalModal = showPreapprovalModal ? (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setShowPreapprovalModal(false)}>
      <div className="bg-white border border-black max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-black">
          <h2 className="font-bold flex items-center gap-2"><Banknote size={18} />{L('Pre-aprobaciones del cliente', 'Client pre-approvals')}</h2>
          <button onClick={() => setShowPreapprovalModal(false)} className="p-1 hover:bg-black hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-4 text-sm">
          {preapprovalLoading ? (
            <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>
          ) : preapprovalOptions.length === 0 ? (
            <p className="text-black/60 text-xs">{L('Este cliente no tiene pre-aprobaciones activas. Registra una en Pre-aprobaciones.', 'This client has no active pre-approvals. Register one in Pre-approvals.')}</p>
          ) : (
            <ul className="divide-y divide-black/10 border border-black/20">
              {preapprovalOptions.map(p => (
                <li key={p.id} className="p-3 grid grid-cols-12 gap-2 items-center hover:bg-black/5">
                  <div className="col-span-3 font-semibold">{p.bank}</div>
                  <div className="col-span-2 tabular-nums text-right">{fmtRD(p.requested_amount)}</div>
                  <div className="col-span-1 text-center">{p.rate_offered != null ? `${Number(p.rate_offered).toFixed(2)}%` : '—'}</div>
                  <div className="col-span-1 text-center">{p.term_months != null ? `${p.term_months}m` : '—'}</div>
                  <div className="col-span-2 tabular-nums text-right">{p.monthly_quota_offered != null ? fmtRD(p.monthly_quota_offered) : '—'}</div>
                  <div className="col-span-2 text-[10px] text-black/60">
                    {p.expires_at ? `vence ${new Date(p.expires_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}` : 'sin vencimiento'}
                  </div>
                  <div className="col-span-1 text-right">
                    <button onClick={() => applyPreapproval(p)} className="px-2 py-1 bg-[#b3001e] text-white text-xs font-bold">{L('Usar', 'Use')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  ) : null

  const uafModal = uafCtx ? (
    <UafComplianceModal
      cashPortion={uafCtx.cashPortion}
      onCancel={() => { setUafCtx(null); setSaving(false) }}
      onConfirm={(ack) => {
        setUafAck(ack)
        setUafCtx(null)
        // Re-enter closeDeal with the ack passed inline so we don't race state.
        closeDeal(ack)
      }}
    />
  ) : null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* v2.16.7 — Honest WABA-status banner (visible only on Pro MAX while
          waba_approved !== 'true'). Auto-hides once admin flips the flag. */}
      <WabaStubBanner />
      {cobrarModal}
      {uafModal}
      {preapprovalModal}
      {/* v2.16.6 — surface for reservation/override failures */}
      {toast && (
        <div
          role="status"
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          className={`fixed top-4 right-4 z-[200] px-4 py-2.5 rounded-lg text-sm font-semibold shadow-2xl ${
            toast.kind === 'error'
              ? 'bg-[#b3001e] text-white'
              : 'bg-black text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
      {showQuoteModal && (
        <QuotePdfModal
          vehicle={selectedUnit}
          client={clients.find(c => c.id === clientId)}
          salesperson={selectedSalesperson}
          salePrice={Number(salePrice) || 0}
          tradeInValue={hasTradeIn ? Number(tradeIn.appraisal) || 0 : 0}
          downPayment={Number(downPayment) || 0}
          aprAnnual={Number(aprAnnual) || 0}
          termMonths={Number(termMonths) || 0}
          monthlyPayment={deal.monthly}
          notes={notes}
          onClose={() => setShowQuoteModal(false)}
        />
      )}
      {showAppraisalModal && (
        <AppraisalChecklist
          baseValue={Number(tradeIn.appraisal) || 0}
          tempId={`deal-${vehicleId || 'new'}-${clientId || 'noclient'}`}
          initial={appraisalChecklist}
          onApply={(suggested) => {
            if (Number.isFinite(suggested)) {
              setTradeIn(t => ({ ...t, appraisal: suggested }))
            }
          }}
          onSave={(checklist) => {
            setAppraisalChecklist(checklist)
            // Emit activity event (best-effort — no-op on web w/o api.activity).
            try {
              api.activity?.log?.({
                event_type:  'appraisal_recorded',
                severity:    'info',
                target_type: 'sales_deal_appraisal',
                target_id:   null,
                target_name: tradeIn?.vin || tradeIn?.model || null,
                amount:      Number(checklist?.suggested_value) || 0,
                metadata:    {
                  base_value: Number(tradeIn?.appraisal) || 0,
                  categories: checklist?.categories || {},
                  client_id:  clientId || null,
                  vehicle_id: vehicleId || null,
                },
              })
            } catch {}
            setShowAppraisalModal(false)
          }}
          onClose={() => setShowAppraisalModal(false)}
        />
      )}
      <DateTimeModal
        open={showWarrantyDateModal}
        title={L('Vence el', 'Expires on')}
        initialValue={warrantyExpiresAt}
        minDate={new Date().toISOString()}
        onConfirm={(iso) => { setWarrantyExpiresAt(iso); setShowWarrantyDateModal(false) }}
        onCancel={() => setShowWarrantyDateModal(false)}
      />
      <h1 className="text-3xl font-bold mb-6 flex items-center gap-3"><CarFront size={32} />{L('Cierre de Venta', 'Deal Builder')}</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2">{L('1. Vehículo y Cliente', '1. Vehicle & Client')}</h2>
          <label className="block"><span className="text-xs font-semibold">{L('Unidad', 'Unit')}*</span>
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">{L('Seleccionar...', 'Select...')}</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.year} {u.make} {u.model} · {fmtRD(u.listing_price)}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Cliente', 'Client')}*</span>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">{L('Seleccionar...', 'Select...')}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block col-span-2"><span className="text-xs font-semibold">{L('Vendedor', 'Salesperson')}</span>
              <select value={salespersonId} onChange={e => setSalespersonId(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                <option value="">—</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs font-semibold">{L('Comisión %', 'Comm %')}</span>
              <input type="number" step="0.1" min="0" value={commissionPct} onChange={e => setCommissionPct(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>
          <label className="block"><span className="text-xs font-semibold">{L('Precio de Venta', 'Sale Price')} RD$</span>
            <input type="number" step="0.01" value={salePrice} onChange={e => setSalePrice(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          {reservationConflict && activeReservation && (() => {
            const heldBy = clients.find(c => c.supabase_id === activeReservation.client_supabase_id)?.name || 'otro cliente'
            const expIso = activeReservation.expires_at
            const expFmt = expIso ? new Date(expIso).toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
            return (
              <div className="border-2 border-[#b3001e] bg-[#b3001e]/5 p-3 text-xs space-y-2">
                <p className="text-[#b3001e] font-semibold">
                  Esta unidad esta reservada hasta {expFmt} por {heldBy}. Contacta al vendedor antes de continuar.
                </p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={reservationOverride} onChange={e => setReservationOverride(e.target.checked)} />
                  <span>Continuar de todos modos</span>
                </label>
              </div>
            )
          })()}
          {reservationByThisClient && activeReservation && (
            <div className="border border-black bg-black text-white p-2 text-xs">
              Reserva activa de este cliente — se convertira automaticamente al cerrar la venta.
            </div>
          )}
          {selectedUnit && (
            <div className="border border-black/20 bg-black/5 aspect-[16/10] overflow-hidden">
              {vehiclePhoto ? (
                <img src={vehiclePhoto} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-black/30">
                  <CarFront size={48} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2 flex items-center justify-between">
            <span>{L('2. Intercambio (Trade-in)', '2. Trade-in')}</span>
            <label className="text-xs font-normal flex items-center gap-1"><input type="checkbox" checked={hasTradeIn} onChange={e => setHasTradeIn(e.target.checked)} />{L('Incluir', 'Include')}</label>
          </h2>
          {hasTradeIn && (<>
            <div className="grid grid-cols-2 gap-2">
              <input value={tradeIn.make} onChange={e => setTradeIn(t => ({ ...t, make: e.target.value }))} placeholder={L('Marca', 'Make')} className="border border-black px-2 py-1.5" />
              <input value={tradeIn.model} onChange={e => setTradeIn(t => ({ ...t, model: e.target.value }))} placeholder={L('Modelo', 'Model')} className="border border-black px-2 py-1.5" />
              <input type="number" value={tradeIn.year} onChange={e => setTradeIn(t => ({ ...t, year: e.target.value }))} placeholder={L('Año', 'Year')} className="border border-black px-2 py-1.5" />
              <input type="number" value={tradeIn.mileage} onChange={e => setTradeIn(t => ({ ...t, mileage: e.target.value }))} placeholder={L('Kilometraje', 'Mileage')} className="border border-black px-2 py-1.5" />
            </div>
            <input value={tradeIn.vin} onChange={e => setTradeIn(t => ({ ...t, vin: e.target.value.toUpperCase() }))} placeholder="VIN" maxLength={17} className="w-full border border-black px-2 py-1.5 font-mono" />
            <label className="block"><span className="text-xs font-semibold">{L('Valor de Tasación', 'Appraisal')} RD$</span>
              <input type="number" step="0.01" value={tradeIn.appraisal} onChange={e => setTradeIn(t => ({ ...t, appraisal: e.target.value }))} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <button
              type="button"
              onClick={() => setShowAppraisalModal(true)}
              className="w-full px-3 py-2 border-2 border-[#b3001e] text-[#b3001e] text-xs font-semibold hover:bg-[#b3001e] hover:text-white inline-flex items-center justify-center gap-2"
            >
              <FileText size={12} />
              {appraisalChecklist
                ? L('Tasacion detallada registrada — editar', 'Detailed appraisal saved — edit')
                : L('Tasacion detallada', 'Detailed appraisal')}
            </button>
          </>)}
          {!hasTradeIn && <p className="text-xs text-black/60">{L('Sin vehículo en intercambio.', 'No trade-in vehicle.')}</p>}
        </div>

        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2">{L('3. Financiamiento', '3. Financing')}</h2>
          <label className="block"><span className="text-xs font-semibold">{L('Inicial (Down Payment)', 'Down Payment')} RD$</span>
            <input type="number" step="0.01" value={downPayment} onChange={e => setDownPayment(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Forma de Pago Inicial', 'Down Payment Method')}</span>
            <select value={downPaymentMethod} onChange={e => setDownPaymentMethod(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="cash">{L('Efectivo', 'Cash')}</option>
              <option value="transfer">{L('Transferencia', 'Transfer')}</option>
              <option value="check">{L('Cheque', 'Check')}</option>
            </select>
            {downPaymentMethod === 'cash' && Number(downPayment) >= UAF_CASH_THRESHOLD && (
              <span className="block mt-1 text-[11px] text-[#b3001e] font-semibold">
                {L('Operacion en efectivo activa reporte UAF Ley 155-17.', 'Cash operation triggers UAF Ley 155-17 report.')}
              </span>
            )}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-xs font-semibold">{L('Plazo (meses)', 'Term (months)')}</span>
              <input type="number" value={termMonths} onChange={e => setTermMonths(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block"><span className="text-xs font-semibold">APR %</span>
              <input type="number" step="0.001" value={aprAnnual} onChange={e => setAprAnnual(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>

          {/* v2.16.4 Sprint 2C H5 — load a bank pre-approval to auto-fill APR/term/cuota */}
          <div className="border-t border-black/20 pt-2">
            <button
              type="button"
              onClick={openPreapprovalPicker}
              disabled={!clientId}
              title={!clientId ? L('Selecciona cliente primero', 'Select a client first') : ''}
              className="w-full px-3 py-2 border-2 border-[#b3001e] text-[#b3001e] text-xs font-semibold hover:bg-[#b3001e] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              <Banknote size={14} />
              {usedPreapproval
                ? L(`Pre-aprobacion de ${usedPreapproval.bank} aplicada — cambiar`, `Pre-approval from ${usedPreapproval.bank} applied — change`)
                : L('Cargar pre-aprobacion bancaria', 'Load bank pre-approval')}
            </button>
            {usedPreapproval && (
              <button
                type="button"
                onClick={() => setUsedPreapproval(null)}
                className="w-full mt-1 text-[10px] text-black/60 hover:text-black underline"
              >
                {L('Quitar pre-aprobacion seleccionada', 'Remove selected pre-approval')}
              </button>
            )}
          </div>
          <label className="block"><span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
        </div>

        {/* v2.16.4 Sprint 2B H3 — post-sale warranty */}
        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2 flex items-center justify-between">
            <span>{L('4. Garantia Post-venta', '4. Post-sale Warranty')}</span>
            <label className="text-xs font-normal flex items-center gap-1">
              <input type="checkbox" checked={createWarranty} onChange={e => setCreateWarranty(e.target.checked)} />
              {L('Crear garantia', 'Create warranty')}
            </label>
          </h2>
          {createWarranty ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-semibold">{L('Tipo', 'Kind')}</span>
                  <select value={warrantyKind} onChange={e => setWarrantyKind(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                    <option value="general">{L('General', 'General')}</option>
                    <option value="motor">{L('Motor', 'Engine')}</option>
                    <option value="transmision">{L('Transmision', 'Transmission')}</option>
                    <option value="electrico">{L('Electrico', 'Electrical')}</option>
                    <option value="extendida">{L('Extendida', 'Extended')}</option>
                  </select>
                </label>
                <div>
                  <span className="text-xs font-semibold">{L('Vence el', 'Expires on')}</span>
                  <button
                    type="button"
                    onClick={() => setShowWarrantyDateModal(true)}
                    className="mt-1 w-full border border-black px-2 py-1.5 text-left hover:bg-black/5"
                  >
                    {new Date(warrantyExpiresAt).toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </button>
                </div>
              </div>
              <label className="block">
                <span className="text-xs font-semibold">{L('Terminos (opcional)', 'Terms (optional)')}</span>
                <textarea
                  value={warrantyTerms}
                  onChange={e => setWarrantyTerms(e.target.value)}
                  rows={2}
                  placeholder="Cubre defectos de fabrica. Excluye desgaste por uso normal."
                  className="mt-1 w-full border border-black px-2 py-1.5"
                />
              </label>
            </>
          ) : (
            <p className="text-xs text-black/60">{L('Sin garantia post-venta para esta venta.', 'No post-sale warranty for this deal.')}</p>
          )}
        </div>

        <div className="border border-black p-4 bg-black text-white space-y-2">
          <h2 className="font-bold border-b border-white/20 pb-2">{L('5. Resumen', '5. Summary')}</h2>
          <Row label={L('Precio de Venta', 'Sale Price')} value={fmtRD(salePrice)} />
          {hasTradeIn && <Row label={L('— Intercambio', '— Trade-in')} value={`- ${fmtRD(tradeIn.appraisal)}`} />}
          <Row label={L('— Inicial', '— Down Payment')} value={`- ${fmtRD(downPayment)}`} />
          <div className="border-t border-white/30 pt-2">
            <Row label={L('Monto Financiado', 'Financed Amount')} value={fmtRD(deal.financed)} bold />
          </div>
          <Row label={L('Pago Mensual', 'Monthly Payment')} value={fmtRD(deal.monthly)} big />
          <Row label={L('Total de Pagos', 'Total of Payments')} value={fmtRD(deal.totalOfPayments)} />
          <Row label={L('Interés Total', 'Total Interest')} value={fmtRD(deal.totalInterest)} />
          {Number(commissionPct) > 0 && (
            <div className="border-t border-white/30 pt-2">
              <Row label={`${L('Comisión Vendedor', 'Sales Commission')} (${commissionPct}%)`} value={fmtRD(commissionAmount)} />
            </div>
          )}
          <button
            onClick={() => setShowQuoteModal(true)}
            disabled={!vehicleId || !clientId}
            className="mt-3 w-full px-4 py-2 bg-white text-[#b3001e] border-2 border-[#b3001e] text-sm font-bold disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            <FileText size={14} />
            {L('Generar cotizacion', 'Generate quote')}
          </button>
          <button
            onClick={() => closeDeal()}
            disabled={saving || !vehicleId || !clientId}
            className="mt-2 w-full px-4 py-3 bg-[#b3001e] text-white font-bold disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            {L('Cerrar Venta', 'Close Deal')}
          </button>
          {result?.ok === false && <div className="bg-white text-[#b3001e] px-3 py-2 text-xs">{result.err}</div>}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold, big }) {
  return (
    <div className={`flex items-center justify-between ${big ? 'text-2xl font-bold' : bold ? 'font-bold' : 'text-sm'}`}>
      <span className={big ? '' : 'opacity-80'}>{label}</span>
      <span>{value}</span>
    </div>
  )
}
