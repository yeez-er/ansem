// @vitest-environment node
// Task 20 (spec 010): the idempotent seed script against a REAL test database,
// smoke-checked through Task 17's real leaderboard query layer. No fake timers:
// runSeed takes `now` as an explicit parameter (the CLI captures it once), so
// the suite pins an absolute instant instead of the ambient clock.
import { spawnSync } from "node:child_process";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dayWindow } from "@/lib/scoring";
import { alltimeBoard, dailyBoard } from "@/server/db/queries/leaderboard";
import { creators, metricSnapshots, posts } from "@/server/db/schema";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";
import { runSeed } from "./seed";
import { buildSnapshots, SEED_CREATORS, SEED_POSTS } from "./seed-data";

const testDb = connectTestDb();
const { db } = testDb;

const NOW = new Date("2026-07-06T13:00:00Z");
const CURVE_POSTS = SEED_POSTS.filter((p) => p.curve !== null);
const EXPECTED_SNAPSHOTS = CURVE_POSTS.reduce(
  (sum, p) => sum + (p.curve?.snapshots ?? 0),
  0,
);

async function tableCounts() {
  return {
    creators: await db.$count(creators),
    posts: await db.$count(posts),
    snapshots: await db.$count(metricSnapshots),
  };
}

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("runSeed", () => {
  it("seeds the full fixture set once, then re-runs (even at a later clock) without adding a single row", async () => {
    const first = await runSeed(db, { now: NOW });
    expect(first.creatorsInserted).toBe(SEED_CREATORS.length);
    expect(first.postsInserted).toBe(SEED_POSTS.length);
    expect(first.snapshotsInserted).toBe(EXPECTED_SNAPSHOTS);

    const counts = await tableCounts();
    expect(counts).toEqual({
      creators: SEED_CREATORS.length,
      posts: SEED_POSTS.length,
      snapshots: EXPECTED_SNAPSHOTS,
    });

    // Idempotence must not depend on identical timestamps — re-run an hour on.
    const second = await runSeed(db, {
      now: new Date(NOW.getTime() + 60 * 60 * 1000),
    });
    expect(second.creatorsInserted).toBe(0);
    expect(second.postsInserted).toBe(0);
    expect(second.postsExisting).toBe(SEED_POSTS.length);
    expect(second.snapshotsInserted).toBe(0);
    expect(await tableCounts()).toEqual(counts);
  });

  it("every seeded curve is monotonically non-decreasing in the database", async () => {
    await runSeed(db, { now: NOW });
    const rows = await db
      .select()
      .from(metricSnapshots)
      .orderBy(asc(metricSnapshots.postId), asc(metricSnapshots.capturedAt));
    const byPost = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byPost.get(row.postId) ?? [];
      bucket.push(row);
      byPost.set(row.postId, bucket);
    }
    expect(byPost.size).toBe(CURVE_POSTS.length);
    for (const [postId, snaps] of byPost) {
      expect(snaps.length).toBeGreaterThanOrEqual(4);
      expect(snaps.length).toBeLessThanOrEqual(10);
      for (let i = 1; i < snaps.length; i++) {
        const prev = snaps[i - 1];
        const cur = snaps[i];
        if (!prev || !cur) throw new Error("index out of range");
        expect(
          cur.capturedAt.getTime(),
          `post ${postId} captured_at not increasing`,
        ).toBeGreaterThan(prev.capturedAt.getTime());
        expect(cur.views >= prev.views, `post ${postId} views decreased`).toBe(
          true,
        );
        expect(cur.likes >= prev.likes, `post ${postId} likes decreased`).toBe(
          true,
        );
        expect(
          cur.comments >= prev.comments,
          `post ${postId} comments decreased`,
        ).toBe(true);
        expect(
          cur.shares >= prev.shares,
          `post ${postId} shares decreased`,
        ).toBe(true);
      }
    }
  });

  it("posts carry truthful latest_* denorm equal to their newest seeded snapshot", async () => {
    await runSeed(db, { now: NOW });
    const seeded = await db.select().from(posts);
    const byKey = new Map(
      seeded.map((p) => [`${p.platform}:${p.platformPostId}`, p]),
    );
    for (const fixture of SEED_POSTS) {
      const row = byKey.get(`${fixture.platform}:${fixture.platformPostId}`);
      expect(row, `post ${fixture.platformPostId} missing`).toBeDefined();
      if (!row) continue;
      if (fixture.curve === null) {
        expect(row.latestSnapshotAt).toBeNull();
        expect(row.latestViews).toBe(0n);
        continue;
      }
      const last = buildSnapshots(fixture, NOW).at(-1);
      expect(row.latestViews).toBe(fixture.curve.final.views);
      expect(row.latestLikes).toBe(fixture.curve.final.likes);
      expect(row.latestComments).toBe(fixture.curve.final.comments);
      expect(row.latestShares).toBe(fixture.curve.final.shares);
      expect(row.latestSnapshotAt?.getTime()).toBe(last?.capturedAt.getTime());
    }

    // The em-dash story: exactly one VISIBLE approved post awaits its first poll.
    const neverPolled = await db
      .select({ platformPostId: posts.platformPostId })
      .from(posts)
      .innerJoin(creators, eq(posts.creatorId, creators.id))
      .where(
        and(
          eq(posts.status, "approved"),
          eq(creators.isBanned, false),
          isNull(posts.latestSnapshotAt),
        ),
      );
    expect(neverPolled).toHaveLength(1);
    expect(neverPolled[0]?.platformPostId).toBe("CSEED0203");
  });

  it("tells the board story through the REAL query layer: daily winner ≠ all-time winner", async () => {
    await runSeed(db, { now: NOW });
    const daily = await dailyBoard(db, { now: NOW });
    const alltime = await alltimeBoard(db);

    expect(daily.window).toEqual(dayWindow(NOW));
    expect(daily.entries[0]?.creator.handle).toBe("ansemtok");
    expect(alltime.entries[0]?.creator.handle).toBe("bullpostoor");
    expect(daily.entries[0]?.creator.handle).not.toBe(
      alltime.entries[0]?.creator.handle,
    );

    // Hand-derived spec values (seed-data.test.ts derives the same numbers
    // from the fixtures without touching SQL).
    expect(alltime.entries[0]?.score).toBe(6_002_500n);
    expect(daily.entries[0]?.score).toBeGreaterThanOrEqual(1_730_700n);

    // The all-time king has ALL snapshots before today 00:00 UTC — he stays
    // on the daily board at exactly 0 (spec 007's zero-contribution case).
    const idleKing = daily.entries.find(
      (e) => e.creator.handle === "bullpostoor",
    );
    expect(idleKing).toBeDefined();
    expect(idleKing?.score).toBe(0n);
  });

  it("banned creator's high-scoring posts exist in the DB but appear on NO board", async () => {
    await runSeed(db, { now: NOW });
    const bannedPosts = await db
      .select({ status: posts.status })
      .from(posts)
      .innerJoin(creators, eq(posts.creatorId, creators.id))
      .where(eq(creators.handle, "ruggedbull"));
    expect(bannedPosts).toHaveLength(3);
    expect(bannedPosts.every((p) => p.status === "approved")).toBe(true);

    const boards = [
      await dailyBoard(db, { now: NOW }),
      await alltimeBoard(db),
      await dailyBoard(db, { now: NOW, platform: "x" }),
      await alltimeBoard(db, { platform: "x" }),
    ];
    for (const board of boards) {
      expect(board.entries.map((e) => e.creator.handle)).not.toContain(
        "ruggedbull",
      );
    }
  });

  it("every platform tab has an all-time top-3, with the unclaimed placeholder ranked on instagram", async () => {
    await runSeed(db, { now: NOW });
    for (const platform of ["x", "tiktok", "instagram"] as const) {
      const board = await alltimeBoard(db, { platform });
      expect(
        board.entries.length,
        `alltime ${platform} board too small`,
      ).toBeGreaterThanOrEqual(3);
      for (const entry of board.entries) {
        expect(entry.creator.platform).toBe(platform);
      }
      const dailyForPlatform = await dailyBoard(db, { now: NOW, platform });
      expect(
        dailyForPlatform.entries.length,
        `daily ${platform} board empty`,
      ).toBeGreaterThanOrEqual(1);
    }
    const ig = await alltimeBoard(db, { platform: "instagram" });
    const placeholder = ig.entries.find((e) =>
      e.creator.handle.startsWith("placeholder:"),
    );
    expect(placeholder).toBeDefined();
    expect(placeholder?.creator.displayName).toBeNull();
  });
});

describe("seed CLI (pnpm db:seed)", () => {
  const runSeedCli = (databaseUrl: string) =>
    spawnSync("./node_modules/.bin/tsx", ["src/server/db/seed.ts"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    });

  it(
    "exits 0 on a fresh run and on a re-run, printing top-3 boards through the query layer",
    {
      timeout: 240_000,
    },
    async () => {
      const url = process.env.TEST_DATABASE_URL;
      if (!url) throw new Error("TEST_DATABASE_URL required");

      const first = runSeedCli(url);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toMatch(/daily top-3/);
      expect(first.stdout).toMatch(/all-time top-3/);

      const counts = await tableCounts();
      const second = runSeedCli(url);
      expect(second.status, second.stderr).toBe(0);
      expect(await tableCounts()).toEqual(counts);
    },
  );

  it(
    "exits non-zero with a readable error when the database is unreachable",
    {
      timeout: 120_000,
    },
    () => {
      const result = runSeedCli("postgresql://seed:seed@127.0.0.1:9/nowhere");
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/seed\.failed/);
    },
  );
});
