// Spec 010: the seed fixture set — pure data + the snapshot curve builder.
// No I/O, no ambient clock (callers pass `now`), no randomness: curve values
// are jittered deterministically from the post id (FNV-1a), so the same
// fixtures always tell the same board story.
//
// The story, hand-derived in seed-data.test.ts:
// - bullpostoor (X) owns the all-time board via stale mega-posts whose
//   snapshots ALL predate today 00:00 UTC — he sits on the daily board at 0.
// - ansemtok (TikTok) owns the daily board via a spike curve: a pre-window
//   baseline at exactly 10% of final, then three rows inside today's window.
// - ruggedbull (X, banned) would rank #2 all-time and contest the daily top
//   if the ban filter ever leaked — his absence from boards is meaningful.
// - placeholder:CSEEDPH01 (IG) proves "Unclaimed creator" rendering, and
//   CSEED0203 is approved-but-never-polled (the em-dash "pending" story).
import { fnv1a } from "@/lib/hash";
import {
  igPostUrl,
  type Platform,
  profileUrlFor,
  tiktokPostUrl,
  xPostUrl,
} from "@/lib/post-url";
import { dayWindow, type MetricTotals } from "@/lib/scoring";

// Platform union reused from the parser — the seed may never invent a
// platform the rest of the app doesn't know.
export type SeedPlatform = Platform;
export type SeedCurveShape = "stale" | "steady" | "spike";

export type SeedCreatorFixture = {
  platform: SeedPlatform;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string;
  isBanned: boolean;
};

export type SeedCurve = {
  shape: SeedCurveShape;
  snapshots: number; // 4–10 per spec 010
  final: MetricTotals; // the newest snapshot == the latest_* denorm
};

export type SeedPostFixture = {
  platform: SeedPlatform;
  platformPostId: string;
  creatorHandle: string;
  url: string;
  caption: string | null;
  status: "pending" | "approved" | "rejected" | "removed";
  source: "submission" | "x_search" | "admin";
  submittedByUserId: string | null;
  postedHoursAgo: number | null; // relative to seed time; null = never carried a posted_at
  curve: SeedCurve | null; // null = never polled (no snapshots, latest_* untouched)
};

export type SeedSnapshotRow = MetricTotals & { capturedAt: Date };

const HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * HOUR_MS;
const BASIS_POINTS = 10_000;
const BASIS_POINTS_BIG = 10_000n;

// Spike geometry: the last pre-window row lands at EXACTLY 10% of final (the
// hand-derivable daily baseline); three in-window rows climb to 100%.
const SPIKE_IN_WINDOW_ROWS = 3;
const SPIKE_IN_WINDOW_FRACTIONS = [0.2, 0.55, 0.9] as const;
const SPIKE_IN_WINDOW_BASIS_POINTS = [4_000, 7_500, 10_000] as const;
const SPIKE_BASELINE_BP = 1_000;
const SPIKE_FLOOR_BP = 200;

// ---------------------------------------------------------------------------
// Curve builder
// ---------------------------------------------------------------------------

// Cumulative per-step weights seeded by the post id: strictly increasing
// prefix sums keep every metric monotone under integer division while giving
// each post its own growth texture.
function weightPrefixSums(id: string, count: number): number[] {
  const prefix: number[] = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += 1 + (fnv1a(`${id}:${i}`) % 7);
    prefix.push(sum);
  }
  return prefix;
}

function scaleTotals(final: MetricTotals, basisPoints: number): MetricTotals {
  const at = (value: bigint) =>
    (value * BigInt(basisPoints)) / BASIS_POINTS_BIG;
  return {
    views: at(final.views),
    likes: at(final.likes),
    comments: at(final.comments),
    shares: at(final.shares),
  };
}

