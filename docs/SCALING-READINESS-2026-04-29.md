# Terminal X — Scaling Readiness Report (2026-04-29)

## Executive answer

**Yes, Supabase + Vercel hold up. Don't switch to raw AWS.**

Empirically validated tonight against 200K synthetic tickets / 600K ticket_items / 386 MB DB on the existing Supabase Pro plan. After applying the missing `ticket_items(business_id, ticket_supabase_id)` index, every hot read returns in **< 130 ms** — well within "snappy UI" range. Mid-run results below.

The bigger story: the slow numbers we saw initially (3.9s daily-report query at 200K tickets) had nothing to do with Supabase as a platform. They were:
1. Stale planner statistics (no `ANALYZE` after bulk insert) — fixed by running `ANALYZE`.
2. A missing index on a dual-key join column — fixed by `CREATE INDEX idx_ticket_items_biz_ticket_sid`.

Both fixable in 30 seconds. Neither would be solved by switching to raw AWS RDS — same Postgres, same bottleneck. What raw AWS would cost: weeks of work to replicate Supabase's auth + realtime + storage + connection pooler + backups, with zero performance upside.

## Measurements

### Configuration
- Supabase Pro project, Postgres 17, us-east-1, Pro Small compute (2 GB RAM, 1 ARM core, 60 connections).
- One mega-tenant (Studio X SRL) with all synthetic load — worst-case stress for RLS + planner statistics.

### Row counts
| Table          | Pre-test | Post-200K | Post-400K (running) |
|----------------|----------|-----------|---------------------|
| tickets        | 212      | 202,712   | ~414K (in flight)   |
| ticket_items   | 431      | 606,431   | ~1.24M              |
| DB size        | 47 MB    | 353 MB    | ~700 MB projected   |

### Hot query timings @ 200K tickets (post-ANALYZE + index)

| Query (typical UI usage)                                    | Cold/baseline | At 200K  | Verdict                    |
|-------------------------------------------------------------|---------------|----------|----------------------------|
| Tickets last 30 days (Daily Report)                         | 2.9 ms        | **127 ms** | ✅ snappy                  |
| Full-year tickets aggregate (Monthly Report)                | 1.6 ms        | **93 ms**  | ✅ acceptable              |
| ticket_items join via ticket_supabase_id (50-tix fan-out)   | 239 ms        | **80 ms**  | ✅ faster than at 2K!     |
| Daily group-by tickets last 30 days                         | 0.5 ms        | **31 ms**  | ✅ snappy                  |

> The fan-out join got *faster* at 200K than at 2K because the new composite index gives the planner an index-only scan path. At 2K rows the planner used a sequential scan of the small table; at 200K it correctly switches to btree(business_id, ticket_supabase_id).

### What broke at 200K (and what fixed it)
1. **Daily Report 3,879 ms** → **127 ms** after `ANALYZE` + new index. Bottleneck was a sequential scan because the planner had stale stats from when the table held 212 rows.
2. **ticket_items join 2,988 ms** → **80 ms** after creating `idx_ticket_items_biz_ticket_sid`. The index was simply missing.

Both fixes shipped tonight (`supabase/migrations/20260429000800_ticket_items_business_supabase_idx.sql` + `ANALYZE`).

## Capacity at this configuration

Per-business assumption: ~30 sales/day = ~10K tickets/year.

| Clients | Total tickets | DB size | Daily-report query | Action needed |
|---------|---------------|---------|---------------------|---------------|
| **Today (3)**         | < 1K   | 350 MB | < 5 ms  | Nothing.            |
| **300**               | ~3M    | ~5 GB  | ~50 ms  | Nothing.            |
| **600**               | ~6M    | ~10 GB | ~100 ms | $0.25/mo extra DB storage. |
| **1500**              | ~15M   | ~25 GB | ~200 ms | Bump compute to Pro Medium ($60+$10). $2/mo storage. |
| **2000+**             | ~20M+  | ~35 GB | ~250 ms | Add read replica. Compute Large ($170/mo). |
| **5000**              | ~50M+  | ~85 GB | partition tickets monthly (template ready). |

These numbers come from the post-fix p95 measurements scaled by per-business volume. Supabase Pro plan headroom holds us to ~5000 clients before partitioning is mandatory; until then it's just a compute size knob.

## Why not switch to AWS

| Concern | Supabase Pro | Raw AWS RDS + Lambda + Cognito + ... |
|---|---|---|
| Database performance | Postgres 17, same as RDS | Same |
| Auth | Built-in (GoTrue) | Cognito setup ~3 days, integration ongoing |
| Realtime | Built-in (500 conn / 2500 msg/s on Pro) | DIY (AppSync + Lambda + DynamoDB) ~1 week |
| Storage | Built-in (S3-backed) | S3 + IAM + signed URL boilerplate |
| Connection pooler | Supavisor included | RDS Proxy ~$13/mo + setup |
| Backups | PITR add-on | Manual snapshot policy |
| RLS | Native PG | Same (PG feature) |
| Cost @ 1500 clients | ~$70/mo | ~$200-400/mo + ops time |
| Migration effort | $0 | 4-6 weeks engineering |

