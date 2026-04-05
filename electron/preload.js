const { contextBridge, ipcRenderer } = require('electron')

// Helper: unwrap { ok, data } from IPC responses, throw on error
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (res && res.ok === false) throw new Error(res.error || channel)
  return 'data' in res ? res.data : res
}

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
  },
  cajeroCommissions: {
    byCajero: (params) => call('cajeroCommissions:byCajero', params),
    byPeriod: (params) => call('cajeroCommissions:byPeriod', params),
    markPaid: (ids)    => call('cajeroCommissions:markPaid', ids),
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

  // ── App version ────────────────────────────────────────────────────────────
  version: () => ipcRenderer.invoke('app:version'),

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
    installCert:     (opts)        => call('dgii:install-cert', opts),
    certInfo:        ()            => call('dgii:cert-info'),
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
