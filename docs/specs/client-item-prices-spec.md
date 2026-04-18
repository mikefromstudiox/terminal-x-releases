# Client-Item Prices — Implementation Spec

**Status:** Ready to ship
**Target:** Liquor store go-live Monday 2026-04-20
**Author:** dataLEAKS
**Scope:** Per-client custom pricing for inventory items (and optional services).

---

## 1. Context & Pattern Reuse

The codebase **already has** `client_service_rates` (services per-client pricing, added v2.6). This spec mirrors that exact pattern for inventory items, naming the new table `client_item_prices`. Reusing the proven structure eliminates design risk and gives the coding agent a copy-paste template (see `electron/database.js` lines 691-704 and 5418-5456, plus the `client_service_rates` entries in `electron/sync.js`).

**Design principle:** one table, inventory-only. Services already have `client_service_rates` — do NOT overload the new table to hold both. Ambiguous `(service_supabase_id OR inventory_item_supabase_id)` rows cause nightmare CHECK constraints and query branching. Keep them split.

---

## 2. SQLite DDL

Add to `electron/database.js` inside the ordered migration array (same block as `client_service_rates`, immediately after it around line 704):

```sql
CREATE TABLE IF NOT EXISTS client_item_prices (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id                TEXT,
  client_id                  INTEGER REFERENCES clients(id),
  client_supabase_id         TEXT NOT NULL,
  inventory_item_id          INTEGER REFERENCES inventory_items(id),
  inventory_item_supabase_id TEXT NOT NULL,
  custom_price               REAL NOT NULL,
  notes                      TEXT,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cip_supabase_id
  ON client_item_prices(supabase_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cip_client_item
  ON client_item_prices(client_supabase_id, inventory_item_supabase_id);
CREATE INDEX IF NOT EXISTS idx_cip_client
  ON client_item_prices(client_supabase_id);
```

Also add to `db/schema.sql` for fresh-install parity (insert next to the other v2.x tables):

```sql
CREATE TABLE IF NOT EXISTS client_item_prices (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id                TEXT,
  client_id                  INTEGER REFERENCES clients(id),
  client_supabase_id         TEXT NOT NULL,
  inventory_item_id          INTEGER REFERENCES inventory_items(id),
  inventory_item_supabase_id TEXT NOT NULL,
  custom_price               REAL NOT NULL,
  notes                      TEXT,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
```

SQLite trigger for `updated_at` (append with other such triggers in the init block):

```sql
CREATE TRIGGER IF NOT EXISTS trg_cip_updated_at
AFTER UPDATE ON client_item_prices
FOR EACH ROW BEGIN
  UPDATE client_item_prices SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```

---

## 3. Supabase Migration SQL

Single-line-per-statement, copy-paste ready (run in Supabase SQL editor):

```sql
CREATE TABLE IF NOT EXISTS public.client_item_prices ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supabase_id uuid NOT NULL DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE, client_supabase_id uuid NOT NULL, inventory_item_supabase_id uuid NOT NULL, custom_price numeric(14,2) NOT NULL, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
ALTER TABLE public.client_item_prices ADD CONSTRAINT client_item_prices_business_supabase_id_key UNIQUE (business_id, supabase_id);
ALTER TABLE public.client_item_prices ADD CONSTRAINT client_item_prices_biz_client_item_key UNIQUE (business_id, client_supabase_id, inventory_item_supabase_id);
CREATE INDEX IF NOT EXISTS idx_cip_biz_client ON public.client_item_prices(business_id, client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_cip_biz_item   ON public.client_item_prices(business_id, inventory_item_supabase_id);
CREATE INDEX IF NOT EXISTS idx_cip_updated_at ON public.client_item_prices(updated_at);
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cip_updated_at ON public.client_item_prices;
CREATE TRIGGER trg_cip_updated_at BEFORE UPDATE ON public.client_item_prices FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.client_item_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cip_anon_select ON public.client_item_prices;
CREATE POLICY cip_anon_select ON public.client_item_prices FOR SELECT TO anon, authenticated USING (business_id IS NOT NULL);
DROP POLICY IF EXISTS cip_anon_insert ON public.client_item_prices;
CREATE POLICY cip_anon_insert ON public.client_item_prices FOR INSERT TO anon, authenticated WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS cip_anon_update ON public.client_item_prices;
CREATE POLICY cip_anon_update ON public.client_item_prices FOR UPDATE TO anon, authenticated USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS cip_anon_delete ON public.client_item_prices;
CREATE POLICY cip_anon_delete ON public.client_item_prices FOR DELETE TO anon, authenticated USING (business_id IS NOT NULL);
```