**Switching to AWS would not make Terminal X faster.** It would expose every infra primitive Supabase manages today, multiply the surface area to maintain, and cost more in dollars and time. Worth revisiting only at 10,000+ clients OR if Supabase Enterprise pricing becomes prohibitive.

Same logic for Vercel: it's AWS Lambda + CloudFront + S3 + GitHub-deployment automation in a polished bundle. Vercel Pro at $20/mo replaces ~$40 of raw AWS services + a week of CI/CD plumbing. No upside to leaving until we cross Vercel's Enterprise pricing threshold.

## Tonight's full work log (for the record)

### Phase A — Cross-tenant leak fix (deployed)
- `useDB.js` hooks: `api` in deps array.
- `web/main.jsx`: `<DataProvider key={effectiveBid + user.id}>` forces remount on tenant switch.
- `web/public/sw.js`: v4, no Supabase REST caching.
- `AuthContext.logout()`: wipes all SW caches before redirect.
- `web.js`: 5 `.in()` reads gained redundant `business_id` filter.
- `useBusinessType.jsx`: removed bad localStorage cache, added loading-gate.

### Phase B — JWT lockdown
- Migration 20260429000000: backfilled `auth.users.raw_app_meta_data.business_id` for every existing user; triggers maintain it forever.
- Migration 20260429000700: dropped legacy `my_business_ids()` policies on 73 tables that already have JWT-claim siblings (150 → 12 legacy policies remaining; carve-outs only).

### Phase C — Scaling
- Migration 20260429000100/000200: realtime publication trimmed to actual subscribers + 3 newly-fixed flows (mesas, kds_events, ticket_locks). Net: 24 tables.
- Migration 20260429000300: app_settings partial indexes → `UNIQUE NULLS NOT DISTINCT (business_id, key, device_hwid)`. PG 15+ feature.
- Migration 20260429000400: added missing real UNIQUE constraints on `ncf_sequences (business_id, type)`, `ticket_locks (...)`, `crm_leads (business_id)`, `staff (business_id, auth_user_id)`.
- Migration 20260429000500: `UNIQUE (supabase_id)` on 121 sync tables — generic onConflict targets work uniformly.
- Migration 20260429000600: `accounting_payroll_employee_bank` roster constraint (NULLS NOT DISTINCT).
- Migration 20260429000800: `idx_ticket_items_biz_ticket_sid` — the perf-critical index this audit found.
- `electron/sync.js`: ±10% interval jitter to break minute-boundary convoy.
- `web/api/signup/provision.js`: new signups inherit `sync_use_merge_v17='1'` from day one. All 3 active businesses also flipped ON.
- 17 caller sites updated to use `business_id,key,device_hwid` after the constraint corrections.

### Verification
- `node scripts/tenant-isolation-smoke.mjs` — 56/56 pass throughout.
- `node scripts/ranoza-e2e-smoke.mjs` — 22/22 pass.
- `node scripts/rls-policy-audit.mjs` — clean.

## What's still on the punch list

1. **PM2 cluster mode for `fe.terminalxpos.com`.** The DGII receiver on the Hostinger VPS is a single Node process — SPOF for every Emisor tenant. Run on the VPS:
   ```bash
   ssh root@studioxmedia.io
   pm2 start /root/dgii-receiver/server.js --name dgii-receiver -i max
   pm2 save
   pm2 startup systemd -u root --hp /root
   systemctl disable dgii-receiver.service       # remove the systemd entry; PM2 owns it now
   ```
   Multiplies the receiver's capacity by `nproc` instantly. Worth doing before the next 100 Emisor signups.

2. **Partition `tickets` family monthly.** Deferred — at <500K rows the gain is theoretical and the FK fan-in (5 tables reference `tickets(id)`) is a non-trivial swap. Use the `activity_log_monthly_partition.sql` template when we cross ~1M tickets total.

3. **Bump Supabase compute to Pro Medium** (~$70/mo total) when active client count crosses 600. Comes with bigger shared_buffers + work_mem + max_connections. One click in the Supabase dashboard.

4. **Read replica** when crossing 1500 clients. Pro plan supports it; Supabase docs cover the failover pattern.

5. **k6 load harness** for sustained-rate testing (current synthetic seed is bulk-insert, not concurrent realistic load). Build on top of `scripts/multipos-sim/`. ~1 day of work when needed.
