# Spec 007: Leaderboard API

## Goal

Public tRPC read surface: ranked boards (daily / all-time, per-platform or combined), creator profiles, and the recent-posts feed that the UI renders.

## Context

- Depends on: specs 001, 006. Consumed by: spec 008 (UI), spec 010 (seed verifies boards render non-empty).
- All procedures are PUBLIC (no auth) and read-only. Only `approved` posts and non-banned creators are ever visible — enforced in the query layer (server-side), not by the UI.
- DTOs are allow-list constructed. `PublicCreator = { id, platform, handle, displayName, avatarUrl, profileUrl }` — nothing else. Unit-test asserts the DTO contains exactly these keys.

## Procedures (`leaderboard` router)

### `leaderboard.get`

- Input: `{ period: z.enum(['daily','alltime']), platform: z.enum(['x','tiktok','instagram','all']).default('all'), cursor: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(25) }`
- Daily: per spec 006 semantics — baseline = newest snapshot before `dayWindow(now).start`, latest = newest within window, per-post delta score, summed per creator. Implemented as one SQL query (`DISTINCT ON` / lateral joins), NOT a per-creator N+1 loop; **bound the scan**: consider only posts with `latest_snapshot_at >= window.start − 2d`.
- All-time: sum `computeScore(latest_*)` per creator from denormalized columns (this is the reader that justifies them). Creators whose approved posts have ALL never been snapshotted (`latest_snapshot_at IS NULL` across the board) are excluded from ranked boards entirely — a creator must have at least one observed post to hold a rank.
- Returns `{ entries: RankedEntry[], nextCursor: number | null, window: { start, end } | null }` where `RankedEntry = { rank, creator: PublicCreator, score, views, likes, comments, shares, postCount }` (all counts serialized as strings — bigint doesn't survive JSON). Empty board ⇒ `entries: []` with `nextCursor: null` (a list is a list; the null-not-`{}` rule applies to single-entity lookups).

### `leaderboard.creator`

- Input: `{ creatorId: z.string().uuid() }`
- Returns `{ creator: PublicCreator, alltime: ScoreSummary, daily: ScoreSummary, posts: PublicPost[] }` — posts capped at 50, newest first, `PublicPost = { id, url, caption, postedAt, views, likes, comments, shares, score, latestSnapshotAt: string | null }` (strings for counts; `latestSnapshotAt: null` = never polled, drives spec 008's "pending" state — include it in the DTO allow-list test's exact-keys set). Unknown id or banned creator → **`null`** (not `{}`, not a throw).

### `leaderboard.recentPosts`

- Input: `{ limit: z.number().int().min(1).max(50).default(12) }`
- Latest approved posts across platforms for the home-page ticker. Returns `PublicPost & { creator: PublicCreator }` array.

## Caching

Each procedure result is cached 60s (per input key) via Next.js `'use cache'` / `unstable_cache` — whichever the scaffolded Next version prescribes (check `vercel-plugin:nextjs` + `next-cache-components` guidance at implementation time; do not hand-roll an in-process Map cache — it multiplies per instance). Cache key MUST include every input field. `now` is read once per request AFTER cache miss so a cached daily board never straddles two windows longer than the TTL (worst case: 60s of yesterday's board just after UTC midnight — acceptable).

## Files to Create/Modify

| File                                                 | Action                                            |
| ---------------------------------------------------- | ------------------------------------------------- |
| `src/server/api/routers/leaderboard/get.ts`          | CREATE                                            |
| `src/server/api/routers/leaderboard/creator.ts`      | CREATE                                            |
| `src/server/api/routers/leaderboard/recent-posts.ts` | CREATE                                            |
| `src/server/api/routers/leaderboard/index.ts`        | CREATE — register                                 |
| `src/server/api/root.ts`                             | MODIFY — register router                          |
| `src/server/db/queries/leaderboard.ts`               | CREATE — the SQL, separated for integration tests |

## Acceptance Criteria

- [ ] Seeded integration test: creator with 2 approved posts + snapshots ranks by the spec-computed score (hand-derived expected value, not observed output)
- [ ] Daily board counts ONLY within-window deltas: a post with 1M views all captured before today (UTC) contributes 0 today; a post with a baseline but zero in-window snapshots also contributes exactly 0 (no cross-window fallback)
- [ ] Banned creator and `pending`/`rejected`/`removed` posts appear on no board (each status covered)
- [ ] `leaderboard.creator` returns `null` for unknown uuid (assert `=== null`, not falsy) and for a banned creator
- [ ] DTO allow-list test: serialized entry contains exactly the public keys — no `submitted_by_user_id`, no `is_banned`
- [ ] Pagination: `limit` capped at 100 (101 → zod reject with code `BAD_REQUEST`); page 2 continues the total order without overlap (tie-break determinism from spec 006)
- [ ] Count fields serialize as strings; a > 2^53 views value survives the client round-trip intact