Function `public.tg_set_updated_at()` already exists in this DB — the `CREATE OR REPLACE` is idempotent and safe.

**Verification:** after running, `SELECT conname FROM pg_constraint WHERE conrelid = 'public.client_item_prices'::regclass;` must list **both** unique constraints. Partial indexes are explicitly rejected — the lessons from `feedback_supabase_unique_constraints` apply (PostgREST `on_conflict` needs real constraints).

---

## 4. sync.js Patch

### 4a. Push side (`SYNC_TABLES`, around line 204 — after `modificadores` or grouped with other "root entities")

```js
{
  name: 'client_item_prices',
  cols: r => ({
    supabase_id: r.supabase_id,
    client_supabase_id: r.client_supabase_id,
    inventory_item_supabase_id: r.inventory_item_supabase_id,
    custom_price: r.custom_price,
    notes: r.notes || null,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || null,
  }),
},
```

### 4b. Pull side (`PULL_TABLES`, add directly after the existing `client_service_rates` entry at line 1460-1462)

```js
{ name: 'client_item_prices', strategy: 'lww',
  cols: ['custom_price','notes','created_at','updated_at'],
  fkCols: { client_supabase_id: 'clients', inventory_item_supabase_id: 'inventory_items' } },
```

### 4c. `electron/sync.js` line ~2375 (table list for `ensureSupabaseIds`) — add `'client_item_prices'` if that helper lists tables needing supabase_id backfill. Verify by reading around line 2375; if present, append.

---

## 5. Files to Touch — UI Layer

| File | Purpose | Specific edits |
|---|---|---|
| `electron/database.js` | DDL + CRUD functions | Insert DDL block after line 704 (next to `client_service_rates`). Add 4 functions `clientItemPriceSet/List/Get/Delete` modeled on lines 5418-5456. |
| `electron/main.js` | IPC handlers | Add 4 handlers after line 1365 (mirror `clientRates:*`): `clientItemPrices:set`, `:list`, `:get`, `:delete`. |
| `electron/preload.js` | contextBridge | Add `clientItemPrices` namespace exposing the 4 methods. |
| `packages/data/electron.js` | API surface | Add `clientItemPrices: { set, list, get, delete }` proxying to `window.electronAPI.clientItemPrices.*`. |
| `packages/data/web.js` | Supabase API | Add `clientItemPrices` object mirroring `clientRates` at line 3758. Key difference: column is `inventory_item_supabase_id` and `upsert` uses `on_conflict='business_id,client_supabase_id,inventory_item_supabase_id'`. Every insert MUST set `supabase_id: crypto.randomUUID()` and `business_id: bid`. |
| `packages/ui/screens/POS.jsx` | RetailPOS grid price lookup | See section 6 below. |
| `packages/ui/admin/pages/ClientDetail.jsx` | Admin UI | Add new tab "Precios especiales" — table of rows (item picker + price + notes + delete), save/delete via `api.clientItemPrices.*`. Show base price + custom price + savings. Include "Importar CSV" button (optional Sunday scope). |
| `packages/ui/screens/Inventory.jsx` | Optional hook | Inline "Ver precios de cliente" on item row (nice-to-have, skip if time-pressed). |

### 6. RetailPOS price override — exact surgical edits in `packages/ui/screens/POS.jsx`

1. **Line 1606** — change call site to pass the selected client:
   ```jsx
   <ProductGrid api={api} lang={lang} gridCols={gridCols} onAdd={addToCart} client={selectedClient} />
   ```
2. **Line 1873** — update signature and fetch overrides:
   ```jsx
   function ProductGrid({ api, lang, gridCols, onAdd, client }) {
     const [products, setProducts] = useState([])
     const [overrides, setOverrides] = useState({}) // { [inventory_item_supabase_id]: custom_price }
     const [loading, setLoading] = useState(true)

     useEffect(() => {
       api.inventory?.all?.().then(items => { setProducts(items || []); setLoading(false) }).catch(() => setLoading(false))
     }, [api])

     useEffect(() => {
       if (!client?.id) { setOverrides({}); return }
       api.clientItemPrices?.list?.({ clientId: client.id }).then(rows => {
         const map = {}
         for (const r of (rows || [])) map[r.inventory_item_supabase_id] = Number(r.custom_price)
         setOverrides(map)
       }).catch(() => setOverrides({}))
     }, [api, client?.id])
     // ... existing render ...
   }
   ```
