// Build the Terminal X Restaurant Sales Playbook as a real PDF using pdf-lib.
// Runs via: node docs/sales/build-playbook-pdf.mjs
// Output: docs/sales/guia-venta-restaurante-terminal-x.pdf
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('A:/Studio X HUB/Terminal X/docs/sales/guia-venta-restaurante-terminal-x.pdf');

// Letter, 0.75" margins. 72pt = 1in.
const W = 8.5 * 72;
const H = 11 * 72;
const M = 0.75 * 72;
const CONTENT_W = W - 2 * M;

const CRIMSON = rgb(0xb3 / 255, 0x00 / 255, 0x1e / 255);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

const doc = await PDFDocument.create();
const fontReg = await doc.embedFont(StandardFonts.Helvetica);
const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

// ---------- helpers ----------
function newPage(bg = WHITE) {
  const p = doc.addPage([W, H]);
  if (bg !== WHITE) p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: bg });
  return p;
}

function wrap(text, font, size, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Replace characters not in WinAnsi (used by Standard fonts) — strip non-latin1
function ascii(s) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[★⭐]/g, '*');
}

function drawText(page, text, x, y, opts = {}) {
  const size = opts.size || 11;
  const font = opts.font || fontReg;
  const color = opts.color || BLACK;
  page.drawText(ascii(text), { x, y, size, font, color });
}

function drawWrapped(page, text, x, y, maxW, opts = {}) {
  const size = opts.size || 11;
  const font = opts.font || fontReg;
  const lh = opts.lh || size * 1.4;
  const lines = wrap(ascii(text), font, size, maxW);
  let cursor = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: cursor, size, font, color: opts.color || BLACK });
    cursor -= lh;
  }
  return cursor; // returns next-line y
}

function drawHeader(page, sectionLabel, onCrimson = false) {
  const y = H - M + 18;
  // wordmark
  const txt = 'TERMINAL ';
  const txtW = fontBold.widthOfTextAtSize(txt, 14);
  drawText(page, txt, M, y, { font: fontBold, size: 14, color: onCrimson ? WHITE : BLACK });
  // crimson X
  const xColor = onCrimson ? BLACK : CRIMSON;
  page.drawRectangle({ x: M + txtW - 2, y: y - 3, width: 14, height: 17, color: xColor });
  drawText(page, 'X', M + txtW + 1, y, { font: fontBold, size: 14, color: onCrimson ? CRIMSON : WHITE });
  // section label right-aligned
  const lbl = ascii(sectionLabel);
  const lw = fontReg.widthOfTextAtSize(lbl, 9);
  drawText(page, lbl, W - M - lw, y + 2, { font: fontReg, size: 9, color: onCrimson ? WHITE : BLACK });
  // rule
  page.drawLine({
    start: { x: M, y: y - 8 },
    end: { x: W - M, y: y - 8 },
    thickness: 1.2,
    color: onCrimson ? WHITE : BLACK,
  });
  return y - 22;
}

function drawFooter(page, pageNum, onCrimson = false) {
  const y = M - 18;
  const c = onCrimson ? WHITE : BLACK;
  page.drawLine({
    start: { x: M, y: y + 10 },
    end: { x: W - M, y: y + 10 },
    thickness: 0.6,
    color: c,
  });
  drawText(page, 'Terminal X * Playbook Restaurantes v1.0', M, y, { size: 8, color: c });
  const right = `Pag. ${pageNum}`;
  const rw = fontReg.widthOfTextAtSize(right, 8);
  drawText(page, right, W - M - rw, y, { size: 8, color: c });
}

function box(page, x, y, w, h, opts = {}) {
  const border = opts.border || BLACK;
  const fill = opts.fill;
  if (fill) page.drawRectangle({ x, y, width: w, height: h, color: fill });
  page.drawRectangle({
    x, y, width: w, height: h,
    borderColor: border,
    borderWidth: opts.borderWidth || 2,
  });
}

function pill(page, label, x, y, opts = {}) {
  const size = opts.size || 9;
  const padX = 6, padY = 3;
  const w = fontBold.widthOfTextAtSize(label, size) + padX * 2;
  const h = size + padY * 2;
  page.drawRectangle({ x, y, width: w, height: h, color: opts.bg || CRIMSON });
  drawText(page, label, x + padX, y + padY + 1, { font: fontBold, size, color: opts.fg || WHITE });
  return { w, h };
}

function numberedStep(page, n, title, body, x, y, maxW) {
  // crimson square
  page.drawRectangle({ x, y: y - 22, width: 26, height: 26, color: CRIMSON });
  const ns = String(n);
  const nw = fontBold.widthOfTextAtSize(ns, 14);
  drawText(page, ns, x + 13 - nw / 2, y - 17, { font: fontBold, size: 14, color: WHITE });
  // title
  let cy = y - 4;
  cy = drawWrapped(page, title, x + 36, cy, maxW - 36, { font: fontBold, size: 11, lh: 14 });
  // body
  cy -= 2;
  cy = drawWrapped(page, body, x + 36, cy, maxW - 36, { size: 10, lh: 13 });
  return cy - 6;
}

