-- =============================================================
-- Sprint 5 RLS hardening — 2026-04-19
-- Drops 123 permissive anon policies (SELECT/UPDATE/DELETE/ALL) with `business_id IS NOT NULL`
-- Replaces 6 ecf_cert_* USING(true) policies with admin_users scoping
-- Enables RLS on modifier_groups + installs my_business_ids() policies
-- =============================================================

-- 1. Drop permissive anon policies
DROP POLICY IF EXISTS "activity_log_anon_select" ON public.activity_log;
DROP POLICY IF EXISTS "activity_log_anon_update" ON public.activity_log;
DROP POLICY IF EXISTS "adelantos_anon_all" ON public.adelantos;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.app_settings;
DROP POLICY IF EXISTS "rls_anon_select" ON public.app_settings;
DROP POLICY IF EXISTS "rls_anon_update" ON public.app_settings;
DROP POLICY IF EXISTS "appointments_anon_all" ON public.appointments;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.caja_chica;
DROP POLICY IF EXISTS "rls_anon_select" ON public.caja_chica;
DROP POLICY IF EXISTS "rls_anon_update" ON public.caja_chica;
DROP POLICY IF EXISTS "cajero_commissions_biz_delete" ON public.cajero_commissions;
DROP POLICY IF EXISTS "cajero_commissions_biz_read" ON public.cajero_commissions;
DROP POLICY IF EXISTS "cajero_commissions_biz_update" ON public.cajero_commissions;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.categorias_servicio;
DROP POLICY IF EXISTS "rls_anon_select" ON public.categorias_servicio;
DROP POLICY IF EXISTS "rls_anon_update" ON public.categorias_servicio;
DROP POLICY IF EXISTS "cip_anon_delete" ON public.client_item_prices;
DROP POLICY IF EXISTS "cip_anon_select" ON public.client_item_prices;
DROP POLICY IF EXISTS "cip_anon_update" ON public.client_item_prices;
DROP POLICY IF EXISTS "csr_anon_all" ON public.client_service_rates;
DROP POLICY IF EXISTS "csr_auth_all" ON public.client_service_rates;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.clients;
DROP POLICY IF EXISTS "rls_anon_select" ON public.clients;
DROP POLICY IF EXISTS "rls_anon_update" ON public.clients;
DROP POLICY IF EXISTS "collections_log_anon_rw" ON public.collections_log;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.compras_607;
DROP POLICY IF EXISTS "rls_anon_select" ON public.compras_607;
DROP POLICY IF EXISTS "rls_anon_update" ON public.compras_607;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.configuracion;
DROP POLICY IF EXISTS "rls_anon_select" ON public.configuracion;
DROP POLICY IF EXISTS "rls_anon_update" ON public.configuracion;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.credit_payments;
DROP POLICY IF EXISTS "rls_anon_select" ON public.credit_payments;
DROP POLICY IF EXISTS "rls_anon_update" ON public.credit_payments;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.cuadre_caja;
DROP POLICY IF EXISTS "rls_anon_select" ON public.cuadre_caja;
DROP POLICY IF EXISTS "rls_anon_update" ON public.cuadre_caja;
DROP POLICY IF EXISTS "doc_blocks_anon_rw" ON public.doc_number_blocks;
DROP POLICY IF EXISTS "doc_master_anon_rw" ON public.doc_number_master;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.ecf_queue;
DROP POLICY IF EXISTS "rls_anon_select" ON public.ecf_queue;
DROP POLICY IF EXISTS "rls_anon_update" ON public.ecf_queue;
DROP POLICY IF EXISTS "ecf_submissions_anon_all" ON public.ecf_submissions;
DROP POLICY IF EXISTS "ecf_submissions_rw" ON public.ecf_submissions;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.empleados;
DROP POLICY IF EXISTS "rls_anon_select" ON public.empleados;
DROP POLICY IF EXISTS "rls_anon_update" ON public.empleados;
DROP POLICY IF EXISTS "ici_anon_all" ON public.inventory_count_items;
DROP POLICY IF EXISTS "ic_anon_all" ON public.inventory_counts;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.inventory_items;
DROP POLICY IF EXISTS "rls_anon_select" ON public.inventory_items;
DROP POLICY IF EXISTS "rls_anon_update" ON public.inventory_items;
DROP POLICY IF EXISTS "oversells_anon_rw" ON public.inventory_oversells;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.inventory_transactions;
DROP POLICY IF EXISTS "rls_anon_select" ON public.inventory_transactions;
DROP POLICY IF EXISTS "rls_anon_update" ON public.inventory_transactions;
DROP POLICY IF EXISTS "leads_anon_all" ON public.leads;
DROP POLICY IF EXISTS "leads_auth_all" ON public.leads;
DROP POLICY IF EXISTS "rls_anon_select" ON public.licenses;
DROP POLICY IF EXISTS "rls_anon_update" ON public.licenses;
DROP POLICY IF EXISTS "loan_payments_anon_all" ON public.loan_payments;
DROP POLICY IF EXISTS "loan_schedule_anon_rw" ON public.loan_schedule;
DROP POLICY IF EXISTS "loans_anon_all" ON public.loans;
DROP POLICY IF EXISTS "memberships_anon_rw" ON public.memberships;
DROP POLICY IF EXISTS "memberships_auth_rw" ON public.memberships;
DROP POLICY IF EXISTS "ncf_blocks_anon_rw" ON public.ncf_blocks;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.ncf_sequences;
DROP POLICY IF EXISTS "rls_anon_select" ON public.ncf_sequences;
DROP POLICY IF EXISTS "rls_anon_update" ON public.ncf_sequences;
DROP POLICY IF EXISTS "ncf_seq_master_anon_rw" ON public.ncf_sequences_master;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.notas_credito;
DROP POLICY IF EXISTS "rls_anon_select" ON public.notas_credito;
DROP POLICY IF EXISTS "rls_anon_update" ON public.notas_credito;
DROP POLICY IF EXISTS "pawn_items_anon_all" ON public.pawn_items;
DROP POLICY IF EXISTS "payroll_runs_rw" ON public.payroll_runs;
DROP POLICY IF EXISTS "payroll_settings_rw" ON public.payroll_settings;
DROP POLICY IF EXISTS "projects_anon_all" ON public.projects;
DROP POLICY IF EXISTS "projects_auth_all" ON public.projects;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.queue;
DROP POLICY IF EXISTS "rls_anon_select" ON public.queue;
DROP POLICY IF EXISTS "rls_anon_update" ON public.queue;
DROP POLICY IF EXISTS "queue_deletions_all" ON public.queue_deletions;
DROP POLICY IF EXISTS "queue_deletions_anon_all" ON public.queue_deletions;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.rnc_cache;
DROP POLICY IF EXISTS "rls_anon_select" ON public.rnc_cache;
DROP POLICY IF EXISTS "rls_anon_update" ON public.rnc_cache;
DROP POLICY IF EXISTS "salary_changes_rw" ON public.salary_changes;
DROP POLICY IF EXISTS "sales_deals_anon_all" ON public.sales_deals;
DROP POLICY IF EXISTS "sales_deals_auth_all" ON public.sales_deals;
DROP POLICY IF EXISTS "seller_commissions_biz_delete" ON public.seller_commissions;
DROP POLICY IF EXISTS "seller_commissions_biz_read" ON public.seller_commissions;
DROP POLICY IF EXISTS "seller_commissions_biz_update" ON public.seller_commissions;
DROP POLICY IF EXISTS "service_bays_anon_all" ON public.service_bays;
DROP POLICY IF EXISTS "service_packages_anon_all" ON public.service_packages;
DROP POLICY IF EXISTS "service_packages_auth_all" ON public.service_packages;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.services;
DROP POLICY IF EXISTS "rls_anon_select" ON public.services;
DROP POLICY IF EXISTS "rls_anon_update" ON public.services;
DROP POLICY IF EXISTS "staff_anon_select" ON public.staff;
DROP POLICY IF EXISTS "staff_anon_update" ON public.staff;
DROP POLICY IF EXISTS "staff_select" ON public.staff;
DROP POLICY IF EXISTS "stylist_schedules_anon_all" ON public.stylist_schedules;
DROP POLICY IF EXISTS "subscriptions_anon_all" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_auth_all" ON public.subscriptions;
DROP POLICY IF EXISTS "anon_support_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "test_drives_anon_all" ON public.test_drives;
DROP POLICY IF EXISTS "test_drives_auth_all" ON public.test_drives;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.ticket_items;
DROP POLICY IF EXISTS "rls_anon_select" ON public.ticket_items;
DROP POLICY IF EXISTS "rls_anon_update" ON public.ticket_items;
DROP POLICY IF EXISTS "rls_anon_delete" ON public.tickets;
DROP POLICY IF EXISTS "rls_anon_select" ON public.tickets;
DROP POLICY IF EXISTS "rls_anon_update" ON public.tickets;
DROP POLICY IF EXISTS "vehicle_inventory_anon_all" ON public.vehicle_inventory;
DROP POLICY IF EXISTS "vehicle_inventory_auth_all" ON public.vehicle_inventory;
DROP POLICY IF EXISTS "vehicles_anon_all" ON public.vehicles;
DROP POLICY IF EXISTS "wash_combos_anon_rw" ON public.wash_combos;
DROP POLICY IF EXISTS "wash_combos_auth_rw" ON public.wash_combos;
DROP POLICY IF EXISTS "washer_commissions_biz_delete" ON public.washer_commissions;
DROP POLICY IF EXISTS "washer_commissions_biz_read" ON public.washer_commissions;
DROP POLICY IF EXISTS "washer_commissions_biz_update" ON public.washer_commissions;
DROP POLICY IF EXISTS "work_order_items_anon_all" ON public.work_order_items;
DROP POLICY IF EXISTS "work_orders_anon_all" ON public.work_orders;

