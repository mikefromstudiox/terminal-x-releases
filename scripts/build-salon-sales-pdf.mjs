import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CRIMSON = rgb(0.702, 0, 0.118); // #b3001e
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GREY = rgb(0.35, 0.35, 0.35);
const LIGHT = rgb(0.92, 0.92, 0.92);

const PAGE_W = 612;
const PAGE_H = 792;
const M_X = 54;
const M_TOP = 54;
const M_BOT = 54;

const doc = await PDFDocument.create();
const fontReg = await doc.embedFont(StandardFonts.Helvetica);
const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
const fontItal = await doc.embedFont(StandardFonts.HelveticaOblique);

// Sanitize for WinAnsi (pdf-lib default font encoding can't render emoji / certain chars).
const sanitize = (s) => s
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/—/g, '-')
  .replace(/–/g, '-')
  .replace(/…/g, '...')
  .replace(/ /g, ' ');

let page = doc.addPage([PAGE_W, PAGE_H]);
let y = PAGE_H - M_TOP;

const newPage = () => {
  page = doc.addPage([PAGE_W, PAGE_H]);
  y = PAGE_H - M_TOP;
  drawHeader();
};

const drawHeader = () => {
  page.drawRectangle({ x: 0, y: PAGE_H - 24, width: PAGE_W, height: 24, color: BLACK });
  page.drawText(sanitize('TERMINAL X  -  Salones y Barberias'), {
    x: M_X, y: PAGE_H - 17, size: 10, font: fontBold, color: WHITE,
  });
  page.drawText(sanitize('Guia de Ventas v2.16.1'), {
    x: PAGE_W - M_X - 130, y: PAGE_H - 17, size: 9, font: fontReg, color: WHITE,
  });
  y = PAGE_H - 24 - 28;
};

const drawFooter = (n, total) => {
  page.drawLine({ start: { x: M_X, y: 40 }, end: { x: PAGE_W - M_X, y: 40 }, thickness: 0.5, color: GREY });
  page.drawText(sanitize('Studio X SRL  |  terminalxpos.com  |  +1 809 828 2971'), {
    x: M_X, y: 26, size: 8, font: fontReg, color: GREY,
  });
  page.drawText(`${n} / ${total}`, {
    x: PAGE_W - M_X - 30, y: 26, size: 8, font: fontReg, color: GREY,
  });
};

const wrap = (text, font, size, maxW) => {
  const words = sanitize(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(test, size) <= maxW) cur = test;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
};

const ensureSpace = (h) => {
  if (y - h < M_BOT + 30) newPage();
};

const h1 = (text) => {
  ensureSpace(48);
  page.drawRectangle({ x: M_X - 8, y: y - 4, width: 4, height: 28, color: CRIMSON });
  page.drawText(sanitize(text), { x: M_X + 4, y: y + 6, size: 22, font: fontBold, color: BLACK });
  y -= 36;
};

const h2 = (text) => {
  ensureSpace(28);
  page.drawText(sanitize(text), { x: M_X, y, size: 14, font: fontBold, color: CRIMSON });
  y -= 20;
};

const p = (text, opts = {}) => {
  const size = opts.size || 11;
  const font = opts.bold ? fontBold : (opts.italic ? fontItal : fontReg);
  const color = opts.color || BLACK;
  const lines = wrap(text, font, size, PAGE_W - 2 * M_X);
  for (const line of lines) {
    ensureSpace(size + 4);
    page.drawText(line, { x: M_X, y, size, font, color });
    y -= size + 4;
  }
  y -= 4;
};

const bullet = (text) => {
  const size = 11;
  const lines = wrap(text, fontReg, size, PAGE_W - 2 * M_X - 16);
  let first = true;
  for (const line of lines) {
    ensureSpace(size + 4);
    if (first) {
      page.drawCircle({ x: M_X + 4, y: y + 4, size: 2, color: CRIMSON });
      first = false;
    }
    page.drawText(line, { x: M_X + 16, y, size, font: fontReg, color: BLACK });
    y -= size + 4;
  }
  y -= 2;
};

const numbered = (n, title, body) => {
  ensureSpace(60);
  page.drawRectangle({ x: M_X, y: y - 2, width: 26, height: 22, color: CRIMSON });
  page.drawText(String(n), { x: M_X + (n < 10 ? 8 : 4), y: y + 4, size: 14, font: fontBold, color: WHITE });
  page.drawText(sanitize(title), { x: M_X + 34, y: y + 4, size: 13, font: fontBold, color: BLACK });
  y -= 24;
  if (body) p(body);
};

