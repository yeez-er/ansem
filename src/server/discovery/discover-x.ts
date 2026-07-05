// Task 16 (spec 005): discoverX orchestration — X recent-search driven post
// discovery, feature-flagged and budget-bounded. The cron route (next
// iteration) stays thin; this function is the testable unit. The since_id
// cursor advances ONLY after every read result committed cleanly, so a crashed
// or degraded run re-reads the same window and the natural-key UNIQUE gates
// dedupe (crash-safe by construction).
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getEnv, type ServerEnv } from "@/env";
import { normalizeHandle, profileUrlFor, xPostUrl } from "@/lib/post-url";
import {
  creators,
  discoveryState,
  metricSnapshots,
  posts,
} from "@/server/db/schema";
import {
  asRecord,
  dateOrNull,
  stringOrNull,
  toBigInt,
} from "@/server/metrics/adapter-util";
import { XClient } from "@/server/metrics/x-client";

// Spec 005: max X_DISCOVERY_PAGES_PER_RUN pages of 100 results per run — a
// viral spike cannot burn the monthly read cap in one day.
export const DEFAULT_DISCOVERY_PAGES_PER_RUN = 3;
export const MAX_RESULTS_PER_PAGE = 100;

// Spec 005 default query. ⚠️ The $ANSEM cashtag operator historically errored
// on lower X tiers; current pay-per-use docs show no restriction but it is
// UNVERIFIED offline — smoke-test at enable time (Task 33 pre-enable
// checklist). If X rejects it, set X_SEARCH_QUERY to the quoted-keyword
// fallback below (exact-phrase match, same retweet exclusion). Parenthesized
// deliberately: X applies AND before OR, so an unparenthesized
// `... has:videos OR has:images` would match EVERY image tweet.
export const DEFAULT_X_SEARCH_QUERY =
  "($ANSEM OR ansem) -is:retweet (has:videos OR has:images)";
export const FALLBACK_X_SEARCH_QUERY =
  '("$ANSEM" OR ansem) -is:retweet (has:videos OR has:images)';

const PLATFORM = "x" as const;
const FIRST_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;

export function resolveDiscoveryEnabled(
  env: Pick<ServerEnv, "X_DISCOVERY_ENABLED">,
): boolean {
  return env.X_DISCOVERY_ENABLED === "true";
}

export function resolveDiscoveryPages(
  env: Pick<ServerEnv, "X_DISCOVERY_PAGES_PER_RUN">,
): number {
  return env.X_DISCOVERY_PAGES_PER_RUN ?? DEFAULT_DISCOVERY_PAGES_PER_RUN;
}

export function resolveSearchQuery(
  env: Pick<ServerEnv, "X_SEARCH_QUERY">,
): string {
  return env.X_SEARCH_QUERY ?? DEFAULT_X_SEARCH_QUERY;
}

// Blank tokens are already normalized to undefined at boot (src/env.ts), so a
// `X_BEARER_TOKEN=` line can never enable discovery.
export function clientFromEnv(
  env: Pick<ServerEnv, "X_BEARER_TOKEN">,
): XClient | null {
  return env.X_BEARER_TOKEN
    ? new XClient({ bearerToken: env.X_BEARER_TOKEN })
    : null;
}

export type SearchClient = Pick<XClient, "get">;

export type DiscoverySummary =
  | { skipped: true }
  | {
      skipped: false;
      pagesRead: number;
      postsRead: number;
      discovered: number;
      duplicates: number;
      banned: number;
      invalid: number;
      errors: number;
      truncated: boolean;
      degraded: boolean;
      cursorAdvanced: boolean;
      durationMs: number;
    };

export type DiscoverXOptions = {
  enabled?: boolean;
  // `null` = no client available (no token) — distinct from "build from env".
  client?: SearchClient | null;
  query?: string;
  pagesPerRun?: number;
  now?: Date;
};

type Db = NodePgDatabase;

type Candidate = {
  platformPostId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  caption: string | null;
  postedAt: Date | null;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
};

type ApplyOutcome = "discovered" | "duplicate" | "banned" | "error";

