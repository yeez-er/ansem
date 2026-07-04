<!-- Keep this file under ~80 lines. Operational only. Status/progress -> IMPLEMENTATION_PLAN.md -->

## Build & Run

```bash
pnpm install
pnpm dev
```

## Validation Chain

Run these IN ORDER after implementing. ALL must pass before committing:

1. Unit/integration tests: `pnpm test`
2. Integration tests: `pnpm test` (vitest node-environment files, same runner)
3. E2E tests: `pnpm test:e2e` (Playwright — only when e2e/ exists)
4. Coverage: `N/A`
5. Build: `pnpm build`
6. Typecheck: `pnpm typecheck`
7. Lint: `pnpm lint`

## Seed Data

```bash
pnpm db:seed   # idempotent — safe to re-run (spec 010)
```

## Database

```bash
pnpm db:generate   # drizzle-kit generate (migrations from schema)
pnpm db:migrate    # apply migrations
pnpm db:push       # dev-only schema push
```

## External Services

| Service | Purpose | Dev Fallback | Env Var |
|---------|---------|-------------|---------|
| Neon Postgres | Primary DB | Local/branch DATABASE_URL | `DATABASE_URL` |
| Clerk | Auth (submit + admin only) | Clerk test-mode keys | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |
| X API v2 | Optional: metrics + discovery (specs 003/005) | Feature OFF when unset; MockMetricsProvider | `X_BEARER_TOKEN` |
| Metrics data provider (TBD — owner decision pending) | TikTok/IG public post metrics (spec 003) | `METRICS_PROVIDER=mock` (deterministic) | `THIRDPARTY_API_KEY` |
| Vercel Cron | Scheduled ingestion (specs 004/005) | Manual `curl` with bearer secret | `CRON_SECRET` |

## Database Enums

- platform: `x`, `tiktok`, `instagram`
- post_status: `pending`, `approved`, `rejected`, `removed`
- post_source: `submission`, `x_search`, `admin`

## Test Setup Boilerplate

```typescript
import { describe, it, expect, vi } from "vitest";
// DB-touching tests: add `// @vitest-environment node` and use a real test DATABASE_URL
// Clock-sensitive tests: vi.useFakeTimers({ now: new Date("2026-07-06T00:00:00Z") })
```

## Codebase Patterns

- **Schema**: `src/server/db/schema/*.ts` → MUST export from `schema/index.ts` (registration, not just existence)
- **Routers**: `src/server/api/routers/<name>/<procedure>.ts` → register in `<name>/index.ts` → register router in `root.ts`
- **Pure logic** (scoring, URL parsing) lives in `src/lib/` — no I/O, no ambient clock, exported + unit-tested
- **Providers**: `src/server/metrics/*` behind the `MetricsProvider` interface; never throw, return typed results
- **Counts are bigint** end-to-end; serialize as strings at the API boundary

### API Return Contracts
- Procedures returning "no data" MUST return `null`, not `{}` or `[]`
- Public DTOs are allow-list constructed (see spec 007)

### FK Chains
`creators -> posts -> metric_snapshots` (seed in this order; snapshots cascade-delete with posts)
