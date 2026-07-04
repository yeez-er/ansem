# Spec 003: Metrics Provider Layer

## Goal

A pluggable provider layer that, given a tracked post, returns its current public metrics (views, likes, comments, shares) — regardless of which upstream (official API, third-party data API, mock) supplies them.

## Context

- Depends on: spec 001. Consumed by: spec 004 (cron calls providers), spec 005 (X discovery shares the X client).
- **Platform reality**: TikTok and Instagram official APIs only expose view counts for the authenticated account's own media, so public-post metrics come from a third-party data provider. X metrics can come from the official API (paid) or the same third-party route.
- ⚠️ OPEN DECISION (owner: Yasser): which third-party provider (Apify / EnsembleData / ScrapeCreators class) and X API tier. The interface below is provider-agnostic so this decision only touches one adapter file. Until decided, only `MockMetricsProvider` runs in dev/test.

## Interface

```ts
// src/server/metrics/provider.ts
export type PostRef = { platform: Platform; platformPostId: string; url: string };
export type PostMetrics = {
  views: bigint; likes: bigint; comments: bigint; shares: bigint;
  authorHandle: string | null;      // providers may resolve placeholder creators
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
  postedAt: Date | null;
  capturedAt: Date;
};
export type MetricsResult =
  | { ok: true; metrics: PostMetrics }
  | { ok: false; error: 'NOT_FOUND' | 'RATE_LIMITED' | 'PROVIDER_ERROR'; retryable: boolean };

export interface MetricsProvider {
  readonly platform: Platform;
  fetchMetrics(refs: PostRef[]): Promise<Map<string, MetricsResult>>; // keyed by platformPostId
}
```

- `fetchMetrics` takes a batch (bounded by caller, spec 004) and NEVER throws — every upstream failure maps to a typed `MetricsResult` error. All HTTP calls wrapped in try-catch with a timeout (10s default).
- `NOT_FOUND` means the post is gone at source → caller marks post `removed`.
- A provider registry `getProvider(platform)` selects the implementation from env config; missing config for a platform returns the mock in dev and throws a typed startup error in production (fail fast, not per-request).

## Implementations (v1)

1. **`MockMetricsProvider`** (all platforms) — deterministic pseudo-random growth seeded by `platformPostId` (same post → same curve), so dev/e2e leaderboards are stable across runs. Always available; selected when `METRICS_PROVIDER=mock` or env keys are absent in dev.
2. **`ThirdPartyMetricsProvider`** (tiktok, instagram, optionally x) — adapter over the chosen data API. One file; blocked on the OPEN DECISION. Resolves `vm.tiktok.com` short links (spec 002 `needsResolution`) to canonical video ids on first fetch.
3. **`XApiMetricsProvider`** (x) — official X API v2 `GET /2/tweets` batch lookup (up to 100 ids/call) reading `public_metrics` (`impression_count`, `like_count`, `reply_count`, `retweet_count + quote_count` as shares). Enabled only when `X_BEARER_TOKEN` is set. Honors 429s by returning `RATE_LIMITED` with `retryable: true`.

## Env & Config

| Var | Purpose |
|-----|---------|
| `METRICS_PROVIDER` | `mock` \| `thirdparty` (per-platform override vars allowed: `METRICS_PROVIDER_X`, etc.) |
| `X_BEARER_TOKEN` | official X API (optional) |
| `THIRDPARTY_API_KEY` / `THIRDPARTY_BASE_URL` | data provider credentials (name will change with the decision) |

Document all of these in `ralph/AGENTS.md` External Services table with dev fallbacks.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/server/metrics/provider.ts` | CREATE — types + registry |
| `src/server/metrics/mock-provider.ts` | CREATE |
| `src/server/metrics/x-api-provider.ts` | CREATE (feature-flagged) |
| `src/server/metrics/thirdparty-provider.ts` | CREATE (adapter skeleton + mock-backed until provider chosen) |
| `.env.example` | MODIFY — add vars above |

## Acceptance Criteria

- [ ] Registry returns mock provider in dev when no keys configured; throws typed config error in production
- [ ] Mock provider is deterministic: two calls for the same post id return identical metrics within a fixed fake-timer clock (pin the clock — no ambient `Date.now()` in tests)
- [ ] X provider maps a mocked 429 response to `{ ok: false, error: 'RATE_LIMITED', retryable: true }` — assert the exact error object
- [ ] X provider maps a deleted-tweet response to `NOT_FOUND`
- [ ] No provider method ever rejects: adversarial test feeds a provider a fetch that throws and asserts a resolved `PROVIDER_ERROR` result (control-test the matcher: prove the test fails against a provider that rethrows)
- [ ] All counts surface as bigint; a mocked X response with `impression_count: 3000000000` survives round-trip
