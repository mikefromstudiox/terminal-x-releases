# Business Types — Terminal X

Last updated: 2026-04-25

Terminal X is a multi-vertical POS. Each business picks **one** `business_type` at signup (in `app_settings`), which switches the POS shell, sidebar nav, default features, and seeded sample data. This file is the canonical reference for every supported vertical.

---

## How the system works

- **Storage**: `app_settings.business_type` (single row, `value` column).
- **Hook**: `useBusinessType()` in `packages/ui/hooks/useBusinessType.jsx` exposes flags (`isDealership`, `isRetail`, `isCarwash`, `isTienda`, etc.) plus per-feature overrides via `hasFeature(name)`.
- **Setup**: `packages/config/setupBusinessType.js` runs on first activation — creates default categories, sample products, and tenant defaults.
- **Switch**: owner can change in **Configuración → Tipo de Negocio** (irreversible warning shown).
- **Sub-types** (only `tienda` has these): `tienda_subtype` in `app_settings` (8 verticals: licoreria / farmacia / colmado / supermercado / ferreteria / papeleria / boutique / otro). Sub-types apply feature flags + default categories on top of base `tienda`.

Plan gating per business type is in `usePlan.jsx`. Sidebar nav filters by `businessTypes: [...]` on each item.

---

## Vertical map

| `business_type` | Spanish label   | POS shell     | Default plan | Status |
|-----------------|-----------------|---------------|--------------|--------|
| `carwash`       | Lavadero        | CarWashPOS    | Pro          | LIVE   |
| `tienda`        | Retail / Tienda | RetailPOS     | Pro          | LIVE (+ 8 sub-types) |
| `restaurant`    | Restaurante     | RestaurantPOS | Pro PLUS     | LIVE   |
| `mechanic`      | Mecánica        | RetailPOS + WO bridge | Pro PLUS | LIVE |
| `salon`         | Salón / Spa     | RetailPOS + Citas | Pro PLUS | LIVE  |
| `service`       | Servicios       | ServiceHub    | Pro          | LIVE   |
| `dealership`    | Concesionario   | DealBuilder + Resumen | Pro PLUS | **LIVE — v2.5 (this doc focus)** |
| `lending`       | Préstamos / Empeño | Loans + PawnItems | Pro PLUS | LIVE |
| `hybrid`        | Híbrido         | RetailPOS + Catálogo | Pro PLUS | LIVE |
| `otro`          | Otro            | RetailPOS     | Pro          | LIVE (fallback) |

---

# Concesionario (`business_type = 'dealership'`)

Full vehicle dealership system. Sells units (cars, motos, equipment), tracks leads through the sales pipeline, logs test drives, builds financed deals with trade-in + APR + monthly cuota math, routes deals ≥ RD$250K to E31 fiscal comprobante, manages document expiry, and pays commissions through nómina.

## Screens

| Path                  | Screen                | Role gate                          | Purpose |
|-----------------------|----------------------|------------------------------------|---------|
| `/concesionario`      | **Resumen**           | owner / manager / cashier / accountant / cfo | Dashboard: KPIs + alerts + recent deals + pending follow-ups (default landing) |
| `/vehicle-inventory`  | **Vehículos**         | owner / manager / cashier          | Stock units CRUD + photos + CSV import + documents |
| `/sales-pipeline`     | **Prospectos**        | owner / manager / cashier          | Kanban: Lead → Test Drive → Negotiation → Financing → Closed (+ Lost) with follow-up tracking |
| `/test-drives`        | **Pruebas de Manejo** | owner / manager / cashier          | Test drive log with waiver + outcome (sold / follow-up / lost) |
| `/deal-builder`       | **Cierre de Venta**   | owner / manager / cashier          | Vehicle pick → trade-in → financing sliders → live cuota → CobrarModal hand-off |

## Data model (Supabase + SQLite mirror)

### `vehicle_inventory`
Stock units for sale. Distinct from customer vehicles (`vehicles`, mechanic vertical).

