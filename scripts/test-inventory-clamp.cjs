#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/test-inventory-clamp.cjs
//
// RPT-H4 regression test — Inventory asymmetric-clamp fix.
//
// SCENARIO
//   1. Seed 1 inventory item with quantity = 3.
//   2. Ring a sale for qty = 5 (oversell by 2).
//        - sale path clamps stock at 0 (floor, never negative).
//        - inventory_oversells ledger records shortage (requested=5, actual=3).
//   3. Void that ticket.
//        - REVERSAL must restore ONLY the fulfilled amount (3), NOT the
//          requested qty (5). Otherwise stock ends at 5 — phantom stock on a
//          product that only ever had 3 in the warehouse.
//   4. Assert final inventory_items.quantity === 3.
//   5. Assert the oversell row is marked resolution_type='voided' so the
//      Quiebres tab shows it as historical.
//
// HOW TO RUN
//   better-sqlite3-multiple-ciphers is compiled against Electron's Node ABI
//   (v145), not the standalone Node install (v141). Run under electron:
//
//     npx electron scripts/test-inventory-clamp.cjs
//
//   (Plain `node scripts/test-inventory-clamp.cjs` will fail with
//   NODE_MODULE_VERSION mismatch — that's expected; rebuild with
//   `npx electron-rebuild` if you want Node ABI instead.)
//
// Exits 0 on pass, 1 on fail. No network, no Supabase.

'use strict'

const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

// When invoked via `electron scripts/foo.cjs`, electron boots as a GUI app.
// We disable hardware accel + prevent window creation so the test runs headless.
let electronApp = null
try {
  const electron = require('electron')
  if (electron && electron.app) {
    electronApp = electron.app
    try { electronApp.disableHardwareAcceleration() } catch {}
    // Wait until ready so userData paths are sane (we use a tmp dir anyway).
  }
} catch { /* running under plain node — fine */ }

const db = require(path.resolve(__dirname, '..', 'electron', 'database.js'))

let exitCode = 0
const assertions = []
const log = (ok, msg) => {
  assertions.push({ ok, msg })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) exitCode = 1
}

