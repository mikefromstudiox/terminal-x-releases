# Terminal X — Troubleshooting Cheat Sheet

**Living document.** Every new bug we hit on our own POS or at a client site gets added here so next time it takes 30 seconds instead of 2 hours to diagnose.

Ordered roughly by how often the issue comes up. If a symptom matches, follow the check steps top-to-bottom.

---

## Where to find the logs

**Windows (installed):** `%APPDATA%\terminal-x\logs\main.log`
**Windows alt path:** `C:\Users\<username>\AppData\Roaming\terminal-x\logs\main.log`
**Dev mode:** prints to the terminal where `npm run dev` is running

The log captures the auto-updater AND (since v1.9.11) the sync module. Everything we ever care about is in there.

**To send a client's log to support:** ask them to press `Windows + R`, paste `%APPDATA%\terminal-x\logs\`, hit Enter, attach `main.log` to the WhatsApp chat.

---

## 1. "Sync isn't working" / "My data isn't showing up on the other device"

This is the most common issue. Follow in order — each step takes 10 seconds and rules out a specific cause.

### Quick triage (30-second version)

**Step 0 — "what color is the light?"** Have the client open **Config → Mi Empresa → Respaldo / Nube**. There's a dot at the top of the card:

| Light | Meaning | Next step |
|---|---|---|
| 🟢 **Green** — "Conectado a la nube" | Main process reached Supabase with the bundled credentials. Sync pipeline is healthy. The issue is almost certainly either a UI filter hiding the row OR a per-table pull/push error. | Go to step 2 below. |
| 🔴 **Red** — "Sin conexión" | Network or credential problem. Main process cannot reach Supabase at all. | Check their internet (try loading google.com in a browser). If internet works, read the red-text error next to the light — it'll say HTTP status code or DNS error. If it mentions 401 or 403, the hardcoded anon key was revoked server-side and you need to rotate it (rare). |
| 🔵 **Blue pulse** — "Verificando…" | Test is in progress. Wait 2 seconds. | If it never resolves, the HTTPS request hung — firewall blocking Supabase. Check corporate/restrictive network. |
| ⚪ **Gray** — "Sin verificar" | Auto-test didn't fire. | Click "Probar conexión" manually. |

If the light is **🟢 green** but sync still isn't working, continue below.

### Deeper triage

1. **Click the 🔄 Sincronizar button** in the sidebar footer on the desktop (next to sun/moon and logout icons). Does the tooltip show `"N enviados, M recibidos"` with non-zero numbers?
   - ✅ Non-zero → sync is alive, the specific data is probably hiding under a category filter. Check the Admin screen's tab tabs, not just "Todos".
   - ❌ `0 enviados, 0 recibidos` → go to step 2.
   - ❌ `Error de sync` → the tooltip text IS the error. Screenshot it.

2. **Open main.log** and scroll to the most recent `(sync)` lines. Look for these specific strings in order:

| Log line | Means | Fix |
|---|---|---|
| `[sync] No URL or key — url: true key: false` | Supabase credentials missing. Shouldn't happen in ≥v1.9.12 but worth double-checking. | Reinstall from current installer. |
| `[sync] No business_id found` | Desktop can't resolve its tenant. License activation might be incomplete. | Check `%APPDATA%\terminal-x\hwid.json` exists. Re-validate the license from Sistema → Licencias TX. |
| `duplicate key value violates unique constraint "uq_*_sid"` | Supabase has partial indexes instead of real UNIQUE constraints on a NEW table. | Run the constraint migration (see §7 below). Won't happen on existing tables — all 21 were fixed 2026-04-11. |
| `SQLite3 can only bind numbers, strings, bigints, buffers, and null` | Pull fetched a row with a JS type SQLite rejects (usually a boolean). | Report to me with the table name from the log line. Add coercion to `sqliteValue()` in `electron/sync.js`. |
| `no such column: <col>` | Pull cols list in `sync.js::PULL_TABLES` references a column that doesn't exist in local SQLite. | Remove the column from the pull cols, OR add the column via `db/schema.sql` migration. |
| `null value in column "updated_at" of relation "<table>" violates not-null constraint` | Old local row has null `updated_at`. Should be auto-fixed by the push-side coalesce in ≥v1.9.13. | Report version — might need to re-ship the coalesce fix. |
| `[sync] Starting sync for business: <uuid>` followed by `Complete — 0 rows pushed, 0 rows pulled` repeatedly | Sync is running successfully but has nothing to push/pull. Legitimate empty sync. | Not a bug. If data exists on Supabase that should be coming down, check the **pull cursor**: see §2 below. |

