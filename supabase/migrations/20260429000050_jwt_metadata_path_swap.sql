-- =====================================================================
-- Retroactive migration: JWT metadata path swap (user_metadata -> app_metadata)
-- =====================================================================
--
-- WHY THIS MIGRATION EXISTS
--   The earlier per-table RLS lockdown migrations (most notably
--   20260427000001_per_license_jwt_lockdown.sql and
--   20260427100002_staff_jwt_lockdown.sql, plus the per-feature lockdown
--   files that followed) hard-coded the JWT path
--       ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid
--   On 2026-04-29 every JWT-RLS policy in production was rewritten via the
--   Supabase Management API to read from 'app_metadata' instead, because
--   user_metadata is mutable by the end-user (auth.updateUser) and therefore
--   unsuitable as a tenancy claim. That hot-fix never landed as a migration.
--
-- AUTHORED RETROACTIVELY
--   Generated 2026-05-01 by selecting from pg_policies on the live prod DB
--   (project csppjsoirjflumaiipqw) every public.* policy whose qual or
--   with_check references app_metadata, and emitting an idempotent
--   DROP-then-CREATE for each. The qual / with_check expressions below are
--   exact pg_catalog renderings -- not hand-written approximations.
--
-- RELATIONSHIP TO PRIOR MIGRATIONS
--   The DROP POLICY IF EXISTS clauses target the legacy user_metadata
--   policies created by *_lockdown.sql (same policy names, different JWT
--   path). After this file runs, those legacy definitions are replaced by
--   the app_metadata variants currently live in production.
--
-- IDEMPOTENCY / PROD BEHAVIOUR
--   `supabase db push` against production is a NO-OP -- every CREATE POLICY
--   below is byte-for-byte identical to the policy already deployed (it was
--   generated FROM that policy). The value of this file is making
--   `supabase db reset` against a fresh shadow DB reproduce production.
--
-- COVERAGE
--   202 policies across 97 tables.
-- =====================================================================

BEGIN;


