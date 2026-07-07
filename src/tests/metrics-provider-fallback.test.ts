// @vitest-environment node
// Task 30 (specs 003/005): external-service fallback verification for the
// X-API + metrics-provider rows of ralph/AGENTS.md. Four contracts, each proven
// through the REAL registry / orchestration (never a hand-rolled stand-in), and
// every negative assertion captured so it can't pass vacuously:
//   (1) Dev fallback is REAL — with every provider key absent, the registry
//       serves MockMetricsProvider and a full ingestion pass writes snapshots +
//       denorm that the all-time board reads back non-zero.
//   (2) Production skip — a platform unconfigured in prod is counted `skipped`
//       (never mock data), emits exactly one structured warning, and the post
//       keeps latestSnapshotAt: null (the value the UI renders as "— pending").
//   (3) X_BEARER_TOKEN unset — no X client is built, the X metrics provider is
//       not registered, and discoverX resolves { skipped: true } (never crashes).
//   (4) ralph/AGENTS.md names the decided vendors + real env vars (doc ⊆ reality).
//
// Sibling coverage is deliberately NOT duplicated: the 27-combination
// prod-never-mock sweep lives in provider.test.ts, the em-dash render in
// recent-posts.test.tsx / creator page suites, and the discovery gating matrix
// in discover-x.test.ts. This file pins only the end-to-end fallback wiring
// those unit suites don't exercise together.
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { parseServerEnv } from "@/env";
import type { Platform } from "@/lib/post-url";
import { clientFromEnv, discoverX } from "@/server/discovery/discover-x";
import { alltimeBoard } from "@/server/db/queries/leaderboard";
import { metricSnapshots, posts } from "@/server/db/schema";
import { refreshMetrics } from "@/server/ingestion/refresh-metrics";
import { MockMetricsProvider } from "@/server/metrics/mock-provider";
import {
  getProvider,
  type MetricsProvider,
  type MetricsResult,
  type PostRef,
} from "@/server/metrics/provider";
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";

const testDb = connectTestDb();
const { db } = testDb;
const { seedCreator, seedPost } = makeSeeders(db);

const PLATFORMS: readonly Platform[] = ["x", "tiktok", "instagram"];

// Every optional key absent — the "fresh clone, no provider keys" dev config.
const noKeysEnv = parseServerEnv({ DATABASE_URL: "postgresql://ci/test" });

// The registry resolver exactly as refreshMetrics' defaultProviderFor builds
// it, but with an EXPLICIT env + isProduction so runs are deterministic and
// never touch the process-wide env cache.
const devRegistry = (platform: Platform): MetricsProvider | null =>
  getProvider(platform, { env: noKeysEnv, isProduction: false });
const prodRegistry = (platform: Platform): MetricsProvider | null =>
  getProvider(platform, { env: noKeysEnv, isProduction: true });

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dev fallback: no provider keys → registry serves the mock, end-to-end", () => {
  it.each(PLATFORMS)(
    "getProvider(%s) with no keys in dev returns a MockMetricsProvider (not null)",
    (platform) => {
      const provider = getProvider(platform, {
        env: noKeysEnv,
        isProduction: false,
      });
      expect(provider).toBeInstanceOf(MockMetricsProvider);
      expect(provider?.platform).toBe(platform);
    },
  );

  it("the mock fallback returns deterministic non-empty metrics and never rejects", async () => {
    const provider = devRegistry("x");
    if (!provider) throw new Error("expected the dev mock provider");
    const ref: PostRef = {
      platform: "x",
      platformPostId: "1900000000000000001",
      url: "https://x.com/u/status/1900000000000000001",
    };
    // .catch always captures the outcome — a bare await would make a rejection
    // a vacuous pass instead of a visible failure.
    const outcome = await provider.fetchMetrics([ref]).catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(Map);
    const map = outcome as Map<string, MetricsResult>;
    const result = map.get(ref.platformPostId);
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) expect(result.metrics.views > 0n).toBe(true);
  });

  it("a full ingestion pass through the dev registry writes snapshots the all-time board reads non-zero", async () => {
    for (const platform of PLATFORMS) {
      const creator = await seedCreator({ platform });
      await seedPost(creator.id, { platform }); // no snapshot ⇒ due
    }

    const summary = await refreshMetrics(db, {
      batchSize: 500,
      maxProviderCalls: 100,
      providerFor: devRegistry,
    });
    expect(summary).toMatchObject({ refreshed: 3, skipped: 0, errors: 0 });

    const snapshots = await db.select().from(metricSnapshots);
    expect(snapshots).toHaveLength(3);

    const board = await alltimeBoard(db);
    expect(board.entries).toHaveLength(3);
    expect(board.entries.every((entry) => entry.score > 0n)).toBe(true);
  });
});

