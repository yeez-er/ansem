// @vitest-environment node
// Task 25 (spec 009B): admin moderation router against a REAL test database.
// Covers the adminProcedure boundary (FORBIDDEN for authed non-admins,
// UNAUTHORIZED for anonymous), reviewPost (pending → approved/rejected, the
// atomic status gate → PRECONDITION_FAILED on re-review, NOT_FOUND on a missing
// post, board visibility through the real query layer), banCreator (is_banned +
// same-transaction bulk-reject of pending posts, a distinct-transaction
// ban/approve race, board hiding, and unban), pendingPosts (FIFO moderation
// queue, oldest-first, non-pending excluded), and refreshPost (single-post
// refresh through the provider registry reusing Task 13's applyPostResult;
// success writes a snapshot + denorm, provider outcomes map to typed errors).
// Every mutation emits one structured audit line (no audit table in v1 —
// captured via a console.info spy).
import { count, eq } from "drizzle-orm";
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
import type { Platform } from "@/lib/post-url";
import { appRouter } from "@/server/api/root";
import { createCallerFactory, type TRPCContext } from "@/server/api/trpc";
import { alltimeBoard } from "@/server/db/queries/leaderboard";
import { creators, metricSnapshots, posts } from "@/server/db/schema";
import type {
  MetricsProvider,
  MetricsResult,
  PostMetrics,
} from "@/server/metrics/provider";
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";
import { refreshSinglePost } from "./refresh-post";

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

async function snapshotCount(postId: string) {
  const [row] = await db
    .select({ c: count() })
    .from(metricSnapshots)
    .where(eq(metricSnapshots.postId, postId));
  return Number(row?.c ?? 0);
}

// The deterministic mock provider never returns an error, so the RATE_LIMITED /
// NOT_FOUND / PROVIDER_ERROR branches are driven by injecting a provider into
// refreshSinglePost directly.
function fakeProvider(
  platform: Platform,
  perId: MetricsResult,
): MetricsProvider {
  return {
    platform,
    async fetchMetrics(refs) {
      const map = new Map<string, MetricsResult>();
      for (const ref of refs) map.set(ref.platformPostId, perId);
      return map;
    },
  };
}

const emptyProvider = (platform: Platform): MetricsProvider => ({
  platform,
  async fetchMetrics() {
    return new Map<string, MetricsResult>();
  },
});

