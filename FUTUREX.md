# FUTUREX — Terminal X Roadmap

Updated: 2026-05-17

Shipped features live in CLAUDE.md §Architecture Notes. This file is forward-looking work only.

---

## Verticals Scoreboard (11 total — 8 production-ready, 2 pending, 1 minimal)

| Vertical | Status | Version | Demo e2e | Notes |
|---|---|---|---|---|
| Licorería | ✅ Live | Ranoza prod | — | First paying client |
| Carwash | ✅ Live | Studio X prod | 23/23 | First paying client |
| Concesionario | ✅ Done | v2 | 20/20 | Vehicle inventory + deals + commissions |
| Taller Mecánico | ✅ Done | v2.16.0 | 20/20 | Aseguradoras + cotizaciones + parts orders + photos |
| Barbería / Salón | ✅ Done | v2.16.1 | 21/21 | Memberships + appointments + reminders + walk-ins |
| Préstamos / Empeño | ✅ Done | v2.16.2 | 47/47 | 3 amortization modes + contract PDF + papeleta legal + tienda pública |
| Restaurante / Bar | ✅ Done | v2.16.2 | 20/20 | Mesas grid + acuenta + top sellers + KDS + happy hour |
| Carnicería | ✅ Done | v2.16.3 | 33/33 | Cortes + freshness + mayoreo + multi-báscula |
| Híbrido | ❌ Pending | — | 20/20 (smoke only) | Needs: dual-mode POS UX, unified vs separate inventory, smart multi-printer |
| Tienda / Retail | ❌ Pending | — | 19/19 (smoke only) | Needs: etiquetas, albaranes, devoluciones, multi-proveedor, 2x1, combos, expiry, B2B |
| Servicios / Otro | ⚠️ Minimal | service_projects table only (2026-04-26) | 22/22 | Needs full build: por horas/proyecto/visita, cotización, suscripciones, GPS+foto+firma |

**All-vertical e2e:** 245 / 245 pass · 0 fail · `npm run e2e:demo:all`
**RLS / Security:** 6/6 gates green (cross-tenant blocked, anon-no-login blocked) · `node scripts/verify-rls-prestamos.mjs`
**Per-license JWT:** live, edge function `mint-license-jwt` ACTIVE, 92 sync tables JWT-isolated

### What's left to ship across the codebase

1. **Híbrido vertical** — Grok+plan-mode workflow (FUTUREX:206)
2. **Retail vertical** — Grok+plan-mode workflow (FUTUREX:207)
3. **Servicios full build** — table is ready; UI/API/sync still queued (FUTUREX:208)
4. **e-CF on web POS** — Path X (Deno edge function) vs Path Y (Node sign-server on VPS) — decision pending
5. **Restaurant Mode UI clickthrough** — code shipped v1.9.25, never manually validated
6. **DGII production switch** — flip env from `certecf` to `ecf` when ready for live e-CFs
7. **Desktop installer code-signing cert** — eliminates SmartScreen warning (~$200-400/yr)
8. **UAT manual run with real prestamista** — 90-min session, checklist at `docs/prestamos-uat-checklist.md`
9. **SB official PDF template** — Mike provides, then PDF SB report wires to template
10. **Marketing site real screenshots refresh** — triggers AFTER 8 verticals ship (FUTUREX:215)

---

## Active / In Progress

### Admin Panel — Demo Isolation + Perf (shipped v2.14 2026-04-21)
Shipped:
- [x] `businesses.is_demo` column + partial index on `WHERE is_demo = false`.
- [x] Backfilled 11 demo rows from `email LIKE 'admin@%.demo.terminalxpos.com'` (Ranoza stays real).
- [x] `handleClients`, `handleStats`, `handleActivityFeed` all accept `?demo=1`, default to real.
- [x] Stats rebuilt to scope every counter through the filtered biz-id list (not separate global counts).
- [x] New **Demos** sidebar entry + `/admin/demos` route reusing `Clients.jsx` via `demoMode` prop.
- [x] New-client button hidden in demo view.

