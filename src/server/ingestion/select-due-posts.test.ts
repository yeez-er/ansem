// @vitest-environment node
// Task 12 (spec 004): selectDuePosts — the bounded stalest-first refresh queue,
// against a REAL test database. The query never reads the clock (it only orders
// by stored latest_snapshot_at), so ordering is pinned with absolute timestamps
// and no fake timers are needed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";
import {
  DEFAULT_REFRESH_BATCH_SIZE,
  resolveRefreshBatchSize,
  selectDuePosts,
} from "./select-due-posts";

const testDb = connectTestDb();
const { db } = testDb;

// Absolute pinned instants — only their ORDER matters to the query.
const T1_STALEST = new Date("2026-07-01T00:00:00Z");
const T2_MIDDLE = new Date("2026-07-02T00:00:00Z");
const T3_FRESHEST = new Date("2026-07-03T00:00:00Z");

// Shared seeding helper — extracted to src/tests/helpers/seed.ts on the 3rd
// occurrence (submit, select-due-posts, refresh-metrics), as scheduled.
const { seedCreator, seedPost } = makeSeeders(db);

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("selectDuePosts", () => {
  it("selects the stalest posts first, bounded by the batch size, and reports truncation counts", async () => {
    const creator = await seedCreator();
    // Inserted shuffled so the ordering cannot ride on insertion order.
    await seedPost(creator.id, { latestSnapshotAt: T3_FRESHEST });
    const stalest = await seedPost(creator.id, {
      latestSnapshotAt: T1_STALEST,
    });
    const middle = await seedPost(creator.id, { latestSnapshotAt: T2_MIDDLE });

    const result = await selectDuePosts(db, 2);

    expect(result.posts.map((p) => p.id)).toEqual([stalest.id, middle.id]);
    expect(result.selected).toBe(2);
    expect(result.totalDue).toBe(3);
  });

  it("never-snapshotted posts (NULL latest_snapshot_at) sort before every timestamped post", async () => {
    const creator = await seedCreator();
    const timestamped = await seedPost(creator.id, {
      latestSnapshotAt: T1_STALEST,
    });
    const neverPolled = await seedPost(creator.id); // latest_snapshot_at NULL

    const result = await selectDuePosts(db, 10);

    expect(result.posts.map((p) => p.id)).toEqual([
      neverPolled.id,
      timestamped.id,
    ]);
    expect(result.posts[0]?.latestSnapshotAt).toBeNull();
  });

  it("selects only approved posts — pending, rejected, and removed are never due", async () => {
    const creator = await seedCreator();
    await seedPost(creator.id, { status: "pending" });
    await seedPost(creator.id, { status: "rejected" });
    await seedPost(creator.id, { status: "removed" });
    const approved = await seedPost(creator.id, { status: "approved" });

    const result = await selectDuePosts(db, 10);

    expect(result.posts.map((p) => p.id)).toEqual([approved.id]);
    // Excluded posts are not "due" either — they must not inflate the total.
    expect(result.totalDue).toBe(1);
  });

  it("never selects posts from banned creators, even when they are the stalest", async () => {
    const banned = await seedCreator({ isBanned: true });
    await seedPost(banned.id); // NULL snapshot — would sort first if eligible
    const active = await seedCreator();
    const alive = await seedPost(active.id, { latestSnapshotAt: T2_MIDDLE });

    const result = await selectDuePosts(db, 10);

    expect(result.posts.map((p) => p.id)).toEqual([alive.id]);
    expect(result.totalDue).toBe(1);
  });

  it("empty database → empty list with zero counts (a list is a list — [] not null)", async () => {
    const result = await selectDuePosts(db, 10);

    expect(result.posts).toEqual([]);
    expect(result.selected).toBe(0);
    expect(result.totalDue).toBe(0);
  });

  it("rows carry what ingestion needs to call providers and write back", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { latestSnapshotAt: T1_STALEST });

    const result = await selectDuePosts(db, 10);

    expect(result.posts[0]).toMatchObject({
      id: post.id,
      creatorId: creator.id,
      platform: "x",
      platformPostId: post.platformPostId,
      url: post.url,
      latestSnapshotAt: T1_STALEST,
    });
  });
});

describe("resolveRefreshBatchSize", () => {
  it("defaults to the spec value 200 when REFRESH_BATCH_SIZE is unset", () => {
    expect(resolveRefreshBatchSize({})).toBe(200);
    expect(DEFAULT_REFRESH_BATCH_SIZE).toBe(200);
  });

  it("is env-tunable: a configured REFRESH_BATCH_SIZE wins over the default", () => {
    expect(resolveRefreshBatchSize({ REFRESH_BATCH_SIZE: 50 })).toBe(50);
  });
});

describe("source verification", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "server", "ingestion", "select-due-posts.ts"),
    "utf8",
  );

  it("bounds the query with .limit and resolves the bound from REFRESH_BATCH_SIZE", () => {
    expect(source).toMatch(/\.limit\(/);
    expect(source).toMatch(/REFRESH_BATCH_SIZE/);
  });

  it("orders stalest-first with explicit NULLS FIRST (postgres ASC defaults to NULLS LAST)", () => {
    expect(source).toMatch(/nulls first/i);
  });
});
