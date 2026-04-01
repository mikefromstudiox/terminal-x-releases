# Guia de Certificacion e-CF con DGII

Guia completa para el proceso de certificacion como Emisor Electronico ante la DGII bajo Ley 32-23.

**Proveedor:** Studio X Tech SRL — studioxrdtech.com | WhatsApp: +1 (809) 828-2971

---

## Datos de Tu Empresa (llenar antes de iniciar)

| Campo | Valor |
|-------|-------|
| RNC | _________________ |
| Razon Social | _________________ |
| Nombre Comercial | _________________ |
| Direccion | _________________ |
| Municipio (codigo) | _________________ |
| Provincia (codigo) | _________________ |
| Telefono | _________________ |
| Email | _________________ |
| Certificado .p12 | _________________ (ruta al archivo) |
| Password certificado | _________________ |

---

## Requisitos Previos

1. **RNC activo** en DGII
2. **Certificado digital .p12** de un proveedor autorizado (Viafirma, CertiSign, etc.)
3. **Acceso al portal** ecf.dgii.gov.do con tu clave DGII
4. **Oficina Virtual (OFV) activa** para el representante legal — si no esta activa, activarla en dgii.gov.do o llamando al (809) 689-3444
5. **El representante debe tener relacion con el RNC** — Accionista, Administrador, Socio, etc.
6. **Computadora** con Node.js instalado (para ejecutar los scripts)

---

## Portal de Certificacion

`https://ecf.dgii.gov.do/certecf/portalcertificacion/Postulacion/PruebasSimulacion`

## Endpoints API (CerteCF — certificacion)

| Servicio | URL |
|----------|-----|
| Autenticacion | `https://eCF.dgii.gov.do/CerteCF/Autenticacion` |
| Envio e-CF | `https://eCF.dgii.gov.do/CerteCF/Recepcion` |
| Consulta Estado | `https://eCF.dgii.gov.do/CerteCF/ConsultaResultado` |
| RFCE (E32 <250K) | `https://fc.dgii.gov.do/CerteCF/RecepcionFC` |

## Endpoints API (Produccion — despues de certificacion)

| Servicio | URL |
|----------|-----|
| Autenticacion | `https://eCF.dgii.gov.do/eCF/Autenticacion` |
| Envio e-CF | `https://eCF.dgii.gov.do/eCF/Recepcion` |
| Consulta Estado | `https://eCF.dgii.gov.do/eCF/ConsultaResultado` |
| RFCE (E32 <250K) | `https://fc.dgii.gov.do/eCF/RecepcionFC` |

---

## Los 15 Pasos de Certificacion

| Paso | Nombre | Descripcion |
|------|--------|-------------|
| 1 | Solicitud | Solicitar postulacion en el portal DGII |
| 2 | Autorizacion | DGII autoriza tu postulacion |
| 3 | Configuracion | Configurar tu cuenta y certificado en el portal |
| 4 | Pruebas Simulacion | Enviar 21 e-CFs de prueba + 4 RFCEs via API |
| 5 | Representacion Impresa | Subir PDFs con QR de cada tipo de e-CF |
| 6 | Revision DGII | DGII revisa y aprueba tus pruebas (puede tomar dias) |
| 7 | URL Servicios Prueba | Registrar tus 4 endpoints de recepcion |
| 8 | Inicio Prueba Recepcion | DGII prueba tu servidor: health check + autenticacion + recepcion |
| 9 | Recepcion e-CF | DGII envia e-CFs de prueba, tu servidor responde con ARECF firmado |
| 10 | Inicio Prueba Aprobacion | DGII inicia prueba de aprobacion comercial |
| 11 | Aprobacion Comercial | Tus endpoints responden con ACECF firmado |
| 12 | URL Servicios Produccion | Registrar endpoints de produccion |
| 13 | Declaracion Jurada | Firmar declaracion jurada (OFV del representante debe estar activa) |
| 14 | Verificacion Estatus | DGII verifica todo antes de dar luz verde |
| 15 | Finalizado | Certificacion completa — eres Emisor Electronico |

**IMPORTANTE:** No puedes retroceder pasos en el portal. Solo avanzar. Asegurate de que todo este correcto antes de pasar al siguiente.

---

## Paso 4 — Pruebas de Simulacion (Detalle)

### e-CFs Requeridos

