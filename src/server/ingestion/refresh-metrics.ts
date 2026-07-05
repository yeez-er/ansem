// Task 13 (spec 004): refreshMetrics orchestration. Fans the due-post queue
// out to per-platform providers in bounded sub-batches and writes results back
// ONE TRANSACTION PER POST, so one bad row can never poison the batch. The
// route handler (Task 14) stays thin — this function is the testable unit.
import { and, eq, notExists, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getEnv, type ServerEnv } from "@/env";
import { type Platform, profileUrlFor } from "@/lib/post-url";
import { creators, metricSnapshots, posts } from "@/server/db/schema";
import { errorForAll } from "@/server/metrics/adapter-util";
import {
  getProvider,
  type MetricsProvider,
  type MetricsResult,
  type PostMetrics,
  type PostRef,
} from "@/server/metrics/provider";
import { type DuePost, selectDuePosts } from "./select-due-posts";

// Spec 004: providers are called in sub-batches of ≤ 100 posts, and a run may
// spend at most MAX_PROVIDER_CALLS_PER_RUN sub-batch calls — a misconfigured
// REFRESH_BATCH_SIZE can never fan out unbounded.
export const SUB_BATCH_SIZE = 100;
export const DEFAULT_MAX_PROVIDER_CALLS_PER_RUN = 10;

export function resolveMaxProviderCalls(
  env: Pick<ServerEnv, "MAX_PROVIDER_CALLS_PER_RUN">,
): number {
  return env.MAX_PROVIDER_CALLS_PER_RUN ?? DEFAULT_MAX_PROVIDER_CALLS_PER_RUN;
}

export type RefreshSummary = {
  selected: number;
  refreshed: number;
  removed: number;
  skipped: number;
  errors: number;
  durationMs: number;
  degraded: boolean;
};

export type RefreshMetricsOptions = {
  batchSize?: number;
  maxProviderCalls?: number;
  providerFor?: (platform: Platform) => MetricsProvider | null;
};

export type RefreshOutcome = "refreshed" | "removed" | "error";

const PLACEHOLDER_PREFIX = "placeholder:";

type Db = NodePgDatabase;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const defaultProviderFor = (platform: Platform): MetricsProvider | null =>
  getProvider(platform, {
    env: getEnv(),
    isProduction: process.env.NODE_ENV === "production",
  });

export async function refreshMetrics(
  db: Db,
  options: RefreshMetricsOptions = {},
): Promise<RefreshSummary> {
  const startedAt = Date.now();
  const providerFor = options.providerFor ?? defaultProviderFor;
  const maxProviderCalls =
    options.maxProviderCalls ?? resolveMaxProviderCalls(getEnv());

  const selection = await selectDuePosts(db, options.batchSize);

  const byPlatform = new Map<Platform, DuePost[]>();
  for (const post of selection.posts) {
    const group = byPlatform.get(post.platform);
    if (group) group.push(post);
    else byPlatform.set(post.platform, [post]);
  }

  let refreshed = 0;
  let removed = 0;
  let skipped = 0;
  let errors = 0;
  let callsUsed = 0;
  const unconfigured: Platform[] = [];

  for (const [platform, group] of byPlatform) {
    const provider = providerFor(platform);
    if (!provider) {
      // Spec 003 registry-null rule: no provider configured (production never
      // falls back to mock) — the platform's posts are skipped, not errored.
      unconfigured.push(platform);
      skipped += group.length;
      continue;
    }
    // Posts left beyond the call budget stay untouched — stalest-first
    // re-queues them next run, so truncation costs latency, never data.
    for (
      let i = 0;
      i < group.length && callsUsed < maxProviderCalls;
      i += SUB_BATCH_SIZE
    ) {
      const batch = group.slice(i, i + SUB_BATCH_SIZE);
      callsUsed += 1;
      const results = await fetchBatch(provider, batch);
      for (const post of batch) {
        const outcome = await applyOrError(
          db,
          post,
          results.get(post.platformPostId),
        );
        if (outcome === "refreshed") refreshed += 1;
        else if (outcome === "removed") removed += 1;
        else errors += 1;
      }
    }
  }

  if (unconfigured.length > 0) {
    // Exactly one structured warning per run (spec 004): skips must be visible
    // in Vercel logs without flooding them once per post.
    console.warn(
      JSON.stringify({
        event: "refresh_metrics.unconfigured_platforms",
        platforms: unconfigured,
        skipped,
      }),
    );
  }

  const resultCount = refreshed + removed + errors;
  return {
    selected: selection.selected,
    refreshed,
    removed,
    skipped,
    errors,
    durationMs: Date.now() - startedAt,
    // Integer comparison — no division, no zero-results guard needed. > 50%
    // errors flags the run degraded so cron won't retry-storm a struggling
    // provider (spec 004 guard).
    degraded: errors * 2 > resultCount,
  };
}

