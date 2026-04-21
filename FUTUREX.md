# FUTUREX — Terminal X Roadmap

Updated: 2026-04-15

Shipped features live in CLAUDE.md §Architecture Notes. This file is forward-looking work only.

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
- **Proper fix (STILL OPEN)**: replace the anon key in desktop installers with a per-license JWT that populates `auth.uid()` so we can tighten policies back to `business_id IN (my_business_ids())`. Multi-hour sprint.

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
- [ ] **L1** — queue_deletions N+1 in push shaper (per-row SQLite lookups): requires schema migration (add queue_supabase_id + ticket_supabase_id columns + backfill). Skipped as low-priority hygiene.
- [ ] **L3** — adelantos approved_by_supabase_id FK: schema addition, low priority.
- [ ] Wire tombstoneAdd into less-critical hard-delete paths (modifiers, mesas, vehicles, etc.) for completeness.

Ranoza E2E smoke: **22/22 passing** after the batch.
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

### Other Backlog
- [ ] Concurrent Electron + Web usage testing (same business, same data)
- [ ] Website redesign — studioxrdtech.com as umbrella brand (Terminal X, Content/Media, Camera, Computer store)
- [ ] Electron realtime: bundle @supabase/supabase-js in electron main process (currently "realtime unavailable")
- [ ] Logo upload RLS: add INSERT policy on Supabase Storage bucket

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
