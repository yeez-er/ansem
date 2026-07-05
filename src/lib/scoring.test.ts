// Task 7 (spec 006): scoring engine — unit tests against hand-computed spec
// values (never the function's own observed output), fake timers pinned to a
// decoy instant so any ambient clock read inside dayWindow would surface as a
// wrong-day window, a seeded property test proving rankEntries emits a total
// order, and source verification (division ban, UTC-only date math, single
// weight definition in the codebase).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeScore,
  DEFAULT_WEIGHTS,
  dayWindow,
  rankEntries,
  type ScoredEntry,
  windowDelta,
} from "./scoring";

describe("computeScore — hand-computed spec values", () => {
  it("spec example: {1000 views, 10 likes, 2 comments, 1 share} → 1510n", () => {
    // 1000·1 + 10·30 + 2·60 + 1·90 = 1510, computed by hand from spec 006
    expect(
      computeScore({ views: 1000n, likes: 10n, comments: 2n, shares: 1n }),
    ).toBe(1510n);
  });

  it("all-zero metrics → 0n", () => {
    expect(
      computeScore({ views: 0n, likes: 0n, comments: 0n, shares: 0n }),
    ).toBe(0n);
  });

  it("views beyond Number.MAX_SAFE_INTEGER stay exact (bigint end-to-end)", () => {
    const views = BigInt(Number.MAX_SAFE_INTEGER) + 7n;
    expect(computeScore({ views, likes: 0n, comments: 0n, shares: 0n })).toBe(
      9_007_199_254_740_998n,
    );
  });

  it("3B views with engagement — exact, hand-computed", () => {
    // 3e9·1 + 1e6·30 + 5e4·60 + 1e4·90 = 3,000,000,000 + 30,000,000 + 3,000,000 + 900,000
    expect(
      computeScore({
        views: 3_000_000_000n,
        likes: 1_000_000n,
        comments: 50_000n,
        shares: 10_000n,
      }),
    ).toBe(3_033_900_000n);
  });

  it("custom weights override the default (everything derives from the weights param)", () => {
    expect(
      computeScore(
        { views: 10n, likes: 1n, comments: 1n, shares: 1n },
        { views: 2n, likes: 0n, comments: 0n, shares: 0n },
      ),
    ).toBe(20n);
  });

  it("DEFAULT_WEIGHTS is exactly the spec table", () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      views: 1n,
      likes: 30n,
      comments: 60n,
      shares: 90n,
    });
  });
});