-- ---------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "activity_log_jwt_modify" ON "public"."activity_log";
CREATE POLICY "activity_log_jwt_modify" ON "public"."activity_log" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "activity_log_jwt_select" ON "public"."activity_log";
CREATE POLICY "activity_log_jwt_select" ON "public"."activity_log" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- activity_log_legacy_unpartitioned
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "activity_log_jwt_modify" ON "public"."activity_log_legacy_unpartitioned";
CREATE POLICY "activity_log_jwt_modify" ON "public"."activity_log_legacy_unpartitioned" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "activity_log_jwt_select" ON "public"."activity_log_legacy_unpartitioned";
CREATE POLICY "activity_log_jwt_select" ON "public"."activity_log_legacy_unpartitioned" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- adelantos
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "adelantos_jwt_modify" ON "public"."adelantos";
CREATE POLICY "adelantos_jwt_modify" ON "public"."adelantos" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "adelantos_jwt_select" ON "public"."adelantos";
CREATE POLICY "adelantos_jwt_select" ON "public"."adelantos" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- anecf_queue
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "anecf_queue_jwt_modify" ON "public"."anecf_queue";
CREATE POLICY "anecf_queue_jwt_modify" ON "public"."anecf_queue" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "anecf_queue_jwt_select" ON "public"."anecf_queue";
CREATE POLICY "anecf_queue_jwt_select" ON "public"."anecf_queue" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "app_settings_jwt_insert" ON "public"."app_settings";
CREATE POLICY "app_settings_jwt_insert" ON "public"."app_settings" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "app_settings_jwt_modify" ON "public"."app_settings";
CREATE POLICY "app_settings_jwt_modify" ON "public"."app_settings" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "app_settings_jwt_select" ON "public"."app_settings";
CREATE POLICY "app_settings_jwt_select" ON "public"."app_settings" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- appointment_reminders
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "appointment_reminders_jwt_modify" ON "public"."appointment_reminders";
CREATE POLICY "appointment_reminders_jwt_modify" ON "public"."appointment_reminders" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "appointment_reminders_jwt_select" ON "public"."appointment_reminders";
CREATE POLICY "appointment_reminders_jwt_select" ON "public"."appointment_reminders" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "appointments_jwt_modify" ON "public"."appointments";
CREATE POLICY "appointments_jwt_modify" ON "public"."appointments" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "appointments_jwt_select" ON "public"."appointments";
CREATE POLICY "appointments_jwt_select" ON "public"."appointments" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- aseguradoras
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "aseguradoras_jwt_modify" ON "public"."aseguradoras";
CREATE POLICY "aseguradoras_jwt_modify" ON "public"."aseguradoras" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "aseguradoras_jwt_select" ON "public"."aseguradoras";
CREATE POLICY "aseguradoras_jwt_select" ON "public"."aseguradoras" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- bank_preapprovals
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "bank_preapprovals_jwt_modify" ON "public"."bank_preapprovals";
CREATE POLICY "bank_preapprovals_jwt_modify" ON "public"."bank_preapprovals" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "bank_preapprovals_jwt_select" ON "public"."bank_preapprovals";
CREATE POLICY "bank_preapprovals_jwt_select" ON "public"."bank_preapprovals" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- caja_chica
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "caja_chica_jwt_modify" ON "public"."caja_chica";
CREATE POLICY "caja_chica_jwt_modify" ON "public"."caja_chica" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "caja_chica_jwt_select" ON "public"."caja_chica";
CREATE POLICY "caja_chica_jwt_select" ON "public"."caja_chica" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- cajero_commissions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "cajero_commissions_jwt_modify" ON "public"."cajero_commissions";
CREATE POLICY "cajero_commissions_jwt_modify" ON "public"."cajero_commissions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "cajero_commissions_jwt_select" ON "public"."cajero_commissions";
CREATE POLICY "cajero_commissions_jwt_select" ON "public"."cajero_commissions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- carniceria_corte_categories
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "carniceria_corte_categories_jwt_modify" ON "public"."carniceria_corte_categories";
CREATE POLICY "carniceria_corte_categories_jwt_modify" ON "public"."carniceria_corte_categories" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "carniceria_corte_categories_jwt_select" ON "public"."carniceria_corte_categories";
CREATE POLICY "carniceria_corte_categories_jwt_select" ON "public"."carniceria_corte_categories" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- carniceria_scales
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "carniceria_scales_jwt_modify" ON "public"."carniceria_scales";
CREATE POLICY "carniceria_scales_jwt_modify" ON "public"."carniceria_scales" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "carniceria_scales_jwt_select" ON "public"."carniceria_scales";
CREATE POLICY "carniceria_scales_jwt_select" ON "public"."carniceria_scales" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- categorias_servicio
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "categorias_servicio_jwt_modify" ON "public"."categorias_servicio";
CREATE POLICY "categorias_servicio_jwt_modify" ON "public"."categorias_servicio" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "categorias_servicio_jwt_select" ON "public"."categorias_servicio";
CREATE POLICY "categorias_servicio_jwt_select" ON "public"."categorias_servicio" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- client_item_prices
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "client_item_prices_jwt_modify" ON "public"."client_item_prices";
CREATE POLICY "client_item_prices_jwt_modify" ON "public"."client_item_prices" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "client_item_prices_jwt_select" ON "public"."client_item_prices";
CREATE POLICY "client_item_prices_jwt_select" ON "public"."client_item_prices" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- client_memberships
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "client_memberships_jwt_modify" ON "public"."client_memberships";
CREATE POLICY "client_memberships_jwt_modify" ON "public"."client_memberships" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "client_memberships_jwt_select" ON "public"."client_memberships";
CREATE POLICY "client_memberships_jwt_select" ON "public"."client_memberships" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- client_service_rates
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "client_service_rates_jwt_modify" ON "public"."client_service_rates";
CREATE POLICY "client_service_rates_jwt_modify" ON "public"."client_service_rates" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "client_service_rates_jwt_select" ON "public"."client_service_rates";
CREATE POLICY "client_service_rates_jwt_select" ON "public"."client_service_rates" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "clients_jwt_modify" ON "public"."clients";
CREATE POLICY "clients_jwt_modify" ON "public"."clients" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "clients_jwt_select" ON "public"."clients";
CREATE POLICY "clients_jwt_select" ON "public"."clients" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- collections_attempts
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "collections_attempts_jwt_modify" ON "public"."collections_attempts";
CREATE POLICY "collections_attempts_jwt_modify" ON "public"."collections_attempts" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "collections_attempts_jwt_select" ON "public"."collections_attempts";
CREATE POLICY "collections_attempts_jwt_select" ON "public"."collections_attempts" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- collections_log
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "collections_log_jwt_modify" ON "public"."collections_log";
CREATE POLICY "collections_log_jwt_modify" ON "public"."collections_log" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "collections_log_jwt_select" ON "public"."collections_log";
CREATE POLICY "collections_log_jwt_select" ON "public"."collections_log" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- compras_607
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "compras_607_jwt_modify" ON "public"."compras_607";
CREATE POLICY "compras_607_jwt_modify" ON "public"."compras_607" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "compras_607_jwt_select" ON "public"."compras_607";
CREATE POLICY "compras_607_jwt_select" ON "public"."compras_607" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- configuracion
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "configuracion_jwt_modify" ON "public"."configuracion";
CREATE POLICY "configuracion_jwt_modify" ON "public"."configuracion" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "configuracion_jwt_select" ON "public"."configuracion";
CREATE POLICY "configuracion_jwt_select" ON "public"."configuracion" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- credit_payments
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "credit_payments_jwt_modify" ON "public"."credit_payments";
CREATE POLICY "credit_payments_jwt_modify" ON "public"."credit_payments" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "credit_payments_jwt_select" ON "public"."credit_payments";
CREATE POLICY "credit_payments_jwt_select" ON "public"."credit_payments" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- cuadre_caja
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "cuadre_caja_jwt_insert" ON "public"."cuadre_caja";
CREATE POLICY "cuadre_caja_jwt_insert" ON "public"."cuadre_caja" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "cuadre_caja_jwt_modify" ON "public"."cuadre_caja";
CREATE POLICY "cuadre_caja_jwt_modify" ON "public"."cuadre_caja" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "cuadre_caja_jwt_select" ON "public"."cuadre_caja";
CREATE POLICY "cuadre_caja_jwt_select" ON "public"."cuadre_caja" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- doc_number_blocks
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "doc_number_blocks_jwt_modify" ON "public"."doc_number_blocks";
CREATE POLICY "doc_number_blocks_jwt_modify" ON "public"."doc_number_blocks" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "doc_number_blocks_jwt_select" ON "public"."doc_number_blocks";
CREATE POLICY "doc_number_blocks_jwt_select" ON "public"."doc_number_blocks" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- doc_number_master
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "doc_number_master_jwt_modify" ON "public"."doc_number_master";
CREATE POLICY "doc_number_master_jwt_modify" ON "public"."doc_number_master" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "doc_number_master_jwt_select" ON "public"."doc_number_master";
CREATE POLICY "doc_number_master_jwt_select" ON "public"."doc_number_master" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- ecf_cert_history
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ecf_cert_history_jwt_insert" ON "public"."ecf_cert_history";
CREATE POLICY "ecf_cert_history_jwt_insert" ON "public"."ecf_cert_history" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ecf_cert_history_jwt_modify" ON "public"."ecf_cert_history";
CREATE POLICY "ecf_cert_history_jwt_modify" ON "public"."ecf_cert_history" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ecf_cert_history_jwt_select" ON "public"."ecf_cert_history";
CREATE POLICY "ecf_cert_history_jwt_select" ON "public"."ecf_cert_history" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- ecf_queue
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ecf_queue_jwt_insert" ON "public"."ecf_queue";
CREATE POLICY "ecf_queue_jwt_insert" ON "public"."ecf_queue" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ecf_queue_jwt_modify" ON "public"."ecf_queue";
CREATE POLICY "ecf_queue_jwt_modify" ON "public"."ecf_queue" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ecf_queue_jwt_select" ON "public"."ecf_queue";
CREATE POLICY "ecf_queue_jwt_select" ON "public"."ecf_queue" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- ecf_submissions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ecf_submissions_jwt_modify" ON "public"."ecf_submissions";
CREATE POLICY "ecf_submissions_jwt_modify" ON "public"."ecf_submissions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ecf_submissions_jwt_select" ON "public"."ecf_submissions";
CREATE POLICY "ecf_submissions_jwt_select" ON "public"."ecf_submissions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- empleados
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "empleados_jwt_insert" ON "public"."empleados";
CREATE POLICY "empleados_jwt_insert" ON "public"."empleados" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "empleados_jwt_modify" ON "public"."empleados";
CREATE POLICY "empleados_jwt_modify" ON "public"."empleados" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "empleados_jwt_select" ON "public"."empleados";
CREATE POLICY "empleados_jwt_select" ON "public"."empleados" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- insurance_batches
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "insurance_batches_jwt_insert" ON "public"."insurance_batches";
CREATE POLICY "insurance_batches_jwt_insert" ON "public"."insurance_batches" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "insurance_batches_jwt_modify" ON "public"."insurance_batches";
CREATE POLICY "insurance_batches_jwt_modify" ON "public"."insurance_batches" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "insurance_batches_jwt_select" ON "public"."insurance_batches";
CREATE POLICY "insurance_batches_jwt_select" ON "public"."insurance_batches" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- inventory_count_items
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "inventory_count_items_jwt_modify" ON "public"."inventory_count_items";
CREATE POLICY "inventory_count_items_jwt_modify" ON "public"."inventory_count_items" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_count_items_jwt_select" ON "public"."inventory_count_items";
CREATE POLICY "inventory_count_items_jwt_select" ON "public"."inventory_count_items" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- inventory_counts
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "inventory_counts_jwt_modify" ON "public"."inventory_counts";
CREATE POLICY "inventory_counts_jwt_modify" ON "public"."inventory_counts" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_counts_jwt_select" ON "public"."inventory_counts";
CREATE POLICY "inventory_counts_jwt_select" ON "public"."inventory_counts" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- inventory_discards
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "inventory_discards_jwt_modify" ON "public"."inventory_discards";
CREATE POLICY "inventory_discards_jwt_modify" ON "public"."inventory_discards" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_discards_jwt_select" ON "public"."inventory_discards";
CREATE POLICY "inventory_discards_jwt_select" ON "public"."inventory_discards" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- inventory_freshness_log
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "inventory_freshness_log_jwt_modify" ON "public"."inventory_freshness_log";
CREATE POLICY "inventory_freshness_log_jwt_modify" ON "public"."inventory_freshness_log" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_freshness_log_jwt_select" ON "public"."inventory_freshness_log";
CREATE POLICY "inventory_freshness_log_jwt_select" ON "public"."inventory_freshness_log" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- inventory_items
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "inventory_items_jwt_insert" ON "public"."inventory_items";
CREATE POLICY "inventory_items_jwt_insert" ON "public"."inventory_items" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_items_jwt_modify" ON "public"."inventory_items";
CREATE POLICY "inventory_items_jwt_modify" ON "public"."inventory_items" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_items_jwt_select" ON "public"."inventory_items";
CREATE POLICY "inventory_items_jwt_select" ON "public"."inventory_items" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- inventory_oversells
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "inventory_oversells_jwt_modify" ON "public"."inventory_oversells";
CREATE POLICY "inventory_oversells_jwt_modify" ON "public"."inventory_oversells" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_oversells_jwt_select" ON "public"."inventory_oversells";
CREATE POLICY "inventory_oversells_jwt_select" ON "public"."inventory_oversells" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- inventory_transactions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "inventory_transactions_jwt_insert" ON "public"."inventory_transactions";
CREATE POLICY "inventory_transactions_jwt_insert" ON "public"."inventory_transactions" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_transactions_jwt_modify" ON "public"."inventory_transactions";
CREATE POLICY "inventory_transactions_jwt_modify" ON "public"."inventory_transactions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "inventory_transactions_jwt_select" ON "public"."inventory_transactions";
CREATE POLICY "inventory_transactions_jwt_select" ON "public"."inventory_transactions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- kds_events
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "kds_events_jwt_insert" ON "public"."kds_events";
CREATE POLICY "kds_events_jwt_insert" ON "public"."kds_events" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "kds_events_jwt_modify" ON "public"."kds_events";
CREATE POLICY "kds_events_jwt_modify" ON "public"."kds_events" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "kds_events_jwt_select" ON "public"."kds_events";
CREATE POLICY "kds_events_jwt_select" ON "public"."kds_events" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "leads_jwt_modify" ON "public"."leads";
CREATE POLICY "leads_jwt_modify" ON "public"."leads" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "leads_jwt_select" ON "public"."leads";
CREATE POLICY "leads_jwt_select" ON "public"."leads" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- loan_contracts
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "loan_contracts_jwt_modify" ON "public"."loan_contracts";
CREATE POLICY "loan_contracts_jwt_modify" ON "public"."loan_contracts" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "loan_contracts_jwt_select" ON "public"."loan_contracts";
CREATE POLICY "loan_contracts_jwt_select" ON "public"."loan_contracts" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- loan_payments
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "loan_payments_jwt_modify" ON "public"."loan_payments";
CREATE POLICY "loan_payments_jwt_modify" ON "public"."loan_payments" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "loan_payments_jwt_select" ON "public"."loan_payments";
CREATE POLICY "loan_payments_jwt_select" ON "public"."loan_payments" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- loan_renewals
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "loan_renewals_jwt_modify" ON "public"."loan_renewals";
CREATE POLICY "loan_renewals_jwt_modify" ON "public"."loan_renewals" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "loan_renewals_jwt_select" ON "public"."loan_renewals";
CREATE POLICY "loan_renewals_jwt_select" ON "public"."loan_renewals" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- loan_schedule
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "loan_schedule_jwt_modify" ON "public"."loan_schedule";
CREATE POLICY "loan_schedule_jwt_modify" ON "public"."loan_schedule" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "loan_schedule_jwt_select" ON "public"."loan_schedule";
CREATE POLICY "loan_schedule_jwt_select" ON "public"."loan_schedule" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- loans
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "loans_jwt_modify" ON "public"."loans";
CREATE POLICY "loans_jwt_modify" ON "public"."loans" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "loans_jwt_select" ON "public"."loans";
CREATE POLICY "loans_jwt_select" ON "public"."loans" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- loyalty_transactions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "loyalty_transactions_jwt_modify" ON "public"."loyalty_transactions";
CREATE POLICY "loyalty_transactions_jwt_modify" ON "public"."loyalty_transactions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "loyalty_transactions_jwt_select" ON "public"."loyalty_transactions";
CREATE POLICY "loyalty_transactions_jwt_select" ON "public"."loyalty_transactions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- mechanic_commissions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "mechanic_commissions_jwt_modify" ON "public"."mechanic_commissions";
CREATE POLICY "mechanic_commissions_jwt_modify" ON "public"."mechanic_commissions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "mechanic_commissions_jwt_select" ON "public"."mechanic_commissions";
CREATE POLICY "mechanic_commissions_jwt_select" ON "public"."mechanic_commissions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- membership_redemptions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "membership_redemptions_jwt_modify" ON "public"."membership_redemptions";
CREATE POLICY "membership_redemptions_jwt_modify" ON "public"."membership_redemptions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "membership_redemptions_jwt_select" ON "public"."membership_redemptions";
CREATE POLICY "membership_redemptions_jwt_select" ON "public"."membership_redemptions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "memberships_jwt_modify" ON "public"."memberships";
CREATE POLICY "memberships_jwt_modify" ON "public"."memberships" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "memberships_jwt_select" ON "public"."memberships";
CREATE POLICY "memberships_jwt_select" ON "public"."memberships" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- mesas
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "mesas_jwt_modify" ON "public"."mesas";
CREATE POLICY "mesas_jwt_modify" ON "public"."mesas" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "mesas_jwt_select" ON "public"."mesas";
CREATE POLICY "mesas_jwt_select" ON "public"."mesas" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- modificadores
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "modificadores_jwt_modify" ON "public"."modificadores";
CREATE POLICY "modificadores_jwt_modify" ON "public"."modificadores" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "modificadores_jwt_select" ON "public"."modificadores";
CREATE POLICY "modificadores_jwt_select" ON "public"."modificadores" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- modifier_groups
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "modifier_groups_jwt_modify" ON "public"."modifier_groups";
CREATE POLICY "modifier_groups_jwt_modify" ON "public"."modifier_groups" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "modifier_groups_jwt_select" ON "public"."modifier_groups";
CREATE POLICY "modifier_groups_jwt_select" ON "public"."modifier_groups" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- ncf_blocks
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ncf_blocks_jwt_modify" ON "public"."ncf_blocks";
CREATE POLICY "ncf_blocks_jwt_modify" ON "public"."ncf_blocks" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ncf_blocks_jwt_select" ON "public"."ncf_blocks";
CREATE POLICY "ncf_blocks_jwt_select" ON "public"."ncf_blocks" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- ncf_sequences
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ncf_sequences_jwt_modify" ON "public"."ncf_sequences";
CREATE POLICY "ncf_sequences_jwt_modify" ON "public"."ncf_sequences" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ncf_sequences_jwt_select" ON "public"."ncf_sequences";
CREATE POLICY "ncf_sequences_jwt_select" ON "public"."ncf_sequences" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- ncf_sequences_master
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ncf_sequences_master_jwt_modify" ON "public"."ncf_sequences_master";
CREATE POLICY "ncf_sequences_master_jwt_modify" ON "public"."ncf_sequences_master" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ncf_sequences_master_jwt_select" ON "public"."ncf_sequences_master";
CREATE POLICY "ncf_sequences_master_jwt_select" ON "public"."ncf_sequences_master" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- notas_credito
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "notas_credito_jwt_modify" ON "public"."notas_credito";
CREATE POLICY "notas_credito_jwt_modify" ON "public"."notas_credito" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "notas_credito_jwt_select" ON "public"."notas_credito";
CREATE POLICY "notas_credito_jwt_select" ON "public"."notas_credito" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- parts_orders
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "parts_orders_jwt_modify" ON "public"."parts_orders";
CREATE POLICY "parts_orders_jwt_modify" ON "public"."parts_orders" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "parts_orders_jwt_select" ON "public"."parts_orders";
CREATE POLICY "parts_orders_jwt_select" ON "public"."parts_orders" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- pawn_documents
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "pawn_documents_jwt_modify" ON "public"."pawn_documents";
CREATE POLICY "pawn_documents_jwt_modify" ON "public"."pawn_documents" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "pawn_documents_jwt_select" ON "public"."pawn_documents";
CREATE POLICY "pawn_documents_jwt_select" ON "public"."pawn_documents" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- pawn_items
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "pawn_items_jwt_modify" ON "public"."pawn_items";
CREATE POLICY "pawn_items_jwt_modify" ON "public"."pawn_items" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "pawn_items_jwt_select" ON "public"."pawn_items";
CREATE POLICY "pawn_items_jwt_select" ON "public"."pawn_items" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- pawn_listings
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "pawn_listings_jwt_modify" ON "public"."pawn_listings";
CREATE POLICY "pawn_listings_jwt_modify" ON "public"."pawn_listings" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "pawn_listings_jwt_select" ON "public"."pawn_listings";
CREATE POLICY "pawn_listings_jwt_select" ON "public"."pawn_listings" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- payroll_runs
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "payroll_runs_jwt_modify" ON "public"."payroll_runs";
CREATE POLICY "payroll_runs_jwt_modify" ON "public"."payroll_runs" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "payroll_runs_jwt_select" ON "public"."payroll_runs";
CREATE POLICY "payroll_runs_jwt_select" ON "public"."payroll_runs" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- payroll_settings
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "payroll_settings_jwt_modify" ON "public"."payroll_settings";
CREATE POLICY "payroll_settings_jwt_modify" ON "public"."payroll_settings" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "payroll_settings_jwt_select" ON "public"."payroll_settings";
CREATE POLICY "payroll_settings_jwt_select" ON "public"."payroll_settings" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "projects_jwt_modify" ON "public"."projects";
CREATE POLICY "projects_jwt_modify" ON "public"."projects" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "projects_jwt_select" ON "public"."projects";
CREATE POLICY "projects_jwt_select" ON "public"."projects" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- promotion_items
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "promotion_items_jwt_modify" ON "public"."promotion_items";
CREATE POLICY "promotion_items_jwt_modify" ON "public"."promotion_items" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "promotion_items_jwt_select" ON "public"."promotion_items";
CREATE POLICY "promotion_items_jwt_select" ON "public"."promotion_items" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- promotions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "promotions_jwt_modify" ON "public"."promotions";
CREATE POLICY "promotions_jwt_modify" ON "public"."promotions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "promotions_jwt_select" ON "public"."promotions";
CREATE POLICY "promotions_jwt_select" ON "public"."promotions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- queue
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "queue_jwt_modify" ON "public"."queue";
CREATE POLICY "queue_jwt_modify" ON "public"."queue" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "queue_jwt_select" ON "public"."queue";
CREATE POLICY "queue_jwt_select" ON "public"."queue" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- queue_deletions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "queue_deletions_jwt_modify" ON "public"."queue_deletions";
CREATE POLICY "queue_deletions_jwt_modify" ON "public"."queue_deletions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "queue_deletions_jwt_select" ON "public"."queue_deletions";
CREATE POLICY "queue_deletions_jwt_select" ON "public"."queue_deletions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- recurring_orders
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "recurring_orders_jwt_modify" ON "public"."recurring_orders";
CREATE POLICY "recurring_orders_jwt_modify" ON "public"."recurring_orders" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "recurring_orders_jwt_select" ON "public"."recurring_orders";
CREATE POLICY "recurring_orders_jwt_select" ON "public"."recurring_orders" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- restaurant_reservations
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "restaurant_reservations_jwt_modify" ON "public"."restaurant_reservations";
CREATE POLICY "restaurant_reservations_jwt_modify" ON "public"."restaurant_reservations" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));