3. **If none of the above match** and sync logs look clean, it's probably a UI filter hiding the row, not a sync bug. Check:
   - Admin → Servicios → click each category tab (Lavado, Bebidas, etc.) not just "Todos"
   - Empleados → filter tabs at top (Lavadores, Vendedores, Cajeros, Todos)
   - Clients with `active: false` won't show in the main list

---

## 2. "Row exists on Supabase but won't pull to desktop" (stranded row)

If one specific row is stuck but everything else syncs fine, it's the **pull cursor stranded-row bug**. Fixed in v1.9.14 by changing `gt` → `gte` in the cursor filter, but if a desktop is on ≤v1.9.13 it can still hit this.

### Symptom
- A row visible in Supabase Studio, missing from local SQLite
- Sync runs cleanly with no errors
- Other newer rows in the same table pull fine

### Root cause
The pull cursor is an `updated_at` timestamp. If the target row's `updated_at` equals the cursor AND the desktop is on v1.9.13 or older (`gt.<cursor>` filter), the row is strictly excluded forever.

### Fix
**Option A — Bump updated_at on Supabase** (unblocks immediately):
```bash
curl -X PATCH "https://csppjsoirjflumaiipqw.supabase.co/rest/v1/<table>?supabase_id=eq.<uuid>" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```
Client hits 🔄 Sincronizar, row appears.

**Option B — Upgrade the client** to ≥v1.9.14 which uses `gte.<cursor>` and can never strand rows.

---

## 3. "Auto-updater isn't working" / "Client can't update"

### Symptom
- Desktop stuck on old version
- `Cannot download "https://github.com/...".exe", status 404` in main.log

### Root cause
Historical: `artifactName` in `package.json` used `${productName}` which resolved to "Terminal.X" (dot) for the uploaded .exe but "Terminal-X" (dash) in `latest.yml`. Filename mismatch → 404. Fixed in v1.9.10 by hardcoding `artifactName: "Terminal.X-Setup-${version}.${ext}"`.

### Verify a release is healthy
```bash
# All three must return 200:
curl -sI -L -o /dev/null -w "yml:%{http_code}\n" \
  "https://github.com/mikefromstudiox/terminal-x-releases/releases/download/v<X.Y.Z>/latest.yml"
curl -sI -L -o /dev/null -w "exe:%{http_code}\n" \
  "https://github.com/mikefromstudiox/terminal-x-releases/releases/download/v<X.Y.Z>/Terminal.X-Setup-<X.Y.Z>.exe"
curl -sI -L -o /dev/null -w "bmap:%{http_code}\n" \
  "https://github.com/mikefromstudiox/terminal-x-releases/releases/download/v<X.Y.Z>/Terminal.X-Setup-<X.Y.Z>.exe.blockmap"
```

Also: **every release MUST include all three assets** — `.exe`, `.exe.blockmap`, `latest.yml`. Missing any of them silently breaks auto-update for all clients.

---

## 4. "ESC → Salir doesn't close the app"

Fixed in v1.9.10. If a client on an older version reports this: upgrade them. Root cause was `closable: false` at BrowserWindow construction blocking programmatic close.

---

## 5. "Mobile website looks zoomed in" / "Have to pinch-zoom to fit"

Fixed in v1.9.10 web deploy. If a client reports this on mobile: tell them to hard-refresh the page (pull down to reload on iOS Safari). Root cause was the iOS auto-zoom-on-input bug — any form input with `font-size < 16px` triggers iOS to zoom in and never zoom back out. Fix: `@media (max-width: 768px)` forces inputs to 16px in `packages/ui/index.css`.

