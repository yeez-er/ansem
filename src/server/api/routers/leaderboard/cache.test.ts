// @vitest-environment node
// Task 19 (spec 007): 60s response caching on the leaderboard router, per
// input key, through Next's incremental cache (unstable_cache) — never a
// hand-rolled Map. Integration tests run the REAL router + query layer
// against a real test database with the fake incremental cache installed at
// the seam the Next server itself uses (globalThis.__incrementalCache).
//
// TTL is driven by Date-only fake timers (toFake: ["Date"]) — pg's socket
// timers stay real; the cache's age math and the procedures' `new Date()`
// both land on the pinned clock.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { appRouter } from "@/server/api/root";
import { createCallerFactory, type TRPCContext } from "@/server/api/trpc";
import {
  type FakeIncrementalCache,
  installFakeIncrementalCache,
  uninstallFakeIncrementalCache,
} from "@/tests/helpers/incremental-cache";
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";

const testDb = connectTestDb();
const { db } = testDb;
const { seedCreator, seedPost, seedSnapshot } = makeSeeders(db);

const createCaller = createCallerFactory(appRouter);
const ctx: TRPCContext = {
  headers: new Headers(),
  userId: null,
  isAdmin: false,
  db,
};
const caller = createCaller(ctx);

// Pinned request clock → window [2026-07-06T00:00Z, 2026-07-07T00:00Z).
const NOW = new Date("2026-07-06T12:00:00.000Z");
const IN_WINDOW = new Date("2026-07-06T08:00:00.000Z");

let fake: FakeIncrementalCache;

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  uninstallFakeIncrementalCache();
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  fake = installFakeIncrementalCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("leaderboard.get 60s cache", () => {
  it("serves an identical request from the cache — rows written after the miss stay invisible", async () => {
    const a = await seedCreator();
    await seedPost(a.id, { latestViews: 100n, latestSnapshotAt: IN_WINDOW });

    const first = await caller.leaderboard.get({ period: "alltime" });
    expect(first.entries).toHaveLength(1);

    const b = await seedCreator();
    await seedPost(b.id, { latestViews: 200n, latestSnapshotAt: IN_WINDOW });

    const second = await caller.leaderboard.get({ period: "alltime" });
    expect(second).toEqual(first);
    expect(fake.entryCount()).toBe(1);
  });

  it("stays cached at 59s and recomputes past the 60s TTL", async () => {
    const a = await seedCreator();
    await seedPost(a.id, { latestViews: 100n, latestSnapshotAt: IN_WINDOW });
    const first = await caller.leaderboard.get({ period: "alltime" });
    expect(first.entries).toHaveLength(1);

    const b = await seedCreator();
    await seedPost(b.id, { latestViews: 200n, latestSnapshotAt: IN_WINDOW });

    vi.setSystemTime(new Date(NOW.getTime() + 59_000));
    const cached = await caller.leaderboard.get({ period: "alltime" });
    expect(cached.entries).toHaveLength(1);

    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    const recomputed = await caller.leaderboard.get({ period: "alltime" });
    expect(recomputed.entries).toHaveLength(2);
  });

  it("never shares an entry across period or platform", async () => {
    const x = await seedCreator();
    await seedPost(x.id, { latestViews: 100n, latestSnapshotAt: IN_WINDOW });
    const tiktok = await seedCreator({ platform: "tiktok" });
    await seedPost(tiktok.id, {
      platform: "tiktok",
      latestViews: 200n,
      latestSnapshotAt: IN_WINDOW,
    });

    // The broad "all" board is cached FIRST — a colliding key would hand its
    // payload to the narrower calls below.
    const all = await caller.leaderboard.get({ period: "alltime" });
    expect(all.entries).toHaveLength(2);

    const tiktokOnly = await caller.leaderboard.get({
      period: "alltime",
      platform: "tiktok",
    });
    expect(tiktokOnly.entries.map((e) => e.creator.id)).toEqual([tiktok.id]);

    const daily = await caller.leaderboard.get({ period: "daily" });
    expect(daily.window).not.toBeNull();

    expect(fake.entryCount()).toBe(3);
  });

  it("keys on EVERY input field — cursor and limit vary the entry too", async () => {
    const c = await seedCreator();
    await seedPost(c.id, { latestViews: 100n, latestSnapshotAt: IN_WINDOW });

    await caller.leaderboard.get({ period: "alltime" });
    await caller.leaderboard.get({ period: "alltime", cursor: 1 });
    await caller.leaderboard.get({ period: "alltime", limit: 10 });

    expect(fake.entryCount()).toBe(3);
  });

  it("reads `now` only on a miss: a cached daily board straddles midnight for at most the TTL", async () => {
    const LATE = new Date("2026-07-06T23:59:30.000Z");
    const LATE_CAPTURE = new Date("2026-07-06T23:00:00.000Z");
    vi.setSystemTime(LATE);

    const c = await seedCreator();
    const post = await seedPost(c.id, {
      latestViews: 1000n,
      latestSnapshotAt: LATE_CAPTURE,
    });
    await seedSnapshot(post.id, { views: 1000n, capturedAt: LATE_CAPTURE });

    const first = await caller.leaderboard.get({ period: "daily" });
    expect(first.window?.start).toBe("2026-07-06T00:00:00.000Z");
    expect(first.entries[0]?.score).toBe("1000");

    // 50s later — past midnight but inside the TTL: the cached board keeps
    // yesterday's window (the clock is NOT re-read per request).
    vi.setSystemTime(new Date("2026-07-07T00:00:20.000Z"));
    const straddling = await caller.leaderboard.get({ period: "daily" });
    expect(straddling).toEqual(first);

    // Past the TTL the miss re-reads the clock once → today's window.
    vi.setSystemTime(new Date("2026-07-07T00:00:31.000Z"));
    const fresh = await caller.leaderboard.get({ period: "daily" });
    expect(fresh.window?.start).toBe("2026-07-07T00:00:00.000Z");
  });
});

