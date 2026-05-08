import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useAPI } from '../context/DataContext'
import { useLicense } from '../context/LicenseContext'
import { setOfflineQueuePlanGate } from '../../services/offline-queue.js'

// v2.3.30 re-bucket per plan-gate audit:
//  - pos/queue were ungated → now gated at Pro (closes Facturacion exploit)
//  - Basic nomina → Pro (one-employee-at-a-time view). Batch nomina_advanced stays Pro MAX.
//  - whatsapp_receipts (post-cobro send) → Pro PLUS (moved down from Pro MAX)
//  - whatsapp_automation (Cola Listo + Balance Reminder + future auto-triggers) → Pro PLUS (NEW)
//  - custom_receipt_design (crimson-branded PDF, logos, custom footers) → Pro MAX (NEW)
//  - dgii_606_607 (monthly TXT export) → Pro PLUS (NEW — strong upgrade driver from Pro)
// Prices (2026-04-27 update): Facturación RD$995/1,990/2,990 · Pro RD$2,990 ·
// Pro PLUS RD$5,490 · Pro MAX RD$9,990. Existing customers grandfathered.
const PLAN_FEATURES = {
  facturacion: [
    'invoicing', 'ecf', 'dgii', 'clients', 'reports',
    // v2.16.2 — Facturación tier critical-fix sprint:
    //  - credit_notes: E33/E34 issuance is mandatory for any DGII-compliant
    //    billing-only product. Reuses existing /credit-notes screen.
    //  - dgii_606_607: monthly TXT export is what every DR contador asks for;
    //    a billing tool without it is unsellable.
    //  - commissions: InvoiceCreate writes seller_commissions / cajero_commissions
    //    inline. Either gate the picker or unlock the feature — we unlock so
    //    multi-cashier invoicing shops work out of the box.
    'credit_notes', 'dgii_606_607', 'commissions',
    // Facturacion is WEB-ONLY for e-CF issuance. No POS/queue access.
  ],
  pro: [
    'pos', 'queue', 'clients', 'credits', 'reports',
    'petty_cash', 'credit_notes', 'cash_recon', 'commissions', 'inventory',
    'invoicing', 'nomina_basic',
    // v2.16.1 — salon free tier
    'salon_preferred_stylist',
    // v2.16.2 Sprint 2E — concesionario_resumen tile lives at every tier so an
    // owner trialing the dealership vertical sees the dashboard immediately.
    'concesionario_resumen',
    // FIX-HIGH-6 — carniceria_resumen mirrors the concesionario pattern: visible
    // at every tier as upgrade hook for the carnicería vertical.
    'carniceria_resumen',
    // Slice 5 — every plan can share read-only data with their contador.
    'share_with_accountant',
    // Food Truck — basic event-mode price multiplier ships at every paid tier.
    'food_truck_event_mode',
  ],
  pro_plus: [
    'pos', 'queue', 'clients', 'credits', 'reports',
    'petty_cash', 'credit_notes', 'cash_recon', 'commissions', 'inventory',
    'ecf', 'dgii', 'dgii_606_607',
    // v2.16.10 — bundle promos, gated Pro PLUS+
    'ofertas',
    'whatsapp_receipts', 'whatsapp_automation',
    'restaurant_mode', 'work_orders', 'appointments', 'service_bays',
    'loans', 'vehicles', 'invoicing', 'nomina_basic',
    'dealership',
    // v2.16.3 — Restaurante hardening (H4 + H5):
    //  - restaurant_reservations: front-of-house Reservas screen.
    //  - restaurant_salon_dashboard: manager Resumen del Salón.
    // Distinct keys from `reservations` (dealership) and `salon_dashboard` (barbería).
    'restaurant_reservations', 'restaurant_salon_dashboard',
    // v2.7.1
    'loyalty',
    // v2.16.1 — appointments + stylist_schedules promoted from Pro MAX
    'stylist_schedules',
    // v2.16.1 — salon Pro PLUS bundle
    'salon_preferred_stylist', 'salon_walk_in_mode', 'salon_memberships',
    'salon_public_booking', 'salon_dashboard', 'salon_whatsapp_reminders',
    // v2.16.0 — Taller Mecánico hardening
    'mechanic_photos', 'mechanic_dashboard', 'mechanic_productivity',
    'parts_ordering', 'mechanic_pickup_delivery', 'mechanic_intervals_alerts',
    // v2.16.2 Sprint 2E — concesionario feature keys (Pro PLUS+)
    'vehicle_inventory', 'sales_pipeline', 'test_drives', 'deal_builder',
    'matriculas', 'reservations', 'warranties', 'preapprovals',
    'concesionario_resumen', 'concesionario_reports',
    // FIX-HIGH-6 — carnicería vertical (Pro PLUS+)
    'carniceria_resumen', 'carniceria_corte_catalog',
    'carniceria_mayoreo', 'carniceria_freshness_alerts',
    // Food Truck — savings/loss tools + favorite stops + event mode (Pro PLUS+).
    // KDS access rides the existing `restaurant_mode` key already in this list.
    'food_truck_locations', 'food_truck_waste_log', 'food_truck_event_mode',
    // 2026-04-27 — contabilidad Pro PLUS bundle (single-firm + multi-firm up
    // to 10 clients). Pro MAX adds portfolio cockpit + auto-pull + AI.
    'contabilidad_inbox', 'contabilidad_cartera', 'contabilidad_calendario',
    'contabilidad_comprobantes', 'contabilidad_vault', 'contabilidad_honorarios',
    'contabilidad_libro_mayor', 'contabilidad_banco', 'contabilidad_nomina',
    'contabilidad_activos', 'contabilidad_tareas', 'contabilidad_reportes_ejecutivos',
    'contabilidad_multi_firm', 'contabilidad_bank_parsers',
    'contabilidad_itbis_proporcionalidad', 'contabilidad_retencion_auto',
    'contabilidad_csv_bulk', 'contabilidad_whatsapp_chase',
    'share_with_accountant',
  ],
  pro_max: [
    'pos', 'queue', 'clients', 'credits', 'reports',
    'petty_cash', 'credit_notes', 'cash_recon', 'commissions', 'inventory',
    'ecf', 'dgii', 'dgii_606_607',
    // v2.16.10 — bundle promos, gated Pro PLUS+
    'ofertas',
    'whatsapp_receipts', 'whatsapp_automation', 'custom_receipt_design',
    'remote_dashboard', 'multi_location', 'inventory_realtime',
    'nomina_basic', 'nomina_advanced',
    // Slice 4 — contabilidad Phase 2 keys exposed to existing Pro MAX tenants
    // who want to opt into the firm-side suite without buying Pro CTB.
    'contabilidad_nomina', 'contabilidad_activos', 'contabilidad_tareas',
    'contabilidad_reportes_ejecutivos', 'contabilidad_libro_mayor', 'contabilidad_banco',
    'contabilidad_inbox', 'contabilidad_cartera', 'contabilidad_calendario',
    'contabilidad_comprobantes', 'contabilidad_vault', 'contabilidad_honorarios',
    // 2026-04-27 — contadora portfolio mode. Pro MAX exclusive across business types.
    'contabilidad_portfolio', 'contabilidad_batch_dgii', 'contabilidad_auto_pull',
    'contabilidad_ai_classifier', 'contabilidad_view_as_client',
    'contabilidad_multi_firm_unlimited',
    // Pro PLUS gets multi-firm up to 10 + bank parsers + ITBIS proporcionalidad
    // (Pro MAX inherits all Pro PLUS keys via this entry too).
    'contabilidad_multi_firm', 'contabilidad_bank_parsers',
    'contabilidad_itbis_proporcionalidad', 'contabilidad_retencion_auto',
    'contabilidad_csv_bulk', 'contabilidad_whatsapp_chase',
    'restaurant_mode', 'work_orders', 'appointments', 'service_bays',
    'loans', 'vehicles',
    // v2.16.3 — Restaurante hardening keys (inherited from Pro PLUS).
    'restaurant_reservations', 'restaurant_salon_dashboard',
    'pawn_items', 'loan_analytics', 'vehicle_history', 'stylist_schedules',
    'invoicing',
    'dealership', 'dealership_crm', 'dealership_docs',
    // v2.7.1
    'loyalty', 'offline_mode',
    // v2.16.1 — salon Pro PLUS bundle (inherited) + Pro MAX exclusives
    'salon_preferred_stylist', 'salon_walk_in_mode', 'salon_memberships',
    'salon_public_booking', 'salon_dashboard', 'salon_whatsapp_reminders',
    'salon_no_show_deposit', 'salon_offline_whatsapp_queue',
    // v2.16.0 — Taller Mecánico hardening (inherited from Pro PLUS) + Pro MAX exclusive
    'mechanic_photos', 'mechanic_dashboard', 'mechanic_productivity',
    'parts_ordering', 'mechanic_pickup_delivery', 'mechanic_intervals_alerts',
    'insurance_batching',
    // v2.16.2 Sprint 2E — concesionario keys inherited + Pro MAX exclusives
    'vehicle_inventory', 'sales_pipeline', 'test_drives', 'deal_builder',
    'matriculas', 'reservations', 'warranties', 'preapprovals',
    'concesionario_resumen', 'concesionario_reports',
    'intrant_api', 'whatsapp_auto',
    // FIX-HIGH-6 — carnicería vertical (inherited from Pro PLUS)
    'carniceria_resumen', 'carniceria_corte_catalog',
    'carniceria_mayoreo', 'carniceria_freshness_alerts',
    // Food Truck — inherited from Pro PLUS (no Pro MAX exclusives in Phase 1).
    'food_truck_locations', 'food_truck_waste_log', 'food_truck_event_mode',
    'share_with_accountant',
  ],
  // Pro CTB — firm-side accounting suite (Phase 1 ship). Bundles every
  // contabilidad_* feature plus the existing dgii/ecf/clients/reports/invoicing
  // primitives the contable already needs. Phase 2/3 keys (libro_mayor, banco,
  // nomina, activos, tareas, cross_firm) are listed so the gate exists; the UI
  // renders them as "Próximamente" until those modules ship.
  pro_ctb: [
    'invoicing', 'ecf', 'dgii', 'clients', 'reports',
    'credit_notes', 'dgii_606_607',
    // Phase 1 (live)
    'contabilidad_inbox', 'contabilidad_cartera', 'contabilidad_calendario',
    'contabilidad_comprobantes', 'contabilidad_vault', 'contabilidad_honorarios',
    // Phase 2/3 (gated UI shows "Próximamente" until shipped)
    'contabilidad_libro_mayor', 'contabilidad_banco', 'contabilidad_nomina',
    'contabilidad_activos', 'contabilidad_tareas',
    'contabilidad_reportes_ejecutivos', 'contabilidad_cross_firm',
    'share_with_accountant',
  ],
}

