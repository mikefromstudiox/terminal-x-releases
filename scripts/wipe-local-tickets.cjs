// Run on Studio X Auto Detailing PC BEFORE opening Terminal X desktop.
// Wipes local SQLite tickets + ticket_items + children so sync doesn't re-push.
// Works with SQLCipher-encrypted DB (v2.12.1+) via better-sqlite3-multiple-ciphers.

const path = require('path');
const os = require('os');
const crypto = require('crypto');

const Database = require('better-sqlite3-multiple-ciphers');
const { app } = require('electron');

// Resolve DB path same way main.js does
const userData = app?.getPath?.('userData')
  || path.join(os.homedir(), 'AppData', 'Roaming', 'Terminal X');
const dbPath = path.join(userData, 'terminalx.db');

console.log('DB path:', dbPath);

// SQLCipher key derivation (matches electron/database.js)
const { machineIdSync } = require('node-machine-id');
const hwid = machineIdSync(true);
const key = crypto.createHash('sha256').update('terminalx:' + hwid).digest('hex');

const db = new Database(dbPath);
db.pragma(`cipher='sqlcipher'`);
db.pragma(`legacy=4`);
db.pragma(`key="x'${key}'"`);

const before = {
  tickets: db.prepare('SELECT COUNT(*) n FROM tickets').get().n,
  ticket_items: db.prepare('SELECT COUNT(*) n FROM ticket_items').get().n,
};
console.log('Before:', before);

const tx = db.transaction(() => {
  db.prepare('DELETE FROM ticket_items').run();
  try { db.prepare('DELETE FROM payment_parts').run(); } catch {}
  try { db.prepare('DELETE FROM ticket_locks').run(); } catch {}
  db.prepare('DELETE FROM tickets').run();

  // Mark historical commission rows paid so nomina matches cloud
  try { db.prepare(`UPDATE washer_commissions SET paid=1, paid_at=datetime('now') WHERE paid IS NULL OR paid=0`).run(); } catch {}
  try { db.prepare(`UPDATE seller_commissions SET paid=1, paid_at=datetime('now') WHERE paid IS NULL OR paid=0`).run(); } catch {}
  try { db.prepare(`UPDATE cajero_commissions SET paid=1, paid_at=datetime('now') WHERE paid IS NULL OR paid=0`).run(); } catch {}
});
tx();

const after = {
  tickets: db.prepare('SELECT COUNT(*) n FROM tickets').get().n,
  ticket_items: db.prepare('SELECT COUNT(*) n FROM ticket_items').get().n,
};
console.log('After:', after);
console.log('DONE. Safe to open Terminal X now.');
db.close();
