# FUTUREX — Terminal X Roadmap

Updated: 2026-04-05

---

## Active / In Progress

### 1. DGII e-CF Certification (CRITICAL — do not change related code)
- [x] Steps 1-5 COMPLETE — 21 test e-CFs + 4 RFCEs accepted, PDFs with QR uploaded
- [x] Receiver endpoints deployed at terminalxpos.com (semilla, validarcertificado, recepcion, aprobacion)
- [ ] **Step 6 — awaiting DGII review** (resubmitted 2026-03-26 with corrected QR timbre)
- [ ] Steps 7-11 — DGII tests receiver endpoints (after Step 6 approval)
- [ ] Steps 12-15 — Production URLs, Declaracion Jurada, final verification
- [ ] Switch env from `certecf` to `ecf` (production) after full certification
- Full guide: `DGII-CERTIFICATION.md` (DO NOT MODIFY until certification complete)

### 2. Admin Panel — Client Onboarding (just built 2026-03-28)
- [x] Day/night mode toggle (system/light/dark, same as Content X dashboard)
- [x] Onboarding checklist — 8 milestones per client (business info, logo, auth, services, customers, first sale, fiscal, setup)
- [x] Client detail page — `/admin/clients/:id` with full profile, license, metrics, staff, onboarding progress
- [x] Quick actions — WhatsApp welcome, reset HWID, change plan, suspend/activate, extend +30d, copy key
- [x] Activity feed on Dashboard — signups, first sales, expiring licenses, inactive clients, suspend/activate events
- [x] Auto-registration flow — client fills setup, app registers in Supabase, waits for admin activation (no manual license key)
- [x] RNC auto-format (XXX-XXXXX-X) and phone auto-format (XXX-XXX-XXXX) in FirstTimeSetup
- [ ] Test with real client data end-to-end
- [x] Admin i18n — Clients, Licenses, Team fully bilingual (112 strings)

### 2b. Admin Panel — Remote Client Management (planned)
The admin panel is the central hub for the Terminal X support team. Clients can configure everything themselves from their desktop Settings, but the admin team can also do it for them remotely. This is the #1 differentiator vs other POS systems in DR: **"We handle the tech so you focus on your business."**

**Dual-control philosophy:** Every setting works both ways — client can change it locally, admin team can override/configure remotely. Desktop syncs from Supabase on each license validation poll. No reinstall ever.

---

#### Plan Tiers — What's Included

| Feature | Pro (RD$2,490/mes) | Pro PLUS (RD$4,490/mes) | Pro MAX (RD$6,990/mes) |
|---|---|---|---|
| **POS core** (tickets, cobrar, print) | Yes | Yes | Yes |
| **Clients directory** | Yes | Yes | Yes |
| **Basic reports** (daily/monthly) | Yes | Yes | Yes |
| **NCF B-series** (paper fiscal) | Yes | Yes | Yes |
| **Credits & credit notes** | - | Yes | Yes |
| **Inventory management** | - | Yes | Yes |
| **Commissions (washer/seller/cajero)** | - | Yes | Yes |
| **Cash reconciliation + petty cash** | - | Yes | Yes |
| **Advanced reports** (salesperson, payroll) | - | Yes | Yes |
| **e-CF electronic invoicing** | - | Yes | Yes |
| **WhatsApp receipt delivery** | - | - | Yes |
| **Remote dashboard** | - | - | Yes |
| **Multi-user (5+ staff)** | 2 users | 5 users | Unlimited |
| | | | |
| **Support level** | | | |
| Self-service (Settings on desktop) | Yes | Yes | Yes |
| Admin team HAS access (read-only) | Yes | Yes | Yes |
| **Remote config by admin team** | **NO** | **Yes** | **Yes** |
| **WhatsApp support line** | **NO** | **Yes — business hours** | **Yes — priority** |
| **On-site visit** | **Paid (upsell trigger)** | 1 visit/quarter | 1 visit/month |
| **Dedicated account manager** | - | - | Yes |
| **Custom service templates** | - | Yes | Yes |
| **Priority onboarding** | - | - | Yes (same-day) |

**The Pro upsell play:** Admin team can SEE the Pro client's data (read-only access for troubleshooting) but CANNOT configure remotely. When a Pro client calls for help:
> "Lamentablemente no podemos acceder a tu sistema de forma remota con el plan basico. Pero te podemos enviar a un tecnico a tu negocio por RD$X,XXX... o puedes actualizar a Pro PLUS por solo RD$2,000 mas al mes y nuestro equipo te configura todo remotamente ahora mismo."

The client either pays for a visit (revenue) or upgrades (recurring revenue). Either way you win.

---

#### Phase A — Remote Config Sync (foundation)
- [ ] **Config sync on validate** — desktop polls Supabase for business settings during license check; merges remote config with local (remote wins on conflict)
- [ ] **Admin config editor** — new section in client detail page: editable business settings (fiscal mode, ITBIS %, language, WhatsApp, features)
- [ ] **Plan-gated remote access** — Pro clients: admin sees read-only view. Pro PLUS/MAX: admin can edit all settings
- [ ] **Sync indicator on desktop** — small "Last synced: 2 min ago" in Settings so client knows config is current

