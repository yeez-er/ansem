// Task 9 (spec 003): XApiMetricsProvider — official X API v2 batch tweet
// lookup: public_metrics → bigint PostMetrics (impression_count = views,
// retweet_count + quote_count = shares), ≤ 100 ids per call, 429 →
// RATE_LIMITED, deleted tweet → NOT_FOUND, never rejects (control-tested);
// the registry serves it only when X_BEARER_TOKEN is set.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseServerEnv, type ServerEnv } from "@/env";
import { captureFetch, jsonResponse, metricsOf } from "@/tests/helpers/metrics";
import { MockMetricsProvider } from "./mock-provider";
import type { MetricsProvider, PostRef } from "./provider";
import { getProvider } from "./provider";
import { XApiMetricsProvider } from "./x-api-provider";

const NOW = new Date("2026-07-06T12:00:00.000Z");

const ref = (id: string): PostRef => ({
  platform: "x",
  platformPostId: id,
  url: `https://x.com/i/status/${id}`,
});

const makeProvider = (fetchImpl: typeof fetch) =>
  new XApiMetricsProvider({ bearerToken: "test-token", fetchImpl });

const TWEET_ID = "1900000000000000001";

const TWEET_FIXTURE = {
  data: [
    {
      id: TWEET_ID,
      text: "$ANSEM to the moon",
      author_id: "9001",
      created_at: "2026-03-01T09:30:00.000Z",
      public_metrics: {
        retweet_count: 7,
        reply_count: 3,
        like_count: 50,
        quote_count: 2,
        bookmark_count: 11,
        impression_count: 1200,
      },
    },
  ],
  includes: {
    users: [
      {
        id: "9001",
        username: "blackbull",
        name: "The Black Bull",
        profile_image_url: "https://pbs.twimg.com/profile_images/9001/bull.jpg",
      },
    ],
  },
};

// Minimal valid tweet: no created_at, no author expansion.
const bareTweet = (id: string, impressions: number) => ({
  data: [
    {
      id,
      public_metrics: {
        retweet_count: 0,
        reply_count: 0,
        like_count: 0,
        quote_count: 0,
        impression_count: impressions,
      },
    },
  ],
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("XApiMetricsProvider — public_metrics mapping", () => {
  it("maps a fixture tweet to PostMetrics per the spec field table", async () => {
    const { impl } = captureFetch(() => jsonResponse(TWEET_FIXTURE));
    const map = await makeProvider(impl).fetchMetrics([ref(TWEET_ID)]);

    expect(metricsOf(map.get(TWEET_ID))).toEqual({
      views: 1200n,
      likes: 50n,
      comments: 3n,
      shares: 9n, // retweet_count 7 + quote_count 2
      capturedAt: NOW,
      postedAt: new Date("2026-03-01T09:30:00.000Z"),
      authorHandle: "blackbull",
      authorDisplayName: "The Black Bull",
      authorAvatarUrl: "https://pbs.twimg.com/profile_images/9001/bull.jpg",
    });
  });

  it("impression_count: 3000000000 survives the bigint round-trip exactly", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse(bareTweet("big", 3_000_000_000)),
    );
    const metrics = metricsOf(
      (await makeProvider(impl).fetchMetrics([ref("big")])).get("big"),
    );
    expect(typeof metrics.views).toBe("bigint");
    expect(metrics.views).toBe(3_000_000_000n);
  });

  it("missing author expansion and created_at degrade to nulls, not errors", async () => {
    const { impl } = captureFetch(() => jsonResponse(bareTweet("plain", 5)));
    const metrics = metricsOf(
      (await makeProvider(impl).fetchMetrics([ref("plain")])).get("plain"),
    );
    expect(metrics.postedAt).toBeNull();
    expect(metrics.authorHandle).toBeNull();
    expect(metrics.authorDisplayName).toBeNull();
    expect(metrics.authorAvatarUrl).toBeNull();
  });
});