| column | type | notes |
|---|---|---|
| `id` / `supabase_id` | UUID | dual-key sync |
| `stock_number` / `vin` | TEXT | VIN unique-ish, not enforced (DGII-data only) |
| `make` / `model` / `year` / `color` | TEXT / INT | basic |
| `mileage` | INT | kilómetros |
| `condition` | new / used / certified | |
| `acquisition_cost` / `listing_price` | NUMERIC | margin = price − cost |
| `status` | available / reserved / sold / in_service | |
| `title_status` | clean / salvage / lien / pending | |
| `photo_urls` | TEXT[] | stored in Supabase Storage `vehicle-photos/{business_id}/{vehicle_id}/`, public bucket |
| `featured` | BOOL | landing-page highlight (future) |
| `notes` | TEXT | |
| `listing_date` / `sold_date` | TIMESTAMPTZ | sold_date auto-stamped on `setStatus('sold')` |

### `sales_deals`
A closed vehicle sale. One per ticket.

| column | type | notes |
|---|---|---|
| `id` / `supabase_id` | UUID | |
| `client_supabase_id` / `vehicle_inventory_supabase_id` / `salesperson_supabase_id` / `trade_in_supabase_id` / `ticket_supabase_id` | UUID FK | |
| `sale_price` / `trade_in_value` / `down_payment` / `financed_amount` | NUMERIC | financed = price − trade − down |
| `term_months` / `apr` / `monthly_payment` | INT / NUMERIC | French amortization |
| `commission_pct` / `commission_amount` | NUMERIC | commission_amount = (price − trade) × pct/100 |
| `commission_paid` / `commission_paid_at` | BOOL / TIMESTAMPTZ | flips via Nómina or `markCommissionPaid()` |
| `status` | open / closed / cancelled | |
| `closed_at` | TIMESTAMPTZ | |

### `leads`
Sales pipeline (kanban kards).

| column | type | notes |
|---|---|---|
| `id` / `supabase_id` | UUID | |
| `name` / `phone` / `email` / `source` / `budget` / `notes` | basic | |
| `stage` | lead / test_drive / negotiation / financing / closed (+ lost) | |
| `next_followup_at` | TIMESTAMPTZ | overdue when `< now()` and stage ∉ (closed, lost) |
| `last_contacted_at` | TIMESTAMPTZ | stamped by `logContact()` |
| `interested_vehicle_supabase_id` | UUID | optional unit reference |

### `test_drives`
Per-test-drive log with waiver + outcome.

| column | type | notes |
|---|---|---|
| `id` / `supabase_id` | UUID | |
| `client_supabase_id` / `vehicle_inventory_supabase_id` / `staff_supabase_id` | UUID FK | |
| `scheduled_at` / `completed_at` | TIMESTAMPTZ | |
| `license_number` / `signed_waiver_url` / `notes` | basic | |
| `outcome` | pending / sold / follow_up / lost | CHECK constraint enforced |
| `outcome_notes` | TEXT | |
| `deal_supabase_id` | UUID | linked to sales_deals when outcome=sold |

### `vehicle_documents`
Title / registration / insurance / inspection / other. Expiry alerts.

| column | type | notes |
|---|---|---|
| `id` / `supabase_id` | UUID | |
| `vehicle_inventory_supabase_id` | UUID FK | |
| `doc_type` | title / registration / insurance / inspection / other | CHECK |
| `file_url` | TEXT | signed URL from `vehicle-documents/` bucket (1-year TTL) |
| `file_name` | TEXT | display |
| `expires_at` | TIMESTAMPTZ | feeds Resumen "Docs por vencer" tile |
| `notes` | TEXT | |

## Features (v2 + v2.5 — shipped 2026-04-25)

### 1. Resumen dashboard (`/concesionario`)
- **KPI tiles**: Disponibles + avg días en lote · Ventas mes (count + RD$) · Financiado mes · Comisiones mes (+ pendiente)
- **Alert cards**: Seguimientos vencidos (red), Pruebas, Docs por vencer 30d (amber)
- **Recent Deals list** — last 5 with cliente / fecha / RD$ / comisión
- **Pending Follow-ups list** — top 6 overdue leads with deep-link to pipeline

### 2. Vehicle Inventory
- Full CRUD: make/model/year/VIN/stock#/color/mileage/condition/acquisition_cost/listing_price/title_status/notes
- **Multi-image photo gallery** — upload to public bucket, thumbnail in table list, primary photo in DealBuilder preview
- **CSV import** — header auto-mapping (Spanish + English aliases for VIN, marca, modelo, año, kilometraje, condicion, costo, precio, etc.) + 5-row preview + bulk insert
- **Documents tab** — upload PDF/image to private bucket with doc_type + expires_at + notes; expiry pill (red = expired, black = ≤30d)
- **Search + status filter** — VIN / stock / make / model
- **Status workflow** — available → reserved → sold (auto-stamps `sold_date`) / in_service

