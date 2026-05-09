# Terminal X — End-to-End Error Reporting Coverage

Generated 2026-05-08 from 6 layer audits.

**Definition of WIRED:** action's failure path calls `window.__txReportError(err, { severity, category, extra })` (writes to Supabase `client_errors` + Sentry, surfaced in Admin → Client Detail → Errores tab). Toasts, flash messages, setState errors, console.error, alert(), and bare `catch {}` are NOT wired.

## Coverage by layer

| Layer | Description | Total | Wired | Coverage |
|---|---|---:|---:|---:|
| A | Electron IPC | 50 | 0 | 0.0% |
| B | Web Data Layer | 112 | 0 | 0.0% |
| C | Vercel API | 49 | 1 | 2.0% |
| D1 | UI POS | 105 | 7 | 6.7% |
| D2 | UI Admin/Settings/Verticals | 53 | 0 | 0.0% |
| E | Background Jobs | 22 | 4 | 18.2% |
| **All** | | **391** | **12** | **3.1%** |

## Gap distribution

| Gap Type | Count | % |
|---|---:|---:|
| no_try_catch | 125 | 32.0% |
| toast_only | 55 | 14.1% |
| swallowed_catch | 43 | 11.0% |
| client_caller_reports_only | 36 | 9.2% |
| console_only | 34 | 8.7% |
| state_only | 33 | 8.4% |
| no_report | 13 | 3.3% |
| ok | 12 | 3.1% |
| setState | 12 | 3.1% |
| partial_server_no_log | 10 | 2.6% |
| partial_no_client_errors | 8 | 2.0% |
| ipc_no_renderer_report | 5 | 1.3% |
| alert_only | 5 | 1.3% |

## Coverage matrix (layer × gap)

| Layer | no_try_catch | toast_only | swallowed_catch | client_caller_reports_only | console_only | state_only | no_report | ok | setState | partial_server_no_log | partial_no_client_errors | ipc_no_renderer_report | alert_only |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 11 |  | 31 |  |  |  |  |  |  |  | 3 | 5 |  |
| B | 96 |  |  |  |  |  | 13 |  |  |  | 3 |  |  |
| C | 2 |  |  | 36 |  |  |  | 1 |  | 10 |  |  |  |
| D1 | 12 | 23 | 10 |  | 16 | 18 |  | 7 | 12 |  | 2 |  | 5 |
| D2 | 4 | 32 | 2 |  |  | 15 |  |  |  |  |  |  |  |
| E |  |  |  |  | 18 |  |  | 4 |  |  |  |  |  |

## P0 — Highest priority gaps (fiscal / payment / sync / cert / DGII)

Unwired actions in these categories should be wired immediately.

**101 P0 gaps.** First 30 below; full list in MASTER.csv.

