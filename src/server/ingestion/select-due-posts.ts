// Task 12 (spec 004): the ingestion refresh queue. Picks the posts whose
// metrics are most overdue — approved only, non-banned creators only — bounded
// by REFRESH_BATCH_SIZE so a run can never fan out unbounded provider calls.
import { and, count, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getEnv, type ServerEnv } from "@/env";
import { creators, posts } from "@/server/db/schema";

export const DEFAULT_REFRESH_BATCH_SIZE = 200;

export function resolveRefreshBatchSize(
  env: Pick<ServerEnv, "REFRESH_BATCH_SIZE">,
): number {
  return env.REFRESH_BATCH_SIZE ?? DEFAULT_REFRESH_BATCH_SIZE;
}

// Due = refreshable: approved (pending/rejected never earned a snapshot,
// removed is gone at source) and not owned by a banned creator.
const dueFilter = () =>
  and(eq(posts.status, "approved"), eq(creators.isBanned, false));

export async function selectDuePosts(
  db: NodePgDatabase,
  batchSize: number = resolveRefreshBatchSize(getEnv()),
) {
  const selectedRows = await db
    .select({
      id: posts.id,
      creatorId: posts.creatorId,
      platform: posts.platform,
      platformPostId: posts.platformPostId,
      url: posts.url,
      latestSnapshotAt: posts.latestSnapshotAt,
    })
    .from(posts)
    .innerJoin(creators, eq(posts.creatorId, creators.id))
    .where(dueFilter())
    // Stalest first; postgres ASC defaults to NULLS LAST, so never-snapshotted
    // posts need the explicit NULLS FIRST to jump the queue.
    .orderBy(sql`${posts.latestSnapshotAt} asc nulls first`)
    .limit(batchSize);

  const [totals] = await db
    .select({ totalDue: count() })
    .from(posts)
    .innerJoin(creators, eq(posts.creatorId, creators.id))
    .where(dueFilter());

  return {
    posts: selectedRows,
    selected: selectedRows.length,
    totalDue: totals?.totalDue ?? 0,
  };
}

export type DuePostsSelection = Awaited<ReturnType<typeof selectDuePosts>>;
export type DuePost = DuePostsSelection["posts"][number];
