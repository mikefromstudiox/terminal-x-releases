const { contextBridge, ipcRenderer } = require('electron')

// Helper: unwrap { ok, data } from IPC responses, throw on error
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (res && res.ok === false) throw new Error(res.error || channel)
  return 'data' in res ? res.data : res
}

// Sync pull progress is emitted by main via webContents.send('sync:pull-progress', ...).
// The renderer's LicenseContext listens on a CustomEvent for clean isolation
// (contextBridge can't pass function handles). Forward here instead of exposing
// ipcRenderer.on directly to the window.
try {
  ipcRenderer.on('sync:pull-progress', (_, payload) => {
    try { window.dispatchEvent(new CustomEvent('tx:sync-pull-progress', { detail: payload })) } catch {}
  })
  ipcRenderer.on('sync:pull-complete', (_, payload) => {
    try { window.dispatchEvent(new CustomEvent('tx:sync-pull-complete', { detail: payload })) } catch {}
  })
  // v2.11.2 — DGII cert expiry status (fired on boot + every 12h from main).
  ipcRenderer.on('cert:expiry-status', (_, payload) => {
    try { window.dispatchEvent(new CustomEvent('tx:cert-expiry-status', { detail: payload })) } catch {}
  })
} catch {}

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Admin panel — unified CRUD ─────────────────────────────────────────────
  admin: {
    // Empresa (single row — always update)
    getEmpresa:        ()     => call('get-empresa'),
    saveEmpresa:       (data) => call('save-empresa', data),

    // Usuarios
    getUsuarios:       ()     => call('get-usuarios'),
    saveUsuario:       (data) => call('save-usuario', data),   // upsert: create if no id
    deleteUsuario:     (id)   => call('delete-usuario', { id }),

    // Lavadores
    getLavadores:      ()     => call('get-lavadores'),
    saveLavador:       (data) => call('save-lavador', data),
    deleteLavador:     (id)   => call('delete-lavador', { id }),

    // Vendedores
    getVendedores:     ()     => call('get-vendedores'),
    saveVendedor:      (data) => call('save-vendedor', data),
    deleteVendedor:    (id)   => call('delete-vendedor', { id }),

    // Servicios
    getServicios:      ()     => call('get-servicios'),
    saveServicio:      (data) => call('save-servicio', data),
    deleteServicio:    (id)   => call('delete-servicio', { id }),
    getCategorias:     ()     => call('get-categorias'),

    // Secuencias NCF / e-CF
    getSecuenciasNcf:  ()     => call('get-secuencias-ncf'),
    saveSecuenciaNcf:  (data) => call('save-secuencia-ncf', data),

    // Configuración general
    getConfiguracion:  ()     => call('get-configuracion'),
    saveConfiguracion: (data) => call('save-configuracion', data),
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  settings: {
    get:    ()    => call('settings:get'),
    update: (obj) => call('settings:update', obj),
  },

  // ── Go-Live Gate ───────────────────────────────────────────────────────────
  app: {
    isLive:        ()  => call('app:is-live'),
    testDataCount: ()  => call('app:test-data-count'),
    goLiveCommit:  ()  => call('app:go-live-commit'),
  },

  // ── Inventory ──────────────────────────────────────────────────────────────
  inventory: {
    all:          ()                            => call('inventory:all'),
    create:       (data)                        => call('inventory:create', data),
    update:       (data)                        => call('inventory:update', data),
    bulkUpdate:   (ids, patch)                  => call('inventory:bulkUpdate', { ids, patch }),
    delete:       (data)                        => call('inventory:delete', data),
    adjust:       ({id, delta, notes, userId})  => call('inventory:adjust', {id, delta, notes, userId}),
    transactions: ({id})                        => call('inventory:transactions', {id}),
    lookupSku:    (sku)                         => call('inventory:lookupSku', sku),
    search:       (query)                       => call('inventory:search', query),
    lowStockCount: ()                           => call('inventory:lowStockCount'),
    oversells: {
      list:    (args)                           => call('inventory:oversells:list', args || {}),
      resolve: (payload)                        => call('oversells:resolve', payload || {}),
    },
  },

  // ── v2.16.3 — Carnicería hardening ─────────────────────────────────────────
  carniceria: {
    cortes: {
      list:   ()     => call('carniceria:cortes:list'),
      create: (data) => call('carniceria:cortes:create', data),
      update: (data) => call('carniceria:cortes:update', data),
      remove: (id)   => call('carniceria:cortes:remove', id),
    },
    freshness: {
      list:           ()     => call('carniceria:freshness:list'),
      create:         (data) => call('carniceria:freshness:create', data),
      applyDiscount:  (args) => call('carniceria:freshness:applyDiscount', args),
    },
    discards: {
      create: (data) => call('carniceria:discards:create', data),
      list:   (args) => call('carniceria:discards:list', args || {}),
    },
    recurring: {
      list:     ()     => call('carniceria:recurring:list'),
      create:   (data) => call('carniceria:recurring:create', data),
      update:   (data) => call('carniceria:recurring:update', data),
      remove:   (id)   => call('carniceria:recurring:remove', id),
      markSent: (args) => call('carniceria:recurring:markSent', args),
    },
    scales: {
      list:             ()     => call('carniceria:scales:list'),
      create:           (data) => call('carniceria:scales:create', data),
      update:           (data) => call('carniceria:scales:update', data),
      remove:           (id)   => call('carniceria:scales:remove', id),
      setActiveDefault: (id)   => call('carniceria:scales:setActiveDefault', id),
    },
    resumen: {
      get: () => call('carniceria:resumen:get'),
    },
    discounts: {
      // Returns { [item_supabase_id]: [{ source, pct, label, banner_text, season_key }] }
      activeFor: (item_supabase_ids) => call('carniceria:discounts:activeFor', { item_supabase_ids }),
    },
  },

  // ── Conteo Fisico (v2.5) ──────────────────────────────────────────────────
  inventoryCount: {
    start:    (args) => call('inventoryCount:start', args),
    list:     (args) => call('inventoryCount:list', args),
    get:      (id)   => call('inventoryCount:get', id),
    saveItem: (args) => call('inventoryCount:saveItem', args),
    complete: (args) => call('inventoryCount:complete', args),
    cancel:   (id)   => call('inventoryCount:cancel', { id }),
    delete:   (id)   => call('inventoryCount:delete', { id }),
  },

  // ── Auth ───────────────────────────────────────────────────────────────────
  auth: {
    byPin:         (pin) => call('auth:pin', pin),
    lockoutStatus: ()    => call('auth:lockout-status'),
  },

  // ── Users ──────────────────────────────────────────────────────────────────
  users: {
    all:    ()     => call('users:all'),
    create: (data) => call('users:create', data),
    update: (data) => call('users:update', data),
    delete: (data) => call('users:delete', data),
    deleteHard: (data) => call('users:delete-hard', data),
  },

  // ── Staff / Manager Authorization Card (v2.6) ─────────────────────────────
  staff: {
    generateAuthCard: (id)    => call('staff:generateAuthCard', { id }),
    revokeAuthCard:   (id)    => call('staff:revokeAuthCard',   { id }),
    verifyAuthToken:  (token) => call('staff:verifyAuthToken',  token),
  },

  // v2.8.0 — MAC server-side enforcement. `mac.issue` validates a scanned
  // manager card and returns a one-time jti bound to (action, target_id).
  // The renderer passes `mac_jti` in the subsequent protected IPC payload;
  // auth-guard's `guardMac` consumes + validates it server-side.
  mac: {
    issue: (args) => call('mac:issue', args),
  },

  // ── Activity log (owner audit feed) ────────────────────────────────────────
  activity: {
    setActor:          (user) => call('activity:set-actor', user),
    list:              (args) => call('activity:list', args),
    record:            (evt)  => call('activity:record', evt),
    permissionDenied:  (args) => call('activity:permission-denied', args),
  },

  // ── Categorías de Servicio ─────────────────────────────────────────────────
  categorias: {
    all:    ()     => call('categorias:all'),
    create: (data) => call('categorias:create', data),
    update: (data) => call('categorias:update', data),
    delete: (id)   => call('categorias:delete', { id }),
  },

  // ── Services ───────────────────────────────────────────────────────────────
  services: {
    all:        ()     => call('services:all'),
    allAdmin:   ()     => call('services:all-admin'),
    topSellers: (opts) => call('services:top-sellers', opts || {}),
    create:     (data) => call('services:create', data),
    update:     (data) => call('services:update', data),
    delete:     (data) => call('services:delete', data),
    setInStock: (key, inStock) => call('services:set-in-stock', { key, inStock }),
  },

  // ── Washers ────────────────────────────────────────────────────────────────
  washers: {
    all:      ()     => call('washers:all'),
    allAdmin: ()     => call('washers:all-admin'),
    create:   (data) => call('washers:create', data),
    update:   (data) => call('washers:update', data),
  },

  // ── Sellers ────────────────────────────────────────────────────────────────
  sellers: {
    all:      ()     => call('sellers:all'),
    allAdmin: ()     => call('sellers:all-admin'),
    create:   (data) => call('sellers:create', data),
    update:   (data) => call('sellers:update', data),
  },

  // ── Empleados (payroll) ──────────────────────────────────────────────────
  empleados: {
    all:      ()     => call('empleados:all'),
    allAdmin: ()     => call('empleados:all-admin'),
    create:   (data) => call('empleados:create', data),
    update:   (data) => call('empleados:update', data),
    delete:   (id)   => call('empleados:delete', { id }),
    hardDelete: (id) => call('empleados:hard-delete', { id }),
  },
  payrollRuns: {
    create:      (data)                    => call('payroll-runs:create', data),
    bulkCreate:  (runs)                    => call('payroll-runs:bulk-create', runs),
    byEmpleado:  (empleadoId, limit)       => call('payroll-runs:by-empleado', { empleadoId, limit }),
    byPeriod:    (from, to)                => call('payroll-runs:by-period', { from, to }),
    remove:      (id)                      => call('payroll-runs:delete', { id }),
  },
  payrollSettings: {
    get:         ()                        => call('payroll-settings:get'),
    update:      (data)                    => call('payroll-settings:update', data),
  },
  salaryChanges: {
    byEmpleado:  (empleadoId)              => call('salary-changes:by-empleado', { empleadoId }),
    atDate:      (empleadoId, date)        => call('salary-changes:at-date', { empleadoId, date }),
    create:      (data)                    => call('salary-changes:create', data),
    remove:      (id)                      => call('salary-changes:delete', { id }),
  },
  adelantos: {
    create:       (data)                   => call('adelantos:create', data),
    list:         (params)                 => call('adelantos:list', params),
    byEmpleado:   (id)                     => call('adelantos:by-empleado', id),
    pendingTotal: (id)                     => call('adelantos:pending-total', id),
    deduct:       (id, payrollId)          => call('adelantos:deduct', { id, payrollRunId: payrollId }),
    cancel:       (id)                     => call('adelantos:cancel', { id }),
    summary:      ()                       => call('adelantos:summary'),
  },

  // ── Vehicles (auto repair / detailing) ──────────────────────────────────────
  vehicles: {
    create:  (data)              => call('vehicles:create', data),
    update:  (data)              => call('vehicles:update', data),
    list:    (params)            => call('vehicles:list', params),
    byId:    (id)                => call('vehicles:byId', id),
    delete:  (id)                => call('vehicles:delete', { id }),
  },

  // ── Service Bays ──────────────────────────────────────────────────────────
  serviceBays: {
    create:  (data)              => call('serviceBays:create', data),
    update:  (data)              => call('serviceBays:update', data),
    list:    (params)            => call('serviceBays:list', params),
    delete:  (id)                => call('serviceBays:delete', { id }),
  },

  // ── Work Orders ───────────────────────────────────────────────────────────
  workOrders: {
    create:       (data)                           => call('workOrders:create', data),
    update:       (data)                           => call('workOrders:update', data),
    list:         (params)                         => call('workOrders:list', params),
    byId:         (id)                             => call('workOrders:byId', id),
    // Convenience wrappers consumed by the WorkOrders screen DetailModal
    updateStatus: ({ id, status })                 => call('workOrders:update', { id, status }),
    addItem:      ({ work_order_id, ...rest })     => call('workOrderItems:create', { work_order_id, ...rest }),
    updateItem:   ({ item_id, ...rest })           => call('workOrderItems:update', { id: item_id, ...rest }),
    deleteItem:   ({ item_id })                    => call('workOrderItems:delete', { id: item_id }),
    // Mechanic extensions
    saveInspection:        ({ id, inspection })                 => call('workOrders:saveInspection', { id, inspection }),
    generateApprovalToken: ({ id })                             => call('workOrders:generateApprovalToken', { id }),
    approveEstimate:       ({ id, signature_url })              => call('workOrders:approveEstimate', { id, signature_url }),
    setPartsOrder:         ({ id, expected_parts_arrival })     => call('workOrders:setPartsOrder', { id, expected_parts_arrival }),
    close:                 ({ id, odometer_out_km })            => call('workOrders:close', { id, odometer_out_km }),
  },

  // ── Work Order Items ──────────────────────────────────────────────────────
  workOrderItems: {
    create:  (data)              => call('workOrderItems:create', data),
    update:  (data)              => call('workOrderItems:update', data),
    delete:  (id)                => call('workOrderItems:delete', { id }),
    byOrder: (workOrderId)       => call('workOrderItems:byOrder', workOrderId),
  },

  // ── Appointments (salon / barbershop) ─────────────────────────────────────
  appointments: {
    create:  (data)              => call('appointments:create', data),
    update:  (data)              => call('appointments:update', data),
    list:    (params)            => call('appointments:list', params),
    byId:    (id)                => call('appointments:byId', id),
    delete:  (id)                => call('appointments:delete', { id }),
  },

  // ── Stylist Schedules ─────────────────────────────────────────────────────
  stylistSchedules: {
    create:  (data)              => call('stylistSchedules:create', data),
    update:  (data)              => call('stylistSchedules:update', data),
    list:    (params)            => call('stylistSchedules:list', params),
    delete:  (id)                => call('stylistSchedules:delete', { id }),
  },

  // ── Concesionario v2 / v2.5 ───────────────────────────────────────────────
  vehicleInventory: {
    list:      (params)          => call('vehicleInventory:list', params),
    byId:      (id)              => call('vehicleInventory:byId', id),
    create:    (data)            => call('vehicleInventory:create', data),
    update:    (id, data)        => call('vehicleInventory:update', { id, ...data }),
    setStatus: (id, status)      => call('vehicleInventory:setStatus', { id, status }),
    delete:    (id)              => call('vehicleInventory:delete', { id }),
  },
  salesDeals: {
    list:                  (params) => call('salesDeals:list', params),
    byId:                  (id)     => call('salesDeals:byId', id),
    create:                (data)   => call('salesDeals:create', data),
    update:                (id, data) => call('salesDeals:update', { id, ...data }),
    close:                 (id, ticketInfo) => call('salesDeals:close', { id, ticketInfo }),
    markCommissionPaid:    (id)     => call('salesDeals:markCommissionPaid', { id }),
    commissionsForPeriod:  (params) => call('salesDeals:commissionsForPeriod', params),
    delete:                (id)     => call('salesDeals:delete', { id }),
  },
  leads: {
    list:        (params) => call('leads:list', params),
    create:      (data)   => call('leads:create', data),
    update:      (id, data) => call('leads:update', { id, ...data }),
    setStage:    (id, stage, extra) => call('leads:setStage', { id, stage, extra }),
    logContact:  (id, rest) => call('leads:logContact', { id, ...(rest || {}) }),
    overdue:     ()       => call('leads:overdue'),
    delete:      (id)     => call('leads:delete', { id }),
  },
  testDrives: {
    list:        ()       => call('testDrives:list'),
    create:      (data)   => call('testDrives:create', data),
    update:      (id, data) => call('testDrives:update', { id, ...data }),
    complete:    (id, notes) => call('testDrives:complete', { id, notes }),
    setOutcome:  (id, rest) => call('testDrives:setOutcome', { id, ...(rest || {}) }),
    delete:      (id)     => call('testDrives:delete', { id }),
  },
  vehicleDocuments: {
    byVehicle:    (vehicleSupabaseId) => call('vehicleDocuments:byVehicle', vehicleSupabaseId),
    expiringSoon: (days)              => call('vehicleDocuments:expiringSoon', days),
    create:       (data)              => call('vehicleDocuments:create', data),
    delete:       (id)                => call('vehicleDocuments:delete', { id }),
  },
  // v2.16.2 — Vehicle Titulo (INTRANT matricula / traspaso)
  vehicleTitulo: {
    list:    ()       => call('vehicleTitulo:list'),
    upsert:  (data)   => call('vehicleTitulo:upsert', data),
    delete:  (id)     => call('vehicleTitulo:delete', { id }),
  },

  // v2.16.4 — Vehicle Reservations (Sprint 2A H2)
  vehicleReservation: {
    list:    (args)   => call('vehicle-reservation:list', args || {}),
    active:  (args)   => call('vehicle-reservation:active', args || {}),
    upsert:  (data)   => call('vehicle-reservation:upsert', data),
    release: (args)   => call('vehicle-reservation:release', args),
    convert: (args)   => call('vehicle-reservation:convert', args),
    expire:  ()       => call('vehicle-reservation:expire'),
  },

  // v2.16.4 — Vehicle Warranties (Sprint 2B H3)
  vehicleWarranty: {
    list:           (args) => call('vehicle-warranty:list', args || {}),
    byDeal:         (sales_deal_supabase_id) => call('vehicle-warranty:by-deal', { sales_deal_supabase_id }),
    expiringSoon:   (args) => call('vehicle-warranty:expiring-soon', args || {}),
    upsert:         (data) => call('vehicle-warranty:upsert', data),
    addClaim:       (args) => call('vehicle-warranty:add-claim', args),
    void:           (args) => call('vehicle-warranty:void', args),
    expire:         ()     => call('vehicle-warranty:expire'),
  },

  // v2.16.4 — Bank Pre-approvals (Sprint 2C H5)
  bankPreapproval: {
    list:           (args) => call('bank-preapproval:list', args || {}),
    activeByClient: (client_supabase_id) => call('bank-preapproval:active-by-client', { client_supabase_id }),
    upsert:         (data) => call('bank-preapproval:upsert', data),
    setStatus:      (args) => call('bank-preapproval:set-status', args),
    expire:         ()     => call('bank-preapproval:expire'),
  },

  // ── v2.16.0 Taller Mecánico hardening ────────────────────────────────────
  aseguradoras: {
    list:           (params)              => call('aseguradoras:list', params),
    byId:           (id)                  => call('aseguradoras:byId', id),
    bySupabaseId:   (supabaseId)          => call('aseguradoras:bySupabaseId', supabaseId),
    create:         (data)                => call('aseguradoras:create', data),
    update:         (id, data)            => call('aseguradoras:update', { id, ...data }),
    delete:         (id)                  => call('aseguradoras:delete', { id }),
  },
  // ── Loan renewals (M2 — pawn / lending) ──────────────────────────────────
  loanRenewals: {
    list:   (params) => call('loan-renewals:list', params || {}),
    create: (data)   => call('loan-renewals:create', data),
  },
  suppliers: {
    list:    (params)         => call('suppliers:list', params),
    byId:    (id)             => call('suppliers:byId', id),
    create:  (data)           => call('suppliers:create', data),
    update:  (id, data)       => call('suppliers:update', { id, ...data }),
    delete:  (id)             => call('suppliers:delete', { id }),
  },
  partsOrders: {
    listByWO:       (wo_supabase_id)        => call('partsOrders:listByWO', wo_supabase_id),
    listAwaiting:   ()                      => call('partsOrders:listAwaiting'),
    findByBarcode:  (barcode)               => call('partsOrders:findByBarcode', barcode),
    create:         (data)                  => call('partsOrders:create', data),
    update:         (id, data)              => call('partsOrders:update', { id, ...data }),
    markReceived:   (id, received_barcode)  => call('partsOrders:markReceived', { id, received_barcode }),
    delete:         (id)                    => call('partsOrders:delete', { id }),
  },
  workOrderPhotos: {
    listByWO:      (wo_supabase_id)   => call('workOrderPhotos:listByWO', wo_supabase_id),
    listByVehicle: (veh_supabase_id)  => call('workOrderPhotos:listByVehicle', veh_supabase_id),
    insert:        (data)             => call('workOrderPhotos:insert', data),
    delete:        (id)               => call('workOrderPhotos:delete', { id }),
  },
  insuranceBatches: {
    listByPeriod:    (params)        => call('insuranceBatches:listByPeriod', params),
    byId:            (id)            => call('insuranceBatches:byId', id),
    create:          (data)          => call('insuranceBatches:create', data),
    update:          (id, data)      => call('insuranceBatches:update', { id, ...data }),
    workOrdersFor:   (aseguradora_supabase_id, period_month) =>
                      call('insuranceBatches:workOrdersFor', { aseguradora_supabase_id, period_month }),
  },
  mechanic: {
    productivityForPeriod: (period_start, period_end) =>
                            call('mechanic:productivityForPeriod', { period_start, period_end }),
    serviceRemindersDue:   () => call('mechanic:serviceRemindersDue'),
  },
  mechanicCommissions: {
    byPeriod: (period_start, period_end) =>
                  call('mechanicCommissions:byPeriod', { period_start, period_end }),
    markPaid: (id, paid_by_supabase_id) =>
                  call('mechanicCommissions:markPaid', { id, paid_by_supabase_id }),
  },

  // ── Loans (prestamos) ─────────────────────────────────────────────────────
  loans: {
    create:  (data)              => call('loans:create', data),
    update:  (data)              => call('loans:update', data),
    list:    (params)            => call('loans:list', params),
    byId:    (id)                => call('loans:byId', id),
  },

  // ── Loan Payments ─────────────────────────────────────────────────────────
  loanPayments: {
    create:  (data)              => call('loanPayments:create', data),
    list:    (params)            => call('loanPayments:list', params),
  },

  // ── Pawn Items ────────────────────────────────────────────────────────────
  pawnItems: {
    create:  (data)              => call('pawnItems:create', data),
    update:  (data)              => call('pawnItems:update', data),
    list:    (params)            => call('pawnItems:list', params),
    delete:  (id)                => call('pawnItems:delete', { id }),
    redeem:  (id)                => call('pawnItems:redeem', { id }),
    byCode:  (code)              => call('pawnItems:byCode', code),
  },

  // ── Loan schedule (amortization rows) ────────────────────────────────────
  loanSchedule: {
    list:     (params)           => call('loanSchedule:list', params),
    markPaid: (data)             => call('loanSchedule:markPaid', data),
  },

  // ── Collections (mora + CRM log) ─────────────────────────────────────────
  collections: {
    overdue:     ()              => call('loans:overdue'),
    computeMora: ()              => call('loans:computeMora'),
    logCreate:   (data)          => call('collectionsLog:create', data),
    logList:     (params)        => call('collectionsLog:list', params),
  },

  // ── Memberships (carwash) ─────────────────────────────────────────────────
  memberships: {
    create:          (data)     => call('memberships:create', data),
    update:          (data)     => call('memberships:update', data),
    list:            (params)   => call('memberships:list', params),
    activeForClient: (clientId) => call('memberships:activeForClient', clientId),
    consume:         (id)       => call('memberships:consume', { id }),
    delete:          (id)       => call('memberships:delete', { id }),
  },

  // ── Wash Combos (punch-card) ──────────────────────────────────────────────
  washCombos: {
    create:          (data)     => call('washCombos:create', data),
    update:          (data)     => call('washCombos:update', data),
    list:            (params)   => call('washCombos:list', params),
    activeForClient: (clientId) => call('washCombos:activeForClient', clientId),
    consume:         (id)       => call('washCombos:consume', { id }),
    delete:          (id)       => call('washCombos:delete', { id }),
  },

  // ── Carwash reports / metrics ─────────────────────────────────────────────
  carwash: {
    queueWaitMetrics: ()              => call('queue:waitMetrics'),
    topWashers:       (limit = 3)     => call('reports:topWashers', { limit }),
    ticketsByClient:  (clientId, limit = 10) => call('tickets:byClient', { clientId, limit }),
  },

  // ── Reports namespace (date-range tickets with items) ─────────────────────
  // v2.14.36 — BottleDepositReport / future deposit-style reports call this.
  // Routes to tickets.byDateRange under the hood since the data shape is
  // identical (rows with items[] populated). Both {from,to} and {dateFrom,dateTo}
  // are accepted so legacy callers don't need to change.
  reports: {
    tickets: ({ from, to, dateFrom, dateTo } = {}) =>
      call('reports:ticketsWithItems', { from: dateFrom || from, to: dateTo || to }),
  },

  // ── Service vertical ──────────────────────────────────────────────────────
  subscriptions: {
    create:     (data)     => call('subscriptions:create', data),
    update:     (data)     => call('subscriptions:update', data),
    list:       (params)   => call('subscriptions:list', params),
    markBilled: (id)       => call('subscriptions:markBilled', { id }),
    delete:     (id)       => call('subscriptions:delete', { id }),
  },
  servicePackages: {
    create:          (data)     => call('servicePackages:create', data),
    update:          (data)     => call('servicePackages:update', data),
    list:            (params)   => call('servicePackages:list', params),
    activeForClient: (clientId) => call('servicePackages:activeForClient', clientId),
    consume:         (id)       => call('servicePackages:consume', { id }),
    delete:          (id)       => call('servicePackages:delete', { id }),
  },
  projects: {
    create: (data)    => call('projects:create', data),
    update: (data)    => call('projects:update', data),
    list:   (params)  => call('projects:list', params),
    byId:   (id)      => call('projects:byId', id),
  },
  clientRates: {
    set:    (data)    => call('clientRates:set', data),
    list:   (params)  => call('clientRates:list', params),
    get:    (params)  => call('clientRates:get', params),
    delete: (id)      => call('clientRates:delete', { id }),
  },
  clientItemPrices: {
    set:        (data)    => call('clientItemPrices:set', data),
    list:       (params)  => call('clientItemPrices:list', params),
    get:        (params)  => call('clientItemPrices:get', params),
    delete:     (id)      => call('clientItemPrices:delete', { id }),
    bulkImport: (rows)    => call('clientItemPrices:bulkImport', { rows }),
  },

  // ── Restaurant Mode — Mesas (floor plan) ───────────────────────────────────
  mesas: {
    list:        ()                          => call('mesas:list'),
    create:      (data)                      => call('mesas:create', data),
    update:      (id, data)                  => call('mesas:update', { id, ...data }),
    setStatus:   (id, status, opts)          => call('mesas:setStatus', { id, status, opts }),
    requestBill: (id)                        => call('mesas:request-bill', { id }),
    delete:      (id)                        => call('mesas:delete', { id }),
  },

  // ── Restaurant Mode — Modificadores (menu add-ons) ─────────────────────────
  modificadores: {
    list:            ()                            => call('modificadores:list'),
    listAll:         ()                            => call('modificadores:listAll'),
    create:          (data)                        => call('modificadores:create', data),
    update:          (id, data)                    => call('modificadores:update', { id, ...data }),
    delete:          (id)                          => call('modificadores:delete', { id }),
    listForService:  (serviceId)                   => call('modificadores:listForService', { serviceId }),
    attachToService:   (serviceId, modificadorId, isRequired = 0) => call('modificadores:attach', { serviceId, modificadorId, isRequired }),
    detachFromService: (serviceId, modificadorId)                 => call('modificadores:detach', { serviceId, modificadorId }),
  },

  // ── Restaurant Mode — Service recipes (Bill-of-Materials, v2.16.3) ────────
  recipeItems: {
    listForService: (serviceKey)             => call('recipeItems:listForService', { serviceKey }),
    add:            (data)                   => call('recipeItems:add', data),
    update:         (id, qty_per_unit)       => call('recipeItems:update', { id, qty_per_unit }),
    remove:         (id)                     => call('recipeItems:remove', { id }),
  },

  // ── Ofertas (product bundles, v2.16.x) ────────────────────────────────────
  ofertas: {
    list:   (opts = {})       => call('ofertas:list', opts || {}),
    get:    (supabase_id)     => call('ofertas:get', { supabase_id }),
    upsert: (data)            => call('ofertas:upsert', data),
    delete: (supabase_id)     => call('ofertas:delete', { supabase_id }),
  },

  // ── Restaurant Mode — KDS (kitchen display) ────────────────────────────────
  kds: {
    listActive: ()                 => call('kds:listActive'),
    fire:       (data)             => call('kds:fire', data),
    setStatus:  (id, status)       => call('kds:setStatus', { id, status }),
  },

  // ── Restaurant Mode — Ticket-item modifier snapshots ───────────────────────
  restaurant: {
    itemModificadores: {
      list: (ticketItemId) => call('restaurant:itemModificadores:list', { ticketItemId }),
      snapshot: (ticketItemSupabaseId, ticketItemId, selections) =>
        call('restaurant:itemModificadores:snapshot', { ticketItemSupabaseId, ticketItemId, selections }),
    },
  },

  // ── Clients ────────────────────────────────────────────────────────────────
  clients: {
    all:           ()                   => call('clients:all'),
    byId:          (id)                 => call('clients:byId', id),
    create:        (data)               => call('clients:create', data),
    update:        (data)               => call('clients:update', data),
    updateBalance: ({id, delta})        => call('clients:updateBalance', {id, delta}),
    addLoyaltyPoints: ({id, delta})     => call('clients:addLoyaltyPoints', {id, delta}),
    openTickets:   (clientId)           => call('clients:openTickets', clientId),
  },
  // v2.7.1 — Loyalty program (ledger)
  loyalty: {
    award:   (data) => call('loyalty:award',   data),
    redeem:  (data) => call('loyalty:redeem',  data),
    adjust:  (data) => call('loyalty:adjust',  data),
    history: (data) => call('loyalty:history', data),
  },
  credits: {
    collect: (data) => call('credits:collect', data),
  },

  // ── Tickets ────────────────────────────────────────────────────────────────
  tickets: {
    all:         (params) => call('tickets:all', params),
    byId:        (id)     => call('tickets:byId', id),
    create:      (data)   => call('tickets:create', data),
    markPaid:    (data)   => call('tickets:markPaid', data),
    void:        (data)   => call('tickets:void', data),
    byDateRange: (params) => call('tickets:byDateRange', params),
    updateItemPrice: (data) => call('tickets:updateItemPrice', data),
    priceChanges:    (data) => call('tickets:priceChanges', data),
    allPriceChanges: (data) => call('tickets:allPriceChanges', data),
    // v2.16.4 — Restaurant open-ticket lifecycle. Persist a ticket at mesa-seat
    // time so a power loss mid-dinner doesn't drop in-flight items.
    // 2026-05-09 — generalized open-ticket entry point (food_truck shares).
    openForFulfillment:(data) => call('tickets:openForFulfillment', data),
    openForMesa:       (data) => call('tickets:openForMesa', data),
    listOpen:          (data) => call('tickets:listOpen', data || {}),
    addItem:           (data) => call('tickets:addItem', data),
    updateItemQty:     (data) => call('tickets:updateItemQty', data),
    removeItem:        (data) => call('tickets:removeItem', data),
    getActiveByMesa:   (mesaId) => call('tickets:getActiveByMesa', { mesa_id: mesaId }),
    closeWithPayment:  (ticketId, payload) =>
      call('tickets:closeWithPayment', {
        ticket_id: typeof ticketId === 'object' ? ticketId?.ticket_id : ticketId,
        ticket_supabase_id: typeof ticketId === 'object' ? ticketId?.ticket_supabase_id : null,
        payload: typeof ticketId === 'object' && payload === undefined ? ticketId.payload : payload,
      }),
    // v2.16.3 H3 — Restaurante Mover/Juntar (desktop port of web.js).
    transferToMesa: (ticket_supabase_id, new_mesa_id) =>
      call('tickets:transferToMesa', { ticket_supabase_id, new_mesa_id }),
    merge: (target_ticket_supabase_id, source_ticket_supabase_id) =>
      call('tickets:merge', { target_ticket_supabase_id, source_ticket_supabase_id }),
  },

  // ── v2.16.3 H4 — Restaurant front-of-house reservations ─────────────────
  restaurantReservations: {
    list:          (params)        => call('reservations:list', params),
    create:        (data)          => call('reservations:create', data),
    update:        (id, data)      => call('reservations:update', { id, ...(data || {}) }),
    confirm:       (id)            => call('reservations:confirm', { id }),
    cancel:        (id, reason)    => call('reservations:cancel', { id, reason }),
    markNoShow:    (id)            => call('reservations:markNoShow', { id }),
    seat:          (id, mesaId)    => call('reservations:seat', { id, mesa_id: mesaId }),
    stampWhatsapp: (id)            => call('reservations:stampWhatsapp', { id }),
  },

  // ── v2.17 — Food Truck: favorite stops + waste log ──────────────────────
  foodTruckLocations: {
    list:   (params)        => call('food-truck-locations:list', params),
    create: (data)          => call('food-truck-locations:create', data),
    update: (id, patch)     => call('food-truck-locations:update', { id, ...(patch || {}) }),
    delete: (id)            => call('food-truck-locations:delete', { id }),
  },
  wasteLog: {
    list:   (params)        => call('waste-log:list', params),
    create: (data)          => call('waste-log:create', data),
    delete: (id)            => call('waste-log:delete', { id }),
  },

  // ── Phase 1B — Contabilidad (firm-side suite) ───────────────────────────
  contabilidad: {
    clientCreate:           (payload)        => call('contabilidad:client-create', payload),
    clientUpdate:           (id, patch)      => call('contabilidad:client-update', { id, ...(patch || {}) }),
    clientList:             (params)         => call('contabilidad:client-list', params),
    clientGet:              (id)             => call('contabilidad:client-get', { id }),
    clientDelete:           (id)             => call('contabilidad:client-delete', { id }),

    inboxAdd:               (payload)        => call('contabilidad:inbox-add', payload),
    inboxList:              (params)         => call('contabilidad:inbox-list', params),
    inboxClassify:          (id, patch)      => call('contabilidad:inbox-classify', { id, ...(patch || {}) }),
    inboxPost:              (id, rest)       => call('contabilidad:inbox-post', { id, ...(rest || {}) }),
    inboxDelete:            (id)             => call('contabilidad:inbox-delete', { id }),

    obligationsGenerateYear:(params)         => call('contabilidad:obligations-generate-year', params),
    obligationsList:        (params)         => call('contabilidad:obligations-list', params),
    obligationMarkFiled:    (id, payload)    => call('contabilidad:obligations-mark-filed', { id, ...(payload || {}) }),

    documentAdd:            (payload)        => call('contabilidad:document-add', payload),
    documentList:           (params)         => call('contabilidad:document-list', params),
    documentDelete:         (id)             => call('contabilidad:document-delete', { id }),

    billingPlanCreate:      (payload)        => call('contabilidad:billing-plan-create', payload),
    billingPlanUpdate:      (id, patch)      => call('contabilidad:billing-plan-update', { id, ...(patch || {}) }),
    billingPlanList:        (params)         => call('contabilidad:billing-plan-list', params),

    billingInvoiceCreate:   (payload)        => call('contabilidad:billing-invoice-create', payload),
    billingInvoiceMarkPaid: (id)             => call('contabilidad:billing-invoice-mark-paid', { id }),
    billingInvoiceList:     (params)         => call('contabilidad:billing-invoice-list', params),

    csvMappingCreate:       (payload)        => call('contabilidad:csv-mapping-create', payload),
    csvMappingList:         (params)         => call('contabilidad:csv-mapping-list', params),

    // Phase 2 Slice 1 — Chart of accounts
    coaCreate:              (payload)        => call('contabilidad:coa-create', payload),
    coaUpdate:              (id, patch)      => call('contabilidad:coa-update', { id, ...(patch || {}) }),
    coaList:                (params)         => call('contabilidad:coa-list', params),
    coaGet:                 (id)             => call('contabilidad:coa-get', { id }),
    coaDelete:              (id)             => call('contabilidad:coa-delete', { id }),
    // Journal entries + lines
    journalEntryCreate:     (payload)        => call('contabilidad:journal-entry-create', payload),
    journalEntryUpdate:     (id, patch)      => call('contabilidad:journal-entry-update', { id, ...(patch || {}) }),
    journalEntryList:       (params)         => call('contabilidad:journal-entry-list', params),
    journalEntryGet:        (id)             => call('contabilidad:journal-entry-get', { id }),
    journalEntryDelete:     (id)             => call('contabilidad:journal-entry-delete', { id }),
    journalLineAdd:         (payload)        => call('contabilidad:journal-line-add', payload),
    journalLineList:        (params)         => call('contabilidad:journal-line-list', params),
    journalLineDelete:      (id)             => call('contabilidad:journal-line-delete', { id }),
    // Auto-post rules
    autoPostRuleCreate:     (payload)        => call('contabilidad:auto-post-rule-create', payload),
    autoPostRuleUpdate:     (id, patch)      => call('contabilidad:auto-post-rule-update', { id, ...(patch || {}) }),
    autoPostRuleList:       (params)         => call('contabilidad:auto-post-rule-list', params),
    autoPostRuleDelete:     (id)             => call('contabilidad:auto-post-rule-delete', { id }),
    // Bank accounts + statement lines
    bankAccountCreate:      (payload)        => call('contabilidad:bank-account-create', payload),
    bankAccountUpdate:      (id, patch)      => call('contabilidad:bank-account-update', { id, ...(patch || {}) }),
    bankAccountList:        (params)         => call('contabilidad:bank-account-list', params),
    bankAccountDelete:      (id)             => call('contabilidad:bank-account-delete', { id }),
    bankStatementLineAdd:    (payload)       => call('contabilidad:bank-statement-line-add', payload),
    bankStatementLineUpdate: (id, patch)     => call('contabilidad:bank-statement-line-update', { id, ...(patch || {}) }),
    bankStatementLineList:   (params)        => call('contabilidad:bank-statement-line-list', params),
    bankStatementLineDelete: (id)            => call('contabilidad:bank-statement-line-delete', { id }),
    // Fixed assets
    fixedAssetCreate:       (payload)        => call('contabilidad:fixed-asset-create', payload),
    fixedAssetUpdate:       (id, patch)      => call('contabilidad:fixed-asset-update', { id, ...(patch || {}) }),
    fixedAssetList:         (params)         => call('contabilidad:fixed-asset-list', params),
    fixedAssetDelete:       (id)             => call('contabilidad:fixed-asset-delete', { id }),
    // Retentions emitidas/recibidas
    retentionEmitidaCreate:  (payload)       => call('contabilidad:retention-emitida-create', payload),
    retentionEmitidaUpdate:  (id, patch)     => call('contabilidad:retention-emitida-update', { id, ...(patch || {}) }),
    retentionEmitidaList:    (params)        => call('contabilidad:retention-emitida-list', params),
    retentionEmitidaDelete:  (id)            => call('contabilidad:retention-emitida-delete', { id }),
    retentionRecibidaCreate: (payload)       => call('contabilidad:retention-recibida-create', payload),
    retentionRecibidaUpdate: (id, patch)     => call('contabilidad:retention-recibida-update', { id, ...(patch || {}) }),
    retentionRecibidaList:   (params)        => call('contabilidad:retention-recibida-list', params),
    retentionRecibidaDelete: (id)            => call('contabilidad:retention-recibida-delete', { id }),
    // Payroll
    payrollPeriodCreate:    (payload)        => call('contabilidad:payroll-period-create', payload),
    payrollPeriodUpdate:    (id, patch)      => call('contabilidad:payroll-period-update', { id, ...(patch || {}) }),
    payrollPeriodList:      (params)         => call('contabilidad:payroll-period-list', params),
    payrollPeriodGet:       (id)             => call('contabilidad:payroll-period-get', { id }),
    payrollPeriodDelete:    (id)             => call('contabilidad:payroll-period-delete', { id }),
    payrollLineAdd:         (payload)        => call('contabilidad:payroll-line-add', payload),
    payrollLineList:        (params)         => call('contabilidad:payroll-line-list', params),
    payrollLineDelete:      (id)             => call('contabilidad:payroll-line-delete', { id }),
    // TSS filings
    tssFilingCreate:        (payload)        => call('contabilidad:tss-filing-create', payload),
    tssFilingUpdate:        (id, patch)      => call('contabilidad:tss-filing-update', { id, ...(patch || {}) }),
    tssFilingList:          (params)         => call('contabilidad:tss-filing-list', params),
    tssFilingDelete:        (id)             => call('contabilidad:tss-filing-delete', { id }),
    // Tasks
    taskCreate:             (payload)        => call('contabilidad:task-create', payload),
    taskUpdate:             (id, patch)      => call('contabilidad:task-update', { id, ...(patch || {}) }),
    taskList:               (params)         => call('contabilidad:task-list', params),
    taskDelete:             (id)             => call('contabilidad:task-delete', { id }),
    // Foreign payments (609)
    foreignPaymentCreate:   (payload)        => call('contabilidad:foreign-payment-create', payload),
    foreignPaymentUpdate:   (id, patch)      => call('contabilidad:foreign-payment-update', { id, ...(patch || {}) }),
    foreignPaymentList:     (params)         => call('contabilidad:foreign-payment-list', params),
    foreignPaymentDelete:   (id)             => call('contabilidad:foreign-payment-delete', { id }),

    // Slice 2 — DGII generators
    gen609:    (params) => call('contabilidad:gen-609',    params),
    genIT1:    (params) => call('contabilidad:gen-it1',    params),
    genIR3:    (params) => call('contabilidad:gen-ir3',    params),
    genIR17:   (params) => call('contabilidad:gen-ir17',   params),
    genIR1:    (params) => call('contabilidad:gen-ir1',    params),
    genIR2:    (params) => call('contabilidad:gen-ir2',    params),
    genAnexoA: (params) => call('contabilidad:gen-anexoa', params),
  },

  // ── Queue ──────────────────────────────────────────────────────────────────
  queue: {
    active:       ()     => call('queue:active'),
    updateStatus: (data) => call('queue:updateStatus', data),
    delete:       (data) => call('queue:delete', data),
  },

  // ── Commissions ────────────────────────────────────────────────────────────
  commissions: {
    byWasher: (params) => call('commissions:byWasher', params),
    byPeriod: (params) => call('commissions:byPeriod', params),
    byTicket: (params) => call('commissions:byTicket', params),
    markPaid: (ids)    => call('commissions:markPaid', ids),
    markPaidByPeriod: (args) => call('commissions:markPaidByPeriod', args),
    create:   (data)   => call('commissions:create', data),
  },
  sellerCommissions: {
    bySeller: (params) => call('sellerCommissions:bySeller', params),
    byPeriod: (params) => call('sellerCommissions:byPeriod', params),
    markPaid: (ids)    => call('sellerCommissions:markPaid', ids),
    markPaidByPeriod: (args) => call('sellerCommissions:markPaidByPeriod', args),
    create:   (data)   => call('sellerCommissions:create', data),
  },
  cajeroCommissions: {
    byCajero: (params) => call('cajeroCommissions:byCajero', params),
    byPeriod: (params) => call('cajeroCommissions:byPeriod', params),
    markPaid: (ids)    => call('cajeroCommissions:markPaid', ids),
    markPaidByPeriod: (args) => call('cajeroCommissions:markPaidByPeriod', args),
    create:   (data)   => call('cajeroCommissions:create', data),
  },

  // ── Cuadre de Caja ─────────────────────────────────────────────────────────
  cuadre: {
    create:  (data)    => call('cuadre:create', data),
    history: ()        => call('cuadre:history'),
    list:    (filters) => call('cuadre:list', filters),
    daily:   (date)    => call('cuadre:daily', date),
    getOpen:   (data)  => call('cuadre:getOpen', data),
    openShift: (data)  => call('cuadre:openShift', data),
  },

  // ── NCF ────────────────────────────────────────────────────────────────────
  ncf: {
    sequences:      ()            => call('ncf:sequences'),
    next:           (type)        => call('ncf:next', type),
    rollback:       (ncf)         => call('ncf:rollback', ncf),
    updateSequence: (data)        => call('ncf:updateSequence', data),
  },

  // ── Caja Chica ─────────────────────────────────────────────────────────────
  cajaChica: {
    all:          ()     => call('cajachica:all'),
    create:       (data) => call('cajachica:create', data),
    updateStatus: (data) => call('cajachica:updateStatus', data),
  },

  // ── Notas de Crédito ───────────────────────────────────────────────────────
  notas: {
    all:    ()     => call('notas:all'),
    create: (data) => call('notas:create', data),
  },

  // ── DGII ───────────────────────────────────────────────────────────────────
  dgii: {
    get606:       (params) => call('dgii:606',        params),
    get607:       (params) => call('dgii:607:get',    params),
    addCompra:    (data)   => call('dgii:607:add',    data),
    deleteCompra: ({id})   => call('dgii:607:delete', {id}),
    // v2.16.2 — concesionario compensating ANECF on deal_close_failed
    queueAnecfVoid: ({ eNCF, ticketId, ticketSupabaseId, reason } = {}) =>
                      ipcRenderer.invoke('dgii:queue-anecf-void', { eNCF, ticketId, ticketSupabaseId, reason }),
  },

  // ── RNC Lookup ─────────────────────────────────────────────────────────────
  rnc: {
    lookup:         (rnc) => ipcRenderer.invoke('rnc:lookup', { rnc }),
    sync:           ()    => ipcRenderer.invoke('rnc:sync'),
    status:         ()    => ipcRenderer.invoke('rnc:status'),
    onSyncProgress: (cb)  => ipcRenderer.on('rnc:sync-progress', (_, data) => cb(data)),
  },

  // ── Backup / DB export ─────────────────────────────────────────────────────
  db: {
    exportAll:        ()      => call('db:exportAll'),
    exportSince:      (since) => call('db:exportSince', since),
    exportToSupabase: ()      => ipcRenderer.invoke('db:exportToSupabase').then(r => r.ok ? r.data : Promise.reject(new Error(r.error))),
  },

  // ── PDF receipts ───────────────────────────────────────────────────────────
  pdf: {
    save: (payload) => ipcRenderer.invoke('pdf:save', payload),
  },

  // ── Local SQLite backup ────────────────────────────────────────────────────
  backup: {
    local: () => ipcRenderer.invoke('backup:local'),
  },

  // ── Printer ────────────────────────────────────────────────────────────────
  print: (payload) => ipcRenderer.invoke('print:receipt', payload),

  // ── File save ──────────────────────────────────────────────────────────────
  saveFile: (payload) => ipcRenderer.invoke('fs:save-file', payload),

  // ── License ────────────────────────────────────────────────────────────────
  license: {
    hwid:     ()    => ipcRenderer.invoke('license:hwid'),
    isMaster: (key) => ipcRenderer.invoke('license:is-master', key),
    status:   ()    => ipcRenderer.invoke('license:status'),
    setKey:   (key) => ipcRenderer.invoke('license:set-key', key),
    clearJwt: ()    => ipcRenderer.invoke('license:clear-jwt'),
  },

  // ── Remote API (main process, no CORS) ────────────────────────────────────
  remote: {
    register: (body) => ipcRenderer.invoke('remote:register', body),
    validate: (body) => ipcRenderer.invoke('remote:validate', body),
  },

  // ── Cloud Sync ─────────────────────────────────────────────────────────────
  // Use call() so the `{ok, data}` IPC wrapper gets unwrapped automatically.
  // Without this, the sidebar ManualSyncButton reads r?.totalRows on the
  // wrapper and always sees undefined → "0 uploaded, 0 downloaded".
  sync: {
    status: () => call('sync:status'),
    now:    () => call('sync:now'),
    pull:   () => call('sync:pull'),
  },

  // ── Nightly DB backup to Supabase Storage ──────────────────────────────────
  backup: {
    runNow:     () => call('backup:runNow'),
    lastStatus: () => call('backup:lastStatus'),
  },

  // ── Multi-POS: block allocation status + manual refill (v2.3) ────────────
  blocks: {
    status: ()   => ipcRenderer.invoke('blocks:status'),
    refill: ()   => ipcRenderer.invoke('blocks:refill'),
    list:   ()   => ipcRenderer.invoke('blocks:list'),
  },
  oversells: {
    list:    (args)   => ipcRenderer.invoke('oversells:list', args || {}),
    count:   ()       => ipcRenderer.invoke('oversells:count'),
    resolve: (payload)=> ipcRenderer.invoke('oversells:resolve', payload || {}),
  },

  // ── Salon v2.16.1 — memberships, client balances, reminders, no-show ─────
  salon: {
    memberships: {
      list:    ()           => call('salon:memberships:list'),
      create:  (data)       => call('salon:memberships:create', data),
      update:  (data)       => call('salon:memberships:update', data),
      archive: (supabase_id)=> call('salon:memberships:archive', { supabase_id }),
    },
    clientMemberships: {
      byClient:     (client_supabase_id) => call('salon:client-memberships:by-client', client_supabase_id),
      purchase:     (data)                => call('salon:client-memberships:purchase', data),
      consume:      (data)                => call('salon:client-memberships:consume', data),
      expiringSoon: (days)                => call('salon:client-memberships:expiring-soon', days),
    },
    reminders: {
      schedule:               (data) => call('salon:reminders:schedule', data),
      pendingDue:             (now)  => call('salon:reminders:pending-due', now),
      recent:                 (opts) => call('salon:reminders:recent', opts),
      markSent:               (data) => call('salon:reminders:mark-sent', data),
      markFailed:             (data) => call('salon:reminders:mark-failed', data),
      scheduleForAppointment: (appt) => call('salon:reminders:schedule-for-appointment', appt),
    },
    appointments: {
      markNoShow: (supabase_id) => call('salon:appointments:mark-no-show', { supabase_id }),
    },
  },

  // ── App version ────────────────────────────────────────────────────────────
  version: () => ipcRenderer.invoke('app:version'),
  resetLocalDatabase: () => ipcRenderer.invoke('app:resetLocalDatabase'),

  // ── WhatsApp (UltraMsg) ────────────────────────────────────────────────────
  whatsapp: {
    send:         (params) => call('whatsapp:send', params),
    sendDocument: (params) => call('whatsapp:sendDocument', params),
  },

  // ── Env config (non-secret values from .env, exposed on request) ───────────
  // Returns the value or '' if blank/unset. Never exposes MASTER_LICENSE_KEY.
  env: {
    get: (key) => ipcRenderer.invoke('env:get', key),
  },

  // ── Safe storage (OS-encrypted key-value store) ────────────────────────────
  safe: {
    get: (key)       => ipcRenderer.invoke('safe:get', key),
    set: (key, val)  => ipcRenderer.invoke('safe:set', key, val),
  },

  // ── DGII Direct e-CF ──────────────────────────────────────────────────────
  dgii_ecf: {
    submit:          (invoiceData) => call('dgii:submit', invoiceData),
    voidSequence:    (data)        => call('dgii:void-sequence', data),
    installCert:     (opts)        => call('dgii:install-cert', opts),
    certInfo:        ()            => call('dgii:cert-info'),
    certExpiryCheck: ()            => call('cert:expiry-check'),
    certPem:         ()            => call('dgii:cert-pem'),
    restoreCertFromPEM: (payload)  => ipcRenderer.invoke('dgii:restore-from-pem', payload),
    authTest:        ()            => call('dgii:auth-test'),
    checkStatus:     (trackId)     => call('dgii:check-status', trackId),
    getEnv:          ()            => ipcRenderer.invoke('dgii:get-env'),
    submissions:     (limit)       => ipcRenderer.invoke('dgii:submissions', limit),
    generateTestSet: (step)        => call('dgii:generate-test-set', step),
  },

  // ── e-CF offline queue ─────────────────────────────────────────────────────
  ecf: {
    queueCount: () => ipcRenderer.invoke('ecf:queue-count'),
  },

  // ── Auto-updater ───────────────────────────────────────────────────────────
  updater: {
    install:    ()       => ipcRenderer.invoke('updater:install'),
    check:      ()       => ipcRenderer.invoke('updater:check'),
    getChannel: ()       => ipcRenderer.invoke('updater:get-channel'),
    setChannel: (ch)     => ipcRenderer.invoke('updater:set-channel', ch),
    onStatus:   (cb)     => {
      const events = ['checking','up-to-date','available','progress','downloaded','error']
      const handlers = {}
      events.forEach(e => {
        const handler = (_, data) => cb(e, data)
        handlers[e] = handler
        ipcRenderer.on('updater:' + e, handler)
      })
      return () => events.forEach(e => ipcRenderer.off('updater:' + e, handlers[e]))
    },
  },
})

contextBridge.exposeInMainWorld('printerAPI', {
  listPrinters:       ()             => ipcRenderer.invoke('print:list-usb-printers'),
  openDrawer:         ()             => ipcRenderer.invoke('print:open-drawer'),
  testDrawerVariants: (printerName)  => ipcRenderer.invoke('print:test-drawer-variants', printerName),
  fireDrawerVariant:  (index, printerName) => ipcRenderer.invoke('print:fire-drawer-variant', { index, printerName }),
})