// =============================================================
// PAGE 1 — COVER (crimson)
// =============================================================
{
  const page = newPage(CRIMSON);
  drawHeader(page, 'DGII Cert #42483', true);
  // pill
  pill(page, 'PLAYBOOK DE VENTAS', M, H - M - 50, { bg: BLACK, fg: WHITE });
  // Hero title
  let y = H - M - 90;
  drawText(page, 'Como vender', M, y, { font: fontBold, size: 48, color: WHITE });
  y -= 50;
  drawText(page, 'Terminal X a', M, y, { font: fontBold, size: 48, color: WHITE });
  y -= 50;
  drawText(page, 'Restaurantes', M, y, { font: fontBold, size: 48, color: WHITE });
  y -= 50;
  drawText(page, 'Dominicanos.', M, y, { font: fontBold, size: 48, color: WHITE });
  y -= 36;
  drawWrapped(page,
    'Guia completa para cerrar tu primer cliente restaurante - sin guion robotico, con datos reales del mercado RD.',
    M, y, CONTENT_W, { font: fontBold, size: 14, lh: 18, color: WHITE });
  // meta block at bottom
  let mY = M + 50;
  drawText(page, 'Fecha: 25 de abril, 2026  *  Version: v1.0', M, mY, { size: 10, color: WHITE });
  mY -= 14;
  drawText(page, 'Mercado: Republica Dominicana  *  Audiencia: Vendedores y referidos', M, mY, { size: 10, color: WHITE });
  mY -= 14;
  drawText(page, 'X Group Holdings SRL - Santo Domingo, DR', M, mY, { size: 10, color: WHITE });
}

// =============================================================
// PAGE 2 — POR QUE GANAMOS
// =============================================================
{
  const page = newPage();
  let y = drawHeader(page, '01 * Por que ganamos');
  drawText(page, '1. Por que Terminal X gana en restaurantes', M, y, { font: fontBold, size: 22, color: CRIMSON });
  y -= 24;
  drawWrapped(page, 'Cinco razones, una sola conclusion: ningun POS en RD ofrece esta combinacion al precio de Alegra.', M, y, CONTENT_W, { font: fontBold, size: 11, lh: 14 });
  y -= 28;

  const reasons = [
    ['1. Unico POS certificado directo por DGII (Cert #42483)',
     'Terminal X es Emisor Electronico autorizado directo. Cero PSFE intermediario, cero costo por comprobante emitido. Alegra y WilPOS dependen de un PSFE - pagas por cada e-CF que sale. Con nosotros, emites 50 o 5,000 al mes y el precio del plan no se mueve.', true],
    ['2. Modo offline 72 horas - apagon no para el cobro',
     'Esto es RD: la luz se va, el internet se cae, y tu restaurante no puede dejar de cobrar. Terminal X funciona offline 72 horas seguidas, sigue imprimiendo recibos, encolando e-CFs y sincroniza cuando vuelve la red. Alegra es 100% web - sin internet, sin cobro.', false],
    ['3. KDS profesional incluido - cocina y bar coordinados',
     'Pantalla fullscreen para cocina + bar con ruteo automatico por categoria. Lo que Square cobra aparte por USD$30/mes adicional, viene incluido en Pro PLUS.', false],
    ['4. Mesas, division de cuenta, propinas Ley 10% - completo',
     'Grid 5x2 con estados LIBRE / OCUPADA / A CUENTA (ambar). Division por item o por silla. Propina libre + 10% Ley reglamentaria con reparto al staff. Mas vendidos auto-rankeado por ventas de los ultimos 30 dias.', false],
    ['5. Certificado Viafirma incluido - ahorro RD$2,360/ano',
     'El certificado digital que necesitas para emitir e-CF (Viafirma .p12) cuesta RD$2,360/ano por separado. Aqui viene incluido en el plan. STARSISA cobra el setup. Alegra te lo factura aparte. Nosotros lo regalamos.', false],
  ];

  for (const [title, body, red] of reasons) {
    const lines = wrap(ascii(body), fontReg, 10, CONTENT_W - 20);
    const boxH = 22 + 14 + lines.length * 13 + 12;
    box(page, M, y - boxH, CONTENT_W, boxH, { border: red ? CRIMSON : BLACK });
    let by = y - 18;
    drawText(page, title, M + 10, by, { font: fontBold, size: 12, color: red ? CRIMSON : BLACK });
    by -= 18;
    for (const ln of lines) {
      drawText(page, ln, M + 10, by, { size: 10, lh: 13 });
      by -= 13;
    }
    y -= boxH + 8;
  }

  drawFooter(page, 2);
}