Remaining (lower priority):
- [ ] `business-loyalty` / `digest-health` / `loyalty-overview` endpoints still include demos — audit if they matter for perf.
- [ ] Measure real admin load times now that demos are excluded; if still slow, look at 6-way fan-out joins in `handleClients` (the `in(bids)` queries).
- [ ] Optional: toggle in UI to include demos in activity feed + dashboard stats.

### Sync C1 hotfix shipped 2026-04-21 — anon RLS policies restored
- [x] migration `20260421500000_restore_anon_sync_policies.sql` re-adds anon SELECT/INSERT/UPDATE/DELETE on all sync tables with `business_id IS NOT NULL` guard
- [x] verified live: Ranoza 976 inventory rows visible to anon, activity_log INSERT works
- [x] **Per-license JWT migration shipped 2026-04-25** (closes the anon-no-login leak repo-wide):
  - Edge function `supabase/functions/mint-license-jwt/index.ts` — validates `licenses.license_key`, mints HS256 JWT signed with `SUPABASE_JWT_SECRET`, payload `user_metadata = { business_id, license_key, machine_id }`, 24h TTL
  - Helper `packages/services/perLicenseJwt.js` (web, localStorage cache) + `electron/licenseJwt.js` (Electron, safeStorage encrypted cache)
  - Wired into `packages/data/web.js` (`bootLicenseJwt` on `tx_license_key` presence) and `electron/sync.js` (8 callsites → `_authHeaders()` swapping in JWT when present, 30-min refresh)
  - IPC `license:set-key` in `electron/main.js` — renderer pushes license key after validation, main mints JWT and feeds sync
  - Migration `20260427000000_per_license_jwt_lockdown.sql`: dropped `rls_anon_sync_*` from 91 sync tables, replaced with `<tbl>_jwt_select`/`<tbl>_jwt_modify` bound to `((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid`. Public Tienda carve-outs preserved (`pawn_listings_public_published`, `pawn_items_public_published`, `pawn_documents_public_foto`).
  - Migration `20260427100000_staff_jwt_lockdown.sql`: same treatment for `staff`. Final count: zero `rls_anon_sync_*` policies repo-wide.
  - Demo `signInWithPassword` JWT path unchanged — already carries `user_metadata.business_id`.
  - Verification: e2e:demo prestamos 47/47 + RLS verifier 6/6 (gate3 anon-no-login now blocked).
  - Audit: `license_jwt_audit` table (service-role only) records every mint.
  - Edge function `mint-license-jwt` deployed live via Management API (no CLI needed) at version 6 ACTIVE. Hand-rolled HS256 (no djwt/std-http imports — eliminated edge-runtime boot fragility). Function secret `TX_JWT_SECRET` set via `/v1/projects/{ref}/secrets`. Verified: invalid license → 401, valid license → 200 with business_id-as-sub JWT, JWT→loans/pawn_items/loan_contracts/collections_attempts all return own-tenant rows, JWT cross-tenant query returns 0 rows.
  - Note: `sub` claim in minted JWT is `business_id` UUID (not `license:<key>`) so existing `auth.uid()`-based RLS functions like `my_business_ids()` keep working without modification.

### Sync Architecture Audit — remediation batch (2026-04-21)
Shipped in commits 4dcf888 / d260425 / 41cb816:
- [x] **C1** — anon RLS policies restored via migration `20260421500000`.
- [x] **C2** — desktop tombstone log + flushTombstones in sync cycle; wired into categoriaDelete / clientItemPriceDelete / workOrderItemDelete / inventoryCountDelete / deleteCompra607 / payrollRunDelete / salaryChangeDelete.
- [x] **C3** — RECONCILE_TABLES extended to core entity tables + 10-min age guard.
- [x] **C4** — dashboard.ticketsByClient dual-key join fixed in web.js.
- [x] **H2** — users natural-key healing gated on `active=1`.
- [x] **H3** — activity_log pull gains `fkCols: { actor_supabase_id: 'users' }`.
- [x] **H6** — `saveSecuenciaNcf` + `saveConfiguracion` stamp `supabase_id` on every upsert.
- [x] **M3** — BEFORE UPDATE triggers added on loyalty_transactions, inventory_oversells, work_order_items, anecf_queue (migration `20260421600000` applied live).
- [x] **M1** — memory + CLAUDE.md users VIEW note corrected.

