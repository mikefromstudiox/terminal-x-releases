# DGII e-CF Certification Guide — Terminal X

Complete guide for the DGII electronic invoicing (Facturacion Electronica) certification process under Ley 32-23.

## Company Info
- **RNC:** 133410321
- **Razon Social:** STUDIO X SRL
- **Nombre Comercial:** STUDIO X
- **Certificate:** Viafirma .p12 — `C:/Users/City/Downloads/20260323-2007011-PKY933N6B.p12`
- **PEM Key:** `C:/Users/City/Downloads/dgii-key.pem`
- **PEM Cert:** `C:/Users/City/Downloads/dgii-cert.pem`
- **Certificate Password:** Monocotonia123
- **Test Buyer RNC:** 131880681 (DOCUMENTOS ELECTRONICOS DE 03)
- **Gov Buyer RNC:** 401007540 (DGII)

## Portal
`https://ecf.dgii.gov.do/certecf/portalcertificacion/Postulacion/PruebasSimulacion`

## API Endpoints (CerteCF)
| Service | URL |
|---------|-----|
| Auth | `https://eCF.dgii.gov.do/CerteCF/Autenticacion` |
| Submit e-CF | `https://eCF.dgii.gov.do/CerteCF/Recepcion` |
| Status | `https://eCF.dgii.gov.do/CerteCF/ConsultaResultado` |
| RFCE (E32 <250K) | `https://fc.dgii.gov.do/CerteCF/RecepcionFC` |

---

## Certification Steps Overview

| Step | Name | Status |
|------|------|--------|
| 1-3 | Setup / Authorization | DONE |
| 4 | Pruebas Simulacion (submit test e-CFs) | DONE (2026-03-27) |
| 5 | Validacion Representacion Impresa (PDFs with QR) | DONE (2026-03-27) |
| 6 | DGII reviews and approves | WAITING |
| 7 | URL Servicios Prueba | Vercel endpoints deployed |
| 8 | Inicio Prueba Recepcion e-CF | PENDING |
| 9 | Recepcion e-CF | PENDING |
| 10 | Inicio Prueba Recepcion Aprobacion Comercial | PENDING |
| 11 | Recepcion Aprobacion Comercial | PENDING |
| 12 | URL Servicios Produccion | PENDING |
| 13 | Declaracion Jurada | PENDING |
| 14 | Verificacion Estatus | PENDING |
| 15 | Finalizado | PENDING |

---

## Step 4 — Pruebas Simulacion

### Required e-CF Counts
| Type | Description | Count |
|------|-------------|-------|
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

### Submission Order (CRITICAL)
The portal resets ALL progress on ANY single rejection. Order matters.

**Primero — Base documents (via sendElectronicDocument):**
1. E31 (Factura de Credito Fiscal)
2. E32 >= 250K (Factura de Consumo grande)
3. E41 (Compras)
4. E43 (Gastos Menores)
5. E44 (Regimenes Especiales)
6. E45 (Gubernamental)
7. E46 (Exportaciones)
8. E47 (Pagos al Exterior)

**Segundo — Notas that reference base documents (via sendElectronicDocument):**
9. E33 (Nota de Debito) — references an E31
10. E34 (Nota de Credito) — references E31 and E44

**Tercero — RFCE summaries (via sendSummary to fc.dgii.gov.do):**
11. E32 RFCE x4 (Consumo < 250K resumen)

**Cuarto — E32 < 250K ECFs are NOT submitted as regular e-CFs. Only as RFCEs above.**

### Scripts
```bash
# 1. Generate signed XMLs (update SEQ and fecha first!)
node electron/dgii-step4-gen.js

# 2. Submit all to DGII API
node electron/dgii-step4-submit.js

# 3. Generate Step 5 PDFs (do IMMEDIATELY after step 2)
node electron/dgii-step5-pdf.js

# 4. Upload RFCEs manually via portal "Facturas de consumo < 250Mil" section
#    Files: test-xmls/step4-sim/RFCE_*.xml

# 5. Upload PDFs to portal Step 5
#    Files: test-xmls/step5-pdfs/*.pdf
```

### Before Each Run
1. Update `const SEQ = { '31':XXXX, ... }` in `electron/dgii-step4-gen.js` — bump all to next safe offset
2. Update `fecha` in the `E` object to current date (DD-MM-YYYY format)
3. Update `FechaNCFModificado` dates if needed (E33/E34 reference dates)

### Sequence History
Sequences are consumed permanently, even on rejection. Never reuse.
```
1 → 1300 → 1400 → 1500 → 1600 → 1700 → 1800 (current)
Next safe: 1900+
```

---

## API Usage (dgii-ecf NPM package)

**IMPORTANT:** Always use the `dgii-ecf` package for API calls. Our custom `dgii-client.js` `signSeed()` does NOT work with DGII auth (returns "Archivo no valido").