describe("production skip: an unconfigured platform is skipped, never mocked", () => {
  it.each(PLATFORMS)(
    "getProvider(%s) with no keys in PROD returns null (mock data never reaches prod)",
    (platform) => {
      expect(
        getProvider(platform, { env: noKeysEnv, isProduction: true }),
      ).toBeNull();
    },
  );

  it("ingestion counts unconfigured posts skipped, warns once, and leaves latestSnapshotAt null for the UI 'pending' em-dash", async () => {
    const seeded: string[] = [];
    for (const platform of ["x", "tiktok"] as const) {
      const creator = await seedCreator({ platform });
      const post = await seedPost(creator.id, { platform });
      seeded.push(post.id);
    }

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const summary = await refreshMetrics(db, {
      batchSize: 500,
      maxProviderCalls: 100,
      providerFor: prodRegistry,
    });
    expect(summary).toMatchObject({ refreshed: 0, removed: 0, skipped: 2 });

    // Exactly one structured warning per run (spec 004) — never one per post.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
      event: "refresh_metrics.unconfigured_platforms",
    });

    // A skipped post has no snapshot: latestSnapshotAt stays null, which the UI
    // renders as the "— pending" em-dash (that render owned by the UI suites).
    for (const id of seeded) {
      const [row] = await db
        .select({ latestSnapshotAt: posts.latestSnapshotAt })
        .from(posts)
        .where(eq(posts.id, id));
      expect(row?.latestSnapshotAt).toBeNull();
    }

    // With no snapshots written, the board simply excludes them (never a crash,
    // never fabricated zeros from mock data).
    const board = await alltimeBoard(db);
    expect(board.entries).toEqual([]);
  });
});

describe("X_BEARER_TOKEN unset: no X client, no X provider, discovery skips", () => {
  it("no bearer token builds no X client", () => {
    expect(clientFromEnv(noKeysEnv)).toBeNull();
  });

  it("no X refresh key leaves the X metrics provider unregistered (prod → null)", () => {
    expect(getProvider("x", { env: noKeysEnv, isProduction: true })).toBeNull();
  });

  it("discoverX resolves { skipped: true } with no client — never crashes", async () => {
    const outcome = await discoverX(db, {
      enabled: true,
      client: clientFromEnv(noKeysEnv),
    }).catch((e: unknown) => e);
    expect(outcome).toStrictEqual({ skipped: true });
  });
});

describe("ralph/AGENTS.md documents the decided providers (doc ⊆ reality)", () => {
  const AGENTS = readFileSync("ralph/AGENTS.md", "utf8");
  const ENV_SOURCE = readFileSync("src/env.ts", "utf8");

  it("CONTROL: the External Services section is present (guards the reads below)", () => {
    expect(AGENTS).toContain("External Services");
    expect(AGENTS.length).toBeGreaterThan(500);
  });

  it("names the decided metrics vendors — SocialData + Apify (no more TBD)", () => {
    expect(AGENTS).toContain("SocialData");
    expect(AGENTS).toContain("Apify");
  });

  it.each([
    "SOCIALDATA_API_KEY",
    "APIFY_TOKEN",
    "X_BEARER_TOKEN",
    "METRICS_PROVIDER",
  ])(
    "names the real provider env var %s, and it exists in src/env.ts",
    (key) => {
      expect(AGENTS.includes(key), `AGENTS.md must mention ${key}`).toBe(true);
      expect(ENV_SOURCE.includes(key), `${key} must exist in src/env.ts`).toBe(
        true,
      );
    },
  );

  it("drops the stale THIRDPARTY_API_KEY / 'owner decision pending' placeholder", () => {
    expect(AGENTS).not.toContain("THIRDPARTY_API_KEY");
    expect(AGENTS).not.toContain("owner decision pending");
  });

  it("CONTROL: the stale-placeholder matcher fires on a row that still has it", () => {
    const stale =
      "| Metrics data provider (TBD — owner decision pending) | ... | `THIRDPARTY_API_KEY` |";
    expect(stale).toContain("THIRDPARTY_API_KEY");
    expect(stale).toContain("owner decision pending");
  });
});