3. **Line 1916-1921** — apply override on render AND on add-to-cart:
   ```jsx
   const override = overrides[item.supabase_id]
   const effectivePrice = override != null ? override : item.price
   // pass effective price to onAdd
   <button ... onClick={() => onAdd({ ...item, price: effectivePrice, _basePrice: item.price, _clientPrice: override != null })}>
     ...
     <p className="text-[13px] font-bold text-[#b3001e] dark:text-blue-400">{fmtRD(effectivePrice)}</p>
     {override != null && <p className="text-[9px] text-green-600 line-through">{fmtRD(item.price)}</p>}
   ```
4. **Barcode/SKU search path** (find `lookupSku` in RetailPOS ~line 1050-1380) — apply the same override lookup before pushing to cart, otherwise scanning bypasses custom pricing.
5. **Client-change reprice** — when `selectedClient` changes (line 1050 state owner), loop `cart` and re-apply overrides/base prices based on `_basePrice`. Put this in a `useEffect([selectedClient?.id])` near line 1390. Ticket items that the cashier manually edited should be preserved — gate on `!item._priceEdited`.

---

## 7. Data-layer Functions

### `electron/database.js` (add after line 5456):

```js
function clientItemPriceSet({ client_id, inventory_item_id, custom_price, notes }) {
  if (!db) return null
  const csid = _svcResolveClientSid(client_id)
  const iisid = db.prepare('SELECT supabase_id FROM inventory_items WHERE id=?').get(inventory_item_id)?.supabase_id
  if (!csid || !iisid) return null
  const existing = db.prepare('SELECT id FROM client_item_prices WHERE client_supabase_id=? AND inventory_item_supabase_id=?').get(csid, iisid)
  if (existing) {
    db.prepare(`UPDATE client_item_prices SET custom_price=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .run(Number(custom_price) || 0, notes || null, existing.id)
    return db.prepare('SELECT * FROM client_item_prices WHERE id=?').get(existing.id)
  }
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO client_item_prices
    (supabase_id, client_id, client_supabase_id, inventory_item_id, inventory_item_supabase_id, custom_price, notes)
    VALUES(?,?,?,?,?,?,?)`).run(sid, client_id || null, csid, inventory_item_id || null, iisid, Number(custom_price) || 0, notes || null)
  return db.prepare('SELECT * FROM client_item_prices WHERE id=?').get(r.lastInsertRowid)
}
function clientItemPriceList({ clientId, itemId } = {}) {
  if (!db) return []
  let sql = `SELECT p.*, c.name AS client_name, i.name AS item_name, i.sku, i.price AS base_price
             FROM client_item_prices p
             LEFT JOIN clients c ON c.id = p.client_id
             LEFT JOIN inventory_items i ON i.id = p.inventory_item_id
             WHERE 1=1`
  const params = {}
  if (clientId) { sql += ' AND p.client_id=@cid'; params.cid = clientId }
  if (itemId)   { sql += ' AND p.inventory_item_id=@iid'; params.iid = itemId }
  sql += ' ORDER BY i.name'
  return db.prepare(sql).all(params)
}
function clientItemPriceGet({ clientId, itemId }) {
  if (!db || !clientId || !itemId) return null
  return db.prepare('SELECT * FROM client_item_prices WHERE client_id=? AND inventory_item_id=?').get(clientId, itemId)
}
function clientItemPriceDelete(id) {
  if (!db) return
  db.prepare('DELETE FROM client_item_prices WHERE id=?').run(id)
}
// Bulk CSV import: rows = [{ client_rnc_or_id, sku_or_barcode, custom_price, notes }]
function clientItemPriceBulkImport(rows) {
  if (!db || !Array.isArray(rows)) return { ok: 0, skip: 0, errors: [] }
  const stmt = db.transaction((list) => {
    const out = { ok: 0, skip: 0, errors: [] }
    for (const r of list) {
      try {
        const client = db.prepare('SELECT id FROM clients WHERE rnc=? OR id=?').get(String(r.client || ''), Number(r.client) || 0)
        const item   = db.prepare('SELECT id FROM inventory_items WHERE sku=? OR barcode=?').get(String(r.sku || ''), String(r.sku || ''))
        if (!client || !item) { out.skip++; continue }
        clientItemPriceSet({ client_id: client.id, inventory_item_id: item.id, custom_price: r.custom_price, notes: r.notes })
        out.ok++
      } catch (e) { out.errors.push({ row: r, err: String(e) }) }
    }
    return out
  })
  return stmt(rows)
}
```