describe("leaderboard.creator 60s cache", () => {
  it("caches per creatorId — repeats served from cache, other ids get their own entry", async () => {
    const a = await seedCreator();
    await seedPost(a.id, { latestViews: 100n, latestSnapshotAt: IN_WINDOW });
    const b = await seedCreator();

    const firstA = await caller.leaderboard.creator({ creatorId: a.id });
    expect(firstA?.posts).toHaveLength(1);

    // Written after the first read → invisible while cached.
    await seedPost(a.id, { latestViews: 300n, latestSnapshotAt: IN_WINDOW });
    const secondA = await caller.leaderboard.creator({ creatorId: a.id });
    expect(secondA).toEqual(firstA);

    const firstB = await caller.leaderboard.creator({ creatorId: b.id });
    expect(firstB?.creator.id).toBe(b.id);
    expect(firstB?.posts).toEqual([]);
    expect(fake.entryCount()).toBe(2);
  });

  it("recomputes past the 60s TTL", async () => {
    const a = await seedCreator();
    const before = await caller.leaderboard.creator({ creatorId: a.id });
    expect(before?.posts).toEqual([]);

    await seedPost(a.id, { latestViews: 100n, latestSnapshotAt: IN_WINDOW });

    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    const after = await caller.leaderboard.creator({ creatorId: a.id });
    expect(after?.posts).toHaveLength(1);
  });
});

describe("source verification", () => {
  const routerDir = dirname(fileURLToPath(import.meta.url));
  const read = (file: string) => readFileSync(join(routerDir, file), "utf8");

  it("cached procedures delegate to the shared cachedQuery helper", () => {
    expect(read("get.ts")).toMatch(/cachedQuery\(\s*"leaderboard\.get"/);
    expect(read("creator.ts")).toMatch(
      /cachedQuery\(\s*"leaderboard\.creator"/,
    );
  });

  it("cache.ts owns the Next cache wiring at exactly 60s", () => {
    const src = read("cache.ts");
    expect(src).toMatch(/from "next\/cache"/);
    expect(src).toMatch(/unstable_cache\(/);
    expect(src).toMatch(/BOARD_CACHE_REVALIDATE_SECONDS = 60\b/);
    expect(src).toMatch(/revalidate: BOARD_CACHE_REVALIDATE_SECONDS/);
  });

  const MAP_CACHE = /new (Map|WeakMap)\s*\(/;
  const routerSources = readdirSync(routerDir).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );

  it("control: the Map matcher fires on a deliberately bad line", () => {
    expect(MAP_CACHE.test("const cache = new Map()")).toBe(true);
    expect(routerSources.length).toBeGreaterThan(0);
  });

  it.each(routerSources)(
    "%s holds no hand-rolled in-process Map cache",
    (file) => {
      expect(read(file)).not.toMatch(MAP_CACHE);
    },
  );
});
