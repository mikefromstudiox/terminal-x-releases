// scan-pos-binary.js — scan a competing POS app's .exe/.dll for ESC/POS
// drawer-kick byte sequences and related strings. WARNING: static scan hits
// are often data-table entries, NOT the bytes the app sends at runtime.
// capture-spool.ps1 is more reliable. This is for when spool capture isn't
// possible (locked-down PC, no admin, binary-only analysis, etc.).
//
// Usage:
//   node scan-pos-binary.js <path-to-exe-or-dll> [more paths...]

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scan-pos-binary.js <exe-or-dll-path> [more paths...]');
  process.exit(1);
}

const keywords = [
  'drawer', 'Drawer', 'DRAWER',
  'cash', 'Cash', 'CASH',
  'caja', 'Caja', 'CAJA', 'gaveta', 'Gaveta', 'GAVETA',
  'AbrirCaja', 'OpenDrawer', 'OpenCashDrawer', 'KickDrawer',
  'pulse', 'Pulse',
  'RawPrinter', 'WritePrinter', 'SendBytesToPrinter', 'StartDoc',
];

const hexNeedles = [
  { name: 'ESC p pin2 (1B 70 00 ..)',     bytes: [0x1B, 0x70, 0x00] },
  { name: 'ESC p pin5 (1B 70 01 ..)',     bytes: [0x1B, 0x70, 0x01] },
  { name: 'ESC p pin? (1B 70 ..)',        bytes: [0x1B, 0x70] },
  { name: 'DC4 drawer (10 14 01 ..)',     bytes: [0x10, 0x14, 0x01] },
];

function scanFile(file) {
  const buf = fs.readFileSync(file);
  console.log(`\n╔══ ${file}  (${buf.length.toLocaleString()} bytes) ══╗`);

  // ASCII + UTF-16LE keyword scan
  for (const enc of ['ascii', 'utf16le']) {
    console.log(`\n  --- ${enc} keyword hits ---`);
    for (const kw of keywords) {
      const needle = Buffer.from(kw, enc);
      const hits = [];
      let idx = 0;
      while ((idx = buf.indexOf(needle, idx)) !== -1) { hits.push(idx); idx += needle.length; if (hits.length > 5) break; }
      if (hits.length) {
        const contextEnc = enc === 'utf16le' ? 'utf16le' : 'latin1';
        const first = buf.slice(Math.max(0, hits[0] - 20), Math.min(buf.length, hits[0] + 80)).toString(contextEnc).replace(/[\x00-\x1F\x7F]/g, '.');
        console.log(`    ${kw.padEnd(22)} × ${hits.length}  "${first.trim().slice(0, 90)}"`);
      }
    }
  }

  // Hex sequence scan
  console.log(`\n  --- hex sequence hits ---`);
  for (const { name, bytes } of hexNeedles) {
    const needle = Buffer.from(bytes);
    const hits = [];
    let idx = 0;
    while ((idx = buf.indexOf(needle, idx)) !== -1) { hits.push(idx); idx += needle.length; if (hits.length > 10) break; }
    if (hits.length) {
      console.log(`    ${name.padEnd(28)} × ${hits.length}`);
      for (const h of hits.slice(0, 5)) {
        const ctx = buf.slice(Math.max(0, h), Math.min(buf.length, h + 8));
        const hex = [...ctx].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        console.log(`      offset 0x${h.toString(16).padStart(8, '0')}: ${hex}`);
      }
    }
  }
}

for (const file of files) {
  if (!fs.existsSync(file)) { console.error('MISSING:', file); continue; }
  scanFile(file);
}

console.log('\nReminder: static hits are suggestive only. Always prefer spool capture (capture-spool.ps1) for the authoritative bytes.');