| Layer | Action | File:Line | Gap | Fix |
|---|---|---|---|---|
| A | ecf:queue-count | main.js:242 | no_try_catch | Simple query no error path |
| A | dgii:submit | main.js:291 | swallowed_catch | Add reportMainProcessError(err 'critical' dgii.submit) on catch |
| A | dgii:void-sequence | main.js:494 | swallowed_catch | Add reportMainProcessError(err 'critical' dgii.void) |
| A | dgii:install-cert | main.js:554 | swallowed_catch | Add reportMainProcessError on catch |
| A | dgii:cert-info | main.js:581 | swallowed_catch | Add reportMainProcessError on catch |
| A | cert:expiry-check | main.js:692 | swallowed_catch | Add reportMainProcessError on catch |
| A | dgii:cert-pem | main.js:719 | partial_no_client_errors | Ensure renderer caller reports via __txReportError on load failure |
| A | dgii:restore-from-pem | main.js:777 | partial_no_client_errors | Ensure renderer caller reports via __txReportError on failure |
| A | dgii:auth-test | main.js:839 | swallowed_catch | Add reportMainProcessError on catch |
| A | dgii:queue-anecf-void | main.js:856 | swallowed_catch | Add reportMainProcessError on catch |
| A | dgii:check-status | main.js:872 | swallowed_catch | Add reportMainProcessError on catch |
| A | dgii:get-env | main.js:885 | no_try_catch | Simple passthrough no error path |
| A | dgii:generate-test-set | main.js:888 | swallowed_catch | Add reportMainProcessError on catch |
| A | dgii:submissions | main.js:903 | no_try_catch | Simple query no error path |
| A | dgii:reconcile-now | main.js:1164 | swallowed_catch | Add reportMainProcessError or handle internally |
| A | dgii:process-anecf-queue | main.js:1248 | swallowed_catch | Add reportMainProcessError on catch |
| A | dgii:anecf-queue-count | main.js:1252 | no_try_catch | Simple query no error path |
| A | dgii:anecf-queue-list | main.js:1253 | no_try_catch | Simple query no error path |
| A | license:hwid | main.js:1299 | no_try_catch | Simple function call no error path |
| A | license:set-key | main.js:1387 | swallowed_catch | Add reportMainProcessError on _wireLicenseJwt fail |
| A | license:clear-jwt | main.js:1395 | swallowed_catch | Add reportMainProcessError on catch |
| A | license:status | main.js:1408 | swallowed_catch | Add reportMainProcessError on catch |
| A | license:is-master | main.js:1427 | no_try_catch | Simple comparison no error path |
| A | rnc:sync | main.js:3031 | swallowed_catch | Add reportMainProcessError on catch |
| B | web.admin.saveSecuenciaNcf | packages/data/web.js:901 | no_try_catch | Wrap with tryWrite |
| B | web.ncf.next | packages/data/web.js:4665 | no_report | tryWrite + verify caller |
| B | web.dgii.addCompra | packages/data/web.js:4875 | no_try_catch | Wrap with tryWrite |
| B | web.dgii.deleteCompra | packages/data/web.js:4898 | no_try_catch | Wrap with tryWrite |
| B | web.app.submit | packages/data/web.js:5307 | no_report | tryWrite + verify caller |
| B | web.app.setEnvironment | packages/data/web.js:5509 | no_report | tryWrite + verify caller |

## P1 — High priority gaps (inventory / employees / settings / clients / mesas / kds)

**126 P1 gaps.** First 30 below.

