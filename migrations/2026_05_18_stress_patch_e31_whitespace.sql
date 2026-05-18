-- 2026-05-18 Stress audit fiscal hazard — widen chk_e31_requires_rnc to reject
-- ALL whitespace (tab/newline/CR/vtab/NBSP), not just ASCII space.
-- Postgres TRIM(BOTH FROM x) defaults to stripping only U+0020, so E'\t' passed
-- the original check. Now uses `client_rnc !~ '\S'` (true if NO non-whitespace
-- char present) — covers tab, newline, NBSP, zero-width-space, etc.

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS chk_e31_requires_rnc;
ALTER TABLE tickets
  ADD CONSTRAINT chk_e31_requires_rnc
  CHECK (
    NOT (
      (ncf_type = 'E31' OR (ncf IS NOT NULL AND ncf LIKE 'E31%'))
      AND (client_rnc IS NULL OR client_rnc !~ '\S')
    )
  ) NOT VALID;
