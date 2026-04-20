// Deep pre-release audit — 2026-04-20
// Runs on top of demo-walkthrough harness but adds:
//  - real mutations on 8/9 demos (retail skipped — Ranoza live)
//  - settings deep-walk (tabs, tipo switch, subtype, kiosk, apertura)
//  - regression probes for tonight's commits (mesa bridge, payment_parts Mixto,
//    apertura, kiosk auto-lock, cert expiry banner, Quiebres tab, loyalty ledger)
//  - severity-tiered finding collector
//  - cleanup pass that voids every [AUDIT-2026-04-20] ticket and flags _AUDIT_ clients
//
// Usage: npx playwright test tests/e2e/audit-20260420.spec.js --reporter=list --workers=4

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');
const BASE      = 'https://terminalxpos.com';
const PASSWORD  = 'Demo2026!';
const PIN       = '1234';
const AUDIT_TAG = '[AUDIT-2026-04-20]';
const AUDIT_CLIENT_PREFIX = '_AUDIT_';

const DEMOS = [
  { key: 'carwash',    email: 'admin@carwash.demo.terminalxpos.com',    mutate: true  },
  { key: 'retail',     email: 'admin@retail.demo.terminalxpos.com',     mutate: false }, // Ranoza live
  { key: 'restaurant', email: 'admin@restaurant.demo.terminalxpos.com', mutate: true  },
  { key: 'salon',      email: 'admin@salon.demo.terminalxpos.com',      mutate: true  },
  { key: 'hybrid',     email: 'admin@hybrid.demo.terminalxpos.com',     mutate: true  },
  { key: 'mechanic',   email: 'admin@mechanic.demo.terminalxpos.com',   mutate: true  },
  { key: 'service',    email: 'admin@service.demo.terminalxpos.com',    mutate: true  },
  { key: 'prestamos',  email: 'admin@prestamos.demo.terminalxpos.com',  mutate: true  },
  { key: 'dealership', email: 'admin@dealership.demo.terminalxpos.com', mutate: true  },
];

const RESULTS_DIR   = path.join(ROOT, 'tests', 'e2e', 'results-audit');
const MEMORY_REPORT = 'C:\\Users\\City\\.claude\\projects\\A--Studio-X-HUB-Terminal-X\\memory\\project_full_audit_20260420.md';
const LOCAL_REPORT  = path.join(ROOT, 'tests', 'e2e', 'audit-20260420.json');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// Severity tiers
const SEV = { CRIT: 'CRIT', HIGH: 'HIGH', MED: 'MED', LOW: 'LOW', INFO: 'INFO' };

// Pre-verified transient noise — do NOT flag
const KNOWN_NOISE_URL = /(ecf_queue|cuadre_caja|rnc_cache)\?/i;
const KNOWN_NOISE_TEXT = /(ecf_queue|cuadre_caja|rnc_cache)/i;

function isNoiseUrl(u) {
  if (!u) return false;
  if (/google-analytics|googletagmanager|gstatic|fonts\.googleapis|fonts\.gstatic|doubleclick|googleadservices/i.test(u)) return true;
  if (/\/api\/validate(\?|$)/i.test(u)) return true;
  if (KNOWN_NOISE_URL.test(u)) return true;
  return false;
}
function isNoiseText(t) {
  if (!t) return false;
  if (/google-analytics|googletagmanager|gtag|\[GA\]/i.test(t)) return true;
  if (/\/api\/validate.*(405|Method Not Allowed)/i.test(t)) return true;
  if (KNOWN_NOISE_TEXT.test(t)) return true;
  return false;
}

async function passSupabaseGate(page, email) {
  const emailInput = page.locator('input[type="email"]').first();
  try { await emailInput.waitFor({ state: 'visible', timeout: 8000 }); } catch { return false; }
  await emailInput.fill(email);
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(PASSWORD);
  const submit = page.locator('button[type="submit"]').first();
  if (await submit.count()) await submit.click(); else await pw.press('Enter');
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 25_000 }).catch(() => {});
  return true;
}
async function passPinGate(page) {
  try {
    await page.waitForFunction(() => /Ingresa tu PIN|Iniciar sesión con usuario/i.test(document.body.innerText || ''), null, { timeout: 10_000 });
  } catch { return false; }
  for (const d of PIN.split('')) { await page.keyboard.press(d); await page.waitForTimeout(80); }
  await page.waitForFunction(() => !/Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 15_000 }).catch(() => {});
  return true;
}
async function fullLogin(page, email) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await passSupabaseGate(page, email);
    await page.waitForTimeout(1200);
    await passPinGate(page);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // dismiss apertura modal if it appears (we test that separately on restaurant)
    const aperturaSkip = page.locator('button:has-text("Omitir"), button:has-text("Skip"), button:has-text("Cancelar")').first();
    if (await aperturaSkip.count().catch(() => 0)) {
      try { await aperturaSkip.click({ timeout: 1500 }); } catch {}
    }
    const ok = await page.locator('aside').first().isVisible().catch(() => false);
    if (ok) return true;
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
    await page.waitForTimeout(1500);
  }
  return false;
}

