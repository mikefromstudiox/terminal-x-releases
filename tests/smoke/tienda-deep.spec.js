// Tienda-specific deep E2E — v2.4.0 / v2.5.0 / v2.12.x features
// Run: npx playwright test tests/smoke/tienda-deep.spec.js --reporter=list
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://terminalxpos.com';
const EMAIL = 'admin@retail.demo.terminalxpos.com';
const PASSWORD = 'Demo2026!';
const PIN = '1234';

const OUT_DIR = path.resolve(__dirname, '..', '..', 'test-results', 'tienda');
fs.mkdirSync(OUT_DIR, { recursive: true });

const findings = [];
const log = (step, status, detail = {}) => {
  findings.push({ step, status, ...detail, at: new Date().toISOString() });
  console.log(`[${status}] ${step}`, detail.note || '');
};

function isNoise(u) {
  return /google-analytics|googletagmanager|google\.com\/g\/collect|doubleclick|gstatic|googleads|fonts\.(google|gstatic)/.test(u || '');
}

async function snap(page, name) {
  try { await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false }); } catch {}
}

async function passSupabase(page) {
  const email = page.locator('input[type="email"]').first();
  try { await email.waitFor({ state: 'visible', timeout: 8000 }); } catch { return false; }
  await email.fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  const btn = page.locator('button[type="submit"]').first();
  if (await btn.count()) await btn.click(); else await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 25000 }).catch(() => {});
  return true;
}

async function passPin(page) {
  try {
    await page.waitForFunction(() => /Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 8000 });
  } catch { return false; }
  for (const d of PIN.split('')) { await page.keyboard.press(d); await page.waitForTimeout(80); }
  await page.waitForFunction(() => !/Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  return true;
}

