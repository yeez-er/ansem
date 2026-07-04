# Spec Review

**Status:** APPROVED
**Date:** 2026-07-05 (4th review; round-3 fixes landed in 465fa83)
**Specs reviewed:** 000-app-scaffold, 001-data-model, 002-url-submission, 003-metrics-providers, 004-ingestion-cron, 005-x-discovery, 006-scoring, 007-leaderboard-api, 008-leaderboard-ui, 009-auth-admin, 010-seed-data

## Prior-Findings Verification (round-3 blocker + all 7 nits resolved ✓)

1. **[002↔001↔003↔004] TikTok short-link identity (the blocker)** — RESOLVED via option (a), resolve-at-submit-time, and the fix is coherent end to end:
   - 002: parser stays pure (`needsResolution: true` + `platformPostId: null` for `vm.tiktok.com`); the SUBMIT procedure follows the redirect ONCE (`redirect: 'manual'`, `Location` header only, 5s timeout, try-catch) and re-parses. Failure → typed `BAD_REQUEST` / `UNRESOLVABLE_URL`. Two new ACs pin the behavior: short-link + canonical submissions dedupe to ONE row (mocked redirect, row-count assert), and unresolvable links create NO creator/post rows.
   - 003: the contradictory "Apify resolves short links on first fetch" claim is gone, replaced by "short links never reach providers … every `PostRef` carries a canonical id". `PostMetrics` needs no write-back fields — correct under option (a).
   - 004: needs (and has) no write-back or collision branch — the collision case no longer exists because persistence only ever sees canonical ids.
   - 001: untouched and now satisfiable — `platform_post_id`/`url` column contracts hold because the id is parsed from the resolved canonical URL before any insert. The dedupe gate (`UNIQUE(platform, platform_post_id)`) is airtight again; the double-count gaming vector is closed.
2. **[004] Placeholder rename fills profile fields** — RESOLVED. Step 4's rename branch now also sets `display_name`, `avatar_url`, and rebuilds `profile_url` from platform + resolved handle.
3. **[010] Depends-on omits 007** — RESOLVED. Header now reads "Depends on: specs 001, 006, 007" with the "seed must be planned AFTER the leaderboard queries exist" rationale.
4. **[009] `src/env.ts` missing from files table** — RESOLVED. Files table row now reads `.env.example` + `src/env.ts`.
5. **[007] `ScoreSummary` undefined** — RESOLVED. Pinned as `{ score, views, likes, comments, shares, postCount }`, counts as strings, same serialization rule as entries.
6. **[006↔007] Creator-level tie-break `postedAt`** — RESOLVED. Pinned: earliest `posted_at` among the posts contributing to the entry's score (in-window for daily, all approved for all-time), falling back to the creator's `created_at` when no post has a known `posted_at`. Total order preserved either way.
7. **[008] Pending em-dash rule under the wrong bullet** — RESOLVED. Now scoped to "anywhere post-level stats render (ticker cards, creator-page posts table)" — the surfaces that actually carry `PublicPost.latestSnapshotAt`.
8. **[004] `degraded` absent from response shape** — RESOLVED. Step-5 response is `{ selected, refreshed, removed, skipped, errors, durationMs, degraded }` with both `skipped` and `degraded` defined inline.

## Per-Spec Findings

### 000-app-scaffold.md — APPROVED

No issues.

### 001-data-model.md — APPROVED

Column contracts for `platform_post_id`/`url` are now satisfiable at insert time on every path (submit-time resolution guarantees canonical identity before persistence).

### 002-url-submission.md — APPROVED (Minor Notes #1, #2)

### 003-metrics-providers.md — APPROVED

Consistent with 002's submit-time resolution; provider interface unchanged and sufficient.

### 004-ingestion-cron.md — APPROVED

### 005-x-discovery.md — APPROVED

### 006-scoring.md — APPROVED

### 007-leaderboard-api.md — APPROVED

### 008-leaderboard-ui.md — APPROVED

### 009-auth-admin.md — APPROVED

### 010-seed-data.md — APPROVED

## Minor Notes (non-blocking; pin during planning or fix opportunistically)

1. **[002] `ParsedPost.canonicalUrl` is unpinned for `needsResolution` results.** The parse table's canonical form (`https://www.tiktok.com/@<handle>/video/<id>`) is unbuildable for a short link pre-resolution, yet `canonicalUrl` is non-nullable and the parser has exact table-driven tests (AC #1 includes a `vm.tiktok.com` case) — two builders could assert different expected values. The value is discarded after resolution, so any consistent choice works; suggest one sentence: for `needsResolution` results, `canonicalUrl` = the normalized short link (`https://vm.tiktok.com/<code>`), which the submit procedure uses as the resolution fetch target.
2. **[002] Resolution fetches aren't counted by any limit.** The 20/day quota counts posts actually INSERTED, and duplicates/failures insert nothing — so an authenticated user can submit short links repeatedly and drive one outbound fetch (up to 5s) per call with zero quota consumption. Surface is small (auth-gated, fetch host is fixed at `vm.tiktok.com` by the parser, `Location` is re-parsed but never fetched — no SSRF), but it is the only unmetered outbound call in the app. Cheap hardening when building the procedure: count resolution _attempts_ in the rolling 24h limit (or a separate per-user resolution cap), and run the quota check before the fetch.

## Cross-Spec Issues

None open. The short-link lifecycle now reads identically from 001 (column contracts), 002 (resolution mechanics + ACs), 003 (providers receive canonical ids only), and 004 (no residual write-back path).

## Missing Coverage

Unchanged from prior reviews and still acceptable for MVP: anti-gaming beyond dedupe (future spec 011), creator claim flow (cut with its column), real audit table (KNOWN_ISSUES debt), observability beyond structured logs.

## Deferred Items (YAGNI) — correctly out of scope for MVP

- Compliant API upgrade paths (TikTok creator OAuth, IG Business Discovery) — post-v1, interface kept ready.
- Per-platform scoring weights — single `DEFAULT_WEIGHTS` in v1.
- Full-archive X search, roles table, real audit table, anti-gaming spec 011.

## Verdict Rationale

The round-3 blocker landed as the recommended option (a) and every touched spec agrees with it — the dedupe invariant holds on all submission paths, and no provider/cron write-back machinery was left behind. All 7 nits verified fixed. The two remaining notes are one-sentence clarifications confined to spec 002 that don't change any cross-spec interface; they should be pinned during planning but do not justify another revision round. Proceed to `./loop.sh plan`.
