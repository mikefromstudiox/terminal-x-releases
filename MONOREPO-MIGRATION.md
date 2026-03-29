# Turborepo Migration Plan — Fresh Git (No AI History)

> **BLOCKED — DO NOT EXECUTE until DGII e-CF certification Steps 6-15 are COMPLETE.**
> The DGII certification process is active (Step 6 awaiting review as of 2026-03-28).
> Moving files will change paths to xml-builder.js, xml-signer.js, dgii-client.js,
> cert-manager.js, and the Vercel receiver endpoints (fe/*). Any path change during
> certification risks breaking the submission scripts, receiver URLs, and sequence
> tracking. The code itself is safe to move (same logic, new paths), but do it AFTER
> Step 15 (Finalizado) is confirmed. See DGII-CERTIFICATION.md for current status.

Terminal X POS: flat structure → Turborepo monorepo with clean commit history.

---

## 1. Final Folder Structure

```
terminal-x/
├── apps/
│   ├── desktop/                        # THIN SHELL — Electron glue only
│   │   ├── main.js                     # IPC handlers, app lifecycle, window mgmt
│   │   ├── preload.js                  # contextBridge (electronAPI + printerAPI)
│   │   ├── database.js                 # better-sqlite3 (desktop-only, CJS)
│   │   ├── updater.js                  # electron-updater
│   │   ├── usbPrint.js                 # USB printer bridge
│   │   ├── index.html                  # Electron renderer entry
│   │   ├── vite.config.js              # desktop Vite config
│   │   ├── electron-builder.yml        # electron-builder config
│   │   └── package.json                # electron, electron-builder, better-sqlite3
│   │
│   └── web/                            # Vite PWA — Vercel deploy target
│       ├── main.jsx                    # web entry — router, Supabase, SW reg
│       ├── index.html                  # web HTML shell
│       ├── vite.config.js              # web Vite config
│       ├── vercel.json                 # SPA rewrites + API routes
│       ├── public/
│       │   └── sw.js                   # service worker
│       ├── api/                        # Vercel serverless functions
│       │   ├── panel.js                # admin CRUD (consolidated ?action=)
│       │   ├── validate.js             # license validation
│       │   ├── rnc.js                  # RNC lookup proxy (megaplus.com.do)
│       │   ├── signup/
│       │   │   └── provision.js        # self-service signup
│       │   └── fe/                     # DGII receiver endpoints
│       │       ├── semilla.js
│       │       ├── validarcertificado.js
│       │       ├── recepcion.js
│       │       └── aprobacion.js
│       └── package.json                # @supabase/supabase-js, vercel
│
├── packages/
│   ├── ecf-core/                       # DGII e-CF business logic (SHARED)
│   │   ├── xml-builder.js              # build all 10 e-CF XML types + RFCE
│   │   ├── xml-signer.js              # RSA-SHA256 enveloped signature
│   │   ├── dgii-client.js             # auth seed dance, submit, status polling
│   │   ├── cert-manager.js            # .p12 certificate loading
│   │   ├── dgii-step4-gen.js          # Step 4 simulation XML generator
│   │   ├── dgii-step5-pdf.js          # Step 5 representacion impresa PDFs
│   │   ├── test-xml-generator.js      # test harness
│   │   ├── dgii-test-submit.js        # test submission script
│   │   ├── dgii-submit-one.js         # single e-CF submission script
│   │   ├── index.js                   # barrel export
│   │   └── package.json               # "@terminal-x/ecf-core", xml-crypto, @xmldom
│   │
│   ├── services/                       # Shared business logic (SHARED)
│   │   ├── printer.js                  # ESC/POS buffer builders (80mm thermal)
│   │   ├── pdf.js                      # pdf-lib receipt generation + QR
│   │   ├── ecf.js                      # signAndSubmitECF orchestrator, ECF_TYPES
│   │   ├── license.js                  # HWID license validation
│   │   ├── offline-queue.js            # IndexedDB queue (web)
│   │   ├── print-web.js               # qz-tray + PDF fallback (web)
│   │   ├── supabase.js                # Supabase client helpers
│   │   ├── backup.js                  # backup service
│   │   ├── sync.js                    # sync service
│   │   ├── index.js
│   │   └── package.json               # "@terminal-x/services", depends on ecf-core
│   │
│   ├── data/                           # Platform data layers (SHARED)
│   │   ├── web.js                      # createWebAPI (Supabase, 1500+ lines)
│   │   ├── electron.js                 # createElectronAPI (IPC passthrough)
│   │   ├── index.js
│   │   └── package.json               # "@terminal-x/data"
│   │
│   ├── ui/                             # Shared React components (SHARED)
│   │   ├── App.jsx                     # main app shell + router
│   │   ├── main.jsx                    # desktop entry (Electron renderer)
│   │   ├── screens/
│   │   │   ├── POS.jsx
│   │   │   ├── Queue.jsx
│   │   │   ├── Clients.jsx
│   │   │   ├── Credits.jsx
│   │   │   ├── Admin.jsx
│   │   │   ├── Settings.jsx
│   │   │   ├── Inventory.jsx
│   │   │   ├── DGII.jsx
│   │   │   ├── CashReconciliation.jsx
│   │   │   ├── PettyCash.jsx
│   │   │   ├── CreditNotes.jsx
│   │   │   ├── Reportes.jsx
│   │   │   ├── RemoteDashboard.jsx
│   │   │   ├── Sistema.jsx
│   │   │   ├── Login.jsx
│   │   │   ├── LicenseGate.jsx
│   │   │   ├── LicenseAdmin.jsx
│   │   │   ├── FirstTimeSetup.jsx
│   │   │   └── reports/
│   │   │       ├── DailyReport.jsx
│   │   │       ├── MonthlyReport.jsx
│   │   │       ├── WorkerReport.jsx
│   │   │       └── SalespersonReport.jsx
│   │   ├── components/
│   │   │   ├── CobrarModal.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── Layout.jsx
│   │   │   ├── PlanGate.jsx
│   │   │   ├── ExportToCloud.jsx
│   │   │   ├── ErrorBoundary.jsx
│   │   │   ├── UpdateBanner.jsx
│   │   │   └── LanguageToggle.jsx
│   │   ├── hooks/
│   │   │   ├── useDB.js
│   │   │   ├── useRNC.js
│   │   │   └── usePlan.jsx
│   │   ├── context/
│   │   │   ├── DataContext.jsx
│   │   │   ├── AuthContext.jsx
│   │   │   ├── LicenseContext.jsx
│   │   │   ├── LayoutContext.jsx
│   │   │   └── BackupContext.jsx
│   │   ├── landing/
│   │   │   ├── LandingPage.jsx
│   │   │   └── SignupPage.jsx
│   │   ├── admin/
│   │   │   ├── AdminApp.jsx
│   │   │   └── pages/
│   │   │       ├── Dashboard.jsx
│   │   │       ├── Clients.jsx
│   │   │       ├── Licenses.jsx
│   │   │       └── Team.jsx
│   │   ├── i18n/
│   │   │   ├── es.js
│   │   │   ├── en.js
│   │   │   └── index.jsx
│   │   ├── assets/
│   │   │   └── logo.png
│   │   ├── index.js                   # barrel export
│   │   └── package.json               # "@terminal-x/ui"
│   │
│   └── config/                         # Shared build configs
│       ├── tailwind.config.js          # shared Tailwind preset
│       ├── postcss.config.js           # shared PostCSS
│       └── package.json               # "@terminal-x/config"
│
├── supabase/
│   └── migrations/
│       ├── 20260301000000_initial.sql
│       ├── 20260301000001_upgrade_existing.sql
│       ├── 20260301000002_add_local_id.sql
│       ├── 20260301000003_queue_fks.sql
│       ├── 20260322000000_seller_cajero_commissions.sql
│       ├── 20260323000000_licenses_and_plans.sql
│       └── 20260324000000_rls_configuracion.sql
│
├── test-xmls/                          # DGII test XMLs + Step 5 PDFs
│   ├── step4-sim/
│   └── step5-pdfs/
│
├── turbo.json                          # Turborepo pipeline config
├── package.json                        # workspace root (private, workspaces)
├── .gitignore
├── .env.example
├── CLAUDE.md
├── FUTUREX.md
├── PHASE3-WEB-PWA.md
└── MONOREPO-MIGRATION.md
```

---

## 2. Package Dependency Graph

```
@terminal-x/config          (no deps — leaf)
        ↑
@terminal-x/ecf-core        (xml-crypto, @xmldom — leaf)
        ↑
@terminal-x/services         depends on → ecf-core
        ↑
@terminal-x/data             depends on → services (optional)
        ↑
@terminal-x/ui               depends on → data, services, config
      ↑     ↑
apps/web   apps/desktop      depend on → ui, data, services, ecf-core
```

---

## 3. File Mapping (Current → Monorepo)

### apps/desktop/ (thin Electron shell)
| Current | Destination |
|---------|-------------|
| `electron/main.js` | `apps/desktop/main.js` |
| `electron/preload.js` | `apps/desktop/preload.js` |
| `electron/database.js` | `apps/desktop/database.js` |
| `electron/updater.js` | `apps/desktop/updater.js` |
| `electron/usbPrint.js` | `apps/desktop/usbPrint.js` |
| `index.html` | `apps/desktop/index.html` |
| `vite.config.js` | `apps/desktop/vite.config.js` |

### apps/web/ (Vite PWA + Vercel)
| Current | Destination |
|---------|-------------|
| `web/main.jsx` | `apps/web/main.jsx` |
| `web/vercel.json` | `apps/web/vercel.json` |
| `web/public/sw.js` | `apps/web/public/sw.js` |
| `web/api/panel.js` | `apps/web/api/panel.js` |
| `web/api/validate.js` | `apps/web/api/validate.js` |
| `web/api/rnc.js` | `apps/web/api/rnc.js` |
| `web/api/signup/provision.js` | `apps/web/api/signup/provision.js` |
| `web/api/fe/*.js` | `apps/web/api/fe/*.js` |
| `web/api/admin/*.js` | `apps/web/api/admin/*.js` |
| `vite.web.config.js` | `apps/web/vite.config.js` |
| `index.html` (modified) | `apps/web/index.html` |

### packages/ecf-core/ (DGII fiscal logic)
| Current | Destination |
|---------|-------------|
| `electron/xml-builder.js` | `packages/ecf-core/xml-builder.js` |
| `electron/xml-signer.js` | `packages/ecf-core/xml-signer.js` |
| `electron/dgii-client.js` | `packages/ecf-core/dgii-client.js` |
| `electron/cert-manager.js` | `packages/ecf-core/cert-manager.js` |
| `electron/dgii-step4-gen.js` | `packages/ecf-core/dgii-step4-gen.js` |
| `electron/dgii-step5-pdf.js` | `packages/ecf-core/dgii-step5-pdf.js` |
| `electron/test-xml-generator.js` | `packages/ecf-core/test-xml-generator.js` |
| `electron/dgii-test-submit.js` | `packages/ecf-core/dgii-test-submit.js` |
| `electron/dgii-submit-one.js` | `packages/ecf-core/dgii-submit-one.js` |

### packages/services/ (shared business logic)
| Current | Destination |
|---------|-------------|
| `src/services/printer.js` | `packages/services/printer.js` |
| `src/services/pdf.js` | `packages/services/pdf.js` |
| `src/services/ecf.js` | `packages/services/ecf.js` |
| `src/services/license.js` | `packages/services/license.js` |
| `src/services/offline-queue.js` | `packages/services/offline-queue.js` |
| `src/services/print-web.js` | `packages/services/print-web.js` |
| `src/services/supabase.js` | `packages/services/supabase.js` |
| `src/services/backup.js` | `packages/services/backup.js` |
| `src/services/sync.js` | `packages/services/sync.js` |

### packages/data/ (platform data layers)
| Current | Destination |
|---------|-------------|
| `src/data/web.js` | `packages/data/web.js` |
| `src/data/electron.js` | `packages/data/electron.js` |

### packages/ui/ (shared React)
| Current | Destination |
|---------|-------------|
| `src/App.jsx` | `packages/ui/App.jsx` |
| `src/main.jsx` | `packages/ui/main.jsx` |
| `src/screens/*.jsx` | `packages/ui/screens/*.jsx` |
| `src/screens/reports/*.jsx` | `packages/ui/screens/reports/*.jsx` |
| `src/components/*.jsx` | `packages/ui/components/*.jsx` |
| `src/hooks/*.{js,jsx}` | `packages/ui/hooks/*.{js,jsx}` |
| `src/context/*.jsx` | `packages/ui/context/*.jsx` |
| `src/landing/*.jsx` | `packages/ui/landing/*.jsx` |
| `src/admin/**/*.jsx` | `packages/ui/admin/**/*.jsx` |
| `src/i18n/*.{js,jsx}` | `packages/ui/i18n/*.{js,jsx}` |
| `src/assets/*` | `packages/ui/assets/*` |

### packages/config/ (shared build configs)
| Current | Destination |
|---------|-------------|
| `tailwind.config.js` | `packages/config/tailwind.config.js` |
| `postcss.config.js` | `packages/config/postcss.config.js` |

### Root files
| Current | Destination |
|---------|-------------|
| `CLAUDE.md` | root `CLAUDE.md` (updated paths) |
| `FUTUREX.md` | root `FUTUREX.md` |
| `PHASE3-WEB-PWA.md` | root `PHASE3-WEB-PWA.md` |
| `supabase/migrations/*.sql` | `supabase/migrations/*.sql` |
| `test-xmls/` | `test-xmls/` |
| `.env` | root `.env` |

---

## 4. Import Changes

### Within a package (no change needed)
```js
// packages/ui/screens/POS.jsx importing from same package
import CobrarModal from '../components/CobrarModal'    // relative = fine
import { useAPI } from '../context/DataContext'          // relative = fine
```

### Cross-package imports (MUST update)
```js
// BEFORE (flat)
import { buildClientReceipt } from '../services/printer'
import { signAndSubmitECF } from '../services/ecf'
import { createWebAPI } from '../data/web'
import { saveReceiptPDF } from '../services/pdf'

// AFTER (monorepo)
import { buildClientReceipt } from '@terminal-x/services/printer'
import { signAndSubmitECF } from '@terminal-x/services/ecf'
import { createWebAPI } from '@terminal-x/data/web'
import { saveReceiptPDF } from '@terminal-x/services/pdf'
```

### Electron main.js require() changes
```js
// BEFORE (flat)
const xmlBuilder = require('./xml-builder')
const xmlSigner = require('./xml-signer')
const dgiiClient = require('./dgii-client')
const certManager = require('./cert-manager')

// AFTER (monorepo) — ecf-core is a workspace package
const xmlBuilder = require('@terminal-x/ecf-core/xml-builder')
const xmlSigner = require('@terminal-x/ecf-core/xml-signer')
const dgiiClient = require('@terminal-x/ecf-core/dgii-client')
const certManager = require('@terminal-x/ecf-core/cert-manager')
```

### Key cross-package import files to update:
| File | Cross-package imports to fix |
|------|------------------------------|
| `packages/ui/screens/POS.jsx` | `@terminal-x/services/printer`, `@terminal-x/services/pdf`, `@terminal-x/services/sync` |
| `packages/ui/components/CobrarModal.jsx` | `@terminal-x/services/ecf`, `@terminal-x/services/pdf` |
| `packages/ui/screens/DGII.jsx` | `@terminal-x/services/ecf` |
| `packages/ui/context/DataContext.jsx` | `@terminal-x/data/web`, `@terminal-x/data/electron` |
| `packages/ui/context/LicenseContext.jsx` | `@terminal-x/services/license` |
| `packages/services/ecf.js` | `@terminal-x/ecf-core/xml-builder`, etc. |
| `apps/desktop/main.js` | `@terminal-x/ecf-core/*` (require) |
| `apps/web/main.jsx` | `@terminal-x/ui/App`, `@terminal-x/data/web` |

---

## 5. Key Config Files

### Root package.json
```json
{
  "name": "terminal-x",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "dev:web": "turbo dev --filter=@terminal-x/web",
    "dev:desktop": "turbo dev --filter=@terminal-x/desktop",
    "build": "turbo build",
    "build:web": "turbo build --filter=@terminal-x/web",
    "dist:win": "turbo dist:win --filter=@terminal-x/desktop"
  },
  "devDependencies": {
    "turbo": "^2.4.0"
  }
}
```

### turbo.json
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "dist-web/**"]
    },
    "dist:win": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}
```

### packages/ecf-core/package.json
```json
{
  "name": "@terminal-x/ecf-core",
  "version": "0.0.1",
  "private": true,
  "main": "index.js",
  "exports": {
    "./xml-builder": "./xml-builder.js",
    "./xml-signer": "./xml-signer.js",
    "./dgii-client": "./dgii-client.js",
    "./cert-manager": "./cert-manager.js"
  },
  "dependencies": {
    "xml-crypto": "^2.1.5",
    "@xmldom/xmldom": "^0.8.6"
  }
}
```

### packages/services/package.json
```json
{
  "name": "@terminal-x/services",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "index.js",
  "exports": {
    "./printer": "./printer.js",
    "./pdf": "./pdf.js",
    "./ecf": "./ecf.js",
    "./license": "./license.js",
    "./offline-queue": "./offline-queue.js",
    "./print-web": "./print-web.js",
    "./supabase": "./supabase.js",
    "./backup": "./backup.js",
    "./sync": "./sync.js"
  },
  "dependencies": {
    "@terminal-x/ecf-core": "workspace:*",
    "pdf-lib": "^1.17.1",
    "qrcode": "^1.5.3"
  }
}
```

### packages/ui/package.json
```json
{
  "name": "@terminal-x/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "index.js",
  "dependencies": {
    "@terminal-x/data": "workspace:*",
    "@terminal-x/services": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.1.5",
    "lucide-react": "^0.469.0"
  }
}
```

---

## 6. ecf-core CJS/ESM Note

`packages/ecf-core/` files are currently CJS (`require`/`module.exports`) because
they run in Electron's main process (Node.js). They will stay CJS for now.

The `exports` field in package.json handles this — both `require()` (desktop) and
`import` (web/future) can resolve the same files. If web needs to call ecf-core
directly (e.g., via Vercel serverless), the CJS files work in Node.js serverless too.

No conversion to ESM needed during migration.

---

## 7. Fresh Git Setup

```bash
cd "A:\Terminal X Mono"

git init
git branch -M main

cat > .gitignore << 'GITIGNORE'
node_modules/
dist/
dist-web/
.env
.env.local
*.p12
*.pfx
hwid.json
.turbo/
.vercel/
*.exe
*.dmg
GITIGNORE

git add -A
git commit -m "Terminal X POS monorepo — initial commit

Turborepo workspace:
- apps/desktop: Electron 41 thin shell (IPC + SQLite)
- apps/web: Vite PWA at terminalxpos.com (Vercel + Supabase)
- packages/ecf-core: DGII e-CF XML building, signing, submission
- packages/services: printer, PDF, e-CF orchestrator, license
- packages/data: Supabase (web) + IPC (desktop) data layers
- packages/ui: shared React screens, components, hooks, i18n
- packages/config: shared Tailwind + PostCSS
- supabase/migrations: 7 PostgreSQL migrations with full RLS"

gh repo create terminal-x --private --source=. --push
```

---

## 8. Post-Migration Checklist

| # | Test | How | Pass |
|---|------|-----|------|
| 1 | Install | `npm install` from root | All workspaces linked, no errors |
| 2 | Turbo build | `npx turbo build` | All packages + apps build |
| 3 | Web dev | `npm run dev:web` | Vite starts, landing loads |
| 4 | Desktop dev | `npm run dev:desktop` | Electron opens, POS works |
| 5 | Web deploy | `cd apps/web && vercel --prod` | terminalxpos.com live |
| 6 | Desktop build | `npm run dist:win` | .exe installer created |
| 7 | PIN login web | terminalxpos.com/pos | Login works |
| 8 | PIN login desktop | Electron app | Login works |
| 9 | POS flow | Ticket → cobrar → print | Receipt prints/downloads |
| 10 | e-CF submit | Charge with E32 | XML signed + submitted |
| 11 | Offline web | Disconnect → create ticket | IndexedDB queues |
| 12 | PDF receipt | Cobrar → PDF | File downloads/saves |
| 13 | QR code | e-CF receipt QR | Correct DGII URL |
| 14 | Plan gate | Login as Pro user | Pro PLUS features locked |
| 15 | Signup | /signup → create account | Business provisioned |
| 16 | Admin | /admin → login | Dashboard loads |
| 17 | RNC lookup | Enter RNC in form | Name auto-fills |
| 18 | Reports | /reports → daily | Data displays |
| 19 | Supabase sync | Ticket on web | Appears in Supabase |
| 20 | Tailwind | All screens | Styles correct |
| 21 | i18n | Toggle EN/ES | Text switches |
| 22 | ecf-core import | Desktop main.js | require() resolves |
| 23 | ecf-core import | Web serverless | import works |

---

## 9. Migration Execution Trigger

When ready, say: **GO COWBOY**

I will then:
1. Create `A:\Terminal X Mono\` with full monorepo scaffold
2. Copy all files from `A:\Terminal X` into correct locations
3. Create all package.json files with workspace deps
4. Create turbo.json, root package.json, .gitignore
5. Fix all cross-package imports (require → @terminal-x/ecf-core, import → @terminal-x/services, etc.)
6. Update CLAUDE.md with new paths
7. Init fresh git repo with clean commit
8. Verify builds work

Estimated: ~70 files to move, ~50 imports to update, ~12 new config files to create.
