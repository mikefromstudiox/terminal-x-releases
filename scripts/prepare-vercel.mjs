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

// Top-level API functions (12-fn Vercel cap → consolidated via ?action= switches)
const apiFiles = [
  'panel.js', 'validate.js', 'rnc.js', 'ecf-sign.js',
  'dgii-cert-upload.js', 'staff-verify-auth.js', 'fe.js',
]
for (const f of apiFiles) copyFileSync(join(ROOT, 'web/api', f), join(DIST, 'api', f))

// Sub-directory functions
copyFileSync(join(ROOT, 'web/api/signup/provision.js'), join(DIST, 'api/signup/provision.js'))
copyFileSync(join(ROOT, 'web/api/signup/lead.js'),     join(DIST, 'api/signup/lead.js'))
copyFileSync(join(ROOT, 'web/api/digest/daily.js'),    join(DIST, 'api/digest/daily.js'))

// All web/lib/*.js — wildcard per CLAUDE.md hard-rule (cherry-picking caused
// FUNCTION_INVOCATION_FAILED in past deploys when new lib files were added).
const libDir = join(ROOT, 'web/lib')
for (const f of readdirSync(libDir)) {
  if (f.endsWith('.js')) copyFileSync(join(libDir, f), join(DIST, 'lib', f))
}

// Middleware + Vercel config + project link
copyFileSync(join(ROOT, 'web/middleware.js'), join(DIST, 'middleware.js'))
copyFileSync(join(ROOT, 'web/vercel.json'),   join(DIST, 'vercel.json'))

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
