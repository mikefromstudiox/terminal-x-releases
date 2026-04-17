-- Terminal X v2.0.0 — Supabase data repair migration
-- Written: 2026-04-16
-- Source: docs/CONSOLIDATED-FIX-PLAN.md Phase 4
--
-- One-time repair of the damage caused by F4 (stringified JSONB) and the staff
-- identity-aliasing bug. Idempotent. Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Unescape stringified settings on poisoned businesses.
--    settings column is JSONB but was written with a JSON-encoded string,
--    so ((settings)::text)::jsonb re-decodes it back to an object.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE businesses
   SET settings   = (settings #>> '{}')::jsonb,
       updated_at = now()
 WHERE jsonb_typeof(settings) = 'string';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Collapse empleados duplicates per (business_id, nombre).
--    Keep row with ref_id populated, else oldest.
-- ─────────────────────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, nombre
           ORDER BY (ref_id IS NOT NULL) DESC, created_at ASC
         ) AS rn
  FROM empleados WHERE active = true
)
UPDATE empleados
   SET active = false,
       updated_at = now()
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Collapse categorias_servicio duplicates per (business_id, nombre).
-- ─────────────────────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, nombre
           ORDER BY created_at ASC
         ) AS rn
  FROM categorias_servicio WHERE active = true
)
UPDATE categorias_servicio
   SET active = false,
       updated_at = now()
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Set Michael Mejia pin_hash = SHA256('0714') for Studio X Auto Detailing.
--    Verified: node -e "crypto.createHash('sha256').update('0714').digest('hex')"
--    = 35a1df2b4b04518c917ed5730e8f1e9660ceee308b1f7f8f85f0207724f3de87
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE staff
   SET pin_hash   = '35a1df2b4b04518c917ed5730e8f1e9660ceee308b1f7f8f85f0207724f3de87',
       updated_at = now()
 WHERE business_id = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
   AND username    = 'michael'
   AND active      = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Set Enrique Soliman pin_hash = SHA256('0715') for Studio X Auto Detailing.
--    Verified externally: 4030c42b313a82b953d14f04a85ff9dd9739e49a97d90631b7fb3029cca1d6e1
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE staff
   SET pin_hash   = '4030c42b313a82b953d14f04a85ff9dd9739e49a97d90631b7fb3029cca1d6e1',
       updated_at = now()
 WHERE business_id = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
   AND username    = 'esoliman'
   AND active      = true;
