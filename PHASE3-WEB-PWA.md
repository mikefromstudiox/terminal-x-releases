# Phase 3 — Terminal X Web/PWA Architecture Plan

Target: Start Q3 2026, live Q1 2027

---

## 1. Architecture Overview

```
                    +---------------------------+
                    |     Supabase Cloud         |
                    |  +---------------------+   |
                    |  | PostgreSQL (RLS)     |   |
                    |  | Auth (email/OTP)     |   |
                    |  | Edge Functions       |   |
                    |  |  - ef2.do proxy      |   |
                    |  |  - RNC lookup proxy  |   |
                    |  |  - license validate  |   |
                    |  | Storage (backups)    |   |
                    |  +---------------------+   |
                    +-------------|-------------+
                                  |
                    HTTPS / supabase-js / realtime
                                  |
          +--------------------------------------------+
          |                                            |
  +-------|--------+                        +----------|--------+
  | Web/PWA Client |                        | Electron Client   |
  | (Browser)      |                        | (Desktop — stays) |
  |                |                        |                   |
  | React + Vite   |                        | React + Vite      |
  | Supabase SDK   |                        | better-sqlite3    |
  | IndexedDB      |                        | IPC bridge        |
  | (offline queue)|                        | (existing arch)   |
  | Service Worker |                        |                   |
  | qz-tray / PDF  |                        | ESC/POS direct    |
  +----------------+                        +-------------------+
```

**Key principle**: The React UI layer (screens, components) is shared. Only the **data layer** (hooks/services) gets swapped depending on platform.

---

## 2. Monorepo Folder Structure

```
terminal-x/
├── packages/
│   ├── shared/                    # Shared React code (the bulk of the app)
│   │   ├── components/            # CobrarModal, Sidebar, Layout, etc.
│   │   ├── screens/               # POS, Queue, Clients, Credits, Admin, etc.
│   │   ├── context/               # AuthContext, LayoutContext, BackupContext
│   │   ├── i18n/                  # es.js, en.js
│   │   ├── services/
│   │   │   ├── printer.js         # ESC/POS buffer builders (shared logic)
│   │   │   ├── pdf.js             # pdf-lib receipt generation
│   │   │   └── ecf-types.js       # ECF_TYPES, BUSINESS_TYPES, validators
│   │   └── utils/                 # fmtRD, fmtDate, normalizePhone, etc.
│   │
│   ├── data-electron/             # Electron-specific data layer
│   │   ├── hooks/                 # useDB.js, useRNC.js (IPC-based)
│   │   ├── services/
│   │   │   ├── ecf.js             # signAndSubmitECF via IPC
│   │   │   ├── license.js         # HWID-based license
│   │   │   ├── backup.js          # Supabase backup
│   │   │   └── supabase.js        # fire-and-forget sync
│   │   └── index.js               # re-exports all hooks/services
│   │
│   ├── data-web/                  # Web/PWA-specific data layer
│   │   ├── hooks/                 # useDB.js (Supabase queries), useRNC.js (edge fn)
│   │   ├── services/
│   │   │   ├── ecf.js             # signAndSubmitECF via Edge Function
│   │   │   ├── license.js         # user-based subscription (Supabase)
│   │   │   ├── offline-queue.js   # IndexedDB queue + sync
│   │   │   └── print-web.js       # qz-tray + PDF fallback
│   │   ├── sw.js                  # Service worker
│   │   └── index.js               # re-exports all hooks/services
│   │
│   └── ui-kit/                    # (optional) extracted Tailwind components
│
├── apps/
│   ├── desktop/                   # Current Electron app
│   │   ├── electron/              # main.js, preload.js, database.js
│   │   ├── src/
│   │   │   ├── App.jsx            # Electron App shell (imports from shared + data-electron)
│   │   │   └── main.jsx           # Vite entry
│   │   ├── package.json
│   │   └── vite.config.js
│   │
│   └── web/                       # New PWA app
│       ├── src/
│       │   ├── App.jsx            # Web App shell (imports from shared + data-web)
│       │   ├── main.jsx           # Vite entry + SW registration
│       │   └── DataProvider.jsx   # Provides Supabase client + auth to shared components
│       ├── public/
│       │   ├── manifest.json
│       │   └── sw.js
│       ├── supabase/
│       │   ├── migrations/        # PostgreSQL schema
│       │   └── functions/         # Edge Functions (ef2-proxy, rnc-lookup, etc.)
│       ├── package.json
│       └── vite.config.js
│
├── package.json                   # Workspace root (npm workspaces or pnpm)
└── turbo.json                     # (optional) Turborepo config
```