const callout = (title, body) => {
  const padX = 12, padY = 10;
  const titleH = 16;
  const bodyLines = wrap(body, fontReg, 10.5, PAGE_W - 2 * M_X - 2 * padX);
  const boxH = titleH + bodyLines.length * 14 + padY * 2;
  ensureSpace(boxH + 8);
  page.drawRectangle({ x: M_X, y: y - boxH, width: PAGE_W - 2 * M_X, height: boxH, color: LIGHT });
  page.drawRectangle({ x: M_X, y: y - boxH, width: 3, height: boxH, color: CRIMSON });
  page.drawText(sanitize(title), { x: M_X + padX, y: y - padY - 4, size: 11, font: fontBold, color: CRIMSON });
  let bY = y - padY - 4 - titleH;
  for (const line of bodyLines) {
    page.drawText(line, { x: M_X + padX, y: bY, size: 10.5, font: fontReg, color: BLACK });
    bY -= 14;
  }
  y -= boxH + 10;
};

// ============ COVER ============
page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK });
page.drawRectangle({ x: 0, y: PAGE_H - 240, width: PAGE_W, height: 6, color: CRIMSON });
page.drawText('TERMINAL X', { x: M_X, y: PAGE_H - 180, size: 48, font: fontBold, color: WHITE });
page.drawText(sanitize('para Salones y Barberias'), { x: M_X, y: PAGE_H - 220, size: 22, font: fontReg, color: WHITE });

page.drawText(sanitize('Guia de Ventas'), { x: M_X, y: 320, size: 32, font: fontBold, color: CRIMSON });
page.drawText(sanitize('Como vender y explicar Terminal X'), { x: M_X, y: 286, size: 16, font: fontReg, color: WHITE });
page.drawText(sanitize('a un dueno de salon o barberia en Republica Dominicana'), { x: M_X, y: 264, size: 16, font: fontReg, color: WHITE });

page.drawRectangle({ x: M_X, y: 180, width: PAGE_W - 2 * M_X, height: 1, color: CRIMSON });
page.drawText(sanitize('Pro PLUS  -  RD$5,490 / mes'), { x: M_X, y: 150, size: 14, font: fontBold, color: WHITE });
page.drawText(sanitize('e-CF Certificado DGII (Cert #42483)  |  WhatsApp UltraMsg  |  Reservas Publicas'), { x: M_X, y: 128, size: 10, font: fontReg, color: rgb(0.8, 0.8, 0.8) });

page.drawText(sanitize('Studio X SRL  |  terminalxpos.com  |  v2.16.1  |  2026-04-25'), { x: M_X, y: 60, size: 9, font: fontReg, color: rgb(0.6, 0.6, 0.6) });

// ============ PAGE 2 — EL CLIENTE TIPICO ============
newPage();
h1('1. Tu cliente: el salon o barberia en RD');
h2('Como esta operando hoy');
bullet('Agenda en Google Calendar o en una libreta. Citas confirmadas por DM de Instagram.');
bullet('Cobra en efectivo. Si pide factura, escribe a mano un RNC en una hoja.');
bullet('Le paga a cada estilista por porcentaje, calculado a mano al final de la semana.');
bullet('Pierde 2-4 citas a la semana por "no presentacion" sin manera de cobrar.');
bullet('Le revende a sus clientas champu/cera/aceites pero nunca sabe quien le compro que.');
bullet('Cuando llegue el 15 de mayo de 2026 va a estar OBLIGADO a emitir e-CF y no tiene como.');

h2('Lo que escucha en la calle');
callout('"Yo no necesito un sistema, mi negocio es chiquito"',
'Traduccion real: "No quiero pagar mensualidad sin entender que me da". Tu trabajo no es venderle un POS, es mostrarle que pierde mas dinero cada mes sin Terminal X que el costo del sistema.');

callout('"Eso es complicado, mis estilistas no saben de computadora"',
'Terminal X esta en espanol, en pantalla grande, con botones grandes. La pantalla de citas se parece a Google Calendar. La de cobro se parece a una calculadora. Si saben usar WhatsApp, saben usar Terminal X.');