Final batch (shipped 2026-04-21):
- [x] **H1** — pass-2 cursor now uses max(last_synced_at, last_pull_at) so pulled rows don't re-push.
- [x] **H4** — moot: Supabase has both UNIQUE(business_id,supabase_id) AND UNIQUE(business_id,key) on app_settings; web path has update-if-exists lookup; desktop reuses supabase_id per key. No action needed.
- [x] **H5** — moot: `active === 0` strict check safely no-ops when column missing.
- [x] **M2** — migration `20260421700000` adds UNIQUE index on categorias_servicio (business_id, LOWER(nombre)) with dedup pass.
- [x] **M4** — ecf_queue body_json push unwraps the legacy `{raw:"..."}` double-stringify shape.
- [x] **M5** — updatePullLog switched to ISO 8601 strftime to match updateSyncLog.
- [x] **L2** — no stale local_id usages in code; just a comment reference, leaving alone.
- [x] **L1** — queueDelete INSERT now stamps supabase_id + updated_at, fixing the root cause (queue_deletions rows were shipping with NULL supabase_id and being filtered out of push). N+1 FK resolver stays in the cols shaper as low-priority hygiene.
- [x] **L3** — migration `20260421800000` adds adelantos.approved_by_supabase_id; desktop schema + adelantoCreate + sync push updated.
- [ ] Wire tombstoneAdd into less-critical hard-delete paths (modifiers, mesas, vehicles, etc.) for completeness.
- [ ] **Desktop Installer Code Signing** (pre-existing, THIS WEEK) — needs Mike's cert.
- [ ] **Restaurant Mode UI Testing** (pre-existing) — Mesas/KDS/RestaurantPOS files import cleanly; PlanGate feature='restaurant_mode' present. Full smoke still needs human click-through.

Ranoza E2E smoke: **22/22 passing** after the batch.
Edge Functions: **rnc-lookup** + **whatsapp-send** both ACTIVE and responding.
Verification — needs desktop-side smoke (not scripted): (a) delete a category on desktop → verify it stays deleted after next sync cycle, (b) delete a service on web → verify desktop reflects after pull, (c) 976 Ranoza products visible on Jerry's web login.

### Sync Architecture Audit (BLOCKING — before any new features)
Natural key healing shipped (pullUpsertRow matches by name when supabase_id misses, heals identity). But empleados still not pulling reliably after reconnect. Full dataLEAKS audit pending — covers every push/pull path, cursor logic, SYNC_TABLES vs PULL_TABLES parity, staff-vs-users view, race conditions.
- [ ] Run dataLEAKS full audit (prompt saved in conversation 2026-04-15)
- [ ] Fix every CRITICAL + HIGH finding from the audit
- [ ] Verify: nuke DB → reconnect → all tables load (services, categories, empleados, users, washers, sellers)
- [ ] Verify: delete a user/service on desktop → stays deleted after sync
- [ ] Verify: delete on web → desktop reflects it on next sync
- [ ] Ship v1.9.25 final with all sync fixes + release to GitHub

### Desktop Installer — Code Signing (THIS WEEK)
- [ ] EV/OV code signing cert (DigiCert/Sectigo/SSL.com ~$200-400/yr)
- [ ] Configure `win.certificateFile` / `win.certificatePassword` in electron-builder
- Required to eliminate SmartScreen "Unknown publisher" warnings

### Restaurant Mode — UI Testing (Phase 3 code shipped, not tested)
All code landed in v1.9.25 commits. Needs runtime testing once sync is stable:
- [ ] Pick "Restaurante" in FirstTimeSetup → sidebar shows Mesas / Menú / KDS
- [ ] Create mesa → seat guests → order with modifiers → fire to KDS → cobrar with tip + split
- [ ] KDS fullscreen on tablet/browser at /kds
- [ ] Menu Builder: CRUD categories + items + modifiers + printer routing
- [ ] Verify car-wash mode unaffected (no restaurant UI leaks)

