# Go-Live Checklist — 2026-05-01

Run before flipping any tenant to production. Combines automated gates + manual UI flows that no harness can fully replicate.

## 1. Automated gates (must all exit 0)

```bash
cd "A:/Studio X HUB/Terminal X"
node scripts/rls-policy-audit.mjs       # RLS policies clean
node scripts/ranoza-e2e-smoke.mjs        # 28 read-path scenarios
node scripts/audit-flows.mjs             # 37 schema + side-effect rules
node scripts/verify-v2.16.24.mjs         # 21 v2.16.24 fix verifications
node scripts/pre-launch-check.mjs        # Production-state sanity (28 checks)
```

If any gate fails: STOP. Do not flip live.

## 2. Manual UI smoke on terminalxpos.com (Ranoza)

Login as the Ranoza owner. Walk through each flow and verify the result. Report any deviation.

### POS — sale flow
- [ ] Add 3 different products to cart (one via barcode scan, one via grid tap, one via search)
- [ ] Edit qty on a cart line directly (the new editable input — tap → keypad)
- [ ] Cobrar cash → receipt prints + drawer kicks (if printer connected)
- [ ] Verify ticket appears in History within 5 seconds
- [ ] **Inventory check**: refresh Inventory screen → confirm the 3 products' `quantity` decreased by the qty sold

### Credit ticket — the bug we just fixed
- [ ] Add 1 product priced ~RD$500 to cart
- [ ] Select an existing client at cobrar
- [ ] Choose **Crédito** payment method → Confirm
- [ ] Open **Clientes** screen → search the client → balance should show +RD$500
- [ ] Open **Créditos** screen → the ticket should appear in the open credit list

### Partial credit payment — the bug we just fixed
- [ ] Pick a client with 2+ open credit tickets (or create them)
- [ ] In Credits screen, select all of them and pay an amount LESS than the total owed
- [ ] Verify: only the tickets fully covered flip to `cobrado`; the rest stay `pendiente` with reduced balance

### Returns — the bug we just fixed
- [ ] Open a recently-paid ticket
- [ ] Tap **Devolver** → return 1 line
- [ ] Verify NCF dispatch:
  - Non-ECF business → B04 paper credit note
  - ECF-live business (SXSRL) → E33 (parcial) or E34 (anulación full return)
- [ ] Inventory: returned product's `quantity` should INCREASE by the returned qty

### Mesa transfer (restaurant only)
- [ ] Seat a mesa, add 2 items
- [ ] Transfer to another mesa via the action menu
- [ ] Verify: ticket follows the new mesa, old mesa flips to `sucia`, new mesa to `ocupada`

### Cuadre — the new 3-step flow
- [ ] Navigate to **Cuadre de Caja**
- [ ] Step 1 (resumen) auto-loads — confirm numbers match the day's tickets
- [ ] Step 2: enter cash counted in drawer, verify diferencia computes live
- [ ] Step 3: add a note, click **Cerrar Caja**
- [ ] Re-open Cuadre — should NOT see the orphan `abierto` row from before close

### Conteo Físico — per-item flow
- [ ] Start a new conteo, scope to a category (e.g. "Whisky")
- [ ] Print "Imprimir lista para contar" → PDF should list every product with category + SKU + expected qty + blank box
- [ ] Enter counted qty per row in the on-screen table
- [ ] Click **Terminar conteo** → variance report PDF generates with red highlights for shortage rows

### Mi Empresa toggles
- [ ] Owner-only screen: toggle **Descuentos al cobrar** OFF → next cobrar should hide the descuento input
- [ ] Toggle ITBIS por producto en recibo ON → next receipt should show ITBIS sub-line per item

### Stock-zero hard block
- [ ] Pick a product with stock=0 in inventory
- [ ] Try to add to cart via barcode scan → should toast "Sin stock — {name}", no cart line

## 3. e-CF live round-trip (Studio X SRL only — DGII production check)

ONLY for Studio X SRL (RNC 133410321, certified emisor). Not for Ranoza (no e-CF setup).

- [ ] Verify cert installed: Sistema → DGII → Certificación tab → status "Instalado" + expiry date in future
- [ ] Issue 1 test e-CF E32 to a fake client (low value <RD$250K to trigger RFCE path)
- [ ] Wait ≤30 seconds for DGII verdict
- [ ] Verify ticket.ecf_result.status='ACEPTADO' in Activity Log
- [ ] Verify NCF column populated with correct E-prefix

If RFCE fails → check fe.terminalxpos.com health, see `tools/cert-step4` golden-diff to confirm XML matches certified shape.

## 4. Backup health (Studio X SRL desktop)

- [ ] Open Sistema → Empresa on desktop → bottom of page should show "Último respaldo: ..." in last 24h
- [ ] If empty: Sistema → Empresa → click **Respaldar Ahora** → wait 30s → status should flip to OK

## 5. Cross-device realtime check (multi-cashier setups only)

Open 2 browser tabs as the same business owner:
- [ ] Tab A: change a product price
- [ ] Tab B (Inventory screen open): price should update within 5 seconds without manual refresh

## 6. WhatsApp / SMS (if configured)

- [ ] Settings → check UltraMsg `instance_id` + `token` populated
- [ ] Trigger a test reminder via Salon → Test send → confirm delivered

## 7. Final sanity

- [ ] Browser DevTools → Network tab → reload terminalxpos.com → no 4xx/5xx in main bundle requests
- [ ] DevTools → Console → no red errors after a full POS flow
- [ ] License: Sistema → Empresa → "Estado de licencia: Activa" + expiry date

## 8. Post-launch monitoring (first 24h)

Watch for:
- ANECF queue growth (`/api/panel?action=anecf-drain` cron runs every 6h)
- Inventory_items.quantity drift (if a sale doesn't decrement, the trigger is broken)
- Activity_log volume (no writes for >2h = something stalled)
- Realtime subscription disconnects in browser console
- `clients.balance` going negative (would mean credit_payments mis-allocated)

If any of those: re-run `node scripts/pre-launch-check.mjs` and `node scripts/audit-flows.mjs` to catch the regression.
