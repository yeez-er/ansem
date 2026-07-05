// Task 10 (spec 003): SocialDataProvider — the X refresh path over
// SocialData.tools bulk tweets-by-ids (recorded fixture shapes, no live keys
// in v1): views_count + engagement → bigint PostMetrics, absent tweet →
// NOT_FOUND, malformed body → PROVIDER_ERROR (never mass-NOT_FOUND), never
// rejects (control-tested); the registry prefers it over the official X API.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseServerEnv, type ServerEnv } from "@/env";
import { captureFetch, jsonResponse, metricsOf } from "@/tests/helpers/metrics";
import { MockMetricsProvider } from "./mock-provider";
import type { MetricsProvider, PostRef } from "./provider";
import { getProvider } from "./provider";
import { SocialDataProvider } from "./socialdata-provider";
import { XApiMetricsProvider } from "./x-api-provider";

const NOW = new Date("2026-07-06T12:00:00.000Z");

const ref = (id: string): PostRef => ({
  platform: "x",
  platformPostId: id,
  url: `https://x.com/i/status/${id}`,
});

const makeProvider = (fetchImpl: typeof fetch) =>
  new SocialDataProvider({ apiKey: "sd-test-key", fetchImpl });

const TWEET_ID = "1900000000000000001";

// Recorded response shape per docs.socialdata.tools bulk tweets-by-ids:
// { tweets: [...] }, tweet ids as id_str (numeric `id` loses precision),
// ISO tweet_created_at with microseconds, nullable views_count, legacy-style
// engagement counts, embedded user object. Deleted tweets are simply absent.
const TWEET_FIXTURE = {
  tweets: [
    {
      id: 1900000000000000000,
      id_str: TWEET_ID,
      full_text: "$ANSEM to the moon",
      tweet_created_at: "2026-03-01T09:30:00.000000Z",
      retweet_count: 7,
      reply_count: 3,
      favorite_count: 50,
      quote_count: 2,
      bookmark_count: 11,
      views_count: 1200,
      user: {
        id_str: "9001",
        name: "The Black Bull",
        screen_name: "blackbull",
        profile_image_url_https:
          "https://pbs.twimg.com/profile_images/9001/bull.jpg",
      },
    },
  ],
};

// Minimal valid tweet: no user object, no tweet_created_at.
const bareTweet = (idStr: string, views: number) => ({
  tweets: [
    {
      id_str: idStr,
      retweet_count: 0,
      reply_count: 0,
      favorite_count: 0,
      quote_count: 0,
      views_count: views,
    },
  ],
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SocialDataProvider — fixture mapping", () => {
  it("maps a recorded tweet to PostMetrics (views_count = views, retweet+quote = shares)", async () => {
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

  it("views_count: 3000000000 survives the bigint round-trip exactly", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse(bareTweet("big", 3_000_000_000)),
    );
    const metrics = metricsOf(
      (await makeProvider(impl).fetchMetrics([ref("big")])).get("big"),
    );
    expect(typeof metrics.views).toBe("bigint");
    expect(metrics.views).toBe(3_000_000_000n);
  });

  it("missing user object and tweet_created_at degrade to nulls, not errors", async () => {
    const { impl } = captureFetch(() => jsonResponse(bareTweet("plain", 5)));
    const metrics = metricsOf(
      (await makeProvider(impl).fetchMetrics([ref("plain")])).get("plain"),
    );
    expect(metrics.postedAt).toBeNull();
    expect(metrics.authorHandle).toBeNull();
    expect(metrics.authorDisplayName).toBeNull();
    expect(metrics.authorAvatarUrl).toBeNull();
  });

  it("views_count: null → per-tweet PROVIDER_ERROR (never a fabricated 0-view score); siblings stay ok", async () => {
    const body = {
      tweets: [
        { ...TWEET_FIXTURE.tweets[0] },
        {
          id_str: "nullviews",
          retweet_count: 1,
          reply_count: 1,
          favorite_count: 1,
          quote_count: 0,
          views_count: null,
        },
      ],
    };
    const { impl } = captureFetch(() => jsonResponse(body));
    const map = await makeProvider(impl).fetchMetrics([
      ref(TWEET_ID),
      ref("nullviews"),
    ]);
    expect(map.get("nullviews")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
    expect(metricsOf(map.get(TWEET_ID)).views).toBe(1200n);
  });
});

describe("SocialDataProvider — request shape", () => {
  it("sends bearer auth, comma-joined tweet_ids, and an abort signal to the bulk endpoint", async () => {
    const { impl, calls } = captureFetch(() => jsonResponse(TWEET_FIXTURE));
    await makeProvider(impl).fetchMetrics([ref(TWEET_ID)]);

    const call = calls[0];
    if (!call) throw new Error("expected the provider to call fetch");
    expect(call.url.hostname).toBe("api.socialdata.tools");
    expect(call.url.pathname).toBe("/twitter/tweets-by-ids");
    expect(call.url.searchParams.get("tweet_ids")).toBe(TWEET_ID);
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer sd-test-key",
    });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("chunks batches at 100 ids per API call and covers every ref in the Map", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
    const { impl, calls } = captureFetch(() => jsonResponse({ tweets: [] }));
    const map = await makeProvider(impl).fetchMetrics(ids.map(ref));

    const idsOf = (call: { url: URL }) =>
      (call.url.searchParams.get("tweet_ids") ?? "").split(",");
    expect(calls).toHaveLength(2);
    expect(idsOf(calls[0]!)).toHaveLength(100);
    expect(idsOf(calls[1]!)).toHaveLength(50);
    expect([...idsOf(calls[0]!), ...idsOf(calls[1]!)]).toEqual(ids);
    expect(map.size).toBe(150);
  });

  it("empty batch resolves to an empty Map without calling the API", async () => {
    const { impl, calls } = captureFetch(() => jsonResponse({ tweets: [] }));
    await expect(makeProvider(impl).fetchMetrics([])).resolves.toEqual(
      new Map(),
    );
    expect(calls).toHaveLength(0);
  });
});

