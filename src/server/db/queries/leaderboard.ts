// Task 17 (spec 007): the leaderboard read path. Snapshots are the source of
// truth for the daily board — one lateral-join query picks each post's
// baseline (newest snapshot strictly before the window) and latest (newest
// within it); the all-time board is the reader that justifies the latest_*
// denormalized columns. Scoring semantics (weights, clamping, ranking, the
// UTC day window) live exclusively in @/lib/scoring — this file fetches rows
// and feeds the engine. No ambient clock: callers pass `now`.
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  computeScore,
  dayWindow,
  type MetricTotals,
  rankEntries,
  type ScoreWindow,
  windowDelta,
  ZERO_TOTALS,
} from "@/lib/scoring";
import {
  creators,
  metricSnapshots,
  type platformEnum,
  posts,
} from "@/server/db/schema";

export type BoardPlatform = (typeof platformEnum.enumValues)[number];
export type BoardCreator = typeof creators.$inferSelect;

export type CreatorBoardEntry = {
  creator: BoardCreator;
  rank: number;
  score: bigint;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  postCount: number;
  // Tie-break instant (spec 007): earliest contributing posted_at, falling
  // back to the creator's created_at when no contributing post carries one.
  postedAt: Date;
};

export type Board = {
  window: ScoreWindow | null;
  entries: CreatorBoardEntry[];
};

// Spec 007 scan bound: the daily board only considers posts refreshed since
// window.start − 2d — anything staler cannot have in-window snapshots.
export const DAILY_SCAN_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

// One row per post the board considers. A contributing post always counts
// toward postCount and the postedAt tie-break, even when its totals are zero
// (scanned-but-idle posts stay on the daily board at 0).
export type PostContribution = {
  creator: BoardCreator;
  postedAt: Date | null;
  totals: MetricTotals;
};

// Visibility rule shared by every board: approved posts, non-banned creators,
// optionally narrowed to one platform. Enforced here, server-side — never in
// the UI.
function visibleFilter(platform?: BoardPlatform) {
  return and(
    eq(posts.status, "approved"),
    eq(creators.isBanned, false),
    ...(platform === undefined ? [] : [eq(posts.platform, platform)]),
  );
}

// Pure fold: per-post contributions → ranked per-creator entries. Exported so
// it is unit-testable without a database and reusable for score summaries.
export function aggregateBoard(
  rows: readonly PostContribution[],
): CreatorBoardEntry[] {
  const byCreator = new Map<
    string,
    {
      creator: BoardCreator;
      totals: MetricTotals;
      postCount: number;
      earliestPostedAt: Date | null;
    }
  >();

  for (const row of rows) {
    const bucket = byCreator.get(row.creator.id) ?? {
      creator: row.creator,
      totals: ZERO_TOTALS,
      postCount: 0,
      earliestPostedAt: null,
    };
    bucket.totals = {
      views: bucket.totals.views + row.totals.views,
      likes: bucket.totals.likes + row.totals.likes,
      comments: bucket.totals.comments + row.totals.comments,
      shares: bucket.totals.shares + row.totals.shares,
    };
    bucket.postCount += 1;
    if (
      row.postedAt !== null &&
      (bucket.earliestPostedAt === null ||
        row.postedAt.getTime() < bucket.earliestPostedAt.getTime())
    ) {
      bucket.earliestPostedAt = row.postedAt;
    }
    byCreator.set(row.creator.id, bucket);
  }

  const scored = [...byCreator.values()].map((bucket) => ({
    id: bucket.creator.id,
    creator: bucket.creator,
    score: computeScore(bucket.totals),
    views: bucket.totals.views,
    likes: bucket.totals.likes,
    comments: bucket.totals.comments,
    shares: bucket.totals.shares,
    postCount: bucket.postCount,
    postedAt: bucket.earliestPostedAt ?? bucket.creator.createdAt,
  }));

  return rankEntries(scored).map((entry) => ({
    creator: entry.creator,
    rank: entry.rank,
    score: entry.score,
    views: entry.views,
    likes: entry.likes,
    comments: entry.comments,
    shares: entry.shares,
    postCount: entry.postCount,
    postedAt: entry.postedAt,
  }));
}

