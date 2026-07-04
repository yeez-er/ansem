# Spec Review

**Status:** NEEDS_REVISION
**Date:** 2026-07-05 (3rd review; prior re-review 2026-07-05, fixes landed in 1fb9851)
**Specs reviewed:** 000-app-scaffold, 001-data-model, 002-url-submission, 003-metrics-providers, 004-ingestion-cron, 005-x-discovery, 006-scoring, 007-leaderboard-api, 008-leaderboard-ui, 009-auth-admin, 010-seed-data

## Prior-Findings Verification (all 3 blockers + all 7 nits resolved ✓)

1. **[003] AC vs. null-skip prose** — RESOLVED. AC #1 now asserts mock-in-dev, `null`-registry + caller-visible skip in production, and "mock never selected in production". No fail-fast remnant.
2. **[003] Stale OPEN DECISION banner** — RESOLVED. Context now reads "Risk posture — DECIDED 2026-07-05 (Yasser)" with vendors, pricing envelope, and fallback; Implementations line matches ("DECIDED", adapters are v1 against recorded fixtures).
3. **[007↔008] Pending state unrenderable** — RESOLVED. `PublicPost` carries `latestSnapshotAt: string | null` (included in the exact-keys allow-list test); never-snapshotted creators are excluded from ranked boards explicitly (all-time) and via the `>= window.start − 2d` NULL-failing bound (daily). 008's em-dash rule now has a data path.
4. **[004] Skip-path AC** — RESOLVED. `skipped` added to the response shape and AC #8 covers the unconfigured-platform path end to end (no snapshot, `latest_snapshot_at` untouched, exactly one structured warning).
5. **[005] Discovery denorm** — RESOLVED. Step 4 sets `latest_*` + `latest_snapshot_at` in the same transaction, with the shared-invariant note.
6. **[002] Placeholder `profile_url`** — RESOLVED (canonical post URL as stand-in). See Minor Note #1 for the follow-through gap on resolution.
7. **[002] `alreadyTracked` vs. quota** — RESOLVED (quota = posts actually INSERTED; duplicates don't consume it; auth/ban checks still apply).
8. **[008/010] Placeholder display** — RESOLVED ("Unclaimed creator" + platform badge, never the raw synthetic handle).
9. **[009] Part B depends on 003** — RESOLVED (dependency + rationale stated).
10. **[003/005] `src/env.ts` registration** — RESOLVED in both files tables. Same drift class remains in 009 — see Minor Note #3.

## Per-Spec Findings

### 000-app-scaffold.md — APPROVED

No issues.

### 001-data-model.md — APPROVED (touched by Revision Item #1)

Sound on its own; `platform_post_id` = "canonical id parsed from the URL" and `url` = "canonical URL rebuilt from platform + id" are unsatisfiable at insert time for TikTok short links — see Revision Item #1.

### 002-url-submission.md — NEEDS_REVISION (Revision Item #1)

### 003-metrics-providers.md — NEEDS_REVISION (Revision Item #1)

### 004-ingestion-cron.md — NEEDS_REVISION (Revision Item #1; Minor Notes #1, #7)

### 005-x-discovery.md — APPROVED

No issues (X-only; short-link lifecycle doesn't apply).

### 006-scoring.md — APPROVED (Minor Note #5)

### 007-leaderboard-api.md — APPROVED (Minor Notes #4, #5)

### 008-leaderboard-ui.md — APPROVED (Minor Note #6)

### 009-auth-admin.md — APPROVED (Minor Note #3)

### 010-seed-data.md — APPROVED (Minor Note #2)

## Revision Items (must fix before planning)

1. **[002↔001↔003↔004] TikTok short-link identity lifecycle is unspecified — and it's a dedupe bypass on TikTok's default share format.** `vm.tiktok.com/<code>` is what the TikTok mobile app puts on the clipboard, so this is the MAIN TikTok submission path, not an edge case. The specs currently contradict each other and leave the resolution mechanics with no data path:
   - 002's parser is pure ("no I/O"), so for a short link it cannot produce the "numeric video id" that 001 requires for `platform_post_id` (and the canonical URL for `url`). What the post row holds before resolution is never stated — presumably the short code, which violates 001's column contracts.
   - 003 says the Apify adapter "resolves `vm.tiktok.com` short links to canonical video ids on first fetch", but `PostMetrics` has NO field to carry the resolved id/URL back to the caller (`authorHandle` exists to resolve placeholder creators; nothing resolves post identity). Under the specified interface, write-back is impossible.
   - 004 has no write-back step, and no handling for the collision when the resolved canonical id already exists as another row — `UNIQUE(platform, platform_post_id)` makes that a crash path. Meanwhile the same video submitted as a short link by one fan and a canonical link by another creates TWO approved rows that BOTH score: a double-count gaming vector on a competition leaderboard, silently bypassing the dedupe gate that 001 calls the core invariant.
   - **Why it blocks**: the plan would contain a 002 parser task, a 003 adapter task, and a 004 write task that each hit this hole and improvise incompatibly mid-build; the interface types have exact-shape tests, so this must be pinned now (same class as the prior round's `latestSnapshotAt` blocker). Fix options are in "Ambiguities Needing Human Input" below — one small product decision, then ~10 lines of spec edits.

## Minor Notes (fix opportunistically; none block planning once the item above lands)

1. **[004] Placeholder rename branch should also fill the profile fields.** 002 sets the placeholder's `profile_url` to the post URL "as a stand-in until resolution", and the provider returns `authorDisplayName`/`authorAvatarUrl` — but 004's merge/rename step only touches `handle`. Nothing ever fixes `profile_url`, so 008's creator header ("link to profile at source") would link to a post forever. One sentence in 004 step 4: rename branch also sets `display_name`, `avatar_url`, and rebuilds `profile_url` from the resolved handle.
2. **[010] "Depends on" omits 007.** 010's post-seed smoke check and AC #3 run "through the real leaderboard query layer" (spec 007 code), and 007's Context already lists 010 as a consumer — but 010's own header says "Depends on: 001, 006". A planner topo-sorting from Depends-on lines could legally schedule 010 before 007 and strand the seed task on an unimplementable AC. Add 007 (or scope the smoke check as "if 007 has landed").
3. **[009] Files table lists `.env.example` but not `src/env.ts`**, though Part A's prose registers both (Clerk keys, `ADMIN_USER_IDS`). Same drift class fixed in 003/005 last round; mirror the fix.
4. **[007] `ScoreSummary` is referenced but never defined.** `leaderboard.creator` returns `alltime`/`daily` as `ScoreSummary`; 008's stat tiles need all-time score, today's score, total views, posts count. These DTOs are allow-list-constructed with exact-key tests, so pin the keys (suggest `{ score, views, likes, comments, shares, postCount }`, counts as strings).
5. **[006↔007] Tie-break `postedAt` is undefined for creator-level entries.** `rankEntries` tie-breaks by "earliest `postedAt`", but board entries are per-creator aggregates with no natural `postedAt`. Total order survives either way via the id fallback (pagination is safe); only tie ordering varies. Pin it: earliest approved post's `posted_at`, else skip straight to id.
6. **[008] The pending em-dash rule sits under the board-table bullet**, but board rows are creators — and never-observed creators are excluded per 007, so the state can't appear there. It actually renders on creator-page post rows and the recent-posts ticker (both carry `PublicPost.latestSnapshotAt`). Move/clarify the sentence so the builder wires it in the right components.
7. **[004] `degraded: true` isn't in the response shape.** The Guards section adds it conditionally; list it as an optional field in the step-5 response object so the route's response type is complete.

## Cross-Spec Issues

- Revision Item #1 spans 001/002/003/004 (post-identity canonicalization). No other open cross-spec issues; all prior ones verified resolved.

## Missing Coverage

- Unchanged from prior reviews and still acceptable for MVP: anti-gaming beyond dedupe (future spec 011), creator claim flow (cut with its column), real audit table (KNOWN_ISSUES debt), observability beyond structured logs.

## Deferred Items (YAGNI) — correctly out of scope for MVP

- Compliant API upgrade paths (TikTok creator OAuth, IG Business Discovery) — post-v1, interface kept ready.
- Per-platform scoring weights — single `DEFAULT_WEIGHTS` in v1.
- Full-archive X search, roles table, real audit table, anti-gaming spec 011.

## Ambiguities Needing Human Input

**One product decision (Revision Item #1): how should `vm.tiktok.com` short links be handled?**

- **(a) Resolve at submit time — RECOMMENDED.** `submissions.submit` follows the short-link redirect server-side (one HEAD/GET, 5s timeout, try-catch per the external-services rule) to get the canonical URL, re-parses, and proceeds down the normal path. The DB only ever holds canonical ids → dedupe stays airtight, no interface change, no write-back, no collision case; `needsResolution` disappears from 002/003 entirely. Failure → typed `BAD_REQUEST` "couldn't resolve short link — paste the full TikTok URL". Cost: one outbound HTTP call inside a user-facing mutation (bounded by the 20/day quota).
- **(b) Reject short links.** Simplest — parser returns `null` for `vm.tiktok.com`, error message tells the user to paste the full link. Cuts real scope but adds friction on TikTok's default mobile share format.
- **(c) Resolve at first fetch (current implied intent, fully specified).** Keep `needsResolution`; store the short code as interim `platform_post_id`; add `resolvedPlatformPostId`/`resolvedUrl` to `PostMetrics`; 004 writes back the canonical id + URL in the per-post transaction, and on UNIQUE collision treats the row as a duplicate (mirror the placeholder-merge: keep the existing canonical row, mark the short-link row `removed`). Most spec surface, and posts carry non-canonical identity until first refresh.

(This session is non-interactive, so the choice is documented here instead of via interactive questions. Any of the three unblocks planning; edit 002 — and 003/004 if (c) — accordingly.)

## Verdict Rationale

All ten prior findings (3 blockers, 7 nits) landed correctly and consistently — the spec set is one item away from APPROVED. NEEDS_REVISION rests solely on the TikTok short-link identity lifecycle: the main TikTok submission path currently has contradictory column contracts, a resolution mechanism with no data path in the provider interface, and a dedupe bypass that double-counts scores on a competition board. One small product decision + ~10 lines of spec edits, then re-run `./loop.sh spec-review`.
