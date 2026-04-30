-- 2026_04_30 — close the "sync push retries leave silent duplicates" class
-- of bugs across all multi-tenant master-data tables.
--
-- Bug: when desktop sync push retried after a transient error, the same row
-- was INSERTed multiple times because there was no UNIQUE constraint to
-- dedupe at the natural key. Same root cause as the salary_changes mess —
-- except it could happen to ANY catalog: services, empleados, inventory
-- items, ofertas, modifiers, etc.
--
-- Fix: partial UNIQUE INDEX on the natural key for every master-data
-- table that has business_id + a clear natural key. Partial because many
-- of these natural keys are optional (cedula, sku, vin can be NULL or
-- empty); we only enforce uniqueness when the key is actually populated.
-- A row with NULL/empty key still inserts fine; two rows with the same
-- non-empty key for the same business get rejected by the unique index,
-- the desktop's UPSERT-on-conflict path takes over, and duplicates can
-- never accumulate.
--
-- Pre-flight: all listed tables had ZERO non-null duplicates at the time
-- this migration was written (verified by scripts/dupe-audit-targeted.mjs
-- on 2026-04-30). If you ship this on a different env that has dupes, the
-- CREATE INDEX will fail — dedupe first, then re-run.
--
-- PostgREST treats partial unique indexes as valid `on_conflict` targets
-- ONLY in PostgreSQL 15+. This project is on PG 17, so all good.

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_name
  ON services (business_id, name)
  WHERE name IS NOT NULL AND name <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_cedula
  ON empleados (business_id, cedula)
  WHERE cedula IS NOT NULL AND cedula <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_sku
  ON inventory_items (business_id, sku)
  WHERE sku IS NOT NULL AND sku <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_promotions_name
  ON promotions (business_id, name)
  WHERE name IS NOT NULL AND name <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_servicio_nombre
  ON categorias_servicio (business_id, nombre)
  WHERE nombre IS NOT NULL AND nombre <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_inventory_vin
  ON vehicle_inventory (business_id, vin)
  WHERE vin IS NOT NULL AND vin <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_mesas_name
  ON mesas (business_id, name)
  WHERE name IS NOT NULL AND name <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_aseguradoras_rnc
  ON aseguradoras (business_id, rnc)
  WHERE rnc IS NOT NULL AND rnc <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_rnc
  ON suppliers (business_id, rnc)
  WHERE rnc IS NOT NULL AND rnc <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_bays_name
  ON service_bays (business_id, name)
  WHERE name IS NOT NULL AND name <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_modifier_groups_name
  ON modifier_groups (business_id, name)
  WHERE name IS NOT NULL AND name <> '';