Export them in the module.exports block at bottom of `database.js`.

### `packages/data/web.js` (add after `clientRates` block at line ~3758):

```js
clientItemPrices: {
  async list({ clientId } = {}) {
    const bid = await getBusinessId(); if (!bid) return []
    let q = supabase.from('client_item_prices').select('*, inventory_items(name,sku,price), clients(name)').eq('business_id', bid)
    if (clientId) q = q.eq('client_supabase_id', clientId)
    return tryOr(() => q.order('created_at', { ascending: false }), [])
  },
  async get({ clientId, itemId }) {
    const bid = await getBusinessId(); if (!bid) return null
    const row = throwSupaError(await supabase.from('client_item_prices')
      .select('*').eq('business_id', bid)
      .eq('client_supabase_id', clientId)
      .eq('inventory_item_supabase_id', itemId).maybeSingle())
    return row
  },
  async set({ client_supabase_id, inventory_item_supabase_id, custom_price, notes }) {
    const bid = await getBusinessId()
    const existing = await supabase.from('client_item_prices').select('id')
      .eq('business_id', bid).eq('client_supabase_id', client_supabase_id)
      .eq('inventory_item_supabase_id', inventory_item_supabase_id).maybeSingle()
    if (existing?.data?.id) {
      throwSupaError(await supabase.from('client_item_prices').update({
        custom_price: Number(custom_price) || 0, notes: notes || null, updated_at: new Date().toISOString()
      }).eq('id', existing.data.id))
      return existing.data.id
    }
    const row = throwSupaError(await supabase.from('client_item_prices').insert({
      supabase_id: crypto.randomUUID(), business_id: bid,
      client_supabase_id, inventory_item_supabase_id,
      custom_price: Number(custom_price) || 0, notes: notes || null,
    }).select().single())
    return row?.id
  },
  async delete(id) {
    const bid = await getBusinessId()
    throwSupaError(await supabase.from('client_item_prices').delete().eq('id', id).eq('business_id', bid))
    return true
  },
},
```

Web-side signature uses `*_supabase_id` (web has no integer IDs). Electron wrapper in `packages/data/electron.js` should translate `clientId` → integer; web caller must pass UUIDs. Keep both shapes documented on the API object or normalize in the UI layer.

---

## 8. CSV Import Path (Bonus)

Format (same dialect as the inventory importer already in `Inventory.jsx`):

```
client_rnc,sku,custom_price,notes
130123456,BRUGAL-750,650,Mayorista Zona Este
130123456,PRESIDENTE-12,780,
```

- Client matched on `rnc` (preferred) or `id`.
- Item matched on `sku` or `barcode`.
- UI: in `ClientDetail.jsx` "Precios especiales" tab — "Importar CSV" button. Route through IPC `clientItemPrices:bulkImport`.
- Skip rows with no match, show summary `{ok,skip,errors}`.
- Web: Papa-parse on client side, call `set` in a loop (≤100 rows is fine; larger needs batching).

---

## 9. Edge Cases — MUST HANDLE BEFORE SHIP

1. **ITBIS recalc.** `inventory_items.aplica_itbis` stays the source of truth; the override only touches the gross price. Confirm `CobrarModal` / POS total recompute uses `item.price * item.quantity` post-override — walk through `POS.jsx` totals block.
2. **Combination with existing discount.** Two stacking paths:
   - `users.discount_pct` (manager discount) applied on checkout.
   - `clients.credit_limit`/loyalty (if any % off is configured).
   **Decision required:** cheapest-wins or stack? Recommendation: apply custom price FIRST, then apply `discount_pct` on top (multiplicative). Document on the "Precios especiales" tab UI: *"El descuento del cajero se aplica sobre el precio especial."*
