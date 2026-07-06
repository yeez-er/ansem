// @vitest-environment node
// Task 25 (spec 009B): admin moderation router against a REAL test database.
// Covers the adminProcedure boundary (FORBIDDEN for authed non-admins,
// UNAUTHORIZED for anonymous), reviewPost (pending → approved/rejected, the
// atomic status gate → PRECONDITION_FAILED on re-review, NOT_FOUND on a missing
// post, board visibility through the real query layer), and banCreator
// (is_banned + same-transaction bulk-reject of pending posts, a
// distinct-transaction ban/approve race, board hiding, and unban). Every
// mutation emits one structured audit line (no audit table in v1 — captured
// via a console.info spy).
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
import { alltimeBoard } from "@/server/db/queries/leaderboard";
import { creators, posts } from "@/server/db/schema";
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

// An OBSERVED approved-eligible post: latest_snapshot_at + latest_* set so it
// lands on the all-time board the moment its status becomes approved.
const OBSERVED = {
  latestSnapshotAt: new Date("2026-07-01T00:00:00Z"),
  latestViews: 1000n,
} as const;

async function statusOf(postId: string) {
  const [row] = await db
    .select({ status: posts.status })
    .from(posts)
    .where(eq(posts.id, postId));
  return row?.status;
}

async function isBanned(creatorId: string) {
  const [row] = await db
    .select({ isBanned: creators.isBanned })
    .from(creators)
    .where(eq(creators.id, creatorId));
  return row?.isBanned;
}

type AuditLine = {
  event: string;
  actor: string;
  action: string;
  target: string;
};

function auditLines(spy: ReturnType<typeof vi.spyOn>): AuditLine[] {
  const lines: AuditLine[] = [];
  for (const call of spy.mock.calls) {
    try {
      const parsed = JSON.parse(String(call[0]));
      if (parsed?.event === "admin.audit") lines.push(parsed);
    } catch {
      // non-JSON console.info line — ignore
    }
  }
  return lines;
}

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adminProcedure boundary", () => {
  it("anonymous caller → UNAUTHORIZED on every admin mutation", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "pending" });

    const review = await asAnon()
      .admin.reviewPost({ postId: post.id, decision: "approved" })
      .catch((e: unknown) => e);
    const ban = await asAnon()
      .admin.banCreator({ creatorId: creator.id, banned: true })
      .catch((e: unknown) => e);

    expect(review).toMatchObject({ code: "UNAUTHORIZED" });
    expect(ban).toMatchObject({ code: "UNAUTHORIZED" });
    // fails closed: nothing mutated
    expect(await statusOf(post.id)).toBe("pending");
    expect(await isBanned(creator.id)).toBe(false);
  });

  it("authenticated non-admin → FORBIDDEN on every admin mutation", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "pending" });

    const review = await asUser()
      .admin.reviewPost({ postId: post.id, decision: "approved" })
      .catch((e: unknown) => e);
    const ban = await asUser()
      .admin.banCreator({ creatorId: creator.id, banned: true })
      .catch((e: unknown) => e);

    expect(review).toMatchObject({ code: "FORBIDDEN" });
    expect(ban).toMatchObject({ code: "FORBIDDEN" });
    expect(await statusOf(post.id)).toBe("pending");
    expect(await isBanned(creator.id)).toBe(false);
  });
});

describe("reviewPost", () => {
  it("approves a pending post, returns the updated entity, and emits an audit line", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "pending" });

    const updated = await asAdmin().admin.reviewPost({
      postId: post.id,
      decision: "approved",
    });

    expect(updated).toMatchObject({ id: post.id, status: "approved" });
    expect(await statusOf(post.id)).toBe("approved");
    expect(auditLines(infoSpy)).toContainEqual({
      event: "admin.audit",
      actor: "user_admin",
      action: "post.approved",
      target: post.id,
    });
  });

  it("rejects a pending post and emits the matching audit line", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "pending" });

    const updated = await asAdmin().admin.reviewPost({
      postId: post.id,
      decision: "rejected",
    });

    expect(updated.status).toBe("rejected");
    expect(auditLines(infoSpy)).toContainEqual({
      event: "admin.audit",
      actor: "user_admin",
      action: "post.rejected",
      target: post.id,
    });
  });

  it("re-reviewing an already-reviewed post → PRECONDITION_FAILED, status unchanged", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "approved" });

    const result = await asAdmin()
      .admin.reviewPost({ postId: post.id, decision: "rejected" })
      .catch((e: unknown) => e);

    expect(result).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await statusOf(post.id)).toBe("approved");
  });

  it("reviewing a nonexistent post → NOT_FOUND", async () => {
    const result = await asAdmin()
      .admin.reviewPost({
        postId: "00000000-0000-0000-0000-000000000000",
        decision: "approved",
      })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "NOT_FOUND" });
  });

  it("a malformed postId → BAD_REQUEST (zod), never a DB hit", async () => {
    const result = await asAdmin()
      .admin.reviewPost({ postId: "not-a-uuid", decision: "approved" })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("approved post appears on the public board; rejected never does (real query layer)", async () => {
    const approvedCreator = await seedCreator();
    const rejectedCreator = await seedCreator();
    const approvedPost = await seedPost(approvedCreator.id, {
      status: "pending",
      ...OBSERVED,
    });
    const rejectedPost = await seedPost(rejectedCreator.id, {
      status: "pending",
      ...OBSERVED,
    });

    await asAdmin().admin.reviewPost({
      postId: approvedPost.id,
      decision: "approved",
    });
    await asAdmin().admin.reviewPost({
      postId: rejectedPost.id,
      decision: "rejected",
    });

    const ids = (await alltimeBoard(db)).entries.map((e) => e.creator.id);
    expect(ids).toContain(approvedCreator.id);
    expect(ids).not.toContain(rejectedCreator.id);
  });
});