test('tienda deep E2E', async ({ browser }) => {
  test.setTimeout(12 * 60_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const networkFails = [];
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text().slice(0, 500);
      if (!isNoise(t)) consoleErrors.push({ t, at: page.url() });
    }
  });
  page.on('pageerror', (e) => consoleErrors.push({ t: `PAGEERROR: ${e.message}`.slice(0, 500), at: page.url() }));
  page.on('requestfailed', (r) => {
    if (isNoise(r.url())) return;
    networkFails.push({ url: r.url().slice(0, 220), fail: r.failure()?.errorText, at: page.url() });
  });
  page.on('response', (r) => {
    if (isNoise(r.url())) return;
    if (r.status() >= 400) networkFails.push({ url: r.url().slice(0, 220), status: r.status(), at: page.url() });
  });

  // 1. LOGIN
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await passSupabase(page);
  await page.waitForTimeout(800);
  await passPin(page);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await snap(page, '01-login');
  const sidebar = await page.locator('aside, nav').first().isVisible().catch(() => false);
  log('login', sidebar ? 'ok' : 'fail', { note: sidebar ? 'sidebar visible' : 'no sidebar' });

  // Probe app_settings business_type through the DOM / localStorage
  const bizState = await page.evaluate(() => {
    return {
      bt: localStorage.getItem('biz.business_type') || localStorage.getItem('app.business_type') || null,
      keys: Object.keys(localStorage).slice(0, 40),
    };
  });
  log('business-type-probe', 'info', bizState);

  // 2. POS — barcode search + categorization + PY toggle
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await snap(page, '02-pos-initial');
  const posTxt = await page.evaluate(() => (document.querySelector('#root')?.innerText || '').slice(0, 2000));
  const hasCategoryTabs = /Todos|All|Categor/i.test(posTxt) && /\(\d+\)/.test(posTxt);
  const hasPYToggle = /Pedidos Ya/i.test(posTxt);
  const hasSearch = await page.locator('input[placeholder*="barra" i], input[placeholder*="SKU" i], input[placeholder*="código" i], input[placeholder*="buscar" i]').count();
  log('pos.category-tabs', hasCategoryTabs ? 'ok' : 'warn', { note: hasCategoryTabs ? 'tabs + counts visible' : 'category tabs not detected' });
  log('pos.pedidos-ya-toggle', hasPYToggle ? 'ok' : 'warn', { note: hasPYToggle ? 'PY toggle visible' : 'PY toggle missing' });
  log('pos.search-input', hasSearch ? 'ok' : 'warn', { note: `${hasSearch} search input(s)` });

  // Try typing into search + verify product grid still renders
  if (hasSearch) {
    const searchBox = page.locator('input[placeholder*="buscar" i], input[placeholder*="barra" i], input[placeholder*="SKU" i], input[placeholder*="código" i]').first();
    try {
      await searchBox.fill('a');
      await page.waitForTimeout(600);
      await snap(page, '03-pos-search');
      const afterLen = (await page.evaluate(() => (document.querySelector('#root')?.innerText || '').length));
      log('pos.search-filter', afterLen > 200 ? 'ok' : 'fail', { note: `body len ${afterLen}` });
      await searchBox.fill('');
    } catch (e) {
      log('pos.search-filter', 'fail', { note: e.message.slice(0, 120) });
    }
  }

  // Toggle PY if present and screenshot
  if (hasPYToggle) {
    try {
      const pyBtn = page.getByText(/Pedidos Ya/i).first();
      await pyBtn.click({ timeout: 4000 });
      await page.waitForTimeout(600);
      await snap(page, '04-pos-py-on');
      const onTxt = await page.evaluate(() => (document.querySelector('#root')?.innerText || '').slice(0, 500));
      log('pos.py-toggle-on', /Pedidos Ya/i.test(onTxt) ? 'ok' : 'warn', { note: 'toggle clicked' });
      await pyBtn.click().catch(() => {});
    } catch (e) {
      log('pos.py-toggle-click', 'warn', { note: e.message.slice(0, 120) });
    }
  }

  // 3. CLIENTS — look for per-client pricing UI hint (v2.5.0)
  await page.goto(`${BASE}/pos/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await snap(page, '05-clients');
  const clientsTxt = await page.evaluate(() => (document.querySelector('#root')?.innerText || ''));
  log('clients.load', clientsTxt.length > 200 ? 'ok' : 'fail', { len: clientsTxt.length });
  const hasClientPricingHint = /precio|pricing|override|tarifa/i.test(clientsTxt);
  log('clients.per-client-pricing-hint', hasClientPricingHint ? 'info' : 'info', { note: 'textual hint only — deeper modal requires row click' });

  // 4. INVENTORY — Items tab + Quiebres tab + CSV Import button
  await page.goto(`${BASE}/pos/inventory`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await snap(page, '06-inventory');
  const invTxt = await page.evaluate(() => (document.querySelector('#root')?.innerText || ''));
  const hasQuiebresTab = /Quiebres de stock|Stock shortages/i.test(invTxt);
  const hasCSVImport = /Importar CSV|Import CSV/i.test(invTxt);
  const hasConteo = /Conteo F[íi]sico|Physical count/i.test(invTxt);
  log('inventory.quiebres-tab', hasQuiebresTab ? 'ok' : 'warn');
  log('inventory.csv-import-btn', hasCSVImport ? 'ok' : 'warn');
  log('inventory.conteo-btn', hasConteo ? 'ok' : 'warn');

  // Click Quiebres tab if visible
  if (hasQuiebresTab) {
    try {
      await page.getByText(/Quiebres de stock|Stock shortages/i).first().click({ timeout: 4000 });
      await page.waitForTimeout(1000);
      await snap(page, '07-inventory-quiebres');
      const qTxt = await page.evaluate(() => (document.querySelector('#root')?.innerText || '').slice(0, 1500));
      log('inventory.quiebres-renders', qTxt.length > 100 ? 'ok' : 'fail', { snippet: qTxt.slice(0, 200) });
    } catch (e) {
      log('inventory.quiebres-click', 'fail', { note: e.message.slice(0, 120) });
    }
  }

  // Open Conteo Fisico panel (read-only — don't submit)
  if (hasConteo) {
    try {
      await page.getByText(/Conteo F[íi]sico|Physical count/i).first().click({ timeout: 4000 });
      await page.waitForTimeout(1500);
      await snap(page, '08-conteo-fisico');
      const cTxt = await page.evaluate(() => (document.querySelector('#root')?.innerText || '').slice(0, 1500));
      log('conteo-fisico.opens', cTxt.length > 100 ? 'ok' : 'fail', { snippet: cTxt.slice(0, 200) });
      // close modal with Escape
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) {
      log('conteo-fisico.open', 'warn', { note: e.message.slice(0, 120) });
    }
  }

  // Open CSV Import dialog (do not upload anything — just confirm dialog opens)
  if (hasCSVImport) {
    try {
      await page.getByText(/Importar CSV|Import CSV/i).first().click({ timeout: 4000 });
      await page.waitForTimeout(900);
      await snap(page, '09-csv-import');
      const d = await page.evaluate(() => (document.querySelector('#root')?.innerText || '').slice(0, 800));
      log('csv-import.dialog-opens', /CSV|Mapear|Previsualizar|Preview|Map/i.test(d) ? 'ok' : 'warn', { snippet: d.slice(0, 200) });
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) {
      log('csv-import.open', 'warn', { note: e.message.slice(0, 120) });
    }
  }

  // 5. SETTINGS — Tipo de Negocio + subtype selector (v2.12.0, 8 subtypes)
  await page.goto(`${BASE}/pos/settings`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
  // Most builds use /pos/sistema (Sistema) — try both
  const current = page.url();
  if (!/settings|sistema/i.test(current)) {
    await page.goto(`${BASE}/pos/sistema`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  await snap(page, '10-settings');
  const sTxt = await page.evaluate(() => (document.querySelector('#root')?.innerText || ''));
  const hasBizTypeSection = /Tipo de Negocio|Business Type/i.test(sTxt);
  log('settings.tipo-negocio', hasBizTypeSection ? 'ok' : 'warn');

  // Try to locate subtype selector — scan for keywords
  const subtypeKeywords = ['licorer', 'minimarket', 'colmado', 'farmacia', 'ferreter', 'ropa', 'repuesto', 'supermercado'];
  const foundSubtypes = subtypeKeywords.filter(k => new RegExp(k, 'i').test(sTxt));
  log('settings.tienda-subtypes', foundSubtypes.length >= 4 ? 'ok' : 'warn', { found: foundSubtypes });

  // 6. i18n leak scan — look for English placeholders in Spanish UI
  const allRoutesScan = [
    '/pos', '/pos/queue', '/pos/clients', '/pos/inventory', '/pos/reports',
    '/pos/credits', '/pos/credit-notes', '/pos/cash-recon', '/pos/petty-cash',
    '/pos/empleados', '/pos/dgii', '/pos/remote', '/pos/admin', '/pos/sistema',
    '/pos/returns', '/pos/invoicing',
  ];
  const leakPatterns = /(TODO|FIXME|undefined|\[object Object\]|NaN RD|RD\$NaN|Infinity|\{[a-z_]+\}|\$\{[^}]+\})/;
  const englishStrays = /\b(Loading|Please wait|Click here|Submit|Cancel|Save|Delete|Confirm|Error:|Warning:)\b/;
  const routeFindings = {};
  for (const r of allRoutesScan) {
    try {
      await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(900);
      const info = await page.evaluate(() => {
        const t = (document.querySelector('#root')?.innerText || '');
        return { len: t.length, sample: t.slice(0, 400), hasSidebar: !!document.querySelector('aside, nav') };
      });
      const leaks = (info.sample + ' ' + (await page.evaluate(() => (document.querySelector('#root')?.innerText || '').slice(0, 4000)))).match(leakPatterns);
      const fullText = await page.evaluate(() => (document.querySelector('#root')?.innerText || ''));
      const englishHits = fullText.match(englishStrays);
      const anomaly = info.len < 120 ? 'blank' : (leaks ? 'leak' : englishHits ? 'i18n-stray' : 'ok');
      routeFindings[r] = { len: info.len, anomaly, leak: leaks?.[0] || null, eng: englishHits?.[0] || null };
    } catch (e) {
      routeFindings[r] = { anomaly: 'nav-error', err: e.message.slice(0, 100) };
    }
  }
  log('route-sweep', 'info', { routes: routeFindings });

  // 7. LOGOUT + RE-LOGIN
  try {
    await page.goto(`${BASE}/pos/sistema`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(800);
    const logoutBtn = page.getByText(/Cerrar sesi[óo]n|Logout|Sign out/i).first();
    if (await logoutBtn.count()) {
      await logoutBtn.click({ timeout: 4000 });
      await page.waitForTimeout(1500);
      // Confirm if a dialog appears
      const confirmBtn = page.getByText(/Confirmar|S[íi],|Yes/i).first();
      if (await confirmBtn.count()) await confirmBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    await snap(page, '11-after-logout');
    // Re-login
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const reSupa = await passSupabase(page);
    await page.waitForTimeout(600);
    const rePin = await passPin(page);
    await page.waitForTimeout(1500);
    await snap(page, '12-relogin');
    const ok2 = await page.locator('aside, nav').first().isVisible().catch(() => false);
    log('relogin', ok2 ? 'ok' : 'warn', { reSupa, rePin });
  } catch (e) {
    log('logout-relogin', 'warn', { err: e.message.slice(0, 150) });
  }

  // 8. FINAL — write report
  const report = {
    account: EMAIL,
    ranAt: new Date().toISOString(),
    findings,
    totalConsoleErrors: consoleErrors.length,
    consoleErrors: consoleErrors.slice(0, 40),
    totalNetworkFails: networkFails.length,
    networkFails: networkFails.slice(0, 40),
    routeFindings,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== TIENDA DEEP E2E SUMMARY ===');
  console.log(`findings: ${findings.length}  consoleErrors: ${consoleErrors.length}  networkFails: ${networkFails.length}`);

  await ctx.close();
});