---

## 3. The Abstraction Layer — Platform-Agnostic Hooks

The entire app currently calls `window.electronAPI.*`. The migration strategy is to wrap this behind a **DataProvider** pattern so components don't care whether they're on Electron or Web.

### 3a. Shared hook interface (`packages/shared/hooks/useData.js`)

```js
import { createContext, useContext } from 'react'

// Every platform (Electron, Web) provides this shape
const DataContext = createContext(null)

export const DataProvider = DataContext.Provider

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be inside DataProvider')
  return ctx
}

// Convenience aliases
export function useServices()  { return useData().services }
export function useClients()   { return useData().clients }
export function useTickets(p)  { return useData().tickets(p) }
export function useQueue()     { return useData().queue }
export function useSettings()  { return useData().settings }
export function useECF()       { return useData().ecf }
export function usePrinter()   { return useData().printer }
```

### 3b. Electron data provider (`packages/data-electron/index.js`)

```js
// Wraps existing window.electronAPI calls — minimal change from current code
export function createElectronDataLayer() {
  return {
    services: {
      all:    () => window.electronAPI.services.all(),
      create: (d) => window.electronAPI.services.create(d),
      update: (d) => window.electronAPI.services.update(d),
    },
    clients: {
      all:    () => window.electronAPI.clients.all(),
      byId:   (id) => window.electronAPI.clients.byId(id),
      create: (d) => window.electronAPI.clients.create(d),
      update: (d) => window.electronAPI.clients.update(d),
    },
    tickets: {
      all:    (p) => window.electronAPI.tickets.all(p),
      create: (d) => window.electronAPI.tickets.create(d),
      markPaid: (d) => window.electronAPI.tickets.markPaid(d),
    },
    queue: {
      active: () => window.electronAPI.queue.active(),
      updateStatus: (d) => window.electronAPI.queue.updateStatus(d),
    },
    ecf: {
      submit: (d) => signAndSubmitECF(d),  // existing ecf.js
      queueCount: () => window.electronAPI.ecf.queueCount(),
    },
    printer: {
      print:      (buf) => window.electronAPI.print(buf),
      openDrawer: ()    => window.printerAPI.openDrawer(),
    },
    settings: {
      get:    () => window.electronAPI.settings.get(),
      update: (o) => window.electronAPI.settings.update(o),
    },
    auth: {
      byPin: (pin) => window.electronAPI.auth.byPin(pin),
    },
    // ... rest of IPC channels
  }
}
```

### 3c. Web data provider (`packages/data-web/index.js`)