3. **e-CF line pricing.** `xml-builder.js` reads `ticket_items.price`. Because we substitute the price at add-to-cart time, the e-CF already receives the custom price — no changes needed. **Verify** with a test E31 submission. ITBIS line total (`MontoItbis`) recalculates from the line's gross price × rate — already correct.
4. **Commission base.** `washer_commissions`/`seller_commissions`/`cajero_commissions` compute off `tickets.subtotal` (gross). Using the custom price as the ticket subtotal means commission base is reduced — that is correct and desired (they earn on the revenue actually collected). Flag this in training: *mayoristas produce lower commission because the ticket total is lower.* If owner wants commission pegged to list price, add a future flag — out of scope Sunday.
5. **Cost margin / profit reports.** `inventory_items.cost` stays constant. Products report uses `price - cost` per line — it will correctly reflect reduced margin on mayorista sales. No code change.
6. **Credit notes (NCF).** If a ticket is voided/credit-noted, `notas_credito.amount` already comes from the ticket total — no surprise.
7. **Manual price edit in cart.** Cashier typing a new unit price should override the custom price; guard the client-change reprice effect on `!item._priceEdited`.
8. **Price <= 0.** Block in `clientItemPriceSet` with `if (Number(custom_price) <= 0) return null` — DR never sells below cost on purpose, and 0 would let them silently give free product.
9. **Inactive client / inactive item.** `list()` should still return the row (so admin can fix/delete), but POS must NOT apply override if `client.active === 0` or `item.active === 0`. Filter in `ProductGrid` useEffect.
10. **Client switches mid-cart.** Trigger the reprice effect. If the new client has no override for an already-added item, revert to `_basePrice`.
11. **RetailPOS only (not CarWashPOS).** Services grid (CarWashPOS) has its own flow and `client_service_rates` already covers it. Do NOT wire `client_item_prices` into CarWash.
12. **Hybrid tickets.** In hybrid mode a cart can hold services + inventory items. Apply `client_service_rates` to services AND `client_item_prices` to inventory — both on client-change.
13. **Web multi-device sync.** A price set on the web within the same business must appear on desktop on next pull. Pull is LWW on `updated_at` — correct.
14. **Deletion.** Deleting a row on desktop must propagate. Sync module supports soft-delete via `active=0` on most tables; `client_item_prices` has no `active` column here. Two options: (a) keep hard-delete only (simpler, fine for v1) or (b) add `active INTEGER DEFAULT 1` and soft-delete. **Recommend (a)** for Sunday — hard deletes flow as "not present in remote list" on next full pull (we rely on Supabase delete). Long-term this is a sync weakness across the codebase; track separately.
15. **Negative stock / out-of-stock.** Custom price does NOT unlock out-of-stock sales. Stock check stays ahead of price logic.
16. **Barcode scan bypass.** Already called out in Section 6.4 — the SKU/barcode path is a separate branch from the grid `onClick` and must also apply overrides.

---

## 10. Complexity & Risk Estimate

| Area | LOC | Risk |
|---|---|---|
| SQLite DDL (schema.sql + database.js migration) | ~25 | Low — mirror of existing table |
| Supabase migration (SQL) | ~20 | Low — idempotent, tested pattern |
| `electron/database.js` CRUD + bulk import | ~90 | Low |
| `electron/main.js` IPC handlers | ~6 | Low |
| `electron/preload.js` bridge | ~8 | Low |
| `packages/data/electron.js` + `web.js` | ~70 | Medium — web path needs supabase_id handling |
| `electron/sync.js` patches | ~20 | Low |
| RetailPOS ProductGrid + reprice effect + SKU-scan path | ~60 | **Medium** — mid-cart client change is the trickiest bit |
| ClientDetail.jsx "Precios especiales" tab | ~180 | Medium — new UI surface |
| CSV import UI + parser | ~80 | Low |
| **Total** | **~560 LOC** | **Medium overall** |

**Ship checklist:**
- [ ] Supabase migration applied and both UNIQUE constraints verified
- [ ] Desktop migration hits on upgrade (v2.2.x → v2.3.0)
- [ ] Sync push + pull round-trip tested: set price on desktop → appears in Supabase → pull on second device
- [ ] RetailPOS: client selected → grid prices update → add to cart → voucher correct → e-CF test submission OK
- [ ] Client switch mid-cart re-prices items
- [ ] Barcode scan applies override
- [ ] Manager discount stacks AFTER custom price (confirm total)
- [ ] CSV import smoke test
- [ ] Hard-delete row syncs to cloud

**Suggested version bump:** v2.3.0 (new synced table + new UI tab).

---

## 11. Coding Agent One-Shot Handoff

Hand this file plus the memory entries:
- `feedback_supabase_id_architecture.md`
- `feedback_supabase_unique_constraints.md`
- `project_activity_log_rls_fix.md`
- `feedback_supabase_schema_parity.md`

Coding agent should:
1. Apply Section 3 SQL in Supabase first (blocks everything downstream).
2. Implement Section 2 + 7 (data layer).
3. Implement Section 4 (sync).
4. Implement Section 6 (POS).
5. Implement Section 5's ClientDetail tab.
6. Validate with the checklist in Section 10.
