-- 2026_05_19_deferred_unique_constraints.sql
-- Finding #2 follow-up from inaugural schema-suite run (commit 161be32).
-- 5 tables were deferred because their natural-key shape needed product
-- decisions + the suite was guessing wrong column names.
--
-- Pre-flight verification (run before this migration, via Management API):
--   modificadores:    0 dupes on (business_id, modifier_group_supabase_id, name) AND on (business_id, name, group_name)
--   service_packages: 0 rows total (per-purchase table, no natural-key dedup expected)
--   wash_combos:      0 rows total (per-purchase table, no natural-key dedup expected)
--   memberships:      0 dupes on (business_id, plan_name) WHERE active_template=true
--                     0 dupes on (business_id, client_supabase_id, plan_name) WHERE status='active'
--   recurring_orders: 0 dupes on (business_id, client_supabase_id, nombre)
-- All verified 2026-05-19 against pg_catalog. Safe to apply.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1) modificadores — NO-OP. Already covered by `uq_modificadores_natural`
--    UNIQUE INDEX on (business_id, name, group_name), shipped earlier.
--
--    Spec said the natural key should include `modifier_group_supabase_id`
--    instead of `group_name`. They are equivalent in practice: every
--    modifier row carries both columns and group_name was the original
--    pre-FK shape; a modifier never moves between groups. Live data has
--    0 dupes on EITHER (biz, name, group_name) OR (biz, name,
--    modifier_group_supabase_id). Adding a second redundant index would
--    just cost INSERT throughput. Leaving as-is.
-- ──────────────────────────────────────────────────────────────────────────

-- (intentional no-op for modificadores)


-- ──────────────────────────────────────────────────────────────────────────
-- 2) service_packages — SKIPPED.
--
--    Per-client PURCHASE record (10-wash package, 5-detail package, etc.).
--    A client can legitimately purchase the same package_name multiple
--    times — once their first 10-wash bundle runs out they buy another
--    "Combo 10 Lavados Básicos". No (biz, client, package_name) natural
--    key exists because successive purchases of the same package by the
--    same client are legal and expected.
--
--    Adding `purchased_at` to the key would only catch the impossible
--    "two purchases in the same instant" case — not worth an index. The
--    PK + (business_id, supabase_id) UNIQUE already prevent the sync-dup
--    failure mode. No constraint added.
-- ──────────────────────────────────────────────────────────────────────────

-- (intentional skip for service_packages)


-- ──────────────────────────────────────────────────────────────────────────
-- 3) wash_combos — SKIPPED.
--
--    Same shape as service_packages — per-client purchase, repeat
--    purchases of the same `combo_name` by the same client are legal
--    (and the expected revenue model for carwash combos). No natural
--    key beyond (business_id, supabase_id) which already exists. No
--    constraint added.
-- ──────────────────────────────────────────────────────────────────────────

-- (intentional skip for wash_combos)


-- ──────────────────────────────────────────────────────────────────────────
-- 4) memberships — TWO PARTIAL UNIQUE INDEXES.
--
--    The table conflates two concepts (legacy):
--      (a) TEMPLATES — `active_template=true`, `client_supabase_id IS NULL`,
--          define the catalogue of available membership plans for a
--          business. Naturally unique on (business_id, plan_name)
--          while the template is active.
--      (b) CLIENT MEMBERSHIPS — actual purchased/granted memberships
--          tied to a client. Same client may have past+present
--          memberships under the same plan; only ONE active membership
--          per (client, plan_name) at a time is allowed.
--
--    Both are enforced via PARTIAL unique indexes so historic / archived
--    rows do not collide with new ones.
-- ──────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_template_natural
  ON public.memberships (business_id, plan_name)
  WHERE active_template = true AND client_supabase_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_active_client_plan
  ON public.memberships (business_id, client_supabase_id, plan_name)
  WHERE status = 'active' AND client_supabase_id IS NOT NULL;


-- ──────────────────────────────────────────────────────────────────────────
-- 5) recurring_orders — clean UNIQUE constraint.
--
--    Per-client named pedido (e.g. "Pedido típico martes"). A client
--    can have multiple distinct named recurring orders but the same
--    `nombre` should not repeat for the same client. All three columns
--    are NOT NULL in live schema so a regular UNIQUE constraint works.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.recurring_orders
  ADD CONSTRAINT uq_recurring_orders_biz_client_nombre
  UNIQUE (business_id, client_supabase_id, nombre);

COMMIT;
