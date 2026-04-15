# FUTUREX — Terminal X Roadmap

Updated: 2026-04-15

Shipped features live in CLAUDE.md §Architecture Notes. This file is forward-looking work only.

---

## Active / In Progress

### Desktop Installer — Code Signing (THIS WEEK)
- [ ] EV/OV code signing cert (DigiCert/Sectigo/SSL.com ~$200-400/yr)
- [ ] Configure `win.certificateFile` / `win.certificatePassword` in electron-builder
- Required to eliminate SmartScreen "Unknown publisher" warnings

### DGII Production Switch (DEFERRED — not switching yet)
- [ ] Switch env from `certecf` to `ecf` when ready to issue live e-CFs to clients
- [ ] Install cert on desktop + trigger bizSync to push PEM to Supabase (unblocks web e-CF proxy)
- [ ] End-to-end test e-CF submission from web at terminalxpos.com/pos

### Empleados — Remaining Items
- [ ] Verify Liquidacion end-to-end with real data (code exists in `NominaReportes.jsx`, needs e2e run)

### First Client Onboarding Test
Scaffolding shipped (`SignupPage.jsx` + `web/api/signup/provision.js`). Still need real-world validation:
- [ ] Create real client via /signup or admin panel
- [ ] Walk through: add services, create ticket, cobrar, print, reports
- [ ] Verify commissions + credit flow
- [ ] Test on mobile PWA

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

---

## Recently Shipped (removed from active)

- **Reports — Net Profit Tracking** — `ticket_items.cost` snapshotted at sale, "Ganancia Neta" shown in `DailyReport.jsx:628`
- **Supabase Edge Function sources** — both functions implemented (deployment verification still pending above)
- **Empleados `seguridad` tipo** — SQLite CHECK dropped in v1.9.15; Supabase CHECK dropped 2026-04-15 via migration `20260415000000_empleados_tipo_check_drop.sql` (applied to prod)
- **Empleados legacy backfill** — v1.9.22 auto-creates empleados from washers/sellers (`database.js:366-388`)
- **Auto-backup always-on** — 2026-04-15: dead toggle removed from `Settings.jsx`. `autoBackup()` already runs nightly at 02:00 via `startSchedulers()` in `packages/services/backup.js`
- **Sucursales stub removed** — 2026-04-15: no-op toggle + nav entry stripped from `Settings.jsx`. Reintroduce only when multi-branch is actually built