### DGII Production Switch (DEFERRED — not switching yet)
- [ ] Switch env from `certecf` to `ecf` when ready to issue live e-CFs to clients
- [ ] Install cert on desktop + trigger bizSync to push PEM to Supabase (unblocks web e-CF proxy)
- [ ] End-to-end test e-CF submission from web at terminalxpos.com/pos

### Empleados — Remaining Items
- [ ] Verify Liquidacion end-to-end with real data (code exists in `NominaReportes.jsx`, needs e2e run)

### First Client Onboarding Test
Scaffolding shipped (`SignupPage.jsx` + `web/api/signup/provision.js` + reconnect flow). Still need real-world validation:
- [ ] Create real client via /signup or admin panel
- [ ] Walk through: add services, create ticket, cobrar, print, reports
- [ ] Verify commissions + credit flow
- [ ] Test on mobile PWA
- [ ] Test reconnect flow on a second PC (new PC setup)

### Supabase Edge Functions — Verify Deployment
Source exists (`supabase/functions/whatsapp-send/index.ts`, `supabase/functions/rnc-lookup/index.ts`). Confirm deployed to project and callable from web.
- [ ] Verify `whatsapp-send` deployed + live
- [ ] Verify `rnc-lookup` deployed + live

### Payment Flow
- [ ] Azul gateway integration (or continue manual WhatsApp-based billing)

---

## Future / Backlog

### SEO — Google Top 5 Ranking
Technical SEO is done (structured data, hreflang, geo meta, FAQPage schema). Remaining manual steps:
- [ ] Register Google Business Profile with Studio X SRL Santo Domingo address
- [ ] Submit sitemap in Google Search Console, verify ownership, request indexing
- [ ] Get .do domain backlinks — AIRD, CONEP, local tech blogs
- [ ] Add `/guia` blog section (informational queries: "como facturar electronicamente DGII", "que es e-CF Ley 32-23")
- [ ] YouTube demo video — "Terminal X POS: Facturacion e-CF en 2 minutos"

### Marketing Push
- [ ] Facebook/WhatsApp group posts in Santiago/Santo Domingo
- [ ] Demo video: ticket → print → report → e-CF

### Concesionario v2.5 (shipped 2026-04-25, same day as v2)
All 5 items shipped:
- [x] **Nómina: deal commission feed** — `NominaEmpleados.jsx` now folds `salesDeals.commissionsForPeriod()` into the vendedor bucket so liquidación includes vehicle deal commissions alongside ticket commissions.
- [x] **Vehicle documents UI** — Documents tab inside VehicleInventory edit modal (upload doc_type + expires_at + notes / list with expiry pill / delete). Resumen "Docs por vencer 30d" tile now populated from `vehicleDocuments.expiringSoon(30)`.
- [x] **Desktop SQLite parity** — 5 SQLite tables (vehicle_inventory, sales_deals, leads, test_drives, vehicle_documents) + CRUD in `electron/database.js`, IPC handlers in `electron/main.js`, preload bridge in `electron/preload.js`, sync push/pull in `electron/sync.js` (LWW). Photo/document UPLOADS stay web-only (graceful stub on desktop).
- [x] **Activity log integration** — `deal_closed`, `deal_commission_paid`, `pipeline_stage_change`, `pipeline_followup_logged` events wired via `logActivity` in `web.js`. New "Concesionario" filter chip in RemoteDashboard activity feed.
- [x] **Plan gating** — `dealership` (Pro PLUS+), `dealership_crm` + `dealership_docs` (Pro MAX) keys added to `usePlan.jsx`.

### Concesionario v3 (after v2.5)
- [ ] Credit pre-qualification API (Banco Popular / BHD integration)
- [ ] Multi-unit trade-ins per deal
- [ ] VIN decoder (NHTSA API auto-fills make/model/year/trim)
- [ ] Mileage-based warranty rules engine
- [ ] Insurance quote integration
- [ ] Marketplace export feeds (encuentra24 / supercarros / facebook marketplace)

