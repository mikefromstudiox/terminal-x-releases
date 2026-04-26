/**
 * WorkOrders/index.jsx — orchestrator for the Mecánica work-order kanban.
 *
 * v2.16.x FIX-HIGH-7: extracted from the legacy 1.4k-line god component into
 * three sibling presentational modules (WOActions, WOKanban, WOModal) plus
 * this orchestrator. The legacy `WorkOrders.jsx` file is now a 1-line
 * re-export shim so callers (router, sidebar) keep working unchanged.
 *
 * Behavior is 1:1 with the pre-refactor screen — visual layout, status
 * transitions, photo gates, WO→Cobrar bridge, activity_log emissions, and
 * the cloud-synced tow fee (was hardcoded RD$ 500, now `mechanic_tow_fee_default`
 * in app_settings) are all preserved.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAPI } from '../../../context/DataContext'
import { useAuth } from '../../../context/AuthContext'
import { useLang } from '../../../i18n'
import CobrarModal from '../../../components/CobrarModal'
import PaymentErrorBoundary from '../../../components/PaymentErrorBoundary'
import ErrorBoundary from '../../../components/ErrorBoundary'
import { enqueueActivity } from '@terminal-x/services/activity-log-queue.js'
import { STATUSES, normStatus, timingPatchForStatus, fmtWO } from '../wo/constants'

import WOActions from './WOActions'
import WOKanban from './WOKanban'
import { CreateModal, DetailModal } from './WOModal'

// Default tow fee in RD$ when the owner has not customized it via Sistema.
// Lives here (not in WOModal) because it is fetched once at the orchestrator
// level and threaded down to every modal that may auto-add the remolque line.
export const DEFAULT_TOW_FEE_DOP = 500

function WorkOrdersScreen() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [orders,    setOrders]    = useState([])
  const [vehicles,  setVehicles]  = useState([])
  const [clients,   setClients]   = useState([])
  const [empleados, setEmpleados] = useState([])
  const [bays,      setBays]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [detail,    setDetail]    = useState(null)
  // FIX-HIGH-7 — toast supports an optional `kind` ('ok' | 'error') so save
  // failures are surfaced in red without ever being silently swallowed.
  const [toast,     setToast]     = useState(null)
  const [cobrarWO,  setCobrarWO]  = useState(null)
  // FIX-HIGH-7 — owner-configurable tow/delivery fee (was hardcoded RD$ 500
  // at L883 of the legacy file). Stored in app_settings.mechanic_tow_fee_default
  // and cloud-synced via isBusinessSetting() so every register sees the same
  // amount the moment the owner saves Sistema.
  const [towFee, setTowFee] = useState(DEFAULT_TOW_FEE_DOP)

  function flash(msg, kind = 'ok') {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), kind === 'error' ? 5000 : 3000)
  }

  // Surface a save failure: toast in red + route the audit row through the
  // canonical activity helper (with IDB fallback queue if the live insert
  // fails) so the owner sees it in the Actividad feed.
  async function reportMutationFailure(scope, err, extra = {}) {
    const msg = String(err?.message || err || 'unknown').slice(0, 240)
    console.warn(`[WorkOrders] ${scope} failed`, msg)
    flash(L('No se pudo guardar la orden. Reintenta.', 'Could not save the work order. Please retry.'), 'error')
    const evt = {
      event_type: 'mechanic_wo_mutation_failed',
      severity:   'warn',
      target_type: 'work_order',
      reason:     scope,
      metadata:   { scope, error: msg, ...extra },
    }
    try { await api?.activity?.log?.(evt) }
    catch { try { await enqueueActivity(evt) } catch {} }
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [wo, v, c, e, b, s] = await Promise.all([
        api?.workOrders?.list?.()      || [],
        api?.vehicles?.list?.()        || [],
        api?.clients?.all?.()          || [],
        api?.empleados?.all?.()        || [],
        api?.serviceBays?.list?.()     || [],
        api?.settings?.get?.()         || {},
      ])
      setOrders((wo || []).map(o => ({ ...o, status: normStatus(o.status) })))
      setVehicles(v || [])
      setClients(c || [])
      setEmpleados(e || [])
      setBays(b || [])
      const fee = Number(s?.mechanic_tow_fee_default)
      setTowFee(Number.isFinite(fee) && fee > 0 ? fee : DEFAULT_TOW_FEE_DOP)
    } catch (e) {
      // Non-blocking: empty lists render the empty state. Surface to the
      // toast so a failed initial load doesn't masquerade as "no orders".
      console.warn('[WorkOrders] loadAll failed', e?.message || e)
      flash(L('No se pudieron cargar las órdenes. Reintenta.', 'Could not load orders. Please retry.'), 'error')
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  async function handleCreate(data) {
    try {
      await api.workOrders.create(data)
      setShowCreate(false)
      await loadAll()
      flash(L('Orden de trabajo creada', 'Work order created'))
    } catch (e) {
      await reportMutationFailure('create', e)
      throw e // CreateModal surfaces its own inline error too
    }
  }

  async function handleStatusChange(id, newStatus) {
    // v2.6.2 — completado→facturado opens CobrarModal (sale must hit Cuadre).
    if (newStatus === 'facturado') {
      const wo = orders.find(o => o.id === id)
      if (wo) { setDetail(null); openCobrarForWO(wo); return }
    }
    // v2.16.0 — stamp started_at / finished_at / ready_at on transition.
    const timingPatch = timingPatchForStatus(newStatus)
    try {
      if (Object.keys(timingPatch).length) {
        try { await api.workOrders.update(id, { status: newStatus, ...timingPatch }) }
        catch { await api.workOrders.updateStatus({ id, status: newStatus }) }
      } else {
        await api.workOrders.updateStatus({ id, status: newStatus })
      }
    } catch (e) {
      await reportMutationFailure('status_change', e, { id, newStatus })
      return
    }
    // FIX-H3 — emit activity_log events at status transitions that matter for
    // the Mecánica chip in RemoteDashboard. wo_estimate_approved is fired
    // server-side from the public approval page so we don't double-emit it.
    try {
      const wo = orders.find(o => o.id === id)
      if (newStatus === 'en_progreso') {
        await api.activity?.log?.({
          event_type: 'wo_started', severity: 'info',
          target_type: 'work_order', target_id: id,
          target_name: wo?.plate || wo?.client_name || null,
          metadata: { work_order_supabase_id: wo?.supabase_id, vehicle_plate: wo?.plate },
        })
      } else if (newStatus === 'listo') {
        await api.activity?.log?.({
          event_type: 'wo_ready_for_pickup', severity: 'info',
          target_type: 'work_order', target_id: id,
          target_name: wo?.plate || wo?.client_name || null,
          metadata: { work_order_supabase_id: wo?.supabase_id, vehicle_plate: wo?.plate, delivery: !!wo?.delivery_required },
        })
      }
    } catch (e) { console.warn('[WorkOrders] activity log emit failed', e?.message || e) }
    await loadAll()
    if (detail?.id === id) {
      const updated = (await api.workOrders.list())?.find(o => o.id === id)
      if (updated) setDetail(updated)
    }
    flash(L('Estado actualizado', 'Status updated'))
  }

  async function handleAddItem(orderId, item) {
    try {
      await api.workOrders.addItem({ work_order_id: orderId, ...item })
      await loadAll()
      const updated = (await api.workOrders.list())?.find(o => o.id === orderId)
      if (updated) setDetail(updated)
    } catch (e) {
      await reportMutationFailure('add_item', e, { orderId, item_name: item?.name })
    }
  }

  async function handleDeleteItem(orderId, itemId) {
    try {
      await api.workOrders.deleteItem({ work_order_id: orderId, item_id: itemId })
      await loadAll()
      const updated = (await api.workOrders.list())?.find(o => o.id === orderId)
      if (updated) setDetail(updated)
    } catch (e) {
      await reportMutationFailure('delete_item', e, { orderId, itemId })
    }
  }

  async function handleSaveInspection(orderId, inspection) {
    try {
      await api.workOrders.saveInspection({ id: orderId, inspection })
      await loadAll()
      flash(L('Inspeccion guardada', 'Inspection saved'))
    } catch (e) {
      await reportMutationFailure('save_inspection', e, { orderId })
    }
  }

  async function handleGenerateApprovalLink(orderId) {
    try {
      const r = await api.workOrders.generateApprovalToken({ id: orderId })
      await loadAll()
      return r
    } catch (e) {
      await reportMutationFailure('generate_approval_link', e, { orderId })
      return null
    }
  }

  // ── WO → Ticket bridge ──────────────────────────────────────────────────
  function buildTicketFromWO(wo) {
    const items = (wo.items || []).map(li => ({
      id:               `wo-${wo.id}-${li.id}`,
      name:             li.name,
      price:            Number(li.unit_price) || 0,
      qty:              Number(li.qty ?? li.quantity) || 1,
      cost:             0,
      is_wash:          li.type === 'part' ? 0 : 1,
      aplica_itbis:     li.type === 'part' ? 1 : 0,
      inventory_item_id: li.inventory_item_id || null,
    }))
    return {
      id:           `wo-${wo.id}`,
      ticketNo:     fmtWO(wo.order_number || wo.id),
      vehicle:      wo.plate || '',
      vehicleVin:   wo.vehicle_vin   || null,
      vehicleMake:  wo.vehicle_make  || wo.make  || null,
      vehicleModel: wo.vehicle_model || wo.model || null,
      vehicleKm:    wo.odometer_in_km != null ? wo.odometer_in_km : (wo.odometer_km != null ? wo.odometer_km : null),
      services:     items,
      client:       wo.client_supabase_id || wo.client_id
                     ? { id: wo.client_id, supabase_id: wo.client_supabase_id, name: wo.client_name }
                     : null,
      photoEvidence: Array.isArray(wo.photoEvidence) ? wo.photoEvidence : [],
      _wo:          wo,
    }
  }

  // FIX-H4 — pre-fetch antes/después photos for the receipt PDF embed.
  async function fetchPhotoEvidenceForWO(wo) {
    if (!wo?.supabase_id) return []
    try {
      const photos = (await api.workOrderPhotos?.listByWO?.(wo.supabase_id)) || []
      if (!photos.length) return []
      const antes   = photos.filter(p => p.phase === 'antes').slice(0, 2)
      const despues = photos.filter(p => p.phase === 'despues').slice(0, 2)
      const picks   = [...antes, ...despues]
      const out     = []
      for (const p of picks) {
        try {
          let url = p.signed_url || null
          if (!url && p.storage_path && api.workOrderPhotos?.signedUrl) {
            url = await api.workOrderPhotos.signedUrl(p.storage_path)
          }
          if (!url) continue
          const resp = await fetch(url)
          if (!resp.ok) continue
          const blob = await resp.blob()
          const b64  = await new Promise((res, rej) => {
            const fr = new FileReader()
            fr.onerror = () => rej(fr.error)
            fr.onload  = () => res(String(fr.result))
            fr.readAsDataURL(blob)
          })
          out.push({ phase: p.phase, base64: b64, caption: p.caption || null })
        } catch (e) {
          console.warn('[fetchPhotoEvidenceForWO] photo skipped', e?.message || e)
        }
      }
      return out
    } catch (e) {
      console.warn('[fetchPhotoEvidenceForWO] list failed', e?.message || e)
      return []
    }
  }

  async function openCobrarForWO(wo) {
    if (!wo || !(wo.items || []).length) {
      flash(L('Agregar items antes de facturar', 'Add items before invoicing'), 'error')
      return
    }
    let photoEvidence = []
    try { photoEvidence = await fetchPhotoEvidenceForWO(wo) } catch {}
    setCobrarWO({ ...wo, photoEvidence })
  }

  async function handleWOCobrarConfirm(paymentData) {
    const wo = cobrarWO
    if (!wo) return
    try {
      const items = (wo.items || []).map(li => ({
        service_id:        null,
        inventory_item_id: li.inventory_item_id || null,
        name:              li.name,
        price:             Number(li.unit_price) || 0,
        cost:              0,
        is_wash:           li.type === 'part' ? 0 : 1,
        quantity:          Number(li.qty ?? li.quantity) || 1,
        sku:               null,
        aplica_itbis:      li.type === 'part' ? 1 : 0,
      }))
      const result = await api.tickets.create({
        vehicle_plate:    wo.plate || null,
        client_id:        wo.client_id || null,
        client_supabase_id: wo.client_supabase_id || null,
        washer_ids:       [],
        seller_id:        wo.technician_id || null,
        cajero_id:        (user?.id && user.id !== 'web') ? user.id : null,
        comprobante_type: paymentData.ncfType || 'E32',
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        tipo_venta:       paymentData.tipo || 'contado',
        status:           paymentData.tipo === 'credito' ? 'pendiente' : 'cobrado',
        subtotal:         Number(paymentData.subtotal) || 0,
        itbis:            Number(paymentData.itbis) || 0,
        ley:              Number(paymentData.ley) || 0,
        total:            Number(paymentData.total) || 0,
        ecf_result:       paymentData.ecf || {},
        items,
        comentario:       `[WO ${fmtWO(wo.order_number || wo.id)} · ${wo.plate || 's/placa'}] ${paymentData.comentario || ''}`.trim(),
        descuento:        Number(paymentData.descuento) || 0,
        descuento_reason: paymentData.descuentoReason || null,
        mac_jti:          paymentData.mac_jti || null,
      })

      // Stamp ticket link on the WO + flip to facturado.
      try {
        await api.workOrders.update(wo.id, {
          status:             'facturado',
          ticket_id:          result?.id || null,
          ticket_supabase_id: result?.supabase_id || null,
        })
      } catch (updErr) {
        try { await api.workOrders.updateStatus({ id: wo.id, status: 'facturado' }) }
        catch (statErr) {
          await reportMutationFailure('wo_facturado_finalize', statErr, { wo_id: wo.id, ticket_id: result?.id })
        }
      }

      flash(L('Orden facturada ✓', 'Work order invoiced ✓'))
      await loadAll()
    } catch (err) {
      await reportMutationFailure('wo_cobrar_confirm', err, { wo_id: wo.id })
    }
  }

  async function handleSetPartsOrder(orderId, expected_parts_arrival) {
    try {
      await api.workOrders.setPartsOrder({ id: orderId, expected_parts_arrival })
      await loadAll()
      const updated = (await api.workOrders.list())?.find(o => o.id === orderId)
      if (updated) setDetail(updated)
      flash(L('Marcado: esperando repuestos', 'Marked: awaiting parts'))
    } catch (e) {
      await reportMutationFailure('set_parts_order', e, { orderId })
    }
  }

  // Counts per status
  const counts = useMemo(() => {
    const c = { all: orders.length }
    STATUSES.forEach(s => { c[s.id] = orders.filter(o => o.status === s.id).length })
    return c
  }, [orders])

  // Filtered list
  const visible = useMemo(() => {
    let list = orders
    if (filter !== 'all') list = list.filter(o => o.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        (o.plate || '').toLowerCase().includes(q) ||
        (o.client_name || '').toLowerCase().includes(q) ||
        (o.make || '').toLowerCase().includes(q) ||
        (o.model || '').toLowerCase().includes(q) ||
        fmtWO(o.order_number || o.id).toLowerCase().includes(q)
      )
    }
    return list
  }, [orders, filter, search])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      <WOActions
        lang={lang}
        search={search} onSearch={setSearch}
        filter={filter} onFilter={setFilter}
        counts={counts}
        onNew={() => setShowCreate(true)}
      />

      <WOKanban
        lang={lang}
        loading={loading}
        orders={visible}
        onCardClick={setDetail}
      />

      {showCreate && (
        <CreateModal
          vehicles={vehicles} clients={clients} empleados={empleados} bays={bays}
          lang={lang} onSave={handleCreate} onClose={() => setShowCreate(false)}
        />
      )}

      {detail && (
        <DetailModal
          order={detail} lang={lang}
          towFee={towFee}
          onStatusChange={handleStatusChange}
          onAddItem={handleAddItem}
          onDeleteItem={handleDeleteItem}
          onSaveInspection={handleSaveInspection}
          onGenerateApprovalLink={handleGenerateApprovalLink}
          onSetPartsOrder={handleSetPartsOrder}
          onClose={() => setDetail(null)}
        />
      )}

      {/* WO → Cobrar bridge (FIX-C2 — already boundary-wrapped) */}
      {cobrarWO && (
        <PaymentErrorBoundary onClose={() => setCobrarWO(null)}>
          <CobrarModal
            ticket={buildTicketFromWO(cobrarWO)}
            onConfirm={handleWOCobrarConfirm}
            onClose={() => setCobrarWO(null)}
          />
        </PaymentErrorBoundary>
      )}

      {/* Toast — supports kind=ok (slate) and kind=error (crimson) */}
      {toast && (
        <div
          role="status"
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          className={`fixed bottom-6 right-6 flex items-center gap-2.5 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50 ${
            toast.kind === 'error'
              ? 'bg-[#b3001e]'
              : 'bg-slate-800 dark:bg-white/10'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// FIX-HIGH-7 — top-level ErrorBoundary so a render crash anywhere in the
// kanban (cards, filters, modals) shows the recovery UI instead of a white
// screen. PaymentErrorBoundary already protects the CobrarModal subtree.
export default function WorkOrders() {
  return (
    <ErrorBoundary>
      <WorkOrdersScreen />
    </ErrorBoundary>
  )
}
