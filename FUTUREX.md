# FUTUREX — Terminal X Roadmap

Updated: 2026-04-13

Shipped features live in CLAUDE.md §Architecture Notes. This file is forward-looking work only.

---

## Active / In Progress

### DGII Production Switch
- [ ] Switch env from `certecf` to `ecf` when ready to issue live e-CFs to clients
- [ ] Install cert on desktop + trigger bizSync to push PEM to Supabase (unblocks web e-CF proxy)
- [ ] End-to-end test e-CF submission from web at terminalxpos.com/pos

### Empleados — Remaining Items
- [ ] Add tipo `seguridad` — update CHECK constraint in SQLite + Supabase
- [ ] Migrate legacy data — auto-create empleado records for washers/sellers without one
- [ ] Verify Liquidacion end-to-end with real data

### First Client Onboarding Test
- [ ] Create real client via /signup or admin panel
- [ ] Walk through: add services, create ticket, cobrar, print, reports
- [ ] Verify commissions + credit flow
- [ ] Test on mobile PWA

### Supabase Edge Functions
- [ ] `supabase functions deploy whatsapp-send` — WhatsApp receipts on web
- [ ] `supabase functions deploy rnc-lookup` — RNC lookup via Edge Function
- Blocker: Supabase CLI with Docker, or deploy from Dashboard

### Desktop Installer — Code Signing
- [ ] EV/OV code signing cert (DigiCert/Sectigo/SSL.com ~$200-400/yr)
- [ ] Configure `win.certificateFile` / `win.certificatePassword` in electron-builder
- Required to eliminate SmartScreen "Unknown publisher" warnings

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

### Reports — Net Profit Tracking
Currently shows gross revenue only (`Total Facturado`). Add:
- Snapshot item cost into `ticket_items.cost` at time of sale
- Sum `(price - cost) × qty` per ticket
- Show "Ganancia Neta" alongside "Total Facturado" (hide for service-only clients)

### Marketing Push
- [ ] Facebook/WhatsApp group posts in Santiago/Santo Domingo
- [ ] Demo video: ticket → print → report → e-CF

### Other Backlog
- [ ] Sucursales (multi-branch) — hidden from UI, reintroduce when built
- [ ] Auto-backup always-on (remove toggle, make sync automatic)
- [ ] Concurrent Electron + Web usage testing (same business, same data)
- [ ] Website redesign — studioxrdtech.com as umbrella brand (Terminal X, Content/Media, Camera, Computer store)
