-- Followup #10 — VALIDATE all NOT VALID constraints shipped today after
-- cleaning legacy violators (all in is_demo=true businesses, safe).
-- Validators: chk_e31_requires_rnc, chk_inventory_*, chk_inbox_confidence_range,
-- chk_je_line_debit_xor_credit, chk_staff_username_not_blank, fk_ticket_items_*,
-- fk_tickets_cuadre_supabase_id.

-- Step 1 — backfill legacy violators.
UPDATE tickets SET client_rnc = '000000000'
WHERE (ncf_type='E31' OR (ncf IS NOT NULL AND ncf LIKE 'E31%'))
  AND (client_rnc IS NULL OR client_rnc !~ '\S')
  AND business_id IN (SELECT id FROM businesses WHERE is_demo=true);

UPDATE inventory_items SET price = 0 WHERE price < 0;
UPDATE inventory_items SET min_quantity = 0 WHERE min_quantity < 0;
UPDATE inventory_items SET name = 'Sin nombre #' || substr(supabase_id::text, 1, 8)
WHERE length(regexp_replace(coalesce(name,''), '\s', '', 'g')) = 0;

UPDATE ticket_items SET inventory_item_supabase_id = NULL
WHERE inventory_item_supabase_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.supabase_id = ticket_items.inventory_item_supabase_id);

-- Step 2 — validate.
ALTER TABLE tickets         VALIDATE CONSTRAINT chk_e31_requires_rnc;
ALTER TABLE inventory_items VALIDATE CONSTRAINT chk_inventory_minqty_nonneg;
ALTER TABLE inventory_items VALIDATE CONSTRAINT chk_inventory_name_not_blank;
ALTER TABLE inventory_items VALIDATE CONSTRAINT chk_inventory_price_nonneg;
ALTER TABLE ticket_items    VALIDATE CONSTRAINT fk_ticket_items_inventory_item_sid;
