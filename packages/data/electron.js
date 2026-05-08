/**
 * electron.js — Electron data layer.
 *
 * Simply passes through to window.electronAPI and window.printerAPI
 * which are set up by electron/preload.js via contextBridge.
 *
 * This is the "do nothing" adapter — the existing IPC bridge already
 * provides the exact shape we need. We just expose it through the
 * DataContext so screens don't reference window globals directly.
 */

import { voidNoShowFeeOrchestrator } from '@terminal-x/services/voidNoShowFee'

// Pure client-side projection of mora (late fee) for an invoice given its plan.
function projectedLateFee(inv, plan) {
  if (!inv || !plan) return { amount: 0, applies: false, ageDays: 0 }
  if (inv.status === 'paid' || inv.status === 'void') return { amount: 0, applies: false, ageDays: 0 }
  const pct  = Number(plan.late_fee_pct || 0)
  const days = Number(plan.late_fee_after_days || 0)
  if (pct <= 0 || days <= 0 || !inv.created_at) return { amount: 0, applies: false, ageDays: 0 }
  const issued = new Date(inv.created_at).getTime()
  const ageDays = Math.floor((Date.now() - issued) / 86400000)
  if (ageDays <= days) return { amount: 0, applies: false, ageDays }
  const base = Number(inv.amount || plan.monthly_amount || 0)
  return { amount: Math.round(base * (pct / 100) * 100) / 100, applies: true, ageDays }
}

