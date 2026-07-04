# Spec 006: Scoring Engine

## Goal

One pure, exported, unit-tested module that turns raw metrics into leaderboard scores — the single place where "who's winning" is defined.

## Context

- Depends on: spec 001 (snapshot semantics). Consumed by: spec 007 (leaderboard queries), spec 010 (seed uses it to sanity-check boards).
- Pure functions only: no DB, no clock reads — callers pass `now`. This module must be trivially testable without mocks.

## Score Formula

```
score = views·W.views + likes·W.likes + comments·W.comments + shares·W.shares
```

Default weights (exported constant `DEFAULT_WEIGHTS`, single source of truth):

| Metric | Weight | Rationale |
|--------|--------|-----------|
| views | 1 | base unit — reach |
| likes | 30 | scarcer than views by ~2 orders of magnitude |
| comments | 60 | active engagement |
| shares | 90 | distribution — the campaign's actual goal |

⚠️ ASSUMPTION (owner: Yasser): weights are my proposal — tune freely; they live in ONE exported constant and everything derives from it. No per-platform weight table in v1 (a view is a view); revisit post-launch with real data.

## API (all in `src/lib/scoring.ts`)

- `computeScore(m: MetricTotals, w = DEFAULT_WEIGHTS): bigint` — bigint math throughout; never floats.
- `weekWindow(now: Date): { start: Date; end: Date }` — Monday 00:00:00.000 UTC to next Monday (exclusive). UTC functions ONLY (`getUTCDay`, `setUTCHours`) — a Sunday-23:59 UTC post and a Monday-00:00 UTC post land in different weeks regardless of server timezone.
- `windowDelta(baseline: MetricTotals | null, latest: MetricTotals): MetricTotals` — per-metric `max(0n, latest − baseline)`; `null` baseline (post born mid-week) ⇒ baseline is all-zeros; a platform metric that DECREASED (likes removed, recount) clamps to 0, never negative.
- `rankEntries(entries: ScoredEntry[]): RankedEntry[]` — sort by score desc; tie-break by views desc, then earliest `postedAt` (first mover wins), then id (total order — stable pagination). Assigns dense ranks (1,2,2,4 → no: standard competition ranking 1,2,2,4).

Weekly leaderboard semantics (implemented by spec 007's queries, defined here): a post's weekly contribution = `computeScore(windowDelta(baseline, latest))` where `baseline` = newest snapshot strictly BEFORE window start, `latest` = newest snapshot within the window. Posts `removed` mid-week keep their last in-window snapshot. All-time = `computeScore(latest_*)` denormalized columns. A creator's board entry = sum over their approved posts.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/scoring.ts` | CREATE |
| `src/lib/scoring.test.ts` | CREATE |

## Acceptance Criteria

- [ ] `computeScore` verified against hand-computed spec values (e.g., `{views: 1000n, likes: 10n, comments: 2n, shares: 1n}` → `1000 + 300 + 120 + 90 = 1510n`) — assert the spec number, not the function's own output
- [ ] `computeScore` on all-zero metrics → `0n`; on view counts > `Number.MAX_SAFE_INTEGER` → exact bigint result
- [ ] `weekWindow` fake-timer tests: Monday 00:00:00 UTC belongs to the week it starts; Sunday 23:59:59.999 UTC belongs to the prior week; a DST-transition date in a non-UTC zone changes nothing (pin the clock; zero ambient `Date.now()`)
- [ ] `windowDelta` clamps decreased metrics to 0 and treats `null` baseline as zeros
- [ ] `rankEntries` implements standard competition ranking (1,2,2,4) and the full tie-break chain; property test: output order is a total order (no ambiguity for stable pagination)
- [ ] Zero divisions anywhere (source verification: module contains no `/` operator on metric values)
- [ ] `DEFAULT_WEIGHTS` is the only weight definition in the codebase (source verification: no duplicated weight literals)
