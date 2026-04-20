// Deep E2E audit for the prestamos demo vertical.
// Walks sidebar + loans/pawn/collections + skipped screens (cuadre, credit-notes).
// Records console errors, 4xx/5xx, blank routes, i18n leaks.

import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://terminalxpos.com';
const EMAIL = 'admin@prestamos.demo.terminalxpos.com';
const PASSWORD = 'Demo2026!';
const PIN = '1234';

const OUT_DIR = path.resolve(__dirname, '..', '..', 'test-results', 'prestamos');
function ensureDir() { fs.mkdirSync(OUT_DIR, { recursive: true }); }
ensureDir();
function writeOut(name, data) {
  ensureDir();
  fs.writeFileSync(path.join(OUT_DIR, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

const ROUTES = [
  '/pos',
  '/pos/queue',
  '/pos/loans',
  '/pos/pawn-items',
  '/pos/collections',
  '/pos/clients',
  '/pos/credits',
  '/pos/reports',
  '/pos/inventory',
  '/pos/dgii',
  '/pos/cash-recon',      // seed skipped — should render No aplica, not crash
  '/pos/credit-notes',    // seed skipped — should render No aplica, not crash
  '/pos/petty-cash',
  '/pos/empleados',
  '/pos/remote',
  '/pos/invoicing',
  '/pos/admin',
  '/pos/sistema',
];

const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
const isNoise = (u) => /google-analytics|googletagmanager|google\.com\/g\/collect|googleadservices|doubleclick|gstatic/i.test(u || '');

async function supabaseGate(page) {
  const e = page.locator('input[type="email"]').first();
  try { await e.waitFor({ state: 'visible', timeout: 6000 }); } catch { return false; }
  await e.fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  const btn = page.locator('button[type="submit"]').first();
  if (await btn.count()) await btn.click(); else await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 25_000 }).catch(() => {});
  return true;
}
async function pinGate(page) {
  try {
    await page.waitForFunction(() => /Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 8000 });
  } catch { return false; }
  for (const d of PIN) { await page.keyboard.press(d); await page.waitForTimeout(80); }
  await page.waitForFunction(() => !/Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 15_000 }).catch(() => {});
  return true;
}
async function login(page) {
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await supabaseGate(page);
  await page.waitForTimeout(800);
  await pinGate(page);
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  return !!(await page.locator('aside, nav').first().isVisible().catch(() => false));
}

async function classify(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return await page.evaluate(() => {
    const root = document.querySelector('#root') || document.body;
    const text = (root?.innerText || '').trim();
    const len = text.length;
    const lower = text.toLowerCase();
    const hasPinGate = /ingresa tu pin/i.test(text);
    const hasEmailGate = !!document.querySelector('input[type="email"]');
    const hasErrorBoundary = /algo salió mal|something went wrong|error boundary|unexpected error|ocurrió un error/i.test(text);
    const has404 = /\b404\b|no encontrado|not found|página no existe/i.test(lower);
    const hasLock = /disponible en pro|requiere plan|función bloqueada|upgrade your plan/i.test(text);
    const hasNoAplica = /no aplica|no disponible para este tipo|no aplica a este tipo/i.test(lower);
    const hasEmpty = /no hay|sin datos|sin registros|sin cola|aún no/i.test(lower) && len < 600;
    const hasLoader = /cargando|loading/i.test(lower) && len < 100;
    // i18n leaks — obvious English strings in a Spanish app
    const i18nLeaks = (text.match(/\b(loading\.\.\.|please wait|click here|save changes|something went wrong)\b/gi) || []).slice(0, 5);
    let status = 'loaded';
    if (hasPinGate || hasEmailGate) status = 'auth_lost';
    else if (hasErrorBoundary || has404) status = 'errored';
    else if (hasLock) status = 'locked';
    else if (hasNoAplica) status = 'no_aplica';
    else if (hasLoader) status = 'loading';
    else if (hasEmpty) status = 'empty';
    else if (len < 60) status = 'errored';
    return { status, len, snippet: text.slice(0, 400), i18nLeaks };
  });
}

