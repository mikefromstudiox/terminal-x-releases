# Demo Accounts Audit Report — 2026-04-17

11 demo businesses on `%demo.terminalxpos.com`. Password `Demo2026!` / PIN `1234`.

---

## 1. Executive Summary

| Demo (type) | services | empleados | inventory | tickets 7d | Issues | Readiness |
|---|---:|---:|---:|---:|---|---|
| carwash (carwash) | 7 | 5 | 0 | 18 | NCF missing | ⚠ |
| retail (tienda) | 7 | 4 | 7 | 22 | `category='Lavado'` on all 7 products; NCF | ✗ |
| restaurant (restaurante) | 7 | 5 | **0** | 21 | `category='Lavado'` on all 7; `lavador` empleado; no inventory; NCF | ✗ |
| salon (salon) | 6 | 4 | **0** | 19 | `category='Lavado'` + `is_wash=1` on all 6; NCF | ✗ |
| hybrid (hibrido) | 8 | 5 | 4 | 18 | `category='Lavado'` on all 8; 4 services wrongly `is_wash=1`; NCF | ✗ |
| mechanic (mecanica) | 6 | 5 | 0 | 23 | `category='Lavado'` + `is_wash=1` on all 6; NCF | ✗ |
| service (servicios) | 5 | 4 | 0 | 19 | `category='Lavado'` + `is_wash=1` on all 5; NCF | ✗ |
| prestamos (prestamos) | 5 | 4 | 0 | 18 | `category='Lavado'` + `is_wash=1` on all 5; NCF | ✗ |
| dealership (concesionario) | 6 | 5 | 0 | 20 | `category='Lavado'` + `is_wash=1` on all 6; `lavador` empleado; NCF | ✗ |
| licoreria (licoreria) | 26 | 4 | 26 | 29 | NCF missing only | ⚠ |
| carniceria (carniceria) | 26 | 4 | 26 | 5 | `category='Lavado'` on all 26; low tickets; NCF | ✗ |

Ticket volume is healthy everywhere except carniceria (5). Empleado/service counts are fine. The **big cross-cutting bug is `services.category='Lavado'` leaking into 9 of 11 demos**, because `db/schema.sql:55` (and the Supabase initial migration) set `DEFAULT 'Lavado'` and the seed for non-carwash verticals never overrides category in the insert. Only the licoreria demo has been manually fixed (Productos).

---

## 2. Critical Issues (would break a live demo)

### C1. `services.category='Lavado'` on 9 non-carwash demos
Users will see a **"Lavado"** category tab on the POS for retail, restaurant, salon, mechanic, hybrid, service, prestamos, dealership, carniceria. Looks broken / "wrong app". Fix: update category per vertical. SQL in section 5.

### C2. `services.is_wash=1` on non-carwash demos
Forces wash-only codepaths (vehicle capture, queue behavior, washer assignment). Affected: salon (6), mechanic (6), service (5), prestamos (5), dealership (6), plus 4 rows in hybrid. Will render **"Placa / Vehículo" UI** in POS/Queue where it makes no sense (salon, service, prestamos especially).

### C3. `empleados.tipo='lavador'` in wrong verticals
- **restaurant**: 1 lavador (should be `mesero`/`vendedor`)
- **dealership**: 1 lavador (should be `vendedor`)
- **prestamos, licoreria, carniceria, tienda, service, salon**: clean.

### C4. NCF sequences — ALL 11 demos missing B01 and B02
Any demo of "Emitir factura con crédito fiscal" or NCF-aware workflows will fail. Even if the owner doesn't demo e-CF, the Config → NCF screen will show empty state. Low effort fix, high demo impact. (Note: the audit queried `ncf_sequences` and `count` came back `null` — table either empty or RLS-blocked for the query shape. Either way, no B01/B02 rows surfaced.)

### C5. restaurant has zero inventory
Restaurante verticals typically route orders through Mesas + inventory for drinks/sides. `RetailPOS` path may render an empty product grid. If Mike demos a food ticket, products tab will be blank.

### C6. salon has zero inventory
Salons sell retail products (shampoo, masks) alongside services. Zero inventory = empty "Productos" tab in the salon POS shell.