describe("dayWindow — UTC day boundaries (system clock pinned to a decoy)", () => {
  // Decoy instant: any ambient Date.now()/new Date() read inside dayWindow
  // would produce a 2031-11-11 window and fail every assertion below.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-11-11T11:11:11.111Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("00:00:00.000 UTC belongs to the day it starts", () => {
    const { start, end } = dayWindow(new Date("2026-03-08T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("23:59:59.999 UTC belongs to that same day", () => {
    const { start, end } = dayWindow(new Date("2026-03-08T23:59:59.999Z"));
    expect(start.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("the next millisecond rolls over to the next day", () => {
    const { start, end } = dayWindow(new Date("2026-03-09T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-10T00:00:00.000Z");
  });

  it.each([
    ["US spring-forward", "2026-03-08T12:00:00.000Z"],
    ["EU spring-forward", "2026-03-29T12:00:00.000Z"],
    ["US fall-back", "2026-11-01T12:00:00.000Z"],
  ])(
    "DST-transition date (%s) still yields an exact 24h UTC window",
    (_name, iso) => {
      const { start, end } = dayWindow(new Date(iso));
      expect(end.getTime() - start.getTime()).toBe(86_400_000);
      expect(start.toISOString().endsWith("T00:00:00.000Z")).toBe(true);
    },
  );

  it("year boundary: Dec 31 23:59:59.999Z ends at Jan 1 of the next year", () => {
    const { start, end } = dayWindow(new Date("2026-12-31T23:59:59.999Z"));
    expect(start.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("derives only from the passed now, never the (decoy) system clock", () => {
    const { start, end } = dayWindow(new Date("2026-07-04T15:30:00.000Z"));
    expect(start.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });

  it("does not mutate the caller's Date", () => {
    const now = new Date("2026-03-08T13:37:42.123Z");
    dayWindow(now);
    expect(now.toISOString()).toBe("2026-03-08T13:37:42.123Z");
  });
});

describe("windowDelta — per-metric max(0n, latest − baseline)", () => {
  it("subtracts baseline per metric", () => {
    expect(
      windowDelta(
        { views: 100n, likes: 10n, comments: 5n, shares: 2n },
        { views: 150n, likes: 15n, comments: 5n, shares: 3n },
      ),
    ).toEqual({ views: 50n, likes: 5n, comments: 0n, shares: 1n });
  });

  it("clamps a decreased metric to 0n, never negative (likes removed, recount)", () => {
    expect(
      windowDelta(
        { views: 100n, likes: 50n, comments: 5n, shares: 2n },
        { views: 120n, likes: 40n, comments: 5n, shares: 2n },
      ),
    ).toEqual({ views: 20n, likes: 0n, comments: 0n, shares: 0n });
  });

  it("every metric decreased → all-zero delta", () => {
    expect(
      windowDelta(
        { views: 9n, likes: 9n, comments: 9n, shares: 9n },
        { views: 1n, likes: 1n, comments: 1n, shares: 1n },
      ),
    ).toEqual({ views: 0n, likes: 0n, comments: 0n, shares: 0n });
  });

  it("null baseline (post first tracked mid-window) counts the full latest totals", () => {
    expect(
      windowDelta(null, { views: 42n, likes: 1n, comments: 2n, shares: 3n }),
    ).toEqual({ views: 42n, likes: 1n, comments: 2n, shares: 3n });
  });

  it("does not mutate its inputs", () => {
    const baseline = { views: 100n, likes: 10n, comments: 5n, shares: 2n };
    const latest = { views: 150n, likes: 15n, comments: 6n, shares: 3n };
    windowDelta(baseline, latest);
    expect(baseline).toEqual({
      views: 100n,
      likes: 10n,
      comments: 5n,
      shares: 2n,
    });
    expect(latest).toEqual({
      views: 150n,
      likes: 15n,
      comments: 6n,
      shares: 3n,
    });
  });
});

// Shared builder — defaults keep each test's noise down; overrides carry intent.
const entry = (
  overrides: Partial<ScoredEntry> & { id: string },
): ScoredEntry => ({
  score: 0n,
  views: 0n,
  postedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("rankEntries — standard competition ranking + total-order tie-breaks", () => {
  it("empty list → empty list (a list is a list)", () => {
    expect(rankEntries([])).toEqual([]);
  });

  it("assigns standard competition ranks 1, 2, 2, 4 on score ties", () => {
    const out = rankEntries([
      entry({ id: "a", score: 10n }),
      entry({ id: "b", score: 100n }),
      entry({ id: "c", score: 50n, views: 5n }),
      entry({ id: "d", score: 50n, views: 9n }),
    ]);
    expect(out.map((e) => ({ id: e.id, rank: e.rank }))).toEqual([
      { id: "b", rank: 1 },
      // ties share a rank on equal SCORE; views only fixes order within the tie
      { id: "d", rank: 2 },
      { id: "c", rank: 2 },
      { id: "a", rank: 4 },
    ]);
  });

  it("tie-break chain: score desc → views desc → earliest postedAt → id asc", () => {
    const out = rankEntries([
      entry({
        id: "b",
        score: 1000n,
        views: 500n,
        postedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
      entry({
        id: "d",
        score: 1000n,
        views: 500n,
        postedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      entry({
        id: "a",
        score: 1000n,
        views: 900n,
        postedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
      entry({
        id: "c",
        score: 1000n,
        views: 500n,
        postedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ]);
    // a: most views (despite latest postedAt — views outranks recency);
    // c/d: same views+postedAt → id asc; b: later postedAt loses to first movers
    expect(out.map((e) => e.id)).toEqual(["a", "c", "d", "b"]);
    // all four share the top score — competition ranking keeps them all at 1
    expect(out.map((e) => e.rank)).toEqual([1, 1, 1, 1]);
  });

  it("rank resumes at the position after a tie block (1, 1, 3 shape)", () => {
    const out = rankEntries([
      entry({ id: "a", score: 5n }),
      entry({ id: "b", score: 9n, views: 1n }),
      entry({ id: "c", score: 9n }),
    ]);
    expect(out.map((e) => e.rank)).toEqual([1, 1, 3]);
  });

  it("does not mutate the input array or patch its entry objects", () => {
    const low = entry({ id: "x", score: 1n });
    const high = entry({ id: "y", score: 2n });
    const input = [low, high];
    const out = rankEntries(input);
    expect(input.map((e) => e.id)).toEqual(["x", "y"]);
    expect(input[0]).toBe(low);
    expect(low).toEqual(entry({ id: "x", score: 1n }));
    expect(out[0]?.id).toBe("y");
    expect(out[0]).not.toBe(high);
  });

  it("preserves extra caller fields on ranked entries (generic passthrough)", () => {
    const out = rankEntries([
      { ...entry({ id: "a", score: 1n }), handle: "bull" },
    ]);
    expect(out[0]?.handle).toBe("bull");
    expect(out[0]?.rank).toBe(1);
  });

  // Deterministic PRNG (mulberry32) — no Math.random(): replayable, never flaky.
  const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const shuffle = <T>(items: readonly T[], rand: () => number): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const swap = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = swap;
    }
    return copy;
  };

  // Independent, spec-derived ordering oracle (not the module's comparator).
  const precedes = (a: ScoredEntry, b: ScoredEntry): boolean => {
    if (a.score !== b.score) return a.score > b.score;
    if (a.views !== b.views) return a.views > b.views;
    if (a.postedAt.getTime() !== b.postedAt.getTime()) {
      return a.postedAt.getTime() < b.postedAt.getTime();
    }
    return a.id < b.id;
  };

  it("property: total order — every permutation ranks identically (60 seeded runs)", () => {
    // small pools force collisions on every tie-break rung
    const scorePool = [0n, 50n, 50n, 9_007_199_254_740_993n];
    const viewsPool = [0n, 7n, 7n, 123n];
    const datePool = [
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-02-01T00:00:00.000Z"),
    ];
    for (let run = 0; run < 60; run++) {
      const rand = mulberry32(run * 2_654_435_761 + 1);
      const pick = <T>(pool: readonly T[]): T =>
        pool[Math.floor(rand() * pool.length)] as T;
      const base: ScoredEntry[] = [];
      for (let i = 0; i < 24; i++) {
        base.push({
          id: `id-${String(i).padStart(2, "0")}`,
          score: pick(scorePool),
          views: pick(viewsPool),
          postedAt: pick(datePool),
        });
      }
      const rankedA = rankEntries(shuffle(base, rand));
      const rankedB = rankEntries(shuffle(base, rand));
      // permutation-independence: no ambiguity → stable pagination
      expect(rankedA.map((e) => e.id)).toEqual(rankedB.map((e) => e.id));
      expect(rankedA[0]?.rank).toBe(1);
      for (let i = 1; i < rankedA.length; i++) {
        const prev = rankedA[i - 1] as (typeof rankedA)[number];
        const cur = rankedA[i] as (typeof rankedA)[number];
        expect(precedes(prev, cur), `run ${run} position ${i}`).toBe(true);
        expect(cur.rank).toBe(cur.score === prev.score ? prev.rank : i + 1);
      }
    }
  });
});

describe("source verification — division ban, UTC-only date math, single weight source", () => {
  const SRC_DIR = join(process.cwd(), "src");
  const SCORING_PATH = join(SRC_DIR, "lib", "scoring.ts");
  const scoringSource = () => readFileSync(SCORING_PATH, "utf8");

  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("control: the division matcher fires on a deliberately-divided payload", () => {
    expect(stripComments("const half = views / 2n;")).toContain("/");
  });

  it("no `/` outside comments — zero division on metrics, zero imports (pure module)", () => {
    expect(stripComments(scoringSource())).not.toContain("/");
  });

  it.each([
    "Date.now",
    "new Date()",
    "setHours(",
    "setDate(",
    "setMinutes(",
    "setSeconds(",
    "setMilliseconds(",
    "getTimezoneOffset",
  ])("never uses ambient-clock or local-time API: %s", (banned) => {
    expect(scoringSource()).not.toContain(banned);
  });

  it("scoring.ts pins the spec weights 1n, 30n, 60n, 90n inside DEFAULT_WEIGHTS", () => {
    expect(scoringSource()).toMatch(
      /DEFAULT_WEIGHTS[^=]*=\s*\{[^}]*views:\s*1n,[^}]*likes:\s*30n,[^}]*comments:\s*60n,[^}]*shares:\s*90n,?[^}]*\}/,
    );
  });

  const walkTsFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
      const full = join(dir, dirent.name);
      if (dirent.isDirectory()) return walkTsFiles(full);
      return /\.(ts|tsx)$/.test(dirent.name) ? [full] : [];
    });

  it("DEFAULT_WEIGHTS is the only weight definition in src (sweep)", () => {
    const others = walkTsFiles(SRC_DIR).filter(
      (file) => file !== SCORING_PATH && !/\.test\.(ts|tsx)$/.test(file),
    );
    // control: the sweep actually scans files
    expect(others.length).toBeGreaterThan(0);
    for (const file of others) {
      const source = readFileSync(file, "utf8");
      // no second weights constant (imports of DEFAULT_WEIGHTS stay legal)
      expect(source, file).not.toMatch(/(const|let|var)\s+\w*WEIGHTS\w*/);
      // no duplicated weight literals shaped like a weight map
      expect(source, file).not.toMatch(
        /(likes|comments|shares)\s*:\s*(30|60|90)n/,
      );
    }
  });
});