export function createElectronAPI() {
  const raw = (typeof window !== 'undefined') ? window.electronAPI : null
  if (!raw) return null
  // Most namespaces pass through verbatim — preload.js already matches the
  // DataContext shape. For Restaurant Mode we make the namespaces explicit so
  // consumers (and type tooling) see the exact contract regardless of any
  // preload key renames down the line.
  // v2.7.1 — loyalty surface: expose under api.clients.loyalty* and api.loyalty
  // so UI can consume either namespace uniformly across desktop + web.
  const loyalty = raw.loyalty ? {
    loyaltyAward:   (d) => raw.loyalty.award(d),
    loyaltyRedeem:  (d) => raw.loyalty.redeem(d),
    loyaltyAdjust:  (d) => raw.loyalty.adjust(d),
    loyaltyHistory: (d) => raw.loyalty.history(d),
  } : {}
  // v2.5 — Concesionario photo/document uploads require Supabase Storage.
  // On desktop, surface a helpful error instead of crashing — clients should
  // upload photos/documents from the web app at terminalxpos.com/pos.
  const dealershipUploadStub = async () => {
    throw new Error('Photo and document uploads are web-only. Open terminalxpos.com/pos to upload.')
  }
  const vehicleInventoryAugmented = raw.vehicleInventory ? {
    ...raw.vehicleInventory,
    uploadPhoto: dealershipUploadStub,
    removePhoto: dealershipUploadStub,
    bulkImport:  async (rows) => {
      if (!Array.isArray(rows) || !rows.length) return { inserted: 0 }
      let inserted = 0
      for (const r of rows) {
        try { await raw.vehicleInventory.create(r); inserted++ } catch {}
      }
      return { inserted }
    },
  } : raw.vehicleInventory
  const vehicleDocumentsAugmented = raw.vehicleDocuments ? {
    ...raw.vehicleDocuments,
    upload: dealershipUploadStub,
  } : raw.vehicleDocuments
  // v2.14 — flat aliases for namespaces the desktop preload nests under `salon.*`
  // but the screens (and the web adapter) consume top-level. Without these,
  // Salon/Memberships.jsx and any caller of `api.salonMemberships.*` blew up
  // on desktop with "Cannot read properties of undefined".
  const salonMembershipsFlat   = raw.salon?.memberships         || undefined
  const clientMembershipsFlat  = raw.salon?.clientMemberships   || undefined
  const appointmentRemindersFlat = raw.salon?.reminders         || undefined
  // v2.16.2 — unified activity surface so screens can call `api.activity.log(evt)`
  // on either platform. Desktop routes to IPC `activity:record`; web routes to
  // `logActivity()` (see web.js). Without this wrapper screens had to branch.
  const activityAugmented = raw.activity ? {
    ...raw.activity,
    log: (evt) => raw.activity.record?.(evt),
  } : raw.activity
  // v2.16.3 — bind tickets.voidNoShowFee renderer-side orchestrator. The
  // helper depends on api.dgii_ecf + api.ncf.next + api.notas.create + api.appointments.update
  // (already exposed by preload). Wrapping AFTER the augmented object is built
  // would create a circular ref, so we forward-declare via a holder.
  let augmentedRef = null
  const ticketsAugmented = raw.tickets ? {
    ...raw.tickets,
    voidNoShowFee: (args) => voidNoShowFeeOrchestrator(args || {}, augmentedRef),
    // v2.16.3 — Restaurante H3 Mover/Juntar. Routed through new IPC channels;
    // the renderer-facing names mirror the web.js contract so RestaurantPOS
    // can call api.tickets.transferToMesa / merge regardless of platform.
    getActiveByMesa: (mesaId) => raw.tickets.getActiveByMesa
      ? raw.tickets.getActiveByMesa(mesaId)
      : Promise.resolve(null),
    transferToMesa:  (ticketSupabaseId, newMesaId) => raw.tickets.transferToMesa
      ? raw.tickets.transferToMesa(ticketSupabaseId, newMesaId)
      : Promise.reject(new Error('Mover mesa requiere actualización (IPC no expuesto)')),
    merge: (targetTicketSupabaseId, sourceTicketSupabaseId) => raw.tickets.merge
      ? raw.tickets.merge(targetTicketSupabaseId, sourceTicketSupabaseId)
      : Promise.reject(new Error('Juntar mesas requiere actualización (IPC no expuesto)')),
  } : raw.tickets

  // v2.16.3 — Restaurante H4 Reservas. Desktop now ships the real IPC surface
  // under raw.restaurantReservations (preload.js + main.js + database.js
  // landed in v2.16.3). The stub fallback below stays as a safety net for
  // renderer instances loaded against an older preload (e.g. mid-update
  // window): list returns []; mutations reject with a Spanish toast.
  const restReservationsAugmented = raw.restaurantReservations || {
    list:         async () => [],
    create:       async () => { throw new Error('Reservas requiere actualización del Terminal X') },
    update:       async () => { throw new Error('Reservas requiere actualización del Terminal X') },
    confirm:      async () => { throw new Error('Reservas requiere actualización del Terminal X') },
    cancel:       async () => { throw new Error('Reservas requiere actualización del Terminal X') },
    markNoShow:   async () => { throw new Error('Reservas requiere actualización del Terminal X') },
    seat:         async () => { throw new Error('Reservas requiere actualización del Terminal X') },
    stampWhatsapp: async () => { throw new Error('Reservas requiere actualización del Terminal X') },
  }
  // v2.17 — Food Truck namespaces. Stub fallback for older preloads.
  const foodTruckLocationsAugmented = raw.foodTruckLocations || {
    list:   async () => [],
    create: async () => { throw new Error('Food Truck requiere actualización del Terminal X') },
    update: async () => { throw new Error('Food Truck requiere actualización del Terminal X') },
    delete: async () => { throw new Error('Food Truck requiere actualización del Terminal X') },
  }
  const wasteLogAugmented = raw.wasteLog || {
    list:   async () => [],
    create: async () => { throw new Error('Mermas requiere actualización del Terminal X') },
    delete: async () => { throw new Error('Mermas requiere actualización del Terminal X') },
  }
  // Phase 1B — Contabilidad firm-side suite. Mirrors the API surface of
  // packages/data/contabilidad.js (web/Supabase) so the screens shipped in
  // Phase 1A consume `api.contabilidad.*` identically on either platform.
  // Web inserts pass `business_id` implicitly via Supabase auth.business_id;
  // desktop reads it from app_settings via the IPC handler — UI never sets it.
  const contabilidadAugmented = raw.contabilidad ? {
    // Cartera
    clientList:             (params = {})   => raw.contabilidad.clientList(params),
    clientCreate:           (payload)       => raw.contabilidad.clientCreate(payload),
    clientUpdate:           (id, patch)     => raw.contabilidad.clientUpdate(id, patch),
    clientGet:              (id)            => raw.contabilidad.clientGet(id),
    clientDelete:           (id)            => raw.contabilidad.clientDelete(id),
    // Bandeja
    inboxList:              (params = {})   => raw.contabilidad.inboxList(params),
    inboxAdd:               (payload)       => raw.contabilidad.inboxAdd(payload),
    inboxClassify:          (id, patch)     => raw.contabilidad.inboxClassify(id, patch),
    inboxPost:              (id, journalEntryId = null) =>
      raw.contabilidad.inboxPost(id, { posted_journal_entry_id: journalEntryId }),
    inboxDelete:            (id)            => raw.contabilidad.inboxDelete(id),
    // Calendario / obligaciones
    obligationsList:        (params = {})   => raw.contabilidad.obligationsList(params),
    obligationsMarkFiled:   (id, payload)   => raw.contabilidad.obligationMarkFiled(id, payload),
    obligationsGenerateYear:(params)        => raw.contabilidad.obligationsGenerateYear(params),
    // Documentos
    documentList:           (params = {})   => raw.contabilidad.documentList(params),
    documentAdd:            (payload)       => raw.contabilidad.documentAdd(payload),
    documentDelete:         (id)            => raw.contabilidad.documentDelete(id),
    // Honorarios
    billingPlanList:        (params = {})   => raw.contabilidad.billingPlanList(params),
    billingPlanCreate:      (payload)       => raw.contabilidad.billingPlanCreate(payload),
    billingPlanUpdate:      (id, patch)     => raw.contabilidad.billingPlanUpdate(id, patch),
    billingInvoiceList:     (params = {})   => raw.contabilidad.billingInvoiceList(params),
    billingInvoiceCreate:   (payload)       => raw.contabilidad.billingInvoiceCreate(payload),
    billingInvoiceMarkPaid: (id)            => raw.contabilidad.billingInvoiceMarkPaid(id),
    billingInvoiceProjectedLateFee: (inv, plan) => projectedLateFee(inv, plan),
    // CSV mappings (desktop-only convenience)
    csvMappingList:         (params = {})   => raw.contabilidad.csvMappingList(params),
    csvMappingCreate:       (payload)       => raw.contabilidad.csvMappingCreate(payload),

    // Phase 2 Slice 1 — Chart of accounts
    coaList:                (params = {})   => raw.contabilidad.coaList(params),
    coaCreate:              (payload)       => raw.contabilidad.coaCreate(payload),
    coaUpdate:              (id, patch)     => raw.contabilidad.coaUpdate(id, patch),
    coaGet:                 (id)            => raw.contabilidad.coaGet(id),
    coaDelete:              (id)            => raw.contabilidad.coaDelete(id),
    // Journal entries + lines
    journalEntryList:       (params = {})   => raw.contabilidad.journalEntryList(params),
    journalEntryCreate:     (payload)       => raw.contabilidad.journalEntryCreate(payload),
    journalEntryUpdate:     (id, patch)     => raw.contabilidad.journalEntryUpdate(id, patch),
    journalEntryGet:        (id)            => raw.contabilidad.journalEntryGet(id),
    journalEntryDelete:     (id)            => raw.contabilidad.journalEntryDelete(id),
    journalLineList:        (params = {})   => raw.contabilidad.journalLineList(params),
    journalLineAdd:         (payload)       => raw.contabilidad.journalLineAdd(payload),
    journalLineDelete:      (id)            => raw.contabilidad.journalLineDelete(id),
    // Auto-post rules
    autoPostRuleList:       (params = {})   => raw.contabilidad.autoPostRuleList(params),
    autoPostRuleCreate:     (payload)       => raw.contabilidad.autoPostRuleCreate(payload),
    autoPostRuleUpdate:     (id, patch)     => raw.contabilidad.autoPostRuleUpdate(id, patch),
    autoPostRuleDelete:     (id)            => raw.contabilidad.autoPostRuleDelete(id),
    // Bank accounts + statement lines
    bankAccountList:        (params = {})   => raw.contabilidad.bankAccountList(params),
    bankAccountCreate:      (payload)       => raw.contabilidad.bankAccountCreate(payload),
    bankAccountUpdate:      (id, patch)     => raw.contabilidad.bankAccountUpdate(id, patch),
    bankAccountDelete:      (id)            => raw.contabilidad.bankAccountDelete(id),
    bankStatementLineList:    (params = {}) => raw.contabilidad.bankStatementLineList(params),
    bankStatementLineAdd:     (payload)     => raw.contabilidad.bankStatementLineAdd(payload),
    bankStatementLineUpdate:  (id, patch)   => raw.contabilidad.bankStatementLineUpdate(id, patch),
    bankStatementLineDelete:  (id)          => raw.contabilidad.bankStatementLineDelete(id),
    // Fixed assets
    fixedAssetList:         (params = {})   => raw.contabilidad.fixedAssetList(params),
    fixedAssetCreate:       (payload)       => raw.contabilidad.fixedAssetCreate(payload),
    fixedAssetUpdate:       (id, patch)     => raw.contabilidad.fixedAssetUpdate(id, patch),
    fixedAssetDelete:       (id)            => raw.contabilidad.fixedAssetDelete(id),
    // Retentions
    retentionEmitidaList:   (params = {})   => raw.contabilidad.retentionEmitidaList(params),
    retentionEmitidaCreate: (payload)       => raw.contabilidad.retentionEmitidaCreate(payload),
    retentionEmitidaUpdate: (id, patch)     => raw.contabilidad.retentionEmitidaUpdate(id, patch),
    retentionEmitidaDelete: (id)            => raw.contabilidad.retentionEmitidaDelete(id),
    retentionRecibidaList:   (params = {})  => raw.contabilidad.retentionRecibidaList(params),
    retentionRecibidaCreate: (payload)      => raw.contabilidad.retentionRecibidaCreate(payload),
    retentionRecibidaUpdate: (id, patch)    => raw.contabilidad.retentionRecibidaUpdate(id, patch),
    retentionRecibidaDelete: (id)           => raw.contabilidad.retentionRecibidaDelete(id),
    // Payroll
    payrollPeriodList:      (params = {})   => raw.contabilidad.payrollPeriodList(params),
    payrollPeriodCreate:    (payload)       => raw.contabilidad.payrollPeriodCreate(payload),
    payrollPeriodUpdate:    (id, patch)     => raw.contabilidad.payrollPeriodUpdate(id, patch),
    payrollPeriodGet:       (id)            => raw.contabilidad.payrollPeriodGet(id),
    payrollPeriodDelete:    (id)            => raw.contabilidad.payrollPeriodDelete(id),
    payrollLineList:        (params = {})   => raw.contabilidad.payrollLineList(params),
    payrollLineAdd:         (payload)       => raw.contabilidad.payrollLineAdd(payload),
    payrollLineDelete:      (id)            => raw.contabilidad.payrollLineDelete(id),
    payrollLineUpdate:      (id, patch)     => raw.contabilidad?.payrollLineUpdate?.(id, patch),
    payrollEmpBankList:     (params = {})   => raw.contabilidad?.payrollEmpBankList?.(params) || [],
    payrollEmpBankUpsert:   (payload)       => raw.contabilidad?.payrollEmpBankUpsert?.(payload),
    // TSS
    tssFilingList:          (params = {})   => raw.contabilidad.tssFilingList(params),
    tssFilingCreate:        (payload)       => raw.contabilidad.tssFilingCreate(payload),
    tssFilingUpdate:        (id, patch)     => raw.contabilidad.tssFilingUpdate(id, patch),
    tssFilingDelete:        (id)            => raw.contabilidad.tssFilingDelete(id),
    // Tasks
    taskList:               (params = {})   => raw.contabilidad.taskList(params),
    taskCreate:             (payload)       => raw.contabilidad.taskCreate(payload),
    taskUpdate:             (id, patch)     => raw.contabilidad.taskUpdate(id, patch),
    taskDelete:             (id)            => raw.contabilidad.taskDelete(id),
    // Foreign payments
    foreignPaymentList:     (params = {})   => raw.contabilidad.foreignPaymentList(params),
    foreignPaymentCreate:   (payload)       => raw.contabilidad.foreignPaymentCreate(payload),
    foreignPaymentUpdate:   (id, patch)     => raw.contabilidad.foreignPaymentUpdate(id, patch),
    foreignPaymentDelete:   (id)            => raw.contabilidad.foreignPaymentDelete(id),
  } : undefined

  return (augmentedRef = {
    ...raw,
    contabilidad: contabilidadAugmented,
    activity: activityAugmented,
    vehicleInventory: vehicleInventoryAugmented,
    vehicleDocuments: vehicleDocumentsAugmented,
    salonMemberships:      salonMembershipsFlat,
    clientMemberships:     clientMembershipsFlat,
    appointmentReminders:  appointmentRemindersFlat,
    tickets:  ticketsAugmented,
    restaurantReservations: restReservationsAugmented,
    foodTruckLocations: foodTruckLocationsAugmented,
    wasteLog: wasteLogAugmented,
    clients: raw.clients ? { ...raw.clients, ...loyalty } : raw.clients,
    mesas: {
      list:        ()                   => raw.mesas.list(),
      create:      (data)               => raw.mesas.create(data),
      update:      (id, data)           => raw.mesas.update(id, data),
      setStatus:   (id, status, opts)   => raw.mesas.setStatus(id, status, opts),
      requestBill: (id)                 => raw.mesas.requestBill(id),
      delete:      (id)                 => raw.mesas.delete(id),
    },
    modificadores: {
      list:              ()                                    => raw.modificadores.list(),
      listAll:           ()                                    => raw.modificadores.listAll(),
      create:            (data)                                => raw.modificadores.create(data),
      update:            (id, data)                            => raw.modificadores.update(id, data),
      delete:            (id)                                  => raw.modificadores.delete(id),
      listForService:    (serviceId)                           => raw.modificadores.listForService(serviceId),
      attachToService:   (serviceId, modificadorId, isRequired = 0) => raw.modificadores.attachToService(serviceId, modificadorId, isRequired),
      detachFromService: (serviceId, modificadorId)            => raw.modificadores.detachFromService(serviceId, modificadorId),
    },
    kds: {
      listActive: ()              => raw.kds.listActive(),
      fire:       (data)          => raw.kds.fire(data),
      setStatus:  (id, status)    => raw.kds.setStatus(id, status),
    },
    ofertas: raw.ofertas ? {
      list:   (opts = {})         => raw.ofertas.list(opts || {}),
      get:    (supabase_id)       => raw.ofertas.get(supabase_id),
      upsert: (data)              => raw.ofertas.upsert(data),
      delete: (supabase_id)       => raw.ofertas.delete(supabase_id),
    } : undefined,
    restaurant: {
      itemModificadores: {
        list:     (ticketItemId) => raw.restaurant.itemModificadores.list(ticketItemId),
        snapshot: (ticketItemSupabaseId, ticketItemId, selections) =>
          raw.restaurant.itemModificadores.snapshot(ticketItemSupabaseId, ticketItemId, selections),
      },
    },
  })
}

export function createElectronPrinterAPI() {
  if (!window.printerAPI) return null
  // Augment the preload-injected printerAPI with a `print` method that
  // delegates to electronAPI.print (the real receipt-sending IPC). Without
  // this, callers that do `printerApi.print(...)` silently no-op because
  // window.printerAPI only exposes listPrinters / openDrawer / testDrawerVariants.
  return {
    ...window.printerAPI,
    print: (payload) => (window.electronAPI?.print
      ? window.electronAPI.print(payload)
      : Promise.resolve({ success: false, error: 'no_print_ipc' })),
  }
}

/** True when running inside Electron (preload.js injected the bridge) */
export function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI
}