| Tipo | Descripcion | Cantidad |
|------|-------------|----------|
| E31 | Factura de Credito Fiscal | 4 |
| E32 | Factura de Consumo >= 250K | 2 |
| E33 | Nota de Debito | 1 |
| E34 | Nota de Credito | 2 |
| E41 | Compras | 2 |
| E43 | Gastos Menores | 2 |
| E44 | Regimenes Especiales | 2 |
| E45 | Gubernamental | 2 |
| E46 | Exportaciones | 2 |
| E47 | Pagos al Exterior | 2 |
| E32 RFCE | Consumo < 250K (resumen) | 4 |
| **Total** | | **21 e-CFs + 4 RFCEs** |

### Orden de Envio (CRITICO)

El portal resetea TODO el progreso ante cualquier rechazo. El orden importa.

1. **Primero — Documentos base:** E31, E32>=250K, E41, E43, E44, E45, E46, E47
2. **Segundo — Notas que referencian documentos base:** E33 (ref E31), E34 (ref E31 y E44)
3. **Tercero — RFCEs:** E32<250K como resumen via sendSummary
4. **E32<250K NO se envian como e-CF regular** — solo como RFCE

### Ejecutar las Pruebas

```bash
# 1. Configurar tu archivo de cliente (copiar y editar el ejemplo)
cp tools/ecf-client-config.example.json tools/mi-empresa.json
# Editar mi-empresa.json con tus datos

# 2. Generar XMLs firmados
node tools/ecf-gen.js tools/mi-empresa.json

# 3. Enviar a DGII
node tools/ecf-submit.js tools/mi-empresa.json

# 4. Generar PDFs para Paso 5
node tools/ecf-pdf.js tools/mi-empresa.json

# 5. Subir RFCEs manualmente al portal (seccion "Facturas de consumo < 250Mil")
#    Archivos: {outputDir}/RFCE_*.xml
# 6. Subir PDFs al portal (Paso 5)
#    Archivos: {outputDir}/step5-pdfs/*.pdf
```

### Gestion de Secuencias

Las secuencias se consumen permanentemente, incluso en rechazos. **Nunca reutilizar.**

Si hubo un rechazo, incrementar `seqOffset` en tu config JSON antes de reintentar.

---

## Paso 5 — Representacion Impresa (PDFs)

- Generar PDFs inmediatamente despues de enviar el Paso 4 (los QR codes expiran)
- Cada PDF debe tener QR funcional que apunte a DGII
- Verificar cada QR antes de subir — si dice "No fue encontrada la factura" hay que reenviar Paso 4 y regenerar
- Subir un PDF por cada tipo de e-CF al portal

---

## Paso 6 — Revision DGII

- Solo esperar. DGII revisa manualmente tus XMLs y PDFs.
- Puede tomar 1-5 dias habiles.
- Si rechazan, te dicen el motivo. Corregir y reenviar desde Paso 4.

---

## Pasos 7-11 — Endpoints de Recepcion (CRITICO)

Tu negocio necesita 4 endpoints publicos HTTPS para que DGII te pueda enviar e-CFs.

### Los 4 Endpoints

| # | Endpoint | Metodo | Funcion |
|---|----------|--------|---------|
| 1 | `/fe/autenticacion/api/semilla` | GET/POST | Devolver semilla XML para autenticacion |
| 2 | `/fe/autenticacion/api/ValidacionCertificado` | POST | Validar certificado firmado, devolver JWT como JSON |
| 3 | `/fe/recepcion/api/ecf` | POST | Recibir e-CFs, devolver ARECF (acuse de recibo) firmado |
| 4 | `/fe/aprobacioncomercial/api/ecf` | POST | Aprobar/rechazar e-CFs, devolver ACECF firmado |

### Requisitos del Servidor