export function buildSnapshots(
  post: SeedPostFixture,
  now: Date,
): SeedSnapshotRow[] {
  const curve = post.curve;
  if (curve === null) return [];
  const { final, shape, snapshots } = curve;
  const window = dayWindow(now);
  const id = post.platformPostId;

  if (shape === "spike") {
    const preCount = snapshots - SPIKE_IN_WINDOW_ROWS;
    const prefix = weightPrefixSums(id, preCount);
    const total = prefix[preCount - 1] ?? 1;
    const preEnd = window.start.getTime() - 3 * HOUR_MS;
    const rows: SeedSnapshotRow[] = prefix.map((p, i) => ({
      ...scaleTotals(
        final,
        SPIKE_FLOOR_BP +
          Math.floor(((SPIKE_BASELINE_BP - SPIKE_FLOOR_BP) * p) / total),
      ),
      capturedAt: new Date(preEnd - (preCount - 1 - i) * SIX_HOURS_MS),
    }));
    // In-window rows ride fractions of the elapsed day; the +seconds nudge
    // keeps capturedAt strictly increasing even when the seed runs at 00:00.
    const elapsedMs = now.getTime() - window.start.getTime();
    SPIKE_IN_WINDOW_FRACTIONS.forEach((fraction, i) => {
      rows.push({
        ...scaleTotals(final, SPIKE_IN_WINDOW_BASIS_POINTS[i] ?? BASIS_POINTS),
        capturedAt: new Date(
          window.start.getTime() +
            Math.floor(fraction * elapsedMs) +
            (i + 1) * 1000,
        ),
      });
    });
    return rows;
  }

  // stale: ends 1h before today's window at any run hour (never contributes
  // to the daily board); steady: ends 30min before now.
  const end =
    shape === "stale"
      ? window.start.getTime() - HOUR_MS
      : now.getTime() - 30 * 60 * 1000;
  const prefix = weightPrefixSums(id, snapshots);
  const total = prefix[snapshots - 1] ?? 1;
  return prefix.map((p, i) => ({
    ...scaleTotals(final, Math.floor((BASIS_POINTS * p) / total)),
    capturedAt: new Date(end - (snapshots - 1 - i) * SIX_HOURS_MS),
  }));
}

// ---------------------------------------------------------------------------
// Creators (18: 8 X / 6 TikTok / 4 Instagram)
// ---------------------------------------------------------------------------

function creator(spec: {
  platform: SeedPlatform;
  handle: string;
  displayName: string | null;
  isBanned?: boolean;
  avatarUrl?: string | null;
  profileUrl?: string;
}): SeedCreatorFixture {
  return {
    platform: spec.platform,
    handle: spec.handle,
    displayName: spec.displayName,
    avatarUrl:
      spec.avatarUrl !== undefined
        ? spec.avatarUrl
        : `https://i.pravatar.cc/150?u=${spec.handle}`,
    profileUrl: spec.profileUrl ?? profileUrlFor(spec.platform, spec.handle),
    isBanned: spec.isBanned ?? false,
  };
}

export const SEED_CREATORS: readonly SeedCreatorFixture[] = [
  // X (8)
  creator({
    platform: "x",
    handle: "bullpostoor",
    displayName: "Bull Postoor",
  }),
  creator({ platform: "x", handle: "ansemclips", displayName: "Ansem Clips" }),
  creator({ platform: "x", handle: "moonpostor", displayName: "Moon Postor" }),
  creator({ platform: "x", handle: "viewfarmer", displayName: "View Farmer" }),
  creator({
    platform: "x",
    handle: "chartgoblin",
    displayName: "Chart Goblin",
  }),
  creator({ platform: "x", handle: "threadbull", displayName: "Thread Bull" }),
  creator({ platform: "x", handle: "solmaxi", displayName: "Sol Maxi" }),
  creator({
    platform: "x",
    handle: "ruggedbull",
    displayName: "Rugged Bull",
    isBanned: true,
  }),
  // TikTok (6)
  creator({ platform: "tiktok", handle: "ansemtok", displayName: "Ansem Tok" }),
  creator({
    platform: "tiktok",
    handle: "cliptheory",
    displayName: "Clip Theory",
  }),
  creator({
    platform: "tiktok",
    handle: "bullrunbaby",
    displayName: "Bull Run Baby",
  }),
  creator({ platform: "tiktok", handle: "fyppump", displayName: "FYP Pump" }),
  creator({ platform: "tiktok", handle: "degentok", displayName: "Degen Tok" }),
  creator({
    platform: "tiktok",
    handle: "tokfarmer",
    displayName: "Tok Farmer",
  }),
  // Instagram (4)
  creator({
    platform: "instagram",
    handle: "blackbull.era",
    displayName: "Black Bull Era",
  }),
  creator({
    platform: "instagram",
    handle: "ansemgram",
    displayName: "Ansem Gram",
  }),
  creator({
    platform: "instagram",
    handle: "reelsdegen",
    displayName: "Reels Degen",
  }),
  // Unresolved submission: deterministic handle placeholder:<platformPostId>,
  // profile_url = canonical post URL stand-in (spec 002), no name, no avatar.
  creator({
    platform: "instagram",
    handle: "placeholder:CSEEDPH01",
    displayName: null,
    avatarUrl: null,
    profileUrl: igPostUrl("CSEEDPH01"),
  }),
];

