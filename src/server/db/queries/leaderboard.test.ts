// @vitest-environment node
// Task 17 (spec 007): the leaderboard query layer, against a REAL test
// database. Every expected score is HAND-DERIVED from spec 006's weights
// (views 1 / likes 30 / comments 60 / shares 90) — never copied from observed
// output. No fake timers: the queries take `now` as an explicit parameter
// (stronger than pinning an ambient clock — there is no ambient read to pin;
// the source-verification suite bans Date.now()/new Date() outright).
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import type { posts } from "@/server/db/schema";
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";
import {
  alltimeBoard,
  type Board,
  DAILY_SCAN_LOOKBACK_MS,
  dailyBoard,
} from "./leaderboard";

const testDb = connectTestDb();
const { db } = testDb;
const { seedCreator, seedPost, seedSnapshot } = makeSeeders(db);

// Pinned instants around the board day 2026-07-04 UTC.
const NOW = new Date("2026-07-04T12:00:00Z");
const WINDOW_START = new Date("2026-07-04T00:00:00Z");
const WINDOW_END = new Date("2026-07-05T00:00:00Z");
const SCAN_START = new Date("2026-07-02T00:00:00Z"); // window.start − 2d
const BEFORE_SCAN = new Date("2026-07-01T23:00:00Z");
const PRE_WINDOW_OLD = new Date("2026-07-03T12:00:00Z");
const PRE_WINDOW = new Date("2026-07-03T23:00:00Z");
const IN_WINDOW_EARLY = new Date("2026-07-04T01:00:00Z");
const IN_WINDOW_LATE = new Date("2026-07-04T06:00:00Z");

type SnapshotSpec = {
  capturedAt: Date;
  views?: bigint;
  likes?: bigint;
  comments?: bigint;
  shares?: bigint;
};

// Seeds a post plus its snapshot history, maintaining the latest_* denorm the
// way ingestion (Task 13) does: the denorm always mirrors the newest snapshot.
async function seedTrackedPost(
  creatorId: string,
  history: SnapshotSpec[],
  postOverrides: Partial<typeof posts.$inferInsert> = {},
) {
  const newest = history.reduce((a, b) =>
    a.capturedAt > b.capturedAt ? a : b,
  );
  const post = await seedPost(creatorId, {
    latestSnapshotAt: newest.capturedAt,
    latestViews: newest.views ?? 0n,
    latestLikes: newest.likes ?? 0n,
    latestComments: newest.comments ?? 0n,
    latestShares: newest.shares ?? 0n,
    ...postOverrides,
  });
  for (const snap of history) {
    await seedSnapshot(post.id, snap);
  }
  return post;
}