### C7. carniceria only has 5 tickets in last 7 days (vs 18–29 elsewhere)
Sparse. Dashboard/Reports will look empty. Low recency = weak demo.

---

## 3. Medium Issues

### M1. LandingPage.jsx `/` still shows wash-only copy in FAQ (line 252) and feature cards (lines 529, 581–582)
Not a demo blocker (landing page, not logged-in UX), but a prospect browsing the site first may wonder if Terminal X supports retail. **Hybrid messaging exists elsewhere on the page, so this is borderline.**

### M2. `POS.jsx:26-27` hard-maps `Lavado`→`Wash` category label
Only matters if `services.category` is actually `'Lavado'`. Fixing C1 neutralizes this. No code change needed after data fix.

### M3. `POS.jsx:138` hardcodes "Sin lavadores disponibles"
Shown in POS worker chooser when no workers in list. Not gated by `businessType`. Non-carwash verticals that use the same chooser component will see it. Low priority because most non-carwash demos will not open the workers picker.

### M4. `WorkerReport.jsx:700-706` hardcodes "Lavador / Washer / Cars Washed / Active Washers / Avg per Washer"
When `subTab === 'lavadores'`, labels are wash-specific. For restaurant it's relabeled to "Meseros" (line 595) but retail/salon/service/prestamos still show "Lavadores". Not a blocker if the owner avoids the Empleados > Lavadores sub-tab.

### M5. `getSupabaseClient()` — 17 call sites, several unguarded
`packages/services/backup.js:89,104,114,125,224,256,283` and `packages/services/supabase.js:105,152,173,210` all call `getSupabaseClient()` and use it without a `if (!sb) return` guard. On web, if the fallback you added last session breaks, every one of these throws. Minor — not a live-demo blocker because web env is working, but brittle.

---

## 4. Per-Demo Findings

### carwash — ⚠ ready with NCF caveat
- id=`e5fa6fc1-75d1-4bab-8e07-6480de202b1b`
- Data looks correct: 7 wash services all `category='Lavado'` (correct for this vertical), 5 empleados with realistic tipo mix (3 lavador / 1 hybrid / 1 cajero).
- ticket doc_numbers mix `Q-0003` (queue) + `T-1013` (ticket) — good spread.
- Fix: add NCF B01+B02 sequences.

### retail — ✗ data bug
- id=`bdbd4efd-8dce-4dca-bfc0-a89846d96754` type=`tienda`
- All 7 products (Agua, Cigarrillos, Pan, Coca Cola, Snickers, Presidente, Doritos) have `services.category='Lavado'`. POS category tabs will read "Lavado" instead of "Bebidas/Snacks/etc".
- inventory=7, empleados clean, 22 tickets. After C1 fix, solid.

### restaurant — ✗ blocker
- id=`b037c2a8-d8d2-45f6-ada1-f851cf0190a4` type=`restaurante`
- 7 services all `category='Lavado'`. 1 empleado `tipo='lavador'` (should be `vendedor`/mesero). **Zero inventory** (no drinks/sides for Mesas module). 21 tickets OK.

### salon — ✗ blocker
- id=`b14f83cb-15c9-4c1f-946c-5256265dab7a`
- 6 services all `category='Lavado'` AND `is_wash=1`. Stylist POS will treat each appointment as a wash ticket (plate capture, queue). **Zero inventory** for retail products. Empleados clean (all vendedor).

### hybrid — ✗
- id=`354ffa7b-1198-4ff9-983a-5a6e344633ef` type=`hibrido`
- 8 mixed services — all 8 `category='Lavado'`. 4 wash + 4 retail, but ALL 8 have `is_wash=1` → retail items (Coca Cola, Presidente, Agua, Snickers) incorrectly flagged. Inventory=4. Empleados mix correct.

### mechanic — ✗
- id=`32e2cc8f-8626-4e54-ad80-71dfb100247c`
- 6 service items (Cambio Aceite, Frenos, etc) all `category='Lavado'` + `is_wash=1`. Mechanic vertical DOES use CarWashPOS, so `is_wash=1` may be acceptable, but category label should be "Servicios" / "Reparaciones". 23 tickets — great.