### Other Backlog
- [ ] Concurrent Electron + Web usage testing (same business, same data)
- [ ] Website redesign — studioxrdtech.com as umbrella brand (Terminal X, Content/Media, Camera, Computer store)
- [ ] Electron realtime: bundle @supabase/supabase-js in electron main process (currently "realtime unavailable")
- [ ] Logo upload RLS: add INSERT policy on Supabase Storage bucket

---

## Recently Shipped (2026-04-25)

- **Concesionario v2** — Expanded dealership vertical:
  - Migration `20260425100000_concesionario_v2.sql`: `vehicle_inventory.photo_urls`/`featured`, `sales_deals.commission_pct/amount/paid/paid_at`, `leads.next_followup_at/last_contacted_at/interested_vehicle_supabase_id`, `test_drives.outcome/outcome_notes/deal_supabase_id` + CHECK, new `vehicle_documents` table with RLS + storage buckets `vehicle-photos` (public) and `vehicle-documents` (signed URLs)
  - DealBuilder: commission % input next to salesperson, defaults from `empleados.commission_pct`, computed `commission_amount` persisted on close, vehicle photo preview from `photo_urls`, commission row in summary panel
  - VehicleInventory: multi-image uploader → `vehicle-photos/{business_id}/{vehicle_id}/`, photo grid with delete, thumbnail column, **CSV import** with header auto-mapping (ES/EN aliases) + preview + bulk insert
  - SalesPipeline: follow-up date field + Registrar Seguimiento action + overdue badge (red left border + "Vencido" pill) + overdue counter at top
  - TestDrives: outcome buttons (sold/follow_up/lost) inline in row, follow_up auto-creates a Negotiation lead with 3-day default follow-up
  - Resumen (new screen): `/concesionario` route — KPI tiles (Disponibles, Ventas mes, Financiado mes, Comisiones mes), alert cards (Seguimientos vencidos, Pruebas, Docs por vencer 30d), Recent Deals + Pending Follow-ups lists
  - Sidebar: new "Resumen" nav item gated to dealership business type
  - web.js extensions: `vehicleInventory.uploadPhoto/removePhoto/bulkImport`, new `vehicleDocuments.{byVehicle,expiringSoon,upload,delete}`, `salesDeals.markCommissionPaid/commissionsForPeriod`, `testDrives.setOutcome`, `leads.logContact/overdue`
  - Verification: web build green (19.97s), desktop Vite build green (18.21s), Ranoza smoke 22/22

## Vertical Hardening — bring 5 unproven types to production-ready (2026-04-25)

Each vertical below ships and renders, but no live client has battle-tested it. Workflow per vertical:

1. **Mike → Grok**: paste the per-vertical prompt (drafted in chat 2026-04-25 session). Grok returns 10 numbered feature ideas.
2. **Mike → Claude Code**: paste Grok's reply back here. Claude Code generates a **full plan-mode prompt** scoped to that vertical (audits existing code, dedupes against shipped features, prioritizes high-leverage gaps, lays out the implementation plan).
3. **Mike → /plan**: starts plan mode in Claude Code with the generated prompt. Approves the plan via ExitPlanMode.
4. **Claude Code builds** the vertical to production-ready in one pass. Ships incrementally as v2.16.0 → v2.16.4 (one minor per vertical).

**Done — skip these (already production):**
- Licorería ✓ (Ranoza live)
- Dealership / Concesionario ✓ (v2 shipped)
- Carwash ✓ (Studio X live)

