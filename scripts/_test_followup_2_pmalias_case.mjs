#!/usr/bin/env node
// Verify PM_ALIAS now case-insensitive
const PM_ALIAS = {
  cash: 'efectivo', efectivo: 'efectivo',
  card: 'tarjeta',  tarjeta: 'tarjeta',
  transfer: 'transferencia', transferencia: 'transferencia',
  check: 'cheque',  cheque: 'cheque',
  credit: 'credito', credito: 'credito',
  pedidos_ya: 'pedidos_ya', py: 'pedidos_ya', 'pedidos-ya': 'pedidos_ya',
}

function bucket(method) {
  const key = String(method || '').toLowerCase().trim()
  return PM_ALIAS[key] || key || 'efectivo'
}

const cases = [
  ['PEDIDOS_YA', 'pedidos_ya'],
  ['Pedidos_Ya', 'pedidos_ya'],
  ['CASH',       'efectivo'],
  ['Cash',       'efectivo'],
  ['EFECTIVO',   'efectivo'],
  ['  cash  ',   'efectivo'],
  ['PY',         'pedidos_ya'],
  ['Pedidos-Ya', 'pedidos_ya'],
  ['tarjeta',    'tarjeta'],
  ['Card',       'tarjeta'],
  ['credit',     'credito'],
  ['unknown',    'unknown'],   // unmapped keys stay as-is (lowercased)
  ['',           'efectivo'],
  [null,         'efectivo'],
]
let fail = 0
for (const [input, want] of cases) {
  const got = bucket(input)
  if (got !== want) { console.log(`✗ ${JSON.stringify(input)} → ${got}, expected ${want}`); fail++ }
  else console.log(`✓ ${JSON.stringify(input).padEnd(15)} → ${got}`)
}
process.exit(fail ? 1 : 0)
