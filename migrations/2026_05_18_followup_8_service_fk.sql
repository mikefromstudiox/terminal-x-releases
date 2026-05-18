-- Followup #8 — FK ticket_items.service_supabase_id → services.supabase_id ON DELETE SET NULL.
ALTER TABLE ticket_items
  ADD CONSTRAINT fk_ticket_items_service_sid
  FOREIGN KEY (service_supabase_id)
  REFERENCES services(supabase_id)
  ON DELETE SET NULL
  NOT VALID;
