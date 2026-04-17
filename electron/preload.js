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

  // ── Inventory ──────────────────────────────────────────────────────────────
  inventory: {
    all:          ()                            => call('inventory:all'),
    create:       (data)                        => call('inventory:create', data),
    update:       (data)                        => call('inventory:update', data),
    delete:       (data)                        => call('inventory:delete', data),
    adjust:       ({id, delta, notes, userId})  => call('inventory:adjust', {id, delta, notes, userId}),
    transactions: ({id})                        => call('inventory:transactions', {id}),
    lookupSku:    (sku)                         => call('inventory:lookupSku', sku),
    search:       (query)                       => call('inventory:search', query),
    lowStockCount: ()                           => call('inventory:lowStockCount'),
  },

  // ── Auth ───────────────────────────────────────────────────────────────────
  auth: {
    byPin:  (pin)  => call('auth:pin', pin),
  },

  // ── Users ──────────────────────────────────────────────────────────────────
  users: {
    all:    ()     => call('users:all'),
    create: (data) => call('users:create', data),
    update: (data) => call('users:update', data),
    delete: (data) => call('users:delete', data),
    deleteHard: (data) => call('users:delete-hard', data),
  },

  // ── Activity log (owner audit feed) ────────────────────────────────────────
  activity: {
    setActor: (user) => call('activity:set-actor', user),
    list:     (args) => call('activity:list', args),
    record:   (evt)  => call('activity:record', evt),
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
    all:      ()     => call('services:all'),
    allAdmin: ()     => call('services:all-admin'),
    create:   (data) => call('services:create', data),
    update:   (data) => call('services:update', data),
    delete:   (data) => call('services:delete', data),
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
    create:  (data)              => call('workOrders:create', data),
    update:  (data)              => call('workOrders:update', data),
    list:    (params)            => call('workOrders:list', params),
    byId:    (id)                => call('workOrders:byId', id),
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

  // ── Restaurant Mode — Mesas (floor plan) ───────────────────────────────────
  mesas: {
    list:      ()                          => call('mesas:list'),
    create:    (data)                      => call('mesas:create', data),
    update:    (id, data)                  => call('mesas:update', { id, ...data }),
    setStatus: (id, status, opts)          => call('mesas:setStatus', { id, status, opts }),
    delete:    (id)                        => call('mesas:delete', { id }),
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
    openTickets:   (clientId)           => call('clients:openTickets', clientId),
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
    markPaid: (ids)    => call('commissions:markPaid', ids),
  },
  sellerCommissions: {
    bySeller: (params) => call('sellerCommissions:bySeller', params),
    byPeriod: (params) => call('sellerCommissions:byPeriod', params),
    markPaid: (ids)    => call('sellerCommissions:markPaid', ids),
    create:   (data)   => call('sellerCommissions:create', data),
  },
  cajeroCommissions: {
    byCajero: (params) => call('cajeroCommissions:byCajero', params),
    byPeriod: (params) => call('cajeroCommissions:byPeriod', params),
    markPaid: (ids)    => call('cajeroCommissions:markPaid', ids),
    create:   (data)   => call('cajeroCommissions:create', data),
  },

  // ── Cuadre de Caja ─────────────────────────────────────────────────────────
  cuadre: {
    create:  (data)    => call('cuadre:create', data),
    history: ()        => call('cuadre:history'),
    list:    (filters) => call('cuadre:list', filters),
    daily:   (date)    => call('cuadre:daily', date),
  },

  // ── NCF ────────────────────────────────────────────────────────────────────
  ncf: {
    sequences:      ()            => call('ncf:sequences'),
    next:           (type)        => call('ncf:next', type),
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
  },

  // ── Remote API (main process, no CORS) ────────────────────────────────────
  remote: {
    register: (body) => ipcRenderer.invoke('remote:register', body),
    validate: (body) => ipcRenderer.invoke('remote:validate', body),
  },

  // ── Cloud Sync ─────────────────────────────────────────────────────────────
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    now:    () => ipcRenderer.invoke('sync:now'),
    pull:   () => ipcRenderer.invoke('sync:pull'),
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
    install:  ()       => ipcRenderer.invoke('updater:install'),
    check:    ()       => ipcRenderer.invoke('updater:check'),
    onStatus: (cb)     => {
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
})
