# Terminal X Vertical Silent-Failure Audit
Date: 2026-04-25
Verticals audited: 11

## Summary
- Total findings: 18
- CRITICAL (data loss / broken routes / outage-level): 6
- HIGH (silent UX degradation): 8
- MEDIUM (parity drift / cleanup): 4

## Status as of 2026-04-25 19:30 (post-remediation)
- **All 6 CRITICAL findings RESOLVED** ✓
- **5 of 8 HIGH resolved** (3 silent-catch surfaces + namespace fixes + missing IPC methods)
- **1 of 4 MEDIUM resolved** (RECONCILE_TABLES gap)
- Remaining: H5 (top-sellers UX label), H7 (salon_no_show_deposit gate consistency), H8 (vehicleDocuments.expiringSoon parity verify), M1 (pgcron docs), M4 (appointmentReminders top-level alias — RESOLVED via electron.js adapter)

## Top 3 fix-first issues (now all resolved)

### C1 — Mechanic v2.16 migration unapplied [RESOLVED]
- Files: `supabase/migrations/20260426100000_mechanic_v216_hardening.sql`, `supabase/migrations/20260426100001_mechanic_pgcron_reminders.sql`
- Resolution: Applied via Supabase Management API. Verified columns + tables present.

### C2 — Salon v2.16.1 migration unapplied [RESOLVED]
- File: `supabase/migrations/20260425200000_salon_v2_16_1.sql`
- Resolution: Applied via Supabase Management API. Verified `appointments.deposit_status`, `client_memberships`, `appointment_reminders` exist.

### C3 — Carniceria namespace missing in `packages/data/web.js` [RESOLVED]
- File: `packages/data/web.js` had zero "carniceria" references
- Resolution: Added full `api.carniceria.*` namespace (cortes/freshness/discards/recurringOrders/scales/resumen) +331 lines, mirrors desktop preload shape.

### C4 — Salon Memberships namespace mismatch [RESOLVED]
- File: `packages/ui/screens/salon/Memberships.jsx`
- Resolution: Added flat aliases in `packages/data/electron.js` adapter — `salonMemberships`, `clientMemberships`, `appointmentReminders` map to nested `api.salon.*` paths.

### C5 — Mechanic-photos storage bucket missing [RESOLVED]
- Resolution: Bucket existed but was private. Updated to public via `PUT /storage/v1/bucket/mechanic-photos`.

### C6 — Empty demo seed across mechanic / salon / prestamos [RESOLVED]
- Resolution: Seeded all 3 demo accounts with realistic data:
  - Mechanic: 4 vehicles, 5 work_orders, 2 cotizaciones, 2 aseguradoras, 2 suppliers, 2 parts_orders, 3 photos
  - Salon: 3 memberships, 5 client_memberships, 10 appointments, 18 stylist_schedules, 1 reminder
  - Prestamos: 4 loans, 2 pawn_items, 3 collections_attempts, 1 renewal, 1 listing, 2 pawn_documents, 2 loan_contracts
  - Carniceria: 5 cuadre_caja rows added (the previously-flagged gap)

## HIGH findings status

### H1 — InsuranceBatch.jsx silent failure on generate [RESOLVED]
- File: `packages/ui/screens/mechanic/InsuranceBatch.jsx`
- Resolution: Catch path now surfaces error via flash with explicit message.

### H2 — PawnItems.jsx triple silent catch on document uploads [RESOLVED]
- File: `packages/ui/screens/lending/PawnItems.jsx:298,303,307`
- Resolution: Refactored to accumulator pattern. After create flow, surfaces failed uploads list to user via flash.

### H3 — Salon Memberships.jsx silent catalog load failure [RESOLVED]
- File: `packages/ui/screens/salon/Memberships.jsx:183`
- Resolution: Added `loadError` state + error banner with "Reintentar" button.

### H4 — FreshnessAlerts.jsx discard create silent swallow [RESOLVED]
- File: `packages/ui/screens/carniceria/FreshnessAlerts.jsx:142-155`
- Resolution: Surfaces error with "el corte sigue en inventario" copy so user knows to retry.

### H5 — Restaurant top-sellers silent fallback [DEFERRED to v2.16.4]
- File: `packages/ui/screens/restaurant/RestaurantPOS.jsx:676-688`
- Issue: When RPC fails or returns [], fallback shows alphabetical-first 8 services as "top sellers"
- Fix: Label as "Populares" not "Más vendidos" until real result lands. Low priority — no data loss.

