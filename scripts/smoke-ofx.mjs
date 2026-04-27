// smoke-ofx.mjs — quick sanity check for the OFX parser.
// Run: `node scripts/smoke-ofx.mjs`
import { parseOFX } from '../packages/services/bankParsers/ofxParser.js'
import { parseStatement } from '../packages/services/bankParsers/index.js'

const ofx2 = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
 <BANKMSGSRSV1><STMTTRNRS><STMTRS>
  <CURDEF>DOP</CURDEF>
  <BANKACCTFROM><BANKID>SCOTIA-DR</BANKID><ACCTID>****1234</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
  <BANKTRANLIST>
    <DTSTART>20260401000000</DTSTART><DTEND>20260430000000</DTEND>
    <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260403000000</DTPOSTED><TRNAMT>-1500.50</TRNAMT><FITID>TX1</FITID><NAME>EDESUR</NAME><MEMO>Factura abril</MEMO></STMTTRN>
    <STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260405000000</DTPOSTED><TRNAMT>25000.00</TRNAMT><FITID>TX2</FITID><NAME>DEPOSITO CLIENTE</NAME></STMTTRN>
    <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260410000000</DTPOSTED><TRNAMT>-450.00</TRNAMT><FITID>TX3</FITID><NAME>CLARO</NAME></STMTTRN>
  </BANKTRANLIST>
  <LEDGERBAL><BALAMT>23049.50</BALAMT><DTASOF>20260430000000</DTASOF></LEDGERBAL>
 </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`

const ofx1 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>DOP
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260415<TRNAMT>-200.00<FITID>P1<NAME>SUPERMERCADO
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260420<TRNAMT>5000.00<FITID>P2<NAME>NOMINA
</BANKTRANLIST>
<LEDGERBAL><BALAMT>4800.00<DTASOF>20260430
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`

let pass = 0, fail = 0
function expect(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else      { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('OFX 2.x XML')
const r2 = parseOFX(ofx2)
expect('lines length 3', r2.lines.length === 3, `got ${r2.lines.length}`)
expect('errors empty',    r2.errors.length === 0)
expect('first row debit 1500.50', r2.lines[0].debit === 1500.5)
expect('second row credit 25000', r2.lines[1].credit === 25000)
expect('first row date 2026-04-03', r2.lines[0].fecha === '2026-04-03')
expect('first row memo "Factura abril"', r2.lines[0].descripcion === 'Factura abril')
expect('last row balance 23049.50', r2.lines[2].balance === 23049.5)

console.log('OFX 1.x SGML')
const r1 = parseOFX(ofx1)
expect('lines length 2', r1.lines.length === 2, `got ${r1.lines.length}`)
expect('SGML row1 debit 200',  r1.lines[0].debit === 200)
expect('SGML row2 credit 5000', r1.lines[1].credit === 5000)
expect('SGML last row balance 4800', r1.lines[1].balance === 4800)

console.log('Registry')
const reg2 = parseStatement({ content: ofx2, banco: 'scotiabank' })
expect('scotiabank ok',       reg2.ok === true)
expect('scotiabank stamp',    reg2.banco === 'scotiabank')
const regBhd = parseStatement({ content: ofx2, banco: 'bhd_leon' })
expect('bhd_leon stub blocks', regBhd.ok === false)
expect('bhd_leon error msg',   /Esperando muestra/.test(regBhd.errors[0] || ''))

console.log(`\n${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
