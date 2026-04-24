# FUTURE — Terminal X (backlog, attack after core is stable)

## Post-SXAD-launch (2026-04-24 — added after go-live)

**DGII e-CF quality-of-life:**
- **RFCE golden-diff test** — add `scripts/rfce-golden-diff.mjs` to `verify:build` that calls `electron/xml-builder.js::buildRFCEXml()` with canonical inputs and diffs the output byte-for-byte against `tools/cert-step4-gen.js` reference. Fails release on drift. Root cause of the 9-build RFCE rejection chase was two parallel XML generators that silently diverged; this test prevents recurrence.
- **Delegate to `dgii-ecf` package builder** — replace our hand-written `buildRFCEXml` + `buildECFXml` with `dgii-ecf`'s own builders. One source of truth. Will also get DGII-spec updates for free when the package updates.
- **Save signed XML to `userData/ecf-xml/` on every submission** — shipped v2.14.15 for debugging, keep permanently for audit trail / re-submission support.
- **File `certecf` postulación for SXAD** — Oficina Virtual → Facturación Electrónica → Postulación, CerteCF env. Enables live test-env submissions without touching prod sequences. Not blocking — prod works today.
- **Receipt auto-submit / offline queue integration** — if DGII is unreachable at sale time, queue the e-CF locally with `IndicadorEnvioDiferido=1` and resubmit automatically on the 30s/60s tick. Infrastructure exists (`dgii_queue`, `anecf_queue`) but needs wiring for the RFCE path.
- **Investigate the "two tickets written for one sale" pattern** seen intermittently — second row is empty stub, looks like a sync-push race. Low priority since first row has all the real data.
- **Seed scripts should NOT pre-create ncf_sequences.prefix** with anything but the canonical 3-char type. We saw `E320` (4 chars) cause 14-char eNCFs on runtime. v2.14.17 defends against it in the generator but the root sync write path should be audited.

**Pre-submit UX:**
- **Surface DGII rejection reason in CobrarModal Success view** — right now we capture the `mensajes` array in v2.14.13+ and store in `ecf_submissions.dgii_message`, but the Success screen only shows "Rechazado" without the reason. Add a collapsible "¿Por qué?" panel below the badge.
- **Retry button on Rechazado** — currently the cashier has to cancel + redo the sale. Keep the cart/form and let them retry once DGII-side fixes apply (common for transient issues).

**Post-launch cleanup:**
- **Drop ~20 dead Supabase tables** flagged by the migration audit (mesas, modificadores, kds_events, vehicles, service_bays, appointments, stylist_schedules, loans, loan_payments, pawn_items, ncf_sequences_master, ncf_blocks, doc_number_master, doc_number_blocks, license_rebind_requests, api_rate_limits, dgii_seed_nonces, cert_expiry_alerts, ecf_queue). Never queried. 0 rows each. Drop in a single migration after 30-day grace to confirm nothing surfaces.
- **27 dead exports in electron/database.js** — 80 LOC of `module.exports` cruft. Delete after verifying no dynamic references.
- **Sync column-list audit** — comment at `sync.js:2055` references a prior regression where `pin_hash_algo` dropped out of the push column list. Re-audit every sync spec's `cols:` against current column schemas.
- **Apertura modal parent gate** — currently wraps only POS component. If sidebar is rendered at a HIGHER stacking context, the v2.14.17 max z-index fix may not actually cover it on some renders. Move the Gate to wrap the WHOLE authed layout.

## Onboarding (defer)

- **Training manual update** — nueva sección "Primer día del cliente licorería" (setup real, no demo). Incluir flujo de inventario import, configuración de NCF real, test de impresora, enrolar cajeros, set PIN, e-CF walkthrough.
- **Onboarding checklist PDF para el cliente** — paso a paso de lo que necesita traer/decidir antes de la instalación:
  - Inventario actual (Excel/CSV con SKU, barcode, nombre, categoría, precio, costo, stock)
  - Cédulas, salarios y roles de empleados
  - Impresora térmica (modelo, conexión USB o red)
  - Scanner USB
  - PC/laptop (specs mínimas, Windows 10/11)
  - WiFi estable (SSID, password — para pre-configurar Chrome/app)
  - RNC del negocio + certificado Viafirma si ya lo tiene
  - Decisiones: tipo de cajero (cuántos), descuentos permitidos, horarios de turno
- **Migración de inventario** — script que tome CSV del cliente y lo mapee a `inventory_items` con auto-detección de categorías (por keyword matching).
- **Templates de WhatsApp/email** — bienvenida al cliente, recordatorio de pago mensual, alerta de stock bajo, recibo de e-CF con QR.
- **Seed demo "30 días de actividad"** — script que inserta historial ficticio al crear un tenant nuevo para que el admin vea el sistema "vivo" desde día 1 de uso real (no el demo compartido).
- ~~**Backup automático diario**~~ — ✅ SHIPPED v2.12.1: nightly SQLite→Supabase Storage at 3 AM, 14d retention, SQLCipher-aware, manual trigger UI in Sistema → Mi Empresa.

