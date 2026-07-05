// @vitest-environment node
// Task 13 (spec 004): refreshMetrics orchestration — snapshot appends,
// denormalized latest_* writes, vanished-post removal, and placeholder-creator
// merges, against a REAL test database with a scripted provider. The
// orchestration reads the clock only for durationMs; every capturedAt comes
// from the provider result, so runs are pinned with absolute timestamps and
// no fake timers are needed (Task 12 precedent).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, like } from "drizzle-orm";
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
import { type Platform, profileUrlFor } from "@/lib/post-url";
import { creators, metricSnapshots, posts } from "@/server/db/schema";
import type {
  MetricsProvider,
  MetricsResult,
  PostMetrics,
  PostRef,
} from "@/server/metrics/provider";
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";
import {
  applyPostResult,
  DEFAULT_MAX_PROVIDER_CALLS_PER_RUN,
  type RefreshMetricsOptions,
  refreshMetrics,
  resolveMaxProviderCalls,
  SUB_BATCH_SIZE,
} from "./refresh-metrics";

const testDb = connectTestDb();
const { db } = testDb;
const { seedCreator, seedPost } = makeSeeders(db);

// Absolute pinned instants — only their identity/order matters.
const T_BEFORE = new Date("2026-07-01T00:00:00Z");
const CAPTURED_AT = new Date("2026-07-04T12:00:00Z");

const providerError: MetricsResult = {
  ok: false,
  error: "PROVIDER_ERROR",
  retryable: true,
};
const notFound: MetricsResult = {
  ok: false,
  error: "NOT_FOUND",
  retryable: false,
};

function okResult(overrides: Partial<PostMetrics> = {}): MetricsResult {
  return {
    ok: true,
    metrics: {
      views: 1000n,
      likes: 10n,
      comments: 2n,
      shares: 1n,
      capturedAt: CAPTURED_AT,
      postedAt: null,
      authorHandle: null,
      authorDisplayName: null,
      authorAvatarUrl: null,
      ...overrides,
    },
  };
}

// Scripted provider: results keyed by platformPostId; ids missing from the
// script are omitted from the returned map (the contract-violation case).
function scriptedProvider(
  platform: Platform,
  script: Record<string, MetricsResult>,
) {
  const calls: PostRef[][] = [];
  const provider: MetricsProvider = {
    platform,
    fetchMetrics: async (refs) => {
      calls.push([...refs]);
      const out = new Map<string, MetricsResult>();
      for (const ref of refs) {
        const result = script[ref.platformPostId];
        if (result) out.set(ref.platformPostId, result);
      }
      return out;
    },
  };
  return { provider, calls };
}

function run(
  providers: Partial<Record<Platform, MetricsProvider>>,
  overrides: Partial<RefreshMetricsOptions> = {},
) {
  return refreshMetrics(db, {
    batchSize: 500,
    maxProviderCalls: 100,
    providerFor: (platform) => providers[platform] ?? null,
    ...overrides,
  });
}

async function getPost(id: string) {
  const [row] = await db.select().from(posts).where(eq(posts.id, id));
  if (!row) throw new Error("post not found");
  return row;
}

async function snapshotsFor(postId: string) {
  return db
    .select()
    .from(metricSnapshots)
    .where(eq(metricSnapshots.postId, postId));
}

async function placeholderCreators() {
  return db
    .select()
    .from(creators)
    .where(like(creators.handle, "placeholder:%"));
}

