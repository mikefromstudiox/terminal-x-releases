# Terminal X — Supabase Migration Audit (2026-05-01)

Project: `csppjsoirjflumaiipqw` (terminalxpos prod)
Auditor: dataLEAKS
Migrations folder: `supabase/migrations/`
File count: **108**
Live state captured: 2026-05-01 via Supabase Management API
Re-verify helper: `node scripts/_audit_query.mjs "<SQL>"`

---

## TL;DR (read this first)

1. **No migration in the repo rewrites RLS policies from `user_metadata` → `app_metadata`.** Yet live state has **0** policies referencing `user_metadata` and **202** referencing `app_metadata`. The rewrite was performed out-of-band (script run via Management API, never committed). Every JWT-RLS migration in `supabase/migrations/` (`20260427000001`, `20260427100002`, etc.) is **SUPERSEDED in body** even though the file never touches the policies after the live rewrite.
2. **`my_business_ids()` is still in 161 policies** — `20260429000700_drop_legacy_my_business_ids_policies.sql` only dropped the legacy ones on tables that already had a JWT sibling pair. Many tables (license/admin/storage/auth surface, plus tables added after 0427000001's table-list) still depend on it.
3. **`atomic_next_ncf` is functionally drifted** — its body still pads to **8 digits** and still gates on `my_business_ids()`. Required behaviour for E-series e-CFs is **10-digit padding**. Earlier session note ("signature drift confirmed") is true: the live function is the legacy one. Web e-CF flow does NOT call it (uses NCF queue logic). Calling it directly for E-series WILL produce malformed eNCF strings.

Treat this document as the authoritative state; treat any migration file that isn't on the LIVE list in §1 as historical text.

---

## §1. Migration Manifest (chronological, status-tagged)

Status legend:
- **LIVE** — file's objects still match deployed state body-for-body.
- **SUPERSEDED** — every object the file created/altered has been replaced by a later object body. File text MUST NOT be trusted as deployed truth.
- **PARTIAL** — some objects survive, some have been replaced. Read carefully.
- **ARCHIVED** — objects the file created have been dropped entirely.
- **ADDITIVE-LIVE** — file is purely additive (new table/column/index/function still in use).

| # | File | Status | What it touches |
|---|---|---|---|
| 1 | `20260301000000_initial.sql` | SUPERSEDED | Original schema + per-table `*_select`/`*_insert`/`*_update`/`*_delete` policies via `my_business_ids()`. ALL of those policies were renamed/replaced during 0427-0429 cycle. |
| 2 | `20260301000001_upgrade_existing.sql` | SUPERSEDED | Same legacy `my_business_ids()` shape. |
| 3 | `20260301000002_add_local_id.sql` | ADDITIVE-LIVE | `local_id` columns. Columns survive. |
| 4 | `20260301000003_queue_fks.sql` | ADDITIVE-LIVE | Queue FK plumbing. |
| 5 | `20260322000000_seller_cajero_commissions.sql` | PARTIAL | Tables LIVE; their policies REPLACED by `*_jwt_select` / `*_jwt_modify` (plus `*_ins_auth`). |
| 6 | `20260323000000_licenses_and_plans.sql` | PARTIAL | Tables `licenses`, `plans`, `license_events` LIVE. Policies still legacy (`my_business_ids`) — these are carve-outs in 0429000700. |
| 7 | `20260324000000_rls_configuracion.sql` | SUPERSEDED | `configuracion` policies replaced by `configuracion_jwt_*`. |
| 8 | `20260327000000_empleados.sql` | PARTIAL | `empleados` table + base policies. Policies replaced by `empleados_jwt_*`. |
| 9 | `20260328000000_update_plan_pricing.sql` | ADDITIVE-LIVE | Data update only. |
| 10 | `20260405000000_item_cost_tracking.sql` | ADDITIVE-LIVE | Cost columns on inventory_items. |
| 11 | `20260405000001_payroll_runs.sql` | PARTIAL | Table LIVE; policies replaced by `payroll_runs_jwt_*`. |
| 12 | `20260405000002_nomina_expansion.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 13 | `20260409000000_salary_history_backfill.sql` | ADDITIVE-LIVE | Backfill + `salary_changes`. |
| 14 | `20260412000000_support_tickets.sql` | LIVE | `support_tickets` + `support_tickets_sel_auth` policy still LIVE (carve-out in 0429000700). |
| 15 | `20260413000000_activity_log.sql` | SUPERSEDED | Original `activity_log` is now the *partition root* (see 0428000000_activity_log_monthly_partition); original `activity_log_select` policy renamed to `activity_log_jwt_*`; legacy table moved to `activity_log_legacy_unpartitioned`. |
| 16 | `20260414000000_empleados_sync_fix.sql` | ADDITIVE-LIVE | Column adds. |
| 17 | `20260414000001_updated_at_sync_fix.sql` | ADDITIVE-LIVE | `updated_at` adds. |
| 18 | `20260415000000_empleados_tipo_check_drop.sql` | LIVE | Constraint drop. |
| 19 | `20260416000000_restaurant_mode.sql` | PARTIAL | Mesas/modificadores tables LIVE; their policies replaced by `*_jwt_*`. |
| 20 | `20260416100000_business_type_configs.sql` | LIVE | `business_type_configs` table + `btc_select` policy still LIVE. |
| 21 | `20260416200000_natural_key_constraints.sql` | LIVE | UNIQUE constraints survive. |
| 22 | `20260416300000_sync_parity_fixes.sql` | ADDITIVE-LIVE | Schema parity columns. |
| 23 | `20260416400000_sync_parity_phase2.sql` | ADDITIVE-LIVE | More parity columns. |
| 24 | `20260417000000_services_category_default_general.sql` | LIVE | DEFAULT 'General'. |
| 25 | `20260417000001_v21_schema_consolidation.sql` | SUPERSEDED | Re-asserts `my_business_ids` policies on dozens of tables. ALL replaced. |
| 26 | `20260417000002_v21_rls_cleanup.sql` | SUPERSEDED | Same era — replaced. |
| 27 | `20260417000003_v21_sync_columns_hotfix.sql` | ADDITIVE-LIVE | Column adds. |
| 28 | `20260417100000_mechanic_vertical.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 29 | `20260418000000_multipos_blocks.sql` | PARTIAL | `doc_number_*` tables LIVE; policies replaced. |
| 30 | `20260418100000_app_settings_sync_parity.sql` | ADDITIVE-LIVE | `app_settings` columns. |
| 31 | `20260418200000_activity_log_rls_policies.sql` | SUPERSEDED | Replaced by `activity_log_jwt_*`. |
| 32 | `20260419000000_users_view_auth_fix.sql` | LIVE | `users` VIEW on `staff` (matches CLAUDE.md spec). |
| 33 | `20260419100000_restaurant_sync_hardening.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 34 | `20260419200000_sprint5_rls_hardening.sql` | SUPERSEDED | All `*_sel`/`*_ins`/`*_upd`/`*_del` via `my_business_ids` replaced. |
| 35 | `20260419300000_sync_update_triggers.sql` | LIVE | `trg_set_updated_at` family in use. |
| 36 | `20260420000000_inventory_counts.sql` | PARTIAL | Tables LIVE; policies replaced; the `supabase_realtime` ADD inside is overridden by 0429000100/200. |
| 37 | `20260420000001_tickets_rev_guard.sql` | LIVE | `trg_tickets_rev_guard` + `rev` column LIVE. |
| 38 | `20260420000010_cert_history.sql` | PARTIAL | `ecf_cert_history` LIVE; policies replaced by `ecf_cert_history_jwt_*`. |
| 39 | `20260420000011_db_backup_bucket.sql` | LIVE | Bucket + storage policies. |
| 40 | `20260420000012_deposit_amount.sql` | LIVE | Column. |
| 41 | `20260420000013_dgii_seed_nonces.sql` | SUPERSEDED | Replaced by 0420000014. |
| 42 | `20260420000014_dgii_seed_nonces_v2.sql` | LIVE | Current `dgii_seed_nonces` shape. |
| 43 | `20260420000015_remove_ef2_token.sql` | LIVE | Column drop. |
| 44 | `20260420000016_rls_businesses_license_events.sql` | PARTIAL | `businesses` policies LIVE (carve-out); `license_events_*` LIVE. |
| 45 | `20260420100000_tickets_payment_parts.sql` | LIVE | `payment_parts jsonb` LIVE. |
| 46 | `20260420200000_anecf_queue.sql` | PARTIAL | Table LIVE; policies replaced by `anecf_queue_jwt_*`. |
| 47 | `20260420400000_pin_bcrypt_migration.sql` | ADDITIVE-LIVE | Bcrypt logic. |
| 48 | `20260420500000_activity_log_immutable.sql` | LIVE | `trg_activity_log_immutable_upd/del` triggers LIVE. |
| 49 | `20260420600000_license_rebind_requests.sql` | LIVE | Carve-out table. |
| 50 | `20260420700000_app_settings_device_scope.sql` | LIVE | `is_device_local` + `device_hwid` LIVE. |
| 51 | `20260420800000_ecf_queue_cloud_mirror.sql` | PARTIAL | Table LIVE; policies replaced. |
| 52 | `20260420900000_api_rate_limits.sql` | LIVE | `api_rate_limits_service_role_all` LIVE. |
| 53 | `20260421000000_bigint_business_id_to_uuid.sql` | LIVE | Type migration baked in. |
| 54 | `20260421000001_loyalty_program.sql` | PARTIAL | `loyalty_transactions` LIVE; policies replaced. |
| 55 | `20260421100000_cert_expiry_tracking.sql` | LIVE | Columns. |
| 56 | `20260421200000_cuadre_shift_open.sql` | ADDITIVE-LIVE | Column. |
| 57 | `20260421300000_loyalty_tiers_lifetime.sql` | LIVE | Column + helper. |
| 58 | `20260421400000_businesses_is_demo.sql` | LIVE | Column. |
| 59 | `20260421500000_restore_anon_sync_policies.sql` | **FULLY SUPERSEDED** | Created the `rls_anon_sync_*` family on every sync table. Every one of those policies was DROPPED inside the loop in `20260427000001_per_license_jwt_lockdown.sql`. **Reading this file gives a 100% wrong picture of current RLS.** |
| 60 | `20260421600000_sync_update_triggers_patch.sql` | LIVE | trigger patch. |
| 61 | `20260421700000_categorias_servicio_unique_name.sql` | LIVE | UNIQUE constraint. |
| 62 | `20260421800000_adelantos_approved_by_supabase_id.sql` | LIVE | Column. |
| 63 | `20260422000000_inventory_counts_signature.sql` | LIVE | Column. |
| 64 | `20260423000000_commissions_manual_reason.sql` | LIVE | Column. |
| 65 | `20260423200000_pin_default_bcrypt.sql` | LIVE | Default. |
| 66 | `20260425000000_app_settings_updated_at_lww.sql` | LIVE | LWW logic + `app_settings_bump_updated_at` trigger. |
| 67 | `20260425000000_marketing_leads.sql` | LIVE | Table + `anon_insert_only` policy LIVE. |
| 68 | `20260425000001_restaurant_v3_top_sellers_acuenta.sql` | ADDITIVE-LIVE | Columns/views. |
| 69 | `20260425100000_concesionario_v2.sql` | PARTIAL | Tables LIVE; their policies replaced by `*_jwt_*` and `*_anon_*`. |
| 70 | `20260425200000_prestamos_hardening.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 71 | `20260425200001_salon_v2_16_1.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 72 | `20260425300000_salon_v2_16_1_patch.sql` | LIVE | Patch. |
| 73 | `20260425400000_memberships_vertical.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 74 | `20260425500000_prestamos_rls_tighten.sql` | **FULLY SUPERSEDED** | Created `<tbl>_anon_select` / `<tbl>_anon_modify` on prestamos tables. ALL dropped inside 0427000001's loop. |
| 75 | `20260425500001_appointment_no_show_fee_ticket.sql` | LIVE | Logic only. |
| 76 | `20260425600000_lending_sync_completeness.sql` | ADDITIVE-LIVE | Columns. |
| 77 | `20260425700000_pawn_prestamista_signature.sql` | ADDITIVE-LIVE | Columns. |
| 78 | `20260425800000_clients_wa_optout.sql` | LIVE | `wa_opt_out` column LIVE. |
| 79 | `20260425900000_business_mora_rate.sql` | LIVE | Column. |
| 80 | `20260426000000_concesionario_compliance.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 81 | `20260426000003_pawn_listings_override.sql` | LIVE | Public-listings carve-out policy LIVE (`pawn_listings_public_published` etc.). |
| 82 | `20260426100000_mechanic_v216_hardening.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 83 | `20260426100001_mechanic_pgcron_reminders.sql` | LIVE | pg_cron job. |
| 84 | `20260426100002_create_loan_with_schedule_rpc.sql` | LIVE | RPC LIVE. |
| 85 | `20260426200000_service_projects.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 86 | `20260427000000_concesionario_reservations.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 87 | `20260427000001_per_license_jwt_lockdown.sql` | **POLICY-BODY SUPERSEDED, FRAMEWORK LIVE** | Loop creates `<tbl>_jwt_select` + `<tbl>_jwt_modify` policies. Policy *names* still LIVE; but policy *bodies* in the file say `((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid` while LIVE bodies say `app_metadata`. **This is the file the earlier agent mis-trusted.** |
| 88 | `20260427100000_concesionario_warranties.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 89 | `20260427100000_loan_reminders_cron.sql` | LIVE | Cron job. |
| 90 | `20260427100001_mechanic_v216_polish.sql` | LIVE | Polish. |
| 91 | `20260427100002_staff_jwt_lockdown.sql` | **BODY SUPERSEDED** | Same `user_metadata` → `app_metadata` issue. Live `staff_jwt_select` + `staff_jwt_modify` use `app_metadata`. |
| 92 | `20260427200000_concesionario_preapprovals.sql` | PARTIAL | Tables LIVE; policies replaced. |
| 93 | `20260428000000_activity_log_monthly_partition.sql` | LIVE | Partitioning LIVE; `activity_log_legacy_unpartitioned` exists as artifact. |
| 94 | `20260428000000_mechanic_v216_safe.sql` | LIVE | Safe variant. |
| 95 | `20260428100000_carwash_memberships_advance_period.sql` | LIVE | Column + RPC. |
| 96 | `20260428100000_restaurant_open_tickets.sql` | LIVE | `open_status` column on tickets LIVE. |
| 97 | `20260428200000_rls_three_table_fix.sql` | PARTIAL | Three-table fix; the JWT-bodied policies created here now use `app_metadata` (rewritten out-of-band). |
| 98 | `20260429000000_jwt_business_id_backfill.sql` | LIVE | `resolve_user_business_id`, `sync_user_business_metadata`, triggers `businesses_sync_owner_metadata` + `staff_sync_user_metadata` ALL LIVE. **This file is the canonical record of how `app_metadata.business_id` is maintained.** |
| 99 | `20260429000100_realtime_publication_trim.sql` | SUPERSEDED | Trimmed publication to 5 tables. Restore migration immediately after re-added 19 of them. |
| 100 | `20260429000200_realtime_publication_restore.sql` | LIVE | Live publication = 24 tables (matches this file's restore_list ∪ keep_list). |
| 101 | `20260429000300_app_settings_unique_constraint.sql` | LIVE | UNIQUE constraint. |
| 102 | `20260429000400_unique_constraints_for_upsert.sql` | LIVE | Sweep of UNIQUE constraints. |
| 103 | `20260429000500_supabase_id_unique_sweep.sql` | LIVE | UNIQUE on (business_id, supabase_id) family. |
| 104 | `20260429000600_payroll_employee_bank_roster_uniq.sql` | LIVE | UNIQUE constraint. |
| 105 | `20260429000700_drop_legacy_my_business_ids_policies.sql` | LIVE | Dropped legacy policies on the subset of tables that already had a `_jwt_select` + `_jwt_modify` pair. **Did not drop `my_business_ids` from the carve-out list (businesses, licenses, license_events, license_rebind_requests, support_tickets, plans, signup_provisional, rnc_cache, license_jwt_audit) NOR from `_public_*` policies NOR from any table where the JWT pair was missing.** 161 policies still reference `my_business_ids()` today. |
| 106 | `20260429000800_ticket_items_business_supabase_idx.sql` | LIVE | Index. |
| 107 | `20260429000900_tickets_active_paid_created_idx.sql` | LIVE | Index. |
| 108 | `20260430000000_ecf_submissions_dgii_status.sql` | LIVE | Column on `ecf_submissions`. |

---

## §2. Supersession Map (per object family)

### 2.1 RLS policies — `tickets`

| Migration | Status | What it created | Replaced/Dropped by |
|---|---|---|---|
| `20260301000000_initial.sql` | SUPERSEDED | `tickets_select`/`_insert`/`_update`/`_delete` via `my_business_ids()` | `20260427000001` dropped them inside the legacy-name sweep |
| `20260417000001_v21_schema_consolidation.sql` | SUPERSEDED | re-asserted `my_business_ids` shape | same |
| `20260419200000_sprint5_rls_hardening.sql` | SUPERSEDED | hardened `my_business_ids` shape | same |
| `20260421500000_restore_anon_sync_policies.sql` | SUPERSEDED | `rls_anon_sync_*` (anon, business_id IS NOT NULL) | dropped in 0427000001 loop |
| `20260427000001_per_license_jwt_lockdown.sql` | **BODY SUPERSEDED** | created `tickets_jwt_select`+`tickets_jwt_modify` w/ `user_metadata` | rewritten OUT-OF-BAND to `app_metadata` (no migration file in repo) |
| `20260428200000_rls_three_table_fix.sql` | LIVE-ish | three-table tweak | bodies now read `app_metadata` |
| **LIVE** | LIVE | `tickets_jwt_select`, `tickets_jwt_insert`, `tickets_jwt_modify`, `tickets_ins_auth`, `p_tickets_select_accountant` | — |

### 2.2 RLS policies — `staff`

| Migration | Status | What it created | Replaced/Dropped by |
|---|---|---|---|
| `20260301000000_initial.sql` | SUPERSEDED | `staff_select`/`_insert`/`_update`/`_delete` via `my_business_ids` | replaced in 0427100002 |
| `20260427100002_staff_jwt_lockdown.sql` | **BODY SUPERSEDED** | `staff_jwt_select` + `staff_jwt_modify` with `user_metadata` | bodies rewritten OUT-OF-BAND to `app_metadata` |
| **LIVE** | LIVE | `staff_jwt_select`, `staff_jwt_modify`, `staff_ins_auth`, `staff_insert` | — |

### 2.3 RLS policies — `app_settings`, `clients`, `inventory_items`, `services`, `ticket_items`, `queue`, `empleados`, `ncf_sequences`, `cuadre_caja`, `caja_chica`, `notas_credito`, `credit_payments`, `categorias_servicio`, `compras_607`, `client_item_prices`, `inventory_transactions`, `kds_events`, `mesas`, `modificadores`, `seller_commissions`, `cajero_commissions`, `washer_commissions`, `mechanic_commissions`, `payroll_runs`, `salary_changes`, `adelantos`, `loyalty_transactions`, `wash_combos`, `subscriptions`, `service_packages`, `projects`, `vehicle_*`, `pawn_*`, `loan_*`, `appointment_*`, `appointments`, `stylist_schedules`, `memberships`, `client_memberships`, `membership_redemptions`, `service_recipe_items`, `restaurant_reservations`, `recurring_orders`, `promotions`, `promotion_items`, `aseguradoras`, `suppliers`, `parts_orders`, `insurance_batches`, `inventory_freshness_log`, `inventory_discards`, `inventory_oversells`, `carniceria_*`, `client_service_rates`, `service_modificadores`, `service_bays`, `ticket_item_modificadores`, `vehicle_inventory`, `sales_deals`, `leads`, `test_drives`, `bank_preapprovals`, `ecf_queue`, `ecf_submissions`, `anecf_queue`, `ecf_cert_history`, `compras_607`, `notas_credito`, `appointment_reminders`, `collections_attempts`, `collections_log`, `loan_contracts`, `loan_payments`, `loan_renewals`, `loan_schedule`, `loans`, `pawn_documents`, `pawn_items`, `pawn_listings`, `payroll_settings`, `vehicle_documents`, `vehicle_reservations`, `vehicle_titulo`, `vehicle_warranties`, `vehicles`, `work_order_items`, `work_order_photos`, `work_orders`, `queue_deletions`, `kds_events`, `salary_changes`

| Pattern | Status | What was created | Replaced/Dropped by |
|---|---|---|---|
| `20260301000000_initial.sql` + initial vertical-pack migrations | SUPERSEDED | per-table named policies via `my_business_ids()` | dropped in 0427000001 loop |
| `20260421500000_restore_anon_sync_policies.sql` | **FULLY SUPERSEDED** | `rls_anon_sync_*` (4 policies × ~70 tables = ~280 policies) | dropped in 0427000001 loop |
| `20260425500000_prestamos_rls_tighten.sql` | **FULLY SUPERSEDED** | `<tbl>_anon_select`/`_anon_modify` on prestamos surface | dropped in 0427000001 loop |
| `20260427000001_per_license_jwt_lockdown.sql` | **BODY SUPERSEDED** | `<tbl>_jwt_select`/`_jwt_modify` w/ `user_metadata` claim | live policies use `app_metadata` (out-of-band rewrite) |
| **LIVE** | LIVE | `<tbl>_jwt_select`, `<tbl>_jwt_modify` reading `app_metadata.business_id` | — |

### 2.4 RLS policies — accounting_* tables

| Migration | Status | What was created | Replaced by |
|---|---|---|---|
| (added later via accounting-firm migrations not shown in repo, or out-of-band) | LIVE | `p_acc_*_select` / `p_acc_*_write` policies on every `accounting_*` table | — |

NOTE: `accounting_clients` carries a `shared_business_id`/`access_granted` pattern used by `has_accountant_access()` (LIVE function). Some of these tables and policies have NO corresponding migration file in the audited folder — they were likely added via Studio plus management API. **Treat as out-of-band; only pg_catalog is truth.**

### 2.5 Carve-out tables — `my_business_ids()` policies still LIVE

These are carved out of `20260429000700` and still rely on `my_business_ids()`:

| Table | Policy(ies) using `my_business_ids` | Created by |
|---|---|---|
| `businesses` | `businesses_select`, `businesses_insert`, `businesses_update`, `businesses_delete`, `rls_businesses_delete_auth` | 20260301000000 + 20260420000016 |
| `licenses` | `licenses_select`, `licenses_update` | 20260323000000 |
| `license_events` | `license_events_*` | 20260323000000 |
| `license_rebind_requests` | `license_rebind_requests_service_role_all` (does not actually use my_business_ids) | 20260420600000 |
| `support_tickets` | `support_tickets_sel_auth` | 20260412000000 |
| `plans` | `plans_select` | 20260323000000 |
| `signup_provisional` | (table not in pg_tables snapshot today) | n/a |
| `rnc_cache` | `rnc_cache_*` | early |
| `*_public_*` carve-outs (pawn_listings/items/documents) | LIVE | 20260426000003 |
| `firm_memberships` | `firm_memberships_select` | accounting firm pack |

Plus: 161 total policies still reference `my_business_ids()`. Many are the **insert** policies named `<tbl>_ins_auth` and `<tbl>_ins`/`<tbl>_insert` that 0429000700 didn't touch (it only dropped policies whose USING clause matched the pattern, but JWT siblings were named `_jwt_select` + `_jwt_modify`, never `_ins_auth`). The `_ins_auth` family thus survives **alongside** the JWT pair on most tables — visible in §1's policy list as both `tickets_ins_auth` AND `tickets_jwt_insert` for example.

### 2.6 Function: `my_business_ids()`

| Migration | Status | Body |
|---|---|---|
| `20260301000000_initial.sql` | SUPERSEDED-IN-PLACE | early version |
| `20260301000001_upgrade_existing.sql` | SUPERSEDED-IN-PLACE | adjusted |
| **LIVE** | LIVE | `SELECT id FROM businesses WHERE owner_id=auth.uid() UNION SELECT business_id FROM staff WHERE auth_user_id=auth.uid() AND active=true` (SECURITY DEFINER, STABLE) |

The body matches one of the historical CREATE OR REPLACE statements but was never given a dedicated migration in this repo — verify the body via §3.6, not the migration files.

### 2.7 Function: `validate_ticket_prices(uuid, jsonb)`

| Migration | Status | Body |
|---|---|---|
| (no dedicated migration in audited folder) | LIVE | Loops `p_items`, validates `services.price` and `inventory_items.price` within 0.01. Returns `{valid, errors}`. Does **NOT** account for ofertas, client-specific pricing, or credit-mode flags — known semantic gap, separate from the supersession question. |

This RPC was added out-of-band. **Only the live body is truth.**

### 2.8 Function: `atomic_next_ncf(uuid, text)`

| Migration | Status | Body |
|---|---|---|
| (no dedicated migration in audited folder) | **LIVE BUT FUNCTIONALLY DRIFTED** | Pads with `lpad(next_num::text, 8, '0')` — correct ONLY for legacy B-series. E-series e-CFs require 10-digit padding, derived from `services.no_commission`/length-by-prefix. Gates on `business_uuid NOT IN (SELECT my_business_ids())` — will reject service-role JWT-only callers that don't satisfy `my_business_ids()`. **Web e-CF flow does not call this RPC** (`web/lib/*` rolls its own NCF allocation off `ncf_sequences`); desktop sync does not call it either. The function is effectively dead code today, but if any future caller picks it up for E-series it WILL produce malformed eNCF. Recommend either deletion or a v2 migration that does prefix-aware padding. |

### 2.9 Function: `sync_merge_upsert(text, jsonb, uuid, bool, text)`

| Migration | Status | Body |
|---|---|---|
| (added out-of-band as part of v2.16.8 PG17 optimization sprint per CLAUDE.md) | LIVE | Server-side bulk upsert behind `sync_use_merge_v17` flag. Allowlist of 75+ tables, natural-key allowlist for `ncf_sequences/app_settings/aseguradoras/suppliers/carniceria_scales/recurring_orders/promotions`. Uses `MERGE ... merge_action()` (PG17). |

### 2.10 Function: `has_accountant_access(uuid)`

| Migration | Status | Body |
|---|---|---|
| (no dedicated migration in audited folder) | LIVE | Reads `request.jwt.claims->>'business_id'`, joins `accounting_clients`, returns boolean. Used by `p_*_select_accountant` policies on `tickets`, `ticket_items`, `clients`, `services`, `inventory_items`, `compras_607`. |

### 2.11 Functions: `resolve_user_business_id(uuid)`, `sync_user_business_metadata(uuid)`, `tg_business_sync_owner_metadata()`, `tg_staff_sync_user_metadata()`

| Migration | Status |
|---|---|
| `20260429000000_jwt_business_id_backfill.sql` | LIVE — body matches file |

### 2.12 Realtime publication membership (`supabase_realtime`)

| Migration | Status | Effect |
|---|---|---|
| `20260420000000_inventory_counts.sql` | partial-superseded | added `inventory_counts` (NOT in live publication today) |
| `20260429000100_realtime_publication_trim.sql` | SUPERSEDED | reduced to 5 tables |
| `20260429000200_realtime_publication_restore.sql` | LIVE | restored 19 tables |

LIVE membership (24 tables) — exactly: `caja_chica, cajero_commissions, categorias_servicio, clients, compras_607, credit_payments, cuadre_caja, empleados, inventory_items, inventory_transactions, kds_events, mesas, ncf_sequences, notas_credito, payroll_runs, queue, salary_changes, seller_commissions, services, staff, ticket_items, ticket_locks, tickets, washer_commissions`.

### 2.13 Triggers — `tickets`

All LIVE today:
- `trg_tickets_complete_appointment` (AFTER INSERT/UPDATE → `trg_ticket_complete_appointment()`)
- `trg_tickets_credit_balance` (AFTER INSERT → `trg_credit_ticket_bump_balance()`)
- `trg_tickets_rev_guard` (BEFORE UPDATE → `trg_tickets_rev_guard()`) — from `20260420000001`
- `trg_tickets_touch_updated_at` (BEFORE UPDATE → `trg_touch_updated_at()`)
- `trg_tickets_updated_at` (BEFORE UPDATE → `trg_set_updated_at()`)
- `trg_tickets_updated_at_insert` (BEFORE INSERT → `trg_set_updated_at_insert()`)

Note: TWO updated_at triggers on tickets (`trg_tickets_touch_updated_at` AND `trg_tickets_updated_at`) — they run in alphabetical order and idempotently set `updated_at = now()`. Cosmetic redundancy, not a bug, but candidate for cleanup.

### 2.14 Triggers — `staff`

LIVE: `staff_sync_user_metadata` (AFTER INSERT/UPDATE → `tg_staff_sync_user_metadata()`) — from 0429000000. Plus the standard updated_at trio (`trg_staff_touch_updated_at`, `trg_staff_updated`, `trg_staff_updated_at`) — all three live; same triple-redundancy pattern.

### 2.15 Triggers — `app_settings`, `clients`, `inventory_items`, `ncf_sequences`, `queue`, `services`, `ticket_items`, `activity_log_legacy_unpartitioned`

Same pattern as tickets — multiple BEFORE UPDATE triggers from different migration eras (`trg_set_updated_at`, `trg_touch_updated_at`, `update_updated_at`, etc.) that all do the same job. None malfunction; all LIVE.

### 2.16 Triggers — `activity_log` (partition root)

LIVE:
- `trg_activity_log_immutable_del` (BEFORE DELETE → `trg_activity_log_immutable()`)
- `trg_activity_log_immutable_upd` (BEFORE UPDATE → `trg_activity_log_immutable()`)

Both block DML — write-once audit trail enforced. From `20260420500000_activity_log_immutable.sql`.

### 2.17 Trigger — `trg_ticket_items_decrement_inventory`

LIVE on `ticket_items` AFTER INSERT. Server-side stock decrement. From the v2.16.25 server-side side-effects sprint per release notes (no dedicated audited migration file — added out-of-band).

---

## §3. Live State Verification Queries (paste-ready)

### §3.1 RLS policy bodies on tickets

```sql
SELECT policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname='public' AND tablename='tickets'
 ORDER BY policyname;
```

Captured 2026-05-01:

```
p_tickets_select_accountant | SELECT | (business_id IS NOT NULL) AND has_accountant_access(business_id)
tickets_ins_auth            | INSERT | with_check = (business_id IN (SELECT my_business_ids()))
tickets_jwt_insert          | INSERT | with_check = (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
tickets_jwt_modify          | ALL    | (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
tickets_jwt_select          | SELECT | (business_id = NULLIF(((auth.jwt() -> 'app_metadata') ->> 'business_id'),'')::uuid) OR (business_id IN (SELECT my_business_ids()))
```

### §3.2 user_metadata vs app_metadata distribution

```sql
SELECT
  count(*) FILTER (WHERE qual ILIKE '%user_metadata%' OR with_check ILIKE '%user_metadata%') AS uses_user_metadata,
  count(*) FILTER (WHERE qual ILIKE '%app_metadata%'  OR with_check ILIKE '%app_metadata%')  AS uses_app_metadata
FROM pg_policies
WHERE schemaname='public';
```

Captured 2026-05-01: `[{"uses_user_metadata":0,"uses_app_metadata":202}]`

### §3.3 my_business_ids() residual usage

```sql
SELECT count(*) FROM pg_policies
 WHERE schemaname='public'
   AND (qual ILIKE '%my_business_ids%' OR with_check ILIKE '%my_business_ids%');
```

Captured 2026-05-01: `161`. Sample policies (insert family + carve-outs):

```sql
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname='public'
   AND (qual ILIKE '%my_business_ids%' OR with_check ILIKE '%my_business_ids%')
 ORDER BY tablename, policyname;
```

### §3.4 my_business_ids body

```sql
SELECT pg_get_functiondef('public.my_business_ids()'::regprocedure);
```

Captured 2026-05-01:

```
SELECT id FROM businesses WHERE owner_id = auth.uid()
UNION
SELECT business_id FROM staff WHERE auth_user_id = auth.uid() AND active = true
```

### §3.5 atomic_next_ncf body

```sql
SELECT pg_get_functiondef('public.atomic_next_ncf(uuid, text)'::regprocedure);
```

Captured 2026-05-01: pads to **8 digits** (`lpad(next_num::text, 8, '0')`). Gates on `business_uuid NOT IN (SELECT my_business_ids())`. **Drift confirmed.**

### §3.6 sync_merge_upsert allowlist

```sql
SELECT pg_get_functiondef('public.sync_merge_upsert(text, jsonb, uuid, boolean, text)'::regprocedure);
```

Captured 2026-05-01: 75-entry allowlist; natural-key allowlist for `ncf_sequences/app_settings/aseguradoras/suppliers/carniceria_scales/recurring_orders/promotions`.

### §3.7 Realtime publication members

```sql
SELECT tablename FROM pg_publication_tables
 WHERE pubname='supabase_realtime' AND schemaname='public'
 ORDER BY tablename;
```

Captured 2026-05-01: 24 rows (listed in §2.12).

### §3.8 Triggers on hot tables

```sql
SELECT trigger_name, event_object_table, action_timing, event_manipulation, action_statement
  FROM information_schema.triggers
 WHERE trigger_schema='public'
   AND event_object_table IN ('tickets','ticket_items','activity_log','app_settings','staff','clients','queue','services','ncf_sequences','inventory_items')
 ORDER BY event_object_table, trigger_name;
```

Captured 2026-05-01: see §2.13–§2.16 for the full list.

### §3.9 `tickets` columns

```sql
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='tickets'
 ORDER BY ordinal_position;
```

69 columns LIVE. Highlights for sync correctness: `id uuid NOT NULL`, `business_id uuid NOT NULL`, `supabase_id uuid NOT NULL`, `updated_at timestamptz NOT NULL`, `rev integer NOT NULL`, `is_test boolean NOT NULL`. Plus dual-key FKs: `client_supabase_id`, `seller_supabase_id`, `cajero_supabase_id`, `mesa_supabase_id`, `appointment_supabase_id`, `project_supabase_id`, `converted_from_mesa_supabase_id`, `converted_from_ticket_supabase_id`. Legacy integer-FK columns (`local_id`, `local_client_id`, `local_seller_id`, `local_cajero_id`, `project_id bigint`, `converted_from_mesa_id bigint`, `converted_from_ticket_id bigint`) STILL EXIST in cloud schema — they are kept for desktop-side sync compatibility but should never be used by web code.

### §3.10 JWT business_id maintenance triggers

```sql
SELECT trigger_name, event_object_table, action_timing, event_manipulation, action_statement
  FROM information_schema.triggers
 WHERE trigger_schema='public'
   AND trigger_name IN ('businesses_sync_owner_metadata','staff_sync_user_metadata');
```

Both LIVE — they call `sync_user_business_metadata()` to maintain `auth.users.raw_app_meta_data.business_id`. This is what makes the LIVE `app_metadata.business_id` claim work.

---

## §4. "Do Not Trust" List — Migration Files Whose Bodies Lie About Deployed State

When chasing an RLS / function bug, **do not** read these files and assume their body is what's deployed. Always run a verify query from §3 first.

| File | Why you cannot trust it | Verify with |
|---|---|---|
| `20260427000001_per_license_jwt_lockdown.sql` | Bodies say `user_metadata` — LIVE bodies say `app_metadata`. Out-of-band rewrite. | §3.1, §3.2 |
| `20260427100002_staff_jwt_lockdown.sql` | Same `user_metadata` → `app_metadata` rewrite for staff. | §3.1 (run for `staff`) |
| `20260428200000_rls_three_table_fix.sql` | Bodies updated out-of-band to `app_metadata`. | §3.1 (per table) |
| `20260421500000_restore_anon_sync_policies.sql` | Every `rls_anon_sync_*` policy it created was DROPPED by the loop in 0427000001. | `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname ILIKE 'rls_anon_sync_%';` should return 0. |
| `20260425500000_prestamos_rls_tighten.sql` | Same — `<tbl>_anon_select`/`_anon_modify` on prestamos all dropped. | `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE '%_anon_select' OR policyname LIKE '%_anon_modify';` |
| `20260301000000_initial.sql` | Original per-table policies via `my_business_ids()` — most were dropped, the rest were renamed. | §3.1 / §3.3 |
| `20260417000001_v21_schema_consolidation.sql` | Same — re-asserted `my_business_ids` shape that's now mostly gone. | §3.3 |
| `20260417000002_v21_rls_cleanup.sql` | Same. | §3.3 |
| `20260418200000_activity_log_rls_policies.sql` | Replaced by `activity_log_jwt_*` (LIVE body uses `app_metadata`). | §3.1 (for `activity_log`) |
| `20260419200000_sprint5_rls_hardening.sql` | All `*_sel`/`*_ins`/`*_upd`/`*_del` via `my_business_ids` replaced. | §3.3 |
| `20260420000000_inventory_counts.sql` (the publication-add inside) | Realtime publication was rewritten by 0429000100 + 0429000200. | §3.7 |
| `20260429000100_realtime_publication_trim.sql` | Drop list was reverted by next migration. | §3.7 |
| `atomic_next_ncf` (any reference in any migration) | Body is functionally drifted — pads to 8 not prefix-aware. | §3.5 |

---

## §5. Cleanup Recommendations

### 5a) Squash candidates (consolidate into a v3 baseline)

Group these into a single `20260501000000_v22_baseline.sql` (or whatever the next release tag is) that captures the LIVE schema + LIVE policy bodies in one file. They are all SUPERSEDED and create noise during incident triage:

- `20260301000000_initial.sql`
- `20260301000001_upgrade_existing.sql`
- `20260417000001_v21_schema_consolidation.sql`
- `20260417000002_v21_rls_cleanup.sql`
- `20260418200000_activity_log_rls_policies.sql`
- `20260419200000_sprint5_rls_hardening.sql`
- `20260421500000_restore_anon_sync_policies.sql` (FULLY SUPERSEDED)
- `20260425500000_prestamos_rls_tighten.sql` (FULLY SUPERSEDED)
- `20260427000001_per_license_jwt_lockdown.sql` (BODY SUPERSEDED — keep the structural pieces, replace policy bodies)
- `20260427100002_staff_jwt_lockdown.sql` (BODY SUPERSEDED)
- `20260428200000_rls_three_table_fix.sql` (BODY SUPERSEDED)
- `20260429000100_realtime_publication_trim.sql` + `20260429000200_realtime_publication_restore.sql` (collapse the trim+restore into one ADD/DROP that produces today's 24-table publication)

### 5b) Add SUPERSEDED header to (cheap, do this first)

If §5a is not in scope, add a one-line comment at the top of every file in the §4 "Do Not Trust" list:

```sql
-- SUPERSEDED: this file's policy/function bodies do NOT match deployed state.
-- See docs/MIGRATION-AUDIT-2026-05-01.md §4 and verify with pg_catalog before
-- making changes based on this file.
```

This is a 10-minute job and prevents the next agent from making the same mistake.

### 5c) Commit the out-of-band rewrite

There is a missing migration in the repo that took every `_jwt_select`/`_jwt_modify` policy body from `user_metadata` to `app_metadata`. This was almost certainly a script run via Management API around 2026-04-29 (same day as `20260429000000_jwt_business_id_backfill.sql`, which ASSUMES `app_metadata.business_id` is the claim). Author the missing migration retroactively as `20260429000050_jwt_metadata_path_swap.sql` — generate it from pg_catalog so it matches deployed state exactly. Mark it as `-- BACKFILLED 2026-05-01: documents the out-of-band rewrite from <date>.`

### 5d) Fix `atomic_next_ncf` (functional, not just cosmetic)

Either:
- (a) DROP it. It has no live caller in `electron/` or `web/`. Removing it eliminates a footgun.
- (b) Rewrite to prefix-aware padding:
  - Length 8 if prefix starts with `B`.
  - Length 10 if prefix starts with `E`.
  - Pull the prefix from `ncf_sequences.prefix` (already FOR-UPDATE'd in the body).
  - Drop the `business_uuid NOT IN (SELECT my_business_ids())` gate; replace with `current_setting('request.jwt.claims', true)::jsonb->>'business_id' = business_uuid::text` for service-role + JWT compatibility.

### 5e) Leave alone (purely additive, still LIVE)

All of these are clean additive migrations — keep as-is, no header, no squash:

- All `*_supabase_id` column-add migrations.
- All UNIQUE constraint migrations (`20260429000300`–`20260429000600`).
- All index migrations (`20260429000800`, `20260429000900`).
- `20260429000000_jwt_business_id_backfill.sql` — this is the canonical record of `app_metadata.business_id` maintenance and matches LIVE state.
- `20260429000700_drop_legacy_my_business_ids_policies.sql` — accurate record of the partial legacy sweep.
- `20260420500000_activity_log_immutable.sql`, `20260420000001_tickets_rev_guard.sql`, `20260428000000_activity_log_monthly_partition.sql`, `20260425000000_app_settings_updated_at_lww.sql` — all body-LIVE.
- `20260430000000_ecf_submissions_dgii_status.sql` — most recent, LIVE.

### 5f) Process fix going forward

Add a CI check (or a hook in `scripts/audit-flows.mjs`) that runs:

```sql
-- expected: zero rows
SELECT policyname, qual FROM pg_policies
 WHERE schemaname='public'
   AND (qual ILIKE '%user_metadata%' OR with_check ILIKE '%user_metadata%');
```

If it returns rows, fail the release gate. Same gate for any policy body or function body that diverges from the latest migration in the repo (golden-diff style). This is the same pattern CLAUDE.md already mandates for the parallel XML generators (`tools/cert-step4` vs `electron/xml-builder.js`) — extend it to RLS.

---

## Appendix A — Counts at a Glance (2026-05-01)

| Metric | Value |
|---|---|
| Migration files in repo | 108 |
| Total RLS policies on `public.*` | 408 |
| Policies referencing `user_metadata` | 0 |
| Policies referencing `app_metadata` | 202 |
| Policies still referencing `my_business_ids()` | 161 |
| Tables with RLS enabled (sampled) | 180+ |
| Realtime publication members | 24 |
| Tables in `sync_merge_upsert` allowlist | 75 |
| Triggers on hot tables (tickets/ticket_items/activity_log/etc) | as listed in §2.13–§2.17 |

---

## Appendix B — Quick "is this migration text trustworthy" decision tree

```
You're reading a migration file in supabase/migrations/.

Does it CREATE or DROP a POLICY?
├── YES → check §4. If listed → run the §3 verify query for that table BEFORE trusting the body.
│         Otherwise → still cross-check with pg_policies; out-of-band rewrites exist.
└── NO → does it CREATE OR REPLACE a FUNCTION?
        ├── YES → atomic_next_ncf, validate_ticket_prices, sync_merge_upsert, has_accountant_access
        │        → ALWAYS run pg_get_functiondef. The repo body may be stale.
        │        → my_business_ids → repo body matches LIVE.
        └── NO → does it ALTER PUBLICATION supabase_realtime?
                ├── YES → publication was rewritten 2026-04-29; run §3.7.
                └── NO → likely safe to trust (column add, index, constraint, table create).
```

---

End of audit.