// =============================================================
// PAGE 3 — CLIENTE IDEAL
// =============================================================
{
  const page = newPage();
  let y = drawHeader(page, '02 * Cliente ideal');
  drawText(page, '2. El cliente ideal', M, y, { font: fontBold, size: 22, color: CRIMSON });
  y -= 24;
  drawWrapped(page, 'No vas a venderle a todos. Concentrate en este perfil y cerraras mas rapido.', M, y, CONTENT_W, { font: fontBold, size: 11, lh: 14 });
  y -= 26;

  // two-column boxes
  const colW = (CONTENT_W - 16) / 2;
  const items1 = [
    'Tamano: 8 a 30 mesas',
    'Equipo: 2 a 10 empleados (cajero, meseros, cocina)',
    'Facturacion: RD$200,000 a RD$2,000,000 al mes',
    'Sistema actual: Excel + libreta + WhatsApp, o un POS viejo (StarSISA, WilPOS, "el que dejo el primo")',
    'Estado mental: nervioso por Ley 32-23, sabe que el 15 de mayo de 2026 viene encima',
    'Cobra: efectivo + tarjeta + transferencia + a veces fia',
  ];
  const items2 = [
    '"Ya me llego la carta de DGII"',
    '"Mi contador me dijo que tengo que facturar electronico"',
    '"Estoy buscando algo mas serio que WilPOS"',
    '"El sistema actual no me da reportes claros"',
    '"Mis meseros pelean con la cuenta"',
    '"Anoche se fue la luz y no pude cobrar"',
  ];

  function bulletBox(x, w, title, items, red) {
    const wrapped = items.map(t => wrap('* ' + ascii(t), fontReg, 10, w - 20));
    const totalLines = wrapped.reduce((a, b) => a + b.length, 0);
    const h = 30 + totalLines * 13 + 12;
    box(page, x, y - h, w, h, { border: red ? CRIMSON : BLACK, fill: red ? CRIMSON : undefined });
    drawText(page, title, x + 10, y - 18, { font: fontBold, size: 12, color: red ? WHITE : CRIMSON });
    let by = y - 36;
    for (const linesArr of wrapped) {
      for (const ln of linesArr) {
        drawText(page, ln, x + 10, by, { size: 10, color: red ? WHITE : BLACK });
        by -= 13;
      }
    }
    return h;
  }

  const h1 = bulletBox(M, colW, 'Perfil del prospecto', items1, false);
  const h2 = bulletBox(M + colW + 16, colW, 'Senales de compra', items2, true);
  y -= Math.max(h1, h2) + 16;

  drawText(page, 'Donde encontrarlo', M, y, { font: fontBold, size: 14, color: BLACK });
  y -= 18;

  const items3 = [
    'Grupos de WhatsApp de duenos de restaurantes RD',
    'Instagram con hashtags #RestaurantesRD #SantoDomingoEats #RDFoodies',
    'Grupos de Facebook "Emprendedores Gastronomicos RD"',
    'LinkedIn - directos a managers de restaurantes mid-tier',
  ];
  const items4 = [
    'Eventos gastronomicos: Santo Domingo, Punta Cana, Santiago',
    'Ferias de proveedores HORECA',
    'Referidos del primer cliente (1 mes gratis por cada referido cerrado)',
    'Caminata directa: Zona Colonial, Piantini, Naco, Bavaro',
  ];
  const h3 = bulletBox(M, colW, 'Online', items3, false);
  const h4 = bulletBox(M + colW + 16, colW, 'Offline', items4, false);
  y -= Math.max(h3, h4);

  drawFooter(page, 3);
}

// =============================================================
// PAGE 4 — OBJECIONES 1
// =============================================================
function drawQA(page, q, a, x, y, maxW) {
  // crimson left bar
  const aLines = wrap(ascii(a), fontReg, 10, maxW - 16);
  const qLines = wrap(ascii(q), fontBold, 11, maxW - 16);
  const h = 8 + qLines.length * 14 + 4 + aLines.length * 13 + 8;
  page.drawRectangle({ x, y: y - h, width: 4, height: h, color: CRIMSON });
  let cy = y - 16;
  for (const ln of qLines) {
    drawText(page, ln, x + 12, cy, { font: fontBold, size: 11 });
    cy -= 14;
  }
  cy -= 2;
  for (const ln of aLines) {
    drawText(page, ln, x + 12, cy, { size: 10 });
    cy -= 13;
  }
  return h + 8;
}

