# Spec Review

**Status:** NEEDS_REVISION
**Date:** 2026-07-05
**Specs reviewed:** 000-app-scaffold, 001-data-model, 002-url-submission, 003-metrics-providers, 004-ingestion-cron, 005-x-discovery, 006-scoring, 007-leaderboard-api, 008-leaderboard-ui, 009-auth-admin, 010-seed-data

Overall: these specs are high quality — detailed acceptance criteria, strong edge-case coverage, security/atomicity called out explicitly, and the weekly→daily migration is clean (the only remaining "weekly" mention, in spec 006, is a deliberate "add later" note, not a contradiction). The revisions below are targeted: 4 items need a human decision, plus a handful of minor authoring fixes. None indicate a rethink — they're the ambiguities that would otherwise surface as wasted build iterations.

## Per-Spec Findings

### 000-app-scaffold.md

**Status:** APPROVED

- Solid milestone-zero frame. Only `publicProcedure` is scaffolded here; `protectedProcedure`/`adminProcedure` are deferred to spec 009 — see Cross-Spec #1, which this ordering creates.
- `.env.example` seed list (line 20) omits `AUTO_APPROVE_SUBMISSIONS` (spec 002) and `MAX_PROVIDER_CALLS_PER_RUN` (spec 004). Line 21 says "every var known so far" and each spec adds its own as it lands — but 002 and 004 don't list `.env.example`/`src/env.ts` in their Files-to-Modify, so the convention isn't enforced. See Cross-Spec #2.

### 001-data-model.md

