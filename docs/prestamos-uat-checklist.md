# Préstamos / Empeño — UAT Clickthrough Checklist v2.16.2

**Duración estimada:** 90–120 minutos
**Cuenta demo:** `admin@prestamos.demo.terminalxpos.com` / `Demo2026!`
**Navegador:** Chrome o Edge (Electron equivalente)
**Tablet recomendado:** para validar firma touch + cámara DPI
**Impresora:** térmica 80mm conectada (papeleta) — opcional pero recomendado

---

## Pre-flight

- [ ] Ajustes → Negocio → confirmar `RNC = 9 dígitos`, `legal_name`, `mora_rate_daily` ≠ null
- [ ] Internet activo + Supabase responde (revisar `/lending/resumen` carga sin errores)
- [ ] Cliente de prueba existe con: `full_name`, `phone` válido (809/829/849), `dpi` 11 dígitos
- [ ] `package.json` version = `2.16.2`

---

## A. Préstamos (1.1–1.6) — 25 min

### A1. Crear préstamo Solo Intereses
- [ ] `/lending/loans` → **Nuevo Préstamo**
- [ ] Cliente: seleccionar
- [ ] Principal `RD$10,000`, plazo `6 meses`, tasa `5% mensual`
- [ ] Método: **Solo Intereses** (default)
- [ ] Verificar APR display: `5.00% mensual (equivalente 79.59% anual)`
- [ ] Schedule preview: 6 cuotas × RD$500 interés + balloon RD$10,500 último mes
- [ ] Guardar → toast verde, fila aparece en tabla

### A2. Crear préstamo Cuota Fija (Francés)
- [ ] Mismo flujo, método = **Cuota Fija**
- [ ] Schedule preview: 6 cuotas constantes ~RD$1,933
- [ ] Guardar OK

### A3. Crear préstamo Capital Fijo (Alemán)
- [ ] Método = **Capital Fijo**
- [ ] Schedule: principal igual c/mes (RD$1,667), interés decreciente
- [ ] Guardar OK

### A4. Registrar pago
- [ ] Abrir cualquier préstamo activo → **Registrar Pago**
- [ ] Monto = primera cuota → guardar → balance disminuye

### A5. Generar Contrato (con rollback test)
- [ ] **CASO POSITIVO:** abrir préstamo sin contrato → **Generar Contrato**
- [ ] Modal abre con texto previsualización
- [ ] Garantía: opcional, escribir "Vehículo Hyundai Tucson 2018"
- [ ] **Firma touch:** trazar firma en pad → preview visible
- [ ] **DPI:** capturar/subir foto cédula → thumbnail visible
- [ ] **Firmar y Generar PDF** → loader → PDF descarga automático
- [ ] Verificar PDF (3 páginas): cláusulas + tabla amortización + firma+DPI anexo
- [ ] Verificar `loan_contracts` row creado (Supabase dashboard o re-abrir préstamo, badge "Contrato firmado")
- [ ] **CASO RNC FALTANTE:** Ajustes → quitar RNC del negocio → intentar generar contrato → toast crimson `Falta RNC o razón social del negocio`
- [ ] **CASO FIRMA VACÍA:** restaurar RNC, abrir contrato sin firmar → submit deshabilitado o toast `Firma y foto de cédula son obligatorias`

### A6. Renovar préstamo
- [ ] Préstamo activo → **Renovar**
- [ ] Capturar interés sugerido (ej. `RD$500`), extensión `1 mes`, notas opcionales
- [ ] Confirmar → toast verde
- [ ] Verificar: `next_due_date` extendido +1 mes, badge "Renovado 1 vez"
- [ ] Renovar segunda vez → badge "Renovado 2 veces"
- [ ] Expandir historial → ver 2 rows en `loan_renewals`

### A7. Marcar defaulted
- [ ] Préstamo → menú → **Marcar Defaulted** → status cambia, fila tinta crimson

---

## B. Empeños (1.7–1.14) — 30 min

