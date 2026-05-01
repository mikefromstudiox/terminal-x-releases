# Memory Audit — 2026-05-01

Sources of truth for this audit:
- `docs/SCHEMA-SNAPSHOT.md` (frozen 2026-05-01T20:36Z; 150 public tables, all RLS enabled; 408 policies; 24 realtime members; `app_metadata.business_id` is the canonical JWT claim)
- `docs/MIGRATION-AUDIT-2026-05-01.md` (108 migration files; supersession map; `atomic_next_ncf` drift)
- `docs/V2.16.28-PLAN.md` (B1–B7 owner-visible, C1–C5 cashier-visible, A1–A2 architectural; not yet shipped)
- Live commits through `8f5f5a8` (v2.16.29) — package.json version `2.16.29`
- Live web/api surface: `panel.js`, `validate.js`, `rnc.js`, `ecf-sign.js`, `dgii-cert-upload.js`, `staff-verify-auth.js`, `fe.js`, `signup/provision.js`, `signup/lead.js`, `digest/daily.js` (the four `fe/*.js` files are GONE — collapsed into `fe.js`)
- Live web/lib: `dgii-client.js`, `dgii-scraper.js`, `dgii-seed-verify.js`, `rate-limit.js`, `salon-wa-templates.js`, `xml-builder.js`, `xml-signer.js`

---

## §1. Manifest