-- 2. modifier_groups
ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS modifier_groups_sel ON public.modifier_groups;
DROP POLICY IF EXISTS modifier_groups_ins ON public.modifier_groups;
DROP POLICY IF EXISTS modifier_groups_upd ON public.modifier_groups;
DROP POLICY IF EXISTS modifier_groups_del ON public.modifier_groups;
CREATE POLICY modifier_groups_sel ON public.modifier_groups FOR SELECT TO authenticated USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY modifier_groups_ins ON public.modifier_groups FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY modifier_groups_upd ON public.modifier_groups FOR UPDATE TO authenticated USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY modifier_groups_del ON public.modifier_groups FOR DELETE TO authenticated USING (business_id IN (SELECT my_business_ids()));

-- 3. ecf_cert_* permissive drops
DROP POLICY IF EXISTS "ecf_cert_commands_all" ON public.ecf_cert_commands;
DROP POLICY IF EXISTS "ecf_cert_docs_auth" ON public.ecf_cert_documents;
DROP POLICY IF EXISTS "ecf_cert_notes_auth" ON public.ecf_cert_notes;
DROP POLICY IF EXISTS "ecf_cert_step_data_all" ON public.ecf_cert_step_data;
DROP POLICY IF EXISTS "ecf_cert_test_results_all" ON public.ecf_cert_test_results;
DROP POLICY IF EXISTS "ecf_certs_auth" ON public.ecf_certifications;

-- 4. ecf_cert_* admin_users scoping
-- ecf_cert_* — only admin_users (our reseller admins) may see/modify. Scoped
-- by auth.uid() matching admin_users.auth_user_id.

CREATE POLICY ecf_certifications_admin ON public.ecf_certifications
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()));

CREATE POLICY ecf_cert_documents_admin ON public.ecf_cert_documents
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()));

CREATE POLICY ecf_cert_notes_admin ON public.ecf_cert_notes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()));

CREATE POLICY ecf_cert_step_data_admin ON public.ecf_cert_step_data
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()));

CREATE POLICY ecf_cert_test_results_admin ON public.ecf_cert_test_results
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()));

CREATE POLICY ecf_cert_commands_admin ON public.ecf_cert_commands
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()));
