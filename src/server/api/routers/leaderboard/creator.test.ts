// @vitest-environment node
// Task 18 iteration 1 (spec 007): leaderboard.creator through the REAL router
// + query layer against a real test database. Unknown/banned → null (===
// null, never {} — single-entity rule). Summaries reuse the board queries, so
// the hand-derived expectations here are the same spec values the board
// shows. Clock pinned Date-only (see get.test.ts).
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
import { appRouter } from "@/server/api/root";
import { createCallerFactory, type TRPCContext } from "@/server/api/trpc";
import { posts } from "@/server/db/schema";
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

const NOW = new Date("2026-07-06T12:00:00.000Z");
const IN_WINDOW = new Date("2026-07-06T08:00:00.000Z");
const BEFORE_WINDOW = new Date("2026-07-05T20:00:00.000Z");
const UNKNOWN_UUID = "5b1f72cd-2c14-4b39-9c1e-6d3a1c9a7f42";

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

describe("leaderboard.creator null contract", () => {
  it("returns null (strictly) for an unknown uuid", async () => {
    const res = await caller.leaderboard.creator({ creatorId: UNKNOWN_UUID });
    expect(res).toBeNull();
  });

  it("returns null for a banned creator, whatever their numbers", async () => {
    const banned = await seedCreator({ isBanned: true });
    await seedPost(banned.id, {
      latestViews: 9999999n,
      latestSnapshotAt: IN_WINDOW,
    });
    const res = await caller.leaderboard.creator({ creatorId: banned.id });
    expect(res).toBeNull();
  });
});