describe("SocialDataProvider — typed errors", () => {
  it("id absent from a well-formed tweets array → NOT_FOUND (bulk semantics: absent = gone); present ids stay ok", async () => {
    const { impl } = captureFetch(() => jsonResponse(TWEET_FIXTURE));
    const map = await makeProvider(impl).fetchMetrics([
      ref(TWEET_ID),
      ref("deleted123"),
    ]);
    expect(map.get("deleted123")).toEqual({
      ok: false,
      error: "NOT_FOUND",
      retryable: false,
    });
    expect(metricsOf(map.get(TWEET_ID)).views).toBe(1200n);
  });

  it("body without a tweets array → PROVIDER_ERROR for every id, never NOT_FOUND (shape drift must not mass-remove posts)", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse({ status: "error", message: "Insufficient balance" }),
    );
    const map = await makeProvider(impl).fetchMetrics([ref("a"), ref("b")]);
    for (const id of ["a", "b"]) {
      expect(map.get(id)).toEqual({
        ok: false,
        error: "PROVIDER_ERROR",
        retryable: false,
      });
    }
  });

  it("HTTP 429 → exactly { ok:false, error:'RATE_LIMITED', retryable:true } for every ref in the batch", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse({ status: "error", message: "Rate limit exceeded" }, 429),
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

  it("HTTP 500 → PROVIDER_ERROR retryable; HTTP 402 (insufficient credits) → PROVIDER_ERROR not retryable", async () => {
    const at = (status: number) =>
      captureFetch(() => jsonResponse({ status: "error" }, status)).impl;
    const m500 = await makeProvider(at(500)).fetchMetrics([ref("a")]);
    expect(m500.get("a")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: true,
    });
    const m402 = await makeProvider(at(402)).fetchMetrics([ref("a")]);
    expect(m402.get("a")).toEqual({
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
});

describe("SocialDataProvider — never rejects (spec 003 contract)", () => {
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

describe("registry wiring — SOCIALDATA_API_KEY gate (X refresh path)", () => {
  function makeEnv(overrides: Record<string, string> = {}): ServerEnv {
    return parseServerEnv({
      DATABASE_URL: "postgresql://user:password@localhost:5432/ansem_test",
      ...overrides,
    });
  }

  it.each([false, true])(
    "SOCIALDATA_API_KEY set → SocialDataProvider for x (isProduction: %s)",
    (isProduction) => {
      const provider = getProvider("x", {
        env: makeEnv({ SOCIALDATA_API_KEY: "sd-live-key" }),
        isProduction,
      });
      expect(provider).toBeInstanceOf(SocialDataProvider);
      expect(provider?.platform).toBe("x");
    },
  );

  it("both keys set → SocialData wins (designated refresh path: $0.20/1k vs $5/1k official)", () => {
    const provider = getProvider("x", {
      env: makeEnv({
        SOCIALDATA_API_KEY: "sd-live-key",
        X_BEARER_TOKEN: "live-token",
      }),
      isProduction: true,
    });
    expect(provider).toBeInstanceOf(SocialDataProvider);
  });

  it("only X_BEARER_TOKEN set → official X adapter still serves (fallback unchanged)", () => {
    const provider = getProvider("x", {
      env: makeEnv({ X_BEARER_TOKEN: "live-token" }),
      isProduction: true,
    });
    expect(provider).toBeInstanceOf(XApiMetricsProvider);
  });

  it("blank SOCIALDATA_API_KEY= cannot enable the adapter (boot blank-normalization)", () => {
    const env = makeEnv({ SOCIALDATA_API_KEY: "" });
    expect(getProvider("x", { env, isProduction: false })).toBeInstanceOf(
      MockMetricsProvider,
    );
    expect(getProvider("x", { env, isProduction: true })).toBeNull();
  });

  it("per-platform mock override beats a configured key in dev", () => {
    const provider = getProvider("x", {
      env: makeEnv({
        SOCIALDATA_API_KEY: "sd-live-key",
        METRICS_PROVIDER_X: "mock",
      }),
      isProduction: false,
    });
    expect(provider).toBeInstanceOf(MockMetricsProvider);
  });

  it("production + mock override + key → null (mock is never selectable in production)", () => {
    const provider = getProvider("x", {
      env: makeEnv({
        SOCIALDATA_API_KEY: "sd-live-key",
        METRICS_PROVIDER_X: "mock",
      }),
      isProduction: true,
    });
    expect(provider).toBeNull();
  });

  it("a SocialData key does not enable live providers for other platforms", () => {
    const env = makeEnv({ SOCIALDATA_API_KEY: "sd-live-key" });
    expect(getProvider("tiktok", { env, isProduction: false })).toBeInstanceOf(
      MockMetricsProvider,
    );
    expect(getProvider("tiktok", { env, isProduction: true })).toBeNull();
  });
});

describe("SocialDataProvider — source verification", () => {
  it("every request carries the spec 10s timeout via AbortSignal.timeout", () => {
    const source = readFileSync(
      join(process.cwd(), "src/server/metrics/socialdata-provider.ts"),
      "utf8",
    );
    expect(source).toMatch(/REQUEST_TIMEOUT_MS = 10_000\b/);
    expect(source).toMatch(/AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  });
});