export async function discoverX(
  db: Db,
  options: DiscoverXOptions = {},
): Promise<DiscoverySummary> {
  const startedAt = Date.now();
  const enabled = options.enabled ?? resolveDiscoveryEnabled(getEnv());
  if (!enabled) return { skipped: true };
  const client =
    options.client !== undefined ? options.client : clientFromEnv(getEnv());
  if (!client) return { skipped: true };

  const query = options.query ?? resolveSearchQuery(getEnv());
  const pagesPerRun = options.pagesPerRun ?? resolveDiscoveryPages(getEnv());
  const now = options.now ?? new Date();

  const [state] = await db
    .select({ cursor: discoveryState.cursor })
    .from(discoveryState)
    .where(eq(discoveryState.platform, PLATFORM));
  const sinceId = state?.cursor ?? null;

  // Read pages up to the budget. An X failure (429, transport) aborts the
  // read loop but keeps what already arrived — reads are paid, so persist
  // them; the unchanged cursor makes the next run re-read and dedupe.
  const collected: unknown[] = [];
  const userIndex = new Map<string, Record<string, unknown>>();
  let pagesRead = 0;
  let degraded = false;
  let nextToken: string | null = null;
  while (pagesRead < pagesPerRun) {
    const params: Record<string, string> = {
      query,
      max_results: String(MAX_RESULTS_PER_PAGE),
      "tweet.fields": "created_at,public_metrics",
      expansions: "author_id",
      "user.fields": "username,name,profile_image_url",
    };
    // First run ever (no committed cursor): last 24h only (spec 005 step 2).
    if (sinceId) params.since_id = sinceId;
    else
      params.start_time = new Date(
        now.getTime() - FIRST_RUN_WINDOW_MS,
      ).toISOString();
    if (nextToken) params.next_token = nextToken;

    const response = await client.get("/tweets/search/recent", params);
    if (!response.ok) {
      degraded = true;
      break;
    }
    pagesRead += 1;

    const body = asRecord(response.body);
    collected.push(...(Array.isArray(body?.data) ? body.data : []));
    const includes = asRecord(body?.includes);
    for (const entry of Array.isArray(includes?.users) ? includes.users : []) {
      const user = asRecord(entry);
      if (typeof user?.id === "string") userIndex.set(user.id, user);
    }
    nextToken = stringOrNull(asRecord(body?.meta)?.next_token);
    if (!nextToken) break;
  }
  // Budget exhausted with more pages waiting — visible, never silent (spec 005).
  const truncated = !degraded && nextToken !== null;

  // Map results to candidates. maxId spans EVERY readable id — including
  // otherwise-invalid entries — so a permanently-malformed newest tweet can
  // never pin the cursor (invalid data is unfixable by retry; only transient
  // DB errors below block the advance).
  let invalid = 0;
  let maxId: bigint | null = null;
  const candidates: Candidate[] = [];
  for (const entry of collected) {
    const record = asRecord(entry);
    const id =
      typeof record?.id === "string" && /^\d+$/.test(record.id)
        ? record.id
        : null;
    if (id !== null) {
      const numericId = BigInt(id);
      if (maxId === null || numericId > maxId) maxId = numericId;
    }
    const candidate =
      id !== null && record !== null ? mapResult(id, record, userIndex) : null;
    if (candidate === null) {
      invalid += 1;
      continue;
    }
    candidates.push(candidate);
  }

  let discovered = 0;
  let duplicates = 0;
  let banned = 0;
  let errors = 0;
  for (const candidate of candidates) {
    const outcome = await applyCandidate(db, candidate, now);
    if (outcome === "discovered") discovered += 1;
    else if (outcome === "duplicate") duplicates += 1;
    else if (outcome === "banned") banned += 1;
    else errors += 1;
  }

  // Spec 005 step 5: advance since_id ONLY after the batch committed cleanly.
  // Any DB error or X abort leaves it untouched — re-run re-reads, UNIQUE
  // gates dedupe. Truncation DOES advance past the unread remainder: the
  // budget is the spend bound and the loss is reported, never silent.
  let cursorAdvanced = false;
  if (!degraded && errors === 0 && maxId !== null) {
    const cursor = String(maxId);
    await db
      .insert(discoveryState)
      .values({ platform: PLATFORM, cursor, updatedAt: now })
      .onConflictDoUpdate({
        target: discoveryState.platform,
        set: { cursor, updatedAt: now },
      });
    cursorAdvanced = true;
  }

  return {
    skipped: false,
    pagesRead,
    postsRead: collected.length,
    discovered,
    duplicates,
    banned,
    invalid,
    errors,
    truncated,
    degraded,
    cursorAdvanced,
    durationMs: Date.now() - startedAt,
  };
}

