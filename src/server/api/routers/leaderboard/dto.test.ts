// Task 18 (spec 007): DTO allow-list construction. Public shapes are built by
// copying EXACTLY the permitted keys — never by deleting a denylist — so a
// future sensitive column is excluded by default. These tests assert exact
// key sets (allow-list), not the absence of today's known-bad keys.
import { describe, expect, it } from "vitest";
import type {
  BoardCreator,
  CreatorBoardEntry,
} from "@/server/db/queries/leaderboard";
import type { posts } from "@/server/db/schema";
import {
  toBoardEntry,
  toPublicCreator,
  toPublicPost,
  toPublicWindow,
  toScoreSummary,
} from "./dto";

// Full DB rows INCLUDING the sensitive fields (isBanned, submittedByUserId,
// timestamps) — the allow-list must drop everything not explicitly permitted.
const creatorRow: BoardCreator = {
  id: "5b1f72cd-2c14-4b39-9c1e-6d3a1c9a7f42",
  platform: "x",
  handle: "blackbull",
  displayName: "Black Bull",
  avatarUrl: "https://img.example/bull.png",
  profileUrl: "https://x.com/blackbull",
  isBanned: true,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-02T00:00:00.000Z"),
};

const postRow: typeof posts.$inferSelect = {
  id: "0f9310a4-6f2c-4b5e-8a41-1d2c3b4a5e6f",
  creatorId: creatorRow.id,
  platform: "x",
  platformPostId: "1801234567890123456",
  url: "https://x.com/blackbull/status/1801234567890123456",
  caption: "gm bulls",
  postedAt: new Date("2026-07-05T12:00:00.000Z"),
  status: "approved",
  source: "submission",
  submittedByUserId: "user_secret123",
  latestViews: 1000n,
  latestLikes: 10n,
  latestComments: 2n,
  latestShares: 1n,
  latestSnapshotAt: new Date("2026-07-06T08:00:00.000Z"),
  createdAt: new Date("2026-07-04T00:00:00.000Z"),
};

const boardEntry: CreatorBoardEntry = {
  creator: creatorRow,
  rank: 1,
  score: 2190n,
  views: 1500n,
  likes: 14n,
  comments: 3n,
  shares: 1n,
  postCount: 2,
  postedAt: new Date("2026-07-05T12:00:00.000Z"),
};

describe("toPublicCreator", () => {
  it("emits exactly the PublicCreator allow-list keys", () => {
    const dto = toPublicCreator(creatorRow);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "avatarUrl",
        "displayName",
        "handle",
        "id",
        "platform",
        "profileUrl",
      ].sort(),
    );
    expect(dto).toEqual({
      id: creatorRow.id,
      platform: "x",
      handle: "blackbull",
      displayName: "Black Bull",
      avatarUrl: "https://img.example/bull.png",
      profileUrl: "https://x.com/blackbull",
    });
  });
});

describe("toPublicPost", () => {
  it("emits exactly the PublicPost allow-list keys with spec-computed score", () => {
    const dto = toPublicPost(postRow);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "id",
        "url",
        "caption",
        "postedAt",
        "views",
        "likes",
        "comments",
        "shares",
        "score",
        "latestSnapshotAt",
      ].sort(),
    );
    // Hand-computed spec 006 value: 1000·1 + 10·30 + 2·60 + 1·90 = 1510.
    expect(dto).toEqual({
      id: postRow.id,
      url: postRow.url,
      caption: "gm bulls",
      postedAt: "2026-07-05T12:00:00.000Z",
      views: "1000",
      likes: "10",
      comments: "2",
      shares: "1",
      score: "1510",
      latestSnapshotAt: "2026-07-06T08:00:00.000Z",
    });
  });

  it("passes nulls through for caption, postedAt, and latestSnapshotAt", () => {
    const dto = toPublicPost({
      ...postRow,
      caption: null,
      postedAt: null,
      latestSnapshotAt: null,
      latestViews: 0n,
      latestLikes: 0n,
      latestComments: 0n,
      latestShares: 0n,
    });
    expect(dto.caption).toBeNull();
    expect(dto.postedAt).toBeNull();
    expect(dto.latestSnapshotAt).toBeNull();
    expect(dto.score).toBe("0");
    expect(dto.views).toBe("0");
  });

  it("serializes counts beyond 2^53 exactly", () => {
    const dto = toPublicPost({
      ...postRow,
      latestViews: 9007199254740993n, // 2^53 + 1 — Number would collapse it
      latestLikes: 0n,
      latestComments: 0n,
      latestShares: 0n,
    });
    expect(dto.views).toBe("9007199254740993");
    expect(dto.score).toBe("9007199254740993");
  });
});

describe("toScoreSummary", () => {
  it("maps a board entry to string counts", () => {
    const summary = toScoreSummary(boardEntry);
    expect(Object.keys(summary).sort()).toEqual(
      ["score", "views", "likes", "comments", "shares", "postCount"].sort(),
    );
    expect(summary).toEqual({
      score: "2190",
      views: "1500",
      likes: "14",
      comments: "3",
      shares: "1",
      postCount: 2,
    });
  });

  it("returns the zero summary for a creator absent from the board", () => {
    expect(toScoreSummary(undefined)).toEqual({
      score: "0",
      views: "0",
      likes: "0",
      comments: "0",
      shares: "0",
      postCount: 0,
    });
  });
});

describe("toBoardEntry", () => {
  it("emits exactly the ranked-entry keys with an allow-listed creator", () => {
    const dto = toBoardEntry(boardEntry);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "rank",
        "creator",
        "score",
        "views",
        "likes",
        "comments",
        "shares",
        "postCount",
      ].sort(),
    );
    expect(dto.rank).toBe(1);
    expect(dto.score).toBe("2190");
    expect(Object.keys(dto.creator).sort()).toEqual(
      [
        "avatarUrl",
        "displayName",
        "handle",
        "id",
        "platform",
        "profileUrl",
      ].sort(),
    );
  });
});

describe("toPublicWindow", () => {
  it("returns null for the all-time board (=== null, never {})", () => {
    expect(toPublicWindow(null)).toBeNull();
  });

  it("serializes window bounds as ISO strings", () => {
    expect(
      toPublicWindow({
        start: new Date("2026-07-06T00:00:00.000Z"),
        end: new Date("2026-07-07T00:00:00.000Z"),
      }),
    ).toEqual({
      start: "2026-07-06T00:00:00.000Z",
      end: "2026-07-07T00:00:00.000Z",
    });
  });
});
