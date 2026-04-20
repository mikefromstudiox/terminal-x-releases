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
  return {
    ...raw,
    clients: raw.clients ? { ...raw.clients, ...loyalty } : raw.clients,
    mesas: {
      list:      ()                   => raw.mesas.list(),
      create:    (data)               => raw.mesas.create(data),
      update:    (id, data)           => raw.mesas.update(id, data),
      setStatus: (id, status, opts)   => raw.mesas.setStatus(id, status, opts),
      delete:    (id)                 => raw.mesas.delete(id),
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
    restaurant: {
      itemModificadores: {
        list:     (ticketItemId) => raw.restaurant.itemModificadores.list(ticketItemId),
        snapshot: (ticketItemSupabaseId, ticketItemId, selections) =>
          raw.restaurant.itemModificadores.snapshot(ticketItemSupabaseId, ticketItemId, selections),
      },
    },
  }
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
