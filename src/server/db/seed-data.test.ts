// Task 20 (spec 010): the seed fixture set + curve builder — pure, no DB.
// The board story is hand-derived here: bullpostoor's stale mega-posts own the
// all-time board while ansemtok's fresh spike owns the daily board at ANY run
// hour, and banned ruggedbull would rank #2 all-time if the ban filter leaked.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeScore, dayWindow, windowDelta } from "@/lib/scoring";
import {
  buildSnapshots,
  SEED_CREATORS,
  SEED_POSTS,
  type SeedPostFixture,
} from "./seed-data";

const NOW = new Date("2026-07-06T13:00:00Z");
const WINDOW = dayWindow(NOW);
const HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * HOUR_MS;

type CurvePost = SeedPostFixture & {
  curve: NonNullable<SeedPostFixture["curve"]>;
};
const CURVE_POSTS = SEED_POSTS.filter((p): p is CurvePost => p.curve !== null);

const postsOf = (handle: string) =>
  SEED_POSTS.filter((p) => p.creatorHandle === handle);
const alltimeScoreOf = (handle: string) =>
  CURVE_POSTS.filter(
    (p) => p.creatorHandle === handle && p.status === "approved",
  ).reduce((sum, p) => sum + computeScore(p.curve.final), 0n);

describe("seed fixtures — creators", () => {
  it("defines 18 creators (8 X / 6 TikTok / 4 Instagram) with unique natural keys", () => {
    expect(SEED_CREATORS).toHaveLength(18);
    const byPlatform = (platform: string) =>
      SEED_CREATORS.filter((c) => c.platform === platform).length;
    expect(byPlatform("x")).toBe(8);
    expect(byPlatform("tiktok")).toBe(6);
    expect(byPlatform("instagram")).toBe(4);
    const keys = new Set(SEED_CREATORS.map((c) => `${c.platform}:${c.handle}`));
    expect(keys.size).toBe(SEED_CREATORS.length);
  });

  it("seeds exactly one banned creator: ruggedbull", () => {
    const banned = SEED_CREATORS.filter((c) => c.isBanned);
    expect(banned).toHaveLength(1);
    expect(banned[0]?.handle).toBe("ruggedbull");
  });

  it("seeds exactly one placeholder creator: display_name null, handle = placeholder:<its post id>", () => {
    const placeholders = SEED_CREATORS.filter((c) =>
      c.handle.startsWith("placeholder:"),
    );
    expect(placeholders).toHaveLength(1);
    const placeholder = placeholders[0];
    expect(placeholder?.displayName).toBeNull();
    expect(placeholder?.avatarUrl).toBeNull();
    const ownPosts = postsOf(placeholder?.handle ?? "");
    expect(ownPosts).toHaveLength(1);
    expect(placeholder?.handle).toBe(
      `placeholder:${ownPosts[0]?.platformPostId}`,
    );
    // Its post is approved AND observed, so "Unclaimed creator" ranks on boards.
    expect(ownPosts[0]?.status).toBe("approved");
    expect(ownPosts[0]?.curve).not.toBeNull();
    // Every real creator carries a display name — only the placeholder is bare.
    for (const c of SEED_CREATORS) {
      if (c === placeholder) continue;
      expect(
        c.displayName,
        `displayName missing for ${c.handle}`,
      ).not.toBeNull();
    }
  });
});

