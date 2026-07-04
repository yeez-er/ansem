# Spec 004: Metric Ingestion (Cron)

## Goal

Scheduled refresh of every approved post's metrics: call the provider layer in bounded batches, append snapshots, update the posts' denormalized `latest_*` columns, and handle vanished posts — without ever letting a provider failure take the pipeline down.

## Context

- Depends on: specs 001, 003. Consumed by: specs 006/007 (snapshots feed scoring and leaderboards).
- Runs on Vercel Cron hitting a route handler. Schedule: every 30 minutes (`*/30 * * * *`) in `vercel.json`. One invocation must fit the function time budget — bound the work, don't try to finish everything.

## Route: `POST /api/cron/refresh-metrics`

1. **Auth**: require `Authorization: Bearer ${CRON_SECRET}` — compare with a constant-time comparison, never `===`. 401 otherwise. (Vercel Cron sends the secret when `CRON_SECRET` env is set.)
2. **Select work**: approved posts, not `removed`, creator not banned, ordered by `latest_snapshot_at ASC NULLS FIRST`, **`.limit(REFRESH_BATCH_SIZE)`** (default 200, env-tunable). Stalest-first means every post is eventually refreshed even if a run can't cover the full set; log how many were selected vs. total due so truncation is visible, not silent.
3. **Fetch**: group by platform → `provider.fetchMetrics(refs)` in sub-batches of ≤ 100.
4. **Write per post** (one transaction per post, so one bad row can't poison the batch):
   - `ok: true` → INSERT snapshot; UPDATE post `latest_* = metrics`, `latest_snapshot_at = capturedAt`; if the creator was a placeholder and `authorHandle` resolved, update creator (merge-on-conflict with existing `(platform, handle)` creator if one exists).
   - `NOT_FOUND` → set post `status = 'removed'` (keep snapshots — history stays on the board's past weeks).
   - `RATE_LIMITED` / `PROVIDER_ERROR` → leave post untouched (stalest-first re-queues it next run); increment a per-run error counter.
5. **Respond** `{ selected, refreshed, removed, errors, durationMs }` — also `console.info` one structured summary line for Vercel logs.

## Guards

- Total per-run provider-call budget: `MAX_PROVIDER_CALLS_PER_RUN` (default 10) sub-batches — a misconfigured batch size cannot fan out unbounded.
- If > 50% of a run's results are errors, respond 200 with `degraded: true` (cron must not retry-storm a struggling provider) and log at error level.
- Route is idempotent: re-running immediately re-selects the same stalest posts and appends new snapshots; scoring reads deltas (latest − baseline), never sums, so extra snapshots never inflate scores (spec 001/006 invariant).

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/app/api/cron/refresh-metrics/route.ts` | CREATE |
| `src/server/ingestion/refresh-metrics.ts` | CREATE — pure-ish orchestration extracted from the route for unit tests |
| `src/server/ingestion/select-due-posts.ts` | CREATE — the bounded query |
| `vercel.json` | CREATE/MODIFY — cron entry |
| `.env.example` | MODIFY — `CRON_SECRET`, `REFRESH_BATCH_SIZE` |

## Acceptance Criteria

- [ ] Request without/with wrong bearer secret → 401 with empty body; timing-safe compare verified by source verification (no `===` on the secret)
- [ ] Selection query respects the limit and the stalest-first order (seed 3 posts with distinct `latest_snapshot_at`, batch size 2 → the two stalest selected; `NULLS FIRST` covered)
- [ ] Banned-creator and `removed` posts are never selected
- [ ] `NOT_FOUND` result flips the post to `removed` and preserves existing snapshots (assert row count unchanged)
- [ ] A provider result batch of `[ok, PROVIDER_ERROR, ok]` writes 2 snapshots, leaves the failed post's `latest_snapshot_at` untouched, and reports `errors: 1`
- [ ] `latest_*` on the post equals the newest snapshot after refresh (the denormalization is written AND spec 007's reader consumes it — no dead columns)
- [ ] Cron entry exists in `vercel.json` with the exact route path (source verification)