### B1. Crear empeño con Valoración (rollback test)
- [ ] `/lending/pawn-items` → **Nuevo Empeño**
- [ ] **CASO RNC FALTANTE:** quitar RNC → submit → toast crimson `RNC del negocio obligatorio (9 dígitos)` → restaurar RNC
- [ ] Cliente: seleccionar
- [ ] Descripción: "Cadena de oro 18k 50g"
- [ ] **Fotos:** subir 3 fotos JPG válidas
- [ ] **CASO FOTO 6MB:** intentar subir foto >5MB → toast `Foto excede 5MB` → reemplazar
- [ ] **CASO MIME inválido:** intentar `.gif` → toast formato no permitido → reemplazar
- [ ] Valor estimado: `RD$25,000`, % ofrecido: `60`, monto = `RD$15,000` (auto)
- [ ] Días retiro: `30`, días alerta: `3`
- [ ] Notas valoración: "Eslabón ovalado, sin marca visible"
- [ ] **DPI cliente:** capturar foto cédula
- [ ] **CASO CÉDULA INVÁLIDA:** poner cédula 10 dígitos → toast `Cédula del cliente obligatoria (11 dígitos)`
- [ ] **Firma del Empeñador (cliente):** trazar
- [ ] **Firma del Prestamista (operador):** trazar
- [ ] **CASO FALTA UNA FIRMA:** dejar una en blanco → submit bloqueado o toast `Ambas firmas son obligatorias`
- [ ] Guardar → toast verde, papeleta imprime (si impresora conectada)

### B2. Verificar papeleta impresa contiene
- [ ] Header: nombre negocio + `RNC: 123456789`
- [ ] Ticket code de 6 dígitos
- [ ] Cliente con `Cedula: ###########`
- [ ] Descripción + valor + monto prestado
- [ ] Bloque **TÉRMINOS DEL EMPEÑO** con plazo, gracia 3 días, mora%
- [ ] Dos bloques de firma (Empeñador + Prestamista)
- [ ] Footer: `Papeleta generada por Terminal X · DGII Emisor #42483 · {fecha}`

### B3. Pill de alerta vencimiento
- [ ] Crear empeño con `redeem_deadline` = hoy + 2 días
- [ ] Lista → debe aparecer pill crimson "Vence en 2 días"
- [ ] Cambiar deadline a ayer → pill negro/rojo "VENCIDO"

### B4. Documentos extra (matrícula vehículo)
- [ ] Empeño → tab **Documentos** → Subir matrícula PDF
- [ ] Aparece en lista con click-to-download → URL firmada funciona
- [ ] Eliminar → fila desaparece, archivo eliminado del bucket privado

### B5. Redimir
- [ ] Empeño activo → **Redimir** → confirmar
- [ ] Status = redeemed, fecha redención registrada

### B6. Forfeited + Publicar
- [ ] Empeño activo → **Marcar Vencido** → status = forfeited
- [ ] Botón **Publicar para Venta** aparece
- [ ] Click → modal con `list_price` default = estimated × 1.2 (revisar si avalúo 70% se aplica en C8)
- [ ] Confirmar → toast con link `Publicado en /tienda-empenos/{businessId}/{slug}`
- [ ] Click "Copiar link"

### B7. Tienda Empeños pública
- [ ] Abrir el link en ventana incógnito (sin auth)
- [ ] Página renderiza: hero + business name + grid de fotos + precio
- [ ] Click en card → detalle con carrusel + WhatsApp CTA
- [ ] Botón WhatsApp abre `wa.me` con mensaje pre-llenado

### B8. Despublicar
- [ ] Volver a admin → empeño publicado → **Despublicar** → status = removed
- [ ] Refrescar tienda pública → 404 o lista vacía si era único

---

## C. Cobranza (1.15–1.18) — 15 min

### C1. Cola Cobranza Diaria
- [ ] `/lending/collections` → tabla con préstamos vencidos
- [ ] Toggle sort: días mora desc → monto adeudado → último contacto
- [ ] Pill rojo si días mora ≥ 30

### C2. Registrar Intento (5 outcomes)
- [ ] Préstamo en mora → **Registrar Intento**
- [ ] Probar cada outcome: Llamé, Prometió, Pagó, No contestó, Rechazó
- [ ] Notas + próximo seguimiento
- [ ] **WhatsApp toggle ON** → al guardar, abre `wa.me`
- [ ] **CASO HORARIO:** simular hora 10pm o domingo (cambiar reloj sistema temp) → confirm dialog `Horario laboral DR: 8am–8pm, no domingos. Hoy es {detail}. ¿Enviar de todos modos?`
- [ ] Cancelar → no abre WA. Confirmar → abre WA force.
- [ ] **CASO TELÉFONO INVÁLIDO:** cliente con phone "12345" → toast `Número de WhatsApp inválido. Debe ser DR (809/829/849) + 7 dígitos`

### C3. Historial intentos
- [ ] Click "Ver historial" en una fila → side panel slide-in
- [ ] Lista cronológica de attempts con outcome icon, fecha, notas