#### Phase B — Per-Client Customization (Pro PLUS & MAX only)
- [ ] **UltraMsg / WhatsApp per client** — admin enters instance_id + token in client detail; desktop picks it up automatically
- [ ] **Fiscal mode toggle** — switch client between B-series and e-CF from admin when their DGII cert is ready
- [ ] **Feature flags per client** — enable/disable inventory, credit notes, reports, commissions, etc. based on plan + business needs
- [ ] **Custom service templates** — push starter service lists from admin (car wash preset, mechanic preset, dealer preset) to speed up onboarding
- [ ] **Remote printer config** — set printer name, paper width from admin
- [ ] **Logo upload from admin** — upload client's logo from the admin detail page

#### Phase C — Support & Operations
- [ ] **Client notes / support log** — admin adds internal notes per client (call log, issues, preferences, visit history)
- [ ] **Support ticket system** — client can report issues from desktop (button in sidebar), shows up in admin panel. Pro PLUS/MAX only.
- [ ] **Health dashboard** — admin sees which clients are active today, last sale time, error rates, offline status
- [ ] **Bulk actions** — send announcement to all clients, mass plan change, bulk feature toggle
- [ ] **Scheduled tasks** — auto-suspend clients with unpaid invoices after X days
- [ ] **Visit scheduler** — track on-site visits per client (Pro MAX gets 1/month, Pro PLUS gets 1/quarter, Pro pays per visit)

#### Admin Team Daily Workflow (first hire)
The first admin hire handles all client-facing technical work:
1. **Morning check** — open admin dashboard, review activity feed (new signups, inactive clients, expiring licenses)
2. **New client onboarding** — see pending registrations, activate license. Pro PLUS/MAX: configure WhatsApp + fiscal + services. Pro: just activate, client self-configures
3. **Support** — respond to WhatsApp (Pro PLUS/MAX only). Pro clients who call → upsell script: "upgrade to get remote support, or we send a technician"
4. **Upsell** — identify Pro clients hitting feature gates or calling for help → pitch Pro PLUS
5. **Billing** — track payments, suspend unpaid, extend paid
6. **Reporting** — weekly summary: active clients, revenue per client, churn risk, upsell opportunities
7. **On-site visits** — schedule and track visits for Pro MAX (monthly) and Pro PLUS (quarterly)

---

## Next Up — Priority Order

### 3. First Client Onboarding Test
- [ ] Create a real client account via /signup or admin panel
- [ ] Walk through: add services, create ticket, cobrar, print, check reports
- [ ] Verify commissions (washers/sellers/cajeros)
- [ ] Verify credit flow: create credit ticket, collect payment
- [ ] Test on mobile (PWA at terminalxpos.com/pos)
- [ ] Use admin activity feed to monitor progress

### 4. Deploy Supabase Edge Functions
- [ ] `supabase functions deploy whatsapp-send` — enables WhatsApp receipts on web
- [ ] `supabase functions deploy rnc-lookup` — enables RNC lookup via Edge Function
- Blocker: need Supabase CLI with Docker, or deploy from Supabase Dashboard

### 5. Finalize Plan Pricing in Supabase
- [x] Landing page shows: Pro RD$2,490 / Pro PLUS RD$4,490 / Pro MAX RD$6,990 (annual 15% off)
- [x] Seed `plans` table with correct pricing + max_users + feature lists (migration created)
- [ ] Add payment flow (Azul gateway or manual WhatsApp-based for now)

### 6. Desktop Build + Installer
- [x] License validation points to Vercel (terminalxpos.com/api/validate)
- [x] Railway fallback removed from codebase
- [x] Windows installer built: `dist/Terminal X-Setup-1.0.0.exe` (164 MB, 2026-03-28)
- [ ] **Windows code signing certificate** — installer currently triggers SmartScreen warnings ("Unknown publisher"). Purchase an EV or OV code signing certificate (e.g., DigiCert, Sectigo, SSL.com ~$200-400/yr) and configure in electron-builder `win.certificateFile` / `win.certificatePassword` to sign the .exe. Required before distributing to clients.
- [ ] Test full desktop license flow end-to-end

### 7. Marketing Push
- [ ] Facebook/WhatsApp group posts in Santiago/Santo Domingo
- [ ] Demo video: ticket -> print -> report -> e-CF
- [ ] WhatsApp support number on landing page: +18098282971

### 8. Website Redesign — Studio X Tech Hub
- [ ] Rebrand studioxrdtech.com as umbrella brand
- [ ] Terminal X POS section with feature breakdown
- [ ] Content/Media, Camera installs, Computer store sections
- [ ] Solutions grid inspired by barolit.com

---

## Completed (shipped)

### SaaS Platform (March 2026)
- Landing page, signup flow, admin panel, plan gating, license validation
- Supabase backend, Vercel hosting, all API routes consolidated
- Brand redesign: black sidebar, white content, deep crimson #b3001e

