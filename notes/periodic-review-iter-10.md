# Periodic Review — Iteration 10

**Review scope**: Last 10 iterations (`git diff HEAD~10..HEAD`, commits `1836cee`..`207d81a` — Tasks 14–21: cron routes + cron-auth, X discovery + discovery_state + x-client, leaderboard query layer, leaderboard router + DTOs, 60s response cache, idempotent seed, shared UI primitives + jsdom test infra; 62 files, ~7,772 insertions)
**Date**: 2026-07-06
**Quality trend**: STABLE
**Critical/High issues found**: 0
**Tasks added to plan**: 0

## Findings Summary

- [MEDIUM · security] `leaderboard.get` `cursor` input has a floor but no ceiling — arbitrary large cursors create distinct 60s cache entries and each miss recomputes the full board (amplification + cache-key cardinality on a public endpoint). Logged only; below the task-creation threshold.
- [LOW · security] X discovery normalizes handles but skips the `X_HANDLE` charset regex the submission parser enforces — defense-in-depth gap, trusted-source input, no injection sink today.
- [LOW · quality] `leaderboard.get`/`leaderboard.creator` recompute + rank the entire board per cache-missed input key (page, creatorId). Acknowledged v1 debt in file headers, bounded by the 60s TTL.
- [LOW · quality] `className` merge idiom (`[...].filter(Boolean).join(" ")`) now at its 2nd occurrence across the new components with no shared `cn()` helper — extract-on-2nd-occurrence rule says pull it into `src/lib/` before Task 21 iteration 2 adds more components.
- DRY discipline, clock pinning, allow-list DTOs, never-throw provider contracts, and dual-layer testing all held across the 10 iterations; no skipped tests, TODOs, or console.log debris in the committed diff.

---

## Code Quality Review

**Quality trend**: STABLE — high quality sustained across all 10 iterations; conventions held with zero regressions, and DRY extractions were done proactively at the 2nd occurrence (`cron-route`, `x-client`, `post-url` helpers, `fnv1a`, `newestFirst`, `ZERO_TOTALS`) rather than deferred. The only findings are documented v1 tech-debt and one nascent duplication, not defects.

### Findings

#### [LOW] Full-board recompute per input key — `leaderboard.get` and `leaderboard.creator`

