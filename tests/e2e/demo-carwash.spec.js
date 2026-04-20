// Deep E2E — CARWASH demo on terminalxpos.com
// Focus: washer commissions, Queue->Cobrar, cuadre multi-payment, inventory oversell,
// logout/re-login session cleanliness.
//
// Usage: npx playwright test tests/e2e/demo-carwash.spec.js --reporter=list --config tests/e2e/pw.config.mjs
//        (falls back to root playwright.config.mjs testDir override via CLI)

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://terminalxpos.com';
const EMAIL = 'admin@carwash.demo.terminalxpos.com';
const PASSWORD = 'Demo2026!';
const PIN = '1234';

const OUT = path.resolve(__dirname, '../../test-results/carwash');
fs.mkdirSync(OUT, { recursive: true });

const SIDEBAR_ROUTES = [
  '/pos', '/pos/queue', '/pos/clients', '/pos/credits', '/pos/memberships',
  '/pos/inventory', '/pos/credit-notes', '/pos/cash-recon', '/pos/petty-cash',
  '/pos/empleados', '/pos/empleados/adelantos', '/pos/empleados/pagos',
  '/pos/reports', '/pos/dgii', '/pos/invoicing', '/pos/invoicing/history',
  '/pos/remote', '/pos/admin', '/pos/sistema',
];

function isNoise(url) {
  return /google-analytics|googletagmanager|google\.com\/g\/collect|gstatic\.com|doubleclick\.net/.test(url || '');
}

async function passSupabaseGate(page) {
  const email = page.locator('input[type="email"]').first();
  try { await email.waitFor({ state: 'visible', timeout: 8000 }); } catch { return false; }
  await email.fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  const btn = page.locator('button[type="submit"]').first();
  if (await btn.count()) await btn.click(); else await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 30_000 }).catch(()=>{});
  return true;
}
async function passPin(page) {
  try {
    await page.waitForFunction(() => /Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 8000 });
  } catch { return false; }
  for (const d of PIN.split('')) { await page.keyboard.press(d); await page.waitForTimeout(90); }
  await page.waitForFunction(() => !/Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 15_000 }).catch(()=>{});
  return true;
}
async function login(page) {
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(()=>{});
  await passSupabaseGate(page);
  await page.waitForTimeout(600);
  await passPin(page);
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(()=>{});
  return await page.locator('aside, nav').first().isVisible().catch(()=>false);
}

test.describe.configure({ mode: 'serial' });

