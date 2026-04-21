-- M2 — categorias_servicio needs UNIQUE (business_id, LOWER(nombre)) so
-- concurrent pushes from two devices with the same category name collide on
-- the natural key instead of silently creating duplicates. pullUpsertRow's
-- natural-key healing then works deterministically.

-- Deduplicate any existing name collisions first (keep the oldest row per
-- biz/name pair). This is best-effort; collisions are rare.
WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY business_id, LOWER(nombre) ORDER BY created_at NULLS FIRST, id) AS rn
    FROM public.categorias_servicio
)
DELETE FROM public.categorias_servicio WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- Then add the constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.categorias_servicio'::regclass
       AND conname  = 'uq_categorias_servicio_biz_name_lower'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_categorias_servicio_biz_name_lower ON public.categorias_servicio (business_id, LOWER(nombre))';
  END IF;
END $$;