-- ---------------------------------------------------------------------
-- salary_changes
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "salary_changes_jwt_modify" ON "public"."salary_changes";
CREATE POLICY "salary_changes_jwt_modify" ON "public"."salary_changes" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "salary_changes_jwt_select" ON "public"."salary_changes";
CREATE POLICY "salary_changes_jwt_select" ON "public"."salary_changes" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- sales_deals
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "sales_deals_jwt_modify" ON "public"."sales_deals";
CREATE POLICY "sales_deals_jwt_modify" ON "public"."sales_deals" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "sales_deals_jwt_select" ON "public"."sales_deals";
CREATE POLICY "sales_deals_jwt_select" ON "public"."sales_deals" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- seller_commissions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "seller_commissions_jwt_modify" ON "public"."seller_commissions";
CREATE POLICY "seller_commissions_jwt_modify" ON "public"."seller_commissions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "seller_commissions_jwt_select" ON "public"."seller_commissions";
CREATE POLICY "seller_commissions_jwt_select" ON "public"."seller_commissions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- service_bays
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "service_bays_jwt_modify" ON "public"."service_bays";
CREATE POLICY "service_bays_jwt_modify" ON "public"."service_bays" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "service_bays_jwt_select" ON "public"."service_bays";
CREATE POLICY "service_bays_jwt_select" ON "public"."service_bays" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- service_modificadores
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "service_modificadores_jwt_modify" ON "public"."service_modificadores";
CREATE POLICY "service_modificadores_jwt_modify" ON "public"."service_modificadores" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "service_modificadores_jwt_select" ON "public"."service_modificadores";
CREATE POLICY "service_modificadores_jwt_select" ON "public"."service_modificadores" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- service_packages
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "service_packages_jwt_modify" ON "public"."service_packages";
CREATE POLICY "service_packages_jwt_modify" ON "public"."service_packages" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "service_packages_jwt_select" ON "public"."service_packages";
CREATE POLICY "service_packages_jwt_select" ON "public"."service_packages" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- service_projects
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "service_projects_jwt_modify" ON "public"."service_projects";
CREATE POLICY "service_projects_jwt_modify" ON "public"."service_projects" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "service_projects_jwt_select" ON "public"."service_projects";
CREATE POLICY "service_projects_jwt_select" ON "public"."service_projects" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- service_recipe_items
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "service_recipe_items_jwt_modify" ON "public"."service_recipe_items";
CREATE POLICY "service_recipe_items_jwt_modify" ON "public"."service_recipe_items" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));