### H6 — aseguradoras.bySupabaseId web-only [RESOLVED]
- Resolution: Added IPC handler in `electron/main.js` + preload exposure + `db.prepare('SELECT * FROM aseguradoras WHERE supabase_id = ?')` query.

### H7 — salon_no_show_deposit gate inconsistency [DEFERRED]
- File: `packages/ui/hooks/usePlan.jsx:64`
- Issue: Gate defined only on Pro MAX but schema columns ship in v2.16.1
- Fix: needs business decision on whether deposit feature is Pro PLUS or Pro MAX. Mike to decide.

### H8 — vehicleDocuments.expiringSoon desktop-only response shape [DEFERRED]
- File: `electron/preload.js:343` returns local rows, web parity unverified
- Fix: low priority — verify web has equivalent or wire it. No active data loss.

## MEDIUM findings status

### M1 — pgcron commented-out cron job [DEFERRED]
- File: `supabase/migrations/20260426100001_mechanic_pgcron_reminders.sql:65-86`
- Fix: documented in CLAUDE.md or de-commented before live mechanic client onboards.

### M2 — Sync table loan_renewals listed but no IPC handler [RESOLVED]
- Resolution: Added `loanRenewals` namespace to preload + main IPC + database functions.

### M3 — RECONCILE_TABLES missing 5 prestamos hardening tables [RESOLVED]
- File: `electron/sync.js`
- Resolution: Added `collections_attempts`, `loan_contracts`, `loan_renewals`, `pawn_documents`, `pawn_listings` to RECONCILE_TABLES.

### M4 — appointmentReminders namespace drift [RESOLVED]
- Resolution: Added flat alias `appointmentReminders: raw.salon?.reminders` in electron.js adapter.

## Cross-cutting findings (post-remediation)
- **Migration apply gap**: Permanently mitigated by adding all migrations to the standard apply pipeline. Future migrations should be applied immediately when the agent ships them.
- **Namespace inconsistency desktop↔web**: Cleanup pass added flat aliases for the 3 known drifts. Future verticals should follow web.js top-level pattern by default.
- **Silent catches dominate the freshly-shipped code**: Reduced — 4 of the most impactful sites surfaced. Remaining defensive catches (PawnItems lines 596/598/612 already had toasts before this audit) flagged but acceptable for now.
- **Demo seed gap most visible to clients**: All 4 hardened demos now have realistic seed data.

## Smoke test impact
- Pre-remediation: 177 pass / 17 fail across 9 verticals
- Post-remediation: **241 pass / 1 fail across 10 verticals** (only servicios fails, blocked on Mike's Grok input for that vertical's hardening plan)

## Files modified during remediation

### Backend
- `supabase/migrations/20260426100000_mechanic_v216_hardening.sql` — applied live
- `supabase/migrations/20260426100001_mechanic_pgcron_reminders.sql` — applied live
- `supabase/migrations/20260425200000_salon_v2_16_1.sql` — applied live
- `electron/sync.js` — RECONCILE_TABLES additions

### Frontend
- `packages/data/web.js` — +331 lines (carniceria namespace + loanRenewals + safeParseJSON helper)
- `packages/data/electron.js` — +10 lines (3 flat aliases)
- `electron/preload.js` — +9 lines (aseguradoras.bySupabaseId + loanRenewals)
- `electron/main.js` — +5 lines (3 new IPC handlers)
- `electron/database.js` — +37 lines (loanRenewalsList + loanRenewalCreate + exports)
- `packages/ui/screens/mechanic/InsuranceBatch.jsx` — +12/-7 (H1)
- `packages/ui/screens/lending/PawnItems.jsx` — +20/-9 (H2)
- `packages/ui/screens/salon/Memberships.jsx` — +28/-3 (H3)
- `packages/ui/screens/carniceria/FreshnessAlerts.jsx` — +21/-2 (H4)

### Tooling
- `scripts/demo-e2e-smoke.mjs` — VERTICAL_TO_CANONICAL alias map + tienda inventory_items column fix
- `scripts/demo-e2e-all.mjs` — added carniceria to VERTICALS rotation
- `scripts/_demo_seed.mjs` (new) — idempotent demo seeder
- `scripts/_demo_seed_ids.json` (new) — UUID lockfile for repeatable seeds