function entryOf(board: Board, handle: string) {
  return board.entries.find((e) => e.creator.handle === handle);
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

describe("dailyBoard", () => {
  it("sums hand-derived per-post window deltas per creator and ranks by score", async () => {
    const alice = await seedCreator();
    // Post 1: baseline {1000,10,2,1} → in-window latest {2510,20,4,2}.
    // Delta {1510,10,2,1} → 1510·1 + 10·30 + 2·60 + 1·90 = 2020.
    await seedTrackedPost(alice.id, [
      {
        capturedAt: PRE_WINDOW,
        views: 1000n,
        likes: 10n,
        comments: 2n,
        shares: 1n,
      },
      {
        capturedAt: IN_WINDOW_LATE,
        views: 2510n,
        likes: 20n,
        comments: 4n,
        shares: 2n,
      },
    ]);
    // Post 2: no baseline (first snapshot ever lands in-window) — the whole
    // observation counts as today's delta: 100·1 = 100.
    await seedTrackedPost(alice.id, [
      { capturedAt: IN_WINDOW_EARLY, views: 100n },
    ]);
    const bob = await seedCreator();
    await seedTrackedPost(bob.id, [
      { capturedAt: IN_WINDOW_EARLY, views: 400n },
    ]);

    const board = await dailyBoard(db, { now: NOW });

    expect(board.window).toEqual({ start: WINDOW_START, end: WINDOW_END });
    expect(board.entries.map((e) => e.creator.handle)).toEqual([
      alice.handle,
      bob.handle,
    ]);
    const first = entryOf(board, alice.handle);
    expect(first).toMatchObject({
      rank: 1,
      score: 2120n, // 2020 + 100, hand-derived
      views: 1610n, // 1510 + 100
      likes: 10n,
      comments: 2n,
      shares: 1n,
      postCount: 2,
    });
    expect(entryOf(board, bob.handle)).toMatchObject({
      rank: 2,
      score: 400n,
      views: 400n,
    });
  });

  it("a post with 1M views all captured before today contributes exactly 0 — and its denorm columns are never read", async () => {
    const historic = await seedCreator();
    await seedTrackedPost(
      historic.id,
      [{ capturedAt: PRE_WINDOW, views: 1_000_000n, likes: 500n }],
      // Poisoned denorm: if the daily path ever read latest_* instead of
      // in-window snapshots, this creator would outrank everyone.
      { latestViews: 999_999_999n, latestLikes: 999_999n },
    );
    const active = await seedCreator();
    await seedTrackedPost(active.id, [
      { capturedAt: IN_WINDOW_EARLY, views: 50n },
    ]);

    const board = await dailyBoard(db, { now: NOW });

    // Baseline-but-zero-in-window ⇒ exactly 0 (no cross-window fallback);
    // the creator is still on the board — scanned but idle today.
    expect(entryOf(board, historic.handle)).toMatchObject({
      rank: 2,
      score: 0n,
      views: 0n,
      postCount: 1,
    });
    expect(entryOf(board, active.handle)).toMatchObject({
      rank: 1,
      score: 50n,
    });
  });

  it("baseline = newest strictly before window.start; latest = newest in-window (a snapshot AT window.start is in-window, not baseline)", async () => {
    const creator = await seedCreator();
    // 60 (pre-window) → 100 (exactly at start, IN-window) → 130 (in-window).
    // Correct: baseline 60, latest 130 ⇒ delta 70.
    // Wrong `<= start` baseline ⇒ 30; first-in-window latest ⇒ 40; summing
    // in-window rows ⇒ 110 — every classic mistake yields a different score.
    await seedTrackedPost(creator.id, [
      { capturedAt: PRE_WINDOW_OLD, views: 60n },
      { capturedAt: WINDOW_START, views: 100n },
      { capturedAt: IN_WINDOW_LATE, views: 130n },
    ]);

    const board = await dailyBoard(db, { now: NOW });

    expect(entryOf(board, creator.handle)).toMatchObject({
      score: 70n,
      views: 70n,
    });
  });

  it("clamps per-metric decreases to zero independently (windowDelta wiring, never negative)", async () => {
    const creator = await seedCreator();
    // Views recounted DOWN (1000 → 900) while likes rose (10 → 15):
    // views clamp to 0, likes delta 5 ⇒ score 5·30 = 150.
    await seedTrackedPost(creator.id, [
      { capturedAt: PRE_WINDOW, views: 1000n, likes: 10n },
      { capturedAt: IN_WINDOW_EARLY, views: 900n, likes: 15n },
    ]);

    const board = await dailyBoard(db, { now: NOW });

    expect(entryOf(board, creator.handle)).toMatchObject({
      score: 150n,
      views: 0n,
      likes: 5n,
    });
  });

  it("bounds the scan to latest_snapshot_at >= window.start − 2d (staler posts never reach the board; exactly at the bound is included)", async () => {
    expect(DAILY_SCAN_LOOKBACK_MS).toBe(2 * 24 * 60 * 60 * 1000);

    const stale = await seedCreator();
    await seedTrackedPost(stale.id, [
      { capturedAt: BEFORE_SCAN, views: 1_000_000n },
    ]);
    const boundary = await seedCreator();
    await seedTrackedPost(boundary.id, [
      { capturedAt: SCAN_START, views: 10n },
    ]);

    const board = await dailyBoard(db, { now: NOW });

    expect(entryOf(board, stale.handle)).toBeUndefined();
    // In scan reach but pre-window ⇒ present with exactly 0.
    expect(entryOf(board, boundary.handle)).toMatchObject({ score: 0n });
  });

  it.each(["pending", "rejected", "removed"] as const)(
    "%s posts contribute to no daily board even with in-window activity",
    async (status) => {
      const excluded = await seedCreator();
      await seedTrackedPost(
        excluded.id,
        [
          { capturedAt: PRE_WINDOW, views: 0n },
          { capturedAt: IN_WINDOW_LATE, views: 1_000_000n },
        ],
        { status },
      );
      const control = await seedCreator();
      await seedTrackedPost(control.id, [
        { capturedAt: IN_WINDOW_EARLY, views: 5n },
      ]);

      const board = await dailyBoard(db, { now: NOW });

      expect(entryOf(board, excluded.handle)).toBeUndefined();
      expect(board.entries).toHaveLength(1);
    },
  );

  it("banned creators never appear, even with winning in-window deltas", async () => {
    const banned = await seedCreator({ isBanned: true });
    await seedTrackedPost(banned.id, [
      { capturedAt: IN_WINDOW_LATE, views: 1_000_000n },
    ]);
    const control = await seedCreator();
    await seedTrackedPost(control.id, [
      { capturedAt: IN_WINDOW_EARLY, views: 5n },
    ]);

    const board = await dailyBoard(db, { now: NOW });

    expect(entryOf(board, banned.handle)).toBeUndefined();
    expect(board.entries).toHaveLength(1);
  });

  it("entry postedAt = earliest contributing posted_at, falling back to creator created_at when no post carries one", async () => {
    const earliest = new Date("2026-06-28T09:00:00Z");
    const dated = await seedCreator();
    await seedTrackedPost(
      dated.id,
      [{ capturedAt: IN_WINDOW_EARLY, views: 10n }],
      { postedAt: new Date("2026-07-01T00:00:00Z") },
    );
    await seedTrackedPost(
      dated.id,
      [{ capturedAt: IN_WINDOW_LATE, views: 10n }],
      { postedAt: earliest },
    );

    const creatorCreatedAt = new Date("2026-06-20T00:00:00Z");
    const undated = await seedCreator({ createdAt: creatorCreatedAt });
    // posted_at stays NULL — ingestion never writes it for submissions.
    await seedTrackedPost(undated.id, [
      { capturedAt: IN_WINDOW_EARLY, views: 10n },
    ]);

    const board = await dailyBoard(db, { now: NOW });

    expect(entryOf(board, dated.handle)?.postedAt).toEqual(earliest);
    expect(entryOf(board, undated.handle)?.postedAt).toEqual(creatorCreatedAt);
  });

  it("filters by platform when asked, and mixes all platforms by default", async () => {
    const xCreator = await seedCreator();
    await seedTrackedPost(xCreator.id, [
      { capturedAt: IN_WINDOW_EARLY, views: 10n },
    ]);
    const tiktoker = await seedCreator({ platform: "tiktok" });
    await seedTrackedPost(
      tiktoker.id,
      [{ capturedAt: IN_WINDOW_EARLY, views: 20n }],
      { platform: "tiktok" },
    );

    const filtered = await dailyBoard(db, { now: NOW, platform: "tiktok" });
    expect(filtered.entries.map((e) => e.creator.handle)).toEqual([
      tiktoker.handle,
    ]);

    const combined = await dailyBoard(db, { now: NOW });
    expect(combined.entries).toHaveLength(2);
  });

  it("empty database → entries: [] with the window still reported (a list is a list)", async () => {
    const board = await dailyBoard(db, { now: NOW });

    expect(board.entries).toEqual([]);
    expect(board.window).toEqual({ start: WINDOW_START, end: WINDOW_END });
  });

  it("issues a constant number of queries regardless of board size (no per-creator N+1)", async () => {
    for (let i = 0; i < 12; i++) {
      const creator = await seedCreator();
      await seedTrackedPost(creator.id, [
        { capturedAt: IN_WINDOW_EARLY, views: BigInt(i + 1) },
      ]);
    }

    const querySpy = vi.spyOn(testDb.pool, "query");
    const board = await dailyBoard(db, { now: NOW });

    expect(board.entries).toHaveLength(12);
    expect(querySpy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("alltimeBoard", () => {
  it("scores hand-derived totals from the denormalized latest_* columns alone — zero snapshot rows exist", async () => {
    const alice = await seedCreator();
    // {1000,10,2,1} ⇒ 1000 + 300 + 120 + 90 = 1510; plus {100,0,0,0} ⇒ 100.
    await seedPost(alice.id, {
      latestViews: 1000n,
      latestLikes: 10n,
      latestComments: 2n,
      latestShares: 1n,
      latestSnapshotAt: PRE_WINDOW,
    });
    await seedPost(alice.id, {
      latestViews: 100n,
      latestSnapshotAt: IN_WINDOW_EARLY,
    });
    const bob = await seedCreator();
    await seedPost(bob.id, {
      latestViews: 200n,
      latestSnapshotAt: PRE_WINDOW,
    });

    const board = await alltimeBoard(db);

    expect(board.window).toBeNull();
    expect(board.entries.map((e) => e.creator.handle)).toEqual([
      alice.handle,
      bob.handle,
    ]);
    expect(entryOf(board, alice.handle)).toMatchObject({
      rank: 1,
      score: 1610n,
      views: 1100n,
      likes: 10n,
      comments: 2n,
      shares: 1n,
      postCount: 2,
    });
    expect(entryOf(board, bob.handle)).toMatchObject({
      rank: 2,
      score: 200n,
      postCount: 1,
    });
  });

  it("excludes creators whose approved posts were ALL never snapshotted; never-observed posts of visible creators don't count", async () => {
    const ghost = await seedCreator();
    await seedPost(ghost.id); // latest_snapshot_at NULL — never observed

    const mixed = await seedCreator();
    await seedPost(mixed.id, {
      latestViews: 200n,
      latestSnapshotAt: PRE_WINDOW,
    });
    await seedPost(mixed.id); // never observed — must not inflate postCount

    const board = await alltimeBoard(db);

    expect(entryOf(board, ghost.handle)).toBeUndefined();
    expect(entryOf(board, mixed.handle)).toMatchObject({
      score: 200n,
      postCount: 1,
    });
  });

  it("applies standard competition ranking (1,1,3) with views-desc display order inside a score tie", async () => {
    // Hand-derived equal scores by different routes:
    // fewerViews: 430 views + 1 like ⇒ 430 + 30 = 460
    // moreViews:  460 views          ⇒ 460
    const fewerViews = await seedCreator();
    await seedPost(fewerViews.id, {
      latestViews: 430n,
      latestLikes: 1n,
      latestSnapshotAt: PRE_WINDOW,
    });
    const moreViews = await seedCreator();
    await seedPost(moreViews.id, {
      latestViews: 460n,
      latestSnapshotAt: PRE_WINDOW,
    });
    const trailing = await seedCreator();
    await seedPost(trailing.id, {
      latestViews: 100n,
      latestSnapshotAt: PRE_WINDOW,
    });

    const board = await alltimeBoard(db);

    expect(board.entries.map((e) => e.creator.handle)).toEqual([
      moreViews.handle, // ties break on views desc for display order
      fewerViews.handle,
      trailing.handle,
    ]);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 1, 3]);
  });

  it.each(["pending", "rejected", "removed"] as const)(
    "%s posts contribute nothing all-time, even with poisoned denorm totals",
    async (status) => {
      const excluded = await seedCreator();
      await seedPost(excluded.id, {
        status,
        latestViews: 999_999_999n,
        latestSnapshotAt: PRE_WINDOW,
      });
      const control = await seedCreator();
      await seedPost(control.id, {
        latestViews: 5n,
        latestSnapshotAt: PRE_WINDOW,
      });

      const board = await alltimeBoard(db);

      expect(entryOf(board, excluded.handle)).toBeUndefined();
      expect(board.entries).toHaveLength(1);
    },
  );

  it("banned creators hold no all-time rank", async () => {
    const banned = await seedCreator({ isBanned: true });
    await seedPost(banned.id, {
      latestViews: 999_999_999n,
      latestSnapshotAt: PRE_WINDOW,
    });

    const board = await alltimeBoard(db);

    expect(board.entries).toEqual([]);
  });

  it("view counts beyond 2^53 survive exactly — no Number collapse anywhere in the pipeline", async () => {
    const overflow = 9_007_199_254_740_993n; // 2^53 + 1 — unrepresentable as a float
    const whale = await seedCreator();
    await seedPost(whale.id, {
      latestViews: overflow,
      latestSnapshotAt: PRE_WINDOW,
    });
    await seedPost(whale.id, {
      latestViews: overflow,
      latestSnapshotAt: PRE_WINDOW,
    });

    const board = await alltimeBoard(db);

    const entry = entryOf(board, whale.handle);
    expect(entry?.views).toBe(18_014_398_509_481_986n); // 2·(2^53 + 1), exact
    expect(entry?.score).toBe(18_014_398_509_481_986n);
  });

  it("filters by platform when asked", async () => {
    const xCreator = await seedCreator();
    await seedPost(xCreator.id, {
      latestViews: 10n,
      latestSnapshotAt: PRE_WINDOW,
    });
    const tiktoker = await seedCreator({ platform: "tiktok" });
    await seedPost(tiktoker.id, {
      platform: "tiktok",
      latestViews: 20n,
      latestSnapshotAt: PRE_WINDOW,
    });

    const filtered = await alltimeBoard(db, { platform: "x" });
    expect(filtered.entries.map((e) => e.creator.handle)).toEqual([
      xCreator.handle,
    ]);

    const combined = await alltimeBoard(db);
    expect(combined.entries).toHaveLength(2);
  });

  it("empty database → entries: [] (a list is a list)", async () => {
    const board = await alltimeBoard(db);

    expect(board.entries).toEqual([]);
    expect(board.window).toBeNull();
  });
});

describe("source verification", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "server", "db", "queries", "leaderboard.ts"),
    "utf8",
  );

  it("consumes the scoring engine instead of redefining semantics (weights/clamping/ranking single-sourced in @/lib/scoring)", () => {
    expect(source).toMatch(/from "@\/lib\/scoring"/);
    for (const helper of [
      "computeScore",
      "dayWindow",
      "windowDelta",
      "rankEntries",
    ]) {
      expect(source).toContain(helper);
    }
  });

  it("never reads the ambient clock — callers pass `now` (control-tested matchers)", () => {
    // Control: prove both matchers fire on deliberately-bad lines first.
    expect("const t = Date.now();").toMatch(/Date\.now\(/);
    expect("const d = new Date();").toMatch(/new Date\(\)/);

    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/new Date\(\)/);
  });

  it("bounds the daily scan by latestSnapshotAt with the 2-day lookback constant", () => {
    expect(source).toMatch(/latestSnapshotAt/);
    expect(source).toMatch(/DAILY_SCAN_LOOKBACK_MS/);
  });
});