test('carwash deep E2E', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const findings = [];
  const consoleErrors = [];
  const net = [];
  const i18nLeaks = [];

  page.on('console', m => {
    if (m.type() === 'error') {
      const t = m.text().slice(0, 400);
      if (!isNoise(t)) consoleErrors.push({ t, url: page.url() });
    }
  });
  page.on('pageerror', e => consoleErrors.push({ t: `PAGEERROR: ${e.message}`, url: page.url() }));
  page.on('requestfailed', r => {
    if (!isNoise(r.url())) net.push({ url: r.url().slice(0,200), err: r.failure()?.errorText, at: page.url() });
  });
  page.on('response', r => {
    const u = r.url();
    if (isNoise(u)) return;
    if (r.status() >= 400 && !/auth\/v1\/token/.test(u)) {
      net.push({ url: u.slice(0,200), status: r.status(), at: page.url() });
    }
  });

  const authed = await login(page);
  await page.screenshot({ path: path.join(OUT, '00-auth.png') });
  findings.push({ step: 'auth', ok: authed });

  // Sweep sidebar routes
  for (const route of SIDEBAR_ROUTES) {
    const errBefore = consoleErrors.length;
    const netBefore = net.length;
    let info = {};
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(()=>{});
      await page.waitForTimeout(900);
      info = await page.evaluate(() => {
        const main = document.querySelector('main') || document.querySelector('#root');
        const text = (main?.innerText || '').trim();
        const html = main?.innerHTML || '';
        const leaks = (text.match(/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/g) || []).slice(0, 5);
        const err = /algo salió mal|something went wrong|error boundary|unexpected error/i.test(text);
        const blank = text.length < 40 && html.length < 200;
        return { len: text.length, leaks, err, blank, snippet: text.slice(0, 160) };
      });
      if (info.leaks.length) i18nLeaks.push({ route, leaks: info.leaks });
    } catch (e) {
      info = { err: true, snippet: `NAV_ERR: ${e.message}` };
    }
    const safe = route.replace(/[^a-z0-9]+/gi,'_');
    await page.screenshot({ path: path.join(OUT, `r_${safe}.png`) }).catch(()=>{});
    findings.push({
      step: 'route', route,
      status: info.err ? 'errored' : info.blank ? 'blank' : 'ok',
      len: info.len, i18nLeaks: info.leaks || [],
      newErrors: consoleErrors.slice(errBefore).length,
      newNet: net.slice(netBefore).length,
      snippet: info.snippet,
    });
  }

  // --- Carwash-specific deep checks via DOM probe ---

  // 1) Reports zero-data anomaly check
  await page.goto(`${BASE}/pos/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(1500);
  const reportsInfo = await page.evaluate(() => {
    const text = document.body.innerText || '';
    // Look for ticket counts / totals
    const ticketMatch = text.match(/(\d+)\s*(tickets?|lavados?|ventas?)/i);
    return { hasData: /RD\$\s*[1-9]/.test(text), ticketMatch: ticketMatch?.[0] || null, len: text.length };
  });
  findings.push({ step: 'reports-data', ...reportsInfo });

  // 2) Cuadre multi-payment visibility (ES/EN post v2.12.0 fix)
  await page.goto(`${BASE}/pos/cash-recon`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(1200);
  const cuadreInfo = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const methods = ['Efectivo','Tarjeta','Transferencia','cash','card','transfer'];
    const present = methods.filter(m => new RegExp(`\\b${m}\\b`, 'i').test(text));
    const englishLeak = /\b(cash|card|transfer)\b/i.test(text) && !/efectivo/i.test(text);
    return { methods: present, englishLeak, len: text.length };
  });
  findings.push({ step: 'cuadre-methods', ...cuadreInfo });
  await page.screenshot({ path: path.join(OUT, 'cuadre.png') });

  // 3) Queue screen — check washer assignment UI presence
  await page.goto(`${BASE}/pos/queue`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(1200);
  const queueInfo = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      hasWasherUi: /lavador|washer/i.test(text),
      hasListo: /listo|ready/i.test(text),
      hasEnCola: /en cola|cola/i.test(text),
      ticketRows: document.querySelectorAll('[class*="ticket"], [data-ticket-id], tr').length,
      len: text.length,
    };
  });
  findings.push({ step: 'queue-ui', ...queueInfo });
  await page.screenshot({ path: path.join(OUT, 'queue.png') });

  // 4) Inventory — oversell detection via UI probe (zero-stock items visible?)
  await page.goto(`${BASE}/pos/inventory`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(1500);
  const invInfo = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr'));
    const zeroStock = rows.filter(r => /\b0\b/.test(r.innerText) && /stock|existencia/i.test(r.innerText)).length;
    return { rowCount: rows.length, zeroStock, len: (document.body.innerText||'').length };
  });
  findings.push({ step: 'inventory-probe', ...invInfo });

  // 5) POS screen — confirm CarWashPOS loaded (service grid)
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(()=>{});
  await page.waitForTimeout(1500);
  const posInfo = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      isCarwashPOS: /vehiculo|placa|lavador/i.test(text),
      isRetailPOS: /SKU|codigo de barra|barcode/i.test(text),
      serviceBtns: document.querySelectorAll('button').length,
      len: text.length,
    };
  });
  findings.push({ step: 'pos-shell', ...posInfo });
  await page.screenshot({ path: path.join(OUT, 'pos.png') });

  // 6) Logout → re-login cleanliness
  // Try clicking logout in sidebar / sistema
  await page.goto(`${BASE}/pos/sistema`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const logoutBtn = page.locator('button:has-text("Cerrar sesión"), button:has-text("Logout"), button:has-text("Salir")').first();
  let logoutOk = false;
  if (await logoutBtn.count()) {
    try {
      await logoutBtn.click({ timeout: 3000 });
      await page.waitForTimeout(1500);
      // Confirm dialog?
      const confirmBtn = page.locator('button:has-text("Sí"), button:has-text("Confirmar"), button:has-text("Aceptar")').first();
      if (await confirmBtn.count()) await confirmBtn.click().catch(()=>{});
      await page.waitForTimeout(2000);
      logoutOk = true;
    } catch {}
  }
  findings.push({ step: 'logout-clicked', ok: logoutOk });

  const netBeforeRelogin = net.length;
  const errBeforeRelogin = consoleErrors.length;
  const reauthed = await login(page);
  const reloginErrors = consoleErrors.slice(errBeforeRelogin);
  const reloginNet = net.slice(netBeforeRelogin);
  const failedToFetch = reloginErrors.some(e => /failed to fetch/i.test(e.t)) || reloginNet.some(n => /failed to fetch/i.test(n.err || ''));
  findings.push({ step: 'relogin', ok: reauthed, failedToFetch, reloginErrors: reloginErrors.length, reloginNet: reloginNet.length });
  await page.screenshot({ path: path.join(OUT, 'relogin.png') });

  // Write full report
  const report = {
    vertical: 'carwash',
    ranAt: new Date().toISOString(),
    authed, reauthed,
    totalConsoleErrors: consoleErrors.length,
    totalNetFails: net.length,
    i18nLeaks,
    findings,
    consoleErrors: consoleErrors.slice(0, 50),
    networkFails: net.slice(0, 50),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  await ctx.close();
  expect(authed).toBeTruthy();
});