| File | Type | Status | One-line summary | Action needed |
|---|---|---|---|---|
| MEMORY.md | index | PARTIAL | Master index. Lists v2.16.9 as "Current Release"; we are on v2.16.29. | Update §"Current Release" — bump to v2.16.29; add v2.16.24–v2.16.29 lines; reference docs/SCHEMA-SNAPSHOT.md + MIGRATION-AUDIT. |
| feedback_audit_must_verify_pg_catalog.md | feedback | CURRENT | Audit findings must be backed by pg_catalog query. | Keep. |
| feedback_autonomous.md | feedback | CURRENT | Do everything yourself; never ask Mike to run things manually. | Keep. |
| feedback_batch_builds.md | feedback | CURRENT | Don't release after every fix. | Keep. |
| feedback_build_deploy_flow.md | feedback | PARTIAL | "When Mike says fix this, do full pipeline" — contradicts feedback_batch_builds.md and current practice. | Either delete or add a banner referring to batch_builds as the canonical rule. |
| feedback_business_type_kv_seed.md | feedback | CURRENT | useBusinessType reads `app_settings` KV; provisioning must seed it. Aligned with V2.16.28-PLAN B1. | Keep; consider cross-link to V2.16.28-PLAN. |
| feedback_ciudad_dual_key.md | feedback | CURRENT | Ciudad stored as `ciudad` AND `biz_city`. Still applies. | Keep. |
| feedback_demo_creds_whatsapp_only.md | feedback | CURRENT | No demo creds on website. | Keep. |
| feedback_deploy_lib_wildcard.md | feedback | CURRENT | `cp web/lib/*.js dist-web/lib/`. | Keep. |
| feedback_desktop_claude_validation_loop.md | feedback | CURRENT | Validate fixes on Mike's PC. | Keep. |
| feedback_dev_server_dist_race.md | feedback | CURRENT | Stash to release-staging/. | Keep. |
| feedback_dr_margin_ex_itbis.md | feedback | CURRENT | Ex-ITBIS margin convention. | Keep. |
| feedback_dual_key_joins.md | feedback | PARTIAL | Mostly current, but C4 in V2.16.28-PLAN identifies un-converted queue paths still using `ticket_id`. | Add note that v2.16.28 will sweep remaining `ticket_id` callers; cross-reference C4. |
| feedback_full_flow_before_fix.md | feedback | CURRENT | Map full flow before fixing. | Keep. |
| feedback_gate_go_codeword.md | feedback | CURRENT | GATE GO → run ecf-live-roundtrip.mjs. Script exists. | Keep. |
| feedback_gh_release_upload_404.md | feedback | CURRENT | gh upload 404 quirk. | Keep. |
| feedback_installer_location.md | feedback | CURRENT | Installer stays in dist/. | Keep. |
| feedback_no_coauthor.md | feedback | CURRENT | No Co-Authored-By. | Keep. |
| feedback_no_destructive_writes.md | feedback | CURRENT | No autonomous destructive prod writes. | Keep. |
| feedback_no_schedule_offers.md | feedback | CURRENT | No /schedule offers. | Keep. |
| feedback_nomina_total_acumulado.md | feedback | CURRENT | Liquidación shows total acumulado. | Keep. |
| feedback_parallel_agents.md | feedback | CURRENT | Use parallel agents. | Keep. |
| feedback_parallel_xml_generators.md | feedback | CURRENT | Cert vs runtime XML drift. | Keep. |
| feedback_postgrest_or_filter.md | feedback | CURRENT | `.or()` + is.null pitfall. | Keep. |
| feedback_release_assets.md | feedback | CURRENT | .exe + latest.yml + .blockmap. | Keep. |
| feedback_signed_commits_required.md | feedback | CURRENT | Mike must push signed. | Keep. |
| feedback_sqlcipher_encrypted_db.md | feedback | CURRENT | SQLCipher local DB. | Keep. |
| feedback_supabase_id_architecture.md | feedback | CURRENT | supabase_id pattern is canonical. | Keep; cross-link to docs/SCHEMA-SNAPSHOT.md. |
| feedback_supabase_key_in_installer.md | feedback | CURRENT | Hardcode anon key. | Keep. |
| feedback_supabase_schema_parity.md | feedback | CURRENT | Always create matching Supabase migration. | Keep; reinforce with MIGRATION-AUDIT note. |
| feedback_supabase_unique_constraints.md | feedback | CURRENT | Real UNIQUE CONSTRAINT, not partial index. v2.16.28 B6 confirms one straggler still exists. | Keep; verify after B6 ships. |
| feedback_teamwork_codeword.md | feedback | CURRENT | TEAMWORK TIME workflow. | Keep. |
| feedback_use_dataleaks.md | feedback | CURRENT | dataLEAKS for data work. | Keep. |
| feedback_vercel_function_cap_12.md | feedback | **STALE** | Lists 12 functions including `fe/semilla.js · fe/validarcertificado.js · fe/recepcion.js · fe/aprobacion.js`. Reality: those 4 files are gone, collapsed into `fe.js`. Current count is 10 functions, not 12. | Rewrite the list to match live state; current = 10/12, two slots free. CLAUDE.md says 9/12 — also drifted but in the same direction. |
| feedback_vercel_rebuild_deploy.md | feedback | CURRENT | Re-stage `.vercel/project.json`. | Keep. |
| feedback_vercel_sitemap.md | feedback | CURRENT | Static-file rewrites before SPA catch-all. | Keep. |
| feedback_web_inserts_need_supabase_id.md | feedback | CURRENT | Web inserts must set supabase_id. | Keep. |
| project_activity_log_rls_fix.md | project | STALE-but-historical | Says shipped 2026-04-18 with anon-tier policies. Per MIGRATION-AUDIT §2, those `*_anon_*` policies were dropped in 0427000001 lockdown; activity_log now has `activity_log_jwt_*` reading `app_metadata`. Memory's MEMORY.md note already says "RESOLVED 2026-04-18; legacy `my_business_ids()` policies dropped 2026-04-29 in favor of JWT-claim-only" so the index is correct, but the body of this file still describes the now-superseded `anon` SQL. | Add a top banner: "Bodies in this file SUPERSEDED — see docs/SCHEMA-SNAPSHOT.md §2 for current activity_log_jwt_* policies". |
| project_app_settings_sync_gap.md | project | STALE | Talks about "app_settings has no business_id/updated_at" and "must split". Live `app_settings` already has `business_id, key, value, device_hwid, updated_at, supabase_id` and a 3-col UNIQUE (NULLS NOT DISTINCT) — see SCHEMA-SNAPSHOT.md `app_settings` and migrations 20260418100000 + 20260420700000 + 20260429000300. The "design decision needed" section is no longer needed; the split was implemented. | Mark as RESOLVED at the top; collapse design-decision text; keep whitelist-split story as historical context. |
| project_audit_20260419_consolidated.md | project | CURRENT-historical | 238-finding pre-launch audit. Historical record; many findings shipped, some live. | Keep as historical archive. |
| project_cross_tenant_leak_20260429.md | project | CURRENT | Phase A/B/C fix story. Schema snapshot confirms triggers + JWT backfill + 24-table publication exist. | Keep. |
| project_csp_strict_dynamic_outage.md | project | CURRENT | Historical record. | Keep. |
| project_data_architecture.md | project | PARTIAL | Says "38 synced tables" — live has 150 tables (most synced). Otherwise accurate. Says "v1.9.1 updated 2026-04-16" — quaint version number. | Update synced-table count or rephrase as "core synced families"; cross-link SCHEMA-SNAPSHOT. |
| project_demo_e2e_20260419_all.md | project | CURRENT-historical | 9-vertical sweep results. | Keep as historical archive. |
| project_dgii_certification.md | project | CURRENT | Steps 1-15 complete. | Keep. |
| project_history_timeline.md | project | CURRENT-historical | 2026-04-01 → 2026-04-20 chronicle. | Keep. |
| project_licoreria_discount_feature.md | project | CURRENT | v2.3.10+ shipped feature. | Keep. |
| project_operation_cristal.md | project | CURRENT | Queued audit, not started. Path stub valid. | Keep. |
| project_orphan_fk_fix_20260430.md | project | CURRENT | CASCADE FK migration shipped 2026-04-30. | Keep. |
| project_pillow_image_generator.md | project | CURRENT | Content X side-project. | Keep. |
| project_pin_sync_bug_20260416.md | project | CURRENT-historical | Root cause + fix plan. | Keep. |
| project_pricing_strategy.md | project | CURRENT | Plan pricing unchanged. | Keep. |
| project_ranoza_client.md | project | CURRENT | Ranoza client info. | Keep. |
| project_release_history.md | project | STALE | Stops at v2.12.1. Current is v2.16.29. Misses v2.13–v2.16.29 (~17 releases including DGII golive, salon, concesionario, restaurant, audit sweeps). | Append release notes for v2.13.x → v2.16.29 OR mark file as "frozen at v2.12.1 — see git log + CLAUDE.md for v2.13+". |
| project_security_queue.md | project | STALE | Queue closed by project_security_queue_fix_v2112. Both files exist; queue file is no longer the live tracking doc. | Add "CLOSED — see project_security_queue_fix_v2112.md" banner OR delete. |
| project_security_queue_fix_v2112.md | project | CURRENT | v2.11.2 fix record. | Keep. |
| project_sellers_washers_fk_bug.md | project | CURRENT-historical | Fixed v2.3.6 with stub tables. | Keep. |
| project_staff_rls_missing_select.md | project | STALE-historical | Fix from 2026-04-19 used `staff_select` policy via `my_business_ids()`. Live now is `staff_jwt_select` reading `app_metadata` — superseded by 0427100002 + out-of-band rewrite (per MIGRATION-AUDIT §2.2). | Add banner "fix superseded by JWT-claim-only policies 2026-04-29 — see SCHEMA-SNAPSHOT staff section". |
| project_starsisa_double_ticket.md | project | CURRENT | Commission dedupe rule for legacy import. | Keep. |
| project_starsisa_origin.md | project | CURRENT | STARSISA origin context. | Keep. |
| project_sxad_golive_20260424.md | project | CURRENT | Go-live record. | Keep. |
| project_web_ecf_proven_20260430.md | project | CURRENT | Web e-CF pipeline proven. | Keep. |
| project_web_logout_failed_to_fetch.md | project | CURRENT | Resolved 2026-04-29; kept as runbook. | Keep. |
| reference_audit_prompt_v22.md | reference | CURRENT | Pointer to docs/AUDIT-PROMPT-v2.2.md (file present). | Keep. |
| reference_content_x_campaign_type_pattern.md | reference | CURRENT | Cross-project Content X note. | Keep. |
| reference_demo_accounts.md | reference | PARTIAL | Lists `admin@retail.demo.terminalxpos.com` — but per MEMORY.md and project_ranoza_client.md, that demo slot was claimed by Ranoza (and re-seeded fresh later). Status: re-seeded; the account exists, but the "tienda" slot now has a complicated history. | Add line: "tienda slot was reused for Ranoza 2026-04-19, then re-seeded fresh 2026-04-19. If demo is missing, run `scripts/seedDemoBusinesses.js`." |
| reference_desktop_claude_workflow.md | reference | CURRENT | Workflow guidance. | Keep. |
| reference_dgii_emisor_registry.md | reference | CURRENT | DGII registry rules. | Keep. |
| reference_dgii_ncf_format.md | reference | CURRENT — and reinforces MIGRATION-AUDIT §2.8 which flags `atomic_next_ncf` still padding to 8 digits. | Keep; cross-link to MIGRATION-AUDIT §2.8 (recommend either drop or rewrite atomic_next_ncf). |
| reference_dgii_rfce_multipart.md | reference | CURRENT | RFCE multipart rule. | Keep. |
| reference_drawer_spool_capture.md | reference | CURRENT | scripts/drawer-pulse-capture/ exists. | Keep. |
| reference_drawer_variants_starsisa.md | reference | CURRENT | StarSISA variants shipped v2.3.23. | Keep. |
| reference_full_audit_playbook.md | reference | CURRENT | 6-agent playbook. | Keep. |
| reference_meta_app_gotchas.md | reference | CURRENT | Cross-project Content X note. | Keep. |
| reference_pagespeed_tuning.md | reference | CURRENT | General SPA tuning. | Keep. |
| reference_pat5_onboarding.md | reference | CURRENT | docs/onboarding/ files exist. | Keep. |
| reference_plan_gating_map.md | reference | **STALE** | Maps as of v2.12.0. Misses concesionario/dealership keys, restaurant_reservations, salon_*, carniceria_*, prestamos, restaurant_salon_dashboard, intrant_api, whatsapp_auto, mecanica/work-order keys, etc. CLAUDE.md has the live table. | Replace gating table with the v2.16-era one in CLAUDE.md OR mark as "outdated — see CLAUDE.md Plan gating table for current map". |
| reference_postgrest_gotchas.md | reference | CURRENT | All 14 quirks observed in 2026-05-01 audit. | Keep — already cross-referenced from V2.16.28-PLAN. |
| reference_ranoza_e2e_smoke.md | reference | CURRENT | Script exists; expected output 22 passed. | Keep. |
| reference_schema_snapshot.md | reference | CURRENT | Points to docs/SCHEMA-SNAPSHOT.md (file present, frozen 2026-05-01). | Keep. |
| reference_security_baseline.md | reference | CURRENT | docs/SECURITY-BASELINE.md + JSON snapshot exist. 180/408/24 numbers match SCHEMA-SNAPSHOT (150 public tables; 180 quoted is "RLS-enabled across schemas" — not a contradiction). | Keep. |
| reference_supabase_access.md | reference | CURRENT | Three access methods, .env credentials. | Keep. |
| reference_supabase_legacy_keys.md | reference | CURRENT | Legacy keys not rotatable. | Keep. |
| reference_tienda_subtype_system.md | reference | CURRENT | Subtype architecture. | Keep. |
| reference_training_manual.md | reference | PARTIAL | Lists "features that need to be added" snapshot from 2026-04-16 (Adelantos, Restaurant Mode, Kiosk, Owner Activity Feed, Ciudad on receipt). All have shipped + many newer features (concesionario v2, salon v2, prestamos, accounting firm, etc.) are now also missing from the manual. | Refresh the "features that need to be added" list against current CLAUDE.md feature list. |
| user_mike_profile.md | user | CURRENT | Mike profile. | Keep. |