{
  const page = newPage();
  let y = drawHeader(page, '03 * Objeciones * 1 de 2');
  drawText(page, '3. Las 5 objeciones mas comunes', M, y, { font: fontBold, size: 22, color: CRIMSON });
  y -= 22;
  drawWrapped(page, 'Memoriza estas respuestas. Si las dices con seguridad, el 80% de las objeciones mueren ahi.', M, y, CONTENT_W, { font: fontBold, size: 11, lh: 14 });
  y -= 24;

  const qas = [
    ['"Alegra es mas barato."',
     'Alegra arranca en RD$1,800, si. Pero Alegra NO esta certificada directa con DGII - usa un PSFE intermediario, y el PSFE te cobra por cada e-CF que emites. Si haces 200 comprobantes al mes a RD$8 cada uno, son RD$1,600 extra mensuales - mas el certificado Viafirma que pagas aparte (RD$2,360/ano). Terminal X es plano: RD$4,490, sin comprobantes pagados, certificado incluido. A 200 comprobantes/mes ya somos mas baratos. A 500 te ahorramos RD$30,000 al ano.'],
    ['"Ya tengo un sistema, no quiero cambiar."',
     'Te entiendo, cambiar de POS es un dolor. Por eso ofrecemos configuracion remota incluida - tu no tocas nada. Yo importo tu menu, tus mesas, tus empleados. En 48 horas estas operando. Y si en 7 dias no te convence, no pagas. Una pregunta: tu sistema actual esta listo para el 15 de mayo de 2026?'],
    ['"Mi cocina es chica, no necesito KDS."',
     'Perfecto, no lo uses. Pero tenlo. El dia que abres una segunda sucursal, o agregas barra, o tu cocinero nuevo no entiende la letra del mesero - ahi lo prendes. No pagas extra por tenerlo. Alegra te cobraria RD$1,500 mas al mes solo por el modulo de cocina. Aqui ya viene.'],
    ['"Y si se me va la luz?"',
     'Esa es una de las razones por la que construimos Terminal X aqui, en RD, no en Colombia ni en Mexico. Funcionamos 72 horas offline completas. Sigues cobrando, sigues imprimiendo recibos, los e-CF se encolan y se envian solos cuando vuelve el internet. La cola se procesa con el indicador de envio diferido que la propia DGII permite por la regla de las 72 horas. Alegra se cae con la luz. Nosotros no.'],
  ];
  for (const [q, a] of qas) {
    y -= drawQA(page, q, a, M, y, CONTENT_W);
  }
  drawFooter(page, 4);
}

// =============================================================
// PAGE 5 — OBJECIONES 2
// =============================================================
{
  const page = newPage();
  let y = drawHeader(page, '03 * Objeciones * 2 de 2');
  drawText(page, '3. Objeciones (continuacion)', M, y, { font: fontBold, size: 22, color: CRIMSON });
  y -= 22;
  y -= drawQA(page,
    '"Que pasa con DGII despues del 15 de mayo?"',
    'A partir del 15 de mayo de 2026, el cumplimiento de Ley 32-23 se vuelve obligatorio en escala. Si tu facturacion supera el umbral y no estas emitiendo electronicamente, son multas y bloqueos en la Oficina Virtual. Terminal X tiene Certificado #42483 directo con DGII desde produccion real - no es promesa, ya estamos emitiendo e-CF aceptados (E31, E32, E33, E34, hasta E47). El dia que la ley aprieta, tu no haces nada - sigues cobrando. Tus competidores que no se prepararon van a perder ventas mientras corren a contratar un PSFE.',
    M, y, CONTENT_W);

  // bonus table
  const tableData = [
    ['Objecion', 'Respuesta de bolsillo'],
    ['"No tengo internet bueno"', 'Offline 72h. Solo necesitas internet 1 vez cada 3 dias.'],
    ['"Mis meseros son medio analfabetos digitales"', 'Busqueda por nombre + grid visual. Si sabe WhatsApp, sabe Terminal X.'],
    ['"Y si quiebro?"', '7 dias gratis sin tarjeta. Cancelas cuando quieras, sin penalidad.'],
    ['"Y mi data?"', 'Es tuya. Exportas en CSV cuando quieras. Sin candado.'],
    ['"El facturador gratuito de DGII me sirve"', 'Es un formulario web. Sin mesas, sin cocina, sin offline, sin reportes, sin propinas.'],
    ['"Necesito hablarlo con mi contador"', 'Invitalo a la demo. Le encanta el reporte ITBIS-net y los E31 corporativos.'],
  ];
  const colA = CONTENT_W * 0.4;
  const colB = CONTENT_W - colA;
  drawText(page, 'Bonus: respuestas rapidas a objeciones menores', M, y, { font: fontBold, size: 13, color: CRIMSON });
  y -= 16;

  // measure rows
  const rowHeights = tableData.map(([a, b], i) => {
    const aL = wrap(ascii(a), i === 0 ? fontBold : fontReg, 9, colA - 12);
    const bL = wrap(ascii(b), i === 0 ? fontBold : fontReg, 9, colB - 12);
    return Math.max(aL.length, bL.length) * 12 + 10;
  });
  let ry = y;
  for (let i = 0; i < tableData.length; i++) {
    const [a, b] = tableData[i];
    const rh = rowHeights[i];
    const isHeader = i === 0;
    if (isHeader) {
      page.drawRectangle({ x: M, y: ry - rh, width: CONTENT_W, height: rh, color: BLACK });
    }
    // borders
    page.drawRectangle({ x: M, y: ry - rh, width: colA, height: rh, borderColor: BLACK, borderWidth: 0.8 });
    page.drawRectangle({ x: M + colA, y: ry - rh, width: colB, height: rh, borderColor: BLACK, borderWidth: 0.8 });
    // text
    const f = isHeader ? fontBold : fontReg;
    const fc = isHeader ? WHITE : BLACK;
    const aL = wrap(ascii(a), f, 9, colA - 12);
    const bL = wrap(ascii(b), f, 9, colB - 12);
    let ay = ry - 14;
    for (const ln of aL) { drawText(page, ln, M + 6, ay, { font: f, size: 9, color: fc }); ay -= 12; }
    let by2 = ry - 14;
    for (const ln of bL) { drawText(page, ln, M + colA + 6, by2, { font: f, size: 9, color: fc }); by2 -= 12; }
    ry -= rh;
  }

  drawFooter(page, 5);
}

