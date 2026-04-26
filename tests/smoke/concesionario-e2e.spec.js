// Dealership (concesionario) deep E2E audit against terminalxpos.com
// Sweeps every sidebar item + dealership-specific screens, captures console/network
// issues, then logs out and re-logs in to verify session integrity.
// Usage: npx playwright test tests/smoke/concesionario-e2e.spec.js --reporter=list

import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://terminalxpos.com';
const EMAIL = 'admin@dealership.demo.terminalxpos.com';
const PASSWORD = 'Demo2026!';
const PIN = '1234';

const ROUTES = [
  '/pos',
  '/pos/queue',
  '/pos/clients',
  '/pos/credits',
  '/pos/reports',
  '/pos/inventory',
  '/pos/dgii',
  '/pos/cash-recon',
  '/pos/petty-cash',
  '/pos/credit-notes',
  '/pos/empleados',
  '/pos/empleados/adelantos',
  '/pos/empleados/pagos',
  '/pos/remote',
  '/pos/invoicing',
  '/pos/invoicing/create',
  '/pos/invoicing/history',
  '/pos/admin',
  '/pos/sistema',
  // dealership-specific
  '/pos/vehicle-inventory',
  '/pos/sales-pipeline',
  '/pos/test-drives',
  '/pos/deal-builder',
  '/pos/matriculas',
  '/pos/reservations',
  '/pos/warranties',
  '/pos/preapprovals',
  '/pos/reports/concesionario-comisiones',
  '/pos/reports/concesionario-aging',
];

const OUT_DIR = path.join(__dirname, 'results', 'concesionario');
const FINAL_DIR = path.join(__dirname, '..', '..', 'test-results', 'concesionario');
fs.mkdirSync(OUT_DIR, { recursive: true });
const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';

function isNoise(url) {
  return /google-analytics|googletagmanager|google\.com\/g\/collect|googleadservices|doubleclick|gstatic/i.test(url || '');
}
function isNoiseText(t) {
  return /google-analytics|googletagmanager|google\.com\/g\/collect|gtag/i.test(t || '');
}

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
    await page.waitForFunction(() => /Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 8000 });
  } catch { return false; }
  for (const d of PIN.split('')) { await page.keyboard.press(d); await page.waitForTimeout(80); }
  await page.waitForFunction(() => !/Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 15_000 }).catch(() => {});
  return true;
}

async function login(page) {
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await passSupabaseGate(page, EMAIL);
  await page.waitForTimeout(800);
  await passPinGate(page);
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  return page.locator('aside, nav').first().isVisible().catch(() => false);
}

async function classify(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => {
    const root = document.querySelector('#root') || document.body;
    const text = (root?.innerText || '').trim();
    const lower = text.toLowerCase();
    return {
      len: text.length,
      hasPinGate: /ingresa tu pin/i.test(text),
      hasEmailGate: !!document.querySelector('input[type="email"]'),
      hasLock: /disponible en pro|actualizar plan|requiere plan|función bloqueada/i.test(text),
      hasError: /algo salió mal|something went wrong|error boundary|ocurrió un error|unexpected error/i.test(text),
      has404: /\b404\b|no encontrado|not found|página no existe/i.test(lower),
      hasLoader: /cargando|loading/i.test(lower) && text.length < 100,
      hasI18nLeak: /\b[a-z]+\.[a-z]+\.[a-z]+\b/.test(text) && /\w+\.\w+\.\w+(?:\s|$)/m.test(text),
      hasSidebar: !!document.querySelector('aside, nav'),
      snippet: text.slice(0, 260),
    };
  });
  let status = 'loaded';
  if (info.hasPinGate || info.hasEmailGate) status = 'auth_lost';
  else if (info.hasError || info.has404) status = 'errored';
  else if (info.hasLock) status = 'locked';
  else if (info.hasLoader) status = 'empty';
  else if (info.len < 60) status = 'errored';
  return { status, ...info };
}

test('concesionario deep E2E', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const networkFails = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text().slice(0, 500);
    if (!isNoiseText(t)) consoleErrors.push({ text: t, at: page.url() });
  });
  page.on('pageerror', (e) => consoleErrors.push({ text: `PAGEERROR: ${e.message}`.slice(0, 500), at: page.url() }));
  page.on('requestfailed', (r) => {
    if (isNoise(r.url())) return;
    networkFails.push({ url: r.url().slice(0, 240), failure: r.failure()?.errorText, at: page.url() });
  });
  page.on('response', (r) => {
    if (isNoise(r.url())) return;
    if (r.status() >= 400) networkFails.push({ url: r.url().slice(0, 240), status: r.status(), at: page.url() });
  });

  const authed = await login(page);
  try { await page.screenshot({ path: path.join(OUT_DIR, '_auth.png') }); } catch {}

  const perRoute = {};
  for (const route of ROUTES) {
    const eBefore = consoleErrors.length;
    const nBefore = networkFails.length;
    let cls = { status: 'errored', snippet: '', len: 0 };
    let landed = '';
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      landed = page.url();
      cls = await classify(page);
    } catch (e) {
      cls = { status: 'errored', snippet: `NAV_ERROR: ${e.message}`.slice(0, 240), len: 0 };
    }
    const shot = path.join(OUT_DIR, `${safe(route)}.png`);
    try { await page.screenshot({ path: shot }); } catch {}
    perRoute[route] = {
      status: cls.status,
      snippet: cls.snippet,
      bodyLen: cls.len,
      landedUrl: landed,
      urlMatched: landed.includes(route),
      hasI18nLeak: !!cls.hasI18nLeak,
      newConsoleErrors: consoleErrors.slice(eBefore).slice(0, 5),
      newNetworkFails:  networkFails.slice(nBefore).slice(0, 5),
    };
    await page.waitForTimeout(250);
  }

  // --- Logout + re-login check ---
  let relogin = { attempted: false, success: false, note: '' };
  try {
    relogin.attempted = true;
    await page.goto(`${BASE}/pos/sistema`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    // Try any button with "Cerrar" / "Salir" / "Logout"
    const logoutBtn = page.locator('button', { hasText: /cerrar sesión|cerrar sesion|salir|logout/i }).first();
    if (await logoutBtn.count()) {
      await logoutBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
    } else {
      // Fallback: clear storage + reload
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    }
    try { await page.screenshot({ path: path.join(OUT_DIR, '_post_logout.png') }); } catch {}
    const ok = await login(page);
    relogin.success = !!ok;
    try { await page.screenshot({ path: path.join(OUT_DIR, '_relogin.png') }); } catch {}
  } catch (e) {
    relogin.note = e.message.slice(0, 200);
  }

  const out = {
    account: EMAIL,
    vertical: 'concesionario',
    authed,
    ranAt: new Date().toISOString(),
    routes: perRoute,
    relogin,
    totalConsoleErrors: consoleErrors.length,
    totalNetworkFails: networkFails.length,
    allConsoleErrors: consoleErrors.slice(0, 40),
    allNetworkFails: networkFails.slice(0, 40),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(out, null, 2));
  // Copy everything to the canonical test-results/concesionario folder
  try {
    fs.mkdirSync(FINAL_DIR, { recursive: true });
    for (const f of fs.readdirSync(OUT_DIR)) {
      fs.copyFileSync(path.join(OUT_DIR, f), path.join(FINAL_DIR, f));
    }
  } catch {}
  await ctx.close();
});
