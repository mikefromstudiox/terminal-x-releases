# Terminal X — Supabase Schema Snapshot

> **Source of truth.** Read THIS before claiming a schema-related bug.
> If reality diverges from this file, regenerate the file and read it again.

- **Project ref:** `csppjsoirjflumaiipqw`
- **Snapshot taken:** 2026-05-19T06:42:48.874Z
- **Generator:** `scripts/schema-snapshot.mjs` (re-run to refresh)
- **Read-only:** every query is a SELECT against `pg_catalog` / `information_schema` — no DDL.

## Regeneration

```powershell
cd "A:\Studio X HUB\Terminal X"
node scripts/schema-snapshot.mjs           # overwrite this file
node scripts/schema-snapshot.mjs --diff    # show diff vs previous run
```

Requires `SUPABASE_ACCESS_TOKEN` in `.env` (Management API personal access token).

## Sections

1. [Tables](#1-tables)
2. [RLS Policies](#2-rls-policies)
3. [Functions / RPCs](#3-functions--rpcs)
4. [Triggers](#4-triggers)
5. [Realtime Publication](#5-realtime-publication-supabase_realtime)
6. [JWT Claim Contract](#6-jwt-claim-contract)
7. [Known PostgREST Gotchas](#7-known-postgrest--supabase-js-gotchas)

---

## §1. Tables

Query used to enumerate tables:

```sql
SELECT c.relname AS table_name,
         COALESCE(s.n_live_tup, 0) AS rough_rows,
         c.relrowsecurity AS rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relispartition = false
  ORDER BY c.relname;
```

Total tables: **159** (RLS enabled: **159**)

### `accounting_bank_accounts`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_bank_accounts_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `banco` | text | NO | 'otro'::text |  |
| 7 | `account_no_last4` | text | YES |  |  |
| 8 | `account_type` | text | NO | 'checking'::text |  |
| 9 | `currency` | text | NO | 'DOP'::text |  |
| 10 | `opening_balance` | numeric | NO | 0 |  |
| 11 | `active` | smallint | NO | 1 |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_bank_accounts_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_bank_accounts_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_bank_accounts_account_type_check` — CHECK ((account_type = ANY (ARRAY['checking'::text, 'savings'::text])))
- `accounting_bank_accounts_banco_check` — CHECK ((banco = ANY (ARRAY['bhd_leon'::text, 'banreservas'::text, 'banco_popular'::text, 'scotiabank'::text, 'otro'::text])))

**Indexes**

- `accounting_bank_accounts_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_bank_accounts_pkey ON public.accounting_bank_accounts USING btree (id)`
- `accounting_bank_accounts_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_bank_accounts_supabase_id_key ON public.accounting_bank_accounts USING btree (supabase_id)`
- `idx_acc_ba_biz` (btree)
  `CREATE INDEX idx_acc_ba_biz ON public.accounting_bank_accounts USING btree (business_id)`
- `idx_acc_ba_client` (btree)
  `CREATE INDEX idx_acc_ba_client ON public.accounting_bank_accounts USING btree (business_id, accounting_client_id)`

### `accounting_bank_statement_lines`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_bank_statement_lines_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `bank_account_id` | bigint | YES |  |  |
| 5 | `bank_account_supabase_id` | uuid | YES |  |  |
| 6 | `fecha` | date | YES |  |  |
| 7 | `descripcion` | text | YES |  |  |
| 8 | `referencia` | text | YES |  |  |
| 9 | `debit` | numeric | NO | 0 |  |
| 10 | `credit` | numeric | NO | 0 |  |
| 11 | `balance` | numeric | YES |  |  |
| 12 | `matched_journal_line_id` | bigint | YES |  |  |
| 13 | `matched_journal_line_supabase_id` | uuid | YES |  |  |
| 14 | `match_status` | text | NO | 'unmatched'::text |  |
| 15 | `raw_row` | text | YES |  |  |
| 16 | `created_at` | timestamp with time zone | NO | now() |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_bank_statement_lines_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_bank_statement_lines_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_bank_statement_lines_match_status_check` — CHECK ((match_status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'ignored'::text, 'adjustment'::text])))

**Indexes**

- `accounting_bank_statement_lines_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_bank_statement_lines_pkey ON public.accounting_bank_statement_lines USING btree (id)`
- `accounting_bank_statement_lines_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_bank_statement_lines_supabase_id_key ON public.accounting_bank_statement_lines USING btree (supabase_id)`
- `idx_acc_bsl_account` (btree)
  `CREATE INDEX idx_acc_bsl_account ON public.accounting_bank_statement_lines USING btree (business_id, bank_account_id)`
- `idx_acc_bsl_biz` (btree)
  `CREATE INDEX idx_acc_bsl_biz ON public.accounting_bank_statement_lines USING btree (business_id)`
- `idx_acc_bsl_status` (btree)
  `CREATE INDEX idx_acc_bsl_status ON public.accounting_bank_statement_lines USING btree (business_id, bank_account_id, match_status)`

### `accounting_billing_invoices`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_billing_invoices_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `ticket_supabase_id` | uuid | YES |  |  |
| 6 | `period_year` | integer | NO |  |  |
| 7 | `period_month` | integer | NO |  |  |
| 8 | `amount` | numeric | NO | 0 |  |
| 9 | `currency` | text | NO | 'DOP'::text |  |
| 10 | `status` | text | NO | 'draft'::text |  |
| 11 | `ecf_track_id` | text | YES |  |  |
| 12 | `ecf_status` | text | YES |  |  |
| 13 | `paid_at` | timestamp with time zone | YES |  |  |
| 14 | `created_at` | timestamp with time zone | NO | now() |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |
| 16 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 17 | `late_fee_amount` | numeric | NO | 0 |  |
| 18 | `paid_late` | smallint | NO | 0 |  |

**Primary Key**

- `accounting_billing_invoices_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_billing_invoices_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_billing_invoices_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'issued'::text, 'paid'::text, 'void'::text])))

**Indexes**

- `accounting_billing_invoices_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_billing_invoices_pkey ON public.accounting_billing_invoices USING btree (id)`
- `accounting_billing_invoices_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_billing_invoices_supabase_id_key ON public.accounting_billing_invoices USING btree (supabase_id)`
- `idx_acc_inv_biz_period` (btree)
  `CREATE INDEX idx_acc_inv_biz_period ON public.accounting_billing_invoices USING btree (business_id, period_year DESC, period_month DESC)`
- `idx_acc_inv_client` (btree)
  `CREATE INDEX idx_acc_inv_client ON public.accounting_billing_invoices USING btree (business_id, accounting_client_id)`
- `idx_acc_inv_client_sid` (btree)
  `CREATE INDEX idx_acc_inv_client_sid ON public.accounting_billing_invoices USING btree (business_id, accounting_client_supabase_id)`
- `idx_acc_inv_status` (btree)
  `CREATE INDEX idx_acc_inv_status ON public.accounting_billing_invoices USING btree (business_id, status)`

### `accounting_billing_plans`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_billing_plans_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `monthly_amount` | numeric | NO | 0 |  |
| 6 | `currency` | text | NO | 'DOP'::text |  |
| 7 | `bill_day` | integer | NO | 1 |  |
| 8 | `ecf_type` | text | NO | 'e32'::text |  |
| 9 | `late_fee_pct` | numeric | NO | 0 |  |
| 10 | `late_fee_after_days` | integer | NO | 0 |  |
| 11 | `active` | smallint | NO | 1 |  |
| 12 | `notes` | text | YES |  |  |
| 13 | `created_at` | timestamp with time zone | NO | now() |  |
| 14 | `updated_at` | timestamp with time zone | NO | now() |  |
| 15 | `accounting_client_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `accounting_billing_plans_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_billing_plans_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_billing_plans_ecf_type_check` — CHECK ((ecf_type = ANY (ARRAY['e31'::text, 'e32'::text])))

**Indexes**

- `accounting_billing_plans_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_billing_plans_pkey ON public.accounting_billing_plans USING btree (id)`
- `accounting_billing_plans_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_billing_plans_supabase_id_key ON public.accounting_billing_plans USING btree (supabase_id)`
- `idx_acc_bp_biz` (btree)
  `CREATE INDEX idx_acc_bp_biz ON public.accounting_billing_plans USING btree (business_id)`
- `idx_acc_bp_client` (btree)
  `CREATE INDEX idx_acc_bp_client ON public.accounting_billing_plans USING btree (business_id, accounting_client_id)`
- `idx_acc_bp_client_sid` (btree)
  `CREATE INDEX idx_acc_bp_client_sid ON public.accounting_billing_plans USING btree (business_id, accounting_client_supabase_id)`

### `accounting_chart_of_accounts`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_chart_of_accounts_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `code` | text | NO |  |  |
| 7 | `parent_id` | bigint | YES |  |  |
| 8 | `parent_supabase_id` | uuid | YES |  |  |
| 9 | `name` | text | NO | ''::text |  |
| 10 | `type` | text | NO | 'activo'::text |  |
| 11 | `is_postable` | smallint | NO | 1 |  |
| 12 | `currency` | text | NO | 'DOP'::text |  |
| 13 | `notes` | text | YES |  |  |
| 14 | `created_at` | timestamp with time zone | NO | now() |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_chart_of_accounts_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_chart_of_accounts_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_chart_of_accounts_type_check` — CHECK ((type = ANY (ARRAY['activo'::text, 'pasivo'::text, 'patrimonio'::text, 'ingreso'::text, 'costo'::text, 'gasto'::text])))

**Indexes**

- `accounting_chart_of_accounts_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_chart_of_accounts_pkey ON public.accounting_chart_of_accounts USING btree (id)`
- `accounting_chart_of_accounts_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_chart_of_accounts_supabase_id_key ON public.accounting_chart_of_accounts USING btree (supabase_id)`
- `idx_acc_coa_biz` (btree)
  `CREATE INDEX idx_acc_coa_biz ON public.accounting_chart_of_accounts USING btree (business_id)`
- `idx_acc_coa_client` (btree)
  `CREATE INDEX idx_acc_coa_client ON public.accounting_chart_of_accounts USING btree (business_id, accounting_client_id)`
- `idx_acc_coa_code` (btree)
  `CREATE INDEX idx_acc_coa_code ON public.accounting_chart_of_accounts USING btree (business_id, accounting_client_id, code)`
- `idx_acc_coa_parent` (btree)
  `CREATE INDEX idx_acc_coa_parent ON public.accounting_chart_of_accounts USING btree (business_id, parent_id)`

### `accounting_clients`

- Rough row count (n_live_tup): **13**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_clients_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_business_supabase_id` | uuid | YES |  |  |
| 5 | `nombre_comercial` | text | NO | ''::text |  |
| 6 | `rnc` | text | YES |  |  |
| 7 | `cedula` | text | YES |  |  |
| 8 | `tipo_persona` | text | NO | 'pj'::text |  |
| 9 | `regimen` | text | NO | 'ordinario'::text |  |
| 10 | `fecha_cierre_mes` | integer | YES |  |  |
| 11 | `fecha_cierre_dia` | integer | YES |  |  |
| 12 | `honorarios_mensuales` | numeric | NO | 0 |  |
| 13 | `currency` | text | NO | 'DOP'::text |  |
| 14 | `assigned_to_user_id` | bigint | YES |  |  |
| 15 | `status` | text | NO | 'active'::text |  |
| 16 | `notes` | text | YES |  |  |
| 17 | `created_at` | timestamp with time zone | NO | now() |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |
| 19 | `shared_business_id` | uuid | YES |  |  |
| 20 | `access_granted` | boolean | NO | false |  |
| 21 | `access_granted_at` | timestamp with time zone | YES |  |  |
| 22 | `access_token` | text | YES |  |  |
| 23 | `access_token_expires_at` | timestamp with time zone | YES |  |  |
| 24 | `anticipo_ingresos_brutos_previos` | numeric | NO | 0 |  |
| 25 | `anticipo_isr_previo` | numeric | NO | 0 |  |
| 26 | `anticipo_had_loss` | smallint | NO | 0 |  |
| 27 | `anticipo_base_year` | integer | YES |  |  |
| 28 | `invite_email` | text | YES |  |  |
| 29 | `invite_token` | text | YES |  |  |
| 30 | `invite_expires_at` | timestamp with time zone | YES |  |  |
| 31 | `invite_sent_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `accounting_clients_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_clients_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_clients_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])))
- `accounting_clients_tipo_persona_check` — CHECK ((tipo_persona = ANY (ARRAY['pf'::text, 'pj'::text, 'eirl'::text])))

**Indexes**

- `accounting_clients_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_clients_pkey ON public.accounting_clients USING btree (id)`
- `accounting_clients_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_clients_supabase_id_key ON public.accounting_clients USING btree (supabase_id)`
- `idx_acc_clients_biz` (btree)
  `CREATE INDEX idx_acc_clients_biz ON public.accounting_clients USING btree (business_id)`
- `idx_acc_clients_invite_email` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_acc_clients_invite_email ON public.accounting_clients USING btree (invite_email) WHERE ((invite_email IS NOT NULL) AND (invite_token IS NOT NULL))`
- `idx_acc_clients_shared_biz` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_acc_clients_shared_biz ON public.accounting_clients USING btree (shared_business_id) WHERE ((shared_business_id IS NOT NULL) AND (access_granted = true))`
- `idx_acc_clients_status` (btree)
  `CREATE INDEX idx_acc_clients_status ON public.accounting_clients USING btree (business_id, status)`
- `u_acc_clients_access_token` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX u_acc_clients_access_token ON public.accounting_clients USING btree (access_token) WHERE (access_token IS NOT NULL)`
- `u_acc_clients_invite_token` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX u_acc_clients_invite_token ON public.accounting_clients USING btree (invite_token) WHERE (invite_token IS NOT NULL)`

### `accounting_coa_auto_post_rules`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_coa_auto_post_rules_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `event` | text | NO |  |  |
| 7 | `condition_json` | text | YES |  |  |
| 8 | `debit_account_id` | bigint | YES |  |  |
| 9 | `debit_account_supabase_id` | uuid | YES |  |  |
| 10 | `credit_account_id` | bigint | YES |  |  |
| 11 | `credit_account_supabase_id` | uuid | YES |  |  |
| 12 | `priority` | integer | NO | 100 |  |
| 13 | `active` | smallint | NO | 1 |  |
| 14 | `created_at` | timestamp with time zone | NO | now() |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_coa_auto_post_rules_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_coa_auto_post_rules_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_coa_auto_post_rules_event_check` — CHECK ((event = ANY (ARRAY['sale'::text, 'purchase'::text, 'payment'::text, 'refund'::text, 'payroll'::text, 'depreciation'::text])))

**Indexes**

- `accounting_coa_auto_post_rules_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_coa_auto_post_rules_pkey ON public.accounting_coa_auto_post_rules USING btree (id)`
- `accounting_coa_auto_post_rules_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_coa_auto_post_rules_supabase_id_key ON public.accounting_coa_auto_post_rules USING btree (supabase_id)`
- `idx_acc_apr_biz` (btree)
  `CREATE INDEX idx_acc_apr_biz ON public.accounting_coa_auto_post_rules USING btree (business_id)`
- `idx_acc_apr_client` (btree)
  `CREATE INDEX idx_acc_apr_client ON public.accounting_coa_auto_post_rules USING btree (business_id, accounting_client_id)`
- `idx_acc_apr_event` (btree)
  `CREATE INDEX idx_acc_apr_event ON public.accounting_coa_auto_post_rules USING btree (business_id, accounting_client_id, event, priority)`

### `accounting_comprobantes`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_comprobantes_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `kind` | text | NO | 'compra'::text |  |
| 7 | `period_year` | integer | NO |  |  |
| 8 | `period_month` | integer | NO | 0 |  |
| 9 | `ncf` | text | YES |  |  |
| 10 | `ncf_modificado` | text | YES |  |  |
| 11 | `fecha_comprobante` | date | YES |  |  |
| 12 | `fecha_pago` | date | YES |  |  |
| 13 | `rnc_contraparte` | text | YES |  |  |
| 14 | `razon_social` | text | YES |  |  |
| 15 | `tipo_id` | text | NO | 'rnc'::text |  |
| 16 | `itbis_rate` | smallint | NO | 18 |  |
| 17 | `monto_facturado` | numeric | NO | 0 |  |
| 18 | `itbis_facturado` | numeric | NO | 0 |  |
| 19 | `itbis_retenido` | numeric | NO | 0 |  |
| 20 | `isr_retenido` | numeric | NO | 0 |  |
| 21 | `retencion_renta` | numeric | NO | 0 |  |
| 22 | `impuesto_selectivo` | numeric | NO | 0 |  |
| 23 | `otros_impuestos` | numeric | NO | 0 |  |
| 24 | `propina_legal` | numeric | NO | 0 |  |
| 25 | `monto_total` | numeric | NO | 0 |  |
| 26 | `forma_pago` | text | YES |  |  |
| 27 | `motivo_anulacion` | text | YES |  |  |
| 28 | `notes` | text | YES |  |  |
| 29 | `source` | text | NO | 'manual'::text |  |
| 30 | `created_at` | timestamp with time zone | NO | now() |  |
| 31 | `updated_at` | timestamp with time zone | NO | now() |  |
| 32 | `itbis_proporcionalidad` | numeric | NO | 0 |  |
| 33 | `itbis_llevado_al_costo` | numeric | NO | 0 |  |
| 34 | `tipo_bienes_servicios` | smallint | YES |  |  |
| 35 | `retencion_pct` | smallint | YES | 0 |  |

**Primary Key**

- `accounting_comprobantes_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_comprobantes_dedupe_uniq` — UNIQUE (business_id, accounting_client_id, kind, ncf, fecha_comprobante)
- `accounting_comprobantes_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_comprobantes_kind_check` — CHECK ((kind = ANY (ARRAY['compra'::text, 'venta'::text, 'anulado'::text])))
- `accounting_comprobantes_source_check` — CHECK ((source = ANY (ARRAY['manual'::text, 'csv'::text, 'xml'::text, 'api'::text])))
- `accounting_comprobantes_tipo_id_check` — CHECK ((tipo_id = ANY (ARRAY['rnc'::text, 'cedula'::text, 'passport'::text])))
- `chk_itbis_rate_valid` — CHECK (((itbis_rate IS NULL) OR (itbis_rate = ANY (ARRAY['-1'::integer, 0, 16, 18]))))
- `chk_tipo_bs_valid` — CHECK (((tipo_bienes_servicios IS NULL) OR ((tipo_bienes_servicios >= 1) AND (tipo_bienes_servicios <= 11))))

**Indexes**

- `acc_comp_business_idx` (btree)
  `CREATE INDEX acc_comp_business_idx ON public.accounting_comprobantes USING btree (business_id, period_year, period_month)`
- `acc_comp_client_period_idx` (btree)
  `CREATE INDEX acc_comp_client_period_idx ON public.accounting_comprobantes USING btree (accounting_client_id, period_year, period_month, kind)`
- `acc_comp_dedupe_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX acc_comp_dedupe_idx ON public.accounting_comprobantes USING btree (business_id, accounting_client_id, kind, ncf, fecha_comprobante) WHERE ((ncf IS NOT NULL) AND (ncf <> ''::text))`
- `accounting_comprobantes_dedupe_uniq` (btree)
  `CREATE UNIQUE INDEX accounting_comprobantes_dedupe_uniq ON public.accounting_comprobantes USING btree (business_id, accounting_client_id, kind, ncf, fecha_comprobante)`
- `accounting_comprobantes_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_comprobantes_pkey ON public.accounting_comprobantes USING btree (id)`
- `accounting_comprobantes_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_comprobantes_supabase_id_key ON public.accounting_comprobantes USING btree (supabase_id)`

### `accounting_csv_mappings`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_csv_mappings_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `doc_type` | text | NO |  |  |
| 6 | `name` | text | NO |  |  |
| 7 | `mapping_json` | text | NO |  |  |
| 8 | `created_at` | timestamp with time zone | NO | now() |  |
| 9 | `updated_at` | timestamp with time zone | NO | now() |  |
| 10 | `accounting_client_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `accounting_csv_mappings_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_csv_mappings_supabase_id_key` — UNIQUE (supabase_id)

**Indexes**

- `accounting_csv_mappings_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_csv_mappings_pkey ON public.accounting_csv_mappings USING btree (id)`
- `accounting_csv_mappings_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_csv_mappings_supabase_id_key ON public.accounting_csv_mappings USING btree (supabase_id)`
- `idx_acc_csv_biz` (btree)
  `CREATE INDEX idx_acc_csv_biz ON public.accounting_csv_mappings USING btree (business_id)`
- `idx_acc_csv_client_sid` (btree)
  `CREATE INDEX idx_acc_csv_client_sid ON public.accounting_csv_mappings USING btree (business_id, accounting_client_supabase_id)`

### `accounting_documents`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_documents_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `category` | text | NO | 'otro'::text |  |
| 6 | `period_year` | integer | YES |  |  |
| 7 | `period_month` | integer | YES |  |  |
| 8 | `filename` | text | NO | 'sin-nombre'::text |  |
| 9 | `r2_key` | text | YES |  |  |
| 10 | `mime` | text | NO | 'application/octet-stream'::text |  |
| 11 | `size` | bigint | NO | 0 |  |
| 12 | `uploaded_by_user_id` | bigint | YES |  |  |
| 13 | `expires_at` | date | YES |  |  |
| 14 | `tags` | text | YES |  |  |
| 15 | `notes` | text | YES |  |  |
| 16 | `created_at` | timestamp with time zone | NO | now() |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |
| 18 | `accounting_client_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `accounting_documents_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_documents_supabase_id_key` — UNIQUE (supabase_id)

**Indexes**

- `accounting_documents_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_documents_pkey ON public.accounting_documents USING btree (id)`
- `accounting_documents_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_documents_supabase_id_key ON public.accounting_documents USING btree (supabase_id)`
- `idx_acc_docs_biz` (btree)
  `CREATE INDEX idx_acc_docs_biz ON public.accounting_documents USING btree (business_id)`
- `idx_acc_docs_client` (btree)
  `CREATE INDEX idx_acc_docs_client ON public.accounting_documents USING btree (business_id, accounting_client_id)`
- `idx_acc_docs_client_sid` (btree)
  `CREATE INDEX idx_acc_docs_client_sid ON public.accounting_documents USING btree (business_id, accounting_client_supabase_id)`

### `accounting_fixed_assets`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_fixed_assets_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `name` | text | NO | ''::text |  |
| 7 | `categoria` | text | NO | 'cat_2'::text |  |
| 8 | `fecha_adquisicion` | date | YES |  |  |
| 9 | `costo` | numeric | NO | 0 |  |
| 10 | `vida_util_meses` | integer | NO | 0 |  |
| 11 | `valor_residual` | numeric | NO | 0 |  |
| 12 | `depreciacion_acumulada` | numeric | NO | 0 |  |
| 13 | `status` | text | NO | 'active'::text |  |
| 14 | `sold_at` | date | YES |  |  |
| 15 | `sold_amount` | numeric | YES |  |  |
| 16 | `notes` | text | YES |  |  |
| 17 | `created_at` | timestamp with time zone | NO | now() |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_fixed_assets_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_fixed_assets_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_fixed_assets_categoria_check` — CHECK ((categoria = ANY (ARRAY['cat_1'::text, 'cat_2'::text, 'cat_3'::text])))
- `accounting_fixed_assets_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'sold'::text, 'written_off'::text])))

**Indexes**

- `accounting_fixed_assets_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_fixed_assets_pkey ON public.accounting_fixed_assets USING btree (id)`
- `accounting_fixed_assets_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_fixed_assets_supabase_id_key ON public.accounting_fixed_assets USING btree (supabase_id)`
- `idx_acc_fa_biz` (btree)
  `CREATE INDEX idx_acc_fa_biz ON public.accounting_fixed_assets USING btree (business_id)`
- `idx_acc_fa_client` (btree)
  `CREATE INDEX idx_acc_fa_client ON public.accounting_fixed_assets USING btree (business_id, accounting_client_id)`

### `accounting_foreign_payments`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_foreign_payments_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `fecha` | date | YES |  |  |
| 7 | `beneficiario_id` | text | YES |  |  |
| 8 | `beneficiario_pais` | text | YES |  |  |
| 9 | `beneficiario_nombre` | text | YES |  |  |
| 10 | `tipo_renta` | text | YES |  |  |
| 11 | `moneda` | text | NO | 'USD'::text |  |
| 12 | `monto_moneda_pago` | numeric | NO | 0 |  |
| 13 | `tasa_cambio` | numeric | NO | 1 |  |
| 14 | `monto_local` | numeric | NO | 0 |  |
| 15 | `isr_retenido` | numeric | NO | 0 |  |
| 16 | `created_at` | timestamp with time zone | NO | now() |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_foreign_payments_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_foreign_payments_supabase_id_key` — UNIQUE (supabase_id)

**Indexes**

- `accounting_foreign_payments_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_foreign_payments_pkey ON public.accounting_foreign_payments USING btree (id)`
- `accounting_foreign_payments_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_foreign_payments_supabase_id_key ON public.accounting_foreign_payments USING btree (supabase_id)`
- `idx_acc_fp_biz` (btree)
  `CREATE INDEX idx_acc_fp_biz ON public.accounting_foreign_payments USING btree (business_id)`
- `idx_acc_fp_client` (btree)
  `CREATE INDEX idx_acc_fp_client ON public.accounting_foreign_payments USING btree (business_id, accounting_client_id)`

### `accounting_inbox`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_inbox_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `source` | text | NO | 'dropzone'::text |  |
| 6 | `original_filename` | text | NO | 'sin-nombre'::text |  |
| 7 | `mime` | text | NO | 'application/octet-stream'::text |  |
| 8 | `size` | bigint | NO | 0 |  |
| 9 | `r2_key` | text | YES |  |  |
| 10 | `ocr_status` | text | NO | 'pending'::text |  |
| 11 | `ocr_text` | text | YES |  |  |
| 12 | `classified_type` | text | NO | 'otro'::text |  |
| 13 | `classification_confidence` | numeric | NO | 0 |  |
| 14 | `status` | text | NO | 'unclassified'::text |  |
| 15 | `posted_journal_entry_id` | bigint | YES |  |  |
| 16 | `posted_at` | timestamp with time zone | YES |  |  |
| 17 | `notes` | text | YES |  |  |
| 18 | `created_at` | timestamp with time zone | NO | now() |  |
| 19 | `updated_at` | timestamp with time zone | NO | now() |  |
| 20 | `accounting_client_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `accounting_inbox_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_inbox_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_inbox_classified_type_check` — CHECK ((classified_type = ANY (ARRAY['ecf_xml'::text, 'factura_pdf'::text, 'retencion'::text, 'banco_estado'::text, 'tss'::text, 'csv'::text, 'contrato'::text, 'otro'::text])))
- `accounting_inbox_ocr_status_check` — CHECK ((ocr_status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text])))
- `accounting_inbox_source_check` — CHECK ((source = ANY (ARRAY['dropzone'::text, 'email'::text, 'whatsapp'::text, 'api'::text])))
- `accounting_inbox_status_check` — CHECK ((status = ANY (ARRAY['unclassified'::text, 'classified'::text, 'posted'::text, 'archived'::text])))
- `chk_inbox_confidence_range` — CHECK (((classification_confidence >= (0)::numeric) AND (classification_confidence <= (1)::numeric)))

**Indexes**

- `accounting_inbox_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_inbox_pkey ON public.accounting_inbox USING btree (id)`
- `accounting_inbox_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_inbox_supabase_id_key ON public.accounting_inbox USING btree (supabase_id)`
- `idx_acc_inbox_biz_status` (btree)
  `CREATE INDEX idx_acc_inbox_biz_status ON public.accounting_inbox USING btree (business_id, status)`
- `idx_acc_inbox_client` (btree)
  `CREATE INDEX idx_acc_inbox_client ON public.accounting_inbox USING btree (business_id, accounting_client_id)`
- `idx_acc_inbox_client_sid` (btree)
  `CREATE INDEX idx_acc_inbox_client_sid ON public.accounting_inbox USING btree (business_id, accounting_client_supabase_id)`

### `accounting_journal_entries`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_journal_entries_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `fecha` | date | YES |  |  |
| 7 | `description` | text | YES |  |  |
| 8 | `type` | text | NO | 'manual'::text |  |
| 9 | `reference_doc_supabase_id` | uuid | YES |  |  |
| 10 | `status` | text | NO | 'draft'::text |  |
| 11 | `posted_by_user_id` | bigint | YES |  |  |
| 12 | `period_year` | integer | YES |  |  |
| 13 | `period_month` | integer | YES |  |  |
| 14 | `totals_debit` | numeric | NO | 0 |  |
| 15 | `totals_credit` | numeric | NO | 0 |  |
| 16 | `created_at` | timestamp with time zone | NO | now() |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_journal_entries_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_journal_entries_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_journal_entries_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text, 'reversed'::text])))
- `accounting_journal_entries_type_check` — CHECK ((type = ANY (ARRAY['manual'::text, 'auto_sales'::text, 'auto_purchase'::text, 'auto_payroll'::text, 'auto_depreciation'::text, 'adjustment'::text, 'closing'::text])))

**Indexes**

- `accounting_journal_entries_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_journal_entries_pkey ON public.accounting_journal_entries USING btree (id)`
- `accounting_journal_entries_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_journal_entries_supabase_id_key ON public.accounting_journal_entries USING btree (supabase_id)`
- `idx_acc_je_biz` (btree)
  `CREATE INDEX idx_acc_je_biz ON public.accounting_journal_entries USING btree (business_id)`
- `idx_acc_je_client` (btree)
  `CREATE INDEX idx_acc_je_client ON public.accounting_journal_entries USING btree (business_id, accounting_client_id)`
- `idx_acc_je_fecha` (btree)
  `CREATE INDEX idx_acc_je_fecha ON public.accounting_journal_entries USING btree (business_id, fecha)`
- `idx_acc_je_period` (btree)
  `CREATE INDEX idx_acc_je_period ON public.accounting_journal_entries USING btree (business_id, accounting_client_id, period_year DESC, period_month DESC)`

### `accounting_journal_lines`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_journal_lines_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `journal_entry_id` | bigint | YES |  |  |
| 5 | `journal_entry_supabase_id` | uuid | YES |  |  |
| 6 | `account_id` | bigint | YES |  |  |
| 7 | `account_supabase_id` | uuid | YES |  |  |
| 8 | `debit` | numeric | NO | 0 |  |
| 9 | `credit` | numeric | NO | 0 |  |
| 10 | `currency` | text | NO | 'DOP'::text |  |
| 11 | `exchange_rate` | numeric | NO | 1 |  |
| 12 | `memo` | text | YES |  |  |
| 13 | `created_at` | timestamp with time zone | NO | now() |  |
| 14 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_journal_lines_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_journal_lines_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `chk_je_line_debit_xor_credit` — CHECK ((NOT ((COALESCE(debit, (0)::numeric) > (0)::numeric) AND (COALESCE(credit, (0)::numeric) > (0)::numeric))))

**Indexes**

- `accounting_journal_lines_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_journal_lines_pkey ON public.accounting_journal_lines USING btree (id)`
- `accounting_journal_lines_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_journal_lines_supabase_id_key ON public.accounting_journal_lines USING btree (supabase_id)`
- `idx_acc_jl_account` (btree)
  `CREATE INDEX idx_acc_jl_account ON public.accounting_journal_lines USING btree (business_id, account_id)`
- `idx_acc_jl_biz` (btree)
  `CREATE INDEX idx_acc_jl_biz ON public.accounting_journal_lines USING btree (business_id)`
- `idx_acc_jl_entry` (btree)
  `CREATE INDEX idx_acc_jl_entry ON public.accounting_journal_lines USING btree (business_id, journal_entry_id)`
- `idx_acc_jl_entry_account` (btree)
  `CREATE INDEX idx_acc_jl_entry_account ON public.accounting_journal_lines USING btree (business_id, journal_entry_id, account_id)`

### `accounting_obligations_calendar`

- Rough row count (n_live_tup): **196**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_obligations_calendar_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | NO |  |  |
| 5 | `form_type` | text | NO |  |  |
| 6 | `period_year` | integer | NO |  |  |
| 7 | `period_month` | integer | NO | 0 |  |
| 8 | `due_date` | date | NO |  |  |
| 9 | `status` | text | NO | 'pendiente'::text |  |
| 10 | `filed_at` | timestamp with time zone | YES |  |  |
| 11 | `filed_by_user_id` | bigint | YES |  |  |
| 12 | `dgii_constancia_no` | text | YES |  |  |
| 13 | `attachment_supabase_id` | uuid | YES |  |  |
| 14 | `notes` | text | YES |  |  |
| 15 | `created_at` | timestamp with time zone | NO | now() |  |
| 16 | `updated_at` | timestamp with time zone | NO | now() |  |
| 17 | `accounting_client_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `accounting_obligations_calendar_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_obligations_calendar_supabase_id_key` — UNIQUE (supabase_id)
- `u_acc_obligations` — UNIQUE (business_id, accounting_client_id, form_type, period_year, period_month)

**Check Constraints**

- `accounting_obligations_calendar_status_check` — CHECK ((status = ANY (ARRAY['pendiente'::text, 'en_revision'::text, 'firmado'::text, 'radicado'::text, 'pagado'::text, 'vencido'::text])))

**Indexes**

- `accounting_obligations_calendar_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_obligations_calendar_pkey ON public.accounting_obligations_calendar USING btree (id)`
- `accounting_obligations_calendar_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_obligations_calendar_supabase_id_key ON public.accounting_obligations_calendar USING btree (supabase_id)`
- `idx_acc_obl_biz_due` (btree)
  `CREATE INDEX idx_acc_obl_biz_due ON public.accounting_obligations_calendar USING btree (business_id, due_date)`
- `idx_acc_obl_client` (btree)
  `CREATE INDEX idx_acc_obl_client ON public.accounting_obligations_calendar USING btree (business_id, accounting_client_id)`
- `idx_acc_obl_client_sid` (btree)
  `CREATE INDEX idx_acc_obl_client_sid ON public.accounting_obligations_calendar USING btree (business_id, accounting_client_supabase_id)`
- `u_acc_obligations` (btree)
  `CREATE UNIQUE INDEX u_acc_obligations ON public.accounting_obligations_calendar USING btree (business_id, accounting_client_id, form_type, period_year, period_month)`

### `accounting_payroll_employee_bank`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_payroll_employee_bank_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `employee_cedula` | text | NO |  |  |
| 7 | `employee_name` | text | YES |  |  |
| 8 | `employee_email` | text | YES |  |  |
| 9 | `cuenta_destino` | text | YES |  |  |
| 10 | `banco_destino` | text | YES |  |  |
| 11 | `tipo_cuenta` | text | YES |  |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_payroll_employee_bank_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_payroll_employee_bank_roster_uniq` — UNIQUE NULLS NOT DISTINCT (business_id, accounting_client_id, employee_cedula)
- `accounting_payroll_employee_bank_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_payroll_employee_bank_tipo_cuenta_check` — CHECK (((tipo_cuenta IS NULL) OR (tipo_cuenta = ANY (ARRAY['corriente'::text, 'ahorros'::text]))))

**Indexes**

- `accounting_payroll_employee_bank_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_payroll_employee_bank_pkey ON public.accounting_payroll_employee_bank USING btree (id)`
- `accounting_payroll_employee_bank_roster_uniq` (btree)
  `CREATE UNIQUE INDEX accounting_payroll_employee_bank_roster_uniq ON public.accounting_payroll_employee_bank USING btree (business_id, accounting_client_id, employee_cedula) NULLS NOT DISTINCT`
- `accounting_payroll_employee_bank_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_payroll_employee_bank_supabase_id_key ON public.accounting_payroll_employee_bank USING btree (supabase_id)`
- `idx_acc_pl_emp_bank_biz` (btree)
  `CREATE INDEX idx_acc_pl_emp_bank_biz ON public.accounting_payroll_employee_bank USING btree (business_id)`
- `uq_acc_pl_emp_bank` (btree)
  `CREATE UNIQUE INDEX uq_acc_pl_emp_bank ON public.accounting_payroll_employee_bank USING btree (business_id, accounting_client_id, employee_cedula)`

### `accounting_payroll_lines`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_payroll_lines_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `payroll_period_id` | bigint | YES |  |  |
| 5 | `payroll_period_supabase_id` | uuid | YES |  |  |
| 6 | `employee_name` | text | YES |  |  |
| 7 | `employee_cedula` | text | YES |  |  |
| 8 | `employee_nss` | text | YES |  |  |
| 9 | `salario_base` | numeric | NO | 0 |  |
| 10 | `dependientes` | integer | NO | 0 |  |
| 11 | `afp` | numeric | NO | 0 |  |
| 12 | `ars` | numeric | NO | 0 |  |
| 13 | `sfs` | numeric | NO | 0 |  |
| 14 | `riesgos_laborales` | numeric | NO | 0 |  |
| 15 | `isr` | numeric | NO | 0 |  |
| 16 | `otras_deducciones` | numeric | NO | 0 |  |
| 17 | `neto` | numeric | NO | 0 |  |
| 18 | `created_at` | timestamp with time zone | NO | now() |  |
| 19 | `updated_at` | timestamp with time zone | NO | now() |  |
| 20 | `cuenta_destino` | text | YES |  |  |
| 21 | `banco_destino` | text | YES |  |  |
| 22 | `tipo_cuenta` | text | YES |  |  |

**Primary Key**

- `accounting_payroll_lines_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_payroll_lines_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `chk_acc_pl_tipo_cuenta` — CHECK (((tipo_cuenta IS NULL) OR (tipo_cuenta = ANY (ARRAY['corriente'::text, 'ahorros'::text]))))

**Indexes**

- `accounting_payroll_lines_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_payroll_lines_pkey ON public.accounting_payroll_lines USING btree (id)`
- `accounting_payroll_lines_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_payroll_lines_supabase_id_key ON public.accounting_payroll_lines USING btree (supabase_id)`
- `idx_acc_pl_biz` (btree)
  `CREATE INDEX idx_acc_pl_biz ON public.accounting_payroll_lines USING btree (business_id)`
- `idx_acc_pl_period` (btree)
  `CREATE INDEX idx_acc_pl_period ON public.accounting_payroll_lines USING btree (business_id, payroll_period_id)`

### `accounting_payroll_periods`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_payroll_periods_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `year` | integer | NO |  |  |
| 7 | `month` | integer | NO |  |  |
| 8 | `status` | text | NO | 'draft'::text |  |
| 9 | `totals_json` | text | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `updated_at` | timestamp with time zone | NO | now() |  |
| 12 | `disbursement_generated_at` | timestamp with time zone | YES |  |  |
| 13 | `disbursement_bank` | text | YES |  |  |

**Primary Key**

- `accounting_payroll_periods_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_payroll_periods_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_payroll_periods_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text, 'paid'::text])))

**Indexes**

- `accounting_payroll_periods_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_payroll_periods_pkey ON public.accounting_payroll_periods USING btree (id)`
- `accounting_payroll_periods_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_payroll_periods_supabase_id_key ON public.accounting_payroll_periods USING btree (supabase_id)`
- `idx_acc_pp_biz` (btree)
  `CREATE INDEX idx_acc_pp_biz ON public.accounting_payroll_periods USING btree (business_id)`
- `idx_acc_pp_client` (btree)
  `CREATE INDEX idx_acc_pp_client ON public.accounting_payroll_periods USING btree (business_id, accounting_client_id)`
- `idx_acc_pp_period` (btree)
  `CREATE INDEX idx_acc_pp_period ON public.accounting_payroll_periods USING btree (business_id, accounting_client_id, year DESC, month DESC)`

### `accounting_retentions_emitidas`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_retentions_emitidas_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `fecha` | date | YES |  |  |
| 7 | `beneficiario_rnc` | text | YES |  |  |
| 8 | `beneficiario_nombre` | text | YES |  |  |
| 9 | `tipo` | text | NO | 'servicios_no_dom'::text |  |
| 10 | `base` | numeric | NO | 0 |  |
| 11 | `tasa` | numeric | NO | 0 |  |
| 12 | `retencion` | numeric | NO | 0 |  |
| 13 | `ncf_emitido` | text | YES |  |  |
| 14 | `comprobante_url` | text | YES |  |  |
| 15 | `created_at` | timestamp with time zone | NO | now() |  |
| 16 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_retentions_emitidas_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_retentions_emitidas_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_retentions_emitidas_tipo_check` — CHECK ((tipo = ANY (ARRAY['alquiler'::text, 'honorarios'::text, 'dividendos'::text, 'servicios_no_dom'::text])))

**Indexes**

- `accounting_retentions_emitidas_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_retentions_emitidas_pkey ON public.accounting_retentions_emitidas USING btree (id)`
- `accounting_retentions_emitidas_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_retentions_emitidas_supabase_id_key ON public.accounting_retentions_emitidas USING btree (supabase_id)`
- `idx_acc_re_biz` (btree)
  `CREATE INDEX idx_acc_re_biz ON public.accounting_retentions_emitidas USING btree (business_id)`
- `idx_acc_re_client` (btree)
  `CREATE INDEX idx_acc_re_client ON public.accounting_retentions_emitidas USING btree (business_id, accounting_client_id)`

### `accounting_retentions_recibidas`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_retentions_recibidas_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `fecha` | date | YES |  |  |
| 7 | `retenedor_rnc` | text | YES |  |  |
| 8 | `retenedor_nombre` | text | YES |  |  |
| 9 | `tipo` | text | YES |  |  |
| 10 | `base` | numeric | NO | 0 |  |
| 11 | `tasa` | numeric | NO | 0 |  |
| 12 | `retencion` | numeric | NO | 0 |  |
| 13 | `comprobante_url` | text | YES |  |  |
| 14 | `created_at` | timestamp with time zone | NO | now() |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_retentions_recibidas_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_retentions_recibidas_supabase_id_key` — UNIQUE (supabase_id)

**Indexes**

- `accounting_retentions_recibidas_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_retentions_recibidas_pkey ON public.accounting_retentions_recibidas USING btree (id)`
- `accounting_retentions_recibidas_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_retentions_recibidas_supabase_id_key ON public.accounting_retentions_recibidas USING btree (supabase_id)`
- `idx_acc_rr_biz` (btree)
  `CREATE INDEX idx_acc_rr_biz ON public.accounting_retentions_recibidas USING btree (business_id)`
- `idx_acc_rr_client` (btree)
  `CREATE INDEX idx_acc_rr_client ON public.accounting_retentions_recibidas USING btree (business_id, accounting_client_id)`

### `accounting_tasks`

- Rough row count (n_live_tup): **5**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_tasks_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `title` | text | NO | ''::text |  |
| 7 | `description` | text | YES |  |  |
| 8 | `assigned_to_user_id` | bigint | YES |  |  |
| 9 | `status` | text | NO | 'pending'::text |  |
| 10 | `priority` | text | NO | 'med'::text |  |
| 11 | `due_date` | date | YES |  |  |
| 12 | `parent_obligation_supabase_id` | uuid | YES |  |  |
| 13 | `created_at` | timestamp with time zone | NO | now() |  |
| 14 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_tasks_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_tasks_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_tasks_priority_check` — CHECK ((priority = ANY (ARRAY['low'::text, 'med'::text, 'high'::text])))
- `accounting_tasks_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'review'::text, 'done'::text])))

**Indexes**

- `accounting_tasks_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_tasks_pkey ON public.accounting_tasks USING btree (id)`
- `accounting_tasks_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_tasks_supabase_id_key ON public.accounting_tasks USING btree (supabase_id)`
- `idx_acc_tk_biz` (btree)
  `CREATE INDEX idx_acc_tk_biz ON public.accounting_tasks USING btree (business_id)`
- `idx_acc_tk_client` (btree)
  `CREATE INDEX idx_acc_tk_client ON public.accounting_tasks USING btree (business_id, accounting_client_id)`
- `idx_acc_tk_status` (btree)
  `CREATE INDEX idx_acc_tk_status ON public.accounting_tasks USING btree (business_id, accounting_client_id, status, due_date)`

### `accounting_tss_filings`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('accounting_tss_filings_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `accounting_client_id` | bigint | YES |  |  |
| 5 | `accounting_client_supabase_id` | uuid | YES |  |  |
| 6 | `year` | integer | NO |  |  |
| 7 | `month` | integer | NO |  |  |
| 8 | `filename` | text | YES |  |  |
| 9 | `file_supabase_id` | uuid | YES |  |  |
| 10 | `status` | text | NO | 'pendiente'::text |  |
| 11 | `created_at` | timestamp with time zone | NO | now() |  |
| 12 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `accounting_tss_filings_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `accounting_tss_filings_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `accounting_tss_filings_status_check` — CHECK ((status = ANY (ARRAY['pendiente'::text, 'radicado'::text])))

**Indexes**

- `accounting_tss_filings_pkey` (btree)
  `CREATE UNIQUE INDEX accounting_tss_filings_pkey ON public.accounting_tss_filings USING btree (id)`
- `accounting_tss_filings_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX accounting_tss_filings_supabase_id_key ON public.accounting_tss_filings USING btree (supabase_id)`
- `idx_acc_tss_biz` (btree)
  `CREATE INDEX idx_acc_tss_biz ON public.accounting_tss_filings USING btree (business_id)`
- `idx_acc_tss_client` (btree)
  `CREATE INDEX idx_acc_tss_client ON public.accounting_tss_filings USING btree (business_id, accounting_client_id)`
- `idx_acc_tss_period` (btree)
  `CREATE INDEX idx_acc_tss_period ON public.accounting_tss_filings USING btree (business_id, accounting_client_id, year DESC, month DESC)`

### `activity_log`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('activity_log_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `event_type` | text | NO |  |  |
| 5 | `severity` | text | NO | 'info'::text |  |
| 6 | `actor_supabase_id` | uuid | YES |  |  |
| 7 | `actor_name` | text | YES |  |  |
| 8 | `actor_role` | text | YES |  |  |
| 9 | `target_type` | text | YES |  |  |
| 10 | `target_id` | text | YES |  |  |
| 11 | `target_name` | text | YES |  |  |
| 12 | `amount` | numeric | YES |  |  |
| 13 | `old_value` | text | YES |  |  |
| 14 | `new_value` | text | YES |  |  |
| 15 | `reason` | text | YES |  |  |
| 16 | `metadata` | jsonb | YES |  |  |
| 17 | `created_at` | timestamp with time zone | NO | now() |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `activity_log_pkey` — PRIMARY KEY (id, created_at)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `activity_log_business_id_supabase_id_created_at_key` — UNIQUE (business_id, supabase_id, created_at)

**Foreign Keys**

- `activity_log_p_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `activity_log_p_severity_check` — CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'critical'::text])))

**Indexes**

- `activity_log_business_id_supabase_id_created_at_key` (btree)
  `CREATE UNIQUE INDEX activity_log_business_id_supabase_id_created_at_key ON ONLY public.activity_log USING btree (business_id, supabase_id, created_at)`
- `activity_log_pkey` (btree)
  `CREATE UNIQUE INDEX activity_log_pkey ON ONLY public.activity_log USING btree (id, created_at)`

### `activity_log_legacy_unpartitioned`

- Rough row count (n_live_tup): **617**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('activity_log_legacy_unpartitioned_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `event_type` | text | NO |  |  |
| 5 | `severity` | text | NO | 'info'::text |  |
| 6 | `actor_supabase_id` | uuid | YES |  |  |
| 7 | `actor_name` | text | YES |  |  |
| 8 | `actor_role` | text | YES |  |  |
| 9 | `target_type` | text | YES |  |  |
| 10 | `target_id` | text | YES |  |  |
| 11 | `target_name` | text | YES |  |  |
| 12 | `amount` | numeric | YES |  |  |
| 13 | `old_value` | text | YES |  |  |
| 14 | `new_value` | text | YES |  |  |
| 15 | `reason` | text | YES |  |  |
| 16 | `metadata` | jsonb | YES |  |  |
| 17 | `created_at` | timestamp with time zone | NO | now() |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `activity_log_legacy_unpartitioned_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `activity_log_legacy_business_id_supabase_id_key` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `activity_log_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `activity_log_severity_check` — CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'critical'::text])))

**Indexes**

- `activity_log_legacy_business_id_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX activity_log_legacy_business_id_supabase_id_key ON public.activity_log_legacy_unpartitioned USING btree (business_id, supabase_id)`
- `activity_log_legacy_unpartitioned_pkey` (btree)
  `CREATE UNIQUE INDEX activity_log_legacy_unpartitioned_pkey ON public.activity_log_legacy_unpartitioned USING btree (id)`
- `idx_activity_log_biz_created_at` (btree)
  `CREATE INDEX idx_activity_log_biz_created_at ON public.activity_log_legacy_unpartitioned USING btree (business_id, created_at DESC)`
- `idx_activity_log_biz_event` (btree)
  `CREATE INDEX idx_activity_log_biz_event ON public.activity_log_legacy_unpartitioned USING btree (business_id, event_type)`
- `idx_activity_log_created_brin` (brin)
  `CREATE INDEX idx_activity_log_created_brin ON public.activity_log_legacy_unpartitioned USING brin (created_at) WITH (pages_per_range='32')`
- `idx_activity_log_metadata_gin` (gin)
  `CREATE INDEX idx_activity_log_metadata_gin ON public.activity_log_legacy_unpartitioned USING gin (metadata jsonb_path_ops)`

### `adelantos`

- Rough row count (n_live_tup): **40**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `empleado_id` | uuid | YES |  |  |
| 5 | `empleado_supabase_id` | uuid | YES |  |  |
| 6 | `amount` | numeric | NO |  |  |
| 7 | `date` | date | NO | CURRENT_DATE |  |
| 8 | `notes` | text | YES |  |  |
| 9 | `status` | text | NO | 'pendiente'::text |  |
| 10 | `deducted_from_payroll_id` | uuid | YES |  |  |
| 11 | `deducted_at` | timestamp with time zone | YES |  |  |
| 12 | `approved_by` | text | YES |  |  |
| 13 | `created_at` | timestamp with time zone | YES | now() |  |
| 14 | `updated_at` | timestamp with time zone | YES | now() |  |
| 15 | `approved_by_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `adelantos_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `adelantos_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_adelantos_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `adelantos_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `adelantos_pkey` (btree)
  `CREATE UNIQUE INDEX adelantos_pkey ON public.adelantos USING btree (id)`
- `adelantos_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX adelantos_supabase_id_uniq ON public.adelantos USING btree (supabase_id)`
- `idx_adelantos_approved_by_sid` (btree)
  `CREATE INDEX idx_adelantos_approved_by_sid ON public.adelantos USING btree (approved_by_supabase_id)`
- `uq_adelantos_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_adelantos_biz_sid ON public.adelantos USING btree (business_id, supabase_id)`

### `admin_users`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `auth_user_id` | uuid | NO |  |  |
| 3 | `role` | text | NO | 'support'::text |  |
| 4 | `name` | text | NO |  |  |
| 5 | `active` | boolean | NO | true |  |
| 6 | `created_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `admin_users_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `admin_users_auth_user_id_key` — UNIQUE (auth_user_id)

**Foreign Keys**

- `admin_users_auth_user_id_fkey` — FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `admin_users_role_check` — CHECK ((role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'support'::text])))

**Indexes**

- `admin_users_auth_user_id_key` (btree)
  `CREATE UNIQUE INDEX admin_users_auth_user_id_key ON public.admin_users USING btree (auth_user_id)`
- `admin_users_pkey` (btree)
  `CREATE UNIQUE INDEX admin_users_pkey ON public.admin_users USING btree (id)`
- `idx_admin_users_auth` (btree)
  `CREATE INDEX idx_admin_users_auth ON public.admin_users USING btree (auth_user_id)`

### `anecf_queue`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('anecf_queue_id_seq'::regclass) |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `ticket_id` | bigint | YES |  |  |
| 4 | `ticket_supabase_id` | uuid | YES |  |  |
| 5 | `ncf` | text | NO |  |  |
| 6 | `tipo_ecf` | text | NO |  |  |
| 7 | `rango_desde` | text | NO |  |  |
| 8 | `rango_hasta` | text | NO |  |  |
| 9 | `voided_at` | timestamp with time zone | NO | now() |  |
| 10 | `submitted_at` | timestamp with time zone | YES |  |  |
| 11 | `track_id` | text | YES |  |  |
| 12 | `status` | text | NO | 'pending'::text |  |
| 13 | `error` | text | YES |  |  |
| 14 | `attempts` | integer | NO | 0 |  |
| 15 | `last_tried` | timestamp with time zone | YES |  |  |
| 16 | `environment` | text | NO | 'certecf'::text |  |
| 17 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 18 | `created_at` | timestamp with time zone | NO | now() |  |
| 19 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `anecf_queue_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `anecf_queue_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `anecf_queue_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `anecf_queue_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'submitted'::text, 'failed'::text])))

**Indexes**

- `anecf_queue_pkey` (btree)
  `CREATE UNIQUE INDEX anecf_queue_pkey ON public.anecf_queue USING btree (id)`
- `anecf_queue_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX anecf_queue_supabase_id_key ON public.anecf_queue USING btree (supabase_id)`
- `idx_anecf_queue_pending` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_anecf_queue_pending ON public.anecf_queue USING btree (business_id, status, voided_at) WHERE (status = 'pending'::text)`
- `uq_anecf_queue_biz_ncf` (btree)
  `CREATE UNIQUE INDEX uq_anecf_queue_biz_ncf ON public.anecf_queue USING btree (business_id, ncf)`

### `api_rate_limits`

- Rough row count (n_live_tup): **1180**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('api_rate_limits_id_seq'::regclass) |  |
| 2 | `bucket` | text | NO |  |  |
| 3 | `window_start` | timestamp with time zone | NO |  |  |
| 4 | `count` | integer | NO | 0 |  |
| 5 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `api_rate_limits_pkey` — PRIMARY KEY (id)

**Indexes**

- `api_rate_limits_pkey` (btree)
  `CREATE UNIQUE INDEX api_rate_limits_pkey ON public.api_rate_limits USING btree (id)`
- `idx_api_rate_limits_window_start` (btree)
  `CREATE INDEX idx_api_rate_limits_window_start ON public.api_rate_limits USING btree (window_start)`
- `uq_api_rate_limits_bucket_window` (btree)
  `CREATE UNIQUE INDEX uq_api_rate_limits_bucket_window ON public.api_rate_limits USING btree (bucket, window_start)`

### `app_settings`

- Rough row count (n_live_tup): **362**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `key` | text | NO |  |  |
| 4 | `value` | text | NO | ''::text |  |
| 5 | `updated_at` | timestamp with time zone | NO | now() |  |
| 6 | `supabase_id` | uuid | YES |  |  |
| 7 | `is_device_local` | boolean | NO | false |  |
| 8 | `device_hwid` | text | YES |  |  |

**Primary Key**

- `app_settings_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `app_settings_business_key_hwid_uniq` — UNIQUE NULLS NOT DISTINCT (business_id, key, device_hwid)
- `app_settings_business_supabase_id_key` — UNIQUE (business_id, supabase_id)
- `app_settings_supabase_id_uniq` — UNIQUE (supabase_id)

**Foreign Keys**

- `app_settings_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `app_settings_scope_hwid_consistency` — CHECK ((((is_device_local = false) AND (device_hwid IS NULL)) OR ((is_device_local = true) AND (device_hwid IS NOT NULL))))

**Indexes**

- `app_settings_business_key_hwid_uniq` (btree)
  `CREATE UNIQUE INDEX app_settings_business_key_hwid_uniq ON public.app_settings USING btree (business_id, key, device_hwid) NULLS NOT DISTINCT`
- `app_settings_business_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX app_settings_business_supabase_id_key ON public.app_settings USING btree (business_id, supabase_id)`
- `app_settings_pkey` (btree)
  `CREATE UNIQUE INDEX app_settings_pkey ON public.app_settings USING btree (id)`
- `app_settings_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX app_settings_supabase_id_uniq ON public.app_settings USING btree (supabase_id)`
- `idx_app_settings_biz_hwid` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_app_settings_biz_hwid ON public.app_settings USING btree (business_id, device_hwid) WHERE (device_hwid IS NOT NULL)`
- `idx_app_settings_business` (btree)
  `CREATE INDEX idx_app_settings_business ON public.app_settings USING btree (business_id)`
- `idx_app_settings_business_updated` (btree)
  `CREATE INDEX idx_app_settings_business_updated ON public.app_settings USING btree (business_id, updated_at)`

### `appointment_reminders`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('appointment_reminders_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `appointment_supabase_id` | uuid | NO |  |  |
| 5 | `fire_at` | timestamp with time zone | NO |  |  |
| 6 | `kind` | text | NO |  |  |
| 7 | `status` | text | NO | 'pending'::text |  |
| 8 | `ultramsg_message_id` | text | YES |  |  |
| 9 | `error` | text | YES |  |  |
| 10 | `sent_at` | timestamp with time zone | YES |  |  |
| 11 | `created_at` | timestamp with time zone | YES | now() |  |
| 12 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `appointment_reminders_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `appointment_reminders_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `appointment_reminders_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `appointment_reminders_kind_check` — CHECK ((kind = ANY (ARRAY['24h'::text, '2h'::text, 'manual'::text, 'confirm'::text])))
- `appointment_reminders_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))

**Indexes**

- `appointment_reminders_biz_supabase_idx` (btree)
  `CREATE INDEX appointment_reminders_biz_supabase_idx ON public.appointment_reminders USING btree (business_id, supabase_id)`
- `appointment_reminders_dispatch_idx` (btree)
  `CREATE INDEX appointment_reminders_dispatch_idx ON public.appointment_reminders USING btree (appointment_supabase_id, status, fire_at)`
- `appointment_reminders_pkey` (btree)
  `CREATE UNIQUE INDEX appointment_reminders_pkey ON public.appointment_reminders USING btree (id)`
- `appointment_reminders_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX appointment_reminders_supabase_id_key ON public.appointment_reminders USING btree (supabase_id)`

### `appointments`

- Rough row count (n_live_tup): **20**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | uuid | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `empleado_id` | uuid | YES |  |  |
| 7 | `empleado_supabase_id` | uuid | YES |  |  |
| 8 | `date` | date | NO |  |  |
| 9 | `start_time` | text | NO |  |  |
| 10 | `end_time` | text | YES |  |  |
| 11 | `status` | text | YES | 'scheduled'::text |  |
| 12 | `services` | jsonb | YES | '[]'::jsonb |  |
| 13 | `notes` | text | YES |  |  |
| 14 | `created_at` | timestamp with time zone | YES | now() |  |
| 15 | `updated_at` | timestamp with time zone | YES | now() |  |
| 16 | `is_walk_in` | boolean | YES | false |  |
| 17 | `deposit_dop` | numeric | YES | 0 |  |
| 18 | `deposit_status` | text | YES | 'none'::text |  |
| 19 | `no_show_fee_charged` | boolean | YES | false |  |
| 20 | `public_booking_token` | text | YES |  |  |
| 21 | `client_membership_supabase_id` | uuid | YES |  |  |
| 22 | `no_show_fee_ticket_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `appointments_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `appointments_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_appointments_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `appointments_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `appointments_deposit_status_check` — CHECK (((deposit_status IS NULL) OR (deposit_status = ANY (ARRAY['none'::text, 'held'::text, 'applied'::text, 'forfeited'::text, 'refunded'::text]))))

**Indexes**

- `appointments_no_double_book_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX appointments_no_double_book_idx ON public.appointments USING btree (business_id, empleado_supabase_id, date, start_time) WHERE (status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))`
- `appointments_no_show_fee_ticket_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX appointments_no_show_fee_ticket_idx ON public.appointments USING btree (no_show_fee_ticket_supabase_id) WHERE (no_show_fee_ticket_supabase_id IS NOT NULL)`
- `appointments_pkey` (btree)
  `CREATE UNIQUE INDEX appointments_pkey ON public.appointments USING btree (id)`
- `appointments_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX appointments_supabase_id_uniq ON public.appointments USING btree (supabase_id)`
- `uq_appointments_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_appointments_biz_sid ON public.appointments USING btree (business_id, supabase_id)`

### `aseguradoras`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('aseguradoras_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `nombre` | text | NO |  |  |
| 5 | `rnc` | text | YES |  |  |
| 6 | `contacto_telefono` | text | YES |  |  |
| 7 | `contacto_email` | text | YES |  |  |
| 8 | `ecf_mode` | text | NO | 'per_wo'::text |  |
| 9 | `notas` | text | YES |  |  |
| 10 | `active` | boolean | YES | true |  |
| 11 | `created_at` | timestamp with time zone | YES | now() |  |
| 12 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `aseguradoras_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `aseguradoras_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `aseguradoras_supabase_id_key` — UNIQUE (supabase_id)
- `uq_aseguradoras_biz_rnc` — UNIQUE (business_id, rnc)

**Foreign Keys**

- `aseguradoras_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `aseguradoras_ecf_mode_check` — CHECK ((ecf_mode = ANY (ARRAY['per_wo'::text, 'monthly_batch'::text])))

**Indexes**

- `aseguradoras_biz_active_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX aseguradoras_biz_active_idx ON public.aseguradoras USING btree (business_id) WHERE (active = true)`
- `aseguradoras_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX aseguradoras_business_supabase_uk ON public.aseguradoras USING btree (business_id, supabase_id)`
- `aseguradoras_pkey` (btree)
  `CREATE UNIQUE INDEX aseguradoras_pkey ON public.aseguradoras USING btree (id)`
- `aseguradoras_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX aseguradoras_supabase_id_key ON public.aseguradoras USING btree (supabase_id)`
- `uq_aseguradoras_biz_rnc` (btree)
  `CREATE UNIQUE INDEX uq_aseguradoras_biz_rnc ON public.aseguradoras USING btree (business_id, rnc)`
- `uq_aseguradoras_rnc` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_aseguradoras_rnc ON public.aseguradoras USING btree (business_id, rnc) WHERE ((rnc IS NOT NULL) AND (rnc <> ''::text))`

### `bank_preapprovals`

- Rough row count (n_live_tup): **3**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('bank_preapprovals_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | bigint | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `lead_supabase_id` | uuid | YES |  |  |
| 7 | `vehicle_inventory_supabase_id` | uuid | YES |  |  |
| 8 | `salesperson_id` | bigint | YES |  |  |
| 9 | `salesperson_supabase_id` | uuid | YES |  |  |
| 10 | `bank` | text | NO |  |  |
| 11 | `bank_contact` | text | YES |  |  |
| 12 | `requested_amount` | numeric | YES | 0 |  |
| 13 | `term_months` | integer | YES |  |  |
| 14 | `rate_offered` | numeric | YES |  |  |
| 15 | `monthly_quota_offered` | numeric | YES |  |  |
| 16 | `status` | text | YES | 'solicitada'::text |  |
| 17 | `expires_at` | timestamp with time zone | YES |  |  |
| 18 | `decision_at` | timestamp with time zone | YES |  |  |
| 19 | `decision_letter_url` | text | YES |  |  |
| 20 | `notes` | text | YES |  |  |
| 21 | `active` | boolean | NO | true |  |
| 22 | `created_at` | timestamp with time zone | YES | now() |  |
| 23 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `bank_preapprovals_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `bank_preapprovals_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `bank_preapprovals_status_check` — CHECK ((status = ANY (ARRAY['solicitada'::text, 'en_revision'::text, 'pre_aprobada'::text, 'rechazada'::text, 'expirada'::text, 'utilizada'::text])))

**Indexes**

- `bank_preapprovals_pkey` (btree)
  `CREATE UNIQUE INDEX bank_preapprovals_pkey ON public.bank_preapprovals USING btree (id)`
- `bank_preapprovals_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX bank_preapprovals_supabase_id_key ON public.bank_preapprovals USING btree (supabase_id)`
- `idx_bank_preapprovals_business` (btree)
  `CREATE INDEX idx_bank_preapprovals_business ON public.bank_preapprovals USING btree (business_id)`
- `idx_bank_preapprovals_client` (btree)
  `CREATE INDEX idx_bank_preapprovals_client ON public.bank_preapprovals USING btree (client_supabase_id)`
- `idx_bank_preapprovals_expires` (btree)
  `CREATE INDEX idx_bank_preapprovals_expires ON public.bank_preapprovals USING btree (expires_at)`
- `idx_bank_preapprovals_status` (btree)
  `CREATE INDEX idx_bank_preapprovals_status ON public.bank_preapprovals USING btree (status)`

### `business_type_configs`

- Rough row count (n_live_tup): **6**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `type` | text | NO |  |  |
| 2 | `label_es` | text | NO |  |  |
| 3 | `label_en` | text | NO |  |  |
| 4 | `description_es` | text | YES |  |  |
| 5 | `description_en` | text | YES |  |  |
| 6 | `icon` | text | YES |  |  |
| 7 | `modules` | jsonb | NO | '[]'::jsonb |  |
| 8 | `ui` | jsonb | NO | '{}'::jsonb |  |
| 9 | `enabled` | boolean | NO | true |  |
| 10 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `business_type_configs_pkey` — PRIMARY KEY (type)

**Indexes**

- `business_type_configs_pkey` (btree)
  `CREATE UNIQUE INDEX business_type_configs_pkey ON public.business_type_configs USING btree (type)`

### `businesses`

- Rough row count (n_live_tup): **38**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `name` | text | NO |  |  |
| 3 | `rnc` | text | YES |  |  |
| 4 | `created_at` | timestamp with time zone | YES | now() |  |
| 5 | `owner_id` | uuid | YES |  |  |
| 6 | `address` | text | YES | ''::text |  |
| 7 | `phone` | text | YES | ''::text |  |
| 8 | `email` | text | YES | ''::text |  |
| 9 | `logo_url` | text | YES |  |  |
| 10 | `settings` | jsonb | NO | '{}'::jsonb |  |
| 11 | `updated_at` | timestamp with time zone | NO | now() |  |
| 12 | `plan` | text | NO | 'free'::text |  |
| 13 | `is_demo` | boolean | NO | false |  |
| 14 | `mora_rate_daily` | numeric | YES | 0.005 |  |

**Primary Key**

- `businesses_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `businesses_owner_id_fkey` — FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `businesses_pkey` (btree)
  `CREATE UNIQUE INDEX businesses_pkey ON public.businesses USING btree (id)`
- `idx_businesses_is_demo` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_businesses_is_demo ON public.businesses USING btree (is_demo) WHERE (is_demo = false)`
- `idx_businesses_owner` (btree)
  `CREATE INDEX idx_businesses_owner ON public.businesses USING btree (owner_id)`
- `idx_businesses_settings_gin` (gin)
  `CREATE INDEX idx_businesses_settings_gin ON public.businesses USING gin (settings jsonb_path_ops)`

### `caja_chica`

- Rough row count (n_live_tup): **10**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `description` | text | NO |  |  |
| 4 | `category` | text | NO | 'Otros'::text |  |
| 5 | `type` | text | NO | 'Gasto'::text |  |
| 6 | `amount` | numeric | NO |  |  |
| 7 | `recibo` | text | YES |  |  |
| 8 | `status` | text | NO | 'pendiente'::text |  |
| 9 | `approved_by` | uuid | YES |  |  |
| 10 | `cajero_id` | uuid | YES |  |  |
| 11 | `created_at` | timestamp with time zone | NO | now() |  |
| 12 | `local_id` | integer | YES |  |  |
| 13 | `local_approved_by` | integer | YES |  |  |
| 14 | `local_cajero_id` | integer | YES |  |  |
| 15 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 16 | `approved_by_supabase_id` | uuid | YES |  |  |
| 17 | `cajero_supabase_id` | uuid | YES |  |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `caja_chica_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `caja_chica_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_caja_chica_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_caja_chica_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `caja_chica_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `caja_chica_pkey` (btree)
  `CREATE UNIQUE INDEX caja_chica_pkey ON public.caja_chica USING btree (id)`
- `caja_chica_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX caja_chica_supabase_id_uniq ON public.caja_chica USING btree (supabase_id)`
- `uq_caja_chica_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_caja_chica_biz_sid ON public.caja_chica USING btree (business_id, supabase_id)`
- `uq_caja_chica_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_caja_chica_local ON public.caja_chica USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_caja_chica_sid` (btree)
  `CREATE UNIQUE INDEX uq_caja_chica_sid ON public.caja_chica USING btree (business_id, supabase_id)`

### `cajero_commissions`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `cajero_id` | uuid | YES |  |  |
| 4 | `ticket_id` | uuid | YES |  |  |
| 5 | `base_amount` | numeric | NO |  |  |
| 6 | `commission_pct` | numeric | NO |  |  |
| 7 | `commission_amount` | numeric | NO |  |  |
| 8 | `paid` | boolean | NO | false |  |
| 9 | `paid_at` | timestamp with time zone | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `local_id` | integer | YES |  |  |
| 12 | `local_cajero_id` | integer | YES |  |  |
| 13 | `local_ticket_id` | integer | YES |  |  |
| 14 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 15 | `cajero_supabase_id` | uuid | YES |  |  |
| 16 | `ticket_supabase_id` | uuid | YES |  |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |
| 18 | `empleado_supabase_id` | text | YES |  |  |
| 19 | `manual_reason` | text | YES |  |  |

**Primary Key**

- `cajero_commissions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `cajero_commissions_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_cajero_commissions_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `cajero_commissions_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `cajero_commissions_cajero_id_fkey` — FOREIGN KEY (cajero_id) REFERENCES staff(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `cajero_commissions_ticket_id_fkey` — FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `cajero_commissions_ticket_supabase_id_fkey` — FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `cajero_commissions_pkey` (btree)
  `CREATE UNIQUE INDEX cajero_commissions_pkey ON public.cajero_commissions USING btree (id)`
- `cajero_commissions_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX cajero_commissions_supabase_id_uniq ON public.cajero_commissions USING btree (supabase_id)`
- `cajero_commissions_unique_per_ticket_emp` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX cajero_commissions_unique_per_ticket_emp ON public.cajero_commissions USING btree (business_id, ticket_supabase_id, empleado_supabase_id) WHERE ((ticket_supabase_id IS NOT NULL) AND (empleado_supabase_id IS NOT NULL))`
- `idx_cajero_comm_biz` (btree)
  `CREATE INDEX idx_cajero_comm_biz ON public.cajero_commissions USING btree (business_id)`
- `idx_cajero_comm_cajero` (btree)
  `CREATE INDEX idx_cajero_comm_cajero ON public.cajero_commissions USING btree (cajero_id)`
- `idx_cajero_comm_date` (btree)
  `CREATE INDEX idx_cajero_comm_date ON public.cajero_commissions USING btree (business_id, created_at DESC)`
- `idx_cajero_comm_paid` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_cajero_comm_paid ON public.cajero_commissions USING btree (business_id, paid) WHERE (paid = false)`
- `idx_cajero_comm_ticket` (btree)
  `CREATE INDEX idx_cajero_comm_ticket ON public.cajero_commissions USING btree (ticket_id)`
- `idx_cajero_commissions_created_brin` (brin)
  `CREATE INDEX idx_cajero_commissions_created_brin ON public.cajero_commissions USING brin (created_at) WITH (pages_per_range='32')`
- `idx_cajero_commissions_empleado` (btree)
  `CREATE INDEX idx_cajero_commissions_empleado ON public.cajero_commissions USING btree (empleado_supabase_id)`
- `uq_cajero_comm_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_cajero_comm_local ON public.cajero_commissions USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_cajero_commissions_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_cajero_commissions_biz_sid ON public.cajero_commissions USING btree (business_id, supabase_id)`

### `carniceria_corte_categories`

- Rough row count (n_live_tup): **6**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('carniceria_corte_categories_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `nombre` | text | NO |  |  |
| 5 | `nombre_dr_popular` | text | YES |  |  |
| 6 | `tooltip_traduccion` | text | YES |  |  |
| 7 | `especie` | text | NO |  |  |
| 8 | `photo_url` | text | YES |  |  |
| 9 | `nutrition_json` | jsonb | YES |  |  |
| 10 | `sort_order` | integer | YES | 0 |  |
| 11 | `active` | boolean | YES | true |  |
| 12 | `created_at` | timestamp with time zone | YES | now() |  |
| 13 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `carniceria_corte_categories_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `carniceria_corte_categories_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `carniceria_corte_categories_especie_check` — CHECK ((especie = ANY (ARRAY['pollo'::text, 'res'::text, 'cerdo'::text, 'viscera'::text, 'embutidos'::text, 'mariscos'::text, 'otros'::text])))

**Indexes**

- `carniceria_corte_categories_pkey` (btree)
  `CREATE UNIQUE INDEX carniceria_corte_categories_pkey ON public.carniceria_corte_categories USING btree (id)`
- `carniceria_corte_categories_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX carniceria_corte_categories_supabase_id_key ON public.carniceria_corte_categories USING btree (supabase_id)`
- `idx_corte_cat_biz` (btree)
  `CREATE INDEX idx_corte_cat_biz ON public.carniceria_corte_categories USING btree (business_id, active)`

### `carniceria_scales`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('carniceria_scales_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `nombre` | text | NO |  |  |
| 5 | `tipo` | text | NO |  |  |
| 6 | `device_path` | text | YES |  |  |
| 7 | `protocol` | text | YES | 'generic'::text |  |
| 8 | `baud_rate` | integer | YES | 9600 |  |
| 9 | `capacidad_max_lb` | numeric | YES |  |  |
| 10 | `tare_default` | numeric | YES | 0 |  |
| 11 | `active_default` | boolean | YES | false |  |
| 12 | `active` | boolean | YES | true |  |
| 13 | `created_at` | timestamp with time zone | YES | now() |  |
| 14 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `carniceria_scales_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `carniceria_scales_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `carniceria_scales_protocol_check` — CHECK ((protocol = ANY (ARRAY['cas-pdii'::text, 'toledo'::text, 'generic'::text, 'mock'::text])))
- `carniceria_scales_tipo_check` — CHECK ((tipo = ANY (ARRAY['plataforma'::text, 'banco'::text, 'otra'::text])))

**Indexes**

- `carniceria_scales_pkey` (btree)
  `CREATE UNIQUE INDEX carniceria_scales_pkey ON public.carniceria_scales USING btree (id)`
- `carniceria_scales_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX carniceria_scales_supabase_id_key ON public.carniceria_scales USING btree (supabase_id)`
- `idx_scales_biz` (btree)
  `CREATE INDEX idx_scales_biz ON public.carniceria_scales USING btree (business_id, active)`

### `categorias_servicio`

- Rough row count (n_live_tup): **33**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `nombre` | text | NO |  |  |
| 4 | `orden` | integer | NO | 0 |  |
| 5 | `created_at` | timestamp with time zone | NO | now() |  |
| 6 | `local_id` | integer | YES |  |  |
| 7 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 8 | `updated_at` | timestamp with time zone | NO | now() |  |
| 9 | `active` | boolean | YES | true |  |

**Primary Key**

- `categorias_servicio_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `categorias_servicio_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_categorias_servicio_biz_nom` — UNIQUE (business_id, nombre)
- `uq_categorias_servicio_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_categorias_servicio_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `categorias_servicio_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `categorias_servicio_pkey` (btree)
  `CREATE UNIQUE INDEX categorias_servicio_pkey ON public.categorias_servicio USING btree (id)`
- `categorias_servicio_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX categorias_servicio_supabase_id_uniq ON public.categorias_servicio USING btree (supabase_id)`
- `uq_categorias_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_categorias_local ON public.categorias_servicio USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_categorias_natural` (btree)
  `CREATE UNIQUE INDEX uq_categorias_natural ON public.categorias_servicio USING btree (business_id, nombre)`
- `uq_categorias_servicio_biz_name_lower` (btree)
  `CREATE UNIQUE INDEX uq_categorias_servicio_biz_name_lower ON public.categorias_servicio USING btree (business_id, lower(nombre))`
- `uq_categorias_servicio_biz_nom` (btree)
  `CREATE UNIQUE INDEX uq_categorias_servicio_biz_nom ON public.categorias_servicio USING btree (business_id, nombre)`
- `uq_categorias_servicio_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_categorias_servicio_biz_sid ON public.categorias_servicio USING btree (business_id, supabase_id)`
- `uq_categorias_servicio_nombre` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_categorias_servicio_nombre ON public.categorias_servicio USING btree (business_id, nombre) WHERE ((nombre IS NOT NULL) AND (nombre <> ''::text))`
- `uq_categorias_servicio_sid` (btree)
  `CREATE UNIQUE INDEX uq_categorias_servicio_sid ON public.categorias_servicio USING btree (business_id, supabase_id)`

### `claude_alerts_pending`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `feature` | text | NO |  |  |
| 4 | `severity` | text | NO |  |  |
| 5 | `message` | text | NO |  |  |
| 6 | `to_phone` | text | YES |  |  |
| 7 | `sent_at` | timestamp with time zone | YES |  |  |
| 8 | `failed_reason` | text | YES |  |  |
| 9 | `created_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `claude_alerts_pending_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `claude_alerts_pending_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `claude_alerts_pending_severity_check` — CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'critical'::text])))

**Indexes**

- `claude_alerts_pending_pkey` (btree)
  `CREATE UNIQUE INDEX claude_alerts_pending_pkey ON public.claude_alerts_pending USING btree (id)`
- `idx_claude_alerts_pending_unsent` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_claude_alerts_pending_unsent ON public.claude_alerts_pending USING btree (created_at DESC) WHERE (sent_at IS NULL)`

### `claude_feature_flags`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `business_id` | uuid | NO |  |  |
| 2 | `dgii_error_translator` | boolean | NO | false |  |
| 3 | `cuadre_anomaly` | boolean | NO | false |  |
| 4 | `insights_digest` | boolean | NO | false |  |
| 5 | `reorder_suggestions` | boolean | NO | false |  |
| 6 | `faq_autoreply` | boolean | NO | false |  |
| 7 | `monthly_budget_usd` | numeric | NO | 2.00 |  |
| 8 | `spent_this_month_usd` | numeric | NO | 0 |  |
| 9 | `spent_reset_at` | date | NO | (date_trunc('month'::text, now()))::date |  |
| 10 | `updated_at` | timestamp with time zone | NO | now() |  |
| 11 | `updated_by` | text | YES |  |  |

**Primary Key**

- `claude_feature_flags_pkey` — PRIMARY KEY (business_id)

**Foreign Keys**

- `claude_feature_flags_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `claude_feature_flags_pkey` (btree)
  `CREATE UNIQUE INDEX claude_feature_flags_pkey ON public.claude_feature_flags USING btree (business_id)`
- `idx_claude_feature_flags_updated_at` (btree)
  `CREATE INDEX idx_claude_feature_flags_updated_at ON public.claude_feature_flags USING btree (updated_at DESC)`

### `client_dgii_credentials`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('client_dgii_credentials_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `firm_business_id` | uuid | NO |  |  |
| 4 | `client_business_id` | uuid | NO |  |  |
| 5 | `rnc` | text | NO |  |  |
| 6 | `cred_cipher` | text | YES |  |  |
| 7 | `cred_iv` | text | YES |  |  |
| 8 | `cred_salt` | text | YES |  |  |
| 9 | `last_pull_at` | timestamp with time zone | YES |  |  |
| 10 | `last_pull_count` | integer | YES |  |  |
| 11 | `last_pull_error` | text | YES |  |  |
| 12 | `status` | text | NO | 'active'::text |  |
| 13 | `created_at` | timestamp with time zone | NO | now() |  |
| 14 | `updated_at` | timestamp with time zone | NO | now() |  |
| 15 | `session_cookie` | text | YES |  |  |
| 16 | `session_cookie_expires_at` | timestamp with time zone | YES |  |  |
| 17 | `srv_user` | text | YES |  |  |
| 18 | `srv_cred_cipher` | text | YES |  |  |
| 19 | `srv_cred_iv` | text | YES |  |  |

**Primary Key**

- `client_dgii_credentials_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `client_dgii_credentials_client_business_id_key` — UNIQUE (client_business_id)
- `client_dgii_credentials_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `client_dgii_credentials_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'failed'::text, 'revoked'::text])))

**Indexes**

- `client_dgii_credentials_client_business_id_key` (btree)
  `CREATE UNIQUE INDEX client_dgii_credentials_client_business_id_key ON public.client_dgii_credentials USING btree (client_business_id)`
- `client_dgii_credentials_pkey` (btree)
  `CREATE UNIQUE INDEX client_dgii_credentials_pkey ON public.client_dgii_credentials USING btree (id)`
- `client_dgii_credentials_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX client_dgii_credentials_supabase_id_key ON public.client_dgii_credentials USING btree (supabase_id)`
- `client_dgii_creds_firm_idx` (btree)
  `CREATE INDEX client_dgii_creds_firm_idx ON public.client_dgii_credentials USING btree (firm_business_id, status)`

### `client_errors`

- Rough row count (n_live_tup): **23731**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | YES |  |  |
| 3 | `message` | text | NO |  |  |
| 4 | `stack` | text | YES |  |  |
| 5 | `route` | text | YES |  |  |
| 6 | `user_agent` | text | YES |  |  |
| 7 | `app_version` | text | YES |  |  |
| 8 | `user_id` | uuid | YES |  |  |
| 9 | `user_role` | text | YES |  |  |
| 10 | `severity` | text | NO | 'error'::text |  |
| 11 | `resolved_at` | timestamp with time zone | YES |  |  |
| 12 | `resolved_by` | uuid | YES |  |  |
| 13 | `resolution` | text | YES |  |  |
| 14 | `metadata` | jsonb | YES |  |  |
| 15 | `created_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `client_errors_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `client_errors_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `client_errors_resolved_by_fkey` — FOREIGN KEY (resolved_by) REFERENCES admin_users(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_

**Check Constraints**

- `client_errors_severity_check` — CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'critical'::text])))

**Indexes**

- `client_errors_business_id_idx` (btree)
  `CREATE INDEX client_errors_business_id_idx ON public.client_errors USING btree (business_id, created_at DESC)`
- `client_errors_pkey` (btree)
  `CREATE UNIQUE INDEX client_errors_pkey ON public.client_errors USING btree (id)`
- `client_errors_severity_idx` (btree)
  `CREATE INDEX client_errors_severity_idx ON public.client_errors USING btree (severity, created_at DESC)`
- `client_errors_unresolved_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX client_errors_unresolved_idx ON public.client_errors USING btree (created_at DESC) WHERE (resolved_at IS NULL)`
- `idx_client_errors_critical_undiagnosed` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_client_errors_critical_undiagnosed ON public.client_errors USING btree (created_at DESC) WHERE ((severity = 'critical'::text) AND ((metadata ? 'claude_diagnosis'::text) = false))`

### `client_item_prices`

- Rough row count (n_live_tup): **50**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_supabase_id` | uuid | NO |  |  |
| 5 | `inventory_item_supabase_id` | uuid | NO |  |  |
| 6 | `custom_price` | numeric | NO |  |  |
| 7 | `notes` | text | YES |  |  |
| 8 | `created_at` | timestamp with time zone | NO | now() |  |
| 9 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `client_item_prices_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `client_item_prices_biz_client_item_key` — UNIQUE (business_id, client_supabase_id, inventory_item_supabase_id)
- `client_item_prices_business_supabase_id_key` — UNIQUE (business_id, supabase_id)
- `client_item_prices_supabase_id_uniq` — UNIQUE (supabase_id)

**Foreign Keys**

- `client_item_prices_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `client_item_prices_biz_client_item_key` (btree)
  `CREATE UNIQUE INDEX client_item_prices_biz_client_item_key ON public.client_item_prices USING btree (business_id, client_supabase_id, inventory_item_supabase_id)`
- `client_item_prices_business_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX client_item_prices_business_supabase_id_key ON public.client_item_prices USING btree (business_id, supabase_id)`
- `client_item_prices_pkey` (btree)
  `CREATE UNIQUE INDEX client_item_prices_pkey ON public.client_item_prices USING btree (id)`
- `client_item_prices_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX client_item_prices_supabase_id_uniq ON public.client_item_prices USING btree (supabase_id)`
- `idx_cip_biz_client` (btree)
  `CREATE INDEX idx_cip_biz_client ON public.client_item_prices USING btree (business_id, client_supabase_id)`
- `idx_cip_biz_item` (btree)
  `CREATE INDEX idx_cip_biz_item ON public.client_item_prices USING btree (business_id, inventory_item_supabase_id)`
- `idx_cip_updated_at` (btree)
  `CREATE INDEX idx_cip_updated_at ON public.client_item_prices USING btree (updated_at)`

### `client_memberships`

- Rough row count (n_live_tup): **5**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('client_memberships_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_supabase_id` | uuid | NO |  |  |
| 5 | `membership_supabase_id` | uuid | NO |  |  |
| 6 | `sessions_remaining` | integer | NO |  |  |
| 7 | `purchased_at` | timestamp with time zone | YES | now() |  |
| 8 | `expires_at` | timestamp with time zone | NO |  |  |
| 9 | `ticket_supabase_id` | uuid | YES |  |  |
| 10 | `created_at` | timestamp with time zone | YES | now() |  |
| 11 | `updated_at` | timestamp with time zone | YES | now() |  |
| 12 | `cancelled_at` | timestamp with time zone | YES |  |  |
| 13 | `cancelled_reason` | text | YES |  |  |

**Primary Key**

- `client_memberships_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `client_memberships_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `client_memberships_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `client_memberships_biz_supabase_idx` (btree)
  `CREATE INDEX client_memberships_biz_supabase_idx ON public.client_memberships USING btree (business_id, supabase_id)`
- `client_memberships_client_expires_idx` (btree)
  `CREATE INDEX client_memberships_client_expires_idx ON public.client_memberships USING btree (client_supabase_id, expires_at)`
- `client_memberships_pkey` (btree)
  `CREATE UNIQUE INDEX client_memberships_pkey ON public.client_memberships USING btree (id)`
- `client_memberships_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX client_memberships_supabase_id_key ON public.client_memberships USING btree (supabase_id)`

### `client_received_ecfs`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('client_received_ecfs_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `firm_business_id` | uuid | NO |  |  |
| 4 | `client_business_id` | uuid | NO |  |  |
| 5 | `client_rnc` | text | NO |  |  |
| 6 | `ecf_type` | text | NO |  |  |
| 7 | `ncf` | text | NO |  |  |
| 8 | `ncf_modificado` | text | YES |  |  |
| 9 | `fecha_emision` | date | YES |  |  |
| 10 | `fecha_vencimiento` | date | YES |  |  |
| 11 | `emisor_rnc` | text | YES |  |  |
| 12 | `emisor_razon_social` | text | YES |  |  |
| 13 | `monto_facturado` | numeric | NO | 0 |  |
| 14 | `itbis_facturado` | numeric | NO | 0 |  |
| 15 | `itbis_rate` | smallint | NO | 18 |  |
| 16 | `itbis_retenido` | numeric | NO | 0 |  |
| 17 | `isr_retenido` | numeric | NO | 0 |  |
| 18 | `monto_total` | numeric | NO | 0 |  |
| 19 | `tipo_bienes_servicios` | smallint | YES |  |  |
| 20 | `classification_source` | text | NO | 'pending'::text |  |
| 21 | `classification_confidence` | numeric | YES | 0 |  |
| 22 | `posted_to_606` | smallint | NO | 0 |  |
| 23 | `posted_journal_entry_id` | bigint | YES |  |  |
| 24 | `raw_xml_url` | text | YES |  |  |
| 25 | `source` | text | NO | 'dgii_pull'::text |  |
| 26 | `created_at` | timestamp with time zone | NO | now() |  |
| 27 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `client_received_ecfs_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `client_received_ecfs_dedupe` — UNIQUE (client_business_id, ncf)
- `client_received_ecfs_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `client_received_ecfs_classification_source_check` — CHECK ((classification_source = ANY (ARRAY['pending'::text, 'ai'::text, 'manual'::text, 'rule'::text])))
- `client_received_ecfs_source_check` — CHECK ((source = ANY (ARRAY['dgii_pull'::text, 'manual'::text, 'xml_upload'::text, 'api'::text])))

**Indexes**

- `client_received_ecfs_dedupe` (btree)
  `CREATE UNIQUE INDEX client_received_ecfs_dedupe ON public.client_received_ecfs USING btree (client_business_id, ncf)`
- `client_received_ecfs_firm_idx` (btree)
  `CREATE INDEX client_received_ecfs_firm_idx ON public.client_received_ecfs USING btree (firm_business_id, fecha_emision DESC)`
- `client_received_ecfs_period_idx` (btree)
  `CREATE INDEX client_received_ecfs_period_idx ON public.client_received_ecfs USING btree (client_business_id, fecha_emision DESC)`
- `client_received_ecfs_pkey` (btree)
  `CREATE UNIQUE INDEX client_received_ecfs_pkey ON public.client_received_ecfs USING btree (id)`
- `client_received_ecfs_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX client_received_ecfs_supabase_id_key ON public.client_received_ecfs USING btree (supabase_id)`
- `client_received_ecfs_unposted_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX client_received_ecfs_unposted_idx ON public.client_received_ecfs USING btree (client_business_id, fecha_emision DESC) WHERE (posted_to_606 = 0)`

### `client_service_rates`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('client_service_rates_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | bigint | YES |  |  |
| 5 | `client_supabase_id` | uuid | NO |  |  |
| 6 | `service_id` | bigint | YES |  |  |
| 7 | `service_supabase_id` | uuid | NO |  |  |
| 8 | `custom_price` | numeric | NO |  |  |
| 9 | `notes` | text | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `updated_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `client_service_rates_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `client_service_rates_biz_client_service_unique` — UNIQUE (business_id, client_supabase_id, service_supabase_id)
- `client_service_rates_biz_sid_unique` — UNIQUE (business_id, supabase_id)
- `client_service_rates_supabase_id_uniq` — UNIQUE (supabase_id)

**Indexes**

- `client_service_rates_biz_client_service_unique` (btree)
  `CREATE UNIQUE INDEX client_service_rates_biz_client_service_unique ON public.client_service_rates USING btree (business_id, client_supabase_id, service_supabase_id)`
- `client_service_rates_biz_sid_unique` (btree)
  `CREATE UNIQUE INDEX client_service_rates_biz_sid_unique ON public.client_service_rates USING btree (business_id, supabase_id)`
- `client_service_rates_pkey` (btree)
  `CREATE UNIQUE INDEX client_service_rates_pkey ON public.client_service_rates USING btree (id)`
- `client_service_rates_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX client_service_rates_supabase_id_uniq ON public.client_service_rates USING btree (supabase_id)`
- `idx_csr_client` (btree)
  `CREATE INDEX idx_csr_client ON public.client_service_rates USING btree (business_id, client_supabase_id)`

### `clients`

- Rough row count (n_live_tup): **134**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `name` | text | NO |  |  |
| 4 | `rnc` | text | YES |  |  |
| 5 | `phone` | text | YES |  |  |
| 6 | `email` | text | YES |  |  |
| 7 | `address` | text | YES |  |  |
| 8 | `credit_limit` | numeric | NO | 0 |  |
| 9 | `balance` | numeric | NO | 0 |  |
| 10 | `visits` | integer | NO | 0 |  |
| 11 | `total_spent` | numeric | NO | 0 |  |
| 12 | `notes` | text | YES |  |  |
| 13 | `active` | boolean | NO | true |  |
| 14 | `created_at` | timestamp with time zone | NO | now() |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |
| 16 | `local_id` | integer | YES |  |  |
| 17 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 18 | `loyalty_points` | numeric | NO | 0 |  |
| 19 | `allergies` | text | YES |  |  |
| 20 | `preferred_stylist_supabase_id` | uuid | YES |  |  |
| 21 | `legacy_source` | text | YES |  |  |
| 22 | `legacy_code` | text | YES |  |  |
| 23 | `loyalty_tier` | text | YES | 'bronze'::text |  |
| 24 | `birthday_treat_available` | boolean | YES | false |  |
| 25 | `preferred_stylist_id` | integer | YES |  |  |
| 26 | `loyalty_lifetime_earned` | numeric | YES | 0 |  |
| 27 | `no_show_count` | integer | YES | 0 |  |
| 28 | `last_no_show_at` | timestamp with time zone | YES |  |  |
| 29 | `wa_opt_out` | boolean | NO | false |  |

**Primary Key**

- `clients_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `clients_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_clients_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_clients_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `clients_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `clients_pkey` (btree)
  `CREATE UNIQUE INDEX clients_pkey ON public.clients USING btree (id)`
- `clients_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX clients_supabase_id_uniq ON public.clients USING btree (supabase_id)`
- `idx_clients_business` (btree)
  `CREATE INDEX idx_clients_business ON public.clients USING btree (business_id)`
- `idx_clients_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_clients_local ON public.clients USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `idx_clients_preferred_stylist` (btree)
  `CREATE INDEX idx_clients_preferred_stylist ON public.clients USING btree (preferred_stylist_supabase_id)`
- `uq_clients_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_clients_biz_sid ON public.clients USING btree (business_id, supabase_id)`
- `uq_clients_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_clients_local ON public.clients USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_clients_rnc` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_clients_rnc ON public.clients USING btree (business_id, rnc) WHERE ((rnc IS NOT NULL) AND (rnc <> ''::text))`
- `uq_clients_sid` (btree)
  `CREATE UNIQUE INDEX uq_clients_sid ON public.clients USING btree (business_id, supabase_id)`

### `collections_attempts`

- Rough row count (n_live_tup): **3**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `loan_supabase_id` | uuid | YES |  |  |
| 5 | `attempt_at` | timestamp with time zone | YES | now() |  |
| 6 | `outcome` | text | YES |  |  |
| 7 | `notes` | text | YES |  |  |
| 8 | `next_followup_at` | timestamp with time zone | YES |  |  |
| 9 | `whatsapp_sent` | boolean | YES | false |  |
| 10 | `created_at` | timestamp with time zone | YES | now() |  |
| 11 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `collections_attempts_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `collections_attempts_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_collections_attempts_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `collections_attempts_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `collections_attempts_outcome_check` — CHECK ((outcome = ANY (ARRAY['called'::text, 'promised'::text, 'paid'::text, 'no_answer'::text, 'refused'::text])))

**Indexes**

- `collections_attempts_pkey` (btree)
  `CREATE UNIQUE INDEX collections_attempts_pkey ON public.collections_attempts USING btree (id)`
- `collections_attempts_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX collections_attempts_supabase_id_uniq ON public.collections_attempts USING btree (supabase_id)`
- `uq_collections_attempts_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_collections_attempts_biz_sid ON public.collections_attempts USING btree (business_id, supabase_id)`

### `collections_log`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | bigint | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `loan_id` | bigint | YES |  |  |
| 7 | `loan_supabase_id` | uuid | YES |  |  |
| 8 | `channel` | text | NO |  |  |
| 9 | `outcome` | text | YES |  |  |
| 10 | `notes` | text | YES |  |  |
| 11 | `contacted_at` | timestamp with time zone | NO | now() |  |
| 12 | `next_contact_date` | date | YES |  |  |
| 13 | `created_by_staff_id` | bigint | YES |  |  |
| 14 | `created_at` | timestamp with time zone | NO | now() |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `collections_log_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `collections_log_business_supabase_unique` — UNIQUE (business_id, supabase_id)
- `collections_log_supabase_id_uniq` — UNIQUE (supabase_id)

**Indexes**

- `collections_log_business_supabase_unique` (btree)
  `CREATE UNIQUE INDEX collections_log_business_supabase_unique ON public.collections_log USING btree (business_id, supabase_id)`
- `collections_log_pkey` (btree)
  `CREATE UNIQUE INDEX collections_log_pkey ON public.collections_log USING btree (id)`
- `collections_log_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX collections_log_supabase_id_uniq ON public.collections_log USING btree (supabase_id)`
- `idx_collections_log_client` (btree)
  `CREATE INDEX idx_collections_log_client ON public.collections_log USING btree (client_supabase_id)`
- `idx_collections_log_loan` (btree)
  `CREATE INDEX idx_collections_log_loan ON public.collections_log USING btree (loan_supabase_id)`
- `idx_collections_log_next` (btree)
  `CREATE INDEX idx_collections_log_next ON public.collections_log USING btree (business_id, next_contact_date)`

### `compras_607`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `rnc_proveedor` | text | NO | ''::text |  |
| 4 | `nombre_proveedor` | text | NO | ''::text |  |
| 5 | `tipo_ncf` | text | NO | 'B01'::text |  |
| 6 | `ncf` | text | NO | ''::text |  |
| 7 | `ncf_modificado` | text | YES | ''::text |  |
| 8 | `fecha_ncf` | date | NO | CURRENT_DATE |  |
| 9 | `fecha_pago` | date | YES |  |  |
| 10 | `monto_servicios` | numeric | NO | 0 |  |
| 11 | `monto_bienes` | numeric | NO | 0 |  |
| 12 | `total` | numeric | NO | 0 |  |
| 13 | `itbis_facturado` | numeric | NO | 0 |  |
| 14 | `itbis_retenido` | numeric | NO | 0 |  |
| 15 | `retencion_renta` | numeric | NO | 0 |  |
| 16 | `forma_pago` | text | NO | 'efectivo'::text |  |
| 17 | `notas` | text | YES |  |  |
| 18 | `created_at` | timestamp with time zone | NO | now() |  |
| 19 | `local_id` | integer | YES |  |  |
| 20 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 21 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `compras_607_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `compras_607_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_compras_607_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_compras_607_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `compras_607_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `compras_607_pkey` (btree)
  `CREATE UNIQUE INDEX compras_607_pkey ON public.compras_607 USING btree (id)`
- `compras_607_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX compras_607_supabase_id_uniq ON public.compras_607 USING btree (supabase_id)`
- `uq_compras_607_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_compras_607_biz_sid ON public.compras_607 USING btree (business_id, supabase_id)`
- `uq_compras_607_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_compras_607_local ON public.compras_607 USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_compras_607_sid` (btree)
  `CREATE UNIQUE INDEX uq_compras_607_sid ON public.compras_607 USING btree (business_id, supabase_id)`

### `configuracion`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `clave` | text | NO |  |  |
| 4 | `valor` | text | YES |  |  |
| 5 | `created_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `configuracion_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `configuracion_business_id_clave_key` — UNIQUE (business_id, clave)

**Foreign Keys**

- `configuracion_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `configuracion_business_id_clave_key` (btree)
  `CREATE UNIQUE INDEX configuracion_business_id_clave_key ON public.configuracion USING btree (business_id, clave)`
- `configuracion_pkey` (btree)
  `CREATE UNIQUE INDEX configuracion_pkey ON public.configuracion USING btree (id)`

### `credit_payments`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `client_id` | uuid | YES |  |  |
| 4 | `ticket_ids` | jsonb | NO | '[]'::jsonb |  |
| 5 | `amount` | numeric | NO |  |  |
| 6 | `payment_method` | text | NO | 'cash'::text |  |
| 7 | `ncf` | text | YES |  |  |
| 8 | `notes` | text | YES |  |  |
| 9 | `cajero_id` | uuid | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `local_id` | integer | YES |  |  |
| 12 | `local_client_id` | integer | YES |  |  |
| 13 | `local_cajero_id` | integer | YES |  |  |
| 14 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 15 | `client_supabase_id` | uuid | YES |  |  |
| 16 | `cajero_supabase_id` | uuid | YES |  |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `credit_payments_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `credit_payments_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_credit_payments_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_credit_payments_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `credit_payments_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `credit_payments_pkey` (btree)
  `CREATE UNIQUE INDEX credit_payments_pkey ON public.credit_payments USING btree (id)`
- `credit_payments_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX credit_payments_supabase_id_uniq ON public.credit_payments USING btree (supabase_id)`
- `idx_credit_payments_business` (btree)
  `CREATE INDEX idx_credit_payments_business ON public.credit_payments USING btree (business_id)`
- `uq_credit_pay_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_credit_pay_local ON public.credit_payments USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_credit_payments_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_credit_payments_biz_sid ON public.credit_payments USING btree (business_id, supabase_id)`
- `uq_credit_payments_sid` (btree)
  `CREATE UNIQUE INDEX uq_credit_payments_sid ON public.credit_payments USING btree (business_id, supabase_id)`

### `crm_lead_activity`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `lead_id` | uuid | NO |  |  |
| 3 | `admin_user_id` | uuid | YES |  |  |
| 4 | `admin_name` | text | YES |  |  |
| 5 | `kind` | text | NO | 'note'::text |  |
| 6 | `body` | text | YES |  |  |
| 7 | `metadata` | jsonb | YES |  |  |
| 8 | `created_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `crm_lead_activity_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `crm_lead_activity_admin_user_id_fkey` — FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_
- `crm_lead_activity_lead_id_fkey` — FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `crm_lead_activity_kind_check` — CHECK ((kind = ANY (ARRAY['note'::text, 'call'::text, 'whatsapp'::text, 'email'::text, 'status_change'::text, 'assignment'::text, 'followup_set'::text])))

**Indexes**

- `crm_lead_activity_admin_idx` (btree)
  `CREATE INDEX crm_lead_activity_admin_idx ON public.crm_lead_activity USING btree (admin_user_id, created_at DESC)`
- `crm_lead_activity_lead_idx` (btree)
  `CREATE INDEX crm_lead_activity_lead_idx ON public.crm_lead_activity USING btree (lead_id, created_at DESC)`
- `crm_lead_activity_pkey` (btree)
  `CREATE UNIQUE INDEX crm_lead_activity_pkey ON public.crm_lead_activity USING btree (id)`

### `crm_leads`

- Rough row count (n_live_tup): **11**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | YES |  |  |
| 3 | `email` | text | YES |  |  |
| 4 | `phone` | text | YES |  |  |
| 5 | `contact_name` | text | YES |  |  |
| 6 | `business_name` | text | YES |  |  |
| 7 | `rnc` | text | YES |  |  |
| 8 | `requested_plan` | text | YES |  |  |
| 9 | `utm_source` | text | YES |  |  |
| 10 | `utm_medium` | text | YES |  |  |
| 11 | `utm_campaign` | text | YES |  |  |
| 12 | `business_type` | text | YES |  |  |
| 13 | `assigned_to` | uuid | YES |  |  |
| 14 | `status` | text | NO | 'new'::text |  |
| 15 | `last_contacted_at` | timestamp with time zone | YES |  |  |
| 16 | `next_followup_at` | timestamp with time zone | YES |  |  |
| 17 | `source` | text | NO | 'signup'::text |  |
| 18 | `created_at` | timestamp with time zone | NO | now() |  |
| 19 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `crm_leads_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `crm_leads_business_uniq` — UNIQUE (business_id)

**Foreign Keys**

- `crm_leads_assigned_to_fkey` — FOREIGN KEY (assigned_to) REFERENCES admin_users(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_
- `crm_leads_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_

**Check Constraints**

- `crm_leads_source_check` — CHECK ((source = ANY (ARRAY['signup'::text, 'manual'::text, 'import'::text])))
- `crm_leads_status_check` — CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'qualified'::text, 'demo_scheduled'::text, 'proposal'::text, 'won'::text, 'lost'::text])))

**Indexes**

- `crm_leads_assigned_to_idx` (btree)
  `CREATE INDEX crm_leads_assigned_to_idx ON public.crm_leads USING btree (assigned_to)`
- `crm_leads_business_id_uniq` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX crm_leads_business_id_uniq ON public.crm_leads USING btree (business_id) WHERE (business_id IS NOT NULL)`
- `crm_leads_business_uniq` (btree)
  `CREATE UNIQUE INDEX crm_leads_business_uniq ON public.crm_leads USING btree (business_id)`
- `crm_leads_created_at_idx` (btree)
  `CREATE INDEX crm_leads_created_at_idx ON public.crm_leads USING btree (created_at DESC)`
- `crm_leads_followup_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX crm_leads_followup_idx ON public.crm_leads USING btree (next_followup_at) WHERE (next_followup_at IS NOT NULL)`
- `crm_leads_pkey` (btree)
  `CREATE UNIQUE INDEX crm_leads_pkey ON public.crm_leads USING btree (id)`
- `crm_leads_plan_idx` (btree)
  `CREATE INDEX crm_leads_plan_idx ON public.crm_leads USING btree (requested_plan)`
- `crm_leads_status_idx` (btree)
  `CREATE INDEX crm_leads_status_idx ON public.crm_leads USING btree (status)`

### `cron_health_runs`

- Rough row count (n_live_tup): **54**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `ran_at` | timestamp with time zone | NO | now() |  |
| 3 | `total_checks` | integer | NO |  |  |
| 4 | `passed_count` | integer | NO |  |  |
| 5 | `failed_count` | integer | NO |  |  |
| 6 | `failures` | jsonb | YES |  |  |
| 7 | `duration_ms` | integer | YES |  |  |
| 8 | `claude_diagnosed_at` | timestamp with time zone | YES |  |  |
| 9 | `claude_diagnosis` | jsonb | YES |  |  |

**Primary Key**

- `cron_health_runs_pkey` — PRIMARY KEY (id)

**Indexes**

- `cron_health_runs_pkey` (btree)
  `CREATE UNIQUE INDEX cron_health_runs_pkey ON public.cron_health_runs USING btree (id)`
- `idx_cron_health_runs_ran_at` (btree)
  `CREATE INDEX idx_cron_health_runs_ran_at ON public.cron_health_runs USING btree (ran_at DESC)`
- `idx_cron_health_runs_undiagnosed_fails` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_cron_health_runs_undiagnosed_fails ON public.cron_health_runs USING btree (ran_at DESC) WHERE ((claude_diagnosed_at IS NULL) AND (failed_count > 0))`

### `cuadre_caja`

- Rough row count (n_live_tup): **27**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `cajero_id` | uuid | YES |  |  |
| 4 | `date` | date | NO |  |  |
| 5 | `fondo` | numeric | NO | 5000 |  |
| 6 | `efectivo_conteo` | numeric | NO | 0 |  |
| 7 | `efectivo_sistema` | numeric | NO | 0 |  |
| 8 | `tarjeta` | numeric | NO | 0 |  |
| 9 | `transferencia` | numeric | NO | 0 |  |
| 10 | `cheque` | numeric | NO | 0 |  |
| 11 | `creditos` | numeric | NO | 0 |  |
| 12 | `salidas` | numeric | NO | 0 |  |
| 13 | `total_vendido` | numeric | NO | 0 |  |
| 14 | `total_cobrado` | numeric | NO | 0 |  |
| 15 | `cierre_total` | numeric | NO | 0 |  |
| 16 | `diferencia` | numeric | NO | 0 |  |
| 17 | `comentario` | text | YES |  |  |
| 18 | `denominaciones` | jsonb | YES | '{}'::jsonb |  |
| 19 | `closed_at` | timestamp with time zone | NO | now() |  |
| 20 | `local_id` | integer | YES |  |  |
| 21 | `local_cajero_id` | integer | YES |  |  |
| 22 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 23 | `cajero_supabase_id` | uuid | YES |  |  |
| 24 | `updated_at` | timestamp with time zone | NO | now() |  |
| 25 | `status` | text | YES | 'cerrado'::text |  |
| 26 | `opened_at` | timestamp with time zone | YES |  |  |
| 27 | `opening_cash` | numeric | YES |  |  |
| 28 | `start_location_supabase_id` | uuid | YES |  |  |
| 29 | `start_lat` | double precision | YES |  |  |
| 30 | `start_lng` | double precision | YES |  |  |
| 31 | `start_notes` | text | YES |  |  |

**Primary Key**

- `cuadre_caja_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `cuadre_caja_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_cuadre_caja_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `cuadre_caja_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `cuadre_caja_pkey` (btree)
  `CREATE UNIQUE INDEX cuadre_caja_pkey ON public.cuadre_caja USING btree (id)`
- `cuadre_caja_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX cuadre_caja_supabase_id_uniq ON public.cuadre_caja USING btree (supabase_id)`
- `idx_cuadre_business` (btree)
  `CREATE INDEX idx_cuadre_business ON public.cuadre_caja USING btree (business_id)`
- `uq_cuadre_caja_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_cuadre_caja_biz_sid ON public.cuadre_caja USING btree (business_id, supabase_id)`
- `uq_cuadre_caja_one_open_per_day` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_cuadre_caja_one_open_per_day ON public.cuadre_caja USING btree (business_id, date) WHERE (status = 'abierto'::text)`
- `uq_cuadre_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_cuadre_local ON public.cuadre_caja USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`

### `demo_sessions`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES | gen_random_uuid() |  |
| 3 | `vertical` | text | NO |  |  |
| 4 | `ip` | text | YES |  |  |
| 5 | `user_agent` | text | YES |  |  |
| 6 | `staff_id` | uuid | YES |  |  |
| 7 | `business_id` | uuid | YES |  |  |
| 8 | `created_at` | timestamp with time zone | NO | now() |  |
| 9 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `demo_sessions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `demo_sessions_supabase_id_key` — UNIQUE (supabase_id)

**Indexes**

- `demo_sessions_pkey` (btree)
  `CREATE UNIQUE INDEX demo_sessions_pkey ON public.demo_sessions USING btree (id)`
- `demo_sessions_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX demo_sessions_supabase_id_key ON public.demo_sessions USING btree (supabase_id)`
- `idx_demo_sessions_created_at` (btree)
  `CREATE INDEX idx_demo_sessions_created_at ON public.demo_sessions USING btree (created_at DESC)`
- `idx_demo_sessions_ip` (btree)
  `CREATE INDEX idx_demo_sessions_ip ON public.demo_sessions USING btree (ip)`
- `idx_demo_sessions_vertical` (btree)
  `CREATE INDEX idx_demo_sessions_vertical ON public.demo_sessions USING btree (vertical)`

### `deploy_smoke_results`

- Rough row count (n_live_tup): **117**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `ran_at` | timestamp with time zone | NO | now() |  |
| 3 | `bundle_hash` | text | YES |  |  |
| 4 | `passed_count` | integer | NO |  |  |
| 5 | `failed_count` | integer | NO |  |  |
| 6 | `total_count` | integer | NO |  |  |
| 7 | `failures` | jsonb | YES |  |  |
| 8 | `duration_ms` | integer | YES |  |  |
| 9 | `source` | text | YES |  |  |
| 10 | `claude_diagnosed_at` | timestamp with time zone | YES |  |  |
| 11 | `claude_diagnosis` | jsonb | YES |  |  |

**Primary Key**

- `deploy_smoke_results_pkey` — PRIMARY KEY (id)

**Indexes**

- `deploy_smoke_results_pkey` (btree)
  `CREATE UNIQUE INDEX deploy_smoke_results_pkey ON public.deploy_smoke_results USING btree (id)`
- `idx_deploy_smoke_results_ran_at` (btree)
  `CREATE INDEX idx_deploy_smoke_results_ran_at ON public.deploy_smoke_results USING btree (ran_at DESC)`
- `idx_deploy_smoke_results_undiagnosed_fails` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_deploy_smoke_results_undiagnosed_fails ON public.deploy_smoke_results USING btree (ran_at DESC) WHERE (claude_diagnosed_at IS NULL)`

### `dgii_seed_nonces`

- Rough row count (n_live_tup): **48**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `valor` | text | NO |  |  |
| 2 | `consumed_at` | timestamp with time zone | YES |  |  |
| 3 | `issued_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `dgii_seed_nonces_pkey` — PRIMARY KEY (valor)

**Indexes**

- `dgii_seed_nonces_issued_at_idx` (btree)
  `CREATE INDEX dgii_seed_nonces_issued_at_idx ON public.dgii_seed_nonces USING btree (issued_at)`
- `dgii_seed_nonces_pkey` (btree)
  `CREATE UNIQUE INDEX dgii_seed_nonces_pkey ON public.dgii_seed_nonces USING btree (valor)`

### `doc_number_blocks`

- Rough row count (n_live_tup): **3**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `hwid` | text | NO |  |  |
| 5 | `device_label` | text | YES |  |  |
| 6 | `scope` | text | NO | 'ticket'::text |  |
| 7 | `range_start` | bigint | NO |  |  |
| 8 | `range_end` | bigint | NO |  |  |
| 9 | `next_available` | bigint | NO |  |  |
| 10 | `size` | integer | NO |  |  |
| 11 | `allocated_at` | timestamp with time zone | NO | now() |  |
| 12 | `exhausted_at` | timestamp with time zone | YES |  |  |
| 13 | `last_used_at` | timestamp with time zone | YES |  |  |
| 14 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `doc_number_blocks_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `doc_blocks_unique_bid` — UNIQUE (business_id, supabase_id)
- `doc_number_blocks_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `doc_number_blocks_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `doc_blocks_range_valid` — CHECK (((range_end >= range_start) AND (next_available >= range_start) AND (next_available <= (range_end + 1))))

**Indexes**

- `doc_blocks_no_overlap` (gist)
  `CREATE INDEX doc_blocks_no_overlap ON public.doc_number_blocks USING gist (business_id, scope, int8range(range_start, range_end, '[]'::text))`
- `doc_blocks_unique_bid` (btree)
  `CREATE UNIQUE INDEX doc_blocks_unique_bid ON public.doc_number_blocks USING btree (business_id, supabase_id)`
- `doc_number_blocks_pkey` (btree)
  `CREATE UNIQUE INDEX doc_number_blocks_pkey ON public.doc_number_blocks USING btree (id)`
- `doc_number_blocks_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX doc_number_blocks_supabase_id_key ON public.doc_number_blocks USING btree (supabase_id)`
- `idx_doc_blocks_biz_hwid_scope` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_doc_blocks_biz_hwid_scope ON public.doc_number_blocks USING btree (business_id, hwid, scope) WHERE (exhausted_at IS NULL)`
- `idx_doc_blocks_biz_scope` (btree)
  `CREATE INDEX idx_doc_blocks_biz_scope ON public.doc_number_blocks USING btree (business_id, scope)`

### `doc_number_master`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `business_id` | uuid | NO |  |  |
| 2 | `scope` | text | NO | 'ticket'::text |  |
| 3 | `next_global` | bigint | NO | 1 |  |
| 4 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `doc_number_master_pkey` — PRIMARY KEY (business_id, scope)

**Foreign Keys**

- `doc_number_master_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `doc_number_master_pkey` (btree)
  `CREATE UNIQUE INDEX doc_number_master_pkey ON public.doc_number_master USING btree (business_id, scope)`

### `ecf_cert_commands`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `certification_id` | uuid | NO |  |  |
| 3 | `command` | text | NO |  |  |
| 4 | `params` | jsonb | YES | '{}'::jsonb |  |
| 5 | `status` | text | NO | 'pending'::text |  |
| 6 | `result` | jsonb | YES |  |  |
| 7 | `created_at` | timestamp with time zone | YES | now() |  |
| 8 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `ecf_cert_commands_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `ecf_cert_commands_certification_id_fkey` — FOREIGN KEY (certification_id) REFERENCES ecf_certifications(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `ecf_cert_commands_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'executing'::text, 'completed'::text, 'failed'::text])))

**Indexes**

- `ecf_cert_commands_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_cert_commands_pkey ON public.ecf_cert_commands USING btree (id)`

### `ecf_cert_documents`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `certification_id` | uuid | NO |  |  |
| 3 | `name` | text | NO |  |  |
| 4 | `file_path` | text | NO |  |  |
| 5 | `file_type` | text | NO |  |  |
| 6 | `step` | integer | YES |  |  |
| 7 | `visible_to_client` | boolean | NO | false |  |
| 8 | `uploaded_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ecf_cert_documents_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `ecf_cert_documents_certification_id_fkey` — FOREIGN KEY (certification_id) REFERENCES ecf_certifications(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `ecf_cert_documents_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_cert_documents_pkey ON public.ecf_cert_documents USING btree (id)`
- `idx_cert_docs_cert_id` (btree)
  `CREATE INDEX idx_cert_docs_cert_id ON public.ecf_cert_documents USING btree (certification_id)`

### `ecf_cert_history`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `cert_serial` | text | YES |  |  |
| 5 | `subject_rnc` | text | YES |  |  |
| 6 | `subject_cn` | text | YES |  |  |
| 7 | `issued_at` | timestamp with time zone | YES |  |  |
| 8 | `expires_at` | timestamp with time zone | YES |  |  |
| 9 | `installed_at` | timestamp with time zone | NO | now() |  |
| 10 | `installed_by_user_id` | uuid | YES |  |  |
| 11 | `installed_by_name` | text | YES |  |  |
| 12 | `installed_from` | text | YES |  |  |
| 13 | `rotation_reason` | text | YES |  |  |
| 14 | `sha256_fingerprint` | text | YES |  |  |
| 15 | `prev_serial` | text | YES |  |  |
| 16 | `prev_expires_at` | timestamp with time zone | YES |  |  |
| 17 | `created_at` | timestamp with time zone | NO | now() |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ecf_cert_history_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ecf_cert_history_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `ecf_cert_history_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `ecf_cert_history_installed_from_check` — CHECK ((installed_from = ANY (ARRAY['desktop'::text, 'web'::text, 'admin'::text])))
- `ecf_cert_history_rotation_reason_check` — CHECK ((rotation_reason = ANY (ARRAY['initial'::text, 'renewal'::text, 'replacement'::text])))

**Indexes**

- `ecf_cert_history_business` (btree)
  `CREATE INDEX ecf_cert_history_business ON public.ecf_cert_history USING btree (business_id, installed_at DESC)`
- `ecf_cert_history_fingerprint` (btree)
  `CREATE INDEX ecf_cert_history_fingerprint ON public.ecf_cert_history USING btree (sha256_fingerprint)`
- `ecf_cert_history_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_cert_history_pkey ON public.ecf_cert_history USING btree (id)`
- `ecf_cert_history_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX ecf_cert_history_supabase_id_key ON public.ecf_cert_history USING btree (supabase_id)`

### `ecf_cert_notes`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `certification_id` | uuid | NO |  |  |
| 3 | `author_id` | uuid | YES |  |  |
| 4 | `author_name` | text | NO |  |  |
| 5 | `type` | text | NO | 'note'::text |  |
| 6 | `content` | text | NO |  |  |
| 7 | `metadata` | jsonb | NO | '{}'::jsonb |  |
| 8 | `visible_to_client` | boolean | NO | false |  |
| 9 | `created_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ecf_cert_notes_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `ecf_cert_notes_certification_id_fkey` — FOREIGN KEY (certification_id) REFERENCES ecf_certifications(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `ecf_cert_notes_type_check` — CHECK ((type = ANY (ARRAY['note'::text, 'step_change'::text, 'status_change'::text, 'payment'::text, 'system'::text, 'client_message'::text])))

**Indexes**

- `ecf_cert_notes_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_cert_notes_pkey ON public.ecf_cert_notes USING btree (id)`
- `idx_cert_notes_cert_id` (btree)
  `CREATE INDEX idx_cert_notes_cert_id ON public.ecf_cert_notes USING btree (certification_id)`

### `ecf_cert_step_data`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `certification_id` | uuid | NO |  |  |
| 3 | `step` | integer | NO |  |  |
| 4 | `data` | jsonb | NO | '{}'::jsonb |  |
| 5 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `ecf_cert_step_data_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ecf_cert_step_data_certification_id_step_key` — UNIQUE (certification_id, step)

**Foreign Keys**

- `ecf_cert_step_data_certification_id_fkey` — FOREIGN KEY (certification_id) REFERENCES ecf_certifications(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `ecf_cert_step_data_step_check` — CHECK (((step >= 1) AND (step <= 15)))

**Indexes**

- `ecf_cert_step_data_certification_id_step_key` (btree)
  `CREATE UNIQUE INDEX ecf_cert_step_data_certification_id_step_key ON public.ecf_cert_step_data USING btree (certification_id, step)`
- `ecf_cert_step_data_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_cert_step_data_pkey ON public.ecf_cert_step_data USING btree (id)`

### `ecf_cert_test_results`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `certification_id` | uuid | NO |  |  |
| 3 | `step` | integer | NO |  |  |
| 4 | `test_number` | integer | NO |  |  |
| 5 | `test_name` | text | YES |  |  |
| 6 | `encf` | text | YES |  |  |
| 7 | `track_id` | text | YES |  |  |
| 8 | `dgii_status` | text | YES |  |  |
| 9 | `xml_hash` | text | YES |  |  |
| 10 | `error_message` | text | YES |  |  |
| 11 | `submitted_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `ecf_cert_test_results_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `ecf_cert_test_results_certification_id_fkey` — FOREIGN KEY (certification_id) REFERENCES ecf_certifications(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `ecf_cert_test_results_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_cert_test_results_pkey ON public.ecf_cert_test_results USING btree (id)`

### `ecf_certifications`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_name` | text | NO |  |  |
| 3 | `rnc` | text | NO |  |  |
| 4 | `nombre_comercial` | text | YES |  |  |
| 5 | `contact_name` | text | NO |  |  |
| 6 | `contact_phone` | text | YES |  |  |
| 7 | `contact_email` | text | YES |  |  |
| 8 | `address` | text | YES |  |  |
| 9 | `municipio` | text | YES |  |  |
| 10 | `provincia` | text | YES |  |  |
| 11 | `cert_p12_path` | text | YES |  |  |
| 12 | `cert_pem_key` | text | YES |  |  |
| 13 | `cert_pem_cert` | text | YES |  |  |
| 14 | `cert_password` | text | YES |  |  |
| 15 | `package_tier` | text | NO | 'full'::text |  |
| 16 | `price` | numeric | NO | 45000 |  |
| 17 | `payment_status` | text | NO | 'pending'::text |  |
| 18 | `amount_paid` | numeric | NO | 0 |  |
| 19 | `current_step` | integer | NO | 1 |  |
| 20 | `steps_completed` | jsonb | NO | '[]'::jsonb |  |
| 21 | `status` | text | NO | 'active'::text |  |
| 22 | `receiver_domain` | text | YES |  |  |
| 23 | `receiver_vps` | text | YES |  |  |
| 24 | `ecf_config` | jsonb | NO | '{}'::jsonb |  |
| 25 | `portal_user_id` | uuid | YES |  |  |
| 26 | `portal_password_set` | boolean | NO | false |  |
| 27 | `started_at` | timestamp with time zone | YES |  |  |
| 28 | `completed_at` | timestamp with time zone | YES |  |  |
| 29 | `created_at` | timestamp with time zone | NO | now() |  |
| 30 | `updated_at` | timestamp with time zone | NO | now() |  |
| 31 | `portal_token` | uuid | YES | gen_random_uuid() |  |
| 32 | `business_id` | uuid | YES |  |  |

**Primary Key**

- `ecf_certifications_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ecf_certifications_portal_token_key` — UNIQUE (portal_token)

**Foreign Keys**

- `ecf_certifications_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id)  _(ON DELETE NO ACTION, ON UPDATE NO ACTION)_

**Check Constraints**

- `ecf_certifications_current_step_check` — CHECK (((current_step >= 1) AND (current_step <= 15)))
- `ecf_certifications_package_tier_check` — CHECK ((package_tier = ANY (ARRAY['advisory'::text, 'full'::text, 'full_plus_terminal'::text])))
- `ecf_certifications_payment_status_check` — CHECK ((payment_status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text, 'refunded'::text])))
- `ecf_certifications_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'cancelled'::text])))

**Indexes**

- `ecf_certifications_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_certifications_pkey ON public.ecf_certifications USING btree (id)`
- `ecf_certifications_portal_token_key` (btree)
  `CREATE UNIQUE INDEX ecf_certifications_portal_token_key ON public.ecf_certifications USING btree (portal_token)`
- `idx_certifications_portal` (btree)
  `CREATE INDEX idx_certifications_portal ON public.ecf_certifications USING btree (portal_user_id)`
- `idx_certifications_status` (btree)
  `CREATE INDEX idx_certifications_status ON public.ecf_certifications USING btree (status)`

### `ecf_queue`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `ticket_id` | uuid | YES |  |  |
| 4 | `url_path` | text | NO | ''::text |  |
| 5 | `body_json` | jsonb | NO | '{}'::jsonb |  |
| 6 | `token` | text | NO | ''::text |  |
| 7 | `attempts` | integer | NO | 0 |  |
| 8 | `last_error` | text | YES |  |  |
| 9 | `created_at` | timestamp with time zone | NO | now() |  |
| 10 | `last_tried` | timestamp with time zone | YES |  |  |
| 11 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 12 | `ticket_supabase_id` | uuid | YES |  |  |
| 13 | `encf` | text | YES |  |  |
| 14 | `tipo_ecf` | text | YES |  |  |
| 15 | `xml_signed` | text | YES |  |  |
| 16 | `environment` | text | NO | 'certecf'::text |  |
| 17 | `status` | text | NO | 'pending'::text |  |
| 18 | `track_id` | text | YES |  |  |
| 19 | `submitted_at` | timestamp with time zone | YES |  |  |
| 20 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ecf_queue_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ecf_queue_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_ecf_queue_biz_supabase_id` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `ecf_queue_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `ecf_queue_ticket_id_fkey` — FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_
- `ecf_queue_ticket_supabase_id_fkey` — FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_

**Check Constraints**

- `ecf_queue_status_chk` — CHECK ((status = ANY (ARRAY['pending'::text, 'submitted'::text, 'failed'::text])))

**Indexes**

- `ecf_queue_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_queue_pkey ON public.ecf_queue USING btree (id)`
- `ecf_queue_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX ecf_queue_supabase_id_uniq ON public.ecf_queue USING btree (supabase_id)`
- `idx_ecf_queue_body_gin` (gin)
  `CREATE INDEX idx_ecf_queue_body_gin ON public.ecf_queue USING gin (body_json jsonb_path_ops)`
- `idx_ecf_queue_created_brin` (brin)
  `CREATE INDEX idx_ecf_queue_created_brin ON public.ecf_queue USING brin (created_at) WITH (pages_per_range='32')`
- `idx_ecf_queue_pending` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_ecf_queue_pending ON public.ecf_queue USING btree (business_id, status, created_at) WHERE (status = 'pending'::text)`
- `uq_ecf_queue_biz_encf` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_ecf_queue_biz_encf ON public.ecf_queue USING btree (business_id, encf) WHERE (encf IS NOT NULL)`
- `uq_ecf_queue_biz_supabase_id` (btree)
  `CREATE UNIQUE INDEX uq_ecf_queue_biz_supabase_id ON public.ecf_queue USING btree (business_id, supabase_id)`

### `ecf_submissions`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('ecf_submissions_id_seq'::regclass) |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `ticket_id` | bigint | YES |  |  |
| 4 | `ticket_supabase_id` | uuid | YES |  |  |
| 5 | `encf` | text | YES |  |  |
| 6 | `tipo_ecf` | text | YES |  |  |
| 7 | `track_id` | text | YES |  |  |
| 8 | `status` | text | YES |  |  |
| 9 | `environment` | text | YES |  |  |
| 10 | `submitted_at` | timestamp with time zone | NO | now() |  |
| 11 | `response_json` | jsonb | YES |  |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |
| 14 | `supabase_id` | uuid | YES |  |  |
| 15 | `dgii_status` | integer | YES |  |  |
| 16 | `dgii_message` | text | YES |  |  |
| 17 | `xml_hash` | text | YES |  |  |
| 18 | `security_code` | text | YES |  |  |
| 19 | `signature_date` | text | YES |  |  |
| 20 | `xml_path` | text | YES |  |  |
| 21 | `confirmed_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `ecf_submissions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ecf_submissions_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_ecf_submissions_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `ecf_submissions_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `ecf_submissions_pkey` (btree)
  `CREATE UNIQUE INDEX ecf_submissions_pkey ON public.ecf_submissions USING btree (id)`
- `ecf_submissions_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX ecf_submissions_supabase_id_uniq ON public.ecf_submissions USING btree (supabase_id)`
- `idx_ecf_submissions_biz` (btree)
  `CREATE INDEX idx_ecf_submissions_biz ON public.ecf_submissions USING btree (business_id)`
- `idx_ecf_submissions_biz_encf` (btree)
  `CREATE INDEX idx_ecf_submissions_biz_encf ON public.ecf_submissions USING btree (business_id, encf)`
- `idx_ecf_submissions_created_brin` (brin)
  `CREATE INDEX idx_ecf_submissions_created_brin ON public.ecf_submissions USING brin (created_at) WITH (pages_per_range='32')`
- `idx_ecf_submissions_submitted_brin` (brin)
  `CREATE INDEX idx_ecf_submissions_submitted_brin ON public.ecf_submissions USING brin (submitted_at) WITH (pages_per_range='32')`
- `idx_ecf_submissions_track` (btree)
  `CREATE INDEX idx_ecf_submissions_track ON public.ecf_submissions USING btree (track_id)`
- `uq_ecf_submissions_sid` (btree)
  `CREATE UNIQUE INDEX uq_ecf_submissions_sid ON public.ecf_submissions USING btree (business_id, supabase_id)`

### `empleados`

- Rough row count (n_live_tup): **104**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `nombre` | text | NO |  |  |
| 4 | `tipo` | text | NO |  |  |
| 5 | `ref_id` | text | YES |  |  |
| 6 | `salary` | numeric | NO | 0 |  |
| 7 | `start_date` | date | NO |  |  |
| 8 | `cedula` | text | YES |  |  |
| 9 | `phone` | text | YES |  |  |
| 10 | `active` | boolean | NO | true |  |
| 11 | `created_at` | timestamp with time zone | NO | now() |  |
| 12 | `local_id` | integer | YES |  |  |
| 13 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 14 | `puesto` | text | YES |  |  |
| 15 | `email` | text | YES |  |  |
| 16 | `bank_account` | text | YES |  |  |
| 17 | `tss_id` | text | YES |  |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |
| 19 | `role` | text | YES | 'none'::text |  |
| 20 | `comision_pct` | numeric | YES | 0 |  |
| 21 | `foto_url` | text | YES |  |  |

**Primary Key**

- `empleados_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `empleados_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_empleados_biz_cedula` — UNIQUE (business_id, cedula)
- `uq_empleados_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_empleados_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `empleados_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `empleados_pkey` (btree)
  `CREATE UNIQUE INDEX empleados_pkey ON public.empleados USING btree (id)`
- `empleados_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX empleados_supabase_id_uniq ON public.empleados USING btree (supabase_id)`
- `uq_empleados_biz_cedula` (btree)
  `CREATE UNIQUE INDEX uq_empleados_biz_cedula ON public.empleados USING btree (business_id, cedula)`
- `uq_empleados_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_empleados_biz_sid ON public.empleados USING btree (business_id, supabase_id)`
- `uq_empleados_cedula` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_empleados_cedula ON public.empleados USING btree (business_id, cedula) WHERE ((cedula IS NOT NULL) AND (cedula <> ''::text))`
- `uq_empleados_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_empleados_local ON public.empleados USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_empleados_natural` (btree)
  `CREATE UNIQUE INDEX uq_empleados_natural ON public.empleados USING btree (business_id, nombre)`
- `uq_empleados_sid` (btree)
  `CREATE UNIQUE INDEX uq_empleados_sid ON public.empleados USING btree (business_id, supabase_id)`

### `firm_memberships`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('firm_memberships_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `firm_business_id` | uuid | NO |  |  |
| 4 | `client_business_id` | uuid | NO |  |  |
| 5 | `accounting_client_id` | bigint | YES |  |  |
| 6 | `role` | text | NO | 'contador'::text |  |
| 7 | `status` | text | NO | 'active'::text |  |
| 8 | `invited_at` | timestamp with time zone | NO | now() |  |
| 9 | `accepted_at` | timestamp with time zone | YES |  |  |
| 10 | `revoked_at` | timestamp with time zone | YES |  |  |
| 11 | `created_at` | timestamp with time zone | NO | now() |  |
| 12 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `firm_memberships_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `firm_membership_uniq` — UNIQUE (firm_business_id, client_business_id)
- `firm_memberships_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `firm_memberships_client_business_id_fkey` — FOREIGN KEY (client_business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `firm_memberships_firm_business_id_fkey` — FOREIGN KEY (firm_business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `firm_memberships_role_check` — CHECK ((role = ANY (ARRAY['contador'::text, 'reviewer'::text, 'readonly'::text])))
- `firm_memberships_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'revoked'::text])))

**Indexes**

- `firm_membership_uniq` (btree)
  `CREATE UNIQUE INDEX firm_membership_uniq ON public.firm_memberships USING btree (firm_business_id, client_business_id)`
- `firm_memberships_client_idx` (btree)
  `CREATE INDEX firm_memberships_client_idx ON public.firm_memberships USING btree (client_business_id)`
- `firm_memberships_firm_idx` (btree)
  `CREATE INDEX firm_memberships_firm_idx ON public.firm_memberships USING btree (firm_business_id, status)`
- `firm_memberships_pkey` (btree)
  `CREATE UNIQUE INDEX firm_memberships_pkey ON public.firm_memberships USING btree (id)`
- `firm_memberships_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX firm_memberships_supabase_id_key ON public.firm_memberships USING btree (supabase_id)`

### `flow_drift_runs`

- Rough row count (n_live_tup): **115**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `ran_at` | timestamp with time zone | NO | now() |  |
| 3 | `passed_count` | integer | NO |  |  |
| 4 | `failed_count` | integer | NO |  |  |
| 5 | `total_count` | integer | NO |  |  |
| 6 | `failures` | jsonb | YES |  |  |
| 7 | `duration_ms` | integer | YES |  |  |
| 8 | `source` | text | YES |  |  |
| 9 | `claude_diagnosed_at` | timestamp with time zone | YES |  |  |
| 10 | `claude_diagnosis` | jsonb | YES |  |  |

**Primary Key**

- `flow_drift_runs_pkey` — PRIMARY KEY (id)

**Indexes**

- `flow_drift_runs_pkey` (btree)
  `CREATE UNIQUE INDEX flow_drift_runs_pkey ON public.flow_drift_runs USING btree (id)`
- `idx_flow_drift_runs_ran_at` (btree)
  `CREATE INDEX idx_flow_drift_runs_ran_at ON public.flow_drift_runs USING btree (ran_at DESC)`
- `idx_flow_drift_runs_undiagnosed` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_flow_drift_runs_undiagnosed ON public.flow_drift_runs USING btree (ran_at DESC) WHERE (claude_diagnosed_at IS NULL)`

### `food_truck_locations`

- Rough row count (n_live_tup): **4**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `lat` | double precision | YES |  |  |
| 6 | `lng` | double precision | YES |  |  |
| 7 | `notes` | text | YES |  |  |
| 8 | `active` | boolean | NO | true |  |
| 9 | `created_at` | timestamp with time zone | NO | now() |  |
| 10 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `food_truck_locations_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `food_truck_locations_supabase_id_key` — UNIQUE (supabase_id)
- `uq_food_truck_locations_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `food_truck_locations_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `food_truck_locations_pkey` (btree)
  `CREATE UNIQUE INDEX food_truck_locations_pkey ON public.food_truck_locations USING btree (id)`
- `food_truck_locations_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX food_truck_locations_supabase_id_key ON public.food_truck_locations USING btree (supabase_id)`
- `idx_food_truck_locations_biz_active` (btree)
  `CREATE INDEX idx_food_truck_locations_biz_active ON public.food_truck_locations USING btree (business_id, active)`
- `uq_food_truck_locations_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_food_truck_locations_biz_sid ON public.food_truck_locations USING btree (business_id, supabase_id)`

### `insurance_batches`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('insurance_batches_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `aseguradora_supabase_id` | uuid | NO |  |  |
| 5 | `period_month` | date | NO |  |  |
| 6 | `ecf_supabase_id` | uuid | YES |  |  |
| 7 | `ecf_ncf` | text | YES |  |  |
| 8 | `total_amount` | numeric | YES | 0 |  |
| 9 | `itbis_amount` | numeric | YES | 0 |  |
| 10 | `pdf_storage_path` | text | YES |  |  |
| 11 | `work_order_count` | integer | YES | 0 |  |
| 12 | `status` | text | NO | 'borrador'::text |  |
| 13 | `notes` | text | YES |  |  |
| 14 | `created_at` | timestamp with time zone | YES | now() |  |
| 15 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `insurance_batches_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `insurance_batches_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `insurance_batches_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `insurance_batches_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `insurance_batches_status_check` — CHECK ((status = ANY (ARRAY['borrador'::text, 'emitido'::text, 'enviado'::text, 'pagado'::text, 'cancelado'::text])))

**Indexes**

- `insurance_batches_biz_period_idx` (btree)
  `CREATE INDEX insurance_batches_biz_period_idx ON public.insurance_batches USING btree (business_id, aseguradora_supabase_id, period_month)`
- `insurance_batches_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX insurance_batches_business_supabase_uk ON public.insurance_batches USING btree (business_id, supabase_id)`
- `insurance_batches_pkey` (btree)
  `CREATE UNIQUE INDEX insurance_batches_pkey ON public.insurance_batches USING btree (id)`
- `insurance_batches_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX insurance_batches_supabase_id_key ON public.insurance_batches USING btree (supabase_id)`

### `inventory_count_items`

- Rough row count (n_live_tup): **112**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `count_supabase_id` | uuid | NO |  |  |
| 5 | `inventory_item_supabase_id` | uuid | NO |  |  |
| 6 | `sku` | text | YES |  |  |
| 7 | `name` | text | NO |  |  |
| 8 | `category` | text | YES |  |  |
| 9 | `expected_qty` | numeric | NO | 0 |  |
| 10 | `counted_qty` | numeric | YES |  |  |
| 11 | `variance_qty` | numeric | YES |  | (COALESCE(counted_qty, (0)::numeric) - expected_qty) |
| 12 | `unit_cost` | numeric | YES | 0 |  |
| 13 | `unit_price` | numeric | YES | 0 |  |
| 14 | `variance_cost` | numeric | YES |  | ((COALESCE(counted_qty, (0)::numeric) - expected_qty) * COALESCE(unit_cost, (0)::numeric)) |
| 15 | `variance_price` | numeric | YES |  | ((COALESCE(counted_qty, (0)::numeric) - expected_qty) * COALESCE(unit_price, (0)::numeric)) |
| 16 | `notes` | text | YES |  |  |
| 17 | `created_at` | timestamp with time zone | NO | now() |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `inventory_count_items_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `icount_items_biz_count_item_key` — UNIQUE (business_id, count_supabase_id, inventory_item_supabase_id)
- `icount_items_business_supabase_id_key` — UNIQUE (business_id, supabase_id)
- `inventory_count_items_supabase_id_uniq` — UNIQUE (supabase_id)

**Foreign Keys**

- `inventory_count_items_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `icount_items_biz_count_item_key` (btree)
  `CREATE UNIQUE INDEX icount_items_biz_count_item_key ON public.inventory_count_items USING btree (business_id, count_supabase_id, inventory_item_supabase_id)`
- `icount_items_business_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX icount_items_business_supabase_id_key ON public.inventory_count_items USING btree (business_id, supabase_id)`
- `idx_icitems_count` (btree)
  `CREATE INDEX idx_icitems_count ON public.inventory_count_items USING btree (business_id, count_supabase_id)`
- `idx_icitems_updated_at` (btree)
  `CREATE INDEX idx_icitems_updated_at ON public.inventory_count_items USING btree (updated_at)`
- `inventory_count_items_pkey` (btree)
  `CREATE UNIQUE INDEX inventory_count_items_pkey ON public.inventory_count_items USING btree (id)`
- `inventory_count_items_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX inventory_count_items_supabase_id_uniq ON public.inventory_count_items USING btree (supabase_id)`

### `inventory_counts`

- Rough row count (n_live_tup): **5**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `title` | text | NO | 'Conteo Fisico'::text |  |
| 5 | `started_at` | timestamp with time zone | NO | now() |  |
| 6 | `completed_at` | timestamp with time zone | YES |  |  |
| 7 | `counted_by_name` | text | YES |  |  |
| 8 | `status` | text | NO | 'abierto'::text |  |
| 9 | `notes` | text | YES |  |  |
| 10 | `total_expected_value` | numeric | YES | 0 |  |
| 11 | `total_counted_value` | numeric | YES | 0 |  |
| 12 | `total_variance_value` | numeric | YES | 0 |  |
| 13 | `created_at` | timestamp with time zone | NO | now() |  |
| 14 | `updated_at` | timestamp with time zone | NO | now() |  |
| 15 | `signature_dataurl` | text | YES |  |  |

**Primary Key**

- `inventory_counts_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `inventory_counts_business_supabase_id_key` — UNIQUE (business_id, supabase_id)
- `inventory_counts_supabase_id_uniq` — UNIQUE (supabase_id)

**Foreign Keys**

- `inventory_counts_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_icounts_biz` (btree)
  `CREATE INDEX idx_icounts_biz ON public.inventory_counts USING btree (business_id, started_at DESC)`
- `idx_icounts_updated_at` (btree)
  `CREATE INDEX idx_icounts_updated_at ON public.inventory_counts USING btree (updated_at)`
- `inventory_counts_business_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX inventory_counts_business_supabase_id_key ON public.inventory_counts USING btree (business_id, supabase_id)`
- `inventory_counts_pkey` (btree)
  `CREATE UNIQUE INDEX inventory_counts_pkey ON public.inventory_counts USING btree (id)`
- `inventory_counts_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX inventory_counts_supabase_id_uniq ON public.inventory_counts USING btree (supabase_id)`

### `inventory_discards`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('inventory_discards_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `inventory_item_supabase_id` | uuid | NO |  |  |
| 5 | `freshness_log_supabase_id` | uuid | YES |  |  |
| 6 | `qty` | numeric | NO |  |  |
| 7 | `unit` | text | YES | 'lb'::text |  |
| 8 | `motivo` | text | NO |  |  |
| 9 | `photo_url` | text | YES |  |  |
| 10 | `empleado_supabase_id` | uuid | YES |  |  |
| 11 | `created_at` | timestamp with time zone | YES | now() |  |
| 12 | `updated_at` | timestamp with time zone | YES | now() |  |
| 13 | `is_post_sale` | boolean | NO | false |  |
| 14 | `related_ticket_supabase_id` | uuid | YES |  |  |
| 15 | `e33_encf` | text | YES |  |  |

**Primary Key**

- `inventory_discards_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `inventory_discards_supabase_id_key` — UNIQUE (supabase_id)

**Indexes**

- `idx_disc_biz_date` (btree)
  `CREATE INDEX idx_disc_biz_date ON public.inventory_discards USING btree (business_id, created_at DESC)`
- `idx_disc_e33` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_disc_e33 ON public.inventory_discards USING btree (e33_encf) WHERE (e33_encf IS NOT NULL)`
- `idx_disc_post_sale` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_disc_post_sale ON public.inventory_discards USING btree (business_id, is_post_sale) WHERE (is_post_sale = true)`
- `inventory_discards_pkey` (btree)
  `CREATE UNIQUE INDEX inventory_discards_pkey ON public.inventory_discards USING btree (id)`
- `inventory_discards_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX inventory_discards_supabase_id_key ON public.inventory_discards USING btree (supabase_id)`

### `inventory_freshness_log`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('inventory_freshness_log_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `inventory_item_supabase_id` | uuid | NO |  |  |
| 5 | `batch_lote` | text | YES |  |  |
| 6 | `received_at` | date | NO |  |  |
| 7 | `expires_at` | date | NO |  |  |
| 8 | `qty_received` | numeric | NO |  |  |
| 9 | `qty_remaining` | numeric | NO |  |  |
| 10 | `unit` | text | YES | 'lb'::text |  |
| 11 | `auto_discount_applied` | boolean | YES | false |  |
| 12 | `created_at` | timestamp with time zone | YES | now() |  |
| 13 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `inventory_freshness_log_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `inventory_freshness_log_supabase_id_key` — UNIQUE (supabase_id)

**Indexes**

- `idx_fresh_biz_item` (btree)
  `CREATE INDEX idx_fresh_biz_item ON public.inventory_freshness_log USING btree (business_id, inventory_item_supabase_id)`
- `idx_fresh_expires` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_fresh_expires ON public.inventory_freshness_log USING btree (expires_at) WHERE (qty_remaining > (0)::numeric)`
- `inventory_freshness_log_pkey` (btree)
  `CREATE UNIQUE INDEX inventory_freshness_log_pkey ON public.inventory_freshness_log USING btree (id)`
- `inventory_freshness_log_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX inventory_freshness_log_supabase_id_key ON public.inventory_freshness_log USING btree (supabase_id)`

### `inventory_items`

- Rough row count (n_live_tup): **1797**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `sku` | text | YES |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `category` | text | NO | ''::text |  |
| 6 | `quantity` | integer | NO | 0 |  |
| 7 | `min_quantity` | integer | NO | 5 |  |
| 8 | `price` | numeric | NO | 0 |  |
| 9 | `cost` | numeric | NO | 0 |  |
| 10 | `active` | boolean | NO | true |  |
| 11 | `created_at` | timestamp with time zone | NO | now() |  |
| 12 | `updated_at` | timestamp with time zone | NO | now() |  |
| 13 | `local_id` | integer | YES |  |  |
| 14 | `barcode` | text | YES |  |  |
| 15 | `aplica_itbis` | integer | YES | 1 |  |
| 16 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 17 | `oem_part_number` | text | YES |  |  |
| 18 | `compatibility` | jsonb | YES |  |  |
| 19 | `reorder_quantity` | integer | YES |  |  |
| 20 | `supplier` | text | YES |  |  |
| 21 | `sold_by_weight` | boolean | NO | false |  |
| 22 | `unit` | text | YES |  |  |
| 23 | `price_per_unit` | numeric | YES |  |  |
| 24 | `bottle_deposit` | numeric | YES |  |  |
| 25 | `tare_default` | numeric | YES |  |  |
| 26 | `legacy_code` | text | YES |  |  |
| 27 | `legacy_source` | text | YES |  |  |
| 28 | `price_pedidos_ya` | numeric | YES |  |  |
| 29 | `prepacked` | boolean | YES | false |  |
| 30 | `corte_category_supabase_id` | uuid | YES |  |  |
| 31 | `expires_at` | date | YES |  |  |
| 32 | `received_at` | date | YES |  |  |
| 33 | `salon_upsell` | boolean | YES | false |  |
| 34 | `salon_upsell_order` | integer | YES |  |  |

**Primary Key**

- `inventory_items_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `inventory_items_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_inventory_items_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_inventory_items_biz_sku` — UNIQUE (business_id, sku)

**Foreign Keys**

- `inventory_items_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `chk_inventory_cost_nonneg` — CHECK (((cost IS NULL) OR (cost >= (0)::numeric)))
- `chk_inventory_minqty_nonneg` — CHECK (((min_quantity IS NULL) OR (min_quantity >= 0)))
- `chk_inventory_name_not_blank` — CHECK ((length(regexp_replace(COALESCE(name, ''::text), '\s'::text, ''::text, 'g'::text)) > 0))
- `chk_inventory_price_nonneg` — CHECK (((price IS NULL) OR (price >= (0)::numeric)))
- `chk_inventory_quantity_nonneg` — CHECK (((quantity IS NULL) OR (quantity >= 0)))

**Indexes**

- `idx_inventory_items_business` (btree)
  `CREATE INDEX idx_inventory_items_business ON public.inventory_items USING btree (business_id)`
- `inventory_items_pkey` (btree)
  `CREATE UNIQUE INDEX inventory_items_pkey ON public.inventory_items USING btree (id)`
- `inventory_items_salon_upsell_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX inventory_items_salon_upsell_idx ON public.inventory_items USING btree (business_id, salon_upsell_order) WHERE (salon_upsell = true)`
- `inventory_items_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX inventory_items_supabase_id_uniq ON public.inventory_items USING btree (supabase_id)`
- `uq_inventory_items_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_inventory_items_biz_sid ON public.inventory_items USING btree (business_id, supabase_id)`
- `uq_inventory_items_biz_sku` (btree)
  `CREATE UNIQUE INDEX uq_inventory_items_biz_sku ON public.inventory_items USING btree (business_id, sku)`
- `uq_inventory_items_sku` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_inventory_items_sku ON public.inventory_items USING btree (business_id, sku) WHERE ((sku IS NOT NULL) AND (sku <> ''::text))`
- `uq_inventory_local2` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_inventory_local2 ON public.inventory_items USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_inventory_natural` (btree)
  `CREATE UNIQUE INDEX uq_inventory_natural ON public.inventory_items USING btree (business_id, name)`

### `inventory_oversells`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `ticket_supabase_id` | uuid | YES |  |  |
| 5 | `item_supabase_id` | uuid | YES |  |  |
| 6 | `item_name` | text | YES |  |  |
| 7 | `requested_qty` | numeric | NO |  |  |
| 8 | `actual_qty` | numeric | NO |  |  |
| 9 | `detected_at` | timestamp with time zone | NO | now() |  |
| 10 | `resolved_at` | timestamp with time zone | YES |  |  |
| 11 | `resolved_by` | uuid | YES |  |  |
| 12 | `resolved_by_name` | text | YES |  |  |
| 13 | `resolution_notes` | text | YES |  |  |
| 14 | `resolution_type` | text | YES |  |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `inventory_oversells_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `inventory_oversells_supabase_id_key` — UNIQUE (supabase_id)
- `oversells_unique_bid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `inventory_oversells_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_oversells_biz_resolved` (btree)
  `CREATE INDEX idx_oversells_biz_resolved ON public.inventory_oversells USING btree (business_id, resolved_at)`
- `idx_oversells_unresolved` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_oversells_unresolved ON public.inventory_oversells USING btree (business_id) WHERE (resolved_at IS NULL)`
- `inventory_oversells_pkey` (btree)
  `CREATE UNIQUE INDEX inventory_oversells_pkey ON public.inventory_oversells USING btree (id)`
- `inventory_oversells_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX inventory_oversells_supabase_id_key ON public.inventory_oversells USING btree (supabase_id)`
- `oversells_unique_bid` (btree)
  `CREATE UNIQUE INDEX oversells_unique_bid ON public.inventory_oversells USING btree (business_id, supabase_id)`

### `inventory_transactions`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `item_id` | uuid | YES |  |  |
| 4 | `type` | text | NO |  |  |
| 5 | `delta` | integer | NO |  |  |
| 6 | `notes` | text | NO | ''::text |  |
| 7 | `user_id` | uuid | YES |  |  |
| 8 | `created_at` | timestamp with time zone | NO | now() |  |
| 9 | `local_id` | integer | YES |  |  |
| 10 | `local_item_id` | integer | YES |  |  |
| 11 | `local_user_id` | integer | YES |  |  |
| 12 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 13 | `item_supabase_id` | uuid | YES |  |  |
| 14 | `user_supabase_id` | uuid | YES |  |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `inventory_transactions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `inventory_transactions_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_inventory_transactions_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_inventory_transactions_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `inventory_transactions_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `inventory_transactions_pkey` (btree)
  `CREATE UNIQUE INDEX inventory_transactions_pkey ON public.inventory_transactions USING btree (id)`
- `inventory_transactions_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX inventory_transactions_supabase_id_uniq ON public.inventory_transactions USING btree (supabase_id)`
- `uq_inv_trans_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_inv_trans_local ON public.inventory_transactions USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_inventory_transactions_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_inventory_transactions_biz_sid ON public.inventory_transactions USING btree (business_id, supabase_id)`
- `uq_inventory_transactions_sid` (btree)
  `CREATE UNIQUE INDEX uq_inventory_transactions_sid ON public.inventory_transactions USING btree (business_id, supabase_id)`

### `journal_entries`

- Rough row count (n_live_tup): **211**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('journal_entries_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `location_id` | uuid | YES |  |  |
| 5 | `tx_group_id` | uuid | NO |  |  |
| 6 | `posted_at` | timestamp with time zone | NO | now() |  |
| 7 | `effective_date` | date | NO | CURRENT_DATE |  |
| 8 | `vertical` | text | YES |  |  |
| 9 | `source_table` | text | NO |  |  |
| 10 | `source_id` | uuid | YES |  |  |
| 11 | `source_line_id` | uuid | YES |  |  |
| 12 | `account` | text | NO |  |  |
| 13 | `category` | text | YES |  |  |
| 14 | `employee_id` | uuid | YES |  |  |
| 15 | `client_id` | uuid | YES |  |  |
| 16 | `debit` | numeric | NO | 0 |  |
| 17 | `credit` | numeric | NO | 0 |  |
| 18 | `currency` | text | NO | 'DOP'::text |  |
| 19 | `description` | text | YES |  |  |
| 20 | `metadata` | jsonb | NO | '{}'::jsonb |  |
| 21 | `reversal_of_id` | bigint | YES |  |  |
| 22 | `reversed_by_id` | bigint | YES |  |  |
| 23 | `created_by` | uuid | YES |  |  |
| 24 | `created_at` | timestamp with time zone | NO | now() |  |
| 25 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `journal_entries_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `journal_entries_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `journal_entries_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `journal_entries_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id)  _(ON DELETE NO ACTION, ON UPDATE NO ACTION)_
- `journal_entries_reversal_of_id_fkey` — FOREIGN KEY (reversal_of_id) REFERENCES journal_entries(id)  _(ON DELETE NO ACTION, ON UPDATE NO ACTION)_
- `journal_entries_reversed_by_id_fkey` — FOREIGN KEY (reversed_by_id) REFERENCES journal_entries(id)  _(ON DELETE NO ACTION, ON UPDATE NO ACTION)_

**Check Constraints**

- `journal_entries_check` — CHECK (((debit = (0)::numeric) OR (credit = (0)::numeric)))
- `journal_entries_check1` — CHECK (((debit > (0)::numeric) OR (credit > (0)::numeric)))
- `journal_entries_credit_check` — CHECK ((credit >= (0)::numeric))
- `journal_entries_debit_check` — CHECK ((debit >= (0)::numeric))

**Indexes**

- `ix_je_biz_account_date` (btree)
  `CREATE INDEX ix_je_biz_account_date ON public.journal_entries USING btree (business_id, account, effective_date DESC)`
- `ix_je_biz_eff_date` (btree)
  `CREATE INDEX ix_je_biz_eff_date ON public.journal_entries USING btree (business_id, effective_date DESC)`
- `ix_je_biz_source` (btree)
  `CREATE INDEX ix_je_biz_source ON public.journal_entries USING btree (business_id, source_table, source_id)`
- `ix_je_reversal_of_id` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX ix_je_reversal_of_id ON public.journal_entries USING btree (reversal_of_id) WHERE (reversal_of_id IS NOT NULL)`
- `ix_je_reversed_by_id` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX ix_je_reversed_by_id ON public.journal_entries USING btree (reversed_by_id) WHERE (reversed_by_id IS NOT NULL)`
- `ix_je_tx_group` (btree)
  `CREATE INDEX ix_je_tx_group ON public.journal_entries USING btree (tx_group_id)`
- `journal_entries_pkey` (btree)
  `CREATE UNIQUE INDEX journal_entries_pkey ON public.journal_entries USING btree (id)`
- `journal_entries_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX journal_entries_supabase_id_key ON public.journal_entries USING btree (supabase_id)`

### `kds_events`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `ticket_item_supabase_id` | uuid | NO |  |  |
| 5 | `mesa_supabase_id` | uuid | YES |  |  |
| 6 | `station` | text | YES |  |  |
| 7 | `status` | text | NO | 'fired'::text |  |
| 8 | `fired_at` | timestamp with time zone | NO | now() |  |
| 9 | `started_at` | timestamp with time zone | YES |  |  |
| 10 | `ready_at` | timestamp with time zone | YES |  |  |
| 11 | `bumped_at` | timestamp with time zone | YES |  |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `kds_events_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `kds_events_supabase_id_key` — UNIQUE (supabase_id)
- `uq_kds_events_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `kds_events_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_kds_events_status` (btree)
  `CREATE INDEX idx_kds_events_status ON public.kds_events USING btree (status)`
- `idx_kds_events_ticket_item` (btree)
  `CREATE INDEX idx_kds_events_ticket_item ON public.kds_events USING btree (ticket_item_supabase_id)`
- `kds_events_pkey` (btree)
  `CREATE UNIQUE INDEX kds_events_pkey ON public.kds_events USING btree (id)`
- `kds_events_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX kds_events_supabase_id_key ON public.kds_events USING btree (supabase_id)`
- `uq_kds_events_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_kds_events_biz_sid ON public.kds_events USING btree (business_id, supabase_id)`

### `leads`

- Rough row count (n_live_tup): **15**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `name` | text | YES |  |  |
| 5 | `phone` | text | YES |  |  |
| 6 | `email` | text | YES |  |  |
| 7 | `client_id` | uuid | YES |  |  |
| 8 | `client_supabase_id` | uuid | YES |  |  |
| 9 | `vehicle_interest_id` | uuid | YES |  |  |
| 10 | `vehicle_interest_supabase_id` | uuid | YES |  |  |
| 11 | `salesperson_id` | uuid | YES |  |  |
| 12 | `salesperson_supabase_id` | uuid | YES |  |  |
| 13 | `source` | text | YES |  |  |
| 14 | `stage` | text | YES | 'lead'::text |  |
| 15 | `lost_reason` | text | YES |  |  |
| 16 | `budget` | numeric | YES |  |  |
| 17 | `notes` | text | YES |  |  |
| 18 | `next_follow_up` | timestamp with time zone | YES |  |  |
| 19 | `active` | boolean | YES | true |  |
| 20 | `created_at` | timestamp with time zone | YES | now() |  |
| 21 | `updated_at` | timestamp with time zone | YES | now() |  |
| 22 | `next_followup_at` | timestamp with time zone | YES |  |  |
| 23 | `last_contacted_at` | timestamp with time zone | YES |  |  |
| 24 | `interested_vehicle_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `leads_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `leads_biz_sid_key` — UNIQUE (business_id, supabase_id)
- `leads_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `leads_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_leads_biz_stage` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_leads_biz_stage ON public.leads USING btree (business_id, stage) WHERE (active = true)`
- `leads_biz_sid_key` (btree)
  `CREATE UNIQUE INDEX leads_biz_sid_key ON public.leads USING btree (business_id, supabase_id)`
- `leads_pkey` (btree)
  `CREATE UNIQUE INDEX leads_pkey ON public.leads USING btree (id)`
- `leads_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX leads_supabase_id_key ON public.leads USING btree (supabase_id)`

### `license_events`

- Rough row count (n_live_tup): **2665**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `created_at` | timestamp with time zone | YES | now() |  |
| 3 | `key` | text | YES |  |  |
| 4 | `hwid` | text | YES |  |  |
| 5 | `action` | text | YES |  |  |
| 6 | `ip` | text | YES |  |  |
| 7 | `status` | text | YES |  |  |
| 8 | `business_name` | text | YES |  |  |
| 9 | `license_id` | uuid | YES |  |  |
| 10 | `metadata` | jsonb | NO | '{}'::jsonb |  |

**Primary Key**

- `license_events_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `license_events_license_id_fkey` — FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_

**Indexes**

- `idx_license_events_created_brin` (brin)
  `CREATE INDEX idx_license_events_created_brin ON public.license_events USING brin (created_at) WITH (pages_per_range='32')`
- `idx_license_events_date` (btree)
  `CREATE INDEX idx_license_events_date ON public.license_events USING btree (created_at DESC)`
- `idx_license_events_license` (btree)
  `CREATE INDEX idx_license_events_license ON public.license_events USING btree (license_id)`
- `license_events_pkey` (btree)
  `CREATE UNIQUE INDEX license_events_pkey ON public.license_events USING btree (id)`

### `license_jwt_audit`

- Rough row count (n_live_tup): **102**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `license_key` | text | YES |  |  |
| 3 | `business_id` | uuid | YES |  |  |
| 4 | `machine_id` | text | YES |  |  |
| 5 | `minted_at` | timestamp with time zone | NO | now() |  |
| 6 | `expires_at` | timestamp with time zone | YES |  |  |
| 7 | `ip_address` | text | YES |  |  |

**Primary Key**

- `license_jwt_audit_pkey` — PRIMARY KEY (id)

**Indexes**

- `idx_license_jwt_audit_business_id` (btree)
  `CREATE INDEX idx_license_jwt_audit_business_id ON public.license_jwt_audit USING btree (business_id, minted_at DESC)`
- `idx_license_jwt_audit_license_key` (btree)
  `CREATE INDEX idx_license_jwt_audit_license_key ON public.license_jwt_audit USING btree (license_key, minted_at DESC)`
- `license_jwt_audit_pkey` (btree)
  `CREATE UNIQUE INDEX license_jwt_audit_pkey ON public.license_jwt_audit USING btree (id)`

### `license_rebind_requests`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `license_id` | uuid | NO |  |  |
| 3 | `requested_hwid` | text | NO |  |  |
| 4 | `current_hwid` | text | YES |  |  |
| 5 | `requested_at` | timestamp with time zone | NO | now() |  |
| 6 | `expires_at` | timestamp with time zone | NO | (now() + '72:00:00'::interval) |  |
| 7 | `status` | text | NO | 'pending'::text |  |
| 8 | `approved_by_admin_id` | uuid | YES |  |  |
| 9 | `approved_at` | timestamp with time zone | YES |  |  |
| 10 | `ip` | text | YES |  |  |
| 11 | `metadata` | jsonb | NO | '{}'::jsonb |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `license_rebind_requests_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `license_rebind_requests_approved_by_admin_id_fkey` — FOREIGN KEY (approved_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_
- `license_rebind_requests_license_id_fkey` — FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `license_rebind_requests_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])))

**Indexes**

- `idx_license_rebind_license` (btree)
  `CREATE INDEX idx_license_rebind_license ON public.license_rebind_requests USING btree (license_id)`
- `idx_license_rebind_status` (btree)
  `CREATE INDEX idx_license_rebind_status ON public.license_rebind_requests USING btree (status, requested_at DESC)`
- `license_rebind_requests_pkey` (btree)
  `CREATE UNIQUE INDEX license_rebind_requests_pkey ON public.license_rebind_requests USING btree (id)`
- `uq_license_rebind_pending` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_license_rebind_pending ON public.license_rebind_requests USING btree (license_id, requested_hwid) WHERE (status = 'pending'::text)`

### `licenses`

- Rough row count (n_live_tup): **25**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `plan_id` | uuid | YES |  |  |
| 4 | `license_key` | text | YES |  |  |
| 5 | `hardware_id` | text | YES |  |  |
| 6 | `status` | text | NO | 'active'::text |  |
| 7 | `platform` | text | NO | 'web'::text |  |
| 8 | `activated_at` | timestamp with time zone | YES |  |  |
| 9 | `expires_at` | timestamp with time zone | YES |  |  |
| 10 | `last_seen` | timestamp with time zone | YES |  |  |
| 11 | `max_users` | integer | NO | 3 |  |
| 12 | `notes` | text | YES |  |  |
| 13 | `created_at` | timestamp with time zone | NO | now() |  |
| 14 | `updated_at` | timestamp with time zone | NO | now() |  |
| 15 | `prior_hardware_id` | text | YES |  |  |
| 16 | `label` | text | YES |  |  |

**Primary Key**

- `licenses_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `licenses_license_key_key` — UNIQUE (license_key)

**Foreign Keys**

- `licenses_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `licenses_plan_id_fkey` — FOREIGN KEY (plan_id) REFERENCES plans(id)  _(ON DELETE NO ACTION, ON UPDATE NO ACTION)_

**Check Constraints**

- `licenses_platform_check` — CHECK ((platform = ANY (ARRAY['desktop'::text, 'web'::text, 'both'::text])))
- `licenses_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'suspended'::text, 'expired'::text, 'cancelled'::text])))

**Indexes**

- `idx_licenses_business` (btree)
  `CREATE INDEX idx_licenses_business ON public.licenses USING btree (business_id)`
- `idx_licenses_key` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_licenses_key ON public.licenses USING btree (license_key) WHERE (license_key IS NOT NULL)`
- `idx_licenses_plan` (btree)
  `CREATE INDEX idx_licenses_plan ON public.licenses USING btree (plan_id)`
- `idx_licenses_status` (btree)
  `CREATE INDEX idx_licenses_status ON public.licenses USING btree (status)`
- `licenses_license_key_key` (btree)
  `CREATE UNIQUE INDEX licenses_license_key_key ON public.licenses USING btree (license_key)`
- `licenses_pkey` (btree)
  `CREATE UNIQUE INDEX licenses_pkey ON public.licenses USING btree (id)`

### `loan_contracts`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `loan_supabase_id` | uuid | YES |  |  |
| 5 | `pdf_url` | text | YES |  |  |
| 6 | `signature_dataurl` | text | YES |  |  |
| 7 | `dpi_photo_url` | text | YES |  |  |
| 8 | `signed_at` | timestamp with time zone | YES |  |  |
| 9 | `apr_monthly` | numeric | YES |  |  |
| 10 | `apr_annual_equiv` | numeric | YES |  |  |
| 11 | `clauses_version` | text | YES |  |  |
| 12 | `created_at` | timestamp with time zone | YES | now() |  |
| 13 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `loan_contracts_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `loan_contracts_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_loan_contracts_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `loan_contracts_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `loan_contracts_pkey` (btree)
  `CREATE UNIQUE INDEX loan_contracts_pkey ON public.loan_contracts USING btree (id)`
- `loan_contracts_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX loan_contracts_supabase_id_uniq ON public.loan_contracts USING btree (supabase_id)`
- `uq_loan_contracts_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_loan_contracts_biz_sid ON public.loan_contracts USING btree (business_id, supabase_id)`

### `loan_payments`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `loan_id` | uuid | YES |  |  |
| 5 | `loan_supabase_id` | uuid | YES |  |  |
| 6 | `amount` | numeric | NO |  |  |
| 7 | `principal_portion` | numeric | YES | 0 |  |
| 8 | `interest_portion` | numeric | YES | 0 |  |
| 9 | `late_fee` | numeric | YES | 0 |  |
| 10 | `payment_date` | date | YES | CURRENT_DATE |  |
| 11 | `due_date` | date | YES |  |  |
| 12 | `status` | text | YES | 'on_time'::text |  |
| 13 | `notes` | text | YES |  |  |
| 14 | `created_at` | timestamp with time zone | YES | now() |  |
| 15 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `loan_payments_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `loan_payments_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_loan_payments_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `loan_payments_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `loan_payments_pkey` (btree)
  `CREATE UNIQUE INDEX loan_payments_pkey ON public.loan_payments USING btree (id)`
- `loan_payments_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX loan_payments_supabase_id_uniq ON public.loan_payments USING btree (supabase_id)`
- `uq_loan_payments_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_loan_payments_biz_sid ON public.loan_payments USING btree (business_id, supabase_id)`

### `loan_renewals`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `loan_supabase_id` | uuid | YES |  |  |
| 5 | `renewal_count` | integer | YES |  |  |
| 6 | `interest_paid` | numeric | YES |  |  |
| 7 | `new_due_date` | text | YES |  |  |
| 8 | `previous_due_date` | text | YES |  |  |
| 9 | `renewed_at` | timestamp with time zone | YES | now() |  |
| 10 | `notes` | text | YES |  |  |
| 11 | `created_at` | timestamp with time zone | YES | now() |  |
| 12 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `loan_renewals_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `loan_renewals_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_loan_renewals_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `loan_renewals_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `loan_renewals_pkey` (btree)
  `CREATE UNIQUE INDEX loan_renewals_pkey ON public.loan_renewals USING btree (id)`
- `loan_renewals_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX loan_renewals_supabase_id_uniq ON public.loan_renewals USING btree (supabase_id)`
- `uq_loan_renewals_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_loan_renewals_biz_sid ON public.loan_renewals USING btree (business_id, supabase_id)`

### `loan_schedule`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `loan_id` | bigint | YES |  |  |
| 5 | `loan_supabase_id` | uuid | YES |  |  |
| 6 | `installment_no` | integer | NO |  |  |
| 7 | `due_date` | date | NO |  |  |
| 8 | `principal_due` | numeric | NO | 0 |  |
| 9 | `interest_due` | numeric | NO | 0 |  |
| 10 | `total_due` | numeric | NO | 0 |  |
| 11 | `paid_amount` | numeric | NO | 0 |  |
| 12 | `paid_at` | timestamp with time zone | YES |  |  |
| 13 | `status` | text | NO | 'pending'::text |  |
| 14 | `created_at` | timestamp with time zone | NO | now() |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `loan_schedule_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `loan_schedule_business_supabase_unique` — UNIQUE (business_id, supabase_id)
- `loan_schedule_supabase_id_uniq` — UNIQUE (supabase_id)

**Indexes**

- `idx_loan_schedule_due` (btree)
  `CREATE INDEX idx_loan_schedule_due ON public.loan_schedule USING btree (business_id, status, due_date)`
- `idx_loan_schedule_loan` (btree)
  `CREATE INDEX idx_loan_schedule_loan ON public.loan_schedule USING btree (loan_supabase_id)`
- `loan_schedule_business_supabase_unique` (btree)
  `CREATE UNIQUE INDEX loan_schedule_business_supabase_unique ON public.loan_schedule USING btree (business_id, supabase_id)`
- `loan_schedule_pkey` (btree)
  `CREATE UNIQUE INDEX loan_schedule_pkey ON public.loan_schedule USING btree (id)`
- `loan_schedule_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX loan_schedule_supabase_id_uniq ON public.loan_schedule USING btree (supabase_id)`

### `loans`

- Rough row count (n_live_tup): **4**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | uuid | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `principal` | numeric | NO |  |  |
| 7 | `term_months` | integer | NO |  |  |
| 8 | `interest_rate` | numeric | NO |  |  |
| 9 | `monthly_payment` | numeric | YES | 0 |  |
| 10 | `status` | text | YES | 'active'::text |  |
| 11 | `disbursed_at` | timestamp with time zone | YES |  |  |
| 12 | `next_due_date` | date | YES |  |  |
| 13 | `total_paid` | numeric | YES | 0 |  |
| 14 | `total_interest` | numeric | YES | 0 |  |
| 15 | `notes` | text | YES |  |  |
| 16 | `created_at` | timestamp with time zone | YES | now() |  |
| 17 | `updated_at` | timestamp with time zone | YES | now() |  |
| 18 | `method` | text | YES | 'french'::text |  |
| 19 | `mora_rate_daily` | numeric | YES | 0.005 |  |
| 20 | `days_late` | integer | YES | 0 |  |
| 21 | `mora_amount` | numeric | YES | 0 |  |
| 22 | `amortization_method` | text | YES | 'interest_only'::text |  |
| 23 | `renewal_count` | integer | YES | 0 |  |

**Primary Key**

- `loans_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `loans_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_loans_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `loans_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `loans_amortization_method_check` — CHECK ((amortization_method = ANY (ARRAY['french'::text, 'german'::text, 'interest_only'::text])))

**Indexes**

- `loans_pkey` (btree)
  `CREATE UNIQUE INDEX loans_pkey ON public.loans USING btree (id)`
- `loans_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX loans_supabase_id_uniq ON public.loans USING btree (supabase_id)`
- `uq_loans_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_loans_biz_sid ON public.loans USING btree (business_id, supabase_id)`

### `loyalty_transactions`

- Rough row count (n_live_tup): **95**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_supabase_id` | uuid | NO |  |  |
| 5 | `ticket_supabase_id` | uuid | YES |  |  |
| 6 | `event_type` | text | NO |  |  |
| 7 | `points` | numeric | NO |  |  |
| 8 | `balance_after` | numeric | NO | 0 |  |
| 9 | `notes` | text | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `loyalty_transactions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `loyalty_transactions_supabase_id_uniq` — UNIQUE (supabase_id)
- `lt_biz_sid_key` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `loyalty_transactions_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_loyalty_transactions_created_brin` (brin)
  `CREATE INDEX idx_loyalty_transactions_created_brin ON public.loyalty_transactions USING brin (created_at) WITH (pages_per_range='32')`
- `idx_lt_updated` (btree)
  `CREATE INDEX idx_lt_updated ON public.loyalty_transactions USING btree (updated_at)`
- `ix_loyalty_tx_client` (btree)
  `CREATE INDEX ix_loyalty_tx_client ON public.loyalty_transactions USING btree (business_id, client_supabase_id, created_at DESC)`
- `loyalty_transactions_pkey` (btree)
  `CREATE UNIQUE INDEX loyalty_transactions_pkey ON public.loyalty_transactions USING btree (id)`
- `loyalty_transactions_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX loyalty_transactions_supabase_id_uniq ON public.loyalty_transactions USING btree (supabase_id)`
- `lt_biz_sid_key` (btree)
  `CREATE UNIQUE INDEX lt_biz_sid_key ON public.loyalty_transactions USING btree (business_id, supabase_id)`
- `ux_loyalty_tx_earn_per_ticket` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX ux_loyalty_tx_earn_per_ticket ON public.loyalty_transactions USING btree (business_id, ticket_supabase_id) WHERE ((event_type = 'earn'::text) AND (ticket_supabase_id IS NOT NULL))`

### `marketing_leads`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES | gen_random_uuid() |  |
| 3 | `email` | text | NO |  |  |
| 4 | `source` | text | NO |  |  |
| 5 | `vertical` | text | YES |  |  |
| 6 | `business_size` | text | YES |  |  |
| 7 | `ip` | text | YES |  |  |
| 8 | `user_agent` | text | YES |  |  |
| 9 | `utm_source` | text | YES |  |  |
| 10 | `utm_medium` | text | YES |  |  |
| 11 | `utm_campaign` | text | YES |  |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `marketing_leads_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `marketing_leads_supabase_id_key` — UNIQUE (supabase_id)

**Indexes**

- `idx_marketing_leads_created_at` (btree)
  `CREATE INDEX idx_marketing_leads_created_at ON public.marketing_leads USING btree (created_at DESC)`
- `idx_marketing_leads_email` (btree)
  `CREATE INDEX idx_marketing_leads_email ON public.marketing_leads USING btree (email)`
- `idx_marketing_leads_source` (btree)
  `CREATE INDEX idx_marketing_leads_source ON public.marketing_leads USING btree (source)`
- `marketing_leads_pkey` (btree)
  `CREATE UNIQUE INDEX marketing_leads_pkey ON public.marketing_leads USING btree (id)`
- `marketing_leads_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX marketing_leads_supabase_id_key ON public.marketing_leads USING btree (supabase_id)`

### `mechanic_commissions`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('mechanic_commissions_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `work_order_supabase_id` | uuid | NO |  |  |
| 5 | `technician_empleado_supabase_id` | uuid | NO |  |  |
| 6 | `ticket_supabase_id` | uuid | YES |  |  |
| 7 | `base_amount` | numeric | NO | 0 |  |
| 8 | `commission_pct` | numeric | NO | 0 |  |
| 9 | `calc_amount` | numeric | NO | 0 |  |
| 10 | `paid` | boolean | NO | false |  |
| 11 | `paid_at` | timestamp with time zone | YES |  |  |
| 12 | `paid_by_supabase_id` | uuid | YES |  |  |
| 13 | `manual_reason` | text | YES |  |  |
| 14 | `created_at` | timestamp with time zone | YES | now() |  |
| 15 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `mechanic_commissions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `mechanic_commissions_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `mechanic_commissions_supabase_id_key` — UNIQUE (supabase_id)
- `mechanic_commissions_wo_tech_uk` — UNIQUE (business_id, work_order_supabase_id, technician_empleado_supabase_id)

**Foreign Keys**

- `mechanic_commissions_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `mechanic_commissions_biz_paid_idx` (btree)
  `CREATE INDEX mechanic_commissions_biz_paid_idx ON public.mechanic_commissions USING btree (business_id, paid, created_at DESC)`
- `mechanic_commissions_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX mechanic_commissions_business_supabase_uk ON public.mechanic_commissions USING btree (business_id, supabase_id)`
- `mechanic_commissions_pkey` (btree)
  `CREATE UNIQUE INDEX mechanic_commissions_pkey ON public.mechanic_commissions USING btree (id)`
- `mechanic_commissions_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX mechanic_commissions_supabase_id_key ON public.mechanic_commissions USING btree (supabase_id)`
- `mechanic_commissions_tech_idx` (btree)
  `CREATE INDEX mechanic_commissions_tech_idx ON public.mechanic_commissions USING btree (technician_empleado_supabase_id)`
- `mechanic_commissions_wo_tech_uk` (btree)
  `CREATE UNIQUE INDEX mechanic_commissions_wo_tech_uk ON public.mechanic_commissions USING btree (business_id, work_order_supabase_id, technician_empleado_supabase_id)`

### `mega_smoke_runs`

- Rough row count (n_live_tup): **50**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `ran_at` | timestamp with time zone | NO | now() |  |
| 3 | `source` | text | NO |  |  |
| 4 | `total_count` | integer | NO |  |  |
| 5 | `passed_count` | integer | NO |  |  |
| 6 | `failed_count` | integer | NO |  |  |
| 7 | `duration_ms` | integer | NO |  |  |
| 8 | `failures` | jsonb | YES |  |  |
| 9 | `whatsapp_sent_count` | integer | NO | 0 |  |
| 10 | `whatsapp_summary` | jsonb | YES |  |  |
| 11 | `claude_diagnosed_at` | timestamp with time zone | YES |  |  |
| 12 | `claude_diagnosis` | jsonb | YES |  |  |

**Primary Key**

- `mega_smoke_runs_pkey` — PRIMARY KEY (id)

**Indexes**

- `idx_mega_smoke_runs_ran_at` (btree)
  `CREATE INDEX idx_mega_smoke_runs_ran_at ON public.mega_smoke_runs USING btree (ran_at DESC)`
- `idx_mega_smoke_runs_undiagnosed` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_mega_smoke_runs_undiagnosed ON public.mega_smoke_runs USING btree (ran_at DESC) WHERE ((claude_diagnosed_at IS NULL) AND (failed_count > 0))`
- `mega_smoke_runs_pkey` (btree)
  `CREATE UNIQUE INDEX mega_smoke_runs_pkey ON public.mega_smoke_runs USING btree (id)`

### `membership_redemptions`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('membership_redemptions_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_membership_supabase_id` | uuid | NO |  |  |
| 5 | `ticket_supabase_id` | uuid | NO |  |  |
| 6 | `appointment_supabase_id` | uuid | YES |  |  |
| 7 | `redeemed_at` | timestamp with time zone | YES | now() |  |
| 8 | `created_at` | timestamp with time zone | YES | now() |  |
| 9 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `membership_redemptions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `membership_redemptions_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `membership_redemptions_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `membership_redemptions_biz_supabase_idx` (btree)
  `CREATE INDEX membership_redemptions_biz_supabase_idx ON public.membership_redemptions USING btree (business_id, supabase_id)`
- `membership_redemptions_pkey` (btree)
  `CREATE UNIQUE INDEX membership_redemptions_pkey ON public.membership_redemptions USING btree (id)`
- `membership_redemptions_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX membership_redemptions_supabase_id_key ON public.membership_redemptions USING btree (supabase_id)`

### `memberships`

- Rough row count (n_live_tup): **3**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('memberships_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | bigint | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `vehicle_id` | bigint | YES |  |  |
| 7 | `vehicle_supabase_id` | uuid | YES |  |  |
| 8 | `plan_name` | text | NO |  |  |
| 9 | `plan_price` | numeric | NO | 0 |  |
| 10 | `wash_quota_per_month` | integer | NO | 0 |  |
| 11 | `washes_used_this_period` | integer | NO | 0 |  |
| 12 | `period_start` | date | YES |  |  |
| 13 | `period_end` | date | YES |  |  |
| 14 | `start_date` | date | NO | CURRENT_DATE |  |
| 15 | `end_date` | date | YES |  |  |
| 16 | `status` | text | NO | 'active'::text |  |
| 17 | `notes` | text | YES |  |  |
| 18 | `created_at` | timestamp with time zone | NO | now() |  |
| 19 | `updated_at` | timestamp with time zone | NO | now() |  |
| 20 | `nombre` | text | YES |  |  |
| 21 | `service_supabase_id` | uuid | YES |  |  |
| 22 | `total_sessions` | integer | YES |  |  |
| 23 | `price_dop` | numeric | YES |  |  |
| 24 | `validity_days` | integer | YES | 365 |  |
| 25 | `active_template` | boolean | YES | true |  |
| 26 | `vertical` | text | YES |  |  |

**Primary Key**

- `memberships_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `memberships_biz_sid_unique` — UNIQUE (business_id, supabase_id)
- `memberships_supabase_id_uniq` — UNIQUE (supabase_id)

**Check Constraints**

- `memberships_vertical_check` — CHECK ((vertical = ANY (ARRAY['salon'::text, 'carwash'::text])))

**Indexes**

- `memberships_biz_sid_unique` (btree)
  `CREATE UNIQUE INDEX memberships_biz_sid_unique ON public.memberships USING btree (business_id, supabase_id)`
- `memberships_biz_status_idx` (btree)
  `CREATE INDEX memberships_biz_status_idx ON public.memberships USING btree (business_id, status)`
- `memberships_biz_supabase_idx` (btree)
  `CREATE INDEX memberships_biz_supabase_idx ON public.memberships USING btree (business_id, supabase_id)`
- `memberships_biz_vertical_idx` (btree)
  `CREATE INDEX memberships_biz_vertical_idx ON public.memberships USING btree (business_id, vertical)`
- `memberships_client_idx` (btree)
  `CREATE INDEX memberships_client_idx ON public.memberships USING btree (client_supabase_id)`
- `memberships_pkey` (btree)
  `CREATE UNIQUE INDEX memberships_pkey ON public.memberships USING btree (id)`
- `memberships_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX memberships_supabase_id_uniq ON public.memberships USING btree (supabase_id)`

### `mesas`

- Rough row count (n_live_tup): **27**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `zone` | text | YES |  |  |
| 6 | `capacity` | integer | YES | 4 |  |
| 7 | `status` | text | NO | 'libre'::text |  |
| 8 | `waiter_empleado_supabase_id` | uuid | YES |  |  |
| 9 | `guests_count` | integer | YES | 0 |  |
| 10 | `seated_at` | timestamp with time zone | YES |  |  |
| 11 | `sort_order` | integer | YES | 0 |  |
| 12 | `active` | boolean | NO | true |  |
| 13 | `created_at` | timestamp with time zone | NO | now() |  |
| 14 | `updated_at` | timestamp with time zone | NO | now() |  |
| 15 | `rev` | integer | NO | 0 |  |
| 16 | `bill_requested_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `mesas_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `mesas_supabase_id_key` — UNIQUE (supabase_id)
- `uq_mesas_biz_name` — UNIQUE (business_id, name)
- `uq_mesas_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `mesas_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `mesas_pkey` (btree)
  `CREATE UNIQUE INDEX mesas_pkey ON public.mesas USING btree (id)`
- `mesas_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX mesas_supabase_id_key ON public.mesas USING btree (supabase_id)`
- `uq_mesas_biz_name` (btree)
  `CREATE UNIQUE INDEX uq_mesas_biz_name ON public.mesas USING btree (business_id, name)`
- `uq_mesas_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_mesas_biz_sid ON public.mesas USING btree (business_id, supabase_id)`
- `uq_mesas_name` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_mesas_name ON public.mesas USING btree (business_id, name) WHERE ((name IS NOT NULL) AND (name <> ''::text))`
- `uq_mesas_natural` (btree)
  `CREATE UNIQUE INDEX uq_mesas_natural ON public.mesas USING btree (business_id, name)`

### `modificadores`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `group_name` | text | YES |  |  |
| 6 | `price_delta` | numeric | NO | 0 |  |
| 7 | `min_select` | integer | YES | 0 |  |
| 8 | `max_select` | integer | YES | 1 |  |
| 9 | `default_selected` | boolean | NO | false |  |
| 10 | `sort_order` | integer | YES | 0 |  |
| 11 | `active` | boolean | NO | true |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |
| 14 | `modifier_group_id` | uuid | YES |  |  |
| 15 | `modifier_group_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `modificadores_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `modificadores_supabase_id_key` — UNIQUE (supabase_id)
- `uq_modificadores_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `modificadores_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `modificadores_modifier_group_id_fkey` — FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_

**Indexes**

- `idx_mod_group_sb` (btree)
  `CREATE INDEX idx_mod_group_sb ON public.modificadores USING btree (modifier_group_supabase_id)`
- `modificadores_pkey` (btree)
  `CREATE UNIQUE INDEX modificadores_pkey ON public.modificadores USING btree (id)`
- `modificadores_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX modificadores_supabase_id_key ON public.modificadores USING btree (supabase_id)`
- `uq_modificadores_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_modificadores_biz_sid ON public.modificadores USING btree (business_id, supabase_id)`
- `uq_modificadores_natural` (btree)
  `CREATE UNIQUE INDEX uq_modificadores_natural ON public.modificadores USING btree (business_id, name, group_name)`

### `modifier_groups`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `min_select` | integer | YES | 0 |  |
| 6 | `max_select` | integer | YES | 1 |  |
| 7 | `sort_order` | integer | YES | 0 |  |
| 8 | `active` | boolean | YES | true |  |
| 9 | `created_at` | timestamp with time zone | YES | now() |  |
| 10 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `modifier_groups_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `modifier_groups_biz_sb_uq` — UNIQUE (business_id, supabase_id)
- `modifier_groups_supabase_id_key` — UNIQUE (supabase_id)
- `uq_modifier_groups_biz_name` — UNIQUE (business_id, name)

**Foreign Keys**

- `modifier_groups_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_modifier_groups_biz` (btree)
  `CREATE INDEX idx_modifier_groups_biz ON public.modifier_groups USING btree (business_id)`
- `modifier_groups_biz_sb_uq` (btree)
  `CREATE UNIQUE INDEX modifier_groups_biz_sb_uq ON public.modifier_groups USING btree (business_id, supabase_id)`
- `modifier_groups_pkey` (btree)
  `CREATE UNIQUE INDEX modifier_groups_pkey ON public.modifier_groups USING btree (id)`
- `modifier_groups_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX modifier_groups_supabase_id_key ON public.modifier_groups USING btree (supabase_id)`
- `uq_modifier_groups_biz_name` (btree)
  `CREATE UNIQUE INDEX uq_modifier_groups_biz_name ON public.modifier_groups USING btree (business_id, name)`
- `uq_modifier_groups_name` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_modifier_groups_name ON public.modifier_groups USING btree (business_id, name) WHERE ((name IS NOT NULL) AND (name <> ''::text))`

### `ncf_blocks`

- Rough row count (n_live_tup): **21**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `hwid` | text | NO |  |  |
| 5 | `device_label` | text | YES |  |  |
| 6 | `ncf_type` | text | NO |  |  |
| 7 | `prefix` | text | NO |  |  |
| 8 | `range_start` | bigint | NO |  |  |
| 9 | `range_end` | bigint | NO |  |  |
| 10 | `next_available` | bigint | NO |  |  |
| 11 | `size` | integer | NO |  |  |
| 12 | `allocated_at` | timestamp with time zone | NO | now() |  |
| 13 | `exhausted_at` | timestamp with time zone | YES |  |  |
| 14 | `last_used_at` | timestamp with time zone | YES |  |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ncf_blocks_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ncf_blocks_supabase_id_key` — UNIQUE (supabase_id)
- `ncf_blocks_unique_bid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `ncf_blocks_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `ncf_blocks_range_valid` — CHECK (((range_end >= range_start) AND (next_available >= range_start) AND (next_available <= (range_end + 1))))

**Indexes**

- `idx_ncf_blocks_biz_hwid_type` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_ncf_blocks_biz_hwid_type ON public.ncf_blocks USING btree (business_id, hwid, ncf_type) WHERE (exhausted_at IS NULL)`
- `idx_ncf_blocks_biz_type` (btree)
  `CREATE INDEX idx_ncf_blocks_biz_type ON public.ncf_blocks USING btree (business_id, ncf_type)`
- `ncf_blocks_no_overlap` (gist)
  `CREATE INDEX ncf_blocks_no_overlap ON public.ncf_blocks USING gist (business_id, ncf_type, int8range(range_start, range_end, '[]'::text))`
- `ncf_blocks_pkey` (btree)
  `CREATE UNIQUE INDEX ncf_blocks_pkey ON public.ncf_blocks USING btree (id)`
- `ncf_blocks_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX ncf_blocks_supabase_id_key ON public.ncf_blocks USING btree (supabase_id)`
- `ncf_blocks_unique_bid` (btree)
  `CREATE UNIQUE INDEX ncf_blocks_unique_bid ON public.ncf_blocks USING btree (business_id, supabase_id)`

### `ncf_sequences`

- Rough row count (n_live_tup): **99**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `type` | text | NO |  |  |
| 4 | `prefix` | text | NO |  |  |
| 5 | `current_number` | integer | NO | 0 |  |
| 6 | `limit_number` | integer | NO | 500 |  |
| 7 | `valid_until` | date | YES |  |  |
| 8 | `active` | boolean | NO | true |  |
| 9 | `enabled` | boolean | NO | false |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `local_id` | integer | YES |  |  |
| 12 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ncf_sequences_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ncf_sequences_business_type_uniq` — UNIQUE (business_id, type)
- `ncf_sequences_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_ncf_sequences_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_ncf_sequences_biz_type_prefix` — UNIQUE (business_id, type, prefix)

**Foreign Keys**

- `ncf_sequences_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_ncf_seq_business` (btree)
  `CREATE INDEX idx_ncf_seq_business ON public.ncf_sequences USING btree (business_id)`
- `ncf_sequences_business_type_uniq` (btree)
  `CREATE UNIQUE INDEX ncf_sequences_business_type_uniq ON public.ncf_sequences USING btree (business_id, type)`
- `ncf_sequences_pkey` (btree)
  `CREATE UNIQUE INDEX ncf_sequences_pkey ON public.ncf_sequences USING btree (id)`
- `ncf_sequences_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX ncf_sequences_supabase_id_uniq ON public.ncf_sequences USING btree (supabase_id)`
- `uq_ncf_seq_local2` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_ncf_seq_local2 ON public.ncf_sequences USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_ncf_sequences_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_ncf_sequences_biz_sid ON public.ncf_sequences USING btree (business_id, supabase_id)`
- `uq_ncf_sequences_biz_type_prefix` (btree)
  `CREATE UNIQUE INDEX uq_ncf_sequences_biz_type_prefix ON public.ncf_sequences USING btree (business_id, type, prefix)`

### `ncf_sequences_master`

- Rough row count (n_live_tup): **8**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `ncf_type` | text | NO |  |  |
| 4 | `prefix` | text | NO |  |  |
| 5 | `range_start` | bigint | NO |  |  |
| 6 | `range_end` | bigint | NO |  |  |
| 7 | `next_global` | bigint | NO |  |  |
| 8 | `exhausted` | boolean | NO | false |  |
| 9 | `created_at` | timestamp with time zone | NO | now() |  |
| 10 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ncf_sequences_master_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ncf_seq_master_unique` — UNIQUE (business_id, ncf_type)

**Foreign Keys**

- `ncf_sequences_master_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_ncf_seq_master_biz` (btree)
  `CREATE INDEX idx_ncf_seq_master_biz ON public.ncf_sequences_master USING btree (business_id)`
- `ncf_seq_master_unique` (btree)
  `CREATE UNIQUE INDEX ncf_seq_master_unique ON public.ncf_sequences_master USING btree (business_id, ncf_type)`
- `ncf_sequences_master_pkey` (btree)
  `CREATE UNIQUE INDEX ncf_sequences_master_pkey ON public.ncf_sequences_master USING btree (id)`

### `notas_credito`

- Rough row count (n_live_tup): **10**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `ncf` | text | NO |  |  |
| 4 | `client_id` | uuid | YES |  |  |
| 5 | `original_ticket_id` | uuid | YES |  |  |
| 6 | `motivo` | text | NO | 'Devolucion'::text |  |
| 7 | `amount` | numeric | NO |  |  |
| 8 | `itbis_revertido` | numeric | NO | 0 |  |
| 9 | `forma_devolucion` | text | NO | 'Efectivo'::text |  |
| 10 | `comentario` | text | YES |  |  |
| 11 | `cajero_id` | uuid | YES |  |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `local_id` | integer | YES |  |  |
| 14 | `local_client_id` | integer | YES |  |  |
| 15 | `local_original_ticket_id` | integer | YES |  |  |
| 16 | `local_cajero_id` | integer | YES |  |  |
| 17 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 18 | `client_supabase_id` | uuid | YES |  |  |
| 19 | `original_ticket_supabase_id` | uuid | YES |  |  |
| 20 | `cajero_supabase_id` | uuid | YES |  |  |
| 21 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `notas_credito_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `notas_credito_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_notas_credito_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_notas_credito_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `notas_credito_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `notas_credito_pkey` (btree)
  `CREATE UNIQUE INDEX notas_credito_pkey ON public.notas_credito USING btree (id)`
- `notas_credito_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX notas_credito_supabase_id_uniq ON public.notas_credito USING btree (supabase_id)`
- `uq_notas_credito_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_notas_credito_biz_sid ON public.notas_credito USING btree (business_id, supabase_id)`
- `uq_notas_credito_sid` (btree)
  `CREATE UNIQUE INDEX uq_notas_credito_sid ON public.notas_credito USING btree (business_id, supabase_id)`
- `uq_notas_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_notas_local ON public.notas_credito USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`

### `oferta_items`

- Rough row count (n_live_tup): **44**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('oferta_items_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `oferta_supabase_id` | uuid | NO |  |  |
| 5 | `service_supabase_id` | uuid | YES |  |  |
| 6 | `inventory_item_supabase_id` | uuid | YES |  |  |
| 7 | `qty` | numeric | NO | 1 |  |
| 8 | `created_at` | timestamp with time zone | NO | now() |  |
| 9 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `oferta_items_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `oferta_items_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_oferta_items_biz_supabase_id` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `fk_oferta_items_oferta` — FOREIGN KEY (oferta_supabase_id) REFERENCES ofertas(supabase_id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `oferta_items_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `chk_oferta_items_one_of` — CHECK ((((service_supabase_id IS NOT NULL) AND (inventory_item_supabase_id IS NULL)) OR ((service_supabase_id IS NULL) AND (inventory_item_supabase_id IS NOT NULL))))

**Indexes**

- `idx_oferta_items_biz` (btree)
  `CREATE INDEX idx_oferta_items_biz ON public.oferta_items USING btree (business_id)`
- `idx_oferta_items_oferta` (btree)
  `CREATE INDEX idx_oferta_items_oferta ON public.oferta_items USING btree (oferta_supabase_id)`
- `oferta_items_pkey` (btree)
  `CREATE UNIQUE INDEX oferta_items_pkey ON public.oferta_items USING btree (id)`
- `oferta_items_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX oferta_items_supabase_id_uniq ON public.oferta_items USING btree (supabase_id)`
- `uq_oferta_items_biz_supabase_id` (btree)
  `CREATE UNIQUE INDEX uq_oferta_items_biz_supabase_id ON public.oferta_items USING btree (business_id, supabase_id)`

### `ofertas`

- Rough row count (n_live_tup): **16**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('ofertas_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `description` | text | YES |  |  |
| 6 | `price` | numeric | NO | 0 |  |
| 7 | `active` | boolean | NO | true |  |
| 8 | `starts_at` | timestamp with time zone | YES |  |  |
| 9 | `ends_at` | timestamp with time zone | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ofertas_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `uq_ofertas_biz_supabase_id` — UNIQUE (business_id, supabase_id)
- `uq_ofertas_supabase_id` — UNIQUE (supabase_id)

**Foreign Keys**

- `ofertas_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_ofertas_biz_active` (btree)
  `CREATE INDEX idx_ofertas_biz_active ON public.ofertas USING btree (business_id, active)`
- `ofertas_pkey` (btree)
  `CREATE UNIQUE INDEX ofertas_pkey ON public.ofertas USING btree (id)`
- `uq_ofertas_biz_supabase_id` (btree)
  `CREATE UNIQUE INDEX uq_ofertas_biz_supabase_id ON public.ofertas USING btree (business_id, supabase_id)`
- `uq_ofertas_supabase_id` (btree)
  `CREATE UNIQUE INDEX uq_ofertas_supabase_id ON public.ofertas USING btree (supabase_id)`

### `parts_orders`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('parts_orders_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `work_order_supabase_id` | uuid | YES |  |  |
| 5 | `supplier_supabase_id` | uuid | YES |  |  |
| 6 | `part_name` | text | NO |  |  |
| 7 | `part_sku` | text | YES |  |  |
| 8 | `quantity` | numeric | NO | 1 |  |
| 9 | `unit_cost_estimate` | numeric | YES | 0 |  |
| 10 | `expected_at` | date | YES |  |  |
| 11 | `received_at` | timestamp with time zone | YES |  |  |
| 12 | `received_barcode` | text | YES |  |  |
| 13 | `status` | text | NO | 'pendiente'::text |  |
| 14 | `notes` | text | YES |  |  |
| 15 | `created_at` | timestamp with time zone | YES | now() |  |
| 16 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `parts_orders_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `parts_orders_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `parts_orders_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `parts_orders_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `parts_orders_supplier_supabase_fk` — FOREIGN KEY (supplier_supabase_id) REFERENCES suppliers(supabase_id) ON UPDATE CASCADE ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE CASCADE)_

**Check Constraints**

- `parts_orders_status_check` — CHECK ((status = ANY (ARRAY['pendiente'::text, 'en_camino'::text, 'recibido'::text, 'cancelado'::text])))

**Indexes**

- `parts_orders_barcode_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX parts_orders_barcode_idx ON public.parts_orders USING btree (business_id, received_barcode) WHERE (received_barcode IS NOT NULL)`
- `parts_orders_biz_status_idx` (btree)
  `CREATE INDEX parts_orders_biz_status_idx ON public.parts_orders USING btree (business_id, status)`
- `parts_orders_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX parts_orders_business_supabase_uk ON public.parts_orders USING btree (business_id, supabase_id)`
- `parts_orders_pkey` (btree)
  `CREATE UNIQUE INDEX parts_orders_pkey ON public.parts_orders USING btree (id)`
- `parts_orders_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX parts_orders_supabase_id_key ON public.parts_orders USING btree (supabase_id)`
- `parts_orders_wo_idx` (btree)
  `CREATE INDEX parts_orders_wo_idx ON public.parts_orders USING btree (work_order_supabase_id)`

### `pawn_documents`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `pawn_supabase_id` | uuid | YES |  |  |
| 5 | `doc_type` | text | YES |  |  |
| 6 | `file_url` | text | YES |  |  |
| 7 | `mime_type` | text | YES |  |  |
| 8 | `notes` | text | YES |  |  |
| 9 | `created_at` | timestamp with time zone | YES | now() |  |
| 10 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `pawn_documents_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `pawn_documents_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_pawn_documents_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `pawn_documents_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `pawn_documents_doc_type_check` — CHECK ((doc_type = ANY (ARRAY['foto'::text, 'dpi'::text, 'matricula'::text, 'firma'::text, 'contrato'::text, 'otro'::text])))

**Indexes**

- `pawn_documents_pkey` (btree)
  `CREATE UNIQUE INDEX pawn_documents_pkey ON public.pawn_documents USING btree (id)`
- `pawn_documents_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX pawn_documents_supabase_id_uniq ON public.pawn_documents USING btree (supabase_id)`
- `uq_pawn_documents_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_pawn_documents_biz_sid ON public.pawn_documents USING btree (business_id, supabase_id)`

### `pawn_items`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | uuid | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `loan_id` | uuid | YES |  |  |
| 7 | `loan_supabase_id` | uuid | YES |  |  |
| 8 | `description` | text | NO |  |  |
| 9 | `estimated_value` | numeric | YES | 0 |  |
| 10 | `storage_location` | text | YES |  |  |
| 11 | `status` | text | YES | 'held'::text |  |
| 12 | `redeem_deadline` | date | YES |  |  |
| 13 | `notes` | text | YES |  |  |
| 14 | `created_at` | timestamp with time zone | YES | now() |  |
| 15 | `updated_at` | timestamp with time zone | YES | now() |  |
| 16 | `ticket_code` | text | YES |  |  |
| 17 | `redemption_date` | timestamp with time zone | YES |  |  |
| 18 | `default_alert_days` | integer | YES | 3 |  |
| 19 | `valoracion_notes` | text | YES |  |  |
| 20 | `offered_pct` | numeric | YES | 60 |  |
| 21 | `signature_dataurl` | text | YES |  |  |
| 22 | `prestamista_signature_dataurl` | text | YES |  |  |

**Primary Key**

- `pawn_items_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `pawn_items_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_pawn_items_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `pawn_items_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `pawn_items_pkey` (btree)
  `CREATE UNIQUE INDEX pawn_items_pkey ON public.pawn_items USING btree (id)`
- `pawn_items_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX pawn_items_supabase_id_uniq ON public.pawn_items USING btree (supabase_id)`
- `uniq_pawn_items_business_ticket_code` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uniq_pawn_items_business_ticket_code ON public.pawn_items USING btree (business_id, ticket_code) WHERE (ticket_code IS NOT NULL)`
- `uq_pawn_items_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_pawn_items_biz_sid ON public.pawn_items USING btree (business_id, supabase_id)`

### `pawn_listings`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `pawn_supabase_id` | uuid | YES |  |  |
| 5 | `list_price` | numeric | YES |  |  |
| 6 | `published_at` | timestamp with time zone | YES |  |  |
| 7 | `slug` | text | YES |  |  |
| 8 | `status` | text | YES | 'draft'::text |  |
| 9 | `sold_ticket_supabase_id` | uuid | YES |  |  |
| 10 | `notes` | text | YES |  |  |
| 11 | `created_at` | timestamp with time zone | YES | now() |  |
| 12 | `updated_at` | timestamp with time zone | YES | now() |  |
| 13 | `list_price_override` | boolean | NO | false |  |
| 14 | `override_reason` | text | YES |  |  |

**Primary Key**

- `pawn_listings_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `pawn_listings_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_pawn_listings_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `pawn_listings_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `pawn_listings_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'sold'::text, 'removed'::text])))

**Indexes**

- `pawn_listings_pkey` (btree)
  `CREATE UNIQUE INDEX pawn_listings_pkey ON public.pawn_listings USING btree (id)`
- `pawn_listings_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX pawn_listings_supabase_id_uniq ON public.pawn_listings USING btree (supabase_id)`
- `uq_pawn_listings_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_pawn_listings_biz_sid ON public.pawn_listings USING btree (business_id, supabase_id)`
- `uq_pawn_listings_biz_slug` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_pawn_listings_biz_slug ON public.pawn_listings USING btree (business_id, slug) WHERE (slug IS NOT NULL)`

### `payroll_runs`

- Rough row count (n_live_tup): **90**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('payroll_runs_id_seq'::regclass) |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `empleado_id` | bigint | YES |  |  |
| 4 | `empleado_supabase_id` | uuid | YES |  |  |
| 5 | `period_start` | date | NO |  |  |
| 6 | `period_end` | date | NO |  |  |
| 7 | `base` | numeric | NO | 0 |  |
| 8 | `commissions` | numeric | NO | 0 |  |
| 9 | `bonuses` | numeric | NO | 0 |  |
| 10 | `sfs_employee` | numeric | NO | 0 |  |
| 11 | `afp_employee` | numeric | NO | 0 |  |
| 12 | `isr` | numeric | NO | 0 |  |
| 13 | `other_deductions` | numeric | NO | 0 |  |
| 14 | `deductions` | numeric | NO | 0 |  |
| 15 | `sfs_employer` | numeric | NO | 0 |  |
| 16 | `afp_employer` | numeric | NO | 0 |  |
| 17 | `infotep_employer` | numeric | NO | 0 |  |
| 18 | `net` | numeric | NO | 0 |  |
| 19 | `notes` | text | YES |  |  |
| 20 | `paid_at` | timestamp with time zone | NO | now() |  |
| 21 | `paid_by` | uuid | YES |  |  |
| 22 | `created_at` | timestamp with time zone | NO | now() |  |
| 23 | `updated_at` | timestamp with time zone | NO | now() |  |
| 24 | `supabase_id` | uuid | NO | gen_random_uuid() |  |

**Primary Key**

- `payroll_runs_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `payroll_runs_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_payroll_runs_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_payroll_runs_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `payroll_runs_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_payroll_runs_biz` (btree)
  `CREATE INDEX idx_payroll_runs_biz ON public.payroll_runs USING btree (business_id)`
- `idx_payroll_runs_emp_sid` (btree)
  `CREATE INDEX idx_payroll_runs_emp_sid ON public.payroll_runs USING btree (empleado_supabase_id)`
- `idx_payroll_runs_sid` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX idx_payroll_runs_sid ON public.payroll_runs USING btree (business_id, supabase_id) WHERE (supabase_id IS NOT NULL)`
- `payroll_runs_pkey` (btree)
  `CREATE UNIQUE INDEX payroll_runs_pkey ON public.payroll_runs USING btree (id)`
- `payroll_runs_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX payroll_runs_supabase_id_uniq ON public.payroll_runs USING btree (supabase_id)`
- `uq_payroll_runs_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_payroll_runs_biz_sid ON public.payroll_runs USING btree (business_id, supabase_id)`
- `uq_payroll_runs_sid` (btree)
  `CREATE UNIQUE INDEX uq_payroll_runs_sid ON public.payroll_runs USING btree (business_id, supabase_id)`

### `payroll_settings`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('payroll_settings_id_seq'::regclass) |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `pay_cycle` | text | NO | 'quincenal'::text |  |
| 4 | `sfs_employee_rate` | numeric | NO | 0.0304 |  |
| 5 | `afp_employee_rate` | numeric | NO | 0.0287 |  |
| 6 | `sfs_employer_rate` | numeric | NO | 0.0709 |  |
| 7 | `afp_employer_rate` | numeric | NO | 0.0710 |  |
| 8 | `infotep_employer_rate` | numeric | NO | 0.01 |  |
| 9 | `sfs_monthly_cap` | numeric | NO | 232230 |  |
| 10 | `afp_monthly_cap` | numeric | NO | 464460 |  |
| 11 | `isr_enabled` | boolean | NO | true |  |
| 12 | `isr_brackets` | jsonb | NO | '[[0, 416220, 0], [416220, 624329, 0.15], [624329, 867123, 0.20], [867123, 999999999, 0.25]]'::jsonb |  |
| 13 | `navidad_enabled` | boolean | NO | true |  |
| 14 | `vacation_days` | integer | NO | 14 |  |
| 15 | `daily_divisor` | numeric | NO | 23.83 |  |
| 16 | `created_at` | timestamp with time zone | NO | now() |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `payroll_settings_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `payroll_settings_business_id_key` — UNIQUE (business_id)

**Foreign Keys**

- `payroll_settings_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_payroll_settings_biz` (btree)
  `CREATE INDEX idx_payroll_settings_biz ON public.payroll_settings USING btree (business_id)`
- `payroll_settings_business_id_key` (btree)
  `CREATE UNIQUE INDEX payroll_settings_business_id_key ON public.payroll_settings USING btree (business_id)`
- `payroll_settings_pkey` (btree)
  `CREATE UNIQUE INDEX payroll_settings_pkey ON public.payroll_settings USING btree (id)`

### `plans`

- Rough row count (n_live_tup): **5**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `name` | text | NO |  |  |
| 3 | `display_name` | text | NO |  |  |
| 4 | `price_monthly` | numeric | NO | 0 |  |
| 5 | `price_yearly` | numeric | NO | 0 |  |
| 6 | `max_users` | integer | NO | 3 |  |
| 7 | `features` | jsonb | NO | '[]'::jsonb |  |
| 8 | `active` | boolean | NO | true |  |
| 9 | `created_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `plans_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `plans_name_key` — UNIQUE (name)

**Indexes**

- `plans_name_key` (btree)
  `CREATE UNIQUE INDEX plans_name_key ON public.plans USING btree (name)`
- `plans_pkey` (btree)
  `CREATE UNIQUE INDEX plans_pkey ON public.plans USING btree (id)`

### `projects`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('projects_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | bigint | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `name` | text | NO |  |  |
| 7 | `description` | text | YES |  |  |
| 8 | `status` | text | NO | 'draft'::text |  |
| 9 | `total_billed` | numeric | NO | 0 |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `closed_at` | timestamp with time zone | YES |  |  |
| 12 | `updated_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `projects_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `projects_biz_sid_unique` — UNIQUE (business_id, supabase_id)
- `projects_supabase_id_uniq` — UNIQUE (supabase_id)

**Indexes**

- `idx_projects_client` (btree)
  `CREATE INDEX idx_projects_client ON public.projects USING btree (business_id, client_supabase_id)`
- `idx_projects_status` (btree)
  `CREATE INDEX idx_projects_status ON public.projects USING btree (business_id, status)`
- `projects_biz_sid_unique` (btree)
  `CREATE UNIQUE INDEX projects_biz_sid_unique ON public.projects USING btree (business_id, supabase_id)`
- `projects_pkey` (btree)
  `CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id)`
- `projects_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX projects_supabase_id_uniq ON public.projects USING btree (supabase_id)`

### `promotion_items`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('promotion_items_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `promotion_id` | bigint | YES |  |  |
| 5 | `promotion_supabase_id` | uuid | NO |  |  |
| 6 | `item_type` | text | NO |  |  |
| 7 | `item_supabase_id` | uuid | NO |  |  |
| 8 | `created_at` | timestamp with time zone | YES | now() |  |
| 9 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `promotion_items_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `promotion_items_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `promotion_items_promotion_id_fkey` — FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `promotion_items_item_type_check` — CHECK ((item_type = ANY (ARRAY['inventory_item'::text, 'service'::text, 'corte_category'::text])))

**Indexes**

- `idx_promo_items_promo` (btree)
  `CREATE INDEX idx_promo_items_promo ON public.promotion_items USING btree (promotion_supabase_id)`
- `promotion_items_pkey` (btree)
  `CREATE UNIQUE INDEX promotion_items_pkey ON public.promotion_items USING btree (id)`
- `promotion_items_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX promotion_items_supabase_id_key ON public.promotion_items USING btree (supabase_id)`

### `promotions`

- Rough row count (n_live_tup): **3**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('promotions_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `tipo` | text | NO |  |  |
| 6 | `discount_pct` | numeric | YES |  |  |
| 7 | `discount_fixed` | numeric | YES |  |  |
| 8 | `min_purchase` | numeric | YES |  |  |
| 9 | `start_date` | date | YES |  |  |
| 10 | `end_date` | date | YES |  |  |
| 11 | `season_key` | text | YES |  |  |
| 12 | `banner_text` | text | YES |  |  |
| 13 | `active` | boolean | YES | true |  |
| 14 | `created_at` | timestamp with time zone | YES | now() |  |
| 15 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `promotions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `promotions_supabase_id_key` — UNIQUE (supabase_id)
- `uq_promotions_biz_name` — UNIQUE (business_id, name)

**Check Constraints**

- `promotions_tipo_check` — CHECK ((tipo = ANY (ARRAY['pct'::text, 'fijo'::text, 'bundle'::text, 'auto_50_vence'::text])))

**Indexes**

- `idx_promos_biz_active` (btree)
  `CREATE INDEX idx_promos_biz_active ON public.promotions USING btree (business_id, active)`
- `idx_promos_season` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_promos_season ON public.promotions USING btree (business_id, season_key) WHERE (season_key IS NOT NULL)`
- `idx_promos_window` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_promos_window ON public.promotions USING btree (business_id, start_date, end_date) WHERE active`
- `promotions_pkey` (btree)
  `CREATE UNIQUE INDEX promotions_pkey ON public.promotions USING btree (id)`
- `promotions_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX promotions_supabase_id_key ON public.promotions USING btree (supabase_id)`
- `uq_promotions_biz_name` (btree)
  `CREATE UNIQUE INDEX uq_promotions_biz_name ON public.promotions USING btree (business_id, name)`
- `uq_promotions_name` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_promotions_name ON public.promotions USING btree (business_id, name) WHERE ((name IS NOT NULL) AND (name <> ''::text))`

### `queue`

- Rough row count (n_live_tup): **9**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `ticket_id` | uuid | YES |  |  |
| 4 | `status` | text | NO | 'waiting'::text |  |
| 5 | `washer_id` | uuid | YES |  |  |
| 6 | `assigned_at` | timestamp with time zone | YES |  |  |
| 7 | `completed_at` | timestamp with time zone | YES |  |  |
| 8 | `created_at` | timestamp with time zone | NO | now() |  |
| 9 | `local_id` | integer | YES |  |  |
| 10 | `local_ticket_id` | integer | YES |  |  |
| 11 | `local_washer_id` | integer | YES |  |  |
| 12 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 13 | `ticket_supabase_id` | uuid | YES |  |  |
| 14 | `washer_supabase_id` | uuid | YES |  |  |
| 15 | `updated_at` | timestamp with time zone | NO | now() |  |
| 16 | `empleado_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `queue_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `queue_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_queue_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_queue_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `queue_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `queue_ticket_id_fkey` — FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `queue_ticket_supabase_id_fkey` — FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_queue_business` (btree)
  `CREATE INDEX idx_queue_business ON public.queue USING btree (business_id)`
- `idx_queue_empleado` (btree)
  `CREATE INDEX idx_queue_empleado ON public.queue USING btree (empleado_supabase_id)`
- `queue_pkey` (btree)
  `CREATE UNIQUE INDEX queue_pkey ON public.queue USING btree (id)`
- `queue_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX queue_supabase_id_uniq ON public.queue USING btree (supabase_id)`
- `uq_queue_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_queue_biz_sid ON public.queue USING btree (business_id, supabase_id)`
- `uq_queue_local2` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_queue_local2 ON public.queue USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_queue_sid` (btree)
  `CREATE UNIQUE INDEX uq_queue_sid ON public.queue USING btree (business_id, supabase_id)`

### `queue_deletions`

- Rough row count (n_live_tup): **4**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('queue_deletions_id_seq'::regclass) |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `queue_id` | uuid | YES |  |  |
| 4 | `ticket_id` | uuid | YES |  |  |
| 5 | `deleted_by` | text | YES |  |  |
| 6 | `deleted_at` | timestamp with time zone | YES | now() |  |
| 7 | `reason` | text | YES |  |  |
| 8 | `created_at` | timestamp with time zone | YES | now() |  |
| 9 | `supabase_id` | uuid | YES |  |  |
| 10 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `queue_deletions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `queue_deletions_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_queue_deletions_sid` — UNIQUE (business_id, supabase_id)

**Indexes**

- `idx_queue_deletions_biz` (btree)
  `CREATE INDEX idx_queue_deletions_biz ON public.queue_deletions USING btree (business_id)`
- `idx_queue_deletions_sid` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX idx_queue_deletions_sid ON public.queue_deletions USING btree (business_id, supabase_id) WHERE (supabase_id IS NOT NULL)`
- `queue_deletions_pkey` (btree)
  `CREATE UNIQUE INDEX queue_deletions_pkey ON public.queue_deletions USING btree (id)`
- `queue_deletions_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX queue_deletions_supabase_id_uniq ON public.queue_deletions USING btree (supabase_id)`
- `uq_queue_deletions_sid` (btree)
  `CREATE UNIQUE INDEX uq_queue_deletions_sid ON public.queue_deletions USING btree (business_id, supabase_id)`

### `recurring_orders`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('recurring_orders_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_supabase_id` | uuid | NO |  |  |
| 5 | `nombre` | text | NO |  |  |
| 6 | `dia_semana` | integer | YES |  |  |
| 7 | `items_json` | jsonb | NO |  |  |
| 8 | `total_estimado` | numeric | YES |  |  |
| 9 | `whatsapp_confirmar` | boolean | YES | true |  |
| 10 | `last_sent_at` | timestamp with time zone | YES |  |  |
| 11 | `active` | boolean | YES | true |  |
| 12 | `created_at` | timestamp with time zone | YES | now() |  |
| 13 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `recurring_orders_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `recurring_orders_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `recurring_orders_dia_semana_check` — CHECK (((dia_semana >= 0) AND (dia_semana <= 6)))

**Indexes**

- `idx_recurring_biz_dia` (btree)
  `CREATE INDEX idx_recurring_biz_dia ON public.recurring_orders USING btree (business_id, dia_semana, active)`
- `recurring_orders_pkey` (btree)
  `CREATE UNIQUE INDEX recurring_orders_pkey ON public.recurring_orders USING btree (id)`
- `recurring_orders_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX recurring_orders_supabase_id_key ON public.recurring_orders USING btree (supabase_id)`

### `restaurant_reservations`

- Rough row count (n_live_tup): **4**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('restaurant_reservations_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `mesa_id` | bigint | YES |  |  |
| 5 | `mesa_supabase_id` | uuid | YES |  |  |
| 6 | `fecha` | date | NO |  |  |
| 7 | `hora` | time without time zone | NO |  |  |
| 8 | `duration_min` | integer | NO | 90 |  |
| 9 | `nombre` | text | NO |  |  |
| 10 | `telefono` | text | YES |  |  |
| 11 | `guests` | integer | NO | 2 |  |
| 12 | `notas` | text | YES |  |  |
| 13 | `status` | text | NO | 'pendiente'::text |  |
| 14 | `whatsapp_sent_at` | timestamp with time zone | YES |  |  |
| 15 | `cancelled_reason` | text | YES |  |  |
| 16 | `seated_ticket_supabase_id` | uuid | YES |  |  |
| 17 | `created_at` | timestamp with time zone | NO | now() |  |
| 18 | `updated_at` | timestamp with time zone | NO | now() |  |
| 19 | `deposit_amount` | numeric | YES |  |  |
| 20 | `deposit_status` | text | YES |  |  |
| 21 | `deposit_ticket_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `restaurant_reservations_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `restaurant_reservations_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `restaurant_reservations_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `restaurant_reservations_guests_check` — CHECK ((guests > 0))
- `restaurant_reservations_status_check` — CHECK ((status = ANY (ARRAY['pendiente'::text, 'confirmada'::text, 'sentada'::text, 'cancelada'::text, 'no_show'::text])))

**Indexes**

- `idx_restaurant_reservations_biz_date` (btree)
  `CREATE INDEX idx_restaurant_reservations_biz_date ON public.restaurant_reservations USING btree (business_id, fecha, hora)`
- `idx_restaurant_reservations_status` (btree)
  `CREATE INDEX idx_restaurant_reservations_status ON public.restaurant_reservations USING btree (business_id, status)`
- `restaurant_reservations_pkey` (btree)
  `CREATE UNIQUE INDEX restaurant_reservations_pkey ON public.restaurant_reservations USING btree (id)`
- `restaurant_reservations_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX restaurant_reservations_supabase_id_key ON public.restaurant_reservations USING btree (supabase_id)`

### `rnc_cache`

- Rough row count (n_live_tup): **3**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `rnc` | text | NO |  |  |
| 4 | `nombre` | text | NO | ''::text |  |
| 5 | `nombre_comercial` | text | YES | ''::text |  |
| 6 | `estado` | text | YES | 'ACTIVO'::text |  |
| 7 | `source` | text | NO | 'api'::text |  |
| 8 | `synced_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `rnc_cache_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `rnc_cache_business_id_rnc_key` — UNIQUE (business_id, rnc)

**Foreign Keys**

- `rnc_cache_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_rnc_cache_lookup` (btree)
  `CREATE INDEX idx_rnc_cache_lookup ON public.rnc_cache USING btree (business_id, rnc)`
- `rnc_cache_business_id_rnc_key` (btree)
  `CREATE UNIQUE INDEX rnc_cache_business_id_rnc_key ON public.rnc_cache USING btree (business_id, rnc)`
- `rnc_cache_pkey` (btree)
  `CREATE UNIQUE INDEX rnc_cache_pkey ON public.rnc_cache USING btree (id)`

### `rnc_contribuyentes`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `rnc` | text | NO |  |  |
| 2 | `nombre` | text | YES |  |  |
| 3 | `estado` | text | YES |  |  |
| 4 | `actividad` | text | YES |  |  |
| 5 | `fecha_inicio` | date | YES |  |  |
| 6 | `regimen` | text | YES |  |  |
| 7 | `created_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `rnc_contribuyentes_pkey` — PRIMARY KEY (rnc)

**Indexes**

- `rnc_contribuyentes_pkey` (btree)
  `CREATE UNIQUE INDEX rnc_contribuyentes_pkey ON public.rnc_contribuyentes USING btree (rnc)`

### `salary_changes`

- Rough row count (n_live_tup): **10**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('salary_changes_id_seq'::regclass) |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `empleado_id` | bigint | YES |  |  |
| 4 | `empleado_supabase_id` | uuid | YES |  |  |
| 5 | `old_salary` | numeric | NO |  |  |
| 6 | `new_salary` | numeric | NO |  |  |
| 7 | `effective_date` | date | NO |  |  |
| 8 | `reason` | text | YES |  |  |
| 9 | `changed_by` | uuid | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `updated_at` | timestamp with time zone | NO | now() |  |
| 12 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 13 | `active` | boolean | YES | true |  |

**Primary Key**

- `salary_changes_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `salary_changes_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_salary_changes_natural` — UNIQUE NULLS NOT DISTINCT (business_id, empleado_supabase_id, effective_date)
- `uq_salary_changes_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `salary_changes_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_salary_changes_biz` (btree)
  `CREATE INDEX idx_salary_changes_biz ON public.salary_changes USING btree (business_id)`
- `idx_salary_changes_emp_sid` (btree)
  `CREATE INDEX idx_salary_changes_emp_sid ON public.salary_changes USING btree (empleado_supabase_id)`
- `idx_salary_changes_sid` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX idx_salary_changes_sid ON public.salary_changes USING btree (business_id, supabase_id) WHERE (supabase_id IS NOT NULL)`
- `salary_changes_pkey` (btree)
  `CREATE UNIQUE INDEX salary_changes_pkey ON public.salary_changes USING btree (id)`
- `salary_changes_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX salary_changes_supabase_id_uniq ON public.salary_changes USING btree (supabase_id)`
- `uq_salary_changes_natural` (btree)
  `CREATE UNIQUE INDEX uq_salary_changes_natural ON public.salary_changes USING btree (business_id, empleado_supabase_id, effective_date) NULLS NOT DISTINCT`
- `uq_salary_changes_sid` (btree)
  `CREATE UNIQUE INDEX uq_salary_changes_sid ON public.salary_changes USING btree (business_id, supabase_id)`

### `sales_deals`

- Rough row count (n_live_tup): **5**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | uuid | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `vehicle_inventory_id` | uuid | YES |  |  |
| 7 | `vehicle_inventory_supabase_id` | uuid | YES |  |  |
| 8 | `salesperson_id` | uuid | YES |  |  |
| 9 | `salesperson_supabase_id` | uuid | YES |  |  |
| 10 | `sale_price` | numeric | YES | 0 |  |
| 11 | `trade_in_vehicle_id` | uuid | YES |  |  |
| 12 | `trade_in_supabase_id` | uuid | YES |  |  |
| 13 | `trade_in_value` | numeric | YES | 0 |  |
| 14 | `down_payment` | numeric | YES | 0 |  |
| 15 | `financed_amount` | numeric | YES | 0 |  |
| 16 | `term_months` | integer | YES | 0 |  |
| 17 | `apr` | numeric | YES | 0 |  |
| 18 | `monthly_payment` | numeric | YES | 0 |  |
| 19 | `status` | text | YES | 'draft'::text |  |
| 20 | `ticket_id` | uuid | YES |  |  |
| 21 | `ticket_supabase_id` | uuid | YES |  |  |
| 22 | `closed_at` | timestamp with time zone | YES |  |  |
| 23 | `notes` | text | YES |  |  |
| 24 | `active` | boolean | YES | true |  |
| 25 | `created_at` | timestamp with time zone | YES | now() |  |
| 26 | `updated_at` | timestamp with time zone | YES | now() |  |
| 27 | `commission_pct` | numeric | YES |  |  |
| 28 | `commission_amount` | numeric | YES |  |  |
| 29 | `commission_paid` | boolean | YES | false |  |
| 30 | `commission_paid_at` | timestamp with time zone | YES |  |  |
| 31 | `dgii_e31_required` | boolean | YES | false |  |
| 32 | `uaf_threshold_exceeded` | boolean | YES | false |  |
| 33 | `uaf_report_url` | text | YES |  |  |
| 34 | `uaf_acknowledged_by` | text | YES |  |  |
| 35 | `uaf_acknowledged_at` | timestamp with time zone | YES |  |  |
| 36 | `bank_preapproval_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `sales_deals_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `sales_deals_biz_sid_key` — UNIQUE (business_id, supabase_id)
- `sales_deals_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `sales_deals_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_sales_deals_biz_status` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_sales_deals_biz_status ON public.sales_deals USING btree (business_id, status) WHERE (active = true)`
- `idx_sales_deals_preapproval` (btree)
  `CREATE INDEX idx_sales_deals_preapproval ON public.sales_deals USING btree (bank_preapproval_supabase_id)`
- `sales_deals_biz_sid_key` (btree)
  `CREATE UNIQUE INDEX sales_deals_biz_sid_key ON public.sales_deals USING btree (business_id, supabase_id)`
- `sales_deals_pkey` (btree)
  `CREATE UNIQUE INDEX sales_deals_pkey ON public.sales_deals USING btree (id)`
- `sales_deals_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX sales_deals_supabase_id_key ON public.sales_deals USING btree (supabase_id)`

### `seller_commissions`

- Rough row count (n_live_tup): **23**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 4 | `ticket_id` | uuid | YES |  |  |
| 5 | `base_amount` | numeric | NO |  |  |
| 6 | `commission_pct` | numeric | NO |  |  |
| 7 | `commission_amount` | numeric | NO |  |  |
| 8 | `paid` | boolean | NO | false |  |
| 9 | `paid_at` | timestamp with time zone | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `local_id` | integer | YES |  |  |
| 12 | `local_seller_id` | integer | YES |  |  |
| 13 | `local_ticket_id` | integer | YES |  |  |
| 14 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 15 | `seller_supabase_id` | uuid | YES |  |  |
| 16 | `ticket_supabase_id` | uuid | YES |  |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |
| 18 | `empleado_supabase_id` | uuid | YES |  |  |
| 19 | `manual_reason` | text | YES |  |  |

**Primary Key**

- `seller_commissions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `seller_commissions_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_seller_commissions_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `seller_commissions_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `seller_commissions_ticket_id_fkey` — FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `seller_commissions_ticket_supabase_id_fkey` — FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_seller_comm_biz` (btree)
  `CREATE INDEX idx_seller_comm_biz ON public.seller_commissions USING btree (business_id)`
- `idx_seller_comm_date` (btree)
  `CREATE INDEX idx_seller_comm_date ON public.seller_commissions USING btree (business_id, created_at DESC)`
- `idx_seller_comm_paid` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_seller_comm_paid ON public.seller_commissions USING btree (business_id, paid) WHERE (paid = false)`
- `idx_seller_comm_ticket` (btree)
  `CREATE INDEX idx_seller_comm_ticket ON public.seller_commissions USING btree (ticket_id)`
- `idx_seller_commissions_created_brin` (brin)
  `CREATE INDEX idx_seller_commissions_created_brin ON public.seller_commissions USING brin (created_at) WITH (pages_per_range='32')`
- `seller_commissions_pkey` (btree)
  `CREATE UNIQUE INDEX seller_commissions_pkey ON public.seller_commissions USING btree (id)`
- `seller_commissions_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX seller_commissions_supabase_id_uniq ON public.seller_commissions USING btree (supabase_id)`
- `seller_commissions_unique_per_ticket_emp` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX seller_commissions_unique_per_ticket_emp ON public.seller_commissions USING btree (business_id, ticket_supabase_id, empleado_supabase_id) WHERE ((ticket_supabase_id IS NOT NULL) AND (empleado_supabase_id IS NOT NULL))`
- `uq_seller_comm_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_seller_comm_local ON public.seller_commissions USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_seller_commissions_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_seller_commissions_biz_sid ON public.seller_commissions USING btree (business_id, supabase_id)`

### `service_bays`

- Rough row count (n_live_tup): **4**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `status` | text | YES | 'libre'::text |  |
| 6 | `current_work_order_id` | uuid | YES |  |  |
| 7 | `current_work_order_supabase_id` | uuid | YES |  |  |
| 8 | `capacity` | integer | YES | 1 |  |
| 9 | `bay_type` | text | YES |  |  |
| 10 | `active` | boolean | YES | true |  |
| 11 | `created_at` | timestamp with time zone | YES | now() |  |
| 12 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `service_bays_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `service_bays_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `service_bays_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_service_bays_biz_name` — UNIQUE (business_id, name)
- `uq_service_bays_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `service_bays_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `service_bays_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX service_bays_business_supabase_uk ON public.service_bays USING btree (business_id, supabase_id)`
- `service_bays_pkey` (btree)
  `CREATE UNIQUE INDEX service_bays_pkey ON public.service_bays USING btree (id)`
- `service_bays_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX service_bays_supabase_id_uniq ON public.service_bays USING btree (supabase_id)`
- `uq_service_bays_biz_name` (btree)
  `CREATE UNIQUE INDEX uq_service_bays_biz_name ON public.service_bays USING btree (business_id, name)`
- `uq_service_bays_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_service_bays_biz_sid ON public.service_bays USING btree (business_id, supabase_id)`
- `uq_service_bays_name` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_service_bays_name ON public.service_bays USING btree (business_id, name) WHERE ((name IS NOT NULL) AND (name <> ''::text))`

### `service_modificadores`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `service_supabase_id` | uuid | NO |  |  |
| 5 | `modificador_supabase_id` | uuid | NO |  |  |
| 6 | `is_required` | boolean | NO | false |  |
| 7 | `created_at` | timestamp with time zone | NO | now() |  |
| 8 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `service_modificadores_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `service_modificadores_supabase_id_key` — UNIQUE (supabase_id)
- `uq_service_modificadores_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_service_modificadores_biz_svc_mod` — UNIQUE (business_id, service_supabase_id, modificador_supabase_id)

**Foreign Keys**

- `service_modificadores_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_sm_modificador` (btree)
  `CREATE INDEX idx_sm_modificador ON public.service_modificadores USING btree (modificador_supabase_id)`
- `idx_sm_service` (btree)
  `CREATE INDEX idx_sm_service ON public.service_modificadores USING btree (service_supabase_id)`
- `service_modificadores_pkey` (btree)
  `CREATE UNIQUE INDEX service_modificadores_pkey ON public.service_modificadores USING btree (id)`
- `service_modificadores_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX service_modificadores_supabase_id_key ON public.service_modificadores USING btree (supabase_id)`
- `uq_service_modificadores_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_service_modificadores_biz_sid ON public.service_modificadores USING btree (business_id, supabase_id)`
- `uq_service_modificadores_biz_svc_mod` (btree)
  `CREATE UNIQUE INDEX uq_service_modificadores_biz_svc_mod ON public.service_modificadores USING btree (business_id, service_supabase_id, modificador_supabase_id)`

### `service_packages`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('service_packages_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | bigint | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `service_id` | bigint | YES |  |  |
| 7 | `service_supabase_id` | uuid | YES |  |  |
| 8 | `package_name` | text | NO |  |  |
| 9 | `total_sessions` | integer | NO | 0 |  |
| 10 | `used_sessions` | integer | NO | 0 |  |
| 11 | `purchase_price` | numeric | NO | 0 |  |
| 12 | `purchased_at` | timestamp with time zone | NO | now() |  |
| 13 | `expires_at` | timestamp with time zone | YES |  |  |
| 14 | `status` | text | NO | 'active'::text |  |
| 15 | `notes` | text | YES |  |  |
| 16 | `created_at` | timestamp with time zone | NO | now() |  |
| 17 | `updated_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `service_packages_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `service_packages_biz_sid_unique` — UNIQUE (business_id, supabase_id)
- `service_packages_supabase_id_uniq` — UNIQUE (supabase_id)

**Indexes**

- `idx_service_packages_client` (btree)
  `CREATE INDEX idx_service_packages_client ON public.service_packages USING btree (business_id, client_supabase_id)`
- `idx_service_packages_status` (btree)
  `CREATE INDEX idx_service_packages_status ON public.service_packages USING btree (business_id, status)`
- `service_packages_biz_sid_unique` (btree)
  `CREATE UNIQUE INDEX service_packages_biz_sid_unique ON public.service_packages USING btree (business_id, supabase_id)`
- `service_packages_pkey` (btree)
  `CREATE UNIQUE INDEX service_packages_pkey ON public.service_packages USING btree (id)`
- `service_packages_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX service_packages_supabase_id_uniq ON public.service_packages USING btree (supabase_id)`

### `service_projects`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_supabase_id` | uuid | YES |  |  |
| 5 | `project_name` | text | NO |  |  |
| 6 | `description` | text | YES |  |  |
| 7 | `status` | text | YES | 'active'::text |  |
| 8 | `billing_type` | text | YES | 'project'::text |  |
| 9 | `estimated_hours` | numeric | YES |  |  |
| 10 | `hourly_rate` | numeric | YES |  |  |
| 11 | `fixed_price` | numeric | YES |  |  |
| 12 | `total_billed` | numeric | YES | 0 |  |
| 13 | `total_paid` | numeric | YES | 0 |  |
| 14 | `started_at` | timestamp with time zone | YES |  |  |
| 15 | `due_date` | text | YES |  |  |
| 16 | `completed_at` | timestamp with time zone | YES |  |  |
| 17 | `assigned_empleado_supabase_id` | uuid | YES |  |  |
| 18 | `notes` | text | YES |  |  |
| 19 | `created_at` | timestamp with time zone | YES | now() |  |
| 20 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `service_projects_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `service_projects_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_service_projects_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `service_projects_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `service_projects_billing_type_check` — CHECK ((billing_type = ANY (ARRAY['hourly'::text, 'project'::text, 'visit'::text, 'subscription'::text])))
- `service_projects_status_check` — CHECK ((status = ANY (ARRAY['quoted'::text, 'active'::text, 'completed'::text, 'cancelled'::text, 'on_hold'::text])))

**Indexes**

- `idx_service_projects_business_id` (btree)
  `CREATE INDEX idx_service_projects_business_id ON public.service_projects USING btree (business_id)`
- `idx_service_projects_client` (btree)
  `CREATE INDEX idx_service_projects_client ON public.service_projects USING btree (client_supabase_id)`
- `idx_service_projects_status` (btree)
  `CREATE INDEX idx_service_projects_status ON public.service_projects USING btree (business_id, status)`
- `service_projects_pkey` (btree)
  `CREATE UNIQUE INDEX service_projects_pkey ON public.service_projects USING btree (id)`
- `service_projects_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX service_projects_supabase_id_uniq ON public.service_projects USING btree (supabase_id)`
- `uq_service_projects_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_service_projects_biz_sid ON public.service_projects USING btree (business_id, supabase_id)`

### `service_recipe_items`

- Rough row count (n_live_tup): **42**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('service_recipe_items_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `service_supabase_id` | uuid | NO |  |  |
| 5 | `inventory_item_supabase_id` | uuid | NO |  |  |
| 6 | `qty_per_unit` | real | NO | 0 |  |
| 7 | `created_at` | timestamp with time zone | NO | now() |  |
| 8 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `service_recipe_items_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `service_recipe_items_supabase_id_key` — UNIQUE (supabase_id)
- `uq_service_recipe_items_biz_service_item` — UNIQUE (business_id, service_supabase_id, inventory_item_supabase_id)

**Foreign Keys**

- `service_recipe_items_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `service_recipe_items_qty_per_unit_check` — CHECK ((qty_per_unit >= (0)::double precision))

**Indexes**

- `idx_service_recipe_items_biz_item` (btree)
  `CREATE INDEX idx_service_recipe_items_biz_item ON public.service_recipe_items USING btree (business_id, inventory_item_supabase_id)`
- `idx_service_recipe_items_biz_service` (btree)
  `CREATE INDEX idx_service_recipe_items_biz_service ON public.service_recipe_items USING btree (business_id, service_supabase_id)`
- `service_recipe_items_pkey` (btree)
  `CREATE UNIQUE INDEX service_recipe_items_pkey ON public.service_recipe_items USING btree (id)`
- `service_recipe_items_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX service_recipe_items_supabase_id_key ON public.service_recipe_items USING btree (supabase_id)`
- `uq_service_recipe_items_biz_service_item` (btree)
  `CREATE UNIQUE INDEX uq_service_recipe_items_biz_service_item ON public.service_recipe_items USING btree (business_id, service_supabase_id, inventory_item_supabase_id)`

### `services`

- Rough row count (n_live_tup): **313**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `categoria_id` | uuid | YES |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `name_en` | text | YES |  |  |
| 6 | `category` | text | NO | 'Lavado'::text |  |
| 7 | `price` | numeric | NO |  |  |
| 8 | `aplica_itbis` | boolean | NO | true |  |
| 9 | `is_wash` | boolean | NO | true |  |
| 10 | `active` | boolean | NO | true |  |
| 11 | `sort_order` | integer | NO | 0 |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |
| 14 | `local_id` | integer | YES |  |  |
| 15 | `cost` | numeric | NO | 0 |  |
| 16 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 17 | `no_commission` | boolean | YES | false |  |
| 18 | `commission_washer` | boolean | YES | true |  |
| 19 | `commission_seller` | boolean | YES | true |  |
| 20 | `commission_cashier` | boolean | YES | true |  |
| 21 | `printer_route` | text | YES | 'receipt'::text |  |
| 22 | `is_menu_item` | boolean | YES | false |  |
| 23 | `course` | text | YES |  |  |
| 24 | `station` | text | YES |  |  |
| 25 | `happy_hour_price` | numeric | YES |  |  |
| 26 | `happy_hour_start` | text | YES |  |  |
| 27 | `happy_hour_end` | text | YES |  |  |
| 28 | `legacy_code` | text | YES |  |  |
| 29 | `legacy_source` | text | YES |  |  |
| 30 | `in_stock` | boolean | NO | true |  |
| 31 | `duration_min` | integer | YES | 30 |  |

**Primary Key**

- `services_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `services_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_services_biz_name` — UNIQUE (business_id, name)
- `uq_services_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_services_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `services_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_services_business` (btree)
  `CREATE INDEX idx_services_business ON public.services USING btree (business_id)`
- `idx_services_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_services_local ON public.services USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `idx_services_oos` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_services_oos ON public.services USING btree (business_id) WHERE (in_stock = false)`
- `services_pkey` (btree)
  `CREATE UNIQUE INDEX services_pkey ON public.services USING btree (id)`
- `services_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX services_supabase_id_uniq ON public.services USING btree (supabase_id)`
- `uq_services_biz_name` (btree)
  `CREATE UNIQUE INDEX uq_services_biz_name ON public.services USING btree (business_id, name)`
- `uq_services_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_services_biz_sid ON public.services USING btree (business_id, supabase_id)`
- `uq_services_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_services_local ON public.services USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_services_name` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_services_name ON public.services USING btree (business_id, name) WHERE ((name IS NOT NULL) AND (name <> ''::text))`
- `uq_services_natural` (btree)
  `CREATE UNIQUE INDEX uq_services_natural ON public.services USING btree (business_id, name)`
- `uq_services_sid` (btree)
  `CREATE UNIQUE INDEX uq_services_sid ON public.services USING btree (business_id, supabase_id)`

### `staff`

- Rough row count (n_live_tup): **31**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `auth_user_id` | uuid | YES |  |  |
| 4 | `name` | text | NO |  |  |
| 5 | `username` | text | NO | ''::text |  |
| 6 | `pin_hash` | text | YES |  |  |
| 7 | `role` | text | NO | 'cashier'::text |  |
| 8 | `discount_pct` | numeric | NO | 0 |  |
| 10 | `active` | boolean | NO | true |  |
| 11 | `created_at` | timestamp with time zone | NO | now() |  |
| 12 | `updated_at` | timestamp with time zone | NO | now() |  |
| 13 | `local_id` | integer | YES |  |  |
| 14 | `commission_pct` | numeric | NO | 0 |  |
| 15 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 16 | `cedula` | text | YES |  |  |
| 17 | `start_date` | text | YES |  |  |
| 18 | `employee_id` | integer | YES |  |  |
| 19 | `legacy_source` | text | YES |  |  |
| 20 | `manager_auth_hash` | text | YES |  |  |
| 21 | `manager_auth_rotated_at` | timestamp with time zone | YES |  |  |
| 22 | `pin_hash_algo` | text | YES | 'bcrypt'::text |  |
| 23 | `pin_salt` | text | YES |  |  |
| 24 | `pin_failed_attempts` | integer | NO | 0 |  |
| 25 | `pin_locked_until` | timestamp with time zone | YES |  |  |
| 26 | `empleado_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `staff_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `staff_business_auth_user_uniq` — UNIQUE (business_id, auth_user_id)
- `staff_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_staff_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_staff_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `staff_auth_user_id_fkey` — FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_
- `staff_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `chk_staff_username_not_blank` — CHECK ((length(TRIM(BOTH FROM username)) > 0))
- `staff_pin_hash_algo_matches_hash` — CHECK (((pin_hash IS NULL) OR ((pin_hash ~~ '$2a$%'::text) AND (pin_hash_algo = 'bcrypt'::text)) OR ((pin_hash !~~ '$2%'::text) AND (pin_hash_algo = ANY (ARRAY['sha256'::text, 'sha256-legacy'::text]))))) NOT VALID

**Indexes**

- `idx_staff_business` (btree)
  `CREATE INDEX idx_staff_business ON public.staff USING btree (business_id)`
- `idx_staff_empleado_supabase_id` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_staff_empleado_supabase_id ON public.staff USING btree (empleado_supabase_id) WHERE (empleado_supabase_id IS NOT NULL)`
- `idx_staff_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_staff_local ON public.staff USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `idx_staff_mgr_auth_hash` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_staff_mgr_auth_hash ON public.staff USING btree (manager_auth_hash) WHERE (manager_auth_hash IS NOT NULL)`
- `staff_auth_user_id_active_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX staff_auth_user_id_active_idx ON public.staff USING btree (auth_user_id) WHERE (active = true)`
- `staff_business_auth_user_uniq` (btree)
  `CREATE UNIQUE INDEX staff_business_auth_user_uniq ON public.staff USING btree (business_id, auth_user_id)`
- `staff_pkey` (btree)
  `CREATE UNIQUE INDEX staff_pkey ON public.staff USING btree (id)`
- `staff_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX staff_supabase_id_uniq ON public.staff USING btree (supabase_id)`
- `uq_staff_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_staff_biz_sid ON public.staff USING btree (business_id, supabase_id)`
- `uq_staff_biz_username_active` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_staff_biz_username_active ON public.staff USING btree (business_id, username) WHERE (active = true)`
- `uq_staff_local2` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_staff_local2 ON public.staff USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_staff_sid` (btree)
  `CREATE UNIQUE INDEX uq_staff_sid ON public.staff USING btree (business_id, supabase_id)`

### `stylist_schedules`

- Rough row count (n_live_tup): **24**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `empleado_id` | uuid | YES |  |  |
| 5 | `empleado_supabase_id` | uuid | YES |  |  |
| 6 | `day_of_week` | integer | NO |  |  |
| 7 | `start_time` | text | NO |  |  |
| 8 | `end_time` | text | NO |  |  |
| 9 | `active` | boolean | YES | true |  |
| 10 | `created_at` | timestamp with time zone | YES | now() |  |
| 11 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `stylist_schedules_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `stylist_schedules_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_stylist_schedules_biz_emp_dow` — UNIQUE (business_id, empleado_supabase_id, day_of_week)
- `uq_stylist_schedules_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `stylist_schedules_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `stylist_schedules_pkey` (btree)
  `CREATE UNIQUE INDEX stylist_schedules_pkey ON public.stylist_schedules USING btree (id)`
- `stylist_schedules_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX stylist_schedules_supabase_id_uniq ON public.stylist_schedules USING btree (supabase_id)`
- `uq_stylist_schedules_biz_emp_dow` (btree)
  `CREATE UNIQUE INDEX uq_stylist_schedules_biz_emp_dow ON public.stylist_schedules USING btree (business_id, empleado_supabase_id, day_of_week)`
- `uq_stylist_schedules_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_stylist_schedules_biz_sid ON public.stylist_schedules USING btree (business_id, supabase_id)`

### `subscriptions`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('subscriptions_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | bigint | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `service_id` | bigint | YES |  |  |
| 7 | `service_supabase_id` | uuid | YES |  |  |
| 8 | `plan_name` | text | YES |  |  |
| 9 | `interval_days` | integer | NO | 30 |  |
| 10 | `amount` | numeric | NO | 0 |  |
| 11 | `start_date` | date | NO | CURRENT_DATE |  |
| 12 | `next_billing_date` | date | NO | CURRENT_DATE |  |
| 13 | `last_billed_at` | timestamp with time zone | YES |  |  |
| 14 | `status` | text | NO | 'active'::text |  |
| 15 | `notes` | text | YES |  |  |
| 16 | `created_at` | timestamp with time zone | NO | now() |  |
| 17 | `updated_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `subscriptions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `subscriptions_biz_sid_unique` — UNIQUE (business_id, supabase_id)
- `subscriptions_supabase_id_uniq` — UNIQUE (supabase_id)

**Indexes**

- `idx_subscriptions_client` (btree)
  `CREATE INDEX idx_subscriptions_client ON public.subscriptions USING btree (business_id, client_supabase_id)`
- `idx_subscriptions_next` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_subscriptions_next ON public.subscriptions USING btree (business_id, next_billing_date) WHERE (status = 'active'::text)`
- `subscriptions_biz_sid_unique` (btree)
  `CREATE UNIQUE INDEX subscriptions_biz_sid_unique ON public.subscriptions USING btree (business_id, supabase_id)`
- `subscriptions_pkey` (btree)
  `CREATE UNIQUE INDEX subscriptions_pkey ON public.subscriptions USING btree (id)`
- `subscriptions_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX subscriptions_supabase_id_uniq ON public.subscriptions USING btree (supabase_id)`

### `suppliers`

- Rough row count (n_live_tup): **2**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('suppliers_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `nombre` | text | NO |  |  |
| 5 | `rnc` | text | YES |  |  |
| 6 | `telefono` | text | YES |  |  |
| 7 | `contacto` | text | YES |  |  |
| 8 | `notas` | text | YES |  |  |
| 9 | `active` | boolean | YES | true |  |
| 10 | `created_at` | timestamp with time zone | YES | now() |  |
| 11 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `suppliers_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `suppliers_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `suppliers_supabase_id_key` — UNIQUE (supabase_id)
- `uq_suppliers_biz_rnc` — UNIQUE (business_id, rnc)

**Foreign Keys**

- `suppliers_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `suppliers_biz_active_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX suppliers_biz_active_idx ON public.suppliers USING btree (business_id) WHERE (active = true)`
- `suppliers_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX suppliers_business_supabase_uk ON public.suppliers USING btree (business_id, supabase_id)`
- `suppliers_pkey` (btree)
  `CREATE UNIQUE INDEX suppliers_pkey ON public.suppliers USING btree (id)`
- `suppliers_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX suppliers_supabase_id_key ON public.suppliers USING btree (supabase_id)`
- `uq_suppliers_biz_rnc` (btree)
  `CREATE UNIQUE INDEX uq_suppliers_biz_rnc ON public.suppliers USING btree (business_id, rnc)`
- `uq_suppliers_rnc` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_suppliers_rnc ON public.suppliers USING btree (business_id, rnc) WHERE ((rnc IS NOT NULL) AND (rnc <> ''::text))`

### `support_tickets`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `subject` | text | NO |  |  |
| 4 | `message` | text | YES | ''::text |  |
| 5 | `status` | text | YES | 'open'::text |  |
| 6 | `priority` | text | YES | 'medium'::text |  |
| 7 | `admin_response` | text | YES |  |  |
| 8 | `created_at` | timestamp with time zone | YES | now() |  |
| 9 | `updated_at` | timestamp with time zone | YES | now() |  |
| 10 | `resolved_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `support_tickets_pkey` — PRIMARY KEY (id)

**Foreign Keys**

- `support_tickets_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id)  _(ON DELETE NO ACTION, ON UPDATE NO ACTION)_

**Check Constraints**

- `support_tickets_priority_check` — CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
- `support_tickets_status_check` — CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))

**Indexes**

- `idx_support_tickets_business` (btree)
  `CREATE INDEX idx_support_tickets_business ON public.support_tickets USING btree (business_id)`
- `idx_support_tickets_status` (btree)
  `CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status)`
- `support_tickets_pkey` (btree)
  `CREATE UNIQUE INDEX support_tickets_pkey ON public.support_tickets USING btree (id)`

### `test_drives`

- Rough row count (n_live_tup): **8**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | uuid | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `vehicle_inventory_id` | uuid | YES |  |  |
| 7 | `vehicle_inventory_supabase_id` | uuid | YES |  |  |
| 8 | `staff_id` | uuid | YES |  |  |
| 9 | `staff_supabase_id` | uuid | YES |  |  |
| 10 | `scheduled_at` | timestamp with time zone | YES | now() |  |
| 11 | `completed_at` | timestamp with time zone | YES |  |  |
| 12 | `signed_waiver_url` | text | YES |  |  |
| 13 | `license_number` | text | YES |  |  |
| 14 | `notes` | text | YES |  |  |
| 15 | `active` | boolean | YES | true |  |
| 16 | `created_at` | timestamp with time zone | YES | now() |  |
| 17 | `updated_at` | timestamp with time zone | YES | now() |  |
| 18 | `outcome` | text | YES |  |  |
| 19 | `outcome_notes` | text | YES |  |  |
| 20 | `deal_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `test_drives_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `test_drives_biz_sid_key` — UNIQUE (business_id, supabase_id)
- `test_drives_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `test_drives_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `test_drives_outcome_check` — CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['pending'::text, 'sold'::text, 'lost'::text, 'follow_up'::text]))))

**Indexes**

- `idx_test_drives_biz` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_test_drives_biz ON public.test_drives USING btree (business_id, scheduled_at DESC) WHERE (active = true)`
- `test_drives_biz_sid_key` (btree)
  `CREATE UNIQUE INDEX test_drives_biz_sid_key ON public.test_drives USING btree (business_id, supabase_id)`
- `test_drives_pkey` (btree)
  `CREATE UNIQUE INDEX test_drives_pkey ON public.test_drives USING btree (id)`
- `test_drives_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX test_drives_supabase_id_key ON public.test_drives USING btree (supabase_id)`

### `ticket_item_modificadores`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `ticket_item_supabase_id` | uuid | NO |  |  |
| 5 | `modificador_supabase_id` | uuid | YES |  |  |
| 6 | `name_snapshot` | text | NO |  |  |
| 7 | `price_delta_snapshot` | numeric | NO | 0 |  |
| 8 | `created_at` | timestamp with time zone | NO | now() |  |
| 9 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `ticket_item_modificadores_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ticket_item_modificadores_supabase_id_key` — UNIQUE (supabase_id)
- `uq_ticket_item_modificadores_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_ticket_item_modificadores_biz_ti_mod` — UNIQUE (business_id, ticket_item_supabase_id, modificador_supabase_id)

**Foreign Keys**

- `ticket_item_modificadores_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_tim_ticket_item` (btree)
  `CREATE INDEX idx_tim_ticket_item ON public.ticket_item_modificadores USING btree (ticket_item_supabase_id)`
- `ticket_item_modificadores_pkey` (btree)
  `CREATE UNIQUE INDEX ticket_item_modificadores_pkey ON public.ticket_item_modificadores USING btree (id)`
- `ticket_item_modificadores_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX ticket_item_modificadores_supabase_id_key ON public.ticket_item_modificadores USING btree (supabase_id)`
- `uq_ticket_item_modificadores_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_ticket_item_modificadores_biz_sid ON public.ticket_item_modificadores USING btree (business_id, supabase_id)`
- `uq_ticket_item_modificadores_biz_ti_mod` (btree)
  `CREATE UNIQUE INDEX uq_ticket_item_modificadores_biz_ti_mod ON public.ticket_item_modificadores USING btree (business_id, ticket_item_supabase_id, modificador_supabase_id)`

### `ticket_items`

- Rough row count (n_live_tup): **1057**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `ticket_id` | uuid | YES |  |  |
| 4 | `service_id` | uuid | YES |  |  |
| 5 | `name` | text | NO |  |  |
| 6 | `price` | numeric | NO |  |  |
| 7 | `itbis` | numeric | NO | 0 |  |
| 8 | `is_wash` | boolean | NO | true |  |
| 9 | `created_at` | timestamp with time zone | NO | now() |  |
| 10 | `local_id` | integer | YES |  |  |
| 11 | `quantity` | integer | YES | 1 |  |
| 12 | `sku` | text | YES |  |  |
| 13 | `inventory_item_id` | uuid | YES |  |  |
| 14 | `cost` | numeric | NO | 0 |  |
| 15 | `local_ticket_id` | integer | YES |  |  |
| 16 | `local_service_id` | integer | YES |  |  |
| 17 | `local_inventory_item_id` | integer | YES |  |  |
| 18 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 19 | `ticket_supabase_id` | uuid | YES |  |  |
| 20 | `service_supabase_id` | uuid | YES |  |  |
| 21 | `inventory_item_supabase_id` | uuid | YES |  |  |
| 22 | `updated_at` | timestamp with time zone | NO | now() |  |
| 23 | `weight` | numeric | YES |  |  |
| 24 | `unit` | text | YES |  |  |
| 25 | `price_per_unit` | numeric | YES |  |  |
| 26 | `course` | text | YES |  |  |
| 27 | `kds_fired_at` | text | YES |  |  |
| 28 | `guest_number` | integer | YES |  |  |
| 29 | `duration_minutes` | integer | YES |  |  |
| 30 | `hourly_rate` | numeric | YES |  |  |
| 31 | `legacy_code` | text | YES |  |  |
| 32 | `is_deposit` | boolean | YES | false |  |
| 33 | `preparation_notes` | text | YES |  |  |
| 34 | `empleado_supabase_id` | uuid | YES |  |  |
| 35 | `oferta_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `ticket_items_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ticket_items_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_ticket_items_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `fk_ticket_items_inventory_item_sid` — FOREIGN KEY (inventory_item_supabase_id) REFERENCES inventory_items(supabase_id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_
- `fk_ticket_items_service_sid` — FOREIGN KEY (service_supabase_id) REFERENCES services(supabase_id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_
- `ticket_items_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `ticket_items_ticket_id_fkey` — FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `ticket_items_ticket_supabase_id_fkey` — FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_ticket_items_biz_ticket_sid` (btree)
  `CREATE INDEX idx_ticket_items_biz_ticket_sid ON public.ticket_items USING btree (business_id, ticket_supabase_id)`
- `idx_ticket_items_oferta_supabase_id` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_ticket_items_oferta_supabase_id ON public.ticket_items USING btree (oferta_supabase_id) WHERE (oferta_supabase_id IS NOT NULL)`
- `idx_ticket_items_ticket` (btree)
  `CREATE INDEX idx_ticket_items_ticket ON public.ticket_items USING btree (ticket_id)`
- `ticket_items_empleado_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX ticket_items_empleado_idx ON public.ticket_items USING btree (empleado_supabase_id) WHERE (empleado_supabase_id IS NOT NULL)`
- `ticket_items_pkey` (btree)
  `CREATE UNIQUE INDEX ticket_items_pkey ON public.ticket_items USING btree (id)`
- `ticket_items_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX ticket_items_supabase_id_uniq ON public.ticket_items USING btree (supabase_id)`
- `uq_ticket_items_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_ticket_items_biz_sid ON public.ticket_items USING btree (business_id, supabase_id)`
- `uq_ticket_items_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_ticket_items_local ON public.ticket_items USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`

### `ticket_locks`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `inventory_item_supabase_id` | uuid | NO |  |  |
| 4 | `device_id` | text | NO |  |  |
| 5 | `qty` | numeric | NO | 1 |  |
| 6 | `locked_at` | timestamp with time zone | NO | now() |  |
| 7 | `expires_at` | timestamp with time zone | NO | (now() + '00:01:30'::interval) |  |

**Primary Key**

- `ticket_locks_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `ticket_locks_business_item_device_uniq` — UNIQUE (business_id, inventory_item_supabase_id, device_id)

**Foreign Keys**

- `ticket_locks_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_tl_biz_item` (btree)
  `CREATE INDEX idx_tl_biz_item ON public.ticket_locks USING btree (business_id, inventory_item_supabase_id, expires_at DESC)`
- `ticket_locks_business_item_device_uniq` (btree)
  `CREATE UNIQUE INDEX ticket_locks_business_item_device_uniq ON public.ticket_locks USING btree (business_id, inventory_item_supabase_id, device_id)`
- `ticket_locks_pkey` (btree)
  `CREATE UNIQUE INDEX ticket_locks_pkey ON public.ticket_locks USING btree (id)`

### `tickets`

- Rough row count (n_live_tup): **415**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 3 | `doc_number` | text | YES |  |  |
| 4 | `client_name` | text | YES |  |  |
| 5 | `services_json` | jsonb | YES |  |  |
| 6 | `subtotal` | numeric | YES |  |  |
| 7 | `itbis` | numeric | YES |  |  |
| 8 | `ley` | numeric | YES |  |  |
| 9 | `total` | numeric | YES |  |  |
| 10 | `ncf` | text | YES |  |  |
| 11 | `ncf_type` | text | YES |  |  |
| 12 | `payment_method` | text | YES |  |  |
| 13 | `tipo_venta` | text | YES |  |  |
| 14 | `cajero` | text | YES |  |  |
| 15 | `status` | text | YES | 'cobrado'::text |  |
| 16 | `paid_at` | timestamp with time zone | YES | now() |  |
| 17 | `created_at` | timestamp with time zone | YES | now() |  |
| 20 | `cajero_name` | text | YES |  |  |
| 21 | `comprobante_type` | text | YES |  |  |
| 22 | `descuento` | numeric | YES |  |  |
| 23 | `washer_ids` | jsonb | YES | '[]'::jsonb |  |
| 24 | `seller_id` | uuid | YES |  |  |
| 25 | `ecf_result` | jsonb | YES | '{}'::jsonb |  |
| 26 | `void_reason` | text | YES |  |  |
| 27 | `void_by` | uuid | YES |  |  |
| 28 | `void_at` | timestamp with time zone | YES |  |  |
| 29 | `vehicle_plate` | text | YES |  |  |
| 30 | `vehicle_color` | text | YES |  |  |
| 31 | `vehicle_make` | text | YES |  |  |
| 32 | `notes` | text | YES |  |  |
| 33 | `local_id` | integer | YES |  |  |
| 34 | `beverage_subtotal` | real | NO | 0 |  |
| 35 | `local_client_id` | integer | YES |  |  |
| 36 | `local_seller_id` | integer | YES |  |  |
| 37 | `local_cajero_id` | integer | YES |  |  |
| 38 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 39 | `client_supabase_id` | uuid | YES |  |  |
| 40 | `seller_supabase_id` | uuid | YES |  |  |
| 41 | `cajero_supabase_id` | uuid | YES |  |  |
| 42 | `updated_at` | timestamp with time zone | NO | now() |  |
| 43 | `tip_amount` | numeric | YES | 0 |  |
| 44 | `fulfillment_type` | text | YES |  |  |
| 45 | `mesa_supabase_id` | uuid | YES |  |  |
| 46 | `washer_empleado_supabase_ids` | jsonb | YES | '[]'::jsonb |  |
| 47 | `seller_empleado_supabase_id` | uuid | YES |  |  |
| 48 | `payment_parts` | jsonb | YES |  |  |
| 49 | `split_bill` | boolean | YES | false |  |
| 50 | `project_id` | bigint | YES |  |  |
| 51 | `project_supabase_id` | uuid | YES |  |  |
| 52 | `mode` | text | YES |  |  |
| 53 | `converted_from_mesa_id` | bigint | YES |  |  |
| 54 | `converted_from_mesa_supabase_id` | uuid | YES |  |  |
| 55 | `converted_from_ticket_id` | bigint | YES |  |  |
| 56 | `converted_from_ticket_supabase_id` | uuid | YES |  |  |
| 57 | `origin_hwid` | text | YES |  |  |
| 58 | `origin_device_label` | text | YES |  |  |
| 59 | `legacy_source` | text | YES |  |  |
| 60 | `legacy_code` | text | YES |  |  |
| 61 | `commission_exclude` | integer | YES | 0 |  |
| 62 | `order_source` | text | YES | 'pos'::text |  |
| 63 | `rev` | integer | NO | 0 |  |
| 64 | `currency` | text | YES | 'DOP'::text |  |
| 65 | `fx_rate` | numeric | YES | 1 |  |
| 66 | `is_test` | boolean | NO | false |  |
| 67 | `servicio_pct` | numeric | YES |  |  |
| 68 | `servicio_amount` | numeric | YES |  |  |
| 69 | `appointment_supabase_id` | uuid | YES |  |  |
| 70 | `descuento_reason` | text | YES |  |  |
| 71 | `mac_jti` | text | YES |  |  |
| 72 | `open_status` | text | YES | 'closed'::text |  |
| 73 | `food_truck_location_supabase_id` | uuid | YES |  |  |
| 74 | `client_rnc` | text | YES |  |  |
| 75 | `cuadre_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `tickets_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `tickets_supabase_id_uniq` — UNIQUE (supabase_id)
- `uq_tickets_biz_sid` — UNIQUE (business_id, supabase_id)

**Foreign Keys**

- `fk_tickets_cuadre_supabase_id` — FOREIGN KEY (cuadre_supabase_id) REFERENCES cuadre_caja(supabase_id) ON DELETE SET NULL  _(ON DELETE SET NULL, ON UPDATE NO ACTION)_
- `tickets_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `chk_e31_requires_rnc` — CHECK ((NOT (((ncf_type = 'E31'::text) OR ((ncf IS NOT NULL) AND (ncf ~~ 'E31%'::text))) AND ((client_rnc IS NULL) OR (client_rnc !~ '\S'::text)))))
- `tickets_currency_chk` — CHECK (((currency IS NULL) OR (currency = ANY (ARRAY['DOP'::text, 'USD'::text]))))

**Indexes**

- `idx_tickets_active_paid_created` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_active_paid_created ON public.tickets USING btree (business_id, paid_at DESC NULLS LAST, created_at DESC) WHERE (status <> 'nula'::text)`
- `idx_tickets_appointment_sid` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_appointment_sid ON public.tickets USING btree (appointment_supabase_id) WHERE (appointment_supabase_id IS NOT NULL)`
- `idx_tickets_business` (btree)
  `CREATE INDEX idx_tickets_business ON public.tickets USING btree (business_id)`
- `idx_tickets_client_rnc` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_client_rnc ON public.tickets USING btree (client_rnc) WHERE (client_rnc IS NOT NULL)`
- `idx_tickets_created` (btree)
  `CREATE INDEX idx_tickets_created ON public.tickets USING btree (business_id, created_at DESC)`
- `idx_tickets_cuadre_supabase_id` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_cuadre_supabase_id ON public.tickets USING btree (cuadre_supabase_id) WHERE (cuadre_supabase_id IS NOT NULL)`
- `idx_tickets_ecf_result_gin` (gin)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_ecf_result_gin ON public.tickets USING gin (ecf_result jsonb_path_ops) WHERE (ecf_result IS NOT NULL)`
- `idx_tickets_food_truck_location` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_food_truck_location ON public.tickets USING btree (business_id, food_truck_location_supabase_id) WHERE (food_truck_location_supabase_id IS NOT NULL)`
- `idx_tickets_is_test_per_biz` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_is_test_per_biz ON public.tickets USING btree (business_id) WHERE (is_test = true)`
- `idx_tickets_legacy_code` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_legacy_code ON public.tickets USING btree (legacy_code) WHERE (legacy_code IS NOT NULL)`
- `idx_tickets_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_local ON public.tickets USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `idx_tickets_mesa_supabase_id` (btree)
  `CREATE INDEX idx_tickets_mesa_supabase_id ON public.tickets USING btree (mesa_supabase_id)`
- `idx_tickets_mode` (btree)
  `CREATE INDEX idx_tickets_mode ON public.tickets USING btree (mode)`
- `idx_tickets_ncf` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_tickets_ncf ON public.tickets USING btree (business_id, ncf) WHERE (ncf IS NOT NULL)`
- `idx_tickets_origin_hwid` (btree)
  `CREATE INDEX idx_tickets_origin_hwid ON public.tickets USING btree (business_id, origin_hwid)`
- `idx_tickets_payment_parts_gin` (gin)
  `CREATE INDEX idx_tickets_payment_parts_gin ON public.tickets USING gin (payment_parts jsonb_path_ops)`
- `idx_tickets_project` (btree)
  `CREATE INDEX idx_tickets_project ON public.tickets USING btree (business_id, project_supabase_id)`
- `tickets_pkey` (btree)
  `CREATE UNIQUE INDEX tickets_pkey ON public.tickets USING btree (id)`
- `tickets_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX tickets_supabase_id_uniq ON public.tickets USING btree (supabase_id)`
- `uq_tickets_biz_ncf` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_tickets_biz_ncf ON public.tickets USING btree (business_id, ncf) WHERE (ncf IS NOT NULL)`
- `uq_tickets_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_tickets_biz_sid ON public.tickets USING btree (business_id, supabase_id)`
- `uq_tickets_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_tickets_local ON public.tickets USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`

### `vehicle_documents`

- Rough row count (n_live_tup): **1**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('vehicle_documents_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `vehicle_inventory_supabase_id` | uuid | NO |  |  |
| 5 | `doc_type` | text | NO |  |  |
| 6 | `file_url` | text | NO |  |  |
| 7 | `file_name` | text | YES |  |  |
| 8 | `expires_at` | timestamp with time zone | YES |  |  |
| 9 | `notes` | text | YES |  |  |
| 10 | `active` | boolean | YES | true |  |
| 11 | `uploaded_at` | timestamp with time zone | YES | now() |  |
| 12 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `vehicle_documents_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `vehicle_documents_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `vehicle_documents_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `vehicle_documents_doc_type_check` — CHECK ((doc_type = ANY (ARRAY['title'::text, 'registration'::text, 'insurance'::text, 'inspection'::text, 'other'::text])))

**Indexes**

- `vehicle_documents_biz_vehicle_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX vehicle_documents_biz_vehicle_idx ON public.vehicle_documents USING btree (business_id, vehicle_inventory_supabase_id) WHERE (active = true)`
- `vehicle_documents_expiry_idx` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX vehicle_documents_expiry_idx ON public.vehicle_documents USING btree (business_id, expires_at) WHERE ((active = true) AND (expires_at IS NOT NULL))`
- `vehicle_documents_pkey` (btree)
  `CREATE UNIQUE INDEX vehicle_documents_pkey ON public.vehicle_documents USING btree (id)`
- `vehicle_documents_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX vehicle_documents_supabase_id_key ON public.vehicle_documents USING btree (supabase_id)`

### `vehicle_inventory`

- Rough row count (n_live_tup): **12**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `stock_number` | text | YES |  |  |
| 5 | `vin` | text | YES |  |  |
| 6 | `make` | text | YES |  |  |
| 7 | `model` | text | YES |  |  |
| 8 | `year` | integer | YES |  |  |
| 9 | `color` | text | YES |  |  |
| 10 | `mileage` | integer | YES | 0 |  |
| 11 | `condition` | text | YES | 'used'::text |  |
| 12 | `acquisition_cost` | numeric | YES | 0 |  |
| 13 | `listing_price` | numeric | YES | 0 |  |
| 14 | `status` | text | YES | 'available'::text |  |
| 15 | `listing_date` | timestamp with time zone | YES | now() |  |
| 16 | `sold_date` | timestamp with time zone | YES |  |  |
| 17 | `photos_json` | jsonb | YES | '[]'::jsonb |  |
| 18 | `title_status` | text | YES | 'clean'::text |  |
| 19 | `notes` | text | YES |  |  |
| 20 | `active` | boolean | YES | true |  |
| 21 | `created_at` | timestamp with time zone | YES | now() |  |
| 22 | `updated_at` | timestamp with time zone | YES | now() |  |
| 23 | `photo_urls` | ARRAY | YES | '{}'::text[] |  |
| 24 | `featured` | boolean | YES | false |  |

**Primary Key**

- `vehicle_inventory_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `uq_vehicle_inventory_biz_vin` — UNIQUE (business_id, vin)
- `vehicle_inventory_biz_sid_key` — UNIQUE (business_id, supabase_id)
- `vehicle_inventory_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `vehicle_inventory_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_vehinv_biz_status` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_vehinv_biz_status ON public.vehicle_inventory USING btree (business_id, status) WHERE (active = true)`
- `idx_vehinv_stock` (btree)
  `CREATE INDEX idx_vehinv_stock ON public.vehicle_inventory USING btree (business_id, stock_number)`
- `idx_vehinv_vin` (btree)
  `CREATE INDEX idx_vehinv_vin ON public.vehicle_inventory USING btree (business_id, vin)`
- `uq_vehicle_inventory_biz_vin` (btree)
  `CREATE UNIQUE INDEX uq_vehicle_inventory_biz_vin ON public.vehicle_inventory USING btree (business_id, vin)`
- `uq_vehicle_inventory_vin` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_vehicle_inventory_vin ON public.vehicle_inventory USING btree (business_id, vin) WHERE ((vin IS NOT NULL) AND (vin <> ''::text))`
- `vehicle_inventory_biz_sid_key` (btree)
  `CREATE UNIQUE INDEX vehicle_inventory_biz_sid_key ON public.vehicle_inventory USING btree (business_id, supabase_id)`
- `vehicle_inventory_pkey` (btree)
  `CREATE UNIQUE INDEX vehicle_inventory_pkey ON public.vehicle_inventory USING btree (id)`
- `vehicle_inventory_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX vehicle_inventory_supabase_id_key ON public.vehicle_inventory USING btree (supabase_id)`

### `vehicle_reservations`

- Rough row count (n_live_tup): **4**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('vehicle_reservations_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `vehicle_inventory_supabase_id` | uuid | YES |  |  |
| 5 | `client_id` | bigint | YES |  |  |
| 6 | `client_supabase_id` | uuid | YES |  |  |
| 7 | `salesperson_id` | bigint | YES |  |  |
| 8 | `salesperson_supabase_id` | uuid | YES |  |  |
| 9 | `deposit_amount` | numeric | YES | 0 |  |
| 10 | `deposit_method` | text | YES |  |  |
| 11 | `expires_at` | timestamp with time zone | NO |  |  |
| 12 | `released_at` | timestamp with time zone | YES |  |  |
| 13 | `released_reason` | text | YES |  |  |
| 14 | `converted_deal_supabase_id` | uuid | YES |  |  |
| 15 | `status` | text | YES | 'active'::text |  |
| 16 | `notes` | text | YES |  |  |
| 17 | `active` | boolean | NO | true |  |
| 18 | `created_at` | timestamp with time zone | YES | now() |  |
| 19 | `updated_at` | timestamp with time zone | YES | now() |  |
| 20 | `deposit_ticket_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `vehicle_reservations_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `vehicle_reservations_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `vehicle_reservations_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'converted'::text, 'released'::text, 'expired'::text])))

**Indexes**

- `idx_vehicle_reservations_business` (btree)
  `CREATE INDEX idx_vehicle_reservations_business ON public.vehicle_reservations USING btree (business_id)`
- `idx_vehicle_reservations_expires` (btree)
  `CREATE INDEX idx_vehicle_reservations_expires ON public.vehicle_reservations USING btree (expires_at)`
- `idx_vehicle_reservations_status` (btree)
  `CREATE INDEX idx_vehicle_reservations_status ON public.vehicle_reservations USING btree (status)`
- `idx_vehicle_reservations_vehicle` (btree)
  `CREATE INDEX idx_vehicle_reservations_vehicle ON public.vehicle_reservations USING btree (vehicle_inventory_supabase_id)`
- `vehicle_reservations_pkey` (btree)
  `CREATE UNIQUE INDEX vehicle_reservations_pkey ON public.vehicle_reservations USING btree (id)`
- `vehicle_reservations_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX vehicle_reservations_supabase_id_key ON public.vehicle_reservations USING btree (supabase_id)`

### `vehicle_titulo`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('vehicle_titulo_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `sales_deal_supabase_id` | uuid | NO |  |  |
| 5 | `vehicle_inventory_supabase_id` | uuid | YES |  |  |
| 6 | `intrant_status` | text | YES | 'pendiente'::text |  |
| 7 | `placa` | text | YES |  |  |
| 8 | `matricula_url` | text | YES |  |  |
| 9 | `traspaso_initiated_at` | timestamp with time zone | YES |  |  |
| 10 | `traspaso_completed_at` | timestamp with time zone | YES |  |  |
| 11 | `notes` | text | YES |  |  |
| 12 | `active` | boolean | NO | true |  |
| 13 | `created_at` | timestamp with time zone | YES | now() |  |
| 14 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `vehicle_titulo_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `vehicle_titulo_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `vehicle_titulo_intrant_status_check` — CHECK ((intrant_status = ANY (ARRAY['pendiente'::text, 'en_tramite'::text, 'entregada'::text, 'rechazada'::text])))

**Indexes**

- `idx_vehicle_titulo_business` (btree)
  `CREATE INDEX idx_vehicle_titulo_business ON public.vehicle_titulo USING btree (business_id)`
- `idx_vehicle_titulo_deal` (btree)
  `CREATE INDEX idx_vehicle_titulo_deal ON public.vehicle_titulo USING btree (sales_deal_supabase_id)`
- `idx_vehicle_titulo_status` (btree)
  `CREATE INDEX idx_vehicle_titulo_status ON public.vehicle_titulo USING btree (intrant_status)`
- `vehicle_titulo_pkey` (btree)
  `CREATE UNIQUE INDEX vehicle_titulo_pkey ON public.vehicle_titulo USING btree (id)`
- `vehicle_titulo_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX vehicle_titulo_supabase_id_key ON public.vehicle_titulo USING btree (supabase_id)`

### `vehicle_warranties`

- Rough row count (n_live_tup): **3**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('vehicle_warranties_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `sales_deal_supabase_id` | uuid | NO |  |  |
| 5 | `vehicle_inventory_supabase_id` | uuid | YES |  |  |
| 6 | `client_id` | bigint | YES |  |  |
| 7 | `client_supabase_id` | uuid | YES |  |  |
| 8 | `kind` | text | YES | 'general'::text |  |
| 9 | `starts_at` | timestamp with time zone | NO | now() |  |
| 10 | `expires_at` | timestamp with time zone | NO |  |  |
| 11 | `terms` | text | YES |  |  |
| 12 | `claims` | jsonb | YES | '[]'::jsonb |  |
| 13 | `status` | text | YES | 'active'::text |  |
| 14 | `notes` | text | YES |  |  |
| 15 | `active` | boolean | NO | true |  |
| 16 | `created_at` | timestamp with time zone | YES | now() |  |
| 17 | `updated_at` | timestamp with time zone | YES | now() |  |
| 18 | `claim_ticket_supabase_id` | uuid | YES |  |  |

**Primary Key**

- `vehicle_warranties_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `vehicle_warranties_supabase_id_key` — UNIQUE (supabase_id)

**Check Constraints**

- `vehicle_warranties_kind_check` — CHECK ((kind = ANY (ARRAY['motor'::text, 'transmision'::text, 'electrico'::text, 'general'::text, 'extendida'::text])))
- `vehicle_warranties_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'voided'::text, 'claimed'::text])))

**Indexes**

- `idx_vehicle_warranties_business` (btree)
  `CREATE INDEX idx_vehicle_warranties_business ON public.vehicle_warranties USING btree (business_id)`
- `idx_vehicle_warranties_deal` (btree)
  `CREATE INDEX idx_vehicle_warranties_deal ON public.vehicle_warranties USING btree (sales_deal_supabase_id)`
- `idx_vehicle_warranties_expires` (btree)
  `CREATE INDEX idx_vehicle_warranties_expires ON public.vehicle_warranties USING btree (expires_at)`
- `idx_vehicle_warranties_status` (btree)
  `CREATE INDEX idx_vehicle_warranties_status ON public.vehicle_warranties USING btree (status)`
- `vehicle_warranties_pkey` (btree)
  `CREATE UNIQUE INDEX vehicle_warranties_pkey ON public.vehicle_warranties USING btree (id)`
- `vehicle_warranties_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX vehicle_warranties_supabase_id_key ON public.vehicle_warranties USING btree (supabase_id)`

### `vehicles`

- Rough row count (n_live_tup): **4**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `vin` | text | YES |  |  |
| 5 | `plate` | text | YES |  |  |
| 6 | `make` | text | YES |  |  |
| 7 | `model` | text | YES |  |  |
| 8 | `year` | integer | YES |  |  |
| 9 | `color` | text | YES |  |  |
| 10 | `mileage` | integer | YES |  |  |
| 11 | `client_id` | uuid | YES |  |  |
| 12 | `client_supabase_id` | uuid | YES |  |  |
| 13 | `notes` | text | YES |  |  |
| 14 | `active` | boolean | YES | true |  |
| 15 | `created_at` | timestamp with time zone | YES | now() |  |
| 16 | `updated_at` | timestamp with time zone | YES | now() |  |
| 17 | `odometer_km` | integer | YES |  |  |
| 18 | `last_service_km` | integer | YES |  |  |
| 19 | `last_service_at` | timestamp with time zone | YES |  |  |
| 20 | `next_service_km` | integer | YES |  |  |
| 21 | `next_service_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `vehicles_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `uq_vehicles_biz_sid` — UNIQUE (business_id, supabase_id)
- `vehicles_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `vehicles_supabase_id_uniq` — UNIQUE (supabase_id)

**Foreign Keys**

- `vehicles_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `uq_vehicles_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_vehicles_biz_sid ON public.vehicles USING btree (business_id, supabase_id)`
- `vehicles_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX vehicles_business_supabase_uk ON public.vehicles USING btree (business_id, supabase_id)`
- `vehicles_pkey` (btree)
  `CREATE UNIQUE INDEX vehicles_pkey ON public.vehicles USING btree (id)`
- `vehicles_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX vehicles_supabase_id_uniq ON public.vehicles USING btree (supabase_id)`

### `wash_combos`

- Rough row count (n_live_tup): **0**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('wash_combos_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `client_id` | bigint | YES |  |  |
| 5 | `client_supabase_id` | uuid | YES |  |  |
| 6 | `vehicle_id` | bigint | YES |  |  |
| 7 | `vehicle_supabase_id` | uuid | YES |  |  |
| 8 | `combo_name` | text | NO |  |  |
| 9 | `total_washes` | integer | NO | 0 |  |
| 10 | `used_washes` | integer | NO | 0 |  |
| 11 | `purchase_price` | numeric | NO | 0 |  |
| 12 | `purchased_at` | timestamp with time zone | NO | now() |  |
| 13 | `expires_at` | timestamp with time zone | YES |  |  |
| 14 | `status` | text | NO | 'active'::text |  |
| 15 | `notes` | text | YES |  |  |
| 16 | `created_at` | timestamp with time zone | NO | now() |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `wash_combos_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `wash_combos_biz_sid_unique` — UNIQUE (business_id, supabase_id)
- `wash_combos_supabase_id_uniq` — UNIQUE (supabase_id)

**Indexes**

- `wash_combos_biz_sid_unique` (btree)
  `CREATE UNIQUE INDEX wash_combos_biz_sid_unique ON public.wash_combos USING btree (business_id, supabase_id)`
- `wash_combos_biz_status_idx` (btree)
  `CREATE INDEX wash_combos_biz_status_idx ON public.wash_combos USING btree (business_id, status)`
- `wash_combos_client_idx` (btree)
  `CREATE INDEX wash_combos_client_idx ON public.wash_combos USING btree (client_supabase_id)`
- `wash_combos_pkey` (btree)
  `CREATE UNIQUE INDEX wash_combos_pkey ON public.wash_combos USING btree (id)`
- `wash_combos_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX wash_combos_supabase_id_uniq ON public.wash_combos USING btree (supabase_id)`

### `washer_commissions`

- Rough row count (n_live_tup): **70**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | uuid_generate_v4() |  |
| 2 | `business_id` | uuid | NO |  |  |
| 4 | `ticket_id` | uuid | YES |  |  |
| 5 | `base_amount` | numeric | NO |  |  |
| 6 | `commission_pct` | numeric | NO |  |  |
| 7 | `commission_amount` | numeric | NO |  |  |
| 8 | `paid` | boolean | NO | false |  |
| 9 | `paid_at` | timestamp with time zone | YES |  |  |
| 10 | `created_at` | timestamp with time zone | NO | now() |  |
| 11 | `local_id` | integer | YES |  |  |
| 12 | `local_washer_id` | integer | YES |  |  |
| 13 | `local_ticket_id` | integer | YES |  |  |
| 14 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 15 | `washer_supabase_id` | uuid | YES |  |  |
| 16 | `ticket_supabase_id` | uuid | YES |  |  |
| 17 | `updated_at` | timestamp with time zone | NO | now() |  |
| 18 | `empleado_supabase_id` | uuid | YES |  |  |
| 19 | `manual_reason` | text | YES |  |  |

**Primary Key**

- `washer_commissions_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `uq_washer_commissions_biz_sid` — UNIQUE (business_id, supabase_id)
- `uq_washer_commissions_sid` — UNIQUE (business_id, supabase_id)
- `washer_commissions_supabase_id_uniq` — UNIQUE (supabase_id)

**Foreign Keys**

- `washer_commissions_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `washer_commissions_ticket_id_fkey` — FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_
- `washer_commissions_ticket_supabase_id_fkey` — FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `idx_commissions_business` (btree)
  `CREATE INDEX idx_commissions_business ON public.washer_commissions USING btree (business_id)`
- `uq_washer_comm_local` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE UNIQUE INDEX uq_washer_comm_local ON public.washer_commissions USING btree (business_id, local_id) WHERE (local_id IS NOT NULL)`
- `uq_washer_commissions_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_washer_commissions_biz_sid ON public.washer_commissions USING btree (business_id, supabase_id)`
- `uq_washer_commissions_sid` (btree)
  `CREATE UNIQUE INDEX uq_washer_commissions_sid ON public.washer_commissions USING btree (business_id, supabase_id)`
- `washer_commissions_pkey` (btree)
  `CREATE UNIQUE INDEX washer_commissions_pkey ON public.washer_commissions USING btree (id)`
- `washer_commissions_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX washer_commissions_supabase_id_uniq ON public.washer_commissions USING btree (supabase_id)`

### `waste_log`

- Rough row count (n_live_tup): **7**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `inventory_item_supabase_id` | uuid | YES |  |  |
| 5 | `qty` | numeric | NO |  |  |
| 6 | `unit` | text | YES |  |  |
| 7 | `reason` | text | NO |  |  |
| 8 | `photo_url` | text | YES |  |  |
| 9 | `occurred_at` | timestamp with time zone | NO | now() |  |
| 10 | `cuadre_supabase_id` | uuid | YES |  |  |
| 11 | `created_by` | text | YES |  |  |
| 12 | `created_at` | timestamp with time zone | NO | now() |  |
| 13 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `waste_log_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `uq_waste_log_biz_sid` — UNIQUE (business_id, supabase_id)
- `waste_log_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `waste_log_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `brin_waste_log_created` (brin)
  `CREATE INDEX brin_waste_log_created ON public.waste_log USING brin (created_at)`
- `idx_waste_log_biz_occurred` (btree)
  `CREATE INDEX idx_waste_log_biz_occurred ON public.waste_log USING btree (business_id, occurred_at DESC)`
- `idx_waste_log_item` (btree)
  `CREATE INDEX idx_waste_log_item ON public.waste_log USING btree (business_id, inventory_item_supabase_id)`
- `uq_waste_log_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_waste_log_biz_sid ON public.waste_log USING btree (business_id, supabase_id)`
- `waste_log_pkey` (btree)
  `CREATE UNIQUE INDEX waste_log_pkey ON public.waste_log USING btree (id)`
- `waste_log_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX waste_log_supabase_id_key ON public.waste_log USING btree (supabase_id)`

### `work_order_items`

- Rough row count (n_live_tup): **43**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `work_order_id` | uuid | YES |  |  |
| 5 | `work_order_supabase_id` | uuid | YES |  |  |
| 6 | `type` | text | YES | 'labor'::text |  |
| 7 | `name` | text | NO |  |  |
| 8 | `description` | text | YES |  |  |
| 9 | `quantity` | numeric | YES | 1 |  |
| 10 | `unit_price` | numeric | YES | 0 |  |
| 11 | `total` | numeric | YES | 0 |  |
| 12 | `warranty_months` | integer | YES | 0 |  |
| 13 | `inventory_item_id` | uuid | YES |  |  |
| 14 | `inventory_item_supabase_id` | uuid | YES |  |  |
| 15 | `created_at` | timestamp with time zone | YES | now() |  |
| 16 | `updated_at` | timestamp with time zone | YES | now() |  |

**Primary Key**

- `work_order_items_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `uq_work_order_items_biz_sid` — UNIQUE (business_id, supabase_id)
- `work_order_items_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `work_order_items_supabase_id_uniq` — UNIQUE (supabase_id)

**Foreign Keys**

- `work_order_items_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Indexes**

- `uq_work_order_items_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_work_order_items_biz_sid ON public.work_order_items USING btree (business_id, supabase_id)`
- `work_order_items_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX work_order_items_business_supabase_uk ON public.work_order_items USING btree (business_id, supabase_id)`
- `work_order_items_pkey` (btree)
  `CREATE UNIQUE INDEX work_order_items_pkey ON public.work_order_items USING btree (id)`
- `work_order_items_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX work_order_items_supabase_id_uniq ON public.work_order_items USING btree (supabase_id)`

### `work_order_photos`

- Rough row count (n_live_tup): **3**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | bigint | NO | nextval('work_order_photos_id_seq'::regclass) |  |
| 2 | `supabase_id` | uuid | NO | gen_random_uuid() |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `work_order_supabase_id` | uuid | YES |  |  |
| 5 | `vehicle_supabase_id` | uuid | YES |  |  |
| 6 | `phase` | text | NO |  |  |
| 7 | `storage_path` | text | NO |  |  |
| 8 | `taken_by_empleado_supabase_id` | uuid | YES |  |  |
| 9 | `caption` | text | YES |  |  |
| 10 | `created_at` | timestamp with time zone | YES | now() |  |
| 11 | `updated_at` | timestamp with time zone | NO | now() |  |

**Primary Key**

- `work_order_photos_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `work_order_photos_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `work_order_photos_supabase_id_key` — UNIQUE (supabase_id)

**Foreign Keys**

- `work_order_photos_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `work_order_photos_phase_check` — CHECK ((phase = ANY (ARRAY['antes'::text, 'despues'::text])))

**Indexes**

- `work_order_photos_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX work_order_photos_business_supabase_uk ON public.work_order_photos USING btree (business_id, supabase_id)`
- `work_order_photos_pkey` (btree)
  `CREATE UNIQUE INDEX work_order_photos_pkey ON public.work_order_photos USING btree (id)`
- `work_order_photos_supabase_id_key` (btree)
  `CREATE UNIQUE INDEX work_order_photos_supabase_id_key ON public.work_order_photos USING btree (supabase_id)`
- `work_order_photos_vehicle_idx` (btree)
  `CREATE INDEX work_order_photos_vehicle_idx ON public.work_order_photos USING btree (vehicle_supabase_id)`
- `work_order_photos_wo_idx` (btree)
  `CREATE INDEX work_order_photos_wo_idx ON public.work_order_photos USING btree (work_order_supabase_id)`

### `work_orders`

- Rough row count (n_live_tup): **10**
- RLS enabled: **YES**

**Columns**

| # | column | type | nullable | default | generated |
|---|--------|------|----------|---------|-----------|
| 1 | `id` | uuid | NO | gen_random_uuid() |  |
| 2 | `supabase_id` | uuid | YES |  |  |
| 3 | `business_id` | uuid | NO |  |  |
| 4 | `vehicle_id` | uuid | YES |  |  |
| 5 | `vehicle_supabase_id` | uuid | YES |  |  |
| 6 | `client_id` | uuid | YES |  |  |
| 7 | `client_supabase_id` | uuid | YES |  |  |
| 8 | `technician_empleado_id` | uuid | YES |  |  |
| 9 | `technician_empleado_supabase_id` | uuid | YES |  |  |
| 10 | `bay_id` | uuid | YES |  |  |
| 11 | `bay_supabase_id` | uuid | YES |  |  |
| 12 | `status` | text | YES | 'estimate'::text |  |
| 13 | `estimated_total` | numeric | YES | 0 |  |
| 14 | `actual_total` | numeric | YES | 0 |  |
| 15 | `promised_date` | date | YES |  |  |
| 16 | `completed_date` | timestamp with time zone | YES |  |  |
| 17 | `notes` | text | YES |  |  |
| 18 | `created_at` | timestamp with time zone | YES | now() |  |
| 19 | `updated_at` | timestamp with time zone | YES | now() |  |
| 20 | `labor_total` | numeric | NO | 0 |  |
| 21 | `parts_total` | numeric | NO | 0 |  |
| 22 | `itbis` | numeric | NO | 0 |  |
| 23 | `total` | numeric | NO | 0 |  |
| 24 | `inspection_json` | jsonb | YES |  |  |
| 25 | `estimate_approved_at` | timestamp with time zone | YES |  |  |
| 26 | `customer_signature_url` | text | YES |  |  |
| 27 | `customer_approval_token` | text | YES |  |  |
| 28 | `expected_parts_arrival` | date | YES |  |  |
| 29 | `odometer_in_km` | integer | YES |  |  |
| 30 | `odometer_out_km` | integer | YES |  |  |
| 31 | `aseguradora_supabase_id` | uuid | YES |  |  |
| 32 | `poliza_no` | text | YES |  |  |
| 33 | `reclamo_no` | text | YES |  |  |
| 34 | `aseguradora_status` | text | YES |  |  |
| 35 | `started_at` | timestamp with time zone | YES |  |  |
| 36 | `finished_at` | timestamp with time zone | YES |  |  |
| 37 | `ready_at` | timestamp with time zone | YES |  |  |
| 38 | `delivery_required` | boolean | YES | false |  |
| 39 | `delivery_fee` | numeric | YES | 0 |  |
| 40 | `validity_until` | date | YES |  |  |
| 42 | `ticket_supabase_id` | uuid | YES |  |  |
| 43 | `facturado_at` | timestamp with time zone | YES |  |  |

**Primary Key**

- `work_orders_pkey` — PRIMARY KEY (id)

**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_

- `uq_work_orders_biz_sid` — UNIQUE (business_id, supabase_id)
- `work_orders_business_supabase_uk` — UNIQUE (business_id, supabase_id)
- `work_orders_supabase_id_uniq` — UNIQUE (supabase_id)

**Foreign Keys**

- `work_orders_business_id_fkey` — FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE  _(ON DELETE CASCADE, ON UPDATE NO ACTION)_

**Check Constraints**

- `work_orders_aseguradora_status_check` — CHECK (((aseguradora_status IS NULL) OR (aseguradora_status = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text]))))

**Indexes**

- `idx_work_orders_approval_token` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_work_orders_approval_token ON public.work_orders USING btree (customer_approval_token) WHERE (customer_approval_token IS NOT NULL)`
- `idx_work_orders_aseguradora` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_work_orders_aseguradora ON public.work_orders USING btree (aseguradora_supabase_id) WHERE (aseguradora_supabase_id IS NOT NULL)`
- `idx_work_orders_ticket_sid` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_work_orders_ticket_sid ON public.work_orders USING btree (ticket_supabase_id) WHERE (ticket_supabase_id IS NOT NULL)`
- `idx_work_orders_validity_until` (btree)  **(PARTIAL — NOT usable as on_conflict target)**
  `CREATE INDEX idx_work_orders_validity_until ON public.work_orders USING btree (validity_until) WHERE (validity_until IS NOT NULL)`
- `uq_work_orders_biz_sid` (btree)
  `CREATE UNIQUE INDEX uq_work_orders_biz_sid ON public.work_orders USING btree (business_id, supabase_id)`
- `work_orders_business_supabase_uk` (btree)
  `CREATE UNIQUE INDEX work_orders_business_supabase_uk ON public.work_orders USING btree (business_id, supabase_id)`
- `work_orders_pkey` (btree)
  `CREATE UNIQUE INDEX work_orders_pkey ON public.work_orders USING btree (id)`
- `work_orders_supabase_id_uniq` (btree)
  `CREATE UNIQUE INDEX work_orders_supabase_id_uniq ON public.work_orders USING btree (supabase_id)`


## §2. RLS Policies

Query:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
         qual AS using_clause, with_check
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, policyname;
```

Total policies: **421**

### Claim-path audit (post-2026-04-29 swap to `app_metadata`)

- Policies referencing `app_metadata`: **265** (CORRECT)
- Policies referencing `user_metadata`: **0** (none — clean)

### `accounting_bank_accounts`

#### `p_acc_ba_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_ba_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_bank_statement_lines`

#### `p_acc_bsl_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_bsl_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_billing_invoices`

#### `p_acc_inv_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_inv_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_billing_plans`

#### `p_acc_bp_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_bp_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_chart_of_accounts`

#### `p_acc_coa_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_coa_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_clients`

#### `p_acc_clients_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_clients_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_coa_auto_post_rules`

#### `p_acc_apr_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_apr_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_comprobantes`

#### `acc_comp_tenant_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `acc_comp_tenant_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `acc_comp_tenant_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `acc_comp_tenant_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

### `accounting_csv_mappings`

#### `p_acc_csv_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_csv_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_documents`

#### `p_acc_docs_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_docs_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_fixed_assets`

#### `p_acc_fa_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_fa_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_foreign_payments`

#### `p_acc_fp_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_fp_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_inbox`

#### `p_acc_inbox_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_inbox_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_journal_entries`

#### `p_acc_je_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_je_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_journal_lines`

#### `p_acc_jl_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_jl_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_obligations_calendar`

#### `p_acc_obl_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_obl_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_payroll_employee_bank`

#### `p_acc_pl_emp_bank_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_pl_emp_bank_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_payroll_lines`

#### `p_acc_pl_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_pl_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_payroll_periods`

#### `p_acc_pp_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_pp_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_retentions_emitidas`

#### `p_acc_re_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_re_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_retentions_recibidas`

#### `p_acc_rr_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_rr_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_tasks`

#### `p_acc_tk_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_tk_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `accounting_tss_filings`

#### `p_acc_tss_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `p_acc_tss_write`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

### `activity_log`

#### `activity_log_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `activity_log_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `activity_log_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `activity_log_legacy_unpartitioned`

#### `activity_log_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `activity_log_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `activity_log_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `activity_log_sel_auth`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `activity_log_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

### `adelantos`

#### `adelantos_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `adelantos_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `admin_users`

#### `admin_users_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(auth_user_id = auth.uid())
```

#### `admin_users_service`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `anecf_queue`

#### `anecf_queue_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `anecf_queue_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `anecf_queue_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `api_rate_limits`

#### `api_rate_limits_service_role_all`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `app_settings`

#### `app_settings_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `app_settings_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `app_settings_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `app_settings_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `appointment_reminders`

#### `appointment_reminders_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `appointment_reminders_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `appointments`

#### `appointments_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `appointments_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `aseguradoras`

#### `aseguradoras_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `aseguradoras_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `aseguradoras_anon_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `aseguradoras_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `aseguradoras_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `bank_preapprovals`

#### `bank_preapprovals_auth_rw`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `bank_preapprovals_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `bank_preapprovals_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `business_type_configs`

#### `btc_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
true
```

### `businesses`

#### `businesses_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
(owner_id = auth.uid())
```

#### `businesses_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(owner_id = auth.uid())
```

#### `businesses_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
(id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `businesses_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
(owner_id = auth.uid())
```

#### `rls_businesses_delete_auth`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(owner_id = auth.uid())
```

### `caja_chica`

#### `caja_chica_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `caja_chica_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `caja_chica_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `caja_chica_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `cajero_commissions`

#### `cajero_comm_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `cajero_commissions_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `cajero_commissions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `cajero_commissions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `carniceria_corte_categories`

#### `business_read_carniceria_corte_categories`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `business_write_carniceria_corte_categories`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `carniceria_corte_categories_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `carniceria_corte_categories_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `carniceria_scales`

#### `business_read_carniceria_scales`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `business_write_carniceria_scales`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `carniceria_scales_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `carniceria_scales_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `categorias_servicio`

#### `categorias_servicio_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `categorias_servicio_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `categorias_servicio_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `categorias_servicio_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `claude_alerts_pending`

#### `service_role_only`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `claude_feature_flags`

#### `service_role_only`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `client_dgii_credentials`

#### `client_dgii_creds_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(firm_business_id IS NOT NULL)
```

#### `client_dgii_creds_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(firm_business_id IS NOT NULL)
```

#### `client_dgii_creds_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(firm_business_id IS NOT NULL)
```

### `client_errors`

#### `client_errors_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: —

**WITH CHECK**

```sql
true
```

### `client_item_prices`

#### `client_item_prices_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `client_item_prices_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `client_item_prices_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `client_memberships`

#### `client_memberships_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `client_memberships_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `client_received_ecfs`

#### `client_received_ecfs_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(firm_business_id IS NOT NULL)
```

#### `client_received_ecfs_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(firm_business_id IS NOT NULL)
```

### `client_service_rates`

#### `client_service_rates_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `client_service_rates_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `clients`

#### `clients_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `clients_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `clients_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `clients_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `p_clients_select_accountant`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
((business_id IS NOT NULL) AND has_accountant_access(business_id))
```

### `collections_attempts`

#### `collections_attempts_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `collections_attempts_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `collections_log`

#### `collections_log_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `collections_log_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `compras_607`

#### `compras_607_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `compras_607_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `compras_607_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `compras_607_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `p_compras_607_select_accountant`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
((business_id IS NOT NULL) AND has_accountant_access(business_id))
```

### `configuracion`

#### `configuracion_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `configuracion_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `configuracion_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `configuracion_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `credit_payments`

#### `credit_payments_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `credit_payments_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `credit_payments_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `credit_payments_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `crm_lead_activity`

#### `crm_lead_activity_no_anon`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
false
```

### `crm_leads`

#### `crm_leads_no_anon`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
false
```

### `cron_health_runs`

#### `service_role_only`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `cuadre_caja`

#### `cuadre_caja_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `cuadre_caja_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `cuadre_caja_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `cuadre_caja_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `demo_sessions`

#### `anon_insert_only`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
((vertical IS NOT NULL) AND (length(vertical) <= 64))
```

### `deploy_smoke_results`

#### `service_role_only`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `dgii_seed_nonces`

#### `dgii_seed_nonces_service_role_all`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `doc_number_blocks`

#### `doc_number_blocks_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `doc_number_blocks_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `doc_number_master`

#### `doc_number_master_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `doc_number_master_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `ecf_cert_commands`

#### `ecf_cert_commands_admin`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

**WITH CHECK**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

### `ecf_cert_documents`

#### `ecf_cert_documents_admin`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

**WITH CHECK**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

### `ecf_cert_history`

#### `ecf_cert_history_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ecf_cert_history_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ecf_cert_history_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `ecf_cert_notes`

#### `ecf_cert_notes_admin`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

**WITH CHECK**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

### `ecf_cert_step_data`

#### `ecf_cert_step_data_admin`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

**WITH CHECK**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

### `ecf_cert_test_results`

#### `ecf_cert_test_results_admin`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

**WITH CHECK**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

### `ecf_certifications`

#### `ecf_certifications_admin`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

**WITH CHECK**

```sql
(EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.auth_user_id = auth.uid())))
```

### `ecf_queue`

#### `ecf_queue_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `ecf_queue_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ecf_queue_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ecf_queue_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `ecf_submissions`

#### `ecf_submissions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ecf_submissions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `empleados`

#### `empleados_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `empleados_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `empleados_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `empleados_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `firm_memberships`

#### `firm_memberships_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(firm_business_id IS NOT NULL)
```

### `flow_drift_runs`

#### `service_role_only`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `food_truck_locations`

#### `food_truck_locations_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `food_truck_locations_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `food_truck_locations_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `insurance_batches`

#### `insurance_batches_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `insurance_batches_anon_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `insurance_batches_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `insurance_batches_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `insurance_batches_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `inventory_count_items`

#### `ici_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `inventory_count_items_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_count_items_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `inventory_counts`

#### `ic_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `inventory_counts_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_counts_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `inventory_discards`

#### `business_read_inventory_discards`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `business_write_inventory_discards`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `inventory_discards_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_discards_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `inventory_freshness_log`

#### `business_read_inventory_freshness_log`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `business_write_inventory_freshness_log`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `inventory_freshness_log_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_freshness_log_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `inventory_items`

#### `inventory_items_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `inventory_items_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_items_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_items_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `p_inventory_items_select_accountant`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
((business_id IS NOT NULL) AND has_accountant_access(business_id))
```

### `inventory_oversells`

#### `inventory_oversells_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_oversells_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `inventory_transactions`

#### `inventory_transactions_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `inventory_transactions_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_transactions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `inventory_transactions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `journal_entries`

#### `je_select_own`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
(business_id = ((((current_setting('request.jwt.claims'::text, true))::jsonb -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

### `kds_events`

#### `kds_events_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `kds_events_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `kds_events_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `leads`

#### `leads_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `leads_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `license_events`

#### `license_events_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(license_id IN ( SELECT licenses.id
   FROM licenses
  WHERE (licenses.business_id IN ( SELECT my_business_ids() AS my_business_ids))))
```

#### `license_events_sel_auth`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(license_id IN ( SELECT licenses.id
   FROM licenses
  WHERE (licenses.business_id IN ( SELECT my_business_ids() AS my_business_ids))))
```

#### `license_events_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(license_id IN ( SELECT licenses.id
   FROM licenses
  WHERE (licenses.business_id IN ( SELECT my_business_ids() AS my_business_ids))))
```

### `license_jwt_audit`

#### `license_jwt_audit_service_all`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `license_rebind_requests`

#### `license_rebind_requests_service_role_all`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `licenses`

#### `licenses_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `licenses_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

### `loan_contracts`

#### `loan_contracts_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `loan_contracts_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `loan_payments`

#### `loan_payments_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `loan_payments_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `loan_renewals`

#### `loan_renewals_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `loan_renewals_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `loan_schedule`

#### `loan_schedule_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `loan_schedule_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `loans`

#### `loans_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `loans_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `loyalty_transactions`

#### `loyalty_transactions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `loyalty_transactions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `lt_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

### `marketing_leads`

#### `anon_insert_only`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
((email IS NOT NULL) AND (length(email) <= 320) AND (source IS NOT NULL) AND (length(source) <= 64))
```

### `mechanic_commissions`

#### `mechanic_commissions_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `mechanic_commissions_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `mechanic_commissions_anon_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `mechanic_commissions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `mechanic_commissions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `mega_smoke_runs`

#### `service_role_only`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {service_role}
- claim path: —

**USING**

```sql
true
```

**WITH CHECK**

```sql
true
```

### `membership_redemptions`

#### `membership_redemptions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `membership_redemptions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `memberships`

#### `memberships_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `memberships_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `memberships_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `mesas`

#### `mesas_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `mesas_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `mesas_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `modificadores`

#### `modificadores_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `modificadores_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `modificadores_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `modifier_groups`

#### `modifier_groups_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `modifier_groups_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `modifier_groups_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `ncf_blocks`

#### `ncf_blocks_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ncf_blocks_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `ncf_sequences`

#### `ncf_sequences_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `ncf_sequences_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `ncf_sequences_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ncf_sequences_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `ncf_sequences_master`

#### `ncf_sequences_master_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ncf_sequences_master_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `notas_credito`

#### `notas_credito_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `notas_credito_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `notas_credito_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `notas_credito_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `oferta_items`

#### `oferta_items_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `oferta_items_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `oferta_items_anon_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `oferta_items_anon_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `oferta_items_auth_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `oferta_items_auth_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `oferta_items_auth_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `oferta_items_auth_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

### `ofertas`

#### `ofertas_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `ofertas_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `ofertas_anon_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `ofertas_anon_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `ofertas_auth_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `ofertas_auth_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `ofertas_auth_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `ofertas_auth_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

### `parts_orders`

#### `parts_orders_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `parts_orders_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `parts_orders_anon_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `parts_orders_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `parts_orders_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `pawn_documents`

#### `pawn_documents_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `pawn_documents_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `pawn_documents_public_foto`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
((doc_type = 'foto'::text) AND (EXISTS ( SELECT 1
   FROM pawn_listings pl
  WHERE ((pl.business_id = pawn_documents.business_id) AND (pl.pawn_supabase_id = pawn_documents.pawn_supabase_id) AND (pl.status = 'published'::text)))))
```

### `pawn_items`

#### `pawn_items_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `pawn_items_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `pawn_items_public_published`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(EXISTS ( SELECT 1
   FROM pawn_listings pl
  WHERE ((pl.business_id = pawn_items.business_id) AND (pl.pawn_supabase_id = pawn_items.supabase_id) AND (pl.status = 'published'::text))))
```

### `pawn_listings`

#### `pawn_listings_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `pawn_listings_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `pawn_listings_public_published`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(status = 'published'::text)
```

### `payroll_runs`

#### `payroll_runs_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `payroll_runs_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `payroll_settings`

#### `payroll_settings_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `payroll_settings_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `plans`

#### `plans_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
true
```

### `projects`

#### `projects_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `projects_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `promotion_items`

#### `business_read_promotion_items`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `business_write_promotion_items`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `promotion_items_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `promotion_items_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `promotions`

#### `business_read_promotions`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `business_write_promotions`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `promotions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `promotions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `queue`

#### `queue_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `queue_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `queue_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `queue_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `queue_deletions`

#### `queue_deletions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `queue_deletions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `recurring_orders`

#### `business_read_recurring_orders`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `business_write_recurring_orders`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {public}
- claim path: app_metadata

**USING**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

**WITH CHECK**

```sql
((business_id IS NOT NULL) AND (business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
```

#### `recurring_orders_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `recurring_orders_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `restaurant_reservations`

#### `restaurant_reservations_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

### `rnc_cache`

#### `rnc_cache_del`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `rnc_cache_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `rnc_cache_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `rnc_cache_sel`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `rnc_cache_upd`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

### `rnc_contribuyentes`

#### `rnc_contribuyentes_read`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: —

**USING**

```sql
true
```

### `salary_changes`

#### `salary_changes_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `salary_changes_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `sales_deals`

#### `sales_deals_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `sales_deals_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `seller_commissions`

#### `seller_comm_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `seller_commissions_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `seller_commissions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `seller_commissions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `service_bays`

#### `service_bays_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `service_bays_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `service_modificadores`

#### `service_modificadores_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `service_modificadores_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `service_modificadores_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `service_packages`

#### `service_packages_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `service_packages_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `service_projects`

#### `service_projects_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `service_projects_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `service_recipe_items`

#### `service_recipe_items_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

### `services`

#### `p_services_select_accountant`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
((business_id IS NOT NULL) AND has_accountant_access(business_id))
```

#### `services_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `services_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `services_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `services_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `staff`

#### `staff_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `staff_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
((business_id IN ( SELECT my_business_ids() AS my_business_ids)) AND (supabase_id IS NOT NULL))
```

#### `staff_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `staff_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `stylist_schedules`

#### `stylist_schedules_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `stylist_schedules_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `subscriptions`

#### `subscriptions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `subscriptions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `suppliers`

#### `suppliers_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `suppliers_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `suppliers_anon_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `suppliers_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `suppliers_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `support_tickets`

#### `support_tickets_sel_auth`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

### `test_drives`

#### `test_drives_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `test_drives_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `ticket_item_modificadores`

#### `ticket_item_modificadores_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ticket_item_modificadores_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

#### `tim_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

### `ticket_items`

#### `p_ticket_items_select_accountant`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
((business_id IS NOT NULL) AND has_accountant_access(business_id))
```

#### `ticket_items_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `ticket_items_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `ticket_items_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `ticket_items_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `ticket_locks`

#### `tl_all`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

### `tickets`

#### `p_tickets_select_accountant`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
((business_id IS NOT NULL) AND has_accountant_access(business_id))
```

#### `tickets_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `tickets_jwt_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: app_metadata

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `tickets_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `tickets_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `vehicle_documents`

#### `vehicle_documents_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `vehicle_documents_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `vehicle_documents_anon_update`

- cmd: **UPDATE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `vehicle_documents_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `vehicle_documents_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `vehicle_inventory`

#### `vehicle_inventory_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `vehicle_inventory_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `vehicle_reservations`

#### `vehicle_reservations_auth_rw`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `vehicle_reservations_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `vehicle_reservations_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `vehicle_titulo`

#### `vehicle_titulo_auth_rw`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `vehicle_titulo_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `vehicle_titulo_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `vehicle_warranties`

#### `vehicle_warranties_auth_rw`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `vehicle_warranties_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `vehicle_warranties_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `vehicles`

#### `vehicles_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `vehicles_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `wash_combos`

#### `wash_combos_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `wash_combos_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `wash_combos_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `washer_commissions`

#### `washer_commissions_ins`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `washer_commissions_ins_auth`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {authenticated}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `washer_commissions_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `washer_commissions_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `waste_log`

#### `waste_log_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {public}
- claim path: —

**WITH CHECK**

```sql
(business_id IN ( SELECT my_business_ids() AS my_business_ids))
```

#### `waste_log_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `waste_log_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `work_order_items`

#### `work_order_items_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `work_order_items_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `work_order_photos`

#### `work_order_photos_anon_delete`

- cmd: **DELETE**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**USING**

```sql
(business_id IS NOT NULL)
```

#### `work_order_photos_anon_insert`

- cmd: **INSERT**
- permissive: PERMISSIVE
- roles: {anon}
- claim path: —

**WITH CHECK**

```sql
(business_id IS NOT NULL)
```

#### `work_order_photos_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `work_order_photos_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```

### `work_orders`

#### `work_orders_jwt_modify`

- cmd: **ALL**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

**WITH CHECK**

```sql
(business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid)
```

#### `work_orders_jwt_select`

- cmd: **SELECT**
- permissive: PERMISSIVE
- roles: {anon,authenticated}
- claim path: app_metadata

**USING**

```sql
((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids)))
```


## §3. Functions / RPCs

Query:

```sql
SELECT n.nspname  AS schema,
         p.proname  AS name,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid)             AS returns,
         CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END AS security,
         l.lanname AS lang,
         p.prosrc   AS body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language  l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
  ORDER BY p.proname;
```

Total functions: **262**

### `_touch_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END
```

### `allocate_doc_number_block(p_business_id uuid, p_hwid text, p_size integer, p_scope text)`

- returns: `json`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  partial   doc_number_blocks%ROWTYPE;
  m         doc_number_master%ROWTYPE;
  new_start BIGINT;
  new_end   BIGINT;
  out_row   doc_number_blocks%ROWTYPE;
BEGIN
  IF p_business_id IS NULL OR p_hwid IS NULL THEN
    RAISE EXCEPTION 'business_id and hwid are required';
  END IF;
  IF p_size < 1 OR p_size > 10000 THEN
    RAISE EXCEPTION 'block size out of range (1..10000)';
  END IF;

  -- Reuse partial
  SELECT * INTO partial
    FROM doc_number_blocks
   WHERE business_id = p_business_id
     AND hwid        = p_hwid
     AND scope       = p_scope
     AND exhausted_at IS NULL
     AND next_available <= range_end
   ORDER BY range_start ASC
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    RETURN row_to_json(partial);
  END IF;

  -- Lock/seed master
  SELECT * INTO m
    FROM doc_number_master
   WHERE business_id = p_business_id AND scope = p_scope
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO doc_number_master(business_id, scope, next_global)
    VALUES (p_business_id, p_scope, 1)
    RETURNING * INTO m;
  END IF;

  new_start := m.next_global;
  new_end   := m.next_global + p_size - 1;

  INSERT INTO doc_number_blocks(business_id, hwid, scope,
                                range_start, range_end, next_available, size)
  VALUES (p_business_id, p_hwid, p_scope,
          new_start, new_end, new_start, (new_end - new_start + 1)::INT)
  RETURNING * INTO out_row;

  UPDATE doc_number_master SET next_global = new_end + 1
   WHERE business_id = p_business_id AND scope = p_scope;

  RETURN row_to_json(out_row);
END
```

### `allocate_ncf_block(p_business_id uuid, p_hwid text, p_ncf_type text, p_size integer)`

- returns: `json`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  partial      ncf_blocks%ROWTYPE;
  m            ncf_sequences_master%ROWTYPE;
  ns           RECORD;
  new_start    BIGINT;
  new_end      BIGINT;
  out_row      ncf_blocks%ROWTYPE;
BEGIN
  IF p_business_id IS NULL OR p_hwid IS NULL OR p_ncf_type IS NULL THEN
    RAISE EXCEPTION 'business_id, hwid and ncf_type are required';
  END IF;
  IF p_size < 1 OR p_size > 10000 THEN
    RAISE EXCEPTION 'block size out of range (1..10000)';
  END IF;

  -- 1) Reuse a partially consumed block already owned by this HWID.
  SELECT * INTO partial
    FROM ncf_blocks
   WHERE business_id = p_business_id
     AND hwid        = p_hwid
     AND ncf_type    = p_ncf_type
     AND exhausted_at IS NULL
     AND next_available <= range_end
   ORDER BY range_start ASC
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    RETURN row_to_json(partial);
  END IF;

  -- 2) Ensure master row exists. If not, bootstrap from legacy ncf_sequences.
  SELECT * INTO m
    FROM ncf_sequences_master
   WHERE business_id = p_business_id AND ncf_type = p_ncf_type
   FOR UPDATE;

  IF NOT FOUND THEN
    SELECT prefix, current_number, limit_number
      INTO ns
      FROM ncf_sequences
     WHERE business_id = p_business_id AND type = p_ncf_type
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no master or legacy sequence for business=% type=%', p_business_id, p_ncf_type;
    END IF;
    INSERT INTO ncf_sequences_master(business_id, ncf_type, prefix, range_start, range_end, next_global)
    VALUES (p_business_id, p_ncf_type, ns.prefix, 1, GREATEST(ns.limit_number, 100000), COALESCE(ns.current_number, 0) + 1)
    RETURNING * INTO m;
  END IF;

  IF m.exhausted OR m.next_global > m.range_end THEN
    UPDATE ncf_sequences_master SET exhausted = true WHERE id = m.id;
    RAISE EXCEPTION 'NCF range exhausted for %', p_ncf_type;
  END IF;

  new_start := m.next_global;
  new_end   := LEAST(m.next_global + p_size - 1, m.range_end);

  INSERT INTO ncf_blocks(business_id, hwid, ncf_type, prefix,
-- … (12 more lines truncated)
```

### `app_settings_bump_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
```

### `atomic_next_ncf(business_uuid uuid, ncf_type text)` **HOT (called from web.js — DO NOT BREAK)**

- returns: `text`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  seq RECORD;
  next_num int;
  pad_width int;
  jwt_business_id uuid;
  caller_role text;
BEGIN
  caller_role := coalesce(auth.role(), '');
  IF caller_role = 'service_role' THEN
    NULL;
  ELSE
    jwt_business_id := ((auth.jwt() -> 'app_metadata') ->> 'business_id')::uuid;
    IF jwt_business_id IS NULL OR jwt_business_id <> business_uuid THEN
      RAISE EXCEPTION 'atomic_next_ncf: caller business_id mismatch (jwt=% arg=%)',
        coalesce(jwt_business_id::text, '<null>'), business_uuid;
    END IF;
  END IF;

  SELECT id, current_number, limit_number, active, enabled
    INTO seq
    FROM public.ncf_sequences
   WHERE business_id = business_uuid
     AND type = ncf_type
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'atomic_next_ncf: no ncf_sequence row for business=% type=% - owner must create one in Sistema -> DGII',
      business_uuid, ncf_type;
  END IF;
  IF NOT seq.active OR NOT seq.enabled THEN
    RAISE EXCEPTION 'atomic_next_ncf: sequence (% %) is not enabled - owner must enable it in Sistema -> DGII',
      business_uuid, ncf_type;
  END IF;

  next_num := seq.current_number + 1;
  IF next_num > seq.limit_number THEN
    RAISE EXCEPTION 'atomic_next_ncf: sequence (% %) exhausted (current=% limit=%) - owner must request a new range from DGII',
      business_uuid, ncf_type, seq.current_number, seq.limit_number;
  END IF;

  UPDATE public.ncf_sequences
     SET current_number = next_num,
         updated_at = now()
   WHERE id = seq.id;

  pad_width := CASE WHEN upper(ncf_type) LIKE 'E%' THEN 10 ELSE 8 END;
  RETURN upper(ncf_type) || lpad(next_num::text, pad_width, '0');
END;
```

### `bump_claude_usage(p_business_id uuid, p_cost_usd numeric)`

- returns: `boolean`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_budget   NUMERIC;
  v_spent    NUMERIC;
  v_reset_at DATE;
BEGIN
  SELECT monthly_budget_usd, spent_this_month_usd, spent_reset_at
    INTO v_budget, v_spent, v_reset_at
  FROM public.claude_feature_flags
  WHERE business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_reset_at < date_trunc('month', now())::date THEN
    v_spent    := 0;
    v_reset_at := date_trunc('month', now())::date;
  END IF;

  IF (v_spent + COALESCE(p_cost_usd, 0)) > v_budget THEN
    RETURN false;
  END IF;

  UPDATE public.claude_feature_flags
     SET spent_this_month_usd = v_spent + COALESCE(p_cost_usd, 0),
         spent_reset_at       = v_reset_at,
         updated_at           = now()
   WHERE business_id = p_business_id;

  RETURN true;
END
```

### `cash_dist(money, money)`

- returns: `money`
- security: **INVOKER**
- language: c

```plpgsql
cash_dist
```

### `check_rate_limit(p_bucket text, p_max_per_min integer)`

- returns: `boolean`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_window  TIMESTAMPTZ := date_trunc('minute', now());
  v_count   INTEGER;
BEGIN
  INSERT INTO public.api_rate_limits (bucket, window_start, count, updated_at)
  VALUES (p_bucket, v_window, 1, now())
  ON CONFLICT (bucket, window_start)
  DO UPDATE SET count = public.api_rate_limits.count + 1,
                updated_at = now()
  RETURNING count INTO v_count;

  RETURN v_count <= p_max_per_min;
END;
```

### `create_loan_with_schedule(p_business_id uuid, p_loan jsonb, p_schedule jsonb)`

- returns: `uuid`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_loan_supabase_id UUID;
  v_jwt_biz          UUID;
  v_row              JSONB;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business_id required';
  END IF;

  -- Re-impose RLS-equivalent isolation on the SECURITY DEFINER path.
  BEGIN
    v_jwt_biz := ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_jwt_biz := NULL;
  END;

  IF v_jwt_biz IS NULL OR v_jwt_biz IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'business_id mismatch with auth context';
  END IF;

  v_loan_supabase_id := (p_loan ->> 'supabase_id')::uuid;
  IF v_loan_supabase_id IS NULL THEN
    RAISE EXCEPTION 'loan.supabase_id required';
  END IF;

  -- Insert the loan row.
  INSERT INTO loans (
    supabase_id, business_id, client_supabase_id, principal, term_months,
    interest_rate, monthly_payment, status, disbursed_at, next_due_date,
    total_paid, total_interest, amortization_method, renewal_count, notes,
    created_at, updated_at
  ) VALUES (
    v_loan_supabase_id, p_business_id,
    NULLIF(p_loan ->> 'client_supabase_id','')::uuid,
    (p_loan ->> 'principal')::numeric,
    (p_loan ->> 'term_months')::int,
    (p_loan ->> 'interest_rate')::numeric,
    COALESCE((p_loan ->> 'monthly_payment')::numeric, 0),
    COALESCE(p_loan ->> 'status', 'active'),
    NULLIF(p_loan ->> 'disbursed_at','')::timestamptz,
    p_loan ->> 'next_due_date',
    COALESCE((p_loan ->> 'total_paid')::numeric, 0),
    COALESCE((p_loan ->> 'total_interest')::numeric, 0),
    COALESCE(p_loan ->> 'amortization_method', 'interest_only'),
    COALESCE((p_loan ->> 'renewal_count')::int, 0),
    p_loan ->> 'notes',
    COALESCE(NULLIF(p_loan ->> 'created_at','')::timestamptz, now()),
    now()
  );

  -- Insert schedule rows (if any).
  IF p_schedule IS NOT NULL AND jsonb_typeof(p_schedule) = 'array'
     AND jsonb_array_length(p_schedule) > 0 THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_schedule)
    LOOP
      INSERT INTO loan_schedule (
        supabase_id, business_id, loan_supabase_id, installment_no,
        due_date, principal_due, interest_due, total_due, paid_amount,
        paid_at, status, created_at, updated_at
-- … (19 more lines truncated)
```

### `create_ticket_validated(p_business_id uuid, p_items jsonb, p_client_id uuid, p_washer_ids jsonb, p_seller_id uuid, p_cajero_id uuid, p_payment_method text, p_comprobante_type text, p_tipo_venta text, p_vehicle_plate text, p_notes text, p_descuento numeric, p_ecf_result jsonb, p_beverage_subtotal numeric)`

- returns: `jsonb`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  item JSONB;
  svc_row RECORD;
  inv_row RECORD;
  validation JSONB;
  v_subtotal NUMERIC := 0;
  v_itbis NUMERIC := 0;
  v_total NUMERIC := 0;
  v_doc_number TEXT;
  v_next_num INT;
  v_last_doc TEXT;
  v_status TEXT;
  v_ticket_id UUID;
  v_ticket RECORD;
  v_aplica_itbis INT;
  v_item_cost NUMERIC;
  v_item_itbis NUMERIC;
  v_comm_base NUMERIC;
  v_bev_base NUMERIC;
  v_washer_id UUID;
  v_washer RECORD;
  v_seller RECORD;
  v_cajero RECORD;
  v_pct NUMERIC;
  v_amt NUMERIC;
BEGIN
  -- ── Step 1: Validate all item prices ──────────────────────────────────────
  validation := validate_ticket_prices(p_business_id, p_items);
  IF NOT (validation->>'valid')::BOOLEAN THEN
    RAISE EXCEPTION 'PRICE_VALIDATION_FAILED: %', validation->>'errors';
  END IF;

  -- ── Step 2: Compute totals from server-side prices ────────────────────────
  -- Use the REAL prices from the database, not the client-submitted ones.
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    DECLARE
      v_real_price NUMERIC;
      v_qty INT := COALESCE((item->>'quantity')::INT, 1);
      v_item_aplica INT := 1;
    BEGIN
      IF (item->>'service_id') IS NOT NULL THEN
        SELECT s.price, COALESCE(s.aplica_itbis, 1) INTO v_real_price, v_item_aplica
          FROM services s WHERE s.id = (item->>'service_id')::UUID AND s.business_id = p_business_id;
      ELSIF (item->>'inventory_item_id') IS NOT NULL THEN
        SELECT i.price, COALESCE(i.aplica_itbis, 1) INTO v_real_price, v_item_aplica
          FROM inventory_items i WHERE i.id = (item->>'inventory_item_id')::UUID AND i.business_id = p_business_id;
      ELSE
        -- Items without service_id or inventory_item_id (custom/manual) — use submitted price
        v_real_price := (item->>'price')::NUMERIC;
      END IF;

      v_subtotal := v_subtotal + (v_real_price * v_qty);
      IF v_item_aplica != 0 THEN
        v_itbis := v_itbis + ROUND(v_real_price * v_qty * 0.18, 2);
      END IF;
    END;
  END LOOP;

-- … (161 more lines truncated)
```

### `crm_leads_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END
```

### `date_dist(date, date)`

- returns: `integer`
- security: **INVOKER**
- language: c

```plpgsql
date_dist
```

### `deduct_inventory_atomic(p_business_id uuid, p_ticket_supabase_id uuid, p_hwid text, p_items json)`

- returns: `json`
- security: **DEFINER**
- language: plpgsql

```plpgsql
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

    -- Skip unknown items entirely (was writing ghost oversells with actual_qty=0).
    SELECT COUNT(*) INTO exists_ct FROM inventory_items
      WHERE business_id = p_business_id AND supabase_id = item_sid;
    IF exists_ct = 0 THEN CONTINUE; END IF;

    -- Guarded deduct (happy path: stock sufficient).
    UPDATE inventory_items
       SET quantity   = quantity - req_qty,
           updated_at = now()
     WHERE business_id = p_business_id
       AND supabase_id = item_sid
       AND quantity   >= req_qty
    RETURNING quantity INTO post_qty;

    IF NOT FOUND THEN
      -- Oversell: clamp at zero so chk_inventory_quantity_nonneg passes,
      -- then record oversell row for audit. Real shortfall = req_qty - pre_qty.
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
-- … (8 more lines truncated)
```

### `ecf_cert_history_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
```

### `ensure_activity_log_partition(month_start date)`

- returns: `void`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  partition_name TEXT;
  range_start    DATE := date_trunc('month', month_start)::date;
  range_end      DATE := (date_trunc('month', month_start) + INTERVAL '1 month')::date;
BEGIN
  partition_name := format('activity_log_p_%s', to_char(range_start, 'YYYYMM'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = partition_name
  ) THEN
    -- Build the child partition. Range bounds are inclusive-exclusive.
    -- Target the partitioned table whether it lives under its build name
    -- (activity_log_p) or post-rename name (activity_log).
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname='activity_log_p' AND c.relkind='p'
    ) THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.activity_log_p
           FOR VALUES FROM (%L) TO (%L)',
        partition_name, range_start, range_end
      );
    ELSE
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.activity_log
           FOR VALUES FROM (%L) TO (%L)',
        partition_name, range_start, range_end
      );
    END IF;

    -- BRIN multiminmax on created_at (PG14+ syntax). Tight pages_per_range
    -- because activity_log rows are small (~300 bytes).
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I
         USING BRIN (created_at timestamptz_minmax_multi_ops)
         WITH (pages_per_range = 16)',
      partition_name || '_brin_created', partition_name
    );

    -- Hot tenant-scoped query path.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id, created_at DESC)',
      partition_name || '_biz_created_idx', partition_name
    );

    -- Event-type lookup parity with legacy idx_activity_log_biz_event.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id, event_type)',
      partition_name || '_biz_event_idx', partition_name
    );

    -- jsonb GIN parity with legacy idx_activity_log_metadata_gin (only when
    -- metadata is non-null, mirrors the original predicate to keep size down).
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I
         USING GIN (metadata jsonb_path_ops)
         WHERE metadata IS NOT NULL',
-- … (5 more lines truncated)
```

### `ensure_activity_log_partitions_horizon(months_back integer, months_ahead integer)`

- returns: `integer`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  m         int;
  m_start   date;
  created   int := 0;
BEGIN
  FOR m IN -months_back..months_ahead LOOP
    m_start := (date_trunc('month', now()) + make_interval(months => m))::date;
    PERFORM public.ensure_activity_log_partition(m_start);
    created := created + 1;
  END LOOP;
  RETURN created;
END
```

### `float4_dist(real, real)`

- returns: `real`
- security: **INVOKER**
- language: c

```plpgsql
float4_dist
```

### `float8_dist(double precision, double precision)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
float8_dist
```

### `gbt_bit_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bit_compress
```

### `gbt_bit_consistent(internal, bit, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bit_consistent
```

### `gbt_bit_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bit_penalty
```

### `gbt_bit_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bit_picksplit
```

### `gbt_bit_same(gbtreekey_var, gbtreekey_var, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bit_same
```

### `gbt_bit_union(internal, internal)`

- returns: `gbtreekey_var`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bit_union
```

### `gbt_bool_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bool_compress
```

### `gbt_bool_consistent(internal, boolean, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bool_consistent
```

### `gbt_bool_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bool_fetch
```

### `gbt_bool_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bool_penalty
```

### `gbt_bool_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bool_picksplit
```

### `gbt_bool_same(gbtreekey2, gbtreekey2, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bool_same
```

### `gbt_bool_union(internal, internal)`

- returns: `gbtreekey2`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bool_union
```

### `gbt_bpchar_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bpchar_compress
```

### `gbt_bpchar_consistent(internal, character, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bpchar_consistent
```

### `gbt_bytea_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bytea_compress
```

### `gbt_bytea_consistent(internal, bytea, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bytea_consistent
```

### `gbt_bytea_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bytea_penalty
```

### `gbt_bytea_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bytea_picksplit
```

### `gbt_bytea_same(gbtreekey_var, gbtreekey_var, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bytea_same
```

### `gbt_bytea_union(internal, internal)`

- returns: `gbtreekey_var`
- security: **INVOKER**
- language: c

```plpgsql
gbt_bytea_union
```

### `gbt_cash_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_cash_compress
```

### `gbt_cash_consistent(internal, money, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_cash_consistent
```

### `gbt_cash_distance(internal, money, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_cash_distance
```

### `gbt_cash_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_cash_fetch
```

### `gbt_cash_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_cash_penalty
```

### `gbt_cash_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_cash_picksplit
```

### `gbt_cash_same(gbtreekey16, gbtreekey16, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_cash_same
```

### `gbt_cash_union(internal, internal)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbt_cash_union
```

### `gbt_date_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_date_compress
```

### `gbt_date_consistent(internal, date, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_date_consistent
```

### `gbt_date_distance(internal, date, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_date_distance
```

### `gbt_date_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_date_fetch
```

### `gbt_date_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_date_penalty
```

### `gbt_date_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_date_picksplit
```

### `gbt_date_same(gbtreekey8, gbtreekey8, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_date_same
```

### `gbt_date_union(internal, internal)`

- returns: `gbtreekey8`
- security: **INVOKER**
- language: c

```plpgsql
gbt_date_union
```

### `gbt_decompress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_decompress
```

### `gbt_enum_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_enum_compress
```

### `gbt_enum_consistent(internal, anyenum, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_enum_consistent
```

### `gbt_enum_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_enum_fetch
```

### `gbt_enum_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_enum_penalty
```

### `gbt_enum_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_enum_picksplit
```

### `gbt_enum_same(gbtreekey8, gbtreekey8, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_enum_same
```

### `gbt_enum_union(internal, internal)`

- returns: `gbtreekey8`
- security: **INVOKER**
- language: c

```plpgsql
gbt_enum_union
```

### `gbt_float4_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float4_compress
```

### `gbt_float4_consistent(internal, real, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float4_consistent
```

### `gbt_float4_distance(internal, real, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float4_distance
```

### `gbt_float4_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float4_fetch
```

### `gbt_float4_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float4_penalty
```

### `gbt_float4_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float4_picksplit
```

### `gbt_float4_same(gbtreekey8, gbtreekey8, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float4_same
```

### `gbt_float4_union(internal, internal)`

- returns: `gbtreekey8`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float4_union
```

### `gbt_float8_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float8_compress
```

### `gbt_float8_consistent(internal, double precision, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float8_consistent
```

### `gbt_float8_distance(internal, double precision, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float8_distance
```

### `gbt_float8_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float8_fetch
```

### `gbt_float8_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float8_penalty
```

### `gbt_float8_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float8_picksplit
```

### `gbt_float8_same(gbtreekey16, gbtreekey16, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float8_same
```

### `gbt_float8_union(internal, internal)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbt_float8_union
```

### `gbt_inet_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_inet_compress
```

### `gbt_inet_consistent(internal, inet, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_inet_consistent
```

### `gbt_inet_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_inet_penalty
```

### `gbt_inet_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_inet_picksplit
```

### `gbt_inet_same(gbtreekey16, gbtreekey16, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_inet_same
```

### `gbt_inet_union(internal, internal)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbt_inet_union
```

### `gbt_int2_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int2_compress
```

### `gbt_int2_consistent(internal, smallint, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int2_consistent
```

### `gbt_int2_distance(internal, smallint, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int2_distance
```

### `gbt_int2_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int2_fetch
```

### `gbt_int2_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int2_penalty
```

### `gbt_int2_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int2_picksplit
```

### `gbt_int2_same(gbtreekey4, gbtreekey4, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int2_same
```

### `gbt_int2_union(internal, internal)`

- returns: `gbtreekey4`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int2_union
```

### `gbt_int4_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int4_compress
```

### `gbt_int4_consistent(internal, integer, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int4_consistent
```

### `gbt_int4_distance(internal, integer, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int4_distance
```

### `gbt_int4_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int4_fetch
```

### `gbt_int4_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int4_penalty
```

### `gbt_int4_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int4_picksplit
```

### `gbt_int4_same(gbtreekey8, gbtreekey8, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int4_same
```

### `gbt_int4_union(internal, internal)`

- returns: `gbtreekey8`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int4_union
```

### `gbt_int8_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int8_compress
```

### `gbt_int8_consistent(internal, bigint, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int8_consistent
```

### `gbt_int8_distance(internal, bigint, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int8_distance
```

### `gbt_int8_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int8_fetch
```

### `gbt_int8_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int8_penalty
```

### `gbt_int8_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int8_picksplit
```

### `gbt_int8_same(gbtreekey16, gbtreekey16, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int8_same
```

### `gbt_int8_union(internal, internal)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbt_int8_union
```

### `gbt_intv_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_compress
```

### `gbt_intv_consistent(internal, interval, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_consistent
```

### `gbt_intv_decompress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_decompress
```

### `gbt_intv_distance(internal, interval, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_distance
```

### `gbt_intv_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_fetch
```

### `gbt_intv_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_penalty
```

### `gbt_intv_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_picksplit
```

### `gbt_intv_same(gbtreekey32, gbtreekey32, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_same
```

### `gbt_intv_union(internal, internal)`

- returns: `gbtreekey32`
- security: **INVOKER**
- language: c

```plpgsql
gbt_intv_union
```

### `gbt_macad8_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad8_compress
```

### `gbt_macad8_consistent(internal, macaddr8, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad8_consistent
```

### `gbt_macad8_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad8_fetch
```

### `gbt_macad8_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad8_penalty
```

### `gbt_macad8_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad8_picksplit
```

### `gbt_macad8_same(gbtreekey16, gbtreekey16, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad8_same
```

### `gbt_macad8_union(internal, internal)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad8_union
```

### `gbt_macad_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad_compress
```

### `gbt_macad_consistent(internal, macaddr, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad_consistent
```

### `gbt_macad_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad_fetch
```

### `gbt_macad_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad_penalty
```

### `gbt_macad_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad_picksplit
```

### `gbt_macad_same(gbtreekey16, gbtreekey16, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad_same
```

### `gbt_macad_union(internal, internal)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbt_macad_union
```

### `gbt_numeric_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_numeric_compress
```

### `gbt_numeric_consistent(internal, numeric, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_numeric_consistent
```

### `gbt_numeric_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_numeric_penalty
```

### `gbt_numeric_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_numeric_picksplit
```

### `gbt_numeric_same(gbtreekey_var, gbtreekey_var, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_numeric_same
```

### `gbt_numeric_union(internal, internal)`

- returns: `gbtreekey_var`
- security: **INVOKER**
- language: c

```plpgsql
gbt_numeric_union
```

### `gbt_oid_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_oid_compress
```

### `gbt_oid_consistent(internal, oid, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_oid_consistent
```

### `gbt_oid_distance(internal, oid, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_oid_distance
```

### `gbt_oid_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_oid_fetch
```

### `gbt_oid_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_oid_penalty
```

### `gbt_oid_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_oid_picksplit
```

### `gbt_oid_same(gbtreekey8, gbtreekey8, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_oid_same
```

### `gbt_oid_union(internal, internal)`

- returns: `gbtreekey8`
- security: **INVOKER**
- language: c

```plpgsql
gbt_oid_union
```

### `gbt_text_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_text_compress
```

### `gbt_text_consistent(internal, text, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_text_consistent
```

### `gbt_text_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_text_penalty
```

### `gbt_text_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_text_picksplit
```

### `gbt_text_same(gbtreekey_var, gbtreekey_var, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_text_same
```

### `gbt_text_union(internal, internal)`

- returns: `gbtreekey_var`
- security: **INVOKER**
- language: c

```plpgsql
gbt_text_union
```

### `gbt_time_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_time_compress
```

### `gbt_time_consistent(internal, time without time zone, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_time_consistent
```

### `gbt_time_distance(internal, time without time zone, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_time_distance
```

### `gbt_time_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_time_fetch
```

### `gbt_time_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_time_penalty
```

### `gbt_time_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_time_picksplit
```

### `gbt_time_same(gbtreekey16, gbtreekey16, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_time_same
```

### `gbt_time_union(internal, internal)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbt_time_union
```

### `gbt_timetz_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_timetz_compress
```

### `gbt_timetz_consistent(internal, time with time zone, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_timetz_consistent
```

### `gbt_ts_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_ts_compress
```

### `gbt_ts_consistent(internal, timestamp without time zone, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_ts_consistent
```

### `gbt_ts_distance(internal, timestamp without time zone, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_ts_distance
```

### `gbt_ts_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_ts_fetch
```

### `gbt_ts_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_ts_penalty
```

### `gbt_ts_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_ts_picksplit
```

### `gbt_ts_same(gbtreekey16, gbtreekey16, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_ts_same
```

### `gbt_ts_union(internal, internal)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbt_ts_union
```

### `gbt_tstz_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_tstz_compress
```

### `gbt_tstz_consistent(internal, timestamp with time zone, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_tstz_consistent
```

### `gbt_tstz_distance(internal, timestamp with time zone, smallint, oid, internal)`

- returns: `double precision`
- security: **INVOKER**
- language: c

```plpgsql
gbt_tstz_distance
```

### `gbt_uuid_compress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_uuid_compress
```

### `gbt_uuid_consistent(internal, uuid, smallint, oid, internal)`

- returns: `boolean`
- security: **INVOKER**
- language: c

```plpgsql
gbt_uuid_consistent
```

### `gbt_uuid_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_uuid_fetch
```

### `gbt_uuid_penalty(internal, internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_uuid_penalty
```

### `gbt_uuid_picksplit(internal, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_uuid_picksplit
```

### `gbt_uuid_same(gbtreekey32, gbtreekey32, internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_uuid_same
```

### `gbt_uuid_union(internal, internal)`

- returns: `gbtreekey32`
- security: **INVOKER**
- language: c

```plpgsql
gbt_uuid_union
```

### `gbt_var_decompress(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_var_decompress
```

### `gbt_var_fetch(internal)`

- returns: `internal`
- security: **INVOKER**
- language: c

```plpgsql
gbt_var_fetch
```

### `gbtreekey16_in(cstring)`

- returns: `gbtreekey16`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_in
```

### `gbtreekey16_out(gbtreekey16)`

- returns: `cstring`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_out
```

### `gbtreekey2_in(cstring)`

- returns: `gbtreekey2`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_in
```

### `gbtreekey2_out(gbtreekey2)`

- returns: `cstring`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_out
```

### `gbtreekey32_in(cstring)`

- returns: `gbtreekey32`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_in
```

### `gbtreekey32_out(gbtreekey32)`

- returns: `cstring`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_out
```

### `gbtreekey4_in(cstring)`

- returns: `gbtreekey4`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_in
```

### `gbtreekey4_out(gbtreekey4)`

- returns: `cstring`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_out
```

### `gbtreekey8_in(cstring)`

- returns: `gbtreekey8`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_in
```

### `gbtreekey8_out(gbtreekey8)`

- returns: `cstring`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_out
```

### `gbtreekey_var_in(cstring)`

- returns: `gbtreekey_var`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_in
```

### `gbtreekey_var_out(gbtreekey_var)`

- returns: `cstring`
- security: **INVOKER**
- language: c

```plpgsql
gbtreekey_out
```

### `guard_commission_employment_window()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_start_date date;
  v_nombre     text;
BEGIN
  IF NEW.empleado_supabase_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.created_at IS NULL THEN RETURN NEW; END IF;

  SELECT start_date, nombre
    INTO v_start_date, v_nombre
    FROM public.empleados
    WHERE supabase_id = NEW.empleado_supabase_id
      AND business_id = NEW.business_id
    LIMIT 1;

  IF v_start_date IS NOT NULL AND (NEW.created_at AT TIME ZONE 'UTC')::date < v_start_date THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'commission row predates empleado.start_date — %s started %s, row created_at=%s. ' ||
        'Likely a backfill import that ignored employment window. ' ||
        'For rehires, update empleados.start_date to the most recent rehire date or split into ' ||
        'multiple empleado rows by employment period.',
        COALESCE(v_nombre, NEW.empleado_supabase_id::text),
        v_start_date,
        NEW.created_at::text
      );
  END IF;

  RETURN NEW;
END
```

### `has_accountant_access(target_business_id uuid)`

- returns: `boolean`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  jwt_biz TEXT;
  result  BOOLEAN := FALSE;
BEGIN
  IF target_business_id IS NULL THEN RETURN FALSE; END IF;
  jwt_biz := COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id', '');
  IF jwt_biz = '' THEN RETURN FALSE; END IF;
  -- Self-access trivially allowed (the regular policy already covers this,
  -- so we short-circuit to keep the OR-chain clean).
  IF jwt_biz = target_business_id::text THEN RETURN TRUE; END IF;
  SELECT TRUE INTO result
    FROM public.accounting_clients ac
    WHERE ac.business_id::text = jwt_biz
      AND ac.shared_business_id = target_business_id
      AND ac.access_granted = TRUE
      AND ac.status = 'active'
    LIMIT 1;
  RETURN COALESCE(result, FALSE);
END;
```

### `int2_dist(smallint, smallint)`

- returns: `smallint`
- security: **INVOKER**
- language: c

```plpgsql
int2_dist
```

### `int4_dist(integer, integer)`

- returns: `integer`
- security: **INVOKER**
- language: c

```plpgsql
int4_dist
```

### `int8_dist(bigint, bigint)`

- returns: `bigint`
- security: **INVOKER**
- language: c

```plpgsql
int8_dist
```

### `interval_dist(interval, interval)`

- returns: `interval`
- security: **INVOKER**
- language: c

```plpgsql
interval_dist
```

### `loyalty_adjust(p_business_id uuid, p_client_supabase_id uuid, p_delta numeric, p_notes text)`

- returns: `numeric`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE public.clients
     SET loyalty_points = GREATEST(0, COALESCE(loyalty_points,0) + p_delta),
         loyalty_tier   = public.loyalty_tier_for(GREATEST(0, COALESCE(loyalty_points,0) + p_delta)),
         updated_at     = NOW()
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id
  RETURNING loyalty_points INTO v_new_balance;

  IF v_new_balance IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.loyalty_transactions (
    supabase_id, business_id, client_supabase_id, ticket_supabase_id,
    event_type, points, balance_after, notes
  ) VALUES (
    gen_random_uuid(), p_business_id, p_client_supabase_id, NULL,
    'adjust', p_delta, v_new_balance, p_notes
  );

  RETURN v_new_balance;
END;
```

### `loyalty_award(p_business_id uuid, p_client_supabase_id uuid, p_ticket_supabase_id uuid, p_points numeric, p_notes text)`

- returns: `numeric`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_new_balance NUMERIC;
  v_client_id   UUID;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RETURN 0; END IF;
  IF p_client_supabase_id IS NULL OR p_business_id IS NULL THEN RETURN 0; END IF;

  -- Bump points + tier in one statement
  UPDATE public.clients
     SET loyalty_points = COALESCE(loyalty_points,0) + p_points,
         loyalty_tier   = public.loyalty_tier_for(COALESCE(loyalty_points,0) + p_points),
         updated_at     = NOW()
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id
  RETURNING loyalty_points, id INTO v_new_balance, v_client_id;

  IF v_new_balance IS NULL THEN RETURN 0; END IF;

  -- Append ledger row (idempotent on (business_id, ticket_supabase_id, event_type))
  INSERT INTO public.loyalty_transactions (
    supabase_id, business_id, client_supabase_id, ticket_supabase_id,
    event_type, points, balance_after, notes
  ) VALUES (
    gen_random_uuid(), p_business_id, p_client_supabase_id, p_ticket_supabase_id,
    'earn', p_points, v_new_balance, p_notes
  )
  ON CONFLICT DO NOTHING;

  RETURN v_new_balance;
END;
```

### `loyalty_redeem(p_business_id uuid, p_client_supabase_id uuid, p_ticket_supabase_id uuid, p_points numeric, p_notes text)`

- returns: `numeric`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_current     NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RETURN -1; END IF;
  IF p_client_supabase_id IS NULL OR p_business_id IS NULL THEN RETURN -1; END IF;

  SELECT COALESCE(loyalty_points,0) INTO v_current
    FROM public.clients
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id
   FOR UPDATE;

  IF v_current IS NULL OR v_current < p_points THEN RETURN -1; END IF;

  v_new_balance := v_current - p_points;

  UPDATE public.clients
     SET loyalty_points = v_new_balance,
         loyalty_tier   = public.loyalty_tier_for(v_new_balance),
         updated_at     = NOW()
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id;

  INSERT INTO public.loyalty_transactions (
    supabase_id, business_id, client_supabase_id, ticket_supabase_id,
    event_type, points, balance_after, notes
  ) VALUES (
    gen_random_uuid(), p_business_id, p_client_supabase_id, p_ticket_supabase_id,
    'redeem', -p_points, v_new_balance, p_notes
  );

  RETURN v_new_balance;
END;
```

### `loyalty_tier_for(points numeric)`

- returns: `text`
- security: **INVOKER**
- language: sql

```sql
SELECT CASE
    WHEN COALESCE(points,0) >= 10000 THEN 'platinum'
    WHEN COALESCE(points,0) >= 5000  THEN 'gold'
    WHEN COALESCE(points,0) >= 1000  THEN 'silver'
    ELSE 'bronze'
  END;
```

### `mechanic_service_reminders_due(p_business_id uuid)`

- returns: `TABLE(business_id uuid, vehicle_supabase_id uuid, plate text, vin text, make text, model text, client_supabase_id uuid, odometer_km integer, next_service_km integer, next_service_at timestamp with time zone, km_remaining integer, days_remaining integer)`
- security: **DEFINER**
- language: sql

```sql
SELECT
    v.business_id,
    v.supabase_id AS vehicle_supabase_id,
    v.plate,
    v.vin,
    v.make,
    v.model,
    v.client_supabase_id,
    v.odometer_km,
    v.next_service_km,
    v.next_service_at,
    CASE WHEN v.next_service_km IS NOT NULL AND v.odometer_km IS NOT NULL
         THEN v.next_service_km - v.odometer_km END AS km_remaining,
    CASE WHEN v.next_service_at IS NOT NULL
         THEN EXTRACT(DAY FROM (v.next_service_at - now()))::INTEGER END AS days_remaining
  FROM vehicles v
  WHERE v.active = true
    AND (p_business_id IS NULL OR v.business_id = p_business_id)
    AND (
      (v.next_service_km IS NOT NULL AND v.odometer_km IS NOT NULL
        AND v.odometer_km >= v.next_service_km - 500)
      OR
      (v.next_service_at IS NOT NULL
        AND v.next_service_at <= now() + INTERVAL '7 days')
    );
```

### `merge_business_settings(p_business_id uuid, p_patch jsonb)`

- returns: `jsonb`
- security: **INVOKER**
- language: sql

```sql
UPDATE businesses SET settings = COALESCE(settings, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb), updated_at = now() WHERE id = p_business_id RETURNING settings;
```

### `my_business_ids()`

- returns: `SETOF uuid`
- security: **DEFINER**
- language: sql

```sql
SELECT id FROM businesses WHERE owner_id = auth.uid()
  UNION
  SELECT business_id FROM staff WHERE auth_user_id = auth.uid() AND active = true
```

### `my_staff_role()`

- returns: `text`
- security: **DEFINER**
- language: sql

```sql
SELECT role FROM public.staff WHERE auth_user_id = auth.uid() AND active = true LIMIT 1;
```

### `oid_dist(oid, oid)`

- returns: `oid`
- security: **INVOKER**
- language: c

```plpgsql
oid_dist
```

### `purge_stale_rate_limits()`

- returns: `integer`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.api_rate_limits
   WHERE window_start < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
```

### `resolve_oversell(p_oversell_id uuid, p_resolved_by uuid, p_resolved_by_name text, p_notes text)`

- returns: `void`
- security: **DEFINER**
- language: plpgsql

```plpgsql
BEGIN
  UPDATE inventory_oversells
     SET resolved_at      = now(),
         resolved_by      = p_resolved_by,
         resolved_by_name = p_resolved_by_name,
         resolution_notes = p_notes
   WHERE supabase_id = p_oversell_id
      OR id          = p_oversell_id;
END
```

### `resolve_user_business_id(p_user_id uuid)`

- returns: `uuid`
- security: **DEFINER**
- language: sql

```sql
SELECT bid FROM (
    SELECT id AS bid, 1 AS pri FROM public.businesses WHERE owner_id = p_user_id
    UNION ALL
    SELECT business_id AS bid, 2 AS pri FROM public.staff
      WHERE auth_user_id = p_user_id AND active = true
  ) sub
  ORDER BY pri ASC
  LIMIT 1;
```

### `rls_auto_enable()`

- returns: `event_trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
```

### `services_top_sellers(p_business_id uuid, p_since timestamp with time zone, p_limit integer)`

- returns: `SETOF services`
- security: **INVOKER**
- language: sql

```sql
SELECT s.* FROM services s JOIN (SELECT COALESCE(ti.service_id::text, ti.service_supabase_id::text) AS svc_key, SUM(COALESCE(ti.quantity, 1)) AS total_qty FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id WHERE t.business_id = p_business_id AND t.created_at >= p_since AND t.status NOT IN ('voided','anulado','nula') AND (ti.service_id IS NOT NULL OR ti.service_supabase_id IS NOT NULL) GROUP BY 1) agg ON agg.svc_key = COALESCE(s.id::text, s.supabase_id::text) WHERE s.business_id = p_business_id AND s.active = true ORDER BY agg.total_qty DESC LIMIT GREATEST(p_limit, 1);
```

### `set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END
```

### `set_updated_at_journal_entries()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
begin
  new.updated_at = now();
  return new;
end;
```

### `sweep_dgii_seed_nonces()`

- returns: `integer`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM public.dgii_seed_nonces
   WHERE issued_at < now() - INTERVAL '15 minutes';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
```

### `sync_merge_upsert(p_table text, p_rows jsonb, p_business_id uuid, p_append_only boolean, p_natural_key text)` **HOT (called from web.js — DO NOT BREAK)**

- returns: `jsonb`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_allowed CONSTANT text[] := ARRAY[
    'activity_log','adelantos','app_settings','appointment_reminders','appointments',
    'aseguradoras','bank_preapprovals','caja_chica','cajero_commissions',
    'carniceria_corte_categories','carniceria_scales','categorias_servicio',
    'client_item_prices','client_memberships','client_service_rates','clients',
    'collections_log','credit_payments','cuadre_caja','ecf_queue','ecf_submissions',
    'empleados','inventory_count_items','inventory_counts','inventory_discards',
    'inventory_freshness_log','inventory_items','inventory_oversells','inventory_transactions',
    'kds_events','leads','loan_payments','loan_schedule','loans','loyalty_transactions',
    'mechanic_commissions','membership_redemptions','memberships','mesas','modificadores',
    'ncf_sequences','notas_credito','parts_orders','pawn_items','payroll_runs',
    'projects','promotion_items','promotions','queue','queue_deletions','recurring_orders',
    'restaurant_reservations','salary_changes','sales_deals','seller_commissions',
    'service_bays','service_modificadores','service_packages','service_recipe_items',
    'services','staff','stylist_schedules','subscriptions','suppliers','test_drives',
    'ticket_item_modificadores','ticket_items','tickets','vehicle_documents',
    'vehicle_inventory','vehicle_reservations','vehicle_titulo','vehicle_warranties',
    'vehicles','wash_combos','washer_commissions','work_order_photos','work_orders'
  ];
  -- Allowlist of natural-key columns by table. Hardcoded server-side so a
  -- malicious client can't pass an arbitrary column name (SQL-injection-safe
  -- via quote_ident, but defense-in-depth).
  v_nk_allowed CONSTANT jsonb := jsonb_build_object(
    'ncf_sequences', 'type',
    'app_settings',  'key',
    'aseguradoras',  'nombre',
    'suppliers',     'nombre',
    'carniceria_scales', 'nombre',
    'recurring_orders',  'nombre',
    'promotions',    'name'
  );
  v_row_keys      text[];
  v_typed_cols    text;
  v_insert_cols   text;
  v_set_clause    text;
  v_sql           text;
  v_inserted      int := 0;
  v_updated       int := 0;
  v_nk_col        text;  -- validated natural-key column name (NULL = no NK match)
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'sync_merge_upsert: p_business_id is required';
  END IF;
  IF NOT (p_table = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'sync_merge_upsert: table % not in allowlist', p_table;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('inserted', 0, 'updated', 0);
  END IF;

  -- Validate optional natural key against the allowlist for this table.
  IF p_natural_key IS NOT NULL THEN
    IF (v_nk_allowed ->> p_table) = p_natural_key THEN
      v_nk_col := p_natural_key;
    ELSE
      -- Caller-passed natural key not allowed for this table; ignore silently
      -- (legacy on_conflict path was supabase_id-only anyway).
      v_nk_col := NULL;
-- … (133 more lines truncated)
```

### `sync_role_empleados_to_staff()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
BEGIN IF NEW.role IS DISTINCT FROM OLD.role THEN UPDATE staff SET role = NEW.role, updated_at = now() WHERE business_id = NEW.business_id AND lower(name) = lower(NEW.nombre) AND role IS DISTINCT FROM NEW.role; END IF; RETURN NEW; END;
```

### `sync_role_staff_to_empleados()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
BEGIN IF NEW.role IS DISTINCT FROM OLD.role THEN UPDATE empleados SET role = NEW.role, updated_at = now() WHERE business_id = NEW.business_id AND lower(nombre) = lower(NEW.name) AND role IS DISTINCT FROM NEW.role; END IF; RETURN NEW; END;
```

### `sync_upsert_counter_row(p_table text, p_row jsonb)`

- returns: `jsonb`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  sid uuid;
  bid uuid;
  incoming_updated timestamptz;
  existing_updated timestamptz;
  cols text;
  vals text;
  sets text;
  sql_text text;
BEGIN
  sid := (p_row->>'supabase_id')::uuid;
  bid := (p_row->>'business_id')::uuid;
  incoming_updated := COALESCE((p_row->>'updated_at')::timestamptz, NOW());
  EXECUTE format('SELECT updated_at FROM public.%I WHERE supabase_id = %L AND business_id = %L', p_table, sid, bid)
    INTO existing_updated;
  IF existing_updated IS NOT NULL AND incoming_updated <= existing_updated THEN
    RETURN jsonb_build_object('ok', true, 'action', 'skip_stale', 'existing', existing_updated, 'incoming', incoming_updated);
  END IF;
  IF existing_updated IS NULL THEN
    SELECT string_agg(quote_ident(je.key), ','), string_agg(quote_nullable(je.value), ',')
      INTO cols, vals
      FROM jsonb_each_text(p_row) je;
    sql_text := format('INSERT INTO public.%I (%s) VALUES (%s)', p_table, cols, vals);
    EXECUTE sql_text;
    RETURN jsonb_build_object('ok', true, 'action', 'inserted');
  ELSE
    SELECT string_agg(format('%I = %L', je.key, je.value), ', ')
      INTO sets
      FROM jsonb_each_text(p_row) je
     WHERE je.key NOT IN ('supabase_id','business_id','id','created_at');
    sql_text := format('UPDATE public.%I SET %s WHERE supabase_id = %L AND business_id = %L', p_table, sets, sid, bid);
    EXECUTE sql_text;
    RETURN jsonb_build_object('ok', true, 'action', 'updated');
  END IF;
END;
```

### `sync_user_business_metadata(p_user_id uuid)`

- returns: `uuid`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  v_biz UUID;
BEGIN
  v_biz := public.resolve_user_business_id(p_user_id);
  IF v_biz IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                          || jsonb_build_object('business_id', v_biz::text)
   WHERE id = p_user_id
     AND COALESCE((raw_app_meta_data ->> 'business_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) <> v_biz;

  RETURN v_biz;
END;
```

### `tg_business_sync_owner_metadata()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    PERFORM public.sync_user_business_metadata(NEW.owner_id);
  END IF;
  RETURN NEW;
END;
```

### `tg_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
```

### `tg_staff_sync_user_metadata()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.auth_user_id IS NOT NULL AND COALESCE(NEW.active, false) = true THEN
    PERFORM public.sync_user_business_metadata(NEW.auth_user_id);
  END IF;
  -- If a row deactivates / reassigns, the user's previous business may no
  -- longer be valid; resolve_user_business_id() will pick the next active
  -- business (or NULL) on the next call.
  IF TG_OP = 'UPDATE' AND OLD.auth_user_id IS NOT NULL AND OLD.auth_user_id <> COALESCE(NEW.auth_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    PERFORM public.sync_user_business_metadata(OLD.auth_user_id);
  END IF;
  RETURN NEW;
END;
```

### `tg_touch_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `ticket_void_with_side_effects(p_ticket_supabase_id uuid, p_void_reason text, p_void_by uuid)`

- returns: `jsonb`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  t_row record;
  it record;
  ncf_prefix text;
  ncf_serial text;
  ncf_seq int;
  anecf_id uuid;
  restored_count int := 0;
  reversed_comms int := 0;
  ncf_decremented boolean := false;
  anecf_enqueued boolean := false;
BEGIN
  SELECT * INTO t_row FROM public.tickets WHERE supabase_id = p_ticket_supabase_id;
  IF t_row IS NULL THEN RAISE EXCEPTION 'ticket not found: %', p_ticket_supabase_id; END IF;
  IF t_row.status IN ('void','anulado','voided') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_voided');
  END IF;

  FOR it IN
    SELECT inventory_item_supabase_id, quantity FROM public.ticket_items
     WHERE ticket_supabase_id = p_ticket_supabase_id AND inventory_item_supabase_id IS NOT NULL
  LOOP
    UPDATE public.inventory_items
       SET quantity = COALESCE(quantity, 0) + COALESCE(it.quantity, 1), updated_at = NOW()
     WHERE supabase_id = it.inventory_item_supabase_id AND business_id = t_row.business_id;
    restored_count := restored_count + 1;
  END LOOP;

  WITH d_w AS (DELETE FROM public.washer_commissions WHERE ticket_supabase_id = p_ticket_supabase_id RETURNING 1),
       d_s AS (DELETE FROM public.seller_commissions WHERE ticket_supabase_id = p_ticket_supabase_id RETURNING 1),
       d_c AS (DELETE FROM public.cajero_commissions WHERE ticket_supabase_id = p_ticket_supabase_id RETURNING 1)
  SELECT (SELECT COUNT(*) FROM d_w) + (SELECT COUNT(*) FROM d_s) + (SELECT COUNT(*) FROM d_c) INTO reversed_comms;

  IF t_row.ncf IS NOT NULL THEN
    ncf_prefix := substring(t_row.ncf, 1, 1);
    ncf_serial := COALESCE(t_row.ncf_type, t_row.comprobante_type, substring(t_row.ncf, 1, 3));
    BEGIN
      ncf_seq := CAST(substring(t_row.ncf FROM '[0-9]+$') AS INTEGER);
    EXCEPTION WHEN others THEN ncf_seq := 0;
    END;
    IF ncf_prefix = 'B' THEN
      UPDATE public.ncf_sequences
         SET current_number = GREATEST(0, COALESCE(current_number, 0) - 1), updated_at = NOW()
       WHERE business_id = t_row.business_id AND type = ncf_serial AND COALESCE(current_number, 0) > 0;
      ncf_decremented := true;
    ELSIF ncf_prefix = 'E' THEN
      anecf_id := gen_random_uuid();
      INSERT INTO public.anecf_queue (
        supabase_id, business_id, ncf, tipo_ecf, rango_desde, rango_hasta,
        ticket_supabase_id, status, attempts, voided_at, environment
      ) VALUES (
        anecf_id, t_row.business_id, t_row.ncf, ncf_serial, ncf_seq, ncf_seq,
        p_ticket_supabase_id, 'pending', 0, NOW(),
        COALESCE((SELECT value FROM public.app_settings WHERE business_id = t_row.business_id AND key = 'dgii_environment' LIMIT 1), 'certecf')
      ) ON CONFLICT (business_id, ncf) DO NOTHING;
      anecf_enqueued := true;
    END IF;
  END IF;

-- … (29 more lines truncated)
```

### `time_dist(time without time zone, time without time zone)`

- returns: `interval`
- security: **INVOKER**
- language: c

```plpgsql
time_dist
```

### `touch_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END
```

### `trg_accounting_clients_cap()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE _plan text; _count int; _cap int;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  SELECT plan INTO _plan FROM businesses WHERE id = NEW.business_id;
  -- Pro MAX / contabilidad_max → unlimited
  IF _plan IN ('pro_max','contabilidad_max') THEN RETURN NEW; END IF;
  -- Everyone else: 10-client cap (Pro PLUS tier)
  SELECT COUNT(*) INTO _count FROM accounting_clients
    WHERE business_id = NEW.business_id AND status <> 'archived';
  _cap := 10;
  IF _count >= _cap THEN
    RAISE EXCEPTION 'accounting_clients_cap_exceeded: plan=% allows max=% (current=%). Upgrade to Pro MAX for unlimited.',
      _plan, _cap, _count USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
```

### `trg_activity_log_immutable()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  RAISE EXCEPTION 'activity_log is append-only; UPDATE/DELETE rejected'
    USING ERRCODE = 'feature_not_supported';
END;
```

### `trg_aseguradoras_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `trg_comprobante_period_derive()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.fecha_comprobante IS NOT NULL THEN
    NEW.period_year  := EXTRACT(YEAR  FROM NEW.fecha_comprobante)::int;
    NEW.period_month := EXTRACT(MONTH FROM NEW.fecha_comprobante)::int;
  END IF;
  RETURN NEW;
END;
```

### `trg_credit_ticket_bump_balance()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  is_credit boolean;
BEGIN
  is_credit := (
    NEW.tipo_venta = 'credito' OR
    NEW.payment_method IN ('credit','credito')
  );
  IF is_credit AND NEW.status IN ('pendiente','open')
     AND NEW.client_supabase_id IS NOT NULL
     AND NOT COALESCE(NEW.is_test, false)
  THEN
    UPDATE public.clients
       SET balance = COALESCE(balance, 0) + COALESCE(NEW.total, 0),
           updated_at = NOW()
     WHERE supabase_id = NEW.client_supabase_id
       AND business_id = NEW.business_id;
  END IF;
  RETURN NEW;
END;
```

### `trg_empleados_change_audit()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.salary IS DISTINCT FROM OLD.salary THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, amount, old_value, new_value, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id, 'empleado_salary_change', 'critical',
      'empleado', NEW.id::text, NEW.nombre, NEW.salary,
      OLD.salary::text, NEW.salary::text, NOW(), NOW());
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, old_value, new_value, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id, 'empleado_role_change', 'critical',
      'empleado', NEW.id::text, NEW.nombre, OLD.role, NEW.role, NOW(), NOW());
  END IF;
  RETURN NEW;
END;
```

### `trg_empleados_role_guard()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  caller_uid uuid; caller_role text;
  caller_role_level int; new_role_level int;
BEGIN
  IF current_setting('role', true) IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'role_change_requires_authenticated_session' USING ERRCODE = '42501';
  END IF;

  SELECT s.role INTO caller_role
  FROM staff s
  WHERE s.auth_user_id = caller_uid AND s.business_id = NEW.business_id AND s.active = true
  LIMIT 1;

  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'caller_not_in_target_business' USING ERRCODE = '42501';
  END IF;

  caller_role_level := CASE caller_role
    WHEN 'owner' THEN 100 WHEN 'cfo' THEN 80 WHEN 'manager' THEN 60
    WHEN 'accountant' THEN 40 WHEN 'cashier' THEN 20 WHEN 'kitchen' THEN 10 ELSE 0 END;
  new_role_level := CASE NEW.role
    WHEN 'owner' THEN 100 WHEN 'cfo' THEN 80 WHEN 'manager' THEN 60
    WHEN 'accountant' THEN 40 WHEN 'cashier' THEN 20 WHEN 'kitchen' THEN 10 ELSE 0 END;

  IF NEW.role IN ('owner','cfo') AND caller_role <> 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_assign_role_%', NEW.role USING ERRCODE = '42501';
  END IF;
  IF caller_role <> 'owner' AND new_role_level >= caller_role_level THEN
    RAISE EXCEPTION 'cannot_assign_role_equal_or_higher_than_caller' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
```

### `trg_insurance_batches_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `trg_inventory_price_audit()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price OR NEW.cost IS DISTINCT FROM OLD.cost THEN
    INSERT INTO activity_log (
      supabase_id, business_id, event_type, severity,
      target_type, target_id, target_name,
      old_value, new_value, metadata, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), NEW.business_id,
      CASE WHEN NEW.price IS DISTINCT FROM OLD.price AND NEW.cost IS DISTINCT FROM OLD.cost THEN 'inventory_price_cost_change'
           WHEN NEW.price IS DISTINCT FROM OLD.price THEN 'inventory_price_change'
           ELSE 'inventory_cost_change' END,
      'warn',
      'inventory_item', NEW.id::text, NEW.name,
      jsonb_build_object('price', OLD.price, 'cost', OLD.cost)::text,
      jsonb_build_object('price', NEW.price, 'cost', NEW.cost)::text,
      jsonb_build_object('sku', NEW.sku),
      NOW(), NOW()
    );
  END IF;
  RETURN NEW;
END;
```

### `trg_je_balance_check()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  -- Only enforce for posted entries (drafts allowed to be in-progress)
  IF NEW.status IN ('posted', 'reversed') THEN
    IF ABS(COALESCE(NEW.totals_debit,0) - COALESCE(NEW.totals_credit,0)) > 0.005 THEN
      RAISE EXCEPTION 'journal_entry_imbalanced: debit=% credit=% diff=%',
        NEW.totals_debit, NEW.totals_credit,
        (NEW.totals_debit - NEW.totals_credit)
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
```

### `trg_mechanic_commissions_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `trg_mesas_rev_guard()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  -- Reject writes that change `status` without strictly increasing `rev`.
  -- Non-status edits (name/zone/capacity/sort_order/etc.) are free to pass.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(NEW.rev, 0) <= COALESCE(OLD.rev, 0) THEN
    RAISE EXCEPTION 'mesas.rev_conflict: incoming rev % did not advance stored rev % for mesa %',
      NEW.rev, OLD.rev, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
```

### `trg_parts_orders_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `trg_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `trg_set_updated_at_insert()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.updated_at IS NULL THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END
```

### `trg_staff_change_audit()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, old_value, new_value, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id, 'staff_role_change', 'critical',
      'staff', NEW.id::text, NEW.name || ' (@' || NEW.username || ')',
      OLD.role, NEW.role, NOW(), NOW());
  END IF;
  IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
    -- Don't store the hash itself; just flag the event.
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id, 'staff_pin_change', 'critical',
      'staff', NEW.id::text, NEW.name || ' (@' || NEW.username || ')',
      NOW(), NOW());
  END IF;
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, old_value, new_value, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id,
      CASE WHEN NEW.active THEN 'staff_reactivated' ELSE 'staff_deactivated' END,
      'warn', 'staff', NEW.id::text, NEW.name || ' (@' || NEW.username || ')',
      OLD.active::text, NEW.active::text, NOW(), NOW());
  END IF;
  RETURN NEW;
END;
```

### `trg_staff_last_owner_deactivate_guard()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE _other_owners int;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  IF NEW.active IS NOT DISTINCT FROM OLD.active THEN RETURN NEW; END IF;
  IF OLD.role = 'owner' AND OLD.active = true AND NEW.active = false THEN
    SELECT COUNT(*) INTO _other_owners FROM staff
    WHERE business_id = NEW.business_id AND active = true AND role = 'owner' AND id <> NEW.id;
    IF _other_owners = 0 THEN
      RAISE EXCEPTION 'last_owner_cannot_deactivate: at least one active owner required'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
```

### `trg_staff_last_owner_guard()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE _other_owners int;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
  IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
    SELECT COUNT(*) INTO _other_owners FROM staff
    WHERE business_id = NEW.business_id AND active = true AND role = 'owner' AND id <> NEW.id;
    IF _other_owners = 0 THEN
      RAISE EXCEPTION 'last_owner_cannot_self_downgrade: at least one active owner required'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
```

### `trg_staff_pin_guard()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  caller_uid uuid;
  caller_staff RECORD;
BEGIN
  IF current_setting('role', true) IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;
  -- No PIN change → nothing to enforce.
  IF NEW.pin_hash IS NOT DISTINCT FROM OLD.pin_hash THEN
    RETURN NEW;
  END IF;

  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'pin_change_requires_authenticated_session' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.role INTO caller_staff
  FROM staff s
  WHERE s.auth_user_id = caller_uid
    AND s.business_id = NEW.business_id
    AND s.active = true
  LIMIT 1;

  IF caller_staff.id IS NULL THEN
    RAISE EXCEPTION 'caller_not_in_target_business' USING ERRCODE = '42501';
  END IF;

  -- Self-change: allowed (web.js verifies oldPin before this fires).
  IF caller_staff.id = NEW.id THEN
    RETURN NEW;
  END IF;

  -- Non-self PIN reset is owner-only. Managers must escalate via a service-role
  -- endpoint after passing ManagerAuthGate; that path bypasses this trigger.
  IF caller_staff.role <> 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_reset_another_users_pin' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
```

### `trg_staff_role_guard()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  caller_uid uuid;
  caller_role text;
  caller_role_level int;
  new_role_level int;
BEGIN
  -- Service role / superuser bypass — sync, migrations, scripts.
  IF current_setting('role', true) IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;

  -- No role change → nothing to enforce.
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Resolve caller's staff row in the same business.
  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'role_change_requires_authenticated_session'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.role INTO caller_role
  FROM staff s
  WHERE s.auth_user_id = caller_uid
    AND s.business_id = NEW.business_id
    AND s.active = true
  LIMIT 1;

  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'caller_not_in_target_business'
      USING ERRCODE = '42501';
  END IF;

  -- Role hierarchy (mirrors web.js ROLE_LEVEL):
  --   owner=100, cfo=80, manager=60, accountant=40, cashier=20, kitchen=10, none=0
  caller_role_level := CASE caller_role
    WHEN 'owner' THEN 100 WHEN 'cfo' THEN 80 WHEN 'manager' THEN 60
    WHEN 'accountant' THEN 40 WHEN 'cashier' THEN 20 WHEN 'kitchen' THEN 10
    ELSE 0 END;
  new_role_level := CASE NEW.role
    WHEN 'owner' THEN 100 WHEN 'cfo' THEN 80 WHEN 'manager' THEN 60
    WHEN 'accountant' THEN 40 WHEN 'cashier' THEN 20 WHEN 'kitchen' THEN 10
    ELSE 0 END;

  -- Only owner can assign owner or cfo.
  IF NEW.role IN ('owner','cfo') AND caller_role <> 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_assign_role_%', NEW.role
      USING ERRCODE = '42501';
  END IF;

  -- Caller cannot promote to a level >= their own (unless caller is owner).
  IF caller_role <> 'owner' AND new_role_level >= caller_role_level THEN
    RAISE EXCEPTION 'cannot_assign_role_equal_or_higher_than_caller'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
-- … (2 more lines truncated)
```

### `trg_suppliers_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `trg_ticket_complete_appointment()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.appointment_supabase_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'cobrado' THEN RETURN NEW; END IF;
  -- Skip if this UPDATE didn't change anything we care about
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'cobrado' AND OLD.appointment_supabase_id IS NOT DISTINCT FROM NEW.appointment_supabase_id THEN
      RETURN NEW;
    END IF;
  END IF;
  UPDATE public.appointments
     SET status = 'completed', updated_at = NOW()
   WHERE supabase_id = NEW.appointment_supabase_id
     AND business_id = NEW.business_id
     AND status NOT IN ('completed','cancelled','no_show');
  RETURN NEW;
END;
```

### `trg_ticket_item_decrement_inventory()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  t_status text;
  cur_qty  numeric;
BEGIN
  IF NEW.inventory_item_supabase_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO t_status
    FROM public.tickets WHERE supabase_id = NEW.ticket_supabase_id;
  IF t_status IS DISTINCT FROM 'cobrado' THEN RETURN NEW; END IF;
  SELECT COALESCE(quantity, 0) INTO cur_qty
    FROM public.inventory_items
   WHERE supabase_id = NEW.inventory_item_supabase_id
     AND business_id = NEW.business_id
   FOR UPDATE;
  IF cur_qty IS NULL THEN RETURN NEW; END IF;
  UPDATE public.inventory_items
     SET quantity = GREATEST(0, cur_qty - COALESCE(NEW.quantity, 1)),
         updated_at = NOW()
   WHERE supabase_id = NEW.inventory_item_supabase_id
     AND business_id = NEW.business_id;
  IF cur_qty < COALESCE(NEW.quantity, 1) THEN
    INSERT INTO public.inventory_oversells (
      supabase_id, business_id, ticket_supabase_id, ticket_item_supabase_id,
      item_supabase_id, requested_qty, available_qty, fulfilled_qty, detected_at
    ) VALUES (
      gen_random_uuid(), NEW.business_id, NEW.ticket_supabase_id, NEW.supabase_id,
      NEW.inventory_item_supabase_id, NEW.quantity, cur_qty, cur_qty, NOW()
    );
  END IF;
  RETURN NEW;
END;
```

### `trg_ticket_items_in_stock_guard()`

- returns: `trigger`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE _in_stock boolean;
BEGIN
  IF NEW.service_supabase_id IS NULL THEN RETURN NEW; END IF;
  -- Service-role bypass for sync etc.
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  -- Manager override marker (set via set_config in elevated flow).
  IF current_setting('app.in_stock_override', true) = 'true' THEN RETURN NEW; END IF;

  SELECT s.in_stock INTO _in_stock
  FROM services s WHERE s.supabase_id = NEW.service_supabase_id AND s.business_id = NEW.business_id
  LIMIT 1;

  IF _in_stock IS FALSE THEN
    RAISE EXCEPTION 'service_out_of_stock_86_listed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
```

### `trg_ticket_payment_balance()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
DECLARE _sum numeric; _expected numeric; _diff numeric;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('paid','cobrado') THEN RETURN NEW; END IF;
  IF NEW.payment_method IN ('credit','credito') THEN RETURN NEW; END IF;
  IF NEW.payment_method IN ('pedidos_ya','pedidos-ya','py') THEN RETURN NEW; END IF;
  IF NEW.payment_parts IS NULL OR jsonb_typeof(NEW.payment_parts) <> 'array' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM((p->>'amount')::numeric), 0) INTO _sum
  FROM jsonb_array_elements(NEW.payment_parts) AS p;
  _expected := COALESCE(NEW.total, 0) - COALESCE(NEW.descuento, 0);
  _diff := _sum - _expected;
  -- Underpay: hard reject (existing behavior).
  IF _diff < -0.05 THEN
    RAISE EXCEPTION 'underpaid_sale: sum=% expected=% diff=%',
      _sum, _expected, _diff USING ERRCODE = '23514';
  END IF;
  -- Significant overpay (> RD$1000) flagged but allowed — log via NOTICE so
  -- a future trigger could write activity_log if needed. Mostly catches buggy
  -- imports / wrong-total scripts.
  IF _diff > 1000 THEN
    RAISE WARNING 'ticket_payment_overpay_drift: ticket=% sum=% expected=% diff=%',
      NEW.id, _sum, _expected, _diff;
  END IF;
  RETURN NEW;
END;
```

### `trg_tickets_rev_guard()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(NEW.rev, 0) <= COALESCE(OLD.rev, 0) THEN
    RAISE EXCEPTION 'tickets.rev_conflict: incoming rev % did not advance stored rev % for ticket %',
      NEW.rev, OLD.rev, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
```

### `trg_tickets_stamp_cuadre()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
DECLARE _cuadre_sid uuid;
BEGIN
  IF NEW.cuadre_supabase_id IS NOT NULL THEN RETURN NEW; END IF;
  -- Status filter removed — every newly-inserted ticket gets stamped when an
  -- open cuadre exists. Drafts / pendiente / cobrado / nula / open all welcome.
  SELECT cc.supabase_id INTO _cuadre_sid
  FROM cuadre_caja cc
  WHERE cc.business_id = NEW.business_id AND cc.status = 'abierto'
  ORDER BY cc.updated_at DESC NULLS LAST, cc.id DESC LIMIT 1;
  IF _cuadre_sid IS NOT NULL THEN NEW.cuadre_supabase_id := _cuadre_sid; END IF;
  RETURN NEW;
END;
```

### `trg_touch_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN
  -- Always advance on UPDATE so LWW sync sees the row. If the caller
  -- explicitly supplied a newer value (e.g., a client-side clock),
  -- honor it; otherwise stamp now().
  IF NEW.updated_at IS NULL OR NEW.updated_at <= OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
```

### `trg_vehicle_documents_set_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `ts_dist(timestamp without time zone, timestamp without time zone)`

- returns: `interval`
- security: **INVOKER**
- language: c

```plpgsql
ts_dist
```

### `tstz_dist(timestamp with time zone, timestamp with time zone)`

- returns: `interval`
- security: **INVOKER**
- language: c

```plpgsql
tstz_dist
```

### `update_updated_at()`

- returns: `trigger`
- security: **INVOKER**
- language: plpgsql

```plpgsql
BEGIN NEW.updated_at = now(); RETURN NEW; END;
```

### `validate_ticket_prices(p_business_id uuid, p_items jsonb)` **HOT (called from web.js — DO NOT BREAK)**

- returns: `jsonb`
- security: **DEFINER**
- language: plpgsql

```plpgsql
DECLARE
  item JSONB;
  svc RECORD;
  inv RECORD;
  errors JSONB := '[]'::JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (item->>'service_id') IS NOT NULL THEN
      SELECT s.price INTO svc FROM services s
        WHERE s.id = (item->>'service_id')::UUID AND s.business_id = p_business_id;
      IF svc IS NULL THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'error', 'Service not found: ' || COALESCE(item->>'name', 'unknown'),
          'service_id', item->>'service_id'
        ));
      ELSIF abs(svc.price - (item->>'price')::NUMERIC) > 0.01 THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'error', 'Price mismatch for ' || COALESCE(item->>'name', 'unknown'),
          'expected', svc.price,
          'received', (item->>'price')::NUMERIC,
          'service_id', item->>'service_id'
        ));
      END IF;
    ELSIF (item->>'inventory_item_id') IS NOT NULL THEN
      SELECT i.price INTO inv FROM inventory_items i
        WHERE i.id = (item->>'inventory_item_id')::UUID AND i.business_id = p_business_id;
      IF inv IS NULL THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'error', 'Product not found: ' || COALESCE(item->>'name', 'unknown'),
          'inventory_item_id', item->>'inventory_item_id'
        ));
      ELSIF abs(inv.price - (item->>'price')::NUMERIC) > 0.01 THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'error', 'Price mismatch for ' || COALESCE(item->>'name', 'unknown'),
          'expected', inv.price,
          'received', (item->>'price')::NUMERIC,
          'inventory_item_id', item->>'inventory_item_id'
        ));
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('valid', jsonb_array_length(errors) = 0, 'errors', errors);
END;
```


## §4. Triggers

Query:

```sql
SELECT event_object_table AS table_name,
         trigger_name,
         action_timing,
         string_agg(event_manipulation, ',') AS events,
         action_statement,
         action_condition
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
  GROUP BY event_object_table, trigger_name, action_timing, action_statement, action_condition
  ORDER BY event_object_table, trigger_name;
```

Total triggers: **294**

| table | trigger | timing | events | action | condition |
|-------|---------|--------|--------|--------|-----------|
| `accounting_bank_accounts` | `tg_acc_ba_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_bank_statement_lines` | `tg_acc_bsl_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_billing_invoices` | `tg_acc_inv_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_billing_plans` | `tg_acc_bp_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_chart_of_accounts` | `tg_acc_coa_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_clients` | `tg_acc_clients_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_clients` | `trg_accounting_clients_cap_ins` | BEFORE | INSERT | EXECUTE FUNCTION trg_accounting_clients_cap() |  |
| `accounting_coa_auto_post_rules` | `tg_acc_apr_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_comprobantes` | `trg_comprobante_period_derive_ins` | BEFORE | INSERT | EXECUTE FUNCTION trg_comprobante_period_derive() |  |
| `accounting_comprobantes` | `trg_comprobante_period_derive_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_comprobante_period_derive() |  |
| `accounting_csv_mappings` | `tg_acc_csv_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_documents` | `tg_acc_docs_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_fixed_assets` | `tg_acc_fa_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_foreign_payments` | `tg_acc_fp_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_inbox` | `tg_acc_inbox_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_journal_entries` | `tg_acc_je_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_journal_entries` | `trg_je_balance_check_ins` | BEFORE | INSERT | EXECUTE FUNCTION trg_je_balance_check() |  |
| `accounting_journal_entries` | `trg_je_balance_check_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_je_balance_check() |  |
| `accounting_journal_lines` | `tg_acc_jl_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_obligations_calendar` | `tg_acc_obl_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_payroll_employee_bank` | `tg_acc_pl_emp_bank_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_payroll_lines` | `tg_acc_pl_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_payroll_periods` | `tg_acc_pp_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_retentions_emitidas` | `tg_acc_re_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_retentions_recibidas` | `tg_acc_rr_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_tasks` | `tg_acc_tk_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `accounting_tss_filings` | `tg_acc_tss_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `activity_log` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_legacy_unpartitioned` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_legacy_unpartitioned` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_legacy_unpartitioned` | `trg_activity_log_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `activity_log_legacy_unpartitioned` | `trg_activity_log_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `activity_log_p_202510` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202510` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202511` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202511` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202512` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202512` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202601` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202601` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202602` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202602` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202603` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202603` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202604` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202604` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202605` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202605` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202606` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202606` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202607` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202607` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202608` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202608` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202609` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202609` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202610` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202610` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202611` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202611` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202612` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202612` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202701` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202701` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202702` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202702` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202703` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202703` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202704` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202704` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202705` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202705` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202706` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202706` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202707` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202707` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202708` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202708` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202709` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202709` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202710` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202710` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202711` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202711` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202712` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202712` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202801` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202801` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202802` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202802` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202803` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202803` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202804` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202804` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202805` | `trg_activity_log_immutable_del` | BEFORE | DELETE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `activity_log_p_202805` | `trg_activity_log_immutable_upd` | BEFORE | UPDATE | EXECUTE FUNCTION trg_activity_log_immutable() |  |
| `adelantos` | `trg_adelantos_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `adelantos` | `trg_adelantos_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `anecf_queue` | `trg_anecf_queue_touch` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `anecf_queue` | `trg_anecf_queue_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `app_settings` | `trg_app_settings_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `app_settings` | `trg_app_settings_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION app_settings_bump_updated_at() |  |
| `app_settings` | `trg_settings_updated` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `appointment_reminders` | `trg_appointment_reminders_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `appointments` | `trg_appointments_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `appointments` | `trg_appointments_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `aseguradoras` | `aseguradoras_set_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_aseguradoras_set_updated_at() |  |
| `bank_preapprovals` | `bank_preapprovals_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `businesses` | `businesses_sync_owner_metadata` | AFTER | UPDATE,INSERT | EXECUTE FUNCTION tg_business_sync_owner_metadata() |  |
| `businesses` | `trg_businesses_updated` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `caja_chica` | `trg_caja_chica_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `caja_chica` | `trg_caja_chica_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `caja_chica` | `trg_caja_chica_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `cajero_commissions` | `trg_cajero_comm_employment_window` | BEFORE | INSERT,UPDATE | EXECUTE FUNCTION guard_commission_employment_window() |  |
| `cajero_commissions` | `trg_cajero_commissions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `cajero_commissions` | `trg_cajero_commissions_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `cajero_commissions` | `trg_cajero_commissions_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `carniceria_corte_categories` | `trg_carniceria_corte_categories_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `carniceria_scales` | `trg_carniceria_scales_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `categorias_servicio` | `trg_categorias_servicio_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `categorias_servicio` | `trg_categorias_servicio_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `categorias_servicio` | `trg_categorias_servicio_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `client_item_prices` | `trg_cip_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `client_item_prices` | `trg_client_item_prices_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `client_memberships` | `trg_client_memberships_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `client_service_rates` | `trg_client_service_rates_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `clients` | `trg_clients_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `clients` | `trg_clients_updated` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `clients` | `trg_clients_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `collections_attempts` | `trg_collections_attempts_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `collections_log` | `collections_log_touch` | BEFORE | UPDATE | EXECUTE FUNCTION tg_touch_updated_at() |  |
| `collections_log` | `trg_collections_log_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `collections_log` | `trg_collections_log_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `compras_607` | `trg_compras_607_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `compras_607` | `trg_compras_607_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `compras_607` | `trg_compras_607_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `credit_payments` | `trg_credit_payments_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `credit_payments` | `trg_credit_payments_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `credit_payments` | `trg_credit_payments_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `crm_leads` | `crm_leads_touch` | BEFORE | UPDATE | EXECUTE FUNCTION crm_leads_set_updated_at() |  |
| `cuadre_caja` | `trg_cuadre_caja_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `cuadre_caja` | `trg_cuadre_caja_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `cuadre_caja` | `trg_cuadre_caja_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `demo_sessions` | `trg_demo_sessions_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `doc_number_blocks` | `trg_doc_blocks_upd` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `doc_number_master` | `trg_doc_master_upd` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `ecf_cert_history` | `ecf_cert_history_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION ecf_cert_history_set_updated_at() |  |
| `ecf_queue` | `trg_ecf_queue_touch` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `ecf_submissions` | `trg_ecf_submissions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `ecf_submissions` | `trg_ecf_submissions_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `empleados` | `trg_empleados_change_audit` | AFTER | UPDATE | EXECUTE FUNCTION trg_empleados_change_audit() |  |
| `empleados` | `trg_empleados_role_guard_on_update` | BEFORE | UPDATE | EXECUTE FUNCTION trg_empleados_role_guard() |  |
| `empleados` | `trg_empleados_role_to_staff` | AFTER | UPDATE | EXECUTE FUNCTION sync_role_empleados_to_staff() |  |
| `empleados` | `trg_empleados_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `empleados` | `trg_empleados_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `empleados` | `trg_empleados_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `food_truck_locations` | `trg_food_truck_locations_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `insurance_batches` | `insurance_batches_set_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_insurance_batches_set_updated_at() |  |
| `inventory_count_items` | `trg_icitems_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `inventory_count_items` | `trg_inventory_count_items_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `inventory_counts` | `trg_icounts_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `inventory_counts` | `trg_inventory_counts_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `inventory_discards` | `trg_inventory_discards_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `inventory_freshness_log` | `trg_inventory_freshness_log_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `inventory_items` | `trg_inventory_items_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `inventory_items` | `trg_inventory_items_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `inventory_items` | `trg_inventory_price_audit` | AFTER | UPDATE | EXECUTE FUNCTION trg_inventory_price_audit() |  |
| `inventory_items` | `trg_inventory_updated` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `inventory_oversells` | `trg_inventory_oversells_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `inventory_oversells` | `trg_oversells_upd` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `inventory_transactions` | `trg_inventory_transactions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `inventory_transactions` | `trg_inventory_transactions_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `inventory_transactions` | `trg_inventory_transactions_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `journal_entries` | `trg_journal_entries_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at_journal_entries() |  |
| `kds_events` | `trg_kds_events_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `kds_events` | `trg_kds_events_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `leads` | `trg_leads_updated` | BEFORE | UPDATE | EXECUTE FUNCTION touch_updated_at() |  |
| `loan_contracts` | `trg_loan_contracts_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `loan_payments` | `trg_loan_payments_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `loan_payments` | `trg_loan_payments_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `loan_renewals` | `trg_loan_renewals_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `loan_schedule` | `loan_schedule_touch` | BEFORE | UPDATE | EXECUTE FUNCTION tg_touch_updated_at() |  |
| `loan_schedule` | `trg_loan_schedule_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `loan_schedule` | `trg_loan_schedule_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `loans` | `trg_loans_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `loans` | `trg_loans_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `loyalty_transactions` | `trg_loyalty_transactions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `loyalty_transactions` | `trg_lt_updated` | BEFORE | UPDATE | EXECUTE FUNCTION tg_set_updated_at() |  |
| `marketing_leads` | `trg_marketing_leads_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `mechanic_commissions` | `mechanic_commissions_set_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_mechanic_commissions_set_updated_at() |  |
| `mechanic_commissions` | `trg_mechanic_comm_employment_window` | BEFORE | INSERT,UPDATE | EXECUTE FUNCTION guard_commission_employment_window() |  |
| `membership_redemptions` | `trg_membership_redemptions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `memberships` | `memberships_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `memberships` | `trg_memberships_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `mesas` | `trg_mesas_rev_guard` | BEFORE | UPDATE | EXECUTE FUNCTION trg_mesas_rev_guard() |  |
| `mesas` | `trg_mesas_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `mesas` | `trg_mesas_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `modificadores` | `trg_modificadores_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `modificadores` | `trg_modificadores_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `ncf_blocks` | `trg_ncf_blocks_upd` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `ncf_sequences` | `trg_ncf_sequences_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `ncf_sequences` | `trg_ncf_sequences_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `ncf_sequences` | `trg_ncf_sequences_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `ncf_sequences_master` | `trg_ncf_seq_master_upd` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `notas_credito` | `trg_notas_credito_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `notas_credito` | `trg_notas_credito_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `notas_credito` | `trg_notas_credito_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `oferta_items` | `trg_oferta_items_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `ofertas` | `trg_ofertas_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `parts_orders` | `parts_orders_set_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_parts_orders_set_updated_at() |  |
| `pawn_documents` | `trg_pawn_documents_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `pawn_items` | `trg_pawn_items_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `pawn_items` | `trg_pawn_items_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `pawn_listings` | `trg_pawn_listings_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `payroll_runs` | `trg_payroll_runs_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `payroll_runs` | `trg_payroll_runs_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `payroll_settings` | `trg_payroll_settings_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `projects` | `trg_projects_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `promotion_items` | `trg_promotion_items_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `promotions` | `trg_promotions_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `queue` | `trg_queue_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `queue` | `trg_queue_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `queue` | `trg_queue_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `queue_deletions` | `trg_queue_deletions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `queue_deletions` | `trg_queue_deletions_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `recurring_orders` | `trg_recurring_orders_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `restaurant_reservations` | `trg_restaurant_reservations_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `salary_changes` | `trg_salary_changes_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `salary_changes` | `trg_salary_changes_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `sales_deals` | `trg_sales_deals_updated` | BEFORE | UPDATE | EXECUTE FUNCTION touch_updated_at() |  |
| `seller_commissions` | `trg_seller_comm_employment_window` | BEFORE | INSERT,UPDATE | EXECUTE FUNCTION guard_commission_employment_window() |  |
| `seller_commissions` | `trg_seller_commissions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `seller_commissions` | `trg_seller_commissions_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `seller_commissions` | `trg_seller_commissions_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `service_bays` | `trg_service_bays_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `service_bays` | `trg_service_bays_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `service_modificadores` | `trg_service_modificadores_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `service_modificadores` | `trg_service_modificadores_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `service_packages` | `trg_service_packages_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `service_projects` | `trg_service_projects_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `service_recipe_items` | `trg_service_recipe_items_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `services` | `trg_services_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `services` | `trg_services_updated` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `services` | `trg_services_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `staff` | `staff_sync_user_metadata` | AFTER | INSERT,UPDATE | EXECUTE FUNCTION tg_staff_sync_user_metadata() |  |
| `staff` | `trg_staff_change_audit` | AFTER | UPDATE | EXECUTE FUNCTION trg_staff_change_audit() |  |
| `staff` | `trg_staff_last_owner_deactivate_guard` | BEFORE | UPDATE | EXECUTE FUNCTION trg_staff_last_owner_deactivate_guard() |  |
| `staff` | `trg_staff_last_owner_guard` | BEFORE | UPDATE | EXECUTE FUNCTION trg_staff_last_owner_guard() |  |
| `staff` | `trg_staff_pin_guard_on_update` | BEFORE | UPDATE | EXECUTE FUNCTION trg_staff_pin_guard() |  |
| `staff` | `trg_staff_role_guard_on_update` | BEFORE | UPDATE | EXECUTE FUNCTION trg_staff_role_guard() |  |
| `staff` | `trg_staff_role_to_empleados` | AFTER | UPDATE | EXECUTE FUNCTION sync_role_staff_to_empleados() |  |
| `staff` | `trg_staff_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `staff` | `trg_staff_updated` | BEFORE | UPDATE | EXECUTE FUNCTION update_updated_at() |  |
| `staff` | `trg_staff_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `stylist_schedules` | `trg_stylist_schedules_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `stylist_schedules` | `trg_stylist_schedules_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `subscriptions` | `trg_subscriptions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `suppliers` | `suppliers_set_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_suppliers_set_updated_at() |  |
| `test_drives` | `trg_test_drives_updated` | BEFORE | UPDATE | EXECUTE FUNCTION touch_updated_at() |  |
| `ticket_item_modificadores` | `trg_ticket_item_modificadores_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `ticket_item_modificadores` | `trg_ticket_item_modificadores_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `ticket_items` | `trg_ticket_items_decrement_inventory` | AFTER | INSERT | EXECUTE FUNCTION trg_ticket_item_decrement_inventory() |  |
| `ticket_items` | `trg_ticket_items_in_stock_guard` | BEFORE | INSERT | EXECUTE FUNCTION trg_ticket_items_in_stock_guard() |  |
| `ticket_items` | `trg_ticket_items_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `ticket_items` | `trg_ticket_items_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `ticket_items` | `trg_ticket_items_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `tickets` | `trg_ticket_payment_balance` | BEFORE | UPDATE,INSERT | EXECUTE FUNCTION trg_ticket_payment_balance() |  |
| `tickets` | `trg_tickets_complete_appointment` | AFTER | INSERT,UPDATE | EXECUTE FUNCTION trg_ticket_complete_appointment() |  |
| `tickets` | `trg_tickets_credit_balance` | AFTER | INSERT | EXECUTE FUNCTION trg_credit_ticket_bump_balance() |  |
| `tickets` | `trg_tickets_rev_guard` | BEFORE | UPDATE | EXECUTE FUNCTION trg_tickets_rev_guard() |  |
| `tickets` | `trg_tickets_stamp_cuadre` | BEFORE | INSERT | EXECUTE FUNCTION trg_tickets_stamp_cuadre() |  |
| `tickets` | `trg_tickets_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `tickets` | `trg_tickets_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `tickets` | `trg_tickets_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `vehicle_documents` | `vehicle_documents_set_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_vehicle_documents_set_updated_at() |  |
| `vehicle_inventory` | `trg_vehicle_inventory_updated` | BEFORE | UPDATE | EXECUTE FUNCTION touch_updated_at() |  |
| `vehicle_reservations` | `vehicle_reservations_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `vehicle_titulo` | `vehicle_titulo_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `vehicle_warranties` | `vehicle_warranties_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `vehicles` | `trg_vehicles_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `vehicles` | `trg_vehicles_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `wash_combos` | `trg_wash_combos_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `wash_combos` | `wash_combos_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `washer_commissions` | `trg_washer_comm_employment_window` | BEFORE | UPDATE,INSERT | EXECUTE FUNCTION guard_commission_employment_window() |  |
| `washer_commissions` | `trg_washer_commissions_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `washer_commissions` | `trg_washer_commissions_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `washer_commissions` | `trg_washer_commissions_updated_at_insert` | BEFORE | INSERT | EXECUTE FUNCTION trg_set_updated_at_insert() |  |
| `waste_log` | `trg_waste_log_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION set_updated_at() |  |
| `work_order_items` | `trg_work_order_items_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `work_order_items` | `trg_work_order_items_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |
| `work_order_photos` | `work_order_photos_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION _touch_updated_at() |  |
| `work_orders` | `trg_work_orders_touch_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_touch_updated_at() |  |
| `work_orders` | `trg_work_orders_updated_at` | BEFORE | UPDATE | EXECUTE FUNCTION trg_set_updated_at() |  |


## §5. Realtime Publication (`supabase_realtime`)

Query:

```sql
SELECT schemaname, tablename
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
  ORDER BY schemaname, tablename;
```

Total members: **25**

| schema | table |
|--------|-------|
| public | `caja_chica` |
| public | `cajero_commissions` |
| public | `categorias_servicio` |
| public | `clients` |
| public | `compras_607` |
| public | `credit_payments` |
| public | `cuadre_caja` |
| public | `empleados` |
| public | `inventory_items` |
| public | `inventory_transactions` |
| public | `journal_entries` |
| public | `kds_events` |
| public | `mesas` |
| public | `ncf_sequences` |
| public | `notas_credito` |
| public | `payroll_runs` |
| public | `queue` |
| public | `salary_changes` |
| public | `seller_commissions` |
| public | `services` |
| public | `staff` |
| public | `ticket_items` |
| public | `ticket_locks` |
| public | `tickets` |
| public | `washer_commissions` |


## §6. JWT Claim Contract

Every Terminal X RLS policy reads claims from `auth.jwt() -> 'app_metadata'` (the **2026-04-29 swap** killed all `user_metadata` reads — those would have been client-mutable).

The `mint-license-jwt` Edge Function MUST emit every key listed below in `app_metadata` or RLS will silently deny.

| claim key | # policies that read it |
|-----------|-------------------------|

_(Discovered automatically by regex against every `pg_policies.qual` and `with_check` blob.)_

### Canonical claim list (manual — kept in sync with mint-license-jwt)

- `business_id` — UUID of the business (primary tenant scope)
- `role` — owner | manager | cfo | accountant | cashier | kitchen | none
- `license_key` — TXL-XXXX-XXXX-XXXX
- `machine_id` — HWID (SHA256 of MAC + hostname)
- `provider` — license | staff_pin | web | demo


## §7. Known PostgREST / supabase-js Gotchas

These have all bitten Terminal X in production. Future readers — check this list BEFORE filing a "data is missing" or "insert is silent" bug.

1. **Partial unique indexes can NOT be on_conflict targets.** PostgREST rejects them with `there is no unique or exclusion constraint matching the ON CONFLICT specification`. ALWAYS use a real `UNIQUE CONSTRAINT` (`ALTER TABLE … ADD CONSTRAINT … UNIQUE (…)`), not `CREATE UNIQUE INDEX … WHERE …`. See §1 indexes — anything tagged **PARTIAL** above is read-only as an on_conflict target.

2. **`NULLS NOT DISTINCT` 3-column unique constraints require ALL 3 columns in `onConflict`.** Omitting one causes silent duplicate inserts. Example: `onConflict: 'business_id,supabase_id,deleted_at'` not just `business_id,supabase_id`.

3. **Empty string for date / timestamp columns = HTTP 400.** `{ created_at: '' }` will fail. Send `null` or omit the key entirely. Common offender: form inputs that emit `''` when blank.

4. **`.select().single()` after `.insert()` with RLS-restricted SELECT-back returns PGRST116 / 400 even though the row landed.** When the SELECT policy doesn't match the freshly-inserted row, the server returns 400 — not the row. Workaround: `.select().maybeSingle()` and tolerate `null` on success, OR re-fetch by id, OR add a SELECT policy that matches the insert path.

5. **supabase-js v2 default is `Prefer: return=minimal`.** `await sb.from('x').insert(row)` returns `{ data: null }`. You only get the row back if you chain `.select()`. Code that destructures `data.id` from a bare `.insert()` is always broken — it just hasn't crashed yet because the path was never exercised.

6. **`.or('col.is.null,col.not.like.X')` matches ALL rows for destructive ops** (PostgREST quirk). Never use `.or()` with `.delete()` / `.update()` for "everything except X" semantics. Pattern: `.select('id')` first, filter in JS, `.delete().in('id', ids)`.

7. **Supabase silently drops unknown columns on INSERT/UPDATE.** Adding a column to SQLite without a matching Supabase migration means the field travels through sync.js but vanishes server-side. Always: change sync.js → write Supabase migration → apply BEFORE shipping the desktop release.

8. **Web INSERT without `supabase_id` = invisible to desktop pull.** Every web.js mutation MUST set `supabase_id: crypto.randomUUID()`. Desktop's pull query filters on `supabase_id IS NOT NULL`.

9. **Service role bypasses RLS.** Sync runs under service_role, so policy bugs only surface for anon / authenticated roles (i.e. real users). Always validate policies with a JWT-bearing client, never with service_role.

10. **Realtime publication must include the table** (see §5). Adding a table without `ALTER PUBLICATION supabase_realtime ADD TABLE …` means `.channel().on('postgres_changes', …)` silently never fires.

11. **PostgREST schema cache is per-pod and stale until reload.** After a migration, run `scripts/reload-pgrst-schema.mjs` or call `NOTIFY pgrst, 'reload schema'`. Otherwise new columns 400 with "column does not exist" until the next pod restart.


---

## Snapshot Stats

- Tables: **159** (RLS-enabled: 159)
- Columns: **3110**
- Constraints: **790** (PK: 191, UNIQUE: 292, FK: 164, CHECK: 141)
- Indexes: **989** (partial: 144)
- Policies: **421** (`app_metadata`: 265, `user_metadata`: 0)
- Functions: **262**
- Triggers: **294**
- Realtime members: **25**

## Changelog

When re-running this script, append a brief entry below describing the diff. Use `--diff` to surface changes since the last snapshot.

| date | who | summary |
|------|-----|---------|
| 2026-05-19 | dataLEAKS | initial snapshot |