function okMetrics(overrides: Partial<PostMetrics> = {}): PostMetrics {
  return {
    views: 12_000n,
    likes: 300n,
    comments: 40n,
    shares: 12n,
    capturedAt: new Date("2026-07-05T00:00:00Z"),
    postedAt: new Date("2026-06-01T00:00:00Z"),
    // null author never triggers the placeholder merge (creator handles seeded
    // here are non-placeholder anyway) — keeps the refresh assertions isolated.
    authorHandle: null,
    authorDisplayName: null,
    authorAvatarUrl: null,
    ...overrides,
  };
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
    const pending = await asAnon()
      .admin.pendingPosts()
      .catch((e: unknown) => e);
    const refresh = await asAnon()
      .admin.refreshPost({ postId: post.id })
      .catch((e: unknown) => e);

    expect(review).toMatchObject({ code: "UNAUTHORIZED" });
    expect(ban).toMatchObject({ code: "UNAUTHORIZED" });
    expect(pending).toMatchObject({ code: "UNAUTHORIZED" });
    expect(refresh).toMatchObject({ code: "UNAUTHORIZED" });
    // fails closed: nothing mutated
    expect(await statusOf(post.id)).toBe("pending");
    expect(await isBanned(creator.id)).toBe(false);
    expect(await snapshotCount(post.id)).toBe(0);
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
    const pending = await asUser()
      .admin.pendingPosts()
      .catch((e: unknown) => e);
    const refresh = await asUser()
      .admin.refreshPost({ postId: post.id })
      .catch((e: unknown) => e);

    expect(review).toMatchObject({ code: "FORBIDDEN" });
    expect(ban).toMatchObject({ code: "FORBIDDEN" });
    expect(pending).toMatchObject({ code: "FORBIDDEN" });
    expect(refresh).toMatchObject({ code: "FORBIDDEN" });
    expect(await statusOf(post.id)).toBe("pending");
    expect(await isBanned(creator.id)).toBe(false);
    expect(await snapshotCount(post.id)).toBe(0);
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

describe("pendingPosts", () => {
  it("returns pending posts oldest-first with submitter + creator, excluding every non-pending status", async () => {
    const alpha = await seedCreator({ handle: "alpha", displayName: "Alpha" });
    const beta = await seedCreator({ handle: "beta" });
    // Insert newer BEFORE older so the ordering can't pass by insertion order.
    const newer = await seedPost(beta.id, {
      status: "pending",
      submittedByUserId: "user_2",
      createdAt: new Date("2026-07-03T00:00:00Z"),
    });
    const older = await seedPost(alpha.id, {
      status: "pending",
      submittedByUserId: "user_1",
      createdAt: new Date("2026-07-01T00:00:00Z"),
    });
    // None of these may appear.
    await seedPost(alpha.id, { status: "approved", ...OBSERVED });
    await seedPost(alpha.id, { status: "rejected" });
    await seedPost(alpha.id, { status: "removed" });

    const queue = await asAdmin().admin.pendingPosts();

    expect(queue.map((p) => p.id)).toEqual([older.id, newer.id]);
    expect(queue[0]).toMatchObject({
      id: older.id,
      platform: "x",
      url: older.url,
      submittedByUserId: "user_1",
      creator: { id: alpha.id, handle: "alpha", displayName: "Alpha" },
    });
    expect(queue[0]?.submittedAt).toBeInstanceOf(Date);
  });

  it("empty queue → [] (a list is a list)", async () => {
    expect(await asAdmin().admin.pendingPosts()).toEqual([]);
  });
});

describe("refreshPost", () => {
  it("writes a snapshot via the provider registry, updates the denorm, returns it, and audits (real mock provider)", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "approved" });

    const result = await asAdmin().admin.refreshPost({ postId: post.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a successful refresh");
    expect(typeof result.snapshot.views).toBe("bigint");
    expect(result.snapshot.views).toBeGreaterThan(0n);
    // A real snapshot row was written and the post's denorm reflects it.
    expect(await snapshotCount(post.id)).toBe(1);
    const [row] = await db
      .select({
        latestViews: posts.latestViews,
        latestSnapshotAt: posts.latestSnapshotAt,
      })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row?.latestViews).toBe(result.snapshot.views);
    expect(row?.latestSnapshotAt).toBeInstanceOf(Date);
    expect(auditLines(infoSpy)).toContainEqual({
      event: "admin.audit",
      actor: "user_admin",
      action: "post.refreshed",
      target: post.id,
    });
  });

  it("refreshing a nonexistent post → NOT_FOUND", async () => {
    const result = await asAdmin()
      .admin.refreshPost({ postId: "00000000-0000-0000-0000-000000000000" })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "NOT_FOUND" });
  });

  it("a malformed postId → BAD_REQUEST (zod), never a DB hit", async () => {
    const result = await asAdmin()
      .admin.refreshPost({ postId: "not-a-uuid" })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("provider ok result → returns exactly those metrics and writes them (injected, bigint-exact)", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "approved" });
    // > 2^53 proves the count survives the write path without Number collapse.
    const metrics = okMetrics({ views: 9_007_199_254_740_993n });

    const result = await refreshSinglePost(db, post.id, () =>
      fakeProvider("x", { ok: true, metrics }),
    );

    expect(result).toEqual({
      ok: true,
      snapshot: {
        postId: post.id,
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        capturedAt: metrics.capturedAt,
      },
    });
    expect(await snapshotCount(post.id)).toBe(1);
  });

  it("provider RATE_LIMITED → { ok:false, error:'RATE_LIMITED' }, no snapshot, status unchanged", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "approved" });

    const result = await refreshSinglePost(db, post.id, () =>
      fakeProvider("x", { ok: false, error: "RATE_LIMITED", retryable: true }),
    );

    expect(result).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(await snapshotCount(post.id)).toBe(0);
    expect(await statusOf(post.id)).toBe("approved");
  });

  it("provider NOT_FOUND → { ok:false, error:'NOT_FOUND' }, post marked removed, no snapshot", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "approved" });

    const result = await refreshSinglePost(db, post.id, () =>
      fakeProvider("x", { ok: false, error: "NOT_FOUND", retryable: false }),
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await statusOf(post.id)).toBe("removed");
    expect(await snapshotCount(post.id)).toBe(0);
  });

  it("provider PROVIDER_ERROR → { ok:false, error:'PROVIDER_ERROR' }, no snapshot", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "approved" });

    const result = await refreshSinglePost(db, post.id, () =>
      fakeProvider("x", {
        ok: false,
        error: "PROVIDER_ERROR",
        retryable: true,
      }),
    );

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(await snapshotCount(post.id)).toBe(0);
  });

  it("post absent from the provider map → PROVIDER_ERROR (contract violation, never guessed)", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "approved" });

    const result = await refreshSinglePost(db, post.id, () =>
      emptyProvider("x"),
    );

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(await snapshotCount(post.id)).toBe(0);
  });

  it("unconfigured platform (null provider) → PROVIDER_ERROR, never a silent success", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { status: "approved" });

    const result = await refreshSinglePost(db, post.id, () => null);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(await snapshotCount(post.id)).toBe(0);
  });
});
