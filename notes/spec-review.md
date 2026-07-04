# Spec Review

**Status:** NEEDS_REVISION
**Date:** 2026-07-05 (re-review; prior review 2026-07-05, fixes landed in f0442e8)
**Specs reviewed:** 000-app-scaffold, 001-data-model, 002-url-submission, 003-metrics-providers, 004-ingestion-cron, 005-x-discovery, 006-scoring, 007-leaderboard-api, 008-leaderboard-ui, 009-auth-admin, 010-seed-data

## Prior-Findings Verification (all 4 decisions resolved ✓)

1. **Auth core ordering** — RESOLVED. 009 split into Part A (Clerk core) / Part B (admin surface); 002 now depends on 009 Part A; sequencing `000 → 009A → 002 → … → 009B` stated in 009's context. Consistent.
2. **Metrics vendors** — RESOLVED (SocialData.tools for X refresh, Apify for TikTok/IG; unconfigured platform = pending state, never mock in prod). Two authoring leftovers from this edit remain — see Revision Items #1 and #2.
3. **Placeholder-creator identity** — RESOLVED. Deterministic `placeholder:<platformPostId>` handle (002), merge transaction fully specified in 004 (re-point on conflict, delete empty placeholder, rename otherwise). Consistent across 001↔002↔004↔010; each placeholder can only ever own one post, so the merge cases are complete.
4. **`claimed_by_user_id`** — RESOLVED. Dropped from the 001 schema; the cut is documented in Conventions ("re-add WITH the feature").
5. **Env-var registration (prior Cross-Spec #2)** — RESOLVED for 002 and 004 (both now register `.env.example` + `src/env.ts`). Same drift class persists mildly in 003/005 — see Minor Notes.
6. **Zero-in-window branch (prior Cross-Spec #5)** — RESOLVED. 006 pins "baseline but zero in-window snapshots ⇒ contributes exactly 0, no cross-window fallback"; 007 has the matching AC.
7. **006 ranking prose** — RESOLVED ("standard competition ranks (1, 2, 2, 4)").

## Revision Items (must fix before planning — all mechanical, no new human decisions)

1. **[003] Acceptance criterion contradicts the revised prose.** AC #1 still reads "throws typed config error in production", but the fixed prose (line ~50) now specifies: unconfigured platform ⇒ registry returns `null`, ingestion skips, "never a hard crash". Under TDD the builder implements the AC first — this cements the rejected fail-fast behavior. Fix: rewrite AC #1 to "Registry returns mock in dev when no keys configured; returns `null` for an unconfigured platform in production (assert no throw)".
2. **[003] Stale "⚠️ OPEN DECISION" banner.** Context line ~11 still says the vendor choice is open and "Until decided, only `MockMetricsProvider` runs in dev/test", while Implementations line ~55 says "DECIDED 2026-07-05" and ships both adapters in v1 against recorded fixtures. Two developers would disagree on whether the adapters are v1 scope. Fix: reword the banner to a decided/risk-accepted note (the ToS-risk acceptance is worth keeping as a record) and delete the "until decided" sentence.
3. **[007↔008] The pending state is unrenderable through the specified DTOs.** 008 (added in the fix) requires posts with `latest_snapshot_at: null` to render an em-dash "pending", "never a fake ranked 0" — but 007's `PublicPost` (`{ id, url, caption, postedAt, views, likes, comments, shares, score }`) and `RankedEntry` carry no snapshot-recency field, so the UI cannot distinguish "0 views" from "never polled". The DTOs are allow-list-constructed with an exact-keys test, so this must be pinned now, not discovered mid-UI-build. Recommended fix: add `latestSnapshotAt: string | null` to `PublicPost` (and the exact-keys test); specify that creators whose approved posts ALL have `latest_snapshot_at: null` are excluded from both boards (daily already excludes them via the `>= window.start − 2d` bound — SQL `NULL` fails the comparison; all-time must state the exclusion explicitly, otherwise they surface as ranked 0s, which 008 forbids).

## Minor Notes (fix opportunistically; none block planning once the three items above land)

- **[004] No AC covers the unconfigured-platform skip path** that 003 now defines (registry `null` ⇒ platform's posts skipped, ONE structured warning per run, not counted as errors, `latest_snapshot_at` untouched). Add one AC to 004 so the pending path is tested, not just described.
- **[005] Discovery writes the initial snapshot but not the `latest_*` denorm.** Step 4 inserts a `metric_snapshot` from search-result metrics without updating the post's `latest_*`/`latest_snapshot_at`, violating 001's "denormalized from newest snapshot" semantics for up to one cron cycle and making 008's pending indicator misread a post that HAS a snapshot. One-line fix: set the denorm columns in the same insert transaction.
- **[002] Placeholder creator's `profile_url` is unspecified.** `creators.profile_url` is `NOT NULL`, but a handle-less (placeholder) creation has no profile URL. Pick one (recommended: the canonical post URL until the 004 merge resolves the real handle) and state it.
- **[008/010] Placeholder display fallback undefined.** 010 seeds a placeholder creator to "prove placeholder rendering", but 008 never says what renders for a `placeholder:<id>` handle with `display_name: null` (raw synthetic handle vs. an "Unresolved creator" label). Pick one and add it to 008's board-table bullet.
- **[009] Part B "Depends on" still omits 003** even though `admin.refreshPost` calls the spec 003 provider directly (003 is only reachable transitively via 004). Carried from the prior review; sequencing happens to work, but the metadata is incomplete. Add 003.
- **[002] `alreadyTracked` vs. the 20/24h rate limit** remains unstated (carried, low impact). "Count in DB" implies deduped attempts don't count (no row inserted); one sentence would pin it — note that the flow checks the limit (step 2) before dedup (step 4), so a deduped attempt still consumes a check but not a slot.
- **[003/005] Files-to-Modify lists `.env.example` but not `src/env.ts`** for the vars each spec introduces (`SOCIALDATA_API_KEY`/`APIFY_TOKEN`/`METRICS_PROVIDER`; `X_DISCOVERY_*`). 000's AC only checks `.env.example ⊇ env.ts`, which doesn't catch a var missing from `env.ts`. Add the `src/env.ts` modify line to both, matching 004's pattern.

## Cross-Spec Issues

- Revision Item #3 (007↔008 pending discriminator) is the only open cross-spec issue. Prior cross-spec issues #1–#5 are all resolved (see verification above).

## Missing Coverage

- Unchanged from prior review: anti-gaming (future spec 011), creator claim flow (cut with its column), real audit table (KNOWN_ISSUES debt), observability beyond structured logs — all conscious, acceptable omissions for MVP.

## Deferred Items (YAGNI) — correctly out of scope for MVP

- Compliant API upgrade paths (TikTok creator OAuth, IG Business Discovery) — post-v1, interface kept ready.
- Per-platform scoring weights — single `DEFAULT_WEIGHTS` in v1.
- Full-archive X search, roles table, real audit table, anti-gaming spec 011.

## Ambiguities Needing Human Input

None. All three revision items have a single obvious fix (the recommendations above); no product or architecture decision is open. This is why no clarifying questions were raised this round.

## Verdict Rationale

All four human decisions from the prior review landed correctly and consistently. NEEDS_REVISION rests on three mechanical authoring fixes: a spec-003 AC that still encodes the rejected fail-fast behavior (a TDD builder would test-and-cement the wrong branch), the stale OPEN DECISION banner contradicting the DECIDED vendors, and the 007 DTOs lacking the field 008's new pending state needs (allow-list DTOs make this a spec-time decision, not a build-time patch). ~15 minutes of edits, then re-run `./loop.sh spec-review` for an expected APPROVED.
