# FUTUREX — Terminal X Future Updates

A running list of planned improvements. Check these off as they ship.

---

## 2026 Roadmap — Top 5 RD POS Strategy

### Phase 1 — Windows Desktop Launch (Q2–Q3 2026)
- [ ] **Stable desktop launch for service-based clients** (car washes, mecanicos, car dealers, importadores)
  - Target: 10–20 real clients in Santiago/Santo Domingo via Facebook/WhatsApp groups
  - ~~Polish self-onboarding wizard~~ Done
  - Ensure e-CF reliability under real daily load (30+ tickets/day)
  - Document wins: "606 in seconds, no accountant fee, free tier covers everything"

- [ ] **Resolve E33/E34 (Notas de Debito/Credito) before launch**
  - ef2.do claims full support — open support ticket now to confirm/get timeline
  - Root cause: ef2.do injects `FechaVencimientoSecuencia` into E33/E34 XML which DGII rule 145 rejects
  - Manual workaround: issue corrected E31 + internal adjustment note
  - Do not launch without this — returns happen daily

### Phase 2 — Remote & Viral Features (Q3 2026)
- [x] **Wire Supabase for RemoteDashboard (real data)**
- [x] **WhatsApp receipt delivery** — sends factura via Supabase Edge Function after cobrar

### Phase 3 — Web Version & SaaS Platform (DONE — March 2026)
- [x] **Parallel web version (PWA)** — live at terminalxpos.com
- [x] **Landing page** — terminalxpos.com with plans, pricing, signup CTA
- [x] **Self-service signup** — /signup creates Supabase Auth + business + staff + license
- [x] **Admin panel** — /admin with Dashboard, Clients, Licenses, Team management
- [x] **Plan-based feature gating** — Free / Pro / Pro+ / Pro Max tiers with lock icons
- [x] **Supabase license system** — plans, licenses, license_events, admin_users tables
- [x] **Vercel API routes** — /api/panel (admin), /api/validate (license), /api/signup/provision
- [x] **CORS + rate limiting** on all API endpoints
- [x] **Deep platform audit** — 5 broken + 10 degraded issues found and fixed across web/mobile
- [x] **Error handling audit** — 79 silent catch blocks surfaced with user-facing toasts
- [x] **PDF download on web** — saveReceiptPDF triggers browser download instead of failing
- [x] **Print on mobile** — iframe-based print preview replaces popup (no blocker issues)

### Phase 4 — Payments & Inventory (Q4 2026 / Phase 2 clients)
- [ ] **Azul payment gateway integration**
  - Auto-reconcile card payments in one flow — critical for mid-tier upsell
  - Eliminates manual entry from separate terminal, reduces cashier errors

- [x] **Basic inventory** — /inventory screen, Supabase tables, CRUD + qty adjust + transaction log + low-stock alerts

---

## Next Up — Priority Order

### 1. Deploy Supabase Edge Functions (1 hour)
- [ ] `supabase functions deploy ef2-proxy` — enables e-CF submission on web
- [ ] `supabase functions deploy whatsapp-send` — enables WhatsApp receipts on web
- [ ] `supabase functions deploy rnc-lookup` — enables RNC lookup via Edge Function
- Blockers: need Supabase CLI with Docker, or deploy from Supabase Dashboard

### 2. Finalize Plan Feature Breakdown (decision)
- [ ] Define exact features per tier: Free / Pro / Pro+ / Pro Max
- [ ] Set prices (RD$ or USD)
- [ ] Update plans table in Supabase with final features + pricing
- [ ] Polish landing page pricing section with real prices

### 3. E33/E34 Resolution (launch blocker)
- [ ] Contact ef2.do support about FechaVencimientoSecuencia bug
- [ ] Test E33/E34 in sandbox once fix is confirmed
- [ ] If no fix: build manual workaround (corrected E31 + adjustment note)

### 4. Production e-CF Readiness (launch blocker)
- [ ] Switch QR URL from testecf to production: `ecf.dgii.gov.do/consultatimbre`
- [ ] Wire `validateECF()` to real ef2.do status check (currently hardcoded ACEPTADO)
- [ ] Test full e-CF flow with real ef2.do credentials

### 5. First Client Onboarding Test
- [ ] Create a real client account via /signup flow
- [ ] Walk through entire POS flow: add services, create ticket, cobrar, print, check reports
- [ ] Verify commissions show up for washers/sellers
- [ ] Verify credit flow: create credit ticket, check in Credits screen, collect payment
- [ ] Test on mobile phone (PWA at terminalxpos.com/pos)

### 6. Desktop Build + License Migration
- [ ] Build new Windows installer: `npm run dist:win`
- [ ] Test desktop license validation against new Vercel /api/validate endpoint
- [ ] Deprecate Railway license server after 30 days

### 7. Marketing Push
- [ ] Facebook/WhatsApp group posts in Santiago/Santo Domingo
- [ ] Demo video showing POS in action (ticket → print → report → e-CF)
- [ ] "Free forever" messaging for basic tier
- [ ] WhatsApp support number on landing page: +18098282971

---

## e-CF / Fiscal

- [ ] **Pursue PSFE certification with DGII** — one-time software certification for direct DGII mode
- [ ] **Direct DGII provider mode** — `dgii-ecf` npm package, per-client .p12 cert, $0/month per client
- [x] **e-CF queue UI indicator** — Sidebar badge polls every 30s
- [x] **safeStorage for ef2 token** — encrypted token storage via Electron safeStorage
- [ ] **Switch QR to production DGII URL**
- [ ] **validateECF real implementation**
- [ ] **Alanube / DGMax provider** — alternative to ef2.do

---

## Printing

- [x] **Local PDF generation** — pdf-lib, saves to userData/receipts/ (desktop) or browser download (web)
- [x] **Mobile print** — iframe-based HTML preview, no popup blocker issues
- [x] **Receipt HTML fallback** — works on all platforms when no thermal printer

---

## License / Multi-client

- [x] **Supabase license system** — plans, licenses, license_events, admin_users tables
- [x] **Admin panel** — /admin with dashboard, client management, license CRUD
- [x] **Self-service signup** — /signup with auto-provisioning
- [x] **Plan gating** — Free/Pro/Pro+/Pro Max with sidebar lock icons + upgrade prompts
- [x] **License validation API** — /api/validate with rate limiting, CORS, audit logging
- [x] **License server hardening** — audit log, no business name leaks on invalid keys

---

## UX / Polish

- [x] **Dark mode toggle**
- [x] **Receipt logo** — ESC/POS bitmap
- [x] **Keyboard shortcuts** — F1/F2/F3
- [x] **Multi-printer support**
- [x] **Error handling** — 79 silent catches surfaced with toasts
- [x] **Platform audit** — all screens verified for desktop/web/mobile

---

## Infrastructure

- [x] **Auto-backup to cloud** — Supabase Storage, 15-min incremental sync
- [x] **Vercel deployment** — terminalxpos.com with API routes
- [x] **Supabase migrations** — timestamped, pushed via CLI
- [ ] **Deploy Edge Functions** — ef2-proxy, whatsapp-send, rnc-lookup
- [ ] **Railway deprecation** — shut down after desktop clients migrate to Vercel API