**Status:** APPROVED (with one clarification, Cross-Spec #3)

- Schema is thorough: bigint counts end-to-end, UNIQUE on natural keys (not the uuid pk), append-only snapshots, `(post_id, captured_at desc)` index, `latest_*` denorm with both a writer (004) and reader (007). No dead-index/UNIQUE duplication.
- `handle` is `text NOT NULL` + `UNIQUE(platform, handle)`. This collides with spec 002's handle-less placeholder creators (IG shortcode submissions). See Cross-Spec #3.
- `claimed_by_user_id` (line 32) is never written or read in any v1 spec — a dead column. See Decision #4 / Deferred Items.
- `posts.platform` is denormalized from creator with "must always match" but no DB-level enforcement (no composite FK). Acceptable for v1; note it as an invariant the writers (002/004/005) must uphold.

### 002-url-submission.md

**Status:** NEEDS_REVISION

- Uses Clerk `protectedProcedure` and a session user id, but "Depends on:" lists only spec 001. The auth core that provides `protectedProcedure` + Clerk context lives in spec 009. AC "Unauthenticated call fails with UNAUTHORIZED" cannot be built until that core exists. See Cross-Spec #1 (Decision #1).
- Placeholder-creator path (line 31, "else create placeholder creator") is underspecified: what `handle` value satisfies `NOT NULL` + `UNIQUE(platform, handle)` when the submitted URL carries no handle (IG shortcodes)? See Cross-Spec #3 (Decision #3).
- Introduces `AUTO_APPROVE_SUBMISSIONS` env var but doesn't list `.env.example`/`src/env.ts` in Files-to-Modify. Minor (Cross-Spec #2).
- Minor: whether a deduped (`alreadyTracked`) attempt counts toward the 20/24h rate limit is unstated. Low impact; pick one and note it.

### 003-metrics-providers.md

**Status:** APPROVED (blocked-but-buildable on an OPEN DECISION)

- Provider interface is clean, never-throws, typed results, bigint round-trip, deterministic mock with pinned clock. All v1 AC are satisfiable on mock + optional X official API.
- The third-party vendor choice is an explicit OPEN DECISION (owner: Yasser). It does NOT block MVP build (TikTok/IG run on `MockMetricsProvider` until decided), but it DOES decide what real data the board shows at launch. See Decision #2.
- Minor: `getProvider` "throws a typed startup error in production" when a platform's config is missing — confirm that's desired even if v1 intentionally ships mock-only for TikTok/IG (otherwise a prod deploy with no third-party key would fail fast on boot). Tie to Decision #2.

### 004-ingestion-cron.md

**Status:** APPROVED

- Constant-time secret compare, stalest-first bounded selection, per-post transaction, `NOT_FOUND`→removed with snapshot retention, degraded-mode at >50% errors, idempotent (scoring reads deltas, never sums). Strong.
- `MAX_PROVIDER_CALLS_PER_RUN` (Guards) is not in the `.env.example` Files-to-Modify list. Minor (Cross-Spec #2).
- Placeholder→real creator merge (line 18, "merge-on-conflict with existing (platform, handle) creator") is the resolution half of Cross-Spec #3; it needs the placeholder-identity scheme defined in 001/002 to be implementable, and needs to specify re-pointing posts when two placeholders collapse into one real creator.

### 005-x-discovery.md

**Status:** APPROVED

- Feature-flagged off by default, cursor in `discovery_state`, page budget, crash-safe cursor advance, idempotent via UNIQUE gates, 429→degraded. Cashtag risk is explicitly flagged as UNVERIFIED with a smoke-test-first fallback. Well scoped.
- Confirm `discovery_state` migration + barrel export land with this spec (it does say so) — it's the one schema table defined outside spec 001, so verify registration.

### 006-scoring.md

**Status:** APPROVED (one clarity nit)

- Pure, bigint-only, UTC-only `dayWindow`, clamp-to-zero deltas, competition ranking with a full tie-break chain. Excellent testability.
- Line 34 wording: "Assigns dense ranks (1,2,2,4 → no: standard competition ranking 1,2,2,4)" is self-contradicting on the term "dense" (dense ranking is 1,2,2,3). Intent is clear from AC line 51 (standard competition ranking 1,2,2,4) — just tidy the prose so it doesn't mislead.
- Define the "no in-window snapshot" case explicitly (a post whose newest snapshot predates today's window): contribution = 0 / latest defaults to baseline. It's implied and covered by seed AC 010, but 007's prose ("latest = newest within the window") leaves the null-latest branch undefined. See Cross-Spec #5.

### 007-leaderboard-api.md

**Status:** APPROVED (depends on Cross-Spec #5 clarification)

- Public read-only, server-side ban/status filtering, allow-list DTOs with an exact-keys test, bigint-as-strings, cursor pagination with total-order tie-break, single-query daily board (no N+1), scan bounded to `window.start − 2d`, Next-native cache keyed on all inputs, `now` read once per request. Very complete.
- "latest = newest within window" (line 17) needs the null-latest branch pinned (Cross-Spec #5) so two implementers can't diverge (one using newest-in-window, one using `latest_*`). Both yield the same score IF the fallback is specified.

### 008-leaderboard-ui.md

**Status:** APPROVED

- Design direction is concrete enough to serve as the design spec + visual-verify source. Reuses `parsePostUrl` from 002 (no client copy — confirm it stays import-safe in a client component, which it is since it's pure). URL-state controls, empty/error states, truthiness-safe `stat-number` (0 renders 0), token mint in one constant, a11y on icon controls, both mutation callbacks. Nothing blocking.
- Depends on seed (010) landing before any UI task — ordering is stated; the plan must honor it.

### 009-auth-admin.md

**Status:** NEEDS_REVISION (structural — Cross-Spec #1)

- Bundles the auth CORE (Clerk middleware + tRPC context + `protectedProcedure`) together with the admin SURFACE (`adminProcedure`, admin router, `/admin` UI). The core is a prerequisite for spec 002; the surface is not. As written, a planner following "Depends on" edges places 002 before 009 and breaks. See Decision #1.
- `admin.refreshPost` uses the spec 003 provider but "Depends on:" lists 001/002/004 (003 only transitively via 004). Add 003 explicitly.
- Strong AC otherwise: server-side admin gate, empty-`ADMIN_USER_IDS`⇒no admins, `PRECONDITION_FAILED` on re-review, atomic ban+bulk-reject with a distinct-transaction race test, no auto-closing dialog on async actions.

### 010-seed-data.md

**Status:** APPROVED

- Idempotent by natural key, deterministic (no `Math.random`/ambient `Date.now`), story-shaped (daily winner ≠ all-time winner, banned creator with high-scoring posts, a placeholder creator, a post with all snapshots pre-window for the daily-0 test), verifies through the real query layer. Exemplary.
- Depends on the placeholder-creator scheme (Cross-Spec #3) to seed its "placeholder creator with display_name: null" without violating `handle NOT NULL`.

## Cross-Spec Issues

1. **Auth core is entangled with the admin surface (002 ↔ 009).** `protectedProcedure` + the Clerk-derived tRPC context (`{ userId, isAdmin }`) are created in spec 009, but spec 002's `submissions.submit` needs `protectedProcedure` and a session. Spec 002's dependency metadata omits this. Resolution options in Decision #1. This is the single most important item — it changes plan sequencing.

2. **Env-var registration drift.** `AUTO_APPROVE_SUBMISSIONS` (002) and `MAX_PROVIDER_CALLS_PER_RUN` (004) are referenced but their owning specs don't list `.env.example` / `src/env.ts` in Files-to-Modify. Spec 000's convention ("every spec adds its vars as they land") only holds if each spec states the modify. Add the modify line to 002 and 004. Low effort, prevents silent config drift.

3. **Placeholder-creator identity is undefined and conflicts with the schema (001 ↔ 002 ↔ 004).** `creators.handle` is `NOT NULL` + `UNIQUE(platform, handle)`, but 002 creates placeholder creators for handle-less submissions (IG shortcodes) and 004 later merges them to the real handle. Undefined: (a) what handle a placeholder gets at creation, (b) how a collision merges when two placeholders resolve to the same real handle, and (c) re-pointing the affected posts' `creator_id` during that merge. Resolution in Decision #3.

4. **`claimed_by_user_id` is a dead column in v1.** Present in the schema (001) but never written or read by any v1 spec (claim flow is explicitly future). Per project rules, dead denormalized columns should be dropped or formally accepted as debt. Resolution in Decision #4.

5. **Daily "no in-window snapshot" branch is undefined (006 ↔ 007).** For a post whose newest snapshot predates today's window, "latest = newest within window" has no value. Specify the fallback (contribution 0 / latest defaults to baseline) so implementers converge. Covered indirectly by seed AC 010 but not stated in prose.

## Missing Coverage

- **Anti-gaming / fraud detection** (velocity-anomaly on snapshot deltas) — intentionally deferred to a future spec 011 (noted in api-research). Correct YAGNI for MVP; called out so it's a conscious omission, not a gap.
- **Creator claim flow** — no spec; `claimed_by_user_id` exists but is inert (see #4).
- **Audit trail** — 009 uses structured `console.info` audit lines and explicitly defers a real audit table to KNOWN_ISSUES. Acceptable.
- No error-monitoring/observability spec beyond structured logs — acceptable for v1.

## Deferred Items (YAGNI) — correctly out of scope for MVP

- Third-party TikTok/IG metrics provider — pending owner decision; MVP runs on mock (Decision #2).
- Compliant API upgrade paths (TikTok creator OAuth, IG Business Discovery) — post-v1, interface kept ready.
- Per-platform scoring weights — deferred (006); single `DEFAULT_WEIGHTS` in v1.
- Full-archive X search, roles table, real audit table, anti-gaming spec 011.

## Decisions Needed Before Planning (human input)

1. **Auth core ordering (Cross-Spec #1).** Recommended: split spec 009 into "Clerk core" (middleware + tRPC context + `protectedProcedure`) built as a prerequisite before spec 002, and "admin surface" (`adminProcedure` + admin router + `/admin` UI) after. Alternatives: (b) sequence all of 009 before 002; (c) have 002 create a minimal `protectedProcedure` that 009 extends.
2. **v1 metrics scope for TikTok/Instagram (Cross-Spec / spec 003).** Recommended: launch v1 with mock-only metrics for TikTok/IG and real metrics for X (official API), wiring the chosen third-party provider later in one adapter file. Alternatives: (b) block v1 until a provider is chosen and real TikTok/IG data works; (c) X-only board for v1, drop TikTok/IG until a provider exists.
3. **Placeholder-creator handle scheme (Cross-Spec #3).** Recommended: give placeholders a deterministic synthetic handle (e.g., `placeholder:<platformPostId>`), then at ingestion (004) resolve to the real handle and merge/re-point posts on `(platform, handle)` conflict. Alternatives: (b) make `handle` nullable and key uniqueness differently for placeholders; (c) reject handle-less submissions in v1 (drop IG shortcode support until resolvable).
4. **`claimed_by_user_id` dead column (Cross-Spec #4).** Recommended: drop it from the v1 schema and re-add when the claim flow ships. Alternative: keep it and log it as accepted debt in KNOWN_ISSUES with a comment.

## Verdict Rationale

Specs are strong and largely buildable, but four items need a human decision before planning — one structural (auth core vs admin surface ordering, #1), one product-scope (real vs mock TikTok/IG metrics at launch, #2), and two schema-integrity (placeholder-creator identity #3, dead column #4) — plus minor authoring fixes (env-var modify lines, the ranking prose nit, the daily null-latest branch). Resolving these now prevents the plan from sequencing 002 before its auth dependency and from generating placeholder creators that violate the schema.
