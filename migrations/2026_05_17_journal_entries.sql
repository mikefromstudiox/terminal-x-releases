-- Phase 1: journal_entries financial spine
-- Plan: C:\Users\City\.claude\plans\indexed-chasing-moonbeam.md
-- Append-only ledger. Single source of truth for all money/value movement.

create extension if not exists pgcrypto;

create table if not exists journal_entries (
  id                bigserial primary key,
  supabase_id       uuid unique not null default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  location_id       uuid,  -- forward-compat; locations table deferred

  tx_group_id       uuid not null,

  posted_at         timestamptz not null default now(),
  effective_date    date not null default current_date,

  vertical          text,
  source_table      text not null,
  source_id         uuid,
  source_line_id    uuid,

  account           text not null,
  category          text,

  employee_id       uuid references staff(id),
  client_id         uuid references clients(id),

  debit             numeric(14,2) not null default 0 check (debit  >= 0),
  credit            numeric(14,2) not null default 0 check (credit >= 0),
  check (debit = 0 or credit = 0),
  check (debit > 0 or credit > 0),

  currency          text not null default 'DOP',

  description       text,
  metadata          jsonb not null default '{}'::jsonb,

  reversal_of_id    bigint references journal_entries(id),
  reversed_by_id    bigint references journal_entries(id),

  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 4 indexes only
create index if not exists ix_je_biz_eff_date_brin on journal_entries using brin (business_id, effective_date);
create index if not exists ix_je_biz_account_date  on journal_entries (business_id, account, effective_date desc);
create index if not exists ix_je_biz_source        on journal_entries (business_id, source_table, source_id);
create index if not exists ix_je_tx_group          on journal_entries (tx_group_id);

-- updated_at trigger (sync.js contract)
create or replace function set_updated_at_journal_entries() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_journal_entries_updated_at on journal_entries;
create trigger trg_journal_entries_updated_at
  before update on journal_entries
  for each row execute function set_updated_at_journal_entries();

-- RLS
alter table journal_entries enable row level security;

drop policy if exists je_select_own on journal_entries;
create policy je_select_own on journal_entries for select
  using ( business_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata') ->> 'business_id')::uuid );

-- Revoke writes from anon + authenticated; service role bypasses RLS for desktop sync.
revoke insert, update, delete on journal_entries from anon, authenticated;

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='journal_entries'
  ) then
    execute 'alter publication supabase_realtime add table journal_entries';
  end if;
end$$;