Verticals queued (8 total, in any order Mike picks):
- [x] **Taller Mecánico** (`mechanic`) — **v2.16.0 shipped 2026-04-25** (migration `20260426100000_mechanic_v216_hardening.sql` + `20260426100001_mechanic_pgcron_reminders.sql` applied live; new screens `Aseguradoras.jsx`, `Cotizaciones.jsx`, `InsuranceBatch.jsx`, `MechanicResumen.jsx`, `Suministros.jsx`, expanded `WorkOrders.jsx`; new tables `aseguradoras`, `suppliers`, `parts_orders`, `work_order_photos`, `insurance_batches`; storage bucket `mechanic-photos` public; demo seeded with 4 vehicles + 5 WOs + 2 cotizaciones + 2 aseguradoras + 2 suppliers; smoke 20/20)
- [x] **Barbería / Salón** (`salon`) — **v2.16.1 shipped 2026-04-25** (migration `20260425200000_salon_v2_16_1.sql` applied live; new tables `client_memberships`, `membership_redemptions`, `appointment_reminders`; new columns `appointments.deposit_status / is_walk_in`, `clients.no_show_count`, `memberships.total_sessions / nombre`; new screens `Memberships.jsx`, expanded `Appointments.jsx`; public booking URL infrastructure; demo seeded with 3 memberships + 5 client memberships + 10 appointments + 18 stylist schedules; smoke 21/21)
- [x] **Préstamos / Empeño** (`prestamos`) — **v2.16.2 shipped 2026-04-25**:
  - Migration `20260425200000_prestamos_hardening.sql`: new tables `loan_contracts`, `loan_renewals`, `pawn_documents`, `pawn_listings`, `collections_attempts`; new columns `loans.amortization_method` ('french'|'german'|'interest_only'), `loans.renewal_count`, `pawn_items.{default_alert_days,offered_pct,valoracion_notes,signature_dataurl}`; storage buckets `pawn-photos` (public), `pawn-documents` + `loan-documents` (private, 1y signed URLs); RLS + triggers + sync wired
  - Loans: 3 amortization modes (Solo Intereses default / Cuota Fija Francés / Capital Fijo Alemán), APR display "X.XX% mensual (equivalente Y.YY% anual)" via shared `packages/services/apr.js`, ContractSigner modal → 3-page PDF (cláusulas SB + tabla amortización + firma/DPI) via new `pdfContracts.js`, RenewalModal (interest-only payment + extension + history badge "Renovado N veces")
  - PawnItems: valoración wizard (multi-foto + % ofrecido slider default 60 + monto auto-calc + días alerta default 3 + notas + firma + DPI), default-alert pills ("Vence en N días" / "VENCIDO"), "Publicar para Venta" → `pawn_listings` con slug, Documentos tab para matrícula/contrato (vehículos)
  - Collections: 5-outcome attempts modal (Llamé/Prometió/Pagó/No contestó/Rechazó), sortable Cobranza Diaria (días mora desc default), WhatsApp toggle, attempt history drilldown, mirrors a `collections_log` por una release
  - New screens: `/lending/resumen` (5 KPI tiles: Cartera Activa, Intereses por Cobrar, Mora Actual %, Redenciones Mes, Tasa Default % + 3 alert cards), `/lending/reporte-sb` (CSV exports — Cartera Activa / Mora Aging / Redenciones; PDF SB deshabilitado pendiente plantilla oficial), public `/tienda-empenos/:businessId/:slug` (read-only listings, sin auth, fotos públicas + WhatsApp CTA)
  - Shared: `packages/ui/components/SignaturePad.jsx` extracted from InventoryCount, `packages/services/apr.js` (formatAPR + effectiveAnnualRate, 7/7 tests), `packages/services/pdfContracts.js` (pdf-lib, brand crimson)
  - Sidebar: Resumen + Reporte SB children gated `businessTypes:['prestamos']`
  - Verification: web build green (20.64s), electron build green (18.67s), Playwright hibrido suite passed, apr 7/7 green
  - **PENDIENTE antes de live deploy (REGULATORY_REVIEW_GATE):**
    - [ ] Imprimir contrato real → revisión legal del wording de cláusulas SB → sign-off
    - [ ] Confirmar fórmula APR con legal (efectiva `(1+r)^12-1` shipped, vs simple ×12)
    - [ ] Mike entrega plantilla oficial Superintendencia de Bancos → field-map → render PDF SB → segunda revisión legal
    - [ ] Verificar topes de tasa máxima permitidos por SB (¿hay APR cap legal?) y agregar validación si aplica
    - [ ] Bump `package.json` version 2.15.0 → 2.16.2 antes de tag
    - [x] Aplicar migration a Supabase prod (aplicado 2026-04-25 vía `scripts/apply-prestamos-hardening.mjs` → proyecto `csppjsoirjflumaiipqw`; verificación e2e 47/47 green: 5 tablas + 3 buckets + schema cols + CHECK constraints + UNIQUE(slug) + storage upload+signed URL round-trip)
    - [ ] Agregar collections daily auto-fire (cron WhatsApp recordatorios 24h/2h antes de vencimiento) — diferido a v2.16.3
    - [ ] WhatsApp Business API integration (actualmente solo wa.me deeplink) — diferido
