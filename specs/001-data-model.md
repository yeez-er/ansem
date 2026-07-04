# Spec 001: Data Model & Schema

## Goal

The relational backbone for a cross-platform creator leaderboard: creators, their posts about $ANSEM, and time-series metric snapshots that every leaderboard number derives from.

## Context

- Greenfield. Stack: Next.js (App Router) + tRPC + Drizzle ORM + Neon Postgres.
- Design principle: **snapshots are the source of truth**; leaderboards are derived views. Daily boards rank _metric deltas within the window_, so we must retain history, not just latest values.
- Every constraint here must exist in BOTH the Drizzle schema AND a generated SQL migration (ORM metadata without a migration is documentation, not enforcement).

## Schema

### Enums

- `platform`: `x` | `tiktok` | `instagram`
- `post_status`: `pending` | `approved` | `rejected` | `removed` (removed = deleted/unavailable at source)
- `post_source`: `submission` | `x_search` | `admin`

### `creators` — one row per platform account

| Column                      | Type                              | Notes                                                          |
| --------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `id`                        | uuid pk `defaultRandom()`         |                                                                |
| `platform`                  | platform enum, not null           |                                                                |
| `handle`                    | text, not null                    | normalized: lowercase, no leading `@`                          |
| `display_name`              | text, null                        |                                                                |
| `avatar_url`                | text, null                        |                                                                |
| `profile_url`               | text, not null                    |                                                                |
| `is_banned`                 | boolean, not null, default false  | banned creators are excluded from all leaderboards server-side |
| `created_at` / `updated_at` | timestamptz, not null, defaultNow |                                                                |

**UNIQUE(platform, handle)** — upserts key on this natural key (never on the uuid pk, or `onConflictDoNothing` will never trigger).

### `posts` — one row per tracked piece of content

| Column                                                                | Type                                          | Notes                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                                  | uuid pk `defaultRandom()`                     |                                                                                                                                                                                                                    |
| `creator_id`                                                          | uuid fk → creators.id, not null               |                                                                                                                                                                                                                    |
| `platform`                                                            | platform enum, not null                       | denormalized from creator; must always match                                                                                                                                                                       |
| `platform_post_id`                                                    | text, not null                                | canonical id parsed from the URL (tweet id, TikTok video id, IG shortcode)                                                                                                                                         |
| `url`                                                                 | text, not null                                | canonical URL rebuilt from platform + id, not the raw user input                                                                                                                                                   |
| `caption`                                                             | text, null                                    |                                                                                                                                                                                                                    |
| `posted_at`                                                           | timestamptz, null                             | publication time at source when known                                                                                                                                                                              |
| `status`                                                              | post_status enum, not null, default `pending` |                                                                                                                                                                                                                    |
| `source`                                                              | post_source enum, not null                    |                                                                                                                                                                                                                    |
| `submitted_by_user_id`                                                | text, null                                    | Clerk user id when source = submission                                                                                                                                                                             |
| `latest_views` / `latest_likes` / `latest_comments` / `latest_shares` | bigint, not null, default 0                   | denormalized from newest snapshot — written by ingestion (spec 004), read by leaderboard queries (spec 007). Both sides land in the same milestone; a denormalized column with no reader or no writer is a defect. |
| `latest_snapshot_at`                                                  | timestamptz, null                             |                                                                                                                                                                                                                    |
| `created_at`                                                          | timestamptz, not null, defaultNow             |                                                                                                                                                                                                                    |

**UNIQUE(platform, platform_post_id)** — the dedupe gate for submissions and discovery. Indexes: `(status, platform)`, `(creator_id)`.

### `metric_snapshots` — append-only time series

| Column                                    | Type                                         | Notes |
| ----------------------------------------- | -------------------------------------------- | ----- |
| `id`                                      | uuid pk `defaultRandom()`                    |       |
| `post_id`                                 | uuid fk → posts.id, not null, cascade delete |       |
| `views` / `likes` / `comments` / `shares` | bigint, not null, default 0                  |       |
| `captured_at`                             | timestamptz, not null, defaultNow            |       |

Index **(post_id, captured_at desc)** — window-baseline and latest lookups. Rows are never updated or deleted (except via post cascade). Windowed (daily) scores are computed as `latest − baseline`, never by summing rows, so a duplicate snapshot cannot double-count.

## Conventions (apply to all specs)

- All date math in UTC (`toISOString`, `setUTCHours`); board day boundary = 00:00:00 UTC.
- Procedures returning "no data" return `null`, never `{}` or `[]`.
- Public DTOs are built from explicit allow-lists of columns (e.g., never leak `submitted_by_user_id`).
- No dead columns: the account-claim flow (`claimed_by_user_id`) was deliberately CUT from v1 — re-add the column WITH the feature. Do not add speculative columns.
- Counts from platforms are `bigint` end-to-end — X view counts overflow int4.

## Files to Create/Modify

| File                                       | Action                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `src/server/db/schema/enums.ts`            | CREATE                                                           |
| `src/server/db/schema/creators.ts`         | CREATE                                                           |
| `src/server/db/schema/posts.ts`            | CREATE                                                           |
| `src/server/db/schema/metric-snapshots.ts` | CREATE                                                           |
| `src/server/db/schema/index.ts`            | CREATE — barrel export (verify registration, not just existence) |
| `src/server/db/index.ts`                   | CREATE — Neon driver + Drizzle client                            |
| `drizzle.config.ts`                        | CREATE                                                           |
| `drizzle/` migration                       | GENERATE via drizzle-kit                                         |

## Acceptance Criteria

- [ ] Drizzle schema compiles; `drizzle-kit generate` produces a migration containing BOTH unique constraints and all three indexes
- [ ] No explicit index duplicates a UNIQUE constraint's implicit index
- [ ] Dual-layer test: source verification that every schema file is exported from `index.ts`; runtime test that inserting a duplicate `(platform, platform_post_id)` violates the constraint
- [ ] Inserting a duplicate `(platform, handle)` creator violates its constraint
- [ ] `latest_*` columns are bigint (test with a value > 2^31)
- [ ] Migration applies cleanly to a fresh database