test('prestamos deep audit', async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const networkFails = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 500);
    if (/google-analytics|gtag|googletagmanager/i.test(t)) return;
    consoleErrors.push({ text: t, at: page.url() });
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

  // Capture sidebar items as rendered
  const sidebarItems = await page.evaluate(() => {
    const aside = document.querySelector('aside') || document.querySelector('nav');
    if (!aside) return [];
    return Array.from(aside.querySelectorAll('a,button')).map((el) => ({
      text: (el.innerText || '').trim().slice(0, 80),
      href: el.getAttribute('href') || '',
    })).filter((x) => x.text);
  });
  writeOut('sidebar.json', JSON.stringify(sidebarItems, null, 2));

  const perRoute = {};
  for (const route of ROUTES) {
    const eBefore = consoleErrors.length;
    const nBefore = networkFails.length;
    let landed = '';
    let cls = { status: 'errored', snippet: '', len: 0, i18nLeaks: [] };
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      landed = page.url();
      cls = await classify(page);
    } catch (e) {
      cls = { status: 'errored', snippet: `NAV_ERROR: ${e.message}`.slice(0, 240), len: 0, i18nLeaks: [] };
    }
    const shot = path.join(OUT_DIR, `${safe(route)}.png`);
    try { await page.screenshot({ path: shot, fullPage: false }); } catch {}
    perRoute[route] = {
      status: cls.status,
      bodyLen: cls.len,
      snippet: cls.snippet,
      i18nLeaks: cls.i18nLeaks,
      landedUrl: landed,
      urlMatched: landed.includes(route),
      newConsoleErrors: consoleErrors.slice(eBefore).slice(0, 6),
      newNetworkFails: networkFails.slice(nBefore).slice(0, 8),
      screenshot: path.basename(shot),
    };
    await page.waitForTimeout(300);
  }

  // Deep dive on /pos/loans: look for "Crear" / "Nuevo" button and DOM hooks
  await page.goto(`${BASE}/pos/loans`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const loansUI = await page.evaluate(() => {
    const text = (document.body.innerText || '').slice(0, 2000);
    const buttons = Array.from(document.querySelectorAll('button')).map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 40);
    const inputs = Array.from(document.querySelectorAll('input,select')).map((i) => ({ name: i.name || i.id, type: i.type, placeholder: i.placeholder })).slice(0, 30);
    const tables = document.querySelectorAll('table').length;
    const rows = document.querySelectorAll('tbody tr').length;
    return { text, buttons, inputs, tables, rows };
  });
  writeOut('loans_deep.json', JSON.stringify(loansUI, null, 2));
  try { await page.screenshot({ path: path.join(OUT_DIR, 'loans_deep.png'), fullPage: true }); } catch {}

  // Deep dive on /pos/pawn-items
  await page.goto(`${BASE}/pos/pawn-items`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const pawnUI = await page.evaluate(() => {
    const text = (document.body.innerText || '').slice(0, 2000);
    const buttons = Array.from(document.querySelectorAll('button')).map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 40);
    const rows = document.querySelectorAll('tbody tr').length;
    return { text, buttons, rows };
  });
  writeOut('pawn_deep.json', JSON.stringify(pawnUI, null, 2));
  try { await page.screenshot({ path: path.join(OUT_DIR, 'pawn_deep.png'), fullPage: true }); } catch {}

  // Deep dive on /pos/collections
  await page.goto(`${BASE}/pos/collections`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const collectionsUI = await page.evaluate(() => {
    const text = (document.body.innerText || '').slice(0, 2000);
    const buttons = Array.from(document.querySelectorAll('button')).map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 40);
    const rows = document.querySelectorAll('tbody tr').length;
    return { text, buttons, rows };
  });
  writeOut('collections_deep.json', JSON.stringify(collectionsUI, null, 2));
  try { await page.screenshot({ path: path.join(OUT_DIR, 'collections_deep.png'), fullPage: true }); } catch {}

  // Logout + re-login check
  let reloginOk = false;
  try {
    // Try to find logout in sidebar
    const logoutBtn = page.locator('button:has-text("Cerrar sesión"), button:has-text("Salir"), a:has-text("Cerrar sesión")').first();
    if (await logoutBtn.count()) {
      await logoutBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    // Hit root to force gate
    await page.context().clearCookies();
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    reloginOk = await login(page);
  } catch {}

  const summary = {
    account: EMAIL,
    ranAt: new Date().toISOString(),
    authed,
    reloginOk,
    totalConsoleErrors: consoleErrors.length,
    totalNetworkFails: networkFails.length,
    consoleErrorsSample: consoleErrors.slice(0, 20),
    networkFailsSample: networkFails.slice(0, 30),
    routes: perRoute,
    sidebarCount: sidebarItems.length,
  };
  writeOut('summary.json', JSON.stringify(summary, null, 2));
  await ctx.close();
});
