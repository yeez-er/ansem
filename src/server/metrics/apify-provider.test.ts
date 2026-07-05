// Task 11 (spec 003): ApifyProvider — TikTok + Instagram metrics over Apify
// actors run-sync-get-dataset-items (recorded fixture shapes, no live keys in
// v1): clockworks/tiktok-scraper batch postURLs and apify/instagram-post-
// scraper by post URL → bigint PostMetrics with author metadata, missing post
// → NOT_FOUND, actor failure → typed PROVIDER_ERROR, never rejects
// (control-tested); the registry gates both platforms on APIFY_TOKEN.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseServerEnv, type ServerEnv } from "@/env";
import { captureFetch, jsonResponse, metricsOf } from "@/tests/helpers/metrics";
import { ApifyProvider } from "./apify-provider";
import { MockMetricsProvider } from "./mock-provider";
import type { MetricsProvider, PostRef } from "./provider";
import { getProvider } from "./provider";

const NOW = new Date("2026-07-06T12:00:00.000Z");

const TIKTOK_ID = "7301234567890123456";
const IG_SHORTCODE = "DLNsnpUTdVS";

const tiktokRef = (id: string): PostRef => ({
  platform: "tiktok",
  platformPostId: id,
  url: `https://www.tiktok.com/@blackbull/video/${id}`,
});

const igRef = (shortcode: string): PostRef => ({
  platform: "instagram",
  platformPostId: shortcode,
  url: `https://www.instagram.com/reel/${shortcode}/`,
});

const makeProvider = (
  platform: "tiktok" | "instagram",
  fetchImpl: typeof fetch,
) => new ApifyProvider({ token: "apify-test-token", platform, fetchImpl });

// Recorded dataset-item shape from clockworks/tiktok-scraper (the sync run
// endpoint returns the items array directly): string id (numeric TikTok ids
// exceed 2^53), ISO createTimeISO, authorMeta carrying the unique handle in
// `name` and the display name in `nickName`.
const TIKTOK_ITEM = {
  id: TIKTOK_ID,
  text: "$ANSEM bull run",
  createTimeISO: "2026-03-02T10:00:00.000Z",
  authorMeta: {
    id: "6789",
    name: "blackbull",
    nickName: "The Black Bull",
    avatar: "https://p16-sign-va.tiktokcdn.com/blackbull.jpeg",
  },
  diggCount: 50,
  shareCount: 9,
  playCount: 1200,
  commentCount: 3,
  webVideoUrl: `https://www.tiktok.com/@blackbull/video/${TIKTOK_ID}`,
};