// selectDuePosts row shape, built from a seeded post row — lets applyPostResult
// be exercised directly (the distinct-transaction race test).
function asDue(post: typeof posts.$inferSelect) {
  return {
    id: post.id,
    creatorId: post.creatorId,
    platform: post.platform,
    platformPostId: post.platformPostId,
    url: post.url,
    latestSnapshotAt: post.latestSnapshotAt,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshMetrics — snapshot writes and denormalization", () => {
  it("ok result appends a snapshot and denormalizes latest_* + latest_snapshot_at (bigint-exact past 2^53)", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id);
    const { provider } = scriptedProvider("x", {
      [post.platformPostId]: okResult({
        views: 9007199254740993n, // 2^53 + 1 — must survive exactly
        likes: 3000000000n,
        comments: 7n,
        shares: 2n,
      }),
    });

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({
      selected: 1,
      refreshed: 1,
      removed: 0,
      skipped: 0,
      errors: 0,
      degraded: false,
    });

    const snapshots = await snapshotsFor(post.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      views: 9007199254740993n,
      likes: 3000000000n,
      comments: 7n,
      shares: 2n,
      capturedAt: CAPTURED_AT,
    });

    // latest_* equals the newest snapshot — the denormalization spec 007 reads.
    const updated = await getPost(post.id);
    expect(updated.latestViews).toBe(9007199254740993n);
    expect(updated.latestLikes).toBe(3000000000n);
    expect(updated.latestComments).toBe(7n);
    expect(updated.latestShares).toBe(2n);
    expect(updated.latestSnapshotAt).toEqual(CAPTURED_AT);
  });

  it("[ok, PROVIDER_ERROR, ok] batch → 2 snapshots, failed post untouched, errors: 1", async () => {
    const creator = await seedCreator();
    const okA = await seedPost(creator.id);
    const failing = await seedPost(creator.id, { latestSnapshotAt: T_BEFORE });
    const okB = await seedPost(creator.id);
    const { provider } = scriptedProvider("x", {
      [okA.platformPostId]: okResult(),
      [failing.platformPostId]: providerError,
      [okB.platformPostId]: okResult(),
    });

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({
      selected: 3,
      refreshed: 2,
      errors: 1,
      removed: 0,
      skipped: 0,
      degraded: false, // 1 error of 3 results is not > 50%
    });
    expect(await snapshotsFor(okA.id)).toHaveLength(1);
    expect(await snapshotsFor(okB.id)).toHaveLength(1);

    const untouched = await getPost(failing.id);
    expect(await snapshotsFor(failing.id)).toHaveLength(0);
    expect(untouched.latestSnapshotAt).toEqual(T_BEFORE);
    expect(untouched.latestViews).toBe(0n);
  });

  it("NOT_FOUND flips the post to removed and preserves its existing snapshots", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { latestSnapshotAt: T_BEFORE });
    await db.insert(metricSnapshots).values({
      postId: post.id,
      views: 5n,
      likes: 1n,
      comments: 0n,
      shares: 0n,
      capturedAt: T_BEFORE,
    });
    const { provider } = scriptedProvider("x", {
      [post.platformPostId]: notFound,
    });

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({ removed: 1, refreshed: 0, errors: 0 });
    const updated = await getPost(post.id);
    expect(updated.status).toBe("removed");
    // History stays on the board's past windows.
    expect(await snapshotsFor(post.id)).toHaveLength(1);
    expect(updated.latestSnapshotAt).toEqual(T_BEFORE);
  });

  it("a result missing from the provider map counts as an error and leaves the post untouched", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, { latestSnapshotAt: T_BEFORE });
    const { provider } = scriptedProvider("x", {}); // contract violation: no entry

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({ errors: 1, refreshed: 0, removed: 0 });
    expect(await snapshotsFor(post.id)).toHaveLength(0);
    expect((await getPost(post.id)).latestSnapshotAt).toEqual(T_BEFORE);
  });

  it("a provider that rejects degrades its whole batch to errors instead of failing the run", async () => {
    const creator = await seedCreator();
    const a = await seedPost(creator.id);
    const b = await seedPost(creator.id);
    const throwing: MetricsProvider = {
      platform: "x",
      fetchMetrics: async () => {
        throw new Error("adapter bug");
      },
    };

    const summary = await run({ x: throwing });

    expect(summary).toMatchObject({ errors: 2, refreshed: 0, degraded: true });
    expect(await snapshotsFor(a.id)).toHaveLength(0);
    expect(await snapshotsFor(b.id)).toHaveLength(0);
  });
});