// =============================================================
// PAGE 6 — DEMO 7 MIN
// =============================================================
{
  const page = newPage();
  let y = drawHeader(page, '04 * Demo en 7 minutos');
  drawText(page, '4. La demo en 7 minutos', M, y, { font: fontBold, size: 22, color: CRIMSON });
  y -= 22;
  drawWrapped(page, 'Esta es la demo que cierra. Ni mas ni menos. No improvises - sigue el script.', M, y, CONTENT_W, { font: fontBold, size: 11, lh: 14 });
  y -= 22;

  const steps = [
    ['Abre el demo en vivo (0:00-0:30)',
     'Ve a terminalxpos.com/demo/restaurante. Sin login, sin trampa, datos reales pre-cargados. Mientras carga, di: "Esto que vas a ver es el sistema completo, no un video, no una maqueta - datos reales corriendo ahora mismo."'],
    ['Muestra el grid de mesas (0:30-1:30)',
     '"Aqui estan tus 10 mesas. Verde = libre, rojo = ocupada, ambar = pidiendo cuenta. Tu cajero ve el restaurante completo de un vistazo." Senala una mesa LIBRE y otra OCUPADA. Di el nombre del restaurante del prospecto si lo sabes.'],
    ['Click en una mesa, agrega 3 items (1:30-3:00)',
     'Click "Mesa 4". Tipea "moro" en la busqueda - aparece "Moro de habichuelas" al instante. Agrega. Tipea "cerve" - aparece "Cerveza Presidente". Agrega 2. "Tu mesero busca por nombre, no se aprende codigos."'],
    ['Muestra Mas vendidos (3:00-3:45)',
     'Click en el tab "* Mas vendidos". "Esto se auto-genera con los ultimos 30 dias de venta. El mesero nuevo no tiene que aprenderse el menu - los mas pedidos estan en la primera pantalla."'],
    ['Demuestra dividir cuenta (3:45-4:45)',
     'Click "Dividir cuenta". Asigna items a sillas. "Aca viene el dolor real: 4 amigos, cada uno paga lo suyo. Tu mesero no agarra calculadora - el sistema lo divide."'],
    ['Click "Pedir cuenta" - mesa flips ambar (4:45-5:30)',
     '"El cliente pide la cuenta - la mesa ahora es ambar. La cocina sabe que ya no entra nada mas, el cajero sabe que viene el cobro. Cero confusion."'],
    ['Cobrar - e-CF - QR DGII - impresion (5:30-7:00)',
     'Click "Cobrar". Pago mixto: RD$1,500 efectivo + RD$2,000 tarjeta. Click "Confirmar". Espera 2 segundos y muestra el e-CF generado con QR de DGII real. "Este QR - DGII lo registro en este momento. No es una imagen, es un comprobante fiscal aceptado."'],
  ];
  for (let i = 0; i < steps.length; i++) {
    y = numberedStep(page, i + 1, steps[i][0], steps[i][1], M, y, CONTENT_W);
  }
  drawFooter(page, 6);
}

// =============================================================
// PAGE 7 — CIERRE DEMO (crimson)
// =============================================================
{
  const page = newPage(CRIMSON);
  let y = drawHeader(page, '04 * Cierre de demo', true);
  drawText(page, 'El cierre despues de la demo', M, y, { font: fontBold, size: 24, color: WHITE });
  y -= 24;
  drawWrapped(page, 'Termina la demo. Callate. Deja que el cliente hable primero.', M, y, CONTENT_W, { font: fontBold, size: 12, lh: 15, color: WHITE });
  y -= 30;

  // White box with closing line
  const closingTitle = 'El cierre exacto, palabra por palabra:';
  const closingBody = '"Bueno, eso es Terminal X en 7 minutos. Yo te activo la cuenta hoy mismo, configuro tu menu esta semana, y el lunes estas cobrando con e-CF. Tienes 7 dias gratis para probarlo con tus mesas reales - sin tarjeta, sin compromiso. Empezamos?"';
  const lines = wrap(ascii(closingBody), fontReg, 11, CONTENT_W - 20);
  const h = 18 + 18 + lines.length * 14 + 14;
  box(page, M, y - h, CONTENT_W, h, { fill: WHITE, border: BLACK });
  drawText(page, closingTitle, M + 10, y - 18, { font: fontBold, size: 13, color: BLACK });
  let cy = y - 38;
  for (const ln of lines) { drawText(page, ln, M + 10, cy, { size: 11 }); cy -= 14; }
  y -= h + 18;

  // Two follow-up scenarios
  function whiteSection(title, body) {
    drawText(page, title, M, y, { font: fontBold, size: 14, color: WHITE });
    y -= 16;
    const bL = wrap(ascii(body), fontReg, 11, CONTENT_W);
    for (const ln of bL) { drawText(page, ln, M, y, { size: 11, color: WHITE }); y -= 14; }
    y -= 12;
  }
  whiteSection('Si dice "dejame pensarlo":',
    '"Claro. Una cosa: el 15 de mayo se vence el plazo de DGII. Te dejo activado el trial de 7 dias gratis ahora - si no te gusta, no pagas, no pasa nada. Pero al menos quedas listo. Te parece?"');
  whiteSection('Si dice "el precio esta alto":',
    '"Te entiendo. Cuanto facturas al mes? RD$X. Pro PLUS te cuesta el 0.7% de eso. Tu PSFE actual con Alegra te cuesta mas solo en comprobantes. Vamos al anual con 15% OFF - bajas a RD$3,817/mes y te ahorras RD$8,000 al ano."');

  drawFooter(page, 7, true);
}

