// Task 7 (spec 006): pure scoring engine — the single place where "who's
// winning" is defined. No I/O, no ambient clock (callers pass `now`), bigint
// math throughout (X view counts overflow 2^53), and no division anywhere.
// Consumed by the leaderboard queries (spec 007) and seed sanity checks
// (spec 010): daily score = computeScore(windowDelta(baseline, latest)),
// all-time = computeScore(latest denormalized totals).

export type MetricTotals = {
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
};

export type ScoreWeights = Readonly<MetricTotals>;

// Single source of truth for weights — everything derives from this constant.
// No per-platform weight table in v1 (a view is a view); tune post-launch.
export const DEFAULT_WEIGHTS: ScoreWeights = {
  views: 1n,
  likes: 30n,
  comments: 60n,
  shares: 90n,
};

// Generic window shape: [start, end) with an exclusive end, so a weekly or
// campaign window can be added later without touching consumers.
export type ScoreWindow = { start: Date; end: Date };

export type ScoredEntry = {
  id: string;
  score: bigint;
  views: bigint;
  postedAt: Date;
};

export type RankedEntry<T extends ScoredEntry = ScoredEntry> = T & {
  rank: number;
};

export function computeScore(
  totals: MetricTotals,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): bigint {
  return (
    totals.views * weights.views +
    totals.likes * weights.likes +
    totals.comments * weights.comments +
    totals.shares * weights.shares
  );
}

export function dayWindow(now: Date): ScoreWindow {
  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export const ZERO_TOTALS: MetricTotals = {
  views: 0n,
  likes: 0n,
  comments: 0n,
  shares: 0n,
};

function clampToZero(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

// A metric that DECREASED (likes removed, platform recount) clamps to 0n —
// a window can never subtract from a creator's score.
export function windowDelta(
  baseline: MetricTotals | null,
  latest: MetricTotals,
): MetricTotals {
  const base = baseline ?? ZERO_TOTALS;
  return {
    views: clampToZero(latest.views - base.views),
    likes: clampToZero(latest.likes - base.likes),
    comments: clampToZero(latest.comments - base.comments),
    shares: clampToZero(latest.shares - base.shares),
  };
}

// Total order: score desc → views desc → earliest postedAt (first mover
// wins) → id asc. bigints are compared, never coerced to number (precision).
function compareEntries(a: ScoredEntry, b: ScoredEntry): number {
  if (a.score !== b.score) return b.score > a.score ? 1 : -1;
  if (a.views !== b.views) return b.views > a.views ? 1 : -1;
  const aPosted = a.postedAt.getTime();
  const bPosted = b.postedAt.getTime();
  if (aPosted !== bPosted) return aPosted < bPosted ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function rankEntries<T extends ScoredEntry>(
  entries: readonly T[],
): Array<RankedEntry<T>> {
  const sorted = [...entries].sort(compareEntries);
  const ranked: Array<RankedEntry<T>> = [];
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i] as T;
    const previous = i > 0 ? ranked[i - 1] : undefined;
    // Standard competition ranking (1, 2, 2, 4): ranks tie on equal SCORE
    // only — ids are unique, so full-chain ties cannot exist; the rest of
    // the chain fixes display order and pagination, not rank.
    const rank =
      previous !== undefined && previous.score === current.score
        ? previous.rank
        : i + 1;
    ranked.push({ ...current, rank });
  }
  return ranked;
}
