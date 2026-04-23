-- v2.14 — Conteo Físico signature capture (Ranoza request 2026-04-22).
-- Cashier/manager signs on-screen at the end of the count; dataURL is
-- persisted on the count header and rendered in the variance PDF + the
-- completed detail view. Base64 PNG dataURLs are small (~5-15 KB typical).
ALTER TABLE public.inventory_counts
  ADD COLUMN IF NOT EXISTS signature_dataurl TEXT;
