// Spec 003: deterministic mock provider — the dev fallback when a platform has
// no configured live adapter. Same (platform, platformPostId) under the same
// clock → identical metrics; advancing the clock grows views strictly and
// engagement monotonically. Never rejects.
import { fnv1a } from "@/lib/hash";
import type { Platform } from "@/lib/post-url";
import type {
  MetricsProvider,
  MetricsResult,
  PostMetrics,
  PostRef,
} from "./provider";

// Mock posts are anchored in the past (Jan–Mar 2026) independent of the
// current clock, so postedAt never drifts between calls and elapsed time —
// the growth driver — is always positive under any realistic test clock.
const POSTED_AT_ANCHOR_MS = Date.UTC(2026, 0, 1);
const POSTED_AT_SPREAD_MS = 90 * 24 * 60 * 60 * 1000;

export class MockMetricsProvider implements MetricsProvider {
  constructor(public readonly platform: Platform) {}

  async fetchMetrics(refs: PostRef[]): Promise<Map<string, MetricsResult>> {
    const results = new Map<string, MetricsResult>();
    if (!Array.isArray(refs)) return results;

    for (const ref of refs) {
      // Uphold the never-rejects contract even against malformed refs: a ref
      // without a string id has no Map key to report an error under, so it is
      // skipped rather than allowed to throw.
      if (typeof ref?.platformPostId !== "string") continue;
      results.set(ref.platformPostId, {
        ok: true,
        metrics: this.metricsFor(ref.platformPostId),
      });
    }
    return results;
  }

  private metricsFor(platformPostId: string): PostMetrics {
    const seed = fnv1a(`${this.platform}:${platformPostId}`);
    const now = Date.now();

    const postedAtMs = POSTED_AT_ANCHOR_MS + (seed % POSTED_AT_SPREAD_MS);
    const elapsedSeconds =
      now > postedAtMs ? BigInt(Math.floor((now - postedAtMs) / 1000)) : 0n;

    // Views grow strictly with the clock (≥ 1 per second); engagement is a
    // fixed per-post fraction of views, so it never decreases. Divisors are
    // structurally positive (constant + non-negative remainder).
    const viewsPerSecond = 1n + BigInt(seed % 5);
    const views =
      500n + BigInt(seed % 100_000) + elapsedSeconds * viewsPerSecond;
    const likes = views / (7n + BigInt(seed % 20));
    const comments = views / (40n + BigInt(seed % 60));
    const shares = views / (90n + BigInt(seed % 110));

    return {
      views,
      likes,
      comments,
      shares,
      capturedAt: new Date(now),
      postedAt: new Date(postedAtMs),
      authorHandle: `mockcreator${seed % 997}`,
      authorDisplayName: `Mock Creator ${seed % 997}`,
      authorAvatarUrl: `https://example.com/avatars/${seed % 997}.png`,
    };
  }
}
