# RETRO_HARDEN_FINDINGS

## YELLOW

- **File:line**: `src/server/api/routers/submissions/submit.ts:96`
- **Defect**: The 24h quota check runs before the existing-post/banned-creator lookup. That means canonical duplicates are rejected as `TOO_MANY_REQUESTS` once a user is at 20/20, even though spec 002 says `alreadyTracked` duplicates do not consume quota. The same ordering also causes a banned duplicate to report rate-limit instead of `CREATOR_BANNED` when the submitter is already at quota.
- **Concrete failure scenario**: A user has already inserted 20 posts in the last 24h, then resubmits an already-tracked X URL to confirm it is on the board. The request throws at line 96 before the duplicate path at lines 123-148 runs, so the user gets `TOO_MANY_REQUESTS` even though no new row would have been inserted.
- **Suggested fix**: For URLs that already carry a canonical post id, do the duplicate/banned lookup before quota enforcement and only apply the quota gate when an insertion is actually needed. Keep the pre-fetch gate for unresolved TikTok short links, or split the logic so canonical duplicates bypass quota while short-link resolution attempts still count.

## YELLOW

- **File:line**: `src/server/api/routers/submissions/submit.ts:26`
- **Defect**: The rolling 24h quota window is computed from the app runtime clock (`Date.now()`), but it is compared against `created_at` / `attempted_at` values stamped by Postgres. This mixes two clocks in one authorization decision.
- **Concrete failure scenario**: If the Vercel runtime clock is 7 minutes fast, a submission inserted 23h53m ago in Postgres falls outside `windowStart`, so the user is allowed to make a 21st submission early. If the runtime clock is slow, the inverse happens and legitimate submissions are blocked after the 24h window has actually expired.
- **Suggested fix**: Derive the window entirely in Postgres, e.g. compare against `now() - interval '24 hours'` inside the quota queries (or one combined SQL statement), so the same clock both stamps and enforces the quota rows.

## YELLOW

- **File:line**: `src/server/ingestion/refresh-metrics.ts:72`
- **Defect**: `refreshMetrics()` re-groups the globally stale-sorted selection by platform before spending `MAX_PROVIDER_CALLS_PER_RUN`. Under truncation, the budget is consumed per platform instead of in true stale-first order, so fresher posts from the first platform can jump ahead of staler posts from later platforms.
- **Concrete failure scenario**: The selected list is `[x(oldest), instagram(second-oldest), x(98 more), ...]` and `MAX_PROVIDER_CALLS_PER_RUN=1`. The grouping step turns that into an X chunk first, refreshes 100 X posts, and leaves the second-oldest Instagram post untouched until a later run.
- **Suggested fix**: Spend the call budget against the already-sorted global selection (chunk the global stream first, then dispatch each chunk by platform), or slice the selection to the exact number of budgeted provider chunks before regrouping. Add a regression test with interleaved cross-platform staleness.

## YELLOW

- **File:line**: `src/server/metrics/mock-provider.ts:74`
- **Defect**: The mock provider synthesizes `authorHandle` as `mockcreator${seed % 997}`. Distinct post ids therefore collide onto the same synthetic author, and `refreshMetrics()` treats that handle as authoritative placeholder-resolution data (`src/server/ingestion/refresh-metrics.ts:280`), merging unrelated creators in dev/test.
- **Concrete failure scenario**: `instagram:1800000000000000005` and `instagram:1800000000000000147` both resolve to `mockcreator742`. If two placeholder Instagram submissions with those ids are refreshed under the mock provider, one placeholder creator is re-pointed into the other and then deleted, corrupting local/e2e leaderboard data.
- **Suggested fix**: Make mock author identities injective per post (for example, include the full `platformPostId` in the mock handle) or return `authorHandle: null` from the mock provider so placeholder merges never fire in dev/test.

## YELLOW

- **File:line**: `e2e/smoke.spec.ts:3`
- **Defect**: The smoke test only asserts `200` plus a non-empty `<body>`. That passes on a Next.js error/overlay page or any generic HTML shell, so it does not actually protect the "serves `/` without error overlay" acceptance criterion from spec 000.
- **Concrete failure scenario**: A server/component exception on `/` still renders a non-empty error shell during `pnpm dev`; Playwright sees status 200 and a non-empty body, so this test stays green while the homepage is unusable.
- **Suggested fix**: Assert at least one app-specific marker and the absence of known error-overlay text/landmarks, or replace this with a real user-visible contract on the page instead of "body is non-empty".
