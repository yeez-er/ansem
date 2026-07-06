// @vitest-environment node
// Task 27 (spec 009B): admin.creators — the moderation creator list against a
// REAL test database. Covers the adminProcedure boundary (UNAUTHORIZED for
// anonymous, FORBIDDEN for authed non-admins) and the query itself: EVERY
// creator (banned included — this is the view where you unban them) with a total
// post count across all statuses, busiest first with a handle tie-break for a
// stable total order, and an empty database → [] (a list is a list).
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

// ctx built by hand: { userId, isAdmin } is session-derived in production (spec
// 009A — never from input), so tests inject it directly; db is the real client.
function callerAs(opts: { userId: string | null; isAdmin: boolean }) {
  const ctx: TRPCContext = {
    headers: new Headers(),
    userId: opts.userId,
    isAdmin: opts.isAdmin,
    db,
  };
  return createCaller(ctx);
}

const asAdmin = () => callerAs({ userId: "user_admin", isAdmin: true });
const asUser = () => callerAs({ userId: "user_regular", isAdmin: false });
const asAnon = () => callerAs({ userId: null, isAdmin: false });

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adminProcedure boundary", () => {
  it("anonymous caller → UNAUTHORIZED", async () => {
    const result = await asAnon()
      .admin.creators()
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("authenticated non-admin → FORBIDDEN", async () => {
    const result = await asUser()
      .admin.creators()
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("admin.creators", () => {
  it("returns every creator with a total post count, busiest first (handle tie-break)", async () => {
    const alpha = await seedCreator({ handle: "alpha", displayName: "Alpha" });
    // All four statuses count toward the total — this is a moderation view of
    // everything the creator has ever posted, not the public board.
    await seedPost(alpha.id, { status: "pending" });
    await seedPost(alpha.id, { status: "approved" });
    await seedPost(alpha.id, { status: "rejected" });
    await seedPost(alpha.id, { status: "removed" });

    const bravo = await seedCreator({ handle: "bravo" });
    await seedPost(bravo.id, { status: "approved" });

    const delta = await seedCreator({ handle: "delta" });
    await seedPost(delta.id, { status: "pending" });

    // Banned, zero posts — still listed (unban happens here).
    const charlie = await seedCreator({ handle: "charlie", isBanned: true });

    const rows = await asAdmin().admin.creators();

    // busiest first; the count-1 tie (bravo, delta) breaks on handle asc
    expect(rows.map((r) => r.handle)).toEqual([
      "alpha",
      "bravo",
      "delta",
      "charlie",
    ]);
    expect(rows.map((r) => r.postCount)).toEqual([4, 1, 1, 0]);

    const alphaRow = rows.find((r) => r.id === alpha.id);
    expect(alphaRow).toMatchObject({ isBanned: false, postCount: 4 });
    const charlieRow = rows.find((r) => r.id === charlie.id);
    expect(charlieRow).toMatchObject({ isBanned: true, postCount: 0 });
  });

  it("exposes exactly the admin columns (no profileUrl/avatarUrl leak)", async () => {
    const creator = await seedCreator({
      handle: "shape",
      displayName: "Shape",
    });
    const [row] = await asAdmin().admin.creators();
    expect(row).toBeDefined();
    expect(Object.keys(row).sort()).toEqual(
      [
        "displayName",
        "handle",
        "id",
        "isBanned",
        "platform",
        "postCount",
      ].sort(),
    );
    expect(row).toMatchObject({ id: creator.id, platform: "x" });
  });

  it("returns [] when there are no creators (a list is a list)", async () => {
    const rows = await asAdmin().admin.creators();
    expect(rows).toEqual([]);
  });
});