-- ---------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "services_jwt_modify" ON "public"."services";
CREATE POLICY "services_jwt_modify" ON "public"."services" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "services_jwt_select" ON "public"."services";
CREATE POLICY "services_jwt_select" ON "public"."services" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_jwt_modify" ON "public"."staff";
CREATE POLICY "staff_jwt_modify" ON "public"."staff" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "staff_jwt_select" ON "public"."staff";
CREATE POLICY "staff_jwt_select" ON "public"."staff" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- stylist_schedules
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "stylist_schedules_jwt_modify" ON "public"."stylist_schedules";
CREATE POLICY "stylist_schedules_jwt_modify" ON "public"."stylist_schedules" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "stylist_schedules_jwt_select" ON "public"."stylist_schedules";
CREATE POLICY "stylist_schedules_jwt_select" ON "public"."stylist_schedules" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "subscriptions_jwt_modify" ON "public"."subscriptions";
CREATE POLICY "subscriptions_jwt_modify" ON "public"."subscriptions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "subscriptions_jwt_select" ON "public"."subscriptions";
CREATE POLICY "subscriptions_jwt_select" ON "public"."subscriptions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "suppliers_jwt_modify" ON "public"."suppliers";
CREATE POLICY "suppliers_jwt_modify" ON "public"."suppliers" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "suppliers_jwt_select" ON "public"."suppliers";
CREATE POLICY "suppliers_jwt_select" ON "public"."suppliers" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- test_drives
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "test_drives_jwt_modify" ON "public"."test_drives";
CREATE POLICY "test_drives_jwt_modify" ON "public"."test_drives" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "test_drives_jwt_select" ON "public"."test_drives";
CREATE POLICY "test_drives_jwt_select" ON "public"."test_drives" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- ticket_item_modificadores
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ticket_item_modificadores_jwt_modify" ON "public"."ticket_item_modificadores";
CREATE POLICY "ticket_item_modificadores_jwt_modify" ON "public"."ticket_item_modificadores" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ticket_item_modificadores_jwt_select" ON "public"."ticket_item_modificadores";
CREATE POLICY "ticket_item_modificadores_jwt_select" ON "public"."ticket_item_modificadores" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- ticket_items
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ticket_items_jwt_modify" ON "public"."ticket_items";
CREATE POLICY "ticket_items_jwt_modify" ON "public"."ticket_items" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "ticket_items_jwt_select" ON "public"."ticket_items";
CREATE POLICY "ticket_items_jwt_select" ON "public"."ticket_items" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- tickets
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "tickets_jwt_insert" ON "public"."tickets";
CREATE POLICY "tickets_jwt_insert" ON "public"."tickets" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "tickets_jwt_modify" ON "public"."tickets";
CREATE POLICY "tickets_jwt_modify" ON "public"."tickets" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "tickets_jwt_select" ON "public"."tickets";
CREATE POLICY "tickets_jwt_select" ON "public"."tickets" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- vehicle_documents
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "vehicle_documents_jwt_modify" ON "public"."vehicle_documents";
CREATE POLICY "vehicle_documents_jwt_modify" ON "public"."vehicle_documents" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "vehicle_documents_jwt_select" ON "public"."vehicle_documents";
CREATE POLICY "vehicle_documents_jwt_select" ON "public"."vehicle_documents" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- vehicle_inventory
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "vehicle_inventory_jwt_modify" ON "public"."vehicle_inventory";
CREATE POLICY "vehicle_inventory_jwt_modify" ON "public"."vehicle_inventory" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "vehicle_inventory_jwt_select" ON "public"."vehicle_inventory";
CREATE POLICY "vehicle_inventory_jwt_select" ON "public"."vehicle_inventory" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- vehicle_reservations
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "vehicle_reservations_jwt_modify" ON "public"."vehicle_reservations";
CREATE POLICY "vehicle_reservations_jwt_modify" ON "public"."vehicle_reservations" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "vehicle_reservations_jwt_select" ON "public"."vehicle_reservations";
CREATE POLICY "vehicle_reservations_jwt_select" ON "public"."vehicle_reservations" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- vehicle_titulo
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "vehicle_titulo_jwt_modify" ON "public"."vehicle_titulo";
CREATE POLICY "vehicle_titulo_jwt_modify" ON "public"."vehicle_titulo" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "vehicle_titulo_jwt_select" ON "public"."vehicle_titulo";
CREATE POLICY "vehicle_titulo_jwt_select" ON "public"."vehicle_titulo" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- vehicle_warranties
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "vehicle_warranties_jwt_modify" ON "public"."vehicle_warranties";
CREATE POLICY "vehicle_warranties_jwt_modify" ON "public"."vehicle_warranties" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "vehicle_warranties_jwt_select" ON "public"."vehicle_warranties";
CREATE POLICY "vehicle_warranties_jwt_select" ON "public"."vehicle_warranties" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "vehicles_jwt_modify" ON "public"."vehicles";
CREATE POLICY "vehicles_jwt_modify" ON "public"."vehicles" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "vehicles_jwt_select" ON "public"."vehicles";
CREATE POLICY "vehicles_jwt_select" ON "public"."vehicles" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- wash_combos
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "wash_combos_jwt_modify" ON "public"."wash_combos";
CREATE POLICY "wash_combos_jwt_modify" ON "public"."wash_combos" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "wash_combos_jwt_select" ON "public"."wash_combos";
CREATE POLICY "wash_combos_jwt_select" ON "public"."wash_combos" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- washer_commissions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "washer_commissions_jwt_modify" ON "public"."washer_commissions";
CREATE POLICY "washer_commissions_jwt_modify" ON "public"."washer_commissions" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "washer_commissions_jwt_select" ON "public"."washer_commissions";
CREATE POLICY "washer_commissions_jwt_select" ON "public"."washer_commissions" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- work_order_items
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "work_order_items_jwt_modify" ON "public"."work_order_items";
CREATE POLICY "work_order_items_jwt_modify" ON "public"."work_order_items" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "work_order_items_jwt_select" ON "public"."work_order_items";
CREATE POLICY "work_order_items_jwt_select" ON "public"."work_order_items" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- work_order_photos
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "work_order_photos_jwt_modify" ON "public"."work_order_photos";
CREATE POLICY "work_order_photos_jwt_modify" ON "public"."work_order_photos" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "work_order_photos_jwt_select" ON "public"."work_order_photos";
CREATE POLICY "work_order_photos_jwt_select" ON "public"."work_order_photos" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

-- ---------------------------------------------------------------------
-- work_orders
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "work_orders_jwt_modify" ON "public"."work_orders";
CREATE POLICY "work_orders_jwt_modify" ON "public"."work_orders" AS PERMISSIVE FOR ALL TO anon, authenticated
  USING ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid))
  WITH CHECK ((business_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))::uuid));
DROP POLICY IF EXISTS "work_orders_jwt_select" ON "public"."work_orders";
CREATE POLICY "work_orders_jwt_select" ON "public"."work_orders" AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((business_id = (NULLIF(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text), ''::text))::uuid) OR (business_id IN ( SELECT my_business_ids() AS my_business_ids))));

COMMIT;
