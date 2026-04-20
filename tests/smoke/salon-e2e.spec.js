// Salon E2E deep audit — extends the smoke harness with salon-specific routes
// and a logout+re-login cycle. Output JSON per-route + full-page screenshots.
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://terminalxpos.com';
const EMAIL = 'admin@salon.demo.terminalxpos.com';
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
  // Salon-specific
  '/pos/appointments',
  '/pos/stylist-schedules',
  '/pos/memberships',
  '/pos/loyalty',
  '/pos/returns',
];

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'test-results-salon');
fs.mkdirSync(OUT_DIR, { recursive: true });
const SHOTS = path.join(OUT_DIR, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
const isNoise = (u) => /google-analytics|googletagmanager|google\.com\/g\/collect|googleadservices|doubleclick|gstatic|vercel-insights|vitals\.vercel/.test(u || '');
const isNoiseText = (t) => /google-analytics|googletagmanager|gtag|vercel/i.test(t || '');

async function passEmailGate(page) {
  const el = page.locator('input[type="email"]').first();
  try { await el.waitFor({ state: 'visible', timeout: 6000 }); } catch { return false; }
  await el.fill(EMAIL);
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(PASSWORD);
  const btn = page.locator('button[type="submit"]').first();
  if (await btn.count()) await btn.click(); else await pw.press('Enter');
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
  await passEmailGate(page);
  await page.waitForTimeout(600);
  await passPinGate(page);
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  return page.locator('aside, nav').first().isVisible().catch(() => false);
}

async function classify(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const root = document.querySelector('#root') || document.body;
    const text = (root?.innerText || '').trim();
    const lower = text.toLowerCase();
    const hasPin = /ingresa tu pin/i.test(text);
    const hasEmail = !!document.querySelector('input[type="email"]');
    const hasLock = /disponible en pro|requiere plan|función bloqueada/i.test(text);
    const hasErr = /algo salió mal|something went wrong|unexpected error|ocurrió un error/i.test(text);
    const has404 = /\b404\b|no encontrado|not found|página no existe/i.test(lower);
    const hasLoader = /cargando|loading/i.test(lower) && text.length < 100;
    const hasSidebar = !!document.querySelector('aside, nav');
    const hasEmpty = /no hay|sin datos|sin registros|aún no/i.test(lower) && text.length < 600;
    // i18n leaks: English UI phrases in an ES-only app
    const i18nLeak = /\b(Dashboard|Settings|Loading|Save|Cancel|Delete|Appointments|Schedule|Members)\b/.test(text) && !/\b(Guardar|Cancelar|Eliminar|Citas|Horario|Miembros)\b/.test(text);
    let status = 'loaded';
    if (hasPin || hasEmail) status = 'auth_lost';
    else if (hasErr || has404) status = 'errored';
    else if (hasLock) status = 'locked';
    else if (hasLoader) status = 'loader';
    else if (hasEmpty) status = 'empty';
    else if (text.length < 60) status = 'blank';
    return { status, len: text.length, hasSidebar, i18nLeak, snippet: text.slice(0, 320) };
  });
}

test('salon deep e2e', async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  const netFails = [];

  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text().slice(0, 600); if (!isNoiseText(t)) consoleErrors.push({ t, at: page.url() }); } });
  page.on('pageerror', (e) => consoleErrors.push({ t: `PAGEERROR: ${e.message}`.slice(0, 600), at: page.url() }));
  page.on('requestfailed', (r) => { const u = r.url(); if (isNoise(u)) return; netFails.push({ u: u.slice(0, 240), fail: r.failure()?.errorText, at: page.url() }); });
  page.on('response', (r) => { const u = r.url(); if (isNoise(u)) return; const s = r.status(); if (s >= 400 && s !== 404) netFails.push({ u: u.slice(0, 240), status: s, at: page.url() }); });

  const authed = await login(page);
  try { await page.screenshot({ path: path.join(SHOTS, '_auth.png'), fullPage: true }); } catch {}

  const perRoute = {};
  for (const route of ROUTES) {
    const eB = consoleErrors.length, nB = netFails.length;
    let cls = { status: 'errored', snippet: '', len: 0 }, landed = '';
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      landed = page.url();
      cls = await classify(page);
    } catch (e) { cls = { status: 'errored', snippet: `NAV: ${e.message}`.slice(0, 240), len: 0 }; }
    const shot = path.join(SHOTS, `${safe(route)}.png`);
    try { await page.screenshot({ path: shot, fullPage: true }); } catch {}
    perRoute[route] = {
      ...cls,
      landed,
      urlMatched: landed.includes(route),
      newConsoleErrors: consoleErrors.slice(eB).slice(0, 8),
      newNetworkFails: netFails.slice(nB).slice(0, 8),
      screenshot: path.relative(path.join(__dirname, '..', '..'), shot).replace(/\\/g, '/'),
    };
    await page.waitForTimeout(250);
  }

  // Logout + re-login cycle
  let logoutResult = { attempted: false, ok: false, notes: '' };
  try {
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const btn = page.getByRole('button', { name: /cerrar sesión|salir|logout/i }).first();
    if (await btn.count()) {
      logoutResult.attempted = true;
      await btn.click().catch(() => {});
      await page.waitForTimeout(1500);
      // accept any confirmation
      const confirm = page.getByRole('button', { name: /sí|confirm|aceptar|ok/i }).first();
      if (await confirm.count()) await confirm.click().catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      // try sidebar text
      const link = page.locator('text=/cerrar sesión|salir/i').first();
      if (await link.count()) { logoutResult.attempted = true; await link.click().catch(() => {}); }
    }
    await page.waitForTimeout(2000);
    const reauth = await login(page);
    logoutResult.ok = reauth;
    logoutResult.notes = reauth ? 'Re-login succeeded after logout' : 'Re-login failed';
  } catch (e) { logoutResult.notes = `Exception: ${e.message}`; }
  try { await page.screenshot({ path: path.join(SHOTS, '_after_relogin.png'), fullPage: true }); } catch {}

  const summary = {
    account: EMAIL,
    vertical: 'salon',
    authed,
    ranAt: new Date().toISOString(),
    routes: perRoute,
    logoutCycle: logoutResult,
    totals: { consoleErrors: consoleErrors.length, networkFails: netFails.length },
    consoleErrors: consoleErrors.slice(0, 60),
    networkFails: netFails.slice(0, 60),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(summary, null, 2));
  await ctx.close();
});