```js
const fs = require('fs')
const { ECF, ENVIRONMENT, Signature } = require('dgii-ecf')

const key = fs.readFileSync('C:/Users/City/Downloads/dgii-key.pem', 'utf8')
const cert = fs.readFileSync('C:/Users/City/Downloads/dgii-cert.pem', 'utf8')

// --- Authentication + Submission ---
const ecf = new ECF({ key, cert }, ENVIRONMENT.CERT)  // or ENVIRONMENT.PROD
await ecf.authenticate()

// Submit e-CF (E31, E32>=250K, E33, E34, E41, E43, E44, E45, E46, E47)
const result = await ecf.sendElectronicDocument(signedXml, '133410321E310000001801.xml')
// result = { trackId: '...', error: null, mensaje: null }

// Poll status
const status = await ecf.statusTrackId(result.trackId)
// status.codigo: '1'=Aceptado, '2'=Rechazado, '3'=EnProceso, '4'=Condicional

// Submit RFCE (E32 < 250K summary)
// IMPORTANT: filename must be {RNC}{eNCF}.xml — NO 'RFCE_' prefix
await ecf.sendSummary(signedXml, '133410321E320000001803.xml')

// --- Signing XMLs (separate from auth) ---
const signer = new Signature(key, cert)
const signedXml = signer.signXml(xmlStr, 'ECF')   // for e-CFs
const signedRfce = signer.signXml(xmlStr, 'RFCE')  // for RFCEs
```

### Environments
| Env | Constant | Use |
|-----|----------|-----|
| TesteCF | `ENVIRONMENT.DEV` | Development testing |
| CerteCF | `ENVIRONMENT.CERT` | Certification process |
| eCF | `ENVIRONMENT.PROD` | Production |

---

## QR URL Format (ConsultaTimbre)

**CONFIRMED WORKING (2026-03-27):** Must use lowercase paths and params.

### Standard e-CF (E31, E32>=250K, E33, E34, E41, E44, E45, E46)
```
https://ecf.dgii.gov.do/{env}/consultatimbre?rncemisor={RNC}&RncComprador={RNC_BUYER}&encf={eNCF}&fechaemision={DD-MM-YYYY}&montototal={XXXX.XX}&fechafirma={DD-MM-YYYY%20HH%3AMM%3ASS}&codigoseguridad={6CHARS}
```

### E43, E47 (no buyer)
Same as above but omit `RncComprador` param entirely.

### E32 < 250K (ConsultaTimbreFC)
```
https://fc.dgii.gov.do/{env}/consultatimbrefc?rncemisor={RNC}&encf={eNCF}&montototal={XXXX.XX}&codigoseguridad={6CHARS}
```

### CodigoSeguridad
First 6 characters of raw base64 `SignatureValue` from the signed XML. **NO hashing.**
```js
const sigValue = xmlTag(signedXml, 'SignatureValue').replace(/\s/g, '')
const securityCode = sigValue.substring(0, 6)
```

---

## Schema Rules (learned the hard way)

| Type | Comprador Block | Notes |
|------|----------------|-------|
| E31 | Required | Standard buyer info |
| E32 >= 250K | Required | Has buyer for large amounts |
| E32 < 250K | None | Consumer invoice, no buyer |
| E33 | Required | References E31 via NCFModificado |
| E34 | Required | References base doc via NCFModificado |
| E41 | Required | Includes Retencion in items |
| E43 | **NO Comprador** | Schema rejects if present |
| E44 | Required | Regimenes especiales |
| E45 | Required | Uses gov buyer RNC |
| E46 | Required | Export invoice |
| E47 | **No RNCComprador in QR** | Uses IdentificadorExtranjero |

### E33/E34 Reference Rules
- `NCFModificado`: the eNCF being modified (must already be submitted and accepted)
- `FechaNCFModificado`: date of the original document
- `CodigoModificacion=3`: partial correction (amount can differ)
- `CodigoModificacion=1`: full annulment (amount MUST match original exactly)
- E34 #1 references E31 #1 (partial, CodigoModificacion=3)
- E34 #2 references E44 #1 (full annulment, CodigoModificacion=1, exento amount must match)

---

## Common Errors & Solutions

| Error | Cause | Fix |
|-------|-------|-----|
| "Archivo no valido" | Using custom xml-signer for auth | Use dgii-ecf package |
| "No fue encontrada la factura" | QR data expired or wrong URL format | Resubmit Step 4 + regenerate PDFs immediately |
| "invalid child 'Totales', expected 'Comprador'" | E32<250K submitted as regular e-CF | Only submit as RFCE via sendSummary |
| "invalid child 'Comprador', expected 'Totales'" | Added Comprador to E43 | E43 has NO Comprador |
| "eNCF modificado no ha sido emitido" | E33/E34 submitted before base doc | Submit base docs FIRST, notas SECOND |
| "secuencia ya utilizada" | Sequence consumed from prior attempt | Bump SEQ offset in step4-gen.js |
| "longitud del nombre del archivo no es valida" | RFCE filename has RFCE_ prefix | Use `{RNC}{eNCF}.xml` only |
| Portal resets to 0/X | Any single rejection wipes all progress | Fix error, bump sequences, resubmit everything |

---

## Steps 7-11 — Receiver Endpoints

Already deployed to Vercel at `terminalxpos.com`:
- `web/api/fe/semilla.js` — seed endpoint
- `web/api/fe/validarcertificado.js` — certificate validation
- `web/api/fe/recepcion.js` — e-CF reception
- `web/api/fe/aprobacion.js` — commercial approval

---

## Production Checklist (after certification)
1. Switch environment from `ENVIRONMENT.CERT` to `ENVIRONMENT.PROD`
2. Update QR URLs from `/certecf/` to `/ecf/` (handled by buildQRUrl in dgii-client.js)
3. Reset sequence counters for production
4. Update receiver endpoint URLs to production
5. File Declaracion Jurada (Step 13)