// ---------------------------------------------------------------------------
// Posts (60: 47 approved / 6 pending / 4 rejected / 3 removed)
// ---------------------------------------------------------------------------

// Dispatch onto the parser's canonical builders — seeded URLs are exactly
// what parsePostUrl would rebuild, so a re-submission of a seeded post
// dedupes cleanly.
function postUrlFor(
  platform: SeedPlatform,
  handle: string,
  platformPostId: string,
): string {
  if (platform === "x") return xPostUrl(handle, platformPostId);
  if (platform === "tiktok") return tiktokPostUrl(handle, platformPostId);
  return igPostUrl(platformPostId);
}

function curveOf(
  shape: SeedCurveShape,
  snapshots: number,
  final: { views: number; likes: number; comments: number; shares: number },
): SeedCurve {
  return {
    shape,
    snapshots,
    final: {
      views: BigInt(final.views),
      likes: BigInt(final.likes),
      comments: BigInt(final.comments),
      shares: BigInt(final.shares),
    },
  };
}

function post(spec: {
  platform: SeedPlatform;
  id: string;
  creator: string;
  hoursAgo: number | null;
  status?: SeedPostFixture["status"];
  source?: SeedPostFixture["source"];
  curve?: SeedCurve | null;
  caption?: string | null;
  submitter?: string | null;
}): SeedPostFixture {
  const source = spec.source ?? "submission";
  return {
    platform: spec.platform,
    platformPostId: spec.id,
    creatorHandle: spec.creator,
    url: postUrlFor(spec.platform, spec.creator, spec.id),
    caption: spec.caption !== undefined ? spec.caption : "$ANSEM 🐂 up only",
    status: spec.status ?? "approved",
    source,
    submittedByUserId:
      spec.submitter !== undefined
        ? spec.submitter
        : source === "submission"
          ? `user_seed_${spec.creator}`
          : null,
    postedHoursAgo: spec.hoursAgo,
    curve: spec.curve ?? null,
  };
}