```js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export { supabase }

export function createWebDataLayer(supabase, businessId) {
  return {
    services: {
      all: async () => {
        const { data, error } = await supabase
          .from('services')
          .select('*')
          .eq('business_id', businessId)
          .order('sort_order')
        if (error) throw error
        return data
      },
      create: async (d) => {
        const { data, error } = await supabase
          .from('services')
          .insert({ ...d, business_id: businessId })
          .select()
          .single()
        if (error) throw error
        return data
      },
      update: async (d) => {
        const { data, error } = await supabase
          .from('services')
          .update(d)
          .eq('id', d.id)
          .eq('business_id', businessId)
          .select()
          .single()
        if (error) throw error
        return data
      },
    },

    clients: {
      all: async () => {
        const { data } = await supabase
          .from('clients')
          .select('*')
          .eq('business_id', businessId)
          .order('name')
        return data || []
      },
      // ... same pattern
    },

    tickets: {
      create: async (d) => {
        const { data, error } = await supabase
          .from('tickets')
          .insert({ ...d, business_id: businessId })
          .select()
          .single()
        if (error) throw error
        // Also insert ticket_items
        if (d.items?.length) {
          await supabase.from('ticket_items').insert(
            d.items.map(item => ({ ...item, ticket_id: data.id, business_id: businessId }))
          )
        }
        return data
      },
    },

    ecf: {
      submit: async (invoiceData) => {
        // Call Supabase Edge Function (server-side, no CORS)
        const { data, error } = await supabase.functions.invoke('ef2-proxy', {
          body: invoiceData,
        })
        if (error) throw error
        return data
      },
    },

    printer: {
      print: async (buf) => {
        // qz-tray for USB thermal printers
        if (window.qz?.websocket?.isActive?.()) {
          const config = qz.configs.create(await getSelectedPrinter())
          await qz.print(config, [{ type: 'raw', format: 'base64', data: btoa(String.fromCharCode(...buf)) }])
        } else {
          // Fallback: generate PDF and trigger browser print
          const { buildReceiptPDFBase64 } = await import('@terminal-x/shared/services/pdf')
          const { base64 } = await buildReceiptPDFBase64(buf._receiptData)
          const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'application/pdf' })
          const url = URL.createObjectURL(blob)
          const w = window.open(url)
          w?.print()
        }
      },
      openDrawer: async () => {
        if (window.qz?.websocket?.isActive?.()) {
          const config = qz.configs.create(await getSelectedPrinter())
          // ESC/POS drawer kick command
          await qz.print(config, [{ type: 'raw', format: 'hex', data: '1B70002050' }])
        }
      },
    },

    auth: {
      // Supabase Auth replaces PIN-based auth
      signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
      signInOTP: (phone) => supabase.auth.signInWithOtp({ phone }),
      signOut: () => supabase.auth.signOut(),
      getUser: () => supabase.auth.getUser(),
    },

    settings: {
      get: async () => {
        const { data } = await supabase
          .from('app_settings')
          .select('*')
          .eq('business_id', businessId)
        return Object.fromEntries((data || []).map(r => [r.key, r.value]))
      },
      update: async (obj) => {
        const rows = Object.entries(obj).map(([key, value]) => ({
          business_id: businessId, key, value,
        }))
        await supabase.from('app_settings').upsert(rows, { onConflict: 'business_id,key' })
      },
    },
  }
}
```

---

## 4. Supabase Schema + RLS

### 4a. PostgreSQL migration (`supabase/migrations/001_initial.sql`)

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── Businesses ────────────────────────────────────────────────────
create table businesses (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid references auth.users(id) not null,
  name        text not null,
  rnc         text,
  address     text,
  phone       text,
  email       text,
  logo_url    text,
  settings    jsonb default '{}',      -- ef2_token, fiscal_mode, etc.
  created_at  timestamptz default now()
);

-- ── Users (staff within a business) ───────────────────────────────
create table staff (
  id           uuid primary key default uuid_generate_v4(),
  business_id  uuid references businesses(id) not null,
  auth_user_id uuid references auth.users(id),  -- nullable for PIN-only staff
  name         text not null,
  role         text not null check (role in ('owner','manager','cfo','accountant','cashier')),
  pin_hash     text,
  email        text,
  phone        text,
  discount_pct real default 0,
  active       boolean default true,
  created_at   timestamptz default now()
);