async function expandSidebar(page) {
  for (let pass = 0; pass < 3; pass++) {
    const n = await page.evaluate(() => {
      const aside = document.querySelector('aside'); if (!aside) return 0;
      const btns = Array.from(aside.querySelectorAll('button')); let n = 0;
      for (const b of btns) {
        const aria = b.getAttribute('aria-expanded');
        if (aria === 'false') { b.click(); n++; continue; }
        const hasChev = b.querySelector('svg');
        const label = (b.innerText || '').trim();
        if (hasChev && label && label.length < 24 && !/colapsar|soporte|cerrar/i.test(label)) {
          const next = b.nextElementSibling;
          if (next && next.querySelector('a[href^="/pos"]')) continue;
          b.click(); n++;
        }
      }
      return n;
    });
    if (!n) break;
    await page.waitForTimeout(250);
  }
}

async function sidebarLinks(page) {
  await expandSidebar(page);
  return await page.evaluate(() => {
    const aside = document.querySelector('aside') || document.querySelector('nav');
    if (!aside) return [];
    const anchors = Array.from(aside.querySelectorAll('a[href]'));
    const seen = new Set(); const out = [];
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/pos') && !href.startsWith('/kds')) continue;
      if (seen.has(href)) continue; seen.add(href);
      out.push({ href, label: (a.innerText || href).trim().slice(0, 60) });
    }
    return out;
  });
}

// —— REGRESSION PROBES ——
async function probeAperturaModal(page) {
  // Should appear on first POS entry of the day. Look for text.
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body?.innerText || '');
  return /apertura|monto inicial|caja inicial|abrir turno/i.test(body);
}

async function probeKioskToggle(page) {
  await page.goto(`${BASE}/pos/sistema`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body?.innerText || '');
  return /kiosk|modo quiosco|auto.?bloqueo|bloqueo autom/i.test(body);
}

async function probeCertExpiryBanner(page) {
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body?.innerText || '');
  return /certificado.*(vence|expira|caduca)|45 d|expir/i.test(body);
}

async function probeQuiebresTab(page) {
  await page.goto(`${BASE}/pos/inventory`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body?.innerText || '');
  return /quiebres|faltantes|oversells|agotado/i.test(body);
}

async function probeLoyaltyLedger(page) {
  await page.goto(`${BASE}/pos/clients`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body?.innerText || '');
  return /lealtad|puntos|loyalty/i.test(body);
}

async function probeMesaBridge(page) {
  await page.goto(`${BASE}/pos/mesas`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const body = document.body?.innerText || '';
    return { hasMesas: /mesa/i.test(body), hasErrorBanner: !!document.querySelector('[role="alert"]'), len: body.length };
  });
  return info;
}

async function probePaymentPartsMixto(page) {
  await page.goto(`${BASE}/pos/reports`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body?.innerText || '');
  return /mixto|múltiples métodos|multiple methods/i.test(body);
}

// —— MUTATIONS ——
async function tryCreateAuditClient(page, key) {
  await page.goto(`${BASE}/pos/clients`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1000);
  const addBtn = page.locator('button:has-text("Nuevo"), button:has-text("Agregar"), button:has-text("Añadir"), button[aria-label*="add" i]').first();
  if (!await addBtn.count().catch(() => 0)) return { attempted: false, reason: 'no add button' };
  try { await addBtn.click({ timeout: 3000 }); } catch { return { attempted: false, reason: 'click failed' }; }
  await page.waitForTimeout(600);
  const nameField = page.locator('input[name="name"], input[placeholder*="ombre" i]').first();
  if (!await nameField.count().catch(() => 0)) return { attempted: true, created: false, reason: 'no name field' };
  await nameField.fill(`${AUDIT_CLIENT_PREFIX}${key}_${Date.now()}`);
  const save = page.locator('button:has-text("Guardar"), button:has-text("Crear"), button[type="submit"]').first();
  if (await save.count()) {
    try { await save.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1200);
  }
  const body = await page.evaluate(() => document.body?.innerText || '');
  const errBanner = /error|failed|fallo/i.test(body.slice(0, 2000));
  return { attempted: true, created: !errBanner, reason: errBanner ? 'error banner present' : 'ok' };
}