describe("leaderboard.creator profile", () => {
  it("serializes hand-derived summaries, allow-listed DTOs, and newest-first posts", async () => {
    const walker = await seedCreator({ displayName: "Board Walker" });
    // post1: observed today. Denorm 1000/10/2/1 → all-time 1510; window
    // delta 600/6/1/1 → daily 930.
    const post1 = await seedPost(walker.id, {
      caption: "gm bulls",
      postedAt: new Date("2026-07-06T06:00:00.000Z"),
      submittedByUserId: "user_secret123",
      latestViews: 1000n,
      latestLikes: 10n,
      latestComments: 2n,
      latestShares: 1n,
      latestSnapshotAt: IN_WINDOW,
    });
    await seedSnapshot(post1.id, {
      views: 400n,
      likes: 4n,
      comments: 1n,
      shares: 0n,
      capturedAt: BEFORE_WINDOW,
    });
    await seedSnapshot(post1.id, {
      views: 1000n,
      likes: 10n,
      comments: 2n,
      shares: 1n,
      capturedAt: IN_WINDOW,
    });
    // post2: observed before today only → all-time 680, daily 0 (scanned but
    // idle, still counts toward daily postCount).
    const post2 = await seedPost(walker.id, {
      postedAt: new Date("2026-07-05T12:00:00.000Z"),
      latestViews: 500n,
      latestLikes: 4n,
      latestComments: 1n,
      latestShares: 0n,
      latestSnapshotAt: BEFORE_WINDOW,
    });
    await seedSnapshot(post2.id, {
      views: 500n,
      likes: 4n,
      comments: 1n,
      shares: 0n,
      capturedAt: BEFORE_WINDOW,
    });
    // post3: pending — appears nowhere no matter the numbers.
    await seedPost(walker.id, {
      status: "pending",
      postedAt: new Date("2026-07-06T09:00:00.000Z"),
      latestViews: 999999n,
      latestSnapshotAt: IN_WINDOW,
    });
    // post4: approved but never polled — listed with latestSnapshotAt null
    // (spec 008 "pending" state), excluded from both summaries. No postedAt:
    // slots into the order by createdAt.
    const post4 = await seedPost(walker.id, { latestSnapshotAt: null });
    await db
      .update(posts)
      .set({ createdAt: new Date("2026-07-06T07:00:00.000Z") })
      .where(eq(posts.id, post4.id));

    // Decoy creator: their numbers must not bleed into walker's profile.
    const decoy = await seedCreator();
    const decoyPost = await seedPost(decoy.id, {
      latestViews: 50000n,
      latestSnapshotAt: IN_WINDOW,
    });
    await seedSnapshot(decoyPost.id, {
      views: 50000n,
      capturedAt: IN_WINDOW,
    });

    const res = await caller.leaderboard.creator({ creatorId: walker.id });

    expect(res).not.toBeNull();
    if (res === null) throw new Error("unreachable");
    expect(Object.keys(res).sort()).toEqual(
      ["creator", "alltime", "daily", "posts"].sort(),
    );
    expect(res.creator).toEqual({
      id: walker.id,
      platform: "x",
      handle: walker.handle,
      displayName: "Board Walker",
      avatarUrl: null,
      profileUrl: walker.profileUrl,
    });
    // 1510 + 680; totals 1500/14/3/1 over the 2 observed posts.
    expect(res.alltime).toEqual({
      score: "2190",
      views: "1500",
      likes: "14",
      comments: "3",
      shares: "1",
      postCount: 2,
    });
    // 600 + 6·30 + 1·60 + 1·90 = 930; post2 scanned-but-idle keeps postCount 2.
    expect(res.daily).toEqual({
      score: "930",
      views: "600",
      likes: "6",
      comments: "1",
      shares: "1",
      postCount: 2,
    });
    // Newest first by coalesce(postedAt, createdAt): post4 (07:00 createdAt),
    // post1 (06:00 postedAt), post2 (yesterday). Pending post3 never listed.
    expect(res.posts.map((p) => p.id)).toEqual([post4.id, post1.id, post2.id]);
    expect(res.posts[1]).toEqual({
      id: post1.id,
      url: post1.url,
      caption: "gm bulls",
      postedAt: "2026-07-06T06:00:00.000Z",
      views: "1000",
      likes: "10",
      comments: "2",
      shares: "1",
      score: "1510",
      latestSnapshotAt: IN_WINDOW.toISOString(),
    });
    expect(res.posts[0]?.latestSnapshotAt).toBeNull();
    expect(res.posts[0]?.views).toBe("0");
  });

  it("gives a never-observed creator zero summaries but still lists their posts", async () => {
    const fresh = await seedCreator();
    await seedPost(fresh.id, { latestSnapshotAt: null });

    const res = await caller.leaderboard.creator({ creatorId: fresh.id });

    expect(res).not.toBeNull();
    const zero = {
      score: "0",
      views: "0",
      likes: "0",
      comments: "0",
      shares: "0",
      postCount: 0,
    };
    expect(res?.alltime).toEqual(zero);
    expect(res?.daily).toEqual(zero);
    expect(res?.posts).toHaveLength(1);
    expect(res?.posts[0]?.latestSnapshotAt).toBeNull();
  });

  it("lists only approved posts", async () => {
    const c = await seedCreator();
    const approved = await seedPost(c.id);
    await seedPost(c.id, { status: "pending" });
    await seedPost(c.id, { status: "rejected" });
    await seedPost(c.id, { status: "removed" });

    const res = await caller.leaderboard.creator({ creatorId: c.id });
    expect(res?.posts.map((p) => p.id)).toEqual([approved.id]);
  });

  it("caps the post list at the 50 newest", async () => {
    const farm = await seedCreator();
    const base = Date.parse("2026-07-01T00:00:00.000Z");
    const postedAtOf = (i: number) => new Date(base + i * 60_000);
    await db.insert(posts).values(
      Array.from({ length: 51 }, (_, i) => ({
        creatorId: farm.id,
        platform: "x" as const,
        platformPostId: `17770000000000000${String(i).padStart(3, "0")}`,
        url: `https://x.com/farm/status/17770000000000000${String(i).padStart(3, "0")}`,
        status: "approved" as const,
        source: "submission" as const,
        postedAt: postedAtOf(i),
      })),
    );

    const res = await caller.leaderboard.creator({ creatorId: farm.id });

    expect(res?.posts).toHaveLength(50);
    const postedAts = res?.posts.map((p) => p.postedAt) ?? [];
    expect(postedAts[0]).toBe(postedAtOf(50).toISOString()); // newest kept
    expect(postedAts).not.toContain(postedAtOf(0).toISOString()); // oldest dropped
  });
});

describe("leaderboard.creator input validation", () => {
  it.each([
    ["a malformed uuid", { creatorId: "not-a-uuid" }],
    ["an unexpected extra key", { creatorId: UNKNOWN_UUID, isAdmin: true }],
  ])("rejects %s with BAD_REQUEST", async (_label, input) => {
    const err = await caller.leaderboard
      .creator(input as never)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
  });
});
