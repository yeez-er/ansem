// Spec 009B: admin.refreshPost — force a single post's metrics to refresh now,
// on demand, instead of waiting for the ingestion cron. Reuses Task 13's
// applyPostResult so the write path (snapshot INSERT + latest_* denorm +
// placeholder merge, NOT_FOUND → removed) is identical to the scheduled run.
// The provider's outcome is mapped to a typed result the admin UI can render —
// never a raw error string.
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { getEnv } from "@/env";
import type { Platform } from "@/lib/post-url";
import { adminProcedure } from "@/server/api/trpc";
import { posts } from "@/server/db/schema";
import { applyPostResult } from "@/server/ingestion/refresh-metrics";
import {
  getProvider,
  type MetricsErrorCode,
  type MetricsProvider,
} from "@/server/metrics/provider";
import { logAdminAudit } from "./audit";

type Db = NodePgDatabase;

export type RefreshedSnapshot = {
  postId: string;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  capturedAt: Date;
};

export type RefreshPostResult =
  | { ok: true; snapshot: RefreshedSnapshot }
  | { ok: false; error: MetricsErrorCode };

const defaultProviderFor = (platform: Platform): MetricsProvider | null =>
  getProvider(platform, {
    env: getEnv(),
    isProduction: process.env.NODE_ENV === "production",
  });

// Provider resolution is injectable so tests can drive the RATE_LIMITED /
// NOT_FOUND / PROVIDER_ERROR branches the deterministic mock never produces.
// A missing post ROW throws NOT_FOUND (a genuine RPC not-found), distinct from
// the provider's NOT_FOUND (post gone at source → status = 'removed').
export async function refreshSinglePost(
  db: Db,
  postId: string,
  providerFor: (
    platform: Platform,
  ) => MetricsProvider | null = defaultProviderFor,
): Promise<RefreshPostResult> {
  const [post] = await db
    .select({
      id: posts.id,
      creatorId: posts.creatorId,
      platform: posts.platform,
      platformPostId: posts.platformPostId,
      url: posts.url,
      latestSnapshotAt: posts.latestSnapshotAt,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) {
    throw new TRPCError({ code: "NOT_FOUND", message: "POST_NOT_FOUND" });
  }

  const provider = providerFor(post.platform);
  if (!provider) {
    // Unconfigured platform (production only — dev always resolves the mock).
    // Can't refresh; surface it as a provider error, never a silent success.
    return { ok: false, error: "PROVIDER_ERROR" };
  }

  const results = await provider.fetchMetrics([
    {
      platform: post.platform,
      platformPostId: post.platformPostId,
      url: post.url,
    },
  ]);
  const result = results.get(post.platformPostId);

  const outcome = await applyPostResult(db, post, result);
  if (outcome === "refreshed" && result?.ok) {
    const { views, likes, comments, shares, capturedAt } = result.metrics;
    return {
      ok: true,
      snapshot: { postId: post.id, views, likes, comments, shares, capturedAt },
    };
  }

  // removed (provider NOT_FOUND) or error (RATE_LIMITED / PROVIDER_ERROR, or a
  // result missing from a well-formed map — a provider contract violation).
  const error: MetricsErrorCode =
    result && !result.ok ? result.error : "PROVIDER_ERROR";
  return { ok: false, error };
}

export const refreshPost = adminProcedure
  .input(z.object({ postId: z.uuid() }))
  .mutation(async ({ ctx, input }) => {
    // adminProcedure guarantees a session; re-check narrows the type.
    const actor = ctx.userId;
    if (actor === null) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const result = await refreshSinglePost(ctx.db, input.postId);
    // Audit the completed refresh; a provider error mutated nothing, so — like
    // reviewPost's non-success paths — it emits no audit line.
    if (result.ok) {
      logAdminAudit(actor, "post.refreshed", input.postId);
    }
    return result;
  });
