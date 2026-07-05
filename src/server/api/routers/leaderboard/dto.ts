// Task 18 (spec 007): public wire DTOs for the leaderboard router. Every
// shape is allow-list constructed — copy exactly the permitted keys, never
// spread-and-delete a denylist — so a new or sensitive column is excluded by
// default. Counts cross the boundary as strings: bigint does not survive
// plain JSON, and real X view counts overflow 2^53.
import { computeScore, type ScoreWindow } from "@/lib/scoring";
import type {
  BoardCreator,
  CreatorBoardEntry,
} from "@/server/db/queries/leaderboard";
import type { posts } from "@/server/db/schema";

type PostRow = typeof posts.$inferSelect;

export type PublicCreator = {
  id: string;
  platform: BoardCreator["platform"];
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string;
};

// Placeholder creators keep their raw `placeholder:<id>` handle here — the
// UI renders "Unclaimed creator" (spec 008); the API stays truthful.
export function toPublicCreator(creator: BoardCreator): PublicCreator {
  return {
    id: creator.id,
    platform: creator.platform,
    handle: creator.handle,
    displayName: creator.displayName,
    avatarUrl: creator.avatarUrl,
    profileUrl: creator.profileUrl,
  };
}

export type ScoreSummary = {
  score: string;
  views: string;
  likes: string;
  comments: string;
  shares: string;
  postCount: number;
};

const ZERO_SUMMARY: ScoreSummary = Object.freeze({
  score: "0",
  views: "0",
  likes: "0",
  comments: "0",
  shares: "0",
  postCount: 0,
});

// A creator absent from a board (nothing scanned, nothing observed) has a
// TRUE zero summary — the null-not-{} rule is for missing entities, and the
// creator exists.
export function toScoreSummary(
  entry: CreatorBoardEntry | undefined,
): ScoreSummary {
  if (entry === undefined) return ZERO_SUMMARY;
  return {
    score: entry.score.toString(),
    views: entry.views.toString(),
    likes: entry.likes.toString(),
    comments: entry.comments.toString(),
    shares: entry.shares.toString(),
    postCount: entry.postCount,
  };
}

// Spec 007 names this wire shape RankedEntry; named Public* here so it can't
// shadow the ranking engine's RankedEntry type in @/lib/scoring.
export type PublicBoardEntry = {
  rank: number;
  creator: PublicCreator;
} & ScoreSummary;

export function toBoardEntry(entry: CreatorBoardEntry): PublicBoardEntry {
  return {
    rank: entry.rank,
    creator: toPublicCreator(entry.creator),
    ...toScoreSummary(entry),
  };
}

export type PublicPost = {
  id: string;
  url: string;
  caption: string | null;
  postedAt: string | null;
  views: string;
  likes: string;
  comments: string;
  shares: string;
  score: string;
  // null = never polled — drives spec 008's "pending" em-dash, never a fake 0.
  latestSnapshotAt: string | null;
};

export function toPublicPost(post: PostRow): PublicPost {
  const totals = {
    views: post.latestViews,
    likes: post.latestLikes,
    comments: post.latestComments,
    shares: post.latestShares,
  };
  return {
    id: post.id,
    url: post.url,
    caption: post.caption,
    postedAt: post.postedAt === null ? null : post.postedAt.toISOString(),
    views: totals.views.toString(),
    likes: totals.likes.toString(),
    comments: totals.comments.toString(),
    shares: totals.shares.toString(),
    score: computeScore(totals).toString(),
    latestSnapshotAt:
      post.latestSnapshotAt === null
        ? null
        : post.latestSnapshotAt.toISOString(),
  };
}

export type PublicWindow = { start: string; end: string };

export function toPublicWindow(
  window: ScoreWindow | null,
): PublicWindow | null {
  if (window === null) return null;
  return { start: window.start.toISOString(), end: window.end.toISOString() };
}
