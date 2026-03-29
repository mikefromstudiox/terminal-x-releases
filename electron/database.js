/**
 * database.js — SQLite database layer for Terminal X POS
 *
 * Uses better-sqlite3 (synchronous API — safe for main process).
 * All public functions are synchronous; IPC handlers wrap them.
 *
 * DB file location: app.getPath('userData') / terminal-x.db
 * Schema:    db/schema.sql  (auto-applied on first run)
 * Seed data: db/seed.js     (runs once when tables are empty)
 */

const path    = require('path')
const fs      = require('fs')
const crypto  = require('crypto')

let Database
let dbLoadError = null
try {
  Database = require('better-sqlite3')
} catch (err) {
  dbLoadError = err.message
  console.error('[db] better-sqlite3 not available:', err.message)
  Database = null
}

let db = null
let dbInitError = null

// ── Initialise ────────────────────────────────────────────────────────────────
function isReady() { return !!db }
function getError() { return dbInitError || dbLoadError || null }

function init(userDataPath) {
  if (!Database) { dbInitError = dbLoadError || 'better-sqlite3 not available'; return false }

  const dbPath     = path.join(userDataPath, 'terminal-x.db')
  const schemaPath = path.join(__dirname, '../db/schema.sql')
  const seedPath   = path.join(__dirname, '../db/seed.js')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -2000')
  db.pragma('temp_store = MEMORY')
  db.pragma('foreign_keys = ON')

  // Apply schema
  const schema = fs.readFileSync(schemaPath, 'utf8')
  db.exec(schema)

  // Schema migrations — safe to run multiple times (ignored if column exists)
  const migrations = [
    'ALTER TABLE washers ADD COLUMN start_date TEXT',
    'ALTER TABLE sellers ADD COLUMN phone TEXT',
    'ALTER TABLE ncf_sequences ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0',
    // v1.1 — categorias_servicio support
    'ALTER TABLE services ADD COLUMN categoria_id INTEGER REFERENCES categorias_servicio(id)',
    'ALTER TABLE services ADD COLUMN aplica_itbis INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE users ADD COLUMN vendedor_id INTEGER REFERENCES sellers(id)',
    'ALTER TABLE users ADD COLUMN commission_pct REAL NOT NULL DEFAULT 0',
    'ALTER TABLE tickets ADD COLUMN beverage_subtotal REAL NOT NULL DEFAULT 0',
    // v1.2 — DGII direct e-CF: add columns to ecf_queue for XML storage
    "ALTER TABLE ecf_queue ADD COLUMN xml_signed TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN encf TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN tipo_ecf TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN environment TEXT NOT NULL DEFAULT 'testecf'",
  ]
  for (const sql of migrations) {
    try { db.exec(sql) } catch { /* column already exists */ }
  }

  // ── Dedup washers & sellers (fix: INSERT OR IGNORE had no UNIQUE constraint) ─
  // Reassign FK references from duplicate rows to the original (lowest id) before deleting.
  try {
    const dupWashers = db.prepare(`SELECT w.id AS dup_id, keeper.id AS keep_id
      FROM washers w JOIN (SELECT MIN(id) AS id, name FROM washers GROUP BY name) keeper
      ON w.name = keeper.name WHERE w.id != keeper.id`).all()
    for (const { dup_id, keep_id } of dupWashers) {
      db.prepare('UPDATE washer_commissions SET washer_id=? WHERE washer_id=?').run(keep_id, dup_id)
      db.prepare('UPDATE queue SET washer_id=? WHERE washer_id=?').run(keep_id, dup_id)
      // Remap washer IDs inside the tickets.washer_ids JSON array
      const rows = db.prepare("SELECT id, washer_ids FROM tickets WHERE washer_ids LIKE ?").all(`%${dup_id}%`)
      for (const row of rows) {
        try {
          const ids = JSON.parse(row.washer_ids || '[]')
          const fixed = ids.map(id => id === dup_id ? keep_id : id)
          db.prepare('UPDATE tickets SET washer_ids=? WHERE id=?').run(JSON.stringify(fixed), row.id)
        } catch { /* skip malformed JSON */ }
      }
    }
    db.exec(`DELETE FROM washers WHERE id NOT IN (SELECT MIN(id) FROM washers GROUP BY name)`)

    const dupSellers = db.prepare(`SELECT s.id AS dup_id, keeper.id AS keep_id
      FROM sellers s JOIN (SELECT MIN(id) AS id, name FROM sellers GROUP BY name) keeper
      ON s.name = keeper.name WHERE s.id != keeper.id`).all()
    for (const { dup_id, keep_id } of dupSellers) {
      db.prepare('UPDATE tickets SET seller_id=? WHERE seller_id=?').run(keep_id, dup_id)
      db.prepare('UPDATE users SET vendedor_id=? WHERE vendedor_id=?').run(keep_id, dup_id)
    }
    db.exec(`DELETE FROM sellers WHERE id NOT IN (SELECT MIN(id) FROM sellers GROUP BY name)`)
  } catch { /* safe to ignore on fresh DB */ }
  // Add unique index so INSERT OR IGNORE works correctly going forward
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_washers_name ON washers(name)`) } catch { /* already exists */ }
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_name ON sellers(name)`) } catch { /* already exists */ }

  // Seller & Cajero commissions tables (v1.2)
  db.exec(`CREATE TABLE IF NOT EXISTS seller_commissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id       INTEGER NOT NULL REFERENCES sellers(id),
    ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
    base_amount     REAL    NOT NULL,
    commission_pct  REAL    NOT NULL,
    commission_amount REAL  NOT NULL,
    paid            INTEGER NOT NULL DEFAULT 0,
    paid_at         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS cajero_commissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cajero_id       INTEGER NOT NULL REFERENCES users(id),
    ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
    base_amount     REAL    NOT NULL,
    commission_pct  REAL    NOT NULL,
    commission_amount REAL  NOT NULL,
    paid            INTEGER NOT NULL DEFAULT 0,
    paid_at         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`)

  // RNC contribuyentes — full DGII database + API lookup cache
  db.exec(`CREATE TABLE IF NOT EXISTS rnc_contribuyentes (
    rnc              TEXT PRIMARY KEY,
    nombre           TEXT NOT NULL DEFAULT '',
    nombre_comercial TEXT         DEFAULT '',
    actividad        TEXT         DEFAULT '',
    estado           TEXT         DEFAULT 'ACTIVO',
    regimen          TEXT         DEFAULT 'NORMAL',
    provincia        TEXT         DEFAULT '',
    source           TEXT NOT NULL DEFAULT 'api',
    synced_at        TEXT NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_rnc_contrib ON rnc_contribuyentes(rnc)')

  // e-CF offline queue — stores failed submissions for auto-retry (DGII 72h contingency)
  db.exec(`CREATE TABLE IF NOT EXISTS ecf_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url_path    TEXT NOT NULL,
    body_json   TEXT NOT NULL,
    token       TEXT NOT NULL DEFAULT '',
    xml_signed  TEXT,
    encf        TEXT,
    tipo_ecf    TEXT,
    environment TEXT NOT NULL DEFAULT 'testecf',
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_tried  TEXT
  )`)

  // e-CF submission log — tracks every e-CF sent to DGII with status
  db.exec(`CREATE TABLE IF NOT EXISTS ecf_submissions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    encf           TEXT NOT NULL,
    tipo_ecf       TEXT NOT NULL,
    ticket_id      INTEGER,
    xml_hash       TEXT,
    track_id       TEXT,
    dgii_status    INTEGER DEFAULT 3,
    dgii_message   TEXT,
    security_code  TEXT,
    signature_date TEXT,
    submitted_at   TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at   TEXT,
    xml_path       TEXT,
    environment    TEXT NOT NULL DEFAULT 'testecf',
    UNIQUE(encf, environment)
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_ecf_sub_track ON ecf_submissions(track_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_ecf_sub_ticket ON ecf_submissions(ticket_id)')

  // Inventory items + transaction log
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sku          TEXT UNIQUE,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT '',
    quantity     INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 5,
    price        REAL NOT NULL DEFAULT 0,
    cost         REAL NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL REFERENCES inventory_items(id),
    type       TEXT NOT NULL,
    delta      INTEGER NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    user_id    INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_inv_item ON inventory_transactions(item_id)')

  // Empleados — unified payroll table for all worker types
  db.exec(`CREATE TABLE IF NOT EXISTS empleados (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT NOT NULL,
    tipo        TEXT NOT NULL CHECK(tipo IN ('lavador','vendedor','cajero')),
    ref_id      INTEGER,
    salary      REAL NOT NULL DEFAULT 0,
    start_date  TEXT NOT NULL,
    cedula      TEXT,
    phone       TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // 607 — Compras y gastos de proveedores
  db.exec(`CREATE TABLE IF NOT EXISTS compras_607 (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    rnc_proveedor    TEXT NOT NULL DEFAULT '',
    nombre_proveedor TEXT NOT NULL DEFAULT '',
    tipo_ncf         TEXT NOT NULL DEFAULT 'B01',
    ncf              TEXT NOT NULL DEFAULT '',
    ncf_modificado   TEXT         DEFAULT '',
    fecha_ncf        TEXT NOT NULL,
    fecha_pago       TEXT         DEFAULT '',
    monto_servicios  REAL NOT NULL DEFAULT 0,
    monto_bienes     REAL NOT NULL DEFAULT 0,
    total            REAL NOT NULL DEFAULT 0,
    itbis_facturado  REAL NOT NULL DEFAULT 0,
    itbis_retenido   REAL NOT NULL DEFAULT 0,
    retencion_renta  REAL NOT NULL DEFAULT 0,
    forma_pago       TEXT NOT NULL DEFAULT 'efectivo',
    notas            TEXT         DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_compras607_fecha ON compras_607(fecha_ncf)')

  // Performance indexes for report queries at scale
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_client ON tickets(client_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_cajero ON tickets(cajero_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket ON ticket_items(ticket_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_credit_pay_date ON credit_payments(created_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_credit_pay_client ON credit_payments(client_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuadre_date ON cuadre_caja(date)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuadre_cajero ON cuadre_caja(cajero_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_commissions_date ON washer_commissions(created_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_commissions_washer ON washer_commissions(washer_id)')

  // Ensure all sequence types exist in ncf_sequences (INSERT OR IGNORE — never overwrites existing)
  const ECF_SEED = [
    // Legacy NCF (B01/B02) — valid until May 2026
    { type: 'B01', prefix: 'B01', enabled: 1 },
    { type: 'B02', prefix: 'B02', enabled: 1 },
    // e-CF (electronic, mandatory from May 2026)
    { type: 'E31', prefix: 'E310', enabled: 1 },
    { type: 'E32', prefix: 'E320', enabled: 1 },
    { type: 'E33', prefix: 'E330', enabled: 0 },
    { type: 'E34', prefix: 'E340', enabled: 1 },
    { type: 'E41', prefix: 'E410', enabled: 0 },
    { type: 'E43', prefix: 'E430', enabled: 0 },
    { type: 'E44', prefix: 'E440', enabled: 0 },
    { type: 'E45', prefix: 'E450', enabled: 0 },
    { type: 'E46', prefix: 'E460', enabled: 0 },
    { type: 'E47', prefix: 'E470', enabled: 0 },
  ]
  const insertECF = db.prepare(
    'INSERT OR IGNORE INTO ncf_sequences(type,prefix,current_number,limit_number,active,enabled) VALUES(?,?,0,500,1,?)'
  )
  for (const s of ECF_SEED) insertECF.run(s.type, s.prefix, s.enabled)

  // Seed default services if none exist — prevents FK failures when POS falls back to DEMO_SERVICES
  // (DEMO_SERVICES uses hardcoded IDs 1-17; without real rows those IDs fail ticket_items FK check)
  const svcCount = db.prepare('SELECT COUNT(*) as n FROM services').get()
  if (svcCount.n === 0) {
    const insDefSvc = db.prepare(`INSERT OR IGNORE INTO services
      (id,name,name_en,category,price,aplica_itbis,is_wash,active,sort_order)
      VALUES (?,?,?,?,?,1,?,1,?)`)
    const defServices = [
      [1,  'Lavado Básico',      'Basic Wash',        'Lavado',       500,  1, 1],
      [2,  'Lavado Completo',    'Full Wash',         'Lavado',       800,  1, 2],
      [3,  'Lavado de Motor',    'Engine Wash',       'Lavado',       1200, 1, 3],
      [4,  'Lavado Jeepeta',     'SUV Wash',          'Lavado',       1000, 1, 4],
      [5,  'Lavado Camión',      'Truck Wash',        'Lavado',       1800, 1, 5],
      [6,  'Aromatizante',       'Air Freshener',     'Adicionales',  150,  1, 1],
      [7,  'Brillo de Gomas',    'Tire Shine',        'Adicionales',  200,  1, 2],
      [8,  'Aspirado Interior',  'Interior Vacuum',   'Adicionales',  400,  1, 3],
      [9,  'Ozono',              'Ozone Treatment',   'Adicionales',  1200, 1, 4],
      [10, 'Lavado + Cera',      'Wash + Wax',        'Detallado',    2000, 1, 1],
      [11, 'Lavado + Aspirado',  'Wash + Vacuum',     'Detallado',    1100, 1, 2],
      [12, 'Detailing Completo', 'Full Detailing',    'Detallado',    4500, 1, 3],
      [13, 'Agua Fría',          'Cold Water',        'Bebidas',      50,   0, 1],
      [14, 'Refresco',           'Soda',              'Bebidas',      100,  0, 2],
      [15, 'Café',               'Coffee',            'Bebidas',      75,   0, 3],
      [16, 'Papitas',            'Chips',             'Bebidas',      80,   0, 4],
      [17, 'Galletas',           'Cookies',           'Bebidas',      60,   0, 5],
    ]
    db.transaction(() => defServices.forEach(r => insDefSvc.run(...r)))()
  }

  // Seed if empty — DEV ONLY (skip in packaged production builds)
  const isProd = typeof process !== 'undefined' && process.resourcesPath && !process.defaultApp
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get()
  if (userCount.n === 0 && !isProd && fs.existsSync(seedPath)) {
    try {
      const seed = require(seedPath)
      seed(db)
    } catch (err) {
      console.error('[SEED ERROR]', err.message, err.stack)
    }
  }

  return true
}

// ── CONFIGURACION ─────────────────────────────────────────────────────────────
function configGet(key) {
  if (!db) return null
  const row = db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(key)
  return row?.valor ?? null
}
function configSet(key, value) {
  if (!db) return
  db.prepare('INSERT OR REPLACE INTO configuracion(clave,valor) VALUES(?,?)').run(key, String(value))
}

// ── EMPRESA ───────────────────────────────────────────────────────────────────
function empresaGet() {
  if (!db) return null
  // Setup is complete only when configuracion.setup_complete = '1'
  if (configGet('setup_complete') !== '1') return null
  return db.prepare('SELECT id,name,rnc,address,phone,email,logo,settings FROM businesses WHERE id=1').get() ?? null
}
function empresaSave(data) {
  if (!db) return
  const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'settings']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE businesses SET ${fields} WHERE id=1`).run(patch)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}
function getSetting(key) {
  if (!db) return null
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)
  return row?.value ?? null
}
function setSetting(key, value) {
  if (!db) return
  db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run(key, String(value))
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function settingsGet() {
  if (!db) return {}
  const rows = db.prepare('SELECT key,value FROM app_settings').all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}
function settingsUpdate(obj) {
  if (!db) return
  const stmt = db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)')
  const run  = db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) stmt.run(k, String(v))
  })
  run()
}

// ── USERS / AUTH ──────────────────────────────────────────────────────────────
function authByPin(pin) {
  if (!db) return null
  const hash = sha256(pin)
  return db.prepare('SELECT id,name,username,role,discount_pct FROM users WHERE pin_hash=? AND active=1').get(hash)
}
function usersGetAll() {
  if (!db) return []
  return db.prepare('SELECT id,name,username,role,discount_pct,active FROM users ORDER BY id').all()
}
function userCreate(data) {
  if (!db) return null
  // Check if username exists — update PIN if so (re-run setup), otherwise insert
  const existing = db.prepare('SELECT id FROM users WHERE username=?').get(data.username)
  if (existing) {
    const hash = (() => { if (!data.pin) throw new Error('PIN requerido'); return sha256(data.pin) })()
    return db.prepare('UPDATE users SET name=@name, pin_hash=@pin_hash, role=@role, discount_pct=@discount_pct, active=1 WHERE id=@id')
      .run({ name: data.name, pin_hash: hash, role: data.role, discount_pct: data.discount_pct, id: existing.id })
  }
  return db.prepare(`INSERT INTO users(name,username,pin_hash,role,discount_pct,active)
    VALUES(@name,@username,@pin_hash,@role,@discount_pct,1)`).run({
    ...data,
    pin_hash: (() => { if (!data.pin) throw new Error('PIN requerido'); return sha256(data.pin) })(),
  })
}
function userUpdate(id, data) {
  if (!db) return
  const { pin, ...rest } = data
  if (pin) rest.pin_hash = sha256(pin)
  const fields = Object.keys(rest).filter(k => k !== 'id').map(k => `${k}=@${k}`).join(',')
  if (!fields) return
  db.prepare(`UPDATE users SET ${fields} WHERE id=@id`).run({ ...rest, id })
}
function userDelete(id) {
  if (!db) return
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(id)
}

// ── CATEGORIAS SERVICIO ───────────────────────────────────────────────────────
function categoriasGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM categorias_servicio ORDER BY orden, nombre').all()
}
function categoriaCreate(data) {
  if (!db) return null
  const r = db.prepare('INSERT INTO categorias_servicio(nombre, orden) VALUES(@nombre, @orden)')
    .run({ nombre: data.nombre, orden: data.orden || 0 })
  return { id: r.lastInsertRowid }
}
function categoriaUpdate(id, data) {
  if (!db) return
  const allowed = ['nombre', 'orden']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE categorias_servicio SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function categoriaDelete(id) {
  if (!db) return
  // Only delete if no services reference it
  const count = db.prepare('SELECT COUNT(*) as n FROM services WHERE categoria_id=?').get(id)
  if (count?.n > 0) throw new Error('Categoría tiene servicios asociados')
  db.prepare('DELETE FROM categorias_servicio WHERE id=?').run(id)
}

// ── SERVICES ──────────────────────────────────────────────────────────────────
function servicesGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM services WHERE active=1 ORDER BY category, sort_order, id').all()
}
function servicesGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM services ORDER BY category, sort_order, id').all()
}
function serviceCreate(data) {
  if (!db) return null
  const r = db.prepare(`INSERT INTO services(name,name_en,category,categoria_id,price,aplica_itbis,is_wash,active,sort_order)
    VALUES(@name,@name_en,@category,@categoria_id,@price,COALESCE(@aplica_itbis,1),@is_wash,1,COALESCE(@sort_order,0))`).run({
    name: data.name, name_en: data.name_en || null,
    category: data.category || 'Lavado', categoria_id: data.categoria_id || null,
    price: data.price, aplica_itbis: data.aplica_itbis ?? 1,
    is_wash: data.is_wash ?? 1, sort_order: data.sort_order || 0,
  })
  return { id: r.lastInsertRowid }
}
function serviceUpdate(id, data) {
  if (!db) return
  const allowed = ['name','name_en','category','categoria_id','price','aplica_itbis','is_wash','active','sort_order']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE services SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function serviceDelete(id) {
  if (!db) return
  db.prepare('UPDATE services SET active=0 WHERE id=?').run(id)
}

// ── WASHERS ───────────────────────────────────────────────────────────────────
function washersGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM washers WHERE active=1 ORDER BY name').all()
}
function washersGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM washers ORDER BY name').all()
}
function washerCreate(data) {
  if (!db) return null
  const r = db.prepare(`INSERT INTO washers(name,phone,cedula,commission_pct,start_date,active)
    VALUES(@name,@phone,@cedula,@commission_pct,@start_date,1)`).run({
    name: data.name, phone: data.phone || null, cedula: data.cedula || null,
    commission_pct: data.commission_pct || 20, start_date: data.start_date || null,
  })
  return { id: r.lastInsertRowid }
}
function washerUpdate(id, data) {
  if (!db) return
  const allowed = ['name','phone','cedula','commission_pct','start_date','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE washers SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function washerDelete(id) {
  if (!db) return
  db.prepare('UPDATE washers SET active=0 WHERE id=?').run(id)
}

// ── Empleados (payroll) ─────────────────────────────────────────────────────
function empleadosGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM empleados WHERE active=1 ORDER BY nombre').all()
}
function empleadosGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM empleados ORDER BY nombre').all()
}
function empleadoCreate(data) {
  if (!db) return null
  const r = db.prepare(`INSERT INTO empleados(nombre,tipo,ref_id,salary,start_date,cedula,phone,active)
    VALUES(@nombre,@tipo,@ref_id,@salary,@start_date,@cedula,@phone,1)`).run({
    nombre: data.nombre, tipo: data.tipo, ref_id: data.ref_id || null,
    salary: data.salary || 0, start_date: data.start_date,
    cedula: data.cedula || null, phone: data.phone || null,
  })
  return { id: r.lastInsertRowid }
}
function empleadoUpdate(id, data) {
  if (!db) return
  const allowed = ['nombre','tipo','ref_id','salary','start_date','cedula','phone','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE empleados SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function empleadoDelete(id) {
  if (!db) return
  db.prepare('UPDATE empleados SET active=0 WHERE id=?').run(id)
}

// ── SELLERS ───────────────────────────────────────────────────────────────────
function sellersGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM sellers WHERE active=1 ORDER BY name').all()
}
function sellersGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM sellers ORDER BY name').all()
}
function sellerCreate(data) {
  if (!db) return null
  const r = db.prepare('INSERT INTO sellers(name,commission_pct,phone,active) VALUES(?,?,?,1)')
    .run(data.name, data.commission_pct || 5, data.phone || null)
  return { id: r.lastInsertRowid }
}
function sellerUpdate(id, data) {
  if (!db) return
  const allowed = ['name','commission_pct','phone','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE sellers SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function sellerDelete(id) {
  if (!db) return
  db.prepare('UPDATE sellers SET active=0 WHERE id=?').run(id)
}

// ── CLIENTS ───────────────────────────────────────────────────────────────────
function clientsGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM clients WHERE active=1 ORDER BY name').all()
}
function clientGetById(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM clients WHERE id=?').get(id)
}
function clientCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO clients(name,rnc,phone,email,address,credit_limit,balance)
    VALUES(@name,@rnc,@phone,@email,@address,@credit_limit,0)`).run(data)
}
function clientUpdate(id, data) {
  if (!db) return
  const allowed = ['name','rnc','phone','email','address','credit_limit','balance','visits','total_spent','notes','active']
  const patch   = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (Object.keys(patch).length === 0) return
  const fields  = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE clients SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function clientUpdateBalance(id, delta) {
  if (!db) return
  db.prepare('UPDATE clients SET balance=balance+@delta WHERE id=@id').run({ id, delta })
}
function clientGetOpenTickets(clientId) {
  if (!db) return []
  const rows = db.prepare(
    `SELECT t.*,
       json_group_array(
         json_object('name', ti.name, 'price', ti.price, 'is_wash', ti.is_wash)
       ) as items_json
     FROM tickets t
     LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
     WHERE t.client_id=? AND t.tipo_venta='credito' AND t.status='pendiente'
     GROUP BY t.id ORDER BY t.created_at ASC`
  ).all(clientId)
  return rows.map(r => {
    let items = []
    try {
      const parsed = JSON.parse(r.items_json || '[]')
      items = parsed.filter(i => i.name != null)
    } catch {}
    return { ...r, items }
  })
}
function collectCredit({ clientId, ticketIds, amount, paymentMethod, ncf, notes, cajeroId }) {
  if (!db) return null
  return db.transaction(() => {
    const updTicket = db.prepare("UPDATE tickets SET status='cobrado', payment_method=? WHERE id=?")
    for (const tid of ticketIds) updTicket.run(paymentMethod, tid)
    db.prepare('UPDATE clients SET balance=MAX(0,balance-?) WHERE id=?').run(amount, clientId)
    const r = db.prepare(
      `INSERT INTO credit_payments(client_id,ticket_ids,amount,payment_method,ncf,notes,cajero_id)
       VALUES(?,?,?,?,?,?,?)`
    ).run(clientId, JSON.stringify(ticketIds), amount, paymentMethod, ncf||null, notes||null, cajeroId||null)
    return { id: r.lastInsertRowid }
  })()
}

// ── TICKETS ───────────────────────────────────────────────────────────────────
function ticketsGetAll({ dateFrom, dateTo, status, limit = 200 } = {}) {
  if (!db) return []
  const safeLimit = Math.min(limit || 200, 500)
  let sql  = `SELECT t.*, c.name as client_name, c.rnc as client_rnc,
                     u.name as cajero_name,
                     GROUP_CONCAT(ti.name, ' + ') as service_names
              FROM tickets t
              LEFT JOIN clients c ON c.id = t.client_id
              LEFT JOIN users u ON u.id = t.cajero_id
              LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
              WHERE 1=1`
  const params = []
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  if (status)   { sql += ' AND t.status = ?';      params.push(status)   }
  sql += ' GROUP BY t.id ORDER BY t.created_at DESC LIMIT ?'
  params.push(safeLimit)
  return db.prepare(sql).all(...params)
}
function ticketGetById(id) {
  if (!db) return null
  const ticket = db.prepare(
    `SELECT t.*, c.name as client_name, c.rnc as client_rnc, u.name as cajero_name
     FROM tickets t
     LEFT JOIN clients c ON c.id=t.client_id
     LEFT JOIN users u ON u.id=t.cajero_id
     WHERE t.id=?`
  ).get(id)
  if (ticket) {
    ticket.items = db.prepare('SELECT * FROM ticket_items WHERE ticket_id=?').all(id)
    try { ticket.ecf_result = JSON.parse(ticket.ecf_result || '{}') } catch { ticket.ecf_result = {} }
    try { ticket.washer_ids = JSON.parse(ticket.washer_ids || '[]') } catch { ticket.washer_ids = [] }
  }
  return ticket
}
function ticketCreate(data) {
  if (!db) return null

  const tx = db.transaction(() => {
    // Get next doc number
    const last = db.prepare('SELECT doc_number FROM tickets ORDER BY id DESC LIMIT 1').get()
    let nextNum = 1
    if (last?.doc_number) {
      const m = last.doc_number.match(/T-(\d+)/)
      if (m) nextNum = parseInt(m[1]) + 1
    }
    const docNumber = `T-${String(nextNum).padStart(4, '0')}`

    // Get next NCF
    const ncfRow = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1').get(data.comprobante_type || 'B02')
    let ncf = null
    if (ncfRow) {
      const nextNCF = ncfRow.current_number + 1
      ncf = `${ncfRow.prefix}${String(nextNCF).padStart(8, '0')}`
      db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(nextNCF, ncfRow.type)
    }

    const result = db.prepare(`INSERT INTO tickets
      (doc_number,client_id,washer_ids,seller_id,cajero_id,subtotal,descuento,itbis,ley,total,
       beverage_subtotal,payment_method,comprobante_type,ncf,ecf_result,tipo_venta,status,vehicle_plate,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      docNumber,
      data.client_id || null,
      JSON.stringify(data.washer_ids || []),
      data.seller_id || null,
      data.cajero_id || null,
      data.subtotal,
      data.descuento || 0,
      data.itbis,
      data.ley || 0,
      data.total,
      data.beverage_subtotal || 0,
      data.payment_method || 'cash',
      data.comprobante_type || 'B02',
      ncf,
      JSON.stringify(data.ecf_result || {}),
      data.tipo_venta || 'contado',
      data.status || (data.payment_method === 'credit' ? 'pendiente' : 'cobrado'),
      data.vehicle_plate || null,
    )
    const ticketId = result.lastInsertRowid

    // Insert items — pre-validate service IDs to avoid FK violations from stale/demo IDs
    const validSvcIds = new Set(db.prepare('SELECT id FROM services').all().map(r => r.id))
    const insItem = db.prepare(`INSERT INTO ticket_items(ticket_id,service_id,name,price,itbis,is_wash)
      VALUES(?,?,?,?,?,?)`)
    for (const item of (data.items || [])) {
      const svcId = (item.service_id && validSvcIds.has(item.service_id)) ? item.service_id : null
      insItem.run(ticketId, svcId, item.name, item.price,
        parseFloat((item.price * 0.18).toFixed(2)), item.is_wash ?? 1)
    }

    // Update client balance if credit
    if (data.client_id && data.tipo_venta === 'credito') {
      db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
        .run(data.total, data.total, data.client_id)
    } else if (data.client_id) {
      db.prepare('UPDATE clients SET visits=visits+1,total_spent=total_spent+? WHERE id=?')
        .run(data.total, data.client_id)
    }

    // Washer commissions — only on wash/service items (NOT beverages/snacks)
    // Service prices include 18% ITBIS — strip it out for commission base
    const commBase  = parseFloat((((data.subtotal || 0) - (data.beverage_subtotal || 0)) / 1.18).toFixed(2))
    if (commBase > 0) {
      for (const wid of (data.washer_ids || [])) {
        const washer  = db.prepare('SELECT commission_pct FROM washers WHERE id=?').get(wid)
        if (!washer || washer.commission_pct <= 0) continue
        const commAmount = parseFloat((commBase * washer.commission_pct / 100).toFixed(2))
        db.prepare(`INSERT INTO washer_commissions
          (washer_id,ticket_id,base_amount,commission_pct,commission_amount,paid)
          VALUES(?,?,?,?,?,0)`).run(wid, ticketId, parseFloat(commBase.toFixed(2)), washer.commission_pct, commAmount)
      }
    }

    // Seller commission — only on wash/service items (NOT beverages/snacks)
    if (data.seller_id && commBase > 0) {
      const seller = db.prepare('SELECT commission_pct FROM sellers WHERE id=?').get(data.seller_id)
      if (seller && seller.commission_pct > 0) {
        const commAmount = parseFloat((commBase * seller.commission_pct / 100).toFixed(2))
        db.prepare(`INSERT INTO seller_commissions
          (seller_id,ticket_id,base_amount,commission_pct,commission_amount,paid)
          VALUES(?,?,?,?,?,0)`).run(data.seller_id, ticketId, parseFloat(commBase.toFixed(2)), seller.commission_pct, commAmount)
      }
    }

    // Cajero commission — on beverages/snacks only (prices include 18% ITBIS)
    const bevBase = parseFloat(((data.beverage_subtotal || 0) / 1.18).toFixed(2))
    if (data.cajero_id && bevBase > 0) {
      const cajero = db.prepare('SELECT commission_pct FROM users WHERE id=?').get(data.cajero_id)
      if (cajero && cajero.commission_pct > 0) {
        const commAmount = parseFloat((bevBase * cajero.commission_pct / 100).toFixed(2))
        db.prepare(`INSERT INTO cajero_commissions
          (cajero_id,ticket_id,base_amount,commission_pct,commission_amount,paid)
          VALUES(?,?,?,?,?,0)`).run(data.cajero_id, ticketId, bevBase, cajero.commission_pct, commAmount)
      }
    }

    // Add to queue — seed with first washer so it shows immediately on Cola de Espera
    // Validate washer ID exists in washers table before using as FK
    const rawFirstWasher = (data.washer_ids || [])[0] || null
    const firstWasherId = rawFirstWasher
      ? (db.prepare('SELECT 1 FROM washers WHERE id=?').get(rawFirstWasher) ? rawFirstWasher : null)
      : null
    if (rawFirstWasher && !firstWasherId) {
      console.warn(`[ticketCreate] washer_id ${rawFirstWasher} not found in washers — inserting queue with null washer_id`)
    }
    db.prepare(`INSERT INTO queue(ticket_id,status,washer_id) VALUES(?,?,?)`).run(ticketId, 'waiting', firstWasherId)

    return { ticketId, docNumber, ncf }
  })

  return tx()
}
function ticketMarkPaid(id, { paymentMethod, ncf, ecfResult, cajeroId, tipoVenta, clientId } = {}) {
  if (!db) return null
  db.transaction(() => {
    // Credit tickets stay 'pendiente' so they appear in Cuentas x Cobrar.
    // Only mark 'cobrado' when collected as contado/cash/card/transfer.
    const newStatus = tipoVenta === 'credito' ? 'pendiente' : 'cobrado'

    db.prepare(`UPDATE tickets SET status=?,
      payment_method=COALESCE(?,payment_method),
      ncf=COALESCE(?,ncf),
      ecf_result=COALESCE(?,ecf_result),
      cajero_id=COALESCE(?,cajero_id)
      WHERE id=?`).run(
      newStatus,
      paymentMethod || null, ncf || null,
      ecfResult ? JSON.stringify(ecfResult) : null,
      cajeroId || null, id)

    if (tipoVenta === 'credito' && clientId) {
      // Fetch original tipo_venta to avoid double-counting if ticket was already posted as credit
      const row = db.prepare('SELECT total, tipo_venta FROM tickets WHERE id=?').get(id)
      if (row && row.tipo_venta !== 'credito') {
        const amount = row.total || 0
        db.prepare('UPDATE tickets SET tipo_venta=?,client_id=? WHERE id=?')
          .run('credito', clientId, id)
        db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
          .run(amount, amount, clientId)
      }
    }
  })()
  return { id }
}
function ticketVoid(id, reason, voidById) {
  if (!db) return
  db.transaction(() => {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(id)
    if (!ticket) return
    db.prepare(`UPDATE tickets SET status='nula',void_reason=?,void_by=?,void_at=datetime('now') WHERE id=?`)
      .run(reason, voidById || null, id)
    // Reverse client balance if it was a credit ticket
    if (ticket.client_id && ticket.tipo_venta === 'credito') {
      db.prepare('UPDATE clients SET balance=balance-? WHERE id=?').run(ticket.total, ticket.client_id)
    }
  })()
}
function ticketGetByDateRange(dateFrom, dateTo) {
  return ticketsGetAll({ dateFrom, dateTo })
}

// ── QUEUE ─────────────────────────────────────────────────────────────────────
function queueGetActive() {
  if (!db) return []
  return db.prepare(
    `SELECT q.*, t.doc_number, t.total, t.vehicle_plate, t.created_at as ticket_created,
            c.name as client_name,
            GROUP_CONCAT(ti.name, ' + ') as services,
            w.name as washer_name
     FROM queue q
     JOIN tickets t ON t.id = q.ticket_id
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
     LEFT JOIN washers w ON w.id = q.washer_id
     WHERE q.status != 'done'
     GROUP BY q.id
     ORDER BY q.created_at ASC`
  ).all()
}
function queueUpdateStatus(id, status, washerId = null) {
  if (!db) return
  const now = new Date().toISOString()
  if (status === 'in_progress') {
    db.prepare(`UPDATE queue SET status=?,washer_id=?,assigned_at=? WHERE id=?`).run(status, washerId, now, id)
  } else if (status === 'done') {
    db.prepare(`UPDATE queue SET status=?,completed_at=? WHERE id=?`).run(status, now, id)
  } else {
    db.prepare(`UPDATE queue SET status=? WHERE id=?`).run(status, id)
  }
}

// ── COMMISSIONS ───────────────────────────────────────────────────────────────
function commissionsGetByWasher(washerId, dateFrom, dateTo) {
  if (!db) return []
  let sql = `SELECT wc.*, t.doc_number, t.created_at as ticket_date, t.vehicle_plate,
                    w.name as washer_name, w.commission_pct,
                    GROUP_CONCAT(ti.name, ' + ') as services
             FROM washer_commissions wc
             JOIN tickets t ON t.id = wc.ticket_id
             JOIN washers w ON w.id = wc.washer_id
             LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=1
             WHERE wc.washer_id=? AND t.status='cobrado'`
  const params = [washerId]
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  sql += ' GROUP BY wc.id ORDER BY t.created_at DESC LIMIT 2000'
  return db.prepare(sql).all(...params)
}
function commissionsGetByPeriod(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT wc.washer_id, w.name as washer_name, w.commission_pct,
            COUNT(wc.id) as ticket_count,
            SUM(wc.base_amount) as total_base,
            SUM(wc.commission_amount) as total_commission
     FROM washer_commissions wc
     JOIN tickets t ON t.id = wc.ticket_id
     JOIN washers w ON w.id = wc.washer_id
     WHERE t.status='cobrado'
       AND t.created_at >= ? AND t.created_at <= ?
     GROUP BY wc.washer_id ORDER BY total_commission DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}
function commissionsMarkPaid(washerCommissionIds) {
  if (!db) return
  const stmt = db.prepare(`UPDATE washer_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => washerCommissionIds.forEach(id => stmt.run(id)))()
}

// ── SELLER COMMISSIONS ────────────────────────────────────────────────────────
function sellerCommissionsBySeller(sellerId, dateFrom, dateTo) {
  if (!db) return []
  let sql = `SELECT sc.*, t.doc_number, t.created_at as ticket_date, t.vehicle_plate,
                    s.name as seller_name, s.commission_pct,
                    GROUP_CONCAT(ti.name, ' + ') as services
             FROM seller_commissions sc
             JOIN tickets t ON t.id = sc.ticket_id
             JOIN sellers s ON s.id = sc.seller_id
             LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=1
             WHERE sc.seller_id=? AND t.status='cobrado'`
  const params = [sellerId]
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  sql += ' GROUP BY sc.id ORDER BY t.created_at DESC LIMIT 2000'
  return db.prepare(sql).all(...params)
}
function sellerCommissionsByPeriod(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT sc.seller_id, s.name as seller_name, s.commission_pct,
            COUNT(sc.id) as ticket_count,
            SUM(sc.base_amount) as total_base,
            SUM(sc.commission_amount) as total_commission
     FROM seller_commissions sc
     JOIN tickets t ON t.id = sc.ticket_id
     JOIN sellers s ON s.id = sc.seller_id
     WHERE t.status='cobrado'
       AND t.created_at >= ? AND t.created_at <= ?
     GROUP BY sc.seller_id ORDER BY total_commission DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}
function sellerCommissionsMarkPaid(ids) {
  if (!db) return
  const stmt = db.prepare(`UPDATE seller_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => ids.forEach(id => stmt.run(id)))()
}

// ── CAJERO COMMISSIONS ───────────────────────────────────────────────────────
function cajeroCommissionsByCajero(cajeroId, dateFrom, dateTo) {
  if (!db) return []
  let sql = `SELECT cc.*, t.doc_number, t.created_at as ticket_date, t.vehicle_plate,
                    u.name as cajero_name, u.commission_pct,
                    GROUP_CONCAT(ti.name, ' + ') as services
             FROM cajero_commissions cc
             JOIN tickets t ON t.id = cc.ticket_id
             JOIN users u ON u.id = cc.cajero_id
             LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=0
             WHERE cc.cajero_id=? AND t.status='cobrado'`
  const params = [cajeroId]
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  sql += ' GROUP BY cc.id ORDER BY t.created_at DESC LIMIT 2000'
  return db.prepare(sql).all(...params)
}
function cajeroCommissionsByPeriod(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT cc.cajero_id, u.name as cajero_name, u.commission_pct,
            COUNT(cc.id) as ticket_count,
            SUM(cc.base_amount) as total_base,
            SUM(cc.commission_amount) as total_commission
     FROM cajero_commissions cc
     JOIN tickets t ON t.id = cc.ticket_id
     JOIN users u ON u.id = cc.cajero_id
     WHERE t.status='cobrado'
       AND t.created_at >= ? AND t.created_at <= ?
     GROUP BY cc.cajero_id ORDER BY total_commission DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}
function cajeroCommissionsMarkPaid(ids) {
  if (!db) return
  const stmt = db.prepare(`UPDATE cajero_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => ids.forEach(id => stmt.run(id)))()
}

// ── CUADRE DE CAJA ────────────────────────────────────────────────────────────
function cuadreCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO cuadre_caja
    (cajero_id,date,fondo,efectivo_conteo,efectivo_sistema,tarjeta,transferencia,
     cheque,creditos,salidas,total_vendido,total_cobrado,cierre_total,diferencia,
     comentario,denominaciones)
    VALUES(@cajero_id,@date,@fondo,@efectivo_conteo,@efectivo_sistema,@tarjeta,
           @transferencia,@cheque,@creditos,@salidas,@total_vendido,@total_cobrado,
           @cierre_total,@diferencia,@comentario,@denominaciones)`).run({
    ...data,
    denominaciones: JSON.stringify(data.denominaciones || {}),
  })
}
function cuadreGetHistory(limit = 20) {
  if (!db) return []
  return db.prepare(
    `SELECT c.*, u.name as cajero_name FROM cuadre_caja c
     LEFT JOIN users u ON u.id=c.cajero_id
     ORDER BY c.closed_at DESC LIMIT ?`
  ).all(limit)
}
function cuadreList({ dateFrom, dateTo, limit = 100 } = {}) {
  if (!db) return []
  let sql = `SELECT c.*, u.name as cajero_name FROM cuadre_caja c
             LEFT JOIN users u ON u.id=c.cajero_id WHERE 1=1`
  const params = []
  if (dateFrom) { sql += ' AND c.date >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND c.date <= ?'; params.push(dateTo) }
  sql += ' ORDER BY c.closed_at DESC LIMIT ?'
  params.push(limit)
  return db.prepare(sql).all(...params)
}
function cuadreDailySummary(date) {
  if (!db) return {}
  const d = date || new Date().toISOString().slice(0, 10)
  const from = `${d}T00:00:00`
  const to   = `${d}T23:59:59`
  const rows = db.prepare(
    `SELECT payment_method, SUM(total) as sum FROM tickets
     WHERE status='cobrado' AND created_at BETWEEN ? AND ?
     GROUP BY payment_method`
  ).all(from, to)
  const result = { efectivo:0, tarjeta:0, transferencia:0, cheque:0, credito:0 }
  for (const r of rows) result[r.payment_method] = r.sum || 0
  const totals = db.prepare(
    `SELECT SUM(total) as vendido,
            SUM(CASE WHEN payment_method != 'credit' THEN total ELSE 0 END) as cobrado,
            COUNT(*) as count
     FROM tickets WHERE status='cobrado' AND created_at BETWEEN ? AND ?`
  ).get(from, to)
  return { ...result, totalVendido: totals?.vendido||0, totalCobrado: totals?.cobrado||0, count: totals?.count||0 }
}

// ── NCF ───────────────────────────────────────────────────────────────────────
function ncfGetSequences() {
  if (!db) return []
  return db.prepare('SELECT * FROM ncf_sequences ORDER BY type').all()
}
function ncfGetNext(type) {
  if (!db) return null
  const row = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1 AND enabled=1').get(type)
  if (!row) return null
  const next = row.current_number + 1
  db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(next, type)
  return `${row.prefix}${String(next).padStart(8, '0')}`
}
function ncfUpdateSequence(type, data) {
  if (!db) return
  const fields = Object.keys(data).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE ncf_sequences SET ${fields} WHERE type=@type`).run({ ...data, type })
}

// ── CAJA CHICA ────────────────────────────────────────────────────────────────
function cajaChicaGetAll() {
  if (!db) return []
  return db.prepare(
    `SELECT cc.*, u.name as approved_name FROM caja_chica cc
     LEFT JOIN users u ON u.id=cc.approved_by
     ORDER BY cc.created_at DESC LIMIT 100`
  ).all()
}
function cajaChicaCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO caja_chica(description,category,type,amount,recibo,status,cajero_id)
    VALUES(@description,@category,@type,@amount,@recibo,@status,@cajero_id)`).run(data)
}
function cajaChicaUpdateStatus(id, status, approvedBy) {
  if (!db) return
  db.prepare(`UPDATE caja_chica SET status=?,approved_by=? WHERE id=?`).run(status, approvedBy, id)
}

// ── NOTAS DE CREDITO ──────────────────────────────────────────────────────────
function notasGetAll() {
  if (!db) return []
  return db.prepare(
    `SELECT n.*, c.name as client_name FROM notas_credito n
     LEFT JOIN clients c ON c.id=n.client_id
     ORDER BY n.created_at DESC LIMIT 100`
  ).all()
}
function notaCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO notas_credito
    (ncf,client_id,original_ticket_id,motivo,amount,itbis_revertido,forma_devolucion,comentario,cajero_id)
    VALUES(@ncf,@client_id,@original_ticket_id,@motivo,@amount,@itbis_revertido,@forma_devolucion,@comentario,@cajero_id)`
  ).run(data)
}

// ── EXPORT ALL (for backup) ───────────────────────────────────────────────────
function exportAll() {
  if (!db) return {}
  const tables = ['tickets','ticket_items','clients','credit_payments','queue',
    'cuadre_caja','caja_chica','notas_credito','washer_commissions','ncf_sequences','app_settings']
  const snap = { exported_at: new Date().toISOString(), version: '1.0.0', tables: {} }
  for (const t of tables) {
    try { snap.tables[t] = db.prepare(`SELECT * FROM ${t}`).all() }
    catch { snap.tables[t] = [] }
  }
  return snap
}
function exportSince(since) {
  if (!db) return { tickets:[], clients:[], payments:[] }
  return {
    tickets: db.prepare(`SELECT * FROM tickets WHERE created_at > ?`).all(since),
    clients: db.prepare(`SELECT * FROM clients WHERE created_at > ?`).all(since),
    payments: db.prepare(`SELECT * FROM credit_payments WHERE created_at > ?`).all(since),
  }
}

// ── Export to Supabase (full dump for cloud sync) ─────────────────────────────
function exportToSupabase() {
  if (!db) return {}
  return {
    business:        db.prepare('SELECT * FROM businesses WHERE id=1').get() || null,
    users:           db.prepare('SELECT * FROM users WHERE active=1').all(),
    services:        db.prepare('SELECT * FROM services').all(),
    washers:         db.prepare('SELECT * FROM washers WHERE active=1').all(),
    sellers:         db.prepare('SELECT * FROM sellers WHERE active=1').all(),
    clients:         db.prepare('SELECT * FROM clients WHERE active=1').all(),
    tickets:         db.prepare('SELECT * FROM tickets ORDER BY created_at DESC LIMIT 500').all(),
    ticket_items:    db.prepare('SELECT * FROM ticket_items').all(),
    ncf_sequences:   db.prepare('SELECT * FROM ncf_sequences').all(),
    inventory_items: db.prepare('SELECT * FROM inventory_items WHERE active=1').all(),
  }
}

// ── DGII 607 — Compras ────────────────────────────────────────────────────────
function getCompras607(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT * FROM compras_607 WHERE fecha_ncf BETWEEN ? AND ? ORDER BY fecha_ncf DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}

function addCompra607(data) {
  if (!db) return null
  const stmt = db.prepare(`
    INSERT INTO compras_607
      (rnc_proveedor, nombre_proveedor, tipo_ncf, ncf, ncf_modificado,
       fecha_ncf, fecha_pago, monto_servicios, monto_bienes, total,
       itbis_facturado, itbis_retenido, retencion_renta, forma_pago, notas)
    VALUES
      (@rnc_proveedor, @nombre_proveedor, @tipo_ncf, @ncf, @ncf_modificado,
       @fecha_ncf, @fecha_pago, @monto_servicios, @monto_bienes, @total,
       @itbis_facturado, @itbis_retenido, @retencion_renta, @forma_pago, @notas)
  `)
  const result = stmt.run({
    rnc_proveedor:    data.rnc_proveedor    || '',
    nombre_proveedor: data.nombre_proveedor || '',
    tipo_ncf:         data.tipo_ncf         || 'B01',
    ncf:              data.ncf              || '',
    ncf_modificado:   data.ncf_modificado   || '',
    fecha_ncf:        data.fecha_ncf        || new Date().toISOString().slice(0,10),
    fecha_pago:       data.fecha_pago       || '',
    monto_servicios:  Number(data.monto_servicios)  || 0,
    monto_bienes:     Number(data.monto_bienes)     || 0,
    total:            Number(data.total)            || 0,
    itbis_facturado:  Number(data.itbis_facturado)  || 0,
    itbis_retenido:   Number(data.itbis_retenido)   || 0,
    retencion_renta:  Number(data.retencion_renta)  || 0,
    forma_pago:       data.forma_pago       || 'efectivo',
    notas:            data.notas            || '',
  })
  return { id: result.lastInsertRowid }
}

function deleteCompra607(id) {
  if (!db) return null
  return db.prepare('DELETE FROM compras_607 WHERE id=?').run(id)
}

// ── DGII data ─────────────────────────────────────────────────────────────────
function get606Data(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT t.id, t.ncf, t.comprobante_type as tipo, t.created_at as fecha,
            t.subtotal, t.itbis, t.ley, t.total, t.status as estado,
            c.name as client_name, c.rnc as client_rnc
     FROM tickets t
     LEFT JOIN clients c ON c.id=t.client_id
     WHERE t.created_at BETWEEN ? AND ?
     ORDER BY t.created_at DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}

// ── RNC contribuyentes ────────────────────────────────────────────────────────

// Single lookup — DGII-synced rows never expire; API-cached rows expire in 90d
function rncLookupLocal(rnc) {
  if (!db) return null
  const row = db.prepare('SELECT * FROM rnc_contribuyentes WHERE rnc=?').get(rnc)
  if (!row) return null
  if (row.source === 'api') {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    if (row.synced_at < cutoff) return null
  }
  return row
}

// Save a single API-lookup result
function rncSave(rnc, data, source = 'api') {
  if (!db) return
  db.prepare(`INSERT OR REPLACE INTO rnc_contribuyentes
    (rnc,nombre,nombre_comercial,actividad,estado,regimen,provincia,source,synced_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
    rnc,
    data.nombre            || '',
    data.nombreComercial   || data.nombre_comercial || '',
    data.actividadEconomica|| data.actividad        || '',
    data.estado            || 'ACTIVO',
    data.regimen           || 'NORMAL',
    data.provincia         || '',
    source,
    new Date().toISOString()
  )
}

// Bulk insert from DGII ZIP sync — called inside a transaction batch
function rncBulkSync(rows) {
  if (!db || !rows.length) return 0
  const stmt = db.prepare(`INSERT OR REPLACE INTO rnc_contribuyentes
    (rnc,nombre,nombre_comercial,actividad,estado,regimen,provincia,source,synced_at)
    VALUES(?,?,?,?,?,?,?,?,?)`)
  const now = new Date().toISOString()
  const tx  = db.transaction(items => {
    for (const r of items) {
      stmt.run(r.rnc, r.nombre, r.nombre_comercial, r.actividad, r.estado, r.regimen, r.provincia, 'dgii_sync', now)
    }
  })
  tx(rows)
  return rows.length
}

function rncCount() {
  if (!db) return 0
  return db.prepare('SELECT COUNT(*) as c FROM rnc_contribuyentes').get()?.c || 0
}

function rncLastSync() {
  if (!db) return null
  return db.prepare("SELECT MAX(synced_at) as last FROM rnc_contribuyentes WHERE source='dgii_sync'").get()?.last || null
}

// ── Inventory ─────────────────────────────────────────────────────────────────

function inventoryGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM inventory_items WHERE active=1 ORDER BY name COLLATE NOCASE').all()
}
function inventoryCreate(data) {
  if (!db) return null
  const r = db.prepare(`INSERT INTO inventory_items(sku,name,category,quantity,min_quantity,price,cost)
    VALUES(@sku,@name,@category,@quantity,@min_quantity,@price,@cost)`).run({
    sku: data.sku || null, name: data.name, category: data.category || '',
    quantity: data.quantity || 0, min_quantity: data.min_quantity ?? 5,
    price: data.price || 0, cost: data.cost || 0,
  })
  return r.lastInsertRowid
}
function inventoryUpdate(id, data) {
  if (!db) return
  db.prepare(`UPDATE inventory_items
    SET sku=@sku, name=@name, category=@category, min_quantity=@min_quantity, price=@price, cost=@cost
    WHERE id=@id`).run({ sku: data.sku || null, name: data.name, category: data.category || '',
    min_quantity: data.min_quantity ?? 5, price: data.price || 0, cost: data.cost || 0, id })
}
function inventoryDelete(id) {
  if (!db) return
  db.prepare('UPDATE inventory_items SET active=0 WHERE id=?').run(id)
}
function inventoryAdjust(id, delta, notes, userId) {
  if (!db) return null
  const run = db.transaction(() => {
    db.prepare('UPDATE inventory_items SET quantity = quantity + ? WHERE id=?').run(delta, id)
    db.prepare('INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id) VALUES(?,?,?,?,?)')
      .run(id, delta >= 0 ? 'in' : 'out', delta, notes || '', userId || null)
  })
  run()
  return db.prepare('SELECT quantity FROM inventory_items WHERE id=?').get(id)?.quantity ?? null
}
function inventoryTransactions(itemId) {
  if (!db) return []
  return db.prepare(`SELECT t.*, u.name as user_name FROM inventory_transactions t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.item_id=? ORDER BY t.created_at DESC LIMIT 50`).all(itemId)
}

// ── e-CF offline queue ────────────────────────────────────────────────────────

function ecfQueueAdd(urlPath, bodyJson, token, { xmlSigned, encf, tipoEcf, environment } = {}) {
  if (!db) return
  db.prepare('INSERT INTO ecf_queue (url_path, body_json, token, xml_signed, encf, tipo_ecf, environment) VALUES (?,?,?,?,?,?,?)')
    .run(urlPath, typeof bodyJson === 'string' ? bodyJson : JSON.stringify(bodyJson), token || '',
         xmlSigned || null, encf || null, tipoEcf || null, environment || 'testecf')
}

// Only items within DGII's 72h contingency window
function ecfQueueGetPending(limit = 10) {
  if (!db) return []
  return db.prepare(
    `SELECT * FROM ecf_queue WHERE attempts < 500 AND created_at > datetime('now','-72 hours') ORDER BY id ASC LIMIT ?`
  ).all(limit)
}

function ecfQueueDelete(id) {
  if (!db) return
  db.prepare('DELETE FROM ecf_queue WHERE id=?').run(id)
}

function ecfQueueIncrAttempts(id) {
  if (!db) return
  db.prepare(`UPDATE ecf_queue SET attempts=attempts+1, last_tried=datetime('now') WHERE id=?`).run(id)
}

function ecfQueueCount() {
  if (!db) return 0
  return db.prepare(`SELECT COUNT(*) as c FROM ecf_queue WHERE created_at > datetime('now','-72 hours')`).get()?.c || 0
}

// ── e-CF submissions log ──────────────────────────────────────────────────────

function ecfSubmissionAdd({ encf, tipoEcf, ticketId, xmlHash, trackId, dgiiStatus, dgiiMessage, securityCode, signatureDate, xmlPath, environment }) {
  if (!db) return null
  const info = db.prepare(`INSERT OR REPLACE INTO ecf_submissions
    (encf, tipo_ecf, ticket_id, xml_hash, track_id, dgii_status, dgii_message, security_code, signature_date, xml_path, environment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(encf, tipoEcf, ticketId || null, xmlHash || null, trackId || null,
         dgiiStatus ?? 3, dgiiMessage || null, securityCode || null,
         signatureDate || null, xmlPath || null, environment || 'testecf')
  return info.lastInsertRowid
}

function ecfSubmissionUpdate(trackId, { dgiiStatus, dgiiMessage, confirmedAt }) {
  if (!db) return
  db.prepare(`UPDATE ecf_submissions SET dgii_status=?, dgii_message=?, confirmed_at=? WHERE track_id=?`)
    .run(dgiiStatus, dgiiMessage || null, confirmedAt || new Date().toISOString(), trackId)
}

function ecfSubmissionGetByTrackId(trackId) {
  if (!db) return null
  return db.prepare('SELECT * FROM ecf_submissions WHERE track_id=?').get(trackId)
}

function ecfSubmissionGetByTicket(ticketId) {
  if (!db) return null
  return db.prepare('SELECT * FROM ecf_submissions WHERE ticket_id=? ORDER BY submitted_at DESC LIMIT 1').get(ticketId)
}

function ecfSubmissionGetPending(env) {
  if (!db) return []
  return db.prepare('SELECT * FROM ecf_submissions WHERE dgii_status=3 AND environment=? ORDER BY submitted_at ASC LIMIT 20')
    .all(env || 'testecf')
}

function ecfSubmissionGetAll(limit = 50) {
  if (!db) return []
  return db.prepare('SELECT * FROM ecf_submissions ORDER BY submitted_at DESC LIMIT ?').all(limit)
}

// ── Public API ────────────────────────────────────────────────────────────────
module.exports = {
  init, isReady, getError,
  // Empresa
  configGet, configSet,
  empresaGet, empresaSave,
  // Settings
  settingsGet, settingsUpdate, getSetting, setSetting,
  // Auth
  authByPin, usersGetAll, userCreate, userUpdate, userDelete,
  // Categorías de servicio
  categoriasGetAll, categoriaCreate, categoriaUpdate, categoriaDelete,
  // Services
  servicesGetAll, servicesGetAllAdmin, serviceCreate, serviceUpdate, serviceDelete,
  // Washers
  washersGetAll, washersGetAllAdmin, washerCreate, washerUpdate, washerDelete,
  // Sellers
  sellersGetAll, sellersGetAllAdmin, sellerCreate, sellerUpdate, sellerDelete,
  // Empleados (payroll)
  empleadosGetAll, empleadosGetAllAdmin, empleadoCreate, empleadoUpdate, empleadoDelete,
  // Clients
  clientsGetAll, clientGetById, clientCreate, clientUpdate, clientUpdateBalance, clientGetOpenTickets, collectCredit,
  // Tickets
  ticketsGetAll, ticketGetById, ticketCreate, ticketMarkPaid, ticketVoid, ticketGetByDateRange,
  // Queue
  queueGetActive, queueUpdateStatus,
  // Commissions
  commissionsGetByWasher, commissionsGetByPeriod, commissionsMarkPaid,
  sellerCommissionsBySeller, sellerCommissionsByPeriod, sellerCommissionsMarkPaid,
  cajeroCommissionsByCajero, cajeroCommissionsByPeriod, cajeroCommissionsMarkPaid,
  // Cuadre
  cuadreCreate, cuadreGetHistory, cuadreList, cuadreDailySummary,
  // NCF
  ncfGetSequences, ncfGetNext, ncfUpdateSequence,
  // Caja chica
  cajaChicaGetAll, cajaChicaCreate, cajaChicaUpdateStatus,
  // Notas
  notasGetAll, notaCreate,
  // Backup / export
  exportAll, exportSince, exportToSupabase,
  // DGII
  get606Data,
  getCompras607, addCompra607, deleteCompra607,
  // RNC contribuyentes
  rncLookupLocal, rncSave, rncBulkSync, rncCount, rncLastSync,
  // Inventory
  inventoryGetAll, inventoryCreate, inventoryUpdate, inventoryDelete, inventoryAdjust, inventoryTransactions,
  // e-CF offline queue
  ecfQueueAdd, ecfQueueGetPending, ecfQueueDelete, ecfQueueIncrAttempts, ecfQueueCount,
  // e-CF submissions log
  ecfSubmissionAdd, ecfSubmissionUpdate, ecfSubmissionGetByTrackId, ecfSubmissionGetByTicket,
  ecfSubmissionGetPending, ecfSubmissionGetAll,
}