describe("XApiMetricsProvider — request shape", () => {
  it("sends bearer auth, batched ids, metric+author fields, and an abort signal", async () => {
    const { impl, calls } = captureFetch(() => jsonResponse(TWEET_FIXTURE));
    await makeProvider(impl).fetchMetrics([ref(TWEET_ID)]);

    const call = calls[0];
    if (!call) throw new Error("expected the provider to call fetch");
    expect(call.url.pathname).toBe("/2/tweets");
    expect(call.url.searchParams.get("ids")).toBe(TWEET_ID);
    expect(call.url.searchParams.get("tweet.fields")).toContain(
      "public_metrics",
    );
    expect(call.url.searchParams.get("tweet.fields")).toContain("created_at");
    expect(call.url.searchParams.get("expansions")).toBe("author_id");
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("chunks batches at 100 ids per API call and covers every ref in the Map", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
    const { impl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    const map = await makeProvider(impl).fetchMetrics(ids.map(ref));

    const idsOf = (call: { url: URL }) =>
      (call.url.searchParams.get("ids") ?? "").split(",");
    expect(calls).toHaveLength(2);
    expect(idsOf(calls[0]!)).toHaveLength(100);
    expect(idsOf(calls[1]!)).toHaveLength(50);
    expect([...idsOf(calls[0]!), ...idsOf(calls[1]!)]).toEqual(ids);
    expect(map.size).toBe(150);
  });

  it("empty batch resolves to an empty Map without calling the API", async () => {
    const { impl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    await expect(makeProvider(impl).fetchMetrics([])).resolves.toEqual(
      new Map(),
    );
    expect(calls).toHaveLength(0);
  });
});

describe("XApiMetricsProvider — typed errors", () => {
  it("HTTP 429 → exactly { ok:false, error:'RATE_LIMITED', retryable:true } for every ref in the batch", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse({ title: "Too Many Requests" }, 429),
    );
    const map = await makeProvider(impl).fetchMetrics([ref("a"), ref("b")]);
    expect(map.get("a")).toEqual({
      ok: false,
      error: "RATE_LIMITED",
      retryable: true,
    });
    expect(map.get("b")).toEqual({
      ok: false,
      error: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("deleted tweet (errors entry) → NOT_FOUND; surviving tweets in the same batch stay ok", async () => {
    const body = {
      ...TWEET_FIXTURE,
      errors: [
        {
          value: "gone404",
          resource_type: "tweet",
          parameter: "ids",
          title: "Not Found Error",
          detail: "Could not find tweet with ids: [gone404].",
        },
      ],
    };
    const { impl } = captureFetch(() => jsonResponse(body));
    const map = await makeProvider(impl).fetchMetrics([
      ref(TWEET_ID),
      ref("gone404"),
    ]);
    expect(map.get("gone404")).toEqual({
      ok: false,
      error: "NOT_FOUND",
      retryable: false,
    });
    expect(metricsOf(map.get(TWEET_ID)).views).toBe(1200n);
  });

  it("HTTP 500 → PROVIDER_ERROR retryable; HTTP 403 → PROVIDER_ERROR not retryable", async () => {
    const at = (status: number) =>
      captureFetch(() => jsonResponse({ title: "err" }, status)).impl;
    const m500 = await makeProvider(at(500)).fetchMetrics([ref("a")]);
    expect(m500.get("a")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: true,
    });
    const m403 = await makeProvider(at(403)).fetchMetrics([ref("a")]);
    expect(m403.get("a")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
  });

  it("malformed JSON body resolves to PROVIDER_ERROR, never a rejection", async () => {
    const { impl } = captureFetch(
      () => new Response("<html>gateway error</html>", { status: 200 }),
    );
    const map = await makeProvider(impl).fetchMetrics([ref("a")]);
    expect(map.get("a")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
  });

  it("id in neither data nor errors → defensive PROVIDER_ERROR (no silent gaps)", async () => {
    const { impl } = captureFetch(() => jsonResponse(TWEET_FIXTURE));
    const map = await makeProvider(impl).fetchMetrics([
      ref(TWEET_ID),
      ref("vanished"),
    ]);
    expect(map.get("vanished")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
  });
});

describe("XApiMetricsProvider — never rejects (spec 003 contract)", () => {
  it("a fetch that throws (sync or async) resolves to a retryable PROVIDER_ERROR", async () => {
    const syncThrow = (() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const asyncReject = (() =>
      Promise.reject(new Error("socket hang up"))) as typeof fetch;

    for (const impl of [syncThrow, asyncReject]) {
      const map = await makeProvider(impl).fetchMetrics([ref("a")]);
      expect(map.get("a")).toEqual({
        ok: false,
        error: "PROVIDER_ERROR",
        retryable: true,
      });
    }
  });

  it("control: the rejection matcher fires on a provider that rethrows", async () => {
    // Proves the resolve-style assertions in this suite are not vacuous — a
    // provider that rejects IS detectable by the matcher we rely on.
    const rethrowing: MetricsProvider = {
      platform: "x",
      fetchMetrics: () => Promise.reject(new Error("upstream exploded")),
    };
    await expect(rethrowing.fetchMetrics([ref("a")])).rejects.toThrowError(
      "upstream exploded",
    );
  });
});

describe("registry wiring — X_BEARER_TOKEN gate", () => {
  function makeEnv(overrides: Record<string, string> = {}): ServerEnv {
    return parseServerEnv({
      DATABASE_URL: "postgresql://user:password@localhost:5432/ansem_test",
      ...overrides,
    });
  }

  it.each([false, true])(
    "X_BEARER_TOKEN set → XApiMetricsProvider for x (isProduction: %s)",
    (isProduction) => {
      const provider = getProvider("x", {
        env: makeEnv({ X_BEARER_TOKEN: "live-token" }),
        isProduction,
      });
      expect(provider).toBeInstanceOf(XApiMetricsProvider);
      expect(provider?.platform).toBe("x");
    },
  );

  it("token absent + METRICS_PROVIDER=live → mock in dev, null in production", () => {
    const env = makeEnv({ METRICS_PROVIDER: "live" });
    expect(getProvider("x", { env, isProduction: false })).toBeInstanceOf(
      MockMetricsProvider,
    );
    expect(getProvider("x", { env, isProduction: true })).toBeNull();
  });

  it("per-platform mock override beats a configured token in dev", () => {
    const provider = getProvider("x", {
      env: makeEnv({
        X_BEARER_TOKEN: "live-token",
        METRICS_PROVIDER_X: "mock",
      }),
      isProduction: false,
    });
    expect(provider).toBeInstanceOf(MockMetricsProvider);
  });

  it("production + mock override + token → null (mock is never selectable in production)", () => {
    const provider = getProvider("x", {
      env: makeEnv({
        X_BEARER_TOKEN: "live-token",
        METRICS_PROVIDER_X: "mock",
      }),
      isProduction: true,
    });
    expect(provider).toBeNull();
  });

  it("an X token does not enable live providers for other platforms", () => {
    const env = makeEnv({ X_BEARER_TOKEN: "live-token" });
    expect(getProvider("tiktok", { env, isProduction: false })).toBeInstanceOf(
      MockMetricsProvider,
    );
    expect(getProvider("tiktok", { env, isProduction: true })).toBeNull();
  });
});

describe("XApiMetricsProvider — source verification", () => {
  it("routes every request through the shared XClient pipeline (Task 15: no duplicated X HTTP pipeline)", () => {
    // The 10s timeout + typed error mapping moved to x-client.ts and are
    // dual-layer pinned in x-client.test.ts; here we pin that the provider
    // actually rides that pipeline instead of growing its own fetch again.
    const source = readFileSync(
      join(process.cwd(), "src/server/metrics/x-api-provider.ts"),
      "utf8",
    );
    expect(source).toMatch(/import \{ XClient \} from "\.\/x-client"/);
    expect(source).not.toMatch(/AbortSignal|\bfetchImpl \?\? fetch\b/);
  });
});
