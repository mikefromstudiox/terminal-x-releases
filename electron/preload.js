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
  },

  // ── Commissions ────────────────────────────────────────────────────────────
  commissions: {
    byWasher: (params) => call('commissions:byWasher', params),
    byPeriod: (params) => call('commissions:byPeriod', params),
    markPaid: (ids)    => call('commissions:markPaid', ids),
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
    get606: (params) => call('dgii:606', params),
  },

  // ── Backup / DB export ─────────────────────────────────────────────────────
  db: {
    exportAll:   ()      => call('db:exportAll'),
    exportSince: (since) => call('db:exportSince', since),
  },

  // ── Printer ────────────────────────────────────────────────────────────────
  print:        (payload) => ipcRenderer.invoke('print:receipt', payload),
  openDrawer:   ()        => ipcRenderer.invoke('print:open-drawer'),
  listPrinters: ()        => call('print:list-printers'),

  // ── File save ──────────────────────────────────────────────────────────────
  saveFile: (payload) => ipcRenderer.invoke('fs:save-file', payload),

  // ── License ────────────────────────────────────────────────────────────────
  license: {
    hwid:     ()    => ipcRenderer.invoke('license:hwid'),
    isMaster: (key) => ipcRenderer.invoke('license:is-master', key),
  },

  // ── Env config (non-secret values from .env, exposed on request) ───────────
  // Returns the value or '' if blank/unset. Never exposes MASTER_LICENSE_KEY.
  env: {
    get: (key) => ipcRenderer.invoke('env:get', key),
  },

  // ── ef2.do API proxy (bypasses CORS via main process) ─────────────────────
  ef2: {
    fetch: (params) => ipcRenderer.invoke('ef2:fetch', params),
  },

  // ── Auto-updater ───────────────────────────────────────────────────────────
  updater: {
    install:  ()       => ipcRenderer.invoke('updater:install'),
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