### 3. Sales Pipeline (Prospectos)
- 5-stage kanban: Lead → Test Drive → Negotiation → Financing → Closed (+ Lost)
- Source tracking: walk_in / whatsapp / web / referral / other
- Budget field (informs vehicle suggestions)
- **Follow-up date** field per card
- **Overdue badge** — red left border + "Vencido" pill when `next_followup_at < now()` and stage active
- **Overdue counter** at top of screen
- **Quick "Registrar seguimiento"** button — prompts next date, stamps `last_contacted_at`
- Move forward/back through stages with arrow buttons
- Inline edit + delete

### 4. Test Drives
- Schedule with client + vehicle + salesperson + license # + waiver URL
- Mark completed with notes
- **Outcome buttons** inline: Vendido (linked to deal) / Seguimiento (auto-creates Negotiation lead with 3-day default follow-up) / Perdido
- Outcome locked once set
- CHECK constraint enforces valid outcome values

### 5. Deal Builder
- 4-quadrant layout: Vehicle/Client | Trade-in | Financing | Summary (black panel with live cuota)
- **Vehicle picker** with photo preview from `photo_urls`
- **Salesperson + commission %** — defaults from `empleados.commission_pct`
- **Trade-in flow** — appraises old unit, auto-creates new `vehicle_inventory` row with `acquisition_cost = appraisal`, `listing_price = 0`, `condition = used`, `title_status = pending`, `notes = "Recibido como intercambio"`
- **Financing math** — French amortization `M = P × r / (1 − (1+r)^-n)`. APR → monthly rate auto-conversion. Zero APR handled (M = P/n).
- **Live summary**: precio − trade-in − inicial = financiado / cuota mensual / total pagos / interés total / comisión vendedor
- **E31/E32 routing** — total ≥ RD$250K forces E31 (Crédito Fiscal); below = E32 (Consumo Final). Locked in CobrarModal.
- On close: writes `sales_deals` row with full commission calc, flips vehicle status to `sold`, hands off to CobrarModal with single-line ticket (vehicle as item).
- After CobrarModal confirms payment: ticket is created with `comprobante_type = forced`, `payment_method`, `tipo_venta`. Deal stamped with ticket links.

### 6. Plan gating

| Feature key      | Pro | Pro PLUS | Pro MAX |
|------------------|-----|----------|---------|
| `dealership` (full vertical) | — | ✓ | ✓ |
| `dealership_crm` (CRM follow-up automation) | — | — | ✓ |
| `dealership_docs` (document expiry alerts) | — | — | ✓ |

Pro PLUS minimum because dealership requires e-CF (E31 issuing).

### 7. Activity log integration
Every dealership write emits an `activity_log` event consumed by the Owner Activity Feed in RemoteDashboard:

| Event | Severity | Filter chip |
|-------|----------|-------------|
| `deal_closed` | info | Concesionario |
| `deal_commission_paid` | info | Concesionario |
| `pipeline_stage_change` | info | Concesionario |
| `pipeline_followup_logged` | info | Concesionario |

### 8. Nómina commission feed
`NominaEmpleados.jsx` calls `salesDeals.commissionsForPeriod()` on load and folds vehicle deal commissions into the vendedor commission bucket. Liquidación (severance) calc includes them automatically — Ley 16-92 "salario ordinario" math is identical to ticket commissions.

### 9. Sync architecture
All 5 dealership tables ride the standard SYNC_TABLES + PULL_TABLES pipeline (LWW strategy). Desktop ↔ Supabase round-trip every 5 min + on demand. Tombstones flush soft-deletes. FK columns resolve via `*_supabase_id` (clients, empleados, vehicle_inventory, tickets).

### 10. Offline behavior (desktop)
SQLite mirror has full read/write CRUD via IPC handlers for all 5 tables. Offline writes queue locally; sync pushes on reconnect. Photo + document uploads require internet (Supabase Storage) — graceful "open terminalxpos.com to upload" error on desktop.