// ============ PAGE 3 — POR QUE TERMINAL X ============
newPage();
h1('2. Por que Terminal X y no la competencia');
p('Terminal X es el UNICO POS en Republica Dominicana certificado como Emisor Electronico Directo ante la DGII (Certificado #42483). No depende de un proveedor intermedio. Eso te da tres ventajas que ningun otro POS puede ofrecer:', { size: 11 });

h2('Las 3 ventajas que cierran ventas');
numbered(1, 'e-CF directo, sin intermediario', 'Cuando llegue el 15 de mayo de 2026, todo negocio va a tener que emitir e-CF. Terminal X ya emite e-CF E32 (consumidor final), E31 (con RNC), E33, E34, etc. Tu cliente no necesita contratar un servicio extra.');
numbered(2, 'Funciona sin internet', 'Republica Dominicana se queda sin luz. Sin internet. Terminal X graba todo en la maquina y se sincroniza cuando regresa la conexion. Las citas, los cobros, los e-CF en cola - todo esta seguro.');
numbered(3, 'Hecho en RD para RD', 'Reconoce RNC y cedula. Calcula ITBIS. Imprime en formato 80mm termico. Esta en espanol dominicano. Soporte por WhatsApp en horario dominicano. La competencia internacional no entiende NCF, no maneja la 32-23.');

callout('Costo de no decidir',
'Si el cliente no tiene un sistema certificado para el 15 de mayo de 2026, la DGII puede multarlo. Una sola multa cubre 3 anos de Terminal X.');

// ============ PAGE 4 — LAS 10 FUNCIONES ============
newPage();
h1('3. Las 10 funciones que le venden el sistema');
p('Cuando hagas la demo, no pases las 10 de un tiron. Escoge las 3 que resuelven el dolor que el cliente acaba de mencionar.', { italic: true, color: GREY });

numbered(1, 'Reservas online publicas', 'Le das una direccion: terminalxpos.com/agendar/su-salon. La pone en su bio de Instagram. Las clientas reservan solas, sin DMs, sin "pasame tu numero, te confirmo". La cita cae directo en la agenda y la clienta recibe confirmacion por WhatsApp.');
numbered(2, 'Recordatorios automaticos por WhatsApp', 'Terminal X envia recordatorio 24 horas antes y 2 horas antes. La clienta confirma con "SI" o cancela. Reduce no-shows en 60% segun nuestros datos.');
numbered(3, 'Cliente preferido por estilista', 'En el perfil de cada cliente: "Prefiere a Maritza (8 citas)". Si Maritza no esta el dia que la clienta quiere, el sistema avisa. Las clientas se sienten reconocidas.');
numbered(4, 'Membresias y paquetes', '"10 Cortes RD$2,500" o "5 Manicures RD$1,800". Se vende como paquete, baja el saldo cada visita. WhatsApp avisa cuando se vence. Las clientas vuelven mas seguido y pagan por adelantado.');
numbered(5, 'Productos retail con un toque', 'En la pantalla de cobro, 6 tiles grandes con foto: champu, cera, aceite. Un toque y se agrega al ticket. Vender producto retail puede subir el ticket 30%.');
numbered(6, 'Comisiones complejas en tiempo real', 'Cada estilista ve en su pantalla: "Citas hoy: 8. Total ganado hoy: RD$3,200". Sin calculos a mano. Sin discusiones. Sin liquidaciones de viernes.');
numbered(7, 'Dashboard del dueno', 'Una pantalla con: Citas Hoy, % Ocupacion por Estilista, Ingresos del Mes, Top 5 Servicios, Productos Vendidos. Para el dueno que llega tarde, le dice todo lo que paso.');
numbered(8, 'No-show y deposito', 'Toggle "Requiere deposito RD$300". Si la clienta no llega, el sistema cobra automatico RD$500 de "No presentacion" + e-CF. Historial rojo en perfil de cliente.');
numbered(9, 'Walk-in vs cita programada', 'Dos modos en la agenda. Citas en azul, walk-ins en rojo. Cola prioritaria de walk-ins. El estilista sabe quien sigue sin preguntar.');
numbered(10, 'Cola de WhatsApp offline', 'Si se cae el internet, los recordatorios se guardan en cola. Cuando regresa la conexion, salen todos en lote. Nada se pierde.');

