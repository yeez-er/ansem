# Spec 005: X Post Discovery (feature-flagged)

## Goal

Automatically discover new X posts about $ANSEM via the official X API recent search, so X creators appear on the leaderboard without submitting anything.

## Context

- Depends on: specs 001, 003 (shares the X client/auth). Optional at runtime: the whole feature is OFF unless `X_BEARER_TOKEN` and `X_DISCOVERY_ENABLED=true` are set — the product must work fully on submissions alone.
- ⚠️ OPEN DECISION (owner: Yasser): X API tier. Basic (~$200/mo) gives 7-day recent search with a monthly post-read cap — the query budget below assumes Basic. Cashtag operator availability on Basic must be verified during implementation; the query falls back to keyword terms if `$ANSEM` cashtag search is tier-locked.
- TikTok/Instagram have NO equivalent discovery path (official keyword search is unavailable to commercial apps) — do not add placeholder discovery code for them.

## Route: `POST /api/cron/discover-x`

Schedule: hourly (`0 * * * *`), same `CRON_SECRET` bearer auth + constant-time compare as spec 004.

1. **Query**: `X_SEARCH_QUERY` env, default `"($ANSEM OR ansem) -is:retweet has:videos OR has:images"` — exact operator set finalized in implementation against current X docs; must exclude retweets.
2. **Pagination cursor**: store `since_id` in a single-row `discovery_state` table (`platform` pk, `cursor` text, `updated_at`) so each run only reads NEW posts. First run: last 24h only.
3. **Budget**: max `X_DISCOVERY_PAGES_PER_RUN` pages (default 3, 100 results each) per run — a viral spike cannot burn the monthly read cap in one day. Log posts-read-this-run; if the page budget was hit, log `truncated: true` (visible, not silent).
4. **For each result** (author expansion in the same request — no N+1 lookups):
   - Upsert creator by `(platform='x', handle)`; skip if `is_banned`
   - Insert post `status: 'approved'`, `source: 'x_search'` — `onConflictDoNothing` on `(platform, platform_post_id)` (already-submitted posts stay as they are)
   - Write an initial `metric_snapshot` from the search result's `public_metrics` (search already returns them — no extra fetch)
5. Update `since_id` cursor ONLY after the batch commits (crash-safe: re-run re-reads, UNIQUE gate dedupes).

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/server/db/schema/discovery-state.ts` | CREATE + export from barrel + migration |
| `src/app/api/cron/discover-x/route.ts` | CREATE |
| `src/server/discovery/discover-x.ts` | CREATE — orchestration, unit-testable with mocked X client |
| `src/server/metrics/x-client.ts` | CREATE — shared low-level X fetch used by this + spec 003's provider |
| `vercel.json` | MODIFY — second cron entry |
| `.env.example` | MODIFY — `X_DISCOVERY_ENABLED`, `X_SEARCH_QUERY`, `X_DISCOVERY_PAGES_PER_RUN` |

## Acceptance Criteria

- [ ] With `X_DISCOVERY_ENABLED` unset/false the route responds `{ skipped: true }` and makes zero X calls (assert the mock client was never invoked)
- [ ] A mocked search page of 3 results creates 3 posts + 3 creators + 3 snapshots; re-running the same page creates nothing new (idempotence via UNIQUE gates, assert row counts)
- [ ] A result from a banned creator creates no post
- [ ] A result whose post id already exists (submitted earlier) does not change that post's `status` or `source`
- [ ] Cursor advances only after successful processing: a mocked mid-batch DB failure leaves `since_id` unchanged
- [ ] Page budget is enforced: mocked 5-page response with budget 3 reads exactly 3 pages and reports `truncated: true`
- [ ] 429 from X → run aborts gracefully with `degraded: true`, cursor unchanged, 200 response