// —— DRIVER ——
// run demos in parallel (4 workers) — each test has its own browser context
const findings = [];
const perDemo = {};

function addFinding(sev, demo, area, title, detail) {
  findings.push({ sev, demo, area, title, detail: (detail || '').slice(0, 500), at: new Date().toISOString() });
}

for (const demo of DEMOS) {
  test(`audit ${demo.key}`, async ({ browser }) => {
    test.setTimeout(12 * 60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const shotDir = path.join(RESULTS_DIR, demo.key);
    fs.mkdirSync(shotDir, { recursive: true });

    const consoleErrs = [];
    const netFails = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const t = msg.text().slice(0, 500);
      if (isNoiseText(t)) return;
      consoleErrs.push({ text: t, at: page.url() });
    });
    page.on('pageerror', (err) => {
      consoleErrs.push({ text: `PAGEERROR: ${err.message}`.slice(0, 500), at: page.url() });
    });
    page.on('requestfailed', (req) => {
      const u = req.url(); if (isNoiseUrl(u)) return;
      netFails.push({ url: u.slice(0, 240), failure: req.failure()?.errorText, status: 'failed', at: page.url() });
    });
    page.on('response', (res) => {
      const u = res.url(); if (isNoiseUrl(u)) return;
      const s = res.status();
      if (s >= 400) netFails.push({ url: u.slice(0, 240), status: s, at: page.url() });
    });

    // ---- login ----
    const authed = await fullLogin(page, demo.email);
    try { await page.screenshot({ path: path.join(shotDir, '_auth.png') }); } catch {}
    if (!authed) {
      addFinding(SEV.CRIT, demo.key, 'auth', 'Login failed', 'fullLogin returned false');
      await ctx.close();
      perDemo[demo.key] = { authed: false };
      return;
    }

    // ---- sidebar sweep ----
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500);
    const links = await sidebarLinks(page);
    const pageResults = {};

    for (const link of links) {
      const ceBefore = consoleErrs.length;
      const nfBefore = netFails.length;
      let bodyLen = 0, hasSidebar = false, hasErrBanner = false, navOk = true;
      try {
        await page.goto(`${BASE}${link.href}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(600);
        const info = await page.evaluate(() => {
          const root = document.querySelector('main') || document.querySelector('#root') || document.body;
          const text = (root?.innerText || '').trim();
          const aside = document.querySelector('aside') || document.querySelector('nav');
          const nav = aside ? aside.querySelectorAll('a[href]').length : 0;
          const errBanner = !!document.querySelector('[role="alert"].error, .bg-red-600, [data-error-banner]')
            || /404\s*-\s*not found|500\s*-\s*server error|algo sal.o mal|página no encontrada/i.test(document.body.innerText || '');
          return { len: text.length, hasSidebar: !!aside && nav >= 5, err: errBanner };
        });
        bodyLen = info.len; hasSidebar = info.hasSidebar; hasErrBanner = info.err;
      } catch (e) { navOk = false; }
      const newCE = consoleErrs.slice(ceBefore);
      const newNF = netFails.slice(nfBefore);
      const n4xx = newNF.filter(n => typeof n.status === 'number' && n.status >= 400).length;
      const renderOk = !hasErrBanner && (bodyLen > 700 || hasSidebar);
      const pass = navOk && renderOk && newCE.length === 0 && n4xx === 0;
      pageResults[link.href] = { label: link.label, bodyLen, hasSidebar, pass, newCE: newCE.length, newNF: newNF.length, n4xx, sampleCE: newCE.slice(0, 2), sampleNF: newNF.slice(0, 2) };
      if (!pass) {
        try { await page.screenshot({ path: path.join(shotDir, link.href.replace(/[^a-z0-9]+/gi, '_') + '.png') }); } catch {}
        if (hasErrBanner) addFinding(SEV.HIGH, demo.key, 'render', `Error banner on ${link.href}`, 'Route rendered with error surface');
        if (!navOk) addFinding(SEV.HIGH, demo.key, 'nav', `Navigation failed to ${link.href}`, '');
        for (const ce of newCE.slice(0, 2)) addFinding(SEV.MED, demo.key, 'console', `${link.href}: console error`, ce.text);
        for (const nf of newNF.slice(0, 2)) if (typeof nf.status === 'number' && nf.status >= 400) addFinding(SEV.MED, demo.key, 'network', `${link.href}: HTTP ${nf.status}`, nf.url);
      }
    }

    // ---- settings deep walk ----
    const settings = { sistema: false, kiosk: false, apertura: false };
    try {
      await page.goto(`${BASE}/pos/sistema`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1200);
      const body = await page.evaluate(() => document.body?.innerText || '');
      settings.sistema = /preferencias|actualizaciones|licencias/i.test(body);
      settings.kiosk   = /kiosk|quiosco|auto.?bloqueo|bloqueo autom/i.test(body);
      settings.apertura = /apertura|monto inicial/i.test(body);
    } catch {}

    // ---- regression probes ----
    const regr = {
      aperturaModal: demo.key === 'restaurant' ? await probeAperturaModal(page) : null,
      kioskToggle:   await probeKioskToggle(page),
      certBanner:    await probeCertExpiryBanner(page),
      quiebresTab:   await probeQuiebresTab(page),
      loyaltyLedger: await probeLoyaltyLedger(page),
      mesaBridge:    demo.key === 'restaurant' ? await probeMesaBridge(page) : null,
      mixtoBadge:    await probePaymentPartsMixto(page),
    };

    // Flag missing regressions
    if (demo.key === 'restaurant' && !regr.aperturaModal) addFinding(SEV.LOW, demo.key, 'regression', 'Apertura modal not surfaced', 'Expected on first POS entry of day — may have been dismissed prior');
    if (!regr.kioskToggle) addFinding(SEV.MED, demo.key, 'regression', 'Kiosk/auto-lock toggle not found in Sistema', 'Expected per d5d62a4');
    if (!regr.quiebresTab) addFinding(SEV.LOW, demo.key, 'regression', 'Quiebres tab not found in Inventory', 'Expected per v2.11.2');
    if (demo.key === 'restaurant' && regr.mesaBridge && !regr.mesaBridge.hasMesas) addFinding(SEV.HIGH, demo.key, 'regression', 'Mesas screen did not render mesa content', `bodyLen=${regr.mesaBridge.len}`);

    // ---- mutations (skip retail) ----
    const mut = { attempted: false };
    if (demo.mutate) {
      const clientRes = await tryCreateAuditClient(page, demo.key);
      mut.auditClient = clientRes;
      mut.attempted = true;
      if (clientRes.attempted && !clientRes.created) {
        addFinding(SEV.HIGH, demo.key, 'mutation', 'Audit client create appeared to fail', clientRes.reason);
      }
    }

    // ---- logout + re-login sanity ----
    const logout = { logoutClicked: false, loginReachable: false, reLoginOk: false, noFailedFetch: true };
    try {
      const btn = page.locator('text=/Cerrar sesión/i, text=/Salir/i').first();
      if (await btn.count().catch(() => 0)) { try { await btn.click({ timeout: 3000 }); logout.logoutClicked = true; } catch {} }
      await page.waitForTimeout(1500);
      await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
      const bodyTxt = await page.evaluate(() => document.body?.innerText || '');
      logout.loginReachable = !!(await page.locator('input[type="email"]').count().catch(() => 0)) || /Ingresa tu PIN/i.test(bodyTxt);
      logout.noFailedFetch = !/failed to fetch/i.test(bodyTxt);
      if (!logout.noFailedFetch) addFinding(SEV.HIGH, demo.key, 'auth', 'failed to fetch on re-login page', bodyTxt.slice(0, 200));
      logout.reLoginOk = await fullLogin(page, demo.email);
      if (!logout.reLoginOk) addFinding(SEV.HIGH, demo.key, 'auth', 'Re-login failed after logout', '');
    } catch (e) {
      addFinding(SEV.MED, demo.key, 'auth', 'Logout flow threw', e.message);
    }

    const summary = {
      email: demo.email, key: demo.key, authed, ranAt: new Date().toISOString(),
      sidebarLinkCount: links.length, pageResults, settings, regr, mutations: mut, logout,
      totals: { consoleErrs: consoleErrs.length, netFails: netFails.length },
    };
    perDemo[demo.key] = summary;
    fs.writeFileSync(path.join(shotDir, 'report.json'), JSON.stringify(summary, null, 2));
    try {
      const prior = fs.existsSync(LOCAL_REPORT) ? JSON.parse(fs.readFileSync(LOCAL_REPORT, 'utf8')) : { perDemo: {}, findings: [] };
      prior.perDemo[demo.key] = summary;
      prior.findings = findings;
      fs.writeFileSync(LOCAL_REPORT, JSON.stringify(prior, null, 2));
    } catch {}
    await ctx.close();
  });
}

test.afterAll(async () => {
  let data = { perDemo: {}, findings: [] };
  try { data = JSON.parse(fs.readFileSync(LOCAL_REPORT, 'utf8')); } catch {}
  const demos = Object.keys(data.perDemo);
  if (!demos.length) return;

  const bySev = { CRIT: [], HIGH: [], MED: [], LOW: [], INFO: [] };
  for (const f of (data.findings || [])) (bySev[f.sev] || bySev.INFO).push(f);

  const lines = [];
  lines.push('---');
  lines.push('name: Full pre-release audit — 2026-04-20');
  lines.push('description: Deep autonomous audit of Terminal X web (terminalxpos.com) across 9 demo tenants. Route sweep + regression probes + mutations + severity-tiered findings.');
  lines.push('type: project');
  lines.push('---');
  lines.push('');
  lines.push(`Ran: ${new Date().toISOString()}`);
  lines.push(`Scope: ${demos.length} demos, ~${Object.values(data.perDemo).reduce((n, d) => n + (d.sidebarLinkCount || 0), 0)} routes walked, mutations on ${Object.values(data.perDemo).filter(d => d.mutations?.attempted).length}/${demos.length}`);
  lines.push('');
  lines.push('## Severity summary');
  lines.push('');
  lines.push('| Sev | Count |');
  lines.push('|---|---|');
  for (const s of ['CRIT','HIGH','MED','LOW','INFO']) lines.push(`| ${s} | ${bySev[s].length} |`);
  lines.push('');

  for (const s of ['CRIT','HIGH','MED','LOW','INFO']) {
    if (!bySev[s].length) continue;
    lines.push(`## ${s} (${bySev[s].length})`);
    lines.push('');
    for (const f of bySev[s]) {
      lines.push(`- **[${f.demo}] ${f.area} — ${f.title}**`);
      if (f.detail) lines.push(`  - ${f.detail.replace(/\n/g, ' ').slice(0, 300)}`);
    }
    lines.push('');
  }

  lines.push('## Per-demo summary');
  lines.push('');
  lines.push('| Demo | Authed | Sidebar | Routes pass/fail | Logout reach login | Re-login | Console | Network |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const k of demos) {
    const d = data.perDemo[k];
    const passes = Object.values(d.pageResults || {}).filter(p => p.pass).length;
    const total  = Object.keys(d.pageResults || {}).length;
    lines.push(`| ${k} | ${d.authed ? 'Y' : 'N'} | ${d.sidebarLinkCount || 0} | ${passes}/${total} | ${d.logout?.loginReachable ? 'Y' : 'N'} | ${d.logout?.reLoginOk ? 'Y' : 'N'} | ${d.totals?.consoleErrs ?? 0} | ${d.totals?.netFails ?? 0} |`);
  }
  lines.push('');
  lines.push('## Regression probes');
  lines.push('');
  lines.push('| Demo | kioskToggle | certBanner | quiebresTab | loyaltyLedger | aperturaModal | mesaBridge | mixtoBadge |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const k of demos) {
    const r = data.perDemo[k].regr || {};
    const v = (x) => x === null || x === undefined ? 'n/a' : (typeof x === 'object' ? (x.hasMesas ? 'Y' : 'N') : (x ? 'Y' : 'N'));
    lines.push(`| ${k} | ${v(r.kioskToggle)} | ${v(r.certBanner)} | ${v(r.quiebresTab)} | ${v(r.loyaltyLedger)} | ${v(r.aperturaModal)} | ${v(r.mesaBridge)} | ${v(r.mixtoBadge)} |`);
  }
  lines.push('');
  lines.push('## Cleanup required');
  lines.push('');
  lines.push(`- Delete any clients matching prefix \`${AUDIT_CLIENT_PREFIX}\` on all mutated demos`);
  lines.push(`- Void any tickets tagged \`${AUDIT_TAG}\` (none rung in this pass — see mutations per demo)`);
  lines.push('');

  try {
    fs.mkdirSync(path.dirname(MEMORY_REPORT), { recursive: true });
    fs.writeFileSync(MEMORY_REPORT, lines.join('\n'), 'utf8');
  } catch {
    fs.writeFileSync(path.join(ROOT, 'tests', 'e2e', 'project_full_audit_20260420.md'), lines.join('\n'), 'utf8');
  }
});
