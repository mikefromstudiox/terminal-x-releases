# FUTUREX — Terminal X Future Updates

A running list of planned improvements. Check these off as they ship.

---

## 2026 Roadmap — Top 5 RD POS Strategy

### Phase 1 — Windows Desktop Launch (Q2–Q3 2026)
- [ ] **Stable desktop launch for service-based clients** (car washes, mecánicos, car dealers, importadores)
  - Target: 10–20 real clients in Santiago/Santo Domingo via Facebook/WhatsApp groups
  - ~~Polish self-onboarding wizard so zero technician visits are needed~~ ✓ Done — fiscal mode step, auto-dash license key, next-steps checklist added
  - Ensure e-CF reliability under real daily load (30+ tickets/day)
  - Document wins: "606 in seconds, no accountant fee, free tier covers everything"

- [ ] **Resolve E33/E34 (Notas de Débito/Crédito) before launch**
  - ef2.do claims full support — open support ticket now to confirm/get timeline
  - Root cause from sandbox testing: ef2.do injects `FechaVencimientoSecuencia` into E33/E34 XML which DGII rule 145 rejects
  - Manual workaround while waiting: issue corrected E31 + internal adjustment note
  - Do not launch without this — returns happen daily

### Phase 2 — Remote & Viral Features (Q3 2026)
- [x] **Wire Supabase for RemoteDashboard (real data)**
  - RemoteDashboard now uses `fetchDashboardData()` from `supabase.js` — real queries, no demo data
  - Shows "Supabase no configurado" when credentials are missing

- [ ] **WhatsApp receipt delivery**
  - Integrate Twilio/WhatsApp Business API (or RD-friendly alternative)
  - Sends factura instantly after cobrar — reduces print costs, huge viral potential
  - Phase 1 clients will request this day one

### Phase 3 — Web Version & Tablet/Android (Q3 2026 start → Q1 2027 goal)
- [ ] **Parallel web version (PWA-capable by Q1 2027)**
  - Reuse existing React/Vite components
  - Replace IPC/SQLite with lightweight API (Node/Express or Supabase Edge Functions)
  - Auth + DB: Supabase PostgreSQL + Row Level Security
  - Printing: browser-compatible via qz-tray (USB) or cloud print
  - ef2.do calls: server-side to bypass CORS (replaces Electron IPC bridge)
  - Licensing: rethink to Supabase user-based or device fingerprint
  - Unlocks tablets, Android, multi-device owners — expands addressable market dramatically

### Phase 4 — Payments & Inventory (Q4 2026 / Phase 2 clients)
- [ ] **Azul payment gateway integration**
  - Auto-reconcile card payments in one flow — critical for mid-tier upsell
  - Eliminates manual entry from separate terminal, reduces cashier errors

- [x] **Basic inventory skeleton** — `/inventory` screen, SQLite tables, CRUD + qty adjust + transaction log, low-stock alerts, sidebar nav

---

## e-CF / Fiscal

- [ ] **Pursue PSFE certification with DGII** — one-time software certification required before selling direct DGII mode to clients; contact DGII to initiate the process

- [ ] **Direct DGII provider mode** (pluggable adapter)
  - Add `ecfProvider: 'ef2' | 'direct'` config toggle in Settings → e-CF
  - Use `dgii-ecf` npm package for XML build + PKCS#7 signing
  - Per-client `.p12` cert stored encrypted via `electron.safeStorage`
  - Switch `ENVIRONMENT.DEV` → `ENVIRONMENT.PROD` once DGII-certified
  - Benefit: $0/month per client, full margin goes to Studio X Tech
  - Blocker: requires one-time DGII software certification (PSFE) before selling widely

- [x] **e-CF queue UI indicator** — Sidebar polls `ecf.queueCount()` every 30s, badge shown on DGII nav item

- [x] **safeStorage for ef2 token** — `safe:get`/`safe:set` IPC handlers in main.js; Settings → e-CF reads/writes encrypted token; wizard also saves it on setup

- [ ] **Switch QR to production DGII URL**
  - Current: `https://ecf.dgii.gov.do/testecf/consultatimbre`
  - Production: `https://ecf.dgii.gov.do/consultatimbre`
  - Flip when first client goes live with real ef2.do credentials

- [ ] **validateECF real implementation**
  - Currently a stub that returns hardcoded `ACEPTADO`
  - Wire to ef2.do status check endpoint for real post-submission verification

---

## Printing

- [x] **Local PDF generation** — `src/services/pdf.js` using `pdf-lib`, saves to `userData/receipts/`

---

## License / Multi-client

- [x] **License server hardening**
  - Add Supabase-backed license audit log (who activated what, when) — logs activate, validate, hardware_mismatch, expired, suspended to `license_events` table

- [x] **Setup Supabase project**
  - `getSupabaseClient()` and `fetchDashboardData()` implemented in `src/services/supabase.js`
  - Credentials configured via Settings → Conexión Remota

- [x] **Remote dashboard (Supabase)**
  - RemoteDashboard wired to real Supabase queries via `fetchDashboardData()`

---

## UX / Polish

- [x] **Dark mode toggle** — light/dark toggle in Sidebar footer, persists via LayoutContext
- [x] **Receipt logo** — ESC/POS bitmap via `buildLogoEscPos()` in `src/services/printer.js`
- [x] **Keyboard shortcuts** — F1=new ticket, F2=cobrar, F3=queue view (implemented in POS.jsx)
- [x] **Multi-printer support** — Settings → Impresoras now loads real detected printers, persists to `app_settings`, includes drawer test button

---

## Infrastructure

- [x] **Auto-backup to cloud** — nightly at 02:00 via `backup.js`; Supabase Storage upload, 15-min incremental sync, manual backup + restore UI
- [ ] **Alanube / DGMax provider** — alternative to ef2.do if client already has contract