---

## §2. Recommended deletions

These memories are entirely superseded; safe to delete.

1. **`project_security_queue.md`** — explicitly closed by `project_security_queue_fix_v2112.md`. Holding it open invites a future agent to re-investigate a closed bug. Delete OR collapse into a one-line redirect.

2. **`feedback_build_deploy_flow.md`** — directly contradicts `feedback_batch_builds.md` ("don't release after every fix") and Mike's stated preference. The conflicting rule wastes cycles on misclassification. Delete; keep `feedback_batch_builds.md` as canonical.

3. **`feedback_vercel_function_cap_12.md`** — keep the rule, but the *list* in it is wrong (cites 4 fe/* files that no longer exist). Either rewrite or delete; since the cap rule itself is in CLAUDE.md, deletion is acceptable.

(No other file is "entirely obsolete" — most STALE files contain historically valuable context worth preserving with a banner.)

---

## §3. Recommended updates

For each PARTIAL/STALE memory, the specific edits.

### 3.1 `MEMORY.md`

**Existing line referencing v2.16.9:** the file's "Current Release" pointer in CLAUDE.md is v2.16.9 (older sessions also drift). MEMORY.md doesn't carry a version line directly, but it should add new memories. Recommended addition near top of "Reference" block:

> NEW: `[Schema snapshot (2026-05-01)](reference_schema_snapshot.md)` and `[PostgREST + Supabase quirks](reference_postgrest_gotchas.md)` and `[Audit must verify pg_catalog](feedback_audit_must_verify_pg_catalog.md)` and `[Read full flow before fixing](feedback_full_flow_before_fix.md)` are not currently linked from MEMORY.md.

Add lines for those four files plus an explicit pointer to `docs/MIGRATION-AUDIT-2026-05-01.md` (currently uncited) and `docs/SCHEMA-SNAPSHOT.md`.

### 3.2 `feedback_vercel_function_cap_12.md`

REPLACE block:
```
- panel.js (the multiplexer — admin dashboard, RNC, etc.)
- validate.js
- rnc.js
- ecf-sign.js
- dgii-cert-upload.js
- staff-verify-auth.js
- signup/provision.js
- fe/semilla.js · fe/validarcertificado.js · fe/recepcion.js · fe/aprobacion.js
- digest/daily.js
```
WITH:
```
- panel.js
- validate.js
- rnc.js
- ecf-sign.js
- dgii-cert-upload.js
- staff-verify-auth.js
- fe.js (consolidates semilla/validarcertificado/recepcion/aprobacion via ?action=)
- signup/provision.js
- signup/lead.js
- digest/daily.js
```
Adjust the count: "Current 10/12 functions; 2 slots free." (CLAUDE.md says 9/12 — that's also stale; flag for fix.)

### 3.3 `project_app_settings_sync_gap.md`

Add at top:
```
> RESOLVED — app_settings now has business_id, key, value, device_hwid, updated_at, supabase_id.
> 3-col UNIQUE NULLS NOT DISTINCT (business_id, key, device_hwid). KV is cloud-synced via web.js settings.update + sync.js.
> Whitelist split lives in packages/services/settingsWhitelist.js (ESM + CJS).
> See docs/SCHEMA-SNAPSHOT.md `app_settings` table for live shape.
> Original "design decision needed" section preserved below as historical context.
```

### 3.4 `project_data_architecture.md`

REPLACE: `**38 synced tables (PUSH — SYNC_TABLES):** services, washers, sellers, …`
WITH: `**~75+ synced table families (PUSH allowlist now in `electron/sync.js` SYNC_TABLES + `sync_merge_upsert` server-side allowlist).** See `docs/SCHEMA-SNAPSHOT.md` for the full list of 150 public tables and `docs/MIGRATION-AUDIT-2026-05-01.md` §3.6 for the live `sync_merge_upsert` allowlist (75 entries).`

### 3.5 `project_release_history.md`

Add at top:
```
> FROZEN at v2.12.1. v2.13–v2.16.29 not captured here.
> For v2.13+ release notes see git log on `main` and `Terminal X/CLAUDE.md` "Current Release" section.
> Major v2.13–v2.16.29 milestones: SXAD live on DGII (v2.14.x), Concesionario v2 (v2.16.2),
> Salon v2 (v2.16.1), Restaurante hardening (v2.16.3), PG17 optimization sprint (v2.16.8),
> JWT app_metadata RLS swap (v2.16.x), audit fix sweeps (v2.16.24–28), silent-failure sweep (v2.16.29).
```

### 3.6 `project_activity_log_rls_fix.md`

Add at top:
```
> SUPERSEDED — the `activity_log_anon_*` policies created here were dropped during the
> 2026-04-27 per-license JWT lockdown (migration 20260427000001) and replaced with
> `activity_log_jwt_*` policies reading `app_metadata.business_id`.
> See docs/MIGRATION-AUDIT-2026-05-01.md §2.3 for the supersession.
> Activity log is also now monthly-partitioned (20260428000000_activity_log_monthly_partition.sql).
> Original 2026-04-18 fix preserved below as historical context.
```

### 3.7 `project_staff_rls_missing_select.md`

Add at top:
```
> SUPERSEDED — `staff_select USING(business_id IN (SELECT public.my_business_ids()))`
> was replaced by `staff_jwt_select` and `staff_jwt_modify` reading
> `app_metadata.business_id` directly, plus an out-of-band rewrite captured retroactively.
> See docs/SCHEMA-SNAPSHOT.md staff section + docs/MIGRATION-AUDIT-2026-05-01.md §2.2.
> Lesson (every new RLS-enabled table needs SELECT/INSERT/UPDATE/DELETE policies) still applies.
```

### 3.8 `reference_demo_accounts.md`

ADD at top:
```
> Slot reuse note: `admin@retail.demo.terminalxpos.com` was repurposed for Ranoza Liquor Store
> on 2026-04-19, then re-seeded fresh same day. If a demo appears missing, run
> `node scripts/seedDemoBusinesses.js` (idempotent).
```

### 3.9 `reference_plan_gating_map.md`

REPLACE the v2.12 table entirely. Use the canonical v2.16 table in `Terminal X/CLAUDE.md` "Plan gating" section (concesionario, dealership Pro MAX, carniceria_*, restaurant_reservations, restaurant_salon_dashboard, salon_*, prestamos, etc.). Keep the meta sections ("Where gating lives", "Adding a new feature", "Tienda subtype features vs plan features") — those are still accurate.

### 3.10 `reference_training_manual.md`

REPLACE list under "Features that need to be added":
```
- Adelantos de Nómina · Restaurant Mode · Kiosk Fullscreen Mode · Owner Activity Feed · Ciudad on receipt
```
WITH:
```
Per-release sweep needed. As of v2.16.29 the manual is missing:
- Concesionario vertical (v2.16.2): VehicleInventory, SalesPipeline, TestDrives, DealBuilder, Matriculas, Reservations, Warranties, Preapprovals
- Restaurant v2 (v2.16.3): course pacing, pre-cuenta, 10% Servicio Ley 16-92, mover/juntar mesas, BOM service_recipe_items, restaurant_reservations, Resumen del Salón, 86-list, ManagerAuthGate on void
- Salón v2 (v2.16.1): appointments + stylist_schedules + memberships + walk-ins + public booking
- Préstamos (lending vertical) and Carnicería corte catalog
- DGII e-CF emission certified-vendor flow + Viafirma cert install via /pos/dgii web upload
- PG17 optimization sprint (v2.16.8) — admin/operator-facing? mostly invisible, but the new sync_merge_upsert toggle is in app_settings
- Multi-POS ticket locks, Returns flow, Loyalty tiers, Manager Authorization Card barcode flow
- WhatsApp triggers (dealership), KDS reconnect banner
- Cross-tenant fixes (relevant for support: "log out + back in to see new business")
```

### 3.11 `feedback_dual_key_joins.md`

Add a postscript:
```
> 2026-05-01 update: V2.16.28-PLAN.md C4 identifies remaining `queue` table writes that
> still target `ticket_id` instead of `ticket_supabase_id`. The dual-key rule applies to
> reads; the C4 sweep will harden writes.
```

### 3.12 `feedback_supabase_unique_constraints.md`

Add at end:
```
> 2026-05-01 update: V2.16.28-PLAN B6 flags one remaining partial unique index
> (admin app_settings upsert path on panel.js:1576) that PostgREST cannot use as
> on_conflict. Audit per the rule above; replace with full UNIQUE constraint.
```

### 3.13 `project_security_queue.md`

If keeping rather than deleting, add at top:
```
> CLOSED — see project_security_queue_fix_v2112.md (v2.11.2). All listed mutations now
> have actor>target rank guards on both client and DB layers. Supabase RLS hierarchy
> enforcement remains TODO (mentioned in fix file's "Not in scope").
```

---

## §4. Recommended additions

Gaps surfaced by today's session work that deserve dedicated memory files.

### 4.1 NEW: `feedback_tryor_vs_trywrite_discipline.md`

V2.16.28-PLAN A2 + B2 + reference_postgrest_gotchas.md #8 surfaced a class-rule that has no dedicated memory:

> **Rule:** `tryOr(fn, fallback)` — reads only. Mutations (insert/update/upsert/rpc) must use `tryWrite` which re-throws. Wrapping a mutation in `tryOr` swallows RLS denial / FK violation / NOT NULL / CHECK and returns null, while CobrarModal (or whatever caller) flips to "success" and the user thinks the row landed when it didn't. This was the root cause of v2.16.28 B2.

Add. Cross-link from `feedback_supabase_id_architecture.md` and `reference_postgrest_gotchas.md`.

### 4.2 NEW: `feedback_app_metadata_canonical_jwt_claim.md`

The `user_metadata` → `app_metadata` rewrite is the largest hidden-state change in the schema and every old memory referencing `my_business_ids()` is now partly wrong. A short canonical memory:

> **Rule:** Every RLS policy on Terminal X public.* reads `auth.jwt() -> 'app_metadata' ->> 'business_id'`. Policies referencing `user_metadata` are SUPERSEDED — the live database has 0 such policies (per `pg_policies` 2026-05-01). 161 policies still call `my_business_ids()` (carve-out tables: businesses, licenses, license_events, plans, support_tickets, rnc_cache, plus every `_ins_auth` insert policy that wasn't part of the JWT-pair sweep). The retroactive migration `20260429000050_jwt_metadata_path_swap.sql` documents the out-of-band rewrite. JWT business_id is maintained by triggers `businesses_sync_owner_metadata` + `staff_sync_user_metadata` calling `sync_user_business_metadata()`.

This is implicit in `reference_security_baseline.md` and `reference_postgrest_gotchas.md` #10 but deserves its own focused memory because it's the trap-of-record for the next agent reading old migration files.

### 4.3 NEW: `feedback_atomic_next_ncf_drift.md`

Per MIGRATION-AUDIT §2.8: `atomic_next_ncf(uuid, text)` still pads to 8 digits and gates on `my_business_ids()`. Has no live caller — but is a footgun for any future caller. Memory:

> **Trap:** `atomic_next_ncf` RPC pads to 8 digits (legacy B-series correct, E-series wrong — needs 10) and gates on `my_business_ids()` (will reject service-role JWT-only callers). No live caller in `electron/` or `web/lib/` today. If you reach for it, drop it or rewrite first. Tracked in MIGRATION-AUDIT-2026-05-01.md §2.8 + 5d.

### 4.4 NEW: `feedback_mi_empresa_dual_write_required.md` (after V2.16.28 ships)

V2.16.28 B3 will fix Mi Empresa to write both `businesses` columns AND `app_settings` KV. Once shipped, codify:

> **Rule:** Mi Empresa edits MUST update both `businesses` table columns and the matching `app_settings.biz_*` keys. The two are the dual sources of truth pending the v2.17.0 reconciliation (see V2.16.28-PLAN A1). Receipts + e-CF read from `app_settings.biz_*`; admin reads from `businesses`. Drop dual-write only when one source is formally deprecated.

(Don't add yet — wait until B3 ships.)

### 4.5 Recommended cross-link in existing files

Add a one-line top reference to `docs/SCHEMA-SNAPSHOT.md` and `docs/MIGRATION-AUDIT-2026-05-01.md` at the top of:
- `feedback_supabase_id_architecture.md`
- `feedback_supabase_schema_parity.md`
- `feedback_supabase_unique_constraints.md`
- `project_data_architecture.md`
- `project_cross_tenant_leak_20260429.md`

---

## §5. Cross-reference health

Pointers verified against filesystem.

| Memory | Pointer | Status |
|---|---|---|
| `feedback_audit_must_verify_pg_catalog.md` | `docs/MIGRATION-AUDIT-2026-05-01.md` | OK |
| `feedback_gate_go_codeword.md` | `scripts/ecf-live-roundtrip.mjs` | OK |
| `feedback_no_destructive_writes.md` | `migrations/2026_04_30_jwt_select_my_business_ids_fallback.sql` | OK (file present in `supabase/migrations/`) |
| `feedback_orphan_fk_fix_20260430.md` | `migrations/2026_04_30_ticket_supabase_id_cascade_fks.sql` | OK |
| `project_audit_20260419_consolidated.md` | various line numbers (database.js:3645 etc.) | NOT VERIFIED — line numbers from 12 days ago, likely shifted by intervening commits. Treat as approximate. |
| `project_release_history.md` | GH release URLs | OK (URLs static) |
| `project_security_queue.md` | `electron/auth-guard.js`, `electron/database.js userUpdate` | OK |
| `reference_audit_prompt_v22.md` | `docs/AUDIT-PROMPT-v2.2.md` | OK |
| `reference_drawer_spool_capture.md` | `scripts/drawer-pulse-capture/` | OK (8 files present) |
| `reference_meta_app_gotchas.md` | `frontend/public/privacy.html` etc. | NOT VERIFIED — Content X side, out of scope. |
| `reference_pat5_onboarding.md` | `docs/onboarding/protocolo-de-arranque.html` + `.pdf` | OK |
| `reference_ranoza_e2e_smoke.md` | `scripts/ranoza-e2e-smoke.mjs` | OK |
| `reference_schema_snapshot.md` | `docs/SCHEMA-SNAPSHOT.md` | OK |
| `reference_security_baseline.md` | `docs/SECURITY-BASELINE.md`, `SECURITY-SNAPSHOT-2026-04-30.json` | OK |
| `reference_supabase_access.md` | `.env` | OK |
| `reference_training_manual.md` | `docs/training/terminal-x-training-manual.html` + `.pdf` | OK |
| `feedback_teamwork_codeword.md` | `A:\TerminalX-Share\` paths | NOT VERIFIED (network/Syncthing surface — out of scope of file audit). |
| `feedback_dr_margin_ex_itbis.md` | `packages/ui/screens/Inventory.jsx`, `packages/ui/screens/reports/ProductsReport.jsx` | NOT VERIFIED — should still resolve, but content drift possible. |
| `project_orphan_fk_fix_20260430.md` | `electron/database.js commissionsGetByPeriod` etc. | NOT VERIFIED line-by-line; function names valid per recent commits. |
| `feedback_pin_sync_bug_20260416.md` | `FirstTimeSetup.jsx:565` + `:576` | LIKELY DRIFTED — file modified across multiple v2.16.x sweeps. Current line numbers will not match. |
| Various | `database.js:<line>` references in audit/security files | DRIFTED — line numbers cannot be trusted across 13+ days of commits. |

**No fully-broken pointers.** Several are line-number-soft (the file/function still exists; just don't trust the line count). Recommend a one-line caveat at the top of any memory that cites a specific line: "*Line numbers as of write date; verify against current file before relying.*"

---

## Summary (top findings)

The bulk of memories are accurate. **Three are actively wrong:** `feedback_vercel_function_cap_12.md` lists four `fe/*` files that no longer exist (collapsed into `fe.js`), `project_release_history.md` is frozen at v2.12.1 while we are on v2.16.29, and `reference_plan_gating_map.md` predates concesionario / restaurant / salon / prestamos / carniceria features. **Three others are superseded by 2026-04-29 RLS rewrites:** `project_activity_log_rls_fix.md`, `project_staff_rls_missing_select.md`, and `project_app_settings_sync_gap.md` — their bodies describe SQL that no longer exists in production. **Two memories conflict:** `feedback_build_deploy_flow.md` ("release every fix") vs `feedback_batch_builds.md` ("don't") — the latter is canon. Three new memories recommended: `tryOr` vs `tryWrite` discipline, `app_metadata` JWT claim rule, and `atomic_next_ncf` drift trap.