- [x] **Carnicería** (`carniceria`) — **v2.16.3 shipped 2026-04-25** (new screens `CorteCatalog.jsx`, `FreshnessAlerts.jsx`, `MayoreoOrders.jsx`, `Resumen.jsx`; new tables `carniceria_corte_categories`, `inventory_freshness_log`, `inventory_discards`, `recurring_orders`, `carniceria_scales`; web `api.carniceria.*` namespace added in v2.16.3 audit pass; demo seeded with 6 cortes + 5 cuadre rows; smoke 33/33)
- [ ] **Híbrido** (`hybrid`) — likely gaps: POS modo dual UX (sticky toggle Mesa↔Venta directa), inventario unificado vs separado, reportes separados, templates de combinación pre-build, multi-printer routing inteligente
- [ ] **Tienda / Retail genérico** (`retail`) — likely gaps: etiquetas de precio imprimibles, recepción de mercancía/albaranes, devoluciones cliente vs suplidor, múltiples proveedores por SKU, promociones 2x1, combos/kits, expiry tracking, mayoreo B2B
- [ ] **Servicios / Otro** (`service`) — likely gaps: por horas vs proyecto vs visita, cotización antes del trabajo, suscripciones recurrentes, on-site con GPS/foto/firma, materiales junto al servicio, asignación inteligente, garantía de servicio
- [x] **Restaurante / Bar** (`restaurant`) — **v2.16.2 shipped 2026-04-25** (new layout: mesas 5×2 grid + Más vendidos row + flat menu cards w/ search + permanent cart sidebar; preserved all existing logic — modifiers, splits, KDS, happy hour, hybrid mode; migration `20260425000000_restaurant_v3_top_sellers_acuenta.sql` applied — `services_top_sellers` RPC + `mesas_with_active_total` view + `mesa.bill_requested_at` + 'acuenta' status workflow with "Pedir cuenta" button; demo seeded with 10 mesas; smoke 20/20)

Mark with [x] + version when each ships.

---

## Marketing site refresh — real screenshots per vertical (queued)

Triggered AFTER all 8 verticals above ship.

- [ ] Mike captures real product screenshots from his actual production data per vertical
- [ ] Replace static-demo screenshots in `web/public/screenshots/{vertical}.png` with real captures
- [ ] Re-run `node scripts/build-social-assets.mjs` so IG feed/stories/landscape exports regenerate from real screenshots
- [ ] Update `VerticalFeatures.jsx` if any vertical needs more than the standard 8 feature bullets
- [ ] Add per-vertical demo data into the live demo accounts so `/demo/:vertical` static pages reflect production polish
- [ ] Re-deploy Vercel + push minor release (v2.16.x or v2.17.0)

---

## Content X 30-day campaign — vertical showcase (queued)

Triggered AFTER all 5 verticals + real screenshots are done. Coordinated with Content X (separate project at `A:/Studio X HUB/Content X/`).

**30 daily posts** distributed across verticals:
- 4 × Carwash
- 4 × Tienda (rotate subtypes: licorería, farmacia, colmado, supermercado, ferretería, papelería, boutique)
- 4 × Restaurante
- 4 × Mecánica
- 4 × Salón
- 3 × Concesionario
- 3 × Préstamos / Empeño
- 2 × Carnicería
- 2 × Híbrido

**Each post = 6-7 image carousel** (1080×1080 IG feed):
- Slide 1: hook (vertical-specific pain point, e.g. "El 15 de mayo es obligatoria la facturación electrónica para tu carnicería")
- Slide 2-3: feature highlight w/ real screenshot
- Slide 4: comparison vs competitor or DGII Gratuito for that vertical
- Slide 5: pricing tier recommended
- Slide 6: social proof (testimonial when available, certification badge fallback)
- Slide 7: CTA "Empieza tu prueba 7 días → terminalxpos.com"