### C4. Mirror collections_log
- [ ] Verificar que cada attempt nuevo también aparece en `collections_log` (consulta Supabase) — back-compat

---

## D. Resumen / SBReport (1.19–1.20) — 10 min

### D1. Dashboard
- [ ] `/lending/resumen` → 5 KPI tiles cargan con valores
- [ ] Cartera Activa = suma esperada
- [ ] Mora % crimson si >10%
- [ ] 3 alert cards: préstamos en mora hoy / empeños vencen ≤3 días / renovaciones recientes

### D2. SB Report CSV
- [ ] `/lending/reporte-sb` → banner amber "PDF SB pendiente"
- [ ] Filtro Mes = actual, Año = 2026
- [ ] Click **Cartera Activa CSV** → descarga, abrir en Excel, columnas pobladas
- [ ] Click **Mora Aging CSV** → descarga
- [ ] Click **Redenciones CSV** → descarga
- [ ] Botón **Exportar PDF SB** está deshabilitado con tooltip

---

## E. RLS / Seguridad (post-C2 migration) — 15 min

### E1. Cartera del negocio propio (positivo)
- [ ] Login → `/lending/loans` carga préstamos del business
- [ ] `/lending/pawn-items` carga empeños del business

### E2. Cross-tenant bypass (negativo, debe fallar)
- [ ] Abrir DevTools console
- [ ] Ejecutar:
```js
const sb = window.__supabase__ || supabase
const fakeBiz = '00000000-0000-0000-0000-000000000000'
const { data, error } = await sb.from('loans').select('*').eq('business_id', fakeBiz)
console.log({ count: data?.length, error })
```
- [ ] Resultado esperado: `count: 0`, sin error → RLS filtra correctamente
- [ ] Repetir con tabla `pawn_items`, `loan_contracts`, `collections_attempts` → todas deben retornar 0 rows

### E3. Tienda pública anónima
- [ ] Sin login, abrir `/tienda-empenos/{businessId}` → carga listings publicados
- [ ] DevTools console (sin auth):
```js
const { data } = await sb.from('loans').select('*')
console.log(data?.length)  // esperado: 0 (anon sin JWT no ve nada)
```
- [ ] Anon SELECT en `pawn_listings WHERE status='published'` → debe regresar rows

### E4. Verificación auto-remediada
- [ ] Ejecutar `node scripts/verify-rls-prestamos.mjs` desde terminal → reporta 4 gates green

---

## F. Offline + sync (post C5) — 10 min

### F1. Crear préstamo offline (Electron only)
- [ ] Desconectar wifi
- [ ] Electron app → crear préstamo + pago + empeño
- [ ] Operaciones se completan localmente (SQLite)
- [ ] Reconectar wifi → esperar 5 min ciclo sync
- [ ] Verificar Supabase tiene los rows nuevos

### F2. loan_schedule + collections_log sync
- [ ] Crear préstamo → verificar `loan_schedule` rows en SQLite Y en Supabase
- [ ] Registrar intento cobranza → verificar mirror en `collections_log` Supabase

---

## G. Smoke regresión (10 min)

### G1. e-CF / DGII regresión (no debe romperse)
- [ ] Crear venta normal en POS → e-CF firmado y enviado a DGII (verificar IndicadorEnvioDiferido si offline)

### G2. Build + e2e
- [ ] `npm run build:web` green
- [ ] `npm run build:electron` green (o `npm run build:react`)
- [ ] `npm run e2e:demo -- prestamos` → 47/47+ pass

---

## Sign-off

| Sección | Tester | Hora inicio | Hora fin | Bugs encontrados | Severidad |
|---|---|---|---|---|---|
| A. Préstamos | | | | | |
| B. Empeños | | | | | |
| C. Cobranza | | | | | |
| D. Resumen / SB | | | | | |
| E. RLS | | | | | |
| F. Offline | | | | | |
| G. Regresión | | | | | |

**Aprobación final para go-live:**
- [ ] Cero bugs Critical
- [ ] Cero bugs High sin workaround
- [ ] Tests E + RLS verificados (la cuenta demo NO ve carteras de otros)
- [ ] Papeleta impresa revisada por counsel legal con OK
- [ ] Plantilla SB recibida de Mike (o decisión de ship sin PDF SB)

Firma del responsable de QA: ____________________  Fecha: __________
Firma de Mike (Studio X): ____________________  Fecha: __________
