// Aggregate Layer A/B/C/D1/D2/E coverage CSVs into MASTER.csv + REPORT.md
// Re-normalizes gap_type so anything without `__txReportError` is flagged.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('docs/audits/error-reporting-coverage');
const FILES = ['A_ipc.csv','B_web_data.csv','C_api.csv','D1_ui_pos.csv','D2_ui_admin.csv','E_background.csv'];

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') { q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function csvCell(v) {
  v = String(v ?? '');
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return '"' + v.replaceAll('"','""') + '"';
  return v;
}

const HEADER = ['layer','file','line','action_id','has_try_catch','has_report','report_kind','severity','category','gap_type','fix_recommendation'];

function normGap(row) {
  const rk = (row.report_kind || '').toLowerCase();
  const htc = (row.has_try_catch || '').toLowerCase();
  const original = row.gap_type || '';
  // Only "ok" if reporter is __txReportError
  if (rk === 'txreporterror') return 'ok';
  // Server-side ok exception: api.panel.report_error itself
  if (row.action_id === 'api.panel.report_error') return 'ok';
  if (rk === 'sentry_only' || rk === 'activitylog_only') return 'partial_no_client_errors';
  if (rk === 'toast' || rk === 'toast_error' || rk === 'flash' || rk === 'flash_message' || rk === 'toast_message') return 'toast_only';
  if (rk === 'setstate' || rk === 'error_state') return 'state_only';
  if (rk === 'console_only' || rk === 'console') return 'console_only';
  if (rk === 'alert_only' || rk === 'alert') return 'alert_only';
  if (rk === 'swallowed') return 'swallowed_catch';
  if (htc === 'no' || htc === '0' || htc === 'false') return 'no_try_catch';
  if (rk === 'none' || rk === '') {
    if (original && original !== 'ok') return original;
    return 'no_report';
  }
  return original || 'unknown';
}

const allRows = [];
const summary = {};
for (const f of FILES) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) { console.warn('missing', f); continue; }
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith('#')) continue;
    const cells = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((h, idx) => row[h] = cells[idx] ?? '');
    row.gap_type = normGap(row);
    allRows.push(row);
    const key = `${row.layer}|${row.gap_type}`;
    summary[key] = (summary[key] || 0) + 1;
  }
}

// MASTER.csv
const out = [HEADER.join(',')];
for (const r of allRows) out.push(HEADER.map(h => csvCell(r[h])).join(','));
fs.writeFileSync(path.join(DIR, 'MASTER.csv'), out.join('\n') + '\n');

// Stats
const layers = ['A','B','C','D1','D2','E'];
const layerLabel = {A:'Electron IPC',B:'Web Data Layer',C:'Vercel API',D1:'UI POS',D2:'UI Admin/Settings/Verticals',E:'Background Jobs'};
function pct(n,d){return d?((n/d)*100).toFixed(1)+'%':'0%';}
const total = allRows.length;
const totalOk = allRows.filter(r => r.gap_type === 'ok').length;

let md = `# Terminal X — End-to-End Error Reporting Coverage\n\n`;
md += `Generated 2026-05-08 from ${FILES.length} layer audits.\n\n`;
md += `**Definition of WIRED:** action's failure path calls \`window.__txReportError(err, { severity, category, extra })\` (writes to Supabase \`client_errors\` + Sentry, surfaced in Admin → Client Detail → Errores tab). Toasts, flash messages, setState errors, console.error, alert(), and bare \`catch {}\` are NOT wired.\n\n`;
md += `## Coverage by layer\n\n`;
md += `| Layer | Description | Total | Wired | Coverage |\n|---|---|---:|---:|---:|\n`;
for (const L of layers) {
  const rows = allRows.filter(r => r.layer === L);
  const ok = rows.filter(r => r.gap_type === 'ok').length;
  md += `| ${L} | ${layerLabel[L]} | ${rows.length} | ${ok} | ${pct(ok,rows.length)} |\n`;
}
md += `| **All** | | **${total}** | **${totalOk}** | **${pct(totalOk,total)}** |\n\n`;