- **HTTPS obligatorio** con certificado SSL valido (Let's Encrypt funciona)
- **GET /** debe devolver 200 OK — DGII hace health check antes de probar los endpoints
- El servidor debe firmar respuestas ARECF y ACECF con el mismo certificado .p12 del emisor
- Los endpoints de recepcion y aprobacion requieren Bearer token (JWT) del paso de autenticacion
- **Todos los endpoints deben ser case-insensitive** (DGII usa distintas variaciones de mayusculas)

### Donde NO Hospedar

- **Vercel (Hobby plan):** Tiene proteccion anti-bot que puede bloquear peticiones de DGII (user-agent: `python-requests/2.32.4`)
- **Cualquier plataforma con WAF agresivo** que bloquee user-agents no-browser

### Donde SI Hospedar

- **VPS propio** (Hostinger, DigitalOcean, etc.) con Express.js o similar
- **Cloud Run / Lambda** con dominio custom (sin WAF restrictivo)
- Nosotros desplegamos estos endpoints por ti como parte del servicio

### Paso 7 — URL Servicios Prueba

Registrar las 4 URLs en el portal. Usar siempre el dominio del VPS, no Vercel.

### Paso 8 — Inicio Prueba Recepcion

**CRITICO:** DGII hace un `GET /` a tu dominio como health check ANTES de probar los endpoints. Si `GET /` devuelve 404, 403, o cualquier error, DGII reporta "HTTP Forbidden" y no intenta nada mas.

DGII usa `python-requests/2.32.4` como user-agent y viene de IP `85.11.167.19` (puede cambiar).

Flujo completo que DGII ejecuta:
1. `GET /` → health check, espera 200 OK
2. `GET /fe/autenticacion/api/semilla` → espera XML con `<SemillaModel>`
3. `POST /fe/autenticacion/api/ValidacionCertificado` → envia semilla firmada como multipart/form-data, espera JSON `{ token, expira, expedido }`
4. `POST /fe/recepcion/api/ecf` → envia e-CF con Bearer token como multipart/form-data, espera ARECF firmado

---

## Bugs Criticos Descubiertos (Paso 8-11)

Estos son los problemas que encontramos y corregimos durante la certificacion real. **Cualquier implementacion que no los resuelva fallara.**

### Bug 1: xml-crypto API v2.x vs v6+

**Sintoma:** `XPath parse error` al firmar ARECF/ACECF — el servidor devuelve 500.

**Causa:** El codigo usa la API de xml-crypto v6+ (`new SignedXml({ privateKey })`, objeto como parametro de `addReference`), pero la version instalada es v2.x que usa parametros posicionales.

**Fix:**
```javascript
// MAL (v6+ API):
const sig = new SignedXml({ privateKey: keyPem })
sig.addReference({ xpath: "//*[local-name(.)='ARECF']", digestAlgorithm: '...', transforms: ['...'] })
sig.computeSignature(xml, { location: { reference: "...", action: 'append' } })

// BIEN (v2.x API):
const sig = new SignedXml()
sig.signingKey = keyPem
sig.addReference("//*[local-name(.)='ARECF']", ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'], 'http://www.w3.org/2001/04/xmlenc#sha256', null, null, null, true)
sig.computeSignature(xml)
```

### Bug 2: isEmptyUri = true (CRITICO para ARECF/ACECF)

**Sintoma:** "El acuse de recibo no es válido" — DGII rechaza el ARECF firmado.

**Causa:** Sin `isEmptyUri=true` (7mo argumento de `addReference`), xml-crypto genera `<Reference URI="#_0">` y agrega `Id="_0"` al elemento raiz. DGII espera `<Reference URI="">` sin Id en el raiz — asi es como el paquete `dgii-ecf` firma internamente.

**Fix:** Pasar `true` como 7mo argumento:
```javascript
sig.addReference("//*[local-name(.)='ARECF']", ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'], 'http://www.w3.org/2001/04/xmlenc#sha256', null, null, null, true)
```

### Bug 3: ValidacionCertificado debe devolver JSON, no XML

**Sintoma:** "Ha ocurrido un error recibiendo el token" — DGII no puede leer el token.

**Causa:** DGII usa el paquete `dgii-ecf` internamente. Su tipo `AuthToken` espera JSON con tres campos: `{ token, expira, expedido }`. Nuestro servidor devolvía XML `<AutenticacionResponse>`.

**Fix:** Devolver JSON por defecto:
```javascript
const now = new Date()
const expira = new Date(now.getTime() + 3600000).toISOString()
const expedido = now.toISOString()
res.json({ token, expira, expedido })
```

**IMPORTANTE:** DGII NO envia header `Accept: application/json`. Debes devolver JSON siempre.

### Bug 4: Multipart parser no encuentra XML sin `<?xml>`

**Sintoma:** `400 no XML` — el servidor no puede extraer el e-CF del body multipart.

**Causa:** DGII envia el e-CF dentro de multipart/form-data, pero el XML empieza con `<ECF>` directamente, sin declaracion `<?xml version="1.0"?>`. Nuestro parser buscaba `<?xml` como inicio.

**Fix:** Buscar `<ECF` como alternativa:
```javascript
let startIdx = part.indexOf('<?xml')
if (startIdx === -1) startIdx = part.indexOf('<ECF')
```

### Bug 5: Endpoints deben ser case-insensitive

**Sintoma:** "no ser sensitivos" en el mensaje de error de DGII.

**Causa:** DGII puede enviar requests a `/fe/Recepcion/api/ecf`, `/fe/recepcion/api/ECF`, etc. Express.js es case-sensitive por defecto.

**Fix:** Registrar rutas con multiples variaciones o usar middleware case-insensitive.

### Bug 6: Root certificate de DGII

**Sintoma:** DGII te da un certificado raiz para descargar en el Paso 10.

**Accion:** Descargar `camaracomercio.crt` y guardarlo en el servidor para validar certificados de DGII en las aprobaciones comerciales.

---

## Paso 13 — Declaracion Jurada

- **El portal genera el XML** — no hay que construirlo manualmente
- Click "GENERAR ARCHIVO" para descargar el XML
- Firmar el XML con tu certificado .p12 (misma firma que usas para e-CFs)
- Subir el XML firmado al portal

**PREREQUISITO:** La Oficina Virtual (OFV) del representante legal debe estar ACTIVA. Si no lo esta:
- Activar en dgii.gov.do
- O llamar al (809) 689-3444
- O escribir a oficinavirtual@dgii.gov.do

**IMPORTANTE:** El firmante del XML debe coincidir con el representante registrado para tu RNC. Si no coincide, el portal rechaza con "la firma utilizada no corresponde con el representante registrado."

---

## Reglas de Schema por Tipo de e-CF

| Tipo | Bloque Comprador | Notas |
|------|-----------------|-------|
| E31 | Requerido | Buyer RNC + info completa |
| E32 >= 250K | Requerido | Comprador para montos grandes |
| E32 < 250K | NO | Solo se envia como RFCE |
| E33 | Requerido | Referencia E31 via NCFModificado |
| E34 | Requerido | Referencia doc base via NCFModificado |
| E41 | Requerido | Incluye Retencion en items |
| E43 | **NO Comprador** | Schema rechaza si lo incluyes |
| E44 | Requerido | Regimenes especiales |
| E45 | Requerido | Usa RNC gubernamental (401007540) |
| E46 | Requerido | Factura de exportacion |
| E47 | Requerido (IdentificadorExtranjero) | Omitir RNCComprador en QR |

### Reglas E33/E34

- `NCFModificado`: el eNCF que se modifica (debe estar aceptado previamente)
- `FechaNCFModificado`: fecha del documento original
- `CodigoModificacion=1`: anulacion total (monto DEBE coincidir exacto con el original)
- `CodigoModificacion=3`: correccion parcial (monto puede diferir)
- E34 #1 referencia E31 #1 (parcial, CodigoModificacion=3)
- E34 #2 referencia E44 #1 (anulacion total, CodigoModificacion=1, monto exento debe coincidir)

---

## Codigo de Seguridad y QR

### CodigoSeguridad

Primeros 6 caracteres del `SignatureValue` en base64 del XML firmado. **SIN hashing.**

```js
const sigValue = xmlTag(signedXml, 'SignatureValue').replace(/\s/g, '')
const securityCode = sigValue.substring(0, 6)
```

### URLs del QR

**e-CF estandar (E31, E32>=250K, E33, E34, E41, E44, E45, E46):**
```
https://ecf.dgii.gov.do/{env}/consultatimbre?rncemisor={RNC}&RncComprador={RNC_BUYER}&encf={eNCF}&fechaemision={DD-MM-YYYY}&montototal={XXXX.XX}&fechafirma={DD-MM-YYYY%20HH%3AMM%3ASS}&codigoseguridad={6CHARS}
```

**E43, E47 (sin comprador):** Igual pero omitir `RncComprador`.

**E32 < 250K (ConsultaTimbreFC):**
```
https://fc.dgii.gov.do/{env}/consultatimbrefc?rncemisor={RNC}&encf={eNCF}&montototal={XXXX.XX}&codigoseguridad={6CHARS}
```

Donde `{env}` = `certecf` (certificacion) o `ecf` (produccion).

---

## Uso del Paquete dgii-ecf

**IMPORTANTE:** Siempre usar el paquete NPM `dgii-ecf` para autenticacion y envio. Los custom xml-signers fallan con la auth de DGII ("Archivo no valido").

```js
const fs = require('fs')
const { ECF, ENVIRONMENT, Signature } = require('dgii-ecf')

const key = fs.readFileSync('path/to/dgii-key.pem', 'utf8')
const cert = fs.readFileSync('path/to/dgii-cert.pem', 'utf8')

// Autenticacion + Envio
const ecf = new ECF({ key, cert }, ENVIRONMENT.CERT)  // o ENVIRONMENT.PROD
await ecf.authenticate()

// Enviar e-CF
const result = await ecf.sendElectronicDocument(signedXml, '{RNC}E310000001801.xml')
// result = { trackId: '...', error: null, mensaje: null }

// Consultar estado
const status = await ecf.statusTrackId(result.trackId)
// status.codigo: '1'=Aceptado, '2'=Rechazado, '3'=EnProceso, '4'=Condicional

// Enviar RFCE (E32 < 250K resumen)
// IMPORTANTE: nombre de archivo debe ser {RNC}{eNCF}.xml — sin prefijo RFCE_
await ecf.sendSummary(signedXml, '{RNC}E320000001803.xml')

// Firmar XMLs
const signer = new Signature(key, cert)
const signedXml = signer.signXml(xmlStr, 'ECF')    // para e-CFs
const signedRfce = signer.signXml(xmlStr, 'RFCE')   // para RFCEs
```

### Extraer PEM desde .p12

```bash
# Extraer clave privada
openssl pkcs12 -in certificado.p12 -nocerts -nodes -out dgii-key.pem

# Extraer certificado
openssl pkcs12 -in certificado.p12 -clcerts -nokeys -out dgii-cert.pem
```

---

## Errores Comunes y Soluciones

| Error | Causa | Solucion |
|-------|-------|----------|
| "Archivo no valido" | Auth con xml-signer custom | Usar paquete dgii-ecf |
| "No fue encontrada la factura" | QR datos expirados | Reenviar Paso 4 + regenerar PDFs inmediatamente |
| "invalid child 'Totales', expected 'Comprador'" | E32<250K enviado como e-CF regular | Solo enviar como RFCE via sendSummary |
| "invalid child 'Comprador', expected 'Totales'" | Comprador en E43 | E43 NO tiene Comprador |
| "eNCF modificado no ha sido emitido" | Nota enviada antes del doc base | Enviar docs base PRIMERO |
| "secuencia ya utilizada" | Secuencia consumida en intento previo | Incrementar seqOffset en config |
| "longitud del nombre del archivo no es valida" | Nombre de archivo RFCE con prefijo | Usar `{RNC}{eNCF}.xml` sin RFCE_ |
| Portal resetea a 0/X | Cualquier rechazo individual | Corregir, incrementar secuencias, reenviar todo |
| "HTTP Forbidden" en Paso 8 | GET / devuelve 404 en tu servidor | Agregar ruta raiz que devuelva 200 OK |
| "HTTP Forbidden" en Paso 8 | WAF bloquea bot requests | Migrar a VPS propio (no Vercel Hobby) |
| "Ha ocurrido un error recibiendo el token" | Respuesta en XML en vez de JSON | Devolver JSON `{ token, expira, expedido }` por defecto |
| "Ha ocurrido un error recibiendo el token" | Falta campo `expedido` | Incluir los 3 campos: token, expira, expedido |
| "El acuse de recibo no es válido" | Firma con `URI="#_0"` en vez de `URI=""` | Pasar `isEmptyUri=true` a addReference |
| "El acuse de recibo no es válido" | XML empieza con `<ECF>` sin `<?xml>` | Parser debe buscar `<ECF` como alternativa |
| "no ser sensitivos" | Endpoints case-sensitive | Registrar rutas con multiples casings |
| "BadRequest" en recepcion | Multipart body no parseado | Mejorar parser multipart con fallback |
| OFV inactiva en Paso 13 | Representante sin Oficina Virtual | Activar en dgii.gov.do o llamar (809) 689-3444 |
| Firma no corresponde en Paso 13 | Certificado .p12 de otra persona | El firmante debe ser el representante registrado |
| Timeout en endpoints | Firewall bloquea trafico Docker | Abrir puertos UFW para subnets Docker (172.17/18.0.0/16) |

---

## Checklist de Produccion (despues de certificacion)

- [ ] Cambiar ambiente de `ENVIRONMENT.CERT` a `ENVIRONMENT.PROD` en config
- [ ] Actualizar URLs de QR de `/certecf/` a `/ecf/`
- [ ] Resetear contadores de secuencia para produccion
- [ ] Actualizar endpoints de recepcion a produccion (Paso 12)
- [ ] Firmar Declaracion Jurada (Paso 13)
- [ ] Verificar primera factura real en dgii.gov.do
- [ ] Configurar monitoreo de endpoints (uptime check)

---

## Soporte

- **WhatsApp:** +1 (809) 828-2971
- **Email:** admin@studioxrdtech.com
- **Web:** studioxrdtech.com

Servicio provisto por **Studio X Tech SRL** — studioxrdtech.com
