# FUTUREX — Terminal X Roadmap

Updated: 2026-04-15

Shipped features live in CLAUDE.md §Architecture Notes. This file is forward-looking work only.

---

## Active / In Progress

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
