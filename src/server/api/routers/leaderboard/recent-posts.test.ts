// @vitest-environment node
// Task 18 iteration 2 (spec 007): leaderboard.recentPosts through the REAL
// router + query layer — the home-page ticker. Latest approved posts across
// platforms, newest-first by coalesce(posted_at, created_at), each embedding
// its creator as an allow-listed PublicCreator. No fake timers: the procedure
// never reads the clock (ordering instants are seeded explicitly). Task 19
// wraps the procedure in the 60s response cache, so the fake incremental
// cache must be installed FRESH per test — TTL behavior itself is owned by
// cache.test.ts.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const { seedCreator, seedPost } = makeSeeders(db);

const createCaller = createCallerFactory(appRouter);
const ctx: TRPCContext = {
  headers: new Headers(),
  userId: null,
  isAdmin: false,
  db,
};
const caller = createCaller(ctx);

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  uninstallFakeIncrementalCache();
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
  installFakeIncrementalCache();
});

// Exact-keys allow-list sets (spec 007): PublicPost + the embedded creator.
const RECENT_POST_KEYS = [
  "id",
  "url",
  "caption",
  "postedAt",
  "views",
  "likes",
  "comments",
  "shares",
  "score",
  "latestSnapshotAt",
  "creator",
].sort();
const PUBLIC_CREATOR_KEYS = [
  "id",
  "platform",
  "handle",
  "displayName",
  "avatarUrl",
  "profileUrl",
].sort();

describe("leaderboard.recentPosts feed", () => {
  it("returns newest-first approved posts across platforms with exactly the allow-listed keys", async () => {
    const walker = await seedCreator({ displayName: "Board Walker" });
    const dancer = await seedCreator({ platform: "tiktok" });
    // Oldest: full metrics + a submitter id that must never cross the wire.
    // Hand-derived score: 1000 + 10·30 + 2·60 + 1·90 = 1510 (spec 006).
    const observed = await seedPost(walker.id, {
      caption: "gm bulls",
      postedAt: new Date("2026-07-06T10:00:00.000Z"),
      submittedByUserId: "user_secret123",
      latestViews: 1000n,
      latestLikes: 10n,
      latestComments: 2n,
      latestShares: 1n,
      latestSnapshotAt: new Date("2026-07-06T11:00:00.000Z"),
    });
    // Middle: never polled, no posted_at (spec 004 never writes it for
    // submissions) — slots in by created_at, latestSnapshotAt stays null.
    const unpolled = await seedPost(walker.id, { latestSnapshotAt: null });
    await db
      .update(posts)
      .set({ createdAt: new Date("2026-07-06T10:30:00.000Z") })
      .where(eq(posts.id, unpolled.id));
    // Newest: another platform — the feed spans all of them.
    const tiktok = await seedPost(dancer.id, {
      platform: "tiktok",
      postedAt: new Date("2026-07-06T11:00:00.000Z"),
    });

    const res = await caller.leaderboard.recentPosts({});

    expect(res.map((p) => p.id)).toEqual([tiktok.id, unpolled.id, observed.id]);
    expect(res[0]?.creator.platform).toBe("tiktok");
    expect(res[1]?.latestSnapshotAt).toBeNull();
    expect(res[1]?.views).toBe("0");
    for (const item of res) {
      expect(Object.keys(item).sort()).toEqual(RECENT_POST_KEYS);
      expect(Object.keys(item.creator).sort()).toEqual(PUBLIC_CREATOR_KEYS);
    }
    expect(res[2]).toEqual({
      id: observed.id,
      url: observed.url,
      caption: "gm bulls",
      postedAt: "2026-07-06T10:00:00.000Z",
      views: "1000",
      likes: "10",
      comments: "2",
      shares: "1",
      score: "1510",
      latestSnapshotAt: "2026-07-06T11:00:00.000Z",
      creator: {
        id: walker.id,
        platform: "x",
        handle: walker.handle,
        displayName: "Board Walker",
        avatarUrl: null,
        profileUrl: walker.profileUrl,
      },
    });
  });

  it("shows only approved posts from non-banned creators (each excluded case covered)", async () => {
    const good = await seedCreator();
    const visible = await seedPost(good.id);
    await seedPost(good.id, { status: "pending" });
    await seedPost(good.id, { status: "rejected" });
    await seedPost(good.id, { status: "removed" });
    const banned = await seedCreator({ isBanned: true });
    await seedPost(banned.id, {
      postedAt: new Date("2026-07-06T11:00:00.000Z"),
      latestViews: 999999n,
    });

    const res = await caller.leaderboard.recentPosts({});
    expect(res.map((p) => p.id)).toEqual([visible.id]);
  });

  it("defaults the limit to the 12 newest", async () => {
    const c = await seedCreator();
    const base = Date.parse("2026-07-01T00:00:00.000Z");
    const postedAtOf = (i: number) => new Date(base + i * 60_000);
    for (let i = 0; i < 13; i += 1) {
      await seedPost(c.id, { postedAt: postedAtOf(i) });
    }

    const res = await caller.leaderboard.recentPosts({});

    expect(res).toHaveLength(12);
    const postedAts = res.map((p) => p.postedAt);
    expect(postedAts[0]).toBe(postedAtOf(12).toISOString()); // newest kept
    expect(postedAts).not.toContain(postedAtOf(0).toISOString()); // oldest dropped
  });

  it("honors an explicit limit", async () => {
    const c = await seedCreator();
    await seedPost(c.id, { postedAt: new Date("2026-07-06T09:00:00.000Z") });
    const second = await seedPost(c.id, {
      postedAt: new Date("2026-07-06T10:00:00.000Z"),
    });
    const first = await seedPost(c.id, {
      postedAt: new Date("2026-07-06T11:00:00.000Z"),
    });

    const res = await caller.leaderboard.recentPosts({ limit: 2 });
    expect(res.map((p) => p.id)).toEqual([first.id, second.id]);
  });

  it("returns [] for an empty board (a list is a list — spec 007)", async () => {
    const res = await caller.leaderboard.recentPosts({});
    expect(res).toEqual([]);
  });

  it("serializes > 2^53 view counts as exact strings through a plain JSON round-trip", async () => {
    const c = await seedCreator();
    await seedPost(c.id, {
      latestViews: 9007199254740993n, // 2^53 + 1 — unrepresentable as a double
      latestSnapshotAt: new Date("2026-07-06T11:00:00.000Z"),
    });

    const res = await caller.leaderboard.recentPosts({});

    // Doubles as the no-bigint-leak check: JSON.stringify throws on bigint.
    const wire = JSON.parse(JSON.stringify(res)) as typeof res;
    expect(wire[0]?.views).toBe("9007199254740993");
  });
});

describe("leaderboard.recentPosts input validation", () => {
  it.each([
    ["limit 0", { limit: 0 }],
    ["limit 51", { limit: 51 }],
    ["a fractional limit", { limit: 1.5 }],
    ["an unexpected extra key", { limit: 12, isAdmin: true }],
  ])("rejects %s with BAD_REQUEST", async (_label, input) => {
    const err = await caller.leaderboard
      .recentPosts(input as never)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
  });
});
