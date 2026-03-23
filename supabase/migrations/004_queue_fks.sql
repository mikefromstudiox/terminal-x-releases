-- Add missing foreign key constraints to queue table for PostgREST joins
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'queue_ticket_id_fkey' AND table_name = 'queue') THEN
    ALTER TABLE queue ADD CONSTRAINT queue_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'queue_washer_id_fkey' AND table_name = 'queue') THEN
    ALTER TABLE queue ADD CONSTRAINT queue_washer_id_fkey FOREIGN KEY (washer_id) REFERENCES washers(id) ON DELETE SET NULL;
  END IF;
END $$;