## Done in v2.14.x (2026-04-23 / 2026-04-24) — moved out of FUTURE

- ✅ PIN sha256→bcrypt drift killer (v2.14.3) — all write paths force bcrypt, auto-detect from hash format
- ✅ Admin role CHECK constraint fix (v2.14.3) — filters empleado.role='none'
- ✅ Self-PIN oldPin input (v2.14.4) — S-H6 guard reachable from UI
- ✅ Printer picker auto-save (v2.14.5) — no more Guardar button scroll
- ✅ Boot sync pull 60s → 5s (v2.14.6) — Preferencias shows live data on open
- ✅ Sistema/CobrarModal refresh on sync-pull-complete (v2.14.6/7)
- ✅ CobrarModal NCF ↔ e-CF in-modal toggle (v2.14.7)
- ✅ RNC/Cédula auto-format via `formatRncCedula()` (v2.14.7) — Clients + CobrarModal
- ✅ Apertura modal RD$ flex badge (v2.14.7) — 1Password icon can't overlap
- ✅ Nomina empleados header collapse (v2.14.7) — no horizontal scrollbar
- ✅ Logo pull from Supabase Storage (v2.14.8/9) — LWW gate bypass
- ✅ Receipt: ITBIS (no % label), TOTAL bold+large (no black bar), client-name 3-way fallback (v2.14.8)
- ✅ Dispatch slip honors typed client name (v2.14.9)
- ✅ eNCF reservation before DGII submit — fixes ecf_submissions.encf NOT NULL crash (v2.14.10)
- ✅ Emisor auto-heal migration (v2.14.11) — businesses.rnc → app_settings.biz_rnc
- ✅ Legal vs commercial name split (v2.14.11) — biz_name legal (DGII) / biz_commercial_name brand (receipt)
- ✅ Pre-submit RNC guard (v2.14.11) — blocks cobrar with clear error before NCF burn
- ✅ Logo-only receipt header at 384px (v2.14.12) — brand front, no redundant text
- ✅ DGII rejection reason captured to main.log + dgii_message column (v2.14.13) — electron-log + mensajes normalization
- ✅ RFCE XML nested IdDoc/Emisor/Totales groupings (v2.14.14)
- ✅ RFCE signing via `dgii-ecf.Signature('RFCE')` (v2.14.15) — not xml-crypto
- ✅ Signed XML persisted to userData/ecf-xml/ (v2.14.15) — audit + post-mortem diff
- ✅ E-series eNCF padding 10 digits (v2.14.16/17) — canonical 3-char type prefix
- ✅ RFCE multipart/form-data submission (v2.14.18) — **THE fix that got DGII accepting**
- ✅ Emisor RazonSocial uppercase match DGII registry (v2.14.18) — "STUDIO X SRL"
- ✅ NCF off-by-one: ticketCreate honors caller-provided ncf (v2.14.19)

**First accepted production e-CF:** `E320000000018` at 2026-04-24T01:27 UTC, Studio X Auto Detailing RNC 133410321.

## Done in v2.12.1 (2026-04-20) — moved out of FUTURE

- ✅ SQLCipher SQLite encryption at rest (HKDF/HWID + safeStorage)
- ✅ Sentry telemetry (DSN-gated, PII-scrubbed)
- ✅ Apertura de turno prompt
- ✅ Kiosk idle auto-lock
- ✅ Loyalty tiers Bronce/Plata/Oro
- ✅ Licorería deposit/bottle-return
- ✅ Mecánica WO→ticket bridge
- ✅ Concesionario DealBuilder→CobrarModal+E31 routing
- ✅ Admin License Rebind UI
- ✅ DGII EN_PROCESO reconciler
- ✅ xml-crypto v6 fe receiver port (committed, NOT deployed — needs real DGII XML for testing)
- ✅ Inventory clamp symmetry
- ✅ Cert history audit table
- ✅ Print queue USB retry + banner
- ✅ GitHub: secret scanning + Dependabot + branch protection on main

## Still pending (Tier 0 external deps)

- **EV cert installer signing** — requires procurement (~$300-400/yr DigiCert/Sectigo). Ship after first paying client revenue covers it.
- **pgsodium envelope-encrypt `.p12`** in Supabase — needs operational rollout plan + key rotation runbook before flipping
- **xml-crypto v6 deploy** to fe.terminalxpos.com — gated on a real DGII-signed sample XML to validate the port doesn't break inbound ARECF/ACECF
- **3 HIGH Dependabot alerts** — lodash code injection, xlsx ReDoS, xlsx prototype pollution. Handed to a parallel Claude terminal.
- **CSP `'unsafe-inline'` removal** from style-src — needs nonce middleware (same problem strict-dynamic had on script-src)