## Demo / sample data

Seeded via `setupBusinessType.js` when business_type set to `dealership`:
- 4 sample vehicles (Toyota Corolla, Honda CR-V, Hyundai Tucson, Nissan Sentra)
- 1 walk-in lead in negotiation stage
- 1 scheduled test drive

Live demo: terminalxpos.com/pos with `concesionario.demo` account (password `Demo2026!`).

## Verification (E2E smoke 2026-04-25)

`scripts/concesionario-e2e-smoke.mjs` exercises every feature live against Supabase: **22/22 passing**.

```
✅ vehicle_inventory: create with photo_urls + featured
✅ vehicle_inventory: bulk import 3 rows
✅ vehicle_inventory: list filter status=available
✅ vehicle_inventory: setStatus sold + sold_date stamped
✅ vehicle_documents: insert with expires_at
✅ vehicle_documents: expiringSoon(30) finds our doc
✅ empleados: salesperson available for commission test
✅ sales_deals: create with commission ≥ E31 threshold
✅ sales_deals: commissionsForPeriod returns our deal
✅ sales_deals: markCommissionPaid sets flag + timestamp
✅ leads: create with next_followup_at (overdue)
✅ leads: setStage lead → negotiation
✅ leads: logContact updates timestamps
✅ leads: overdue query returns our overdue lead
✅ leads: closed leads excluded from overdue
✅ test_drives: create scheduled
✅ test_drives: setOutcome sold + deal link + completed_at
✅ test_drives: CHECK rejects invalid outcome
✅ activity_log: deal_closed event accepted
✅ activity_log: pipeline_stage_change event accepted
✅ activity_log: deal_commission_paid event accepted
✅ schema: vehicle_documents table accessible
```

Build status: `npm run build:web` ✓ · `npx vite build` ✓ · Ranoza smoke 22/22 ✓.

## Roadmap (v3 — futurex.md)

- Credit pre-qualification API (Banco Popular / BHD)
- Multi-unit trade-ins per deal
- VIN decoder (NHTSA API auto-fills make/model/year/trim)
- Mileage-based warranty rules engine
- Insurance quote integration
- Marketplace export feeds (encuentra24 / supercarros / Facebook Marketplace)

---

# Other verticals (summary)

(For full detail per vertical, see each project's CLAUDE.md.)

## `carwash` — Lavadero
CarWashPOS shell. Queue with washer assignment + commissions. Ticket = service(s) per vehicle. Manager Authorization Card system for overrides. Membership plans (recurring billing).

## `tienda` — Retail / Tienda (8 sub-types)
RetailPOS shell. Barcode/SKU search, product grid, inventory, returns, deposit refunds (licorería). Sub-types via `tienda_subtype`:
- **licorería** — age verification, bottle deposit, brand suggestions
- **farmacia** — prescription tracking
- **colmado** — credit sales (libreta)
- **supermercado** — pricing by weight, deli counter
- **ferreteria** — bulk discounts
- **papeleria** — print services
- **boutique** — size/color SKU variants
- **otro** — generic retail

## `restaurant` — Restaurante
RestaurantPOS shell. Mesas (floor plan) + Menú (categories/items/modifiers) + KDS (kitchen display) + Tip + Split-bill. Service modificadores attach to items. Course routing per printer.

## `mechanic` — Mecánica
RetailPOS + Work Orders. Customer Vehicles registry (separate from `vehicle_inventory`). Service Bays (capacity + status). WO → Ticket bridge with parts + labor breakdown. Inspection reports.

## `salon` — Salón / Spa
RetailPOS + Citas. Stylist Schedules (day_of_week + start/end times). Appointment calendar with empleado assignment. Stylist commissions per service.

## `service` — Servicios
ServiceHub shell. Single-page service catalog with quick-add. Used for cleaning services, IT services, consultants, etc.

## `lending` — Préstamos / Empeño
Loans (French/German amortization, mora calculation) + Pawn Items (collateral with forfeiture rules) + Collections.

## `hybrid` — Híbrido
RetailPOS + ServiceHub combined. For businesses that sell BOTH products and services (auto detail + parts shop, beauty salon + product shelf).

## `otro` — Otro
Fallback bucket for businesses that don't match. Defaults to RetailPOS without subtype features.