// Recorded dataset-item shape from apify/instagram-post-scraper: posts keyed
// by shortCode (parsePostUrl's platformPostId for IG), ISO timestamp, owner
// fields inline, videoViewCount for reels, likesCount -1 when the author
// hides likes. Post items carry no owner avatar.
const IG_ITEM = {
  id: "3660778310592222546",
  shortCode: IG_SHORTCODE,
  caption: "$ANSEM",
  timestamp: "2026-03-03T08:00:00.000Z",
  ownerUsername: "blackbull.ig",
  ownerFullName: "Black Bull IG",
  likesCount: 50,
  commentsCount: 3,
  videoViewCount: 1200,
  videoPlayCount: 1500,
  url: `https://www.instagram.com/reel/${IG_SHORTCODE}/`,
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ApifyProvider — fixture mapping", () => {
  it("maps a recorded TikTok item to PostMetrics (playCount = views, digg = likes, share = shares)", async () => {
    const { impl } = captureFetch(() => jsonResponse([TIKTOK_ITEM]));
    const map = await makeProvider("tiktok", impl).fetchMetrics([
      tiktokRef(TIKTOK_ID),
    ]);

    expect(metricsOf(map.get(TIKTOK_ID))).toEqual({
      views: 1200n,
      likes: 50n,
      comments: 3n,
      shares: 9n,
      capturedAt: NOW,
      postedAt: new Date("2026-03-02T10:00:00.000Z"),
      authorHandle: "blackbull",
      authorDisplayName: "The Black Bull",
      authorAvatarUrl: "https://p16-sign-va.tiktokcdn.com/blackbull.jpeg",
    });
  });

  it("maps a recorded Instagram item to PostMetrics (videoViewCount = views; IG exposes no share count → 0n)", async () => {
    const { impl } = captureFetch(() => jsonResponse([IG_ITEM]));
    const map = await makeProvider("instagram", impl).fetchMetrics([
      igRef(IG_SHORTCODE),
    ]);

    expect(metricsOf(map.get(IG_SHORTCODE))).toEqual({
      views: 1200n,
      likes: 50n,
      comments: 3n,
      shares: 0n,
      capturedAt: NOW,
      postedAt: new Date("2026-03-03T08:00:00.000Z"),
      authorHandle: "blackbull.ig",
      authorDisplayName: "Black Bull IG",
      authorAvatarUrl: null,
    });
  });

  it("playCount: 3000000000 survives the bigint round-trip exactly", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse([{ ...TIKTOK_ITEM, id: "big", playCount: 3_000_000_000 }]),
    );
    const metrics = metricsOf(
      (await makeProvider("tiktok", impl).fetchMetrics([tiktokRef("big")])).get(
        "big",
      ),
    );
    expect(typeof metrics.views).toBe("bigint");
    expect(metrics.views).toBe(3_000_000_000n);
  });

  it("missing authorMeta and createTimeISO degrade to nulls, not errors", async () => {
    const bare = {
      id: "plain",
      diggCount: 0,
      shareCount: 0,
      playCount: 5,
      commentCount: 0,
    };
    const { impl } = captureFetch(() => jsonResponse([bare]));
    const metrics = metricsOf(
      (
        await makeProvider("tiktok", impl).fetchMetrics([tiktokRef("plain")])
      ).get("plain"),
    );
    expect(metrics.postedAt).toBeNull();
    expect(metrics.authorHandle).toBeNull();
    expect(metrics.authorDisplayName).toBeNull();
    expect(metrics.authorAvatarUrl).toBeNull();
  });

  it("hidden likes (likesCount: -1) → per-post PROVIDER_ERROR (no fabricated count); siblings stay ok", async () => {
    const hidden = { ...IG_ITEM, shortCode: "hidden", likesCount: -1 };
    const { impl } = captureFetch(() => jsonResponse([IG_ITEM, hidden]));
    const map = await makeProvider("instagram", impl).fetchMetrics([
      igRef(IG_SHORTCODE),
      igRef("hidden"),
    ]);
    expect(map.get("hidden")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
    expect(metricsOf(map.get(IG_SHORTCODE)).views).toBe(1200n);
  });

  it("item without videoViewCount (photo post) → per-post PROVIDER_ERROR, never a fabricated 0-view score", async () => {
    const photo = { ...IG_ITEM, shortCode: "photo" } as Record<string, unknown>;
    delete photo.videoViewCount;
    const { impl } = captureFetch(() => jsonResponse([photo]));
    const map = await makeProvider("instagram", impl).fetchMetrics([
      igRef("photo"),
    ]);
    expect(map.get("photo")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
  });
});

