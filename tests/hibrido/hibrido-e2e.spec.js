// Hibrido deep E2E audit (services + retail combined).
// Validates: mode toggle, cross-mode tickets, unified ventas, shared commissions,
// combined catalog, every sidebar route, logout+relogin.
//
// Usage: npx playwright test tests/hibrido --reporter=list

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://terminalxpos.com';
const EMAIL = 'admin@hybrid.demo.terminalxpos.com';
const PASSWORD = 'Demo2026!';
const PIN = '1234';

const ROUTES = [
  '/pos', '/pos/queue', '/pos/mesas', '/pos/catalogo', '/pos/kds',
  '/pos/clients', '/pos/credits', '/pos/reports', '/pos/inventory',
  '/pos/dgii', '/pos/cash-recon', '/pos/petty-cash', '/pos/credit-notes',
  '/pos/empleados', '/pos/empleados/adelantos', '/pos/empleados/pagos',
  '/pos/remote', '/pos/invoicing', '/pos/invoicing/create',
  '/pos/invoicing/history', '/pos/admin', '/pos/sistema',
];

const OUT_DIR = path.join(__dirname, '..', '..', 'test-results', 'hibrido');
fs.mkdirSync(OUT_DIR, { recursive: true });

const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
const noise = /google-analytics|googletagmanager|google\.com\/g\/collect|gtag|doubleclick|gstatic/i;

