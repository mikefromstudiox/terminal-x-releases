-- Activity_log had RLS enabled but NO policies, which blocked every desktop
-- push from the anon-key client. Match the pattern used by every other synced
-- table: anon + authenticated can read/write rows tagged with a business_id.
-- Service_role still bypasses RLS by default.

CREATE POLICY "activity_log_anon_insert" ON public.activity_log
  FOR INSERT TO anon, authenticated
  WITH CHECK (business_id IS NOT NULL);

CREATE POLICY "activity_log_anon_select" ON public.activity_log
  FOR SELECT TO anon, authenticated
  USING (business_id IS NOT NULL);

CREATE POLICY "activity_log_anon_update" ON public.activity_log
  FOR UPDATE TO anon, authenticated
  USING (business_id IS NOT NULL)
  WITH CHECK (business_id IS NOT NULL);