// ============ PAGE 5 — PITCH ============
newPage();
h1('4. El pitch de 30 segundos');
callout('Memoriza este parrafo',
'Terminal X es el unico sistema en RD certificado direct ante la DGII para emitir facturas electronicas. Para tu salon hace tres cosas: tus clientas reservan solas por un link de Instagram, te recuerda WhatsApp 24 y 2 horas antes para que no falten, y te calcula la comision de cada estilista en tiempo real. Pro PLUS RD$5,490 al mes. Cuando llegue mayo del 26 vas a estar listo para la 32-23 sin contratar otro servicio.');

h2('Como abrir la conversacion');
bullet('"?Cuanto pierdes al mes en clientas que no aparecen?" -> los lleva al deposito + recordatorios.');
bullet('"?Sabes cuanto ganaste tu vs lo que se llevaron las estilistas la semana pasada sin sacar la calculadora?" -> los lleva a comisiones.');
bullet('"?Como confirmas tus citas hoy? ?DM de Instagram?" -> los lleva a reservas publicas.');
bullet('"?Estas listo para el e-CF de mayo 2026?" -> los lleva a e-CF certificado.');

h2('Como NO abrir la conversacion');
bullet('NO empieces con el precio.');
bullet('NO empieces con tecnicismos: "es un POS con sincronizacion bidireccional...".');
bullet('NO digas "es como Square" - aqui no conocen Square.');
bullet('NO compares con un sistema gringo. Esto es para RD.');

// ============ PAGE 6 — DEMO GUIADA ============
newPage();
h1('5. Demostracion guiada (15 minutos)');
p('Si el cliente acepta una demo, sigue este orden. Cada paso resuelve un dolor que ya escuchaste en la conversacion previa.', { italic: true, color: GREY });

numbered(1, 'Empieza por la agenda (2 min)', 'Abre Citas. Muestra el dia de hoy. Mueve una cita arrastrandola. Crea una cita nueva. Marca como "no_show". Muestra el badge rojo en el cliente.');
numbered(2, 'Reservas publicas (3 min)', 'Abre /agendar/demo en otro navegador o en su celular. Que el cliente reserve una cita el mismo. Muestra que aparecio en la agenda en tiempo real.');
numbered(3, 'WhatsApp recordatorio (2 min)', 'Aprieta "Enviar recordatorio ahora" desde la cita. Que llegue el WhatsApp a su propio telefono. Esto sella la venta.');
numbered(4, 'Cobro con membresia (3 min)', 'Crea un cliente con paquete "10 Cortes". Lleva la cita a Cobro. Aprieta "Usar Membresia". El servicio se descuenta. Si agrega champu, emite e-CF solo por el champu.');
numbered(5, 'Comisiones en vivo (2 min)', 'En el cobro, muestra las dos columnas: "Estilista gana / Negocio gana". Total al pie. Cierra el ticket. Ve a Estilistas: el total del dia subio.');
numbered(6, 'Dashboard del dueno (2 min)', 'Abre /resumen. Muestra los 5 tiles. Esto es para el dueno que llega a las 6pm a ver "como fue el dia".');
numbered(7, 'Cierra (1 min)', 'Pregunta directo: "?Que te impide arrancar manana?" Calla y escucha. Lo que diga es la objecion real que tienes que manejar.');

callout('Regla de oro de la demo',
'No demuestres todas las funciones. Demuestra las 3 que duelen al cliente. Si demuestras 10 cosas el cliente sale confundido. Si demuestras 3 que resuelven sus problemas reales, cierra.');

// ============ PAGE 7 — OBJECIONES ============
newPage();
h1('6. Manejo de objeciones');

h2('"Esta caro"');
p('"Pro PLUS son RD$5,490 al mes. Una clienta que no aparece te cuesta RD$800-1,500 en tiempo perdido del estilista. Si Terminal X recupera 4 no-shows al mes, ya se pago. Y eso sin contar reservas extras del link publico."');

h2('"Yo uso Google Calendar y me funciona"');
p('"Google Calendar es gratis y le sirve si no le importa: emitir e-CF, calcular comisiones, recordar por WhatsApp, vender membresias, y cumplir con la 32-23 en mayo 2026. Cuando llegue esa fecha va a tener que comprar SI O SI un sistema certificado. Mejor empezar ahora que aprender bajo presion."');

h2('"?Y si se cae el internet?"');
p('"Terminal X funciona offline 72 horas. Las citas, los cobros, los e-CF se guardan en la maquina. Cuando regresa el internet se sincronizan automatico. Es la unica plataforma en RD que tiene cola diferida certificada por DGII."');