describe("ApifyProvider — request shape", () => {
  it("TikTok: POSTs postURLs to clockworks~tiktok-scraper with bearer auth and an abort signal", async () => {
    const { impl, calls } = captureFetch(() => jsonResponse([TIKTOK_ITEM]));
    const ref = tiktokRef(TIKTOK_ID);
    await makeProvider("tiktok", impl).fetchMetrics([ref]);

    const call = calls[0];
    if (!call) throw new Error("expected the provider to call fetch");
    expect(call.url.hostname).toBe("api.apify.com");
    expect(call.url.pathname).toBe(
      "/v2/actors/clockworks~tiktok-scraper/run-sync-get-dataset-items",
    );
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer apify-test-token",
    });
    expect(JSON.parse(String(call.init.body))).toEqual({
      postURLs: [ref.url],
    });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("Instagram: POSTs post URLs (the actor's username field accepts them) to apify~instagram-post-scraper", async () => {
    const { impl, calls } = captureFetch(() => jsonResponse([IG_ITEM]));
    const ref = igRef(IG_SHORTCODE);
    await makeProvider("instagram", impl).fetchMetrics([ref]);

    const call = calls[0];
    if (!call) throw new Error("expected the provider to call fetch");
    expect(call.url.pathname).toBe(
      "/v2/actors/apify~instagram-post-scraper/run-sync-get-dataset-items",
    );
    expect(JSON.parse(String(call.init.body))).toEqual({
      username: [ref.url],
    });
  });

  it("chunks batches at 100 urls per actor run and covers every ref in the Map", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
    const { impl, calls } = captureFetch(() => jsonResponse([]));
    const map = await makeProvider("tiktok", impl).fetchMetrics(
      ids.map(tiktokRef),
    );

    const urlsOf = (call: { init: RequestInit }) =>
      (JSON.parse(String(call.init.body)) as { postURLs: string[] }).postURLs;
    expect(calls).toHaveLength(2);
    expect(urlsOf(calls[0]!)).toHaveLength(100);
    expect(urlsOf(calls[1]!)).toHaveLength(50);
    expect([...urlsOf(calls[0]!), ...urlsOf(calls[1]!)]).toEqual(
      ids.map((id) => tiktokRef(id).url),
    );
    expect(map.size).toBe(150);
  });

  it("empty batch resolves to an empty Map without starting an actor run", async () => {
    const { impl, calls } = captureFetch(() => jsonResponse([]));
    await expect(
      makeProvider("tiktok", impl).fetchMetrics([]),
    ).resolves.toEqual(new Map());
    expect(calls).toHaveLength(0);
  });
});

describe("ApifyProvider — typed errors", () => {
  it.each([
    ["tiktok", tiktokRef, [TIKTOK_ITEM], TIKTOK_ID],
    ["instagram", igRef, [IG_ITEM], IG_SHORTCODE],
  ] as const)(
    "%s: ref absent from a well-formed items array → NOT_FOUND (missing post is gone at source); present refs stay ok",
    async (platform, ref, items, presentId) => {
      const { impl } = captureFetch(() => jsonResponse(items));
      const map = await makeProvider(platform, impl).fetchMetrics([
        ref(presentId),
        ref("deleted123"),
      ]);
      expect(map.get("deleted123")).toEqual({
        ok: false,
        error: "NOT_FOUND",
        retryable: false,
      });
      expect(metricsOf(map.get(presentId)).views).toBe(1200n);
    },
  );

  it("body that is not an items array → PROVIDER_ERROR for every ref, never NOT_FOUND (shape drift must not mass-remove posts)", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse({ error: { type: "run-failed", message: "Actor crashed" } }),
    );
    const map = await makeProvider("tiktok", impl).fetchMetrics([
      tiktokRef("a"),
      tiktokRef("b"),
    ]);
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
      jsonResponse({ error: { type: "rate-limit-exceeded" } }, 429),
    );
    const map = await makeProvider("tiktok", impl).fetchMetrics([
      tiktokRef("a"),
      tiktokRef("b"),
    ]);
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

  it("HTTP 408 (sync run outlived Apify's 300s ceiling) → PROVIDER_ERROR retryable", async () => {
    const { impl } = captureFetch(() =>
      jsonResponse({ error: { type: "run-timeout-exceeded" } }, 408),
    );
    const map = await makeProvider("instagram", impl).fetchMetrics([
      igRef("a"),
    ]);
    expect(map.get("a")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: true,
    });
  });

  it("HTTP 500 → PROVIDER_ERROR retryable; HTTP 402 (out of credits) → PROVIDER_ERROR not retryable", async () => {
    const at = (status: number) =>
      captureFetch(() => jsonResponse({ error: {} }, status)).impl;
    const m500 = await makeProvider("tiktok", at(500)).fetchMetrics([
      tiktokRef("a"),
    ]);
    expect(m500.get("a")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: true,
    });
    const m402 = await makeProvider("tiktok", at(402)).fetchMetrics([
      tiktokRef("a"),
    ]);
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
    const map = await makeProvider("tiktok", impl).fetchMetrics([
      tiktokRef("a"),
    ]);
    expect(map.get("a")).toEqual({
      ok: false,
      error: "PROVIDER_ERROR",
      retryable: false,
    });
  });
});