describe("placeholder creator merge (same transaction as the snapshot)", () => {
  it("re-points the post at an existing (platform, handle) creator and deletes the orphaned placeholder", async () => {
    const real = await seedCreator({ handle: "realdeal" });
    const placeholder = await seedCreator({
      handle: "placeholder:1899000000000000001",
      profileUrl: "https://x.com/i/status/1899000000000000001",
    });
    const post = await seedPost(placeholder.id, {
      platformPostId: "1899000000000000001",
    });
    const { provider } = scriptedProvider("x", {
      // Mixed case pins normalization: providers return raw handles.
      [post.platformPostId]: okResult({ authorHandle: "RealDeal" }),
    });

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({ refreshed: 1, errors: 0 });
    expect((await getPost(post.id)).creatorId).toBe(real.id);
    const orphanRows = await db
      .select()
      .from(creators)
      .where(eq(creators.id, placeholder.id));
    expect(orphanRows).toHaveLength(0);
  });

  it("renames the placeholder when no creator owns the handle, filling identity and rebuilding profile_url", async () => {
    const standInProfileUrl = "https://www.tiktok.com/@x/video/730001";
    const placeholder = await seedCreator({
      platform: "tiktok",
      handle: "placeholder:730001",
      profileUrl: standInProfileUrl,
    });
    const post = await seedPost(placeholder.id, {
      platform: "tiktok",
      platformPostId: "730001",
      url: standInProfileUrl,
    });
    const { provider } = scriptedProvider("tiktok", {
      [post.platformPostId]: okResult({
        authorHandle: "@NewStar", // leading @ + case pin the normalization
        authorDisplayName: "New Star",
        authorAvatarUrl: "https://cdn.example.com/newstar.png",
      }),
    });

    await run({ tiktok: provider });

    const [renamed] = await db
      .select()
      .from(creators)
      .where(eq(creators.id, placeholder.id));
    expect(renamed).toMatchObject({
      handle: "newstar",
      displayName: "New Star",
      avatarUrl: "https://cdn.example.com/newstar.png",
      // Never keeps the stand-in post-URL profile (spec 004).
      profileUrl: profileUrlFor("tiktok", "newstar"),
    });
    expect(renamed?.profileUrl).not.toBe(standInProfileUrl);
    expect((await getPost(post.id)).creatorId).toBe(placeholder.id);
  });

  it("keeps a placeholder that still owns other posts after re-pointing the refreshed one", async () => {
    const real = await seedCreator({ handle: "keepme" });
    const placeholder = await seedCreator({
      handle: "placeholder:1899000000000000002",
      profileUrl: "https://x.com/i/status/1899000000000000002",
    });
    const refreshedPost = await seedPost(placeholder.id, {
      platformPostId: "1899000000000000002",
    });
    // Second post on the same placeholder, not selected (pending).
    const pendingPost = await seedPost(placeholder.id, { status: "pending" });
    const { provider } = scriptedProvider("x", {
      [refreshedPost.platformPostId]: okResult({ authorHandle: "keepme" }),
    });

    await run({ x: provider });

    expect((await getPost(refreshedPost.id)).creatorId).toBe(real.id);
    expect((await getPost(pendingPost.id)).creatorId).toBe(placeholder.id);
    const stillThere = await db
      .select()
      .from(creators)
      .where(eq(creators.id, placeholder.id));
    expect(stillThere).toHaveLength(1);
  });

  it("does not merge when authorHandle is null, and never renames a real creator", async () => {
    const placeholder = await seedCreator({
      handle: "placeholder:1899000000000000003",
      profileUrl: "https://x.com/i/status/1899000000000000003",
    });
    const placeholderPost = await seedPost(placeholder.id, {
      platformPostId: "1899000000000000003",
    });
    const real = await seedCreator({ handle: "genuine" });
    const realPost = await seedPost(real.id);
    const { provider } = scriptedProvider("x", {
      [placeholderPost.platformPostId]: okResult({ authorHandle: null }),
      // A resolved handle on a NON-placeholder creator must be a no-op.
      [realPost.platformPostId]: okResult({ authorHandle: "hijacker" }),
    });

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({ refreshed: 2, errors: 0 });
    const [stillPlaceholder] = await db
      .select()
      .from(creators)
      .where(eq(creators.id, placeholder.id));
    expect(stillPlaceholder?.handle).toBe("placeholder:1899000000000000003");
    const [stillGenuine] = await db
      .select()
      .from(creators)
      .where(eq(creators.id, real.id));
    expect(stillGenuine?.handle).toBe("genuine");
  });

  it("two placeholders resolving to the same author converge onto one creator (unique conflict falls to re-point)", async () => {
    const p1 = await seedCreator({
      handle: "placeholder:1899000000000000004",
      profileUrl: "https://x.com/i/status/1899000000000000004",
    });
    const p2 = await seedCreator({
      handle: "placeholder:1899000000000000005",
      profileUrl: "https://x.com/i/status/1899000000000000005",
    });
    const post1 = await seedPost(p1.id, {
      platformPostId: "1899000000000000004",
    });
    const post2 = await seedPost(p2.id, {
      platformPostId: "1899000000000000005",
    });
    const { provider } = scriptedProvider("x", {
      [post1.platformPostId]: okResult({ authorHandle: "SameStar" }),
      [post2.platformPostId]: okResult({ authorHandle: "SameStar" }),
    });

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({ refreshed: 2, errors: 0 });
    const winners = await db
      .select()
      .from(creators)
      .where(eq(creators.handle, "samestar"));
    expect(winners).toHaveLength(1);
    const winnerId = winners[0]?.id;
    expect((await getPost(post1.id)).creatorId).toBe(winnerId);
    expect((await getPost(post2.id)).creatorId).toBe(winnerId);
    expect(await placeholderCreators()).toHaveLength(0);
  });

  it("CONCURRENT merges to the same handle converge (distinct-transaction race, not mocked)", async () => {
    const p1 = await seedCreator({
      handle: "placeholder:1899000000000000006",
      profileUrl: "https://x.com/i/status/1899000000000000006",
    });
    const p2 = await seedCreator({
      handle: "placeholder:1899000000000000007",
      profileUrl: "https://x.com/i/status/1899000000000000007",
    });
    const post1 = await seedPost(p1.id, {
      platformPostId: "1899000000000000006",
    });
    const post2 = await seedPost(p2.id, {
      platformPostId: "1899000000000000007",
    });

    // Two per-post transactions racing on distinct pool connections: one wins
    // the rename; the other must hit the UNIQUE violation and re-point.
    const outcomes = await Promise.all([
      applyPostResult(db, asDue(post1), okResult({ authorHandle: "RaceStar" })),
      applyPostResult(db, asDue(post2), okResult({ authorHandle: "RaceStar" })),
    ]);

    expect(outcomes).toEqual(["refreshed", "refreshed"]);
    const winners = await db
      .select()
      .from(creators)
      .where(eq(creators.handle, "racestar"));
    expect(winners).toHaveLength(1);
    const winnerId = winners[0]?.id;
    expect((await getPost(post1.id)).creatorId).toBe(winnerId);
    expect((await getPost(post2.id)).creatorId).toBe(winnerId);
    expect(await placeholderCreators()).toHaveLength(0);
  });
});

