# PB Sales Intelligence

Sales dashboards, team reporting and follow-up queues built on top of **Precise Builder (PB)**. PB stays the source of truth. This app reads it through the documented REST API and webhooks, keeps a synchronized copy in PostgreSQL, and serves every page from that copy. Dashboards keep working, with an accurate "data as of" time, when PB is unavailable.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 + shadcn/ui (Base UI) · Apache ECharts · TanStack Table v9 · Drizzle ORM · Neon PostgreSQL · Clerk · Vitest · Playwright
- **Integration gaps:** see [INTEGRATION_GAPS.md](INTEGRATION_GAPS.md). Read it before go-live.

## Quick start (demo mode, no credentials)

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

With no `DATABASE_URL`, the app runs in **demo mode**:

- An embedded PostgreSQL (PGlite) is seeded with ~2,400 fictional opportunities.
- The seed runs through the real import pipeline, using a fake PB client that serves documented response shapes.
- About 90 signed webhooks are then replayed through the real ingest and processing code.
- Every page shows a **DEMO DATA** banner.
- A "Viewing as" switcher replaces sign-in, so you can try the admin and salesperson views.

The first start of the day seeds for about 20–60s; after that it loads from `.data/` in about a second. `pnpm demo:reset` reseeds. **Settings → Simulate 5 stage-change webhooks** shows the full loop: event → processing → updated dashboard.

## Architecture

```
               Precise Builder
        REST (GET only)       Webhooks (signed POST)
              ▲                        │
  ┌───────────┴───────────┐   ┌────────▼──────────────────────────┐
  │ sync/runs.ts          │   │ /api/webhooks/precise-builder     │
  │  full import          │   │  1 verify HMAC (raw body)         │
  │  reconciliation       │   │  2 validate envelope              │
  │  (bounded, resumable, │   │  3 INSERT … ON CONFLICT (event id)│
  │   checkpointed)       │   │  4 200 OK  →  after(): process    │
  └───────────┬───────────┘   └────────┬──────────────────────────┘
              │                        │ webhook_events = durable queue
              │               ┌────────▼──────────────────────────┐
              │               │ webhooks/process.ts               │
              │               │  claim FOR UPDATE SKIP LOCKED     │
              │               │  re-fetch current record via REST │
              │               │  retry w/ backoff → dead after 8  │
              │               └────────┬──────────────────────────┘
              ▼                        ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ sync/upsert.ts: transactional upserts, change detection,      │
  │ snapshots, stage transitions, "older fetch never wins"        │
  └───────────────────────────────┬───────────────────────────────┘
                                  ▼
                       Neon PostgreSQL (Drizzle)
                                  ▲
  ┌───────────────────────────────┴───────────────────────────────┐
  │ metrics/*.ts: SQL aggregates (integer cents, company tz)      │
  │ every query takes an authorization scope from authz.ts        │
  └───────────────────────────────┬───────────────────────────────┘
                                  ▼
           Server Components pages · /api/* route handlers
```

**Durable background work** uses the database, with no extra queue service. Every webhook is stored before it is acknowledged. The receiver processes it right after responding (`after()`). Anything left pending, failed or stuck (lock older than 5 min) is retried by `/api/cron/process-events`. That is safe with concurrent workers because claims use `FOR UPDATE SKIP LOCKED`.

### Layout

| Path | What |
| --- | --- |
| `src/db/schema.ts` | Tables (migrations in `drizzle/`) |
| `src/server/pb/` | Documented PB schemas (Zod), HTTP client, signature verification, fixture client |
| `src/server/sync/` | Import, reconciliation, upserts |
| `src/server/webhooks/` | Ingest and processing |
| `src/server/metrics/` | All analytics (definitions in `sales.ts`) |
| `src/server/authz.ts`, `auth.ts` | Roles, scope rules, Clerk/demo session |
| `src/app/(app)/` | Pages: `/dashboard`, `/my-dashboard`, `/opportunities[/id]`, `/salespeople[/id]`, `/analytics`, `/settings` |
| `src/app/api/` | Route handlers (see below) |
| `src/components/` | `KpiCard`, `FilterBar` (date range, salesperson and dimension filters), `PipelineChart`, `RevenueTrendChart`, `SalesLeaderboard`, `OpportunityTable`, `ActivityQueue`/`PriorityQueue`, `StageTimeline`, `SyncStatusIndicator` |

### API

All JSON errors look like `{"error":{"code","message"}}`. Query parameters are validated with Zod.