describe("ApifyProvider — never rejects (spec 003 contract)", () => {
  it("a fetch that throws (sync or async) resolves to a retryable PROVIDER_ERROR", async () => {
    const syncThrow = (() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const asyncReject = (() =>
      Promise.reject(new Error("socket hang up"))) as typeof fetch;

    for (const impl of [syncThrow, asyncReject]) {
      const map = await makeProvider("tiktok", impl).fetchMetrics([
        tiktokRef("a"),
      ]);
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
      platform: "tiktok",
      fetchMetrics: () => Promise.reject(new Error("upstream exploded")),
    };
    await expect(
      rethrowing.fetchMetrics([tiktokRef("a")]),
    ).rejects.toThrowError("upstream exploded");
  });
});

describe("registry wiring — APIFY_TOKEN gate (tiktok + instagram)", () => {
  function makeEnv(overrides: Record<string, string> = {}): ServerEnv {
    return parseServerEnv({
      DATABASE_URL: "postgresql://user:password@localhost:5432/ansem_test",
      ...overrides,
    });
  }

  it.each([
    ["tiktok", false],
    ["tiktok", true],
    ["instagram", false],
    ["instagram", true],
  ] as const)(
    "APIFY_TOKEN set → ApifyProvider for %s (isProduction: %s)",
    (platform, isProduction) => {
      const provider = getProvider(platform, {
        env: makeEnv({ APIFY_TOKEN: "apify-live-token" }),
        isProduction,
      });
      expect(provider).toBeInstanceOf(ApifyProvider);
      expect(provider?.platform).toBe(platform);
    },
  );

  it.each(["tiktok", "instagram"] as const)(
    "blank APIFY_TOKEN= cannot enable the adapter for %s (boot blank-normalization)",
    (platform) => {
      const env = makeEnv({ APIFY_TOKEN: "" });
      expect(
        getProvider(platform, { env, isProduction: false }),
      ).toBeInstanceOf(MockMetricsProvider);
      expect(getProvider(platform, { env, isProduction: true })).toBeNull();
    },
  );

  it("per-platform mock override beats a configured token in dev", () => {
    const provider = getProvider("tiktok", {
      env: makeEnv({
        APIFY_TOKEN: "apify-live-token",
        METRICS_PROVIDER_TIKTOK: "mock",
      }),
      isProduction: false,
    });
    expect(provider).toBeInstanceOf(MockMetricsProvider);
  });

  it("production + mock override + token → null (mock is never selectable in production)", () => {
    const provider = getProvider("instagram", {
      env: makeEnv({
        APIFY_TOKEN: "apify-live-token",
        METRICS_PROVIDER_INSTAGRAM: "mock",
      }),
      isProduction: true,
    });
    expect(provider).toBeNull();
  });

  it("an Apify token does not enable a live provider for x", () => {
    const env = makeEnv({ APIFY_TOKEN: "apify-live-token" });
    expect(getProvider("x", { env, isProduction: false })).toBeInstanceOf(
      MockMetricsProvider,
    );
    expect(getProvider("x", { env, isProduction: true })).toBeNull();
  });
});

describe("ApifyProvider — source verification", () => {
  it("every actor run carries the 300s timeout via AbortSignal.timeout (sync runs exceed the 10s HTTP default; Apify 408s at 300s)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/server/metrics/apify-provider.ts"),
      "utf8",
    );
    expect(source).toMatch(/REQUEST_TIMEOUT_MS = 300_000\b/);
    expect(source).toMatch(/AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  });
});