## Priority (what we're doing NOW instead)

1. Printing on owner's Studio X Car Wash PC (not printing receipts)
2. Scanning setup on the real POS for the new licorería client
3. Multi-POS real-time (3 atomic RPCs: allocate_ncf, allocate_doc_number, deduct_inventory) — so 2 POS + admin PC work simultaneously at the licorería without NCF collisions or stock negatives
4. Offline login on desktop (agent in progress)
5. Network diagnostic panel (agent in progress)
6. Retry + humanized errors (agent in progress)

## Revisit date

After the licorería client is fully installed and operating for 2+ weeks. Re-read this file then.

---

## Plan-Gating Catalog (what we can sell)

Running list of features worth gating by plan. Whether we land the licorería client or not, this is the product roadmap that turns Terminal X into a real multi-tier SaaS. Update this as we build.

### Pro MAX exclusives (RD$6,990/mo)
- **Multi-POS simultáneo** — 2+ POS desktop + admin web en el mismo negocio, con NCF/doc_number/inventory sincronizados en tiempo real. Pro y Pro PLUS = 1 POS. Pro MAX = ilimitado.
  - Feature flag: `multi_pos_enabled`
  - Upsell trigger: owner intenta instalar segundo POS → modal "Necesitas Pro MAX para multi-POS".
- **Oversell detection + reconciliation** — detección de ventas simultáneas que dejan stock en negativo, con workflow del dueño para resolver. Solo útil en multi-POS.
- **Dashboard remoto multi-sucursal** — ver ventas de varias licorerías/carwashes en un solo admin. Requiere el backend de blocks ya diseñado para multi-device.
- **Backup automático diario a R2** — snapshot cada 24h a Cloudflare R2 del cliente. Disaster recovery real.
- **Kiosk fullscreen mode** — ya existe, mover detrás de Pro MAX.
- **Comisiones avanzadas** — por categoría de producto, por hora del día, por sucursal.
- **Nómina avanzada** — ley 16-92 completa, liquidaciones auto, retenciones ISR escalonadas. (Pro PLUS ya tiene básica.)
- **Soporte prioritario** — respuesta WhatsApp < 1h en horario laboral + noches + fin de semana.

### Pro PLUS exclusives (RD$4,490/mo)
- **e-CF directo a DGII** — ya está. No tocar.
- **Inventario con alertas de stock bajo** — ya está.
- **Créditos + Notas de Crédito** — ya está.
- **Importar CSV masivo** — ya está.
- **Dashboard remoto (1 sucursal)** — solo la suya. Multi-sucursal es Pro MAX.
- **Diagnóstico de red** — panel que acabamos de construir. Gratis por ahora, considerar gate si uso excede.

### Pro base (RD$2,490/mo)
- POS completo
- NCF B01/B02 paper
- Viafirma incluido (upsell a Pro PLUS para emitir e-CF real)
- 1 POS device
- Reportes básicos diario/mensual
- Cuadre de Caja + Caja Chica

### Plan-bump triggers (cuándo empujar al siguiente plan)
- Pro → Pro PLUS: intenta configurar e-CF, agrega 5to empleado con comisión, tiene >100 productos.
- Pro PLUS → Pro MAX: intenta instalar 2do POS, pide multi-sucursal, pide backups automáticos.

### Feature flag implementation pattern
- Each gateable feature has a key in `PLAN_FEATURES` (`packages/ui/context/PlanContext.jsx` or similar).
- Desktop AND web check `plan.features.includes('multi_pos')` before showing UI.
- Dev override forces pro_max (already in code per CLAUDE.md).
- Remote config (`validate.js`) returns feature set from Supabase `plans` table — Mike can bump a feature to a lower plan without releasing code.

### Add-ons / one-time services (on top of monthly)
- **Certificación e-CF Completa** — RD$45,000 one-time.
- **Completa + Terminal X** — RD$55,000 one-time (incluye 3 meses Pro MAX gratis).
- **Asesoría e-CF** — RD$15,000 one-time.
- **Instalación en sitio** — RD$5,000-10,000 según ciudad.
- **Training presencial 4 horas** — RD$8,000.
- **Migración de inventario** (si tienen Excel/Siigo/STARSISA) — RD$3,000.
- **Setup multi-sucursal** — RD$15,000 por sucursal adicional.

## Why we're doing this even if we lose the client

Every feature we build here makes Terminal X a REAL distributed POS platform — not a demo, not a solo-shop tool. This is what separates Terminal X from STARSISA/Siigo/Alegra in the DR market. The licorería client is the forcing function; the code survives regardless.

- Multi-POS distributed architecture → sellable to every DR business with 2+ terminals (restaurants, pharmacies, supermercados).
- Offline-first block allocation → sellable as "funciona sin internet" (huge in DR interior).
- Oversell detection → sellable as "nunca más descuadres con tus empleados".
- Diagnostic panel → reduces support calls, reduces churn.