-- ── Services ─────────────────────────────────────────────────────
create table services (
  id            uuid primary key default uuid_generate_v4(),
  business_id   uuid references businesses(id) not null,
  categoria     text default 'General',
  name          text not null,
  price         numeric(10,2) not null,
  aplica_itbis  boolean default true,
  is_wash       boolean default false,
  sort_order    int default 0,
  active        boolean default true
);

-- ── Clients ──────────────────────────────────────────────────────
create table clients (
  id            uuid primary key default uuid_generate_v4(),
  business_id   uuid references businesses(id) not null,
  name          text not null,
  rnc           text,
  phone         text,
  email         text,
  address       text,
  balance       numeric(10,2) default 0,
  credit_limit  numeric(10,2) default 0,
  visits        int default 0,
  total_spent   numeric(10,2) default 0,
  created_at    timestamptz default now()
);

-- ── Tickets ──────────────────────────────────────────────────────
create table tickets (
  id               uuid primary key default uuid_generate_v4(),
  business_id      uuid references businesses(id) not null,
  doc_number       text not null,
  client_id        uuid references clients(id),
  cashier_id       uuid references staff(id),
  washer_ids       jsonb default '[]',
  seller_id        uuid references staff(id),
  vehicle_plate    text,
  payment_method   text,
  comprobante_type text,
  ncf              text,
  ecf_result       jsonb default '{}',
  tipo_venta       text default 'contado',
  subtotal         numeric(10,2),
  itbis            numeric(10,2),
  ley              numeric(10,2),
  total            numeric(10,2),
  status           text default 'paid',
  voided_at        timestamptz,
  voided_by        uuid references staff(id),
  void_reason      text,
  comment          text,
  paid_at          timestamptz default now(),
  created_at       timestamptz default now(),
  unique(business_id, doc_number)
);

create table ticket_items (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses(id) not null,
  ticket_id   uuid references tickets(id) not null,
  service_id  uuid references services(id),
  name        text not null,
  price       numeric(10,2) not null,
  quantity    int default 1,
  itbis       numeric(10,2) default 0,
  is_wash     boolean default false
);

-- ── Queue ────────────────────────────────────────────────────────
create table queue (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses(id) not null,
  ticket_id   uuid references tickets(id) not null,
  status      text default 'waiting',
  washer_id   uuid,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz default now()
);

-- ── NCF Sequences ────────────────────────────────────────────────
create table ncf_sequences (
  id             uuid primary key default uuid_generate_v4(),
  business_id    uuid references businesses(id) not null,
  type           text not null,
  prefix         text not null,
  current_number int default 0,
  max_number     int default 999999999,
  enabled        boolean default true,
  unique(business_id, type)
);

-- ── ECF Queue (offline) ─────────────────────────────────────────
create table ecf_queue (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses(id) not null,
  ticket_id   uuid references tickets(id),
  payload     jsonb not null,
  status      text default 'pending',
  attempts    int default 0,
  last_error  text,
  created_at  timestamptz default now(),
  sent_at     timestamptz
);

-- ── Cash Reconciliation ─────────────────────────────────────────
create table cuadre_caja (
  id             uuid primary key default uuid_generate_v4(),
  business_id    uuid references businesses(id) not null,
  cashier_id     uuid references staff(id),
  date           date not null,
  fondo          numeric(10,2) default 0,
  conteo         numeric(10,2) default 0,
  sistema        numeric(10,2) default 0,
  diferencia     numeric(10,2) default 0,
  denominaciones jsonb default '{}',
  created_at     timestamptz default now()
);

-- ── Credit Payments ─────────────────────────────────────────────
create table credit_payments (
  id             uuid primary key default uuid_generate_v4(),
  business_id    uuid references businesses(id) not null,
  client_id      uuid references clients(id) not null,
  amount         numeric(10,2) not null,
  payment_method text,
  ticket_ids     jsonb default '[]',
  ncf            text,
  created_at     timestamptz default now()
);