describe("batching, call budget, and skip accounting", () => {
  async function seedBulkPosts(creatorId: string, n: number) {
    const rows = await db
      .insert(posts)
      .values(
        Array.from({ length: n }, (_, i) => ({
          creatorId,
          platform: "x" as const,
          platformPostId: `17770${String(i).padStart(14, "0")}`,
          url: `https://x.com/bulk/status/${i}`,
          status: "approved" as const,
          source: "submission" as const,
        })),
      )
      .returning({ platformPostId: posts.platformPostId });
    return rows.map((r) => r.platformPostId);
  }

  it("fans out in sub-batches of ≤ 100 covering every selected post", async () => {
    const creator = await seedCreator();
    const ids = await seedBulkPosts(creator.id, 150);
    const script = Object.fromEntries(ids.map((id) => [id, okResult()]));
    const { provider, calls } = scriptedProvider("x", script);

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({ selected: 150, refreshed: 150 });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.length).sort((a, b) => a - b)).toEqual([50, 100]);
    const seen = new Set(calls.flat().map((ref) => ref.platformPostId));
    expect(seen.size).toBe(150);
  });

  it("MAX_PROVIDER_CALLS_PER_RUN caps fan-out; posts past the budget stay untouched for the next run", async () => {
    const creator = await seedCreator();
    const ids = await seedBulkPosts(creator.id, 150);
    const script = Object.fromEntries(ids.map((id) => [id, okResult()]));
    const { provider, calls } = scriptedProvider("x", script);

    const summary = await run({ x: provider }, { maxProviderCalls: 1 });

    expect(calls).toHaveLength(1);
    expect(summary).toMatchObject({
      selected: 150,
      refreshed: 100,
      // Budget truncation is not an error and not a skip — stalest-first
      // simply re-queues the remainder next run.
      errors: 0,
      skipped: 0,
    });
    const untouched = await db
      .select()
      .from(posts)
      .where(eq(posts.latestSnapshotAt, CAPTURED_AT));
    expect(untouched).toHaveLength(100);
  });

  it("unconfigured platforms are counted skipped with NO snapshot and exactly ONE structured warning per run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const xCreator = await seedCreator();
    const tiktokCreator = await seedCreator({
      platform: "tiktok",
      profileUrl: "https://www.tiktok.com/@c",
    });
    const igCreator = await seedCreator({
      platform: "instagram",
      profileUrl: "https://www.instagram.com/c/",
    });
    const xPost = await seedPost(xCreator.id);
    const tiktokPost = await seedPost(tiktokCreator.id, {
      platform: "tiktok",
      platformPostId: "730002",
      url: "https://www.tiktok.com/@c/video/730002",
    });
    const igPost = await seedPost(igCreator.id, {
      platform: "instagram",
      platformPostId: "DIg1234",
      url: "https://www.instagram.com/p/DIg1234/",
    });
    const { provider } = scriptedProvider("x", {
      [xPost.platformPostId]: okResult(),
    });

    const summary = await run({ x: provider });

    expect(summary).toMatchObject({
      selected: 3,
      refreshed: 1,
      skipped: 2,
      errors: 0,
      degraded: false, // skips are not errors
    });
    expect(await snapshotsFor(tiktokPost.id)).toHaveLength(0);
    expect(await snapshotsFor(igPost.id)).toHaveLength(0);
    expect((await getPost(tiktokPost.id)).latestSnapshotAt).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const payload: unknown = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({ skipped: 2 });
    const platforms = (payload as { platforms: string[] }).platforms;
    expect([...platforms].sort()).toEqual(["instagram", "tiktok"]);
  });

  it("degraded is true only past 50% errors — exactly half is not degraded, removed counts as a result", async () => {
    const creator = await seedCreator();
    const ok1 = await seedPost(creator.id);
    const err1 = await seedPost(creator.id);
    const { provider } = scriptedProvider("x", {
      [ok1.platformPostId]: okResult(),
      [err1.platformPostId]: providerError,
    });
    expect(await run({ x: provider })).toMatchObject({
      errors: 1,
      degraded: false, // 1 of 2 = exactly 50%
    });

    await truncateAll(db);
    const c2 = await seedCreator();
    const okA = await seedPost(c2.id);
    const errA = await seedPost(c2.id);
    const errB = await seedPost(c2.id);
    const { provider: p2 } = scriptedProvider("x", {
      [okA.platformPostId]: okResult(),
      [errA.platformPostId]: providerError,
      [errB.platformPostId]: providerError,
    });
    expect(await run({ x: p2 })).toMatchObject({
      errors: 2,
      degraded: true, // 2 of 3 > 50%
    });

    await truncateAll(db);
    const c3 = await seedCreator();
    const gone = await seedPost(c3.id);
    const errC = await seedPost(c3.id);
    const { provider: p3 } = scriptedProvider("x", {
      [gone.platformPostId]: notFound,
      [errC.platformPostId]: providerError,
    });
    expect(await run({ x: p3 })).toMatchObject({
      removed: 1,
      errors: 1,
      degraded: false, // removed is a successful result: 1 error of 2
    });
  });

  it("empty database → all-zero summary with the exact spec key set", async () => {
    const summary = await run({});

    expect(Object.keys(summary).sort()).toEqual([
      "degraded",
      "durationMs",
      "errors",
      "refreshed",
      "removed",
      "selected",
      "skipped",
    ]);
    expect(summary).toMatchObject({
      selected: 0,
      refreshed: 0,
      removed: 0,
      skipped: 0,
      errors: 0,
      degraded: false,
    });
    expect(typeof summary.durationMs).toBe("number");
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("resolveMaxProviderCalls", () => {
  it("defaults to the spec value 10 when MAX_PROVIDER_CALLS_PER_RUN is unset", () => {
    expect(resolveMaxProviderCalls({})).toBe(10);
    expect(DEFAULT_MAX_PROVIDER_CALLS_PER_RUN).toBe(10);
  });

  it("is env-tunable: a configured MAX_PROVIDER_CALLS_PER_RUN wins over the default", () => {
    expect(resolveMaxProviderCalls({ MAX_PROVIDER_CALLS_PER_RUN: 3 })).toBe(3);
  });
});

describe("source verification", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "server", "ingestion", "refresh-metrics.ts"),
    "utf8",
  );

  it("writes each post inside a transaction (one bad row cannot poison the batch)", () => {
    expect(source).toMatch(/\.transaction\(/);
  });

  it("resolves the call budget from MAX_PROVIDER_CALLS_PER_RUN", () => {
    expect(source).toMatch(/MAX_PROVIDER_CALLS_PER_RUN/);
  });

  it("pins the spec sub-batch bound at 100", () => {
    expect(SUB_BATCH_SIZE).toBe(100);
  });
});