function runTest() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'txl-clamp-'))
  try {
    // Fresh-install migrations in electron/database.js run some ALTERs before
    // the CREATE TABLE that defines the target table (e.g. price_pedidos_ya on
    // inventory_items). Those ALTERs fail silently on first init, then on the
    // second init the tables exist and the ALTERs succeed. Two-pass init is
    // the same idempotent "retry-on-next-launch" flow production uses.
    db.init(tmp); db.closeDb && db.closeDb(); db.init(tmp)

    const biz = db.rawPrepare('SELECT id FROM businesses LIMIT 1').get()
    if (!biz) throw new Error('no businesses row seeded by init()')
    // _bizId() reads app_settings.supabase_business_id; fresh DBs don't have it.
    // inventory_oversells.business_id is NOT NULL, so the shortage ledger
    // INSERT silently fails (swallowed in a try/catch in ticketCreate) without
    // this seed — which would hide the bug this test is supposed to catch.
    db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('supabase_business_id', ?)")
      .run('00000000-0000-4000-8000-000000000001')

    // Belt-and-suspenders self-heal for ALTERs that run before their target
    // table exists in the fresh-install ordering (production paths same).
    const heals = [
      'ALTER TABLE ticket_items ADD COLUMN is_deposit INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE ticket_items ADD COLUMN quantity INTEGER DEFAULT 1',
      'ALTER TABLE ticket_items ADD COLUMN sku TEXT',
      'ALTER TABLE ticket_items ADD COLUMN inventory_item_id INTEGER',
      'ALTER TABLE ticket_items ADD COLUMN weight REAL',
      'ALTER TABLE ticket_items ADD COLUMN unit TEXT',
      'ALTER TABLE ticket_items ADD COLUMN price_per_unit REAL',
      'ALTER TABLE ticket_items ADD COLUMN supabase_id TEXT',
      'ALTER TABLE ticket_items ADD COLUMN ticket_supabase_id TEXT',
      'ALTER TABLE ticket_items ADD COLUMN service_supabase_id TEXT',
      'ALTER TABLE ticket_items ADD COLUMN inventory_item_supabase_id TEXT',
      'ALTER TABLE inventory_items ADD COLUMN price_pedidos_ya REAL',
      'ALTER TABLE inventory_items ADD COLUMN sold_by_weight INTEGER DEFAULT 0',
      'ALTER TABLE inventory_items ADD COLUMN unit TEXT',
      'ALTER TABLE inventory_items ADD COLUMN price_per_unit REAL',
      'ALTER TABLE inventory_items ADD COLUMN bottle_deposit REAL',
      'ALTER TABLE inventory_items ADD COLUMN tare_default REAL',
      'ALTER TABLE inventory_items ADD COLUMN barcode TEXT',
      'ALTER TABLE inventory_items ADD COLUMN aplica_itbis INTEGER DEFAULT 1',
      'ALTER TABLE inventory_items ADD COLUMN supabase_id TEXT',
    ]
    for (const s of heals) { try { db.rawExec(s) } catch {} }

    // 1. Seed inventory item qty = 3
    const { id: invId, supabase_id: invSid } = db.inventoryCreate({
      sku: 'CLAMP-TEST-001',
      name: 'Clamp Test Soda',
      category: 'Bebidas',
      quantity: 3,
      price: 100,
      cost: 50,
      aplica_itbis: 1,
    })
    log(invId > 0, `seeded inventory item id=${invId} qty=3`)

    // 2. Ring a sale for qty = 5 (oversell by 2)
    const created = db.ticketCreate({
      items: [{
        name: 'Clamp Test Soda',
        price: 100,
        quantity: 5,
        inventory_item_id: invId,
        is_wash: 0,
        aplica_itbis: 1,
        cost: 50,
      }],
      subtotal: 423.73,
      itbis: 76.27,
      total: 500,
      descuento: 0,
      tipo_venta: 'contado',
      payment_method: 'efectivo',
      status: 'cobrado',
      comprobante_type: 'none',
      washer_ids: [],
      washer_empleado_supabase_ids: [],
    })
    const ticketId = (created && (created.id ?? created.ticketId)) ?? created
    log(!!ticketId, `created ticket id=${ticketId} (sale qty=5 against stock=3)`)

    const afterSale = db.rawPrepare('SELECT quantity FROM inventory_items WHERE id=?').get(invId)
    log(afterSale.quantity === 0, `stock clamped at 0 after oversell  (actual=${afterSale.quantity})`)

    const shortageBefore = db.rawPrepare(
      'SELECT requested_qty, actual_qty, resolution_type FROM inventory_oversells WHERE item_supabase_id=?'
    ).get(invSid)
    log(!!shortageBefore, 'inventory_oversells row recorded')
    log(
      shortageBefore && shortageBefore.requested_qty === 5 && shortageBefore.actual_qty === 3,
      `shortage row requested=5 actual=3  (actual rec: req=${shortageBefore && shortageBefore.requested_qty} act=${shortageBefore && shortageBefore.actual_qty})`
    )
    log(shortageBefore && shortageBefore.resolution_type == null, 'shortage row unresolved pre-void')

    // 3. Void the ticket
    db.ticketVoid(ticketId, 'clamp-regression-test', null)

    // 4. Assert stock is 3 (the true pre-sale level), NOT 5 (phantom).
    const afterVoid = db.rawPrepare('SELECT quantity FROM inventory_items WHERE id=?').get(invId)
    log(
      afterVoid.quantity === 3,
      `RPT-H4: stock restored to TRUE pre-sale level 3 (actual=${afterVoid.quantity}) — phantom stock bug absent`
    )

    // 5. Shortage row marked voided
    const shortageAfter = db.rawPrepare(
      'SELECT resolution_type, resolved_at FROM inventory_oversells WHERE item_supabase_id=?'
    ).get(invSid)
    log(
      shortageAfter && shortageAfter.resolution_type === 'voided' && !!shortageAfter.resolved_at,
      `shortage row marked resolution_type='voided' (actual=${shortageAfter && shortageAfter.resolution_type})`
    )

    // 6. inventory_transactions void_reversal delta equals fulfilled (3), not requested (5)
    const revTx = db.rawPrepare(
      `SELECT delta FROM inventory_transactions WHERE item_id=? AND type='void_reversal'`
    ).get(invId)
    log(revTx && revTx.delta === 3, `void_reversal tx delta=3 (actual=${revTx && revTx.delta})`)
  } catch (e) {
    console.error('FATAL', e)
    exitCode = 1
  } finally {
    try { db.closeDb && db.closeDb() } catch {}
    try { rmSync(tmp, { recursive: true, force: true }) } catch {}
  }

  if (exitCode === 0) console.log('\nALL PASS — RPT-H4 inventory clamp is symmetric.')
  else console.log('\nFAIL — RPT-H4 regression present.')
  process.exit(exitCode)
}

if (electronApp) {
  electronApp.whenReady().then(runTest)
  electronApp.on('window-all-closed', () => {}) // prevent auto-quit race
} else {
  runTest()
}