// =============================================================
// PAGE 8 — PLAN + COMPARATIVA
// =============================================================
{
  const page = newPage();
  let y = drawHeader(page, '05 * Plan + comparativa');
  drawText(page, '5. El plan + que incluye', M, y, { font: fontBold, size: 22, color: CRIMSON });
  y -= 22;
  drawWrapped(page,
    'Pro PLUS - RD$4,490/mes. Anual con 15% OFF baja a RD$3,817/mes (ahorras ~RD$8,000/ano).',
    M, y, CONTENT_W, { font: fontBold, size: 11, lh: 14 });
  y -= 20;

  const headers = ['Funcion', 'Terminal X Pro PLUS', 'Alegra', 'WilPOS'];
  const rows = [
    ['Certificado DGII directo (sin PSFE)', 'SI', 'NO', 'NO'],
    ['Costo plano por e-CF emitido', 'SI', 'PAGA c/u', 'PAGA c/u'],
    ['Certificado Viafirma incluido', 'SI', 'NO', 'NO'],
    ['Modo offline 72 horas', 'SI', 'NO', 'Parcial'],
    ['Mesas grid + estados (LIBRE/OCUPADA/A CUENTA)', 'SI', 'NO', 'Basico'],
    ['KDS profesional fullscreen', 'SI', 'NO', 'NO'],
    ['MenuBuilder modificadores + multi-printer', 'SI', 'Limitado', 'Limitado'],
    ['Mas vendidos auto-rankeado (30 dias)', 'SI', 'NO', 'NO'],
    ['Division de cuenta por item o por silla', 'SI', 'NO', 'Solo item'],
    ['Propina Ley 10% + libre + reparto', 'SI', 'Manual', 'Manual'],
    ['Comisiones por mesero / cajero', 'SI', 'NO', 'NO'],
    ['Reportes por turno (almuerzo vs cena)', 'SI', 'NO', 'NO'],
    ['Pago mixto (efectivo+tarjeta+transf+credito)', 'SI', 'SI', 'SI'],
    ['e-CF E31 (factura credito fiscal corporativo)', 'SI', 'Via PSFE', 'NO'],
    ['WhatsApp envio de recibos (Pro MAX)', 'SI', 'NO', 'NO'],
    ['Conteo fisico inventario + reporte varianza', 'SI', 'Basico', 'Basico'],
    ['Modo hibrido (restaurante + tienda)', 'SI', 'NO', 'NO'],
    ['Modo Kiosk con auto-lock', 'SI', 'NO', 'NO'],
  ];
  const totalRow = ['Precio mensual', 'RD$4,490', 'RD$1,800-3,500 + por e-CF', 'RD$2,000-4,000'];

  const colWidths = [CONTENT_W * 0.46, CONTENT_W * 0.18, CONTENT_W * 0.18, CONTENT_W * 0.18];
  const rowH = 18;
  const headerH = 22;

  // header
  page.drawRectangle({ x: M, y: y - headerH, width: CONTENT_W, height: headerH, color: BLACK });
  let cx = M;
  for (let i = 0; i < headers.length; i++) {
    drawText(page, headers[i], cx + 4, y - 14, { font: fontBold, size: 9, color: WHITE });
    cx += colWidths[i];
  }
  y -= headerH;

  for (const r of rows) {
    cx = M;
    for (let i = 0; i < r.length; i++) {
      page.drawRectangle({ x: cx, y: y - rowH, width: colWidths[i], height: rowH, borderColor: BLACK, borderWidth: 0.6 });
      const isCheck = i > 0 && r[i] === 'SI';
      const color = isCheck ? CRIMSON : BLACK;
      const f = isCheck ? fontBold : fontReg;
      const text = r[i];
      drawText(page, text, cx + 4, y - 12, { size: 9, font: f, color });
      cx += colWidths[i];
    }
    y -= rowH;
  }

  // total row (black)
  const totalH = 24;
  page.drawRectangle({ x: M, y: y - totalH, width: CONTENT_W, height: totalH, color: BLACK });
  cx = M;
  for (let i = 0; i < totalRow.length; i++) {
    drawText(page, totalRow[i], cx + 4, y - 16, { font: fontBold, size: 10, color: WHITE });
    cx += colWidths[i];
  }
  y -= totalH + 8;

  drawWrapped(page,
    'Pro PLUS incluye 5 usuarios. Pro MAX (RD$6,990/mes) agrega WhatsApp recibos, dashboard remoto, ticket-locks multi-sucursal, modo offline PWA web, daily digest. Trial 7 dias gratis Pro MAX para todos los signups.',
    M, y, CONTENT_W, { font: fontItalic, size: 9, lh: 12 });

  drawFooter(page, 8);
}