### service — ✗
- id=`9fe0cab2-5e92-4222-a43a-616083c6470b` type=`servicios`
- 5 pro services all `category='Lavado'` + `is_wash=1`. Service (consulting/installation/hourly) should NOT have `is_wash=1`. Zero inventory (acceptable for pure services).

### prestamos — ✗
- id=`d8db00a2-30c5-4aa5-8fbe-26d06e69dce0`
- 5 loan-related items (Cuota, Renovación, Mora…) all `category='Lavado'` + `is_wash=1`. Completely wrong — prestamos vertical has its own Loans module and shouldn't show wash POS artifacts.

### dealership — ✗
- id=`60dbf844-323f-4913-8847-9499ca6be995` type=`concesionario`
- 6 items all `category='Lavado'` + `is_wash=1`. Includes "Hyundai Tucson 2026" and "Toyota Corolla 2026" flagged as wash services. Also 1 empleado `tipo='lavador'`. Dealership uses CarWashPOS so `is_wash=1` partially OK, but category should be `Vehículos` / `Servicio Post-Venta`.

### licoreria — ⚠ ready (minus NCF)
- id=`949fd70b-4609-4c71-a3af-2b9160043c3e`
- All 26 products `category='Productos'` (post-fix). 26 inventory. 29 tickets 7d. Empleados clean. Best-prepared demo after carwash.

### carniceria — ✗
- id=`52d0a7be-03c9-4352-92d2-19e4825eaf3a`
- 26 meat items all `category='Lavado'`. Should split into `Res`, `Pollo`, `Cerdo`, `Embutidos`, `Mariscos`. Only 5 tickets in last 7 days — sparse.

---

## 5. Recommended Fixes (SQL-first, apply in Supabase)

### F1 — Bulk category rewrite per vertical

```sql
-- retail / tienda
UPDATE services SET category='Productos' WHERE business_id='bdbd4efd-8dce-4dca-bfc0-a89846d96754' AND category='Lavado';

-- restaurant
UPDATE services SET category='Comidas' WHERE business_id='b037c2a8-d8d2-45f6-ada1-f851cf0190a4' AND name IN ('Pollo Frito','Pizza Mediana','Sancocho','Hamburguesa Clasica','Mofongo');
UPDATE services SET category='Bebidas' WHERE business_id='b037c2a8-d8d2-45f6-ada1-f851cf0190a4' AND name IN ('Cerveza Presidente','Refresco');

-- salon
UPDATE services SET category='Servicios', is_wash=0 WHERE business_id='b14f83cb-15c9-4c1f-946c-5256265dab7a' AND category='Lavado';

-- hybrid (keep wash ones + flag)
UPDATE services SET category='Lavado', is_wash=1 WHERE business_id='354ffa7b-1198-4ff9-983a-5a6e344633ef' AND name IN ('Lavado Express','Lavado Completo','Encerado','Detallado Premium');
UPDATE services SET category='Productos', is_wash=0 WHERE business_id='354ffa7b-1198-4ff9-983a-5a6e344633ef' AND name IN ('Coca Cola 600ml','Cerveza Presidente','Agua 500ml','Snickers');

-- mechanic
UPDATE services SET category='Servicios' WHERE business_id='32e2cc8f-8626-4e54-ad80-71dfb100247c' AND category='Lavado';
-- is_wash=1 acceptable (uses CarWashPOS) — do NOT change

-- service (professional)
UPDATE services SET category='Servicios', is_wash=0 WHERE business_id='9fe0cab2-5e92-4222-a43a-616083c6470b' AND category='Lavado';

-- prestamos
UPDATE services SET category='Cargos', is_wash=0 WHERE business_id='d8db00a2-30c5-4aa5-8fbe-26d06e69dce0' AND category='Lavado';

-- dealership
UPDATE services SET category='Vehiculos' WHERE business_id='60dbf844-323f-4913-8847-9499ca6be995' AND name IN ('Hyundai Tucson 2026','Toyota Corolla 2026');
UPDATE services SET category='Servicios' WHERE business_id='60dbf844-323f-4913-8847-9499ca6be995' AND name IN ('Inspeccion Tecnica','Garantia Extendida','Servicio Post-Venta','Cambio de Aceite');

-- carniceria
UPDATE services SET category='Res' WHERE business_id='52d0a7be-03c9-4352-92d2-19e4825eaf3a' AND name LIKE '%Res%';
UPDATE services SET category='Pollo' WHERE business_id='52d0a7be-03c9-4352-92d2-19e4825eaf3a' AND name LIKE '%Pollo%';
UPDATE services SET category='Cerdo' WHERE business_id='52d0a7be-03c9-4352-92d2-19e4825eaf3a' AND (name LIKE '%Cerdo%' OR name='Chicharron de Cerdo (lb)');
UPDATE services SET category='Embutidos' WHERE business_id='52d0a7be-03c9-4352-92d2-19e4825eaf3a' AND name IN ('Salami Inducero (lb)','Longaniza (lb)','Jamon de Cocinar (lb)','Queso Amarillo (lb)','Chorizo Espanol (lb)');
UPDATE services SET category='Mariscos' WHERE business_id='52d0a7be-03c9-4352-92d2-19e4825eaf3a' AND name IN ('Camaron Mediano (lb)','Camaron Grande (lb)','Filete de Mero (lb)','Chillo Entero (lb)','Pulpo Limpio (lb)');
```

