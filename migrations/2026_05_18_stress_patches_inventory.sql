-- 2026-05-18 Stress audit follow-up patches.
-- 1) chk_inventory_name_not_blank widened — trim() only handles spaces, not tabs/newlines.
-- 2) deduct_inventory_atomic force-deduct now uses GREATEST(0, quantity - req_qty)
--    so it no longer collides with chk_inventory_quantity_nonneg on oversell paths.
--    Also skips ghost item lookups (unknown supabase_id no longer writes garbage oversells row).

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS chk_inventory_name_not_blank;
ALTER TABLE inventory_items ADD CONSTRAINT chk_inventory_name_not_blank
  CHECK (length(regexp_replace(coalesce(name,''), '\s', '', 'g')) > 0) NOT VALID;

CREATE OR REPLACE FUNCTION public.deduct_inventory_atomic(p_business_id uuid, p_ticket_supabase_id uuid, p_hwid text, p_items json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  it         JSONB;
  item_sid   UUID;
  req_qty    NUMERIC;
  item_nm    TEXT;
  post_qty   NUMERIC;
  pre_qty    NUMERIC;
  oversells  JSONB := '[]'::JSONB;
  exists_ct  INT;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business_id required';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items::JSONB) LOOP
    item_sid := (it->>'item_supabase_id')::UUID;
    req_qty  := (it->>'qty')::NUMERIC;
    item_nm  := it->>'name';

    SELECT COUNT(*) INTO exists_ct FROM inventory_items
      WHERE business_id = p_business_id AND supabase_id = item_sid;
    IF exists_ct = 0 THEN CONTINUE; END IF;

    UPDATE inventory_items
       SET quantity   = quantity - req_qty,
           updated_at = now()
     WHERE business_id = p_business_id
       AND supabase_id = item_sid
       AND quantity   >= req_qty
    RETURNING quantity INTO post_qty;

    IF NOT FOUND THEN
      SELECT quantity, COALESCE(item_nm, name)
        INTO pre_qty, item_nm
        FROM inventory_items
       WHERE business_id = p_business_id AND supabase_id = item_sid;

      UPDATE inventory_items
         SET quantity   = GREATEST(0, quantity - req_qty),
             updated_at = now()
       WHERE business_id = p_business_id
         AND supabase_id = item_sid
      RETURNING quantity INTO post_qty;

      INSERT INTO inventory_oversells(business_id, ticket_supabase_id, item_supabase_id,
                                      item_name, requested_qty, actual_qty)
      VALUES (p_business_id, p_ticket_supabase_id, item_sid,
              item_nm, req_qty, COALESCE(pre_qty, 0));

      oversells := oversells || jsonb_build_object(
        'item_supabase_id', item_sid,
        'item_name',        item_nm,
        'requested_qty',    req_qty,
        'actual_qty',       COALESCE(pre_qty, 0),
        'post_qty',         COALESCE(post_qty, 0)
      );
    END IF;
  END LOOP;

  RETURN json_build_object('ok', true, 'oversells', oversells);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END $function$;