- `src/server/api/routers/leaderboard/get.ts:26-42` and `src/server/api/routers/leaderboard/creator.ts:41-76`
- Both procedures compute and rank the entire board on every cache miss. `get` builds the whole ranked board then slices in memory for pagination, so each `{cursor,limit}` page is a distinct cache key that recomputes the full board. `creator` runs a full `dailyBoard` + `alltimeBoard` (ranking every creator) only to `.find(mine)` one creator's summary, and the 60s cache is keyed per `creatorId`, so the board work is not shared across different creators' profile views.
- Why it matters: work is O(total-visible-posts) per request regardless of page or target creator; as the creator/post count grows past "small v1" this becomes the leaderboard's dominant cost. It is explicitly acknowledged in the file headers ("boards are small in v1 and Task 19 caches") and bounded by the 60s TTL, so this is tracked debt rather than a live bug.
- Recommended fix (scopable as one task): add a single-creator summary query (aggregate only that creator's contributions) for `creator.ts`, and/or introduce a board cache keyed by `period+platform` that `get`/`creator` share so paging and profile views reuse one computed board instead of recomputing per input key.

#### [LOW] `className` merge idiom duplicated at 2nd occurrence with no shared `cn()` helper

- `src/components/stat-number.tsx:14` and `src/components/platform-badge.tsx:97-102`
- The `[...].filter(Boolean).join(" ")` class-merge idiom now appears in both new components introduced this iteration; there is no existing `cn`/`clsx`/`twMerge` utility (none in `package.json`).
- Why it matters: the project's own global rule is "extract on the 2nd occurrence, not the 3rd," and iteration 2 of this same task will add more components (`empty-state`, layout, header, footer), each of which will want the same merge. Extracting now prevents divergent hand-rolled variants.
- Recommended fix: add a tiny `cn(...classes: (string | undefined | false)[])` to `src/lib/` (unit-tested) and refactor both components onto it.

_What was checked and found clean:_ no skipped/`.only` tests, no TODO/FIXME, no `console.log`/`debugger` in the diff; no vacuous negative-error tests (no `expect(...).not.toBe(...)` inside `catch` blocks); `.rejects.toThrowError(...)` usages all carry a matcher argument (specific, not bare `.toThrow()`); all `onConflict*` targets are backed by real UNIQUE/PK constraints with a generated migration (`drizzle/0002`); `XClient` never-throw contract preserved through both refactored consumers; DB writes are try-catch wrapped (discover-x `applyCandidate`, seed `main`, cron handler); `dailyBoard`'s `latestViews === null` branch is correct given NOT-NULL snapshot columns; allow-list DTOs and `null`-vs-zero-summary semantics are correct; `abbreviateCount` bigint math and unit-promotion verified against the pinned cases; seed/hash are deterministic (no `Math.random`, single ambient clock read); source-verification tests assert helper-usage/delegation (endorsed pattern), not brittle inline details. Test coverage tracks every new source file.

### Pattern consistency notes

- Clock discipline is consistent and improving: query layer takes `now` as a param (no ambient read, source-verification-banned), while router procedures read `new Date()` once-per-request _inside_ the cached fn so cached daily boards straddle a UTC-day boundary only up to the TTL. Coherent across `get`/`creator`/`dailyBoard`.
- DRY was applied on the 2nd occurrence every time (`createCronHandler`, `XClient`, `tiktokPostUrl`/`igPostUrl`/`normalizeHandle` in `post-url.ts`, `fnv1a` in `hash.ts`, `newestFirst`/`visibleFilter` in the query layer), and earlier tasks' source-verification tests were repointed to assert delegation so the extraction can't silently regress into a duplicated pipeline — exemplary.
- `shares = retweets + quotes` is computed identically in `discover-x.mapResult` and `x-api-provider.mapTweet`; ingestion and discovery share metric semantics.
- `visibleFilter` (approved + non-banned, optional platform) is the single server-side visibility gate reused by both boards and the recent-posts feed; `creator.ts` intentionally uses an inline `status=approved` filter for a creator already proven non-banned, avoiding a redundant join — a justified, not accidental, divergence.
- `cachedQuery(...)` is invoked fresh inside each resolver (new `unstable_cache` wrapper per request). Functionally correct — the cache key derives from `keyParts` + callback source + JSON args, not wrapper identity, and `ctx.db` rides the closure so it never enters the key — but the per-request wrapper allocation is a minor style wart; a module-scoped factory would be marginally cleaner. Not worth a change given the extensive behavioral cache tests.
- Minor: `fnv1a` (`src/lib/hash.ts`) has no dedicated unit-test file; it is covered only transitively through `mock-provider` and `seed-data` tests. A direct unit test would better match the "extract pure functions → trivially unit-testable" convention.

---

## Security Review

**Overall posture**: No CRITICAL or HIGH regressions in the last 10 iterations — cron bearer auth stays constant-time and fail-closed, DTO allow-lists hold (exact-keys tested with a `submittedByUserId` canary), the cache layer keys on the full validated input, and no new secrets or suspicious dependencies entered the diff. Two below-threshold findings, both verified against the code.

### Findings

#### [MEDIUM] Unbounded `cursor` on public `leaderboard.get` — recompute amplification + cache-key cardinality

- `src/server/api/routers/leaderboard/get.ts:20` (input schema), `:37` (consumption)
- `cursor: z.number().int().min(0).default(0)` has a floor but no `.max()`, while the sibling `limit` is bounded `.min(1).max(100)`. Pagination is `board.entries.slice(i.cursor, end)` over the fully materialized, ranked board, and the board is rebuilt on every cache miss regardless of cursor value.
- Exploit scenario: a scripted sweep of distinct large cursor values (each past the board length still validates) makes every request a novel 60s cache entry AND a full board recompute — cheap request-side, full O(board) work + cache-store write server-side, on an unauthenticated endpoint.
- Recommended fix (one small build iteration): add a conservative ceiling to `cursor` (e.g. `.max(10_000)`) with a BAD_REQUEST strict-input test — same "floor AND ceiling on bulk/pagination inputs" rule already applied to `limit`. Hardening, not a live vulnerability at v1 board sizes; logged per MEDIUM policy, no task created.

#### [LOW] X discovery skips charset validation on handles the submission parser enforces

- `src/server/discovery/discover-x.ts:264-265` (`mapResult`), contrast `src/lib/post-url.ts:95-96` (`parseX` applies `X_HANDLE = /^[a-z0-9_]{1,15}$/`)
- `mapResult` only runs `normalizeHandle` (trim, strip leading `@`, lowercase, empty-check) on `author.username` — no charset regex — and the handle then flows into stored URLs via `xPostUrl(candidate.handle, …)` (`discover-x.ts:337`) and `profileUrlFor(PLATFORM, candidate.handle)` (`:316`).
- Failure scenario requires the trusted, authenticated X API to return an out-of-charset username, and there is no `dangerouslySetInnerHTML`-style sink today — defense-in-depth asymmetry between the two ingestion paths, not an exploitable vulnerability.
- Recommended fix: add an `X_HANDLE.test(handle)` guard in `mapResult`, treating failures like other invalid results (counted, never blocking the cursor).

_Categories scanned with no findings:_ hardcoded secrets/tokens (incl. tests, seed fixtures, `.env.example` placeholders), SQL/command/LIKE-pattern injection in the new query layer and seed CLI, cron auth bypass (both GET/POST paths fail closed), tRPC procedures needing auth (leaderboard reads are intentionally public), DTO/data exposure through `get`/`creator`/`recentPosts` and the cache round-trip, cross-input cache-key collisions in `cachedQuery`, new dependencies (`jsdom`, `@testing-library/react`, `@vitejs/plugin-react` — mainstream, no typosquatting), SSRF/URL construction in the X client, and zod array bounds on the new inputs.

---

## Triage Outcome (Phase 2)

- **HIGH/CRITICAL findings**: none → no `[PERIODIC-REVIEW]` tasks added to `IMPLEMENTATION_PLAN.md`, no new `KNOWN_ISSUES.md` entries.
- **MEDIUM/LOW findings**: logged above only, per policy. If the `cursor` bound or `cn()` extraction gets flagged again in a future review, apply the escalation ladder (3rd flag → blocking).