describe("seed fixtures — posts", () => {
  it("defines 60 posts with the spec status mix: 47 approved / 6 pending / 4 rejected / 3 removed", () => {
    expect(SEED_POSTS).toHaveLength(60);
    const byStatus = (status: string) =>
      SEED_POSTS.filter((p) => p.status === status).length;
    expect(byStatus("approved")).toBe(47);
    expect(byStatus("pending")).toBe(6);
    expect(byStatus("rejected")).toBe(4);
    expect(byStatus("removed")).toBe(3);
  });

  it("every post references an existing creator on the SAME platform; (platform, platformPostId) unique", () => {
    const creatorsByHandle = new Map(SEED_CREATORS.map((c) => [c.handle, c]));
    for (const p of SEED_POSTS) {
      const creator = creatorsByHandle.get(p.creatorHandle);
      expect(creator, `unknown creator ${p.creatorHandle}`).toBeDefined();
      expect(
        creator?.platform,
        `platform mismatch on ${p.platformPostId}`,
      ).toBe(p.platform);
    }
    const keys = new Set(
      SEED_POSTS.map((p) => `${p.platform}:${p.platformPostId}`),
    );
    expect(keys.size).toBe(SEED_POSTS.length);
  });

  it("banned ruggedbull owns exactly 3 approved posts, all with high-scoring curves", () => {
    const bannedPosts = postsOf("ruggedbull");
    expect(bannedPosts).toHaveLength(3);
    for (const p of bannedPosts) {
      expect(p.status).toBe("approved");
      expect(p.curve).not.toBeNull();
    }
    // High-scoring enough that a ban-filter leak would visibly corrupt both boards.
    expect(alltimeScoreOf("ruggedbull")).toBe(5_213_900n);
  });

  it("each platform has ≥3 distinct visible creators with observed approved posts (filter top-3 never empty)", () => {
    const bannedHandles = new Set(
      SEED_CREATORS.filter((c) => c.isBanned).map((c) => c.handle),
    );
    for (const platform of ["x", "tiktok", "instagram"] as const) {
      const observedCreators = new Set(
        CURVE_POSTS.filter(
          (p) =>
            p.platform === platform &&
            p.status === "approved" &&
            !bannedHandles.has(p.creatorHandle),
        ).map((p) => p.creatorHandle),
      );
      expect(
        observedCreators.size,
        `platform ${platform} has too few observed creators`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("admin queue: exactly 6 pending submissions, never polled, spanning all three platforms", () => {
    const pending = SEED_POSTS.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(6);
    for (const p of pending) {
      expect(p.curve).toBeNull();
      expect(p.source).toBe("submission");
      expect(p.submittedByUserId).not.toBeNull();
    }
    expect(new Set(pending.map((p) => p.platform)).size).toBe(3);
  });

  it("rejected posts were never polled; removed posts KEEP their snapshot curves (spec 004 semantics)", () => {
    for (const p of SEED_POSTS.filter((x) => x.status === "rejected")) {
      expect(
        p.curve,
        `rejected ${p.platformPostId} must have no curve`,
      ).toBeNull();
    }
    for (const p of SEED_POSTS.filter((x) => x.status === "removed")) {
      expect(
        p.curve,
        `removed ${p.platformPostId} must keep a curve`,
      ).not.toBeNull();
    }
  });

  it("exactly one VISIBLE approved post is never-polled — the pending-metrics em-dash story", () => {
    const bannedHandles = new Set(
      SEED_CREATORS.filter((c) => c.isBanned).map((c) => c.handle),
    );
    const neverPolled = SEED_POSTS.filter(
      (p) =>
        p.status === "approved" &&
        p.curve === null &&
        !bannedHandles.has(p.creatorHandle),
    );
    expect(neverPolled).toHaveLength(1);
    // A just-submitted post: no posted_at either — it slots into the recent
    // rail by created_at and shows "pending" until the first refresh.
    expect(neverPolled[0]?.postedHoursAgo).toBeNull();
    expect(neverPolled[0]?.source).toBe("submission");
  });

  it("posted_at spreads across the last 21 days", () => {
    const hours = SEED_POSTS.map((p) => p.postedHoursAgo).filter(
      (h): h is number => h !== null,
    );
    expect(hours).toHaveLength(SEED_POSTS.length - 1); // only the never-polled post floats
    expect(Math.max(...hours)).toBeLessThanOrEqual(21 * 24);
    expect(Math.max(...hours)).toBeGreaterThanOrEqual(20 * 24);
    expect(Math.min(...hours)).toBeLessThanOrEqual(24);
  });

  it("engagement magnitudes: views ≫ likes > comments ≥ shares on every curve", () => {
    for (const p of CURVE_POSTS) {
      const { views, likes, comments, shares } = p.curve.final;
      const tag = `post ${p.platformPostId}`;
      expect(views, tag).toBeGreaterThanOrEqual(likes * 10n);
      expect(likes, tag).toBeGreaterThanOrEqual(comments * 5n);
      expect(comments, tag).toBeGreaterThanOrEqual(shares);
      expect(shares, tag).toBeGreaterThan(0n);
    }
  });

  it("every curve has 4–10 snapshots and a posted_at instant", () => {
    for (const p of CURVE_POSTS) {
      expect(p.curve.snapshots).toBeGreaterThanOrEqual(4);
      expect(p.curve.snapshots).toBeLessThanOrEqual(10);
      expect(p.postedHoursAgo).not.toBeNull();
    }
  });
});

describe("buildSnapshots", () => {
  it("every curve: exact row count, strictly increasing capturedAt, monotone metrics, last row = final totals", () => {
    for (const p of CURVE_POSTS) {
      const rows = buildSnapshots(p, NOW);
      const tag = `post ${p.platformPostId}`;
      expect(rows, tag).toHaveLength(p.curve.snapshots);
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        if (!prev || !cur) throw new Error("index out of range");
        expect(cur.capturedAt.getTime(), tag).toBeGreaterThan(
          prev.capturedAt.getTime(),
        );
        expect(cur.views >= prev.views, `${tag} views decreased`).toBe(true);
        expect(cur.likes >= prev.likes, `${tag} likes decreased`).toBe(true);
        expect(cur.comments >= prev.comments, `${tag} comments decreased`).toBe(
          true,
        );
        expect(cur.shares >= prev.shares, `${tag} shares decreased`).toBe(true);
      }
      expect(rows.at(-1), tag).toMatchObject(p.curve.final);
    }
  });

  it("posted_at precedes the first snapshot for every curve post", () => {
    for (const p of CURVE_POSTS) {
      if (p.postedHoursAgo === null) throw new Error("curve without posted_at");
      const postedAt = NOW.getTime() - p.postedHoursAgo * HOUR_MS;
      const first = buildSnapshots(p, NOW)[0];
      expect(
        first && postedAt <= first.capturedAt.getTime(),
        `post ${p.platformPostId} has metrics before it was posted`,
      ).toBe(true);
    }
  });

  it("stale curves sit entirely before today 00:00 UTC; steady curves end 30min before now; both pace ~6h", () => {
    const stale = CURVE_POSTS.filter((p) => p.curve.shape === "stale");
    const steady = CURVE_POSTS.filter((p) => p.curve.shape === "steady");
    expect(stale.length).toBeGreaterThan(0);
    expect(steady.length).toBeGreaterThan(0);
    for (const p of [...stale, ...steady]) {
      const times = buildSnapshots(p, NOW).map((r) => r.capturedAt.getTime());
      const expectedEnd =
        p.curve.shape === "stale"
          ? WINDOW.start.getTime() - HOUR_MS
          : NOW.getTime() - 30 * 60 * 1000;
      expect(times.at(-1), `post ${p.platformPostId}`).toBe(expectedEnd);
      for (let i = 1; i < times.length; i++) {
        expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBe(SIX_HOURS_MS);
      }
      if (p.curve.shape === "stale") {
        for (const t of times) expect(t).toBeLessThan(WINDOW.start.getTime());
      }
    }
  });

  it("spike curves: 6h-paced pre-window ramp ending at exactly 10% of final, then 3 rows inside today's window", () => {
    const spikes = CURVE_POSTS.filter((p) => p.curve.shape === "spike");
    expect(spikes.length).toBeGreaterThanOrEqual(2); // ansemtok + banned ruggedbull
    for (const p of spikes) {
      const rows = buildSnapshots(p, NOW);
      const pre = rows.filter(
        (r) => r.capturedAt.getTime() < WINDOW.start.getTime(),
      );
      const inWindow = rows.filter(
        (r) =>
          r.capturedAt.getTime() >= WINDOW.start.getTime() &&
          r.capturedAt.getTime() < WINDOW.end.getTime(),
      );
      const tag = `post ${p.platformPostId}`;
      expect(pre.length, tag).toBe(p.curve.snapshots - 3);
      expect(pre.length, tag).toBeGreaterThanOrEqual(1);
      expect(inWindow.length, tag).toBe(3);
      for (let i = 1; i < pre.length; i++) {
        expect(
          (pre[i]?.capturedAt.getTime() ?? 0) -
            (pre[i - 1]?.capturedAt.getTime() ?? 0),
        ).toBe(SIX_HOURS_MS);
      }
      // The daily baseline the query layer will pick — exactly 10% of final,
      // which keeps the in-window delta hand-derivable.
      expect(pre.at(-1)?.views, tag).toBe(p.curve.final.views / 10n);
    }
  });

  it("is deterministic per input and varies by post id (curves seeded by post id)", () => {
    const base: SeedPostFixture = {
      platform: "tiktok",
      platformPostId: "JITTER_A",
      creatorHandle: "ansemtok",
      url: "https://www.tiktok.com/@ansemtok/video/JITTER_A",
      caption: null,
      status: "approved",
      source: "submission",
      submittedByUserId: null,
      postedHoursAgo: 200,
      curve: {
        shape: "steady",
        snapshots: 8,
        final: {
          views: 1_000_000n,
          likes: 10_000n,
          comments: 1_000n,
          shares: 100n,
        },
      },
    };
    const a1 = buildSnapshots(base, NOW);
    const a2 = buildSnapshots(base, NOW);
    expect(a1).toEqual(a2);
    const b = buildSnapshots({ ...base, platformPostId: "JITTER_B" }, NOW);
    // Timestamps are shape-driven and identical; the VALUES ride the post id.
    expect(a1.map((r) => r.capturedAt)).toEqual(b.map((r) => r.capturedAt));
    expect(a1.map((r) => r.views)).not.toEqual(b.map((r) => r.views));
  });
});

describe("story math (hand-derived spec values, not observed output)", () => {
  it("bullpostoor owns the all-time board at 6,002,500; banned ruggedbull would rank #2 if visible", () => {
    expect(alltimeScoreOf("bullpostoor")).toBe(6_002_500n);
    for (const c of SEED_CREATORS) {
      if (c.handle === "bullpostoor" || c.isBanned) continue;
      const score = alltimeScoreOf(c.handle);
      expect(score < 6_002_500n, `${c.handle} outranks the all-time king`).toBe(
        true,
      );
      expect(score < 5_213_900n, `${c.handle} outranks banned ruggedbull`).toBe(
        true,
      );
    }
  });

  it("ansemtok's spike delta scores exactly 1,730,700 and beats every rival's daily ceiling at any hour", () => {
    const spike = CURVE_POSTS.find(
      (p) => p.creatorHandle === "ansemtok" && p.curve.shape === "spike",
    );
    expect(spike).toBeDefined();
    if (!spike) throw new Error("ansemtok spike fixture missing");
    const rows = buildSnapshots(spike, NOW);
    const baseline = rows
      .filter((r) => r.capturedAt.getTime() < WINDOW.start.getTime())
      .at(-1);
    if (!baseline) throw new Error("spike has no pre-window baseline");
    const delta = windowDelta(baseline, spike.curve.final);
    expect(computeScore(delta)).toBe(1_730_700n);

    // A creator's daily score can never exceed the summed FINAL totals of its
    // non-stale curves (deltas are clamped and bounded by the final row), so
    // this margin holds at any run hour, not just the pinned test clock.
    for (const c of SEED_CREATORS) {
      if (c.handle === "ansemtok" || c.isBanned) continue;
      const ceiling = CURVE_POSTS.filter(
        (p) =>
          p.creatorHandle === c.handle &&
          p.status === "approved" &&
          p.curve.shape !== "stale",
      ).reduce((sum, p) => sum + computeScore(p.curve.final), 0n);
      expect(ceiling < 1_730_700n, `${c.handle} could outrun the spike`).toBe(
        true,
      );
    }
  });

  it("every bullpostoor curve is stale — the all-time king structurally scores 0 today", () => {
    const posts = postsOf("bullpostoor");
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.curve?.shape).toBe("stale");
    }
  });
});

describe("determinism + registration (source verification)", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const AMBIENT_CLOCK = /new Date\(\)|Date\.now\(\)/g;
  const RANDOMNESS = /Math\.random/g;
  const countMatches = (source: string, re: RegExp) =>
    [...source.matchAll(re)].length;

  it("control: the clock and randomness matchers fire on a deliberately bad payload", () => {
    const bad = "const a = Date.now(); const b = new Date(); Math.random();";
    expect(countMatches(bad, AMBIENT_CLOCK)).toBe(2);
    expect(countMatches(bad, RANDOMNESS)).toBe(1);
  });

  it("seed sources read the ambient clock exactly once (the captured const now) and never use randomness", () => {
    const seedSource = read("src/server/db/seed.ts");
    const dataSource = read("src/server/db/seed-data.ts");
    expect(countMatches(dataSource, AMBIENT_CLOCK)).toBe(0);
    expect(countMatches(dataSource, RANDOMNESS)).toBe(0);
    expect(countMatches(seedSource, RANDOMNESS)).toBe(0);
    expect(countMatches(seedSource, AMBIENT_CLOCK)).toBe(1);
    expect(seedSource).toMatch(/const now = new Date\(\);/);
  });

  it("package.json registers db:seed as the exact tsx entry the CLI tests spawn", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["db:seed"]).toBe("tsx src/server/db/seed.ts");
  });

  it("ralph/AGENTS.md documents the seed command and the ADMIN_USER_IDS prerequisite", () => {
    const agents = read("ralph/AGENTS.md");
    expect(agents).toContain("pnpm db:seed");
    expect(agents).toContain("ADMIN_USER_IDS");
  });

  it("seed.ts prints the board story through the REAL query layer (imports both boards)", () => {
    const seedSource = read("src/server/db/seed.ts");
    expect(seedSource).toContain('from "@/server/db/queries/leaderboard"');
    expect(seedSource).toMatch(/\bdailyBoard\b/);
    expect(seedSource).toMatch(/\balltimeBoard\b/);
  });
});
