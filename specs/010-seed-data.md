# Spec 010: Seed Data

## Goal

One idempotent script that fills a dev/e2e database with a realistic, story-shaped $ANSEM board — so every UI task, e2e run, and visual verify works against data from day one. Seed lands BEFORE any UI task in the plan.

## Context

- Depends on: specs 001, 006 (uses `computeScore`/`weekWindow` to make the numbers coherent). Consumed by: everything downstream.
- Idempotent by construction: every insert targets a natural key (`(platform, handle)`, `(platform, platform_post_id)`) with `onConflictDoNothing`/upsert — safe to re-run, never duplicates. Deterministic: fixed handles, fixed post ids, metric curves seeded by post id (no `Math.random()`).

## Dataset Shape (the story)

- **18 creators**: 8 X, 6 TikTok, 4 Instagram. Memorable degen handles (`bullpostoor`, `ansemclips`, `blackbull.era`, …). One creator seeded `is_banned: true` WITH high-scoring posts (proves ban filtering); one placeholder creator with `display_name: null` (proves placeholder rendering).
- **~60 posts**: mixed statuses — ~44 approved, 6 pending (feeds the admin queue), 4 rejected, 3 removed, 3 belonging to the banned creator. `posted_at` spread over the last 21 days (relative to seed time, UTC).
- **Snapshots**: per approved/removed post, 4–10 snapshots spaced ~6h apart ending near now, monotonically growing (views > likes > comments > shares by 1–3 orders of magnitude). Growth curves engineered so that:
  - the **weekly winner ≠ all-time winner** (an older mega-post leads all-time; a fresh viral TikTok leads the week) — proves window-delta logic visibly
  - each platform filter shows a distinct, plausible top-3
  - at least one approved post has ALL snapshots before the current week (weekly contribution exactly 0 — the spec 007 test case exists in seed form)
- **Admin**: seed README notes that `ADMIN_USER_IDS` must contain the dev's Clerk user id; seed itself never touches Clerk.

Counts are duel-checked: after seeding, the script queries `leaderboard`'s query layer and prints the top-3 weekly + all-time — a human smoke check that the board tells the intended story.

## Command

`pnpm db:seed` → `src/server/db/seed.ts` via tsx. Registered in `package.json` AND in `ralph/AGENTS.md` (Seed Data section). Exits non-zero on any failure; runs inside transactions per entity family; FK order: creators → posts → snapshots.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/server/db/seed.ts` | CREATE |
| `src/server/db/seed-data.ts` | CREATE — the fixture definitions (pure data + curve builder) |
| `package.json` | MODIFY — `db:seed` script |
| `ralph/AGENTS.md` | MODIFY — fill Seed Data command |

## Acceptance Criteria

- [ ] Running seed twice yields identical row counts (assert counts equal after 1st and 2nd run — the idempotence proof)
- [ ] Snapshot curves are monotonically non-decreasing per post (test iterates every seeded post)
- [ ] Weekly top-1 differs from all-time top-1 through the real leaderboard query layer
- [ ] Banned creator's posts exist in the DB but appear on no board
- [ ] ≥ 5 pending posts exist for the admin queue; each platform has ≥ 3 approved posts (filter tabs never empty)
- [ ] Seed uses zero `Math.random()`/`Date.now()` outside a single captured `const now` (source verification)
- [ ] `pnpm db:seed` exits 0 on a fresh DB and on a re-run; exits non-zero if the DB is unreachable