| Layer | Action | File:Line | Gap | Fix |
|---|---|---|---|---|
| A | whatsapp:send | main.js:164 | ipc_no_renderer_report | Verify renderer handles rejection with __txReportError |
| A | whatsapp:sendDocument | main.js:201 | ipc_no_renderer_report | Verify renderer handles rejection with __txReportError |
| A | backup:runNow | main.js:1852 | partial_no_client_errors | Add __txReportError call in catch or wrap reportMainProcessError |
| A | backup:lastStatus | main.js:1862 | swallowed_catch | Add reportMainProcessError on catch |
| A | print:fire-drawer-variant | main.js:3274 | swallowed_catch | Add reportMainProcessError on catch |
| A | backup:local | main.js:3360 | swallowed_catch | Add reportMainProcessError on catch |
| B | web.admin.saveEmpresa | packages/data/web.js:770 | no_report | tryWrite + caller guards |
| B | web.admin.saveUsuario | packages/data/web.js:792 | no_try_catch | Wrap with tryWrite |
| B | web.admin.deleteUsuario | packages/data/web.js:815 | no_try_catch | Wrap with tryWrite |
| B | web.admin.saveLavador | packages/data/web.js:824 | no_try_catch | Wrap with tryWrite |
| B | web.admin.deleteLavador | packages/data/web.js:842 | no_try_catch | Wrap with tryWrite |
| B | web.admin.saveVendedor | packages/data/web.js:851 | no_try_catch | Wrap with tryWrite |
| B | web.admin.deleteVendedor | packages/data/web.js:867 | no_try_catch | Wrap with tryWrite |
| B | web.admin.saveServicio | packages/data/web.js:875 | no_try_catch | Wrap with tryWrite |
| B | web.admin.deleteServicio | packages/data/web.js:889 | no_try_catch | Wrap with tryWrite |
| B | web.admin.saveConfiguracion | packages/data/web.js:914 | no_try_catch | Wrap with tryWrite |
| B | web.settings.update | packages/data/web.js:952 | no_try_catch | Wrap with tryWrite |
| B | web.inventory.create | packages/data/web.js:1007 | no_try_catch | Wrap with tryWrite |
| B | web.inventory.update | packages/data/web.js:1012 | no_try_catch | Wrap with tryWrite |
| B | web.inventory.bulkUpdate | packages/data/web.js:1029 | no_try_catch | Wrap with tryWrite |
| B | web.inventory.delete | packages/data/web.js:1044 | no_try_catch | Wrap with tryWrite |
| B | web.inventory.adjust | packages/data/web.js:1049 | no_report | tryWrite + verify caller |
| B | web.inventory.oversells.resolve | packages/data/web.js:1179 | no_report | tryWrite + verify caller |
| B | web.inventoryCount.start | packages/data/web.js:1200 | no_try_catch | Wrap with tryWrite |
| B | web.inventoryCount.saveItem | packages/data/web.js:1282 | no_try_catch | Wrap with tryWrite |
| B | web.inventoryCount.complete | packages/data/web.js:1296 | no_try_catch | Wrap with tryWrite |
| B | web.inventoryCount.cancel | packages/data/web.js:1392 | no_try_catch | Wrap with tryWrite |
| B | web.inventoryCount.delete | packages/data/web.js:1402 | no_try_catch | Wrap with tryWrite |
| B | web.users.create | packages/data/web.js:1536 | no_try_catch | Wrap with tryWrite |
| B | web.users.update | packages/data/web.js:1557 | no_try_catch | Wrap with tryWrite |

## P2 — Everything else

**152 P2 gaps.** See MASTER.csv.

## Wire-up snippet templates

### A. Electron IPC handler (electron/main.js)
```js
ipcMain.handle('feature:action', async (_e, payload) => {
  try {
    const result = await db.doThing(payload);
    return { ok: true, data: result };
  } catch (err) {
    db.activityLogRecord({ event_type:'feature_action_fail', severity:'critical', target_type:'feature', reason: err.message });
    captureSentryException?.(err, { tags: { ipc:'feature:action' }});
    return { ok: false, error: err.message };
  }
});
```
Renderer caller MUST also do:
```js
const res = await window.electronAPI.feature.action(payload);
if (!res?.ok) {
  window.__txReportError?.(res?.error || 'feature:action failed', { severity:'error', category:'ipc.feature.action', extra:{ payload }});
  flash('Error: ' + res?.error);
}
```

### B. Web data-layer write (packages/data/web.js)
```js
// BEFORE (unwired — tryOr swallows)
async update(id, patch) { return tryOr(async () => { await sb.from('x').update(patch).eq('id', id); return true; }, false); }

// AFTER (wired — tryWrite throws, caller reports)
async update(id, patch) { return tryWrite(async () => { const { error } = await sb.from('x').update(patch).eq('id', id); if (error) throw error; return true; }); }
```
UI caller:
```js
try { await api.x.update(id, patch); flash('Guardado'); }
catch (err) {
  window.__txReportError?.(err, { severity:'error', category:'web.x.update', extra:{ id }});
  setError(err.message);
}
```

### C. Vercel API route (web/api/panel.js)
```js
case 'feature_action': {
  try {
    return await handleFeatureAction(req, res);
  } catch (err) {
    // server-side: write to client_errors directly
    await sbAdmin.from('client_errors').insert({
      business_id: req.headers['x-business-id'] || null,
      message: err.message, stack: err.stack,
      route: '/api/panel?action=feature_action',
      severity:'error', metadata:{ platform:'api', action:'feature_action' }
    });
    return res.status(500).json({ error: err.message });
  }
}
```
Client caller:
```js
const r = await fetch('/api/panel?action=feature_action', { method:'POST', body });
if (!r.ok) {
  const txt = await r.text();
  window.__txReportError?.('feature_action 5xx ' + txt, { severity:'error', category:'api.feature_action' });
}
```