// Providers contractually never reject, but the injected resolver is an open
// seam and every provider call crosses an external-service boundary — degrade
// a rejection to typed errors for the batch instead of failing the run.
async function fetchBatch(
  provider: MetricsProvider,
  batch: DuePost[],
): Promise<Map<string, MetricsResult>> {
  const refs: PostRef[] = batch.map((post) => ({
    platform: post.platform,
    platformPostId: post.platformPostId,
    url: post.url,
  }));
  try {
    return await provider.fetchMetrics(refs);
  } catch {
    return errorForAll(
      refs.map((ref) => ref.platformPostId),
      "PROVIDER_ERROR",
      false,
    );
  }
}

// A DB failure on one post must not poison the rest of the batch — count it
// and move on; stalest-first re-selects the post next run.
async function applyOrError(
  db: Db,
  post: DuePost,
  result: MetricsResult | undefined,
): Promise<RefreshOutcome> {
  try {
    return await applyPostResult(db, post, result);
  } catch {
    return "error";
  }
}

// Applies one provider result to one post. Exported for the admin single-post
// refresh (Task 25) and exercised directly by the merge-race test.
export async function applyPostResult(
  db: Db,
  post: DuePost,
  result: MetricsResult | undefined,
): Promise<RefreshOutcome> {
  // Missing from a well-formed map is a provider contract violation — leave
  // the post untouched rather than guessing.
  if (!result) return "error";

  if (!result.ok) {
    if (result.error === "NOT_FOUND") {
      // Gone at source. Keep snapshots — history stays on past windows.
      await db
        .update(posts)
        .set({ status: "removed" })
        .where(eq(posts.id, post.id));
      return "removed";
    }
    return "error";
  }

  const { metrics } = result;
  await db.transaction(async (tx) => {
    await tx.insert(metricSnapshots).values({
      postId: post.id,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      capturedAt: metrics.capturedAt,
    });
    await tx
      .update(posts)
      .set({
        latestViews: metrics.views,
        latestLikes: metrics.likes,
        latestComments: metrics.comments,
        latestShares: metrics.shares,
        latestSnapshotAt: metrics.capturedAt,
      })
      .where(eq(posts.id, post.id));
    await mergePlaceholderCreator(tx, post, metrics);
  });
  return "refreshed";
}

// Providers return raw author handles; creators store them lowercased with no
// leading '@' (schema invariant, matching parsePostUrl's normalization).
function normalizeHandle(raw: string | null): string | null {
  if (raw === null) return null;
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  return handle === "" ? null : handle;
}

async function findCreatorId(
  tx: Tx,
  platform: Platform,
  handle: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: creators.id })
    .from(creators)
    .where(and(eq(creators.platform, platform), eq(creators.handle, handle)));
  return row?.id ?? null;
}

// Re-point the post at the winning creator, then reap the placeholder only if
// this was its last post. The FK from posts.creator_id backstops any race
// toward a wrong delete.
async function repointToCreator(
  tx: Tx,
  postId: string,
  placeholderId: string,
  targetId: string,
): Promise<void> {
  await tx
    .update(posts)
    .set({ creatorId: targetId })
    .where(eq(posts.id, postId));
  await tx.delete(creators).where(
    and(
      eq(creators.id, placeholderId),
      notExists(
        tx
          .select({ one: sql`1` })
          .from(posts)
          .where(eq(posts.creatorId, placeholderId)),
      ),
    ),
  );
}

// Spec 004 placeholder resolution, deterministic and inside the per-post
// transaction: an existing (platform, handle) creator absorbs the post; a
// free handle renames the placeholder in place — and a rename that loses the
// UNIQUE race falls back to the absorb branch.
async function mergePlaceholderCreator(
  tx: Tx,
  post: DuePost,
  metrics: PostMetrics,
): Promise<void> {
  const resolved = normalizeHandle(metrics.authorHandle);
  if (!resolved) return;

  const [creator] = await tx
    .select({ id: creators.id, handle: creators.handle })
    .from(creators)
    .where(eq(creators.id, post.creatorId));
  if (!creator?.handle.startsWith(PLACEHOLDER_PREFIX)) return;

  const existingId = await findCreatorId(tx, post.platform, resolved);
  if (existingId) {
    await repointToCreator(tx, post.id, creator.id, existingId);
    return;
  }

  try {
    // Savepoint (nested transaction): a UNIQUE violation must not abort the
    // outer per-post transaction — it falls through to the re-point branch.
    await tx.transaction(async (sp) => {
      await sp
        .update(creators)
        .set({
          handle: resolved,
          displayName: metrics.authorDisplayName,
          avatarUrl: metrics.authorAvatarUrl,
          // Never keep the stand-in post-URL profile.
          profileUrl: profileUrlFor(post.platform, resolved),
          updatedAt: sql`now()`,
        })
        .where(eq(creators.id, creator.id));
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Lost the rename race: someone committed this (platform, handle) creator
    // after our existence check. They win; re-point at them.
    const winnerId = await findCreatorId(tx, post.platform, resolved);
    if (winnerId === null) throw err;
    await repointToCreator(tx, post.id, creator.id, winnerId);
  }
}

// drizzle wraps driver errors (DrizzleQueryError); the pg DatabaseError with
// `code` rides on `.cause`.
function isUniqueViolation(err: unknown): boolean {
  const cause =
    err instanceof Error && err.cause !== undefined ? err.cause : err;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "23505"
  );
}
