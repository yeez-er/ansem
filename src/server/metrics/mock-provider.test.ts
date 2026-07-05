// Task 8 (spec 003): MockMetricsProvider — deterministic seeded growth under a
// pinned fake-timer clock (zero ambient-time flakiness), bigint counts
// end-to-end, Map keyed by platformPostId, and the never-rejects provider
// contract with a control-tested matcher.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "@/lib/post-url";
import { MockMetricsProvider } from "./mock-provider";
import type { MetricsProvider, MetricsResult, PostRef } from "./provider";

const NOW = new Date("2026-07-06T12:00:00.000Z");

const ref = (id: string, platform: Platform = "x"): PostRef => ({
  platform,
  platformPostId: id,
  url: `https://example.com/${id}`,
});

// Narrow to the ok branch or fail loudly — keeps every assertion below
// unconditional (a not-ok result can never silently skip assertions).
function metricsOf(result: MetricsResult | undefined) {
  if (!result?.ok) {
    throw new Error(
      `expected an ok MetricsResult, got ${JSON.stringify(result)}`,
    );
  }
  return result.metrics;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MockMetricsProvider — determinism", () => {
  it("same post id + pinned clock → identical metrics across calls AND instances", async () => {
    const first = metricsOf(
      (await new MockMetricsProvider("x").fetchMetrics([ref("42")])).get("42"),
    );
    const second = metricsOf(
      (await new MockMetricsProvider("x").fetchMetrics([ref("42")])).get("42"),
    );
    expect(second).toEqual(first);
  });

  it("different post ids → different curves (seeded by platformPostId)", async () => {
    const map = await new MockMetricsProvider("x").fetchMetrics([
      ref("111"),
      ref("222"),
    ]);
    expect(metricsOf(map.get("111")).views).not.toBe(
      metricsOf(map.get("222")).views,
    );
  });

  it("same post id on different platforms → different curves", async () => {
    const onX = metricsOf(
      (await new MockMetricsProvider("x").fetchMetrics([ref("777", "x")])).get(
        "777",
      ),
    );
    const onTikTok = metricsOf(
      (
        await new MockMetricsProvider("tiktok").fetchMetrics([
          ref("777", "tiktok"),
        ])
      ).get("777"),
    );
    expect(onX.views).not.toBe(onTikTok.views);
  });

  it("batch order does not change per-post metrics", async () => {
    const provider = new MockMetricsProvider("instagram");
    const ab = await provider.fetchMetrics([
      ref("a", "instagram"),
      ref("b", "instagram"),
    ]);
    const ba = await provider.fetchMetrics([
      ref("b", "instagram"),
      ref("a", "instagram"),
    ]);
    expect(ba.get("a")).toEqual(ab.get("a"));
    expect(ba.get("b")).toEqual(ab.get("b"));
  });
});

describe("MockMetricsProvider — growth over time", () => {
  it("advancing the pinned clock grows views strictly and engagement monotonically", async () => {
    const provider = new MockMetricsProvider("tiktok");
    const before = metricsOf(
      (await provider.fetchMetrics([ref("abc", "tiktok")])).get("abc"),
    );

    vi.setSystemTime(new Date("2026-07-06T18:00:00.000Z"));
    const after = metricsOf(
      (await provider.fetchMetrics([ref("abc", "tiktok")])).get("abc"),
    );

    expect(after.views > before.views).toBe(true);
    expect(after.likes >= before.likes).toBe(true);
    expect(after.comments >= before.comments).toBe(true);
    expect(after.shares >= before.shares).toBe(true);
  });
});

describe("MockMetricsProvider — result shape", () => {
  it("all counts are bigint and non-negative; capturedAt is the pinned now", async () => {
    const metrics = metricsOf(
      (await new MockMetricsProvider("x").fetchMetrics([ref("42")])).get("42"),
    );
    for (const count of ["views", "likes", "comments", "shares"] as const) {
      expect(typeof metrics[count]).toBe("bigint");
      expect(metrics[count] >= 0n).toBe(true);
    }
    expect(metrics.capturedAt).toEqual(NOW);
  });

  it("author metadata is deterministic and non-null (placeholder resolution input)", async () => {
    const provider = new MockMetricsProvider("instagram");
    const first = metricsOf(
      (await provider.fetchMetrics([ref("reel9", "instagram")])).get("reel9"),
    );
    const second = metricsOf(
      (await provider.fetchMetrics([ref("reel9", "instagram")])).get("reel9"),
    );

    expect(typeof first.authorHandle).toBe("string");
    expect(typeof first.authorDisplayName).toBe("string");
    expect(typeof first.authorAvatarUrl).toBe("string");
    expect(first.postedAt).toBeInstanceOf(Date);
    expect(second.authorHandle).toBe(first.authorHandle);
    expect(second.postedAt).toEqual(first.postedAt);
  });

  it("returns a Map keyed by platformPostId covering every ref in the batch", async () => {
    const map = await new MockMetricsProvider("x").fetchMetrics([
      ref("a"),
      ref("b"),
      ref("c"),
    ]);
    expect(map).toBeInstanceOf(Map);
    expect([...map.keys()].sort()).toEqual(["a", "b", "c"]);
    for (const result of map.values()) {
      expect(result.ok).toBe(true);
    }
  });

  it("empty batch resolves to an empty Map (a batch result is a collection, not null)", async () => {
    await expect(
      new MockMetricsProvider("x").fetchMetrics([]),
    ).resolves.toEqual(new Map());
  });
});

describe("MockMetricsProvider — never rejects (spec 003 contract)", () => {
  it("malformed refs resolve instead of rejecting; valid refs stay keyed", async () => {
    const poisoned = [
      ref("good"),
      null,
      { platform: "x", platformPostId: 123, url: "u" },
    ] as unknown as PostRef[];

    const map = await new MockMetricsProvider("x").fetchMetrics(poisoned);
    expect(metricsOf(map.get("good")).views >= 0n).toBe(true);
  });

  it("control: the rejection matcher fires on a provider that rethrows", async () => {
    // Proves the resolve-style assertions in this suite are not vacuous — a
    // provider that rejects IS detectable by the matcher we rely on.
    const rethrowing: MetricsProvider = {
      platform: "x",
      fetchMetrics: () => Promise.reject(new Error("upstream exploded")),
    };
    await expect(rethrowing.fetchMetrics([ref("good")])).rejects.toThrowError(
      "upstream exploded",
    );
  });
});