const PLAN_DISPLAY = { facturacion: 'Facturacion', pro: 'Pro', pro_plus: 'Pro PLUS', pro_max: 'Pro MAX', pro_ctb: 'Pro CTB' }

// Feature keys that are recognized by the gate but render as "Próximamente"
// until their backing module ships. Consumers should branch on this set to
// decide between active-feature UI and the upgrade/coming-soon placeholder.
const COMING_SOON_FEATURES = new Set([
  // Slices 4 + 5 + 6 shipped end-to-end. Add future stubs here.
])
export function isComingSoonFeature(key) { return COMING_SOON_FEATURES.has(key) }

const PlanContext = createContext(null)

// Dev override: force Pro MAX in vite dev mode so all features are visible
// without touching the DB. Production builds ignore this entirely.
const DEV_PLAN_OVERRIDE = import.meta.env.DEV ? 'pro_max' : null

export function PlanProvider({ children }) {
  const api = useAPI()
  const { result: licenseResult } = useLicense()
  const [plan, setPlan] = useState(DEV_PLAN_OVERRIDE || 'pro')
  const [loading, setLoading] = useState(true)

  // Load from local DB first, then override with server response
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const emp = await api?.admin?.getEmpresa?.()
        if (!cancelled && emp?.plan && !DEV_PLAN_OVERRIDE) setPlan(emp.plan)
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [api])

  // Sync plan from license server response (updates every 4h)
  useEffect(() => {
    if (DEV_PLAN_OVERRIDE) return
    if (licenseResult?.plan && PLAN_FEATURES[licenseResult.plan]) {
      setPlan(licenseResult.plan)
    }
  }, [licenseResult?.plan])

  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.pro
  const hasFeature = useCallback((key) => features.includes(key), [features])
  const displayName = PLAN_DISPLAY[plan] || 'Pro'

  // Bridge plan-gate into the non-React offline-queue module so its
  // online/offline drain hooks can short-circuit when the feature is off.
  // (Phase 4d — salon_offline_whatsapp_queue.)
  useEffect(() => {
    setOfflineQueuePlanGate((key) => features.includes(key))
  }, [features])

  // 2026-05-03 (peppy-greeting-popcorn) — expose current plan to the global
  // error reporter so /admin Errores rows include plan in metadata.
  useEffect(() => {
    try { if (typeof window !== 'undefined') window.__txPlan = plan || null } catch {}
  }, [plan])

  const value = { plan, displayName, features, hasFeature, loading }

  return (
    <PlanContext.Provider value={value}>
      {children}
    </PlanContext.Provider>
  )
}

export function usePlan() {
  const ctx = useContext(PlanContext)
  if (!ctx) return { plan: 'pro', displayName: 'Pro', features: PLAN_FEATURES.pro, hasFeature: (k) => PLAN_FEATURES.pro.includes(k), loading: false }
  return ctx
}

export { PLAN_FEATURES, PLAN_DISPLAY }
