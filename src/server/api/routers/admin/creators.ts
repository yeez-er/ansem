// Spec 009B: admin.creators — the moderation creator list. EVERY creator,
// banned included (this is the view where an operator unbans them), with a total
// post count across all statuses. Ordered busiest-first so the most active
// creators surface for triage, with a handle tie-break for a stable total order.
// Admin-only (adminProcedure is the boundary); the small v1 roster is fetched
// whole and searched client-side.
import { asc, count, desc, eq } from "drizzle-orm";
import { adminProcedure } from "@/server/api/trpc";
import { creators, posts } from "@/server/db/schema";

export const creatorList = adminProcedure.query(async ({ ctx }) => {
  return ctx.db
    .select({
      id: creators.id,
      platform: creators.platform,
      handle: creators.handle,
      displayName: creators.displayName,
      isBanned: creators.isBanned,
      // count(posts.id) counts non-null joined rows, so a creator with no posts
      // (LEFT JOIN → all-null) correctly reports 0.
      postCount: count(posts.id),
    })
    .from(creators)
    .leftJoin(posts, eq(posts.creatorId, creators.id))
    .groupBy(creators.id)
    .orderBy(desc(count(posts.id)), asc(creators.handle));
});