| Route | Access |
| --- | --- |
| `GET /api/dashboard` | signed in; salespeople get their own data only (asking for others → 403) |
| `GET /api/opportunities`, `GET /api/opportunities/[id]`, `GET /api/opportunities/export` (CSV) | signed in, scoped; another rep's record → 404 |
| `GET /api/salespeople` | admin |
| `GET /api/salespeople/[id]/metrics` | admin, or that salesperson |
| `GET /api/analytics` | admin |
| `POST /api/admin/sync` `{type: reconcile\|full\|process-events}`, `GET /api/admin/sync-status` | admin |
| `POST /api/webhooks/precise-builder` | PB signature |
| `GET /api/cron/process-events`, `/reconcile`, `/full-sync` | `Authorization: Bearer $CRON_SECRET` |
| `POST /api/demo/*` | demo mode only (404 otherwise) |

## Environment variables

See [.env.example](.env.example). Put them in `.env.local` locally and in Vercel project settings in production. **Never commit real values.**

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | live | Neon **pooled** connection string. Setting it switches to live mode. |
| `PRECISE_BUILDER_BASE_URL` | live | `https://app.precisebuilder.com/t1234abcd` (your account id). Shown in PB under Settings → Integrations → REST API. |
| `PRECISE_BUILDER_API_KEY` | live | `pbk_…`. One key per account; generating a new one revokes the old. |
| `PRECISE_BUILDER_WEBHOOK_SECRET` | live | `whsec_…` from the endpoint. Comma-separate several. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | live | Live data is never served without Clerk. |
| `ADMIN_EMAILS` | live | Comma-separated. These users become ADMIN on sign-in. |
| `CRON_SECRET` | live | ≥16 random chars. Vercel sends it to cron routes automatically. |
| `NEXT_PUBLIC_APP_URL` | recommended | Used to display the webhook URL in Settings. |
| `COMPANY_TIMEZONE` | optional | IANA zone for reporting periods. Default `America/New_York`. |
| `DEMO_MODE` | optional | `true` lets a production build run demo data without a database. |

**Modes**

| `DATABASE_URL` | Mode |
| --- | --- |
| unset | demo |
| set | live (requires Clerk) |
| unset, in production, without `DEMO_MODE` | refuses to start serving data |

## Database

```bash
pnpm db:generate   # after editing src/db/schema.ts → new SQL in drizzle/
pnpm db:migrate    # apply to DATABASE_URL
```

Money is stored and summed as integer cents (`bigint`). Timestamps are `timestamptz` (UTC). Reporting periods are computed in `COMPANY_TIMEZONE` inside SQL.

## Precise Builder setup

1. **API key.** In PB: **Settings → Integrations → REST API → Generate New Key**. Set `PRECISE_BUILDER_BASE_URL` and `PRECISE_BUILDER_API_KEY`.
2. **Connectivity check** (read-only):
   ```bash
   pnpm sync:check
   ```
   It prints counts of sales reps, stages (with status), job types and lead sources.
3. **Initial import.** Run it from your machine; there's no serverless time limit there.
   ```bash
   pnpm db:migrate && pnpm sync:full
   ```
   This imports lookups, all customers and opportunities (including archived), and the activities of every open opportunity. It is resumable: re-running continues from the checkpoint.
4. **Link users.** Sign in once with each account. Then, as an admin, go to **Settings → Users** and link each person to their PB salesperson. Unlinked users see nothing.
5. **Targets and thresholds.** Set them in **Settings**.

### Webhook registration

1. Deploy first. PB only accepts a public `https://` URL on port 443 with no redirects.
2. In PB: **Settings → Integrations → REST API → Webhooks → Add Endpoint**.
   - **URL:** `https://<your-app>/api/webhooks/precise-builder`
   - **Events:** `customer.created`, `customer.updated`, `opportunity.created`, `opportunity.stage_updated`, `job.updated`, `activity.created`, `activity.completed`. Invoice and vendor events are accepted but ignored.
3. Copy the signing secret into `PRECISE_BUILDER_WEBHOOK_SECRET` and redeploy.
4. Click **Send Test** in PB. It should show success, and **Settings → Synchronization** in this app should count a processed event.
5. **If PB disables the endpoint** after repeated failures, events are not queued. Fix the problem, re-enable the endpoint, use **Redeliver Failed** in PB, then run **Full sync** here.

## Deploying to Vercel