-- ── App Settings (KV per business) ──────────────────────────────
create table app_settings (
  business_id uuid references businesses(id) not null,
  key         text not null,
  value       text,
  primary key (business_id, key)
);

-- ── Inventory ───────────────────────────────────────────────────
create table inventory_items (
  id           uuid primary key default uuid_generate_v4(),
  business_id  uuid references businesses(id) not null,
  name         text not null,
  sku          text,
  quantity     numeric(10,2) default 0,
  min_quantity numeric(10,2) default 0,
  cost         numeric(10,2) default 0,
  price        numeric(10,2) default 0,
  created_at   timestamptz default now()
);

-- ── Notas de Credito ────────────────────────────────────────────
create table notas_credito (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses(id) not null,
  ticket_id   uuid references tickets(id),
  ncf         text,
  amount      numeric(10,2),
  reason      text,
  created_at  timestamptz default now()
);

-- ── Compras 607 ─────────────────────────────────────────────────
create table compras_607 (
  id            uuid primary key default uuid_generate_v4(),
  business_id   uuid references businesses(id) not null,
  rnc_proveedor text,
  nombre        text,
  ncf           text,
  fecha         date,
  monto         numeric(10,2),
  itbis         numeric(10,2),
  created_at    timestamptz default now()
);
```

### 4b. Row Level Security

```sql
-- All tables follow same pattern: user can only access their own business(es)

-- Helper: get business IDs owned by current user
create or replace function my_business_ids()
returns setof uuid
language sql stable security definer
as $$
  select id from businesses where owner_id = auth.uid()
  union
  select business_id from staff where auth_user_id = auth.uid() and active = true
$$;

-- Apply to every table (example for services)
alter table services enable row level security;

create policy "Users see own business services"
  on services for select
  using (business_id in (select my_business_ids()));

create policy "Users insert own business services"
  on services for insert
  with check (business_id in (select my_business_ids()));

create policy "Users update own business services"
  on services for update
  using (business_id in (select my_business_ids()));

create policy "Users delete own business services"
  on services for delete
  using (business_id in (select my_business_ids()));

-- Repeat for: businesses, staff, clients, tickets, ticket_items,
--             queue, ncf_sequences, ecf_queue, cuadre_caja,
--             credit_payments, app_settings, inventory_items,
--             notas_credito, compras_607
```

---

## 5. Edge Functions

### 5a. ef2.do proxy (`supabase/functions/ef2-proxy/index.ts`)

```ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  // Verify caller is authenticated
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return new Response('Unauthorized', { status: 401 })

  const body = await req.json()
  const { businessId, path, payload } = body

  // Fetch ef2 credentials from business settings
  const { data: biz } = await supabase
    .from('businesses')
    .select('settings')
    .eq('id', businessId)
    .single()

  const ef2Token = biz?.settings?.ef2_token
  if (!ef2Token) return new Response(JSON.stringify({ error: 'ef2 token not configured' }), { status: 400 })

  // Forward to ef2.do (server-side, no CORS)
  const ef2Res = await fetch(`https://ef2.do/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ef2Token}`,
    },
    body: JSON.stringify(payload),
  })

  const result = await ef2Res.json()
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

### 5b. RNC lookup proxy (`supabase/functions/rnc-lookup/index.ts`)

```ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async (req) => {
  const { rnc } = await req.json()
  if (!rnc) return new Response(JSON.stringify({ error: 'rnc required' }), { status: 400 })

  // Check Supabase RNC cache table first
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: cached } = await supabase
    .from('rnc_cache')
    .select('*')
    .eq('rnc', rnc)
    .single()

  if (cached) return new Response(JSON.stringify(cached))

  // Fallback: megaplus.com.do
  try {
    const res = await fetch(`https://api.megaplus.com.do/api/rnc/${rnc}`)
    const result = await res.json()
    // Cache for future lookups
    if (result?.rnc) {
      await supabase.from('rnc_cache').upsert({
        rnc: result.rnc,
        name: result.nombre || result.name,
        status: result.estado || 'ACTIVO',
        fetched_at: new Date().toISOString(),
      })
    }
    return new Response(JSON.stringify(result))
  } catch {
    return new Response(JSON.stringify({ error: 'RNC not found' }), { status: 404 })
  }
})
```

---

## 6. Offline Queue (IndexedDB)

```js
// packages/data-web/services/offline-queue.js
import { openDB } from 'idb'

