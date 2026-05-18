#!/usr/bin/env node
// Prepares dist-web/ for Vercel deployment.
// Runs after `npm run build:web` (Vite output already in dist-web/assets).
// Adds API functions, lib files, middleware, vercel.json, package.json with
// the small API-only dependency set, and the .vercel/project.json link.
//
// Used by both the local manual deploy chain AND by Vercel auto-build
// (configured in repo-root vercel.json buildCommand).

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist-web')

if (!existsSync(DIST)) {
  console.error('[prepare-vercel] dist-web/ not found. Run `npm run build:web` first.')
  process.exit(1)
}

console.log('[prepare-vercel] preparing', DIST)

const mkdir = (p) => { if (!existsSync(p)) mkdirSync(p, { recursive: true }) }
mkdir(join(DIST, 'api'))
mkdir(join(DIST, 'api', 'signup'))
mkdir(join(DIST, 'api', 'digest'))
mkdir(join(DIST, 'lib'))
mkdir(join(DIST, '.vercel'))

// API functions — copy repo-root /api/ → dist-web/api/. Single source of truth.
//
// Stage 3 (FUTUREX §Tech debt) collapsed web/api/ → /api/. Per fc5878a's
// finding (originally for panel.js, applies to all auto-detected functions),
// Vercel auto-detects /api/* at REPO ROOT and ignores dist-web/api/* copies.
// We keep the copy for the local manual deploy chain and as a backstop in
// case the precedence rule changes — but the source must be /api/ now,
// not web/api/, since web/api/ was deleted in Stage 3.
//
// panel.js stays excluded from the copy because Vercel's auto-detected
// repo-root /api/panel.js is the production-live one; the copy would be
// silently ignored at runtime and only create cosmetic confusion.
const apiFiles = [
  'validate.js', 'rnc.js', 'ecf-sign.js',
  'dgii-cert-upload.js', 'staff-verify-auth.js', 'fe.js',
]
for (const f of apiFiles) copyFileSync(join(ROOT, 'api', f), join(DIST, 'api', f))

// Sub-directory functions
copyFileSync(join(ROOT, 'api/signup/provision.js'), join(DIST, 'api/signup/provision.js'))
copyFileSync(join(ROOT, 'api/signup/lead.js'),     join(DIST, 'api/signup/lead.js'))
copyFileSync(join(ROOT, 'api/digest/daily.js'),    join(DIST, 'api/digest/daily.js'))

// LIB — copy repo-root /lib/ → dist-web/lib/. Single source of truth.
//
// History: pre-2026-05-18 this copied from web/lib/, and a parallel /lib/
// at repo root served the auto-detected /api/panel.js Vercel function. The
// dual-tree caused 3 silent drift incidents in 3 weeks (mega-smoke-runner,
// cron_health_verifier, fabricated AggregateRating). Stage 1 of the
// collapse (FUTUREX §Tech debt) made /lib/ canonical: all scripts and the
// dist-web build read from here. web/lib/ remains in source temporarily
// as a fallback during the staged rollout; Stage 2 deletes it.
const rootLibDir = join(ROOT, 'lib')
const libFiles = readdirSync(rootLibDir).filter(f => f.endsWith('.js'))
for (const f of libFiles) copyFileSync(join(rootLibDir, f), join(DIST, 'lib', f))

// Middleware + project link
// 2026-05-18 — web/middleware.js DELETED. Same dual-file drift class that
// killed Layer 3 + Layer 6 crons (handlers in web/api/panel.js while Vercel
// served /api/panel.js at root). Schema agent edited web/middleware.js,
// repo-root /middleware.js stayed stale, fabricated AggregateRating
// stayed live in production. Single source of truth now: /middleware.js
// at repo root. No copy needed — Vercel auto-detects it there.
// NOTE 2026-05-17: We no longer copy web/vercel.json into dist-web/. When
// `outputDirectory` is set in the root vercel.json (which it is), Vercel
// IGNORES any vercel.json inside the output directory — only the root
// vercel.json is read. Copying here was dead code that masked the fact
// that web/vercel.json had drifted from root. After the 404-on-/pos
// incident, web/vercel.json was deleted and root vercel.json is the
// single source of truth for routing.

// API-only package.json — keeps the Vercel function bundles small.
writeFileSync(join(DIST, 'package.json'), JSON.stringify({
  private: true,
  type: 'module',
  dependencies: {
    '@supabase/supabase-js': '^2.49.4',
    'xml-crypto': '^2.1.5',
    '@xmldom/xmldom': '^0.8.6',
    jsonwebtoken: '^9.0.2',
    'dgii-ecf': '^1.6.8',
    'node-forge': '^1.3.3',
    busboy: '^1.6.0',
    bcryptjs: '^2.4.3',
    'source-map': '^0.7.4',
  },
}, null, 0))

// Vercel project link — required for `vercel --prod` to find the right project
writeFileSync(join(DIST, '.vercel/project.json'), JSON.stringify({
  projectId: 'prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL',
  orgId: 'team_J0ZQKmOPRiXDLC7I1RA00PM9',
}))

console.log('[prepare-vercel] done. dist-web/ is deploy-ready.')
console.log('[prepare-vercel] api functions:', apiFiles.length + 3, 'lib files:', readdirSync(join(DIST, 'lib')).length)