function mapResult(
  id: string,
  tweet: Record<string, unknown>,
  users: Map<string, Record<string, unknown>>,
): Candidate | null {
  const metrics = asRecord(tweet.public_metrics);
  if (!metrics) return null;
  const author =
    typeof tweet.author_id === "string" ? users.get(tweet.author_id) : null;
  if (!author) return null;
  const handle = normalizeHandle(stringOrNull(author.username));
  if (handle === null) return null;
  try {
    return {
      platformPostId: id,
      handle,
      displayName: stringOrNull(author.name),
      avatarUrl: stringOrNull(author.profile_image_url),
      caption: stringOrNull(tweet.text),
      postedAt: dateOrNull(tweet.created_at),
      views: toBigInt(metrics.impression_count),
      likes: toBigInt(metrics.like_count),
      comments: toBigInt(metrics.reply_count),
      shares: toBigInt(metrics.retweet_count) + toBigInt(metrics.quote_count),
    };
  } catch {
    // Unsafe/malformed counts — never fabricate metrics (Task 10 semantics).
    return null;
  }
}

async function applyCandidate(
  db: Db,
  candidate: Candidate,
  capturedAt: Date,
): Promise<ApplyOutcome> {
  try {
    // Pre-check outside the transaction: an already-tracked post stays EXACTLY
    // as it is (spec 005) — no status/source touch, no snapshot append, and no
    // stray creator row for the search-result author.
    const existing = await db
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          eq(posts.platform, PLATFORM),
          eq(posts.platformPostId, candidate.platformPostId),
        ),
      );
    if (existing.length > 0) return "duplicate";

    // One transaction per result: creator upsert, post insert, initial
    // snapshot, and the latest_* denorm columns travel together (invariant
    // shared with spec 004 — a snapshot write and its denorm never split).
    return await db.transaction(async (tx) => {
      await tx
        .insert(creators)
        .values({
          platform: PLATFORM,
          handle: candidate.handle,
          displayName: candidate.displayName,
          avatarUrl: candidate.avatarUrl,
          profileUrl: profileUrlFor(PLATFORM, candidate.handle),
        })
        .onConflictDoNothing();
      const [creator] = await tx
        .select({ id: creators.id, isBanned: creators.isBanned })
        .from(creators)
        .where(
          and(
            eq(creators.platform, PLATFORM),
            eq(creators.handle, candidate.handle),
          ),
        );
      if (!creator) throw new Error("creator upsert returned no row");
      if (creator.isBanned) return "banned";

      const inserted = await tx
        .insert(posts)
        .values({
          creatorId: creator.id,
          platform: PLATFORM,
          platformPostId: candidate.platformPostId,
          url: xPostUrl(candidate.handle, candidate.platformPostId),
          caption: candidate.caption,
          postedAt: candidate.postedAt,
          status: "approved",
          source: "x_search",
          latestViews: candidate.views,
          latestLikes: candidate.likes,
          latestComments: candidate.comments,
          latestShares: candidate.shares,
          latestSnapshotAt: capturedAt,
        })
        .onConflictDoNothing()
        .returning({ id: posts.id });
      const insertedPost = inserted[0];
      // Lost a race with a concurrent submission — theirs stands (spec 005).
      if (!insertedPost) return "duplicate";

      await tx.insert(metricSnapshots).values({
        postId: insertedPost.id,
        views: candidate.views,
        likes: candidate.likes,
        comments: candidate.comments,
        shares: candidate.shares,
        capturedAt,
      });
      return "discovered";
    });
  } catch {
    // Transient DB failure: count it and keep going — the unchanged cursor
    // re-reads this window next run and the UNIQUE gates dedupe successes.
    return "error";
  }
}
