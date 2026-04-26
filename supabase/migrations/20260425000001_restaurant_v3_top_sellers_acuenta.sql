-- ────────────────────────────────────────────────────────────────────────────
-- v2.16.3 — Restaurant Mode v3
--   1. services.topSellers backend (RPC services_top_sellers)
--   2. mesa.active_ticket_total (view mesas_with_active_total)
--   3. "Pedir cuenta" workflow (mesas.bill_requested_at column + 'acuenta'
--      status documented as a valid value alongside libre/ocupada/sucia/reservada)
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. mesas.bill_requested_at ──────────────────────────────────────────────
-- Stamped when the customer asks for the check; cleared by the cobrar flow
-- (RestaurantPOS post-cobro cleanup passes bill_requested_at:null) and on any
-- transition into 'libre'. NULL semantically means "no bill requested".
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS bill_requested_at TIMESTAMPTZ;

-- ── 2. services_top_sellers RPC ─────────────────────────────────────────────
-- Aggregates ticket_items.quantity over the last p_since window for cobrado
-- (and any non-voided) tickets, joined back to services. Returns full service
-- rows in descending sales order so the UI can render them with the same
-- shape as services.all().
--
-- Joins on BOTH ticket_items.service_id (UUID FK, when present) AND
-- ticket_items.service_supabase_id — the dual-key pattern documented in
-- CLAUDE.md so web-created and desktop-synced rows both resolve.
--
-- Filters tickets.status: only count tickets that were actually sold. We
-- include 'cobrado' and any non-void status to be tolerant of restaurant
-- tickets that may sit in 'open'/'firing'/'ready' for the day, but explicitly
-- exclude 'voided'/'anulado'/'nula'.
CREATE OR REPLACE FUNCTION public.services_top_sellers(
  p_business_id UUID,
  p_since       TIMESTAMPTZ,
  p_limit       INT DEFAULT 8
)
RETURNS SETOF services
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT s.*
  FROM services s
  JOIN (
    SELECT
      COALESCE(ti.service_id::text, ti.service_supabase_id::text) AS svc_key,
      SUM(COALESCE(ti.quantity, 1)) AS total_qty
    FROM ticket_items ti
    JOIN tickets t ON t.id = ti.ticket_id
    WHERE t.business_id = p_business_id
      AND t.created_at  >= p_since
      AND t.status NOT IN ('voided','anulado','nula')
      AND (ti.service_id IS NOT NULL OR ti.service_supabase_id IS NOT NULL)
    GROUP BY 1
  ) agg ON agg.svc_key = COALESCE(s.id::text, s.supabase_id::text)
  WHERE s.business_id = p_business_id
    AND s.active = true
  ORDER BY agg.total_qty DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.services_top_sellers(UUID, TIMESTAMPTZ, INT)
  TO anon, authenticated, service_role;

-- ── 3. mesas_with_active_total view ─────────────────────────────────────────
-- Surfaces the open ticket's running total on each mesa row so idle ocupada
-- cards can render RD$ amounts without N+1 fetches. Open ticket = any ticket
-- whose mesa_supabase_id matches this mesa AND whose status is NOT one of
-- the terminal states (cobrado/voided/anulado/nula).
--
-- Total formula matches the live RestaurantPOS computation:
--     SUM( (price + sum(modifier price_delta)) * quantity )
-- modifier deltas are joined via ticket_item_modificadores (snapshot price,
-- not the live modificador price — same as the cobro path).
--
-- Views in Postgres inherit the base table's RLS (mesas), so anon clients
-- still see only their own business's mesas via the existing mesas_select
-- policy. No extra GRANT-side surface area opened.
CREATE OR REPLACE VIEW public.mesas_with_active_total AS
SELECT
  m.*,
  COALESCE((
    SELECT SUM(
      ( COALESCE(ti.price, 0)
        + COALESCE((
            SELECT SUM(tim.price_delta_snapshot)
            FROM ticket_item_modificadores tim
            WHERE tim.ticket_item_supabase_id = ti.supabase_id
          ), 0)
      ) * COALESCE(ti.quantity, 1)
    )
    FROM tickets t
    JOIN ticket_items ti ON ti.ticket_id = t.id
    WHERE t.business_id      = m.business_id
      AND t.mesa_supabase_id = m.supabase_id
      AND t.status NOT IN ('cobrado','voided','anulado','nula')
  ), 0)::NUMERIC(12,2) AS active_ticket_total
FROM mesas m;

GRANT SELECT ON public.mesas_with_active_total TO anon, authenticated, service_role;

-- ── Notes ───────────────────────────────────────────────────────────────────
-- mesas.status is a free-form TEXT column (no CHECK constraint) — 'acuenta'
-- is now a documented valid value alongside libre/ocupada/sucia/reservada.
-- No CHECK alteration needed. RLS policies on mesas already cover the new
-- column. The BEFORE UPDATE updated_at trigger already fires on any column
-- change including bill_requested_at.