const DB_NAME    = 'terminal-x-offline'
const DB_VERSION = 1
const STORES     = {
  ecfQueue:     'ecf_queue',
  ticketQueue:  'ticket_queue',
  pendingSync:  'pending_sync',
}

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORES.ecfQueue)) {
        db.createObjectStore(STORES.ecfQueue, { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(STORES.ticketQueue)) {
        db.createObjectStore(STORES.ticketQueue, { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(STORES.pendingSync)) {
        db.createObjectStore(STORES.pendingSync, { keyPath: 'id', autoIncrement: true })
      }
    },
  })
}

// ── ECF offline queue ─────────────────────────────────────────────
export async function enqueueECF(payload) {
  const db = await getDB()
  await db.add(STORES.ecfQueue, {
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
  })
}

export async function getPendingECFs() {
  const db = await getDB()
  const all = await db.getAll(STORES.ecfQueue)
  return all.filter(r => r.status === 'pending' && r.attempts < 5)
}

export async function markECFSent(id) {
  const db = await getDB()
  const record = await db.get(STORES.ecfQueue, id)
  if (record) {
    record.status = 'sent'
    record.sentAt = new Date().toISOString()
    await db.put(STORES.ecfQueue, record)
  }
}

export async function markECFFailed(id, error) {
  const db = await getDB()
  const record = await db.get(STORES.ecfQueue, id)
  if (record) {
    record.attempts += 1
    record.lastError = error
    if (record.attempts >= 5) record.status = 'failed'
    await db.put(STORES.ecfQueue, record)
  }
}

// ── Background sync (called periodically or on reconnect) ─────────
export async function syncOfflineQueue(supabase, businessId) {
  const pending = await getPendingECFs()
  for (const item of pending) {
    try {
      const { data, error } = await supabase.functions.invoke('ef2-proxy', {
        body: { businessId, path: '/ecf/procesar_factura.php', payload: item.payload },
      })
      if (error) throw error
      await markECFSent(item.id)
    } catch (err) {
      await markECFFailed(item.id, err.message)
    }
  }
}

export async function getQueueCount() {
  const pending = await getPendingECFs()
  return pending.length
}
```

---

## 7. Printing (Web)

```js
// packages/data-web/services/print-web.js
import { buildReceiptPDFBase64 } from '@terminal-x/shared/services/pdf'

let qzReady = false

// ── qz-tray initialization ───────────────────────────────────────
export async function initQZTray() {
  if (typeof qz === 'undefined') return false
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect()
    }
    qzReady = true
    return true
  } catch {
    qzReady = false
    return false
  }
}

export async function listPrinters() {
  if (!qzReady) return []
  return qz.printers.find()
}

// ── Print raw ESC/POS buffer via qz-tray ─────────────────────────
export async function printRaw(buffer, printerName) {
  if (qzReady && printerName) {
    const config = qz.configs.create(printerName)
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    await qz.print(config, [{ type: 'raw', format: 'base64', data: b64 }])
    return { ok: true }
  }
  return { ok: false, error: 'qz-tray not connected' }
}

// ── Cash drawer kick via qz-tray ─────────────────────────────────
export async function openDrawer(printerName) {
  if (!qzReady || !printerName) return
  const config = qz.configs.create(printerName)
  await qz.print(config, [{ type: 'raw', format: 'hex', data: '1B70002050' }])
}

