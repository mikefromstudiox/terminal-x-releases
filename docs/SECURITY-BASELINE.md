# Terminal X — Security Baseline (snapshot 2026-04-30)

**Frozen state** — captured BEFORE any further fix batches land. Use this to verify no regression in security posture during ongoing audit work.

## Headline numbers

| Metric | Count |
|---|---|
| Tables in `public` schema | 180 |
| Tables with RLS enabled | 180 |
| RLS policies total | 408 |
| Realtime publication tables | 24 |
| Helper functions (RLS-related) | 1 (`my_business_ids`) |
| Role grants on public schema | 3683 |
| Tables RLS-enabled with ZERO policies | 31 (all are `activity_log_p_*` partitions — inherit from parent) |

Full machine-readable dump: `docs/SECURITY-SNAPSHOT-2026-04-30.json` (every policy, every grant, every realtime subscription).

## Canonical RLS policy patterns (DO NOT change without explicit approval)

Two valid patterns coexist in production. Both are acceptable. **Do not invent a third pattern** when adding new tables.

### Pattern 1 — JWT-claim-only (preferred for v2.16+)

```sql
CREATE POLICY <table>_jwt_modify ON public.<table>
  FOR ALL TO anon, authenticated
  USING (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
  WITH CHECK (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid);
```

Used by: `mesas`, `restaurant_reservations` (post 2026-04-30 fix), `service_recipe_items` (post 2026-04-30 fix), and most v2.16 tables.

### Pattern 2 — Legacy `my_business_ids()` helper (still active on some tables)

```sql
WITH CHECK (business_id IN (SELECT my_business_ids()))
```

Used by: `tickets_ins`, `app_settings_ins`, `cuadre_caja_ins`, `ecf_queue_ins`, `empleados_insert`, `inventory_items_ins`, `inventory_transactions_ins`, `kds_events_insert`, several `businesses_*` policies, and ~30 more.

**Status**: `my_business_ids()` was supposed to be dropped 2026-04-29 in favor of JWT-claim-only. Drop is INCOMPLETE — these tables still depend on the function. **Do not drop the helper** until every dependent policy is migrated.

## Sealed tenant leaks (changes already shipped 2026-04-30)

Two tables had anon SELECT/INSERT/UPDATE/DELETE with `business_id IS NOT NULL` predicate (matches every row → fully open):
- `restaurant_reservations` — sealed, replaced with Pattern 1.
- `service_recipe_items` — sealed, replaced with Pattern 1.

`scripts/rls-policy-audit.mjs` returns clean after these fixes.

## Remaining concerning anon/public INSERT policies (audit-flagged, NOT YET FIXED)

| Table | Policy | Predicate |
|---|---|---|
| `tickets` | `tickets_ins` | `{public}` qual=NULL with_check=`my_business_ids()` |
| `app_settings` | `app_settings_ins` | `{public}` qual=NULL with_check=`my_business_ids()` |
| `cuadre_caja` | `cuadre_caja_ins` | `{public}` qual=NULL with_check=`my_business_ids()` |
| `ecf_queue` | `ecf_queue_ins` | `{public}` qual=NULL with_check=`my_business_ids()` |
| `empleados` | `empleados_insert` | `{public}` qual=NULL with_check=`my_business_ids()` |
| `inventory_items` | `inventory_items_ins` | `{public}` qual=NULL with_check=`my_business_ids()` |
| `inventory_transactions` | `inventory_transactions_ins` | `{public}` qual=NULL with_check=`my_business_ids()` |
| `kds_events` | `kds_events_insert` | `{public}` qual=NULL with_check=`my_business_ids()` |
| `ecf_cert_history` | `ecf_cert_history_ins` | `{anon,authenticated}` with_check=`business_id IS NOT NULL` ⚠ |
| `insurance_batches` | `insurance_batches_anon_insert` | `{anon}` with_check=`business_id IS NOT NULL` ⚠ |
| `demo_sessions` | `anon_insert_only` | `{anon}` with_check=non-null length-bounded vertical (intentional, public funnel) |
| `marketing_leads` | `anon_insert_only` | `{anon}` with_check=email+source+length bounded (intentional, public funnel) |
| `businesses` | `businesses_select` / `businesses_update` / `businesses_delete` | `{public}` legacy `my_business_ids()` |

Two rows marked ⚠ are the same wide-open `business_id IS NOT NULL` shape that just got fixed on `restaurant_reservations` / `service_recipe_items`. These are next on the list.

## activity_log partition policy inheritance

`activity_log` parent (partitioned table) HAS policies. Postgres routes inserts through the parent → policies enforced. The 31 child partitions (`activity_log_p_YYYYMM`) showing 0 policies in `pg_policies` is expected behavior — they inherit from parent. **Do not add per-partition policies.**

## JWT claim contract

The web app expects every authenticated user's JWT to carry:

```json
{
  "app_metadata": {
    "business_id": "<uuid>",
    "role": "owner|manager|cfo|accountant|cashier|kitchen|none"
  }
}
```

Backfill triggers + JWT-claim setter live in Supabase auth hooks (see migration `20260429*_jwt_business_id_backfill.sql`). DO NOT touch `auth.users.raw_app_meta_data` directly without going through the documented setter. RLS policies that read `auth.jwt()->'app_metadata'->>'business_id'` rely on this contract.

## Realtime publication scope

`supabase_realtime` publication includes 24 tables. Earlier audit confirmed: each subscriber filters by `business_id=eq.<bid>`, no cross-tenant broadcast. Migration `20260429000100_realtime_publication_trim.sql` is the canonical scope. **Adding a table to the publication requires explicit approval.**

## Service-role usage

The following code paths MUST execute under service-role (bypass RLS) — never under anon or authenticated:
- Public booking submit (`web/api/panel.js?action=public_book`)
- License validate (`web/api/validate.js`)
- e-CF sign proxy (`web/api/ecf-sign.js`)
- Daily owner digest cron (`web/api/digest/daily.js`)
- ANECF drainer (desktop `electron/main.js processAnecfQueue`)

Service role key lives in Vercel env (`SUPABASE_SERVICE_ROLE_KEY`) and `.env` for local scripts. **Never hardcode. Never expose to client bundle.**

## Pre-change checklist (read before ANY RLS work)

1. Run `node scripts/rls-policy-audit.mjs` — must exit 0.
2. Compare current `pg_policies` count + grants count against `docs/SECURITY-SNAPSHOT-2026-04-30.json`. Drift > 5% requires ack.
3. Adding a table → use Pattern 1 (JWT-claim-only). Not Pattern 2.
4. Dropping a policy → confirm authenticated path still works (insert + select cycle through web.js).
5. Touching `my_business_ids()` → migrate all dependents in same change. The helper has a hard dep tree.
6. Touching `auth.jwt()` extraction → coordinate with `app_metadata.business_id` backfill trigger. Mismatched extraction shape silently denies all rows.
7. Adding to `supabase_realtime` publication → confirm no cross-tenant broadcast vector.

## Audit chain

```bash
node scripts/rls-policy-audit.mjs && \
node scripts/ranoza-e2e-smoke.mjs && \
node scripts/audit-flows.mjs
```

All three must exit 0 before release. The third (`audit-flows.mjs`, Tier 1 harness) is the silent-drop detector — locks payload→schema contracts.
