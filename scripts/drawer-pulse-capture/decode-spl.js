// decode-spl.js — reads every *.SPL file in a folder and prints an ESC/POS
// interpretation. The file that represents a drawer-kick is 5-8 bytes starting
// with 1B 70 (ESC p).
//
// Usage:
//   node decode-spl.js <folder>
//
// If <folder> is omitted, defaults to %TEMP%\kicktest\spool-capture\

const fs = require('fs');
const path = require('path');
const os = require('os');

const dir = process.argv[2] || path.join(os.tmpdir(), 'kicktest', 'spool-capture');
if (!fs.existsSync(dir)) {
  console.error('Folder not found:', dir);
  process.exit(1);
}

const ESCPOS_NAMES = {
  0x07: 'BEL (legacy drawer kick)',
  0x09: 'HT',
  0x0A: 'LF',
  0x0C: 'FF (form feed)',
  0x0D: 'CR',
  0x1B: 'ESC',
  0x1C: 'FS',
  0x1D: 'GS',
  0x1E: 'RS',
  0x1F: 'US',
  0x40: '@ (reset)',
  0x70: 'p (drawer kick)',
};

function decodePulse(buf) {
  // Classic: 1B 70 m t1 t2 [terminator bytes]
  if (buf.length < 4 || buf[0] !== 0x1B || buf[1] !== 0x70) return null;
  const pin = buf[2] === 0x00 ? 'pin 2' : buf[2] === 0x01 ? 'pin 5' : `unknown (m=${buf[2]})`;
  const onMs = buf[3] * 2;
  const offMs = buf[4] * 2;
  const tail = buf.slice(5);
  let tailDesc = '(none)';
  if (tail.length) {
    tailDesc = [...tail].map(b => {
      if (b === 0x0D) return 'CR';
      if (b === 0x0A) return 'LF';
      if (b === 0x0C) return 'FF';
      return `0x${b.toString(16).padStart(2, '0')}`;
    }).join(' ');
  }
  return { pin, onMs, offMs, tail: tailDesc };
}

const files = fs.readdirSync(dir).filter(f => /\.(SPL|tmp)$/i.test(f) || /^FP\d/.test(f));
if (!files.length) {
  console.log('No .SPL files in', dir);
  process.exit(0);
}

console.log(`Scanning ${files.length} file(s) in ${dir}\n`);

let pulseFound = null;
for (const f of files) {
  const p = path.join(dir, f);
  const buf = fs.readFileSync(p);
  const hex = buf.length
    ? [...buf].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    : '(empty)';
  console.log(`${f.padEnd(16)} len=${String(buf.length).padStart(5)}  hex: ${hex.slice(0, 80)}${hex.length > 80 ? '...' : ''}`);

  if (buf.length >= 4 && buf.length <= 16 && buf[0] === 0x1B && buf[1] === 0x70) {
    console.log('  └─ DRAWER KICK detected:');
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      const name = ESCPOS_NAMES[b] || '';
      const printable = b >= 0x20 && b < 0x7F ? ` ('${String.fromCharCode(b)}')` : '';
      console.log(`       [${i}] 0x${b.toString(16).padStart(2, '0').toUpperCase()} (${String(b).padStart(3)})${printable}  ${name}`);
    }
    const decoded = decodePulse(buf);
    if (decoded) {
      console.log(`     => ${decoded.pin}, ${decoded.onMs}ms on, ${decoded.offMs}ms off, terminator: ${decoded.tail}`);
    }
    pulseFound = buf;
  }
  console.log('');
}

if (pulseFound) {
  const hex = [...pulseFound].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const hexCompact = [...pulseFound].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  console.log('='.repeat(60));
  console.log('WINNING PULSE:');
  console.log(`  hex (spaced):  ${hex}`);
  console.log(`  hex (compact): ${hexCompact}`);
  console.log(`  length:        ${pulseFound.length} bytes`);
  console.log('');
  console.log('Ship this in app_settings.drawer_pulse_hex for the client.');
} else {
  console.log('No drawer-kick signature (1B 70 ...) found. Either the capture missed');
  console.log('the window, or the POS app uses a non-standard command. Try BEL (0x07)');
  console.log('or DC4 (0x10 0x14 ...) decoders.');
}