h2('"Mis estilistas no saben usar computadora"');
p('"Si saben mandar WhatsApp, saben usar Terminal X. La pantalla de cobro tiene 6 botones grandes. La de citas se parece a una agenda. Te entreno a las estilistas en 30 minutos sin costo. Si despues de la primera semana no se sienten comodas, te devuelvo el primer mes."');

h2('"?Quien me ayuda si tengo un problema?"');
p('"Soporte por WhatsApp al +1 809 828 2971, en horario dominicano, en espanol. Mismo dueno del sistema, no un call center extranjero. Y todas las actualizaciones son gratis - cuando agregamos features, te llegan automaticamente."');

h2('"?Y si quiero cancelar?"');
p('"Cancelas cuando quieras, sin penalidad. Tus datos los puedes exportar a CSV. Pero en 18 meses ningun salon nos ha cancelado - cuando ven los reportes y las comisiones automaticas, no quieren regresar a la libreta."');

// ============ PAGE 8 — CIERRE Y PROXIMOS PASOS ============
newPage();
h1('7. Cierre y precio');

h2('Estructura de precios');
p('Pro      RD$2,990 / mes   - POS basico, citas no incluidas.', { bold: true });
p('Pro PLUS RD$5,490 / mes   - Agenda + e-CF + WhatsApp + reservas publicas + membresias + dashboard. ESTE ES EL PLAN PARA SALONES.', { bold: true, color: CRIMSON });
p('Pro MAX  RD$9,990 / mes   - Todo lo anterior + multi-sucursal + cola WhatsApp offline + deposito automatico.', { bold: true });
p('Pago anual: 15% OFF. Trial Pro MAX 7 dias gratis en todos los signups.', { italic: true, color: GREY });

h2('Tres formas de cerrar');
numbered(1, 'Cierre directo', 'Si el cliente esta convencido: "Te activo la cuenta ahora mismo. ?Wifi tienes? Te configuro la primera cita en 5 minutos."');
numbered(2, 'Cierre con prueba', 'Si duda: "Arrancamos con el trial de 7 dias gratis. Si en una semana no te ahorra una cita, no me debes nada."');
numbered(3, 'Cierre con plazo', 'Si dice "lo voy a pensar": "Mayo 2026 ya esta cerca. Si esperas a abril vas a estar entrenando bajo presion. Empezamos ahora con calma o esperas y vamos contra reloj."');

h2('Proximos pasos despues del SI');
bullet('Crear cuenta en /signup con su email + telefono. Admin (Mike) la activa.');
bullet('FirstTimeSetup: pick "Barberia / Salon" como tipo de negocio.');
bullet('Cargar empleados (estilistas), servicios y precios.');
bullet('Configurar slug del enlace publico: /agendar/{nombre-de-su-salon}.');
bullet('Configurar UltraMsg (instance + token) para enviar WhatsApp.');
bullet('Cargar inventario de productos retail con foto y precio.');
bullet('Entrenamiento de 30 minutos con estilistas. Primera cita real.');
bullet('Soporte continuo via WhatsApp +1 809 828 2971.');

callout('Recuerda',
'Tu trabajo no es vender un POS. Es resolver tres problemas: clientas que no aparecen, comisiones a mano, y el e-CF de mayo 2026. Todo lo demas son features. Si vendes los problemas, no la tecnologia, cierras.');

// ============ FOOTER on every page ============
const pages = doc.getPages();
for (let i = 0; i < pages.length; i++) {
  const pg = pages[i];
  if (i === 0) continue; // skip cover
  // re-grab footer drawing on each non-cover page using the page directly
  pg.drawLine({ start: { x: M_X, y: 40 }, end: { x: PAGE_W - M_X, y: 40 }, thickness: 0.5, color: GREY });
  pg.drawText(sanitize('Studio X SRL  |  terminalxpos.com  |  +1 809 828 2971'), {
    x: M_X, y: 26, size: 8, font: fontReg, color: GREY,
  });
  pg.drawText(`${i + 1} / ${pages.length}`, {
    x: PAGE_W - M_X - 30, y: 26, size: 8, font: fontReg, color: GREY,
  });
}

const pdfBytes = await doc.save();
const out = resolve('A:/Studio X HUB/Terminal X/docs/Vender-Terminal-X-Salon-Barberia.pdf');
writeFileSync(out, pdfBytes);
console.log(`PDF written: ${out} (${(pdfBytes.length / 1024).toFixed(1)} KB, ${pages.length} pages)`);