---

## 6. "Service/user added on web isn't appearing on desktop"

### If the row is RECENT (added after Apr 11, 2026 on web/mobile PWA)
Should just work. Check §1 (general sync triage).

### If the row is OLD (added before Apr 11, 2026)
Its `supabase_id` might be NULL in Supabase, which makes it invisible to desktop pull (the filter is `supabase_id=not.is.null`). Fix:

```bash
# 1. Check for null supabase_id rows per table:
SR_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env | cut -d'=' -f2-)
for t in services clients washers sellers empleados users staff inventory_items categorias_servicio; do
  cnt=$(curl -s "https://csppjsoirjflumaiipqw.supabase.co/rest/v1/$t?select=id&supabase_id=is.null&limit=50" \
    -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" | grep -o '"id"' | wc -l)
  echo "$t: $cnt null rows"
done

# 2. Backfill them:
for r in <row-id-1> <row-id-2>; do
  SID=$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')
  curl -s -X PATCH "https://csppjsoirjflumaiipqw.supabase.co/rest/v1/<table>?id=eq.$r" \
    -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d "{\"supabase_id\":\"$SID\"}"
done
```

---

## 7. "I added a new synced table — sync doesn't work for it"

### Required steps when adding a new table to `PULL_TABLES` / `SYNC_TABLES`:

1. **Create a real UNIQUE constraint on Supabase** (NOT a partial index). Run via Supabase Management API:
   ```bash
   AT=$(grep "^SUPABASE_ACCESS_TOKEN=" .env | cut -d'=' -f2-)
   curl -X POST "https://api.supabase.com/v1/projects/csppjsoirjflumaiipqw/database/query" \
     -H "Authorization: Bearer $AT" -H "Content-Type: application/json" \
     -d '{"query":"
       UPDATE <new_table> SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
       ALTER TABLE <new_table> ALTER COLUMN supabase_id SET NOT NULL;
       ALTER TABLE <new_table> ALTER COLUMN supabase_id SET DEFAULT gen_random_uuid();
       ALTER TABLE <new_table> ADD CONSTRAINT uq_<new_table>_sid UNIQUE (business_id, supabase_id);
     "}'
   ```

2. **Audit the pull cols against the LOCAL SQLite schema** (`db/schema.sql`). If the local table doesn't have `created_at`, don't include `created_at` in pull cols. If it doesn't have `updated_at`, add it via an ALTER migration in `database.js`.

3. **Make sure web.js inserts set `supabase_id: crypto.randomUUID()`** for that table too, or web-created rows will be invisible to pull.

4. **Build + test a full push-pull cycle** before shipping. Start the desktop, log in, create a row on web, wait 5 min, confirm it appears on desktop. Then create a row on desktop, wait 5 min, confirm it appears on web.

---

## 8. "DGII e-CF submission failing"

### Symptom
- "Error al enviar" toast on cobrar
- DGII.jsx shows queue with failed submissions

### Triage
1. **Check cert status** — Sistema → Cert section. Is it installed? Expired?
2. **Test connection** — Admin → DGII tab → "Test Conexión" button. Should return 200 OK.
3. **Check environment** — `certecf` (cert env) vs `ecf` (prod). Client should be on `ecf` for real invoicing.
4. **Retry offline queue** — it auto-retries every 30s, or click "Retry queue" in DGII.jsx. Rebuilds XML with `IndicadorEnvioDiferido=1` and re-submits.
5. **Check main.log** for DGII-specific errors. Common:
   - `401 Unauthorized` — cert not loaded, re-install .p12
   - `400 Bad Request` on `/recepcion` — malformed XML, check xml-builder.js output
   - Timeout errors — DGII API is slow/down, retry later

### DGII sequence offsets
Sequences can be checked via Admin → DGII. Current safe starting point is ~1900+ (consumed up to ~1800 during certification).

---

## 9. "License validation failing"