md += `## Gap distribution\n\n`;
const gapCounts = {};
for (const r of allRows) gapCounts[r.gap_type] = (gapCounts[r.gap_type]||0)+1;
const gapOrder = Object.keys(gapCounts).sort((a,b)=>gapCounts[b]-gapCounts[a]);
md += `| Gap Type | Count | % |\n|---|---:|---:|\n`;
for (const g of gapOrder) md += `| ${g} | ${gapCounts[g]} | ${pct(gapCounts[g],total)} |\n`;
md += `\n`;

md += `## Coverage matrix (layer × gap)\n\n`;
md += `| Layer |`;
for (const g of gapOrder) md += ` ${g} |`;
md += `\n|---|`;
for (const g of gapOrder) md += `---:|`;
md += `\n`;
for (const L of layers) {
  md += `| ${L} |`;
  for (const g of gapOrder) {
    const c = allRows.filter(r=>r.layer===L && r.gap_type===g).length;
    md += ` ${c||''} |`;
  }
  md += `\n`;
}
md += `\n`;

md += `## P0 — Highest priority gaps (fiscal / payment / sync / cert / DGII)\n\nUnwired actions in these categories should be wired immediately.\n\n`;
const p0Match = (r) => {
  const a = (r.action_id||'').toLowerCase();
  const c = (r.category||'').toLowerCase();
  const s = a + ' ' + c;
  return /dgii|ecf|ncf|cert|cobrar|payment|cobro|fiscal|sync|anecf|semilla|recepcion|aprobacion|firma|sign|p12|jwt|license|recon/.test(s);
};
const p0Gaps = allRows.filter(r => r.gap_type !== 'ok' && p0Match(r));
md += `**${p0Gaps.length} P0 gaps.** First 30 below; full list in MASTER.csv.\n\n`;
md += `| Layer | Action | File:Line | Gap | Fix |\n|---|---|---|---|---|\n`;
for (const r of p0Gaps.slice(0,30)) {
  md += `| ${r.layer} | ${r.action_id} | ${r.file}:${r.line} | ${r.gap_type} | ${r.fix_recommendation} |\n`;
}
md += `\n`;

md += `## P1 — High priority gaps (inventory / employees / settings / clients / mesas / kds)\n\n`;
const p1Match = (r) => {
  const a = (r.action_id||'').toLowerCase();
  const c = (r.category||'').toLowerCase();
  const s = a + ' ' + c;
  return /inventor|empleado|staff|user|setting|timezone|business|mi.empresa|client|mesa|kds|kitchen|fire|reservation|reserv|warranty|loan|appointment|stylist|membership|carniceria|dealership|vehicle|appraisal|preapproval|loyalty|whatsapp|backup|rebind|password|pin/.test(s) && !p0Match(r);
};
const p1Gaps = allRows.filter(r => r.gap_type !== 'ok' && p1Match(r));
md += `**${p1Gaps.length} P1 gaps.** First 30 below.\n\n`;
md += `| Layer | Action | File:Line | Gap | Fix |\n|---|---|---|---|---|\n`;
for (const r of p1Gaps.slice(0,30)) {
  md += `| ${r.layer} | ${r.action_id} | ${r.file}:${r.line} | ${r.gap_type} | ${r.fix_recommendation} |\n`;
}
md += `\n`;

md += `## P2 — Everything else\n\n`;
const p2Gaps = allRows.filter(r => r.gap_type !== 'ok' && !p0Match(r) && !p1Match(r));
md += `**${p2Gaps.length} P2 gaps.** See MASTER.csv.\n\n`;

