-- 2026-05-18 Fix J — FK ticket_items.inventory_item_supabase_id → inventory_items.supabase_id
-- ON DELETE SET NULL. Was missing entirely; deleting an inventory_item left
-- orphan ticket_items.inventory_item_supabase_id values that broke sell-through
-- reports. Name is already snapshotted on ticket_items for receipt readability.
ALTER TABLE ticket_items
  ADD CONSTRAINT fk_ticket_items_inventory_item_sid
  FOREIGN KEY (inventory_item_supabase_id)
  REFERENCES inventory_items(supabase_id)
  ON DELETE SET NULL
  NOT VALID;