// ── PDF fallback (no qz-tray) ────────────────────────────────────
export async function printPDFFallback(receiptData) {
  const { base64 } = await buildReceiptPDFBase64(receiptData)
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const printWindow = window.open(url, '_blank')
  if (printWindow) {
    printWindow.onload = () => {
      printWindow.print()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    }
  }
  return { ok: true, method: 'pdf-fallback' }
}
```

---

## 8. PWA Manifest + Service Worker

### 8a. manifest.json

```json
{
  "name": "Terminal X POS",
  "short_name": "Terminal X",
  "description": "Punto de venta con facturacion electronica (e-CF) para Republica Dominicana",
  "start_url": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#0f172a",
  "theme_color": "#0ea5e9",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "categories": ["business", "finance"],
  "lang": "es-DO"
}
```

### 8b. Service Worker (`public/sw.js`)

```js
const CACHE_NAME = 'terminal-x-v1'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
]

// Cache static assets on install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// Clean old caches on activate
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Network-first for API calls, cache-first for static assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // Skip Supabase API calls — always network
  if (url.hostname.includes('supabase')) return

  // Cache-first for static assets (JS, CSS, images)
  if (e.request.destination === 'script' ||
      e.request.destination === 'style' ||
      e.request.destination === 'image') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone))
        return res
      }))
    )
    return
  }

  // Network-first for HTML (SPA)
  e.respondWith(
    fetch(e.request).catch(() => caches.match('/index.html'))
  )
})
```

### 8c. SW registration (`apps/web/src/main.jsx`)

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

---

## 9. Migration Steps (Electron SQLite -> Supabase)

### Step-by-step execution order:

**Step 1 — Monorepo setup (Week 1)**
- Initialize npm workspaces or pnpm workspace
- Move shared React code (screens, components, context, i18n) to `packages/shared/`
- Move Electron-specific code to `packages/data-electron/` and `apps/desktop/`
- Verify desktop app still builds and works identically

**Step 2 — DataProvider abstraction (Week 2)**
- Create `useData()` context + provider interface
- Wrap existing `window.electronAPI` calls behind `createElectronDataLayer()`
- Update all screens/components to use `useData()` instead of direct IPC calls
- Test: desktop app works identically through the abstraction

**Step 3 — Supabase project setup (Week 2)**
- Create Supabase project (free tier, Sao Paulo region for DR latency)
- Run migration SQL (section 4a above)
- Apply RLS policies (section 4b)
- Deploy Edge Functions: ef2-proxy, rnc-lookup

**Step 4 — Web data layer (Week 3-4)**
- Implement `createWebDataLayer()` with all Supabase queries
- Implement offline queue (IndexedDB)
- Implement web printing (qz-tray + PDF fallback)
- Wire Supabase Auth (email/password first, phone OTP later)

**Step 5 — Web app shell (Week 4)**
- Create `apps/web/` with Vite config
- Import shared components + web data layer
- Add PWA manifest + service worker
- Auth flow: login page -> Supabase session -> DataProvider with businessId

**Step 6 — Data export tool (Week 5)**
- Add "Export to Cloud" button in Electron Settings
- Reads all SQLite tables, maps to Supabase schema, bulk inserts via supabase-js
- Maps SQLite integer IDs to UUIDs (generates mapping table)
- Handles: businesses, services, clients, tickets, ticket_items, ncf_sequences, etc.

**Step 7 — Testing & polish (Week 6-8)**
- Test all screens on web: POS, Queue, Clients, Credits, Admin, Reports, DGII
- Test offline mode: IndexedDB queue, service worker caching
- Test printing: qz-tray with real 80mm thermal, PDF fallback on tablet
- Test Android Chrome PWA install
- Test concurrent Electron + Web usage (same business, same data)

**Step 8 — License migration (Week 8)**
- Replace HWID-based license with Supabase user subscription
- Stripe or manual activation per business (owner email)
- Allow N devices per subscription (web = any device with browser)

---

## 10. Dependencies to Add

### Web app (`apps/web/package.json`)
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.99.3",
    "@supabase/auth-ui-react": "^0.4.7",
    "@supabase/auth-ui-shared": "^0.1.8",
    "idb": "^8.0.0",
    "pdf-lib": "^1.17.1",
    "qrcode": "^1.5.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.0",
    "lucide-react": "^0.378.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3",
    "vite": "^5.2.0",
    "vite-plugin-pwa": "^0.20.0"
  }
}
```

