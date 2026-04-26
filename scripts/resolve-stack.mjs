#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'
import { SourceMapConsumer } from 'source-map'
const stack = [
  { map: 'PaymentErrorBoundary-DBLpa_8e.js.map', line: 2, col: 17497, name: 're' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col: 57602, name: 'ar' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col: 78077, name: 'Ho' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col: 88332, name: 'll' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col:128871, name: 'pd' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col:128799, name: 'dd' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col:128641, name: 'cd' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col:124388, name: 'Jc' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col:140046, name: 'Vd' },
  { map: 'index-BYTkUyxC.js.map',                line: 2, col:138518, name: 'Rd' },
]
for (const f of stack) {
  const mapPath = path.join('dist/assets', f.map)
  if (!fs.existsSync(mapPath)) { console.log('(missing) ' + mapPath); continue }
  const raw = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
  await SourceMapConsumer.with(raw, null, c => {
    const pos = c.originalPositionFor({ line: f.line, column: f.col })
    console.log(f.name.padEnd(4) + ' → ' + (pos.source || '?') + ':' + pos.line + ':' + pos.column + '  (' + (pos.name || '-') + ')')
  })
}