md += `## Wire-up snippet templates\n\n`;
md += `### A. Electron IPC handler (electron/main.js)\n`;
md += '```js\nipcMain.handle(\'feature:action\', async (_e, payload) => {\n  try {\n    const result = await db.doThing(payload);\n    return { ok: true, data: result };\n  } catch (err) {\n    db.activityLogRecord({ event_type:\'feature_action_fail\', severity:\'critical\', target_type:\'feature\', reason: err.message });\n    captureSentryException?.(err, { tags: { ipc:\'feature:action\' }});\n    return { ok: false, error: err.message };\n  }\n});\n```\nRenderer caller MUST also do:\n```js\nconst res = await window.electronAPI.feature.action(payload);\nif (!res?.ok) {\n  window.__txReportError?.(res?.error || \'feature:action failed\', { severity:\'error\', category:\'ipc.feature.action\', extra:{ payload }});\n  flash(\'Error: \' + res?.error);\n}\n```\n\n';
md += `### B. Web data-layer write (packages/data/web.js)\n`;
md += '```js\n// BEFORE (unwired — tryOr swallows)\nasync update(id, patch) { return tryOr(async () => { await sb.from(\'x\').update(patch).eq(\'id\', id); return true; }, false); }\n\n// AFTER (wired — tryWrite throws, caller reports)\nasync update(id, patch) { return tryWrite(async () => { const { error } = await sb.from(\'x\').update(patch).eq(\'id\', id); if (error) throw error; return true; }); }\n```\nUI caller:\n```js\ntry { await api.x.update(id, patch); flash(\'Guardado\'); }\ncatch (err) {\n  window.__txReportError?.(err, { severity:\'error\', category:\'web.x.update\', extra:{ id }});\n  setError(err.message);\n}\n```\n\n';
md += `### C. Vercel API route (web/api/panel.js)\n`;
md += '```js\ncase \'feature_action\': {\n  try {\n    return await handleFeatureAction(req, res);\n  } catch (err) {\n    // server-side: write to client_errors directly\n    await sbAdmin.from(\'client_errors\').insert({\n      business_id: req.headers[\'x-business-id\'] || null,\n      message: err.message, stack: err.stack,\n      route: \'/api/panel?action=feature_action\',\n      severity:\'error\', metadata:{ platform:\'api\', action:\'feature_action\' }\n    });\n    return res.status(500).json({ error: err.message });\n  }\n}\n```\nClient caller:\n```js\nconst r = await fetch(\'/api/panel?action=feature_action\', { method:\'POST\', body });\nif (!r.ok) {\n  const txt = await r.text();\n  window.__txReportError?.(\'feature_action 5xx \' + txt, { severity:\'error\', category:\'api.feature_action\' });\n}\n```\n\n';
md += `### D. UI mutation handler (any screen)\n`;
md += '```jsx\nasync function handleSave() {\n  try {\n    setLoading(true);\n    await api.x.update(id, form);\n    showToast(\'Guardado\', \'success\');\n  } catch (err) {\n    window.__txReportError?.(err, { severity:\'error\', category:\'screen.x.save\', extra:{ id, form }});\n    showToast(err.message, \'error\');\n  } finally { setLoading(false); }\n}\n```\n\n';
md += `### E. Background job (electron/sync.js, setInterval handlers, cron jobs)\n`;
md += '```js\nasync function syncTick() {\n  try { await pushAll(); await pullAll(); }\n  catch (err) {\n    captureSentryException?.(err, { tags:{ background:\'sync.tick\' }});\n    db.activityLogRecord({ event_type:\'sync_tick_fail\', severity:\'critical\', reason: err.message });\n    // Also POST to /api/panel?action=report_error so admin Errores panel sees it\n    fetch(\'${SUPABASE_URL}/api/panel?action=report_error\', { method:\'POST\', body: JSON.stringify({ business_id, severity:\'error\', message: err.message, route:\'background:sync.tick\', metadata:{ platform:\'desktop\', category:\'sync.tick\' }})});\n  }\n}\nsetInterval(() => { syncTick().catch(() => {}); }, 5 * 60 * 1000);\n```\n\n';