// =============================================================
// PAGE 9 — ACTIVACION 3 PASOS
// =============================================================
{
  const page = newPage();
  let y = drawHeader(page, '06 * Activacion en 3 pasos');
  drawText(page, '6. Cierre + activacion en 3 pasos', M, y, { font: fontBold, size: 22, color: CRIMSON });
  y -= 22;
  drawWrapped(page,
    'No es self-serve. Pro PLUS incluye configuracion remota - el cliente no tiene que hacer nada tecnico.',
    M, y, CONTENT_W, { font: fontBold, size: 11, lh: 14 });
  y -= 22;

  y = numberedStep(page, 1,
    'Cliente firma el compromiso por WhatsApp',
    'Mandale al WhatsApp +1 (809) 828-2971 el siguiente mensaje (plantilla):  "Hola Mike, soy [nombre], dueno de [nombre del restaurante] en [ubicacion]. Quiero arrancar Terminal X Pro PLUS. Mi RNC es [RNC]. Me puedes mandar el link de activacion y la lista de lo que necesitas para configurar mi menu?"',
    M, y, CONTENT_W);
  y = numberedStep(page, 2,
    'Mike configura la cuenta de forma remota',
    'Pro PLUS incluye configuracion remota. Mike crea el negocio, importa el menu (CSV o foto del menu actual), configura mesas, agrega empleados, instala el certificado Viafirma, conecta DGII. Todo en 24-48 horas. El cliente solo manda: foto del menu, lista de mesas, lista de empleados con cedula, y el .p12 de Viafirma si ya lo tiene (si no, nosotros lo emitimos).',
    M, y, CONTENT_W);
  y = numberedStep(page, 3,
    'Cliente recibe credenciales + capacitacion de 30 minutos',
    'Le mandas: usuario, PIN, license key TXL-XXXX, y agendan video llamada de 30 min para entrenar al cajero principal. La capacitacion cubre: abrir turno, abrir mesa, agregar items, dividir cuenta, cobrar, cerrar turno, ver reporte. El resto se aprende solo en 2 dias de operacion.',
    M, y, CONTENT_W);

  // Garantia box
  y -= 8;
  const gBody = '7 dias gratis Pro MAX para que pruebe en produccion real. Sin tarjeta, sin compromiso, cancelable en cualquier momento. Si al dia 7 no le funciona, cero cobro y le exportamos su data en CSV gratis.';
  const gLines = wrap(ascii(gBody), fontReg, 11, CONTENT_W - 24);
  const gH = 22 + 18 + gLines.length * 14 + 14;
  box(page, M, y - gH, CONTENT_W, gH, { border: CRIMSON, borderWidth: 2 });
  drawText(page, 'Garantia de cierre', M + 12, y - 20, { font: fontBold, size: 14, color: CRIMSON });
  let gy = y - 40;
  for (const ln of gLines) { drawText(page, ln, M + 12, gy, { size: 11 }); gy -= 14; }

  drawFooter(page, 9);
}