// Daily board: per-post window delta (spec 006 semantics), summed per creator.
// ONE query — the lateral joins ride the (post_id, captured_at desc) index;
// no per-creator N+1. computeScore is linear, so scoring the per-creator sum
// of clamped per-post deltas equals summing per-post delta scores.
export async function dailyBoard(
  db: NodePgDatabase,
  opts: { now: Date; platform?: BoardPlatform },
): Promise<Board> {
  const window = dayWindow(opts.now);
  const scanStart = new Date(window.start.getTime() - DAILY_SCAN_LOOKBACK_MS);

  const baseline = db
    .select({
      views: metricSnapshots.views,
      likes: metricSnapshots.likes,
      comments: metricSnapshots.comments,
      shares: metricSnapshots.shares,
    })
    .from(metricSnapshots)
    .where(
      and(
        eq(metricSnapshots.postId, posts.id),
        lt(metricSnapshots.capturedAt, window.start),
      ),
    )
    .orderBy(desc(metricSnapshots.capturedAt))
    .limit(1)
    .as("baseline");

  const latest = db
    .select({
      views: metricSnapshots.views,
      likes: metricSnapshots.likes,
      comments: metricSnapshots.comments,
      shares: metricSnapshots.shares,
    })
    .from(metricSnapshots)
    .where(
      and(
        eq(metricSnapshots.postId, posts.id),
        gte(metricSnapshots.capturedAt, window.start),
        lt(metricSnapshots.capturedAt, window.end),
      ),
    )
    .orderBy(desc(metricSnapshots.capturedAt))
    .limit(1)
    .as("latest");

  const rows = await db
    .select({
      creator: creators,
      postedAt: posts.postedAt,
      baselineViews: baseline.views,
      baselineLikes: baseline.likes,
      baselineComments: baseline.comments,
      baselineShares: baseline.shares,
      latestViews: latest.views,
      latestLikes: latest.likes,
      latestComments: latest.comments,
      latestShares: latest.shares,
    })
    .from(posts)
    .innerJoin(creators, eq(posts.creatorId, creators.id))
    .leftJoinLateral(baseline, sql`true`)
    .leftJoinLateral(latest, sql`true`)
    .where(
      and(visibleFilter(opts.platform), gte(posts.latestSnapshotAt, scanStart)),
    );

  const contributions = rows.map((row): PostContribution => ({
    creator: row.creator,
    postedAt: row.postedAt,
    totals:
      // No in-window snapshot ⇒ the post contributes exactly 0 today — never
      // a cross-window fallback to the baseline row or the latest_* denorm.
      row.latestViews === null
        ? ZERO_TOTALS
        : windowDelta(
            row.baselineViews === null
              ? null
              : {
                  views: row.baselineViews,
                  likes: row.baselineLikes ?? 0n,
                  comments: row.baselineComments ?? 0n,
                  shares: row.baselineShares ?? 0n,
                },
            {
              views: row.latestViews,
              likes: row.latestLikes ?? 0n,
              comments: row.latestComments ?? 0n,
              shares: row.latestShares ?? 0n,
            },
          ),
  }));

  return { window, entries: aggregateBoard(contributions) };
}

// All-time board: computeScore over the latest_* denormalized columns — no
// snapshot join at all. A creator must have at least one OBSERVED approved
// post (latest_snapshot_at set) to hold a rank; never-observed posts don't
// count toward postCount either.
export async function alltimeBoard(
  db: NodePgDatabase,
  opts: { platform?: BoardPlatform } = {},
): Promise<Board> {
  const rows = await db
    .select({
      creator: creators,
      postedAt: posts.postedAt,
      views: posts.latestViews,
      likes: posts.latestLikes,
      comments: posts.latestComments,
      shares: posts.latestShares,
    })
    .from(posts)
    .innerJoin(creators, eq(posts.creatorId, creators.id))
    .where(
      and(visibleFilter(opts.platform), isNotNull(posts.latestSnapshotAt)),
    );

  const contributions = rows.map((row): PostContribution => ({
    creator: row.creator,
    postedAt: row.postedAt,
    totals: {
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
    },
  }));

  return { window: null, entries: aggregateBoard(contributions) };
}