### Symptom
- LicenseGate shows "Licencia inválida" on boot
- Client just installed and can't open POS

### Triage
1. **Check the license key format** — must be `TXL-XXXX-XXXX-XXXX`
2. **Check hardware binding** — license may be bound to a different HWID. Use admin panel → Licenses → <license> → "Reset HWID".
3. **Check online status** — first-time activation REQUIRES internet. 72h offline grace only works AFTER one successful online validation.
4. **Check license status** in admin panel:
   - `pending` → not activated yet, needs admin approval
   - `suspended` → manually suspended, re-activate from admin panel
   - `expired` → past `expires_at`, renew

5. **Master key backdoor** — if a client is completely locked out, set `MASTER_LICENSE_KEY` env var in Windows and restart. Gives a provisional "setup mode" so they can at least reach the app and apply a real license.

---

## 10. "Printer not printing" / "Receipts blank"

### Triage
1. **Check USB printer connection** — Settings → Impresión → "Listar impresoras USB"
2. **Printer name mismatch** — Windows driver may rename the device. Check the exact name in Windows "Devices and Printers" matches what's set in Terminal X.
3. **Code Page / encoding** — if Spanish characters (ñ, á) print as garbage, verify ESC/POS charset is 858.
4. **Cash drawer not opening** — check that the payment method is `efectivo`. Drawer only fires on cash. Card/transfer/credit do not open the drawer.
5. **Test drawer variants** — Settings → Impresión → "Test Drawer Variants" tries all the common ESC/POS drawer commands.

---

## 11. "Backup / export to Supabase failing"

1. Check `sync_log` table in local SQLite — shows per-table last sync status and any errors.
2. The `sync_log.error` column has the most recent Supabase error message per table.
3. Manual push-only: Sistema → Backup → "Export to Supabase" button.

---

## 12. Database corruption / schema mismatch

### Symptom
- `no such table` errors
- `database disk image is malformed`
- App boots but all screens show "Loading..." forever

### Nuclear option (DATA LOSS WARNING)
1. Close the app
2. Rename `%APPDATA%\terminal-x\terminal-x.db` to `terminal-x.db.bak`
3. Open the app — it'll recreate the DB fresh
4. Re-import data from a recent Supabase pull (the sync will auto-repopulate)

### Recovery (preserve local data)
1. Copy `terminal-x.db` somewhere safe
2. Use DB Browser for SQLite to inspect corrupted tables
3. `REINDEX` and `VACUUM` to rebuild indexes
4. If a specific table is broken, `DROP` + re-create from schema.sql

---

## Support contact

- **Mike (you):** WhatsApp +1-809-828-2971
- **Studio X Tech:** studioxrdtech.com/ecf-certification
- **GitHub issues:** github.com/mikefromstudiox/terminal-x-releases/issues (for release download problems)

---

## Known safe "not bugs"

These look like errors but are expected behavior — don't waste time debugging them:

- `electron-updater` logs `"Update for version X.Y.Z is not available (latest version: X.Y.Z, downgrade is disallowed)"` — means the client is already on the latest. Good.
- `[sync] Complete — 0 rows pushed, 0 rows pulled` when nothing has changed — sync cycle ran, nothing to do. Good.
- `disableWebInstaller is set to false` warning — electron-updater quirk, harmless.
- `services: re-synced N updated rows` on every push cycle — LWW re-push after pull wrote new updated_at back to local. Slightly wasteful but correct.
- "Cannot download differentially, fallback to full download" — delta patching failed, doing a full re-download. Annoying but works.

---

## Change log for this doc

- **2026-04-11** — Initial draft, covers the debugging arc from v1.9.9 → v1.9.14 (13 bugs resolved in one session). Baseline sections 1–12.
- **2026-04-11 (later)** — Added the 🟢/🔴/🔵/⚪ **"what color is the light?" diagnostic** as Step 0 of §1. Added v1.9.15 (servicio tipo) + v1.9.16 (Respaldo/Nube read-only health check) context. The traffic-light triage is now the first question on any sync support ticket.