md += `## Category taxonomy\n\nUse these \`category\` strings consistently when calling \`__txReportError\` so the Errores panel can group:\n\n`;
md += `- **POS:** \`pos.cart.add\`, \`pos.cart.update_qty\`, \`pos.cart.remove\`, \`pos.payment.confirm\`, \`pos.queue.encolar\`, \`pos.client.select\`\n`;
md += `- **Restaurant:** \`restaurant.fire_kds\`, \`restaurant.request_bill\`, \`restaurant.precuenta\`, \`restaurant.split_bill\`, \`restaurant.transfer_mesa\`, \`restaurant.merge_mesa\`, \`mesa.set_status\`, \`reservation.create\`, \`reservation.cancel\`, \`kds.advance\`, \`kds.recall\`\n`;
md += `- **Cobrar/Cobro:** \`cobrar.submit\`, \`cobrar.ncf.allocate\`, \`cobrar.ecf.sign\`, \`cobrar.ecf.submit\`, \`cobrar.loyalty.redeem\`\n`;
md += `- **DGII:** \`dgii.submit\`, \`dgii.semilla\`, \`dgii.cert.install\`, \`dgii.cert.export\`, \`dgii.anecf.queue\`, \`dgii.reconcile\`, \`dgii.creds.save\`, \`dgii.auth.test\`\n`;
md += `- **Settings:** \`settings.timezone\`, \`settings.business_name\`, \`settings.itbis\`, \`settings.printer\`, \`settings.whatsapp\`, \`settings.feature_toggle\`\n`;
md += `- **Inventory:** \`inventory.create\`, \`inventory.update\`, \`inventory.delete\`, \`inventory.adjust\`, \`inventory.bulk_update\`, \`inventory.count.start\`, \`inventory.count.save_item\`, \`inventory.count.complete\`, \`inventory.import\`\n`;
md += `- **Employees:** \`empleado.save\`, \`empleado.delete\`, \`empleado.toggle_active\`, \`empleado.payroll_run\`, \`empleado.commission_pay\`\n`;
md += `- **Clients:** \`client.create\`, \`client.update\`, \`client.delete\`, \`client.note.add\`, \`client.credit.adjust\`\n`;
md += `- **License:** \`license.set_key\`, \`license.refresh_jwt\`, \`license.rebind\`\n`;
md += `- **Sync:** \`sync.tick\`, \`sync.push.<table>\`, \`sync.pull.<table>\`, \`sync.activity_log.drain\`\n`;
md += `- **Background:** \`background.backup.nightly\`, \`background.rnc.sync\`, \`background.anecf.drain\`, \`background.dgii.reconcile\`, \`background.digest.daily\`, \`background.salon.reminder\`\n`;
md += `\n`;

md += `## Verification\n\n- Open MASTER.csv. Filter by \`gap_type\` to triage.\n- Spot-check 10 \`swallowed_catch\` rows — confirm the catch is real (not OK with a sibling reporter).\n- Re-run \`node scripts/aggregate-error-coverage.mjs\` after each batch of fixes. Coverage % should rise.\n- Goal: P0 ≥ 95%, P1 ≥ 80%, P2 ≥ 60% wired.\n`;

fs.writeFileSync(path.join(DIR, 'REPORT.md'), md);

console.log('TOTAL ROWS:', total);
console.log('WIRED (ok):', totalOk, pct(totalOk,total));
console.log('Per layer:');
for (const L of layers) {
  const rows = allRows.filter(r => r.layer === L);
  const ok = rows.filter(r => r.gap_type === 'ok').length;
  console.log(`  ${L} ${layerLabel[L]}: ${ok}/${rows.length} (${pct(ok,rows.length)})`);
}
console.log('Gap distribution:');
for (const g of gapOrder) console.log(`  ${g}: ${gapCounts[g]}`);
console.log('P0 gaps:', p0Gaps.length, '| P1 gaps:', p1Gaps.length, '| P2 gaps:', p2Gaps.length);
console.log('\nWritten:', path.join(DIR, 'MASTER.csv'));
console.log('Written:', path.join(DIR, 'REPORT.md'));