export const SEED_POSTS: readonly SeedPostFixture[] = [
  // --- X · bullpostoor — the all-time king; every curve stale (0 today) ---
  post({
    platform: "x",
    id: "1940000000000000101",
    creator: "bullpostoor",
    hoursAgo: 430,
    source: "x_search",
    caption: "the $ANSEM thesis. read it twice. 🐂",
    curve: curveOf("stale", 10, {
      views: 2_600_000,
      likes: 48_000,
      comments: 3_100,
      shares: 2_400,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000102",
    creator: "bullpostoor",
    hoursAgo: 500,
    source: "x_search",
    curve: curveOf("stale", 7, {
      views: 700_000,
      likes: 12_000,
      comments: 900,
      shares: 500,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000103",
    creator: "bullpostoor",
    hoursAgo: 300,
    curve: curveOf("stale", 6, {
      views: 250_000,
      likes: 4_000,
      comments: 300,
      shares: 150,
    }),
  }),
  // --- X · ansemclips ---
  post({
    platform: "x",
    id: "1940000000000000201",
    creator: "ansemclips",
    hoursAgo: 120,
    curve: curveOf("steady", 8, {
      views: 95_000,
      likes: 1_800,
      comments: 210,
      shares: 95,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000202",
    creator: "ansemclips",
    hoursAgo: 250,
    curve: curveOf("stale", 6, {
      views: 60_000,
      likes: 1_100,
      comments: 130,
      shares: 60,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000203",
    creator: "ansemclips",
    hoursAgo: 48,
    curve: curveOf("steady", 5, {
      views: 45_000,
      likes: 850,
      comments: 100,
      shares: 45,
    }),
  }),
  // --- X · moonpostor ---
  post({
    platform: "x",
    id: "1940000000000000301",
    creator: "moonpostor",
    hoursAgo: 96,
    curve: curveOf("steady", 7, {
      views: 80_000,
      likes: 1_500,
      comments: 170,
      shares: 80,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000302",
    creator: "moonpostor",
    hoursAgo: 200,
    curve: curveOf("steady", 6, {
      views: 70_000,
      likes: 1_300,
      comments: 150,
      shares: 70,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000303",
    creator: "moonpostor",
    hoursAgo: 30,
    curve: curveOf("steady", 4, {
      views: 30_000,
      likes: 550,
      comments: 65,
      shares: 30,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000304",
    creator: "moonpostor",
    hoursAgo: 5,
    status: "pending",
  }),
  // --- X · viewfarmer ---
  post({
    platform: "x",
    id: "1940000000000000401",
    creator: "viewfarmer",
    hoursAgo: 150,
    curve: curveOf("steady", 8, {
      views: 110_000,
      likes: 2_100,
      comments: 240,
      shares: 110,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000402",
    creator: "viewfarmer",
    hoursAgo: 320,
    curve: curveOf("stale", 7, {
      views: 50_000,
      likes: 950,
      comments: 110,
      shares: 50,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000403",
    creator: "viewfarmer",
    hoursAgo: 72,
    curve: curveOf("steady", 5, {
      views: 20_000,
      likes: 380,
      comments: 45,
      shares: 20,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000404",
    creator: "viewfarmer",
    hoursAgo: 180,
    status: "removed", // taken down upstream — snapshots preserved (spec 004)
    curve: curveOf("steady", 5, {
      views: 40_000,
      likes: 750,
      comments: 90,
      shares: 40,
    }),
  }),
  // --- X · chartgoblin ---
  post({
    platform: "x",
    id: "1940000000000000501",
    creator: "chartgoblin",
    hoursAgo: 60,
    curve: curveOf("steady", 6, {
      views: 75_000,
      likes: 1_400,
      comments: 160,
      shares: 75,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000502",
    creator: "chartgoblin",
    hoursAgo: 260,
    curve: curveOf("stale", 5, {
      views: 40_000,
      likes: 760,
      comments: 90,
      shares: 40,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000503",
    creator: "chartgoblin",
    hoursAgo: 20,
    status: "rejected",
  }),
  // --- X · threadbull ---
  post({
    platform: "x",
    id: "1940000000000000601",
    creator: "threadbull",
    hoursAgo: 110,
    curve: curveOf("steady", 7, {
      views: 65_000,
      likes: 1_250,
      comments: 145,
      shares: 65,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000602",
    creator: "threadbull",
    hoursAgo: 220,
    curve: curveOf("steady", 4, {
      views: 35_000,
      likes: 660,
      comments: 78,
      shares: 35,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000603",
    creator: "threadbull",
    hoursAgo: 8,
    status: "pending",
  }),
  // --- X · solmaxi ---
  post({
    platform: "x",
    id: "1940000000000000701",
    creator: "solmaxi",
    hoursAgo: 90,
    curve: curveOf("steady", 6, {
      views: 90_000,
      likes: 1_700,
      comments: 200,
      shares: 90,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000702",
    creator: "solmaxi",
    hoursAgo: 400,
    curve: curveOf("stale", 5, {
      views: 25_000,
      likes: 470,
      comments: 55,
      shares: 25,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000703",
    creator: "solmaxi",
    hoursAgo: 44,
    status: "rejected",
  }),
  // --- X · ruggedbull (BANNED — high numbers that must appear on no board) ---
  post({
    platform: "x",
    id: "1940000000000000801",
    creator: "ruggedbull",
    hoursAgo: 64,
    source: "x_search",
    caption: "$ANSEM inevitable. screenshot this.",
    curve: curveOf("spike", 6, {
      views: 2_000_000,
      likes: 40_000,
      comments: 2_500,
      shares: 2_000,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000802",
    creator: "ruggedbull",
    hoursAgo: 340,
    source: "x_search",
    curve: curveOf("stale", 6, {
      views: 900_000,
      likes: 15_000,
      comments: 1_000,
      shares: 700,
    }),
  }),
  post({
    platform: "x",
    id: "1940000000000000803",
    creator: "ruggedbull",
    hoursAgo: 100,
    curve: curveOf("steady", 5, {
      views: 120_000,
      likes: 2_200,
      comments: 250,
      shares: 110,
    }),
  }),
  // --- TikTok · ansemtok — the daily winner: fresh spike since 00:00 UTC ---
  post({
    platform: "tiktok",
    id: "7520000000000000101",
    creator: "ansemtok",
    hoursAgo: 60,
    caption: "$ANSEM broke my fyp 🐂📈",
    curve: curveOf("spike", 6, {
      views: 900_000,
      likes: 26_000,
      comments: 1_800,
      shares: 1_500,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000102",
    creator: "ansemtok",
    hoursAgo: 130,
    curve: curveOf("steady", 5, {
      views: 30_000,
      likes: 520,
      comments: 60,
      shares: 25,
    }),
  }),
  // --- TikTok · cliptheory ---
  post({
    platform: "tiktok",
    id: "7520000000000000201",
    creator: "cliptheory",
    hoursAgo: 70,
    curve: curveOf("steady", 7, {
      views: 120_000,
      likes: 2_300,
      comments: 260,
      shares: 120,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000202",
    creator: "cliptheory",
    hoursAgo: 190,
    curve: curveOf("steady", 6, {
      views: 60_000,
      likes: 1_150,
      comments: 130,
      shares: 60,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000203",
    creator: "cliptheory",
    hoursAgo: 310,
    curve: curveOf("stale", 5, {
      views: 25_000,
      likes: 480,
      comments: 55,
      shares: 25,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000204",
    creator: "cliptheory",
    hoursAgo: 15,
    status: "rejected",
  }),
  // --- TikTok · bullrunbaby ---
  post({
    platform: "tiktok",
    id: "7520000000000000301",
    creator: "bullrunbaby",
    hoursAgo: 55,
    curve: curveOf("steady", 8, {
      views: 100_000,
      likes: 1_900,
      comments: 220,
      shares: 100,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000302",
    creator: "bullrunbaby",
    hoursAgo: 140,
    curve: curveOf("steady", 6, {
      views: 45_000,
      likes: 850,
      comments: 100,
      shares: 45,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000303",
    creator: "bullrunbaby",
    hoursAgo: 230,
    curve: curveOf("steady", 4, {
      views: 30_000,
      likes: 570,
      comments: 65,
      shares: 30,
    }),
  }),
  // --- TikTok · fyppump ---
  post({
    platform: "tiktok",
    id: "7520000000000000401",
    creator: "fyppump",
    hoursAgo: 85,
    curve: curveOf("steady", 7, {
      views: 85_000,
      likes: 1_600,
      comments: 185,
      shares: 85,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000402",
    creator: "fyppump",
    hoursAgo: 175,
    curve: curveOf("steady", 5, {
      views: 55_000,
      likes: 1_050,
      comments: 120,
      shares: 55,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000403",
    creator: "fyppump",
    hoursAgo: 280,
    curve: curveOf("stale", 4, {
      views: 15_000,
      likes: 280,
      comments: 32,
      shares: 15,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000404",
    creator: "fyppump",
    hoursAgo: 3,
    status: "pending",
  }),
  // --- TikTok · degentok ---
  post({
    platform: "tiktok",
    id: "7520000000000000501",
    creator: "degentok",
    hoursAgo: 40,
    curve: curveOf("steady", 6, {
      views: 70_000,
      likes: 1_350,
      comments: 155,
      shares: 70,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000502",
    creator: "degentok",
    hoursAgo: 160,
    curve: curveOf("steady", 5, {
      views: 40_000,
      likes: 760,
      comments: 88,
      shares: 40,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000503",
    creator: "degentok",
    hoursAgo: 240,
    curve: curveOf("steady", 4, {
      views: 20_000,
      likes: 380,
      comments: 44,
      shares: 20,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000504",
    creator: "degentok",
    hoursAgo: 10,
    status: "pending",
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000505",
    creator: "degentok",
    hoursAgo: 210,
    status: "removed",
    curve: curveOf("stale", 4, {
      views: 35_000,
      likes: 660,
      comments: 76,
      shares: 35,
    }),
  }),
  // --- TikTok · tokfarmer ---
  post({
    platform: "tiktok",
    id: "7520000000000000601",
    creator: "tokfarmer",
    hoursAgo: 66,
    curve: curveOf("steady", 6, {
      views: 95_000,
      likes: 1_850,
      comments: 215,
      shares: 95,
    }),
  }),
  post({
    platform: "tiktok",
    id: "7520000000000000602",
    creator: "tokfarmer",
    hoursAgo: 150,
    curve: curveOf("steady", 5, {
      views: 35_000,
      likes: 640,
      comments: 74,
      shares: 35,
    }),
  }),
  // --- Instagram · blackbull.era ---
  post({
    platform: "instagram",
    id: "CSEED0101",
    creator: "blackbull.era",
    hoursAgo: 50,
    curve: curveOf("steady", 7, {
      views: 115_000,
      likes: 2_200,
      comments: 250,
      shares: 115,
    }),
  }),
  post({
    platform: "instagram",
    id: "CSEED0102",
    creator: "blackbull.era",
    hoursAgo: 170,
    curve: curveOf("steady", 6, {
      views: 65_000,
      likes: 1_250,
      comments: 140,
      shares: 65,
    }),
  }),
  post({
    platform: "instagram",
    id: "CSEED0103",
    creator: "blackbull.era",
    hoursAgo: 290,
    curve: curveOf("stale", 5, {
      views: 30_000,
      likes: 560,
      comments: 64,
      shares: 30,
    }),
  }),
  post({
    platform: "instagram",
    id: "CSEED0104",
    creator: "blackbull.era",
    hoursAgo: 7,
    status: "pending",
  }),
  post({
    platform: "instagram",
    id: "CSEED0105",
    creator: "blackbull.era",
    hoursAgo: 33,
    status: "rejected",
  }),
  // --- Instagram · ansemgram ---
  post({
    platform: "instagram",
    id: "CSEED0201",
    creator: "ansemgram",
    hoursAgo: 95,
    curve: curveOf("steady", 6, {
      views: 90_000,
      likes: 1_750,
      comments: 200,
      shares: 90,
    }),
  }),
  post({
    platform: "instagram",
    id: "CSEED0202",
    creator: "ansemgram",
    hoursAgo: 205,
    curve: curveOf("steady", 5, {
      views: 40_000,
      likes: 770,
      comments: 88,
      shares: 40,
    }),
  }),
  // Approved moments ago, first refresh still pending — the ONLY visible
  // approved post with no snapshots (UI shows the em-dash "pending" state).
  post({
    platform: "instagram",
    id: "CSEED0203",
    creator: "ansemgram",
    hoursAgo: null,
    caption: "just posted. $ANSEM szn 🐂",
  }),
  post({
    platform: "instagram",
    id: "CSEED0204",
    creator: "ansemgram",
    hoursAgo: 260,
    status: "removed",
    curve: curveOf("steady", 4, {
      views: 28_000,
      likes: 530,
      comments: 60,
      shares: 28,
    }),
  }),
  // --- Instagram · reelsdegen ---
  post({
    platform: "instagram",
    id: "CSEED0301",
    creator: "reelsdegen",
    hoursAgo: 62,
    curve: curveOf("steady", 7, {
      views: 105_000,
      likes: 2_000,
      comments: 230,
      shares: 105,
    }),
  }),
  post({
    platform: "instagram",
    id: "CSEED0302",
    creator: "reelsdegen",
    hoursAgo: 185,
    curve: curveOf("steady", 5, {
      views: 50_000,
      likes: 950,
      comments: 110,
      shares: 50,
    }),
  }),
  post({
    platform: "instagram",
    id: "CSEED0303",
    creator: "reelsdegen",
    hoursAgo: 275,
    curve: curveOf("steady", 4, {
      views: 22_000,
      likes: 420,
      comments: 48,
      shares: 22,
    }),
  }),
  post({
    platform: "instagram",
    id: "CSEED0304",
    creator: "reelsdegen",
    hoursAgo: 4,
    status: "pending",
  }),
  // --- Instagram · unclaimed placeholder ---
  post({
    platform: "instagram",
    id: "CSEEDPH01",
    creator: "placeholder:CSEEDPH01",
    hoursAgo: 26,
    caption: null,
    submitter: "user_seed_anon",
    curve: curveOf("steady", 5, {
      views: 55_000,
      likes: 1_040,
      comments: 120,
      shares: 55,
    }),
  }),
];
