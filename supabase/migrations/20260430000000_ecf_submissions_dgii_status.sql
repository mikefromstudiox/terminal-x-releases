-- ════════════════════════════════════════════════════════════════════════════
-- 20260430000000_ecf_submissions_dgii_status.sql
--
-- Brings the cloud public.ecf_submissions in line with the desktop SQLite
-- schema so the web parent-acceptance gate (web/api/ecf-sign.js) can read
-- the same numeric DGII verdict the desktop already tracks.
--
-- Adds:
--   dgii_status      INTEGER  (1=ACEPTADO, 2=RECHAZADO, 3=EN_PROCESO,
--                              4=ACEPTADO_CONDICIONAL)
--   dgii_message     TEXT
--   xml_hash         TEXT
--   security_code    TEXT
--   signature_date   TEXT
--   xml_path         TEXT
--   confirmed_at     TIMESTAMPTZ
--
-- Backfills dgii_status from the legacy text `status` column where possible.
-- Adds (business_id, encf) index for the parent-acceptance lookup hotpath.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ecf_submissions ADD COLUMN IF NOT EXISTS dgii_status    INTEGER;
ALTER TABLE public.ecf_submissions ADD COLUMN IF NOT EXISTS dgii_message   TEXT;
ALTER TABLE public.ecf_submissions ADD COLUMN IF NOT EXISTS xml_hash       TEXT;
ALTER TABLE public.ecf_submissions ADD COLUMN IF NOT EXISTS security_code  TEXT;
ALTER TABLE public.ecf_submissions ADD COLUMN IF NOT EXISTS signature_date TEXT;
ALTER TABLE public.ecf_submissions ADD COLUMN IF NOT EXISTS xml_path       TEXT;
ALTER TABLE public.ecf_submissions ADD COLUMN IF NOT EXISTS confirmed_at   TIMESTAMPTZ;

-- Backfill: best-effort map of existing text status into the integer code.
-- Unknown / null statuses become EN_PROCESO (3) so the parent gate still
-- waits for a real verdict instead of silently passing.
UPDATE public.ecf_submissions
   SET dgii_status =
     CASE LOWER(COALESCE(status, ''))
       WHEN 'aceptado'             THEN 1
       WHEN 'aceptado_condicional' THEN 4
       WHEN 'rechazado'            THEN 2
       WHEN 'en_proceso'           THEN 3
       WHEN 'pendiente'            THEN 3
       ELSE 3
     END
 WHERE dgii_status IS NULL;

-- Hot path index: parent-acceptance lookup by (business_id, encf) — runs
-- on every NC submission (E33/E34) on the web POS.
CREATE INDEX IF NOT EXISTS idx_ecf_submissions_biz_encf
  ON public.ecf_submissions (business_id, encf);

-- BRIN on submitted_at for time-windowed reports / EN_PROCESO reconciler.
CREATE INDEX IF NOT EXISTS idx_ecf_submissions_submitted_brin
  ON public.ecf_submissions USING BRIN (submitted_at) WITH (pages_per_range = 32);