### Web/PWA (March 2026)
- Live at terminalxpos.com backed by Supabase
- Platform abstraction via DataContext + web.js/electron.js (3-file pattern, no monorepo needed)
- Offline queue (IndexedDB), service worker, PDF fallback printing
- All screens working: POS, Queue, Clients, Credits, Reports, Settings, Inventory, DGII, etc.
- Deep platform audit: 16 issues + 79 silent catches fixed

### e-CF / Fiscal
- DGII Direct (Emisor Electronico) — xml-builder, xml-signer, dgii-client, cert-manager
- ef2.do intermediary dropped entirely
- All 10 e-CF types + RFCE built and signed
- QR URLs per DGII spec (ecf.dgii.gov.do vs fc.dgii.gov.do for E32<250K)
- CodigoSeguridad = SignatureValue[0:6] (raw base64, no hashing)

### Printing & Receipts
- ESC/POS 80mm thermal (42 chars, Code Page 858)
- PDF generation (pdf-lib), HTML report exports, CSV exports with letterhead
- Receipt preview popup with Imprimir/WhatsApp/Cerrar
- Mobile print via iframe (no popup blocker issues)

### License System
- Supabase: plans, licenses, license_events, admin_users tables
- Desktop: HWID-based TXL-XXXX-XXXX-XXXX keys
- Web: Vercel /api/validate with rate limiting + CORS
- 72h offline grace period

### UX
- Dark mode toggle (POS + Admin)
- Keyboard shortcuts (F1/F2/F3)
- Sidebar restructured (13 items -> 8 with sub-menus)
- Bilingual ES/EN throughout
- Commission system (washer/seller/cajero)
- Payroll/Nominas with Ley 16-92 liquidacion

---

## Future / Backlog

- [ ] Azul payment gateway integration
- [ ] Sucursales (multi-branch) — hidden from UI, reintroduce when built
- [ ] Auto-backup always-on (remove toggle, make sync automatic)
- [ ] Concurrent Electron + Web usage testing (same business, same data)
- [ ] Starsisa data import — SQL Server on old system, SSMS access in progress
- [x] Add date indexes on tickets, ticket_items, credit_payments, cuadre tables for fast report queries at scale
- [x] Monorepo migration — complete (packages/ui, services, data with npm workspaces)

### Nóminas (Payroll) — Full in-house payroll center (COMPLETE 2026-04-05)
Expanded Reportes → Nómina from a single severance calculator into a 5-view payroll app so Michael + accountant can run payroll + fiscal filings in-house without an external accountant.
- [x] **5 sub-views**: Dashboard · Empleados · Pagos · Reportes · Ajustes (all under `packages/ui/screens/reports/nomina/`)
- [x] **Paycheck history table** (`payroll_runs`) with itemised deductions: SFS/AFP empleado, ISR, otros, + employer liabilities (SFS/AFP empleador, INFOTEP)
- [x] **Salary change audit log** (`salary_changes`) — auto-recorded on every salary edit with old/new/effective_date/reason
- [x] **Per-business payroll settings** (`payroll_settings`) — pay cycle, editable rates, TSS caps 2026, ISR brackets, legal constants
- [x] **Bulk pay run (Pagos view)** — quincenal/mensual/custom period, auto-computed table for all active employees, transactional bulkCreate, auto-marks commissions paid
- [x] **Auto-computed deductions** using `lib/isr.js` (DR progressive brackets with cycle-aware annualization) and `lib/tss.js` (separate SFS/AFP caps)
- [x] **INFOTEP 1% employer** (no cap) calculated and tracked per run
- [x] **Accountant reports** (NominaReportes view): TSS+INFOTEP PDF/CSV, ISR PDF/CSV with YTD, Nómina completa CSV (QuickBooks/Alegra format), Recibos batch print, Liquidaciones acumuladas (termination liability snapshot)
- [x] **Individual pay stubs** (`printPaycheckStub`) — formal Recibo de Pago with business letterhead, itemised breakdown, signature lines
- [x] **Dashboard view** — metric cards, pending actions, activity feed, 6-month SVG commission trends chart (stacked by tipo)
- [x] **Empleados view** — profile, stats, inner sub-tabs: Historial de Pagos · Comisiones · Liquidación · Cambios de salario
- [x] **Commission-only workers** — lavadores/vendedores/cajeros can be paid without fixed salary (auto-base from period's commissions)
- [x] **Supabase mirror** — migration `20260405000002_nomina_expansion.sql` with full RLS per tenant

### Reports — Net Profit Tracking
- [ ] Reports currently show gross revenue only (`Total Facturado`). Add net profit calculation:
  - Snapshot item cost into `ticket_items.cost` at time of sale
  - Sum `(price - cost) × qty` across line items for each ticket
  - Show "Ganancia Neta" metric alongside "Total Facturado"
  - Only meaningful for resale/product businesses; service-only clients can hide it
