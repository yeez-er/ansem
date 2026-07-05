// @vitest-environment node
// Task 18 iteration 1 (spec 007): leaderboard.get through the REAL router +
// query layer against a real test database — hand-derived spec scores (never
// observed output), DTO exact-keys at the wire, pagination continuity, zod
// input rejection, and >2^53 counts surviving a plain-JSON round-trip.
//
// The clock is pinned with Date-only fake timers (toFake: ["Date"]): the
// procedure reads `new Date()` once per request, snapshots are seeded at
// absolute instants around the pinned window, and pg's socket/timer
// internals stay on real timers.
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
const BEFORE_WINDOW = new Date("2026-07-05T20:00:00.000Z");

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
  // Task 19: the procedures are cached — a FRESH fake incremental cache per
  // test keeps responses from bleeding across tests (cache.test.ts owns the
  // caching behavior itself).
  installFakeIncrementalCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("leaderboard.get all-time", () => {
  it("ranks hand-derived denorm scores and serializes exact wire shapes", async () => {
    const a = await seedCreator({ displayName: "Creator A" });
    // 1000 + 10·30 + 2·60 + 1·90 = 1510
    await seedPost(a.id, {
      latestViews: 1000n,
      latestLikes: 10n,
      latestComments: 2n,
      latestShares: 1n,
      latestSnapshotAt: IN_WINDOW,
    });
    // 500 + 4·30 + 1·60 = 680 → creator A total 2190
    await seedPost(a.id, {
      latestViews: 500n,
      latestLikes: 4n,
      latestComments: 1n,
      latestShares: 0n,
      latestSnapshotAt: BEFORE_WINDOW,
    });
    // Never observed: poisoned denorm must not count (rank or postCount).
    await seedPost(a.id, { latestViews: 123456n, latestSnapshotAt: null });
    // Pending: never visible no matter the numbers.
    await seedPost(a.id, {
      status: "pending",
      latestViews: 500000n,
      latestSnapshotAt: IN_WINDOW,
    });

    const b = await seedCreator();
    await seedPost(b.id, {
      latestViews: 100000n,
      latestSnapshotAt: IN_WINDOW,
    });

    const banned = await seedCreator({ isBanned: true });
    await seedPost(banned.id, {
      latestViews: 9999999n,
      latestSnapshotAt: IN_WINDOW,
    });

    const res = await caller.leaderboard.get({ period: "alltime" });

    expect(res.window).toBeNull();
    expect(res.nextCursor).toBeNull();
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0]).toEqual({
      rank: 1,
      creator: {
        id: b.id,
        platform: "x",
        handle: b.handle,
        displayName: null,
        avatarUrl: null,
        profileUrl: b.profileUrl,
      },
      score: "100000",
      views: "100000",
      likes: "0",
      comments: "0",
      shares: "0",
      postCount: 1,
    });
    expect(res.entries[1]).toEqual({
      rank: 2,
      creator: {
        id: a.id,
        platform: "x",
        handle: a.handle,
        displayName: "Creator A",
        avatarUrl: null,
        profileUrl: a.profileUrl,
      },
      score: "2190",
      views: "1500",
      likes: "14",
      comments: "3",
      shares: "1",
      postCount: 2,
    });
  });

  it("filters by platform, defaulting to all", async () => {
    const x = await seedCreator();
    await seedPost(x.id, { latestViews: 100n, latestSnapshotAt: IN_WINDOW });
    const tiktok = await seedCreator({ platform: "tiktok" });
    await seedPost(tiktok.id, {
      platform: "tiktok",
      latestViews: 200n,
      latestSnapshotAt: IN_WINDOW,
    });

    const only = await caller.leaderboard.get({
      period: "alltime",
      platform: "tiktok",
    });
    expect(only.entries.map((e) => e.creator.id)).toEqual([tiktok.id]);

    const all = await caller.leaderboard.get({ period: "alltime" });
    expect(all.entries.map((e) => e.creator.id).sort()).toEqual(
      [x.id, tiktok.id].sort(),
    );
  });

  it("round-trips counts beyond 2^53 through plain JSON", async () => {
    const c = await seedCreator();
    await seedPost(c.id, {
      latestViews: 9007199254740993n, // 2^53 + 1
      latestSnapshotAt: IN_WINDOW,
    });

    const res = await caller.leaderboard.get({ period: "alltime" });
    expect(res.entries[0]?.views).toBe("9007199254740993");
    expect(res.entries[0]?.score).toBe("9007199254740993");
    // Plain JSON.stringify throws on bigint — surviving the round-trip
    // intact proves every count crossed the boundary as a string.
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});

