# Demo vertical audit — 2026-05-08

Bug pattern: shared demo screens at `packages/ui/landing/demos/screens/*.jsx`
were hardcoded with carwash defaults (Lavadores, vehiculo, drawer 30%
commission, "Studio X Car Wash" RNC, Membresías + Pedidos Ya cards always on)
that bled through to every vertical at `/probar/:vertical`. Most visible
example: `food_truck` demo showed Lavadores in Empleados and a Pedidos Ya /
Membresías config card.

## Audit results — per shared screen

| Screen                       | Status before          | Action |
|------------------------------|------------------------|--------|
| `EmpleadosDemo.jsx`          | Carwash-leaky          | **Refactored.** Accepts `vertical` prop. Per-vertical `tipos[]`, `opLabel`, and seed roster (carwash → lavadores; food_truck → cocineros + repartidores; restaurant → meseros + cocineros; salon → estilistas + recepcion; mechanic → mecanicos + asesores; dealership → vendedores + asesores; carniceria → carniceros; prestamos → cobradores; contabilidad → contadores + asistentes; etc). |
| `ConfigDemo.jsx`             | Carwash-leaky          | **Refactored.** Accepts `vertical` + `business` props. Section catalog filters per vertical: Membresías only on carwash/salon/restaurant/service/hybrid; Pedidos Ya on food/retail/licoreria/restaurant; Mesas on restaurant/hybrid; Cocina on restaurant/food_truck; Ubicaciones + Mermas on food_truck; Bancos + Matriculas on dealership; Estilistas on salon; Cortes/Mayoreo on carniceria; Reglas de licorería on licoreria; Reglas de préstamos on prestamos. Negocio panel pre-fills with the actual `business.name`/`rnc`/`address` instead of "Studio X Car Wash". WhatsApp templates and Comisiones presets also vertical-scoped. |
| `ReportesDemo.jsx`           | Vehicle column hardcoded | Already vehicle-conditional (`t.vehicle && t.vehicle !== '—'`). `reportTitle` prop already vertical-scoped. KPI tiles in Reportes already generic. Vertical KPI tiles for the home/POS dashboard remain hardcoded inside each vertical config (e.g. carwash → Lavadores comisiones; restaurant → Mesas servidas; food_truck → Ordenes pendientes/Mermas) — these were already correct per vertical. **No change needed.** |
| `ClientsDemo.jsx`            | OK                      | Vehicle data only flows from per-vertical seed. Tier/loyalty already conditional. **No change needed.** |
| `MesasDemo`, `KDSDemo`       | OK                      | Already only imported by `restaurant` + `food_truck` (for KDS) + `hybrid` (for Mesas). No leakage into other verticals. |
| `AppointmentsDemo`, `StylistSchedulesDemo`, `MembershipsDemo` | OK | Only imported by salon. |
| `WorkOrdersDemo`             | OK                      | Only imported by mechanic. |
| `SalesPipelineDemo`, `VehicleInventoryDemo`, `DealBuilderDemo`, `TestDrivesDemo` | OK | Only imported by dealership. |
| `LoansDemo`, `PawnItemsDemo` | OK                      | Only imported by prestamos. |
| `MenuBuilderDemo`            | OK                      | Imported by restaurant + food_truck. |
| `InventoryDemo`, `InventoryCountDemo`, `CashReconciliationDemo`, `DGIIDemo`, `QueueDemo` | OK | Generic enough; no carwash-specific text. |
| `_adapters.js`               | OK                      | Pure data shaping. |
| `_shared.jsx`                | Untouched               | Per task constraint. |

## Vertical config sweep — render switch

All 13 verticals (`carwash`, `retail`, `licoreria`, `carniceria`, `service`,
`restaurant`, `food_truck`, `mechanic`, `salon`, `prestamos`, `dealership`,
`contabilidad`, `hybrid`) updated to call `<EmpleadosDemo vertical="..." />`
and `<ConfigDemo vertical="..." business={BUSINESS} />`.

`MesasDemo` only invoked from `restaurant` and `hybrid` render switches —
correct. `KDSDemo` only invoked from `restaurant` and `food_truck` — correct.
No stray imports remained in other verticals.

## food_truck verification (the canonical example)

After the fix, `/probar/food_truck` now shows:
- Empleados: Luis Mejia (owner), Yuderka Mateo (cajero), 2 cocineros
  (Jose Bautista, Manuel Tavarez), 2 repartidores (Henry Reyes, Carla
  Espinal). Tipo dropdown limited to `cocinero`/`cajero`/`repartidor`/`admin`.
  KPI tile says "Cocineros 2" instead of "Lavadores 0".
- Configuración cards: Negocio (with "Food Truck El Sabroso", RNC
  131-99887-1, no carwash branding), NCF / e-CF, Impresora, WhatsApp,
  Comisiones (combos/bebidas/delivery preset), Sincronización, Pedidos Ya,
  Cocina / KDS, Ubicaciones, Mermas, Plan & Facturación, Equipo, Seguridad,
  Licencia. **No** Membresías, **no** Mesas, **no** Bancos / Matriculas.
- WhatsApp template "Pedido listo" uses `{{ubicacion}}` instead of
  `{{vehiculo}}`/`{{placa}}`.

## Open follow-ups (none blocking)

1. `prestamos` has no real `commissions` section in production but the
   ConfigDemo will still show one (with 5%/2% preset) because the catalog
   includes it for all but contabilidad/facturacion. Acceptable — most
   prestamos shops do pay collection commissions.
2. The `reports` view's mobile card layout still shows `t.vehicle` when
   present in the seed; non-vehicle verticals just don't populate it
   (already empty/`'—'` filtered). No leakage.
3. `hybrid` Empleados shows both `lavador` AND `vendedor` tipos — that is
   the entire point of the hybrid demo (carwash + tienda). Intentional.

## Build

`npm run build:web` — see commit log; reports successful build with the
post-refactor demo bundle.