describe("banCreator", () => {
  it("sets is_banned and bulk-rejects pending posts in the same transaction; approved posts untouched", async () => {
    const creator = await seedCreator();
    const pending1 = await seedPost(creator.id, { status: "pending" });
    const pending2 = await seedPost(creator.id, { status: "pending" });
    const alreadyApproved = await seedPost(creator.id, {
      status: "approved",
      ...OBSERVED,
    });

    const updated = await asAdmin().admin.banCreator({
      creatorId: creator.id,
      banned: true,
    });

    expect(updated).toMatchObject({ id: creator.id, isBanned: true });
    expect(await statusOf(pending1.id)).toBe("rejected");
    expect(await statusOf(pending2.id)).toBe("rejected");
    // ban rejects only PENDING posts — an already-approved post keeps its status
    // (the creator ban is what hides it from the board, not a status change)
    expect(await statusOf(alreadyApproved.id)).toBe("approved");
    expect(auditLines(infoSpy)).toContainEqual({
      event: "admin.audit",
      actor: "user_admin",
      action: "creator.ban",
      target: creator.id,
    });
  });

  it("hides the creator from the public board on the next read", async () => {
    const creator = await seedCreator();
    await seedPost(creator.id, { status: "approved", ...OBSERVED });

    const before = (await alltimeBoard(db)).entries.map((e) => e.creator.id);
    expect(before).toContain(creator.id);

    await asAdmin().admin.banCreator({ creatorId: creator.id, banned: true });

    const after = (await alltimeBoard(db)).entries.map((e) => e.creator.id);
    expect(after).not.toContain(creator.id);
  });

  it("banning a nonexistent creator → NOT_FOUND", async () => {
    const result = await asAdmin()
      .admin.banCreator({
        creatorId: "00000000-0000-0000-0000-000000000000",
        banned: true,
      })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "NOT_FOUND" });
  });

  it("unban flips is_banned back to false without resurrecting rejected posts", async () => {
    const creator = await seedCreator({ isBanned: true });
    const rejected = await seedPost(creator.id, { status: "rejected" });

    const updated = await asAdmin().admin.banCreator({
      creatorId: creator.id,
      banned: false,
    });

    expect(updated.isBanned).toBe(false);
    expect(await isBanned(creator.id)).toBe(false);
    // rejections are independent moderation decisions — unban never re-approves
    expect(await statusOf(rejected.id)).toBe("rejected");
    expect(auditLines(infoSpy)).toContainEqual({
      event: "admin.audit",
      actor: "user_admin",
      action: "creator.unban",
      target: creator.id,
    });
  });

  it("distinct-transaction race: a concurrent approve cannot survive the ban (one must lose)", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "pending", ...OBSERVED });

    // Two writers contending on the SAME post row across distinct pool
    // connections. Under READ COMMITTED, whichever grabs the row lock first
    // wins its terminal status; the loser re-evaluates its `status = 'pending'`
    // guard against the committed row and no-ops.
    await Promise.all([
      asAdmin()
        .admin.banCreator({ creatorId: creator.id, banned: true })
        .catch((e: unknown) => e),
      asAdmin()
        .admin.reviewPost({ postId: post.id, decision: "approved" })
        .catch((e: unknown) => e),
    ]);

    // ban is the authoritative moderation action: the creator is always banned
    expect(await isBanned(creator.id)).toBe(true);
    // exactly one writer set the terminal status — the post is never left pending
    expect(["approved", "rejected"]).toContain(await statusOf(post.id));
    // regardless of who won the row, a banned creator is hidden from the board
    const ids = (await alltimeBoard(db)).entries.map((e) => e.creator.id);
    expect(ids).not.toContain(creator.id);
  });
});