### External (loaded via script tag, not npm)
- **qz-tray**: `<script src="https://cdn.jsdelivr.net/npm/qz-tray@2/qz-tray.js"></script>`
  - Requires qz-tray app installed on client machine for USB thermal printing
  - Not needed on tablet/phone (PDF fallback used instead)

---

## 11. Gotchas & Mitigations

| Issue | Risk | Mitigation |
|-------|------|------------|
| **CORS on ef2.do** | ef2.do blocks browser requests | All ef2.do calls go through Supabase Edge Function (server-side) |
| **RNC offline lookup** | 900K DGII records can't live in browser | Edge Function + server-side RNC cache table; browser gets single-record lookups on demand |
| **Printing on tablet** | No USB access on Android Chrome | PDF fallback via `window.print()` with 80mm CSS media query; Bluetooth printer via Web Bluetooth API (future) |
| **Offline POS** | Supabase down = no sales | IndexedDB stores tickets locally; sync on reconnect; service worker caches UI; NCF sequences cached in localStorage |
| **ef2_token security** | Token in browser is exposed | Token stored in Supabase `businesses.settings` (server-side only); Edge Function reads it, never sent to browser |
| **Concurrent edits** | Electron + Web both writing | Supabase realtime subscriptions for live sync; `updated_at` column with conflict resolution (last-write-wins for settings, append-only for tickets) |
| **NCF sequence collisions** | Two devices increment same counter | Supabase `ncf_sequences` uses `UPDATE ... RETURNING` with row-level lock; Edge Function handles atomic increment |
| **Large receipt PDF** | pdf-lib runs in browser, may be slow on low-end Android | Receipt PDFs are tiny (~5-15KB); tested fine on mid-range devices |
| **Auth migration** | Users have PINs, not emails | Support both: Supabase Auth for owner/manager (email login), PIN bypass for cashiers (staff table PIN check via RPC function) |
| **First offline load** | PWA needs first online visit to cache | Service worker pre-caches critical assets on install; show "Conectando..." splash until ready |

---

## 12. Decision Log

| Decision | Chosen | Why |
|----------|--------|-----|
| Backend | Supabase | Auth + DB + Edge Functions + Storage in one platform; free tier covers early clients; PostgreSQL is production-grade |
| Offline DB | IndexedDB (via `idb`) | Native browser API, no extra deps, sufficient for queue + pending tickets |
| Printing | qz-tray + PDF fallback | qz-tray is the only reliable way to talk to USB thermal printers from a browser; PDF covers tablets |
| Monorepo tool | npm workspaces | Already using npm; no need for pnpm/turborepo complexity yet |
| Component sharing | Package imports | `@terminal-x/shared` imported by both desktop and web apps; no code duplication |
| Auth | Supabase Auth | Built-in email/OTP/magic link; RLS integration; free tier covers needs |
| NCF atomic increment | Supabase RPC function | Prevents sequence collision between concurrent devices |

---

## 13. Minimal First Milestone (4 weeks)

Get a working web POS that can ring up a sale, print a receipt, and submit e-CF:

1. Supabase project + schema + RLS + ef2-proxy Edge Function
2. Web app shell with Supabase Auth login
3. POS screen reading services from Supabase
4. CobrarModal submitting e-CF via Edge Function
5. PDF receipt generation (shared code, already works)
6. Browser print dialog for receipt

Everything else (offline queue, qz-tray, admin panel, reports, DGII) comes after this core loop works.
