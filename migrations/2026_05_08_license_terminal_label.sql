-- Per-terminal license labels.
-- Each license row represents one POS terminal (a desktop install or a browser session).
-- The `label` column lets the owner name the terminal (e.g. "Caja 1", "iPad mostrador")
-- so admin can see at-a-glance which device was last seen and which keys belong to whom.

ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS label TEXT NULL;

COMMENT ON COLUMN public.licenses.label IS
  'Owner-supplied terminal label (e.g. "Caja 1"). Free-form, nullable. Per-terminal license model since 2026-05-08.';