### F2 — Fix `empleados.tipo` for wrong verticals

```sql
UPDATE empleados SET tipo='vendedor' WHERE business_id='b037c2a8-d8d2-45f6-ada1-f851cf0190a4' AND tipo='lavador';  -- restaurant
UPDATE empleados SET tipo='vendedor' WHERE business_id='60dbf844-323f-4913-8847-9499ca6be995' AND tipo='lavador';  -- dealership
```

### F3 — Seed NCF B01 + B02 for every demo

```sql
INSERT INTO ncf_sequences (business_id, ncf_type, prefix, current_sequence, max_sequence, active)
SELECT id, 'B01', 'B01', 1, 50000000, 1 FROM businesses WHERE email LIKE '%demo.terminalxpos.com'
ON CONFLICT DO NOTHING;
INSERT INTO ncf_sequences (business_id, ncf_type, prefix, current_sequence, max_sequence, active)
SELECT id, 'B02', 'B02', 1, 50000000, 1 FROM businesses WHERE email LIKE '%demo.terminalxpos.com'
ON CONFLICT DO NOTHING;
```
(Adjust column names if your `ncf_sequences` schema differs — check `db/schema.sql`.)

### F4 — Seed inventory for restaurant + salon

Restaurant: Coca Cola, Presidente, Papitas, Agua, Malta, Morir Soñando. Salon: Shampoo Pantene, Acondicionador, Crema de Peinar, Esmalte Opi, Tinte Loreal. ~8 rows each. Copy the licoreria/retail seed template from `db/seed.js`.

### F5 — Gate wash-specific strings by `businessType`

Low priority, defer unless demo shows something weird:
- `packages/ui/screens/POS.jsx:138` — wrap "Sin lavadores disponibles" with `hasWashers(businessType)` guard.
- `packages/ui/screens/reports/WorkerReport.jsx:700-706` — use `workerNoun(businessType)` similar to how restaurant already rewrites to "Meseros".

### F6 — Prevent regression: change schema default

`db/schema.sql:55` and `supabase/migrations/20260301000000_initial.sql:83` default `services.category` to `'Lavado'`. Change to `'General'` so future business-type seeds don't inherit the wash label. This is the root cause of the whole audit. (Already works for licoreria because that seed sets category explicitly.)

---

## 6. Verified Safe (show as-is)

None are 100% green. Best candidates for live demo today, in order:

1. **licoreria** — only NCF missing. Safe to demo if NCF screen is avoided.
2. **carwash** — data is correct for vertical; NCF caveat same as licoreria.

Everything else has at least one visible data defect (category label, wrong empleado tipo, zero inventory, or incorrect `is_wash` flag) that a client will notice within 30 seconds of opening the POS.

---

## 7. Quickest path to "all 11 ready"

Apply F1 + F2 + F3 (pure SQL, ~2 minutes). That resolves 9 of 11 blockers. F4 (restaurant + salon inventory seed) takes one `db/seed.js` run against those two IDs — 5 more minutes. F5/F6 can wait for the post-demo cleanup commit.
