-- 20260420_db_backup_bucket.sql
-- Creates the `db-backups` storage bucket for nightly SQLite snapshots,
-- and locks it down so:
--   * Only service_role can INSERT / UPDATE / DELETE (desktop sync uploads
--     via the service-role key embedded in the installer).
--   * Owners of a business can SELECT objects under their own business_id
--     prefix (so the admin UI can list restore points).
--   * Anon has NO access.
--
-- Path convention: {business_id}/{YYYY-MM-DD}.sqlite.gz
--
-- Idempotent: safe to run multiple times.

-- 1. Bucket (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'db-backups',
  'db-backups',
  false,
  5368709120, -- 5 GB hard cap per object
  array['application/gzip','application/octet-stream']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Drop prior policies (idempotent re-apply)
drop policy if exists "db_backups_service_role_all"   on storage.objects;
drop policy if exists "db_backups_owner_select"       on storage.objects;
drop policy if exists "db_backups_block_anon_select"  on storage.objects;

-- 3. service_role full control on bucket (sync uploader + admin tooling)
create policy "db_backups_service_role_all"
on storage.objects
as permissive
for all
to service_role
using  (bucket_id = 'db-backups')
with check (bucket_id = 'db-backups');

-- 4. Authenticated owners can SELECT own-business backup objects.
--    Path prefix MUST equal the business_id the caller owns.
--    Assumes a helper `public.my_business_ids()` returning uuid[] already
--    exists (used elsewhere in Terminal X RLS). If absent, the policy fails
--    closed — which is the safe behavior.
create policy "db_backups_owner_select"
on storage.objects
as permissive
for select
to authenticated
using (
  bucket_id = 'db-backups'
  and (
    -- path layout: {business_id}/{YYYY-MM-DD}.sqlite.gz
    (storage.foldername(name))[1]::uuid = any(public.my_business_ids())
  )
);

-- 5. No anon policies — anon cannot read, write, or list this bucket.
--    RLS is already enabled on storage.objects by default; the absence of an
--    anon policy is the lockout.