describe("leaderboard.get daily", () => {
  it("scores in-window snapshot deltas, never the latest_* denorm", async () => {
    const c = await seedCreator();
    const post = await seedPost(c.id, {
      // Poisoned denorm: the daily path must read snapshots only.
      latestViews: 999999999n,
      latestLikes: 999n,
      latestComments: 999n,
      latestShares: 999n,
      latestSnapshotAt: IN_WINDOW,
    });
    await seedSnapshot(post.id, {
      views: 1000n,
      likes: 10n,
      comments: 2n,
      shares: 1n,
      capturedAt: BEFORE_WINDOW,
    });
    await seedSnapshot(post.id, {
      views: 3000n,
      likes: 20n,
      comments: 5n,
      shares: 2n,
      capturedAt: IN_WINDOW,
    });

    // Scanned but idle: baseline only, zero in-window snapshots ⇒ exactly 0,
    // no cross-window fallback to the (poisoned) denorm.
    const idle = await seedCreator();
    const idlePost = await seedPost(idle.id, {
      latestViews: 777777n,
      latestSnapshotAt: BEFORE_WINDOW,
    });
    await seedSnapshot(idlePost.id, {
      views: 5000n,
      capturedAt: BEFORE_WINDOW,
    });

    const res = await caller.leaderboard.get({ period: "daily" });

    expect(res.window).toEqual({
      start: "2026-07-06T00:00:00.000Z",
      end: "2026-07-07T00:00:00.000Z",
    });
    // Deltas 2000/10/3/1 → 2000 + 10·30 + 3·60 + 1·90 = 2570.
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0]).toMatchObject({
      rank: 1,
      score: "2570",
      views: "2000",
      likes: "10",
      comments: "3",
      shares: "1",
      postCount: 1,
    });
    expect(res.entries[0]?.creator.id).toBe(c.id);
    expect(res.entries[1]).toMatchObject({
      rank: 2,
      score: "0",
      views: "0",
      postCount: 1,
    });
    expect(res.entries[1]?.creator.id).toBe(idle.id);
  });

  it("returns the window even when the board is empty", async () => {
    const res = await caller.leaderboard.get({ period: "daily" });
    expect(res.entries).toEqual([]);
    expect(res.nextCursor).toBeNull();
    expect(res.window).toEqual({
      start: "2026-07-06T00:00:00.000Z",
      end: "2026-07-07T00:00:00.000Z",
    });
  });
});

describe("leaderboard.get pagination", () => {
  it("continues the total order across pages without overlap", async () => {
    const scores = [300n, 200n, 100n];
    const ids: string[] = [];
    for (const views of scores) {
      const c = await seedCreator();
      await seedPost(c.id, { latestViews: views, latestSnapshotAt: IN_WINDOW });
      ids.push(c.id);
    }

    const page1 = await caller.leaderboard.get({ period: "alltime", limit: 2 });
    expect(page1.entries.map((e) => e.rank)).toEqual([1, 2]);
    expect(page1.entries.map((e) => e.creator.id)).toEqual([ids[0], ids[1]]);
    expect(page1.nextCursor).toBe(2);

    const page2 = await caller.leaderboard.get({
      period: "alltime",
      cursor: page1.nextCursor ?? 0,
      limit: 2,
    });
    expect(page2.entries.map((e) => e.rank)).toEqual([3]);
    expect(page2.entries.map((e) => e.creator.id)).toEqual([ids[2]]);
    expect(page2.nextCursor).toBeNull();

    const overlap = page1.entries.filter((e) =>
      page2.entries.some((f) => f.creator.id === e.creator.id),
    );
    expect(overlap).toEqual([]);
  });

  it("returns an empty list (a list is a list) on an empty board", async () => {
    const res = await caller.leaderboard.get({ period: "alltime" });
    expect(res.entries).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });
});

describe("leaderboard.get input validation", () => {
  it.each([
    ["limit above the 100 cap", { period: "alltime", limit: 101 }],
    ["zero limit", { period: "alltime", limit: 0 }],
    ["negative cursor", { period: "alltime", cursor: -1 }],
    ["unknown period", { period: "weekly" }],
    ["unexpected extra key", { period: "alltime", isAdmin: true }],
  ])("rejects %s with BAD_REQUEST", async (_label, input) => {
    const err = await caller.leaderboard
      .get(input as never)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
  });
});