**Caption template** per vertical: hook + 3 bullets + CTA + 5 hashtags + WhatsApp link.
**Auto-schedule** via Content X scheduler.
**Re-uses existing pipeline**: `social-posts/instagram/feed/` already generates per-vertical 1080×1080 assets — campaign just wires them into 30 scheduled drops.
**Track ROI**: GA4 event `cta_click` from IG attribution → signup conversion; Mike reviews weekly.

References:
- Content X campaign system at `A:/Studio X HUB/Content X/`
- Memory `project_pillow_image_generator.md` (Pillow-based carousel generation pattern)
- Memory `project_countdown_mvp_20260420.md` (existing T-25 → T-0 countdown campaign currently running)

---

## Recently Shipped (2026-04-15 session)

- **Restaurant Mode Phase 1** — Business Config Engine: `packages/config/businessTypes.js` registry, `setupBusinessType.js` seeder, 6-type onboarding in FirstTimeSetup + Settings
- **Restaurant Mode Phase 2** — Data model: mesas, modificadores, service_modificadores, ticket_item_modificadores, kds_events tables in SQLite + Supabase + sync wiring. services + tickets extended with menu/KDS/tip columns
- **Restaurant Mode Phase 3** — Full UI: Mesas.jsx (floor plan grid), MenuBuilder.jsx (3-tab menu admin), KDS.jsx (fullscreen kitchen display), RestaurantPOS.jsx (table-centric POS), SplitBillModal.jsx, TipEntryModal.jsx. POS dispatch, Sidebar nav, App.jsx routes, PlanGate restaurant_mode on pro_plus, printer.js route splitting
- **Restaurant Mode Phase 4** — SaaS registry (business_type_configs Supabase table + fetcher), sample menus (8 mesas + 21 RD items + 12 modifiers), SignupPage business-type step with plan recommendation
- **Reconnect flow** — "Ya tengo una cuenta" on fresh install: email + password → resolves business from Supabase → pulls all data. Supports new PC / reformat / second register
- **Disconnect device** — "Desconectar dispositivo" from PIN screen: clears all synced tables + sync_log + business link. Preserves nothing locally (clean reconnect)
- **Sync resurrection fix** — post-pull cursor advance so pulled rows don't get re-pushed
- **Natural key healing** — pullUpsertRow matches by name/nombre/username when supabase_id misses, adopts server UUID. Prevents duplicates from DB rebuilds
- **Supabase natural key constraints** — UNIQUE indexes on (business_id, name/nombre) for 8 entity tables
- **User delete** — soft-delete (active=0 + updated_at stamp) for sync compatibility
- **empresaSave upsert** — INSERT if businesses row missing (was UPDATE-only, failed after disconnect)
- **Loading screen** — bare X logo, no red square wrapper
- **Supabase fixes** — empleados.ref_id UUID→TEXT, users.pin_hash NULL backfill, PostgREST schema reload, orphan commission cleanup, duplicate empleados/services/categories cleanup
- **Settings cleanup** — Sucursales + auto-backup dead toggles removed, empleados tipo CHECK dropped
- **Reports Net Profit** — already done (DailyReport.jsx:628)
- **Edge Function sources** — already done (deployment verification still pending)

---

## Tech debt

- **Vite v5.4.21 unpatched CVE GHSA-4w7w-66w2-5vf9** (path traversal in `.map` handling). Upgrade to v8 deferred — breaking change (no patched 5.x or 6.x exists; advisory range is `<=6.4.1`, fix only in v8.0.0+). Risk: **dev-server only, not production** — bundled output is unaffected. Mitigation: never expose Vite dev server (`npm run dev` / `dev:web`) to a network interface; bind to localhost only; `.map` files are served only locally during development. Action: schedule v8 migration sprint (review breaking changes in plugin API + SSR + CSS handling). Audited 2026-04-25 alongside postcss 8.5.8 → 8.5.10 patch.