async function passSupabaseGate(page, email) {
  const emailInput = page.locator('input[type="email"]').first();
  try { await emailInput.waitFor({ state: 'visible', timeout: 6000 }); } catch { return false; }
  await emailInput.fill(email);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  const submit = page.locator('button[type="submit"]').first();
  if (await submit.count()) await submit.click();
  else await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 25_000 }).catch(() => {});
  return true;
}
async function passPinGate(page) {
  try {
    await page.waitForFunction(() => /Ingresa tu PIN|Iniciar sesión con usuario/i.test(document.body.innerText || ''), null, { timeout: 8000 });
  } catch { return false; }
  for (const d of PIN.split('')) { await page.keyboard.press(d); await page.waitForTimeout(80); }
  await page.waitForFunction(() => !/Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 15_000 }).catch(() => {});
  return true;
}
async function login(page) {
  // Cache-bust to dodge stale edge HTML that references deleted bundle chunks.
  const buster = `?_t=${Date.now()}`;
  await page.goto(`${BASE}/pos${buster}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await passSupabaseGate(page, EMAIL);
  await page.waitForTimeout(1500);
  await passPinGate(page);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Check via text rather than aside (shell may not mount aside in headless)
  const text = await page.evaluate(() => (document.body.innerText || '').slice(0, 2000));
  return /POS|Cola|Clientes|TERMINAL/i.test(text);
}

async function classify(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const root = document.querySelector('#root') || document.body;
    const text = (root?.innerText || '').trim();
    const lower = text.toLowerCase();
    const len = text.length;
    const hasPinGate = /ingresa tu pin/i.test(text);
    const hasEmailGate = !!document.querySelector('input[type="email"]');
    const hasLock = /disponible en pro|actualizar plan|requiere plan|función bloqueada/i.test(text);
    const hasErr  = /algo salió mal|something went wrong|error boundary|ocurrió un error/i.test(text);
    const has404  = /\b404\b|no encontrado|not found|página no existe/i.test(lower);
    const hasLoader = /cargando|loading/i.test(lower) && len < 100;
    const hasEmpty  = /no hay|sin datos|sin registros|aún no/i.test(lower) && len < 600;
    // i18n leaks — English strings in a Spanish app
    const i18nLeaks = [];
    const engProbes = ['Loading...', 'Something went wrong', 'Not found', 'No data', 'Save changes'];
    for (const p of engProbes) if (text.includes(p)) i18nLeaks.push(p);
    let status = 'loaded';
    if (hasPinGate || hasEmailGate) status = 'auth_lost';
    else if (hasErr || has404) status = 'errored';
    else if (hasLock) status = 'locked';
    else if (hasLoader || hasEmpty) status = 'empty';
    else if (len < 60) status = 'errored';
    return { status, len, i18nLeaks, snippet: text.slice(0, 260) };
  });
}

test('hibrido deep E2E', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const networkFails  = [];
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text().slice(0, 500);
      if (!noise.test(t)) consoleErrors.push({ t, at: page.url() });
    }
  });
  page.on('pageerror', (e) => consoleErrors.push({ t: `PAGEERROR: ${e.message}`.slice(0, 500), at: page.url() }));
  page.on('requestfailed', (r) => {
    const u = r.url(); if (noise.test(u)) return;
    networkFails.push({ u: u.slice(0, 220), err: r.failure()?.errorText, at: page.url() });
  });
  page.on('response', (r) => {
    const u = r.url(); if (noise.test(u)) return;
    if (r.status() >= 400) networkFails.push({ u: u.slice(0, 220), status: r.status(), at: page.url() });
  });

  const authed = await login(page);
  await page.screenshot({ path: path.join(OUT_DIR, '_auth.png') }).catch(() => {});

  // --- Hybrid-specific inspection on /pos ---
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const hybridPos = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      hasMesaToggle:    /\bMesa\b/.test(text),
      hasDirectaToggle: /Venta Directa/i.test(text),
      hasServicesTab:   /Servicios/i.test(text),
      hasProductsTab:   /Productos|Inventario/i.test(text),
    };
  });
  await page.screenshot({ path: path.join(OUT_DIR, 'pos_hybrid_toggle.png') }).catch(() => {});

  // Toggle to Venta Directa
  try {
    await page.getByRole('button', { name: /Venta Directa/i }).first().click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT_DIR, 'pos_directa.png') }).catch(() => {});
  } catch {}
  // Toggle back to Mesa
  try {
    await page.getByRole('button', { name: /^Mesa$/i }).first().click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT_DIR, 'pos_mesa.png') }).catch(() => {});
  } catch {}

  // --- Catalogo inspection (combined services+products picker) ---
  await page.goto(`${BASE}/pos/catalogo`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const catalog = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      hasMenu:     /Menu|Menú/i.test(text),
      hasProducts: /Productos|Inventario/i.test(text),
      bodyLen:     text.length,
    };
  });
  await page.screenshot({ path: path.join(OUT_DIR, 'catalogo.png') }).catch(() => {});

  // --- Reportes inspection (unified ventas: servicios + productos) ---
  await page.goto(`${BASE}/pos/reports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const reports = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      hasServicios:   /Servicios/i.test(text),
      hasProductos:   /Productos/i.test(text),
      hasComisiones:  /Comisiones|Comisión/i.test(text),
      hasVentas:      /Ventas/i.test(text),
      bodyLen:        text.length,
    };
  });
  await page.screenshot({ path: path.join(OUT_DIR, 'reports.png') }).catch(() => {});

  // --- Route sweep ---
  const perRoute = {};
  for (const route of ROUTES) {
    const eBefore = consoleErrors.length;
    const nBefore = networkFails.length;
    let cls = { status: 'errored', snippet: '', len: 0, i18nLeaks: [] };
    let landed = '';
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      landed = page.url();
      cls = await classify(page);
    } catch (e) {
      cls.snippet = `NAV_ERROR: ${e.message}`.slice(0, 240);
    }
    const shot = path.join(OUT_DIR, `${safe(route)}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    perRoute[route] = {
      status: cls.status, bodyLen: cls.len, i18nLeaks: cls.i18nLeaks,
      snippet: cls.snippet, landedUrl: landed, urlMatched: landed.includes(route),
      newConsoleErrors: consoleErrors.slice(eBefore).slice(0, 5),
      newNetworkFails:  networkFails.slice(nBefore).slice(0, 5),
    };
    await page.waitForTimeout(250);
  }

  // --- Logout + re-login ---
  let logoutOk = false, reloginOk = false;
  try {
    await page.goto(`${BASE}/pos/sistema`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const btn = page.getByRole('button', { name: /Cerrar sesión|Logout|Salir/i }).first();
    if (await btn.count()) {
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(2000);
      logoutOk = /Ingresa tu PIN|input\[type="email"\]/i.test(await page.content()) ||
                 !!(await page.locator('input[type="email"]').count()) ||
                 /Ingresa tu PIN/.test(await page.evaluate(() => document.body.innerText || ''));
    }
  } catch {}
  await page.screenshot({ path: path.join(OUT_DIR, '_after_logout.png') }).catch(() => {});
  try {
    reloginOk = await login(page);
  } catch {}

  const report = {
    account: EMAIL, vertical: 'hibrido', ranAt: new Date().toISOString(),
    authed, logoutOk, reloginOk,
    hybridPos, catalog, reports,
    totalConsoleErrors: consoleErrors.length,
    totalNetworkFails:  networkFails.length,
    consoleErrors: consoleErrors.slice(0, 80),
    networkFails:  networkFails.slice(0, 80),
    routes: perRoute,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await ctx.close();

  expect(authed).toBeTruthy();
});