1. Create a Neon database. Copy the **pooled** connection string.
2. Create a Clerk application and copy its keys.
3. Import the GitHub repo into Vercel (framework: Next.js; install `pnpm install`; build `pnpm build`).
4. Add all live environment variables (see above) for Production (and Preview if wanted).
5. Run `pnpm db:migrate` against the Neon URL from your machine. Optionally add it as a step in your release process.
6. Deploy, then register the webhook (above) and run `pnpm sync:full` locally against the production database.

**Cron.** `vercel.json` schedules:

| Route | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/process-events` | every 5 min | Retries the webhook queue |
| `/api/cron/reconcile` | hourly | Reconciliation; also prunes old payloads |
| `/api/cron/full-sync` | daily 08:30 UTC | Consistency pass, resumes if cut off |

> **Vercel Hobby plans only allow once-per-day cron jobs. A deploy with the schedules above fails on Hobby.** Use Pro, or change both frequent schedules to daily and accept slower recovery from missed webhooks. Webhooks themselves are processed immediately regardless of plan.

Function `maxDuration` is 300s for sync routes. Each job stops at about 240s, saves a checkpoint, and resumes on the next run.

## Metric definitions

Defined in `src/server/metrics/sales.ts` and shown in the UI tooltips (ⓘ).

| Metric | Definition |
| --- | --- |
| Open pipeline | Sum of `revenue` for `status = pending`, not archived. This is the current state; the date range doesn't apply. |
| Won Sales | Sum of `revenue` for `won` opportunities with `closed_at` in range (company tz). Not accounting revenue. |
| Lost value | Same as Won Sales, for `lost`. |
| Win rate | won ÷ (won + lost), both counted by close date in range. |
| Avg won deal | Won Sales ÷ won opportunities **that have a value**. |
| Sales cycle | Median of (close date − PB created date) in days, for won opportunities. |
| Pipeline coverage | Open pipeline ÷ this month's target. Shown only when a target exists. |
| Stage age | Time since a **verified** (webhook) entry into the current stage. Otherwise "Unknown". |

Opportunities without a value are counted but excluded from dollar figures, and the UI states how many. Won/lost opportunities without `closed_at` are reported as a data-quality note.

**Priority queue rules** (`metrics/priority.ts`; thresholds in Settings):

- **Overdue activity:** an open PB activity is past due.
- **No follow-up scheduled:** activities were synced and none is open.
- **High value with no observed PB record change** for N days.
- **In one stage too long:** based on a verified stage entry only.
- **No completed activity recorded** for N days. Informational; shown only alongside another rule.

"No record change" and "no recorded activity" are separate rules. Neither one claims the customer wasn't contacted.

## Testing

```bash
pnpm lint && pnpm typecheck
pnpm test                 # Vitest (56 tests) on in-process Postgres (PGlite)
TEST_DATABASE_URL=postgres://user:pw@localhost:5432/postgres pnpm test   # same tests on a real Postgres
pnpm build && pnpm test:e2e   # Playwright against the production build in demo mode
```

What the tests cover:

- **Analytics:** open pipeline, won/lost, win rate, date and salesperson filters, missing values, sales cycle, the timezone boundary, buckets, priority rules.
- **Webhooks:** the official signature test vector, invalid and expired signatures, rotation, duplicates, out-of-order stage events, stale fetches, unknown events, retry/backoff, incremental sync.
- **Sync:** pagination, checkpoint resume, concurrency guard, reconciliation of missed changes and deletions, PB outage.
- **Authorization:** scope rules, record access, every protected route type, cron secrets, CSV scoping.
- **HTTP client:** headers, paging parameters, retries, schema validation.

No test calls the live PB API. CI (`.github/workflows/ci.yml`) runs everything on each push and PR.

## Known limitations

- **No live PB testing yet.** The integration has not run against a real PB account. Credentials weren't available while building it. Run `pnpm sync:check`, then `sync:full`, and compare a few totals with PB before relying on the numbers.
- **History starts at go-live.** Stage history, stage aging and snapshots only build up from then. Nothing earlier is reconstructed, and historical stage analysis appears after 50 verified moves.
- **"Last change" is the last change this app observed.** PB exposes no update timestamp.
- **Activity attribution depends on the user ↔ sales-rep name match** (adjustable in Settings).
- **Demo mode uses one in-memory database per server process.** It's meant for local evaluation, not shared hosting.

See [INTEGRATION_GAPS.md](INTEGRATION_GAPS.md) for the full list.