// =============================================================
// PAGE 10 — CASOS DE USO
// =============================================================
{
  const page = newPage();
  let y = drawHeader(page, '07 * Casos ganadores');
  drawText(page, '7. Tres casos de uso ganadores', M, y, { font: fontBold, size: 22, color: CRIMSON });
  y -= 22;
  drawWrapped(page,
    'Tres escenarios reales del mercado RD con ROI calculado. Memorizalos.',
    M, y, CONTENT_W, { font: fontBold, size: 11, lh: 14 });
  y -= 22;

  function caseBox(title, paragraphs) {
    const allLines = [];
    for (const p of paragraphs) {
      const lns = wrap(ascii(p), fontReg, 10, CONTENT_W - 20);
      allLines.push(...lns, '');
    }
    if (allLines.length && allLines[allLines.length - 1] === '') allLines.pop();
    const h = 20 + 16 + allLines.length * 13 + 14;
    box(page, M, y - h, CONTENT_W, h, { border: BLACK, borderWidth: 2 });
    drawText(page, title, M + 10, y - 18, { font: fontBold, size: 12, color: CRIMSON });
    let cy = y - 36;
    for (const ln of allLines) {
      drawText(page, ln, M + 10, cy, { size: 10 });
      cy -= 13;
    }
    y -= h + 8;
  }

  caseBox('Caso A - Restaurante familiar, 12 mesas, RD$600,000/mes', [
    'Situacion: Comedor de barrio en Naco, dueno + esposa + 4 empleados. Hoy usa Alegra basico + libreta para mesas + WhatsApp para pedidos.',
    'Volumen e-CF estimado: ~250 comprobantes/mes. Con Alegra paga RD$2,500 plan + RD$2,000 PSFE = RD$4,500 efectivo. Sin mesas reales, sin KDS, sin propinas Ley 10%.',
    'Con Terminal X Pro PLUS: RD$4,490 plano. Mesas + KDS + comisiones + propinas Ley + e-CF directo + Viafirma incluido. ROI: paridad de costo + 4 features que Alegra no tiene. Plan anual 15% OFF baja a RD$3,817 - ahorra RD$8,000/ano.',
  ]);

  caseBox('Caso B - Bar de fin de semana, 6 mesas + delivery, RD$400,000/mes', [
    'Situacion: Bar en Bavaro abre jueves a domingo. Apagones frecuentes en temporada alta. Hoy cobra todo en efectivo + Yappy, sin sistema, libreta para credito.',
    'Dolor real: sabado pasado se fue la luz 4 horas en pleno servicio - perdio ~RD$30,000 en ventas porque no podia facturar.',
    'Con Terminal X Pro PLUS: Modo offline 72 horas - la luz se va, la operacion NO se cae. Recibos siguen imprimiendo (UPS RD$3,000 alcanza), e-CF se encolan, todo se sincroniza solo cuando vuelve. ROI directo: 1 apagon evitado al mes ya pago el plan completo del ano.',
  ]);

  caseBox('Caso C - Cafeteria con retail (hybrid), 5 mesas + venta de granos', [
    'Situacion: Cafeteria en la Zona Colonial - 5 mesas para cafe + venta al detal de bolsas de cafe, postres empaquetados, tazas. Hoy usa dos sistemas: libreta para mesas + Excel para retail.',
    'Con Terminal X Pro PLUS modo hybrid: una sola instalacion cubre mesas + retail. Cajero alterna entre Restaurant POS y Retail POS desde el mismo dispositivo. Inventario unificado: la bolsa que vendes al detal y la que usas para servir el espresso descuentan del mismo stock. ROI: 1 sistema en vez de 2, 0 doble entrada de datos, 1 reporte fiscal mensual.',
  ]);

  drawFooter(page, 10);
}

// =============================================================
// PAGE 11 — CIERRE / CONTACTO (crimson)
// =============================================================
{
  const page = newPage(CRIMSON);
  let y = drawHeader(page, 'Cierre * Contacto', true);
  drawText(page, 'Listo. Ahora a vender.', M, y - 8, { font: fontBold, size: 32, color: WHITE });
  y -= 44;
  drawWrapped(page,
    'Tienes el producto, los datos, las objeciones, la demo, el precio y los casos. Lo unico que falta es el WhatsApp del proximo cliente.',
    M, y, CONTENT_W, { font: fontBold, size: 13, lh: 17, color: WHITE });
  y -= 60;

  function infoBox(title, lines, fillWhite) {
    const wL = lines.flatMap(l => wrap(ascii(l), fontReg, 11, CONTENT_W - 24));
    const h = 22 + 18 + wL.length * 15 + 14;
    box(page, M, y - h, CONTENT_W, h, { fill: fillWhite ? WHITE : BLACK, border: fillWhite ? BLACK : WHITE });
    drawText(page, title, M + 12, y - 20, { font: fontBold, size: 14, color: fillWhite ? BLACK : WHITE });
    let cy = y - 40;
    for (const ln of wL) {
      drawText(page, ln, M + 12, cy, { size: 11, color: fillWhite ? BLACK : WHITE });
      cy -= 15;
    }
    y -= h + 12;
  }

  infoBox('Datos de contacto', [
    'WhatsApp directo (cierre y activacion): +1 (809) 828-2971',
    'Sitio web: terminalxpos.com',
    'Demo en vivo (sin login): terminalxpos.com/demo/restaurante',
    'Empresa: X Group Holdings SRL - Santo Domingo, RD',
    'Certificacion DGII: Cert #42483 - Emisor Electronico directo',
  ], true);

  infoBox('Referencia operacional verificable', [
    'Studio X Carwash (Santo Domingo) opera Terminal X en produccion real desde v1.0 hasta hoy v2.14. Volumen diario: 80-120 tickets. Uptime offline probado en apagones reales de hasta 8 horas. No es testimonio inventado - es el laboratorio donde cada release pasa antes de llegar al cliente.',
  ], false);

  infoBox('Garantia final', [
    '7 dias gratis Pro MAX, sin tarjeta de credito, cancelable en cualquier momento. Si al dia 7 no convierte, cero cobro y exportacion de data sin costo.',
  ], true);

  drawFooter(page, 11, true);
}

// =============================================================
// SAVE
// =============================================================
const bytes = await doc.save();
fs.writeFileSync(OUT, bytes);
console.log('PDF written to:', OUT);
console.log('Size:', bytes.length, 'bytes (', (bytes.length / 1024).toFixed(1), 'KB )');
console.log('Pages:', doc.getPageCount());
