// @vitest-environment node
// Task 3 (spec 001): runtime constraint tests against a REAL test database.
// Mocked tests structurally cannot prove constraints, bigint fidelity, or
// cascade behavior — this suite drops and recreates the target database's
// schema on every run, so TEST_DATABASE_URL must point at a DEDICATED test DB.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  creators,
  discoveryState,
  metricSnapshots,
  posts,
} from "@/server/db/schema";
import {
  connectTestDb,
  migrateFresh,
  pgError,
  truncateAll,
} from "@/tests/helpers/test-db";

const testDb = connectTestDb();
const { db } = testDb;

async function insertCreator(
  overrides: Partial<typeof creators.$inferInsert> = {},
) {
  const [row] = await db
    .insert(creators)
    .values({
      platform: "x",
      handle: "blackbull",
      profileUrl: "https://x.com/blackbull",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("creator insert returned no row");
  return row;
}

async function insertPost(
  creatorId: string,
  overrides: Partial<typeof posts.$inferInsert> = {},
) {
  const [row] = await db
    .insert(posts)
    .values({
      creatorId,
      platform: "x",
      platformPostId: "1801234567890123456",
      url: "https://x.com/blackbull/status/1801234567890123456",
      source: "submission",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("post insert returned no row");
  return row;
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

describe("migration applies cleanly to a fresh database", () => {
  it("creates the three tables and three enums", async () => {
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["creators", "posts", "metric_snapshots"]),
    );

    const enums = await db.execute<{ typname: string }>(
      sql`select typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typtype = 'e' and n.nspname = 'public'`,
    );
    expect(enums.rows.map((r) => r.typname).sort()).toEqual([
      "platform",
      "post_source",
      "post_status",
    ]);
  });
});

describe("creators natural key", () => {
  it("duplicate (platform, handle) violates creators_platform_handle_unique", async () => {
    await insertCreator();
    const err = await insertCreator({
      displayName: "same account again",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(pgError(err)).toMatchObject({
      code: "23505",
      constraint: "creators_platform_handle_unique",
    });
  });

  it("same handle on a DIFFERENT platform is allowed (composite key)", async () => {
    await insertCreator();
    const row = await insertCreator({
      platform: "tiktok",
      profileUrl: "https://www.tiktok.com/@blackbull",
    });
    expect(row.platform).toBe("tiktok");
  });
});

describe("posts natural key", () => {
  it("duplicate (platform, platform_post_id) violates posts_platform_platform_post_id_unique", async () => {
    const creator = await insertCreator();
    await insertPost(creator.id);
    const err = await insertPost(creator.id, {
      url: "https://x.com/someone-else/status/1801234567890123456",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(pgError(err)).toMatchObject({
      code: "23505",
      constraint: "posts_platform_platform_post_id_unique",
    });
  });

  it("same platform_post_id on a DIFFERENT platform is allowed (composite key)", async () => {
    const xCreator = await insertCreator();
    await insertPost(xCreator.id);
    const tiktokCreator = await insertCreator({
      platform: "tiktok",
      profileUrl: "https://www.tiktok.com/@blackbull",
    });
    const row = await insertPost(tiktokCreator.id, {
      platform: "tiktok",
      url: "https://www.tiktok.com/@blackbull/video/1801234567890123456",
    });
    expect(row.platform).toBe("tiktok");
  });
});

describe("bigint counts (X view counts overflow int4; big ones overflow Number)", () => {
  it("latest_* round-trips values > 2^31 and > 2^53 exactly; unset columns default to 0n", async () => {
    const creator = await insertCreator();
    const inserted = await insertPost(creator.id, {
      latestViews: 9007199254740993n, // 2^53 + 1 — unrepresentable as a JS number
      latestLikes: 3000000000n, // > 2^31 — overflows int4
    });
    const [row] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, inserted.id));
    expect(row).toMatchObject({
      latestViews: 9007199254740993n,
      latestLikes: 3000000000n,
      latestComments: 0n,
      latestShares: 0n,
      latestSnapshotAt: null,
    });
  });

  it("snapshot counts round-trip > 2^31 exactly", async () => {
    const creator = await insertCreator();
    const post = await insertPost(creator.id);
    const [snap] = await db
      .insert(metricSnapshots)
      .values({ postId: post.id, views: 3000000001n })
      .returning();
    expect(snap?.views).toBe(3000000001n);
  });
});

describe("discovery_state cursor store (spec 005)", () => {
  it("row with only a platform gets a null cursor and a defaulted updated_at", async () => {
    const [row] = await db
      .insert(discoveryState)
      .values({ platform: "x" })
      .returning();
    expect(row).toMatchObject({ platform: "x", cursor: null });
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("duplicate platform violates the primary key (single cursor row per platform)", async () => {
    await db
      .insert(discoveryState)
      .values({ platform: "x", cursor: "1900000000000000001" });
    const err = await db
      .insert(discoveryState)
      .values({ platform: "x", cursor: "1900000000000000002" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(pgError(err)).toMatchObject({
      code: "23505",
      constraint: "discovery_state_pkey",
    });
  });
});

describe("metric_snapshots lifecycle", () => {
  it("cascade-deletes with its post; the creator survives", async () => {
    const creator = await insertCreator();
    const post = await insertPost(creator.id);
    await db.insert(metricSnapshots).values([
      { postId: post.id, views: 100n },
      { postId: post.id, views: 250n },
    ]);

    await db.delete(posts).where(eq(posts.id, post.id));

    const orphans = await db
      .select()
      .from(metricSnapshots)
      .where(eq(metricSnapshots.postId, post.id));
    expect(orphans).toHaveLength(0);

    const survivingCreators = await db
      .select()
      .from(creators)
      .where(eq(creators.id, creator.id));
    expect(survivingCreators).toHaveLength(1);
  });
});