### D. UI mutation handler (any screen)
```jsx
async function handleSave() {
  try {
    setLoading(true);
    await api.x.update(id, form);
    showToast('Guardado', 'success');
  } catch (err) {
    window.__txReportError?.(err, { severity:'error', category:'screen.x.save', extra:{ id, form }});
    showToast(err.message, 'error');
  } finally { setLoading(false); }
}
```

### E. Background job (electron/sync.js, setInterval handlers, cron jobs)
```js
async function syncTick() {
  try { await pushAll(); await pullAll(); }
  catch (err) {
    captureSentryException?.(err, { tags:{ background:'sync.tick' }});
    db.activityLogRecord({ event_type:'sync_tick_fail', severity:'critical', reason: err.message });
    // Also POST to /api/panel?action=report_error so admin Errores panel sees it
    fetch('${SUPABASE_URL}/api/panel?action=report_error', { method:'POST', body: JSON.stringify({ business_id, severity:'error', message: err.message, route:'background:sync.tick', metadata:{ platform:'desktop', category:'sync.tick' }})});
  }
}
setInterval(() => { syncTick().catch(() => {}); }, 5 * 60 * 1000);
```

## Category taxonomy

Use these `category` strings consistently when calling `__txReportError` so the Errores panel can group:

- **POS:** `pos.cart.add`, `pos.cart.update_qty`, `pos.cart.remove`, `pos.payment.confirm`, `pos.queue.encolar`, `pos.client.select`
- **Restaurant:** `restaurant.fire_kds`, `restaurant.request_bill`, `restaurant.precuenta`, `restaurant.split_bill`, `restaurant.transfer_mesa`, `restaurant.merge_mesa`, `mesa.set_status`, `reservation.create`, `reservation.cancel`, `kds.advance`, `kds.recall`
- **Cobrar/Cobro:** `cobrar.submit`, `cobrar.ncf.allocate`, `cobrar.ecf.sign`, `cobrar.ecf.submit`, `cobrar.loyalty.redeem`
- **DGII:** `dgii.submit`, `dgii.semilla`, `dgii.cert.install`, `dgii.cert.export`, `dgii.anecf.queue`, `dgii.reconcile`, `dgii.creds.save`, `dgii.auth.test`
- **Settings:** `settings.timezone`, `settings.business_name`, `settings.itbis`, `settings.printer`, `settings.whatsapp`, `settings.feature_toggle`
- **Inventory:** `inventory.create`, `inventory.update`, `inventory.delete`, `inventory.adjust`, `inventory.bulk_update`, `inventory.count.start`, `inventory.count.save_item`, `inventory.count.complete`, `inventory.import`
- **Employees:** `empleado.save`, `empleado.delete`, `empleado.toggle_active`, `empleado.payroll_run`, `empleado.commission_pay`
- **Clients:** `client.create`, `client.update`, `client.delete`, `client.note.add`, `client.credit.adjust`
- **License:** `license.set_key`, `license.refresh_jwt`, `license.rebind`
- **Sync:** `sync.tick`, `sync.push.<table>`, `sync.pull.<table>`, `sync.activity_log.drain`
- **Background:** `background.backup.nightly`, `background.rnc.sync`, `background.anecf.drain`, `background.dgii.reconcile`, `background.digest.daily`, `background.salon.reminder`

## Verification

- Open MASTER.csv. Filter by `gap_type` to triage.
- Spot-check 10 `swallowed_catch` rows — confirm the catch is real (not OK with a sibling reporter).
- Re-run `node scripts/aggregate-error-coverage.mjs` after each batch of fixes. Coverage % should rise.
- Goal: P0 ≥ 95%, P1 ≥ 80%, P2 ≥ 60% wired.
